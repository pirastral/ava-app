#!/usr/bin/env python3
"""The house sound-effects library (170). Every sound is synthesised here — no recordings, nothing licensed —
from the recipes the founder's «Fox and the Moon» editor used (swept noise, FM bells, kicks, blips, booms,
water drops), extended into nine families (176: plus 44 sounds folded in under plain names, kept as "own"). Output: ui/sfx/<family>/<key>.mp3 + ui/sfx/index.json.

    python3 tools/make_sfx.py            # writes everything that is missing or changed
"""
import json, math, os, pathlib, subprocess, sys, tempfile
import numpy as np

SR = 44100
TAU = math.pi * 2
ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "ui" / "sfx"
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- primitives (the Fox recipes, in numpy)
def noise(n):
    return rng.uniform(-1, 1, n).astype(np.float32)


def pink(n):
    w = noise(n); y = np.zeros(n, np.float32); b0 = b1 = b2 = 0.0
    for i in range(n):
        b0 = 0.99765 * b0 + w[i] * 0.099046; b1 = 0.963 * b1 + w[i] * 0.2965164; b2 = 0.57 * b2 + w[i] * 1.0526913
        y[i] = (b0 + b1 + b2 + w[i] * 0.1848) * 0.2
    return y


def biquad(kind, f, q):
    w0 = TAU * min(f, SR * 0.45) / SR; al = math.sin(w0) / (2 * q); c = math.cos(w0)
    if kind == "bp":
        b0, b1, b2 = al, 0, -al
    elif kind == "hp":
        b0, b1, b2 = (1 + c) / 2, -(1 + c), (1 + c) / 2
    else:
        b0, b1, b2 = (1 - c) / 2, 1 - c, (1 - c) / 2
    a0, a1, a2 = 1 + al, -2 * c, 1 - al
    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def filt(x, k):
    from scipy.signal import lfilter
    b0, b1, b2, a1, a2 = k
    return lfilter([b0, b1, b2], [1, a1, a2], x).astype(np.float32)


def env(n, a, r):
    e = np.ones(n, np.float32); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e


def t_of(n):
    return np.arange(n, dtype=np.float32) / SR


def swept(dur, f0, f1, shape="swell", q=0.9):
    """band-passed noise whose centre sweeps f0→f1 (whooshes, risers, swells)."""
    n = int(dur * SR); x = noise(n); y = np.zeros(n, np.float32); z = [0.0, 0.0, 0.0, 0.0]
    k = biquad("bp", f0, q)
    for i in range(n):
        if i % 256 == 0:
            k = biquad("bp", f0 * (f1 / f0) ** (i / n), q)
        v = x[i]; o = k[0] * v + k[1] * z[0] + k[2] * z[1] - k[3] * z[2] - k[4] * z[3]
        z[1] = z[0]; z[0] = v; z[3] = z[2]; z[2] = o; y[i] = o
    u = np.linspace(0, 1, n, dtype=np.float32)
    sh = np.sin(np.pi * u) ** 1.5 if shape == "swell" else u ** 2.2 if shape == "rise" else (1 - u) ** 2
    return y * sh * env(n, 0.005, 0.03)


def blip(f0, f1, dur=0.09):
    n = int(dur * SR); t = t_of(n); f = f1 + (f0 - f1) * np.exp(-t / (dur * 0.35))
    ph = np.cumsum(TAU * f / SR); return (np.sin(ph) * np.exp(-t / (dur * 0.4))).astype(np.float32)


def tok(f=520, v=1.0):
    n = int(0.18 * SR); t = t_of(n); c = filt(noise(n), biquad("bp", 1800, 1))
    return ((np.sin(TAU * f * t) * np.exp(-t / 0.035) + 0.4 * c * np.exp(-t / 0.008)) * v).astype(np.float32)


def bell(f, vel=1.0, tau=1.6, ratio=3.5):
    n = int(tau * 3 * SR); t = t_of(n); idx = 2.2 * np.exp(-t / 0.4)
    y = np.sin(TAU * f * t + idx * np.sin(TAU * f * ratio * t)) * np.exp(-t / tau) * vel * np.minimum(1, t / 0.002)
    return y.astype(np.float32)


def boom(dur=1.6, f0=70, f1=30):
    n = int(dur * SR); t = t_of(n); f = f1 + (f0 - f1) * np.exp(-t / 0.3); ph = np.cumsum(TAU * f / SR)
    return np.tanh(1.3 * np.sin(ph) * np.exp(-t / 0.5)).astype(np.float32)


def kick(dec=0.32, f0=120, f1=44):
    n = int(0.6 * SR); t = t_of(n); f = f1 + (f0 - f1) * np.exp(-t / 0.045); ph = np.cumsum(TAU * f / SR)
    return np.tanh(1.6 * np.sin(ph) * np.exp(-t / dec)).astype(np.float32)


def snare(tone=190, dec=0.11):
    n = int(0.45 * SR); t = t_of(n); nz = filt(noise(n), biquad("bp", 3000, 0.7))
    return (0.55 * nz * np.exp(-t / dec) * 2 + 0.5 * np.sin(TAU * tone * t) * np.exp(-t / 0.05)).astype(np.float32)


def hat(dec=0.035, hp=7500):
    n = int(0.2 * SR); t = t_of(n); return (filt(noise(n), biquad("hp", hp, 0.7)) * np.exp(-t / dec)).astype(np.float32)


def burst(dur, hp, tau):
    n = int(dur * SR); t = t_of(n); return (filt(noise(n), biquad("hp", hp, 0.7)) * np.exp(-t / tau)).astype(np.float32)


def tone(f, dur, tau, wave="sine"):
    n = int(dur * SR); t = t_of(n); ph = TAU * f * t
    w = np.sin(ph) if wave == "sine" else np.sign(np.sin(ph)) * 0.5 if wave == "square" else (2 * ((f * t) % 1) - 1) * 0.5
    return (w * np.exp(-t / tau)).astype(np.float32)


def ep(f, dur, vel=0.8, tau=1.6):
    """the Fox electric piano: FM with a slow index, a touch of the octave."""
    n = int((dur + 1.2) * SR); t = t_of(n); idx = 1.4 * vel * np.exp(-t / 0.28) + 0.25; ph = TAU * f * t
    y = np.sin(ph + idx * np.sin(ph)) * np.exp(-t / tau) + 0.12 * vel * np.sin(2 * ph) * np.exp(-t / (tau * 0.6))
    return (y * np.minimum(1, t / 0.004)).astype(np.float32)


def drop(dur=0.2, f0=900, f1=1400, k=40, tau=22):
    n = int(dur * SR); t = t_of(n); f = f0 + f1 * np.exp(-t * k); ph = np.cumsum(TAU * f / SR)
    return (np.sin(ph) * np.exp(-t * tau)).astype(np.float32)


def mix(*parts, gap=0.0, gain=None):
    """lay parts one after another (gap seconds apart, may be negative for overlap)."""
    out = np.zeros(1, np.float32); pos = 0
    for k, p in enumerate(parts):
        g = gain[k] if gain else 1.0
        i0 = max(0, pos); need = i0 + len(p)
        if need > len(out):
            out = np.concatenate([out, np.zeros(need - len(out), np.float32)])
        out[i0:i0 + len(p)] += p * g; pos = i0 + len(p) + int(gap * SR)
    return out


