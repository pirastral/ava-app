// =====================================================================================
// 177 · CONTROLS ARE DAISYUI'S OWN — the founder's rule: nothing invented, the same control everywhere, as in the mock.
//   · a choice of a value = daisyUI's select: the native list, exactly as the mock uses it — the system sizes it to what
//     it lists, keeps it on screen (it flips at the edges by itself), a second click closes it, typing jumps to an item.
//     Whatever the old home-made list did besides choosing sits beside it in a daisyUI join: ▶ hears the chosen voice,
//     a pin makes the choice the default, a trash deletes a voice of yours; recent picks and actions («Google voice
//     library…») are entries of the list itself. Native menus follow the app's day/night theme (set_appearance).
//   · a list of actions = daisyUI's dropdown (details + summary + menu): a second click closes it, a click outside, a
//     pick or Esc closes it, it opens toward the side with room. The chips in the text open the same menu beside them.
//   · a size = daisyUI join: − [number] + (a plain text field: no browser arrows), Shift steps ten.
//   · a colour = a round swatch with its hex; the swatch opens Coloris (one picker, the same on every platform) right
//     beside it, with the frame's colours as its swatches; a hex typed in moves the swatch and the picker.
// =====================================================================================
var SEL_X = 'data-x177';
function selActs(sel){ const a = sel._actions; return (typeof a === 'function' ? a() : a) || []; }

// ---------------- selects ----------------
function selDecorate(sel){
  [...sel.querySelectorAll(`[${SEL_X}]`)].forEach(x => x.remove());
  const keep = sel.value, opts = [...sel.options];
  const rec = (sel.dataset.recent ? (RECENT[sel.dataset.recent] || []) : []).map(v => opts.find(o => o.value === v && !o.disabled)).filter(Boolean);
  if (rec.length){ const g = document.createElement('optgroup'); g.label = T('اخیراً', 'Recent'); g.setAttribute(SEL_X, '');
    rec.forEach(o => { const c = o.cloneNode(true); c.selected = false; c.removeAttribute('selected'); g.appendChild(c); }); sel.insertBefore(g, sel.firstChild); }
  const acts = selActs(sel);
  if (acts.length){ const g = document.createElement('optgroup'); g.label = T('بیشتر', 'More'); g.setAttribute(SEL_X, '');
    acts.forEach((a, k) => { const o = document.createElement('option'); o.value = '__act:' + k; o.textContent = T(a[1], a[2]); g.appendChild(o); }); sel.appendChild(g); }
  const orig = [...sel.options].find(o => o.value === keep && !o.parentElement.hasAttribute(SEL_X)); if (orig) orig.selected = true;
}
function selSide(sel){
  const pv = sel.dataset.preview !== undefined, pin = typeof sel._onPin === 'function', del = typeof sel._onDel === 'function';
  if (!pv && !pin && !del) return;
  const sz = /\bselect-xs\b/.test(sel.className) ? 'btn-xs' : 'btn-sm';
  if (!sel._j177){
    let j = sel.parentElement;
    if (!j || !j.classList.contains('join')){ j = document.createElement('div'); j.className = 'join w-full'; sel.replaceWith(j); j.appendChild(sel); }
    sel.classList.add('join-item', 'min-w-0', 'flex-1'); sel.classList.remove('w-full');
    j.addEventListener('click', ev => { const b = ev.target.closest('.sd177'); if (!b || b.parentElement !== j) return; ev.preventDefault(); ev.stopPropagation(); const v = sel.value;
      if (b.dataset.sd === 'pv'){ if (sel._preview) sel._preview(v); } else if (b.dataset.sd === 'pin'){ if (sel._onPin) sel._onPin(v); } else if (sel._onDel) sel._onDel(v); });
    sel._j177 = j;
  }
  // a button whose handler came later is added then (a list can get its ▶ after its trash, say)
  const mk = (k, icon, fa, en) => { const b = document.createElement('button'); b.type = 'button'; b.className = `sd177 btn ${sz} join-item btn-square border-base-content/15 bg-base-100`; b.dataset.sd = k; b.dataset.tip = fa; b.dataset.tipEn = en; b.setAttribute('aria-label', en); b.innerHTML = `<svg class="size-3.5"><use href="#i-${icon}"/></svg>`; return b; };
  if (pv && !sel._sdPv) sel._sdPv = mk('pv', 'play', 'شنیدنِ صدا', 'Hear the voice');
  if (pin && !sel._sdPin) sel._sdPin = mk('pin', 'pin', 'پیش‌فرض کن', 'Make default');
  if (del && !sel._sdDel) sel._sdDel = mk('del', 'trash-2', 'حذفِ این صدا', 'Delete this voice');
  let at = sel; [sel._sdPv, sel._sdPin].forEach(b => { if (b){ if (at.nextElementSibling !== b) at.after(b); at = b; } });
}
function enh(sel){
  if (!sel || sel.tagName !== 'SELECT') return;
  if (sel._btn){ try { sel._btn.remove(); } catch (e) {} sel._btn = null; }
  sel.classList.remove('hidden'); sel.classList.add('select');
  if (sel.dataset.compact !== undefined) [...sel.options].forEach(o => { const t = o.text, k = t.indexOf(' — '); if (k > 0){ o.title = t; o.text = t.slice(0, k); } });   // a narrow list shows the short name
  if (!sel._n177){ sel._n177 = true;
    const mark = () => { sel._prev = sel.value; };
    const opened = () => { mark(); try { openDD(sel); } catch (e) {} };   // 177: opening a list is still «opening that engine's voice menu» (it clears the warning dot)
    sel.addEventListener('pointerdown', opened, true); sel.addEventListener('focus', opened); sel.addEventListener('keydown', mark, true);
    sel.addEventListener('change', ev => { const v = sel.value;
      if (v.startsWith('__act:')){ ev.stopImmediatePropagation(); const p = sel._prev, o = [...sel.options].find(x => x.value === p && !x.parentElement.hasAttribute(SEL_X)); if (o) o.selected = true; else sel.value = p || '';
        const f = selActs(sel)[+v.slice(6)]; if (f) setTimeout(() => f[3](), 0); return; }
      sel._prev = v; if (sel.dataset.recent) noteRecent(sel.dataset.recent, v); setTimeout(() => { selDecorate(sel); refreshEnh(sel); }, 0); }, true);
  }
  selDecorate(sel); selSide(sel); refreshEnh(sel);
}
function refreshEnh(sel){ if (!sel || !sel._n177) return; selDecorate(sel); selSide(sel); const o = sel.options[sel.selectedIndex];   /* a handler given after the list was set up still gets its button */
  if (sel._sdDel){ const show = !!(o && o.dataset.del !== undefined), last = sel._sdPin || sel._sdPv || sel;
    if (show && !sel._sdDel.isConnected) last.after(sel._sdDel); else if (!show && sel._sdDel.isConnected) sel._sdDel.remove(); }
  if (sel._sdPin){ const on = !!(o && o.dataset.pinned !== undefined); sel._sdPin.classList.toggle('text-primary', on); sel._sdPin.dataset.tip = on ? 'پیش‌فرض همین است' : 'پیش‌فرض کن'; sel._sdPin.dataset.tipEn = on ? 'This is the default' : 'Make default'; }
  if (sel._sdPv) sel._sdPv.disabled = !sel.value && !sel._pvAny;   /* a line's «as the speaker» entry still has a voice to hear */
}
function openDD(){}   // 177: a select opens the system's own list
function filterDD(){}

