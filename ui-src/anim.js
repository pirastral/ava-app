/* =====================================================================================
   175 · ANIMATION — In · Out · Loop, aware of what is being animated (text · picture/video · sticker · podcast)
   The structure follows the Picsart animation tool: three tabs; In and Out each have their own duration (capped at
   half the object's time) and Loop has a speed and runs between them. Out plays the chosen preset backwards, so
   every In has its Out. Text presets run by letter, word or line; the text background has its own In and Out.
   A fading object is composited as one layer, so nothing under it (a shadow, the box behind a text) shows through.
   ===================================================================================== */
const AE = {
  out: p => 1 - Math.pow(1 - p, 3),
  out5: p => 1 - Math.pow(1 - p, 5),
  inq: p => p * p,
  io: p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
  back: p => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
  bounce: p => { const n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; },
  elastic: p => p <= 0 ? 0 : p >= 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * 2.0944) + 1,
};
const ac01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const anHash = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const anNoise = (x, s) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f), a = anHash(i + s * 101), b = anHash(i + 1 + s * 101); return (a + (b - a) * u) * 2 - 1; };
const DIRV = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const ANID = Object.freeze({ a: 1, x: 0, y: 0, s: 1, sx: 1, sy: 1, r: 0, k: 0, b: 0, glow: 0, glitch: 0, mask: null, inner: null, pivot: null, seed: 0 });
const ANNONE = Object.freeze({ v: 2 });
var ANPV = null;   /* the live preview on the canvas (var: vDraw reads it) */

/* how far an object travels to leave the frame on one side (Slide) */
function edgeDist(C){ const o = C.o, d = C.dir, m = 0.03 * C.H, R = Math.hypot(o.w * C.W, o.h * C.H) / 2 - Math.max(o.w * C.W, o.h * C.H) / 2;
  return (d === 'left' ? (o.x + o.w) * C.W : d === 'right' ? (1 - o.x) * C.W : d === 'up' ? (o.y + o.h) * C.H : (1 - o.y) * C.H) + m + Math.max(0, R); }
const NEON_K = [[0, 0], [0.1, 1], [0.15, 0.1], [0.24, 1], [0.29, 0.25], [0.4, 1], [0.45, 0.55], [0.52, 1]];
function neonF(p){ let v = 0; for (const k of NEON_K) if (p >= k[0]) v = k[1]; return { a: p <= 0 ? 0 : v, glow: v * (1 - ac01((p - 0.7) / 0.3)) }; }
function stompF(p){ let s = 2.3 - 1.3 * AE.inq(p); if (p > 0.8) s *= 1 - 0.06 * Math.sin((p - 0.8) / 0.2 * Math.PI); return { a: ac01(p * 2.5), s }; }
function jumpF(t, v, C){ const c = (t * v) % 1.3; if (c > 0.6) return null; const q = c / 0.6, sq = q < 0.15 ? 1 - q / 0.15 : q > 0.85 ? (q - 0.85) / 0.15 : 0; return { y: -0.06 * C.H * Math.sin(Math.PI * q), sx: 1 + 0.12 * sq, sy: 1 - 0.12 * sq, pivot: [0, 0.5] }; }
function hopF(t, v, C, U){ const T0 = 0.08 * U.n + 0.9, d = (t * v) % T0 - U.i * 0.08; return d < 0 || d > 0.32 ? null : { y: -0.28 * U.lh * Math.sin(Math.PI * d / 0.32) }; }

/* In / Out presets. k: t text · m picture/video · s sticker · p podcast. obj: the whole object; unit: one letter,
   word or line of a text (by: which, dBy: the default). ofa/oen: the name in the Out tab when it reads differently. */
