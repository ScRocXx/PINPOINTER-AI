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
    /** The person's own words come first, at most this many; built-in words fill the rest. */
    const val MAX_OWN_HOTWORDS = 80
    private const val MAX_HOTWORD_CHARS = 40

    /**
     * Boost per token. Names and companies from the person's papers need 1.5
     * ("एल आई सी" became "एलआईसी" at 1.5, not at 1.0). A common word at 1.5
     * does harm: "आधार" turned "आधार कार्ड" into "आधार कार" and "आधा किलो"
     * into "आधार किलो"; at 1.0 it did neither and still helped
     * (research/experiments/hindi-seeds.exp.py).
     */
    const val OWN_SCORE = "1.5"
    const val BUILT_IN_SCORE = "1.0"

    /** Devanagari letters and signs (no digits, no danda), words split by single spaces. */
    private val DEVANAGARI_PHRASE = Regex("[\\u0900-\\u0963\\u0971-\\u097F]+( [\\u0900-\\u0963\\u0971-\\u097F]+)*")
    private val LANGUAGE_TAG = Regex("<(hi|ta|te|ur)>")
    private val SPACES = Regex("\\s+")

    private fun clean(words: List<String>): List<String> =
        words.asSequence()
            .map { it.trim().replace(SPACES, " ") }
            .filter { it.isNotEmpty() && it.length <= MAX_HOTWORD_CHARS && DEVANAGARI_PHRASE.matches(it) }
            .distinct()
            .toList()

    /**
     * Hotwords as sherpa-onnx takes them: "word :score", "/"-separated. Only
     * Devanagari words are let through, so nothing in them can be read as
     * sherpa-onnx's own syntax (":score", "#threshold", "/"); the scores are
     * added here. A word in both lists is a common word: it gets the built-in
     * score.
     */
    fun hotwordsLine(own: List<String>, builtIn: List<String> = emptyList()): String {
        val common = clean(builtIn)
        val commonSet = common.toHashSet()
        val mine = clean(own).filterNot { it in commonSet }.take(MAX_OWN_HOTWORDS)
        return (mine.map { "$it :$OWN_SCORE" } + common.take(MAX_HOTWORDS - mine.size).map { "$it :$BUILT_IN_SCORE" })
            .joinToString("/")
    }

    /** How many hotwords a line from hotwordsLine holds. */
    fun hotwordCount(line: String): Int = if (line.isEmpty()) 0 else line.count { it == '/' } + 1

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
