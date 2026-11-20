"""Does sherpa-onnx split a hotword into the same pieces the Hindi model emits?

sherpa-onnx turns each hotword into tokens with simple-sentencepiece: the split
with the highest total score over a piece graph. The Hindi model (indic-lekhan)
uses a BPE vocabulary, which splits words by merge order instead. A hotword only
helps when its pieces are the ones the model emits, so this compares the two on
the common Hindi words of data/vocab.json (make-vocab.py), for several ways of
scoring the pieces in bpe.vocab.

    .venv/bin/pip install sentencepiece
    .venv/bin/python research/experiments/hotword-split.exp.py path/to/bpe.model

(bpe.model: https://huggingface.co/Henil1/indic-lekhan, revision in download-models.js)
Writes results/hotword-split.json.
"""
import json
import os
import sys

import sentencepiece as spm

here = os.path.dirname(os.path.abspath(__file__))
sp = spm.SentencePieceProcessor(model_file=sys.argv[1])
pieces = [sp.id_to_piece(i) for i in range(sp.get_piece_size())]
words = json.load(open(os.path.join(here, 'data', 'vocab.json'), encoding='utf8'))['hi']
by_bytes = {}
for i, p in enumerate(pieces):
    if not (p.startswith('<') and p.endswith('>')):
        by_bytes.setdefault(p.encode('utf8'), i)
maxlen = max(len(b) for b in by_bytes)


def simple_sentencepiece(word, scores):
    """simple-sentencepiece v0.7 (sherpa-onnx 1.13.4): bytes, piece graph, best total score, cut."""
    s = ('▁' + word).encode('utf8')
    n = len(s)
    dag = [[(scores[by_bytes[s[i:i + L]]], i + L) for L in range(1, min(maxlen, n - i) + 1) if s[i:i + L] in by_bytes]
           for i in range(n)]
    route = [None] * (n + 1)
    route[n] = (0.0, 0)
    for i in range(n - 1, -1, -1):
        best, best_end = float('-inf'), -1
        for score, end in dag[i]:
            total = score + route[end][0]
            if total > best or (total == best and best_end >= end):
                best, best_end = total, end
        route[i] = (0.0 if best == float('-inf') else best, best_end)
    out, i = [], 0
    while i < n:
        nxt = route[i][1]
        out.append('<unk>' if nxt == -1 else s[i:nxt].decode('utf8', 'replace'))
        i = i + 1 if nxt == -1 else nxt
    return out


N = len(pieces)
variants = {
    'exported scores (BPE ranks)': [sp.get_score(i) for i in range(N)],
    'fewest pieces': [-1.0] * N,
    'fewest pieces, then earliest merge (shipped)': [-(N + i) for i in range(N)],
}
reference = {w: sp.encode(w, out_type=str) for w in words}
results = {}
for name, scores in variants.items():
    same = sum(simple_sentencepiece(w, scores) == reference[w] for w in words)
    same_top = sum(simple_sentencepiece(w, scores) == reference[w] for w in words[:2000])
    results[name] = {'all': round(same / len(words), 4), 'top_2000': round(same_top / 2000, 4)}
    print(f'{name:46s} all {same / len(words):.1%}   top 2000 {same_top / 2000:.1%}')
os.makedirs(os.path.join(here, 'results'), exist_ok=True)
with open(os.path.join(here, 'results', 'hotword-split.json'), 'w', encoding='utf8') as f:
    json.dump({'words': len(words), 'pieces': N, 'same_split_share': results}, f, ensure_ascii=False, indent=2)