const AN = {
  fade:     { fa: 'محو', en: 'Fade', ic: '#i-blend', k: 'tmsp', d: 0.5, by: ['whole', 'letter', 'word', 'line'], obj: p => ({ a: AE.io(p) }), unit: p => ({ a: AE.io(p) }) },
  rise:     { fa: 'بالا آمدن', en: 'Rise', ofa: 'پایین رفتن', oen: 'Sink', ic: '#i-arrow-up-from-line', k: 'tmsp', d: 0.6, by: ['whole', 'letter', 'word', 'line'],
              obj: (p, C) => { const e = AE.out(p); return { a: e, y: (1 - e) * 0.08 * C.H }; }, unit: (p, C, U) => { const e = AE.out(p); return { a: e, y: (1 - e) * U.lh * 0.7 }; } },
  typewriter: { fa: 'ماشین‌تحریر', en: 'Typewriter', ic: '#i-keyboard', k: 't', d: 1.2, by: ['letter', 'word'], u: 0, unit: p => (p > 0 ? null : { a: 0 }) },
  ascend:   { fa: 'صعود', en: 'Ascend', ic: '#i-chevrons-up', k: 't', d: 0.9, by: ['word', 'line', 'letter'], unit: (p, C, U) => { const e = AE.out(p); return { a: e, y: (1 - e) * U.lh }; } },
  shift:    { fa: 'جابه‌جایی', en: 'Shift', ic: '#i-arrow-left-right', k: 't', d: 0.8, by: ['letter', 'word'], unit: (p, C, U) => { const e = AE.out(p); return { a: e, x: (C.rtl ? -1 : 1) * (1 - e) * U.px * 1.1 }; } },
  pan:      { fa: 'لغزیدن', en: 'Pan', ic: '#i-move-horizontal', k: 'tmsp', d: 0.6, dir: 1, obj: (p, C) => { const e = AE.out(p), v = DIRV[C.dir]; return { a: e, x: v[0] * (1 - e) * 0.1 * C.W, y: v[1] * (1 - e) * 0.1 * C.H }; } },
  slide:    { fa: 'آمدن از لبه', en: 'Slide in', ofa: 'رفتن به لبه', oen: 'Slide out', ic: '#i-arrow-right-to-line', k: 'tmsp', d: 0.7, dir: 1, obj: (p, C) => { const e = AE.out5(p), v = DIRV[C.dir], L = edgeDist(C); return { x: v[0] * (1 - e) * L, y: v[1] * (1 - e) * L }; } },
  pop:      { fa: 'پاپ', en: 'Pop', ic: '#i-sparkle', k: 'tmsp', d: 0.5, by: ['whole', 'letter', 'word'], obj: p => ({ a: ac01(p * 4), s: Math.max(1e-3, AE.back(p)) }), unit: p => ({ a: ac01(p * 4), s: Math.max(1e-3, AE.back(p)) }) },
  bounce:   { fa: 'جهش', en: 'Bounce', ic: '#i-arrow-down-to-line', k: 'tsp', d: 0.8, by: ['whole', 'letter', 'word'], dBy: 'letter', obj: (p, C) => ({ a: ac01(p * 5), y: -(1 - AE.bounce(p)) * 0.3 * C.H }), unit: (p, C, U) => ({ a: ac01(p * 5), y: -(1 - AE.bounce(p)) * U.lh * 1.4 }) },
  burst:    { fa: 'انفجار', en: 'Burst', ic: '#i-party-popper', k: 't', d: 0.8, by: ['letter', 'word'], random: 1, unit: (p, C, U) => ({ a: ac01(p * 3), s: Math.max(1e-3, AE.back(p)), r: (1 - p) * (U.rnd - 0.5) * 70 }) },
  roll:     { fa: 'غلتیدن', en: 'Roll', ic: '#i-rotate-ccw', k: 't', d: 0.8, by: ['letter', 'word'], unit: (p, C, U) => { const e = AE.out(p); return { a: e, r: (C.rtl ? 1 : -1) * (1 - e) * 90, y: (1 - e) * U.lh * 0.2, pivot: 'bottom' }; } },
  wave:     { fa: 'موج', en: 'Wave', ic: '#i-audio-waveform', k: 't', d: 0.9, by: ['letter', 'word'], unit: (p, C, U) => ({ a: ac01(p * 3), y: (1 - AE.back(p)) * U.lh * 0.9 }) },
  tumble:   { fa: 'غلت', en: 'Tumble', ic: '#i-dices', k: 'tms', d: 0.7, by: ['whole', 'letter', 'word'], dBy: 'word',
              obj: (p, C) => { const e = AE.out(p); return { a: e, r: -(1 - e) * 35, y: -(1 - e) * 0.08 * C.H }; }, unit: (p, C, U) => { const e = AE.out(p); return { a: e, r: (1 - e) * (U.i % 2 ? 42 : -42), y: -(1 - e) * U.lh * 0.9 }; } },
  stomp:    { fa: 'کوبیدن', en: 'Stomp', ic: '#i-hammer', k: 'ts', d: 0.5, by: ['whole', 'letter', 'word'], dBy: 'word', obj: stompF, unit: stompF },
  baseline: { fa: 'از زیرِ خط', en: 'Baseline', ic: '#i-baseline', k: 'tm', d: 0.6, by: ['line', 'word'], clip: 1, obj: p => ({ inner: { y: 1 - AE.out(p) } }), unit: (p, C, U) => ({ y: (1 - AE.out(p)) * U.lh * 1.05 }) },
  block:    { fa: 'بلوک', en: 'Block', ic: '#i-square', k: 't', d: 0.9, by: ['line', 'word'], unit: p => (p >= 1 ? null : { block: p }) },
  merge:    { fa: 'ادغام', en: 'Merge', ic: '#i-merge', k: 't', d: 0.8, by: ['line', 'word'], unit: (p, C, U) => { const e = AE.out5(p); return { a: e, x: (U.i % 2 ? 1 : -1) * (1 - e) * C.W * 0.3 }; } },
  spread:   { fa: 'باز شدن', en: 'Spread', ic: '#i-unfold-horizontal', k: 't', d: 0.8, by: ['letter'], stagger: p => p, unit: (p, C, U) => { const e = AE.out(p); return { a: e, x: (U.cx - U.lineCx) * 1.5 * (1 - e) }; } },
  skate:    { fa: 'اسکیت', en: 'Skate', ic: '#i-move-right', k: 't', d: 0.8, obj: (p, C) => { const e = AE.out5(p), sd = C.rtl ? 1 : -1; return { a: ac01(p * 3), x: sd * (1 - e) * 0.25 * C.W, k: -sd * (1 - e) * 22 }; } },
  neon:     { fa: 'نئون', en: 'Neon', ic: '#i-lightbulb', k: 'ts', d: 0.9, by: ['whole', 'letter'], obj: neonF, unit: neonF, stagger: (p, k, n, U) => ac01((p - U.rnd * 0.45) / 0.55) },
  grow:     { fa: 'بزرگ شدن', en: 'Grow', ofa: 'کوچک شدن', oen: 'Shrink', ic: '#i-maximize-2', k: 'tmsp', d: 0.5, obj: p => ({ a: ac01(p * 2.5), s: 0.3 + 0.7 * AE.out(p) }) },
  zoomout:  { fa: 'زوم به عقب', en: 'Zoom out', ofa: 'زوم به جلو', oen: 'Zoom in', ic: '#i-zoom-out', k: 'mp', d: 0.6, obj: p => { const e = AE.out(p); return { a: e, s: 1.6 - 0.6 * e }; } },
  cropzoom: { fa: 'زومِ درونِ قاب', en: 'Crop zoom', ic: '#i-crop', k: 'm', d: 0.7, obj: p => { const e = AE.out(p); return { a: e, inner: { z: 1.35 - 0.35 * e } }; } },
  wipe:     { fa: 'پرده', en: 'Wipe', ic: '#i-panel-left-open', k: 'tmsp', d: 0.6, dir: 1, obj: (p, C) => ({ mask: { t: 'wipe', d: C.dir, p: AE.io(p) } }) },
  iris:     { fa: 'دایره', en: 'Circle', ic: '#i-circle-dot', k: 'msp', d: 0.6, obj: p => ({ mask: { t: 'iris', p: AE.io(p) } }) },
  clarify:  { fa: 'واضح شدن', en: 'Clarify', ofa: 'تار شدن', oen: 'Blur', ic: '#i-focus', k: 'tm', d: 0.7, obj: p => { const e = AE.out(p); return { a: ac01(p * 2), b: (1 - e) * 26, s: 1.06 - 0.06 * e }; } },
  spin:     { fa: 'چرخش', en: 'Spin', ic: '#i-rotate-cw', k: 'ms', d: 0.6, obj: p => { const e = AE.out(p); return { a: ac01(p * 3), r: -(1 - e) * 180, s: 0.3 + 0.7 * e }; } },
  flip:     { fa: 'ورق', en: 'Flip', ic: '#i-flip-horizontal-2', k: 'ms', d: 0.6, obj: p => ({ a: ac01(p * 3), sx: Math.max(1e-3, Math.sin(AE.out(p) * Math.PI / 2)) }) },
  swing:    { fa: 'آویختن', en: 'Swing', ic: '#i-bell', k: 's', d: 0.9, obj: p => ({ a: ac01(p * 4), r: 70 * (1 - p) * (1 - p) * Math.cos(p * Math.PI * 3.5), pivot: [0, -0.5] }) },
  elastic:  { fa: 'کشسان', en: 'Elastic', ic: '#i-waves', k: 's', d: 0.8, obj: p => { const w = Math.sin(p * Math.PI * 4) * (1 - p) * 0.2; return { a: ac01(p * 4), s: Math.max(1e-3, AE.elastic(p)), sx: 1 + w, sy: 1 - w }; } },
  drift:    { fa: 'شناور', en: 'Drift', ic: '#i-wind', k: 'tmsp', d: 1.4, dir: 1, obj: (p, C) => { const e = AE.out5(p), v = DIRV[C.dir]; return { a: AE.io(p), x: v[0] * (1 - e) * 0.06 * C.W, y: v[1] * (1 - e) * 0.06 * C.H }; } },
  glitch:   { fa: 'گلیچ', en: 'Glitch', ic: '#i-zap', k: 'tm', d: 0.6, obj: p => ({ a: p < 0.08 ? 0 : 1, glitch: p < 0.92 ? 1 - p : 0, seed: Math.floor(p * 26) }) },
};
/* Loop presets (between In and Out). prog: runs once across the whole stretch (a camera move) instead of repeating. */
const ANL = {
  breathe:  { fa: 'نفس', en: 'Breathe', ic: '#i-heart', k: 'tmsp', obj: (t, v) => ({ s: 1 + 0.035 * Math.sin(2 * Math.PI * t * v / 2.4) }) },
  float:    { fa: 'معلق', en: 'Float', ic: '#i-cloud-fog', k: 'tmsp', obj: (t, v, C) => ({ y: -0.014 * C.H * Math.sin(2 * Math.PI * t * v / 3) }) },
  pulse:    { fa: 'تپش', en: 'Pulse', ic: '#i-heart-pulse', k: 'tmsp', obj: (t, v) => { const c = (t * v) % 1.2, b = Math.exp(-Math.pow((c - 0.15) / 0.06, 2)) + 0.6 * Math.exp(-Math.pow((c - 0.4) / 0.06, 2)); return { s: 1 + 0.07 * b }; } },
  sway:     { fa: 'نوسان', en: 'Sway', ic: '#i-move-diagonal', k: 'tms', obj: (t, v) => ({ r: 4 * Math.sin(2 * Math.PI * t * v / 2.6) }) },
  wiggle:   { fa: 'لرزش', en: 'Wiggle', ic: '#i-vibrate', k: 'ts', obj: (t, v) => { const c = (t * v) % 1.8, e = c < 0.6 ? Math.sin(Math.PI * c / 0.6) : 0; return { r: 7 * e * Math.sin(c * 40) }; } },
  shake:    { fa: 'تکان', en: 'Shake', ic: '#i-activity', k: 'tms', obj: (t, v, C) => ({ x: 0.006 * C.H * anNoise(t * v * 9, 1), y: 0.006 * C.H * anNoise(t * v * 9, 2), r: 1.2 * anNoise(t * v * 7, 3) }) },
  wave:     { fa: 'موجِ حروف', en: 'Letter wave', ic: '#i-audio-waveform', k: 't', unit: (t, v, C, U) => ({ y: -0.2 * U.lh * Math.sin(2 * Math.PI * t * v / 1.4 - U.i * 0.55) }) },
  hop:      { fa: 'حروفِ جهنده', en: 'Letter hop', ic: '#i-chevrons-up', k: 't', unit: hopF },
  neon:     { fa: 'نئون', en: 'Neon', ic: '#i-lightbulb', k: 't', obj: (t, v) => { const r = anHash(Math.floor(t * v * 10) + 0.25); return { glow: 0.75 + 0.25 * Math.sin(2 * Math.PI * t * v / 1.8), a: r < 0.04 ? 0.6 : 1 }; } },
  flicker:  { fa: 'سوسو', en: 'Flicker', ic: '#i-zap-off', k: 'ts', obj: (t, v) => { const r = anHash(Math.floor(t * v * 14) + 0.5); return { a: r < 0.13 ? 0.2 + r * 3 : 1 }; } },
  blink:    { fa: 'چشمک', en: 'Blink', ic: '#i-eye', k: 'ts', obj: (t, v) => ({ a: 0.6 + 0.4 * Math.cos(2 * Math.PI * t * v / 1.6) }) },
  jump:     { fa: 'پرش', en: 'Jump', ic: '#i-footprints', k: 'ts', obj: jumpF },
  squeeze:  { fa: 'فشار', en: 'Squeeze', ic: '#i-stretch-horizontal', k: 's', obj: (t, v) => { const q = 0.09 * Math.sin(2 * Math.PI * t * v / 1.1); return { sx: 1 + q, sy: 1 - q }; } },
  swing:    { fa: 'آونگ', en: 'Swing', ic: '#i-bell', k: 's', obj: (t, v) => ({ r: 14 * Math.sin(2 * Math.PI * t * v / 2), pivot: [0, -0.5] }) },
  spin:     { fa: 'گردش', en: 'Spin', ic: '#i-refresh-cw', k: 's', prog: 1, obj: (q, v, C, len) => ({ r: 360 * Math.max(1, Math.round(len * v / 4)) * q }) },
  kbin:     { fa: 'زومِ آرام به جلو', en: 'Slow zoom in', ic: '#i-zoom-in', k: 'mb', prog: 1, obj: (q, v) => ({ inner: { z: 1 + 0.14 * v * q } }) },
  kbout:    { fa: 'زومِ آرام به عقب', en: 'Slow zoom out', ic: '#i-zoom-out', k: 'mb', prog: 1, obj: (q, v) => ({ inner: { z: 1 + 0.14 * v * (1 - q) } }) },
  slowpan:  { fa: 'حرکتِ آرام', en: 'Slow pan', ic: '#i-move-horizontal', k: 'mb', prog: 1, dir: 1, obj: (q, v, C) => { const f = 0.5 + (q - 0.5) * Math.min(1, 0.5 * v), I = { z: 1.1 + 0.04 * v };
              if (C.dir === 'left') I.px = f; else if (C.dir === 'right') I.px = 1 - f; else if (C.dir === 'up') I.py = f; else I.py = 1 - f; return { inner: I }; } },
  handheld: { fa: 'دوربینِ روی دست', en: 'Handheld', ic: '#i-camera', k: 'mb', obj: (t, v) => ({ inner: { z: 1.05, x: 0.012 * anNoise(t * v * 0.8, 4), y: 0.012 * anNoise(t * v * 0.8, 5) } }) },
};
/* the text background's own In / Out */
const AN_BG = [['follow', 'همراهِ متن', 'With the text', '#i-link'], ['none', 'ثابت', 'Still', '#i-pin'], ['fade', 'محو', 'Fade', '#i-blend'], ['grow', 'باز شدن از وسط', 'From the center', '#i-unfold-horizontal'],
  ['wipe', 'کشیده شدن', 'Stretch', '#i-arrow-right-to-line'], ['pop', 'پاپ', 'Pop', '#i-sparkle'], ['drop', 'افتادن', 'Drop', '#i-arrow-down-to-line'], ['rise', 'بالا آمدن', 'Rise', '#i-arrow-up-from-line'],
  ['draw', 'کشیدنِ دور', 'Outline', '#i-spline'], ['marker', 'ماژیک', 'Highlighter', '#i-scan-line']];
const AN_BY = { whole: ['کامل', 'Whole'], line: ['خط', 'Line'], word: ['کلمه', 'Word'], letter: ['حرف', 'Letter'] };

// ---- the model
function animKind(o){ if (!o) return null; if (o.type === 'text') return 't'; if (o.type === 'image' || o.type === 'video') return o.bgl ? 'b' : 'm'; if (o.type === 'sticker') return 's'; if (o.type === 'pod') return o.bgl ? null : 'p'; return null; }
function animRtl(o){ return o && o.type === 'text' ? AR_L.test(o.text || '') : lang === 'fa'; }
function defDir(o, which){ const r = animRtl(o); return which === 'in' ? (r ? 'right' : 'left') : which === 'out' ? (r ? 'left' : 'right') : 'left'; }
/* projects from before 175 kept { in, out, loop, speed, bgIn, bgDelay } */
function migrateAnim(o){ const a = o.anim; if (a && a.v === 2) return a; const m = { v: 2 }; if (!a){ o.anim = m; return m; }
  const sp = a.speed || 5, d = Math.max(0.15, 1.25 - sp * 0.1), IN = { type: 'typewriter', fade: 'fade', rise: 'rise', pop: 'pop' }, OUT = { fade: 'fade', down: 'rise', shrink: 'grow' }, LOOP = { breathe: 'breathe', wave: 'sway' };
  if (IN[a.in]){ m.in = IN[a.in]; m.inDur = a.in === 'type' ? d * 2.2 : d; if (a.in === 'type') m.inBy = 'word'; }
  if (OUT[a.out]){ m.out = OUT[a.out]; m.outDur = d; }
  if (LOOP[a.loop]){ m.loop = LOOP[a.loop]; m.loopSpeed = Math.round((0.25 + sp * 0.06) / 0.42 * 20) / 20; }
  if (a.bgIn && a.bgIn !== 'none'){ m.bgIn = { open: 'grow', stretch: 'wipe', fade: 'fade' }[a.bgIn] || 'fade'; m.bgInAt = a.bgDelay < 0 ? 'before' : a.bgDelay > 0 ? 'after' : 'with'; }
  o.anim = m; return m; }
