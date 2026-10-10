// =====================================================================================
// 182 · FILES INTO THE APP (the founder's items 30–32 and 45)
//   · DROP ANYWHERE on the window. Audio mode: audio files on a NEW Layer, one after another from the playhead (name
//     order — 2 before 10), each at its full length; pictures and videos are refused with the reason (they belong to the
//     video mode). Video mode: pictures (5 s) and videos (full length) on one NEW layer, audio files on another NEW
//     layer, both from the playhead. Nothing that is already there moves; the whole drop is one undo step.
//   · LIMITS on every way in (drop, the timeline's add buttons, the slideshow, the music import, the voice samples, a
//     speaker's photo): video ≤ 1 GB · 60 min · 4K; audio ≤ 250 MB · 60 min; pictures ≤ 50 MB · 50 MP; ≤ 50 files at a
//     time; never past the project's 60 minutes; only what this window can play (MP4/MOV H.264, WebM, HEVC on a Mac;
//     WAV MP3 M4A FLAC OGG; JPEG PNG WebP GIF, HEIC on a Mac). Every refusal is listed with its reason in a red message
//     (the export message's look) — never silent.
//   · VIDEO MODE AUDIO: an audio file is an object on a regular layer (there is no audio-only track) with Volume, fades,
//     ducking (off) and Loop — the audio mode's audio clip.
//   · THE SLIDESHOW takes videos: a video slide runs at its full length (even past the composition's end) and has a
//     volume; the pictures share the time that is left.
// =====================================================================================
const FLIM = { vidMB: 1024, vidS: 3600, vidPx: 4096 * 2304, vidSide: 4096, audMB: 250, audS: 3600, picMB: 50, picPx: 50e6, files: 50, picS: 5 };
const IMAGE_ACCEPT = 'image/*,.heic,.heif', VIDEO_ACCEPT = 'video/*,.mov,.mp4,.m4v,.webm,.mkv', AUDIO_ACCEPT = 'audio/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.oga,.opus,.aif,.aiff';
const fileExt = f => { const n = String((f && f.name) || '').toLowerCase(), i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1) : ''; };
function fileKind(f){ const e = fileExt(f), t = String((f && f.type) || '').toLowerCase();
  if (/^(wav|wave|mp3|m4a|aac|flac|ogg|oga|opus|aif|aiff|caf)$/.test(e)) return 'audio';
  if (/^(mp4|m4v|mov|qt|webm|mkv|avi|3gp|ogv)$/.test(e)) return 'video';
  if (/^(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/.test(e)) return 'image';
  return /^audio\//.test(t) ? 'audio' : /^video\//.test(t) ? 'video' : /^image\//.test(t) ? 'image' : null; }
function mimeFor(f){ if (f && f.type) return f.type;
  return ({ mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', ogv: 'video/ogg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp',
    wav: 'audio/wav', wave: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', aif: 'audio/aiff', aiff: 'audio/aiff' })[fileExt(f)] || 'application/octet-stream'; }
const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' });   // 2 before 10
const mbOf = f => Math.max(1, Math.round((f.size || 0) / (1 << 20)));
const minsOf = s => Math.max(1, Math.round(s / 60));
const errWhy = e => String((e && e.message) || e || '').trim() || T('افزوده نشد.', 'It was not added.');
const capWhy = () => T('پروژه از 60 دقیقه بلندتر می‌شد — بیشترین طولِ یک پروژه 60 دقیقه است.', 'It would take the project past 60 minutes — the most a project can be.');
const VFMT = () => T('این ویدیو اینجا پخش نمی‌شود — MP4 یا MOV با H.264، یا WebM بدهید (HEVC فقط روی مک).', "This video can't be played here — use MP4 or MOV with H.264, or WebM (HEVC on a Mac only).");
const PFMT = () => T('این تصویر اینجا نشان داده نمی‌شود — JPEG، PNG، WebP یا GIF بدهید (HEIC فقط روی مک).', "This picture can't be shown here — use JPEG, PNG, WebP or GIF (HEIC on a Mac only).");
const AFMT = () => T('این فایلِ صوتی خوانده نمی‌شود — WAV، MP3، M4A، FLAC یا OGG بدهید.', "This audio file can't be read — use WAV, MP3, M4A, FLAC or OGG.");
const WANT_PIC = () => T('اینجا یک تصویر لازم است.', 'A picture is needed here.'), WANT_VID = () => T('اینجا یک ویدیو لازم است.', 'A video is needed here.');

// ---- what a file is, read from the file itself (nothing is uploaded yet)
function probeMedia(f, kind){ return new Promise(done => { let url = null, el = null, fin = false, to = 0;
  const end = info => { if (fin) return; fin = true; clearTimeout(to);
    try { if (el){ el.onload = el.onerror = el.onloadedmetadata = el.ondurationchange = null; if (el.tagName !== 'IMG'){ el.removeAttribute('src'); el.load(); } } } catch (e) {}
    if (url) URL.revokeObjectURL(url); done(info); };
  try { url = URL.createObjectURL(f); } catch (e) { done(null); return; }
  to = setTimeout(() => end(null), 20000);
  if (kind === 'image'){ el = new Image(); el.decoding = 'async'; el.onload = () => end({ w: el.naturalWidth, h: el.naturalHeight }); el.onerror = () => end(null); el.src = url; return; }
  el = document.createElement(kind === 'audio' ? 'audio' : 'video'); el.preload = 'metadata'; el.muted = true; if (kind === 'video') el.playsInline = true;
  const got = () => end({ dur: el.duration, w: el.videoWidth || 0, h: el.videoHeight || 0 });
  el.onloadedmetadata = () => { if (isFinite(el.duration) && el.duration > 0) return got();
    el.ondurationchange = () => { if (isFinite(el.duration) && el.duration > 0) got(); }; try { el.currentTime = 1e101; } catch (e) {} setTimeout(got, 4000); };   // a WebM without its length in the header: a far seek tells it
  el.onerror = () => end(null); el.src = url; }); }
// one file against the limits → { f, kind, info } or { why }
async function vetFile(f, allow){
  let kind = fileKind(f), p = null;
  if (!kind) return { why: T('این نوع فایل افزودنی نیست — فقط تصویر، ویدیو و صدا.', "This kind of file can't be added — only pictures, videos and audio.") };
  const maybeSound = kind === 'video' && /^(webm|mkv|ogv)$/.test(fileExt(f));   // a WebM may hold only a sound — looked at below
  if (allow && !allow.kinds.includes(kind) && !(maybeSound && allow.kinds.includes('audio'))) return { why: allow.why(kind) };
  if (kind === 'video'){
    if (f.size > FLIM.vidMB * (1 << 20)) return { why: T(`${mbOf(f)} مگابایت است؛ یک ویدیو حداکثر 1 گیگابایت می‌تواند باشد.`, `${mbOf(f)} MB; a video can be at most 1 GB.`) };
    p = await probeMedia(f, 'video');
    if (p && !p.w && !p.h && p.dur > 0) kind = 'audio';   // only a sound inside (an audio-only WebM)
  }
  if (allow && !allow.kinds.includes(kind)) return { why: allow.why(kind) };
  if (kind === 'video'){
    if (!p) return { why: VFMT() };
    if (!isFinite(p.dur) || !(p.dur > 0)) return { why: T('طولِ این ویدیو خوانده نمی‌شود.', "This video's length can't be read.") };
    if (p.dur > FLIM.vidS + 0.5) return { why: T(`${minsOf(p.dur)} دقیقه است؛ یک ویدیو حداکثر 60 دقیقه می‌تواند باشد.`, `${minsOf(p.dur)} minutes long; a video can be at most 60 minutes.`) };
    if (Math.max(p.w, p.h) > FLIM.vidSide || p.w * p.h > FLIM.vidPx) return { why: T(`${p.w}×${p.h} است؛ یک ویدیو حداکثر 4K می‌تواند باشد.`, `${p.w}×${p.h}; a video can be at most 4K.`) };
    return { f, kind, info: p }; }
  if (kind === 'image'){
    if (f.size > FLIM.picMB * (1 << 20)) return { why: T(`${mbOf(f)} مگابایت است؛ یک تصویر حداکثر 50 مگابایت می‌تواند باشد.`, `${mbOf(f)} MB; a picture can be at most 50 MB.`) };
    p = await probeMedia(f, 'image');
    if (!p || !p.w || !p.h) return { why: PFMT() };
    if (p.w * p.h > FLIM.picPx) return { why: T(`${Math.round(p.w * p.h / 1e6)} مگاپیکسل است؛ یک تصویر حداکثر 50 مگاپیکسل می‌تواند باشد.`, `${Math.round(p.w * p.h / 1e6)} megapixels; a picture can be at most 50 megapixels.`) };
    return { f, kind, info: p }; }
  if (f.size > FLIM.audMB * (1 << 20)) return { why: T(`${mbOf(f)} مگابایت است؛ یک فایلِ صوتی حداکثر 250 مگابایت می‌تواند باشد.`, `${mbOf(f)} MB; an audio file can be at most 250 MB.`) };
  if (!p) p = await probeMedia(f, 'audio');   // what this window cannot play, the engine may still read (it says so if not)
  if (p && isFinite(p.dur) && p.dur > FLIM.audS + 0.5) return { why: T(`${minsOf(p.dur)} دقیقه است؛ یک فایلِ صوتی حداکثر 60 دقیقه می‌تواند باشد.`, `${minsOf(p.dur)} minutes long; an audio file can be at most 60 minutes.`) };
  return { f, kind, info: { dur: p && isFinite(p.dur) && p.dur > 0 ? p.dur : null } }; }
// several files (name order; 50 at a time) → { ok, bad }
async function vetFiles(list, allow){ const files = [...(list || [])].sort(byName), ok = [], bad = [];
  for (const f of files.slice(0, FLIM.files)){ const r = await vetFile(f, allow); if (r.why) bad.push({ name: f.name || '?', why: r.why }); else ok.push(r); }
  if (files.length > FLIM.files) bad.push({ name: T(`${files.length - FLIM.files} فایلِ دیگر`, `${files.length - FLIM.files} more files`), why: T('هر بار حداکثر 50 فایل افزوده می‌شود.', 'At most 50 files can be added at a time.') });
  return { ok, bad }; }

// ---- the refusal message: the export message's look, in the error colour, every file with its reason (✕, Esc or a few seconds)
let REFUSE_T = 0, REFUSE_N = 0;
function refuseToast(list, title, quiet){ list = (list || []).filter(Boolean); if (!list.length) return;
  let t = $('refuseToast'); if (!t){ t = document.createElement('div'); t.id = 'refuseToast'; t.setAttribute('role', 'alert'); }
  const pop = typeof t.showPopover === 'function', host = pop ? document.body : (document.querySelector('dialog[open]') || document.body);   // above an open window (the top layer)
  if (t.parentElement !== host) host.appendChild(t); if (pop) t.setAttribute('popover', 'manual');
  const gen = ++REFUSE_N; t._gen = gen;
  t.className = 'rounded-box bg-error text-error-content shadow-2xl transition-opacity duration-300';
  Object.assign(t.style, { position: 'fixed', inset: 'auto', left: '50%', top: '33%', transform: 'translate(-50%, -20%)', margin: '0', border: '0', padding: '1rem 1.5rem', width: 'min(32rem, calc(100vw - 2rem))', maxHeight: '70vh', overflow: 'hidden', zIndex: '2000', opacity: '1' });
  const more = list.length - 12, rows = list.slice(0, 12).map(x => `<li class="min-w-0"><div class="truncate text-sm font-semibold" dir="auto">${escapeHtml(x.name || '')}</div><div class="text-xs leading-relaxed opacity-90">${escapeHtml(enDigits(x.why || ''))}</div></li>`).join('')
    + (more > 0 ? `<li class="text-xs opacity-90">${T(`و ${more} فایلِ دیگر`, `and ${more} more`)}</li>` : '');
  t.innerHTML = `<div class="flex items-start gap-3" dir="${lang === 'fa' ? 'rtl' : 'ltr'}"><svg class="size-7 shrink-0"><use href="#i-circle-x"/></svg><div class="min-w-0 flex-1"><div class="text-base font-bold">${escapeHtml(title || (list.length === 1 ? T('این فایل افزوده نشد', "This file wasn't added") : T('این فایل‌ها افزوده نشدند', "These files weren't added")))}</div><ul class="mt-2 max-h-[45vh] space-y-2 overflow-auto">${rows}</ul></div><button type="button" class="btn btn-ghost btn-sm btn-circle -me-2 -mt-1 shrink-0 text-error-content" data-x aria-label="${T('بستن', 'Close')}"><svg class="size-4"><use href="#i-x"/></svg></button></div>`;
  if (pop){ try { if (t.matches(':popover-open')) t.hidePopover(); } catch (e) {} try { t.showPopover(); } catch (e) {} }
  const close = () => { clearTimeout(REFUSE_T); t.style.opacity = '0'; t._close = null; setTimeout(() => { if (t._gen !== gen) return; try { if (pop && t.matches(':popover-open')) t.hidePopover(); } catch (e) {} t.remove(); }, 300); };
  t._close = close; t.querySelector('[data-x]').onclick = close;
  const arm = () => { clearTimeout(REFUSE_T); REFUSE_T = setTimeout(close, Math.max(7000, 2500 * Math.min(list.length, 12))); };
  t.onmouseenter = () => clearTimeout(REFUSE_T); t.onmouseleave = arm; arm();
  if (!quiet) say(list.length === 1 ? `${list[0].name}: ${list[0].why}` : T(`${list.length} فایل افزوده نشد.`, `${list.length} files were not added.`), 'err'); }
// (Esc closes it: the first key listener, in editor.js)

// ---- a file into the app's store, in pieces (read and encoded by the browser itself — the window never stalls)
function readB64(blob){ return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { const s = String(r.result || ''), i = s.indexOf(','); res(i >= 0 ? s.slice(i + 1) : ''); }; r.onerror = () => rej(r.error || new Error('read')); r.readAsDataURL(blob); }); }
let IMPORTING = false, IMPORT_STOP = false;
async function uploadAsset(f, prog){ const CH = 2 << 20, b = await API().asset_begin(f.name || 'file', mimeFor(f), f.size || 0);
  if (!b || !b.ok || !b.id) throw new Error((b && b.error) || T('فایل افزوده نشد.', 'The file was not added.'));
  const id = b.id;
  try { for (let off = 0; off < (f.size || 0); off += CH){ if (IMPORT_STOP) throw new Error(T('لغو شد.', 'Canceled.'));
      const r = await API().asset_chunk(id, await readB64(f.slice(off, off + CH))); if (!r || !r.ok) throw new Error((r && r.error) || T('فایل افزوده نشد.', 'The file was not added.'));
      if (prog) prog(Math.min(1, (off + CH) / f.size)); } }
  catch (e) { try { await API().asset_end(id); if (API().asset_drop) await API().asset_drop(id); } catch (e2) {} throw e; }
  await API().asset_end(id); return id; }
addAsset = async function(file, prog){ const id = await uploadAsset(file, prog); MEDIA.set(id, { url: URL.createObjectURL(file), mime: mimeFor(file), name: file.name }); return id; };   // 182: in pieces (a 1 GB video was read whole into memory)
function dropAsset(id){ if (!id) return; try { MEDIA.delete(id); VSND.delete(id); if (API().asset_drop) API().asset_drop(id); } catch (e) {} }
function progFor(k, n, name){ return p => { const pr = $('prog'); if (pr) pr.value = Math.round(((k + Math.min(1, p)) / Math.max(1, n)) * 100); say(T(`«${name}» افزوده می‌شود… ${Math.round(p * 100)}%`, `Adding “${name}”… ${Math.round(p * 100)}%`), 'ok'); }; }
{ const _cj182 = cancelJob; cancelJob = async function(){ if (IMPORTING) IMPORT_STOP = true; return _cj182.apply(this, arguments); }; }

// ---- an audio file → a part the engine holds (the audio mode); what the engine cannot read, the window decodes and hands over as WAV
async function browserWav(f){ try { const buf = await ac().decodeAudioData(await f.arrayBuffer()), n = buf.length, sr = buf.sampleRate, ch = buf.numberOfChannels, C = []; for (let c = 0; c < ch; c++) C.push(buf.getChannelData(c));
    const dv = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++){ let s = 0; for (let c = 0; c < ch; c++) s += C[c][i]; s /= ch; dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(s * 32767))), true); }
    return new File([dv.buffer], String(f.name || 'audio').replace(/\.[^.]+$/, '') + '.wav', { type: 'audio/wav' }); } catch (e) { return null; } }
