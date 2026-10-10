// =====================================================================================
// 182 · HISTORY — every step says what changed, on what, and when. Design A (the founder's pick): the app's own list
//       panel, oldest step at the top and the newest by the button; the panel 80 % solid so a change underneath shows a
//       little; the step you are on in orange; a colour is always shown with a small round swatch of the colour itself.
//       A click goes to that step. Undo, redo and a click all bring the change in front of you: the mode it was made in,
//       the line / clip / object scrolled into view and selected, its inspector open, the setting itself highlighted, and
//       the playhead moved to where the item lives. The panel closes only with its ✕, the History button again, or Esc.
// =====================================================================================

// ---------------- a control's name and value as shown, captured when a step starts ----------------
var HIST_EL = null;                       // the control whose first change is being recorded (histMark sets it)
const HIST_DISP = new WeakMap();          // a control's value as shown just before it was touched
const HIST_SKIP_TAGS = 'input[type=search], .avq, input[type=file]';
function ctlIsColor(el){ return !!(el && ((el.type === 'color') || el.classList.contains('cfhex') || el.classList.contains('cpk') || (el.closest && el.closest('.cfield')))); }
function ctlText(el){
  if (!el) return '';
  try {
    if (el.closest && el.closest('.cfield')){ const f = el.closest('.cfield'), c = f.querySelector('input[type=color]') || f.querySelector('.cfhex'); return c ? String(c.value || '').toLowerCase() : ''; }
    if (el.type === 'color') return String(el.value || '').toLowerCase();
    if (el.type === 'range') return typeof rvText === 'function' ? rvText(el).replace(/[⁦-⁩]/g, '') : String(el.value);
    if (el.type === 'checkbox') return el.checked ? '\u0001on' : '\u0001off';
    if (el.type === 'radio'){ const g = el.name ? [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`)].find(x => x.checked) : (el.checked ? el : null); if (!g) return '';
      const v = g.dataset.v || g.value || ''; if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase(); const lb = g.closest('label'); return ((lb && lb.textContent) || g.getAttribute('aria-label') || v).trim(); }
    if (el.tagName === 'SELECT'){ const o = el.options[el.selectedIndex]; return o ? o.text.trim() : ''; }
    if (el.classList.contains('nfin') || el.type === 'number') return String(el.value);
    return String(el.value == null ? '' : el.value).trim().slice(0, 60);
  } catch (e) { return ''; }
}
function ctlLabel(el){
  if (!el) return '';
  const fs = el.closest && el.closest('fieldset'), lg = fs && fs.querySelector(':scope > legend');
  if (lg){ const c = lg.cloneNode(true); c.querySelectorAll('.rv, .rst, .vrst, .cfrst, .nfrst, .xrst, .lgsp, button, svg, .badge').forEach(x => x.remove()); const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) return t; }
  const lb = el.closest && el.closest('label'); if (lb){ const c = lb.cloneNode(true); c.querySelectorAll('input, select, svg, button').forEach(x => x.remove()); const t = c.textContent.replace(/\s+/g, ' ').trim(); if (t) return t; }
  return (el.getAttribute('aria-label') || el.getAttribute('data-tip') || el.title || '').trim();
}
function ctlRef(el){
  if (!el) return null;
  if (el.id) return '#' + CSS.escape(el.id);
  const host = el.closest('[id]'), pre = host ? '#' + CSS.escape(host.id) + ' ' : '';
  for (const a of ['data-cf', 'data-nf', 'data-k', 'data-key', 'data-v', 'name']){ const w = el.closest(`[${a}]`); if (w && (!host || host.contains(w))) return pre + `[${a}="${CSS.escape(w.getAttribute(a))}"]`; }
  if (host){ const all = [...host.querySelectorAll(el.tagName.toLowerCase())], i = all.indexOf(el); if (i >= 0) return { host: host.id, tag: el.tagName.toLowerCase(), i }; }
  return null;
}
function ctlFind(ref){
  if (!ref) return null;
  try { if (typeof ref === 'string') return document.querySelector(ref); const h = document.getElementById(ref.host); return h ? h.querySelectorAll(ref.tag)[ref.i] || null : null; } catch (e) { return null; }
}
['pointerdown', 'focusin', 'keydown'].forEach(type => window.addEventListener(type, ev => {
  const t = ev.target; if (!t || !t.matches) return;
  const el = t.matches('input, select, textarea') ? t : (t.closest && t.closest('.cfield')) ? t.closest('.cfield').querySelector('input[type=color], .cfhex') : null;
  if (!el || el.matches(HIST_SKIP_TAGS)) return; HIST_DISP.set(el, ctlText(el));
  if (el.type === 'radio' && el.name) document.querySelectorAll(`input[type=radio][name="${CSS.escape(el.name)}"]`).forEach(x => HIST_DISP.set(x, ctlText(el)));
}, true));
// the latest step's control: what it shows once the app has applied the change (the window hears it last)
var HIST_CTL_OPEN = null;
['input', 'change'].forEach(type => window.addEventListener(type, ev => { const c = HIST_CTL_OPEN; if (!c || !c.el) return; const t = ev.target;
  if (t === c.el || (c.el.name && t.name === c.el.name && t.type === 'radio') || (c.el.closest && c.el.closest('.cfield') && c.el.closest('.cfield').contains(t))){ c.after = ctlText(c.el); histChanged(); } }));

function histCtx(){
  const el = HIST_EL; HIST_EL = null;
  const ctx = { sel: [...(typeof sel !== 'undefined' && sel ? sel : [])], selClip: typeof selClip !== 'undefined' ? selClip : null, vSel: typeof vSel !== 'undefined' ? vSel : null };
  if (HIST_CTL_OPEN){ const c = HIST_CTL_OPEN; if (c.el && c.el.isConnected) c.after = ctlText(c.el); c.el = null; HIST_CTL_OPEN = null; }
  if (el){ const ctl = { ref: ctlRef(el), label: ctlLabel(el), before: HIST_DISP.has(el) ? HIST_DISP.get(el) : null, after: null, color: ctlIsColor(el), el };
    ctx.ctl = ctl; HIST_CTL_OPEN = ctl; }
  return ctx;
}

// ---------------- the states a step lies between ----------------
// past[i] holds the state BEFORE step i; the screen is the state after the last done step; future (a stack, top = the
// next redo) holds the state AFTER each undone step. State k: past[k] (k < n) · the screen (k = n) · future[m − (k − n)].
function histN(){ return hist.past.length + hist.future.length; }
function histStateOf(k, cur){ const n = hist.past.length, m = hist.future.length; if (k < n) return hist.past[k].sn; if (k === n) return cur; return hist.future[m - (k - n)].sn; }
function histMetaOf(k){ const n = hist.past.length, m = hist.future.length; return k < n ? hist.past[k].m : hist.future[m - 1 - (k - n)].m; }

// ---------------- what changed between two states ----------------
const H_IGNORE = new Set(['dirty', 'made', 'madeSig', 'madeMain', 'hi', 'lo', 'pending', '_ti', '_track', 'cv179', 'v177', 'v179', 'manual']);
const hj = x => JSON.stringify(x === undefined ? null : x);
function hKeys(a, b){ const out = []; const ks = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]); ks.forEach(k => { if (!H_IGNORE.has(k) && hj((a || {})[k]) !== hj((b || {})[k])) out.push(k); }); return out; }
function hClips(sn){ const m = new Map(); (sn.tracks || []).forEach((t, ti) => (t.clips || []).forEach(c => m.set(String(c.id), { c, t, ti }))); return m; }
function hOrder(sn){ return (sn.tracks || []).flatMap((t, ti) => (t.clips || []).filter(c => !c.type).map(c => [c, ti])).sort((a, b) => a[0].at - b[0].at || a[1] - b[1]).flatMap(([c]) => c.lines || []); }
function histDiff(A, B){
  const out = [];
  if (hj(A.lines) !== hj(B.lines)){ const la = A.lines || {}, lb = B.lines || {};
    for (const id in lb) if (!(id in la)) out.push({ type: 'line', id: +id, kind: 'add' });
    for (const id in la) if (!(id in lb)) out.push({ type: 'line', id: +id, kind: 'del' });
    for (const id in lb) if (id in la){ const ks = hKeys(la[id], lb[id]); if (ks.length) out.push({ type: 'line', id: +id, kind: ks.includes('text') ? 'text' : ks.includes('spk') ? 'spk' : 'set', keys: ks }); } }
  if (hj(A.tracks) !== hj(B.tracks)){ const ca = hClips(A), cb = hClips(B);
    for (const [id, y] of cb) if (!ca.has(id)) out.push({ type: 'clip', id, kind: 'add', c: y.c, t: y.t });
    for (const [id, x] of ca) if (!cb.has(id)) out.push({ type: 'clip', id, kind: 'del', c: x.c, t: x.t });
    for (const [id, y] of cb){ const x = ca.get(id); if (!x) continue; const ks = hKeys(x.c, y.c), moved = String(x.t.id) !== String(y.t.id); if (!ks.length && !moved) continue;
      const k = ks.filter(q => q !== 'words'); let kind = 'set';
      if (k.some(q => q === 'gulp' || q === 'src')) kind = 'voice'; else if (k.some(q => /^(in|out|trimIn|trimOut)$/.test(q))) kind = 'trim'; else if (moved || (k.length && k.every(q => q === 'at'))) kind = 'move';
      else if (k.includes('gain')) kind = 'gain'; else if (k.includes('loop')) kind = 'loop'; else if (!k.length) continue;
      out.push({ type: 'clip', id, kind, keys: k, c: y.c, c0: x.c, t: y.t, t0: x.t }); }
    const ta = new Map((A.tracks || []).map(t => [String(t.id), t])); (B.tracks || []).forEach(t => { const a = ta.get(String(t.id)); if (!a) return; const ks = hKeys({ ...a, clips: 0 }, { ...t, clips: 0 }).filter(q => !/^(name|en|kind)$/.test(q)); if (ks.length) out.push({ type: 'track', id: t.id, kind: 'set', keys: ks, t, t0: a }); }); }
  if (hj(A.proj) !== hj(B.proj)){ const pa = A.proj || {}, pb = B.proj || {};
    if (hj(pa.speakers) !== hj(pb.speakers)){ const sa = new Map((pa.speakers || []).map(s => [s.id, s])), sb = new Map((pb.speakers || []).map(s => [s.id, s]));
      for (const [id, s] of sb) if (!sa.has(id)) out.push({ type: 'speaker', id, kind: 'add', s });
      for (const [id, s] of sa) if (!sb.has(id)) out.push({ type: 'speaker', id, kind: 'del', s });
      for (const [id, s] of sb){ const a = sa.get(id); if (a){ const ks = hKeys(a, s); if (ks.length) out.push({ type: 'speaker', id, kind: ks.includes('name') ? 'rename' : 'set', keys: ks, s, s0: a }); } } }
    const ks = hKeys({ ...pa, speakers: 0 }, { ...pb, speakers: 0 }); if (ks.length) out.push({ type: 'proj', kind: 'set', keys: ks }); }
  if (hj(A.music) !== hj(B.music)){ const ks = hKeys(A.music, B.music); if (ks.length) out.push({ type: 'music', kind: ks.includes('file') ? (B.music && B.music.file ? 'add' : 'del') : 'set', keys: ks }); }
  const va = A.video || {}, vb = B.video || {};
  if (hj(va) !== hj(vb)){
    const oa = new Map((va.objects || []).map(o => [o.id, o])), ob = new Map((vb.objects || []).map(o => [o.id, o]));
    for (const [id, o] of ob) if (!oa.has(id)) out.push({ type: 'vobj', id, kind: 'add', o });
    for (const [id, o] of oa) if (!ob.has(id)) out.push({ type: 'vobj', id, kind: 'del', o });
    for (const [id, o] of ob){ const a = oa.get(id); if (!a) continue; const ks = hKeys(a, o); if (!ks.length) continue;
      let kind = 'set'; if (ks.every(q => q === 'x' || q === 'y')) kind = 'move'; else if (ks.every(q => /^(x|y|w|h|size)$/.test(q))) kind = 'size'; else if (ks.every(q => q === 'rot')) kind = 'rot';
      else if (ks.every(q => /^(start|end|trimIn)$/.test(q))) kind = 'time'; else if (ks.includes('text') || ks.includes('emoji')) kind = 'text';
      out.push({ type: 'vobj', id, kind, keys: ks, o, o0: a }); }
    if (hj(va.layers) !== hj(vb.layers) && !out.some(x => x.type === 'vobj')) out.push({ type: 'layers', kind: 'set' });
    if (hj(va.pod) !== hj(vb.pod)) out.push({ type: 'pod', kind: 'set', keys: hKeys(va.pod, vb.pod) });
    if (hj(va.subs) !== hj(vb.subs)){ const ks = hKeys(va.subs, vb.subs); if (ks.some(q => q !== 'cues')) out.push({ type: 'subs', kind: ks.includes('fixes') ? 'text' : 'set', keys: ks }); }
    const ks = hKeys({ ...va, objects: 0, layers: 0, pod: 0, subs: 0 }, { ...vb, objects: 0, layers: 0, pod: 0, subs: 0 }); if (ks.length) out.push({ type: 'canvas', kind: 'set', keys: ks });
  }
  return out;
}
// the one change a step is about (its description and where undo / redo / a click take you). Kept with the step once
// both its states are history's own (the newest step is read afresh — it may still be growing); it keeps only small
// copies, never a piece of the project on screen.
const hClipLite = c => c && { id: c.id, type: c.type, name: c.name, lines: (c.lines || []).slice(0, 3), at: c.at, in: c.in, out: c.out, gain: c.gain, loop: c.loop };
const hTrackLite = t => t && { id: t.id, name: t.name, en: t.en, muted: t.muted, volume: t.volume, gapless: t.gapless };
const hObjLite = o => o && { id: o.id, type: o.type, text: o.text, emoji: o.emoji, show: o.show, start: o.start, end: o.end };
function histChange(k, cur){
  const m = histMetaOf(k), live = k + 1 === hist.past.length; if (m.ch && !live) return m.ch;
  if (m.act){ const ch = { type: 'act', mode: m.mode || 'audio', item: m.act.item || '', what: m.act.what || T('حذف شد', 'Deleted'), icon: m.act.icon || 'trash-2', many: 0 }; m.ch = ch; return ch; }
  cur = cur || snapshot(); const A = histStateOf(k, cur), B = histStateOf(k + 1, cur), all = histDiff(A, B);
  const pick = (...pr) => { for (const f of pr){ const x = all.find(f); if (x) return x; } return all[0] || null; };
  let main;
  if (m.label === 'gen'){ const voiced = all.filter(x => x.type === 'clip' && (x.kind === 'add' || x.kind === 'voice')); main = { type: 'gen', n: new Set(voiced.flatMap(x => (x.c && x.c.lines) || [])).size, first: voiced[0] || null }; }
  else if (m.ctx && m.ctx.ctl){ const ids = m.ctx; main = pick(x => x.type === 'vobj' && x.id === ids.vSel, x => x.type === 'clip' && x.id === String(ids.selClip), x => x.type === 'line' && ids.sel.includes(x.id), x => x.type !== 'layers'); }
  else main = pick(x => x.kind === 'del', x => x.kind === 'add', x => x.type === 'line' && x.kind === 'text', x => x.type === 'vobj', x => x.type === 'clip', x => x.type !== 'layers');
  const ch = main ? { ...main, many: all.filter(x => x.type === (main.type === 'gen' ? 'clip' : main.type) && x.kind === main.kind).length } : { type: 'none' };
  ch.mode = /^(vobj|layers|pod|subs|canvas)$/.test(ch.type) ? 'video' : /^(line|clip|track|music|gen)$/.test(ch.type) ? 'audio' : (m.mode || 'audio');
  const ord = hOrder(ch.kind === 'del' ? A : B), lid = ch.type === 'line' ? ch.id : ch.type === 'clip' && ch.c && !ch.c.type && ch.c.lines ? ch.c.lines[0] : null;
  ch.no = lid != null && ord.indexOf(+lid) >= 0 ? ord.indexOf(+lid) + 1 : null;
  if (ch.first) ch.first = { type: 'clip', id: ch.first.id, kind: ch.first.kind, c: hClipLite(ch.first.c) };
  ['c', 'c0'].forEach(q => { if (ch[q]) ch[q] = hClipLite(ch[q]); }); ['t', 't0'].forEach(q => { if (ch[q]) ch[q] = hTrackLite(ch[q]); });
  if (ch.type === 'vobj' && ch.kind === 'set' && ch.keys && ch.keys.length === 1){ const q = ch.keys[0]; ch.v0 = ch.o0 ? ch.o0[q] : undefined; ch.v1 = ch.o ? ch.o[q] : undefined; }
  ['o', 'o0'].forEach(q => { if (ch[q]) ch[q] = hObjLite(ch[q]); });
  ['s', 's0'].forEach(q => { if (ch[q]) ch[q] = { id: ch[q].id, name: ch[q].name }; });
  if (ch.type === 'canvas' && ch.keys && ch.keys.includes('bg')){ ch.v0 = (A.video || {}).bg; ch.v1 = (B.video || {}).bg; }
  if (!live) m.ch = ch; return ch;
}

// ---------------- colours: a name and the colour itself ----------------
const H_COLORS = [['#ffffff', 'سفید', 'White'], ['#000000', 'مشکی', 'Black'], ['#808080', 'خاکستری', 'Grey'], ['#c4c4c4', 'خاکستریِ روشن', 'Light grey'], ['#3d3d3d', 'خاکستریِ تیره', 'Dark grey'],
  ['#e53935', 'قرمز', 'Red'], ['#8e1b1b', 'قرمزِ تیره', 'Dark red'], ['#f57c00', 'نارنجی', 'Orange'], ['#e9603b', 'نارنجیِ قرمز', 'Red-orange'], ['#fdd835', 'زرد', 'Yellow'], ['#f2b233', 'طلایی', 'Gold'],
  ['#43a047', 'سبز', 'Green'], ['#1b5e20', 'سبزِ تیره', 'Dark green'], ['#a5d66b', 'سبزِ روشن', 'Light green'], ['#00897b', 'سبزآبی', 'Teal'], ['#26c6da', 'فیروزه‌ای', 'Turquoise'],
  ['#1e88e5', 'آبی', 'Blue'], ['#90caf9', 'آبیِ روشن', 'Light blue'], ['#1a237e', 'سرمه‌ای', 'Navy'], ['#0c1230', 'سرمه‌ایِ تیره', 'Midnight blue'], ['#8e24aa', 'بنفش', 'Purple'], ['#c39be0', 'یاسی', 'Lilac'],
  ['#ec407a', 'صورتی', 'Pink'], ['#795548', 'قهوه‌ای', 'Brown'], ['#e6d3b3', 'کرم', 'Beige'], ['#e6a483', 'هلویی', 'Peach']];
function hLab(hex){ const h = String(hex).replace('#', ''), f = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), n = [0, 2, 4].map(i => parseInt(f.substr(i, 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const l = Math.cbrt(0.4122214708 * n[0] + 0.5363325363 * n[1] + 0.0514459929 * n[2]), m = Math.cbrt(0.2119034982 * n[0] + 0.6806995451 * n[1] + 0.1073969566 * n[2]), s = Math.cbrt(0.0883024619 * n[0] + 0.2817188376 * n[1] + 0.6299787005 * n[2]);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]; }
const H_COL_LAB = H_COLORS.map(c => [hLab(c[0]), c]);
function colorName(hex){ if (!/^#[0-9a-f]{3,8}$/i.test(String(hex || ''))) return String(hex || ''); const p = hLab(hex); let best = null, bd = 1e9;
  H_COL_LAB.forEach(([q, c]) => { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2; if (d < bd){ bd = d; best = c; } }); return T(best[1], best[2]); }
const swatch = hex => `<span class="inline-block size-3 shrink-0 rounded-full border border-base-content/25 align-[-2px]" style="background:${escapeHtml(hex)}" title="${escapeHtml(String(hex).toUpperCase())}"></span>`;
function hVal(v){ if (v == null || v === '') return ''; if (v === '\u0001on') return T('روشن', 'on'); if (v === '\u0001off') return T('خاموش', 'off');
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return `<span class="inline-flex items-center gap-1">${swatch(v)}${escapeHtml(colorName(v))}</span>`; return escapeHtml(v); }
const hArrow = () => lang === 'fa' ? ' ← ' : ' → ';
function hFromTo(a, b){ if (a == null || a === '' || a === b) return hVal(b); return `<span class="whitespace-nowrap">${hVal(a)}</span><span class="opacity-60">${hArrow()}</span><span class="whitespace-nowrap">${hVal(b)}</span>`; }
const hSecs = v => secs(+v || 0);

// ---------------- the words of a step ----------------
function hClipName(c){ if (!c) return T('کلیپ', 'Clip'); const nm = c.name ? ` «${escapeHtml(String(c.name).slice(0, 24))}»` : '';
  return c.type === 'music' ? T('موسیقی', 'Music') + nm : c.type === 'sfx' ? T('افکت', 'Effect') + nm : c.type === 'ovl' ? T('واکنش', 'Reaction') : c.type ? T('کلیپِ صدا', 'Audio clip') + nm : ''; }
function hObjName(o){ if (!o) return T('شیء', 'Object'); const t = o.type, s = x => ` «${escapeHtml(String(x || '').replace(/\s+/g, ' ').slice(0, 22))}»`;
  if (o.show) return T('اسلاید', 'Slide');
  return t === 'text' ? T('متن', 'Text') + s(o.text) : t === 'image' ? T('تصویر', 'Picture') : t === 'video' ? T('ویدیو', 'Video') : t === 'sticker' ? T('استیکر', 'Sticker') + ' ' + escapeHtml(o.emoji || '')
    : t === 'pod' ? T('قالبِ پادکست', 'Podcast design') : t === 'sfx' ? T('افکت', 'Effect') : t === 'audio' ? T('کلیپِ صدا', 'Audio clip') + s(o.name) : t === 'fx' ? T('ترنزیشن', 'Transition') : T('شیء', 'Object'); }
function histWords(k, cur){
  const ch = histChange(k, cur), m = histMetaOf(k), ctl = m.ctx && m.ctx.ctl, many = ch.many > 1 ? ch.many : 0;
  let icon = 'pencil', item = '', what = '';
  const lineItem = () => ch.no ? T('خطِ ', 'Line ') + num(ch.no) : T('خط', 'Line');
  if (ch.type === 'act'){ icon = ch.icon; item = escapeHtml(ch.item); what = escapeHtml(ch.what); }
  else if (ch.type === 'gen'){ icon = 'mic'; item = T('گفتار', 'Speech'); what = ch.n ? T(`${num(ch.n)} خط ساخته شد`, `${num(ch.n)} line${ch.n > 1 ? 's' : ''} made`) : T('ساخته شد', 'Made'); }
  else if (ch.type === 'line'){ icon = ch.kind === 'text' ? 'square-pen' : ch.kind === 'spk' ? 'user' : ch.kind === 'del' ? 'trash-2' : ch.kind === 'add' ? 'plus' : 'mic';
    item = many ? T(`${num(many)} خط`, `${num(many)} lines`) : lineItem();
    what = ch.kind === 'add' ? T('اضافه شد', 'Added') : ch.kind === 'del' ? T('حذف شد', 'Deleted') : ch.kind === 'text' ? T('متن ویرایش شد', 'Text edited') : ch.kind === 'spk' ? T('گوینده عوض شد', 'Speaker changed') : T('صدای خط عوض شد', 'Voice settings changed'); }
  else if (ch.type === 'clip'){ const c = ch.c, nm = hClipName(c) || (c && c.lines && c.lines.length ? lineItem() : T('کلیپ', 'Clip'));
    item = many ? T(`${num(many)} کلیپ`, `${num(many)} clips`) : nm;
    if (ch.kind === 'add'){ icon = 'plus'; what = T('اضافه شد', 'Added'); } else if (ch.kind === 'del'){ icon = 'trash-2'; what = T('حذف شد', 'Deleted'); }
    else if (ch.kind === 'move'){ icon = 'move-horizontal'; what = String(ch.t && ch.t.id) !== String(ch.t0 && ch.t0.id) ? T('به ترکِ دیگری رفت', 'Moved to another track') : T('جابه‌جا شد', 'Moved'); }
    else if (ch.kind === 'trim'){ icon = 'scissors'; what = T('طول: ', 'Length: ') + hFromTo(hSecs(dur(ch.c0)), hSecs(dur(ch.c))); }
    else if (ch.kind === 'gain'){ icon = 'volume-2'; what = T('بلندی: ', 'Volume: ') + hFromTo(Math.round((ch.c0.gain ?? 1) * 100) + '%', Math.round((ch.c.gain ?? 1) * 100) + '%'); }
    else if (ch.kind === 'loop'){ icon = 'repeat'; what = ch.c.loop ? T('حلقه روشن شد', 'Loop on') : T('حلقه خاموش شد', 'Loop off'); }
    else if (ch.kind === 'voice'){ icon = 'refresh-cw'; what = T('دوباره ساخته شد', 'Made again'); }
    else { icon = 'sliders-horizontal'; what = T('تنظیم عوض شد', 'Setting changed'); } }
  else if (ch.type === 'track'){ icon = ch.keys.includes('muted') ? (ch.t.muted ? 'volume-x' : 'volume-2') : 'sliders-horizontal'; item = T(ch.t.name || 'ترک', ch.t.en || 'Track');
    what = ch.keys.includes('muted') ? (ch.t.muted ? T('بی‌صدا شد', 'Muted') : T('صدادار شد', 'Unmuted')) : ch.keys.includes('gapless') ? (ch.t.gapless ? T('بدونِ فاصله شد', 'Gapless on') : T('فاصله‌ها آزاد شد', 'Gapless off')) : ch.keys.includes('volume') ? T('بلندی: ', 'Volume: ') + hFromTo(Math.round((ch.t0.volume ?? 1) * 100) + '%', Math.round((ch.t.volume ?? 1) * 100) + '%') : T('تنظیم عوض شد', 'Setting changed'); }
  else if (ch.type === 'speaker'){ icon = ch.kind === 'del' ? 'trash-2' : ch.kind === 'add' ? 'plus' : 'user'; item = T('گوینده', 'Speaker') + ` «${escapeHtml(((ch.s0 && ch.kind === 'rename' ? ch.s : ch.s) || {}).name || '')}»`;
    what = ch.kind === 'add' ? T('اضافه شد', 'Added') : ch.kind === 'del' ? T('حذف شد', 'Deleted') : ch.kind === 'rename' ? T('نام: ', 'Name: ') + hFromTo(ch.s0.name || '', ch.s.name || '') : T('صدای گوینده عوض شد', 'Voice settings changed'); }
  else if (ch.type === 'music'){ icon = 'music'; item = T('موسیقی', 'Music'); what = ch.kind === 'add' ? T('انتخاب شد', 'Chosen') : ch.kind === 'del' ? T('برداشته شد', 'Removed') : T('تنظیم عوض شد', 'Setting changed'); }
  else if (ch.type === 'proj'){ icon = 'sliders-horizontal'; item = T('پروژه', 'Project'); what = T('تنظیم عوض شد', 'Setting changed'); }
  else if (ch.type === 'vobj'){ const o = ch.o; item = many ? T(`${num(many)} شیء`, `${num(many)} objects`) : hObjName(o);
    icon = ch.kind === 'add' ? 'plus' : ch.kind === 'del' ? 'trash-2' : ch.kind === 'move' ? 'move' : ch.kind === 'size' ? 'scaling' : ch.kind === 'rot' ? 'rotate-cw' : ch.kind === 'time' ? 'clock' : ch.kind === 'text' ? 'type' : 'sliders-horizontal';
    what = ch.kind === 'add' ? T('اضافه شد', 'Added') : ch.kind === 'del' ? T('حذف شد', 'Deleted') : ch.kind === 'move' ? T('جابه‌جا شد', 'Moved') : ch.kind === 'size' ? T('اندازه عوض شد', 'Resized')
      : ch.kind === 'rot' ? T('چرخید', 'Rotated') : ch.kind === 'time' ? T('زمانش عوض شد', 'Timing changed') : ch.kind === 'text' ? T('متن ویرایش شد', 'Text edited') : T('تنظیم عوض شد', 'Setting changed');
    if (ch.kind === 'set' && ch.keys.length === 1 && /color|fill/i.test(ch.keys[0]) && typeof ch.v1 === 'string'){ icon = 'palette'; what = T('رنگ: ', 'Colour: ') + hFromTo(ch.v0, ch.v1); } }
  else if (ch.type === 'layers'){ icon = 'layers'; item = T('لایه‌ها', 'Layers'); what = T('ترتیب عوض شد', 'Order changed'); }
  else if (ch.type === 'pod'){ icon = 'podcast'; item = T('قالبِ پادکست', 'Podcast design'); what = T('تنظیم عوض شد', 'Setting changed'); }
  else if (ch.type === 'subs'){ icon = 'captions'; item = T('زیرنویس', 'Subtitles'); what = ch.kind === 'text' ? T('متن ویرایش شد', 'Text edited') : T('تنظیم عوض شد', 'Setting changed'); }
  else if (ch.type === 'canvas'){ icon = 'frame'; item = T('بوم', 'Canvas'); what = T('تنظیم عوض شد', 'Setting changed');
    if (ch.keys.length === 1 && ch.keys[0] === 'bg'){ icon = 'palette'; what = T('رنگ: ', 'Colour: ') + hFromTo(ch.v0, ch.v1); } }
  else { icon = 'pencil'; item = ''; what = T('تغییر', 'Change'); }
  // a step made with a control: its own name, and its value as it was shown before and after
  if (ctl && ctl.label && !/^(gen)$/.test(ch.type) && !(ch.kind === 'add' || ch.kind === 'del')){
    const after = ctl.el && ctl.el.isConnected ? ctlText(ctl.el) : ctl.after;
    if (after != null && after !== ''){ if (ctl.color) icon = 'palette'; what = escapeHtml(ctl.label) + ': ' + hFromTo(ctl.before, after); }
    else what = escapeHtml(ctl.label); }
  return { icon, item, what };
}

// ---------------- the panel ----------------
const H_TIME = at => { const d = new Date(at); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function histBaseWords(){ const b = hist.base || {};
  return b.kind === 'open' ? [T('پروژه باز شد', 'Project opened'), 'folder-open'] : b.kind === 'recover' ? [T('نسخهٔ بازیابی باز شد', 'Recovery copy opened'), 'folder-open'] : b.kind === 'new' ? [T('پروژهٔ تازه', 'New project'), 'file-plus']
    : b.kind === 'older' ? [T('قدیمی‌ترین مرحله‌ای که مانده', 'Oldest step kept'), 'history'] : [T('شروع', 'Start'), 'history']; }
function histOpen(){ return !!($('histBox') && !$('histBox').classList.contains('hidden')); }
function histToggle(){ if (histOpen()) histClose(); else histShowPanel(); }
function histClose(){ const box = $('histBox'); if (box) layerOff(box); const b = $('histBtn'); if (b) b.classList.remove('btn-active'); }
function histShowPanel(){
  let box = $('histBox'); if (!box){ box = document.createElement('div'); box.id = 'histBox'; document.body.appendChild(box);
    box.addEventListener('click', e => { const x = e.target.closest('[data-hx]'); if (x){ e.preventDefault(); histClose(); return; } const r = e.target.closest('[data-hk]'); if (!r) return; e.preventDefault(); histJumpTo(+r.dataset.hk); });
    box.addEventListener('pointerdown', e => e.stopPropagation()); }
  // 182: design A — the speaker menu's panel, 80 % solid
  box.className = LIST_PANEL.replace('bg-base-200', 'bg-base-200/80') + ' flex flex-col';
  box.style.width = '380px'; layerOn(box); const b = $('histBtn'); if (b) b.classList.add('btn-active');
  histRender(true); histPlace();
}
function histPlace(){ const box = $('histBox'), btn = $('histBtn'); if (!box || !btn || !histOpen()) return; const r = btn.getBoundingClientRect(), mh = Math.max(160, Math.min(440, r.top - 16));
  box.style.maxHeight = mh + 'px'; const w = box.offsetWidth || 380;
  Object.assign(box.style, { left: Math.max(8, Math.min(innerWidth - w - 8, r.left - 4)) + 'px', top: Math.max(8, r.top - 8 - box.offsetHeight) + 'px', right: 'auto', bottom: 'auto' }); }
addEventListener('resize', () => { if (histOpen()) histPlace(); });
var HIST_RAF = 0, HIST_LATER = 0;
function histChanged(){ if (!histOpen() || HIST_RAF) return; HIST_RAF = requestAnimationFrame(() => { HIST_RAF = 0; histRender(false); }); }
function histEdited(){ if (!histOpen()) return; clearTimeout(HIST_LATER); HIST_LATER = setTimeout(histChanged, 180); }   // a change inside the newest step (a drag, typing) shows a moment later
function histRender(scroll){
  const box = $('histBox'); if (!box || !histOpen()) return;
  const n = hist.past.length, N = histN(), rtl = lang === 'fa'; box.dir = rtl ? 'rtl' : 'ltr';
  const row = (k, icon, item, what, at, cur, fut) => `<li><a data-hk="${k}" class="gap-2.5 ${cur ? 'bg-primary/10 ring-1 ring-inset ring-primary' : ''} ${fut ? 'opacity-45' : ''}"><svg class="size-4 shrink-0 opacity-70"><use href="#i-${icon}"/></svg><span class="min-w-0 flex-1 truncate">${item ? `<span class="opacity-60">${item}:</span> ` : ''}${what}</span><span class="shrink-0 text-xs tabular-nums opacity-55">${at ? H_TIME(at) : ''}</span></a></li>`;
  const [bw, bi] = histBaseWords();
  let rows = row(0, bi, '', escapeHtml(bw), (hist.base || {}).at, n === 0, false);
  const cur = snapshot();
  for (let k = 0; k < N; k++){ let w; try { w = histWords(k, cur); } catch (e) { console.warn('history words', e); w = { icon: 'pencil', item: '', what: T('تغییر', 'Change') }; } rows += row(k + 1, w.icon, w.item, w.what, histMetaOf(k).at, k === n - 1, k >= n); }
  const sc0 = box.querySelector('ul'), keep = !scroll && sc0 ? sc0.scrollTop : null;
  box.innerHTML = `<div class="flex shrink-0 items-center gap-2 px-2 pb-2 pt-1"><svg class="size-4"><use href="#i-history"/></svg><span class="text-sm font-semibold">${T('تاریخچه', 'History')}</span><span class="badge badge-sm">${num(N)}</span><button class="btn btn-ghost btn-xs btn-circle ms-auto" data-hx aria-label="close"><svg class="size-3.5"><use href="#i-x"/></svg></button></div>`
    + `<ul class="avul menu menu-sm min-h-0 w-full flex-1 flex-nowrap overflow-y-auto border-t border-base-300 p-1 pt-1.5">${rows}</ul>`;
  const sc = box.querySelector('ul'), curEl = box.querySelector(`[data-hk="${n}"]`);
  if (keep !== null) sc.scrollTop = keep;
  if (curEl){ const a = curEl.offsetTop, b = a + curEl.offsetHeight; if (scroll || a < sc.scrollTop || b > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, b - sc.clientHeight + 8); }
  histPlace();
}
// Esc closes the panel when nothing nearer is open (a list, a dialog, a field being typed in) — they take it first
addEventListener('keydown', e => { if (e.key !== 'Escape' || !histOpen()) return; const t = e.target;
  if (document.querySelector('dialog[open]') || (typeof LIST !== 'undefined' && LIST) || (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)))) return;
  e.preventDefault(); e.stopImmediatePropagation(); histClose(); }, true);
// 182: when the language changes the panel speaks the new one
{ const _rl = typeof relang === 'function' ? relang : null; if (_rl) relang = function(){ const r = _rl.apply(this, arguments); try { histChanged(); } catch (e) {} return r; }; }

// ---------------- going to a step ----------------
function histJumpTo(p){
  const n = hist.past.length, N = histN(); p = Math.max(0, Math.min(N, p)); if (p === n) return false;
  const js = JSON.stringify(snapRaw()), cur = { sn: JSON.parse(js), size: js.length * 2 };
  let target;
  const acts = [];   // the actions the crossed steps carry, undone newest first / redone oldest first
  if (p < n){ let after = cur; for (let i = n - 1; i >= p; i--){ const P = hist.past[i]; hist.future.push({ sn: after.sn, size: after.size, m: P.m }); if (P.m && P.m.act && P.m.act.undo) acts.push(P.m.act.undo); after = P; } target = hist.past[p].sn; hist.past.length = p; }
  else { let before = cur; for (let i = n; i < p; i++){ const F = hist.future.pop(); hist.past.push({ sn: before.sn, size: before.size, m: F.m }); if (F.m && F.m.act && F.m.act.redo) acts.push(F.m.act.redo); before = F; } target = before.sn; }
  hist.bytes = [...hist.past, ...hist.future].reduce((a, x) => a + (x.size || 0), 0);
  if (typeof typingSnap !== 'undefined') typingSnap = false;
  restoreSnap(target); hist._last = null; CAP_SKIP = true; acts.forEach(f => { try { f(); } catch (e) { console.warn('history action', e); } }); afterChange(true); try { refreshOpenPanels(); } catch (e) {}
  // the step clicked is shown: a step before where you were is seen as it was after it was made; the first row shows
  // the first step as it was before it
  const k = p > 0 ? p - 1 : 0; histChanged(); if (N) histGo(k, p > 0); return true;
}

// ---------------- bringing a change in front of you ----------------
function hFlash(el){ if (!el) return; el.classList.remove('hist-flash'); void el.offsetWidth; el.classList.add('hist-flash'); clearTimeout(el._hf); el._hf = setTimeout(() => el.classList.remove('hist-flash'), 1700); }
function hReveal(t0, t1){   // the item lives from t0 to t1: the playhead goes there when it is elsewhere; the timeline shows it
  if (t0 == null || !isFinite(t0)) return; const end = t1 == null || !isFinite(t1) ? t0 + 0.5 : t1;
  if (!(playhead >= t0 - 1e-3 && playhead < end)) { try { seek(Math.max(0, t0), false); } catch (e) {} }
  const sc = $('tlScroll'); if (!sc) return; const vis = sc.clientWidth - ($('heads') ? $('heads').offsetWidth : 0), x0 = PAD + t0 * zoom, x1 = PAD + end * zoom;
  if (x0 < sc.scrollLeft + 20 || x1 > sc.scrollLeft + vis - 20) sc.scrollLeft = Math.max(0, x0 - Math.min(160, vis * 0.25)); }
function hSelClip(c){ if (typeof AMS !== 'undefined' && AMS) AMS.clear(); selClip = c.id; sel = !c.type ? new Set(c.lines || []) : new Set(); paintSel();
  if (c.type === 'music') showMusicInspector(); else if (c.type){ showInsp('proj'); if (typeof showClipPanel === 'function') try { showClipPanel(c); } catch (e) {} } renderTimeline(); }
function histGo(k, shownAfter){
  let ch; try { ch = histChange(k); } catch (e) { console.warn('history change', e); return; } const m = histMetaOf(k); if (ch.type === 'act') return;   // a sample, a track or a voice: no place on the timeline to go to
  if (ch.mode && typeof mode !== 'undefined' && mode !== ch.mode) setMode(ch.mode);
  requestAnimationFrame(() => requestAnimationFrame(() => { try { histShow(ch, m, shownAfter); } catch (e) { console.warn('history show', e); } }));
}
function histShow(ch, m, shownAfter){
  const ctl = m.ctx && m.ctx.ctl;
  if (ch.type === 'gen' && ch.first){ ch = ch.first; }
  if (ch.type === 'line'){ const id = ch.id;
    if (S.lines[id]){ if (typeof AMS !== 'undefined' && AMS) AMS.clear(); selClip = null; sel = new Set([id]); paintSel(); renderTimeline(); const ln = document.querySelector(`#editor .ln[data-id="${id}"]`); if (ln){ ln.scrollIntoView({ block: 'nearest' }); hFlash(ln); }
      const [, c] = clipOfLine(id); if (c) hReveal(c.at, c.at + dur(c)); } }
  else if (ch.type === 'clip'){ const [, c] = findClip(ch.id);
    if (c){ hSelClip(c); hReveal(c.at, c.at + dur(c)); requestAnimationFrame(() => hFlash(document.querySelector(`#lanes .clip[data-cid="${CSS.escape(String(c.id))}"]`))); }
    else { const c0 = ch.c0 || ch.c; if (c0) hReveal(c0.at, c0.at + Math.max(0.05, (c0.out || 0) - (c0.in || 0))); } }
  else if (ch.type === 'track'){ const i = S.tracks.findIndex(t => String(t.id) === String(ch.id)); hFlash(document.querySelector(`#heads [data-ti="${i}"] > div`)); }
  else if (ch.type === 'vobj'){ const o = typeof objById === 'function' ? objById(ch.id) : null;
    if (o){ if (typeof VMS !== 'undefined' && VMS) VMS.clear(); selectV(o.id); hReveal(o.start || 0, o.end == null ? null : o.end); requestAnimationFrame(() => { hFlash($('selbox')); hFlash(document.querySelector(`#lanes .vclip[data-id="${CSS.escape(String(o.id))}"]`)); }); }
    else if (ch.o) hReveal(ch.o.start || 0, ch.o.end); }
  else if (ch.type === 'speaker' || ch.type === 'proj'){ if (typeof mode !== 'undefined' && mode === 'video'){ selectV(null); } else { selClip = null; sel = new Set(); paintSel(); showInsp('proj'); fillInspector(); }
    if (ch.type === 'speaker'){ const box = $('spkOpen'); if (box && !box.checked){ box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
      requestAnimationFrame(() => { const row = document.querySelector(`#spkList [data-spk="${CSS.escape(String(ch.id))}"]`) || document.querySelector(`#spkList li:nth-child(${Math.max(1, (S.proj.speakers || []).findIndex(s => s.id === ch.id) + 1)})`); if (row){ row.scrollIntoView({ block: 'nearest' }); hFlash(row); } }); } }
  else if (ch.type === 'music'){ const mc = typeof musicClips === 'function' ? musicClips()[0] : null; if (mc){ hSelClip(mc); hReveal(mc.at, mc.at + dur(mc)); } else showInsp('proj'); }
  else if (ch.type === 'pod' || ch.type === 'subs' || ch.type === 'canvas' || ch.type === 'layers'){ if (ch.type === 'subs'){ try { selectV('SUB'); } catch (e) {} } else if (ch.type === 'pod'){ const po = (V.objects || []).find(o => o.type === 'pod'); if (po){ selectV(po.id); hReveal(po.start || 0, po.end); } else selectV(null); } else if (ch.type === 'canvas') selectV(null); }
  // the setting itself
  if (ctl){ requestAnimationFrame(() => requestAnimationFrame(() => { const el = ctlFind(ctl.ref); if (!el || !el.isConnected) return; const host = el.closest('fieldset') || el.closest('.cfield, .nfield, label') || el;
    const col = host.closest('.collapse'); if (col){ const ck = col.querySelector(':scope > input[type=checkbox]'); if (ck && !ck.checked){ ck.checked = true; ck.dispatchEvent(new Event('change', { bubbles: true })); } }
    if (host.offsetParent){ host.scrollIntoView({ block: 'nearest' }); hFlash(host); } })); }
}
// undo / redo show what they changed, one step at a time
['undo', 'redo'].forEach(name => { const f = window[name]; if (typeof f !== 'function') return;
  window[name] = function(){ const n0 = hist.past.length, r = f.apply(this, arguments), n1 = hist.past.length;
    histChanged(); if (name === 'undo' && n1 < n0) histGo(n1, false); else if (name === 'redo' && n1 > n0) histGo(n1 - 1, true);
    return r; }; });
// icons drawn by name above: #i-history #i-folder-open #i-file-plus #i-square-pen #i-user #i-mic #i-trash-2 #i-plus #i-move-horizontal #i-move #i-scissors
// #i-volume-2 #i-volume-x #i-repeat #i-refresh-cw #i-sliders-horizontal #i-music #i-scaling #i-rotate-cw #i-clock #i-type #i-palette #i-layers #i-podcast #i-captions #i-frame #i-pencil #i-x