function animOf(o){ if (!o) return null; if (ANPV && ANPV.id === o.id) return ANPV.anim; return o.anim ? (o.anim.v === 2 ? o.anim : migrateAnim(o)) : null; }
const bgAnimOn = (o, k) => !!(o.type === 'text' && o.bg && o.bg.on && o.anim && o.anim[k] && o.anim[k] !== 'follow' && o.anim[k] !== 'none');
function animTimes(o, a, kd){ const st = o.start || 0, en = o.end == null ? projEnd() : o.end, D = Math.max(0.05, en - st), half = D / 2;
  const okIn = kd !== 'b' && a.in && AN[a.in] && AN[a.in].k.includes(kd), okOut = kd !== 'b' && a.out && AN[a.out] && AN[a.out].k.includes(kd);
  const bi = kd === 't' && o.bg && o.bg.on && a.bgIn && a.bgIn !== 'follow' && a.bgIn !== 'none', bo = kd === 't' && o.bg && o.bg.on && a.bgOut && a.bgOut !== 'follow' && a.bgOut !== 'none';
  const inD = okIn || bi ? Math.min(a.inDur ?? (okIn ? AN[a.in].d : 0.6), half) : 0, outD = okOut || bo ? Math.min(a.outDur ?? (okOut ? AN[a.out].d : 0.6), half) : 0;
  return { st, en, D, inD, outD, ls: st + inD, le: en - outD }; }
function byOf(kd, P, v){ return kd !== 't' || !P.by ? 'whole' : P.by.includes(v) ? v : (P.dBy || P.by[0]); }
function animPhase(o, a, T, t, kd){
  if (T.inD && t < T.ls){ const P = a.in && AN[a.in] && AN[a.in].k.includes(kd) ? AN[a.in] : null; return { which: 'in', P, id: P ? a.in : 'none', p: ac01((t - T.st) / T.inD), dir: a.inDir || defDir(o, 'in'), by: P ? byOf(kd, P, a.inBy) : 'whole', each: !!a.inEach }; }
  if (T.outD && t > T.le){ const P = a.out && AN[a.out] && AN[a.out].k.includes(kd) ? AN[a.out] : null; return { which: 'out', P, id: P ? a.out : 'none', p: ac01((T.en - t) / T.outD), dir: a.outDir || defDir(o, 'out'), by: P ? byOf(kd, P, a.outBy) : 'whole', each: !!a.outEach }; }
  return null; }
const animCtx = (o, W, H, dir) => ({ o, W, H, dir: dir || 'left', rtl: animRtl(o) });
function mergeS(S, P, e = 1){ if (!P) return S; S = S || { ...ANID };
  if (P.a != null) S.a *= 1 + (P.a - 1) * e; if (P.x) S.x += P.x * e; if (P.y) S.y += P.y * e;
  if (P.s != null) S.s *= 1 + (P.s - 1) * e; if (P.sx != null) S.sx *= 1 + (P.sx - 1) * e; if (P.sy != null) S.sy *= 1 + (P.sy - 1) * e;
  if (P.r) S.r += P.r * e; if (P.k) S.k += P.k * e; if (P.b) S.b += P.b * e; if (P.glow) S.glow = Math.max(S.glow, P.glow * e); if (P.glitch) S.glitch = Math.max(S.glitch, P.glitch * e);
  if (P.mask) S.mask = P.mask; if (P.pivot) S.pivot = P.pivot; if (P.seed != null) S.seed = P.seed;
  if (P.inner){ const I = S.inner = S.inner ? { ...S.inner } : { z: 1, x: 0, y: 0 }; if (P.inner.z != null) I.z *= 1 + (P.inner.z - 1) * e; if (P.inner.x) I.x += P.inner.x * e; if (P.inner.y) I.y += P.inner.y * e; if (P.inner.px != null) I.px = P.inner.px; if (P.inner.py != null) I.py = P.inner.py; }
  return S; }
/* a Loop preset's state at t → [state, envelope] (the envelope eases it in after In and out before Out) */
function loopAt(L, o, a, T, t, W, H, ph0 = 0){ const v = a.loopSpeed || 1, C = animCtx(o, W, H, a.loopDir || defDir(o, 'loop')), len = Math.max(0.01, T.le - T.ls);
  if (L.prog) return [L.obj(ac01((t - T.ls) / len), v, C, len), 1];
  if (t <= T.ls || t >= T.le) return null; const tau = t - T.ls; return [L.obj ? L.obj(tau + ph0, v, C) : null, Math.min(1, tau / 0.35, (T.le - t) / 0.35), tau]; }
/* the whole-object state of a picture, video or sticker at t (text works out its own, below) */
function animState(o, t, W, H){ const kd = animKind(o); if (!kd) return null; const a = animOf(o); if (!a) return null; const T = animTimes(o, a, kd); let S = null;
  const ph = kd === 'b' ? null : animPhase(o, a, T, t, kd); if (ph && ph.P && ph.P.obj) S = mergeS(S, ph.P.obj(ph.p, animCtx(o, W, H, ph.dir)));
  const L = a.loop && ANL[a.loop] && ANL[a.loop].k.includes(kd) ? ANL[a.loop] : null; if (L && L.obj){ const r = loopAt(L, o, a, T, t, W, H); if (r) S = mergeS(S, r[0], r[1]); }
  return S; }
