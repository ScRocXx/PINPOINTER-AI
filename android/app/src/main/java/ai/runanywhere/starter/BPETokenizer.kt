package ai.runanywhere.starter

import android.content.Context
import java.io.BufferedReader
import java.io.InputStreamReader

/**
 * CLIP byte-level BPE tokenizer (port of openai/CLIP simple_tokenizer.py).
 *
 * Vocabulary layout must match the one the text encoder was trained with:
 *   ids 0..255       the 256 byte characters, in bytes_to_unicode() order
 *   ids 256..511     the same characters with "</w>" appended
 *   ids 512..49405   the first 48,894 merges (file lines 1..48894; line 0 is a header)
 *   49406, 49407     <|startoftext|>, <|endoftext|>
 */
class BPETokenizer(context: Context) {
    companion object {
        private const val CONTEXT_LENGTH = 77
        private const val NUM_MERGES = 49152 - 256 - 2
        private const val SOT = "<|startoftext|>"
        private const val EOT = "<|endoftext|>"
    }

    private val bpeRanks = HashMap<Pair<String, String>, Int>(NUM_MERGES * 2)
    private val encoder = HashMap<String, Int>(49408 * 2)
    private val byteEncoder: Map<Int, String>
    private val cache = HashMap<String, String>()

    init {
        val byteOrder = bytesToUnicode()
        byteEncoder = byteOrder.toMap()

        val vocab = ArrayList<String>(49408)
        for ((_, ch) in byteOrder) vocab.add(ch)
        for ((_, ch) in byteOrder) vocab.add("$ch</w>")

        context.assets.open("models/clip/bpe_simple_vocab_16e6.txt").use { stream ->
            val reader = BufferedReader(InputStreamReader(stream, Charsets.UTF_8))
            reader.readLine() // header: "bpe_simple_vocab_16e6.txt#version: 0.2"
            var rank = 0
            while (rank < NUM_MERGES) {
                val line = reader.readLine() ?: break
                val parts = line.trimEnd('\r', '\n').split(" ")
                if (parts.size != 2) continue
                bpeRanks[Pair(parts[0], parts[1])] = rank
                vocab.add(parts[0] + parts[1])
                rank++
            }
        }
        vocab.add(SOT)
        vocab.add(EOT)
        vocab.forEachIndexed { id, token -> encoder[token] = id }

        cache[SOT] = SOT
        cache[EOT] = EOT
    }

    /** bytes_to_unicode(): byte value → printable character, in CLIP's vocabulary order. */
    private fun bytesToUnicode(): List<Pair<Int, String>> {
        val bs = mutableListOf<Int>()
        bs.addAll(33..126)
        bs.addAll(161..172)
        bs.addAll(174..255)
        val cs = bs.toMutableList()
        var n = 0
        for (b in 0 until 256) {
            if (!bs.contains(b)) {
                bs.add(b)
                cs.add(256 + n)
                n++
            }
        }
        return bs.indices.map { i -> bs[i] to cs[i].toChar().toString() }
    }

    private fun bpe(token: String): String {
        cache[token]?.let { return it }

        var word = token.map { it.toString() }.toMutableList()
        if (word.isEmpty()) return token
        word[word.size - 1] = word.last() + "</w>"

        while (word.size >= 2) {
            var bestPair: Pair<String, String>? = null
            var bestRank = Int.MAX_VALUE
            for (i in 0 until word.size - 1) {
                val rank = bpeRanks[Pair(word[i], word[i + 1])]
                if (rank != null && rank < bestRank) {
                    bestRank = rank
                    bestPair = Pair(word[i], word[i + 1])
                }
            }
            if (bestPair == null) break

            val merged = mutableListOf<String>()
            var i = 0
            while (i < word.size) {
                if (i < word.size - 1 && word[i] == bestPair.first && word[i + 1] == bestPair.second) {
                    merged.add(bestPair.first + bestPair.second)
                    i += 2
                } else {
                    merged.add(word[i])
                    i++
                }
            }
            word = merged
        }

        val result = word.joinToString(" ")
        cache[token] = result
        return result
    }

    fun tokenize(text: String): LongArray {
        val cleaned = text.replace(Regex("\\s+"), " ").trim().lowercase()
        val pat = """<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+""".toRegex()

        val ids = mutableListOf<Long>()
        ids.add(encoder.getValue(SOT).toLong())
        for (match in pat.findAll(cleaned)) {
            val bytes = match.value.toByteArray(Charsets.UTF_8)
            val tokenStr = bytes.joinToString("") { byteEncoder.getValue(it.toInt() and 0xFF) }
            for (piece in bpe(tokenStr).split(" ")) {
                encoder[piece]?.let { ids.add(it.toLong()) }
            }
        }

        // Truncate so the end-of-text token always fits (the encoder pools at EOT).
        val body = if (ids.size > CONTEXT_LENGTH - 1) ids.subList(0, CONTEXT_LENGTH - 1) else ids
        val padded = LongArray(CONTEXT_LENGTH)
        body.forEachIndexed { i, id -> padded[i] = id }
        padded[body.size] = encoder.getValue(EOT).toLong()
        return padded
    }
}