// ---------------- action menus: daisyUI dropdown (details) ----------------
function ddPlace(d){ const c = d.querySelector(':scope > .dropdown-content'), s = d.querySelector(':scope > summary'); if (!c || !s) return;
  if (d.dataset.end === undefined) d.dataset.end = d.classList.contains('dropdown-end') ? '1' : '0';
  d.classList.remove('dropdown-top'); d.classList.toggle('dropdown-end', d.dataset.end === '1'); c.style.maxHeight = 'none';
  const r = s.getBoundingClientRect(), h = c.scrollHeight, below = innerHeight - r.bottom - 12, above = r.top - 12, up = h > below && above > below;
  d.classList.toggle('dropdown-top', up); c.style.maxHeight = Math.max(140, Math.min(h, up ? above : below)) + 'px'; c.style.overflowY = 'auto';
  const w = c.offsetWidth, rtl = getComputedStyle(d).direction === 'rtl';
  const startOver = rtl ? r.right - w < 8 : r.left + w > innerWidth - 8, endOver = rtl ? r.left + w > innerWidth - 8 : r.right - w < 8;
  let end = d.dataset.end === '1'; if (!end && startOver && !endOver) end = true; else if (end && endOver && !startOver) end = false;
  d.classList.toggle('dropdown-end', end); }
