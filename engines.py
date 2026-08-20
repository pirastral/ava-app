"""Ava — Persian TTS engines (Chatterbox-Persian + Piper voices + auto-ezafe)."""
import os, json, re, shutil, subprocess, sys, tempfile, threading, wave
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
    "ENDINGS LAW: for every word you mark, decide its final sound explicitly. The final sukun is a SURGICAL "
    "tool, not a default: use it only where the TTS would otherwise invent a trailing vowel - unusual or fused "
    "endings (\u06a9\u064e\u0632\u06cc\u0646\u0652, which unmarked gets misread as "
    "\u06a9\u0632\u06cc\u0646\u0650). Do NOT stamp it on ordinary consonant-final words, and NEVER before "
    "punctuation or a pause, where the voice closes the word naturally (\u062e\u0650\u0631\u064e\u062f\u060c "
    "not \u062e\u0650\u0631\u064e\u062f\u0652\u060c). A word linking forward gets the ezafe of rule (1); "
    "word-final \u0647 reads as e. "
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


def _ezafe_gemini(text, key, status, models=None, label="Gemini"):
    if models is None:
        models = ["gemini-3.6-flash", "gemini-3-flash-preview", "gemini-2.5-flash", "gemini-flash-latest"]

    def call(ch):
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
        raise RuntimeError(label + ": " + (last_err or "?"))
    return _llm_map(text, status, label, call)


