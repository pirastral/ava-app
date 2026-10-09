// =====================================================================================
// 176 · ONE DESIGN FOR EVERY CONTROL — round colour swatches and pickers with the hex code always shown (the text's
//       and the subtitles' five swatches are read from the frame on the canvas when their panel opens, with a refresh);
//       a size is a number with − / + (Shift: ten at a time); every value control has its reset icon.
// =====================================================================================
var FRAME_SW = { key: null, cols: null }, CF = {}, NF = {}, LAST_PANEL = null;   // var: read by handlers in earlier files
const hexOk = c => /^#[0-9a-f]{6}$/i.test(c || '');
const hex6 = c => { c = String(c || '').trim(); if (/^#?[0-9a-f]{3}$/i.test(c)) c = c.replace('#', '').split('').map(x => x + x).join(''); c = c.replace(/^#?/, '#'); return hexOk(c) ? c.toLowerCase() : null; };
const cdist = (a, b) => { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = p(a), B = p(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
function kmeansColors(px, k){ if (!px.length) return [];
  const d2 = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2, C = [px[Math.floor(px.length / 2)].slice()];
  while (C.length < k){ let best = null, bd = -1; for (let i = 0; i < px.length; i += 2){ let m = Infinity; for (const c of C){ const dd = d2(px[i], c); if (dd < m) m = dd; } if (m > bd){ bd = m; best = px[i]; } } if (!best || bd < 64) break; C.push(best.slice()); }
  const n = C.map(() => 0);
  for (let it = 0; it < 8; it++){ const S = C.map(() => [0, 0, 0, 0]); for (const p of px){ let bi = 0, bd = Infinity; C.forEach((c, j) => { const dd = d2(p, c); if (dd < bd){ bd = dd; bi = j; } }); const s = S[bi]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    S.forEach((s, j) => { if (s[3]) C[j] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; n[j] = s[3]; }); }
  return C.map((c, j) => ({ c: '#' + c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''), n: n[j] })).sort((a, b) => b.n - a.n).map(x => x.c); }
// the five colours of the frame on the canvas now (kept for the panel that asked, until refreshed)
function frameColors(force){ const cv = $('vcanvas'), key = String(vSel) + '|' + (vSel === 'SUB' ? V.subSel : '');
  if (!force && FRAME_SW.cols && FRAME_SW.key === key) return FRAME_SW.cols; let cols = [];
  try { if (cv && cv.width){ const w = 72, h = Math.max(1, Math.round(72 * cv.height / cv.width)), t = document.createElement('canvas'); t.width = w; t.height = h; const g = t.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data, px = []; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) px.push([d[i], d[i + 1], d[i + 2]]); cols = kmeansColors(px, 8); } } catch (err) { cols = []; }
  const out = []; cols.forEach(c => { if (out.length < 5 && !out.some(x => cdist(x, c) < 28)) out.push(c); });
  ['#ffffff', '#000000', '#f2b233', '#e9603b', '#2c5aa0'].forEach(c => { if (out.length < 5 && !out.some(x => cdist(x, c) < 28)) out.push(c); });
  FRAME_SW = { key, cols: out }; return out; }
// a colour field: [five swatches from the frame · refresh] … [round picker · hex]; CF[key] = { get, set(c, live), def }
function colorField(key, frame){ const f = CF[key]; if (!f) return ''; const cur = hex6(f.get()) || '#ffffff', def = hex6(f.def);
  const sw = frame ? frameColors().map(c => `<button type="button" class="cfsw size-[22px] shrink-0 cursor-pointer rounded-full border border-base-content/25 ring-offset-1 ring-offset-base-200 ${cdist(c, cur) < 6 ? 'ring-2 ring-primary' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}" data-tip="${c.toUpperCase()}"></button>`).join('')
    + `<button type="button" class="btn btn-ghost btn-xs btn-circle shrink-0" data-cfr data-tip="رنگ‌ها را دوباره از صفحه بخوان" data-tip-en="Read the colors from the canvas again" aria-label="refresh"><svg class="size-3.5"><use href="#i-refresh-cw"/></svg></button>` : '';
  return `<div class="cfield flex items-center gap-1" data-cf="${key}" dir="ltr">${sw}<span class="min-w-1 flex-1"></span>`
    + `<label class="cpick relative size-[26px] shrink-0 cursor-pointer overflow-hidden rounded-full border border-base-content/25" style="background:${cur}"><input type="color" class="absolute inset-0 size-full cursor-pointer opacity-0" value="${cur}" aria-label="${T('انتخابِ رنگ', 'Pick a color')}"></label>`
    + `<input class="cfhex input input-xs w-[4.6rem] px-1.5 text-center font-mono uppercase" value="${cur.toUpperCase()}" maxlength="7" spellcheck="false" aria-label="hex"></div>`; }
// the reset icon of a control lives in its legend (sliders, colours and sizes alike)
function legendReset(holder, cls, tipFa, tipEn){ const fs = holder && holder.closest('fieldset'), lg = fs && fs.querySelector('legend'); if (!lg) return null; let b = lg.querySelector('.' + cls);
  if (!b){ lg.classList.add('flex', 'w-full', 'items-center'); if (!lg.querySelector('.rv, .lgsp')) lg.insertAdjacentHTML('beforeend', '<span class="lgsp flex-1"></span>'); lg.insertAdjacentHTML('beforeend', `<button type="button" class="${cls} btn btn-ghost btn-xs btn-square -my-1 opacity-50 hover:opacity-100" data-tip="${tipFa || 'بازنشانی به پیش‌فرض'}" data-tip-en="${tipEn || 'Reset to default'}" aria-label="reset"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>`); b = lg.querySelector('.' + cls); }
  return b; }
function cfMount(id, key, frame){ const box = $(id); if (!box) return; box.innerHTML = colorField(key, frame); const el = box.querySelector('.cfield'), f = CF[key]; if (!el || !f) return;
  const b = legendReset(box, 'cfrst'); if (b){ b.dataset.cfk = key; b.classList.toggle('invisible', cdist(hex6(f.get()) || '#ffffff', hex6(f.def) || '#ffffff') < 1); } }
function cfPaint(el, c){ if (!el) return; const lab = el.querySelector('.cpick'), inp = el.querySelector('input[type=color]'), hx = el.querySelector('.cfhex'), f = CF[el.dataset.cf], fs = el.closest('fieldset'), rs = fs && fs.querySelector('legend .cfrst');
  if (lab) lab.style.background = c; if (inp && inp.value !== c) inp.value = c; if (hx && document.activeElement !== hx) hx.value = c.toUpperCase();
  el.querySelectorAll('.cfsw').forEach(s => ['ring-2', 'ring-primary'].forEach(k => s.classList.toggle(k, cdist(s.dataset.c, c) < 6))); if (rs && f) rs.classList.toggle('invisible', cdist(c, hex6(f.def) || c) < 1); }
let CF_LIVE = null;
function cfApply(el, c, live){ const f = CF[el.dataset.cf]; c = hex6(c); if (!f || !c) return; if (live){ if (CF_LIVE !== el){ remember(); CF_LIVE = el; } } else if (CF_LIVE !== el) remember(); f.set(c, true); cfPaint(el, c); if (!live) CF_LIVE = null; VVER++; vDraw(); autosave(); }
document.addEventListener('click', ev => { const rb = ev.target.closest && ev.target.closest('legend .cfrst'); if (rb){ ev.preventDefault(); const el = rb.closest('fieldset').querySelector('.cfield'), f = el && CF[el.dataset.cf]; if (f) cfApply(el, f.def, false); return; }
  const el = ev.target.closest && ev.target.closest('.cfield'); if (!el) return;
  const s = ev.target.closest('.cfsw'); if (s){ ev.preventDefault(); cfApply(el, s.dataset.c, false); return; }
  if (ev.target.closest('[data-cfr]')){ ev.preventDefault(); frameColors(true); document.querySelectorAll('.cfield').forEach(x => { if (x.querySelector('.cfsw')) x.outerHTML = colorField(x.dataset.cf, true); }); } });
document.addEventListener('input', ev => { const t = ev.target; if (t.type !== 'color' || !t.closest('.cfield')) return; cfApply(t.closest('.cfield'), t.value, true); }, true);
document.addEventListener('change', ev => { const t = ev.target, el = t.closest && t.closest('.cfield'); if (!el) return;
  if (t.type === 'color'){ CF_LIVE = null; autosave(); return; }
  if (t.classList.contains('cfhex')){ const c = hex6(t.value); if (c) cfApply(el, c, false); else t.value = (hex6(CF[el.dataset.cf].get()) || '').toUpperCase(); } }, true);
document.addEventListener('keydown', ev => { const t = ev.target; if (ev.key === 'Enter' && t.classList && t.classList.contains('cfhex')){ ev.preventDefault(); t.blur(); } }, true);
// every other colour input becomes the same round picker with its hex beside it
function enhColors(root){ (root || document).querySelectorAll('input[type=color]:not([data-cfx])').forEach(inp => { if (inp.closest('.cfield')) return; inp.dataset.cfx = '1';
  const wrap = document.createElement('span'); wrap.className = 'cfx inline-flex items-center gap-1.5'; wrap.dir = 'ltr'; inp.replaceWith(wrap);
  const lab = document.createElement('label'); lab.className = 'cpick relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-full border border-base-content/25'; lab.style.background = inp.value;
  inp.className = 'absolute inset-0 size-full cursor-pointer opacity-0'; lab.appendChild(inp);
  const hx = document.createElement('input'); hx.className = 'cfhex input input-xs w-[5.4rem] font-mono uppercase'; hx.maxLength = 7; hx.spellcheck = false; hx.value = inp.value.toUpperCase(); hx.setAttribute('aria-label', 'hex');
  wrap.append(lab, hx); const sync = () => { lab.style.background = inp.value; if (document.activeElement !== hx) hx.value = inp.value.toUpperCase(); };
  inp.addEventListener('input', sync); inp._cfsync = sync;
  hx.addEventListener('change', () => { const c = hex6(hx.value); if (!c){ hx.value = inp.value.toUpperCase(); return; } inp.value = c; sync(); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); });
  hx.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); hx.blur(); } }); }); }