def layer(*parts, at=None, gain=None):
    """mix parts starting at the given seconds."""
    at = at or [0] * len(parts); n = max(int(a * SR) + len(p) for a, p in zip(at, parts)); out = np.zeros(n, np.float32)
    for k, (a, p) in enumerate(zip(at, parts)):
        i0 = int(a * SR); out[i0:i0 + len(p)] += p * (gain[k] if gain else 1.0)
    return out


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def echo(x, delay=0.18, fb=0.35, n=4):
    out = x.copy()
    for k in range(1, n + 1):
        d = int(delay * k * SR); pad = np.zeros(d, np.float32); out = np.concatenate([out, np.zeros(d, np.float32)]) if len(out) < len(x) + d else out
        out[d:d + len(x)] += x * (fb ** k)
    return out


def reverb(x, size=0.9, wet=0.35):
    """a cheap but musical tail: a few comb delays summed."""
    tail = int(size * 1.5 * SR); out = np.concatenate([x, np.zeros(tail, np.float32)])
    for d, g in ((0.029, 0.72), (0.037, 0.66), (0.047, 0.6), (0.061, 0.55)):
        dd = int(d * size * SR); y = np.zeros_like(out)
        for i in range(dd, len(out)):
            y[i] = out[i - dd] * g + y[i - dd] * (g * 0.6) if i - dd >= 0 else 0
        out = out + y * wet * 0.5
    return out.astype(np.float32)


def normalize(x, peak=0.89):
    m = float(np.max(np.abs(x))) or 1.0; return (x / m * peak).astype(np.float32)


def fade(x, a=0.002, r=0.02):
    return x * env(len(x), a, r)


# ---------------------------------------------------------------- the library
# every entry: key, Persian name, English name, recipe (a function returning float32 samples)
L = []


def add(fam, key, fa, en, fn):
    L.append((fam, key, fa, en, fn))


FAM = {"whoosh": ("وووش و حرکت", "Whooshes and motion"), "hit": ("ضربه و برخورد", "Hits and impacts"), "ui": ("بلیپ و کلیک", "Blips and clicks"),
       "bell": ("زنگ و چایم", "Bells and chimes"), "glitch": ("گلیچ و دیجیتال", "Glitch and digital"), "nature": ("طبیعت و فضا", "Nature and ambience"),
       "trans": ("همراهِ گذارها", "For the transitions"), "foley": ("فولی و واکنش", "Foley and reactions"), "music": ("نت و آکوردِ کوتاه", "Musical stingers")}

# whooshes --------------------------------------------------------------
for i, (d, f0, f1, sh, nm_fa, nm_en) in enumerate([(0.7, 300, 4200, "swell", "وووشِ کلاسیک", "Classic whoosh"), (0.4, 400, 5000, "swell", "وووشِ کوتاه", "Short whoosh"), (1.1, 200, 3800, "swell", "وووشِ بلند", "Long whoosh"),
        (0.6, 2800, 300, "fall", "وووشِ رو به پایین", "Downward whoosh"), (0.6, 300, 2800, "rise", "وووشِ رو به بالا", "Upward whoosh"), (0.8, 120, 900, "swell", "وووشِ تاریک", "Dark whoosh"), (0.5, 1500, 7000, "swell", "وووشِ هوایی", "Airy whoosh")]):
    add("whoosh", f"whoosh_{i + 1}", nm_fa, nm_en, (lambda d=d, f0=f0, f1=f1, sh=sh: swept(d, f0, f1, sh, 0.9)))
for i, d in enumerate([0.8, 1.6, 2.4, 3.2]):
    add("whoosh", f"riser_{i + 1}", f"رایزرِ {['کوتاه', 'میانه', 'بلند', 'خیلی بلند'][i]}", f"Riser {['short', 'medium', 'long', 'very long'][i]}", (lambda d=d: swept(d, 150, 3200, "rise", 0.7)))
for i, d in enumerate([0.6, 1.0, 1.8]):
    add("whoosh", f"fall_{i + 1}", f"سقوطِ {['کوتاه', 'میانه', 'بلند'][i]}", f"Downsweep {['short', 'medium', 'long'][i]}", (lambda d=d: swept(d, 3000, 200, "fall", 1.0)))
for i, (d, f0, f1) in enumerate([(2.0, 120, 900), (3.0, 90, 600), (1.4, 300, 2200)]):
    add("whoosh", f"swell_{i + 1}", f"سوئلِ {['نرم', 'عمیق', 'روشن'][i]}", f"Swell {['soft', 'deep', 'bright'][i]}", (lambda d=d, f0=f0, f1=f1: swept(d, f0, f1, "swell", 0.7)))
add("whoosh", "reverse_whoosh", "وووشِ وارونه", "Reverse whoosh", lambda: swept(0.8, 300, 4200, "rise", 0.9)[::-1].copy())
add("whoosh", "double_whoosh", "دو وووش", "Double whoosh", lambda: mix(swept(0.35, 400, 4500, "swell"), swept(0.5, 300, 3800, "swell"), gap=-0.08))
add("whoosh", "flutter", "بال‌زدن", "Flutter", lambda: swept(0.9, 500, 3000, "swell") * (0.6 + 0.4 * np.sin(TAU * 14 * t_of(int(0.9 * SR)))))
add("whoosh", "wind_gust", "وزشِ باد", "Wind gust", lambda: swept(1.6, 200, 1200, "swell", 0.5))
add("whoosh", "jet_pass", "عبورِ جت", "Jet pass", lambda: swept(2.2, 2500, 600, "swell", 0.6))
add("whoosh", "swish", "سوییش", "Swish", lambda: swept(0.25, 1800, 6000, "swell", 1.2))
add("whoosh", "rocket", "موشک", "Rocket", lambda: mix(swept(0.4, 150, 900, "rise"), swept(1.4, 900, 5000, "swell"), gap=-0.1))
add("whoosh", "warp", "وارپ", "Warp", lambda: layer(swept(1.0, 200, 6000, "rise", 2.0), swept(1.0, 6000, 200, "fall", 2.0)))

# hits ------------------------------------------------------------------
for i, (d, f0, f1) in enumerate([(1.4, 70, 30), (2.2, 55, 25), (0.9, 90, 40)]):
    add("hit", f"boom_{i + 1}", f"بومِ {['سینمایی', 'عمیق', 'کوتاه'][i]}", f"Boom {['cinematic', 'deep', 'short'][i]}", (lambda d=d, f0=f0, f1=f1: boom(d, f0, f1)))
add("hit", "thud", "تاپ", "Thud", lambda: kick(0.25, 120, 45))
for i, (dec, f0, f1) in enumerate([(0.32, 120, 44), (0.18, 160, 50), (0.5, 100, 36)]):
    add("hit", f"kick_{i + 1}", f"کیکِ {['معمولی', 'خشک', 'بلند'][i]}", f"Kick {['standard', 'tight', 'long'][i]}", (lambda dec=dec, f0=f0, f1=f1: kick(dec, f0, f1)))
