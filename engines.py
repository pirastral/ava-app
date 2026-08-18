"""Ava — Persian TTS engines (Chatterbox-Persian + Piper voices + auto-ezafe)."""
import os, json, re, subprocess, sys, tempfile, wave
from pathlib import Path

MODELS_DIR = Path.home() / "AvaModels"
MODELS_DIR.mkdir(exist_ok=True)
# All Hugging Face downloads live permanently in AvaModels/hf — no re-downloads.
os.environ.setdefault("HF_HOME", str(MODELS_DIR / "hf"))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

import requests
import lameenc
import numpy as np


def _res_path(name: str) -> Path:
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


def _download(url: str, dest: Path, status, label: str):
    if dest.exists() and dest.stat().st_size > 0:
        return
    status(f"در حال دانلود {label}…")
    tmp = dest.with_suffix(dest.suffix + ".part")
    with requests.get(url, stream=True, timeout=60) as r:
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


# ---------------------------------------------------------------------------
# Hugging Face download progress → shown as a percentage in the status line
# ---------------------------------------------------------------------------
_hf_hooked = False


def _hook_hf_progress(status):
    global _hf_hooked
    if _hf_hooked:
        return
    try:
        import huggingface_hub
        from huggingface_hub.utils import tqdm as hf_tqdm_mod
        base = hf_tqdm_mod.tqdm

        class StatusTqdm(base):
            def update(self, n=1):
                super().update(n)
                try:
                    if self.total and self.total > 1024 * 1024:  # only real files
                        pct = int(self.n * 100 / self.total)
                        name = (self.desc or "مدل").split("/")[-1][:40]
                        status(f"در حال دانلود {name}… ٪{pct}", pct=pct)
                except Exception:
                    pass

        hf_tqdm_mod.tqdm = StatusTqdm
        for modname in ("file_download", "_snapshot_download"):
            try:
                setattr(getattr(huggingface_hub, modname), "tqdm", StatusTqdm)
            except Exception:
                pass
        _hf_hooked = True
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Automatic ezafe (kasre-ye ezafe) insertion — abreza/persian-ezafe-albert
# ---------------------------------------------------------------------------
_ezafe = None
_PUNCT = "،؛؟!.:…»)\"'٫٬,;"
_DIACRITICS = "\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0654"


def _load_ezafe(status):
    global _ezafe
    if _ezafe is not None:
        return _ezafe
    _hook_hf_progress(status)
    status("در حال آماده‌سازی هوش کسرهٔ اضافه… (بار اول حدود ۷۰ مگابایت دانلود می‌شود)")
    from transformers import AutoTokenizer, AutoModelForTokenClassification
    tok = AutoTokenizer.from_pretrained("abreza/persian-ezafe-albert")
    mdl = AutoModelForTokenClassification.from_pretrained("abreza/persian-ezafe-albert")
    mdl.eval()
    _ezafe = (tok, mdl)
    return _ezafe


def _mark_word(word: str) -> str:
    core = word.rstrip(_PUNCT)
    tail = word[len(core):]
    if not core or core[-1] in _DIACRITICS:
        return word
    last = core[-1]
    if last == "ه":
        add = "\u0654"          # هٔ
    elif last in "اآو":
        add = "ی"               # پایِ / پای
    elif last == "ی":
        add = ""                # ezafe already sounds through the final ye
    else:
        add = "\u0650"          # کسره
    return core + add + tail


def ezafe_apply(text: str, status) -> str:
    try:
        import torch
        tok, mdl = _load_ezafe(status)
        status("در حال حرکت‌گذاری خودکار متن…")
        out_lines = []
        for line in text.split("\n"):
            words = line.split()
            if not words:
                out_lines.append(line)
                continue
            marked = list(words)
            for start in range(0, len(words), 150):
                batch = words[start:start + 150]
                enc = tok(batch, is_split_into_words=True, return_tensors="pt",
                          truncation=True, max_length=512)
                with torch.no_grad():
                    pred = mdl(**enc).logits.argmax(-1)[0].tolist()
                wids = enc.word_ids(0)
                flagged = set()
                for i, w in enumerate(wids):
                    if w is not None and pred[i] == 1:
                        flagged.add(w)
                for w in flagged:
                    marked[start + w] = _mark_word(marked[start + w])
            out_lines.append(" ".join(marked))
        return "\n".join(out_lines)
    except Exception:
        status("حرکت‌گذاری خودکار در دسترس نبود — متن بدون تغییر خوانده می‌شود.")
        return text


# ---------------------------------------------------------------------------
# Piper voices — synthesized in a separate helper process so a native failure
# can never close the app; instead the error text is shown in the window.
# ---------------------------------------------------------------------------
PIPER_VOICES = {
    "mana": "https://huggingface.co/MahtaFetrat/Mana-Persian-Piper/resolve/main/fa_IR-mana-medium.onnx",
    "gyro": "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/gyro/medium/fa_IR-gyro-medium.onnx",
    "amir": "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx",
}