async function audioPart(f, prog){
  let id = await uploadAsset(f, prog), r = await bigResult(await API().asset_gulp(id, f.name));
  if (r && !r.ok && r.fmt){ const wav = await browserWav(f); if (wav){ id = await uploadAsset(wav); r = await bigResult(await API().asset_gulp(id, f.name)); } }
  if (!r || !r.ok) throw new Error((r && r.error) || AFMT());
  await storeAudio(r.gulp, r.b64); return { gulp: r.gulp, name: r.name || f.name, seconds: +r.seconds || 0 }; }
// ---- an audio file → an asset the video mode plays (what the window cannot decode, the engine turns into MP3)
async function vAudioAsset(f, prog){
  let id = await addAsset(f, prog), ab = await videoSound(id);
  if (!ab){ VSND.delete(id); MEDIA.delete(id); const r = await API().asset_to_mp3(id, f.name); if (!r || !r.ok) throw new Error((r && r.error) || AFMT()); id = r.id; ab = await videoSound(id); if (!ab){ dropAsset(id); throw new Error(AFMT()); } }
  if (ab.duration > FLIM.audS + 0.5){ dropAsset(id); throw new Error(T(`${minsOf(ab.duration)} دقیقه است؛ یک فایلِ صوتی حداکثر 60 دقیقه می‌تواند باشد.`, `${minsOf(ab.duration)} minutes long; an audio file can be at most 60 minutes.`)); }
  return { id, dur: ab.duration }; }

