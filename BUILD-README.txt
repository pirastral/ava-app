AVA FULL BUILD — deploy checklist
======================================================================
This zip is the COMPLETE application source as of update 150.

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
  en_strings.py     – NEW (107): English renderings of engine messages (116: Fish added)
  requirements.txt  – 116: + msgpack
  voices/           – NOW POPULATED (107): 63 clips + voices.json
  ui/fonts/         – NEW (110): Vazirmatn woff2 (Regular, Medium, Bold)
  .github/workflows/build.yml – unchanged since 89 (also here as WORKFLOW-build.yml)

WHAT CHANGED IN 150 (on top of 149) — no VPN first, all routes at once
  The app must work with no VPN at all, and Iranian users cycle between VPNs
  and proxies because none works best all the time.
   · DIRECT (NO VPN) IS FIRST, ALWAYS — also on every re-search after a failure,
     because the VPN may simply have been switched off. Only an explicitly chosen
     proxy mode ("manual/system proxy first") puts that proxy ahead of it. When
     direct and a proxy both answer, direct is used.
   · ALL ROUTES ARE PROBED AT ONCE (threads). Priority is the order; the search
     settles as soon as every route ahead of the best answer has failed. Eight
     routes of 0.5 s each settle in 0.5 s instead of 4 s. The whole search has a
     4-second budget, so a hanging network can never hang the app.
   · A FAILED ROUTE IS BENCHED FOR 60 SECONDS, NOT FOR THE SESSION. Switch from
     v2rayN to Clash and back an hour later, and each is found again. Direct is
     never benched at all — it costs nothing to ask, in parallel.
   · WARM-UP AT LAUNCH: once the licence is valid the route search starts in the
     background, so a route is usually ready before the first request.
   · the route state is guarded by a lock, so the warm-up and a request can never
     apply routes over each other.
  Verified: no VPN → direct, first probe; 8 routes in parallel in 0.5 s; direct
  wins when both work; VPN switched mid-session → direct tried first, then the
  new VPN found; the old VPN found again a minute later; the warm-up returns in
  0 ms; a hanging network gives up within the budget.

WHAT CHANGED IN 149 (on top of 148) — the route finder can never imprison the app
  An audit of 148 against the question "can the VPN logic lock out a user who
  has no VPN?" found two traps and one bug:
   · THE PRISON: a manual proxy (or "direct", or "system") was the ONLY route
     tried. A proxy saved in Iran would lock out the same user abroad with no
     VPN — and tell them to turn their VPN on. Every mode is now a PREFERENCE: its
     route is tried first, then the automatic search runs, and direct is always
     the last resort. The user is told when their chosen route failed and which
     one was used.
   · THE DEAD PROXY: when no route worked, the last applied proxy stayed set for
     the whole app. Now the proxy environment the app STARTED with is snapshotted
     and restored — the user's own settings return untouched.
   · ONE KEY: the "two keys in a row unreachable → re-route" rule could not fire
     with a single key, so a one-key user whose VPN dropped was told "no key
     answered". The threshold is now min(2, number of keys).
  Also:
   · Tor: Tor Browser (9150) and the Tor service (9050), SOCKS, tried LAST among
     proxies. The manual says plainly that Google blocks most Tor exits and that
     Tor gives no anonymity from Google (every request carries the user's key).
   · Fish Audio, the music search and model downloads now use the route finder
     too (through _net_ready, which can never raise or block a request).
   · no message assumes Iran or a VPN any more: "the internet is not connected,
     or — if you are in a country that restricts Google, such as Iran — the VPN".
   · UI labels say what the modes now do: "… first".
  Verified: abroad with no VPN connects on the first probe; the stale-manual-
  proxy case falls through to direct; the user's own proxy setting is restored
  after a total failure; a VPN switched off mid-session re-routes with one key.

WHAT CHANGED IN 148 (on top of 147) — the app finds a route through the VPN
  For users in Iran a VPN is mandatory, so a blocked network is the most common
  way the app fails. Three facts found in 147's investigation:
   · the app honours a Windows STATIC system proxy (requests reads the registry);
   · it does NOT honour a PAC proxy (AutoConfigURL) — many VPN clients default to
     PAC or "system proxy" modes the browser follows and the app does not, so
     "the browser works, the app is refused";
   · with no PySocks bundled it could not use a SOCKS-only proxy.
  NOW — a route finder (ensure_route):
   · Automatic mode (default) tries, in order: the current route (env / system
     proxy); each local proxy of the common clients that is LISTENING on
     127.0.0.1 — v2rayN 10809/10808, Nekoray/Nekobox 2080, Clash 7890, Hiddify
     12334, v2rayA 20171/20170, plus 1080 and 8889 — HTTP then SOCKS; finally
     direct (which IS the VPN when the client runs in TUN mode).
   · each route is tested against Google with a deliberately invalid key: a
     working route answers JSON «API key not valid», a blocked one Google's HTML
     403. No quota is spent; only Google and loopback proxies are contacted.
   · the first working route is applied process-wide through the standard proxy
     environment variables, which requests AND huggingface_hub honour (direct
     sets NO_PROXY=* so a registry proxy is bypassed too).
   · it runs before the first Google request of a session, and again when a
     request is blocked mid-session: re-search once, retry the request once. Still
     no key is ever condemned. If no route works, the message names the cause
     (VPN off → turn it on / TUN; region → Europe or North America; blocked →
     another server or TUN).
   · Settings → "Network and VPN" (beside Google keys): Automatic / System proxy
     only / Manual proxy (http:// or socks5h://) / Direct, and a "Test network"
     button that shows which route reached Google.
   · PySocks now ships (requirements.txt + hiddenimports), so SOCKS routes work.
  Both manuals gained a "VPN and connecting to Google" section, and the network
  troubleshooting entry points to it.
  Verified with a REAL socket listening on 127.0.0.1:10809 for port detection;
  probe classification, route selection and application, mid-session re-route,
  and manual/direct modes tested with mocked Google answers (Google itself is
  unreachable from the build sandbox).

WHAT CHANGED IN 147 (on top of 146) — keys wrongly condemned by a network block
  FIELD (a user's log): the same 18 keys worked all day under 126. The moment
  146 ran, the connection to Google broke — «Max retries exceeded», dropped
  connections, then Google's HTML «Error 403 (Forbidden)» front-door page
  (what a blocked region or a flagged VPN/proxy exit receives). The rotation
  treated EVERY 403 as "bad key": the first key was condemned, the next got the
  identical page and was condemned, and all 18 were marked invalid — ON DISK.
  Re-pasting revived them and the next request killed them all again. The rule
  was identical in 126; it surfaced only when that user's network changed.
  NOW:
   · one classifier, _google_fault(): a key is condemned ONLY when Google names
     the key (invalid / expired / leaked / blocked / API not enabled for the
     project). An HTML front-door page is "network"; «User location is not
     supported» is "region"; any other 403 is "other" and condemns nothing.
   · network or region: rotation STOPS at once (every key would get the same
     page) and says plainly that it is not a key problem and no key was touched.
   · two keys in a row that never reached Google also stop the rotation — no
     more cycling through 18 keys × 3 attempts on a dead connection.
   · raw HTML never reaches the status line; only a page's <title> survives.
   · ONE-TIME REPAIR: every "bad" mark written before 147 may come from the old
     rule, so all are cleared once; genuinely bad keys are re-marked on first
     use. And any condemned key that answers again is restored automatically.
   · the Lyria music path had a comment saying its paid-only 403 "must not flag
     the key" — and flagged it anyway, so one attempt at music on a free key
     would have wiped every key. It now uses the same classifier.
  Both manuals gained two troubleshooting entries (the network message, and
  keys that became invalid for no reason).

WHAT CHANGED IN 146 (on top of 145) — from the 145 field session
  145 was shippable; 146 changes as little as possible.
  1) FISH: A WEAK TRANSCRIPT MUST NOT SLICE. Log: `g_words_align matched=0 of=13
     mode=thin` — Google's ASR recognised nothing in Fish Audio's Persian, so
     the Enter-split fell to a silence guess and cut in the wrong place; the old
     voice's remainder («که کسی جدی‌اش نگرفت») then sat in the next line's range
     and was heard after the new voice. When the alignment accounts for less
     than 40 % of the words, the split is not sliced: each new line is made on
     its own (144's solo path), in its previous voice. Google audio, where the
     ASR is reliable, is unaffected.
  2) FISH: A BOUNDARY PLACED FROM A WEAK WITNESS IS CROSS-CHECKED. Only for
     Fish parts (cross-engine transcript): a word-placed cut far from where the
     text's proportions say it should be sits on a mis-heard word, and is
     snapped to the silence nearest the proportional position. Google parts are
     untouched.
  3) THE PASTE "INVALID ARGUMENT". Attempts 1–4 made 3 pieces and the third was
     refused with 400 on BOTH doors; attempt 5 made the same three and all
     passed. The «سهمیه ته کشید» seen alongside was a real, separate 429 on one
     key that rotated correctly (429 → next key → 200). Now a 400 is: logged
     with what was sent (voice, model, style, age, mood, lead-in length, first
     40 chars); retried once as a stripped-down request (text + voice only,
     zero-width/format characters removed); and if refused again, reported
     NAMING the line — never mistaken for a dead key.
  4) SELECTION OFFSETS DESCRIBE THE TEXT THAT IS SENT. They were taken from the
     raw textarea while the engine received ta.value.trim(): leading whitespace
     shifted them and a triple-click's trailing line break extended them. Both
     are normalised now, so dragging and triple-clicking behave the same.
  5) The static footer placeholder still read «نسخهٔ ۱۲۵» (the runtime stamp from
     the engine was always correct); updated.
  Rebuilt after the sandbox reset: the regression battery (146 guarantees G1–G5
  re-asserted on the SHIPPED 145 source, byte-identical md5) and the UI suite.