function unitP(p, i, n, u){ if (n <= 1) return p; if (u <= 0) return p * n > i ? 1 : 0; return ac01((p - i * (1 - u) / (n - 1)) / u); }
function anPerm(n, seed){ const a = [...Array(n).keys()]; for (let i = n - 1; i > 0; i--){ const j = Math.floor(anHash(seed + i * 1.618) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const anSeed = o => [...String(o.id || 'x')].reduce((s, c) => s + c.charCodeAt(0), 0);
const isRest = s => !s || ((s.a == null || s.a >= 0.999) && !s.x && !s.y && !s.r && (s.s == null || s.s === 1) && (s.sx == null || s.sx === 1) && (s.sy == null || s.sy === 1) && !s.glow && s.block == null);

// ---- painting under a state: transforms, wipe and circle masks, and a layer when the object fades, blurs or glitches
const LAYERS = []; let LDEPTH = 0;
function layerBegin(ctx){ const W = ctx.canvas.width, H = ctx.canvas.height; let c = LAYERS[LDEPTH]; if (!c) c = LAYERS[LDEPTH] = document.createElement('canvas'); if (c.width !== W || c.height !== H){ c.width = W; c.height = H; }
  LDEPTH++; const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, W, H); g.setTransform(ctx.getTransform()); return g; }
function layerEnd(ctx, g, alpha, blur, glitch, seed){ let src = g.canvas; if (blur > 0.4){ const b = FXGL.blur(src, blur); if (b) src = b; }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= alpha; if (glitch > 0.01) drawGlitch(ctx, src, glitch, seed || 0); else ctx.drawImage(src, 0, 0); ctx.restore(); LDEPTH--; }   /* the depth drops last: the glitch borrows the next layer as scratch */
function maskRect(g, m, x, y, w, h){ g.beginPath(); const p = m.p;
  if (m.t === 'iris') g.arc(x + w / 2, y + h / 2, Math.max(0.01, p * Math.hypot(w, h) * 0.52), 0, Math.PI * 2);
  else { const M = Math.max(w, h); if (m.d === 'left') g.rect(x - M * 0.02, y - M, w * p + M * 0.02, h + 2 * M); else if (m.d === 'right') g.rect(x + w * (1 - p), y - M, w * p + M * 0.02, h + 2 * M);
    else if (m.d === 'up') g.rect(x - M, y - M * 0.02, w + 2 * M, h * p + M * 0.02); else g.rect(x - M, y + h * (1 - p), w + 2 * M, h * p + M * 0.02); }
  g.clip(); }
function paintState(ctx, S, cx, cy, w, h, rot, alpha, H, fn, mb){ S = S || ANID; const a = alpha * S.a; if (a <= 0.002) return;
  const blur = S.b > 0 ? S.b * H / 1080 : 0, layered = a < 0.999 || blur > 0.4 || S.glitch > 0.01, g = layered ? layerBegin(ctx) : ctx;
  g.save(); g.translate(cx + S.x, cy + S.y); if (rot) g.rotate(rot * Math.PI / 180);
  if (S.r || S.k || S.s !== 1 || S.sx !== 1 || S.sy !== 1){ const px = S.pivot ? S.pivot[0] * w : 0, py = S.pivot ? S.pivot[1] * h : 0; g.translate(px, py); if (S.r) g.rotate(S.r * Math.PI / 180); if (S.k) g.transform(1, 0, Math.tan(S.k * Math.PI / 180), 1, 0, 0); g.scale(Math.max(1e-4, S.s * S.sx), Math.max(1e-4, S.s * S.sy)); g.translate(-px, -py); }
  if (S.mask && S.mask.p < 0.999){ if (mb) maskRect(g, S.mask, mb[0], mb[1], mb[2], mb[3]); else maskRect(g, S.mask, -w / 2, -h / 2, w, h); }
  fn(g, -w / 2, -h / 2, w, h, S); g.restore();
  if (layered) layerEnd(ctx, g, a, blur, S.glitch, S.seed); }
/* every picture, video and sticker draws through this; fn(g, x, y, w, h, state) must draw on g (it may be a layer) */
function withXform(ctx, o, W, H, fn){ paintState(ctx, animState(o, RT, W, H), (o.x + o.w / 2) * W, (o.y + o.h / 2) * H, o.w * W, o.h * H, o.rot || 0, o.opacity ?? 1, H, fn); }
function drawGlitch(ctx, src, gl, seed){ const W = src.width, H = src.height, n = 9;
  for (let i = 0; i < n; i++){ const y0 = Math.floor(H * i / n), hh = Math.min(Math.ceil(H / n) + 1, H - y0), dx = anHash(seed * 13.7 + i) < 0.45 ? (anHash(seed * 7.1 + i * 3.3) - 0.5) * 0.09 * W * gl : 0; if (hh > 0) ctx.drawImage(src, 0, y0, W, hh, dx, y0, W, hh); }
  const t = layerBegin(ctx); t.setTransform(1, 0, 0, 1, 0, 0);
  [['#ff2a55', -1], ['#22e6ff', 1]].forEach(([c, s]) => { t.globalCompositeOperation = 'source-over'; t.clearRect(0, 0, W, H); t.drawImage(src, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = c; t.fillRect(0, 0, W, H);
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha *= 0.32 * gl; ctx.drawImage(t.canvas, s * 0.01 * W * gl, 0); ctx.restore(); });
  LDEPTH--; }
/* a shadow without the shape that casts it — the old shadow filled a black box under the picture, which showed through every fade */
function shadowOnly(g, path, sh, H){ const m = g.getTransform(), sc = Math.hypot(m.a, m.b); if (sc < 1e-5) return; const D = (g.canvas.width + g.canvas.height) * 2 / sc, an = (sh.angle ?? 90) * Math.PI / 180, d = (sh.distance || 0) * H;
  g.save(); g.shadowColor = rgba(sh.color || '#000000', sh.opacity ?? 0.4); g.shadowBlur = (sh.blur || 0) * H; g.shadowOffsetX = Math.cos(an) * d - m.a * D; g.shadowOffsetY = Math.sin(an) * d - m.b * D;
  g.translate(D, 0); path(); g.fillStyle = '#000'; g.fill(); g.restore(); }

// ---- picture / video
function drawMedia(ctx, o, W, H, el){
  if (!el) return; const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight; if (!iw || !ih) return;
  withXform(ctx, o, W, H, (g, x, y, w, h, S) => { const r = (o.radius || 0) * H, sh = o.shadow || {}, st = o.stroke || {};
    const I = S && S.inner, s = (o.fit === 'contain' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih)) * (I ? I.z : 1), dw = iw * s, dh = ih * s;
    const pX = I && I.px != null ? I.px : (o.panX ?? 0.5), pY = I && I.py != null ? I.py : (o.panY ?? 0.5), dx = x + (w - dw) * pX + (I ? (I.x || 0) * w : 0), dy = y + (h - dh) * pY + (I ? (I.y || 0) * h : 0);
    if (sh.on){ const sp = (sh.spread || 0) * H, vx = Math.max(x, dx), vy = Math.max(y, dy), vw = Math.min(x + w, dx + dw) - vx, vh = Math.min(y + h, dy + dh) - vy;   /* cast by what is visible — never an empty frame */
      if (vw > 0.5 && vh > 0.5) shadowOnly(g, () => rrect(g, vx - sp, vy - sp, vw + sp * 2, vh + sp * 2, Math.min(r, vw / 2, vh / 2) + sp), sh, H); }
    g.save(); rrect(g, x, y, w, h, r); g.clip(); g.drawImage(adjSource(o, el, dw, dh, H), dx, dy, dw, dh); g.restore();
    if (st.on && st.width > 0){ g.save(); g.strokeStyle = rgba(st.color || '#fff', st.opacity ?? 1); g.lineWidth = st.width * H; const lw = g.lineWidth;
      g.setLineDash(st.style === 'dashed' ? [lw * 3, lw * 2] : st.style === 'dotted' ? [lw * 0.1, lw * 1.8] : []); g.lineCap = st.style === 'dotted' ? 'round' : 'butt'; rrect(g, x, y, w, h, r); g.stroke(); g.restore(); } });
}
/* brightness · contrast · saturation · hue · blur, through WebGL: the Mac app's WebKit has canvas filters switched off */
const ADJ_CACHE = [];
function adjSource(o, el, dw, dh, H){ const a = o.adj; if (!a) return el; const br = a.brightness ?? 1, ct = a.contrast ?? 1, sa = a.saturate ?? 1, hu = a.hue || 0, bl = a.blur || 0;
  if (br === 1 && ct === 1 && sa === 1 && !hu && !bl) return el;
  const k = Math.min(1, 4096 / Math.max(dw, dh)), ow = Math.max(1, Math.round(dw * k)), oh = Math.max(1, Math.round(dh * k)), sig = bl * H / 1080 * k, key = el.tagName !== 'VIDEO' ? [o.asset, br, ct, sa, hu, bl, ow, oh].join('|') : null;
  if (key){ const hit = ADJ_CACHE.find(c => c.key === key); if (hit) return hit.cv; }
  let out = null; try { out = FXGL.adjust(el, { br, ct, sa, hu }, ow, oh, sig); } catch (e) { out = null; } if (!out) return el;
  if (key){ const cv = document.createElement('canvas'); cv.width = ow; cv.height = oh; cv.getContext('2d').drawImage(out, 0, 0); ADJ_CACHE.unshift({ key, cv }); if (ADJ_CACHE.length > 4) ADJ_CACHE.pop(); return cv; }
  return out; }
const FXGL = (() => {
  let gl = null, cv = null, P = null, quad = null, src0 = null; const F = [];
  const VS = 'attribute vec2 p; varying vec2 v; void main(){ v = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const FS = { copy: 'precision mediump float; varying vec2 v; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, v); }',
    color: 'precision highp float; varying vec2 v; uniform sampler2D t; uniform mat3 M; uniform float br; uniform float ct; void main(){ vec4 c = texture2D(t, v); vec3 x = clamp(c.rgb * br, 0.0, 1.0); x = clamp((x - 0.5) * ct + 0.5, 0.0, 1.0); x = clamp(M * x, 0.0, 1.0); gl_FragColor = vec4(x * c.a, c.a); }',
    blur: 'precision highp float; varying vec2 v; uniform sampler2D t; uniform vec2 d; uniform float s; void main(){ vec4 a = vec4(0.0); float ws = 0.0; for (int i = -12; i <= 12; i++){ float x = float(i); float w = exp(-0.5 * x * x / (s * s)); a += texture2D(t, v + d * x) * w; ws += w; } gl_FragColor = a / ws; }' };
  function init(){ if (gl !== null) return !!gl; try { cv = document.createElement('canvas'); cv.width = cv.height = 4; gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true }) || false; } catch (e) { gl = false; } if (!gl) return false;
    const sh = (type, s) => { const x = gl.createShader(type); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const mk = fs => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); const u = {}; ['t', 'M', 'br', 'ct', 'd', 's'].forEach(n => u[n] = gl.getUniformLocation(p, n)); return { p, u }; };
    try { P = { copy: mk(FS.copy), color: mk(FS.color), blur: mk(FS.blur) }; } catch (e) { console.warn('fx', e); gl = false; return false; }
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW); src0 = tex(); return true; }
  function tex(){ const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]].forEach(([k, v]) => gl.texParameteri(gl.TEXTURE_2D, k, v)); return t; }
  function fb(k, w, h){ let f = F[k]; if (!f) f = F[k] = { t: tex(), f: gl.createFramebuffer(), w: 0, h: 0 };
    if (f.w !== w || f.h !== h){ gl.bindTexture(gl.TEXTURE_2D, f.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); gl.bindFramebuffer(gl.FRAMEBUFFER, f.f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, f.t, 0); f.w = w; f.h = h; } return f; }
  function pass(prog, t, out, w, h, set){ gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.f : null); gl.viewport(0, 0, w, h); gl.useProgram(prog.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(prog.u.t, 0); if (set) set(prog.u);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.disable(gl.BLEND); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  function upload(s, premul){ gl.bindTexture(gl.TEXTURE_2D, src0); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!premul); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, s); return src0; }
  /* separable Gaussian; wide radii are blurred on a halved (and halved again) copy and scaled back up */
  function blurTo(t, w, h, sigma){ let k = 0, cw = w, ch = h, cur = t;
    while (sigma / Math.pow(2, k) > 3 && Math.min(cw, ch) > 8){ const nw = Math.max(1, cw >> 1), nh = Math.max(1, ch >> 1), f = fb(3 + k, nw, nh); pass(P.copy, cur, f, nw, nh); cur = f.t; cw = nw; ch = nh; k++; }
    const s = Math.max(0.5, sigma / Math.pow(2, k)), A = fb(1, cw, ch), B = fb(2, cw, ch);
    pass(P.blur, cur, B, cw, ch, u => { gl.uniform2f(u.d, 1 / cw, 0); gl.uniform1f(u.s, s); }); pass(P.blur, B.t, A, cw, ch, u => { gl.uniform2f(u.d, 0, 1 / ch); gl.uniform1f(u.s, s); }); return A.t; }
  function out(t, w, h){ if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h; pass(P.copy, t, null, w, h); return cv; }
  function colorMat(s, deg){ const h = deg * Math.PI / 180, c = Math.cos(h), n = Math.sin(h);
    const S = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
    const R = [0.213 + c * 0.787 - n * 0.213, 0.715 - c * 0.715 - n * 0.715, 0.072 - c * 0.072 + n * 0.928, 0.213 - c * 0.213 + n * 0.143, 0.715 + c * 0.285 + n * 0.140, 0.072 - c * 0.072 - n * 0.283, 0.213 - c * 0.213 - n * 0.787, 0.715 - c * 0.715 + n * 0.715, 0.072 + c * 0.928 + n * 0.072];
    const M = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++){ let v = 0; for (let q = 0; q < 3; q++) v += R[i * 3 + q] * S[q * 3 + j]; M[i * 3 + j] = v; }
    return new Float32Array([M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]); }
  return {
    adjust(s, a, w, h, sigma){ if (!init() || gl.isContextLost()) return null; const M = colorMat(a.sa, a.hu), t0 = upload(s, false), setC = u => { gl.uniformMatrix3fv(u.M, false, M); gl.uniform1f(u.br, a.br); gl.uniform1f(u.ct, a.ct); };
      if (sigma > 0.4){ const C = fb(0, w, h); pass(P.color, t0, C, w, h, setC); return out(blurTo(C.t, w, h, sigma), w, h); }
      if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h; pass(P.color, t0, null, w, h, setC); return cv; },
    blur(s, sigma){ if (!init() || gl.isContextLost()) return null; const w = s.width, h = s.height; if (!w || !h) return null; return out(blurTo(upload(s, true), w, h, sigma), w, h); },
  };
})();

