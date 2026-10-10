// =====================================================================================
// 179 · THE LIST — one component for every list in the app: daisyUI's dropdown with its menu, drawn by the app. (177 used
//   daisyUI's `select`, which is a styled SYSTEM list: no nesting, no ▶ beside each voice, no font previews, macOS
//   drawing the open list — the founder: wrong.) Read before building: daisyUI's dropdown and menu, the W3C ARIA
//   select-only combobox (its keys), Radix Select (placement, collisions, the room there is), Apple's HIG (pop-up vs
//   pull-down buttons), NN/g (drop-downs; hover timing for submenus).
//   · the look is the speaker menu in the text editor (the founder likes it): its panel, its rows, its highlight and its
//     separators — each list keeps the width its own items need
//   · the <select> stays the data (options, groups, value, change event); a button shaped like daisyUI's select shows
//     the choice — a font in itself — and opens the list
//   · two groups or more nest: a group opens to the side after a short hover or on a click (the way toward it never
//     closes it), toward the room, one item per row; ▶ on every voice; a trash only on your own voices and on recent
//     picks; a pin where a default can be made; recent picks first; actions («Google voice library…») last; a search
//     box on long lists
//   · about ten rows at most (less when the window has less room), scrolling inside; below the field, or above it when
//     there is no room below; on the top layer, so nothing covers or cuts it (the canvas bar, the timeline, a dialog)
//   · a second click on the field, a click outside, Esc or a pick closes it; ↑ ↓ Home End PageUp PageDown, Enter or
//     Space, typing jumps to a match, ← → open and close a group (mirrored in Persian)
//   · a list of actions (Export, File, line tone, sound tag) is daisyUI's dropdown with the same panel: one column, the
//     same height limit, on the top layer. A size = daisyUI join − [number] +. A colour = swatch + hex + Coloris.
// =====================================================================================
var SEL_X = 'data-x177';
function selActs(sel){ const a = sel._actions; return (typeof a === 'function' ? a() : a) || []; }
var LIST_H = 380, LIST_W = 380, LIST_GAP = 4, LIST_EDGE = 8;   // var / function: enh() runs while the earlier files load, before this file's own lines do
var TOP_LAYER = typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function';
function lesc(s){ return escapeHtml(String(s == null ? '' : s)); }
// the top layer: above every stacking context, never cut by a scrolling box (a <dialog> opened earlier stays below it)
function layerOn(el){ if (TOP_LAYER === undefined) TOP_LAYER = typeof HTMLElement.prototype.showPopover === 'function'; el.classList.remove('hidden'); el.style.position = 'fixed'; el.style.margin = '0'; el.style.inset = 'auto';
  if (TOP_LAYER){ if (!el.hasAttribute('popover')) el.setAttribute('popover', 'manual'); try { if (!el.matches(':popover-open')) el.showPopover(); } catch (e) {} }
  else { el.style.zIndex = '1200'; const host = document.querySelector('dialog[open]'); if (host && !host.contains(el) && el.id) host.appendChild(el); } }
function layerOff(el){ if (!el) return; if (TOP_LAYER){ try { if (el.matches(':popover-open')) el.hidePopover(); } catch (e) {} } el.classList.add('hidden'); }
// the speaker menu's panel (#ddMenu): rounded box, border, base-200, the menu's own rows
var LIST_PANEL = 'avlist ui menu menu-sm flex-nowrap gap-0 overflow-hidden rounded-box border border-base-300 bg-base-200 p-1.5 text-base-content shadow-lg';
function listBox(id){ let p = document.getElementById(id); if (!p){ p = document.createElement('div'); p.id = id; p.className = LIST_PANEL + ' hidden'; document.body.appendChild(p); } return p; }

// ---------------- what a list holds ----------------
function listModel(sel){ const opts = [...sel.options], groups = []; let cur = null;
  opts.forEach(o => { const g = o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null; if (!cur || cur.g !== g){ cur = { g, items: [] }; groups.push(cur); } cur.items.push(o); });
  const nest = sel.dataset.flat === undefined && groups.filter(x => x.g).length >= 2;
  const recent = sel.dataset.recent ? ((typeof RECENT !== 'undefined' && RECENT[sel.dataset.recent]) || []).map(v => opts.find(o => o.value === v && !o.disabled)).filter(Boolean) : [];
  return { opts, groups, nest, recent, acts: selActs(sel) }; }
