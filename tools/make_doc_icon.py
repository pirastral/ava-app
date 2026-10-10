# 180 · The .ava document icon: a page with the app's own crown on it — not just any crown.
# 181 · In neutral greys, the way Finder draws its own document icons (the founder's choice, option C of four): a white
#       page with a folded corner, and the crown as three flat greys (like the note on Finder's audio icon), no label.
#       The crown is the founder's high-quality copy of the header logo's crown, tools/ava-crown.png (the logo itself,
#       ui-src/logo.txt, if that file is missing). Build-time tool, never shipped. Writes, next to icon.png / icon.ico:
#         ava-doc.png   the 1024 px master (for a look, or to remake the others)
#         ava-doc.icns  macOS (every size Finder uses; PNG entries)
#         ava-doc.ico   Windows (16 … 256 px; PNG entries)
#       The small sizes (48 px and less) get darker greys, a firmer page edge and a slightly bigger crown, so the crown
#       still reads at 16 px.
#       usage: python3 tools/make_doc_icon.py [path/to/another/transparent/crown.png]
import base64, io, os, re, struct, sys
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CROWN = os.path.join(ROOT, "tools", "ava-crown.png")

# the crown's three greys: (dark, mid, light) — on the big sizes, and darker on the small ones
GREYS = {"big": (184, 200, 232), "small": (150, 172, 214)}


def crown_image():
    if len(sys.argv) > 1:
        im = Image.open(sys.argv[1]).convert("RGBA")
    elif os.path.isfile(CROWN):
        im = Image.open(CROWN).convert("RGBA")
    else:
        t = open(os.path.join(ROOT, "ui-src", "logo.txt"), encoding="utf-8").read().strip()
        m = re.match(r"data:image/\w+;base64,(.*)", t, re.S)
        im = Image.open(io.BytesIO(base64.b64decode(m.group(1) if m else t))).convert("RGBA")
    return im.crop(im.getbbox())


def page(S, small):
    """The sheet: a white page with a folded top corner and a soft shadow, drawn at S×S (supersampled by the caller)."""
    k = S / 1024.0
    x0, y0, x1, y1 = round(212 * k), round(92 * k), round(812 * k), round(932 * k)
    r, fold = max(2, round(34 * k)), round(162 * k)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # the outline of a page whose top-right corner is folded over: a rounded rectangle less that corner
    mask = Image.new("L", (S, S), 0); ImageDraw.Draw(mask).rounded_rectangle((x0, y0, x1, y1), radius=r, fill=255)
    cut = Image.new("L", (S, S), 0); ImageDraw.Draw(cut).polygon([(x1 - fold, y0 - 2), (x1 + 2, y0 - 2), (x1 + 2, y0 + fold)], fill=255)
    mask = ImageChops.subtract(mask, cut)
    # its shadow
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0)); sh.putalpha(mask.point(lambda v: int(v * (0.30 if small else 0.20))))
    sh = sh.filter(ImageFilter.GaussianBlur(max(1, 18 * k))); out.alpha_composite(sh, (0, round(8 * k)))
    # the paper: near-white to a very light neutral grey
    grad = Image.new("RGBA", (S, S)); gd = ImageDraw.Draw(grad)
    for yy in range(S):
        t = min(1.0, max(0.0, (yy - y0) / max(1, (y1 - y0))))
        c = round(250 - 9 * t); gd.line([(0, yy), (S, yy)], fill=(c, c, min(255, c + 1), 255))
    paper = Image.new("RGBA", (S, S), (0, 0, 0, 0)); paper.paste(grad, (0, 0), mask); out.alpha_composite(paper)
    # a hairline edge (firmer when small, so the page reads on any background)
    edge = mask.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
    ln = Image.new("RGBA", (S, S), (60, 60, 67, 0)); ln.putalpha(edge.point(lambda v: int(v * (0.45 if small else 0.22)))); out.alpha_composite(ln)
    # the fold: a flap lying on the page, a little greyer, with its own soft shadow
    fl = Image.new("L", (S, S), 0); ImageDraw.Draw(fl).rounded_rectangle((x1 - fold, y0, x1, y0 + fold), radius=max(2, round(22 * k)), fill=255)
    tri = Image.new("L", (S, S), 0); ImageDraw.Draw(tri).polygon([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)], fill=255)
    fl = ImageChops.multiply(fl, tri)
    fsh = Image.new("RGBA", (S, S), (0, 0, 0, 0)); fsh.putalpha(fl.point(lambda v: int(v * 0.18)))
    fsh = fsh.filter(ImageFilter.GaussianBlur(max(1, 8 * k))); out.alpha_composite(fsh, (-round(3 * k), round(5 * k)))
    flap = Image.new("RGBA", (S, S), (228, 228, 231, 0)); flap.putalpha(fl); out.alpha_composite(flap)
    fe = fl.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
    fln = Image.new("RGBA", (S, S), (60, 60, 67, 0)); fln.putalpha(fe.point(lambda v: int(v * (0.40 if small else 0.18)))); out.alpha_composite(fln)
    return out, (x0, y0, x1, y1, fold)


