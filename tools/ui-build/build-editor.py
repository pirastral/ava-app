#!/usr/bin/env python3
"""Builds ui/index.html from ui-src/ (175).

Lives inside the build tree so every build zip carries its own tooling — the script and stylesheet
were lost once with a wiped workspace. Needs node with tailwindcss 4.3.3, @tailwindcss/cli 4.3.3,
daisyui 5, @fontsource-variable/{vazirmatn,noto-sans} (+ the extra fonts in FONT_PKGS) and
lucide-static in NODE_DIR (default: ./node_modules beside this script; override with AVA_NODE_DIR).

    python3 tools/ui-build/build-editor.py
"""
import base64, json, os, pathlib, re, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
B = HERE.parent.parent                                   # the build tree (…/b153)
U = B / "ui-src"
NODE_DIR = pathlib.Path(os.environ.get("AVA_NODE_DIR", HERE / "node_modules"))
JS_FILES = ("editor.js", "video-lib.js", "transitions.js", "muxers.js", "video.js", "anim.js", "speakers.js", "timeline.js", "design.js", "controls.js")
CSS_SOURCES = ("editor.src.html", "editor.js", "video.js", "anim.js", "speakers.js", "video-lib.js", "lists.js", "timeline.js", "design.js", "controls.js")
# icons the code builds from parts (`#i-${name}`) — the scanner below cannot see them
DYNAMIC_ICONS = {"mic", "music", "volume-2", "volume-x", "pause", "play", "layers", "pencil", "scissors", "check", "refresh-cw",
                 "copy", "trash-2", "plus", "grip-vertical", "captions", "clapperboard", "audio-lines", "sparkles", "chevron-left",
                 "chevron-right", "image", "film", "type", "sticker", "podcast", "user", "eye", "eye-off", "lock", "lock-open",
                 "pin", "pin-off", "library-big"}


def main():
    src = (U / "editor.src.html").read_text(encoding="utf-8")
    js = "\n".join((U / f).read_text(encoding="utf-8") for f in JS_FILES)
    sfx = B / "ui/sfx/index.json"
    js = ("const SFX_INDEX = " + (sfx.read_text(encoding="utf-8").strip() if sfx.exists() else '{"families":{},"items":[]}') + ";\n") + js
    lists = (U / "lists.js").read_text(encoding="utf-8")
    mp4 = (U / "mp4-muxer.js").read_text(encoding="utf-8")
    # 177: Coloris (MIT, @melloware/coloris) — one colour picker, the same on every platform; its stylesheet goes first
    #      so the app's own rules (input12p.css) restyle it in the daisyUI theme
    clr_dir = NODE_DIR / "@melloware" / "coloris" / "dist"
    clr_js, clr_css = (clr_dir / "umd" / "coloris.min.js").read_text(encoding="utf-8"), (clr_dir / "coloris.min.css").read_text(encoding="utf-8")

    # ---- styles: Tailwind 4 + daisyUI, the palette themes and the custom rules (input12p.css)
    theme = (HERE / "input12p.css").read_text(encoding="utf-8")
    theme = theme.replace('@source "./SRC";', "\n".join(f'@source "{U / f}";' for f in CSS_SOURCES))
    tmp_in, tmp_out = NODE_DIR.parent / ".ava-input-editor.css", NODE_DIR.parent / ".ava-out-editor.css"   # beside node_modules, so @import resolves
    tmp_in.write_text(theme, encoding="utf-8")
    cli = NODE_DIR / ".bin" / "tailwindcss"
    r = subprocess.run([str(cli), "-i", str(tmp_in), "-o", str(tmp_out), "--minify"], capture_output=True, text=True, cwd=str(NODE_DIR.parent))
    if r.returncode or "Unexpected" in r.stderr:
        sys.exit("STYLESHEET DID NOT COMPILE:\n" + r.stderr[-1500:])
    css = strip_has(tmp_out.read_text(encoding="utf-8"))   # 176: no :has() — each one made every change to the page restyle all of it
    tmp_in.unlink(); tmp_out.unlink()

    # ---- fonts, embedded (the app runs offline)
    fonts = "<style>\n" + "\n".join(font_faces() + latin_faces()) + "\n.lt:empty::before{content:attr(data-ph);opacity:.4}\n</style>"

    # ---- icons: every #i-… referenced, plus the ones built dynamically
    names = sorted(set(re.findall(r"#i-([a-z0-9-]+)", src + js)) | DYNAMIC_ICONS)
    syms, missing = [], []
    for n in names:
        p = NODE_DIR / "lucide-static" / "icons" / f"{n}.svg"
        if not p.exists():
            missing.append(n); continue
        inner = re.sub(r"\s+", " ", re.sub(r"^.*?<svg[^>]*>|</svg>\s*$", "", p.read_text(), flags=re.S).strip())
        syms.append(f'<symbol id="i-{n}" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2" '
                    f'stroke-linecap="round" stroke-linejoin="round">{inner}</g></symbol>')
    sprite = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + "".join(syms) + "</svg>"

    fav = (U / "favicon.txt").read_text().strip(); logo = (U / "logo.txt").read_text().strip(); av = (U / "avatar.txt").read_text().strip()
    out = (src.replace("<!--FAVICON-->", f'<link rel="icon" type="image/png" href="{fav}">')
              .replace("<!--FONTS-->", fonts).replace("<!--CSS-->", "<style>\n" + clr_css + "\n" + css + "\n</style>").replace("<!--ICONS-->", sprite)
              .replace("<!--LOGO-->", f'<img src="{logo}" alt="" class="h-8 w-auto shrink-0 -translate-y-px object-contain">')
              .replace("<!--XAVATAR-->", av)
              .replace("</head>", "<script>" + mp4 + "</script>\n<script>" + clr_js + "</script>\n</head>", 1)
              .replace("/*@CLASSIC*/", lists).replace("/*@EDITOR*/", js))
    (B / "ui/index.html").write_text(out, encoding="utf-8")
    ext = re.findall(r'(?:src|href)="(https?://[^"]+)', out)
    print(f"ui/index.html: {len(out) // 1024} KB, {len(syms)} icons, missing: {missing or 'none'}, external: {ext or 'none'}")


