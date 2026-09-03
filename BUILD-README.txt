AVA FULL BUILD — deploy checklist (repo: github.com/pirastral/ava-app)
======================================================================
This zip is the COMPLETE application source as of update 88.

*** READ THIS FIRST — THE macOS DOUBLE-ZIP ***
The app files of build 86 deployed correctly. The WORKFLOW did not: it sits
at .github/workflows/build.yml, and macOS Finder HIDES every folder whose
name starts with a dot, so it was invisible when the zip was opened.
Until that one file is in the repo, GitHub keeps building with the OLD
workflow and the download stays a zip inside a zip.

The same file is included here twice:
  WORKFLOW-build.yml            <- visible copy, for copy-paste
  .github/workflows/build.yml   <- correct location (hidden in Finder)
(To see hidden files in Finder: press  Command + Shift + .  )

EASIEST WAY TO INSTALL IT — on the GitHub website, no Finder involved:
  1. open github.com/pirastral/ava-app
  2. Add file -> Create new file
  3. in the filename box type exactly:   .github/workflows/build.yml
     (typing the slashes creates the folders automatically)
  4. paste the whole contents of WORKFLOW-build.yml
  5. Commit changes
  6. open .github/workflows/ and DELETE every OTHER .yml file there
     (if the old one stays, it keeps producing the bad package)

Replace these files in the repo (paths identical):
  app.py            – window + API bridge + worker-mode entrypoints
  engines.py        – ALL synthesis/diacritization/surgery logic (the heart)
  build.spec        – PyInstaller recipe (bundles espeak-ng-data)
  requirements.txt  – pip deps (incl. psutil, transformers)
  ui/index.html     – the entire user interface
  icon.png / icon.ico – app icons (unchanged since first build)

WHAT THE WORKFLOW CHANGES — packaging only, the app is untouched.
  GitHub always wraps an artifact in a zip named after the artifact, so an
  artifact must never contain a zip. It now contains the app itself:
      artifact "Ava-macOS"   -> Ava-macOS.zip -> "Avaye Javid Shah.app"
      artifact "Ava-Windows" -> Ava-Windows.zip -> the program folder
  This is how it behaved up to build 82.
  Every build of main also publishes a RELEASE tagged from engines.py:
      Releases -> نسخهٔ 88 -> Ava-macOS-v88.zip / Ava-Windows-v88.zip
  A release download has no wrapper at all — send that link to anyone else.

Files that live ONLY in the repo and must NOT be touched:
  token.txt   – the Hugging Face token (baked at build time)
  icon.icns   – macOS icon (build.spec references it on darwin)

HOW TO TELL IT WORKED
  - the Actions run shows THREE jobs: macos, windows, release
  - the macOS download opens on the FIRST double-click, no error
  - the footer in the app reads «نسخهٔ ۸۸»
