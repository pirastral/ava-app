"""Ava — Persian TTS engines (Chatterbox-Persian + Piper voices)."""
import os, io, re, sys, tempfile, wave
from pathlib import Path

import requests
import lameenc
import numpy as np

MODELS_DIR = Path.home() / "AvaModels"
MODELS_DIR.mkdir(exist_ok=True)


def _res_path(name: str) -> Path:
    """Path to a bundled resource (works both in dev and PyInstaller)."""
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    return base / name


def read_token() -> str:
    try:
        t = _res_path("token.txt").read_text(encoding="utf-8").strip()
        if t and "PASTE" not in t.upper():
            return t
    except Exception:
        pass
    return ""


def pcm_to_mp3(pcm_int16: np.ndarray, sample_rate: int) -> bytes:
    enc = lameenc.Encoder()
    enc.set_bit_rate(128)
    enc.set_in_sample_rate(sample_rate)
    enc.set_channels(1)
    enc.set_quality(2)
    data = enc.encode(pcm_int16.astype("<i2").tobytes())
    data += enc.flush()
    return bytes(data)


def _download(url: str, dest: Path, status, label: str, headers=None):
    if dest.exists() and dest.stat().st_size > 0:
        return
    status(f"در حال دانلود {label}…")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, headers=headers or {}, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1024 * 512):
                f.write(chunk)
                done += len(chunk)
                if total:
                    status(f"در حال دانلود {label}… ٪{int(done*100/total)}", pct=int(done * 100 / total))
    tmp.rename(dest)


# ----------------------------------------------------------------------------
# Piper voices (mana / gyro / amir) — fast, fully offline after first download
# ----------------------------------------------------------------------------
PIPER_VOICES = {
    "mana": "https://huggingface.co/MahtaFetrat/Mana-Persian-Piper/resolve/main/fa_IR-mana-medium.onnx",
    "gyro": "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/gyro/medium/fa_IR-gyro-medium.onnx",
    "amir": "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx",
}

_piper_cache = {}


def piper_generate(voice_key, text, speed, noise_scale, noise_w, status) -> tuple[bytes, int]:
    url = PIPER_VOICES[voice_key]
    onnx = MODELS_DIR / url.rsplit("/", 1)[-1]
    cfg = MODELS_DIR / (onnx.name + ".json")
    _download(url, onnx, status, f"صدای {voice_key} (~۶۰ مگابایت)")
    _download(url + ".json", cfg, status, "پیکربندی صدا")

    from piper import PiperVoice
    if voice_key not in _piper_cache:
        status("در حال بارگذاری صدا…")
        _piper_cache[voice_key] = PiperVoice.load(str(onnx))
    voice = _piper_cache[voice_key]

    status("در حال ساخت گفتار…")
    length_scale = 1.0 / max(0.25, float(speed))
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    try:
        try:  # piper >= 1.3
            from piper import SynthesisConfig
            sc = SynthesisConfig(length_scale=length_scale,
                                 noise_scale=float(noise_scale),
                                 noise_w_scale=float(noise_w))
            with wave.open(tmp.name, "wb") as wf:
                voice.synthesize_wav(text, wf, syn_config=sc)
        except Exception:  # piper 1.2 API
            with wave.open(tmp.name, "wb") as wf:
                voice.synthesize(text, wf, length_scale=length_scale,
                                 noise_scale=float(noise_scale), noise_w=float(noise_w))
        with wave.open(tmp.name, "rb") as wf:
            sr = wf.getframerate()
            pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    finally:
        os.unlink(tmp.name)
    return pcm_to_mp3(pcm, sr), sr


# ----------------------------------------------------------------------------
# Chatterbox-Persian — highest quality, needs the bundled Hugging Face token
# ----------------------------------------------------------------------------
_chatterbox = None


def _load_chatterbox(status):
    global _chatterbox
    if _chatterbox is not None:
        return _chatterbox
    import torch
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file as load_safetensors
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() \
        else ("cuda" if torch.cuda.is_available() else "cpu")
    status("بار اول: در حال دانلود و بارگذاری مدل چترباکس (حدود ۲ گیگابایت)… چند دقیقه صبر کنید.")

    # torch.load must map to our device on Mac/CPU machines
    _orig_load = torch.load
    def _patched(*a, **k):
        k.setdefault("map_location", torch.device(device))
        return _orig_load(*a, **k)
    torch.load = _patched

    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    token = read_token()
    if not token:
        raise RuntimeError("توکن Hugging Face پیدا نشد — سازندهٔ برنامه باید آن را هنگام ساخت قرار دهد.")
    status("در حال دانلود وزن‌های فارسی…")
    fa_path = hf_hub_download(repo_id="Thomcles/Chatterbox-TTS-Persian-Farsi",
                              filename="t3_fa.safetensors", token=token,
                              cache_dir=str(MODELS_DIR / "hf"))
    model.t3.load_state_dict(load_safetensors(fa_path, device="cpu"))
    model.t3.to(device).eval()
    _chatterbox = model
    return model


def _split_sentences(text, max_len=280):
    parts, buf = [], ""
    for piece in re.split(r"(?<=[\.\!\?؟।؛…\n])\s+", text.strip()):
        if not piece:
            continue
        if len(buf) + len(piece) + 1 <= max_len:
            buf = (buf + " " + piece).strip()
        else:
            if buf:
                parts.append(buf)
            buf = piece if len(piece) <= max_len else piece[:max_len]
    if buf:
        parts.append(buf)
    return parts or [text[:max_len]]


def chatterbox_generate(text, exaggeration, cfg_weight, temperature, status) -> tuple[bytes, int]:
    import torch
    model = _load_chatterbox(status)
    chunks = _split_sentences(text)
    waves = []
    for i, chunk in enumerate(chunks, 1):
        status(f"در حال ساخت گفتار… بخش {i} از {len(chunks)}")
        with torch.no_grad():
            wav = model.generate(chunk, language_id=None,
                                 exaggeration=float(exaggeration),
                                 cfg_weight=float(cfg_weight),
                                 temperature=float(temperature))
        waves.append(wav.squeeze().cpu().numpy())
    audio = np.concatenate(waves)
    pcm = np.clip(audio, -1, 1)
    pcm = (pcm * 32767).astype(np.int16)
    return pcm_to_mp3(pcm, model.sr), model.sr


def generate(payload, status) -> bytes:
    """payload: dict from the UI. Returns MP3 bytes."""
    engine = payload["engine"]
    text = payload["text"].strip()
    if engine == "chatterbox":
        mp3, _ = chatterbox_generate(text, payload.get("exaggeration", 0.5),
                                     payload.get("cfg_weight", 0.5),
                                     payload.get("temperature", 0.8), status)
    else:
        mp3, _ = piper_generate(engine, text, payload.get("speed", 1.0),
                                payload.get("noise", 0.667),
                                payload.get("noisew", 0.8), status)
    return mp3
