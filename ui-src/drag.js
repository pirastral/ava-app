// =====================================================================================
// 182 · MOVING CLIPS (the founder's items 26, 38 and 39)
//   · EVERY DRAG on the timeline (a clip, a trim handle, several clips) scrolls the timeline when the pointer reaches its
//     left or right edge — and the right end grows — so the drag goes on; Esc puts everything back where it was.
//   · WHERE A CLIP LANDS: the BACKGROUND track is magnetic (dropped between two clips, the later ones make room; taken
//     out, the gap it leaves closes); a SPEECH track is magnetic when «gapless» is on (the script follows the timeline
//     order); every other track is free — the clip lands where it is dropped (snapping when Snap is on), and when that
//     spot is taken it gets a new track right there; nothing else moves. The clip follows the pointer and the track it
//     would land on lights up. Same track or another track.
//   · VIDEO MODE: pictures, videos and podcast designs move between the regular tracks and the background track — onto
//     the background a picture or video fills the canvas (cover) and a podcast design is a podcast style again (its
//     background options back, as they were); off it a picture or video is a picture on top again (its old box when it
//     had one) and a podcast design a template (no background).
// =====================================================================================
const tlSc = () => $('tlScroll');
// the step a drag takes: drop() when it turned out to be a click, cancel() for Esc (everything as it was)
function dragStep(){ const top0 = hist.past[hist.past.length - 1]; remember(); const top1 = hist.past[hist.past.length - 1], added = !!top1 && top1 !== top0;
  return { drop(){ if (added && hist.past[hist.past.length - 1] === top1) dropStep(); },
           cancel(){ if (!top1) return; if (added && hist.past[hist.past.length - 1] === top1){ hist.past.pop(); hist.bytes -= top1.size; hist._last = null; histTell(); restoreSnap(top1.sn); } else restoreSnap(JSON.parse(JSON.stringify(top1.sn))); } }; }
// Esc during a drag: DRAG_ESC (declared in editor.js, whose Esc listener runs before every other key handler)
// the track under the pointer (looking through the floating clip toolbar, which sits right over the track above)
function laneAt(x, y){ for (const e of document.elementsFromPoint(x, y)){ const l = e.closest && e.closest('#lanes .lane'); if (l) return l; } return null; }
const hideBars = () => { const b = $('clipBar'); if (b) b.classList.add('hidden'); };
// the right end grows while something is dragged past it
function growLanes(px){ const L = $('lanes'), Rl = $('ruler'); if (L && (parseFloat(L.style.width) || L.offsetWidth) < px){ L.style.width = px + 'px'; if (Rl) Rl.style.width = px + 'px'; } }
// the pointer at the left or right edge scrolls the timeline; tick(lastEvent) moves the dragged thing on
function autoScroller(tick){ const sc = tlSc(); let last = null, raf = 0, on = true;
  const edges = () => { const r = sc.getBoundingClientRect(), hw = ($('heads') && $('heads').offsetWidth) || 0; return [r.left + hw + 28, r.right - 28]; };
  const step = () => { raf = 0; if (!on || !last) return; const [L, Rr] = edges(), x = last.clientX; let d = 0;
    if (x > Rr) d = Math.min(32, (x - Rr) / 2 + 4); else if (x < L && sc.scrollLeft > 0) d = -Math.min(32, (L - x) / 2 + 4);
    if (!d) return; if (d > 0) growLanes(sc.scrollLeft + sc.clientWidth + d + 240);
    const before = sc.scrollLeft; sc.scrollLeft = Math.max(0, before + d); if (sc.scrollLeft !== before){ tick(last); if (on && !raf) raf = requestAnimationFrame(step); } };   // (tick → move may have asked for the next frame already)
  return { move(e){ last = e; if (on && !raf) raf = requestAnimationFrame(step); }, stop(){ on = false; if (raf) cancelAnimationFrame(raf); raf = 0; } }; }

// =====================================================================================
// THE AUDIO MODE — one clip (several clips, the reactions: as before, now with edge scrolling and Esc too)
// =====================================================================================
{ const _scd182 = startClipDrag; startClipDrag = function(ev, el){ const id = el.dataset.cid, [t, c] = findClip(id);
    if (!c || c.type === 'ovl' || multiKey(ev) || ev.shiftKey || (AMS.size > 1 && AMS.has(id))) return _scd182.apply(this, arguments);
    AMS.clear(); AANCHOR = id; return clipDrag182(ev, el, t, c); }; }