// ---- text: lines → words → letters, laid out with the bidi order of mixed Persian/English lines
const AR_L = /[\u0620-\u064A\u066E-\u06D3\u06D5\u06EE\u06EF\u06FA-\u06FC\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/;
const LAT_L = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/;
let GSEG = null; try { GSEG = new Intl.Segmenter(undefined, { granularity: 'grapheme' }); } catch (e) { GSEG = null; }
const graphemes = s => GSEG ? Array.from(GSEG.segment(s), x => x.segment) : (s.match(/[\s\S][\u0300-\u036F\u064B-\u065F\u0670\u06D6-\u06ED\u200C\u200D\uFE0F]*/g) || []);
const TLC = new Map();
function textLayout(g, o, H, w){
  const px = Math.max(6, o.size * H), font = FONT(o.weight || 700, px, o.font), key = (o.text || '') + '\u0001' + font + '|' + w.toFixed(1) + '|' + (o.align || 'center') + '|' + (o.autoW === true ? 'a' : 'f');
  let L = TLC.get(key); if (L) return L; if (TLC.size > 240) TLC.clear();
  g.save(); g.font = font; const text = o.text || '', rtl = AR_L.test(text), sp = g.measureText(' ').width, lh = px * 1.35, maxW = o.autoW === true ? 1e9 : w * 0.96;   // 176: an auto-width text never wraps (its box follows it)
  const mk = s => { const dir = AR_L.test(s) ? 'r' : LAT_L.test(s) ? 'l' : 'n'; g.direction = dir === 'r' ? 'rtl' : 'ltr'; return { text: s, dir, w: g.measureText(s).width, lx: null }; };
  const rows = []; text.split('\n').forEach(par => { let cur = [], cw = 0; par.split(/\s+/).filter(Boolean).forEach(s => { const wd = mk(s), nw = cur.length ? cw + sp + wd.w : wd.w; if (nw > maxW && cur.length){ rows.push(cur); cur = [wd]; cw = wd.w; } else { cur.push(wd); cw = nw; } }); rows.push(cur); });
  const th = rows.length * lh, by = -th / 2; let tw = 0, wi = 0;
  const lines = rows.map((ws, li) => {
    const res = ws.map((wd, k) => { if (wd.dir !== 'n') return wd.dir; let pv = null, nx = null; for (let j = k - 1; j >= 0 && !pv; j--) if (ws[j].dir !== 'n') pv = ws[j].dir; for (let j = k + 1; j < ws.length && !nx; j++) if (ws[j].dir !== 'n') nx = ws[j].dir; return pv && pv === nx ? pv : (rtl ? 'r' : 'l'); });
    const runs = []; res.forEach((d, k) => { const r = runs[runs.length - 1]; if (r && r.d === d) r.ks.push(k); else runs.push({ d, ks: [k] }); });
    const vis = []; (rtl ? runs.slice().reverse() : runs).forEach(r => (r.d === 'r' ? r.ks.slice().reverse() : r.ks).forEach(k => vis.push(k)));
    const lw = ws.reduce((s, wd) => s + wd.w, 0) + sp * Math.max(0, ws.length - 1); tw = Math.max(tw, lw);
    const x0 = o.align === 'center' ? -lw / 2 : o.align === 'right' ? w / 2 - lw : -w / 2, cy = by + lh * (li + 0.5); let x = x0; const words = [];
    vis.forEach(k => { words[k] = { ...ws[k], x, cy, li }; x += ws[k].w + sp; }); words.forEach(wd => { wd.wi = wi++; });
    return { words, x0, lw, cy, li }; });
  g.restore();
  L = { font, px, lh, sp, rtl, lines, tw, th, bx: o.align === 'center' ? -tw / 2 : o.align === 'right' ? w / 2 - tw : -w / 2, by, u: {} }; TLC.set(key, L); return L; }
/* each letter's slice of its word — measured with a zero-width joiner so a Persian letter keeps the joined form it has in the word */
function wordLetters(g, wd, L){ if (wd.lx) return wd.lx; g.save(); g.font = L.font; g.direction = wd.dir === 'r' ? 'rtl' : 'ltr'; const gs = graphemes(wd.text), adv = [0]; let pre = '';
  for (let k = 0; k < gs.length; k++){ pre += gs[k]; const nx = gs[k + 1], join = nx && wd.dir === 'r' && AR_L.test(gs[k]) && !gs[k].includes('\u200C') && AR_L.test(nx[0]) && nx[0] !== '\u0621'; adv.push(k === gs.length - 1 ? wd.w : g.measureText(join ? pre + '\u200D' : pre).width); }
  g.restore(); const out = []; let prev = 0;
  for (let k = 0; k < gs.length; k++){ const a0 = prev, a1 = Math.max(a0, Math.min(wd.w, adv[k + 1])); prev = a1; out.push(wd.dir === 'r' ? { x0: wd.w - a1, x1: wd.w - a0 } : { x0: a0, x1: a1 }); }
  return (wd.lx = out); }
function textUnits(g, L, by){ if (L.u[by]) return L.u[by]; let list = [];
  if (by === 'whole') list = [{ x0: L.bx, x1: L.bx + L.tw, y0: L.by, y1: L.by + L.th }];
  else if (by === 'line') list = L.lines.map(ln => ({ x0: ln.x0, x1: ln.x0 + ln.lw, y0: ln.cy - L.lh / 2, y1: ln.cy + L.lh / 2, line: ln }));
  else L.lines.forEach(ln => ln.words.forEach(wd => { if (by === 'word') list.push({ x0: wd.x, x1: wd.x + wd.w, y0: ln.cy - L.lh / 2, y1: ln.cy + L.lh / 2, word: wd, line: ln });
    else wordLetters(g, wd, L).forEach((lt, k) => list.push({ x0: wd.x + lt.x0, x1: wd.x + lt.x1, y0: ln.cy - L.lh / 2, y1: ln.cy + L.lh / 2, word: wd, k, line: ln })); }));
  list.forEach((u, i) => { u.i = i; u.n = list.length; u.cx = (u.x0 + u.x1) / 2; u.cy = (u.y0 + u.y1) / 2; u.lh = L.lh; u.px = L.px; u.lineCx = u.line ? u.line.x0 + u.line.lw / 2 : 0; u.rnd = anHash(i * 7.13 + 0.37); });
  return (L.u[by] = list); }
function unitXf(g, s, ux, uy, uh){ const pv = s.pivot === 'bottom' ? uh / 2 : 0; g.translate(ux + (s.x || 0), uy + (s.y || 0) + pv); if (s.r) g.rotate(s.r * Math.PI / 180);
  const sc = s.s ?? 1, sx = (s.sx ?? 1) * sc, sy = (s.sy ?? 1) * sc; if (sx !== 1 || sy !== 1) g.scale(Math.max(1e-4, sx), Math.max(1e-4, sy)); g.translate(-ux, -uy - pv); }
/* the glyphs, plain or one unit at a time; plan = { by, st(i) → state | null (at rest), clip, block } */
function drawTextGlyphs(g, o, L, plan, glow){
  g.font = L.font; g.fillStyle = o.color || '#fff'; g.textBaseline = 'middle'; g.textAlign = 'left';
  const fw = wd => { g.direction = wd.dir === 'r' ? 'rtl' : 'ltr'; g.fillText(wd.text, wd.x, wd.cy); };
  const lit = (lvl, fn) => { if (lvl > 0.01){ g.save(); g.shadowColor = rgba(o.color || '#ffffff', Math.min(1, 0.95 * lvl)); g.shadowBlur = L.px * 0.6 * lvl; fn(); g.shadowBlur = L.px * 0.22 * lvl; fn(); g.restore(); } else fn(); };
  if (!plan){ lit(glow, () => L.lines.forEach(ln => ln.words.forEach(fw))); return; }
  const U = textUnits(g, L, plan.by), top = L.lh * 1.5;
  if (plan.by === 'letter'){ L.lines.forEach(ln => ln.words.forEach(wd => { const mine = U.filter(u => u.word === wd), n = mine.length; let k = 0;
      while (k < n){ const s = plan.st(mine[k].i);
        if (s === null){ let j = k; while (j + 1 < n && plan.st(mine[j + 1].i) === null) j++;
          if (k === 0 && j === n - 1) lit(glow, () => fw(wd)); else { let x0 = Infinity, x1 = -Infinity; for (let q = k; q <= j; q++){ x0 = Math.min(x0, mine[q].x0); x1 = Math.max(x1, mine[q].x1); } g.save(); g.beginPath(); g.rect(x0, wd.cy - top, x1 - x0, top * 2); g.clip(); lit(glow, () => fw(wd)); g.restore(); }
          k = j + 1; continue; }
        if (s.a == null || s.a > 0.002){ const u = mine[k]; g.save(); if (s.a != null && s.a < 0.999) g.globalAlpha *= s.a; unitXf(g, s, u.cx, u.cy, L.lh); g.beginPath(); g.rect(u.x0, wd.cy - top, u.x1 - u.x0, top * 2); g.clip(); lit(Math.max(glow, s.glow || 0), () => fw(wd)); g.restore(); }
        k++; } })); return; }
  U.forEach(u => { const s = plan.st(u.i), words = u.word ? [u.word] : u.line ? u.line.words : [].concat(...L.lines.map(ln => ln.words)), body = () => words.forEach(fw);
    if (s === null){ lit(glow, body); return; } if (s.a != null && s.a <= 0.002) return;
    g.save(); if (plan.clip){ g.beginPath(); g.rect(u.x0 - L.px, u.y0 - L.lh, u.x1 - u.x0 + L.px * 2, u.y1 - u.y0 + L.lh + L.lh * 0.02); g.clip(); }
    if (s.block != null){ const p = s.block, w = u.x1 - u.x0, y = u.cy - L.lh * 0.46, h = L.lh * 0.92, c = o.color || '#fff';
      if (p > 0 && p < 0.5){ const bw = w * AE.io(p / 0.5); g.fillStyle = c; g.fillRect(L.rtl ? u.x1 - bw : u.x0, y, bw, h); }
      else if (p >= 0.5){ lit(glow, body); const bw = w * (1 - AE.io((p - 0.5) / 0.5)); g.fillStyle = c; g.fillRect(L.rtl ? u.x0 : u.x1 - bw, y, bw, h); }
      g.restore(); return; }
    if (s.a != null && s.a < 0.999) g.globalAlpha *= s.a; unitXf(g, s, u.cx, u.cy, u.y1 - u.y0); lit(Math.max(glow, s.glow || 0), body); g.restore(); });
}
function boxPath(g, x, y, w, h, shape, px){
  if (shape === 'brush'){ const n = Math.max(4, Math.round(w / (h * 0.9))), a = h * 0.045, e = Math.min(h * 0.35, w / 4), top = i => y + a * Math.sin(i * 2.1 + 0.6), bot = i => y + h + a * Math.sin(i * 1.7 + 2.2);
    g.beginPath(); g.moveTo(x + e, top(0));
    for (let i = 1; i <= n; i++){ const x1 = x + e + (w - 2 * e) * i / n, xm = x1 - (w - 2 * e) / n / 2; g.quadraticCurveTo(xm, top(i - 0.5) - a * 0.6, x1, top(i)); }
    g.bezierCurveTo(x + w + e * 0.15, y + h * 0.08, x + w - e * 0.25, y + h * 0.3, x + w + e * 0.05, y + h * 0.48); g.bezierCurveTo(x + w - e * 0.2, y + h * 0.62, x + w + e * 0.2, y + h * 0.9, x + w - e, bot(n));
    for (let i = n - 1; i >= 0; i--){ const x1 = x + e + (w - 2 * e) * i / n, xm = x1 + (w - 2 * e) / n / 2; g.quadraticCurveTo(xm, bot(i + 0.5) + a * 0.6, x1, bot(i)); }
    g.bezierCurveTo(x - e * 0.2, y + h * 0.92, x + e * 0.2, y + h * 0.7, x - e * 0.05, y + h * 0.52); g.bezierCurveTo(x + e * 0.25, y + h * 0.35, x - e * 0.15, y + h * 0.1, x + e, top(0)); g.closePath(); return; }
  rrect(g, x, y, w, h, shape === 'capsule' ? h / 2 : shape === 'round' ? px * 0.35 : px * 0.08); }
/* the box behind a text: bs = its own In/Out ({ pr, p }); ext = the part of the text revealed so far ('With the text') */
function drawTextBox(g, o, L, H, bs, ext){
  if (ext === 'none') return; const pad = (o.bg.pad || 0) * H, px = L.px; let x0 = L.bx, y0 = L.by, x1 = L.bx + L.tw, y1 = L.by + L.th; if (ext) [x0, y0, x1, y1] = ext;
  let x = x0 - pad * 1.6, y = y0 - pad, w = x1 - x0 + pad * 3.2, h = y1 - y0 + pad * 2; const shape = o.bg.shape, col = o.bg.color || '#f2b233';
  g.save(); g.fillStyle = col;
  if (bs && bs.pr !== 'none'){ const p = bs.p, pr = bs.pr;
    if (pr === 'fade') g.globalAlpha *= AE.io(p);
    else if (pr === 'grow'){ const k = AE.out(p); x += w * (1 - k) / 2; w *= k; }
    else if (pr === 'wipe'){ const nw = w * AE.io(p); if (L.rtl) x += w - nw; w = nw; }
    else if (pr === 'pop'){ const k = Math.max(1e-3, AE.back(p)), cx = x + w / 2, cy = y + h / 2; g.globalAlpha *= ac01(p * 4); g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy); }
    else if (pr === 'drop'){ g.globalAlpha *= ac01(p * 5); y -= (1 - AE.bounce(p)) * h * 1.6; }
    else if (pr === 'rise'){ const e = AE.out(p); g.globalAlpha *= e; y += (1 - e) * h * 0.9; }
    else if (pr === 'draw'){ const q = ac01(p / 0.6), f = ac01((p - 0.5) / 0.5); boxPath(g, x, y, w, h, shape, px);
      if (f > 0){ g.save(); g.globalAlpha *= AE.io(f); g.fill(); g.restore(); }
      if (f < 1){ const per = 2 * (w + h); g.strokeStyle = col; g.lineWidth = Math.max(1.5, px * 0.07); g.setLineDash([per * AE.io(q), per * 2]); g.globalAlpha *= 1 - f * f; g.stroke(); }
      g.restore(); return; }
    else if (pr === 'marker'){ const k = AE.io(p), lead = h * 0.6, f = k * (w + lead); g.beginPath();
      if (L.rtl){ g.moveTo(x + w + lead, y - 1); g.lineTo(x + w + lead - f, y - 1); g.lineTo(x + w - f, y + h + 1); g.lineTo(x + w + lead, y + h + 1); }
      else { g.moveTo(x - lead, y - 1); g.lineTo(x - lead + f, y - 1); g.lineTo(x + f, y + h + 1); g.lineTo(x - lead, y + h + 1); }
      g.closePath(); g.clip(); } }
  if (w > 0.5 && h > 0.5){ boxPath(g, x, y, w, h, shape, px); g.fill(); }
  g.restore(); }
