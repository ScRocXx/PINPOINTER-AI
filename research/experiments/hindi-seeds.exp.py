"""Do built-in hotwords help Hindi voice search, and at what boost?

The Hindi model is given the app's built-in search words (dump-seeds.exp.ts
writes them to results/hindi-seed-words.json) and the person's own words, in
the exact line format SpeechText.kt builds ("word :score/..."). Synthetic
speech (Piper Hindi voice, sampling noise off, three speaking speeds), the
app's recogniser settings. Three sets of phrases:

 - searches: 40 everyday searches that use built-in words;
 - controls: 35 phrases with words that sound like built-in words ("आधा
   किलो", "पक्षी", "कैश") or are plain everyday searches; hotwords must not
   change these;
 - names: searches with names and companies from "the person's papers".

A check of what hotwords do, not a measure of accuracy on real voices.

    npx jest --testMatch '**/research/experiments/dump-seeds.exp.ts'
    .venv/bin/pip install sherpa-onnx==1.13.4 numpy
    .venv/bin/python research/experiments/hindi-seeds.exp.py MODEL_DIR TTS_DIR

Writes results/hindi-seeds.json.
"""
import json
import os
import re
import sys

import numpy as np
import sherpa_onnx

here = os.path.dirname(os.path.abspath(__file__))
M, T = sys.argv[1], sys.argv[2]
seeds = json.load(open(os.path.join(here, 'results', 'hindi-seed-words.json'), encoding='utf8'))
tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    vits=sherpa_onnx.OfflineTtsVitsModelConfig(
        model=f'{T}/hi_IN-pratham-medium.onnx', tokens=f'{T}/tokens.txt', data_dir=f'{T}/espeak-ng-data',
        noise_scale=0.0, noise_scale_w=0.0),
    num_threads=2)))
rec = sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=f'{M}/tokens.txt', encoder=f'{M}/encoder.int8.onnx', decoder=f'{M}/decoder.int8.onnx',
    joiner=f'{M}/joiner-hi.int8.onnx', num_threads=2, sample_rate=16000, feature_dim=80,
    decoding_method='modified_beam_search', max_active_paths=4, modeling_unit='bpe', bpe_vocab=f'{M}/bpe.vocab',
    hotwords_score=1.5)


def transcribe(audio, rate, hotwords=''):
    s = rec.create_stream(hotwords) if hotwords else rec.create_stream()
    s.accept_waveform(rate, audio)
    s.accept_waveform(rate, np.zeros(rate, dtype=np.float32))
    s.input_finished()
    while rec.is_ready(s):
        rec.decode_stream(s)
    return re.sub(r'\s+', ' ', re.sub(r'<(hi|ta|te|ur)>', ' ', rec.get_result(s))).strip()


def line(own, built_in, own_score='1.5', built_in_score='1.0'):
    """SpeechText.hotwordsLine: a word in both lists gets the built-in score."""
    common = set(built_in)
    mine = [w for w in own if w not in common][:80]
    return '/'.join([f'{w} :{own_score}' for w in mine] + [f'{w} :{built_in_score}' for w in built_in[:200 - len(mine)]])


searches = [
    'बिजली का बिल', 'दवाई की पर्ची', 'आधार कार्ड', 'पैन कार्ड की फोटो', 'गैस सिलेंडर की रसीद', 'बैंक की पासबुक',
    'डॉक्टर की पर्ची', 'राशन कार्ड', 'बीमा पॉलिसी', 'पानी का बिल', 'दिवाली की फोटो', 'होली की फोटो', 'शादी की फोटो',
    'पासपोर्ट', 'ड्राइविंग लाइसेंस', 'वोटर कार्ड', 'जन्म प्रमाणपत्र', 'मार्कशीट', 'पेंशन के कागज', 'किराया रसीद',
    'ट्रेन का टिकट', 'अस्पताल की रिपोर्ट', 'जांच की रिपोर्ट', 'मम्मी की फोटो', 'दादी की फोटो', 'मंदिर की फोटो',
    'स्कूल की फीस', 'गाड़ी के कागज', 'जमीन की रजिस्ट्री', 'वेतन पर्ची', 'मोबाइल रिचार्ज', 'पेमेंट का स्क्रीनशॉट',
    'राखी की फोटो', 'दशहरा की फोटो', 'गणपति की फोटो', 'करवा चौथ की फोटो', 'ईद की फोटो', 'क्रिसमस की फोटो',
    'टैक्स के कागज', 'बैंक स्टेटमेंट']