WHAT CHANGED IN 145 (on top of 144) — harmony audit of 143/144
  Walking the new mechanisms against every older one found three seams:
  1) ONE ALIGNMENT CONVENTION. The ZWNJ merge (143) was applied in the two
     boundary finders but not in the completeness audit, the coverage map, the
     anchor or the span proof — so the audit could still call «یک‌جانبهٔ» missing
     and raise a false badge or a needless retake. Every word alignment in the
     engine now merges split compounds first.
  2) THE SOLO FLAG SURVIVES THE BASE-VOICE FALLBACK. A split line with no
     remembered voice had its plan entry rebuilt without the "solo" mark, so it
     could be grouped into a run again. Preserved.
  3) HOLE BADGES AFTER THE PATCH PATH. Since 143 a no-selection regeneration goes
     through patch_gulp, and the UI never applied the audit's holes after that
     call — a hole found during a fresh full take went unreported. Applied.
  Everything else checked and left alone: the fresh-full rule forks a new part
  (Undo intact), runs the audit and the lead-in; local engines and silence/file
  parts never enter the fresh-full branch; the map validation runs after every
  solo generation; the anchor path remains the fallback only for an untrusted
  map with a selection.

WHAT CHANGED IN 144 (on top of 143) — a split line is independent from birth
  When a line is broken into several by Enter, each new line is its own unit
  from that moment: own audio, own voice, own map entry. 143 sliced them when it
  could, but when the slice failed it marked all the new lines "make" and then
  GROUPED them into one run — the very grouping that bled «نبرد یک‌جانبهٔ روم»
  into one take. Now a new line whose audio cannot be sliced is generated ON
  ITS OWN, in the old line's voice, never as part of a run and never with a
  neighbour as context. Verified with every slicing route disabled: six
  one-word lines, one selected → six single-line calls (one in the new voice,
  five in the old), and afterwards each line edits independently.

WHAT CHANGED IN 143 (on top of 142) — from the 142 field session
  1) NOTHING SELECTED (or everything selected) = A FRESH START. The user's rule.
     A full regeneration now owes nothing to the surgical past: one take in the
     part's current voice, a fresh map, a fresh transcript. This removes the
     "scars" (extra pauses, mismatched tone, a line read twice, «پیش‌گفتار»
     dropped, a duplicated part that spoke only its last clause) — all of which
     were the old no-selection path applying a diff on top of accumulated state.
     Deleting with nothing selected therefore remakes the part; to delete for
     free, select any short line.
  2) THE ONE-WORD POISON. Log: `g_words_align holes=2 of=5 too_many_unmatched`
     → the slice of the six one-word lines failed → all six regenerated, and the
     contextless fallback handed one take to the first line («نبرد یک‌جانبهٔ
     روم» read together, «روم» again). Two fixes:
       · ZWNJ compounds: the ASR writes «یک جانبه» for our «یک‌جانبهٔ». Before
         aligning, adjacent transcript words whose concatenation is one of our
         words are merged into one spanning both — the two "unmatched" lines now
         match.
       · the slice never gives up on a pure re-segmentation: words → word spans
         → proportional cut at the nearest silence (a choice of cut point inside
         audio the text says is there — never an invention of content).
       · a run whose boundaries cannot be found in a fresh take is made ONE LINE
         AT A TIME, so no neighbour can bleed in.
  3) The last-words truncation check tolerates the ASR's spelling of the final
     word (fuzzy match), so a real truncation is caught without false alarms.
  4) The «ناقص» badge clears at the start of every regeneration of that part
     (the audit re-marks it if needed), and CLICKING it shows the missing
     sentence in the status line — native tooltips are unreliable in the webview.
  5) Both in-app manuals re-read in full and rewritten where the engine had moved
     on: the Regenerate bullet, the whole surgery section (the line map, the
     text check, the no-selection rule, the deletion rows, the failure path) and
     the Undo paragraph — in both languages.

WHAT CHANGED IN 142 (on top of 141) — THE MAP IS CHECKED AGAINST THE TEXT
  The text area is authoritative for WHAT exists and in WHAT ORDER; it cannot say
  WHERE a line's audio is, but it can say when a map is impossible. Every line
  map is now validated against four invariants, after generation, BEFORE any
  cut, after every edit, and after every rebuild:
    · a line that exists has audio (a 0-sample range for a 1-word line is wrong);
    · ranges are ordered, disjoint and inside the recording;
    · a line's share of the duration follows its share of the words, loosely
      (≤4× skew; lines under 3 words are not judged);
    · the map covers the recording.
  THE RULE THAT KEEPS THIS FROM HALLUCINATING: the text may REJECT a map, it may
  never AUTHOR one. A rejected map is rebuilt from the transcript by the
  word-span route (remembered voices survive, keyed by line text); if that fails
  the map is marked UNTRUSTED with a visible message, and the next edit works
  from a fresh transcript — never a cut on a map the app knows is wrong.
  HARMONY AUDIT of the addition against every mechanism that touches the map:
    · the older anchor-based surgery (the fallback when the map is untrusted)
      changed the audio but left the map STALE — a stale map could pass by
      chance and misplace a later cut. It now rebuilds and validates the map.
    · a fork (140) carries `map_untrusted` with it; validation clears it when
      evidence returns, so the flag is never sticky.
    · surgical runs never run the audit or touch the lead-in (128/136) — unchanged.
    · gain, silence/file parts, gc, captions: none read the map — unchanged.
  Verified: the two field maps (an empty «پیش‌گفتار», a 6-word line squeezed to
  0.4 s) are rejected; with no transcript nothing is invented; after 20 mixed
  edits the map is provably valid at every step.