function closeMenus(except){ document.querySelectorAll('details.dropdown[open]').forEach(d => { if (d !== except) d.open = false; }); }
document.addEventListener('click', ev => { const t = ev.target; if (!t.closest) return;
  const s = t.closest('details.dropdown > summary');
  if (s){ const d = s.parentElement, opening = !d.open; closeMenus(d); closeDD(); if (opening) requestAnimationFrame(() => ddPlace(d)); return; }
  const a = t.closest('details.dropdown[open] .dropdown-content a, details.dropdown[open] .dropdown-content button'); if (a){ const d = a.closest('details.dropdown'); setTimeout(() => { d.open = false; }, 0); } }, true);
document.addEventListener('pointerdown', ev => { document.querySelectorAll('details.dropdown[open]').forEach(d => { if (!d.contains(ev.target)) d.open = false; }); }, true);
document.addEventListener('keydown', ev => { if (ev.key === 'Escape'){ closeMenus(); closeDD(); } });

// ---------------- the same menu beside a chip in the text (speaker, tone, sound tag) ----------------
function ddHome(){ let m = document.getElementById('ddMenu'); if (!m){ m = document.createElement('ul'); m.id = 'ddMenu'; document.body.appendChild(m); }
  m.className = 'menu menu-sm fixed z-[1100] flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-200 p-1.5 shadow-lg' + (m._open ? '' : ' hidden'); return m; }
function menuPlace(m, b){ const r = b.getBoundingClientRect(); m.style.width = 'max-content'; m.style.maxWidth = Math.min(340, innerWidth - 16) + 'px'; m.style.maxHeight = 'none'; m.style.bottom = '';
  const w = Math.min(m.offsetWidth, innerWidth - 16), h = m.scrollHeight, below = innerHeight - r.bottom - 12, above = r.top - 12, up = h > below && above > below, mh = Math.max(140, Math.min(h, up ? above : below));
  m.style.maxHeight = mh + 'px'; const rtl = m.dir === 'rtl'; m.style.left = Math.max(8, Math.min(innerWidth - w - 8, rtl ? r.right - w : r.left)) + 'px';
  m.style.top = (up ? Math.max(8, r.top - 4 - Math.min(h, mh)) : r.bottom + 4) + 'px'; }
function placeMenu(m, b){ menuPlace(m, b); }
function lineMenu(b, html, onPick){ const m = ddHome(); if (m._open && m._anchor === b){ closeDD(); return; }
  closeMenus(); if (m.parentElement !== document.body) document.body.appendChild(m); m.dir = lang === 'fa' ? 'rtl' : 'ltr'; m.innerHTML = html; m._open = true; m._anchor = b; m._sel = { _btn: b };   // a click on the chip again closes it (the old outside-closer spares the anchor)
  m.classList.remove('hidden'); menuPlace(m, b); m.onclick = e => onPick(e); }
function closeDD(){ const m = document.getElementById('ddMenu'); if (!m) return; m._open = false; m._anchor = null; m._sel = null; m.classList.add('hidden'); if (m.parentElement !== document.body) document.body.appendChild(m); }
document.addEventListener('pointerdown', ev => { const m = document.getElementById('ddMenu'); if (!m || !m._open) return; if (m.contains(ev.target) || (m._anchor && m._anchor.contains(ev.target))) return; closeDD(); }, true);
addEventListener('resize', () => { closeDD(); closeMenus(); });

// ---------------- a slider's legend: the label, then its value at the far end, then its reset icon ----------------
// 177: two helpers laid legends out two ways (the value beside the label on some sliders, in the middle on others)
function legendTidy(lg){ if (!lg) return; lg.classList.add('flex', 'w-full', 'items-center', 'gap-1'); lg.classList.remove('justify-between');
  const rv = lg.querySelector(':scope > .rv'), rs = [...lg.querySelectorAll(':scope > .rst, :scope > .vrst, :scope > .cfrst, :scope > .nfrst, :scope > .xrst')];
  if (rv){ lg.querySelectorAll(':scope > .lgsp').forEach(x => x.remove()); rv.className = 'rv ms-auto shrink-0 text-xs font-medium tabular-nums text-base-content/80'; rv.removeAttribute('dir');   /* its own ltr direction turned «ms-auto» into the wrong side */ let at = rv; rs.forEach(b => { b.classList.remove('ms-auto'); at.after(b); at = b; }); }
  else if (rs.length && !lg.querySelector(':scope > .lgsp')) rs[0].classList.add('ms-auto'); }