def piper_worker_main(task_path: str) -> None:
    """Runs inside the helper process."""
    task = json.loads(Path(task_path).read_text(encoding="utf-8"))
    from piper import PiperVoice
    kwargs = {}
    bundled = _res_path("piper") / "espeak-ng-data"
    if bundled.is_dir():
        kwargs["espeak_data_dir"] = str(bundled)
    voice = PiperVoice.load(task["onnx"], **kwargs)
    length_scale = 1.0 / max(0.25, float(task["speed"]))
    with wave.open(task["out"], "wb") as wf:
        try:
            from piper import SynthesisConfig
            sc = SynthesisConfig(length_scale=length_scale,
                                 noise_scale=float(task["noise"]),
                                 noise_w_scale=float(task["noisew"]))
            voice.synthesize_wav(task["text"], wf, syn_config=sc)
        except ImportError:
            voice.synthesize(task["text"], wf, length_scale=length_scale,
                             noise_scale=float(task["noise"]), noise_w=float(task["noisew"]))


def piper_generate(voice_key, text, speed, noise_scale, noise_w, status):
    url = PIPER_VOICES[voice_key]
    onnx = MODELS_DIR / url.rsplit("/", 1)[-1]
    _download(url, onnx, status, f"صدای {voice_key} (~۶۰ مگابایت)")
    _download(url + ".json", Path(str(onnx) + ".json"), status, "پیکربندی صدا")

    status("در حال ساخت گفتار…")
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); out.close()
    taskf = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w", encoding="utf-8")
    json.dump({"onnx": str(onnx), "text": text, "speed": speed,
               "noise": noise_scale, "noisew": noise_w, "out": out.name}, taskf)
    taskf.close()
    try:
        creation = {"creationflags": 0x08000000} if os.name == "nt" else {}
        proc = subprocess.run([sys.executable, "--piper-worker", taskf.name],
                              capture_output=True, timeout=600, **creation)
        if proc.returncode != 0:
            tail = (proc.stderr or b"").decode("utf-8", "ignore").strip().splitlines()[-6:]
            raise RuntimeError("موتور صدای سبک خطا داد:\n" + "\n".join(tail) if tail
                              else f"موتور صدای سبک با کد {proc.returncode} بسته شد (خطای داخلی).")
        with wave.open(out.name, "rb") as wf:
            sr = wf.getframerate()
            pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
        if len(pcm) == 0:
            raise RuntimeError("خروجی صدا خالی بود — دوباره امتحان کنید.")
        return pcm_to_mp3(pcm, sr), sr
    finally:
        for p in (out.name, taskf.name):
            try:
                os.unlink(p)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Chatterbox-Persian — cached permanently in AvaModels/hf
# ---------------------------------------------------------------------------
_chatterbox = None


def _hf_cached(name_fragment: str) -> bool:
    hub = MODELS_DIR / "hf" / "hub"
    return hub.is_dir() and any(name_fragment.lower() in p.name.lower() for p in hub.iterdir())


def _load_chatterbox(status):
    global _chatterbox
    if _chatterbox is not None:
        return _chatterbox
    import torch
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file as load_safetensors
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    _hook_hf_progress(status)
    device = "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() \
        else ("cuda" if torch.cuda.is_available() else "cpu")
    if _hf_cached("chatterbox"):
        status("در حال بارگذاری مدل چترباکس از حافظهٔ دستگاه… (۱ تا ۲ دقیقه)")
    else:
        status("فقط بار اول: در حال دانلود مدل چترباکس (حدود ۲ گیگابایت)… از این پس روی دستگاه می‌ماند.")

    _orig_load = torch.load
    def _patched(*a, **k):
        k.setdefault("map_location", torch.device(device))
        return _orig_load(*a, **k)
    torch.load = _patched

    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    token = read_token()
    if not token:
        raise RuntimeError("توکن Hugging Face در برنامه نیست — باید هنگام ساخت قرار داده شود.")
    status("در حال آماده‌سازی صدای فارسی…")
    fa_path = hf_hub_download(repo_id="Thomcles/Chatterbox-TTS-Persian-Farsi",
                              filename="t3_fa.safetensors", token=token)
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


def chatterbox_generate(text, exaggeration, cfg_weight, temperature, status):
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
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    return pcm_to_mp3(pcm, model.sr), model.sr


def generate(payload, status) -> bytes:
    engine = payload["engine"]
    text = payload["text"].strip()
    if payload.get("ezafe", True):
        text = ezafe_apply(text, status)
    if engine == "chatterbox":
        mp3, _ = chatterbox_generate(text, payload.get("exaggeration", 0.5),
                                     payload.get("cfg_weight", 0.5),
                                     payload.get("temperature", 0.8), status)
    else:
        mp3, _ = piper_generate(engine, text, payload.get("speed", 1.0),
                                payload.get("noise", 0.667),
                                payload.get("noisew", 0.8), status)
    return mp3