function syncColors(root){ (root || document).querySelectorAll('input[type=color][data-cfx]').forEach(inp => inp._cfsync && inp._cfsync()); }

// a size: [−] [number] [+] — Shift steps ten; NF[key] = { get, set(v), def, min, max, unit }
function numField(key){ const f = NF[key]; if (!f) return ''; const v = Math.round(f.get());
  return `<div class="nfield flex items-center gap-1.5" data-nf="${key}" dir="ltr"><div class="join flex-1"><button type="button" class="btn btn-sm join-item btn-square border-base-content/15 bg-base-100" data-nfd="-1" aria-label="−"><svg class="size-3.5"><use href="#i-minus"/></svg></button>`
    + `<label class="input input-sm join-item flex-1 gap-1"><input type="number" class="nfin min-w-0 flex-1 text-center tabular-nums" value="${v}" min="${f.min}" max="${f.max}" step="1">${f.unit ? `<span class="label">${f.unit}</span>` : ''}</label>`
    + `<button type="button" class="btn btn-sm join-item btn-square border-base-content/15 bg-base-100" data-nfd="1" aria-label="+"><svg class="size-3.5"><use href="#i-plus"/></svg></button></div></div>`; }
function nfMount(id, key){ const box = $(id); if (!box) return; box.innerHTML = numField(key); const f = NF[key], b = legendReset(box, 'nfrst'); if (b && f){ b.dataset.nfk = key; b.classList.toggle('invisible', Math.round(f.get()) === f.def); } }
function nfApply(el, v){ const f = NF[el.dataset.nf]; if (!f) return; v = Math.round(Math.max(f.min, Math.min(f.max, +v || f.def))); remember(); f.set(v); const inp = el.querySelector('.nfin'); if (inp) inp.value = v; const fs = el.closest('fieldset'), rs = fs && fs.querySelector('legend .nfrst'); if (rs) rs.classList.toggle('invisible', v === f.def); VVER++; vDraw(); autosave(); }
document.addEventListener('click', ev => { const rb = ev.target.closest && ev.target.closest('legend .nfrst'); if (rb){ ev.preventDefault(); const el = rb.closest('fieldset').querySelector('.nfield'), f = el && NF[el.dataset.nf]; if (f) nfApply(el, f.def); return; }
  const el = ev.target.closest && ev.target.closest('.nfield'); if (!el) return; const f = NF[el.dataset.nf]; if (!f) return;
  const b = ev.target.closest('[data-nfd]'); if (b){ ev.preventDefault(); nfApply(el, Math.round(f.get()) + (+b.dataset.nfd) * (ev.shiftKey ? 10 : 1)); } });
document.addEventListener('change', ev => { const t = ev.target; if (!t.classList || !t.classList.contains('nfin')) return; nfApply(t.closest('.nfield'), t.value); }, true);
document.addEventListener('keydown', ev => { const t = ev.target; if (!t.classList || !t.classList.contains('nfin')) return;
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown'){ ev.preventDefault(); ev.stopPropagation(); const el = t.closest('.nfield'), f = NF[el.dataset.nf]; nfApply(el, Math.round(f.get()) + (ev.key === 'ArrowUp' ? 1 : -1) * (ev.shiftKey ? 10 : 1)); }
  else if (ev.key === 'Enter'){ ev.preventDefault(); t.blur(); } }, true);

// every slider in the video inspector gets its reset icon (shown when it is off its default)
const VDEF = { pipSize: 28, pipRad: 22, pipSW: 4, pipSO: 100, pipHO: 45, pipHA: 90, pipHD: 9, pipHB: 22, pipHS: 0, stkRot: 6, subBgOp: 55, txtPad: 13 };
function vResets(root){ (root || $('vinsp') || document).querySelectorAll('input[type=range]').forEach(r => { let d = r.dataset.def;
    if (d === undefined){ if (r.id && VDEF[r.id] !== undefined) d = VDEF[r.id];
      else { const m = /POD\.(\w+)\s*=\s*this\.value\s*\/\s*100/.exec(r.getAttribute('oninput') || ''), p0 = POD0(); if (m && typeof p0[m[1]] === 'number') d = Math.round(p0[m[1]] * 100); }
      if (d === undefined) return; r.dataset.def = d; }
    const lg = r.closest('fieldset') && r.closest('fieldset').querySelector('legend'); if (!lg) return; let b = lg.querySelector('.vrst');
    if (!b){ lg.classList.add('flex', 'w-full', 'items-center'); lg.insertAdjacentHTML('beforeend', `<button type="button" class="vrst btn btn-ghost btn-xs btn-square -my-1 opacity-50 hover:opacity-100" data-tip="بازنشانی به پیش‌فرض" data-tip-en="Reset to default" aria-label="reset"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>`); b = lg.querySelector('.vrst');
      b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); r.value = r.dataset.def; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); r.dispatchEvent(new Event('rangeset')); b.classList.add('invisible'); }; }
    const sync = () => b.classList.toggle('invisible', Math.abs(+r.value - +r.dataset.def) < 1e-9); sync(); if (!r._vrs){ r._vrs = true; r.addEventListener('input', sync); r.addEventListener('rangeset', sync); } }); }