function followExt(L, plan, U){ let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  U.forEach(u => { const s = plan.st(u.i); if (s !== null && (s.block != null ? s.block <= 0 : s.a != null && s.a <= 0.02)) return; x0 = Math.min(x0, u.x0); y0 = Math.min(y0, u.y0); x1 = Math.max(x1, u.x1); y1 = Math.max(y1, u.y1); });
  return x1 > x0 ? [x0, y0, x1, y1] : 'none'; }
function drawText(ctx, o, W, H){
  const kd = o.type === 'pod' ? 'p' : 't', a = (typeof VEDIT !== 'undefined' && VEDIT === o) ? ANNONE : (animOf(o) || ANNONE),   /* 177: being typed: drawn at rest, live */ T = animTimes(o, a, kd), t = RT, ph = animPhase(o, a, T, t, kd), C = animCtx(o, W, H, ph ? ph.dir : null);
  const L1 = a.loop && ANL[a.loop] && ANL[a.loop].k.includes(kd) ? ANL[a.loop] : null, lp = L1 ? loopAt(L1, o, a, T, t, W, H) : null;
  const bgOn = !!(o.bg && o.bg.on), bgPr = ph && bgOn ? ((ph.which === 'in' ? a.bgIn : a.bgOut) || 'follow') : 'follow', sep = bgPr !== 'follow';
  let pt = ph ? ph.p : 1, pb = pt; if (sep){ const at = (ph.which === 'in' ? a.bgInAt : a.bgOutAt) || 'with'; if (at === 'before'){ pb = ac01(ph.p / 0.6); pt = ac01((ph.p - 0.4) / 0.6); } else if (at === 'after'){ pt = ac01(ph.p / 0.6); pb = ac01((ph.p - 0.4) / 0.6); } }
  const P = ph && ph.P, unitMode = !!(P && P.unit && kd === 't' && !(ph.by === 'whole' && P.obj)),   /* 'Whole' moves the text and its box as one */
    objS = P && P.obj && !unitMode ? mergeS(null, P.obj(pt, C)) : null, loopS = lp && L1.obj ? mergeS(null, lp[0], lp[1]) : null;
  const outer = sep ? loopS : (objS || loopS ? mergeS(mergeS(null, objS), loopS) : null), L0 = textLayout(ctx, o, H, o.w * W), bw0 = o.w * W, bh0 = o.h * H;
  const pad0 = bgOn ? (o.bg.pad || 0) * H : 0, ext = bgOn ? [L0.bx - pad0 * 1.6, L0.by - pad0, L0.tw + pad0 * 3.2, L0.th + pad0 * 2] : [L0.bx - L0.px * 0.1, L0.by, L0.tw + L0.px * 0.2, L0.th];
  const piv = [(ext[0] + ext[2] / 2) / bw0, (ext[1] + ext[3] / 2) / bh0];   /* scales and turns happen around the text, not its frame */
  if (outer && !outer.pivot) outer.pivot = piv; if (objS && sep && !objS.pivot) objS.pivot = piv;
  paintState(ctx, outer, (o.x + o.w / 2) * W, (o.y + o.h / 2) * H, bw0, bh0, o.rot || 0, o.opacity ?? 1, H, (g, x, y, bw, bh, S) => {
    const L = textLayout(g, o, H, bw); let plan = null;
    if (unitMode){ const by = ph.by, U = textUnits(g, L, by), n = U.length, u = P.u != null ? P.u : ({ letter: 0.3, word: 0.45, line: 0.6, whole: 1 })[by], ord = P.random ? anPerm(n, anSeed(o)) : null;
      const sts = U.map((uu, i) => { const k = ord ? ord[i] : i, pi = P.stagger ? P.stagger(pt, k, n, uu) : unitP(pt, k, n, u), s = P.unit(pi, C, uu); return isRest(s) ? null : s; });
      plan = { by, st: i => sts[i], clip: !!P.clip }; }
    else if (lp && L1.unit){ const U = textUnits(g, L, 'letter'), v = a.loopSpeed || 1, env = lp[1], sts = U.map(uu => { const s = L1.unit(lp[2], v, C, uu); return s ? { y: (s.y || 0) * env } : null; }); plan = { by: 'letter', st: i => sts[i] }; }
    if (bgOn && L.tw > 0) drawTextBox(g, o, L, H, sep ? { pr: bgPr, p: pb } : null, !sep && unitMode ? followExt(L, plan, textUnits(g, L, plan.by)) : null);
    if (sep && objS) paintState(g, objS, 0, 0, bw, bh, 0, 1, H, (g2, x2, y2, w2, h2, S2) => drawTextGlyphs(g2, o, L, plan, S2.glow || 0), [L.bx - L.px * 0.1, L.by, L.tw + L.px * 0.2, L.th]);
    else drawTextGlyphs(g, o, L, plan, (S && S.glow) || 0); }, ext);
}

// ---- podcast: In / Out move every speaker together or one after another; Loop breathes them with a small offset each
function podAnimOrbs(pod, orbs, W, H, t){ const a = animOf(pod); if (!a || pod.bgl || !orbs.length) return orbs;
  const T = animTimes(pod, a, 'p'), ph = animPhase(pod, a, T, t, 'p'), L1 = a.loop && ANL[a.loop] && ANL[a.loop].k.includes('p') && ANL[a.loop].obj ? ANL[a.loop] : null; if (!(ph && ph.P) && !L1) return orbs;
  const n = orbs.length, bx = pod.x * W, by = pod.y * H, bw = pod.w * W, bh = pod.h * H, bcx = bx + bw / 2, bcy = by + bh / 2, C = animCtx(pod, W, H, ph && ph.dir);
  return orbs.map((ob, i) => { let S = null; if (ph && ph.P && ph.P.obj) S = mergeS(S, ph.P.obj(ph.each ? unitP(ph.p, i, n, 0.5) : ph.p, C)); if (L1){ const r = loopAt(L1, pod, a, T, t, W, H, i * 0.8); if (r) S = mergeS(S, r[0], r[1]); }
    if (!S) return ob; let cx = ob.cx * W, cy = ob.cy * H, r = ob.r * H;
    if (ph && ph.each){ cx += S.x; cy += S.y; } else { cx = bcx + (cx - bcx) * S.s + S.x; cy = bcy + (cy - bcy) * S.s + S.y; } r *= S.s;
    const mask = S.mask ? { ...S.mask, box: ph && ph.each ? [cx - r * 1.5, cy - r * 1.5, r * 3, r * 3.4] : [bx, by, bw, bh] } : null;
    return { ...ob, cx: cx / W, cy: cy / H, r: Math.max(1e-5, r / H), alpha: S.a, mask }; }); }

