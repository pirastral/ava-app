// =====================================================================================
// Avaye Javid Shah — the new editor (build 154, audio mode, Google)
// Model: each LINE is a part (unit of editing); runs of consecutive lines with the same
// voice are generated together (unit of generation) and sliced into per-line clips by the
// part's own line map, returned by the engine as "lines". Script order = clip start time.
// =====================================================================================
const $ = id => document.getElementById(id);
const API = () => window.pywebview.api;
const FA = s => String(s).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
let lang = 'fa';
const T = (fa, en) => lang === 'fa' ? fa : en;
const num = s => lang === 'fa' ? FA(s) : String(s);
const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const escapeHtml = x => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');   // 160: quotes too — attributes broke on them
const PAD = 18, SNAP_PX = 8, GAP = 0.12;            // margin before 0:00; snapping; the breath between parts
let uid = Date.now() % 100000, zoom = 22, playhead = 0, playing = false, snapOn = true, editorDir = 'rtl', busy = false;

// ---------------- state ----------------
const S = {
  lines: {},                                         // id -> { text, dirty, voice: {gVoice,gPreset,gState} | null }
  tracks: [ { id: 's1', name: 'گفتار ۱', en: 'Speech 1', kind: 'speech', gapless: false, clips: [] },
            { id: 'm1', name: 'موسیقی', en: 'Music', kind: 'music', clips: [] } ],
  proj: { engine: 'google', g_model: 'gemini-3.1-flash-tts-preview', g_voice: 'Charon', g_preset: 'neutral', g_state: '', g_age: '', g_lang: 'fa', g_continuity: true, g_style: '',
          duo: { on: false, a: { name: '', voice: 'Charon' }, b: { name: '', voice: 'Kore' } },
          cbx: { voice: 'default', speed: 1, exag: 0.8, cfg: 1, temp: 0 }, light: { speed: 1, noise: 0.667, noisew: 0.8 },
          fish: { model: '', latency: 'normal', voice: 'default', preset: 'neutral', speed: 1, volume: 0, temp: 0.7, top_p: 0.7, cont: true, condPrev: true, normLoud: true, normalize: false, quality: false, custom: '', age: '', state: '', ageCustom: '', stateCustom: '', speakers: [] } },
  music: { level_db: -16, fade_in: 1.5, fade_out: 1.5, duck: true, duck_db: 12, file: null, name: null },
};
// a speech clip: { id, lines: [lineId…], gulp: id|null, in, out, at, trimIn, trimOut, unvoiced }
//   (a part without a trusted line map is ONE clip carrying several lines)
const AUD = new Map();                               // gulp id -> { b64, buf (AudioBuffer) }
const tracks = () => S.tracks;
const speechClips = () => S.tracks.filter(t => t.kind === 'speech').flatMap((t, ti) => t.clips.map(c => Object.assign(c, { _ti: ti, _track: t })));
const scriptOrder = () => speechClips().sort((a, b) => a.at - b.at || a._ti - b._ti);
const orderedLines = () => scriptOrder().flatMap(c => c.lines);
const clipOfLine = id => { for (const t of S.tracks) for (const c of t.clips) if (c.lines && c.lines.includes(id)) return [t, c]; return [null, null]; };
const dur = c => Math.max(0.05, c.out - c.in);
const total = () => Math.max(10, ...S.tracks.flatMap(t => t.clips.map(c => c.at + dur(c))));
const lineVoice = id => ({ engine: S.proj.engine, gVoice: S.proj.g_voice, gPreset: S.proj.g_preset, gState: S.proj.g_state, ...spkVoice(id), ...(S.lines[id] && S.lines[id].voice || {}) });   // 162: speaker, then the line's own
const lineEngine = id => lineVoice(id).engine;

// ---------------- status, busy, cancel ----------------
function say(msg, kind){ const s = $('status'); s.textContent = msg || ''; s.className = 'min-w-0 flex-1 truncate ' + (kind === 'err' ? 'text-error' : 'text-primary'); }
window.avaStatus = ({ msg, pct }) => { say(msg, 'ok'); const p = $('prog'); if (pct === undefined || pct === null) p.removeAttribute('value'); else p.value = pct; };
function setBusy(on){ busy = on; $('prog').classList.toggle('hidden', !on); $('cancelBtn').classList.toggle('hidden', !on); $('genBtn').disabled = on; }
async function cancelJob(){ try { await API().cancel(); } catch (e) {} say(T('لغو شد.', 'Cancelled.'), 'ok'); }
const isCancel = e => /cancel|لغو/i.test(String(e && e.message || e));

// ---------------- persistence: the document survives switching interfaces ----------------
let SESSION = null, saveTimer = null;
function snapshot(){ return JSON.parse(JSON.stringify({ lines: S.lines, tracks: S.tracks.map(t => ({ ...t, clips: t.clips.map(({ _ti, _track, ...c }) => c) })), proj: S.proj, music: S.music })); }
const MUSIC0 = { level_db: -16, fade_in: 1.5, fade_out: 1.5, duck: true, duck_db: 12, file: null, name: null, credit: '' };
function restoreSnap(sn){ S.lines = sn.lines; S.tracks = sn.tracks; const base = JSON.parse(JSON.stringify(S.proj)); S.proj = Object.assign(base, sn.proj || {}); ['cbx', 'light', 'fish', 'duo'].forEach(k => S.proj[k] = Object.assign({}, base[k], (sn.proj || {})[k] || {})); S.music = Object.assign({}, MUSIC0, sn.music || {}); }   // replace, never merge: a missing key means 'none'
function autosave(){ if (typeof VVER !== 'undefined') VVER++; clearTimeout(saveTimer); saveTimer = setTimeout(() => { /* 164: no autosaved document — projects are saved as .ava files */ }, 800); }

// ---------------- undo / redo: snapshots; parts referenced by history are kept in memory ----------------
const hist = { past: [], future: [] };
function remember(){ hist.past.push(snapshot()); if (hist.past.length > 60) hist.past.shift(); hist.future = []; }
function undo(){ if (!hist.past.length) return; hist.future.push(snapshot()); restoreSnap(hist.past.pop()); afterChange(true); }
function redo(){ if (!hist.future.length) return; hist.past.push(snapshot()); restoreSnap(hist.future.pop()); afterChange(true); }
function gcParts(){
  const keep = new Set();
  [snapshot(), ...hist.past, ...hist.future].forEach(sn => sn.tracks.forEach(t => t.clips.forEach(c => { if (c.gulp !== null && c.gulp !== undefined) keep.add(c.gulp); })));
  try { API().gc_gulps([...keep]); } catch (e) {}
}
function afterChange(noHist){ renderScript(); autosave(); }

// ---------------- the app's custom dropdown for every select (build 110: native popups can't follow theme/RTL) ----------------
function enh(sel){
  if (sel._btn) return refreshEnh(sel);
  sel.classList.add('hidden');
  const b = document.createElement('button'); b.type = 'button';
  b.className = sel.className.replace('hidden', '').replace('select ', 'select ') + ' justify-between text-start';
  b.setAttribute('dir', sel.closest('[dir]') ? sel.closest('[dir]').getAttribute('dir') : 'rtl');
  b.onclick = ev => { ev.stopPropagation(); openDD(sel, b); };
  sel.insertAdjacentElement('afterend', b); sel._btn = b;
  sel.addEventListener('change', () => refreshEnh(sel));
  refreshEnh(sel);
}
function refreshEnh(sel){ if (!sel._btn) return; const o = sel.options[sel.selectedIndex]; sel._btn.innerHTML = `<span class="truncate">${o ? escapeHtml(o.text) : ''}</span>`; }
function openDD(sel, b){
  const m = $('ddMenu'), r = b.getBoundingClientRect();
  m.dir = b.getAttribute('dir') || 'rtl';
  m.innerHTML = [...sel.options].map((o, i) => o.disabled ? `<li class="menu-title">${escapeHtml(o.text)}</li>`
    : `<li><a class="${i === sel.selectedIndex ? 'menu-active' : ''}" data-i="${i}">${escapeHtml(o.text)}</a></li>`).join('');
  m.style.minWidth = r.width + 'px'; m.classList.remove('hidden');
  const h = m.offsetHeight, below = innerHeight - r.bottom - 8;
  m.style.top = (below >= h ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px';
  m.style.left = Math.min(innerWidth - m.offsetWidth - 8, Math.max(8, r.left)) + 'px';
  m.querySelectorAll('[data-i]').forEach(a => a.onclick = () => { sel.selectedIndex = +a.dataset.i; sel.dispatchEvent(new Event('change')); m.classList.add('hidden'); });
}
addEventListener('pointerdown', ev => { if (!ev.target.closest('#ddMenu')) $('ddMenu').classList.add('hidden'); if (!ev.target.closest('#trackMenu') && !ev.target.closest('[aria-label="add"]')) $('trackMenu').classList.add('hidden'); });

// ---------------- inspector: the same lists as the classic interface ----------------
let DIRECTOR = { ages: [], states: [] };
// MODELS, EZ_TOOLS, LANGS and I18N_EN come from the classic interface at build time
const isG38 = () => /3\.8/.test(S.proj.g_model);
const tr = s => lang === 'en' ? (I18N_EN[s] || s) : s;          // the classic interface's own English table
const optList = (rows, cur) => rows.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''}>${escapeHtml(tr(l))}</option>`).join('');
function fillInspector(){
  $('pModel').innerHTML = optList(MODELS, S.proj.g_model);
  $('pVoice').innerHTML = optList(G_VOICES.map(([v, l]) => [v, `${v} — ${tr(l)}`]), S.proj.g_voice);
  $('pPreset').innerHTML = optList(G_PRESETS.map(p => [p[0], p[1]]), S.proj.g_preset);
  $('pState').innerHTML = optList(DIRECTOR.states.filter(a => a[0] !== 'custom').map(a => [a[0], a[1]]), S.proj.g_state);
  $('pAge').innerHTML = optList(DIRECTOR.ages.filter(a => a[0] !== 'custom').map(a => [a[0], a[1]]), S.proj.g_age);
  $('pLang').innerHTML = optList(LANGS, S.proj.g_lang); $('pCont').checked = !!S.proj.g_continuity;
  $('ezTool').innerHTML = optList(EZ_TOOLS, $('ezTool').value || 'gemini'); enh($('ezTool'));
  $('pEngine').innerHTML = optList([['google', 'گوگل (Gemini TTS) — آنلاین، ۳۰ صدا']], 'google');
  $('pAgeWrap').classList.toggle('hidden', isG38());               // 3.8: age is a voice trait, not an instruction
  $('pEngine').innerHTML = optList(ENGINES, S.proj.engine);
  const eng = S.proj.engine, light = ['mana', 'gyro', 'amir'].includes(eng);
  $('engGoogle').classList.toggle('hidden', eng !== 'google'); $('engCbx').classList.toggle('hidden', eng !== 'chatterbox');
  $('engLight').classList.toggle('hidden', !light); $('engFish').classList.toggle('hidden', eng !== 'fish');
  const c = S.proj.cbx, l = S.proj.light, f = S.proj.fish;
  [['cbxSpeed', c.speed], ['cbxExag', c.exag], ['cbxCfg', c.cfg], ['cbxTemp', c.temp], ['lightSpeed', l.speed], ['lightNoise', l.noise], ['lightNoiseW', l.noisew],
   ['fishSpeed', f.speed], ['fishVolume', f.volume], ['fishTemp', f.temp], ['fishTopP', f.top_p]].forEach(([id, v]) => setRange(id, v));
  [['fishCont', f.cont], ['fishCondPrev', f.condPrev], ['fishNormLoud', f.normLoud], ['fishNormalize', f.normalize], ['fishQuality', f.quality]].forEach(([id, v]) => $(id).checked = !!v);
  $('cbxVoice').innerHTML = cbxOptions(c.voice);   // 164: bundled voices grouped by voice (never deletable), your samples deletable
  $('fishModel').innerHTML = optList((DIRECTOR.fish_models || []).map(([k, lab]) => [k, lab]), f.model || ((DIRECTOR.fish_models || [])[0] || [''])[0]);
  if (!f.model && (DIRECTOR.fish_models || []).length) f.model = DIRECTOR.fish_models[0][0];
  $('fishLatency').value = f.latency;
  $('fishVoice').innerHTML = optList([['default', T('پیش‌فرض Fish Audio', 'Fish Audio default')]].concat(FISH_VOICES.map(v => [v._id || v.id, v.title || v.name || v._id || v.id])), f.voice);
  $('fishPreset').innerHTML = optList(G_PRESETS.map(p => [p[0], p[1]]), f.preset);
  ['pModel', 'pVoice', 'pPreset', 'pState', 'pAge', 'pLang', 'pEngine', 'cbxVoice', 'fishModel', 'fishLatency', 'fishVoice', 'fishPreset'].forEach(id => enh($(id)));
  buildTagMenus(); fillExtras();
}
const ENG_MAP = { cbxVoice: ['cbx', 'voice'], cbxSpeed: ['cbx', 'speed'], cbxExag: ['cbx', 'exag'], cbxCfg: ['cbx', 'cfg'], cbxTemp: ['cbx', 'temp'],
  lightSpeed: ['light', 'speed'], lightNoise: ['light', 'noise'], lightNoiseW: ['light', 'noisew'],
  fishModel: ['fish', 'model'], fishLatency: ['fish', 'latency'], fishVoice: ['fish', 'voice'], fishPreset: ['fish', 'preset'], fishSpeed: ['fish', 'speed'], fishVolume: ['fish', 'volume'],
  fishTemp: ['fish', 'temp'], fishTopP: ['fish', 'top_p'], fishCont: ['fish', 'cont'], fishCondPrev: ['fish', 'condPrev'], fishNormLoud: ['fish', 'normLoud'], fishNormalize: ['fish', 'normalize'], fishQuality: ['fish', 'quality'] };
const ENG_OF = { cbx: ['chatterbox'], light: ['mana', 'gyro', 'amir'], fish: ['fish'] };
let lastEngEdit = { id: '', t: 0 };
function markDirty(test){ let n = 0; Object.keys(S.lines).forEach(id => { const L = S.lines[id], [, c] = clipOfLine(+id); if (c && !c.unvoiced && !c.file && !L.dirty && test(+id)){ L.dirty = true; n++; } }); return n; }
function setEng(id, v){
  const [grp, key] = ENG_MAP[id]; if (S.proj[grp][key] === v) return;
  const now = Date.now(); if (lastEngEdit.id !== id || now - lastEngEdit.t > 1500) remember(); lastEngEdit = { id, t: now };   // one undo step per slider drag
  S.proj[grp][key] = v;
  if (markDirty(id2 => ENG_OF[grp].includes(lineEngine(id2)))) renderScript();
  autosave();
}
function setProj(k, v){
  remember(); const was = S.proj.engine; S.proj[k] = v;
  if (k === 'engine'){ markDirty(id => !(S.lines[id].voice && S.lines[id].voice.engine) && was !== v); fillInspector(); afterChange(); return; }
  if (['g_model', 'g_voice', 'g_preset', 'g_state', 'g_age', 'g_lang'].includes(k)){
    // every voiced line that follows the project's setting now needs re-voicing
    const key = { g_voice: 'gVoice', g_preset: 'gPreset', g_state: 'gState' }[k];
    Object.entries(S.lines).forEach(([id, L]) => { const [, c] = clipOfLine(+id); if (c && !c.unvoiced && !(key && L.voice && L.voice[key])) L.dirty = true; });
  }
  if (k === 'g_model'){ fillInspector(); try { API().settings_set({ default_g_model: v }); } catch (e) {} }
  afterChange();
}
function setLineOpt(k, v){
  if (sel.size !== 1) return; const id = [...sel][0]; remember();
  const L = S.lines[id]; L.voice = Object.assign({}, L.voice || {}); if (v) L.voice[k] = v; else delete L.voice[k];
  const [, c] = clipOfLine(id); if (c && !c.unvoiced) L.dirty = true;
  if (k === 'engine'){ fillLineInspector(id); buildTagMenus(); }
  afterChange();
}
let lastSelKey = null;
function showInsp(w, byUser){
  if (byUser && w === 'proj' && !$('insp-music').classList.contains('hidden') && selClip && String(selClip).startsWith('mu')) selClip = null;
  ['line', 'proj', 'music'].forEach(k => $('insp-' + k).classList.toggle('hidden', k !== w));
  $('it-line').classList.toggle('tab-active', w === 'line'); $('it-proj').classList.toggle('tab-active', w !== 'line');
}
function fillLineInspector(id){
  const v = (S.lines[id] && S.lines[id].voice) || {};
  const proj = T('— مثلِ پروژه —', '— as the project —');
  $('lnEngine').innerHTML = `<option value="">${proj}</option>` + optList(ENGINES, v.engine); $('lnGoogle').classList.toggle('hidden', lineEngine(id) !== 'google');
  $('lnVoice').innerHTML = voiceOptions(v.gVoice || '', true); $('lnVoice').dataset.recent = 'gvoice'; $('lnVoice')._onDel = delVoice;
  $('lnPreset').innerHTML = `<option value="">${proj}</option>` + optList(G_PRESETS.map(p => [p[0], p[1]]), v.gPreset);
  $('lnState').innerHTML = `<option value="">${proj}</option>` + optList(DIRECTOR.states.filter(a => a[0] !== 'custom').map(a => [a[0], a[1]]), v.gState);
  ['lnEngine', 'lnVoice', 'lnPreset', 'lnState'].forEach(i => enh($(i)));
}

// =====================================================================================
// SCRIPT EDITOR — rendering and selection
// =====================================================================================
let sel = new Set();
function trimSpan(text, c){
  if (!c || c.lines.length !== 1 || (!c.trimIn && !c.trimOut)) return [0, text.length];
  const D = dur(c) + (c.trimIn || 0) + (c.trimOut || 0), L = text.length;
  return [Math.round((c.trimIn || 0) / D * L), L - Math.round((c.trimOut || 0) / D * L)];
}
const TRIM_CLS = 'rounded-sm bg-error/20 text-error line-through decoration-error/70';
function trimmedHtml(text, c){
  const [a, b] = trimSpan(text, c);
  if (a === 0 && b === text.length) return escapeHtml(text);
  const tip = T('این بخش از صدا با کوتاه‌کردنِ کلیپ حذف شده', 'trimmed out of the clip');
  return (a ? `<span class="${TRIM_CLS}" title="${tip}">${escapeHtml(text.slice(0, a))}</span>` : '') + escapeHtml(text.slice(a, b)) + (b < text.length ? `<span class="${TRIM_CLS}" title="${tip}">${escapeHtml(text.slice(b))}</span>` : '');
}
function renderScript(){ Object.values(S.lines).forEach(normLine); const clips = scriptOrder(), ed = $('editor'); let html = '', n = 0, i = 0;
  while (i < clips.length){
    let j = i;                                          // consecutive clips overlapping in time share a bracket
    while (j + 1 < clips.length && clips[j + 1].at < clips[j].at + dur(clips[j]) - 0.01 && clips[j + 1]._ti !== clips[j]._ti) j++;
    const rows = clips.slice(i, j + 1).map(c => c.lines.map(id => lineRow(id, ++n, c)).join('')).join('');
    html += j > i ? `<div class="relative"><span class="pointer-events-none absolute -start-2 top-2 bottom-2 w-2.5 rounded-s-md border-y-2 border-s-2 border-accent"></span>${rows}</div>` : rows;
    i = j + 1;
  }
  ed.innerHTML = html + '<div id="pcaret" class="pointer-events-none absolute z-10 hidden w-0.5 rounded-full bg-primary shadow-[0_0_6px] shadow-primary/60"></div>';
  wireLines(); paintSel(); updatePCaret(); renderTimeline();
}
function lineRow(id, n, c){
  const L = S.lines[id]; if (!L) return '';
  const badge = (cls, icon, text, tip) => `<span class="badge ${cls} badge-xs gap-1 align-middle ${tip ? 'tooltip' : ''}" ${tip ? `data-tip="${tip}"` : ''} contenteditable="false">${icon ? `<svg class="size-2.5"><use href="#i-${icon}"/></svg>` : ''}${text}</span>`;
  const extra = (L.dirty ? badge('badge-soft badge-warning', 'pencil', T('تغییر کرده', 'edited'), T('متن یا صدای این خط عوض شده و هنوز دوباره ساخته نشده', 'changed, not re-voiced yet')) : '')
    + (c.unvoiced && (L.text || '').trim() ? badge('badge-ghost', '', T('ساخته نشده', 'not voiced')) : '')
    + (c.lines.length > 1 && c.lines[0] === id ? badge('badge-soft badge-info', 'layers', T('یک کلیپ', 'one clip'), T('این خط‌ها یک کلیپ‌اند: نقشهٔ خط برای این بخش ساخته نشد', 'these lines are one clip: no line map for this part')) : '')
    + (c.lines.length === 1 && (c.trimIn > 0.05 || c.trimOut > 0.05) ? badge('badge-error badge-soft', 'scissors', T('کوتاه شده', 'trimmed')) : '');
  return `<div class="ln group relative flex items-start gap-1.5 px-2" data-id="${id}">
    <span class="grip mt-1.5 grid size-6 shrink-0 cursor-grab place-items-center rounded text-base-content/40 opacity-0 hover:bg-base-300 group-hover:opacity-100" title="${T('بکشید تا جابه‌جا شود', 'drag to reorder')}"><svg class="size-4"><use href="#i-grip-vertical"/></svg></span>
    <span class="mt-1.5 w-6 shrink-0 text-end text-xs tabular-nums text-base-content/40">${num(n)}</span>
    <div class="min-w-0 flex-1 py-0.5"><p>${spkChip(id)}${toneChip(id)}<span class="lt outline-none" contenteditable="true" spellcheck="false" data-ph="${T('متن را این‌جا بنویسید یا بچسبانید…', 'Type or paste the text here…')}">${pills(trimmedHtml(L.text || '', c))}</span> ${extra}</p><div class="lnbar"></div></div>
  </div>`;
}
function lineBar(){
  const b = 'btn btn-xs join-item gap-1 border-base-content/15 bg-base-100';
  return `<div class="mb-1.5 mt-0.5 flex flex-wrap items-center gap-1.5" contenteditable="false"><div class="join">
    <button class="btn btn-primary btn-xs join-item gap-1" onclick="revoiceSelected()"><svg class="size-3.5"><use href="#i-refresh-cw"/></svg>${T('بازتولید', 'Re-voice')}</button>
    <button class="${b}" onclick="playLine()"><svg class="size-3.5"><use href="#i-play"/></svg>${T('شنیدن', 'Play')}</button>
    <button class="${b}" onclick="newLineAfter()"><svg class="size-3.5"><use href="#i-plus"/></svg>${T('خطِ تازه', 'New line')}</button>
    <button class="btn btn-xs join-item btn-square border-base-content/15 bg-base-100" onclick="diacritize(true)" data-tip="حرکت‌گذاریِ همین خط" data-tip-en="Diacritize this line" aria-label="diacritize"><svg class="size-3.5"><use href="#i-wand-sparkles"/></svg></button>
    <button class="btn btn-xs join-item btn-square border-base-content/15 bg-base-100" onclick="deleteLine()" aria-label="delete"><svg class="size-3.5"><use href="#i-trash-2"/></svg></button></div></div>`;
}
function paintSel(){ sel.forEach(id => { if (!S.lines[id]) sel.delete(id); });
  if (sel.size === 1) lastLine = [...sel][0];
  const selKey = [...sel].sort().join(',');
  queueMicrotask(() => { lastSelKey = selKey; });
  document.querySelectorAll('#editor .ln').forEach(ln => {
    const on = sel.has(+ln.dataset.id), one = on && sel.size === 1;
    ln.classList.toggle('bg-primary/10', on); ['outline', 'outline-1', 'outline-primary/40'].forEach(k => ln.classList.toggle(k, one));
    ln.querySelector('.lnbar').innerHTML = one ? lineBar() : '';
  });
  $('it-line').classList.toggle('hidden', sel.size !== 1);
  $('tagBtn').classList.toggle('btn-disabled', sel.size !== 1); buildTagMenus(); $('toneBtn').classList.toggle('btn-disabled', !sel.size || !isG38());
  if (sel.size === 1){
    const id = [...sel][0], L = S.lines[id], [, c] = clipOfLine(id);
    $('lineTitle').textContent = T(`خطِ ${FA(orderedLines().indexOf(id) + 1)}`, `Line ${orderedLines().indexOf(id) + 1}`);
    $('lineState').innerHTML = L.dirty ? `<span class="badge badge-soft badge-warning badge-sm gap-1"><svg class="size-3"><use href="#i-pencil"/></svg>${T('تغییر کرده', 'edited')}</span>`
      : c && c.unvoiced ? `<span class="badge badge-ghost badge-sm">${T('ساخته نشده', 'not voiced')}</span>`
      : c ? `<span class="badge badge-soft badge-success badge-sm gap-1"><svg class="size-3"><use href="#i-check"/></svg>${T('ساخته‌شده', 'voiced')}، ${num(dur(c).toFixed(1))} ${T('ثانیه', 's')}</span>` : '';
    fillLineInspector(id);
    if (selKey !== lastSelKey) showInsp('line');            // only a NEW selection moves the inspector
  } else if (!$('insp-music').classList.contains('hidden') && selClip && String(selClip).startsWith('mu')){ /* keep the music panel */ }
  else { if (selKey !== lastSelKey) showInsp('proj'); $('projTitle').textContent = sel.size > 1 ? T(`${FA(sel.size)} خط انتخاب شده`, `${sel.size} lines selected`) : T('پروژه', 'Project'); }
}
function updatePCaret(){
  const pc = $('pcaret'); if (!pc) return;
  const here = speechClips().filter(c => !c.unvoiced && c.at <= playhead && playhead < c.at + dur(c)).sort((a, b) => b.at - a.at)[0];
  if (!here){ pc.classList.add('hidden'); return; }
  // which line of the clip, and where in it (proportional; the engine holds the word timings)
  const lens = here.lines.map(id => Math.max(1, (S.lines[id].text || '').length)), tot = lens.reduce((a, b) => a + b, 0);
  const D = dur(here) + (here.trimIn || 0) + (here.trimOut || 0); let pos = (playhead - here.at + (here.trimIn || 0)) / D * tot, k = 0;
  while (k < lens.length - 1 && pos > lens[k]){ pos -= lens[k]; k++; }
  const lt = document.querySelector(`#editor .ln[data-id="${here.lines[k]}"] .lt`); if (!lt){ pc.classList.add('hidden'); return; }
  const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); let node, left = Math.round(pos);
  while ((node = w.nextNode())){ if (left <= node.length) break; left -= node.length; }
  if (!node){ pc.classList.add('hidden'); return; }
  const r = document.createRange(); r.setStart(node, Math.max(0, left)); r.setEnd(node, Math.max(0, left));
  const rect = r.getClientRects()[0] || r.getBoundingClientRect(), er = $('editor').getBoundingClientRect();
  if (!rect || !rect.height){ pc.classList.add('hidden'); return; }
  pc.classList.remove('hidden'); pc.style.left = (rect.left - er.left - 1) + 'px'; pc.style.top = (rect.top - er.top + 2) + 'px'; pc.style.height = (rect.height - 4) + 'px';
}