// =====================================================================================
// 176 · TEXT — the box hugs what it says (auto width), or keeps a width and wraps (fixed width, set by dragging a side
//       handle); a corner handle scales the text; double-click edits it right on the canvas, live; new text has no
//       background; the panel: font · size (− / +) · alignment · width · colour (from the frame) · background.
// =====================================================================================
var VEDIT = null;   // the text being typed on the canvas (its glyphs come from the editor until it closes)
const HUG = document.createElement('canvas');
function hugText(o){ if (!o || o.type !== 'text') return; const [W, H] = outSize(), g = HUG.getContext('2d'), px = Math.max(6, o.size * H), bg = !!(o.bg && o.bg.on), pad = bg ? (o.bg.pad || 0) * H : 0, auto = o.autoW === true;
  const L = textLayout(g, o, H, auto ? 1e6 : o.w * W), th = Math.max(L.th, px * 1.35);
  if (auto){ const nw = Math.max(px * 0.6, L.tw + (bg ? pad * 3.2 : px * 0.2)) / W, right = o.x + o.w, cx = o.x + o.w / 2; o.x = o.align === 'right' ? right - nw : o.align === 'left' ? o.x : cx - nw / 2; o.w = nw; }
  o.h = (th + (bg ? pad * 2 : 0)) / H; }
const hugAll = () => (V.objects || []).forEach(o => { if (o.type === 'text') hugText(o); });
{ const _vFrame176 = vFrame; vFrame = async function(ctx, W, H, t, exporting){ if (exporting) await fontsReady(); try { hugAll(); } catch (err) {} return _vFrame176.apply(this, arguments); }; }
function txtSet(fn){ const o = objById(vSel); if (!o || o.type !== 'text') return; remember(); fn(o); hugText(o); VVER++; vChanged(); }
fillText = function(o){ const p = $('iv-text'); if (!p || !o) return; const tb = $('txtTime'); if (tb) tb.textContent = `${fmt(o.start || 0)} → ${o.end == null ? fmt(projEnd()) : fmt(o.end)}`;
  fillFontPick($('txtFont'), $('txtWeight'), fontFam(o.font), o.weight || 900, f => { txtSet(x => x.font = f); fillText(objById(vSel)); }, w => txtSet(x => x.weight = w));
  NF.txtSize = { get: () => (objById(vSel) || o).size * 1080, set: v => { const x = objById(vSel); if (!x) return; x.size = v / 1080; hugText(x); placeSelBox(); fillXformOnly(); }, def: 65, min: 8, max: 400, unit: 'px' }; nfMount('txtSize', 'txtSize');
  p.querySelectorAll('input[name=ta]').forEach(r => { r.checked = r.dataset.v === (o.align || 'center'); r.onchange = () => { if (r.checked) txtSet(x => x.align = r.dataset.v); }; });
  p.querySelectorAll('input[name=tw]').forEach(r => { r.checked = r.dataset.v === (o.autoW === true ? 'auto' : 'fixed'); r.onchange = () => { if (r.checked) txtSet(x => { x.autoW = r.dataset.v === 'auto'; }); }; });
  CF.txtColor = { get: () => (objById(vSel) || o).color, set: c => { const x = objById(vSel); if (x) x.color = c; }, def: '#ffffff' }; cfMount('txtColor', 'txtColor', true);
  const bg = $('bgOn'); bg.checked = !!(o.bg && o.bg.on); bg.onchange = () => { txtSet(x => { x.bg = x.bg || { shape: 'capsule', color: '#f2b233', pad: 0.012 }; x.bg.on = bg.checked; }); $('txtBgOpts').classList.toggle('hidden', !bg.checked); };
  $('txtBgOpts').classList.toggle('hidden', !bg.checked);
  p.querySelectorAll('input[name=bs]').forEach(r => { r.checked = r.dataset.v === ((o.bg && o.bg.shape) || 'capsule'); r.onchange = () => { if (r.checked) txtSet(x => x.bg.shape = r.dataset.v); }; });
  CF.txtBg = { get: () => ((objById(vSel) || o).bg || {}).color || '#f2b233', set: c => { const x = objById(vSel); if (x && x.bg) x.bg.color = c; }, def: '#f2b233' }; cfMount('txtBgColor', 'txtBg', true);
  const pad = $('txtPad'); pad.value = Math.round(((o.bg && o.bg.pad) || 0) * 1080); pad.oninput = () => { const x = objById(vSel); if (!x || !x.bg) return; if (!pad._d){ remember(); pad._d = true; } x.bg.pad = +pad.value / 1080; hugText(x); VVER++; vChanged(); }; pad.onchange = () => { pad._d = false; autosave(); };
  pad.dispatchEvent(new Event('rangeset')); };
