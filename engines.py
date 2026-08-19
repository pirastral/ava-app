"""Ava — Persian TTS engines (Chatterbox-Persian + Piper voices + auto-ezafe)."""
import os, json, re, shutil, subprocess, sys, tempfile, wave
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
_PUNCT = "\u060c\u061b\u061f!.:\u2026\u00bb)\"'\u066b\u066c,;"
_DIACRITICS = "\u064b\u064c\u064d\u064e\u064f\u0650\u0651\u0652\u0654"
_KEYS_FILE = MODELS_DIR / "ezafe_keys.json"

_LLM_PROMPT = (
    "You are a Persian (Farsi) diacritization engine for Iranian text-to-speech. "
    "First read and fully comprehend the ENTIRE text - meaning, grammar, context - before deciding anything. "
    "WHAT TO MARK: "
    "(1) kasre-ye ezafe (\u0650) wherever a word links to the next (\u0647\u0654 after final \u0647\u060c "
    "\u06cc after final \u0627/\u0648) - the main task, never skipped; "
    "(2) homographs, resolved from context (\u06a9\u0650\u0634\u062a\u06cc/\u06a9\u064f\u0634\u062a\u06cc\u060c "
    "\u06af\u064f\u0644/\u06af\u0650\u0644\u060c \u0645\u0650\u0647\u0631/\u0645\u064f\u0647\u0631); "
    "(3) any word a Persian TTS would plausibly misread: uncommon, poetic, fused "
    "(\u06a9\u0632 + \u0627\u06cc\u0646 = \u06a9\u064e\u0632\u06cc\u0646\u0652), foreign, or "
    "morphologically unusual words. Everyday words in their default reading stay bare inside "
    "(\u0628\u0647 the preposition\u060c \u0645\u0646\u060c \u0627\u0633\u062a) - but "
    "\u0628\u0650\u0647 the quince or \u0628\u064e\u0647\u200c\u0628\u064e\u0647 the exclamation get marked. "
    "RULES OVER EXAMPLES: every example in these instructions is an illustration of a rule, never a "
    "pattern to copy. The SAME written word takes DIFFERENT marks in different contexts: "
    "\u0646\u06af\u0630\u0631\u062f is \u0646\u064e\u06af\u064f\u0630\u064e\u0631\u064e\u062f "
    "in ordinary prose but \u0646\u064e\u06af\u0652\u0630\u064e\u0631\u064e\u062f inside the Ferdowsi "
    "meter. Always derive the marks from how THIS word is actually pronounced in THIS sentence - from its "
    "syllables, meaning and register - never from a remembered example, including the ones written here. "
    "HOW TO MARK - two absolute laws: "
    "COMPLETENESS LAW: when you vocalize a word, vocalize it COMPLETELY and syllable-accurately. Work out its "
    "syllables first; every consonant not followed by a vowel takes sukun (\u0652), INCLUDING WORD-MEDIAL "
    "consonant clusters: \u0628\u064e\u0631\u0646\u064e\u06af\u0652\u0630\u064e\u0631\u064e\u062f "
    "carries sukun on \u06af mid-word THERE because the meter closes that syllable - the law is the syllable "
    "analysis, not that word. A half-marked word misleads the TTS more than a bare one - never leave "
    "a word partially vocalized. "
    "ENDINGS LAW: for every word you mark, decide its final sound explicitly. A word ending on a closed "
    "consonant gets a final sukun so the TTS cannot invent a trailing vowel "
    "(\u06a9\u064e\u0632\u06cc\u0646\u0652, not \u06a9\u0632\u06cc\u0646 which gets misread as "
    "\u06a9\u0632\u06cc\u0646\u0650); a word linking forward gets the ezafe of rule (1); word-final "
    "\u0647 reads as e. "
    "NEVER insert internal marks that create a wrong reading of a well-known word: "
    "\u062e\u062f\u0627\u0648\u0646\u062f stays internally bare - correct is "
    "\u062e\u062f\u0627\u0648\u0646\u062f\u0650 \u062c\u0627\u0646 (bare inside, ezafe at the end); "
    "'bare' means internal letters only, the ezafe still applies. "
    "Classical verse MUST follow its established recitation and meter (\u0648\u0632\u0646): "
    "\u0628\u0647 \u0646\u0627\u0645\u0650 \u062e\u062f\u0627\u0648\u0646\u062f\u0650 "
    "\u062c\u0627\u0646 \u0648 \u062e\u0650\u0631\u064e\u062f / \u06a9\u064e\u0632\u06cc\u0646\u0652 "
    "\u0628\u064e\u0631\u062a\u064e\u0631 \u0627\u0646\u062f\u06cc\u0634\u0647 "
    "\u0628\u064e\u0631\u0646\u064e\u06af\u0652\u0630\u064e\u0631\u064e\u062f. "
    "Dialect: formal Iranian standard Persian (Tehran), never Dari/Afghan or Tajik; "
    "preserve existing marks; never change, add, remove or reorder any word, letter, digit, punctuation or "
    "line break. Return ONLY the text.\n"
    "Example input: \u06a9\u062a\u0627\u0628 \u0645\u0646 \u0631\u0648\u06cc \u0645\u06cc\u0632 "
    "\u0686\u0648\u0628\u06cc \u0627\u0633\u062a \u0648 \u06af\u0644 \u0633\u0631\u062e \u0631\u0627 "
    "\u06a9\u0646\u0627\u0631 \u06a9\u0634\u062a\u06cc \u062f\u06cc\u062f\u0645.\n"
    "Example output: \u06a9\u062a\u0627\u0628\u0650 \u0645\u0646 \u0631\u0648\u06cc\u0650 "
    "\u0645\u06cc\u0632\u0650 \u0686\u0648\u0628\u06cc \u0627\u0633\u062a \u0648 \u06af\u064f\u0644\u0650 "
    "\u0633\u0631\u062e \u0631\u0627 \u06a9\u0646\u0627\u0631\u0650 \u06a9\u0650\u0634\u062a\u06cc "
    "\u062f\u06cc\u062f\u0645."
)