function legendsTidy(root){ (root || document).querySelectorAll('legend.fieldset-legend').forEach(lg => { if (lg.querySelector(':scope > .rv, :scope > .rst, :scope > .vrst, :scope > .cfrst, :scope > .nfrst, :scope > .xrst')) legendTidy(lg); }); }

// ---------------- size: daisyUI join − [number] + ----------------
function numField(key){ const f = NF[key]; if (!f) return ''; const v = Math.round(f.get());
  return `<div class="nfield join" data-nf="${key}" dir="ltr"><button type="button" class="btn btn-sm join-item btn-square border-base-content/15 bg-base-100" data-nfd="-1" aria-label="−" data-tip="کمتر (Shift: ده‌تا)" data-tip-en="Less (Shift: by ten)"><svg class="size-3.5"><use href="#i-minus"/></svg></button>`
    + `<input type="text" inputmode="numeric" class="nfin input input-sm join-item w-16 px-1 text-center tabular-nums" value="${v}" aria-label="${f.unit || 'value'}" spellcheck="false">`
    + `<button type="button" class="btn btn-sm join-item btn-square border-base-content/15 bg-base-100" data-nfd="1" aria-label="+" data-tip="بیشتر (Shift: ده‌تا)" data-tip-en="More (Shift: by ten)"><svg class="size-3.5"><use href="#i-plus"/></svg></button></div>`; }

// ---------------- colour: round swatch (opens Coloris beside it) + hex ----------------
function colorField(key, frame){ const f = CF[key]; if (!f) return ''; const cur = hex6(f.get()) || '#ffffff', own = Array.isArray(frame);   /* an array: its own swatches (no canvas reading) */
  const sw = frame ? (own ? frame : frameColors()).map(c => `<button type="button" class="cfsw size-[22px] shrink-0 cursor-pointer rounded-full border border-base-content/25 ring-offset-1 ring-offset-base-200 ${cdist(c, cur) < 6 ? 'ring-2 ring-primary' : ''}" style="background:${c}" data-c="${c}" aria-label="${c}" data-tip="${c.toUpperCase()}"></button>`).join('')
    + (own ? '' : `<button type="button" class="btn btn-ghost btn-xs btn-circle shrink-0" data-cfr data-tip="رنگ‌ها را دوباره از صفحه بخوان" data-tip-en="Read the colors from the canvas again" aria-label="refresh"><svg class="size-3.5"><use href="#i-refresh-cw"/></svg></button>`) : '';
  return `<div class="cfield flex items-center gap-1" data-cf="${key}" ${own ? 'data-own="1"' : ''} dir="ltr">${sw}<span class="min-w-1 flex-1"></span>`
    + `<input type="text" readonly class="cpk cpick size-[26px] shrink-0 cursor-pointer rounded-full border border-base-content/25 text-transparent caret-transparent outline-none" style="background:${cur}" value="${cur}" aria-label="${T('انتخابِ رنگ', 'Pick a color')}" data-tip="${T('انتخابِ رنگ', 'Pick a color')}">`
    + `<input class="cfhex input input-xs w-[4.6rem] px-1.5 text-center uppercase tabular-nums" value="${cur.toUpperCase()}" maxlength="7" spellcheck="false" aria-label="hex"></div>`; }
function cfPaint(el, c){ if (!el) return; const pk = el.querySelector('.cpk'), hx = el.querySelector('.cfhex'), f = CF[el.dataset.cf], fs = el.closest('fieldset'), rs = fs && fs.querySelector('legend .cfrst');
  if (pk){ pk.style.background = c; if (pk.value !== c) pk.value = c; } if (hx && document.activeElement !== hx) hx.value = c.toUpperCase();
  el.querySelectorAll('.cfsw').forEach(s => ['ring-2', 'ring-primary'].forEach(k => s.classList.toggle(k, cdist(s.dataset.c, c) < 6))); if (rs && f) rs.classList.toggle('invisible', cdist(c, hex6(f.def) || c) < 1);
  if (window.Coloris && pk && document.querySelector('.clr-picker.clr-open') && CLR_EL === pk) try { Coloris.updatePosition && Coloris.updatePosition(); } catch (e) {} }