// the handles: a side sets a width the text wraps in; a corner scales the text (and a set width with it); height always hugs
{ const _svs176 = startVScale; startVScale = function(ev, hd){ const o = objById(vSel); if (!o || o.type !== 'text') return _svs176.apply(this, arguments);
    ev.preventDefault(); ev.stopPropagation(); remember(); const x0 = ev.clientX, y0 = ev.clientY, s = { x: o.x, y: o.y, w: o.w, h: o.h, size: o.size }, a = (o.rot || 0) * Math.PI / 180, corner = hd.length === 2;
    const mv = e => { const dxs = e.clientX - x0, dys = e.clientY - y0, dx = (dxs * Math.cos(-a) - dys * Math.sin(-a)) / frameW, dy = (dxs * Math.sin(-a) + dys * Math.cos(-a)) / frameH;
      if (corner){ const kx = (s.w + (hd.includes('e') ? dx : -dx)) / s.w, ky = (s.h + (hd.includes('s') ? dy : -dy)) / s.h, k = Math.max(0.15, Math.abs(kx - 1) >= Math.abs(ky - 1) ? kx : ky); o.size = Math.max(8 / 1080, s.size * k); if (o.autoW !== true) o.w = s.w * k; }
      else { o.autoW = false; o.w = Math.max(0.03, s.w + (hd.includes('e') ? dx : -dx)); }
      hugText(o); o.x = hd.includes('w') ? s.x + s.w - o.w : s.x; o.y = hd.includes('n') ? s.y + s.h - o.h : s.y; VVER++; vChanged(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); fillText(o); autosave(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); }; }
{ const _psb176d = placeSelBox; placeSelBox = function(){ const r = _psb176d.apply(this, arguments); const o = mode === 'video' && vSel && vSel !== 'SUB' && vSel !== 'MIX' ? objById(vSel) : null, sb = $('selbox');
    if (sb && o && o.type === 'text') sb.querySelectorAll('[data-h="n"], [data-h="s"]').forEach(x => x.classList.add('hidden'));   // its height follows the words
    if (sb) sb.classList.toggle('opacity-0', !!VEDIT); return r; }; }
{ const _xf176 = xfApply; xfApply = function(k){ const o = objById(vSel); if (o && o.type === 'text' && k === 'w') o.autoW = false; const r = _xf176.apply(this, arguments); if (o && o.type === 'text'){ hugText(o); vChanged(); } return r; }; }
// typing on the canvas: the words appear in the frame as they are typed (the box and its background follow)
function txtEdStyle(ed, o){ const H = frameH, px = o.size * H, bg = !!(o.bg && o.bg.on), pad = bg ? (o.bg.pad || 0) * H : 0, auto = o.autoW === true;
  Object.assign(ed.style, { left: o.x * frameW + 'px', top: o.y * frameH + 'px', width: auto ? 'max-content' : o.w * frameW + 'px', minWidth: Math.max(8, o.w * frameW) + 'px', minHeight: o.h * frameH + 'px', padding: `${pad}px ${bg ? pad * 1.6 : px * 0.1}px`,
    fontFamily: `"${fontFam(o.font)}", Vazirmatn, sans-serif`, fontWeight: fontW(fontFam(o.font), o.weight || 700), fontSize: px + 'px', lineHeight: '1.35', color: o.color || '#fff', caretColor: o.color || '#fff', textAlign: o.align || 'center', transform: `rotate(${o.rot || 0}deg)`, transformOrigin: 'center', background: 'transparent', borderRadius: '0', whiteSpace: auto ? 'pre' : 'pre-wrap' }); }
{ const _etip176 = editTextInPlace; editTextInPlace = function(){ const o = vSel && vSel !== 'SUB' ? objById(vSel) : null; if (!o || o.type !== 'text') return _etip176.apply(this, arguments);
    const ed = $('vtextEd'), t0 = o.text; remember(); VEDIT = o; ed.classList.remove('hidden'); ed.innerText = o.text || ''; txtEdStyle(ed, o); placeSelBox(); VVER++; vDraw();
    ed.focus(); document.getSelection().selectAllChildren(ed);
    ed.oninput = () => { o.text = ed.innerText.replace(/\n$/, ''); hugText(o); txtEdStyle(ed, o); VVER++; vDraw(); placeSelBox(); fillXformOnly(); };
    ed.onkeydown = e => { if (e.key === 'Escape'){ e.preventDefault(); ed.blur(); } e.stopPropagation(); };
    ed.onblur = () => { o.text = ed.innerText.replace(/\n$/, '').trim() || t0; VEDIT = null; ed.classList.add('hidden'); ed.oninput = null; if (o.text === t0) hist.past.pop(); hugText(o); vChanged(); renderTimeline(); showVPanels(); }; }; }

// =====================================================================================
// 176 · SUBTITLES ALWAYS FOLLOW — drawn from the script's lines and the voice's word times, every time (the «follow the
//       timeline» switch is gone). A subtitle corrected by hand keeps the correction only while its line is the same
//       text with the same voice; a new wording or a regeneration replaces it, a new «words per caption» clears them all;
//       moving a clip keeps it (its timing follows). One design for all of them, past and future: size grows inward from
//       its edge (top grows down, bottom grows up, middle both ways); dragging one, or the arrow keys, moves them all.
// =====================================================================================
const subSig = (L, c) => JSON.stringify([(L && L.text) || '', c && c.gulp != null ? c.gulp : null]);
cuesNow = function(){ const s = V.subs, n = +(s.chunk || 0), fx = s.fixes || (s.fixes = {}), out = [];
  scriptOrder().filter(c => !c.unvoiced).forEach(c => {
    const per = c.lines.length === 1 ? [{ id: c.lines[0], at: c.at, dur: dur(c), words: cueSpine(c, c.lines[0]) }] : c.lines.map((id, k) => ({ id, at: c.at + dur(c) * k / c.lines.length, dur: dur(c) / c.lines.length }));
    per.forEach(p => { const L = S.lines[p.id], text = cleanCue(L && L.text); if (!text) return; const sig = subSig(L, c);
      cueChunks({ at: p.at, dur: p.dur, text, words: p.words || undefined, spk: L.spk }).forEach((q, k) => { q.line = p.id; q.key = p.id + ':' + n + ':' + k; q.sig = sig;
        const f = fx[q.key]; if (f && f.sig !== sig) delete fx[q.key];   // its line changed: the correction goes
        else if (f){ const ws = f.text.split(/\s+/).filter(Boolean); q.words = q.words && q.words.length === ws.length ? q.words.map((w, i) => ({ ...w, w: ws[i] })) : null; q.text = f.text; q.fixed = true; }
        out.push(q); }); }); });
  return out; };
function setSubFix(i, text){ const q = cuesNow()[i]; if (!q || text == null) return; text = text.replace(/\s+/g, ' ').trim(); remember(); const fx = V.subs.fixes || (V.subs.fixes = {});
  const base = (() => { const f = fx[q.key]; delete fx[q.key]; const b = cuesNow()[i]; if (f) fx[q.key] = f; return b ? b.text : ''; })();
  if (!text || text === base) delete fx[q.key]; else fx[q.key] = { text, sig: q.sig };
  Object.keys(fx).forEach(k => { if (!S.lines[+k.split(':')[0]]) delete fx[k]; }); VVER++; renderTimeline(); vDraw(); autosave(); if (vSel === 'SUB') fillSub(); }
function clearSubFix(i){ const q = cuesNow()[i]; if (!q || !q.fixed) return; remember(); delete V.subs.fixes[q.key]; VVER++; renderTimeline(); vDraw(); autosave(); fillSub(); }
resyncSubs = function(){ renderTimeline(); vDraw(); };   // they always follow
// an old project's fixed subtitles: a hand-changed wording that still matches a subtitle by time becomes a correction
function migrateSubs(){ const s = V.subs; if (!s) return; if (!s.off) s.off = { x: 0, y: 0 }; if (!s.fixes) s.fixes = {};
  if (s.follow === false && Array.isArray(s.cues) && s.cues.length){ const old = s.cues; s.follow = true; s.cues = [];
    cuesNow().forEach(q => { const m = old.find(x => Math.abs((x.at || 0) - q.at) < 0.15 && Math.abs((x.dur || 0) - q.dur) < 0.35); const t = m && String(m.text || '').replace(/\s+/g, ' ').trim(); if (t && t !== q.text) s.fixes[q.key] = { text: t, sig: q.sig }; }); }
  s.follow = true; s.cues = []; }
{ const _rs176s = restoreSnap; restoreSnap = function(){ const r = _rs176s.apply(this, arguments); try { migrateSubs(); } catch (err) { console.warn(err); } return r; }; }
migrateSubs();
SUB_PRESETS.forEach(p => { if (p[0] === 'bold'){ p[1] = 'درشت'; p[2] = 'Bold'; } });   // «برجسته» meant nothing
// the panel: one design for every subtitle
fillSub = function(){ const s = V.subs, cues = cuesNow(), q = cues[V.subSel]; $('subTime').textContent = q ? `${fmt(q.at)} → ${fmt(q.at + q.dur)}` : '';
  $('subFixRow').innerHTML = q && q.fixed ? `<div class="flex items-center gap-2 rounded-box border border-warning/40 bg-warning/10 px-3 py-2 text-xs"><svg class="size-3.5 shrink-0 text-warning"><use href="#i-pencil"/></svg><span class="flex-1">${T('نوشتهٔ این زیرنویس را دستی اصلاح کرده‌اید.', "You corrected this subtitle's wording by hand.")}</span><button class="btn btn-ghost btn-xs gap-1" onclick="clearSubFix(V.subSel)"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg>${T('متنِ خط', "The line's text")}</button></div>` : '';
  $('subPresets').innerHTML = SUB_PRESETS.map(([k, fa, en, p]) => `<button class="btn h-auto flex-col gap-1 p-1 ${s.preset === k ? 'btn-primary' : 'border-base-content/10 bg-base-100'}" onclick="subPreset('${k}')"><span class="grid h-9 w-full place-items-center rounded-field bg-[#0c1230]"><span class="rounded px-1 text-[11px] leading-tight" style="font-weight:${p.weight};color:${p.color};${p.bgOn ? `background:rgba(0,0,0,${p.bgOp})` : ''};${p.outline ? 'text-shadow:0 0 2px #000,0 0 2px #000' : ''}">${T('سلام', 'Hello')} <b style="color:${p.hiMode !== 'none' ? p.hi : p.color}">${T('دوست', 'friend')}</b></span></span><span class="text-[11px]">${T(fa, en)}</span></button>`).join('');
  fillFontPick($('subFont'), $('subWeight'), fontFam(s.font), s.weight || 700, f => { subSet('font', f); fillSub(); }, w => subSet('weight', w));
  NF.subSize = { get: () => V.subs.sizePx || 46, set: v => { V.subs.sizePx = v; requestAnimationFrame(placeSelBox); }, def: 46, min: 12, max: 200, unit: 'px' }; nfMount('subSizeF', 'subSize');
  document.querySelectorAll('#iv-sub input[name=sp]').forEach(r => { r.checked = r.value === (s.place || 'bottom'); r.onchange = () => { if (!r.checked) return; remember(); V.subs.place = r.value; V.subs.off = { x: 0, y: 0 }; VVER++; vDraw(); autosave(); requestAnimationFrame(placeSelBox); fillSub(); }; });
  { const lg = document.querySelector('#iv-sub input[name=sp]').closest('fieldset').querySelector('legend'), moved = s.off && (Math.abs(s.off.x) > 1e-4 || Math.abs(s.off.y) > 1e-4); let b = lg.querySelector('.vrst');
    if (!b){ lg.classList.add('flex', 'w-full', 'items-center'); lg.insertAdjacentHTML('beforeend', `<span class="flex-1"></span><button type="button" class="vrst btn btn-ghost btn-xs btn-square -my-1 opacity-50 hover:opacity-100" data-tip="برگرداندن به جای خودش" data-tip-en="Back to its place" aria-label="reset"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>`); b = lg.querySelector('.vrst'); b.onclick = () => { remember(); V.subs.off = { x: 0, y: 0 }; VVER++; vDraw(); autosave(); requestAnimationFrame(placeSelBox); fillSub(); }; }
    b.classList.toggle('invisible', !moved); }
  CF.subColor = { get: () => V.subs.color || '#ffffff', set: c => { V.subs.color = c; }, def: '#ffffff' }; cfMount('subColorF', 'subColor', true);
  CF.subHi = { get: () => V.subs.hi || '#e9603b', set: c => { V.subs.hi = c; }, def: '#e9603b' }; cfMount('subHiColorF', 'subHi', true); $('subHiColorBox').classList.toggle('hidden', (s.hiMode || 'none') === 'none');
  const an = $('subAnim'); an.value = [...an.options].some(o => o.value === s.anim) ? s.anim : 'none'; an.onchange = () => subSet('anim', an.value); enh(an);
  const op = $('subBgOp'); op.value = Math.round((s.bgOp ?? 0.55) * 100); op.oninput = () => subSet('bgOp', +op.value / 100, true); op.onchange = () => autosave(); op.dispatchEvent(new Event('rangeset'));
  [['subChunk', 'chunk', 0], ['subHiMode', 'hiMode', 'none'], ['subBgMode', 'bgMode', 'box']].forEach(([id, key, d]) => { const el = $(id); if (!el) return; el.value = String(s[key] ?? d);
    el.onchange = () => { if (key === 'chunk'){ remember(); V.subs.chunk = +el.value; V.subs.fixes = {}; VVER++; V.subSel = 0; renderTimeline(); vDraw(); autosave(); fillSub(); return; } subSet(key, el.value); if (key === 'hiMode') $('subHiColorBox').classList.toggle('hidden', el.value === 'none'); }; enh(el); });
  [['subBgOn', 'bgOn'], ['subOutline', 'outline'], ['subShadow', 'shadow'], ['subGlow', 'glow'], ['subSpk', 'spk']].forEach(([id, key]) => { const el = $(id); if (!el) return; el.checked = !!s[key]; el.onchange = () => { subSet(key, el.checked); if (key === 'bgOn') $('subBgOpts').classList.toggle('hidden', !el.checked); }; });
  $('subBgOpts').classList.toggle('hidden', !s.bgOn); };
// moving them: drag the one on the canvas, or the arrow keys — all of them move (their place is one for all)
{ const _svm176 = startVMove; startVMove = function(ev){ if (vSel !== 'SUB') return _svm176.apply(this, arguments);
    ev.preventDefault(); remember(); const s = V.subs, o0 = { x: (s.off || {}).x || 0, y: (s.off || {}).y || 0 }, x0 = ev.clientX, y0 = ev.clientY; let moved = false;
    const mv = e => { if (!moved && Math.hypot(e.clientX - x0, e.clientY - y0) < 3) return; moved = true; let nx = o0.x + (e.clientX - x0) / frameW; const snapX = Math.abs(nx) * frameW < 6; if (snapX) nx = 0;
      s.off = { x: nx, y: o0.y + (e.clientY - y0) / frameH }; guides(snapX, false); VVER++; vDraw(); requestAnimationFrame(placeSelBox); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); guides(false, false); if (!moved) hist.past.pop(); else { autosave(); fillSub(); } };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); }; }
