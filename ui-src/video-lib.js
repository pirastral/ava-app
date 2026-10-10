// === from the mock (ava-editor-10): the podcast background — a drifting colour mesh, a picture/video, or one colour —
//     177: every orb is gone (they belong to the founder's commercial product), and with them the orb-only uniforms
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uDrift; uniform float uSharp; uniform float uWarp; uniform vec3 uC[6];
uniform int uBg; uniform sampler2D uImg; uniform vec2 uIS; uniform float uZoom; uniform vec2 uPos; uniform int uFit; uniform vec3 uSolid; uniform float uGrain;
out vec4 frag;
float bh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), u.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), u.x), u.y); }
vec2 anchor(int i) { if (i == 0) return vec2(0.12, 0.18); if (i == 1) return vec2(0.88, 0.22); if (i == 2) return vec2(0.5, 0.55); if (i == 3) return vec2(0.16, 0.86); if (i == 4) return vec2(0.86, 0.84); return vec2(0.52, 0.02); }
vec3 mesh(vec2 uv) { float asp = uRes.x / uRes.y; vec2 c = vec2(uv.x * asp, uv.y);
  // 179: a full loop every 3 s at 100 % (uDrift = 1): every path below is a whole number of turns of th, so it joins seamlessly
  float th = 6.2831853 * uTime * uDrift / 3.0;
  vec2 w = vec2(bn(c * 1.2 + 0.55 * vec2(cos(th), sin(th))), bn(c * 1.2 + vec2(7.1, 0.0) + 0.55 * vec2(sin(th), cos(th)))) - 0.5; vec2 p = c + w * uWarp;
  vec3 col = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 6; i++) { float fi = float(i); vec2 a = anchor(i); float k1 = 1.0 + mod(fi, 2.0), k2 = 2.0 - mod(fi, 2.0);
    vec2 pt = vec2(a.x * asp, a.y) + 0.17 * vec2(sin(th * k1 + fi * 1.7), cos(th * k2 + fi * 2.3)); float d = length(p - pt); float wt = exp(-d * d * uSharp) + 0.0005; col += uC[i] * wt; ws += wt; }
  return col / ws; }
vec3 photo(vec2 uv) { float ra = uRes.x / uRes.y; float ri = uIS.x / uIS.y;
  vec2 s = uFit == 0 ? (ra > ri ? vec2(1.0, ri / ra) : vec2(ra / ri, 1.0)) : (ra > ri ? vec2(ra / ri, 1.0) : vec2(1.0, ri / ra));
  float z = max(uZoom, 1.0) + 0.04 * uDrift; vec2 pan = vec2(sin(uTime * 0.05), cos(uTime * 0.037)) * 0.018 * uDrift;
  vec2 iu = (uv - 0.5) * s / z + 0.5 + pan + uPos * max(vec2(0.0), 1.0 - s / z) * 0.5;
  if (uFit == 1 && (iu.x < 0.0 || iu.x > 1.0 || iu.y < 0.0 || iu.y > 1.0)) return uSolid;
  iu.y = 1.0 - iu.y; return texture(uImg, clamp(iu, vec2(0.001), vec2(0.999))).rgb; }
vec3 bg(vec2 uv) { if (uBg == 1) return photo(uv); if (uBg == 2) return uSolid; return mesh(uv); }
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; vec3 col = bg(uv);
  col += (bh(gl_FragCoord.xy + fract(uTime * step(0.0001, uDrift)) * 77.0) - 0.5) * (0.012 + 0.18 * uGrain);   // 179: at speed 0 nothing moves, the grain neither
  frag = vec4(col, 1.0);
}`;
const STYLES = [
  ['کلاسیک', { layout: 'two', wave: 'mirror', pal: 'nil', bg: 'mesh', grain: 0.08 }],
  ['دایره‌ای', { layout: 'single', wave: 'circle', pal: 'zaf', bg: 'mesh', grain: 0.1 }],
  ['خطی', { layout: 'two', wave: 'line', pal: 'mon', bg: 'solid', grain: 0.04 }],
  ['شب نئونی', { layout: 'two', wave: 'mirror', pal: 'neo', bg: 'mesh', grain: 0.05 }],
  ['عکس و روکش', { layout: 'two', wave: 'bars', pal: 'nil', bg: 'image', grain: 0.1 }],
  ['سینمایی', { layout: 'single', wave: 'line', pal: 'sun', bg: 'image', grain: 0.45 }],
  ['مینیمال', { layout: 'single', wave: 'line', pal: 'mon', bg: 'solid', grain: 0.03 }]];   // 179: no quote (the founder) — only whoever is speaking (without the quote it was «Line» again)
const PALS = {
  nil: ['#1c2a74', '#2b3fb0', '#0c1230', '#3a2a8c', '#14406b', '#0a0f26'], fir: ['#0f5a53', '#22c4b5', '#03211e', '#0b3d4a', '#1a7f74', '#062a2a'],
  zaf: ['#7a4a06', '#f2b233', '#2a1a00', '#9c5a10', '#d98a1a', '#3a2205'], ana: ['#7a1c22', '#e5484d', '#2a080a', '#5a0f2e', '#b8323a', '#1e0508'],
  shf: ['#3b1d6e', '#22c4b5', '#5b7cff', '#0c1230', '#b05bff', '#103a5c'], neo: ['#ff2fa0', '#3dd5ff', '#1a0b2e', '#7c3aed', '#00ffc3', '#0b0614'],
  mon: ['#2a2d3a', '#5a5f73', '#0e0f14', '#3c4051', '#8a8fa3', '#16171d'], sun: ['#ff7a45', '#ffcf6b', '#5a1f3d', '#c2416b', '#ffb07a', '#2b0f2a'] };
/* 175: the English names of the designs and waveforms */
const STYLE_EN = { 'کلاسیک': 'Classic', 'دایره‌ای': 'Radial', 'خطی': 'Line', 'شب نئونی': 'Neon night',
  'عکس و روکش': 'Photo and overlay', 'سینمایی': 'Cinematic', 'مینیمال': 'Minimal' };
const WAVE_EN = { bars: 'Bars', mirror: 'Mirror', line: 'Line', circle: 'Circle' };
const WAVES = [['bars', 'میله'], ['mirror', 'آینه‌ای'], ['line', 'خط'], ['circle', 'دایره']];   // 177: the orbs are gone
// an old project's orb design becomes the circle design (the closest look: the avatar with its ring and the sound around it)
const ORB_WAVES = ['glass', 'water', 'signature', 'sphere'];
const STYLE_177 = [0, 1, 1, 1, 1, 2, 3, 4, 5, 6, 1, 7];   // the design index a 176 project stored → the index now