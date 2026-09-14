"""Ava — Persian TTS engines (Chatterbox-Persian + Piper voices + auto-ezafe)."""
import os, json, re, shutil, subprocess, sys, tempfile, threading, time, wave
from pathlib import Path

MODELS_DIR = Path.home() / "AvaModels"
MODELS_DIR.mkdir(exist_ok=True)

# ===========================================================================
# 126 · Activation. Offline, machine-bound, signature-verified. The public key
# only VERIFIES; the private key never exists in this app. See the
# app-licensing skill. No name, no network, nothing identifying on the device.
# ===========================================================================
LICENSE_PUBLIC_KEY = "JQ4J6Onrxcr-z5yNISynPUNTNaIhGJpPwnY-VztumcE"


def license_status():
    """Is this machine activated? Re-verified on every launch and before work."""
    try:
        import licensing
        rec = licensing.load_stored(MODELS_DIR, LICENSE_PUBLIC_KEY)
        if rec:
            return {"ok": True, "id": rec.get("licensee", ""), "expires": rec.get("expires")}
        return {"ok": False, "code": licensing.request_code()}
    except Exception as e:
        return {"ok": False, "code": "", "error": str(e)}


def license_activate(activation):
    try:
        import licensing
        rec = licensing.store_activation(MODELS_DIR, activation, LICENSE_PUBLIC_KEY)
        _diag("license_activated", id=rec.get("licensee", ""))
        return {"ok": True}
    except ValueError as e:
        msg = str(e)
        return {"ok": False, "error": {
            "licence is for a different machine": "این کد فعال‌سازی برای دستگاه دیگری ساخته شده است.",
            "licence signature is invalid": "این کد فعال‌سازی معتبر نیست.",
            "licence has expired": "مهلت این کد فعال‌سازی تمام شده است.",
        }.get(msg, "کد فعال‌سازی پذیرفته نشد.")}
    except Exception:
        return {"ok": False, "error": "کد فعال‌سازی خوانده نشد؛ همهٔ کد را کپی کنید."}


def _require_license():
    """Gate the WORK, not just the window — removing the gate screen does not
    unlock generation."""
    if not license_status()["ok"]:
        raise RuntimeError("این دستگاه فعال نشده است.")
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


BUILD = 129
BUILD_FA = "\u06f1\u06f2\u06f9"


def _diag(tag, **kv):
    """Silent forensic breadcrumbs into stderr/log. Never user-facing, never raises."""
    line = "[ava-diag] " + tag + " " + " ".join(f"{k}={v}" for k, v in kv.items()) + "\n"
    try:
        sys.stderr.write(line)
    except UnicodeEncodeError:
        # legacy Windows codepage on this stream: degrade to ASCII escapes
        # rather than lose the breadcrumb (Persian text and Persian user
        # folders both reach this line).
        try:
            sys.stderr.write(line.encode("unicode_escape").decode("ascii"))
        except Exception:
            pass
    except Exception:
        pass

try:
    _diag("session", build=BUILD)
except Exception:
    pass


# ---------------------------------------------------------------------------
# Cancel (91) — one switch that every engine honours: the cloud call is polled
# and abandoned, the piper helper is killed, the chatterbox worker is killed
# (it respawns on next use). Cleared whenever a new job starts.
# ---------------------------------------------------------------------------
_CANCEL = threading.Event()
_PIPER_PROC = {"p": None}


class Cancelled(RuntimeError):
    def __init__(self):
        super().__init__("لغو شد.")


def cancel():
    _CANCEL.set()
    for p in (_PIPER_PROC.get("p"), globals().get("_cbx_proc")):
        try:
            if p is not None and p.poll() is None:
                p.terminate()
        except Exception:
            pass
    _diag("cancel")


def _check_cancel():
    if _CANCEL.is_set():
        raise Cancelled()


def _job_start():
    _CANCEL.clear()


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
    status(f"دانلود {label}…")
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
                    status(f"دانلود {label}… {int(done*100/total)}٪", pct=int(done * 100 / total))
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
                        status(f"دانلود {name}… {pct}٪", pct=pct)
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
    status("مدل محلیِ حرکت‌گذاری دارد آماده می‌شود… (بار اول حدود ۷۰ مگابایت دانلود دارد)")
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
    status("حرکت‌گذاری با مدل محلی…")
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


# 118: two heavier levels. The LIGHT level is _LLM_PROMPT above, untouched.
_LLM_PROMPT_MEDIUM = (
    "You are a Persian (Farsi) diacritization engine for Iranian text-to-speech, working at a MEDIUM density. "
    "First read and fully comprehend the ENTIRE text - meaning, grammar, context - before deciding anything. "
    "WHAT TO MARK - mark generously, but keep the most familiar function words bare: "
    "(1) kasre-ye ezafe (\u0650) wherever a word links to the next (\u0647\u0654 after final \u0647, \u06cc after final \u0627/\u0648) - never skipped; "
    "(2) EVERY homograph, resolved from context; "
    "(3) EVERY verb form - prefixes (\u0645\u06cc\u200c, \u0628\u0650, \u0646\u064e), stem vowels and personal endings; "
    "(4) every noun, adjective and adverb of two or more syllables, including common ones; "
    "(5) every rare, literary, foreign, fused or morphologically unusual word; "
    "(6) proper names. "
    "LEAVE BARE only the short, extremely familiar function words in their default reading: \u0628\u0647 (preposition), \u0627\u0632, \u062f\u0631, \u0648, \u06a9\u0647, \u0631\u0627, \u0627\u0633\u062a, \u0645\u0646, \u062a\u0648, \u0627\u0648, \u0645\u0627, \u0634\u0645\u0627, \u0622\u0646, \u0627\u06cc\u0646, \u0647\u0645, \u062a\u0627, \u0628\u0627, \u0628\u06cc, \u0627\u06af\u0631, \u0648\u0644\u06cc, \u06cc\u06a9. "
    "HOW TO MARK - two absolute laws: "
    "COMPLETENESS LAW: when you vocalize a word, vocalize it COMPLETELY and syllable-accurately. Work out its syllables first; every consonant not followed by a vowel takes sukun (\u0652), including word-medial clusters. A half-marked word misleads the TTS more than a bare one. "
    "ENDINGS LAW: decide every marked word's final sound explicitly. Final sukun only where the TTS would otherwise invent a trailing vowel; NEVER before punctuation or a pause; word-final \u0647 reads as e; a word linking forward gets the ezafe of rule (1). "
    "Long vowels written with \u0627 \u0648 \u06cc take NO mark themselves; the consonant before them takes the matching short mark only when the reading is ambiguous. "
    "Classical verse MUST follow its established recitation and meter. Dialect: formal Iranian standard Persian (Tehran), never Dari/Afghan or Tajik. "
    "NEVER change, add, delete or reorder any letter, word, number, punctuation, tag in [brackets], or line break - output the SAME text with marks added, nothing else, no explanations."
)
_LLM_PROMPT_HEAVY = (
    "You are a Persian (Farsi) diacritization engine for Iranian text-to-speech, working at FULL density — complete harakat-gozari (حرکت‌گذاری کامل), the Iranian practice, not Arabic tashkil. "
    "First read and fully comprehend the ENTIRE text - meaning, grammar, context - before deciding anything. "
    "MARK EVERY WORD, including the most familiar function words and proper names: every consonant carries its vowel mark "
    "(\u064e fathe, \u0650 kasre, \u064f zamme) or sukun (\u0652) when no vowel follows; tashdid (\u0651) on every doubled consonant; "
    "kasre-ye ezafe (\u0650) wherever a word links to the next (\u0647\u0654 after final \u0647, \u06cc after final \u0627/\u0648). "
    "The ONLY unmarked positions: letters that ARE long vowels (\u0627 \u0648 \u06cc when they read as long a, u, i - their preceding consonant takes the matching short mark), "
    "word-initial \u0627 that carries a hamza-vowel, and the final consonant of a word standing before punctuation or a pause (no final sukun there; the voice closes the word). "
    "Resolve EVERY homograph from context; \u0628\u0647 the preposition is \u0628\u0650\u0647; word-final \u0647 reads as e. "
    "Work out the syllables of every word first and mark it COMPLETELY - a half-marked word is a defect. "
    "Classical verse MUST follow its established recitation and meter. Dialect: formal Iranian standard Persian (Tehran), never Dari/Afghan or Tajik. "
    "NEVER change, add, delete or reorder any letter, word, number, punctuation, tag in [brackets], or line break - output the SAME text with marks added, nothing else, no explanations."
)
_LLM_PROMPTS = {"light": None, "medium": _LLM_PROMPT_MEDIUM, "heavy": _LLM_PROMPT_HEAVY}


def _llm_map(text, status, label, call_one):
    """Run chunks through the LLM with a hard letter-integrity guard:
    if the model altered any letter, retry once; if it alters again,
    keep that chunk unchanged rather than accept corrupted text."""
    chunks = _llm_chunks(text)
    out = []
    for i, ch in enumerate(chunks, 1):
        status(f"حرکت‌گذاری با {label}… تکهٔ {i} از {len(chunks)}")
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


_EZAFE_MODEL = {"name": None}


def _ezafe_pick_model(key):
    """The newest plain Flash text model this key can see (not lite/tts/image/
    live/embedding). Discovered once per session; falls back to a known list.
    FIELD (116): trying dead model names first cost a failed round-trip per
    chunk, and thinking models spent most of the time thinking."""
    if _EZAFE_MODEL["name"]:
        return _EZAFE_MODEL["name"]
    best, best_v = None, -1.0
    try:
        r = requests.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=" + key, timeout=20)
        for m in (r.json().get("models") or []) if r.status_code == 200 else []:
            name = m.get("name", "").split("/")[-1]
            if "generateContent" not in (m.get("supportedGenerationMethods") or []):
                continue
            mm = re.match(r"^gemini-(\d+(?:\.\d+)?)-flash(?:-preview)?$", name)
            if not mm:
                continue
            v = float(mm.group(1)) + (0 if name.endswith("-preview") else 0.01)
            if v > best_v:
                best, best_v = name, v
    except Exception:
        pass
    _EZAFE_MODEL["name"] = best or "gemini-2.5-flash"
    _diag("ezafe_model", model=_EZAFE_MODEL["name"], discovered=bool(best))
    return _EZAFE_MODEL["name"]


def _ezafe_gemini(text, key, status, models=None, label="Gemini", level="light"):
    if models is None:
        # FIELD (119): the newest Flash is constantly "in high demand" and the 2.5
        # names are gone. 3.5 Flash is the workhorse; the discovered newest and the
        # rolling alias are fallbacks.
        picked = _ezafe_pick_model(key)
        models = ["gemini-3.5-flash"] + ([picked] if picked and picked != "gemini-3.5-flash" else []) + ["gemini-flash-latest"]
    prompt = _LLM_PROMPTS.get(level) or _LLM_PROMPT

    def call(ch):
        last_err = None
        for m in models:
            body = {"contents": [{"parts": [{"text": prompt + "\n\nTEXT TO DIACRITIZE:\n" + ch}]}],
                    "generationConfig": {"temperature": 0.1, "thinkingConfig": {"thinkingBudget": 0}}}
            r = requests.post("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + key, json=body, timeout=120)
            if r.status_code == 400 and "thinking" in r.text.lower():
                body["generationConfig"].pop("thinkingConfig", None)
                r = requests.post("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + key, json=body, timeout=120)
            if r.status_code == 200:
                return r.json()["candidates"][0]["content"]["parts"][0]["text"]
            try:
                last_err = r.json().get("error", {}).get("message", f"HTTP {r.status_code}")
            except Exception:
                last_err = f"HTTP {r.status_code}"
            if r.status_code in (503, 500) or "high demand" in last_err.lower() or "overloaded" in last_err.lower():
                _diag("ezafe_overloaded", model=m)
                time.sleep(3.0)                                          # spikes are short: one retry on the same model
                r2 = requests.post("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent?key=" + key, json=body, timeout=120)
                if r2.status_code == 200:
                    return r2.json()["candidates"][0]["content"]["parts"][0]["text"]
                continue                                                 # then the next model
            if not any(k in last_err.lower() for k in ("not found", "not available", "no longer", "deprecated")):
                # quota / bad key errors are the key-rotation's business
                raise _GoogleHTTP(r.status_code, last_err)
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
    _job_start()
    tool = tool or "local"
    if tool.startswith("gemini"):
        # Google tools draw on the shared key list (same keys as the Google
        # voice): a typed key joins the list; quota → next key, automatically.
        key = (key or "").strip()
        if key and key not in [k["key"] for k in google_keys()]:
            google_keys_set([k["key"] for k in google_keys()] + [key])
        if tool == "gemini_pro":
            return google_rotate(lambda k: _ezafe_gemini_pro(text, k, status), status, "حرکت‌گذاری")
        level = {"gemini": "light", "gemini_light": "light", "gemini_medium": "medium", "gemini_heavy": "heavy"}.get(tool, "light")
        return google_rotate(lambda k: _ezafe_gemini(text, k, status, level=level), status, "حرکت‌گذاری")
    if tool != "local":
        key = (key or "").strip() or load_key(tool)
        if not key:
            raise RuntimeError("این ابزار کلید API می‌خواهد؛ یک بار در کادر کلید واردش کنید تا ذخیره شود.")
        save_key(tool, key)
        fn = {"openai": _ezafe_openai, "anthropic": _ezafe_anthropic}[tool]
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


def _is_ascii_path(p):
    try:
        str(p).encode("ascii")
        return True
    except UnicodeEncodeError:
        return False


def _win_short_path(p):
    """Windows 8.3 short name (pure ASCII when available) for a C library
    that only speaks the narrow ANSI API."""
    try:
        import ctypes
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.windll.kernel32.GetShortPathNameW(str(p), buf, 1024)
        return Path(buf.value) if n else None
    except Exception:
        return None


def _espeak_safe_root():
    """Where espeak-ng-data may live on Windows when the home folder is not
    ASCII: Public is ASCII on every Windows install; the system drive root
    is the last resort."""
    for cand in (Path(os.environ.get("PUBLIC", r"C:\Users\Public")) / "AvaModels",
                 Path(os.environ.get("SystemDrive", "C:") + "\\") / "AvaModels"):
        try:
            cand.mkdir(parents=True, exist_ok=True)
            if _is_ascii_path(cand):
                return cand
        except Exception:
            continue
    return None


def _ensure_local_espeak():
    """Copy espeak data out of the bundle into a plain real folder, once —
    and, on Windows, into a folder whose path is pure ASCII. espeak-ng is a
    C library that opens its files through the narrow ANSI API: a Persian
    username makes the home path unrepresentable, espeak cannot find its
    phontab, and every light voice dies at phonemization (field-measured,
    masked as a wave.Error)."""
    found = _find_espeak_data()
    roots = [MODELS_DIR]
    if os.name == "nt" and not _is_ascii_path(MODELS_DIR):
        safe = _espeak_safe_root()
        roots = ([safe] if safe else []) + roots
    for root in roots:
        target = root / "espeak-ng-data"
        try:
            if not (target / "phontab").exists():
                if found is None:
                    continue
                shutil.copytree(found, target, dirs_exist_ok=True)
            if not (target / "phontab").exists():
                continue
            if os.name == "nt" and not _is_ascii_path(target):
                short = _win_short_path(target)
                if short is not None and _is_ascii_path(short) and (short / "phontab").exists():
                    _diag("espeak_path", mode="short83", path=str(short))
                    return short
                continue  # not usable by espeak; try the next root
            _diag("espeak_path", mode="direct", ascii=_is_ascii_path(target), path=str(target))
            return target
        except Exception as e:
            _diag("espeak_path_fail", root=str(root), err=type(e).__name__)
            continue
    return found


def piper_worker_main(task_path: str) -> None:
    """Helper-process entry. Any failure is reported as one ASCII-safe
    [ava-error] line carrying the ROOT cause (chained causes included) and
    a clean non-zero exit — never an OS "unhandled exception" dialog."""
    try:
        _piper_worker_body(task_path)
    except BaseException as e:
        chain, cur, seen = [], e, 0
        while cur is not None and seen < 6:
            chain.append(f"{type(cur).__name__}: {str(cur)[:160]}")
            cur = cur.__context__ or cur.__cause__
            seen += 1
        root = chain[-1] if chain else "unknown"
        try:
            sys.stderr.write("[ava-error] " + (" <= ".join(chain)).encode("unicode_escape").decode("ascii") + "\n")
            sys.stderr.write("[ava-root] " + root.encode("unicode_escape").decode("ascii") + "\n")
            sys.stderr.flush()
        except Exception:
            pass
        os._exit(1)


def _piper_worker_body(task_path: str) -> None:
    """Runs inside the helper process. Synthesizes a list of segments
    ({"t": text} | {"p": seconds}) into one wav, splicing real silence."""
    task = json.loads(Path(task_path).read_text(encoding="utf-8"))
    data_dir = _ensure_local_espeak()
    try:
        import importlib.metadata as _md
        _pv = _md.version("piper-tts")
    except Exception:
        _pv = "?"
    _diag("piper_env", piper=_pv, data=data_dir,
          phontab=(data_dir / "phontab").exists() if data_dir else None)
    if data_dir is None:
        raise RuntimeError("espeak-ng-data missing from the app bundle — rebuild needed")
    # env semantics: espeak expects the PARENT of the espeak-ng-data folder here
    os.environ["ESPEAK_DATA_PATH"] = str(data_dir.parent)
    from piper import PiperVoice
    voice = PiperVoice.load(task["onnx"], espeak_data_dir=str(data_dir))
    length_scale = 1.0 / max(0.25, float(task["speed"]))
    segments = task.get("segments") or [{"t": task["text"]}]

    def synth_to(path, text):
        # NOT a `with` block: if synthesis throws before piper has set the
        # wave header, the context manager's close() raises its own
        # "# channels not specified" and BURIES the real cause (field-
        # measured). Close defensively and re-raise the original.
        wf = wave.open(path, "wb")
        try:
            try:
                from piper import SynthesisConfig
                sc = SynthesisConfig(length_scale=length_scale,
                                     noise_scale=float(task["noise"]),
                                     noise_w_scale=float(task["noisew"]))
                voice.synthesize_wav(text, wf, syn_config=sc)
            except ImportError:
                voice.synthesize(text, wf, length_scale=length_scale,
                                 noise_scale=float(task["noise"]), noise_w=float(task["noisew"]))
        except BaseException:
            try:
                wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(22050)
            except Exception:
                pass  # header already set by piper — nothing to repair
            try:
                wf.close()
            except Exception:
                pass
            raise
        wf.close()

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
    status(f"تنظیمات صدای {voice_key} خراب بود؛ دارم درستش می‌کنم…")
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

    status("دارم گفتار را می‌سازم…")
    segments = [({"t": _strip_orphan_marks(s["t"])} if "t" in s else s) for s in segments]
    out = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); out.close()
    taskf = tempfile.NamedTemporaryFile(suffix=".json", delete=False, mode="w", encoding="utf-8")
    json.dump({"onnx": str(onnx), "segments": segments, "speed": speed,
               "noise": noise_scale, "noisew": noise_w, "out": out.name}, taskf)
    taskf.close()
    try:
        creation = {"creationflags": 0x08000000} if os.name == "nt" else {}
        _check_cancel()
        proc = subprocess.Popen([sys.executable, "--piper-worker", taskf.name],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, **creation)
        _PIPER_PROC["p"] = proc
        try:
            out_b, err_b = proc.communicate(timeout=600)
        finally:
            _PIPER_PROC["p"] = None
        _check_cancel()
        proc = subprocess.CompletedProcess(proc.args, proc.returncode, out_b, err_b)
        try:
            for ln in (proc.stderr or b"").decode("utf-8", "ignore").splitlines():
                if "[ava-diag]" in ln:
                    _diag("worker", line=ln.replace("[ava-diag] ", ""))
        except Exception:
            pass
        if proc.returncode != 0:
            tail = (proc.stderr or b"").decode("utf-8", "ignore").strip().splitlines()[-6:]
            errtxt = (proc.stderr or b"").decode("utf-8", "ignore")
            root = next((l.split("]", 1)[1].strip() for l in errtxt.splitlines()
                         if l.startswith("[ava-root]")), None)
            if root:
                try:
                    root = root.encode("ascii").decode("unicode_escape")
                except Exception:
                    pass
                _diag("piper_worker_root", root=root[:160])
                raise RuntimeError(
                    "موتور صداهای سبک نتوانست این بخش را بسازد. دلیل: " + root +
                    "\nاین خطا در گزارش برنامه ثبت شد؛ اگر باز هم پیش آمد، فایل گزارش (ava.log) را بفرستید.")
            raise RuntimeError("موتور صداهای سبک خطا داد:\n" + "\n".join(tail) if tail
                              else f"موتور صداهای سبک با کد {proc.returncode} بسته شد (خطای داخلی).")
        with wave.open(out.name, "rb") as wf:
            sr = wf.getframerate()
            pcm = _wav_pcm(wf)
        _diag("piper_pcm", voice=voice_key, header_sr=sr, n=len(pcm))
        if len(pcm) == 0:
            raise RuntimeError("صدایی ساخته نشد؛ یک بار دیگر امتحان کنید.")
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


def _wav_pcm(wf):
    """Read a worker WAV defensively: reject exotic widths, downmix stereo —
    misreading interleaved channels as mono is pure high-frequency garbage."""
    if wf.getsampwidth() != 2:
        raise RuntimeError("قالب صدای موتور را نمی‌شناسم (نمونه‌ها ۱۶بیتی نیستند).")
    pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype=np.int16)
    if wf.getnchannels() == 2:
        pcm = pcm.reshape(-1, 2).astype(np.float32).mean(axis=1).astype(np.int16)
    return pcm


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
                    status(f"فایل {name} روی دستگاه خراب بود؛ دوباره دانلودش می‌کنم…")
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
        status("مدل چترباکس دارد از روی دستگاه بارگذاری می‌شود… (یکی دو دقیقه)")
    else:
        status("فقط همین یک بار: مدل چترباکس (حدود ۲ گیگابایت) دانلود می‌شود و از این به بعد روی دستگاه می‌ماند.")

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
        raise RuntimeError("توکن Hugging Face داخل برنامه نیست؛ باید موقع ساختِ برنامه گذاشته می‌شد.")
    status("صدای فارسی دارد آماده می‌شود…")
    fa_path = hf_hub_download(repo_id="Thomcles/Chatterbox-TTS-Persian-Farsi",
                              filename="t3_fa.safetensors", token=token)
    model.t3.load_state_dict(load_safetensors(fa_path, device="cpu"))
    model.t3.to(device).eval()
    _chatterbox = model
    return model