// every other colour field (a native <input type=color> written anywhere) becomes the same swatch + hex, wired to Coloris
function enhColors(root){ (root || document).querySelectorAll('input[type=color]:not([data-cfx])').forEach(inp => { if (inp.closest('.cfield')) return; inp.dataset.cfx = '1';
  const wrap = document.createElement('span'); wrap.className = 'cfx inline-flex items-center gap-1.5'; wrap.dir = 'ltr'; inp.replaceWith(wrap);
  const pk = document.createElement('input'); pk.type = 'text'; pk.readOnly = true; pk.className = 'cpk cpick size-7 shrink-0 cursor-pointer rounded-full border border-base-content/25 text-transparent caret-transparent outline-none'; pk.value = inp.value; pk.style.background = inp.value; pk.setAttribute('aria-label', T('انتخابِ رنگ', 'Pick a color'));
  inp.type = 'hidden'; inp.classList.add('hidden');
  const hx = document.createElement('input'); hx.className = 'cfhex input input-xs w-[5.4rem] uppercase tabular-nums'; hx.maxLength = 7; hx.spellcheck = false; hx.value = (inp.value || '').toUpperCase(); hx.setAttribute('aria-label', 'hex');
  wrap.append(inp, pk, hx);
  const sync = () => { pk.style.background = inp.value; pk.value = inp.value; if (document.activeElement !== hx) hx.value = (inp.value || '').toUpperCase(); };
  const push = (c, fin) => { inp.value = c; sync(); inp.dispatchEvent(new Event('input', { bubbles: true })); if (fin) inp.dispatchEvent(new Event('change', { bubbles: true })); };
  inp._cfsync = sync; pk._cfx = push;
  hx.addEventListener('change', () => { const c = hex6(hx.value); if (!c){ hx.value = (inp.value || '').toUpperCase(); return; } push(c, true); });
  hx.addEventListener('input', () => { const c = hex6(hx.value); if (c) push(c, false); });
  hx.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); hx.blur(); } }); }); }
function syncColors(root){ (root || document).querySelectorAll('input[data-cfx]').forEach(inp => inp._cfsync && inp._cfsync()); }
// the hex field of a colour field moves the swatch (and the picker) as it is typed
document.addEventListener('input', ev => { const t = ev.target; if (!t.classList || !t.classList.contains('cfhex')) return; const el = t.closest('.cfield'); if (!el) return; const c = hex6(t.value); if (c) cfApply(el, c, true); }, true);

// Coloris: one picker for every swatch — opens beside it, flips at the window's edges, the frame's colours as swatches
var CLR_EL = null, CLR_ON = false;
function clrInit(){ if (CLR_ON || !window.Coloris) return; CLR_ON = true;
  try { Coloris.init && Coloris.init(); } catch (e) {}
  Coloris({ el: '.cpk', wrap: false, theme: 'default', themeMode: document.documentElement.dataset.theme === 'ava-day' ? 'light' : 'dark', alpha: false, format: 'hex', margin: 6, focusInput: true, swatches: [], closeButton: false,
    a11y: { open: T('باز کردنِ انتخاب‌گرِ رنگ', 'Open color picker'), close: T('بستن', 'Close'), marker: T('رنگ', 'Color'), hueSlider: T('ته‌رنگ', 'Hue'), alphaSlider: T('شفافیت', 'Opacity'), input: T('کدِ رنگ', 'Color value'), format: T('قالب', 'Format'), swatch: T('نمونهٔ رنگ', 'Swatch'), instruction: '' } }); }
function clrTheme(){ if (!window.Coloris || !CLR_ON) return; try { Coloris({ themeMode: document.documentElement.dataset.theme === 'ava-day' ? 'light' : 'dark' }); } catch (e) {} }
document.addEventListener('pointerdown', ev => { const pk = ev.target.closest && ev.target.closest('.cpk'); if (!pk) return; clrInit();
  let sw = []; const el = pk.closest('.cfield'); try { sw = el && el.querySelector('.cfsw') ? [...el.querySelectorAll('.cfsw')].map(s => s.dataset.c) : (typeof frameColors === 'function' && $('vcanvas') ? frameColors() : []); } catch (e) { sw = []; }
  try { Coloris({ swatches: sw }); } catch (e) {} CLR_EL = pk; }, true);
document.addEventListener('input', ev => { const pk = ev.target; if (!pk.classList || !pk.classList.contains('cpk')) return; const c = hex6(pk.value); if (!c) return; pk.style.background = c;
  const el = pk.closest('.cfield'); if (el){ cfApply(el, c, true); return; } if (pk._cfx) pk._cfx(c, false); }, true);
document.addEventListener('close', ev => { const pk = ev.target; if (!pk.classList || !pk.classList.contains('cpk')) return; const el = pk.closest('.cfield'); if (el){ CF_LIVE = null; autosave(); } else if (pk._cfx) pk._cfx(hex6(pk.value) || pk.value, true); }, true);

