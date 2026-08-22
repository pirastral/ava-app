"""Ava — Persian TTS engines (Chatterbox-Persian + Piper voices + auto-ezafe)."""
import os, json, re, shutil, subprocess, sys, tempfile, threading, wave
import types
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


BUILD = 77
BUILD_FA = "\u06f7\u06f7"


def _diag(tag, **kv):
    """Silent forensic breadcrumbs into stderr/log. Never user-facing, never raises."""
    try:
        import sys as _s
        _s.stderr.write("[ava-diag] " + tag + " " +
                        " ".join(f"{k}={v}" for k, v in kv.items()) + "\n")
    except Exception:
        pass


def _final_decay(pcm, sr, win=0.030, fade=0.060, frac=0.15):
    """Exit gate: a file may never end mid-energy (the measured cold-end class,
    file finishing at RMS 0.10). If the last 30 ms carry >15% of body RMS,
    apply a 60 ms raised-cosine landing; natural decays pass untouched."""
    n = len(pcm)
    if n < int(sr * fade) * 2:
        return pcm
    body = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    tail = float(np.sqrt(np.mean(pcm[-int(sr * win):].astype(np.float64) ** 2)))
    if tail <= frac * body:
        return pcm
    _diag("final_decay", tail_over_body=round(tail / body, 3))
    out = pcm.astype(np.float32).copy()
    m = int(sr * fade)
    t = np.linspace(0, np.pi / 2, m, dtype=np.float32)
    out[-m:] *= np.cos(t) ** 2
    return out.astype(np.int16)


def pcm_to_mp3(pcm_int16: np.ndarray, sample_rate: int) -> bytes:
    enc = lameenc.Encoder()
    enc.set_bit_rate(128)
    enc.set_in_sample_rate(sample_rate)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm_int16 = _final_decay(pcm_int16, sample_rate)
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
    "MARKING IS A SCALPEL, NOT SEASONING - and the blade cuts both ways: a common word the TTS "
    "already reads correctly is actively HARMED by marks, because the synthesizer knows the bare "
    "familiar form as a whole; vocalizing it - however correctly - can break its pronunciation "
    "(مجلس left bare is read right; the correctly marked مَجْلِس made a TTS say مَجَلِس). "
    "The twin failure is just as wrong: a genuine ambiguity left bare - an unresolved homograph, "
    "a skipped ezafe, an unmarked rare or metrical word - misleads the voice equally. "
    "So: resolve EVERY ambiguity, decorate NOTHING familiar; when a word is both common and "
    "unambiguous in this sentence, leaving it bare is the correct expert action, not an omission. "
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


_VOICE_TRUE_SR = {"mana": 44100, "gyro": 22050, "amir": 22050}


def _voice_config_guard(voice_key, onnx, url, status):
    """Root cause of the mana corruption (measured, log-confirmed): the local
    voice CONFIG declared 22050 while the mana model is a 44100 voice — piper
    then conditions the vocoder with wrong frame math and the output itself
    comes out spectrum-displaced. Verify the declared rate against the known
    truth; repair by re-download, and if upstream itself is wrong, rewrite the
    local config's sample_rate to the measured-true value."""
    want = _VOICE_TRUE_SR.get(voice_key)
    if not want:
        return
    cfg = Path(str(onnx) + ".json")
    def declared():
        try:
            d = json.loads(cfg.read_text(encoding="utf-8"))
            return d, (d.get("audio", {}) or {}).get("sample_rate") or d.get("sample_rate")
        except Exception:
            return None, None
    d, sr = declared()
    if isinstance(d, dict):
        _diag("voice_cfg_detail", voice=voice_key, sr=sr,
              phoneme_type=d.get("phoneme_type"),
              espeak=(d.get("espeak", {}) or {}).get("voice"),
              num_symbols=d.get("num_symbols"))
    if sr == want:
        return
    _diag("voice_config", voice=voice_key, declared=sr, want=want, action="redownload")
    status(f"پیکربندی صدای {voice_key} نادرست بود — در حال ترمیم…")
    for p in (cfg, onnx):
        try:
            p.unlink()
        except OSError:
            pass
    _download(url, onnx, status, f"صدای {voice_key} (~۶۰ مگابایت)")
    _download(url + ".json", cfg, status, "پیکربندی صدا")
    d, sr = declared()
    if sr != want:
        # field-measured: forcing the rate does NOT heal the output — the
        # defect lives in the model/runtime pairing, not the label. Record
        # and proceed; the synthesis guard still refuses displaced audio.
        _diag("voice_config", voice=voice_key, declared=sr, want=want, action="observe")


def piper_pcm(voice_key, segments, speed, noise_scale, noise_w, status):
    url = PIPER_VOICES[voice_key]
    onnx = MODELS_DIR / url.rsplit("/", 1)[-1]
    _download(url, onnx, status, f"صدای {voice_key} (~۶۰ مگابایت)")
    _download(url + ".json", Path(str(onnx) + ".json"), status, "پیکربندی صدا")
    _voice_config_guard(voice_key, onnx, url, status)

    status("در حال ساخت گفتار…")
    segments = [({"t": _strip_orphan_marks(s["t"])} if "t" in s else s) for s in segments]
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); out.close()
    taskf = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w", encoding="utf-8")
    json.dump({"onnx": str(onnx), "segments": segments, "speed": speed,
               "noise": noise_scale, "noisew": noise_w, "out": out.name}, taskf)
    taskf.close()
    try:
        creation = {"creationflags": 0x08000000} if os.name == "nt" else {}
        proc = _guarded_run([sys.executable, "--piper-worker", taskf.name],
                            "piper", 600)
        if proc.returncode not in (0, None) and proc.returncode < 0:
            # mid-job brake or timeout killed the worker. A job that breaches
            # is a runaway that would never have finished — but a FRESH
            # process deserves one chance before the user sees an error.
            _diag("mem_gate", role="piper", action="retry_after_brake")
            proc = _guarded_run([sys.executable, "--piper-worker", taskf.name],
                                "piper", 600)
            if proc.returncode not in (0, None) and proc.returncode < 0:
                raise RuntimeError(
                    "ساخت گفتار دوبار پشت\u200cسرهم از سقف حافظه گذشت و متوقف شد — "
                    "برنامه\u200cهای دیگر را ببندید یا متن را کوتاه\u200cتر کنید و دوباره بکوشید.")
        try:
            for ln in (proc.stderr or b"").decode("utf-8", "ignore").splitlines():
                if "[ava-diag]" in ln:
                    sys.stderr.write(ln + "\n")
        except Exception:
            pass
        if proc.returncode != 0:
            tail = (proc.stderr or b"").decode("utf-8", "ignore").strip().splitlines()[-6:]
            raise RuntimeError("موتور صدای سبک خطا داد:\n" + "\n".join(tail) if tail
                              else f"موتور صدای سبک با کد {proc.returncode} بسته شد (خطای داخلی).")
        with wave.open(out.name, "rb") as wf:
            sr = wf.getframerate()
            pcm = _wav_pcm(wf)
        _diag("piper_pcm", voice=voice_key, header_sr=sr, n=len(pcm))
        if len(pcm) == 0:
            raise RuntimeError("خروجی صدا خالی بود — دوباره امتحان کنید.")
        offs = None
        try:
            meta = json.loads(Path(out.name + ".offsets.json").read_text(encoding="utf-8"))
            offs = [pcm[a:a + n].copy() for a, n in meta["offsets"]]
        except Exception:
            pass
        # a function that sometimes returns 2 values and sometimes 3 is a
        # landmine (it detonated in the field as a raw unpack error on the
        # user's screen). One shape, always: parts is None when absent.
        return pcm, sr, offs
    finally:
        for p in (out.name, taskf.name, out.name + ".offsets.json"):
            try:
                os.unlink(p)
            except OSError:
                pass


def _wav_pcm(wf):
    """Read a worker WAV defensively: reject exotic widths, downmix stereo —
    misreading interleaved channels as mono is pure high-frequency garbage."""
    if wf.getsampwidth() != 2:
        raise RuntimeError("قالب صدای موتور پشتیبانی نمی‌شود (عرض نمونهٔ غیر ۱۶بیت).")
    pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    if wf.getnchannels() == 2:
        pcm = pcm.reshape(-1, 2).astype(np.float32).mean(axis=1).astype(np.int16)
    return pcm


_PIPER_CARRIER = "این یک آزمایش است."
_CBX_CARRIER = "این یک آزمایش است."



def piper_generate(voice_key, text, speed, noise_scale, noise_w, status):
    pcm, sr, _ = piper_pcm(voice_key, _pause_segments(text), speed, noise_scale, noise_w, status)
    if pcm is not None and len(pcm) and _band_displaced(pcm, sr):
        _diag("piper_main_displaced", voice=voice_key, chars=len(text))
        raise RuntimeError(
            "این صدا جمله\u200cهای خیلی کوتاه را خراب می\u200cخواند (محدودیت خود مدل). "
            "متن را به یک جملهٔ کامل برسانید یا صدای دیگری برگزینید.")
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


# A diacritic detached from a letter (after space/ZWNJ/punctuation) makes
# espeak SPEAK ITS NAME ("tashdid", "sāken") — attached marks work perfectly
# and must survive untouched, including stacks like شدّهِ.
_ORPHAN_MARKS = re.compile(
    r"(?<![\u0621-\u063A\u0641-\u064A\u066E-\u06D3\u06D5\u064B-\u0655\u0670])"
    r"[\u064B-\u0655\u0670]+")


def _strip_orphan_marks(t):
    return _ORPHAN_MARKS.sub("", t)
_CBX_JUNK = re.compile(r"[\[\]{}<>|~^*_#@$%&+=\\\u2010-\u2027\u2030-\u205E]")


_EZAFE_TAIL = re.compile("\u0650(?=[\\s\u200c]*(?:$|[.!?\u061f\u061b\u060c\u2026]))")


def _pause_join(items):
    """Continuous-mode spoken string, pause-aware. EVERY pause marker joins
    with «.» — the one boundary the model reliably realizes as absolute
    silence — and the markers differ only in the timed silence spliced in
    (— 0.25 s, … 0.35 s, [مکث] 0.5 s, [مکث بلند] 1.2 s). One mechanism, four
    durations, no boundary ever left to glide. An ezafe-tailed clause still
    binds forward with a plain space; existing punctuation is never doubled."""
    out, prev_t, pending = "", None, None
    for i in items:
        if i["kind"] == "p":
            pending = max(pending or 0.0, i["sec"])
            continue
        if prev_t is not None:
            if _EZAFE_TAIL.search(prev_t):
                out += " "
            elif prev_t.rstrip() and prev_t.rstrip()[-1] in ".!?؟؛،…":
                out += " "  # clause already ends in punctuation — no doubling
            elif pending is not None:
                out += ". "
            else:
                out += "؛ "
        out += i["text"]
        prev_t, pending = i["text"], None
    return out


