// =====================================================================================
// 161 · THE VIDEO TAB — built on the mock (ava-editor-10): its stage, design system, orb shader
//       and panels, with a real document underneath. ONE renderer draws every frame, so the
//       preview and the exported MP4 are the same pixels. Positions are kept relative to the
//       frame (0–1) and shown in output pixels.
// =====================================================================================
var mode = 'audio', vSel = null, VVER = 0;   // var: read by the editor's handlers before this file runs
const RES = { '1080p': 1080, '2k': 1440, '4k': 2160 };
const RATIOS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };
function outSize(res, ratio){ const [a, b] = RATIOS[ratio || V.ratio] || [16, 9], s = RES[res || V.res] || 1440; const short = s, long = Math.round(short * Math.max(a, b) / Math.min(a, b) / 2) * 2; return a >= b ? [long, short] : [short, long]; }
const POD0 = () => ({ style: 1, layout: 'auto', wave: 'circle', pal: 'shf', bg: 'mesh', fit: 0, pos: [0, 0], zoom: 1, drift: 1, warp: 0.35, grain: 0.06, solid: '#0c1230', custom: ['#1c2a74', '#2b3fb0', '#0c1230'], v177: true, v179: true,   // 177: no orbs; a colour of its own; a custom gradient
  sens: 0.6, ovColor: '#000000', ovOp: 0.15, grad: true, gradDir: 'to top', gradA: '#05070f', gradB: '#1c2a74', gradOp: 0.7, bgAsset: null, bgKind: null, names: true });
const SUBS0 = () => ({ on: true, size: 0.042, color: '#ffffff', bg: '#000000', bgOp: 0.55, pos: 0.9, weight: 700, follow: true, cues: [], off: { x: 0, y: 0 }, fixes: {} });   // 176: always following; corrections by line; one place for all
const TEXT0 = () => ({ type: 'text', text: T('عنوانِ قسمت', 'Episode title'), x: 0.1, y: 0.07, w: 0.8, h: 0.12, rot: 0, size: 0.06, weight: 900, color: '#ffffff', align: 'center',
  bg: { on: false, shape: 'capsule', color: '#f2b233', pad: 0.012 }, autoW: true, start: 0, end: null, opacity: 1 });   // 176: no background; the box hugs the words
const MEDIA0 = (type, asset, aw, ah) => { const r = aw && ah ? aw / ah : 16 / 9, w = 0.28, h = w * outSize()[0] / outSize()[1] / r;
  return { type, asset, x: 0.68, y: 0.06, w, h: Math.min(0.5, h), rot: 0, fit: 'cover', radius: 0.02, opacity: 1, mute: true, volume: 1, loop: true, trimIn: 0, anim: { v: 2 },
    stroke: { on: false, color: '#ffffff', style: 'solid', width: 0.004, opacity: 1 }, shadow: { on: false, color: '#000000', opacity: 0.45, angle: 90, distance: 0.008, blur: 0.02, spread: 0 }, start: 0, end: null }; };   // 176: no drop shadow by default
const STICKER0 = () => { const [W, H] = outSize(); return { type: 'sticker', emoji: '👑', x: 0.84, y: 0.08, w: 0.09, h: 0.09 * W / H, rot: 6, bg: { on: false, shape: 'circle', color: '#e6a483' }, start: 0, end: null, opacity: 1, anim: { v: 2, loop: 'breathe', loopSpeed: 1 } }; };   // 169: no background by default
const V0 = () => ({ ratio: '16:9', res: '2k', fps: 30, bg: '#000000', cv179: true, pod: POD0(), subs: SUBS0(),
  objects: [] });   // 178: a new project's video is empty — no podcast, no title until you add them · 179: a black canvas
let V = V0();
const objById = id => V.objects.find(o => o.id === id);
const projEnd = () => Math.max(speechEnd(), ...V.objects.map(o => o.end || 0), 1);
const visibleAt = (o, t) => t >= (o.start || 0) && t < (o.end == null ? Infinity : o.end);

// ---- speakers: the «Name:» prefixes the audio side already uses (characters, two speakers, Fish speakers),
//      else one per voice track, else one
const SPK_RE = /^\s*(?:\{[^}]*\}\s*)?([^:：\n{}<>|]{1,24})[:：]/;
function lineSpeaker(id, track){ const sp = speakerOfLine(id); if (sp && sp.name) return sp.name;
  return track && S.tracks.filter(t => t.kind === 'speech').length > 1 ? T(track.name, track.en) : T('گوینده', 'Speaker'); }
function speakers(){
  const seen = [];
  scriptOrder().forEach(c => { const tr = S.tracks.find(t => t.clips.includes(c)); c.lines.forEach(id => { if (!cleanCue((S.lines[id] || {}).text)) return; const s = lineSpeaker(id, tr); if (!seen.includes(s)) seen.push(s); }); });
  const order = spkList().map(s => s.name); seen.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)); return seen.length ? seen.slice(0, 8) : [T('گوینده', 'Speaker')];
}
// ---- audio levels per speaker, as a function of TIME only (preview and export agree frame for frame)
const ENV = new Map();
function envOf(g){ const a = AUD.get(g); if (!a || !a.buf) return null; if (ENV.has(g)) return ENV.get(g);
  const ch = a.buf.getChannelData(0), hop = Math.round(a.buf.sampleRate / 100), n = Math.ceil(ch.length / hop), e = new Float32Array(n);
  for (let i = 0; i < n; i++){ let s = 0; const a0 = i * hop, a1 = Math.min(ch.length, a0 + hop); for (let k = a0; k < a1; k++) s += ch[k] * ch[k]; e[i] = Math.sqrt(s / Math.max(1, a1 - a0)); }
  ENV.set(g, e); return e; }
function levelAt(spk, t){
  let v = 0;
  S.tracks.forEach(tr => { if (tr.kind !== 'speech' || tr.muted) return; tr.clips.forEach(c => {
    if (c.unvoiced || c.gulp == null || t < c.at || t >= c.at + dur(c)) return; if (!c.lines.some(id => lineSpeaker(id, tr) === spk)) return;
    const e = envOf(c.gulp); if (!e) return; const p = c.in + (t - c.at); let m = 0; for (let q = Math.max(0, Math.floor((p - 0.06) * 100)); q <= Math.floor(p * 100) && q < e.length; q++) m = Math.max(m, e[q]);
    v = Math.max(v, m * (tr.volume ?? 1)); }); });
  return Math.min(1, v * (1.5 + 6 * V.pod.sens));
}
const ONSETS = new Map();
function onsets(spk){ const key = spk + '|' + VVER; if (ONSETS.has(key)) return ONSETS.get(key);
  const out = [], end = projEnd(); let prev = 0, last = -9; for (let t = 0; t < end; t += 0.02){ const l = levelAt(spk, t); if (l > 0.55 && prev <= 0.55 && t - last > 0.25){ out.push(t); last = t; } prev = l; }
  ONSETS.set(key, out); return out; }
function pulsesAt(spk, t){ const o = onsets(spk).filter(x => x <= t).slice(-3).map(x => t - x); while (o.length < 3) o.unshift(9); return o; }
// ---- media for the video tab: assets live in the engine's store; the page keeps blob URLs
const MEDIA = new Map();
async function assetUrl(id){ const c = MEDIA.get(id); if (c && c.url) return c.url;
  const info = (await API().asset_info(id)).asset; if (!info) return null; const parts = [];
  for (let off = 0; off < info.size; off += 4 << 20){ const r = await API().asset_read(id, off, 4 << 20); if (!r.ok) return null; parts.push(b64Blob(r.b64, info.mime)); }
  const url = URL.createObjectURL(new Blob(parts, { type: info.mime })); MEDIA.set(id, { url, mime: info.mime, name: info.name }); return url; }
async function mediaEl(id){
  const c = MEDIA.get(id); if (c && c.el) return c.el; const url = await assetUrl(id); if (!url) return null; const m = MEDIA.get(id);
  if (m.mime.startsWith('video')){ const v = document.createElement('video'); v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
    await new Promise(r => { v.onloadeddata = r; v.onerror = r; setTimeout(r, 4000); }); m.el = v; }
  else { const im = new Image(); im.src = url; await new Promise(r => { im.onload = r; im.onerror = r; }); m.el = im; }
  return m.el; }
async function addAsset(file){
  const b = await API().asset_begin(file.name, file.type || 'application/octet-stream'), id = b.id, buf = new Uint8Array(await file.arrayBuffer());
  for (let off = 0; off < buf.length; off += 2 << 20){ let s = ''; const ch = buf.subarray(off, off + (2 << 20)); for (let i = 0; i < ch.length; i += 0x8000) s += String.fromCharCode.apply(null, ch.subarray(i, i + 0x8000));
    const r = await API().asset_chunk(id, btoa(s)); if (!r.ok) throw new Error(r.error || ''); }
  await API().asset_end(id); MEDIA.set(id, { url: URL.createObjectURL(file), mime: file.type, name: file.name }); return id; }

// ---- the GL layer: the podcast background (177: no orbs)
const hex3 = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16) / 255);
const GLR = (() => {
  const cv = document.createElement('canvas'), gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: true }); if (!gl) return null;   // 170: antialiased orbs
  const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh)); return sh; };
  const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)){ console.error(gl.getProgramInfoLog(pr)); return null; }
  gl.useProgram(pr); const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const ap = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(pr, n), tx = gl.createTexture(); let texOf = null, texW = 2, texH = 2;
  gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(16));
  [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.LINEAR)); [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
  return { cv, draw(W, H, t, orbs, bgEl){
    if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; } gl.viewport(0, 0, W, H); const P = V.pod, pal = podPal(P);
    if (bgEl && (bgEl !== texOf || bgEl.tagName === 'VIDEO')){ try { gl.bindTexture(gl.TEXTURE_2D, tx); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgEl); texOf = bgEl; texW = bgEl.videoWidth || bgEl.naturalWidth || 2; texH = bgEl.videoHeight || bgEl.naturalHeight || 2; } catch (e) {} }
    gl.uniform3fv(U('uC'), pal.flatMap(hex3)); gl.uniform2f(U('uRes'), W, H); gl.uniform1f(U('uTime'), t); gl.uniform1f(U('uDrift'), P.bg === 'video' ? P.drift * 3 : P.drift);
    gl.uniform1f(U('uSharp'), 6.0); gl.uniform1f(U('uWarp'), P.warp); gl.uniform1i(U('uBg'), P.bg === 'mesh' ? 0 : P.bg === 'solid' ? 2 : (bgEl ? 1 : 0)); gl.uniform1i(U('uImg'), 0);
    gl.uniform2f(U('uIS'), texW, texH); gl.uniform1f(U('uZoom'), P.zoom); gl.uniform2f(U('uPos'), P.pos[0], -P.pos[1]); gl.uniform1i(U('uFit'), P.fit); gl.uniform3fv(U('uSolid'), hex3(P.bg === 'solid' ? (P.solid || V.bg || pal[2]) : pal[2]));
    gl.uniform1f(U('uGrain'), P.grain);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  } };
})();
// ---- where each speaker sits inside the podcast area
function podLayout(o, W, H, t){
  const spk = speakers(), lay = V.pod.layout === 'auto' ? (spk.length > 1 ? 'multi' : 'single') : V.pod.layout, n = lay === 'single' ? 1 : spk.length;
  const list = (lay === 'single' ? [spk.find(s => levelAt(s, t) > 0.02) || spk[0]] : spk).slice(0, 8), rowsN = list.length > 4 ? 2 : 1, cols = Math.ceil(list.length / rowsN);
  return list.map((s, k) => { const row = Math.floor(k / cols), col = k % cols, inRow = row === rowsN - 1 ? list.length - row * cols : cols;
    return { spk: s, cx: o.x + o.w * (col + 0.5) / inRow, cy: o.y + o.h * (rowsN === 1 ? 0.44 : row === 0 ? 0.28 : 0.7), r: Math.min(o.w * W / cols, o.h * H / rowsN) * 0.34 / H, level: levelAt(s, t), pulses: pulsesAt(s, t) }; });
}
// ---- the 2D layers over it
function rrect(ctx, x, y, w, h, r){ r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function rgba(hex, a){ const [r, g, b] = hex3(hex).map(v => Math.round(v * 255)); return `rgba(${r},${g},${b},${a})`; }
var RT = 0;   // the time being rendered (animations read it)
/* 175: animAt, withXform and the text renderer moved to anim.js (object-aware In · Out · Loop) */
function wrapLines(ctx, text, maxW){ const out = []; text.split('\n').forEach(par => { let line = ''; par.split(/\s+/).forEach(w => { const tryL = line ? line + ' ' + w : w; if (ctx.measureText(tryL).width > maxW && line){ out.push(line); line = w; } else line = tryL; }); out.push(line); }); return out; }
/* 175 · the text and subtitle fonts (embedded; the names match the @font-face rules the build writes) — [family, Persian name, weights] */
const FONT_LIST = [['Vazirmatn', 'وزیرمتن', [100, 900], 'fa'], ['IBM Plex Sans Arabic', 'آی‌بی‌اِم پلکس', [400, 700], 'fa'], ['Noto Kufi Arabic', 'نوتو کوفی', [100, 900], 'fa'], ['Noto Naskh Arabic', 'نوتو نسخ', [400, 700], 'fa'],
  ['Markazi Text', 'مرکزی', [400, 700], 'fa'], ['Lalezar', 'لاله‌زار', [400, 400], 'fa'],
  /* 176: English families (Google Fonts, Latin only, files beside the page — fetched the first time a text uses them) */
  ['Noto Sans', 'Noto Sans', [100, 900], 'sans'], ['Inter', 'Inter', [100, 900], 'sans'], ['Roboto', 'Roboto', [100, 900], 'sans'], ['Open Sans', 'Open Sans', [300, 800], 'sans'], ['Montserrat', 'Montserrat', [100, 900], 'sans'], ['Poppins', 'Poppins', [400, 900], 'sans'],
  ['Lato', 'Lato', [400, 900], 'sans'], ['Raleway', 'Raleway', [100, 900], 'sans'], ['Nunito', 'Nunito', [200, 1000], 'sans'], ['Work Sans', 'Work Sans', [100, 900], 'sans'], ['DM Sans', 'DM Sans', [100, 1000], 'sans'],
  ['Playfair Display', 'Playfair Display', [400, 900], 'serif'], ['Lora', 'Lora', [400, 700], 'serif'], ['Merriweather', 'Merriweather', [400, 900], 'serif'], ['Libre Baskerville', 'Libre Baskerville', [400, 700], 'serif'], ['Cormorant Garamond', 'Cormorant Garamond', [300, 700], 'serif'],
  ['Oswald', 'Oswald', [200, 700], 'display'], ['Bebas Neue', 'Bebas Neue', [400, 400], 'display'], ['Anton', 'Anton', [400, 400], 'display'], ['Abril Fatface', 'Abril Fatface', [400, 400], 'display'],
  ['Dancing Script', 'Dancing Script', [400, 700], 'script'], ['Caveat', 'Caveat', [400, 700], 'script'], ['Pacifico', 'Pacifico', [400, 400], 'script']];
const FONT_STEPS = { 'IBM Plex Sans Arabic': [400, 700], Poppins: [400, 700, 900], Lato: [400, 700, 900], Merriweather: [400, 700, 900], 'Libre Baskerville': [400, 700] };   // static families: only these weights exist
const FONT_GROUPS = [['fa', 'فارسی', 'Persian'], ['sans', 'انگلیسی · بی‌سریف', 'English · sans serif'], ['serif', 'انگلیسی · سریف', 'English · serif'], ['display', 'انگلیسی · نمایشی', 'English · display'], ['script', 'انگلیسی · دست‌نویس', 'English · script']];
const FONT_W = Object.fromEntries(FONT_LIST.map(f => [f[0], f[2]]));
const fontFam = fam => fam && FONT_W[fam] ? fam : 'Vazirmatn';
function fontW(fam, w){ const f = fontFam(fam), r = FONT_W[f], st = FONT_STEPS[f]; w = +w || 700; if (st) return st.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a); return Math.max(r[0], Math.min(r[1], w)); }   /* never a faux bold */
const FONT = (w, px, fam) => { const f = fontFam(fam); return `${fontW(f, w)} ${px}px "${f}", "Vazirmatn", "Noto Sans", system-ui, sans-serif`; };
const FONT_OK = new Set();
/* the canvas does not load a web font by itself: load every family/weight the frame uses first (the export waits; the preview redraws) */
function fontKeys(){ const ks = new Set(), add = (fam, w) => { const f = fontFam(fam); ks.add(fontW(f, w) + '|' + f); };
  (V.objects || []).forEach(o => { if (o.type === 'text') add(o.font, o.weight || 700); }); if (V.subs) add(V.subs.font, V.subs.weight || 700); add('Vazirmatn', 800); add('Vazirmatn', ((V.pod || {}).label || {}).weight || 700); return [...ks]; }
async function fontsReady(){ const need = fontKeys().filter(k => !FONT_OK.has(k)); if (!need.length || !document.fonts) return true;
  await Promise.all(need.map(async k => { const [w, f] = k.split('|'); try { await document.fonts.load(`${w} 40px "${f}"`, 'سلامِ گرم Hello 123'); } catch (e) {} FONT_OK.add(k); }));
  if (typeof TLC !== 'undefined') TLC.clear(); return false; }