// =====================================================================================
// THE IMPORT — every file checked first, then read in (with progress; Cancel stops it), then everything placed at once
// =====================================================================================
async function importFiles(list, how){ how = how || {};
  if (IMPORTING){ refuseToast([...(list || [])].map(f => ({ name: f.name, why: T('هنوز فایل‌های قبلی افزوده می‌شوند — کمی صبر کنید.', 'The previous files are still being added — wait a moment.') }))); return; }
  const video = typeof mode !== 'undefined' && mode === 'video', t0 = how.at ?? playhead, bad = [], made = { vis: [], aud: [] }, ups = [];
  const allow = video ? null : { kinds: ['audio'], why: () => T('تصویر و ویدیو در حالتِ ویدیو افزوده می‌شوند؛ حالتِ صدا فقط فایلِ صوتی می‌گیرد.', 'Pictures and videos go into the video mode; the audio mode takes audio files only.') };
  IMPORTING = true; IMPORT_STOP = false; setBusy(true); const pr = $('prog'); if (pr) pr.value = 0;
  try {
    say(T('فایل‌ها بررسی می‌شوند…', 'Checking the files…'), 'ok'); const { ok, bad: b0 } = await vetFiles(list, allow); bad.push(...b0);
    let tv = t0, ta = t0;
    for (const [k, x] of ok.entries()){ if (IMPORT_STOP) break; const f = x.f, prog = progFor(k, ok.length, f.name);
      try {
        if (x.kind === 'audio'){
          if (x.info.dur && ta + x.info.dur > CAP_S + 0.01){ bad.push({ name: f.name, why: capWhy() }); continue; }
          if (video){ const a = await vAudioAsset(f, prog); ups.push(a.id); if (ta + a.dur > CAP_S + 0.01){ dropAsset(a.id); bad.push({ name: f.name, why: capWhy() }); continue; }
            made.aud.push({ id: a.id, name: f.name, start: ta, dur: a.dur }); ta += a.dur; }
          else { const p = await audioPart(f, prog); if (ta + p.seconds > CAP_S + 0.01){ bad.push({ name: f.name, why: capWhy() }); continue; }
            made.aud.push({ ...p, start: ta }); ta += p.seconds; } }
        else {   // a picture or a video (only the video mode gets here)
          const d = x.kind === 'video' ? x.info.dur : FLIM.picS; if (tv + d > CAP_S + 0.01){ bad.push({ name: f.name, why: capWhy() }); continue; }
          const id = await addAsset(f, prog); ups.push(id); await mediaEl(id); made.vis.push({ kind: x.kind, id, name: f.name, start: tv, dur: d, w: x.info.w, h: x.info.h }); tv += d; } }
      catch (e) { if (IMPORT_STOP) break; bad.push({ name: f.name, why: errWhy(e) }); } }
    if (IMPORT_STOP){ ups.forEach(dropAsset); say(T('لغو شد.', 'Canceled.'), 'ok'); return; }
    const n = made.vis.length + made.aud.length;
    if (n){ placeImported(made, how); say(T(`${n} فایل افزوده شد.`, n === 1 ? '1 file added.' : `${n} files added.`), 'success'); } else if (!bad.length) say('', 'ok');
  } catch (e) { bad.push({ name: T('فایل‌ها', 'Files'), why: errWhy(e) }); }
  finally { IMPORTING = false; IMPORT_STOP = false; setBusy(false); }
  const added = made.vis.length + made.aud.length;
  if (bad.length && added && !IMPORT_STOP){ refuseToast(bad, null, true); say(T(`${added} فایل افزوده شد؛ ${bad.length} فایل افزوده نشد.`, `${added} added; ${bad.length} not added.`), 'warn'); }
  else if (bad.length) refuseToast(bad); }
