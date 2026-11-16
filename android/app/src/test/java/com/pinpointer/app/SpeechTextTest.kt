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
        assertEquals("बिजली :1.5/दवाई :1.5/राशन कार्ड :1.5", line)
        assertEquals(3, SpeechText.hotwordCount(line))
    }

    @Test
    fun builtInWordsGetTheGentlerBoostEvenWhenThePersonHasThemToo() {
        val line = SpeechText.hotwordsLine(listOf("एलआईसी", "आधार"), listOf("आधार", "गैस", "gas", "गैस"))
        assertEquals("एलआईसी :1.5/आधार :1.0/गैस :1.0", line)
    }

    @Test
    fun hotwordsAreCapped() {
        val own = (0 until 300).map { i -> "क" + "ख".repeat(i % 20) + ('ग' + i % 20) + "घ".repeat(i / 20) }
        val builtIn = (0 until 300).map { i -> "च" + "छ".repeat(i % 20) + ('ज' + i % 20) + "झ".repeat(i / 20) }
        val words = SpeechText.hotwordsLine(own, builtIn).split('/')
        assertEquals(SpeechText.MAX_HOTWORDS, words.size)
        assertEquals(SpeechText.MAX_OWN_HOTWORDS, words.count { it.endsWith(":1.5") })
        assertEquals("", SpeechText.hotwordsLine(emptyList()))
        assertEquals(0, SpeechText.hotwordCount(""))
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