function clipDrag182(ev, el, t, c){
  ev.stopPropagation(); if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur(); getSelection().removeAllRanges();
  selClip = c.id; if (c.type){ sel.clear(); paintSel(); if (c.type === 'music') showMusicInspector(); else showInsp('proj'); } else sel = new Set(c.lines);
  const step = dragStep(), sc = tlSc(), x0 = ev.clientX, y0 = ev.clientY, sl0 = sc.scrollLeft, at0 = c.at, kind = kindFor(c); let moved = false, hot = null;
  const okLane = i => !!S.tracks[i] && S.tracks[i].kind === kind;   // speech on speech tracks; music, effects and audio files on regular ones
  const AS = autoScroller(e => mv(e));
  const mv = e => { const dx = e.clientX - x0 + sc.scrollLeft - sl0; if (Math.abs(dx) > 3 || Math.abs(e.clientY - y0) > 6) moved = true; if (!moved) return;
    c.at = Math.max(0, snapT(at0 + dx / zoom, c)); el.style.left = (PAD + c.at * zoom) + 'px'; el.style.pointerEvents = 'none'; el.style.zIndex = 30; el.style.transform = `translateY(${e.clientY - y0}px)`;
    const lane = laneAt(e.clientX, e.clientY); if (hot && hot !== lane) hot.classList.remove('lane-hot'); hideBars();
    hot = lane && okLane(+lane.dataset.ti) ? lane : null; if (hot) hot.classList.add('lane-hot'); AS.move(e); };
  const end = () => { AS.stop(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); DRAG_ESC = null; if (hot) hot.classList.remove('lane-hot'); el.style.transform = ''; el.style.pointerEvents = ''; el.style.zIndex = ''; };
  const up = () => { const hi = hot ? +hot.dataset.ti : null; end();
    if (!moved){ step.drop(); paintSel(); renderTimeline(); return; }
    const tgt = hi !== null && okLane(hi) ? S.tracks[hi] : t; t.clips = t.clips.filter(x => x !== c);
    if (tgt.kind === 'speech' && tgt.gapless){ tgt.clips.push(c); pack(tgt); }   // magnetic: it goes in where it was dropped, the others make room
    else if (trackFree(tgt, c)){ tgt.clips.push(c); tgt.clips.sort((a, b) => a.at - b.at); }
    else newTrack(S.tracks.indexOf(tgt) + 1, tgt.kind).clips.push(c);   // that spot is taken → a new track right there; nothing else moves
    if (t !== tgt && t.gapless) pack(t);   // the gap it left closes
    if (c.type === 'music') S.music.manual = true;
    cleanupTracks(); renderScript(); autosave(); };
  DRAG_ESC = () => { end(); step.cancel(); renderScript(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); }

// =====================================================================================
// THE VIDEO MODE — one object: move (to any track it may go on) or trim
// =====================================================================================
{ const _wvt182 = wireVideoTimeline; wireVideoTimeline = function(TR){ const r = _wvt182.apply(this, arguments); const lanes = $('lanes'), orig = lanes.onpointerdown;
    lanes.onpointerdown = ev => {
      if (ev.target.closest('[data-trbadge]')) return orig(ev);
      const hd = ev.target.closest('.vtrim'), el = hd ? (hd.dataset.k === 'sub' ? null : lanes.querySelector(`.vclip[data-id="${hd.dataset.id}"]`)) : ev.target.closest('.vclip');
      if (!el || el.dataset.k !== 'obj' || multiKey(ev) || ev.shiftKey || (VMS.size > 1 && VMS.has(el.dataset.id))) return orig(ev);   // several objects, the other rows: as before
      VMS.clear(); VANCHOR = el.dataset.id; vObjDrag182(ev, el, hd, TR || vTracks()); };
    return r; }; }
const canBg = o => !!o && !o.show && (o.type === 'image' || o.type === 'video' || o.type === 'pod');   // what may sit on the background track
function vObjDrag182(ev, el, hd, TR){
  ev.stopPropagation(); const o = objById(el.dataset.id); if (!o) return; const step = dragStep(); if (vSel !== o.id) selectV(o.id);
  const lanes = $('lanes'), sc = tlSc(), x0 = ev.clientX, y0 = ev.clientY, sl0 = sc.scrollLeft, trim = hd ? hd.dataset.e : null; let moved = false, hot = null;
  const s0 = o.start || 0, e0 = o.end == null ? projEnd() : o.end, from = layerOf(o.id), tin0 = o.trimIn || 0, aud0 = o.type === 'audio' ? vAudioTrim0(o) : null;
  const group = o.show ? slidesOf(o.show) : null;
  const live = () => { (group || [o]).forEach(x => { const ex = lanes.querySelector(`.vclip[data-id="${x.id}"]`); if (ex){ ex.style.left = (PAD + (x.start || 0) * zoom) + 'px'; ex.style.width = Math.max(6, (((x.end == null ? projEnd() : x.end) - (x.start || 0)) * zoom - 2)) + 'px'; } });
    lanes.querySelectorAll(`.vtrim[data-id="${o.id}"]`).forEach(hx => { const ex = lanes.querySelector(`.vclip[data-id="${o.id}"]`); if (ex) hx.style.left = (hx.dataset.e === 's' ? parseFloat(ex.style.left) - (hx.offsetWidth || 16) : parseFloat(ex.style.left) + parseFloat(ex.style.width)) + 'px'; }); };
  const okLane = i => { const tt = TR[i]; if (!tt || o.show) return false; if (tt.kind === 'obj') return true; if (tt.kind === 'bg') return canBg(o); return false; };   // never subtitles or the audio track
  const snap = t => { if (!snapOn) return t; let best = t, bd = SNAP_PX; vSnapEdges(o).forEach(ed => { const dd = Math.abs((t - ed) * zoom); if (dd < bd){ bd = dd; best = ed; } }); return best; };
  const AS = autoScroller(e => mv(e));
  const mv = e => { const d = (e.clientX - x0 + sc.scrollLeft - sl0) / zoom; if (Math.abs(e.clientX - x0 + sc.scrollLeft - sl0) > 2 || (!trim && Math.abs(e.clientY - y0) > 6)) moved = true; if (!moved) return;
    if (o.show && slideEdit(o, trim, s0, e0, d)){ live(); AS.move(e); return; }   // a slide edits within its slideshow
    if (trim === 's'){ const media = o.type === 'video' || o.type === 'sfx' || o.type === 'audio'; o.start = Math.max(media ? Math.max(0, s0 - tin0) : 0, Math.min(e0 - 0.2, snap(s0 + d))); if (media) o.trimIn = tin0 + (o.start - s0); }
    else if (trim){ o.end = Math.max(s0 + 0.2, snap(e0 + d)); if (aud0) vAudioTrimEnd(o, aud0); else { const lim = srcLen(o); if (lim) o.end = Math.min(o.end, (o.start || 0) + lim - (o.trimIn || 0)); } }
    else { let ns = Math.max(0, s0 + d); const a1 = snap(ns), b1 = snap(ns + (e0 - s0)) - (e0 - s0); ns = Math.abs(a1 - ns) <= Math.abs(b1 - ns) ? a1 : b1; o.start = Math.max(0, ns); o.end = o.start + (e0 - s0); }
    live();
    if (!trim){ el.style.pointerEvents = 'none'; el.style.zIndex = 30; el.style.transform = `translateY(${e.clientY - y0}px)`; const lane = laneAt(e.clientX, e.clientY); hideBars();
      if (hot && hot !== lane) hot.classList.remove('lane-hot'); hot = lane && okLane(+lane.dataset.ti) ? lane : null; if (hot) hot.classList.add('lane-hot'); }
    AS.move(e); };
  const end = () => { AS.stop(); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); DRAG_ESC = null; if (hot) hot.classList.remove('lane-hot'); el.style.transform = ''; el.style.pointerEvents = ''; el.style.zIndex = ''; };
  const up = () => { const tgt = hot ? TR[+hot.dataset.ti] : null; end();
    if (!moved){ step.drop(); return; }
    if (o.show){ slideDrop(o); ensureLayers(); dropOrphanTrans(); renderTimeline(); vDraw(); autosave(); showVPanels(); return; }   // a slide stays in its slideshow
    if (!trim) vLand(o, from, tgt || from, s0, e0);
    ensureLayers(); dropOrphanTrans(); renderTimeline(); vDraw(); autosave(); showVPanels(); };
  DRAG_ESC = () => { end(); step.cancel(); renderTimeline(); vDraw(); showVPanels(); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up); }