add("hit", "snare_1", "اسنیر", "Snare", lambda: snare())
add("hit", "snare_2", "اسنیرِ کوتاه", "Tight snare", lambda: snare(220, 0.06))
add("hit", "hat_closed", "های‌هتِ بسته", "Closed hat", lambda: hat(0.035))
add("hit", "hat_open", "های‌هتِ باز", "Open hat", lambda: hat(0.22))
add("hit", "clap", "کف‌زدن", "Clap", lambda: layer(mix(*[burst(0.09, 1200, 0.03) for _ in range(3)], gap=-0.07), burst(0.3, 900, 0.09)))
add("hit", "slam", "کوبیدن", "Slam", lambda: layer(kick(0.3, 90, 38), burst(0.4, 400, 0.08), gain=[1, 0.6]))
add("hit", "punch", "مشت", "Punch", lambda: layer(kick(0.12, 140, 60), burst(0.15, 700, 0.03), gain=[1, 0.5]))
add("hit", "sub_drop", "سابِ افتان", "Sub drop", lambda: boom(2.0, 90, 20))
for i, d in enumerate([1.8, 2.8, 4.0]):
    add("hit", f"cine_hit_{i + 1}", f"ضربهٔ سینماییِ {['کوتاه', 'میانه', 'بلند'][i]}", f"Cinematic hit {['short', 'medium', 'long'][i]}", (lambda d=d: layer(boom(d, 65, 28), burst(0.6, 300, 0.12), swept(d * 0.6, 200, 60, "fall", 0.6), gain=[1, 0.5, 0.5])))
add("hit", "knock_1", "در زدن", "Knock", lambda: mix(tok(180, 1), tok(170, 0.9), tok(185, 1), gap=0.12))
add("hit", "knock_2", "دو تقه", "Two knocks", lambda: mix(tok(190, 1), tok(175, 1), gap=0.15))
add("hit", "stomp", "پاکوب", "Stomp", lambda: layer(kick(0.2, 80, 35), burst(0.25, 250, 0.05), gain=[1, 0.7]))
add("hit", "metal_hit", "ضربهٔ فلزی", "Metal hit", lambda: layer(bell(mtof(69), 1, 0.4, 7.1), burst(0.2, 2500, 0.03), gain=[1, 0.4]))
add("hit", "anvil", "سندان", "Anvil", lambda: layer(bell(mtof(81), 1, 0.9, 11.3), bell(mtof(93), 0.6, 0.5, 5.7), gain=[1, 0.5]))
add("hit", "wood_block", "بلوکِ چوبی", "Wood block", lambda: tok(820, 1))
add("hit", "tom", "تام", "Tom", lambda: kick(0.3, 180, 95))
add("hit", "crash", "کرش", "Crash", lambda: burst(1.6, 4000, 0.5) * 0.8)
add("hit", "ride", "راید", "Ride", lambda: layer(hat(0.6, 5000), tone(3600, 0.8, 0.25), gain=[1, 0.3]))

# ui / blips --------------------------------------------------------------
for i, (f0, f1) in enumerate([(500, 1500), (380, 1100), (700, 2100), (260, 800)]):
    add("ui", f"pop_{i + 1}", f"پاپِ {['معمولی', 'بم', 'زیر', 'خیلی بم'][i]}", f"Pop {['standard', 'low', 'high', 'very low'][i]}", (lambda f0=f0, f1=f1: blip(f0, f1, 0.09)))
for i, f in enumerate([900, 600, 1400, 2200]):
    add("ui", f"click_{i + 1}", f"کلیکِ {['معمولی', 'نرم', 'تیز', 'ریز'][i]}", f"Click {['standard', 'soft', 'sharp', 'tiny'][i]}", (lambda f=f: tok(f, 1)))
add("ui", "tick", "تیک", "Tick", lambda: burst(0.03, 3000, 0.006))
add("ui", "blip_up", "بلیپِ بالا", "Blip up", lambda: blip(1200, 500, 0.12))
add("ui", "blip_down", "بلیپِ پایین", "Blip down", lambda: blip(500, 1200, 0.12))
add("ui", "blip_double", "بلیپِ دوتایی", "Double blip", lambda: mix(blip(600, 1400, 0.07), blip(900, 1900, 0.07), gap=0.04))
add("ui", "confirm", "تأیید", "Confirm", lambda: mix(tone(mtof(76), 0.12, 0.08), tone(mtof(83), 0.25, 0.12), gap=-0.02))
add("ui", "cancel", "لغو", "Cancel", lambda: mix(tone(mtof(71), 0.12, 0.08), tone(mtof(64), 0.25, 0.12), gap=-0.02))
add("ui", "error", "خطا", "Error", lambda: mix(tone(220, 0.14, 0.3, "square"), tone(220, 0.14, 0.3, "square"), gap=0.06))
add("ui", "notify_1", "اعلانِ ۱", "Notification 1", lambda: mix(tone(mtof(84), 0.2, 0.18), tone(mtof(88), 0.35, 0.25), gap=-0.05))
add("ui", "notify_2", "اعلانِ ۲", "Notification 2", lambda: mix(bell(mtof(88), 0.7, 0.5, 2.0), bell(mtof(95), 0.7, 0.8, 2.0), gap=-0.3))
add("ui", "notify_3", "اعلانِ ۳", "Notification 3", lambda: mix(tone(mtof(79), 0.1, 0.1), tone(mtof(84), 0.1, 0.1), tone(mtof(91), 0.4, 0.3), gap=-0.02))
add("ui", "toggle_on", "روشن", "Toggle on", lambda: blip(700, 1100, 0.06))
add("ui", "toggle_off", "خاموش", "Toggle off", lambda: blip(1100, 700, 0.06))
add("ui", "hover", "هاور", "Hover", lambda: burst(0.05, 2500, 0.012) * 0.6)
add("ui", "select", "انتخاب", "Select", lambda: layer(tok(1200, 0.6), blip(900, 1300, 0.05), gain=[1, 0.5]))
for i, f in enumerate([2400, 3100, 1900]):
    add("ui", f"key_{i + 1}", f"کلیدِ تایپ {i + 1}", f"Keyboard key {i + 1}", (lambda f=f: layer(tok(f, 0.5), burst(0.04, 2000, 0.01), gain=[1, 0.8])))
add("ui", "typing", "تایپ‌کردن", "Typing", lambda: mix(*[layer(tok(2200 + rng.integers(-500, 500), 0.5), burst(0.04, 2000, 0.01)) for _ in range(9)], gap=0.055 + 0.0))
add("ui", "shutter", "شاترِ دوربین", "Camera shutter", lambda: mix(burst(0.05, 3000, 0.01), tok(1400, 0.8), burst(0.08, 1500, 0.02), gap=0.03))
add("ui", "page_flip", "ورق‌زدن", "Page flip", lambda: swept(0.35, 2000, 6000, "swell", 1.5) * 0.7)
add("ui", "swipe", "سوایپ", "Swipe", lambda: swept(0.2, 3000, 800, "fall", 1.5))
add("ui", "unlock", "بازشدن", "Unlock", lambda: mix(tok(1000, 1), tok(1500, 1), gap=0.07))
add("ui", "lock", "قفل", "Lock", lambda: mix(tok(1500, 1), tok(1000, 1), gap=0.07))
add("ui", "coin", "سکه", "Coin", lambda: mix(tone(mtof(88), 0.08, 0.1), tone(mtof(95), 0.4, 0.3), gap=-0.01))
add("ui", "level_up", "ارتقا", "Level up", lambda: mix(*[tone(mtof(m), 0.1, 0.12) for m in (72, 76, 79, 84)], gap=-0.02) + 0.0)
add("ui", "countdown_tick", "تیکِ شمارش", "Countdown tick", lambda: tone(1000, 0.08, 0.04))
add("ui", "countdown_go", "شروع", "Countdown go", lambda: tone(2000, 0.5, 0.3))
add("ui", "message_sent", "پیام رفت", "Message sent", lambda: swept(0.25, 800, 4000, "rise", 2.0) * 0.6)
add("ui", "message_in", "پیام آمد", "Message received", lambda: mix(blip(900, 1500, 0.06), blip(1200, 1800, 0.08), gap=0.02))
add("ui", "radar", "رادار", "Radar ping", lambda: echo(tone(1600, 0.2, 0.1), 0.25, 0.45, 3))
add("ui", "scan", "اسکن", "Scan", lambda: swept(0.9, 600, 2400, "swell", 4.0) * (0.6 + 0.4 * np.sign(np.sin(TAU * 30 * t_of(int(0.9 * SR))))))