def save_key(tool: str, key: str):
    try:
        data = {}
        if _KEYS_FILE.exists():
            data = json.loads(_KEYS_FILE.read_text(encoding="utf-8"))
        data[tool] = key
        _KEYS_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception:
        pass


def load_key(tool: str) -> str:
    try:
        return json.loads(_KEYS_FILE.read_text(encoding="utf-8")).get(tool, "")
    except Exception:
        return ""


def _load_ezafe(status):
    global _ezafe
    if _ezafe is not None:
        return _ezafe
    _hook_hf_progress(status)
    status("در حال آماده‌سازی مدل محلی حرکت‌گذاری… (بار اول حدود ۷۰ مگابایت دانلود می‌شود)")
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
    if last == "\u0647":
        add = "\u0654"
    elif last in "\u0627\u0622\u0648":
        add = "\u06cc"
    elif last == "\u06cc":
        add = ""
    else:
        add = "\u0650"
    return core + add + tail


def _ezafe_local(text: str, status) -> str:
    import torch
    tok, mdl = _load_ezafe(status)
    status("در حال حرکت‌گذاری با مدل محلی…")
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
            for i, w in enumerate(wids):
                if w is not None and pred[i] == 1:
                    marked[start + w] = _mark_word(marked[start + w])
        out_lines.append(" ".join(marked))
    return "\n".join(out_lines)


def _llm_chunks(text, max_len=4000):
    return _split_sentences(text, max_len=max_len)


_MARKS_RE = re.compile(r"[\u064b-\u0655\u0670]")
_DIRCTRL_RE = re.compile(r"[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00ad]")


def _clean_llm(s: str) -> str:
    """Normalize LLM output: no code fences, no invisible direction chars,
    and every diacritic must sit directly on a real letter."""
    s = s.strip()
    if s.startswith("```"):
        s = re.sub(r"^```[^\n]*\n?", "", s)
        s = re.sub(r"\n?```$", "", s.strip())
    s = _DIRCTRL_RE.sub("", s)
    out = []
    for ch in s:
        if _MARKS_RE.match(ch):
            if not out:
                continue
            p = out[-1]
            if not ("\u0621" <= p <= "\u064a" or "\u066e" <= p <= "\u06d3" or _MARKS_RE.match(p)):
                continue  # orphaned mark (after space/ZWNJ/punct) — drop it
        out.append(ch)
    return "".join(out)