WHAT CHANGED IN 141 (on top of 140) — from the 140 field session
  1) AN ENTER IS A SPLIT, NOT A REWRITE. Pressing Enter inside a line showed up in
     the line diff as "one old line replaced by three new lines", so all three
     were marked to be made — the two never touched were regenerated (log:
     `made=3 chosen=1`), and with six one-word lines the runs bled into each
     other (`made=6 chosen=1`, «نبرد» and «روم» heard twice). If the new lines'
     words are exactly the old lines' words, the audio ALREADY EXISTS: it is now
     SLICED at the word timings and every piece kept with its own voice. Nothing
     is generated for a split; only the line you select is made.
  2) ONE UNMATCHED CLAUSE NO LONGER DISCARDS THE WHOLE ALIGNMENT. «پیش‌گفتار»
     (one word, ZWNJ) is unmatched by the ASR; the boundary finder then gave up on
     ALL seven boundaries and fell to silence mode, whose cuts were badly off
     (1.6 s for a six-word line, 2.7 s for a twelve-word one). That poisoned the
     line map: «با ایران» filed under the next line (so a paste landed
     mid-sentence), «پیش‌گفتار» left with an empty range (so it was never read).
     A boundary the words cannot place is now interpolated from its neighbours
     and snapped to the nearest silence; the rest stay word-exact.
  3) THE INDEX NEVER SILENTLY COLLAPSES TO ONE LINE. After a repair splice it
     came back `single / no_boundaries`, so the next edit rebuilt everything. A
     second route now builds it from each line's own first/last matched words;
     only with no transcript at all does it collapse, and then the status says
     so.
  4) A LINE WITH NO REMEMBERED VOICE inherits the PART's base voice, never the
     currently selected one (a third sentence came back in the new voice).
  5) "App defaults" in a part's settings now clears the part's own settings, so
     the gear icon goes back to plain.
  6) After Undo/Redo every player is paused and reloaded, so none can keep a
     previous source.
  Verified with a synthetic engine whose voices are distinct tones, measured on
  the audio itself: two-Enter split (1 generated of 6 lines), six one-word lines
  edited one by one, paste-in landing after the whole line, gutting keeping
  «پیش‌گفتار».

WHAT CHANGED IN 140 (on top of 139) — the harmony audit
  A re-examination of every rule against every other, now that the line index
  is the ground truth. Four places where mechanisms fought each other:
  1) UNDO LIED AFTER A SURGERY. A surgery MUTATED the engine's part in place and
     returned the same id. Undo restored the old playback audio in the UI, but
     the id still pointed at the mutated entry — the one the final file and every
     later edit use — with the NEW audio and NEW line map. A surgery now FORKS
     the part: the copy is edited and registered under a fresh id, the original
     survives untouched while the UI's history references it. (patch_gulp now
     returns a 4-tuple; the UI adopts the new id.)
  2) THE LINE MAP DRIFTED. Offsets were rescaled linearly after a crossfade join
     — an approximation of a few ms per line that compounded over edits, the very
     disease the index was built to cure. Pieces are now faded at their edges and
     concatenated plainly, so the map is computed from the exact pieces joined.
     Verified: after twelve successive edits every line's audio still matches its
     map entry, measured on the sound itself.
  3) THE LAST FEW WORDS. «…رن چهاردهم می‌گذارد؟» is the last 3 of a 17-word
     clause; the 75 % tail check saw 82 % present and passed. Now the final two
     words of the text must appear among the final words of the transcript, or
     the take is flagged and retaken.
  4) TWO VOICE RECORDS. The 134 per-line voice map (`voices`, keyed by text)
     still existed beside the line index, each able to disagree with the other.
     The line index is now the ONE record; `voices` is cleared whenever the index
     is written.
  Also verified in the audit: a surgical piece never borrows or overwrites the
  document lead-in (136); the completeness audit never runs on surgical pieces
  (128); the gc's 15 s birth grace covers forked parts (their `born` is reset);
  Fish parts get a line index through the same cloud path as Google.

WHAT CHANGED IN 139 (on top of 138) — THE LINE INDEX
  Field: "the transcription and word placement is being mangled on every
  regeneration and it's becoming a track of its own irrespective of what's in the
  text area… edit is a deteriorating thing." Correct, and structural. Every edit
  RE-DERIVED where each line lived by aligning a transcript against the stored
  text. Each splice left the audio a little less like that text, and the next
  alignment was built on the previous error — so editing got worse the more you
  edited. The app already knew exactly where each line's audio was at the moment
  it spliced; it threw that away.
  NOW: entry["lines"] = [{text, a, b, voice}] — a per-line map of the recording,
  built once when a part is generated (using boundaries the app already
  computes) and MAINTAINED by every edit. An edit is bookkeeping on that map:
  a text diff says which lines survive (their audio is kept byte-for-byte, with
  their own voice), which are gone (dropped) and which must be made. No
  alignment on the edit path, so no drift.
  Consequences, each a field report:
   · every line carries its OWN voice, so an edit elsewhere can never repaint it;
   · a line far from the edit is never touched, even if it shares the new voice;
   · pasted text lands where it was pasted, not where an earlier edit happened;
   · «پیش‌گفتار» cannot be heard twice: if a run's internal boundaries cannot be
     found, the run is RETAKEN WITHOUT CONTEXT so no neighbour can bleed in;
   · a contextless single-line take is used whole — no cut, nothing to misplace.
  Cost and prosody are unchanged: generation still happens in runs, with context
  when the voice is the part's own.

WHAT CHANGED IN 138 (on top of 137) — from the field report
  1) THE WHOLE PART CAME BACK IN THE NEW VOICE (field tests 1, 6, and the
     one-word-per-line case). When the span to regenerate covered the whole part,
     surgery gave up and let the full path rebuild it — in ONE voice, the one
     just selected. So selecting a single line and changing its voice could
     return the entire part in that voice. Now the runs are generated separately
     even then, each in its own voice, and the audio is replaced by their join:
     the selected line gets the new voice, every other line keeps its own. Only
     when the whole part shares ONE voice does the full path run (it is
     equivalent there, and keeps the lead-in and the audit).
  2) A VOICE CHANGE SENDS ONLY THE SELECTED LINE. Neighbouring sentences were
     being generated as prosodic context and trimmed away; in a DIFFERENT voice
     they buy nothing, and they cost time, quota and a seam. Exactly as the field
     asked: "if I regen a line with another voice I don't need any parts before
     or after it". With the part's own voice the context is still sent, because
     there it does match the tone.