// =====================================================================================
// SCRIPT EDITOR — editing
// =====================================================================================
const estDur = text => Math.max(1.5, (text || '').trim().length / 12);
function shiftAfter(track, from, delta, except){ track.clips.forEach(c => { if (c !== except && c.at >= from - 0.001){ c.at = Math.max(0, c.at + delta); } }); }
function placeholderAfter(track, prev, ids){
  const at = prev ? prev.at + dur(prev) + GAP : 0, d = ids.reduce((s, id) => s + estDur(S.lines[id].text), 0);
  const c = { id: 'c' + (++uid), lines: ids, gulp: null, in: 0, out: d, at, trimIn: 0, trimOut: 0, unvoiced: true };
  shiftAfter(track, at, d + GAP, null); track.clips.push(c); track.clips.sort((a, b) => a.at - b.at); return c;
}
function resizeClip(c, newDur){ const [t] = clipOfLine(c.lines[0]); const delta = newDur - dur(c); c.out = c.in + newDur; if (Math.abs(delta) > 0.001) shiftAfter(t, c.at + 0.001, delta, c); }
let lastRange = null;
document.addEventListener('selectionchange', () => { const s = getSelection(); if (s.rangeCount && s.anchorNode && s.anchorNode.parentElement && s.anchorNode.parentElement.closest('.lt')) lastRange = s.getRangeAt(0).cloneRange(); });
function caretOffset(el){ const s = getSelection(); if (!s.rangeCount) return 0; const r = s.getRangeAt(0).cloneRange(); r.selectNodeContents(el); r.setEnd(s.getRangeAt(0).endContainer, s.getRangeAt(0).endOffset); return r.toString().length; }
function focusLine(id, atEnd){ const lt = document.querySelector(`#editor .ln[data-id="${id}"] .lt`); if (!lt) return; lt.focus(); const r = document.createRange(); r.selectNodeContents(lt); r.collapse(!atEnd); getSelection().removeAllRanges(); getSelection().addRange(r); }
function wireLines(){
  document.querySelectorAll('#editor .ln').forEach(ln => {
    const id = +ln.dataset.id, lt = ln.querySelector('.lt');
    ln.addEventListener('mousedown', ev => {
      if (ev.target.closest('.grip') || ev.target.closest('button')) return;
      if (ev.ctrlKey || ev.metaKey){ ev.preventDefault(); sel.has(id) ? sel.delete(id) : sel.add(id); paintSel(); return; }
      if (ev.shiftKey && sel.size){ ev.preventDefault(); const ids = orderedLines(), a = ids.indexOf([...sel][0]), b = ids.indexOf(id); sel = new Set(ids.slice(Math.min(a, b), Math.max(a, b) + 1)); getSelection().removeAllRanges(); paintSel(); return; }
      if (!sel.has(id) || sel.size > 1){ sel = new Set([id]); selClip = null; paintSel(); renderTimeline(); }
    });
    lt.addEventListener('focus', () => { if (!sel.has(id)){ sel = new Set([id]); paintSel(); } });
    lt.addEventListener('input', () => {
      noteTyping();
      const L = S.lines[id], [, c] = clipOfLine(id); L.text = lt.textContent;
      if (c && c.unvoiced){ resizeClip(c, c.lines.reduce((s, x) => s + estDur(S.lines[x].text), 0)); renderTimeline(); }
      else if (c && !L.dirty){ L.dirty = true; renderTimeline(); }
      autosave();
    });
    lt.addEventListener('blur', () => { const L = S.lines[id]; if (L && L.dirty && !ln.querySelector('.badge-warning')) setTimeout(() => { if (!document.activeElement || !document.activeElement.classList.contains('lt')) renderScript(); }, 0); });
    lt.addEventListener('keydown', ev => {
      if (ev.key === 'Enter'){ ev.preventDefault(); remember(); splitLine(id, caretOffset(lt)); }
      if (ev.key === 'Backspace' && caretOffset(lt) === 0 && getSelection().isCollapsed){ ev.preventDefault(); remember(); mergeUp(id); }
    });
    lt.addEventListener('paste', ev => {
      ev.preventDefault(); const text = (ev.clipboardData || window.clipboardData).getData('text/plain') || '';
      const parts = reflowSentences(text).split('\n').map(x => x.trim()).filter(Boolean);   // the classic convention: one sentence per line
      if (parts.length < 2){ document.execCommand('insertText', false, text); return; }
      remember();
      document.execCommand('insertText', false, parts.shift() || '');
      S.lines[id].text = lt.textContent; let [t, prev] = clipOfLine(id); let last = id; const made = pasteParts([S.lines[id].text, ...parts]); Object.assign(S.lines[id], { text: made[0].text, spk: made[0].spk, tone: made[0].tone }); made.slice(1).forEach(L => { const nid = ++uid; S.lines[nid] = L; const p = L.text; prev = placeholderAfter(t, prev, [nid]); last = nid; });
      if (prev && prev.unvoiced) resizeClip(clipOfLine(id)[1], estDur(S.lines[id].text));
      sel = new Set([last]); renderScript(); focusLine(last, true); autosave();
    });
    ln.querySelector('.grip').addEventListener('pointerdown', ev => startLineDrag(ev, id, ln));
  });
}
function splitLine(id, at){
  const L = S.lines[id], [t, c] = clipOfLine(id);
  if (c && !c.unvoiced && !L.dirty && c.lines.length === 1){
    // a voiced line splits where its words are: the audio is cut, nothing is regenerated
    const D = dur(c) + (c.trimIn || 0) + (c.trimOut || 0), tt = c.at - (c.trimIn || 0) + at / Math.max(1, L.text.length) * D;
    if (tt > c.at + 0.15 && tt < c.at + dur(c) - 0.15) return sliceAt(c, id, at, tt);
  }
  const before = L.text.slice(0, at).trim(), after = L.text.slice(at).trim(), nid = ++uid;
  L.text = before; if (c && !c.unvoiced) L.dirty = true;
  S.lines[nid] = { spk: L.spk, text: after, dirty: false, voice: L.voice ? { ...L.voice } : null };
  if (c && c.unvoiced) resizeClip(c, estDur(before));
  placeholderAfter(t, c, [nid]); sel = new Set([nid]); renderScript(); focusLine(nid); autosave();
}
function sliceAt0(c, id, at, tt){
  const [t] = clipOfLine(id), L = S.lines[id], nid = ++uid, cut = c.in + (tt - c.at);
  S.lines[nid] = { text: L.text.slice(at).trim(), dirty: false, voice: L.voice ? { ...L.voice } : null }; L.text = L.text.slice(0, at).trim();
  const n = { id: 'c' + (++uid), lines: [nid], gulp: c.gulp, in: cut, out: c.out, at: tt, trimIn: 0, trimOut: c.trimOut || 0, src: c.src, gi: c.gi };
  c.out = cut; c.trimOut = 0; t.clips.push(n); t.clips.sort((a, b) => a.at - b.at);
  sel = new Set([nid]); renderScript(); focusLine(nid); autosave();
}
function newLineAfter(){ const id = [...sel][0]; if (!id) return; remember(); const [t, c] = clipOfLine(id), nid = ++uid; S.lines[nid] = { text: '', dirty: false, voice: null }; placeholderAfter(t, c, [nid]); sel = new Set([nid]); renderScript(); focusLine(nid); autosave(); }
function mergeUp(id){
  const ids = orderedLines(), k = ids.indexOf(id); if (k <= 0) return;
  const pid = ids[k - 1], P = S.lines[pid], L = S.lines[id], joinAt = P.text.length;
  P.text = (P.text + ' ' + L.text).trim(); const [, pc] = clipOfLine(pid); if (pc && !pc.unvoiced) P.dirty = true;
  removeLine(id); sel = new Set([pid]); renderScript();
  const lt = document.querySelector(`#editor .ln[data-id="${pid}"] .lt`); if (lt){ lt.focus(); const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); let node, left = joinAt; while ((node = w.nextNode())){ if (left <= node.length) break; left -= node.length; } if (node){ const r = document.createRange(); r.setStart(node, left); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); } }
  autosave();
}
function removeLine(id){
  const [t, c] = clipOfLine(id); delete S.lines[id]; if (!c) return;
  c.lines = c.lines.filter(x => x !== id);
  if (!c.lines.length){ t.clips = t.clips.filter(x => x !== c); if (t.gapless) pack(t); if (t.id !== 's1' && !t.clips.length) S.tracks = S.tracks.filter(x => x !== t); }
  else if (c.unvoiced) resizeClip(c, c.lines.reduce((s, x) => s + estDur(S.lines[x].text), 0));
}
function deleteLine(){ if (!sel.size) return; remember(); [...sel].forEach(removeLine); sel = new Set(); ensureOneLine(); renderScript(); autosave(); }
function ensureOneLine(){ if (!Object.keys(S.lines).length){ const nid = ++uid; S.lines[nid] = { text: '', dirty: false, voice: null }; placeholderAfter(S.tracks[0], null, [nid]); } }
$('editorArea').addEventListener('mousedown', ev => { if (!ev.target.closest('#editor') && !ev.target.closest('button, a, input, select, textarea, label, .dropdown, .menu, [role="button"], [contenteditable]')){ sel = new Set(); selClip = null; getSelection().removeAllRanges(); paintSel(); renderTimeline(); } });
function setEditorDir(d){
  editorDir = d; $('editor').dir = d;
  $('dirRtl').className = 'btn btn-sm join-item gap-1 ' + (d === 'rtl' ? 'btn-primary' : 'border-base-content/15 bg-base-100');
  $('dirLtr').className = 'btn btn-sm join-item gap-1 ' + (d === 'ltr' ? 'btn-primary' : 'border-base-content/15 bg-base-100');
}
// drag a line by its margin handle; a line inside a multi-line clip moves with its clip
function startLineDrag(ev, id, ln){
  ev.preventDefault(); const rows = [...document.querySelectorAll('#editor .ln')], marker = document.createElement('div');
  marker.className = 'pointer-events-none absolute inset-x-2 h-0.5 rounded bg-primary'; $('editor').appendChild(marker); ln.classList.add('opacity-50');
  let target = null;
  const move = e => { const top0 = $('editor').getBoundingClientRect().top; target = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; }) || null;
    marker.style.top = ((target ? target.getBoundingClientRect().top : rows[rows.length - 1].getBoundingClientRect().bottom) - top0 - 1) + 'px'; };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); marker.remove(); ln.classList.remove('opacity-50');
    const [, mc] = clipOfLine(id), tgtClip = target ? clipOfLine(+target.dataset.id)[1] : null;
    if (tgtClip === mc) return;
    remember(); const order = scriptOrder().filter(c => c !== mc); const k = tgtClip ? order.indexOf(tgtClip) : order.length; order.splice(k < 0 ? order.length : k, 0, mc);
    applyClipOrder(order, mc); };
  addEventListener('pointermove', move); addEventListener('pointerup', up); move(ev);
}
function applyClipOrder(order, moved){
  const t0 = S.tracks[0], mt = clipOfLine(moved.lines[0])[0];
  if (mt === t0){ let x = Math.min(...t0.clips.map(c => c.at)); order.filter(c => t0.clips.includes(c)).forEach(c => { c.at = x; x += dur(c) + GAP; }); }
  else { const k = order.indexOf(moved), prev = k > 0 ? order[k - 1] : null; moved.at = prev ? prev.at + Math.min(1, dur(prev) / 2) : 0; }
  renderScript(); autosave();
}