let SUBKEY_T = 0;
function subKey(e){ if (e.key === 'Escape'){ e.stopPropagation(); selectV(null); return true; }
  if (e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); e.stopPropagation(); return true; }   // subtitles are not deleted one by one: they follow the script
  if (!e.key.startsWith('Arrow')) return false; e.preventDefault(); e.stopPropagation(); const [W, H] = outSize(), st = e.shiftKey ? 10 : 1, s = V.subs, o = s.off || { x: 0, y: 0 };
  if (!SUBKEY_T) remember(); clearTimeout(SUBKEY_T); SUBKEY_T = setTimeout(() => { SUBKEY_T = 0; fillSub(); }, 600);
  s.off = { x: o.x + (e.key === 'ArrowRight' ? st : e.key === 'ArrowLeft' ? -st : 0) / W, y: o.y + (e.key === 'ArrowDown' ? st : e.key === 'ArrowUp' ? -st : 0) / H }; VVER++; vDraw(); requestAnimationFrame(placeSelBox); autosave(); return true; }
// correcting one by hand: on the canvas or on the timeline
{ const _etip176s = editTextInPlace; editTextInPlace = function(){ if (vSel !== 'SUB') return _etip176s.apply(this, arguments); const q = cuesNow()[V.subSel]; if (!q || !SUBRECT) return;
    const ed = $('vtextEd'), i = V.subSel; ed.classList.remove('hidden'); ed.innerText = q.text;
    Object.assign(ed.style, { left: SUBRECT.x * frameW + 'px', top: SUBRECT.y * frameH + 'px', width: SUBRECT.w * frameW + 'px', minWidth: '', minHeight: SUBRECT.h * frameH + 'px', padding: '0.2em', fontFamily: `"${fontFam(V.subs.font)}", Vazirmatn, sans-serif`, fontSize: (V.subs.sizePx || 46) / 1080 * frameH + 'px', fontWeight: V.subs.weight || 700, lineHeight: '1.45', color: '#fff', caretColor: '#fff', textAlign: 'center', transform: '', background: 'rgba(0,0,0,.55)', borderRadius: '8px', whiteSpace: 'pre-wrap' });
    ed.focus(); document.getSelection().selectAllChildren(ed); ed.oninput = null;
    ed.onkeydown = e => { if (e.key === 'Enter' || e.key === 'Escape'){ e.preventDefault(); if (e.key === 'Escape') ed.innerText = q.text; ed.blur(); } e.stopPropagation(); };
    ed.onblur = () => { ed.classList.add('hidden'); setSubFix(i, ed.innerText); }; }; }