def faDigits(n):
    return str(n).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


_PAUSE_RE = re.compile(r"\[\s*(مکث بلند|مکث)\s*\]")
_PAUSE_SPLIT = re.compile(r"(\[\s*مکث بلند\s*\]|\[\s*مکث\s*\])")   # 90: … and — are plain punctuation again


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
    if engine in ("google", "fish"):
        # Google reads the whole gulp in ONE call (consistency lives inside a
        # call, drift lives between calls) and handles pauses itself, so a
        # gulp is a single clause spanning the entire text.
        t = text.strip()
        a = text.index(t) if t else 0
        return [{"kind": "t", "text": t, "span": (a, a + len(t))}]
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


_CBX_VOICE = {"path": None, "default": None}


def _cbx_set_voice(model, path, exaggeration):
    """Condition chatterbox on a reference clip (zero-shot clone) — prepared
    once per voice and cached on the model, so a clone costs seconds on first
    use rather than on every chunk. None restores the built-in default voice."""
    path = path or None
    if _CBX_VOICE["default"] is None:
        _CBX_VOICE["default"] = model.conds
    if path == _CBX_VOICE["path"]:
        return
    if path is None:
        model.conds = _CBX_VOICE["default"]
    else:
        if not os.path.isfile(path):
            raise RuntimeError("نمونهٔ صدایی که انتخاب کرده‌اید پیدا نشد: " + os.path.basename(str(path)))
        model.prepare_conditionals(path, exaggeration=float(exaggeration))
    _CBX_VOICE["path"] = path
    _diag("cbx_voice", path=os.path.basename(str(path)) if path else "default")


def chatterbox_pcm(text, exaggeration, cfg_weight, temperature, status, speed=1.0, voice_path=None):
    import torch
    model = _load_chatterbox(status)
    _cbx_set_voice(model, voice_path, exaggeration)
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
        status(f"دارم گفتار را می‌سازم… بخش {i} از {total}")
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
            if _rss > _cbx_ceiling_mb(_rss, _avail) + 2000 or _avail < 800 \
                    or _swap_hot(12000, _avail):
                raise RuntimeError(
                    f"مصرف حافظهٔ موتور وسط کار از حد گذشت ({faDigits(_rss // 1024)} گیگابایت) — "
                    "برای اینکه دستگاه قفل نکند، این بخش متوقف شد و موتور از نو راه می‌افتد. "
                    "همین بخش را دوباره بسازید.")
        except RuntimeError:
            raise
        except Exception:
            pass
    audio = np.concatenate(waves)
    if abs(float(speed) - 1.0) > 0.01:
        status("دارم سرعت گفتار را تنظیم می‌کنم…")
        try:
            from audiotsm import wsola
            from audiotsm.io.array import ArrayReader, ArrayWriter
            reader = ArrayReader(audio.astype(np.float32).reshape(1, -1))
            writer = ArrayWriter(1)
            wsola(1, speed=float(speed)).run(reader, writer)
            audio = writer.data.flatten()
        except Exception:
            status("تغییر سرعت ممکن نشد؛ با سرعت عادی ساخته شد.")
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


def _swap_hot(threshold_mb, avail_mb):
    """Swap matters only as GROWTH since this launch AND under genuine
    pressure (free RAM scarce). Absolute swap locked the app out after its
    own crashes; swap-alone gating killed healthy processes. Both measured."""
    growth = max(0, _swap_used_mb() - _SWAP_BASELINE)
    return growth > threshold_mb and avail_mb is not None and avail_mb < 6000


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
        # ASCII on the wire: no OS codepage can break the protocol, and
        # json.loads on the parent side restores the exact Persian string.
        sys.stdout.write(json.dumps({"type": "status", "msg": msg, "pct": pct},
                                    ensure_ascii=True) + "\n")
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
                    status(f"دارم گفتار را می‌سازم… تکهٔ {k} از {len(texts)}")
                pcm, sr = chatterbox_pcm(t, req.get("exaggeration", 0.8),
                                         req.get("cfg_weight", 1.0),
                                         req.get("temperature", 0.0), status,
                                         speed=req.get("speed", 1.0),
                                         voice_path=req.get("voice_path") or None)
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
            recycle = (rss > _cbx_ceiling_mb(rss, avail_mb)
                       or (avail_mb is not None and avail_mb < 1500)
                       or _swap_hot(4000, avail_mb))
            sys.stdout.write(json.dumps({"type": "result", "path": f.name, "sr": sr,
                                         "rss_mb": rss, "recycle": recycle},
                                        ensure_ascii=True) + "\n")
            sys.stdout.flush()
            if recycle:
                break  # retire: the OS reclaims every leaked byte
        except Exception as e:
            sys.stdout.write(json.dumps({"type": "error", "error": str(e)},
                                        ensure_ascii=True) + "\n")
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
            over = _cbx_last_rss > _cbx_ceiling_mb(_cbx_last_rss, avail_mb)
            tight = avail_mb is not None and avail_mb < 1500
            swapped = _swap_hot(6000, avail_mb)
            if over or tight or swapped:
                _diag("admission_recycle", rss=_cbx_last_rss, avail=avail_mb,
                      swap=_swap_used_mb(),
                      reason="ceiling" if over else ("swap" if swapped else "low_avail"))
                status("پیش از ساخت این بخش، حافظهٔ موتور را خالی می‌کنم…")
                try:
                    _cbx_proc.terminate()
                except Exception:
                    pass
                _cbx_proc = None
                _cbx_last_rss = 0
        _check_cancel()
        p = _cbx_ensure()
        line = json.dumps(req, ensure_ascii=True) + "\n"  # Persian text + Persian paths
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
                raise RuntimeError(msg.get("error", "خطای نامشخص"))
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
                    status(f"حافظهٔ چترباکس خالی شد ({faDigits(freed // 1024)} گیگابایت آزاد شد)؛ دفعهٔ بعد چند ثانیه بیشتر طول می‌کشد."
                           if freed else
                           "حافظهٔ چترباکس خالی شد؛ دفعهٔ بعد چند ثانیه بیشتر طول می‌کشد.")
                    _cbx_proc = None
                    _cbx_last_rss = 0
                if offs is not None:
                    return pcm, sr, [pcm[a:a + n].copy() for a, n in offs]
                return pcm, sr
        # stdout closed: the worker died mid-job
        _cbx_proc = None
        _cbx_last_rss = 0
        _check_cancel()
        tail = "\n".join(list(_cbx_stderr or [])[-8:])
        raise RuntimeError("موتور چترباکس یکهو بسته شد" +
                           (":\n" + tail if tail else " — یک بار دیگر امتحان کنید."))


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
        c = _cbx_sanitize(_despoken_tail_ezafe(i["text"])) if engine == "chatterbox" else i["text"].strip()
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
                 "speed": payload.get("cbx_speed", 1.0),
                 "voice_path": cbx_voice_path(payload.get("cbx_voice"))}, status)
        else:
            res = piper_pcm(engine, [{"t": t} for t in texts], payload.get("speed", 1.0),
                            payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
        pcm, sr, parts = res if len(res) == 3 else (res[0], res[1], [res[0]])
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


def set_gain(gid, percent):
    """Per-part volume: 100 = as generated; 20·log10(p/100) dB, so 200 ≈ +6 dB,
    50 ≈ −6 dB, 0 = mute. The stored audio is never altered."""
    entry = _GULP_PCM.get(int(gid))
    if entry is None:
        raise RuntimeError("این بخش دیگر در حافظه نیست؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
    entry["gain"] = float(min(300.0, max(0.0, percent)))
    return pcm_to_mp3(_assemble(entry), entry["sr"])


def _apply_gain(pcm, entry):
    p = float(entry.get("gain", 100.0) or 0.0)
    if abs(p - 100.0) < 0.5:
        return pcm
    return np.clip(pcm.astype(np.float32) * (p / 100.0), -32768, 32767).astype(np.int16)


def _assemble(entry):
    """Concatenate the per-clause audio with budgeted pauses, at the part's gain."""
    return _apply_gain(_assemble_raw(entry), entry)


def _assemble_raw(entry):
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


def _mem_preflight(status):
    try:
        import psutil
        total_mb = psutil.virtual_memory().total // (1024 * 1024)
    except Exception:
        total_mb = None
    if total_mb is not None and total_mb < 7000:
        raise RuntimeError(
            f"چترباکس روی این دستگاه اجرا نمی‌شود؛ دست‌کم ۸ گیگابایت رم می‌خواهد "
            f"(این دستگاه {total_mb // 1024} گیگابایت دارد). به‌جایش از صداهای سبک — مانا، ژیرو یا امیر — استفاده کنید.")
    try:
        import psutil
        avail_mb = psutil.virtual_memory().available // (1024 * 1024)
    except Exception:
        avail_mb = None
    if _swap_hot(10000, avail_mb):
        raise RuntimeError(
            "حافظهٔ دستگاه کم آمده و سواپ در همین نشست خیلی بالا رفته — "
            "چند برنامهٔ دیگر را ببندید و دوباره امتحان کنید.")
    if avail_mb is not None and avail_mb < 2000:
        raise RuntimeError(
            f"حافظهٔ آزاد برای چترباکس کم است (فقط {faDigits(avail_mb)} مگابایت). "
            "چند برنامهٔ دیگر را ببندید و دوباره امتحان کنید؛ ادامه‌دادن در این وضعیت دستگاه را قفل می‌کند.")
    if avail_mb is not None and avail_mb < 4500:
        status(f"هشدار: حافظهٔ آزاد کم است ({avail_mb // 1024} گیگابایت)؛ ممکن است کار کند پیش برود. "
               "اگر برنامه‌های دیگر را ببندید، کمک می‌کند.")


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
             "speed": payload.get("cbx_speed", 1.0),
             "voice_path": cbx_voice_path(payload.get("cbx_voice"))}, status)
    segs = _pause_segments(text)
    if not any("t" in s for s in segs):
        raise RuntimeError("در این بخش چیزی برای خواندن نیست؛ فقط نشانهٔ مکث دارد.")
    return piper_pcm(engine, segs, payload.get("speed", 1.0),
                     payload.get("noise", 0.667), payload.get("noisew", 0.8), status)


import itertools as _it
_GULP_PCM = {}
_gulp_ids = _it.count(1)


def reset_gulps():
    _GULP_PCM.clear()
    _MUSIC.update({"pcm": None, "sr": None, "prompt": ""})
    _G_LAST["tail"] = ""   # a new document starts without a lead-in


def new_document():
    """Start a new document without discarding parts — undo may restore them.
    Only the continuity tail is forgotten; the chosen music bed is the user's
    choice and stays (FIELD 107: clearing parts made the final step reach for
    Lyria because the bed had been dropped)."""
    _G_LAST["tail"] = ""


def gc_gulps(keep_ids):
    """Drop every part the UI can no longer reach (not current, not in undo
    history). FIELD (119): a file part was created by the engine and then
    collected before the UI had stored its id (KeyError at splice) — entries
    younger than 15 s are never collected."""
    keep = {int(i) for i in keep_ids if i is not None}
    now = time.time()
    for gid in [g for g in list(_GULP_PCM) if g not in keep and now - _GULP_PCM[g].get("born", 0) > 15]:
        _GULP_PCM.pop(gid, None)
    return len(_GULP_PCM)


def file_gulp(path):
    """A part holding an audio file from disk (108): decoded to mono, kept at
    its own rate (the splice resamples)."""
    p = Path(path)
    if not p.is_file():
        raise RuntimeError("فایل پیدا نشد.")
    pcm, sr = _decode_audio(p.read_bytes())
    if len(pcm) < sr // 10:
        raise RuntimeError("این فایل صوتی تقریباً خالی است.")
    gid = next(_gulp_ids)
    _GULP_PCM[gid] = {"sr": sr, "items": [{"kind": "t", "text": "", "span": (0, 0), "pcm": pcm}],
                      "text": "", "engine": "file", "payload": {"file": p.name}, "born": time.time()}
    return gid, pcm_to_mp3(pcm, sr), p.name, round(len(pcm) / sr, 1)


def silence_gulp(seconds, sr=24000):
    """A part that is pure silence of the given length (104 spacer)."""
    seconds = float(min(50.0, max(0.2, seconds)))
    pcm = np.zeros(int(sr * seconds), dtype=np.int16)
    gid = next(_gulp_ids)
    _GULP_PCM[gid] = {"sr": sr, "items": [{"kind": "t", "text": "", "span": (0, 0), "pcm": pcm}],
                      "text": "", "engine": "silence", "payload": {"seconds": seconds}, "born": time.time()}
    return gid, pcm_to_mp3(pcm, sr)


def clone_gulp(gid):
    """A duplicate part with its own id — audio copied, no synthesis (98)."""
    import copy
    entry = _GULP_PCM.get(int(gid))
    if entry is None:
        raise RuntimeError("این بخش دیگر در حافظه نیست؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
    new = copy.deepcopy(entry)
    ngid = next(_gulp_ids)
    _GULP_PCM[ngid] = new
    return ngid, pcm_to_mp3(_assemble(new), new["sr"])


def drop_gulp(gid):
    _GULP_PCM.pop(int(gid), None)


def _silence_runs(pcm, sr, min_ms=70):
    """All true-silence runs in the utterance: (start, end, center) of every
    stretch where the 20 ms envelope stays under max(4% body, 60) for at
    least min_ms. With «.» joins these are the model's own sentence stops."""
    if pcm is None or len(pcm) < max(2, sr // 50):    # 127: an empty or tiny slice is not a crash
        return []
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
         "speed": payload.get("cbx_speed", 1.0),
         "voice_path": cbx_voice_path(payload.get("cbx_voice"))}, status)
    pcm, sr = res[0], res[1]
    aligned = _align_words(pcm, sr, spoken, status)
    words_per = [len(re.findall(r"\S+", i["text"])) for i in t_items]
    if aligned is None or len(aligned) != sum(words_per):
        _diag("continuous_bail", reason="align_none" if aligned is None else
              f"count_{len(aligned)}_vs_{sum(words_per)}")
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
                cuts.append(_zc_snap(pcm, r[2], sr))
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
        i["pcm"] = _fade_asym(pcm[cuts[k]:cuts[k + 1]].copy(), sr)
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
    status("متن یک‌نفس و طبیعی خوانده شد و مکث‌ها با هم‌ترازی درست سر جای نشانه‌ها نشستند.")
    return sr


def _verify_entry(entry, where):
    """Structural invariants: the stored items must exactly mirror what the
    gulp's text implies. A violation raises instead of ever becoming audio."""
    if entry.get("engine") in ("silence", "file"):
        return
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
            f"در ساخت صدا یک ناسازگاری داخلی پیدا شد (مرحلهٔ {where}/{e}). "
            "برای اینکه خروجی خراب نشود، این بخش را کامل از نو بسازید.")


def _heal_entry(entry, status):
    """A corrupt gulp is rebuilt from its own text and stored settings —
    repair first, error only if repair itself fails."""
    status("یک ناسازگاری داخلی پیدا شد؛ این بخش خودکار ترمیم می‌شود…")
    payload = dict(entry.get("payload") or {})
    payload["engine"] = entry.get("engine") or payload.get("engine") or "chatterbox"
    payload["text"] = entry["text"]
    items = _clause_split(entry["text"], payload["engine"])
    if not any(i["kind"] == "t" for i in items):
        raise RuntimeError("چیزی برای ترمیم نیست؛ این بخش متنی ندارد.")
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
    status("این بخش خودبه‌خود ترمیم و از نو ساخته شد.")


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
                f"نشد این بخش را خودکار ترمیم کنیم ({str(e)[:60]}) — "
                "اینترنت را چک کنید و این بخش را دستی دوباره بسازید.")


def _slices_sane(cuts, total):
    """Cut positions must be strictly increasing inside the audio."""
    return all(0 <= a < b <= total for a, b in zip(cuts, cuts[1:])) if len(cuts) > 1 else True


def generate_gulp(payload, status):
    _require_license()
    _G_INCOMPLETE.clear()
    """One gulp → clause-wise synthesis, stored per clause for surgical patching."""
    _job_start()
    text = payload["text"].strip()
    if payload["engine"] in ("google", "fish"):
        eng = payload["engine"]
        lead_in = _g_lead_in(text, payload)
        pcm, sr = cloud_pcm(text, payload, status)
        items = _clause_split(text, eng)
        items[0]["pcm"] = pcm
        gid = next(_gulp_ids)
        entry = {"sr": sr, "items": items, "text": text, "engine": eng, "lead_in": lead_in, "born": time.time(),
                 "payload": {k: payload[k] for k in payload if k.startswith("g_") or k.startswith("f_")}}
        _ensure_valid(entry, "تولید", status)
        _GULP_PCM[gid] = entry
        return pcm_to_mp3(_assemble(entry), sr), gid
    items = _clause_split(text, payload["engine"])
    if not any(i["kind"] == "t" for i in items):
        raise RuntimeError("در این بخش چیزی برای خواندن نیست؛ فقط نشانهٔ مکث دارد.")
    sr = None
    if (payload["engine"] == "chatterbox"
            and any(i["kind"] == "p" for i in items)
            and any(i["kind"] == "t" and len(i["text"]) < 40 for i in items)):
        try:
            sr = _cbx_continuous(items, payload, status)
        except Exception as e:
            status(f"یک‌نفس خواندن جواب نداد ({str(e)[:40]})؛ تکه‌تکه می‌سازیم.")
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
                          "speed", "noise", "noisew", "cbx_voice",
                          "g_model", "g_lang", "g_voice", "g_preset", "g_style",
                          "g_speakers") if k in payload}}
    _ensure_valid(entry, "تولید", status)
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
            raise RuntimeError("حافظهٔ این دستگاه برای هم‌ترازیِ واژه‌به‌واژه کافی نیست")
    except RuntimeError:
        raise
    except Exception:
        pass
    status("فقط همین یک بار: مدل هم‌ترازی واژه‌ها (حدود ۱٫۲ گیگابایت) دانلود می‌شود…")
    _hook_hf_progress(status)
    from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor
    repo = "jonatasgrosman/wav2vec2-large-xlsr-53-persian"
    proc = Wav2Vec2Processor.from_pretrained(repo)
    mdl = Wav2Vec2ForCTC.from_pretrained(repo)
    mdl.eval()
    _ALIGN.update(model=mdl, proc=proc)
    status("مدل هم‌ترازی آماده است.")


def _align_feed(pcm, sr):
    """16 kHz feed for wav2vec2 — anti-aliased. A naive decimation folds the
    8-12 kHz band onto the speech band and drags every CTC boundary with it."""
    if sr != 16000:
        pcm = _resample(pcm, sr, 16000)
    return pcm.astype(np.float32) / 32768.0


def _align_words(pcm, sr, text, status):
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
    changed = True
    while changed and len(merged) > 1:
        changed = False
        if (merged[-1][1] - merged[-1][0] < int(0.120 * sr)
                and merged[-1][0] - merged[-2][1] >= int(0.150 * sr)):
            _diag("stub_sweep", edge="trail", ms=int(1000 * (merged[-1][1] - merged[-1][0]) / sr))
            pcm = pcm[:merged[-2][1] + int(0.040 * sr)]
            merged = merged[:-1]
            changed = True
        elif (merged[0][1] - merged[0][0] < int(0.120 * sr)
                and merged[1][0] - merged[0][1] >= int(0.150 * sr)):
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
                 "speed": payload.get("cbx_speed", 1.0),
                 "voice_path": cbx_voice_path(payload.get("cbx_voice"))}, status)
        else:
            res = piper_pcm(engine, [{"t": txt}], payload.get("speed", 1.0),
                            payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
        pcm, sr2 = res[0], res[1]
        _diag("surgery_synth", engine=engine, sr2=sr2, entry_sr=sr, n=len(pcm))
        out = _resample(pcm, sr2, sr)
        if engine != "chatterbox" and _band_displaced(out, sr):
            _diag("band_displaced_retry", engine=engine)
            res = piper_pcm(engine, [{"t": txt}], payload.get("speed", 1.0),
                            payload.get("noise", 0.667), payload.get("noisew", 0.8), status)
            out = _resample(res[0], res[1], sr)
            if _band_displaced(out, sr):
                raise RuntimeError(
                    "این صدا دو بار پشت سر هم خروجی خراب داد (طیف صدا جابه‌جا شده). "
                    "این خطا در گزارش برنامه ثبت شد؛ لطفاً فایل گزارش (ava.log) را بفرستید.")
        return out

    if mid_words:
        status(f"جراحی واژه‌ای: فقط «{' '.join(mid_words)[:40]}» دوباره ساخته می‌شود…")
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
                status("برشِ متنِ کناری قابل اعتماد نبود؛ بدون متن کناری می‌سازیم…")
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
         "speed": payload.get("cbx_speed", 1.0),
         "voice_path": cbx_voice_path(payload.get("cbx_voice"))}, status)
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
    status("تکهٔ کوتاه را همراه متن کناری‌اش یک‌جا خواندیم و بعد با هم‌ترازی جدایش کردیم.")
    return True


