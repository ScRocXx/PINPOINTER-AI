package com.pinpointer.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Process
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.label.ImageLabeler
import com.google.mlkit.vision.label.ImageLabeling
import com.google.mlkit.vision.label.defaults.ImageLabelerOptions
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * PhotoReader — the words in a photo, read with one decode.
 *
 * The old path decoded every photo three or four times (a resize that wrote a
 * JPEG to disk, one decode per OCR script, another for labels) and shrank a
 * 1080x2400 screenshot to 461x1024, below what small text needs. This module:
 *
 *  - decodes once, downsampling while it decodes, to at most `maxSide` on the
 *    longer side (default 1600: a screenshot keeps 720 px of width);
 *  - hands that one bitmap, with its rotation, to each ML Kit recognizer;
 *  - keeps one recognizer per script for the app's life (they were created
 *    per call and never closed) on a background-priority thread, so reading
 *    never competes with drawing the screen;
 *  - can run a second script only when the first found little text
 *    (`fallbackScript`, `fallbackBelowChars`): an English gallery needn't pay
 *    for the Devanagari pass on every photo;
 *  - returns each line with its confidence and position (0–1 of the upright
 *    image) for later use (pairing a bill's labels and values, judging
 *    misreadings);
 *  - labels the same bitmap (what the photo shows) when it holds little text
 *    (`labelBelowChars`): ML Kit's file loader would decode the full 12 MP
 *    original for that, about 48 MB, which a 2 GB phone can't spare.
 */
class PhotoReaderModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "PhotoReader"

    companion object {
        private const val TAG = "PhotoReader"
        private const val DEFAULT_MAX_SIDE = 1600
        private const val MAX_LINES = 300
        private const val MAX_LABELS = 7
        private const val LABEL_CONFIDENCE = 0.5f
        /** Bytes read for a fingerprint: the header and the start of the image data. */
        private const val FINGERPRINT_BYTES = 64 * 1024
    }

    private fun backgroundThread(name: String): ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread({
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
            r.run()
        }, name)
    }

    private val worker = backgroundThread("PhotoReader")
    private val recognizerThread = backgroundThread("PhotoReader-mlkit")

    // Only touched on the worker thread.
    private var latin: TextRecognizer? = null
    private var devanagari: TextRecognizer? = null
    private var labeler: ImageLabeler? = null

    private fun labeler(): ImageLabeler = labeler ?: ImageLabeling.getClient(
        ImageLabelerOptions.Builder().setConfidenceThreshold(LABEL_CONFIDENCE).setExecutor(recognizerThread).build(),
    ).also { labeler = it }

    private fun recognizer(script: String): TextRecognizer = when (script) {
        "devanagari" -> devanagari ?: TextRecognition.getClient(
            DevanagariTextRecognizerOptions.Builder().setExecutor(recognizerThread).build(),
        ).also { devanagari = it }
        else -> latin ?: TextRecognition.getClient(
            TextRecognizerOptions.Builder().setExecutor(recognizerThread).build(),
        ).also { latin = it }
    }

    private fun open(uri: String): InputStream? =
        if (uri.startsWith("content://")) {
            reactApplicationContext.contentResolver.openInputStream(Uri.parse(uri))
        } else {
            FileInputStream(uri.removePrefix("file://"))
        }

    /** One decode, at most `maxSide` on the longer side. */
    private fun decode(uri: String, maxSide: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        open(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val w = bounds.outWidth
        val h = bounds.outHeight
        if (w <= 0 || h <= 0) return null
        var sample = 1
        while (max(w, h) / (sample * 2) >= maxSide) sample *= 2
        val decoded = open(uri)?.use {
            BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val longest = max(decoded.width, decoded.height)
        if (longest <= maxSide) return decoded
        val scale = maxSide.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * scale).roundToInt().coerceAtLeast(1),
            (decoded.height * scale).roundToInt().coerceAtLeast(1),
            true,
        )
        if (scaled !== decoded) decoded.recycle()
        return scaled
    }

    private fun linesOf(text: Text, uprightWidth: Int, uprightHeight: Int): WritableArray {
        val lines = Arguments.createArray()
        var count = 0
        for (block in text.textBlocks) {
            for (line in block.lines) {
                if (count++ >= MAX_LINES) return lines
                val map = Arguments.createMap()
                map.putString("text", line.text)
                map.putDouble("confidence", line.confidence.toDouble())
                line.boundingBox?.let { box ->
                    val b = Arguments.createArray()
                    b.pushDouble(box.left.toDouble() / uprightWidth)
                    b.pushDouble(box.top.toDouble() / uprightHeight)
                    b.pushDouble(box.right.toDouble() / uprightWidth)
                    b.pushDouble(box.bottom.toDouble() / uprightHeight)
                    map.putArray("box", b)
                }
                lines.pushMap(map)
            }
        }
        return lines
    }

    private fun resultOf(script: String, text: Text, uprightWidth: Int, uprightHeight: Int): WritableMap =
        Arguments.createMap().apply {
            putString("script", script)
            putString("text", text.text)
            putArray("lines", linesOf(text, uprightWidth, uprightHeight))
        }

    /**
     * options: { scripts: ['latin' | 'devanagari', …], maxSide?: number,
     *            fallbackScript?: string, fallbackBelowChars?: number,
     *            labelBelowChars?: number }
     * Resolves { results: [{ script, text, lines: [{ text, confidence, box }] }],
     *            labels?: [{ text, confidence }], width, height, rotation }.
     */
    @ReactMethod
    fun readText(uri: String, options: ReadableMap, promise: Promise) {
        worker.execute {
            var bitmap: Bitmap? = null
            try {
                val maxSide = if (options.hasKey("maxSide")) options.getInt("maxSide") else DEFAULT_MAX_SIDE
                val scripts = options.getArray("scripts")?.toArrayList()?.map { it.toString() } ?: listOf("latin")
                val fallback = if (options.hasKey("fallbackScript")) options.getString("fallbackScript") else null
                val fallbackBelow = if (options.hasKey("fallbackBelowChars")) options.getInt("fallbackBelowChars") else 0
                val labelBelow = if (options.hasKey("labelBelowChars")) options.getInt("labelBelowChars") else 0

                val image = decode(uri, maxSide)
                if (image == null) {
                    promise.reject("IMAGE_ERROR", "Could not read the image")
                    return@execute
                }
                bitmap = image
                val rotation = ImageOrientation.rotationDegrees(reactApplicationContext, uri)
                val upright = rotation == 90 || rotation == 270
                val uprightWidth = if (upright) image.height else image.width
                val uprightHeight = if (upright) image.width else image.height
                val input = InputImage.fromBitmap(image, rotation)

                val results = Arguments.createArray()
                var fewest = Int.MAX_VALUE
                var most = 0
                for (script in scripts) {
                    val text = Tasks.await(recognizer(script).process(input))
                    val chars = text.text.trim().length
                    fewest = minOf(fewest, chars)
                    most = maxOf(most, chars)
                    results.pushMap(resultOf(script, text, uprightWidth, uprightHeight))
                }
                if (fallback != null && fallback !in scripts && fewest < fallbackBelow) {
                    val text = Tasks.await(recognizer(fallback).process(input))
                    most = maxOf(most, text.text.trim().length)
                    results.pushMap(resultOf(fallback, text, uprightWidth, uprightHeight))
                }
                // Little text: say what the photo shows, from the same bitmap.
                var labels: WritableArray? = null
                if (most < labelBelow) {
                    labels = Arguments.createArray()
                    Tasks.await(labeler().process(input))
                        .sortedByDescending { it.confidence }
                        .take(MAX_LABELS)
                        .forEach { label ->
                            labels.pushMap(Arguments.createMap().apply {
                                putString("text", label.text)
                                putDouble("confidence", label.confidence.toDouble())
                            })
                        }
                }

                promise.resolve(Arguments.createMap().apply {
                    putArray("results", results)
                    labels?.let { putArray("labels", it) }
                    putInt("width", uprightWidth)
                    putInt("height", uprightHeight)
                    putInt("rotation", rotation)
                })
            } catch (e: Throwable) {
                Log.e(TAG, "Reading the photo failed", e)
                promise.reject("READ_ERROR", "Reading the photo failed: ${e.message}", e)
            } finally {
                bitmap?.recycle()
            }
        }
    }

    /**
     * The file's size in bytes from the file system, or -1 when it can't be
     * known. Not counted by skipping: FileInputStream.skip() moves past the
     * end of a file without complaint, so a skip loop never ends.
     */
    private fun sizeOf(uri: String): Long =
        if (uri.startsWith("content://")) {
            val pfd = reactApplicationContext.contentResolver.openFileDescriptor(Uri.parse(uri), "r")
            try {
                pfd?.statSize ?: -1L
            } finally {
                pfd?.close()
            }
        } else {
            File(uri.removePrefix("file://")).let { if (it.isFile) it.length() else -1L }
        }

    /**
     * A fingerprint of the file's bytes: SHA-1 of its first 64 KB, plus its
     * size. WhatsApp keeps byte-identical copies of a forwarded photo in
     * several folders; equal fingerprints mean one can take the other's text
     * and vector instead of being read again. Reads 64 KB, decodes nothing.
     */
    @ReactMethod
    fun fingerprint(uri: String, promise: Promise) {
        worker.execute {
            try {
                val size = sizeOf(uri)
                if (size <= 0L) {
                    promise.reject("IMAGE_ERROR", "Could not tell the file's size")
                    return@execute
                }
                val digest = MessageDigest.getInstance("SHA-1")
                val read = open(uri)?.use { input ->
                    val buffer = ByteArray(8192)
                    var left = FINGERPRINT_BYTES
                    var total = 0
                    while (left > 0) {
                        val n = input.read(buffer, 0, minOf(buffer.size, left))
                        if (n <= 0) break
                        digest.update(buffer, 0, n)
                        left -= n
                        total += n
                    }
                    total
                } ?: 0
                if (read <= 0) {
                    promise.reject("IMAGE_ERROR", "Could not read the file")
                    return@execute
                }
                val hex = digest.digest().joinToString("") { "%02x".format(it) }
                promise.resolve("$hex:$size")
            } catch (e: Throwable) {
                promise.reject("FINGERPRINT_ERROR", "Fingerprint failed: ${e.message}", e)
            }
        }
    }

    override fun invalidate() {
        worker.shutdownNow()
        recognizerThread.shutdownNow()
        try { latin?.close() } catch (_: Exception) { }
        try { devanagari?.close() } catch (_: Exception) { }
        try { labeler?.close() } catch (_: Exception) { }
        latin = null
        devanagari = null
        labeler = null
        super.invalidate()
    }
}