# bells and chimes ----------------------------------------------------------
for i, m in enumerate([72, 76, 79, 84, 88, 91, 95, 100]):
    add("bell", f"bell_{i + 1}", f"زنگِ نتِ {['دو', 'می', 'سل', 'دو', 'می', 'سل', 'سی', 'می'][i]}{'' if i < 3 else '́'}", f"Bell note {i + 1}", (lambda m=m: bell(mtof(m), 0.8, 1.4, 3.5)))
add("bell", "chime", "چایم", "Chime", lambda: bell(mtof(88), 0.6, 1.4, 2.76))
add("bell", "chime_low", "چایمِ بم", "Low chime", lambda: bell(mtof(76), 0.7, 2.0, 2.76))
add("bell", "chime_double", "چایمِ دوتایی", "Double chime", lambda: mix(bell(mtof(88), 0.6, 1.0, 2.76), bell(mtof(93), 0.6, 1.4, 2.76), gap=-2.7))
add("bell", "sparkle", "جرقه", "Sparkle", lambda: layer(*[bell(mtof(m), 0.4, 0.7) for m in (88, 91, 95, 98, 100, 103)], at=[k * 0.09 for k in range(6)], gain=[0.5] * 6))
add("bell", "sparkle_long", "جرقهٔ بلند", "Long sparkle", lambda: layer(*[bell(mtof(m), 0.35, 1.0) for m in (84, 88, 91, 95, 98, 100, 103, 107)], at=[k * 0.11 for k in range(8)], gain=[0.45] * 8))
add("bell", "sparkle_down", "جرقهٔ فرودی", "Falling sparkle", lambda: layer(*[bell(mtof(m), 0.4, 0.7) for m in (103, 100, 98, 95, 91, 88)], at=[k * 0.09 for k in range(6)], gain=[0.5] * 6))
for i, m in enumerate([91, 96, 100]):
    add("bell", f"glass_{i + 1}", f"دینگِ شیشه‌ایِ {['بم', 'میانه', 'زیر'][i]}", f"Glass ding {['low', 'mid', 'high'][i]}", (lambda m=m: bell(mtof(m), 0.7, 0.9, 5.0)))
add("bell", "arpeggio_major", "آرپژِ ماژور", "Major arpeggio", lambda: layer(*[bell(mtof(m), 0.5, 1.2, 2.76) for m in (72, 76, 79, 84)], at=[0, 0.12, 0.24, 0.36], gain=[0.6] * 4))
add("bell", "arpeggio_minor", "آرپژِ مینور", "Minor arpeggio", lambda: layer(*[bell(mtof(m), 0.5, 1.2, 2.76) for m in (72, 75, 79, 84)], at=[0, 0.12, 0.24, 0.36], gain=[0.6] * 4))
add("bell", "arpeggio_down", "آرپژِ فرودی", "Falling arpeggio", lambda: layer(*[bell(mtof(m), 0.5, 1.2, 2.76) for m in (84, 79, 76, 72)], at=[0, 0.12, 0.24, 0.36], gain=[0.6] * 4))
add("bell", "music_box_1", "جعبهٔ موسیقی ۱", "Music box 1", lambda: layer(*[bell(mtof(m), 0.5, 1.0, 4.0) for m in (84, 88, 91, 88, 84, 79)], at=[k * 0.22 for k in range(6)], gain=[0.55] * 6))
add("bell", "music_box_2", "جعبهٔ موسیقی ۲", "Music box 2", lambda: layer(*[bell(mtof(m), 0.5, 1.0, 4.0) for m in (79, 84, 88, 93, 88, 84, 79)], at=[k * 0.2 for k in range(7)], gain=[0.55] * 7))
add("bell", "triangle_1", "مثلث", "Triangle", lambda: bell(mtof(105), 0.6, 1.8, 6.5))
add("bell", "triangle_2", "مثلثِ کوتاه", "Short triangle", lambda: bell(mtof(105), 0.6, 0.4, 6.5))
add("bell", "gong", "گانگ", "Gong", lambda: layer(bell(mtof(50), 1, 3.5, 1.41), bell(mtof(57), 0.6, 3.0, 2.0), burst(0.3, 400, 0.08), gain=[1, 0.5, 0.3]))
add("bell", "tubular", "زنگِ لوله‌ای", "Tubular bell", lambda: bell(mtof(69), 0.9, 2.5, 1.0 * 3.5))
add("bell", "wind_chime", "زنگِ بادی", "Wind chime", lambda: layer(*[bell(mtof(m), 0.35, 1.3, 5.0) for m in (96, 100, 103, 108, 100, 96, 103)], at=[0, 0.3, 0.55, 0.9, 1.3, 1.5, 1.9], gain=[0.5] * 7))

# glitch and digital ------------------------------------------------------
def glitch_recipe(k_n=8, step=0.075):
    def f():
        parts = [blip(2600 - k * 150, 400, 0.04) if k % 2 else burst(0.05, 1800, 0.02) for k in range(k_n)]
        return layer(*parts, at=[k * step for k in range(k_n)], gain=[0.8] * k_n)
    return f
for i, (kn, st) in enumerate([(8, 0.075), (12, 0.045), (5, 0.12), (16, 0.03)]):
    add("glitch", f"glitch_{i + 1}", f"گلیچِ {['کلاسیک', 'تند', 'کُند', 'ریز'][i]}", f"Glitch {['classic', 'fast', 'slow', 'fine'][i]}", glitch_recipe(kn, st))
for i, d in enumerate([0.15, 0.4, 0.9]):
    add("glitch", f"static_{i + 1}", f"نویزِ {['کوتاه', 'میانه', 'بلند'][i]}", f"Static {['short', 'medium', 'long'][i]}", (lambda d=d: fade(filt(noise(int(d * SR)), biquad("hp", 1500, 0.7)) * 0.7, 0.01, 0.05)))
