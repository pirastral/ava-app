// =====================================================================================
// 176 · TRACKS, DUPLICATES, MULTI-SELECTION AND BACKGROUND CLIPS — both timelines
//   · one track of every kind always stays: audio — a speech track and a regular track; video — the subtitles, a
//     regular layer, the background and the audio. Empty tracks go, never the last of their kind.
//   · a duplicate lands right after its original, on the same track; whatever follows on that track makes room.
//   · several clips at once: Cmd/Ctrl-click adds or removes one, Shift-click takes the range between two clips, a
//     marquee on empty lane space takes everything it touches. The selection moves together (each clip on its own
//     track) and Delete removes all of it.
//   · a background clip's transition is a tab of its inspector («کلیپ | گذار»); the indicator sits inside the clip,
//     clear of the trim handle, and opens that tab; the tool is offered only when a clip starts right where this
//     one ends; a transition whose neighbour went away goes with it.
// =====================================================================================
var AMS = new Set(), AANCHOR = null, VMS = new Set(), VANCHOR = null, BGTAB = null;   // var: read by handlers in earlier files

// ---------- tracks: never the last of a kind
// 182: the spare track a tidy-up just dropped comes back as itself (its id and settings) — it was re-made with a new id
//      after every undo, redo and open, so a restored state never matched the saved one
function keepOneOfEach(prev){
  ['speech', 'track'].forEach(k => { const all = S.tracks.filter(t => t.kind === k), full = all.filter(t => t.clips.length);
    const old = (prev || []).find(t => t.kind === k && !t.clips.length && !S.tracks.some(x => x.id === t.id));
    const keep = full.length ? full : [all[0] || old || { id: (k === 'speech' ? 's' : 'r') + (++uid), name: '', en: '', kind: k, gapless: false, clips: [] }];
    S.tracks = S.tracks.filter(t => t.kind !== k || keep.includes(t)); keep.forEach(t => { if (!S.tracks.includes(t)) S.tracks.push(t); }); });
  renameTracks(); }
cleanupTracks = function(){ keepOneOfEach(); };
{ const _mt176 = migrateTracks; migrateTracks = function(){ const before = S.tracks.slice(), r = _mt176.apply(this, arguments); keepOneOfEach(before); return r; }; }
keepOneOfEach();
{ const _el176 = ensureLayers; ensureLayers = function(){ _el176.apply(this, arguments);
    const objs = V.layers.filter(l => l.kind === 'obj'), full = objs.filter(l => l.items.length);
    if (full.length){ objs.forEach(l => { if (l.keep) delete l.keep; }); if (full.length < objs.length) V.layers = V.layers.filter(l => l.kind !== 'obj' || l.items.length); }
    else if (objs.length){ objs[0].keep = true; if (objs.length > 1) V.layers = V.layers.filter(l => l.kind !== 'obj' || l === objs[0]); }
    else V.layers.unshift({ id: 'L' + (++uid), kind: 'obj', name: 'لایه', en: 'Layer', items: [], keep: true }); }; }

// ---------- duplicates: right after the original, on its track
dupClip = function(){ const [t, c] = findClip(selClip); if (!c) return; if (c.type === 'ovl') return ovlDup(); if (c.type) return dupMusic(); remember();
  const ids = c.lines.map(id => { const n = ++uid, L = JSON.parse(JSON.stringify(S.lines[id] || { text: '' })); if (Array.isArray(L.reacts)) L.reacts = L.reacts.map(r => ({ ...r, id: 'rx' + (++uid) })); S.lines[n] = L; return n; });
  const { _ti, _track, ...plain } = c, len = dur(c), n = { ...JSON.parse(JSON.stringify(plain)), id: 'c' + (++uid), lines: ids, at: c.at + len + GAP };   // (the clip's own track reference made the old copy throw)
  shiftAfter(t, c.at + len, len + GAP, c); t.clips.push(n); t.clips.sort((a, b) => a.at - b.at); if (t.gapless) pack(t);
  selClip = n.id; sel = new Set(ids); renderScript(); autosave(); };
dupMusic = function(){ const [t, c] = findClip(selClip); if (!c || (c.type !== 'music' && c.type !== 'sfx')) return; remember(); const len = c.out - c.in;
  const n = { ...JSON.parse(JSON.stringify({ ...c })), id: (c.type === 'music' ? 'mu' : 'sx') + (++uid), at: c.at + len };
  shiftAfter(t, c.at + len, len, c); t.clips.push(n); t.clips.sort((a, b) => a.at - b.at); if (c.type === 'music') S.music.manual = true; selClip = n.id; renderTimeline(); autosave(); };
function dupLine(){ const id = [...sel][0]; if (!id) return; const [t, c] = clipOfLine(id); if (!t || !c) return;
  if (c.lines.length === 1){ selClip = c.id; return dupClip(); }
  remember(); const n = ++uid, L = JSON.parse(JSON.stringify(S.lines[id])); delete L.reacts; L.dirty = false; S.lines[n] = L; placeholderAfter(t, c, [n]); sel = new Set([n]); renderScript(); autosave(); }
const _vDuplicate176 = vDuplicate;
vDuplicate = function(){ const o = objById(vSel); if (!o || o.end == null) return _vDuplicate176.apply(this, arguments);   // an object that lasts to the end has no «after»
  remember(); const L = layerOf(o.id), s0 = o.start || 0, len = o.end - s0, c = JSON.parse(JSON.stringify(o)); c.id = 'o' + (++uid); c.start = o.end; c.end = o.end + len;
  (L.items || []).map(objById).filter(x => x && x !== o && (x.start || 0) >= o.end - 0.001).forEach(x => { x.start = (x.start || 0) + len; if (x.end != null) x.end += len; });
  V.objects.push(c); if (L.items) L.items.splice(L.items.indexOf(o.id) + 1, 0, c.id); ensureLayers();
  if (o.show) layoutSlides(o.show, Math.min(...slidesOf(o.show).map(x => x.start || 0)));
  selectV(c.id); vChanged(); };

