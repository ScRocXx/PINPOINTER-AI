#!/usr/bin/env python3
"""
export_mobileclip.py — Export MobileCLIP2-S0 to the INT8 ONNX models the app loads.

Run on a dev machine (not on Android), Python 3.10+:
  pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
  pip install open_clip_torch timm onnx onnxruntime onnxscript pillow

torch and torchvision must come from the same index: with only torch from the
CPU index, pip pulls a torchvision built for a different torch and the script
stops with "operator torchvision::nms does not exist".

Usage:
  python scripts/export_mobileclip.py
  python scripts/export_mobileclip.py --checkpoint checkpoints/mobileclip2_s0.pt
  python scripts/export_mobileclip.py --test-images path/to/photos

Without --checkpoint, OpenCLIP downloads Apple's MobileCLIP2-S0 weights
(pretrained tag 'dfndr2b', huggingface.co/timm/MobileCLIP2-S0-OpenCLIP).
--checkpoint takes the .pt file from huggingface.co/apple/MobileCLIP2-S0.

Writes to android/app/src/main/assets/models/clip/ (gitignored), which is
where MobileCLIPModule.kt and BPETokenizer.kt read them:
  vision_encoder_int8.onnx    pixel_values [N,3,256,256] float32, RGB in 0..1
                              (no mean/std normalisation) -> image_embeds [N,512]
  text_encoder_int8.onnx      input_ids [N,77] int64, zero padded -> text_embeds [N,512]
  bpe_simple_vocab_16e6.txt   CLIP BPE merges (OpenCLIP's vocab, uncompressed)

Embeddings are not L2-normalised; the app normalises them.

Only the layers that survive INT8 are quantized (see vision_nodes_to_quantize
and TEXT_NODES_TO_EXCLUDE), so the files are ~28 MB (image) and ~68 MB (text).
The script checks the INT8 models against the PyTorch model and exits with an
error if the embeddings drift too far. The app uses onnxruntime-android 1.20:
if you change the quantization, also load the models with
`pip install onnxruntime==1.20.1` before shipping, since newer onnxruntime
versions accept ops that 1.20 can't run.
"""

import argparse
import gzip
import os
import shutil
import sys
import tempfile

import numpy as np
import torch

MODEL_NAME = 'MobileCLIP2-S0'
PRETRAINED_TAG = 'dfndr2b'
IMAGE_SIZE = 256
CONTEXT_LENGTH = 77
OPSET = 17

# Lowest acceptable cosine similarity between PyTorch and INT8 ONNX embeddings.
MIN_IMAGE_COSINE = 0.99
MIN_TEXT_COSINE = 0.99

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DEFAULT_OUT = os.path.join(REPO_ROOT, 'android', 'app', 'src', 'main', 'assets', 'models', 'clip')

TEST_PROMPTS = [
    'a photo of a cat', 'two cats sleeping on a couch', 'a bear in the grass',
    'a stop sign', 'a bedroom', 'a person skiing', 'a diagram', 'a chart',
    'a receipt', 'an invoice', 'aadhaar card', 'a passport', 'a screenshot of a chat',
    'a selfie', 'food on a plate', 'a car on the road', 'mountains at sunset',
    'a handwritten note', 'a birthday party', 'a dog playing in the park',
]


class ImageEncoder(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, pixel_values):
        return self.model.encode_image(pixel_values)


class TextEncoder(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids):
        return self.model.encode_text(input_ids)


def load_model(checkpoint):
    import open_clip
    from timm.utils import reparameterize_model

    pretrained = checkpoint or PRETRAINED_TAG
    # MobileCLIP2-S0 takes raw 0..1 pixels; a local checkpoint doesn't carry that.
    model, _, preprocess = open_clip.create_model_and_transforms(
        MODEL_NAME, pretrained=pretrained, image_mean=(0.0, 0.0, 0.0), image_std=(1.0, 1.0, 1.0))
    tokenizer = open_clip.get_tokenizer(MODEL_NAME)
    model.eval()

    # Merge the multi-branch (MobileOne / RepMixer) blocks into single convs.
    # The exported graph is only correct after this step.
    n_before = sum(p.numel() for p in model.parameters())
    model = reparameterize_model(model)
    n_after = sum(p.numel() for p in model.parameters())
    print(f'  Reparameterized: {n_before / 1e6:.1f}M -> {n_after / 1e6:.1f}M parameters')
    if n_after >= n_before:
        print('  WARNING: reparameterization did not change the model')
    return model, preprocess, tokenizer


