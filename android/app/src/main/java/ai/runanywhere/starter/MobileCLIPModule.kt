package ai.runanywhere.starter

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Log
import com.facebook.react.bridge.*
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * MobileCLIP image/text encoders (ONNX Runtime).
 *
 * Threading: React Native runs every @ReactMethod of every native module on one
 * shared "native modules" thread. Running CLIP there made search queries wait
 * behind photo indexing (and behind OCR, PDF and audio calls). Each encoder now
 * has its own single-thread executor, so a text query never queues behind
 * image encoding during gallery sync.
 */
class MobileCLIPModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "MobileCLIPModule"

    companion object {
        private const val TAG = "MobileCLIP"
        private const val VISION_MODEL = "models/clip/vision_encoder_int8.onnx"
        private const val TEXT_MODEL = "models/clip/text_encoder_int8.onnx"
        private const val IMAGE_SIZE = 256
    }

    private val imageExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "MobileCLIP-image").apply { priority = Thread.MIN_PRIORITY }
    }
    private val textExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "MobileCLIP-text")
    }

    // Each session is only touched from its own executor thread.
    private var visionSession: OrtSession? = null
    private var textSession: OrtSession? = null
    private var bpeTokenizer: BPETokenizer? = null

    private val env: OrtEnvironment by lazy { OrtEnvironment.getEnvironment() }

    private fun createSession(assetPath: String, threads: Int): OrtSession {
        val start = System.currentTimeMillis()
        val modelBytes = reactApplicationContext.assets.open(assetPath).use { it.readBytes() }
        val options = OrtSession.SessionOptions()
        try {
            options.addXnnpack(mapOf("intra_op_num_threads" to threads.toString()))
        } catch (e: Exception) {
            Log.w(TAG, "XNNPACK unavailable, using default CPU provider", e)
        }
        options.setIntraOpNumThreads(threads)
        val session = env.createSession(modelBytes, options)
        Log.i(TAG, "Loaded $assetPath in ${System.currentTimeMillis() - start}ms")
        return session
    }

    private fun getVisionSession(): OrtSession =
        visionSession ?: createSession(VISION_MODEL, 2).also { visionSession = it }

    private fun getTextSession(): OrtSession =
        textSession ?: createSession(TEXT_MODEL, 4).also { textSession = it }

    private fun getTokenizer(): BPETokenizer =
        bpeTokenizer ?: BPETokenizer(reactApplicationContext).also { bpeTokenizer = it }

    private fun l2Normalize(vector: FloatArray): FloatArray {
        var sumSq = 0f
        for (v in vector) sumSq += v * v
        val norm = sqrt(sumSq.toDouble()).toFloat()
        if (norm <= 0f) return vector.copyOf()
        return FloatArray(vector.size) { vector[it] / norm }
    }

    private fun toJsArray(vector: FloatArray): WritableArray {
        val arr = Arguments.createArray()
        for (v in vector) arr.pushDouble(v.toDouble())
        return arr
    }

    /**
     * Gallery photos arrive as content:// URIs (CameraRoll), which decodeFile
     * can't open; everything else is a plain file path.
     */
    private fun decode(path: String, options: BitmapFactory.Options): Bitmap? =
        if (path.startsWith("content://")) {
            reactApplicationContext.contentResolver.openInputStream(Uri.parse(path))
                ?.use { BitmapFactory.decodeStream(it, null, options) }
        } else {
            BitmapFactory.decodeFile(path, options)
        }

    /**
     * Decode at reduced resolution, resize the short edge to 256 and centre-crop
     * to 256x256, as the model's preprocessor_config.json specifies.
     */
    private fun loadSquareBitmap(path: String): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        decode(path, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        var sample = 1
        while (bounds.outWidth / (sample * 2) >= IMAGE_SIZE && bounds.outHeight / (sample * 2) >= IMAGE_SIZE) {
            sample *= 2
        }
        val decoded = decode(path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: return null

        val scale = IMAGE_SIZE.toFloat() / minOf(decoded.width, decoded.height)
        val w = max(IMAGE_SIZE, (decoded.width * scale).roundToInt())
        val h = max(IMAGE_SIZE, (decoded.height * scale).roundToInt())
        val scaled = Bitmap.createScaledBitmap(decoded, w, h, true)
        if (scaled !== decoded) decoded.recycle()

        val cropped = Bitmap.createBitmap(scaled, (w - IMAGE_SIZE) / 2, (h - IMAGE_SIZE) / 2, IMAGE_SIZE, IMAGE_SIZE)
        if (cropped !== scaled) scaled.recycle()
        return cropped
    }

    @ReactMethod
    fun encodeImage(imagePath: String, promise: Promise) {
        imageExecutor.execute {
            var tensor: OnnxTensor? = null
            var result: OrtSession.Result? = null
            try {
                val path = if (imagePath.startsWith("file://")) imagePath.substring(7) else imagePath
                val bitmap = loadSquareBitmap(path)
                if (bitmap == null) {
                    promise.reject("IMAGE_ERROR", "Failed to load image from path")
                    return@execute
                }

                // preprocessor_config.json: mean=[0,0,0], std=[1,1,1] → pixels in 0..1
                val plane = IMAGE_SIZE * IMAGE_SIZE
                val pixels = IntArray(plane)
                bitmap.getPixels(pixels, 0, IMAGE_SIZE, 0, 0, IMAGE_SIZE, IMAGE_SIZE)
                bitmap.recycle()

                val tensorData = FloatBuffer.allocate(3 * plane)
                for (i in pixels.indices) {
                    val p = pixels[i]
                    tensorData.put(i, ((p shr 16) and 0xFF) / 255.0f)
                    tensorData.put(i + plane, ((p shr 8) and 0xFF) / 255.0f)
                    tensorData.put(i + 2 * plane, (p and 0xFF) / 255.0f)
                }

                val session = getVisionSession()
                tensor = OnnxTensor.createTensor(env, tensorData, longArrayOf(1, 3, IMAGE_SIZE.toLong(), IMAGE_SIZE.toLong()))
                result = session.run(mapOf(session.inputNames.iterator().next() to tensor))
                @Suppress("UNCHECKED_CAST")
                val output = result[0].value as Array<FloatArray>
                promise.resolve(toJsArray(l2Normalize(output[0])))
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to encode image", e)
                promise.reject("ENCODE_ERROR", "Failed to encode image: ${e.message}", e)
            } finally {
                tensor?.close()
                result?.close()
            }
        }
    }

    @ReactMethod
    fun encodeText(text: String, promise: Promise) {
        textExecutor.execute {
            var tensor: OnnxTensor? = null
            var result: OrtSession.Result? = null
            try {
                val tokens = getTokenizer().tokenize(text)
                val session = getTextSession()
                tensor = OnnxTensor.createTensor(env, LongBuffer.wrap(tokens), longArrayOf(1, tokens.size.toLong()))
                result = session.run(mapOf(session.inputNames.iterator().next() to tensor))
                @Suppress("UNCHECKED_CAST")
                val output = result[0].value as Array<FloatArray>
                promise.resolve(toJsArray(l2Normalize(output[0])))
            } catch (e: Throwable) {
                Log.e(TAG, "Failed to encode text", e)
                promise.reject("ENCODE_ERROR", "Failed to encode text: ${e.message}", e)
            } finally {
                tensor?.close()
                result?.close()
            }
        }
    }

    /**
     * Load the tokenizer and text encoder ahead of the first search, so the first
     * query doesn't pay the model load time. Resolves true when ready.
     */
    @ReactMethod
    fun warmUpText(promise: Promise) {
        textExecutor.execute {
            try {
                getTokenizer()
                getTextSession()
                promise.resolve(true)
            } catch (e: Throwable) {
                Log.e(TAG, "Text encoder warm-up failed", e)
                promise.reject("WARMUP_ERROR", "Text encoder warm-up failed: ${e.message}", e)
            }
        }
    }

    override fun invalidate() {
        imageExecutor.shutdownNow()
        textExecutor.shutdownNow()
        // Let an in-flight run finish before closing its session.
        try {
            imageExecutor.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
            textExecutor.awaitTermination(2, java.util.concurrent.TimeUnit.SECONDS)
        } catch (_: InterruptedException) { }
        try { visionSession?.close() } catch (_: Exception) { }
        try { textSession?.close() } catch (_: Exception) { }
        visionSession = null
        textSession = null
        super.invalidate()
    }
}