const vAudioObj = (asset, name, start, dur) => ({ id: 'o' + (++uid), type: 'audio', asset, name: name || '', x: 0, y: 0, w: 0, h: 0, rot: 0, opacity: 1, start, end: start + dur, trimIn: 0, gain: 1, fadeIn: 0, fadeOut: 0, duck: 0, loop: false, nat: dur, lock: false, anim: {} });
function placeImported(made, how){ remember();
  if (typeof mode === 'undefined' || mode !== 'video'){   // the audio mode: a new Layer (the + menu: that Layer when the spot is free, else a new one right below it)
    const t0 = how.ti != null ? S.tracks[how.ti] : null, clips = made.aud.map(p => audioClip(p.gulp, p.name, p.seconds, p.start));
    const tr = t0 && t0.kind !== 'speech' && clips.every(c => trackFree(t0, c)) ? t0 : newTrack(how.ti != null ? how.ti + 1 : null, 'track');
    tr.clips.push(...clips); tr.clips.sort((a, b) => a.at - b.at); cleanupTracks();   // the empty spare Layer goes once a Layer holds something (as everywhere)
    sel = new Set(); selClip = clips[0].id; renderScript(); if (typeof showClipPanel === 'function') showClipPanel(clips[0]); autosave(); return; }
  ensureLayers(); const mk = () => ({ id: 'L' + (++uid), kind: 'obj', name: 'لایه', en: 'Layer', items: [] });
  const vis = made.vis.map(m => { const o = { id: 'o' + (++uid), ...MEDIA0(m.kind, m.id, m.w, m.h), start: m.start, end: m.start + m.dur }; if (m.kind === 'video'){ o.mute = false; o.loop = false; } return o; });   // a video comes with its sound
  const aud = made.aud.map(m => vAudioObj(m.id, m.name, m.start, m.dur));
  const fits = (L, list) => !!L && L.kind === 'obj' && list.every(o => !L.items.some(id => { const x = objById(id); return x && overlap(x, o); }));
  const place = (list, prefer) => { if (!list.length) return; let L = fits(prefer, list) ? prefer : null;
    if (!L){ L = mk(); const i = prefer ? V.layers.indexOf(prefer) : 0; V.layers.splice(Math.max(0, i), 0, L); } V.objects.push(...list); list.forEach(o => L.items.push(o.id)); };
  place(aud, how.layer || null); place(vis, null);   // new layers on top: the pictures and videos above the sounds
  ensureLayers(); const first = vis[0] || aud[0]; selectV(first.id); vChanged(); }

// ---- the whole window takes files
(function wireFileDrop(){ let depth = 0, ov = null, hideT = 0;
  const hasFiles = e => { const t = e.dataTransfer && e.dataTransfer.types; return !!t && [...t].includes('Files'); };
  const show = on => { clearTimeout(hideT);
    if (!on){ if (ov){ ov.remove(); ov = null; } depth = 0; return; }
    if (ov) return; const video = typeof mode !== 'undefined' && mode === 'video';
    ov = document.createElement('div'); ov.id = 'dropOv'; ov.className = 'pointer-events-none fixed inset-0 z-[1900] grid place-items-center bg-base-100/60 p-6';
    ov.innerHTML = `<div class="flex max-w-md flex-col items-center gap-2 rounded-box border-2 border-dashed border-primary bg-base-100 px-8 py-6 text-center shadow-xl" dir="${lang === 'fa' ? 'rtl' : 'ltr'}"><svg class="size-8 text-primary"><use href="#i-file-up"/></svg><div class="text-base font-bold">${T('فایل‌ها را رها کنید', 'Drop the files')}</div><div class="text-xs leading-relaxed text-base-content/70">${video ? T('تصویر و ویدیو روی یک لایهٔ تازه، صدا روی لایه‌ای تازهٔ دیگر — از جای پلی‌هد، پشتِ سرِ هم.', 'Pictures and videos on a new layer, audio on another new layer — from the playhead, one after another.') : T('فایل‌های صوتی روی یک لایهٔ تازه — از جای پلی‌هد، پشتِ سرِ هم.', 'Audio files on a new Layer — from the playhead, one after another.')}</div></div>`;
    document.body.appendChild(ov); };
  addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(true); });
  addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; show(true); clearTimeout(hideT); hideT = setTimeout(() => show(false), 400); });   // never a navigation to the file
  addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
  addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); show(false); const files = [...((e.dataTransfer && e.dataTransfer.files) || [])]; if (!files.length) return;
    if (document.querySelector('dialog[open]')) return refuseToast(files.map(f => ({ name: f.name, why: T('اول پنجرهٔ باز را ببندید، بعد فایل را رها کنید.', 'Close the open window first, then drop the file.') })));
    importFiles(files, { via: 'drop' }); });
})();