def _ezafe_gemini_pro(text, key, status):
    return _ezafe_gemini(text, key, status, label="Gemini Pro",
                         models=["gemini-3-pro-preview", "gemini-3-pro",
                                 "gemini-2.5-pro", "gemini-pro-latest"])


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
        keyname = "gemini" if tool.startswith("gemini") else tool
        key = (key or "").strip() or load_key(keyname)
        if not key:
            raise RuntimeError("برای این ابزار، کلید API لازم است — آن را در کادر کلید وارد کنید (فقط یک‌بار).")
        save_key(keyname, key)
        fn = {"openai": _ezafe_openai, "gemini": _ezafe_gemini,
              "gemini_pro": _ezafe_gemini_pro, "anthropic": _ezafe_anthropic}[tool]
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
    """Runs inside the helper process. Synthesizes a list of segments
    ({"t": text} | {"p": seconds}) into one wav, splicing real silence."""
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
    segments = task.get("segments") or [{"t": task["text"]}]

    def synth_to(path, text):
        with wave.open(path, "wb") as wf:
            try:
                from piper import SynthesisConfig
                sc = SynthesisConfig(length_scale=length_scale,
                                     noise_scale=float(task["noise"]),
                                     noise_w_scale=float(task["noisew"]))
                voice.synthesize_wav(text, wf, syn_config=sc)
            except ImportError:
                voice.synthesize(text, wf, length_scale=length_scale,
                                 noise_scale=float(task["noise"]), noise_w=float(task["noisew"]))

    import numpy as _np
    pieces, sr = [], 0
    tmp = task["out"] + ".seg.wav"
    for seg in segments:
        if "t" in seg:
            synth_to(tmp, seg["t"])
            with wave.open(tmp, "rb") as rf:
                sr = rf.getframerate()
                pieces.append(_np.frombuffer(rf.readframes(rf.getnframes()), dtype=_np.int16))
        else:
            pieces.append(("pause", float(seg["p"])))
    try:
        os.unlink(tmp)
    except OSError:
        pass
    chunks = [_np.zeros(int(sr * p[1]), dtype=_np.int16) if isinstance(p, tuple) else p
              for p in pieces]
    joined = _np.concatenate(chunks) if chunks else _np.zeros(1, dtype=_np.int16)
    offs, o = [], 0
    for c in chunks:
        offs.append([o, len(c)]); o += len(c)
    with wave.open(task["out"], "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr or 22050)
        wf.writeframes(joined.tobytes())
    Path(task["out"] + ".offsets.json").write_text(json.dumps({"sr": sr or 22050, "offsets": offs}),
                                                  encoding="utf-8")


def piper_pcm(voice_key, segments, speed, noise_scale, noise_w, status):
    url = PIPER_VOICES[voice_key]
    onnx = MODELS_DIR / url.rsplit("/", 1)[-1]
    _download(url, onnx, status, f"صدای {voice_key} (~۶۰ مگابایت)")
    _download(url + ".json", Path(str(onnx) + ".json"), status, "پیکربندی صدا")

    status("در حال ساخت گفتار…")
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); out.close()
    taskf = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w", encoding="utf-8")
    json.dump({"onnx": str(onnx), "segments": segments, "speed": speed,
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
        offs = None
        try:
            meta = json.loads(Path(out.name + ".offsets.json").read_text(encoding="utf-8"))
            offs = [pcm[a:a + n].copy() for a, n in meta["offsets"]]
        except Exception:
            pass
        return (pcm, sr) if offs is None else (pcm, sr, offs)
    finally:
        for p in (out.name, taskf.name, out.name + ".offsets.json"):
            try:
                os.unlink(p)
            except OSError:
                pass


def piper_generate(voice_key, text, speed, noise_scale, noise_w, status):
    pcm, sr = piper_pcm(voice_key, _pause_segments(text), speed, noise_scale, noise_w, status)
    return pcm_to_mp3(pcm, sr), sr


# ---------------------------------------------------------------------------
# Chatterbox-Persian — cached permanently in AvaModels/hf
# ---------------------------------------------------------------------------
_chatterbox = None


def _hf_cached(name_fragment: str) -> bool:
    hub = MODELS_DIR / "hf" / "hub"
    return hub.is_dir() and any(name_fragment.lower() in p.name.lower() for p in hub.iterdir())


def _verify_repo_cache(repo_id, status, token=None):
    """Compare every cached model file's size against the repository's
    metadata; delete and re-download any truncated/corrupted file.
    A damaged file otherwise crashes the whole app at load time."""
    try:
        import os
        from huggingface_hub import HfApi, hf_hub_download, try_to_load_from_cache
        sizes = {s.rfilename: s.size for s in
                 HfApi().model_info(repo_id, files_metadata=True, token=token).siblings
                 if s.size}
        for name, size in sizes.items():
            p = try_to_load_from_cache(repo_id, name)
            if isinstance(p, str) and os.path.exists(p):
                real = os.path.getsize(os.path.realpath(p))
                if real != size:
                    status(f"فایل آسیب‌دیده در حافظه پیدا شد ({name}) — در حال دانلود دوبارهٔ همان فایل…")
                    try:
                        os.remove(os.path.realpath(p))
                    except OSError:
                        pass
                    try:
                        os.remove(p)
                    except OSError:
                        pass
                    hf_hub_download(repo_id=repo_id, filename=name,
                                    token=token, force_download=True)
    except Exception:
        pass  # offline or API hiccup: skip the check rather than block use


def _load_chatterbox(status):
    global _chatterbox
    if _chatterbox is not None:
        return _chatterbox
    import torch
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file as load_safetensors
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    _hook_hf_progress(status)
    # Apple GPU (MPS) deliberately NOT used: Chatterbox's MPS path leaks memory
    # until the whole machine swaps (observed 45+ GB on a 48 GB Mac). CPU is
    # slower but its memory stays bounded around 5-6 GB.
    # MPS (Mac GPU) is fast but leaks by upstream flaw (resemble-ai #218).
    # Inside the self-recycling worker that leak is bounded, so speed wins.
    if torch.cuda.is_available():
        device = "cuda"
    elif torch.backends.mps.is_available():
        device = "mps"
    else:
        device = "cpu"
    if _hf_cached("chatterbox"):
        status("در حال بارگذاری مدل چترباکس از حافظهٔ دستگاه… (۱ تا ۲ دقیقه)")
    else:
        status("فقط بار اول: در حال دانلود مدل چترباکس (حدود ۲ گیگابایت)… از این پس روی دستگاه می‌ماند.")

    _orig_load = torch.load
    def _patched(*a, **k):
        k.setdefault("map_location", torch.device(device))
        return _orig_load(*a, **k)
    torch.load = _patched

    token = read_token()
    _verify_repo_cache("ResembleAI/chatterbox", status)
    if token:
        _verify_repo_cache("Thomcles/Chatterbox-TTS-Persian-Farsi", status, token=token)
    model = ChatterboxMultilingualTTS.from_pretrained(device=device)
    if not token:
        raise RuntimeError("توکن Hugging Face در برنامه نیست — باید هنگام ساخت قرار داده شود.")
    status("در حال آماده‌سازی صدای فارسی…")
    fa_path = hf_hub_download(repo_id="Thomcles/Chatterbox-TTS-Persian-Farsi",
                              filename="t3_fa.safetensors", token=token)
    model.t3.load_state_dict(load_safetensors(fa_path, device="cpu"))
    model.t3.to(device).eval()
    _chatterbox = model
    return model


def faDigits(n):
    return str(n).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


_PAUSE_RE = re.compile(r"\[\s*(مکث بلند|مکث)\s*\]")
_PAUSE_SPLIT = re.compile(r"(\[\s*مکث بلند\s*\]|\[\s*مکث\s*\]|…|—)")


def _pause_val(tok):
    if tok.startswith("["):
        return 1.2 if "بلند" in tok else 0.5
    if tok == "…":
        return 0.35
    if tok == "—":
        return 0.25
    return None


_CLAUSE_END_STRONG = ".!?؟؛…"
_GAP_AFTER = {"،": 0.08, "؛": 0.12, ".": 0.18, "!": 0.18, "?": 0.18, "؟": 0.18, "…": 0.3}


def _clause_split(text, engine):
    """Split a gulp's text into independently-synthesized clauses with char
    spans, so a later patch can regenerate only the touched pieces.
    Light voices break at commas too; chatterbox only at sentence ends
    (its cross-comma prosody is worth keeping)."""
    marks = _CLAUSE_END_STRONG + ("،" if engine != "chatterbox" else "")
    items, pos = [], 0
    for part in _PAUSE_SPLIT.split(text):
        if not part:
            continue
        start = text.index(part, pos)
        pos = start + len(part)
        tok = part.strip()
        p = _pause_val(tok) if _PAUSE_SPLIT.fullmatch(part) else None
        if p is not None:
            if engine == "chatterbox" and tok in ("…", "—"):
                # chatterbox reads these natively — glue to the previous clause
                if items and items[-1].get("kind") == "t":
                    items[-1]["text"] += part
                    items[-1]["span"] = (items[-1]["span"][0], pos)
                continue
            items.append({"kind": "p", "sec": p, "span": (start, pos)})
            continue
        for m in re.finditer(r"[^" + marks + r"]*[" + marks + r"]+\s*|[^" + marks + r"]+$", part):
            t = m.group(0)
            if not t.strip():
                continue
            a = start + m.start()
            gap = 0.0
            if engine != "chatterbox":
                tail = t.strip()[-1]
                gap = _GAP_AFTER.get(tail, 0.0)
            items.append({"kind": "t", "text": t.strip(), "span": (a, a + len(t)), "gap": gap})
    return [i for i in items if i["kind"] == "p" or i["text"]]


def _pause_segments(text):
    """Light voices can't pause on punctuation reliably; split the text at
    every marker so real silence gets spliced into the waveform."""
    segs = []
    for part in _PAUSE_SPLIT.split(text):
        if not part:
            continue
        p = _pause_val(part.strip()) if _PAUSE_SPLIT.fullmatch(part) else None
        if p is not None:
            segs.append({"p": p})
        elif part.strip():
            segs.append({"t": part.strip()})
    return segs or [{"t": text}]


def _split_sentences(text, max_len=280):
    parts, buf = [], ""

    def flush():
        nonlocal buf
        if buf:
            parts.append(buf)
            buf = ""

    for piece in re.split(r"(?<=[\.\!\?؟।؛…\n])\s+", text.strip()):
        if not piece:
            continue
        if len(buf) + len(piece) + 1 <= max_len:
            buf = (buf + " " + piece).strip()
            continue
        flush()
        # an over-long sentence: window it, preferring comma then space breaks —
        # never discard a single character
        while len(piece) > max_len:
            cut = piece.rfind("،", 0, max_len)
            if cut <= max_len // 3:
                cut = piece.rfind(" ", 0, max_len)
            if cut <= max_len // 3:
                cut = max_len
            else:
                cut += 1
            parts.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        buf = piece
    flush()
    return parts or [text[:max_len]]


def chatterbox_pcm(text, exaggeration, cfg_weight, temperature, status, speed=1.0):
    import torch
    model = _load_chatterbox(status)
    import gc
    # pause tags: [مکث] = 0.5s silence, [مکث بلند] = 1.2s — spliced into the audio
    segments = []
    pos = 0
    for m in _PAUSE_RE.finditer(text):
        if text[pos:m.start()].strip():
            segments.append(("text", text[pos:m.start()]))
        segments.append(("pause", 1.2 if "بلند" in m.group(1) else 0.5))
        pos = m.end()
    if text[pos:].strip():
        segments.append(("text", text[pos:]))
    chunks = []
    for kind, val in segments:
        if kind == "pause":
            chunks.append(("pause", val))
        else:
            chunks.extend(("text", c) for c in _split_sentences(val))
    total = sum(1 for k, _ in chunks if k == "text")
    waves = []
    i = 0
    for kind, chunk in chunks:
        if kind == "pause":
            waves.append(np.zeros(int(model.sr * chunk), dtype=np.float32))
            continue
        i += 1
        status(f"در حال ساخت گفتار… بخش {i} از {total}")
        with torch.no_grad():
            wav = model.generate(chunk, language_id=None,
                                 exaggeration=float(exaggeration),
                                 cfg_weight=float(cfg_weight),
                                 temperature=max(0.05, float(temperature)))
        waves.append(wav.squeeze().cpu().numpy())
        # release engine working memory between chunks — on Apple Silicon the
        # allocator hoards freed memory and stacks it until the whole Mac swaps
        del wav
        gc.collect()
        try:
            if torch.backends.mps.is_available():
                torch.mps.empty_cache()
            elif torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass
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
    return (np.clip(audio, -1, 1) * 32767).astype(np.int16), model.sr


def chatterbox_generate(text, exaggeration, cfg_weight, temperature, status, speed=1.0):
    pcm, sr = chatterbox_pcm(text, exaggeration, cfg_weight, temperature, status, speed=speed)
    return pcm_to_mp3(pcm, sr), sr


# ---------------------------------------------------------------------------
# Chatterbox process isolation: the engine leaks memory by design flaw
# (resemble-ai/chatterbox #218), so it lives in a disposable helper process.
# Leaked memory cannot outlive its process — when the worker grows past the
# threshold, it retires itself and a fresh one is spawned on the next request.
# ---------------------------------------------------------------------------
def _cbx_ceiling_mb(rss_mb, avail_mb):
    """The worker may hold up to 75% of the reclaimable pool: what's
    available now PLUS what the worker itself would give back if retired.
    Big idle machine → high ceiling; busy machine → ceiling shrinks with it."""
    if avail_mb is None:
        return 8000
    return int(0.75 * (avail_mb + rss_mb))
_cbx_proc = None
_cbx_stderr = None
_cbx_lock = threading.Lock()


def chatterbox_worker_main():
    """Runs inside the helper process: serve generation requests over stdio."""
    def status(msg, pct=None):
        sys.stdout.write(json.dumps({"type": "status", "msg": msg, "pct": pct},
                                    ensure_ascii=False) + "\n")
        sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            texts = req.get("clauses") or [req["text"]]
            parts, sr = [], 0
            for k, t in enumerate(texts, 1):
                if len(texts) > 1:
                    status(f"در حال ساخت گفتار… قطعهٔ {k} از {len(texts)}")
                pcm, sr = chatterbox_pcm(t, req.get("exaggeration", 0.8),
                                         req.get("cfg_weight", 1.0),
                                         req.get("temperature", 0.0), status,
                                         speed=req.get("speed", 1.0))
                parts.append(pcm)
            offs, o = [], 0
            for p in parts:
                offs.append([o, len(p)]); o += len(p)
            pcm = np.concatenate(parts) if parts else np.zeros(1, dtype=np.int16)
            f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); f.close()
            with wave.open(f.name, "wb") as wf:
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
                wf.writeframes(pcm.tobytes())
            Path(f.name + ".offsets.json").write_text(json.dumps(offs), encoding="utf-8")
            rss = 0
            try:
                import psutil
                rss = psutil.Process().memory_info().rss // (1024 * 1024)
            except Exception:
                pass
            avail_mb = None
            try:
                import psutil
                avail_mb = psutil.virtual_memory().available // (1024 * 1024)
            except Exception:
                pass
            recycle = rss > _cbx_ceiling_mb(rss, avail_mb) or \
                      (avail_mb is not None and avail_mb < 1500)
            sys.stdout.write(json.dumps({"type": "result", "path": f.name, "sr": sr,
                                         "rss_mb": rss, "recycle": recycle},
                                        ensure_ascii=False) + "\n")
            sys.stdout.flush()
            if recycle:
                break  # retire: the OS reclaims every leaked byte
        except Exception as e:
            sys.stdout.write(json.dumps({"type": "error", "error": str(e)},
                                        ensure_ascii=False) + "\n")
            sys.stdout.flush()


def _cbx_ensure():
    global _cbx_proc, _cbx_stderr
    if _cbx_proc is not None and _cbx_proc.poll() is None:
        return _cbx_proc
    import collections
    kwargs = {"creationflags": 0x08000000} if os.name == "nt" else {}
    _cbx_proc = subprocess.Popen([sys.executable, "--chatterbox-worker", "run"],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True,
                                 encoding="utf-8", bufsize=1, **kwargs)
    _cbx_stderr = collections.deque(maxlen=60)

    def _drain(p=_cbx_proc, d=_cbx_stderr):
        try:
            for l in p.stderr:
                d.append(l.rstrip())
        except Exception:
            pass
    threading.Thread(target=_drain, daemon=True).start()
    return _cbx_proc


def chatterbox_via_worker(req, status):
    """Returns (pcm int16 ndarray, sample_rate) from the isolated worker."""
    with _cbx_lock:
        global _cbx_proc
        p = _cbx_ensure()
        line = json.dumps(req, ensure_ascii=False) + "\n"
        try:
            p.stdin.write(line); p.stdin.flush()
        except Exception:
            _cbx_proc = None
            p = _cbx_ensure()
            p.stdin.write(line); p.stdin.flush()
        for out in p.stdout:
            out = out.strip()
            try:
                msg = json.loads(out)
            except Exception:
                continue  # stray library print — not ours
            t = msg.get("type")
            if t == "status":
                status(msg.get("msg", ""), pct=msg.get("pct"))
            elif t == "error":
                raise RuntimeError(msg.get("error", "خطای ناشناخته"))
            elif t == "result":
                with wave.open(msg["path"], "rb") as wf:
                    sr = wf.getframerate()
                    pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
                offs = None
                try:
                    offs = json.loads(Path(msg["path"] + ".offsets.json").read_text(encoding="utf-8"))
                except Exception:
                    pass
                for pth in (msg["path"], msg["path"] + ".offsets.json"):
                    try:
                        os.unlink(pth)
                    except OSError:
                        pass
                if msg.get("recycle"):
                    freed = msg.get("rss_mb") or 0
                    status(f"حافظهٔ موتور چترباکس پاک‌سازی شد ({faDigits(freed // 1024)} گیگابایت آزاد شد) — نوبت بعد چند لحظه بیشتر طول می‌کشد."
                           if freed else
                           "حافظهٔ موتور چترباکس پاک‌سازی شد — نوبت بعد چند لحظه بیشتر طول می‌کشد.")
                    _cbx_proc = None
                if offs is not None:
                    return pcm, sr, [pcm[a:a + n].copy() for a, n in offs]
                return pcm, sr
        # stdout closed: the worker died mid-job
        _cbx_proc = None
        tail = "\n".join(list(_cbx_stderr or [])[-8:])
        raise RuntimeError("موتور چترباکس ناگهان بسته شد" +
                           (":\n" + tail if tail else " — دوباره امتحان کنید."))


def _synth_clauses(items, payload, status):
    """Synthesize the text-kind items in place (fills item['pcm']), one
    engine call for the whole batch."""
    engine = payload["engine"]
    texts = [i["text"] for i in items if i["kind"] == "t"]
    if not texts:
        return 22050
    if engine == "chatterbox":
        _mem_preflight(status)
        res = chatterbox_via_worker(
            {"clauses": texts, "text": " ".join(texts),
             "exaggeration": payload.get("exaggeration", 0.8),
             "cfg_weight": payload.get("cfg_weight", 1.0),
             "temperature": payload.get("temperature", 0.0),
             "speed": payload.get("cbx_speed", 1.0)}, status)
        pcm, sr, parts = res if len(res) == 3 else (res[0], res[1], [res[0]])
    else:
        segs = [{"t": t} for t in texts]
        res = piper_pcm(engine, segs, payload.get("speed", 1.0),
                        payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
        pcm, sr, parts = res if len(res) == 3 else (res[0], res[1], [res[0]])
    it = iter(parts)
    for i in items:
        if i["kind"] == "t":
            i["pcm"] = next(it)
    return sr


def _assemble(entry):
    sr = entry["sr"]
    out = []
    for i in entry["items"]:
        if i["kind"] == "p":
            out.append(np.zeros(int(sr * i["sec"]), dtype=np.int16))
        else:
            out.append(i["pcm"])
            if i.get("gap"):
                out.append(np.zeros(int(sr * i["gap"]), dtype=np.int16))
    return np.concatenate(out) if out else np.zeros(1, dtype=np.int16)


def _mem_preflight(status):
    try:
        import psutil
        total_mb = psutil.virtual_memory().total // (1024 * 1024)
    except Exception:
        total_mb = None
    if total_mb is not None and total_mb < 7000:
        raise RuntimeError(
            f"صدای چترباکس روی این دستگاه اجرا نمی‌شود — دست‌کم ۸ گیگابایت رم لازم دارد "
            f"(این دستگاه: {total_mb // 1024} گیگابایت). از صداهای سبک (مانا، ژیرو، امیر) استفاده کنید.")
    try:
        import psutil
        avail_mb = psutil.virtual_memory().available // (1024 * 1024)
    except Exception:
        avail_mb = None
    if avail_mb is not None and avail_mb < 4500:
        status(f"هشدار: حافظهٔ آزاد کم است ({avail_mb // 1024} گیگابایت) — ممکن است کند پیش برود؛ "
               "بستن برنامه‌های دیگر کمک می‌کند.")


def _gulp_pcm(payload, status):
    engine = payload["engine"]
    text = payload["text"].strip()
    if engine == "chatterbox":
        _mem_preflight(status)
        # chatterbox reads … and — natively; [مکث] tags are spliced inside its core
        return chatterbox_via_worker(
            {"text": text,
             "exaggeration": payload.get("exaggeration", 0.8),
             "cfg_weight": payload.get("cfg_weight", 1.0),
             "temperature": payload.get("temperature", 0.0),
             "speed": payload.get("cbx_speed", 1.0)}, status)
    segs = _pause_segments(text)
    if not any("t" in s for s in segs):
        raise RuntimeError("این بخش متنی برای خواندن ندارد — فقط نشانهٔ مکث است.")
    return piper_pcm(engine, segs, payload.get("speed", 1.0),
                     payload.get("noise", 0.667), payload.get("noisew", 0.8), status)


import itertools as _it
_GULP_PCM = {}
_gulp_ids = _it.count(1)


def reset_gulps():
    _GULP_PCM.clear()


def generate_gulp(payload, status):
    """One gulp → clause-wise synthesis, stored per clause for surgical patching."""
    text = payload["text"].strip()
    items = _clause_split(text, payload["engine"])
    if not any(i["kind"] == "t" for i in items):
        raise RuntimeError("این بخش متنی برای خواندن ندارد — فقط نشانهٔ مکث است.")
    sr = _synth_clauses(items, payload, status)
    gid = next(_gulp_ids)
    entry = {"sr": sr, "items": items, "text": text, "engine": payload["engine"]}
    _GULP_PCM[gid] = entry
    return pcm_to_mp3(_assemble(entry), sr), gid


_ALIGN = {"model": None, "proc": None}
_STRIP_RE = re.compile(r"[\u064B-\u0655\u0670\u200c]")


def _load_aligner(status):
    if _ALIGN["model"] is not None:
        return
    try:
        import psutil
        if psutil.virtual_memory().total // (1024 * 1024) < 8000:
            raise RuntimeError("این دستگاه برای هم‌ترازی واژه‌ای حافظهٔ کافی ندارد")
    except RuntimeError:
        raise
    except Exception:
        pass
    status("بار اول: در حال دانلود مدل هم‌ترازی واژه‌ها (~۱٫۲ گیگابایت)… فقط همین یک‌بار.")
    _hook_hf_progress(status)
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
    repo = "jonatasgrosman/wav2vec2-large-xlsr-53-persian"
    proc = Wav2Vec2Processor.from_pretrained(repo)
    mdl = Wav2Vec2ForCTC.from_pretrained(repo)
    mdl.eval()
    _ALIGN.update(model=mdl, proc=proc)
    status("مدل هم‌ترازی آماده شد.")


def _align_words(pcm, sr, text, status):
    """Force-align clause audio to its words → [(word, start_sample, end_sample)].
    Returns None when alignment isn't trustworthy; caller falls back."""
    _load_aligner(status)
    import torch, torchaudio
    x = pcm.astype(np.float32) / 32768.0
    if sr != 16000:
        n = int(round(len(x) * 16000 / sr))
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    proc, mdl = _ALIGN["proc"], _ALIGN["model"]
    with torch.no_grad():
        inp = proc(x, sampling_rate=16000, return_tensors="pt")
        logp = torch.log_softmax(mdl(inp.input_values).logits, dim=-1)
    vocab = proc.tokenizer.get_vocab()
    blank = vocab.get(proc.tokenizer.pad_token, 0)
    delim = vocab.get("|")
    if delim is None:
        return None
    raw_words = re.findall(r"\S+", text)
    words = []
    for w in raw_words:
        cw = "".join(ch for ch in _STRIP_RE.sub("", w) if ch in vocab and ch != "|")
        if not cw:
            return None
        words.append(cw)
    seq = []
    for k, w in enumerate(words):
        if k:
            seq.append(delim)
        seq.extend(vocab[ch] for ch in w)
    targets = torch.tensor([seq], dtype=torch.long)
    try:
        ali, scores = torchaudio.functional.forced_align(logp, targets, blank=blank)
        spans = torchaudio.functional.merge_tokens(ali[0], scores[0])
    except Exception:
        return None
    T = logp.shape[1]
    ratio = len(pcm) / max(1, T)
    word_spans, cur = [], None
    for s in spans:
        if s.token == blank:
            continue
        if s.token == delim:
            if cur:
                word_spans.append(cur)
            cur = None
            continue
        cur = [s.start, s.end] if cur is None else [cur[0], s.end]
    if cur:
        word_spans.append(cur)
    if len(word_spans) != len(words):
        return None
    return [(raw_words[i], int(a * ratio), min(len(pcm), int(b * ratio) + 1))
            for i, (a, b) in enumerate(word_spans)]


def _crossfade_join(parts, sr, ms=12):
    n = int(sr * ms / 1000)
    out = parts[0].astype(np.float32)
    for p in parts[1:]:
        p = p.astype(np.float32)
        if n > 0 and len(out) >= n and len(p) >= n:
            fade = np.linspace(1, 0, n, dtype=np.float32)
            out = np.concatenate([out[:-n], out[-n:] * fade + p[:n] * (1 - fade), p[n:]])
        else:
            out = np.concatenate([out, p])
    return np.clip(out, -32768, 32767).astype(np.int16)


def _word_surgery(entry, old_item, new_item, sel_start, sel_end, payload, status):
    """Replace only the selected word window inside one clause's audio.
    Returns the count of re-synthesized words, or None to fall back."""
    sr = entry["sr"]
    old_pcm = old_item.get("pcm")
    if old_pcm is None:
        return None
    old_text, new_text = old_item["text"], new_item["text"]
    off = new_item["span"][0]
    s = max(0, (sel_start or 0) - off)
    e = min(len(new_text), (sel_end or 0) - off)
    if e <= s:
        return None
    old_words = re.findall(r"\S+", old_text)
    new_spans = [(m.group(0), m.start(), m.end()) for m in re.finditer(r"\S+", new_text)]
    new_words = [w for w, _, _ in new_spans]
    pre_w = 0
    while pre_w < min(len(old_words), len(new_words)) and old_words[pre_w] == new_words[pre_w]:
        pre_w += 1
    suf_w = 0
    while suf_w < min(len(old_words), len(new_words)) and old_words[-1 - suf_w] == new_words[-1 - suf_w]:
        suf_w += 1
    for idx, (_, a, b) in enumerate(new_spans):
        if a < e and b > s:
            pre_w = min(pre_w, idx)
            suf_w = min(suf_w, len(new_words) - 1 - idx)
    if pre_w + suf_w > len(new_words):
        suf_w = len(new_words) - pre_w
    if pre_w + suf_w > len(old_words):
        suf_w = max(0, len(old_words) - pre_w)
    if pre_w == 0 and suf_w == 0:
        return None  # whole clause anyway — the clause path handles it
    aligned = _align_words(old_pcm, sr, old_text, status)
    if aligned is None:
        return None

    def cut_after(i):   # sample boundary between old word i and i+1 (gap midpoint)
        return (aligned[i][2] + aligned[i + 1][1]) // 2
    a_cut = 0 if pre_w == 0 else cut_after(pre_w - 1)
    b_cut = len(old_pcm) if suf_w == 0 else cut_after(len(old_words) - suf_w - 1)
    mid_words = new_words[pre_w:len(new_words) - suf_w]
    if mid_words:
        txt = " ".join(mid_words)
        status(f"جراحی واژه‌ای: بازتولید «{txt[:40]}»…")
        engine = payload["engine"]
        if engine == "chatterbox":
            res = chatterbox_via_worker(
                {"clauses": [txt], "text": txt,
                 "exaggeration": payload.get("exaggeration", 0.8),
                 "cfg_weight": payload.get("cfg_weight", 1.0),
                 "temperature": payload.get("temperature", 0.0),
                 "speed": payload.get("cbx_speed", 1.0)}, status)
        else:
            res = piper_pcm(engine, [{"t": txt}], payload.get("speed", 1.0),
                            payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
        new_mid, sr2 = res[0], res[1]
        if sr2 != sr:
            n = int(round(len(new_mid) * sr / sr2))
            new_mid = np.interp(np.linspace(0, len(new_mid) - 1, n),
                                np.arange(len(new_mid)), new_mid.astype(np.float64)).astype(np.int16)
    else:
        new_mid = np.zeros(int(sr * 0.05), dtype=np.int16)  # pure deletion → tiny breath
    new_item["pcm"] = _crossfade_join([old_pcm[:a_cut], new_mid, old_pcm[b_cut:]], sr)
    return max(1, len(mid_words))


def patch_gulp(gid, new_text, sel_start, sel_end, payload, status):
    """Regenerate only the clauses that the edit/selection touched; every
    other clause's audio is reused bit-identical."""
    entry = _GULP_PCM.get(int(gid))
    if entry is None:
        raise RuntimeError("این بخش دیگر در حافظه نیست — دوباره «تبدیل به گفتار» را بزنید.")
    new_text = new_text.strip()
    new_items = _clause_split(new_text, payload["engine"])
    if not any(i["kind"] == "t" for i in new_items):
        raise RuntimeError("این بخش متنی برای خواندن ندارد — فقط نشانهٔ مکث است.")
    old_items = entry["items"]
    same_engine = payload["engine"] == entry.get("engine")

    def key(i):
        return (i["kind"], i.get("text") if i["kind"] == "t" else i["sec"])

    # longest common prefix and suffix of unchanged clauses, measured
    # independently (audio reusable on both flanks)
    n_old, n_new = len(old_items), len(new_items)
    pre = 0
    while (same_engine and pre < min(n_old, n_new)
           and key(old_items[pre]) == key(new_items[pre])):
        pre += 1
    suf = 0
    while (same_engine and suf < min(n_old, n_new)
           and key(old_items[-1 - suf]) == key(new_items[-1 - suf])):
        suf += 1
    # the selection forces its clauses into the regenerated middle
    if sel_start is not None and sel_end is not None and sel_end > sel_start:
        for idx, i in enumerate(new_items):
            a, b = i["span"]
            if a < sel_end and b > sel_start:
                pre = min(pre, idx)
                suf = min(suf, n_new - 1 - idx)
    # resolve overlap so prefix and suffix never claim the same clause
    if pre + suf > n_new:
        suf = n_new - pre
    if pre + suf > n_old:
        suf = max(0, n_old - pre)
    for idx in range(pre):
        new_items[idx]["pcm"] = old_items[idx].get("pcm")
    for k in range(suf):
        new_items[len(new_items) - 1 - k]["pcm"] = old_items[len(old_items) - 1 - k].get("pcm")
    mid_new = new_items[pre:len(new_items) - suf]
    mid_old = old_items[pre:len(old_items) - suf]
    mode = "clause"
    words_done = 0
    if (same_engine and sel_start is not None and len(mid_new) == 1 and len(mid_old) == 1
            and mid_new[0]["kind"] == "t" and mid_old[0]["kind"] == "t"):
        try:
            r = _word_surgery(entry, mid_old[0], mid_new[0], sel_start, sel_end, payload, status)
            if r:
                mode, words_done = "words", r
        except Exception as e:
            status(f"هم‌ترازی واژه‌ای ممکن نشد ({str(e)[:50]}) — کل قطعه بازتولید می‌شود.")
    middle = [] if mode == "words" else [i for i in mid_new if i["kind"] == "t"]
    if middle:
        status(f"بازتولید {faDigits(len(middle))} قطعهٔ تغییرکرده…")
        _synth_clauses(middle, payload, status)
    entry.update({"items": new_items, "text": new_text, "engine": payload["engine"]})
    changed = words_done if mode == "words" else len(middle)
    return pcm_to_mp3(_assemble(entry), entry["sr"]), changed, mode


def splice_gulps(ids, status) -> bytes:
    """Join stored gulps in order — resampling if voices with different
    sample rates were mixed — with a short breath between parts."""
    try:
        entries = [_GULP_PCM[int(i)] for i in ids]
    except KeyError:
        raise RuntimeError("برخی بخش‌ها دیگر در حافظه نیستند — دوباره «تبدیل به گفتار» را بزنید.")
    if not entries:
        raise RuntimeError("بخشی برای اتصال وجود ندارد.")
    status("در حال اتصال بخش‌ها و ساخت فایل نهایی…")
    parts = [(_assemble(e), e["sr"]) for e in entries]
    target = max(sr for _, sr in parts)
    gap = np.zeros(int(target * 0.12), dtype=np.int16)
    out = []
    for k, (pcm, sr) in enumerate(parts):
        if sr != target:
            n = int(round(len(pcm) * target / sr))
            xi = np.linspace(0, len(pcm) - 1, n)
            pcm = np.interp(xi, np.arange(len(pcm), dtype=np.float64),
                            pcm.astype(np.float64)).astype(np.int16)
        out.append(pcm)
        if k < len(parts) - 1:
            out.append(gap)
    return pcm_to_mp3(np.concatenate(out), target)


def generate(payload, status) -> bytes:
    mp3, gid = generate_gulp(payload, status)
    _GULP_PCM.pop(gid, None)
    return mp3