// the native lists and the colour picker follow the app's day/night theme (macOS menus take the window's appearance)
function themeSync(){ const dark = document.documentElement.dataset.theme !== 'ava-day'; try { const a = API(); if (a && a.set_appearance) a.set_appearance(dark); } catch (e) {} clrTheme(); }
{ const tc = document.getElementById('themeChk'); if (tc) tc.addEventListener('change', () => setTimeout(themeSync, 0)); }
addEventListener('pywebviewready', themeSync); setTimeout(themeSync, 400);

// ---------------- every inspector action is one undo step ----------------
// a control's first change (a slider's whole drag, a run of typing in one field, a pick) records the state before it;
// another control, or a pause of 1.5 s, starts a new step. remember() itself drops a step that changed nothing.
var HMARK = { el: null, t: 0 };
function histMark(el){ const now = performance.now(); if (HMARK.el === el && now - HMARK.t < 1500){ HMARK.t = now; return; } HMARK.el = el; HMARK.t = now; remember(); }
// on the WINDOW, in the capture phase: it runs before every other listener (the colour fields and number fields apply their
// value in document-level listeners — recorded after them, the step held the new value and ⌘Z brought nothing back)
['input', 'change'].forEach(type => window.addEventListener(type, ev => { const t = ev.target; if (!t || !t.closest || !t.matches) return;
  if (!t.closest('aside, #heads, #stageBar, #stageMini') || t.closest('#editor, [data-nohist]') || t.matches('input[type=file], input[type=search], .collapse > input, [role=tab]')) return; histMark(t); }, true));

// ---------------- the language switch redraws whatever is open ----------------
// 177: an inspector, a panel or a dialog drawn in Persian stayed Persian after switching to English (the founder: the
//      inspectors are Farsi in English) — everything drawn by code is drawn again in the language on screen
function relang(){
  try { renderTimeline(); } catch (e) {}
  try { projFileShow(); } catch (e) {}
  try { if (typeof renderSpeakers === 'function') renderSpeakers(); } catch (e) {}
  closeDD(); closeMenus();
  try {
    if (mode === 'video'){ const ap = $('iv-anim'), anim = !!(ap && !ap.classList.contains('hidden')); showVPanels(anim); placeVObjBar(); }
    else {
      const vis = id => { const e = $(id); return !!(e && !e.classList.contains('hidden')); };
      if (vis('insp-clip') && selClip){ const fc = typeof findClip === 'function' ? findClip(selClip) : null, c = fc && fc[1]; if (c) showClipPanel(c); }
      else if (vis('insp-music')) showMusicInspector();
      else if (vis('insp-line') && sel.size === 1) fillLineInspector([...sel][0]);
    }
  } catch (e) { console.warn('relang', e); }
  const open = id => { const d = $(id); return !!(d && d.open); };
  try { if (open('sfxDlg')) renderSfxLib(); } catch (e) {}
  try { if (open('libDlg')) renderLibList(); } catch (e) {}
  try { if (open('fishLibDlg')) renderFishList(); } catch (e) {}
  try { if (open('settingsDlg')) fillSettings(); } catch (e) {}
  try { if (open('helpDlg') && typeof openHelp === 'function'){ const d = $('helpDlg'); d.close(); openHelp(); } } catch (e) {}
  document.querySelectorAll('aside input[type=range], dialog input[type=range]').forEach(el => { if (el._rv) el._rv.textContent = rvText(el); });
}
{ const lb = document.getElementById('langBtn'); if (lb){ const f0 = lb.onclick; lb.onclick = function(ev){ const r = f0 ? f0.call(this, ev) : undefined; try { relang(); } catch (e) { console.warn(e); } return r; }; } }

try { projFileShow(); } catch (e) {}