async function editSubOnTimeline(i){ const q = cuesNow()[i]; if (!q) return; const nt = await askText(T('اصلاحِ نوشتهٔ زیرنویس', "Correct the subtitle's wording"), T('تا وقتی متن یا صدای این خط عوض نشده می‌ماند.', "It holds until this line's text or voice changes."), q.text); if (nt !== null) setSubFix(i, nt); }
VADD.sub = [];   // no subtitle of its own: they come from the script

// =====================================================================================
// 176 · the inspector after every fill: round pickers with their hex, reset icons, the panel-opening moment for swatches
// =====================================================================================
// the frame is read once it has finished drawing (a frame half drawn showed black where the picture was still loading)
var VDRAW_WAIT = [];
{ const _vDraw176 = vDraw; vDraw = async function(){ const r = await _vDraw176.apply(this, arguments); if (!drawing && VDRAW_WAIT.length){ const w = VDRAW_WAIT; VDRAW_WAIT = []; w.forEach(f => f()); } return r; }; }
const vDrawIdle = () => new Promise(res => { if (!drawing) return res(); VDRAW_WAIT.push(res); setTimeout(res, 1500); });
function refreshFrameSwatches(){ const key = FRAME_SW.key; vDrawIdle().then(() => { if (FRAME_SW.key !== key) return; frameColors(true); document.querySelectorAll('#vinsp .cfield').forEach(x => { if (x.querySelector('.cfsw')) x.outerHTML = colorField(x.dataset.cf, true); }); }); }
{ const _svp176d = showVPanels; showVPanels = function(anim){ const key = String(vSel) + '|' + (vSel === 'SUB' ? V.subSel : ''), fresh = key !== LAST_PANEL; if (fresh){ LAST_PANEL = key; FRAME_SW.key = null; }
    const r = _svp176d.apply(this, arguments); try { const root = $('vinsp'); enhColors(root); syncColors(root); vResets(root); if (fresh && root.querySelector('.cfsw')) refreshFrameSwatches(); } catch (err) { console.warn(err); } return r; }; }
{ const _sp176 = subPreset; subPreset = function(k){ const c0 = +(V.subs.chunk || 0), r = _sp176.apply(this, arguments); if (+(V.subs.chunk || 0) !== c0){ V.subs.fixes = {}; V.subSel = 0; renderTimeline(); vDraw(); } return r; }; }   // a new number of words per caption clears the corrections
{ const _rpu176 = renderPodUI; renderPodUI = function(){ const r = _rpu176.apply(this, arguments); try { enhColors($('iv-pod')); syncColors($('iv-pod')); vResets($('iv-pod')); } catch (err) {} return r; }; }
{ const _fp176d = fillPip; fillPip = function(){ const r = _fp176d.apply(this, arguments); try { enhColors($('iv-pip')); syncColors($('iv-pip')); vResets($('iv-pip')); } catch (err) {} return r; }; }
{ const _fe176 = fillEmoji; fillEmoji = function(){ const r = _fe176.apply(this, arguments); try { enhColors($('iv-sticker')); syncColors($('iv-sticker')); } catch (err) {} return r; }; }
{ const _fs176 = fillSticker; fillSticker = function(o){ const r = _fs176.apply(this, arguments); try { const sz = $('iv-sticker').querySelectorAll('input[type=range]')[0]; if (sz) sz.dataset.def = 80; vResets($('iv-sticker')); } catch (err) {} return r; }; }

// =====================================================================================
// 176 · THE PREVIEW — larger (less margin around the frame), its bar folds away, and a full-screen player
// =====================================================================================
fitFrame = function(){ const st = $('stage'); if (!st) return; const full = document.body.classList.contains('vfull'), m = full ? 0 : 6, [ow, oh] = outSize(), ar = ow / oh;
  const aw = st.clientWidth - m * 2, ah = st.clientHeight - m * 2 - (full ? 76 : 0); frameW = Math.max(120, Math.min(aw, ah * ar)); frameH = frameW / ar;
  const fr = $('frame'); fr.style.width = frameW + 'px'; fr.style.height = frameH + 'px'; if (full) fr.style.marginBottom = '76px'; else fr.style.marginBottom = '';
  const cv = $('vcanvas'), dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.round(frameW * dpr); cv.height = Math.round(frameH * dpr); placeSelBox(); };
function stageBar(show){ const b = $('stageBar'), mini = $('stageMini'); if (!b) return; b.classList.toggle('hidden', !show); if (mini) mini.classList.toggle('hidden', !!show);
  try { API().settings_set({ ed_stagebar: !!show }); } catch (err) {} try { localStorage.setItem('ava_stagebar', show ? '1' : '0'); } catch (err) {}
  requestAnimationFrame(() => { fitFrame(); vDraw(); }); }
(async () => { let show = true; try { const v = localStorage.getItem('ava_stagebar'); if (v === '0') show = false; } catch (err) {}
  try { const st = await API().settings_get(); if (st && st.ed_stagebar === false) show = false; } catch (err) {} if (!show) stageBar(false); })();
function vfBar(){ let b = $('vfullBar'); if (b) return b; b = document.createElement('div'); b.id = 'vfullBar'; b.dir = 'ltr';
  b.className = 'ui fixed inset-x-0 bottom-0 z-[1600] hidden items-center gap-3 bg-black/80 px-6 py-4 text-white';
  b.innerHTML = `<button class="btn btn-circle btn-secondary btn-sm" data-vf="play" aria-label="play"><svg class="size-4"><use href="#i-play"/></svg></button><span id="vfTime" class="w-28 shrink-0 text-sm tabular-nums"></span>`
    + `<input id="vfSeek" type="range" min="0" max="1000" value="0" class="range range-xs flex-1 text-white/30 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-secondary)] [--range-thumb-size:14px]" aria-label="seek">`
    + `<button class="btn btn-ghost btn-sm btn-circle text-white" data-vf="exit" data-tip="خروج (Esc)" data-tip-en="Exit (Esc)" aria-label="exit"><svg class="size-4"><use href="#i-minimize"/></svg></button>`;
  document.body.appendChild(b);
  b.querySelector('[data-vf=play]').onclick = () => togglePlay();
  b.querySelector('[data-vf=exit]').onclick = () => vFullscreen(false);
  const sk = b.querySelector('#vfSeek'); sk.oninput = () => seek(+sk.value / 1000 * projEnd());
  return b; }
function vfPaint(){ const b = $('vfullBar'); if (!b || b.classList.contains('hidden')) return; const end = projEnd(), t = Math.min(playhead, end);
  $('vfTime').textContent = `${fmt(t)} / ${fmt(end)}`; const sk = $('vfSeek'); if (document.activeElement !== sk) sk.value = end ? Math.round(t / end * 1000) : 0;
  b.querySelector('[data-vf=play] use').setAttribute('href', playing ? '#i-pause' : '#i-play'); }
