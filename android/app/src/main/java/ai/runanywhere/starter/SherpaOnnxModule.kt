package ai.runanywhere.starter

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

class SherpaOnnxModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "SherpaOnnxModule"

    // ─── Constants ─────────────────────────────────────────────────────
    companion object {
        const val SAMPLE_RATE = 16000
        const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

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
    private var recognizer: OfflineRecognizer? = null
    private var isSTTReady = false
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

    @ReactMethod
    fun initSTT(promise: Promise) {
        if (!nativeLibLoaded) {
            promise.reject("NATIVE_LIB_ERROR", "sherpa-onnx native library failed to load")
            return
        }
        // H4 fix: prevent re-entry leak — release old model if re-initializing
        if (isSTTReady && recognizer != null) {
            promise.resolve(true)
            return
        }
        thread {
            try {
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
                
                isSTTReady = true
                android.util.Log.i("SherpaOnnxModule", "STT initialized successfully")
                promise.resolve(true)
            } catch (e: Throwable) {
                // Catch Throwable (not just Exception) to handle OutOfMemoryError
                // from loading the ~154 MB whisper model
                isSTTReady = false
                android.util.Log.e("SherpaOnnxModule", "STT init failed: ${e.javaClass.name}: ${e.message}", e)
                promise.reject("STT_INIT_ERROR", "Failed to init STT: ${e.message}", if (e is Exception) e else Exception(e))
            }
        }
    }

    @ReactMethod
    fun startRecognition(promise: Promise) {
        if (!isSTTReady || recognizer == null) {
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
                while (isRecording) {
                    val bytesRead = audioRecord?.read(buffer, 0, buffer.size) ?: 0
                    if (bytesRead > 0) {
                        val data = recordedData ?: return@thread
                        synchronized(data) {
                            data.write(buffer, 0, bytesRead)
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

                // C5 fix: snapshot recognizer to prevent use-after-free
                val rec = recognizer
                if (destroyed || rec == null) {
                    promise.reject("STT_NOT_READY", "Recognizer destroyed")
                    return@thread
                }

                // Convert PCM (Int16) to FloatArray
                val shorts = ByteBuffer.wrap(pcmData).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
                val floatArray = FloatArray(shorts.capacity())
                for (i in 0 until shorts.capacity()) {
                    floatArray[i] = shorts.get(i).toFloat() / 32768.0f
                }

                // C5 fix: stream in try/finally to prevent native leak
                val stream = rec.createStream()
                if (stream != null) {
                    try {
                        stream.acceptWaveform(floatArray, sampleRate = SAMPLE_RATE)
                        rec.decode(stream)
                        val result = rec.getResult(stream)
                        val text = result?.text ?: ""

                        val args = Arguments.createMap().apply {
                            putArray("value", Arguments.createArray().apply { pushString(text) })
                        }
                        emitEvent("onSpeechResults", args)
                        promise.resolve(text)
                    } finally {
                        stream.release()
                    }
                } else {
                    promise.reject("DECODE_ERROR", "Failed to create stream")
                }

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

    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        // C5 fix: set destroyed BEFORE releasing native resources
        destroyed = true
        isRecording = false
        try {
            recognizer?.release()
        } catch (e: Exception) {}
        cancelRecognition(PromiseImpl(null, null))
    }
}