def _skeleton(s: str) -> str:
    """The letters of the text with all diacritics removed — must never change."""
    return re.sub(r"\s+", " ", _MARKS_RE.sub("", s)).strip()


def _llm_map(text, status, label, call_one):
    """Run chunks through the LLM with a hard letter-integrity guard:
    if the model altered any letter, retry once; if it alters again,
    keep that chunk unchanged rather than accept corrupted text."""
    chunks = _llm_chunks(text)
    out = []
    for i, ch in enumerate(chunks, 1):
        status(f"حرکت‌گذاری با {label}… بخش {i} از {len(chunks)}")
        t = _clean_llm(call_one(ch))
        if _skeleton(t) != _skeleton(ch):
            t = _clean_llm(call_one(ch))
            if _skeleton(t) != _skeleton(ch):
                t = ch
        out.append(t)
    return "\n".join(out) if "\n" in text else " ".join(out)


def _ezafe_openai(text, key, status):
    def call(ch):
        r = requests.post("https://api.openai.com/v1/chat/completions",
                          headers={"Authorization": "Bearer " + key},
                          json={"model": "gpt-4o-mini", "temperature": 0.2,
                                "messages": [{"role": "system", "content": _LLM_PROMPT},
                                             {"role": "user", "content": "TEXT TO DIACRITIZE:\n" + ch}]},
                          timeout=120)
        if r.status_code != 200:
            raise RuntimeError("OpenAI: " + r.json().get("error", {}).get("message", f"HTTP {r.status_code}"))
        return r.json()["choices"][0]["message"]["content"]
    return _llm_map(text, status, "OpenAI", call)


def _ezafe_gemini(text, key, status):
    def call(ch):
        models = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-flash-latest"]
        last_err = None
        for m in models:
            r = requests.post(
                "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + key,
                json={"contents": [{"parts": [{"text": _LLM_PROMPT + "\n\nTEXT TO DIACRITIZE:\n" + ch}]}],
                      "generationConfig": {"temperature": 0.1}},
                timeout=120)
            if r.status_code == 200:
                return r.json()["candidates"][0]["content"]["parts"][0]["text"]
            last_err = r.json().get("error", {}).get("message", f"HTTP {r.status_code}")
            if not any(k in last_err.lower() for k in ("not found", "not available", "no longer", "deprecated")):
                break
        raise RuntimeError("Gemini: " + (last_err or "?"))
    return _llm_map(text, status, "Gemini", call)


def _ezafe_anthropic(text, key, status):
    def call(ch):
        r = requests.post("https://api.anthropic.com/v1/messages",
                          headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                          json={"model": "claude-3-5-haiku-latest", "max_tokens": 8000, "temperature": 0.2,
                                "system": _LLM_PROMPT,
                                "messages": [{"role": "user", "content": "TEXT TO DIACRITIZE:\n" + ch}]},
                          timeout=120)
        if r.status_code != 200:
            raise RuntimeError("Claude: " + r.json().get("error", {}).get("message", f"HTTP {r.status_code}"))
        return r.json()["content"][0]["text"]
    return _llm_map(text, status, "Claude", call)


def ezafe_apply(text: str, status, tool: str = "local", key: str = "") -> str:
    tool = tool or "local"
    if tool != "local":
        key = (key or "").strip() or load_key(tool)
        if not key:
            raise RuntimeError("برای این ابزار، کلید API لازم است — آن را در کادر کلید وارد کنید (فقط یک‌بار).")
        save_key(tool, key)
        fn = {"openai": _ezafe_openai, "gemini": _ezafe_gemini, "anthropic": _ezafe_anthropic}[tool]
        return fn(text, key, status)
    return _ezafe_local(text, status)


