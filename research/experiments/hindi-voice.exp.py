"""Hindi voice search end to end, with the app's exact recogniser settings.

Synthesises Hindi search phrases with the Piper Hindi voice (vits-piper-hi_IN-
pratham-medium, run by sherpa-onnx with its sampling noise off, so runs repeat),
then transcribes them with indic-lekhan as SherpaOnnxModule.kt sets it up:
greedy, beam search, and beam search with hotwords; then hotword boosts and
counts against phrases the hotwords must not change. Synthetic speech: a check
that the set-up works and of what hotwords do, not a measure of accuracy.

    .venv/bin/pip install sherpa-onnx==1.13.4 numpy
    .venv/bin/python research/experiments/hindi-voice.exp.py MODEL_DIR TTS_DIR

MODEL_DIR: what download-models.js puts in assets/models/hindi.
TTS_DIR: the extracted vits-piper-hi_IN-pratham-medium release of sherpa-onnx.
Writes results/hindi-voice.json.
"""
import json
import os
import random
import re
import sys
import time

import numpy as np
import sherpa_onnx

here = os.path.dirname(os.path.abspath(__file__))
M, T = sys.argv[1], sys.argv[2]
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    vits=sherpa_onnx.OfflineTtsVitsModelConfig(
        model=f'{T}/hi_IN-pratham-medium.onnx', tokens=f'{T}/tokens.txt', data_dir=f'{T}/espeak-ng-data',
        noise_scale=0.0, noise_scale_w=0.0),
    num_threads=2)))


def recogniser(beam=True, score=1.5, paths=4):
    kw = dict(tokens=f'{M}/tokens.txt', encoder=f'{M}/encoder.int8.onnx', decoder=f'{M}/decoder.int8.onnx',
              joiner=f'{M}/joiner-hi.int8.onnx', num_threads=2, sample_rate=16000, feature_dim=80)
    if beam:
        kw.update(decoding_method='modified_beam_search', max_active_paths=paths, modeling_unit='bpe',
                  bpe_vocab=f'{M}/bpe.vocab', hotwords_score=score)
    return sherpa_onnx.OnlineRecognizer.from_transducer(**kw)


def transcribe(rec, audio, rate, hotwords=''):
    s = rec.create_stream(hotwords) if hotwords else rec.create_stream()
    s.accept_waveform(rate, audio)
    s.accept_waveform(rate, np.zeros(rate, dtype=np.float32))  # a second of silence, as the app does
    s.input_finished()
    while rec.is_ready(s):
        rec.decode_stream(s)
    return re.sub(r'\s+', ' ', re.sub(r'<(hi|ta|te|ur)>', ' ', rec.get_result(s))).strip()


def speak(text):
    g = tts.generate(text, sid=0, speed=1.0)
    return np.array(g.samples, dtype=np.float32), g.sample_rate


names = ['बीएसईएस का बिल', 'अपोलो फार्मेसी की रसीद', 'रमेश कुमार का राशन कार्ड', 'डोलो की गोली']
everyday = ['बिजली का बिल', 'दवाई की पर्ची', 'आधार कार्ड', 'पिछले महीने का बिजली बिल', 'दोनों बिल दिखाओ',
            'उमेश की फोटो', 'गैस सिलेंडर की रसीद', 'बैंक की पासबुक', 'पैन कार्ड की फोटो', 'दिवाली की फोटो',
            'राशन कार्ड', 'बीमा पॉलिसी', 'स्कूल की फीस', 'पानी का बिल', 'डॉक्टर की पर्ची', 'टिकट दिखाओ']
hot = 'बीएसईएस/अपोलो/फार्मेसी/रमेश/राशन/डोलो/पर्ची/रसीद'
audio = {p: speak(p) for p in names + everyday}
out = {'note': 'synthetic speech (Piper Hindi, no sampling noise); not an accuracy measure'}

greedy, beam = recogniser(beam=False), recogniser()
t0 = time.time()
rows = []
for p in names + everyday:
    rows.append({'said': p, 'greedy': transcribe(greedy, *audio[p]), 'beam': transcribe(beam, *audio[p]),
                 'beam_hotwords': transcribe(beam, *audio[p], hot)})
seconds = sum(len(a) / r for a, r in audio.values())
out['real_time_factor_this_cpu_all_three'] = round((time.time() - t0) / seconds, 3)
out['phrases'] = rows
for r in rows:
    print(r)

sweep = []
for score in (1.5, 2.0, 3.0):
    rec = recogniser(score=score)
    changed = [p for p in everyday if transcribe(rec, *audio[p], hot) != transcribe(rec, *audio[p])]
    right = sum(transcribe(rec, *audio[p], hot) == p for p in names)
    sweep.append({'hotwords_score': score, 'names_right': right, 'everyday_changed_by_hotwords': changed})
    print(sweep[-1])
out['boost_sweep'] = sweep

random.seed(7)
pool = [w for w in json.load(open(os.path.join(here, 'data', 'vocab.json'), encoding='utf8'))['hi'][300:6000]
        if len(w) >= 3 and re.fullmatch(r'[ऀ-ॿ]+', w)]
base = {p: transcribe(beam, *audio[p]) for p in everyday}
counts = []
for n in (50, 200, 500, 1000):
    hw = '/'.join(random.sample(pool, n))
    changed = [{'said': p, 'without': base[p], 'with': transcribe(beam, *audio[p], hw)}
               for p in everyday if transcribe(beam, *audio[p], hw) != base[p]]
    counts.append({'hotwords': n, 'everyday_changed': changed})
    print(n, changed)
out['hotword_count'] = counts
os.makedirs(os.path.join(here, 'results'), exist_ok=True)
with open(os.path.join(here, 'results', 'hindi-voice.json'), 'w', encoding='utf8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