// =====================================================================================
// 178 · THE WORK AREA AND THE TIMELINE SHARE THE HEIGHT — the handle between them (it shows on hover) moves the line by up
//       to 30 % of the timeline's default height either way, in both editors. A timeline made shorter than its default
//       packs its tracks: lower tracks and clips (their titles hidden), slimmer track headers, less space between tracks;
//       at its default height or taller nothing changes. A right-click on the handle puts both back. Kept on this Mac.
// =====================================================================================
var SPLIT = 1, TRK_MIN = 44; const SPLIT_MIN = 0.7, SPLIT_MAX = 1.3;   // 178: the founder chose 44 px tracks (38 px clips) for the shortest timeline
try { const v = parseFloat(localStorage.getItem('ava-split')); if (v >= SPLIT_MIN && v <= SPLIT_MAX) SPLIT = v; } catch (e) {}
const tlDefaultH = () => Math.max(240, innerHeight * 0.38);   // the section's own h-[38vh] min-h-60
function splitApply(){ const sec = document.getElementById('tlSec'); if (!sec) return; const f = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, SPLIT || 1));
  sec.style.height = Math.round(tlDefaultH() * f) + 'px'; sec.style.minHeight = '0';
  sec.classList.toggle('tl-compact', f < 0.995); sec.style.setProperty('--trk', Math.round(TRK_MIN + (56 - TRK_MIN) * Math.max(0, f - SPLIT_MIN) / (1 - SPLIT_MIN)) + 'px');   // 56 px tracks → TRK_MIN at −30 %
  if (mode === 'video'){ try { fitFrame(); vDraw(); } catch (e) {} } try { alignRuler(); } catch (e) {} try { drawReactBadges(); } catch (e) {}
  try { if (mode === 'video') placeVObjBar(); else placeClipBar(); } catch (e) {} }   // the selected clip's bar follows its clip
function splitSave(){ try { localStorage.setItem('ava-split', String(SPLIT)); } catch (e) {} }
function splitReset(){ SPLIT = 1; splitApply(); splitSave(); }
(() => { const hd = document.getElementById('splitH'); if (!hd) return;
  hd.addEventListener('pointerdown', ev => { if (ev.button !== 0) return; ev.preventDefault(); const sec = document.getElementById('tlSec'), y0 = ev.clientY, h0 = sec.getBoundingClientRect().height, d = tlDefaultH();
    try { hd.setPointerCapture(ev.pointerId); } catch (e) {} document.body.classList.add('splitting');
    const mv = e => { SPLIT = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (h0 - (e.clientY - y0)) / d)); splitApply(); };
    const up = () => { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up); document.body.classList.remove('splitting'); splitSave(); };
    hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up); });
  hd.addEventListener('contextmenu', ev => { ev.preventDefault(); splitReset(); });
  addEventListener('resize', () => splitApply()); })();
splitApply();