// =====================================================================================
// EVERY OTHER WAY IN — the same checks, the same red message
// =====================================================================================
// the audio mode's + menu → «Audio file…»: at the playhead on that Layer (or a new one right below it), one after another
{ const _aft182 = addFromTrack; addFromTrack = function(ti, k){ if (k !== 'file') return _aft182.apply(this, arguments); pickFiles(AUDIO_ACCEPT, true).then(files => { if (files.length) importFiles(files, { via: 'menu', ti }); }); }; }
// the video mode's + menu on a regular layer → «Audio file…»: on that layer when the spot is free, else a new layer right above it
{ const _vAdd182 = vAdd; vAdd = function(kind, layer){ if (kind !== 'afile') return _vAdd182.apply(this, arguments); pickFiles(AUDIO_ACCEPT, true).then(files => { if (files.length) importFiles(files, { via: 'menu', layer: layer && layer.kind === 'obj' ? layer : null }); }); }; }
// a picture or video on top, its replacement, a full-frame one, the podcast's own background picture/video
// (each picker returns at once, as before — the file window is answered later)
pickVMedia = function(kind, replace, full){ pickVMedia182(kind, replace, full); };
async function pickVMedia182(kind, replace, full){
  const bg = String(kind).startsWith('bg-'), want = String(kind).includes('video') ? 'video' : String(kind).includes('image') ? 'image' : null;
  const files = await pickFiles(want === 'video' ? VIDEO_ACCEPT : want === 'image' ? IMAGE_ACCEPT : IMAGE_ACCEPT + ',' + VIDEO_ACCEPT, false); if (!files.length) return;
  const { ok, bad } = await vetFiles(files, { kinds: want ? [want] : ['image', 'video'], why: () => (want === 'video' ? WANT_VID() : WANT_PIC()) }); if (!ok.length) return refuseToast(bad);
  const x = ok[0], tk = x.kind;
  if (!bg && !replace && (full ? playhead : 0) + (tk === 'video' ? x.info.dur : 0) > CAP_S + 0.01) return refuseToast([{ name: x.f.name, why: capWhy() }]);
  setBusy(true);
  try { const id = await addAsset(x.f, progFor(0, 1, x.f.name)); await mediaEl(id); remember();
    if (bg){ V.pod.bgAsset = id; V.pod.bg = kind.slice(3); }
    else if (replace && objById(vSel)){ objById(vSel).asset = id; }
    else if (full){ const o = { id: 'o' + (++uid), ...MEDIA0(tk, id), full: true, x: 0, y: 0, w: 1, h: 1, radius: 0, shadow: { on: false, color: '#000000', opacity: 0, angle: 90, distance: 0, blur: 0, spread: 0 }, start: playhead, end: null }; V.objects.push(o); ensureLayers(); selectV(o.id); }
    else { const o = { id: 'o' + (++uid), ...MEDIA0(tk, id, x.info.w, x.info.h) }; V.objects.push(o); vSel = o.id; }
    say('', 'ok'); fillVInsp(); vChanged(); }
  catch (e) { refuseToast([{ name: x.f.name, why: errWhy(e) }]); } finally { setBusy(false); } }
// a background clip (picture or video) after the last one
pickBgMedia = function(kind){ pickBgMedia182(kind); };
async function pickBgMedia182(kind){ const files = await pickFiles(kind === 'video' ? VIDEO_ACCEPT : IMAGE_ACCEPT, false); if (!files.length) return;
  const { ok, bad } = await vetFiles(files, { kinds: [kind], why: () => (kind === 'video' ? WANT_VID() : WANT_PIC()) }); if (!ok.length) return refuseToast(bad);
  const x = ok[0], len = kind === 'video' ? x.info.dur : 5; if (bgEnd() + len > CAP_S + 0.01) return refuseToast([{ name: x.f.name, why: capWhy() }]);
  setBusy(true);
  try { const id = await addAsset(x.f, progFor(0, 1, x.f.name)); await mediaEl(id); remember(); const s = bgEnd();
    const o = { id: 'o' + (++uid), ...MEDIA0(kind, id, x.info.w, x.info.h), bgl: true, x: 0, y: 0, w: 1, h: 1, fit: 'cover', panX: 0.5, panY: 0.5, radius: 0, mute: false, volume: 1, loop: false, start: s, end: s + len, shadow: { on: false }, stroke: { on: false } };
    V.objects.push(o); ensureLayers(); selectV(o.id); vChanged(); say('', 'ok'); }
  catch (e) { refuseToast([{ name: x.f.name, why: errWhy(e) }]); } finally { setBusy(false); } }
// a speaker's photo
pickSpkPhoto = function(i){ pickSpkPhoto182(i); };
async function pickSpkPhoto182(i){ const files = await pickFiles(IMAGE_ACCEPT, false); if (!files.length) return;
  const { ok, bad } = await vetFiles(files, { kinds: ['image'], why: () => T('عکسِ گوینده باید یک تصویر باشد.', "A speaker's photo must be a picture.") }); if (!ok.length) return refuseToast(bad);
  const f = ok[0].f, url = URL.createObjectURL(f), im = new Image();
  im.onload = () => { const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), s = Math.max(N / im.width, N / im.height); g.drawImage(im, (N - im.width * s) / 2, (N - im.height * s) / 2, im.width * s, im.height * s); URL.revokeObjectURL(url); setSpkPhoto(i, c.toDataURL('image/jpeg', 0.86)); };
  im.onerror = () => { URL.revokeObjectURL(url); refuseToast([{ name: f.name, why: PFMT() }]); }; im.src = url; }
// the music library's own import (the user says it is music)
importMusic = async function(){ const files = await pickFiles(AUDIO_ACCEPT, false); if (!files.length) return;
  const { ok, bad } = await vetFiles(files, { kinds: ['audio'], why: () => T('موسیقی از یک فایلِ صوتی می‌آید.', 'Music comes from an audio file.') }); if (!ok.length) return refuseToast(bad);
  const f = ok[0].f; setBusy(true);
  try { let id = await uploadAsset(f, progFor(0, 1, f.name)), r = await bigResult(await API().music_import_asset(id, f.name));
    if (r && !r.ok && r.fmt){ const wav = await browserWav(f); if (wav){ id = await uploadAsset(wav); r = await bigResult(await API().music_import_asset(id, f.name)); } }
    if (!r || !r.ok) return refuseToast([{ name: f.name, why: (r && r.error) || AFMT() }]);
    const e = r.entry || {}; say('', 'ok'); await setMusicTrack(r.b64, e.file, e.title || e.name || e.file); $('musicDlg').close(); }
  catch (err) { refuseToast([{ name: f.name, why: errWhy(err) }]); } finally { setBusy(false); } };
