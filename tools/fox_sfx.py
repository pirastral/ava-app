#!/usr/bin/env python3
"""The founder's «The Fox and the Moon» editor's own sounds, added to the house library (175).

Three sources inside that HTML, all reused as they are:
  1. AvaAudio.LIB — the editor's twelve named sounds, rendered by its own JavaScript (run in node), with the
     editor's own room (the reverb send it gives a sound the user places).
  2. Its transition sounds — one per transition (the app's background transitions come from the same editor).
  3. The film's sound-effects stem — the Python-made sounds embedded as an MP3; each event is cut out on its own.
  4. The film's music stem (Python-made too): the whole score, as one piece to lay under a video.
Each sound: DC removed, silence trimmed, a release where the source stops dead or rings past 5 s, peak -1 dB.
Output: ui/sfx/fox/<key>.mp3 and the «fox» family in ui/sfx/index.json (the 246 synthesised sounds stay).

    python3 tools/fox_sfx.py "/path/to/3_The_Fox_and_the_Moon__editor_.html"
"""
import base64, json, pathlib, re, subprocess, sys, tempfile
import numpy as np
from scipy import signal

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "ui" / "sfx" / "fox"
SR = 48000
NAMES_LIB = {"whoosh": ("وووش", "Whoosh"), "riser": ("رایزر", "Riser"), "fall": ("سقوطِ صدا", "Downsweep"), "swell": ("اوج‌گیری", "Swell"),
             "pop": ("پاپ", "Pop"), "click": ("کلیک", "Click"), "chime": ("زنگوله", "Chime"), "sparkle": ("درخشش", "Sparkle"),
             "boom": ("بوم", "Boom"), "thud": ("تاپ", "Thud"), "glitch": ("گلیچ", "Glitch"), "drop": ("قطرهٔ آب", "Water drop")}
NAMES_TR = {"shatter": ("گذارِ شکستن", "Shatter"), "rise": ("گذارِ بالا رفتن", "Rise"), "crossfade": ("گذارِ محو", "Crossfade"), "cube": ("چرخشِ مکعب و ورق", "Cube spin / card flip"),
            "lens": ("گویِ شیشه‌ای", "Glass ball"), "leak": ("نشتِ نور", "Light leak"), "melt": ("ذوبِ دیتاموش", "Datamosh melt"), "pool": ("آبِ استخر", "Pool water"),
            "rays": ("پرتوهای نور", "God rays"), "barrel": ("اعوجاجِ لنز", "Lens distortion"), "smear": ("کشیدگیِ قاب‌ها", "Smear frames"), "liquid": ("قطرهٔ مایع", "Liquid drop"),
            "glass": ("شیشه و شیشهٔ شیاردار", "Glass pane / reeded glass"), "frosted": ("شیشهٔ مات", "Frosted glass"), "stained": ("شیشهٔ رنگی", "Stained glass"),
            "ink": ("شکوفهٔ جوهر", "Ink bloom"), "burn": ("سوختنِ اخگر", "Ember burn"), "whip": ("پنِ شلاقی", "Whip pan"), "glitch": ("گذارِ گلیچ", "Glitch transition"),
            "zoom": ("زومِ عبوری", "Zoom through"), "mosaic": ("موزاییک", "Mosaic"), "halftone": ("هاف‌تون", "Halftone"), "chrome": ("کرومِ مایع", "Liquid chrome"), "morph": ("دگردیسی", "Morph")}
# the film's sound-effects stem (75 s, Python-made): where each event sits, and what it is (read from its spectrum and rhythm)
STEM_EVENTS = [("castanets", 2.14, 6.05, "قاشقک (کاستانیت)", "Castanets"), ("shimmer", 7.30, 8.30, "درخششِ آکورد", "Shimmer chord"),
               ("soft_whoosh", 12.94, 14.25, "وووشِ نرم", "Soft whoosh"), ("night_wind", 15.05, 30.45, "بادِ شبانه", "Night wind"),
               ("chime_chord", 33.15, 35.05, "آکوردِ زنگ", "Chime chord"), ("long_swell", 35.18, 38.15, "اوجِ بلند", "Long swell"),
               ("short_whoosh", 60.40, 61.30, "وووشِ کوتاه", "Short whoosh"), ("message_chime", 62.15, 63.55, "زنگِ پیام", "Message chime")]


def level(y):
    return np.abs(y) if y.ndim == 1 else np.abs(y).max(axis=1)


