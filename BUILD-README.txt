AVA FULL BUILD — deploy checklist (repo: github.com/pirastral/ava-app)
======================================================================
This zip is the COMPLETE application source as of update 86.
Replace these files in the repo (paths identical):

  app.py            – window + API bridge + worker-mode entrypoints
  engines.py        – ALL synthesis/diacritization/surgery logic (the heart)
  build.spec        – PyInstaller recipe (bundles espeak-ng-data; BUNDLE id ir.kamangir31.ava)
  requirements.txt  – pip deps (incl. psutil, transformers)
  ui/index.html     – the entire user interface
  icon.png / icon.ico – app icons (unchanged since first build)
  .github/workflows/build.yml  – the Actions build (REPLACES the old workflow)

WHAT CHANGED IN 86 — packaging only. No change to the app itself.
  The rule, now enforced by the workflow's structure:
  a downloaded package must be ONE zip that opens on the FIRST double-click.

  GitHub always wraps an artifact in a zip named after the artifact. So an
  artifact must never contain a zip — it contains the app itself:
      artifact "Ava-macOS"   -> download Ava-macOS.zip -> "Avaye Javid Shah.app"
      artifact "Ava-Windows" -> download Ava-Windows.zip -> the program folder
  This is exactly how it behaved up to build 82.

  Additionally, every build of main now publishes a RELEASE, tagged with the
  build number read from engines.py:
      Releases -> نسخهٔ 86 -> Ava-macOS-v86.zip / Ava-Windows-v86.zip
  A release download has no wrapper at all: the file you click IS the zip.
  Send that link to anyone else — it is the cleanest path, and the macOS zip
  is built with ditto so symlinks and the executable bit survive.

  IMPORTANT: delete any other .yml in .github/workflows/ so only one runs.

Files that live ONLY in the repo and must NOT be touched:
  token.txt   – the Hugging Face token (baked at build time)
  icon.icns   – macOS icon (build.spec references it on darwin)

Deploy = commit these files -> green checkmark -> then either
  Actions -> Artifacts -> Ava-macOS.zip        (one zip, one double-click)
  Releases -> نسخهٔ 86 -> Ava-macOS-v86.zip     (no wrapper at all)

Verify the new build is really running:
  1) the footer must read «نسخهٔ ۸۶»
  2) the macOS download must expand on the FIRST double-click, with no error
  3) light voices must work on a Windows machine with a Persian username
