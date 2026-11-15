package com.pinpointer.app

/**
 * The text around speech recognition, kept apart from the native module so it
 * can be checked on a plain JVM: the hotwords the Hindi model is given, its
 * text without the language tag, and whether a BPE vocabulary is safe to load.
 */
object SpeechText {
    /**
     * Up to 200 hotwords changed nothing on 16 everyday queries in two runs on
     * synthetic speech; at 500 one turned "पर्ची" into "पारची"
     * (research/experiments/hindi-voice.exp.py).
     */
    const val MAX_HOTWORDS = 200
    private const val MAX_HOTWORD_CHARS = 40

    /** Devanagari letters and signs (no digits, no danda), words split by single spaces. */
    private val DEVANAGARI_PHRASE = Regex("[\\u0900-\\u0963\\u0971-\\u097F]+( [\\u0900-\\u0963\\u0971-\\u097F]+)*")
    private val LANGUAGE_TAG = Regex("<(hi|ta|te|ur)>")
    private val SPACES = Regex("\\s+")

    /**
     * Hotwords as sherpa-onnx takes them, "/"-separated. Only Devanagari
     * words, so nothing in them can be read as sherpa-onnx's own syntax
     * (":score", "#threshold", "/").
     */
    fun hotwordsLine(words: List<String>): String =
        words.asSequence()
            .map { it.trim().replace(SPACES, " ") }
            .filter { it.isNotEmpty() && it.length <= MAX_HOTWORD_CHARS && DEVANAGARI_PHRASE.matches(it) }
            .distinct()
            .take(MAX_HOTWORDS)
            .joinToString("/")

    /** The Hindi model's text without its language tag ("<hi>"). */
    fun cleanHindiText(text: String): String =
        text.replace(LANGUAGE_TAG, " ").replace(SPACES, " ").trim()

    /**
     * True when every line is "piece score": sherpa-onnx exits the whole app
     * on a vocabulary line it can't read, so a broken file is never loaded.
     */
    fun vocabLooksRight(text: String): Boolean {
        val lines = text.split('\n').let { if (it.lastOrNull()?.isEmpty() == true) it.dropLast(1) else it }
        return lines.isNotEmpty() && lines.all { line ->
            val parts = line.split(' ', '\t').filter { it.isNotEmpty() }
            parts.size == 2 && parts[1].toFloatOrNull() != null
        }
    }
}
