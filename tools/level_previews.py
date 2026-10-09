# 177 · the voice samples that ship with the app (ui/previews), all at one loudness: every sample's speech is brought to
#        the same level (−18 dB RMS over the frames that carry speech), its peaks held under −1 dBFS by a gentle
#        limiter, and written as mono MP3s at 24 kHz — 128 kb/s, the founder's own quality (178; 177 used 48 kb/s). Usage:
#            python3 tools/level_previews.py <folder with the samples (chatterbox/ fish/ google/<model>/ light/)> ui/previews [kbps]
#        Always level from the ORIGINAL samples, never from files this tool already wrote (each pass would lose a little).
#        Files are matched by their path; the destination keeps anything the source does not have (e.g. default.mp3).
import subprocess, sys, pathlib
import numpy as np

SR, TARGET_DB, CEIL_DB = 24000, -18.0, -1.0
KBPS = 128


def decode(f):
    out = subprocess.run(["ffmpeg", "-v", "quiet", "-i", str(f), "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).astype(np.float32) / 32768.0


def speech_db(x):
    fl = SR // 50; n = len(x) // fl
    if not n:
        return None
    r = np.sqrt(np.mean(x[:n * fl].reshape(n, fl) ** 2, axis=1) + 1e-12)
    act = r[r > 10 ** (-45 / 20)]
    return float(20 * np.log10(np.sqrt(np.mean(act ** 2)))) if len(act) else None


def limit(x, ceil):
    """A peak limiter: instant attack (look-ahead 2 ms), 60 ms release — the speech keeps its shape, only peaks bend."""
    a = np.abs(x); la = int(0.002 * SR)
    if la > 1:
        a = np.maximum.reduce([np.roll(a, -k) for k in range(la)])
    need = np.minimum(1.0, ceil / np.maximum(a, 1e-9))
    g = np.empty_like(need); cur = 1.0; rel = np.exp(-1.0 / (0.060 * SR))
    for i, v in enumerate(need):
        cur = v if v < cur else v + (cur - v) * rel
        g[i] = cur
    return x * g


def encode(x, dst):
    dst.parent.mkdir(parents=True, exist_ok=True)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    subprocess.run(["ffmpeg", "-v", "quiet", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", "-c:a", "libmp3lame", "-b:a", f"{KBPS}k", str(dst)], input=pcm, check=True)


def main(src, dst):
    src, dst = pathlib.Path(src), pathlib.Path(dst); n = 0; report = []
    files = sorted(src.rglob("*.mp3")) + [f for f in sorted(dst.rglob("default.mp3")) if not (src / f.relative_to(dst)).exists()]
    for f in files:
        rel = f.relative_to(src) if src in f.parents else f.relative_to(dst)
        x = decode(f); lv = speech_db(x)
        if lv is None:
            continue
        y = limit(x * 10 ** ((TARGET_DB - lv) / 20), 10 ** (CEIL_DB / 20))
        encode(y, dst / rel); n += 1; report.append((str(rel), round(lv, 1), round(speech_db(y) or 0, 1)))
    lv_after = [r[2] for r in report]
    print(f"{n} samples levelled: before {min(r[1] for r in report)}…{max(r[1] for r in report)} dB, after {min(lv_after)}…{max(lv_after)} dB")


if __name__ == "__main__":
    if len(sys.argv) > 3: KBPS = int(sys.argv[3])
    main(sys.argv[1], sys.argv[2])