const EMOJI_CACHE = new Map();
function emojiSprite(emoji, px){   // 169: colour-emoji fonts are bitmap fonts with a size ceiling — draw at ≤128 px and scale (a big glyph drew NOTHING)
  const base = Math.min(128, Math.max(16, Math.round(px))), key = emoji + '@' + base; let cv = EMOJI_CACHE.get(key);
  if (!cv){ cv = document.createElement('canvas'); cv.width = cv.height = base * 2; const g = cv.getContext('2d'); g.font = `${base}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(emoji, base, base * 1.06); EMOJI_CACHE.set(key, cv); }
  return cv; }
function stickerShape(ctx, shape, r){
  ctx.beginPath();
  if (shape === 'square'){ rrect(ctx, -r, -r, 2 * r, 2 * r, r * 0.3); }
  else if (shape === 'pill'){ rrect(ctx, -r, -r * 0.6, 2 * r, r * 1.2, r * 0.6); }
  else if (shape === 'star'){ for (let i = 0; i < 24; i++){ const a = i * Math.PI / 12, rr = i % 2 ? r * 0.82 : r; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); }
  else if (shape === 'blob'){ for (let i = 0; i <= 48; i++){ const a = i / 48 * Math.PI * 2, rr = r * (0.92 + 0.08 * Math.sin(a * 3 + 0.6) + 0.05 * Math.cos(a * 5)); ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); }
  else ctx.arc(0, 0, r, 0, Math.PI * 2);
}
function drawSticker(ctx, o, W, H){
  withXform(ctx, o, W, H, (g, x, y, w, h) => { const r = Math.min(w, h) / 2, on = !!(o.bg && o.bg.on);
    if (on){ g.fillStyle = o.bg.color || '#e6a483'; stickerShape(g, o.bg.shape || 'circle', r); g.fill(); }
    const px = r * (on ? 1.15 : 1.7), sp = emojiSprite(o.emoji || '👑', px); g.drawImage(sp, -px, -px, px * 2, px * 2); });
}
function cleanCue(text){ return (text || '').replace(SPK_RE, '').replace(/<[^>]*>|\|[^|]*\||\{[^{}]*\}|\[[^\[\]]*\]|\/[^/\s][^/]*\//g, ' ').replace(/\s+/g, ' ').trim(); }
const SUB_TAG_TOKEN = /^(<[^>]*>|\|[^|]*\||\{[^{}]*\}|\[[^\[\]]*\])$/;
function cueSpine(c, id){   // 169: the words of a line with their REAL times (the spine paid for at generation), in timeline seconds
  const L = S.lines[id]; if (!L) return null; const W = typeof clipWords === 'function' ? clipWords(c, L.text || '') : null; if (!W) return null;
  const toks = cleanCue(L.text).split(/\s+/).filter(Boolean), ws = W.filter(w => !SUB_TAG_TOKEN.test(w.w) && !/^[^:：]{1,30}[:：]$/.test(w.w));
  if (ws.length !== toks.length) return null;
  return toks.map((w, i) => ({ w, t0: c.at + Math.max(0, ws[i].t0 - c.in), t1: c.at + Math.max(0, ws[i].t1 - c.in) })); }
function cueChunks(q){ const n = +(V.subs.chunk || 0); if (!n) return [q]; const ws = cueWords(q); if (ws.length <= n) return [{ ...q, words: ws }]; const out = [];
  for (let i = 0; i < ws.length; i += n){ const part = ws.slice(i, i + n), at = part[0].t0, end = i + n >= ws.length ? q.at + q.dur : part[part.length - 1].t1;
    out.push({ at, dur: Math.max(0.1, end - at), text: part.map(x => x.w).join(' '), words: part, spk: q.spk }); }
  return out; }
function cuesNow(){ if (!V.subs.follow && V.subs.cues.length) return V.subs.cues;
  const base = scriptOrder().filter(c => !c.unvoiced).flatMap(c => c.lines.length === 1 ? [{ at: c.at, dur: dur(c), text: cleanCue(S.lines[c.lines[0]].text), words: cueSpine(c, c.lines[0]), spk: (S.lines[c.lines[0]] || {}).spk }]
    : c.lines.map((id, k) => ({ at: c.at + dur(c) * k / c.lines.length, dur: dur(c) / c.lines.length, text: cleanCue(S.lines[id].text), spk: (S.lines[id] || {}).spk }))).filter(q => q.text);
  return base.flatMap(cueChunks); }
// 168: a speaker's photo is that speaker's avatar in the podcast (found by the speaker, not by position)
const PHOTO_CACHE = new Map();
function photoEl(url){ let im = PHOTO_CACHE.get(url); if (!im){ im = new Image(); im.decoding = 'async'; im.onload = () => { if (typeof VVER !== 'undefined') VVER++; }; im.src = url; PHOTO_CACHE.set(url, im); } return im; }
function spkPhotoImg(name){ const sp = typeof spkByName === 'function' ? spkByName(name) : null; if (!sp || !sp.photo) return null; const im = photoEl(sp.photo); return im.complete && im.naturalWidth ? im : null; }
function preloadPhotos(){ return Promise.all(spkList().filter(s => s.photo).map(s => new Promise(res => { const im = photoEl(s.photo); if (im.complete) return res(); im.addEventListener('load', res, { once: true }); im.addEventListener('error', res, { once: true }); }))); }
function drawPhotoCircle(ctx, im, cx, cy, r){
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  const s = Math.max(2 * r / im.naturalWidth, 2 * r / im.naturalHeight), w = im.naturalWidth * s, h = im.naturalHeight * s; ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h); ctx.restore();
  if (V.pod && V.pod.avatar && V.pod.avatar.ring === false) return;   /* 177: the ring switch acts on photos too */
  ctx.save(); ctx.strokeStyle = rgba('#ffffff', 0.75); ctx.lineWidth = Math.max(1, r * 0.06); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); ctx.restore(); }
function drawPodLayer(ctx, o, W, H, t, orbs){ const P = V.pod, orb = false;   // 177: no orbs
  orbs.forEach(ob => { const cx = ob.cx * W, cy = ob.cy * H, R = ob.r * H; if ((ob.alpha ?? 1) <= 0.002) return; ctx.save(); if (ob.alpha < 1) ctx.globalAlpha *= ob.alpha; if (ob.mask && ob.mask.p < 0.999) maskRect(ctx, ob.mask, ...ob.mask.box);   /* 175: In / Out per speaker */
    const AV = (P.avatar && P.avatar.size) || 1, AR = R * 0.55 * AV, DN = AR - R * 0.55;   // 179: the avatar's radius, and how far a bigger avatar pushes what sits under it
    if (!orb){ ctx.save(); const ph = spkPhotoImg(ob.spk); if (ph) drawPhotoCircle(ctx, ph, cx, cy, AR); else { ctx.fillStyle = rgba('#ffffff', 0.12); ctx.beginPath(); ctx.arc(cx, cy, AR, 0, Math.PI * 2); ctx.fill(); if (!(P.avatar && P.avatar.ring === false)){ ctx.lineWidth = Math.max(1, R * 0.04); ctx.strokeStyle = rgba('#ffffff', 0.5); ctx.stroke(); }
      ctx.font = FONT(800, R * 0.32 * AV); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl'; ctx.fillText(ob.spk.slice(0, 2), cx, cy); }
      const lv = ob.level, bars = 36; ctx.fillStyle = rgba('#ffffff', 0.85);
      if (P.wave === 'circle'){ const RA = R * AV; for (let i = 0; i < 48; i++){ const a = i / 48 * Math.PI * 2, len = RA * (0.12 + 0.5 * lv * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 9))); ctx.save(); ctx.translate(cx, cy); ctx.rotate(a); rrect(ctx, -RA * 0.02, -RA * 0.62 - len, RA * 0.04, len, RA * 0.02); ctx.fill(); ctx.restore(); } }   // 179: they hug the avatar at any size
      else if (P.wave === 'line'){ ctx.strokeStyle = rgba('#ffffff', 0.9); ctx.lineWidth = Math.max(1, H * 0.003); ctx.beginPath(); for (let i = 0; i <= 80; i++){ const x = cx - R * 1.3 + i / 80 * R * 2.6, y = cy + DN + R * 0.95 + Math.sin(i * 0.5 + t * 8) * R * 0.25 * lv; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.stroke(); }
      else { const bw = R * 2.6 / bars; for (let i = 0; i < bars; i++){ const hh = R * 0.5 * Math.max(0.06, lv * (0.35 + 0.65 * Math.abs(Math.sin(i * 1.3 + t * 7)))); const x = cx - R * 1.3 + i * bw;
          if (P.wave === 'mirror') rrect(ctx, x, cy + DN + R * 0.95 - hh / 2, bw * 0.6, hh, bw * 0.3); else rrect(ctx, x, cy + DN + R * 1.2 - hh, bw * 0.6, hh, bw * 0.3); ctx.fill(); } }
      ctx.restore(); }
    if (P.names !== false && orbs.length){ const LB = P.label || {}, ls = LB.size || 1, style = LB.style || 'pill', px = Math.max(8, H * 0.024 * ls);   // 170: size, weight and style
      // 179: the name's TOP stays where it was (under the avatar and its sound) and a bigger name grows downward from it
      const px1 = Math.max(8, H * 0.024), top = cy + Math.max(R * 1.45 + DN - px1 * 0.85, P.wave === 'circle' ? R * AV * 1.29 : 0);
      ctx.save(); ctx.font = FONT(LB.weight || 700, px); ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const tw = ctx.measureText(ob.spk).width + px * 1.25, lh = px * 1.7, ty = top + lh / 2;
      const prim = getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#e9603b';
      if (style === 'pill'){ ctx.fillStyle = rgba('#ffffff', 0.16); rrect(ctx, cx - tw / 2, ty - lh / 2, tw, lh, lh / 2); ctx.fill(); }
      else if (style === 'solid'){ ctx.fillStyle = LB.pill || prim; rrect(ctx, cx - tw / 2, ty - lh / 2, tw, lh, lh / 2); ctx.fill(); }
      else if (style === 'outline'){ ctx.lineWidth = Math.max(1, px * 0.08); ctx.strokeStyle = rgba('#ffffff', 0.55); rrect(ctx, cx - tw / 2, ty - lh / 2, tw, lh, lh / 2); ctx.stroke(); }
      else if (style === 'plain'){ ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = px * 0.35; ctx.shadowOffsetY = px * 0.08; }
      ctx.fillStyle = LB.color || '#fff'; ctx.fillText(ob.spk, cx, ty); ctx.restore(); }
    ctx.restore(); });
}
function drawSubs(ctx, W, H, t){
  const s = V.subs; if (!s.on) return; const q = cuesNow().find(c => t >= c.at && t < c.at + c.dur); if (!q) return;
  const px = s.size * H; ctx.save(); ctx.font = FONT(s.weight || 600, px, s.font); ctx.direction = 'rtl'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const lines = wrapLines(ctx, q.text, W * 0.84), lh = px * 1.45, y0 = s.pos * H - (lines.length - 1) * lh;
  lines.forEach((l, i) => { const tw = ctx.measureText(l).width, y = y0 + i * lh; ctx.fillStyle = rgba(s.bg, s.bgOp); rrect(ctx, W / 2 - tw / 2 - px * 0.4, y - lh / 2, tw + px * 0.8, lh, px * 0.25); ctx.fill(); ctx.fillStyle = s.color; ctx.fillText(l, W / 2, y); });
  ctx.restore();
}
// ---- one frame (preview and export call exactly this)
async function vFrame(ctx, W, H, t, exporting){
  if (exporting){ await preloadPhotos(); await fontsReady(); } else fontsReady().then(ok => { if (!ok) vDraw(); }); RT = t;
  const P = V.pod, pod = V.objects.find(o => o.type === 'pod' && visibleAt(o, t)), orbs = pod ? podAnimOrbs(pod, podLayout(pod, W, H, t), W, H, t) : [];   /* 175: In · Out · Loop on the speakers */
  const bgEl = (P.bg === 'image' || P.bg === 'video') && P.bgAsset ? await mediaEl(P.bgAsset) : null;
  if (bgEl && bgEl.tagName === 'VIDEO' && exporting) await seekVideo(bgEl, t % (bgEl.duration || 1e9));
  await drawBackground(ctx, W, H, t, exporting, orbs, P, pod);   // 174: the background track (and its transitions) is the base
  for (const o of zOrder()){ if (!visibleAt(o, t) || layerOf(o.id).hidden) continue; if (o.bgl && o.type !== 'pod') continue;
    if (o.type === 'pod') drawPodLayer(ctx, o, W, H, t, o === pod ? orbs : podAnimOrbs(o, podLayout(o, W, H, t), W, H, t));   /* 177: two podcasts on screen at once each place their own speakers */
    else if (o.type === 'text') drawText(ctx, o, W, H);
    else if (o.type === 'sticker') drawSticker(ctx, o, W, H);
    else if (o.type === 'image' || o.type === 'video'){ const el = await mediaEl(o.asset); if (el && el.tagName === 'VIDEO' && exporting){ const local = (o.trimIn || 0) + t - (o.start || 0); await seekVideo(el, o.loop && el.duration ? local % el.duration : Math.min(local, (el.duration || 1e9) - 0.01)); } drawMedia(ctx, o, W, H, el); } }
  drawSubs(ctx, W, H, t);
}
function seekVideo(v, t){ return new Promise(r => { if (Math.abs(v.currentTime - t) < 0.0005){ r(); return; } const done = () => { v.removeEventListener('seeked', done); r(); }; v.addEventListener('seeked', done); v.currentTime = Math.max(0, t); setTimeout(done, 1500); }); }

// =====================================================================================
// 161 · THE VIDEO TAB'S INTERFACE — mode switch, stage, canvas editing, inspector, layers
// =====================================================================================
function setMode(m){
  mode = m; vSel = null; selClip = null; document.body.classList.toggle('mode-video', m === 'video'); document.body.classList.toggle('mode-audio', m !== 'video');
  $('m-audio').classList.toggle('tab-active', m === 'audio'); $('m-video').classList.toggle('tab-active', m === 'video');
  if (m === 'video'){ requestAnimationFrame(() => { fitFrame(); fillVInsp(); renderVTL(); vDraw(); }); } else { renderScript(); }
}
let frameW = 0, frameH = 0, drawing = false, drawAgain = false;
function fitFrame(){
  const st = $('stage'); if (!st) return; const [ow, oh] = outSize(), ar = ow / oh, aw = st.clientWidth - 24, ah = st.clientHeight - 24;
  frameW = Math.max(120, Math.min(aw, ah * ar)); frameH = frameW / ar; const f = $('frame'); f.style.width = frameW + 'px'; f.style.height = frameH + 'px';
  const cv = $('vcanvas'), dpr = Math.min(2, devicePixelRatio || 1); cv.width = Math.round(frameW * dpr); cv.height = Math.round(frameH * dpr); placeSelBox();   // 170: full Retina resolution
}
async function vDraw(){
  if (mode !== 'video' || ANPV) return;   /* 175: a preset is previewing on the canvas */ if (drawing){ drawAgain = true; return; } drawing = true;
  try { const cv = $('vcanvas'), dpr = Math.min(2, devicePixelRatio || 1), cw = Math.round(frameW * dpr), ch = Math.round(frameH * dpr);   // lighter while playing
    if (cw > 0 && (cv.width !== cw || cv.height !== ch)){ cv.width = cw; cv.height = ch; }
    const ctx = cv.getContext('2d'); syncPreviewVideos(); await vFrame(ctx, cv.width, cv.height, playhead, false); } catch (e) { console.error(e); }
  drawing = false; if (drawAgain){ drawAgain = false; vDraw(); }
}
window.onPlayhead = () => { if (mode === 'video'){ vDraw(); placeVPlayhead(); } };
function syncPreviewVideos(){
  V.objects.forEach(o => { if (o.type !== 'video') return; const m = MEDIA.get(o.asset); const el = m && m.el; if (!el) return;
    const local = (o.trimIn || 0) + playhead - (o.start || 0), on = visibleAt(o, playhead), want = o.loop && el.duration ? local % el.duration : local;
    el.muted = o.mute !== false; el.volume = Math.min(1, Math.max(0, o.volume ?? 1));
    if (playing && on){ if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = Math.max(0, want); if (el.paused) el.play().catch(() => {}); }
    else { if (!el.paused) el.pause(); if (on && Math.abs(el.currentTime - want) > 0.05) el.currentTime = Math.max(0, want); } });
}
// ---- selection, move, scale, rotate, snap (the mock's interactions, on the real document)
function hitTest(nx, ny){
  const [W, H] = outSize();
  const zo = zOrder(); for (let i = zo.length - 1; i >= 0; i--){ const o = zo[i]; if (o.type === 'fx' || !visibleAt(o, playhead) || layerOf(o.id).hidden) continue;   // 170: a transition covers the frame but is picked from the timeline
    const cx = (o.x + o.w / 2) * W, cy = (o.y + o.h / 2) * H, a = -(o.rot || 0) * Math.PI / 180, px = nx * W - cx, py = ny * H - cy;
    const rx = px * Math.cos(a) - py * Math.sin(a), ry = px * Math.sin(a) + py * Math.cos(a); if (Math.abs(rx) <= o.w * W / 2 && Math.abs(ry) <= o.h * H / 2) return o.id; }
  return null;
}
function selectV(id){ vSel = id; if (id && typeof sel !== 'undefined' && (sel.size || selClip)){ sel.clear(); selClip = null; paintSel(); }   // 169: a non-speech selection deselects everything else
  placeSelBox(); fillVInsp(); renderVTL(); }
function placeSelBox(){
  const sb = $('selbox'); if (!sb) return; const o = vSel && objById(vSel); if (!o || mode !== 'video' || o.type === 'sfx'){ sb.classList.add('hidden'); return; }
  sb.classList.remove('hidden'); sb.style.left = o.x * frameW + 'px'; sb.style.top = o.y * frameH + 'px'; sb.style.width = o.w * frameW + 'px'; sb.style.height = o.h * frameH + 'px'; sb.style.transform = `rotate(${o.rot || 0}deg)`;
}
function guides(gx, gy){ $('gV').classList.toggle('hidden', !gx); $('gH').classList.toggle('hidden', !gy); }
function vChanged(){ placeSelBox(); vDraw(); fillXformOnly(); renderVTL(); autosave(); }
function startVMove(ev){
  const o = objById(vSel); if (!o) return; ev.preventDefault(); remember(); const x0 = ev.clientX, y0 = ev.clientY, ox = o.x, oy = o.y, snap = 6;
  const mv = e => { let nx = ox + (e.clientX - x0) / frameW, ny = oy + (e.clientY - y0) / frameH; let gx = false, gy = false;
    const c = [nx + o.w / 2, ny + o.h / 2]; if (Math.abs(c[0] - 0.5) * frameW < snap){ nx = 0.5 - o.w / 2; gx = true; } if (Math.abs(c[1] - 0.5) * frameH < snap){ ny = 0.5 - o.h / 2; gy = true; }
    if (Math.abs(nx) * frameW < snap) nx = 0; if (Math.abs(nx + o.w - 1) * frameW < snap) nx = 1 - o.w; if (Math.abs(ny) * frameH < snap) ny = 0; if (Math.abs(ny + o.h - 1) * frameH < snap) ny = 1 - o.h;
    o.x = nx; o.y = ny; guides(gx, gy); vChanged(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); guides(false, false); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function startVScale(ev, hd){
  const o = objById(vSel); if (!o) return; ev.preventDefault(); ev.stopPropagation(); remember();
  const x0 = ev.clientX, y0 = ev.clientY, s = { x: o.x, y: o.y, w: o.w, h: o.h }, ar = (o.w * frameW) / (o.h * frameH), a = (o.rot || 0) * Math.PI / 180;
  const mv = e => { const dxs = (e.clientX - x0), dys = (e.clientY - y0), dx = (dxs * Math.cos(-a) - dys * Math.sin(-a)) / frameW, dy = (dxs * Math.sin(-a) + dys * Math.cos(-a)) / frameH;
    let w = s.w + (hd.includes('e') ? dx : hd.includes('w') ? -dx : 0) * (e.altKey ? 2 : 1), h = s.h + (hd.includes('s') ? dy : hd.includes('n') ? -dy : 0) * (e.altKey ? 2 : 1);
    if ((o.lock !== false) !== !!e.shiftKey){ if (hd.length === 2 || hd === 'e' || hd === 'w') h = w * frameW / ar / frameH; else w = h * frameH * ar / frameW; }   /* 177: Shift flips the ratio lock */
    w = Math.max(0.02, w); h = Math.max(0.02, h);
    if (e.altKey){ o.x = s.x + (s.w - w) / 2; o.y = s.y + (s.h - h) / 2; } else { o.x = hd.includes('w') ? s.x + s.w - w : (hd === 'n' || hd === 's' ? s.x + (s.w - w) / 2 : s.x); o.y = hd.includes('n') ? s.y + s.h - h : (hd === 'e' || hd === 'w' ? s.y + (s.h - h) / 2 : s.y); }
    o.w = w; o.h = h; vChanged(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function startVRotate(ev){
  const o = objById(vSel); if (!o) return; ev.preventDefault(); ev.stopPropagation(); remember(); const fr = $('frame').getBoundingClientRect(), cx = fr.left + (o.x + o.w / 2) * frameW, cy = fr.top + (o.y + o.h / 2) * frameH;
  const mv = e => { let d = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90; if (e.shiftKey) d = Math.round(d / 15) * 15; o.rot = Math.round(((d + 540) % 360 - 180) * 10) / 10; vChanged(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}
function editTextInPlace(){
  const o = objById(vSel); if (!o || o.type !== 'text') return; const ed = $('vtextEd'); ed.classList.remove('hidden'); ed.innerText = o.text;
  Object.assign(ed.style, { left: o.x * frameW + 'px', top: o.y * frameH + 'px', width: o.w * frameW + 'px', minHeight: o.h * frameH + 'px', fontSize: o.size * frameH + 'px', fontWeight: o.weight, color: o.color, textAlign: o.align, transform: `rotate(${o.rot || 0}deg)` });
  ed.focus(); document.getSelection().selectAllChildren(ed);
  ed.onblur = () => { remember(); o.text = ed.innerText.trim(); ed.classList.add('hidden'); vChanged(); fillVInsp(); };
}
function wireStage(){
  const ov = $('vover');
  ov.addEventListener('pointerdown', e => { if (e.target.closest('[data-h]')) return startVScale(e, e.target.closest('[data-h]').dataset.h); if (e.target.closest('#vrot')) return startVRotate(e);
    const r = $('frame').getBoundingClientRect(), id = hitTest((e.clientX - r.left) / frameW, (e.clientY - r.top) / frameH);
    if (id !== vSel) selectV(id); if (id) startVMove(e); });
  ov.addEventListener('dblclick', () => editTextInPlace());
  addEventListener('resize', () => { if (mode === 'video'){ fitFrame(); vDraw(); renderVTL(); } });
  addEventListener('keydown', e => {
    if (mode !== 'video' || !vSel || e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || document.querySelector('dialog[open]')) return;
    if (vSel === 'SUB' && typeof subKey === 'function' && subKey(e)) return;   // 176: the subtitles have their own keys
    const o = objById(vSel), [W, H] = outSize(), st = e.shiftKey ? 10 : 1; if (!o) return;
    if ((e.key === 'Delete' || e.key === 'Backspace')){ e.preventDefault(); e.stopPropagation(); vDelete(); return; }   // 176: the same delete as the toolbar (a slide closes its gap)
    if (o.bgl && o.type !== 'pod' && e.key.startsWith('Arrow')) return;   // a background clip always covers the canvas
    if (e.key.startsWith('Arrow')){ e.preventDefault(); e.stopPropagation(); o.x += (e.key === 'ArrowRight' ? st : e.key === 'ArrowLeft' ? -st : 0) / W; o.y += (e.key === 'ArrowDown' ? st : e.key === 'ArrowUp' ? -st : 0) / H; vChanged(); }
    else if (e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); e.stopPropagation(); remember(); V.objects = V.objects.filter(x => x !== o); selectV(null); vChanged(); }
    else if (e.key === 'Escape'){ e.stopPropagation(); selectV(null); } }, true);
}
// ---- inspector builders (the mock's look: fieldsets, slim ranges with units, toggles on the far side, swatches)
const RNG = 'range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]';
const vrange = (lbl, en, val, min, max, step, unit, set) => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T(lbl, en)}<span class="ms-auto tabular-nums text-base-content/60" dir="ltr">${unit === '%' ? Math.round(val * 100) + '%' : (Math.round(val * 100) / 100) + (unit || '')}</span></legend><input type="range" class="${RNG}" min="${min}" max="${max}" step="${step}" value="${val}" oninput="${set}; this.previousElementSibling.lastElementChild.textContent = ${unit === '%' ? "Math.round(this.value * 100) + '%'" : "(Math.round(this.value * 100) / 100) + '" + (unit || '') + "'"}"></fieldset>`;
const vtoggle = (lbl, en, on, set) => `<label class="flex w-full cursor-pointer items-center justify-between gap-3 text-sm"><span>${T(lbl, en)}</span><input type="checkbox" class="toggle toggle-sm toggle-primary" ${on ? 'checked' : ''} onchange="${set}"></label>`;
const vselect = (lbl, en, rows, cur, set) => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T(lbl, en)}</legend><select class="select select-sm w-full" onchange="${set}">${rows.map(([v, l]) => `<option value="${escapeHtml(v)}" ${v === cur ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></fieldset>`;
const vcolor = (lbl, en, val, set) => `<label class="flex items-center justify-between gap-3 text-sm"><span>${T(lbl, en)}</span><input type="color" value="${val}" class="h-7 w-12 cursor-pointer rounded-field border border-base-content/15 bg-transparent" oninput="${set}"></label>`;
const vsec = (title, en, body, reset) => `<div class="space-y-3 border-b border-base-300 px-4 py-3"><div class="flex items-center justify-between"><span class="text-sm font-bold">${T(title, en)}</span>${reset ? `<button class="btn btn-ghost btn-xs btn-square opacity-60 hover:opacity-100" onclick="${reset}" data-tip="بازنشانی به پیش‌فرض" data-tip-en="Reset to default"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>` : ''}</div>${body}</div>`;
function vset(path, val, noHist){ if (!noHist) remember(); const ks = path.split('.'); let o = ks[0] === 'sel' ? objById(vSel) : V; ks.slice(1, -1).forEach(k => o = o[k]); if (ks[0] !== 'sel' && ks.length === 1){ V[path] = val; } else o[ks[ks.length - 1]] = val; VVER++; vDraw(); autosave(); }
function vreset(what){ remember(); const o = objById(vSel);
  if (what === 'video') Object.assign(V, { ratio: '16:9', res: '2k', fps: 30, bg: '#000000' });
  else if (what === 'subs') V.subs = { ...SUBS0(), cues: V.subs.cues };
  else if (what === 'pod') V.pod = { ...POD0(), bgAsset: V.pod.bgAsset };
  else if (what === 'text' && o) Object.assign(o, (({ text, x, y, w, h, start, end, ...r }) => r)(TEXT0()));
  else if (what === 'media' && o) Object.assign(o, (({ asset, x, y, w, h, start, end, type, ...r }) => r)(MEDIA0(o.type, o.asset)));
  else if (what === 'xform' && o){ o.rot = 0; o.lock = true; }
  else if (what === 'anim' && o){ o.anim = {}; }
  else if (what === 'sticker' && o){ Object.assign(o, (({ x, y, start, end, type, ...r }) => r)(STICKER0())); }
  VVER++; fitFrame(); fillVInsp(); vChanged(); }
function fillXformOnly(){ const o = objById(vSel); if (!o) return; const [W, H] = outSize(); const set = (id, v) => { const el = $(id); if (el && document.activeElement !== el) el.value = v; };
  set('xfX', Math.round(o.x * W)); set('xfY', Math.round(o.y * H)); set('xfW', Math.round(o.w * W)); set('xfH', Math.round(o.h * H)); set('xfR', o.rot || 0);
  const g = $('xfPlace'); if (g && !g.childElementCount) g.innerHTML = [-1, 0, 1].flatMap(y => [-1, 0, 1].map(x => `<button type="button" class="btn btn-xs btn-square border-base-content/15 bg-base-100" onclick="placeOnGrid(${x}, ${y})" aria-label="·"><span class="size-1.5 rounded-full bg-current"></span></button>`)).join(''); }   // 177: the 9-dot placement lives here
function xfApply(k){ const o = objById(vSel); if (!o) return; remember(); const [W, H] = outSize(), ar = o.w * W / (o.h * H);
  o.x = +$('xfX').value / W; o.y = +$('xfY').value / H; const w = +$('xfW').value / W, h = +$('xfH').value / H;
  if (k === 'w'){ o.w = w; if (o.lock !== false) o.h = o.w * W / ar / H; } else if (k === 'h'){ o.h = h; if (o.lock !== false) o.w = o.h * H * ar / W; } o.rot = +$('xfR').value || 0; vChanged(); }
const TYPE_NAME = { pod: ['قالبِ پادکست', 'Podcast template'], text: ['متن', 'Text'], image: ['تصویر', 'Picture'], video: ['ویدیو', 'Video'], sticker: ['استیکر', 'Sticker'], sfx: ['افکتِ صوتی', 'Sound effect'] };
// 177: the old generated inspector (dead since 164 — fillVInsp is showVPanels) is gone
function applyVStyle(k){ remember(); const keep = { bgAsset: V.pod.bgAsset, sens: V.pod.sens, names: V.pod.names }; Object.assign(V.pod, STYLES[k][1], { style: k }, keep); if (STYLES[k][1].layout === 'two') V.pod.layout = 'auto'; VVER++; fillVInsp(); vDraw(); autosave(); }
function placeOnGrid(px, py){ const o = objById(vSel); if (!o) return; remember(); const m = 0.04; o.x = px < 0 ? m : px > 0 ? 1 - o.w - m : (1 - o.w) / 2; o.y = py < 0 ? m + 0.02 : py > 0 ? 1 - o.h - m - 0.1 : (1 - o.h) / 2; vChanged(); }
function addVSticker(){ remember(); const o = { id: 'o' + (++uid), ...STICKER0() }; V.objects.push(o); selectV(o.id); vChanged(); }
function addVText(){ remember(); const o = { id: 'o' + (++uid), ...TEXT0(), y: 0.2 }; V.objects.push(o); selectV(o.id); vChanged(); }
function pickVMedia(kind, replace){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = kind.includes('video') ? 'video/*' : kind.includes('image') ? 'image/*' : 'image/*,video/*';
  inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; setBusy(true); say(T('فایل اضافه می‌شود…', 'Adding the file…'), 'ok');
    try { const id = await addAsset(f), el = await mediaEl(id); remember();
      if (kind.startsWith('bg-')){ V.pod.bgAsset = id; V.pod.bg = kind.slice(3); }
      else if (replace && objById(vSel)){ objById(vSel).asset = id; }
      else { const o = { id: 'o' + (++uid), ...MEDIA0(kind, id, el && (el.videoWidth || el.naturalWidth), el && (el.videoHeight || el.naturalHeight)) }; V.objects.push(o); vSel = o.id; }
      say('', 'ok'); fillVInsp(); vChanged(); } catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); } };
  inp.click();
}
function resyncSubs(){ remember(); const f = V.subs.follow; V.subs.follow = true; V.subs.cues = cuesNow().map(q => ({ ...q })); V.subs.follow = f; renderVTL(); vDraw(); autosave(); say(T('زیرنویس دوباره با تایم‌لاین هم‌گام شد.', 'Subtitles re-synced with the timeline.'), 'ok'); }
// ---- the layer timeline (video mode): subtitles on top, objects (drag rows to reorder), audio as one track
const VROW = 36;
function placeVPlayhead(){ const ph = $('vph'); if (ph) ph.style.left = (PAD + playhead * zoom) + 'px'; }
function renderVTL(){
  const box = $('vtl'); if (!box || mode !== 'video') return; const end = projEnd(), Wd = PAD + end * zoom + tailPx(), rows = [];
  rows.push({ key: 'subs', name: T('زیرنویس', 'Subtitles'), subs: true, bars: cuesNow().map(q => ({ at: q.at, end: q.at + q.dur, label: q.text, cls: V.subs.follow ? 'bg-accent/60' : 'bg-accent/80' })) });
  [...V.objects].reverse().forEach(o => rows.push({ key: o.id, name: T((TYPE_NAME[o.type] || [o.type])[0], (TYPE_NAME[o.type] || [0, o.type])[1]) + (o.type === 'text' ? ' · ' + (o.text || '').slice(0, 14) : ''), obj: o,
    bars: [{ at: o.start || 0, end: o.end == null ? end : o.end, label: '', cls: o.id === vSel ? 'bg-primary outline outline-2 outline-primary' : 'bg-primary/55' }] }));
  rows.push({ key: 'audio', name: T('صدا', 'Audio'), bars: [{ at: 0, end: speechEnd(), label: T('دوبار کلیک: حالتِ صدا', 'double-click: audio mode'), cls: 'bg-secondary/50' }] });
  box.innerHTML = `<div class="flex min-h-0"><div class="w-40 shrink-0">${rows.map(r => `<div class="flex items-center gap-1.5 px-2 text-xs" style="height:${VROW}px" data-row="${r.key}" ${r.obj ? 'draggable="true"' : ''}>${r.obj ? '<svg class="size-3.5 cursor-grab opacity-50"><use href="#i-grip-vertical"/></svg>' : '<span class="w-3.5"></span>'}<span class="truncate font-semibold">${escapeHtml(r.name)}</span></div>`).join('')}</div>
    <div id="vlanes" class="relative min-w-0 flex-1 overflow-x-auto"><div class="relative" style="width:${Wd}px">${rows.map(r => `<div class="relative border-b border-base-300/50" style="height:${VROW}px" data-lane="${r.key}">${r.bars.map((b, i) => `<div class="vbar absolute top-1.5 overflow-hidden rounded-field px-1.5 text-[11px] leading-[24px] text-white ${b.cls}" style="left:${PAD + b.at * zoom}px;width:${Math.max(6, (b.end - b.at) * zoom - 1)}px;height:${VROW - 12}px" data-k="${r.key}" data-i="${i}">${escapeHtml(b.label || '')}${r.obj || r.subs ? '<span class="vtrim absolute inset-y-0 left-0 w-2 cursor-ew-resize" data-e="s"></span><span class="vtrim absolute inset-y-0 right-0 w-2 cursor-ew-resize" data-e="e"></span>' : ''}</div>`).join('')}</div>`).join('')}
      <div id="vph" class="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-secondary" style="left:${PAD + playhead * zoom}px"></div></div></div></div>`;
  wireVTL();
}
function wireVTL(){
  const lanes = $('vlanes'); if (!lanes) return;
  lanes.onpointerdown = e => { const bar = e.target.closest('.vbar'), r = lanes.firstElementChild.getBoundingClientRect(), t = Math.max(0, (e.clientX - r.left - PAD) / zoom);
    if (!bar){ seek(t); return; } const k = bar.dataset.k; if (k === 'audio'){ seek(t); return; }
    if (k === 'subs'){ const ci = +bar.dataset.i; remember(); if (V.subs.follow){ V.subs.cues = cuesNow().map(q => ({ ...q })); V.subs.follow = false; say(T('زیرنویس حالا ثابت است؛ «هم‌گام‌سازیِ دوباره» آن را به تایم‌لاین برمی‌گرداند.', 'Subtitles are now fixed. Use Re-sync to follow the timeline again.'), 'ok'); }
      const q = V.subs.cues[ci], tr = e.target.closest('.vtrim'), x0 = e.clientX, a0 = q.at, d0 = q.dur;
      const mv = ev => { const d = (ev.clientX - x0) / zoom; if (tr && tr.dataset.e === 's'){ q.at = Math.max(0, Math.min(a0 + d0 - 0.2, a0 + d)); q.dur = a0 + d0 - q.at; } else if (tr) q.dur = Math.max(0.2, d0 + d); else q.at = Math.max(0, a0 + d); renderVTL(); vDraw(); };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); autosave(); if (!vSel) fillVInsp(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); return; }
    const o = objById(k); if (!o) return; selectV(o.id);
    const tr = e.target.closest('.vtrim'), x0 = e.clientX, s0 = o.start || 0, e0 = o.end == null ? projEnd() : o.end; remember();
    const mv = ev => { const d = (ev.clientX - x0) / zoom; if (tr && tr.dataset.e === 's') o.start = Math.max(0, Math.min(e0 - 0.2, s0 + d)); else if (tr) o.end = Math.max(s0 + 0.2, e0 + d); else { o.start = Math.max(0, s0 + d); o.end = o.start + (e0 - s0); } renderVTL(); vDraw(); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); autosave(); fillVInsp(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
  lanes.ondblclick = async e => { const bar = e.target.closest('.vbar'); if (!bar) return; if (bar.dataset.k === 'audio') return setMode('audio');
    if (bar.dataset.k === 'subs'){ const ci = +bar.dataset.i; if (V.subs.follow){ V.subs.cues = cuesNow().map(q => ({ ...q })); V.subs.follow = false; } const q = V.subs.cues[ci]; const nt = await askText(T('متنِ زیرنویس', 'Subtitle text'), '', q.text); if (nt !== null){ remember(); q.text = nt.trim(); renderVTL(); vDraw(); autosave(); } } };
  document.querySelectorAll('#vtl [data-row][draggable]').forEach(row => {
    row.ondragstart = e => e.dataTransfer.setData('text/plain', row.dataset.row);
    row.ondragover = e => e.preventDefault();
    row.ondrop = e => { e.preventDefault(); const from = e.dataTransfer.getData('text/plain'), to = row.dataset.row; if (from === to) return; remember();
      const a = V.objects.findIndex(o => o.id === from), b = V.objects.findIndex(o => o.id === to); const [m] = V.objects.splice(a, 1); V.objects.splice(b, 0, m); renderVTL(); vDraw(); autosave(); }; });
}
// ---- the document carries the video tab (autosave and .ava)
function snapRaw(){ return { lines: S.lines, tracks: S.tracks.map(t => ({ ...t, clips: t.clips.map(({ _ti, _track, ...c }) => c) })), proj: S.proj, music: S.music, video: V }; }
function snapshot(){ return JSON.parse(JSON.stringify(snapRaw())); }
function restoreSnap(sn){
  S.lines = sn.lines; S.tracks = sn.tracks; const base = JSON.parse(JSON.stringify(S.proj)); S.proj = Object.assign(base, sn.proj || {});
  ['cbx', 'light', 'fish', 'duo'].forEach(k => S.proj[k] = Object.assign({}, base[k], (sn.proj || {})[k] || {})); S.music = Object.assign({}, MUSIC0, sn.music || {});
  const d = V0(); V = Object.assign(d, sn.video || {}); V.pod = Object.assign(POD0(), (sn.video || {}).pod || {}); V.subs = Object.assign(SUBS0(), (sn.video || {}).subs || {}); podMigrate(V.pod, (sn.video || {}).pod);
  if (sn.video && !sn.video.cv179){ if (String(V.bg || '').toLowerCase() === '#0c1230') V.bg = '#000000'; V.cv179 = true; }   // 179: the old default navy canvas → the new default black
  VVER++;
  if (mode === 'video'){ fitFrame(); fillVInsp(); renderVTL(); vDraw(); }
}

// =====================================================================================
// 161 · EXPORT THE VIDEO — WebCodecs + an embedded MP4 muxer. Codecs by capability:
//       H.264 → VP9 → AV1, AAC → Opus. Safari's AAC encoder writes a broken decoder config
//       (WebKit bug 302253: the MP4 gets a SILENT track), so the AAC header is built here.
// =====================================================================================
let vExp = null;
const BR = (W, H, fps) => Math.round(W * H * fps * (W >= 3800 ? 0.18 : 0.2));
function aacASC(sr, ch){ const idx = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(sr); return new Uint8Array([(2 << 3) | (idx >> 1), ((idx & 1) << 7) | (ch << 3)]); }
async function probeCodecs(W, H, fps, fmt){
  let vc = null, ac = null; if (typeof VideoEncoder === 'undefined') return { vc, ac };
  const cands = fmt === 'webm' ? [['vp9', W >= 3800 ? 'vp09.00.51.08' : 'vp09.00.41.08'], ['vp8', 'vp8'], ['av1', W >= 3800 ? 'av01.0.12M.08' : 'av01.0.08M.08']] : [['avc', W >= 3800 && fps > 30 ? 'avc1.640034' : 'avc1.640033'], ['vp9', W >= 3800 ? 'vp09.00.51.08' : 'vp09.00.41.08'], ['av1', W >= 3800 ? 'av01.0.12M.08' : 'av01.0.08M.08']];
  for (const [k, c] of cands){ try { if ((await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: BR(W, H, fps), framerate: fps })).supported){ vc = [k, c]; break; } } catch (e) {} }
  if (typeof AudioEncoder !== 'undefined' && !window.__forceMp3) for (const [k, c] of (fmt === 'webm' ? [['opus', 'opus']] : [['aac', 'mp4a.40.2'], ['opus', 'opus']])){   /* 175: mp4 · mov · mkv share these */ try { if ((await AudioEncoder.isConfigSupported({ codec: c, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 })).supported){ ac = [k, c]; break; } } catch (e) {} }
  return { vc, ac };
}
async function openVExport(){
  $('vxRes').value = V.res; $('vxFps').value = String(V.fps); $('vxMusic').value = (S.music.file || S.music.name) ? 'music' : 'voice';
  ['vxRes', 'vxFps', 'vxMusic'].forEach(id => enh($(id))); $('vxProg').value = 0; $('vxProgRow').classList.add('hidden'); $('vxGo').disabled = false; $('vxInfo').textContent = '';
  $('vexpDlg').showModal(); vxProbe();
}
async function vxProbe(){ const [W, H] = outSize($('vxRes').value), fps = +$('vxFps').value, fmt = ($('vxFmt') || {}).value || 'mp4';   // 175: per format
  if (fmt === 'gif'){ const gW = Math.min(W, 640), gH = Math.round(H * gW / W); $('vxInfo').textContent = `GIF · \u2066${gW} × ${gH}\u2069 · ` + T('حدودِ 12 فریم در ثانیه، بی‌صدا', 'about 12 fps, no sound'); $('vxGo').disabled = false; return; }
  const { vc, ac } = await probeCodecs(W, H, fps, fmt);
  $('vxInfo').textContent = `${fmt.toUpperCase()} · \u2066${W} × ${H} · ${fps} fps\u2069 · ` + (vc ? vc[0].toUpperCase() : T('بدونِ رمزگذارِ ویدیو', 'no video encoder')) + ' + ' + (ac ? ac[0].toUpperCase() : fmt === 'webm' ? T('بی‌صدا (این سیستم رمزگذارِ Opus ندارد)', 'no sound (this system has no Opus encoder)') : T('MP3 (برای macOSِ قدیمی‌تر)', 'MP3 (for older macOS)'));
  $('vxGo').disabled = !vc; if (!vc) $('vxInfo').textContent += ' — ' + T('این سیستم رمزگذارِ ویدیو ندارد.', 'this system has no video encoder.'); }