add("glitch", "data_1", "داده ۱", "Data 1", lambda: mix(*[tone(1800 + 400 * (k % 3), 0.03, 0.02, "square") for k in range(14)], gap=0.02))
add("glitch", "data_2", "داده ۲", "Data 2", lambda: mix(*[tone(900 + 300 * (k % 4), 0.025, 0.015, "square") for k in range(20)], gap=0.012))
add("glitch", "data_3", "داده ۳", "Data 3", lambda: mix(*[blip(2000 + 200 * (k % 5), 1200, 0.03) for k in range(10)], gap=0.03))
add("glitch", "beep_1", "بیپ", "Beep", lambda: tone(1000, 0.15, 0.4, "square") * 0.5)
add("glitch", "beep_2", "بیپِ دوتایی", "Double beep", lambda: mix(tone(1000, 0.1, 0.4, "square"), tone(1000, 0.1, 0.4, "square"), gap=0.08) * 0.5)
add("glitch", "beep_3", "بیپِ بالارونده", "Rising beeps", lambda: mix(*[tone(f, 0.08, 0.3, "square") for f in (600, 800, 1000, 1300)], gap=0.05) * 0.5)
add("glitch", "modem", "مودم", "Modem", lambda: mix(tone(1200, 0.3, 1), tone(2100, 0.3, 1), filt(noise(int(0.6 * SR)), biquad("bp", 1700, 2)) * 0.5, gap=0.02))
add("glitch", "robot_1", "ربات ۱", "Robot 1", lambda: mix(*[tone(f, 0.12, 0.2, "square") for f in (300, 420, 360, 500)], gap=0.03) * 0.5)
add("glitch", "robot_2", "ربات ۲", "Robot 2", lambda: swept(0.6, 300, 1800, "rise", 6.0) * np.sign(np.sin(TAU * 60 * t_of(int(0.6 * SR)))))
add("glitch", "tape_stop", "توقفِ نوار", "Tape stop", lambda: (lambda n: np.sin(np.cumsum(TAU * (440 * np.maximum(0.02, 1 - np.linspace(0, 1, n) ** 0.7)) / SR)) * np.linspace(1, 0.2, n) * 0.6)(int(0.9 * SR)).astype(np.float32))
add("glitch", "tape_start", "راه‌افتادنِ نوار", "Tape start", lambda: (lambda n: np.sin(np.cumsum(TAU * (440 * np.maximum(0.02, np.linspace(0, 1, n) ** 0.7)) / SR)) * np.linspace(0.2, 1, n) * 0.6)(int(0.7 * SR)).astype(np.float32))
add("glitch", "bitcrush", "بیت‌کراش", "Bitcrush", lambda: np.round(swept(0.5, 400, 3000, "swell", 1.0) * 6) / 6)
add("glitch", "stutter", "لکنت", "Stutter", lambda: mix(*[burst(0.04, 800, 0.015) for _ in range(10)], gap=0.03))

# nature and ambience -------------------------------------------------------
for i, (f0, f1) in enumerate([(900, 1400), (600, 1000), (1400, 2200), (400, 700)]):
    add("nature", f"drop_{i + 1}", f"قطرهٔ آبِ {['معمولی', 'بم', 'زیر', 'بزرگ'][i]}", f"Water drop {['standard', 'low', 'high', 'big'][i]}", (lambda f0=f0, f1=f1: drop(0.25, f0, f1)))
add("nature", "drips", "چکه‌ها", "Drips", lambda: layer(*[drop(0.25, 900 + rng.integers(-200, 300), 1400) for _ in range(6)], at=sorted(rng.uniform(0, 2.2, 6).tolist()), gain=[0.8] * 6))
add("nature", "rain_light", "بارانِ نرم", "Light rain", lambda: fade(filt(noise(int(3 * SR)), biquad("hp", 2500, 0.7)) * 0.35, 0.3, 0.5))
add("nature", "rain_heavy", "بارانِ تند", "Heavy rain", lambda: fade(filt(pink(int(3 * SR)), biquad("hp", 900, 0.7)) * 1.6, 0.3, 0.5))
add("nature", "wind_1", "باد", "Wind", lambda: fade(swept(3.0, 150, 700, "swell", 0.4) * 1.2, 0.5, 0.8))
add("nature", "wind_2", "بادِ سرد", "Cold wind", lambda: fade(swept(3.0, 400, 1600, "swell", 0.6), 0.5, 0.8))
add("nature", "wind_3", "طوفان", "Storm wind", lambda: fade(filt(pink(int(3 * SR)), biquad("lp", 600, 0.7)) * 2.2, 0.6, 0.8))
add("nature", "ocean_1", "موجِ دریا", "Ocean wave", lambda: fade(filt(pink(int(4 * SR)), biquad("lp", 1200, 0.7)) * (0.6 + 0.6 * np.sin(TAU * 0.25 * t_of(int(4 * SR))) ** 2) * 1.5, 0.5, 1.0))
add("nature", "ocean_2", "ساحل", "Shore", lambda: fade(filt(noise(int(4 * SR)), biquad("bp", 1800, 0.5)) * (0.4 + 0.6 * np.sin(TAU * 0.2 * t_of(int(4 * SR)) + 1) ** 2) * 0.8, 0.5, 1.0))
add("nature", "fire_1", "آتش", "Fire", lambda: fade(layer(filt(pink(int(3 * SR)), biquad("lp", 900, 0.7)) * 1.4, layer(*[burst(0.03, 2500, 0.006) for _ in range(30)], at=sorted(rng.uniform(0, 2.9, 30).tolist()))), 0.3, 0.5))
add("nature", "fire_2", "ترق‌تروقِ آتش", "Fire crackle", lambda: layer(*[burst(0.03, 2500, 0.006) for _ in range(50)], at=sorted(rng.uniform(0, 2.5, 50).tolist())))
add("nature", "birds_1", "پرنده‌ها", "Birds", lambda: layer(*[blip(2800 + rng.integers(0, 1500), 3800 + rng.integers(0, 1500), 0.08) for _ in range(9)], at=sorted(rng.uniform(0, 2.4, 9).tolist()), gain=[0.5] * 9))
add("nature", "birds_2", "چهچهه", "Birdsong", lambda: layer(*[mix(*[blip(3200 + rng.integers(-400, 400), 4200, 0.05) for _ in range(4)], gap=0.01) for _ in range(5)], at=sorted(rng.uniform(0, 2.2, 5).tolist()), gain=[0.5] * 5))
add("nature", "thunder_1", "رعد", "Thunder", lambda: fade(filt(pink(int(3.5 * SR)), biquad("lp", 250, 0.7)) * np.exp(-t_of(int(3.5 * SR)) / 1.4) * 3.0, 0.02, 0.8))
add("nature", "thunder_2", "رعدِ دور", "Distant thunder", lambda: fade(filt(pink(int(4 * SR)), biquad("lp", 150, 0.7)) * (0.5 + 0.5 * np.sin(TAU * 0.6 * t_of(int(4 * SR)))) * 2.5, 0.8, 1.2))
add("nature", "stream", "جویبار", "Stream", lambda: fade(layer(filt(noise(int(3 * SR)), biquad("bp", 3500, 0.8)) * 0.5, filt(pink(int(3 * SR)), biquad("bp", 900, 0.6)) * 0.9), 0.4, 0.6))
add("nature", "forest", "جنگل", "Forest", lambda: fade(layer(filt(pink(int(4 * SR)), biquad("bp", 600, 0.4)) * 0.5, layer(*[blip(3000 + rng.integers(0, 1200), 4000, 0.07) for _ in range(6)], at=sorted(rng.uniform(0.2, 3.6, 6).tolist()), gain=[0.3] * 6)), 0.5, 0.8))
add("nature", "crickets", "جیرجیرک", "Crickets", lambda: fade(tone(4200, 4, 50) * (np.sign(np.sin(TAU * 11 * t_of(int(4 * SR)))) * 0.5 + 0.5) * 0.25, 0.4, 0.6))
add("nature", "heartbeat", "ضربانِ قلب", "Heartbeat", lambda: mix(*[mix(kick(0.12, 80, 40), kick(0.1, 70, 36), gap=0.12) for _ in range(3)], gap=0.5))
add("nature", "bubbles", "حباب‌ها", "Bubbles", lambda: layer(*[blip(300 + rng.integers(0, 500), 900 + rng.integers(0, 600), 0.12) for _ in range(10)], at=sorted(rng.uniform(0, 1.8, 10).tolist()), gain=[0.6] * 10))
add("nature", "splash", "شلپ", "Splash", lambda: layer(burst(0.5, 800, 0.12), drop(0.3, 500, 900, 25, 12), filt(noise(int(0.4 * SR)), biquad("bp", 2000, 0.6)) * np.exp(-t_of(int(0.4 * SR)) / 0.15), gain=[0.8, 0.6, 0.6]))