# Vazirmatn (Persian + Latin) and Noto Sans (Latin) are the interface fonts; FONT_PKGS adds the text/subtitle fonts (175).
# (scope, package, css files, file fragments to keep) — only the Arabic-script and Latin subsets are embedded.
INTERFACE_FONTS = [("@fontsource-variable", "vazirmatn", ["wght.css"], ["-arabic-wght-normal", "-latin-wght-normal"]),
                   ("@fontsource-variable", "noto-sans", ["wght.css"], ["-latin-wght-normal", "-latin-ext-wght-normal"])]
FONT_PKGS = [("@fontsource-variable", "noto-naskh-arabic", ["wght.css"], ["-arabic-wght-normal", "-latin-wght-normal"]),
             ("@fontsource-variable", "noto-kufi-arabic", ["wght.css"], ["-arabic-wght-normal", "-latin-wght-normal"]),
             ("@fontsource-variable", "markazi-text", ["wght.css"], ["-arabic-wght-normal", "-latin-wght-normal"]),
             ("@fontsource", "ibm-plex-sans-arabic", ["400.css", "700.css"], ["-arabic-400-normal", "-latin-400-normal", "-arabic-700-normal", "-latin-700-normal"]),
             ("@fontsource", "lalezar", ["400.css"], ["-arabic-400-normal", "-latin-400-normal"])]


# 176 · English families for texts and subtitles (Google Fonts via fontsource): Latin files beside the page, fetched the first
#       time a text uses them (never embedded — the page stays light)
LATIN_FONTS = [("@fontsource-variable", p, ["wght.css"]) for p in ("inter", "roboto", "open-sans", "montserrat", "raleway", "nunito", "work-sans", "dm-sans",
                                                                   "playfair-display", "lora", "cormorant-garamond", "oswald", "dancing-script", "caveat")] \
            + [("@fontsource", "poppins", ["400.css", "700.css", "900.css"]), ("@fontsource", "lato", ["400.css", "700.css", "900.css"]),
               ("@fontsource", "merriweather", ["400.css", "700.css", "900.css"]), ("@fontsource", "libre-baskerville", ["400.css", "700.css"]),
               ("@fontsource", "bebas-neue", ["400.css"]), ("@fontsource", "anton", ["400.css"]), ("@fontsource", "abril-fatface", ["400.css"]), ("@fontsource", "pacifico", ["400.css"])]


def latin_faces():
    out_dir = B / "ui/fonts/latin"; out_dir.mkdir(parents=True, exist_ok=True); used, rules = set(), []
    for scope, pkg, cssf in LATIN_FONTS:
        base = NODE_DIR / scope / pkg
        if not base.exists():
            sys.exit(f"MISSING FONT PACKAGE {scope}/{pkg} — npm install in {NODE_DIR.parent}")
        css = "\n".join((base / f).read_text() for f in cssf if (base / f).exists())
        for rr in re.findall(r"@font-face\s*\{[^}]+\}", css):
            m = re.search(r"url\(\./files/([^)]+\.woff2)\)", rr)
            if not m or not re.search(r"-latin-(wght|\d+)-normal\.woff2$", m.group(1)):
                continue
            (out_dir / m.group(1)).write_bytes((base / "files" / m.group(1)).read_bytes()); used.add(m.group(1))
            rr = re.sub(r"src:[^;]+;", f"src:url(fonts/latin/{m.group(1)}) format('woff2');", rr)
            rr = re.sub(r"font-family:\s*'([^']+?) Variable'", r"font-family: '\1'", rr)
            rules.append(rr)
    for f in out_dir.glob("*.woff2"):
        if f.name not in used:
            f.unlink()
    return rules


