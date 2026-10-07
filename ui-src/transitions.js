// Transition library — from the founder's «The Fox and the Moon» editor (his own asset), ported verbatim: 30 GLSL ES 3.00
// transitions. Each exposes tr(uv) over A()/B() (the two frames), p (progress 0→1), pa/pc/pd (controls), aspect, seed, t.
(function (root) {
'use strict';
const LIB = {
  liquid: { name: 'Liquid drop', overlap: 1.3, about: 'A drop lands; its ripple refracts the frame and opens onto the next chapter.', src: `
vec4 tr(vec2 uv) {
  vec2 c = vec2(pa.x, pa.y);
  vec2 q = (uv - c) * vec2(aspect, 1.0);
  float r = length(q);
  float R = pow(p, 0.8) * 1.3;
  float k = r - R;
  vec2 n = q / max(r, 0.0001);
  float wave = sin(k * 70.0 * pc.y) * exp(-abs(k) * 11.0) * 0.02 * pc.x * (1.0 - p * 0.5);
  float inner = sin(r * 48.0 * pc.y - p * 26.0) * exp(-r * 2.5) * 0.012 * pc.x * (1.0 - p);
  vec2 off = n * (wave + inner) / vec2(aspect, 1.0);
  vec4 a = A(uv + off);
  vec4 b = B(uv + off * 0.7);
  float m = smoothstep(0.008, -0.008, k);
  vec4 col = mix(a, b, m);
  float rim = exp(-abs(k) * 70.0) * (1.0 - p * 0.7);
  float lit = exp(-abs(k + 0.012) * 120.0) * (1.0 - p);
  return vec4(col.rgb * (1.0 - rim * 0.18 * pc.z) + vec3(lit * 0.45 * pc.z), 1.0);
}` },
  glass: { name: 'Glass pane', overlap: 1.4, about: 'A thick pane of glass, turned in 3D, slides across: the next chapter is seen through it, bent at its edges, green where the glass is thickest, with a soft shadow and caustic light behind it.', src: `
vec3 envS(vec3 r) {
  vec3 c = mix(vec3(0.5, 0.51, 0.54), vec3(0.98, 0.98, 1.0), smoothstep(-0.3, 0.55, r.y));
  c = c - vec3(0.3) * exp(-abs(r.y + 0.03) * 16.0);
  c = c + vec3(1.0, 1.0, 1.0) * exp(-(r.x + 0.55) * (r.x + 0.55) * 14.0) * smoothstep(0.2, 0.7, r.y) * 0.7;
  c = c + vec3(1.0, 0.93, 0.85) * exp(-(r.x - 0.7) * (r.x - 0.7) * 30.0) * smoothstep(-0.1, 0.35, r.y) * 0.35;
  return c;
}
vec2 toUV(vec3 pt, float asp) { float k = 1.9 / (4.2 - pt.z); return vec2(pt.x * k / asp + 0.5, 0.5 - pt.y * k); }

vec3 rY(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 rX(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
float sdRB(vec3 q, vec3 b, float r) { vec3 d = abs(q) - b + vec3(r); return length(max(d, vec3(0.0))) + min(max(d.x, max(d.y, d.z)), 0.0) - r; }
float slab(vec3 q, vec3 cen, vec3 he, float rot, float tl) { return sdRB(rX(rY(q - cen, -rot), -tl), he, 0.07); }
vec3 snrm(vec3 q, vec3 cen, vec3 he, float rot, float tl) { float e = 0.0012; return normalize(vec3(slab(q + vec3(e, 0.0, 0.0), cen, he, rot, tl) - slab(q - vec3(e, 0.0, 0.0), cen, he, rot, tl), slab(q + vec3(0.0, e, 0.0), cen, he, rot, tl) - slab(q - vec3(0.0, e, 0.0), cen, he, rot, tl), slab(q + vec3(0.0, 0.0, e), cen, he, rot, tl) - slab(q - vec3(0.0, 0.0, e), cen, he, rot, tl))); }
vec3 frame(vec2 su, float split) { vec2 c = clamp(su, vec2(0.0), vec2(1.0)); return mix(A(c).rgb, B(c).rgb, step(su.x, split)); }
vec4 tr(vec2 uv) {
  float e = p * p * (3.0 - 2.0 * p);
  float fw = 1.105 * aspect;
  vec3 cen = vec3(mix(-fw - 1.5, fw + 1.5, e), 0.0, 0.55);
  vec3 he = vec3(0.86 * pc.w, 1.45, 0.16 * pc.x);
  float rot = (0.38 + 0.12 * sin(p * 3.14159)) * pd.x;
  float tl = 0.05 * pd.x;
  float split = toUV(cen, aspect).x;
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 ro = vec3(0.0, 0.0, 4.2);
  vec3 rd = normalize(vec3(s.x, -s.y, -1.9));
  vec3 Ld = normalize(vec3(-0.45, 0.6, 0.66));
  float d = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 70; i++) { float h = slab(ro + rd * d, cen, he, rot, tl); if (h < 0.0008) { hit = 1.0; break; } d += h; if (d > 6.0) { break; } }
  if (hit < 0.5) {
    vec3 fp = vec3(s.x * 4.2 / 1.9, -s.y * 4.2 / 1.9, 0.0);
    float sh = 1.0;
    float tt = 0.05;
    for (int i = 0; i < 28; i++) { float h = slab(fp + Ld * tt, cen, he, rot, tl); sh = min(sh, 14.0 * h / tt); tt += clamp(h, 0.02, 0.25); if (tt > 3.5) { break; } }
    sh = clamp(sh, 0.0, 1.0);
    float occ = 1.0 - sh;
    vec3 base = frame(uv, split) * (1.0 - occ * 0.13);
    base = base + vec3(1.0, 0.98, 0.93) * smoothstep(0.1, 0.45, occ) * (1.0 - smoothstep(0.45, 0.85, occ)) * 0.12;
    return vec4(base, 1.0);
  }
  vec3 p0 = ro + rd * d;
  vec3 n = snrm(p0, cen, he, rot, tl);
  float cosi = clamp(dot(-rd, n), 0.0, 1.0);
  float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
  vec3 rr = reflect(rd, n);
  float ior = 1.0 + 0.5 * pc.y;
  vec3 r1 = refract(rd, n, 1.0 / ior);
  vec3 q = p0 - n * 0.002;
  float t2 = 0.0;
  for (int i = 0; i < 48; i++) { float h = -slab(q + r1 * t2, cen, he, rot, tl); if (h < 0.0008) { break; } t2 += max(h, 0.004); }
  vec3 pe = q + r1 * t2;
  vec3 ne = snrm(pe, cen, he, rot, tl);
  vec3 col = vec3(0.0);
  for (int c = 0; c < 3; c++) {
    float ic = ior + (float(c) - 1.0) * 0.014 * pc.z;
    vec3 r2 = refract(r1, -ne, ic);
    if (dot(r2, r2) < 0.01) { r2 = reflect(r1, -ne); }
    float tp = (0.0 - pe.z) / min(r2.z, -0.05);
    vec3 smp = frame(toUV(pe + r2 * tp, aspect), split);
    if (c == 0) { col.x = smp.x; }
    if (c == 1) { col.y = smp.y; }
    if (c == 2) { col.z = smp.z; }
  }
  col = col * vec3(0.93, 0.965, 0.95) * mix(vec3(1.0), vec3(0.72, 0.89, 0.82), clamp((t2 - 0.2) * 1.0, 0.0, 0.85));
  float spec = pow(max(dot(rr, Ld), 0.0), 180.0) * 1.6 + pow(max(dot(rr, normalize(vec3(0.6, 0.35, 0.72))), 0.0), 90.0) * 0.5;
  vec3 gl = mix(col, envS(rr), clamp(fres + 0.07, 0.0, 1.0)) + vec3(spec);
  return vec4(gl, 1.0);
}` },
  frosted: { name: 'Frosted glass', overlap: 1.5, about: 'A pane of real frosted glass rises over the frame; the next chapter forms behind the frost, and the pane lifts away.', src: `
float sdBox(vec2 q, vec2 b, float r) { vec2 d = abs(q) - b + vec2(r); return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r; }
vec3 refrB(vec2 uv, vec2 off, float disp) { return vec3(B(uv + off * (1.0 - disp)).r, B(uv + off).g, B(uv + off * (1.0 + disp)).b); }
vec3 glassLight(vec2 uv, vec3 col, float d, vec2 nrm, float curve, float inside) {
  float fres = 0.05 + 0.5 * curve;
  float diag = uv.x * 0.8 + uv.y * 0.6;
  float win = smoothstep(0.3, 0.0, abs(diag - 0.78)) * 0.55 + smoothstep(0.1, 0.0, abs(diag - 0.5)) * 0.3;
  vec3 env = mix(vec3(0.8, 0.83, 0.87), vec3(1.0, 1.0, 1.0), win);
  vec3 c = mix(col, env, fres * 0.4 * inside);
  c = c * mix(vec3(1.0), vec3(0.85, 0.95, 0.9), curve * 0.6 * inside);
  vec2 L = normalize(vec2(-0.55, -0.83));
  float lit = max(dot(nrm, L), 0.0);
  c = c + vec3(pow(lit, 6.0) * curve * 0.95 * inside);
  c = c * (1.0 - max(dot(nrm, -L), 0.0) * curve * 0.3 * inside);
  c = c + vec3(exp(-abs(d) * 2200.0) * 0.85) * inside;
  c = c * (1.0 - exp(-abs(d + 0.004) * 1100.0) * 0.2 * inside);
  return c;
}

vec4 tr(vec2 uv) {
  vec2 c = vec2(0.5, mix(mix(1.3, 0.5, smoothstep(0.0, 0.34, p)), -0.3, smoothstep(0.66, 1.0, p)));
  vec2 q = (uv - c) * vec2(aspect, 1.0);
  vec2 he = vec2(aspect * 0.46, 0.44) * pc.z;
  float rad = 0.08;
  float bev = 0.06 * pc.w;
  float d = sdBox(q, he, rad);
  float ex = 0.0015;
  vec2 nrm = normalize(vec2(sdBox(q + vec2(ex, 0.0), he, rad) - sdBox(q - vec2(ex, 0.0), he, rad), sdBox(q + vec2(0.0, ex), he, rad) - sdBox(q - vec2(0.0, ex), he, rad)) + vec2(0.00001));
  float inside = smoothstep(0.0015, -0.0015, d);
  float band = clamp(-d / bev, 0.0, 1.0);
  float curve = pow(1.0 - band, 2.0);
  float m = smoothstep(0.42, 0.58, p);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 24; i++) {
    float fi = float(i);
    float a = fi * 2.39996 + hash21(uv * 400.0) * 6.2831;
    float rr = sqrt((fi + 0.5) / 24.0) * 0.022 * pc.x;
    vec2 o = vec2(cos(a), sin(a)) * rr * vec2(1.0 / aspect, 1.0) - nrm * curve * 0.05 / vec2(aspect, 1.0);
    acc += mix(A(uv + o).rgb, B(uv + o).rgb, m);
  }
  vec3 frost = acc / 24.0;
  float micro = vnoise(uv * vec2(900.0, 500.0)) - 0.5;
  frost = frost * (1.0 - 0.1 * pc.y) + vec3(0.1 * pc.y) + vec3(micro * 0.025 * pc.y);
  frost = glassLight(uv, frost, d, nrm, curve, inside);
  vec3 base = mix(A(uv).rgb, B(uv).rgb, m);
  float ds = sdBox(q - vec2(0.0, -0.035), he, rad);
  float sh = (1.0 - smoothstep(-0.02, 0.09, ds)) * 0.22 * (1.0 - inside);
  return vec4(mix(base * (1.0 - sh), frost, inside), 1.0);
}` },
  reeded: { name: 'Reeded glass', overlap: 1.5, about: 'A panel of fluted glass sweeps across; every rib is a small cylindrical lens that squeezes and mirrors the next chapter.', src: `
float sdBox(vec2 q, vec2 b, float r) { vec2 d = abs(q) - b + vec2(r); return length(max(d, vec2(0.0))) + min(max(d.x, d.y), 0.0) - r; }
vec3 refrB(vec2 uv, vec2 off, float disp) { return vec3(B(uv + off * (1.0 - disp)).r, B(uv + off).g, B(uv + off * (1.0 + disp)).b); }
vec3 glassLight(vec2 uv, vec3 col, float d, vec2 nrm, float curve, float inside) {
  float fres = 0.05 + 0.5 * curve;
  float diag = uv.x * 0.8 + uv.y * 0.6;
  float win = smoothstep(0.3, 0.0, abs(diag - 0.78)) * 0.55 + smoothstep(0.1, 0.0, abs(diag - 0.5)) * 0.3;
  vec3 env = mix(vec3(0.8, 0.83, 0.87), vec3(1.0, 1.0, 1.0), win);
  vec3 c = mix(col, env, fres * 0.4 * inside);
  c = c * mix(vec3(1.0), vec3(0.85, 0.95, 0.9), curve * 0.6 * inside);
  vec2 L = normalize(vec2(-0.55, -0.83));
  float lit = max(dot(nrm, L), 0.0);
  c = c + vec3(pow(lit, 6.0) * curve * 0.95 * inside);
  c = c * (1.0 - max(dot(nrm, -L), 0.0) * curve * 0.3 * inside);
  c = c + vec3(exp(-abs(d) * 2200.0) * 0.85) * inside;
  c = c * (1.0 - exp(-abs(d + 0.004) * 1100.0) * 0.2 * inside);
  return c;
}

vec4 tr(vec2 uv) {
  float e = p * p * (3.0 - 2.0 * p);
  float cx = mix(-0.4, 1.4, e);
  vec2 q = (uv - vec2(cx, 0.5)) * vec2(aspect, 1.0);
  vec2 he = vec2(0.52 * pc.z, 0.72);
  float rad = 0.05;
  float d = sdBox(q, he, rad);
  float inside = smoothstep(0.0015, -0.0015, d);
  float rib = 0.034 * pc.x;
  float lx = fract(q.x / rib) * 2.0 - 1.0;
  float nz = sqrt(max(1.0 - lx * lx, 0.0));
  float s = -lx * rib * 0.95 * pc.y / aspect;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i) - 1.0;
    vec2 o = vec2(s + fi * 0.0012, 0.0);
    col += vec3(B(uv + o * 0.97).r, B(uv + o).g, B(uv + o * 1.04).b);
  }
  col = col / 3.0;
  float key = pow(max(lx * -0.6 + nz * 0.8, 0.0), 6.0);
  float groove = 1.0 - exp(-(1.0 - abs(lx)) * 18.0) * 0.35;
  col = col * (0.9 + 0.1 * nz) * groove + vec3(key * 0.28) + vec3(0.02);
  float ex = 0.0015;
  vec2 nrm = normalize(vec2(sdBox(q + vec2(ex, 0.0), he, rad) - sdBox(q - vec2(ex, 0.0), he, rad), sdBox(q + vec2(0.0, ex), he, rad) - sdBox(q - vec2(0.0, ex), he, rad)) + vec2(0.00001));
  col = glassLight(uv, col, d, nrm, pow(1.0 - clamp(-d / 0.03, 0.0, 1.0), 2.0), inside);
  vec3 base = mix(A(uv).rgb, B(uv).rgb, step(uv.x, cx));
  float ds = sdBox(q - vec2(0.02, -0.03), he, rad);
  float sh = (1.0 - smoothstep(-0.01, 0.08, ds)) * 0.24 * (1.0 - inside);
  return vec4(mix(base * (1.0 - sh), col, inside), 1.0);
}` },
  stained: { name: 'Stained glass', overlap: 1.7, about: 'The frame breaks into leaded panes of coloured glass that turn, one by one, into the next chapter.', src: `
vec4 tr(vec2 uv) {
  vec2 q = uv * vec2(aspect, 1.0) * 8.0 / pc.x;
  vec2 ip = floor(q);
  vec2 fp = fract(q);
  float d1 = 8.0;
  float d2 = 8.0;
  vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vec2(hash21(ip + g), hash21(ip + g + 19.1));
      vec2 r = g + o - fp;
      float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else { if (d < d2) { d2 = d; } }
    }
  }
  float edge = sqrt(d2) - sqrt(d1);
  float h = hash21(id * 1.7 + 3.3);
  float delay = h * 0.5;
  float qq = clamp((p - delay) / 0.42, 0.0, 1.0);
  vec3 jewel = 0.62 + 0.38 * cos(6.2831 * (h * 0.8 + vec3(0.02, 0.36, 0.64)));
  vec3 tint = mix(vec3(1.0), jewel, clamp(0.55 * pc.y, 0.0, 1.0));
  float glassAmt = sin(3.14159 * qq);
  vec4 base = mix(A(uv), B(uv), step(0.5, qq));
  float grain = 0.93 + 0.12 * vnoise(q * 3.0 + id * 1.3);
  vec3 col = mix(base.rgb, base.rgb * tint * grain, glassAmt * 0.7);
  float lead = 1.0 - smoothstep(0.025 * pc.z, 0.06 * pc.z, edge);
  float bevel = (1.0 - smoothstep(0.06, 0.14, edge)) * (1.0 - lead);
  float leadAmt = smoothstep(0.0, 0.12, p) * smoothstep(1.0, 0.86, p);
  col = col + vec3(bevel * 0.12 * leadAmt);
  col = mix(col, vec3(0.16, 0.14, 0.13), lead * leadAmt);
  return vec4(col, 1.0);
}` },
  ink: { name: 'Ink bloom', overlap: 1.4, about: 'Ink spreads from three drops with ragged edges, carrying the next chapter with it.', src: `
vec4 tr(vec2 uv) {
  vec2 q = uv * vec2(aspect, 1.0);
  float f = (fbm(q * 3.0 * pc.y + seed) * 0.6 + fbm(q * 9.0 * pc.y - seed) * 0.25) * pc.z;
  float d = length(q - vec2(0.55, 0.45) * vec2(aspect, 1.0));
  d = min(d, length(q - vec2(0.22, 0.72) * vec2(aspect, 1.0)) + 0.12);
  d = min(d, length(q - vec2(0.82, 0.22) * vec2(aspect, 1.0)) + 0.18);
  float field = d - f * 0.5;
  float R = p * 1.7 - 0.3;
  float m = smoothstep(R + 0.02, R - 0.02, field);
  float edge = exp(-abs(field - R) * 38.0);
  vec4 col = mix(A(uv), B(uv), m);
  vec3 c = mix(col.rgb, vec3(0.06, 0.05, 0.09), edge * 0.8 * pc.x * (1.0 - p * 0.8));
  return vec4(c, 1.0);
}` },
  burn: { name: 'Ember burn', overlap: 1.2, about: 'The frame burns away along a glowing ember edge.', src: `
vec4 tr(vec2 uv) {
  float n = fbm(uv * vec2(aspect, 1.0) * 4.0 * pc.y + seed);
  float thr = p * 1.25 - 0.12;
  float m = smoothstep(thr - 0.015, thr + 0.015, n);
  float e = exp(-abs(n - thr) * 55.0);
  vec4 col = mix(B(uv), A(uv), m);
  vec3 glow = (vec3(1.0, 0.45, 0.14) * e * 1.3 + vec3(1.0, 0.85, 0.5) * exp(-abs(n - thr) * 180.0) * 0.8) * pc.x;
  float on = step(0.01, p) * step(p, 0.99);
  return vec4(col.rgb + glow * on, 1.0);
}` },
  whip: { name: 'Whip pan', overlap: 0.7, about: 'A fast camera pan with motion blur, landing on the next chapter.', src: `
vec4 tr(vec2 uv) {
  float e = p * p * (3.0 - 2.0 * p);
  float blur = sin(3.14159 * p) * 0.14 * pc.x;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 18; i++) {
    float s = (float(i) / 17.0 - 0.5) * blur;
    float x = uv.x + e + s;
    vec4 ca = A(clamp(vec2(x, uv.y), vec2(0.0), vec2(1.0)));
    vec4 cb = B(clamp(vec2(x - 1.0, uv.y), vec2(0.0), vec2(1.0)));
    acc += mix(ca, cb, step(1.0, x));
  }
  return acc / 18.0;
}` },
  glitch: { name: 'Glitch', overlap: 0.8, about: 'Split colour channels, torn scanlines and broken blocks snap to the next chapter.', src: `
vec4 tr(vec2 uv) {
  float amt = sin(3.14159 * p) * pc.x;
  float tt = floor(p * 26.0);
  float row = floor(uv.y * 30.0);
  float r1 = hash21(vec2(row, tt));
  float shift = step(0.7, r1) * (hash21(vec2(tt, row + 3.0)) - 0.5) * 0.28 * amt;
  vec2 bk = floor(uv * vec2(16.0, 9.0));
  float blk = step(1.0 - 0.1 * pc.y, hash21(bk + tt)) * amt;
  vec2 g = vec2(uv.x + shift + blk * 0.05, uv.y);
  float sw = step(0.5, p + (hash21(vec2(row, tt + 7.0)) - 0.5) * 0.35 * amt);
  float ca = 0.014 * amt * pc.z;
  vec4 ra = mix(A(g + vec2(ca, 0.0)), B(g + vec2(ca, 0.0)), sw);
  vec4 ga = mix(A(g), B(g), sw);
  vec4 ba = mix(A(g - vec2(ca, 0.0)), B(g - vec2(ca, 0.0)), sw);
  vec3 col = vec3(ra.r, ga.g, ba.b);
  float scan = 0.9 + 0.1 * sin(uv.y * 1620.0);
  col = col * mix(1.0, scan, amt);
  col = mix(col, vec3(1.0) - col, blk * 0.3);
  return vec4(col, 1.0);
}` },
  zoom: { name: 'Zoom through', overlap: 0.9, about: 'The camera rushes into the frame with radial blur and out into the next chapter.', src: `
vec4 tr(vec2 uv) {
  vec2 c = vec2(0.5, 0.5);
  float za = 1.0 + p * p * 3.2 * pc.x;
  float zb = 1.0 + (1.0 - p) * (1.0 - p) * 0.7;
  float blur = sin(3.14159 * p) * 0.22 * pc.y;
  vec4 accA = vec4(0.0);
  vec4 accB = vec4(0.0);
  for (int i = 0; i < 14; i++) {
    float s = 1.0 - blur * float(i) / 13.0;
    accA += A(c + (uv - c) / za * s);
    accB += B(c + (uv - c) / zb * s);
  }
  float m = smoothstep(0.42, 0.58, p);
  return mix(accA / 14.0, accB / 14.0, m);
}` },
  mosaic: { name: 'Mosaic', overlap: 1.0, about: 'The frame breaks into ever larger tiles, flips, and resolves into the next chapter.', src: `
vec4 tr(vec2 uv) {
  float s = sin(3.14159 * p);
  float cells = mix(900.0, 14.0 / pc.x, s * s);
  vec2 cs = vec2(cells * aspect, cells);
  vec2 g = (floor(uv * cs) + 0.5) / cs;
  vec2 q = mix(uv, g, step(0.03, s));
  vec4 col = mix(A(q), B(q), step(0.5, p));
  vec2 f = fract(uv * cs);
  float grid = step(0.3, s) * (1.0 - step(0.04, min(f.x, f.y))) * pc.y;
  return vec4(col.rgb * (1.0 - grid * 0.25), 1.0);
}` },
  halftone: { name: 'Halftone', overlap: 1.4, about: 'The frame turns into a grid of printed dots that swell and shrink into the next chapter.', src: `
vec4 tr(vec2 uv) {
  float s = sin(3.14159 * p);
  float n = 70.0 / pc.x;
  vec2 q = uv * vec2(aspect, 1.0) * n;
  vec2 cellc = floor(q) + 0.5;
  vec2 cuv = cellc / (vec2(aspect, 1.0) * n);
  vec4 src = mix(A(cuv), B(cuv), step(0.5, p));
  float l = dot(src.rgb, vec3(0.299, 0.587, 0.114));
  float d = length(q - cellc);
  float bulge = 1.0 + 0.6 * pc.y * s * exp(-length(uv - vec2(0.5, 0.5)) * 3.0);
  float rad = ((1.0 - l) * 0.6 + 0.1) * bulge;
  float dotm = smoothstep(rad + 0.05, rad - 0.05, d);
  vec3 paper = vec3(0.984, 0.98, 0.972);
  vec3 ht = mix(paper, src.rgb * 0.8, dotm);
  vec4 full = mix(A(uv), B(uv), step(0.5, p));
  return vec4(mix(full.rgb, ht, smoothstep(0.0, 0.3, s)), 1.0);
}` },
  chrome: { name: 'Liquid chrome', overlap: 1.6, about: 'A wave of liquid chrome washes across the frame and leaves the next chapter behind it.', src: `
vec4 tr(vec2 uv) {
  vec2 q = uv * vec2(aspect, 1.0);
  float h = vnoise(q * 1.6 + vec2(t * 0.25, seed)) * 0.7 + vnoise(q * 3.4 - vec2(0.0, t * 0.2)) * 0.3;
  float f = uv.x * 0.75 + uv.y * 0.3 + (h - 0.5) * 0.5;
  float front = p * 1.9 - 0.45;
  float band = smoothstep(front - 0.34 * pc.x, front - 0.1, f) * smoothstep(front + 0.16, front, f);
  float e = 0.01 / pc.y;
  float hx = vnoise((q + vec2(e, 0.0)) * 1.6 + vec2(t * 0.25, seed)) * 0.7 + vnoise((q + vec2(e, 0.0)) * 3.4 - vec2(0.0, t * 0.2)) * 0.3 - h;
  float hy = vnoise((q + vec2(0.0, e)) * 1.6 + vec2(t * 0.25, seed)) * 0.7 + vnoise((q + vec2(0.0, e)) * 3.4 - vec2(0.0, t * 0.2)) * 0.3 - h;
  float rim = smoothstep(front - 0.34, front - 0.1, f) - smoothstep(front - 0.02, front + 0.16, f);
  vec3 nrm = normalize(vec3(-hx * 70.0 + rim * 0.8, -hy * 70.0 - rim * 0.5, 1.0));
  vec3 rd = reflect(vec3(0.0, 0.0, -1.0), nrm);
  float ry = -rd.y + (0.5 - uv.y) * 0.5;
  vec3 skyc = mix(vec3(0.72, 0.75, 0.82), vec3(1.0, 1.0, 1.0), smoothstep(0.05, 0.5, ry));
  vec3 grnd = mix(vec3(0.04, 0.04, 0.06), vec3(0.32, 0.27, 0.24), smoothstep(-0.7, -0.08, ry));
  vec3 env = mix(grnd, skyc, smoothstep(-0.02, 0.02, ry)) + vec3(exp(-abs(ry) * 36.0) * 0.5);
  float spec = pow(max(dot(nrm, normalize(vec3(-0.35, -0.55, 0.76))), 0.0), 90.0);
  vec3 chrome = env + vec3(spec * 1.3);
  vec4 base = mix(A(uv), B(uv), smoothstep(front - 0.08, front - 0.26, f));
  return vec4(mix(base.rgb, chrome, band), 1.0);
}` },
  scene_chrome: { name: 'Liquid chrome scene', scene: true, overlap: 0, about: 'Raymarched chrome metaballs.', src: `
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float blobs(vec3 q, float tm, vec4 P) {
  float d = 100.0;
  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    float on = step(fi + 0.5, P.y);
    vec3 c = vec3(sin(tm * 0.55 + fi * 1.7) * 1.45, 0.05 + sin(tm * 0.8 + fi * 2.3) * 0.42, cos(tm * 0.45 + fi * 1.1) * 0.55);
    float r = (0.36 + 0.1 * sin(fi * 2.1 + tm * 0.7)) * P.z;
    d = mix(d, smin(d, length(q - c) - r, max(P.w, 0.02)), on);
  }
  return d;
}
vec3 envc(vec3 r, float warm) {
  float y = r.y;
  vec3 sky = mix(vec3(0.8, 0.82, 0.88), vec3(1.0, 1.0, 1.0), smoothstep(0.0, 0.6, y));
  vec3 grd = mix(vec3(0.06, 0.06, 0.08), vec3(0.42, 0.38, 0.35), smoothstep(-0.8, -0.05, y));
  vec3 c = mix(grd, sky, smoothstep(-0.03, 0.03, y));
  float box1 = exp(-(r.x + 0.55) * (r.x + 0.55) * 30.0) * smoothstep(0.15, 0.5, y);
  float box2 = exp(-(r.x - 0.7) * (r.x - 0.7) * 40.0) * smoothstep(0.2, 0.6, y);
  c = c + vec3(1.0, 1.0, 1.0) * box1 * 0.8 + vec3(0.61, 0.56, 0.91) * box2 * 0.9;
  c = c + vec3(1.0, 0.35, 0.12) * exp(-abs(y + 0.25) * 18.0) * 0.35 * warm;
  return c;
}
vec4 tr(vec2 uv) {
  float tm = t * pa.x;
  vec3 ro = vec3(0.0, 0.35, 4.3);
  vec3 rd = normalize(vec3((uv.x - 0.5) * aspect * 0.95, (0.5 - uv.y) * 0.95 - 0.06, -1.7));
  float d = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 80; i++) {
    float s = blobs(ro + rd * d, tm, pa);
    if (s < 0.0015) { hit = 1.0; break; }
    d += s * 0.9;
    if (d > 12.0) { break; }
  }
  vec3 bg = vec3(0.984, 0.98, 0.972);
  vec3 col = bg;
  if (rd.y < 0.0) {
    float tf = (-1.0 - ro.y) / rd.y;
    vec3 fp = ro + rd * tf;
    float occ = clamp(blobs(fp + vec3(0.0, 0.55, 0.0), tm, pa) / 0.9, 0.0, 1.0);
    col = mix(bg * (1.0 - (1.0 - occ) * 0.2 * pb.w), bg, smoothstep(4.0, 9.0, tf));
  }
  if (hit > 0.5) {
    vec3 q = ro + rd * d;
    float e = 0.002;
    vec3 n = normalize(vec3(blobs(q + vec3(e, 0.0, 0.0), tm, pa) - blobs(q - vec3(e, 0.0, 0.0), tm, pa), blobs(q + vec3(0.0, e, 0.0), tm, pa) - blobs(q - vec3(0.0, e, 0.0), tm, pa), blobs(q + vec3(0.0, 0.0, e), tm, pa) - blobs(q - vec3(0.0, 0.0, e), tm, pa)));
    vec3 r = reflect(rd, n);
    float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 c = envc(r, pb.z) * (0.72 + 0.28 * fres) * pb.x;
    float spec = pow(max(dot(r, normalize(vec3(-0.5, 0.7, 0.5))), 0.0), 120.0) * pb.y;
    col = c + vec3(spec * 1.4);
  }
  return vec4(mix(bg, col, smoothstep(0.0, 0.12, p)), 1.0);
}` },
  cube: { name: 'Cube spin', overlap: 1.1, about: 'The chapter becomes the face of a cube that turns in 3D to show the next.', src: `
vec3 rotX(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotY(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 orient(vec3 v, vec3 e) { return rotY(rotX(rotZ(v, e.z), e.x), e.y); }
vec4 hitPlane(vec3 rd, vec3 c, vec3 e, float asp) {
  vec3 n = orient(vec3(0.0, 0.0, 1.0), e);
  vec3 ux = orient(vec3(1.0, 0.0, 0.0), e);
  vec3 uy = orient(vec3(0.0, 1.0, 0.0), e);
  float dn = dot(rd, n);
  float dd = dn;
  if (abs(dd) < 0.0001) { dd = 0.0001; }
  float tt = dot(c, n) / dd;
  vec3 h = rd * tt - c;
  float pu = dot(h, ux) / asp + 0.5;
  float pv = 0.5 - dot(h, uy);
  float inside = step(0.0, pu) * step(pu, 1.0) * step(0.0, pv) * step(pv, 1.0) * step(0.0, tt);
  return vec4(pu, pv, tt + (1.0 - inside) * 100000.0, dn);
}
vec3 stage(vec2 uv) { float v = length((uv - 0.5) * vec2(1.0, 1.4)); return mix(vec3(0.955, 0.95, 0.94), vec3(0.86, 0.85, 0.84), smoothstep(0.2, 0.95, v)); }

vec4 tr(vec2 uv) {
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 rd = normalize(vec3(s.x, -s.y, -1.2));
  float hw = aspect * 0.5;
  float e = p * p * (3.0 - 2.0 * p);
  float ang = e * 1.5708;
  float back = sin(3.14159 * p) * 1.4 * pc.x;
  vec3 ctr = vec3(0.0, 0.0, -1.2 - hw - back);
  vec3 ea = vec3(0.0, -ang, 0.0);
  vec3 eb = vec3(0.0, 1.5708 - ang, 0.0);
  vec4 ha = hitPlane(rd, ctr + orient(vec3(0.0, 0.0, hw), ea), ea, aspect);
  vec4 hb = hitPlane(rd, ctr + orient(vec3(0.0, 0.0, hw), eb), eb, aspect);
  vec3 col = stage(uv);
  float aOk = step(ha.z, 10000.0) * step(ha.w, 0.0);
  float bOk = step(hb.z, 10000.0) * step(hb.w, 0.0);
  if (aOk > 0.5) { col = A(ha.xy).rgb * mix(0.62, 1.0, abs(ha.w)); }
  if (bOk > 0.5 && (aOk < 0.5 || hb.z < ha.z)) { col = B(hb.xy).rgb * mix(0.62, 1.0, abs(hb.w)); }
  return vec4(col, 1.0);
}` },
  flip: { name: 'Card flip', overlap: 1.0, about: 'The frame flips over like a card; the next chapter is on its back.', src: `
vec3 rotX(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotY(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 orient(vec3 v, vec3 e) { return rotY(rotX(rotZ(v, e.z), e.x), e.y); }
vec4 hitPlane(vec3 rd, vec3 c, vec3 e, float asp) {
  vec3 n = orient(vec3(0.0, 0.0, 1.0), e);
  vec3 ux = orient(vec3(1.0, 0.0, 0.0), e);
  vec3 uy = orient(vec3(0.0, 1.0, 0.0), e);
  float dn = dot(rd, n);
  float dd = dn;
  if (abs(dd) < 0.0001) { dd = 0.0001; }
  float tt = dot(c, n) / dd;
  vec3 h = rd * tt - c;
  float pu = dot(h, ux) / asp + 0.5;
  float pv = 0.5 - dot(h, uy);
  float inside = step(0.0, pu) * step(pu, 1.0) * step(0.0, pv) * step(pv, 1.0) * step(0.0, tt);
  return vec4(pu, pv, tt + (1.0 - inside) * 100000.0, dn);
}
vec3 stage(vec2 uv) { float v = length((uv - 0.5) * vec2(1.0, 1.4)); return mix(vec3(0.955, 0.95, 0.94), vec3(0.86, 0.85, 0.84), smoothstep(0.2, 0.95, v)); }

vec4 tr(vec2 uv) {
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 rd = normalize(vec3(s.x, -s.y, -1.2));
  float e = p * p * (3.0 - 2.0 * p);
  float back = sin(3.14159 * p) * 0.9 * pc.x;
  vec4 h = hitPlane(rd, vec3(0.0, 0.0, -1.2 - back), vec3(0.08 * pc.y * sin(3.14159 * p), e * 3.14159, 0.0), aspect);
  vec3 col = stage(uv);
  if (h.z < 10000.0) {
    float sh = mix(0.7, 1.0, abs(h.w));
    if (h.w < 0.0) { col = A(h.xy).rgb * sh; } else { col = B(vec2(1.0 - h.x, h.y)).rgb * sh; }
  }
  return vec4(col, 1.0);
}` },
  camera: { name: '3D camera', scene: true, overlap: 0, about: 'The chapter as a card in 3D space, seen by a moving camera.', src: `
vec3 rotX(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 rotY(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }
vec3 rotZ(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
vec3 orient(vec3 v, vec3 e) { return rotY(rotX(rotZ(v, e.z), e.x), e.y); }
vec4 hitPlane(vec3 rd, vec3 c, vec3 e, float asp) {
  vec3 n = orient(vec3(0.0, 0.0, 1.0), e);
  vec3 ux = orient(vec3(1.0, 0.0, 0.0), e);
  vec3 uy = orient(vec3(0.0, 1.0, 0.0), e);
  float dn = dot(rd, n);
  float dd = dn;
  if (abs(dd) < 0.0001) { dd = 0.0001; }
  float tt = dot(c, n) / dd;
  vec3 h = rd * tt - c;
  float pu = dot(h, ux) / asp + 0.5;
  float pv = 0.5 - dot(h, uy);
  float inside = step(0.0, pu) * step(pu, 1.0) * step(0.0, pv) * step(pv, 1.0) * step(0.0, tt);
  return vec4(pu, pv, tt + (1.0 - inside) * 100000.0, dn);
}
vec3 stage(vec2 uv) { float v = length((uv - 0.5) * vec2(1.0, 1.4)); return mix(vec3(0.955, 0.95, 0.94), vec3(0.86, 0.85, 0.84), smoothstep(0.2, 0.95, v)); }

vec4 tr(vec2 uv) {
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 rd = normalize(vec3(s.x, -s.y, -1.2));
  vec3 e = vec3(pa.y, pa.x, pa.z);
  vec3 c = vec3(pb.x, pb.y, -1.2 / pa.w);
  vec4 h = hitPlane(rd, c, e, aspect);
  vec3 bg = stage(uv);
  float sh = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec3 rd2 = normalize(vec3(s.x - 0.018 - fi * 0.006, -s.y + 0.03 + fi * 0.01, -1.2));
    vec4 h2 = hitPlane(rd2, c, e, aspect);
    sh += step(h2.z, 10000.0) / 6.0;
  }
  bg = bg * (1.0 - sh * 0.16);
  if (h.z < 10000.0) { return vec4(A(h.xy).rgb * mix(0.84, 1.0, abs(h.w)), 1.0); }
  return vec4(bg, 1.0);
}` },
  mesh: { name: 'Mesh gradient', scene: true, overlap: 0, about: 'One or two soft colours drifting over the background.', src: `
vec3 lin2lab(vec3 c) {
  float l = 0.4122214708 * c.x + 0.5363325363 * c.y + 0.0514459929 * c.z;
  float m = 0.2119034982 * c.x + 0.6806995451 * c.y + 0.1073969566 * c.z;
  float s = 0.0883024619 * c.x + 0.2817188376 * c.y + 0.6299787005 * c.z;
  float l3 = pow(max(l, 0.0), 0.3333333);
  float m3 = pow(max(m, 0.0), 0.3333333);
  float s3 = pow(max(s, 0.0), 0.3333333);
  return vec3(0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3, 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3, 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3);
}
vec3 lab2lin(vec3 c) {
  float l3 = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m3 = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s3 = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  float l = l3 * l3 * l3;
  float m = m3 * m3 * m3;
  float s = s3 * s3 * s3;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
vec3 srgb2lab(vec3 c) { return lin2lab(pow(clamp(c, vec3(0.0), vec3(1.0)), vec3(2.2))); }
vec3 lab2srgb(vec3 c) { return pow(clamp(lab2lin(c), vec3(0.0), vec3(1.0)), vec3(0.4545)); }

vec3 pick(vec3 a, vec3 b, vec3 c, vec3 d, vec3 e, float k) { return mix(mix(mix(a, b, step(0.5, k)), mix(c, d, step(2.5, k)), step(1.5, k)), e, step(3.5, k)); }
vec4 tr(vec2 uv) {
  float idx = pa.x;
  vec3 egg = vec3(0.984, 0.98, 0.972);
  vec3 base = mix(egg, vec3(0.055, 0.051, 0.063), step(3.5, idx));
  vec3 c1 = pick(vec3(0.76, 0.73, 0.96), vec3(0.78, 0.87, 0.97), vec3(1.0, 0.83, 0.75), vec3(0.87, 0.85, 0.98), vec3(0.19, 0.16, 0.39), idx);
  vec3 c2 = pick(vec3(1.0, 0.87, 0.82), vec3(0.87, 0.85, 0.98), vec3(0.9, 0.88, 1.0), vec3(0.84, 0.93, 0.95), vec3(0.24, 0.11, 0.08), idx);
  vec2 q = uv * vec2(aspect, 1.0);
  float tm = t * pa.z;
  vec2 w = q + 0.3 * vec2(vnoise(q * 1.1 + vec2(tm * 0.2, 0.0)) - 0.5, vnoise(q * 1.1 + vec2(3.0, tm * 0.17)) - 0.5);
  vec2 s1 = vec2(aspect * (0.34 + 0.2 * sin(tm * 0.21)), 0.38 + 0.18 * cos(tm * 0.17));
  vec2 s2 = vec2(aspect * (0.7 + 0.18 * cos(tm * 0.19 + 1.3)), 0.64 + 0.16 * sin(tm * 0.23 + 2.0));
  float w1 = exp(-dot(w - s1, w - s1) * 1.9);
  float w2 = exp(-dot(w - s2, w - s2) * 2.4) * pb.x;
  vec3 lab = srgb2lab(base);
  lab = mix(lab, srgb2lab(c1), w1 * pa.y);
  lab = mix(lab, srgb2lab(c2), w2 * pa.y);
  vec3 col = lab2srgb(lab);
  col = col + vec3((hash21(uv * vec2(1920.0, 1080.0) + vec2(fract(t * 7.0) * 91.0, 0.0)) - 0.5) * pa.w * 0.03);
  return vec4(col, 1.0);
}` },
  lens: { name: 'Glass ball', overlap: 1.4, about: 'A solid glass ball grows over the frame, showing the next chapter upside down inside it, as real glass does, with a bright focused spot in its shadow.', src: `
vec3 envS(vec3 r) {
  vec3 c = mix(vec3(0.5, 0.51, 0.54), vec3(0.98, 0.98, 1.0), smoothstep(-0.3, 0.55, r.y));
  c = c - vec3(0.3) * exp(-abs(r.y + 0.03) * 16.0);
  c = c + vec3(1.0, 1.0, 1.0) * exp(-(r.x + 0.55) * (r.x + 0.55) * 14.0) * smoothstep(0.2, 0.7, r.y) * 0.7;
  c = c + vec3(1.0, 0.93, 0.85) * exp(-(r.x - 0.7) * (r.x - 0.7) * 30.0) * smoothstep(-0.1, 0.35, r.y) * 0.35;
  return c;
}
vec2 toUV(vec3 pt, float asp) { float k = 1.9 / (4.2 - pt.z); return vec2(pt.x * k / asp + 0.5, 0.5 - pt.y * k); }

vec4 tr(vec2 uv) {
  float e = p * p * (3.0 - 2.0 * p);
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 ro = vec3(0.0, 0.0, 4.2);
  vec3 rd = normalize(vec3(s.x, -s.y, -1.9));
  vec3 Ld = normalize(vec3(-0.45, 0.6, 0.66));
  float R = mix(0.02, 2.0, e) * pc.y;
  vec3 cen = vec3(0.0, 0.0, 1.0);
  float ior = 1.0 + 0.5 * pc.x * (1.0 - smoothstep(0.7, 1.0, e));
  vec3 oc = ro - cen;
  float b = dot(oc, rd);
  float h = b * b - (dot(oc, oc) - R * R);
  vec3 col = vec3(0.0);
  if (h < 0.0) {
    vec3 fp = vec3(s.x * 4.2 / 1.9, -s.y * 4.2 / 1.9, 0.0);
    float dm = length(cross(cen - fp, Ld));
    float along = dot(cen - fp, Ld);
    float shade = (1.0 - smoothstep(R * 0.75, R * 1.12, dm)) * step(0.0, along);
    float spot = exp(-(dm * dm) / (R * R * 0.06)) * step(0.0, along);
    col = A(uv).rgb * (1.0 - shade * 0.24) + vec3(1.0, 0.97, 0.9) * spot * 0.45;
  } else {
    vec3 p0 = ro + rd * (-b - sqrt(h));
    vec3 n = normalize(p0 - cen);
    n = normalize(n + 0.025 * pc.w * vec3(sin(p0.y * 9.0 + t * 2.0), sin(p0.x * 8.0 - t * 1.7), 0.0));
    float cosi = clamp(dot(-rd, n), 0.0, 1.0);
    float fres = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
    vec3 rr = reflect(rd, n);
    vec3 r1 = refract(rd, n, 1.0 / ior);
    vec3 o2 = p0 - cen;
    float b2 = dot(o2, r1);
    float t2 = -b2 + sqrt(max(b2 * b2 - (dot(o2, o2) - R * R), 0.0));
    vec3 pe = p0 + r1 * t2;
    vec3 ne = normalize(pe - cen);
    for (int c = 0; c < 3; c++) {
      float ic = ior + (float(c) - 1.0) * 0.012 * pc.z;
      vec3 r2 = refract(r1, -ne, ic);
      if (dot(r2, r2) < 0.01) { r2 = reflect(r1, -ne); }
      float tp = (0.0 - pe.z) / min(r2.z, -0.05);
      vec3 smp = B(clamp(toUV(pe + r2 * tp, aspect), vec2(0.0), vec2(1.0))).rgb;
      if (c == 0) { col.x = smp.x; }
      if (c == 1) { col.y = smp.y; }
      if (c == 2) { col.z = smp.z; }
    }
    col = col * mix(vec3(1.0), vec3(0.88, 0.95, 0.93), clamp(t2 * 0.25, 0.0, 0.5));
    float spec = pow(max(dot(rr, Ld), 0.0), 220.0) * 1.8 + pow(max(dot(rr, normalize(vec3(0.6, 0.35, 0.72))), 0.0), 60.0) * 0.4;
    col = mix(col, envS(rr), clamp(fres * (1.0 - smoothstep(0.8, 1.0, e)), 0.0, 1.0)) + vec3(spec * (1.0 - smoothstep(0.85, 1.0, e)));
  }
  return vec4(mix(col, B(uv).rgb, smoothstep(0.9, 1.0, p)), 1.0);
}` },
  leak: { name: 'Light leak', overlap: 1.1, about: 'Hot light leaks flare in from the edges of the frame and burn through to the next chapter.', src: `
vec4 tr(vec2 uv) {
  vec2 q = uv * vec2(aspect, 1.0);
  float n1 = fbm(q * 1.4 + vec2(t * 0.5, seed));
  float amt = sin(3.14159 * p);
  vec2 c1 = vec2(-0.05, mix(1.1, -0.1, p));
  vec2 c2 = vec2(mix(-0.2, aspect * 0.7, p), -0.05);
  vec2 c3 = vec2(aspect + 0.05, mix(0.2, 0.9, p));
  float l1 = exp(-length((q - c1) * vec2(1.0, 0.55)) * 3.4 / pc.y) * (0.7 + 0.8 * n1);
  float l2 = exp(-length((q - c2) * vec2(0.6, 1.0)) * 4.0 / pc.y) * (0.6 + 0.8 * n1);
  float l3 = exp(-length((q - c3) * vec2(1.0, 0.7)) * 3.8 / pc.y) * (0.6 + 0.7 * n1);
  float streak = exp(-abs(uv.y - mix(0.2, 0.7, p) + (uv.x - 0.5) * 0.3) * 30.0) * smoothstep(0.2, 0.5, p) * smoothstep(0.8, 0.5, p) * 0.6 * pc.z;
  vec3 warm = vec3(1.0, 0.3, 0.05) * l1 * 1.6 + vec3(1.0, 0.55, 0.12) * l2 * 1.4 + vec3(1.0, 0.18, 0.28) * l3 * 1.3 + vec3(1.0, 0.75, 0.45) * streak;
  vec3 base = mix(A(uv).rgb, B(uv).rgb, smoothstep(0.44, 0.56, p));
  vec3 lit = clamp(warm * amt * pc.x, vec3(0.0), vec3(0.96));
  float lum = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 scr = vec3(1.0) - (vec3(1.0) - base) * (vec3(1.0) - lit);
  vec3 tint = base * mix(vec3(1.0), vec3(1.0, 0.5, 0.26), clamp(length(lit) * 0.95, 0.0, 0.88));
  vec3 col = mix(scr, tint, smoothstep(0.55, 0.95, lum));
  col = col + vec3((hash21(uv * 1100.0 + fract(t) * 17.0) - 0.5) * 0.045 * pc.w * amt);
  return vec4(col, 1.0);
}` },
  melt: { name: 'Datamosh melt', overlap: 1.2, about: 'The old picture smears along the motion of the new one, then the new chapter punches through block by block.', src: `
vec4 tr(vec2 uv) {
  vec2 blk = (floor(uv * vec2(48.0, 27.0) / pc.y) + 0.5) / (vec2(48.0, 27.0) / pc.y);
  float gx = dot(B(blk + vec2(0.012, 0.0)).rgb - B(blk - vec2(0.012, 0.0)).rgb, vec3(0.333));
  float gy = dot(B(blk + vec2(0.0, 0.02)).rgb - B(blk - vec2(0.0, 0.02)).rgb, vec3(0.333));
  vec2 mv = vec2(gx, gy) * 0.7 + (vec2(hash21(blk * 91.0), hash21(blk * 37.0 + 4.0)) - 0.5) * 0.06;
  float sm = smoothstep(0.0, 0.75, p);
  vec2 s = uv - mv * sm * 1.8 * pc.x - vec2(0.0, 0.07) * sm * sm * pc.x;
  vec3 a = A(clamp(s, vec2(0.0), vec2(1.0))).rgb;
  float region = vnoise(blk * vec2(6.0, 4.0) + seed) * 0.7 + hash21(blk * 13.0) * 0.3;
  float reveal = step(region, smoothstep(0.3, 0.95, p));
  vec2 pour = mv * (1.0 - smoothstep(0.3, 1.0, p)) * 1.2 + vec2(0.0, -0.05) * (1.0 - p);
  vec3 b = B(clamp(uv + pour, vec2(0.0), vec2(1.0))).rgb;
  return vec4(mix(a, b, max(reveal, smoothstep(0.9, 1.0, p))), 1.0);
}` },
  smear: { name: 'Smear frames', overlap: 0.8, about: 'Both chapters stretch into motion streaks as the camera whips from one to the next.', src: `
vec4 tr(vec2 uv) {
  float e = p * p * (3.0 - 2.0 * p);
  float rnd = hash21(vec2(floor(uv.y * 60.0 * pc.y), 3.0));
  float str = sin(3.14159 * p) * (0.3 + 0.7 * rnd) * pc.x;
  float xa = uv.x - e * (0.5 + 0.9 * rnd);
  float xb = uv.x + (1.0 - e) * (0.5 + 0.9 * rnd);
  vec3 ca = vec3(0.0);
  vec3 cb = vec3(0.0);
  for (int i = 0; i < 14; i++) {
    float k = float(i) / 13.0;
    ca += A(vec2(clamp(xa - k * str * 0.3, 0.0, 1.0), uv.y)).rgb;
    cb += B(vec2(clamp(xb - k * str * 0.3, 0.0, 1.0), uv.y)).rgb;
  }
  float m = smoothstep(0.4, 0.6, p + (rnd - 0.5) * 0.3);
  return vec4(mix(ca / 14.0, cb / 14.0, m), 1.0);
}` },
  orb: { name: 'Voice orb', scene: true, overlap: 0, about: 'The voice orb.', src: `
vec3 lin2lab(vec3 c) {
  float l = 0.4122214708 * c.x + 0.5363325363 * c.y + 0.0514459929 * c.z;
  float m = 0.2119034982 * c.x + 0.6806995451 * c.y + 0.1073969566 * c.z;
  float s = 0.0883024619 * c.x + 0.2817188376 * c.y + 0.6299787005 * c.z;
  float l3 = pow(max(l, 0.0), 0.3333333);
  float m3 = pow(max(m, 0.0), 0.3333333);
  float s3 = pow(max(s, 0.0), 0.3333333);
  return vec3(0.2104542553 * l3 + 0.793617785 * m3 - 0.0040720468 * s3, 1.9779984951 * l3 - 2.428592205 * m3 + 0.4505937099 * s3, 0.0259040371 * l3 + 0.7827717662 * m3 - 0.808675766 * s3);
}
vec3 lab2lin(vec3 c) {
  float l3 = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m3 = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s3 = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
  float l = l3 * l3 * l3;
  float m = m3 * m3 * m3;
  float s = s3 * s3 * s3;
  return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
vec3 srgb2lab(vec3 c) { return lin2lab(pow(clamp(c, vec3(0.0), vec3(1.0)), vec3(2.2))); }
vec3 lab2srgb(vec3 c) { return pow(clamp(lab2lin(c), vec3(0.0), vec3(1.0)), vec3(0.4545)); }

vec3 orbA(float k) { return mix(mix(vec3(0.62, 0.57, 1.0), vec3(1.0, 0.58, 0.42), step(0.5, k)), mix(vec3(0.3, 0.72, 0.7), mix(vec3(0.72, 0.74, 0.8), vec3(0.95, 0.55, 0.75), step(3.5, k)), step(2.5, k)), step(1.5, k)); }
vec3 orbB(float k) { return mix(mix(vec3(0.66, 0.84, 1.0), vec3(1.0, 0.86, 0.72), step(0.5, k)), mix(vec3(0.72, 0.95, 0.88), mix(vec3(0.96, 0.97, 1.0), vec3(0.8, 0.76, 1.0), step(3.5, k)), step(2.5, k)), step(1.5, k)); }
vec4 tr(vec2 uv) {
  vec2 q = (uv - 0.5) * 2.0;
  float r = length(q);
  float energy = pb.x;
  float tm = t * (0.35 + energy * 0.6) * pa.x;
  float z = sqrt(max(1.0 - r * r, 0.0));
  vec3 n = vec3(q.x, -q.y, z);
  vec2 sp = q / (0.6 + 0.4 * z);
  vec2 wq = vec2(sp.x * 0.8 - sp.y * 0.6, sp.x * 0.6 + sp.y * 0.8) * 0.9;
  vec2 sr = vec2(sp.x * 0.34 + sp.y * 0.94, -sp.x * 0.94 + sp.y * 0.34);
  vec2 warp = vec2(vnoise(wq * 1.2 + vec2(tm * 0.35, 1.7)), vnoise(wq * 1.2 + vec2(4.3, -tm * 0.3))) - 0.5;
  float f = vnoise(wq * 1.1 + warp * 1.6 + vec2(-tm * 0.25, tm * 0.2)) * 0.7 + vnoise(wq * 2.3 - warp + vec2(tm * 0.4, 0.0)) * 0.3;
  vec3 lab = mix(srgb2lab(orbA(pb.y)), srgb2lab(orbB(pb.y)), smoothstep(0.25, 0.75, f));
  float cloud = smoothstep(0.45, 0.8, vnoise(sr * 1.4 + vec2(tm * 0.3, -tm * 0.2) + warp * 0.8) * 0.75 + vnoise(sp * 0.9 + vec2(-tm * 0.2, 5.0)) * 0.25);
  lab = mix(lab, srgb2lab(vec3(0.97, 0.97, 1.0)), cloud * 0.55 * pa.y);
  vec3 col = lab2srgb(lab);
  vec2 gc = q - vec2(-0.15, -0.25);
  col = mix(col, vec3(1.0, 1.0, 1.0), exp(-dot(gc, gc) * 1.6) * 0.22 * pa.z);
  col = col * (0.9 + 0.1 * z);
  col = mix(col, vec3(0.96, 0.97, 1.0), pow(1.0 - z, 4.0) * 0.5 * pa.w);
  vec3 L = normalize(vec3(-0.4, 0.55, 0.73));
  col = col + vec3(pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n), L), 0.0), 18.0) * 0.22);
  col = col * (1.0 + energy * 0.06);
  return vec4(col, 1.0);
}` },
  water: { name: 'Liquid glass blob', scene: true, overlap: 0, about: 'A raymarched blob of water refracts the type behind it, with dispersion.', src: `
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float map(vec3 q0, float tm, float spl, vec4 Bp, float cnt) {
  vec3 q = vec3(q0.x, q0.y, q0.z / Bp.w);
  float sc = min(1.0, Bp.w);
  float d = (length(q) - (0.98 - 0.3 * spl) * Bp.x) * sc;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float on = step(fi + 0.5, cnt);
    vec3 c = vec3(sin(tm * (0.5 + fi * 0.13) + fi * 1.9) * 1.3, cos(tm * (0.43 + fi * 0.11) + fi * 2.7) * 0.38, sin(tm * 0.37 + fi * 1.3) * 0.5) * spl * Bp.y;
    float r = (0.4 + 0.1 * sin(fi * 2.3 + tm * 0.6)) * spl * Bp.x + 0.001;
    d = mix(d, smin(d, (length(q - c) - r) * sc, max(Bp.z, 0.02) * sc), on);
  }
  return d;
}
vec3 nrm(vec3 q, float tm, float spl, vec4 Bp, float cnt) { float e = 0.0015; return normalize(vec3(map(q + vec3(e, 0.0, 0.0), tm, spl, Bp, cnt) - map(q - vec3(e, 0.0, 0.0), tm, spl, Bp, cnt), map(q + vec3(0.0, e, 0.0), tm, spl, Bp, cnt) - map(q - vec3(0.0, e, 0.0), tm, spl, Bp, cnt), map(q + vec3(0.0, 0.0, e), tm, spl, Bp, cnt) - map(q - vec3(0.0, 0.0, e), tm, spl, Bp, cnt))); }
vec3 envDark(vec3 r) {
  float box1 = exp(-(r.x + 0.5) * (r.x + 0.5) * 16.0) * smoothstep(0.25, 0.7, r.y);
  float box2 = exp(-(r.x - 0.75) * (r.x - 0.75) * 26.0) * smoothstep(-0.1, 0.4, r.y);
  return vec3(0.015, 0.015, 0.02) + vec3(0.12) * smoothstep(0.3, 1.0, r.y) + vec3(1.0, 1.0, 1.0) * box1 * 0.95 + vec3(1.0, 0.45, 0.22) * box2 * 0.55;
}
vec3 envLight(vec3 r) {
  vec3 c = mix(vec3(0.42, 0.43, 0.47), vec3(0.97, 0.97, 0.99), smoothstep(-0.25, 0.5, r.y));
  c = c - vec3(0.28) * exp(-abs(r.y + 0.02) * 14.0);
  c = c + vec3(1.0, 1.0, 1.0) * exp(-(r.x + 0.5) * (r.x + 0.5) * 16.0) * smoothstep(0.25, 0.7, r.y) * 0.45;
  return clamp(c, vec3(0.0), vec3(1.2));
}
vec3 tintCol(float k) { return mix(mix(vec3(0.9, 0.96, 1.0), vec3(0.62, 0.57, 0.95), step(0.5, k)), mix(vec3(1.0, 0.45, 0.2), vec3(0.3, 0.78, 0.72), step(2.5, k)), step(1.5, k)); }
vec2 toUV(vec3 pt, float asp) { float k = 1.9 / (4.2 - pt.z); return vec2(pt.x * k / asp + 0.5, 0.5 - pt.y * k); }
vec4 tr(vec2 uv) {
  float tm = t * pa.z;
  float spl = mix(1.0, smoothstep(0.7, 2.4, t), pd.z);
  float clr = mix(1.0, smoothstep(0.6, 1.5, t), pd.z);
  vec2 s = (uv - 0.5) * vec2(aspect, 1.0);
  vec3 ro = vec3(0.0, 0.0, 4.2);
  vec3 rd = normalize(vec3(s.x, -s.y, -1.9));
  float d = 0.0;
  float hit = 0.0;
  for (int i = 0; i < 110; i++) { float h = map(ro + rd * d, tm, spl, pb, pa.w); if (h < 0.001) { hit = 1.0; break; } d += h; if (d > 9.0) { break; } }
  vec3 bg = A(uv).rgb;
  if (hit < 0.5) { return vec4(bg, 1.0); }
  vec3 p0 = ro + rd * d;
  vec3 n = nrm(p0, tm, spl, pb, pa.w);
  float cosi = clamp(dot(-rd, n), 0.0, 1.0);
  float fres = (0.04 + 0.96 * pow(1.0 - cosi, 5.0)) * pc.x;
  vec3 rr = reflect(rd, n);
  vec3 refl = mix(envDark(rr), envLight(rr), pd.w);
  vec3 r1 = refract(rd, n, 1.0 / pa.x);
  vec3 q = p0 - n * 0.004;
  float t2 = 0.0;
  for (int i = 0; i < 56; i++) { float h = -map(q + r1 * t2, tm, spl, pb, pa.w); if (h < 0.001) { break; } t2 += max(h, 0.008); }
  vec3 pe = q + r1 * t2;
  vec3 ne = nrm(pe, tm, spl, pb, pa.w);
  vec3 col = vec3(0.0);
  for (int c = 0; c < 3; c++) {
    float ior = pa.x + float(c) * pa.y;
    vec3 r2 = refract(r1, -ne, ior);
    if (dot(r2, r2) < 0.01) { r2 = reflect(r1, -ne); }
    float tp = (-pc.w - pe.z) / min(r2.z, -0.05);
    vec2 su = toUV(pe + r2 * tp, aspect);
    vec3 smp = A(su).rgb;
    if (pc.z > 0.001) { float f = pc.z * 0.022; smp = (smp + A(su + vec2(f, f * 0.4)).rgb + A(su + vec2(-f * 0.4, f)).rgb + A(su + vec2(-f, -f * 0.4)).rgb + A(su + vec2(f * 0.4, -f)).rgb) / 5.0; }
    if (c == 0) { col.x = smp.x; }
    if (c == 1) { col.y = smp.y; }
    if (c == 2) { col.z = smp.z; }
  }
  vec3 absorb = mix(vec3(1.0), tintCol(pd.y), clamp(pd.x * (0.35 + t2 * 0.9), 0.0, 1.0));
  col = col * absorb * mix(vec3(0.96, 0.985, 1.0), vec3(1.0), pd.w) * exp(-t2 * 0.1);
  vec3 L = normalize(vec3(-0.5, 0.7, 0.5));
  float spec = pow(max(dot(rr, L), 0.0), 140.0) * pc.y;
  vec3 water = mix(col, refl, clamp(fres, 0.0, 1.0)) + vec3(spec * 1.5);
  vec3 solid = vec3(1.0, 0.353, 0.122) * (0.28 + 0.72 * max(dot(n, L), 0.0)) + refl * 0.3 + vec3(spec * 1.3);
  return vec4(mix(solid, water, clr), 1.0);
}` },
  pool: { name: 'Pool water', overlap: 1.4, about: 'The frame sinks under rippling pool water with caustic light, and surfaces as the next chapter.', src: `
float caus(vec2 p0, float tm) {
  vec2 p = p0;
  float c = 1.0;
  for (int k = 0; k < 5; k++) {
    float tt = tm * (1.0 - 3.5 / float(k + 1));
    vec2 w = p + vec2(cos(tt - p.x) + sin(tt + p.y), sin(tt - p.y) + cos(tt + p.x));
    c += 1.0 / length(vec2(p.x / (sin(w.x + tt) / 0.005), p.y / (cos(w.y + tt) / 0.005)));
    p = w;
  }
  c = c / 5.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
vec4 tr(vec2 uv) {
  float amt = sin(3.14159 * p);
  vec2 q = uv * vec2(aspect, 1.0);
  float tm = t * 0.6 + seed;
  vec2 wav = vec2(vnoise(q * 3.0 + vec2(tm * 0.8, 0.0)) - 0.5, vnoise(q * 3.0 + vec2(0.0, tm * 0.7) + 5.0) - 0.5);
  vec2 wav2 = vec2(vnoise(q * 9.0 + vec2(-tm, 2.0)) - 0.5, vnoise(q * 9.0 + vec2(4.0, tm)) - 0.5);
  vec2 off = (wav * 0.035 + wav2 * 0.008) * amt * pc.x;
  float m = smoothstep(0.42, 0.58, p);
  vec3 under = mix(A(uv + off).rgb, B(uv + off).rgb, m);
  float cs = caus(fract((q * 5.0 * pc.z + wav * 1.5) / 6.2831853) * 6.2831853 - vec2(250.0), tm);
  vec3 tint = mix(vec3(1.0), vec3(0.86, 0.95, 1.0), clamp(amt * 0.7 * pc.w, 0.0, 1.0));
  vec3 col = under * tint + vec3(0.9, 0.97, 1.0) * clamp(cs, 0.0, 1.0) * 0.45 * pc.y * amt;
  return vec4(col, 1.0);
}` },
  rays: { name: 'God rays', overlap: 1.3, about: 'Shafts of light break through from above and carry in the next chapter.', src: `
vec4 tr(vec2 uv) {
  vec2 c = vec2(pc.z, -0.2);
  vec2 d = (uv - c) * vec2(aspect, 1.0);
  float ang = atan(d.y, d.x);
  float r = length(d);
  float sh = vnoise(vec2(ang * 16.0 * pc.y, t * 0.35)) * 0.6 + vnoise(vec2(ang * 44.0 * pc.y, t * 0.55 + 3.0)) * 0.4;
  sh = pow(sh, 2.2);
  float amt = sin(3.14159 * p);
  float light = (sh * exp(-r * 0.8) * amt * 1.7 + amt * amt * 0.3 * exp(-r * 1.4)) * pc.x;
  vec3 base = mix(A(uv).rgb, B(uv).rgb, smoothstep(0.42, 0.58, p));
  base = base * (1.0 - 0.18 * pc.w * amt * (1.0 - sh));
  vec3 col = mix(base, vec3(1.0, 0.96, 0.88), clamp(light, 0.0, 0.92));
  col = col + vec3((hash21(uv * 900.0 + fract(t) * 13.0) - 0.5) * 0.03 * amt);
  return vec4(col, 1.0);
}` },
  barrel: { name: 'Lens distortion', overlap: 0.9, about: 'The frame bulges through a wide lens with colour fringing, then snaps flat on the next chapter.', src: `
vec4 tr(vec2 uv) {
  float amt = sin(3.14159 * p);
  vec2 c = uv - 0.5;
  vec2 ca2 = c * vec2(aspect, 1.0);
  float r2 = dot(ca2, ca2);
  float k = amt * 0.55 * pc.x;
  vec2 dr = c * (1.0 + k * r2) / (1.0 + k * 0.62) * (1.0 - amt * 0.06);
  float ca = amt * 0.006 * pc.y;
  float m = smoothstep(0.46, 0.54, p);
  vec2 lo = vec2(0.0);
  vec2 hi = vec2(1.0);
  vec3 a = vec3(A(clamp(0.5 + dr * (1.0 + ca), lo, hi)).r, A(clamp(0.5 + dr, lo, hi)).g, A(clamp(0.5 + dr * (1.0 - ca), lo, hi)).b);
  vec3 b = vec3(B(clamp(0.5 + dr * (1.0 + ca), lo, hi)).r, B(clamp(0.5 + dr, lo, hi)).g, B(clamp(0.5 + dr * (1.0 - ca), lo, hi)).b);
  float vig = 1.0 - amt * 0.3 * pc.z * smoothstep(0.2, 0.95, length(ca2));
  return vec4(mix(a, b, m) * vig, 1.0);
}` },
  drops: { name: 'Water drops', scene: true, overlap: 0, about: 'Drops of water on the page magnify the words beneath them.', src: `
float smx(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }
float drops(vec2 q, float tm, float asp, vec4 P, vec4 Q) {
  float s = -1.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float on = step(fi + 0.5, P.w);
    vec2 c = vec2(asp * (0.5 + 0.4 * sin(tm * (0.1 + fi * 0.023) + fi * 2.1)), 0.52 + 0.3 * sin(tm * (0.08 + fi * 0.019) + fi * 1.3 + 1.0));
    float R = (0.075 + 0.05 * fract(fi * 0.618 + 0.3)) * P.x;
    vec2 d = q - c;
    float si = sqrt(max(R * R - dot(d, d), 0.0)) - (R - R * Q.x);
    s = smx(s, mix(-1.0, si, on), max(Q.y, 0.001));
  }
  return max(s, 0.0);
}
vec4 tr(vec2 uv) {
  float tm = t * pa.z;
  vec2 q = uv * vec2(aspect, 1.0);
  float h = drops(q, tm, aspect, pa, pb);
  float e = 0.0015;
  vec2 g = vec2(drops(q + vec2(e, 0.0), tm, aspect, pa, pb) - drops(q - vec2(e, 0.0), tm, aspect, pa, pb), drops(q + vec2(0.0, e), tm, aspect, pa, pb) - drops(q - vec2(0.0, e), tm, aspect, pa, pb)) / (2.0 * e);
  float wet = smoothstep(0.0, 0.0015, h);
  float slope = length(g);
  float dark = pd.x;
  vec2 off = g * h * pa.y / vec2(aspect, 1.0);
  float disp = clamp(slope * pb.z * 0.1, 0.0, 0.35);
  vec3 under = vec3(A(uv + off * (1.0 + disp)).r, A(uv + off).g, A(uv + off * (1.0 - disp)).b);
  under = under * mix(vec3(1.0), vec3(0.84, 0.95, 1.0), pb.w);
  vec3 n = normalize(vec3(-g.x, g.y, 1.0));
  vec3 L = normalize(vec3(-0.5, 0.62, 0.6));
  vec3 rv = reflect(vec3(0.0, 0.0, -1.0), n);
  float rim = smoothstep(0.6, 1.7, slope);
  float contact = smoothstep(0.004, 0.0, h) * wet;
  vec3 wc = under * (1.03 - (rim * 0.3 + contact * 0.45) * pc.w / 0.3 * (1.0 - dark));
  wc = wc + vec3(rim * pc.w * 0.8 + contact * 0.25) * dark * vec3(0.8, 0.85, 0.9);
  wc = mix(wc, vec3(0.97, 0.98, 1.0), pow(1.0 - n.z, 3.0) * (0.12 + 0.2 * dark));
  wc = wc + vec3(pow(max(dot(rv, L), 0.0), 240.0) * 1.6 + pow(max(dot(rv, L), 0.0), 24.0) * 0.12) * pc.z;
  float opp = max(dot(normalize(vec2(g.x, -g.y) + vec2(0.0001)), normalize(vec2(-0.5, 0.62))), 0.0);
  wc = wc + vec3(rim * opp * 0.18);
  float hs = drops(q - vec2(0.016, 0.022), tm, aspect, pa, pb);
  float shade = smoothstep(0.0, 0.004, hs) * 0.16 * pc.x * (1.0 - dark);
  float focus = smoothstep(0.01, 0.045, hs) * 0.22 * pc.y * (1.0 + dark);
  vec3 paper = A(uv).rgb * (1.0 - shade) + vec3(focus * 0.9, focus * 0.92, focus);
  return vec4(mix(paper, wc, wet), 1.0);
}` },
  grade: { name: 'Look', scene: true, overlap: 0, about: 'Exposure, contrast, saturation, warmth, vignette and grain.', src: `
vec4 tr(vec2 uv) {
  vec3 c = A(uv).rgb * pow(2.0, pa.x);
  c = (c - vec3(0.5)) * pa.y + vec3(0.5);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, pa.z);
  c = c * vec3(1.0 + pa.w * 0.09, 1.0 + pa.w * 0.01, 1.0 - pa.w * 0.09);
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  c = c * (1.0 - pb.x * 0.75 * smoothstep(0.3, 1.1, length(d)));
  c = c + vec3((hash21(uv * vec2(1920.0, 1080.0) + vec2(fract(t * 7.0) * 91.0, 0.0)) - 0.5) * pb.y * 0.14);
  return vec4(clamp(c, vec3(0.0), vec3(1.0)), 1.0);
}` },
  push: { name: 'Push', overlap: 0.8, about: 'The next scene pushes the current one out sideways, with motion blur and a soft shadow on its leading edge.', src: `
vec4 tr(vec2 uv) {
  float e = mix(4.0 * p * p * p, 1.0 - pow(-2.0 * p + 2.0, 3.0) / 2.0, step(0.5, p));
  vec2 ua = uv + vec2(e, 0.0);
  vec2 ub = uv + vec2(e - 1.0, 0.0);
  float bl = sin(3.14159 * p) * 0.035 * pc.x;
  vec3 ca = vec3(0.0);
  vec3 cb = vec3(0.0);
  for (int i = 0; i < 8; i++) { float o = (float(i) / 7.0 - 0.5) * bl; ca += A(clamp(ua + vec2(o, 0.0), vec2(0.0), vec2(1.0))).rgb; cb += B(clamp(ub + vec2(o, 0.0), vec2(0.0), vec2(1.0))).rgb; }
  ca = ca / 8.0;
  cb = cb / 8.0;
  float seam = uv.x - (1.0 - e);
  vec3 col = mix(ca, cb, step(0.0, seam));
  col = col * (1.0 - 0.3 * pc.y * exp(-abs(seam) * 36.0) * (1.0 - step(0.0, seam)) * sin(3.14159 * p));
  return vec4(col, 1.0);
}` },
};


/* the controls each transition exposes; slot a = pa (defaults 0.5, 0.55, 0, 0), c = pc and d = pd (defaults 1) */

const TP = {
  liquid: [['cx', 'Drop across', 0, 1, 0.01, 0.5, 'a0'], ['cy', 'Drop down', 0, 1, 0.01, 0.55, 'a1'], ['ripple', 'Ripple strength', 0, 3, 0.01, 1, 'c0'], ['rings', 'Ring count', 0.3, 3, 0.01, 1, 'c1'], ['rim', 'Rim light', 0, 3, 0.01, 1, 'c2']],
  glass: [['thick', 'Thickness', 0.3, 3, 0.01, 1, 'c0'], ['refr', 'Refraction', 0.2, 2, 0.01, 1, 'c1'], ['disp', 'Colour split', 0, 3, 0.01, 1, 'c2'], ['width', 'Pane width', 0.5, 1.8, 0.01, 1, 'c3'], ['tilt', 'Turn', 0, 2.5, 0.01, 1, 'd0']],
  frosted: [['blur', 'Blur', 0.2, 3, 0.01, 1, 'c0'], ['frost', 'Frost', 0, 3, 0.01, 1, 'c1'], ['size', 'Pane size', 0.6, 1.2, 0.01, 1, 'c2'], ['bevel', 'Bevel', 0.3, 3, 0.01, 1, 'c3']],
  reeded: [['rib', 'Rib width', 0.4, 3, 0.01, 1, 'c0'], ['refr', 'Refraction', 0, 3, 0.01, 1, 'c1'], ['width', 'Panel width', 0.4, 1.8, 0.01, 1, 'c2']],
  lens: [['refr', 'Refraction', 0.2, 2, 0.01, 1, 'c0'], ['size', 'Ball size', 0.6, 1.4, 0.01, 1, 'c1'], ['disp', 'Colour split', 0, 3, 0.01, 1, 'c2'], ['wobble', 'Surface ripple', 0, 4, 0.01, 1, 'c3']],
  leak: [['amount', 'Intensity', 0, 2, 0.01, 1, 'c0'], ['size', 'Flare size', 0.4, 2.5, 0.01, 1, 'c1'], ['streak', 'Streak', 0, 3, 0.01, 1, 'c2'], ['grain', 'Grain', 0, 3, 0.01, 1, 'c3']],
  pool: [['waves', 'Wave strength', 0, 3, 0.01, 1, 'c0'], ['caustics', 'Caustic light', 0, 3, 0.01, 1, 'c1'], ['scale', 'Caustic scale', 0.4, 2.5, 0.01, 1, 'c2'], ['tint', 'Water tint', 0, 2, 0.01, 1, 'c3']],
  rays: [['amount', 'Intensity', 0, 2, 0.01, 1, 'c0'], ['count', 'Ray count', 0.3, 3, 0.01, 1, 'c1'], ['source', 'Source across', 0, 1, 0.01, 0.5, 'c2'], ['haze', 'Haze', 0, 3, 0.01, 1, 'c3']],
  barrel: [['strength', 'Strength', 0, 2, 0.01, 1, 'c0'], ['fringe', 'Colour fringe', 0, 4, 0.01, 1, 'c1'], ['vignette', 'Vignette', 0, 3, 0.01, 1, 'c2']],
  glitch: [['amount', 'Amount', 0, 2, 0.01, 1, 'c0'], ['blocks', 'Blocks', 0, 4, 0.01, 1, 'c1'], ['split', 'Colour split', 0, 3, 0.01, 1, 'c2']],
  burn: [['glow', 'Ember glow', 0, 3, 0.01, 1, 'c0'], ['scale', 'Burn pattern', 0.3, 3, 0.01, 1, 'c1']],
  ink: [['edge', 'Edge darkness', 0, 1.25, 0.01, 1, 'c0'], ['scale', 'Texture scale', 0.3, 3, 0.01, 1, 'c1'], ['rough', 'Raggedness', 0, 2.5, 0.01, 1, 'c2']],
  whip: [['blur', 'Motion blur', 0, 3, 0.01, 1, 'c0']],
  zoom: [['depth', 'Zoom depth', 0.2, 3, 0.01, 1, 'c0'], ['blur', 'Radial blur', 0, 3, 0.01, 1, 'c1']],
  mosaic: [['tiles', 'Tile size', 0.3, 4, 0.01, 1, 'c0'], ['grid', 'Grid lines', 0, 3, 0.01, 1, 'c1']],
  halftone: [['dots', 'Dot size', 0.4, 3, 0.01, 1, 'c0'], ['bulge', 'Bulge', 0, 3, 0.01, 1, 'c1']],
  stained: [['cells', 'Pane size', 0.4, 3, 0.01, 1, 'c0'], ['colour', 'Colour', 0, 1.8, 0.01, 1, 'c1'], ['lead', 'Leading', 0.3, 3, 0.01, 1, 'c2']],
  chrome: [['band', 'Wave width', 0.4, 2.5, 0.01, 1, 'c0'], ['detail', 'Surface detail', 0.3, 3, 0.01, 1, 'c1']],
  smear: [['length', 'Streak length', 0, 3, 0.01, 1, 'c0'], ['bands', 'Band count', 0.3, 3, 0.01, 1, 'c1']],
  melt: [['smear', 'Smear', 0, 3, 0.01, 1, 'c0'], ['blocks', 'Block size', 0.4, 4, 0.01, 1, 'c1']],
  cube: [['back', 'Pull back', 0, 3, 0.01, 1, 'c0']],
  flip: [['back', 'Pull back', 0, 3, 0.01, 1, 'c0'], ['tilt', 'Tilt', 0, 4, 0.01, 1, 'c1']],
  push: [['blur', 'Motion blur', 0, 3, 0.01, 1, 'c0'], ['shadow', 'Edge shadow', 0, 2.5, 0.01, 1, 'c1']],
};
const GLSL_PRE = `#version 300 es
precision highp float;
uniform sampler2D ta;
uniform sampler2D tb;
uniform float p;
uniform float t;
uniform float aspect;
uniform float seed;
uniform vec4 pa;
uniform vec4 pb;
uniform vec4 pc;
uniform vec4 pd;
in vec2 uv;
out vec4 o;
vec4 A(vec2 q) { return texture(ta, q); }
vec4 B(vec2 q) { return texture(tb, q); }
float hash21(vec2 q0) { vec2 q = fract(q0 * vec2(123.34, 456.21)); q += dot(q, q + 45.32); return fract(q.x * q.y); }
float vnoise(vec2 q) { vec2 i = floor(q); vec2 f = fract(q); vec2 w = f * f * (3.0 - 2.0 * f); float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0)); float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0)); return mix(mix(a, b, w.x), mix(c, d, w.x), w.y); }
float fbm(vec2 q0) { vec2 q = q0; float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * vnoise(q); q = q * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
`;
const VS = `#version 300 es
in vec2 aPos; out vec2 uv; void main(){ uv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

function tparams(type, vals = {}) {
  const pa = [0.5, 0.55, 0, 0], pb = [0, 0, 0, 0], pc = [1, 1, 1, 1], pd = [1, 1, 1, 1], V = { a: pa, b: pb, c: pc, d: pd };
  for (const [k, , , , , d, slot] of TP[type] || []) V[slot[0]][+slot[1]] = vals[k] ?? d;
  return { pa, pb, pc, pd };
}
root.AvaTrans = { LIB, TP, GLSL_PRE, VS, tparams };
})(window);