controls = [
    'पक्षी की फोटो', 'कपिल की फोटो', 'कैश की रसीद', 'पान की दुकान', 'आधा किलो चीनी', 'गली की फोटो', 'दोनों बिल दिखाओ',
    'उमेश की फोटो', 'काली गाय की फोटो', 'बाजार की फोटो', 'नानक जी की फोटो', 'पाठशाला की फोटो', 'राजन का पत्र',
    'खेत की फोटो', 'टिकट दिखाओ', 'गोल मेज की फोटो', 'बिल्ली की फोटो', 'कार की फोटो', 'घड़ी की फोटो', 'माल की रसीद',
    'पैर की फोटो', 'पत्ते की फोटो', 'फल की फोटो', 'शाम की फोटो', 'नया फोन', 'बेटे का स्कूल', 'दादा जी का चश्मा',
    'होटल का बिल', 'जूते की रसीद', 'दावत की फोटो', 'रेलगाड़ी की फोटो', 'कल की फोटो', 'पिछले महीने का बिल',
    'सबसे नया बिल', 'आज की फोटो']
names = [
    'बीएसईएस का बिल', 'अपोलो फार्मेसी की रसीद', 'रमेश कुमार का राशन कार्ड', 'डोलो की गोली', 'टाटा पावर का बिल',
    'एयरटेल का बिल', 'जियो का रिचार्ज', 'एलआईसी की पॉलिसी', 'सुरेश की फोटो', 'आधार कार्ड', 'आधा किलो चीनी']
# Words "in the person's papers": names and companies, and common words that are built-in too.
own = ['बीएसईएस', 'अपोलो', 'फार्मेसी', 'रमेश', 'डोलो', 'टाटा', 'पावर', 'एयरटेल', 'जियो', 'एलआईसी', 'सुरेश',
       'आधार', 'बिजली', 'भुगतान', 'राशि', 'दिनांक', 'उपभोक्ता']
SPEEDS = (0.9, 1.0, 1.15)


def speak(phrases):
    out = []
    for p in phrases:
        for speed in SPEEDS:
            g = tts.generate(p, sid=0, speed=speed)
            out.append((p, speed, np.array(g.samples, dtype=np.float32), g.sample_rate))
    return out


def run(utts, variants):
    base = None
    report = {}
    for name, hotwords in variants.items():
        heard = [transcribe(a, r, hotwords) for _, _, a, r in utts]
        base = base or heard
        report[name] = {
            'exactly_right': sum(h == u[0] for h, u in zip(heard, utts)),
            'of': len(utts),
            'fixed': sorted({f'{u[0]}: {b} -> {h}' for u, b, h in zip(utts, base, heard) if h == u[0] != b}),
            'broke': sorted({f'{u[0]}: {b} -> {h}' for u, b, h in zip(utts, base, heard) if b == u[0] != h}),
        }
        print(name, {k: v for k, v in report[name].items() if k != 'fixed'}, 'fixed', len(report[name]['fixed']), flush=True)
    return report


everyday = {'no hotwords': '', 'built-in at 1.5': line([], seeds, built_in_score='1.5'), 'built-in at 1.0 (shipped)': line([], seeds)}
with_names = {
    'no hotwords': '',
    'own words at 1.5, no built-in (before)': line(own, []),
    'own words at 1.5 + built-in at 1.0 (shipped)': line(own, seeds),
    'everything at 1.0': line(own, seeds, own_score='1.0'),
}
out = {
    'note': 'synthetic speech (Piper Hindi, no sampling noise, speeds 0.9/1.0/1.15); not an accuracy measure',
    'built_in_words': len(seeds),
    'searches': run(speak(searches), everyday),
    'controls': run(speak(controls), everyday),
    'names': run(speak(names), with_names),
}
with open(os.path.join(here, 'results', 'hindi-seeds.json'), 'w', encoding='utf8') as f:
    json.dump(out, f, ensure_ascii=False, indent=2)