// 175: MOV is the same ISO file as MP4 with QuickTime's brand ('qt  '), patched in place (no offsets move)
function toQuickTime(u8){ if (u8.length < 16 || String.fromCharCode(u8[4], u8[5], u8[6], u8[7]) !== 'ftyp') return u8; const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), n = dv.getUint32(0), qt = [0x71, 0x74, 0x20, 0x20];
  u8.set(qt, 8); dv.setUint32(12, 0x20050300); for (let o = 16; o + 4 <= n; o += 4) u8.set(qt, o); return u8; }
const MKV_V = { avc: 'V_MPEG4/ISO/AVC', vp9: 'V_VP9', vp8: 'V_VP8', av1: 'V_AV1' };
const u8b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
async function exportVideo(){
  if (vExp) return; const res = $('vxRes').value, fps = +$('vxFps').value, [W, H] = window.__vxSize || outSize(res), dur = projEnd();   // __vxSize: test hook only

  const fmt = ($('vxFmt') || {}).value || 'mp4'; const { vc, ac } = fmt === 'gif' ? { vc: ['gif', 'gif'], ac: null } : await probeCodecs(W, H, fps, fmt); if (!vc) return vxProbe();   // 170: mp4 · webm · gif
  vExp = { cancel: false }; $('vxGo').disabled = true; $('vxProgRow').classList.remove('hidden'); const prog = (p, msg) => { $('vxProg').value = Math.round(p * 1000) / 10; if (msg) $('vxInfo').textContent = msg; };
  let err = null;
  try {
    await document.fonts.ready; prog(0, T('صدای نهایی ساخته می‌شود…', 'Making the final audio…'));
    const mt = musicTrack(), mVol = mt ? (mt.volume ?? 1) : 1, wm = $('vxMusic').value === 'music' && (S.music.file || S.music.name) && !(mt && (mt.muted || mVol <= 0));
    const cfg = wm ? { on: true, clips: musicClipsSpec(), file: S.music.file, level_db: S.music.level_db + 20 * Math.log10(Math.max(0.01, mVol)), duck: (S.music.duck_db ?? 12) > 0, duck_db: S.music.duck_db ?? 12, fade_in: S.music.fade_in, fade_out: S.music.fade_out } : null;
    // the audio: the engine's final mix (exactly as the audio export makes it) + every unmuted video clip's own sound
    let base = null;
    if (timelineSpec().clips.length){ const r = await API().timeline_files(timelineSpec(), cfg); if (!r.ok) throw new Error(r.error || '');
      const actx = new AudioContext({ sampleRate: 48000 }); base = await actx.decodeAudioData(Uint8Array.from(atob(wm ? r.b64_music : r.b64), c => c.charCodeAt(0)).buffer); actx.close(); }
    const SR = 48000, N = Math.max(base ? base.length : 0, Math.ceil(dur * SR)), L = new Float32Array(N), Rr = new Float32Array(N);
    if (base){ const b0 = base.getChannelData(0), b1 = base.numberOfChannels > 1 ? base.getChannelData(1) : b0, av = V.audioVol ?? 1;   // 175: the audio track's own volume over the whole audio composition
      if (av === 1){ L.set(b0.subarray(0, N)); Rr.set(b1.subarray(0, N)); } else { const n = Math.min(N, b0.length); for (let i = 0; i < n; i++){ L[i] = b0[i] * av; Rr[i] = b1[i] * av; } } }
    await mixVideoSounds(L, Rr, SR);
    const ch = 2, isGif = fmt === 'gif', mkv = fmt === 'mkv', ebml = fmt === 'webm' || mkv, target = isGif ? { buffer: null } : (ebml ? new WebMMuxer.ArrayBufferTarget() : new Mp4Muxer.ArrayBufferTarget());   // 170: mp4 · webm · gif — 175: mov · mkv
    const muxer = isGif ? { addVideoChunk(){}, addAudioChunk(){}, addAudioChunkRaw(){}, finalize(){} }
      : ebml ? new WebMMuxer.Muxer({ target, type: mkv ? 'matroska' : 'webm', video: { codec: MKV_V[vc[0]] || 'V_VP9', width: W, height: H, frameRate: fps }, audio: ac ? { codec: ac[0] === 'aac' ? 'A_AAC' : 'A_OPUS', numberOfChannels: ch, sampleRate: SR } : (mkv ? { codec: 'A_MPEG/L3', numberOfChannels: ch, sampleRate: SR } : undefined), firstTimestampBehavior: 'offset' })
      : new Mp4Muxer.Muxer({ target, video: { codec: vc[0], width: W, height: H, frameRate: fps }, audio: { codec: ac ? ac[0] : 'mp3', numberOfChannels: ch, sampleRate: SR }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    const gif = isGif ? gifBegin(W, H, fps) : null;
    const venc = isGif ? { encode(){}, flush: async () => {}, encodeQueueSize: 0, configure(){} } : new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => { err = e; } });
    venc.configure({ codec: vc[1], width: W, height: H, bitrate: BR(W, H, fps), framerate: fps, latencyMode: 'quality', ...(vc[0] === 'avc' ? { avc: { format: 'avc' } } : {}) });
    let audioFlush = async () => {};
    if (ac){
      const asc = aacASC(SR, ch);
      const aenc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, ac[0] === 'aac' ? { decoderConfig: { codec: 'mp4a.40.2', sampleRate: SR, numberOfChannels: ch, description: asc } } : m), error: e => { err = e; } });
      aenc.configure({ codec: ac[1], sampleRate: SR, numberOfChannels: ch, bitrate: 192000 });
      for (let i = 0; i < N; i += 8192){ const n = Math.min(8192, N - i), data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(Rr.subarray(i, i + n), n);
        aenc.encode(new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / SR * 1e6), data })); }
      audioFlush = () => aenc.flush();
    } else if (fmt === 'mp4' || fmt === 'mov' || mkv) {
      // macOS before Safari 26 has no AudioEncoder: the engine encodes the mix as MP3; its frames go into the MP4
      prog(0.01, T('صدا به MP3 تبدیل می‌شود…', 'Encoding the audio as MP3…'));
      const job = (await API().mp3_begin(SR, 2)).job;
      for (let i = 0; i < N; i += SR * 4){ const n = Math.min(SR * 4, N - i), pcm = new Int16Array(n * 2);
        for (let k = 0; k < n; k++){ pcm[2 * k] = Math.max(-32768, Math.min(32767, Math.round(L[i + k] * 32767))); pcm[2 * k + 1] = Math.max(-32768, Math.min(32767, Math.round(Rr[i + k] * 32767))); }
        await API().mp3_chunk(job, u8b64(new Uint8Array(pcm.buffer))); }
      const m3 = await API().mp3_end(job); if (!m3.ok) throw new Error(m3.error || '');
      mp3Frames(Uint8Array.from(atob(m3.b64), c => c.charCodeAt(0))).forEach((f, k) => mkv ? muxer.addAudioChunkRaw(new Uint8Array(f.data), 'key', Math.round(k * f.spf / f.sr * 1e6))   /* Matroska: A_MPEG/L3, no codec private */
        : muxer.addAudioChunkRaw(new Uint8Array(f.data), 'key', Math.round(k * f.spf / f.sr * 1e6), Math.round(f.spf / f.sr * 1e6), k === 0 ? { decoderConfig: { codec: 'mp3', sampleRate: f.sr, numberOfChannels: 2 } } : undefined));
    }
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'), total = Math.max(1, Math.ceil(dur * fps)), t0 = performance.now();
    for (let i = 0; i < total; i++){
      if (vExp.cancel) throw new Error('cancelled'); if (err) throw err;
      await vFrame(ctx, W, H, i / fps, true); if (isGif) gif.frame(cv, i); else { const fr = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(fr, { keyFrame: i % (fps * 2) === 0 }); fr.close(); } while (venc.encodeQueueSize > 6) await new Promise(q => setTimeout(q, 2));
      if (i % 5 === 0){ const el = (performance.now() - t0) / 1000, left = el / (i + 1) * (total - i - 1); prog(0.02 + 0.93 * i / total, T(`فریمِ ${FA(i + 1)} از ${FA(total)} — حدودِ ${FA(Math.ceil(left))} ثانیه مانده`, `Frame ${i + 1} of ${total} — about ${Math.ceil(left)} s left`)); }
    }
    await venc.flush(); await audioFlush(); if (err) throw err; muxer.finalize(); const out = isGif ? gif.finish() : fmt === 'mov' ? toQuickTime(new Uint8Array(target.buffer)) : new Uint8Array(target.buffer);
    prog(0.96, T('ذخیره می‌شود…', 'Saving…'));
    const so = await API().video_save_open('Avaye-Javid-Shah.' + fmt); if (!so.ok){ if (so.error !== 'cancelled') throw new Error(so.error || ''); throw new Error('cancelled'); }
    for (let off = 0; off < out.length; off += 4 << 20){ const ok = await API().video_save_chunk(so.job, u8b64(out.subarray(off, off + (4 << 20)))); if (!ok.ok) throw new Error(ok.error || ''); prog(0.96 + 0.04 * off / out.length); }
    const sc = await API().video_save_close(so.job); prog(1, T('ذخیره شد: ', 'Saved: ') + (sc.path || '')); doneToast(T('ویدیو ساخته شد', 'Video exported'), sc.path || ''); setTimeout(() => { const d = $('vxDlg') || document.querySelector('dialog[open]'); if (d && d.open) d.close(); }, 1600);   // 171 say(T('ویدیو ذخیره شد: ', 'Video saved: ') + (sc.path || ''), 'ok');
    window.__lastVideo = { bytes: out.length, fmt, codecs: vc[0] + '+' + (ac ? ac[0] : isGif || fmt === 'webm' ? 'none' : 'mp3'), W, H, fps, frames: total };
  } catch (e) { const c = String(e.message || e) === 'cancelled'; $('vxInfo').textContent = c ? T('لغو شد.', 'Canceled.') : (e.message || String(e)); if (!c) say(e.message || String(e), 'err'); }
  finally { vExp = null; $('vxGo').disabled = false; }
}
// ---- each video clip's own sound (decoded once), mixed at its place, trim, loop and volume
const VSND = new Map();
async function videoSound(id){ if (VSND.has(id)) return VSND.get(id); let ab = null;
  try { const url = await assetUrl(id), buf = await (await fetch(url)).arrayBuffer(), ctx = new AudioContext({ sampleRate: 48000 }); try { ab = await ctx.decodeAudioData(buf); } catch (e) { ab = null; } ctx.close(); } catch (e) {}
  VSND.set(id, ab); return ab; }
async function mixVideoSounds(L, R, sr){
  for (const o of V.objects){ if (o.type === 'sfx'){ try { const b = await loadSfx(o.file), a = b.getChannelData(0), q = b.numberOfChannels > 1 ? b.getChannelData(1) : a, s0 = Math.round((o.start || 0) * sr), e0 = Math.min(L.length, Math.round((o.end ?? (o.start || 0) + b.duration) * sr)), g = o.gain ?? 1, ratio = b.sampleRate / sr; for (let i = s0; i < e0; i++){ const k2 = Math.round((o.trimIn || 0) * b.sampleRate) + Math.floor((i - s0) * ratio); if (k2 >= a.length) break; L[i] += a[k2] * g; R[i] += q[k2] * g; } } catch (err) {} continue; }   // 172: video-mode effects
     if (o.type !== 'video' || o.mute !== false) continue; const ab = await videoSound(o.asset); if (!ab) continue;
    const vol = o.volume ?? 1, s0 = Math.round((o.start || 0) * sr), e0 = Math.min(L.length, Math.round((o.end == null ? projEnd() : o.end) * sr)), a = ab.getChannelData(0), b = ab.numberOfChannels > 1 ? ab.getChannelData(1) : a, off = Math.round((o.trimIn || 0) * sr), n = a.length;
    for (let i = s0; i < e0; i++){ let k = off + (i - s0); if (k >= n){ if (!o.loop) break; k %= n; } L[i] += a[k] * vol; R[i] += b[k] * vol; } }
}
// ---- MP3 frames (for the older-macOS export path)
function mp3Frames(u8){
  const out = []; let i = 0; if (u8[0] === 0x49 && u8[1] === 0x44 && u8[2] === 0x33) i = 10 + (((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f));
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], SRT = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  while (i + 4 <= u8.length){ if (u8[i] !== 0xFF || (u8[i + 1] & 0xE0) !== 0xE0){ i++; continue; }
    const ver = (u8[i + 1] >> 3) & 3, layer = (u8[i + 1] >> 1) & 3, bri = u8[i + 2] >> 4, sri = (u8[i + 2] >> 2) & 3, pad = (u8[i + 2] >> 1) & 1;
    if (layer !== 1 || bri === 0 || bri === 15 || sri === 3 || ver === 1){ i++; continue; }
    const sr = SRT[ver][sri], br = (ver === 3 ? BR1 : BR2)[bri] * 1000, spf = ver === 3 ? 1152 : 576, len = Math.floor((ver === 3 ? 144 : 72) * br / sr) + pad;
    if (len < 4 || i + len > u8.length) break; out.push({ data: u8.subarray(i, i + len), sr, spf }); i += len; }
  return out;
}
// ---- start-up
function vInit(){
  document.body.classList.add('mode-audio');
  const aside = $('vinsp') && $('vinsp').parentElement; if (aside) [...aside.children].forEach(ch => { if (ch.id !== 'vinsp') ch.classList.add('audio-only'); });
  // 164: the script toolbar (voice it, tags, tones, direction) belongs to the audio tab only
  const ea = $('editorArea'), gb = $('genBtn'); if (ea && gb){ let el = gb; while (el.parentElement && el.parentElement !== ea.parentElement) el = el.parentElement; if (el !== ea && el.parentElement === ea.parentElement) el.classList.add('audio-only'); }
  if ($('vover')) wireStage();
}
vInit();


