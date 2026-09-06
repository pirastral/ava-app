AVA FULL BUILD — deploy checklist (repo: github.com/pirastral/ava-app)
======================================================================
This zip is the COMPLETE application source as of update 94.

Replace these files in the repo (paths identical):
  app.py            – window + API bridge (90: voice library + Google keys endpoints)
  engines.py        – ALL synthesis logic (90: Google engine, key rotation, voice cloning)
  build.spec        – PyInstaller recipe (90: bundles the voices/ folder)
  requirements.txt  – unchanged
  ui/index.html     – the entire user interface (90: new layout)
  voices/           – NEW folder: built-in chatterbox reference clips. Ships inside the
                      app. Currently holds only README.txt; drop 8-15 s clips here
                      (wav/mp3, one speaker, no music) — the file name is the voice name.
                      THE FOLDER MUST EXIST IN THE REPO or PyInstaller fails.
  icon.png / icon.ico – unchanged
  .github/workflows/build.yml – unchanged since 89 (also here as WORKFLOW-build.yml)

WHAT CHANGED IN 94 (on top of 93)
  Google clause surgery. Editing or selecting inside a Google part no longer re-does
  the whole part: the clauses the edit/selection touched are regenerated WITH one
  neighbouring clause on each side as prosodic context, the new clause is cut out at
  its own pause boundaries (silence-first, the same machinery as the local engines),
  loudness-matched, and spliced into the original at its pause boundaries with a
  12 ms crossfade. Untouched clauses are kept bit-identical (verified in tests).
  A clause = sentence stop / newline / pause tag (pause tags stay with the clause
  before them; reaction tags open the next clause; mid-sentence tags never split).
  Falls back to a whole-part take when nothing can be kept (single clause, everything
  changed, or the recording has fewer stops than clauses) and says so.
  Part size dropdown ("طول بخش‌ها"): four options, remembered separately for Google
  (300/600/900/1200, default 600) and the local engines (180/280/400/500, default 280).

WHAT CHANGED IN 93 (on top of 92)
  «یکدستی لحن» REMOVED. FIELD LOG (92): for a 15-second tagged transcript it produced
  takes of 40.8 / 40.6 / 56 / 60 s — the model read the first half and emitted silence
  for the rest — because the feature forced temperature 0.35 (degenerate audio) and
  because its pitch audit treated [whispers]/[sighs]/[very slow] as drift and re-rolled
  three times, then tripped the runaway guard (the error). With it off, one take at
  the model's default temperature read the whole text (15.4 s / 18.9 s files).
    - no temperature override on either door
    - one take per part, no audit, no re-rolls, no loudness matching
    - the runaway guard only fires at 6x the estimate + 60 s (tagged slow reading
      legitimately runs 2-3x); the estimate now counts pause/reaction tags and [slow]
  Consistency is carried only by what costs nothing: the identical prompt frame per
  document and long parts.
  FREE-TIER NOTE seen in the log: gemini-3.1-flash-tts free tier = 10 requests/day
  per key ("limit: 10"). The re-roll loop was burning them. For volume use 2.5 Flash,
  or several keys (rotation handles the quota switch automatically).

WHAT CHANGED IN 92 (on top of 91)
  FIELD LOG (91): BOTH doors silent for 75 s — including generateContent, which answers
  the diacritizer in seconds. So the endpoint is not the variable; the generation is
  (long, or looping — TTS models are known to loop on unusual input). Therefore:
  - the classic door now STREAMS (streamGenerateContent, SSE): audio chunks arrive as
    they are made, the status shows seconds received, the timeout is between chunks
    (90 s to first chunk, 45 s gap) instead of one silent wait for a final answer
  - a runaway generation (audio far beyond the transcript's length) is cut and named
  - the prompt frame is a third of its size (the long "audio profile" was a suspect)
  - keys dialog: "⚡ آزمایش اتصال" sends a six-word request on the selected model and
    reports exactly what happened: seconds of audio and elapsed, or the reason
  FIRST TEST TO RUN: keys dialog → آزمایش اتصال with model 2.5 Flash. Then 3.1.
  Its result (and the google_stream line in ava.log) decides the next move.

WHAT CHANGED IN 91 (on top of 90)
  Google request path: the FIELD LOG showed the Interactions endpoint accepting the
    request and staying silent for 180 s x3 ("Read timed out"), from a network where
    generateContent (the diacritizer's endpoint) answers in seconds. So generateContent
    is tried first, Interactions second; a door silent for 75 s is skipped for the
    other; both silent -> immediate clear error (no minutes-long retry ladder).
    Network errors now name the exception in the status and the log.
  Cancel: "✕ لغو" beside the generate button while anything runs — abandons the
    in-flight Google request, kills the piper helper, kills the chatterbox worker
    (respawns on next use). Works for generation, apply-to-all, per-part regenerate
    and diacritization. Parts already built are kept.
  Keys: every key field has an eye toggle inside it. NO KEY SHIPS WITH THE APP — a
    key seen on first run is the user's own Gemini key from earlier حرکت‌گذاری use,
    seeded from AvaModels/ezafe_keys.json on that machine. With no active key the
    generate button is disabled in Google mode, with a hint.
  Google parts are 600 chars (was 800) to keep each request short.

WHAT CHANGED IN 90
  Layout: the engine selector is the first control; text tools and settings follow it.
  Pauses: only [مکث] and [مکث بلند] remain; … and — are plain punctuation again.
  Google (Gemini TTS) engine — new, and the default:
    - models 3.1 Flash (free, audio tags) / 2.5 Flash (free) / 2.5 Pro (paid)
    - 30 voices (Charon default), Persian / English / auto
    - style presets (20) + custom; audio-tag dropup (3.1 only; greyed on 2.5)
    - two-speaker dialogue: lines start with "Name:"; both speakers pick any voice
    - [مکث] tags in a text are translated to Google pause tags automatically
    - tone consistency loop: long parts, fixed persona prompt, low temperature,
      pitch-signature audit with up to 3 takes, loudness matched to the first part
    - a Google part is one recording: regenerating it regenerates the whole part
  Google keys: multi-key dialog; quota-exhausted keys rotate out until the Pacific
    midnight; invalid keys are flagged; the diacritizer's Gemini uses the same list.
  Chatterbox voices: dropdown of reference clips (built-in from voices/, user-added in
    AvaModels/voices via "＋ افزودن نمونه"); clone conditioning cached per voice.
  Audio pipeline: byte-identical to 88 (99.3 % of engines.py unchanged, verified).

Files that live ONLY in the repo and must NOT be touched:
  token.txt   – the Hugging Face token (written from the HF_TOKEN secret at build time)

HOW TO TELL IT WORKED
  - footer reads «نسخهٔ ۹۴»; the engine selector is the first card, Google selected
  - «کلیدهای گوگل» opens the key dialog; after adding a key, a Google part generates
  - Chatterbox shows the «صدای چترباکس» row with «＋ افزودن نمونه»
