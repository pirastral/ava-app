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
            exp = rec.get("expires")
            days = None if not exp else max(0, int((float(exp) - time.time()) // 86400))
            return {"ok": True, "id": rec.get("licensee", ""), "expires": exp, "days_left": days, "copy": COPY_ID}
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


# 155 · THE SEALED VAULT. The cloud build (tools/protect.py) writes _vault.py — the copy id
# and the bundled keys, obfuscated — and compiles it to native code with the rest of the app;
# the plain token.txt / builtin_keys.json never ship. A source checkout has no vault and falls
# back to the plain files, so development works unchanged.
try:
    import _vault as _V
except Exception:
    _V = None
COPY_ID = (getattr(_V, "COPY_ID", "") or "dev") if _V else "dev"


def _vault(name):
    try:
        return (_V.get(name) or "") if _V else ""
    except Exception:
        return ""


def read_token() -> str:
    t = _vault("hf_token")
    if t:
        return t
    try:
        t = _res_path("token.txt").read_text(encoding="utf-8").strip()
        if t and "PASTE" not in t.upper():
            return t
    except Exception:
        pass
    return ""


BUILD = 182
BUILD_FA = "182"


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
                    status(f"دانلود {label}… {int(done*100/total)}%", pct=int(done * 100 / total))
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
                        status(f"دانلود {name}… {pct}%", pct=pct)
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
    status("مدل محلیِ حرکت‌گذاری دارد آماده می‌شود… (بار اول حدود 70 مگابایت دانلود دارد)")
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
    def patient(ch, i):
        # 159: the field log showed every model "experiencing high demand" and the app giving up at once
        waits = [0, 4, 10, 25]
        for k, w in enumerate(waits):
            if w:
                status(f"گوگل شلوغ است؛ {w} ثانیهٔ دیگر دوباره امتحان می‌کنم… (تکهٔ {i})")
                time.sleep(w)
            try:
                return call_one(ch)
            except Exception as e:
                m = str(e).lower()
                if k == len(waits) - 1 or not any(x in m for x in ("high demand", "overloaded", "unavailable", "503", "timed out", "timeout", "try again later")):
                    raise
                _diag("ezafe_retry", attempt=k + 1)
    for i, ch in enumerate(chunks, 1):
        status(f"حرکت‌گذاری با {label}… تکهٔ {i} از {len(chunks)}")
        t = _clean_llm(patient(ch, i))
        if _skeleton(t) != _skeleton(ch):
            t = _clean_llm(patient(ch, i))
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
    _download(url, onnx, status, f"صدای {voice_key} (~60 مگابایت)")
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
    _download(url, onnx, status, f"صدای {voice_key} (~60 مگابایت)")
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
        raise RuntimeError("قالب صدای موتور را نمی‌شناسم (نمونه‌ها 16بیتی نیستند).")
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
_CBX_RELOAD = False   # 179: set in a worker that replaces a flushed one (the model files were checked this session)


def _hf_cached(name_fragment: str) -> bool:
    hub = MODELS_DIR / "hf" / "hub"
    return hub.is_dir() and any(name_fragment.lower() in p.name.lower() for p in hub.iterdir())


def _verify_repo_cache(repo_id, status, token=None):
    """Compare every cached model file's size against the repository's
    metadata; delete and re-download any truncated/corrupted file.
    A damaged file otherwise crashes the whole app at load time."""
    try:
        import os
        _net_ready(status) if "status" in dir() else _net_ready()
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
        status("فقط همین یک بار: مدل چترباکس (حدود 2 گیگابایت) دانلود می‌شود و از این به بعد روی دستگاه می‌ماند.")

    _orig_load = torch.load
    def _patched(*a, **k):
        k.setdefault("map_location", torch.device(device))
        return _orig_load(*a, **k)
    torch.load = _patched

    token = read_token()
    if not _CBX_RELOAD:   # 179: a worker reloading after a flush skips the network check (made at this session's first load)
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
    return str(n)   # 177: every number the app shows is in English digits


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
        if total > 1:   # 179: the worker says which piece of the whole text this is
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
        # 179: no memory check here any more — the engine watches the worker from outside and, past its share of the
        #      computer's memory, flushes it and carries on (a job never ends for memory)
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
# Leaked memory cannot outlive its process. 179: when the worker grows past its
# share of this computer's memory it hands back what it made and retires, and a
# fresh one carries on from the next piece — the job goes on; it never ends
# because memory was flushed.
# ---------------------------------------------------------------------------
def _swap_used_mb():
    try:
        import psutil
        return int(psutil.swap_memory().used // (1024 * 1024))
    except Exception:
        return 0


_SWAP_BASELINE = _swap_used_mb()


def _total_mb():
    """This computer's memory in MB (None when it cannot be read)."""
    try:
        import psutil
        return int(psutil.virtual_memory().total // (1024 * 1024))
    except Exception:
        return None


def _avail_mb():
    """The memory this computer can still hand out, in MB (None when it cannot be read)."""
    try:
        import psutil
        return int(psutil.virtual_memory().available // (1024 * 1024))
    except Exception:
        return None


def _swap_hot(share, avail_mb):
    """Swap matters only as GROWTH since this launch AND under genuine
    pressure (free RAM scarce). Absolute swap locked the app out after its
    own crashes; swap-alone gating killed healthy processes. Both measured.
    179: both sides are shares of this computer's memory — growth past `share` of it, free memory under an eighth."""
    total = _total_mb() or 16000
    growth = max(0, _swap_used_mb() - _SWAP_BASELINE)
    return growth > share * total and avail_mb is not None and avail_mb < 0.125 * total


# 177 · MEMORY IS MEASURED AS ACTIVITY MONITOR MEASURES IT. On macOS a leaking process's pages are compressed
#       and do not count in rss, so rss under-reports exactly when it matters; the phys_footprint that Activity
#       Monitor shows (libproc proc_pid_rusage) counts them. 179: on Windows the private bytes (what the process has
#       committed, paged-out pages included — Task Manager's commit size); elsewhere rss.
_FP_LIB = None


def _mi_mb(mi, nt=None):
    """MB of a psutil memory_info: private bytes on Windows, rss elsewhere."""
    nt = (os.name == "nt") if nt is None else nt
    v = getattr(mi, "private", 0) if nt else 0
    return int((v or mi.rss) // (1024 * 1024))


def _footprint_mb(pid=None):
    """Memory of a process in MB, the way the system's own monitor counts it (macOS phys_footprint; Windows private
    bytes; rss elsewhere)."""
    global _FP_LIB
    pid = int(pid or os.getpid())
    if sys.platform == "darwin":
        try:
            import ctypes
            if _FP_LIB is None:
                _FP_LIB = ctypes.CDLL("/usr/lib/libproc.dylib")

            class _RU2(ctypes.Structure):   # struct rusage_info_v2 (sys/resource.h)
                _fields_ = [("uuid", ctypes.c_uint8 * 16)] + [(n, ctypes.c_uint64) for n in (
                    "user_time", "system_time", "pkg_idle_wkups", "interrupt_wkups", "pageins", "wired_size",
                    "resident_size", "phys_footprint", "proc_start_abstime", "proc_exit_abstime", "child_user_time",
                    "child_system_time", "child_pkg_idle_wkups", "child_interrupt_wkups", "child_pageins",
                    "child_elapsed_abstime", "diskio_bytesread", "diskio_byteswritten")]
            ru = _RU2()
            if _FP_LIB.proc_pid_rusage(ctypes.c_int(pid), ctypes.c_int(2), ctypes.byref(ru)) == 0 and ru.phys_footprint:
                return int(ru.phys_footprint // (1024 * 1024))
        except Exception:
            pass
    try:
        import psutil
        return _mi_mb(psutil.Process(pid).memory_info())
    except Exception:
        return 0


# 179 · CHATTERBOX'S MEMORY IS A SHARE OF THIS COMPUTER'S MEMORY, on Mac and Windows alike (the founder: a fixed 12 GB
#       wastes his 48 GB and is too much for an 8 or 12 GB machine) — and reaching it never ends the job: the worker's
#       memory goes back to the system and the work goes on.
#   soft   between two pieces (sentences), a worker past it hands back what it made and retires; a fresh one carries on
#          from the next piece. Ending the process is the only flush that frees everything (the GPU's cache included).
#   hard   in the middle of a piece, the guard stops a worker past it; that piece is made again in a fresh worker (in
#          two halves if it happens twice).
#   low    free memory under this share of the computer: a worker that has grown retires at the next piece.
#   floor  free memory under this share in the middle of a piece: the guard stops the worker at once (the computer
#          would start to freeze).
#   Every limit stays above what the model itself needs once loaded (`base`, measured in the worker; 6 GB until then)
#   and leaves `low` free. 48 GB: soft ≈ 16 GB, hard 24 GB, low ≈ 7 GB, floor ≈ 3 GB · 16 GB: soft 9.6 GB, hard ≈ 11 GB
#   · 8 GB: ≈ 7 GB (the free-memory shares stop it first).
_CBX_SHARES = {"soft": 0.33, "hard": 0.50, "step": 0.10, "low": 0.15, "floor": 0.06}
_CBX_MAX_KILLS = 10       # stops in the middle of a piece, in one job, before the engine says the text does not fit
_CBX_WAIT_MOST = 120.0    # seconds it waits for other programs to give memory back before it says so
_cbx_base_mb = 0          # the worker's memory right after the model loaded: the model's own need


def _cbx_limits(total_mb=None, base_mb=None):
    S = _CBX_SHARES
    total = int(total_mb or _total_mb() or 16000)
    base = int(base_mb or _cbx_base_mb or 6000)
    low, floor = int(total * S["low"]), int(total * S["floor"])
    cap = max(base + 500, total - low)
    soft = min(cap, max(int(total * S["soft"]), int(base * 1.6)))
    hard = max(soft, min(cap, max(int(total * S["hard"]), soft + int(total * S["step"]))))
    return {"total": total, "base": base, "soft": soft, "hard": hard, "low": low, "floor": floor}


_cbx_proc = None
_cbx_stderr = None
_cbx_lock = threading.Lock()
_cbx_last_rss = 0  # the worker's memory (MB) as of its last finished piece
_cbx_verified = False  # a worker loaded the model in this session (its files were checked): later workers reload quickly


def chatterbox_worker_main():
    """Runs inside the helper process: serve generation requests over stdio. 179: every finished piece goes back at
    once (a worker that has to stop never takes what it made with it); past its share of the computer's memory it hands
    back and retires; out of GPU memory it says so and retires (the engine makes that piece again)."""
    global _CBX_RELOAD

    def out(obj):
        # ASCII on the wire: no OS codepage can break the protocol, and
        # json.loads on the parent side restores the exact Persian string.
        sys.stdout.write(json.dumps(obj, ensure_ascii=True) + "\n")
        sys.stdout.flush()

    def leave():
        sys.stdout.flush()
        os._exit(0)   # at once: the operating system takes back every byte (no slow interpreter teardown)

    base = 0
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            items = req.get("items") or [[k, t] for k, t in enumerate(req.get("clauses") or [req["text"]])]
            lim, of, flush = req.get("limits") or {}, int(req.get("of") or len(items)), bool(req.get("flush"))
            again = bool(req.get("verified"))   # the model loaded once already in this session: its files are checked

            def status(msg, pct=None):
                if (flush or again) and msg.startswith("مدل چترباکس دارد از روی دستگاه بارگذاری می‌شود"):
                    msg = ("حافظهٔ چترباکس خالی شد؛ مدل دوباره بارگذاری می‌شود و کار از همین‌جا ادامه دارد…" if flush
                           else "مدل چترباکس دوباره بارگذاری می‌شود…")
                out({"type": "status", "msg": msg, "pct": pct})
            if not base:
                if again:   # a reload: from the files already on this computer, no network round trips
                    _CBX_RELOAD = True
                    os.environ["HF_HUB_OFFLINE"] = "1"
                _load_chatterbox(status)
                base = _footprint_mb() or 1
                out({"type": "base", "rss_mb": base})
            for key, t in items:
                if of > 1:
                    status(f"دارم گفتار را می‌سازم… بخش {int(key) + 1} از {of}")
                pcm, sr = chatterbox_pcm(t, req.get("exaggeration", 0.8), req.get("cfg_weight", 1.0),
                                         req.get("temperature", 0.0), status, speed=req.get("speed", 1.0),
                                         voice_path=req.get("voice_path") or None)
                f = tempfile.NamedTemporaryFile(suffix=".wav", delete=False); f.close()
                with wave.open(f.name, "wb") as wf:
                    wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
                    wf.writeframes(pcm.tobytes())
                rss, avail = _footprint_mb(), _avail_mb()
                out({"type": "part", "key": key, "path": f.name, "sr": sr, "rss_mb": rss, "avail_mb": avail})
                grown = rss > base * 1.25
                if lim and (rss > lim.get("soft", 1 << 40) or (grown and (
                        (avail is not None and avail < lim.get("low", 0)) or _swap_hot(0.08, avail)))):
                    out({"type": "retire", "rss_mb": rss, "avail_mb": avail})
                    leave()
            out({"type": "done", "rss_mb": _footprint_mb()})
        except Exception as e:
            s = str(e)
            if "out of memory" in s.lower():   # CUDA / MPS: the GPU's memory ran out — a fresh worker makes it again
                out({"type": "oom", "error": s[:300], "rss_mb": _footprint_mb()})
                leave()
            out({"type": "error", "error": s})


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


def _cbx_retire_proc(wait=8.0):
    """Let the worker go: its memory goes back to the system (the only flush that frees everything, the GPU's cache
    included). Waits up to `wait` s until it is gone, so the next worker starts on the freed memory."""
    global _cbx_proc, _cbx_last_rss
    p, _cbx_proc, _cbx_last_rss = _cbx_proc, None, 0
    if p is None:
        return
    try:
        p.stdin.close()
    except Exception:
        pass
    if wait <= 0:
        return
    try:
        p.wait(timeout=wait)
    except Exception:
        try:
            p.kill(); p.wait(timeout=3)
        except Exception:
            pass


def _cbx_pieces(text):
    """179: the pieces chatterbox_pcm makes of a text anyway (its sentences, none longer than 280 characters) — sent
    one by one, so a worker can hand back what it made, and retire, between any two. A text with pause tags stays
    whole (their silences are spliced inside chatterbox_pcm)."""
    t = (text or "").strip()
    if not t or _PAUSE_RE.search(t):
        return [t]
    return [p for p in _split_sentences(t) if p.strip()] or [t]


def _cbx_halve(text):
    """A piece that twice outgrew the memory is made in two: at the sentence break nearest its middle, else a comma,
    else a space. None when it is too short to cut."""
    t = (text or "").strip()
    if len(t) < 24:
        return None
    mid = len(t) // 2
    for marks in (".!?؟…؛\n", "،,", " "):
        cuts = [i + 1 for i, ch in enumerate(t) if ch in marks and 6 <= i + 1 <= len(t) - 6]
        if cuts:
            c = min(cuts, key=lambda i: abs(i - mid))
            a, b = t[:c].strip(), t[c:].strip()
            if a and b:
                return a, b
    return t[:mid].strip(), t[mid:].strip()


def _cbx_wait_mem(need_mb, status):
    """179: the computer itself is short of free memory (other programs hold it): wait, saying so, until `need_mb` is
    free, instead of starting a model that would freeze it. False after _CBX_WAIT_MOST seconds."""
    t0, said = time.time(), False
    while True:
        _check_cancel()
        av = _avail_mb()
        if av is None or av >= need_mb:
            return True
        if time.time() - t0 >= _CBX_WAIT_MOST:
            return False
        if not said:
            _diag("cbx_wait_mem", avail=av, need=need_mb)
            status(f"حافظهٔ آزاد این دستگاه کم است ({round(av / 1024, 1)} گیگابایت)؛ منتظرم برنامه‌های دیگر حافظه را "
                   "پس بدهند — اگر می‌توانید چندتایی را ببندید…")
            said = True
        time.sleep(0.5)


def _cbx_short_error():
    av = _avail_mb() or 0
    return RuntimeError(f"حافظهٔ آزاد این دستگاه برای چترباکس کافی نیست ({round(av / 1024, 1)} گیگابایت آزاد است). "
                        "چند برنامهٔ دیگر را ببندید و دوباره بسازید.")


def chatterbox_via_worker(req, status):
    """Returns (pcm int16 ndarray, sample_rate, [pcm per clause]) from the isolated worker. 179: the text goes in pieces
    (the sentences Chatterbox makes one at a time anyway); a worker past its share of this computer's memory hands back
    what it made and a fresh one carries on from the next piece; a worker stopped in the middle of a piece (memory) is
    replaced and that piece made again — in two halves if it happens twice. The job never ends because memory was
    flushed; it waits (saying so) while other programs hold the memory, and says plainly when a piece cannot fit."""
    clauses = list(req.get("clauses") or [req["text"]])
    work = [[k, p] for k, c in enumerate(clauses) for p in _cbx_pieces(c)]   # [clause, text]: a cut piece keeps its clause
    tries = [0] * len(work)
    got, sr, kills, short, fresh = {}, 24000, 0, False, False
    params = {k: req[k] for k in ("exaggeration", "cfg_weight", "temperature", "speed", "voice_path") if k in req}
    try:
        return _cbx_job(clauses, work, tries, got, sr, kills, short, fresh, params, status)
    finally:
        _cbx_job_done()                                             # 182: the worker may let go of its memory afterwards


def _cbx_job(clauses, work, tries, got, sr, kills, short, fresh, params, status):
    with _cbx_lock:
        pos = 0
        while pos < len(work):
            _check_cancel()
            lim = _cbx_limits()
            avail = _avail_mb()
            alive = _cbx_proc is not None and _cbx_proc.poll() is None
            grown = _cbx_last_rss > lim["base"] * 1.25
            # admission: a heavy worker (or one that has grown while the computer runs short) is replaced before it
            # takes the next piece — a fresh worker returns every leaked byte first
            if alive and _cbx_last_rss and (_cbx_last_rss > lim["soft"] or (grown and (
                    (avail is not None and avail < lim["low"]) or _swap_hot(0.12, avail)))):
                _diag("admission_recycle", rss=_cbx_last_rss, avail=avail, soft=lim["soft"], low=lim["low"])
                status("پیش از ساخت این بخش، حافظهٔ موتور را خالی می‌کنم…")
                _cbx_retire_proc()
                alive, fresh = False, True
            if not alive:
                # a new worker needs room for the model: while this computer is short of free memory, wait (saying so)
                if not _cbx_wait_mem(lim["floor"] + (lim["base"] if short else 0), status):
                    raise _cbx_short_error()
                short = False
            p = _cbx_ensure()
            line = json.dumps(dict(params, items=[[i, work[i][1]] for i in range(pos, len(work))], of=len(work),
                                   limits=lim, flush=fresh, verified=_cbx_verified), ensure_ascii=True) + "\n"   # Persian text + Persian paths
            try:
                p.stdin.write(line); p.stdin.flush()
            except Exception:
                _cbx_retire_proc(wait=2)
                p = _cbx_ensure()
                p.stdin.write(line); p.stdin.flush()
            # the live guard: while the worker works, the engine watches it twice a second and stops it at once past
            # the hard share (or when the computer's free memory falls under the floor)
            guard = {"on": True, "why": None, "mb": 0, "small": False}

            def _watch(proc=p, lim=lim):
                while guard["on"] and proc.poll() is None:
                    mb, av = _footprint_mb(proc.pid), _avail_mb()
                    base = _cbx_base_mb or lim["base"]
                    if mb > lim["hard"] or (av is not None and av < lim["floor"] and mb > base * 0.5):
                        guard.update(why="ceiling" if mb > lim["hard"] else "low_avail", mb=mb, small=mb < base * 1.25)
                        _diag("mem_guard", role="cbx", action="kill", mb=mb, avail=av, hard=lim["hard"],
                              floor=lim["floor"], why=guard["why"])
                        try:
                            proc.kill()
                        except Exception:
                            pass
                        return
                    time.sleep(0.5)
            threading.Thread(target=_watch, daemon=True).start()
            try:
                end, parts, info = _cbx_read(p, status)
            finally:
                guard["on"] = False
            for i, (pcm, psr) in parts.items():
                got[i], sr = pcm, psr
            while pos < len(work) and pos in got:
                pos += 1
            if end == "done":
                continue
            if end == "retire":
                _diag("cbx_flush", next=pos, of=len(work), rss=info.get("rss_mb"), avail=info.get("avail_mb"))
                _cbx_retire_proc(wait=8.0 if pos < len(work) else 0)
                fresh = True
                if pos < len(work):
                    status("حافظهٔ چترباکس خالی شد؛ کار از همین‌جا ادامه دارد…")
                continue
            # the worker stopped in the middle of a piece: our guard, out of GPU memory, a cancel or a crash
            _cbx_retire_proc(wait=3.0)
            fresh = True
            crash = end == "stopped" and not guard["why"]
            if crash:
                _check_cancel()   # cancel() ends the worker too
            if pos >= len(work):
                break
            tries[pos] += 1
            if crash:
                if tries[pos] >= 2:
                    time.sleep(0.2)
                    tail = "\n".join(list(_cbx_stderr or [])[-8:])
                    raise RuntimeError("موتور چترباکس یکهو بسته شد" +
                                       (":\n" + tail if tail else " — یک بار دیگر امتحان کنید."))
                _diag("cbx_crash_retry", piece=pos)
                continue
            kills += 1
            if guard["why"] == "low_avail" and guard["small"]:
                # the computer itself ran short (other programs hold the memory, not our worker): room first, then again
                short = True
                if tries[pos] >= 3:
                    raise _cbx_short_error()
                status("حافظهٔ آزاد این دستگاه تمام شد؛ چترباکس را نگه داشتم تا دستگاه قفل نکند و همین تکه را دوباره می‌سازم…")
                continue
            gb = round((guard["mb"] or info.get("rss_mb") or 0) / 1024, 1)
            if kills > _CBX_MAX_KILLS or (tries[pos] >= 2 and not _cbx_halve(work[pos][1])):
                raise RuntimeError(f"این تکه حتی در دو نیمه هم در حافظهٔ این دستگاه جا نشد (چترباکس به {gb} گیگابایت رسید). "
                                   "برنامه‌های دیگر را ببندید یا این خط را کوتاه‌تر کنید و دوباره بسازید.")
            oom = end == "oom"
            if tries[pos] >= 2:
                a, b = _cbx_halve(work[pos][1])
                work[pos:pos + 1] = [[work[pos][0], a], [work[pos][0], b]]
                tries[pos:pos + 1] = [0, 0]
                status("حافظهٔ پردازندهٔ گرافیکی برای چترباکس کم آمد؛ حافظه را خالی می‌کنم و این تکه را در دو نیمه می‌سازم…" if oom else
                       f"چترباکس به {gb} گیگابایت حافظه رسید؛ حافظه را خالی می‌کنم و این تکه را در دو نیمه می‌سازم…")
            else:
                status("حافظهٔ پردازندهٔ گرافیکی برای چترباکس کم آمد؛ حافظه را خالی می‌کنم و همین تکه را دوباره می‌سازم…" if oom else
                       f"چترباکس به {gb} گیگابایت حافظه رسید؛ حافظه را خالی می‌کنم و همین تکه را دوباره می‌سازم…")
    per = []
    for c in range(len(clauses)):
        seg = [got[i] for i in range(len(work)) if work[i][0] == c and i in got]
        per.append(np.concatenate(seg) if seg else np.zeros(int(sr * 0.15), dtype=np.int16))
    pcm = np.concatenate(per) if per else np.zeros(1, dtype=np.int16)
    return pcm, sr, per


# 182 · CHATTERBOX LETS GO OF ITS MEMORY WHEN IT IS NOT WORKING (the founder's item 37, approved): after a job, a worker
#       holding more than a quarter of this computer's memory unloads (8 and 16 GB computers: always — the model alone
#       is about 6 GB; 48 GB: it stays, at about 6.5 GB); on every computer it unloads after 5 minutes without a
#       Chatterbox job. «After a job» = a few seconds after the last request of a run (the lines of one Generate go one
#       request after another — unloading between them would load the model again for every run). Never in the middle
#       of a job (it waits for the job's lock).
_CBX_IDLE_S, _CBX_AFTER_S, _CBX_KEEP_SHARE = 300.0, 15.0, 0.25
_cbx_last_job = 0.0
_cbx_idle_thread = None


def _cbx_release_due(mb, total, idle):
    """Why the worker should unload now (None: keep it): 'idle' after 5 minutes without a job; 'share' when, a job just
    over, it holds more than a quarter of this computer's memory."""
    if idle >= _CBX_IDLE_S:
        return "idle"
    if idle >= _CBX_AFTER_S and mb > _CBX_KEEP_SHARE * total:
        return "share"
    return None


def _cbx_job_done():
    global _cbx_last_job, _cbx_idle_thread
    _cbx_last_job = time.time()
    if _cbx_idle_thread is not None and _cbx_idle_thread.is_alive():
        return

    def run():
        while True:
            time.sleep(5.0)
            try:
                p = _cbx_proc
                if p is None or p.poll() is not None or not _cbx_last_job:
                    continue
                total = _total_mb() or 16000
                mb = _footprint_mb(p.pid)
                why = _cbx_release_due(mb, total, time.time() - _cbx_last_job)
                if not why or not _cbx_lock.acquire(blocking=False):   # a job is running: never in the middle of one
                    continue
                try:
                    if _cbx_proc is p and p.poll() is None and _cbx_release_due(mb, total, time.time() - _cbx_last_job):
                        _diag("cbx_release", why=why, mb=mb, total=total, idle=round(time.time() - _cbx_last_job))
                        _cbx_retire_proc(wait=8.0)
                finally:
                    _cbx_lock.release()
            except Exception:
                pass
    _cbx_idle_thread = threading.Thread(target=run, daemon=True)
    _cbx_idle_thread.start()


def _cbx_read(p, status):
    """Reads one request's answers: status lines and finished pieces, until the worker is done, retires, runs out of
    GPU memory or stops. Returns (end, {piece: (pcm, sr)}, its last message); end: done | retire | oom | stopped."""
    global _cbx_last_rss, _cbx_base_mb, _cbx_verified
    parts = {}
    for out in p.stdout:
        out = out.strip()
        try:
            msg = json.loads(out)
        except Exception:
            continue  # stray library print — not ours
        t = msg.get("type")
        if t == "status":
            status(msg.get("msg", ""), pct=msg.get("pct"))
        elif t == "base":
            b = int(msg.get("rss_mb") or 0)
            if b > 0:
                _cbx_base_mb, _cbx_verified = b, True
                _diag("cbx_base", mb=b, limits=_cbx_limits())
        elif t == "part":
            _cbx_last_rss = int(msg.get("rss_mb") or 0)
            try:
                with wave.open(msg["path"], "rb") as wf:
                    sr = wf.getframerate()
                    pcm = _wav_pcm(wf)
                parts[int(msg["key"])] = (pcm, sr)
            finally:
                try:
                    os.unlink(msg["path"])
                except OSError:
                    pass
        elif t in ("done", "retire", "oom"):
            _cbx_last_rss = int(msg.get("rss_mb") or 0)
            if t == "oom":
                _diag("cbx_oom", rss=_cbx_last_rss, error=str(msg.get("error", ""))[:200])
            return t, parts, msg
        elif t == "error":
            raise RuntimeError(msg.get("error", "خطای نامشخص"))
    return "stopped", parts, {}


# 177 · THE WHOLE APP'S MEMORY, every 30 s: the engine, the Chatterbox worker and the window's web process (Activity
#       Monitor's numbers). A change or every 10 minutes goes to the log, so a runaway always leaves a trace; past a
#       quarter of this computer's memory (179: a share, not a fixed 10 GB) in the window or the engine the page is
#       told once every 10 minutes (with the numbers).
def mem_watch(get_web_pid=None, warn=None, every=30.0):
    def run():
        last_log, last_warn, prev = 0.0, 0.0, None
        while True:
            try:
                main = _footprint_mb()
                wk = _footprint_mb(_cbx_proc.pid) if (_cbx_proc is not None and _cbx_proc.poll() is None) else 0
                web = 0
                try:
                    wp = get_web_pid() if get_web_pid else None
                    if wp:
                        web = _footprint_mb(wp)
                except Exception:
                    pass
                av = _avail_mb()
                now, cur = time.time(), (main, wk, web)
                if prev is None or now - last_log > 600 or any(abs(c - q) > max(300, 0.15 * q) for c, q in zip(cur, prev)):
                    _diag("mem", main=main, worker=wk, web=web, avail=av)
                    last_log, prev = now, cur
                big = 0.25 * (_total_mb() or 16000)
                if warn and (web > big or main > big) and now - last_warn > 600:
                    last_warn = now
                    warn(main, web)
            except Exception:
                pass
            time.sleep(every)
    threading.Thread(target=run, daemon=True).start()


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
    """179: shares of this computer's memory, not fixed numbers. Chatterbox cannot run under 7 GB in all (the model
    itself needs 5–6 GB). Low free memory is no reason to refuse any more: the engine waits for room before it starts
    a worker and flushes the worker's memory as it goes — here it only warns when the room is short of what the
    model needs plus the free share the engine keeps."""
    total_mb = _total_mb()
    if total_mb is not None and total_mb < 7000:
        raise RuntimeError(
            f"چترباکس روی این دستگاه اجرا نمی‌شود؛ دست‌کم 8 گیگابایت رم می‌خواهد "
            f"(این دستگاه {total_mb // 1024} گیگابایت دارد). به‌جایش از صداهای سبک — مانا، ژیرو یا امیر — استفاده کنید.")
    avail_mb = _avail_mb()
    if avail_mb is None:
        return
    lim = _cbx_limits(total_mb)
    ours = _footprint_mb(_cbx_proc.pid) if (_cbx_proc is not None and _cbx_proc.poll() is None) else 0
    room = avail_mb + ours          # our own worker's memory comes back whenever the engine flushes it
    if room < lim["low"] + lim["base"]:
        status(f"هشدار: حافظهٔ آزاد کم است ({round(room / 1024, 1)} گیگابایت)؛ ممکن است کار کند پیش برود. "
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


def file_gulp(path, name=None):
    """A part holding an audio file from disk (108): decoded to mono, kept at
    its own rate (the splice resamples). 182: name = the file's own name (a file
    dropped on the window reaches the asset store under an id)."""
    p = Path(path)
    nm = name or p.name
    if not p.is_file():
        raise RuntimeError("فایل پیدا نشد.")
    audio_limits_check(p, nm)                                       # 182: 250 MB · 60 minutes
    pcm, sr = _decode_audio(p.read_bytes())
    if len(pcm) < sr // 10:
        raise RuntimeError("این فایل صوتی تقریباً خالی است.")
    audio_seconds_check(len(pcm) / sr, nm)
    gid = next(_gulp_ids)
    _GULP_PCM[gid] = {"sr": sr, "items": [{"kind": "t", "text": "", "span": (0, 0), "pcm": pcm}],
                      "text": "", "engine": "file", "payload": {"file": nm}, "born": time.time()}
    return gid, pcm_to_mp3(pcm, sr), nm, round(len(pcm) / sr, 1)


# 182 · import limits (every way in): audio ≤ 250 MB and ≤ 60 minutes
AUDIO_MAX_MB, AUDIO_MAX_S = 250, 3600


def audio_limits_check(p, name=None):
    mb = Path(p).stat().st_size / (1 << 20)
    if mb > AUDIO_MAX_MB:
        raise RuntimeError(f"«{name or Path(p).name}» {round(mb)} مگابایت است؛ یک فایلِ صوتی حداکثر 250 مگابایت می‌تواند باشد.")


def audio_seconds_check(seconds, name):
    if seconds > AUDIO_MAX_S + 0.5:
        raise RuntimeError(f"«{name}» {round(seconds / 60)} دقیقه است؛ یک فایلِ صوتی حداکثر 60 دقیقه می‌تواند باشد.")


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
        # 139: remember where every line's audio is, so later edits are
        # bookkeeping rather than a fresh alignment of the whole recording
        try:
            build_line_index(entry, text, pcm, sr, payload, status,
                             {"fa": "fa-IR", "en": "en-US"}.get(payload.get("g_lang")))
            ensure_line_index(entry, status, payload)          # 142: checked against the text
        except Exception as e:
            _diag("line_index", mode="failed", msg=str(e)[:70])
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
    status("فقط همین یک بار: مدل هم‌ترازی واژه‌ها (حدود 1.2 گیگابایت) دانلود می‌شود…")
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


def _fork_entry(src):
    """A deep-enough copy of a part: its audio, items, line map and voices are
    independent of the original. (140)"""
    import copy
    e = {k: v for k, v in src.items() if k not in ("items", "lines", "voices", "payload")}
    e["items"] = [{**it, "pcm": (it["pcm"].copy() if it.get("pcm") is not None else None)} for it in src.get("items", [])]
    e["lines"] = copy.deepcopy(src.get("lines") or [])
    e["voices"] = copy.deepcopy(src.get("voices") or {})
    e["payload"] = dict(src.get("payload") or {})
    e["born"] = time.time()
    return e


def patch_gulp(gid, new_text, sel_start, sel_end, payload, status):
    _require_license()
    _G_INCOMPLETE.clear()
    """Regenerate only the clauses that the edit/selection touched; every
    other clause's audio is reused bit-identical."""
    _job_start()
    src = _GULP_PCM.get(int(gid))
    if src is None:
        raise RuntimeError("این بخش دیگر در حافظه نیست؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
    _ensure_valid(src, "پایهٔ ویرایش", status)
    _pe, _se = (payload or {}).get("engine"), src.get("engine")
    if _pe and _se and _pe != _se:                # 169: the old code fell back to the part's engine (Chatterbox → Google)
        _diag("patch", mode="engine_switch", old=_se, new=_pe)
        mp3, gid2 = generate_gulp({**payload, "text": new_text.strip()}, status)
        return mp3, -1, "full", gid2
    entry = _fork_entry(src)                      # 140: edit a COPY; the original stays for Undo
    new_gid = next(_gulp_ids)
    new_text = new_text.strip()
    # 143: no selection, or a selection that covers the whole text, means the
    # user wants the PART REMADE — one voice, fresh audio, fresh map, fresh
    # transcript. It must owe nothing to earlier surgeries (field: "scars" —
    # extra pauses, mismatched tone, a line read twice, «پیش‌گفتار» dropped).
    _sel_all = (sel_start is not None and sel_end is not None
                and sel_start <= (len(new_text) - len(new_text.lstrip())) and sel_end >= len(new_text.rstrip()))
    if (sel_start is None or sel_end is None or sel_end <= sel_start or _sel_all) \
            and src.get("engine") in ("google", "fish") and (payload or {}).get("engine") in ("google", "fish"):
        sel_start = sel_end = None
        entry["lines"] = []; entry.pop("map_untrusted", None); entry["voices"] = {}
        _diag("patch", mode="fresh_full", reason="no_selection" if not _sel_all else "select_all")
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
        _has_sel = sel_start is not None and sel_end is not None and sel_end > sel_start
        if _has_sel and entry.get("engine") == eng and len(entry["items"]) == 1 and entry["items"][0].get("pcm") is not None \
                and line_index(entry) and ensure_line_index(entry, status, cfg):
            n = patch_by_lines(entry, new_text, sel_start, sel_end, cfg, status,
                               lambda t, c, st: cloud_pcm(t, c, st))
            if n is not None and n >= 0:
                entry["payload"] = {**(entry.get("payload") or {}),
                                    **{k: cfg[k] for k in cfg if (k.startswith("g_") or k.startswith("f_"))
                                       and k not in ("g_voice", "g_preset", "g_age", "g_state",
                                                     "f_voice", "f_preset", "f_age", "f_state")}}
                _GULP_PCM[new_gid] = entry
                return pcm_to_mp3(_assemble(entry), entry["sr"]), n, "lines", new_gid
        if _has_sel and entry.get("engine") == eng and len(entry["items"]) == 1 and entry["items"][0].get("pcm") is not None:
            # 130: a voice / voice-setting change is a legitimate surgical edit —
            # only the selected clauses are re-voiced, the rest of the audio is
            # kept bit-identical. The user is told, because the part will then
            # hold two voices on purpose.
            old_p = entry.get("payload") or {}
            changed = [k for k in ("g_voice", "g_preset", "g_age", "g_state", "f_voice", "f_preset", "f_age", "f_state", "f_speed", "f_temp")
                       if k in cfg and old_p.get(k) is not None and cfg.get(k) != old_p.get(k)]
            if changed:
                _diag("g_clause_patch", voice_change=",".join(changed)[:60])
                status("صدا/تنظیمات این بخش عوض شده؛ فقط جمله‌های انتخاب‌شده با صدای تازه ساخته می‌شوند.")
            done = _google_clause_patch(entry, new_text, sel_start, sel_end, cfg, status)
            if done:
                # 136: keep the part's BASE voice. A surgical take must not
                # become the part's identity, or the next repair inherits it.
                base = dict(entry.get("payload") or {})
                fresh = {k: cfg[k] for k in cfg if (k.startswith("g_") or k.startswith("f_"))
                         and k not in ("g_voice", "g_preset", "g_age", "g_state",
                                       "f_voice", "f_preset", "f_age", "f_state")}
                base.update(fresh)
                entry["payload"] = base
                _ensure_valid(entry, "ویرایش", status)
                # 142: the anchor path changed the audio — the map must follow it
                try:
                    build_line_index(entry, entry["text"], entry["items"][0]["pcm"], entry["sr"], cfg, status,
                                     {"fa": "fa-IR", "en": "en-US"}.get(cfg.get("g_lang")))
                    ensure_line_index(entry, status, cfg)
                except Exception:
                    entry["lines"] = []; entry["map_untrusted"] = True
                _GULP_PCM[new_gid] = entry
                return pcm_to_mp3(_assemble(entry), entry["sr"]), done, "clauses", new_gid
        cfg = {**cfg, "g_lead_in": entry.get("lead_in", "")}   # pinned at generation time
        status("جراحیِ جمله ممکن نشد؛ کل این بخش دوباره ساخته می‌شود.")
        pcm, sr = cloud_pcm(new_text, cfg, status)
        entry["voices"] = {}                       # 135: one voice now — forget every remembered line
        _remember_line_voices(entry, new_text, cfg)
        entry["items"] = [{"kind": "t", "text": new_text, "span": (0, len(new_text)), "pcm": pcm}]
        entry["sr"] = sr
        try:
            build_line_index(entry, new_text, pcm, sr, cfg, status,
                             {"fa": "fa-IR", "en": "en-US"}.get(cfg.get("g_lang")))
            ensure_line_index(entry, status, cfg)
        except Exception:
            entry["lines"] = []
        items = _clause_split(new_text, eng)
        items[0]["pcm"] = pcm
        entry.update({"sr": sr, "items": items, "text": new_text, "engine": eng,
                      "payload": {k: cfg[k] for k in cfg if k.startswith("g_") or k.startswith("f_")}})
        _ensure_valid(entry, "ویرایش", status)
        _GULP_PCM[new_gid] = entry
        return pcm_to_mp3(_assemble(entry), sr), 1, "full", new_gid
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
    _GULP_PCM[new_gid] = entry
    return pcm_to_mp3(_assemble(entry), entry["sr"]), changed, mode, new_gid


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
    """Remove one of the user's own samples (built-ins cannot be removed). 182: it is an undo step — the file waits in a
    trash folder (AvaModels/.trash) until the step can no longer be undone; the next launch empties it."""
    if not voice_id.startswith("u:"):
        raise RuntimeError("نمونه‌های داخل برنامه حذف نمی‌شوند؛ فقط نمونه‌های خودتان.")
    p = _USER_VOICES / os.path.basename(voice_id[2:])
    token = trash_put(p) if p.exists() else None
    return cbx_voices(), token


def cbx_voice_restore(token):
    """Undo of a deleted sample: the file comes back from the trash."""
    trash_back(token)
    return cbx_voices()


# 182 · THE TRASH — a file deleted in the app waits here until its step can no longer be undone (each in its own folder,
#       remembering where it came from); the next launch empties it
_TRASH_DIR = MODELS_DIR / ".trash"


def trash_put(path):
    import uuid as _uu, shutil
    path = Path(path)
    token = _uu.uuid4().hex[:16]
    d = _TRASH_DIR / token
    d.mkdir(parents=True, exist_ok=True)
    (d / "origin.txt").write_text(str(path), encoding="utf-8")
    shutil.move(str(path), str(d / path.name))
    return token


def trash_back(token):
    import shutil
    d = _TRASH_DIR / os.path.basename(str(token or ""))
    origin = d / "origin.txt"
    if not origin.exists():
        raise RuntimeError("این فایل دیگر برنمی‌گردد.")
    dst = Path(origin.read_text(encoding="utf-8"))
    src = d / dst.name
    if src.exists():
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(src), str(dst))
    shutil.rmtree(str(d), ignore_errors=True)
    return str(dst)


def trash_purge():
    import shutil
    shutil.rmtree(str(_TRASH_DIR), ignore_errors=True)


def cbx_voice_add(src_path):
    """Copy a user's clip into the library. Returns the new voice entry."""
    src = Path(src_path)
    if not src.is_file() or src.suffix.lower() not in _VOICE_EXT:
        raise RuntimeError("این فایل صوتی به درد نمی‌خورد؛ یک WAV یا MP3 هشت تا پانزده‌ثانیه‌ای با صدای یک نفر انتخاب کنید.")
    audio_limits_check(src)                                         # 182: the import limits on every way in
    try:
        pcm, sr = _decode_audio(src.read_bytes())
    except AudioFormatError:
        pcm, sr = None, 1
    if pcm is not None:
        audio_seconds_check(len(pcm) / sr, src.name)
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
GOOGLE_MODELS = {"gemini-3.8-flash-tts": {"tags": True, "g38": True},        # 151
                 "gemini-3.8-flash-lite-tts": {"tags": True, "g38": True},   # 151
                 "gemini-3.1-flash-tts-preview": {"tags": True},
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
    try:
        if keys and not data.get("repaired_147"):
            revived = sum(1 for k in keys if k.get("bad"))
            for k in keys:
                k["bad"] = False
            _GKEYS_FILE.write_text(json.dumps({"keys": keys, "repaired_147": True}), encoding="utf-8")
            if revived:
                _diag("google_keys_repaired", revived=revived)
    except Exception:
        pass
    return keys


def _google_keys_write(keys):
    try:
        MODELS_DIR.mkdir(exist_ok=True)
        _GKEYS_FILE.write_text(json.dumps({"keys": keys, "repaired_147": True}), encoding="utf-8")
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


def google_rotate(call, status, what="گوگل", _rerouted=False, only_key_tag=None):
    """Run call(key) over the key list: quota → next key (this one sleeps till
    the Pacific midnight), invalid → next key (flagged), transient 5xx → retry
    the same key up to 3 times. Raises a Farsi error naming the remedy.
    152: only_key_tag restricts the rotation to one key (a designed voice lives
    in the project of the key that created it)."""
    import time
    keys = _google_usable_keys()
    if only_key_tag:
        keys = [k for k in keys if _key_tag(k) == only_key_tag]
        if not keys:
            raise RuntimeError("این صدای طراحی‌شده فقط با کلیدی کار می‌کند که آن را ساخته، و سهمیهٔ امروزِ آن کلید تمام شده یا آن کلید حذف شده است. فردا دوباره امتحان کنید یا صدای دیگری انتخاب کنید.")
    if not keys:
        if google_keys():
            raise RuntimeError("سهمیهٔ امروزِ همهٔ کلیدهای گوگل تمام شده یا کلیدها معتبر نیستند؛ یک کلید تازه اضافه کنید یا فردا سر بزنید.")
        raise RuntimeError("هنوز کلید گوگل ندارید؛ از دکمهٔ «کلیدهای گوگل» یک کلید رایگان وارد کنید.")
    # 148: make sure there is a working route through the user's VPN first
    try:
        ensure_route(status)
    except Exception as e:
        _diag("net_route_err", msg=str(e)[:80])
    last = None
    net_keys = 0                                   # 147: keys that failed on the NETWORK in a row
    for key in keys:
        net_fail = False
        for attempt in range(3):
            _check_cancel()
            try:
                out = call(key)
                if any(k.get("key") == key and k.get("bad") for k in google_keys()):
                    _google_mark(key, "ok")                 # 147: a key that works is not bad
                return out
            except Cancelled:
                raise
            except _GoogleHTTP as e:
                last = e
                kind = _google_fault(e.code, e.msg)
                if kind == "tier":       # 155: Google refuses on account level — every free key gets the same answer
                    _diag("google_tier_stop", code=e.code)
                    raise RuntimeError(f"{what}: " + _TIER_MSG)
                if kind in ("network", "region"):
                    # every key would get the same page — stop, condemn nothing
                    _diag("google_blocked", kind=kind, code=e.code, msg=_google_clean_msg(e.msg))
                    if not _rerouted:
                        # 148: the route died mid-session — look for another one, retry once
                        _bench(_NET["route"] or "direct")
                        ok, label, report = ensure_route(status, force=True)
                        if ok:
                            status(f"{what}: مسیرِ شبکه عوض شد («{label}»)؛ دوباره امتحان می‌کنم…")
                            return google_rotate(call, status, what, _rerouted=True, only_key_tag=only_key_tag)
                        raise RuntimeError(f"{what}: " + net_status_text(ok, label, report) + " هیچ کلیدی نامعتبر نشد.")
                    raise RuntimeError(f"{what}: " + (_NET_BLOCK_MSG if kind == "network" else _REGION_MSG))
                if e.code == 429:
                    # 171: the log showed 20 keys condemned for the day while 8 samples were made — every short
                    # per-minute 429 was taken for a daily one. Daily only when Google's whole answer says so.
                    full = (e.msg + " " + getattr(e, "raw", "")).lower()
                    if any(w in full for w in ("perday", "per day", "per_day", "daily", "requestsperday")):
                        _diag("google_429", kind="daily"); _google_mark(key, "exhausted")
                        status(f"{what}: سهمیهٔ امروزِ این کلید ته کشید؛ می‌رویم سراغ کلید بعدی…"); break
                    m = re.search(r'"retrydelay":\s*"(\d+(?:\.\d+)?)s"|retry in (\d+(?:\.\d+)?)\s*s', full)
                    wait = min(65.0, float(next(g for g in m.groups() if g)) + 1.0) if m else 20.0
                    _diag("google_429", kind="minute", wait=round(wait, 1), attempt=attempt)
                    if attempt < 2:
                        status(f"{what}: به سقفِ درخواست در دقیقه خوردیم — {int(wait)} ثانیه صبر می‌کنیم (کلید سالم است)…")
                        for _ in range(int(wait * 4)):
                            _check_cancel(); time.sleep(0.25)
                        continue
                    break                                   # the next key — this one is NOT condemned
                if kind == "key":
                    _google_mark(key, "bad"); status(f"{what}: این کلید را قبول نکرد؛ می‌رویم سراغ کلید بعدی…")
                    _diag("google_key_bad", code=e.code, msg=_google_clean_msg(e.msg))
                    break
                if e.code in (401, 403):
                    # 147: a refusal Google did not attribute to the key — try the next
                    # key, but leave this one alone
                    _diag("google_403_unattributed", msg=_google_clean_msg(e.msg))
                    status(f"{what}: گوگل این درخواست را رد کرد ({e.code})؛ کلید بعدی را امتحان می‌کنم…")
                    break
                if e.code >= 500:
                    _diag("google_5xx", code=e.code, msg=e.msg[:120])
                    status(f"{what}: سرور گوگل موقتاً خطا داد ({e.code}) — تلاش {attempt + 2} از 3…")
                    for _ in range(4 * (2 + attempt * 2)):
                        _check_cancel(); time.sleep(0.25)
                    continue
                raise RuntimeError(f"{what}: {_google_clean_msg(e.msg)}")
            except requests.RequestException as e:
                last = e; net_fail = True
                why = type(e).__name__
                _diag("google_net", err=why + ": " + str(e)[:90])
                status(f"{what}: اتصال به گوگل برقرار نشد — تلاش {attempt + 2} از 3…")
                for _ in range(4 * (2 + attempt * 2)):
                    _check_cancel(); time.sleep(0.25)
        # 147: two keys in a row that never reached Google means the network, not the keys
        net_keys = net_keys + 1 if net_fail and not isinstance(last, _GoogleHTTP) else 0
        if net_keys >= min(2, len(keys)):          # 149: with ONE key, one unreachable key is enough
            _diag("google_blocked", kind="network", reason="two_keys_unreachable")
            if not _rerouted:
                _bench(_NET["route"] or "direct")
                ok, label, report = ensure_route(status, force=True)
                if ok:
                    status(f"{what}: مسیرِ شبکه عوض شد («{label}»)؛ دوباره امتحان می‌کنم…")
                    return google_rotate(call, status, what, _rerouted=True, only_key_tag=only_key_tag)
                raise RuntimeError(f"{what}: " + net_status_text(ok, label, report) + " هیچ کلیدی نامعتبر نشد.")
            raise RuntimeError(f"{what}: " + _NET_BLOCK_MSG)
    raise RuntimeError(f"{what}: با هیچ‌کدام از کلیدها جواب نگرفتیم — " +
                       _google_clean_msg(getattr(last, "msg", None) or str(last) or "؟"))


# ===========================================================================
# 147 · A KEY IS CONDEMNED ONLY WHEN GOOGLE SAYS THE KEY IS THE PROBLEM
# FIELD (a user in 146, same keys that worked all day in 126): the network to
# Google broke — dropped connections, then Google's HTML «Error 403
# (Forbidden)» front-door page, which is what a blocked region or a flagged
# VPN/proxy exit receives. The rotation treated EVERY 403 as "bad key", so the
# first key was condemned, the next got the identical page and was condemned,
# and all 18 were marked invalid — on disk. Re-pasting revived them and the
# next request killed them all again. The rule was the same in 126; it only
# surfaced when that user's network changed.
# ===========================================================================
def _google_fault(code, msg):
    """What a Google error is really about: "key", "network", "region" or "other"."""
    m = (msg or "").lower()
    head = m.lstrip()[:300]
    if head.startswith("<!doctype") or head.startswith("<html") or "<html" in head:
        return "network"                                  # a front-door web page, not an API answer
    if "location is not supported" in m or "user location" in m:
        return "region"
    key_words = ("api key not valid", "api_key_invalid", "api key expired", "api_key_expired",
                 "reported as leaked", "api key was reported", "api_key_service_blocked",
                 "service_disabled", "has not been used in project", "api has not been used",
                 "requests from this api key are blocked", "api key not found",
                 # 153: free-tier projects Google has reviewed and restricted ("Your project has been
                 # denied access" / "This project's API access is restricted") — a dead key: rotate past it
                 # instead of retrying it on every request
                 "project has been denied access", "has been denied access", "api access is restricted")
    if any(k in m for k in key_words):
        return "key"
    if code == 401 or (code == 400 and "api key" in m):
        return "key"
    return "other"                                         # an unexplained 403 does NOT condemn a key


def _google_clean_msg(msg):
    """Never show raw HTML to a user: keep a page's <title>, drop the markup."""
    m = msg or ""
    if "<" in m[:300] and ">" in m[:300]:
        import re as _re
        t = _re.search(r"<title>(.*?)</title>", m, _re.I | _re.S)
        return (t.group(1).strip() if t else _re.sub(r"<[^>]+>", " ", m)).strip()[:120]
    return m[:200]


_NET_BLOCK_MSG = ("گوگل از این شبکه درخواست نمی‌پذیرد (خطای 403 یا قطع اتصال). "
                  "این مشکل از کلیدها نیست و هیچ کلیدی نامعتبر نشد. معمولاً یکی از این سه است: "
                  "فیلترشکن قطع شده، سرورِ فیلترشکن از طرف گوگل مسدود است (سرور یا کشورِ دیگری انتخاب کنید)، "
                  "یا فیلترشکن فقط مرورگر را پوشش می‌دهد (آن را روی حالتِ TUN بگذارید).")
_REGION_MSG = ("گوگل می‌گوید این سرویس در موقعیتِ فعلیِ شبکه در دسترس نیست. "
               "این مشکل از کلیدها نیست و هیچ کلیدی نامعتبر نشد؛ با فیلترشکنی که مقصدش کشورِ دیگری است امتحان کنید.")


class _GoogleHTTP(Exception):
    def __init__(self, code, msg, raw=""):
        super().__init__(f"HTTP {code}: {msg}"); self.code = code; self.msg = msg; self.raw = raw or ""


def _google_post(url, body, key, timeout=120, revision=True):
    """POST in a helper thread so a cancel can abandon it mid-flight.
    169: revision=False sends the request exactly as Google documents it (no Api-Revision
    header) — gemini-3.5-transcribe answered every request with 'Thinking is not enabled
    for this model' under the revision header, so no word timings came back at all."""
    _check_cancel()
    box = {}

    def run():
        try:
            box["r"] = requests.post(url, json=body, timeout=timeout,
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json",
                                              **({"Api-Revision": "2026-05-20"} if revision else {})})
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
        raise _GoogleHTTP(r.status_code, msg or r.text[:200], r.text[:4000])
    return r.json()


_G_PAUSE_LONG = re.compile(r"\[\s*مکث بلند\s*\]")
_G_PAUSE = re.compile(r"\[\s*مکث\s*\]")
_G_TAG = re.compile(r"\[[A-Za-z][A-Za-z ,=.'-]{0,40}\]")


PAUSE_SECONDS = {"short pause": 0.6, "long pause": 1.5, "مکث": 0.5, "مکث بلند": 1.2}
_G_ANY_PAUSE = re.compile(r"\[\s*(short pause|long pause|مکث بلند|مکث)\s*\]")


def _is_g38(model_or_cfg):
    """Is this a Gemini 3.8 TTS request? The single switch for the 3.8 fork. (151)"""
    m = model_or_cfg.get("g_model") if isinstance(model_or_cfg, dict) else model_or_cfg
    return bool(GOOGLE_MODELS.get(m or "", {}).get("g38"))


_G_SPACES = re.compile(r"[\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]")


def google_text(text, model):
    """The text as Google should see it (105: pauses are the MODEL's again).
    The app's [مکث] markers become Google's pause tags on 3.1, punctuation on
    2.5 (which reads tags aloud). A pause tag at the very end of a part is
    dropped — nothing follows it inside the part, and a trailing tag gets
    spoken as words; the splice adds the breath between parts."""
    # 177 · every kind of space is one plain space for Google: a run of no-break spaces (left in the line where a
    #       reaction badge or a tag chip once sat) was read as a hesitation — the voice stopped under the reaction.
    #       The Persian half-space (ZWNJ, U+200C) is a letter joiner, not a space, and stays.
    t = _G_SPACES.sub(" ", text).strip()
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
    # 177 · a line with reactions laid over it: the voice must not wait for them — they are added afterwards
    steady = ("Pacing: keep one continuous, even flow through every sentence; never stop, wait or leave a gap in the "
              "middle of a sentence — pause only where the punctuation asks for it. " if cfg.get("g_steady") else "")
    head = ("Narrator: one consistent voice, same identity in every recording. "
            + (f"{persona} " if persona else "")
            + f"Reading format: {style} " + steady
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
                        box["msg"] = r.json().get("error", {}).get("message", "") or r.text[:200]; box["raw"] = r.text[:4000]
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
        raise _GoogleHTTP(box["code"], box.get("msg", ""), box.get("raw", ""))
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


class _GoogleReject(RuntimeError):
    pass


def _google_call(text, cfg, status):
    spoken = re.sub(r"\[[^\]]*\]", " ", text or "").strip()
    if not spoken:
        # 137: a clause that is only a tag, or an empty selection, produced a
        # request Google rejects with 400 «invalid argument» (twice in the field
        # log). There is nothing to say — fail cleanly instead of burning a key.
        raise RuntimeError("این تکه چیزی برای خواندن ندارد (فقط برچسب یا فاصله).")
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
    g38 = _is_g38(model)
    if g38:
        gt = g38_text(text)
        expect_sec = max(3.0, len(gt) / 11.0 + 1.5 * len(re.findall(r"<(?:short pause|long pause|sighs?|laugh\w*|gasp|cough|cry|sob)>", gt)))
    doors_31 = [("streamGenerateContent", f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent",
                 _google_legacy_body(text, cfg)),
                ("interactions", _GOOGLE_URL, _google_body(text, cfg))] if not g38 else None

    def call(key):
        rejects, timeouts = [], []
        if g38:
            voice = g38_resolve_voice(cfg, key, status)          # 151: per-key, clones recreated on demand
            doors = [("streamGenerateContent", f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent",
                      _g38_legacy_body(text, cfg, voice)),
                     ("interactions", _GOOGLE_URL, _g38_interactions_body(text, cfg, voice))]
        else:
            doors = doors_31
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
            # 146: say WHAT was refused, so the next report is diagnosable
            _diag("google_reject_detail", chars=len(text or ""), voice=str(cfg.get("g_voice"))[:24],
                  model=str(cfg.get("g_model"))[:32], preset=str(cfg.get("g_preset"))[:20],
                  age=str(cfg.get("g_age"))[:12], state=str(cfg.get("g_state"))[:16],
                  lead=len(cfg.get("g_lead_in") or ""), head=(text or "")[:40].replace("\n", "⏎"))
            raise _GoogleReject(rejects[-1].msg[:160])
        raise timeouts[-1]
    try:
        return google_rotate(call, status, "گوگل", only_key_tag=g38_design_key_tag(cfg) if g38 else None)
    except _GoogleReject as first:
        # 146: one more try with the request stripped to the essentials — plain
        # text, the voice, no persona/style/lead-in. FIELD: a freshly pasted line
        # was refused four times and accepted on the fifth; a refusal must not
        # look like a dead key, and it must name the line.
        if cfg.get("_stripped_retry"):
            raise RuntimeError("گوگل این خط را قبول نکرد: «" + (text or "")[:60].replace("\n", " ") + "» — " + str(first))
        status("گوگل این تکه را قبول نکرد؛ یک بار دیگر با درخواستِ ساده‌تر امتحان می‌کنم…")
        _diag("google_reject_retry", chars=len(text or ""))
        bare = {k: v for k, v in cfg.items() if k not in ("g_preset", "g_age", "g_state", "g_preset_custom",
                                                          "g_age_custom", "g_state_custom", "g_lead_in", "g_duo")}
        bare["g_lead_in"] = ""; bare["_stripped_retry"] = True
        clean = re.sub(r"[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]", "", text or "")
        return _google_call(clean, bare, status)


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


LEAD_IN_MIN_WORDS = 8          # 130: enough speech for the model to match a tone


def _continuity_tail(text):
    """The lead-in a NEXT part will hear: the end of this part, taken clause by
    clause from the back until it holds at least LEAD_IN_MIN_WORDS words.
    130: finer clause splitting (129) could leave a three-word fragment as the
    whole lead-in, and tone continuity between parts audibly suffered."""
    cl = _g_clauses(text)
    if not cl:
        return ""
    picked, n = [], 0
    for c, _ in reversed(cl):
        t = re.sub(r"\s+", " ", re.sub(r"\[[^\]]+\]", " ", c)).strip()
        if not t:
            continue
        picked.insert(0, t)
        n += len(t.split())
        if n >= LEAD_IN_MIN_WORDS:
            break
    tail = " ".join(picked)
    if _g_speech_len(tail) > 160:                            # a very long tail → keep its end
        tail = " ".join(tail.split()[-18:])
    return tail


def _g_lead_in(text, cfg):
    """The lead-in for a part: the previous part's last clause, unless the
    caller pinned one (regeneration) or continuity is off."""
    if cfg.get("g_continuity", True) is False or cfg.get("f_continuity", True) is False:
        return ""
    if cfg.get("_no_audit"):              # 136: surgery carries its own context
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


def _clause_coverage(text, words, strict=True):
    """[(matched, total)] per clause from ONE alignment of the whole text against
    the transcript — the shared basis of the completeness audit and take scoring
    (127). Returns None when the transcript is not credible (< 40 % coverage)."""
    import difflib
    cl = _g_clauses(text)
    ours, owner = [], []
    for k, (c, _) in enumerate(cl):
        ws = _text_words(c); ours += ws; owner += [k] * len(ws)
    words = _merge_split_words(ours, words or [])       # 145: same convention as the boundary finders
    tw = [_norm_word(w) for w, _, _ in (words or [])]
    if not ours or not tw:
        return None
    floor = 0.4 if strict else 0.65      # 136: a cross-engine transcript is a weaker witness
    if len(tw) < floor * len(ours):
        _diag("g_completeness", mode="abstain", transcript=len(tw), expected=len(ours), floor=floor)
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


def _g_completeness(text, words, strict=True):
    """The index of the first clause the recording clearly skipped, or None."""
    cov = _clause_coverage(text, words, strict)
    if cov is None:
        return None
    for k, (hit, tot) in enumerate(cov):
        if tot >= 3 and hit < 0.4 * tot:
            _diag("g_completeness", clause=k, matched=hit, of=tot)
            return k
    # 136: a take cut short at the very END loses only part of the last clause and
    # passed the per-clause test. The tail is checked on its own terms.
    if cov:
        hit, tot = cov[-1]
        if tot >= 4 and hit < 0.75 * tot:
            _diag("g_completeness", clause=len(cov) - 1, matched=hit, of=tot, mode="tail")
            return len(cov) - 1
        # 140: even a high ratio can hide a cut-off ending. The final words of
        # the text must be present in the final words of the transcript.
        last = [_norm_word(w) for w in _text_words(text)][-3:]
        tw = [_norm_word(w) for w, _, _ in words][-6:]
        import difflib as _dl
        def _near(w):                                        # 143: ASR spelling tolerance
            return any(_dl.SequenceMatcher(None, w, t).ratio() >= 0.7 for t in tw)
        if last and tw and not any(_near(w) for w in last[-2:]):
            _diag("g_completeness", clause=len(cov) - 1, mode="tail_words_missing", want=" ".join(last)[:30])
            return len(cov) - 1
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
    if _is_g38(cfg) and g38_needs_plan(text, cfg):
        # 152: a cast or per-line tones — each run of lines in its own voice and
        # style, two alternating catalog voices as one native dialogue request
        pcm, sr = g38_synthesize(text, cfg, status)
        if not cfg.get("_no_audit"):
            _G_LAST["tail"] = _continuity_tail(text)
        return pcm, sr
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
    if not cfg.get("_no_audit"):          # 136: a surgical piece is not a part
        _G_LAST["tail"] = _continuity_tail(text)
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
    strict = cfg.get("engine") != "fish"      # 136: Google transcribing Fish audio is a weak witness
    best = (_take_score(chunk, words), pcm, sr, words)
    last_miss = None
    for attempt in range(2):
        miss = _g_completeness(chunk, words, strict) if words else None
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
                if _g_completeness(chunk, w2, strict) is None:
                    _diag("take_repair", clause=miss, mode="spliced_ok")
                    return pcm2, sr2, w2, None
        # (1) otherwise a fresh take, and keep whichever is better
        if miss == last_miss and attempt > 0:
            break                                   # the same clause twice: re-rolling will not fix it
        last_miss = miss
        status(f"جملهٔ {faDigits(miss + 1)}اُم خوانده نشد — برداشت دوباره ({faDigits(attempt + 2)}/3)…")
        pcm2, sr2 = call(chunk, cfg, status)
        w2 = transcribe_words(pcm2, sr2, status, lang, chunk, cfg)
        sc2 = _take_score(chunk, w2)
        if sc2 < best[0]:
            best = (sc2, pcm2, sr2, w2)
        words = w2
    miss = _g_completeness(chunk, best[3], strict) if best[3] else None
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


# 152: a one-word speaker label at the start of a line, followed by speech
_LABEL_RE = re.compile(r"(?m)^[ \t]*[^\s:：\[\]<>{}]{1,24}[ \t]*[:：][ \t]*(?=\S)")


def _g_clauses(text):
    """Google-text clauses. A clause ends at a sentence stop, a newline, or a
    PAUSE tag (which stays with the clause before it — that is where the
    silence falls). Other tags never split: a reaction/state tag opens the
    clause that follows it, a mid-sentence tag stays inside its sentence.
    Fragments without real words merge forward. Returns [(text, (start, end))]."""
    cuts = set()
    # 152: a speaker label at the start of a line ("Name: …", one word, text after
    # it on the same line) belongs to its line — its colon is not a clause end
    labels = {m.end() for m in _LABEL_RE.finditer(text)}
    for m in _G_SENT_END.finditer(text):
        if m.end() in labels:
            continue
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
    t = re.sub(r"\[[^\]]+\]|<[a-zA-Z][a-zA-Z \-]{0,30}>|\|[^|\n]{1,40}\||\{[^{}\n]{1,60}\}", " ", text)   # tags first
    t = _LABEL_RE.sub(" ", t)
    return len(re.sub(r"[\W_]+", "", t))


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


def _replacement_is_provable(words, pcm, sr, head_end, tail_start, old_text, new_text, j0, j1, nc):
    """Would replacing [head_end, tail_start) destroy audio that must survive?

    Positional, not word-identity based: align the NEW text against the
    transcript once, so every recorded word knows which LINE of the new text it
    belongs to. A recorded word inside the span whose line is NOT being replaced
    is an intruder — the anchor has landed in the wrong place and good audio
    would be silently deleted (136: editing one sentence deleted two sentences
    before it). Counting by word identity instead would see phantom intruders in
    repetitive prose, where every line shares most of its words.
    """
    if not words or tail_start < head_end:
        return False
    if tail_start == head_end:
        return True                                   # pure insertion: nothing is replaced
    import difflib
    ours, owner = [], []
    for k, (c, _) in enumerate(nc):
        ws = _text_words(c); ours += ws; owner += [k] * len(ws)
    words = _merge_split_words(ours, words)           # 145
    tw = [_norm_word(w) for w, _, _ in words]
    if not ours or not tw:
        return True
    sm = difflib.SequenceMatcher(None, ours, tw, autojunk=False)
    t_line = {}
    for a, b, n in sm.get_matching_blocks():
        for i in range(n):
            t_line[b + i] = owner[a + i]
    intruders = judged = 0
    for idx, (w, st, en) in enumerate(words):
        if not (st * sr >= head_end - sr * 0.15 and en * sr <= tail_start + sr * 0.15):
            continue
        line = t_line.get(idx)
        if line is None:
            continue                                  # unmatched: the old wording or ASR noise
        judged += 1
        if not (j0 <= line < j1):
            intruders += 1
    if judged < 3:
        return True                                   # not enough evidence to condemn the span
    bad = intruders > 0.25 * judged
    if bad:
        _diag("g_span_check", judged=judged, intruders=intruders)
    return not bad


def _anchor_edges(words, head_text, tail_text, pcm, sr, fb_head, fb_tail):
    """Where to cut the OLD recording, found by matching the text that is NOT
    being replaced (132).

      head_text  everything before the edit   -> the cut is after its last word
      tail_text  everything after the edit    -> the cut is before its first word

    Clause indices are not used: the unchanged text anchors itself, so an edit to
    one line cannot drag its neighbour, and an Enter that splits a sentence keeps
    the first half's audio. Falls back to the silence-based cuts when the
    transcript cannot answer.
    """
    import difflib
    if not words:
        return fb_head, fb_tail
    words = _merge_split_words([_norm_word(w) for w in _text_words(head_text + " " + tail_text)], words)   # 145
    ow = [_norm_word(w) for w, _, _ in words]
    head_end, tail_start = fb_head, fb_tail

    hw = [_norm_word(w) for w in _text_words(head_text)]
    if not hw:
        head_end = 0
    else:
        sm = difflib.SequenceMatcher(None, hw, ow, autojunk=False)
        blocks = [bl for bl in sm.get_matching_blocks() if bl.size]
        if blocks:
            bl = max(blocks, key=lambda x: x.a + x.size)        # the block that reaches the end of the head
            j = min(len(words) - 1, bl.b + bl.size - 1)
            head_end = int(words[j][2] * sr) + int(sr * 0.04)

    tw = [_norm_word(w) for w in _text_words(tail_text)]
    if not tw:
        tail_start = len(pcm)
    else:
        sm = difflib.SequenceMatcher(None, tw, ow, autojunk=False)
        blocks = [bl for bl in sm.get_matching_blocks() if bl.size]
        if blocks:
            bl = min(blocks, key=lambda x: x.a)                  # the block that starts the tail
            j = max(0, bl.b)
            tail_start = int(words[j][1] * sr) - int(sr * 0.04)

    head_end = max(0, min(int(head_end), len(pcm)))
    tail_start = max(0, min(int(tail_start), len(pcm)))
    if tail_start == head_end:
        return head_end, tail_start                              # 136: insertion point
    if tail_start < head_end:                                    # nonsense: keep the clause-based cuts
        _diag("g_anchor", mode="fallback", head_ms=int(head_end * 1000 / sr), tail_ms=int(tail_start * 1000 / sr))
        if fb_tail <= fb_head:                                   # 133: no usable clause map either
            return 0, len(pcm)                                   # → replace the whole recording, honestly
        return fb_head, max(fb_head + 1, fb_tail)
    _diag("g_anchor", head_ms=int(head_end * 1000 / sr), tail_ms=int(tail_start * 1000 / sr),
          fb_head_ms=int(fb_head * 1000 / sr), fb_tail_ms=int(fb_tail * 1000 / sr))
    return head_end, tail_start


def _deleted_words(old_text, new_text):
    """The words the edit removed, as a multiset. (135)"""
    import difflib, collections
    a = [_norm_word(w) for w in _text_words(old_text)]
    b = [_norm_word(w) for w in _text_words(new_text)]
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag in ("delete", "replace"):
            out += a[i1:i2]
    return collections.Counter(out)


def _cut_is_provable(words, run, removed):
    """Is this stretch of the recording really the deleted text? At least 70 % of
    its words must be among the words the edit removed. (135)"""
    got = [_norm_word(w) for w, _, _ in words[run[0]:run[1]]]
    if not got:
        return False
    pool = dict(removed)
    hit = 0
    for w in got:
        if pool.get(w, 0) > 0:
            pool[w] -= 1; hit += 1
    ok = hit >= 0.7 * len(got)
    if not ok:
        _diag("g_cut_rejected", words=len(got), matched=hit)
    return ok


def _shift_words_past_cuts(words, cuts):
    """The transcript of the recording AFTER stretches were cut out: the removed
    words go, and everything later moves earlier by the time removed before it.
    Saves a second transcription of the same take. (136)"""
    if not cuts:
        return words
    spans = sorted(cuts)
    removed = set()
    for i, j in spans:
        removed |= set(range(i, j))
    out = []
    for idx, (w, st, en) in enumerate(words):
        if idx in removed:
            continue
        gone = 0.0
        for i, j in spans:
            if j <= idx:
                gone += max(0.0, words[j - 1][2] - words[i][1])
        out.append((w, max(0.0, st - gone), max(0.0, en - gone)))
    return out


def _cut_orphans(pcm, sr, words, orphans, status):
    """Remove stretches of the recording whose words are no longer in the text.
    Only whole runs bounded by real gaps are cut, so the join stays clean; a few
    words deleted in the middle of a sentence are left to the regeneration path.
    (134 — deleting a line or a paragraph costs NO api call.)"""
    keep, at = [], 0
    for i, j in orphans:
        if j - i < 2:                                   # a single word: too small to cut cleanly
            continue
        a = int(words[i][1] * sr) - int(sr * 0.06)
        b = int(words[j - 1][2] * sr) + int(sr * 0.06)
        a, b = max(0, min(a, len(pcm))), max(0, min(b, len(pcm)))
        if b <= a or b - a < int(sr * 0.15):
            continue
        keep.append(pcm[at:a]); at = b
    if at == 0:
        return None
    keep.append(pcm[at:])
    keep = [k for k in keep if len(k)]
    return _crossfade_join(keep, sr, ms=12) if keep else None


def _coverage(old_words, new_text, old_text=None):
    """Which lines of new_text have audio in this recording, and which recorded
    words are orphaned. Returns (covered_per_clause, orphan_runs) where
    covered_per_clause[k] = (matched, total) and orphan_runs are (i, j) spans of
    transcript indices no longer present in the text. (134)"""
    import difflib, collections
    nc = _g_clauses(new_text)
    ours, owner = [], []
    for k, (c, _) in enumerate(nc):
        ws = _text_words(c); ours += ws; owner += [k] * len(ws)
    old_words = _merge_split_words(ours, old_words or [])  # 145
    tw = [_norm_word(w) for w, _, _ in (old_words or [])]
    if not ours or not tw:
        return None, []
    sm = difflib.SequenceMatcher(None, ours, tw, autojunk=False)
    matched_new, matched_old = set(), set()
    for a, b, n in sm.get_matching_blocks():
        for i in range(n):
            matched_new.add(a + i); matched_old.add(b + i)
    cov = []
    for k in range(len(nc)):
        idx = [i for i in range(len(ours)) if owner[i] == k]
        cov.append((sum(1 for i in idx if i in matched_new), len(idx)))
    orphans, run = [], None
    for i in range(len(tw)):
        if i not in matched_old:
            run = (run[0], i + 1) if run else (i, i + 1)
        elif run:
            orphans.append(run); run = None
    if run:
        orphans.append(run)
    # 134: is an orphan run a WHOLE line that was deleted, or words cut out of
    # the MIDDLE of a line? Decide against the OLD text's own line structure,
    # not against neighbouring words (which repeat, and mislead difflib):
    #   · every old line the run touches is fully inside it  → a whole-line
    #     deletion → the audio can simply be cut;
    #   · an old line is only partly inside it → that line was gutted → the line
    #     that now carries its surviving words must be regenerated, because
    #     cutting inside a sentence leaves an audible seam.
    old2new = {}
    for a, b, n in sm.get_matching_blocks():
        for i in range(n):
            old2new[b + i] = a + i
    t_owner = None
    if old_text:
        oc_ = _g_clauses(old_text)
        o_words, o_owner = [], []
        for k, (c, _) in enumerate(oc_):
            ws = _text_words(c); o_words += ws; o_owner += [k] * len(ws)
        sm2 = difflib.SequenceMatcher(None, o_words, tw, autojunk=False)
        t_owner = {}
        for a, b, n in sm2.get_matching_blocks():
            for i in range(n):
                t_owner[b + i] = o_owner[a + i]
    # what the edit really removed — the only thing that can justify an orphan
    removed_ct = collections.Counter()
    if old_text:
        a_ = [_norm_word(w) for w in _text_words(old_text)]
        b2_ = [_norm_word(w) for w in _text_words(new_text)]
        for tag, i1_, i2_, j1_, j2_ in difflib.SequenceMatcher(None, a_, b2_, autojunk=False).get_opcodes():
            if tag in ("delete", "replace"):
                removed_ct.update(a_[i1_:i2_])
    def _corroborated(run):
        """Is this stretch of transcript really text the edit removed, or just
        ASR noise? At least half its words must be among the removed ones, and a
        one-word run is never enough on its own. (137)"""
        got = [tw[x] for x in range(run[0], run[1])]
        if not got or not removed_ct:
            return False
        pool = dict(removed_ct); hit = 0
        for w in got:
            if pool.get(w, 0) > 0:
                pool[w] -= 1; hit += 1
        return hit >= max(1, 0.5 * len(got)) and (len(got) >= 2 or hit == len(got))
    inside = []
    for (i, j) in orphans:
        gutted_line = None
        if not _corroborated((i, j)):
            _diag("g_orphan_ignored", words=j - i, sample=" ".join(tw[i:min(j, i + 3)])[:40])
            inside.append(False)                    # False = ASR noise: neither cut nor regenerate
            continue
        if t_owner:
            touched = {t_owner[x] for x in range(i, j) if x in t_owner}
            for k in touched:
                idx = [x for x, ow in t_owner.items() if ow == k]
                if idx and not all(i <= x < j for x in idx):        # only partly removed
                    nxt = [old2new[x] for x in idx if x in old2new and not (i <= x < j)]
                    if nxt:
                        gutted_line = owner[min(nxt)]
                        break
            if gutted_line is None and touched:
                inside.append(None); continue                       # whole old line(s) → cut
        if gutted_line is None:
            before = max([o for o in old2new if o < i], default=None)
            after = min([o for o in old2new if o >= j], default=None)
            lb = owner[old2new[before]] if before is not None else None
            la = owner[old2new[after]] if after is not None else None
            gutted_line = lb if (lb is not None and lb == la) else None
        inside.append(gutted_line)
    return cov, [(r, ins) for r, ins in zip(orphans, inside) if ins is not False]


def line_voice_map(entry):
    """Which voice each line of a part was last generated with. (134)"""
    return entry.get("voices") or {}


def _voice_of_line(entry, text_of_line, cfg):
    """A line's own remembered voice, or the part's, or the current one."""
    vm = line_voice_map(entry)
    key = _norm_word(" ".join(_text_words(text_of_line)))[:80]
    if key in vm:
        return vm[key]
    base = entry.get("payload") or {}
    keep = {k: base[k] for k in ("g_voice", "g_preset", "g_age", "g_state",
                                 "f_voice", "f_preset", "f_age", "f_state") if k in base}
    return keep or {k: cfg[k] for k in ("g_voice", "f_voice") if k in cfg}


def _remember_line_voices(entry, text, cfg):
    """Record the voice each line now holds. (134)"""
    vm = dict(entry.get("voices") or {})
    # 135: drop entries for lines that no longer exist, so a deleted or rewritten
    # line can never hand its old voice to a new one that happens to look similar
    live = {_norm_word(" ".join(_text_words(c)))[:80] for c, _ in _g_clauses(entry.get("text") or text)}
    live |= {_norm_word(" ".join(_text_words(c)))[:80] for c, _ in _g_clauses(text)}
    vm = {k: v for k, v in vm.items() if k in live}
    keep = {k: cfg[k] for k in ("g_voice", "g_preset", "g_age", "g_state",
                                "f_voice", "f_preset", "f_age", "f_state") if k in cfg}
    for c, _ in _g_clauses(text):
        vm[_norm_word(" ".join(_text_words(c)))[:80]] = keep
    entry["voices"] = vm


def _google_clause_patch(entry, new_text, sel_start, sel_end, cfg, status):
    """Replace only the changed/selected clauses of a Google part. Returns
    the number of clauses regenerated, or 0 when a whole-part take is the
    honest fallback (single clause, everything changed, boundaries unfound)."""
    import difflib
    old_text, pcm, sr = entry["text"], entry["items"][0]["pcm"], entry["sr"]
    oc, nc = _g_clauses(old_text), _g_clauses(new_text)
    if len(nc) < 1 or (len(oc) < 2 and len(nc) < 2):
        _diag("g_clause_patch", reason=f"too_few_clauses_{len(oc)}_{len(nc)}")
        return 0
    lang = {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(cfg.get("g_lang"))
    old_words_hint = transcribe_words(pcm, sr, status, lang, old_text, cfg)
    sm = difflib.SequenceMatcher(None, [c[0].strip() for c in oc], [c[0].strip() for c in nc], autojunk=False)
    ops = [o for o in sm.get_opcodes() if o[0] != "equal"]
    has_sel = sel_start is not None and sel_end is not None and sel_end > sel_start
    hit = [k for k, c in enumerate(nc) if c[1][0] < sel_end and c[1][1] > sel_start] if has_sel else []
    chosen = set(hit)                                   # the user's conscious choice
    # 132: A SELECTION IS THE AUTHORITY. It names exactly the sentences to redo;
    # the diff no longer widens it. Splitting a sentence with Enter changes the
    # clause list, and a clause-level diff then calls BOTH halves "changed" —
    # which used to drag the untouched half (and sometimes the whole part) into
    # the regeneration. With the splice anchored to the unchanged TEXT (see
    # _anchor_edges) the old audio can be cut anywhere, so the selection alone
    # decides.
    # 134: lines whose words are NOT in the recording must be voiced too — a part
    # whose audio does not contain its text is broken. Lines that are merely
    # dragged in this way keep their OWN voice (see the run split below).
    cov, orph = _coverage(old_words_hint, new_text, old_text) if old_words_hint else (None, [])
    orphans = [r for r, ins in orph if ins is None]              # between lines → cut
    gutted = sorted({ins for r, ins in orph if ins is not None}) # inside a line → regenerate
    # 136: a line counts as "not in the audio" only on strong evidence — the
    # transcript is an imperfect witness, especially in Persian. A short line
    # cannot be judged at all, so it is left alone unless it is brand new
    # (nothing matched) — which the transcript CAN say reliably.
    uncovered = [k for k, (m, t) in enumerate(cov or [])
                 if (t >= 4 and m < 0.25 * t) or (t >= 1 and m == 0)]
    uncovered = sorted(set(uncovered) | set(gutted))
    if cov:
        _diag("g_coverage", lines=len(cov), uncovered=len(uncovered), gutted=len(gutted),
              worst=min((m / max(1, t) for m, t in cov), default=1))
    if hit or uncovered:
        need = sorted(set(hit) | set(uncovered))
        j0, j1 = need[0], need[-1] + 1
        i0, i1 = min(j0, max(0, len(oc) - 1)), min(max(j1, 1), len(oc))
        if uncovered and hit:
            extra = [k for k in uncovered if k not in chosen]
            if extra:
                status(f"{faDigits(len(extra))} خط دیگر هم باید ساخته شود (متنش عوض شده یا صدا نداشت)؛ آن‌ها صدای خودشان را نگه می‌دارند.")
                _diag("g_clause_patch", dragged_in=len(extra), chosen=len(chosen))
    elif ops:
        i0, i1 = min(o[1] for o in ops), max(o[2] for o in ops)
        j0, j1 = min(o[3] for o in ops), max(o[4] for o in ops)
    else:
        _diag("g_clause_patch", reason="no_change_no_selection" if not has_sel else "selection_matched_no_clause")
        return 0
    if orphans and old_words_hint:
        # 136: CUT FIRST. Whole-line deletions leave the audio by being removed,
        # never by being re-spoken — and this happens even when the same edit
        # also selected a line or added new ones. Every stretch must first PROVE
        # it is the text the edit removed (135).
        removed = _deleted_words(old_text, new_text)
        provable = [r for r in orphans if _cut_is_provable(old_words_hint, r, removed)]
        if provable and len(provable) != len(orphans):
            _diag("g_clause_patch", note=f"unprovable_cuts_{len(orphans) - len(provable)}")
        cut = _cut_orphans(pcm, sr, old_words_hint, provable, status) if provable else None
        if cut is not None:
            removed_s = (len(pcm) - len(cut)) / sr
            old_words_hint = _shift_words_past_cuts(old_words_hint, provable)
            pcm = cut
            entry["items"][0]["pcm"] = cut
            _diag("g_clause_patch", deleted_runs=len(provable), removed_ms=int(removed_s * 1000))
            status(f"{faDigits(len(provable))} بخشِ حذف‌شده از صدا برداشته شد.")
            if not hit and not uncovered:                # nothing else to do: done, with no api call
                entry["items"][0]["text"] = new_text
                entry["items"][0]["span"] = (0, len(new_text))
                entry["text"] = new_text
                _remember_line_voices(entry, new_text, {**(entry.get("payload") or {}), **cfg})
                return 1
            # otherwise the surviving edit continues below, against the cut audio
    whole = j0 <= 0 and j1 >= len(nc)
    if j1 <= j0:
        # pure deletion: drop the old clauses' audio, keep the neighbours
        lang0 = {"fa": "fa-IR", "en": "en-US", "de": "de-DE", "tr": "tr-TR", "fr": "fr-FR", "es": "es-ES"}.get(cfg.get("g_lang"))
        w0 = transcribe_words(pcm, sr, status, lang0, old_text, cfg)
        cuts = _g_bounds(pcm, sr, oc, status, lang0, cfg, old_text, w0)
        if cuts is None:
            # 133: a pure deletion still needs a cut point; take it from the text
            if not w0:
                _diag("g_clause_patch", reason="no_transcript_for_old_audio_delete")
                return 0
            head_t = new_text[:nc[j0][1][0]] if j0 < len(nc) else new_text
            tail_t = new_text[nc[j0][1][0]:] if j0 < len(nc) else ""
            h, t = _anchor_edges(w0, head_t, tail_t, pcm, sr, 0, len(pcm))
            cuts = [h] + [t] * (len(oc) - 2) if len(oc) > 2 else [h]
            cuts = sorted(set(max(0, min(c, len(pcm))) for c in cuts))[:max(0, len(oc) - 1)]
            while len(cuts) < len(oc) - 1:
                cuts.append(len(pcm))
            _diag("g_clause_patch", note="delete_cuts_from_anchor")
        b = [0] + cuts + [len(pcm)]
        out = _crossfade_join([x for x in (pcm[:b[i0]], pcm[b[i1]:]) if len(x)], sr)
        entry.update({"items": [{"kind": "t", "text": new_text.strip(), "span": (0, len(new_text.strip())), "pcm": out}],
                      "text": new_text.strip()})
        _diag("g_clause_patch", removed=i1 - i0)
        return i1 - i0
    old_words = old_words_hint
    cuts = _g_bounds(pcm, sr, oc, status, lang, cfg, old_text, old_words)
    if cuts is None:
        # 133: not fatal. The clause map of the OLD recording is only a fallback
        # for the anchor; without it the anchor still finds the edges from the
        # unchanged text. Only a missing transcript makes surgery impossible.
        if not old_words:
            _diag("g_clause_patch", reason="no_transcript_for_old_audio")
            return 0
        _diag("g_clause_patch", note="old_clause_map_unavailable_anchoring_only")
        cuts = []
        b = [0] * (len(oc) + 1)
        b[-1] = len(pcm)
    else:
        b = [0] + cuts + [len(pcm)]
    # regenerate the changed clauses with one neighbour on each side as
    # prosodic context, then keep only the middle
    before = nc[j0 - 1][0].strip() if j0 > 0 else ""
    after = nc[j1][0].strip() if j1 < len(nc) else ""
    # 134: split the span into consecutive runs that share a target voice. A line
    # you SELECTED takes the current settings; a line merely dragged in keeps the
    # voice it already had. One request per run — two voices cannot come from one.
    runs = []
    for k in range(j0, j1):
        want = {kk: cfg[kk] for kk in ("g_voice", "g_preset", "g_age", "g_state",
                                       "f_voice", "f_preset", "f_age", "f_state") if kk in cfg} \
               if k in chosen else _voice_of_line(entry, nc[k][0], cfg)
        if runs and runs[-1][2] == want:
            runs[-1][1] = k + 1
        else:
            runs.append([k, k + 1, want])
    if whole and len(runs) <= 1:
        # the whole part, one voice: the full path is equivalent and keeps the
        # part's lead-in and its completeness audit
        _diag("g_clause_patch", reason="whole_part_one_voice")
        return 0
    if whole:
        _diag("g_clause_patch", note=f"whole_part_in_{len(runs)}_voices")
    if len(runs) > 1:
        _diag("g_clause_patch", runs=len(runs))
        status(f"{faDigits(len(runs))} بخش با صداهای متفاوت ساخته می‌شود؛ خط‌هایی که خودتان انتخاب نکرده‌اید صدای خودشان را نگه می‌دارند.")
    middle = "\n".join(c[0].strip() for c in nc[j0:j1])   # 132: newline, never a space
    rate = len(pcm) / max(1, _g_speech_len(old_text))            # samples per spoken char

    base_voice = {k: (entry.get("payload") or {}).get(k) for k in ("g_voice", "f_voice")}

    def make_run(a, b, voice, n):
        """Generate clauses [a,b) in ONE voice and cut the target out.
        Neighbours are sent as spoken context ONLY when the run keeps the part's
        own voice; in a different voice they buy nothing and cost a seam (138)."""
        same_voice = all((voice or {}).get(k, base_voice.get(k)) == base_voice.get(k)
                         for k in ("g_voice", "f_voice"))
        ctx_b = nc[a - 1][0].strip() if (a > 0 and same_voice) else ""
        ctx_a = nc[b][0].strip() if (b < len(nc) and same_voice) else ""
        mid = "\n".join(c[0].strip() for c in nc[a:b])
        gtext = "\n".join(x for x in (ctx_b, mid, ctx_a) if x)
        gcl_ = _g_clauses(gtext)
        p0 = 1 if ctx_b else 0
        p1 = p0 + (b - a)
        if len(gcl_) != p1 + (1 if ctx_a else 0):
            return None, f"gen_clauses_{len(gcl_)}_vs_{p1 + (1 if ctx_a else 0)}"
        rcfg = {**cfg, **(voice or {}), "_no_audit": True}
        np_, nsr_ = cloud_pcm(gtext, rcfg, status)
        gcuts_ = _g_bounds(np_, nsr_, gcl_, status, lang, cfg, gtext)
        if gcuts_ is None:
            return None, "new_piece_boundaries_unfound"
        gb_ = [0] + gcuts_ + [len(np_)]
        seg_ = np_[gb_[p0]:gb_[p1]]
        if nsr_ != sr:
            seg_ = _resample(seg_, nsr_, sr)
        n_ch = _g_speech_len(mid)
        w_ = rate * max(1, n_ch)
        lo, hi = (0.45, 2.2) if n_ch >= 60 else (0.30, 3.2) if n_ch >= 25 else (0.12, 6.0)
        if len(seg_) < int(sr * 0.10) or not (lo * w_ <= len(seg_) <= hi * w_):
            return None, f"segment_duration_{int(len(seg_) * 1000 / sr)}ms_want_{int(w_ * 1000 / sr)}ms_band_{lo}-{hi}"
        return seg_, None

    def attempt(n):
        """One try at the whole span: every run, in order, joined. 131: a take
        that splits or cuts badly is a BAD TAKE, not a reason to rebuild."""
        status(f"گوگل: {faDigits(j1 - j0)} جمله را همراه جمله‌های کناری‌اش دوباره می‌سازد…"
               if n == 0 else f"برشِ جمله جا نیفتاد؛ برداشت دوباره ({faDigits(n + 1)}/3)…")
        pieces = []
        for a, b, voice in runs:
            seg_, why_ = make_run(a, b, voice, n)
            if seg_ is None:
                return None, why_
            pieces.append(seg_)
        if not pieces:
            return None, "no_runs"
        if len(pieces) == 1:
            return pieces[0], None
        gap = np.zeros(int(sr * 0.10), dtype=np.int16)
        joined = []
        for i, p in enumerate(pieces):
            if i:
                joined.append(gap)
            joined.append(p)
        return _crossfade_join(joined, sr, ms=10), None

    seg, why = None, None
    for n in range(3):
        seg, why = attempt(n)
        if seg is not None:
            if n:
                _diag("g_clause_patch", recovered_on_attempt=n + 1)
            break
        _diag("g_clause_patch", attempt=n + 1, reason=why)
    if seg is None:
        _diag("g_clause_patch", reason=f"gave_up_after_3:{why}")
        return 0
    # loudness: the new clause sits at the part's level
    old_rms = float(np.sqrt(np.mean(pcm.astype(np.float64) ** 2))) or 1.0
    seg_rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2))) or 1.0
    g = float(np.clip(old_rms / seg_rms, 0.5, 2.0))
    if abs(g - 1.0) > 0.05:
        seg = np.clip(seg.astype(np.float32) * g, -32768, 32767).astype(np.int16)
    seg = _sweep_stubs(seg, sr)
    head_text = new_text[:nc[j0][1][0]] if j0 < len(nc) else new_text
    tail_text = new_text[nc[j1 - 1][1][1]:] if j1 - 1 < len(nc) else ""
    head_end, tail_start = _anchor_edges(old_words, head_text, tail_text, pcm, sr, b[i0], b[i1])
    # 136: prove the stretch being replaced really is the old version of these
    # clauses. If the words inside it belong to text that is NOT being replaced,
    # the anchor has landed in the wrong place and would silently delete good
    # audio — fall back to the clause cuts, and if those are no better, give up.
    if not _replacement_is_provable(old_words, pcm, sr, head_end, tail_start, old_text, new_text, j0, j1, nc):
        _diag("g_clause_patch", note="anchor_rejected_using_clause_cuts")
        head_end, tail_start = b[i0], b[i1]
        if not _replacement_is_provable(old_words, pcm, sr, head_end, tail_start, old_text, new_text, j0, j1, nc):
            _diag("g_clause_patch", reason="replacement_span_unprovable")
            return 0
    # 136: sweep debris off the edges of BOTH the replacement and the stretch it
    # joins, not just the replacement. A clipped half-word left at a seam is the
    # "unscripted sound" and the "blippy abrupt start" heard in the field.
    head = _sweep_stubs(pcm[:head_end], sr) if head_end else pcm[:head_end]
    tail = _sweep_stubs(pcm[tail_start:], sr) if tail_start < len(pcm) else pcm[tail_start:]
    kept = len(pcm) - (tail_start - head_end)
    if kept < int(sr * 0.25) and len(pcm) > int(sr * 1.0):
        _diag("g_clause_patch", reason="splice_keeps_nothing",
              head_ms=int(head_end * 1000 / sr), tail_ms=int(tail_start * 1000 / sr))
        return 0                                  # → the honest full rebuild
    parts = [x for x in (head, seg, tail) if len(x)]
    out = _crossfade_join(parts, sr, ms=12)
    entry.update({"items": [{"kind": "t", "text": new_text.strip(), "span": (0, len(new_text.strip())), "pcm": out}],
                  "text": new_text.strip()})
    for a_, b_, voice_ in runs:                    # 134: each line remembers its voice
        _remember_line_voices(entry, "\n".join(nc[k][0] for k in range(a_, b_)), {**cfg, **(voice_ or {})})
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


def _merge_split_words(ours, words):
    """Merge adjacent transcript words when their concatenation is one of our
    words and neither piece is on its own: an ASR writes «یک جانبه» for our
    «یک‌جانبهٔ». Returns a new [(word, start, end)] list. (143)"""
    if not words or not ours:
        return words
    vocab = set(ours)
    singles = set(w for w in ours if len(w) > 1)
    out, i = [], 0
    tw = [_norm_word(w) for w, _, _ in words]
    while i < len(tw):
        merged = False
        for span in (3, 2):
            if i + span <= len(tw):
                cat = "".join(tw[i:i + span])
                if cat in vocab and not all(t in singles for t in tw[i:i + span]):
                    out.append((cat, words[i][1], words[i + span - 1][2])); i += span; merged = True; break
        if not merged:
            out.append(words[i]); i += 1
    return out


def _text_words(text):
    t = re.sub(r"\[[^\]]+\]", " ", text)
    t = re.sub(r"<[a-zA-Z][a-zA-Z \-]{0,30}>", " ", t)        # 151: 3.8 vocal tags are not words
    t = re.sub(r"\|[^|\n]{1,40}\|", " ", t)                    # 151: 3.8 backchannels |mhm|
    t = re.sub(r"\{[^{}\n]{1,60}\}", " ", t)                    # 152: {tone} markers
    t = _LABEL_RE.sub(" ", t)                                      # 152: "Name:" speaker labels
    return [w for w in (_norm_word(x) for x in t.split()) if w]


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
    """One door for every transcript in the app — ALWAYS Google.
    130: Fish Audio's transcribe-1 is a PAID endpoint; on the free tier it
    answers 402 and the app then fell back to the crude silence heuristic for
    every boundary, which is what made surgery on Fish parts unreliable. The
    transcript is the backbone of clause surgery, the completeness audit and
    captions, so it uses the one service that is dependable here."""
    return google_words(pcm, sr, status, lang, text)


_G_WORDS_FORM = {"revision": False}        # 169: the documented form first; flips once if Google asks
_BCP47 = {"fa": "fa-IR", "en": "en-US", "ar": "ar-EG", "de": "de-DE", "fr": "fr-FR", "es": "es-419", "tr": "tr-TR", "ru": "ru-RU", "it": "it-IT"}


def _bcp47(lang):
    """Google's transcriber wants BCP-47 codes (fa-IR), not bare ones (fa); unknown → auto-detect."""
    l = str(lang or "").strip()
    if not l:
        return None
    return l if "-" in l else _BCP47.get(l.lower())


_PREVIEW_MODE = {"on": False}


def google_words(pcm, sr, status, lang=None, text=None):
    """[(word, start_s, end_s)] for a recording, or None. Cached per recording
    AND per text (127) so an edit can never meet a stale transcript."""
    if _PREVIEW_MODE["on"]:
        return None                            # 171: a voice sample needs no timings
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
                                 **({"languageCodes": [_bcp47(lang)]} if _bcp47(lang) else {})}}}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GOOGLE_TRANSCRIBE}:generateContent"
    try:
        status("دارم صدا را با زمان‌بندی رونویسی می‌کنم…")
        def post(k):
            try:
                return _google_post(url, body, k, timeout=120, revision=_G_WORDS_FORM["revision"])
            except _GoogleHTTP as e:
                if e.code == 400 and "thinking" in str(e.msg).lower():       # 169: the other form, once
                    _G_WORDS_FORM["revision"] = not _G_WORDS_FORM["revision"]
                    _diag("google_words_form", revision=_G_WORDS_FORM["revision"])
                    return _google_post(url, body, k, timeout=120, revision=_G_WORDS_FORM["revision"])
                raise
        data = google_rotate(post, status, "رونویسی")
        words = _find_words(data)
        _diag("google_words", n=len(words or []), audio_s=round(len(pcm) / sr, 1))
        _words_cache_put(key, words)
        return words
    except Cancelled:
        raise
    except Exception as e:
        _diag("google_words", err=str(e)[:120])
        return None


def _g_boundaries_words(pcm, sr, clauses, words, weak=False):
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
    words = _merge_split_words(ours, words)               # 143: ZWNJ compounds
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
    holes = []
    for k in range(B):
        last = [i for i in range(len(ours)) if owner[i] == k and i in m2t]
        nxt = [i for i in range(len(ours)) if owner[i] == k + 1 and i in m2t]
        if not last or not nxt:
            _diag("g_words_align", clause=k, mode="unmatched_interpolate")
            cuts.append(None); holes.append(k)          # 141: fill in below, do not give up
            continue
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
    if holes:
        if len(holes) > max(1, B // 3):
            _diag("g_words_align", holes=len(holes), of=B, mode="too_many_unmatched")
            return None
        runs = _silence_runs(pcm, sr, min_ms=70)
        total_chars = max(1, sum(_g_speech_len(c) for c, _ in clauses))
        for k in holes:
            lo = max([c for c in cuts[:k] if c is not None], default=0)
            hi = min([c for c in cuts[k + 1:] if c is not None], default=len(pcm))
            # where the text says this boundary should be, proportionally
            frac = sum(_g_speech_len(c) for c, _ in clauses[:k + 1]) / total_chars
            guess = int(len(pcm) * frac)
            guess = max(lo + 1, min(guess, hi - 1))
            cand = [r for r in runs if lo < r[2] < hi]
            cuts[k] = min(cand, key=lambda r: abs(r[2] - guess))[2] if cand else guess
    if weak:                                            # 146: cross-check against the text's proportions
        total_chars = max(1, sum(_g_speech_len(c) for c, _ in clauses))
        runs = _silence_runs(pcm, sr, min_ms=60)
        fixed = 0
        for k in range(B):
            frac = sum(_g_speech_len(c) for c, _ in clauses[:k + 1]) / total_chars
            guess = int(len(pcm) * frac)
            span = _g_speech_len(clauses[k][0]) + _g_speech_len(clauses[k + 1][0])
            tol = max(int(sr * 1.2), int(len(pcm) * 0.30 * span / total_chars))
            if abs(cuts[k] - guess) > tol:
                cand = [r for r in runs if abs(r[2] - guess) < tol]
                if cand:
                    cuts[k] = min(cand, key=lambda r: abs(r[2] - guess))[2]; fixed += 1
        if fixed:
            _diag("g_boundaries", weak_witness_corrected=fixed)
    if any(cuts[k] >= cuts[k + 1] for k in range(B - 1)) or cuts[-1] >= len(pcm):
        return None
    _diag("g_boundaries", need=B, mode="words" if not holes else f"words+{len(holes)}interp", ms=[int(c * 1000 / sr) for c in cuts])
    return [_zc_snap(pcm, c, sr) for c in cuts]


def _g_bounds(pcm, sr, clauses, status, lang=None, cfg=None, text=None, words=None):
    """Word timestamps first (exact, language-independent); the silence
    heuristic when transcription is unavailable or the alignment is thin.
    127: accepts an already-made transcript so a take is never transcribed twice."""
    if len(clauses) <= 1:
        return []
    if words is None:
        words = transcribe_words(pcm, sr, status, lang, text, cfg)
    weak = (cfg or {}).get("engine") == "fish"           # 146: Google's ASR on Fish audio is a weak witness
    if words:
        cuts = _g_boundaries_words(pcm, sr, clauses, words, weak=weak)
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
            kind = _google_fault(e.code, e.msg)
            if kind in ("network", "region"):
                raise RuntimeError("موسیقی: " + (_NET_BLOCK_MSG if kind == "network" else _REGION_MSG))
            if kind == "key":
                _google_mark(key, "bad"); denied.append(_google_clean_msg(e.msg)[:80]); continue
            if e.code in (401, 403):
                denied.append(_google_clean_msg(e.msg)[:80]); continue      # 147: Lyria refusal ≠ bad key
            if e.code in (402, 429) or "billing" in e.msg.lower():
                denied.append(e.msg[:80]); continue
            raise RuntimeError("موسیقی: " + e.msg[:160])
    if data is None:
        if not _google_usable_keys():
            raise RuntimeError("هنوز کلید گوگل ندارید؛ از دکمهٔ «کلیدهای گوگل» یک کلید وارد کنید.")
        raise RuntimeError("ساخت موسیقی با لیریا فقط با کلیدِ پولی (پروژه‌ای که صورت‌حساب دارد) کار می‌کند؛ لیریا طرح رایگان ندارد — هر قطعه حدود 8 سنت. "
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
    """182: an undo step — the file waits in the trash (see trash_put) and its library entry is handed back for the undo."""
    p = _MUSIC_DIR / os.path.basename(file)
    entry = next((e for e in music_list() if e.get("file") == os.path.basename(file)), None)
    token = trash_put(p) if p.exists() else None
    lib = [e for e in music_list() if e["file"] != os.path.basename(file)]
    (_MUSIC_DIR / "library.json").write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
    _MUSIC_LAST_DELETE.update(token=token, entry=entry)
    return lib


_MUSIC_LAST_DELETE = {"token": None, "entry": None}


def music_restore(token, entry):
    """Undo of a deleted library track: its file and its entry come back."""
    if token:
        trash_back(token)
    lib = [e for e in _music_list_175() if not (entry and e.get("file") == entry.get("file"))]   # this machine's library (not the built-in tracks)
    if entry and entry.get("file") and not str(entry["file"]).startswith("builtin:"):
        lib.append(entry)
    (_MUSIC_DIR / "library.json").write_text(json.dumps(lib, ensure_ascii=False), encoding="utf-8")
    return music_list()


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
                          level_db=float(music_cfg.get("level_db", -16)), duck=float(music_cfg.get("duck_db", 12)) > 0 and bool(music_cfg.get("duck", True)),
                          duck_db=float(music_cfg.get("duck_db", 12)),
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
    v = _vault(name)                      # 155: sealed inside the compiled app
    if v:
        return v
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


class AudioFormatError(RuntimeError):
    """182: a file this computer cannot decode here (the window may still decode it and hand over plain WAV)."""


def _decode_audio(raw):
    """PCM mono int16 + rate from WAV/MP3/OGG/FLAC bytes (182: + 24-bit/float WAV, and M4A/AAC on a Mac)."""
    import io
    if raw[:4] == b"RIFF":
        try:
            with wave.open(io.BytesIO(raw)) as wf:
                sr, ch, sw = wf.getframerate(), wf.getnchannels(), wf.getsampwidth()
                frames = wf.readframes(wf.getnframes()) if sw == 2 else b""
            if sw == 2:
                a = np.frombuffer(frames, dtype="<i2").astype(np.float32)
                if ch > 1:
                    a = a.reshape(-1, ch).mean(axis=1)
                return a.astype(np.int16), sr
        except Exception:
            pass                                                    # 24-bit, float or extensible WAV → soundfile below
    err = None
    try:
        import soundfile as sf
        a, sr = sf.read(io.BytesIO(raw), dtype="float32", always_2d=True)
        return np.clip(a.mean(axis=1) * 32767, -32768, 32767).astype(np.int16), int(sr)
    except Exception as e:
        err = e
    got = _decode_afconvert(raw)                                    # M4A / AAC / ALAC: the Mac's own decoder
    if got is not None:
        return got
    raise AudioFormatError("این قالب صوتی را نمی‌توانم بخوانم (" + type(err).__name__ + ")؛ WAV، MP3، M4A، OGG یا FLAC بدهید.")


def _decode_afconvert(raw):
    """182: macOS only — afconvert (part of every Mac) turns what Core Audio reads (M4A, AAC, ALAC, CAF…) into 16-bit WAV."""
    if sys.platform != "darwin" or not Path("/usr/bin/afconvert").exists():
        return None
    import tempfile, subprocess, io
    ext = ".m4a" if raw[4:8] == b"ftyp" else ".aac" if raw[:2] in (b"\xff\xf1", b"\xff\xf9") else ".caf" if raw[:4] == b"caff" else ".audio"
    try:
        with tempfile.TemporaryDirectory() as td:
            src, dst = Path(td) / ("in" + ext), Path(td) / "out.wav"
            src.write_bytes(raw)
            r = subprocess.run(["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16", str(src), str(dst)], capture_output=True, timeout=900)
            if r.returncode != 0 or not dst.exists():
                return None
            with wave.open(str(dst)) as wf:
                sr, ch = wf.getframerate(), wf.getnchannels()
                a = np.frombuffer(wf.readframes(wf.getnframes()), dtype="<i2").astype(np.float32)
            if ch > 1:
                a = a.reshape(-1, ch).mean(axis=1)
            return a.astype(np.int16), sr
    except Exception:
        return None


def _http_get_json(url, params, headers=None, timeout=30):
    r = requests.get(url, params=params, headers=headers or {}, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}: {r.text[:120]}")
    return r.json()


def music_search(provider, query, key, status, style="ambient", page=1):
    _net_ready(status)
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
    import time as _t
    status("دانلود موسیقی…"); t0 = _t.time()                 # 171: streamed, with progress in the status line and timings in the log
    with requests.get(url, timeout=(15, 60), stream=True, headers={"User-Agent": "Ava/100 (narration app)"}) as r:
        if r.status_code != 200:
            raise RuntimeError(f"دانلود نشد (HTTP {r.status_code}).")
        total = int(r.headers.get("Content-Length") or 0); buf = bytearray(); last = 0.0
        for chunk in r.iter_content(65536):
            _check_cancel(); buf += chunk
            if _t.time() - last > 0.4:
                last = _t.time(); got = len(buf) / 1e6
                status("دانلود موسیقی… " + (f"{got:.1f} از {total / 1e6:.1f} مگابایت" if total else f"{got:.1f} مگابایت"))
    t1 = _t.time(); status("موسیقی دانلود شد؛ آماده‌اش می‌کنم…")
    pcm, sr = _decode_audio(bytes(buf)); t2 = _t.time()
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
    _diag("music_fetch", provider=provider, seconds=round(len(pcm) / sr, 1), license=entry["license"], bytes=len(buf), dl_ms=int((t1 - t0) * 1000), decode_ms=int((t2 - t1) * 1000), save_ms=int((_t.time() - t2) * 1000))
    return pcm, sr, entry


def music_import(path, status, name=None):
    """A file from disk becomes the bed and joins the library. 182: the import limits (250 MB · 60 minutes);
    name = the file's own name when it comes from the asset store."""
    p = Path(path)
    nm = name or p.name
    if not p.is_file():
        raise RuntimeError("فایل پیدا نشد.")
    audio_limits_check(p, nm)
    pcm, sr = _decode_audio(p.read_bytes())
    audio_seconds_check(len(pcm) / sr, nm)
    _MUSIC.update({"pcm": pcm, "sr": sr, "prompt": "file:" + nm})
    entry = music_save(pcm, sr, "file", Path(nm).stem)
    return pcm, sr, entry


def music_import_asset(aid, name, status):
    """182: the music library's import, from a file the window put in the asset store (dropped there afterwards)."""
    try:
        return music_import(_ASSET_DIR / f"{aid}.bin", status, name=name)
    finally:
        asset_drop(aid)


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
    ("toddler", "نوپا (2–4 ساله)", "Toddler (2–4)", "Voice: a toddler of about three — tiny, very high-pitched, babbling cadence, simple words stretched out, giggly and unsteady.", "[voice of a toddler, tiny, very high-pitched, babbling]"),
    ("child", "بچه (5–9 ساله)", "Child (5–9)", "Voice: a child of about seven — high, bright, breathy, eager, sing-song schoolroom rhythm.", "[voice of a young child around seven, high and bright, sing-song]"),
    ("teen", "نوجوان (13–17 ساله)", "Teenager (13–17)", "Voice: a teenager — youthful, light, a touch of attitude, energy that comes and goes mid-sentence.", "[teenage voice, youthful with a touch of attitude]"),
    ("young", "جوان (20 تا 30 ساله)", "Young adult (20s)", "Voice: a young adult in their twenties — fresh, quick, energetic.", "[young adult voice, fresh and energetic]"),
    ("adult", "بزرگسال (30 تا 45 ساله)", "Adult (30s–40s)", "Voice: an adult in their thirties or forties — settled, full, confident.", "[adult voice, settled and confident]"),
    ("middle", "میان‌سال (50 تا 60 ساله)", "Middle-aged (50s)", "Voice: a middle-aged person in their fifties — fuller, slower, a little gravel, unhurried authority.", "[middle-aged voice, fuller, unhurried, a little gravel]"),
    ("elderly", "سالخورده (70 ساله)", "Elderly (70s)", "Voice: an elderly person around seventy — slower, softer, slightly hoarse, small pauses for breath, words landing gently.", "[elderly voice around seventy, slower, softer, slightly hoarse]"),
    ("very_old", "خیلی پیر (90 به بالا)", "Very old (90+)", "Voice: a very old person past ninety — NOT young, NOT smooth. Thin, cracked and wobbly; hoarse, gravelly and breathy; wheezing between phrases; slow, halting, with long pauses; pitch unsteady; every word an effort. Keep this frailty on every sentence.", "[voice of a ninety-year-old, hoarse, cracked, trembling and breathy, slow and halting, wheezing between phrases]"),
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
    "s2.1-pro-free": {"paid": False, "label": "S2.1 Pro — رایگان", "en": "S2.1 Pro — free"},
    "s2.1-pro": {"paid": True, "label": "S2.1 Pro — پولی ($15 / M بایت)", "en": "S2.1 Pro — paid ($15 / M bytes)"},
    "s2-pro": {"paid": True, "label": "S2 Pro — نسل قبل (پولی)", "en": "S2 Pro — previous generation (paid)"},
    "s1": {"paid": True, "label": "S1 — قدیمی (پولی، بدون چندگوینده)", "en": "S1 — old (paid, no multi-speaker)"},
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
    _net_ready()
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
    audio_limits_check(path)                                        # 182: the import limits on every way in
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
    _net_ready()
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


def _net_ready(status=lambda *a, **k: None):
    """Set up a route before a non-Google request. Never raises, never blocks a
    request that would have worked anyway. (149)"""
    try:
        ensure_route(status)
    except Exception as e:
        _diag("net_route_err", msg=str(e)[:80])


def _fish_call(text, cfg, status):
    _net_ready(status)
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
    rid = body.get("reference_id")
    _diag("fish_take", audio_s=round(len(pcm) / sr, 1), chars=len(text), model=model,
          voice=(rid[:12] if isinstance(rid, str) else ("multi" if rid else "default")))   # 182: which voice (the word check's failures cluster by voice)
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


# ===========================================================================
# 139 · THE LINE INDEX — the audio stops being a track of its own
#
# FIELD: "the transcription and word placement is being mangled on every
# regeneration and it's becoming a track of its own irrespective of what's in
# the text area". True, and structural: every edit re-derived where each line
# lived by aligning a transcript against the stored text. Each splice left the
# audio a little less like that text, and the next alignment was built on the
# previous error. Editing deteriorated as it accumulated.
#
# The app already knows exactly where each line's audio is at the moment it
# splices — it simply threw that away. Now it keeps it:
#
#     entry["lines"] = [{"text": …, "a": sample, "b": sample, "voice": {…}}]
#
# An edit is then BOOKKEEPING on that index, not forensics: a text diff says
# which lines survive (their audio is kept, byte for byte, with its own voice),
# which are gone (dropped) and which must be made. No alignment, no drift.
# Generation still happens in runs with context, so cost and prosody are
# unchanged.
# ===========================================================================

def _fade_edges(p, sr, ms=6):
    """A 6 ms fade at both ends of a piece so plain concatenation never clicks. (140)"""
    n = min(int(sr * ms / 1000), len(p) // 2)
    if n <= 0:
        return p
    q = p.astype(np.float32)
    ramp = np.linspace(0.0, 1.0, n, dtype=np.float32)
    q[:n] *= ramp; q[-n:] *= ramp[::-1]
    return q.astype(np.int16)


def line_index(entry):
    return entry.get("lines") or []


def _cuts_from_word_spans(pcm, sr, clauses, words):
    """Boundaries from each clause's own matched words: cut midway between the
    end of one clause's last matched word and the start of the next clause's
    first. Tolerates unmatched clauses by interpolating. (141)"""
    if not words:
        return None
    import difflib
    ours, owner = [], []
    for k, (c, _) in enumerate(clauses):
        ws = _text_words(c); ours += ws; owner += [k] * len(ws)
    words = _merge_split_words(ours, words)               # 143: ZWNJ compounds
    tw = [_norm_word(w) for w, _, _ in words]
    sm = difflib.SequenceMatcher(None, ours, tw, autojunk=False)
    m2t = {}
    for a, b, n in sm.get_matching_blocks():
        for i in range(n):
            m2t[a + i] = b + i
    if len(m2t) < 0.4 * len(ours):
        return None
    ends, starts = {}, {}
    for i, k in enumerate(owner):
        if i in m2t:
            starts.setdefault(k, words[m2t[i]][1]); ends[k] = words[m2t[i]][2]
    cuts = []
    for k in range(len(clauses) - 1):
        e, s_ = ends.get(k), starts.get(k + 1)
        if e is not None and s_ is not None and s_ >= e:
            cuts.append(int((e + s_) / 2 * sr))
        elif e is not None:
            cuts.append(int((e + 0.05) * sr))
        elif s_ is not None:
            cuts.append(int(max(0.0, s_ - 0.05) * sr))
        else:
            cuts.append(None)
    known = [c for c in cuts if c is not None]
    if not known:
        return None
    for k in range(len(cuts)):                       # interpolate the unknown ones
        if cuts[k] is None:
            lo = max([c for c in cuts[:k] if c is not None], default=0)
            hi = min([c for c in cuts[k + 1:] if c is not None], default=len(pcm))
            cuts[k] = (lo + hi) // 2
    if any(cuts[k] >= cuts[k + 1] for k in range(len(cuts) - 1)) or cuts[-1] >= len(pcm):
        return None
    _diag("g_boundaries", need=len(cuts), mode="word_spans", ms=[int(c * 1000 / sr) for c in cuts])
    return [_zc_snap(pcm, c, sr) for c in cuts]


def _clause_speakers(text, cfg):
    """{clause index: character voice} for clauses on a labelled line. (152)"""
    cast = g38_cast(cfg) if _is_g38(cfg) else {}
    if not cast:
        return {}
    out, pos, spk_at = {}, 0, []
    for raw in text.split("\n"):
        m = _LABEL_RE.match(raw)
        name = raw[:m.end()].strip().rstrip(":：").strip() if m else None
        spk_at.append((pos, pos + len(raw), cast[name]["voice"] if name in cast else None))
        pos += len(raw) + 1
    for k, (c, (a, b)) in enumerate(_g_clauses(text)):
        for lo, hi, v in spk_at:
            if lo <= a < hi + 1 and v:
                out[k] = v; break
    return out


def build_line_index(entry, text, pcm, sr, cfg, status, lang=None):
    """Split a freshly generated part into per-line audio once, using the clause
    boundaries the app already computes. Falls back to a single line covering
    everything, which behaves exactly like the old single blob."""
    cl = _g_clauses(text)
    voice = {k: cfg[k] for k in ("g_voice", "g_preset", "g_age", "g_state",
                                 "f_voice", "f_preset", "f_age", "f_state") if k in cfg}
    if len(cl) < 2:
        entry["lines"] = [{"text": text.strip(), "a": 0, "b": len(pcm), "voice": voice}]
        return entry["lines"]
    words = transcribe_words(pcm, sr, status, lang, text, cfg)
    cuts = _g_bounds(pcm, sr, cl, status, lang, cfg, text, words)
    if not cuts or len(cuts) != len(cl) - 1:
        cuts = _cuts_from_word_spans(pcm, sr, cl, words)
    if not cuts or len(cuts) != len(cl) - 1:
        entry["lines"] = [{"text": text.strip(), "a": 0, "b": len(pcm), "voice": voice}]
        _diag("line_index", mode="single", reason="no_boundaries")
        status("مرز جمله‌های این بخش پیدا نشد؛ ویرایشِ جزئی روی آن کل بخش را دوباره می‌سازد.")
        return entry["lines"]
    edges = [0] + [max(0, min(int(c), len(pcm))) for c in cuts] + [len(pcm)]
    spk = _clause_speakers(text, cfg)
    lines = []
    for k, (c, _) in enumerate(cl):
        v = dict(voice)
        if spk.get(k):
            v["g_voice"] = spk[k]                                   # 152: a character's own voice
        lines.append({"text": c.strip(), "a": edges[k], "b": edges[k + 1], "voice": v})
    entry["lines"] = lines
    _diag("line_index", lines=len(lines), ms=[int((l["b"] - l["a"]) * 1000 / sr) for l in lines][:8])
    return lines


def _split_lines_audio(entry, pcm, sr, old_lines, new_clauses, status):
    """Split the audio of old_lines (contiguous, same words) into one piece per
    new clause, at word timings. Returns [(pcm, voice)] or None. (141)"""
    a, b = old_lines[0]["a"], old_lines[-1]["b"]
    seg = pcm[a:b]
    if len(seg) < sr * 0.1:
        return None
    if len(new_clauses) == 1:
        return [(seg, dict(old_lines[0].get("voice") or {}))]
    joined = "\n".join(c[0].strip() for c in new_clauses)
    words = transcribe_words(seg, sr, status, None, joined, entry.get("payload") or {})
    cl_ = [(c[0], c[1]) for c in new_clauses]
    if _align_ratio(cl_, words) < 0.4:
        _diag("patch_lines", note="slice_refused_weak_transcript")
        return None                                   # → each new line is made on its own (144)
    cuts = _g_bounds(seg, sr, cl_, status, None, entry.get("payload") or {}, joined, words)
    need = len(new_clauses) - 1
    if not cuts or len(cuts) != need:
        cuts = _cuts_from_word_spans(seg, sr, cl_, words)
    if not cuts or len(cuts) != need:
        cuts = _cuts_proportional_at_silence(seg, sr, cl_)
        _diag("patch_lines", note="slice_by_proportion")
    if not cuts or len(cuts) != need:
        return None
    edges = [0] + [max(0, min(int(c), len(seg))) for c in cuts] + [len(seg)]
    # which old line did each new clause come from (by cumulative word count)?
    out, k_old, consumed = [], 0, 0
    o_counts = [len(_text_words(l["text"])) for l in old_lines]
    for i, (c, _) in enumerate(new_clauses):
        n = len(_text_words(c))
        while k_old < len(old_lines) - 1 and consumed + n > sum(o_counts[:k_old + 1]):
            k_old += 1
        consumed += n
        out.append((seg[edges[i]:edges[i + 1]], dict(old_lines[k_old].get("voice") or {})))
    return out


def _align_ratio(clauses, words):
    """How much of the text the transcript actually accounts for. (146)"""
    if not words:
        return 0.0
    import difflib
    ours = [w for c, _ in clauses for w in _text_words(c)]
    words = _merge_split_words(ours, words)
    tw = [_norm_word(w) for w, _, _ in words]
    if not ours or not tw:
        return 0.0
    sm = difflib.SequenceMatcher(None, ours, tw, autojunk=False)
    return sum(b.size for b in sm.get_matching_blocks()) / len(ours)


def _cuts_proportional_at_silence(seg, sr, clauses):
    """Cut points for clauses known to be inside `seg`, placed at the silence
    nearest each clause's proportional position by character count. A choice of
    cut point, never an invention of content. (143)"""
    if len(clauses) < 2 or len(seg) < sr * 0.2:
        return None
    total = max(1, sum(_g_speech_len(c) for c, _ in clauses))
    runs = _silence_runs(seg, sr, min_ms=40)
    cuts, acc = [], 0
    for c, _ in clauses[:-1]:
        acc += _g_speech_len(c)
        guess = int(len(seg) * acc / total)
        cand = [r for r in runs if abs(r[2] - guess) < sr * 0.6]
        cuts.append(min(cand, key=lambda r: abs(r[2] - guess))[2] if cand else guess)
    cuts = [max(1, min(c, len(seg) - 1)) for c in cuts]
    if any(cuts[k] >= cuts[k + 1] for k in range(len(cuts) - 1)):
        return None
    return cuts


def _lines_pcm(entry, pcm):
    """The audio of each indexed line, in order."""
    return [pcm[max(0, l["a"]):max(0, l["b"])] for l in line_index(entry)]


def patch_by_lines(entry, new_text, sel_start, sel_end, cfg, status, call):
    """Rebuild a part from its line index. Returns the number of lines generated,
    or None when the index cannot be used (caller falls back)."""
    old = line_index(entry)
    if not old:
        return None
    pcm, sr = entry["items"][0]["pcm"], entry["sr"]
    nc = _g_clauses(new_text)
    if not nc:
        return None
    import difflib
    ot = [_norm_word(" ".join(_text_words(l["text"]))) for l in old]
    nt = [_norm_word(" ".join(_text_words(c))) for c, _ in nc]
    sm = difflib.SequenceMatcher(None, ot, nt, autojunk=False)

    plan = [None] * len(nc)                      # ("keep", old_idx) | ("make", voice) | ("slice", pcm, voice)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            for off in range(i2 - i1):
                plan[j1 + off] = ("keep", i1 + off)
        elif tag == "replace" and "".join(ot[i1:i2]) == "".join(nt[j1:j2]):
            # same words, different line breaks → split the existing audio
            pieces = _split_lines_audio(entry, pcm, sr, old[i1:i2], nc[j1:j2], status)
            if pieces is not None:
                for off, (piece, voice) in enumerate(pieces):
                    plan[j1 + off] = ("slice", piece, voice)
                _diag("patch_lines", note=f"resegmented_{i2 - i1}_to_{j2 - j1}_without_generation")
                continue
            for j in range(j1, j2):                  # could not slice: each becomes its own unit
                src = old[min(i1 + (j - j1), i2 - 1)]
                plan[j] = ("make", dict(src.get("voice") or {}), "solo")
            _diag("patch_lines", note=f"split_{i2 - i1}_to_{j2 - j1}_unsliceable_each_line_solo")
        else:
            for j in range(j1, j2):
                # a changed line inherits the voice of the old line it replaces,
                # or of its nearest neighbour — never the currently selected one
                src = None
                if i1 < len(old):
                    src = old[min(i1 + (j - j1), len(old) - 1)]
                elif old:
                    src = old[-1]
                plan[j] = ("make", dict((src or {}).get("voice") or {}))

    # the selection is the conscious choice: those lines take the CURRENT voice
    chosen = set()
    if sel_start is not None and sel_end is not None and sel_end > sel_start:
        cur = {k: cfg[k] for k in ("g_voice", "g_preset", "g_age", "g_state",
                                   "f_voice", "f_preset", "f_age", "f_state") if k in cfg}
        for k, (c, span) in enumerate(nc):
            if span[0] < sel_end and span[1] > sel_start:
                plan[k] = ("make", cur); chosen.add(k)
    # 152: a line spoken by a cast character is always made in that character's
    # voice — change the character's voice in the cast to re-voice its lines
    for k, v in _clause_speakers(new_text, cfg).items():
        if k < len(plan) and plan[k] and plan[k][0] == "make":
            plan[k] = ("make", {**(plan[k][1] or {}), "g_voice": v}) + tuple(plan[k][2:])
    # a line with no remembered voice inherits the PART's base voice, never the
    # currently selected one (141: a third sentence came back in the new voice)
    base_v = {k2: v2 for k2, v2 in (entry.get("payload") or {}).items()
              if k2 in ("g_voice", "g_preset", "g_age", "g_state", "f_voice", "f_preset", "f_age", "f_state")}
    for k in range(len(nc)):
        if plan[k] and plan[k][0] == "make" and k not in chosen and not plan[k][1]:
            plan[k] = ("make", dict(base_v)) + tuple(plan[k][2:])   # 145: keep "solo"
    if not any(p and p[0] == "make" for p in plan):
        return 0                                  # nothing to do

    # group consecutive "make" lines that share a voice into one request
    runs, k = [], 0
    def _solo(p):
        return p[0] == "make" and len(p) > 2 and p[2] == "solo"
    while k < len(nc):
        if plan[k][0] != "make":
            k += 1; continue
        v = plan[k][1]; a = k
        if not _solo(plan[k]):
            while (k + 1 < len(nc) and plan[k + 1][0] == "make" and plan[k + 1][1] == v
                   and not _solo(plan[k + 1])):
                k += 1
        runs.append((a, k + 1, v)); k += 1

    base = {k2: (entry.get("payload") or {}).get(k2) for k2 in ("g_voice", "f_voice")}
    made = {}
    for a, b, v in runs:
        same = all((v or {}).get(k2, base.get(k2)) == base.get(k2) for k2 in ("g_voice", "f_voice"))
        solo = b - a == 1 and _solo(plan[a])
        ctx_b = nc[a - 1][0].strip() if (a > 0 and same and not solo) else ""
        ctx_a = nc[b][0].strip() if (b < len(nc) and same and not solo) else ""
        mid = "\n".join(c[0].strip() for c in nc[a:b])
        gtext = "\n".join(x for x in (ctx_b, mid, ctx_a) if x)
        status(f"ساختِ {faDigits(b - a)} خط…")
        npcm, nsr = call(gtext, {**cfg, **(v or {}), "_no_audit": True}, status)
        gcl = _g_clauses(gtext)
        p0 = 1 if ctx_b else 0
        want = p0 + (b - a) + (1 if ctx_a else 0)
        seg_cuts = None
        if len(gcl) == want and want > 1:
            seg_cuts = _g_bounds(npcm, nsr, gcl, status, None, cfg, gtext)
        if nsr != sr:
            npcm = _resample(npcm, nsr, sr)
            seg_cuts = [int(c * sr / nsr) for c in seg_cuts] if seg_cuts else None
        if want == 1:
            made[a] = npcm            # no context and one line: the take IS the target
        elif seg_cuts and len(seg_cuts) == want - 1:
            edges = [0] + seg_cuts + [len(npcm)]
            for off in range(b - a):
                made[a + off] = npcm[edges[p0 + off]:edges[p0 + off + 1]]
        else:
            # 139: boundaries unavailable. Handing the whole take — CONTEXT AND
            # ALL — to the first line is how a sentence ends up spoken twice
            # (field: «پیش‌گفتار» heard twice). Take the run again WITHOUT any
            # context, so the whole recording IS the target and nothing can
            # bleed in.
            _diag("patch_lines", note="run_boundaries_unfound_retaking_without_context")
            npcm2, nsr2 = call(mid, {**cfg, **(v or {}), "_no_audit": True}, status)
            if nsr2 != sr:
                npcm2 = _resample(npcm2, nsr2, sr)
            cuts2 = _g_bounds(npcm2, sr, _g_clauses(mid), status, None, cfg, mid) if b - a > 1 else []
            if b - a > 1 and cuts2 and len(cuts2) == (b - a) - 1:
                e2 = [0] + [int(c) for c in cuts2] + [len(npcm2)]
                for off in range(b - a):
                    made[a + off] = npcm2[e2[off]:e2[off + 1]]
            elif b - a == 1:
                made[a] = npcm2
            else:
                _diag("patch_lines", note=f"run_of_{b - a}_made_line_by_line")
                for off in range(b - a):
                    one, osr = call(nc[a + off][0].strip(), {**cfg, **(v or {}), "_no_audit": True}, status)
                    made[a + off] = _resample(one, osr, sr) if osr != sr else one

    # assemble in text order — kept audio is byte-identical, made audio is new
    out, lines, at = [], [], 0
    gap = np.zeros(int(sr * 0.10), dtype=np.int16)
    for k2, (c, _) in enumerate(nc):
        if plan[k2][0] == "make":
            piece = made.get(k2)
        elif plan[k2][0] == "slice":
            piece = plan[k2][1]
        else:
            piece = pcm[old[plan[k2][1]]["a"]:old[plan[k2][1]]["b"]]
        if piece is None:
            piece = np.zeros(0, dtype=np.int16)
        if out:
            out.append(gap); at += len(gap)
        a0 = at
        out.append(piece); at += len(piece)
        voice = plan[k2][1] if plan[k2][0] == "make" else (plan[k2][2] if plan[k2][0] == "slice" else old[plan[k2][1]]["voice"])
        lines.append({"text": c.strip(), "a": a0, "b": at, "voice": dict(voice or {})})
    pieces = [_fade_edges(p, sr) for p in out if len(p)]
    joined = np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.int16)
    # 140: offsets are EXACT — the map is computed from the same pieces that
    # were concatenated, with no rescaling and no crossfade to shift them
    entry["items"][0]["pcm"] = joined
    entry["items"][0]["text"] = new_text
    entry["items"][0]["span"] = (0, len(new_text))
    entry["text"] = new_text
    entry["lines"] = lines
    entry["voices"] = {}                      # 140: the line index is the ONE voice record
    ensure_line_index(entry, status)          # 142: the result is checked against the text too
    n_made = sum(1 for p in plan if p[0] == "make")
    _diag("patch_lines", made=n_made, kept=len(nc) - n_made, chosen=len(chosen), runs=len(runs))
    return n_made


# ===========================================================================
# 142 · THE MAP IS CHECKED AGAINST THE TEXT — reject, never author
#
# The text area is authoritative for WHAT exists and in WHAT ORDER. It cannot
# say WHERE a line's audio is, but it can say when a map is impossible:
#   · a line that exists has audio            (a 0-sample range is wrong)
#   · ranges are ordered, disjoint, in bounds  (a hole or an overlap is wrong)
#   · a line's share of the duration follows   (a 6-word line at 1.6 s beside a
#     its share of the words, loosely           1-word line at 2.5 s is wrong)
# The rule that keeps this from hallucinating: the text may REJECT a map, it
# may never AUTHOR one. A rejected map is rebuilt from the transcript by the
# second route; if that fails too, the map is marked untrusted and the next
# edit rebuilds the part with a visible message — never a cut on a map the
# app knows is wrong.
# ===========================================================================
MAP_MAX_SKEW = 4.0        # a line may be at most 4× longer or shorter than its word share implies


def validate_line_index(entry, pcm=None, sr=None):
    """Return [] when the map is consistent with the text, else the reasons."""
    lines = entry.get("lines") or []
    pcm = entry["items"][0]["pcm"] if pcm is None else pcm
    sr = entry["sr"] if sr is None else sr
    if not lines or pcm is None:
        return ["no_map"]
    n = len(pcm)
    bad = []
    cl = _g_clauses(entry.get("text") or "")
    if len(cl) != len(lines):
        bad.append(f"line_count_{len(lines)}_vs_text_{len(cl)}")
    prev_b = 0
    for k, l in enumerate(lines):
        a, b = int(l.get("a", 0)), int(l.get("b", 0))
        words = len(_text_words(l.get("text") or ""))
        if a < 0 or b > n or b < a:
            bad.append(f"line{k}_out_of_bounds"); continue
        if a < prev_b:
            bad.append(f"line{k}_overlaps_previous")
        prev_b = b
        if words and b - a < int(sr * 0.12):
            bad.append(f"line{k}_empty_for_{words}_words")
    total_words = sum(len(_text_words(l.get("text") or "")) for l in lines) or 1
    spoken = sum(max(0, int(l["b"]) - int(l["a"])) for l in lines) or 1
    for k, l in enumerate(lines):
        words = len(_text_words(l.get("text") or ""))
        if words < 3:
            continue                                      # too short to judge by proportion
        share = words / total_words
        got = max(0, int(l["b"]) - int(l["a"])) / spoken
        if got > 0 and (got / share > MAP_MAX_SKEW or share / got > MAP_MAX_SKEW):
            bad.append(f"line{k}_duration_skew_{got/share:.1f}x")
    if lines and int(lines[-1]["b"]) < n * 0.6:
        bad.append("map_covers_less_than_60pct")
    return bad


def ensure_line_index(entry, status, cfg=None, lang=None):
    """Validate the map; if it is wrong, rebuild it by the second route; if that
    fails, mark it untrusted. Returns True when the map can be used for a cut."""
    bad = validate_line_index(entry)
    if not bad:
        entry.pop("map_untrusted", None)
        return True
    _diag("line_map_rejected", reasons=",".join(bad)[:120])
    pcm, sr = entry["items"][0]["pcm"], entry["sr"]
    text = entry.get("text") or ""
    cl = _g_clauses(text)
    try:
        words = transcribe_words(pcm, sr, status, lang, text, cfg or entry.get("payload") or {})
        cuts = _cuts_from_word_spans(pcm, sr, cl, words) if len(cl) > 1 else []
        if cuts is not None and len(cuts) == len(cl) - 1:
            edges = [0] + [max(0, min(int(c), len(pcm))) for c in cuts] + [len(pcm)]
            old_voice = {}
            if entry.get("lines"):
                old_voice = {l["text"]: l.get("voice") for l in entry["lines"]}
            base = {k: v for k, v in (entry.get("payload") or {}).items()
                    if k in ("g_voice", "g_preset", "g_age", "g_state", "f_voice", "f_preset", "f_age", "f_state")}
            entry["lines"] = [{"text": c.strip(), "a": edges[k], "b": edges[k + 1],
                               "voice": dict(old_voice.get(c.strip()) or base)} for k, (c, _) in enumerate(cl)]
            bad2 = validate_line_index(entry)
            if not bad2:
                _diag("line_map_rebuilt", lines=len(cl))
                entry.pop("map_untrusted", None)
                return True
            _diag("line_map_rejected", reasons="after_rebuild:" + ",".join(bad2)[:100])
    except Exception as e:
        _diag("line_map_rebuild_err", msg=str(e)[:80])
    entry["map_untrusted"] = True
    status("نقشهٔ جمله‌های این بخش قابل‌اعتماد نیست؛ ویرایش بعدی از روی رونویسیِ تازه انجام می‌شود، و اگر نشد کل بخش دوباره ساخته می‌شود.")
    return False


# ===========================================================================
# 148 · FINDING A ROUTE TO GOOGLE THROUGH THE USER'S VPN
#
# For users in Iran a VPN is not optional, so "the network is blocked" is the
# most common way the app fails, not an edge case. Three facts shaped this:
#   · the app honours a Windows STATIC system proxy (requests reads the registry)
#   · it does NOT honour a PAC proxy (AutoConfigURL) — many clients default to it,
#     so the browser works while the app goes out directly and is refused
#   · without PySocks it cannot use a SOCKS-only proxy
# Popular clients all expose a local proxy on a known 127.0.0.1 port. The route
# finder tries, in order: the current route (env / system proxy), each local
# proxy port that is listening (HTTP, then SOCKS), and finally a direct
# connection (which is the VPN itself when the client runs in TUN mode). Each is
# tested against Google with a deliberately invalid key — a reachable, allowed
# route answers JSON «API key not valid», a blocked one answers Google's HTML 403
# — so testing spends no quota. The first route that works is applied to the
# whole process through the standard proxy environment variables, which
# requests and huggingface_hub both honour.
#
# Safety: only loopback addresses and Google itself are ever contacted.
# ===========================================================================
LOCAL_PROXY_PORTS = [
    (10809, "http", "v2rayN"), (10808, "socks5h", "v2rayN"),
    (2080, "http", "Nekoray/Nekobox"), (2080, "socks5h", "Nekoray/Nekobox"),
    (7890, "http", "Clash"), (7890, "socks5h", "Clash"),
    (12334, "http", "Hiddify"), (12334, "socks5h", "Hiddify"),
    (20171, "http", "v2rayA"), (20170, "socks5h", "v2rayA"),
    (1080, "socks5h", "SOCKS"), (8889, "http", "HTTP"),
    # 149: Tor last — slowest, and Google blocks most Tor exits; tried, never assumed
    (9150, "socks5h", "Tor Browser"), (9050, "socks5h", "Tor"),
]
_NET = {"route": None, "label": "", "checked": 0.0, "failed": {}}
_ENV_AT_START = {k: os.environ.get(k) for k in _PROXY_ENV + ("NO_PROXY", "no_proxy")} if False else None


def _snapshot_env():
    """The proxy environment exactly as the app found it, taken once. (149)"""
    global _ENV_AT_START
    if _ENV_AT_START is None:
        _ENV_AT_START = {k: os.environ.get(k) for k in _PROXY_ENV + ("NO_PROXY", "no_proxy")}
    return _ENV_AT_START


def _restore_env():
    """Undo every route the app applied, leaving the user's own settings intact. (149)"""
    for k, v in _snapshot_env().items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
_PROBE_URL = "https://generativelanguage.googleapis.com/v1beta/models?key=AIza-ava-route-probe-not-a-key"
_PROXY_ENV = ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "https_proxy", "http_proxy", "all_proxy")


def net_settings():
    st = settings_get() or {}
    mode = st.get("net_mode") or "auto"
    return {"mode": mode if mode in ("auto", "system", "custom", "direct") else "auto",
            "custom": (st.get("net_custom") or "").strip()}


def _port_open(port, timeout=0.15):
    import socket
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except Exception:
        return False


def _socks_ok():
    try:
        import socks  # noqa: F401  (PySocks)
        return True
    except Exception:
        return False


def _probe_route(proxy_url, timeout=6.0):
    """Test one route against Google without spending quota.
    Returns "ok", "blocked", "region" or "unreachable"."""
    s = requests.Session()
    s.trust_env = False                          # test THIS route, not whatever the env says
    proxies = {"http": proxy_url, "https": proxy_url} if proxy_url else {}
    try:
        r = s.get(_PROBE_URL, proxies=proxies, timeout=timeout)
    except Exception as e:
        _diag("net_probe", route=proxy_url or "direct", result="unreachable", err=type(e).__name__)
        return "unreachable"
    body = (r.text or "")[:400].lower()
    if "<html" in body or "<!doctype" in body:
        res = "blocked"
    elif "location is not supported" in body or "user location" in body:
        res = "region"
    elif r.status_code in (400, 401, 403) and ("api key" in body or "api_key" in body):
        res = "ok"                              # reached the API, which rejected our fake key: the route works
    elif r.status_code == 200:
        res = "ok"
    else:
        res = "blocked"
    _diag("net_probe", route=proxy_url or "direct", result=res, code=r.status_code)
    return res


def _current_route():
    """The proxy the process would use right now (env, else Windows static proxy)."""
    import urllib.request
    p = urllib.request.getproxies()
    return p.get("https") or p.get("http") or None


def _apply_route(proxy_url):
    """Make every outbound request in the process use this route."""
    _snapshot_env()
    for k in _PROXY_ENV:
        os.environ.pop(k, None)
    if proxy_url:
        for k in ("HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"):
            os.environ[k] = proxy_url
        os.environ.pop("NO_PROXY", None); os.environ.pop("no_proxy", None)
    else:
        os.environ["NO_PROXY"] = "*"             # direct: also bypass a registry proxy
        os.environ["no_proxy"] = "*"


def _candidates():
    """Routes in the order they are tried. A mode the user picked puts its route
    FIRST — it is never the only one tried. (149: a manual proxy saved in Iran
    must not imprison someone who later uses the app abroad with no VPN.)"""
    ns = net_settings()
    out, seen = [], set()
    def add(url, label):
        key = url or "direct"
        if key not in seen:
            out.append((url, label)); seen.add(key)
    cur = _current_route()
    # 150: a proxy the user explicitly chose goes first; otherwise NO VPN goes first —
    # the app must work with no VPN at all, and after any failure the VPN may simply
    # have been switched off.
    if ns["mode"] == "custom" and ns["custom"]:
        add(ns["custom"], "پروکسیِ دستی")
    elif ns["mode"] == "system" and cur:
        add(cur, "پروکسیِ سیستم")
    add(None, "مستقیم")
    if cur:
        add(cur, "پروکسیِ سیستم")
    socks = _socks_ok()
    for port, scheme, client in LOCAL_PROXY_PORTS:
        if scheme.startswith("socks") and not socks:
            continue
        url = f"{scheme}://127.0.0.1:{port}"
        if url in seen or not _port_open(port):
            continue
        add(url, f"{client} ({port})")
    return out


PROBE_TIMEOUT = 4.0          # 150: seconds for the whole parallel search, not per route
BENCH_SECONDS = 60.0         # 150: a failed route sits out this long — VPNs are switched often
import threading as _threading
_NET_LOCK = _threading.Lock()


def _benched(key):
    import time as _t
    return _t.time() - (_NET["failed"].get(key, 0) if isinstance(_NET["failed"], dict) else 0) < BENCH_SECONDS


def _bench(key):
    import time as _t
    if not isinstance(_NET["failed"], dict):
        _NET["failed"] = {}
    _NET["failed"][key] = _t.time()


def ensure_route(status=lambda *a, **k: None, force=False):
    """Find and apply a working route to Google. Returns (ok, label, report).
    150: all routes are probed at once; priority is their order; a failed route is
    benched for a minute, not for the session."""
    import time as _t
    with _NET_LOCK:
        if _NET["route"] is not None and not force and _t.time() - _NET["checked"] < 1800:
            return True, _NET["label"], []
        if not isinstance(_NET["failed"], dict):
            _NET["failed"] = {}
        cands = _candidates()
        # direct is NEVER benched: after any failure the VPN may simply be off, and it
        # costs nothing to ask — every route is probed in parallel
        live = [(u, l) for u, l in cands if u is None or not (force and _benched(u or "direct"))]
        if not live:                           # everything benched: try them all again
            live = cands
        status("شبکه: دنبالِ مسیرِ کارآمد می‌گردم…")
        results = [None] * len(live)
        done = _threading.Event()

        def run(i, url):
            results[i] = _probe_route(url, timeout=PROBE_TIMEOUT)
            # decide as soon as the best possible answer is known
            for j, r in enumerate(results):
                if r is None:
                    return
                if r == "ok":
                    done.set(); return
            done.set()

        threads = [_threading.Thread(target=run, args=(i, u), daemon=True) for i, (u, _) in enumerate(live)]
        for th in threads:
            th.start()
        done.wait(PROBE_TIMEOUT + 1.0)
        report, verdicts = [], set()
        chosen = None
        for i, (url, label) in enumerate(live):
            r = results[i] or "unreachable"    # not back in time counts as unreachable
            report.append((label, r)); verdicts.add(r)
            if r == "ok" and chosen is None:
                chosen = (url, label)
            elif r != "ok":
                _bench(url or "direct")
        if chosen:
            url, label = chosen
            _apply_route(url)
            _NET.update(route=url or "", label=label, checked=_t.time())
            _diag("net_route", chosen=url or "direct", label=label, tried=len(live))
            return True, label, report
        _restore_env()                         # 149: never leave a dead route applied
        _NET.update(route=None, label="", checked=0.0)
        _diag("net_route", chosen="none", tried=len(report), verdicts=",".join(sorted(verdicts)))
        return False, "", report


def net_status_text(ok, label, report):
    ns = net_settings()
    chosen = {"custom": "پروکسیِ دستی", "direct": "مستقیم", "system": "پروکسیِ سیستم"}.get(ns["mode"])
    if ok:
        note = ""
        if chosen and label != chosen:
            note = f" (مسیرِ انتخابی‌تان، «{chosen}»، جواب نداد؛ برنامه خودش مسیرِ دیگری پیدا کرد.)"
        return f"اتصال به گوگل برقرار است — از راهِ «{label}».{note}"
    if not report:
        return "هیچ مسیری برای امتحان پیدا نشد."
    if all(r == "unreachable" for _, r in report):
        return ("به گوگل نرسیدیم: اینترنت وصل نیست، یا — اگر در کشوری هستید که گوگل را محدود کرده، مثل ایران — "
                "فیلترشکن وصل نیست. اگر فیلترشکن روشن است، آن را روی حالتِ TUN بگذارید.")
    if any(r == "region" for _, r in report):
        return "گوگل این سرویس را برای کشورِ فعلیِ فیلترشکن ارائه نمی‌دهد؛ سروری در اروپا یا آمریکای شمالی انتخاب کنید."
    return ("گوگل نشانیِ فعلیِ فیلترشکن را مسدود کرده است؛ سرور یا کشورِ دیگری انتخاب کنید، "
            "یا فیلترشکن را روی حالتِ TUN بگذارید.")


def warm_route():
    """Find a route in the background at launch — never blocks, never raises. (150)"""
    def go():
        try:
            ensure_route()
        except Exception as e:
            _diag("net_route_err", msg=str(e)[:80])
    _threading.Thread(target=go, daemon=True).start()


# ===========================================================================
# 151 · THE GEMINI 3.8 TTS FORK (gemini-3.8-flash-tts / gemini-3.8-flash-lite-tts)
#
# Everything here runs only when _is_g38(model) is true; 3.1 and 2.5 are
# untouched. The 3.8 rules, from Google's documentation:
#   · the text is a VERBATIM transcript — directions in it would be READ ALOUD;
#   · sustained delivery goes in parts[].speech_metadata.style — SHORT, and the
#     same string reused across turns for a consistent baseline;
#   · long "Audio Profile"/"Director's Notes" blocks are "the most common cause
#     of voice drift" — which is exactly what the 3.1 director layer sends;
#   · age, gender and accent are voice traits, not style: choose a voice;
#   · point-in-time sounds are inline angle-bracket tags, in English, even for
#     Persian text: <laugh>, <sigh>, <short pause> …;
#   · the voice is speechConfig.voiceConfig.voice: a prebuilt name, a Voice
#     Library id, or a voice_… / voicekey_… of a designed or replicated voice.
# ===========================================================================
G38_TAGS = ["<argh>", "<breath>", "<heavy breath>", "<exhales>", "<cackle>", "<cheer>", "<chuckle>", "<cough>", "<cry>", "<gasp>",
            "<giggle>", "<groan>", "<growl>", "<grunt>", "<hiss>", "<laugh>", "<laughter>", "<moan>", "<pant>", "<phew>", "<scream>",
            "<shout>", "<shriek>", "<sigh>", "<sneeze>", "<snicker>", "<snort>", "<sob>", "<throat-clearing>", "<tsk>", "<whimper>",
            "<whispers>", "<yawn>", "<short pause>", "<long pause>"]   # 159: Google's recommended list
# Ava's older bracket tags → 3.8's inline vocal tags
# 153: ONLY the inline tags Google documents for 3.8 — <laugh> <sigh> <gasp> <cough> <breath> <short pause>.
# Laughter variants become <laugh>; a long pause becomes two documented short pauses; delivery cues
# (whispering, crying, sobbing…) and undocumented sounds are dropped here — on 3.8 delivery belongs in
# the style, and an unknown tag may be read aloud or ignored.
# 159: Google's prompting guide (updated 2026-10-01) recommends these angle-bracket vocal tags for 3.8,
# including <long pause> — build 153 had cut the list to six from an older page; restored here.
_G38_TAG_MAP = {"laughs": "<laugh>", "laugh": "<laugh>", "laughing": "<laughter>", "chuckles": "<chuckle>", "giggles": "<giggle>",
                "sighs": "<sigh>", "sigh": "<sigh>", "gasps": "<gasp>", "gasp": "<gasp>", "coughs": "<cough>", "cough": "<cough>",
                "crying": "<cry>", "cries": "<cry>", "sobbing": "<sob>", "whispers": "<whispers>", "whispering": "<whispering>",
                "breath": "<breath>", "breathes": "<breath>", "short pause": "<short pause>", "long pause": "<long pause>",
                "yawns": "<yawn>", "groans": "<groan>", "screams": "<scream>", "shouting": "<shout>", "sneezes": "<sneeze>"}
# 151: the 3.8 style is DERIVED from the lists the app already has, so every
# reading style and every mood works on 3.8 with nothing new to maintain:
#   · a mood contributes its short English tag  ("[sobbing hard][gasping]" →
#     "sobbing hard, gasping");
#   · a reading style contributes the head of its profile ("Broadcast news
#     bulletin. Formal register, …" → "Broadcast news bulletin, formal register").
# "Plain reading" contributes nothing — Google: test plain TTS first.


def _g38_state_style(key, custom=""):
    if key == "custom":
        return (custom or "").strip()
    for row in DIRECTOR_STATES:
        if row[0] == key and key:
            return ", ".join(x.strip() for x in re.findall(r"\[([^\]]+)\]", row[4]) if x.strip())
    return ""


def _g38_preset_style(key, custom=""):
    if key == "custom":
        return (custom or "").strip()
    if not key or key == "neutral":
        return ""
    prof = GOOGLE_PRESETS.get(key, "")
    sents = [x.strip() for x in re.split(r"(?<=[.!?])\s+", prof) if x.strip()]
    if not sents:
        return ""
    head = sents[0].rstrip(".")
    if len(sents) > 1:
        head += ", " + sents[1].split(",")[0].rstrip(".").lower()
    return head[:80]


def g38_text(text):
    """The verbatim transcript 3.8 expects: Ava's pause markers and bracket tags
    become 3.8's angle-bracket vocal tags; bracket tags that are DELIVERY rather
    than a sound ([slow], [excited]…) are removed — on 3.8 they belong in style,
    and in the text they would be read aloud."""
    t = _G_SPACES.sub(" ", text or "").strip()   # 177: no-break space runs read as hesitations (as in google_text)
    t = re.sub(r"(?:\s*\[(?:short pause|long pause|مکث بلند|مکث)\]\s*)+$", "", t)
    t = re.sub(r"(?:\s*<(?:short pause|long pause)>\s*)+$", "", t)
    t = _G_PAUSE_LONG.sub(" <long pause> ", t)   # 159: documented in Google's prompting guide
    t = _G_PAUSE.sub(" <short pause> ", t)
    def tag(m):
        k = m.group(1).strip().lower()
        return f" {_G38_TAG_MAP[k]} " if k in _G38_TAG_MAP else " "
    t = re.sub(r"\[([^\]\[]{1,40})\]", tag, t)
    t = re.sub(r"\{[^{}\n]{1,60}\}", " ", t)                    # 152: tone markers → style, never spoken
    t = _LABEL_RE.sub("", t)                                       # 152: speaker labels → voice, never spoken
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    return t.strip()


def g38_style(cfg):
    """ONE short delivery string, identical for every part of a document — the
    3.8 recipe for a consistent tone. Age is deliberately NOT included (a voice
    trait: choose a voice)."""
    if "_g38_style" in cfg:
        return (cfg.get("_g38_style") or "")[:160]
    base = _g38_preset_style(cfg.get("g_preset") or "neutral", cfg.get("g_style"))
    mood = _g38_state_style(cfg.get("g_state") or "", cfg.get("g_state_custom"))
    parts = [p for p in (base, mood) if p]
    if cfg.get("g_steady"):   # 177: a line with reactions laid over it never waits for them
        parts.insert(0, "one continuous flow, no pauses mid-sentence")
    return ", ".join(parts)[:160]


def _g38_voice_config(voice):
    return {"voice": voice or "Charon"}


def _g38_legacy_body(text, cfg, voice):
    """generateContent / streamGenerateContent body, per Google's 3.8 schema."""
    speakers = cfg.get("g_speakers") or []
    style = g38_style(cfg)
    if len(speakers) == 2:
        parts = []
        names = [sp.get("name", "") for sp in speakers]
        for line in g38_text(text).split("\n"):
            m = re.match(r"\s*([^:：]{1,24})\s*[:：]\s*(.+)", line)
            if m and m.group(1).strip() in names:
                p = {"text": m.group(2).strip(), "speech_metadata": {"speaker": m.group(1).strip()}}
            elif line.strip():
                p = {"text": line.strip(), "speech_metadata": {"speaker": names[0]}}
            else:
                continue
            if style:
                p["speech_metadata"]["style"] = style
            parts.append(p)
        sc = {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
            {"speaker": sp.get("name", ""), "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": sp.get("voice") or "Charon"}}}
            for sp in speakers]}}
    else:
        part = {"text": g38_text(text)}
        if style:
            part["speech_metadata"] = {"style": style}
        parts = [part]
        sc = {"voiceConfig": _g38_voice_config(voice)}
    return {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "responseFormat": {"audio": {"mimeType": "AUDIO_L16", "sampleRate": 24000}},
                                 "speechConfig": sc}}