# 176 · :has() selectors out of the stylesheet. In the editor every DOM change (a clip drawn, a panel filled) made the browser
#       restyle the whole page (≈30–50 ms each, several per action) while any :has() rule was present — the day theme's
#       `:root:has(input.theme-controller…)` above all. What the app needs from them is done with classes instead
#       (data-theme on <html>, collapse-open on an open collapse, the snap button's own class).
def _split_top(s):
    parts, cur, depth, q = [], [], 0, None
    for ch in s:
        if q:
            cur.append(ch)
            if ch == q:
                q = None
            continue
        if ch in "\"'":
            q = ch; cur.append(ch); continue
        if ch in "([":
            depth += 1
        elif ch in ")]":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append("".join(cur)); cur = []; continue
        cur.append(ch)
    parts.append("".join(cur))
    return parts


def _clean_sel(sel):
    if ":has(" not in sel:
        return sel
    out, i = [], 0
    while i < len(sel):
        m = re.match(r":(is|where|not|has|matches|-webkit-any)\(", sel[i:])
        if m:
            name, start = m.group(1), i + len(m.group(0)); depth, j = 1, i + len(m.group(0))
            while j < len(sel) and depth:
                depth += 1 if sel[j] == "(" else -1 if sel[j] == ")" else 0
                j += 1
            if name == "has":
                return None
            kept = [p for p in (_clean_sel(x) for x in _split_top(sel[start:j - 1])) if p is not None and p.strip()]
            if not kept:
                return None
            out.append(":" + name + "(" + ",".join(kept) + ")"); i = j; continue
        out.append(sel[i]); i += 1
    return "".join(out)


def strip_has(css):
    n = len(css)
    def block(i):
        res = []
        while i < n:
            if css[i] == "}":
                return "".join(res), i
            j, depth, q = i, 0, None
            while j < n:
                ch = css[j]
                if q:
                    if ch == "\\":
                        j += 2; continue
                    if ch == q:
                        q = None
                elif ch in "\"'":
                    q = ch
                elif ch in "([":
                    depth += 1
                elif ch in ")]":
                    depth -= 1
                elif depth == 0 and ch in "{;}":
                    break
                j += 1
            pre = css[i:j]
            if j >= n:
                res.append(pre); return "".join(res), j
            if css[j] == ";":
                res.append(pre + ";"); i = j + 1; continue
            if css[j] == "}":
                res.append(pre); return "".join(res), j
            inner, k = block(j + 1)
            if pre.lstrip().startswith("@") or ":has(" not in pre:
                res.append(pre + "{" + inner + "}")
            else:
                kept = [p for p in (_clean_sel(x) for x in _split_top(pre)) if p is not None and p.strip()]
                if kept:
                    res.append(",".join(kept) + "{" + inner + "}")
            i = k + 1
        return "".join(res), i
    out, _ = block(0)
    left = out.count(":has(")
    if left:
        sys.exit(f"STYLESHEET STILL HAS {left} :has() SELECTORS")
    return out


def font_faces():
    out = []
    for scope, pkg, cssf, keep in INTERFACE_FONTS + FONT_PKGS:
        base = NODE_DIR / scope / pkg
        if not base.exists():
            sys.exit(f"MISSING FONT PACKAGE {scope}/{pkg} — npm install in {NODE_DIR.parent}")
        css = "\n".join((base / f).read_text() for f in cssf if (base / f).exists())
        for rr in re.findall(r"@font-face\s*\{[^}]+\}", css):
            m = re.search(r"url\(\./files/([^)]+\.woff2)\)", rr)
            if m and any(k in m.group(1) for k in keep):
                b64 = base64.b64encode((base / "files" / m.group(1)).read_bytes()).decode()
                fmt = "woff2-variations" if scope.endswith("variable") else "woff2"
                rr = re.sub(r"src:[^;]+;", f"src:url(data:font/woff2;base64,{b64}) format('{fmt}');", rr)
                rr = re.sub(r"font-family:\s*'([^']+?) Variable'", r"font-family: '\1'", rr)   # the canvas asks for 'Vazirmatn', not 'Vazirmatn Variable'
                out.append(rr)
    return out


if __name__ == "__main__":
    main()