// the voice samples (the engine's own file dialogs check the limits): a refusal is said in the red message — the Google
// reference/consent pick said nothing at all; a new Chatterbox sample is chosen by its id (its whole entry was set before)
addCbxVoice = async function(){ const r = await API().cbx_voice_add(); if (!r || !r.ok){ if (r && r.error && r.error !== 'cancelled') refuseToast([{ name: T('نمونهٔ صدا', 'Voice sample'), why: r.error }]); return; }
  await loadEngineLists(); const v = r.voice, nv = v && typeof v === 'object' ? v.id : (v || r.name || r.id); if (nv){ setEng('cbxVoice', nv); makeSampleNow('chatterbox', nv); } fillInspector(); };
pickClone = async function(kind){ const r = await API().g38_pick_audio({ kind }); if (!r || !r.ok){ if (r && r.error && r.error !== 'cancelled') refuseToast([{ name: kind === 'ref' ? T('نمونهٔ صدا', 'Voice sample') : T('ضبطِ رضایت', 'Consent recording'), why: r.error }]); return; }
  clPick[kind] = r; $(kind === 'ref' ? 'clRef' : 'clCon').textContent = (r.name || '') + (r.seconds ? ` — ${secs(r.seconds, 0)}` : ''); };

// =====================================================================================
// VIDEO MODE · AN AUDIO FILE ON A REGULAR LAYER — its panel, its trimming (with the Loop rules), playback and export
// =====================================================================================
function vAudNat(o){ const b = o && VSND.get(o.asset); return b ? b.duration : ((o && o.nat) || null); }
function vAudioTrim0(o){ const nat = vAudNat(o); if (!nat) return null; const tin = o.trimIn || 0, len = (o.end == null ? projEnd() : o.end) - (o.start || 0); return { nat, loop: !!o.loop, full: tin + len >= nat - 1e-3 }; }
// trimming out stops at the end of its sound; from there (already at full length) it turns Loop on and goes on; a looping
// clip trimmed shorter than its sound has Loop off (the audio mode's rules)
function vAudioTrimEnd(o, st){ if (!st) return; const tin = o.trimIn || 0, out = tin + (o.end - (o.start || 0)), nat = st.nat;
  if (st.loop || st.full) o.loop = out > nat + 1e-3 ? true : out < nat - 1e-3 ? false : st.loop;
  else { if (out > nat) o.end = (o.start || 0) + nat - tin; o.loop = false; } }
const vaRange = (o, k, label, unit, min, max, step, def, scale) => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${label}</legend><input type="range" data-unit="${unit}" min="${min}" max="${max}" step="${step}" data-def="${def}" value="${Math.round((o[k] ?? def / scale) * scale * 100) / 100}" class="${RNG}" oninput="vAudSet('${k}', +this.value / ${scale})"></fieldset>`;
function fillVAudio(o){ const box = $('iv-sfx'); if (!box) return; const nat = vAudNat(o);
  box.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4 text-primary"><use href="#i-audio-lines"/></svg><span class="text-sm font-bold">${T('کلیپِ صدا', 'Audio clip')}</span></div>
    <div class="flex items-center gap-2 rounded-box border border-base-300 p-2"><svg class="size-4 shrink-0 opacity-60"><use href="#i-file-audio"/></svg><div class="min-w-0 flex-1"><div class="truncate text-sm font-semibold" dir="auto">${escapeHtml(o.name || '')}</div><div class="truncate text-xs text-base-content/60">${nat ? secs(nat) : ''}</div></div></div>
    ${vaRange(o, 'gain', T('بلندی', 'Volume'), '%', 0, 200, 5, 100, 100)}${vaRange(o, 'fadeIn', T('محو شدنِ اول', 'Fade in'), 's', 0, 5, 0.5, 0, 1)}${vaRange(o, 'fadeOut', T('محو شدنِ آخر', 'Fade out'), 's', 0, 5, 0.5, 0, 1)}${vaRange(o, 'duck', T('پایین‌رفتنِ زیرِ صدا', 'Duck under the voice'), 'dB', 0, 24, 1, 0, 1)}
    <p class="text-xs text-base-content/60">${T('0 دسی‌بل یعنی بدونِ پایین‌رفتن.', '0 dB = no ducking.')}</p>
    <label class="flex w-full cursor-pointer items-center justify-between gap-3 text-sm"><span class="font-semibold">${T('تکرار', 'Loop')}</span><input type="checkbox" class="toggle toggle-sm toggle-primary" ${o.loop ? 'checked' : ''} onchange="vAudLoop(this.checked)"></label>`;
  try { if (typeof rangeLabels === 'function') rangeLabels(box); if (typeof vResets === 'function') vResets(box); } catch (e) {} }
function vAudSet(k, v){ const o = objById(vSel); if (!o || o.type !== 'audio') return; o[k] = v; vTouch(); restartIfPlaying(); }   // the panel took the step (histMark)
function vAudLoop(on){ const o = objById(vSel); if (!o || o.type !== 'audio') return; remember(); o.loop = !!on;
  if (!on){ const nat = vAudNat(o), tin = o.trimIn || 0; if (nat && (o.end - (o.start || 0)) > nat - tin) o.end = (o.start || 0) + Math.max(0.2, nat - tin); }   // Loop off: a longer clip is its sound's length again, at once
  renderTimeline(); vChanged(); restartIfPlaying(); }