function listSb(k, v, icon, fa, en, cls){ return `<span role="button" tabindex="-1" class="avb btn btn-ghost btn-xs btn-square -my-1 shrink-0 ${cls || ''}" data-${k}="${lesc(v)}" data-tip="${fa}" data-tip-en="${en}" aria-label="${en}"><svg class="size-3.5"><use href="#i-${icon}"/></svg></span>`; }
function listRowA(sel, o, recent){ const v = o.value, pv = sel.dataset.preview !== undefined && (v !== '' || sel._pvAny) && o.dataset.nopv === undefined, pinned = o.dataset.pinned !== undefined;
  const font = o.dataset.font ? ` style="font-family:'${lesc(o.dataset.font)}', Vazirmatn; font-size:15px"` : '';   // a font shows in itself
  return `<a class="avrow flex items-center gap-2 ${o.selected ? 'menu-active' : ''} ${o.disabled ? 'menu-disabled' : ''}" ${o.disabled ? '' : `data-pick="${lesc(v)}"`} tabindex="-1" role="option" aria-selected="${o.selected ? 'true' : 'false'}">`
    + `<span class="min-w-0 flex-1 whitespace-normal break-words" dir="auto"${font}>${lesc(o.text)}</span>`
    + (pv ? listSb('pv', v, 'play', 'شنیدن', 'Listen', 'opacity-70 hover:opacity-100') : '')
    + (o.dataset.pin !== undefined && !recent ? listSb('pin', v, pinned ? 'pin' : 'pin-off', pinned ? 'پیش‌فرض همین است' : 'پیش‌فرض کن', pinned ? 'This is the default' : 'Make default', pinned ? 'text-primary' : 'opacity-50 hover:opacity-100') : '')
    + (o.dataset.del !== undefined && !recent ? listSb('del', v, 'trash-2', 'حذف', 'Delete', 'opacity-60 hover:text-error') : '')
    + (recent ? listSb('unrecent', v, 'x', 'حذف از اخیراً', 'Remove from recent', 'opacity-60 hover:text-error') : '') + '</a>'; }
function listGrpA(gi, gr){ const has = gr.items.some(o => o.selected);
  return `<a class="avgrp flex items-center gap-2 ${has ? 'menu-active' : ''}" data-grp="${gi}" tabindex="-1" aria-haspopup="listbox" aria-expanded="false"><span class="min-w-0 flex-1 whitespace-normal break-words" dir="auto">${lesc(gr.g)}</span>`
    + `<span class="shrink-0 text-xs tabular-nums opacity-60">${gr.items.length}</span><svg class="avchev size-3.5 shrink-0 opacity-70"><use href="#i-chevron-left"/></svg></a>`; }
function listItems(sel, M, q){ const items = [], low = s => String(s || '').toLowerCase(), hit = o => !q || low(o.text).includes(q) || low(o.value).includes(q);
  let brk = false; const add = (html, attrs, cls) => { items.push(`<li ${attrs || ''} class="${(brk && items.length ? 'mt-1 border-t border-base-300 pt-1 ' : '') + (cls || '')}">${html}</li>`); brk = false; };
  if (!q && M.recent.length){ add(lesc(T('اخیراً', 'Recent')), '', 'menu-title'); M.recent.forEach(o => add(listRowA(sel, o, true), `data-v="${lesc(o.value)}"`)); brk = true; }
  M.groups.forEach((gr, gi) => { const vis = gr.items.filter(hit); if (!vis.length) return;
    if (!gr.g){ vis.forEach(o => add(listRowA(sel, o), `data-v="${lesc(o.value)}"`)); return; }
    if (M.nest && !q){ add(listGrpA(gi, gr), `data-g="${gi}"`); return; }   // a search lists its matches inline
    add(lesc(gr.g), '', 'menu-title'); vis.forEach(o => add(listRowA(sel, o), `data-v="${lesc(o.value)}"`)); });
  if (!items.length) add(`<span class="text-base-content/60">${T('چیزی پیدا نشد', 'Nothing found')}</span>`, '', 'pointer-events-none');
  return items.join(''); }
function listActs(M){ return M.acts.map(([icon, fa, en], k) => `<li><a class="flex items-center gap-2" data-act="${k}" tabindex="-1"><svg class="size-4 shrink-0"><use href="#i-${icon}"/></svg><span class="min-w-0 flex-1">${lesc(T(fa, en))}</span></a></li>`).join(''); }

// ---------------- open, place, close ----------------
var LIST = null, LIST_KBD = false;
function listOpen(sel, anchor){ if (!sel) return; anchor = anchor || sel._btn || sel; closeMenus(); closeDD();
  const M = listModel(sel), box = listBox('avList'), dh = anchor.closest('[dir]'), dir = dh ? dh.getAttribute('dir') : (lang === 'fa' ? 'rtl' : 'ltr');
  const host = anchor.closest('dialog[open]') || document.body; if (box.parentElement !== host) host.appendChild(box);   // a modal dialog makes everything outside it inert
  box.dir = dir; box.className = LIST_PANEL + ' flex flex-col';
  const search = M.opts.length > 12 ? `<div class="shrink-0 p-1 pb-1.5"><label class="input input-sm flex w-full items-center gap-2"><svg class="size-3.5 shrink-0 opacity-60"><use href="#i-search"/></svg><input class="avq min-w-0 flex-1" dir="auto" placeholder="${T('جست‌وجو…', 'Search…')}" spellcheck="false" autocomplete="off"></label></div>` : '';
  box.innerHTML = search + `<ul class="avul menu menu-sm min-h-0 w-full flex-1 flex-nowrap overflow-y-auto p-1" role="listbox">${listItems(sel, M, '')}</ul>`
    + (M.acts.length ? `<ul class="menu menu-sm mt-1 w-full shrink-0 flex-nowrap border-t border-base-300 p-1 pt-1.5">${listActs(M)}</ul>` : '');
  LIST = { sel, anchor, box, M, q: '', sub: null, dir }; anchor.setAttribute('aria-expanded', 'true'); anchor.classList.add('avopen');
  layerOn(box); listPlace();
  const ul = box.querySelector('.avul'), act = ul.querySelector('a.menu-active');   // the choice in view (and focused: the keys work at once)
  if (act) ul.scrollTop = Math.max(0, act.offsetTop - ul.clientHeight / 2 + act.offsetHeight / 2);
  const first = act || ul.querySelector('a[data-pick], a.avgrp'); if (first) try { first.focus({ preventScroll: true }); } catch (e) {} }