// =====================================================================================
// 165 · THE VIDEO TAB, REBUILT FROM THE MOCK — its own panels (transplanted verbatim), its toolbar and object
//       bar, and its timeline: the SAME timeline component with video tracks — subtitles on top, object and
//       background layers (drag the grip to restack, drag clips between layers), the audio as one track below.
// =====================================================================================
Object.defineProperty(window, 'POD', { get: () => V.pod, configurable: true });   // the mock's inline handlers write POD.*
const VICON = { bg: 'clapperboard', sfx: 'sparkles', sub: 'captions', obj: 'layers', vid: 'clapperboard', mix: 'audio-lines' };
const VADD = { sfx: [['sfx', 'افکتِ صوتی از کتابخانه…', 'A sound effect from the library…']], sub: [['subs', 'زیرنویسِ تازه', 'New subtitle']], obj: [['text', 'متن', 'Text'], ['pimage', 'تصویر روی ویدیو', 'Picture on top'], ['pvideo', 'ویدیو روی ویدیو', 'Video on top'], ['sticker', 'استیکر', 'Sticker'], ['podtpl', 'قالبِ پادکست', 'Podcast template'], ['sfx', 'افکتِ صوتی…', 'Sound effect…']],
  bg: [['bgvideo', 'ویدیو', 'Video'], ['bgimage', 'تصویر', 'Image'], ['slideshow', 'اسلایدشو', 'Slideshow'], ['podcast', 'سبکِ پادکست', 'Podcast style']], vid: [], mix: [] };