function vFullscreen(on){ if (mode !== 'video') return; const b = vfBar(); document.body.classList.toggle('vfull', !!on); b.classList.toggle('hidden', !on); b.classList.toggle('flex', !!on);
  if (on){ selectV(null); try { const el = document.documentElement; if (el.requestFullscreen) el.requestFullscreen().catch(() => {}); } catch (err) {} }
  else { try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (err) {} }
  requestAnimationFrame(() => { fitFrame(); vDraw(); vfPaint(); }); }
{ const _oph176 = window.onPlayhead; window.onPlayhead = function(){ if (_oph176) _oph176.apply(this, arguments); vfPaint(); }; }
{ const _sp176f = startPlay; startPlay = async function(){ const r = await _sp176f.apply(this, arguments); vfPaint(); return r; }; const _st176f = stopPlay; stopPlay = function(){ const r = _st176f.apply(this, arguments); vfPaint(); return r; }; }
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('vfull')) vFullscreen(false); });
addEventListener('keydown', e => { if (!document.body.classList.contains('vfull')) return; if (e.key === 'Escape'){ e.preventDefault(); e.stopImmediatePropagation(); vFullscreen(false); } else if (e.key === ' '){ e.preventDefault(); e.stopImmediatePropagation(); togglePlay(); } }, true);

// =====================================================================================
// 176 · THE AUDIO INSPECTOR SHOWS WHAT IS SELECTED — an effect or a reaction clip has its own panel (what it is, listen,
//       its volume, its actions) instead of a volume box sitting over the project's settings; a music clip's volume
//       lives at the top of the music panel
// =====================================================================================
var SFX_REPLACE_A = null;
function clipPanelEl(){ let p = $('insp-clip'); if (!p){ p = document.createElement('div'); p.id = 'insp-clip'; p.className = 'hidden space-y-3 p-4'; $('insp-music').parentElement.appendChild(p); } return p; }
const clipVolField = c => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('بلندیِ این کلیپ', "This clip's volume")}</legend><input type="range" data-unit="%" min="0" max="200" step="5" data-def="100" value="${Math.round((c.gain ?? 1) * 100)}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="clipGain('${c.id}', +this.value)"></fieldset>`;
function showClipPanel(c){ const p = clipPanelEl(); ['line', 'proj', 'music'].forEach(k => $('insp-' + k).classList.add('hidden')); const tl = $('it-line').parentElement; if (tl) tl.classList.add('hidden'); p.classList.remove('hidden');
  if (c.type === 'sfx'){ const it = sfxItems().find(x => x.file === c.file) || {}, fam = sfxFams()[it.fam] || {};
    p.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4 text-primary"><use href="#i-audio-lines"/></svg><span class="text-sm font-bold">${T('افکتِ صوتی', 'Sound effect')}</span></div>
      <div class="flex items-center gap-2 rounded-box border border-base-300 p-2"><button class="btn btn-ghost btn-sm btn-circle" onclick="previewSfx('${escapeHtml(c.file)}')" aria-label="${T('شنیدن', 'Listen')}"><svg class="size-4"><use href="#i-play"/></svg></button>
        <div class="min-w-0 flex-1"><div class="truncate text-sm font-semibold">${escapeHtml(sfxName(c))}</div><div class="truncate text-xs text-base-content/60">${escapeHtml([fam.fa ? T(fam.fa, fam.en) : '', it.sec ? num(it.sec) + T('ث', ' s') : ''].filter(Boolean).join(' · '))}</div></div></div>
      ${clipVolField(c)}
      <button class="btn btn-sm w-full gap-1.5 border-base-content/15 bg-base-100" onclick="replaceSfxClip('${c.id}')"><svg class="size-4"><use href="#i-replace"/></svg>${T('جایگزینی با صدای دیگر…', 'Replace with another sound…')}</button>`; }
  else if (c.type === 'ovl'){ const [, r] = rFind(c.rid || c.id); if (!r){ p.classList.add('hidden'); return; } const sp = rSpk(r), k = sp ? spkList().indexOf(sp) : -1;
    p.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4 text-primary"><use href="#i-message-circle"/></svg><span class="text-sm font-bold">${T('واکنشِ هم‌زمان', 'Overlapping reaction')}</span>${rVoiced(r) ? '' : `<span class="badge badge-ghost badge-sm ms-auto">${T('ساخته نشده', 'not generated')}</span>`}</div>
      <div class="flex items-center gap-2 rounded-box border border-base-300 p-2"><span class="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full text-xs font-bold" style="${k >= 0 ? spkVars(k) + ';background:var(--sc);color:var(--so)' : ''}">${k >= 0 ? spkFace(sp) : '<svg class="size-4"><use href="#i-user"/></svg>'}</span>
        <div class="min-w-0 flex-1"><div class="truncate text-sm font-semibold" dir="auto">${escapeHtml(r.text)}</div><div class="truncate text-xs text-base-content/60">${escapeHtml(sp ? sp.name : T('صدای پروژه', "The project's voice"))}${r.mood ? ' · ' + escapeHtml(toneLabel(r.mood)) : ''}</div></div></div>
      ${clipVolField(c)}
      <div class="grid grid-cols-3 gap-2"><button class="btn btn-sm gap-1 border-base-content/15 bg-base-100" onclick="ovlEdit()"><svg class="size-3.5"><use href="#i-pencil"/></svg>${T('ویرایش', 'Edit')}</button><button class="btn btn-sm gap-1 border-base-content/15 bg-base-100" onclick="ovlRegen()"><svg class="size-3.5"><use href="#i-refresh-cw"/></svg>${T('بازتولید', 'Regenerate')}</button><button class="btn btn-sm gap-1 border-base-content/15 bg-base-100 text-error" onclick="ovlDel()"><svg class="size-3.5"><use href="#i-trash-2"/></svg>${T('حذف', 'Delete')}</button></div>`; }
  else { p.classList.add('hidden'); return; }
  try { wireRangeValues(); vResets(p); } catch (err) {} }
const clipForPanel = () => { if (typeof mode !== 'undefined' && mode === 'video') return null; const c = selClip ? findClip(selClip)[1] : null; return c && (c.type === 'sfx' || c.type === 'ovl') ? c : null; };
{ const _si176 = showInsp; showInsp = function(w){ const p = $('insp-clip'); if (p) p.classList.add('hidden'); const r = _si176.apply(this, arguments); const c = w === 'proj' ? clipForPanel() : null; if (c) showClipPanel(c); return r; }; }
clipVolBox = function(){ const box = $('clipVol'); if (box) box.classList.add('hidden'); const p = $('insp-clip'), c = clipForPanel();
  if (c && (!p || p.classList.contains('hidden') || p._for !== c.id || !p.contains(document.activeElement))){ showClipPanel(c); clipPanelEl()._for = c.id; }
  else if (!c && p && !p.classList.contains('hidden')){ p.classList.add('hidden'); showInsp(sel.size === 1 ? 'line' : 'proj'); } };
{ const _smi176 = showMusicInspector; showMusicInspector = function(){ const r = _smi176.apply(this, arguments); const m = $('insp-music'), c = selClip ? findClip(selClip)[1] : null; let box = $('musicClipVol');
    if (!box){ box = document.createElement('div'); box.id = 'musicClipVol'; m.insertBefore(box, m.children[1] || null); } box.innerHTML = c && c.type === 'music' ? clipVolField(c) : ''; try { wireRangeValues(); vResets(box); } catch (err) {} return r; }; }