function listPlace(){ if (!LIST) return; const { box, anchor, dir } = LIST, r = anchor.getBoundingClientRect(), rtl = dir === 'rtl';
  box.style.maxHeight = 'none'; box.style.width = 'max-content'; box.style.maxWidth = Math.min(LIST_W, innerWidth - 2 * LIST_EDGE) + 'px';
  const nat = Math.ceil(box.getBoundingClientRect().width) + 2, w = Math.min(innerWidth - 2 * LIST_EDGE, Math.max(r.width, nat)); box.style.width = w + 'px'; box.style.maxWidth = '';   // +2: a label that just fits never wraps on a rounding
  const h = box.scrollHeight + 2, below = innerHeight - r.bottom - LIST_GAP - LIST_EDGE, above = r.top - LIST_GAP - LIST_EDGE;
  const want = Math.min(h, LIST_H), up = want > below && above > below, mh = Math.max(120, Math.min(want, up ? above : below)); box.style.maxHeight = mh + 'px';
  const left = Math.max(LIST_EDGE, Math.min(innerWidth - w - LIST_EDGE, rtl ? r.right - w : r.left)), top = up ? Math.max(LIST_EDGE, r.top - LIST_GAP - box.offsetHeight) : r.bottom + LIST_GAP;
  Object.assign(box.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
  const side = listSideOf(box.getBoundingClientRect(), 220); box.querySelectorAll('.avchev use').forEach(u => u.setAttribute('href', side === 'left' ? '#i-chevron-left' : '#i-chevron-right')); }
function listSideOf(br, ww){ const roomL = br.left - LIST_EDGE, roomR = innerWidth - br.right - LIST_EDGE;   // a group opens toward the room (Persian: left first)
  return (LIST && LIST.dir === 'rtl') ? (roomL >= ww || roomL >= roomR ? 'left' : 'right') : (roomR >= ww || roomR >= roomL ? 'right' : 'left'); }
function listSubOpen(gi, a, viaKey){ if (!LIST) return; const gr = LIST.M.groups[gi]; if (!gr) return;
  if (LIST.sub && LIST.sub.gi === gi){ if (viaKey){ const f = LIST.sub.box.querySelector('a.menu-active, a[data-pick]'); if (f) f.focus({ preventScroll: true }); } return; }
  listSubClose(); const sub = listBox('avSub'); if (sub.parentElement !== LIST.box.parentElement) LIST.box.parentElement.appendChild(sub); sub.dir = LIST.dir; sub.className = LIST_PANEL + ' flex flex-col';
  sub.innerHTML = `<ul class="avul menu menu-sm min-h-0 w-full flex-1 flex-nowrap overflow-y-auto p-1" role="listbox">${gr.items.map(o => `<li data-v="${lesc(o.value)}">${listRowA(LIST.sel, o)}</li>`).join('')}</ul>`;
  LIST.sub = { gi, box: sub, a, side: 'left' }; a.classList.add('avgopen'); a.setAttribute('aria-expanded', 'true');
  layerOn(sub); listSubPlace();
  const ul = sub.querySelector('.avul'), act = ul.querySelector('a.menu-active'); if (act) ul.scrollTop = Math.max(0, act.offsetTop - ul.clientHeight / 2 + act.offsetHeight / 2);
  if (viaKey){ const f = act || ul.querySelector('a[data-pick]'); if (f) f.focus({ preventScroll: true }); } }
function listSubPlace(){ const S2 = LIST && LIST.sub; if (!S2) return; const sub = S2.box, br = LIST.box.getBoundingClientRect(), ar = S2.a.getBoundingClientRect();
  sub.style.maxHeight = 'none'; sub.style.width = 'max-content'; sub.style.maxWidth = Math.min(LIST_W, innerWidth - 2 * LIST_EDGE) + 'px';
  const ww = Math.max(180, Math.min(LIST_W, Math.ceil(sub.getBoundingClientRect().width) + 2, innerWidth - 2 * LIST_EDGE)); sub.style.width = ww + 'px'; sub.style.maxWidth = '';
  const side = listSideOf(br, ww); let x = side === 'left' ? br.left - ww + 2 : br.right - 2; x = Math.max(LIST_EDGE, Math.min(innerWidth - ww - LIST_EDGE, x));
  const h = Math.min(sub.scrollHeight + 2, LIST_H, innerHeight - 2 * LIST_EDGE); sub.style.maxHeight = h + 'px';
  const y = Math.max(LIST_EDGE, Math.min(innerHeight - LIST_EDGE - h, ar.top - 7));
  Object.assign(sub.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto' }); S2.side = side;
  LIST.box.querySelectorAll('.avchev use').forEach(u => u.setAttribute('href', side === 'left' ? '#i-chevron-left' : '#i-chevron-right')); }
function listSubClose(){ if (!LIST || !LIST.sub) return; const S2 = LIST.sub; LIST.sub = null; layerOff(S2.box); S2.a.classList.remove('avgopen'); S2.a.setAttribute('aria-expanded', 'false'); }
function listClose(refocus){ clearTimeout(SUB_T); clearTimeout(SUB_X); SUB_X = 0; if (!LIST) return; const L = LIST; LIST = null;
  if (L.sub){ layerOff(L.sub.box); } layerOff(L.box); L.anchor.setAttribute('aria-expanded', 'false'); L.anchor.classList.remove('avopen');
  if (refocus) try { L.anchor.focus({ preventScroll: true }); } catch (e) {} }
function listToggle(sel, anchor){ if (LIST && LIST.sel === sel && LIST.anchor === anchor){ listClose(true); return; } openDD(sel, anchor); }
function openDD(sel, b){ if (sel && sel.tagName === 'SELECT') listOpen(sel, b); }   // speakers.js wraps it: opening a voice list clears its yellow dot
function filterDD(q){ if (!LIST) return; LIST.q = String(q || '').trim().toLowerCase(); listSubClose(); LIST.box.querySelector('.avul').innerHTML = listItems(LIST.sel, LIST.M, LIST.q); }
function listPick(sel, v, kbd){ listClose(!!kbd); if (sel.value !== v){ sel.value = v; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); } listLabel(sel); }

// ---------------- clicks, hover, keys ----------------
document.addEventListener('click', ev => { if (!LIST) return; const t = ev.target; if (!t.closest || !t.closest('#avList, #avSub')) return; ev.preventDefault(); ev.stopPropagation();
  const sel = LIST.sel, pv = t.closest('[data-pv]'); if (pv){ if (sel._preview) sel._preview(pv.dataset.pv); return; }
  const pin = t.closest('[data-pin]'); if (pin){ const f = sel._onPin; listClose(false); if (f) f(pin.dataset.pin); return; }
  const del = t.closest('[data-del]'); if (del){ const f = sel._onDel; listClose(false); if (f) f(del.dataset.del); return; }
  const ur = t.closest('[data-unrecent]'); if (ur){ const k = sel.dataset.recent, a = LIST.anchor; RECENT[k] = (RECENT[k] || []).filter(x => x !== ur.dataset.unrecent); try { API().settings_set({ ed_recent: RECENT }); } catch (e) {} listClose(false); listOpen(sel, a); return; }
  const g = t.closest('a.avgrp'); if (g){ const gi = +g.dataset.grp; if (LIST.sub && LIST.sub.gi === gi) listSubClose(); else listSubOpen(gi, g, false); return; }
  const act = t.closest('[data-act]'); if (act){ const f = selActs(sel)[+act.dataset.act]; listClose(false); if (f) setTimeout(() => f[3](), 0); return; }
  const p = t.closest('a[data-pick]'); if (p) listPick(sel, p.dataset.pick, ev.detail === 0); }, true);   // the keys give the field its focus back; a mouse pick leaves no ring on it
document.addEventListener('pointerdown', ev => { if (!LIST) return; const t = ev.target; if (t.closest && (t.closest('#avList, #avSub') || LIST.anchor.contains(t))) return; listClose(false); }, true);
document.addEventListener('scroll', ev => { if (!LIST) return; const t = ev.target; if (t === document || (t && t.contains && t.contains(LIST.anchor))) listClose(false); }, true);   // only a scroll that moves its field (the timeline following the playhead does not)
document.addEventListener('input', ev => { const t = ev.target; if (!LIST || !t.classList || !t.classList.contains('avq')) return; ev.stopPropagation(); filterDD(t.value); }, true);
// a group opens after a short rest on it (NN/g: 0.3–0.5 s; a click opens it at once); while the pointer heads for the open
// group (inside the triangle from where it was to the group's near corners) nothing else opens and the group stays
var SUB_T = 0, SUB_X = 0, SUB_PT = null;
function listHeading(a, b){ const S2 = LIST && LIST.sub; if (!S2) return false; const r = S2.box.getBoundingClientRect(), x = S2.side === 'left' ? r.right : r.left, p2 = { x, y: r.top - 8 }, p3 = { x, y: r.bottom + 8 };
  const s = (q1, q2, q3) => (q1.x - q3.x) * (q2.y - q3.y) - (q2.x - q3.x) * (q1.y - q3.y), d1 = s(b, a, p2), d2 = s(b, p2, p3), d3 = s(b, p3, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)); }
