# -*- mode: python -*-
# PyInstaller build recipe for Ava
import sys
from PyInstaller.utils.hooks import collect_all, copy_metadata

datas, binaries, hiddenimports = [("ui", "ui"), ("token.txt", "."), ("icon.png", ".")], [], []
for pkg in ["torch", "torchaudio", "chatterbox", "transformers", "tokenizers",
            "piper", "onnxruntime", "lameenc", "perth", "s3tokenizer",
            "librosa", "safetensors", "huggingface_hub", "numpy", "requests",
            "espeakng_loader", "pysbd", "diffusers", "conformer", "webview",
            "sentencepiece"]:
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass

# Guarantee the speech engine's pronunciation data ships inside the app.
# (Without this, the engine falls back to a path that only existed on the
# build machine — the exact error the light voices showed.)
try:
    import os as _os
    import piper as _piper
    _ed = _os.path.join(_os.path.dirname(_piper.__file__), "espeak-ng-data")
    if _os.path.isdir(_ed):
        datas.append((_ed, "piper/espeak-ng-data"))
except Exception:
    pass

for meta in ["requests", "tqdm", "regex", "packaging", "filelock", "pyyaml",
             "numpy", "tokenizers", "safetensors", "huggingface-hub",
             "transformers", "torch", "torchaudio", "charset-normalizer",
             "idna", "urllib3", "certifi", "fsspec", "typing-extensions",
             "onnxruntime", "piper-tts", "sentencepiece"]:
    try:
        datas += copy_metadata(meta)
    except Exception:
        pass

a = Analysis(["app.py"], datas=datas, binaries=binaries, hiddenimports=hiddenimports,
             excludes=["tkinter", "matplotlib", "IPython", "pytest"])
pyz = PYZ(a.pure)

icon_file = "icon.icns" if sys.platform == "darwin" else "icon.ico"
exe = EXE(pyz, a.scripts, exclude_binaries=True, name="Ava",
          console=False, icon=icon_file)
coll = COLLECT(exe, a.binaries, a.datas, name="Ava")

if sys.platform == "darwin":
    app = BUNDLE(coll, name="Ava.app", icon="icon.icns",
                 bundle_identifier="ir.kamangir31.ava",
                 info_plist={"CFBundleDisplayName": "Ava",
                             "NSHighResolutionCapable": True})