def export_onnx(module, dummy, path, input_name, output_name):
    # The exporter restores the wrapper's training flag afterwards, and a new
    # nn.Module starts in train mode: without eval() here the model is left in
    # train mode, and its BatchNorm layers then give wrong reference outputs.
    module.eval()
    with torch.no_grad():
        torch.onnx.export(
            module, (dummy,), path,
            input_names=[input_name], output_names=[output_name],
            dynamic_axes={input_name: {0: 'batch'}, output_name: {0: 'batch'}},
            opset_version=OPSET, do_constant_folding=True, dynamo=False,
        )
    print(f'  Saved {os.path.basename(path)} ({os.path.getsize(path) / 1e6:.1f} MB)')


def weight_nodes(model_path, op_types):
    """Names of nodes of op_types whose second input is a constant weight."""
    import onnx

    graph = onnx.load(model_path, load_external_data=False).graph
    consts = {i.name for i in graph.initializer}
    return [n.name for n in graph.node
            if n.op_type in op_types and len(n.input) > 1 and n.input[1] in consts]


def vision_nodes_to_quantize(model_path):
    # Dynamic INT8 on every Conv wrecks the image encoder (cosine ~0 vs
    # PyTorch): the stem, downsample and depthwise convs can't take it. Only
    # quantize attention (MatMul), the head (Gemm) and the MLP expansion
    # 1x1 convs (fc1); the rest stays FP32.
    nodes = weight_nodes(model_path, ('MatMul', 'Gemm'))
    nodes += [n for n in weight_nodes(model_path, ('Conv',)) if n.endswith('mlp/fc1/Conv')]
    assert len(nodes) > 20, f'node names changed? only {len(nodes)} vision nodes matched'
    return nodes


# The first block's MLP output projection sees large activation outliers;
# quantizing it alone drops text cosine to ~0.93. Every other layer is fine.
TEXT_NODES_TO_EXCLUDE = ['/text/transformer/resblocks.0/mlp/c_proj/MatMul']


def quantize(src, dst, weight_type, nodes_to_quantize=None, nodes_to_exclude=None):
    from onnxruntime.quantization import quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process

    prepped = src.replace('.onnx', '_prep.onnx')
    quant_pre_process(src, prepped, skip_symbolic_shape=True)
    if nodes_to_exclude:
        names = set(weight_nodes(prepped, ('MatMul',)))
        missing = [n for n in nodes_to_exclude if n not in names]
        assert not missing, f'node names changed? not found: {missing}'
    quantize_dynamic(prepped, dst, weight_type=weight_type, per_channel=True,
                     nodes_to_quantize=nodes_to_quantize(prepped) if nodes_to_quantize else None,
                     nodes_to_exclude=nodes_to_exclude)
    os.remove(prepped)
    print(f'  Saved {os.path.basename(dst)} ({os.path.getsize(dst) / 1e6:.1f} MB)')


def load_test_images(preprocess, folder):
    from PIL import Image

    tensors, names = [], []
    if folder:
        for name in sorted(os.listdir(folder)):
            if name.lower().endswith(('.jpg', '.jpeg', '.png', '.webp')):
                tensors.append(preprocess(Image.open(os.path.join(folder, name)).convert('RGB')))
                names.append(name)
    rng = np.random.default_rng(0)
    for i in range(4):
        noise = (rng.random((IMAGE_SIZE, IMAGE_SIZE, 3)) * 255).astype(np.uint8)
        tensors.append(preprocess(Image.fromarray(noise)))
        names.append(f'noise-{i}')
    return torch.stack(tensors), names


def cosine(a, b):
    a = a / np.linalg.norm(a, axis=-1, keepdims=True)
    b = b / np.linalg.norm(b, axis=-1, keepdims=True)
    return (a * b).sum(-1)