document.addEventListener('pointermove', ev => { if (!LIST) return; const t = ev.target, inSub = t.closest && t.closest('#avSub'), inMain = t.closest && t.closest('#avList'), p = { x: ev.clientX, y: ev.clientY }, last = SUB_PT; SUB_PT = p;
  if (inSub){ clearTimeout(SUB_T); clearTimeout(SUB_X); SUB_X = 0; return; }
  if (!inMain){ if (LIST.sub && !SUB_X) SUB_X = setTimeout(() => { SUB_X = 0; listSubClose(); }, 500); return; }
  if (LIST.sub && last && listHeading(last, p)){ clearTimeout(SUB_T); clearTimeout(SUB_X);   // on its way to the open group
    SUB_X = setTimeout(() => { SUB_X = 0; if (!LIST) return; const h = document.elementFromPoint(SUB_PT.x, SUB_PT.y), hg = h && h.closest && h.closest('#avList a.avgrp'); if (h && h.closest && h.closest('#avSub')) return; if (hg) listSubOpen(+hg.dataset.grp, hg, false); else listSubClose(); }, 450); return; }
  clearTimeout(SUB_X); SUB_X = 0; const g = t.closest('a.avgrp'); clearTimeout(SUB_T);
  if (g){ const gi = +g.dataset.grp; if (LIST.sub && LIST.sub.gi === gi) return; SUB_T = setTimeout(() => { if (LIST && g.isConnected) listSubOpen(gi, g, false); }, 220); }
  else if (LIST.sub) SUB_T = setTimeout(() => listSubClose(), 320); }, true);