let vTouchT = null;
function vTouch(){ VVER++; vDraw(); autosave(); }   // 177: the undo step is taken BEFORE a change (the inspector's own mark); this recorded the state after it, so undo seemed to do nothing
function renderPod(){ vTouch(); renderPodUI(); }
function paintOverlay(){ vTouch(); }
// ---- layers: the track order IS the stacking order (top of the list = front)
function ensureLayers(){
  if (!Array.isArray(V.layers)) V.layers = [];
  const known = new Set(V.layers.flatMap(l => l.items));
  V.objects.forEach(o => { if (known.has(o.id)) return; const kind = 'obj';   // 172: one kind of video track — any object on any layer
    let L = V.layers.find(l => l.kind === kind && !l.items.some(id => { const x = objById(id); return x && overlap(x, o); }));
    if (!L){ L = { id: 'L' + (++uid), kind, name: kind === 'vid' ? T('پس‌زمینه', 'Background') : T('لایه', 'Layer'), en: kind === 'vid' ? 'Background' : 'Layer', items: [] }; if (kind === 'obj') V.layers.unshift(L); else V.layers.push(L); }
    L.items.push(o.id); });
  V.layers.forEach(l => l.items = l.items.filter((id, i, all) => objById(id) && all.indexOf(id) === i)); V.layers = V.layers.filter(l => l.items.length || l.keep);   // 179: never twice in a layer
  V.layers.forEach(l => { if (l.kind === 'vid'){ l.kind = 'obj'; l.name = 'لایه'; l.en = 'Layer'; } });
}
const overlap = (a, b) => (a.start || 0) < (b.end == null ? projEnd() : b.end) && (b.start || 0) < (a.end == null ? projEnd() : a.end);
function layerOf(id){ ensureLayers(); return V.layers.find(l => l.items.includes(id)) || {}; }
function zOrder(){ ensureLayers(); return [...V.layers].reverse().flatMap(l => l.items.map(objById).filter(Boolean)); }
function vTracks(){ ensureLayers(); return [{ kind: 'sub', id: 'SUB', name: 'زیرنویس', en: 'Subtitles' }, ...V.layers, { kind: 'mix', id: 'MIX', name: 'صدا', en: 'Audio' }]; }   // 170: effects in video mode too
// ---- the timeline in video mode (same component, same ruler and playhead)
const _rtAudio = renderTimeline;
renderTimeline = function(){ if (mode !== 'video') return _rtAudio(); renderVideoTimeline(); requestAnimationFrame(() => { alignRuler(); seekVisual(playhead); }); };
function renderVTL(){ if (mode === 'video') renderTimeline(); }
function vBars(n, seed){ let s = seed, out = ''; for (let i = 0; i < n; i++){ s = (s * 9301 + 49297) % 233280; out += `<i class="block flex-1 rounded-[1px] bg-current opacity-40" style="height:${20 + Math.round(s / 233280 * 60)}%"></i>`; } return out; }
function renderVideoTimeline(){
  const TR = vTracks(), pps = zoom, end = projEnd(), sc = $('tlScroll'), span = Math.max(end, (((sc.clientWidth - $('heads').offsetWidth) || 0) - PAD - 1) / pps), W = PAD + span * pps + tailPx();
  $('heads').innerHTML = TR.map((t, i) => { const layer = t.kind === 'obj';   // 174: only regular tracks reorder
    return `<div class="flex h-14 items-center pe-2" data-ti="${i}"><div class="flex h-11 w-full items-center gap-1 rounded-box bg-base-100/50 px-1.5 text-xs">
      ${layer ? `<span class="tgrip grid size-6 cursor-grab place-items-center rounded text-base-content/40 hover:bg-base-300" data-tip="بکشید تا ترتیبِ لایه‌ها عوض شود" data-tip-en="Drag to restack the layers"><svg class="size-4"><use href="#i-grip-horizontal"/></svg></span>`
        : `<span class="grid size-6 cursor-not-allowed place-items-center rounded text-base-content/15" data-tip="${t.kind === 'sub' ? 'زیرنویس همیشه بالای همهٔ لایه‌هاست' : 'صدا زیرِ لایه‌های تصویر می‌ماند'}" data-tip-en="${t.kind === 'sub' ? 'Subtitles always stay on top' : t.kind === 'bg' ? 'The background always sits right above the audio' : 'Audio stays below the picture layers'}"><svg class="size-4"><use href="#i-grip-horizontal"/></svg></span>`}
      <svg class="size-3.5 shrink-0 opacity-70"><use href="#i-${VICON[t.kind]}"/></svg><span class="ui flex-1 truncate font-semibold">${escapeHtml(T(t.name, t.en))}</span>
      ${layer || t.kind === 'sub' ? `<button class="btn btn-ghost btn-xs btn-square ${(t.kind === 'sub' ? !V.subs.on : t.hidden) ? 'text-error' : ''}" onclick="vToggleTrack(${i})" data-tip="نمایش / پنهان" data-tip-en="Show / hide" aria-label="visibility"><svg class="size-3.5"><use href="#i-${(t.kind === 'sub' ? !V.subs.on : t.hidden) ? 'eye-off' : 'eye'}"/></svg></button>` : `<button class="btn btn-ghost btn-xs btn-square" onclick="setMode('audio')" data-tip="ویرایشِ صدا" data-tip-en="Edit the audio" aria-label="audio"><svg class="size-3.5"><use href="#i-pencil"/></svg></button>`}
      ${VADD[t.kind].length ? `<button class="btn btn-ghost btn-xs btn-square" onclick="openVTrackMenu(event, ${i})" aria-label="add"><svg class="size-4"><use href="#i-plus"/></svg></button>` : ''}</div></div>`; }).join('');
  const ticks = rulerTicks(span + (typeof tailPx === 'function' ? tailPx() / pps : 0), pps);   // 177: one ruler for both editors
  $('ruler').style.width = W + 'px';
  $('ruler').innerHTML = `<div class="tl-empty pointer-events-none absolute inset-y-0 z-0" style="left:${PAD + (typeof projEnd === 'function' ? projEnd() : projEnd()) * pps}px;right:0;background:color-mix(in oklab, var(--color-primary) 10%, transparent)"></div>` + ticks + `<span id="phStem" class="pointer-events-none absolute bottom-0 top-3 w-0.5 bg-secondary" style="left:${PAD + playhead * pps}px"></span><span id="phLabel" class="absolute top-0 z-10 cursor-ew-resize rounded-sm bg-secondary px-1 text-[10px] font-bold tabular-nums text-secondary-content" style="left:${PAD + playhead * pps - 22}px">${num(fmt(playhead))}</span>`;
  /* 176: a video clip is the audio clip — label on top, its length when selected, white trim handles beside it when selected */
  const hdl = (x, e, data, hw = 16) => `<span class="trimh vtrim absolute top-1.5 bottom-1.5 z-20 cursor-ew-resize" style="left:${x}px;width:${hw}px" data-e="${e}" ${data}><span class="pointer-events-none absolute top-1/2 h-[60%] w-[4px] -translate-y-1/2 rounded-full bg-white shadow-[0_0_4px_rgba(0,0,0,.6)] ${e === 's' ? 'right-[-6px]' : 'left-[-6px]'}"></span></span>`;   /* 178: the white bar inside the clip's edge */   /* 177: outside the clip, as in the audio editor */
  const clipEl = (cls, left, w, data, label, trims, extra = '', on = false, len = null, gl = 16, gr = 16) => { const ww = Math.max(6, w), wl = Math.max(6, Math.min(16, gl)), wr = Math.max(6, Math.min(16, gr));   /* 177: a handle narrows beside a touching neighbour */
    return `<div class="clip vclip absolute top-1.5 bottom-1.5 cursor-grab overflow-hidden rounded-field outline outline-1 ${cls}" style="left:${left}px;width:${ww}px" ${data}><span class="ui pointer-events-none absolute inset-x-1.5 top-0.5 z-[1] truncate text-[11px] font-semibold" dir="auto">${escapeHtml(label)}</span>${extra}${len != null && lenFits(ww, secs(len), extra.includes('data-trbadge') ? 16 : 0) ? `<span class="cliplen pointer-events-none absolute bottom-1 ${extra.includes('data-trbadge') ? 'right-[40px]' : 'right-6'} z-[2] rounded-md bg-black/60 px-1.5 text-[10px] font-semibold tabular-nums text-white">${secs(len)}</span>` : ''}</div>`
      + (on && trims ? hdl(left - wl, 's', data, wl) + hdl(left + ww, 'e', data, wr) : ''); };
  const lanes = TR.map((t, i) => { let c = '';
    if (t.kind === 'sub') cuesNow().forEach((q, k) => { const on = vSel === 'SUB' && V.subSel === k; c += clipEl(`bg-accent/15 text-accent ${on ? 'outline-2 outline-accent' : 'outline-accent/40'}`, PAD + q.at * pps, q.dur * pps - 2, `data-k="sub" data-i="${k}"`, q.text, false, q.fixed ? `<span class="badge badge-warning badge-xs pointer-events-none absolute bottom-1 left-1 gap-0.5" data-tip="${T('دستی اصلاح شده', 'corrected by hand')}"><svg class="size-2.5"><use href="#i-pencil"/></svg></span>` : '', on, q.dur); });
    else if (t.kind === 'sfx'){ const st = typeof sfxTrack === 'function' ? sfxTrack(false) : null; (st ? st.clips : []).forEach(x => { c += clipEl(`bg-accent/15 text-accent ${selClip === x.id ? 'outline-2 outline-accent' : 'outline-accent/40'}`, PAD + x.at * pps, (x.out - x.in) * pps - 2, `data-k="sfx" data-cid="${x.id}"`, x.name || '', false, '', false, x.out - x.in); }); }
    else if (t.kind === 'mix') c += clipEl('bg-base-content/5 text-base-content/60 outline-base-content/15', PAD, speechEnd() * pps, 'data-k="mix"', T('صدا — دوبار کلیک برای ویرایش', 'Audio — double-click to edit'), false, `<span class="pointer-events-none absolute inset-x-2 bottom-1 top-6 flex items-end gap-px">${vBars(Math.max(20, Math.round(speechEnd() * pps / 6)), 7)}</span>`, false, speechEnd());
    else t.items.map(objById).filter(Boolean).forEach(o => { const s0 = o.start || 0, e0 = o.end == null ? projEnd() : o.end, multi = typeof VMS !== 'undefined' && VMS.has(o.id), on = vSel === o.id || multi;
      /* 176: background clips, slideshow slides and everything else each in their own colour; a slide says «اسلایدشو» */
      const look = o.show ? 'bg-info/15 text-info' : o.bgl ? 'bg-secondary/15 text-secondary' : 'bg-primary/15 text-primary', ring = o.show ? 'outline-info!' : o.bgl ? 'outline-secondary!' : 'outline-primary!';
      const slides = o.show ? slidesOf(o.show) : null, label = o.show ? T('اسلایدشو', 'Slideshow') + ' · ' + num(slides.indexOf(o) + 1) + '/' + num(slides.length)
        : T((TYPE_NAME[o.type] || [o.type])[0], (TYPE_NAME[o.type] || [0, o.type])[1]) + (o.type === 'text' ? ' · ' + (o.text || '') : o.type === 'sticker' ? ' · ' + (o.emoji || '') : o.type === 'fx' ? ' · ' + ((AvaTrans.LIB[o.fx] || {}).name || o.fx) : o.type === 'sfx' ? ' · ' + sfxName(o) : '');
      const nx = o.bgl && o.trans && o.trans.type ? bgNextOf(o) : null, w0 = (e0 - s0) * pps - 2;
      const badge = nx && w0 > 40 ? `<span class="trbadge pointer-events-auto absolute bottom-1 right-[16px] z-[3] grid size-[18px] cursor-pointer place-items-center rounded-full" data-trbadge="${o.id}" data-tip="${escapeHtml(T('گذار: ', 'Transition: ') + trName(o.trans.type))}"><svg class="size-[11px]"><use href="#i-sparkles"/></svg></span>` : '';   /* inside its clip, clear of the trim handle */
      const same = t.items.map(objById).filter(x => x && x !== o), gl = same.reduce((g, x) => { const xe = x.end == null ? projEnd() : x.end; return xe <= s0 + 1e-6 ? Math.min(g, (s0 - xe) * pps) : g; }, 16), gr = same.reduce((g, x) => { const xs = x.start || 0; return xs >= e0 - 1e-6 ? Math.min(g, (xs - e0) * pps) : g; }, 16);
      c += clipEl(`${look} ${on ? 'outline-2 ' + ring : 'outline-current/40'} ${t.hidden ? 'opacity-40' : ''}`, PAD + s0 * pps, w0, `data-k="obj" data-id="${o.id}"`, label, true, badge, on && !(typeof VMS !== 'undefined' && VMS.size > 1), e0 - s0, gl, gr); });
    return `<div class="lane relative h-14 border-b border-base-300/40" data-ti="${i}">${c}</div>`; }).join('');
  $('lanes').style.width = W + 'px';
  $('lanes').innerHTML = lanes + `<div id="ph" class="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-secondary" style="left:${PAD + playhead * pps}px"></div>`;
  wireVideoTimeline(TR); placeVObjBar();
}
function vToggleTrack(i){ const t = vTracks()[i]; remember(); if (t.kind === 'sub') V.subs.on = !V.subs.on; else t.hidden = !t.hidden; renderTimeline(); vDraw(); autosave(); }
let LASTDOWN = { el: null, t: 0 };
function wireVideoTimeline(TR){
  $('ruler').onpointerdown = ev => { seekFromX(ev.clientX, ev.shiftKey); scrubbing(); };
  $('phLabel').onpointerdown = ev => { ev.stopPropagation(); scrubbing(); };
  const lanes = $('lanes');
  lanes.onpointerdown = ev => {
    const tb = ev.target.closest('[data-trbadge]'); if (tb){ ev.stopPropagation(); const o0 = objById(tb.dataset.trbadge); if (o0) openBgTab(o0.id, 'trans'); return; }   // 176: the indicator opens its clip's transition tab
    const hd = ev.target.closest('.vtrim'), r = lanes.getBoundingClientRect(), t = Math.max(0, (ev.clientX - r.left - PAD) / zoom);
    const el = hd ? lanes.querySelector(hd.dataset.k === 'sub' ? `.vclip[data-k="sub"][data-i="${hd.dataset.i}"]` : `.vclip[data-id="${hd.dataset.id}"]`) : ev.target.closest('.vclip');
    if (!el){ if (typeof vMarquee === 'function' && vMarquee(ev)) return; selectV(null); seek(t); return; }
    if (typeof vMultiDown === 'function' && vMultiDown(ev, el)) return;
    const k = el.dataset.k, now = performance.now(), dbl = LASTDOWN.el === (el.dataset.id || el.dataset.i || k) && now - LASTDOWN.t < 420; LASTDOWN = { el: el.dataset.id || el.dataset.i || k, t: dbl ? 0 : now };
    if (k === 'mix'){ if (dbl) return setMode('audio'); vSel = 'MIX'; seek(t); renderTimeline(); showMixPanel(); return; }   // 174: the audio track is selectable
    if (k === 'sfx'){ ev.stopPropagation(); const [st, c] = findClip(el.dataset.cid); if (!c) return; selClip = c.id; remember(); const x0 = ev.clientX, at0 = c.at; let moved = false;   // 170: effects move in video mode too
      const mv = e => { if (Math.abs(e.clientX - x0) > 2) moved = true; if (!moved) return; c.at = Math.max(0, snapT(at0 + (e.clientX - x0) / zoom, c)); el.style.left = (PAD + c.at * zoom) + 'px'; };
      const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (!moved) hist.past.pop(); st.clips.sort((a, b) => a.at - b.at); renderTimeline(); autosave(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); return; }   // two quick presses (the lanes redraw between clicks, so the browser's dblclick never fires)
    if (k === 'sub' && dbl){ ev.stopPropagation(); editSubOnTimeline(+el.dataset.i); return; }   // 176: a correction of the wording, kept with its line
    if (k === 'sub'){ ev.stopPropagation(); const ci = +el.dataset.i, q = cuesNow()[ci]; V.subSel = ci; vSel = 'SUB'; if (q && (playhead < q.at || playhead >= q.at + q.dur)) seek(q.at + Math.min(0.05, q.dur / 2)); showVPanels(); renderTimeline(); requestAnimationFrame(() => requestAnimationFrame(placeSelBox)); return; }
    ev.stopPropagation(); remember(); const trim = hd, x0 = ev.clientX, y0 = ev.clientY; let moved = false, hot = null;
    const o = objById(el.dataset.id); if (!o) return; if (vSel !== o.id) selectV(o.id);
    const s0 = o.start || 0, e0 = o.end == null ? projEnd() : o.end, from = layerOf(o.id), tin0 = o.trimIn || 0;
    const group = o.show ? slidesOf(o.show) : null, live = () => { (group || [o]).forEach(x => { const ex = lanes.querySelector(`.vclip[data-id="${x.id}"]`); if (ex){ ex.style.left = (PAD + (x.start || 0) * zoom) + 'px'; ex.style.width = Math.max(6, (((x.end == null ? projEnd() : x.end) - (x.start || 0)) * zoom - 2)) + 'px'; } });
      lanes.querySelectorAll(`.vtrim[data-id="${o.id}"]`).forEach(hx => { const ex = lanes.querySelector(`.vclip[data-id="${o.id}"]`); if (ex) hx.style.left = (hx.dataset.e === 's' ? parseFloat(ex.style.left) - (hx.offsetWidth || 16) : parseFloat(ex.style.left) + parseFloat(ex.style.width)) + 'px';   /* 177 */ }); };
    const mv = e => { const d = (e.clientX - x0) / zoom; if (Math.abs(e.clientX - x0) > 2 || Math.abs(e.clientY - y0) > 6) moved = true; if (!moved) return;
      const snap = t => { let best = t, bd = 8; vSnapEdges(o).forEach(ed => { const dd = Math.abs((t - ed) * zoom); if (dd < bd){ bd = dd; best = ed; } }); return best; };   // 170: bars snap to every edge
      if (o.show && slideEdit(o, trim ? trim.dataset.e : null, s0, e0, d)){ live(); return; }   // 175: a slide edits within its slideshow; 176: its neighbours follow live
      if (trim && trim.dataset.e === 's'){ const media = o.type === 'video' || o.type === 'sfx'; o.start = Math.max(media ? Math.max(0, s0 - tin0) : 0, Math.min(e0 - 0.2, snap(s0 + d))); if (media) o.trimIn = tin0 + (o.start - s0); }   // 176: never before the source's first frame
      else if (trim){ o.end = Math.max(s0 + 0.2, snap(e0 + d)); const lim = srcLen(o); if (lim) o.end = Math.min(o.end, (o.start || 0) + lim - (o.trimIn || 0)); }   // … nor past its last else { let ns = Math.max(0, s0 + d); const a1 = snap(ns), b1 = snap(ns + (e0 - s0)) - (e0 - s0); ns = Math.abs(a1 - ns) <= Math.abs(b1 - ns) ? a1 : b1; o.start = Math.max(0, ns); o.end = o.start + (e0 - s0); }
      live();
      if (!trim){ el.style.pointerEvents = 'none'; el.style.zIndex = 30; el.style.transform = `translateY(${e.clientY - y0}px)`; const ln = document.elementFromPoint(e.clientX, e.clientY), lane = ln && ln.closest('.lane');
        if (hot && hot !== lane) hot.classList.remove('lane-hot'); const tt = lane && TR[+lane.dataset.ti]; hot = tt && tt.kind === from.kind ? lane : null; if (hot) hot.classList.add('lane-hot'); } };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); const tgt = hot ? TR[+hot.dataset.ti] : null; if (hot) hot.classList.remove('lane-hot');
      if (!moved){ hist.past.pop(); return; }
      if (o.show){ slideDrop(o); ensureLayers(); dropOrphanTrans(); renderTimeline(); vDraw(); autosave(); showVPanels(); return; }   // 175: a slide stays in its slideshow
      if (tgt && tgt !== from){ from.items = from.items.filter(id => id !== o.id);
        if (tgt.items.some(id => { const x = objById(id); return x && x !== o && overlap(x, o); })){ const nl = { id: 'L' + (++uid), kind: tgt.kind, name: tgt.name, en: tgt.en, items: [o.id] }; V.layers.splice(V.layers.indexOf(tgt), 0, nl); }   // occupied → a new layer on top of it
        else tgt.items.push(o.id); }
      ensureLayers(); dropOrphanTrans(); renderTimeline(); vDraw(); autosave(); showVPanels(); };   // 176: a transition whose neighbour moved away goes
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  lanes.ondblclick = async e => { const hit = document.elementFromPoint(e.clientX, e.clientY), el = e.target.closest('.vclip') || (hit && hit.closest('.vclip')); if (!el) return; if (el.dataset.k === 'mix') return setMode('audio');   // the first click may have redrawn the lanes
    if (el.dataset.k === 'sub') editSubOnTimeline(+el.dataset.i); };
  document.querySelectorAll('#heads .tgrip').forEach(g => g.onpointerdown = ev => {   // restack layers by their grip
    ev.preventDefault(); const row = g.closest('[data-ti]'), i0 = +row.dataset.ti, t0 = TR[i0]; let tgt = i0;
    // 170: a ghost of the row follows the pointer, a drop line marks where it lands, the lane under it lights up
    const ghost = row.cloneNode(true), rr = row.getBoundingClientRect(); ghost.className = 'drag-ghost'; Object.assign(ghost.style, { position: 'fixed', left: rr.left + 'px', top: rr.top + 'px', width: rr.width + 'px', zIndex: 1200, pointerEvents: 'none', opacity: 0.9 }); document.body.appendChild(ghost); row.classList.add('drag-src');
    const line = document.createElement('div'); line.className = 'drop-line'; $('heads').appendChild(line); const y0 = ev.clientY;
    const mv = e => { ghost.style.transform = `translateY(${e.clientY - y0}px)`; const el = document.elementFromPoint(e.clientX, e.clientY), r2 = el && el.closest('#heads [data-ti]'); document.querySelectorAll('#heads [data-ti], #lanes .lane').forEach(x => x.classList.remove('lane-hot'));
      if (r2 && (TR[+r2.dataset.ti].kind === 'obj' && t0.kind === 'obj')){ tgt = +r2.dataset.ti; r2.classList.add('lane-hot'); const ln = document.querySelector(`#lanes .lane[data-ti="${tgt}"]`); if (ln) ln.classList.add('lane-hot'); const b2 = r2.getBoundingClientRect(), hb = $('heads').getBoundingClientRect(); line.style.top = ((tgt < i0 ? b2.top : b2.bottom) - hb.top + $('heads').scrollTop) + 'px'; line.classList.add('on'); } else line.classList.remove('on'); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); ghost.remove(); line.remove(); row.classList.remove('drag-src'); document.querySelectorAll('#heads [data-ti], #lanes .lane').forEach(x => x.classList.remove('lane-hot'));
      if (tgt !== i0){ remember(); const a = V.layers.indexOf(t0), b = V.layers.indexOf(TR[tgt]); V.layers.splice(a, 1); V.layers.splice(b, 0, t0); renderTimeline(); vDraw(); autosave(); } };
    addEventListener('pointermove', mv); addEventListener('pointerup', up); });
}
function openVTrackMenu(ev, i){
  ev.stopPropagation(); const t = vTracks()[i];
  lineMenu(ev.currentTarget, `<ul class="menu menu-sm w-full p-1">${VADD[t.kind].map(([k, fa, en]) => `<li><a data-vadd="${k}">${T(fa, en)}</a></li>`).join('')}</ul>`, e => {
    const a = e.target.closest('[data-vadd]'); if (!a) return; closeDD(); vAdd(a.dataset.vadd, t); });
}
function vAdd(kind, layer){
  const put = o => { o.start = playhead; o.end = Math.min(projEnd(), playhead + 5) > playhead + 0.5 ? Math.min(projEnd(), playhead + 5) : playhead + 5; remember(); V.objects.push(o); ensureLayers();
    const L = layerOf(o.id); if (layer && layer.items && L !== layer && layer.kind === 'obj' && !layer.items.some(id => overlap(objById(id), o))){ L.items = L.items.filter(x => x !== o.id); layer.items.push(o.id); ensureLayers(); }
    selectV(o.id); vChanged(); };
  if (kind === 'sfx') return openSfxLib();
  if (kind === 'subs'){ remember(); if (V.subs.follow){ V.subs.cues = cuesNow().map(q => ({ ...q })); V.subs.follow = false; } V.subs.cues.push({ at: playhead, dur: 2, text: T('زیرنویسِ تازه', 'New subtitle') }); V.subs.cues.sort((a, b) => a.at - b.at); V.subSel = V.subs.cues.findIndex(q => q.at === playhead); vSel = 'SUB'; renderTimeline(); showVPanels(); vDraw(); autosave(); return; }
  if (kind === 'text'){ const o = { id: 'o' + (++uid), ...TEXT0(), y: 0.2 }; hugText(o); put(o); fontsReady().then(() => { hugText(o); if (vSel === o.id){ placeSelBox(); fillXformOnly(); } }); return; }   /* 177: its box hugs its words from the start */
  if (kind === 'sticker') return put({ id: 'o' + (++uid), ...STICKER0() });
  if (kind === 'fx'){ const o = { id: 'o' + (++uid), ...FX0() }; put(o); o.end = o.start + 1.2; vChanged(); return; }   // 170: a transition lasts 1.2 s by default
  if (kind === 'podcast'){ const s = bgEnd(); return put({ id: 'o' + (++uid), type: 'pod', bgl: true, x: 0.06, y: 0.26, w: 0.88, h: 0.52, rot: 0, opacity: 1, start: s, end: Math.max(s + 5, projEnd()) }); }   // 174: podcast style = a background clip
  if (kind === 'podtpl') return put({ id: 'o' + (++uid), type: 'pod', tpl: true, x: 0.06, y: 0.26, w: 0.88, h: 0.52, rot: 0, opacity: 1, start: playhead });   // 174: the template — no background
  if (kind === 'bgimage' || kind === 'bgvideo') return pickBgMedia(kind === 'bgimage' ? 'image' : 'video');
  if (kind === 'slideshow') return addSlideshow();   // 175
  pickVMedia(kind === 'pimage' || kind === 'image' ? 'image' : 'video', false, kind === 'image' || kind === 'video');
}
// a full-frame background picture/video (the "video" layers) vs a picture-on-top
const _pickVMedia164 = pickVMedia;
pickVMedia = function(kind, replace, full){
  if (!full) return _pickVMedia164(kind, replace);
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = kind === 'video' ? 'video/*' : 'image/*';
  inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; setBusy(true);
    try { const id = await addAsset(f); await mediaEl(id); remember(); const o = { id: 'o' + (++uid), ...MEDIA0(kind, id), full: true, x: 0, y: 0, w: 1, h: 1, radius: 0, shadow: { on: false, color: '#000000', opacity: 0, angle: 90, distance: 0, blur: 0, spread: 0 }, start: playhead, end: null };
      V.objects.push(o); ensureLayers(); selectV(o.id); vChanged(); } catch (e) { say(e.message || String(e), 'err'); } finally { setBusy(false); } };
  inp.click();
}
// ---- the inspector: the mock's panels, shown and filled
const PANEL_OF = { text: 'iv-text', sticker: 'iv-sticker', pod: 'iv-pod', image: 'iv-pip', video: 'iv-pip', fx: 'iv-fx', sfx: 'iv-sfx' };
function fillVInsp(){ showVPanels(); }
function showVPanels(anim){
  if (!$('iv-proj')) return; const o = vSel && vSel !== 'SUB' ? objById(vSel) : null;
  ['iv-proj', 'iv-text', 'iv-sticker', 'iv-pod', 'iv-pip', 'iv-anim', 'iv-sub', 'iv-xform', 'iv-fx', 'iv-sfx', 'iv-mix'].forEach(id => $(id) && $(id).classList.add('hidden'));   /* 177: the audio track's panel too (it stayed under the next object's) */
  if (vSel === 'MIX'){ showMixPanel(); return; }
  if (anim && o){ $('iv-anim').classList.remove('hidden'); fillAnim(o); return; }
  if (vSel === 'SUB'){ $('iv-sub').classList.remove('hidden'); fillSub(); return; }
  if (!o){ $('iv-proj').classList.remove('hidden'); fillProj(); return; }
  $(PANEL_OF[o.type]).classList.remove('hidden'); $('iv-xform').classList.remove('hidden');
  if (o.type === 'fx'){ $('iv-xform').classList.add('hidden'); fillFx(o); return; }
  if (o.type === 'sfx'){ $('iv-xform').classList.add('hidden'); fillSfxObj(o); return; }   /* 175: a sound has no frame on the canvas */
  if (o.type === 'text') fillText(o); else if (o.type === 'sticker') fillSticker(o); else if (o.type === 'pod') renderPodUI(); else fillPip(o);
  fillXformOnly(); const lk = $('lockBtn'); if (lk) lk.classList.toggle('btn-active', o.lock !== false);
  posObjBar();
}
const radios = name => [...document.querySelectorAll(`#vinsp input[type=radio][name="${name}"]`)];
function bindRadios(name, values, cur, set){ radios(name).forEach((r, k) => { r.checked = values[k] === cur; r.onchange = () => { if (r.checked) set(values[k]); }; }); }
function bindRange(el, val, set){ if (!el) return; el.value = val; el.oninput = () => set(+el.value); el.dispatchEvent(new Event('rangeset')); }
function fillProj(){
  const p = $('iv-proj'), fps = p.querySelector('select'); [...fps.options].forEach((op, k) => op.value = ['30', '24', '60'][k]); fps.value = String(V.fps); fps.onchange = () => { vset('fps', +fps.value); }; enh(fps);
  CF.vBg = { get: () => V.bg || '#000000', set: c => { V.bg = c; }, def: '#000000' }; cfMount('vBgF', 'vBg', ['#000000', '#0c1230', '#ffffff']);   /* 179: black by default */   /* 177: a colour field with the three old choices as swatches */
  projFileShow();
}
function fillText(o){
  const p = $('iv-text'), [font, weight] = p.querySelectorAll('select'), size = p.querySelectorAll('input[type=range]')[0], pad = p.querySelectorAll('input[type=range]')[1];
  const badge = p.querySelector('.badge'); if (badge) badge.textContent = `${fmt(o.start || 0)} → ${o.end == null ? fmt(projEnd()) : fmt(o.end)}`;
  fillFontPick(font, weight, fontFam(o.font), o.weight || 900, f => { vset('sel.font', f); fillText(objById(vSel)); }, w => vset('sel.weight', w));
  bindRange(size, Math.round(o.size * 1080), v => vset('sel.size', v / 1080, true));
  bindRadios('ta', ['right', 'center', 'left'], o.align, v => vset('sel.align', v));
  bindRadios('tc', ['#ffffff', '#f2b233', '#e6a483'], o.color, v => vset('sel.color', v));
  const bg = $('bgOn'); bg.checked = !!(o.bg && o.bg.on); bg.onchange = () => vset('sel.bg.on', bg.checked);
  bindRadios('bs', ['round', 'capsule', 'brush'], o.bg.shape, v => vset('sel.bg.shape', v));
  bindRadios('bc', ['#f2b233', '#e9603b', '#000000'], o.bg.color, v => vset('sel.bg.color', v));
  bindRange(pad, Math.round((o.bg.pad || 0) * 1080), v => vset('sel.bg.pad', v / 1080, true));
}
function fillSticker(o){}   // 177: its size and rotation are in Size & position; the rest is filled by fillEmoji
function objRotate(kind, v){ const o = objById(vSel); if (!o) return; o.rot = v; vTouch(); placeSelBox(); fillXformOnly(); }
function toggleLock(){ const o = objById(vSel); if (!o) return; o.lock = o.lock === false; showVPanels(); }
function fillPip(o){   // 177: the inspector map — file · corners · opacity · stroke · shadow · (video) sound and loop
  const t = $('pipTitle'); if (t) t.textContent = o.type === 'video' ? T('ویدیو روی ویدیو', 'Video on top') : T('تصویر روی ویدیو', 'Picture on top');
  const st = o.stroke || {}, sh = o.shadow || {}; $('pipRad').value = Math.round((o.radius || 0) * 1080); $('pipOp').value = Math.round((o.opacity ?? 1) * 100);
  $('pipBorder').checked = !!st.on; $('pipSW').value = Math.max(1, Math.round((st.width || 0) * 1080)); $('pipSO').value = Math.round((st.opacity ?? 1) * 100);
  document.querySelectorAll('#pipSS input[name=pss]').forEach(r => { r.checked = r.dataset.v === (st.style || 'solid'); });
  $('pipShadow').checked = !!sh.on; $('pipHO').value = Math.round((sh.opacity ?? 0.45) * 100); $('pipHA').value = sh.angle ?? 90; $('pipHD').value = Math.round((sh.distance || 0) * 1080); $('pipHB').value = Math.round((sh.blur || 0) * 1080); $('pipHS').value = Math.round((sh.spread || 0) * 1080);
  $('pipStrokeOpts').classList.toggle('hidden', !st.on); $('pipShadowOpts').classList.toggle('hidden', !sh.on);
  CF.pipStroke = { get: () => ((objById(vSel) || o).stroke || {}).color || '#ffffff', set: c => { const x = objById(vSel); if (x){ x.stroke = x.stroke || {}; x.stroke.color = c; } }, def: '#ffffff' }; cfMount('pipSCF', 'pipStroke', true);
  CF.pipShadow = { get: () => ((objById(vSel) || o).shadow || {}).color || '#000000', set: c => { const x = objById(vSel); if (x){ x.shadow = x.shadow || {}; x.shadow.color = c; } }, def: '#000000' }; cfMount('pipHCF', 'pipShadow', true);
  const vid = $('pipVideo'); if (vid) vid.classList.toggle('hidden', o.type !== 'video'); $('pipMute').checked = o.mute !== false; $('pipLoop').checked = !!o.loop;
  $('pipVol').value = Math.round((o.volume ?? 1) * 100); $('pipVolF').classList.toggle('hidden', o.mute !== false);
  document.querySelectorAll('#iv-pip input[type=range]').forEach(r => r.dispatchEvent(new Event('rangeset')));
}
function pipSet(k, val){
  const o = objById(vSel); if (!o) return; const st = o.stroke = o.stroke || {}, sh = o.shadow = o.shadow || {};
  if (k === 'size'){ const r = o.h / o.w, cx = o.x + o.w / 2, cy = o.y + o.h / 2; o.w = val / 100; o.h = o.w * r; o.x = cx - o.w / 2; o.y = cy - o.h / 2; }
  else if (k === 'pos'){ placeOnGrid(val[0], val[1]); return; }
  else if (k === 'radius') o.radius = val / 1080; else if (k === 'opacity') o.opacity = val / 100; else if (k === 'volume') o.volume = val / 100; else if (k === 'border') st.on = val; else if (k === 'sColor') st.color = val; else if (k === 'sStyle') st.style = val; else if (k === 'sWidth') st.width = val / 1080; else if (k === 'sOpacity') st.opacity = val / 100;
  else if (k === 'shadow') sh.on = val; else if (k === 'hColor') sh.color = val; else if (k === 'hOpacity') sh.opacity = val / 100; else if (k === 'hAngle') sh.angle = val; else if (k === 'hDist') sh.distance = val / 1080; else if (k === 'hBlur') sh.blur = val / 1080; else if (k === 'hSpread') sh.spread = val / 1080;
  else if (k === 'mute') o.mute = val; else if (k === 'loop') o.loop = val;
  if (k === 'border' || k === 'shadow'){ $('pipStrokeOpts') && $('pipStrokeOpts').classList.toggle('hidden', !st.on); $('pipShadowOpts') && $('pipShadowOpts').classList.toggle('hidden', !sh.on); }
  if (k === 'mute' && $('pipVolF')) $('pipVolF').classList.toggle('hidden', val !== false);
  vTouch(); placeSelBox(); fillXformOnly();
}
function setBg(kind){ remember(); V.pod.bg = kind; vTouch(); renderPodUI(); autosave(); if ((kind === 'image' || kind === 'video') && !V.pod.bgAsset) pickVMedia('bg-' + kind); }
function renderPodUI(){   // 177: the inspector map — the podcast's own settings; background and overlay only on the background track
  if (!$('styleGrid')) return; const P = V.pod, o = objById(vSel), bgTrack = !!(o && o.type === 'pod' && o.bgl);
  const grad = k => { const c = k === 'custom' ? podPal(Object.assign({}, P, { pal: 'custom' })) : (PALS[k] || PALS.nil); return `linear-gradient(135deg, ${c[1]}, ${c[0]} 45%, ${c[2]})`; };
  $('styleGrid').innerHTML = STYLES.map(([n, st], k) => `<button class="btn h-auto min-h-0 flex-col gap-1 p-1 pb-1.5 ${P.style === k ? 'btn-primary' : 'border-base-content/10 bg-base-100'}" onclick="applyVStyle(${k})"><span class="block aspect-video w-full overflow-hidden rounded-[5px]">${podStyleSvg(st)}</span><span class="text-[11px] font-medium leading-normal">${escapeHtml(T(n, STYLE_EN[n] || n))}</span></button>`).join('');
  const lay = $('pLayout'); if (lay){ lay.value = P.layout === 'two' ? 'auto' : (P.layout || 'auto'); enh(lay); }
  $('waveGrid').innerHTML = WAVES.map(([k, n]) => `<input class="join-item btn btn-sm flex-1 border-base-content/15 bg-base-100 text-xs checked:bg-primary checked:text-primary-content" type="radio" name="wave" aria-label="${escapeHtml(T(n, WAVE_EN[k] || n))}" ${P.wave === k ? 'checked' : ''} onchange="podSet('wave', '${k}')">`).join('');
  fillAvatarOpts(P); fillLabelOpts(P);
  const rv = (id, v) => { const el = $(id); if (el){ el.value = v; el.dispatchEvent(new Event('rangeset')); } };
  rv('podSens', Math.round((P.sens ?? 0.6) * 100));
  $('podBgSec').classList.toggle('hidden', !bgTrack); $('podOvSec').classList.toggle('hidden', !bgTrack);
  if (bgTrack){
    document.querySelectorAll('#bgJoin input[name=bgt]').forEach(r => { r.checked = r.value === P.bg; });
    $('bgMesh').classList.toggle('hidden', P.bg !== 'mesh'); $('bgMedia').classList.toggle('hidden', !(P.bg === 'image' || P.bg === 'video')); $('bgSolid').classList.toggle('hidden', P.bg !== 'solid');
    $('palGrid').innerHTML = Object.keys(PALS).map(k => `<button class="size-7 rounded-full ring-offset-2 ring-offset-base-200 ${P.pal === k ? 'ring-2 ring-primary' : ''}" style="background:${grad(k)}" onclick="podSet('pal', '${k}')" aria-label="${k}"></button>`).join('')
      + `<button class="grid size-7 place-items-center rounded-full border border-dashed border-base-content/40 ring-offset-2 ring-offset-base-200 ${P.pal === 'custom' ? 'ring-2 ring-primary' : ''}" style="${P.pal === 'custom' ? `background:${grad('custom')}` : ''}" onclick="podSet('pal', 'custom')" data-tip="رنگ‌های خودم" data-tip-en="My own colors" aria-label="custom"><svg class="size-3.5"><use href="#i-plus"/></svg></button>`;
    const pc = $('palCustom'); pc.classList.toggle('hidden', P.pal !== 'custom');
    if (P.pal === 'custom'){ P.custom = P.custom || ['#1c2a74', '#2b3fb0', '#0c1230'];
      pc.innerHTML = [0, 1, 2].map(i => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T(['رنگِ اول', 'رنگِ دوم', 'رنگِ سوم'][i], ['First color', 'Second color', 'Third color'][i])}</legend><div id="podCustom${i}"></div></fieldset>`).join('');
      [0, 1, 2].forEach(i => { CF['podCustom' + i] = { get: () => (V.pod.custom || [])[i] || '#1c2a74', set: c => { V.pod.custom = (V.pod.custom || ['#1c2a74', '#2b3fb0', '#0c1230']).slice(); V.pod.custom[i] = c; }, def: ['#1c2a74', '#2b3fb0', '#0c1230'][i] }; cfMount('podCustom' + i, 'podCustom' + i, false); }); }
    rv('podWarp', Math.round((P.warp ?? 0.35) * 100)); rv('podSpeed', Math.round((P.drift ?? 1) * 100)); rv('podZoom', Math.round((P.zoom ?? 1) * 100)); rv('podDrift', Math.round((P.drift ?? 1) * 100)); rv('podGrain', Math.round((P.grain ?? 0.06) * 100));
    document.querySelectorAll('#bgMedia input[name=fit]').forEach(r => { r.checked = +r.value === (P.fit || 0); });
    $('posGrid').innerHTML = [-1, 0, 1].flatMap(y => [-1, 0, 1].map(x => `<input class="btn btn-xs btn-square border-base-content/15 bg-base-100 checked:bg-primary" type="radio" name="pos" aria-label="·" ${P.pos[0] === x && P.pos[1] === y ? 'checked' : ''} onchange="podSet('pos', [${x}, ${y}])">`)).join('');
    const mp = $('mediaPick'); if (mp) mp.textContent = P.bgAsset ? ((MEDIA.get(P.bgAsset) || {}).name || T('فایلِ انتخاب‌شده', 'The chosen file')) : T('انتخاب فایل…', 'Choose a file…');
    const mb = $('mediaPickBtn'); if (mb) mb.onclick = () => pickVMedia('bg-' + (P.bg === 'video' ? 'video' : 'image'));
    CF.podSolid = { get: () => V.pod.solid || V.bg || '#0c1230', set: c => { V.pod.solid = c; }, def: '#0c1230' }; cfMount('podSolidF', 'podSolid', false);
    CF.podOv = { get: () => V.pod.ovColor || '#000000', set: c => { V.pod.ovColor = c; }, def: '#000000' }; cfMount('podOvColorF', 'podOv', false);
    rv('podOvOp', Math.round((P.ovOp ?? 0.15) * 100)); $('podGradOn').checked = !!P.grad; $('podGradOpts').classList.toggle('hidden', !P.grad);
    const gd = $('podGradDir'); if (gd){ gd.value = P.gradDir || 'to top'; enh(gd); }
    CF.podGradA = { get: () => V.pod.gradA || '#05070f', set: c => { V.pod.gradA = c; }, def: '#05070f' }; cfMount('podGradAF', 'podGradA', false);
    CF.podGradB = { get: () => V.pod.gradB || '#1c2a74', set: c => { V.pod.gradB = c; }, def: '#1c2a74' }; cfMount('podGradBF', 'podGradB', false);
    rv('podGradOp', Math.round((P.gradOp ?? 0.7) * 100)); }
}
// one podcast setting changed: one undo step (a slider's drag is one step), the frame redrawn, the panel kept in step
var POD_LIVE = null;
function podSet(k, v, live){ if (live){ if (POD_LIVE !== k){ remember(); POD_LIVE = k; } } else { remember(); POD_LIVE = null; }
  V.pod[k] = v; vTouch(); if (!live || k === 'pal') renderPodUI(); autosave(); }
document.addEventListener('pointerup', () => { POD_LIVE = null; });
function fillAvatarOpts(P){ const box = $('avatarOpts'); if (!box) return; const AV = P.avatar || (P.avatar = { size: 1, ring: true });
  box.innerHTML = `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('اندازهٔ آواتار', 'Avatar size')}</legend><input type="range" data-unit="%" data-def="100" min="50" max="220" value="${Math.round((AV.size || 1) * 100)}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="podPath('avatar.size', +this.value / 100, true)"></fieldset>`
    + `<label class="flex w-full cursor-pointer items-center justify-between gap-3 text-sm"><span class="font-semibold">${T('حلقهٔ دورِ آواتار', 'Ring around the avatar')}</span><input type="checkbox" class="toggle toggle-sm toggle-primary" ${AV.ring !== false ? 'checked' : ''} onchange="podPath('avatar.ring', this.checked)"></label>`;
  if (typeof rangeLabels === 'function') rangeLabels(box); }
// ---- the floating object bar (the mock): animation, duplicate, bring forward, delete
// the object bar sits below the selection box (or well above it) — never over the rotation handle
function posObjBar(){ const b = $('objBar'), o = vSel && vSel !== 'SUB' ? objById(vSel) : null; if (!b) return; if (!o || mode !== 'video' || o.type === 'sfx' || (typeof VEDIT !== 'undefined' && VEDIT)){ b.classList.add('hidden'); return; }   /* 177: out of the way while typing */
  const sb = $('selbox').getBoundingClientRect(), st = $('stage').getBoundingClientRect(); b.classList.remove('hidden'); { const an = b.querySelector('[onclick="openAnim()"]'); if (an && an.parentElement) an.parentElement.classList.toggle('hidden', !animKind(o)); }   /* 175: only objects that animate */
  { const fw = b.querySelector('[onclick="vForward()"]'); if (fw && fw.parentElement) fw.parentElement.classList.toggle('hidden', !canForward(o)); }   /* 177: only when it can actually move forward */
  { const bh = b.offsetHeight || 40; let top;   /* 177: below the box, else above it (clear of the rotation handle), else — a box as big as the canvas — inside it at its foot; never over the app's top bar */
    if (sb.bottom + 12 + bh <= st.bottom - 4) top = sb.bottom + 12; else if (sb.top - 92 >= st.top + 4) top = sb.top - 92; else top = Math.max(st.top + 8, Math.min(sb.bottom, st.bottom) - bh - 12);
    b.style.top = top + 'px'; } b.style.left = Math.max(8, Math.min(innerWidth - b.offsetWidth - 8, sb.left + sb.width / 2 - b.offsetWidth / 2)) + 'px'; }
function vDuplicate(){ const o = objById(vSel); if (!o) return; remember(); const c = JSON.parse(JSON.stringify(o)); c.id = 'o' + (++uid); c.x = Math.min(0.95 - c.w, c.x + 0.03); c.y = Math.min(0.95 - c.h, c.y + 0.03); V.objects.push(c); const L = layerOf(o.id); ensureLayers(); const L2 = layerOf(c.id); if (L2 !== L && !L.items.some(id => overlap(objById(id), c))){ L2.items = L2.items.filter(x => x !== c.id); L.items.push(c.id); ensureLayers(); } selectV(c.id); vChanged(); }
// 177: an object can come forward only when a layer of its own kind sits above its layer (never on the background track)
function canForward(o){ if (!o || o.bgl) return false; const L = layerOf(o.id); const i = V.layers.indexOf(L); return !!(L && L.kind && L.kind !== 'bg' && i > 0 && V.layers[i - 1].kind === L.kind); }
function vForward(){ const o = objById(vSel); if (!canForward(o)) return; const L = layerOf(vSel); const i = V.layers.indexOf(L); remember(); V.layers.splice(i, 1); V.layers.splice(i - 1, 0, L); vChanged(); posObjBar(); }
function vDelete(){ const o = objById(vSel); if (!o) return; remember(); V.objects = V.objects.filter(x => x !== o); selectV(null); vChanged(); }
// 170: split the selected object at the playhead — the second half keeps playing from where the first stopped
function vSplit(){ const o = objById(vSel); if (!o) return;   /* 177: podcast clips split too (both halves draw the same podcast settings) */ const s0 = o.start || 0, e0 = o.end == null ? projEnd() : o.end;
  if (playhead <= s0 + 0.05 || playhead >= e0 - 0.05) return say(T('پلی‌هد باید داخلِ این شیء باشد.', 'The playhead must be inside this object.'), 'err');
  remember(); const c = JSON.parse(JSON.stringify(o)); c.id = 'o' + (++uid); c.start = playhead; c.end = o.end; if (o.type === 'video' || o.type === 'sfx') c.trimIn = (o.trimIn || 0) + (playhead - s0); o.end = playhead;
  if (o.trans){ delete o.trans; }   /* 179: a transition belongs to its clip's END — the second half keeps it (the first half's new end touches its own other half) */
  if (o.anim){ migrateAnim(o); migrateAnim(c); o.anim.out = 'none'; c.anim.in = 'none'; if (o.anim.bgOut) o.anim.bgOut = 'follow'; if (c.anim.bgIn) c.anim.bgIn = 'follow'; }   /* 175: the first half keeps In, the second keeps Out */
  const L = layerOf(o.id); V.objects.push(c); if (L && L.items && !L.items.includes(c.id)) L.items.splice(L.items.indexOf(o.id) + 1, 0, c.id); ensureLayers(); selectV(c.id); vChanged(); }   /* 179: the second half sat TWICE in its layer (drawn twice; its transition dropped as «orphaned») */
// 170: the timeline's own toolbar for the selected object bar (animate · duplicate · split · delete)
function placeVObjBar(){ const bar = $('clipBar'); if (!bar || mode !== 'video') return; const o = vSel && vSel !== 'SUB' ? objById(vSel) : null, el = o && document.querySelector(`#lanes .vclip[data-id="${o.id}"]`);
  if (!o || !el){ if (!selClip) bar.classList.add('hidden'); return; }
  const b = (icon, tip, fn, txt) => `<li><a onclick="${fn}" class="gap-1" ${txt ? '' : `data-tip="${tip}"`}><svg class="size-3.5"><use href="#i-${icon}"/></svg>${txt ? `<span class="ui">${txt}</span>` : ''}</a></li>`;
  bar.innerHTML = (animKind(o) ? b('sparkles', '', 'openAnim()', T('انیمیشن', 'Animation')) : '') + b('copy', T('تکثیر', 'duplicate'), 'vDuplicate()') + b('scissors', T('برش در جای پلی‌هد', 'split at the playhead'), 'vSplit()') + b('trash-2', T('حذف', 'delete'), 'vDelete()');
  const r = el.getBoundingClientRect(), sc = $('tlScroll').getBoundingClientRect(), left0 = sc.left + $('heads').offsetWidth;
  if (r.bottom < sc.top || r.top > sc.bottom || r.right < left0 || r.left > sc.right){ bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden'); const bh = bar.offsetHeight || 34; let top = r.top - bh - 6; if (top < sc.top - bh / 2) top = r.bottom + 6; bar.style.top = top + 'px'; bar.style.left = Math.min(innerWidth - bar.offsetWidth - 8, Math.max(left0, r.left)) + 'px'; }
// ---- selection: objects or the subtitle (double-click edits either on the canvas)
function selectV(id){ vSel = id; if (id && typeof sel !== 'undefined' && (sel.size || selClip)){ sel.clear(); selClip = null; paintSel(); }   // 170: one definition; a non-speech selection deselects everything else
  placeSelBox(); showVPanels(); renderTimeline(); placeVObjBar(); }
const _placeSelBox164 = placeSelBox;
placeSelBox = function(){
  const sb = $('selbox'); if (!sb) return;
  if (vSel === 'SUB' && SUBRECT && mode === 'video'){ sb.classList.remove('hidden'); Object.assign(sb.style, { left: SUBRECT.x * frameW + 'px', top: SUBRECT.y * frameH + 'px', width: SUBRECT.w * frameW + 'px', height: SUBRECT.h * frameH + 'px', transform: '' }); sb.querySelectorAll('[data-h], #vrot').forEach(x => x.classList.add('hidden')); $('objBar') && $('objBar').classList.add('hidden'); return; }
  sb.querySelectorAll('[data-h], #vrot').forEach(x => x.classList.remove('hidden')); _placeSelBox164(); posObjBar();
}
let SUBRECT = null;
const _hitTest164 = hitTest;
hitTest = function(nx, ny){ if (SUBRECT && V.subs.on && nx >= SUBRECT.x && nx <= SUBRECT.x + SUBRECT.w && ny >= SUBRECT.y && ny <= SUBRECT.y + SUBRECT.h){ const q = cuesNow().findIndex(c => playhead >= c.at && playhead < c.at + c.dur); if (q >= 0){ V.subSel = q; return 'SUB'; } } return _hitTest164(nx, ny); }
function editTextInPlace(){
  const ed = $('vtextEd'); if (vSel === 'SUB'){ if (!SUBRECT) return; if (V.subs.follow){ V.subs.cues = cuesNow().map(q => ({ ...q })); V.subs.follow = false; } const q = V.subs.cues[V.subSel]; if (!q) return;
    ed.classList.remove('hidden'); ed.innerText = q.text; Object.assign(ed.style, { left: SUBRECT.x * frameW + 'px', top: SUBRECT.y * frameH + 'px', width: SUBRECT.w * frameW + 'px', minHeight: SUBRECT.h * frameH + 'px', fontSize: (V.subs.sizePx || 46) / 1080 * frameH + 'px', fontWeight: V.subs.weight || 700, color: '#fff', textAlign: 'center', transform: '' });
    ed.focus(); document.getSelection().selectAllChildren(ed); ed.onblur = () => { remember(); q.text = ed.innerText.trim(); ed.classList.add('hidden'); renderTimeline(); vDraw(); autosave(); }; return; }
  const o = objById(vSel); if (!o || o.type !== 'text') return; ed.classList.remove('hidden'); ed.innerText = o.text;
  Object.assign(ed.style, { left: o.x * frameW + 'px', top: o.y * frameH + 'px', width: o.w * frameW + 'px', minHeight: o.h * frameH + 'px', fontSize: o.size * frameH + 'px', fontWeight: o.weight, color: o.color, textAlign: o.align, transform: `rotate(${o.rot || 0}deg)` });
  ed.focus(); document.getSelection().selectAllChildren(ed); ed.onblur = () => { remember(); o.text = ed.innerText.trim(); ed.classList.add('hidden'); vChanged(); };
}
// ---- subtitles: designs, animation, word highlight, speaker name — drawn by the same renderer as everything else
const SUB_PRESETS = [   // 169: today's caption styles (word timing from the spine; nothing invented)
  ['minimal', 'مینیمال', 'Minimal', { font: 'Vazirmatn', weight: 500, sizePx: 42, color: '#ffffff', hi: '#ffffff', bgOn: false, bgMode: 'box', bgOp: 0, outline: false, shadow: true, glow: false, gradient: false, band: false, anim: 'fade', hiMode: 'none', chunk: 0 }],
  ['bar', 'نوار', 'Bar', { font: 'Vazirmatn', weight: 600, sizePx: 44, color: '#ffffff', hi: '#e9603b', bgOn: true, bgMode: 'bar', bgOp: 0.6, outline: false, shadow: false, glow: false, gradient: false, band: false, anim: 'fade', hiMode: 'color', chunk: 0 }],
  ['card', 'کارت', 'Card', { font: 'Vazirmatn', weight: 700, sizePx: 44, color: '#161616', hi: '#e9603b', bgOn: true, bgMode: 'card', bgOp: 0.95, outline: false, shadow: true, glow: false, gradient: false, band: false, anim: 'rise', hiMode: 'color', chunk: 0 }],
  ['bold', 'برجسته', 'Bold highlight', { font: 'Vazirmatn', weight: 900, sizePx: 62, color: '#ffffff', hi: '#ffd60a', bgOn: false, bgMode: 'box', bgOp: 0, outline: true, shadow: true, glow: false, gradient: false, band: false, anim: 'none', hiMode: 'color', chunk: 3 }],
  ['karaoke', 'کاراوکه', 'Karaoke', { font: 'Vazirmatn', weight: 800, sizePx: 54, color: '#ffffff', hi: '#e9603b', bgOn: false, bgMode: 'box', bgOp: 0, outline: true, shadow: false, glow: false, gradient: false, band: false, anim: 'none', hiMode: 'fill', chunk: 4 }],
  ['pill', 'پیل', 'Pill', { font: 'Vazirmatn', weight: 800, sizePx: 52, color: '#ffffff', hi: '#e9603b', bgOn: false, bgMode: 'box', bgOp: 0, outline: false, shadow: true, glow: false, gradient: false, band: false, anim: 'none', hiMode: 'pill', chunk: 3 }],
  ['pop', 'پاپ', 'Word pop', { font: 'Vazirmatn', weight: 900, sizePx: 70, color: '#ffffff', hi: '#ffd60a', bgOn: false, bgMode: 'box', bgOp: 0, outline: true, shadow: false, glow: false, gradient: false, band: false, anim: 'popword', hiMode: 'color', chunk: 1 }],
  ['bounce', 'پرش', 'Bounce', { font: 'Vazirmatn', weight: 900, sizePx: 58, color: '#ffffff', hi: '#e9603b', bgOn: false, bgMode: 'box', bgOp: 0, outline: true, shadow: true, glow: false, gradient: false, band: false, anim: 'popword', hiMode: 'scale', chunk: 2 }],
  ['neon', 'نئون', 'Neon', { font: 'Vazirmatn', weight: 800, sizePx: 52, color: '#ffffff', hi: '#e9603b', bgOn: false, bgMode: 'box', bgOp: 0, outline: false, shadow: false, glow: true, gradient: false, band: false, anim: 'fade', hiMode: 'color', chunk: 0 }],
  ['gradient', 'گرادیان', 'Gradient', { font: 'Vazirmatn', weight: 900, sizePx: 56, color: '#ffffff', hi: '#e9603b', bgOn: false, bgMode: 'box', bgOp: 0, outline: false, shadow: true, glow: false, gradient: true, band: false, anim: 'pop', hiMode: 'none', chunk: 0 }],
  ['typewriter', 'تایپی', 'Typewriter', { font: 'Vazirmatn', weight: 700, sizePx: 46, color: '#ffffff', hi: '#e9603b', bgOn: true, bgMode: 'box', bgOp: 0.4, outline: false, shadow: false, glow: false, gradient: false, band: false, anim: 'type', hiMode: 'none', chunk: 0 }],
  ['cinematic', 'سینمایی', 'Cinematic', { font: 'Vazirmatn', weight: 400, sizePx: 38, color: '#f5efe6', hi: '#f5efe6', bgOn: false, bgMode: 'box', bgOp: 0, outline: false, shadow: true, glow: false, gradient: false, band: true, anim: 'fade', hiMode: 'none', chunk: 0 }]];
const SUB_COLORS = ['#ffffff', '#f2b233', '#e6a483', '#e9603b', '#000000'];
function fillSub(){
  const s = V.subs, q = cuesNow()[V.subSel]; $('subTime').textContent = q ? `${fmt(q.at)} → ${fmt(q.at + q.dur)}` : '';
  $('subPresets').innerHTML = SUB_PRESETS.map(([k, fa, en, p]) => `<button class="btn h-auto flex-col gap-1 p-1 ${s.preset === k ? 'btn-primary' : 'border-base-content/10 bg-base-100'}" onclick="subPreset('${k}')"><span class="grid h-9 w-full place-items-center rounded-field bg-[#0c1230]"><span class="rounded px-1 text-[11px] leading-normal" style="font-weight:${p.weight};color:${p.color};${p.bgOn ? `background:rgba(0,0,0,${p.capsule ? 0 : p.bgOp})` : ''};${p.capsule ? 'background:var(--color-primary);border-radius:999px;padding:0 .5em' : ''};${p.outline ? 'text-shadow:0 0 2px #000,0 0 2px #000' : ''}">${p.anim === 'word' ? T('سلام', 'Hello') + ' <b style="color:' + p.hi + '">' + T('دوست', 'friend') + '</b>' : T('سلام دوست', 'Hello friend')}</span></span><span class="text-[11px]">${T(fa, en)}</span></button>`).join('');
  const sw = (box, key) => { $(box).innerHTML = SUB_COLORS.map(c => `<input type="radio" name="${box}" class="radio radio-sm border-0 checked:border-0" style="background:${c}" ${s[key] === c ? 'checked' : ''} onchange="subSet('${key}', '${c}')" aria-label="${c}">`).join(''); };
  sw('subTextColors', 'color'); sw('subHiColors', 'hi');
  const font = $('subFont'), wt = $('subWeight'), an = $('subAnim'); an.value = s.anim || 'fade';
  fillFontPick(font, wt, fontFam(s.font), s.weight || 700, f => { subSet('font', f); fillSub(); }, w => subSet('weight', w)); an.onchange = () => subSet('anim', an.value); enh(an);
  bindRange($('subSize'), s.sizePx || 46, v => subSet('sizePx', v, true)); bindRange($('subBgOp'), Math.round((s.bgOp ?? 0.55) * 100), v => subSet('bgOp', v / 100, true));
  bindRadios('sp', ['top', 'middle', 'bottom'], s.place || 'bottom', v => subSet('place', v));
  [['subChunk', 'chunk', 0], ['subHiMode', 'hiMode', 'none'], ['subBgMode', 'bgMode', 'box']].forEach(([id, key, d]) => { const el = $(id); if (!el) return; el.value = String(s[key] ?? d); el.onchange = () => subSet(key, key === 'chunk' ? +el.value : el.value); enh(el); });   // 169
  [['subBgOn', 'bgOn'], ['subOutline', 'outline'], ['subShadow', 'shadow'], ['subGlow', 'glow'], ['subSpk', 'spk'], ['subFollow', 'follow']].forEach(([id, key]) => { const el = $(id); el.checked = !!s[key]; el.onchange = () => { subSet(key, el.checked); if (key === 'follow' && el.checked) resyncSubs(); }; });
}
function subPreset(k){ const p = SUB_PRESETS.find(x => x[0] === k); if (!p) return; remember(); Object.assign(V.subs, p[3], { preset: k }); VVER++; fillSub(); vDraw(); autosave(); }
function subSet(key, val, live){ if (!live) remember(); V.subs[key] = val; if (!live) V.subs.preset = V.subs.preset; vDraw(); autosave(); if (!live) fillSub(); }
function cueWords(q){ if (q.words && q.words.length) return q.words; const ws = q.text.split(/\s+/).filter(Boolean), tot = ws.reduce((a, w) => a + w.length + 1, 0); let acc = 0; return ws.map(w => { const a = q.at + q.dur * acc / tot; acc += w.length + 1; return { w, t0: a, t1: q.at + q.dur * acc / tot }; }); }   // 169: the spine when there is one
function drawSubs(ctx, W, H, t){
  // 169: the caption renderer — words laid out one by one (right to left) so the spoken word can be coloured, filled,
  //      pilled, scaled or popped on its REAL time; backgrounds as box / bar / card / capsule; shadow, glow, gradient,
  //      a cinematic band; the box (SUBRECT) hugs exactly what was drawn.
  const s = V.subs; SUBRECT = null; if (!s.on) return; const cues = cuesNow(), qi = cues.findIndex(c => t >= c.at && t < c.at + c.dur); if (qi < 0) return; const q = cues[qi];
  const px = (s.sizePx || Math.round((s.size || 0.042) * 1080)) / 1080 * H, an = s.anim || 'fade', k = Math.min(1, (t - q.at) / 0.25), hiMode = s.hiMode || 'none', prim = s.hi || '#f2b233';
  ctx.save(); ctx.font = FONT(s.weight || 700, px, s.font); ctx.direction = 'rtl'; ctx.textBaseline = 'middle';
  const words = cueWords(q), curW = words.findIndex(w => t >= w.t0 && t < w.t1), shownN = an === 'type' ? Math.max(1, words.filter(w => w.t0 <= t).length) : words.length;
  const spkName = subSpkOn(s) ? (() => { const sp = q.spk ? spkList().find(z => z.id === q.spk) : null; return sp ? sp.name + ':' : ''; })() : '';
  // lay the words out in lines, right to left
  const sp = ctx.measureText(' ').width, maxW = W * 0.84, items = (spkName ? [{ w: spkName, name: true }] : []).concat(words.slice(0, shownN).map((w, i) => ({ ...w, i })));
  items.forEach(it => { it.tw = ctx.measureText(it.w).width; });
  const lines = []; let cur = [], cw = 0;
  items.forEach(it => { const add = (cur.length ? sp : 0) + it.tw; if (cur.length && cw + add > maxW){ lines.push({ items: cur, w: cw }); cur = [it]; cw = it.tw; } else { cur.push(it); cw += add; } });
  if (cur.length) lines.push({ items: cur, w: cw });
  const lh = px * 1.45, padX = px * 0.45, off = s.off || { x: 0, y: 0 }, nL = lines.length, cxS = (0.5 + (off.x || 0)) * W,   // 176: grows inward from its edge (top down, bottom up, middle both ways); one place for all
    y0 = s.place === 'top' ? (0.08 + (off.y || 0)) * H + lh / 2 : s.place === 'middle' ? (0.5 + (off.y || 0)) * H - (nL - 1) * lh / 2 : (0.92 + (off.y || 0)) * H - (nL - 0.5) * lh;
  const dy = an === 'rise' ? (1 - k) * px * 0.6 : an === 'bounce' ? -Math.abs(Math.sin(k * Math.PI)) * px * 0.35 : 0, sc = an === 'pop' ? 0.85 + 0.15 * (1 - Math.pow(1 - k, 3)) + (k < 1 ? 0.06 * Math.sin(k * Math.PI) : 0) : 1;
  if (an === 'fade') ctx.globalAlpha *= k;
  const wAll = Math.max(...lines.map(l => l.w)), bx = -wAll / 2 - padX, bw = wAll + 2 * padX, by = -lh / 2 - px * 0.1, bh = lines.length * lh + px * 0.2;
  if (s.band){ ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); const g = ctx.createLinearGradient(0, H * 0.62, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.62, W, H * 0.38); ctx.restore(); }
  ctx.translate(cxS, y0 + dy); ctx.scale(sc, sc);
  const mode = s.bgOn ? (s.bgMode || 'box') : 'none', primCss = () => getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#e9603b';
  if (mode === 'bar'){ ctx.fillStyle = rgba('#000000', s.bgOp ?? 0.6); rrect(ctx, -Math.max(bw, W * 0.6) / 2, by, Math.max(bw, W * 0.6), bh, px * 0.2); ctx.fill(); }
  else if (mode === 'card'){ ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = px * 0.5; ctx.shadowOffsetY = px * 0.12; ctx.fillStyle = rgba('#ffffff', s.bgOp ?? 0.95); rrect(ctx, bx - px * 0.2, by - px * 0.1, bw + px * 0.4, bh + px * 0.2, px * 0.35); ctx.fill(); ctx.restore(); }
  lines.forEach((l, li) => {
    const y = li * lh; let x = l.w / 2;                                   // the right edge of the line (centred)
    if (mode === 'box'){ ctx.fillStyle = rgba('#000000', s.bgOp ?? 0.55); rrect(ctx, -l.w / 2 - padX, y - lh / 2, l.w + 2 * padX, lh, px * 0.25); ctx.fill(); }
    else if (mode === 'capsule'){ ctx.fillStyle = primCss(); rrect(ctx, -l.w / 2 - padX, y - lh / 2, l.w + 2 * padX, lh, lh / 2); ctx.fill(); }
    l.items.forEach(it => {
      const right = x, left = x - it.tw, isCur = !it.name && it.i === curW, said = !it.name && curW >= 0 && it.i < curW;
      ctx.save(); ctx.textAlign = 'right';
      let wsc = 1, alpha = 1;
      if (an === 'popword' && !it.name){ const kk = Math.min(1, Math.max(0, (t - it.t0) / 0.18)); wsc = 0.55 + 0.45 * (1 - Math.pow(1 - kk, 3)) + (kk < 1 ? 0.12 * Math.sin(kk * Math.PI) : 0); alpha = kk; }
      if (isCur && hiMode === 'scale') wsc *= 1.14;
      ctx.globalAlpha *= alpha; ctx.translate(right - it.tw / 2, y); ctx.scale(wsc, wsc); ctx.translate(-(right - it.tw / 2), -y);
      if (isCur && hiMode === 'pill'){ ctx.fillStyle = prim; rrect(ctx, left - px * 0.18, y - lh / 2 + px * 0.12, it.tw + px * 0.36, lh - px * 0.24, px * 0.3); ctx.fill(); }
      if (s.glow){ ctx.shadowColor = prim; ctx.shadowBlur = px * 0.55; } else if (s.shadow){ ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = px * 0.25; ctx.shadowOffsetY = px * 0.08; }
      if (s.outline){ ctx.lineWidth = Math.max(2, px * 0.12); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineJoin = 'round'; ctx.strokeText(it.w, right, y); }
      ctx.shadowColor = s.glow ? prim : (s.shadow ? 'rgba(0,0,0,.6)' : 'transparent');
      let fill = it.name ? prim : (isCur && (hiMode === 'color' || hiMode === 'scale') ? prim : (isCur && hiMode === 'pill' ? '#ffffff' : (s.color || '#ffffff')));
      if (s.gradient && !it.name){ const g = ctx.createLinearGradient(0, y - px / 2, 0, y + px / 2); g.addColorStop(0, s.color || '#ffffff'); g.addColorStop(1, prim); fill = g; }
      ctx.fillStyle = fill; ctx.fillText(it.w, right, y);
      if (isCur && hiMode === 'fill'){ const f = Math.min(1, Math.max(0, (t - it.t0) / Math.max(0.05, it.t1 - it.t0))); ctx.save(); ctx.beginPath(); ctx.rect(right - it.tw * f, y - lh / 2, it.tw * f, lh); ctx.clip(); ctx.fillStyle = prim; ctx.fillText(it.w, right, y); ctx.restore(); }
      else if (said && hiMode === 'fill'){ ctx.fillStyle = prim; ctx.fillText(it.w, right, y); }
      ctx.restore(); x = left - sp; }); });
  ctx.restore();
  const rw = Math.max(bw, mode === 'bar' ? W * 0.6 : 0) * sc, rh = bh * sc; SUBRECT = { x: (cxS - rw / 2) / W, y: (y0 + dy + by * sc) / H, w: rw / W, h: rh / H };
}
// ---- the mock's toolbar above the stage: the format
function wireVideoBar(){
  const r = $('res'); if (!r || r._wired) return; r._wired = true;
  const map = [['9:16', null], ['16:9', null], ['4:5', null], ['1:1', null], ['16:9', '4k']];
  r.onchange = async () => { const k = r.selectedIndex; if (r.value === 'custom'){ const v = await askText(T('نسبتِ تصویر', 'Aspect ratio'), T('مثلاً 21:9', 'e.g. 21:9'), '21:9'); const m = v && /(\d+)\s*[:/×x]\s*(\d+)/.exec(v.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))); if (m){ RATIOS[`${m[1]}:${m[2]}`] = [+m[1], +m[2]]; vset('ratio', `${m[1]}:${m[2]}`); } }
    else { vset('ratio', map[k][0]); if (map[k][1]) vset('res', map[k][1]); else if (V.res === '4k') vset('res', '2k'); } fitFrame(); vDraw(); placeSelBox(); };   /* 177: leaving 4K goes back to 2K */
  const idx = map.findIndex(([ra, rs]) => ra === V.ratio && (!rs || rs === V.res)); r.selectedIndex = idx >= 0 ? idx : 1; enh(r);
}
// ---- mode switch: the same timeline, the mock's panels, the mock's bar
const _setMode164 = setMode;
setMode = function(m){ _setMode164(m); $('objBar') && $('objBar').classList.add('hidden'); if (m === 'video'){ wireVideoBar(); requestAnimationFrame(() => { renderTimeline(); showVPanels(); }); } else renderTimeline(); }
addEventListener('scroll', () => posObjBar(), true);