// =====================================================================================
// 178 · EVERY VARIABLE HAS ITS RESET ICON (the founder, 176) — the switches, lists and button rows that had none get one,
//       made the way the sliders' are: it shows once the value is off its default (the value a new project starts with);
//       a click chooses the default in the control itself, so the control's own handler applies it like a pick would
//       (one undo step). The subtitles' speaker name goes back to «automatic» (on when the script has speakers).
// =====================================================================================
const XRS = [
  ['#pCont', true], ['#fishCont', true], ['#fishCondPrev', true], ['#fishNormLoud', true], ['#fishNormalize', false], ['#fishQuality', false],
  ['#lnBody input[type=range][oninput^="clipGain"]', '100'],
  ['#bgOn', false], ['#iv-text input[name=ta]', 'center'], ['#iv-text input[name=tw]', 'auto'], ['#iv-text input[name=bs]', 'capsule'], ['#txtFont', 'Vazirmatn'], ['#txtWeight', '900'],
  ['#pipBorder', false], ['#pipShadow', false], ['#iv-pip input[name=pss]', 'solid'],
  ['#stkBgOn', false], ['#stkEmoji input[name=stkE]', '👑'], ['#stkShape', 'circle'],
  ['#iv-pod [onchange^="podPath(\'avatar.ring\'"]', true], ['#iv-pod [onchange^="podSet(\'names\'"]', true], ['#podGradOn', true], ['#waveGrid input[name=wave]', 'circle'],
  ['#bgJoin input[name=bgt]', 'mesh'], ['#bgMedia input[name=fit]', '0'], ['#posGrid input[name=pos]', '[0,0]'], ['#pLayout', 'auto'],
  ['#iv-pod [onchange^="podPath(\'label.style\'"]', 'pill'], ['#iv-pod [onchange^="podPath(\'label.weight\'"]', '700'], ['#podGradDir', 'to top'],
  ['#subBgOn', false], ['#subOutline', false], ['#subShadow', false], ['#subGlow', false], ['#subFont', 'Vazirmatn'], ['#subWeight', '700'], ['#subChunk', '0'], ['#subHiMode', 'none'], ['#subAnim', 'fade'],
  ['#subSpk', { off: () => V.subs.spk === true || V.subs.spk === false, reset: () => { remember(); delete V.subs.spk; VVER++; fillSub(); vDraw(); autosave(); } }],
  ['#iv-proj select', '30'],
];
const xrArg = el => { const m = /,\s*([^)]*)\)\s*;?\s*$/.exec(el.getAttribute('onchange') || ''); return m ? m[1].trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '') : null; };
const xrVal = el => el.type === 'checkbox' ? el.checked : el.type === 'radio' ? (el.dataset.v !== undefined ? el.dataset.v : el.value && el.value !== 'on' ? el.value : xrArg(el)) : String(el.value);
function xrBtn(){ const b = document.createElement('button'); b.type = 'button'; b.className = 'xrst btn btn-ghost btn-xs btn-square -my-1 opacity-50 hover:opacity-100'; b.dataset.tip = 'بازنشانی به پیش‌فرض'; b.dataset.tipEn = 'Reset to default'; b.setAttribute('aria-label', 'reset'); b.innerHTML = '<svg class="size-3.5"><use href="#i-rotate-ccw"/></svg>'; return b; }
function xrPlace(el){   // in its legend; a switch beside it in its row; a row of buttons right after it
  if (el._xr && el._xr.isConnected) return el._xr; const fs = el.closest('fieldset'), lg = fs && fs.querySelector('legend'); const b = xrBtn();
  if (lg && !(el.type === 'checkbox' && el.closest('label') && !lg.contains(el))){ lg.classList.add('flex', 'w-full', 'items-center'); const old = lg.querySelector(':scope > .xrst'); if (old) return (el._xr = old); lg.appendChild(b); legendTidy(lg);
    const pr = fs.parentElement; if (pr && (pr.classList.contains('grid-cols-2') || (pr.classList.contains('flex') && !pr.classList.contains('flex-col')))){ b.classList.remove('ms-auto'); lg.style.justifyContent = 'flex-start'; } }   // side by side with another field: the icon stays by its own label (daisyUI spaces a legend's items apart)
  else if (el.type === 'checkbox' && el.closest('label')){ const lab = el.closest('label'); b.classList.add('ms-auto'); b.classList.remove('-my-1'); el.before(b); lab.addEventListener('click', ev => { if (ev.target.closest('.xrst')) ev.preventDefault(); }, true); }
  else { const grp = el.closest('.join, .grid') || el; b.classList.remove('-my-1'); grp.after(b); }
  return (el._xr = b); }
let XR_T = 0; function xrSoon(){ if (XR_T) return; XR_T = setTimeout(() => { XR_T = 0; xrSync(); }, 0); }   // right after the handlers (a frame can be late)
function xrSync(){ const root = document.querySelector('aside'); if (!root) return;
  XRS.forEach(([sel, def]) => { try { xrOne(root, sel, def); } catch (e) { console.warn('reset icon', sel, e); } }); }
function xrOne(root, sel, def){ { const els = [...root.querySelectorAll(sel)]; if (!els.length) return; const radios = els[0].type === 'radio';
    const el = els[0], b = xrPlace(el); if (!b) return; const custom = def && typeof def === 'object';
    let off; if (custom) off = def.off(); else if (radios){ const on = els.find(r => r.checked); off = !!on && String(xrVal(on)) !== String(def).replace(/\s+/g, ''); } else off = el.type === 'checkbox' ? el.checked !== def : String(el.value) !== String(def) && [...(el.options || [])].some(o => o.value === String(def)) || (el.type === 'range' && String(el.value) !== String(def));
    b.classList.toggle('invisible', !off);
    b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); if (custom){ def.reset(); xrSoon(); return; }
      HMARK.el = null; if (radios){ const t = els.find(r => String(xrVal(r)) === String(def).replace(/\s+/g, '')); if (t){ t.checked = true; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (el.type === 'checkbox'){ el.checked = !!def; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      else { el.value = String(def); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      xrSoon(); }; } }
['input', 'change'].forEach(t => document.addEventListener(t, ev => { if (ev.target && ev.target.closest && ev.target.closest('aside')) xrSoon(); }));
['showVPanels', 'renderPodUI', 'fillSub', 'fillText', 'fillPip', 'fillSticker', 'fillEmoji', 'fillInspector', 'fillExtras', 'fillLineInspector', 'fillProj', 'relang'].forEach(n => { try { const f = window[n]; if (typeof f !== 'function') return;
  window[n] = function(){ const r = f.apply(this, arguments); try { xrSoon(); } catch (e) {} return r; }; } catch (e) {} });
setTimeout(xrSync, 300);   // and once the page is up
