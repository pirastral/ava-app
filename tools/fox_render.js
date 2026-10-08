// renders the Fox editor's own sounds with its own code: AvaAudio.LIB and every transition sound (exact, 48 kHz)
const fs = require('fs');
const SRC = process.argv[2], OUT = process.argv[3], SR = 48000;
global.window = global; window.AvaCore = { AT: {} };
let code = fs.readFileSync(SRC, 'utf8');
// a short declick where a sound's buffer ends while it still rings (the kick, boom and bell buffers stop before they decay);
// at most 30 ms and never more than an eighth of the sound, so short blips keep their shape
const PLACE = 'const v = sig[i], j = i0 + i;';
if (!code.includes(PLACE)) throw new Error('the Fox place() changed — update the declick patch');
code = code.replace(PLACE, 'const DK = Math.max(1, Math.min(0.03 * SR, sig.length / 8)), v = sig[i] * Math.min(1, (sig.length - i) / DK), j = i0 + i;');
code = code.replace('root.AvaAudio = {', 'root.__fox = { transitionSfx, LIB, reverb, bus: () => bus(), place: (...a) => place(...a), arm: (n) => { SR = 48000; R = rng(11); N = n; SFX = bus(); VERB = bus(); MUS = bus(); VOX = bus(); FLOOR = -1e9; CEIL = 1e9; }, get SFX(){ return SFX; }, get VERB(){ return VERB; } };\nroot.AvaAudio = {');
eval(code);
const F = window.__fox;
const save = (name, L, R) => { const n = L.length, b = Buffer.alloc(n * 8); for (let i = 0; i < n; i++){ b.writeFloatLE(L[i], i * 8); b.writeFloatLE(R ? R[i] : L[i], i * 8 + 4); } fs.writeFileSync(`${OUT}/${name}.f32`, b); };
// the library sounds, placed the way the editor places a user's sound (gain 0.9, room send 0.12) and mixed the way build() mixes them
const mix = (n) => { const S = F.SFX, V = F.VERB, wet = [F.reverb(V[0], 0), F.reverb(V[1], 23)], L = new Float32Array(n), Rr = new Float32Array(n);
  for (let i = 0; i < n; i++){ L[i] = S[0][i] * 0.9 + wet[0][i] * 0.5; Rr[i] = S[1][i] * 0.9 + wet[1][i] * 0.5; } return [L, Rr]; };
for (const k of Object.keys(window.AvaAudio.LIB)){ const y = window.AvaAudio.sfx(k, SR), n = y.length + Math.ceil(3 * SR); F.arm(n); F.place(F.SFX, y, 0.02, 0.9, 0, 0.12); const [L, Rr] = mix(n); save('lib_' + k, L, Rr); }
// the transition sounds: each on its own short bus, with the editor's reverb send mixed in as build() does
const OV = { shatter: 1.0, rise: 1.0, crossfade: 1.0, cube: 1.1, lens: 1.4, leak: 1.1, melt: 1.2, pool: 1.4, rays: 1.3, barrel: 0.9, smear: 0.8, liquid: 1.3, glass: 1.4, frosted: 1.5, stained: 1.7, ink: 1.4, burn: 1.2, whip: 0.7, glitch: 0.8, zoom: 0.9, mosaic: 1.0, halftone: 1.4, chrome: 1.6, morph: 1.0 };
for (const [type, ov] of Object.entries(OV)){ const n = Math.ceil((ov + 9) * SR); F.arm(n); const tr = { type, bStart: 0.4, start: 0.4, overlap: ov, bridge: type === 'morph' ? 0.9 : 0, into: type === 'morph' ? 'iris' : null };
  if (type === 'morph'){ tr.start = 0.2; tr.bStart = 1.1; }
  F.transitionSfx(tr); const [L, Rr] = mix(n); save('tr_' + type, L, Rr); }
console.log('rendered', Object.keys(window.AvaAudio.LIB).length, 'library sounds and', Object.keys(OV).length, 'transition sounds');
