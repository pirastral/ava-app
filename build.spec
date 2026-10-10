# -*- mode: python -*-
# PyInstaller build recipe for Ava
import sys
from PyInstaller.utils.hooks import collect_all, copy_metadata

import os as _os0, json as _json0
datas, binaries, hiddenimports = [("ui", "ui"), ("icon.png", "."), ("voices", "voices")], [], []
# 180: the .ava document icon (a page with the app's own crown — 181: in neutral greys — tools/make_doc_icon.py): Finder
#      takes the .icns from the bundle's Resources; on Windows the app points the .ava type at the .ico when it starts (app.py)
datas.append(("ava-doc.icns", ".") if sys.platform == "darwin" else ("ava-doc.ico", "."))


# 181: the Mac bundle carries the build number as its version (Finder's «Get Info» shows it), so macOS takes each update for
#      a new version and reads again what the app declares — the .ava icon with it. tools/protect.py writes BUILD_NUMBER
#      before engines.py is compiled away; a plain source build reads engines.py. It never stops a build.
def _build_no():
    import re
    try:
        n = open("BUILD_NUMBER", encoding="utf-8").read().strip()
        if n.isdigit():
            return n
    except OSError:
        pass
    try:
        m = re.search(r"^BUILD = (\d+)", open("engines.py", encoding="utf-8").read(), re.M)
        return m.group(1) if m else "0"
    except OSError:
        return "0"


_BUILD = _build_no()

# 155: in a protected build tools/protect.py has sealed these into the compiled vault and deleted them;
# a plain source build (development) still bundles them as before.
for _f in ("token.txt", "builtin_keys.json"):
    if _os0.path.exists(_f):
        datas.append((_f, "."))
# 155: PyInstaller cannot see imports inside compiled modules — protect.py lists them.
if _os0.path.exists("_hidden.json"):
    hiddenimports += _json0.load(open("_hidden.json"))
for pkg in ["nacl", "torch", "torchaudio", "chatterbox", "transformers", "tokenizers",
            "piper", "onnxruntime", "lameenc", "perth", "s3tokenizer",
            "librosa", "safetensors", "huggingface_hub", "numpy", "requests",
            "espeakng_loader", "pysbd", "diffusers", "conformer", "webview", "audiotsm", "psutil",
            "sentencepiece"]:
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass

# Guarantee the speech engine's pronunciation data ships inside the app.
# (Without this, the engine falls back to a path that only existed on the
# build machine — the exact error the light voices showed.)
import os as _os
import piper as _piper
_ed = _os.path.join(_os.path.dirname(_piper.__file__), "espeak-ng-data")
if not _os.path.isdir(_ed):
    raise SystemExit("BUILD ERROR: piper espeak-ng-data not found at " + _ed)
datas.append((_ed, "piper/espeak-ng-data"))
print("Bundling espeak-ng-data from:", _ed)

for meta in ["requests", "tqdm", "regex", "packaging", "filelock", "pyyaml",
             "numpy", "tokenizers", "safetensors", "huggingface-hub",
             "transformers", "torch", "torchaudio", "charset-normalizer",
             "idna", "urllib3", "certifi", "fsspec", "typing-extensions",
             "onnxruntime", "piper-tts", "sentencepiece"]:
    try:
        datas += copy_metadata(meta)
    except Exception:
        pass

# 126: the activation module ships; the ISSUER (issue_license.py) never does.
hiddenimports += ["licensing", "nacl.signing", "nacl.exceptions", "socks", "sockshandler"]   # 148: SOCKS proxies

# 155: start from the launcher; the app itself is a compiled module in a protected build
a = Analysis(["main.py"], datas=datas, binaries=binaries, hiddenimports=hiddenimports,
             excludes=["tkinter", "matplotlib", "IPython", "pytest"])
pyz = PYZ(a.pure)

icon_file = "icon.icns" if sys.platform == "darwin" else "icon.ico"
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="Avaye Javid Shah",
          console=False, icon=icon_file)
coll = COLLECT(exe, a.binaries, a.datas, name="Avaye Javid Shah")

if sys.platform == "darwin":
    app = BUNDLE(coll, name="Avaye Javid Shah.app", icon="icon.icns",
                 bundle_identifier="ir.kamangir31.ava",
                 info_plist={"CFBundleName": "Avaye Javid Shah",
                             "CFBundleDisplayName": "آوای جاوید شاه",
                             "NSHighResolutionCapable": True,
                             "CFBundleShortVersionString": _BUILD, "CFBundleVersion": _BUILD,   # 181 (above)
                             # 180: .ava is this app's own document — its icon in Finder, and a double-click opens it here
                             "UTExportedTypeDeclarations": [{
                                 "UTTypeIdentifier": "ir.kamangir31.ava.project",
                                 "UTTypeDescription": "Avaye Javid Shah project",
                                 "UTTypeConformsTo": ["public.data", "public.content"],
                                 "UTTypeIconFile": "ava-doc.icns",
                                 "UTTypeTagSpecification": {"public.filename-extension": ["ava"],
                                                            "public.mime-type": ["application/x-ava-project"]}}],
                             "CFBundleDocumentTypes": [{
                                 "CFBundleTypeName": "Avaye Javid Shah project",
                                 "CFBundleTypeRole": "Editor",
                                 "LSHandlerRank": "Owner",
                                 "LSItemContentTypes": ["ir.kamangir31.ava.project"],
                                 "CFBundleTypeIconFile": "ava-doc.icns"}]})