def _g38_interactions_body(text, cfg, voice):
    """Interactions API body, per Google's 3.8 examples."""
    style = g38_style(cfg)
    content = {"type": "text", "text": g38_text(text)}
    if style:
        content["annotations"] = [{"type": "speech_metadata", "style": style}]
    return {"model": cfg.get("g_model"),
            "input": [{"type": "user_input", "content": [content]}],
            "response_format": {"type": "audio"},
            "generation_config": {"speech_config": [{"voice": voice or "Charon"}]}}


# ---------------------------------------------------------------------------
# voices: prebuilt names, the Voice Library, and CLONES that follow the key
# ---------------------------------------------------------------------------
_G38_DIR_NAME = "g38_voices"


def _g38_dir():
    d = MODELS_DIR / _G38_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _g38_index_path():
    return _g38_dir() / "index.json"


def _g38_index():
    try:
        return json.loads(_g38_index_path().read_text(encoding="utf-8"))
    except Exception:
        return {"clones": {}}


def _g38_index_write(ix):
    _g38_index_path().write_text(json.dumps(ix, ensure_ascii=False), encoding="utf-8")


def _key_tag(key):
    import hashlib
    return hashlib.sha256((key or "").encode()).hexdigest()[:16]


def _to_wav24k_mono(data_bytes, max_s=None):
    """Any audio file → 24 kHz mono 16-bit WAV bytes, as Google recommends."""
    import io
    pcm, sr = _decode_audio(data_bytes)
    if pcm.ndim > 1:
        pcm = pcm.mean(axis=1).astype(np.int16)
    if sr != 24000:
        pcm = _resample(pcm, sr, 24000)
    if max_s:
        pcm = pcm[: int(24000 * max_s)]
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(24000)
        wf.writeframes(pcm.astype(np.int16).tobytes())
    return buf.getvalue(), len(pcm) / 24000.0