WHAT CHANGED IN 137 (on top of 136) — read out of the 136 field log
  1) A MISHEARD WORD IS NOT A DELETION. The log's dominant pattern: coverage of
     0.94 — near perfect — yet a line marked "gutted" and regenerated, because
     ONE transcript word had no counterpart in the text («g_cut_rejected words=1
     matched=0», «dragged_in=1 chosen=1», and once «dragged_in=6 chosen=1»).
     Persian ASR mishears constantly and every such word was read as "the user
     deleted something here". An orphan run must now be CORROBORATED by the text
     itself: at least half its words must be among the words the edit actually
     removed, and a single word is never enough on its own. Ignored runs are
     logged as g_orphan_ignored. This is the cause of most "it regenerated lines
     I did not touch" reports.
  2) A SPLICE THAT KEEPS NOTHING IS NOT SURGERY. Field: head 1.2 s, tail 17.4 s
     of a 17.4 s recording — the entire take replaced while the log called it a
     patch («kept_ms=0»). Such a splice now returns 0 so the honest full path
     runs, which keeps the part's lead-in and its completeness audit.
  3) NO MORE 400s FROM AN EMPTY REQUEST. Twice in the log Google rejected a
     request on both doors with «invalid argument»: the piece contained only a
     tag or whitespace. Such a piece now fails cleanly and burns no key.

WHAT CHANGED IN 136 (on top of 135) — the rest of the two-hour field report
  A) THE VOICE BLEED (tests 7, 8, 9, 10, 15). After every surgery the part's
     stored voice was REPLACED by the voice used for that one sentence. So once
     a sentence had been made in Zephyr, the part's base voice WAS Zephyr, and
     every line dragged in for repair afterwards inherited it — compounding with
     each edit. A surgical take no longer becomes the part's identity; only a
     full rebuild changes the base voice.
  B) AN EDIT COULD DELETE AUDIO BEFORE THE EDITED SENTENCE. The anchor had no
     validation. Every replacement span is now PROVEN first, positionally: the
     new text is aligned to the transcript, so each recorded word knows which
     LINE it belongs to; a word inside the span belonging to a line that is NOT
     being replaced is an intruder, and the span is refused (clause cuts are
     tried, then surgery gives up rather than destroy audio). Identity-based
     counting was rejected — it sees phantom intruders in repetitive prose.
  C) FAR TOO MANY LINES DRAGGED IN. "Uncovered" used a 50 % coverage bar that
     imperfect Persian ASR trips on healthy lines. Now: a line counts as having
     no audio only at ≤25 % (and at least 4 words), or when NOTHING matched.
  D) TONE CONTINUITY BETWEEN PARTS (test 3). A surgical take overwrote the
     document's continuity tail, so the NEXT part's lead-in became a fragment of
     a sentence from the middle of an edited part. A surgical piece now neither
     borrows the document lead-in nor becomes it.
  E) A FULL REBUILD LOSING ITS LAST WORDS (test: «…از قرن چهاردهم می‌گذارد؟»).
     The audit looked for a skipped CLAUSE; a take cut short at the very end
     loses only part of the last one and passed. The tail is now checked on its
     own terms (≥75 % of the last clause must be there).
  F) FISH ARTIFACTS AND BLIPPY STARTS (Fish tests 3, 10; test 6). The stub
     sweeper ran only on the local surgery path — the cloud splice never used
     it, so a clipped half-word left at a cut edge stayed in. Both edges of every
     cloud splice are swept now.
  G) FISH MARKED "INCOMPLETE" ON A FIRST GENERATION. The audit judges Fish audio
     by a GOOGLE transcript; Fish's Persian is weak enough that the transcript
     disagrees with good audio. Cross-engine transcripts are now treated as the
     weaker witness they are (abstain below 65 % coverage instead of 40 %).
  H) THE PART EDITOR UNDID YOUR LINE BREAKS (Fish editor report). It re-flowed
     the text on every render, so an Enter was erased as soon as the list
     redrew. The editor now shows the text exactly as typed.

WHAT CHANGED IN 135 (on top of 134) — from the field report
  1) YOUR LINE BREAKS ARE KEPT. When sentences were grouped into parts they were
     glued back together with a SPACE, so any line WITHOUT terminal punctuation —
     a title, a heading, a line broken on purpose — was swallowed by the next and
     could never be reached by surgery («پیش‌گفتار» + the next two lines became
     one). Parts now keep every sentence on its own line. This was upstream of
     several of the surgery complaints: the units were not what the user saw.
  2) A CUT MUST PROVE ITSELF. Deleting the LAST line removed «پیش‌گفتار» — the
     FIRST words — because a word alignment can place an orphan run anywhere when
     words repeat. A stretch is now cut only when at least 70 % of its words are
     among the words the edit actually removed; otherwise nothing is cut and the
     span is regenerated instead. Half-cuts are never made.
  3) VOICE MAP HYGIENE. A full rebuild now FORGETS every remembered line voice and
     records the one voice it just used, and stale entries for lines that no
     longer exist are pruned. Field: after rebuilding a part in Charon, a later
     surgery dragged a line in and gave it the Zephyr it remembered from before.
  4) The «ناقص» badge always carries an explanation, even when the missing
     sentence could not be quoted.

WHAT CHANGED IN 134 (on top of 133) — coverage-driven surgery, per-line voices
  ONE PRIMITIVE. The new text is aligned once against the recording's transcript
  (cached, no extra call). Every new word is then COVERED (it exists in the
  audio) or UNCOVERED; every recorded word is still wanted or ORPHANED.
  FROM THAT MAP:
   · regenerate = your selection UNION the lines holding uncovered words, and
     lines whose middle was gutted by a deletion (cutting inside a sentence
     leaves an audible seam);
   · delete = orphan runs that cover WHOLE old lines are CUT from the audio with
     ZERO api calls — delete a paragraph, select nothing, press Regenerate;
   · voice = a line YOU SELECTED gets the current voice; a line dragged in only
     for repair keeps ITS OWN remembered voice (new per-part `voices` map). The
     span is generated in runs of one voice each — two voices cannot come from
     one request — and each run is spliced at its own word-anchored edges.
  This fixes the field's worst case: delete words in sentence one, edit sentence
  two, change the voice, select sentence two → sentence two in the NEW voice,
  sentence one repaired in ITS OWN, everything else untouched.
  Breaking a sentence with Enters still regenerates nothing extra: no word
  changed, so every word stays covered.
  Graceful degradation: when lines are near-identical the alignment cannot tell
  which one was deleted, and the app regenerates instead of making a bad cut.
  Both manuals gained a surgery table with these exact scenarios.

WHAT CHANGED IN 133 (on top of 132) — every line is operable, always
  Field report: after several edits, a one-line selection rebuilt the whole part
  again; and breaking a paragraph into one-word lines worked for a few lines and
  then rebuilt everything with the new voice. Two causes in the log:
  1) `old_boundaries_unfound` five times → full rebuild. Surgery still demanded a
     clause map of the OLD recording, although since 132 the splice is anchored
     to the unchanged TEXT and does not need one. After edits the stored text and
     the recording legitimately diverge (deleted lines are still in the audio),
     the clause alignment reports `unmatched`, and a perfectly possible surgery
     was thrown away. The clause map is now a FALLBACK: surgery proceeds on the
     anchor alone, and gives up only when there is no transcript at all.
  2) THE DURATION SANITY CHECK REJECTED SHORT LINES. The expected length of a
     replacement came from the part's per-character speaking rate — meaningful
     for a sentence, worthless for a one-word line where pauses dominate. A
     one-word line measured 475 ms against an "expected" 1381 ms, failed three
     times and the part was rebuilt. The band now widens as the line shortens
     (≥60 chars: 0.45–2.2×; ≥25: 0.30–3.2×; shorter: 0.12–6×) with an absolute
     floor of 100 ms. Verified: every line of a one-word-per-line paragraph, and
     single-character lines, are individually operable.
  Also: the UI's "one sentence per line" now uses the SAME marks as the engine's
  clause splitter (129) — a colon, and an ender typed without the following
  space — so the lines you see and the units surgery can target are identical.
  ۳:۳۰ still stays on one line.