# with the transitions -----------------------------------------------------
TR = {"liquid": ("قطره و موج", "Drop and ripple", lambda: layer(drop(0.25, 900, 1400), swept(1.1, 300, 2600, "swell", 0.8), gain=[1, 0.6], at=[0, 0.05])),
      "glass": ("شیشه‌ای که می‌لغزد", "Sliding glass", lambda: layer(swept(1.3, 800, 3000, "swell", 1.8), bell(mtof(96), 0.4, 0.8, 5.0), gain=[0.8, 0.5], at=[0, 0.9])),
      "frosted": ("یخ‌زده", "Frosted", lambda: swept(1.4, 2500, 7000, "swell", 1.2) * 0.8),
      "reeded": ("شیارها", "Reeded", lambda: swept(1.2, 600, 2400, "swell", 3.0) * (0.6 + 0.4 * np.sign(np.sin(TAU * 18 * t_of(int(1.2 * SR)))))),
      "stained": ("شیشهٔ رنگی", "Stained glass", lambda: layer(*[bell(mtof(m), 0.4, 1.4, 5.0) for m in (91, 95, 98, 103)], at=[0, 0.2, 0.4, 0.6], gain=[0.5] * 4)),
      "ink": ("جوهر", "Ink", lambda: layer(drop(0.3, 400, 600, 30, 14), swept(1.3, 200, 900, "swell", 0.7), gain=[1, 0.7])),
      "burn": ("سوختن", "Burn", lambda: layer(swept(1.4, 300, 2200, "rise", 0.8), layer(*[burst(0.03, 2500, 0.006) for _ in range(40)], at=sorted(rng.uniform(0, 1.3, 40).tolist())), gain=[0.9, 0.7])),
      "whip": ("شلاق", "Whip", lambda: layer(swept(0.25, 600, 6000, "rise", 1.2), tok(1200, 1), gain=[1, 0.8], at=[0, 0.22])),
      "glitch": ("گلیچ", "Glitch", glitch_recipe(10, 0.06)),
      "zoom": ("زوم", "Zoom", lambda: swept(0.9, 200, 5000, "rise", 0.9)),
      "mosaic": ("موزاییک", "Mosaic", lambda: layer(*[tok(900 + k * 120, 0.6) for k in range(10)], at=[k * 0.08 for k in range(10)], gain=[0.7] * 10)),
      "halftone": ("هاف‌تون", "Halftone", lambda: swept(1.0, 1500, 4500, "swell", 3.0) * (0.5 + 0.5 * np.sign(np.sin(TAU * 40 * t_of(int(1.0 * SR)))))),
      "chrome": ("کروم", "Chrome", lambda: layer(bell(mtof(69), 0.8, 1.2, 7.1), swept(1.1, 1500, 5000, "swell", 1.5), gain=[0.8, 0.6])),
      "cube": ("مکعب", "Cube", lambda: layer(swept(1.0, 300, 1200, "swell", 0.9), kick(0.25, 110, 42), gain=[0.8, 0.9], at=[0, 0.85])),
      "flip": ("ورق", "Flip", lambda: layer(swept(0.7, 1000, 4000, "swell", 1.3), tok(1000, 0.9), gain=[0.8, 0.8], at=[0, 0.6])),
      "camera": ("دوربین", "Camera", lambda: mix(burst(0.05, 3000, 0.01), tok(1400, 0.8), burst(0.08, 1500, 0.02), gap=0.03)),
      "mesh": ("مش", "Mesh", lambda: layer(swept(1.4, 200, 1800, "swell", 0.7), bell(mtof(84), 0.4, 1.4, 2.76), gain=[0.8, 0.4], at=[0, 0.3])),
      "lens": ("لنز", "Lens", lambda: layer(swept(1.2, 500, 3500, "swell", 1.4), bell(mtof(100), 0.4, 0.9, 5.0), gain=[0.8, 0.5], at=[0, 0.5])),
      "leak": ("نشتِ نور", "Light leak", lambda: swept(1.6, 300, 2500, "swell", 0.6) * 0.9),
      "melt": ("ذوب", "Melt", lambda: (lambda n: np.sin(np.cumsum(TAU * (330 * np.maximum(0.05, 1 - np.linspace(0, 1, n) ** 0.5)) / SR)) * np.sin(np.pi * np.linspace(0, 1, n)) * 0.5)(int(1.4 * SR)).astype(np.float32)),
      "smear": ("کشیده", "Smear", lambda: swept(1.2, 400, 1600, "swell", 0.5)),
      "orb": ("گوی", "Orb", lambda: layer(bell(mtof(79), 0.6, 1.8, 2.76), swept(1.4, 300, 3000, "swell", 0.8), gain=[0.7, 0.6])),
      "water": ("آب", "Water", lambda: layer(burst(0.5, 800, 0.12), drop(0.3, 500, 900, 25, 12), swept(1.2, 400, 2500, "swell", 0.8), gain=[0.6, 0.6, 0.7])),
      "pool": ("استخر", "Pool", lambda: layer(swept(1.6, 200, 1500, "swell", 0.6), layer(*[drop(0.25, 900, 1400) for _ in range(4)], at=[0.1, 0.5, 0.8, 1.2], gain=[0.5] * 4), gain=[0.8, 1])),
      "rays": ("پرتوها", "Rays", lambda: layer(layer(*[ep(mtof(m), 1.6, 0.5, 2.2) for m in (60, 64, 67, 72)], gain=[0.4] * 4), swept(1.8, 300, 3000, "swell", 0.6) * 0.3)),
      "barrel": ("بشکه", "Barrel", lambda: swept(1.0, 2000, 400, "fall", 0.9)),
      "drops": ("قطره‌ها", "Drops", lambda: layer(*[drop(0.25, 700 + rng.integers(0, 600), 1400) for _ in range(7)], at=sorted(rng.uniform(0, 1.2, 7).tolist()), gain=[0.8] * 7)),
      "grade": ("رنگ‌بندی", "Grade", lambda: swept(1.2, 200, 1200, "swell", 0.5) * 0.7),
      "push": ("هُل", "Push", lambda: swept(0.8, 400, 3600, "swell", 0.9)),
      "scene_chrome": ("کرومِ صحنه", "Scene chrome", lambda: layer(bell(mtof(64), 0.8, 1.6, 7.1), swept(1.4, 800, 4000, "swell", 1.2), gain=[0.8, 0.6]))}