G38_CONSENT_EN = "I am the owner of this voice and I consent to Google using this voice to create a synthetic voice model."


def g38_clone_create(name, ref_path, consent_path, status=lambda *a, **k: None):
    """Store a clone LOCALLY: the reference (10–30 s) and the consent recording.
    Nothing is sent now — the voice is created in each Google project the first
    time a key from that project is used with it."""
    import uuid
    ref_bytes, ref_s = _to_wav24k_mono(Path(ref_path).read_bytes(), max_s=30)
    if ref_s < 10:
        raise RuntimeError(f"صدای نمونه باید دست‌کم 10 ثانیه باشد؛ این {faDigits(round(ref_s, 1))} ثانیه است.")
    con_bytes, con_s = _to_wav24k_mono(Path(consent_path).read_bytes(), max_s=30)
    if con_s < 3:
        raise RuntimeError("صدای اجازه‌نامه خیلی کوتاه است؛ جملهٔ اجازه را کامل بخوانید.")
    cid = uuid.uuid4().hex[:12]
    d = _g38_dir() / cid
    d.mkdir(parents=True, exist_ok=True)
    (d / "reference.wav").write_bytes(ref_bytes)
    (d / "consent.wav").write_bytes(con_bytes)
    ix = _g38_index()
    ix["clones"][cid] = {"name": (name or "صدای من").strip()[:40], "created": time.time(),
                         "ref_s": round(ref_s, 1), "ids": {}}
    _g38_index_write(ix)
    _diag("g38_clone", action="stored", ref_s=round(ref_s, 1))
    out = {"id": cid, "name": ix["clones"][cid]["name"], "ref_s": round(ref_s, 1)}
    if ref_s < 30:                        # 155: Google recreates a voice from about 30 seconds of speech
        out["note"] = f"نمونه {round(ref_s)} ثانیه است؛ گوگل برای ساختنِ صدا حدودِ 30 ثانیه صدا می‌خواهد. با نمونهٔ کوتاه‌تر ممکن است شبیه‌سازی رد شود یا صدا کمتر شبیه شود."
    return out