var LIST_TA = { s: '', t: 0 };
function listKeys(ev){ if (!LIST) return; const k = ev.key, ae = document.activeElement, inSub = !!(LIST.sub && LIST.sub.box.contains(ae)), box = inSub ? LIST.sub.box : LIST.box, rtl = LIST.dir === 'rtl';
  const q = !!(ae && ae.classList && ae.classList.contains('avq')), rows = [...box.querySelectorAll('a[data-pick], a.avgrp, a[data-act]')].filter(a => a.getClientRects().length), i = rows.indexOf(ae);
  const go = n => { const a = rows[Math.max(0, Math.min(rows.length - 1, n))]; if (a){ a.focus({ preventScroll: true }); a.scrollIntoView({ block: 'nearest' }); } };
  const into = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft';
  if (k === 'Escape'){ ev.preventDefault(); ev.stopImmediatePropagation(); if (inSub){ const a = LIST.sub.a; listSubClose(); a.focus({ preventScroll: true }); } else listClose(true); return; }
  if (k === 'Tab'){ listClose(false); return; }
  if (k === 'ArrowDown'){ ev.preventDefault(); go(i < 0 ? 0 : i + 1); return; }
  if (k === 'ArrowUp'){ ev.preventDefault(); go(i < 0 ? rows.length - 1 : i - 1); return; }
  if (!q && k === 'Home'){ ev.preventDefault(); go(0); return; } if (!q && k === 'End'){ ev.preventDefault(); go(rows.length - 1); return; }
  if (k === 'PageDown'){ ev.preventDefault(); go((i < 0 ? 0 : i) + 10); return; } if (k === 'PageUp'){ ev.preventDefault(); go((i < 0 ? 0 : i) - 10); return; }
  if (!q && k === into){ const a = rows[i]; if (a && a.classList.contains('avgrp')){ ev.preventDefault(); listSubOpen(+a.dataset.grp, a, true); } return; }
  if (!q && k === back && inSub){ ev.preventDefault(); const a = LIST.sub.a; listSubClose(); a.focus({ preventScroll: true }); return; }
  if (k === 'Enter' || (k === ' ' && !q)){ const a = q ? rows.find(x => x.dataset.pick !== undefined) : rows[i]; if (a){ ev.preventDefault(); if (a.classList.contains('avgrp')) listSubOpen(+a.dataset.grp, a, true); else a.click(); } return; }
  if (!q && k.length === 1 && !ev.metaKey && !ev.ctrlKey && !ev.altKey){ const qi = LIST.box.querySelector('.avq'); if (qi && !inSub){ qi.focus({ preventScroll: true }); return; }   // a long list: typing searches
    const now = performance.now(); LIST_TA.s = (now - LIST_TA.t < 700 ? LIST_TA.s : '') + k.toLowerCase(); LIST_TA.t = now;   // a short one: typing jumps to a match
    const lab = a => (a.textContent || '').trim().toLowerCase(), from = i + (LIST_TA.s.length === 1 ? 1 : 0), order = [...rows.slice(Math.max(0, from)), ...rows.slice(0, Math.max(0, from))], m = order.find(a => lab(a).startsWith(LIST_TA.s));
    if (m){ ev.preventDefault(); m.focus({ preventScroll: true }); m.scrollIntoView({ block: 'nearest' }); } } }
addEventListener('resize', () => { listClose(false); closeDD(); closeMenus(); });
// THE KEYBOARD GOES TO WHAT IS OPEN FIRST — editor.js installs this before every other key handler (window, capture): an
// open list owns the keys (the canvas's arrows, the playhead and play/pause wait), a list's field opens it with ↓ ↑ Enter
// Space, and Esc closes the open menu, list or preset panel and only that (the line or the object stays selected)
function keyIsTyping(t){ return !!(t && t.closest && t.closest('input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, [contenteditable="true"], .lt')); }
function keyGuard(ev){
  if (LIST){ if (ev.metaKey || ev.ctrlKey){ listClose(false); return; } listKeys(ev); ev.stopImmediatePropagation(); return; }
  const t = ev.target; if (t && t.classList && t.classList.contains('avtrig') && t._sel){ trigKey(ev, t._sel, t); if (ev.defaultPrevented) ev.stopImmediatePropagation(); return; }
  if (ev.key !== 'Escape') return;
  const m = document.getElementById('ddMenu'); if (document.querySelector('details.dropdown[open]') || (m && m._open)){ ev.preventDefault(); ev.stopImmediatePropagation(); closeMenus(); closeDD(); return; }
  if (document.querySelector('dialog[open]') || (typeof VEDIT !== 'undefined' && VEDIT) || keyIsTyping(t)) return;
  if ((typeof TRADJ !== 'undefined' && TRADJ && trAdjClose()) || (typeof ANADJ !== 'undefined' && ANADJ && animAdjClose())){ ev.preventDefault(); ev.stopImmediatePropagation(); } }

