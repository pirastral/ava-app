// === from the mock (ava-editor-10): the design system and the Orb Lab shader, extended to one orb per speaker ===
const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uDrift; uniform float uSharp; uniform float uWarp; uniform vec3 uC[6];
uniform int uBg; uniform sampler2D uImg; uniform vec2 uIS; uniform float uZoom; uniform vec2 uPos; uniform int uFit; uniform vec3 uSolid;
uniform int uOrb; uniform int uOrbN; uniform vec2 uOrbCs[8]; uniform float uOrbRs[8]; uniform float uLevels[8]; uniform vec3 uPulses[8]; uniform float uIri; uniform float uGlow; uniform float uGrain; uniform float uDark; uniform int uRipple;
out vec4 frag;
/* ---- from Ava Orb Lab · MESH_FS: hash, value noise, drifting colour anchors ---- */
float bh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), u.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), u.x), u.y); }
vec2 anchor(int i) { if (i == 0) return vec2(0.12, 0.18); if (i == 1) return vec2(0.88, 0.22); if (i == 2) return vec2(0.5, 0.55); if (i == 3) return vec2(0.16, 0.86); if (i == 4) return vec2(0.86, 0.84); return vec2(0.52, 0.02); }
vec3 mesh(vec2 uv) { float asp = uRes.x / uRes.y; vec2 c = vec2(uv.x * asp, uv.y); float t = uTime * 0.6 * uDrift;
  vec2 w = vec2(bn(c * 1.2 + vec2(t * 0.03, 0.0)), bn(c * 1.2 + vec2(7.1, -t * 0.025))) - 0.5; vec2 p = c + w * uWarp;
  vec3 col = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 6; i++) { float fi = float(i); vec2 a = anchor(i); vec2 pt = vec2(a.x * asp, a.y) + 0.16 * vec2(sin(t * 0.07 * (fi + 1.0) + fi), cos(t * 0.05 * (fi + 2.0) + 2.0 * fi)); float d = length(p - pt); float wt = exp(-d * d * uSharp) + 0.0005; col += uC[i] * wt; ws += wt; }
  return col / ws; }
/* ---- from Ava Orb Lab · IMG_FS: cover-fit, zoom, slow drift (contain and positioning added) ---- */
vec3 photo(vec2 uv) { float ra = uRes.x / uRes.y; float ri = uIS.x / uIS.y;
  vec2 s = uFit == 0 ? (ra > ri ? vec2(1.0, ri / ra) : vec2(ra / ri, 1.0)) : (ra > ri ? vec2(ra / ri, 1.0) : vec2(1.0, ri / ra));
  float z = max(uZoom, 1.0) + 0.04 * uDrift; vec2 pan = vec2(sin(uTime * 0.05), cos(uTime * 0.037)) * 0.018 * uDrift;
  vec2 iu = (uv - 0.5) * s / z + 0.5 + pan + uPos * max(vec2(0.0), 1.0 - s / z) * 0.5;
  if (uFit == 1 && (iu.x < 0.0 || iu.x > 1.0 || iu.y < 0.0 || iu.y > 1.0)) return uSolid;
  iu.y = 1.0 - iu.y; return texture(uImg, clamp(iu, vec2(0.001), vec2(0.999))).rgb; }
vec3 bg(vec2 uv) { if (uBg == 1) return photo(uv); if (uBg == 2) return uSolid; return mesh(uv); }
/* ---- from Ava Orb Lab · ORB_FS: thin-film iridescence, triangle-wave noise, ripple pulse, studio reflection ---- */
vec3 thinFilm(float cosI, float dnm) { float n = 1.33; float cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (n * n), 0.0)); float opd = 2.0 * n * dnm * cosT;
  vec3 I = 0.5 + 0.5 * cos(6.28318 * opd / vec3(650.0, 532.0, 450.0) + 3.14159); return mix(I, vec3(0.62), smoothstep(700.0, 1500.0, dnm) * 0.75); }
float triw(float x) { return abs(fract(x) - 0.5); }
float triNoise(vec2 p, float t) { float z = 1.8; float rz = 0.0; vec2 bp = p;
  for (int i = 0; i < 4; i++) { vec2 dg = vec2(triw(bp.x + triw(bp.y)), triw(bp.y + triw(bp.x))) * 1.2; p += dg / z + t * 0.12; bp *= 1.8; z *= 1.45; p *= 1.2;
    p = mat2(0.95534, 0.29552, -0.29552, 0.95534) * p; rz += triw(p.x + triw(p.y)) / z; } return clamp(rz * 1.6, 0.0, 1.0); }