WHAT CHANGED IN 132 (on top of 131) — surgery targets what you selected
  Field report: "I edit one line and the next one is regenerated too; sometimes
  the whole text." Three causes, all confirmed against the reporter's text:
  1) THE MIDDLE WAS JOINED WITH SPACES. When an edit spanned two clauses, the
     replacement text joined them with a space; a clause not ending in a
     sentence stop merged with the next, the piece split into fewer parts than
     expected and surgery gave up — the log's `gen_clauses_2_vs_3`, three times,
     then a full rebuild. (128 fixed this for the outer join and missed the
     inner one.) Joined with a newline now. That check is DETERMINISTIC, so it
     no longer costs three takes before giving up.
  2) THE SPLICE IS NOW ANCHORED TO THE UNCHANGED TEXT, not to clause indices.
     The transcript is asked two questions: where does the text BEFORE the edit
     end in this recording, and where does the text AFTER it begin? Everything
     between is replaced. A neighbour's own words hold its audio in place, so an
     edit to one line cannot drag the next.
  3) A SELECTION IS THE AUTHORITY. It names exactly the sentences to redo and
     the diff no longer widens it. Splitting a sentence with Enter changes the
     clause list, and a clause-level diff called BOTH halves "changed" — which
     dragged the untouched half, and with `whole_part_changed` sometimes the
     entire part, into the regeneration. Now: press Enter mid-sentence, select
     the new second line, regenerate — the first half's audio is KEPT (cut at
     the word boundary from the transcript) and only the second half is made.
  A single-clause part can now be operated on too: with the splice anchored to
  text, half of one clause can be kept.

WHAT CHANGED IN 131 (on top of 130) — surgery retries instead of giving up
  A surgical take that splits wrongly, whose boundaries cannot be found, or
  whose cut produces an implausible fragment is a BAD TAKE, not a reason to
  rebuild the whole part: the model is stochastic and the next take usually
  lands. Surgery now RETRIES up to 3 times (status line says so) and only then
  falls back to a full regeneration, naming the last reason in the log
  («gave_up_after_3:…»). A recovery is logged too («recovered_on_attempt=2»).
  Structural cases — a single-clause part, no selection and no edit, everything
  changed — do not retry: there a full take IS the honest answer.
  NOTE on the engines: Google and Fish Audio share this path (one continuous
  recording, boundaries found from the transcript). Chatterbox and the Piper
  voices have their own, structurally exact surgery — their parts are stored as
  one clip PER CLAUSE, so replacing a sentence is a list operation with no
  boundary detection and nothing to fail.

WHAT CHANGED IN 130 (on top of 129) — from the 129 log
  FINDING: Fish Audio's transcribe-1 is a PAID endpoint. In the field session it
    answered «402 Insufficient API credit» nine times out of ten; a failed
    transcript silently downgraded every boundary to the crude silence
    heuristic, which is what made surgery on Fish parts unreliable and produced
    a duplicated word at a splice seam.
  · The transcription dropdown is REMOVED from the main settings and from every
    part's settings. Transcription is Google, always, for every engine — the
    transcript is the backbone of surgery, the completeness audit and captions.
  · SURGERY NOW COVERS A VOICE CHANGE. Changing the voice, reading style, age,
    mood or a Fish slider and regenerating a selection re-voices ONLY those
    clauses and keeps the rest of the audio bit-identical; the status line says
    so. Previously this sometimes spliced (two voices, artifacts) and sometimes
    silently rebuilt the whole part in the new voice, with no rule.
  · THE SEAM IS PINNED TO THE WORDS. The head ends before the first word of the
    replaced clause and the tail starts at the first word of the following
    clause, taken from the transcript — never at a silence that may sit on the
    wrong side of a word. That is the «میگه» heard twice, once in each voice. A
    word-cut that disagrees wildly with the silence cut is rejected.
  · EVERY bail-out from surgery now names itself in the log (9 paths, 9
    reasons) and the app says «جراحیِ جمله ممکن نشد؛ کل این بخش دوباره ساخته
    می‌شود» instead of rebuilding silently.
  · TONE CONTINUITY: the lead-in walks back through clauses until it holds at
    least 8 words. 129's finer clause splitting could leave a three-word
    fragment as the whole lead-in, and continuity between parts suffered.

WHAT CHANGED IN 129 (on top of 128) — clause marks
  A clause — the unit surgery can replace — now ends at ALL of these:
    · . ! ؟ … followed by whitespace, as before;
    · ! ؟ … even when the space after them was forgotten («خوندی !؟حیرت آورن»);
    · a COLON «:» and a SEMICOLON «؛ ;» — full stops in speech — EXCEPT between
      digits, so ۳:۳۰ and 3:30 stay whole;
    · a LINE BREAK, always: pressing Enter creates a clause.
  «.» still requires whitespace after it, so ۳.۵ and abbreviations are safe.
  Verified: every clause of every tested shape survives the surgical join, so a
  selection maps to that clause alone.

  NOTE on 128's line-break report: Enter DID create a clause in 127 — the split
  was right — but surgery then joined that clause to its neighbour with a SPACE,
  the colon did not end a sentence, the pieces merged back into one, the count
  check failed and the whole part was regenerated. The line break was honoured
  and then undone one step later. 128 fixed the join; 129 widens the marks.

WHAT CHANGED IN 128 (on top of 127) — SURGERY REPAIRED
  Field report: "surgery is nonexistent — selecting one sentence regenerates
  everything, and it takes forever". Three bugs, all confirmed on the owner's
  own text and in the 127 log:
  1) THE JOIN. Surgery rebuilds "previous + target + next" and checks that the
     joined text still splits into the expected number of clauses. It joined
     them with a SPACE — so a clause that does not end in a sentence stop (here
     a line ending in «:», a speech introduction) merged with its neighbour, the
     count check failed, and the app fell back to regenerating the WHOLE part.
     That is the log's `g_clause_patch reason=gen_clauses_2_vs_3`. The join is a
     NEWLINE now; _g_clauses always splits on a newline, so the pieces stay
     separate. Verified: zero bail-outs on both field texts, every clause.
  2) THE AUDIT ON SURGICAL PIECES. 127 routed surgery through the same path as a
     whole part, so every surgery ran the completeness audit — up to two extra
     takes, a repair, and several transcriptions. That is the slowness and the
     quota burn. A surgical piece now carries _no_audit: one call, no retries.
  3) CLAUSE GRANULARITY. Persian sentences end in ؟ and ! that are often typed
     without the following space («خوندی !؟حیرت آورن» is two sentences), and a
     line ending in «:» that introduces speech is its own unit. Both now end a
     clause, so a selected sentence maps to a small clause instead of half the
     part. «.» still requires whitespace, so decimals and abbreviations are safe.