// ---------- shared pieces of a multi-selection
const multiKey = ev => ev.metaKey || ev.ctrlKey;
const hits = (el, R) => { const r = el.getBoundingClientRect(); return r.right > R.x1 && r.left < R.x2 && r.bottom > R.y1 && r.top < R.y2; };
function multiBar(els, n, fn){ const bar = $('clipBar'); if (!bar) return; if (!els.length){ bar.classList.add('hidden'); return; }
  bar.innerHTML = `<li><span class="ui pointer-events-none text-base-content/60">${T(`${FA(n)} کلیپ`, `${n} clips`)}</span></li><li><a onclick="${fn}" class="gap-1"><svg class="size-3.5"><use href="#i-trash-2"/></svg><span class="ui">${T('حذفِ همه', 'Delete all')}</span></a></li>`;
  const r = els.map(e => e.getBoundingClientRect()).sort((a, b) => a.top - b.top || a.left - b.left)[0], sc = $('tlScroll').getBoundingClientRect(), left0 = sc.left + $('heads').offsetWidth;
  if (r.bottom < sc.top || r.top > sc.bottom || r.right < left0 || r.left > sc.right){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden'); const bh = bar.offsetHeight || 34; let top = r.top - bh - 6; if (top < sc.top - bh / 2) top = r.bottom + 6; bar.style.top = top + 'px'; bar.style.left = Math.min(innerWidth - bar.offsetWidth - 8, Math.max(left0, r.left)) + 'px'; }
function marquee(ev, pick, done, click){   // pick(rect) while dragging; done() on release; click(ev) when it never became a marquee
  const lanes = $('lanes'), x0 = ev.clientX, y0 = ev.clientY; let box = null;
  const mv = e => { if (!box && Math.hypot(e.clientX - x0, e.clientY - y0) < 5) return;
    if (!box){ box = document.createElement('div'); box.className = 'tlmarquee pointer-events-none absolute z-30 rounded-sm border border-primary bg-primary/10'; lanes.appendChild(box); getSelection().removeAllRanges(); }
    const lr = lanes.getBoundingClientRect(), x1 = Math.min(x0, e.clientX), x2 = Math.max(x0, e.clientX), y1 = Math.min(y0, e.clientY), y2 = Math.max(y0, e.clientY);
    Object.assign(box.style, { left: (x1 - lr.left) + 'px', top: (y1 - lr.top) + 'px', width: (x2 - x1) + 'px', height: (y2 - y1) + 'px' }); pick({ x1, x2, y1, y2 }); };
  const up = e => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (!box) return click(e); box.remove(); done(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); }

// ---------- audio: several clips
function amsLines(){ const out = new Set(); AMS.forEach(id => { const [, c] = findClip(id); if (c && !c.type) c.lines.forEach(l => out.add(l)); }); return out; }
function amsSeed(){ if (AMS.size) return; if (selClip) AMS.add(selClip); else sel.forEach(l => { const [, c] = clipOfLine(l); if (c) AMS.add(c.id); }); }
function afterAMS(){
  if (AMS.size === 1){ const id = [...AMS][0]; AMS.clear(); const [, c] = findClip(id); selClip = id; sel = c && !c.type ? new Set(c.lines) : new Set(); paintSel(); if (c && c.type === 'music') showMusicInspector(); else if (c && c.type) showInsp('proj'); }
  else { selClip = null; sel = AMS.size ? amsLines() : new Set(); paintSel(); }
  renderTimeline(); }
function aRange(id){ const a = findClip(AANCHOR || selClip || id), b = findClip(id); if (!a[1] || !b[1]) return; const ta = S.tracks.indexOf(a[0]), tb = S.tracks.indexOf(b[0]);
  const t0 = Math.min(a[1].at, b[1].at), t1 = Math.max(a[1].at + dur(a[1]), b[1].at + dur(b[1]));
  S.tracks.forEach((t, i) => { if (i < Math.min(ta, tb) || i > Math.max(ta, tb)) return; t.clips.forEach(c => { if (c.at < t1 - 1e-6 && c.at + dur(c) > t0 + 1e-6) AMS.add(c.id); }); }); }
{ const _scd176 = startClipDrag; startClipDrag = function(ev, el){ const id = el.dataset.cid;
    if (multiKey(ev) || ev.shiftKey){ ev.stopPropagation(); ev.preventDefault(); getSelection().removeAllRanges(); amsSeed();
      if (ev.shiftKey && !multiKey(ev)) aRange(id); else { AMS.has(id) ? AMS.delete(id) : AMS.add(id); AANCHOR = id; }
      afterAMS(); return; }
    if (AMS.size > 1 && AMS.has(id)) return aGroupDrag(ev, el);
    AMS.clear(); AANCHOR = id; return _scd176.apply(this, arguments); }; }
function aGroupDrag(ev, el){ ev.stopPropagation(); if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur(); getSelection().removeAllRanges(); const step = dragStep(), sc = tlSc(), sl0 = sc.scrollLeft;   // 182: edge scrolling, Esc
  const items = [...AMS].map(findClip).filter(x => x[1]).map(([t, c]) => ({ t, c, at0: c.at })), x0 = ev.clientX, lo = Math.min(...items.map(x => x.at0)); let moved = false; OVL_DRAG = true;
  const AS = autoScroller(e => mv(e));
  const mv = e => { const dx = e.clientX - x0 + sc.scrollLeft - sl0; if (Math.abs(dx) > 3) moved = true; if (!moved) return; const d = Math.max(-lo, dx / zoom);
    items.forEach(({ c, at0 }) => { c.at = at0 + d; const x = document.querySelector(`#lanes .clip[data-cid="${c.id}"]`); if (x) x.style.left = (PAD + c.at * zoom) + 'px'; }); AS.move(e); };
  DRAG_ESC = () => { AS.stop(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); OVL_DRAG = false; step.cancel(); renderScript(); };
  const up = () => { AS.stop(); DRAG_ESC = null; removeEventListener('pointermove', mv); removeEventListener('pointerup', up); OVL_DRAG = false;
    if (!moved){ step.drop(); AMS.clear(); AMS.add(el.dataset.cid); afterAMS(); return; }
    const lines = amsLines(), clash = (t, c) => t.clips.some(x => x !== c && x.type !== 'ovl' && x.at < c.at + dur(c) - 1e-6 && x.at + dur(x) > c.at + 1e-6);
    items.forEach(({ t, c }) => { if (c.type === 'ovl' || !clash(t, c)) return; t.clips = t.clips.filter(x => x !== c); freeTrack(c).clips.push(c); });   // never two clips on one spot of one track
    items.forEach(({ c }) => { if (c.type !== 'ovl' || lines.has(c.line)) return; const [id, r] = rFind(c.rid || c.id); if (r) placeReact(r, id, c.at); });   // a reaction whose line moved along simply follows it
    if (items.some(x => x.c.type === 'music')) S.music.manual = true;
    S.tracks.forEach(t => t.clips.sort((a, b) => a.at - b.at)); cleanupTracks(); sel = amsLines(); renderScript(); autosave(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); }
function aDeleteMany(){ if (AMS.size < 2) return false; remember(); let music = false;
  [...AMS].forEach(id => { const [t, c] = findClip(id); if (!c) return;
    if (c.type === 'ovl'){ const [lid, r] = rFind(c.rid || c.id); if (r) S.lines[lid].reacts = reactsOf(lid).filter(x => x !== r); }
    else if (!c.type) c.lines.forEach(l => { delete S.lines[l]; sel.delete(l); });
    if (c.type === 'music') music = true; t.clips = t.clips.filter(x => x !== c); });
  AMS.clear(); selClip = null; sel = new Set();
  if (music){ S.music.manual = true; if (!musicClips().length){ S.music.file = null; S.music.name = null; musicBuf = null; } }
  cleanupTracks(); ensureOneLine(); renderScript(); autosave(); silenceAfterDelete(); return true; }
{ const _rt176 = renderTimeline; renderTimeline = function(){ const r = _rt176.apply(this, arguments);
    if (mode !== 'video' && AMS.size > 1) document.querySelectorAll('#lanes .clip[data-cid]').forEach(el => { if (AMS.has(el.dataset.cid)) el.classList.add('outline-2', 'outline-primary!'); }); return r; }; }
{ const _pcb176 = placeClipBar; placeClipBar = function(){ if (mode !== 'video' && AMS.size > 1) return multiBar([...AMS].map(id => document.querySelector(`#lanes .clip[data-cid="${id}"]`)).filter(Boolean), AMS.size, 'aDeleteMany()'); return _pcb176.apply(this, arguments); }; }
{ const _wt176 = wireTimeline; wireTimeline = function(){ const r = _wt176.apply(this, arguments); const lanes = $('lanes');
    lanes.onpointerdown = ev => { if (!(ev.target.id === 'lanes' || ev.target.classList.contains('lane'))) return; const add = multiKey(ev) || ev.shiftKey; if (add) amsSeed(); const keep = add ? new Set(AMS) : new Set();
      marquee(ev, R => { AMS.clear(); keep.forEach(id => AMS.add(id)); document.querySelectorAll('#lanes .clip[data-cid]').forEach(el => { if (hits(el, R)) AMS.add(el.dataset.cid); el.classList.toggle('tl-ms', AMS.has(el.dataset.cid)); }); },
        () => afterAMS(), () => { AMS.clear(); selClip = null; sel = new Set(); paintSel(); renderTimeline(); }); };
    return r; }; }
document.addEventListener('pointerdown', ev => { if (AMS.size && ev.target.closest && ev.target.closest('#editor')) AMS.clear(); }, true);   // a click in the script starts over

// ---------- video: several clips
function afterVMS(){ if (VMS.size === 1){ const id = [...VMS][0]; VMS.clear(); selectV(id); return; } if (!VMS.size){ selectV(null); return; }
  vSel = null; placeSelBox(); showVPanels(); renderTimeline(); }
function vRange(id){ const TR = vTracks(), li = x => TR.findIndex(t => t.items && t.items.includes(x)), a = objById(VANCHOR || vSel || id), b = objById(id); if (!a || !b) return;
  const la = li(a.id), lb = li(b.id), end = o => o.end == null ? projEnd() : o.end, t0 = Math.min(a.start || 0, b.start || 0), t1 = Math.max(end(a), end(b));
  TR.forEach((t, i) => { if (!t.items || i < Math.min(la, lb) || i > Math.max(la, lb)) return; t.items.map(objById).filter(Boolean).forEach(o => { if ((o.start || 0) < t1 - 1e-6 && end(o) > t0 + 1e-6) VMS.add(o.id); }); }); }
function vMultiDown(ev, el){ const k = el.dataset.k, id = el.dataset.id;
  if (k !== 'obj'){ if (VMS.size && !multiKey(ev) && !ev.shiftKey) VMS.clear(); return false; }
  if (multiKey(ev) || ev.shiftKey){ ev.stopPropagation(); ev.preventDefault(); if (!VMS.size && vSel && objById(vSel)) VMS.add(vSel);
    if (ev.shiftKey && !multiKey(ev)) vRange(id); else { VMS.has(id) ? VMS.delete(id) : VMS.add(id); VANCHOR = id; }
    afterVMS(); return true; }
  if (VMS.size > 1 && VMS.has(id)){ ev.stopPropagation(); vGroupDrag(ev, el); return true; }
  VMS.clear(); VANCHOR = id; return false; }
function vGroupDrag(ev, el){ const step = dragStep(), sc = tlSc(), sl0 = sc.scrollLeft; const lanes = $('lanes'), x0 = ev.clientX, ids = new Set(VMS); let moved = false;   // 182: edge scrolling, Esc
  [...ids].forEach(id => { const o = objById(id); if (o && o.show) slidesOf(o.show).forEach(s => ids.add(s.id)); });   // a slide moves with its slideshow
  const items = [...ids].map(objById).filter(Boolean).map(o => ({ o, s0: o.start || 0, e0: o.end })), lo = Math.min(...items.map(x => x.s0));
  const AS = autoScroller(e => mv(e));
  const mv = e => { const dx = e.clientX - x0 + sc.scrollLeft - sl0; if (Math.abs(dx) > 2) moved = true; if (!moved) return; const d = Math.max(-lo, dx / zoom);
    items.forEach(({ o, s0, e0 }) => { o.start = s0 + d; if (e0 != null) o.end = e0 + d; const x = lanes.querySelector(`.vclip[data-id="${o.id}"]`); if (x) x.style.left = (PAD + o.start * zoom) + 'px'; }); AS.move(e); };
  DRAG_ESC = () => { AS.stop(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); step.cancel(); renderTimeline(); vDraw(); };
  const up = () => { AS.stop(); DRAG_ESC = null; removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (!moved){ step.drop(); VMS.clear(); selectV(el.dataset.id); return; }
    items.forEach(({ o }) => { const L = layerOf(o.id); if (!L.items || L.kind === 'bg') return;   // an object now on top of another one on its layer gets a new layer above
      if (L.items.some(id => id !== o.id && !ids.has(id) && overlap(objById(id), o))){ L.items = L.items.filter(x => x !== o.id); V.layers.splice(V.layers.indexOf(L), 0, { id: 'L' + (++uid), kind: L.kind, name: L.name, en: L.en, items: [o.id] }); } });
    ensureLayers(); dropOrphanTrans(); renderTimeline(); vDraw(); autosave(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); }
function vDeleteMany(){ if (VMS.size < 2) return false; remember(); const ids = new Set(VMS), shows = {};
  ids.forEach(id => { const o = objById(id); if (o && o.show && !(o.show in shows)) shows[o.show] = Math.min(...slidesOf(o.show).map(x => x.start || 0)); });
  const spans = {}; Object.keys(shows).forEach(s => { spans[s] = Math.max(...slidesOf(s).map(x => x.end || 0)); });
  V.objects = V.objects.filter(o => !ids.has(o.id)); Object.keys(shows).forEach(s => { if (slidesOf(s).length) keepShowLength(s, shows[s], spans[s]); });   // 177: each slideshow keeps its length
  VMS.clear(); selectV(null); vChanged(); return true; }
function vMarquee(ev){ const add = multiKey(ev) || ev.shiftKey; if (add && !VMS.size && vSel && objById(vSel)) VMS.add(vSel); const keep = add ? new Set(VMS) : new Set(), lanes = $('lanes');
  marquee(ev, R => { VMS.clear(); keep.forEach(id => VMS.add(id)); lanes.querySelectorAll('.vclip[data-k="obj"]').forEach(el => { if (hits(el, R)) VMS.add(el.dataset.id); el.classList.toggle('tl-ms', VMS.has(el.dataset.id)); }); },
    () => afterVMS(), e => { VMS.clear(); const r = lanes.getBoundingClientRect(); selectV(null); seek(Math.max(0, (e.clientX - r.left - PAD) / zoom)); });
  return true; }
{ const _sv176 = selectV; selectV = function(){ if (VMS.size) VMS.clear(); return _sv176.apply(this, arguments); }; }
{ const _pvb176 = placeVObjBar; placeVObjBar = function(){ if (mode === 'video' && VMS.size > 1) return multiBar([...VMS].map(id => document.querySelector(`#lanes .vclip[data-id="${id}"]`)).filter(Boolean), VMS.size, 'vDeleteMany()'); return _pvb176.apply(this, arguments); }; }
addEventListener('keydown', e => { if (mode !== 'video' || VMS.size < 2) return; const t = e.target; if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || document.querySelector('dialog[open]')) return;
  if (e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); e.stopImmediatePropagation(); vDeleteMany(); }
  else if (e.key === 'Escape'){ e.stopImmediatePropagation(); VMS.clear(); selectV(null); } }, true);

// ---------- a media clip trims within its source
function srcLen(o){ if (o.type === 'video' && !o.loop){ const m = MEDIA.get(o.asset), el = m && m.el; return el && isFinite(el.duration) && el.duration > 0 ? el.duration : null; }
  if (o.type === 'sfx'){ const it = sfxItems().find(x => x.file === o.file); return it && it.sec ? it.sec : null; }
  if (o.type === 'audio' && !o.loop) return typeof vAudNat === 'function' ? vAudNat(o) : (o.nat || null);   // 182: an audio file on a layer
  return null; }

// 177: a slideshow keeps its length when slides go — the time they had is shared equally by the slides left
function keepShowLength(id, first, endOld){ const rest = slidesOf(id); if (!rest.length) return; const sum = rest.reduce((a, x) => a + ((x.end || 0) - (x.start || 0)), 0), add = (endOld - first - sum) / rest.length;
  let t = first; rest.forEach((x, i) => { const d = Math.max(0.2, ((x.end || 0) - (x.start || 0)) + add); x.start = t; x.end = i === rest.length - 1 ? endOld : t + d; t = x.end;
    if (i < rest.length - 1){ if (!x.trans) x.trans = { type: 'fade', dur: 0.8, params: {} }; } else delete x.trans; }); }
// ---------- background clips: transitions only between two clips that touch; a slide's removal closes the gap
const bgNextOf = o => { const L = bgClips(), i = L.indexOf(o), nx = i >= 0 ? L[i + 1] : null; return nx && Math.abs((nx.start || 0) - (o.end ?? projEnd())) <= 0.06 ? nx : null; };
function dropOrphanTrans(){ let n = 0; bgClips().forEach(o => { if (o.trans && !bgNextOf(o)){ delete o.trans; n++; } }); return n; }
{ const _vc176 = vChanged; vChanged = function(){ dropOrphanTrans(); return _vc176.apply(this, arguments); }; }
{ const _vd176 = vDelete; vDelete = function(){ const o = objById(vSel); if (!o || !o.show) return _vd176.apply(this, arguments);
    remember(); const id = o.show, L = slidesOf(id), first = Math.min(...L.map(x => x.start || 0)), endOld = Math.max(...L.map(x => x.end || 0)), len = (o.end || 0) - (o.start || 0);
    V.objects = V.objects.filter(x => x !== o); const rest = slidesOf(id);
    if (rest.length) keepShowLength(id, first, endOld);   // 177: the slideshow keeps its length
    else bgClips().filter(x => x.show !== id && (x.start || 0) >= endOld - 0.06).forEach(x => { x.start = (x.start || 0) - len; if (x.end != null) x.end -= len; });   // the last slide: what came after closes up
    selectV(null); vChanged(); }; }

// ---------- a background clip's inspector: «کلیپ | گذار»
const bgTabOf = o => BGTAB && BGTAB.id === o.id ? BGTAB.tab : 'clip';
function openBgTab(id, tab){ BGTAB = { id, tab, fresh: true }; if (vSel !== id) selectV(id); else showVPanels(); if (BGTAB) BGTAB.fresh = false; }
// 182: selecting a clip again lands on its main panel — the tab it was last on (the transition) stayed open for good
{ const _sv182 = selectV; selectV = function(id){ if (BGTAB && !(BGTAB.fresh && BGTAB.id === id) && id !== vSel) BGTAB = null; return _sv182.apply(this, arguments); }; }
function bgTabsEl(){ let el = $('iv-bgtabs'); if (!el){ el = document.createElement('div'); el.id = 'iv-bgtabs'; el.setAttribute('role', 'tablist'); el.className = 'tabs tabs-border hidden px-2 pt-1'; const host = $('vinsp'); if (host) host.insertBefore(el, host.firstChild); } return el; }
function bgPipLook(on){ const p = $('iv-pip'); if (!p) return; const o = on ? objById(vSel) : null;
  /* 177: a background clip always covers the canvas — no corners, stroke or shadow (the 177 panel's own sections) */
  [$('pipRad') && $('pipRad').closest('fieldset'), $('pipBorder') && $('pipBorder').closest('.border-t'), $('pipShadow') && $('pipShadow').closest('.border-t')].forEach(x => x && x.classList.toggle('hidden', !!on));
  const t = $('pipTitle'); if (t && o) t.textContent = o.show ? T('اسلاید', 'Slide') : o.type === 'video' ? T('ویدیوی پس‌زمینه', 'Background video') : T('تصویرِ پس‌زمینه', 'Background picture');
  const hint = [...p.children].reverse().find(x => x.tagName === 'P'); if (hint) hint.textContent = on ? T('روی صفحه بکشید تا تصویر داخلِ قاب جابه‌جا شود.', 'Drag on the canvas to move the picture within the frame.') : T('برای جابه‌جایی، روی صفحه بکشیدش.', 'Drag it on the canvas to place it anywhere.'); }
// 177 · TRANSITIONS LIKE ANIMATIONS: a grid of tiles, each with a picture of the transition half-way between THIS clip and
//       the next one; hovering a tile loops it on the canvas (the playhead stays where it is), a click chooses it and
//       plays it once; a choice of a value (direction, corner…) is a row of buttons — never a list inside a list
var TRPV = null, TRHOV = 0, TRTH = { key: '', urls: {}, busy: 0 };
const TR_DIRIC = { 180: '#i-arrow-left', 0: '#i-arrow-right', 90: '#i-arrow-down', 270: '#i-arrow-up', 135: '#i-arrow-down-left', 45: '#i-arrow-down-right', 225: '#i-arrow-up-left', 315: '#i-arrow-up-right' };
function trKeys(){ const LIB = AvaTrans.LIB, keys = Object.keys(LIB).filter(k => !LIB[k].scene);
  return [[T('ساده', 'Simple'), ['none', 'fade', ...keys.filter(k => k === 'push')]], [T('سینمایی', 'Cinematic'), keys.filter(k => k !== 'push' && !LIB[k].sc)], [T('وایپ و محو', 'Wipes and dissolves'), keys.filter(k => LIB[k].sc)]]; }
// 179 · a chosen preset only shows its adjust icon; its settings open on that icon (the founder), in the same panel at the
//       foot of the inspector as before, with the preset's name, a reset-all icon and a close button (Esc closes it too)
var TRADJ = null;   // the clip whose transition settings are open
// 182: light on the (dark) picture in both themes, and always in the picture's top-left corner (English moved it right)
function adjIcon(on, open, fn){ return on ? `<span role="button" tabindex="0" class="adjic absolute left-1 top-1 z-[2] grid size-6 place-items-center rounded-full border shadow-sm ${open ? 'border-transparent bg-white text-primary' : 'border-black/10 bg-white/90 text-neutral-900 hover:bg-white'}" onclick="event.stopPropagation(); ${fn}" onkeydown="if (event.key === 'Enter' || event.key === ' '){ event.preventDefault(); event.stopPropagation(); ${fn} }" data-tip="${open ? 'بستنِ تنظیم‌ها' : 'تنظیم‌ها'}" data-tip-en="${open ? 'Close the settings' : 'Adjust'}" aria-label="adjust" aria-expanded="${open ? 'true' : 'false'}"><svg class="pointer-events-none size-3.5"><use href="#i-sliders-horizontal"/></svg></span>` : ''; }
function adjHead(name, changed, resetFn, closeFn){ return `<div class="flex items-center gap-1"><p class="min-w-0 flex-1 truncate text-sm font-semibold">${escapeHtml(name)}</p>`
  + `<button type="button" class="adjrst btn btn-ghost btn-xs btn-square ${changed ? 'text-primary' : 'opacity-50 hover:opacity-100'}" onclick="${resetFn}" data-tip="بازنشانیِ همهٔ تنظیم‌های این پیش‌تنظیم" data-tip-en="Reset all of this preset's settings" aria-label="reset all"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>`
  + `<button type="button" class="adjx btn btn-ghost btn-xs btn-square" onclick="${closeFn}" data-tip="بستن (Esc)" data-tip-en="Close (Esc)" aria-label="close"><svg class="size-4"><use href="#i-x"/></svg></button></div>`; }
function trTile(k, on){ const url = TRTH.urls[k], name = k === 'none' ? T('بدونِ گذار', 'None') : trName(k);
  const pic = k === 'none' ? `<span class="grid h-full w-full place-items-center"><svg class="size-4 opacity-70"><use href="#i-ban"/></svg></span>` : url ? `<img src="${url}" alt="" class="block h-full w-full object-cover" draggable="false">` : '';
  return `<button type="button" class="trtile btn btn-sm h-auto min-h-0 flex-col gap-1 p-1 pb-1.5 text-[11px] font-medium leading-normal ${on ? 'btn-primary' : 'border-base-content/10 bg-base-100'}" data-tr="${k}" onclick="trPick('${k}')" onmouseenter="trHover('${k}')" onmouseleave="trHoverEnd()">`
    + `<span class="relative block w-full">${adjIcon(on && k !== 'none', TRADJ === vSel, 'trAdj()')}<span class="trthumb block aspect-video w-full overflow-hidden rounded-[5px] bg-base-300" data-th="${k}">${pic}</span></span><span class="block w-full overflow-visible break-words text-center">${escapeHtml(name)}</span></button>`; }
function trAdj(){ const o = objById(vSel); if (!o) return; TRADJ = TRADJ === o.id ? null : o.id; fillBgTransTab(o); }
function trAdjClose(){ if (!TRADJ) return false; TRADJ = null; const o = objById(vSel); if (o) fillBgTransTab(o); return true; }
function trResetAll(){ const o = objById(vSel); if (!o || !o.trans) return; remember(); o.trans.params = {}; o.trans.dur = 0.8; renderTimeline(); vChanged(); fillBgTransTab(o); previewTrans(o); }
function trChanged(tr){ if (!tr) return false; const TP = AvaTrans.TP[tr.type] || []; return Math.abs((tr.dur || 0.8) - 0.8) > 1e-6 || TP.some(([k, , , , , d]) => { const v = (tr.params || {})[k]; return v != null && +v !== +d; }); }
function trSeg(k, opts, v){ const pick = ov => `setBgTrans('p:${k}', ${+ov})`;
  if (opts.length === 8 && opts.every(([ov]) => TR_DIRIC[ov])){   // eight directions: arrows on a compass (the way it moves)
    const by = {}; opts.forEach(o => { by[+o[0]] = o; });
    return `<div class="trdir grid w-fit grid-cols-3 gap-1" dir="ltr">${[225, 270, 315, 180, null, 0, 135, 90, 45].map(ov => { const o = ov == null ? null : by[ov]; if (!o) return '<span class="grid size-8 place-items-center"><span class="size-1.5 rounded-full bg-base-content/25"></span></span>';
      return `<button type="button" class="btn btn-sm btn-square ${+ov === +v ? 'btn-primary' : 'border-base-content/15 bg-base-100'}" data-tip="${escapeHtml(T(o[2], o[1]))}" aria-label="${escapeHtml(o[1])}" onclick="${pick(ov)}"><svg class="size-4"><use href="${TR_DIRIC[ov]}"/></svg></button>`; }).join('')}</div>`; }
  const btn = ([ov, en, fa]) => `<button type="button" class="btn btn-sm h-auto min-h-8 whitespace-normal px-1.5 py-1 text-xs font-medium leading-snug ${opts.length <= 3 ? 'join-item flex-1' : ''} ${+ov === +v ? 'btn-primary' : 'border-base-content/15 bg-base-100'}" onclick="${pick(ov)}">${escapeHtml(T(fa, en))}</button>`;
  return opts.length <= 3 ? `<div class="join w-full">${opts.map(btn).join('')}</div>` : `<div class="grid grid-cols-2 gap-1">${opts.map(btn).join('')}</div>`; }
function fillBgTransTab(o){ const box = $('iv-fx'); if (!box) return; const nx = bgNextOf(o);
  const head = `<div class="flex items-center gap-2"><svg class="size-4"><use href="#i-sparkles"/></svg><span class="flex-1 text-sm font-bold">${T('گذار به کلیپِ بعدی', 'Transition to the next clip')}</span></div>`;
  if (!nx){ box.innerHTML = head + `<p class="text-xs leading-relaxed text-base-content/60">${T('هیچ کلیپی درست جایی که این کلیپ تمام می‌شود شروع نمی‌شود. گذار دو کلیپِ پس‌زمینهٔ چسبیده به هم را به هم وصل می‌کند.', 'No clip starts right where this one ends. A transition joins two background clips that touch.')}</p>`; return; }
  const tr = o.trans || null, LIB = AvaTrans.LIB, cur = tr ? tr.type : 'none';
  let h = head + `<p class="text-xs leading-relaxed text-base-content/60">${T('نشانگر را روی هر گذار ببرید تا روی صفحه ببینیدش؛ با کلیک انتخاب می‌شود.', 'Hover a transition to see it on the canvas; click to choose it.')}</p>`;
  trKeys().forEach(([g, ks]) => { h += `<div class="space-y-1.5"><p class="text-xs font-semibold text-base-content/60">${escapeHtml(g)}</p><div class="grid grid-cols-3 gap-1.5">${ks.map(k => trTile(k, k === cur)).join('')}</div></div>`; });
  if (TRADJ && TRADJ !== o.id) TRADJ = null;
  if (tr && TRADJ === o.id){ const TP = AvaTrans.TP[tr.type] || [], L = LIB[tr.type], lbl = en => T((AvaTrans.TPFA || {})[en] || en, en), about = tr.type === 'fade' || !L ? T('کلیپِ بعدی آرام روی کلیپِ فعلی پیدا می‌شود.', 'The next clip fades in over the current one.') : T(L.aboutFa || L.about || '', L.aboutEn || L.about || '');
    const ctl = ([k, label, min, max, step, d, , opts]) => { const v = (tr.params || {})[k] ?? d;
      return `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${escapeHtml(lbl(label))}</legend>` + (opts ? trSeg(k, opts, v)
        : `<input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-def="${d}" class="${RNG}" onchange="setBgTrans('p:${k}', +this.value)">`) + `</fieldset>`; };
    /* the chosen transition's options stay in view at the foot of the panel while the tiles scroll (as in Animation) */
    h += `<div class="adjpanel sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-base-300 bg-base-200 px-4 pb-3 pt-2 shadow-[0_-8px_16px_-12px_rgba(0,0,0,.5)]">${adjHead(trName(tr.type), trChanged(tr), 'trResetAll()', 'trAdjClose()')}<p class="text-xs leading-relaxed text-base-content/60">${escapeHtml(about)}</p>`
      + `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('مدت', 'Length')}</legend><input type="range" data-unit="s" min="0.2" max="3" step="0.1" value="${tr.dur || 0.8}" data-def="0.8" class="${RNG}" onchange="setBgTrans('dur', +this.value)"></fieldset>${TP.map(ctl).join('')}</div>`; }
  box.innerHTML = h; if (typeof rangeLabels === 'function') rangeLabels(box); if (typeof vResets === 'function') vResets(box); trThumbs(o, nx); }   // 179: the settings open from the adjust icon (not through showVPanels): their sliders get their reset icons here
// the tiles' pictures: both clips drawn small at the cut, every transition rendered half-way — once per pair of clips,
// a few at a time so the panel never waits
async function trThumbs(o, nx){ const cv = $('vcanvas'), W = 160, H = Math.max(40, Math.round(160 * ((cv && cv.height) || 1080) / ((cv && cv.width) || 1920)));
  const key = [o.id, o.asset || o.type, o.panX, o.panY, nx.id, nx.asset || nx.type, nx.panX, nx.panY, W, H, JSON.stringify(V.pod && { s: V.pod.style, b: V.pod.bg, p: V.pod.pal, c: V.pod.custom, so: V.pod.solid })].join('|');
  if (TRTH.key !== key){ TRTH = { key, urls: {}, busy: 0 }; } const job = ++TRTH.busy, mine = () => TRTH.key === key && TRTH.busy === job && vSel === o.id;
  const ks = trKeys().flatMap(x => x[1]).filter(k => k !== 'none' && !TRTH.urls[k]); if (!ks.length) return;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; }, ca = mk(), cb = mk(), cut = o.end ?? projEnd();
  try { await drawBgClip(ca.getContext('2d'), o, W, H, Math.max(o.start || 0, cut - 0.04), false, [], V.pod, o.type === 'pod' ? o : null);
        await drawBgClip(cb.getContext('2d'), nx, W, H, cut + 0.04, false, [], V.pod, nx.type === 'pod' ? nx : null); } catch (err) { console.warn('transition thumbnails', err); return; }
  for (const k of ks){ if (!mine()) return; const out = mk();
    try { blendTr(out.getContext('2d'), W, H, ca, cb, 0.5, { type: k, params: {} }, 0.5); TRTH.urls[k] = out.toDataURL('image/jpeg', 0.82); } catch (err) { continue; }
    const el = document.querySelector(`#iv-fx .trthumb[data-th="${k}"]`); if (el) el.innerHTML = `<img src="${TRTH.urls[k]}" alt="" class="block h-full w-full object-cover" draggable="false">`;
    await new Promise(r => setTimeout(r, 0)); } }
function trTrOf(o, k){ if (k === 'none') return null; const tr = o.trans || {}; return { type: k, dur: tr.dur || 0.8, params: tr.type === k ? (tr.params || {}) : {} }; }
function trHover(k){ clearTimeout(TRHOV); TRHOV = setTimeout(() => { const o = objById(vSel); if (!o || !o.bgl) return; trPreview(o, trTrOf(o, k), true); }, 140); }
function trHoverEnd(){ clearTimeout(TRHOV); if (TRPV && TRPV.loop) trPreviewStop(); }
function trPick(k){ clearTimeout(TRHOV); trPreviewStop(true); const o = objById(vSel), cur = o && o.trans && o.trans.type ? o.trans.type : 'none';
  if (k === cur){ if (o && o.trans) previewTrans(o); return; }   // 179: the chosen one again keeps its settings (it used to reset them)
  TRADJ = null; setBgTransKind(k === 'none' ? '' : k); }
// the canvas plays the cut ±½ s with this transition and the playhead stays (looping while hovered, once after a choice)
function trPreview(o, tr, loop){ trPreviewStop(true); if (typeof animPreviewStop === 'function') animPreviewStop(true); if (playing || mode !== 'video') return;
  const cut = o.end ?? projEnd(), d = tr ? Math.max(0.1, tr.dur || 0.8) : 0.6, t0 = Math.max(0, cut - d / 2 - 0.5), t1 = cut + d / 2 + 0.5;
  const P = TRPV = { id: o.id, tr, t0, t1, loop, start: performance.now(), raf: 0 };
  const tick = async () => { if (TRPV !== P) return; if (playing){ trPreviewStop(); return; } const el = (performance.now() - P.start) / 1000, len = t1 - t0, cyc = len + 0.4;
    await vDrawAt(t0 + Math.min(len, loop ? el % cyc : el)); if (TRPV !== P) return;
    if (!loop && el >= cyc){ TRPV = null; vDraw(); return; } P.raf = requestAnimationFrame(tick); };
  P.raf = requestAnimationFrame(tick); }
function trPreviewStop(silent){ const P = TRPV; if (!P) return; TRPV = null; cancelAnimationFrame(P.raf); if (!silent) vDraw(); }
previewTrans = function(o){ trPreview(o, o && o.trans && o.trans.type ? o.trans : null, false); };
function setBgTransKind(k){ const o = objById(vSel); if (!o) return;
  if (!k){ if (o.trans){ remember(); delete o.trans; renderTimeline(); vChanged(); showVPanels(); } return; }
  if (!o.trans){ if (!bgNextOf(o)) return; remember(); o.trans = { type: k, dur: 0.8, params: {} }; renderTimeline(); vChanged(); showVPanels(); previewTrans(o); return; }
  setBgTrans('type', k); }
showTransPanel = function(o){ openBgTab(o.id, 'trans'); };
function bgPanels(anim){ const tabs = bgTabsEl(), o = vSel && vSel !== 'SUB' && vSel !== 'MIX' ? objById(vSel) : null;
  if (!o || !o.bgl || anim || mode !== 'video'){ tabs.classList.add('hidden'); bgPipLook(false); return; }
  const tab = bgTabOf(o); tabs.classList.remove('hidden');
  tabs.innerHTML = `<a role="tab" class="tab ${tab === 'clip' ? 'tab-active' : ''}" onclick="openBgTab('${o.id}', 'clip')">${T('کلیپ', 'Clip')}</a><a role="tab" class="tab gap-1 ${tab === 'trans' ? 'tab-active' : ''}" onclick="openBgTab('${o.id}', 'trans')">${T('گذار', 'Transition')}${o.trans && bgNextOf(o) ? '<svg class="size-3 text-primary"><use href="#i-sparkles"/></svg>' : ''}</a>`;
  if (tab === 'trans'){ ['iv-proj', 'iv-text', 'iv-sticker', 'iv-pod', 'iv-pip', 'iv-anim', 'iv-sub', 'iv-xform', 'iv-sfx', 'iv-animrow', 'iv-mix'].forEach(id => $(id) && $(id).classList.add('hidden')); fillBgTransTab(o); $('iv-fx').classList.remove('hidden'); return; }
  $('iv-fx').classList.add('hidden'); if (o.type === 'image' || o.type === 'video'){ $('iv-xform').classList.add('hidden'); bgPipLook(true); } else bgPipLook(false); }
{ const _svp176 = showVPanels; showVPanels = function(anim){ const r = _svp176.apply(this, arguments); try { bgPanels(anim); } catch (err) { console.warn(err); } return r; }; }
{ const _psb176 = placeSelBox; placeSelBox = function(){ const r = _psb176.apply(this, arguments); const o = mode === 'video' && vSel && vSel !== 'SUB' && vSel !== 'MIX' ? objById(vSel) : null, sb = $('selbox');
    if (sb && o && o.bgl && (o.type === 'image' || o.type === 'video')) sb.querySelectorAll('[data-h], #vrot').forEach(x => x.classList.add('hidden')); return r; }; }   // it always covers the canvas: nothing to resize or turn
