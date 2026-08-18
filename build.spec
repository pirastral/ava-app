# -*- mode: python -*-
# PyInstaller build recipe for Ava
import sys
from PyInstaller.utils.hooks import collect_all, copy_metadata

datas, binaries, hiddenimports = [("ui", "ui"), ("token.txt", "."), ("icon.png", ".")], [], []
for pkg in ["torch", "torchaudio", "chatterbox", "transformers", "tokenizers",
            "piper", "onnxruntime", "lameenc", "perth", "s3tokenizer",
            "librosa", "safetensors", "huggingface_hub", "numpy", "requests",
            "espeakng_loader", "pysbd", "diffusers", "conformer", "webview"]:
    try:
        d, b, h = collect_all(pkg)
        datas += d; binaries += b; hiddenimports += h
    except Exception:
        pass

for meta in ["requests", "tqdm", "regex", "packaging", "filelock", "pyyaml",
             "numpy", "tokenizers", "safetensors", "huggingface-hub",
             "transformers", "torch", "torchaudio", "charset-normalizer",
             "idna", "urllib3", "certifi", "fsspec", "typing-extensions",
             "onnxruntime", "piper-tts"]:
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