def _ezafe_join(texts):
    """Join clause texts for one continuous utterance. Normal boundaries get
    «، » so the model breathes there; but a clause ENDING in ezafe kasre binds
    grammatically forward — «دوستانِ،» is unpronounceable and the model crushes
    or babbles the word (measured: a 0.18 s unvoiced burst where «دوستانِ»
    belongs). Those boundaries join with a plain space: the model speaks the
    bound phrase naturally, and the aligner-guided cut still separates the
    words at their boundary valley so the requested pause is spliced in full."""
    out = ""
    for k, t in enumerate(texts):
        if k:
            # «؛» is a stronger break cue than «،» without a full stop's
            # intonation reset — the model leaves a longer genuine dip at tag
            # boundaries, so cuts land in real breath instead of glide.
            out += " " if _EZAFE_TAIL.search(texts[k - 1]) else "؛ "
        out += t
    return out


def _despoken_tail_ezafe(t):
    """A STANDALONE fragment ending in ezafe makes chatterbox hallucinate the
    continuation the kasre promises (measured: «دوستانِ» alone -> 0.68 s ending
    hot mid-babble). For the spoken form only, drop a clause-final kasre; the
    user's stored text keeps it untouched."""
    return _EZAFE_TAIL.sub("", t)


def _cbx_sanitize(t):
    """The Persian chatterbox checkpoint garbles exotic punctuation into
    noise and can corrupt neighboring phonemes — whitelist-clean its input.
    Orphaned diacritics are junk for it too."""
    return re.sub(r"\s+", " ", _CBX_JUNK.sub(" ", _strip_orphan_marks(t))).strip()


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
            # all four markers splice real silence, in every engine — the
            # chatterbox fa checkpoint turned … and — into noise artifacts
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
    items = [i for i in items if i["kind"] == "p" or i["text"]]
    if engine == "chatterbox":
        # token-model fidelity (sukun honoring, phoneme stability) degrades on
        # short fragments — absorb undersized clauses into a same-run neighbor;
        # pause boundaries are never crossed (audio must gap there)
        MIN = 40
        changed = True
        while changed:
            changed = False
            for k, i in enumerate(items):
                if i["kind"] != "t" or len(i["text"]) >= MIN:
                    continue
                prev = items[k - 1] if k > 0 else None
                nxt = items[k + 1] if k + 1 < len(items) else None
                mate = prev if (prev and prev["kind"] == "t") else (nxt if (nxt and nxt["kind"] == "t") else None)
                if mate is None:
                    continue
                a0 = min(i["span"][0], mate["span"][0])
                b0 = max(i["span"][1], mate["span"][1])
                mate.update(text=text[a0:b0].strip(), span=(a0, b0),
                            gap=max(i.get("gap", 0.0), mate.get("gap", 0.0)))
                items.pop(k)
                changed = True
                break
    return items


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
        try:
            import psutil
            _rss = psutil.Process().memory_info().rss // (1024 * 1024)
            _avail = psutil.virtual_memory().available // (1024 * 1024)
            # rss is the honest signal: macOS compresses/swaps to keep "avail"
            # looking fine while a leaking process swells — brake on OURSELVES
            _swap = _swap_growth_mb()
            ok_b, _why_b = _mem_check("cbx_brake", max(0, _rss - 2000), _avail if _avail >= 800 else None)
            if not ok_b or _avail < 800:
                raise RuntimeError(
                    f"حافظهٔ موتور در میانهٔ ساخت از حد گذشت ({faDigits(_rss // 1024)} گیگابایت) — "
                    "این بخش متوقف شد تا دستگاه قفل نشود؛ موتور تازه‌سازی می‌شود. "
                    "همین بخش را دوباره بسازید.")
        except RuntimeError:
            raise
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
def _swap_used_mb():
    try:
        import psutil
        return int(psutil.swap_memory().used // (1024 * 1024))
    except Exception:
        return 0


_SWAP_BASELINE = _swap_used_mb()


def _swap_growth_mb():
    """Swap GROWTH since this app launched. Absolute system swap punished the
    user for state a relaunch can't clear (field-measured lockout: the app
    refused all work after its own crash because yesterday's swap was still
    draining). Growth resets with every launch — the gate measures US."""
    return max(0, _swap_used_mb() - _SWAP_BASELINE)


# =========================================================================
# UNIFIED MEMORY PROTOCOL (build 76) — the user's doctrine, verbatim:
# "the cap and the entire ram management protocols should be applied to
#  both the chatterbox worker and the main process, or any other leaker
#  that may exist, not just one or the other."
# One policy table, one check primitive, one guarded runner. A new process
# gets a ROW here, never a bespoke gate. Enforcement differs only by what
# physics allows: a worker dies and respawns; main refuses and instructs.
# =========================================================================
_MEM_POLICY = {
    #  role         rss_cap_mb  swap_growth_kill_mb   note
    "main":        {"cap": 6000,  "swap": 10000},   # refuse jobs + relaunch advice
    "cbx":         {"cap": None,  "swap": 4000},    # cap=None -> band rule ceiling
    "cbx_admit":   {"cap": None,  "swap": 6000},
    "cbx_brake":   {"cap": None,  "swap": 12000},   # band rule + 2000 slack applied at site
    "piper":       {"cap": 5000,  "swap": 8000},    # deterministic small model
    "align":       {"cap": 8000,  "swap": 8000},    # wav2vec2-large + activations
}


def _mem_check(role, rss_mb, avail_mb):
    """(ok, reason) under the unified policy. rss_cap None means the adaptive
    band-rule ceiling; a number is an absolute cap for that role."""
    pol = _MEM_POLICY[role]
    cap = pol["cap"] if pol["cap"] is not None else _cbx_ceiling_mb(rss_mb, avail_mb)
    if rss_mb is not None and rss_mb > cap:
        return False, f"rss>{cap}"
    if _swap_growth_mb() > pol["swap"]:
        return False, f"swap_growth>{pol['swap']}"
    if avail_mb is not None and avail_mb < 1500 and role != "main":
        return False, "avail<1500"
    return True, ""


def _guarded_run(argv, role, timeout):
    """subprocess.run with the SAME mid-job brake every process deserves:
    poll the child's rss and system swap growth against the policy; breach
    kills the child. Piper and align never had a mid-job cap before this."""
    import psutil
    creation = {"creationflags": 0x08000000} if os.name == "nt" else {}
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **creation)
    t0 = time.time()
    child = None
    try:
        child = psutil.Process(proc.pid)
    except Exception:
        pass
    while proc.poll() is None:
        if time.time() - t0 > timeout:
            proc.kill()
            _diag("mem_gate", role=role, action="timeout_kill")
            break
        rss = None
        try:
            rss = int(child.memory_info().rss // 1048576) if child else None
        except Exception:
            pass
        ok, why = _mem_check(role, rss, None)
        if not ok:
            proc.kill()
            _diag("mem_gate", role=role, action="brake_kill", rss=rss, reason=why)
            break
        time.sleep(0.5)
    out, err = proc.communicate(timeout=30)
    return types.SimpleNamespace(returncode=proc.returncode, stdout=out, stderr=err)


def _cbx_ceiling_mb(rss_mb, avail_mb):
    """Two ceilings, whichever is LOWER wins.
    (1) The adaptive pool ceiling: 75% of (avail + rss) — shrinks on busy
        machines. Alone it is leak-unsafe: it only retires at rss > 3x avail,
        which on a 48 GB Mac authorizes ~36 GB of growth (measured: 57 GB
        reached twice, because macOS compresses memory and keeps "avail"
        looking healthy while rss swells into swap).
    (2) The absolute leak cap: the model itself needs 5-6 GB; anything much
        past that is leaked memory the process holds hostage. Retire near
        10 GB and the OS reclaims it for the price of a few-second respawn."""
    lo_fence, hi_fence = 9000, 19000
    try:
        import psutil
        total = psutil.virtual_memory().total // (1024 * 1024)
        # the fences scale with the machine: never retire a warm model below
        # ~20% of total (respawn churn), never let a leak past 40% of total
        # (the honest signal — macOS "available" flatters under pressure)
        lo_fence = max(9000, int(0.20 * total))
        hi_fence = max(lo_fence + 1000, int(0.40 * total))
    except Exception:
        pass
    if avail_mb is None:
        return lo_fence
    # inside the band, the documented pool rule governs: 75% of what the
    # machine would have if the worker retired right now — an idle machine
    # grants headroom (fewer respawns), a busy one pulls the ceiling down
    pool = int(0.75 * (avail_mb + rss_mb))
    return min(max(pool, lo_fence), hi_fence)
_cbx_proc = None
_cbx_stderr = None
_cbx_lock = threading.Lock()
_cbx_last_rss = 0  # worker rss (MB) as of its last finished job


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
            ok_m, why_m = _mem_check("cbx", rss, avail_mb)
            recycle = not ok_m
            if recycle:
                _diag("mem_gate", role="cbx", action="retire", rss=rss, reason=why_m)
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
        global _cbx_proc, _cbx_last_rss
        # ---- per-generation admission gate ----
        # The worker retires AFTER a job crosses the ceiling; this is the other
        # bracket: never ADMIT a job into a bloated worker. Measured failure
        # mode: back-to-back jobs each starting on top of leaked memory until
        # 57 GB. A fresh worker returns every leaked byte to the OS first.
        avail_mb = None
        try:
            import psutil
            avail_mb = psutil.virtual_memory().available // (1024 * 1024)
        except Exception:
            pass
        if _cbx_proc is not None and _cbx_proc.poll() is None and _cbx_last_rss:
            ok_a, why_a = _mem_check("cbx_admit", _cbx_last_rss, avail_mb)
            over = "rss>" in why_a
            swapped = "swap" in why_a
            if not ok_a:
                _diag("admission_recycle", rss=_cbx_last_rss, avail=avail_mb,
                      swap=_swap_growth_mb(),
                      reason="ceiling" if over else ("swap" if swapped else "low_avail"))
                status("پاک‌سازی حافظهٔ موتور پیش از ساخت این بخش…")
                try:
                    _cbx_proc.terminate()
                except Exception:
                    pass
                _cbx_proc = None
                _cbx_last_rss = 0
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
                err = msg.get("error", "خطای ناشناخته")
                if "در میانهٔ ساخت از حد گذشت" in err and not req.get("_brake_retry"):
                    # the brake stopped a runaway — the job gets ONE fresh
                    # worker before the user ever sees an error (the user's
                    # doctrine: a ceiling protects the machine, not at the
                    # price of silently costing them their job).
                    _diag("mem_gate", role="cbx", action="retry_after_brake")
                    try:
                        p.terminate()
                    except Exception:
                        pass
                    _cbx_proc = None
                    _cbx_last_rss = 0
                    req2 = dict(req)
                    req2["_brake_retry"] = True
                    status("موتور تازه\u200cسازی شد؛ همین بخش دوباره ساخته می\u200cشود…")
                    return chatterbox_via_worker(req2, status)
                raise RuntimeError(err)
            elif t == "result":
                _cbx_last_rss = int(msg.get("rss_mb") or 0)
                with wave.open(msg["path"], "rb") as wf:
                    sr = wf.getframerate()
                    pcm = _wav_pcm(wf)
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
                    _cbx_last_rss = 0
                if offs is not None:
                    return pcm, sr, [pcm[a:a + n].copy() for a, n in offs]
                return pcm, sr
        # stdout closed: the worker died mid-job
        _cbx_proc = None
        _cbx_last_rss = 0
        tail = "\n".join(list(_cbx_stderr or [])[-8:])
        raise RuntimeError("موتور چترباکس ناگهان بسته شد" +
                           (":\n" + tail if tail else " — دوباره امتحان کنید."))


def _synth_clauses(items, payload, status):
    """Synthesize the text-kind items in place (fills item['pcm']), one
    engine call for the whole batch. Chatterbox input is sanitized; a clause
    that sanitizes to nothing becomes a short breath instead of a crash."""
    engine = payload["engine"]
    t_items = [i for i in items if i["kind"] == "t"]
    if not t_items:
        return 22050
    texts, live = [], []
    for i in t_items:
        raw = i.pop("_synth_text", None)
        c = (_cbx_sanitize(raw if raw is not None else _despoken_tail_ezafe(i["text"]))
             if engine == "chatterbox" else (raw if raw is not None else i["text"]).strip())
        if c:
            texts.append(c); live.append(i)
    sr = 24000 if engine == "chatterbox" else 22050
    if texts:
        if engine == "chatterbox":
            _mem_preflight(status)
            res = chatterbox_via_worker(
                {"clauses": texts, "text": " ".join(texts),
                 "exaggeration": payload.get("exaggeration", 0.8),
                 "cfg_weight": payload.get("cfg_weight", 1.0),
                 "temperature": payload.get("temperature", 0.0),
                 "speed": payload.get("cbx_speed", 1.0)}, status)
        else:
            res = piper_pcm(engine, [{"t": t} for t in texts], payload.get("speed", 1.0),
                            payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
        pcm, sr, parts = res
        parts = parts if parts is not None else [pcm]
        for i, p in zip(live, parts):
            i["pcm"] = p
    for i in t_items:
        if i.get("pcm") is None:
            i["pcm"] = np.zeros(int(sr * 0.15), dtype=np.int16)
        else:
            i["pcm"] = _tail_gate(i["pcm"], sr)
    return sr


def _tail_gate(pcm, sr):
    """Trim junk tails off synthesized fragments. Junk = the vocoder noise
    floor chatterbox trails into (measured: hi-band-dominated, hi/lo 77-347,
    at 20-30% of body RMS — too loud for an amplitude gate, unmistakable
    spectrally) or plain dead air. A duration guard protects genuine word-final
    sibilants: a real «س» ending runs ~80-120 ms; the squeal runs 200 ms+."""
    hop = int(0.050 * sr)
    if len(pcm) < 5 * hop:
        return pcm
    body = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    junk = 0
    for k in range(1, len(pcm) // hop):
        seg = pcm[len(pcm) - (k + 1) * hop: len(pcm) - k * hop + hop].astype(np.float64)
        lvl = float(np.sqrt(np.mean(seg ** 2)))
        sp = np.abs(np.fft.rfft(seg)) ** 2
        fr = np.fft.rfftfreq(len(seg), 1.0 / sr)
        lo_e = float(sp[(fr > 150) & (fr < 4000)].sum())
        hi_e = float(sp[fr > 5000].sum())
        noisy = lvl < 0.35 * body and hi_e / max(lo_e, 1e-9) > 2.0
        dead = lvl < max(0.05 * body, 60.0)
        if noisy or dead:
            junk = k
        else:
            break
    run = junk * hop
    if run < int(0.180 * sr):
        return pcm  # shorter than a legit final sibilant could be — keep
    keep = len(pcm) - run + int(0.080 * sr)
    _diag("tail_gate", trimmed_ms=int(1000 * (len(pcm) - keep) / sr))
    return _fade_edges(pcm[:keep].copy(), sr, ms=15)


def _assemble(entry):
    sr = entry["sr"]
    out = []
    for i in entry["items"]:
        if i["kind"] == "p":
            tone = i.get("pcm")
            if isinstance(tone, np.ndarray) and tone.dtype == np.int16 and len(tone) > 0:
                out.append(tone)  # budgeted fill: natural edges + fill = the tag's promise
            else:
                out.append(np.zeros(int(sr * i["sec"]), dtype=np.int16))
        else:
            out.append(i["pcm"])
            if i.get("gap"):
                out.append(np.zeros(int(sr * i["gap"]), dtype=np.int16))
    return np.concatenate(out) if out else np.zeros(1, dtype=np.int16)


def _mem_report(tag):
    try:
        import psutil
        pr = psutil.Process()
        _diag("mem", tag=tag, main_rss_mb=int(pr.memory_info().rss // 1048576),
              swap_mb=_swap_used_mb(), swap_growth_mb=_swap_growth_mb(),
              threads=pr.num_threads())
    except Exception:
        pass


_MAIN_RSS_CAP_MB = 6000  # mirrored in _MEM_POLICY["main"]["cap"]


def _main_watchdog():
    """The 75% ceiling always governed the worker; MAIN had no cap because it
    was assumed light — the assumption that hid four crashes. Now main gets
    its own hard bound, checked before every job."""
    try:
        import psutil
        rss = int(psutil.Process().memory_info().rss // 1048576)
    except Exception:
        return
    ok, why = _mem_check("main", rss, None)
    if not ok:
        _diag("mem_gate", role="main", action="refuse", rss_mb=rss, reason=why)
        raise RuntimeError(
            f"هستهٔ برنامه به سقف حافظهٔ خود رسیده ({faDigits(rss // 1024)} گیگابایت) — "
            "برنامه را ببندید و دوباره باز کنید؛ این وضعیت ثبت شد تا ریشه\u200cیابی شود.")


def _mem_preflight(status):
    _main_watchdog()
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
    if _swap_growth_mb() > 10000:
        raise RuntimeError(
            f"برنامه در همین نشست {faDigits(_swap_growth_mb() // 1024)} گیگابایت سواپ اشغال کرده — "
            "برنامه را ببندید و دوباره باز کنید؛ با باز شدن دوباره، شمارش از صفر آغاز می\u200cشود.")
    if avail_mb is not None and avail_mb < 2000:
        raise RuntimeError(
            f"حافظهٔ آزاد برای صدای چترباکس کافی نیست ({faDigits(avail_mb)} مگابایت). "
            "چند برنامهٔ دیگر را ببندید و دوباره امتحان کنید — ادامه‌دادن در این وضعیت دستگاه را قفل می‌کند.")
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
_SPILL_DIR = None


def _spill_entry(entry, gid):
    """Main-process prevention, not defense: an entry's audio arrays move to
    disk immediately after assembly and come back as read-only memory-maps.
    RAM cost of a stored entry drops to ~zero while patching stays exact —
    a memory-mapped array slices and concatenates like any other. Session
    length no longer grows the main process."""
    global _SPILL_DIR
    import tempfile
    if _SPILL_DIR is None:
        _SPILL_DIR = tempfile.mkdtemp(prefix="ava-spill-")
    for k, i in enumerate(entry.get("items", [])):
        p = i.get("pcm")
        if isinstance(p, np.ndarray) and len(p) and not isinstance(p, np.memmap):
            path = os.path.join(_SPILL_DIR, f"g{gid}-i{k}.npy")
            np.save(path, np.ascontiguousarray(p, dtype=np.int16))
            i["pcm"] = np.load(path, mmap_mode="r")
    return entry


_gulp_ids = _it.count(1)


def reset_gulps():
    _GULP_PCM.clear()
    global _SPILL_DIR
    if _SPILL_DIR:
        import shutil
        shutil.rmtree(_SPILL_DIR, ignore_errors=True)
        _SPILL_DIR = None


def _rep_beat(pcm, sr):
    """Extract ONE beat from a triple-repetition synthesis. The model cannot
    speak two isolated words (fragments hallucinate — measured), but it CAN
    speak them in a rhythm; three near-identical beats give the output a
    self-similarity peak at one-third lag. The boundary comes from the
    audio's own periodicity — no aligner, no cutting of unique speech."""
    n = len(pcm)
    if n < sr // 2:
        return None
    w = max(1, sr // 50)
    env = np.convolve(np.abs(pcm.astype(np.float32)), np.ones(w, dtype=np.float32) / w, mode="same")
    e = env - env.mean()
    ac = np.correlate(e, e, "full")[n - 1:]
    ac = ac / (ac[0] + 1e-12)
    l1, l2 = int(0.22 * n), int(0.45 * n)
    if l2 <= l1 + 8:
        return None
    lag = l1 + int(np.argmax(ac[l1:l2]))
    if float(ac[lag]) < 0.35:
        return None  # no rhythm found — repetition didn't take
    a, b = max(w, int(lag * 0.80)), min(n - w, int(lag * 1.08))
    if b <= a:
        return None
    cut = a + int(np.argmin(env[a:b]))
    beat = pcm[:_zc_snap(pcm, cut, sr)]
    beat = _sweep_stubs(_fade_edges(beat.copy(), sr, ms=10), sr)
    if len(beat) < sr // 8:
        return None
    _diag("rep_beat", lag_s=round(lag / sr, 2), ac=round(float(ac[lag]), 2),
          beat_s=round(len(beat) / sr, 2))
    return beat


def _silence_runs(pcm, sr, min_ms=70):
    """All true-silence runs in the utterance: (start, end, center) of every
    stretch where the 20 ms envelope stays under max(4% body, 60) for at
    least min_ms. With «.» joins these are the model's own sentence stops."""
    body = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    thr = max(60.0, 0.04 * body)
    w = max(1, sr // 50)
    sm = np.convolve(np.abs(pcm.astype(np.float32)), np.ones(w, dtype=np.float32) / w, mode="same")
    runs, a = [], None
    e = w // 2 + 1
    for k in range(e, len(sm) - e):
        if sm[k] <= thr:
            if a is None:
                a = k
        elif a is not None:
            if k - a >= int(min_ms * sr / 1000):
                runs.append((a, k, (a + k) // 2))
            a = None
    if a is not None and (len(sm) - e) - a >= int(min_ms * sr / 1000):
        runs.append((a, len(sm) - e, (a + len(sm) - e) // 2))
    return runs


def _cbx_continuous(items, payload, status):
    """Chatterbox babbles on the tiny fragments that pause tags create.
    Instead: speak the WHOLE text as one natural utterance (tags → commas),
    then cut the finished audio at the tag positions via alignment and let
    the requested silences be spliced in. Returns sr, or None to fall back."""
    t_items = [i for i in items if i["kind"] == "t"]
    spoken = _cbx_sanitize(_pause_join(items))
    if not spoken:
        return None
    _mem_preflight(status)
    res = chatterbox_via_worker(
        {"clauses": [spoken], "text": spoken,
         "exaggeration": payload.get("exaggeration", 0.8),
         "cfg_weight": payload.get("cfg_weight", 1.0),
         "temperature": payload.get("temperature", 0.0),
         "speed": payload.get("cbx_speed", 1.0)}, status)
    pcm, sr = res[0], res[1]
    aligned = _align_words(pcm, sr, spoken, status)
    words_per = [len(re.findall(r"\S+", i["text"])) for i in t_items]
    if aligned is None or len(aligned) != sum(words_per):
        _diag("continuous_bail", reason="align_none" if aligned is None else
              f"count_{len(aligned)}_vs_{sum(words_per)}")
        return None
    # ---- CARRIER MODE for small chunks (field lesson of builds 68-70) ----
    # Micro-sentences make the model glide: measured 0-9 ms of usable quiet,
    # so EVERY cut lands in voice and no dressing saves it. The piper carrier
    # proved the alternative: each short chunk is spoken behind a carrier
    # sentence, the model's reliable stop after a LONG sentence yields true
    # silence, the chunk is extracted after it, and chunks + timed zeros
    # assemble without ever cutting flowing speech.
    if any(len(i["text"].strip()) < 25 for i in t_items):
        # (build 73) the carrier is REMOVED — the model glides straight
        # through it into short sentences (field-measured). Repetition-beat
        # synthesis replaces it: each chunk spoken three times in a comma
        # flow, one beat extracted by the output's own self-similarity.
        shadow = [dict(i) for i in t_items]
        for sh in shadow:
            base = _despoken_tail_ezafe(sh["text"]).strip().rstrip(".!؟?")
            sh["_synth_text"] = f"{base}، {base}، {base}."
        sr_c = _synth_clauses(shadow, payload, status)
        okc = True
        for i, sh in zip(t_items, shadow):
            p = sh.get("pcm")
            if p is None or not len(p):
                okc = False
                break
            tgt = _rep_beat(p, sr_c)
            if tgt is None:
                okc = False
                break
            i["pcm"] = tgt
        if okc:
            _diag("carrier_mode", chunks=len(t_items))
            prev_t = None
            for idx, i in enumerate(items):
                if i["kind"] == "t":
                    prev_t = i
                elif i["kind"] == "p":
                    nxt_t = next((j for j in items[idx + 1:] if j["kind"] == "t"), None)
                    sec_fill = _budget_pause(prev_t, i, nxt_t, sr_c)
                    i["pcm"] = np.zeros(int(sr_c * sec_fill), dtype=np.int16)
            return sr_c
        _diag("carrier_mode", chunks=len(t_items), failed=True)
        # (build 72) extraction failed -> per-chunk FRAGMENT synthesis. The
        # cutting pipeline is FORBIDDEN for small chunks: its drifted
        # fallback split a word in half in the field («دوس|تانِ»). A fragment
        # chunk can sound plain; a torn word is always worse.
        frag = [dict(i) for i in t_items]
        for f in frag:
            f.pop("_synth_text", None)
            f["pcm"] = None
        sr_f = _synth_clauses(frag, payload, status)
        if all(f.get("pcm") is not None and len(f["pcm"]) for f in frag):
            for i, f in zip(t_items, frag):
                i["pcm"] = _sweep_stubs(_fade_edges(f["pcm"].copy(), sr_f, ms=10), sr_f)
            prev_t = None
            for idx, i in enumerate(items):
                if i["kind"] == "t":
                    prev_t = i
                elif i["kind"] == "p":
                    nxt_t = next((j for j in items[idx + 1:] if j["kind"] == "t"), None)
                    sec_fill = _budget_pause(prev_t, i, nxt_t, sr_f)
                    i["pcm"] = np.zeros(int(sr_f * sec_fill), dtype=np.int16)
            _diag("carrier_mode", chunks=len(t_items), mode="fragment_rescue")
            return sr_f
        return None

    # ---- SILENCE-FIRST boundary location (the field lesson of build 65) ----
    # wav2vec2's word timings drift on this audio; a drifted search window
    # made a cut land a quarter-second INSIDE the next word («دوس|تانِ»,
    # measured: 0.16 s left of a 0.5 s word, voicing 0.78 at the cut).
    # Silence is the primary signal — with «.» joins the model leaves one
    # true silence per boundary. Find them in the audio itself; alignment
    # only breaks ties or fills in when a silence is missing.
    B = len(t_items) - 1
    runs = _silence_runs(pcm, sr)
    cuts, w, ok_all = [0], 0, True
    if B > 0 and len(runs) >= B:
        if len(runs) == B:
            chosen = runs
            _diag("cuts_by_silence", runs=len(runs), mode="exact")
        else:
            # more silences than boundaries: keep the B runs nearest the
            # aligned boundary estimates, order-preserving
            marks = []
            wa = 0
            for n in words_per[:-1]:
                wa += n
                marks.append((int(aligned[wa - 1][2]) + int(aligned[wa][1])) // 2)
            avail = list(runs)
            chosen = []
            for m in marks:
                pick = min(avail, key=lambda r: abs(r[2] - m))
                chosen.append(pick)
                avail = [r for r in avail if r[2] > pick[2]]
                if not avail and len(chosen) < B:
                    break
            _diag("cuts_by_silence", runs=len(runs), mode="nearest")
        if len(chosen) == B and all(chosen[k][2] < chosen[k + 1][2] for k in range(B - 1)):
            for r in chosen:
                cuts.append(_zc_snap(pcm, _fry_snap(pcm, r[2], sr), sr))
        else:
            chosen = None
    else:
        chosen = None
    if chosen is None:
        # fewer silences than boundaries — the model glided somewhere.
        # Aligned-window graded cutting per boundary, as before.
        _diag("cuts_by_silence", runs=len(runs), mode="fallback_aligned")
        for n in words_per[:-1]:
            w += n
            c, ok = _gap_cut(pcm, aligned, w - 1, sr)
            ok_all = ok_all and ok
            cuts.append(c)
    cuts.append(len(pcm))
    if not ok_all or not _slices_sane(cuts, len(pcm)):
        _diag("continuous_bail", reason="no_dip" if not ok_all else "slices_insane")
        return None   # no true dip to cut in → fragments with real pauses
    for k, i in enumerate(t_items):
        # boundary grade decides the dressing: cuts in true silence keep the
        # short safety fade; VOICED cuts (micro-sentence glide, measured at
        # 0.57-0.69 voicing) get a long 40 ms landing and a 20 ms rise —
        # when clean surgery is impossible, graceful surgery is mandatory.
        q_out = _voicing_score(pcm, cuts[k + 1], sr) if k + 1 < len(cuts) - 1 else 0.0
        q_in = _voicing_score(pcm, cuts[k], sr) if k > 0 else 0.0
        i["pcm"] = _fade_asym(pcm[cuts[k]:cuts[k + 1]].copy(), sr,
                              in_ms=20 if q_in >= 0.4 else 12,
                              out_ms=40 if q_out >= 0.4 else 15)
    tk = 0
    prev_t = None
    for idx, i in enumerate(items):
        if i["kind"] == "t":
            tk += 1
            prev_t = i
        elif 0 < tk < len(cuts):
            nxt_t = next((j for j in items[idx + 1:] if j["kind"] == "t"), None)
            sec_fill = _budget_pause(prev_t, i, nxt_t, sr)
            i["pcm"] = _pause_fill(pcm, cuts[tk], sr, sec_fill)
    status("مکث‌ها با هم‌ترازی در جای نشانه‌ها بریده شدند — متن یک‌جا و طبیعی خوانده شد.")
    return sr


def _verify_entry(entry, where):
    """Structural invariants: the stored items must exactly mirror what the
    gulp's text implies. A violation raises instead of ever becoming audio."""
    try:
        expected = _clause_split(entry["text"], entry.get("engine") or "chatterbox")
        exp_keys = [("t", i["text"]) if i["kind"] == "t" else ("p", i["sec"]) for i in expected]
        got_keys = [("t", i["text"]) if i["kind"] == "t" else ("p", i["sec"]) for i in entry["items"]]
        assert exp_keys == got_keys, "structure"
        for i in entry["items"]:
            if i["kind"] == "t":
                p = i.get("pcm")
                assert isinstance(p, np.ndarray) and p.dtype == np.int16 and len(p) > 0, "pcm"
            else:
                assert i["sec"] > 0, "sec"
        assert int(entry["sr"]) > 0, "sr"
    except AssertionError as e:
        raise RuntimeError(
            f"ناهماهنگی داخلی در ساخت صدا شناسایی شد (مرحلهٔ {where}/{e}). "
            "برای جلوگیری از خروجی خراب، این بخش را دوباره کامل بازتولید کنید.")


def _heal_entry(entry, status):
    """A corrupt gulp is rebuilt from its own text and stored settings —
    repair first, error only if repair itself fails."""
    status("ناهماهنگی داخلی شناسایی شد — ترمیم خودکار این بخش…")
    payload = dict(entry.get("payload") or {})
    payload["engine"] = entry.get("engine") or payload.get("engine") or "chatterbox"
    payload["text"] = entry["text"]
    items = _clause_split(entry["text"], payload["engine"])
    if not any(i["kind"] == "t" for i in items):
        raise RuntimeError("ترمیم ممکن نیست — این بخش متنی برای خواندن ندارد.")
    sr = None
    if (payload["engine"] == "chatterbox"
            and any(i["kind"] == "p" for i in items)
            and any(i["kind"] == "t" and len(i["text"]) < 40 for i in items)):
        try:
            sr = _cbx_continuous(items, payload, status)
        except Exception:
            sr = None
        if sr is None:
            for i in items:
                i.pop("pcm", None)
    if sr is None:
        sr = _synth_clauses(items, payload, status)
    entry.update({"items": items, "sr": sr})
    _verify_entry(entry, "ترمیم")
    status("بخش خودکار ترمیم و از نو ساخته شد.")


def _ensure_valid(entry, where, status):
    try:
        _verify_entry(entry, where)
    except RuntimeError:
        try:
            _heal_entry(entry, status)
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(
                f"ترمیم خودکار این بخش ممکن نشد ({str(e)[:60]}) — "
                "بخش را دستی دوباره بسازید و اتصال اینترنت را بررسی کنید.")


def _slices_sane(cuts, total):
    """Cut positions must be strictly increasing inside the audio."""
    return all(0 <= a < b <= total for a, b in zip(cuts, cuts[1:])) if len(cuts) > 1 else True


def generate_gulp(payload, status):
    """One gulp → clause-wise synthesis, stored per clause for surgical patching."""
    text = payload["text"].strip()
    items = _clause_split(text, payload["engine"])
    if not any(i["kind"] == "t" for i in items):
        raise RuntimeError("این بخش متنی برای خواندن ندارد — فقط نشانهٔ مکث است.")
    sr = None
    if (payload["engine"] == "chatterbox"
            and any(i["kind"] == "p" for i in items)
            and any(i["kind"] == "t" and len(i["text"]) < 40 for i in items)):
        try:
            sr = _cbx_continuous(items, payload, status)
        except Exception as e:
            status(f"خواندن یک‌جا ممکن نشد ({str(e)[:40]}) — تکه‌به‌تکه ساخته می‌شود.")
            sr = None
        if sr is None:
            for i in items:
                i.pop("pcm", None)
    if sr is None:
        sr = _synth_clauses(items, payload, status)
    gid = next(_gulp_ids)
    entry = {"sr": sr, "items": items, "text": text, "engine": payload["engine"],
             "payload": {k: payload[k] for k in
                         ("exaggeration", "cfg_weight", "temperature", "cbx_speed",
                          "speed", "noise", "noisew") if k in payload}}
    _ensure_valid(entry, "تولید", status)
    _GULP_PCM[gid] = _spill_entry(entry, gid)
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


def _align_feed(pcm, sr):
    """16 kHz feed for wav2vec2 — anti-aliased. A naive decimation folds the
    8-12 kHz band onto the speech band and drags every CTC boundary with it."""
    if sr != 16000:
        pcm = _resample(pcm, sr, 16000)
    return pcm.astype(np.float32) / 32768.0


def align_worker_main(task_path):
    """Disposable alignment worker: torch, torchaudio, and the wav2vec2
    model live and DIE here. Four identical main-process deaths (56 GB, 18
    threads) with every guard aimed at the chatterbox worker — the aligner
    was the resident torch stack in main all along. Now nothing of it
    survives a call."""
    import json as _json
    with open(task_path, encoding="utf-8") as f:
        task = _json.load(f)
    pcm = np.fromfile(task["pcm_path"], dtype=np.int16)
    res = _align_words_core(pcm, int(task["sr"]), task["text"], lambda m: None)
    out = {"ok": res is not None,
           "spans": [[w, int(a), int(b)] for w, a, b in (res or [])]}
    with open(task["out_path"], "w", encoding="utf-8") as f:
        _json.dump(out, f, ensure_ascii=False)
    try:
        import psutil
        _diag("align_worker_exit", rss_mb=int(psutil.Process().memory_info().rss // 1048576))
    except Exception:
        pass


def _align_words(pcm, sr, text, status):
    """Subprocess wrapper with the historical signature. The heavy body is
    _align_words_core, executed only inside the disposable worker."""
    import tempfile, json as _json
    _mem_report("align_call")
    with tempfile.TemporaryDirectory() as td:
        pcm_path = os.path.join(td, "a.raw")
        out_path = os.path.join(td, "r.json")
        np.asarray(pcm, dtype=np.int16).tofile(pcm_path)
        task = os.path.join(td, "t.json")
        with open(task, "w", encoding="utf-8") as f:
            _json.dump({"pcm_path": pcm_path, "sr": int(sr),
                        "text": text, "out_path": out_path}, f, ensure_ascii=False)
        creation = {"creationflags": 0x08000000} if os.name == "nt" else {}
        try:
            status("هم\u200cترازسازی واژه\u200cها…")
            proc = _guarded_run([sys.executable, "--align-worker", task],
                                "align", 420)
            for ln in (proc.stderr or b"").decode("utf-8", "ignore").splitlines():
                if "[ava-diag]" in ln:
                    sys.stderr.write(ln + "\n")
            if proc.returncode != 0 or not os.path.exists(out_path):
                _diag("align_worker_fail", rc=proc.returncode)
                return None
            with open(out_path, encoding="utf-8") as f:
                out = _json.load(f)
        except Exception as e:
            _diag("align_worker_fail", err=type(e).__name__)
            return None
    if not out.get("ok"):
        return None
    return [(w, a, b) for w, a, b in out["spans"]]


def _align_words_core(pcm, sr, text, status):
    """Force-align clause audio to its words → [(word, start_sample, end_sample)].
    Returns None when alignment isn't trustworthy; caller falls back."""
    _load_aligner(status)
    import torch, torchaudio
    x = _align_feed(pcm, sr)
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


def _resample(pcm, sr_from, sr_to):
    """Anti-aliased resampling. Bare linear interpolation folds high
    frequencies into audible hiss when downsampling (mana is 44.1 kHz;
    chatterbox gulps are 24 kHz) — low-pass first, then interpolate."""
    if sr_from == sr_to or len(pcm) == 0:
        return pcm
    x = pcm.astype(np.float64)
    if sr_to < sr_from:
        cutoff = 0.45 * sr_to / sr_from
        taps = 101
        m = np.arange(taps) - (taps - 1) / 2
        h = np.sinc(2 * cutoff * m) * np.hamming(taps)
        h /= h.sum()
        x = np.convolve(x, h, mode="same")
    n = int(round(len(x) * sr_to / sr_from))
    y = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return np.clip(y, -32768, 32767).astype(np.int16)


def _refine_cut(pcm, lo, hi, sr):
    """The quietest sample inside an inter-word gap — a midpoint cut clips
    co-articulated speech; the energy valley doesn't."""
    lo, hi = max(0, int(lo)), min(len(pcm), int(hi))
    if hi - lo < max(8, sr // 200):
        return (lo + hi) // 2
    seg = np.abs(pcm[lo:hi].astype(np.float32))
    w = max(1, sr // 1000)
    sm = np.convolve(seg, np.ones(w) / w, mode="same")
    return lo + int(np.argmin(sm))


def _fry_snap(pcm, pos, sr):
    """If the neighborhood of a cut carries pulse structure (fry), move the
    cut into the inter-pulse floor right AFTER a pulse's decay — a cut
    landing mid-pulse is the sharpest stutter the app can produce."""
    a, b = max(0, pos - int(0.030 * sr)), min(len(pcm), pos + int(0.030 * sr))
    seg = pcm[a:b].astype(np.float64)
    if len(seg) < 200:
        return pos
    sm = np.abs(seg)
    k = max(1, sr // 200)
    env = np.convolve(sm, np.ones(k) / k, mode="same")
    floor = np.percentile(env, 25)
    pk = np.percentile(env, 95)
    if pk < 4 * max(floor, 40.0):
        return pos  # no pulse structure here
    j = int(np.argmin(env))
    return a + j


def _zc_snap(pcm, pos, sr, radius_ms=2.0):
    """Editors' rule: cuts belong on rising zero-crossings — a join at
    matching height and direction is silent, anywhere else the residual step
    leaks click energy through even a good fade. Snap the chosen cut to the
    nearest rising crossing within +/-2 ms (imperceptible as a shift)."""
    r = int(sr * radius_ms / 1000.0)
    lo, hi = max(1, pos - r), min(len(pcm) - 1, pos + r)
    if hi <= lo:
        return pos
    seg = pcm[lo - 1:hi + 1].astype(np.int32)
    rising = np.nonzero((seg[:-1] < 0) & (seg[1:] >= 0))[0]
    if len(rising) == 0:
        return pos
    cand = lo - 1 + rising + 1
    return int(cand[np.argmin(np.abs(cand - pos))])


def _unvoiced_at(pcm, pos, sr):
    """Quiet is not unvoiced: a soft voiced trail smooths below the energy
    threshold and still carries pitch — cutting there clips the word. Gate
    EVERY accepted cut on the absence of periodicity around the point.
    The window's two HALVES are tested separately as well: at a soft-voice /
    loud-onset transition the loud side dominates a full-window correlation
    and drowns the quiet side's pitch (measured: true 150 Hz collapsing to
    0.26). Voice on either side of the knife means the knife is in voice."""
    a, b = max(0, pos - int(0.030 * sr)), min(len(pcm), pos + int(0.030 * sr))
    for s0, s1 in ((a, b), (a, pos), (pos, b)):
        seg = pcm[s0:s1].astype(np.float64)
        if len(seg) < int(0.015 * sr):
            continue
        seg = seg - seg.mean()
        if float(np.sqrt(np.mean(seg ** 2))) < 60.0:
            continue  # effectively digital silence — nothing to voice
        ac = np.correlate(seg, seg, "full")[len(seg) - 1:]
        ac = ac / (ac[0] + 1e-12)
        l1, l2 = int(sr / 400), min(int(sr / 55), len(ac) - 1)
        if l2 > l1 and float(np.max(ac[l1:l2])) >= 0.45:
            return False
    return True


def _voicing_score(pcm, pos, sr):
    """Max periodicity (55-400 Hz) across the gate's three windows — the
    continuous measure behind _unvoiced_at's yes/no."""
    a, b = max(0, pos - int(0.030 * sr)), min(len(pcm), pos + int(0.030 * sr))
    worst = 0.0
    for s0, s1 in ((a, b), (a, pos), (pos, b)):
        seg = pcm[s0:s1].astype(np.float64)
        if len(seg) < int(0.015 * sr):
            continue
        seg = seg - seg.mean()
        if float(np.sqrt(np.mean(seg ** 2))) < 60.0:
            continue
        ac = np.correlate(seg, seg, "full")[len(seg) - 1:]
        ac = ac / (ac[0] + 1e-12)
        l1, l2 = int(sr / 400), min(int(sr / 55), len(ac) - 1)
        if l2 > l1:
            worst = max(worst, float(np.max(ac[l1:l2])))
    return worst


def _gap_cut(pcm, aligned, i, sr):
    """Cut point between word i and i+1 under a QUIETNESS CONTRACT: the chosen
    sample must sit in a genuine dip, because a faded amputation is still an
    amputation. The window widens once if alignment drifted; if no true dip is
    reachable, ok=False and the caller must fall back rather than cut speech."""
    body = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    thr = max(0.10 * body, 60.0)
    # 20 ms smoothing: longer than any glottal period. A 1 ms window slips
    # BETWEEN voice pulses and reads a held vowel as "silence" — measured as
    # cuts landing mid-voicing (periodicity 0.85 at the fade) in sample_1.
    w = max(1, sr // 50)
    min_run = int(0.012 * sr)  # longer than any glottal cycle (80 Hz -> 12.5 ms period)
    pad0 = int(0.04 * sr)
    valley = (None, None, None, None)  # (abs_pos, level, pass_lo, pass_sm)
    for pad in (pad0, pad0 + int(0.12 * sr)):
        lo = max(0, int(aligned[i][2]) - pad)
        hi = min(len(pcm), int(aligned[i + 1][1]) + pad)
        if hi - lo < sr // 100:
            continue
        seg = np.abs(pcm[lo:hi].astype(np.float32))
        sm = np.convolve(seg, np.ones(w) / w, mode="same")
        mask = sm <= thr
        if mask.any():
            # cut at the CENTER of the longest quiet run — mid-dip, so the word's
            # natural decay stays with its own slice and the next slice opens clean
            best = (-1, -1); a = None
            for k in range(len(mask) + 1):
                if k < len(mask) and mask[k]:
                    if a is None:
                        a = k
                elif a is not None:
                    if k - a > best[1] - best[0]:
                        best = (a, k)
                    a = None
            if best[1] - best[0] >= min_run:
                # the raw energy minimum hugs the run's leading edge, right
                # where the word's decay ends — a voicing window there reaches
                # back into speech. Choose the most INTERIOR point of the run
                # that is both under threshold and verifiably unvoiced.
                step = max(1, int(0.005 * sr))
                mid = (best[0] + best[1]) // 2
                cands = sorted(range(best[0], best[1], step), key=lambda g: abs(g - mid))
                for g in cands:
                    if sm[g] <= thr and _unvoiced_at(pcm, lo + g, sr):
                        return _zc_snap(pcm, lo + g, sr), True
                # no point in this run clears the voice gate — not a cut region
            # quiet moments existed but none long enough to be real silence
        e = w // 2 + 1  # 'same'-mode convolution zero-pads the edges -> fake dips there
        if len(sm) > 2 * e:
            j = e + int(np.argmin(sm[e:len(sm) - e]))
            if valley[1] is None or sm[j] < valley[1]:
                valley = (lo + j, float(sm[j]), lo, sm)
    if valley[0] is not None and valley[1] <= 0.40 * body:
        # a valley may only be cut if it is genuinely UNVOICED — measured
        # defect: soft-knee cuts landed in glided speech at voicing 0.75-0.87
        # and clipped word ends. Scan the whole sub-40% region nearest the
        # quietest point first — the raw argmin hugs edges where a voicing
        # window touches speech.
        vlo, vsm = valley[2], valley[3]
        e2 = w // 2 + 1
        ok_lvl = [g for g in range(e2, len(vsm) - e2, max(1, int(0.005 * sr)))
                  if vsm[g] <= 0.40 * body]
        for g in sorted(ok_lvl, key=lambda g: abs(vlo + g - valley[0])):
            if _unvoiced_at(pcm, vlo + g, sr):
                return _zc_snap(pcm, vlo + g, sr), True
    # GRADED LAST TIER — the field lesson of build 64: one stubborn boundary
    # refusing used to discard the WHOLE continuous synthesis into fragment
    # babble, the worst outcome the app produces. Cut at the least-voiced
    # admissible instant instead: with the fry-aware score steering it away
    # from pulses, a soft imperfect cut beats wholesale gibberish every time.
    if valley[0] is not None and valley[3] is not None:
        vlo, vsm = valley[2], valley[3]
        e2 = w // 2 + 1
        cands = [g for g in range(e2, len(vsm) - e2, max(1, int(0.005 * sr)))
                 if vsm[g] <= 0.60 * body]
        if cands:
            g = min(cands, key=lambda g: (_voicing_score(pcm, vlo + g, sr), vsm[g]))
            _diag("gap_cut_soft", at=round((vlo + g) / sr, 3),
                  voicing=round(_voicing_score(pcm, vlo + g, sr), 2))
            return _zc_snap(pcm, vlo + g, sr), True
    lo, hi = int(aligned[i][2]), int(aligned[i + 1][1])
    return max(0, (lo + hi) // 2), False



def _band_displaced(pcm, sr):
    """Detector for the measured mana-patch corruption: speech displaced onto a
    ~7.75 kHz carrier — hi/lo 187.9, baseband annihilated for the WHOLE island.
    Criterion is sustained displacement, so legitimate sibilants (a س slice
    measures hi/lo 2-18 for a few windows, with vowel windows in between) pass.
    Analysis capped at 2 s; float32; bounded and allocation-light."""
    if len(pcm) < 4096:
        return False
    x = pcm[: int(2.0 * sr)].astype(np.float32)
    if float(np.sqrt(np.mean(x.astype(np.float64) ** 2))) < 40.0:
        return False
    w = int(0.100 * sr)
    n_win = max(1, len(x) // w)
    dead = 0
    for k in range(n_win):
        seg = x[k * w:(k + 1) * w]
        sp = np.abs(np.fft.rfft(seg)) ** 2
        fr = np.fft.rfftfreq(len(seg), 1.0 / sr)
        lo_e = float(sp[(fr > 150) & (fr < 4000)].sum())
        hi_e = float(sp[fr > 5000].sum())
        tot = float(sp.sum()) or 1.0
        if hi_e / max(lo_e, 1e-9) > 8.0 and lo_e / tot < 0.05:
            dead += 1
    frac = dead / n_win
    if frac >= 0.7:
        _diag("band_displaced", dead_windows=dead, of=n_win)
        return True
    return False


def _room_tone(src_pcm, cut_pos, sr, sec):
    """A spliced pause of DIGITAL ZERO against chatterbox's audible vocoder
    floor (measured 557-3051 int16) reads as a hole punched in the audio.
    Fill the pause with the utterance's OWN quiet texture: harvest ~40 ms of
    the quietest real audio around the cut, tile it forward/backward with
    equal-power seams (reversal kills tile periodicity), cap the level so a
    semi-voiced valley can never become a hum."""
    n_out = int(sr * sec)
    w = int(0.040 * sr)
    lo = max(0, cut_pos - int(0.060 * sr))
    hi = min(len(src_pcm), cut_pos + int(0.060 * sr))
    if hi - lo < w or n_out <= 0:
        return np.zeros(max(n_out, 0), dtype=np.int16)
    seg = src_pcm[lo:hi].astype(np.float32)
    best, brms = 0, None
    for s in range(0, len(seg) - w, w // 4):
        r = float(np.sqrt(np.mean(seg[s:s + w] ** 2)))
        if brms is None or r < brms:
            best, brms = s, r
    tile = seg[best:best + w].copy()
    # Continuity illusion: the ear only accepts the gap as "the same recording
    # going quiet" if the fill sits AT the local floor. A fixed cap left hot
    # floors stepping down several dB into the pause. Play the harvested tile
    # at its natural level; scale down only a semi-voiced valley (>12% of the
    # utterance body RMS can carry pitch, and a pitched pause is a hum).
    body_all = float(np.sqrt(np.mean(src_pcm.astype(np.float64) ** 2))) or 1.0
    cap = min(max(0.06 * body_all, 150.0), 450.0)
    if brms and brms > cap:
        tile *= cap / brms
    xf = int(0.010 * sr)
    t = np.linspace(0, np.pi / 2, xf, dtype=np.float32)
    out = np.zeros(n_out + w, dtype=np.float32)
    pos, k = 0, 0
    while pos < n_out:
        piece = tile if k % 2 == 0 else tile[::-1]
        if pos == 0:
            out[:w] = piece
        else:
            out[pos:pos + xf] = out[pos:pos + xf] * np.cos(t) + piece[:xf] * np.sin(t)
            out[pos + xf:pos + w] = piece[xf:]
        pos += w - xf
        k += 1
    out = out[:n_out]
    if n_out > 2 * xf:
        out[:xf] *= np.sin(t)
        out[-xf:] *= np.cos(t)
    return out.astype(np.int16)


def _stretch_dip(src_pcm, cut_pos, sr, sec):
    """Best-available pause body: take the model's real dip around the cut —
    however short — and time-stretch IT to the requested length with WSOLA.
    The pause becomes the speaker's own breath elongated: right floor, right
    texture, no foreign material. Returns None when there is no usable dip
    or the stretcher is unavailable; caller falls back to tiled room tone."""
    try:
        body = float(np.sqrt(np.mean(src_pcm.astype(np.float64) ** 2))) or 1.0
        w = max(1, sr // 50)
        x = np.abs(src_pcm.astype(np.float32))
        sm = np.convolve(x, np.ones(w, dtype=np.float32) / w, mode="same")
        # harvest the dip extent at 15% of body (real vocoder floors run
        # 8-14% and must be reachable); the stutter guards are downstream:
        # 20 ms edge trims, the pitch check, and the peak check — a snippet
        # touching the word's decay edge gets its transients REPEATED by
        # WSOLA (the measured stutter blip), so anything speech-like bails.
        thr = 0.15 * body
        a = cut_pos
        while a > 0 and sm[a - 1] < thr and cut_pos - a < int(0.25 * sr):
            a -= 1
        b = cut_pos
        while b < len(sm) and sm[b] < thr and b - cut_pos < int(0.25 * sr):
            b += 1
        a += int(0.020 * sr)
        b -= int(0.020 * sr)
        if b - a < int(0.050 * sr):
            return None
        if (b - a) * 10 < int(sr * sec):
            return None  # >10x stretch repeats material too audibly — use tone
        snippet = src_pcm[a:b].astype(np.float64) / 32768.0
        if float(np.max(np.abs(snippet))) * 32768.0 > 0.35 * float(np.max(np.abs(src_pcm))):
            return None  # a transient spike survived the walk — not breath
        s0 = snippet - snippet.mean()
        ac = np.correlate(s0, s0, "full")[len(s0) - 1:]
        ac = ac / (ac[0] + 1e-12)
        l1, l2 = int(sr / 400), min(int(sr / 70), len(ac) - 1)
        if l2 > l1 and float(np.max(ac[l1:l2])) > 0.55:
            return None  # pitched content survived the walk — not breath
        n_out = int(sr * sec)
        from audiotsm import wsola
        from audiotsm.io.array import ArrayReader, ArrayWriter
        reader = ArrayReader(snippet.reshape(1, -1))
        writer = ArrayWriter(1)
        # default WSOLA frames (~85 ms) barely fit a 100-150 ms breath snippet
        # and truncate extreme stretches; 25 ms frames are safe for unpitched
        # breath/floor material and track any stretch ratio
        wsola(1, speed=len(snippet) / max(n_out, 1),
              frame_length=max(64, int(0.025 * sr)),
              synthesis_hop=max(32, int(0.0125 * sr))).run(reader, writer)
        y = writer.data.flatten()
        while 0 < len(y) < n_out:
            y = np.concatenate([y, y[::-1][:n_out - len(y)]])
        y = y[:n_out] * 32768.0
        cap = min(max(0.06 * body, 150.0), 450.0)
        r = float(np.sqrt(np.mean(y ** 2)))
        if r > cap:
            y *= cap / r
        xf = int(0.010 * sr)
        if n_out > 2 * xf:
            t = np.linspace(0, np.pi / 2, xf)
            y[:xf] *= np.sin(t)
            y[-xf:] *= np.cos(t)
        _diag("stretch_dip", src_ms=int(1000 * (b - a) / sr), out_ms=int(1000 * sec))
        return np.clip(y, -32768, 32767).astype(np.int16)
    except Exception as e:
        _diag("stretch_dip", failed=type(e).__name__)
        return None


def _edge_quiet(pcm, sr, leading):
    """Length of near-silence at a slice's edge (20 ms smoothed, 2% body)."""
    if len(pcm) < 64:
        return 0
    body = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    thr = max(60.0, 0.02 * body)
    w = max(1, sr // 50)
    x = np.abs(pcm.astype(np.float32))
    sm = np.convolve(x, np.ones(w, dtype=np.float32) / w, mode="same")
    n = 0
    it = range(len(sm)) if leading else range(len(sm) - 1, -1, -1)
    for k in it:
        if sm[k] > thr:
            break
        n += 1
    return n


def _budget_pause(prev_item, p_item, next_item, sr):
    """The model's own boundary silence plus the inserted silence must SUM to
    the tag's promise — with «.» joins the natural gap alone runs 200-400 ms
    and naive insertion made a [مکث] last 0.7-0.9 s. Keep 40 ms of natural
    edge on each side, trim the excess, insert exactly the remainder."""
    M = int(0.040 * sr)
    kept = 0
    for item, lead in ((prev_item, False), (next_item, True)):
        p = None if item is None else item.get("pcm")
        if not isinstance(p, np.ndarray) or len(p) < 4 * M:
            kept += 0
            continue
        q = _edge_quiet(p, sr, lead)
        keep = min(q, M)
        trim = q - keep
        if trim > int(0.010 * sr):
            cutpt = trim if lead else len(p) - trim
            if not _unvoiced_at(p, cutpt, sr):
                trim = 0  # the trim boundary would sit in voice or fry — keep it all
        if trim > int(0.010 * sr):
            newp = p[trim:] if lead else p[:len(p) - trim]
            # a trimmed edge is a fresh cut — it gets a fresh fade, or it clicks
            item["pcm"] = _fade_edges(newp.copy(), sr, ms=10)
            _diag("pause_budget_trim", ms=int(1000 * trim / sr), edge="lead" if lead else "trail")
        kept += keep
    return max(0.05, p_item["sec"] - kept / sr)


def _pause_fill(src_pcm, cut_pos, sr, sec):
    """The user's design, adopted as the contract: when the cut sits in the
    model's ABSOLUTE silence (the normal case now that pause tags end
    sentences), the pause is pure timed digital silence — silence against
    silence has no cliff and nothing injected can stutter. Only when a cut
    had to land on a nonzero floor does a low matched tone (no event, no
    structure) bridge the texture. Deterministic in both branches."""
    n_out = int(sr * sec)
    if n_out <= 0:
        return np.zeros(0, dtype=np.int16)
    a = max(0, cut_pos - int(0.010 * sr))
    b = min(len(src_pcm), cut_pos + int(0.010 * sr))
    local = float(np.sqrt(np.mean(src_pcm[a:b].astype(np.float64) ** 2))) if b > a else 0.0
    body = float(np.sqrt(np.mean(src_pcm.astype(np.float64) ** 2))) or 1.0
    if local < max(80.0, 0.02 * body):
        return np.zeros(n_out, dtype=np.int16)
    tone = _room_tone(src_pcm, cut_pos, sr, sec).astype(np.float32)
    t_rms = float(np.sqrt(np.mean(tone.astype(np.float64) ** 2))) or 1.0
    tone *= min(1.0, local / t_rms)
    fade = min(int(0.120 * sr), n_out // 3)
    if fade > 1:
        tone[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade, dtype=np.float32)) ** 2
    return np.clip(tone, -32768, 32767).astype(np.int16)


def _fade_asym(pcm, sr, in_ms=12, out_ms=15):
    """Boundary fades shaped like speech: quick attack in, short safety
    landing out. The landing is deliberately SHORT: cuts now sit at the
    energy minimum where decay is already complete, and a long fade there
    reaches back INTO the decay and reads as truncation."""
    out = pcm.astype(np.float32)
    n_in = min(int(sr * in_ms / 1000), len(out) // 2)
    n_out = min(int(sr * out_ms / 1000), len(out) // 2)
    if n_in > 0:
        out[:n_in] *= np.sin(np.linspace(0, np.pi / 2, n_in, dtype=np.float32))
    if n_out > 0:
        out[-n_out:] *= np.cos(np.linspace(0, np.pi / 2, n_out, dtype=np.float32)) ** 2
    return out.astype(np.int16)


def _fade_edges(pcm, sr, ms=8):
    n = min(int(sr * ms / 1000), len(pcm) // 2)
    if n <= 0:
        return pcm
    out = pcm.astype(np.float32)
    t = np.linspace(0, np.pi / 2, n, dtype=np.float32)
    out[:n] *= np.sin(t)
    out[-n:] *= np.cos(t)
    return out.astype(np.int16)


def _crossfade_join(parts, sr, ms=15):
    n = int(sr * ms / 1000)
    out = parts[0].astype(np.float32)
    for p in parts[1:]:
        p = p.astype(np.float32)
        if n > 0 and len(out) >= n and len(p) >= n:
            t = np.linspace(0, np.pi / 2, n, dtype=np.float32)
            out = np.concatenate([out[:-n],
                                  out[-n:] * np.cos(t) + p[:n] * np.sin(t),
                                  p[n:]])
        else:
            out = np.concatenate([out, p])
    return np.clip(out, -32768, 32767).astype(np.int16)


def _sweep_stubs(pcm, sr):
    """A patched clause must be ONE speech body. A detached micro-island at
    an edge — measured in the field as a 0.10 s aperiodic blob sitting 0.32 s
    after the real word — is surgery/synthesis debris, never language: no
    Persian word is 120 ms of noise floating 150+ ms away from its clause.
    Sweep such stubs off both edges, keeping 40 ms of natural silence."""
    if len(pcm) < sr // 5:
        return pcm
    body = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    thr = max(60.0, 0.05 * body)
    w = max(1, sr // 50)
    sm = np.convolve(np.abs(pcm.astype(np.float32)), np.ones(w, dtype=np.float32) / w, mode="same")
    isl, a = [], None
    for k in range(len(sm)):
        if sm[k] > thr:
            if a is None:
                a = k
        elif a is not None:
            isl.append((a, k))
            a = None
    if a is not None:
        isl.append((a, len(sm)))
    merged = []
    for i0, i1 in isl:
        if merged and i0 - merged[-1][1] < int(0.08 * sr):
            merged[-1] = (merged[-1][0], i1)
        else:
            merged.append((i0, i1))
    def _aperiodic(i0, i1):
        seg = pcm[i0:i1].astype(np.float64)
        if len(seg) < 200:
            return True
        seg = seg - seg.mean()
        if float(np.sqrt(np.mean(seg ** 2))) < 60.0:
            return True
        ac = np.correlate(seg, seg, "full")[len(seg) - 1:]
        ac = ac / (ac[0] + 1e-12)
        l1, l2 = int(sr / 400), min(int(sr / 55), len(ac) - 1)
        return l2 <= l1 or float(np.max(ac[l1:l2])) < 0.40

    changed = True
    while changed and len(merged) > 1:
        changed = False
        if (merged[-1][1] - merged[-1][0] < int(0.120 * sr)
                and merged[-1][0] - merged[-2][1] >= int(0.150 * sr)
                and _aperiodic(*merged[-1])):
            _diag("stub_sweep", edge="trail", ms=int(1000 * (merged[-1][1] - merged[-1][0]) / sr))
            pcm = pcm[:merged[-2][1] + int(0.040 * sr)]
            merged = merged[:-1]
            changed = True
        elif (merged[0][1] - merged[0][0] < int(0.120 * sr)
                and merged[1][0] - merged[0][1] >= int(0.150 * sr)
                and _aperiodic(*merged[0])):
            _diag("stub_sweep", edge="lead", ms=int(1000 * (merged[0][1] - merged[0][0]) / sr))
            cutp = max(0, merged[1][0] - int(0.040 * sr))
            pcm = pcm[cutp:]
            merged = [(a - cutp, b - cutp) for a, b in merged[1:]]
            changed = True
    return _fade_edges(pcm.copy(), sr, ms=10) if changed or True else pcm


def _word_surgery(entry, old_item, new_item, sel_start, sel_end, payload, status):
    """Replace only the selected word window inside one clause's audio.
    The replacement is synthesized WITH one neighbor word of context on each
    side, then the context is trimmed off via alignment — short bare inputs
    make chatterbox babble at the edges; context keeps the middle clean.
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

    def cut_after(al, i, buf):   # boundary between word i and i+1, in a true dip
        c, ok = _gap_cut(buf, al, i, sr)
        return c if ok else None
    a_cut = 0 if pre_w == 0 else cut_after(aligned, pre_w - 1, old_pcm)
    b_cut = len(old_pcm) if suf_w == 0 else cut_after(aligned, len(old_words) - suf_w - 1, old_pcm)
    if a_cut is None or b_cut is None:
        return None   # no quiet boundary around the edit → resynthesize the clause plainly
    mid_words = new_words[pre_w:len(new_words) - suf_w]

    def synth(words):
        txt = " ".join(words)
        engine = payload["engine"]
        if engine == "chatterbox":
            txt = _cbx_sanitize(_despoken_tail_ezafe(txt)) or "،"
            res = chatterbox_via_worker(
                {"clauses": [txt], "text": txt,
                 "exaggeration": payload.get("exaggeration", 0.8),
                 "cfg_weight": payload.get("cfg_weight", 1.0),
                 "temperature": payload.get("temperature", 0.0),
                 "speed": payload.get("cbx_speed", 1.0)}, status)
        else:
            res = piper_pcm(engine, [{"t": txt}], payload.get("speed", 1.0),
                            payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
        pcm, sr2 = res[0], res[1]
        _diag("surgery_synth", engine=engine, sr2=sr2, entry_sr=sr, n=len(pcm))
        out = _resample(pcm, sr2, sr)
        if engine != "chatterbox" and _band_displaced(out, sr):
            # (build 72) same honest contract as everywhere else: this is the
            # model failing on a short sentence, not a transient to retry.
            raise RuntimeError(
                "این صدا جمله\u200cهای خیلی کوتاه را خراب می\u200cخواند (محدودیت خود مدل). "
                "متن این بخش را به یک جملهٔ کامل برسانید یا صدای دیگری برگزینید.")
        return out

    if mid_words:
        status(f"جراحی واژه‌ای: بازتولید «{' '.join(mid_words)[:40]}»…")
        ctx_l = [new_words[pre_w - 1]] if pre_w > 0 else []
        ctx_r = [new_words[len(new_words) - suf_w]] if suf_w > 0 else []
        synth_words = ctx_l + mid_words + ctx_r
        new_mid = synth(synth_words)
        if ctx_l or ctx_r:
            al2 = _align_words(new_mid, sr, " ".join(synth_words), status)
            trimmed = None
            if al2 is not None and len(al2) == len(synth_words):
                lo = cut_after(al2, len(ctx_l) - 1, new_mid) if ctx_l else 0
                hi = cut_after(al2, len(synth_words) - len(ctx_r) - 1, new_mid) if ctx_r else len(new_mid)
                exp = len(new_mid) * len(mid_words) / max(1, len(synth_words))
                if 0 <= lo < hi <= len(new_mid) and 0.35 * exp <= (hi - lo) <= 2.2 * exp:
                    trimmed = new_mid[lo:hi]
            if trimmed is not None:
                new_mid = trimmed
            else:
                status("هم‌ترازیِ برشِ زمینه قابل‌اعتماد نبود — بازتولید بدون زمینه…")
                new_mid = synth(mid_words)
    else:
        new_mid = np.zeros(int(sr * 0.05), dtype=np.int16)  # pure deletion → tiny breath
    replaced = old_pcm[a_cut:b_cut]
    if len(replaced) > sr // 20 and len(new_mid) > sr // 20:
        r_old = float(np.sqrt(np.mean(replaced.astype(np.float64) ** 2)))
        r_new = float(np.sqrt(np.mean(new_mid.astype(np.float64) ** 2)))
        if r_old > 1 and r_new > 1:
            gain = min(2.0, max(0.5, r_old / r_new))
            new_mid = np.clip(new_mid.astype(np.float64) * gain, -32768, 32767).astype(np.int16)
    new_item["pcm"] = _sweep_stubs(
        _crossfade_join([old_pcm[:a_cut], new_mid, old_pcm[b_cut:]], sr), sr)
    return max(1, len(mid_words))


def _cbx_patch_middle(entry, new_items, pre, suf, payload, status):
    """Regenerating a SHORT chatterbox clause in isolation babbles. Borrow the
    neighboring clauses' TEXT as spoken context (their audio stays reused),
    read the whole neighborhood as one utterance, then alignment-cut the
    context off and the middle apart at its pause positions."""
    mid = new_items[pre:len(new_items) - suf]
    mid_t = [i for i in mid if i["kind"] == "t"]
    if not mid_t:
        return False
    ctx_l = next((i for i in reversed(new_items[:pre]) if i["kind"] == "t"), None)
    ctx_r = next((i for i in new_items[len(new_items) - suf:] if i["kind"] == "t"), None)
    pieces = ([ctx_l["text"]] if ctx_l else []) + [i["text"] for i in mid_t] + \
             ([ctx_r["text"]] if ctx_r else [])
    spoken = _cbx_sanitize(_ezafe_join(pieces))
    if not spoken:
        return False
    _mem_preflight(status)
    res = chatterbox_via_worker(
        {"clauses": [spoken], "text": spoken,
         "exaggeration": payload.get("exaggeration", 0.8),
         "cfg_weight": payload.get("cfg_weight", 1.0),
         "temperature": payload.get("temperature", 0.0),
         "speed": payload.get("cbx_speed", 1.0)}, status)
    pcm, sr2 = res[0], res[1]
    sr = entry["sr"]
    pcm = _resample(pcm, sr2, sr)
    aligned = _align_words(pcm, sr, spoken, status)
    counts = [len(re.findall(r"\S+", p)) for p in pieces]
    if aligned is None or len(aligned) != sum(counts):
        return False
    bounds, w = [], 0
    for n in counts:
        w += n
        bounds.append(w)

    def cut_at(word_idx):   # boundary before word word_idx
        if word_idx <= 0:
            return 0
        if word_idx >= len(aligned):
            return len(pcm)
        c, ok = _gap_cut(pcm, aligned, word_idx - 1, sr)
        return c if ok else -1
    k = 0
    lo_words = counts[0] if ctx_l else 0
    pos = lo_words
    planned = []
    p2 = pos
    for cnt in counts[1 if ctx_l else 0:len(counts) - (1 if ctx_r else 0)]:
        planned.append((cut_at(p2), cut_at(p2 + cnt)))
        p2 += cnt
    if not all(0 <= a < b <= len(pcm) for a, b in planned):
        return False   # untrustworthy alignment → clause fallback
    for i, (a, b) in zip(mid_t, planned):
        i["pcm"] = _fade_asym(pcm[a:b].copy(), sr)
        pos += 1
    tj = -1
    prev_t = None
    for idx, i in enumerate(mid):
        if i["kind"] == "t":
            tj += 1
            prev_t = i
        elif i["kind"] == "p":
            cutp = planned[0][0] if tj < 0 else (planned[tj][1] if tj + 1 < len(planned) else planned[-1][1])
            nxt_t = next((j for j in mid[idx + 1:] if j["kind"] == "t"), None)
            sec_fill = _budget_pause(prev_t, i, nxt_t, sr)
            i["pcm"] = _pause_fill(pcm, cutp, sr, sec_fill)
    status("قطعهٔ کوتاه با متن همسایه یک‌جا خوانده و با هم‌ترازی جدا شد.")
    return True


def _fa_errors(fn):
    def wrapped(*a, **k):
        try:
            return fn(*a, **k)
        except RuntimeError:
            raise
        except Exception as e:
            _diag("internal_error", where=fn.__name__, err=type(e).__name__, msg=str(e)[:120])
            raise RuntimeError(
                f"خطای داخلی برنامه رخ داد و ثبت شد ({type(e).__name__}). "
                "لطفاً لاگ برنامه را بفرستید.")
    wrapped.__name__ = fn.__name__
    return wrapped


@_fa_errors
def patch_gulp(gid, new_text, sel_start, sel_end, payload, status):
    """Regenerate only the clauses that the edit/selection touched; every
    other clause's audio is reused bit-identical."""
    entry = _GULP_PCM.get(int(gid))
    if entry is None:
        raise RuntimeError("این بخش دیگر در حافظه نیست — دوباره «تبدیل به گفتار» را بزنید.")
    _ensure_valid(entry, "پایهٔ ویرایش", status)
    new_text = new_text.strip()
    has_sel = sel_start is not None and sel_end is not None and sel_end > sel_start
    # the gulp's clause structure follows its BASE voice; a different voice in
    # the payload re-voices only the selection (the flanks' audio is reusable
    # regardless of which engine once produced it)
    split_engine = entry.get("engine") if has_sel else payload["engine"]
    new_items = _clause_split(new_text, split_engine)
    if not any(i["kind"] == "t" for i in new_items):
        raise RuntimeError("این بخش متنی برای خواندن ندارد — فقط نشانهٔ مکث است.")
    old_items = entry["items"]
    same_engine = has_sel or payload["engine"] == entry.get("engine")

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
    if (has_sel and len(mid_new) == 1 and len(mid_old) == 1
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
        done = False
        if (payload["engine"] == "chatterbox"
                and any(len(i["text"]) < 40 for i in middle)):
            try:
                done = _cbx_patch_middle(entry, new_items, pre, suf, payload, status)
            except Exception:
                done = False
        if not done:
            sr2 = _synth_clauses(middle, payload, status)
            # (build 72) the former trailing-«.» padding is REMOVED: field
            # audio proved piper SPEAKS a lone period as a word — the padding
            # was itself the measured amir gibberish.
            _diag("patch_clauses", engine=payload.get("engine"), sr2=sr2, entry_sr=entry["sr"])
            for i in middle:
                p = i.get("pcm")
                _diag("patch_text", engine=payload.get("engine"),
                      text=i["text"][:60],
                      audio_s=round(len(p) / sr2, 2) if (p is not None and sr2) else None)
            if payload.get("engine") != "chatterbox":
                for i in middle:
                    p = i.get("pcm")
                    if p is not None and len(p) and _band_displaced(p, sr2):
# (build 72) padded-retry and demodulation are REMOVED
                        # from this ladder: piper synthesizes PER SENTENCE, so
                        # a carrier cannot lengthen the failing sentence, and
                        # the demod verifier shipped baseband noise to the
                        # user's ears. A weights-level limitation gets an
                        # honest instruction, not manufactured audio.
                        raise RuntimeError(
                            "این صدا جمله\u200cهای خیلی کوتاه را خراب می\u200cخواند (محدودیت خود مدل). "
                            "متن این بخش را به یک جملهٔ کامل برسانید یا صدای دیگری برگزینید.")
                        break  # unreachable after the raise; kept loop shape
            if sr2 != entry["sr"]:
                for i in middle:
                    p = i.get("pcm")
                    if p is not None and len(p):
                        i["pcm"] = _resample(p, sr2, entry["sr"])
            for i in middle:
                p = i.get("pcm")
                if p is not None and len(p):
                    i["pcm"] = _sweep_stubs(p, entry["sr"])
    entry.update({"items": new_items, "text": new_text,
                  "engine": entry.get("engine") if has_sel else payload["engine"],
                  "payload": {k: payload[k] for k in
                              ("exaggeration", "cfg_weight", "temperature", "cbx_speed",
                               "speed", "noise", "noisew") if k in payload}})
    _ensure_valid(entry, "ویرایش", status)
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
    for k, e in enumerate(entries, 1):
        _ensure_valid(e, f"اتصال بخش {faDigits(k)}", status)
    parts = [(_assemble(e), e["sr"]) for e in entries]
    target = max(sr for _, sr in parts)
    _diag("splice", srs=",".join(str(s) for _, s in parts), target=target)
    gap = np.zeros(int(target * 0.12), dtype=np.int16)
    out = []
    for k, (pcm, sr) in enumerate(parts):
        pcm = _resample(pcm, sr, target)
        out.append(pcm)
        if k < len(parts) - 1:
            out.append(gap)
    return pcm_to_mp3(np.concatenate(out), target)


@_fa_errors
def generate(payload, status) -> bytes:
    mp3, gid = generate_gulp(payload, status)
    _GULP_PCM.pop(gid, None)
    return mp3