def patch_gulp(gid, new_text, sel_start, sel_end, payload, status):
    _require_license()
    _G_INCOMPLETE.clear()
    """Regenerate only the clauses that the edit/selection touched; every
    other clause's audio is reused bit-identical."""
    _job_start()
    entry = _GULP_PCM.get(int(gid))
    if entry is None:
        raise RuntimeError("این بخش دیگر در حافظه نیست؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
    _ensure_valid(entry, "پایهٔ ویرایش", status)
    new_text = new_text.strip()
    if payload["engine"] in ("google", "fish") or entry.get("engine") in ("google", "fish"):
        eng = payload["engine"] if payload["engine"] in ("google", "fish") else entry.get("engine")
        cfg = payload if payload["engine"] == eng else {**entry["payload"], **payload, "engine": eng}
        # Surgery gets NO lead-in: its neighbouring clauses already carry the
        # prosody, and a lead-in here was trimmed at the wrong silence and
        # returned the previous part's sentence as the "regenerated" one.
        # A whole-part regeneration (below) keeps the part's pinned lead-in.
        cfg = {**cfg, "g_lead_in": ""}
        # 94: clause surgery — regenerate only the clauses the edit/selection
        # touched (with their neighbours as prosodic context), cut the new
        # clause out at its pause boundaries and splice it into the original
        # at the same kind of boundary. Falls back to a whole-part take.
        if entry.get("engine") == eng and len(entry["items"]) == 1 and entry["items"][0].get("pcm") is not None:
            done = _google_clause_patch(entry, new_text, sel_start, sel_end, cfg, status)
            if done:
                entry["payload"] = {k: cfg[k] for k in cfg if k.startswith("g_") or k.startswith("f_")}
                _ensure_valid(entry, "ویرایش", status)
                return pcm_to_mp3(_assemble(entry), entry["sr"]), done, "clauses"
        cfg = {**cfg, "g_lead_in": entry.get("lead_in", "")}   # pinned at generation time
        pcm, sr = cloud_pcm(new_text, cfg, status)
        items = _clause_split(new_text, eng)
        items[0]["pcm"] = pcm
        entry.update({"sr": sr, "items": items, "text": new_text, "engine": eng,
                      "payload": {k: cfg[k] for k in cfg if k.startswith("g_") or k.startswith("f_")}})
        _ensure_valid(entry, "ویرایش", status)
        return pcm_to_mp3(_assemble(entry), sr), 1, "full"
    has_sel = sel_start is not None and sel_end is not None and sel_end > sel_start
    # the gulp's clause structure follows its BASE voice; a different voice in
    # the payload re-voices only the selection (the flanks' audio is reusable
    # regardless of which engine once produced it)
    split_engine = entry.get("engine") if has_sel else payload["engine"]
    new_items = _clause_split(new_text, split_engine)
    if not any(i["kind"] == "t" for i in new_items):
        raise RuntimeError("در این بخش چیزی برای خواندن نیست؛ فقط نشانهٔ مکث دارد.")
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
            status(f"هم‌ترازی واژه‌ای جواب نداد ({str(e)[:50]})؛ کل تکه دوباره ساخته می‌شود.")
    middle = [] if mode == "words" else [i for i in mid_new if i["kind"] == "t"]
    if middle:
        status(f"ساخت دوبارهٔ {faDigits(len(middle))} تکهٔ تغییرکرده…")
        done = False
        if (payload["engine"] == "chatterbox"
                and any(len(i["text"]) < 40 for i in middle)):
            try:
                done = _cbx_patch_middle(entry, new_items, pre, suf, payload, status)
            except Exception:
                done = False
        if not done:
            sr2 = _synth_clauses(middle, payload, status)
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
                        _diag("band_displaced_retry", engine=payload.get("engine"))
                        vk = payload.get("engine")
                        u = PIPER_VOICES.get(vk)
                        if u:
                            for q in (MODELS_DIR / u.rsplit("/", 1)[-1],
                                      Path(str(MODELS_DIR / u.rsplit("/", 1)[-1]) + ".json")):
                                try:
                                    q.unlink()
                                except OSError:
                                    pass
                        _synth_clauses(middle, payload, status)
                        bad = [j for j in middle if j.get("pcm") is not None
                               and len(j["pcm"]) and _band_displaced(j["pcm"], sr2)]
                        if bad:
                            raise RuntimeError(
                                "این صدا دو بار پشت سر هم خروجی خراب داد (طیف صدا جابه‌جا شده). "
                                "این خطا در گزارش برنامه ثبت شد؛ لطفاً فایل گزارش (ava.log) را بفرستید.")
                        break
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


def _splice_pcm(ids, status):
    """Join stored gulps in order — resampling if voices with different
    sample rates were mixed — with a short breath between parts."""
    try:
        entries = [_GULP_PCM[int(i)] for i in ids]
    except KeyError:
        raise RuntimeError("بعضی از بخش‌ها دیگر در حافظه نیستند؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
    if not entries:
        raise RuntimeError("بخشی نیست که به هم بچسبانیم.")
    status("دارم بخش‌ها را به هم می‌چسبانم و فایل نهایی را می‌سازم…")
    for k, e in enumerate(entries, 1):
        _ensure_valid(e, f"چسباندن بخش {faDigits(k)}", status)
    parts = [(_assemble(e), e["sr"]) for e in entries]
    target = max(sr for _, sr in parts)
    _diag("splice", srs=",".join(str(s) for _, s in parts), target=target)
    gap = np.zeros(int(target * 0.12), dtype=np.int16)   # the "breath" between parts
    out = []
    for k, (pcm, sr) in enumerate(parts):
        pcm = _resample(pcm, sr, target)
        out.append(pcm)
        if k < len(parts) - 1:
            out.append(gap)
    return np.concatenate(out), target


def splice_gulps(ids, status) -> bytes:
    _require_license()
    pcm, sr = _splice_pcm(ids, status)
    return pcm_to_mp3(pcm, sr)


def generate(payload, status) -> bytes:
    mp3, gid = generate_gulp(payload, status)
    _GULP_PCM.pop(gid, None)
    return mp3


# ---------------------------------------------------------------------------
# Chatterbox voice library (90) — reference clips, bundled and user-added
# ---------------------------------------------------------------------------
_VOICE_EXT = (".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac")
_USER_VOICES = MODELS_DIR / "voices"


def cbx_voices():
    """Every reference clip the app knows. Bundled clips come from voices/
    with a manifest (voice × style); the user's own live in AvaModels/voices.
    Each entry: id, name, path, builtin, voice, style."""
    out = []
    root = Path(_res_path("voices"))
    manifest = {}
    try:
        for m in json.loads((root / "voices.json").read_text(encoding="utf-8")):
            manifest[m["file"]] = m
    except Exception:
        pass
    try:
        for p in sorted(x for x in root.iterdir() if x.suffix.lower() in _VOICE_EXT):
            m = manifest.get(p.name, {})
            voice = m.get("voice") or (p.stem.split("__")[0].capitalize() if "__" in p.stem else p.stem)
            style = m.get("style") or (p.stem.split("__", 1)[1].replace("_", " ") if "__" in p.stem else "")
            out.append({"id": "b:" + p.name, "name": f"{voice} · {style}" if style else voice, "path": str(p),
                        "builtin": True, "voice": voice, "style": style, "seconds": m.get("seconds")})
    except Exception:
        pass
    try:
        for p in sorted(x for x in _USER_VOICES.iterdir() if x.suffix.lower() in _VOICE_EXT):
            out.append({"id": "u:" + p.name, "name": p.stem, "path": str(p), "builtin": False, "voice": "", "style": p.stem})
    except Exception:
        pass
    return out


def cbx_voice_path(voice_id):
    """Resolve a voice id from the UI to a clip path; '' / 'default' / unknown
    → None (the built-in default voice)."""
    if not voice_id or voice_id == "default":
        return None
    for v in cbx_voices():
        if v["id"] == voice_id:
            return v["path"]
    return None


def cbx_voice_delete(voice_id):
    """Remove one of the user's own samples (built-ins cannot be removed)."""
    if not voice_id.startswith("u:"):
        raise RuntimeError("نمونه‌های داخل برنامه حذف نمی‌شوند؛ فقط نمونه‌های خودتان.")
    p = _USER_VOICES / os.path.basename(voice_id[2:])
    if p.exists():
        p.unlink()
    return cbx_voices()


def cbx_voice_add(src_path):
    """Copy a user's clip into the library. Returns the new voice entry."""
    src = Path(src_path)
    if not src.is_file() or src.suffix.lower() not in _VOICE_EXT:
        raise RuntimeError("این فایل صوتی به درد نمی‌خورد؛ یک WAV یا MP3 هشت تا پانزده‌ثانیه‌ای با صدای یک نفر انتخاب کنید.")
    _USER_VOICES.mkdir(parents=True, exist_ok=True)
    dst = _USER_VOICES / src.name
    k = 2
    while dst.exists() and dst.read_bytes() != src.read_bytes():
        dst = _USER_VOICES / f"{src.stem} ({k}){src.suffix}"; k += 1
    if not dst.exists():
        shutil.copy2(src, dst)
    return {"id": "u:" + dst.name, "name": dst.stem, "path": str(dst), "builtin": False}


# ---------------------------------------------------------------------------
# Google Gemini TTS (90) — cloud engine; keys rotate, tone is kept consistent
# ---------------------------------------------------------------------------
GOOGLE_VOICES = ["Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe",
                 "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib",
                 "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima",
                 "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat"]
GOOGLE_MODELS = {"gemini-3.1-flash-tts-preview": {"tags": True},
                 "gemini-2.5-flash-preview-tts": {"tags": False},
                 "gemini-2.5-pro-preview-tts": {"tags": False}}
# 117: reading styles describe the FORMAT — register, pacing, articulation,
# phrasing. Emotion and age are NOT here any more (they live in the director
# lists), so a children's story can be read scared, and a news bulletin drunk.
GOOGLE_PRESETS = {
    "neutral":     "Plain reading. Clear, even, unhurried; natural sentence melody; no performance.",
    "audiobook":   "Audiobook narration. Measured pace, intimate close-mic register, sentences allowed to land, consistent chapter-long rhythm.",
    "news":        "Broadcast news bulletin. Formal register, crisp diction, even pace, level tone, short pauses between items.",
    "breaking":    "Breaking-news bulletin. Formal register, slightly faster pace, tight controlled phrasing, clipped pauses.",
    "documentary": "Documentary narration. Spacious pacing, deliberate emphasis on key nouns, long pauses over scenes, dignified register.",
    "kids":        "Children's storytelling. Simple clear phrasing, slower pace, animated sentence melody, character lines slightly differentiated, patient pauses.",
    "poem":        "Classical poetry recital. Meter-aware phrasing, deliberate pace, meaningful rests at line ends, no colloquial reduction.",
    "speech":      "Public speech. Projected delivery, purposeful pauses before key points, rhetorical build within paragraphs.",
    "radio":       "Radio advertisement. Quick, punchy phrasing, product names articulated clearly, short sentences with lift at the end.",
    "podcast":     "Podcast host. Conversational register, natural rhythm, contractions and colloquial flow, occasional thinking pauses.",
    "teacher":     "Teaching. Step-by-step phrasing, slow on key terms, small pauses after each point, checks-for-understanding intonation.",
    "ivr":         "Phone-system announcement. Formal register, very clear articulation, even pace, no filler.",
    "dryhumor":    "Deadpan comedic timing. Flat delivery of punchlines, precise beats, no laughter in the voice.",
    "sports":      "Sports commentary. Fast pace, short phrases, rising with the action, play-by-play rhythm.",
    "epic":        "Epic narration. Slow, monumental pacing, resonant chest register, long pauses between sentences.",
    "spiritual":   "Recitation. Reverent even pace, gentle emphasis, contemplative pauses, no dramatics.",
}
_GKEYS_FILE = MODELS_DIR / "google_keys.json"
_GOOGLE_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"


def google_keys():
    """[{key, until, bad}] in rotation order. Seeds itself once from the old
    single Gemini key so nobody has to re-enter anything."""
    try:
        data = json.loads(_GKEYS_FILE.read_text(encoding="utf-8"))
        keys = [k for k in data.get("keys", []) if isinstance(k, dict) and k.get("key")]
    except Exception:
        keys = []
    if not keys:
        legacy = load_key("gemini")
        if legacy:
            keys = [{"key": legacy, "until": 0, "bad": False}]
            _google_keys_write(keys)
    return keys


def _google_keys_write(keys):
    try:
        MODELS_DIR.mkdir(exist_ok=True)
        _GKEYS_FILE.write_text(json.dumps({"keys": keys}), encoding="utf-8")
    except Exception:
        pass


def google_keys_set(key_strings):
    """Replace the list from the UI; state of unchanged keys is preserved."""
    old = {k["key"]: k for k in google_keys()}
    keys = []
    for ks in key_strings:
        ks = (ks or "").strip()
        if ks and ks not in [k["key"] for k in keys]:
            keys.append(old.get(ks, {"key": ks, "until": 0, "bad": False}))
    _google_keys_write(keys)
    # the legacy single slot follows the list — and is cleared with it, so an
    # emptied list stays empty instead of quietly re-seeding from it
    save_key("gemini", keys[0]["key"] if keys else "")
    return google_keys_status()


def google_quota_headroom():
    """(usable, total) Google keys right now — the UI warns when it runs low. (127)"""
    try:
        return len(_google_usable_keys()), len(google_keys())
    except Exception:
        return (0, 0)


def google_keys_status():
    import time
    now = time.time()
    out = []
    for k in google_keys():
        state = "bad" if k.get("bad") else ("exhausted" if k.get("until", 0) > now else "ok")
        out.append({"key": k["key"], "masked": k["key"][:6] + "•" * 8 + k["key"][-4:] if len(k["key"]) > 12 else "••••",
                    "state": state, "until": k.get("until", 0)})
    return out


def _google_next_midnight_pacific():
    """Google's daily quotas reset at midnight Pacific time."""
    import time
    from datetime import datetime, timedelta
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo("America/Los_Angeles")
        now = datetime.now(tz)
        nxt = (now + timedelta(days=1)).replace(hour=0, minute=5, second=0, microsecond=0)
        return nxt.timestamp()
    except Exception:
        return time.time() + 24 * 3600


def _google_mark(key, state):
    keys = google_keys()
    for k in keys:
        if k["key"] == key:
            if state == "exhausted":
                k["until"] = _google_next_midnight_pacific()
            elif state == "bad":
                k["bad"] = True
            elif state == "ok":
                k["until"] = 0; k["bad"] = False
    _google_keys_write(keys)


def _google_usable_keys():
    import time
    now = time.time()
    return [k["key"] for k in google_keys() if not k.get("bad") and k.get("until", 0) <= now]


def google_rotate(call, status, what="گوگل"):
    """Run call(key) over the key list: quota → next key (this one sleeps till
    the Pacific midnight), invalid → next key (flagged), transient 5xx → retry
    the same key up to 3 times. Raises a Farsi error naming the remedy."""
    import time
    keys = _google_usable_keys()
    if not keys:
        if google_keys():
            raise RuntimeError("سهمیهٔ امروزِ همهٔ کلیدهای گوگل تمام شده یا کلیدها معتبر نیستند؛ یک کلید تازه اضافه کنید یا فردا سر بزنید.")
        raise RuntimeError("هنوز کلید گوگل ندارید؛ از دکمهٔ «کلیدهای گوگل» یک کلید رایگان وارد کنید.")
    last = None
    for key in keys:
        for attempt in range(3):
            _check_cancel()
            try:
                return call(key)
            except Cancelled:
                raise
            except _GoogleHTTP as e:
                last = e
                if e.code == 429:
                    if "per minute" in e.msg.lower() or "rpm" in e.msg.lower():
                        status(f"{what}: به سقف درخواست در دقیقه خوردیم — ۲۰ ثانیه صبر می‌کنیم…"); time.sleep(20); continue
                    _google_mark(key, "exhausted"); status(f"{what}: سهمیهٔ امروزِ این کلید ته کشید؛ می‌رویم سراغ کلید بعدی…")
                    break
                if e.code in (401, 403) or (e.code == 400 and "api key" in e.msg.lower()):
                    _google_mark(key, "bad"); status(f"{what}: این کلید را قبول نکرد؛ می‌رویم سراغ کلید بعدی…")
                    break
                if e.code >= 500:
                    _diag("google_5xx", code=e.code, msg=e.msg[:120])
                    status(f"{what}: سرور گوگل موقتاً خطا داد ({e.code}) — تلاش {attempt + 2} از ۳…")
                    for _ in range(4 * (2 + attempt * 2)):
                        _check_cancel(); time.sleep(0.25)
                    continue
                raise RuntimeError(f"{what}: {e.msg}")
            except requests.RequestException as e:
                last = e
                why = type(e).__name__ + (": " + str(e)[:90] if str(e) else "")
                _diag("google_net", err=why)
                status(f"{what}: اتصال برقرار نشد ({why}) — تلاش {attempt + 2} از ۳…")
                for _ in range(4 * (2 + attempt * 2)):
                    _check_cancel(); time.sleep(0.25)
        else:
            continue
    raise RuntimeError(f"{what}: با هیچ‌کدام از کلیدها جواب نگرفتیم — " + (getattr(last, "msg", None) or str(last) or "؟"))


class _GoogleHTTP(Exception):
    def __init__(self, code, msg):
        super().__init__(f"HTTP {code}: {msg}"); self.code = code; self.msg = msg


def _google_post(url, body, key, timeout=120):
    """POST in a helper thread so a cancel can abandon it mid-flight."""
    _check_cancel()
    box = {}

    def run():
        try:
            box["r"] = requests.post(url, json=body, timeout=timeout,
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json",
                                              "Api-Revision": "2026-05-20"})
        except BaseException as e:   # noqa — carried back to the caller's thread
            box["e"] = e
    th = threading.Thread(target=run, daemon=True); th.start()
    while th.is_alive():
        th.join(0.25)
        if _CANCEL.is_set():
            raise Cancelled()
    if "e" in box:
        raise box["e"]
    r = box["r"]
    _diag("google_http", code=r.status_code, ms=int(r.elapsed.total_seconds() * 1000), bytes=len(r.content))
    if r.status_code != 200:
        msg = ""
        try:
            j = r.json()
            if isinstance(j, list) and j:
                j = j[0]
            msg = (j.get("error", {}) or {}).get("message", "") if isinstance(j, dict) else ""
        except Exception:
            pass
        raise _GoogleHTTP(r.status_code, msg or r.text[:200])
    return r.json()


_G_PAUSE_LONG = re.compile(r"\[\s*مکث بلند\s*\]")
_G_PAUSE = re.compile(r"\[\s*مکث\s*\]")
_G_TAG = re.compile(r"\[[A-Za-z][A-Za-z ,=.'-]{0,40}\]")


PAUSE_SECONDS = {"short pause": 0.6, "long pause": 1.5, "مکث": 0.5, "مکث بلند": 1.2}
_G_ANY_PAUSE = re.compile(r"\[\s*(short pause|long pause|مکث بلند|مکث)\s*\]")


def google_text(text, model):
    """The text as Google should see it (105: pauses are the MODEL's again).
    The app's [مکث] markers become Google's pause tags on 3.1, punctuation on
    2.5 (which reads tags aloud). A pause tag at the very end of a part is
    dropped — nothing follows it inside the part, and a trailing tag gets
    spoken as words; the splice adds the breath between parts."""
    t = text.strip()
    t = re.sub(r"(?:\s*\[(?:short pause|long pause|مکث بلند|مکث)\]\s*)+$", "", t)
    if GOOGLE_MODELS.get(model, {}).get("tags", True):
        t = _G_PAUSE_LONG.sub(" [long pause] ", t)
        t = _G_PAUSE.sub(" [short pause] ", t)
    else:
        t = _G_PAUSE_LONG.sub(".\n\n", t)
        t = _G_PAUSE.sub("… ", t)
        t = _G_TAG.sub(" ", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    return t.strip()


def google_prompt(text, cfg):
    """Google's controllable-TTS prompt: a fixed audio profile + director's
    notes, identical for every chunk of a document, then the transcript."""
    model = cfg.get("g_model") or "gemini-3.1-flash-tts-preview"
    preset = cfg.get("g_preset") or "neutral"
    style = (cfg.get("g_style") or "").strip() if preset == "custom" else GOOGLE_PRESETS.get(preset, GOOGLE_PRESETS["neutral"])
    if not style:
        style = GOOGLE_PRESETS["neutral"]
    lang = cfg.get("g_lang") or "fa"
    lang_note = {"fa": "Persian (Farsi) as spoken in Iran — standard Tehran pronunciation. Diacritics (harakat) in the text mark exact vowels; follow them.",
                 "en": "English.", "de": "German.", "tr": "Turkish.", "fr": "French.", "es": "Spanish.",
                 "auto": "the language of the transcript."}.get(lang, "the language of the transcript.")
    speakers = cfg.get("g_speakers") or []
    duo = ""
    if len(speakers) == 2:
        a, b = speakers[0].get("name", ""), speakers[1].get("name", "")
        duo = f"This is a conversation between {a} and {b}. Every line of the transcript begins with the speaker's name and a colon.\n"
        # 112: a reading style per speaker
        for sp in speakers:
            pst = GOOGLE_PRESETS.get(sp.get("preset") or "", "")
            if pst and sp.get("name"):
                duo += f"{sp['name']} speaks in this style: {pst}\n"
    persona = _director_note(cfg.get("g_age"), cfg.get("g_age_custom"), cfg.get("g_state"), cfg.get("g_state_custom"))
    for sp in speakers:
        note = _director_note(sp.get("age"), sp.get("age_custom"), sp.get("state"), sp.get("state_custom"))
        if note and sp.get("name"):
            duo += f"{sp['name']}: {note}\n"
    head = ("Narrator: one consistent voice, same identity in every recording. "
            + (f"{persona} " if persona else "")
            + f"Reading format: {style} "
            + f"Language: {lang_note} " + duo +
            "Read ONLY the transcript below, exactly as written; do not read these instructions; perform bracketed tags, never say them.\n"
            "TRANSCRIPT:\n")
    return head + google_text(text, model)


def _google_body(text, cfg):
    model = cfg.get("g_model") or "gemini-3.1-flash-tts-preview"
    speakers = cfg.get("g_speakers") or []
    lang = cfg.get("g_lang") or "fa"
    lang_code = {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(lang)
    if len(speakers) == 2:
        sc = [{"speaker": s.get("name", ""), "voice": s.get("voice") or "Charon"} for s in speakers]
    else:
        sc = [{"voice": cfg.get("g_voice") or "Charon"}]
    if lang_code:
        for x in sc:
            x["language"] = lang_code
    # FIELD LOG (92): a forced low temperature (0.35) made the model read the
    # first half of a tagged text and emit silence for the rest. Temperature
    # stays at the model's default — no override, on either door.
    return {"model": model, "input": google_prompt(text, cfg),
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": sc}}


def _google_legacy_body(text, cfg):
    """generateContent form, for keys/models the Interactions endpoint rejects."""
    speakers = cfg.get("g_speakers") or []
    if len(speakers) == 2:
        vc = {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
            {"speaker": s.get("name", ""), "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": s.get("voice") or "Charon"}}}
            for s in speakers]}}
    else:
        vc = {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": cfg.get("g_voice") or "Charon"}}}
    gc = {"responseModalities": ["AUDIO"], "speechConfig": vc}
    return {"contents": [{"parts": [{"text": google_prompt(text, cfg)}]}], "generationConfig": gc}


def _find_audio_b64(obj):
    """Locate the audio payload wherever the response nests it."""
    if isinstance(obj, dict):
        if obj.get("type") == "audio" and isinstance(obj.get("data"), str):
            return obj["data"], obj.get("mime_type") or obj.get("mimeType") or ""
        inl = obj.get("inlineData") or obj.get("inline_data")
        if isinstance(inl, dict) and isinstance(inl.get("data"), str):
            return inl["data"], inl.get("mimeType") or inl.get("mime_type") or ""
        for v in obj.values():
            r = _find_audio_b64(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_audio_b64(v)
            if r:
                return r
    return None


def _google_decode(b64, mime):
    import base64
    raw = base64.b64decode(b64)
    m = re.search(r"rate=(\d+)", mime or "")
    sr = int(m.group(1)) if m else 24000
    if raw[:4] == b"RIFF":
        import io
        with wave.open(io.BytesIO(raw)) as wf:
            sr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
    pcm = np.frombuffer(raw[: len(raw) - len(raw) % 2], dtype="<i2").astype(np.int16)
    if len(pcm) < sr // 20:
        raise RuntimeError("گوگل به جای صدا جواب خالی داد؛ دوباره امتحان کنید.")
    return pcm, sr


_G_TIMEOUT = 75   # seconds a door may stay silent before the other door is tried (Interactions)


def _check_truncated(pcm_sr, expect_sec):
    """FIELD (101): the model sometimes ends cleanly after the first sentence
    of a long request (8 s of a 63 s text). That is a failed take, not a
    short reading — raise a retryable error so the rotation takes it again."""
    pcm, sr = pcm_sr
    got = len(pcm) / sr
    if expect_sec >= 8 and got < 0.35 * expect_sec:
        _diag("google_truncated", got_s=round(got, 1), expect_s=round(expect_sec, 1))
        raise _GoogleHTTP(500, f"truncated take: {got:.1f}s of ~{expect_sec:.0f}s")
_G_FIRST_BYTE = 90   # seconds until the FIRST streamed chunk must arrive
_G_GAP = 45          # seconds between streamed chunks


def _google_stream(url, body, key, expect_sec, status):
    """streamGenerateContent (SSE): audio parts are collected as they arrive.
    Runs in a helper thread so cancel can abandon it; reports progress; if the
    model keeps producing far beyond the transcript's plausible length it is
    looping — the stream is cut and the request reported as such."""
    _check_cancel()
    box = {"parts": [], "mime": "", "done": False, "bytes": 0}
    cap = int(24000 * 2 * (expect_sec * 4 + 30))   # a true runaway: 4x the estimate + 30 s (takes measure 0.8-1.0x)

    def run():
        try:
            with requests.post(url + "?alt=sse", json=body, timeout=(20, _G_FIRST_BYTE), stream=True,
                               headers={"x-goog-api-key": key, "Content-Type": "application/json"}) as r:
                box["code"] = r.status_code
                if r.status_code != 200:
                    try:
                        box["msg"] = r.json().get("error", {}).get("message", "") or r.text[:200]
                    except Exception:
                        box["msg"] = r.text[:200]
                    return
                import base64
                for line in r.iter_lines(chunk_size=8192):
                    if _CANCEL.is_set():
                        return
                    if not line or not line.startswith(b"data:"):
                        continue
                    try:
                        ev = json.loads(line[5:].strip())
                    except Exception:
                        continue
                    if "error" in ev:
                        box["msg"] = str(ev["error"].get("message", ev["error"]))[:200]; box["code"] = 500; return
                    for c in ev.get("candidates", []):
                        for p in (c.get("content") or {}).get("parts", []):
                            inl = p.get("inlineData") or p.get("inline_data")
                            if inl and inl.get("data"):
                                box["parts"].append(inl["data"]); box["mime"] = inl.get("mimeType") or inl.get("mime_type") or box["mime"]
                                box["bytes"] += len(inl["data"]) * 3 // 4
                            elif p.get("text"):
                                box["text"] = (box.get("text") or "") + p["text"]
                    if box["bytes"] > cap:
                        box["looping"] = True; return
                box["done"] = True
        except BaseException as e:   # noqa
            box["e"] = e
    th = threading.Thread(target=run, daemon=True); th.start()
    import time
    last_bytes, last_t, t0 = 0, time.time(), time.time()
    while th.is_alive():
        th.join(0.25)
        if _CANCEL.is_set():
            raise Cancelled()
        if box["bytes"] != last_bytes:
            last_bytes, last_t = box["bytes"], time.time()
            status(f"گوگل: صدا دارد می‌رسد… {faDigits(int(box['bytes'] / 48000))} ثانیه")
        elif box["bytes"] and time.time() - last_t > _G_GAP:
            box["stalled"] = True; break
    if box["bytes"]:
        status(f"گوگل: {faDigits(int(box['bytes'] / 48000))} ثانیه صدا رسید" + (" — ناتمام ماند" if box.get("stalled") else ""))
    _diag("google_stream", code=box.get("code"), ms=int((time.time() - t0) * 1000), parts=len(box["parts"]),
          audio_s=round(box["bytes"] / 48000, 1), expect_s=round(expect_sec, 1),
          looping=box.get("looping", False), stalled=box.get("stalled", False), text=(box.get("text") or "")[:60])
    if "e" in box and not box["parts"]:
        raise box["e"]
    if box.get("code") not in (None, 200) and not box["parts"]:
        raise _GoogleHTTP(box["code"], box.get("msg", ""))
    if box.get("looping"):
        raise _GoogleHTTP(500, "runaway take: audio far beyond the text")   # retried by the rotation
    if not box["parts"]:
        if box.get("text"):
            raise _GoogleHTTP(500, "text instead of audio: " + box["text"][:80])
        raise _GoogleHTTP(500, "no audio in response")
    import base64
    raw = b"".join(base64.b64decode(p) for p in box["parts"])
    m = re.search(r"rate=(\d+)", box["mime"] or "")
    sr = int(m.group(1)) if m else 24000
    pcm = np.frombuffer(raw[: len(raw) - len(raw) % 2], dtype="<i2").astype(np.int16)
    if len(pcm) < sr // 20:
        raise _GoogleHTTP(500, "empty audio")
    return pcm, sr


def _google_call(text, cfg, status):
    """Two doors to the same model. FIELD LOG (build 90): the Interactions
    endpoint accepted the request and then stayed silent for 180 s, three
    times, from a network where generateContent (the diacritizer's endpoint)
    answers in seconds. So generateContent goes first; Interactions is the
    fallback for a model the classic endpoint rejects. A door that times out
    is skipped for the other one, and if BOTH stay silent the request fails
    at once with a clear message — no minutes-long retry ladder."""
    model = cfg.get("g_model") or "gemini-3.1-flash-tts-preview"
    gt = google_text(text, model)
    # Persian ≈ 11 chars/s, plus ~1.5 s per pause/reaction tag, plus 50 % for slow tags
    expect_sec = max(3.0, len(gt) / 11.0 + 1.5 * len(re.findall(r"\[(?:short pause|long pause|sighs?|laughs?|gasps?|coughs?|crying)\]", gt)))
    if re.search(r"\[(?:very )?slow\]", gt):
        expect_sec *= 1.5
    doors = [("streamGenerateContent", f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent",
              _google_legacy_body(text, cfg)),
             ("interactions", _GOOGLE_URL, _google_body(text, cfg))]

    def call(key):
        rejects, timeouts = [], []
        for name, url, body in doors:
            _check_cancel()
            try:
                if name == "streamGenerateContent":
                    pcm_sr = _google_stream(url, body, key, expect_sec, status)
                    _diag("google_door", door=name)
                    _check_truncated(pcm_sr, expect_sec)
                    return pcm_sr
                data = _google_post(url, body, key, timeout=_G_TIMEOUT)
            except requests.Timeout as e:
                _diag("google_timeout", door=name, s=_G_TIMEOUT)
                status(f"گوگل از مسیر {name} جواب نداد ({_G_TIMEOUT} ثانیه)؛ مسیر دیگر را امتحان می‌کنم…")
                timeouts.append(e); continue
            except _GoogleHTTP as e:
                if e.code in (400, 404) and "api key" not in e.msg.lower():
                    _diag("google_reject", door=name, code=e.code, msg=e.msg[:100])
                    rejects.append(e); continue
                raise
            found = _find_audio_b64(data)
            if not found:
                raise _GoogleHTTP(500, "no audio in response")   # documented text-instead-of-audio glitch → retry
            _diag("google_door", door=name)
            pcm_sr = _google_decode(*found)
            _check_truncated(pcm_sr, expect_sec)
            return pcm_sr
        if timeouts and len(timeouts) == len(doors):
            raise RuntimeError(f"گوگل جواب نداد ({_G_TIMEOUT} ثانیه از هر دو مسیر صبر کردیم). اینترنت یا وی‌پی‌ان را چک کنید و دوباره بزنید.")
        if rejects:
            raise RuntimeError("گوگل این درخواست را قبول نکرد: " + rejects[-1].msg[:160])
        raise timeouts[-1]
    return google_rotate(call, status, "گوگل")


def google_probe(model, status):
    """Six-word request on the chosen model, reported precisely: door, HTTP,
    elapsed, seconds of audio. Turns 'no answer' into a measured fact."""
    import time
    _job_start()
    keys = _google_usable_keys()
    if not keys:
        return {"ok": False, "msg": "هیچ کلید فعالی ثبت نشده."}
    cfg = {"g_model": model or "gemini-2.5-flash-preview-tts", "g_preset": "neutral", "g_lang": "fa",
           "g_voice": "Charon"}
    text = "سلام. این فقط یک آزمایش کوتاه است."
    t0 = time.time()
    try:
        pcm, sr = _google_call(text, cfg, status)
        return {"ok": True, "msg": f"جواب رسید: {faDigits(round(len(pcm) / sr, 1))} ثانیه صدا، در {faDigits(round(time.time() - t0, 1))} ثانیه ({cfg['g_model']})",
                "seconds": round(len(pcm) / sr, 1), "elapsed": round(time.time() - t0, 1)}
    except Exception as e:
        return {"ok": False, "msg": f"{str(e)[:200]} — بعد از {faDigits(round(time.time() - t0, 1))} ثانیه", "elapsed": round(time.time() - t0, 1)}


# --- tone consistency (90-92) REMOVED. FIELD LOG (92): the pitch audit
# treated [whispers] / [sighs] / [very slow] — deliberate expression — as
# drift and re-rolled 40-60 s takes three times, then tripped the runaway
# guard. Consistency is now carried only by what costs nothing: the identical
# prompt frame per document and long parts. One take per part.
_G_LAST = {"tail": ""}   # last clause of the previous Google part in this document


def _g_lead_in(text, cfg):
    """The lead-in for a part: the previous part's last clause, unless the
    caller pinned one (regeneration) or continuity is off."""
    if cfg.get("g_continuity", True) is False or cfg.get("f_continuity", True) is False:
        return ""
    if "g_lead_in" in cfg:
        return (cfg.get("g_lead_in") or "").strip()
    return _G_LAST["tail"]


def _g_pause_plan(text):
    """[(clause_index, seconds)] — clauses that END with a pause tag, and the
    leading pause of the part (index -1) if the text starts with one."""
    plan = []
    lead = re.match(r"^\s*((?:\[\s*(?:short pause|long pause|مکث بلند|مکث)\s*\]\s*)+)", text)
    if lead:
        plan.append((-1, sum(PAUSE_SECONDS[m] for m in _G_ANY_PAUSE.findall(lead.group(1)))))
    for k, (c, _) in enumerate(_g_clauses(text)):
        tail = re.search(r"((?:\[\s*(?:short pause|long pause|مکث بلند|مکث)\s*\]\s*)+)$", c.strip())
        if tail:
            plan.append((k, sum(PAUSE_SECONDS[m] for m in _G_ANY_PAUSE.findall(tail.group(1)))))
    return plan


def _g_apply_pauses(pcm, sr, text, cuts, plan):
    """Insert real silence at the clause boundaries the plan names, topping up
    whatever natural gap already sits there so the total equals the target."""
    if not plan:
        return pcm
    cl = _g_clauses(text)
    b = [0] + list(cuts or []) + [len(pcm)]
    pieces, pos = [], 0
    lead = [sec for k, sec in plan if k == -1]
    if lead:
        pieces.append(np.zeros(int(sr * lead[0]), dtype=np.int16))
    want = {k: sec for k, sec in plan if k >= 0}
    for k in range(len(cl)):
        end = b[k + 1] if k + 1 < len(b) else len(pcm)
        seg = pcm[pos:end]
        if k in want:
            target = int(sr * want[k])
            if k == len(cl) - 1:
                seg = np.concatenate([_fade_edges(seg, sr, ms=10) if len(seg) > sr // 10 else seg, np.zeros(target, dtype=np.int16)])
            else:
                runs = _silence_runs(pcm[max(0, end - sr): min(len(pcm), end + sr)], sr, min_ms=40)
                here = [r for r in runs if r[0] <= sr <= r[1]] if runs else []
                existing = (here[0][1] - here[0][0]) if here else 0
                extra = max(0, target - existing)
                seg = np.concatenate([seg, np.zeros(extra, dtype=np.int16)])
        pieces.append(seg)
        pos = end
    out = np.concatenate(pieces)
    _diag("g_pauses", n=len(plan), added_ms=int((len(out) - len(pcm)) * 1000 / sr))
    return out


def _clause_coverage(text, words):
    """[(matched, total)] per clause from ONE alignment of the whole text against
    the transcript — the shared basis of the completeness audit and take scoring
    (127). Returns None when the transcript is not credible (< 40 % coverage)."""
    import difflib
    cl = _g_clauses(text)
    ours, owner = [], []
    for k, (c, _) in enumerate(cl):
        ws = _text_words(c); ours += ws; owner += [k] * len(ws)
    tw = [_norm_word(w) for w, _, _ in (words or [])]
    if not ours or not tw:
        return None
    if len(tw) < 0.4 * len(ours):
        _diag("g_completeness", mode="abstain", transcript=len(tw), expected=len(ours))
        return None
    sm = difflib.SequenceMatcher(None, ours, tw, autojunk=False)
    matched = set()
    for a, b_, n in sm.get_matching_blocks():
        matched.update(range(a, a + n))
    out = []
    for k in range(len(cl)):
        idx = [i for i in range(len(ours)) if owner[i] == k]
        out.append((sum(1 for i in idx if i in matched), len(idx)))
    return out


def _g_completeness(text, words):
    """The index of the first clause the recording clearly skipped, or None."""
    cov = _clause_coverage(text, words)
    if cov is None:
        return None
    for k, (hit, tot) in enumerate(cov):
        if tot >= 3 and hit < 0.4 * tot:
            _diag("g_completeness", clause=k, matched=hit, of=tot)
            return k
    return None


def google_pcm(text, cfg, status):
    """Whole-gulp synthesis, one take per part. CONTINUITY (95): Google has
    no seed and no previous-text parameter, so each part is generated with
    the previous part's last clause spoken first as a lead-in — the model
    hears where it left off — and the lead-in is cut off at its pause
    boundary. If that boundary cannot be found, the part is regenerated
    without the lead-in rather than shipped with a duplicated sentence."""
    text = text.strip()
    if not text:
        raise RuntimeError("در این بخش چیزی برای خواندن نیست.")
    chunks = _split_sentences(text, max_len=900) if len(text) > 900 else [text]
    waves, sr = [], 24000
    lead = _g_lead_in(text, cfg)
    for ci, chunk in enumerate(chunks, 1):
        _check_cancel()
        status("گوگل دارد گفتار را می‌سازد…" + (f" ({ci}/{len(chunks)})" if len(chunks) > 1 else ""))
        pcm = None
        if lead and ci == 1:
            full, sr = _google_call(lead + " " + chunk, cfg, status)
            cl = [(lead, (0, len(lead)))] + [(c, sp) for c, sp in _g_clauses(chunk)]
            cuts = _g_bounds(full, sr, cl, status, {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(cfg.get("g_lang"))) if len(cl) > 1 else None
            if not cuts:
                _diag("google_leadin", mode="fail_regen_plain")
                status("گوگل: مرز جملهٔ راهنما پیدا نشد؛ بدون راهنما می‌سازم…")
            else:
                cand = full[cuts[0]:]
                # the trim must leave roughly the part's own length; if it kept
                # the lead-in (or dropped speech) the cut was wrong — go plain
                spoken = _g_speech_len(google_text(chunk, cfg.get("g_model") or "")) / 11.0 * sr
                if not (0.5 * spoken <= len(cand) <= 2.2 * spoken + sr * 3):
                    _diag("google_leadin", mode="fail_duration", kept_ms=int(len(cand) * 1000 / sr), want_ms=int(spoken * 1000 / sr))
                    status("گوگل: برشِ جملهٔ راهنما قابل اعتماد نبود؛ بدون راهنما می‌سازم…")
                else:
                    # the cut sits mid-pause: drop the leading half so the part
                    # starts within ~60 ms of its first word (parts get their own
                    # breath at splice time)
                    x = np.abs(cand.astype(np.int32))
                    thr = max(80, int(0.02 * (x.max() or 1)))
                    nz = np.flatnonzero(x > thr)
                    if len(nz):
                        cand = cand[max(0, int(nz[0]) - int(sr * 0.06)):]
                    pcm = cand
                    _diag("google_leadin", trimmed_ms=int((len(full) - len(pcm)) * 1000 / sr), kept_ms=int(len(pcm) * 1000 / sr))
        if pcm is None:
            pcm, sr = _google_call(chunk, cfg, status)
        lang = {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(cfg.get("g_lang"))
        if cfg.get("_no_audit"):
            words = None
        else:
            pcm, sr, words, hole = _complete_take(chunk, pcm, sr, cfg, status, lang, _google_call)
            if hole:
                _G_INCOMPLETE.append(hole)
        _diag("google_take", audio_s=round(len(pcm) / sr, 1), chars=len(chunk))
        waves.append(pcm)
        if ci < len(chunks):
            waves.append(np.zeros(int(sr * 0.25), dtype=np.int16))
    cl = _g_clauses(text)
    tail = cl[-1][0].strip() if cl else ""
    tail = re.sub(r"\[[^\]]+\]", " ", tail)                 # no tags of any kind in a lead-in
    tail = re.sub(r"\s+", " ", tail).strip()
    if _g_speech_len(tail) > 160:                            # a very long last sentence → keep its end
        words = tail.split()
        tail = " ".join(words[-18:])
    _G_LAST["tail"] = tail
    return np.concatenate(waves), sr


# ---------------------------------------------------------------------------
# 127 · Completeness: keep the BEST take, repair a dropped clause by surgery,
# and never ship a hole in silence.
#
# FIELD (126): a part whose 5th sentence the model kept dropping was retried
# twice and then shipped as the LAST take — which happened to be the worst of
# the three (0 of 27 words, against 6 and 5 for the earlier ones) — with a
# warning that flashed in the status line and was gone. Three changes:
#   1. score every take and keep the best;
#   2. when one clause is missing, regenerate THAT CLAUSE and splice it in,
#      instead of re-rolling a whole part (cheaper, and it converges);
#   3. if a hole survives, report it durably with the sentence quoted.
# ---------------------------------------------------------------------------
_G_INCOMPLETE = []          # holes found during the current generate call


def take_report():
    """Holes found since the last reset — the UI badges parts from this."""
    return list(_G_INCOMPLETE)


def _take_score(text, words):
    """(missing clauses, -coverage) — lower is better. Same alignment the audit
    uses, so a take that the audit calls complete always scores 0 missing."""
    cov = _clause_coverage(text, words)
    if cov is None:
        return (99, 0.0)
    missing = sum(1 for hit, tot in cov if tot >= 3 and hit < 0.4 * tot)
    total = sum(tot for _, tot in cov) or 1
    return (missing, -(sum(hit for hit, _ in cov) / total))


def _complete_take(chunk, pcm, sr, cfg, status, lang, call):
    """Return (pcm, sr, words, hole|None). `call(text, cfg, status)` makes a take."""
    words = transcribe_words(pcm, sr, status, lang, chunk, cfg)
    best = (_take_score(chunk, words), pcm, sr, words)
    last_miss = None
    for attempt in range(2):
        miss = _g_completeness(chunk, words) if words else None
        if miss is None:
            return best[1], best[2], best[3], None
        cl = _g_clauses(chunk)
        # (2) repair: regenerate only the missing clause and splice it in
        if 0 < miss < len(cl) and len(cl) > 1:
            fixed = _repair_clause(chunk, miss, best[1], best[2], cfg, status, lang, call, best[3])
            if fixed is not None:
                pcm2, sr2 = fixed
                w2 = transcribe_words(pcm2, sr2, status, lang, chunk, cfg)
                sc2 = _take_score(chunk, w2)
                if sc2 <= best[0]:
                    best = (sc2, pcm2, sr2, w2)
                if _g_completeness(chunk, w2) is None:
                    _diag("take_repair", clause=miss, mode="spliced_ok")
                    return pcm2, sr2, w2, None
        # (1) otherwise a fresh take, and keep whichever is better
        if miss == last_miss and attempt > 0:
            break                                   # the same clause twice: re-rolling will not fix it
        last_miss = miss
        status(f"جملهٔ {faDigits(miss + 1)}اُم خوانده نشد — برداشت دوباره ({faDigits(attempt + 2)}/۳)…")
        pcm2, sr2 = call(chunk, cfg, status)
        w2 = transcribe_words(pcm2, sr2, status, lang, chunk, cfg)
        sc2 = _take_score(chunk, w2)
        if sc2 < best[0]:
            best = (sc2, pcm2, sr2, w2)
        words = w2
    miss = _g_completeness(chunk, best[3]) if best[3] else None
    hole = None
    if miss is not None:
        cl = _g_clauses(chunk)
        sent = re.sub(r"\s+", " ", re.sub(r"\[[^\]]+\]", " ", cl[miss][0])).strip()
        hole = {"clause": miss, "text": sent[:160]}
        _diag("take_incomplete", clause=miss, kept_score=best[0][0])
        status("هشدار: یک جمله در این بخش خوانده نشد: «" + sent[:60] + "…»")
    return best[1], best[2], best[3], hole


def _gap_point(chunk, idx, pcm, sr, words):
    """Sample offset where a dropped clause belonged: just after the last word
    the transcript matched from the clause before it. None when unknowable."""
    if not words or idx <= 0:
        return 0 if idx == 0 else None
    import difflib
    cl = _g_clauses(chunk)
    prev = [_norm_word(w) for w in _text_words(cl[idx - 1][0])]
    tw = [_norm_word(w) for w, _, _ in words]
    if not prev or not tw:
        return None
    sm = difflib.SequenceMatcher(None, prev, tw, autojunk=False)
    blocks = [b for b in sm.get_matching_blocks() if b.size]
    if not blocks:
        return None
    last = blocks[-1]
    end_word = min(len(words) - 1, last.b + last.size - 1)
    at = int(words[end_word][2] * sr) + int(sr * 0.05)
    return max(0, min(at, len(pcm)))


def _repair_clause(chunk, idx, pcm, sr, cfg, status, lang, call, take_words=None):
    """Generate the missing clause alone (with its neighbours for prosody) and
    splice it into the gap the transcript shows. Returns (pcm, sr) or None."""
    try:
        cl = _g_clauses(chunk)
        status("جملهٔ جاافتاده را جداگانه می‌سازم و سرِ جایش می‌گذارم…")
        lo, hi = max(0, idx - 1), min(len(cl), idx + 2)
        ctx = " ".join(c[0].strip() for c in cl[lo:hi])
        piece, psr = call(ctx, {**cfg, "g_lead_in": "", "f_continuity": False, "g_continuity": False}, status)
        pw = transcribe_words(piece, psr, status, lang, ctx, cfg)
        cuts = (_g_bounds(piece, psr, cl[lo:hi], status, lang, cfg, ctx, pw) if hi - lo > 1 else []) or []
        k = idx - lo
        a = cuts[k - 1] if k > 0 and len(cuts) >= k else 0
        b = cuts[k] if len(cuts) > k else len(piece)
        clip = piece[a:b]
        if len(clip) < psr // 4:
            return None
        # Where the gap sits in the original: right after the last word of the
        # clause before it, taken from the take's OWN transcript (never a new
        # one — the take is missing text, so aligning it afresh is unreliable).
        at = _gap_point(chunk, idx, pcm, sr, take_words)
        if at is None:
            return None
        if psr != sr:
            clip = _resample(clip, psr, sr)
        if clip is None or len(clip) == 0 or len(pcm) == 0:
            return None
        gap = np.zeros(int(sr * 0.12), dtype=np.int16)
        at = max(0, min(int(at), len(pcm)))
        out = np.concatenate([p for p in (pcm[:at], gap, clip, gap, pcm[at:]) if len(p)])
        _diag("take_repair", clause=idx, added_ms=int(len(clip) * 1000 / sr), at_ms=int(at * 1000 / sr))
        return out, sr
    except Exception as e:
        _diag("take_repair_err", msg=str(e)[:90])
        return None


# ---------------------------------------------------------------------------
# Google clause surgery (94)
# ---------------------------------------------------------------------------
_G_PAUSE_TAG = re.compile(r"\[(?:short pause|long pause|مکث بلند|مکث)\]")
# 128: ؟ ! … end a sentence even when the writer forgot the space after them
# («خوندی !؟حیرت آورن» is two sentences); «.» still needs whitespace so that
# decimals and abbreviations are not cut; a colon that introduces speech ends
# its line.
# 129: a clause ends at a sentence stop, a COLON or SEMICOLON, or a line break.
#   · ؟ ! … end a sentence even when the space after them was forgotten
#     («خوندی !؟حیرت آورن» is two sentences);
#   · «.» still needs whitespace after it, so ۳.۵ and abbreviations stay whole;
#   · «:» and «؛/;» end a clause — they are full stops in speech — except
#     between digits (۳:۳۰) ;
#   · a line break ALWAYS ends a clause: pressing Enter creates one.
_G_SENT_END = re.compile(
    r"[.!?؟…]+[\"»)\]]*\s+"          # . ! ؟ … followed by space/newline
    r"|[!?؟…]+[\"»)\]]*(?=[^\s\d])"  # ! ؟ … with the space forgotten
    r"|(?<![0-9۰-۹]):(?![0-9۰-۹])\s*"  # colon, but not inside a time like ۳:۳۰
    r"|[؛;]\s*"                        # semicolon (Persian and Latin)
    r"|\n+")


def _g_clauses(text):
    """Google-text clauses. A clause ends at a sentence stop, a newline, or a
    PAUSE tag (which stays with the clause before it — that is where the
    silence falls). Other tags never split: a reaction/state tag opens the
    clause that follows it, a mid-sentence tag stays inside its sentence.
    Fragments without real words merge forward. Returns [(text, (start, end))]."""
    cuts = set()
    for m in _G_SENT_END.finditer(text):
        cuts.add(m.end())
    for m in _G_PAUSE_TAG.finditer(text):
        mm = re.compile(r"\s+").match(text, m.end())
        cuts.add(mm.end() if mm else m.end())
    cuts = sorted(c for c in cuts if 0 < c < len(text))
    spans, pos = [], 0
    for c in cuts:
        spans.append((pos, c)); pos = c
    spans.append((pos, len(text)))
    spans = [(a, b) for a, b in spans if text[a:b].strip()]
    # merge fragments that carry no words (tags only / a stray mark) forward
    out = []
    k = 0
    while k < len(spans):
        a, b = spans[k]
        words = re.sub(r"\[[^\]]+\]", "", text[a:b]).strip()
        if len(re.findall(r"\w+", words)) == 0:
            # a pause tag is the silence AFTER the previous clause → backward;
            # any other wordless fragment (reaction/state tags) → forward
            if _G_PAUSE_TAG.search(text[a:b]) and out:
                out[-1] = (out[-1][0], b); k += 1; continue
            if k + 1 < len(spans):
                spans[k + 1] = (a, spans[k + 1][1]); k += 1; continue
            if out:
                out[-1] = (out[-1][0], b); k += 1; continue
        out.append((a, b)); k += 1
    return [(text[a:b], (a, b)) for a, b in out]


def _g_speech_len(text):
    """Characters that are actually spoken: no tags, no punctuation, no spaces."""
    return len(re.sub(r"\[[^\]]+\]|[\W_]+", "", text))


def _g_boundaries(pcm, sr, clauses):
    """Sample positions of the B = len(clauses)-1 clause boundaries inside a
    recording. FIELD LOG (94): estimating by raw text proportion put a
    boundary after «قسمتِ سوم،» — half of that clause's characters were tags
    that produce no speech, and the nearest silence to a wrong estimate was a
    comma breath. Now: estimates by SPOKEN characters, candidates ranked by
    silence LENGTH (a sentence stop or [short pause] is far longer than a
    comma), validated against the estimates; None when it does not add up."""
    B = len(clauses) - 1
    if B <= 0:
        return []
    total = sum(_g_speech_len(c[0]) for c in clauses) or 1
    expect, acc = [], 0
    for c in clauses[:-1]:
        acc += _g_speech_len(c[0])
        expect.append(int(len(pcm) * acc / total))
    runs = None
    for min_ms in (110, 70):
        runs = _silence_runs(pcm, sr, min_ms=min_ms)
        if len(runs) >= B:
            break
    if not runs or len(runs) < B:
        _diag("g_boundaries", runs=len(runs or []), need=B, mode="fail")
        return None
    tol = max(int(sr * 1.5), int(0.45 * len(pcm) / (B + 1)))
    def ok(ch):
        return len(ch) == B and all(ch[k][2] < ch[k + 1][2] for k in range(B - 1)) and \
               all(abs(ch[k][2] - expect[k]) <= tol for k in range(B))
    if len(runs) == B:
        chosen, mode = list(runs), "exact"
        if not ok(chosen):
            _diag("g_boundaries", runs=B, need=B, mode="fail_exact_far")
            return None
    else:
        # 1) the B longest silences, in order — the model's real stops
        longest = sorted(sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[:B], key=lambda r: r[2])
        if ok(longest):
            chosen, mode = longest, "longest"
        else:
            # 2) per boundary, the nearest silence to its estimate, order-preserving
            avail, chosen = list(runs), []
            for m in expect:
                cand = [r for r in avail if (not chosen or r[2] > chosen[-1][2])]
                if not cand:
                    break
                pick = min(cand, key=lambda r: abs(r[2] - m))
                chosen.append(pick)
            mode = "nearest"
            if not ok(chosen):
                _diag("g_boundaries", runs=len(runs), need=B, mode="fail_nearest")
                return None
    _diag("g_boundaries", runs=len(runs), need=B, mode=mode,
          ms=[int(r[2] * 1000 / sr) for r in chosen], expect_ms=[int(e * 1000 / sr) for e in expect])
    return [_zc_snap(pcm, r[2], sr) for r in chosen]


def _google_clause_patch(entry, new_text, sel_start, sel_end, cfg, status):
    """Replace only the changed/selected clauses of a Google part. Returns
    the number of clauses regenerated, or 0 when a whole-part take is the
    honest fallback (single clause, everything changed, boundaries unfound)."""
    import difflib
    old_text, pcm, sr = entry["text"], entry["items"][0]["pcm"], entry["sr"]
    oc, nc = _g_clauses(old_text), _g_clauses(new_text)
    if len(oc) < 2 or len(nc) < 1:
        return 0
    sm = difflib.SequenceMatcher(None, [c[0].strip() for c in oc], [c[0].strip() for c in nc], autojunk=False)
    ops = [o for o in sm.get_opcodes() if o[0] != "equal"]
    if ops:
        i0, i1 = min(o[1] for o in ops), max(o[2] for o in ops)
        j0, j1 = min(o[3] for o in ops), max(o[4] for o in ops)
    else:
        # text unchanged: the selection names the clause(s) to redo
        if sel_start is None or sel_end is None or sel_end <= sel_start:
            return 0
        hit = [k for k, c in enumerate(nc) if c[1][0] < sel_end and c[1][1] > sel_start]
        if not hit:
            return 0
        i0 = j0 = hit[0]; i1 = j1 = hit[-1] + 1
    if ops and sel_start is not None and sel_end is not None and sel_end > sel_start:
        # a selection widens the range; outside the changed span old and new
        # clauses correspond 1:1 (prefix: same index, suffix: shifted by delta)
        hit = [k for k, c in enumerate(nc) if c[1][0] < sel_end and c[1][1] > sel_start]
        if hit:
            delta = len(oc) - len(nc)
            nj0, nj1 = min(j0, hit[0]), max(j1, hit[-1] + 1)
            if nj0 < j0:
                i0 = min(i0, nj0)
            if nj1 > j1:
                i1 = max(i1, nj1 + delta)
            j0, j1 = nj0, nj1
    if i0 <= 0 and i1 >= len(oc):
        return 0                                    # everything changed: nothing to save
    if j1 <= j0:
        # pure deletion: drop the old clauses' audio, keep the neighbours
        cuts = _g_bounds(pcm, sr, oc, status, {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(cfg.get("g_lang")))
        if cuts is None:
            return 0
        b = [0] + cuts + [len(pcm)]
        out = _crossfade_join([x for x in (pcm[:b[i0]], pcm[b[i1]:]) if len(x)], sr)
        entry.update({"items": [{"kind": "t", "text": new_text.strip(), "span": (0, len(new_text.strip())), "pcm": out}],
                      "text": new_text.strip()})
        _diag("g_clause_patch", removed=i1 - i0)
        return i1 - i0
    lang = {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(cfg.get("g_lang"))
    cuts = _g_bounds(pcm, sr, oc, status, lang)
    if cuts is None:
        return 0
    b = [0] + cuts + [len(pcm)]
    # regenerate the changed clauses with one neighbour on each side as
    # prosodic context, then keep only the middle
    before = nc[j0 - 1][0].strip() if j0 > 0 else ""
    after = nc[j1][0].strip() if j1 < len(nc) else ""
    middle = " ".join(c[0].strip() for c in nc[j0:j1])
    gen_text = "\n".join(x for x in (before, middle, after) if x)   # 128: newline, never a space
    status(f"گوگل: {faDigits(j1 - j0)} جمله را همراه جمله‌های کناری‌اش دوباره می‌سازد…")
    new_pcm, nsr = cloud_pcm(gen_text, {**cfg, "_no_audit": True}, status)   # 128: no audit/retry on a surgical piece
    gcl = _g_clauses(gen_text)
    k0 = 1 if before else 0
    k1 = k0 + (j1 - j0)
    if len(gcl) != k1 + (1 if after else 0):
        _diag("g_clause_patch", reason=f"gen_clauses_{len(gcl)}_vs_{k1 + (1 if after else 0)}")
        return 0
    gcuts = _g_bounds(new_pcm, nsr, gcl, status, lang)
    if gcuts is None:
        return 0
    gb = [0] + gcuts + [len(new_pcm)]
    seg = new_pcm[gb[k0]:gb[k1]]
    if nsr != sr:
        seg = _resample(seg, nsr, sr)
    # sanity: the new clause must fit the part's speaking rate — a cut at the
    # wrong silence produces a fragment far too short or long for its words
    rate = len(pcm) / max(1, _g_speech_len(old_text))            # samples per spoken char
    want = rate * max(1, _g_speech_len(middle))
    if not (0.45 * want <= len(seg) <= 2.2 * want):
        _diag("g_clause_patch", reason="segment_duration", got_ms=int(len(seg) * 1000 / sr), want_ms=int(want * 1000 / sr))
        return 0
    # loudness: the new clause sits at the part's level
    old_rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    seg_rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2))) or 1.0
    g = float(np.clip(old_rms / seg_rms, 0.5, 2.0))
    if abs(g - 1.0) > 0.05:
        seg = np.clip(seg.astype(np.float32) * g, -32768, 32767).astype(np.int16)
    seg = _sweep_stubs(seg, sr)
    parts = [x for x in (pcm[:b[i0]], seg, pcm[b[i1]:]) if len(x)]
    out = _crossfade_join(parts, sr, ms=12)
    entry.update({"items": [{"kind": "t", "text": new_text.strip(), "span": (0, len(new_text.strip())), "pcm": out}],
                  "text": new_text.strip()})
    _diag("g_clause_patch", old=(i0, i1), new=(j0, j1), kept_ms=int((len(pcm) - (b[i1] - b[i0])) * 1000 / sr))
    return j1 - j0


# ---------------------------------------------------------------------------
# Gemini 3.5 Transcribe (96) — word timestamps: exact clause boundaries in any
# language, and the timing source for captions.
# ---------------------------------------------------------------------------
GOOGLE_TRANSCRIBE = "gemini-3.5-transcribe"
_G_WORDS_CACHE = {}          # sha1(pcm) -> words
_G_WORDS_ON = {"on": True}   # switched off by the UI or after repeated failures


def _norm_word(w):
    w = re.sub(r"[\u064B-\u0652\u0670\u0640\u200c\u200d]", "", w)        # harakat, tatweel, ZWNJ
    w = w.replace("ي", "ی").replace("ك", "ک").replace("ۀ", "ه").replace("ة", "ه")
    w = re.sub(r"\[[^\]]+\]", "", w)
    return re.sub(r"[\W_]+", "", w).lower()


def _text_words(text):
    return [t for t in (_norm_word(x) for x in re.sub(r"\[[^\]]+\]", " ", text).split()) if t]


def _parse_secs(v):
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.match(r"^\s*([0-9.]+)\s*s?\s*$", v)
        if m:
            return float(m.group(1))
    if isinstance(v, dict):                      # {"seconds": 1, "nanos": 500000000}
        return float(v.get("seconds", 0)) + float(v.get("nanos", 0)) / 1e9
    return None


def _find_words(obj):
    """Locate a word-timestamp list wherever the response nests it."""
    if isinstance(obj, dict):
        for k in ("words", "word_timestamps", "wordTimestamps"):
            if isinstance(obj.get(k), list) and obj[k] and isinstance(obj[k][0], dict):
                out = []
                for w in obj[k]:
                    txt = w.get("word") or w.get("text") or ""
                    st = _parse_secs(w.get("start") if "start" in w else w.get("startTime", w.get("start_time", w.get("startOffset", w.get("start_offset")))))
                    en = _parse_secs(w.get("end") if "end" in w else w.get("endTime", w.get("end_time", w.get("endOffset", w.get("end_offset")))))
                    if txt and st is not None and en is not None:
                        out.append((txt, st, en))
                if out:
                    return out
        for v in obj.values():
            r = _find_words(v)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_words(v)
            if r:
                return r
    return None


def _words_key(pcm, text, lang, who):
    """The cache identity of a transcript: the WHOLE recording, the EXACT text
    it should contain, the language and the transcriber. Any change in any of
    them — one diacritic, one space, one tag — is a different key, so a cached
    transcript can never describe audio or text that has moved on. (127)"""
    import hashlib
    h = hashlib.sha1()
    h.update(pcm.tobytes())                      # the whole take, not a prefix
    h.update(b"\x00" + (text or "").encode("utf-8"))
    h.update(b"\x00" + (lang or "").encode() + b"\x00" + (who or "").encode())
    return h.hexdigest()


def _words_cache_put(key, words):
    _G_WORDS_CACHE[key] = words
    if len(_G_WORDS_CACHE) > 240:                # bounded; oldest out
        for k in list(_G_WORDS_CACHE)[:40]:
            _G_WORDS_CACHE.pop(k, None)


def shift_words(words, seconds):
    """Word list of a trimmed take, derived from the full take's transcript —
    so trimming never costs a second transcription. Words that fall before the
    cut are dropped. (127)"""
    if not words:
        return words
    out = [(w, s - seconds, e - seconds) for w, s, e in words if e - seconds > 0]
    return [(w, max(0.0, s), e) for w, s, e in out]


def fish_words(pcm, sr, status, lang=None, text=None):
    """Transcript from Fish Audio's own ASR (transcribe-1), as [(word, s, e)].
    Fish returns SEGMENTS, not words: each segment's text is spread evenly over
    its span. Good enough for the completeness audit; boundaries derived from
    it are marked coarse so callers can fall back. (127)"""
    key = _words_key(pcm, text, lang, "fish")
    if key in _G_WORDS_CACHE:
        return _G_WORDS_CACHE[key]
    try:
        status("Fish Audio: رونویسی صدا…")
        j = fish_asr(pcm, sr, {"fa-IR": "fa", "en-US": "en"}.get(lang or "", None))
    except Exception as e:
        _diag("fish_words_err", msg=str(e)[:90])
        return None
    out = []
    for seg in (j.get("segments") or []):
        txt = (seg.get("text") or "").strip()
        st, en = float(seg.get("start", 0) or 0), float(seg.get("end", 0) or 0)
        ws = txt.split()
        if not ws or en <= st:
            continue
        step = (en - st) / len(ws)
        for i, w in enumerate(ws):
            out.append((w, st + i * step, st + (i + 1) * step))
    _diag("fish_words", n=len(out), segments=len(j.get("segments") or []), audio_s=round(len(pcm) / sr, 1))
    _words_cache_put(key, out or None)
    return out or None


def transcribe_words(pcm, sr, status, lang=None, text=None, cfg=None):
    """One door for every transcript in the app. Which service is used is the
    user's setting (f_asr): fish / google / fish then google. Google parts
    always use Google — transcribing Google audio with Fish is the same waste
    in reverse. (127)"""
    cfg = cfg or {}
    mode = (cfg.get("f_asr") or "fish") if cfg.get("engine") == "fish" else "google"
    if mode == "fish":
        return fish_words(pcm, sr, status, lang, text)
    if mode == "fish_google":
        w = fish_words(pcm, sr, status, lang, text)
        if w:
            return w
        status("رونویسی با Fish Audio نشد؛ با گوگل امتحان می‌کنم…")
    return google_words(pcm, sr, status, lang, text)


def google_words(pcm, sr, status, lang=None, text=None):
    """[(word, start_s, end_s)] for a recording, or None. Cached per recording
    AND per text (127) so an edit can never meet a stale transcript."""
    if not _G_WORDS_ON["on"] or not _google_usable_keys():
        return None
    import base64, io
    key = _words_key(pcm, text, lang, "google")
    if key in _G_WORDS_CACHE:
        return _G_WORDS_CACHE[key]
    p = _resample(pcm, sr, 16000) if sr != 16000 else pcm
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000); wf.writeframes(p.tobytes())
    body = {"contents": [{"parts": [{"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(buf.getvalue()).decode()}}]}],
            "generationConfig": {"audioTranscriptionConfig": {"wordTimestamp": True,
                                 **({"languageCodes": [lang]} if lang else {})}}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GOOGLE_TRANSCRIBE}:generateContent"
    try:
        status("دارم صدا را با زمان‌بندی رونویسی می‌کنم…")
        data = google_rotate(lambda k: _google_post(url, body, k, timeout=120), status, "رونویسی")
        words = _find_words(data)
        _diag("google_words", n=len(words or []), audio_s=round(len(pcm) / sr, 1))
        _words_cache_put(key, words)
        return words
    except Cancelled:
        raise
    except Exception as e:
        _diag("google_words", err=str(e)[:120])
        return None


def _g_boundaries_words(pcm, sr, clauses, words):
    """Clause boundaries from word timestamps: align our clause words to the
    transcript (order-preserving, diacritic-insensitive) and cut midway in
    the gap after each clause's last matched word. None if alignment is thin."""
    import difflib
    B = len(clauses) - 1
    if B <= 0:
        return []
    ours, owner = [], []
    for k, (c, _) in enumerate(clauses):
        ws = _text_words(c)
        ours += ws; owner += [k] * len(ws)
    tw = [_norm_word(w) for w, _, _ in words]
    if not ours or not tw:
        return None
    sm = difflib.SequenceMatcher(None, ours, tw, autojunk=False)
    m2t = {}
    for a, b, n in sm.get_matching_blocks():
        for i in range(n):
            m2t[a + i] = b + i
    if len(m2t) < 0.6 * len(ours):
        _diag("g_words_align", matched=len(m2t), of=len(ours), mode="thin")
        return None
    cuts = []
    for k in range(B):
        last = [i for i in range(len(ours)) if owner[i] == k and i in m2t]
        nxt = [i for i in range(len(ours)) if owner[i] == k + 1 and i in m2t]
        if not last or not nxt:
            _diag("g_words_align", clause=k, mode="unmatched")
            return None
        j, j2 = m2t[last[-1]], m2t[nxt[0]]
        # Between the two anchors there may be words the ASR mis-heard OR
        # omitted entirely (FIELD, 96: «یا یک شورا میگرفت» went missing and the
        # midpoint cut it in half). So the boundary is found in the AUDIO of
        # that window: the longest silence in it. Only if the audio shows no
        # silence there do we fall back to the widest transcript gap.
        a, b = int(words[j][2] * sr), int(words[j2][1] * sr)
        if b - a > sr * 0.05:
            a, b = max(0, min(int(a), len(pcm))), max(0, min(int(b), len(pcm)))
            runs = _silence_runs(pcm[a:b], sr, min_ms=70) if b > a else []
            if runs:
                r = max(runs, key=lambda r: r[1] - r[0])
                cuts.append(a + r[2]); continue
        best_gap, best_t = -1.0, words[j][2]
        for q in range(j, j2):
            gap = words[q + 1][1] - words[q][2]
            if gap > best_gap:
                best_gap, best_t = gap, (words[q][2] + words[q + 1][1]) / 2 if gap > 0 else words[q][2]
        cuts.append(int(best_t * sr))
    if any(cuts[k] >= cuts[k + 1] for k in range(B - 1)) or cuts[-1] >= len(pcm):
        return None
    _diag("g_boundaries", need=B, mode="words", ms=[int(c * 1000 / sr) for c in cuts])
    return [_zc_snap(pcm, c, sr) for c in cuts]


def _g_bounds(pcm, sr, clauses, status, lang=None, cfg=None, text=None, words=None):
    """Word timestamps first (exact, language-independent); the silence
    heuristic when transcription is unavailable or the alignment is thin.
    127: accepts an already-made transcript so a take is never transcribed twice."""
    if len(clauses) <= 1:
        return []
    if words is None:
        words = transcribe_words(pcm, sr, status, lang, text, cfg)
    if words:
        cuts = _g_boundaries_words(pcm, sr, clauses, words)
        if cuts is not None:
            return cuts
    return _g_boundaries(pcm, sr, clauses)


# ---------------------------------------------------------------------------
# Captions (96) — SRT / VTT from the parts' own text and their measured timing
# ---------------------------------------------------------------------------
def _fmt_srt(t):
    h = int(t // 3600); m = int(t % 3600 // 60); s_ = t % 60
    return f"{h:02d}:{m:02d}:{int(s_):02d},{int(round((s_ - int(s_)) * 1000)):03d}"


def _caption_text(t):
    t = re.sub(r"\[[^\]]+\]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def captions_for(ids, status):
    """Cues per clause across the spliced document, using the same splice
    timing (0.12 s breath between parts). Returns {"srt", "vtt", "cues"}."""
    cues, t0 = [], 0.0
    for gid in ids:
        entry = _GULP_PCM.get(int(gid))
        if entry is None:
            raise RuntimeError("این بخش دیگر در حافظه نیست؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
        pcm, sr = _assemble(entry), entry["sr"]
        dur = len(pcm) / sr
        if entry.get("engine") in ("silence", "file"):
            t0 += dur + 0.12
            continue
        if entry.get("engine") in ("google", "fish"):
            cl = _g_clauses(entry["text"])
            cuts = _g_bounds(pcm, sr, cl, status, {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get((entry.get("payload") or {}).get("g_lang")))
            if cuts is None:
                cuts = []
                cl = [(entry["text"], (0, len(entry["text"])))]
        else:
            # local engines already know each clause's audio
            cl, cuts, pos = [], [], 0
            for it in entry["items"]:
                n = len(it["pcm"]) if it["kind"] == "t" else int(it["sec"] * sr)
                if it["kind"] == "t":
                    cl.append((it["text"], (0, 0)))
                    if pos + n < len(pcm):
                        cuts.append(pos + n)
                pos += n
            cuts = cuts[:len(cl) - 1]
        b = [0] + list(cuts) + [len(pcm)]
        for k, (c, _) in enumerate(cl):
            txt = _caption_text(c)
            if not txt:
                continue
            cues.append((t0 + b[k] / sr + (0.05 if k else 0), t0 + b[k + 1] / sr - 0.05, txt))
        t0 += dur + 0.12
    srt = "\n".join(f"{i}\n{_fmt_srt(a)} --> {_fmt_srt(b)}\n{txt}\n" for i, (a, b, txt) in enumerate(cues, 1))
    vtt = "WEBVTT\n\n" + "\n".join(f"{_fmt_srt(a).replace(',', '.')} --> {_fmt_srt(b).replace(',', '.')}\n{txt}\n" for a, b, txt in cues)
    return {"srt": srt, "vtt": vtt, "cues": [{"start": a, "end": b, "text": t} for a, b, t in cues]}


# ---------------------------------------------------------------------------
# Lyria 3.5 (96) — background music for the final file, mixed under the voice
# ---------------------------------------------------------------------------
LYRIA_MODEL = "lyria-3.5"
MUSIC_PRESETS = {
    "piano":     "Soft, slow solo piano with gentle sustain and a warm, intimate tone.",
    "ambient":   "Calm ambient pads and slow evolving textures, no melody in the foreground, very even.",
    "strings":   "Slow, warm string ensemble, long bowed chords, cinematic but restrained.",
    "acoustic":  "Gentle fingerpicked acoustic guitar, slow tempo, warm and unhurried.",
    "lofi":      "Mellow lo-fi beat at 70 BPM, soft Rhodes chords, light vinyl texture, laid-back.",
    "cinematic": "Understated cinematic underscore: low strings, soft piano, distant percussion, slow build that never peaks.",
    "persian":   "Slow, meditative Persian classical mood on santur and tar with a soft daf, no vocals, gentle and contemplative.",
    "oud":       "Slow oud and ney in a meditative Middle Eastern mode, sparse, warm, no vocals.",
    "corporate": "Clean, light, optimistic background music with soft piano and muted guitar, steady pulse, unobtrusive.",
    "suspense":  "Low, quiet, tense underscore with slow pulses and dark pads, restrained, no climax.",
    "children":  "Light, playful, gentle music box and soft xylophone, slow and kind.",
    "night":     "Quiet nocturne: soft piano and faint strings, nocturnal and still.",
}
_MUSIC = {"pcm": None, "sr": None, "prompt": ""}


def lyria_music(preset, custom, seconds, status):
    """A steady, instrumental background bed of roughly `seconds` seconds.
    The bed is generated ONCE per document and cached; the mix is redone
    cheaply for any level/ducking change."""
    import base64, io
    prompt = (custom or "").strip() or MUSIC_PRESETS.get(preset or "piano", MUSIC_PRESETS["piano"])
    want = int(min(180, max(60, seconds + 8)))
    text = (f"{prompt} Instrumental only, no vocals, no lyrics. About {want} seconds long. "
            "This is background music under spoken narration: keep it steady and unobtrusive from start to end, "
            "no sudden dynamics, no drum fills, no big climax, consistent mood throughout, gentle ending.")
    body = {"model": LYRIA_MODEL, "input": text, "response_format": {"type": "audio", "mime_type": "audio/wav"}}
    status("دارم موسیقی پس‌زمینه را می‌سازم… (شاید یک دقیقه‌ای طول بکشد)")
    # Lyria has NO free tier ($0.08 per track, paid projects only). A free-tier
    # key answers 403/429 here while being perfectly good for speech, so those
    # answers must not flag the key — try each key, then say what is needed.
    data, denied = None, []
    for key in _google_usable_keys():
        _check_cancel()
        try:
            data = _google_post(_GOOGLE_URL, body, key, timeout=300); break
        except _GoogleHTTP as e:
            if e.code in (401, 403) or (e.code == 400 and "api key" in e.msg.lower()):
                _google_mark(key, "bad"); denied.append(e.msg[:80]); continue
            if e.code in (402, 429) or "billing" in e.msg.lower():
                denied.append(e.msg[:80]); continue
            raise RuntimeError("موسیقی: " + e.msg[:160])
    if data is None:
        if not _google_usable_keys():
            raise RuntimeError("هنوز کلید گوگل ندارید؛ از دکمهٔ «کلیدهای گوگل» یک کلید وارد کنید.")
        raise RuntimeError("ساخت موسیقی با لیریا فقط با کلیدِ پولی (پروژه‌ای که صورت‌حساب دارد) کار می‌کند؛ لیریا طرح رایگان ندارد — هر قطعه حدود ۸ سنت. "
                           + ("پاسخ گوگل: " + denied[-1] if denied else ""))
    found = _find_audio_b64(data)
    if not found:
        raise RuntimeError("لیریا موسیقی‌ای تحویل نداد؛ دوباره امتحان کنید یا حال‌وهوای دیگری بخواهید.")
    raw = base64.b64decode(found[0])
    if raw[:4] == b"RIFF":
        with wave.open(io.BytesIO(raw)) as wf:
            msr, ch, sw = wf.getframerate(), wf.getnchannels(), wf.getsampwidth()
            frames = wf.readframes(wf.getnframes())
        if sw == 2:
            a = np.frombuffer(frames, dtype="<i2").astype(np.float32)
        elif sw == 3:
            b3 = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
            a = ((b3[:, 0].astype(np.int32) | (b3[:, 1].astype(np.int32) << 8) | (b3[:, 2].astype(np.int32) << 16)) << 8 >> 8).astype(np.float32) / 256.0
        else:
            a = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 65536.0
        if ch > 1:
            a = a.reshape(-1, ch).mean(axis=1)
        mono = np.clip(a, -32768, 32767).astype(np.int16)
    else:
        try:
            import soundfile as sf
            a, msr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
            mono = np.clip(a.mean(axis=1) * 32767, -32768, 32767).astype(np.int16)
        except Exception:
            raise RuntimeError("موسیقی با قالبی رسید که برنامه نمی‌تواند بخواند (WAV خواسته بودیم).")
    _MUSIC.update({"pcm": mono, "sr": msr, "prompt": text})
    _diag("lyria", seconds=round(len(mono) / msr, 1), sr=msr)
    try:
        music_save(mono, msr, "lyria", (custom or "").strip() or MUSIC_PRESETS.get(preset or "piano", "")[:40])
    except Exception as e:
        _diag("music_save", err=str(e)[:80])
    return mono, msr


# --- music library (98): every paid-for bed is kept on this machine -------
_MUSIC_DIR = MODELS_DIR / "music"


def music_save(pcm, sr, preset, custom):
    """Store a bed as 16-bit mono WAV plus a manifest line. Returns the entry."""
    import time
    _MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%d-%H-%M-%S")
    name = f"{stamp}-{preset}.wav"
    with wave.open(str(_MUSIC_DIR / name), "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(int(sr)); wf.writeframes(pcm.astype(np.int16).tobytes())
    entry = {"file": name, "preset": preset, "custom": custom, "seconds": round(len(pcm) / sr, 1), "created": stamp}
    lib = music_list()
    lib.insert(0, entry)
    (_MUSIC_DIR / "library.json").write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
    return entry


def music_list():
    try:
        lib = json.loads((_MUSIC_DIR / "library.json").read_text(encoding="utf-8"))
        return [e for e in lib if (_MUSIC_DIR / e["file"]).exists()]
    except Exception:
        return []


def music_load(file):
    """Make a saved bed the current one (no generation, no cost)."""
    p = _MUSIC_DIR / os.path.basename(file)
    if not p.exists():
        raise RuntimeError("این موسیقی دیگر روی دستگاه نیست.")
    with wave.open(str(p)) as wf:
        sr = wf.getframerate()
        pcm = np.frombuffer(wf.readframes(wf.getnframes()), dtype="<i2").astype(np.int16)
    _MUSIC.update({"pcm": pcm, "sr": sr, "prompt": file})
    return pcm, sr


def music_delete(file):
    p = _MUSIC_DIR / os.path.basename(file)
    if p.exists():
        p.unlink()
    lib = [e for e in music_list() if e["file"] != os.path.basename(file)]
    (_MUSIC_DIR / "library.json").write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
    return lib


def _envelope(x, sr, attack=0.12, release=0.45, win=0.03):
    """Smoothed loudness envelope (0..1) of a float signal."""
    n = max(1, int(sr * win))
    rms = np.sqrt(np.convolve(x * x, np.ones(n) / n, mode="same"))
    peak = float(rms.max()) or 1.0
    e = rms / peak
    out = np.empty_like(e)
    a_up, a_dn = np.exp(-1.0 / (sr * attack)), np.exp(-1.0 / (sr * release))
    v = 0.0
    for i in range(len(e)):
        c = a_up if e[i] > v else a_dn
        v = c * v + (1 - c) * e[i]
        out[i] = v
    return out


def mix_music(voice, vsr, music, msr, level_db=-16.0, duck=True, duck_db=12.0, fade_in=1.5, fade_out=3.0):
    """Voice with music underneath: music loudness set relative to the voice,
    optional ducking under speech, fade in/out, a 2 s musical tail."""
    if msr != vsr:
        music = _resample(music, msr, vsr)
    v = voice.astype(np.float32)
    tail = int(vsr * 2.0)
    total = len(v) + tail
    m = music.astype(np.float32)
    if len(m) < total:                              # loop with a 1 s crossfade
        pieces, xf = [m], int(vsr * 1.0)
        while sum(len(p) for p in pieces) - xf * (len(pieces) - 1) < total:
            pieces.append(m)
        m = _crossfade_join(pieces, vsr, ms=1000).astype(np.float32) if len(pieces) > 1 else m
    m = m[:total]
    if len(m) < total:
        m = np.concatenate([m, np.zeros(total - len(m), dtype=np.float32)])
    vr = float(np.sqrt(np.mean(v * v))) or 1.0
    mr = float(np.sqrt(np.mean(m * m))) or 1.0
    m *= (vr / mr) * (10 ** (level_db / 20.0))
    if duck:
        # speech gate: the envelope is normalised and saturated so the bed sits
        # at full duck under any real speech (≈0.2 s in) and swells back over
        # ≈1.5 s after the voice stops — audible, never abrupt
        env = _envelope(v / 32768.0, vsr)
        gate = np.clip(env / 0.6, 0.0, 1.0)
        g = 1.0 - (1.0 - 10 ** (-duck_db / 20.0)) * gate
        m[:len(v)] *= g
        _diag("mix_duck", ducked_pct=int(100 * float((gate > 0.5).mean())), swell_pct=int(100 * float((gate < 0.2).mean())),
              level_db=level_db, duck_db=duck_db)
    fi, fo = int(vsr * fade_in), int(vsr * fade_out)
    if fi:
        m[:fi] *= np.linspace(0, 1, fi)
    if fo:
        m[-fo:] *= np.linspace(1, 0, fo)
    out = m.copy()
    out[:len(v)] += v
    pk = float(np.abs(out).max()) or 1.0
    if pk > 32000:
        out *= 32000 / pk
    return out.astype(np.int16)


def final_files(ids, music_cfg, status):
    _require_license()
    """The clean final file, and — when music is requested — a second file
    with the music bed mixed under it. Both returned as MP3 bytes."""
    clean_pcm, sr = _splice_pcm(ids, status)
    out = {"clean": pcm_to_mp3(clean_pcm, sr), "seconds": round(len(clean_pcm) / sr, 1)}
    if music_cfg and music_cfg.get("on"):
        if _MUSIC["pcm"] is None and music_cfg.get("file"):
            music_load(music_cfg["file"])                       # the library track the UI shows as chosen
        if _MUSIC["pcm"] is None:
            if music_cfg.get("provider") == "lyria":
                lyria_music(music_cfg.get("preset"), music_cfg.get("custom"), len(clean_pcm) / sr, status)
            else:
                raise RuntimeError("موسیقی‌ای انتخاب نشده؛ از منبع بالا یکی را انتخاب کنید یا از «موسیقی‌های قبلی» بردارید.")
        status("دارم موسیقی را زیر صدا می‌گذارم…")
        mixed = mix_music(clean_pcm, sr, _MUSIC["pcm"], _MUSIC["sr"],
                          level_db=float(music_cfg.get("level_db", -16)), duck=bool(music_cfg.get("duck", True)),
                          fade_out=float(music_cfg.get("fade_out", music_cfg.get("fade", 1.5))), fade_in=float(music_cfg.get("fade_in", 1.5)))
        out["music"] = pcm_to_mp3(mixed, sr)
    return out


# ---------------------------------------------------------------------------
# Free music providers (100) — Openverse (no key), Freesound, Jamendo, own file
# ---------------------------------------------------------------------------
MUSIC_PROVIDERS = ["freesound", "openverse", "jamendo", "lyria", "file"]


def builtin_key(name):
    """Keys shipped inside the app (builtin_keys.json) for the free music
    sources — used only when the user has not saved their own."""
    try:
        return (json.loads(_res_path("builtin_keys.json").read_text(encoding="utf-8")) or {}).get(name, "") or ""
    except Exception:
        return ""


def music_key(name):
    return load_key(name) or builtin_key(name)
# Per-platform search recipes. Freesound: tag filters (its tags are the real
# index); Jamendo: its genre/mood/instrument vocabulary via fuzzytags; Openverse:
# plain text over titles/tags. Order = the app's style menu.
MUSIC_STYLES = [
    ("ambient",   "Ambient · ethereal synth, no drums",
        {"freesound": ("ambient pad", 'tag:(ambient OR pad OR atmosphere OR synth)'), "jamendo": ("ambient", "ambient,relaxing"), "openverse": "ambient pad synth"}),
    ("drone",     "Drone · deep atmosphere, no drums",
        {"freesound": ("drone", 'tag:(drone OR atmosphere OR dark-ambient)'), "jamendo": ("drone", "ambient,dark"), "openverse": "drone atmosphere"}),
    ("lofi",      "Lo-fi · soft beat",
        {"freesound": ("lofi", 'tag:(lofi OR lo-fi OR chill)'), "jamendo": ("lofi", "lofi,chillout"), "openverse": "lofi chill"}),
    ("piano",     "Piano · solo, calm",
        {"freesound": ("piano", 'tag:(piano)'), "jamendo": ("piano", "piano,relaxing"), "openverse": "calm piano solo"}),
    ("cinematic", "Cinematic · strings, slow",
        {"freesound": ("cinematic", 'tag:(cinematic OR strings OR orchestral)'), "jamendo": ("cinematic", "soundtrack,cinematic"), "openverse": "cinematic strings"}),
    ("guitar",    "Acoustic guitar · gentle",
        {"freesound": ("acoustic guitar", 'tag:(guitar OR acoustic)'), "jamendo": ("acoustic guitar", "acoustic,guitar,relaxing"), "openverse": "acoustic guitar gentle"}),
    ("meditation","Meditation · bowls, ney, slow",
        {"freesound": ("meditation", 'tag:(meditation OR singing-bowl OR ney OR relaxing)'), "jamendo": ("meditation", "meditation,newage"), "openverse": "meditation"}),
    ("persian",   "Persian · santur, tar, setar",
        {"freesound": ("persian", 'tag:(persian OR santur OR tar OR setar OR iranian)'), "jamendo": ("persian", "persian,world"), "openverse": "santur tar persian"}),
    ("nature",    "Nature ambience · rain, wind, forest",
        {"freesound": ("ambience", 'tag:(rain OR wind OR forest OR nature OR ambience)'), "jamendo": ("nature ambient", "ambient,nature"), "openverse": "rain ambience"}),
    ("musicbox",  "Music box · light, playful",
        {"freesound": ("music box", 'tag:(music-box OR musicbox OR celesta OR playful)'), "jamendo": ("music box", "playful,children"), "openverse": "music box"}),
]
MOOD_QUERIES = {k: v["openverse"] for k, _, v in MUSIC_STYLES}
MUSIC_PAGE = 8


def _decode_audio(raw):
    """PCM mono int16 + rate from WAV/MP3/OGG/FLAC bytes."""
    import io
    if raw[:4] == b"RIFF":
        with wave.open(io.BytesIO(raw)) as wf:
            sr, ch, sw = wf.getframerate(), wf.getnchannels(), wf.getsampwidth()
            frames = wf.readframes(wf.getnframes())
        if sw != 2:
            raise RuntimeError("این فایل WAV شانزده‌بیتی نیست.")
        a = np.frombuffer(frames, dtype="<i2").astype(np.float32)
        if ch > 1:
            a = a.reshape(-1, ch).mean(axis=1)
        return a.astype(np.int16), sr
    try:
        import soundfile as sf
        a, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
    except Exception as e:
        raise RuntimeError("این قالب صوتی را نمی‌توانم بخوانم (" + type(e).__name__ + ")؛ WAV، MP3، OGG یا FLAC بدهید.")
    return np.clip(a.mean(axis=1) * 32767, -32768, 32767).astype(np.int16), int(sr)


def _http_get_json(url, params, headers=None, timeout=30):
    r = requests.get(url, params=params, headers=headers or {}, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:120]}")
    return r.json()


def music_search(provider, query, key, status, style="ambient", page=1):
    """One page (MUSIC_PAGE) of candidates for a style — or a free-text query
    when the user typed one. Returns {items, page, has_more}."""
    _check_cancel()
    q = (query or "").strip()
    recipe = next((v for k, _, v in MUSIC_STYLES if k == style), MUSIC_STYLES[0][2])
    page = max(1, int(page or 1))
    status(f"جست‌وجوی موسیقی در {provider}… صفحهٔ {faDigits(page)}")
    out = []
    if provider == "openverse":
        data = _http_get_json("https://api.openverse.org/v1/audio/",
                              {"q": q or recipe["openverse"], "license": "cc0,pdm",
                               "page_size": MUSIC_PAGE, "page": page, "mature": "false"},
                              headers={"User-Agent": "Ava/102 (narration app)"})
        for it in data.get("results", []):
            if not it.get("url"):
                continue
            out.append({"id": it.get("id"), "title": it.get("title") or "—", "author": it.get("creator") or "",
                        "seconds": round((it.get("duration") or 0) / 1000), "license": (it.get("license") or "").upper(),
                        "preview": it.get("url"), "download": it.get("url"), "page": it.get("foreign_landing_url") or ""})
    elif provider == "freesound":
        if not key:
            raise RuntimeError("برای Freesound کلید لازم است: در freesound.org ثبت‌نام کنید و از freesound.org/apiv2/apply کلید بگیرید.")
        fq, ftags = recipe["freesound"]
        flt = 'license:"Creative Commons 0" duration:[20 TO 900]' + ("" if q else " " + ftags)
        data = _http_get_json("https://freesound.org/apiv2/search/text/",
                              {"query": q or fq, "filter": flt,
                               "fields": "id,name,username,license,duration,previews,url", "sort": "rating_desc",
                               "page_size": MUSIC_PAGE, "page": page, "token": key})
        for it in data.get("results", []):
            pv = (it.get("previews") or {}).get("preview-hq-mp3") or (it.get("previews") or {}).get("preview-lq-mp3")
            if not pv:
                continue
            out.append({"id": it.get("id"), "title": it.get("name") or "—", "author": it.get("username") or "",
                        "seconds": round(it.get("duration") or 0), "license": "CC0", "preview": pv, "download": pv, "page": it.get("url") or ""})
    elif provider == "jamendo":
        if not key:
            raise RuntimeError("برای Jamendo کلید (client_id) لازم است: در devportal.jamendo.com یک اپ بسازید و شناسه‌اش را بردارید.")
        jq, jtags = recipe["jamendo"]
        params = {"client_id": key, "format": "json", "limit": MUSIC_PAGE, "offset": (page - 1) * MUSIC_PAGE,
                  "include": "licenses", "vocalinstrumental": "instrumental", "audioformat": "mp32", "order": "popularity_total"}
        if q:
            params["search"] = q
        else:
            params["fuzzytags"] = jtags
        data = _http_get_json("https://api.jamendo.com/v3.0/tracks/", params)
        for it in data.get("results", []):
            if not it.get("audio"):
                continue
            lic = (it.get("license_ccurl") or "").rstrip("/").split("/")
            lic_txt = ("CC " + lic[-2].upper()) if len(lic) >= 2 and lic[-2] else "CC"
            out.append({"id": it.get("id"), "title": it.get("name") or "—", "author": it.get("artist_name") or "",
                        "seconds": int(it.get("duration") or 0), "license": lic_txt, "preview": it["audio"],
                        "download": it.get("audiodownload") or it["audio"], "page": it.get("shareurl") or ""})
    else:
        raise RuntimeError("این منبع جست‌وجو ندارد.")
    _diag("music_search", provider=provider, style=style, page=page, n=len(out))
    if not out and page == 1:
        raise RuntimeError("چیزی پیدا نشد؛ سبک یا عبارت دیگری امتحان کنید.")
    return {"items": out[:MUSIC_PAGE], "page": page, "has_more": len(out) >= MUSIC_PAGE}


def music_fetch(provider, item, status):
    """Download the chosen track, decode it, make it the current bed, keep it."""
    _check_cancel()
    url = item.get("download") or item.get("preview")
    if not url:
        raise RuntimeError("این قطعه نشانی دانلود ندارد.")
    status("دانلود موسیقی…")
    r = requests.get(url, timeout=120, headers={"User-Agent": "Ava/100 (narration app)"})
    if r.status_code != 200:
        raise RuntimeError(f"دانلود نشد (HTTP {r.status_code}).")
    pcm, sr = _decode_audio(r.content)
    if len(pcm) < sr * 5:
        raise RuntimeError("این قطعه کمتر از پنج ثانیه است؛ برای پس‌زمینه کوتاه است.")
    _MUSIC.update({"pcm": pcm, "sr": sr, "prompt": f"{provider}:{item.get('title', '')}"})
    entry = music_save(pcm, sr, provider, item.get("title", ""))
    entry.update({"author": item.get("author", ""), "license": item.get("license", ""), "page": item.get("page", "")})
    lib = music_list()
    for e in lib:
        if e["file"] == entry["file"]:
            e.update({"author": entry["author"], "license": entry["license"], "page": entry["page"]})
    (_MUSIC_DIR / "library.json").write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
    _diag("music_fetch", provider=provider, seconds=round(len(pcm) / sr, 1), license=entry["license"])
    return pcm, sr, entry


def music_import(path, status):
    """A file from disk becomes the bed and joins the library."""
    p = Path(path)
    if not p.is_file():
        raise RuntimeError("فایل پیدا نشد.")
    pcm, sr = _decode_audio(p.read_bytes())
    _MUSIC.update({"pcm": pcm, "sr": sr, "prompt": "file:" + p.name})
    entry = music_save(pcm, sr, "file", p.stem)
    return pcm, sr, entry


def music_credit(entry):
    """The attribution line a CC-BY track needs; empty for CC0/PD/own/Lyria."""
    lic = (entry or {}).get("license", "").upper()
    if not entry or lic in ("", "CC0", "PDM", "PUBLIC DOMAIN") or entry.get("preset") in ("lyria", "file"):
        return ""
    return f"موسیقی: «{entry.get('custom') or entry.get('file')}» از {entry.get('author', '')} — {lic} — {entry.get('page', '')}"


# ===========================================================================
# 116 · Director lists — ages and states, shared by Google (prompt notes) and
# Fish (bracket cues). Each entry: id, fa label, en label, Google note, Fish cue.
# ===========================================================================
DIRECTOR_AGES = [
    ("", "— بدون تغییر —", "— unchanged —", "", ""),
    ("toddler", "نوپا (۲–۴ ساله)", "Toddler (2–4)", "Voice: a toddler of about three — tiny, very high-pitched, babbling cadence, simple words stretched out, giggly and unsteady.", "[voice of a toddler, tiny, very high-pitched, babbling]"),
    ("child", "بچه (۵–۹ ساله)", "Child (5–9)", "Voice: a child of about seven — high, bright, breathy, eager, sing-song schoolroom rhythm.", "[voice of a young child around seven, high and bright, sing-song]"),
    ("teen", "نوجوان (۱۳–۱۷ ساله)", "Teenager (13–17)", "Voice: a teenager — youthful, light, a touch of attitude, energy that comes and goes mid-sentence.", "[teenage voice, youthful with a touch of attitude]"),
    ("young", "جوان (۲۰ تا ۳۰ ساله)", "Young adult (20s)", "Voice: a young adult in their twenties — fresh, quick, energetic.", "[young adult voice, fresh and energetic]"),
    ("adult", "بزرگسال (۳۰ تا ۴۵ ساله)", "Adult (30s–40s)", "Voice: an adult in their thirties or forties — settled, full, confident.", "[adult voice, settled and confident]"),
    ("middle", "میان‌سال (۵۰ تا ۶۰ ساله)", "Middle-aged (50s)", "Voice: a middle-aged person in their fifties — fuller, slower, a little gravel, unhurried authority.", "[middle-aged voice, fuller, unhurried, a little gravel]"),
    ("elderly", "سالخورده (۷۰ ساله)", "Elderly (70s)", "Voice: an elderly person around seventy — slower, softer, slightly hoarse, small pauses for breath, words landing gently.", "[elderly voice around seventy, slower, softer, slightly hoarse]"),
    ("very_old", "خیلی پیر (۹۰ به بالا)", "Very old (90+)", "Voice: a very old person past ninety — NOT young, NOT smooth. Thin, cracked and wobbly; hoarse, gravelly and breathy; wheezing between phrases; slow, halting, with long pauses; pitch unsteady; every word an effort. Keep this frailty on every sentence.", "[voice of a ninety-year-old, hoarse, cracked, trembling and breathy, slow and halting, wheezing between phrases]"),
    ("custom", "سفارشی…", "Custom…", "", ""),
]
DIRECTOR_STATES = [
    ("", "— بدون تغییر —", "— unchanged —", "", ""),
    # joy & energy
    ("happy", "شاد", "Happy", "Emotional state: happy, warm and bright.", "[happy]"),
    ("joyful", "سرخوش", "Joyful", "Emotional state: joyful, lit up, smiling through the words.", "[joyful]"),
    ("ecstatic", "از خوشحالی منفجر", "Explosively excited", "Emotional state: explosively excited, bursting, breathless with joy, rushing the words.", "[extremely excited, bursting with joy]"),
    ("playful", "شیطون و بازیگوش", "Playful", "Emotional state: playful, teasing, light.", "[playful, teasing]"),
    ("flirty", "لوند و دلبر", "Flirty", "Emotional state: flirty — warm, teasing, lingering on words, a smile in the voice.", "[flirty, teasing, a smile in the voice]"),
    ("sexy", "اغواگر", "Seductive", "Emotional state: seductive — low, slow, intimate and breathy.", "[seductive, low and breathy]"),
    ("daydreamy", "توی رؤیا", "Daydreamy", "Emotional state: daydreamy — drifting, soft, faraway, unhurried.", "[dreamy, faraway, drifting]"),
    ("dreamy", "خواب‌آلود", "Sleepy", "Emotional state: sleepy, drowsy, slow, words softening at the end.", "[sleepy, drowsy]"),
    ("proud", "مغرور و سربلند", "Proud", "Emotional state: proud, chest out, savoring the words.", "[proud]"),
    ("confident", "مطمئن", "Confident", "Emotional state: confident, assured, unhurried.", "[confident]"),
    ("arrogant", "متکبر", "Arrogant", "Emotional state: arrogant, condescending, looking down on the listener.", "[arrogant, condescending]"),
    ("heroic", "حماسی و قهرمانانه", "Heroic", "Emotional state: heroic, resolute, rising, chest-voice.", "[heroic, resolute]"),
    ("hopeful", "امیدوار", "Hopeful", "Emotional state: hopeful, lifting.", "[hopeful]"),
    ("grateful", "قدردان", "Grateful", "Emotional state: grateful, moved, sincere.", "[grateful, moved]"),
    ("loving", "عاشقانه و مهربان", "Loving", "Emotional state: loving, tender, affectionate.", "[loving, tender]"),
    ("motherly", "مادرانه", "Motherly", "Emotional state: motherly — soothing, protective, gentle.", "[motherly, soothing, gentle]"),
    ("comforting", "دلداری‌دهنده", "Comforting", "Emotional state: comforting, calm, reassuring.", "[comforting, reassuring]"),
    ("calm", "آرام", "Calm", "Emotional state: calm, serene, even.", "[calm]"),
    ("meditative", "مراقبه‌وار", "Meditative", "Emotional state: meditative, slow, hushed, spacious.", "[meditative, slow, hushed]"),
    ("thoughtful", "متفکر", "Thoughtful", "Emotional state: thoughtful, pausing to think, measured.", "[thoughtful, pensive]"),
    ("curious", "کنجکاو", "Curious", "Emotional state: curious, leaning in, rising intonation.", "[curious]"),
    ("surprised", "متعجب", "Surprised", "Emotional state: surprised, caught off guard.", "[surprised]"),
    ("astonished", "بهت‌زده", "Astonished", "Emotional state: astonished, jaw-dropped, disbelieving.", "[astonished, disbelieving]"),
    ("confused", "گیج", "Confused", "Emotional state: confused, halting, unsure of the words.", "[confused, halting]"),
    ("doubtful", "مردد", "Doubtful", "Emotional state: doubtful, skeptical.", "[doubtful, skeptical]"),
    ("determined", "مصمم", "Determined", "Emotional state: determined, gritted, firm.", "[determined, firm]"),
    # sorrow & weakness
    ("sad", "غمگین", "Sad", "Emotional state: sad, heavy, subdued.", "[sad]"),
    ("grieving", "سوگوار", "Grieving", "Emotional state: grieving, hollow, voice thick with loss.", "[grieving, voice thick with loss]"),
    ("crying", "در حال گریه", "Crying while speaking", "Emotional state: crying while speaking — voice breaking, catching on breaths, wet and unsteady.", "[crying while speaking, voice breaking][sobbing]"),
    ("sobbing", "هق‌هق‌کنان", "Sobbing", "Emotional state: sobbing hard between words, gasping.", "[sobbing hard][gasping]"),
    ("depressed", "افسرده", "Depressed", "Emotional state: depressed — flat, slow, drained, no lift at all.", "[depressed, flat and drained]"),
    ("lonely", "تنها", "Lonely", "Emotional state: lonely, quiet, distant.", "[lonely, quiet]"),
    ("nostalgic", "دلتنگِ گذشته", "Nostalgic", "Emotional state: nostalgic, wistful, half-smiling at a memory.", "[nostalgic, wistful]"),
    ("tired", "خسته و بی‌رمق", "Exhausted", "Emotional state: exhausted — heavy, dragging, sighing, low energy.", "[exhausted, dragging][sighing]"),
    ("sick", "بیمار", "Sick", "Emotional state: sick — weak, congested, effortful.", "[sick, weak and congested]"),
    ("in_pain", "دردمند", "In pain", "Emotional state: in physical pain — strained, clipped, wincing between words.", "[in pain, strained][groaning]"),
    ("dying", "در حال مرگ", "Dying", "Emotional state: dying — faint, breathless, fading, long gaps, barely holding the words.", "[dying, faint and breathless, fading][panting]"),
    ("drunk", "مست", "Drunk", "Emotional state: drunk — slurred, loose, wandering pitch, sudden laughs.", "[drunk, slurring, wandering]"),
    ("bored", "حوصله‌سررفته", "Bored", "Emotional state: bored, flat, sighing, dragging.", "[bored, flat]"),
    ("resigned", "تسلیم", "Resigned", "Emotional state: resigned, giving up, quiet acceptance.", "[resigned]"),
    # fear & nerves
    ("nervous", "مضطرب", "Nervous", "Emotional state: nervous, anxious, quick shallow breaths, tremor.", "[nervous, anxious]"),
    ("scared", "ترسیده", "Scared", "Emotional state: scared, tight, hushed, alert.", "[scared]"),
    ("terrified", "وحشت‌زده", "Terrified", "Emotional state: terrified — shaking, breath catching, on the edge of a scream.", "[terrified, shaking][gasping]"),
    ("panicked", "دستپاچه", "Panicked", "Emotional state: panicked, rushing, words tumbling.", "[panicked, rushing]"),
    ("paranoid", "بدگمان", "Paranoid", "Emotional state: paranoid, whispering, glancing around, suspicious of everything.", "[paranoid, suspicious, hushed]"),
    ("suspicious", "مشکوک", "Suspicious", "Emotional state: suspicious, narrowing, probing.", "[suspicious]"),
    ("embarrassed", "خجالت‌زده", "Embarrassed", "Emotional state: embarrassed, awkward, small.", "[embarrassed]"),
    ("ashamed", "شرمنده", "Ashamed", "Emotional state: ashamed, head down, quiet.", "[ashamed]"),
    ("guilty", "گناهکار", "Guilty", "Emotional state: guilty, hesitant, confessing.", "[guilty, hesitant]"),
    ("caught", "مچ‌گرفته‌شده", "Caught red-handed", "Emotional state: caught red-handed — stammering, backpedaling, nervous laugh, excuses piling up.", "[caught red-handed, stammering, nervous laugh]"),
    ("lying", "در حال دروغ‌گفتن", "Lying", "Emotional state: lying — over-smooth, a little too quick, small hesitations, forced sincerity.", "[lying, overly smooth, forced sincerity]"),
    ("pleading", "التماس‌کنان", "Pleading", "Emotional state: pleading, begging, desperate.", "[pleading, begging]"),
    ("apologetic", "پشیمان و عذرخواه", "Apologetic", "Emotional state: apologetic, regretful, soft.", "[apologetic, regretful]"),
    # cunning & cold
    ("cunning", "مکار", "Cunning", "Emotional state: cunning — sly, silky, calculating, savoring each word.", "[cunning, sly, calculating]"),
    ("plotting", "توطئه‌گر", "Plotting", "Emotional state: plotting — low, conspiratorial, gleeful scheming.", "[plotting, conspiratorial, gleeful]"),
    ("mischievous", "شیطنت‌آمیز", "Mischievous", "Emotional state: mischievous, impish, barely holding a grin.", "[mischievous, impish]"),
    ("villain", "شرور", "Villainous", "Emotional state: villainous — cold relish, theatrical menace.", "[villainous, cold relish, menacing]"),
    ("envious", "حسود", "Envious", "Emotional state: envious, bitter, wanting.", "[envious, bitter]"),
    ("jealous", "غیرتی و حسود", "Jealous", "Emotional state: jealous, possessive, tight.", "[jealous, possessive]"),
    ("sarcastic", "کنایه‌آمیز", "Sarcastic", "Emotional state: sarcastic, dry, mocking.", "[sarcastic, dry]"),
    ("mocking", "تمسخرآمیز", "Mocking", "Emotional state: mocking, sneering, imitating.", "[mocking, sneering]"),
    ("disgusted", "منزجر", "Disgusted", "Emotional state: disgusted, recoiling.", "[disgusted]"),
    ("contemptuous", "تحقیرآمیز", "Contemptuous", "Emotional state: contemptuous, scornful.", "[contemptuous, scornful]"),
    ("cold", "سرد و بی‌تفاوت", "Cold, indifferent", "Emotional state: cold, indifferent, flat, uninterested.", "[cold, indifferent]"),
    ("threatening", "تهدیدآمیز", "Threatening", "Emotional state: threatening — low, slow, menacing.", "[threatening, low and menacing]"),
    # anger & force
    ("irritated", "کلافه", "Irritated", "Emotional state: irritated, short, clipped.", "[irritated, clipped]"),
    ("angry", "عصبانی", "Angry", "Emotional state: angry, hard-edged, pressing.", "[angry]"),
    ("furious", "خشمگین", "Furious", "Emotional state: furious — raised, ragged, barely controlled.", "[furious, raised and ragged]"),
    ("mad", "دیوانه‌وار عصبانی", "Mad, raging", "Emotional state: raging mad — shouting, hysterical, out of control.", "[enraged, hysterical][shouting]"),
    ("ordering", "دستوردهنده", "Commanding", "Emotional state: commanding, giving orders — clipped, authoritative, no room for argument.", "[commanding, authoritative, giving orders]"),
    ("protesting", "معترض", "Protesting", "Emotional state: protesting, defiant, indignant, rising.", "[protesting, indignant, defiant]"),
    ("accusing", "متهم‌کننده", "Accusing", "Emotional state: accusing, pointed, sharp, pressing the charge.", "[accusing, sharp and pointed]"),
    ("defiant", "سرکش", "Defiant", "Emotional state: defiant, unyielding.", "[defiant]"),
    ("preaching", "موعظه‌گر", "Preaching", "Emotional state: preaching — elevated, rhythmic, exhorting.", "[preaching, elevated and rhythmic]"),
    # delivery / sound
    ("whisper", "نجوا", "Whispering", "Delivery: whispering throughout, hushed and close.", "[whispering]"),
    ("secretive", "رازآلود و آهسته", "Secretive", "Delivery: secretive — low, hushed, glancing over the shoulder.", "[secretive, hushed]"),
    ("shouting", "فریادزنان", "Shouting", "Delivery: shouting, loud, projecting.", "[shouting]"),
    ("screaming", "جیغ‌کشان", "Screaming", "Delivery: screaming, at the top of the voice.", "[screaming]"),
    ("breathless", "نفس‌نفس‌زنان", "Out of breath", "Delivery: out of breath, panting between phrases.", "[out of breath][panting]"),
    ("laughing", "خنده‌کنان", "Laughing while speaking", "Delivery: laughing while speaking, words breaking into laughter.", "[laughing while speaking][laughing]"),
    ("giggling", "ریزخند", "Giggling", "Delivery: giggling, barely suppressing laughter.", "[giggling]"),
    ("eerie", "شبح‌وار", "Ghostly, eerie", "Delivery: ghostly, eerie, hollow, slow and drawn out.", "[ghostly, eerie, hollow]"),
    ("robotic", "ماشینی و یکنواخت", "Robotic, monotone", "Delivery: robotic, monotone, evenly spaced.", "[robotic, monotone]"),
    ("solemn", "رسمی و باوقار", "Solemn", "Delivery: solemn, grave, ceremonial.", "[solemn, grave]"),
    ("storyteller", "قصه‌گو", "Storytelling", "Delivery: a storyteller by the fire — warm, paced, suspense in the pauses.", "[storytelling, warm, suspenseful pauses]"),
    ("custom", "سفارشی…", "Custom…", "", ""),
]
_AGE_BY_ID = {a[0]: a for a in DIRECTOR_AGES}
_STATE_BY_ID = {a[0]: a for a in DIRECTOR_STATES}


def _director_note(age, age_custom, state, state_custom):
    """The Google prompt sentence(s) for an age and a state (or custom text)."""
    out = []
    if age == "custom" and (age_custom or "").strip():
        out.append("Voice: " + age_custom.strip().rstrip(".") + ".")
    elif age and age in _AGE_BY_ID and _AGE_BY_ID[age][3]:
        out.append(_AGE_BY_ID[age][3])
    if state == "custom" and (state_custom or "").strip():
        out.append("Emotional state / delivery: " + state_custom.strip().rstrip(".") + ".")
    elif state and state in _STATE_BY_ID and _STATE_BY_ID[state][3]:
        out.append(_STATE_BY_ID[state][3])
    return " ".join(out)


def _director_cues(age, age_custom, state, state_custom):
    """The Fish bracket cue(s) for an age and a state."""
    cues = ""
    if age == "custom" and (age_custom or "").strip():
        cues += "[" + age_custom.strip().strip("[]") + "]"
    elif age and age in _AGE_BY_ID and _AGE_BY_ID[age][4]:
        cues += _AGE_BY_ID[age][4]
    if state == "custom" and (state_custom or "").strip():
        cues += "[" + state_custom.strip().strip("[]") + "]"
    elif state and state in _STATE_BY_ID and _STATE_BY_ID[state][4]:
        cues += _STATE_BY_ID[state][4]
    return cues


# ===========================================================================
# 116 · Fish Audio engine — S2.1 Pro (free / paid), library, cloning,
# voice design, dialogue, prosody, cues, ASR, wallet.
# ===========================================================================
FISH_API = "https://api.fish.audio"
FISH_MODELS = {
    "s2.1-pro-free": {"paid": False, "label": "S2.1 Pro — رایگان"},
    "s2.1-pro": {"paid": True, "label": "S2.1 Pro — پولی ($15 / M بایت)"},
    "s2-pro": {"paid": True, "label": "S2 Pro — نسل قبل (پولی)"},
    "s1": {"paid": True, "label": "S1 — قدیمی (پولی، بدون چندگوینده)"},
}
# reading-style presets rendered as Fish cues (free-form natural language works on S2)
FISH_STYLE_CUES = {
    "neutral": "", "audiobook": "[audiobook narration, measured pace]", "news": "[news bulletin, formal, crisp, even pace]",
    "breaking": "[breaking-news bulletin, brisk and tight]", "documentary": "[documentary narration, spacious, deliberate]",
    "kids": "[children's storytelling, simple animated phrasing, slow]", "poem": "[poetry recital, metered, rests at line ends]",
    "speech": "[public speech, projected, purposeful pauses]", "radio": "[radio advert, quick punchy phrasing]", "podcast": "[podcast host, conversational]",
    "teacher": "[teaching, step by step, slow on key terms]", "ivr": "[phone announcement, very clear, even]",
    "dryhumor": "[deadpan comedic timing]", "sports": "[sports commentary, fast play-by-play]", "epic": "[epic narration, slow and monumental]", "spiritual": "[recitation, reverent, even]",
}
FISH_TAGS = [
    ["مکث", ["[break]", "[long-break]"]],
    ["احساس‌ها", ["[happy]", "[sad]", "[angry]", "[excited]", "[calm]", "[nervous]", "[confident]", "[surprised]", "[scared]", "[worried]", "[frustrated]", "[depressed]", "[curious]", "[sarcastic]", "[hopeful]", "[nostalgic]", "[disgusted]", "[jealous]", "[determined]", "[bored]"]],
    ["شدت و لحن", ["[whispering]", "[shouting]", "[screaming]", "[soft tone]", "[in a hurry tone]", "[emphasis]", "[slightly sad]", "[very excited]", "[extremely angry]"]],
    ["صداها و واکنش‌ها", ["[laughing]", "[chuckling]", "[giggling]", "[sobbing]", "[crying loudly]", "[sighing]", "[groaning]", "[panting]", "[gasping]", "[yawning]", "[snoring]", "[clear throat]", "[coughing]", "[inhale]", "[exhale]"]],
    ["جمع", ["[audience laughing]", "[background laughter]", "[crowd laughing]"]],
]
FISH_LIBRARY_TAGS = ["child", "kid", "boy", "girl", "young", "old", "elderly", "grandpa", "grandma", "male", "female", "deep", "soft", "narrator", "audiobook", "storytelling", "anime", "cartoon", "villain", "robot", "persian", "farsi", "arabic", "turkish"]
_FISH_CACHE = {"models": {}}            # clip path -> Fish model id (private clones of the bundled clips)
_FISH_MODELS_FILE = MODELS_DIR / "fish_models.json"


def fish_key():
    return (load_key("fish") or "").strip()


def _fish_headers(model=None, content="application/json"):
    k = fish_key()
    if not k:
        raise RuntimeError("کلید Fish Audio ثبت نشده؛ از fish.audio/app/api-keys یک کلید رایگان بگیرید و در «کلید Fish Audio» وارد کنید.")
    h = {"Authorization": "Bearer " + k, "Content-Type": content}
    if model:
        h["model"] = model
    return h


def _fish_err(r):
    try:
        j = r.json()
        if isinstance(j, list) and j:
            return "; ".join(str(x.get("msg", x)) for x in j[:3])
        if isinstance(j, dict):
            return j.get("message") or j.get("detail") or r.text[:200]
    except Exception:
        pass
    return r.text[:200]


def _fish_post(path, body, model=None, msgpack_body=False, timeout=300):
    """POST with cancel support (daemon thread polled every 250 ms)."""
    import threading
    box = {}
    def run():
        try:
            if msgpack_body:
                import msgpack
                box["r"] = requests.post(FISH_API + path, data=msgpack.packb(body, use_bin_type=True),
                                         headers=_fish_headers(model, "application/msgpack"), timeout=timeout)
            else:
                box["r"] = requests.post(FISH_API + path, json=body, headers=_fish_headers(model), timeout=timeout)
        except Exception as e:
            box["e"] = e
    t = threading.Thread(target=run, daemon=True); t.start()
    while t.is_alive():
        _check_cancel(); t.join(0.25)
    if "e" in box:
        raise RuntimeError("Fish Audio: اتصال برقرار نشد (" + type(box["e"]).__name__ + ").")
    r = box["r"]
    _diag("fish_http", path=path, code=r.status_code, ms=int(r.elapsed.total_seconds() * 1000), bytes=len(r.content))
    if r.status_code == 401:
        raise RuntimeError("Fish Audio: کلید پذیرفته نشد (401). کلید را دوباره بررسی کنید.")
    if r.status_code == 402:
        raise RuntimeError("Fish Audio: اعتبار حساب تمام شده (402). برای مدل پولی باید شارژ کنید؛ مدل رایگان s2.1-pro-free را انتخاب کنید.")
    if r.status_code == 429 or r.status_code == 503:
        raise _GoogleHTTP(r.status_code, "Fish Audio: سرور شلوغ است یا به سقف درخواست‌های هم‌زمان رسیدید (" + str(r.status_code) + ").")
    if r.status_code != 200 and r.status_code != 201:
        raise RuntimeError(f"Fish Audio ({r.status_code}): " + _fish_err(r))
    return r


def _fish_get(path, params=None, timeout=60):
    r = requests.get(FISH_API + path, params=params or {}, headers=_fish_headers(), timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"Fish Audio ({r.status_code}): " + _fish_err(r))
    return r.json()


def fish_wallet():
    """Credit balance and package — the key dialog's probe."""
    out = {}
    try:
        out["credit"] = _fish_get("/wallet/self/api-credit", {"check_free_credit": "true"}).get("credit")
    except Exception as e:
        out["error"] = str(e)[:160]
    try:
        p = _fish_get("/wallet/self/package")
        out["package"] = {"type": p.get("type"), "balance": p.get("balance"), "total": p.get("total")}
    except Exception:
        pass
    return out


def fish_text(text, cfg):
    """The text as Fish should see it: the app's pause markers become Fish's,
    reading style / age / state become cues at each sentence start (one
    primary cue block per sentence is what the model handles best)."""
    t = text.strip()
    t = _G_PAUSE_LONG.sub(" [long-break] ", t)
    t = _G_PAUSE.sub(" [break] ", t)
    t = re.sub(r"[ \t]{2,}", " ", t).strip()
    preset = cfg.get("f_preset") or "neutral"
    style = ("[" + (cfg.get("f_style") or "").strip().strip("[]") + "]") if preset == "custom" and (cfg.get("f_style") or "").strip() else FISH_STYLE_CUES.get(preset, "")
    cues = style + _director_cues(cfg.get("f_age"), cfg.get("f_age_custom"), cfg.get("f_state"), cfg.get("f_state_custom"))
    if not cues:
        return t
    # cue every sentence start — the documented placement
    out, first = [], True
    for line in t.split("\n"):
        parts = re.split(r"(?<=[.!?؟…])\s+", line)
        out.append(" ".join((cues + " " + p) if p.strip() and not p.lstrip().startswith("<|speaker") else p for p in parts))
    return "\n".join(out)


def _fish_ref_for(voice_id, status):
    """Resolve a picker value to a Fish reference: library/custom model id
    ('m:<id>') as reference_id; a local clip ('b:'/'u:') is cloned once into a
    private Fish voice and cached by path."""
    if not voice_id or voice_id == "default":
        return None
    if voice_id.startswith("m:"):
        return voice_id[2:]
    path = cbx_voice_path(voice_id)
    if not path:
        raise RuntimeError("نمونهٔ صدایی که انتخاب کرده‌اید پیدا نشد: " + voice_id)
    try:
        cache = json.loads(_FISH_MODELS_FILE.read_text(encoding="utf-8"))
    except Exception:
        cache = {}
    if cache.get(path):
        return cache[path]
    status("Fish Audio: ساختِ صدای کلون از نمونه (فقط بار اول برای هر نمونه)…")
    mid = fish_clone_create(path, Path(path).stem, status)
    cache[path] = mid
    _FISH_MODELS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _FISH_MODELS_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return mid


def fish_clone_create(path, title, status, transcript=None, enhance=False, visibility="private"):
    """POST /model — a persistent private voice from a clip (Fish runs its own
    ASR on the clip when no transcript is given). Returns the model id."""
    files = [("voices", (Path(path).name, open(path, "rb").read()))]
    data = [("type", "tts"), ("train_mode", "fast"), ("title", title[:80]), ("visibility", visibility),
            ("enhance_audio_quality", "true" if enhance else "false")]
    if transcript:
        data.append(("texts", transcript))
    r = requests.post(FISH_API + "/model", files=files, data=data, headers={"Authorization": "Bearer " + fish_key()}, timeout=180)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Fish Audio ({r.status_code}): " + _fish_err(r))
    j = r.json()
    _diag("fish_clone", id=j.get("_id"), state=j.get("state"))
    return j["_id"]


def fish_my_voices():
    """The user's own Fish voices (clones, designs)."""
    j = _fish_get("/model", {"self": "true", "page_size": 100, "sort_by": "created_at"})
    return [{"id": "m:" + it["_id"], "title": it.get("title", ""), "state": it.get("state"), "languages": it.get("languages") or [],
             "sample": ((it.get("samples") or [{}])[0].get("audio") if it.get("samples") else None)} for it in j.get("items", [])]


def fish_delete_voice(model_id):
    r = requests.delete(FISH_API + "/model/" + model_id, headers={"Authorization": "Bearer " + fish_key()}, timeout=60)
    if r.status_code not in (200, 204):
        raise RuntimeError(f"Fish Audio ({r.status_code}): " + _fish_err(r))
    return True


FISH_CATEGORIES = ["professional", "narration", "audiobook", "storytelling", "podcast", "announcer", "entertainment", "gaming", "character", "news", "education", "advertising"]


def fish_library(query="", tag=None, language=None, licensed=False, sort="score", page=1, page_size=8, category=None, quality="curated"):
    """Search the public voice library. `category` is one of Fish's use-case
    tags (their web library's sections: professional, narration, …), sent as a
    tag alongside the descriptive tag."""
    params = {"page_size": page_size, "page_number": page, "sort_by": sort}
    if query: params["title"] = query
    tags = [t for t in (category, tag) if t]
    if tags: params["tag"] = tags if len(tags) > 1 else tags[0]
    if language: params["language"] = language
    if licensed: params["licensed"] = "true"
    j = _fish_get("/model", params)
    _diag("fish_library", q=query[:30], tags=params.get("tag"), lang=language, licensed=licensed, sort=sort, page=page,
          total=j.get("total"), got=len(j.get("items", [])))
    items = []
    for it in j.get("items", []):
        if it.get("type") != "tts":
            continue
        # quality signals (their API has no "official" flag): rights-secured
        # voices, Fish's own account, and heavily used / liked voices
        author = ((it.get("author") or {}).get("nickname") or "").strip()
        official = author.lower().replace(" ", "") in ("fishaudio", "fishaudioofficial", "fish", "official")
        likes, uses = int(it.get("like_count") or 0), int(it.get("task_count") or 0)
        curated = bool(it.get("licensed")) or official or likes >= 50 or uses >= 5000
        # FIELD (116): the server's language filter is loose (Arabic voices for "fa");
        # keep only voices that list the requested language themselves
        if language and it.get("languages") and language not in [x.lower()[:2] for x in it.get("languages")]:
            continue
        items.append({"id": "m:" + it["_id"], "title": it.get("title", ""), "author": author,
                      "tags": it.get("tags") or [], "languages": it.get("languages") or [], "likes": likes, "uses": uses,
                      "licensed": bool(it.get("licensed")), "official": official, "curated": curated,
                      "sample": ((it.get("samples") or [{}])[0].get("audio") if it.get("samples") else None)})
    if quality == "curated":
        good = [i for i in items if i["curated"]]; rest = [i for i in items if not i["curated"]]
        return {"items": good, "ugc": rest, "total": j.get("total", 0), "page": page, "has_more": bool(j.get("has_more")) or len(items) >= page_size}
    return {"items": items, "ugc": [], "total": j.get("total", 0), "page": page, "has_more": bool(j.get("has_more")) or len(items) >= page_size}


def fish_voice_design(instruction, reference_text="", language=None, n=2, speed=1.0, seed=None, status=None):
    """POST /v1/voice-design ($0.01 per successful request, paid credit)."""
    body = {"instruction": instruction[:2000], "n": int(min(4, max(1, n))), "speed": float(speed)}
    if reference_text: body["reference_text"] = reference_text[:150]
    if language: body["language"] = language
    if seed is not None: body["seed"] = int(seed)
    if status: status("Fish Audio: طراحی صدا…")
    r = _fish_post("/v1/voice-design", body, model="voice-design-1", timeout=180)
    cands = r.json().get("candidates", [])
    out = []
    for i, c in enumerate(cands):
        b64 = c.get("audio_base64") or ""
        out.append({"index": i, "b64": b64})
    return out


def fish_design_keep(b64_wav, title, status):
    """Turn a design candidate into a persistent private Fish voice."""
    import base64, tempfile
    raw = base64.b64decode(b64_wav)
    tmp = Path(tempfile.mkdtemp()) / (re.sub(r"[^\w\-]+", "_", title)[:40] + ".wav")
    tmp.write_bytes(raw)
    return "m:" + fish_clone_create(str(tmp), title, status)


def fish_asr(pcm, sr, language=None):
    """POST /v1/asr (transcribe-1, paid $0.36/h) — segment timestamps; a
    fallback caption source when no Google key is available."""
    import io
    p = _resample(pcm, sr, 16000) if sr != 16000 else pcm
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000); wf.writeframes(p.tobytes())
    data = {"ignore_timestamps": "false"}
    if language: data["language"] = language
    r = requests.post(FISH_API + "/v1/asr", files={"audio": ("a.wav", buf.getvalue(), "audio/wav")}, data=data,
                      headers={"Authorization": "Bearer " + fish_key()}, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"Fish Audio ASR ({r.status_code}): " + _fish_err(r))
    return r.json()


def _fish_speakers_text(text, cfg, status):
    """Dialogue: lines 'Name: …' → <|speaker:n|> markers and a reference_id
    list, unlimited speakers (S2 family)."""
    speakers = cfg.get("f_speakers") or []
    names = [s.get("name", "").strip() for s in speakers]
    refs, out = [], []
    for s in speakers:
        refs.append(_fish_ref_for(s.get("voice") or "default", status) or "")
    for line in text.split("\n"):
        m = re.match(r"^\s*([^:：]{1,40})\s*[:：]\s*(.+)$", line)
        idx = names.index(m.group(1).strip()) if m and m.group(1).strip() in names else None
        if idx is None:
            out.append(line); continue
        sp = speakers[idx]
        cue = (FISH_STYLE_CUES.get(sp.get("preset") or "", "") if (sp.get("preset") or "") != "custom" else ("[" + (sp.get("style") or "").strip("[]") + "]" if sp.get("style") else ""))
        cue += _director_cues(sp.get("age"), sp.get("age_custom"), sp.get("state"), sp.get("state_custom"))
        out.append(f"<|speaker:{idx}|>{cue} {m.group(2).strip()}")
    return "\n".join(out), refs


def _fish_call(text, cfg, status):
    """One take from Fish: returns (pcm int16 mono, sr)."""
    model = cfg.get("f_model") or "s2.1-pro-free"
    duo = bool(cfg.get("f_speakers"))
    if duo and model == "s1":
        raise RuntimeError("مدل S1 چندگوینده را پشتیبانی نمی‌کند؛ یکی از مدل‌های S2 را انتخاب کنید.")
    if duo:
        ftext, refs = _fish_speakers_text(text, cfg, status)
        body = {"text": ftext, "reference_id": refs}
    else:
        ftext = fish_text(text, cfg)
        body = {"text": ftext}
        ref = _fish_ref_for(cfg.get("f_voice") or "default", status)
        if ref: body["reference_id"] = ref
    body.update({
        "format": "wav", "sample_rate": 44100,
        "temperature": float(min(1, max(0, cfg.get("f_temp", 0.7)))), "top_p": float(min(1, max(0, cfg.get("f_top_p", 0.7)))),
        "prosody": {"speed": float(min(2.0, max(0.5, cfg.get("f_speed", 1.0)))), "volume": float(cfg.get("f_volume", 0)), "normalize_loudness": bool(cfg.get("f_norm_loud", True))},
        "chunk_length": int(cfg.get("f_chunk", 300)), "normalize": bool(cfg.get("f_normalize", False)),
        "latency": cfg.get("f_latency") or "normal", "repetition_penalty": float(cfg.get("f_rep", 1.2)),
        "condition_on_previous_chunks": bool(cfg.get("f_cond_prev", True)),
    })
    if cfg.get("f_quality_guard"):
        body["features"] = ["quality-guard"]
    status("Fish Audio دارد گفتار را می‌سازد…")
    r = _fish_post("/v1/tts", body, model=model, timeout=600)
    raw = r.content
    if raw[:4] != b"RIFF":
        raise RuntimeError("Fish Audio صدا برنگرداند (پاسخ WAV نبود): " + raw[:80].decode("utf-8", "replace"))
    pcm, sr = _decode_audio(raw)
    _diag("fish_take", audio_s=round(len(pcm) / sr, 1), chars=len(text), model=model)
    if len(pcm) < sr // 5:
        raise _GoogleHTTP(500, "empty take")
    return pcm, sr


def _text_lang(text):
    """fa-IR for Arabic-script text, en-US for Latin text, None when unclear."""
    ar = len(re.findall(r"[\u0600-\u06FF]", text)); la = len(re.findall(r"[A-Za-z]", text))
    if ar >= 3 * la and ar > 5: return "fa-IR"
    if la >= 3 * ar and la > 5: return "en-US"
    return None


def fish_pcm(text, cfg, status):
    """Whole-part synthesis on Fish, with the same continuity lead-in and
    completeness audit as Google (both work on the recording, not the engine)."""
    text = text.strip()
    if not text:
        raise RuntimeError("در این بخش چیزی برای خواندن نیست.")
    lead = _g_lead_in(text, cfg) if cfg.get("f_continuity", True) else ""
    # FIELD (120): an English take was transcribed with a Persian hint → 1 word of 33 →
    # the completeness audit "found" a skipped sentence and forced a retake.
    lang = _text_lang(text) or {"fa": "fa-IR", "en": "en-US"}.get(cfg.get("g_lang") or "fa")
    pcm = None
    for attempt in range(3):
        try:
            if lead:
                full, sr = _fish_call(lead + "\n" + text, cfg, status)
                cl = [(lead, (0, len(lead)))] + [(c, sp) for c, sp in _g_clauses(text)]
                cuts = _g_bounds(full, sr, cl, status, lang, cfg, lead + "\n" + text) if len(cl) > 1 else None
                if cuts:
                    cand = full[cuts[0]:]
                    spoken = _g_speech_len(text) / 11.0 * sr
                    if 0.5 * spoken <= len(cand) <= 2.2 * spoken + sr * 3:
                        x = np.abs(cand.astype(np.int32)); thr = max(80, int(0.02 * (x.max() or 1))); nz = np.flatnonzero(x > thr)
                        if len(nz): cand = cand[max(0, int(nz[0]) - int(sr * 0.06)):]
                        pcm = cand
                if pcm is None:
                    status("Fish Audio: برشِ جملهٔ راهنما قابل اعتماد نبود؛ بدون راهنما می‌سازم…")
            if pcm is None:
                pcm, sr = _fish_call(text, cfg, status)
            break
        except _GoogleHTTP as e:
            _diag("fish_retry", attempt=attempt, msg=e.msg[:80])
            if attempt == 2:
                raise RuntimeError(e.msg)
            time.sleep(2.0 * (attempt + 1))
    if not cfg.get("_no_audit"):
        pcm, sr, words, hole = _complete_take(text, pcm, sr, cfg, status, lang, _fish_call)
        if hole:
            _G_INCOMPLETE.append(hole)
    else:
        words = None
    cl = _g_clauses(text)
    tail = cl[-1][0].strip() if cl else ""
    tail = re.sub(r"\s+", " ", re.sub(r"\[[^\]]+\]", " ", tail)).strip()
    if _g_speech_len(tail) > 160:
        tail = " ".join(tail.split()[-18:])
    _G_LAST["tail"] = tail
    return pcm, sr


def cloud_pcm(text, cfg, status):
    """Engine dispatch for the cloud engines (both produce one recording per part)."""
    return fish_pcm(text, cfg, status) if cfg.get("engine") == "fish" else google_pcm(text, cfg, status)


# ---- default engine (116)
_SETTINGS_FILE = MODELS_DIR / "settings.json"


def settings_get():
    try:
        return json.loads(_SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def settings_set(**kv):
    d = settings_get(); d.update({k: v for k, v in kv.items() if v is not None})
    _SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SETTINGS_FILE.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return d
