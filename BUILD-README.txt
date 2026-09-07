AVA FULL BUILD — deploy checklist (repo: github.com/pirastral/ava-app)
======================================================================
This zip is the COMPLETE application source as of update 103.

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
  builtin_keys.json – NEW (101): Freesound / Jamendo keys shipped with the app
  .github/workflows/build.yml – unchanged since 89 (also here as WORKFLOW-build.yml)

WHAT CHANGED IN 103 (on top of 102) — from the 101 field log
  Truncated takes: the model sometimes ends a stream cleanly after the first sentence
    ("audio_s=8.3 expect_s=63.0, looping=False stalled=False"). A take shorter than 35 % of
    the text's plausible length is now a failed take → the request is retried (rotation),
    never accepted. The lead-in is now ONE plain sentence with every tag stripped, and a
    very long one is cut to its last 18 words — the smallest thing the model can trip on.
  Music search: Freesound styles use OR-tag filters (wide enough to fill pages); Openverse
    no longer uses its "music" category filter (it returned nothing).
  Lyria: an invalid key in the list is skipped and flagged (was: raw JSON error); list-
    shaped error bodies from Google are parsed. One of the user's keys IS invalid ("API key
    not valid") — the key dialog shows it as نامعتبر.

WHAT CHANGED IN 102 (on top of 101)
  BUG FIXED — wrong text regenerated. Surgery inside part B inherited part B's lead-in
    (part A's last sentence); the lead-in trim then picked the wrong silence and the
    "regenerated" audio was part A's sentence. Surgery now never carries a lead-in.
    Whole-part regeneration keeps its pinned lead-in, and the trim is rejected (plain
    regeneration instead) when the kept length is implausible for the part's text.
  Trailing/leading pause tags are dropped from a part before sending (a trailing tag was
    read aloud); the continuity tail never carries pause tags.
  Layout: fixed header; fixed bottom dock with status + progress, cancel, undo/redo (LTR:
    undo left, redo right, English hints), «ساخت فایل نهایی» and «تبدیل به گفتار».
    Generate scrolls to the parts, splice to the final box; undo/redo scroll to and flash
    the affected parts. Only one audio player plays at a time.
  Parts: title «بخش ۱ از ۵ — فایل A» in one blue style; LTR icon toolbar in the order
    move up, move down, duplicate, delete. Part-editor tag menu opens UPWARD, unclipped.
  Undo: clear-all is undoable; parts are never dropped from memory while any undo state
    can bring them back (gc runs on what is unreachable). new_document() replaces
    reset_gulps() in the UI flow.
  Music: panel split into «انتخاب موسیقی» and «موسیقی انتخاب‌شده و تنظیم آمیختن»; no key
    UI; English style names; styles use each platform's own vocabulary (Freesound tag
    filters, Jamendo fuzzytags, Openverse text) with Ambient (no drums) first, Drone,
    then Lo-fi; 8 results per page with paging. Ducking retuned: 12 dB, ~0.2 s in,
    ~1.5 s swell back.
  Speakers default to کیان / دریا. Gemini TTS allows at most TWO speakers per request —
    more than two would need per-line generation (see chat).

WHAT CHANGED IN 101 (on top of 100)
  Freesound is the default music source. The owner's Freesound API key and Jamendo client
  id ship inside the app in builtin_keys.json (bundled by build.spec; ADD THIS FILE TO THE
  REPO). A key the user saves in the panel overrides the built-in one. Anyone holding the
  app can read these keys — acceptable for this private family app; NEVER do this in the
  commercial product (keys belong on the server).

WHAT CHANGED IN 100 (on top of 99)
  Music providers («منبع موسیقی» in the music panel), free-first:
    - Openverse (DEFAULT): no key; CC0 / public-domain music aggregated from Freesound,
      Jamendo, Wikimedia. Anonymous use is rate-limited (fine for a person).
    - Freesound: free key (freesound.org → freesound.org/apiv2/apply); filtered to CC0 and
      20–900 s; uses the HQ MP3 preview (downloads would need OAuth). Best for beds/ambience.
    - Jamendo: free client_id (devportal.jamendo.com); instrumental tracks; CC BY / BY-NC —
      the app records author/license/page and shows the credit line to include.
    - Lyria 3.5: paid key only ($0.08/track) — kept as an option.
    - Own file: WAV/MP3/OGG/FLAC from disk.
    Every chosen track is decoded (WAV natively; MP3/OGG/FLAC via soundfile), becomes the
    bed, and is saved to the library with provider + license + author. Mood presets map to
    search terms per provider. Keys for Freesound/Jamendo stored like the other API keys.
  Word-level Google surgery: decided NOT to build (audible seams); clause-level stays.