def verify(model, tokenizer, preprocess, vision_path, text_path, test_images):
    import onnxruntime as ort

    images, names = load_test_images(preprocess, test_images)
    tokens = tokenizer(TEST_PROMPTS)
    assert tokens.shape[1] == CONTEXT_LENGTH, tokens.shape

    model.eval()
    with torch.no_grad():
        ref_img = model.encode_image(images).numpy()
        ref_txt = model.encode_text(tokens).numpy()

    vision = ort.InferenceSession(vision_path, providers=['CPUExecutionProvider'])
    text = ort.InferenceSession(text_path, providers=['CPUExecutionProvider'])
    # The app runs one item at a time, so check batch size 1.
    onnx_img = np.concatenate([vision.run(None, {'pixel_values': images[i:i + 1].numpy()})[0]
                               for i in range(len(images))])
    onnx_txt = np.concatenate([text.run(None, {'input_ids': tokens[i:i + 1].numpy().astype(np.int64)})[0]
                               for i in range(len(tokens))])

    img_cos = cosine(ref_img, onnx_img)
    txt_cos = cosine(ref_txt, onnx_txt)
    print(f'  Image embeddings: dim {onnx_img.shape[1]}, cosine vs PyTorch min {img_cos.min():.4f} mean {img_cos.mean():.4f}')
    print(f'  Text embeddings:  dim {onnx_txt.shape[1]}, cosine vs PyTorch min {txt_cos.min():.4f} mean {txt_cos.mean():.4f}')

    # Same top match for each real image, PyTorch vs INT8.
    real = [i for i, n in enumerate(names) if not n.startswith('noise-')]
    agree = 0
    for i in real:
        ref_best = int(np.argmax(cosine(ref_img[i:i + 1], ref_txt)))
        onnx_best = int(np.argmax(cosine(onnx_img[i:i + 1], onnx_txt)))
        agree += ref_best == onnx_best
        print(f'    {names[i]}: "{TEST_PROMPTS[onnx_best]}"'
              + ('' if ref_best == onnx_best else f' (PyTorch: "{TEST_PROMPTS[ref_best]}")'))
    if real:
        print(f'  Top match agrees on {agree}/{len(real)} images')

    ok = img_cos.min() >= MIN_IMAGE_COSINE and txt_cos.min() >= MIN_TEXT_COSINE
    return ok


def write_vocab(out_dir):
    import open_clip.tokenizer as oc_tok

    src = os.path.join(os.path.dirname(oc_tok.__file__), 'bpe_simple_vocab_16e6.txt.gz')
    dst = os.path.join(out_dir, 'bpe_simple_vocab_16e6.txt')
    with gzip.open(src, 'rb') as f_in, open(dst, 'wb') as f_out:
        shutil.copyfileobj(f_in, f_out)
    print(f'  Saved {os.path.basename(dst)} ({os.path.getsize(dst) / 1e6:.1f} MB)')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--checkpoint', help='local mobileclip2_s0.pt (default: download via OpenCLIP)')
    parser.add_argument('--out', default=DEFAULT_OUT, help='output folder (default: app assets)')
    parser.add_argument('--test-images', help='folder of photos to check the INT8 models against')
    parser.add_argument('--keep-fp32', action='store_true', help='also keep the FP32 ONNX models')
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    work = tempfile.mkdtemp(prefix='mobileclip-export-')

    print(f'[1/5] Loading {MODEL_NAME} and reparameterizing...')
    model, preprocess, tokenizer = load_model(args.checkpoint)

    print('[2/5] Exporting FP32 ONNX encoders...')
    vision_fp32 = os.path.join(work, 'vision_encoder.onnx')
    text_fp32 = os.path.join(work, 'text_encoder.onnx')
    export_onnx(ImageEncoder(model), torch.rand(1, 3, IMAGE_SIZE, IMAGE_SIZE),
                vision_fp32, 'pixel_values', 'image_embeds')
    export_onnx(TextEncoder(model), tokenizer(['a photo of a cat']),
                text_fp32, 'input_ids', 'text_embeds')

    print('[3/5] Quantizing to INT8 (dynamic, per-channel weights)...')
    from onnxruntime.quantization import QuantType
    vision_int8 = os.path.join(args.out, 'vision_encoder_int8.onnx')
    text_int8 = os.path.join(args.out, 'text_encoder_int8.onnx')
    # The app ships onnxruntime-android 1.20, whose ConvInteger kernel only
    # takes uint8 weights (int8 weights fail to load with NOT_IMPLEMENTED).
    quantize(vision_fp32, vision_int8, QuantType.QUInt8, nodes_to_quantize=vision_nodes_to_quantize)
    quantize(text_fp32, text_int8, QuantType.QInt8, nodes_to_exclude=TEXT_NODES_TO_EXCLUDE)

    print('[4/5] Writing tokenizer vocabulary...')
    write_vocab(args.out)

    print('[5/5] Checking INT8 models against PyTorch...')
    ok = verify(model, tokenizer, preprocess, vision_int8, text_int8, args.test_images)

    if args.keep_fp32:
        shutil.copy(vision_fp32, args.out)
        shutil.copy(text_fp32, args.out)
    shutil.rmtree(work, ignore_errors=True)

    if not ok:
        print(f'\nFAILED: INT8 embeddings drifted below the limits '
              f'(image {MIN_IMAGE_COSINE}, text {MIN_TEXT_COSINE}).')
        sys.exit(1)
    print(f'\nDone. Models are in {args.out}')


if __name__ == '__main__':
    main()