// ---------------- the field ----------------
function listLabel(sel){ const b = sel && sel._btn; if (!b) return; const o = sel.options[sel.selectedIndex];
  const txt = o ? (sel.dataset.compact !== undefined ? o.text.split(' — ')[0] : o.text) : '', f = o && o.dataset.font ? ` style="font-family:'${lesc(o.dataset.font)}', Vazirmatn"` : '';
  const html = `<span class="min-w-0 flex-1 truncate text-start" dir="auto"${f}>${lesc(txt)}</span>`; if (b.innerHTML !== html) b.innerHTML = html;
  b.title = o && sel.dataset.compact !== undefined ? o.text : ''; b.disabled = !!sel.disabled;
  if (sel._sdPv) sel._sdPv.disabled = !!sel.disabled || (!sel.value && !sel._pvAny); }   /* a line's «as the speaker» entry still has a voice to hear */
// a value set by code (sel.value = …, selectedIndex, option.selected) shows on the field at once — no event tells us
(() => { const wrap = (P, k, after) => { const d = Object.getOwnPropertyDescriptor(P, k); if (!d || !d.set) return;
    Object.defineProperty(P, k, { configurable: true, enumerable: d.enumerable, get(){ return d.get.call(this); }, set(v){ d.set.call(this, v); try { after(this); } catch (e) {} } }); };
  wrap(HTMLSelectElement.prototype, 'value', s => { if (s._btn) listLabel(s); }); wrap(HTMLSelectElement.prototype, 'selectedIndex', s => { if (s._btn) listLabel(s); });
  wrap(HTMLOptionElement.prototype, 'selected', o => { const s = o.closest && o.closest('select'); if (s && s._btn) listLabel(s); }); })();
function trigKey(ev, sel, b){ if (!sel || (LIST && LIST.sel === sel)) return; const k = ev.key;
  if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' '){ ev.preventDefault(); ev.stopPropagation(); openDD(sel, b); } }
function enh(sel){
  if (!sel || sel.tagName !== 'SELECT' || sel.dataset.native !== undefined) return;
  if (!sel._btn || !sel._btn.isConnected){ if (sel._btn) try { sel._btn.remove(); } catch (e) {}
    const b = document.createElement('button'); b.type = 'button'; const cls = sel.className.replace(/\bhidden\b/g, ' ').replace(/\s+/g, ' ').trim();
    b.className = (/\bselect\b/.test(cls) ? cls : 'select select-sm w-full ' + cls) + ' avtrig gap-1 text-start';
    b.setAttribute('role', 'combobox'); b.setAttribute('aria-haspopup', 'listbox'); b.setAttribute('aria-expanded', 'false');
    ['aria-label', 'data-aria-en', 'data-tip', 'data-tip-en'].forEach(k => { const v = sel.getAttribute(k); if (v) b.setAttribute(k, v); }); if (sel.style.cssText) b.style.cssText = sel.style.cssText;
    sel.after(b); sel.classList.add('hidden'); sel._btn = b; b._sel = sel;
    const j = sel.parentElement; if (j && j.classList.contains('join')) j.after(sel);   // a join rounds its first and last children: the hidden list stays out of it
    b.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); listToggle(sel, b); });
    if (!sel._n177){ sel._n177 = true;
      sel.addEventListener('change', () => { if (sel.dataset.recent) noteRecent(sel.dataset.recent, sel.value); listLabel(sel); });
      new MutationObserver(() => listLabel(sel)).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'label'] }); } }
  selSide(sel); listLabel(sel); }
function refreshEnh(sel){ if (!sel || !sel._btn) return; selSide(sel); listLabel(sel); }
// ▶ beside the field hears the chosen voice (the list's rows have their own ▶, pin and trash)
function selSide(sel){ const b = sel._btn; if (!b || sel.dataset.preview === undefined) return;
  if (!sel._j177 || !sel._j177.isConnected){ let j = b.parentElement; if (!j || !j.classList.contains('join')){ j = document.createElement('div'); j.className = 'join w-full'; b.replaceWith(j); j.appendChild(b); }
    b.classList.add('join-item', 'min-w-0', 'flex-1'); b.classList.remove('w-full'); if (sel.parentElement === j) j.after(sel); sel._j177 = j;
    j.addEventListener('click', ev => { const x = ev.target.closest('.sd177'); if (!x || x.parentElement !== j) return; ev.preventDefault(); ev.stopPropagation(); if (sel._preview) sel._preview(sel.value); }); }
  if (!sel._sdPv){ const x = document.createElement('button'); x.type = 'button'; x.className = `sd177 btn ${/\bselect-xs\b/.test(b.className) ? 'btn-xs' : 'btn-sm'} join-item btn-square border-base-content/15 bg-base-100`;
    x.dataset.sd = 'pv'; x.dataset.tip = 'شنیدنِ صدا'; x.dataset.tipEn = 'Hear the voice'; x.setAttribute('aria-label', 'Hear the voice'); x.innerHTML = '<svg class="size-3.5"><use href="#i-play"/></svg>'; sel._sdPv = x; }
  if (b.nextElementSibling !== sel._sdPv) b.after(sel._sdPv); }