// 165 · the mock's sliders show their value beside the label; the sticker panel gets an emoji picker in the same style
function rangeLabels(root){ (root || document).querySelectorAll('#vinsp input[type=range]').forEach(r => { const lg = r.closest('fieldset') && r.closest('fieldset').querySelector('legend'); if (!lg) return;
  let sp = lg.querySelector('.rv'); if (!sp){ sp = document.createElement('span'); sp.className = 'rv'; lg.appendChild(sp); } legendTidy(lg);
  const show = () => sp.textContent = rvText(r); show(); if (!r._rl){ r._rl = true; r.addEventListener('input', show); r.addEventListener('rangeset', show); } }); }
const _showVPanels165 = showVPanels;
showVPanels = function(anim){ _showVPanels165(anim); rangeLabels(); const o = vSel && vSel !== 'SUB' ? objById(vSel) : null; if (o && o.type === 'sticker') fillEmoji(o); };
function fillEmoji(o){ const box = $('stkEmoji'); if (!box) return; box.innerHTML = ['👑', '🎙️', '🎧', '❤️', '⭐', '🔥', '👍', '😂', '🎵', '☀️', '🦁', '📌'].map(e => `<input type="radio" name="stkE" class="btn btn-sm btn-square border-base-content/15 bg-base-100 text-lg checked:bg-primary" aria-label="${e}" ${o.emoji === e ? 'checked' : ''} onchange="vset('sel.emoji', '${e}')">`).join('');
  const any = $('stkAny'); if (any){ any.value = o.emoji || ''; any.onchange = () => vset('sel.emoji', any.value.trim() || '👑'); }
  const bg = $('stkBgOn'), opts = $('stkBgOpts'); if (bg){ bg.checked = !!(o.bg && o.bg.on); if (opts) opts.classList.toggle('hidden', !bg.checked); bg.onchange = () => { if (!o.bg) o.bg = { on: false, shape: 'circle', color: '#e6a483' }; vset('sel.bg.on', bg.checked); if (opts) opts.classList.toggle('hidden', !bg.checked); }; }
  const shp = $('stkShape'); if (shp){ shp.value = (o.bg && o.bg.shape) || 'circle'; shp.onchange = () => { if (!o.bg) o.bg = { on: true, color: '#e6a483' }; vset('sel.bg.shape', shp.value); }; enh(shp); }   // 169
  CF.stkBg = { get: () => ((objById(vSel) || o).bg || {}).color || '#e6a483', set: c => { const x = objById(vSel); if (x){ x.bg = x.bg || { on: true, shape: 'circle' }; x.bg.color = c; } }, def: '#e6a483' }; cfMount('stkBgF', 'stkBg', true); }