# ---------------------------------------------------------------------------
# Piper voices — synthesized in a separate helper process so a native failure
# can never close the app; instead the error text is shown in the window.
# ---------------------------------------------------------------------------
PIPER_VOICES = {
    "mana": "https://huggingface.co/MahtaFetrat/Mana-Persian-Piper/resolve/main/fa_IR-mana-medium.onnx",
    "gyro": "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/gyro/medium/fa_IR-gyro-medium.onnx",
    "amir": "https://huggingface.co/rhasspy/piper-voices/resolve/main/fa/fa_IR/amir/medium/fa_IR-amir-medium.onnx",
}


def _find_espeak_data():
    """Find espeak-ng data in the bundle, wherever the packager hid it."""
    bases = [Path(getattr(sys, "_MEIPASS", Path(__file__).parent))]
    bases.append(bases[0].parent / "Resources")          # macOS .app data tree
    try:
        import piper as _piper
        bases.append(Path(_piper.__file__).parent.parent)
    except Exception:
        pass
    for base in bases:
        for c in (base / "piper" / "espeak-ng-data", base / "espeak-ng-data"):
            if (c / "phontab").exists():
                return c
    for base in bases:
        if not base.is_dir():
            continue
        for root, dirs, files in os.walk(base, followlinks=True):
            if root.endswith("espeak-ng-data") and "phontab" in files:
                return Path(root)
    return None


def _ensure_local_espeak():
    """Copy espeak data out of the bundle into a plain real folder, once."""
    target = MODELS_DIR / "espeak-ng-data"
    if (target / "phontab").exists():
        return target
    found = _find_espeak_data()
    if found is None:
        return None
    try:
        shutil.copytree(found, target, dirs_exist_ok=True)
        if (target / "phontab").exists():
            return target
    except Exception:
        pass
    return found


def piper_worker_main(task_path: str) -> None:
    """Runs inside the helper process."""
    task = json.loads(Path(task_path).read_text(encoding="utf-8"))
    data_dir = _ensure_local_espeak()
    try:
        import importlib.metadata as _md
        _pv = _md.version("piper-tts")
    except Exception:
        _pv = "?"
    sys.stderr.write(f"[ava-diag] piper={_pv} data={data_dir} "
                     f"phontab={(data_dir / 'phontab').exists() if data_dir else None}\n")
    if data_dir is None:
        raise RuntimeError("espeak-ng-data missing from the app bundle — rebuild needed")
    # env semantics: espeak expects the PARENT of the espeak-ng-data folder here
    os.environ["ESPEAK_DATA_PATH"] = str(data_dir.parent)
    from piper import PiperVoice
    voice = PiperVoice.load(task["onnx"], espeak_data_dir=str(data_dir))
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


def chatterbox_generate(text, exaggeration, cfg_weight, temperature, status, speed=1.0):
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
                                 temperature=max(0.05, float(temperature)))
        waves.append(wav.squeeze().cpu().numpy())
    audio = np.concatenate(waves)
    if abs(float(speed) - 1.0) > 0.01:
        status("در حال تنظیم سرعت گفتار…")
        try:
            from audiotsm import wsola
            from audiotsm.io.array import ArrayReader, ArrayWriter
            reader = ArrayReader(audio.astype(np.float32).reshape(1, -1))
            writer = ArrayWriter(1)
            wsola(1, speed=float(speed)).run(reader, writer)
            audio = writer.data.flatten()
        except Exception:
            status("تنظیم سرعت در دسترس نبود — با سرعت طبیعی ساخته شد.")
    pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    return pcm_to_mp3(pcm, model.sr), model.sr


def generate(payload, status) -> bytes:
    engine = payload["engine"]
    text = payload["text"].strip()
    if engine == "chatterbox":
        mp3, _ = chatterbox_generate(text, payload.get("exaggeration", 0.8),
                                     payload.get("cfg_weight", 1.0),
                                     payload.get("temperature", 0.0), status,
                                     speed=payload.get("cbx_speed", 1.0))
    else:
        mp3, _ = piper_generate(engine, text, payload.get("speed", 1.0),
                                payload.get("noise", 0.667),
                                payload.get("noisew", 0.8), status)
    return mp3