float pulse(float r, float age) { float rad = age * 1.5; float amp = exp(-age * 2.4) * step(0.0, age) * smoothstep(0.0, 0.08, age); float d = (r - rad) / 0.17; return exp(-d * d) * amp; }
vec3 envRefl(vec3 r) {
  vec3 c = mix(mix(vec3(0.9, 0.88, 0.86), vec3(0.06, 0.07, 0.1), uDark), mix(vec3(1.0), vec3(0.26, 0.28, 0.36), uDark), smoothstep(-0.3, 0.9, r.y));
  vec3 a = normalize(vec3(-0.55, 0.62, -0.56)); vec3 ax = normalize(cross(a, vec3(0.0, 1.0, 0.0))); vec3 ay = cross(ax, a); vec2 sb = vec2(dot(r, ax), dot(r, ay)) / max(dot(r, a), 0.05);
  c += vec3(1.35) * step(0.0, dot(r, a)) * (1.0 - smoothstep(0.26, 0.3, abs(sb.x))) * (1.0 - smoothstep(0.4, 0.46, abs(sb.y)));
  vec3 b2 = normalize(vec3(0.85, 0.15, -0.5)); c += vec3(0.55) * smoothstep(0.955, 0.985, dot(r, b2));
  c += vec3(0.25) * smoothstep(0.6, 1.0, -r.y) * (1.0 - uDark);
  return c; }