WHAT CHANGED IN 99 (on top of 98)
  Icons: every emoji glyph replaced by Lucide SVG icons (ISC license, https://lucide.dev),
    inlined as a sprite in index.html — served locally, no network, theme-aware via
    currentColor. Delete is the trash icon; eye/eye-off toggles; tag, key, music, plus,
    settings, pencil, refresh, arrows, copy, undo/redo, sun/moon, download, zap, sparkles.
  Undo / redo for the parts list: every structural change (move, duplicate, delete,
    regenerate, append, clear) is remembered; ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y (and the two
    header buttons). Inside a text field the field's own undo is left alone. Deleted parts
    keep their audio in the engine so undo restores them intact.
  Lyria has NO free tier ($0.08 per track, billing-enabled project only). A free-tier key
    answers 403 for music while being fine for speech: such answers no longer flag the key;
    the user gets one clear message about needing a paid key.
  Answered, not built: Lyria has no sound-effects library; word-level Google surgery is
    feasible with Transcribe timestamps (see chat) and is the proposed next feature.

WHAT CHANGED IN 98 (on top of 97)
  Additive generation: the first «تبدیل به گفتار» starts a document; later ones APPEND the
  main text's new content as new parts (no reset, continuity lead-in continues). Pressing it
  again with unchanged text does nothing but explain. «🗑 پاک‌کردن همهٔ بخش‌ها» starts over.
  Part toolbar: every part has a header «بخش A · ۱ از ۵» — the LETTER is the part's
  identity, given once and never reused in a document; the NUMBER is its current position.
  Icon buttons ▲ ▼ ⧉ ✕ (move up/down, duplicate with its audio cloned, delete).
  Music library: every Lyria bed is saved on this machine (AvaModels/music, WAV + manifest)
  and listed under «موسیقی‌های قبلی» in the music panel; picking one costs nothing.
  Tag note rewritten: a tag applies to what FOLLOWS it; state tags last until the next tag
  of their kind or the end of the part; event tags fire once; no closing tags.
  Prices (Google, Sept 2026): Lyria 3.5 ≈ $0.08 per track; 3.5 Transcribe ≈ $0.005/min.

WHAT CHANGED IN 97 (on top of 96)
  Lead-in duplication fixed. FIELD (96): the previous part's last clause was heard twice
  — its tail words («یا یک شورا میگرفت») were missing from the transcript, so the cut was
  placed at the midpoint of a window that actually contained speech. The boundary is now
  found in the AUDIO of the window between the two anchor words (longest silence), with
  the transcript gap only as a fallback. Handles both mis-heard and omitted words.
  RTL editors fixed. The text areas used unicode-bidi:plaintext, which lets each line take
  its direction from its first strong character — a line starting with [serious] became
  left-to-right and scrambled. Base direction is now always RTL (unicode-bidi:isolate);
  English tags are simply LTR runs inside it. Applies to the main text and part editors.
  One clause per line: on generate and after diacritization the main text is reflowed so
  every sentence (and every pause tag) ends a line; part editors show their text the same
  way. Selecting a sentence is now a line selection. Newlines are harmless to every engine.
  Part editors of Google parts get the "🏷 برچسب‌ها" dropup (opens downward), exactly
  where local parts have their two pause chips.

WHAT CHANGED IN 96 (on top of 95)
  Gemini 3.5 Transcribe (GA Aug 26): word-level timestamps are now the FIRST source of
    clause boundaries for Google surgery and lead-in trimming (language-independent,
    diacritic-insensitive alignment); the silence heuristic is the fallback. One
    transcription per recording, cached.
  Captions: SRT / VTT export after the final file — timing from the recording, text from
    the user's own clauses (tags stripped), monotonic across the splice breath.
  Lyria 3.5 background music: checkbox in the final box → preset / custom description,
    level relative to voice, ducking under speech, fade; "♪ ساخت موسیقی" previews the bed;
    the final step returns TWO files (clean + with music). Bed generated once per document.
    WAV requested; stereo 44.1 kHz decoded to mono; MP3 fallback via soundfile.
  Persian: every user-facing string in the app (UI, statuses, errors) and the whole guide
    rewritten as natural Persian, not translated English.
  NOTE for the commercial plan: no Gemini 3.5 TTS exists (checked the full changelog to
    Sept 4, 2026); 3.1 Flash TTS is the latest speech model. temperature/top_p/top_k are
    deprecated since July 21.

WHAT CHANGED IN 95 (on top of 94)
  Boundary finder fixed. FIELD LOG (94): "g_boundaries runs=17 need=2 mode=nearest" — the
  estimate for a clause end was computed from raw characters, and half of the first clause
  was tags ([serious], [short pause]) that produce no speech; the estimate overshot onto the
  comma breath after «قسمتِ سوم،», so the old clause was cut short and the new one duplicated
  its opening. Now: estimates from SPOKEN characters only; candidate silences ranked by
  LENGTH (real stops in the recording are 0.7–2.0 s, comma breaths 0.13–0.23 s), validated
  against the estimates; the extracted clause must fit the part's speaking rate or the
  surgery falls back to a whole-part take.
  Continuity between parts (toggle «پیوستگی میان بخش‌ها», default on): Google has no seed
  and no previous-text parameter, so each part is generated with the previous part's last
  clause spoken first as a lead-in and trimmed off at its pause boundary; the model hears
  where it left off. ~10 % more audio per part. If the trim boundary is not found the part
  is regenerated plain — never shipped with a duplicated sentence. Each part pins its own
  lead-in so a later regeneration stays continuous with the right neighbour.

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
  - footer reads «نسخهٔ ۱۰۳»; the engine selector is the first card, Google selected
  - «کلیدهای گوگل» opens the key dialog; after adding a key, a Google part generates
  - Chatterbox shows the «صدای چترباکس» row with «＋ افزودن نمونه»