function selDecorate(){}   // 177's «Recent» and «More…» entries inside the system list: the list draws them itself now
// every list on the page becomes the app's list, wherever and whenever it appears (panels, dialogs, rows drawn later)
new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes){ if (n.nodeType !== 1) continue; if (n.tagName === 'SELECT') enh(n); else if (n.querySelectorAll) n.querySelectorAll('select').forEach(s => enh(s)); } }).observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('select').forEach(s => enh(s));

// ---------------- action menus: daisyUI dropdown (details), the same panel on the top layer ----------------
function ddPlace(d){ const c = d.querySelector(':scope > .dropdown-content'), s = d.querySelector(':scope > summary'); if (!c || !s || !d.open) return;
  c.classList.add('flex-nowrap', 'text-base-content'); c.classList.remove('flex-wrap');   // daisyUI's menu wraps into a second column when its height is limited: one column, always
  layerOn(c); c.style.maxHeight = 'none'; c.style.overflowY = 'auto';
  const r = s.getBoundingClientRect(), w = c.offsetWidth, h = c.scrollHeight + 2, below = innerHeight - r.bottom - LIST_GAP - LIST_EDGE, above = r.top - LIST_GAP - LIST_EDGE;
  const want = Math.min(h, LIST_H), up = want > below && above > below; c.style.maxHeight = Math.max(120, Math.min(want, up ? above : below)) + 'px';
  const rtl = getComputedStyle(d).direction === 'rtl', end = d.classList.contains('dropdown-end'), left = Math.max(LIST_EDGE, Math.min(innerWidth - w - LIST_EDGE, rtl !== end ? r.right - w : r.left));
  Object.assign(c.style, { left: left + 'px', top: (up ? Math.max(LIST_EDGE, r.top - LIST_GAP - c.offsetHeight) : r.bottom + LIST_GAP) + 'px', right: 'auto', bottom: 'auto' }); }
function closeMenus(except){ document.querySelectorAll('details.dropdown[open]').forEach(d => { if (d !== except) d.open = false; }); }
document.addEventListener('toggle', ev => { const d = ev.target; if (!d.matches || !d.matches('details.dropdown') || d.open) return; const c = d.querySelector(':scope > .dropdown-content'); if (c) layerOff(c); }, true);
document.addEventListener('click', ev => { const t = ev.target; if (!t.closest) return;
  const s = t.closest('details.dropdown > summary');
  if (s){ const d = s.parentElement, opening = !d.open; closeMenus(d); closeDD(); if (opening) requestAnimationFrame(() => ddPlace(d)); return; }
  const a = t.closest('details.dropdown[open] .dropdown-content a, details.dropdown[open] .dropdown-content button'); if (a){ const d = a.closest('details.dropdown'); setTimeout(() => { d.open = false; }, 0); } }, true);
document.addEventListener('pointerdown', ev => { document.querySelectorAll('details.dropdown[open]').forEach(d => { if (!d.contains(ev.target)) d.open = false; }); }, true);

// ---------------- the same menu beside a chip in the text (speaker, tone, sound tag) ----------------
function ddHome(){ let m = document.getElementById('ddMenu'); if (!m){ m = document.createElement('ul'); m.id = 'ddMenu'; document.body.appendChild(m); }
  m.className = 'menu menu-sm fixed z-[1100] flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-200 p-1.5 text-base-content shadow-lg' + (m._open ? '' : ' hidden'); return m; }
function menuPlace(m, b){ const r = b.getBoundingClientRect(); m.style.width = 'max-content'; m.style.maxWidth = Math.min(340, innerWidth - 16) + 'px'; m.style.maxHeight = 'none'; m.style.bottom = '';
  const w = Math.min(m.offsetWidth, innerWidth - 16), h = m.scrollHeight + 2, below = innerHeight - r.bottom - LIST_GAP - LIST_EDGE, above = r.top - LIST_GAP - LIST_EDGE, want = Math.min(h, LIST_H), up = want > below && above > below, mh = Math.max(140, Math.min(want, up ? above : below));
  m.style.maxHeight = mh + 'px'; const rtl = m.dir === 'rtl'; m.style.left = Math.max(LIST_EDGE, Math.min(innerWidth - w - LIST_EDGE, rtl ? r.right - w : r.left)) + 'px';
  m.style.top = (up ? Math.max(LIST_EDGE, r.top - LIST_GAP - Math.min(h, mh)) : r.bottom + LIST_GAP) + 'px'; m.style.right = 'auto'; }
function placeMenu(m, b){ menuPlace(m, b); }
function lineMenu(b, html, onPick){ const m = ddHome(); if (m._open && m._anchor === b){ closeDD(); return; }
  closeMenus(); listClose(false); if (m.parentElement !== document.body) document.body.appendChild(m); m.dir = lang === 'fa' ? 'rtl' : 'ltr'; m.innerHTML = html; m._open = true; m._anchor = b; m._sel = { _btn: b };   // a click on the chip again closes it
  layerOn(m); menuPlace(m, b); m.onclick = e => onPick(e); }