function replaceSfxClip(id){ SFX_REPLACE_A = id; openSfxLib(); const d = $('sfxDlg'); if (d) d.addEventListener('close', () => setTimeout(() => { SFX_REPLACE_A = null; }, 0), { once: true }); }
{ const _as176 = addSfx; addSfx = async function(file){ const id = SFX_REPLACE_A; if (!id) return _as176.apply(this, arguments); SFX_REPLACE_A = null;
    const it = sfxItems().find(x => x.file === file), [, c] = findClip(id); if (!it || !c) return; remember(); if (SFX_PREV){ try { SFX_PREV.stop(); } catch (err) {} SFX_PREV = null; } const d = $('sfxDlg'); if (d && d.open) d.close();
    loadSfx(file).catch(err => say(err.message || String(err), 'err')); c.file = file; c.name = T(it.fa, it.en); c.in = 0; c.out = it.sec; delete c.src; delete c.trimIn; delete c.trimOut; selClip = c.id;
    renderTimeline(); showClipPanel(c); autosave(); say(T('افکت عوض شد: ', 'Effect replaced: ') + c.name, 'ok'); }; }

// 176 · the audio inspector's reset icons follow the same rule as the video's: shown only when the value is off its default
const AUD_DEF = { cbxSpeed: 1, cbxExag: 0.8, cbxCfg: 1, cbxTemp: 0, lightSpeed: 1, lightNoise: 0.667, lightNoiseW: 0.8, fishSpeed: 1, fishVolume: 0, fishTemp: 0.7, fishTopP: 0.7, mLevel: -16, mFadeIn: 1.5, mFadeOut: 1.5, mDuckDb: 12,
  pVoice: 'Charon', pPreset: 'neutral', pState: '', pAge: '', pLang: 'fa', cbxVoice: 'default', fishVoice: 'default', fishLatency: 'normal', fishPreset: 'neutral', fishAge: '', fishState: '',
  pEngine: () => (typeof DEFAULTS !== 'undefined' && DEFAULTS.engine) || 'google', pModel: () => (typeof DEFAULTS !== 'undefined' && DEFAULTS.model) || 'gemini-3.1-flash-tts-preview', fishModel: () => ((DIRECTOR.fish_models || [])[0] || [''])[0] };
const AUD_SRC = { pVoice: ['proj', 'g_voice'], pPreset: ['proj', 'g_preset'], pState: ['proj', 'g_state'], pAge: ['proj', 'g_age'], pLang: ['proj', 'g_lang'], pEngine: ['proj', 'engine'], pModel: ['proj', 'g_model'],
  mLevel: ['music', 'level_db'], mFadeIn: ['music', 'fade_in'], mFadeOut: ['music', 'fade_out'], mDuckDb: ['music', 'duck_db'] };
function audVal(id, el){ try { if (typeof ENG_MAP !== 'undefined' && ENG_MAP[id]){ const [g, k] = ENG_MAP[id]; return S.proj[g][k]; } const m = AUD_SRC[id]; if (m) return m[0] === 'proj' ? S.proj[m[1]] : S.music[m[1]]; } catch (err) {} return el ? el.value : undefined; }   // the document's value (a control can lag behind it)
function syncAudioResets(){ document.querySelectorAll('aside [data-rst]').forEach(b => { const id = b.dataset.rst, el = $(id); if (!el || !(id in AUD_DEF)) return; let d = AUD_DEF[id]; if (typeof d === 'function') d = d();
  const v = audVal(id, el), same = typeof d === 'number' ? Math.abs(+v - d) < 1e-6 : String(v ?? '') === String(d); b.classList.toggle('invisible', same); }); }
{ const _se176 = setEng; setEng = function(){ const r = _se176.apply(this, arguments); requestAnimationFrame(syncAudioResets); return r; }; const _sp176p = setProj; setProj = function(){ const r = _sp176p.apply(this, arguments); requestAnimationFrame(syncAudioResets); return r; };
  const _sm176 = setMusic; setMusic = function(){ const r = _sm176.apply(this, arguments); requestAnimationFrame(syncAudioResets); return r; }; }
['input', 'change'].forEach(t => document.addEventListener(t, ev => { if (ev.target.closest && ev.target.closest('aside')) requestAnimationFrame(syncAudioResets); }, true));
document.addEventListener('click', ev => { if (ev.target.closest && ev.target.closest('[data-rst]')) setTimeout(syncAudioResets, 0); }, true);
{ const _fe2176 = fillExtras2; fillExtras2 = function(){ const r = _fe2176.apply(this, arguments); try { syncAudioResets(); } catch (err) {} return r; }; }
{ const _smi176b = showMusicInspector; showMusicInspector = function(){ const r = _smi176b.apply(this, arguments); try { syncAudioResets(); } catch (err) {} return r; }; }

// 176 · a collapse opens by its class (the stylesheet has no :has() any more): kept in step with its checkbox
function syncCollapses(root){ (root || document).querySelectorAll('.collapse').forEach(c => { const i = c.querySelector(':scope > input[type=checkbox], :scope > input[type=radio]'); if (i) c.classList.toggle('collapse-open', i.checked); }); }
document.addEventListener('change', ev => { const t = ev.target; if (t && (t.type === 'checkbox' || t.type === 'radio') && t.parentElement && t.parentElement.classList.contains('collapse')) syncCollapses(t.parentElement.parentElement || document); }, true);
syncCollapses();
{ const _svp176c = showVPanels; showVPanels = function(){ const r = _svp176c.apply(this, arguments); try { syncCollapses($('vinsp')); } catch (err) {} return r; }; }
{ const _rpu176c = renderPodUI; renderPodUI = function(){ const r = _rpu176c.apply(this, arguments); try { syncCollapses($('iv-pod')); } catch (err) {} return r; }; }
{ const _fp176c = fillPip; fillPip = function(){ const r = _fp176c.apply(this, arguments); try { syncCollapses($('iv-pip')); } catch (err) {} return r; }; }
{ const _fe2176c = fillExtras2; fillExtras2 = function(){ const r = _fe2176c.apply(this, arguments); try { syncCollapses(document.querySelector('aside')); } catch (err) {} return r; }; }
{ const _rsp176c = renderSpeakers; renderSpeakers = function(){ const r = _rsp176c.apply(this, arguments); try { syncCollapses(document.querySelector('aside')); } catch (err) {} return r; }; }

// 176 · dragging on the canvas changes nothing on the timeline: it is drawn once, when the drag ends (not on every move)
var VDRAGGING = false, VTL_DIRTY = false;
{ const _rvtl176 = renderVTL; renderVTL = function(){ if (VDRAGGING){ VTL_DIRTY = true; return; } return _rvtl176.apply(this, arguments); }; }
['startVMove', 'startVScale', 'startVRotate'].forEach(name => { const f = window[name]; window[name] = function(){ VDRAGGING = true;
  const done = () => { removeEventListener('pointerup', done, true); VDRAGGING = false; if (VTL_DIRTY){ VTL_DIRTY = false; renderVTL(); } }; addEventListener('pointerup', done, true); return f.apply(this, arguments); }; });

// 176 · closing the effects library (by any way) ends a «Replace»: the next pick is a new effect (the close event could come too late)
{ const _osl176 = openSfxLib; openSfxLib = function(){ const r = _osl176.apply(this, arguments); const d = $('sfxDlg');
    if (d && !d._cl176){ d._cl176 = true; const c0 = d.close.bind(d); d.close = function(){ const r2 = c0.apply(this, arguments); SFX_REPLACE = null; SFX_REPLACE_A = null; return r2; }; d.addEventListener('close', () => { SFX_REPLACE = null; SFX_REPLACE_A = null; }); }
    return r; }; }