/* ---- composed here: a glass or water orb that refracts the backdrop and answers the sound ---- */
vec3 shadeOrb(vec2 uv, vec3 col, vec2 uOrbC, float uOrbR, float uLevel, vec3 uPulse) {
    float asp = uRes.x / uRes.y; vec2 p = vec2((uv.x - uOrbC.x) * asp, uv.y - uOrbC.y) / uOrbR; float r = length(p);
    float h = 0.0;
    if (uOrb == 2) { if (uRipple == 1) h = pulse(r, uPulse.x) + pulse(r, uPulse.y) + pulse(r, uPulse.z); h += 0.06 * uLevel * sin(r * 16.0 - uTime * 5.0); }
    float edge = 1.0 + 0.035 * uLevel * sin(atan(p.y, p.x) * 5.0 + uTime * 2.2) + (uOrb == 2 ? 0.05 * h : 0.0);
    if (r < edge) {
      float rr = r / edge; float z = sqrt(max(1.0 - rr * rr, 0.0)); vec2 dir = p / max(r, 1e-4);
      vec3 n = normalize(vec3(p / edge + dir * h * 0.6, z));
      vec2 refr = uv - n.xy * (uOrb == 2 ? 0.22 : 0.15) * (0.8 + 0.6 * uLevel) * vec2(1.0 / asp, 1.0) * uOrbR;
      vec3 inner = bg(refr);
      inner *= 0.82 + 0.18 * z;                                                  // glass darkens toward the rim
      float cs = triNoise(p * 0.9 + vec2(uTime * 0.03), uTime * 0.5);            // sparse caustic lines, not speckle
      inner += vec3(0.65, 0.85, 1.0) * pow(cs, 6.0) * (uOrb == 2 ? 1.6 : 0.35) * (0.4 + uLevel);
      if (uOrb == 2) inner += vec3(0.10, 0.22, 0.28) * h;                       // the ripples catch the light
      vec3 film = thinFilm(z, 300.0 + 420.0 * triNoise(p * 0.35, uTime * 0.15) + 180.0 * uLevel);   // broad iridescent bands
      inner = mix(inner, clamp(inner * film * 1.5, 0.0, 1.4), uIri * 0.6);
      vec3 refl = envRefl(reflect(vec3(0.0, 0.0, -1.0), n)); float fres = pow(1.0 - z, 3.0);
      vec3 c = mix(inner, refl, 0.05 + 0.45 * fres); c += vec3(0.75, 0.86, 1.0) * fres * 0.45 * (0.4 + uGlow);
      c += vec3(1.0) * pow(max(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 48.0) * 0.9;   // specular highlight
      col = mix(col, c, smoothstep(edge, edge - 0.015, r));
    } else { col += vec3(0.55, 0.72, 1.0) * exp(-(r - edge) * 5.0) * 0.28 * uGlow * (0.35 + uLevel); }
    return col;
}
void main() {
  vec2 uv = gl_FragCoord.xy / uRes; vec3 col = bg(uv);
  if (uOrb > 0) { for (int k = 0; k < 8; k++) { if (k >= uOrbN) break; col = shadeOrb(uv, col, uOrbCs[k], uOrbRs[k], uLevels[k], uPulses[k]); } }
  col += (bh(gl_FragCoord.xy + fract(uTime) * 77.0) - 0.5) * (0.012 + 0.18 * uGrain);
  frag = vec4(col, 1.0);
}`;
const STYLES = [
  ['کلاسیک', { layout: 'two', wave: 'mirror', pal: 'nil', bg: 'mesh', iri: 0.2, glow: 0.5, grain: 0.08 }],
  ['گوی شیشه', { layout: 'single', wave: 'glass', pal: 'shf', bg: 'mesh', iri: 0.45, glow: 0.7, grain: 0.06 }],
  ['گوی آب', { layout: 'single', wave: 'water', pal: 'fir', bg: 'mesh', iri: 0.2, glow: 0.55, grain: 0.06 }],
  ['رنگین‌کمان', { layout: 'single', wave: 'glass', pal: 'mon', bg: 'mesh', iri: 0.95, glow: 0.45, grain: 0.05 }],
  ['دایره‌ای', { layout: 'single', wave: 'circle', pal: 'zaf', bg: 'mesh', iri: 0.2, glow: 0.4, grain: 0.1 }],
  ['خطی', { layout: 'two', wave: 'line', pal: 'mon', bg: 'solid', iri: 0, glow: 0.2, grain: 0.04 }],
  ['نقل‌قول', { layout: 'quote', wave: 'bars', pal: 'ana', bg: 'mesh', iri: 0.2, glow: 0.4, grain: 0.12 }],
  ['شب نئونی', { layout: 'two', wave: 'mirror', pal: 'neo', bg: 'mesh', iri: 0.3, glow: 1.0, grain: 0.05 }],
  ['عکس و روکش', { layout: 'two', wave: 'bars', pal: 'nil', bg: 'image', iri: 0.2, glow: 0.4, grain: 0.1 }],
  ['سینمایی', { layout: 'single', wave: 'line', pal: 'sun', bg: 'image', iri: 0, glow: 0.3, grain: 0.45 }],
  ['غروب آبی', { layout: 'single', wave: 'water', pal: 'sun', bg: 'image', iri: 0.3, glow: 0.6, grain: 0.15 }],
  ['مینیمال', { layout: 'quote', wave: 'line', pal: 'mon', bg: 'solid', iri: 0, glow: 0.1, grain: 0.03 }]];
const PALS = {
  nil: ['#1c2a74', '#2b3fb0', '#0c1230', '#3a2a8c', '#14406b', '#0a0f26'], fir: ['#0f5a53', '#22c4b5', '#03211e', '#0b3d4a', '#1a7f74', '#062a2a'],
  zaf: ['#7a4a06', '#f2b233', '#2a1a00', '#9c5a10', '#d98a1a', '#3a2205'], ana: ['#7a1c22', '#e5484d', '#2a080a', '#5a0f2e', '#b8323a', '#1e0508'],
  shf: ['#3b1d6e', '#22c4b5', '#5b7cff', '#0c1230', '#b05bff', '#103a5c'], neo: ['#ff2fa0', '#3dd5ff', '#1a0b2e', '#7c3aed', '#00ffc3', '#0b0614'],
  mon: ['#2a2d3a', '#5a5f73', '#0e0f14', '#3c4051', '#8a8fa3', '#16171d'], sun: ['#ff7a45', '#ffcf6b', '#5a1f3d', '#c2416b', '#ffb07a', '#2b0f2a'] };
const WAVES = [['bars', 'میله'], ['mirror', 'آینه‌ای'], ['line', 'خط'], ['circle', 'دایره'], ['glass', 'گوی شیشه'], ['water', 'گوی آب'], ['signature', 'گویِ امضا'], ['sphere', 'کرهٔ شیشه‌ای']];   // 170: the Orb Lab's two builds