WHAT CHANGED IN 127 (on top of 126) — from two field logs
  A) THE PART THAT LOST A SENTENCE (owner's log). A 565-char part had its 5th
     sentence dropped by Gemini three times; the app retried twice and then
     shipped the LAST take — the worst of the three (0 of 27 words matched,
     against 6 and 5) — with a warning that flashed once in the status line.
     Now:
       · every take is SCORED (missing clauses, then coverage) and the BEST is
         kept, never merely the last;
       · a dropped clause is REPAIRED rather than re-rolled: the clause is
         regenerated with its neighbours for prosody, cut at its boundaries and
         spliced into the gap the transcript shows (cheaper than a retake and it
         converges); verified by re-transcribing;
       · if the same clause fails twice, re-rolling stops — it is not luck;
       · a hole that survives is reported DURABLY: a red «ناقص» badge on the
         part, the sentence quoted in its tooltip, cleared only by a successful
         regeneration, plus a summary line after generation.
     Both cloud engines share this logic (_complete_take).
  B) THE 22 KEYS EATEN BY A 1,500-CHAR JOB (friend's log). 66 Google calls in
     one session: 11 of speech and 55 of TRANSCRIPTION — including transcribing
     every Fish Audio take with Google. Now:
       · transcription is cached on hash(WHOLE audio) + hash(EXACT text) +
         language + transcriber, so one edit of one diacritic, space or tag is a
         miss and a stale transcript is impossible — and the same take is never
         transcribed twice (the trimmed take's words are derived by shifting
         timestamps);
       · Fish Audio parts transcribe with FISH's own ASR by default. New
         dropdown «رونویسی صدا با» beside the Fish model selector AND in each
         part's settings, each option pinnable as default: Fish Audio / Fish
         then Google / Google. Google parts always use Google.
       · when the key rotation runs low, a DISMISSIBLE dialog explains that
         transcription spends the same quota and offers the keys manager.
     Transcription itself is never optional — correctness is not a setting.
  Also fixed: _silence_runs crashed on an empty slice (latent; any short clip).

WHAT CHANGED IN 126 (on top of 125) — activation gate
  NEW FILES to add to the repo: licensing.py (root) and ui/gate.html.
  NEW DEPENDENCY: pynacl (requirements.txt; also collected in build.spec).
  The app now requires a per-machine activation. On an unactivated machine the
    window loads ui/gate.html and NOTHING ELSE — the app's own UI is never
    loaded behind it. On success the same window swaps to index.html.
  The WORK is gated too (generate / patch / splice call _require_license), so
    removing the gate screen does not unlock generation.
  Offline and non-destructive: no network, no phone-home, nothing is ever
    deleted. A machine without a licence simply refuses to generate.
  Nothing identifying is stored: the activation carries an OPAQUE copy id
    (L-01, L-02 …), never a name; the gate greets nobody; the request code has
    no product prefix.
  Stored at ~/AvaModels/license.json — survives app updates; delete it to force
    re-activation.
  ISSUING (founder only, offline): keep app-licensing/scripts/issue_license.py
    OFF this repo, with the private key in your password manager.
      python issue_license.py issue --code "<the code the user reads you>" --id L-07
    Keep the ledger line it prints (id -> person) OFFLINE. NEVER ship the
    private key, and never put a person's name in --id.

WHAT CHANGED IN 125 (on top of 124) — manual + naming principles
  Help: a round header button (question-mark icon) between EN/FA and the theme switch
    opens the manual in a dialog sized to the frame between header and dock; Persian
    manual in Persian mode, English manual in English mode, themed with the app.
    NEW FILES ui/help_fa.html and ui/help_en.html — ADD THEM TO THE REPO (ui/ is bundled).
  Naming, applied everywhere in the app's strings: "Fish Audio" in full (never "Fish"),
    Undo/Redo instead of واگرد/ازنو, the Fish Audio key field named so in engine messages.

WHAT CHANGED IN 124 (on top of 123) — the ~10 s freeze on every click
  Cause (UI, not engine or RAM): the parts list was rebuilt with innerHTML on almost every
    interaction (14 call sites), and every part's MP3 sat INLINE in that HTML as a base64
    data: URL. With many parts that is megabytes of HTML to parse and N players to
    re-decode per click. Log for that session shows every engine call completing
    normally — the stall was in the page.
  Fix: each part's audio becomes ONE Blob URL, created when the audio changes and cached
    on the part (undo snapshots inherit it); rows reference the URL; players preload
    metadata only. A re-render is now a few KB of HTML.

WHAT CHANGED IN 123 (on top of 122) — from the 120 log
  Fish: the transcription used for boundaries and the completeness audit now takes its
    language from the TEXT (Latin → en-US, Arabic script → fa-IR); the log showed an
    English take transcribed with a Persian hint (1 word of 33), which made the audit
    "detect" a skipped sentence and force a needless retake.
  The completeness audit abstains when the transcript covers < 40 % of the expected words
    (both engines) — a failed transcription is not evidence of a failed take.
  The library search now logs its request and the reply size (fish_library diag).

WHAT CHANGED IN 122 (on top of 121)
  Fish library: the curated filter no longer swallows whole pages. Curated voices are
  listed first; the page's user uploads are returned separately — hidden behind a
  «نمایش آن‌ها» button when curated voices exist, shown (dimmed, badged «کاربران») when a
  page has none. Field: Turkish / newest and "erdogan" pages were entirely UGC and came
  back empty with a total of 1000 / 7.

WHAT CHANGED IN 121 (on top of 120) — visual
  Header band colour #65abba (both themes); the engine card and the text card have no
  band (as before) — bands on settings, music and final file.

WHAT CHANGED IN 120 (on top of 119) — from the 119 log
  BUG FIXED — a file part blocked the final file (KeyError at splice): the UI ran the undo
    snapshot (which triggers engine gc) AFTER the engine had created the file part but
    BEFORE it stored the id, so gc collected the brand-new part. Snapshot now precedes the
    creation, and the engine never collects an entry younger than 15 s.
  Diacritics: log showed every model in the list answering "high demand" (3.8-flash, and
    flash-latest which aliases it) and the 2.5 names retired. Order is now gemini-3.5-flash
    FIRST, the discovered newest second, flash-latest last; an overloaded model is retried
    once after 3 s before moving on. Medium/heavy had not "failed to apply" — no model
    answered at all.
  Parts' engine dropdown: Fish third, no make-default pins there (main selector only).
  Section headers are a band: cyan strip across the top of every card (engine, text,
    settings, music, final) with dark text and the card's top radius.

WHAT CHANGED IN 119 (on top of 118)
  Heavy diacritics prompt says harakat-gozari (the Iranian term), not tashkil.
  Fish library: a Quality filter, default CURATED — keeps voices that are licensed, from
    Fish's own account, or heavily used/liked (≥ 50 likes or ≥ 5,000 uses); 'Everything'
    shows the raw UGC. Category defaults to Professional. Results show official /
    licensed badges and use counts.

WHAT CHANGED IN 118 (on top of 117) — from the 117 log + UI batch
  Diacritics: THREE levels as tool options — Gemini light (value "gemini": the existing
    prompt, byte-for-byte untouched), Gemini medium (verbs, multi-syllable words, names),
    Gemini heavy (full harakat-gozari, almost every letter). Log showed the newest discovered
    model (gemini-3.8-flash) answering 503 "high demand"; an overloaded model now falls
    to the next one in the list instead of failing the run.
  Fish: pause chips removed (native [break]/[long-break] tags); سرنخ → تگ everywhere;
    part editors get the tags drop-up of THEIR engine (Google or Fish list + custom tag);
    library gets a Category dropdown (Fish's own library sections: professional,
    narration, audiobook, storytelling, podcast, announcer, news, education,
    advertising, entertainment, gaming, character — sent as a tag) plus a "licensed
    only" toggle; Enter searches in the library, music and design boxes; used /
    designed / own-sample entries carry a trash icon in both pickers; dialog gains the
    volume and top-p sliders.
  Sub-menus: centred on the parent using the real item count (34 px per row, capped at
    320) — short lists no longer float up as if they were 320 px tall.
  Music: independent fade-in and fade-out, 0–8 s in 0.5 s steps (0 = none).
  Section headers use the primary colour.

WHAT CHANGED IN 117 (on top of 116)
  Diacritics: Gemini Pro option removed (it burnt 22 keys' quota on one small job). The
    Gemini tool now discovers the newest plain Flash text model the key can see (one
    models-list call per session) instead of trying dead names first, and disables
    thinking (thinkingBudget 0) — that was where the time went.
  Reading styles are FORMAT only (register, pacing, articulation, phrasing); every
    emotion/age word was stripped so they no longer compete with the director lists.
    joy / sad / whisper / suspense presets removed (they exist as states). Same for the
    Fish style cues. The Google prompt now leads with the persona, then the format.
  Ages: eight ranges (toddler 2–4, child 5–9, teen, 20s, 30s–40s, 50s, 70s, 90+); the 90+
    note is forceful ("NOT young, NOT smooth… hoarse, cracked, wobbly, wheezing").
  Fish: third in the engine list (after Chatterbox). Key row styled like the others;
    model/latency hints short and aligned. Library: padded sub-card, two-row form, a
    Source dropdown (whole library / licensed by Fish — the closest thing their API has
    to "official"; there is no author filter for Fish's own account), strict language
    match (Arabic voices no longer appear for Persian), 8 per page, left/right pager with
    a centred page number (music pager too). Previously used and designed voices are
    remembered on disk and appear as groups in both the main and the dialog picker.
    Voice design is its own toggled section.
  Director labels translate to English with the rest of the UI.

WHAT CHANGED IN 116 (on top of 115) — Fish Audio, director lists, make-default
  NEW DEPENDENCY: msgpack (requirements.txt) — used for Fish's inline-reference path.
  FISH AUDIO ENGINE (second in the engine list). Everything their public API offers:
    - Models: s2.1-pro-free (DEFAULT, $0, fair use, no SLA, requests may be used for
      model improvement — hinted in the UI), s2.1-pro ($15/M UTF-8 bytes), s2-pro, s1.
      No automatic switch to paid, ever; the user picks.
    - Key: fish.audio/app/api-keys (free); stored like the other keys; «آزمایش اتصال»
      reads the wallet (credit + package).
    - Voices: the public library (search by title, tag incl. a custom tag, language,
      licensed-only, sort by popularity/usage/newest, paged 20, with sample playback),
      the user's own Fish voices (deletable), and the 63 bundled clips + own samples —
      a local clip is cloned ONCE into a private Fish voice (POST /model, Fish runs its
      own ASR for the transcript) and cached in AvaModels/fish_models.json.
    - Clone from file (permanent private voice, optional transcript/enhance).
    - Voice design (voice-design-1, paid ≈1¢/request): instruction (custom prompt),
      preview text, language, 1–4 candidates, speed, seed; candidates play inline;
      «نگه‌دار» turns one into a permanent voice and selects it.
    - Prosody: speed 0.5–2, volume dB, loudness normalisation; sampling: temperature,
      top-p; latency mode; text normalisation (off for Persian); quality-guard flag;
      condition_on_previous_chunks; the app's own lead-in continuity between parts.
    - Cues: reading style → Fish cue (custom cue allowed), age and state cues (below),
      placed at every sentence start; [مکث]/[مکث بلند] → [break]/[long-break]; the tags
      drop-up switches to Fish's cue list (emotions, tones, sounds, crowd) with a
      free-form custom cue row.
    - Dialogue: unlimited speakers ('Name: line' → <|speaker:n|>, reference list), each
      with voice, style, age, state; S1 refused for dialogue.
    - Output WAV 44.1 kHz; completeness audit, surgery, captions, music, silence/file
      parts all work on Fish parts through the shared cloud path (cloud_pcm dispatch).
    - ASR (transcribe-1, paid) wired as fish_asr() for future caption fallback.
  DIRECTOR LISTS (engine-aware): Age/persona (toddler → ancient, 11 + custom) and
    State/emotion (85 entries incl. sexy, flirty, daydreamy, cunning, plotting, envious,
    lying, caught red-handed, scared, ordering, protesting, accusing, drunk, dying,
    exhausted, explosively excited, depressed, crying… + custom). On Google they compile
    into the persona frame of the prompt; on Fish into bracket cues. Per speaker too.
  MAKE DEFAULT: a pin icon on every engine in the selector; saved to AvaModels/
    settings.json; the app opens on that engine.
  UI: sub-menus vertically centred on their parent row and clamped between header and
    dock; 280 ms hover grace so a diagonal move to the sub-menu does not close it;
    grouped pickers read "Group › item" everywhere (e.g. Charon › mysterious).

WHAT CHANGED IN 115 (on top of 114)
  Chatterbox voice selector: 50 % of its row in the main card, 70 % in the part-settings
  dialog; dropdown menus take the button's width. Sub-menus open on the natural side and
  flip only when that side truly has no room and the other side does; 240 px wide.

WHAT CHANGED IN 114 (on top of 113)
  Sub-menus (Chatterbox voices, main card and dialog): fixed geometry — 260 px wide, up to
    320 px tall (scrolling inside), positioned from the group's rect without measuring the
    panel; open away from the group and flip to the other side when there is no room
    (dialog case). Long sample names wrap; trash icons stay in view. Menus are denser.
  Part toolbar (move/duplicate/delete) says "busy" instead of silently doing nothing while
    a job runs — the unreproducible "duplicate did nothing" case (log shows no engine
    call, i.e. the click was swallowed by the busy guard).

WHAT CHANGED IN 113 (on top of 112)
  Per-part settings dialog: the two resets now cover the Google voice/style and the
    Chatterbox voice (DEFAULTS/seed carry them) and the pickers refresh their labels;
    «روی همهٔ بخش‌ها» always closes the dialog (and says so if the app is busy).
  Micro-interactions: hover brighten, pressed (translate + darken) and focus ring on every
    button, chip, header button, dropdown button, menu item and close button.
  Silence / add-file ticks are exclusive (ticking one clears the other) and, while the app
    is busy, revert with a message instead of silently diverging from state.
  Tags drop-up aligns to the selector's inner edge (left in RTL, right in LTR), clamped.
  Grouped menus (Chatterbox voices, in the main card and in the dialog) no longer scroll or
    pan; sub-menus are fixed-positioned beside their group, never clipped.
  Light mode: settings/regenerate indicator colour uses the primary, not the pale accent.

WHAT CHANGED IN 112 (on top of 111)
  BUG FIXED — "corrupted" parts after add-file / silence: 108 added a second <audio> (the
    file row) ABOVE the main player, and regeneration wrote its result into "the first
    audio in the row" — the hidden one. Log confirmed the engine was generating fine. All
    three write sites now target the visible player. The generated audio of a part is also
    stashed when it becomes a silence/file and restored when the tick is removed.
  Dropdowns and drop-ups are positioned fixed from their button (never clipped by the
    manuscript's or a dialog's overflow); the tags menu aligns to the button's inner edge.
  Gemini languages: German, Turkish, French, Spanish (prompt notes + transcription codes).
  Voice on the right / reading style on the left in Persian; mirrored in English.
  Two-speaker mode: a reading style per speaker, carried into the prompt.
  Music: fade default 1.5 s; «تنظیمات اولیهٔ آمیختن» resets level/fade/duck.
  Dock: undo always before redo; the keys icon moves to the far side by language.
  Part volume: reset button beside the slider; the popover closes on outside click.
  Per-part settings: Chatterbox voice selector added; menus inside dialogs unclipped.
  Light mode: nested surfaces tinted consistently; indicator/link colours use --tile.

WHAT CHANGED IN 111 (on top of 110) — visual
  Light theme: page #e7ecf3 under white panels, firmer lines (#c5cdd9), deeper shadow —
    sections stand out. Primary (cyan) buttons use dark text in both themes. Dialog titles
    are padded on both sides so the close button never overlaps them in either direction.
  Dock: the keys icon sits to the LEFT of undo/redo in English and to the right in Persian.

WHAT CHANGED IN 110 (on top of 109)
  Palette: new tokens from the owner's mock-ups. Dark: surface #0d111a, panel #161c29,
    primary #40d2e6, accent (generate) #ebab36, success #7dff95 / warning #ffbc5e /
    danger #ff8080 / info #87d1ff. Light: surface #f8fafc, panel #fff, primary #0d0d0d,
    accent #7de9ff, success #41d949 / warning #ffac38 / danger #ff6161 / info #61c2ff.
    A standalone palette-preview.html (the real UI on a stub API) ships for sign-off.
  Font: Vazirmatn (Regular/Medium/Bold woff2, OFL) bundled in ui/fonts — ADD THE FOLDER
    TO THE REPO (build.spec already bundles ui/).
  One dropdown component for every <select>: chevron-down from the icon set, optgroups as
    hover sub-menus with a direction-aware chevron (left in RTL, right in LTR), per-option
    trash icons (Chatterbox user samples, music library entries), opens upward near the
    bottom. Same height/radius everywhere, including the per-part voice selector.
  Music library is a dropdown again, one trash icon per saved track.
  Header: EN/FA toggle styled exactly like the theme button, 12 px apart.
  Dialogs: sized between the (measured) header and dock; close button at the inline end,
    titles padded so they never collide.
  Google settings: keys button first; voice beside reading style on one row; default
    style = casual podcast. API-key rows use the trash icon. Dock gets an icon-only keys
    button beside undo/redo.
  Music: level slider up to +6 dB (above the voice); duck release shortened (0.45 s, gate
    0.6) so the bed audibly swells back inside ordinary sentence gaps; a mix_duck diag line
    reports ducked/swell percentages.
  Chrome blocking the GitHub zip: not caused by app code (109 changed only UI markup);
    it is Chrome Safe Browsing's reputation check on a brand-new unsigned macOS binary —
    see chat for the workaround; only Apple code-signing removes it.

WHAT CHANGED IN 109 (on top of 108)
  Music library is a list: every saved track is a row with its own «استفاده» and its own
  trash icon (one track at a time, never everything). Chatterbox user samples already had
  per-sample trash icons in the picker.

WHAT CHANGED IN 108 (on top of 107) — from the 107 field log + UI batch
  BUG FIXED — Lyria error after clearing parts: new_document() had dropped the music bed
    while the UI still showed the Freesound track; the final step then fell through to
    generate with Lyria. Now the bed survives clearing; the final step reloads the
    library track the UI shows as chosen and never generates unless provider == lyria.
  Cancellations are no longer logged as tracebacks. The completeness audit is confirmed
    working in the log (two skipped-clause takes regenerated, third complete).
  Language: a compact EN/FA toggle next to the theme button. Header height is measured
    into the page padding so nothing sits under it.
  Add-file parts: «افزودن فایل» tick beside «سکوت»; a button opens the file dialog
    (wav/mp3/ogg/flac/m4a/aac); the file becomes the part (decoded mono, own rate; the
    splice resamples). Duplicable, movable, undoable; captions skip it.
  Per-part volume: a speaker icon between Duplicate and Delete opens a floating slider,
    0–200 %, 100 = as generated, shown with its dB (20·log10). Applied at assembly time;
    the stored audio is never altered; the preview re-renders.
  Trash icons: on the user's own Chatterbox samples inside the picker sub-menu (built-ins
    protected); the library trash next to «موسیقی‌های قبلی» stays.
  Layout: music is its own card («موسیقی پس‌زمینه») between the parts and the final
    card; the final file is its own card. Sliders capped at 380 px, more vertical air,
    sub-card headings ruled.

WHAT CHANGED IN 107 (on top of 106)
  Built-in Chatterbox voice library: 63 reference clips (Charon, Laomedeia, Leda,
    Sadaltager, Schedar, Zephyr × up to 15 styles) in voices/ with voices.json — mono
    24 kHz WAV, leading silence trimmed, first 12 s of speech, ~36 MB. ADD THE WHOLE
    voices/ FOLDER TO THE REPO (build.spec bundles it). Chatterbox conditions on a clip
    the first time it is used and caches it.
  Voice picker: a menu of voices; hovering (or clicking) a voice opens its styles as a
    sub-menu; the user's own samples sit under one group. The hidden <select id=cbxVoice>
    still carries the value, so nothing else changed.
  English: a language selector in the header (فارسی / English). English switches the
    whole chrome to LTR and translates every UI string, status and error (engine messages
    are translated at the app boundary: en_strings.py — ADD THIS FILE TO THE REPO). The
    text areas stay RTL always. App name in English: Avaye Javid Shah. Choice remembered.

WHAT CHANGED IN 106 (on top of 105) — visual only
  Contrast: crisper lines, deeper ink, stronger card shadows; dark theme panels stand off
    the page. More vertical air: card padding 24, grid gaps 18, part rows spaced.
  Selection is yellow (#ffd54f) everywhere, including text areas.
  Silence part: header toggle aligned with the icon buttons (32 px, matching radius);
    the silence row has its own padding, the label sits above the slider, slider full
    width with the theme accent.

WHAT CHANGED IN 105 (on top of 104)
  REVERTED the app-made pauses of 104 at the owner's request: Google pause tags are the
  model's own again. [مکث] → [short pause], [مکث بلند] → [long pause] on 3.1 (punctuation
  on 2.5, which reads tags aloud). Only a pause tag at the very END of a part is dropped
  (a trailing tag was read aloud; the splice adds the breath). For guaranteed silence of
  any length, use a silence part («سکوت» tick in the part header, 1–50 s slider).
  Kept from 104: completeness audit (skipped-sentence takes regenerated), runaway retry,
  silence parts, the two-row dock.

WHAT CHANGED IN 104 (on top of 103) — from the 103 field log
  Pauses are made by the app, not asked of Google. Pause tags ([short pause] 0.6 s,
    [long pause] 1.5 s, [مکث] 0.5 s, [مکث بلند] 1.2 s) are stripped from the text sent;
    the tag marks a clause boundary, the word timestamps locate that boundary in the
    recording, and real silence is inserted there — topped up over whatever natural gap
    already exists so the total equals the target. A tag at the start or end of a part
    becomes silence at the start or end. Works identically on 2.5 and 3.1.
  Completeness audit: the transcript taken for boundaries is also checked clause by
    clause; a take that skipped a sentence (FIELD: 32 s for a 56 s text, clause
    unmatched) is regenerated (up to 2 retries), then accepted with a warning.
  Runaway takes are retried by the rotation instead of surfacing at once; the guard is
    4x the estimate + 30 s (real takes measure 0.8–1.0x).
  Silence parts: «سکوت» toggle in each part header turns the part into pure silence with
    a 1–50 s slider; duplicable, movable, undoable; captions skip it; the music bed reacts
    (ducking follows the voice, so it swells in silence).
  Dock: buttons row (generate / final / cancel at the right, undo / redo at the left) with
    the status line on its own padded row underneath.

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
  - footer reads «نسخهٔ ۱۵۰»; the engine selector is the first card, Google selected
  - «کلیدهای گوگل» opens the key dialog; after adding a key, a Google part generates
  - Chatterbox shows the «صدای چترباکس» row with «＋ افزودن نمونه»
