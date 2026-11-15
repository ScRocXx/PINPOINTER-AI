package com.pinpointer.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * SpeechText guards the Hindi model: sherpa-onnx exits the app on a hotword or
 * vocabulary line it can't read, so only clean input may reach it.
 */
class SpeechTextTest {
    @Test
    fun hotwordsKeepOnlyDevanagariWordsOnce() {
        val line = SpeechText.hotwordsLine(listOf(
            " बिजली ", "दवाई", "बिजली", "bill", "बीएसईएस:2.0", "रमेश/कुमार", "#रमेश", "१२३", "राशन  कार्ड", "", "आधार।",
            "क".repeat(41),
        ))
        assertEquals("बिजली/दवाई/राशन कार्ड", line)
    }

    @Test
    fun hotwordsAreCapped() {
        val words = (0 until 500).map { i -> "क" + "ख".repeat(i % 20) + ('ग' + i % 20) + "घ".repeat(i / 20) }
        assertTrue(SpeechText.hotwordsLine(words).split('/').size <= SpeechText.MAX_HOTWORDS)
        assertEquals("", SpeechText.hotwordsLine(emptyList()))
    }

    @Test
    fun hindiTextLosesItsLanguageTag() {
        assertEquals("बिजली का बिल", SpeechText.cleanHindiText("<hi>बिजली का बिल"))
        assertEquals("बिजली बिल", SpeechText.cleanHindiText(" बिजली <hi> बिल  "))
    }

    @Test
    fun onlyWellFormedVocabulariesAreUsed() {
        assertTrue(SpeechText.vocabLooksRight("<blk> -1500\n▁क -1508\n"))
        assertTrue(SpeechText.vocabLooksRight("<blk> -1500\n▁क -1508"))
        assertFalse(SpeechText.vocabLooksRight("<blk> -1500\n\n▁क -1508\n"))
        assertFalse(SpeechText.vocabLooksRight("<blk> -1500\n▁क\n"))
        assertFalse(SpeechText.vocabLooksRight("<blk> abc\n"))
        assertFalse(SpeechText.vocabLooksRight(""))
    }
}
