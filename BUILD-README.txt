AVA FULL BUILD — deploy checklist (repo: github.com/pirastral/ava-app)
======================================================================
This zip is the COMPLETE application source as of update 64.
Replace these files in the repo (paths identical):

  app.py            – window + API bridge + worker-mode entrypoints
  engines.py        – ALL synthesis/diacritization/surgery logic (the heart)
  build.spec        – PyInstaller recipe (bundles espeak-ng-data; BUNDLE id ir.kamangir31.ava)
  requirements.txt  – pip deps (incl. psutil, transformers)
  ui/index.html     – the entire user interface
  icon.png / icon.ico – app icons (unchanged since first build)

Files that live ONLY in the repo and must NOT be touched:
  token.txt                  – the Hugging Face token (baked at build time)
  icon.icns                  – macOS icon (build.spec references it on darwin)
  .github/workflows/*.yml    – the Actions build that produces Ava-macOS / Ava-Windows

Deploy = commit these files -> green checkmark -> Artifacts -> download both zips.
Verify the new build is really running:
  1) regenerate any gulp after a splice -> the save button must GREY OUT until re-splice
  2) cross-voice patch with Mana must have NO hiss island