def g38_clones():
    ix = _g38_index()
    return [{"id": k, "name": v.get("name", ""), "ref_s": v.get("ref_s", 0), "projects": len(v.get("ids", {}))}
            for k, v in sorted(ix["clones"].items(), key=lambda kv: -kv[1].get("created", 0))]


def g38_clone_delete(cid):
    import shutil
    ix = _g38_index()
    ix["clones"].pop(cid, None)
    _g38_index_write(ix)
    shutil.rmtree(_g38_dir() / cid, ignore_errors=True)
    return True


def _g38_create_remote(cid, key, status):
    """Create the clone in the Google project behind this key; returns voice_…"""
    import base64
    d = _g38_dir() / cid
    ref, con = (d / "reference.wav").read_bytes(), (d / "consent.wav").read_bytes()
    body = {"store": True, "voice": {
        "model": "gemini-3.8-flash-tts", "type": "replicated",
        "display_name": ("ava-" + cid)[:40],
        "replicated": {"source_audio": {"mime_type": "audio/wav", "data": base64.b64encode(ref).decode()},
                       "consent_audio": {"mime_type": "audio/wav", "data": base64.b64encode(con).decode()}}}}
    status("صدای شبیه‌سازی‌شده برای این کلید ساخته می‌شود (فقط بارِ اول)…")
    data = _google_post("https://generativelanguage.googleapis.com/v1beta/voices", body, key, timeout=_G_TIMEOUT)
    vid = None
    if isinstance(data, dict):
        vid = data.get("id") or (data.get("voice") or {}).get("id") or data.get("name")
        if isinstance(vid, str) and vid.startswith("voices/"):
            vid = vid.split("/", 1)[1]
    if not vid:
        raise RuntimeError("گوگل صدای شبیه‌سازی را ساخت ولی شناسه‌ای برنگرداند.")
    _diag("g38_clone", action="created_in_project", key=_key_tag(key)[:6])
    return vid