for k, (fa, en, fn) in TR.items():
    add("trans", f"tr_{k}", fa, en, fn)

# foley and reactions -------------------------------------------------------
add("foley", "applause_1", "تشویق", "Applause", lambda: fade(layer(*[burst(0.08, 1000 + rng.integers(0, 800), 0.03) for _ in range(90)], at=sorted(rng.uniform(0, 2.8, 90).tolist()), gain=[0.5] * 90), 0.3, 0.6))
add("foley", "applause_2", "تشویقِ کوتاه", "Short applause", lambda: fade(layer(*[burst(0.08, 1000 + rng.integers(0, 800), 0.03) for _ in range(40)], at=sorted(rng.uniform(0, 1.3, 40).tolist()), gain=[0.5] * 40), 0.1, 0.4))
add("foley", "crowd", "همهمه", "Crowd murmur", lambda: fade(filt(pink(int(3 * SR)), biquad("bp", 500, 0.6)) * (0.8 + 0.3 * np.sin(TAU * 0.7 * t_of(int(3 * SR)))) * 1.2, 0.5, 0.6))
add("foley", "cheer", "هورا", "Cheer", lambda: fade(swept(1.8, 400, 1500, "swell", 0.4) * 1.3 + filt(noise(int(1.8 * SR)), biquad("bp", 2500, 0.7)) * 0.3, 0.2, 0.5))
add("foley", "scratch_1", "اسکرچِ صفحه", "Record scratch", lambda: swept(0.35, 1500, 300, "fall", 2.5) + swept(0.35, 300, 1500, "rise", 2.5))
add("foley", "scratch_2", "اسکرچِ دوتایی", "Double scratch", lambda: mix(swept(0.18, 1500, 400, "fall", 2.5), swept(0.18, 400, 1500, "rise", 2.5), swept(0.25, 1600, 300, "fall", 2.5), gap=0.01))
add("foley", "vinyl", "خش‌خشِ وینیل", "Vinyl crackle", lambda: fade(layer(layer(*[burst(0.02, 3000, 0.004) for _ in range(40)], at=sorted(rng.uniform(0, 2.9, 40).tolist()), gain=[0.5] * 40), filt(noise(int(3 * SR)), biquad("lp", 400, 0.7)) * 0.08), 0.2, 0.3))
for i, (f0, f1) in enumerate([(300, 900), (200, 700), (500, 1300)]):
    add("foley", f"boing_{i + 1}", f"بویینگِ {['کارتونی', 'بم', 'زیر'][i]}", f"Boing {['cartoon', 'low', 'high'][i]}", (lambda f0=f0, f1=f1: (lambda n: np.sin(np.cumsum(TAU * (f0 + (f1 - f0) * np.exp(-t_of(n) * 6) * (1 + 0.5 * np.sin(TAU * 11 * t_of(n)))) / SR)) * np.exp(-t_of(n) / 0.35))(int(0.9 * SR)).astype(np.float32)))
add("foley", "slide_up", "سوتِ کشویی بالا", "Slide whistle up", lambda: (lambda n: np.sin(np.cumsum(TAU * np.linspace(500, 1800, n) / SR)) * env(n, 0.02, 0.1) * 0.5)(int(0.7 * SR)).astype(np.float32))
add("foley", "slide_down", "سوتِ کشویی پایین", "Slide whistle down", lambda: (lambda n: np.sin(np.cumsum(TAU * np.linspace(1800, 500, n) / SR)) * env(n, 0.02, 0.1) * 0.5)(int(0.7 * SR)).astype(np.float32))
add("foley", "cymbal_swell", "سوئلِ سنج", "Cymbal swell", lambda: swept(2.2, 3000, 8000, "rise", 0.5) * 0.8)
add("foley", "cymbal_hit", "ضربهٔ سنج", "Cymbal hit", lambda: burst(2.0, 3500, 0.55))
add("foley", "door", "در", "Door", lambda: layer(kick(0.15, 100, 50), burst(0.3, 500, 0.06), tok(300, 0.6), gain=[0.8, 0.6, 0.5], at=[0, 0, 0.08]))
add("foley", "footsteps", "قدم‌ها", "Footsteps", lambda: mix(*[layer(kick(0.08, 90, 50), burst(0.08, 600, 0.02), gain=[0.6, 0.6]) for _ in range(5)], gap=0.42))
add("foley", "paper", "کاغذ", "Paper rustle", lambda: fade(filt(noise(int(0.7 * SR)), biquad("bp", 3500, 0.8)) * (0.5 + 0.5 * np.sin(TAU * 9 * t_of(int(0.7 * SR)))) * 0.7, 0.05, 0.2))
add("foley", "zipper", "زیپ", "Zipper", lambda: swept(0.4, 1500, 5000, "rise", 3.0) * (0.5 + 0.5 * np.sign(np.sin(TAU * 110 * t_of(int(0.4 * SR))))))
add("foley", "pour", "ریختنِ آب", "Pouring water", lambda: fade(layer(filt(noise(int(1.6 * SR)), biquad("bp", 2200, 0.7)) * 0.6, layer(*[blip(400 + rng.integers(0, 600), 1200, 0.1) for _ in range(12)], at=sorted(rng.uniform(0, 1.5, 12).tolist()), gain=[0.4] * 12)), 0.1, 0.3))
add("foley", "clock", "تیک‌تاکِ ساعت", "Clock ticking", lambda: mix(*[tok(1800 if k % 2 == 0 else 1500, 0.7) for k in range(6)], gap=0.33))
add("foley", "phone", "زنگِ تلفن", "Phone ring", lambda: mix(tone(880, 0.4, 2) * (0.5 + 0.5 * np.sign(np.sin(TAU * 25 * t_of(int(0.4 * SR))))), tone(880, 0.4, 2) * (0.5 + 0.5 * np.sign(np.sin(TAU * 25 * t_of(int(0.4 * SR))))), gap=0.25) * 0.5)
add("foley", "alarm", "آژیر", "Alarm", lambda: (lambda n: np.sin(np.cumsum(TAU * (700 + 300 * np.sin(TAU * 2 * t_of(n))) / SR)) * env(n, 0.01, 0.1) * 0.5)(int(1.6 * SR)).astype(np.float32))
add("foley", "laugh_track", "خندهٔ جمع", "Laughter", lambda: fade(layer(layer(*[swept(0.09, 600 + rng.integers(0, 900), 300, "fall", 1.2) for _ in range(24)], at=sorted(rng.uniform(0, 1.6, 24).tolist()), gain=[0.6] * 24), filt(pink(int(1.9 * SR)), biquad("bp", 700, 0.6)) * 0.4), 0.15, 0.4))