// a menu where the pointer is (a right-click): the chip menu's panel, anchored to a point
function pointMenu(x, y, html, onPick){ let a = document.getElementById('ptAnchor'); if (!a){ a = document.createElement('span'); a.id = 'ptAnchor'; a.className = 'pointer-events-none fixed size-px'; document.body.appendChild(a); }
  a.style.left = x + 'px'; a.style.top = y + 'px'; const m = ddHome(); if (m._open && m._anchor === a) closeDD(); lineMenu(a, html, onPick); }
function closeDD(){ listClose(false); const m = document.getElementById('ddMenu'); if (!m) return; m._open = false; m._anchor = null; m._sel = null; layerOff(m); if (m.parentElement !== document.body) document.body.appendChild(m); }
document.addEventListener('pointerdown', ev => { const m = document.getElementById('ddMenu'); if (!m || !m._open) return; if (m.contains(ev.target) || (m._anchor && m._anchor.contains(ev.target))) return; closeDD(); }, true);

// 179 · EVERY RESET ICON IS ALWAYS THERE (the founder): grey while the value is its default, orange once it is not (a grey
//       one changes nothing); 176–178 hid them at the default, so some icons popped up out of nowhere
function rstMark(b, on){ if (!b) return; b.classList.remove('invisible'); b.classList.toggle('text-primary', !!on); b.classList.toggle('opacity-50', !on); b.classList.toggle('hover:opacity-100', !on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
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
  el.querySelectorAll('.cfsw').forEach(s => ['ring-2', 'ring-primary'].forEach(k => s.classList.toggle(k, cdist(s.dataset.c, c) < 6))); if (rs && f) rstMark(rs, cdist(c, hex6(f.def) || c) >= 1);
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

// 179: undo / redo put the open audio panel back too (the project's voice list kept showing the undone pick; the video
//      inspector was already refilled by restoreSnap)
function refreshOpenPanels(){ if (mode === 'video') return; const vis = id => { const e = $(id); return !!(e && !e.classList.contains('hidden')); };
  try { if (vis('insp-clip') && selClip){ const fc = typeof findClip === 'function' ? findClip(selClip) : null, c = fc && fc[1]; if (c) showClipPanel(c); }
    else if (vis('insp-music')) showMusicInspector(); else if (vis('insp-line') && sel.size === 1) fillLineInspector([...sel][0]); else fillInspector(); } catch (e) { console.warn('refresh panels', e); } }
['undo', 'redo'].forEach(n => { const f = window[n]; if (typeof f !== 'function') return; window[n] = function(){ const r = f.apply(this, arguments); try { refreshOpenPanels(); } catch (e) {} return r; }; });

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
  // 179: a right-click opens a menu (the founder: it should hold Reset — it reset at once); also the largest and the
  //      shortest timeline, the word «تایملاین» in Persian as he asked
  hd.addEventListener('contextmenu', ev => { ev.preventDefault(); ev.stopPropagation(); const f = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, SPLIT || 1)), on = v => Math.abs(f - v) < 0.005 ? 'menu-active' : '';
    pointMenu(ev.clientX, ev.clientY, `<ul class="menu menu-sm w-full p-1"><li><a data-split="1" class="gap-2 ${on(1)}"><svg class="size-4"><use href="#i-rotate-ccw"/></svg>${T('بازنشانی اندازه‌ها', 'Reset sizes')}</a></li>`
      + `<li><a data-split="${SPLIT_MAX}" class="gap-2 ${on(SPLIT_MAX)}"><svg class="size-4"><use href="#i-chevrons-up"/></svg>${T('بزرگ‌ترین تایملاین', 'Largest timeline')}</a></li>`
      + `<li><a data-split="${SPLIT_MIN}" class="gap-2 ${on(SPLIT_MIN)}"><svg class="size-4"><use href="#i-chevrons-down"/></svg>${T('کوتاه‌ترین تایملاین', 'Shortest timeline')}</a></li></ul>`,
      e => { const a = e.target.closest('[data-split]'); if (!a) return; closeDD(); SPLIT = +a.dataset.split; splitApply(); splitSave(); }); });
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
    rstMark(b, off);
    b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); if (custom){ def.reset(); xrSoon(); return; }
      HMARK.el = null; if (radios){ const t = els.find(r => String(xrVal(r)) === String(def).replace(/\s+/g, '')); if (t){ t.checked = true; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (el.type === 'checkbox'){ el.checked = !!def; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      else { el.value = String(def); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
      xrSoon(); }; } }
['input', 'change'].forEach(t => document.addEventListener(t, ev => { if (ev.target && ev.target.closest && ev.target.closest('aside')) xrSoon(); }));
['showVPanels', 'renderPodUI', 'fillSub', 'fillText', 'fillPip', 'fillSticker', 'fillEmoji', 'fillInspector', 'fillExtras', 'fillLineInspector', 'fillProj', 'relang'].forEach(n => { try { const f = window[n]; if (typeof f !== 'function') return;
  window[n] = function(){ const r = f.apply(this, arguments); try { xrSoon(); } catch (e) {} return r; }; } catch (e) {} });
setTimeout(xrSync, 300);   // and once the page is up