def grey_crown(cr, w, h, small):
    """The crown at w×h in three flat neutral greys: each part of the logo takes the grey of its own lightness (its light
    highlights the light grey, its middle tones the middle grey, its dark lines the dark grey). Toned at twice the size
    and then reduced, so the edges between the greys are smooth even on the 1024 px master."""
    big = cr.resize((w * 2, h * 2), Image.LANCZOS)
    L, a = ImageOps.grayscale(big.convert("RGB")), big.getchannel("A")
    dark, mid, light = GREYS["small" if small else "big"]
    g = L.point(lambda v: light if v > 205 else (mid if v > 105 else dark))
    toned = Image.merge("RGBA", (g, g, g.point(lambda v: min(255, v + 2)), a))
    return toned.resize((w, h), Image.LANCZOS)


def render(size):
    """One size of the icon: drawn larger (up to 16×), then reduced (crisper small sizes)."""
    small = size <= 48
    S = 1024 if size >= 256 else max(256, size * 8)
    base, (x0, y0, x1, y1, fold) = page(S, small)
    k = S / 1024.0
    cr = crown_image()
    h = round((600 if small else 542) * k)                     # the crown's height on the page (182: 20 % larger)
    w = round(cr.width * h / cr.height)
    c = grey_crown(cr, w, h, small)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + round(22 * k)     # the page's middle, a little low (the fold is above)
    base.alpha_composite(c, (round(cx - w / 2), round(cy - h / 2)))
    return base.resize((size, size), Image.LANCZOS) if base.width != size else base


def png_bytes(im):
    b = io.BytesIO(); im.save(b, "PNG", optimize=True); return b.getvalue()


def write_icns(path, imgs):
    # PNG-based entries, the types iconutil writes: 16/32/64 (icp4/icp5/icp6), 128/256/512/1024 (ic07–ic10), the @2x
    # ones (ic11 16@2x, ic12 32@2x, ic13 128@2x, ic14 256@2x)
    types = [("icp4", 16), ("icp5", 32), ("icp6", 64), ("ic07", 128), ("ic08", 256), ("ic09", 512), ("ic10", 1024),
             ("ic11", 32), ("ic12", 64), ("ic13", 256), ("ic14", 512)]
    body = b"".join(t.encode("ascii") + struct.pack(">I", 8 + len(d)) + d for t, d in ((t, png_bytes(imgs[s])) for t, s in types))
    open(path, "wb").write(b"icns" + struct.pack(">I", 8 + len(body)) + body)


def write_ico(path, imgs, sizes):
    datas = [png_bytes(imgs[s]) for s in sizes]
    head = struct.pack("<HHH", 0, 1, len(sizes)); off = 6 + 16 * len(sizes); dirs = b""
    for s, d in zip(sizes, datas):
        dirs += struct.pack("<BBBBHHII", s % 256, s % 256, 0, 0, 1, 32, len(d), off); off += len(d)
    open(path, "wb").write(head + dirs + b"".join(datas))


if __name__ == "__main__":
    sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024]
    imgs = {s: render(s) for s in sizes}
    imgs[1024].save(os.path.join(ROOT, "ava-doc.png"))
    write_icns(os.path.join(ROOT, "ava-doc.icns"), imgs)
    write_ico(os.path.join(ROOT, "ava-doc.ico"), imgs, [16, 24, 32, 48, 64, 128, 256])
    print("ava-doc.png / .icns / .ico written in", ROOT)