// where a moved object lands (its start is where it was dropped)
function vLand(o, from, tgt, s0, e0){ const len = e0 - s0, wasBg = from.kind === 'bg', toBg = tgt.kind === 'bg' && canBg(o);
  if (o.end == null && (wasBg || toBg)) o.end = o.start + len;
  if (toBg){ toBackground(o); if (from !== tgt){ from.items = from.items.filter(id => id !== o.id); if (!tgt.items.includes(o.id)) tgt.items.push(o.id); } bgPlace(o, len, wasBg ? s0 : null); return; }
  if (wasBg){ bgPlace(o, len, s0, true); fromBackground(o); from.items = from.items.filter(id => id !== o.id); }   // out of the background's row: the gap it leaves closes
  else if (from !== tgt) from.items = from.items.filter(id => id !== o.id);
  const L = tgt.kind === 'obj' ? tgt : (from.kind === 'obj' ? from : null); if (!L){ ensureLayers(); return; }
  if (!L.items.includes(o.id)) L.items.push(o.id);
  if (L.items.some(id => { const x = objById(id); return x && x !== o && overlap(x, o); })){   // that spot is taken → a new layer right there (on top of it); nothing else moves
    L.items = L.items.filter(id => id !== o.id); V.layers.splice(V.layers.indexOf(L), 0, { id: 'L' + (++uid), kind: 'obj', name: 'لایه', en: 'Layer', items: [o.id] }); } }
