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
const escapeHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const PAD = 18, SNAP_PX = 8, GAP = 0.12;            // margin before 0:00; snapping; the breath between parts
let uid = Date.now() % 100000, zoom = 22, playhead = 0, playing = false, snapOn = true, editorDir = 'rtl', busy = false;

// ---------------- state ----------------
const S = {
  lines: {},                                         // id -> { text, dirty, voice: {gVoice,gPreset,gState} | null }
  tracks: [ { id: 's1', name: 'گفتار ۱', en: 'Speech 1', kind: 'speech', gapless: false, clips: [] },
            { id: 'm1', name: 'موسیقی', en: 'Music', kind: 'music', clips: [] } ],
  proj: { engine: 'google', g_model: 'gemini-3.1-flash-tts-preview', g_voice: 'Charon', g_preset: 'neutral', g_state: '', g_age: '', g_lang: 'fa', g_continuity: true,
          cbx: { voice: 'default', speed: 1, exag: 0.8, cfg: 1, temp: 0 }, light: { speed: 1, noise: 0.667, noisew: 0.8 },
          fish: { model: '', latency: 'normal', voice: 'default', preset: 'neutral', speed: 1, volume: 0, temp: 0.7, top_p: 0.7, cont: true, condPrev: true, normLoud: true, normalize: false, quality: false } },
  music: { level_db: -16, fade_in: 1.5, fade_out: 1.5, duck: true, file: null, name: null },
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
const lineVoice = id => ({ engine: S.proj.engine, gVoice: S.proj.g_voice, gPreset: S.proj.g_preset, gState: S.proj.g_state, ...(S.lines[id] && S.lines[id].voice || {}) });
const lineEngine = id => lineVoice(id).engine;

// ---------------- status, busy, cancel ----------------
function say(msg, kind){ const s = $('status'); s.textContent = msg || ''; s.className = 'min-w-0 flex-1 truncate ' + (kind === 'err' ? 'text-error' : 'text-base-content/70'); }
window.avaStatus = ({ msg, pct }) => { say(msg, 'ok'); const p = $('prog'); if (pct === undefined || pct === null) p.removeAttribute('value'); else p.value = pct; };
function setBusy(on){ busy = on; $('prog').classList.toggle('hidden', !on); $('cancelBtn').classList.toggle('hidden', !on); $('genBtn').disabled = on; }
async function cancelJob(){ try { await API().cancel(); } catch (e) {} say(T('لغو شد.', 'Cancelled.'), 'ok'); }
const isCancel = e => /cancel|لغو/i.test(String(e && e.message || e));

// ---------------- persistence: the document survives switching interfaces ----------------
let SESSION = null, saveTimer = null;
function snapshot(){ return JSON.parse(JSON.stringify({ lines: S.lines, tracks: S.tracks.map(t => ({ ...t, clips: t.clips.map(({ _ti, _track, ...c }) => c) })), proj: S.proj, music: S.music })); }
const MUSIC0 = { level_db: -16, fade_in: 1.5, fade_out: 1.5, duck: true, file: null, name: null, credit: '' };
function restoreSnap(sn){ S.lines = sn.lines; S.tracks = sn.tracks; const base = JSON.parse(JSON.stringify(S.proj)); S.proj = Object.assign(base, sn.proj || {}); ['cbx', 'light', 'fish'].forEach(k => S.proj[k] = Object.assign({}, base[k], (sn.proj || {})[k] || {})); S.music = Object.assign({}, MUSIC0, sn.music || {}); }   // replace, never merge: a missing key means 'none'
function autosave(){ clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { API().settings_set({ ed_doc: snapshot(), ed_session: SESSION }); } catch (e) {} }, 800); }

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
  $('cbxVoice').innerHTML = optList([['default', T('پیش‌فرض', 'Default')]].concat(CBX_VOICES.map(v => [v.id || v.name || v, v.name || v.title || v.id || v])), c.voice);
  $('fishModel').innerHTML = optList((DIRECTOR.fish_models || []).map(([k, lab]) => [k, lab]), f.model || ((DIRECTOR.fish_models || [])[0] || [''])[0]);
  if (!f.model && (DIRECTOR.fish_models || []).length) f.model = DIRECTOR.fish_models[0][0];
  $('fishLatency').value = f.latency;
  $('fishVoice').innerHTML = optList([['default', T('پیش‌فرض Fish Audio', 'Fish Audio default')]].concat(FISH_VOICES.map(v => [v._id || v.id, v.title || v.name || v._id || v.id])), f.voice);
  $('fishPreset').innerHTML = optList(G_PRESETS.map(p => [p[0], p[1]]), f.preset);
  ['pModel', 'pVoice', 'pPreset', 'pState', 'pAge', 'pLang', 'pEngine', 'cbxVoice', 'fishModel', 'fishLatency', 'fishVoice', 'fishPreset'].forEach(id => enh($(id)));
  buildTagMenus();
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
function showInsp(w){
  ['line', 'proj', 'music'].forEach(k => $('insp-' + k).classList.toggle('hidden', k !== w));
  $('it-line').classList.toggle('tab-active', w === 'line'); $('it-proj').classList.toggle('tab-active', w !== 'line');
}
function fillLineInspector(id){
  const v = (S.lines[id] && S.lines[id].voice) || {};
  const proj = T('— مثلِ پروژه —', '— as the project —');
  $('lnEngine').innerHTML = `<option value="">${proj}</option>` + optList(ENGINES, v.engine); $('lnGoogle').classList.toggle('hidden', lineEngine(id) !== 'google');
  $('lnVoice').innerHTML = `<option value="">${proj}</option>` + optList(G_VOICES.map(([x, l]) => [x, `${x} — ${tr(l)}`]), v.gVoice);
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
function renderScript(){
  const clips = scriptOrder(), ed = $('editor'); let html = '', n = 0, i = 0;
  while (i < clips.length){
    let j = i;                                          // consecutive clips overlapping in time share a bracket
    while (j + 1 < clips.length && clips[j + 1].at < clips[j].at + dur(clips[j]) - 0.01 && clips[j + 1]._ti !== clips[j]._ti) j++;
    const rows = clips.slice(i, j + 1).map(c => c.lines.map(id => lineRow(id, ++n, c)).join('')).join('');
    html += j > i ? `<div class="relative"><span class="pointer-events-none absolute -start-2 top-2 bottom-2 w-2.5 rounded-s-md border-y-2 border-s-2 border-accent"></span>${rows}</div>` : rows;
    i = j + 1;
  }
  ed.innerHTML = html + '<div id="pcaret" class="pointer-events-none absolute z-10 hidden w-0.5 rounded-full bg-secondary shadow-[0_0_6px] shadow-secondary/60"></div>';
  wireLines(); paintSel(); updatePCaret(); renderTimeline();
}
function lineRow(id, n, c){
  const L = S.lines[id]; if (!L) return '';
  const badge = (cls, icon, text, tip) => `<span class="badge ${cls} badge-xs gap-1 align-middle ${tip ? 'tooltip' : ''}" ${tip ? `data-tip="${tip}"` : ''} contenteditable="false">${icon ? `<svg class="size-2.5"><use href="#i-${icon}"/></svg>` : ''}${text}</span>`;
  const extra = (L.dirty ? badge('badge-warning', 'pencil', T('تغییر کرده', 'edited'), T('متن یا صدای این خط عوض شده و هنوز دوباره ساخته نشده', 'changed, not re-voiced yet')) : '')
    + (c.unvoiced && (L.text || '').trim() ? badge('badge-ghost', '', T('ساخته نشده', 'not voiced')) : '')
    + (c.lines.length > 1 && c.lines[0] === id ? badge('badge-ghost', 'layers', T('یک کلیپ', 'one clip'), T('این خط‌ها یک کلیپ‌اند: نقشهٔ خط برای این بخش ساخته نشد', 'these lines are one clip: no line map for this part')) : '')
    + (c.lines.length === 1 && (c.trimIn > 0.05 || c.trimOut > 0.05) ? badge('badge-error badge-soft', 'scissors', T('کوتاه شده', 'trimmed')) : '');
  return `<div class="ln group relative flex items-start gap-1.5 px-2" data-id="${id}">
    <span class="grip mt-1.5 grid size-6 shrink-0 cursor-grab place-items-center rounded text-base-content/40 opacity-0 hover:bg-base-300 group-hover:opacity-100" title="${T('بکشید تا جابه‌جا شود', 'drag to reorder')}"><svg class="size-4"><use href="#i-grip-vertical"/></svg></span>
    <span class="mt-1.5 w-6 shrink-0 text-end text-xs tabular-nums text-base-content/40">${num(n)}</span>
    <div class="min-w-0 flex-1 py-0.5"><p><span class="lt outline-none" contenteditable="true" spellcheck="false" data-ph="${T('متن را این‌جا بنویسید یا بچسبانید…', 'Type or paste the text here…')}">${trimmedHtml(L.text || '', c)}</span> ${extra}</p><div class="lnbar"></div></div>
  </div>`;
}
function lineBar(){
  const b = 'btn btn-xs join-item gap-1 border-base-content/15 bg-base-100';
  return `<div class="mb-1.5 mt-0.5 flex flex-wrap items-center gap-1.5" contenteditable="false"><div class="join">
    <button class="btn btn-primary btn-xs join-item gap-1" onclick="revoiceSelected()"><svg class="size-3.5"><use href="#i-refresh-cw"/></svg>${T('بازتولید', 'Re-voice')}</button>
    <button class="${b}" onclick="playLine()"><svg class="size-3.5"><use href="#i-play"/></svg>${T('شنیدن', 'Play')}</button>
    <button class="${b}" onclick="newLineAfter()"><svg class="size-3.5"><use href="#i-plus"/></svg>${T('خطِ تازه', 'New line')}</button>
    <button class="btn btn-xs join-item btn-square border-base-content/15 bg-base-100" onclick="deleteLine()" aria-label="delete"><svg class="size-3.5"><use href="#i-trash-2"/></svg></button></div></div>`;
}
function paintSel(){
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
    $('lineState').innerHTML = L.dirty ? `<span class="badge badge-warning badge-sm gap-1"><svg class="size-3"><use href="#i-pencil"/></svg>${T('تغییر کرده', 'edited')}</span>`
      : c && c.unvoiced ? `<span class="badge badge-ghost badge-sm">${T('ساخته نشده', 'not voiced')}</span>`
      : c ? `<span class="badge badge-soft badge-secondary badge-sm gap-1"><svg class="size-3"><use href="#i-check"/></svg>${T('ساخته‌شده', 'voiced')}، ${num(dur(c).toFixed(1))} ${T('ثانیه', 's')}</span>` : '';
    fillLineInspector(id); showInsp('line');
  } else if (!$('insp-music').classList.contains('hidden') && selClip && selClip.startsWith('mu')){ /* keep the music panel */ }
  else { showInsp('proj'); $('projTitle').textContent = sel.size > 1 ? T(`${FA(sel.size)} خط انتخاب شده`, `${sel.size} lines selected`) : T('پروژه', 'Project'); }
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
      S.lines[id].text = lt.textContent; let [t, prev] = clipOfLine(id); let last = id;
      parts.forEach(p => { const nid = ++uid; S.lines[nid] = { text: p, dirty: false, voice: null }; prev = placeholderAfter(t, prev, [nid]); last = nid; });
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
  S.lines[nid] = { text: after, dirty: false, voice: L.voice ? { ...L.voice } : null };
  if (c && c.unvoiced) resizeClip(c, estDur(before));
  placeholderAfter(t, c, [nid]); sel = new Set([nid]); renderScript(); focusLine(nid); autosave();
}
function sliceAt(c, id, at, tt){
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
$('editorArea').addEventListener('mousedown', ev => { if (!ev.target.closest('#editor')){ sel = new Set(); selClip = null; getSelection().removeAllRanges(); paintSel(); renderTimeline(); } });
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
  const item0 = t => `<li><a dir="ltr" onclick="insertTag(${escapeHtml(JSON.stringify(t))})">${escapeHtml(t)}</a></li>`;
  if (eng === 'fish'){ m.innerHTML = (DIRECTOR.fish_tags || []).map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item0).join('')).join(''); return buildToneMenu(); }
  if (eng !== 'google'){ m.innerHTML = `<li class="menu-title whitespace-normal">${T('این موتور فقط مکث می‌گیرد', 'This engine takes pauses only')}</li>` + ['[مکث]', '[مکث بلند]'].map(item0).join(''); return buildToneMenu(); }
  const item = t => `<li><a dir="ltr" onclick="insertTag(${escapeHtml(JSON.stringify(t))})">${escapeHtml(t)}</a></li>`;
  if (/2\.5/.test(model)) m.innerHTML = `<li class="menu-title whitespace-normal">${T('مدل‌های 2.5 برچسبِ صوتی نمی‌گیرند.', 'The 2.5 models take no sound tags.')}</li>`;
  else if (isG38()) m.innerHTML = G38_TAGS.map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item).join('')).join('')
    + `<li class="menu-title">${T('واکنشِ شنونده', 'Listener reactions')}</li>` + G38_BACK.map(item).join('');
  else m.innerHTML = G_TAGS.map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item).join('')).join('');
  buildToneMenu();
}
function buildToneMenu(){
  const tones = (typeof G38_TONES !== 'undefined' ? G38_TONES : DIRECTOR.states.filter(a => a[0] && a[0] !== 'custom').map(a => a[1]));
  $('toneMenu').innerHTML = isG38() ? tones.map(x => `<li><a onclick="setTone(${escapeHtml(JSON.stringify(x))})">${escapeHtml(x)}</a></li>`).join('')
    : `<li class="menu-title whitespace-normal">${T('لحنِ خط فقط در 3.8؛ در مدل‌های دیگر از «حال و احساس»ِ همین خط استفاده کنید.', 'Line tone is for 3.8; on other models use this line\'s mood.')}</li>`;
}
function insertTag(tag){
  if (sel.size !== 1) return; const id = [...sel][0], lt = document.querySelector(`#editor .ln[data-id="${id}"] .lt`); if (!lt) return;
  lt.focus(); const s = getSelection();
  if (lastRange && lt.contains(lastRange.startContainer)){ s.removeAllRanges(); s.addRange(lastRange); } else { const r = document.createRange(); r.selectNodeContents(lt); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
  document.execCommand('insertText', false, ' ' + tag + ' ');
  document.activeElement.blur && document.activeElement.blur();
}
function setTone(tone){
  if (!sel.size || !isG38()) return; remember();
  sel.forEach(id => { const L = S.lines[id]; L.text = `{${tone}} ` + L.text.replace(/^\s*\{[^{}\n]{1,60}\}\s*/, ''); const [, c] = clipOfLine(id); if (c && !c.unvoiced) L.dirty = true; });
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
function peaksHtml(c, w){
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
      ${t.kind === 'speech' ? `<label class="tooltip flex cursor-pointer items-center" data-tip="${T('بدونِ فاصله', 'gapless')}"><input type="checkbox" class="checkbox checkbox-xs" ${t.gapless ? 'checked' : ''} onchange="setGapless(${i}, this.checked)"></label>` : ''}
      <button class="btn btn-ghost btn-xs btn-square ${t.muted ? 'text-error' : ''}" onclick="toggleMute(${i})" aria-label="mute"><svg class="size-3.5"><use href="#i-${t.muted ? 'volume-x' : 'volume-2'}"/></svg></button>
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
      else { const L = S.lines[c.lines[0]] || { text: '' }; look = c.unvoiced ? 'border border-dashed border-base-content/30 bg-transparent text-base-content/50 outline-transparent' : (ti % 2 ? 'bg-secondary/15 text-secondary outline-secondary/50' : 'bg-primary/15 text-primary outline-primary/50');
        label = `${num(order.indexOf(c.lines[0]) + 1)}${c.lines.length > 1 ? '–' + num(order.indexOf(c.lines[c.lines.length - 1]) + 1) : ''} ${escapeHtml((c.file ? '♪ ' : '') + (L.text || '').slice(0, 28))}…`; }
      const dirty = c.lines && c.lines.some(id => S.lines[id] && S.lines[id].dirty);
      clips += `<div class="clip absolute overflow-hidden rounded-field outline outline-1 ${look} ${pos} ${isSel ? 'outline-2 outline-primary!' : ''} cursor-grab" style="left:${PAD + c.at * pps}px;width:${w}px" data-cid="${c.id}" data-ti="${ti}">
        ${c.unvoiced ? '' : peaksHtml(c, w)}
        <span class="ui pointer-events-none absolute inset-x-1.5 top-0.5 truncate text-[11px] font-semibold" dir="rtl">${label}</span>
        ${dirty ? `<span class="badge badge-warning badge-xs pointer-events-none absolute bottom-1 left-1 gap-0.5"><svg class="size-2.5"><use href="#i-pencil"/></svg></span>` : ''}
        ${(c.trimIn > 0.05 || c.trimOut > 0.05) ? `<span class="badge badge-error badge-xs pointer-events-none absolute bottom-1 ${dirty ? 'left-6' : 'left-1'}"><svg class="size-2.5"><use href="#i-scissors"/></svg></span>` : ''}
        ${selClip === c.id && w > 130 ? `<span class="pointer-events-none absolute bottom-1 right-6 rounded-md bg-black/60 px-1.5 text-[10px] font-semibold tabular-nums text-white">${num(dur(c).toFixed(1))}${T('ث', 's')}</span>` : ''}
      </div>`;
      if (selClip === c.id && t.kind === 'speech' && !c.unvoiced){
        const xl = PAD + c.at * pps, xr = xl + w;
        const hdl = (x, edge) => `<span class="trimh absolute z-20 w-[18px] cursor-ew-resize ${pos}" style="left:${x}px" data-edge="${edge}" data-cid="${c.id}" data-ti="${ti}"><span class="pointer-events-none absolute top-1/2 h-[55%] w-[3px] -translate-y-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,.55)] ${edge === 'l' ? 'left-[10px]' : 'left-[5px]'}"></span></span>`;
        clips += hdl(xl - 5, 'l') + hdl(xr - 13, 'r');
      }
    });
    lanes += `<div class="lane relative h-14" style="width:${W}px" data-ti="${ti}">${clips}</div>`;
  });
  lanes += `<div id="ph" class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-secondary" style="left:${PAD + playhead * pps}px"></div>`;
  $('lanes').innerHTML = lanes; $('lanes').style.width = W + 'px'; syncRuler();
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
  $('lanes').onpointerdown = ev => { if (ev.target.id === 'lanes' || ev.target.classList.contains('lane')){ selClip = null; renderTimeline(); } };
}
function seekFromX(cx){ const r = $('lanes').getBoundingClientRect(); seek(Math.max(0, (cx - r.left - PAD) / zoom)); }
function scrubbing(){ const mv = e => seekFromX(e.clientX), up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); }
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
  ev.stopPropagation(); const [t, c] = findClip(el.dataset.cid); if (!c) return;
  selClip = c.id; if (t.kind === 'music'){ showMusicInspector(); renderTimeline(); return; }
  sel = new Set(c.lines); const x0 = ev.clientX, at0 = c.at; let moved = false; remember();
  const mv = e => { const dx = (e.clientX - x0) / zoom; if (Math.abs(e.clientX - x0) > 3) moved = true; if (!moved) return;
    c.at = Math.max(0, snapT(at0 + dx, c)); el.style.left = (PAD + c.at * zoom) + 'px'; };
  const up = e => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (!moved){ hist.past.pop(); paintSel(); renderTimeline(); return; }
    const lane = document.elementFromPoint(e.clientX, e.clientY); const li = lane && lane.closest('.lane') ? +lane.closest('.lane').dataset.ti : null;
    t.clips = t.clips.filter(x => x !== c);
    let ti = li !== null && S.tracks[li] && S.tracks[li].kind === 'speech' ? li : S.tracks.indexOf(t);
    if (ti < 0) ti = 0; placeOn(ti, c); cleanupTracks(); if (S.tracks[ti] && S.tracks[ti].gapless) pack(S.tracks[ti]);
    renderScript(); autosave(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function startTrim(ev, el){
  ev.stopPropagation(); ev.preventDefault(); const [t, c] = findClip(el.dataset.cid); if (!c) return; remember();
  const edge = el.dataset.edge, x0 = ev.clientX, in0 = c.in, out0 = c.out, at0 = c.at, src = c.src || [c.in - (c.trimIn || 0), c.out + (c.trimOut || 0)];
  c.src = src;
  const mv = e => { const d = (e.clientX - x0) / zoom;
    if (edge === 'l'){ const ni = Math.min(out0 - 0.2, Math.max(src[0], in0 + d)); c.at = at0 + (ni - in0); c.in = ni; c.trimIn = ni - src[0]; }
    else { const no = Math.max(in0 + 0.2, Math.min(src[1], out0 + d)); c.out = no; c.trimOut = src[1] - no; }
    renderScript(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (t.gapless) pack(t); renderScript(); autosave(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function pack(t){ let x = t.clips.length ? Math.min(...t.clips.map(c => c.at)) : 0; t.clips.sort((a, b) => a.at - b.at).forEach(c => { c.at = x; x += dur(c); }); }
function setGapless(i, on){ remember(); S.tracks[i].gapless = on; if (on) pack(S.tracks[i]); renderScript(); autosave(); }
function toggleMute(i){ S.tracks[i].muted = !S.tracks[i].muted; renderTimeline(); autosave(); }
function setZoom(z){ zoom = z; $('zoom').value = z; renderTimeline(); }
$('zoom').oninput = e => setZoom(+e.target.value);
function placeClipBar(){
  const bar = $('clipBar'), el = selClip && document.querySelector(`#lanes .clip[data-cid="${selClip}"]`);
  if (!el){ bar.classList.add('hidden'); return; }
  const [t, c] = findClip(selClip), b = (icon, tip, fn, txt) => `<li><a onclick="${fn}" class="gap-1 ${txt ? '' : 'tooltip'}" ${txt ? '' : `data-tip="${tip}"`}><svg class="size-3.5"><use href="#i-${icon}"/></svg>${txt ? `<span class="ui">${txt}</span>` : ''}</a></li>`;
  bar.innerHTML = t.kind === 'music' ? b('trash-2', T('حذف', 'delete'), 'removeMusic()')
    : (c.unvoiced || c.file ? '' : b('refresh-cw', '', 'revoiceClip()', T('بازتولید', 'Re-voice')))
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
function delClip(){ const [t, c] = findClip(selClip); if (!c) return; remember(); c.lines.forEach(id => delete S.lines[id]); t.clips = t.clips.filter(x => x !== c); if (t.gapless) pack(t); cleanupTracks(); selClip = null; ensureOneLine(); renderScript(); autosave(); }
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
let MUSIC_HITS = [];
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
    const e = r.entry || {}; S.music.credit = r.credit || ''; await setMusicTrack(r.b64, e.file, e.title || e.name || MUSIC_HITS[k].title || e.file); $('musicDlg').close(); }
  catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); }
}
const RUN_CHARS = 600;                               // the classic default part size for Google
const fishFields = () => { const f = S.proj.fish; return { f_model: f.model, f_latency: f.latency, f_voice: f.voice, f_preset: f.preset, f_style: '', f_age: '', f_age_custom: '',
  f_state: '', f_state_custom: '', f_speed: f.speed, f_volume: f.volume, f_temp: f.temp, f_top_p: f.top_p, f_continuity: f.cont, f_cond_prev: f.condPrev,
  f_norm_loud: f.normLoud, f_normalize: f.normalize, f_quality_guard: f.quality, f_speakers: [] }; };
const payloadFor = (v, text) => ({ engine: v.engine, text, cbx_voice: S.proj.cbx.voice, ...gFields(v), ...fishFields(),
  exaggeration: S.proj.cbx.exag, cfg_weight: S.proj.cbx.cfg, temperature: S.proj.cbx.temp, cbx_speed: S.proj.cbx.speed,
  speed: S.proj.light.speed, noise: S.proj.light.noise, noisew: S.proj.light.noisew });
const gFields = v => ({ g_model: S.proj.g_model, g_lang: S.proj.g_lang, g_voice: v.gVoice, g_preset: v.gPreset, g_style: '', g_age: S.proj.g_age || '', g_age_custom: '',
  g_state: v.gState || '', g_state_custom: '', g_speakers: [], g_continuity: !!S.proj.g_continuity, g38_cast: CAST });
async function storeAudio(gid, b64){
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
  const ids = run.clips.flatMap(c => c.lines.filter(id => (S.lines[id].text || '').trim()));
  const text = ids.map(id => S.lines[id].text.trim()).join('\n');
  const r = await API().generate_gulp(payloadFor(lineVoice(ids[0]), text));
  if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
  await storeAudio(r.gulp, r.b64);
  const t = run.track, anchor = run.clips[0].at, oldEnd = Math.max(...run.clips.map(c => c.at + dur(c)));
  t.clips = t.clips.filter(c => !run.clips.includes(c) || c.lines.some(id => !ids.includes(id)));
  run.clips.forEach(c => { c.lines = c.lines.filter(id => !ids.includes(id)); });   // empty lines stay as placeholders
  t.clips = t.clips.filter(c => c.lines.length);
  const spans = r.lines || [], made = [];
  if (spans.length === ids.length && !spans[0].whole){
    spans.forEach((sp, k) => made.push({ id: 'c' + (++uid), lines: [ids[k]], gulp: r.gulp, in: sp.t0, out: sp.t1, src: [sp.t0, sp.t1], gi: k, at: anchor + (sp.t0 - spans[0].t0), trimIn: 0, trimOut: 0 }));
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
  const ids = owners.flatMap(x => x.lines), text = ids.map(id => S.lines[id].text.trim()).join('\n');
  const targets = selectOnly ? selectOnly : c.lines.filter(id => S.lines[id].dirty).length ? c.lines.filter(id => S.lines[id].dirty) : c.lines;
  const first = ids.indexOf(targets[0]), last = ids.indexOf(targets[targets.length - 1]);
  const sel_start = ids.slice(0, first).reduce((s, id) => s + S.lines[id].text.trim().length + 1, 0);
  const sel_end = sel_start + ids.slice(first, last + 1).map(id => S.lines[id].text.trim()).join('\n').length;
  const r = await API().patch_gulp({ gulp: c.gulp, text, sel_start, sel_end, payload: payloadFor(lineVoice(targets[0]), text) });
  if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error'));
  await storeAudio(r.gulp, r.b64);
  const spans = r.lines || [];
  if (spans.length === ids.length && !spans[0].whole){
    owners.forEach(o => {
      const k = ids.indexOf(o.lines[0]), sp = spans[k], before = dur(o), [t] = clipOfLine(o.lines[0]);
      const fresh = targets.includes(o.lines[0]);
      o.gulp = r.gulp; o.gi = k; o.src = [sp.t0, sp.t1];
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
let AC = null, nodes = [], playT0 = 0, playFrom = 0, stopAt = null, rafId = 0, musicBuf = null;
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
  const ctx = ac(), base = playT0 - playFrom, speech = [];
  S.tracks.forEach(t => { if (t.muted || t.kind !== 'speech') return; t.clips.forEach(c => {
    if (c.unvoiced) return; const a = AUD.get(c.gulp); if (!a || !a.buf) return;
    const end = c.at + dur(c); if (end <= playFrom) return; speech.push([c.at, end]);
    const off = Math.max(0, playFrom - c.at), src = ctx.createBufferSource(); src.buffer = a.buf; src.connect(ctx.destination);
    src.start(base + c.at + off, c.in + off, dur(c) - off); nodes.push(src); }); });
  const mt = S.tracks.find(t => t.kind === 'music');
  if (musicBuf && mt && mt.clips.length && !mt.muted){
    const end = speechEnd(); if (end <= playFrom) return;
    const g = ctx.createGain(), src = ctx.createBufferSource(), lvl = Math.pow(10, S.music.level_db / 20), duck = lvl * Math.pow(10, -12 / 20);
    src.buffer = musicBuf; src.loop = true; src.connect(g); g.connect(ctx.destination);
    const at = tt => base + tt, P = g.gain; P.setValueAtTime(0, ctx.currentTime);
    const level = tt => { let v = lvl; if (S.music.duck && speech.some(([s, e]) => tt >= s - 0.3 && tt <= e + 0.3)) v = duck;
      if (tt < S.music.fade_in) v *= tt / Math.max(0.01, S.music.fade_in); if (tt > end - S.music.fade_out) v *= Math.max(0, (end - tt) / Math.max(0.01, S.music.fade_out)); return v; };
    for (let tt = playFrom; tt <= end; tt += 0.1) P.linearRampToValueAtTime(level(tt), Math.max(ctx.currentTime, at(tt)));
    src.start(Math.max(ctx.currentTime, at(playFrom)), playFrom % musicBuf.duration); src.stop(at(end) + 0.05); nodes.push(src);
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
  if (pending()){ say(T(`${FA(pending())} خط هنوز ساخته یا به‌روز نشده؛ اول «تبدیل به گفتار» را بزنید.`, `${pending()} lines are not voiced or updated yet; press "Voice it" first.`), 'err'); return; }
  if (withMusic && !S.music.file){ say(T('موسیقی‌ای انتخاب نشده؛ از دکمهٔ + روی ترکِ موسیقی یکی انتخاب کنید.', 'No music chosen; pick one with + on the music track.'), 'err'); return; }
  if (busy) return; setBusy(true);
  try {
    const r = await API().timeline_files(timelineSpec(), withMusic ? { on: true, file: S.music.file, level_db: S.music.level_db, duck: S.music.duck, fade_in: S.music.fade_in, fade_out: S.music.fade_out } : null);
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
function layoutMusic(){ const mt = S.tracks.find(t => t.kind === 'music'); mt.clips = S.music.file ? [{ id: 'mu1', name: S.music.name, at: 0, in: 0, out: Math.max(2, speechEnd()) }] : []; }
function removeMusic(){ remember(); S.music.file = null; S.music.name = null; musicBuf = null; layoutMusic(); selClip = null; showInsp('proj'); renderScript(); autosave(); }
function setMusic(k, v){ S.music[k] = v; autosave(); if (playing){ const t = playhead; stopPlay(); seekVisual(t); startPlay(); } }
function showMusicInspector(){ ['line', 'proj'].forEach(k => $('insp-' + k).classList.add('hidden')); $('insp-music').classList.remove('hidden');
  $('musicName').textContent = S.music.name || ''; $('musicCredit').textContent = S.music.credit || ''; setRange('mLevel', S.music.level_db); setRange('mFadeIn', S.music.fade_in); setRange('mFadeOut', S.music.fade_out); $('mDuck').checked = !!S.music.duck; }
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
  const f = $('helpFrame'); f.src = lang === 'fa' ? 'help_fa.html' : 'help_en.html';
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
  if (st && st.ed_doc){
    restoreSnap(st.ed_doc);
    if (st.ed_session !== SESSION){             // a new app session: parts are no longer in memory
      S.tracks.forEach(t => t.clips.forEach(c => { if (t.kind === 'speech'){ c.gulp = null; c.unvoiced = true; c.in = 0; c.out = c.lines.reduce((s, id) => s + estDur(S.lines[id] && S.lines[id].text), 0); c.trimIn = c.trimOut = 0; delete c.src; } }));
      Object.values(S.lines).forEach(L => L.dirty = false); S.tracks = S.tracks.filter(t => t.kind !== 'speech' || t.id === 's1' || t.clips.length);
      if (Object.keys(S.lines).length) say(T('متنِ کارِ قبلی برگشت؛ صداهایش در جلسهٔ قبلیِ برنامه بودند — برای شنیدن دوباره «تبدیل به گفتار» را بزنید.', 'Your text is back; its audio was in the previous session — press "Voice it" to hear it again.'), 'ok');
    }
    if (S.music.file){ try { const r = await API().music_load(S.music.file); if (r.ok){ const bin = atob(r.b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); musicBuf = await ac().decodeAudioData(u8.buffer.slice(0)); } } catch (e) {} }
  }
  await loadEngineLists(); if (st && st.default_engine && !st.ed_doc) S.proj.engine = st.default_engine;
  ensureOneLine(); applyLang(); fillInspector(); wireRangeValues(); layoutMusic(); renderScript(); seekVisual(0); refreshKeys(); netStatus();
  try { const L = await API().license_state(); if (L && L.ok && L.days_left !== null && L.days_left !== undefined && L.days_left <= 21) say(T(`مجوزِ این دستگاه ${FA(L.days_left)} روزِ دیگر تمام می‌شود؛ برای تمدید، کدِ درخواست را برای کسی بفرستید که برنامه را به شما داده است.`, `This machine's licence ends in ${L.days_left} days; to renew, send the request code to whoever gave you the app.`), 'ok'); } catch (e) {}
  const gulps = [...new Set(speechClips().filter(c => !c.unvoiced && c.gulp !== null).map(c => c.gulp))];
  for (const g of gulps){ if (await ensureAudio(g)) renderTimeline(); }
}
init();
