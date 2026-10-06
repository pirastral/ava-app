"""158 · VERIFY PROTECTION — run by the cloud build AFTER PyInstaller; fails the build if:
  1. any of the app's OWN modules is inside PyInstaller's Python archive as bytecode — i.e. it was
     bundled uncompiled. Checked with PyInstaller's own archive viewer. (A file-name search cannot
     catch this: an uncompiled module lives INSIDE the archive, not as a .py file on disk.)
  2. any of them is missing as a compiled module (.so / .pyd) in the app;
  3. a plain key file (token.txt, builtin_keys.json) or one of our .py sources sits in the app's
     data folders.
Only our own module names are checked — third-party packages are ignored (pywebview, for one,
ships files named app.py for Android; they are not ours)."""
import glob, os, subprocess, sys

MODULES = (os.environ.get("VERIFY_MODULES") or "app,engines,licensing,en_strings,_vault").split(",")
DIST = os.environ.get("VERIFY_DIST") or "dist"
apps = glob.glob(os.path.join(DIST, "*.app"))
if apps:                                                     # macOS: a .app bundle
    bundle = apps[0]; name = os.path.splitext(os.path.basename(bundle))[0]
    exe = os.path.join(bundle, "Contents", "MacOS", name)
    data_roots = [os.path.join(bundle, "Contents", d) for d in ("Resources", "Frameworks", "MacOS")]
else:                                                        # Windows / Linux: a onedir folder
    bundle = [d for d in sorted(glob.glob(os.path.join(DIST, "*"))) if os.path.isdir(d)][0]; name = os.path.basename(bundle)
    exe = os.path.join(bundle, name + (".exe" if os.name == "nt" else ""))
    data_roots = [bundle, os.path.join(bundle, "_internal")]
print(f"[verify] app: {bundle}\n[verify] executable: {exe}")
problems = []

# 1 · inside the Python archive (recursive, names only)
code = "import sys; from PyInstaller.utils.cliutils.archive_viewer import run; sys.argv = ['pyi-archive_viewer', '-r', '-b', sys.argv[1]]; run()"
r = subprocess.run([sys.executable, "-c", code, exe], capture_output=True, text=True)
names = {ln.strip() for ln in r.stdout.splitlines() if ln.strip()}
if r.returncode != 0 or len(names) < 20:
    problems.append(f"could not read the app's Python archive (exit {r.returncode}): {r.stderr.strip()[:300]}")
inside = sorted(m for m in MODULES if m in names)
if inside:
    problems.append("bundled UNCOMPILED (found inside the Python archive): " + ", ".join(inside))
print(f"[verify] archive entries read: {len(names)}; our modules inside it: {inside or 'none'}")

# 2 · compiled modules present
compiled = {}
for root, _dirs, files in os.walk(bundle):
    for f in files:
        base = f.split(".")[0]
        if base in MODULES and f.endswith((".so", ".pyd")):
            compiled.setdefault(base, os.path.join(root, f))
missing = [m for m in MODULES if m not in compiled]
if missing:
    problems.append("compiled module missing: " + ", ".join(missing))
print("[verify] compiled modules: " + (", ".join(sorted(compiled)) or "none"))

# 3 · no plain keys or sources of ours in the data folders (not recursive: library files are not ours)
for d in data_roots:
    for f in ["token.txt", "builtin_keys.json"] + [m + ".py" for m in MODULES]:
        p = os.path.join(d, f)
        if os.path.exists(p):
            problems.append(f"readable file in the app: {p}")

if problems:
    print("::error::protection check failed — not publishing this app")
    for p in problems:
        print("::error::" + p)
    sys.exit(1)
print("[verify] PROTECTED: our code is compiled, none of it is in the Python archive, no plain keys.")