// THE BACKGROUND'S ROW IS MAGNETIC: a clip that leaves closes the gap it leaves (the clips after it move back by its
// length); a clip dropped between two clips goes right after the first and pushes the later ones on by its length. A
// slideshow is one block (never split). The place is judged against the row as it was when the drag began.
function bgPlace(o, len, oldStart, outOnly){ const others = bgClips().filter(x => x !== o), drop = (o.start || 0) + len / 2, blocks = [];
  others.forEach(x => { const b = x.show ? blocks.find(k => k.show === x.show) : null; if (b) b.items.push(x); else blocks.push({ show: x.show || null, items: [x] }); });
  const span = b => { b.s = Math.min(...b.items.map(x => x.start || 0)); b.e = Math.max(...b.items.map(x => x.end ?? projEnd())); };
  blocks.forEach(span); blocks.sort((a, b) => a.s - b.s);
  const k = blocks.findIndex(b => drop < (b.s + b.e) / 2);   // before the first block whose middle is past the dropped clip's middle
  if (oldStart != null) others.forEach(x => { if ((x.start || 0) >= oldStart + len - 0.06){ x.start = (x.start || 0) - len; if (x.end != null) x.end -= len; } });   // the gap closes
  if (outOnly) return;
  blocks.forEach(span); const at = k < 0 ? (blocks.length ? blocks[blocks.length - 1].e : Math.max(0, o.start || 0)) : (k > 0 ? blocks[k - 1].e : blocks[0].s);
  if (k >= 0) blocks.slice(k).forEach(b => b.items.forEach(x => { x.start = (x.start || 0) + len; if (x.end != null) x.end += len; }));   // the later ones make room
  o.start = at; o.end = at + len; }
// onto the background: a picture or video fills the canvas; a podcast design is a podcast style again (V.pod — its
// gradient and the rest — is just as it was)
function toBackground(o){ if (o.bgl) return;
  if (o.type === 'pod'){ delete o.tpl; o.bgl = true; return; }
  o.pipBox = { x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0, radius: o.radius || 0 }; Object.assign(o, { bgl: true, x: 0, y: 0, w: 1, h: 1, rot: 0, fit: 'cover', panX: 0.5, panY: 0.5, radius: 0 }); }
// off it: a picture or video on top (its old box, else the usual one); a podcast design a template (no background)
function fromBackground(o){ delete o.bgl; delete o.full;
  if (o.type === 'pod'){ o.tpl = true; return; }
  const m = MEDIA.get(o.asset), el = m && m.el, aw = el && (el.videoWidth || el.naturalWidth), ah = el && (el.videoHeight || el.naturalHeight), d = MEDIA0(o.type, o.asset, aw, ah), b = o.pipBox;
  Object.assign(o, b ? { x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot, radius: b.radius } : { x: d.x, y: d.y, w: d.w, h: d.h, rot: 0, radius: d.radius }); delete o.pipBox; delete o.panX; delete o.panY; }