def ramp(y, n, rising):
    if n < 2: return y
    r = (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(np.float32)
    if not rising: r = r[::-1]
    sl = slice(0, n) if rising else slice(len(y) - n, len(y))
    y[sl] = (y[sl].T * r).T
    return y


def decliff(y):
    """A sustained sound that stops dead (the stem's chimes were cut by a hard window): end it with a short release
    just before the cliff, and drop the near-silence after it."""
    a = level(y); B = int(0.005 * SR); nb = len(a) // B
    if nb < 12: return y
    e = a[:nb * B].reshape(nb, B).max(axis=1); pk = float(e.max())
    for k in range(nb - 3, 6, -1):
        if e[k] > pk * 0.03 and e[k + 1:k + 3].max() < e[k] * 0.06 and e[k - 6:k].min() > e[k] * 0.5 and e[k + 1:].max() < e[k] * 0.1:
            cut = (k + 1) * B; y = y[:cut].copy(); return ramp(y, int(min(0.08 * SR, cut / 3)), False)
    return y


def finish(y, peak=0.89, max_sec=5.0):
    y = signal.lfilter([1.0, -1.0], [1.0, -0.9985], y, axis=0).astype(np.float32)   # DC blocker (~11 Hz)
    a = level(y); pk = float(a.max()) or 1e-9
    on = np.nonzero(a > pk * 10 ** (-60 / 20))[0]; y = y[max(0, on[0] - int(0.004 * SR)):]
    y = decliff(y); a = level(y)
    tail = np.nonzero(a > pk * 10 ** (-54 / 20))[0]; e = min(len(y), tail[-1] + int(0.05 * SR))
    if max_sec and e > max_sec * SR: e = int(max_sec * SR)
    y = y[:e].copy()
    # the release: long where the sound still rings at its end (a bell capped at max_sec), short where its tail has died away
    rings = float(level(y[-int(0.01 * SR):]).max()) > pk * 0.01
    y = ramp(y, int(min(1.2 * SR, 0.3 * len(y))) if rings else int(min(0.04 * SR, len(y) / 3)), False)
    y = ramp(y, int(min(0.003 * SR, len(y) / 4)), True)
    return (y / (float(level(y).max()) or 1.0) * peak).astype(np.float32)


def write_mp3(y, path):
    """MP3 at 96 kb/s mono, 128 kb/s stereo; if decoding overshoots (lossy coding can), it is encoded again a little lower."""
    ch = 1 if y.ndim == 1 else 2
    for _ in range(3):
        with tempfile.NamedTemporaryFile(suffix=".f32", delete=False) as f: f.write(y.astype(np.float32).tobytes()); raw = f.name
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", raw, "-codec:a", "libmp3lame", "-b:a", "128k" if ch == 2 else "96k", str(path)], check=True)
        pathlib.Path(raw).unlink()
        dec = np.frombuffer(subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path), "-f", "f32le", "-"], capture_output=True, check=True).stdout, np.float32)
        top = float(np.abs(dec).max())
        if top <= 0.97: return top
        y = y * (0.93 / top)
    return top


def main(html_path):
    s = pathlib.Path(html_path).read_text(encoding="utf-8", errors="replace")
    end = s.find("root.AvaAudio = {"); start = s.rfind("(function", 0, end); stop = s.find("})(window);", end) + len("})(window);")
    work = pathlib.Path(tempfile.mkdtemp()); (work / "avaaudio.js").write_text(s[start:stop], encoding="utf-8"); (work / "r").mkdir()
    subprocess.run(["node", str(pathlib.Path(__file__).with_name("fox_render.js")), str(work / "avaaudio.js"), str(work / "r")], check=True)
    i = s.find("window.AVA_ASSETS = ") + len("window.AVA_ASSETS = "); assets, _ = json.JSONDecoder().raw_decode(s, i)
    stems = {}
    for k in ("sfx", "music"):
        (work / f"{k}.mp3").write_bytes(base64.b64decode(assets["stems"][k]))
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(work / f"{k}.mp3"), "-f", "f32le", "-ac", "1", "-ar", str(SR), str(work / f"{k}.f32")], check=True)
        stems[k] = np.fromfile(work / f"{k}.f32", dtype=np.float32)
    stem = stems["sfx"]
    OUT.mkdir(parents=True, exist_ok=True); items = []
    def add(key, y, fa, en, max_sec=5.0):
        y = finish(y, max_sec=max_sec); write_mp3(y, OUT / f"{key}.mp3"); items.append({"fam": "fox", "key": key, "fa": fa, "en": en, "sec": round(len(y) / SR, 2), "file": f"sfx/fox/{key}.mp3"})
    for k, (fa, en) in NAMES_LIB.items():
        add("fox_" + k, np.fromfile(work / "r" / f"lib_{k}.f32", dtype=np.float32).reshape(-1, 2), fa, en)
    for k, (fa, en) in NAMES_TR.items():
        add("fox_tr_" + k, np.fromfile(work / "r" / f"tr_{k}.f32", dtype=np.float32).reshape(-1, 2), fa, en)
    for key, a, b, fa, en in STEM_EVENTS:
        add("fox_film_" + key, stem[int(a * SR):int(b * SR)].copy(), fa, en, max_sec=None)
    add("fox_film_score", stems["music"].copy(), "موسیقیِ فیلم (کامل)", "Film score (whole)", max_sec=None)
    idx_path = ROOT / "ui" / "sfx" / "index.json"; idx = json.loads(idx_path.read_text(encoding="utf-8"))
    idx["families"]["fox"] = {"fa": "روباه و ماه", "en": "The Fox and the Moon"}
    idx["items"] = [x for x in idx["items"] if x.get("fam") != "fox"] + items
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(items)} sounds from the Fox editor → {OUT}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/mnt/user-data/uploads/3_The_Fox_and_the_Moon__editor_.html")