// the speech the ducking listens to (the audio mode's margins: from 0.15 s before a line to 0.6 s after it)
function speechSpans(){ const out = []; S.tracks.forEach(t => { if (t.muted) return; t.clips.forEach(c => { if (!isTTS(c) || c.unvoiced) return; out.push([c.at, c.at + dur(c)]); }); }); return out; }
function scheduleVAudio(){ if (typeof mode === 'undefined' || mode !== 'video') return; const ctx = ac(), base = playT0 - playFrom, speech = speechSpans(), inSpeech = tt => speech.some(([a, b]) => tt >= a - 0.15 && tt < b + 0.6);
  V.objects.forEach(o => { if (o.type !== 'audio' || layerOf(o.id).hidden) return; const buf = VSND.get(o.asset); if (!buf){ if (!VSND.has(o.asset)) videoSound(o.asset); return; }
    const D = buf.duration, st = o.start || 0, en = o.end == null ? projEnd() : o.end, s0 = Math.max(st, playFrom); if (en <= s0 + 0.02) return;
    const off = (o.trimIn || 0) + (s0 - st); if (!o.loop && off >= D) return;
    const g = ctx.createGain(), src = ctx.createBufferSource(); src.buffer = buf; if (o.loop){ src.loop = true; src.loopStart = 0; src.loopEnd = D; } src.connect(g); g.connect(ctx.destination);
    const at = tt => base + tt, cg = o.gain ?? 1, duck = +(o.duck || 0), duckF = Math.pow(10, -duck / 20), fi = +(o.fadeIn || 0), fo = +(o.fadeOut || 0);
    const level = tt => { let l = cg * (duck > 0 && inSpeech(tt) ? duckF : 1); if (fi > 0 && tt - st < fi) l *= Math.max(0, (tt - st) / fi); if (fo > 0 && en - tt < fo) l *= Math.max(0, (en - tt) / fo); return l; };
    const P = g.gain; P.setValueAtTime(level(s0), Math.max(ctx.currentTime, at(s0))); if (duck > 0 || fi > 0 || fo > 0) for (let tt = s0; tt <= en; tt += 0.1) P.linearRampToValueAtTime(level(tt), Math.max(ctx.currentTime, at(tt)));
    src.start(Math.max(ctx.currentTime, at(s0)), o.loop ? off % D : off); src.stop(at(en) + 0.02); nodes.push(src); }); }
{ const _sch182 = schedule; schedule = function(){ const r = _sch182.apply(this, arguments); try { scheduleVAudio(); } catch (e) { console.warn('video audio', e); } return r; }; }
{ const _sp182 = startPlay; startPlay = async function(){ if (typeof mode !== 'undefined' && mode === 'video'){ const ids = [...new Set(V.objects.filter(o => o.type === 'audio').map(o => o.asset))].filter(id => !VSND.has(id));
    if (ids.length){ say(T('صدا آماده می‌شود…', 'Preparing the audio…'), 'ok'); await Promise.all(ids.map(id => videoSound(id))); say('', 'ok'); } } return _sp182.apply(this, arguments); }; }
// the export: each audio file at its place — trim, Loop, Volume, fades and ducking under the speech (smoothed over 0.1 s, as the engine does)
function talkMask(sr, N){ const blocks = Math.ceil(N / sr * 100) + 2, m = new Float32Array(blocks), out = new Float32Array(blocks);
  speechSpans().forEach(([a, b]) => { for (let i = Math.max(0, Math.floor((a - 0.15) * 100)); i < Math.min(blocks, Math.ceil((b + 0.6) * 100)); i++) m[i] = 1; });
  let acc = 0; for (let i = 0; i < blocks; i++){ acc += m[i]; if (i >= 10) acc -= m[i - 10]; out[i] = acc / Math.min(10, i + 1); } return out; }
async function mixVAudio(L, R, sr){ const objs = V.objects.filter(o => o.type === 'audio' && !layerOf(o.id).hidden); if (!objs.length) return;
  const talk = objs.some(o => +(o.duck || 0) > 0) ? talkMask(sr, L.length) : null;
  for (const o of objs){ const ab = await videoSound(o.asset); if (!ab) continue;
    const a = ab.getChannelData(0), b = ab.numberOfChannels > 1 ? ab.getChannelData(1) : a, n = a.length, rate = ab.sampleRate / sr, st = o.start || 0, en = o.end == null ? projEnd() : o.end, len = en - st;
    const s0 = Math.max(0, Math.round(st * sr)), e0 = Math.min(L.length, Math.round(en * sr)), g = o.gain ?? 1, fi = +(o.fadeIn || 0), fo = +(o.fadeOut || 0), duckF = Math.pow(10, -(+(o.duck || 0)) / 20), off = (o.trimIn || 0) * ab.sampleRate;
    for (let i = s0; i < e0; i++){ let k = Math.floor(off + (i - s0) * rate); if (k >= n){ if (!o.loop) break; k %= n; }
      const tt = (i - s0) / sr; let lv = g; if (fi > 0 && tt < fi) lv *= tt / fi; if (fo > 0 && len - tt < fo) lv *= Math.max(0, (len - tt) / fo); if (talk && duckF < 1) lv *= 1 - (talk[Math.floor(i / sr * 100)] || 0) * (1 - duckF);
      L[i] += a[k] * lv; R[i] += b[k] * lv; } } }
{ const _mvs182 = mixVideoSounds; mixVideoSounds = async function(L, R, sr){ await _mvs182.apply(this, arguments); await mixVAudio(L, R, sr); }; }

