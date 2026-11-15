package com.pinpointer.app

import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.app.ActivityCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.k2fsa.sherpa.onnx.*
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.concurrent.thread

/**
 * On-device speech to text, in the app's language:
 *  - English: Whisper base.en (OfflineRecognizer), about 160 MB.
 *  - Hindi: indic-lekhan, a small streaming Zipformer transducer (about 28 MB,
 *    CC BY 4.0, see models/hindi/NOTICE.txt). It is fed the whole recording at
 *    the end, like Whisper, and listens for the Hindi words of the person's own
 *    papers (hotwords, `setHotwords`).
 * Only one model is in memory at a time: `initSTT` with the other language
 * frees the first.
 */
class SherpaOnnxModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SherpaOnnxModule"

    // ─── Constants ─────────────────────────────────────────────────────
    companion object {
        const val SAMPLE_RATE = 16000
        const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

        /** The Hindi model, as download-models.js puts it in the APK. */
        private const val HINDI_ENCODER = "models/hindi/encoder.int8.onnx"
        private const val HINDI_DECODER = "models/hindi/decoder.int8.onnx"
        private const val HINDI_JOINER = "models/hindi/joiner-hi.int8.onnx"
        private const val HINDI_TOKENS = "models/hindi/tokens.txt"
        /** Optional: without it the model still works, without hotwords. */
        private const val HINDI_VOCAB = "models/hindi/bpe.vocab"

        /**
         * Boost per hotword token: sherpa-onnx's default. On synthetic Hindi
         * speech with the voice's sampling noise on, 2.0 and up turned a correct
         * "आधार कार्ड" into "पधार कार्ड"; 1.5 never changed a right phrase.
         */
        private const val HOTWORDS_SCORE = 1.5f
        /** How often the live mic level is sent to JS ("onSpeechVolume"). */
        const val LEVEL_INTERVAL_MS = 60L
        /** Room noise sits below MIN_DB, close speech reaches MAX_DB (dBFS). */
        private const val MIN_DB = -55.0
        private const val MAX_DB = -15.0

        /**
         * Loudness of 16-bit little-endian PCM as 0..1, for the listening
         * meter and silence detection. RMS in dBFS, mapped from MIN_DB..MAX_DB.
         */
        @JvmStatic
        fun micLevel(pcm: ByteArray, length: Int): Double {
            val n = minOf(length, pcm.size) / 2
            if (n <= 0) return 0.0
            var sum = 0.0
            for (s in 0 until n) {
                val lo = pcm[2 * s].toInt() and 0xFF
                val hi = pcm[2 * s + 1].toInt()
                val sample = ((hi shl 8) or lo).toShort().toDouble()
                sum += sample * sample
            }
            val rms = Math.sqrt(sum / n) / 32768.0
            if (rms <= 0.0) return 0.0
            val db = 20.0 * Math.log10(rms)
            return ((db - MIN_DB) / (MAX_DB - MIN_DB)).coerceIn(0.0, 1.0)
        }

        private var nativeLibLoaded = false

        init {
            try {
                System.loadLibrary("sherpa-onnx-jni")
                nativeLibLoaded = true
            } catch (e: UnsatisfiedLinkError) {
                android.util.Log.e("SherpaOnnxModule", "Failed to load native library: ${e.message}")
                nativeLibLoaded = false
            } catch (e: Exception) {
                android.util.Log.e("SherpaOnnxModule", "Unexpected error loading native library: ${e.message}")
                nativeLibLoaded = false
            }
        }
    }

    // ─── STT State ─────────────────────────────────────────────────────
    /** Held while a model loads, is freed or decodes: never freed under a running decode. */
    private val modelLock = Any()
    /** English (Whisper). */
    private var recognizer: OfflineRecognizer? = null
    /** Hindi (indic-lekhan). */
    private var hindiRecognizer: OnlineRecognizer? = null
    /** "en" or "hi" once a model is loaded. */
    @Volatile private var loadedLanguage: String? = null
    /** Beam search with the BPE vocabulary loaded: only then may hotwords be passed (else sherpa-onnx crashes). */
    @Volatile private var hotwordsUsable = false
    @Volatile private var hotwords = ""
    @Volatile private var isSTTReady = false
    private var audioRecord: AudioRecord? = null
    @Volatile private var isRecording = false
    @Volatile private var destroyed = false
    private var recordingThread: Thread? = null
    private var recordedData: ByteArrayOutputStream? = null

    private fun emitEvent(eventName: String, params: Any?) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    // ════════════════════════════════════════════════════════════════════
    // ─── STT METHODS ────────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════════════════

    /**
     * Loads the speech model for `language` ("hi" for Hindi, anything else for
     * English), freeing the other one. Resolves true once voice search can start.
     */
    @ReactMethod
    fun initSTT(language: String?, promise: Promise) {
        if (!nativeLibLoaded) {
            promise.reject("NATIVE_LIB_ERROR", "sherpa-onnx native library failed to load")
            return
        }
        val lang = if (language == "hi") "hi" else "en"
        // H4 fix: prevent re-entry leak — the model for this language is loaded already
        if (isSTTReady && loadedLanguage == lang) {
            promise.resolve(true)
            return
        }
        thread {
            try {
                synchronized(modelLock) {
                    releaseModels()
                    if (lang == "hi") loadHindi() else loadWhisper()
                    loadedLanguage = lang
                    isSTTReady = true
                }
                android.util.Log.i("SherpaOnnxModule", "STT initialized successfully ($lang)")
                promise.resolve(true)
            } catch (e: Throwable) {
                // Catch Throwable (not just Exception) to handle OutOfMemoryError
                // from loading the ~154 MB whisper model
                isSTTReady = false
                loadedLanguage = null
                android.util.Log.e("SherpaOnnxModule", "STT init failed: ${e.javaClass.name}: ${e.message}", e)
                promise.reject("STT_INIT_ERROR", "Failed to init STT: ${e.message}", if (e is Exception) e else Exception(e))
            }
        }
    }

    /** Frees whichever model is loaded. Call with modelLock held. */
    private fun releaseModels() {
        isSTTReady = false
        loadedLanguage = null
        hotwordsUsable = false
        try { recognizer?.release() } catch (_: Exception) {}
        try { hindiRecognizer?.release() } catch (_: Exception) {}
        recognizer = null
        hindiRecognizer = null
    }

    private fun loadWhisper() {
        val whisperConfig = OfflineWhisperModelConfig(
            encoder = "models/whisper/base.en-encoder.int8.onnx",
            decoder = "models/whisper/base.en-decoder.int8.onnx",
            language = "en",
            task = "transcribe",
            tailPaddings = -1
        )

        val modelConfig = OfflineModelConfig(
            whisper = whisperConfig,
            tokens = "models/whisper/base.en-tokens.txt",
            numThreads = 2,
            debug = false,
            provider = "cpu",
            modelType = "whisper"
        )

        val featConfig = FeatureConfig(
            sampleRate = SAMPLE_RATE,
            featureDim = 80
        )

        val config = OfflineRecognizerConfig(
            featConfig = featConfig,
            modelConfig = modelConfig
        )

        recognizer = OfflineRecognizer(
            assetManager = reactApplicationContext.assets,
            config = config
        )
    }

    private fun assetText(path: String): String? = try {
        reactApplicationContext.assets.open(path).use { it.readBytes().toString(Charsets.UTF_8) }
    } catch (_: Exception) {
        null
    }

    private fun assetExists(path: String): Boolean = try {
        reactApplicationContext.assets.open(path).use { true }
    } catch (_: Exception) {
        false
    }

    private fun loadHindi() {
        // sherpa-onnx exits the app on a missing model file instead of throwing: check first.
        val missing = listOf(HINDI_ENCODER, HINDI_DECODER, HINDI_JOINER, HINDI_TOKENS).filterNot { assetExists(it) }
        if (missing.isNotEmpty()) throw IllegalStateException("Hindi speech model files missing: $missing")
        val withVocab = assetText(HINDI_VOCAB)?.let { SpeechText.vocabLooksRight(it) } == true

        val config = OnlineRecognizerConfig(
            featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
            modelConfig = OnlineModelConfig(
                transducer = OnlineTransducerModelConfig(
                    encoder = HINDI_ENCODER,
                    decoder = HINDI_DECODER,
                    joiner = HINDI_JOINER,
                ),
                tokens = HINDI_TOKENS,
                numThreads = 2,
                provider = "cpu",
                modelingUnit = if (withVocab) "bpe" else "",
                bpeVocab = if (withVocab) HINDI_VOCAB else "",
            ),
            // The whole recording is decoded at the end, like Whisper: no endpoints.
            enableEndpoint = false,
            decodingMethod = if (withVocab) "modified_beam_search" else "greedy_search",
            maxActivePaths = 4,
            hotwordsScore = HOTWORDS_SCORE,
        )
        hindiRecognizer = OnlineRecognizer(assetManager = reactApplicationContext.assets, config = config)
        hotwordsUsable = withVocab
        if (!withVocab) android.util.Log.w("SherpaOnnxModule", "No usable $HINDI_VOCAB: Hindi without hotwords")
    }

    /**
     * The Hindi words of the person's own papers, for the Hindi model to
     * listen for. Anything that isn't a short Devanagari word is dropped
     * (SpeechText.hotwordsLine).
     * Resolves how many were kept.
     */
    @ReactMethod
    fun setHotwords(words: ReadableArray, promise: Promise) {
        try {
            val list = (0 until words.size()).mapNotNull { i ->
                if (words.getType(i) == ReadableType.String) words.getString(i) else null
            }
            val line = SpeechText.hotwordsLine(list)
            hotwords = line
            promise.resolve(if (line.isEmpty()) 0 else line.count { it == '/' } + 1)
        } catch (e: Exception) {
            promise.reject("HOTWORDS_ERROR", "Could not set hotwords: ${e.message}", e)
        }
    }

    /** Whisper reads the whole recording at once. */
    private fun transcribeEnglish(rec: OfflineRecognizer, samples: FloatArray): String {
        // C5 fix: stream in try/finally to prevent native leak
        val stream = rec.createStream()
        try {
            stream.acceptWaveform(samples, sampleRate = SAMPLE_RATE)
            rec.decode(stream)
            return rec.getResult(stream)?.text ?: ""
        } finally {
            stream.release()
        }
    }

    /** The Hindi model is fed the whole recording, then a second of silence so it finishes the last word. */
    private fun transcribeHindi(rec: OnlineRecognizer, samples: FloatArray): String {
        val stream = rec.createStream(if (hotwordsUsable) hotwords else "")
        try {
            stream.acceptWaveform(samples, SAMPLE_RATE)
            stream.acceptWaveform(FloatArray(SAMPLE_RATE), SAMPLE_RATE)
            stream.inputFinished()
            while (rec.isReady(stream)) rec.decode(stream)
            return SpeechText.cleanHindiText(rec.getResult(stream).text)
        } finally {
            stream.release()
        }
    }

    @ReactMethod
    fun startRecognition(promise: Promise) {
        if (!isSTTReady || (recognizer == null && hindiRecognizer == null)) {
            promise.reject("STT_NOT_READY", "STT is not initialized yet")
            return
        }
        if (isRecording) {
            promise.reject("ALREADY_RECORDING", "Recording is already in progress")
            return
        }

        if (ActivityCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.RECORD_AUDIO
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            promise.reject("PERMISSION_DENIED", "Microphone permission not granted")
            return
        }

        try {
            val bufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)

            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize * 2
            )

            if (audioRecord?.state != AudioRecord.STATE_INITIALIZED) {
                audioRecord?.release()
                audioRecord = null
                promise.reject("INIT_FAILED", "Failed to initialize AudioRecord")
                return
            }

            recordedData = ByteArrayOutputStream()
            isRecording = true
            audioRecord?.startRecording()

            emitEvent("onSpeechStart", null)

            recordingThread = thread {
                val buffer = ByteArray(bufferSize)
                var lastLevelAt = 0L
                while (isRecording) {
                    val bytesRead = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                    if (bytesRead > 0) {
                        val data = recordedData ?: return@thread
                        synchronized(data) {
                            data.write(buffer, 0, bytesRead)
                        }
                        // The real mic level for the "Listening…" meter, a few times a second.
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (now - lastLevelAt >= LEVEL_INTERVAL_MS) {
                            lastLevelAt = now
                            val level = micLevel(buffer, bytesRead)
                            emitEvent("onSpeechVolume", Arguments.createMap().apply { putDouble("level", level) })
                        }
                    }
                }
            }

            val result = Arguments.createMap().apply {
                putString("status", "recording")
            }
            promise.resolve(result)

        } catch (e: Exception) {
            emitEvent("onSpeechError", "Failed to start recording: ${e.message}")
            promise.reject("RECORDING_ERROR", "Failed to start recording: ${e.message}", e)
        }
    }

    @ReactMethod
    fun stopRecognition(promise: Promise) {
        if (!isRecording) {
            promise.reject("NOT_RECORDING", "No recording in progress")
            return
        }

        thread {
            try {
                isRecording = false
                recordingThread?.join(1000)

                audioRecord?.stop()
                audioRecord?.release()
                audioRecord = null

                val data = recordedData
                val pcmData = if (data != null) {
                    synchronized(data) { data.toByteArray() }
                } else {
                    ByteArray(0)
                }
                recordedData = null

                emitEvent("onSpeechEnd", null)

                // Convert PCM (Int16) to FloatArray
                val shorts = ByteBuffer.wrap(pcmData).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                val floatArray = FloatArray(shorts.capacity())
                for (i in 0 until shorts.capacity()) {
                    floatArray[i] = shorts.get(i).toFloat() / 32768.0f
                }

                // C5 fix: decode under the model lock, so the model can't be freed underneath
                val text = synchronized(modelLock) {
                    val english = recognizer
                    val hindi = hindiRecognizer
                    when {
                        destroyed -> null
                        loadedLanguage == "hi" && hindi != null -> transcribeHindi(hindi, floatArray)
                        english != null -> transcribeEnglish(english, floatArray)
                        else -> null
                    }
                }
                if (text == null) {
                    promise.reject("STT_NOT_READY", "Recognizer destroyed")
                    return@thread
                }

                val args = Arguments.createMap().apply {
                    putArray("value", Arguments.createArray().apply { pushString(text) })
                }
                emitEvent("onSpeechResults", args)
                promise.resolve(text)

            } catch (e: Exception) {
                emitEvent("onSpeechError", "Failed to stop recording: ${e.message}")
                promise.reject("STOP_ERROR", "Failed to stop recording: ${e.message}", e)
            }
        }
    }

    @ReactMethod
    fun cancelRecognition(promise: Promise) {
        try {
            isRecording = false
            recordingThread?.join(500)

            audioRecord?.stop()
            audioRecord?.release()
            audioRecord = null
            recordedData = null

            emitEvent("onSpeechEnd", null)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun isSTTReady(promise: Promise) {
        promise.resolve(isSTTReady)
    }

    // Required by NativeEventEmitter on Android; events are sent regardless.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        // C5 fix: set destroyed BEFORE releasing native resources
        destroyed = true
        isRecording = false
        synchronized(modelLock) { releaseModels() }
        cancelRecognition(PromiseImpl(null, null))
    }
}