// ---- the panel: In · Out · Loop tabs, presets for this kind of object, a duration (In/Out) or speed (Loop), and only the options the preset has
var ANTAB = 'in'; let ANHOV = 0, ANSLIDE = false;
const RNG_CLS = 'range range-xs w-full text-base-content/35 [--range-fill:0] [--range-p:0px] [--range-thumb:var(--color-primary)] [--range-thumb-size:14px]';
function animName(P, tab){ return tab === 'out' && P.ofa ? T(P.ofa, P.oen) : T(P.fa, P.en); }
function animList(kd, tab){ const src = tab === 'loop' ? ANL : AN; return Object.keys(src).filter(id => src[id].k.includes(kd)); }
const numd = v => String(v);
const durTxt = v => secs(v);
const spdTxt = v => `${numd(String(Math.round(v * 100) / 100))}×`;
// 179 · each value of these settings has its own reset icon too, as every value in the app (grey at the default, orange
//       when changed); the reset-all icon by the preset's name puts them all back at once
function animRst(changed, key){ return `<button type="button" class="xrst btn btn-ghost btn-xs btn-square -my-1 ${changed ? 'text-primary' : 'opacity-50 hover:opacity-100'}" onclick="event.preventDefault(); event.stopPropagation(); animUnset('${key}')" data-tip="بازنشانی به پیش‌فرض" data-tip-en="Reset to default" aria-label="reset" aria-pressed="${changed ? 'true' : 'false'}"><svg class="size-3.5"><use href="#i-rotate-ccw"/></svg></button>`; }
function animUnset(key){ const o = objById(vSel); if (!o) return; const a = migrateAnim(o); if (a[key] == null) return; remember(); delete a[key]; VVER++; fillAnim(o); autosave(); animPreview(o, ANTAB, a, false); }
const AN_LG = 'fieldset-legend flex w-full items-center gap-1 text-xs font-medium text-base-content/70', AN_RV = 'rv ms-auto shrink-0 text-xs font-medium tabular-nums text-base-content/80';
function animSeg(label, opts, cur, call, ltr, rst){ return `<fieldset class="fieldset"><legend class="${rst ? AN_LG : 'fieldset-legend text-xs font-medium text-base-content/70'}">${label}${rst ? rst.replace('class="xrst ', 'class="xrst ms-auto ') : ''}</legend><div class="join w-full" ${ltr ? 'dir="ltr"' : ''}>${opts.map(([v, txt]) => `<button class="join-item btn btn-sm flex-1 ${cur === v ? 'btn-primary' : 'border-base-content/15 bg-base-100'}" onclick="${call.replace('#', v)}">${txt}</button>`).join('')}</div></fieldset>`; }
// 179 · as the transitions: a chosen preset shows its adjust icon, and only that icon opens its settings (the panel at the
//       foot, as before, with the preset's name, a reset-all icon and a close button; Esc closes it)
var ANADJ = null;   // '<object>|<tab>|main' or '…|bg': whose settings are open
const animAdjKey = (o, w) => (o ? o.id : '') + '|' + ANTAB + '|' + w;
function animAdj(w){ const o = objById(vSel); if (!o) return; const k = animAdjKey(o, w); ANADJ = ANADJ === k ? null : k; fillAnim(o); }
function animAdjClose(){ if (!ANADJ) return false; ANADJ = null; const o = objById(vSel); if (o) fillAnim(o); return true; }
function animChanged(a, P, w){ const t = ANTAB;
  if (w === 'bg'){ const k = (t === 'in' ? 'bgIn' : 'bgOut') + 'At'; return (a[k] && a[k] !== 'with') || a[t + 'Dur'] != null; }
  if (t === 'loop') return (a.loopSpeed || 1) !== 1 || a.loopDir != null;
  return (a[t + 'Dur'] != null && Math.abs(a[t + 'Dur'] - P.d) > 1e-6) || a[t + 'By'] != null || a[t + 'Dir'] != null || !!a[t + 'Each']; }
function animResetAll(w){ const o = objById(vSel); if (!o) return; remember(); const a = migrateAnim(o), t = ANTAB;
  if (w === 'bg'){ delete a[(t === 'in' ? 'bgIn' : 'bgOut') + 'At']; delete a[t + 'Dur']; }
  else if (t === 'loop'){ delete a.loopSpeed; delete a.loopDir; } else [t + 'Dur', t + 'By', t + 'Dir', t + 'Each'].forEach(k => delete a[k]);
  VVER++; fillAnim(o); autosave(); animPreview(o, ANTAB, a, false); }
function animTile(id, name, ic, on, pick, hov, adj){ return `<button class="relative btn btn-sm h-auto min-h-0 flex-col gap-1 px-1 py-2 text-[11px] font-medium leading-normal ${on ? 'btn-primary' : 'border-base-content/10 bg-base-100'}" data-an="${id}" onclick="${pick}('${id}')" onmouseenter="${hov}('${id}')" onmouseleave="animHoverEnd()">${adj || ''}<svg class="size-4"><use href="${ic}"/></svg><span class="block w-full overflow-visible break-words text-center">${escapeHtml(name)}</span></button>`; }
function fillAnim(o){
  const box = $('animBody'); if (!box || !o) return; const kd = animKind(o), tn = TYPE_NAME[o.type] || [o.type, o.type];
  $('animTarget').textContent = o.bgl ? T('کلیپِ پس‌زمینه', 'Background clip') : T(tn[0], tn[1]);
  if (!kd){ box.innerHTML = `<p class="text-sm text-base-content/70">${o.bgl ? T('طرحِ پادکستِ پس‌زمینه با گذار به کلیپ‌های کنارش وصل می‌شود و انیمیشنِ جدا ندارد.', 'The background podcast style joins the clips next to it with transitions; it has no animation of its own.') : T('این شیء انیمیشن نمی‌گیرد.', 'This object takes no animation.')}</p>`; return; }
  const a = migrateAnim(o); if (kd === 'b') ANTAB = 'loop';
  const on = k => a[k] && a[k] !== 'none' || (k !== 'loop' && bgAnimOn(o, k === 'in' ? 'bgIn' : 'bgOut'));
  const tab = (k, fa, en) => `<button role="tab" class="tab flex-1 gap-1.5 ${ANTAB === k ? 'tab-active' : ''}" ${kd === 'b' && k !== 'loop' ? 'disabled' : ''} onclick="animTab('${k}')">${T(fa, en)}${on(k) ? '<span class="size-1.5 rounded-full bg-primary"></span>' : ''}</button>`;
  let h = `<div role="tablist" class="tabs tabs-box tabs-sm w-full">${tab('in', 'ورود', 'In')}${tab('out', 'خروج', 'Out')}${tab('loop', 'حلقه', 'Loop')}</div>`;
  if (kd === 'b') h += `<p class="text-xs leading-relaxed text-base-content/60">${T('کلیپ‌های پس‌زمینه با گذار به هم وصل می‌شوند؛ این‌جا حرکتِ دوربین درونِ قاب را انتخاب می‌کنید.', 'Background clips join with transitions; here you choose the camera move inside the frame.')}</p>`;
  else if (ANTAB === 'loop') h += `<p class="text-xs leading-relaxed text-base-content/60">${T('بینِ پایانِ ورود و آغازِ خروج تکرار می‌شود.', 'Repeats between the end of In and the start of Out.')}</p>`;
  const SRC = ANTAB === 'loop' ? ANL : AN, cur = a[ANTAB] && SRC[a[ANTAB]] && SRC[a[ANTAB]].k.includes(kd) ? a[ANTAB] : 'none';
  if (ANADJ && !ANADJ.startsWith(o.id + '|' + ANTAB + '|')) ANADJ = null;
  const openMain = ANADJ === animAdjKey(o, 'main') && cur !== 'none';
  h += `<div class="grid grid-cols-3 gap-1.5">${animTile('none', T('هیچ', 'None'), '#i-ban', cur === 'none', 'animPick', 'animHover')}${animList(kd, ANTAB).map(id => animTile(id, animName(SRC[id], ANTAB), SRC[id].ic, cur === id, 'animPick', 'animHover', cur === id ? adjIcon(true, openMain, "animAdj('main')") : '')).join('')}</div>`;
  const bgK = ANTAB === 'in' ? 'bgIn' : 'bgOut', bgOnly = ANTAB !== 'loop' && cur === 'none' && bgAnimOn(o, bgK);
  if (kd === 't' && o.bg && o.bg.on && ANTAB !== 'loop') h += animBgOpts(o, a);
  if (on('in') || on('out') || on('loop')) h += `<button class="btn btn-ghost btn-sm w-full text-error" onclick="animClear()"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('برداشتنِ همهٔ انیمیشن‌ها', 'Remove all animations')}</button>`;
  /* the chosen preset's duration or speed (and its options) stay in view at the foot of the panel while the list scrolls */
  const panel = inner => `<div class="adjpanel sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-base-300 bg-base-200 px-4 pb-3 pt-2 shadow-[0_-8px_16px_-12px_rgba(0,0,0,.5)]">${inner}</div>`;
  if (openMain) h += panel(adjHead(animName(SRC[cur], ANTAB), animChanged(a, SRC[cur], 'main'), "animResetAll('main')", 'animAdjClose()') + animOpts(o, a, kd, SRC[cur]));
  else if (ANADJ === animAdjKey(o, 'bg')){ const bk = ANTAB === 'in' ? 'bgIn' : 'bgOut', bc = a[bk] || 'follow', bp = AN_BG.find(x => x[0] === bc);
    if (bp && bc !== 'follow' && bc !== 'none') h += panel(adjHead(T(bp[1], bp[2]), animChanged(a, { d: 0.6 }, 'bg'), "animResetAll('bg')", 'animAdjClose()') + animBgOrder(a) + (bgOnly ? animOpts(o, a, kd, { d: 0.6 }) : '')); else ANADJ = null; }
  box.innerHTML = h;
}
function animOpts(o, a, kd, P){ const tab = ANTAB; let h = '';
  if (tab === 'loop'){ const v = a.loopSpeed || 1; h += `<fieldset class="fieldset"><legend class="${AN_LG}">${T('سرعت', 'Speed')}<span id="anVal" class="${AN_RV}">${spdTxt(v)}</span>${animRst((a.loopSpeed || 1) !== 1, 'loopSpeed')}</legend><input id="anRange" type="range" min="0.25" max="6" step="0.05" value="${v}" class="${RNG_CLS}" oninput="animSlide('loopSpeed', +this.value)" onchange="animSlideDone()"></fieldset>`; }
  else { const T0 = animTimes(o, a, kd), max = Math.max(0.1, Math.min(4, T0.D / 2)), key = tab + 'Dur', v = Math.min(a[key] ?? P.d, max);
    h += `<fieldset class="fieldset"><legend class="${AN_LG}">${T('مدت', 'Duration')}<span id="anVal" class="${AN_RV}">${durTxt(v)}</span>${animRst(a[key] != null && Math.abs(a[key] - P.d) > 1e-6, key)}</legend><input id="anRange" type="range" min="0.1" max="${max.toFixed(2)}" step="0.05" value="${v}" class="${RNG_CLS}" oninput="animSlide('${key}', +this.value)" onchange="animSlideDone()"><p class="label text-[11px]">${T('حداکثر نصفِ زمانِ این شیء', 'At most half of this object’s time')}</p></fieldset>`; }
  if (kd === 't' && P.by && P.by.length > 1){ const key = tab + 'By'; h += animSeg(T('واحد', 'By'), P.by.map(b => [b, T(AN_BY[b][0], AN_BY[b][1])]), byOf(kd, P, a[key]), `animSet('${key}', '#')`, false, animRst(a[key] != null, key)); }
  if (P.dir){ const key = tab + 'Dir', ar = d => `<svg class="size-4"><use href="${({ left: '#i-arrow-left', right: '#i-arrow-right', up: '#i-arrow-up', down: '#i-arrow-down' })[d]}"/></svg>`;
    // 182: every arrow shows the way the item MOVES — an in-animation stored as «from the right» moves left, so its button
    //      is ←; the title says «Towards» for in and out alike (stored values unchanged: projects keep their animations)
    const segs = tab === 'in' ? [['right', ar('left')], ['left', ar('right')], ['down', ar('up')], ['up', ar('down')]] : [['left', ar('left')], ['right', ar('right')], ['up', ar('up')], ['down', ar('down')]];
    h += animSeg(tab === 'in' || tab === 'out' ? T('به سمتِ', 'Towards') : T('جهت', 'Direction'), segs, a[key] || defDir(o, tab), `animSet('${key}', '#')`, true, animRst(a[key] != null, key)); }
  if (kd === 'p' && tab !== 'loop' && P.obj){ const key = tab + 'Each'; h += `<label class="flex w-full cursor-pointer items-center gap-3 text-sm"><span class="flex-1">${T('یکی‌یکی، به ترتیبِ گوینده‌ها', 'One speaker after another')}</span>${animRst(!!a[key], key)}<input type="checkbox" class="toggle toggle-sm toggle-primary" ${a[key] ? 'checked' : ''} onchange="animSet('${key}', this.checked)"></label>`; }
  return h; }