// 170: the edges every video bar snaps to — other objects' starts and ends, the subtitle cues, 0 and the playhead
function vSnapEdges(skip){ const out = [0, playhead]; V.objects.forEach(x => { if (x === skip || x.type === 'pod') return; out.push(x.start || 0); if (x.end != null) out.push(x.end); }); cuesNow().forEach(q => out.push(q.at, q.at + q.dur)); return out; }

function fillLabelOpts(P){ const box = $('labelOpts'); if (!box) return; const LB = P.label || (P.label = { size: 1, weight: 700, style: 'pill' }), on = P.names !== false;   // 177: a switch first; a size you can use (75–400 %)
  box.innerHTML = `<label class="flex w-full cursor-pointer items-center justify-between gap-3 text-sm"><span class="font-semibold">${T('نمایشِ نام‌ها', 'Show the names')}</span><input type="checkbox" class="toggle toggle-sm toggle-primary" ${on ? 'checked' : ''} onchange="podSet('names', this.checked)"></label>`
    + (on ? `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('اندازهٔ نام', 'Name size')}</legend><input type="range" data-unit="%" data-def="100" min="75" max="400" value="${Math.round((LB.size || 1) * 100)}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="podPath('label.size', +this.value / 100, true)"></fieldset>`
    + `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('سبکِ نام', 'Name style')}</legend><select class="select select-sm w-full" onchange="podPath('label.style', this.value); fillLabelOpts(V.pod)">${[['pill', 'پیلِ شیشه‌ای', 'Glass pill'], ['solid', 'پیلِ رنگی', 'Solid pill'], ['outline', 'خطِ دور', 'Outline'], ['plain', 'ساده با سایه', 'Plain with shadow']].map(([k, fa, en]) => `<option value="${k}" ${(LB.style || 'pill') === k ? 'selected' : ''}>${T(fa, en)}</option>`).join('')}</select></fieldset>`
    + ((LB.style || 'pill') === 'solid' ? `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('رنگِ پیل', 'Pill color')}</legend><div id="podPillColorF"></div></fieldset>` : '')   /* 179: a solid pill has its colour (the same colour field as everywhere) */
    + `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('وزنِ نام', 'Name weight')}</legend><select class="select select-sm w-full" onchange="podPath('label.weight', +this.value)">${[[900, 'سیاه', 'Black'], [700, 'پررنگ', 'Bold'], [500, 'معمولی', 'Regular']].map(([k, fa, en]) => `<option value="${k}" ${(LB.weight || 700) === k ? 'selected' : ''}>${T(fa, en)}</option>`).join('')}</select></fieldset>`
    + `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('رنگِ نام', 'Name color')}</legend><div id="podNameColorF"></div></fieldset>` : '');
  box.querySelectorAll('select').forEach(s => enh(s)); if (typeof rangeLabels === 'function') rangeLabels(box);
  if (on){ CF.podName = { get: () => (V.pod.label || {}).color || '#ffffff', set: c => { V.pod.label = V.pod.label || {}; V.pod.label.color = c; }, def: '#ffffff' }; cfMount('podNameColorF', 'podName', false);
    if ($('podPillColorF')){ const prim = cssHex(getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim() || '#e9603b');
      CF.podPill = { get: () => (V.pod.label || {}).pill || prim, set: c => { V.pod.label = V.pod.label || {}; V.pod.label.pill = c; }, def: prim }; cfMount('podPillColorF', 'podPill', false); } } }
// any CSS colour (the theme's oklch() too) as #rrggbb — a colour field speaks hex
function cssHex(c){ try { const cv = cssHex.cv || (cssHex.cv = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })), g = cv.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, 1, 1); g.fillStyle = '#000'; g.fillStyle = c; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''); } catch (e) { return '#e9603b'; } }
function podPath(path, val, live){ const [a, b] = path.split('.'); if (live){ if (POD_LIVE !== path){ remember(); POD_LIVE = path; } } else { remember(); POD_LIVE = null; } V.pod[a] = V.pod[a] || {}; V.pod[a][b] = val; vTouch(); autosave(); }

// =====================================================================================
// 170 · TRANSITIONS — the founder's Fox library: 30 GLSL looks as objects on a layer. While the playhead is inside one,
//       the finished frame passes through its shader (progress 0→1 across the object), before the captions.
// =====================================================================================
const FX0 = () => ({ type: 'fx', fx: 'liquid', params: {}, x: 0, y: 0, w: 1, h: 1, rot: 0, start: 0, end: 1.2, opacity: 1, lock: false, anim: {} });
TYPE_NAME.fx = ['گذار', 'Transition'];
let TRGL = null;
function trgl(){ if (TRGL === false) return null; if (TRGL) return TRGL;
  try { const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const gl = cv.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false }); if (!gl) throw new Error('no WebGL2');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const vs = sh(gl.VERTEX_SHADER, AvaTrans.VS), vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const progs = {}, prog = key => { if (progs[key] !== undefined) return progs[key]; const L = AvaTrans.LIB[key]; if (!L){ progs[key] = null; return null; }
      try { const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, AvaTrans.GLSL_PRE + L.src + '\nvoid main() { o = tr(uv); }')); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const u = {}; for (const n of ['ta', 'tb', 'p', 't', 'aspect', 'seed', 'pa', 'pb', 'pc', 'pd']) u[n] = gl.getUniformLocation(p, n); progs[key] = { p, u }; }
      catch (err) { console.warn('transition', key, err.message); progs[key] = null; } return progs[key]; };
    TRGL = { cv, gl, ta: tex(), tb: tex(), prog }; }
  catch (err) { console.warn('transitions unavailable:', err); TRGL = false; return null; }
  return TRGL; }
function applyTransition(ctx, W, H, t, o){ const T = trgl(); if (!T) return; const pg = T.prog(o.fx); if (!pg) return; const gl = T.gl;
  const s0 = o.start || 0, e0 = o.end == null ? s0 + 1.2 : o.end, p = Math.min(1, Math.max(0, (t - s0) / Math.max(0.05, e0 - s0)));
  if (T.cv.width !== W || T.cv.height !== H){ T.cv.width = W; T.cv.height = H; }
  gl.viewport(0, 0, W, H); gl.useProgram(pg.p); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.ta); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas); gl.uniform1i(pg.u.ta, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.ta); gl.uniform1i(pg.u.tb, 1);                 // A = B = this frame (an effect over the picture)
  const P = AvaTrans.tparams(o.fx, o.params || {}); gl.uniform1f(pg.u.p, p); gl.uniform1f(pg.u.t, t); gl.uniform1f(pg.u.aspect, W / H); gl.uniform1f(pg.u.seed, 0.37);
  gl.uniform4fv(pg.u.pa, P.pa); gl.uniform4fv(pg.u.pb, P.pb); gl.uniform4fv(pg.u.pc, P.pc); gl.uniform4fv(pg.u.pd, P.pd);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); ctx.save(); ctx.globalAlpha = o.opacity ?? 1; ctx.drawImage(T.cv, 0, 0, W, H); ctx.restore(); }
// 175: a sound effect in video mode — its name and family, a listen button, its own volume, and Replace (the library picks the new one)
function fillSfxObj(o){ const box = $('iv-sfx'); if (!box) return; const it = sfxItems().find(x => x.file === o.file) || {}, fam = sfxFams()[it.fam] || {};
  box.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4 text-primary"><use href="#i-audio-lines"/></svg><span class="text-sm font-bold">${T('افکتِ صوتی', 'Sound effect')}</span></div>
    <div class="flex items-center gap-2 rounded-box border border-base-300 p-2"><button class="btn btn-ghost btn-sm btn-circle" onclick="previewSfx('${o.file}')" aria-label="${T('شنیدن', 'Listen')}"><svg class="size-4"><use href="#i-play"/></svg></button>
      <div class="min-w-0 flex-1"><div class="truncate text-sm font-semibold">${escapeHtml(sfxName(o))}</div><div class="truncate text-xs text-base-content/60">${escapeHtml([fam.fa ? T(fam.fa, fam.en) : '', it.sec ? secs(it.sec) : ''].filter(Boolean).join(' · '))}</div></div></div>
    <fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('بلندی', 'Volume')}</legend><input type="range" data-unit="%" min="0" max="200" step="5" data-def="100" value="${Math.round((o.gain ?? 1) * 100)}" class="${RNG}" oninput="vset('sel.gain', +this.value / 100, true)"></fieldset>
    <button class="btn btn-sm w-full gap-1.5 border-base-content/15 bg-base-100" onclick="replaceSfx()"><svg class="size-4"><use href="#i-replace"/></svg>${T('جایگزینی با صدای دیگر…', 'Replace with another sound…')}</button>`; }
function replaceSfx(){ SFX_REPLACE = vSel; openSfxLib(); const d = $('sfxDlg'); if (d) d.addEventListener('close', () => setTimeout(() => { SFX_REPLACE = null; }, 0), { once: true }); }
function fillFx(o){ const box = $('iv-fx'); if (!box) return; const LIB = AvaTrans.LIB, TP = AvaTrans.TP, cur = LIB[o.fx] ? o.fx : Object.keys(LIB)[0];
  const ctr = (TP[cur] || []).map(([k, label, min, max, step, d]) => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${escapeHtml(label)}</legend><input type="range" min="${min}" max="${max}" step="${step}" value="${(o.params || {})[k] ?? d}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="fxParam('${k}', +this.value)"></fieldset>`).join('');
  box.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4"><use href="#i-sparkles"/></svg><span class="text-sm font-bold">${T('گذار / جلوه', 'Transition / effect')}</span></div>
    <fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('نوع', 'Kind')}</legend><select class="select select-sm w-full" onchange="fxSet(this.value)">${Object.keys(LIB).map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${escapeHtml(LIB[k].name)}</option>`).join('')}</select></fieldset>
    <p class="text-xs leading-relaxed text-base-content/60">${escapeHtml(LIB[cur].about || '')}</p>
    <p class="text-xs text-base-content/60">${T('مدت:', 'Length:')} ${secs((o.end == null ? (o.start || 0) + 1.2 : o.end) - (o.start || 0))} ${T('— لبه‌های نوار را روی خطِ زمان بکشید.', '— drag the bar\'s edges on the timeline.')}</p>${ctr}`;
  box.querySelectorAll('select').forEach(s => enh(s)); if (typeof rangeLabels === 'function') rangeLabels(box); }
function fxSet(k){ const o = objById(vSel); if (!o) return; remember(); o.fx = k; o.params = {}; fillFx(o); renderTimeline(); vChanged(); }
function fxParam(k, val){ const o = objById(vSel); if (!o) return; o.params = o.params || {}; o.params[k] = val; vTouch(); }

// 170: an animated GIF — frames at most 640 px wide, about 12 a second, palette per frame (gifenc)
function gifBegin(W, H, fps){ const gW = Math.min(W, 640), gH = Math.round(H * gW / W), every = Math.max(1, Math.round(fps / 12)), delay = Math.round(1000 * every / fps);
  const enc = gifenc.GIFEncoder(), cv = document.createElement('canvas'); cv.width = gW; cv.height = gH; const g = cv.getContext('2d', { willReadFrequently: true });
  return { frame(src, i){ if (i % every) return; g.drawImage(src, 0, 0, gW, gH); const rgba = g.getImageData(0, 0, gW, gH).data, pal = gifenc.quantize(rgba, 256), idx = gifenc.applyPalette(rgba, pal); enc.writeFrame(idx, gW, gH, { palette: pal, delay, repeat: 0 }); },
    finish(){ enc.finish(); return enc.bytes(); } }; }

// 174: a podcast-style background clip draws what the old base always drew
function drawPodBg(ctx, W, H, t, orbs, P, bgEl, pod){
  if (GLR){ GLR.draw(W, H, t, [], bgEl); ctx.drawImage(GLR.cv, 0, 0, W, H); } else { ctx.fillStyle = P.bg === 'solid' ? (P.solid || V.bg) : V.bg; ctx.fillRect(0, 0, W, H); }
  if (P.ovOp > 0){ ctx.fillStyle = rgba(P.ovColor, P.ovOp); ctx.fillRect(0, 0, W, H); }
  if (P.grad && P.gradOp > 0){ const g = P.gradDir === 'to top' ? ctx.createLinearGradient(0, H, 0, 0) : P.gradDir === 'to bottom' ? ctx.createLinearGradient(0, 0, 0, H) : P.gradDir === 'to left' ? ctx.createLinearGradient(W, 0, 0, 0) : P.gradDir === 'to right' ? ctx.createLinearGradient(0, 0, W, 0) : P.gradDir === 'radial' ? ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.7) : ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, rgba(P.gradA, P.gradOp)); g.addColorStop(1, rgba(P.gradB, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  
}

// =====================================================================================
// 174 · VIDEO TRACKS — subtitles fixed on top · regular tracks (reorderable) · the BACKGROUND track fixed right above
//       the AUDIO track. Background clips cover the canvas (pan along the free direction), join by transitions between
//       two clips (only the background changes; everything above stays), podcast style is a background clip, the
//       podcast template sits on a regular track without a background.
// =====================================================================================
const _ensureLayers174 = ensureLayers;
ensureLayers = function(){ V.objects = V.objects.filter(o => o.type !== 'fx');   // the 170 transition objects are gone (transitions join two clips)
  V.objects.forEach(o => { if (o.full && !o.tpl) o.bgl = true; if (o.type === 'pod' && !o.tpl && o.bgl === undefined) o.bgl = true; if (o.bgl && (o.type === 'image' || o.type === 'video')){ o.x = 0; o.y = 0; o.w = 1; o.h = 1; o.rot = 0; o.fit = 'cover'; } });   // podcast style keeps its box (it places the orbs)
  if (Array.isArray(V.layers)) V.layers.forEach(l => { if (l.kind === 'vid') l.kind = 'bg'; });
  _ensureLayers174();
  let B = V.layers.find(l => l.kind === 'bg'); if (!B){ B = { id: 'L' + (++uid), kind: 'bg', name: 'پس‌زمینه', en: 'Background', items: [], keep: true }; V.layers.push(B); }
  B.keep = true; B.name = 'پس‌زمینه'; B.en = 'Background';
  V.layers.forEach(l => { if (l === B) return; const out = l.items.filter(id => { const o = objById(id); return o && o.bgl; }); if (out.length){ l.items = l.items.filter(id => !out.includes(id)); out.forEach(id => { if (!B.items.includes(id)) B.items.push(id); }); } });
  B.items = B.items.filter(id => { const o = objById(id); return o && o.bgl; }); V.layers = V.layers.filter(l => l === B || l.items.length || l.keep); V.layers = [...V.layers.filter(l => l !== B), B]; };
const bgClips = () => { const B = (V.layers || []).find(l => l.kind === 'bg'); return B ? B.items.map(objById).filter(Boolean).sort((a, b) => (a.start || 0) - (b.start || 0)) : []; };
const bgEnd = () => bgClips().reduce((m, o) => Math.max(m, o.end ?? projEnd()), 0);
const TRC = [null, null]; function trCanvas(i, W, H){ let c = TRC[i]; if (!c) c = TRC[i] = document.createElement('canvas'); if (c.width !== W || c.height !== H){ c.width = W; c.height = H; } return c; }
async function drawBgClip(ctx, o, W, H, t, exporting, orbs, P, pod){
  if (o.type === 'pod'){ const bgEl = (P.bg === 'image' || P.bg === 'video') && P.bgAsset ? await mediaEl(P.bgAsset) : null; if (bgEl && bgEl.tagName === 'VIDEO' && exporting) await seekVideo(bgEl, t % (bgEl.duration || 1e9)); drawPodBg(ctx, W, H, t, orbs, P, bgEl, pod); return; }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); const el = await mediaEl(o.asset);
  if (el && el.tagName === 'VIDEO'){ if (exporting){ const local = (o.trimIn || 0) + Math.max(0, t - (o.start || 0)); await seekVideo(el, o.loop && el.duration ? local % el.duration : Math.min(local, (el.duration || 1e9) - 0.01)); } else { el.muted = o.mute === true; el.volume = Math.max(0, Math.min(1, o.volume ?? 1)); } }
  drawMedia(ctx, o, W, H, el); }
async function drawBackground(ctx, W, H, t, exporting, orbs, P, pod){ const L = bgClips();
  for (let i = 0; i < L.length - 1; i++){ const A = L[i], B = L[i + 1], tr = !exporting && TRPV && TRPV.id === A.id ? TRPV.tr : A.trans; if (!tr || !tr.type) continue; const cut = A.end ?? projEnd(); if (Math.abs((B.start || 0) - cut) > 0.06) continue; const d = Math.max(0.1, tr.dur || 0.8);   /* 177: a hovered tile previews its transition */
    if (t >= cut - d / 2 && t < cut + d / 2){ const p = (t - (cut - d / 2)) / d, ca = trCanvas(0, W, H), cb = trCanvas(1, W, H); await drawBgClip(ca.getContext('2d'), A, W, H, t, exporting, orbs, P, pod); await drawBgClip(cb.getContext('2d'), B, W, H, t, exporting, orbs, P, pod); blendTr(ctx, W, H, ca, cb, p, tr, t); return; } }
  const cur = L.find(o => visibleAt(o, t)); if (cur) return drawBgClip(ctx, cur, W, H, t, exporting, orbs, P, pod); ctx.fillStyle = V.bg || '#000000'; ctx.fillRect(0, 0, W, H); }
function blendTr(ctx, W, H, ca, cb, p, tr, t){ const T = tr.type !== 'fade' && AvaTrans.LIB[tr.type] ? trgl() : null, pg = T && T.prog(tr.type);
  if (!pg){ ctx.save(); ctx.globalAlpha = 1; ctx.drawImage(ca, 0, 0, W, H); ctx.globalAlpha = Math.min(1, Math.max(0, p)); ctx.drawImage(cb, 0, 0, W, H); ctx.restore(); return; }
  const gl = T.gl; if (T.cv.width !== W || T.cv.height !== H){ T.cv.width = W; T.cv.height = H; } gl.viewport(0, 0, W, H); gl.useProgram(pg.p); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, T.ta); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ca); gl.uniform1i(pg.u.ta, 0);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, T.tb); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cb); gl.uniform1i(pg.u.tb, 1);
  const Q = AvaTrans.tparams(tr.type, tr.params || {}); gl.uniform1f(pg.u.p, p); gl.uniform1f(pg.u.t, t); gl.uniform1f(pg.u.aspect, W / H); gl.uniform1f(pg.u.seed, 0.37); gl.uniform4fv(pg.u.pa, Q.pa); gl.uniform4fv(pg.u.pb, Q.pb); gl.uniform4fv(pg.u.pc, Q.pc); gl.uniform4fv(pg.u.pd, Q.pd);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); ctx.drawImage(T.cv, 0, 0, W, H); }
function pickBgMedia(kind){ const inp = document.createElement('input'); inp.type = 'file'; inp.accept = kind === 'video' ? 'video/*' : 'image/*';
  inp.onchange = async () => { const f = inp.files && inp.files[0]; if (!f) return; setBusy(true); try { const id = await addAsset(f), el = await mediaEl(id); remember(); const s = bgEnd(), len = kind === 'video' && el && el.duration ? el.duration : 5;
    const o = { id: 'o' + (++uid), ...MEDIA0(kind, id, el && (el.videoWidth || el.naturalWidth), el && (el.videoHeight || el.naturalHeight)), bgl: true, x: 0, y: 0, w: 1, h: 1, fit: 'cover', panX: 0.5, panY: 0.5, radius: 0, mute: false, volume: 1, loop: false, start: s, end: s + len, shadow: { on: false }, stroke: { on: false } };
    V.objects.push(o); ensureLayers(); selectV(o.id); vChanged(); } catch (err) { say(err.message || String(err), 'err'); } finally { setBusy(false); } }; inp.click(); }
// a background clip: drag on the canvas pans along its free direction (it always covers the canvas)
const _startVMove174 = startVMove;
startVMove = function(ev){ const o = objById(vSel); if (!o || !o.bgl || (o.type !== 'image' && o.type !== 'video')) return _startVMove174.apply(this, arguments);
  ev.preventDefault(); const m = MEDIA.get(o.asset), el = m && m.el, iw = el && (el.videoWidth || el.naturalWidth), ih = el && (el.videoHeight || el.naturalHeight); if (!iw || !ih) return; remember();
  const s = Math.max(frameW / iw, frameH / ih), freeX = iw * s - frameW, freeY = ih * s - frameH, x0 = ev.clientX, y0 = ev.clientY, px = o.panX ?? 0.5, py = o.panY ?? 0.5;
  const mv = e => { if (freeX > 1) o.panX = Math.min(1, Math.max(0, px - (e.clientX - x0) / freeX)); if (freeY > 1) o.panY = Math.min(1, Math.max(0, py - (e.clientY - y0) / freeY)); vDraw(); };
  const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); autosave(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); };
// transitions between two background clips — on the outgoing clip; options in the inspector; a ±1 s preview on every change
function openBgTrans(){ const o = objById(vSel); if (!o || !o.bgl) return; const L = bgClips(), i = L.indexOf(o), nx = L[i + 1];
  if (!nx || Math.abs((nx.start || 0) - (o.end ?? projEnd())) > 0.06) return say(T('گذار بینِ دو کلیپِ پس‌زمینه است: کلیپِ بعدی باید درست پشتِ این کلیپ شروع شود.', 'A transition joins two background clips: the next clip must start right where this one ends.'), 'err');
  if (!o.trans){ remember(); o.trans = { type: 'fade', dur: 0.8, params: {} }; renderTimeline(); vChanged(); } showTransPanel(o); previewTrans(o); }