def g38_resolve_voice(cfg, key, status=lambda *a, **k: None):
    """The voice string for THIS key: clones are created in the key's project on
    first use and remembered; library ids and prebuilt names pass through."""
    v = (cfg.get("g_voice") or "Charon").strip()
    if v.startswith("lib:"):
        return v[4:]
    if v.startswith("design:"):
        d = _g38_index().get("designs", {}).get(v[7:])
        if not d:
            raise RuntimeError("این صدای طراحی‌شده دیگر روی این دستگاه نیست؛ صدای دیگری انتخاب کنید.")
        return d["voice_id"]
    if v.startswith("clone:"):
        cid = v[6:]
        ix = _g38_index()
        entry = ix["clones"].get(cid)
        if not entry:
            raise RuntimeError("این صدای شبیه‌سازی‌شده دیگر روی این دستگاه نیست؛ صدای دیگری انتخاب کنید.")
        tag = _key_tag(key)
        if tag in entry.get("ids", {}):
            return entry["ids"][tag]
        try:
            vid = _g38_create_remote(cid, key, status)
        except _GoogleHTTP as e:
            if e.code == 400 and "consent" in (e.msg or "").lower():
                raise RuntimeError("گوگل اجازه‌نامهٔ صوتی را نپذیرفت: جملهٔ اجازه باید با همان صدا، کامل و واضح خوانده شده باشد.")
            raise
        ix = _g38_index()                                   # re-read: another call may have written
        ix["clones"].setdefault(cid, entry).setdefault("ids", {})[tag] = vid
        _g38_index_write(ix)
        return vid
    return v


_G38_LIB = {"at": 0.0, "voices": []}


def g38_library(status=lambda *a, **k: None, language="fa-IR", force=False):
    """Google's Voice Library, filtered to a language (Persian by default).
    Catalog voices are Google's own, so their ids work with any key."""
    if _G38_LIB["voices"] and not force and time.time() - _G38_LIB["at"] < 86400:
        return _G38_LIB["voices"]

    def call(key):
        s_ = requests.Session()
        r = s_.get("https://generativelanguage.googleapis.com/v1beta/voices",
                   params={"language_code": language, "type": "prebuilt", "page_size": 500},
                   headers={"x-goog-api-key": key}, timeout=_G_TIMEOUT)
        if r.status_code != 200:
            raise _GoogleHTTP(r.status_code, r.text[:300])
        return r.json()
    data = google_rotate(call, status, "کتابخانهٔ صداها")
    out = []
    for v in (data or {}).get("voices", []) or []:
        vid = v.get("id") or v.get("name")
        if not vid:
            continue
        out.append({"id": vid, "name": v.get("display_name") or v.get("displayName") or vid,
                    "gender": v.get("gender", ""), "pitch": v.get("pitch", ""),
                    "persona": v.get("persona", ""), "description": (v.get("description") or "")[:120]})
    _G38_LIB.update(at=time.time(), voices=out)
    _diag("g38_library", language=language, count=len(out))
    return out


# ===========================================================================
# 152 · GEMINI 3.8, DESIGNED FROM ITS OWN FEATURES
#   · tone per line: a {marker} in the text → that line's speech_metadata.style
#   · a cast of any size: "Name:" at the start of a line → that character's
#     voice and default style
#   · two characters with catalog voices talking in turn → ONE native two-
#     speaker request (natural turn-taking, backchannels |…| work); anything
#     else → one request per run of lines sharing voice and style, joined
#   · voice design (age, gender, pitch, texture…) and the full voice library
# ===========================================================================
_TONE_RE = re.compile(r"\{([^{}\n]{1,60})\}")
# Persian tone names → the short English style 3.8 is trained on (from the
# mood list the app already has, plus reading styles)
def _tone_to_style(tone):
    t = (tone or "").strip()
    if not t:
        return ""
    for row in DIRECTOR_STATES:
        if row[0] and (t == row[1] or t.lower() == row[2].lower() or t == row[0]):
            return _g38_state_style(row[0])
    return t                                                       # free text passes through as written


def g38_cast(cfg):
    """{name: {"voice": …, "style": …}} from the payload."""
    out = {}
    for c in cfg.get("g38_cast") or []:
        n = (c.get("name") or "").strip()
        if n:
            out[n] = {"voice": (c.get("voice") or "").strip() or "Charon", "style": _tone_to_style(c.get("style") or "")}
    return out


def g38_lines(text, cfg):
    """[(speaker|None, style, spoken_text)] per line of the part."""
    cast = g38_cast(cfg)
    default_style = g38_style(cfg)
    out = []
    for raw in (text or "").split("\n"):
        if not raw.strip():
            continue
        spk = None
        m = _LABEL_RE.match(raw)
        if m:
            name = raw[:m.end()].strip().rstrip(":：").strip()
            if name in cast:
                spk = name
                raw = raw[m.end():]
        tones = [_tone_to_style(x) for x in _TONE_RE.findall(raw)]
        style = ", ".join(x for x in tones if x) or (cast[spk]["style"] if spk and cast[spk]["style"] else default_style)
        out.append((spk, style[:160], raw))
    return out


def _is_catalog_voice(v):
    v = (v or "").strip()
    return bool(v) and not v.startswith(("clone:", "design:"))


def g38_plan(text, cfg):
    """Group the lines into requests. Returns [{"kind": "solo"|"duo", …}]."""
    cast = g38_cast(cfg)
    lines = g38_lines(text, cfg)
    def voice_of(spk):
        return cast[spk]["voice"] if spk else (cfg.get("g_voice") or "Charon")
    plan = []
    i = 0
    while i < len(lines):
        spk, style, txt = lines[i]
        # a stretch where exactly two characters with catalog voices alternate →
        # one native two-speaker request
        j, pair = i, []
        while j < len(lines) and lines[j][0]:
            if lines[j][0] not in pair:
                if len(pair) == 2:
                    break
                pair.append(lines[j][0])
            j += 1
        if (len(pair) == 2 and j - i >= 2 and all(_is_catalog_voice(voice_of(p)) for p in pair)
                and voice_of(pair[0]) != voice_of(pair[1])):
            plan.append({"kind": "duo", "speakers": [{"name": p, "voice": voice_of(p).replace("lib:", "")} for p in pair],
                         "turns": [{"speaker": lines[k][0], "style": lines[k][1], "text": lines[k][2]} for k in range(i, j)],
                         "lines": list(range(i, j))})
            i = j
            continue
        v = voice_of(spk)
        k = i + 1
        while k < len(lines) and voice_of(lines[k][0]) == v and lines[k][1] == style:
            k += 1
        plan.append({"kind": "solo", "voice": v, "style": style,
                     "text": "\n".join(lines[n][2] for n in range(i, k)), "lines": list(range(i, k))})
        i = k
    return plan


def g38_needs_plan(text, cfg):
    """Only texts that use a cast label or a tone marker take the planner; a plain
    text keeps the single-request path (with its lead-in continuity)."""
    return bool(_TONE_RE.search(text or "")) or any(s for s, _, _ in g38_lines(text, cfg))


def _g38_duo_body(turns, speakers):
    parts = []
    for t in turns:
        p = {"text": g38_text(t["text"]), "speech_metadata": {"speaker": t["speaker"]}}
        if t.get("style"):
            p["speech_metadata"]["style"] = t["style"]
        if p["text"]:
            parts.append(p)
    return {"contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"responseModalities": ["AUDIO"],
                                 "responseFormat": {"audio": {"mimeType": "AUDIO_L16", "sampleRate": 24000}},
                                 "speechConfig": {"multiSpeakerVoiceConfig": {"speakerVoiceConfigs": [
                                     {"speaker": sp["name"], "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": sp["voice"]}}}
                                     for sp in speakers]}}}}


def g38_synthesize(text, cfg, status):
    """Render a part that uses a cast or tone markers: request by request, joined
    with a natural gap. Returns (pcm, sr)."""
    plan = g38_plan(text, cfg)
    model = cfg.get("g_model")
    pieces, sr_out = [], 24000
    for step in plan:
        if step["kind"] == "duo":
            body = _g38_duo_body(step["turns"], step["speakers"])
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent"
            gt = " ".join(g38_text(t["text"]) for t in step["turns"])
            expect = max(3.0, len(gt) / 11.0)
            pcm, sr = google_rotate(lambda key: _google_stream(url, body, key, expect, status), status, "گوگل")
        else:
            sub = {**cfg, "g_voice": step["voice"], "_g38_style": step["style"], "g_lead_in": ""}
            pcm, sr = _google_call(step["text"], sub, status)
        if sr != sr_out:
            pcm = _resample(pcm, sr, sr_out)
        if pieces:
            pieces.append(np.zeros(int(sr_out * 0.25), dtype=np.int16))
        pieces.append(pcm)
    _diag("g38_plan", requests=len(plan), duo=sum(1 for p in plan if p["kind"] == "duo"))
    return (np.concatenate(pieces) if pieces else np.zeros(0, dtype=np.int16)), sr_out


# ---- voice design: pinned to the key that created it -----------------------
def g38_designs():
    ix = _g38_index()
    return [{"id": k, "name": v.get("name", ""), "prompt": v.get("prompt", "")}
            for k, v in sorted(ix.get("designs", {}).items(), key=lambda kv: -kv[1].get("created", 0))]


def g38_design_key_tag(cfg):
    v = (cfg.get("g_voice") or "")
    if v.startswith("design:"):
        d = _g38_index().get("designs", {}).get(v[7:])
        return d.get("key") if d else None
    return None


def g38_design_create(name, prompt, gender, status=lambda *a, **k: None):
    """Design a voice at Google from a description; returns its preview audio."""
    import uuid, base64
    prompt = (prompt or "").strip()
    if len(prompt) < 8:
        raise RuntimeError("توصیفِ صدا خیلی کوتاه است.")
    holder = {}

    def call(key):
        body = {"store": True, "voice": {"model": "gemini-3.8-flash-tts", "type": "prompted",
                                        "display_name": (name or "Ava design")[:40],
                                        "language_code": "fa-IR", "prompted": {"input": prompt[:1500]}}}
        if gender in ("male", "female", "neutral"):
            body["voice"]["gender"] = gender
        data = _google_post("https://generativelanguage.googleapis.com/v1beta/voices", body, key, timeout=_G_TIMEOUT)
        holder["key"] = key
        return data
    status("گوگل صدا را از روی توصیف می‌سازد…")
    data = google_rotate(call, status, "طراحی صدا")
    vid = (data or {}).get("id")
    if not vid:
        raise RuntimeError("گوگل صدا را ساخت ولی شناسه‌ای برنگرداند.")
    did = uuid.uuid4().hex[:12]
    ix = _g38_index()
    ix.setdefault("designs", {})[did] = {"name": (name or "صدای طراحی‌شده").strip()[:40], "prompt": prompt[:1500],
                                         "voice_id": vid, "key": _key_tag(holder["key"]), "created": time.time()}
    _g38_index_write(ix)
    sample = ((data or {}).get("sample_audio") or {}).get("data")
    _diag("g38_design", action="created")
    return {"id": did, "name": ix["designs"][did]["name"], "sample_b64": sample,
            "sample_mime": ((data or {}).get("sample_audio") or {}).get("mime_type", "audio/wav")}


def g38_design_delete(did):
    ix = _g38_index()
    ix.get("designs", {}).pop(did, None)
    _g38_index_write(ix)
    return True


# ---- the full Voice Library, with Google's own filters ----------------------
def _g38_library_once(filters, status=lambda *a, **k: None):
    """GET /v1beta/voices with any of Google's filters; catalog voices only."""
    params = [("type", "prebuilt"), ("page_size", "1000")]
    for f in ("gender", "pitch", "language_code", "accent", "persona", "context"):
        for val in (filters.get(f) or []) if isinstance(filters.get(f), list) else ([filters[f]] if filters.get(f) else []):
            params.append(("context" if f == "context" else f, val))
    if filters.get("search"):
        params.append(("search", filters["search"][:200]))

    def call(key):
        r = requests.Session().get("https://generativelanguage.googleapis.com/v1beta/voices",
                                   params=params, headers={"x-goog-api-key": key}, timeout=_G_TIMEOUT)
        if r.status_code != 200:
            raise _GoogleHTTP(r.status_code, r.text[:300])
        return r.json()
    data = google_rotate(call, status, "کتابخانهٔ صداها")
    out = []
    for v in (data or {}).get("voices", []) or []:
        vid = v.get("id")
        if vid:
            out.append({k: v.get(k, "") for k in ("id", "display_name", "gender", "pitch", "accent", "persona",
                                                   "context", "language_code", "description")})
    _diag("g38_library", filters=len(params) - 2, count=len(out))
    return out


def g38_preview(voice, style, text, cfg, status=lambda *a, **k: None):
    """A short sample in any voice, for auditioning before choosing."""
    sub = {**cfg, "g_model": cfg.get("g_model") if _is_g38(cfg) else "gemini-3.8-flash-lite-tts",
           "g_voice": voice, "g_lead_in": "", "_no_audit": True}
    if style is not None:                          # None → the part's own reading style and mood
        sub["_g38_style"] = _tone_to_style(style)
    pcm, sr = _google_call((text or "سلام، این صدای من است؛ امیدوارم خوشتان بیاید.")[:200], sub, status)
    return pcm, sr


# ===========================================================================
# 153 · groundwork for the line-based editor and its timeline
#   Parts stay the unit of GENERATION (Google keeps its tone inside one call);
#   lines become the unit of EDITING. gulp_lines() hands the editor each line's
#   span inside its part, from the part's own line map; timeline_files() builds
#   the final file from clips placed on a timeline (position, trim, row, gain).
# ===========================================================================
def gulp_lines(gid):
    """[{"text", "t0", "t1"}] for each editor line (newline-separated) of a part, in
    seconds inside the part's assembled audio. A part without a trustworthy line map
    (or made clause by clause with pauses) comes back as ONE span covering it all."""
    e = _GULP_PCM.get(int(gid)) if gid is not None else None
    if not e:
        return []
    sr = e["sr"]; text = e.get("text") or ""
    total = sum(len(i["pcm"]) for i in e.get("items", []) if isinstance(i.get("pcm"), np.ndarray))
    whole = [{"text": text.strip(), "t0": 0.0, "t1": round(total / sr, 3), "whole": True}]
    lines = e.get("lines") or []
    speech = [i for i in e.get("items", []) if isinstance(i.get("pcm"), np.ndarray) and len(i["pcm"])]
    clause_items = [i for i in e.get("items", []) if i.get("kind") == "t" and i.get("span") and isinstance(i.get("pcm"), np.ndarray)]
    if len(clause_items) > 1:
        return _clause_line_spans(e, sr, text) or whole       # 156: local engines, clause by clause
    if not lines or e.get("map_untrusted") or len(speech) != 1:
        return whole
    clauses = _g_clauses(text)
    if len(clauses) != len(lines):
        return whole
    starts, pos = [], 0
    for raw in text.split("\n"):
        starts.append(pos); pos += len(raw) + 1
    out = {}
    for (ctext, (a, _b)), ln in zip(clauses, lines):
        k = max(i for i, st in enumerate(starts) if st <= a)
        span = out.setdefault(k, {"text": text.split("\n")[k].strip(), "t0": ln["a"] / sr, "t1": ln["b"] / sr})
        span["t0"] = min(span["t0"], ln["a"] / sr); span["t1"] = max(span["t1"], ln["b"] / sr)
    return [{"text": v["text"], "t0": round(v["t0"], 3), "t1": round(v["t1"], 3)} for k, v in sorted(out.items()) if v["text"]]