function animBgOpts(o, a){ const key = ANTAB === 'in' ? 'bgIn' : 'bgOut', cur = a[key] || 'follow', at = a[key + 'At'] || 'with';
  let h = `<div class="divider my-0"></div><div class="flex items-center gap-2"><svg class="size-4 text-secondary"><use href="#i-square"/></svg><span class="text-sm font-semibold">${T('پس‌زمینهٔ متن', 'Text background')}</span></div>`;
  const openBg = ANADJ === animAdjKey(objById(vSel), 'bg');
  h += `<div class="grid grid-cols-3 gap-1.5">${AN_BG.map(([id, fa, en, ic]) => animTile(id, T(fa, en), ic, cur === id, 'animBgPick', 'animBgHover', cur === id && id !== 'follow' && id !== 'none' ? adjIcon(true, openBg, "animAdj('bg')") : '')).join('')}</div>`;
  return h; }
function animBgOrder(a){ const key = ANTAB === 'in' ? 'bgIn' : 'bgOut', at = a[key + 'At'] || 'with';
  return animSeg(T('ترتیب', 'Order'), ANTAB === 'in' ? [['before', T('اول پس‌زمینه', 'Background first')], ['with', T('همزمان', 'Together')], ['after', T('اول متن', 'Text first')]] : [['after', T('اول پس‌زمینه', 'Background first')], ['with', T('همزمان', 'Together')], ['before', T('اول متن', 'Text first')]], at, `animSet('${key}At', '#')`, false, animRst(at !== 'with', key + 'At')); }
function animRowFill(){ const el = $('iv-animrow'); if (!el) return; const o = vSel && vSel !== 'SUB' ? objById(vSel) : null, kd = animKind(o), ap = $('iv-anim');
  if (!o || !kd || mode !== 'video' || (ap && !ap.classList.contains('hidden'))){ el.classList.add('hidden'); return; }
  const a = animOf(o) || ANNONE, nm = (k, src) => a[k] && a[k] !== 'none' && src[a[k]] && src[a[k]].k.includes(kd) ? animName(src[a[k]], k) : null;
  const parts = [[T('ورود', 'In'), nm('in', AN)], [T('خروج', 'Out'), nm('out', AN)], [T('حلقه', 'Loop'), nm('loop', ANL)]].filter(x => x[1]);
  el.classList.remove('hidden');
  el.innerHTML = `<button class="flex w-full items-center gap-2 px-4 py-3 text-start hover:bg-base-content/5" onclick="openAnim()"><svg class="size-4 shrink-0 text-secondary"><use href="#i-wand-sparkles"/></svg><span class="text-sm font-bold">${T('انیمیشن', 'Animation')}</span><span class="ms-auto truncate text-xs text-base-content/60">${parts.length ? parts.map(([k, v]) => `${k}: ${escapeHtml(v)}`).join(' · ') : T('بدون انیمیشن', 'None')}</span><svg class="size-4 shrink-0 opacity-60 rtl:-scale-x-100"><use href="#i-chevron-right"/></svg></button>`; }
function animTab(k){ ANTAB = k; ANADJ = null; animPreviewStop(); fillAnim(objById(vSel)); }
function animPick(id){ const o = objById(vSel); if (!o) return; clearTimeout(ANHOV); remember(); const a = migrateAnim(o); if (a[ANTAB] !== id) ANADJ = null; a[ANTAB] = id; VVER++; fillAnim(o); autosave(); if (id !== 'none') animPreview(o, ANTAB, a, false); else { animPreviewStop(true); vDraw(); } }
function animBgPick(id){ const o = objById(vSel); if (!o) return; clearTimeout(ANHOV); remember(); const a = migrateAnim(o); if ((a[ANTAB === 'in' ? 'bgIn' : 'bgOut'] || 'follow') !== id) ANADJ = null; a[ANTAB === 'in' ? 'bgIn' : 'bgOut'] = id; VVER++; fillAnim(o); autosave(); animPreview(o, ANTAB, a, false); }
function animSet(key, val){ const o = objById(vSel); if (!o) return; remember(); const a = migrateAnim(o); a[key] = val; VVER++; fillAnim(o); autosave(); animPreview(o, ANTAB, a, false); }
function animSlide(key, val){ const o = objById(vSel); if (!o) return; if (!ANSLIDE){ remember(); ANSLIDE = true; } const a = migrateAnim(o); a[key] = val; VVER++;
  const lab = $('anVal'); if (lab) lab.textContent = key === 'loopSpeed' ? spdTxt(val) : durTxt(val); if (!ANPV || !ANPV.loop) animPreview(o, ANTAB, a, true); }
function animSlideDone(){ ANSLIDE = false; autosave(); animPreviewStop(); animRstSync(); }
function animRstSync(){ const o = objById(vSel), b = document.querySelector('#animBody .adjrst'); if (!o || !b || !ANADJ) return; const a = migrateAnim(o), w = ANADJ.endsWith('|bg') ? 'bg' : 'main';
  const SRC = ANTAB === 'loop' ? ANL : AN, P = w === 'bg' ? { d: 0.6 } : (SRC[a[ANTAB]] || { d: 0.6 }), on = animChanged(a, P, w); b.classList.toggle('text-primary', on); b.classList.toggle('opacity-50', !on);
  const r = $('anRange'), rb = r && r.closest('fieldset').querySelector('legend .xrst'); if (rb){ const k = ANTAB === 'loop' ? 'loopSpeed' : ANTAB + 'Dur'; rstMark(rb, ANTAB === 'loop' ? (a.loopSpeed || 1) !== 1 : (a[k] != null && Math.abs(a[k] - P.d) > 1e-6)); } }
function animClear(){ const o = objById(vSel); if (!o) return; remember(); o.anim = { v: 2 }; VVER++; animPreviewStop(true); fillAnim(o); vDraw(); autosave(); }
function animHover(id){ clearTimeout(ANHOV); ANHOV = setTimeout(() => { const o = objById(vSel); if (!o) return; animPreview(o, ANTAB, { ...migrateAnim(o), [ANTAB]: id }, true); }, 140); }
function animBgHover(id){ clearTimeout(ANHOV); ANHOV = setTimeout(() => { const o = objById(vSel); if (!o) return; animPreview(o, ANTAB, { ...migrateAnim(o), [ANTAB === 'in' ? 'bgIn' : 'bgOut']: id }, true); }, 140); }
function animHoverEnd(){ clearTimeout(ANHOV); if (ANPV && ANPV.loop && !ANSLIDE) animPreviewStop(); }
function openAnim(){ const ob = $('objBar'); if (ob) ob.classList.add('hidden'); const o = objById(vSel); if (o && animKind(o) === 'b') ANTAB = 'loop'; else if (o && ANTAB === 'loop' && !(o.anim && o.anim.loop) && o.anim && (o.anim.in || o.anim.out)) ANTAB = 'in'; showVPanels(true); }
function closeAnim(){ animPreviewStop(); showVPanels(); }

// ---- previewing on the canvas without moving the playhead: hovering a preset loops it, choosing one plays it once
function animWindow(o, tab, a){ const T0 = animTimes(o, a, animKind(o) || 't');
  return tab === 'in' ? [T0.st - 0.2, T0.ls + 0.45] : tab === 'out' ? [T0.le - 0.45, T0.en - 0.0005] : [T0.ls, Math.min(T0.le, T0.ls + 3.2)]; }
async function vDrawAt(t){ const cv = $('vcanvas'); if (!cv || mode !== 'video' || drawing) return; drawing = true; try { await vFrame(cv.getContext('2d'), cv.width, cv.height, t, false); } catch (e) { console.error(e); } drawing = false; }
function animPreview(o, tab, a, loop){ animPreviewStop(true); if (playing || mode !== 'video') return; const w = animWindow(o, tab, a); if (!(w[1] > w[0])) return;
  const P = ANPV = { id: o.id, anim: a, t0: w[0], t1: w[1], loop, start: performance.now(), raf: 0 };
  const tick = async () => { if (ANPV !== P) return; if (playing){ animPreviewStop(); return; } const el = (performance.now() - P.start) / 1000, len = P.t1 - P.t0, cyc = len + 0.5;
    await vDrawAt(P.t0 + Math.min(len, loop ? el % cyc : el)); if (ANPV !== P) return;
    if (!loop && el >= cyc){ ANPV = null; vDraw(); return; } P.raf = requestAnimationFrame(tick); };
  P.raf = requestAnimationFrame(tick); }
function animPreviewStop(silent){ const P = ANPV; if (!P) return; ANPV = null; cancelAnimationFrame(P.raf); if (!silent) vDraw(); }
/* the inspector: the Animation row under each object's panel; leaving the panel stops a preview */
const _showVPanels175 = showVPanels;
showVPanels = function(anim){ if (!anim && ANPV) animPreviewStop(); _showVPanels175.apply(this, arguments); animRowFill(); };
