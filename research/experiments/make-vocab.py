"""Builds data/vocab.json (top Hindi and English words) for the experiments.

The word lists come from the `wordfreq` package (its data is CC-BY-SA 4.0), so
they are generated here instead of committed:

    python3 -m venv .venv && .venv/bin/pip install wordfreq
    .venv/bin/python research/experiments/make-vocab.py
"""
import json
import os

import wordfreq

here = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(here, 'data'), exist_ok=True)
vocab = {'hi': wordfreq.top_n_list('hi', 30000), 'en': wordfreq.top_n_list('en', 30000)}
with open(os.path.join(here, 'data', 'vocab.json'), 'w', encoding='utf-8') as f:
    json.dump(vocab, f, ensure_ascii=False)
print({k: len(v) for k, v in vocab.items()})