def timeline_pcm(spec, status=lambda *a, **k: None):
    """Mix clips placed on a timeline. spec = {"clips": [...]}, each clip one of
         {"gulp": id, "in": s, "out": s, "at": s, "gain": 1.0}   a slice of a part's audio
         {"silence": seconds, "at": s}                             room, nothing to mix
    Clips may overlap (two rows speaking at once); they are summed, then kept out of
    clipping by a soft peak limit. Returns (int16 pcm, sr)."""
    clips = [c for c in (spec or {}).get("clips", []) if c.get("gulp") is not None or c.get("file")]
    if not clips:
        raise RuntimeError("روی خطِ زمان چیزی برای ساختن نیست.")
    entries = {}
    for c in clips:
        if c.get("file"):                                        # 170: a bundled sound effect (ui/sfx/…) or any audio file
            key = "file:" + str(c["file"])
            if key not in entries:
                entries[key] = _sfx_pcm(str(c["file"]))
            continue
        g = int(c["gulp"])
        if g not in _GULP_PCM:
            raise RuntimeError("بعضی از بخش‌ها دیگر در حافظه نیستند؛ یک بار دیگر «تبدیل به گفتار» را بزنید.")
        if g not in entries:
            _ensure_valid(_GULP_PCM[g], "ساختنِ فایل از خطِ زمان", status)
            entries[g] = (_assemble(_GULP_PCM[g]), _GULP_PCM[g]["sr"])
    sr = max(r for _, r in entries.values())
    rendered = {g: (_resample(p, r, sr) if r != sr else p) for g, (p, r) in entries.items()}
    ckey = lambda c: ("file:" + str(c["file"])) if c.get("file") else int(c["gulp"])
    end = 0.0
    for c in clips:
        dur = max(0.0, float(c.get("out", 0)) - float(c.get("in", 0)))
        end = max(end, float(c.get("at", 0)) + dur)                  # 182: a looping clip runs as long as it says
    for c in (spec or {}).get("clips", []):
        if c.get("silence") is not None:
            end = max(end, float(c.get("at", 0)) + float(c["silence"]))
    status("دارم کلیپ‌های خطِ زمان را کنارِ هم می‌گذارم…")
    mix = np.zeros(int(end * sr) + 1, dtype=np.float32)
    # 182: the speech the ducking clips listen to — the same rule as the editor's playback (a moment before each
    #      voice clip to a little after it), as a smooth 0…1 curve
    duckers = [c for c in clips if float(c.get("duck_db", 0) or 0) > 0]
    talk = None
    if duckers:
        talk = np.zeros(len(mix), dtype=np.float32)
        for c in clips:
            if c.get("kind") == "voice" or (c.get("kind") is None and c.get("gulp") is not None and not c.get("file")):
                a0 = max(0, int((float(c.get("at", 0)) - 0.15) * sr)); b0 = min(len(talk), int((float(c.get("at", 0)) + float(c.get("out", 0)) - float(c.get("in", 0)) + 0.6) * sr))
                if b0 > a0:
                    talk[a0:b0] = 1.0
        k = max(1, int(sr * 0.1))                                  # 100 ms ramps, like the editor's 0.1 s steps
        talk = np.convolve(talk, np.ones(k, dtype=np.float32) / k, mode="same")
    for c in clips:
        src = rendered[ckey(c)]
        a = max(0, int(float(c.get("in", 0)) * sr)); b = int(float(c.get("out", 0)) * sr)
        looped = bool(c.get("loop")) if "loop" in c else (b > len(src) + int(sr * 0.001) and (c.get("kind") == "audio" or bool(c.get("file"))))   # the editor says; an older caller: longer than its sound
        if not looped:
            b = min(len(src), b)
        if b <= a or not len(src):
            continue
        at = max(0, int(float(c.get("at", 0)) * sr))
        seg = (src[np.arange(a, b) % len(src)] if looped else src[a:b]).astype(np.float32) * float(c.get("gain", 1.0))
        n = len(seg)
        fi = min(int(float(c.get("fade_in", 0) or 0) * sr), n // 2); fo = min(int(float(c.get("fade_out", 0) or 0) * sr), n // 2)
        if fi > 0:
            seg[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
        if fo > 0:
            seg[n - fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
        dk = float(c.get("duck_db", 0) or 0)
        if dk > 0 and talk is not None:
            m = min(n, len(talk) - at)
            if m > 0:
                seg[:m] *= 1.0 - (1.0 - 10 ** (-dk / 20.0)) * talk[at:at + m]
        n = min(len(seg), len(mix) - at)
        if n > 0:
            mix[at:at + n] += seg[:n]
    peak = float(np.max(np.abs(mix))) if len(mix) else 0.0
    if peak > 32000:                                           # overlapping voices summed above full scale
        mix *= 32000.0 / peak
    _diag("timeline", clips=len(clips), seconds=round(len(mix) / sr, 1))
    return mix.astype(np.int16), sr


def timeline_files(spec, music_cfg, status):
    """The final file(s) from the timeline: the clean one always, and the music
    version when music is on — the same music bed, level, fades and ducking as before."""
    _require_license()
    pcm, sr = timeline_pcm(spec, status)
    out = {"clean": pcm_to_mp3(pcm, sr), "seconds": round(len(pcm) / sr, 1)}
    if music_cfg and music_cfg.get("on"):
        if _MUSIC["pcm"] is None and music_cfg.get("file"):
            music_load(music_cfg["file"])
        if _MUSIC["pcm"] is None:                                    # 169: no music → the composition is what there is
            _diag("timeline_music", skipped="no_music")
            out["music"] = out["clean"]
            return out
        status("دارم موسیقی را زیر صدا می‌گذارم…")
        mixed = mix_music_clips(pcm, sr, _MUSIC["pcm"], _MUSIC["sr"], music_cfg["clips"],
            level_db=float(music_cfg.get("level_db", -16)), duck=float(music_cfg.get("duck_db", 12)) > 0 and bool(music_cfg.get("duck", True)),
            duck_db=float(music_cfg.get("duck_db", 12)), fade_in=float(music_cfg.get("fade_in", 1.5)), fade_out=float(music_cfg.get("fade_out", 1.5))) if music_cfg.get("clips") else mix_music(pcm, sr, _MUSIC["pcm"], _MUSIC["sr"],
                          level_db=float(music_cfg.get("level_db", -16)), duck=float(music_cfg.get("duck_db", 12)) > 0 and bool(music_cfg.get("duck", True)),
                          duck_db=float(music_cfg.get("duck_db", 12)),
                          fade_out=float(music_cfg.get("fade_out", music_cfg.get("fade", 1.5))), fade_in=float(music_cfg.get("fade_in", 1.5)))
        out["music"] = pcm_to_mp3(mixed, sr)
    return out


def timeline_captions(cues, fmt="srt"):
    """SRT or VTT from the subtitle cues the editor holds: [{"t0", "t1", "text"}]
    — subtitles keep their OWN timings (they are edited independently of the speech)."""
    def ts(t, sep):
        t = max(0.0, float(t)); h = int(t // 3600); m = int(t % 3600 // 60); s = int(t % 60); ms = int(round((t - int(t)) * 1000)) % 1000
        return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"
    rows = [c for c in (cues or []) if (c.get("text") or "").strip() and float(c.get("t1", 0)) > float(c.get("t0", 0))]
    rows.sort(key=lambda c: float(c["t0"]))
    if fmt == "vtt":
        return "WEBVTT\n\n" + "\n".join(f"{ts(c['t0'], '.')} --> {ts(c['t1'], '.')}\n{c['text'].strip()}\n" for c in rows)
    return "\n".join(f"{k}\n{ts(c['t0'], ',')} --> {ts(c['t1'], ',')}\n{c['text'].strip()}\n" for k, c in enumerate(rows, 1))


# ===========================================================================
# 154 · what the new editor needs to come back to its work
# ===========================================================================
import uuid as _uuid
SESSION = _uuid.uuid4().hex[:12]       # parts live in memory: a new session means they are gone


def gulp_audio(gid):
    """A part's audio and line spans by id, so the editor can play and edit parts it
    made earlier in this session (e.g. after switching interfaces) without regenerating."""
    e = _GULP_PCM.get(int(gid))
    if not e:
        raise RuntimeError("این بخش دیگر در حافظه نیست؛ دوباره تبدیل به گفتار کنید.")
    return pcm_to_mp3(_assemble(e), e["sr"]), gulp_lines(gid)


# ===========================================================================
# 155 · paid-only features, the library fallback, the protection stamp
# ===========================================================================
_TIER_MSG = ("گوگل می‌گوید این کار — شبیه‌سازیِ صدا — فقط با کلیدِ پروژه‌ای انجام می‌شود که پرداختش فعال است "
             "(سطحِ 1 به بالا)؛ کلیدهای رایگان این امکان را ندارند، پس کلیدهای دیگر امتحان نشدند. یکی از صداهای "
             "آماده یا طراحی‌شده را انتخاب کنید، یا کلیدِ یک پروژهٔ پرداختی اضافه کنید. گوگل این امکان را در "
             "منطقهٔ اقتصادیِ اروپا هم فعلاً در دسترس نمی‌گذارد.")
_google_fault_base = _google_fault


def _google_fault(code, msg):
    """155: a feature Google reserves for paid projects is neither a dead key nor a
    network fault — it is the ACCOUNT, so no other free key can succeed."""
    m = (msg or "").lower()
    if code in (400, 403) and ("paid quota tier" in m or "requires paid" in m):
        return "tier"
    return _google_fault_base(code, msg)


def g38_library_search(filters, status=lambda *a, **k: None):
    """155: when a language filter finds no voices, show the whole library instead of an
    empty list (the Persian filter returned 0 in the field log)."""
    out = _g38_library_once(filters, status)
    if not out and filters.get("language_code"):
        _diag("g38_library_fallback", language=str(filters.get("language_code"))[:20])
        status("صدایی با برچسبِ این زبان پیدا نشد؛ همهٔ صداها نشان داده می‌شوند.")
        out = _g38_library_once({k: v for k, v in filters.items() if k != "language_code"}, status)
    return out


_diag("protect", copy=COPY_ID, compiled=str(__file__).endswith((".so", ".pyd")))


# ===========================================================================
# 156 · line spans for parts made CLAUSE BY CLAUSE (Chatterbox, the light voices)
#   Their audio is assembled piece by piece (_assemble_raw): a pause is its own fill or
#   silence; a clause is its audio plus an optional gap. Repeating that exact layout gives
#   each clause's position, and each clause's text span says which editor line it is on —
#   so local engines get one clip per line too, with no transcription at all.
# ===========================================================================
def _clause_line_spans(e, sr, text):
    starts, pos = [], 0
    for raw in text.split("\n"):
        starts.append(pos); pos += len(raw) + 1
    out, at = {}, 0
    for i in e.get("items", []):
        if i.get("kind") == "p":
            tone = i.get("pcm")
            at += len(tone) if isinstance(tone, np.ndarray) and tone.dtype == np.int16 and len(tone) > 0 else int(sr * i.get("sec", 0))
            continue
        pcm = i.get("pcm"); n = len(pcm) if isinstance(pcm, np.ndarray) else 0
        sp = i.get("span")
        if n and sp and i.get("text"):
            k = max(j for j, st in enumerate(starts) if st <= sp[0])
            span = out.setdefault(k, {"t0": at, "t1": at + n})
            span["t0"] = min(span["t0"], at); span["t1"] = max(span["t1"], at + n)
        at += n
        if i.get("gap"):
            at += int(sr * i["gap"])
    lines = text.split("\n")
    res = [{"text": lines[k].strip(), "t0": round(v["t0"] / sr, 3), "t1": round(v["t1"] / sr, 3)} for k, v in sorted(out.items()) if lines[k].strip()]
    return res if res else None


# ===========================================================================
# 159 · WORD TIMINGS — so trimming, the playhead caret and splits land on words
#   Each line's span is cut into its words by matching the line's characters to
#   the audio's quiet dips: each boundary goes to the quietest frame within
#   ±120 ms of where the characters say it should fall. No extra request.
# ===========================================================================
def _word_times(pcm, sr, a, b, text):
    words = list(re.finditer(r"\S+", text or ""))
    if not words or b <= a:
        return []
    seg = pcm[a:b].astype(np.float32)
    hop = max(1, int(sr * 0.01)); n = len(seg) // hop
    if n < 2:
        return []
    env = np.sqrt(np.mean(seg[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-9)
    # 169: the words live in the VOICED part of the span — spreading them over the leading and trailing
    # silence put the caret behind (or ahead of) the voice whenever the transcription was unavailable
    thr = max(1e-4, float(env.max()) * 0.06); voiced = np.where(env > thr)[0]
    f0, f1 = (int(voiced[0]), int(voiced[-1]) + 1) if len(voiced) and voiced[-1] - voiced[0] > 10 else (0, n)
    m = f1 - f0
    weights = [max(1, len(re.sub(r"[\u064B-\u0655\u0670\W_]", "", w.group(0)))) for w in words]
    tot = float(sum(weights)); cuts, acc = [], 0.0
    for wgt in weights[:-1]:
        acc += wgt
        guess = min(m - 1, max(1, int(acc / tot * m)))
        lo, hi = max(1, guess - 12), min(m - 1, guess + 12)
        k = lo + int(np.argmin(env[f0 + lo:f0 + hi])) if hi > lo else guess
        cuts.append(max(cuts[-1] + 1 if cuts else 1, min(m - 1, k)))
    edges = [f0] + [f0 + c for c in cuts] + [f1]
    return [{"w": w.group(0), "c0": w.start(), "c1": w.end(),
             "t0": round((a + edges[i] * hop) / sr, 3), "t1": round((a + min(len(seg), edges[i + 1] * hop)) / sr, 3)}
            for i, w in enumerate(words)]


_gulp_lines_158 = gulp_lines


def gulp_lines(gid):
    """159: the same line spans, each now carrying its words with times."""
    spans = _gulp_lines_158(gid)
    e = _GULP_PCM.get(int(gid)) if gid is not None else None
    if not e or not spans:
        return spans
    try:
        pcm = _assemble(e); sr = e["sr"]
        for sp in spans:
            sp["words"] = _word_times(pcm, sr, int(sp["t0"] * sr), int(sp["t1"] * sr), sp.get("text", ""))
    except Exception as ex:
        _diag("word_times_error", err=str(ex)[:120])
    return spans


_G38_FALLBACK_TOKENS = set()


def g38_voice_page(filters=None, page_token="", status=lambda *a, **k: None):
    """The Extended Voice Library (2,000+ voices), one page at a time, with Google's filters
    (language_code, gender, pitch, contexts, search, type). When a language filter finds
    nothing — Persian returned 0 in the field log — the page comes from the whole library."""
    f = dict(filters or {})
    def fetch(params):
        def call(key):
            r = requests.get("https://generativelanguage.googleapis.com/v1beta/voices", params=params,
                             headers={"x-goog-api-key": key}, timeout=_G_TIMEOUT)
            if r.status_code != 200:
                raise _GoogleHTTP(r.status_code, r.text[:300])
            return r.json()
        return google_rotate(call, status, "کتابخانهٔ صداها")
    params = [("page_size", str(int(f.get("page_size") or 60)))]
    for k in ("language_code", "gender", "pitch", "contexts", "type"):
        vals = f.get(k) or []
        for v in ([vals] if isinstance(vals, str) else vals):
            if v:
                params.append(("context" if k == "contexts" else k, v))
    if f.get("search"):
        params.append(("search", f["search"]))
    if page_token:
        if page_token in _G38_FALLBACK_TOKENS:          # 164: a token from the whole-library fallback must not carry the language filter
            params = [p for p in params if p[0] != "language_code"]
        params.append(("page_token", page_token))
    data = fetch(params); fell_back = page_token in _G38_FALLBACK_TOKENS
    if not data.get("voices") and f.get("language_code") and not page_token:
        _diag("g38_library_fallback", language=str(f.get("language_code"))[:30])
        data = fetch([p for p in params if p[0] != "language_code"]); fell_back = True
    voices = []
    for v in data.get("voices", []) or []:
        voices.append({"id": v.get("id") or (v.get("name") or "").split("/")[-1], "name": v.get("display_name") or v.get("displayName") or v.get("id"),
                       "description": v.get("description", ""), "language": v.get("language_code") or v.get("languageCode", ""),
                       "accent": v.get("accent", ""), "gender": v.get("gender", ""), "pitch": v.get("pitch", ""),
                       "persona": v.get("persona", ""), "contexts": v.get("contexts") or v.get("context") or [], "type": v.get("type", "")})
    _tok = data.get("nextPageToken") or data.get("next_page_token")
    if fell_back and _tok:
        _G38_FALLBACK_TOKENS.add(_tok)
    _diag("g38_voice_page", count=len(voices), fell_back=fell_back)
    return {"voices": voices, "next": data.get("next_page_token") or data.get("nextPageToken") or "", "fell_back": fell_back}


# ===========================================================================
# 160 · REAL WORD TIMESTAMPS — the line index already transcribes the take with word
#   timestamps; they were used for clause boundaries and then thrown away. Now the
#   part keeps them, and line words take their times from them whenever the words
#   line up one-for-one (the energy estimate stays as the fallback).
# ===========================================================================
_LAST_WORDS = {"words": None, "n": -1}
_transcribe_words_159 = transcribe_words


def transcribe_words(pcm, sr, *a, **k):
    r = _transcribe_words_159(pcm, sr, *a, **k)
    if r:
        _LAST_WORDS.update(words=[(str(t), float(s0), float(s1)) for t, s0, s1 in r], n=len(pcm))
    return r


def _keep_words(fn, pcm_of):
    def wrapped(entry, *a, **k):
        _LAST_WORDS.update(words=None, n=-1)
        out = fn(entry, *a, **k)
        try:
            pcm = pcm_of(entry, a, k)
            if isinstance(entry, dict) and _LAST_WORDS["words"] and pcm is not None and _LAST_WORDS["n"] == len(pcm):
                entry["words_ts"] = list(_LAST_WORDS["words"])
        except Exception:
            pass
        return out
    return wrapped


build_line_index = _keep_words(build_line_index, lambda e, a, k: a[1] if len(a) > 1 else k.get("pcm"))
ensure_line_index = _keep_words(ensure_line_index, lambda e, a, k: (e.get("items") or [{}])[0].get("pcm"))
_TAG_TOKEN = re.compile(r"^(<[^>]*>|\|[^|]*\||\{[^{}]*\}|\[[^\[\]]*\])$")


def _ts_words(e, sp):
    """Line words timed from the transcription, when its words in this span match the line's spoken words."""
    ts = e.get("words_ts") or []
    toks = [m for m in re.finditer(r"\S+", sp.get("text", "")) if not _TAG_TOKEN.match(m.group(0))]
    inside = [w for w in ts if sp["t0"] - 0.12 <= (w[1] + w[2]) / 2 <= sp["t1"] + 0.12]
    if not toks or len(inside) != len(toks):
        return None
    return [{"w": m.group(0), "c0": m.start(), "c1": m.end(), "t0": round(max(sp["t0"], w[1]), 3), "t1": round(min(sp["t1"], w[2]), 3), "src": "asr"}
            for m, w in zip(toks, inside)]


_gulp_lines_159 = gulp_lines


def gulp_lines(gid):
    e = _GULP_PCM.get(int(gid)) if gid is not None else None
    if e and e.get("saved_spans") and not e.get("lines"):
        return e["saved_spans"]                                   # a part restored from a project file
    spans = _gulp_lines_159(gid)
    if e and spans and e.get("words_ts"):
        for sp in spans:
            w = _ts_words(e, sp)
            if w:
                sp["words"] = w
    return spans


# ===========================================================================
# 160 · PROJECT FILES (.ava) — reopen a project exactly as it was, with no re-voicing.
#   One zip: project.json (the editor's document), parts/<id>.wav (each referenced
#   part's audio, lossless), parts.json (its text, line map, word times), music.mp3.
# ===========================================================================
def project_pack(doc):
    import zipfile, io as _io, json as _json, wave as _wave
    buf = _io.BytesIO()
    gids = sorted({int(c["gulp"]) for t in (doc or {}).get("tracks", []) for c in t.get("clips", [])
                   if c.get("gulp") is not None and int(c["gulp"]) in _GULP_PCM})
    parts = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", _json.dumps({"format": "ava-project", "version": 1, "build": BUILD, "doc": doc}, ensure_ascii=False))
        for g in gids:
            e = _GULP_PCM[g]; pcm = _assemble(e).astype(np.int16); sr = int(e["sr"])
            wb = _io.BytesIO(); w = _wave.open(wb, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
            z.writestr(f"parts/{g}.wav", wb.getvalue())
            parts[str(g)] = {"sr": sr, "text": e.get("text", ""), "lines": e.get("lines") or [], "words_ts": e.get("words_ts"),
                             "engine": e.get("engine"), "spans": gulp_lines(g)}
        z.writestr("parts.json", _json.dumps(parts, ensure_ascii=False, default=lambda o: list(o) if isinstance(o, tuple) else (o.item() if hasattr(o, "item") else str(o))))
        if _MUSIC.get("pcm") is not None:
            z.writestr("music.mp3", pcm_to_mp3(_MUSIC["pcm"], _MUSIC["sr"]))
            z.writestr("music.json", _json.dumps({"name": _MUSIC.get("name") or "music"}, ensure_ascii=False))
    _diag("project_pack", parts=len(gids), music=_MUSIC.get("pcm") is not None)
    return buf.getvalue()


def project_unpack(data):
    import zipfile, io as _io, json as _json, wave as _wave, base64 as _b64
    z = zipfile.ZipFile(_io.BytesIO(data))
    if "project.json" not in z.namelist():
        raise RuntimeError("این فایل، فایلِ پروژهٔ آوای جاوید شاه نیست.")
    meta = _json.loads(z.read("project.json").decode("utf-8"))
    parts = _json.loads(z.read("parts.json").decode("utf-8")) if "parts.json" in z.namelist() else {}
    remap = {}
    for g, info in parts.items():
        w = _wave.open(_io.BytesIO(z.read(f"parts/{g}.wav"))); sr = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).copy(); w.close()
        ng = next(_gulp_ids)
        _GULP_PCM[ng] = {"sr": sr, "items": [{"kind": "t", "text": "", "span": (0, 0), "pcm": pcm}], "text": info.get("text", ""),
                         "lines": info.get("lines") or [], "words_ts": [tuple(x) for x in (info.get("words_ts") or [])] or None,
                         "engine": info.get("engine"), "restored": True, "saved_spans": info.get("spans")}
        remap[int(g)] = ng
    doc = meta.get("doc") or {}
    for t in doc.get("tracks", []):
        for c in t.get("clips", []):
            if c.get("gulp") is not None and int(c["gulp"]) in remap:
                c["gulp"] = remap[int(c["gulp"])]
    music = None
    if "music.mp3" in z.namelist():
        mname = (_json.loads(z.read("music.json").decode("utf-8")) if "music.json" in z.namelist() else {}).get("name") or "music"
        music = {"b64": _b64.b64encode(z.read("music.mp3")).decode("ascii"), "name": mname}
    _diag("project_unpack", parts=len(remap), music=bool(music))
    return {"doc": doc, "music": music, "remap": {str(k): v for k, v in remap.items()}}


_ensure_valid_159 = _ensure_valid


def _ensure_valid(entry, where, status):
    if isinstance(entry, dict) and entry.get("restored"):
        return                                                   # checked when saved; the zip guards its bytes
    return _ensure_valid_159(entry, where, status)


# ===========================================================================
# 161 · VIDEO: an ASSET STORE for the video tab's pictures and videos (chunked, so large
#   files cross the bridge in pieces), a STREAMED SAVE for big MP4 exports, and project
#   files that carry every asset the video tab uses.
# ===========================================================================
import base64 as _b64m, uuid as _uuid_v, json as _json_v
_ASSET_DIR = MODELS_DIR / "assets"
_ASSET_OPEN, _SAVE_OPEN = {}, {}


def _asset_meta_path(aid):
    return _ASSET_DIR / f"{aid}.json"


def asset_begin(name, mime, size=0):
    _ASSET_DIR.mkdir(parents=True, exist_ok=True)
    if size:
        need_room(_ASSET_DIR, float(size) / (1 << 20))              # 182: a big file on a nearly full disk says so before it starts
    aid = _uuid_v.uuid4().hex[:16]
    _ASSET_OPEN[aid] = open(_ASSET_DIR / f"{aid}.bin", "wb")
    _asset_meta_path(aid).write_text(_json_v.dumps({"name": str(name)[:200], "mime": str(mime)[:80]}, ensure_ascii=False), encoding="utf-8")
    return aid


def asset_chunk(aid, b64):
    f = _ASSET_OPEN.get(aid)
    if not f:
        raise RuntimeError("این فایل باز نیست؛ دوباره اضافه‌اش کنید.")
    try:
        f.write(_b64m.b64decode(b64))
    except OSError as e:                                            # 182: the disk filled up on the way — the piece-file goes
        _ASSET_OPEN.pop(aid, None)
        try:
            f.close()
        except Exception:
            pass
        asset_drop(aid)
        if getattr(e, "errno", None) == 28:
            raise RuntimeError("روی این دیسک جا نیست؛ کمی جا باز کنید و دوباره امتحان کنید.")
        raise
    return True


def asset_end(aid):
    f = _ASSET_OPEN.pop(aid, None)
    if f:
        f.close()
    return asset_info(aid)


def asset_info(aid):
    p = _ASSET_DIR / f"{aid}.bin"
    if not p.exists():
        return None
    meta = _json_v.loads(_asset_meta_path(aid).read_text(encoding="utf-8")) if _asset_meta_path(aid).exists() else {}
    return {"id": aid, "size": p.stat().st_size, "name": meta.get("name", aid), "mime": meta.get("mime", "application/octet-stream")}


def asset_drop(aid):
    """182: an asset that was only on its way somewhere (an audio file that became a part) leaves the store."""
    aid = str(aid)
    if not aid.isalnum():
        return False
    for q in (_ASSET_DIR / f"{aid}.bin", _asset_meta_path(aid)):
        try:
            q.unlink()
        except FileNotFoundError:
            pass
        except Exception:
            pass
    return True


def asset_gulp(aid, name=None):
    """182: an audio file dropped on (or picked in) the window, now in the asset store, becomes a part — the limits
    (250 MB · 60 minutes), decoded to mono at its own rate; the stored copy goes (the part holds the sound)."""
    p = _ASSET_DIR / f"{aid}.bin"
    try:
        if not p.exists():
            raise RuntimeError("فایل پیدا نشد.")
        return file_gulp(p, name=name or (asset_info(aid) or {}).get("name"))
    finally:
        asset_drop(aid)


def asset_to_mp3(aid, name=None):
    """182: an audio file the window cannot decode itself (Ogg on some Macs) is decoded here and kept as an MP3 asset
    (the video mode plays and exports it from that); the original copy goes."""
    p = _ASSET_DIR / f"{aid}.bin"
    try:
        if not p.exists():
            raise RuntimeError("فایل پیدا نشد.")
        nm = name or (asset_info(aid) or {}).get("name") or "audio"
        audio_limits_check(p, nm)
        pcm, sr = _decode_audio(p.read_bytes())
        if len(pcm) < sr // 10:
            raise RuntimeError("این فایل صوتی تقریباً خالی است.")
        audio_seconds_check(len(pcm) / sr, nm)
        nid = asset_begin(Path(nm).stem + ".mp3", "audio/mpeg")
        f = _ASSET_OPEN.pop(nid)
        try:
            f.write(pcm_to_mp3(pcm, sr))
        finally:
            f.close()
        return {"id": nid, "seconds": round(len(pcm) / sr, 3), "name": nm}
    finally:
        asset_drop(aid)


def asset_read(aid, offset=0, size=4 * 1024 * 1024):
    p = _ASSET_DIR / f"{aid}.bin"
    with open(p, "rb") as f:
        f.seek(int(offset))
        data = f.read(int(size))
    return _b64m.b64encode(data).decode("ascii")


def save_stream_open(path):
    """182: the video is written while it is encoded — into «name.exporting» beside the chosen file, which becomes the
    file only when it is complete (a cancelled or failed export never leaves a broken file, nor spoils one already there)."""
    job = _uuid_v.uuid4().hex[:12]
    p = Path(path)
    tmp = p.with_name(p.name + ".exporting")
    _SAVE_OPEN[job] = {"f": open(tmp, "wb"), "path": str(p), "tmp": str(tmp)}
    return job


def _save_stream_write(job, data, position=None):
    j = _SAVE_OPEN.get(job)
    if not j:
        raise RuntimeError("این خروجی دیگر باز نیست؛ دوباره بسازید.")
    f = j["f"]
    try:
        f.seek(0, 2) if position is None else f.seek(int(position))
        f.write(data)
    except OSError as e:
        if getattr(e, "errno", None) == 28:
            save_stream_abort(job)
            raise RuntimeError("روی این دیسک جا نیست؛ کمی جا باز کنید و دوباره امتحان کنید.")
        raise
    return True


def save_stream_chunk(job, b64):
    return _save_stream_write(job, _b64m.b64decode(b64))


def save_stream_at(job, b64, position):
    """182: a piece at its place in the file (the muxer goes back at the end to fill in the sizes and the index)."""
    return _save_stream_write(job, _b64m.b64decode(b64), position)


def save_stream_close(job):
    j = _SAVE_OPEN.pop(job, None)
    if j:
        j["f"].close()
        if j.get("tmp"):
            os.replace(j["tmp"], j["path"])
        _diag("video_export_saved", path=j["path"][-60:])
        return j["path"]
    return None


def save_stream_abort(job):
    """182: a cancelled or failed export — its unfinished file goes."""
    j = _SAVE_OPEN.pop(job, None)
    if not j:
        return False
    try:
        j["f"].close()
    except Exception:
        pass
    try:
        if j.get("tmp"):
            os.unlink(j["tmp"])
    except OSError:
        pass
    return True


def _video_asset_ids(doc):
    v = (doc or {}).get("video") or {}
    ids = {o.get("asset") for o in v.get("objects", []) if o.get("asset")}
    if (v.get("pod") or {}).get("bgAsset"):
        ids.add(v["pod"]["bgAsset"])
    return {i for i in ids if i and (_ASSET_DIR / f"{i}.bin").exists()}


_project_pack_160 = project_pack


def project_pack(doc):
    """161: the same project file, now also carrying every picture and video of the video tab."""
    import zipfile, io as _io
    base = _project_pack_160(doc)
    ids = _video_asset_ids(doc)
    if not ids:
        return base
    buf = _io.BytesIO(base)
    with zipfile.ZipFile(buf, "a", zipfile.ZIP_STORED) as z:
        man = {}
        for i in sorted(ids):
            z.write(_ASSET_DIR / f"{i}.bin", f"assets/{i}.bin")
            man[i] = asset_info(i)
        z.writestr("assets.json", _json_v.dumps(man, ensure_ascii=False))
    _diag("project_pack_assets", n=len(ids))
    return buf.getvalue()


_project_unpack_160 = project_unpack


def project_unpack(data):
    import zipfile, io as _io
    out = _project_unpack_160(data)
    z = zipfile.ZipFile(_io.BytesIO(data))
    if "assets.json" in z.namelist():
        _ASSET_DIR.mkdir(parents=True, exist_ok=True)
        man = _json_v.loads(z.read("assets.json").decode("utf-8"))
        remap = {}
        for i, meta in man.items():
            raw = z.read(f"assets/{i}.bin"); dst = _ASSET_DIR / f"{i}.bin"
            nid = i if (not dst.exists() or dst.stat().st_size == len(raw)) else _uuid_v.uuid4().hex[:16]
            (_ASSET_DIR / f"{nid}.bin").write_bytes(raw)
            _asset_meta_path(nid).write_text(_json_v.dumps({"name": (meta or {}).get("name", nid), "mime": (meta or {}).get("mime", "")}, ensure_ascii=False), encoding="utf-8")
            remap[i] = nid
        v = out["doc"].get("video") or {}
        for o in v.get("objects", []):
            if o.get("asset") in remap:
                o["asset"] = remap[o["asset"]]
        if (v.get("pod") or {}).get("bgAsset") in remap:
            v["pod"]["bgAsset"] = remap[v["pod"]["bgAsset"]]
        _diag("project_unpack_assets", n=len(remap))
    return out


# ===========================================================================
# 182 · SAFE PROJECT FILES — the founder: «build every single one of the safeguards».
#   · a save is written beside the file and swapped in only once it is complete, so a crash or a full disk in the middle
#     of a save can no longer destroy the only copy; the version it replaces is kept in AvaModels/backups (the last three
#     of each project); free space is checked first;
#   · the zip is written straight to disk (no second copy of the whole project in memory) and read from disk (pictures
#     and videos are copied out piece by piece);
#   · a recovery copy (AvaModels/recovery) is refreshed every minute or two while there are unsaved changes and on every
#     manual save — never older than the saved file — and offered at the next launch if the app did not close normally;
#   · a project saved by a newer build says so (its build number travels with the opened document);
#   · opening or starting a project lets go of everything the previous one held in memory (its voiced parts, its music).
# ===========================================================================
import shutil as _sh_p
_BACKUP_DIR = MODELS_DIR / "backups"
_RECOVERY_DIR = MODELS_DIR / "recovery"
BACKUPS_KEEP = 3


def _project_gids(doc):
    """Every voiced part the document refers to: the clips' and (176) every reaction recording's."""
    return sorted({int(c["gulp"]) for t in (doc or {}).get("tracks", []) for c in t.get("clips", [])
                   if c.get("gulp") is not None and int(c["gulp"]) in _GULP_PCM} | _ovl_gids(doc))


def project_pack_to(doc, target):
    """The whole project as one zip, written to `target` (a path or an open binary file)."""
    import zipfile, io as _io, json as _json, wave as _wave
    gids, parts = _project_gids(doc), {}
    ids = _video_asset_ids(doc)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", _json.dumps({"format": "ava-project", "version": 1, "build": BUILD, "doc": doc}, ensure_ascii=False))
        for g in gids:
            e = _GULP_PCM[g]; pcm = _assemble(e).astype(np.int16); sr = int(e["sr"])
            wb = _io.BytesIO(); w = _wave.open(wb, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
            z.writestr(f"parts/{g}.wav", wb.getvalue())
            parts[str(g)] = {"sr": sr, "text": e.get("text", ""), "lines": e.get("lines") or [], "words_ts": e.get("words_ts"),
                             "engine": e.get("engine"), "spans": gulp_lines(g)}
        z.writestr("parts.json", _json.dumps(parts, ensure_ascii=False, default=lambda o: list(o) if isinstance(o, tuple) else (o.item() if hasattr(o, "item") else str(o))))
        if _MUSIC.get("pcm") is not None:
            z.writestr("music.mp3", pcm_to_mp3(_MUSIC["pcm"], _MUSIC["sr"]))
            z.writestr("music.json", _json.dumps({"name": _MUSIC.get("name") or "music"}, ensure_ascii=False))
        if ids:
            man = {}
            for i in sorted(ids):
                z.write(_ASSET_DIR / f"{i}.bin", f"assets/{i}.bin", compress_type=zipfile.ZIP_STORED)
                man[i] = asset_info(i)
            z.writestr("assets.json", _json_v.dumps(man, ensure_ascii=False))
    _diag("project_pack", parts=len(gids), music=_MUSIC.get("pcm") is not None, assets=len(ids))


def project_pack(doc):
    import io as _io
    buf = _io.BytesIO()
    project_pack_to(doc, buf)
    return buf.getvalue()


def project_unpack(src):
    """A .ava (its bytes, or its path — read from disk without loading the whole file) back into the editor's document."""
    import zipfile, io as _io
    if not isinstance(src, (bytes, bytearray)) and os.path.isdir(str(src)):
        return _project_unpack_zip(_RecoveryDir(src))      # a recovery copy (a folder laid out like a .ava's inside)
    with zipfile.ZipFile(_io.BytesIO(src) if isinstance(src, (bytes, bytearray)) else str(src)) as z:
        return _project_unpack_zip(z)


def _project_unpack_zip(z):
    import io as _io, json as _json, wave as _wave, base64 as _b64
    names = set(z.namelist())
    if "project.json" not in names:
        raise RuntimeError("این فایل، فایلِ پروژهٔ آوای جاوید شاه نیست.")
    meta = _json.loads(z.read("project.json").decode("utf-8"))
    parts = _json.loads(z.read("parts.json").decode("utf-8")) if "parts.json" in names else {}
    remap = {}
    for g, info in parts.items():
        w = _wave.open(_io.BytesIO(z.read(f"parts/{g}.wav"))); sr = w.getframerate()
        pcm = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).copy(); w.close()
        ng = next(_gulp_ids)
        _GULP_PCM[ng] = {"sr": sr, "items": [{"kind": "t", "text": "", "span": (0, 0), "pcm": pcm}], "text": info.get("text", ""),
                         "lines": info.get("lines") or [], "words_ts": [tuple(x) for x in (info.get("words_ts") or [])] or None,
                         "engine": info.get("engine"), "restored": True, "saved_spans": info.get("spans")}
        remap[int(g)] = ng
    doc = meta.get("doc") or {}
    for t in doc.get("tracks", []):
        for c in t.get("clips", []):
            if c.get("gulp") is not None and int(c["gulp"]) in remap:
                c["gulp"] = remap[int(c["gulp"])]
    music = None
    if "music.mp3" in names:
        mname = (_json.loads(z.read("music.json").decode("utf-8")) if "music.json" in names else {}).get("name") or "music"
        raw = z.read("music.mp3")
        music = {"b64": _b64.b64encode(raw).decode("ascii"), "name": mname}
        _PENDING_OPEN["music"] = (raw, mname)          # becomes the engine's music when the page commits the project
    if "assets.json" in names:
        _ASSET_DIR.mkdir(parents=True, exist_ok=True)
        man = _json_v.loads(z.read("assets.json").decode("utf-8"))
        amap = {}
        for i, am in man.items():
            size = z.getinfo(f"assets/{i}.bin").file_size; dst = _ASSET_DIR / f"{i}.bin"
            nid = i if (not dst.exists() or dst.stat().st_size == size) else _uuid_v.uuid4().hex[:16]
            with z.open(f"assets/{i}.bin") as fi, open(_ASSET_DIR / f"{nid}.bin", "wb") as fo:
                _sh_p.copyfileobj(fi, fo, 4 << 20)
            _asset_meta_path(nid).write_text(_json_v.dumps({"name": (am or {}).get("name", nid), "mime": (am or {}).get("mime", "")}, ensure_ascii=False), encoding="utf-8")
            amap[i] = nid
        v = doc.get("video") or {}
        for o in v.get("objects", []):
            if o.get("asset") in amap:
                o["asset"] = amap[o["asset"]]
        if (v.get("pod") or {}).get("bgAsset") in amap:
            v["pod"]["bgAsset"] = amap[v["pod"]["bgAsset"]]
        _diag("project_unpack_assets", n=len(amap))
    if not music:
        _PENDING_OPEN["music"] = None
    _diag("project_unpack", parts=len(remap), music=bool(music))
    return {"doc": doc, "music": music, "remap": {str(k): v for k, v in remap.items()}, "build": int(meta.get("build") or 0)}


_PENDING_OPEN = {"music": None}


def project_forget(keep=()):
    """Starting a project: everything the previous one held in memory goes (its voiced parts, its music)."""
    keep = {int(k) for k in (keep or ())}
    gone = [g for g in list(_GULP_PCM) if g not in keep]
    for g in gone:
        _GULP_PCM.pop(g, None)
    _MUSIC.update(pcm=None, sr=None, prompt="", name=None)
    _G_LAST["tail"] = ""
    _diag("project_forget", parts=len(gone), kept=len(keep))
    return len(gone)


def project_commit(keep=()):
    """The page has taken the opened project: the previous one's parts and music go; the opened file's music (if it has
    one) becomes the engine's music, so exporting and saving again keep it."""
    gone = project_forget(keep)
    pend, _PENDING_OPEN["music"] = _PENDING_OPEN.get("music"), None
    if pend:
        raw, name = pend
        try:
            pcm, sr = _decode_audio(raw)
            _MUSIC.update(pcm=pcm, sr=sr, prompt="project:" + str(name), name=name)
        except Exception as e:
            _diag("project_music_decode_failed", error=str(e)[:120])
    return gone


def project_drop(ids=()):
    """The page said no to an opened project (a newer build's file): its parts go, the current project stays as it was."""
    n = 0
    for g in ids or ():
        try:
            n += _GULP_PCM.pop(int(g), None) is not None
        except (TypeError, ValueError):
            pass
    _PENDING_OPEN["music"] = None
    return n


def project_estimate_mb(doc):
    """About how big the project file will be: its voiced parts (16-bit), its music, its pictures and videos."""
    b = 0
    for g in _project_gids(doc):
        e = _GULP_PCM.get(g) or {}
        try:
            b += sum(len(it["pcm"]) for it in e.get("items", []) if it.get("pcm") is not None) * 2
        except Exception:
            pass
    if _MUSIC.get("pcm") is not None:
        b += int(len(_MUSIC["pcm"]) / max(1, _MUSIC.get("sr") or 44100) * 24000)   # the mp3 (~192 kb/s)
    for i in _video_asset_ids(doc):
        try:
            b += (_ASSET_DIR / f"{i}.bin").stat().st_size
        except OSError:
            pass
    return b / (1 << 20) + 1


def free_mb(folder):
    try:
        return _sh_p.disk_usage(str(folder)).free / (1 << 20)
    except Exception:
        return None


def need_room(folder, need_mb):
    """Refuses (with the numbers) when the disk under `folder` has less room than `need_mb` and a margin."""
    free = free_mb(folder)
    if free is not None and free < need_mb * 1.1 + 64:
        raise RuntimeError(f"روی این دیسک جا نیست: این کار حدود {round(need_mb)} مگابایت جا لازم دارد و فقط {round(free)} مگابایت آزاد است. "
                           "کمی جا باز کنید یا جای دیگری را انتخاب کنید.")


def _backup_previous(path):
    """The version a save replaces goes to AvaModels/backups (the last BACKUPS_KEEP of each project)."""
    import glob as _g
    path = Path(path)
    try:
        _BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stem = re.sub(r"[^\w\-. ]+", "_", path.stem)[:80] or "project"
        _sh_p.copy2(str(path), str(_BACKUP_DIR / f"{stem} {time.strftime('%Y-%m-%d %H.%M.%S')}.ava"))
        olds = sorted(_BACKUP_DIR.glob(f"{_g.escape(stem)} *.ava"), key=lambda q: q.stat().st_mtime)
        for q in olds[:-BACKUPS_KEEP]:
            q.unlink()
    except Exception as e:
        _diag("backup_failed", error=str(e)[:120])


def project_save_safe(doc, path):
    """Writes the project beside its file and swaps it in only when it is complete; keeps the version it replaces."""
    path = Path(path)
    need_room(path.parent, project_estimate_mb(doc))
    tmp = path.with_name(path.name + f".saving-{os.getpid()}")
    try:
        with open(tmp, "wb") as f:
            project_pack_to(doc, f)
            f.flush()
            os.fsync(f.fileno())
        if path.exists():
            _backup_previous(path)
        os.replace(str(tmp), str(path))
    finally:
        try:
            if tmp.exists():
                tmp.unlink()
        except OSError:
            pass
    _diag("project_saved", size_mb=round(path.stat().st_size / (1 << 20), 1))
    return str(path)


# ---- the recovery copy: a FOLDER that grows with the project instead of a whole project file written again every
#      minute and a half (with a long project and its videos that was gigabytes each time — editing would have felt it).
#      Laid out like the inside of a .ava: recovery.json (the document + the parts' text and timing, swapped in whole),
#      parts/<id>.wav (each voiced part, written ONCE), music.mp3 (when the music changes). Pictures and videos are not
#      copied — they stay in the app's own store (AvaModels/assets), where the project refers to them. «current» is this
#      session's copy; at launch a copy left behind by a session that did not end normally becomes «offered».
_REC_LIVE = _RECOVERY_DIR / "current"
_REC_OFFER = _RECOVERY_DIR / "offered"
_REC_STATE = {"parts": {}, "music": None}
_REC_LOCK = __import__("threading").Lock()          # the timer's copy and a manual save's copy never write at once


def _rec_part_fp(e):
    items = tuple((id(it.get("pcm")), -1 if it.get("pcm") is None else len(it["pcm"])) for it in e.get("items", []))
    return (id(e), int(e.get("sr") or 0), items, e.get("text"), id(e.get("lines")), id(e.get("words_ts")))


def _rec_write_atomic(path, data):
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(str(tmp), str(path))


def recovery_write(doc, orig_path=None, name=None, from_save=False):
    """Brings the recovery copy up to date: only new or changed parts are written; the document is swapped in whole."""
    with _REC_LOCK:
        return _recovery_write(doc, orig_path, name, from_save)


def _recovery_write(doc, orig_path, name, from_save):
    import io as _io, json as _json, wave as _wave
    live = _REC_LIVE
    (live / "parts").mkdir(parents=True, exist_ok=True)
    gids, parts, todo = _project_gids(doc), {}, []
    for g in gids:
        e = _GULP_PCM[g]; fp = _rec_part_fp(e)
        if _REC_STATE["parts"].get(g, (None,))[0] != fp or not (live / "parts" / f"{g}.wav").exists():
            todo.append((g, fp))
    need = sum(sum(len(it["pcm"]) for it in _GULP_PCM[g].get("items", []) if it.get("pcm") is not None) * 2 for g, _ in todo) / (1 << 20)
    if need > 1:
        need_room(_RECOVERY_DIR, need)
    for g, fp in todo:
        e = _GULP_PCM[g]; pcm = _assemble(e).astype(np.int16); sr = int(e["sr"])
        wb = _io.BytesIO(); w = _wave.open(wb, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
        _rec_write_atomic(live / "parts" / f"{g}.wav", wb.getvalue())
        _REC_STATE["parts"][g] = (fp, {"sr": sr, "text": e.get("text", ""), "lines": e.get("lines") or [], "words_ts": e.get("words_ts"),
                                       "engine": e.get("engine"), "spans": gulp_lines(g)})
    for g in gids:
        parts[str(g)] = _REC_STATE["parts"][g][1]
    music = None
    if _MUSIC.get("pcm") is not None:
        mfp = (id(_MUSIC["pcm"]), len(_MUSIC["pcm"]), _MUSIC.get("sr"))
        if _REC_STATE["music"] != mfp or not (live / "music.mp3").exists():
            _rec_write_atomic(live / "music.mp3", pcm_to_mp3(_MUSIC["pcm"], _MUSIC["sr"]))
            _REC_STATE["music"] = mfp
        music = {"name": _MUSIC.get("name") or "music"}
    body = {"project": {"format": "ava-project", "version": 1, "build": BUILD, "doc": doc}, "parts": parts, "music": music}
    _rec_write_atomic(live / "recovery.json", _json.dumps(body, ensure_ascii=False, default=lambda o: list(o) if isinstance(o, tuple) else (o.item() if hasattr(o, "item") else str(o))).encode("utf-8"))
    keep = {f"{g}.wav" for g in gids}
    for q in (live / "parts").glob("*.wav"):
        if q.name not in keep:
            try:
                q.unlink()
                _REC_STATE["parts"].pop(int(q.stem), None)
            except (OSError, ValueError):
                pass
    if music is None and (live / "music.mp3").exists():
        (live / "music.mp3").unlink()
        _REC_STATE["music"] = None
    meta = {"path": str(orig_path) if orig_path else None, "name": name or "", "at": time.time(), "build": BUILD, "from_save": bool(from_save)}
    if from_save and orig_path:
        try:
            st = os.stat(str(orig_path)); meta["saved_size"], meta["saved_mtime"] = st.st_size, st.st_mtime
        except OSError:
            pass
    _rec_write_atomic(live / "meta.json", _json.dumps(meta, ensure_ascii=False).encode("utf-8"))
    _diag("recovery_written", new_parts=len(todo), parts=len(gids), from_save=bool(from_save))
    return True


class _RecoveryDir:
    """A recovery folder read with the same names as a .ava's inside (so the project file reader reads it too)."""
    def __init__(self, folder):
        import json as _json
        self.root = Path(folder)
        j = _json.loads((self.root / "recovery.json").read_text(encoding="utf-8"))
        self._mem = {"project.json": _json.dumps(j["project"], ensure_ascii=False).encode("utf-8"),
                     "parts.json": _json.dumps(j.get("parts") or {}, ensure_ascii=False).encode("utf-8")}
        files = [f"parts/{g}.wav" for g in (j.get("parts") or {})]
        if j.get("music") and (self.root / "music.mp3").exists():
            self._mem["music.json"] = _json.dumps(j["music"], ensure_ascii=False).encode("utf-8")
            files.append("music.mp3")
        self._names = set(self._mem) | set(files)

    def namelist(self):
        return sorted(self._names)

    def read(self, name):
        return self._mem[name] if name in self._mem else (self.root / name).read_bytes()


def _rec_meta(folder):
    m, j = folder / "meta.json", folder / "recovery.json"
    if not (m.exists() and j.exists()):
        return None
    try:
        info = json.loads(m.read_text(encoding="utf-8"))
    except Exception:
        info = {}
    try:
        info["size_mb"] = round(sum(q.stat().st_size for q in folder.rglob("*") if q.is_file()) / (1 << 20), 1)
    except OSError:
        pass
    return info


def _rec_worth(info):
    """Is there something the saved file does not have? A copy written by a manual save, with that file unchanged since,
    is just the saved file."""
    if not info:
        return False
    if info.get("from_save") and info.get("path"):
        try:
            st = os.stat(str(info["path"]))
            if st.st_size == info.get("saved_size") and abs(st.st_mtime - float(info.get("saved_mtime") or 0)) < 2:
                return False
        except OSError:
            pass
    return True


def recovery_session_begin():
    """At launch. A copy this app left behind (it closes with nothing unsaved, or after Save / Don't save, and then clears
    its copy — a copy still there means the last session did not end normally) becomes the one offered; a newer one
    replaces an older offered copy. Returns whether there is one to offer."""
    _REC_STATE["parts"].clear(); _REC_STATE["music"] = None
    try:
        info = _rec_meta(_REC_LIVE)
        if info and _rec_worth(info):
            _sh_p.rmtree(str(_REC_OFFER), ignore_errors=True)
            os.replace(str(_REC_LIVE), str(_REC_OFFER))
        else:
            _sh_p.rmtree(str(_REC_LIVE), ignore_errors=True)
        for q in (_RECOVERY_DIR / "current.ava", _RECOVERY_DIR / "current.json", _RECOVERY_DIR / "session.open"):
            if q.exists():
                q.unlink()                                   # earlier 182 drafts' files
    except Exception as e:
        _diag("recovery_begin_failed", error=str(e)[:120])
    return _rec_meta(_REC_OFFER) is not None


def recovery_info():
    """The copy offered at launch (where it came from, when, its size) — None when there is none."""
    return _rec_meta(_REC_OFFER)


def recovery_open():
    """Opens the offered copy; it then becomes this session's copy (the project is still unsaved)."""
    info = recovery_info()
    if not info:
        raise RuntimeError("نسخهٔ بازیابی پیدا نشد.")
    out = project_unpack(str(_REC_OFFER))
    out["recovery"] = info
    try:
        _sh_p.rmtree(str(_REC_LIVE), ignore_errors=True)
        os.replace(str(_REC_OFFER), str(_REC_LIVE))
        _REC_STATE["parts"].clear(); _REC_STATE["music"] = None
    except OSError as e:
        _diag("recovery_adopt_failed", error=str(e)[:120])
    return out


def recovery_discard():
    """«Discard» on the offer: the offered copy goes."""
    _sh_p.rmtree(str(_REC_OFFER), ignore_errors=True)
    return True


def recovery_clear():
    """This session's copy goes (closing with nothing unsaved, or «Don't save»)."""
    _sh_p.rmtree(str(_REC_LIVE), ignore_errors=True)
    _REC_STATE["parts"].clear(); _REC_STATE["music"] = None
    return True


# ===========================================================================
# 162 · VOICE PREVIEWS — every voice says «پایَنده ایران، جاوید شاه!». Bundled previews are
#   built ONCE on the founder's machine (his keys, his local models) by previews_build and
#   shipped inside the app; any other voice is synthesised on first play and cached.
# ===========================================================================
import hashlib as _hl_p
PREVIEW_TEXT = "پایَنده ایران، جاوید شاه!"
_PREV_DIR = MODELS_DIR / "previews"


def _preview_payload(payload):
    p = dict(payload or {}); p["text"] = PREVIEW_TEXT
    p["g_continuity"] = False; p["f_continuity"] = False; p["g_lead_in"] = ""   # 171: never the previous sample as a lead-in
    for k in ("g38_cast", "g_speakers", "f_speakers"):
        p[k] = []
    return p


def _preview_key_176(p):
    keep = {k: p.get(k) for k in sorted(p) if k not in ("text",) and (k == "engine" or k.startswith(("g_", "f_", "cbx", "exag", "cfg", "temp", "speed", "noise")))}
    return _hl_p.sha1(_json_v.dumps(keep, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:20]


def _preview_key(p):
    """177: a sample belongs to the VOICE (engine, voice, model) — not to the project's other settings, which made a
    voice of your own lose its sample whenever a slider moved."""
    e = p.get("engine")
    keep = ({"engine": e, "v": p.get("g_voice"), "m": p.get("g_model"), "l": p.get("g_lang")} if e == "google" else
            {"engine": e, "v": p.get("f_voice"), "m": p.get("f_model")} if e == "fish" else
            {"engine": e, "v": p.get("cbx_voice")} if e == "chatterbox" else {"engine": e})
    return "v177_" + _hl_p.sha1(_json_v.dumps(keep, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:20]


def voice_preview(payload, status=lambda *a, **k: None):
    """One voice saying the preview line — from the cache when it has been made before."""
    p = _preview_payload(payload); _PREV_DIR.mkdir(parents=True, exist_ok=True)
    f = _PREV_DIR / f"{_preview_key(p)}.mp3"
    if f.exists() and f.stat().st_size > 200:
        return f.read_bytes()
    old = _PREV_DIR / f"{_preview_key_176(p)}.mp3"   # a sample made by 176 for this voice: kept, under its new name
    if old.exists() and old.stat().st_size > 200:
        data = old.read_bytes(); f.write_bytes(data); return data
    _PREVIEW_MODE["on"] = True                 # 171: no word timings for a sample (two transcriptions per sample before)
    try:
        mp3, gid = generate_gulp(p, status)
    finally:
        _PREVIEW_MODE["on"] = False
    _GULP_PCM.pop(gid, None)                                     # a preview is not part of the document
    f.write_bytes(mp3)
    return mp3


def previews_build(jobs, out_dir, status=lambda *a, **k: None, bundled_dir=None):
    """Make ONLY the missing previews (164): a sample already bundled in the app, or already in the
    chosen folder, is not made again (bundled ones are copied in, so the folder ends up complete);
    when the keys run out it stops at once instead of failing every remaining voice."""
    import pathlib as _pl, shutil as _sh
    root = _pl.Path(out_dir); made, copied, kept, failed, stopped = 0, 0, 0, [], None
    bundled = _pl.Path(bundled_dir) if bundled_dir else None
    todo = []
    for j in jobs:
        rel = str(j.get("rel", "")).replace("\\", "/").lstrip("/")
        if not rel.endswith(".mp3") or ".." in rel:
            continue
        dst = root / rel
        if dst.exists() and dst.stat().st_size > 1000:
            kept += 1; continue
        if bundled and (bundled / rel).exists() and (bundled / rel).stat().st_size > 1000:
            dst.parent.mkdir(parents=True, exist_ok=True); _sh.copyfile(bundled / rel, dst); copied += 1; continue
        todo.append((rel, j))
    for i, (rel, j) in enumerate(todo, 1):
        status(f"نمونهٔ صدا {i} از {len(todo)}: {rel}")
        try:
            data = voice_preview(j.get("payload") or {}, status)
            dst = root / rel; dst.parent.mkdir(parents=True, exist_ok=True); dst.write_bytes(data); made += 1
        except Exception as e:
            msg = str(e)
            if any(k in msg.lower() for k in ("quota", "429", "exceeded", "resource_exhausted", "rate limit")):
                stopped = msg[:160]; failed.extend({"rel": r, "error": "not attempted: keys ran out"} for r, _ in todo[i - 1:]); break
            failed.append({"rel": rel, "error": msg[:160]})
    _diag("previews_build", made=made, copied=copied, kept=kept, failed=len(failed), stopped=bool(stopped))
    return {"made": made, "copied": copied, "kept": kept, "failed": failed, "stopped": stopped, "folder": str(root)}


# ===========================================================================
# 163 · MP3 for the video export on macOS versions without a WebKit AudioEncoder
#   (Safari < 26): the page sends the final mix (int16, interleaved) in chunks; the
#   engine encodes it with LAME; the page puts the MP3 frames into the MP4.
# ===========================================================================
_MP3_JOBS = {}


def mp3_begin(sr, ch):
    job = _uuid_v.uuid4().hex[:12]; _MP3_JOBS[job] = {"sr": int(sr), "ch": int(ch), "pcm": bytearray()}; return job


def mp3_chunk(job, b64):
    _MP3_JOBS[job]["pcm"] += _b64m.b64decode(b64); return True


def mp3_end(job):
    j = _MP3_JOBS.pop(job); enc = lameenc.Encoder()
    enc.set_bit_rate(192); enc.set_in_sample_rate(j["sr"]); enc.set_channels(j["ch"]); enc.set_quality(2)
    data = enc.encode(bytes(j["pcm"])) + enc.flush()
    _diag("mp3_for_video", seconds=round(len(j["pcm"]) / 2 / j["ch"] / j["sr"], 1), bytes=len(data))
    return _b64m.b64encode(data).decode("ascii")


# ===========================================================================
# 166 · the music bed from the timeline's MUSIC CLIPS (trimmed, split, duplicated, moved): each clip plays
#   source[in:out] at its place (the source loops when a clip runs past its end); the fade-in on the first
#   clip, the fade-out on the last, 30 ms at every inner edge; the same level and ducking as mix_music.
# ===========================================================================
def mix_music_clips(voice, vsr, music, msr, clips, level_db=-16.0, duck=True, duck_db=12.0, fade_in=1.5, fade_out=1.5):
    if msr != vsr:
        music = _resample(music, msr, vsr)
    v = voice.astype(np.float32); m = music.astype(np.float32)
    if not len(m):
        return voice
    spans = []
    for c in clips or []:
        a = max(0, int(float(c.get("in", 0)) * vsr)); b = int(float(c.get("out", 0)) * vsr); at = max(0, int(float(c.get("at", 0)) * vsr))
        if b - a > int(vsr * 0.05):
            spans.append((a, b, at, float(c.get("gain", 1.0))))   # 172: the clip's own volume
    if not spans:
        return voice
    total = max(len(v), max(at + (b - a) for a, b, at, _g in spans))
    bed = np.zeros(total, dtype=np.float32)
    first = min(at for a, b, at, _g in spans); last = max(at + b - a for a, b, at, _g in spans); edge = int(vsr * 0.03)
    for a, b, at, g in spans:
        n = b - a; seg = m[np.arange(a, b) % len(m)].copy() * g
        fi = min(int(vsr * fade_in) if at == first else edge, n // 2); fo = min(int(vsr * fade_out) if at + n == last else edge, n // 2)
        if fi > 0:
            seg[:fi] *= np.linspace(0, 1, fi)
        if fo > 0:
            seg[n - fo:] *= np.linspace(1, 0, fo)
        bed[at:at + n] += seg
    vr = float(np.sqrt(np.mean(v * v))) or 1.0
    nz = m[np.abs(m) > 1e-3]; mr = float(np.sqrt(np.mean(nz * nz))) if len(nz) else 1.0   # 182: the music's own loudness (each clip's Volume then counts)
    bed *= (vr / mr) * (10 ** (level_db / 20.0))
    if duck and len(v):
        env = _envelope(v / 32768.0, vsr); gate = np.clip(env / 0.6, 0.0, 1.0); g = 1.0 - (1.0 - 10 ** (-duck_db / 20.0)) * gate
        n = min(len(v), len(g)); bed[:n] *= g[:n]
    out = bed.copy(); out[:len(v)] += v
    pk = float(np.abs(out).max()) or 1.0
    if pk > 32000:
        out *= 32000 / pk
    _diag("mix_music_clips", clips=len(spans), seconds=round(total / vsr, 1))
    return out.astype(np.int16)


def gulp_engine(gid):
    """169: which engine made a part (the editor re-voices a line with a changed engine as a fresh take)."""
    e = _GULP_PCM.get(int(gid)) if gid is not None else None
    return (e or {}).get("engine")


_SFX_CACHE = {}


def _sfx_pcm(file):
    """170: a bundled sound effect (ui/sfx/<family>/<key>.mp3) or an absolute audio path → (int16 mono, sr), cached."""
    if file in _SFX_CACHE:
        return _SFX_CACHE[file]
    p = Path(file)
    if not p.is_absolute():
        p = Path(_res_path(str(Path("ui") / file)))
    if not p.exists():
        raise RuntimeError("این افکتِ صوتی روی دستگاه نیست: " + os.path.basename(file))
    pcm, sr = _decode_audio(p.read_bytes())
    _SFX_CACHE[file] = (pcm, sr)
    return _SFX_CACHE[file]


# ===========================================================================
# 176 · LETTER-PRECISE TIMING ON THIS MAC — Meta's Omnilingual ASR (300M CTC, int8 ONNX, Apache-2.0),
#   downloaded once (~290 MB) into AvaModels/timing. One pass over a take gives
#   (1) a transcript with word times — what the lead-in cut, the completeness audit and the line index
#       asked Google for (two requests per line before; none now), and
#   (2) a forced alignment of each line's OWN text: the moment every letter is heard. The caret, trims,
#       splits, reactions and subtitles follow the voice instead of a loudness guess (measured on the
#       founder's project: the guess was off by up to 0.7 s — 3 to 8 letters).
#   Until the model is on disk everything works as before (Google's transcript, the loudness estimate).
# ===========================================================================
import hashlib as _hl_c, tarfile as _tar_c
from collections import OrderedDict as _OD_c
_CTC_URL = ("https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
            "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12.tar.bz2")
_CTC_DIR = MODELS_DIR / "timing"
_CTC_FILES = ("model.int8.onnx", "tokens.txt")
_CTC = {"sess": None, "tok": None, "ids": None, "state": "idle", "pct": 0, "err": "", "cache": _OD_c(),
        "lock": _threading.Lock(), "run": _threading.Lock()}
_CTC_HOP = 320                        # samples per frame at 16 kHz → 20 ms
_CTC_FR = _CTC_HOP / 16000.0
_CTC_LEAD = 0.02                      # a letter fires ~20–40 ms into its sound: the caret passes it as it starts
_CTC_WIN, _CTC_CTX = 30 * 16000, 16000   # long recordings in 30 s windows with 1 s of context each side
_CTC_TAG = re.compile(r"<[^<>\n]{0,40}>|\[[^\[\]\n]{0,40}\]|\{[^{}\n]{0,60}\}|\|[^|\n]{0,60}\||(?<!\S)/[^/\s][^/\n]{0,60}/")
_CTC_TAGTOK = re.compile(r"^(<[^>]*>|\[[^\]]*\]|\{[^}]*\}|\|[^|]*\|)$")
_CTC_MARK = re.compile(r"[ً-ٰٟۖ-ۭ‌‍‎‏ـ]")
_CTC_FOLD = str.maketrans({"ك": "ک", "ي": "ی", "ى": "ی", "ة": "ه", "ۀ": "ه", "أ": "ا", "إ": "ا", "ٱ": "ا", "ؤ": "و", "ئ": "ی"})


def _ctc_have():
    return all((_CTC_DIR / f).exists() and (_CTC_DIR / f).stat().st_size > 1000 for f in _CTC_FILES)


def ctc_state():
    st = _CTC["state"]
    if st == "idle" and _ctc_have():
        st = "ready"
    return {"state": st, "pct": int(_CTC["pct"]), "error": (_CTC["err"] or "")[:160]}


def _ctc_fetch(status):
    """The archive once; only the model and its letter list are kept (nothing else is unpacked)."""
    _CTC_DIR.mkdir(parents=True, exist_ok=True)
    arc, tmp = _CTC_DIR / "model.tar.bz2", _CTC_DIR / "model.tar.bz2.part"
    _CTC["state"], _CTC["pct"] = "downloading", 0
    status("دارم مدلِ زمان‌بندیِ واژه‌ها را یک بار دانلود می‌کنم (290 مگابایت)…")
    with requests.get(_CTC_URL, stream=True, timeout=(20, 120)) as r:
        r.raise_for_status()
        total, done, shown = int(r.headers.get("Content-Length") or 0), 0, -1
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                f.write(chunk); done += len(chunk)
                if total:
                    pct = int(done * 100 / total); _CTC["pct"] = pct
                    if pct // 10 != shown:
                        shown = pct // 10; status(f"مدلِ زمان‌بندیِ واژه‌ها: {pct}%", pct=pct)
    tmp.replace(arc)
    _CTC["state"] = "unpacking"
    with _tar_c.open(arc, "r:bz2") as t:
        for m in t.getmembers():
            name = m.name.rsplit("/", 1)[-1]
            if m.isfile() and name in _CTC_FILES:
                part = _CTC_DIR / (name + ".part")
                with t.extractfile(m) as src, open(part, "wb") as out:
                    shutil.copyfileobj(src, out, 1024 * 1024)
                part.replace(_CTC_DIR / name)
    try:
        arc.unlink()
    except OSError:
        pass
    if not _ctc_have():
        raise RuntimeError("the timing model's archive did not hold its files")
    _CTC["state"] = "idle"


def _ctc_sess():
    if _CTC["sess"] is None:
        with _CTC["lock"]:
            if _CTC["sess"] is None:
                import onnxruntime as ort
                so = ort.SessionOptions(); so.log_severity_level = 3
                so.intra_op_num_threads = max(1, min(8, (os.cpu_count() or 4) - 1))
                tok = {}
                for ln in (_CTC_DIR / "tokens.txt").read_text(encoding="utf-8").split("\n"):
                    k = ln.rfind(" ")
                    if k > 0 and ln[k + 1:].strip().isdigit():
                        tok[ln[:k]] = int(ln[k + 1:])
                sess = ort.InferenceSession(str(_CTC_DIR / "model.int8.onnx"), sess_options=so, providers=["CPUExecutionProvider"])
                _CTC["tok"], _CTC["ids"] = tok, {v: k for k, v in tok.items()}
                _CTC["sess"] = sess
    return _CTC["sess"]


def ctc_ready():
    """True when letters can be timed on this machine (the model is on disk and loads)."""
    if os.environ.get("AVA_TIMING_OFF"):          # the engine test batteries pin the older behaviour
        return False
    if _CTC["sess"] is not None:
        return True
    if _CTC["state"] in ("downloading", "unpacking", "failed") or not _ctc_have():
        return False
    try:
        _ctc_sess(); _CTC["state"] = "ready"
        return True
    except Exception as e:
        _CTC["state"], _CTC["err"] = "failed", str(e)
        _diag("ctc_load_err", err=str(e)[:160])
        return False


def ctc_warm(status=lambda *a, **k: None, notify=None):
    """At launch, in the background: fetch the model when it is missing, load it, tell the page."""
    def go():
        try:
            if not _ctc_have():
                try:
                    ensure_route()
                except Exception:
                    pass
                _ctc_fetch(status)
                status("مدلِ زمان‌بندیِ واژه‌ها آماده است.")
            if ctc_ready():
                _diag("ctc_ready", threads=max(1, min(8, (os.cpu_count() or 4) - 1)))
                if notify:
                    notify()
        except Exception as e:
            _CTC["state"], _CTC["err"] = "failed", str(e)
            _diag("ctc_fetch_err", err=str(e)[:160])
    _threading.Thread(target=go, daemon=True).start()


def _ctc_logp(pcm, sr):
    """Per-frame log-probabilities of every letter (frames × letters), cached by the recording's bytes."""
    pcm = np.ascontiguousarray(pcm)
    key = _hl_c.sha1(pcm.tobytes()).hexdigest() + f":{sr}"
    c = _CTC["cache"]
    if key in c:
        c.move_to_end(key)
        return c[key]
    x = (_resample(pcm, sr, 16000) if sr != 16000 else pcm).astype(np.float32) / 32768.0
    sess = _ctc_sess()

    def run(seg):
        if len(seg) < 800:
            seg = np.pad(seg, (0, 800 - len(seg)))
        with _CTC["run"]:
            return sess.run(None, {"x": seg[None, :].astype(np.float32)})[0][0]
    n = len(x)
    if n <= _CTC_WIN + 2 * _CTC_CTX:
        lg = run(x)
    else:
        parts, pos = [], 0
        while pos < n:
            a, b = max(0, pos - _CTC_CTX), min(n, pos + _CTC_WIN + _CTC_CTX)
            l = run(x[a:b]); f0 = (pos - a) // _CTC_HOP; f1 = f0 + max(1, (min(n, pos + _CTC_WIN) - pos) // _CTC_HOP)
            parts.append(l[f0:min(f1, len(l))]); pos += _CTC_WIN
        lg = np.concatenate(parts)
    m = lg.max(axis=1, keepdims=True)
    lp = (lg - m - np.log(np.exp(lg - m).sum(axis=1, keepdims=True))).astype(np.float32)
    c[key] = lp
    while len(c) > 12:
        c.popitem(last=False)
    return lp


def ctc_words(pcm, sr):
    """The recording's words and their times [(word, start_s, end_s)] — the shape Google's transcript had."""
    lp = _ctc_logp(pcm, sr); ids = lp.argmax(axis=1); ID = _CTC["ids"]; sp = _CTC["tok"].get(" ", -1)
    words, cur, prev = [], None, -1
    for f, i in enumerate(ids.tolist()):
        if i != 0 and i != prev:
            if i == sp:
                if cur:
                    words.append(cur); cur = None
            else:
                ch = ID.get(i, "")
                if ch and not (ch.startswith("<") and ch.endswith(">")):
                    if cur is None:
                        cur = [ch, f, f]
                    else:
                        cur[0] += ch; cur[2] = f
        elif i != 0 and i == prev and cur is not None and i != sp:
            cur[2] = f
        prev = i
    if cur:
        words.append(cur)
    return [(w, round(a * _CTC_FR, 3), round((b + 1) * _CTC_FR, 3)) for w, a, b in words]


def _ctc_char(ch):
    tok = _CTC["tok"]
    if _CTC_MARK.match(ch):
        return None
    c = ch.translate(_CTC_FOLD)
    for cand in (c, c.lower()):
        if cand in tok:
            return cand
    return None


def _ctc_units(text):
    """[(kind, letter_id, c0, c1)] — 'L' a letter (≥ 1 frame), 'W' the word gap (optional), 'S' anything at all
    (a number, a sound tag, an IPA pronunciation; may be empty). Tones, overlaps and a leading «Name:» are skipped."""
    tok, out, n, i = _CTC["tok"], [], len(text), 0
    m = re.match(r"^\s*[^:：\n.!?؟«»\"]{1,24}[:：]\s+", text)
    if m and len(m.group(0).split()) <= 3:
        i = m.end()
    tags = {mm.start(): mm.end() for mm in _CTC_TAG.finditer(text)}
    sp = tok.get(" ")
    while i < n:
        if i in tags:
            j = tags[i]
            if text[i] in "<[/":
                out.append(("S", -1, i, j))
            i = j; continue
        ch = text[i]
        if ch.isspace():
            if out and out[-1][0] != "W" and sp is not None:
                out.append(("W", sp, i, i + 1))
            i += 1; continue
        if ch.isdigit():
            j = i
            while j < n and (text[j].isdigit() or text[j] in "٫٬,./:-٪%"):
                j += 1
            out.append(("S", -1, i, j)); i = j; continue
        c = _ctc_char(ch)
        if c is not None:
            out.append(("L", tok[c], i, i + 1))
        i += 1
    while out and out[-1][0] == "W":
        out.pop()
    while out and out[0][0] == "W":
        out.pop(0)
    return out


def _ctc_spans(lp, units, star_pen=0.1, edge_pen=0.6):
    """Viterbi over [S?, B?, u1, B?, u2, …, B?, S?] (B = CTC blank, S edges absorb a neighbour's stray speech).
    Returns each unit's (first_frame, last_frame), or None for a skipped optional unit."""
    T = lp.shape[0]
    us = [("E", -1, -1, -1)] + list(units) + [("E", -1, -1, -1)]
    S = 2 * len(us) + 1
    emi = np.empty((S, T), dtype=np.float32); lab = np.full(S, -1); opt = np.ones(S, dtype=bool)
    best_any = lp.max(axis=1)
    for s in range(S):
        if s % 2 == 0:
            emi[s] = lp[:, 0]; continue
        kind, tid = us[s // 2][0], us[s // 2][1]
        if kind == "S":
            emi[s] = best_any - star_pen
        elif kind == "E":
            emi[s] = best_any - edge_pen
        else:
            emi[s] = lp[:, tid]; lab[s] = tid; opt[s] = kind == "W"
    NEG = -1e9
    run_opt, longest = 0, 1
    for s in range(S):
        run_opt = run_opt + 1 if opt[s] else 0; longest = max(longest, run_opt)
    allow = []
    for d in range(1, longest + 2):
        a = np.zeros(S, dtype=bool)
        for s in range(d, S):
            if all(opt[s - q] for q in range(1, d)) and not (d > 1 and lab[s] >= 0 and lab[s] == lab[s - d]):
                a[s] = True
        if a.any():
            allow.append((d, a))
    req = np.flatnonzero(~opt)
    first_req = int(req[0]) if len(req) else S - 1
    last_req = int(req[-1]) if len(req) else 0
    dp = np.full(S, NEG, dtype=np.float64); dp[:first_req + 1] = emi[:first_req + 1, 0]
    bp = np.empty((T, S), dtype=np.int32); idx = np.arange(S)
    bp[0] = idx
    for t in range(1, T):
        best = dp.copy(); arg = idx.copy()
        for d, a in allow:
            cand = np.full(S, NEG); cand[d:] = dp[:-d]; cand[~a] = NEG
            mk = cand > best; best[mk] = cand[mk]; arg[mk] = idx[mk] - d
        dp = best + emi[:, t]; bp[t] = arg
    s = int(np.argmax(np.where(idx >= last_req, dp, NEG)))
    path = np.empty(T, dtype=np.int32)
    for t in range(T - 1, -1, -1):
        path[t] = s; s = int(bp[t, s])
    spans = [None] * len(us)
    for t in range(T):
        st = int(path[t])
        if st % 2 == 1:
            k = st // 2
            spans[k] = [t, t] if spans[k] is None else [spans[k][0], t]
    return spans[1:-1]


def _ctc_env(pcm, sr, hop_s=0.01):
    hop = max(1, int(sr * hop_s)); n = len(pcm) // hop
    if n < 1:
        return np.zeros(1), hop_s
    x = pcm[:n * hop].astype(np.float32).reshape(n, hop)
    return np.sqrt((x * x).mean(axis=1) + 1e-6), hop_s


def ctc_align(pcm, sr, text, a=0, b=None, lp=None):
    """Each word of `text` (spoken inside samples a…b of the recording) with its sound's start/end and the
    moment every letter is heard: [{"w", "c0", "c1", "t0", "t1", "lt": [per character], "src": "ctc"}].
    Times are seconds inside the whole recording; tags carry no time (the page skips them)."""
    b = len(pcm) if b is None else int(b); a = max(0, int(a))
    if b - a < sr * 0.1 or not (text or "").strip():
        return None
    lp = _ctc_logp(pcm, sr) if lp is None else lp
    f0, f1 = int(a / sr / _CTC_FR), min(lp.shape[0], int(np.ceil(b / sr / _CTC_FR)) + 1)
    units = _ctc_units(text)
    if not units or f1 - f0 < 3 or not any(u[0] == "L" for u in units):
        return None
    sp = _ctc_spans(lp[f0:f1], units)
    t_off = f0 * _CTC_FR
    at, spike_end = [None] * len(text), [None] * len(text)
    for (kind, tid, c0, c1), s in zip(units, sp):
        if s is None or kind == "W":
            continue
        if kind == "S":
            m = max(1, c1 - c0)
            for q in range(c0, c1):
                at[q] = t_off + (s[0] + (s[1] + 1 - s[0]) * (q - c0) / m) * _CTC_FR
                spike_end[q] = t_off + (s[0] + (s[1] + 1 - s[0]) * (q - c0 + 1) / m) * _CTC_FR
        else:
            at[c0] = t_off + max(0.0, s[0] * _CTC_FR - _CTC_LEAD); spike_end[c0] = t_off + (s[1] + 1) * _CTC_FR
    env, hs = _ctc_env(pcm, sr)
    seg = env[int(a / sr / hs):max(int(a / sr / hs) + 1, int(b / sr / hs))]
    floor = max(30.0, float(seg.max()) * 0.06) if len(seg) else 30.0
    words = []
    for m in re.finditer(r"\S+", text):
        w, c0, c1 = m.group(0), m.start(), m.end()
        if _CTC_TAGTOK.match(w):
            continue
        ts = [at[i] for i in range(c0, c1) if at[i] is not None]
        if not ts:
            continue
        lt, cur = [], None
        for i in range(c0, c1):
            if at[i] is not None:
                cur = at[i]
            lt.append(cur)
        first = next(x for x in lt if x is not None); lt = [round(first if x is None else x, 3) for x in lt]
        ends = [spike_end[i] for i in range(c0, c1) if spike_end[i] is not None]
        words.append({"w": w, "c0": c0, "c1": c1, "t0": min(ts), "t1": max(ends) if ends else max(ts) + _CTC_FR, "lt": lt, "src": "ctc"})
    if not words:
        return None
    # the sound's own edges: back from the first letter to where the voice begins, on from the last letter
    # to where it fades — never into the next word, never past the span
    lo_s, hi_s = a / sr, b / sr
    for k, w in enumerate(words):
        prev_end = words[k - 1]["t1"] if k else lo_s
        nxt = words[k + 1]["t0"] if k + 1 < len(words) else hi_s
        i = int(w["t0"] / hs); lim = max(int(prev_end / hs), int((w["t0"] - 0.15) / hs), 0)
        while i - 1 >= lim and i - 1 < len(env) and env[i - 1] > floor:
            i -= 1
        if i < len(env) and env[i] <= floor:              # a stop's silent closure: the word is heard from its burst
            nxt_l = sorted(set(w["lt"]))[1] if len(set(w["lt"])) > 1 else w["t1"]
            while i + 1 < len(env) and env[i] <= floor and (i + 1) * hs < nxt_l:
                i += 1
        w["t0"] = round(max(prev_end, lo_s, i * hs), 3)
        j = int(w["t1"] / hs); lim2 = min(int(nxt / hs) - 1, int((w["t1"] + 0.35) / hs), len(env) - 1)
        while j + 1 <= lim2 and env[j + 1] > floor:
            j += 1
        w["t1"] = round(min(hi_s, max(w["t1"], (j + 1) * hs), nxt if k + 1 < len(words) else hi_s), 3)
        w["lt"] = [round(max(w["t0"], x), 3) for x in w["lt"]]
    return words


def _ctc_line_spans(e, pcm, sr, text):
    """Per-line spans of a part whose line map is missing: one alignment of the whole text, cut in each gap."""
    lp = _ctc_logp(pcm, sr)
    words = ctc_align(pcm, sr, text.replace("\n", " "), 0, len(pcm), lp=lp)
    if not words:
        return None
    starts, pos, lines = [], 0, text.split("\n")
    for raw in lines:
        starts.append(pos); pos += len(raw) + 1
    per = [[w for w in words if starts[k] <= w["c0"] < starts[k] + len(lines[k])] for k in range(len(lines))]
    keep = [k for k in range(len(lines)) if lines[k].strip()]
    if any(not per[k] for k in keep):
        return None
    env, hs = _ctc_env(pcm, sr); total = len(pcm) / sr; out = []
    for n_, k in enumerate(keep):
        t0 = 0.0 if n_ == 0 else out[-1]["t1"]
        if n_ + 1 < len(keep):
            g0, g1 = per[k][-1]["t1"], per[keep[n_ + 1]][0]["t0"]
            i0, i1 = int(g0 / hs), max(int(g0 / hs) + 1, int(g1 / hs))
            cut = (i0 + int(np.argmin(env[i0:i1]))) * hs if i1 <= len(env) and i1 > i0 else (g0 + g1) / 2
            t1 = round(max(g0, min(g1, cut)), 3)
        else:
            t1 = round(total, 3)
        out.append({"text": lines[k].strip(), "t0": round(t0, 3), "t1": t1, "_k": k})
    return out


_gulp_lines_175 = gulp_lines


def gulp_lines(gid):
    """176: the same spans, their words timed letter by letter on this machine when the model is here;
    a part without a line map is cut into its lines from the alignment instead of coming back whole."""
    spans = _gulp_lines_175(gid)
    e = _GULP_PCM.get(int(gid)) if gid is not None else None
    if not e or not spans or not ctc_ready() or e.get("engine") in ("silence", "file"):
        return spans
    try:
        pcm, sr = _assemble(e), int(e["sr"]); memo = e.setdefault("_ctc_w", {})
        text = (e.get("text") or "").strip()
        if len(spans) == 1 and spans[0].get("whole") and "\n" in text:
            key = ("lines", text)
            if key not in memo:
                memo[key] = _ctc_line_spans(e, pcm, sr, text)
            if memo[key]:
                spans = [{k2: v for k2, v in s.items() if k2 != "_k"} for s in memo[key]]
        for sp in spans:
            if not (sp.get("text") or "").strip():
                continue
            key = (round(float(sp["t0"]), 3), round(float(sp["t1"]), 3), sp["text"])
            if key not in memo:
                ws = ctc_align(pcm, sr, sp["text"], int(float(sp["t0"]) * sr), int(float(sp["t1"]) * sr))
                memo[key] = ws or None               # words are relative to the span's own text
            if memo[key]:
                sp["words"] = [dict(w) for w in memo[key]]
    except Exception as ex:
        _diag("ctc_align_err", err=str(ex)[:160])
    return spans


def _ctc_snap(words, text):
    """The local transcript, spelled the way the text spells it: each heard word that is close to the expected
    word in the same place takes the text's spelling, and the words heard where the text has a number become
    that number (Google wrote «۲۰۲۶»; the local model writes «بیست بیست و شش»). So the completeness audit and the
    boundary finders compare like with like and never call a take incomplete for a spelling."""
    import difflib
    toks = [t for t in re.findall(r"\S+", re.sub(r"\{[^{}\n]{0,60}\}|\|[^|\n]{0,60}\||<[^<>\n]{0,40}>|\[[^\[\]\n]{0,40}\]", " ", text or "")) if _norm_word(t)]
    if not words or not toks:
        return words
    A = [_norm_word(t) for t in toks]; B = [_norm_word(w) for w, _, _ in words]
    n, m = len(A), len(B); GAP = -0.45
    sim = lambda i, j: (difflib.SequenceMatcher(None, A[i], B[j]).ratio() if A[i] and B[j] else 0.0)
    sc = [[0.0] * (m + 1) for _ in range(n + 1)]; bk = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        sc[i][0] = i * GAP; bk[i][0] = 1
    for j in range(1, m + 1):
        sc[0][j] = j * GAP; bk[0][j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            r = sim(i - 1, j - 1); d = sc[i - 1][j - 1] + (r if r >= 0.6 else -1.0)
            u, l = sc[i - 1][j] + GAP, sc[i][j - 1] + GAP
            sc[i][j], bk[i][j] = max((d, 0), (u, 1), (l, 2))
    pairs, i, j = [], n, m
    while i > 0 or j > 0:
        k = bk[i][j]
        if i > 0 and j > 0 and k == 0:
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif i > 0 and (j == 0 or k == 1):
            pairs.append((i - 1, None)); i -= 1
        else:
            pairs.append((None, j - 1)); j -= 1
    pairs.reverse()
    match = {ti: wj for ti, wj in pairs if ti is not None and wj is not None and sim(ti, wj) >= 0.6}
    used, merged = set(match.values()), {}
    anchors = sorted(match.items())
    for ti, tok in enumerate(toks):
        if ti in match or not re.search(r"\d", tok):
            continue
        lo = max([wj for t2, wj in anchors if t2 < ti], default=-1)
        hi = min([wj for t2, wj in anchors if t2 > ti], default=m)
        heard = [j for j in range(lo + 1, hi) if j not in used]
        if heard:
            merged[heard[0]] = (tok, words[heard[0]][1], words[heard[-1]][2]); used.update(heard)
    out = []
    for j, w in enumerate(words):
        if j in merged:
            out.append(merged[j])
        elif j in used:
            ti = next((t2 for t2, wj in match.items() if wj == j), None)
            if ti is not None:
                out.append((toks[ti], w[1], w[2]))
        else:
            out.append(w)
    return out


_google_words_175 = google_words


def google_words(pcm, sr, status, lang=None, text=None):
    """176: the transcript comes from this machine when the timing model is here — no request."""
    if _PREVIEW_MODE["on"]:
        return None
    if ctc_ready():
        try:
            w = ctc_words(pcm, sr)
            if w and text:
                w = _ctc_snap(w, text)
            _diag("ctc_words", n=len(w), audio_s=round(len(pcm) / sr, 1))
            if w:
                return w
        except Exception as ex:
            _diag("ctc_words_err", err=str(ex)[:160])
    return _google_words_175(pcm, sr, status, lang, text)


_word_times_175 = _word_times


def _word_times(pcm, sr, a, b, text):
    """176: the loudness estimate (no timing model yet) no longer gives a tone or a sound tag the time of
    a spoken word (a line with {غمگین} was timed 0.7 s late), and a number weighs what it takes to say."""
    toks = list(re.finditer(r"\S+", text or ""))
    if not toks:
        return []
    keep = [m for m in toks if not _CTC_TAGTOK.match(m.group(0))]
    if not keep:
        return []
    spoken = " ".join((("ـ" * (len(m.group(0)) * 4)) if re.search(r"\d", m.group(0)) else m.group(0)) for m in keep)
    est = _word_times_175(pcm, sr, a, b, spoken)
    if len(est) != len(keep):
        return _word_times_175(pcm, sr, a, b, text)
    out = []
    for m, w in zip(keep, est):
        out.append({"w": m.group(0), "c0": m.start(), "c1": m.end(), "t0": w["t0"], "t1": w["t1"]})
    return out


# 176 · a reaction's recording is found again after a project is reopened: the reaction kept the OLD part number
#       (only the clips were renumbered), so it vanished, its badge stayed and the line looked edited. Every saved
#       reaction recording is packed (not only the ones with a clip on screen) and renumbered with the rest.
_project_unpack_175 = project_unpack


def _ovl_gids(doc):
    out = set()
    for L in ((doc or {}).get("lines") or {}).values():
        for g in [*((L or {}).get("ovlA") or {}).values(), *[r.get("gulp") for r in ((L or {}).get("reacts") or []) if isinstance(r, dict)]]:
            try:
                if g is not None and int(g) in _GULP_PCM:
                    out.add(int(g))
            except (TypeError, ValueError):
                pass
    for t in (doc or {}).get("tracks", []) or []:
        for c in t.get("clips", []) or []:
            if c.get("type") == "ovl" and c.get("gulp") is not None:
                try:
                    if int(c["gulp"]) in _GULP_PCM:
                        out.add(int(c["gulp"]))
                except (TypeError, ValueError):
                    pass
    return out


def _project_pack_176(doc):
    """160's project file, now also carrying every reaction recording the document refers to."""
    import zipfile, io as _io, json as _json, wave as _wave
    buf = _io.BytesIO()
    gids = sorted({int(c["gulp"]) for t in (doc or {}).get("tracks", []) for c in t.get("clips", [])
                   if c.get("gulp") is not None and int(c["gulp"]) in _GULP_PCM} | _ovl_gids(doc))
    parts = {}
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", _json.dumps({"format": "ava-project", "version": 1, "build": BUILD, "doc": doc}, ensure_ascii=False))
        for g in gids:
            e = _GULP_PCM[g]; pcm = _assemble(e).astype(np.int16); sr = int(e["sr"])
            wb = _io.BytesIO(); w = _wave.open(wb, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes(pcm.tobytes()); w.close()
            z.writestr(f"parts/{g}.wav", wb.getvalue())
            parts[str(g)] = {"sr": sr, "text": e.get("text", ""), "lines": e.get("lines") or [], "words_ts": e.get("words_ts"),
                             "engine": e.get("engine"), "spans": gulp_lines(g)}
        z.writestr("parts.json", _json.dumps(parts, ensure_ascii=False, default=lambda o: list(o) if isinstance(o, tuple) else (o.item() if hasattr(o, "item") else str(o))))
        if _MUSIC.get("pcm") is not None:
            z.writestr("music.mp3", pcm_to_mp3(_MUSIC["pcm"], _MUSIC["sr"]))
            z.writestr("music.json", _json.dumps({"name": _MUSIC.get("name") or "music"}, ensure_ascii=False))
    _diag("project_pack", parts=len(gids), music=_MUSIC.get("pcm") is not None)
    return buf.getvalue()


_project_pack_160 = _project_pack_176          # 161's wrapper (assets) calls this name


def project_unpack(data):
    """176: the reactions' part numbers are renumbered exactly like the clips'."""
    out = _project_unpack_175(data)
    remap = {int(k): v for k, v in (out.get("remap") or {}).items()}
    lost = 0
    for L in ((out.get("doc") or {}).get("lines") or {}).values():
        for r in ((L or {}).get("reacts") or []):                 # 176: reactions as records carry their own part
            if isinstance(r, dict) and r.get("hostGulp") is not None:   # … and the take of the line they were timed in
                try:
                    hg = int(r["hostGulp"])
                    r["hostGulp"] = remap.get(hg, None)
                except (TypeError, ValueError):
                    r["hostGulp"] = None
            if isinstance(r, dict) and r.get("gulp") is not None:
                try:
                    g = int(r["gulp"])
                except (TypeError, ValueError):
                    continue
                if g in remap:
                    r["gulp"] = remap[g]
                else:
                    r["gulp"] = None; r["made"] = None; lost += 1
        ov = (L or {}).get("ovlA")
        if not ov:
            continue
        for k in list(ov.keys()):
            try:
                g = int(ov[k])
            except (TypeError, ValueError):
                continue
            if g in remap:
                ov[k] = remap[g]
            else:
                del ov[k]; lost += 1                 # its recording is not in the file: the reaction is voiced again
    if lost:
        _diag("project_unpack_ovl_missing", n=lost)
    return out


# ===========================================================================
# 176 · ONE REQUEST, ONE KEY — every Google request starts at the key after the one the last request used, so
#   the founder's 48 keys share the per-minute limit and it is virtually never reached (each key sees one request
#   in 48). A per-minute 429 no longer waits a minute on the same key: that key rests (in memory) and the very next
#   key answers. A daily 429 retires the key until Pacific midnight. Google's 503 «overloaded» is about Google, not
#   a key: a short back-off with a message, and after a few tries a clear «try again in a minute» (175 retried it
#   three times on EVERY key — with 48 keys that was up to 144 waits). The header's key badge is told whenever a
#   key's state changes.
# ===========================================================================
_G_RR = {"last": None, "lock": _threading.Lock()}
_G_COOL = {}                                   # key → when its per-minute limit lifts (never written to disk)
_KEYS_CHANGED = {"n": 0}
_google_mark_175 = _google_mark


def _google_mark(key, state):
    _google_mark_175(key, state)
    _KEYS_CHANGED["n"] += 1


def _g_order(keys):
    """This request's key order: the key after the last one used first; resting keys at the back."""
    with _G_RR["lock"]:
        last = _G_RR["last"]
        start = (keys.index(last) + 1) % len(keys) if last in keys else 0
        order = keys[start:] + keys[:start]
        _G_RR["last"] = order[0]
    now = time.time()
    return [k for k in order if _G_COOL.get(k, 0) <= now] + sorted([k for k in order if _G_COOL.get(k, 0) > now], key=lambda k: _G_COOL[k])


def google_rotate(call, status, what="گوگل", _rerouted=False, only_key_tag=None):
    keys = _google_usable_keys()
    if only_key_tag:
        keys = [k for k in keys if _key_tag(k) == only_key_tag]
        if not keys:
            raise RuntimeError("این صدای طراحی‌شده فقط با کلیدی کار می‌کند که آن را ساخته، و سهمیهٔ امروزِ آن کلید تمام شده یا آن کلید حذف شده است. فردا دوباره امتحان کنید یا صدای دیگری انتخاب کنید.")
    if not keys:
        if google_keys():
            raise RuntimeError("سهمیهٔ امروزِ همهٔ کلیدهای گوگل تمام شده یا کلیدها معتبر نیستند؛ یک کلید تازه اضافه کنید یا فردا سر بزنید.")
        raise RuntimeError("هنوز کلید گوگل ندارید؛ از دکمهٔ «کلیدهای گوگل» یک کلید رایگان وارد کنید.")
    try:
        ensure_route(status)
    except Exception as e:
        _diag("net_route_err", msg=str(e)[:80])
    queue = _g_order(keys)
    first_key = queue[0] if queue else None
    last, net_keys, busy_tries, waits = None, 0, 0, 0
    while queue:
        key = queue.pop(0)
        if key not in _google_usable_keys():
            continue                                   # retired during this request (daily quota or refused)
        rest = _G_COOL.get(key, 0) - time.time()
        if rest > 0:                                   # every fresher key already met its per-minute limit
            if waits >= 2:
                break
            waits += 1
            status(f"{what}: همهٔ کلیدها به سقفِ درخواست در دقیقه خورده‌اند — {int(rest) + 1} ثانیه صبر می‌کنیم…")
            _diag("google_429_all_resting", wait=round(rest, 1))
            for _ in range(int(rest * 4) + 1):
                _check_cancel(); time.sleep(0.25)
        net_fail = False
        for attempt in range(3):
            _check_cancel()
            try:
                out = call(key)
                with _G_RR["lock"]:
                    _G_RR["last"] = key            # the next request starts after the key that served this one
                _G_COOL.pop(key, None)
                if any(k.get("key") == key and k.get("bad") for k in google_keys()):
                    _google_mark(key, "ok")
                return out
            except Cancelled:
                raise
            except _GoogleHTTP as e:
                last = e
                kind = _google_fault(e.code, e.msg)
                if kind == "tier":
                    _diag("google_tier_stop", code=e.code)
                    raise RuntimeError(f"{what}: " + _TIER_MSG)
                if kind in ("network", "region"):
                    _diag("google_blocked", kind=kind, code=e.code, msg=_google_clean_msg(e.msg))
                    if not _rerouted:
                        _bench(_NET["route"] or "direct")
                        ok, label, report = ensure_route(status, force=True)
                        if ok:
                            status(f"{what}: مسیرِ شبکه عوض شد («{label}»)؛ دوباره امتحان می‌کنم…")
                            with _G_RR["lock"]:                    # 176: the network was the problem, not the key — the retry goes through the same key
                                _G_RR["last"] = keys[(keys.index(key) - 1) % len(keys)] if key in keys else None
                            return google_rotate(call, status, what, _rerouted=True, only_key_tag=only_key_tag)
                        raise RuntimeError(f"{what}: " + net_status_text(ok, label, report) + " هیچ کلیدی نامعتبر نشد.")
                    raise RuntimeError(f"{what}: " + (_NET_BLOCK_MSG if kind == "network" else _REGION_MSG))
                if e.code == 429:
                    full = (e.msg + " " + getattr(e, "raw", "")).lower()
                    if any(w in full for w in ("perday", "per day", "per_day", "daily", "requestsperday")):
                        _diag("google_429", kind="daily"); _google_mark(key, "exhausted")
                        status(f"{what}: سهمیهٔ امروزِ این کلید ته کشید؛ کلیدِ بعدی…")
                        break
                    m = re.search(r'"retrydelay":\s*"(\d+(?:\.\d+)?)s"|retry in (\d+(?:\.\d+)?)\s*s', full)
                    wait = min(65.0, float(next(g for g in m.groups() if g)) + 1.0) if m else 30.0
                    _G_COOL[key] = time.time() + wait      # it rests; the next key answers right away
                    queue.append(key)                       # …and can serve again after its rest
                    _diag("google_429", kind="minute", rest=round(wait, 1))
                    break
                if kind == "key":
                    _google_mark(key, "bad"); status(f"{what}: این کلید را قبول نکرد؛ کلیدِ بعدی…")
                    _diag("google_key_bad", code=e.code, msg=_google_clean_msg(e.msg))
                    break
                if e.code in (401, 403):
                    _diag("google_403_unattributed", msg=_google_clean_msg(e.msg))
                    status(f"{what}: گوگل این درخواست را رد کرد ({e.code})؛ کلیدِ بعدی را امتحان می‌کنم…")
                    break
                if e.code >= 500:                           # Google itself is overloaded: a short back-off, four tries in all
                    busy_tries += 1
                    _diag("google_5xx", code=e.code, msg=e.msg[:120], tries=busy_tries)
                    if busy_tries >= 4:
                        raise RuntimeError(f"{what}: سرورهای گوگل الان شلوغ‌اند ({e.code}) — چهار بار امتحان کردیم. یک دقیقهٔ دیگر دوباره بزنید؛ هیچ کلیدی خراب نشده.")
                    wait = 2 ** busy_tries
                    status(f"{what}: سرورِ گوگل شلوغ است ({e.code}) — {wait} ثانیهٔ دیگر دوباره امتحان می‌کنم ({busy_tries} از 4)…")
                    for _ in range(4 * wait):
                        _check_cancel(); time.sleep(0.25)
                    queue.append(key)
                    break
                raise RuntimeError(f"{what}: {_google_clean_msg(e.msg)}")
            except requests.RequestException as e:
                last = e; net_fail = True
                _diag("google_net", err=type(e).__name__ + ": " + str(e)[:90])
                status(f"{what}: اتصال به گوگل برقرار نشد — تلاش {attempt + 2} از 3…")
                for _ in range(4 * (2 + attempt * 2)):
                    _check_cancel(); time.sleep(0.25)
        net_keys = net_keys + 1 if net_fail and not isinstance(last, _GoogleHTTP) else 0
        if net_keys >= min(2, len(keys)):
            _diag("google_blocked", kind="network", reason="two_keys_unreachable")
            if not _rerouted:
                _bench(_NET["route"] or "direct")
                ok, label, report = ensure_route(status, force=True)
                if ok:
                    status(f"{what}: مسیرِ شبکه عوض شد («{label}»)؛ دوباره امتحان می‌کنم…")
                    with _G_RR["lock"]:                            # 176: the same keys again over the new route
                        _G_RR["last"] = keys[(keys.index(first_key) - 1) % len(keys)] if first_key in keys else None
                    return google_rotate(call, status, what, _rerouted=True, only_key_tag=only_key_tag)
                raise RuntimeError(f"{what}: " + net_status_text(ok, label, report) + " هیچ کلیدی نامعتبر نشد.")
            raise RuntimeError(f"{what}: " + _NET_BLOCK_MSG)
    raise RuntimeError(f"{what}: با هیچ‌کدام از کلیدها جواب نگرفتیم — " +
                       _google_clean_msg(getattr(last, "msg", None) or str(last) or "؟"))


def _g_peek_next(keys):
    """177: the key the next request will try first — _g_order's choice, without taking it."""
    if not keys:
        return None
    with _G_RR["lock"]:
        last = _G_RR["last"]
    start = (keys.index(last) + 1) % len(keys) if last in keys else 0
    order = keys[start:] + keys[:start]; now = time.time()
    fresh = [k for k in order if _G_COOL.get(k, 0) <= now]
    return fresh[0] if fresh else sorted(order, key=lambda k: _G_COOL.get(k, 0))[0]


def google_keys_status():
    """176: «ok» counts every key that still has today's quota (a key resting from its per-minute limit is still
    there in a moment); the header badge shows that number and updates whenever a key's state changes.
    177: «last» marks the key that served the last request, «next» the one the next request tries first."""
    now = time.time(); out = []
    try:
        usable = _google_usable_keys()
    except Exception:
        usable = []
    with _G_RR["lock"]:
        last = _G_RR["last"]
    nxt = _g_peek_next(usable)
    for k in google_keys():
        state = "bad" if k.get("bad") else ("exhausted" if k.get("until", 0) > now else "ok")
        out.append({"key": k["key"], "masked": k["key"][:6] + "•" * 8 + k["key"][-4:] if len(k["key"]) > 12 else "••••",
                    "state": state, "until": k.get("until", 0), "resting": max(0, int(_G_COOL.get(k["key"], 0) - now)),
                    "last": k["key"] == last, "next": k["key"] == nxt})
    return out


# ===========================================================================
# 176 · the sound library has nine families (the 44 sounds that came from one film were folded into them under plain
#   names); a clip saved with an old path still plays. The film's score is a built-in track of the music library.
# ===========================================================================
_SFX_MOVED = None
_sfx_pcm_175 = _sfx_pcm


def _sfx_pcm(file):
    global _SFX_MOVED
    try:
        return _sfx_pcm_175(file)
    except RuntimeError:
        if _SFX_MOVED is None:
            try:
                _SFX_MOVED = json.loads(Path(_res_path(str(Path("ui") / "sfx" / "index.json"))).read_text(encoding="utf-8")).get("moved", {})
            except Exception:
                _SFX_MOVED = {}
        new = _SFX_MOVED.get(str(file))
        if new:
            return _sfx_pcm_175(new)
        raise


def _builtin_music():
    try:
        return json.loads(Path(_res_path(str(Path("ui") / "music" / "index.json"))).read_text(encoding="utf-8"))
    except Exception:
        return []


_music_list_175, _music_load_175, _music_delete_175 = music_list, music_load, music_delete


def music_list():
    """176: the app's own tracks first (they cannot be deleted), then this machine's library."""
    return _builtin_music() + _music_list_175()


def music_load(file):
    f = str(file or "")
    if f.startswith("builtin:"):
        p = Path(_res_path(str(Path("ui") / "music" / os.path.basename(f[len("builtin:"):]))))
        if not p.exists():
            raise RuntimeError("این موسیقی در این نسخهٔ برنامه نیست.")
        pcm, sr = _decode_audio(p.read_bytes())
        _MUSIC.update({"pcm": pcm, "sr": sr, "prompt": f})
        return pcm, sr
    return _music_load_175(file)


def music_delete(file):
    if str(file or "").startswith("builtin:"):
        return music_list()                         # a built-in track stays
    _music_delete_175(file)
    return music_list()


# ===========================================================================
# 177 · A PAUSE UNDER A REACTION IS TAKEN OUT — when the voice still leaves a gap mid-sentence where a reaction is laid
#       over it after two takes, the editor asks for the part with that silence removed: the audio closes up with a
#       short crossfade, every line span after it moves up, and the words are timed again on the new audio.
# ===========================================================================
def gulp_cut(gid, t0, t1):
    e = _GULP_PCM.get(int(gid))
    if not e:
        raise RuntimeError("این بخش دیگر در حافظه نیست؛ دوباره تبدیل به گفتار کنید.")
    sr = int(e["sr"]); raw = _assemble_raw(e)
    t0, t1 = float(t0), float(t1)
    a, b = max(0, int(round(t0 * sr))), min(len(raw), int(round(t1 * sr)))
    if b - a < int(0.05 * sr):
        raise RuntimeError("گپی برای برداشتن نیست.")
    # only a pause is taken out (silence, perhaps a breath): in 20 ms frames, almost none reach a fifth of the part's
    # typical speech level (measured on the founder's take: speech 1000–11000, the pause 12–250 with one breath)
    fl = max(1, int(0.02 * sr))
    def frames(x):
        n = len(x) // fl
        return np.sqrt(np.mean(x[:n * fl].astype(np.float32).reshape(n, fl) ** 2, axis=1)) if n else np.array([0.0])
    allr = frames(raw); sp_lvl = float(np.median(allr[allr > 200])) if np.any(allr > 200) else 2000.0
    rms = frames(raw[a:b])
    if np.mean(rms > max(330.0, 0.2 * sp_lvl)) > 0.12:
        raise RuntimeError("این فاصله ساکت نیست؛ برداشته نشد.")
    h = max(0, min(int(0.006 * sr), a, len(raw) - b))   # a 12 ms crossfade centred on the cut: exactly b − a goes
    hp, tp = raw[:a + h].astype(np.float32), raw[b - h:].astype(np.float32)
    if h:
        w = np.linspace(0.0, 1.0, 2 * h, dtype=np.float32)
        out = np.concatenate([hp[:-2 * h], hp[-2 * h:] * (1 - w) + tp[:2 * h] * w, tp[2 * h:]])
    else:
        out = np.concatenate([hp, tp])
    out = np.clip(out, -32768, 32767).astype(np.int16)
    d = (len(raw) - len(out)) / sr                     # exactly what the audio lost
    cut_end = t0 + d

    def sh(x):
        x = float(x)
        return x - d if x >= cut_end - 1e-6 else (min(x, t0) if x > t0 else x)
    spans = []
    for sp in gulp_lines(gid) or []:
        s2 = {k: v for k, v in sp.items() if k != "words"}
        s2["t0"], s2["t1"] = round(sh(sp["t0"]), 3), round(sh(sp["t1"]), 3)
        if sp.get("words"):
            s2["words"] = [dict(w, t0=round(sh(w["t0"]), 3), t1=round(sh(w["t1"]), 3)) if isinstance(w, dict) and "t0" in w else w for w in sp["words"]]
        spans.append(s2)
    gid2 = next(_gulp_ids)
    entry = {"sr": sr, "items": [{"kind": "t", "text": e.get("text") or "", "pcm": out}], "text": e.get("text") or "",
             "engine": e.get("engine"), "payload": dict(e.get("payload") or {}), "born": time.time(),
             "saved_spans": spans, "cut_from": int(gid)}
    for k in ("gain", "lead_in"):
        if k in e:
            entry[k] = e[k]
    _GULP_PCM[gid2] = entry
    _diag("gulp_cut", gulp=int(gid), new=gid2, t0=round(t0, 3), sec=round(d, 3))
    return pcm_to_mp3(_assemble(entry), sr), gid2