// =====================================================================================
// SCRIPT EDITOR — tags, tone, diacritics (lists come from the classic interface)
// =====================================================================================
function buildTagMenus(){
  const m = $('tagMenu'), model = S.proj.g_model, eng = sel.size === 1 ? lineEngine([...sel][0]) : S.proj.engine;
  const item0 = t => `<li><a dir="ltr" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</a></li>`;
  if (eng === 'fish'){ m.innerHTML = (DIRECTOR.fish_tags || []).map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item0).join('')).join(''); return buildToneMenu(); }
  if (eng !== 'google'){ m.innerHTML = `<li class="menu-title whitespace-normal">${T('این موتور فقط مکث می‌گیرد', 'This engine takes pauses only')}</li>` + ['[مکث]', '[مکث بلند]'].map(item0).join(''); return buildToneMenu(); }
  const item = t => `<li><a dir="ltr" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</a></li>`;
  if (/2\.5/.test(model)) m.innerHTML = `<li class="menu-title whitespace-normal">${T('مدل‌های 2.5 برچسبِ صوتی نمی‌گیرند.', 'The 2.5 models take no sound tags.')}</li>`;
  else if (isG38()) m.innerHTML = G38_TAGS.map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item).join('')).join('')
    + `<li class="menu-title">${T('واکنشِ شنونده', 'Listener reactions')}</li>` + G38_BACK.map(item).join('');
  else m.innerHTML = G_TAGS.map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item).join('')).join('');
  buildToneMenu();
}
function buildToneMenu(){
  if (isG38() && !$('tagMenu').querySelector('[data-x="ipa"]')) $('tagMenu').insertAdjacentHTML('beforeend', `<li class="menu-title">${T('تلفظ و هم‌زمانی', 'Pronunciation & overlap')}</li><li data-x="ipa"><a onmousedown="event.preventDefault()" onclick="insertIPA()">${T('تلفظ با IPA: /…/', 'Pronounce with IPA: /…/')}</a></li><li><a onmousedown="event.preventDefault()" onclick="insertOverlap()">${T('واکنشِ هم‌زمان: |…|', 'Overlapping reaction: |…|')}</a></li>`);
  const tones = (typeof G38_TONES !== 'undefined' ? G38_TONES : DIRECTOR.states.filter(a => a[0] && a[0] !== 'custom').map(a => a[1]));
  $('toneMenu').innerHTML = isG38() ? tones.map(x => `<li><a data-tone="${escapeHtml(x)}">${escapeHtml(x)}</a></li>`).join('')
    : `<li class="menu-title whitespace-normal">${T('لحنِ خط فقط در 3.8؛ در مدل‌های دیگر از «حال و احساس»ِ همین خط استفاده کنید.', 'Line tone is for 3.8; on other models use this line\'s mood.')}</li>`;
}
let lastLine = null;
function insertTag(tag){
  const id = sel.size === 1 ? [...sel][0] : lastLine; if (!id || !S.lines[id]){ say(T('اول در یک خط کلیک کنید.', 'Click in a line first.'), 'err'); return; } const lt = document.querySelector(`#editor .ln[data-id="${id}"] .lt`); if (!lt) return;
  lt.focus(); const s = getSelection();
  if (lastRange && lt.contains(lastRange.startContainer)){ s.removeAllRanges(); s.addRange(lastRange); } else { const r = document.createRange(); r.selectNodeContents(lt); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
  document.execCommand('insertText', false, ' ' + tag + ' ');
  document.activeElement.blur && document.activeElement.blur();
}
function setTone(tone){
  const ids = sel.size ? [...sel] : (lastLine ? [lastLine] : []); if (!ids.length || !isG38()) return; remember();
  ids.forEach(id => { const L = S.lines[id]; normLine(L); L.tone = tone || ''; const [, c] = clipOfLine(id); if (c && !c.unvoiced) L.dirty = true; });   // 164: the tone is the line's own chip, always first
  renderScript(); autosave();
}
async function diacritize(){
  const ids = orderedLines(), text = ids.map(id => S.lines[id].text).join('\n');
  if (!text.trim()){ say(T('اول یک متن فارسی بنویسید یا بچسبانید.', 'Type or paste a Persian text first.'), 'err'); return; }
  if (busy) return; setBusy(true); say(T('دارم حرکت‌ها را می‌گذارم…', 'Adding diacritics…'), 'ok');
  try {
    const r = await API().ezafe(text, $('ezTool').value, '');
    if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
    const out = r.text.split('\n');
    if (out.length !== ids.length) throw new Error(T('حرکت‌گذاری تعدادِ خط‌ها را عوض کرد؛ چیزی تغییر داده نشد.', 'Diacritization changed the number of lines; nothing was changed.'));
    remember();
    ids.forEach((id, k) => { const L = S.lines[id]; if (out[k] !== L.text){ L.text = out[k]; const [, c] = clipOfLine(id); if (c && !c.unvoiced) L.dirty = true; } });
    renderScript(); autosave(); say(T('حرکت‌های پیشنهادی توی متن گذاشته شد؛ قبل از ساختن گفتار می‌توانید دستکاری‌شان کنید.', 'Suggested diacritics were added; you can adjust them before voicing.'), 'ok');
  } catch (e) { say(isCancel(e) ? T('لغو شد.', 'Cancelled.') : (e.message || String(e)), isCancel(e) ? 'ok' : 'err'); }
  finally { setBusy(false); }
}
function clearDiacritics(){
  remember(); let n = 0;
  Object.entries(S.lines).forEach(([id, L]) => { const t = L.text.replace(/[\u064B-\u0655\u0670]/g, ''); if (t !== L.text){ L.text = t; n++; const [, c] = clipOfLine(+id); if (c && !c.unvoiced) L.dirty = true; } });
  renderScript(); autosave(); say(n ? T('همهٔ حرکت‌ها از متن پاک شد.', 'All diacritics were removed.') : T('حرکتی در متن نبود.', 'There were no diacritics.'), 'ok');
}

// =====================================================================================
// TIMELINE (always left-to-right)
// =====================================================================================
let selClip = null;
const ICON = { speech: 'mic', music: 'music' };
const PEAKS = new Map();
function peaksHtml(c, w){
  const pk = `${c.gulp}|${c.in.toFixed(3)}|${c.out.toFixed(3)}|${Math.round(w / 4)}|${!!(AUD.get(c.gulp) || {}).buf}`; if (PEAKS.has(pk)) return PEAKS.get(pk);
  const html = peaksHtml0(c, w); PEAKS.set(pk, html); if (PEAKS.size > 600) PEAKS.delete(PEAKS.keys().next().value); return html;
}
function peaksHtml0(c, w){
  const a = c.gulp !== null && AUD.get(c.gulp), n = Math.max(6, Math.min(160, Math.floor(w / 4)));
  let h = '';
  if (a && a.buf){
    const d = a.buf.getChannelData(0), sr = a.buf.sampleRate, s0 = Math.floor(c.in * sr), s1 = Math.min(d.length, Math.floor(c.out * sr)), step = Math.max(1, Math.floor((s1 - s0) / n));
    for (let i = 0; i < n; i++){ let m = 0; for (let k = s0 + i * step, e = Math.min(s1, k + step); k < e; k += 8) m = Math.max(m, Math.abs(d[k])); h += `<i class="block flex-1 rounded-[1px] bg-current opacity-50" style="height:${Math.max(6, Math.min(100, m * 140))}%"></i>`; }
  } else { let s = (c.at * 97 | 0) + 7; for (let i = 0; i < n; i++){ s = (s * 9301 + 49297) % 233280; h += `<i class="block flex-1 rounded-[1px] bg-current opacity-25" style="height:${20 + Math.round(s / 233280 * 50)}%"></i>`; } }
  return `<span class="pointer-events-none absolute inset-x-1 bottom-1 top-5 flex items-center gap-px">${h}</span>`;
}
function renderTimeline(){
  const TR = S.tracks, pps = zoom, span = Math.max(total(), ((($('tlScroll').clientWidth - $('heads').offsetWidth) || 0) - PAD - 1) / pps), W = PAD + span * pps;
  $('heads').innerHTML = TR.map((t, i) => `
    <div class="flex h-14 items-center pe-2" data-ti="${i}"><div class="flex h-11 w-full items-center gap-1 rounded-box bg-base-100/50 px-2 text-xs">
      <svg class="size-3.5 shrink-0 opacity-70"><use href="#i-${ICON[t.kind]}"/></svg>
      <span class="ui flex-1 truncate font-semibold">${T(t.name, t.en)}</span>
      ${t.kind === 'speech' ? `<label class="flex cursor-pointer items-center" data-tip="${T('بدونِ فاصله', 'gapless')}"><input type="checkbox" class="checkbox checkbox-xs" ${t.gapless ? 'checked' : ''} onchange="setGapless(${i}, this.checked)"></label>` : ''}
      <button class="btn btn-ghost btn-xs btn-square ${t.muted ? 'text-error' : ''}" onclick="toggleMute(${i})" aria-label="mute"><svg class="size-3.5"><use href="#i-${t.muted ? 'volume-x' : 'volume-2'}"/></svg></button><button class="btn btn-ghost btn-xs btn-square ${(t.volume ?? 1) !== 1 ? 'text-primary' : ''}" onclick="openVolPop(event, ${i})" data-tip="${T('بلندیِ ترک', 'Track volume')}: ${Math.round((t.volume ?? 1) * 100)}٪" aria-label="volume"><svg class="size-3.5"><use href="#i-sliders-horizontal"/></svg></button>
      <button class="btn btn-ghost btn-xs btn-square" aria-label="add" onclick="openTrackMenu(event, ${i})"><svg class="size-4"><use href="#i-plus"/></svg></button>
    </div></div>`).join('');
  const step = pps < 16 ? 10 : 5, dot = step / (step === 5 ? 5 : 4); let ticks = '';
  for (let k = 0; k * dot <= span; k++){ const tt = k * dot, x = PAD + tt * pps;
    ticks += Math.abs(tt % step) < 1e-6 ? `<span class="absolute top-1 text-[11px] leading-none tabular-nums text-base-content/55" style="left:${x}px">${num(Math.floor(tt / 60))}:${num(String(Math.round(tt % 60)).padStart(2, '0'))}</span>`
      : `<span class="absolute top-[11px] size-[3px] -translate-x-1/2 rounded-full bg-base-content/30" style="left:${x}px"></span>`; }
  $('ruler').style.width = W + 'px';
  $('ruler').innerHTML = ticks + `<span id="phStem" class="pointer-events-none absolute bottom-0 top-3 w-0.5 bg-secondary" style="left:${PAD + playhead * pps}px"></span><span id="phLabel" class="absolute top-0 z-10 cursor-ew-resize rounded-sm bg-secondary px-1 text-[10px] font-bold tabular-nums text-secondary-content" style="left:${PAD + playhead * pps - 22}px">${num(fmt(playhead))}</span>`;
  const order = orderedLines(); let lanes = '';
  TR.forEach((t, ti) => {
    let clips = '';
    t.clips.forEach(c => {
      const w = Math.max(6, dur(c) * pps - 2), isSel = selClip === c.id || (c.lines && c.lines.some(id => sel.has(id)));
      const pos = c.hi ? 'top-1 bottom-[52%]' : c.lo ? 'top-[52%] bottom-1' : 'top-1.5 bottom-1.5';
      let look, label;
      if (t.kind === 'music'){ look = 'bg-secondary/15 text-secondary outline-secondary/50'; label = c.name || T('موسیقی', 'Music'); }
      else { const L = S.lines[c.lines[0]] || { text: '' }; look = c.unvoiced ? 'border border-dashed border-base-content/30 bg-transparent text-base-content/50 outline-transparent' : 'bg-primary/15 text-primary outline-primary/50';
        label = `${num(order.indexOf(c.lines[0]) + 1)}${c.lines.length > 1 ? '–' + num(order.indexOf(c.lines[c.lines.length - 1]) + 1) : ''} ${escapeHtml((c.file ? '♪ ' : '') + (L.text || '').slice(0, 28))}…`; }
      const dirty = c.lines && c.lines.some(id => S.lines[id] && S.lines[id].dirty);
      clips += `<div class="clip absolute overflow-hidden rounded-field outline outline-1 ${look} ${pos} ${isSel ? 'outline-2 outline-primary!' : ''} cursor-grab" style="left:${PAD + c.at * pps}px;width:${w}px" data-cid="${c.id}" data-ti="${ti}">
        ${c.unvoiced ? '' : peaksHtml(c, w)}
        <span class="ui pointer-events-none absolute inset-x-1.5 top-0.5 truncate text-[11px] font-semibold" dir="rtl">${label}</span>
        ${dirty ? `<span class="badge badge-warning badge-xs pointer-events-none absolute bottom-1 left-1 gap-0.5"><svg class="size-2.5"><use href="#i-pencil"/></svg></span>` : ''}
        ${(c.trimIn > 0.05 || c.trimOut > 0.05) ? `<span class="badge badge-error badge-xs pointer-events-none absolute bottom-1 ${dirty ? 'left-6' : 'left-1'}"><svg class="size-2.5"><use href="#i-scissors"/></svg></span>` : ''}
        ${selClip === c.id && w > 130 ? `<span class="pointer-events-none absolute bottom-1 right-6 rounded-md bg-black/60 px-1.5 text-[10px] font-semibold tabular-nums text-white">${num(dur(c).toFixed(1))}${T('ث', 's')}</span>` : ''}
      </div>`;
      if (selClip === c.id && ((t.kind === 'speech' && !c.unvoiced) || t.kind === 'music')){
        const xl = PAD + c.at * pps, xr = xl + w;
        const hdl = (x, edge) => `<span class="trimh absolute z-20 w-[18px] cursor-ew-resize ${pos}" style="left:${x}px" data-edge="${edge}" data-cid="${c.id}" data-ti="${ti}"><span class="pointer-events-none absolute top-1/2 h-[55%] w-[3px] -translate-y-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,.55)] ${edge === 'l' ? 'left-[10px]' : 'left-[5px]'}"></span></span>`;
        clips += hdl(xl - 5, 'l') + hdl(xr - 13, 'r');
      }
    });
    lanes += `<div class="lane relative h-14" style="width:${W}px" data-ti="${ti}">${clips}</div>`;
  });
  lanes += `<div id="ph" class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-secondary" style="left:${PAD + playhead * pps}px"></div>`;
  $('lanes').innerHTML = lanes; $('lanes').style.width = (W + tailPx()) + 'px'; syncRuler();
  $('tTotal').textContent = '/ ' + num(fmt(speechEnd()));
  wireTimeline(); placeClipBar();
}
const speechEnd = () => Math.max(0, ...speechClips().map(c => c.at + dur(c)));
function syncRuler(){ $('rulerView').scrollLeft = $('tlScroll').scrollLeft; }
function wireTimeline(){
  $('ruler').onpointerdown = ev => { seekFromX(ev.clientX); scrubbing(); };
  $('phLabel').onpointerdown = ev => { ev.stopPropagation(); scrubbing(); };
  document.querySelectorAll('#lanes .clip').forEach(el => el.addEventListener('pointerdown', ev => startClipDrag(ev, el)));
  document.querySelectorAll('#lanes .trimh').forEach(el => el.addEventListener('pointerdown', ev => startTrim(ev, el)));
  $('lanes').onpointerdown = ev => { if (ev.target.id === 'lanes' || ev.target.classList.contains('lane')){ selClip = null; sel = new Set(); paintSel(); renderTimeline(); } };
}
function seekFromX(cx){ const r = $('lanes').getBoundingClientRect(); seek(Math.max(0, (cx - r.left - PAD) / zoom)); }
function scrubbing(){
  const sc = $('tlScroll'); let lastX = null, raf = 0;
  const edges = () => { const r = sc.getBoundingClientRect(), hw = $('heads').offsetWidth || 0; return [r.left + hw + 4, r.right - 28]; };
  const step = () => { raf = 0; if (lastX === null) return; const [L, Rr] = edges(); let d = 0;
    if (lastX > Rr) d = Math.min(26, (lastX - Rr) / 2 + 3); else if (lastX < L && sc.scrollLeft > 0) d = -Math.min(26, (L - lastX) / 2 + 3);
    if (d){ const before = sc.scrollLeft; sc.scrollLeft = Math.max(0, before + d); seekFromX(Math.min(Math.max(lastX, L), Rr)); if (sc.scrollLeft !== before) raf = requestAnimationFrame(step); } };
  const mv = e => { lastX = e.clientX; const [L, Rr] = edges(); seekFromX(Math.min(Math.max(e.clientX, L), Rr)); if (!raf) raf = requestAnimationFrame(step); };
  const up = () => { lastX = null; if (raf) cancelAnimationFrame(raf); raf = 0; removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function findClip(cid){ for (const t of S.tracks) { const c = t.clips.find(x => x.id === cid); if (c) return [t, c]; } return [null, null]; }
function snapT(t, c){ if (!snapOn) return t; const edges = [0, playhead]; speechClips().concat(S.tracks.find(x => x.kind === 'music').clips).forEach(o => { if (o !== c){ edges.push(o.at, o.at + dur(o)); } });
  for (const e of edges){ if (Math.abs((t - e) * zoom) < SNAP_PX) return e; if (Math.abs((t + dur(c) - e) * zoom) < SNAP_PX) return e - dur(c); } return t; }
const overlaps = (t, c) => t.clips.some(o => o !== c && o.at < c.at + dur(c) - 0.01 && c.at < o.at + dur(o) - 0.01);
function placeOn(ti, c){
  const t = S.tracks[ti]; if (!overlaps(t, c)){ t.clips.push(c); t.clips.sort((a, b) => a.at - b.at); return; }
  const n = S.tracks.filter(x => x.kind === 'speech').length + 1;
  S.tracks.splice(ti + 1, 0, { id: 's' + (++uid), name: 'گفتار ' + FA(n), en: 'Speech ' + n, kind: 'speech', gapless: false, clips: [c] });
}
function cleanupTracks(){ S.tracks = S.tracks.filter((t, k) => t.kind !== 'speech' || t.clips.length || t.id === 's1'); }
function startClipDrag(ev, el){
  ev.stopPropagation(); if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur(); getSelection().removeAllRanges(); const [t, c] = findClip(el.dataset.cid); if (!c) return;
  selClip = c.id; if (t.kind === 'music'){ showMusicInspector(); const x0 = ev.clientX, at0 = c.at; let moved = false; remember();   // 166: music clips move
 const mv = e => { if (Math.abs(e.clientX - x0) > 3) moved = true; if (!moved) return; c.at = Math.max(0, at0 + (e.clientX - x0) / zoom); el.style.left = (PAD + c.at * zoom) + 'px'; };
 const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (!moved){ hist.past.pop(); renderTimeline(); return; } S.music.manual = true; t.clips.sort((a, b) => a.at - b.at); renderTimeline(); autosave(); };
 addEventListener('pointermove', mv); addEventListener('pointerup', up); return; }
  sel = new Set(c.lines); const x0 = ev.clientX, at0 = c.at; let moved = false; remember();
  const y0 = ev.clientY; let hot = null;
 const mv = e => { const dx = (e.clientX - x0) / zoom; if (Math.abs(e.clientX - x0) > 3 || Math.abs(e.clientY - y0) > 6) moved = true; if (!moved) return;
 c.at = Math.max(0, snapT(at0 + dx, c)); el.style.left = (PAD + c.at * zoom) + 'px'; el.style.pointerEvents = 'none'; el.style.zIndex = 30; el.style.transform = `translateY(${e.clientY - y0}px)`;
 const ln = document.elementFromPoint(e.clientX, e.clientY), lane = ln && ln.closest('.lane'); if (hot && hot !== lane) hot.classList.remove('lane-hot'); hot = lane && S.tracks[+lane.dataset.ti] && S.tracks[+lane.dataset.ti].kind === 'speech' ? lane : null; if (hot) hot.classList.add('lane-hot'); };
  const up = e => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); const hotTi = hot ? +hot.dataset.ti : null; if (hot) hot.classList.remove('lane-hot'); el.style.transform = ''; el.style.pointerEvents = ''; el.style.zIndex = '';
 if (!moved){ hist.past.pop(); paintSel(); renderTimeline(); return; }
    const li = hotTi;   // 164: the lane that was lit during the drag
    t.clips = t.clips.filter(x => x !== c);
    let ti = li !== null && S.tracks[li] && S.tracks[li].kind === 'speech' ? li : S.tracks.indexOf(t);
    if (ti < 0) ti = 0; placeOn(ti, c); cleanupTracks(); if (S.tracks[ti] && S.tracks[ti].gapless) pack(S.tracks[ti]);
    renderScript(); autosave(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function startTrim(ev, el){
  ev.stopPropagation(); ev.preventDefault(); const [t, c] = findClip(el.dataset.cid); if (!c) return; remember(); if (t.kind === 'music'){ if (!c.src) c.src = [0, 1e9]; S.music.manual = true; } const edge = el.dataset.edge, x0 = ev.clientX, in0 = c.in, out0 = c.out, at0 = c.at, src = c.src || [c.in - (c.trimIn || 0), c.out + (c.trimOut || 0)];
  c.src = src;
  const mv = e => { const d = (e.clientX - x0) / zoom;
    if (edge === 'l'){ const ni = Math.min(out0 - 0.2, Math.max(src[0], in0 + d)); c.at = at0 + (ni - in0); c.in = ni; c.trimIn = ni - src[0]; }
    else { const no = Math.max(in0 + 0.2, Math.min(src[1], out0 + d)); c.out = no; c.trimOut = src[1] - no; }
    quickTrimVisual(c); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (t.gapless) pack(t); renderScript(); autosave(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
let trimRaf = 0;
function quickTrimVisual(c){
  const el = document.querySelector(`#lanes .clip[data-cid="${c.id}"]`); if (!el) return;
  const xl = PAD + c.at * zoom, w = Math.max(6, dur(c) * zoom - 2);
  el.style.left = xl + 'px'; el.style.width = w + 'px';
  const hl = document.querySelector(`#lanes .trimh[data-edge="l"][data-cid="${c.id}"]`), hr = document.querySelector(`#lanes .trimh[data-edge="r"][data-cid="${c.id}"]`);
  if (hl) hl.style.left = (xl - 5) + 'px'; if (hr) hr.style.left = (xl + w - 13) + 'px';
  cancelAnimationFrame(trimRaf); trimRaf = requestAnimationFrame(() => {
    const lt = document.querySelector(`#editor .ln[data-id="${c.lines[0]}"] .lt`); if (lt && c.lines.length === 1) lt.innerHTML = trimmedHtml(S.lines[c.lines[0]].text || '', c); });
}
function pack(t){ let x = t.clips.length ? Math.min(...t.clips.map(c => c.at)) : 0; t.clips.sort((a, b) => a.at - b.at).forEach(c => { c.at = x; x += dur(c); }); }
function setGapless(i, on){ remember(); S.tracks[i].gapless = on; if (on) pack(S.tracks[i]); renderScript(); autosave(); }
function toggleMute(i){ const t = S.tracks[i]; t.muted = !t.muted; const g = trackGain[t.id]; if (g && AC) g.gain.setValueAtTime(t.muted ? 0 : (t.volume ?? 1), AC.currentTime); renderTimeline(); autosave(); }   // live while playing
function setZoom(z){ zoom = z; $('zoom').value = z; renderTimeline(); }
$('zoom').oninput = e => setZoom(+e.target.value);
function placeClipBar(){
  const bar = $('clipBar'), el = selClip && document.querySelector(`#lanes .clip[data-cid="${selClip}"]`);
  if (!el){ bar.classList.add('hidden'); return; }
  const [t, c] = findClip(selClip), b = (icon, tip, fn, txt) => `<li><a onclick="${fn}" class="gap-1 " ${txt ? '' : `data-tip="${tip}"`}><svg class="size-3.5"><use href="#i-${icon}"/></svg>${txt ? `<span class="ui">${txt}</span>` : ''}</a></li>`;
  bar.innerHTML = t.kind === 'music' ? b('scissors', T('برش در جای پلی‌هد', 'split at the playhead'), 'splitMusic()') + b('copy', T('تکثیر', 'duplicate'), 'dupMusic()') + b('trash-2', T('حذف', 'delete'), 'delMusicClip()') : (c.unvoiced || c.file ? '' : b('refresh-cw', '', 'revoiceClip()', T('بازتولید', 'Re-voice')))
      + (c.lines.length === 1 && !c.unvoiced ? b('scissors', T('برش در جای پلی‌هد', 'split at the playhead'), 'splitClip()') : '')
      + b('copy', T('تکثیر', 'duplicate'), 'dupClip()') + b('trash-2', T('حذف', 'delete'), 'delClip()');
  const r = el.getBoundingClientRect(), sc = $('tlScroll').getBoundingClientRect(), left0 = sc.left + $('heads').offsetWidth;
  if (r.bottom < sc.top || r.top > sc.bottom || r.right < left0 || r.left > sc.right){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden'); const bh = bar.offsetHeight || 34; let top = r.top - bh - 6; if (top < sc.top - bh / 2) top = r.bottom + 6;
  bar.style.top = top + 'px'; bar.style.left = Math.min(innerWidth - bar.offsetWidth - 8, Math.max(left0, r.left)) + 'px';
}
function splitClip(){
  const [, c] = findClip(selClip); if (!c || c.lines.length !== 1 || c.unvoiced || playhead <= c.at + 0.15 || playhead >= c.at + dur(c) - 0.15) return;
  remember(); const id = c.lines[0], L = S.lines[id], D = dur(c) + (c.trimIn || 0) + (c.trimOut || 0);
  let at = Math.round((playhead - c.at + (c.trimIn || 0)) / D * L.text.length), sp = L.text.lastIndexOf(' ', at), sp2 = L.text.indexOf(' ', at);
  at = sp2 >= 0 && (sp < 0 || sp2 - at < at - sp) ? sp2 : (sp >= 0 ? sp : at);
  const tt = c.at - (c.trimIn || 0) + at / Math.max(1, L.text.length) * D; selClip = null; sliceAt(c, id, at, tt);
}
function dupClip(){
  const [t, c] = findClip(selClip); if (!c) return; remember();
  const ids = c.lines.map(id => { const n = ++uid; S.lines[n] = JSON.parse(JSON.stringify(S.lines[id])); return n; });
  const n = { ...JSON.parse(JSON.stringify(c)), id: 'c' + (++uid), lines: ids, at: c.at + dur(c) + GAP };
  shiftAfter(t, n.at, dur(n) + GAP, null); t.clips.push(n); t.clips.sort((a, b) => a.at - b.at); selClip = n.id; renderScript(); autosave();
}
function delClip(){ const [t, c] = findClip(selClip); if (!c) return; remember(); c.lines.forEach(id => { delete S.lines[id]; sel.delete(id); }); t.clips = t.clips.filter(x => x !== c); if (t.gapless) pack(t); cleanupTracks(); selClip = null; ensureOneLine(); renderScript(); autosave(); }
function openTrackMenu(ev, ti){
  ev.stopPropagation(); const m = $('trackMenu'), t = S.tracks[ti], r = ev.currentTarget.getBoundingClientRect();
  const items = t.kind === 'speech' ? [['line', T('خطِ تازه در جای پلی‌هد', 'New line at the playhead')], ['silence', T('یک ثانیه سکوت در جای پلی‌هد', 'One second of silence at the playhead')], ['file', T('فایلِ صوتی…', 'Audio file…')]]
    : [['music', T('انتخابِ موسیقی…', 'Choose music…')]];
  m.dir = lang === 'fa' ? 'rtl' : 'ltr';
  m.innerHTML = `<li class="menu-title">${T('افزودن', 'Add')}</li>` + items.map(([k, l]) => `<li><a onclick="document.getElementById('trackMenu').classList.add('hidden'); addFromTrack(${ti}, '${k}')">${l}</a></li>`).join('');
  m.classList.remove('hidden'); const h = m.offsetHeight, below = innerHeight - r.bottom - 8;
  m.style.top = (below >= h ? r.bottom + 4 : Math.max(8, r.top - h - 4)) + 'px'; m.style.left = Math.min(innerWidth - m.offsetWidth - 8, Math.max(8, r.left)) + 'px';
}
async function addFromTrack(ti, k){
  const t = S.tracks[ti];
  if (k === 'music') return openMusic();
  remember();
  if (k === 'silence'){ shiftAfter(t, playhead, 1.0, null); renderScript(); autosave(); return; }
  if (k === 'line'){ const nid = ++uid; S.lines[nid] = { text: '', dirty: false, voice: null };
    const c = { id: 'c' + (++uid), lines: [nid], gulp: null, in: 0, out: 1.5, at: playhead, trimIn: 0, trimOut: 0, unvoiced: true };
    shiftAfter(t, playhead, 1.5 + GAP, null); placeOn(ti, c); sel = new Set([nid]); renderScript(); focusLine(nid); autosave(); return; }
  if (k === 'file'){
    const r = await API().file_gulp(); if (!r.ok){ if (r.error !== 'cancelled') say(r.error, 'err'); hist.past.pop(); return; }
    await storeAudio(r.gulp, r.b64); const nid = ++uid; S.lines[nid] = { text: r.name, dirty: false, voice: null, file: true };
    const c = { id: 'c' + (++uid), lines: [nid], gulp: r.gulp, in: 0, out: r.seconds, at: playhead, trimIn: 0, trimOut: 0, file: true, src: [0, r.seconds] };
    shiftAfter(t, playhead, r.seconds + GAP, null); placeOn(ti, c); renderScript(); autosave();
  }
}
$('tlScroll').addEventListener('scroll', () => { syncRuler(); placeClipBar(); }, { passive: true });
addEventListener('resize', () => renderTimeline());

// =====================================================================================
// GENERATION — runs of lines become one request; the part's line map slices it into clips
// =====================================================================================
let CAST = [], CBX_VOICES = [], FISH_VOICES = [], BUILD_N = '';
const showBuild = () => { $('edBuild').textContent = T('· نسخهٔ ', '· Build ') + num(BUILD_N); };
async function loadEngineLists(){
  try { const r = await API().cbx_voices(); CBX_VOICES = (r && r.voices) || []; } catch (e) {}
  try { const r = await API().fish_my_voices(); FISH_VOICES = (r && r.items) || []; } catch (e) {}
  try { const r = await API().fish_key_get(); $('fishKey').value = (r && (r.key || '')) || ''; } catch (e) {}
}
async function saveFishKey(k){ try { await API().fish_key_set(k.trim()); say(T('کلیدِ Fish Audio ذخیره شد.', 'Fish Audio key saved.'), 'ok'); await loadEngineLists(); fillInspector(); } catch (e) { say(String(e), 'err'); } }
async function probeFish(){ say(T('دارم Fish Audio را می‌آزمایم…', 'Testing Fish Audio…'), 'ok'); try { const r = await API().fish_probe(); say(r.ok ? T('Fish Audio وصل است.', 'Fish Audio is connected.') : (r.error || T('وصل نشد.', 'Could not connect.')), r.ok ? 'ok' : 'err'); } catch (e) { say(String(e), 'err'); } }
async function addCbxVoice(){ const r = await API().cbx_voice_add(); if (!r || !r.ok){ if (r && r.error !== 'cancelled') say(r.error, 'err'); return; } await loadEngineLists(); const nv = r.voice || r.name || r.id; if (nv) setEng('cbxVoice', nv); fillInspector(); }

async function searchMusic(){
  const prov = $('mProv').value, q = $('mQuery').value.trim(); if (!q && prov !== 'lyria') return;
  $('musicResults').innerHTML = `<li class="p-3 text-sm text-base-content/60">${T('در حال جست‌وجو…', 'Searching…')}</li>`;
  try {
    const r = await API().music_search(prov, q, '', 'ambient', 1); if (!r.ok) throw new Error(r.error || '');
    MUSIC_HITS = r.items || r.results || r.tracks || [];
    $('musicResults').innerHTML = MUSIC_HITS.length ? MUSIC_HITS.map((it, k) => `<li class="list-row items-center py-2"><svg class="size-4 text-secondary"><use href="#i-music"/></svg>
      <div class="min-w-0"><div class="truncate text-sm" dir="auto">${escapeHtml(it.title || it.name || '')}</div><div class="truncate text-xs text-base-content/60" dir="auto">${escapeHtml([it.artist || it.user || it.creator, it.duration ? Math.round(it.duration) + 's' : '', it.license].filter(Boolean).join(' · '))}</div>
      ${(it.preview || it.preview_url || it.url) ? `<audio class="mt-1 h-7 w-full" controls preload="none" src="${escapeHtml(it.preview || it.preview_url || it.url)}"></audio>` : ''}</div>
      <button class="btn btn-sm border-base-content/15 bg-base-100" onclick="chooseHit(${k})">${T('انتخاب', 'Use')}</button></li>`).join('')
      : `<li class="p-3 text-sm text-base-content/60">${T('چیزی پیدا نشد؛ واژهٔ دیگری امتحان کنید.', 'Nothing found; try another word.')}</li>`;
  } catch (e) { $('musicResults').innerHTML = `<li class="p-3 text-sm text-error">${escapeHtml(e.message || String(e))}</li>`; }
}
async function chooseHit(k){
  setBusy(true); try { const r = await API().music_fetch($('mProv').value, MUSIC_HITS[k]); if (!r.ok) throw new Error(r.error || '');
    const e = r.entry || {}; S.music.credit = r.credit || ''; await setMusicTrack(r.b64, e.file, e.title || e.name || MUSIC_HITS[k].title || e.file); $('musicDlg').close(); focusMusic(); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
const RUN_CHARS = 600;                               // the classic default part size for Google
const fishFields = (v = {}) => { const f = S.proj.fish; return { f_model: f.model, f_latency: f.latency, f_voice: v.fishVoice || f.voice, f_preset: f.preset, f_style: f.preset === 'custom' ? (f.custom || '') : '', f_age: f.age || '', f_age_custom: f.ageCustom || '',
  f_state: f.state || '', f_state_custom: f.stateCustom || '', f_speed: f.speed, f_volume: f.volume, f_temp: f.temp, f_top_p: f.top_p, f_continuity: f.cont, f_cond_prev: f.condPrev,
  f_norm_loud: f.normLoud, f_normalize: f.normalize, f_quality_guard: f.quality, f_speakers: [] }; };
const payloadFor = (v, text) => ({ engine: v.engine, text, cbx_voice: v.cbxVoice || S.proj.cbx.voice, ...gFields(v), ...fishFields(v),
  exaggeration: S.proj.cbx.exag, cfg_weight: S.proj.cbx.cfg, temperature: S.proj.cbx.temp, cbx_speed: S.proj.cbx.speed,
  speed: S.proj.light.speed, noise: S.proj.light.noise, noisew: S.proj.light.noisew });
const gSpeakers = () => (S.proj.duo && S.proj.duo.on && /3\.1/.test(S.proj.g_model)) ? [S.proj.duo.a, S.proj.duo.b].filter(x => x && x.name).map(x => ({ name: x.name, voice: x.voice })) : [];
const gFields = v => ({ g_model: S.proj.g_model, g_lang: S.proj.g_lang, g_voice: v.gVoice, g_preset: v.gPreset, g_style: (v.gPreset || S.proj.g_preset) === 'custom' ? (S.proj.g_style || '') : '', g_age: S.proj.g_age || '', g_age_custom: '',
  g_state: v.gState || '', g_state_custom: '', g_speakers: [], g_continuity: !!S.proj.g_continuity, g38_cast: [] });   // 162: speakers are per line now
async function storeAudio(gid, b64){
  scheduleQuota();
  try { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const buf = await ac().decodeAudioData(u8.buffer.slice(0)); AUD.set(gid, { buf }); }
  catch (e) { AUD.set(gid, { buf: null }); }
}
async function ensureAudio(gid){
  if (gid === null || gid === undefined || (AUD.get(gid) || {}).buf) return true;
  const r = await API().gulp_audio(gid); if (!r.ok) return false; await storeAudio(gid, r.b64); return true;
}
function collectRuns(){
  const runs = []; let cur = null;
  scriptOrder().forEach(c => {
    if (c.file){ cur = null; return; }
    if (c.unvoiced){
      const ids = c.lines.filter(id => (S.lines[id].text || '').trim()); if (!ids.length){ return; }
      const key = JSON.stringify(lineVoice(ids[0])), chars = ids.reduce((s, id) => s + S.lines[id].text.length, 0);
      if (cur && cur.key === key && cur.track === c._track && cur.chars + chars <= RUN_CHARS){ cur.clips.push(c); cur.chars += chars; }
      else { cur = { key, track: c._track, clips: [c], chars }; runs.push(cur); }
    } else { cur = null; if (c.lines.some(id => S.lines[id] && S.lines[id].dirty)) runs.push({ patch: c }); }
  });
  return runs;
}
async function generateAll(){
  if (busy) return; const runs = collectRuns();
  if (!runs.length){ say(T('همهٔ خط‌ها ساخته شده‌اند؛ چیزی برای ساختن نمانده.', 'Every line is voiced; nothing left to make.'), 'ok'); return; }
  remember(); setBusy(true);
  try {
    for (let k = 0; k < runs.length; k++){
      say(T(`دارم بخش ${FA(k + 1)} از ${FA(runs.length)} را می‌سازم…`, `Making part ${k + 1} of ${runs.length}…`), 'ok');
      if (runs[k].patch) await revoice(runs[k].patch, null); else await voiceRun(runs[k]);
      renderScript();
    }
    gcParts(); say(T('ساخته شد. با دکمهٔ پخش بشنوید؛ «فایل نهایی» فایل را از روی خطِ زمان می‌سازد.', 'Done. Press play to listen; "Export" builds the file from the timeline.'), 'ok');
  } catch (e) { say(isCancel(e) ? T('لغو شد.', 'Cancelled.') : (e.message || String(e)), isCancel(e) ? 'ok' : 'err'); }
  finally { setBusy(false); renderScript(); autosave(); }
}
async function voiceRun(run){
  const ids = run.clips.flatMap(c => c.lines.filter(id => speakableLine(id))); if (!ids.length) return;   // 166: nothing to speak → nothing is sent
 const text = ids.map(id => spoken(id)).join('\n');
  const r = await API().generate_gulp(payloadFor(lineVoice(ids[0]), text));
  if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
  await storeAudio(r.gulp, r.b64);
  const t = run.track, anchor = run.clips[0].at, oldEnd = Math.max(...run.clips.map(c => c.at + dur(c)));
  t.clips = t.clips.filter(c => !run.clips.includes(c) || c.lines.some(id => !ids.includes(id)));
  run.clips.forEach(c => { c.lines = c.lines.filter(id => !ids.includes(id)); });   // empty lines stay as placeholders
  t.clips = t.clips.filter(c => c.lines.length);
  const spans = r.lines || [], made = [];
  if (spans.length === ids.length && !spans[0].whole){
    spans.forEach((sp, k) => made.push({ id: 'c' + (++uid), lines: [ids[k]], gulp: r.gulp, in: sp.t0, out: sp.t1, words: shiftWords(sp.words, spokenInfo(ids[k]).shift), src: [sp.t0, sp.t1], gi: k, at: anchor + (sp.t0 - spans[0].t0), trimIn: 0, trimOut: 0 }));
  } else {
    const end = spans.length ? spans[spans.length - 1].t1 : ((AUD.get(r.gulp) || {}).buf ? AUD.get(r.gulp).buf.duration : 1);
    made.push({ id: 'c' + (++uid), lines: ids, gulp: r.gulp, in: 0, out: end, src: [0, end], gi: 0, at: anchor, trimIn: 0, trimOut: 0 });
  }
  ids.forEach(id => { S.lines[id].dirty = false; });
  const newEnd = Math.max(...made.map(c => c.at + dur(c)));
  shiftAfter(t, oldEnd - 0.001, newEnd - oldEnd, null);
  t.clips.push(...made); t.clips.sort((a, b) => a.at - b.at); if (t.gapless) pack(t);
}
async function revoice(c, selectOnly){
  // the clip's part, rebuilt from the lines that now carry it, in the part's order
  const owners = speechClips().filter(x => x.gulp === c.gulp && !x.file).sort((a, b) => (a.gi || 0) - (b.gi || 0) || a.in - b.in);
  const ids = owners.flatMap(x => x.lines), text = ids.map(id => spoken(id)).join('\n');
  const targets = selectOnly ? selectOnly : c.lines.filter(id => S.lines[id].dirty).length ? c.lines.filter(id => S.lines[id].dirty) : c.lines;
  const first = ids.indexOf(targets[0]), last = ids.indexOf(targets[targets.length - 1]);
  const sel_start = ids.slice(0, first).reduce((s, id) => s + spoken(id).length + 1, 0);
  const sel_end = sel_start + ids.slice(first, last + 1).map(id => spoken(id)).join('\n').length;
  const r = await API().patch_gulp({ gulp: c.gulp, text, sel_start, sel_end, payload: payloadFor(lineVoice(targets[0]), text) });
  if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
  await storeAudio(r.gulp, r.b64);
  const spans = r.lines || [];
  if (spans.length === ids.length && !spans[0].whole){
    owners.forEach(o => {
      const k = ids.indexOf(o.lines[0]), sp = spans[k], before = dur(o), [t] = clipOfLine(o.lines[0]);
      const fresh = targets.includes(o.lines[0]);
      o.gulp = r.gulp; o.gi = k; o.src = [sp.t0, sp.t1]; o.words = shiftWords(sp.words, spokenInfo(o.lines[0]).shift);
      o.trimIn = fresh ? 0 : Math.min(o.trimIn || 0, sp.t1 - sp.t0 - 0.2); o.trimOut = fresh ? 0 : Math.min(o.trimOut || 0, sp.t1 - sp.t0 - 0.2 - o.trimIn);
      o.in = sp.t0 + o.trimIn; o.out = sp.t1 - o.trimOut;
      const delta = dur(o) - before; if (Math.abs(delta) > 0.001) shiftAfter(t, o.at + before - 0.001, delta, o);
    });
  } else {
    const [t] = clipOfLine(owners[0].lines[0]), end = (AUD.get(r.gulp) || {}).buf ? AUD.get(r.gulp).buf.duration : dur(owners[0]);
    const at = Math.min(...owners.map(o => o.at)), oldEnd = Math.max(...owners.map(o => o.at + dur(o)));
    S.tracks.forEach(tr => tr.clips = tr.clips.filter(x => !owners.includes(x)));
    t.clips.push({ id: 'c' + (++uid), lines: ids, gulp: r.gulp, in: 0, out: end, src: [0, end], gi: 0, at, trimIn: 0, trimOut: 0 });
    shiftAfter(t, oldEnd - 0.001, (at + end) - oldEnd, null); t.clips.sort((a, b) => a.at - b.at); cleanupTracks();
  }
  ids.forEach(id => { if (S.lines[id]) S.lines[id].dirty = false; });
}
async function revoiceSelected(){ if (busy || sel.size !== 1) return; const id = [...sel][0], [, c] = clipOfLine(id); if (!c) return;
  if (c.unvoiced) return generateAll(); remember(); setBusy(true);
  try { await revoice(c, [id]); gcParts(); say(T('این خط دوباره ساخته شد.', 'This line was re-voiced.'), 'ok'); }
  catch (e) { say(isCancel(e) ? T('لغو شد.', 'Cancelled.') : (e.message || String(e)), isCancel(e) ? 'ok' : 'err'); }
  finally { setBusy(false); renderScript(); autosave(); } }
async function revoiceClip(){ const [, c] = findClip(selClip); if (!c || c.unvoiced) return; sel = new Set([c.lines[0]]); if (c.lines.length > 1){ remember(); setBusy(true);
  try { await revoice(c, c.lines); } catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); renderScript(); autosave(); } } else revoiceSelected(); }

// =====================================================================================
// PLAYBACK — the timeline mixed live with WebAudio (preview); the engine makes the final file
// =====================================================================================
let AC = null, nodes = [], playT0 = 0, playFrom = 0, stopAt = null, rafId = 0, musicBuf = null, trackGain = {};
const ac = () => AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
async function togglePlay(){ if (playing) stopPlay(); else await startPlay(); }
async function startPlay(until){
  const ctx = ac(); try { await ctx.resume(); } catch (e) {}
  const need = [...new Set(speechClips().filter(c => !c.unvoiced && c.gulp !== null).map(c => c.gulp))];
  for (const g of need) await ensureAudio(g);
  if (until === undefined && playhead >= speechEnd() - 0.05) seek(0);
  stopAt = until === undefined ? null : until; playFrom = playhead; playT0 = ctx.currentTime + 0.05; playing = true;
  $('playIco').innerHTML = '<use href="#i-pause"/>'; schedule(); rafId = requestAnimationFrame(tick);
}
function schedule(){
  const ctx = ac(), base = playT0 - playFrom, speech = []; trackGain = {};
  const gainFor = t => { if (!trackGain[t.id]){ const g = ctx.createGain(); g.gain.value = t.muted ? 0 : (t.volume ?? 1); g.connect(ctx.destination); trackGain[t.id] = g; } return trackGain[t.id]; };
  S.tracks.forEach(t => { if (t.kind !== 'speech') return; t.clips.forEach(c => {
    if (c.unvoiced) return; const a = AUD.get(c.gulp); if (!a || !a.buf) return;
    const end = c.at + dur(c); if (end <= playFrom) return;
    const off = Math.max(0, playFrom - c.at), src = ctx.createBufferSource(); src.buffer = a.buf; src.connect(gainFor(t));
    src.start(base + c.at + off, c.in + off, dur(c) - off); nodes.push(src); if (!t.muted) speech.push([c.at, end]); }); });
  const mt = S.tracks.find(t => t.kind === 'music'); if (musicBuf && mt && mt.clips.length && !mt.muted){   // 166: every music clip at its place
    const lvl = Math.pow(10, S.music.level_db / 20), duckF = Math.pow(10, -(S.music.duck_db ?? 12) / 20), D = musicBuf.duration, ducking = (S.music.duck ?? true) && (S.music.duck_db ?? 12) > 0;
    const inSpeech = tt => speech.some(([a, b]) => tt >= a - 0.15 && tt < b + 0.6), cl = [...mt.clips].sort((a, b) => a.at - b.at), first = cl[0].at, last = Math.max(...cl.map(c => c.at + c.out - c.in));
    cl.forEach(c => { const len = c.out - c.in, s0 = Math.max(c.at, playFrom), e0 = c.at + len; if (e0 <= playFrom || len <= 0.05) return;
      const g = ctx.createGain(), src = ctx.createBufferSource(); src.buffer = musicBuf; src.loop = true; src.connect(g); g.connect(gainFor(mt));
      const at = tt => base + tt, P = g.gain, fi = c.at === first ? (S.music.fade_in || 0) : 0.03, fo = Math.abs(e0 - last) < 1e-6 ? (S.music.fade_out || 0) : 0.03;
      const level = tt => { let l = ducking && inSpeech(tt) ? lvl * duckF : lvl; if (fi > 0 && tt - c.at < fi) l *= Math.max(0, (tt - c.at) / fi); if (fo > 0 && e0 - tt < fo) l *= Math.max(0, (e0 - tt) / fo); return l; };
      P.setValueAtTime(level(s0), Math.max(ctx.currentTime, at(s0))); for (let tt = s0; tt <= e0; tt += 0.1) P.linearRampToValueAtTime(level(tt), Math.max(ctx.currentTime, at(tt)));
      src.start(Math.max(ctx.currentTime, at(s0)), (c.in + (s0 - c.at)) % D); src.stop(at(e0) + 0.02); nodes.push(src); });
  }
}
function tick(){
  if (!playing) return; const t = playFrom + (ac().currentTime - playT0);
  if ((stopAt !== null && t >= stopAt) || t >= speechEnd() + 0.05){ stopPlay(); seekVisual(stopAt !== null ? stopAt : speechEnd()); return; }
  seekVisual(Math.max(playFrom, t));
  const wrap = $('tlScroll'), vis = wrap.clientWidth - $('heads').offsetWidth, x = PAD + playhead * zoom;
  if (x > wrap.scrollLeft + vis * 0.85) wrap.scrollLeft = x - vis * 0.15;
  rafId = requestAnimationFrame(tick);
}
function stopPlay(){ playing = false; cancelAnimationFrame(rafId); nodes.forEach(n => { try { n.stop(); } catch (e) {} }); nodes = []; $('playIco').innerHTML = '<use href="#i-play"/>'; }
function seekVisual(t){
  playhead = Math.max(0, t); const x = PAD + playhead * zoom;
  const ph = $('ph'); if (ph) ph.style.left = x + 'px'; const pl = $('phLabel'); if (pl){ pl.style.left = (x - 22) + 'px'; pl.textContent = num(fmt(playhead)); }
  const st = $('phStem'); if (st) st.style.left = x + 'px';
  const tb = $('tBtn'); if (tb) tb.textContent = num(fmt(playhead)); updatePCaret();
}
function seek(t, scrollTo){ const was = playing; if (was) stopPlay(); seekVisual(t); if (scrollTo) $('tlScroll').scrollLeft = Math.max(0, playhead * zoom - 40); if (was) startPlay(); }
function playLine(){ const id = [...sel][0], [, c] = clipOfLine(id); if (!c || c.unvoiced) return; seek(c.at); startPlay(c.at + dur(c)); }
function jumpLine(dir){ const starts = scriptOrder().map(c => c.at).sort((a, b) => a - b);
  const t = dir > 0 ? starts.find(x => x > playhead + 0.05) : [...starts].reverse().find(x => x < playhead - 0.05);
  if (t !== undefined) seek(t, true); else if (dir < 0) seek(0, true); }
function editTime(){
  const b = $('tBtn'); const inp = document.createElement('input'); inp.className = 'input input-sm w-28 text-center tabular-nums'; inp.value = fmt(playhead); inp.dir = 'ltr';
  b.replaceWith(inp); inp.focus(); inp.select(); let done = false;
  const finish = ok => { if (done) return; done = true;
    if (ok){ const m = inp.value.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).match(/^(?:(\d+):)?(\d+(?:[.,]\d+)?)$/); if (m) seek((+(m[1] || 0)) * 60 + parseFloat(m[2].replace(',', '.')), true); }
    inp.replaceWith(b); b.textContent = num(fmt(playhead)); };
  inp.onkeydown = e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }; inp.onblur = () => finish(true);
}
addEventListener('keydown', e => { if (e.code === 'Space' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.isContentEditable){ e.preventDefault(); togglePlay(); } });

// =====================================================================================
// EXPORT — the final file is built by the engine from the timeline
// =====================================================================================
function pending(){ return Object.entries(S.lines).filter(([id, L]) => { const [, c] = clipOfLine(+id); return (L.text || '').trim() && c && (c.unvoiced || L.dirty); }).length; }
function timelineSpec(){ return { clips: S.tracks.filter(t => t.kind === 'speech' && !t.muted).flatMap(t => t.clips.filter(c => !c.unvoiced && c.gulp !== null).map(c => ({ gulp: c.gulp, in: c.in, out: c.out, at: c.at, gain: 1 }))) }; }
async function exportAudio(withMusic){
  document.activeElement && document.activeElement.blur();
  if (pending()) say(T(`${FA(pending())} خط تغییر کرده و دوباره ساخته نشده؛ تایم‌لاین همان‌طور که پخش می‌شود ذخیره می‌شود.`, `${pending()} lines are edited and not re-voiced; the timeline is exported as it plays.`), 'ok');
  if (withMusic && !S.music.file){ say(T('موسیقی‌ای انتخاب نشده؛ از دکمهٔ + روی ترکِ موسیقی یکی انتخاب کنید.', 'No music chosen; pick one with + on the music track.'), 'err'); return; }
  if (busy) return; setBusy(true);
  try {
    const r = await API().timeline_files(timelineSpec(), withMusic ? { on: true, file: S.music.file, level_db: S.music.level_db, duck: (S.music.duck_db ?? 12) > 0, duck_db: S.music.duck_db ?? 12, fade_in: S.music.fade_in, fade_out: S.music.fade_out } : null);
    if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
    const s = await API().save_mp3(withMusic ? r.b64_music : r.b64, withMusic ? 'music' : '');
    if (s.ok) say(T('ذخیره شد: ', 'Saved: ') + s.path + ' — ' + num(r.seconds) + T(' ثانیه', ' s'), 'ok');
  } catch (e) { say(isCancel(e) ? T('لغو شد.', 'Cancelled.') : (e.message || String(e)), isCancel(e) ? 'ok' : 'err'); }
  finally { setBusy(false); }
}
const cueText = s => (s || '').replace(/\[[^\]]{1,40}\]|<[^>]{1,30}>|\{[^{}]{1,60}\}|\|[^|]{1,20}\|/g, ' ').replace(/^\s*[^:：\n]{1,30}[:：]\s*/, '').replace(/\s+/g, ' ').trim();
async function exportCaptions(fmt){
  const cues = [];
  scriptOrder().filter(c => !c.unvoiced && !c.file && !c._track.muted).forEach(c => {
    const lens = c.lines.map(id => Math.max(1, cueText(S.lines[id].text).length)), tot = lens.reduce((a, b) => a + b, 0); let t0 = c.at;
    c.lines.forEach((id, k) => { const d = dur(c) * lens[k] / tot; cues.push({ t0, t1: t0 + d, text: cueText(S.lines[id].text) }); t0 += d; });
  });
  if (!cues.length){ say(T('هنوز خطی ساخته نشده که زیرنویس داشته باشد.', 'No voiced lines to caption yet.'), 'err'); return; }
  const r = await API().timeline_captions({ cues, fmt }); if (!r.ok){ say(r.error, 'err'); return; }
  const s = await API().save_text(r.text, fmt); if (s.ok) say(T('زیرنویس ذخیره شد: ', 'Subtitles saved: ') + s.path + ' — ' + num(cues.length) + T(' سطر', ' cues'), 'ok');
}

// =====================================================================================
// MUSIC — the app's library; one bed under the whole speech, as before
// =====================================================================================
async function openMusic(){
  const r = await API().music_list(), items = (r && r.items) || [];
  $('musicList').innerHTML = items.length ? items.map((it, k) => `<li class="list-row cursor-pointer items-center py-2 hover:bg-base-300" onclick="chooseMusic(${k})"><svg class="size-4 text-secondary"><use href="#i-music"/></svg><div class="min-w-0"><div class="truncate text-sm" dir="auto">${escapeHtml(it.title || it.name || it.file)}</div><div class="text-xs text-base-content/60" dir="auto">${escapeHtml(it.source || it.provider || '')}</div></div></li>`).join('')
    : `<li class="p-3 text-sm text-base-content/60">${T('هنوز موسیقی‌ای در کتابخانه نیست.', 'No music in the library yet.')}</li>`;
  $('musicList')._items = items; if (!$('mProv').options.length){ $('mProv').innerHTML = optList(MUSIC_PROVIDERS, MUSIC_PROVIDERS[0][0]); } $('musicDlg').showModal();
}
async function chooseMusic(k){ const it = $('musicList')._items[k]; const r = await API().music_load(it.file); if (!r.ok){ say(r.error, 'err'); return; } await setMusicTrack(r.b64, it.file, it.title || it.name || it.file); $('musicDlg').close(); }
async function importMusic(){ const r = await API().music_import(); if (!r.ok){ if (r.error !== 'cancelled') say(r.error, 'err'); return; } const e = r.entry || {}; await setMusicTrack(r.b64, e.file, e.title || e.name || e.file); $('musicDlg').close(); }
async function setMusicTrack(b64, file, name){
  remember(); const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  try { musicBuf = await ac().decodeAudioData(u8.buffer.slice(0)); } catch (e) { musicBuf = null; }
  S.music.file = file; S.music.name = name; layoutMusic(); sel = new Set(); selClip = 'mu1'; renderScript(); showMusicInspector(); autosave();
}
function layoutMusic(){ const mt = S.tracks.find(t => t.kind === 'music'); if (!S.music.file){ mt.clips = []; S.music.manual = false; return; } if (!S.music.manual || !mt.clips.length) mt.clips = [{ id: 'mu1', name: S.music.name, at: 0, in: 0, out: Math.max(2, speechEnd()) }]; }   // 166: once edited, your clips are kept
function removeMusic(){ remember(); S.music.file = null; S.music.name = null; musicBuf = null; layoutMusic(); selClip = null; showInsp('proj'); renderScript(); autosave(); }
function setMusic(k, v){ S.music[k] = v; autosave(); if (playing){ const t = playhead; stopPlay(); seekVisual(t); startPlay(); } }
function showMusicInspector(){ ['line', 'proj'].forEach(k => $('insp-' + k).classList.add('hidden')); $('insp-music').classList.remove('hidden');
  $('musicName').textContent = S.music.name || ''; $('musicCredit').textContent = S.music.credit || ''; setRange('mLevel', S.music.level_db); setRange('mFadeIn', S.music.fade_in); setRange('mFadeOut', S.music.fade_out); setRange('mDuckDb', S.music.duck_db ?? 12); }
const UNIT_FA = { '%': '٪', px: 'px', dB: 'دسی‌بل', s: 'ثانیه', '°': '°', '': '' };
function rvText(el){ const v = +el.value, u = el.dataset.unit || '', n = Number.isInteger(v) ? String(v) : v.toFixed(1); return (lang === 'fa' ? FA(n).replace('.', '٫').replace('-', '−') : n) + (u ? ' ' + (lang === 'fa' ? (UNIT_FA[u] ?? u) : u) : ''); }
function wireRangeValues(){ document.querySelectorAll('aside input[type=range]').forEach(el => { if (el._rv) return; const b = document.createElement('span'); b.className = 'rv shrink-0 text-xs font-medium tabular-nums text-base-content/80';
  const leg = el.closest('fieldset') && el.closest('fieldset').querySelector('legend'); if (leg){ leg.classList.add('flex', 'w-full', 'items-center', 'justify-between'); leg.appendChild(b); } else el.insertAdjacentElement('afterend', b);
  el._rv = b; b.textContent = rvText(el); el.addEventListener('input', () => b.textContent = rvText(el)); }); }
function setRange(id, v){ const el = $(id); if (!el) return; el.value = v; if (el._rv) el._rv.textContent = rvText(el); }

// =====================================================================================
// KEYS, HELP, LANGUAGE, THEME, NETWORK
// =====================================================================================
let KEYS = [];
const KSTATE = { ok: ['فعال', 'Active', 'badge-success'], exhausted: ['سهمیهٔ امروزش تمام شده', "Today's quota used", 'badge-ghost'], bad: ['نامعتبر', 'Invalid', 'badge-error'] };
async function refreshKeys(){ try { const r = await API().google_keys(); KEYS = (r && r.keys) || []; } catch (e) { KEYS = []; }
  const ok = KEYS.filter(k => k.state === 'ok').length; $('keysBadge').textContent = num(ok) + '/' + num(KEYS.length); $('keysBadge').className = 'badge badge-sm ' + (ok ? 'badge-secondary' : 'badge-error');
  $('keyList').innerHTML = KEYS.length ? KEYS.map((k, i) => { const [fa, en, cls] = KSTATE[k.state] || KSTATE.ok;
    return `<li class="list-row items-center py-2"><code class="text-xs" dir="ltr">${escapeHtml(k.masked)}</code><span class="badge badge-sm ${cls}">${T(fa, en)}</span><button class="btn btn-ghost btn-xs btn-square" onclick="removeKey(${i})" aria-label="remove"><svg class="size-3.5"><use href="#i-trash-2"/></svg></button></li>`; }).join('')
    : `<li class="p-3 text-sm text-base-content/60">${T('هنوز کلیدی اضافه نشده.', 'No keys yet.')}</li>`; }
function openKeys(){ refreshKeys(); $('keysDlg').showModal(); }
async function saveKeys(){ const add = $('keyNew').value.split(/\s+/).map(x => x.trim()).filter(Boolean); if (!add.length) return;
  await API().google_keys_set(KEYS.map(k => k.key).concat(add)); $('keyNew').value = ''; refreshKeys(); }
async function removeKey(i){ await API().google_keys_set(KEYS.filter((_, k) => k !== i).map(k => k.key)); refreshKeys(); }
async function probeKeys(){ say(T('دارم اتصال و کلیدها را می‌آزمایم…', 'Testing the connection and keys…'), 'ok'); try { const r = await API().google_probe(S.proj.g_model); say(r.ok ? T('اتصال برقرار است.', 'Connected.') : (r.error || T('اتصال برقرار نشد.', 'Could not connect.')), r.ok ? 'ok' : 'err'); } catch (e) { say(String(e), 'err'); } refreshKeys(); }
function openHelp(section){
  const f = $('helpFrame'); f.src = (lang === 'fa' ? 'help_fa.html' : 'help_en.html') + '?theme=' + ($('themeChk').checked ? 'light' : 'dark');
  f.onload = () => { if (section !== 'guide') return; try { const d = f.contentDocument, h = [...d.querySelectorAll('h2,h3')].find(x => /حرکت‌گذاری|diacritiz/i.test(x.textContent)); h && h.scrollIntoView(); } catch (e) {} };
  $('helpDlg').showModal();
}
function applyLang(){
  document.querySelectorAll('[data-en]').forEach(el => { if (el.dataset.fa === undefined) el.dataset.fa = el.textContent; el.textContent = lang === 'fa' ? el.dataset.fa : el.dataset.en; });
  document.querySelectorAll('[data-tip]').forEach(el => { if (el.dataset.tipFa === undefined) el.dataset.tipFa = el.dataset.tip; });
  document.documentElement.lang = lang;
}
$('langBtn').onclick = () => { lang = lang === 'fa' ? 'en' : 'fa'; try { localStorage.setItem('ava-lang', lang); } catch (e) {} try { API().set_lang(lang); } catch (e) {} applyLang(); fillInspector(); renderScript(); refreshKeys(); seekVisual(playhead); showBuild(); document.querySelectorAll('aside input[type=range]').forEach(el => { if (el._rv) el._rv.textContent = rvText(el); }); };
$('themeChk').onchange = e => { try { localStorage.setItem('ava-ed-theme', e.target.checked ? 'ava-day' : 'ava-night'); } catch (x) {} };
async function netStatus(){ try { const r = await API().net_get(); const dot = $('netDot'); dot.className = 'status status-md ' + (r.ok ? 'status-success' : 'status-warning');
  $('netTip').dataset.tip = (r.route ? T('مسیر: ', 'Route: ') + r.route : T('اتصال به گوگل', 'Connection to Google')); } catch (e) {} }

// =====================================================================================
// START
// =====================================================================================
async function init(){
  if (!window.pywebview || !window.pywebview.api) await new Promise(r => addEventListener('pywebviewready', r, { once: true }));
  try { lang = localStorage.getItem('ava-lang') === 'en' ? 'en' : 'fa'; const th = localStorage.getItem('ava-ed-theme'); if (th === 'ava-day'){ $('themeChk').checked = true; } } catch (e) {}
  const [st, ses, dl] = await Promise.all([API().settings_get(), API().session(), API().director_lists()]);
  DIRECTOR = dl || DIRECTOR; SESSION = ses.session;
  BUILD_N = ses.build || ''; showBuild();
  document.querySelectorAll('.xlink').forEach(a => a.onclick = e => { e.preventDefault(); API().open_url('https://x.com/kamangir31'); });   // as in the classic interface CAST = (st && st.g38_cast) || [];
  if (st && st.default_g_model) S.proj.g_model = st.default_g_model;
  if (st && st.ed_doc) API().settings_set({ ed_doc: null });   // 164: the app always opens empty
  if (false){ restoreSnap(st.ed_doc);
    if (st.ed_session !== SESSION){             // a new app session: parts are no longer in memory
      S.tracks.forEach(t => t.clips.forEach(c => { if (t.kind === 'speech'){ c.gulp = null; c.unvoiced = true; c.in = 0; c.out = c.lines.reduce((s, id) => s + estDur(S.lines[id] && S.lines[id].text), 0); c.trimIn = c.trimOut = 0; delete c.src; } }));
      Object.values(S.lines).forEach(L => L.dirty = false); S.tracks = S.tracks.filter(t => t.kind !== 'speech' || t.id === 's1' || t.clips.length);
      if (Object.keys(S.lines).length) say(T('متنِ کارِ قبلی برگشت؛ صداهایش در جلسهٔ قبلیِ برنامه بودند — برای شنیدن دوباره «تبدیل به گفتار» را بزنید.', 'Your text is back; its audio was in the previous session — press "Voice it" to hear it again.'), 'ok');
    }
    if (S.music.file){ try { const r = await API().music_load(S.music.file); if (r.ok){ const bin = atob(r.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); musicBuf = await ac().decodeAudioData(u8.buffer.slice(0)); } } catch (e) {} }
  }
  RECENT = (st && st.ed_recent) || {}; LIBV = (st && st.ed_lib_voices) || []; FISH_USED = (st && st.fish_used) || []; FISH_DESIGNED = (st && st.fish_designed) || [];
  DEFAULTS = { engine: st && st.default_engine, model: st && st.default_g_model };
  await loadEngineLists(); await loadG38Lists(); if (st && st.default_engine && !st.ed_doc) S.proj.engine = st.default_engine; if (st && st.default_g_model && !st.ed_doc) S.proj.g_model = st.default_g_model;
  ensureOneLine(); applyLang(); fillInspector(); wireRangeValues(); layoutMusic(); renderScript(); seekVisual(0); refreshKeys(); netStatus();
  try { const L = await API().license_state(); if (L && L.ok && L.days_left !== null && L.days_left !== undefined && L.days_left <= 21) say(T(`مجوزِ این دستگاه ${FA(L.days_left)} روزِ دیگر تمام می‌شود؛ برای تمدید، کدِ درخواست را برای کسی بفرستید که برنامه را به شما داده است.`, `This machine's licence ends in ${L.days_left} days; to renew, send the request code to whoever gave you the app.`), 'ok'); } catch (e) {}
  const gulps = [...new Set(speechClips().filter(c => !c.unvoiced && c.gulp !== null).map(c => c.gulp))];
  for (const g of gulps){ if (await ensureAudio(g)) renderTimeline(); }
}
init();


// =====================================================================================
// 159 · KEYBOARD (app-level undo/redo everywhere, Delete for timeline items) + TOOLTIP LAYER
// =====================================================================================
let typingSnap = false, typingTimer = 0;
function noteTyping(){ if (!typingSnap){ remember(); typingSnap = true; } clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingSnap = false; }, 1200); }
addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), t = e.target, inText = /INPUT|TEXTAREA|SELECT/.test(t.tagName);
  if (mod && !inText && (k === 'z' || k === 'y')){
    e.preventDefault(); e.stopPropagation(); typingSnap = false; if (k === 'y' || e.shiftKey) redo(); else undo(); return;
  }
  if (e.key === 'Escape' && !document.querySelector('dialog[open]') && $('ddMenu').classList.contains('hidden') && !(typeof mode !== 'undefined' && mode === 'video')){
    if (t.isContentEditable) t.blur(); getSelection().removeAllRanges(); if (sel.size || selClip){ sel = new Set(); selClip = null; paintSel(); renderTimeline(); } return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !inText && !t.isContentEditable && !(typeof mode !== 'undefined' && mode === 'video')){
    if (selClip){ e.preventDefault(); const [tr] = findClip(selClip); if (tr && tr.kind === 'music') delMusicClip(); else delClip(); return; }
    if (sel.size){ e.preventDefault(); deleteLine(); }
  }
}, true);
const tipEl = document.createElement('div');
tipEl.className = 'ui pointer-events-none fixed z-[2000] hidden max-w-xs rounded-field bg-neutral px-2 py-1 text-xs text-neutral-content shadow-lg';
document.body.appendChild(tipEl);
document.addEventListener('pointerover', e => {
  const el = e.target.closest && e.target.closest('[data-tip]'); if (!el){ tipEl.classList.add('hidden'); return; }
  tipEl.textContent = lang === 'fa' ? (el.dataset.tipFa || el.dataset.tip) : (el.dataset.tipEn || tr(el.dataset.tipFa || el.dataset.tip));
  tipEl.dir = lang === 'fa' ? 'rtl' : 'ltr'; tipEl.classList.remove('hidden');
  const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, hh = tipEl.offsetHeight;
  tipEl.style.left = Math.min(innerWidth - w - 6, Math.max(6, r.left + r.width / 2 - w / 2)) + 'px';
  tipEl.style.top = (r.top - hh - 8 > 4 ? r.top - hh - 8 : r.bottom + 8) + 'px';
});
document.addEventListener('pointerdown', () => tipEl.classList.add('hidden'));