# musical stingers -----------------------------------------------------------
CH = {"major": (60, 64, 67, 72), "minor": (60, 63, 67, 72), "sus": (60, 65, 67, 72), "maj7": (60, 64, 67, 71), "min7": (60, 63, 67, 70), "dim": (60, 63, 66, 69)}
for k, notes in CH.items():
    add("music", f"ep_{k}", f"آکوردِ {k} (پیانوی برقی)", f"{k} chord (electric piano)", (lambda notes=notes: layer(*[ep(mtof(m), 1.4, 0.7, 1.8) for m in notes], gain=[0.5] * len(notes))))
for i, m in enumerate([60, 64, 67, 72, 76, 79]):
    add("music", f"note_{i + 1}", f"نتِ پیانوی برقی {i + 1}", f"Electric piano note {i + 1}", (lambda m=m: ep(mtof(m), 1.0, 0.8, 1.6)))
for i, (notes, nm_fa, nm_en) in enumerate([((48, 55, 60, 64), "پدِ گرم", "Warm pad"), ((48, 55, 63, 67), "پدِ تاریک", "Dark pad"), ((53, 60, 65, 69), "پدِ روشن", "Bright pad"), ((45, 52, 57, 64), "پدِ عمیق", "Deep pad")]):
    add("music", f"pad_{i + 1}", nm_fa, nm_en, (lambda notes=notes: fade(layer(*[tone(mtof(m), 3.0, 4.0) * (1 + 0.08 * np.sin(TAU * 5 * t_of(int(3 * SR)))) for m in notes], gain=[0.3] * 4) * np.sin(np.pi * np.linspace(0, 1, int(3 * SR))) ** 0.5, 0.4, 0.8)))
for i, (f0, f1) in enumerate([(110, 30), (80, 25), (140, 40)]):
    add("music", f"bass_drop_{i + 1}", f"بیس‌دراپِ {['کلاسیک', 'عمیق', 'کوتاه'][i]}", f"Bass drop {['classic', 'deep', 'short'][i]}", (lambda f0=f0, f1=f1: boom(1.8, f0, f1)))
add("music", "fill_1", "فیلِ درام ۱", "Drum fill 1", lambda: mix(snare(), snare(), kick(), snare(), kick(), kick(), snare(), gap=0.12))
add("music", "fill_2", "فیلِ درام ۲", "Drum fill 2", lambda: mix(kick(), hat(), snare(), hat(), kick(), kick(), snare(), burst(1.2, 4000, 0.4), gap=0.1))
add("music", "fill_3", "فیلِ تام", "Tom fill", lambda: mix(kick(0.3, 220, 110), kick(0.3, 190, 95), kick(0.3, 160, 80), kick(0.3, 130, 65), gap=0.12))
add("music", "strum_major", "استرامِ ماژور", "Major strum", lambda: layer(*[ep(mtof(m), 1.6, 0.6, 2.0) for m in (52, 59, 64, 67, 71, 76)], at=[k * 0.03 for k in range(6)], gain=[0.4] * 6))
add("music", "strum_minor", "استرامِ مینور", "Minor strum", lambda: layer(*[ep(mtof(m), 1.6, 0.6, 2.0) for m in (52, 59, 64, 67, 70, 76)], at=[k * 0.03 for k in range(6)], gain=[0.4] * 6))
add("music", "intro_sting", "استینگِ آغاز", "Intro sting", lambda: layer(swept(1.2, 200, 3000, "rise", 0.8), boom(1.6, 70, 30), layer(*[ep(mtof(m), 1.4, 0.7, 1.8) for m in (60, 64, 67, 72)], gain=[0.5] * 4), gain=[0.7, 0.9, 0.9], at=[0, 1.15, 1.15]))
add("music", "outro_sting", "استینگِ پایان", "Outro sting", lambda: layer(layer(*[ep(mtof(m), 2.2, 0.7, 2.6) for m in (53, 60, 65, 69)], gain=[0.5] * 4), swept(2.0, 2500, 300, "fall", 0.7), gain=[1, 0.4]))
add("music", "logo_1", "لوگوی صوتی ۱", "Sonic logo 1", lambda: mix(bell(mtof(84), 0.7, 0.6, 2.76), bell(mtof(91), 0.7, 0.6, 2.76), bell(mtof(96), 0.8, 1.8, 2.76), gap=-1.65))
add("music", "logo_2", "لوگوی صوتی ۲", "Sonic logo 2", lambda: layer(ep(mtof(60), 1.8, 0.8, 2.2), ep(mtof(67), 1.8, 0.7, 2.2), ep(mtof(76), 2.2, 0.7, 2.6), bell(mtof(100), 0.5, 1.2, 5.0), at=[0, 0.1, 0.2, 0.55], gain=[0.5, 0.45, 0.45, 0.4]))
add("music", "question", "پرسش", "Question", lambda: mix(ep(mtof(67), 0.4, 0.7, 1.0), ep(mtof(72), 0.9, 0.7, 1.4), gap=-0.9))
add("music", "answer", "پاسخ", "Answer", lambda: mix(ep(mtof(72), 0.4, 0.7, 1.0), ep(mtof(67), 0.9, 0.7, 1.4), gap=-0.9))
add("music", "suspense", "تعلیق", "Suspense", lambda: fade(layer(tone(mtof(45), 3.0, 5.0), tone(mtof(51), 3.0, 5.0) * (1 + 0.3 * np.sin(TAU * 6 * t_of(int(3 * SR)))), gain=[0.5, 0.4]) * np.linspace(0.3, 1, int(3 * SR)), 0.3, 0.3))


# ---------------------------------------------------------------- render
def render(fn):
    try:
        y = fn()
    except ValueError as err:
        raise SystemExit(f'recipe shape error: {err}')
    y = np.asarray(y, np.float32); y = np.nan_to_num(y)
    y = normalize(fade(y, 0.002, 0.03)); return y


def write_mp3(y, path):
    import wave
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        wav = f.name
    with wave.open(wav, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "96k", str(path)], check=True)
    os.unlink(wav)


def main():
    idx = []; made = 0
    for fam, key, fa, en, fn in L:
        y = render(fn); path = OUT / fam / f"{key}.mp3"
        if not path.exists():
            write_mp3(y, path); made += 1
        idx.append({"fam": fam, "key": key, "fa": fa, "en": en, "sec": round(len(y) / SR, 2), "file": f"sfx/{fam}/{key}.mp3"})
    # 176: sounds this script doesn't make stay in the index — whole families it doesn't know, and the items marked
    #      "own" inside its families (the 44 folded in from another set, under plain names); the old-path map stays too
    prev = json.loads((OUT / "index.json").read_text(encoding="utf-8")) if (OUT / "index.json").exists() else {"families": {}, "items": []}
    fams = {k: {"fa": v[0], "en": v[1]} for k, v in FAM.items()}; fams.update({k: v for k, v in prev.get("families", {}).items() if k not in FAM})
    made_keys = {(x["fam"], x["key"]) for x in idx}
    idx += [x for x in prev.get("items", []) if (x.get("fam") not in FAM or x.get("own")) and (x.get("fam"), x.get("key")) not in made_keys]
    order = list(fams); idx.sort(key=lambda x: order.index(x["fam"]) if x["fam"] in order else len(order))
    out = {"families": fams, "items": idx}
    if prev.get("moved"):
        out["moved"] = prev["moved"]
    (OUT / "index.json").write_text(json.dumps(out, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(idx)} sounds ({made} written) → {OUT}")


if __name__ == "__main__":
    main()
