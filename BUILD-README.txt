AVA FULL BUILD — deploy checklist (repo: github.com/pirastral/ava-app)
======================================================================
This zip is the COMPLETE application source as of update 85.
Replace these files in the repo (paths identical):

  app.py            – window + API bridge + worker-mode entrypoints
  engines.py        – ALL synthesis/diacritization/surgery logic (the heart)
  build.spec        – PyInstaller recipe (bundles espeak-ng-data; BUNDLE id ir.kamangir31.ava)
  requirements.txt  – pip deps (incl. psutil, transformers)
  ui/index.html     – the entire user interface
  icon.png / icon.ico – app icons (unchanged since first build)
  .github/workflows/build.yml  – NEW in 85: the Actions build (see below)

WHAT CHANGED IN 85
  Packaging only — no change to the app's behaviour, audio, or memory.
  The macOS download used to be named Ava-macOS.zip AND to contain a file
  named Ava-macOS.zip. Archive Utility then had nowhere to write its output:
  "unexpected format", a second archive appearing beside the first, and the
  app only emerging on the second attempt. build.yml fixes it permanently:
    - artifact 'mac-build' -> download mac-build.zip
      holding  Avaye-Javid-Shah-macOS.zip        (names can no longer collide)
    - a guard step FAILS the build if the two names are ever made equal again
    - tagged builds attach the zips to a Release: no wrapper zip at all, so
      the download is the file itself — one double-click, any Mac
    - macOS packaging keeps using ditto (preserves the .app's symlinks and
      executable bits) and macos-14 / Python 3.11 to match the shipped bundle

  IMPORTANT: .github/workflows/build.yml REPLACES the previous workflow.
  Delete any other .yml in .github/workflows/ so only one build runs.

Files that live ONLY in the repo and must NOT be touched:
  token.txt   – the Hugging Face token (baked at build time)
  icon.icns   – macOS icon (build.spec references it on darwin)

Deploy = commit these files -> green checkmark -> Artifacts -> download
  mac-build.zip (contains Avaye-Javid-Shah-macOS.zip)
  windows-build.zip (contains Avaye-Javid-Shah-Windows.zip)
For a one-click download for someone else, push a tag instead:
  git tag v85 && git push --tags     -> Releases page, single-file downloads

Verify the new build is really running:
  1) the footer must read «نسخهٔ ۸۵»
  2) on macOS the artifact must expand on the FIRST double-click
  3) light voices (mana/gyro/amir) must work on a Windows machine whose
     username is Persian — the espeak data relocates to an ASCII path (84)