// =====================================================================================
// THE SLIDESHOW TAKES VIDEOS — a video slide runs at its full length (past the composition's end is fine) and has a
// volume (no Loop); the pictures share the time that is left; a boundary roll never stretches a video past its end
// =====================================================================================
const isVidSlide = o => !!o && o.type === 'video';
function vidSlideMax(o){ const m = MEDIA.get(o.asset), el = m && m.el, d = el && isFinite(el.duration) && el.duration > 0 ? el.duration : null; return d ? d - (o.trimIn || 0) : Infinity; }
addSlideshow = async function(into){ const files = await pickFiles(IMAGE_ACCEPT + ',' + VIDEO_ACCEPT, true); if (!files.length) return;
  const { ok, bad } = await vetFiles(files, { kinds: ['image', 'video'], why: () => T('اسلایدشو فقط تصویر و ویدیو می‌گیرد.', 'A slideshow takes pictures and videos only.') });
  if (!ok.length) return refuseToast(bad);
  const old = into ? null : bgClips(); let [start, free] = into ? [0, 0] : bgFreeSpan(), how = 'fit';
  if (!into && free < slideMin()){   // the background track is already full (a new project's podcast style spans everything)
    const pod = old.some(o => o.type === 'pod');
    const k = await askChoice(T('پس‌زمینه پر است', 'The background is full'), T('همهٔ زمانِ ترکیب را کلیپ‌های پس‌زمینه پر کرده‌اند. اسلایدشو کجا برود؟', 'Background clips already fill the whole composition. Where should the slideshow go?'),
      [{ k: 'no', label: T('لغو', 'Cancel') }, { k: 'after', label: T('بعد از آن‌ها', 'After them') }, { k: 'replace', label: T('جایگزینِ پس‌زمینه', 'Replace the background') }, ...(pod ? [{ k: 'replace-keep', label: T('جایگزین، با گوینده‌ها روی تصویر', 'Replace, but keep the speakers on screen'), primary: true }] : [])]);
    if (!k || k === 'no'){ if (bad.length) refuseToast(bad); return; } how = k; }
  // the project's 60 minutes: a video counts its length, a picture at least the shortest slide
  let t = into ? Math.max(0, ...slidesOf(into).map(o => o.end || 0)) : how.startsWith('replace') ? 0 : how === 'after' ? bgEnd() : start; const take = [];
  ok.forEach(x => { const d = x.kind === 'video' ? x.info.dur : slideMin(); if (t + d > CAP_S + 0.01) bad.push({ name: x.f.name, why: capWhy() }); else { take.push(x); t += d; } });
  if (!take.length) return refuseToast(bad);
  IMPORTING = true; IMPORT_STOP = false; setBusy(true); const made = [];
  try { for (const [k, x] of take.entries()){ if (IMPORT_STOP) break;
      try { const aid = await addAsset(x.f, progFor(k, take.length, x.f.name)); await mediaEl(aid); const vid = x.kind === 'video';
        made.push({ id: 'o' + (++uid), ...MEDIA0(x.kind, aid, x.info.w, x.info.h), bgl: true, show: null, x: 0, y: 0, w: 1, h: 1, fit: 'cover', panX: 0.5, panY: 0.5, radius: 0, mute: false, volume: 1, loop: false, trimIn: 0, shadow: { on: false }, stroke: { on: false }, start: 0, end: vid ? x.info.dur : 4 }); }
      catch (e) { if (IMPORT_STOP) break; bad.push({ name: x.f.name, why: errWhy(e) }); } }
    if (IMPORT_STOP){ made.forEach(o => dropAsset(o.asset)); say(T('لغو شد.', 'Canceled.'), 'ok'); return; }
    if (!made.length) return;
    remember(); const id = into || ('ss' + (++uid)); made.forEach(o => { o.show = id; });
    if (how.startsWith('replace')){ V.objects = V.objects.filter(o => !o.bgl); start = 0; if (how === 'replace-keep' && !V.objects.some(o => o.tpl)) V.objects.push({ id: 'o' + (++uid), type: 'pod', tpl: true, x: 0.06, y: 0.26, w: 0.88, h: 0.52, rot: 0, opacity: 1, start: 0, end: null }); }
    if (how === 'after') start = bgEnd();
    const vt = made.filter(isVidSlide).reduce((a, o) => a + (o.end - o.start), 0), pics = made.filter(o => !isVidSlide(o)).length;
    if (into){ const L = slidesOf(id); let tt = L.length ? Math.max(...L.map(o => o.end || 0)) : 0; made.forEach(o => { const d = o.end - o.start; o.start = tt; o.end = tt + d; tt += d; }); V.objects.push(...made); ensureLayers(); distributeSlides(id); }
    else { const span = how === 'after' ? null : how.startsWith('replace') ? projEnd() : free, per = pics ? (span == null ? 4 : Math.max(slideMin(), (span - vt) / pics)) : 0; let tt = start;
      made.forEach(o => { const d = isVidSlide(o) ? o.end - o.start : per; o.start = tt; o.end = tt + d; tt += d; }); V.objects.push(...made); ensureLayers(); layoutSlides(id, start); }
    selectV(made[0].id); vChanged(); say(T(`اسلایدشو: ${slidesOf(id).length} اسلاید`, `Slideshow: ${slidesOf(id).length} slides`), 'ok'); }
  catch (err) { bad.push({ name: T('اسلایدشو', 'Slideshow'), why: errWhy(err) }); }
  finally { IMPORTING = false; IMPORT_STOP = false; setBusy(false); }
  if (bad.length) refuseToast(bad); };
// «Spread equally»: the pictures share what the videos leave (a video keeps its full length)
distributeSlides = function(id){ const L = slidesOf(id); if (!L.length) return; const s0 = L[0].start || 0;
  const after = bgClips().filter(o => o.show !== id && (o.start || 0) > s0 + 0.01).map(o => o.start || 0), end = after.length ? Math.min(...after) : projEnd();
  const vids = L.filter(isVidSlide), pics = L.length - vids.length, vt = vids.reduce((a, o) => a + Math.min(vidSlideMax(o), (o.end || 0) - (o.start || 0)), 0), per = pics ? Math.max(slideMin(), (end - s0 - vt) / pics) : 0;
  let t = s0; L.forEach(o => { const d = isVidSlide(o) ? Math.min(vidSlideMax(o), (o.end || 0) - (o.start || 0)) : per; o.start = t; o.end = t + d; t += d; }); layoutSlides(id, s0); };
// the slides one after another: a video slide at most its own length (a short video stays short — it runs at its full length)
layoutSlides = function(id, start){ let t = start; const L = slidesOf(id);
  L.forEach((o, i) => { let d = Math.max(slideMin(), (o.end ?? (o.start || 0) + 4) - (o.start || 0)); if (isVidSlide(o)) d = Math.min(d, vidSlideMax(o)); o.start = t; o.end = t + d; t += d;
    if (i < L.length - 1){ if (!o.trans) o.trans = { type: 'fade', dur: 0.8, params: {} }; } else delete o.trans; }); };
// a roll or a trim stops where a video slide's own picture ends (it never freezes on its last frame)
function slideClampVid(o, edge){ const L = slidesOf(o.show), i = L.indexOf(o), prev = L[i - 1], next = L[i + 1];
  if (edge === 'e'){ if (isVidSlide(o)){ const m = vidSlideMax(o); if (o.end - o.start > m) o.end = o.start + m; } if (next){ if (isVidSlide(next)){ const m = vidSlideMax(next); if ((next.end || 0) - o.end > m) o.end = (next.end || 0) - m; } next.start = o.end; } }
  else if (edge === 's'){ if (isVidSlide(o)){ const m = vidSlideMax(o); if (o.end - o.start > m) o.start = o.end - m; } if (prev){ if (isVidSlide(prev)){ const m = vidSlideMax(prev); if (o.start - (prev.start || 0) > m) o.start = (prev.start || 0) + m; } prev.end = o.start; } } }
{ const _se182 = slideEdit; slideEdit = function(o, edge, s0, e0, d){ const r = _se182.apply(this, arguments); if (edge) slideClampVid(o, edge); return r; }; }
// a video slide: its volume, no Loop (it runs at its full length)
{ const _fp182 = fillPip; fillPip = function(o){ const r = _fp182.apply(this, arguments); const lp = $('pipLoop'), row = lp && lp.closest('label'); if (row) row.classList.toggle('hidden', !!(o && o.show)); return r; }; }