function showTransPanel(o){ const box = $('iv-fx'); if (!box) return; document.querySelectorAll('[id^="iv-"]').forEach(x => { if (x.id !== 'iv-fx' && x.closest('#vInsp, aside') ) x.classList.add('hidden'); }); box.classList.remove('hidden');
  const tr = o.trans, LIB = AvaTrans.LIB, TP = AvaTrans.TP[tr.type] || [], L = LIB[tr.type], RCLS = 'range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]';
  const keys = Object.keys(LIB).filter(k => !LIB[k].scene), opt = k => `<option value="${k}" ${k === tr.type ? 'selected' : ''}>${escapeHtml(trName(k))}</option>`;   /* 175: scenes are not transitions; three groups */
  const kinds = `<optgroup label="${T('ساده', 'Simple')}">${opt('fade')}${keys.filter(k => k === 'push').map(opt).join('')}</optgroup>`
    + `<optgroup label="${T('سینمایی', 'Cinematic')}">${keys.filter(k => k !== 'push' && !LIB[k].sc).map(opt).join('')}</optgroup>`
    + `<optgroup label="${T('وایپ و محو — shaders.com', 'Wipes and dissolves — shaders.com')}">${keys.filter(k => LIB[k].sc).map(opt).join('')}</optgroup>`;
  const lbl = en => T((AvaTrans.TPFA || {})[en] || en, en), about = tr.type === 'fade' || !L ? T('کلیپِ بعدی آرام روی کلیپِ فعلی پیدا می‌شود.', 'The next clip fades in over the current one.') : T(L.aboutFa || L.about || '', L.aboutEn || L.about || '');
  const ctl = ([k, label, min, max, step, d, , opts]) => { const v = (tr.params || {})[k] ?? d;
    return `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${escapeHtml(lbl(label))}</legend>` + (opts
      ? `<select class="select select-sm w-full" onchange="setBgTrans('p:${k}', +this.value)">${opts.map(([ov, en, fa]) => `<option value="${ov}" ${+ov === +v ? 'selected' : ''}>${escapeHtml(T(fa, en))}</option>`).join('')}</select>`
      : `<input type="range" min="${min}" max="${max}" step="${step}" value="${v}" class="${RCLS}" onchange="setBgTrans('p:${k}', +this.value)">`) + `</fieldset>`; };
  box.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4"><use href="#i-sparkles"/></svg><span class="flex-1 text-sm font-bold">${T('گذار به کلیپِ بعدی', 'Transition to the next clip')}</span><button class="btn btn-ghost btn-xs text-error" onclick="removeBgTrans()">${T('حذف', 'Remove')}</button></div>
    <fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('نوع', 'Kind')}</legend><select class="select select-sm w-full" onchange="setBgTrans('type', this.value)">${kinds}</select></fieldset>
    <p class="text-xs leading-relaxed text-base-content/60">${escapeHtml(about)}</p>
    <fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('مدت', 'Length')} · ${secs(tr.dur || 0.8)}</legend><input type="range" min="0.2" max="3" step="0.1" value="${tr.dur || 0.8}" class="${RCLS}" onchange="setBgTrans('dur', +this.value)"></fieldset>
    ${TP.map(ctl).join('')}`;
  box.querySelectorAll('select').forEach(s => enh(s)); }
/* 175: a transition's name in the language on screen */
function trName(k){ if (k === 'fade') return T('محو', 'Fade'); const L = AvaTrans.LIB[k]; return L ? T(L.fa || L.name, L.name) : k; }
function setBgTrans(k, val){ const o = objById(vSel); if (!o || !o.trans) return; remember(); if (k.startsWith('p:')){ o.trans.params = o.trans.params || {}; o.trans.params[k.slice(2)] = val; } else { o.trans[k] = val; if (k === 'type') o.trans.params = {}; } showTransPanel(o); renderTimeline(); vChanged(); previewTrans(o); }
function removeBgTrans(){ const o = objById(vSel); if (!o) return; remember(); delete o.trans; renderTimeline(); vChanged(); showVPanels(); }
function previewTrans(o){ const cut = o.end ?? projEnd(), d = (o.trans && o.trans.dur) || 0.8; try { if (playing) stopPlay(); seek(Math.max(0, cut - d / 2 - 1)); startPlay(cut + d / 2 + 1); } catch (err) {} }
// the audio track: selectable, with its own volume over the whole audio composition
function showMixPanel(){ let box = $('iv-mix'); const ref = $('iv-pip'); if (!ref) return; if (!box){ box = document.createElement('div'); box.id = 'iv-mix'; box.className = 'hidden space-y-3 p-4'; ref.parentElement.insertBefore(box, ref); }
  document.querySelectorAll('[id^="iv-"]').forEach(x => { if (x !== box && x.parentElement === ref.parentElement) x.classList.add('hidden'); }); box.classList.remove('hidden'); const v0 = Math.round((V.audioVol ?? 1) * 100);
  box.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4"><use href="#i-audio-lines"/></svg><span class="text-sm font-bold">${T('صدا — همهٔ ترکیبِ صوتی', 'Audio — the full mix')}</span></div><fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('بلندی', 'Volume')} · <span class="mixv">${num(v0)}${pctSign()}</span></legend><input type="range" min="0" max="200" data-def="100" value="${v0}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="V.audioVol = +this.value / 100; document.querySelector('#iv-mix .mixv').textContent = num(+this.value) + pctSign(); trackGain = {}; if (playing){ const t = playhead; stopPlay(); seekVisual(t); startPlay(); } autosave()"></fieldset><p class="text-xs text-base-content/60">${T('دوبار کلیک روی ترکِ صدا، حالتِ صدا را باز می‌کند.', 'Double-click the audio track to switch to audio mode.')}</p>`; }
// pictures and videos: a volume for every video, and collapsible visual adjustments at the bottom
const _fillPip174 = fillPip;
fillPip = function(o){ const r = _fillPip174.apply(this, arguments); const host = $('iv-pip'); if (!host || !o) return r; let box = $('pipAdj'); if (!box){ box = document.createElement('div'); box.id = 'pipAdj'; host.appendChild(box); }
  // 177: Adjustments as a section like the others (open, a reset icon on each value, values in % · ° · px); the video's volume lives with «Muted»
  const a = o.adj || {}, rng = (k, fa, en, min, max, step, d, unit, scale) => `<fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T(fa, en)}</legend><input type="range" data-unit="${unit}" min="${min}" max="${max}" step="${step}" value="${Math.round((a[k] ?? d) * scale)}" data-def="${Math.round(d * scale)}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="adjSet('${k}', +this.value / ${scale})"></fieldset>`;
  box.className = 'space-y-2 border-t border-base-300 pt-3';
  box.innerHTML = `<div class="text-sm font-semibold">${T('تنظیمِ تصویر', 'Adjustments')}</div>` + rng('brightness', 'روشنایی', 'Brightness', 20, 200, 1, 1, '%', 100) + rng('contrast', 'کنتراست', 'Contrast', 20, 200, 1, 1, '%', 100) + rng('saturate', 'اشباعِ رنگ', 'Saturation', 0, 250, 1, 1, '%', 100) + rng('hue', 'چرخشِ رنگ', 'Hue', -180, 180, 1, 0, '°', 1) + rng('blur', 'محوی', 'Blur', 0, 20, 0.5, 0, 'px', 1);
  if (typeof rangeLabels === 'function') rangeLabels(box); if (typeof vResets === 'function') vResets(box); return r; };
function adjSet(k, val){ const o = objById(vSel); if (!o) return; o.adj = o.adj || {}; o.adj[k] = val; vTouch(); }
// the transition badge on a background clip (right of its duration mark) and the toolbar's transition tool
const _placeVObjBar174 = placeVObjBar;
placeVObjBar = function(){ const r = _placeVObjBar174.apply(this, arguments); const o = vSel && vSel !== 'SUB' && vSel !== 'MIX' ? objById(vSel) : null, bar = $('clipBar');
  if (o && o.bgl && bgNextOf(o) && bar && !bar.classList.contains('hidden') && !bar.querySelector('[data-trans]'))   /* 176: only when a clip starts right where this one ends */ bar.insertAdjacentHTML('afterbegin', `<li data-trans><a onclick="openBgTrans()" class="gap-1"><svg class="size-3.5"><use href="#i-sparkles"/></svg><span class="ui">${T('گذار', 'Transition')}</span></a></li>`); return r; };
/* 176: the indicator is drawn inside its clip by the timeline itself (renderVideoTimeline) */

// =====================================================================================
// 175 · SLIDESHOW («اسلایدشو») — several pictures as background clips joined by fades. They are spread equally over
//       the free time of the background track (each at least V.slideMin seconds); every boundary between two slides
//       is a roll edit (the transition stays intact), dragging a slide reorders it, and the outer edges trim.
// =====================================================================================
const slideMin = () => Math.max(0.5, V.slideMin ?? 2);
const slidesOf = id => V.objects.filter(o => o.show === id).sort((a, b) => (a.start || 0) - (b.start || 0));
function pickFiles(accept, multiple){ return new Promise(done => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.multiple = !!multiple;
  inp.onchange = () => done([...(inp.files || [])]); inp.addEventListener('cancel', () => done([])); inp.click(); }); }
function bgFreeSpan(){ const L = bgClips(); const end = L.length ? Math.max(...L.map(o => o.end ?? projEnd())) : 0; return [end, Math.max(0, projEnd() - end)]; }
function layoutSlides(id, start){ let t = start; const L = slidesOf(id);
  L.forEach((o, i) => { const d = Math.max(slideMin(), (o.end ?? (o.start || 0) + 4) - (o.start || 0)); o.start = t; o.end = t + d; t += d;
    if (i < L.length - 1){ if (!o.trans) o.trans = { type: 'fade', dur: 0.8, params: {} }; } else delete o.trans; }); }
function distributeSlides(id){ const L = slidesOf(id); if (!L.length) return; const s0 = L[0].start || 0;
  const after = bgClips().filter(o => o.show !== id && (o.start || 0) > s0 + 0.01).map(o => o.start || 0), end = after.length ? Math.min(...after) : projEnd();
  const per = Math.max(slideMin(), (end - s0) / L.length); L.forEach((o, i) => { o.start = s0 + i * per; o.end = o.start + per; }); layoutSlides(id, s0); }
async function addSlideshow(into){ const files = await pickFiles('image/*', true); if (!files.length) return;
  const old = into ? null : bgClips(); let [start, free] = into ? [0, 0] : bgFreeSpan(), mode = 'fit';
  if (!into && free < slideMin()){   // the background track is already full (a new project's podcast style spans everything)
    const pod = old.some(o => o.type === 'pod');
    const k = await askChoice(T('پس‌زمینه پر است', 'The background is full'), T('همهٔ زمانِ ترکیب را کلیپ‌های پس‌زمینه پر کرده‌اند. اسلایدشو کجا برود؟', 'Background clips already fill the whole composition. Where should the slideshow go?'),
      [{ k: 'no', label: T('لغو', 'Cancel') }, { k: 'after', label: T('بعد از آن‌ها', 'After them') }, { k: 'replace', label: T('جایگزینِ پس‌زمینه', 'Replace the background') }, ...(pod ? [{ k: 'replace-keep', label: T('جایگزین، با گوینده‌ها روی تصویر', 'Replace, but keep the speakers on screen'), primary: true }] : [])]);
    if (!k || k === 'no') return; mode = k; }
  setBusy(true); try { remember(); const id = into || ('ss' + (++uid)), made = [];
    if (mode.startsWith('replace')){ V.objects = V.objects.filter(o => !o.bgl); start = 0; if (mode === 'replace-keep' && !V.objects.some(o => o.tpl)) V.objects.push({ id: 'o' + (++uid), type: 'pod', tpl: true, x: 0.06, y: 0.26, w: 0.88, h: 0.52, rot: 0, opacity: 1, start: 0, end: null }); }
    for (const f of files){ const aid = await addAsset(f), el = await mediaEl(aid);
      made.push({ id: 'o' + (++uid), ...MEDIA0('image', aid, el && (el.naturalWidth || el.videoWidth), el && (el.naturalHeight || el.videoHeight)), bgl: true, show: id, x: 0, y: 0, w: 1, h: 1, fit: 'cover', panX: 0.5, panY: 0.5, radius: 0, mute: false, volume: 1, loop: false, shadow: { on: false }, stroke: { on: false }, start: 0, end: 4 }); }
    if (into){ const L = slidesOf(id), last = L[L.length - 1]; made.forEach((o, i) => { o.start = (last ? last.end : 0) + i * 4; o.end = o.start + 4; }); V.objects.push(...made); ensureLayers(); distributeSlides(id); }
    else { const per = mode === 'after' ? 4 : Math.max(slideMin(), (mode.startsWith('replace') ? projEnd() : free) / made.length); made.forEach((o, i) => { o.start = start + i * per; o.end = o.start + per; }); V.objects.push(...made); ensureLayers(); layoutSlides(id, start); }
    selectV(made[0].id); vChanged(); say(T(`اسلایدشو: ${FA(slidesOf(id).length)} تصویر`, `Slideshow: ${slidesOf(id).length} pictures`), 'ok'); }
  catch (err) { say(err.message || String(err), 'err'); } finally { setBusy(false); } }
// the bar drag calls this for a slide; true = handled
function slideEdit(o, edge, s0, e0, d){ const L = slidesOf(o.show), i = L.indexOf(o), mn = slideMin(), prev = L[i - 1], next = L[i + 1];
  if (!edge){ if (o._from === undefined) Object.defineProperty(o, '_from', { value: s0, writable: true, configurable: true, enumerable: false }); o.start = Math.max(0, s0 + d); o.end = o.start + (e0 - s0); return true; }   // reorder on drop (slideDrop); _from is never saved
  if (edge === 's' && prev){ const lo = (prev.start || 0) + mn, hi = e0 - mn, t = Math.min(hi, Math.max(lo, s0 + d)); prev.end = t; o.start = t; return true; }   // roll the boundary with the previous slide
  if (edge === 'e' && next){ const lo = s0 + mn, hi = (next.end ?? projEnd()) - mn, t = Math.min(hi, Math.max(lo, e0 + d)); o.end = t; next.start = t; return true; }   // roll the boundary with the next slide
  if (edge === 's'){ o.start = Math.max(0, Math.min(e0 - mn, s0 + d)); return true; } o.end = Math.max(s0 + mn, e0 + d); return true; }   // the outer edges trim (never below the minimum)
function slideDrop(o){ const L = slidesOf(o.show).filter(x => x !== o), first = Math.min(o._from ?? Infinity, ...L.map(x => x.start || 0)), mid = (o.start || 0) + ((o.end || 0) - (o.start || 0)) / 2;
  let k = L.findIndex(x => mid < (x.start || 0) + ((x.end || 0) - (x.start || 0)) / 2); if (k < 0) k = L.length; L.splice(k, 0, o);
  const durs = new Map(L.map(x => [x, (x.end || 0) - (x.start || 0)])); let t = first; L.forEach(x => { x.start = t; x.end = t + durs.get(x); t = x.end; }); delete o._from; layoutSlides(o.show, first); }
// deleting a slide closes the gap; duplicating inserts the copy right after it
const _vDelete175 = vDelete;
vDelete = function(){ const o = objById(vSel); if (!o || !o.show) return _vDelete175.apply(this, arguments); remember(); const id = o.show, first = Math.min(...slidesOf(id).map(x => x.start || 0)); V.objects = V.objects.filter(x => x !== o); if (slidesOf(id).length) layoutSlides(id, first); selectV(null); vChanged(); };
const _vDuplicate175 = typeof vDuplicate === 'function' ? vDuplicate : null;
vDuplicate = function(){ const o = objById(vSel); if (!o || !o.show) return _vDuplicate175 && _vDuplicate175.apply(this, arguments); remember(); const c = JSON.parse(JSON.stringify(o)); c.id = 'o' + (++uid); c.start = (o.end || 0) - 0.001; c.end = c.start + ((o.end || 0) - (o.start || 0));
  const first = Math.min(...slidesOf(o.show).map(x => x.start || 0)); slidesOf(o.show).forEach(x => { if ((x.start || 0) >= (o.end || 0) - 0.01){ x.start += c.end - c.start; x.end += c.end - c.start; } }); V.objects.push(c); ensureLayers(); layoutSlides(o.show, first); selectV(c.id); vChanged(); };
// the slideshow section in a slide's inspector: count, add pictures, spread equally, the minimum per slide
const _fillPip175 = fillPip;
fillPip = function(o){ const r = _fillPip175.apply(this, arguments); const host = $('iv-pip'); let box = $('slideBox'); if (!host) return r;
  if (!o || !o.show){ if (box) box.remove(); return r; } if (!box){ box = document.createElement('div'); box.id = 'slideBox'; box.className = 'space-y-2 rounded-box border border-base-300 p-3'; host.insertBefore(box, host.children[1] || null); }
  const n = slidesOf(o.show).length;
  box.innerHTML = `<div class="flex items-center gap-2"><svg class="size-4"><use href="#i-film"/></svg><span class="flex-1 text-sm font-semibold">${T('اسلایدشو', 'Slideshow')} · ${num(n)} ${T('تصویر', 'pictures')}</span></div>
    <div class="flex gap-2"><button class="btn btn-sm flex-1 gap-1 border-base-content/15 bg-base-100" onclick="addSlideshow(objById(vSel).show)"><svg class="size-4"><use href="#i-plus"/></svg>${T('افزودنِ تصویر', 'Add pictures')}</button><button class="btn btn-sm flex-1 border-base-content/15 bg-base-100" onclick="{ remember(); distributeSlides(objById(vSel).show); vChanged(); renderTimeline(); }">${T('تقسیمِ مساوی', 'Spread equally')}</button></div>
    <fieldset class="fieldset"><legend class="fieldset-legend text-xs font-medium text-base-content/70">${T('کمترین مدتِ هر اسلاید', 'Shortest slide')} · <span class="slmin">${secs(slideMin())}</span></legend><input type="range" min="0.5" max="10" step="0.5" data-def="2" value="${slideMin()}" class="range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]" oninput="V.slideMin = +this.value; document.querySelector('#slideBox .slmin').textContent = secs(this.value)" onchange="{ remember(); const L = slidesOf(objById(vSel).show); layoutSlides(objById(vSel).show, L[0].start || 0); vChanged(); renderTimeline(); }"></fieldset>
    <p class="text-xs leading-relaxed text-base-content/60">${T('لبه‌ی بینِ دو اسلاید را بکشید تا مرزشان جابه‌جا شود؛ اسلاید را بکشید تا جایش در ترتیب عوض شود.', 'Drag the edge between two slides to move their boundary; drag a slide to change its place in the order.')}</p>`; return r; };
/* 175 · a font picker (each row drawn in its own font) and the weights that family really has */
function fillFontPick(fsel, wsel, fam, w, setF, setW){
  fsel.innerHTML = FONT_GROUPS.map(([g, fa, en]) => `<optgroup label="${escapeHtml(T(fa, en))}">` + FONT_LIST.filter(f => (f[3] || 'fa') === g).map(([f, faN]) => `<option value="${f}" data-font="${f}">${escapeHtml(lang === 'fa' ? faN : f)}</option>`).join('') + '</optgroup>').join('');   /* 176: grouped */
  fsel.value = fam; fsel.onchange = () => setF(fsel.value); if (fsel._btn) refreshEnh(fsel); enh(fsel);
  if (!wsel) return; const seen = new Set(), opts = [[900, 'سیاه', 'Black'], [700, 'پررنگ', 'Bold'], [400, 'معمولی', 'Regular']].filter(([v]) => { const k = fontW(fam, v); if (seen.has(k)) return false; seen.add(k); return true; });
  wsel.innerHTML = opts.map(([v, fa, en]) => `<option value="${v}">${T(fa, en)}</option>`).join(''); const cur = opts.find(([v]) => fontW(fam, v) === fontW(fam, w)) || opts[0]; wsel.value = String(cur[0]);
  wsel.disabled = opts.length < 2; wsel.onchange = () => setW(+wsel.value); enh(wsel); if (wsel._btn) wsel._btn.disabled = opts.length < 2; }

// 177 · the podcast's palette (one of the mock's, or the founder's own three colours, the rest derived) and a 176 design's move
function podPal(P){ if (P.pal !== 'custom') return PALS[P.pal] || PALS.nil; const c = (P.custom || []).map(x => hex6(x) || '#1c2a74'), mix = (a, b, k) => '#' + [1, 3, 5].map(i => Math.round(parseInt(a.substr(i, 2), 16) * (1 - k) + parseInt(b.substr(i, 2), 16) * k).toString(16).padStart(2, '0')).join('');
  return [c[0], c[1], c[2], mix(c[0], c[1], 0.5), mix(c[1], c[2], 0.5), mix(c[2], '#000000', 0.45)]; }
function podMigrate(P, raw){ if (!raw) return;
  if (!raw.v177){ if (ORB_WAVES.includes(P.wave)) P.wave = 'circle'; if (typeof raw.style === 'number') P.style = STYLE_177[raw.style] ?? 0; ['iri', 'glow', 'ripple', 'labPalette', 'labMesh'].forEach(k => delete P[k]); P.v177 = true; }
  if (!raw.v179){ if (P.drift > 1.5) P.drift = 1.5; if (typeof P.style === 'number'){ if (P.style === 3) P.style = 6; else if (P.style > 3) P.style -= 1; } if (P.layout === 'quote') P.layout = 'single'; P.v179 = true; } }   // 179: Quote → Minimal

// 177 · a podcast design's tile is a flat picture of the design itself — its background, its speakers and its waveform —
//       not a shiny ball (the orb look belongs to the commercial product)
function podStyleSvg(st){ const c = PALS[st.pal] || PALS.nil, id = 'psg' + st.pal + st.wave + st.layout + st.bg;
  const bg = st.bg === 'solid' ? `<rect width="64" height="36" fill="${c[2]}"/>`
    : `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[1]}"/><stop offset=".5" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[2]}"/></linearGradient></defs><rect width="64" height="36" fill="url(#${id})"/>`
      + (st.bg === 'image' ? `<path d="M0 36 L18 20 L28 28 L40 16 L64 34 L64 36 Z" fill="#000" fill-opacity=".28"/><circle cx="50" cy="9" r="3" fill="#fff" fill-opacity=".35"/>` : '');
  const xs = st.layout === 'single' ? [32] : [21, 43], cy = 14, r = 5.2;
  let fg = '';
  xs.forEach(x => { fg += `<circle cx="${x}" cy="${cy}" r="${r}" fill="#fff" fill-opacity=".16" stroke="#fff" stroke-opacity=".75" stroke-width=".8"/>`;
    if (st.wave === 'circle'){ for (let i = 0; i < 16; i++){ const a = i / 16 * Math.PI * 2, l = 1.2 + (i % 3) * 0.7, r0 = r + 1.2; fg += `<line x1="${(x + Math.cos(a) * r0).toFixed(2)}" y1="${(cy + Math.sin(a) * r0).toFixed(2)}" x2="${(x + Math.cos(a) * (r0 + l)).toFixed(2)}" y2="${(cy + Math.sin(a) * (r0 + l)).toFixed(2)}" stroke="#fff" stroke-opacity=".85" stroke-width=".7" stroke-linecap="round"/>`; } }
    else if (st.wave === 'line'){ let d = ''; for (let i = 0; i <= 16; i++){ const px = x - 8 + i, py = cy + r + 4 + Math.sin(i * 0.9) * 1.6; d += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); } fg += `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width=".8" stroke-linecap="round"/>`; }
    else { for (let i = 0; i < 8; i++){ const h = 1.2 + Math.abs(Math.sin(i * 1.3)) * 3.2, bx = x - 7.5 + i * 2.05, by = st.wave === 'mirror' ? cy + r + 4.2 - h / 2 : cy + r + 6 - h; fg += `<rect x="${bx.toFixed(2)}" y="${by.toFixed(2)}" width="1.2" height="${h.toFixed(2)}" rx=".6" fill="#fff" fill-opacity=".85"/>`; } } });
  return `<svg viewBox="0 0 64 36" class="block h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${bg}${fg}</svg>`; }