// =====================================================================================
// 159 · THE DROPDOWN — the classic interface's conventions, in the editor's style
//   anchored to its button (same width, same edge), opens up when there is no room below,
//   search box for long lists, a "recent" group, pin (= make default) and delete on rows,
//   arrow keys / Enter / Escape. The hidden <select> leaves any .join so rounding is right.
// =====================================================================================
let RECENT = {};
function noteRecent(key, v){ if (!key || !v) return; const a = (RECENT[key] || []).filter(x => x !== v); a.unshift(v); RECENT[key] = a.slice(0, 5); try { API().settings_set({ ed_recent: RECENT }); } catch (e) {} }
function enh(sel){
  if (sel._btn) return refreshEnh(sel);
  const b = document.createElement('button'); b.type = 'button';
  b.className = sel.className.replace(/\bhidden\b/g, '') + (sel.dataset.compact !== undefined ? ' justify-between gap-2 text-start' : ' ddtrig justify-between gap-2 text-start');
  b.setAttribute('dir', sel.closest('[dir]') ? sel.closest('[dir]').getAttribute('dir') : 'rtl');
  b.onclick = ev => { ev.stopPropagation(); openDD(sel, b); };
  sel.insertAdjacentElement('afterend', b); sel._btn = b; sel.classList.add('hidden');
  const j = sel.parentElement; if (j && j.classList.contains('join')){ b.classList.add('join-item'); j.after(sel); }   // rounding follows the visible button
  sel.addEventListener('change', () => { refreshEnh(sel); noteRecent(sel.dataset.recent, sel.value); });
  refreshEnh(sel);
}
function refreshEnh(sel){ if (!sel._btn) return; const o = sel.options[sel.selectedIndex]; sel._btn.innerHTML = sel.dataset.compact !== undefined ? `<span class="min-w-0 flex-1 truncate" dir="auto">${o ? escapeHtml(o.text.split(' — ')[0]) : ''}</span>` : `<span class="ddlbl min-w-0 flex-1">${o ? escapeHtml(o.text) : ''}</span>`; }
function closeDD(){ const m = $('ddMenu'); m.classList.add('hidden'); m._sel = null; }
function openDD(sel, b){
  const m = $('ddMenu'); if (m._sel === sel && !m.classList.contains('hidden')) return closeDD(); const host = b.closest('dialog[open]') || document.body; if (m.parentElement !== host) host.appendChild(m); m._sel = sel; m.dir = b.getAttribute('dir') || 'rtl';
  const opts = [...sel.options], recent = (RECENT[sel.dataset.recent] || []).map(v => opts.find(o => o.value === v && !o.disabled)).filter(Boolean);
  const row = o => `<li class="flex flex-row items-center gap-0.5" data-v="${escapeHtml(o.value)}"><a class="min-w-0 flex-1 ${o.selected ? 'menu-active' : ''}" data-pick="${escapeHtml(o.value)}"><span class="whitespace-normal break-words">${escapeHtml(o.text)}</span></a>`
    + (sel.dataset.preview !== undefined && o.value !== '' ? `<button class="ddb opacity-80 hover:opacity-100" data-pv="${escapeHtml(o.value)}" data-tip="شنیدنِ صدا" data-tip-en="Hear the voice"><svg class="size-3.5"><use href="#i-play"/></svg></button>` : '')
    + (o.dataset.pin !== undefined ? `<button class="ddb ${o.dataset.pinned !== undefined ? 'text-primary' : 'opacity-50'}" data-pin="${escapeHtml(o.value)}" data-tip="${o.dataset.pinned !== undefined ? 'پیش‌فرض' : 'پیش‌فرض کن'}" data-tip-en="${o.dataset.pinned !== undefined ? 'Default' : 'Make default'}"><svg class="size-3.5"><use href="#i-${o.dataset.pinned !== undefined ? 'pin' : 'pin-off'}"/></svg></button>` : '')
    + (o.dataset.del !== undefined ? `<button class="ddb opacity-60 hover:text-error" data-del="${escapeHtml(o.value)}" data-tip="حذف" data-tip-en="Delete"><svg class="size-3.5"><use href="#i-trash-2"/></svg></button>` : '') + '</li>';
  const body = [];
  if (recent.length) body.push(`<li class="menu-title">${T('اخیراً', 'Recent')}</li>`, ...recent.map(o => row(o).replace('</li>', `<button class="ddb opacity-60 hover:text-error" data-unrecent="${escapeHtml(o.value)}" data-tip="حذف از اخیراً" data-tip-en="Remove from recent"><svg class="size-3.5"><use href="#i-x"/></svg></button></li>`)));
  let group = null;
  opts.forEach(o => { const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null;
    if (g !== group){ group = g; if (g) body.push(`<li class="menu-title">${escapeHtml(g)}</li>`); }
    body.push(o.disabled ? `<li class="menu-title">${escapeHtml(o.text)}</li>` : row(o)); });
  const acts = (sel._actions || []).map(([icon, fa, en], k) => `<li class="${k ? '' : 'mt-1 border-t border-base-300 pt-1'}"><a data-act="${k}" class="gap-2"><svg class="size-4"><use href="#i-${icon}"/></svg>${T(fa, en)}</a></li>`).join(''); 
 const search = opts.length > 12 ? `<div class="sticky top-0 z-10 bg-base-200 p-1"><input class="input input-sm w-full" dir="auto" placeholder="${T('جست‌وجو…', 'Search…')}" oninput="filterDD(this.value)"></div>` : '';
  m.innerHTML = search + `<ul class="menu menu-sm w-full p-1">${body.join('')}</ul>` + (acts ? `<div class="sticky bottom-0 z-10 border-t border-base-300 bg-base-200 p-1"><ul class="menu menu-sm w-full p-0">${acts.replace(/mt-1 border-t border-base-300 pt-1/, '')}</ul></div>` : '');   // 167: the actions stay in view
  m.classList.remove('hidden');
  const r = b.getBoundingClientRect(), w = Math.min(Math.max(r.width, 260), 460, innerWidth - 16);
  m.style.width = w + 'px'; m.style.maxHeight = Math.min(380, Math.max(160, Math.max(innerHeight - r.bottom, r.top) - 16)) + 'px';
  const rtl = m.dir === 'rtl'; m.style.left = Math.max(8, Math.min(innerWidth - w - 8, rtl ? r.right - w : r.left)) + 'px';
  const below = innerHeight - r.bottom >= Math.min(260, m.scrollHeight) || innerHeight - r.bottom > r.top;
  m.style.top = (below ? r.bottom + 4 : Math.max(8, r.top - 4 - Math.min(m.scrollHeight, parseFloat(m.style.maxHeight)))) + 'px';
  const s0 = m.querySelector('input'); if (s0) setTimeout(() => s0.focus(), 0);
  m.onclick = ev => {
    const p = ev.target.closest('[data-pick]'), pin = ev.target.closest('[data-pin]'), del = ev.target.closest('[data-del]');
    const act = ev.target.closest('[data-act]'); if (act){ ev.stopPropagation(); const f = (sel._actions || [])[+act.dataset.act]; closeDD(); if (f) f[3](); return; }
 const ur = ev.target.closest('[data-unrecent]'); if (ur){ ev.stopPropagation(); const k = sel.dataset.recent; RECENT[k] = (RECENT[k] || []).filter(x => x !== ur.dataset.unrecent); try { API().settings_set({ ed_recent: RECENT }); } catch (e) {} openDD(sel, sel._btn); openDD(sel, sel._btn); return; }
    const pv = ev.target.closest('[data-pv]'); if (pv){ ev.stopPropagation(); if (sel._preview) sel._preview(pv.dataset.pv); return; }
    if (pin){ ev.stopPropagation(); if (sel._onPin) sel._onPin(pin.dataset.pin); closeDD(); return; }
    if (del){ ev.stopPropagation(); if (sel._onDel) sel._onDel(del.dataset.del); closeDD(); return; }
    if (p){ sel.value = p.dataset.pick; sel.dispatchEvent(new Event('change', { bubbles: true })); closeDD(); }
  };
  m.onkeydown = ev => {
    const items = [...m.querySelectorAll('li:not(.hidden) [data-pick]')], i = items.indexOf(document.activeElement);
    if (ev.key === 'Escape'){ closeDD(); b.focus(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){ ev.preventDefault(); const n = items[(i + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; n && (n.tabIndex = 0, n.focus()); }
    else if (ev.key === 'Enter' && i >= 0){ ev.preventDefault(); items[i].click(); }
  };
}
function filterDD(q){ q = q.trim().toLowerCase(); $('ddMenu').querySelectorAll('li[data-v]').forEach(li => li.classList.toggle('hidden', !!q && !li.textContent.toLowerCase().includes(q))); }
document.addEventListener('pointerdown', e => { const m = $('ddMenu'); if (!m.classList.contains('hidden') && !m.contains(e.target) && !(m._sel && m._sel._btn && m._sel._btn.contains(e.target))) closeDD(); });

// =====================================================================================
// 159 · MUSIC — library + providers + Lyria as tabs, style chips that search at once,
//   pages, ONE shared preview player (only one plays; it stops when the dialog closes)
// =====================================================================================
let mTab = 'library', mPage = 1, mStyle = 'ambient', MUSIC_HITS = [], MUSIC_LIB = [], MUSIC_STYLES = [];
const PREV = new Audio(); let prevKey = null;
function stopPreview(){ try { PREV.pause(); } catch (e) {} prevKey = null; document.querySelectorAll('[data-prev]').forEach(b => b.innerHTML = '<svg class="size-4"><use href="#i-play"/></svg>'); }
function togglePreview(key, src){
  if (prevKey === key && !PREV.paused){ stopPreview(); return; }
  stopPreview(); prevKey = key; PREV.src = src; PREV.play().catch(() => {});
  const b = document.querySelector(`[data-prev="${key}"]`); if (b) b.innerHTML = '<svg class="size-4"><use href="#i-pause"/></svg>';
}
PREV.onended = stopPreview;
const PROV_LABEL = v => ({ library: T('کتابخانهٔ من', 'My library') })[v] || (MUSIC_PROVIDERS.find(p => p[0] === v) || [v, v])[1].split(' — ')[0];
async function openMusic(){
  if (!MUSIC_STYLES.length){ try { const r = await API().music_presets(); MUSIC_STYLES = (r && r.presets) || []; } catch (e) {} }
  $('mTabs').innerHTML = ['library', ...MUSIC_PROVIDERS.map(p => p[0])].map(v => `<a role="tab" class="tab ${v === mTab ? 'tab-active' : ''}" onclick="musicTab('${v}')">${escapeHtml(PROV_LABEL(v))}</a>`).join('');
  $('musicDlg').showModal(); musicTab(mTab);
}
function musicTab(v){
  mTab = v; stopPreview();
  [...$('mTabs').children].forEach((a, i) => a.classList.toggle('tab-active', ['library', ...MUSIC_PROVIDERS.map(p => p[0])][i] === v));
  const lib = v === 'library', lyria = v === 'lyria';
  $('mSearchRow').classList.toggle('hidden', lib || lyria); $('mStyles').classList.toggle('hidden', lib);
  $('mLyria').classList.toggle('hidden', !lyria); $('mLyria').classList.toggle('flex', lyria); $('mPager').classList.add('hidden');
  $('mStyles').innerHTML = MUSIC_STYLES.map(st => `<button class="btn btn-xs rounded-full ${st === mStyle ? 'btn-primary' : 'border-base-content/15 bg-base-100'}" onclick="pickStyle('${escapeHtml(st)}')">${escapeHtml(styleLabel(st))}</button>`).join('');
  if (lib) return loadMusicLib();
  if (!lyria) searchMusic(1); else $('musicResults').innerHTML = '';
}
const styleLabel = st => T(({ ambient: 'آرام و فضایی', piano: 'پیانو', cinematic: 'سینمایی', podcast: 'پادکست', news: 'خبری', corporate: 'رسمی', lofi: 'لوفای', acoustic: 'آکوستیک', electronic: 'الکترونیک', orchestral: 'ارکسترال', persian: 'ایرانی', upbeat: 'شاد', sad: 'غمگین', epic: 'حماسی', calm: 'آرام' })[st] || st, st);
function pickStyle(st){ mStyle = st; musicTab(mTab); }
async function loadMusicLib(){
  const r = await API().music_list(); MUSIC_LIB = (r && r.items) || [];
  $('musicResults').innerHTML = MUSIC_LIB.length ? MUSIC_LIB.map((it, k) => musicRow('lib' + k, it.title || it.name || it.file, [it.seconds ? num(Math.round(it.seconds)) + T(' ثانیه', ' s') : '', it.credit || it.license || ''],
      `musicPreviewLib(${k})`, `useLib(${k})`, `delLib(${k})`)).join('')
    : `<li class="p-4 text-sm text-base-content/60">${T('هنوز موسیقی‌ای در کتابخانه نیست؛ از زبانه‌های دیگر پیدا کنید یا فایلی وارد کنید.', 'No music yet; find some in the other tabs or import a file.')}</li>`;
}
function musicRow(key, title, meta, onPrev, onUse, onDel){
  return `<li class="list-row items-center py-2"><button class="btn btn-ghost btn-sm btn-circle" data-prev="${key}" onclick="${onPrev}" aria-label="preview"><svg class="size-4"><use href="#i-play"/></svg></button>
    <div class="min-w-0"><div class="truncate text-sm" dir="auto">${escapeHtml(title || '')}</div><div class="truncate text-xs text-base-content/60" dir="auto">${escapeHtml(meta.filter(Boolean).join(' · '))}</div></div>
    <div class="flex gap-1">${onDel ? `` : ''}<button class="btn btn-sm border-base-content/15 bg-base-100" onclick="${onUse}">${T('استفاده', 'Use')}</button></div></li>`;
}
async function musicPreviewLib(k){ const it = MUSIC_LIB[k]; if (prevKey === 'lib' + k && !PREV.paused) return stopPreview(); const r = await API().music_load(it.file); if (r && r.ok && r.b64) togglePreview('lib' + k, URL.createObjectURL(b64Blob(r.b64, 'audio/mpeg'))); }
async function useLib(k){ const it = MUSIC_LIB[k], r = await API().music_load(it.file); if (!r || !r.ok) return say((r && r.error) || '', 'err'); S.music.credit = it.credit || ''; await setMusicTrack(r.b64, it.file, it.title || it.file); $('musicDlg').close(); focusMusic(); }
async function delLib(k){ const it = MUSIC_LIB[k]; const r = await API().music_delete(it.file); if (r && r.ok) loadMusicLib(); }
async function searchMusic(page){
  if (mTab === 'library' || mTab === 'lyria') return; page = Math.max(1, page || 1);
  $('musicResults').innerHTML = `<li class="p-4 text-sm text-base-content/60">${T('در حال جست‌وجو…', 'Searching…')}</li>`;
  try {
    const r = await API().music_search(mTab, $('mQuery').value.trim(), '', mStyle, page); if (!r.ok) throw new Error(r.error || '');
    MUSIC_HITS = r.items || []; mPage = r.page || page;
    $('musicResults').innerHTML = MUSIC_HITS.length ? MUSIC_HITS.map((it, k) => musicRow('hit' + k, it.title, [it.author, it.seconds ? num(Math.round(it.seconds)) + T(' ثانیه', ' s') : '', it.license], `togglePreview('hit${k}', MUSIC_HITS[${k}].preview)`, `chooseHit(${k})`)).join('')
      : `<li class="p-4 text-sm text-base-content/60">${T('چیزی پیدا نشد؛ سبک یا واژهٔ دیگری امتحان کنید.', 'Nothing found; try another style or word.')}</li>`;
    $('mPager').classList.toggle('hidden', !(mPage > 1 || r.has_more)); $('mPager').classList.toggle('flex', mPage > 1 || !!r.has_more);
    $('mPageNo').textContent = T('صفحهٔ ', 'Page ') + num(mPage); $('mPrev').disabled = mPage <= 1; $('mNext').disabled = !r.has_more;
  } catch (e) { $('musicResults').innerHTML = `<li class="p-4 text-sm text-error">${escapeHtml(e.message || String(e))}</li>`; }
}
async function chooseHit(k){
  stopPreview(); setBusy(true);
  try { const r = await API().music_fetch(mTab, MUSIC_HITS[k]); if (!r.ok) throw new Error(r.error || '');
    const e = r.entry || {}; S.music.credit = r.credit || ''; await setMusicTrack(r.b64, e.file, e.title || MUSIC_HITS[k].title || e.file); $('musicDlg').close(); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
async function generateMusic(){
  stopPreview(); setBusy(true); say(T('موسیقی ساخته می‌شود…', 'Making music…'), 'ok');
  try { const r = await API().music_generate(mStyle, $('mCustom').value.trim(), +$('mSecs').value); if (!r.ok) throw new Error(r.error || '');
    S.music.credit = 'Lyria'; await setMusicTrack(r.b64, null, 'Lyria — ' + styleLabel(mStyle)); $('musicDlg').close(); focusMusic(); say(T('موسیقی ساخته شد.', 'Music made.'), 'ok'); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}

// =====================================================================================
// 159 · WORD-PRECISE mapping between a clip's time and its line's characters
// =====================================================================================
// the word times describe the AUDIO; they stay valid while the words still sit where they were (a voice-setting change does not move them)
function clipWords(c, text){
  if (!(c && c.words && c.words.length && c.lines.length === 1)) return null;
  if (c.words.every(w => text.slice(w.c0, w.c1) === w.w)) return c.words;
  // diacritics added or cleared: the same words, at new positions — re-locate them by their letters
  const sk = x => x.replace(/[\u064B-\u0655\u0670\u200c\u200d]/g, ''), toks = [...text.matchAll(/\S+/g)];
  if (toks.length !== c.words.length || !toks.every((m, i) => sk(m[0]) === sk(c.words[i].w))) return null;
  return c.words.map((w, i) => ({ ...w, w: toks[i][0], c0: toks[i].index, c1: toks[i].index + toks[i][0].length }));
}
function timeToChar(c, text, t){             // t = time inside the gulp
  const W = clipWords(c, text); if (!W){ const D = (c.src ? c.src[1] - c.src[0] : dur(c)), s0 = c.src ? c.src[0] : c.in; return Math.round(Math.min(1, Math.max(0, (t - s0) / D)) * text.length); }
  for (const w of W){ if (t < w.t0) return w.c0; if (t <= w.t1) return Math.round(w.c0 + (w.c1 - w.c0) * (t - w.t0) / Math.max(0.01, w.t1 - w.t0)); }
  return text.length;
}
function trimSpan(text, c){
  if (!c || c.lines.length !== 1 || (!c.trimIn && !c.trimOut)) return [0, text.length];
  const W = clipWords(c, text);
  if (!W){ const D = dur(c) + (c.trimIn || 0) + (c.trimOut || 0), L = text.length; return [Math.round((c.trimIn || 0) / D * L), L - Math.round((c.trimOut || 0) / D * L)]; }
  const first = W.find(w => w.t1 > c.in + 0.03), last = [...W].reverse().find(w => w.t0 < c.out - 0.03);
  return [first ? first.c0 : text.length, last ? last.c1 : 0];
}
function splitClip(){
  const [, c] = findClip(selClip); if (!c || c.lines.length !== 1 || c.unvoiced || playhead <= c.at + 0.15 || playhead >= c.at + dur(c) - 0.15) return;
  remember(); const id = c.lines[0], L = S.lines[id], tg = c.in + (playhead - c.at), W = clipWords(c, L.text);
  let at, tt;
  if (W){ let best = null; for (let i = 0; i < W.length - 1; i++){ const b = (W[i].t1 + W[i + 1].t0) / 2; if (!best || Math.abs(b - tg) < Math.abs(best.b - tg)) best = { b, at: W[i].c1 }; }
    if (!best) return; at = best.at; tt = c.at + (best.b - c.in); }
  else { const D = dur(c) + (c.trimIn || 0) + (c.trimOut || 0); at = Math.round((playhead - c.at + (c.trimIn || 0)) / D * L.text.length); const sp = L.text.lastIndexOf(' ', at), sp2 = L.text.indexOf(' ', at);
    at = sp2 >= 0 && (sp < 0 || sp2 - at < at - sp) ? sp2 : (sp >= 0 ? sp : at); tt = c.at - (c.trimIn || 0) + at / Math.max(1, L.text.length) * D; }
  selClip = null; sliceAt(c, id, at, tt);
}
function sliceAt(c, id, at, tt){
  const W = c.words, text = S.lines[id].text, off = at + (text.slice(at).length - text.slice(at).trimStart().length);
  sliceAt0(c, id, at, tt);
  if (W){ const n = speechClips().find(x => x.gulp === c.gulp && Math.abs(x.at - tt) < 1e-6 && x !== c);
    c.words = W.filter(w => w.c1 <= at); if (n) n.words = W.filter(w => w.c0 >= off).map(w => ({ ...w, c0: w.c0 - off, c1: w.c1 - off })); }
}
function updatePCaret(){
  const pc = $('pcaret'); if (!pc) return;
  const here = speechClips().filter(c => !c.unvoiced && c.at <= playhead && playhead < c.at + dur(c)).sort((a, b) => b.at - a.at)[0];
  if (!here){ pc.classList.add('hidden'); return; }
  let id = here.lines[0], pos;
  if (here.lines.length === 1) pos = timeToChar(here, S.lines[id].text || '', here.in + (playhead - here.at));
  else { const lens = here.lines.map(x => Math.max(1, (S.lines[x].text || '').length)), tot = lens.reduce((a, b) => a + b, 0);
    let p = (playhead - here.at) / dur(here) * tot, k = 0; while (k < lens.length - 1 && p > lens[k]){ p -= lens[k]; k++; } id = here.lines[k]; pos = Math.round(p); }
  const lt = document.querySelector(`#editor .ln[data-id="${id}"] .lt`); if (!lt){ pc.classList.add('hidden'); return; }
  const w = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); let node, left = pos;
  while ((node = w.nextNode())){ if (left <= node.length) break; left -= node.length; }
  if (!node){ pc.classList.add('hidden'); return; }
  const rg = document.createRange(); rg.setStart(node, Math.min(left, node.length)); rg.collapse(true);
  const r = rg.getBoundingClientRect(), host = $('editor').getBoundingClientRect();
  if (!r.height){ pc.classList.add('hidden'); return; }
  pc.style.left = (r.left - host.left + $('editor').scrollLeft) + 'px'; pc.style.top = (r.top - host.top + $('editor').scrollTop) + 'px'; pc.style.height = r.height + 'px'; pc.classList.remove('hidden');
}

// =====================================================================================
// 159 · DIACRITIZE the selected lines only (all lines when none is selected)
// =====================================================================================
async function diacritize(onlySel){
  const all = orderedLines(), ids = (onlySel || sel.size) && sel.size ? all.filter(id => sel.has(id)) : all, text = ids.map(id => S.lines[id].text).join('\n');
  if (!text.trim()){ say(T('اول یک متن فارسی بنویسید یا بچسبانید.', 'Type or paste a Persian text first.'), 'err'); return; }
  if (busy) return; setBusy(true); say(ids.length < all.length ? T(`دارم ${FA(ids.length)} خطِ انتخاب‌شده را حرکت‌گذاری می‌کنم…`, `Diacritizing ${ids.length} selected line(s)…`) : T('دارم حرکت‌ها را می‌گذارم…', 'Adding diacritics…'), 'ok');
  try {
    const r = await API().ezafe(text, $('ezTool').value, ''); if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
    const out = r.text.split('\n'); if (out.length !== ids.length) throw new Error(T('حرکت‌گذاری تعدادِ خط‌ها را عوض کرد؛ چیزی تغییر داده نشد.', 'Diacritization changed the number of lines; nothing was changed.'));
    remember(); ids.forEach((id, k) => { const L = S.lines[id]; if (out[k] !== L.text){ L.text = out[k]; const [, c] = clipOfLine(id); if (c && !c.unvoiced) L.dirty = true; } });
    renderScript(); autosave(); say(T('حرکت‌های پیشنهادی توی متن گذاشته شد؛ قبل از ساختن گفتار می‌توانید دستکاری‌شان کنید.', 'Suggested diacritics are in the text; you can adjust them before voicing.'), 'ok');
  } catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}


// =====================================================================================
// 159 · VOICES (Google 3.8): the voice menu, the Extended Voice Library, design, cloning,
//        characters; pins on engine + model; Fish voice groups + library/clone/design;
//        Chatterbox samples you can delete; connection + quota; new document / save text
// =====================================================================================
let LIBV = [], DESIGNS = [], CLONES = [], CONSENT = '', FISH_USED = [], FISH_DESIGNED = [], DEFAULTS = {}, libTarget = 'proj', libNext = '', libHits = [], clPick = {}, flPage = 1, flHits = [], fdCands = [];
const b64Blob = (b64, type) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return new Blob([u8], { type }); };
const is38 = () => /3\.8/.test(S.proj.g_model);
async function loadG38Lists(){
  try { const r = await API().g38_designs(); DESIGNS = (r && r.designs) || []; } catch (e) {}
  try { const r = await API().g38_clones(); CLONES = (r && r.clones) || []; CONSENT = (r && r.consent) || ''; } catch (e) {}
}
function voiceOptions(cur, withProj){
  const o = (v, l, extra = '') => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''} ${extra}>${escapeHtml(l)}</option>`;
  let html = withProj ? `<option value="">${T('— مثلِ پروژه —', '— as the project —')}</option>` : '';
  html += `<optgroup label="${T('صداهای آمادهٔ گوگل', "Google's prebuilt voices")}">` + G_VOICES.map(([v, l]) => o(v, `${v} — ${l}`)).join('') + '</optgroup>';
  if (is38()){
    if (LIBV.length) html += `<optgroup label="${T('از کتابخانه', 'From the library')}">` + LIBV.map(v => o('lib:' + v.id, v.name, 'data-del')).join('') + '</optgroup>';
    if (DESIGNS.length) html += `<optgroup label="${T('طراحی‌شده', 'Designed')}">` + DESIGNS.map(d => o('design:' + d.id, d.name)).join('') + '</optgroup>';
    if (CLONES.length) html += `<optgroup label="${T('شبیه‌سازی‌شده', 'Cloned')}">` + CLONES.map(c => o('clone:' + c.id, c.name, 'data-del')).join('') + '</optgroup>';
  }
  return html;
}
async function delVoice(v){
  if (v.startsWith('lib:')){ LIBV = LIBV.filter(x => 'lib:' + x.id !== v); try { await API().settings_set({ ed_lib_voices: LIBV }); } catch (e) {} }
  else if (v.startsWith('design:')){ await API().g38_design_delete({ id: v.slice(7) }); await loadG38Lists(); }
  else if (v.startsWith('clone:')){ await API().g38_clone_delete({ id: v.slice(6) }); await loadG38Lists(); }
  if (S.proj.g_voice === v) S.proj.g_voice = 'Charon'; fillInspector(); autosave();
}
function fillExtras(){
  document.querySelectorAll('.g38only').forEach(el => el.classList.toggle('hidden', !is38()));
  const pv = $('pVoice'); pv.innerHTML = voiceOptions(S.proj.g_voice, false); pv._onDel = delVoice; refreshEnh(pv);
  // pins: the engine and the Google model can be made the default, as in the classic interface
  [...$('pEngine').options].forEach(o => { o.dataset.pin = ''; if (o.value === DEFAULTS.engine) o.dataset.pinned = ''; else delete o.dataset.pinned; });
  $('pEngine')._onPin = async v => { DEFAULTS.engine = v; try { await API().settings_set({ default_engine: v }); } catch (e) {} say(T('موتورِ پیش‌فرض: ', 'Default engine: ') + ($('pEngine').selectedOptions[0] || {}).text, 'ok'); fillInspector(); };
  [...$('pModel').options].forEach(o => { o.dataset.pin = ''; if (o.value === DEFAULTS.model) o.dataset.pinned = ''; else delete o.dataset.pinned; });
  $('pModel')._onPin = async v => { DEFAULTS.model = v; try { await API().settings_set({ default_g_model: v }); } catch (e) {} say(T('مدلِ پیش‌فرضِ گوگل: ', 'Default Google model: ') + v, 'ok'); fillInspector(); };
  // Chatterbox samples you added can be deleted
  const cv = $('cbxVoice'); /* 164: bundled voices are never deletable — only your samples carry data-del (cbxOptions) */
  cv._onDel = async id => { const r = await API().cbx_voice_delete(id); if (r && r.ok){ if (S.proj.cbx.voice === id) S.proj.cbx.voice = 'default'; await loadEngineLists(); fillInspector(); } else say((r && r.error) || '', 'err'); };
  // Fish voices: default + yours + recently used + designed (the classic groups)
  const f = S.proj.fish, fo = (v, l, d) => `<option value="${escapeHtml(v)}" ${v === f.voice ? 'selected' : ''} ${d ? 'data-del' : ''}>${escapeHtml(l)}</option>`;
  $('fishVoice').innerHTML = fishOptions(f.voice);   // 164: the classic nested view, restored
  $('fishVoice')._onDel = async id => {
    if (FISH_VOICES.some(v => (v._id || v.id) === id)){ const r = await API().fish_delete_voice(id); if (!(r && r.ok)) return say((r && r.error) || '', 'err'); await loadEngineLists(); }
    FISH_USED = FISH_USED.filter(v => v.id !== id); FISH_DESIGNED = FISH_DESIGNED.filter(v => v.id !== id);
    try { await API().settings_set({ fish_used: FISH_USED, fish_designed: FISH_DESIGNED }); } catch (e) {}
    if (f.voice === id) f.voice = 'default'; fillInspector(); };
  refreshEnh($('fishVoice'));
  renderCast(); fillExtras2();
}
function rememberFish(id, title, designed){ const list = designed ? FISH_DESIGNED : FISH_USED; const i = list.findIndex(v => v.id === id); if (i >= 0) list.splice(i, 1); list.unshift({ id, title: title || id }); if (list.length > 30) list.pop(); try { API().settings_set({ fish_used: FISH_USED, fish_designed: FISH_DESIGNED }); } catch (e) {} }
// ---- the Extended Voice Library
function openLib(target){ libTarget = target; $('libDlg').showModal(); if (!libHits.length) libSearch(); }
async function libSearch(more){
  if (!more){ libNext = ''; libHits = []; $('lbList').innerHTML = `<li class="p-4 text-sm text-base-content/60">${T('در حال جست‌وجو…', 'Searching…')}</li>`; }
  const f = { language_code: $('lbLang').value ? $('lbLang').value.split(',') : [], gender: $('lbGender').value ? [$('lbGender').value] : [], pitch: $('lbPitch').value ? [$('lbPitch').value] : [],
              contexts: $('lbCtx').value ? [$('lbCtx').value] : [], search: $('lbSearch').value.trim(), page_size: 60 };
  const r = await API().g38_voices({ filters: f, page_token: more ? libNext : '' });
  if (!r || !r.ok){ $('lbList').innerHTML = `<li class="p-4 text-sm text-error">${escapeHtml((r && r.error) || '')}</li>`; return; }
  libHits = libHits.concat(r.voices || []); libNext = r.next || '';
  $('lbNote').classList.toggle('hidden', !r.fell_back); $('lbNote').textContent = T('صدایی با این زبان در کتابخانه برچسب نخورده؛ همهٔ صداها نشان داده می‌شوند — مدل زبانِ متن را خودش تشخیص می‌دهد.', 'No voices are tagged with this language; showing the whole library — the model detects the text language itself.');
  $('lbList').innerHTML = libHits.length ? libHits.map((v, k) => `<li class="list-row items-center py-2"><button class="btn btn-ghost btn-sm btn-circle" data-prev="lv${k}" onclick="libPreview(${k})" aria-label="preview"><svg class="size-4"><use href="#i-play"/></svg></button>
      <div class="min-w-0"><div class="truncate text-sm" dir="auto">${escapeHtml(v.name || v.id)}</div><div class="truncate text-xs text-base-content/60" dir="auto">${escapeHtml([v.language, v.accent, v.gender, v.pitch, v.description].filter(Boolean).join(' · '))}</div></div>
      <button class="btn btn-sm border-base-content/15 bg-base-100" onclick="libPick(${k})">${T('انتخاب', 'Choose')}</button></li>`).join('')
    : `<li class="p-4 text-sm text-base-content/60">${T('چیزی پیدا نشد.', 'Nothing found.')}</li>`;
  $('lbMore').classList.toggle('hidden', !libNext);
}
async function libPreview(k){
  if (prevKey === 'lv' + k && !PREV.paused) return stopPreview();
  say(T('نمونه ساخته می‌شود…', 'Making a sample…'), 'ok');
  const v = libHits[k], r = await API().g38_preview({ voice: 'lib:' + v.id, style: '', text: T('سلام؛ این نمونه‌ای از صدای من است.', 'Hello; this is a sample of my voice.'), cfg: { ...gFields(lineVoice(orderedLines()[0] || 0)), g38_cast: [] } });
  if (!r || !r.ok) return say((r && r.error) || T('نمونه ساخته نشد.', 'Could not make a sample.'), 'err');
  say('', 'ok'); togglePreview('lv' + k, URL.createObjectURL(b64Blob(r.b64, 'audio/mpeg')));
}
async function libPick(k){
  const v = libHits[k]; if (!LIBV.some(x => x.id === v.id)){ LIBV.unshift({ id: v.id, name: v.name || v.id }); LIBV = LIBV.slice(0, 40); try { await API().settings_set({ ed_lib_voices: LIBV }); } catch (e) {} }
  const val = 'lib:' + v.id; stopPreview(); $('libDlg').close();
  if (libTarget === 'proj') setProj('g_voice', val);
  else if (libTarget === 'line') setLineOpt('gVoice', val);
  else if (String(libTarget).startsWith('cast:')){ CAST[+libTarget.slice(5)].voice = val; saveCast(); }
  noteRecent('gvoice', val); fillInspector();
}
// ---- design and cloning
async function createDesign(){
  const name = $('dsName').value.trim(), prompt = $('dsPrompt').value.trim(); if (!prompt) return say(T('توضیحِ صدا را بنویسید.', 'Describe the voice.'), 'err');
  setBusy(true); say(T('صدا طراحی می‌شود…', 'Designing the voice…'), 'ok');
  try { const r = await API().g38_design({ name, prompt, gender: $('dsGender').value }); if (!r.ok) throw new Error(r.error || '');
    await loadG38Lists(); $('designDlg').close(); setProj('g_voice', 'design:' + r.design.id); say(T('صدا طراحی و انتخاب شد.', 'Voice designed and selected.'), 'ok'); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
function openClone(){ clPick = {}; $('clRef').textContent = ''; $('clCon').textContent = ''; $('clConsent').textContent = CONSENT; $('cloneDlg').showModal(); }
async function pickClone(kind){ const r = await API().g38_pick_audio({ kind }); if (!r || !r.ok) return; clPick[kind] = r; $(kind === 'ref' ? 'clRef' : 'clCon').textContent = (r.name || '') + (r.seconds ? ` — ${num(Math.round(r.seconds))} ${T('ثانیه', 's')}` : ''); }
async function createClone(){
  if (!clPick.ref || !clPick.consent) return say(T('هر دو فایل لازم است.', 'Both files are needed.'), 'err');
  setBusy(true); try { const r = await API().g38_clone_create({ name: $('clName').value.trim(), ref: clPick.ref, consent: clPick.consent }); if (!r.ok) throw new Error(r.error || '');
    await loadG38Lists(); $('cloneDlg').close(); setProj('g_voice', 'clone:' + r.clone.id); if (r.clone.note) say(r.clone.note, 'ok'); else say(T('صدا ذخیره و انتخاب شد.', 'Voice saved and selected.'), 'ok'); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
// ---- characters (a line «Name: …» is read in that character's voice)
function saveCast(){ try { API().settings_set({ g38_cast: CAST }); } catch (e) {} renderCast(); markDirty(id => /^[^:：]{1,24}[:：]/.test(S.lines[id].text || '')); renderScript(); autosave(); }
function addCast(){ CAST.push({ name: '', voice: 'Charon', style: '' }); renderCast(); }
function renderCast(){
  const box = $('castList'); if (!box) return;
  box.innerHTML = CAST.map((c, i) => `<div class="flex items-center gap-1.5" data-i="${i}"><input class="input input-xs w-24" dir="auto" value="${escapeHtml(c.name || '')}" placeholder="${T('نام', 'Name')}" onchange="CAST[${i}].name = this.value.trim(); saveCast()">
      <select class="select select-xs min-w-0 flex-1" data-recent="gvoice" onchange="CAST[${i}].voice = this.value; saveCast()">${voiceOptions(c.voice, false)}</select>
      <select class="select select-xs w-24" onchange="CAST[${i}].style = this.value; saveCast()"><option value="">${T('— لحن —', '— tone —')}</option>${(typeof G38_TONES !== 'undefined' ? G38_TONES : []).flatMap(g => Array.isArray(g[1]) ? g[1] : [g]).map(t => { const v = Array.isArray(t) ? t[0] : t; return `<option value="${escapeHtml(v)}" ${v === c.style ? 'selected' : ''}>${escapeHtml(Array.isArray(t) ? t[1] || t[0] : t)}</option>`; }).join('')}</select>
      <button class="btn btn-ghost btn-xs btn-square" onclick="openLib('cast:${i}')" data-tip="کتابخانهٔ صداها" data-tip-en="Voice library"><svg class="size-3.5"><use href="#i-library"/></svg></button>
      <button class="btn btn-ghost btn-xs btn-square" onclick="castPreview(${i})" data-tip="شنیدن" data-tip-en="Listen"><svg class="size-3.5"><use href="#i-play"/></svg></button>
      <button class="btn btn-ghost btn-xs btn-square hover:text-error" onclick="CAST.splice(${i}, 1); saveCast()" data-tip="حذف" data-tip-en="Delete"><svg class="size-3.5"><use href="#i-trash-2"/></svg></button></div>`).join('')
    || `<p class="text-xs text-base-content/50">${T('هنوز شخصیتی نیست.', 'No characters yet.')}</p>`;
  box.querySelectorAll('select').forEach(enh);
}
async function castPreview(i){ const c = CAST[i]; say(T('نمونه ساخته می‌شود…', 'Making a sample…'), 'ok');
  const r = await API().g38_preview({ voice: c.voice, style: c.style || '', text: (c.name ? c.name + ': ' : '') + T('سلام؛ این صدای من است.', 'Hello; this is my voice.'), cfg: { ...gFields(lineVoice(orderedLines()[0] || 0)), g38_cast: [] } });
  if (!r || !r.ok) return say((r && r.error) || '', 'err'); say('', 'ok'); togglePreview('cast' + i, URL.createObjectURL(b64Blob(r.b64, 'audio/mpeg'))); }
// ---- Fish: library, cloning, design
function openFishLib(){ $('fishLibDlg').showModal(); if (!flHits.length) fishSearch(1); }
async function fishSearch(page){
  flPage = Math.max(1, page || 1); $('flList').innerHTML = `<li class="p-4 text-sm text-base-content/60">${T('در حال جست‌وجو…', 'Searching…')}</li>`;
  const r = await API().fish_library($('flQuery').value.trim(), '', $('flLang').value, false, $('flSort').value, flPage, '', 'curated');
  if (!r || !r.ok){ $('flList').innerHTML = `<li class="p-4 text-sm text-error">${escapeHtml((r && r.error) || '')}</li>`; return; }
  flHits = r.items || r.voices || [];
  $('flList').innerHTML = flHits.length ? flHits.map((v, k) => { const sample = v.sample || v.preview || (v.samples && v.samples[0] && (v.samples[0].audio || v.samples[0].url)) || '';
      return `<li class="list-row items-center py-2">${sample ? `<button class="btn btn-ghost btn-sm btn-circle" data-prev="fl${k}" onclick="togglePreview('fl${k}', ${escapeHtml(JSON.stringify(sample))})" aria-label="preview"><svg class="size-4"><use href="#i-play"/></svg></button>` : '<span></span>'}
      <div class="min-w-0"><div class="truncate text-sm" dir="auto">${escapeHtml(v.title || v.name || v.id || v._id)}</div><div class="truncate text-xs text-base-content/60" dir="auto">${escapeHtml([(v.author && (v.author.nickname || v.author)) || '', (v.languages || []).join(', '), v.description || ''].filter(Boolean).join(' · '))}</div></div>
      <button class="btn btn-sm border-base-content/15 bg-base-100" onclick="fishPick(${k})">${T('انتخاب', 'Choose')}</button></li>`; }).join('')
    : `<li class="p-4 text-sm text-base-content/60">${T('چیزی پیدا نشد.', 'Nothing found.')}</li>`;
  const more = !!(r.has_more || (r.total && flPage * 20 < r.total));
  $('flPager').classList.toggle('hidden', !(flPage > 1 || more)); $('flPager').classList.toggle('flex', flPage > 1 || more); $('flPageNo').textContent = T('صفحهٔ ', 'Page ') + num(flPage); $('flNext').disabled = !more;
}
function fishPick(k){ const v = flHits[k], id = v._id || v.id; rememberFish(id, v.title || v.name); stopPreview(); $('fishLibDlg').close(); setEng('fishVoice', id); fillInspector(); }
async function fishCloneGo(){
  setBusy(true); try { const r = await API().fish_clone($('fcTitle').value.trim(), $('fcTrans').value.trim(), $('fcEnh').checked); if (!r.ok){ if (r.error !== 'cancelled') throw new Error(r.error || ''); return; }
    await loadEngineLists(); $('fishCloneDlg').close(); if (r.id) setEng('fishVoice', r.id); fillInspector(); say(T('صدا ساخته و انتخاب شد.', 'Voice made and selected.'), 'ok'); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
async function fishDesignGo(){
  const inst = $('fdInst').value.trim(); if (!inst) return say(T('توضیحِ صدا را بنویسید.', 'Describe the voice.'), 'err');
  setBusy(true); say(T('نمونه‌ها ساخته می‌شوند…', 'Making candidates…'), 'ok');
  try { const r = await API().fish_voice_design(inst, $('fdRef').value.trim(), '', 2, 1.0, null); if (!r.ok) throw new Error(r.error || ''); fdCands = r.candidates || [];
    $('fdList').innerHTML = fdCands.map((c, k) => `<li class="list-row items-center py-2"><button class="btn btn-ghost btn-sm btn-circle" data-prev="fd${k}" onclick="togglePreview('fd${k}', URL.createObjectURL(b64Blob(fdCands[${k}].b64 || fdCands[${k}].audio || fdCands[${k}], 'audio/wav')))" aria-label="preview"><svg class="size-4"><use href="#i-play"/></svg></button>
      <div class="text-sm">${T('نمونهٔ ', 'Candidate ')}${num(k + 1)}</div><button class="btn btn-sm border-base-content/15 bg-base-100" onclick="fishKeep(${k})">${T('نگه‌داشتن', 'Keep')}</button></li>`).join(''); say('', 'ok'); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
async function fishKeep(k){
  const c = fdCands[k], title = $('fdInst').value.trim().slice(0, 40); setBusy(true);
  try { const r = await API().fish_design_keep(c.b64 || c.audio || c, title); if (!r.ok) throw new Error(r.error || ''); rememberFish(r.id, title, true); stopPreview(); $('fishDesignDlg').close(); setEng('fishVoice', r.id); fillInspector(); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
// ---- connection and quota
async function openSettings(){
  $('settingsDlg').showModal(); $('netReport').classList.add('hidden');
  try { const r = await API().net_get(); if (r && r.ok){ $('netMode').value = r.mode || 'auto'; refreshEnh($('netMode')); $('netCustom').value = r.custom || ''; $('netCustomRow').classList.toggle('hidden', r.mode !== 'custom'); $('netRoute').textContent = r.route ? T('مسیرِ فعلی: ', 'Current route: ') + r.route : ''; } } catch (e) {}
  try { const q = await API().quota_headroom(); if (q && q.ok) $('quotaLine').textContent = q.total ? T(`از ${FA(q.total)} کلیدِ گوگل، ${FA(q.usable)} کلید هنوز سهمیه دارد.`, `${q.usable} of ${q.total} Google keys still have quota.`) : T('هنوز کلیدِ گوگلی اضافه نشده.', 'No Google keys yet.'); } catch (e) {}
}
async function netSave(){ await API().net_set({ mode: $('netMode').value, custom: $('netCustom').value }); say(T('مسیرِ اتصال ذخیره شد.', 'Route saved.'), 'ok'); netStatus(); }
async function netTest(){ $('netReport').classList.remove('hidden'); $('netReport').textContent = T('در حال آزمایش…', 'Testing…'); await API().net_set({ mode: $('netMode').value, custom: $('netCustom').value });
  const r = await API().net_test(); $('netReport').textContent = (r && r.text) || ''; netStatus(); }
// ---- document
async function saveText(){ const text = orderedLines().map(id => S.lines[id].text).join('\n'); const r = await API().save_text(text, 'txt'); if (r && r.ok) say(T('متن ذخیره شد.', 'Text saved.'), 'ok'); else if (r && r.error && r.error !== 'cancelled') say(r.error, 'err'); }
async function newDoc(){ if (!confirm(T('سندِ فعلی پاک شود و سندِ تازه شروع شود؟', 'Clear the current document and start a new one?'))) return;
  remember(); try { await API().new_document(); } catch (e) {} S.lines = {}; S.tracks.forEach(t => t.clips = []); selClip = null; sel = new Set(); ensureOneLine(); renderScript(); autosave(); }
document.querySelectorAll('#netMode, #lbLang, #lbGender, #lbPitch, #lbCtx, #dsGender, #flLang, #flSort').forEach(el => enh(el));

// 159: after choosing music, land on its settings — the bed clip selected, the music panel open (as before)
function focusMusic(){ const mt = S.tracks.find(t => t.kind === 'music'); if (mt && mt.clips[0]){ selClip = mt.clips[0].id; sel = new Set(); renderTimeline(); showInsp('music'); showMusicInspector(); } autosave(); }


// =====================================================================================
// 160 · PLAYHEAD stays in view: the timeline runs past the last clip; the playhead stops
//       50 px before the end; its time label is never clipped; playback scrolls with it
// =====================================================================================
const tailPx = () => Math.max(160, Math.round(($('tlScroll') || { clientWidth: 800 }).clientWidth * 0.35));
const maxPlayT = () => { const w = parseFloat($('lanes').style.width) || 0; return Math.max(0, (w - PAD - 50) / zoom); };
function seekVisual(t){
  playhead = Math.min(maxPlayT() || Infinity, Math.max(0, t)); const x = PAD + playhead * zoom;
  const ph = $('ph'); if (ph) ph.style.left = x + 'px';
  const pl = $('phLabel'); if (pl){ pl.textContent = num(fmt(playhead)); const host = pl.parentElement, hw = host ? host.scrollWidth || host.clientWidth : 1e6, lw = pl.offsetWidth || 44;
    const rv = $('rulerView'), mL = parseFloat($('ruler').style.marginLeft) || 0, visL = rv ? rv.scrollLeft - mL : 0, visR = rv ? visL + rv.clientWidth : hw;
 pl.style.left = Math.max(visL + 2, Math.min(x - lw / 2, Math.min(visR, hw) - lw - 2)) + 'px'; }   /* 167: centred on the line, held inside the visible ruler */
  const st = $('phStem'); if (st) st.style.left = x + 'px';
  const tb = $('tBtn'); if (tb) tb.textContent = num(fmt(playhead));
  const sc = $('tlScroll'); if (playing && sc && (x > sc.scrollLeft + sc.clientWidth - 70 || x < sc.scrollLeft)) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3);
  updatePCaret(); if (window.onPlayhead) window.onPlayhead(playhead);
}
// ---- keyboard: ←/→ jump 3 s (playing or not) — unless the caret is in a line, where they move the caret; Esc deselects
addEventListener('keydown', e => {
  const t = e.target, typing = t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || document.querySelector('dialog[open]');
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey){
    e.preventDefault(); seek(playhead + (e.key === 'ArrowRight' ? 3 : -3), false); const sc = $('tlScroll'), x = PAD + playhead * zoom;
    if (sc && (x > sc.scrollLeft + sc.clientWidth - 70 || x < sc.scrollLeft + 10)) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.3); return; }
  if (e.key === 'Escape' && !typing && $('ddMenu').classList.contains('hidden')){ sel = new Set(); selClip = null; paintSel(); renderTimeline(); }
});
// ---- per-track volume, live while playing
function setTrackVolume(i, v, el){ const t = S.tracks[i]; t.volume = v; const g = trackGain[t.id]; if (g && AC && !t.muted) g.gain.setValueAtTime(v, AC.currentTime);
  if (el) el.dataset.tip = T('بلندیِ ترک', 'Track volume') + ': ' + Math.round(v * 100) + (lang === 'fa' ? '٪' : '%'); autosave(); }
// ---- export: every unmuted voice track, at its volume; music at its track's volume, off when muted
function timelineSpec(){
  const clips = [];
  S.tracks.forEach(t => { if (t.kind !== 'speech' || t.muted) return; t.clips.forEach(c => { if (!c.unvoiced && c.gulp != null) clips.push({ gulp: c.gulp, in: c.in, out: c.out, at: c.at, gain: t.volume ?? 1 }); }); });
  return { clips };
}
const musicTrack = () => S.tracks.find(t => t.kind === 'music');
async function exportAudio(withMusic){
  document.activeElement && document.activeElement.blur();
  if (withMusic === undefined) withMusic = !!S.music.file || !!S.music.name;          // the default: with music when there is music
  const mt = musicTrack(), mVol = mt ? (mt.volume ?? 1) : 1; if (mt && (mt.muted || mVol <= 0)) withMusic = false;
  if (pending()) say(T(`${FA(pending())} خط تغییر کرده و دوباره ساخته نشده؛ تایم‌لاین همان‌طور که پخش می‌شود ذخیره می‌شود.`, `${pending()} lines are edited and not re-voiced; the timeline is exported as it plays.`), 'ok');
  if (!timelineSpec().clips.length){ say(T('همهٔ ترک‌های گفتار بی‌صدا هستند یا چیزی ساخته نشده.', 'All voice tracks are muted, or nothing is voiced.'), 'err'); return; }
  if (busy) return; setBusy(true);
  try {
    const cfg = withMusic ? { on: true, clips: musicClipsSpec(), file: S.music.file, level_db: S.music.level_db + 20 * Math.log10(Math.max(0.01, mVol)), duck: (S.music.duck_db ?? 12) > 0, duck_db: S.music.duck_db ?? 12, fade_in: S.music.fade_in, fade_out: S.music.fade_out } : null;
    const r = await API().timeline_files(timelineSpec(), cfg); if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
    const sv = await API().save_mp3(withMusic ? r.b64_music : r.b64, withMusic ? 'music' : '');
    if (sv.ok) say(T('ذخیره شد: ', 'Saved: ') + sv.path + ' — ' + num(r.seconds) + T(' ثانیه', ' s') + (withMusic ? T(' — با موسیقی', ' — with music') : T(' — فقط گفتار', ' — voice only')), 'ok');
  } catch (e) { say(isCancel(e) ? T('لغو شد.', 'Cancelled.') : (e.message || String(e)), isCancel(e) ? 'ok' : 'err'); }
  finally { setBusy(false); }
}
// ---- LETTER precision: inside a word, time is spread over its letters by weight
//      (diacritics and joiners take no time; long vowels a little more)
const letterW = ch => /[\u064B-\u0655\u0670\u200c\u200d\s]/.test(ch) ? 0 : (/[اآوی]/.test(ch) ? 1.3 : 1);
function timeToChar(c, text, t){
  const W = clipWords(c, text);
  if (!W){ const D = (c.src ? c.src[1] - c.src[0] : dur(c)), s0 = c.src ? c.src[0] : c.in; return Math.round(Math.min(1, Math.max(0, (t - s0) / D)) * text.length); }
  for (let i = 0; i < W.length; i++){ const w = W[i];
    if (t < w.t0) return w.c0;
    if (t <= w.t1){ const tot = [...text.slice(w.c0, w.c1)].reduce((a, ch) => a + letterW(ch), 0) || 1; let target = (t - w.t0) / Math.max(0.01, w.t1 - w.t0) * tot, k = w.c0;
      while (k < w.c1 && target > 0){ target -= letterW(text[k]); if (target >= 0) k++; } return k; } }
  return text.length;
}
function trimSpan(text, c){
  if (!c || c.lines.length !== 1 || (!c.trimIn && !c.trimOut)) return [0, text.length];
  if (!clipWords(c, text)){ const D = dur(c) + (c.trimIn || 0) + (c.trimOut || 0), L = text.length; return [Math.round((c.trimIn || 0) / D * L), L - Math.round((c.trimOut || 0) / D * L)]; }
  return [c.trimIn ? timeToChar(c, text, c.in) : 0, c.trimOut ? timeToChar(c, text, c.out) : text.length];
}
// ---- 3.8: IPA pronunciation and overlapping reactions
function caretLine(){ const id = sel.size === 1 ? [...sel][0] : lastLine; return id && S.lines[id] ? id : null; }
async function insertIPA(){ const id = caretLine(); if (!id) return say(T('اول در یک خط، کنارِ واژه کلیک کنید.', 'Click next to the word first.'), 'err');
  const ipa = await askText(T('تلفظِ واژه به الفبای آوایی بین‌المللی (IPA)، بدونِ اسلش:', 'The word\'s pronunciation in IPA, without slashes:')); if (ipa && ipa.trim()) insertTag('/' + ipa.trim() + '/'); }
async function insertOverlap(){ const id = caretLine(); if (!id) return say(T('اول در یک خط کلیک کنید.', 'Click in a line first.'), 'err');
  const r = await askText(T('واکنشِ شنونده (مثلاً: آره، واقعاً؟):', 'The listener\'s reaction (e.g. oh really?):')); if (r && r.trim()) insertTag('|' + r.trim() + '|'); }
// ---- Google 3.1 two speakers; Fish custom style, age, state and speakers
function setDuo(path, v){ remember(); const [a, b] = path.split('.'); if (b) S.proj.duo[a][b] = v; else S.proj.duo[a] = v; markDirty(() => true); fillExtras2(); renderScript(); autosave(); }
function setFishOpt(k, v){ remember(); S.proj.fish[k] = v; markDirty(id => lineEngine(id) === 'fish'); fillExtras2(); renderScript(); autosave(); }
const optRows = (rows, cur) => rows.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('');
function fillExtras2(){
  const p = S.proj, f = p.fish, d = p.duo;
  document.querySelectorAll('.g31only').forEach(el => el.classList.toggle('hidden', !/3\.1/.test(p.g_model)));
  $('pCustom').classList.toggle('hidden', p.g_preset !== 'custom'); $('pCustom').value = p.g_style || '';
  renderSpeakers();
  $('fishCustom').classList.toggle('hidden', f.preset !== 'custom'); $('fishCustom').value = f.custom || '';
  const ages = (DIRECTOR.ages || []).map(a => [a[0], a[1]]), states = (DIRECTOR.states || []).map(a => [a[0], a[1]]);
  $('fishAge').innerHTML = optRows(ages, f.age || ''); $('fishState').innerHTML = optRows(states, f.state || ''); enh($('fishAge')); enh($('fishState'));
  $('fishAgeC').classList.toggle('hidden', f.age !== 'custom'); $('fishAgeC').value = f.ageCustom || ''; $('fishStateC').classList.toggle('hidden', f.state !== 'custom'); $('fishStateC').value = f.stateCustom || '';
  addResetButtons(); previewHooks();
}
function addFishSpeaker(){ remember(); (S.proj.fish.speakers = S.proj.fish.speakers || []).push({ name: '', voice: 'default', preset: 'neutral', age: '', state: '' }); renderFishSpk(); autosave(); }
function setFishSpk(i, k, v){ S.proj.fish.speakers[i][k] = v; markDirty(id => lineEngine(id) === 'fish' && /^[^:：]{1,24}[:：]/.test(S.lines[id].text || '')); renderScript(); autosave(); }
function renderFishSpk(){
  const box = $('fishSpk'); if (!box) return; const sp = S.proj.fish.speakers || [];
  const fv = [...$('fishVoice').options].map(o => [o.value, o.text]), ages = (DIRECTOR.ages || []).map(a => [a[0], a[1]]), states = (DIRECTOR.states || []).map(a => [a[0], a[1]]);
  box.innerHTML = sp.map((x, i) => `<div class="grid grid-cols-2 gap-1.5 rounded-field border border-base-300 p-1.5"><input class="input input-xs" dir="auto" value="${escapeHtml(x.name || '')}" placeholder="${T('نام', 'Name')}" onchange="setFishSpk(${i}, 'name', this.value.trim())">
      <select class="select select-xs" onchange="setFishSpk(${i}, 'voice', this.value)">${optRows(fv, x.voice || 'default')}</select>
      <select class="select select-xs" onchange="setFishSpk(${i}, 'preset', this.value)">${optRows(G_PRESETS.map(q => [q[0], q[1]]), x.preset || 'neutral')}</select>
      <select class="select select-xs" onchange="setFishSpk(${i}, 'age', this.value)">${optRows(ages, x.age || '')}</select>
      <select class="select select-xs" onchange="setFishSpk(${i}, 'state', this.value)">${optRows(states, x.state || '')}</select>
      <button class="btn btn-ghost btn-xs gap-1 hover:text-error" onclick="remember(); S.proj.fish.speakers.splice(${i}, 1); renderFishSpk(); autosave()"><svg class="size-3.5"><use href="#i-trash-2"/></svg>${T('حذف', 'Remove')}</button></div>`).join('')
    || `<p class="text-xs text-base-content/50">${T('یک گوینده؛ برای گفت‌وگو گوینده اضافه کنید.', 'One speaker; add speakers for a dialogue.')}</p>`;
  box.querySelectorAll('select').forEach(enh);
}
// ---- the low-quota warning, as in the old editor (once per session)
let quotaWarned = false, quotaTimer = 0;
function scheduleQuota(){ clearTimeout(quotaTimer); quotaTimer = setTimeout(checkQuota, 2500); }
async function checkQuota(){
  if (quotaWarned || S.proj.engine !== 'google') return;
  try { const r = await API().quota_headroom(); if (r && r.ok && r.total >= 2 && r.usable > 0 && r.usable <= Math.min(3, Math.ceil(r.total / 4))){ quotaWarned = true;
    say(T(`از ${FA(r.total)} کلیدِ گوگل، فقط ${FA(r.usable)} کلید هنوز سهمیه دارد؛ اگر کارِ بلندی در پیش دارید، کلیدِ تازه اضافه کنید.`, `Only ${r.usable} of ${r.total} Google keys still have quota; add keys before a long job.`), 'err'); } } catch (e) {}
}
// ---- RESET to default — next to every setting
const RESETS = {
  pEngine: () => setProj('engine', DEFAULTS.engine || 'google'), pModel: () => setProj('g_model', DEFAULTS.model || 'gemini-3.1-flash-tts-preview'),
  pVoice: () => setProj('g_voice', 'Charon'), pPreset: () => { setProj('g_preset', 'neutral'); S.proj.g_style = ''; }, pState: () => setProj('g_state', ''), pAge: () => setProj('g_age', ''), pLang: () => setProj('g_lang', 'fa'),
  cbxVoice: () => setEng('cbxVoice', 'default'), cbxSpeed: () => setEng('cbxSpeed', 1), cbxExag: () => setEng('cbxExag', 0.8), cbxCfg: () => setEng('cbxCfg', 1), cbxTemp: () => setEng('cbxTemp', 0),
  lightSpeed: () => setEng('lightSpeed', 1), lightNoise: () => setEng('lightNoise', 0.667), lightNoiseW: () => setEng('lightNoiseW', 0.8),
  fishModel: () => setEng('fishModel', ((DIRECTOR.fish_models || [])[0] || [''])[0]), fishLatency: () => setEng('fishLatency', 'normal'), fishVoice: () => setEng('fishVoice', 'default'),
  fishPreset: () => { setEng('fishPreset', 'neutral'); S.proj.fish.custom = ''; }, fishSpeed: () => setEng('fishSpeed', 1), fishVolume: () => setEng('fishVolume', 0), fishTemp: () => setEng('fishTemp', 0.7), fishTopP: () => setEng('fishTopP', 0.7),
  fishAge: () => { setFishOpt('age', ''); S.proj.fish.ageCustom = ''; }, fishState: () => { setFishOpt('state', ''); S.proj.fish.stateCustom = ''; },
  mLevel: () => setMusic('level_db', -16), mFadeIn: () => setMusic('fade_in', 1.5), mFadeOut: () => setMusic('fade_out', 1.5), mDuckDb: () => setMusic('duck_db', 12),
  lnEngine: () => setLineOpt('engine', ''), lnVoice: () => setLineOpt('gVoice', ''), lnPreset: () => setLineOpt('gPreset', ''), lnState: () => setLineOpt('gState', '')
};
const SECTION_RESET = {
  engGoogle: () => { Object.assign(S.proj, { g_voice: 'Charon', g_preset: 'neutral', g_state: '', g_age: '', g_lang: 'fa', g_continuity: true, g_style: '', duo: { on: false, a: { name: '', voice: 'Charon' }, b: { name: '', voice: 'Kore' } } }); markDirty(id => lineEngine(id) === 'google'); },
  engCbx: () => { S.proj.cbx = { voice: 'default', speed: 1, exag: 0.8, cfg: 1, temp: 0 }; markDirty(id => lineEngine(id) === 'chatterbox'); },
  engLight: () => { S.proj.light = { speed: 1, noise: 0.667, noisew: 0.8 }; markDirty(id => ['mana', 'gyro', 'amir'].includes(lineEngine(id))); },
  engFish: () => { const sp = S.proj.fish.speakers || []; S.proj.fish = { model: ((DIRECTOR.fish_models || [])[0] || [''])[0], latency: 'normal', voice: 'default', preset: 'neutral', speed: 1, volume: 0, temp: 0.7, top_p: 0.7, cont: true, condPrev: true, normLoud: true, normalize: false, quality: false, custom: '', age: '', state: '', ageCustom: '', stateCustom: '', speakers: sp }; markDirty(id => lineEngine(id) === 'fish'); }
};
const rstBtn = (attr, tip, tipEn) => `<button type="button" class="rst btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" ${attr} data-tip="${tip}" data-tip-en="${tipEn}" aria-label="reset"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>`;
function addResetButtons(){
  Object.keys(RESETS).forEach(id => { const el = $(id); if (!el) return; const fs = el.closest('fieldset'); const lg = fs && fs.querySelector('legend'); if (!lg || lg.querySelector('.rst')) return;
    lg.classList.add('flex', 'w-full', 'items-center', 'justify-between'); lg.insertAdjacentHTML('beforeend', rstBtn(`data-rst="${id}"`, 'بازنشانی به پیش‌فرض', 'Reset to default')); });
  Object.keys(SECTION_RESET).forEach(id => { const box = $(id); if (!box || box.querySelector(':scope > .rstsec')) return;
    box.insertAdjacentHTML('afterbegin', `<div class="rstsec flex justify-end"><button type="button" class="btn btn-ghost btn-xs gap-1 opacity-70 hover:opacity-100" data-rstsec="${id}"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg>${T('بازنشانیِ همهٔ تنظیم‌های این موتور', "Reset all of this engine's settings")}</button></div>`); });
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-rst]'), s2 = e.target.closest('[data-rstsec]');
  if (b){ e.preventDefault(); e.stopPropagation(); remember(); RESETS[b.dataset.rst](); fillInspector(); if (sel.size === 1) fillLineInspector([...sel][0]); if (!$('insp-music').classList.contains('hidden')) showMusicInspector(); renderScript(); autosave(); say(T('به پیش‌فرض برگشت.', 'Reset to default.'), 'ok'); }
  if (s2){ e.preventDefault(); remember(); SECTION_RESET[s2.dataset.rstsec](); fillInspector(); renderScript(); autosave(); say(T('تنظیم‌های این موتور به پیش‌فرض برگشت.', "This engine's settings are back to default."), 'ok'); }
}, true);
// ---- PROJECT FILES (.ava): save and reopen exactly as it was
async function projectSave(){
  const r = await API().project_save(snapshot()); if (r && r.ok) say(T('پروژه ذخیره شد: ', 'Project saved: ') + r.path, 'ok'); else if (r && r.error !== 'cancelled') say((r && r.error) || '', 'err'); }
async function projectOpen(){
  const r = await API().project_open(); if (!r || !r.ok){ if (r && r.error !== 'cancelled') say((r && r.error) || '', 'err'); return; }
  remember(); setBusy(true);
  try { const musicCfg = r.doc.music ? { ...r.doc.music } : null; restoreSnap(r.doc);
    const gids = [...new Set(S.tracks.flatMap(t => t.clips.map(c => c.gulp)).filter(g => g != null))];
    for (const g of gids){ const a = await API().gulp_audio(g); if (a && a.ok) await storeAudio(g, a.b64); }
    if (r.music && r.music.b64){ await setMusicTrack(r.music.b64, null, r.music.name); if (musicCfg) Object.assign(S.music, musicCfg, { file: null }); }
    renderScript(); fillInspector(); autosave(); say(T('پروژه باز شد.', 'Project opened.'), 'ok'); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}

// 160 · tag and tone menus: values as data, one listener; pressing the menu never steals the caret
['tagMenu', 'toneMenu'].forEach(id => { const m = $(id); if (!m) return;
  m.addEventListener('mousedown', e => { if (e.target.closest('a')) e.preventDefault(); });
  m.addEventListener('click', e => { const a = e.target.closest('[data-tag],[data-tone]'); if (!a) return; e.preventDefault();
    if (a.dataset.tag !== undefined) insertTag(a.dataset.tag); else setTone(a.dataset.tone); if (document.activeElement && document.activeElement.closest('.dropdown')) document.activeElement.blur(); }); });


// 161 · a speaker prefix («راوی:») is never split off its sentence — the sentence splitter treats the colon
//       as a sentence end, which broke characters, two speakers, Fish speakers and the video's speakers on paste
const SPK_ONLY = /^\s*[^:：\n.!?؟«»"]{1,24}[:：]\s*$/;
function joinSpk(arr){ const out = []; for (let i = 0; i < arr.length; i++){ if (SPK_ONLY.test(arr[i]) && i + 1 < arr.length){ out.push(arr[i].trim() + ' ' + String(arr[i + 1]).trimStart()); i++; } else out.push(arr[i]); } return out; }
function splitSentences(...a){ const r = splitSentences0(...a); return Array.isArray(r) ? joinSpk(r) : (typeof r === 'string' ? joinSpk(r.split('\n')).join('\n') : r); }
function reflowSentences(...a){ const r = reflowSentences0(...a); return typeof r === 'string' ? joinSpk(r.split('\n')).join('\n') : (Array.isArray(r) ? joinSpk(r) : r); }

// 162 · ▶ on every voice menu row
function previewHooks(){
  const set = (id, eng) => { const el = $(id); if (!el) return; el.dataset.preview = eng; el._preview = v => previewVoice(eng, v || null); };
  set('pVoice', 'google'); set('lnVoice', 'google'); set('fishVoice', 'fish'); set('cbxVoice', 'chatterbox');
}


// ===================================================================================
// 164 · fixes from the founder's review of 163
// ===================================================================================
function menuDo(fn, ...a){ if (document.activeElement) document.activeElement.blur(); setTimeout(() => fn(...a), 0); }   // a menu reopens after a choice
let ASK = null;
function askText(title, hint, initial){ return new Promise(res => { if (ASK) ASK(null); ASK = res; $('askTitle').textContent = title || ''; $('askHint').textContent = hint || ''; $('askInput').value = initial || ''; $('askDlg').showModal(); setTimeout(() => $('askInput').focus(), 30); }); }
function askDone(v){ const r = ASK; ASK = null; if ($('askDlg').open) $('askDlg').close(); if (r) r(v === null ? null : String(v)); }
document.addEventListener('DOMContentLoaded', () => { const d = $('askDlg'); if (d) d.addEventListener('close', () => { if (ASK) askDone(null); }); });
// the ruler is exactly as wide as the lanes and starts at the same pixel, so the label and the line never part
function alignRuler(){
  const r = $('ruler'), l = $('lanes'), rv = $('rulerView'), sc = $('tlScroll'); if (!r || !l) return;
  r.style.width = Math.max(l.scrollWidth, l.offsetWidth) + 'px'; const cur = parseFloat(r.style.marginLeft) || 0;
  const d = Math.round(l.getBoundingClientRect().left - (r.getBoundingClientRect().left - cur) - (rv && sc ? sc.scrollLeft - rv.scrollLeft : 0));
  if (Math.abs(d - cur) > 0.5) r.style.marginLeft = d + 'px'; if (rv && sc) rv.scrollLeft = sc.scrollLeft;
}
const _renderTimeline163 = renderTimeline;
renderTimeline = function(){ _renderTimeline163(); requestAnimationFrame(() => { alignRuler(); seekVisual(playhead); }); };
addEventListener('resize', () => requestAnimationFrame(alignRuler));
// the volume overlay
function openVolPop(ev, i){
  ev.stopPropagation(); let p = $('volPop'); if (!p){ p = document.createElement('div'); p.id = 'volPop'; p.className = 'ui fixed z-[1500] w-56 rounded-box border border-base-300 bg-base-200 p-3 shadow-xl'; document.body.appendChild(p);
    document.addEventListener('pointerdown', e => { if (!e.target.closest('#volPop')) p.classList.add('hidden'); }, true); }
  const t = S.tracks[i], v = t.volume ?? 1, r = ev.currentTarget.getBoundingClientRect();
  p.innerHTML = `<div class="mb-2 flex items-center justify-between text-xs font-semibold"><span>${T('بلندیِ', 'Volume of')} ${escapeHtml(T(t.name, t.en))}</span><span id="volVal" class="tabular-nums text-base-content/70" dir="ltr">${Math.round(v * 100)}%</span></div>
    <div class="flex items-center gap-2"><input type="range" min="0" max="2" step="0.05" value="${v}" class="range range-xs flex-1 text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="setTrackVolume(${i}, +this.value, this); $('volVal').textContent = Math.round(this.value * 100) + '%'">
    <button class="btn btn-ghost btn-xs btn-square" onclick="setTrackVolume(${i}, 1, null); openVolPop({ stopPropagation(){}, currentTarget: document.querySelector('[data-ti=&quot;${i}&quot;] [aria-label=volume]') || this }, ${i})" data-tip="بازنشانی به ۱۰۰٪" data-tip-en="Reset to 100%"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button></div>`;
  p.classList.remove('hidden'); p.style.top = Math.min(innerHeight - 110, r.bottom + 6) + 'px'; p.style.left = Math.max(8, Math.min(innerWidth - 232, r.left - 100)) + 'px';
}

// 164 · voice lists as the classic interface had them; delete only on cloned voices, your samples and recent items
function cbxGroups(list, selVal, delSamples){
  const groups = new Map(), mine = [];
  (list || []).forEach(v => { if (typeof v === 'string') v = { id: v, name: v, builtin: true }; if (v.builtin === false || v.mine || v.user){ mine.push(v); return; }
    const g = T('نمونه: ', 'Sample: ') + (v.voice || v.name || v.id); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(v); });
  const op = (v, label, del) => `<option value="${escapeHtml(v.id || v.name)}" ${(v.id || v.name) === selVal ? 'selected' : ''} ${del ? 'data-del' : ''}>${escapeHtml(label)}</option>`;
  return [...groups.entries()].map(([g, vs]) => `<optgroup label="${escapeHtml(g)}">` + vs.map(v => op(v, v.style || v.title || v.name || v.id, false)).join('') + '</optgroup>').join('')
    + (mine.length ? `<optgroup label="${T('نمونه‌های من', 'My samples')}">` + mine.map(v => op(v, v.name || v.title || v.id, delSamples)).join('') + '</optgroup>' : '');
}
function cbxOptions(cur){ return `<option value="default" ${cur === 'default' || !cur ? 'selected' : ''}>${T('پیش‌فرض', 'Default')}</option>` + cbxGroups(CBX_VOICES, cur, true); }
function fishOptions(cur){
  const fo = (v, l, d) => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''} ${d ? 'data-del' : ''}>${escapeHtml(l)}</option>`;
  return fo('default', T('پیش‌فرض Fish Audio', 'Fish Audio default'))
    + (FISH_VOICES.length ? `<optgroup label="${T('صداهای من در Fish Audio', 'My Fish Audio voices')}">` + FISH_VOICES.map(v => fo(v._id || v.id, v.title || v._id || v.id, true)).join('') + '</optgroup>' : '')
    + (FISH_USED.length ? `<optgroup label="${T('استفاده‌شده‌های قبلی', 'Used before')}">` + FISH_USED.map(v => fo(v.id, v.title || v.id, true)).join('') + '</optgroup>' : '')
    + (FISH_DESIGNED.length ? `<optgroup label="${T('طراحی‌شده‌ها', 'Designed')}">` + FISH_DESIGNED.map(v => fo(v.id, v.title || v.id, false)).join('') + '</optgroup>' : '')
    + cbxGroups(CBX_VOICES, cur, true);
}

// 166 · music clips: split, duplicate, delete one (the music itself goes only with its last clip); quick trim visual for music
const musicClipsSpec = () => ((S.tracks.find(t => t.kind === 'music') || {}).clips || []).map(c => ({ in: c.in, out: c.out, at: c.at }));
function splitMusic(){ const [t, c] = findClip(selClip); if (!c || t.kind !== 'music') return; const cut = playhead - c.at;
  if (cut <= 0.1 || cut >= c.out - c.in - 0.1) return say(T('پلی‌هد را روی کلیپِ موسیقی بگذارید.', 'Put the playhead over the music clip.'), 'err');
  remember(); const n = { ...c, id: 'mu' + (++uid), at: c.at + cut, in: c.in + cut }; c.out = c.in + cut; t.clips.push(n); t.clips.sort((a, b) => a.at - b.at); S.music.manual = true; selClip = n.id; renderTimeline(); autosave(); }
function dupMusic(){ const [t, c] = findClip(selClip); if (!c || t.kind !== 'music') return; remember(); const len = c.out - c.in, end = Math.max(...t.clips.map(x => x.at + x.out - x.in));
  const free = !t.clips.some(x => x !== c && x.at < c.at + 2 * len && x.at + x.out - x.in > c.at + len);
  const n = { ...c, id: 'mu' + (++uid), at: free ? c.at + len : end }; t.clips.push(n); t.clips.sort((a, b) => a.at - b.at); S.music.manual = true; selClip = n.id; renderTimeline(); autosave(); }
function delMusicClip(){ const [t, c] = findClip(selClip); if (!c || t.kind !== 'music') return; if (t.clips.length <= 1) return removeMusic(); remember(); t.clips = t.clips.filter(x => x !== c); S.music.manual = true; selClip = null; renderTimeline(); autosave(); }
const _quickTrimVisual165 = quickTrimVisual;
quickTrimVisual = function(c){ if (!c.lines) return renderTimeline(); return _quickTrimVisual165(c); };

// 166 · example chips in the voice-design dialogs add to the description
function dsChip(id, el){ const t = $(id); if (!t) return; t.value = (t.value.trim() ? t.value.trim() + '، ' : '') + el.textContent.trim(); t.focus(); }

// 166 · a line is sent only when it has something to say: for Google a tag alone counts (<long pause>), for the others it needs words
function speakableLine(id){ const L = S.lines[id]; if (!L || !(L.text || '').trim()) return false; if (lineVoice(id).engine === 'google') return true;
  return /[\p{L}\p{N}]/u.test(spoken(id).replace(/<[^>]*>|\|[^|]*\||\{[^}]*\}|\/[^/\s][^/]*\//g, '')); }

// 167 · voice library / design / cloning live at the bottom of the voice menu (no more row of truncated buttons)
const _previewHooks166 = previewHooks;
previewHooks = function(){ _previewHooks166();
  const g = is38() ? [['library-big', 'کتابخانهٔ صداهای گوگل…', 'Google voice library…', null], ['wand-sparkles', 'طراحیِ صدا…', 'Design a voice…', () => $('designDlg').showModal()], ['audio-lines', 'شبیه‌سازیِ صدا…', 'Clone a voice…', () => openClone()]] : [];
  ['pVoice', 'lnVoice'].forEach(id => { if ($(id)) $(id)._actions = g.map(a => a[3] ? a : [a[0], a[1], a[2], () => openLib(id === 'pVoice' ? 'proj' : 'line')]); });
  if ($('fishVoice')) $('fishVoice')._actions = [['library-big', 'کتابخانهٔ Fish Audio…', 'Fish Audio library…', () => openFishLib()], ['audio-lines', 'شبیه‌سازیِ صدا…', 'Clone a voice…', () => $('fishCloneDlg').showModal()], ['wand-sparkles', 'طراحیِ صدا…', 'Design a voice…', () => $('fishDesignDlg').showModal()]];
};
