// Orb engine — from the founder's «Ava Orb Lab» (his own asset), vendored verbatim: backdrops, the WebGL2 orb renderer, palettes and defaults.
(function (root) {
'use strict';
const IMG_FS = `#version 300 es
precision highp float; uniform sampler2D uImg; uniform vec2 uRes; uniform vec2 uIS; uniform float uZoom; uniform float uTime; uniform float uDrift; out vec4 frag;
void main() { vec2 uv = gl_FragCoord.xy / uRes; float ra = uRes.x / uRes.y; float ri = uIS.x / uIS.y; vec2 s = ra > ri ? vec2(1.0, ri / ra) : vec2(ra / ri, 1.0);
  float z = max(uZoom, 1.0) + 0.04 * uDrift; vec2 pan = vec2(sin(uTime * 0.05), cos(uTime * 0.037)) * 0.018 * uDrift;
  vec2 iu = (uv - 0.5) * s / z + 0.5 + pan; iu.y = 1.0 - iu.y; frag = vec4(texture(uImg, clamp(iu, vec2(0.001), vec2(0.999))).rgb, 1.0); }`;
const MESH_FS = `#version 300 es
precision highp float; uniform vec2 uRes; uniform float uTime; uniform float uDrift; uniform float uSharp; uniform float uWarp; uniform vec3 uC[6]; out vec4 frag;
float bh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float bn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f); return mix(mix(bh(i), bh(i + vec2(1.0, 0.0)), u.x), mix(bh(i + vec2(0.0, 1.0)), bh(i + vec2(1.0, 1.0)), u.x), u.y); }
vec2 anchor(int i) { if (i == 0) return vec2(0.12, 0.18); if (i == 1) return vec2(0.88, 0.22); if (i == 2) return vec2(0.5, 0.55); if (i == 3) return vec2(0.16, 0.86); if (i == 4) return vec2(0.86, 0.84); return vec2(0.52, 0.02); }
void main() { vec2 uv = gl_FragCoord.xy / uRes; float asp = uRes.x / uRes.y; vec2 c = vec2(uv.x * asp, uv.y); float t = uTime * 0.6 * uDrift;
  vec2 w = vec2(bn(c * 1.2 + vec2(t * 0.03, 0.0)), bn(c * 1.2 + vec2(7.1, -t * 0.025))) - 0.5; vec2 p = c + w * uWarp;
  vec3 col = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < 6; i++) { float fi = float(i); vec2 a = anchor(i); vec2 pt = vec2(a.x * asp, a.y) + 0.16 * vec2(sin(t * 0.07 * (fi + 1.0) + fi), cos(t * 0.05 * (fi + 2.0) + 2.0 * fi)); float d = length(p - pt); float wt = exp(-d * d * uSharp) + 0.0005; col += uC[i] * wt; ws += wt; }
  col /= ws; col += (bh(gl_FragCoord.xy + fract(uTime) * 77.0) - 0.5) * 0.012; frag = vec4(col, 1.0); }`;
/* the supplied images, in the order they were attached */
const IMAGES = { swirl: 'Swirl sphere', folds: 'Peach folds', aurora: 'Aurora tree', mauve: 'Mauve arches', taupe: 'Taupe arches', sunset: 'Sunset studio', blue: 'Blue arches', pool: 'Pink pool', coral: 'Coral hall', pampas: 'Pampas', ball: 'Beach ball' };
/* real mesh gradients: distinct colour fields blended organically */
const MESH = {
  aura: ['Aura', ['#A8D8FF', '#C7B8FF', '#FFB8E1', '#FFD1B0', '#E8F0FF', '#D9A8FF']], sunset: ['Sunset studio', ['#FF9A8B', '#FFC3A0', '#C77DFF', '#7B9CFF', '#FFE0C2', '#FF6FA8']],
  lagoon: ['Lagoon', ['#6FE3E1', '#7AA8FF', '#B6F2C8', '#F4F9FF', '#5CC8FF', '#C3B5FF']], peachsilk: ['Peach silk', ['#FFB38A', '#FF8FAB', '#FFD6A5', '#F9A8D4', '#FFE8D6', '#E38B6F']],
  orchid: ['Orchid', ['#E0AAFF', '#C77DFF', '#FFB3C6', '#9D8DF1', '#F7D6FF', '#FF8FC7']], citrus: ['Citrus', ['#FFE066', '#FFB84D', '#9BE564', '#FF9F80', '#FFF3B0', '#6FD6A0']],
  berry: ['Berry', ['#FF6F91', '#C850C0', '#FFC371', '#845EC2', '#FF9671', '#FFD3E0']], ocean: ['Ocean', ['#2F5CE0', '#4F8CF7', '#6FB1FC', '#A0E9FF', '#3A4BA8', '#86A8E7']],
  mauvedusk: ['Mauve dusk', ['#B8A1C9', '#E8B4C8', '#8E7CC3', '#F3D1DC', '#6D5A8E', '#D8C3E8']], mintcream: ['Mint cream', ['#B8F2E6', '#FFD6E0', '#FFEFD5', '#AED9E0', '#C7F9CC', '#FAF3DD']],
  northern: ['Northern (dark)', ['#1F2A44', '#2E8B9A', '#3FD2B4', '#6A5ACD', '#0F1A2E', '#1C5B6B']], embernight: ['Ember night (dark)', ['#1A0B0B', '#7A1F1F', '#E0572E', '#3A1A2E', '#B8543A', '#2B0F1A']],
};
/* soft tones: the subtle gradients that read almost as solid colours */
const SOFT = {
  dawn: ['Dawn', ['#FBE3D6', '#F6C9D6', '#D9D2F4', '#C9E3F6', '#FDF1E6', '#F3D9E8']], lagoonmist: ['Lagoon mist', ['#D6F0EC', '#C6E4F2', '#E3DDF5', '#F2F7F2', '#BFE0DA', '#DCEBF7']],
  blush: ['Blush', ['#F9DDE0', '#FCE9DF', '#F4CFD8', '#FFF3EA', '#F6D6CF', '#EFD3E3']], iris: ['Iris', ['#D9D6F7', '#E9D5F1', '#C8D3F2', '#F5E3EE', '#D1C6EE', '#EEF0FB']],
  sage: ['Sage linen', ['#E4EADF', '#F1EEE6', '#D3DDD0', '#EDE6DA', '#C9D5C8', '#F6F3EC']], sorbet: ['Sorbet', ['#FFD9C4', '#FFC9DA', '#E8D2F7', '#FFF0D4', '#F9C4C4', '#DCD4FA']],
  glacier: ['Glacier', ['#E6F1F8', '#D7E6F4', '#EFEAF8', '#F7FAFC', '#CFE0EE', '#E2EEF3']], dusk: ['Dusk', ['#E7CFD9', '#D6C9E6', '#F2D8CC', '#C9C3DD', '#EBD7E2', '#DCCFE0']],
  sandsea: ['Sand and sea', ['#EFE3D2', '#D9ECE8', '#F6EEE3', '#CFE4E6', '#E8DCC8', '#E0EEF0']], opaline: ['Opaline', ['#F1E4EE', '#DDEBEF', '#E6EFE0', '#F7EFE4', '#E3DDF0', '#EAF3F4']],
  nocturne: ['Nocturne (dark)', ['#1D1B26', '#2A2238', '#1E2C33', '#312636', '#16181F', '#26303A']], graphite: ['Graphite (dark)', ['#202124', '#2C2D31', '#1A1B1E', '#34353A', '#25262A', '#2E2F34']],
};
const SOLIDS = ['#F3EEE8', '#EDE3DC', '#F2E1D6', '#E8DDE6', '#E6E0F0', '#DCE3E8', '#E3E8DF', '#D9D4CE', '#2B2A2E', '#1E1F24'];
const lum = (h) => { const v = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
/* whether a backdrop is dark, so the orbs' shadows and edges can adapt */
const avgLum = (cs) => cs.reduce((a, h) => a + lum(h), 0) / cs.length;
const isDark = (b) => (b.kind === 'solid' ? (b.soft && SOFT[b.soft] ? avgLum(SOFT[b.soft][1]) : lum(b.color || '#F3EEE8')) < 0.35 : b.kind === 'mesh' ? avgLum((MESH[b.mesh] || MESH.aura)[1]) < 0.35 : false);
root.AvaOrbBackdrop = { IMG_FS, MESH_FS, IMAGES, MESH, SOFT, SOLIDS, isDark };
})(typeof window !== 'undefined' ? window : globalThis);

/* Ava Orb Lab — palettes, defaults, the settings schema with an explanation of every setting, and the chapters.
   Every orb is plain JSON in this shape; the engine reads it directly. */
(function (root) {
'use strict';
/* 17 palettes: five colours from deepest to lightest (c), and the light colour used for rims, smoke and glows (l) */
const PALETTES = {
  violet: { name: 'Violet', c: ['#5C4CCA', '#96AAF6', '#E48CDE', '#F3ACC8', '#FBDECC'], l: '#FDE8DA' },
  ember: { name: 'Ember', c: ['#AA2810', '#E24C20', '#F28A3E', '#F9C28C', '#96A45C'], l: '#FFE2C4' },
  moon: { name: 'Moon', c: ['#5B628C', '#8E97C6', '#C9CCE8', '#EDEAF6', '#D9C7E2'], l: '#FAF9FF' },
  citrus: { name: 'Citrus', c: ['#3FA266', '#9ED77A', '#F2D46A', '#A9E3F0', '#F7C8A4'], l: '#F6FCF0' },
  emerald: { name: 'Emerald', c: ['#16241E', '#2E4E3A', '#54926C', '#8ABA9E', '#606E66'], l: '#ACC4B6' },
  oxblood: { name: 'Oxblood', c: ['#1E0A0A', '#4A1714', '#7A3B34', '#B98A96', '#C9BBF2'], l: '#D2C4F6' },
  forest: { name: 'Tangerine forest', c: ['#15352A', '#2E6B42', '#F07A22', '#F7AE5E', '#FCE2C2'], l: '#FFF0DC' },
  sky: { name: 'Sky', c: ['#1C5EA8', '#4FA3E6', '#BDE6F8', '#6FAF4E', '#A8CB6C'], l: '#F2FBFF' },
  reef: { name: 'Coral reef', c: ['#0E6E78', '#2BB3A6', '#E2564F', '#F59A7A', '#F6D7B0'], l: '#FFF4E6' },
  lagoon: { name: 'Lagoon', c: ['#0A5E73', '#2C7FB8', '#1797A6', '#5ED3CF', '#B5F0E6'], l: '#EFFFFD' },
  sunset: { name: 'Sunset', c: ['#6B2A6E', '#D13F79', '#F2743B', '#F9B84A', '#FFD9A0'], l: '#FFF1DA' },
  rosegold: { name: 'Rose gold', c: ['#9E5A66', '#E7A5A0', '#D9A46B', '#F3D1BF', '#FBEBDD'], l: '#FFF6EE' },
  midnight: { name: 'Midnight', c: ['#0B1440', '#1F3FBF', '#7A4DFF', '#2FB3FF', '#B8E0FF'], l: '#E8F4FF' },
  mint: { name: 'Mint', c: ['#2E8B6A', '#7FD1AE', '#A7C957', '#CFF3E2', '#F2F7D9'], l: '#FAFFF5' },
  lilac: { name: 'Lilac', c: ['#6D5BA8', '#A897E0', '#F1C8E0', '#D8C8F2', '#F7F2FB'], l: '#FFFFFF' },
  aurora: { name: 'Aurora', c: ['#0F5B4E', '#6E5BE0', '#22C39A', '#E274C8', '#BFF5E1'], l: '#F3FFFB' },
  peach: { name: 'Peach', c: ['#E8795A', '#F4A07C', '#F3B7C0', '#F9C6A6', '#FFE8D6'], l: '#FFF6EE' },
  charcoal: { name: 'Charcoal', c: ['#0E0E10', '#1E1F24', '#3A3C44', '#6E717C', '#B9BCC6'], l: '#E6E8EE' },
  obsidian: { name: 'Obsidian', c: ['#050506', '#15121A', '#2E2438', '#5B4A6E', '#A897C8'], l: '#D8CCF0' },
  graphitegold: { name: 'Graphite gold', c: ['#0C0B09', '#23201B', '#4A4032', '#B08D57', '#E9CF9A'], l: '#FFF0D0' },
  inkblue: { name: 'Ink blue', c: ['#05080F', '#0F1A2E', '#1F3A63', '#4F7BB3', '#A9C8EE'], l: '#E3F0FF' },
  emberblack: { name: 'Ember black', c: ['#080404', '#2A0C08', '#6B1A0E', '#D9471A', '#FFB066'], l: '#FFE1C2' },
  neonpink: { name: 'Neon pink', c: ['#1A0033', '#7A00FF', '#FF2BD6', '#FF7AE0', '#00F0FF'], l: '#FFD9F7' },
  acid: { name: 'Acid', c: ['#0A1400', '#00E5A8', '#39FF14', '#C6FF00', '#EFFFA0'], l: '#F4FFD9' },
  cyber: { name: 'Cyber', c: ['#07001A', '#7C4DFF', '#FF00C8', '#00E5FF', '#B8FFFF'], l: '#E6FFFF' },
  neonsunset: { name: 'Neon sunset', c: ['#2B0040', '#FF3D7F', '#FF8A00', '#FF5CF4', '#FFE600'], l: '#FFF1C9' },
  laserlime: { name: 'Laser lime', c: ['#001A12', '#00C2FF', '#00FFA3', '#B4FF39', '#E8FFF4'], l: '#F0FFF8' },
  terracotta: { name: 'Terracotta', c: ['#5A2418', '#A8492E', '#D9774F', '#EBA57F', '#F6D8C2'], l: '#FFF1E6' },
  sage: { name: 'Sage', c: ['#2F3D33', '#5E7563', '#8FA68F', '#C3D1B8', '#EEF1E4'], l: '#FAFCF5' },
  ocean: { name: 'Ocean', c: ['#021D3A', '#0B4F8A', '#1F8CC8', '#63C6E8', '#CFF1FA'], l: '#F0FCFF' },
  berry: { name: 'Berry', c: ['#3A0A2A', '#7E1A55', '#C23B7C', '#E88AB4', '#F9D3E3'], l: '#FFF0F6' },
  honey: { name: 'Honey', c: ['#5C3400', '#B86E00', '#F2A516', '#FFD36B', '#FFF0C2'], l: '#FFF9E6' },
  glacier: { name: 'Glacier', c: ['#1F3C4F', '#4F8BA8', '#9ED0E3', '#D9F1F7', '#F4FBFD'], l: '#FFFFFF' },
  plum: { name: 'Plum', c: ['#2A0F2E', '#5C2566', '#8E4A9E', '#C58FD1', '#EFD9F2'], l: '#FBF2FC' },
  coral: { name: 'Coral', c: ['#7A1F2B', '#E0474C', '#FF7E6B', '#FFB29B', '#FFE3D6'], l: '#FFF4EE' },
  lavenderfields: { name: 'Lavender fields', c: ['#3C3470', '#7A6CC4', '#B7A8E8', '#E3D4F5', '#D5E6B8'], l: '#F7F3FF' },
  desert: { name: 'Desert', c: ['#5B3A22', '#A36B3F', '#D4A373', '#E9C9A0', '#F6E7D0'], l: '#FFF8EE' },
  opal: { name: 'Opal', c: ['#2E2A5C', '#6B8FD6', '#F2A7C8', '#9FE3D4', '#FDE3B8'], l: '#FFF6EC' },
  iridescent: { name: 'Iridescent', c: ['#3B1F6E', '#2FA8C9', '#E86FB8', '#F7D46B', '#C9F2E6'], l: '#FFFAF0' },
  peacock: { name: 'Peacock', c: ['#062B3A', '#0E7C86', '#2F4FB0', '#8BC34A', '#E6C75A'], l: '#F4FBE8' },
  nebula: { name: 'Nebula', c: ['#140A2E', '#5B2A86', '#C2417A', '#3E7BD9', '#F4B6D8'], l: '#FCE8F6' },
  koi: { name: 'Koi', c: ['#7A1F12', '#E8552C', '#F7F1E8', '#1F3F5B', '#F4A259'], l: '#FFF8EF' },
  tropic: { name: 'Tropic', c: ['#0B4A3F', '#1FA37A', '#F2C14E', '#F26B5B', '#8FD8F2'], l: '#F4FFF8' },
  twilight: { name: 'Twilight', c: ['#1B1F4B', '#4B3B8F', '#D66A8E', '#F2A65A', '#9BB8E8'], l: '#FFF0E0' },
  orchard: { name: 'Orchard', c: ['#4A2A18', '#C0392B', '#E67E22', '#9DBF4A', '#F7E3B0'], l: '#FFF9EA' },
  mirage: { name: 'Mirage', c: ['#27496D', '#6CB4C9', '#F0C987', '#E8836B', '#D7C4F0'], l: '#FFF8F2' },
  bouquet: { name: 'Bouquet', c: ['#5A1846', '#C2185B', '#7E57C2', '#F48FB1', '#C5E1A5'], l: '#FFF5F9' },
};
/* what every setting does, shown on its info icon */
const TIPS = {
  mode: 'How the orb is built. Signature: the classic flat Ava orb, shaded as if round. Glass sphere: the same colour field as fluid inside a real sphere, flowing along its inner wall; its surface itself is invisible.',
  palette: 'The starting set of five colours and a light colour. The two marked from ElevenLabs are sampled from their orbs.',
  custom: 'Use your own five colours below instead of the palette.',
  colors: 'Your five custom colours, from deepest to lightest. Only used when Custom colours is on.',
  'grade.hue': 'Rotates every colour around the colour wheel, in degrees, keeping lightness and saturation.',
  'grade.chroma': 'Saturation. 1 is the palette as designed; higher is more vivid, lower is more muted.',
  'grade.light': 'Makes every colour lighter (tints) or darker (shades), without changing hue.',
  lift: 'A calibrated boost of brightness and colour tuned per palette to match ElevenLabs. Higher is brighter and richer.',
  'fill.density': 'How full the sphere is. 1 fills it completely; lower leaves clear glass between wisps of colour. Signature orbs are always full.',
  'fill.velocity': 'How fast the contents circulate around the inside of a glass sphere.',
  'flow.speed': 'Idle activity: how lively the colours move when the orb is silent. There is always a minimum movement.',
  'flow.relief': 'Surface relief: the depth of the soft folds and creases that shade the colour field. 0 is flat colour; higher looks more sculpted.',
  'flow.seed': 'Pattern: picks a different arrangement of the colour field. The same number always gives the same pattern.',
  'grain.enabled': 'Turns the grain on or off. On by default.',
  'grain.type': 'The film grain laid over the orb. Film: fine luminance grain like ElevenLabs. Fine: subtler single-pixel noise. Coarse: larger, colourful grain. None: off. The grain never moves.',
  'grain.amount': 'How strong the grain is.',
  'grain.size': 'The size of each grain speck, in pixels.',
  'smoke.enabled': 'Turns the smoke on or off. Off by default; its settings are kept for when you turn it back on.',
  'smoke.amount': 'Smoke: soft, semi-transparent veils drifting over the material, like the haze in the ElevenLabs orbs. This sets how visible they are.',
  'smoke.density': 'How much of the orb the smoke covers: thin wisps at low values, fuller veils at high values.',
  'smoke.size': 'The size of the smoke veils and their streaks. Lower is finer.',
  'smoke.speed': 'How fast the smoke drifts and curls.',
  'smoke.light': 'Smoke lightness: how light the veils are. They are a tint of the palette\u2019s dominant colour: 0 is the colour itself, 1 is nearly white.',
  'smoke.lightBlend': 'How the light smoke blends with the material. Normal: laid over it. Screen and Lighten: only brighten. Overlay and Soft light: add contrast. Multiply and Darken: only deepen. Colour: tints the material with the smoke\u2019s colour. Luminosity: takes the smoke\u2019s lightness only.',
  'smoke.darkBlend': 'How the dark smoke in the lower part of the orb blends with the material. The same modes as the light smoke.',
  'smoke.dark': 'Bottom darkening: how dark the veils become as they sink into the lower part of the orb, in a deep version of the palette\u2019s dominant colour. Only the smoke darkens, never the material.',
  'smoke.darkStart': 'Where the darkening begins: 0 is the middle of the orb, negative starts higher, positive starts lower. Below it the veils darken gradually, darkest at the very bottom.',
  'smoke.darkCurve': 'How gradual the darkening is: low values darken early and evenly, high values keep it close to the bottom.',
  'rim.type': 'A light around the edge. None by default. Signature: the soft cream light on one side. Fresnel halo: an even glowing edge. Backlit glow: light from behind spilling past the edge. Split: warm on one side, cool on the other. Inner glow: a luminous band inside the edge.',
  'rim.strength': 'How bright the rim light is.',
  'shadow.amount': 'How dark the soft shadow on the backdrop is.',
  'shadow.softness': 'How far the shadow spreads and how soft its edge is.',
  'shadow.offset': 'How far below the orb the shadow falls, as if the orb floats higher.',
  'glass.transparency': 'How much the orb becomes clear glass, showing the backdrop through it.',
  'glass.ior': 'Refraction: how strongly the glass bends what is behind it.',
  'glass.magnify': 'Magnification: how much the glass enlarges the backdrop seen through it.',
  'glass.dispersion': 'Splits light into colour fringes at the edges, like a prism.',
  'wave.form': 'Wave form: the shape of the wave each syllable of voice or beat of music sends through the orb, with real depth. Pulse rings (the Ava default). Jagged rings: soft, deep, uneven rings. Flower: a ring of rounded petals. Side wave: small ripples that start at one edge and spread. Ocean waves: a rolling swell of crests. Stream: a smooth channel that flows right across the material. Moses split: every syllable or beat sends two ocean waves out from a wavy seam, parting the view. Leaf blower: a concentrated gust that fans out and sweeps the material across. Wormhole: rings spiralling into a tunnel that turns continuously and grows with the sound. Spiral: arms that turn continuously and grow with the sound.',
  'wave.strength': 'How strong and deep each wave is.',
  'wave.direction': 'For side wave, ocean waves, stream, Moses split and leaf blower: the direction the wave travels, in degrees (0 is left to right, 90 is top to bottom).',
  'rock.intensity': 'Water rocking: the contents slosh like water in a gently rocked bowl, right to left, toward the bottom, down and up, up, then left to right, in smooth surges that briefly break the flow and then calm. 0 turns it off.',
  'rock.variation': 'Rocking variation: randomises the timing and path of each surge, so no two are the same. 0 repeats the same smooth loop.',
  'rock.size': 'Wave size: the size of the water surface waves the rocking carries across the contents. Higher is broader, gentler waves; lower is smaller, tighter ones.',
  'material.type': 'What fills a glass sphere. Colour field: the Ava fluid. Ocean waves: half-filled with water, waves and foam. Washing-machine foam: soap foam tumbling in a drum. Liquid aluminium: rippling liquid metal reflecting a photographic studio. Plasma: tendrils of light arcing from a glowing core. Lava: molten rock with glowing cracks. Holograms: liquid in shifting interference colours. Holographic glitter: glitter in rainbow foil colours. Smoke: billowing shaded smoke. Sand: grains streaking on a swirling wind. Coloured snow: pastel flakes falling onto a settled powder. Glitter: flakes turning in clear liquid, catching the light. Ink in water 2: sharper, crisper ink. Ink in water: plumes sinking and unfurling into tendrils. Mist: soft fog pooling low and drifting. Fire: flames rising from the bottom, coloured by temperature. Aurora: curtains of light with fine rays. Signature orbs always show the colour field.',
  'material.fire': 'Fire style. Classic: the original flames. Blue gas: short, steady flames with cyan tips. Inferno: tall, violent flames throwing embers. Candle: a single swaying teardrop flame. Spirit: flames in the palette\u2019s own colour. Smoulder: a low glowing bed with embers rising.',
  'material.mix.0.type': 'A second material layered inside the same sphere, with its own amount, velocity and scale. None leaves it off.',
  'material.mix.1.type': 'A third material layered inside the same sphere.',
  'material.mix.2.type': 'A fourth material layered inside the same sphere.',
  'material.aa': 'Anti-aliasing: softens the edges of miniatures, flakes and petals over exactly one pixel, so they stay smooth instead of stair-stepped.',
  'material.amount': 'How much of the material there is: its density and how full the sphere looks.',
  'material.velocity': 'How fast the material moves: sinking ink, drifting mist, rising flames, rippling curtains.',
  'material.scale': 'The size of the material\u2019s forms. Lower is broader, higher is finer.',
  'motion.type': 'Material motion: how the contents move, driven by loudness. Drift: calm flow. Stir: a swirl from the centre. Breathe: contents swell and settle. Ripples: continuous rings. Turbulence: gusty churning. Spectral: bass in the centre, treble at the edge. Tide: vertical sloshing.',
  'motion.strength': 'How strongly the material motion responds.',
  'audio.voice': 'The voice this orb speaks when you click it in edit mode.',
  'audio.music': 'The music under the voice when you click this orb.',
  'render.voice': 'The voice every orb in this chapter reacts to in the render.',
  'render.music': 'The music under that voice in the render.',
  dark: 'Switches this chapter to the dark backdrop.',
};
const SCHEMA = {
  mode: ['signature', 'sphere'], palette: Object.keys(PALETTES), custom: 'bool', colors: 'hex[5]', light: 'hex', lift: [0, 1.5],
  grade: { hue: [-180, 180], chroma: [0, 2], light: [-0.3, 0.3] }, flow: { speed: [0, 6], swirl: [0, 3], relief: [0, 2.5], seed: [0, 10] }, fill: { density: [0, 1], velocity: [0, 4] },
  grain: { type: ['film', 'fine', 'coarse', 'none'], amount: [0, 0.2], size: [0.5, 4] }, smoke: { amount: [0, 2.5], density: [0, 1], size: [0.3, 3], speed: [0, 10], lightBlend: ['normal', 'screen', 'overlay', 'softlight', 'multiply', 'lighten', 'darken', 'color', 'luminosity'], darkBlend: 'as lightBlend', light: [0, 1], dark: [0, 1], darkStart: [-0.8, 0.9], darkCurve: [0.3, 4] },
  rim: { type: ['none', 'signature', 'fresnel', 'backlit', 'split', 'inner'], strength: [0, 2] }, shadow: { amount: [0, 2], softness: [0.3, 2], offset: [0, 0.5] },
  glass: { transparency: [0, 1], ior: [1, 2], magnify: [0, 3], dispersion: [0, 0.2] },
  wave: { form: ['pulse', 'jagged', 'side', 'ocean', 'knife', 'moses', 'blower'], strength: [0, 2.5] }, motion: { type: ['drift', 'stir', 'breathe', 'ripples', 'turbulence', 'spectral', 'tide'], strength: [0, 2.5] },
  audio: { voice: 'id from AVA_LAB_AUDIO.voices', music: 'id from AVA_LAB_AUDIO.music' }, tips: TIPS,
};
const LIFT = { violet: 0.66, ember: 0.91, moon: 0.8, citrus: 0.86, emerald: 0.59, oxblood: 0.96 };
function orb(palette, extra = {}) {
  const o = { mode: 'signature', palette, custom: false, colors: PALETTES[palette].c.slice(), light: PALETTES[palette].l, lift: LIFT[palette] ?? 0.8, grade: { hue: 0, chroma: 1.08, light: 0 }, flow: { speed: 3.5, swirl: 1, relief: 1, seed: 0.37 },
    fill: { density: 1, velocity: 1.6 }, grain: { enabled: true, type: 'film', amount: 0.05, size: 0.5 }, smoke: { enabled: false, amount: 1.5, density: 0.5, size: 1.37, speed: 4, light: 0, dark: 1, darkStart: -0.05, darkCurve: 1.84, lightBlend: 'normal', darkBlend: 'normal' }, rim: { type: 'none', strength: 1 }, shadow: { amount: 0.8, softness: 1, offset: 0.16 },
    glass: { transparency: 0, ior: 1.33, magnify: 1, dispersion: 0.02 }, material: { type: 'field', amount: 1, velocity: 1, scale: 1, fire: 'classic', aa: true, mix: [{ type: 'none', amount: 1, velocity: 1, scale: 1 }, { type: 'none', amount: 1, velocity: 1, scale: 1 }, { type: 'none', amount: 1, velocity: 1, scale: 1 }] }, wave: { form: 'pulse', strength: 2, direction: 0 }, rock: { intensity: 2, variation: 0.35, size: 3 }, motion: { type: 'drift', strength: 1 }, audio: { voice: 'abuela_es_02', music: 'fox_seville' } };
  for (const [k, v] of Object.entries(extra)) o[k] = typeof v === 'object' && !Array.isArray(v) ? Object.assign({}, o[k], v) : v;
  return o;
}
const BACKDROP = (kind = 'mesh', pick) => ({ kind, image: kind === 'image' ? (pick || 'mauve') : 'mauve', mesh: kind === 'mesh' ? (pick || 'aura') : 'aura', soft: null, color: kind === 'solid' ? (pick || '#F3EEE8') : '#F3EEE8', zoom: 1, drift: 0.6 });
Object.assign(TIPS, {
  'bd.global': 'Use one backdrop for every chapter, so the whole video shares it. Off: each chapter keeps its own.',
  'bd.kind': 'The kind of backdrop: one of the supplied images, a subtle mesh gradient, or a solid colour.',
  'bd.image': 'Which image fills the backdrop. It always covers the frame without stretching.',
  'bd.mesh': 'Which mesh gradient: distinct colour fields blended organically and slowly breathing. The two marked dark suit charcoal moods.',
  'bd.soft': 'Soft tones: very subtle gradients that read almost as solid colours.',
  'bd.color': 'The solid backdrop colour: pick a swatch or any colour.',
  'bd.zoom': 'Zoom: how far the image is enlarged.',
  'bd.drift': 'How much the backdrop slowly moves: a gentle pan for images, the breathing of a mesh gradient. 0 holds it still.',
});
const SIX = ['violet', 'opal', 'moon', 'citrus', 'emerald', 'oxblood'];
const VOICES6 = [['abuela_es_02', 'fox_seville'], ['zorrito_es_01', 'fox_night'], ['luna_es_01', 'fox_night'], ['mei_ja_01', 'fox_seville'], ['vo_en_02', 'ripple_launch'], ['nar_en_05', 'ripple_launch']];
const CHAPTERS = [
  { id: 'signature', name: 'Signature', about: 'The Ava orbs as they are, answering the lab\u2019s controls.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'abuela_es_02', music: 'fox_seville' },
    orbs: SIX.map((p, i) => Object.assign(orb(p, { flow: { seed: 0.37 + i * 0.61 }, audio: { voice: VOICES6[i][0], music: VOICES6[i][1] } }), { name: PALETTES[p].name })) },
  { id: 'signature-sphere', name: 'Signature Sphere', about: 'The same designs as fluid inside a real sphere, hugging its inner wall.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'luna_es_01', music: 'fox_night' },
    orbs: SIX.map((p, i) => Object.assign(orb(p, { mode: 'sphere', fill: { density: [1, 0.78, 0.55, 0.9, 0.66, 0.95][i], velocity: 1.6 }, glass: { transparency: [0.35, 0.55, 0.8, 0.45, 0.7, 0.3][i], ior: 1.4, magnify: 1.2, dispersion: 0.03 }, flow: { seed: 0.37 + i * 0.61 }, audio: { voice: VOICES6[i][0], music: VOICES6[i][1] } }), { name: PALETTES[p].name + ' sphere' })) },
];
const MAT_ORB = (p, name, i, mat, extra = {}) => Object.assign(orb(p, Object.assign({ mode: 'sphere', flow: { seed: 0.37 + i * 0.61 }, material: mat, audio: { voice: VOICES6[i][0], music: VOICES6[i][1] } }, extra)), { name });
CHAPTERS.push(
  { id: 'ink', name: 'Ink in water', about: 'Coloured inks sinking through clear water and unfurling into tendrils.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'zorrito_es_01', music: 'fox_night' },
    orbs: [['violet', 'Violet ink'], ['reef', 'Coral reef ink'], ['inkblue', 'Blue-black ink'], ['berry', 'Berry ink'], ['emerald', 'Emerald ink'], ['sunset', 'Sunset ink']].map(([p, n], i) => MAT_ORB(p, n, i, { type: 'ink', amount: 1, velocity: 1, scale: 1 }, { glass: { transparency: 1, ior: 1.33, magnify: 1.1, dispersion: 0.02 } })) },
  { id: 'mist', name: 'Mist', about: 'Soft fog pooling low in the sphere and drifting in slow layers.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'vo_en_02', music: 'ripple_launch' },
    orbs: [['glacier', 'Glacier mist'], ['lilac', 'Lilac mist'], ['sage', 'Sage mist'], ['opal', 'Opal mist'], ['mint', 'Mint mist'], ['peach', 'Peach mist']].map(([p, n], i) => MAT_ORB(p, n, i, { type: 'mist', amount: 1, velocity: 1, scale: 1 }, { glass: { transparency: 0.85, ior: 1.3, magnify: 1, dispersion: 0.01 } })) },
  { id: 'fire', name: 'Fire', about: 'Flames rooted at the bottom, rising and licking upward, coloured by their heat.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'vo_en_03', music: 'ripple_breakdown' },
    orbs: [['emberblack', 'Ember fire'], ['sunset', 'Sunset fire'], ['honey', 'Honey fire'], ['neonsunset', 'Neon fire'], ['coral', 'Coral fire'], ['berry', 'Berry fire']].map(([p, n], i) => MAT_ORB(p, n, i, { type: 'fire', amount: 1, velocity: 1, scale: 1 }, { glass: { transparency: 0.25, ior: 1.3, magnify: 1, dispersion: 0.02 } })) },
  { id: 'aurora', name: 'Aurora', about: 'Curtains of light with fine rays, rippling around the inside of a night sphere.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'nar_en_05', music: 'fox_seville' },
    orbs: [['aurora', 'Aurora'], ['lagoon', 'Lagoon aurora'], ['cyber', 'Cyber aurora'], ['nebula', 'Nebula aurora'], ['peacock', 'Peacock aurora'], ['lavenderfields', 'Lavender aurora']].map(([p, n], i) => MAT_ORB(p, n, i, { type: 'aurora', amount: 1, velocity: 1, scale: 1 }, { glass: { transparency: 0.3, ior: 1.3, magnify: 1, dispersion: 0.02 } })) },
);

CHAPTERS.splice(3, 0, { id: 'ink2', name: 'Ink in water 2', about: 'Sharper ink: crisper tendrils with finer detail and denser cores.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'zorrito_es_01', music: 'fox_night' },
  orbs: [['violet', 'Violet ink'], ['reef', 'Coral reef ink'], ['inkblue', 'Blue-black ink'], ['berry', 'Berry ink'], ['emerald', 'Emerald ink'], ['sunset', 'Sunset ink']].map(([p, n], i) => MAT_ORB(p, n, i, { type: 'ink2', amount: 1, velocity: 1, scale: 1, fire: 'classic' }, { glass: { transparency: 1, ior: 1.33, magnify: 1.1, dispersion: 0.02 } })) });
CHAPTERS.splice(6, 0, { id: 'fire2', name: 'Fire 2', about: 'Six different fires: classic, blue gas, inferno with embers, candle, spirit and smoulder.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: 'vo_en_03', music: 'ripple_breakdown' },
  orbs: [['emberblack', 'Classic', 'classic'], ['ocean', 'Blue gas', 'gas'], ['emberblack', 'Inferno', 'inferno'], ['honey', 'Candle', 'candle'], ['aurora', 'Spirit', 'spirit'], ['emberblack', 'Smoulder', 'smoulder']].map(([p, n, f], i) => MAT_ORB(p, n, i, { type: 'fire', amount: 1, velocity: 1, scale: 1, fire: f }, { glass: { transparency: 0.25, ior: 1.3, magnify: 1, dispersion: 0.02 } })) });
const MIXED = (base, extra) => Object.assign({ type: 'none', amount: 1, velocity: 1, scale: 1, fire: 'classic' }, base, { mix: extra.concat([{ type: 'none', amount: 1, velocity: 1, scale: 1 }, { type: 'none', amount: 1, velocity: 1, scale: 1 }, { type: 'none', amount: 1, velocity: 1, scale: 1 }]).slice(0, 3) });
const BATCH2 = [
  ['sand', 'Sandblast', 'Fine grains streaking on a swirling wind over a thin dust haze.', [['desert', 'Desert sand'], ['terracotta', 'Terracotta sand'], ['honey', 'Honey sand'], ['peach', 'Peach sand'], ['coral', 'Coral sand'], ['graphitegold', 'Gold sand']], { type: 'sand' }, [], 0.9],
  ['smoke', 'Smoke', 'Billowing smoke rising slowly, shaded, in each palette\u2019s dark tones.', [['charcoal', 'Charcoal smoke'], ['obsidian', 'Obsidian smoke'], ['inkblue', 'Ink smoke'], ['plum', 'Plum smoke'], ['sage', 'Sage smoke'], ['emberblack', 'Ember smoke']], { type: 'smoke' }, [], 0.9],
  ['snow', 'Coloured snow', 'Soft pastel snowflakes falling and swaying onto a settled powder.', [['glacier', 'Glacier snow'], ['lilac', 'Lilac snow'], ['mint', 'Mint snow'], ['opal', 'Opal snow'], ['peach', 'Peach snow'], ['berry', 'Berry snow']], { type: 'snow' }, [], 0.95],
  ['glitter', 'Glitter', 'Glitter turning in a slow vortex in clear liquid, each flake catching the light as it turns.', [['rosegold', 'Rose gold glitter'], ['iridescent', 'Iridescent glitter'], ['opal', 'Opal glitter'], ['neonpink', 'Neon glitter'], ['honey', 'Gold glitter'], ['midnight', 'Midnight glitter']], { type: 'glitter' }, [], 1],
  ['mistsmoke', 'Mist and smoke', 'Two layers: pale mist pooling low, with darker smoke billowing through it.', [['glacier', 'Glacier'], ['lilac', 'Lilac'], ['sage', 'Sage'], ['opal', 'Opal'], ['charcoal', 'Charcoal'], ['peach', 'Peach']], { type: 'mist' }, [{ type: 'smoke', amount: 0.7, velocity: 1, scale: 1 }], 0.85],
  ['mistsand', 'Mist and sand', 'Two layers: mist pooling low while fine sand streaks through it.', [['desert', 'Desert'], ['glacier', 'Glacier'], ['peach', 'Peach'], ['sage', 'Sage'], ['honey', 'Honey'], ['lilac', 'Lilac']], { type: 'mist' }, [{ type: 'sand', amount: 0.9, velocity: 1, scale: 1 }], 0.85],
  ['mistsmokesand', 'Mist, smoke and sand', 'Three layers: mist, smoke and sand moving together.', [['desert', 'Desert'], ['charcoal', 'Charcoal'], ['terracotta', 'Terracotta'], ['sage', 'Sage'], ['glacier', 'Glacier'], ['graphitegold', 'Gold']], { type: 'mist' }, [{ type: 'smoke', amount: 0.6, velocity: 1, scale: 1 }, { type: 'sand', amount: 0.8, velocity: 1, scale: 1 }], 0.85],
  ['smokesand', 'Smoke and sand', 'Two layers: rising smoke with sand streaking through it.', [['charcoal', 'Charcoal'], ['desert', 'Desert'], ['emberblack', 'Ember'], ['terracotta', 'Terracotta'], ['obsidian', 'Obsidian'], ['honey', 'Honey']], { type: 'smoke' }, [{ type: 'sand', amount: 0.85, velocity: 1, scale: 1 }], 0.9],
];
const VOX = [['zorrito_es_01', 'fox_night'], ['vo_en_02', 'ripple_launch'], ['vo_en_03', 'ripple_breakdown'], ['nar_en_05', 'fox_seville'], ['abuela_es_02', 'fox_seville'], ['luna_es_01', 'fox_night'], ['mei_ja_01', 'fox_seville'], ['nar_en_02', 'ripple_launch']];
BATCH2.forEach(([id, name, about, pals, base, extra, tr], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[ci][0], music: VOX[ci][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, MIXED(base, extra), { glass: { transparency: tr, ior: 1.33, magnify: 1.05, dispersion: 0.02 } })) }));
[['plasma', 'Plasma', 'The plasma globe: luminous tendrils arcing from a glowing core to the glass, wandering and flickering.', [['neonpink', 'Neon plasma'], ['cyber', 'Cyber plasma'], ['midnight', 'Midnight plasma'], ['violet', 'Violet plasma'], ['aurora', 'Aurora plasma'], ['sunset', 'Sunset plasma']], { type: 'plasma' }, [], 0.2],
 ['lava', 'Lava', 'Molten rock churning slowly: a dark crust split by glowing cracks, bright flows welling through.', [['emberblack', 'Basalt lava'], ['terracotta', 'Terracotta lava'], ['sunset', 'Sunset lava'], ['honey', 'Gold lava'], ['berry', 'Berry lava'], ['coral', 'Coral lava']], { type: 'lava' }, [], 0.6],
 ['holo', 'Holograms', 'Holographic liquid: interference colours that shift with the angle and flow with the contents.', [['opal', 'Opal hologram'], ['iridescent', 'Iridescent hologram'], ['lilac', 'Lilac hologram'], ['glacier', 'Glacier hologram'], ['peach', 'Peach hologram'], ['mint', 'Mint hologram']], { type: 'holo' }, [], 1],
 ['hologlitter', 'Glitter and holograms', 'Two layers: holographic glitter turning in a slow vortex, suspended in holographic liquid.', [['iridescent', 'Iridescent'], ['opal', 'Opal'], ['rosegold', 'Rose gold'], ['lilac', 'Lilac'], ['midnight', 'Midnight'], ['glacier', 'Glacier']], { type: 'hologlitter' }, [{ type: 'holo', amount: 0.45, velocity: 1, scale: 1 }], 0.9],
].forEach(([id, name, about, pals, base, extra, tr], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 3) % VOX.length][0], music: VOX[(ci + 3) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, MIXED(base, extra), { glass: { transparency: tr, ior: 1.33, magnify: 1.05, dispersion: 0.02 } })) }));
[['metal', 'Liquid aluminium', 'Liquid metal rippling as it reflects a photographic studio: two softboxes, a strip light and a warm floor bounce.', [['charcoal', 'Aluminium'], ['glacier', 'Cool aluminium'], ['rosegold', 'Rose aluminium'], ['graphitegold', 'Champagne aluminium'], ['inkblue', 'Blue anodised'], ['lilac', 'Lilac anodised']], { type: 'metal' }, [], 0]].forEach(([id, name, about, pals, base, extra, tr], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 5) % VOX.length][0], music: VOX[(ci + 5) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, MIXED(base, extra), { glass: { transparency: tr, ior: 1.33, magnify: 1, dispersion: 0.0 } })) }));
[['ocean', 'Ocean waves', 'Half-filled with water: waves with sharpened crests, whitecap foam, a line of foam against the glass, light absorbed with depth, caustics below.', [['ocean', 'Open ocean'], ['lagoon', 'Lagoon'], ['glacier', 'Glacier water'], ['peacock', 'Peacock sea'], ['midnight', 'Midnight sea'], ['mint', 'Shallows']], { type: 'ocean' }, [], 1],
 ['foam', 'Washing-machine foam', 'Soap foam tumbling as the drum turns: bubble walls, caps catching the light, soap-film colours, churning over water.', [['glacier', 'Glacier foam'], ['lilac', 'Lilac foam'], ['mint', 'Mint foam'], ['opal', 'Opal foam'], ['peach', 'Peach foam'], ['charcoal', 'Grey foam']], { type: 'foam' }, [], 1],
].forEach(([id, name, about, pals, base, extra, tr], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 6) % VOX.length][0], music: VOX[(ci + 6) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, MIXED(base, extra), { glass: { transparency: tr, ior: 1.33, magnify: 1, dispersion: 0.02 } })) }));
[['christmas', 'Christmas', 'A porcelain Christmas miniature: a scalloped fir with glazed baubles and a gold star, wrapped gifts, a Santa figurine, snow falling in the glass.', [['oxblood', 'Oxblood'], ['emerald', 'Emerald'], ['graphitegold', 'Gold'], ['midnight', 'Midnight'], ['rosegold', 'Rose gold'], ['glacier', 'Frost']], 'christmas'],
 ['winter', 'Winter', 'A winter night miniature: pines on snowy hills, their tiers snow-capped, a cabin with a warm window, stars and snowfall.', [['glacier', 'Glacier'], ['inkblue', 'Ink'], ['midnight', 'Midnight'], ['lilac', 'Lilac'], ['sage', 'Sage'], ['charcoal', 'Charcoal']], 'winter'],
].forEach(([id, name, about, pals, scene], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 1) % VOX.length][0], music: VOX[(ci + 1) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, Object.assign(MIXED({ type: 'scene' }, [{ type: 'snow', amount: 0.55, velocity: 0.7, scale: 1.2 }]), { scene, aa: true }), { glass: { transparency: 1, ior: 1.3, magnify: 1, dispersion: 0.015 } })) }));
[['easter', 'Easter and cherry blossoms', 'A ceramic Easter miniature: glazed eggs in a woven nest on moss, a branch of cherry blossom arching over, petals drifting down.', [['peach', 'Peach'], ['lilac', 'Lilac'], ['mint', 'Mint'], ['glacier', 'Glacier'], ['rosegold', 'Rose gold'], ['sage', 'Sage']], 'easter'],
 ['spring', 'Spring', 'A ceramic spring miniature: glazed tulips with their leaves on a grass mound, petals drifting through the glass.', [['coral', 'Coral'], ['lilac', 'Lilac'], ['honey', 'Honey'], ['berry', 'Berry'], ['peach', 'Peach'], ['opal', 'Opal']], 'spring'],
].forEach(([id, name, about, pals, scene], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 3) % VOX.length][0], music: VOX[(ci + 3) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, Object.assign(MIXED({ type: 'scene' }, [{ type: 'petals', amount: 0.5, velocity: 0.8, scale: 1.1 }]), { scene, aa: true }), { glass: { transparency: 1, ior: 1.3, magnify: 1, dispersion: 0.015 } })) }));
[['summer', 'Summer', 'A ceramic summer miniature: a striped parasol on a sand mound, a scallop shell and a starfish, a calm sea with a foam line at the shore.', [['ocean', 'Ocean'], ['coral', 'Coral'], ['honey', 'Honey'], ['lagoon', 'Lagoon'], ['sunset', 'Sunset'], ['mint', 'Mint']], 'summer', []],
 ['autumn', 'Autumn', 'A ceramic autumn miniature: a small tree with a rounded canopy of warm leaves over fallen leaves, more leaves falling.', [['terracotta', 'Terracotta'], ['honey', 'Honey'], ['emberblack', 'Ember'], ['berry', 'Berry'], ['desert', 'Desert'], ['sage', 'Sage']], 'autumn', [{ type: 'leaves', amount: 0.45, velocity: 0.8, scale: 1.1 }]],
 ['halloween', 'Halloween', 'A ceramic Halloween miniature: a carved jack-o-lantern glowing from within, a bare tree against a violet night, mist drifting low.', [['emberblack', 'Ember'], ['plum', 'Plum'], ['midnight', 'Midnight'], ['honey', 'Honey'], ['obsidian', 'Obsidian'], ['berry', 'Berry']], 'halloween', [{ type: 'mist', amount: 0.35, velocity: 0.7, scale: 1 }]],
 ['thanksgiving', 'Thanksgiving', 'A harvest still life on a wooden plinth: ribbed pumpkins, a gourd, wheat, a lit candle, a few leaves drifting.', [['terracotta', 'Terracotta'], ['honey', 'Honey'], ['sage', 'Sage'], ['desert', 'Desert'], ['emberblack', 'Ember'], ['peach', 'Peach']], 'thanksgiving', [{ type: 'leaves', amount: 0.2, velocity: 0.6, scale: 1.2 }]],
].forEach(([id, name, about, pals, scene, extra], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 4) % VOX.length][0], music: VOX[(ci + 4) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, Object.assign(MIXED({ type: 'scene' }, extra), { scene, aa: true }), { glass: { transparency: 1, ior: 1.3, magnify: 1, dispersion: 0.015 } })) }));
[['plankton', 'Bioluminescent plankton', 'Points of blue light in dark water, each flashing when the flow disturbs it, and more with the voice.', [['ocean', 'Ocean'], ['lagoon', 'Lagoon'], ['midnight', 'Midnight'], ['inkblue', 'Ink'], ['peacock', 'Peacock'], ['aurora', 'Aurora']], { type: 'plankton', amount: 1, velocity: 1, scale: 1 }, 0.3],
 ['opal', 'Opal', 'A milky glossy stone turning slowly, its patches of pure diffracted colour shifting with the angle.', [['opal', 'White opal'], ['iridescent', 'Crystal opal'], ['glacier', 'Blue opal'], ['lilac', 'Lilac opal'], ['peach', 'Peach opal'], ['mint', 'Mint opal']], { type: 'opal', amount: 1, velocity: 1, scale: 1 }, 1],
 ['nebula', 'Nebula stardust', 'Glowing gas in sulphur red, hydrogen gold and oxygen teal, cut by dark dust lanes, against a star field.', [['nebula', 'Nebula'], ['midnight', 'Midnight'], ['plum', 'Plum'], ['berry', 'Berry'], ['peacock', 'Peacock'], ['cyber', 'Cyber']], { type: 'nebula', amount: 1, velocity: 1, scale: 1 }, 0.2],
 ['pollen', 'Golden-hour pollen', 'Soft motes of pollen drifting in low sun, glowing where the backlight catches them, with shafts of light through the glass.', [['honey', 'Honey'], ['peach', 'Peach'], ['desert', 'Desert'], ['sunset', 'Sunset'], ['terracotta', 'Terracotta'], ['rosegold', 'Rose gold']], { type: 'pollen', amount: 1, velocity: 1, scale: 1 }, 1],
].forEach(([id, name, about, pals, base, tr], ci) => CHAPTERS.push({ id, name, about, dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[(ci + 2) % VOX.length][0], music: VOX[(ci + 2) % VOX.length][1] },
  orbs: pals.map(([p, n], i) => MAT_ORB(p, n, i, Object.assign(MIXED(base, []), { aa: true }), { glass: { transparency: tr, ior: 1.33, magnify: 1, dispersion: 0.02 } })) }));
CHAPTERS.push({ id: 'mercury', name: 'Liquid mercury', about: 'Heavy mirror-bright blobs drifting in clear glass, merging and splitting, reflecting the world and the studio light.', dark: false, backdrop: BACKDROP('mesh', 'aura'), render: { voice: VOX[6][0], music: VOX[6][1] },
  orbs: [['charcoal', 'Mercury'], ['glacier', 'Cool mercury'], ['graphitegold', 'Warm mercury'], ['rosegold', 'Rose mercury'], ['inkblue', 'Blue mercury'], ['lilac', 'Lilac mercury']].map(([p, n], i) => MAT_ORB(p, n, i, Object.assign(MIXED({ type: 'scene' }, []), { scene: 'mercury', aa: true }), { glass: { transparency: 1, ior: 1.33, magnify: 1, dispersion: 0.02 } })) });
root.AvaOrbSets = { SCHEMA, TIPS, CHAPTERS, PALETTES, orb, LIFT, BACKDROP };
})(typeof window !== 'undefined' ? window : globalThis);

/* Ava Orb Lab — the orb engine. One WebGL2 program draws every orb of a chapter over a shared backdrop.
   Mode 0 'signature' is the current Ava orb, verbatim; mode 1 'sphere' renders it as coloured fluid inside a real glass sphere.
   Every visual setting is a uniform; presets are plain JSON (see AvaOrbSchema in sets.js). Standalone: needs only WebGL2. */
(function (root) {
'use strict';
const ORB_FS = `#version 300 es
precision highp float;

float oh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float on3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = oh(i);
  float b = oh(i + vec3(1.0, 0.0, 0.0));
  float c = oh(i + vec3(0.0, 1.0, 0.0));
  float d = oh(i + vec3(1.0, 1.0, 0.0));
  float e1 = oh(i + vec3(0.0, 0.0, 1.0));
  float f1 = oh(i + vec3(1.0, 0.0, 1.0));
  float g1 = oh(i + vec3(0.0, 1.0, 1.0));
  float h1 = oh(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e1, f1, u.x), mix(g1, h1, u.x), u.y), u.z);
}
float ofb(vec3 p) {
  float s = 0.0;
  float a = 0.62;
  vec3 q = p;
  for (int k = 0; k < 2; k++) { s += a * on3(q); q = q * 1.93 + vec3(1.7, 9.2, 3.1); a *= 0.38; }
  return s / 0.8556;
}
float ofield(vec3 s, float tm, float sd) {
  vec3 p = s * 0.62 + vec3(sd * 7.1, sd * 3.3, sd * 1.7);
  vec3 w = vec3(ofb(p + vec3(0.0, 0.0, tm * 0.07)), ofb(p + vec3(5.2, 1.3, -tm * 0.06)), ofb(p + vec3(-2.7, 8.1, tm * 0.05)));
  return ofb(p * 1.1 + (w - vec3(0.5)) * 1.7 + vec3(tm * 0.03, 0.0, -tm * 0.025));
}
vec3 h2c(float r, float g, float b) { return vec3(r, g, b) / 255.0; }
float hh(vec3 p) { vec3 q = fract(p * 0.1031); q += dot(q, q.zyx + 31.32); return fract((q.x + q.y) * q.z); }
vec3 s5(float j, vec3 a, vec3 b, vec3 c, vec3 d, vec3 e) { return mix(mix(mix(a, b, step(0.5, j)), mix(c, d, step(2.5, j)), step(1.5, j)), e, step(3.5, j)); }
vec3 pcol(float k, float j) {
  vec3 em = s5(j, h2c(170.0, 40.0, 16.0), h2c(226.0, 76.0, 32.0), h2c(242.0, 138.0, 62.0), h2c(249.0, 194.0, 140.0), h2c(150.0, 164.0, 92.0));
  vec3 gr = s5(j, h2c(22.0, 36.0, 30.0), h2c(46.0, 78.0, 58.0), h2c(84.0, 146.0, 108.0), h2c(138.0, 186.0, 158.0), h2c(96.0, 110.0, 102.0));
  vec3 vi = s5(j, h2c(92.0, 76.0, 202.0), h2c(150.0, 170.0, 246.0), h2c(228.0, 140.0, 222.0), h2c(243.0, 172.0, 200.0), h2c(251.0, 222.0, 204.0));
  vec3 ox = s5(j, h2c(30.0, 10.0, 10.0), h2c(74.0, 23.0, 20.0), h2c(122.0, 59.0, 52.0), h2c(185.0, 138.0, 150.0), h2c(201.0, 187.0, 242.0));
  vec3 ci = s5(j, h2c(63.0, 162.0, 102.0), h2c(158.0, 215.0, 122.0), h2c(242.0, 212.0, 106.0), h2c(169.0, 227.0, 240.0), h2c(247.0, 200.0, 164.0));
  vec3 mo = s5(j, h2c(91.0, 98.0, 140.0), h2c(142.0, 151.0, 198.0), h2c(201.0, 204.0, 232.0), h2c(237.0, 234.0, 246.0), h2c(217.0, 199.0, 226.0));
  return mix(mix(mix(em, gr, step(0.5, k)), mix(vi, ox, step(2.5, k)), step(1.5, k)), mix(ci, mo, step(4.5, k)), step(3.5, k));
}
vec3 prim(float k) { return mix(mix(mix(h2c(255.0, 226.0, 196.0), h2c(172.0, 196.0, 182.0), step(0.5, k)), mix(h2c(253.0, 232.0, 218.0), h2c(210.0, 196.0, 246.0), step(2.5, k)), step(1.5, k)), mix(h2c(246.0, 252.0, 240.0), h2c(250.0, 249.0, 255.0), step(4.5, k)), step(3.5, k)); }
vec3 bc(float i, float tm, float sd) { float a = i * 2.39996 + sd * 6.0 + tm * (0.05 + 0.017 * i); float b = sin(i * 1.7 + tm * 0.045 + sd * 3.0) * 0.95; return normalize(vec3(cos(a) * cos(b), sin(b), sin(a) * cos(b))); }
float bw(vec3 s, vec3 c, float k) { return exp((dot(s, c) - 1.0) * k); }
vec3 olin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
vec3 osrgb(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 tolab(vec3 c) {
  vec3 l = olin(c);
  float a = pow(max(0.4122214708 * l.x + 0.5363325363 * l.y + 0.0514459929 * l.z, 0.0), 1.0 / 3.0);
  float b = pow(max(0.2119034982 * l.x + 0.6806995451 * l.y + 0.1073969566 * l.z, 0.0), 1.0 / 3.0);
  float d = pow(max(0.0883024619 * l.x + 0.2817188376 * l.y + 0.6299787005 * l.z, 0.0), 1.0 / 3.0);
  return vec3(0.2104542553 * a + 0.7936177850 * b - 0.0040720468 * d, 1.9779984951 * a - 2.4285922050 * b + 0.4505937099 * d, 0.0259040371 * a + 0.7827717662 * b - 0.8086757660 * d);
}
vec3 fromlab(vec3 c) {
  float a = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float b = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float d = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  a = a * a * a;
  b = b * b * b;
  d = d * d * d;
  return osrgb(vec3(4.0767416621 * a - 3.3077115913 * b + 0.2309699292 * d, -1.2684380046 * a + 2.6097574011 * b - 0.3413193965 * d, -0.0041960863 * a - 0.7034186147 * b + 1.7076147010 * d));
}
float pulse(float r, float age) { float rad = age * 1.5; float amp = exp(-age * 2.4) * step(0.0, age) * smoothstep(0.0, 0.08, age); float d = (r - rad) / 0.17; return exp(-d * d) * amp; }
vec3 spin(vec3 v, float a) { float c = cos(a); float s = sin(a); return vec3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }

uniform vec2 uRes; uniform vec3 uRect; uniform sampler2D uBack; uniform float uDark; uniform float uCustom; uniform vec3 COLS[5]; uniform vec3 LC; uniform vec3 DOM; uniform vec4 WV; uniform vec4 MOT; uniform vec4 SLO; uniform vec4 MT; uniform vec4 ML[4];
vec4 LY = vec4(1.0);
uniform vec4 P0; uniform vec4 P1; uniform vec4 P2; uniform vec4 LOOK; uniform vec4 RIM; uniform vec4 SHD; uniform vec4 GLS; uniform vec4 MAT; uniform vec4 GR2; uniform vec4 SND;
out vec4 frag;
vec3 palc(float k, float j) { if (uCustom > -1.0) { if (j < 0.5) return COLS[0]; if (j < 1.5) return COLS[1]; if (j < 2.5) return COLS[2]; if (j < 3.5) return COLS[3]; return COLS[4]; } return pcol(k, j); }
vec3 lightc(float k) { return LC; }
vec3 gradeLab(vec3 lab) { float c = cos(LOOK.x); float s = sin(LOOK.x); vec2 ab = vec2(lab.y * c - lab.z * s, lab.y * s + lab.z * c) * LOOK.y; return vec3(clamp(lab.x + LOOK.z, 0.0, 1.0), ab); }
/* the colour of the Signature field at a direction on (or in) the sphere: the five drifting colour regions, warped by the fluid */
vec3 fieldColor(vec3 s, float tm, float sd, float f0, float pk, float lift, out float wvx) {
  vec3 wv = vec3(ofb(s * 1.25 + vec3(0.0, 0.0, tm * 0.08)), ofb(s * 1.25 + vec3(5.2, 1.3, -tm * 0.07)), ofb(s * 1.25 + vec3(-2.7, 8.1, tm * 0.06)));
  vec3 tw = spin(s, s.y * (2.3 + 0.5 * sin(tm * 0.11 + sd * 4.0)) + (f0 - 0.5) * 1.6);
  vec3 d0 = normalize(tw + (wv - vec3(0.5)) * 1.3);
  float w0 = bw(d0, bc(0.0, tm, sd), 4.6); float w1 = bw(d0, bc(1.0, tm, sd), 4.9); float w2 = bw(d0, bc(2.0, tm, sd), 4.7); float w3 = bw(d0, bc(3.0, tm, sd), 5.2);
  float w4 = bw(d0, bc(4.0, tm, sd), 6.0) * mix(0.5, 0.25, step(-0.5, -abs(pk)));
  vec3 lab = (tolab(palc(pk, 0.0)) * w0 + tolab(palc(pk, 1.0)) * w1 + tolab(palc(pk, 2.0)) * w2 + tolab(palc(pk, 3.0)) * w3 + tolab(palc(pk, 4.0)) * w4) / (w0 + w1 + w2 + w3 + w4);
  lab.x = lab.x * (0.93 + 0.16 * smoothstep(0.25, 0.75, f0)) * (0.96 + 0.06 * wv.x) + 0.028 * lift;
  lab.y = lab.y * (1.0 + 0.24 * lift); lab.z = lab.z * (1.0 + 0.24 * lift);
  wvx = wv.x; return lab;
}
/* material motion (MOT.x): 0 drift, 1 stir, 2 breathe, 3 ripples, 4 turbulence, 5 spectral, 6 tide — how the contents move, fed by loudness */
vec3 motionShift(vec3 s, float t) {
  float st = MOT.x; float k = MOT.y; float e = P1.x;
  if (st > 3.5 && st < 4.5) return s + (vec3(on3(s * 2.6 + vec3(t * 1.7)), on3(s * 2.6 + vec3(3.1, t * 1.9, 0.0)), on3(s * 2.6 + vec3(0.0, 5.2, t * 1.5))) - vec3(0.5)) * (0.08 + e * 0.5) * k;
  if (st > 5.5) return s + vec3(0.0, sin(t * 3.1 + s.x * 2.0) * (0.04 + e * 0.22) * k, 0.0);
  if (st > 2.5 && st < 3.5) return s * (1.0 + sin(length(s.xy) * 16.0 - t * 9.0) * (0.01 + e * 0.07) * k);
  if (st > 1.5 && st < 2.5) return s * (1.0 - (0.02 * sin(t * 1.3) + 0.07 * e) * k);
  return s;
}
float motionLight(float r) {
  float st = MOT.x; float k = MOT.y; float e = P1.x;
  if (st > 1.5 && st < 2.5) return e * 0.07 * k;
  if (st > 4.5 && st < 5.5) return 0.1 * k * (SND.z * exp(-r * r * 5.0) + e * exp(-pow((r - 0.55) * 7.0, 2.0)) + SND.w * exp(-pow((r - 0.88) * 12.0, 2.0)));
  return 0.0;
}
/* water rocking: the contents slosh like water in a gently rocked bowl. The surface tilts right to left, toward the bottom, rocks down and up,
   rises, then swings left to right, in one smooth loop. It comes in surges that briefly break the existing flow, ease off, and come again.
   SLO.x intensity (0 is off), SLO.y variation (randomises the timing and path of each surge). */
/* ─── materials inside the sphere, in up to four layers (ML[k]: amount, velocity, scale, type); LY is the layer being drawn ─── */
float fb4(vec3 p) { float s = 0.0; float a = 0.5; for (int k = 0; k < 4; k++) { s += a * on3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
/* a smooth ramp across the palette's five colours */
vec3 palRamp(float x) { x = clamp(x, 0.0, 1.0) * 4.0; vec3 c = mix(COLS[0], COLS[1], smoothstep(0.0, 1.0, x)); c = mix(c, COLS[2], smoothstep(1.0, 2.0, x)); c = mix(c, COLS[3], smoothstep(2.0, 3.0, x)); return mix(c, COLS[4], smoothstep(3.0, 4.0, x)); }
/* blackbody-like flame colour by temperature */
vec3 flame(float h) { return clamp(vec3(1.9 * h, 1.45 * h * h - 0.08, 2.4 * h * h * h - 0.75), 0.0, 1.0) * vec3(1.0, 0.72, 0.5) + vec3(0.22, 0.03, 0.0) * smoothstep(0.0, 0.3, h); }
/* ink in water: plumes pour in near the top and sink; turbulence grows as they fall, so they unfurl into ridged tendrils and curl.
   Dense, saturated ink in a column of its own, clear water around it; each orb's seed gives it its own pour. */
vec4 inkAt2(vec3 p, float t, float sharp) {
  float sp = LY.y; vec3 sd3 = vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1); float fall = t * 0.16 * sp;
  vec3 q = p * 1.35 * LY.z + sd3; q.y += fall;
  vec3 w1 = vec3(fb4(q * 0.9 + vec3(0.0, 0.0, t * 0.06 * sp)), fb4(q * 0.9 + vec3(4.1, 1.7, -t * 0.05 * sp)), fb4(q * 0.9 + vec3(-2.3, 6.2, t * 0.04 * sp))) - 0.5;
  float depth = clamp(0.5 - p.y * 0.5, 0.0, 1.0); vec3 qw = q + w1 * (1.1 + 2.4 * depth);
  float body = fb4(vec3(qw.x * 1.6, qw.y * 0.55, qw.z * 1.6)); float ten = 1.0 - abs(2.0 * fb4(qw * vec3(2.6, 1.1, 2.6) + 7.3) - 1.0);
  float fine = fb4(qw * 5.2 + 2.9) * sharp; float dens = smoothstep(mix(0.6, 0.66, sharp), mix(0.82, 0.72, sharp), body * 0.6 + pow(ten, mix(3.0, 4.5, sharp)) * mix(0.55, 0.7, sharp) + (fine - 0.25 * sharp) * 0.25);
  dens *= smoothstep(0.62, 0.12, abs(p.x * 0.55 + (fb4(vec3(p.y * 0.8 + fall * 0.3, 0.0, 1.0) + sd3) - 0.5) * 1.1));
  return vec4(palRamp(fb4(p * 0.6 + sd3 + vec3(0.0, fall * 0.2, 0.0)) * 1.3 - 0.15), dens * mix(4.5, 9.0, sharp) * LY.x);
}
vec4 inkAt(vec3 p, float t) { return inkAt2(p, t, 0.0); }
/* mist: fog that pools lower in the sphere and drifts in slow layers, tinted by the palette, lit on its upper surfaces and shaded beneath */
vec4 mistAt(vec3 p, float t) {
  float sp = LY.y; vec3 sd3 = vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1); vec3 q = p * 1.15 * LY.z + vec3(t * 0.05 * sp, 0.0, t * 0.03 * sp) + sd3;
  vec3 wq = (vec3(fb4(q * 0.7), fb4(q * 0.7 + 4.1), fb4(q * 0.7 + 8.3)) - 0.5) * 1.4; float n = fb4(q + wq);
  float d = smoothstep(0.4, 0.8, n) * (0.4 + 0.6 * smoothstep(0.5, -0.9, p.y)) * 5.4 * LY.x;
  float up = fb4(q + wq + vec3(-0.1, 0.22, 0.05)); float shade = clamp(0.54 + (n - up) * 4.0, 0.24, 1.08);
  return vec4(mix(palRamp(fb4(p * 0.7 + 1.0 + sd3) * 0.8 + 0.1), LC, 0.15) * shade, d);
}
/* fire, in six styles (SHD.w): 0 classic, 1 blue gas, 2 inferno with embers, 3 candle, 4 spirit (the palette's own colour), 5 smoulder with embers */
float embers(vec3 p, float t) { vec3 q = p * 6.0; q.y -= t * 1.1; q.x += sin(q.y * 0.7 + t) * 0.3; vec3 id = floor(q); vec3 f = fract(q) - 0.5; float h = hh(id);
  if (h < 0.93) return 0.0; vec3 o = (vec3(hh(id + 1.3), hh(id + 2.7), hh(id + 4.1)) - 0.5) * 0.55; return smoothstep(0.07, 0.0, length(f - o)) * (0.55 + 0.45 * sin(t * 11.0 + h * 40.0)); }
vec4 fireAt(vec3 p, float t) {
  float V = SHD.w; float sp = LY.y * (V > 1.5 && V < 2.5 ? 1.5 : 1.0);
  vec3 q = p * 1.45 * LY.z + vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1); q.y -= t * 0.55 * sp;
  vec3 w = vec3(fb4(q * 1.2 + vec3(0.0, -t * 0.3 * sp, 0.0)), fb4(q * 1.2 + vec3(3.1, -t * 0.34 * sp, 1.7)), 0.0);
  float turb = V < 0.5 ? 1.9 : (V < 1.5 ? 0.7 : (V < 2.5 ? 2.6 : (V < 3.5 ? 0.4 : (V < 4.5 ? 2.1 : 1.1))));
  float n = fb4(q + (w - 0.5) * turb); float h = clamp((p.y + 1.0) * 0.5, 0.0, 1.0);
  float hf = V < 0.5 ? 1.15 : (V < 1.5 ? 1.75 : (V < 2.5 ? 0.82 : (V < 3.5 ? 1.0 : (V < 4.5 ? 1.05 : 2.7))));
  float tongue = 1.0 - abs(2.0 * fb4(vec3(q.x * 2.4, q.y * 0.7, q.z * 2.4) + (w - 0.5) * 1.2) - 1.0);
  float heat = clamp(smoothstep(0.0, 1.0, 0.78 - h * hf + (n - 0.5) * 1.2 + (tongue - 0.5) * 0.7), 0.0, 1.0);
  if (V > 2.5 && V < 3.5) { float ax = 0.07 * sin(t * 1.3 * sp + p.y * 2.2) + 0.03 * sin(t * 3.1 * sp); float rad = length(vec2(p.x - ax, p.z)); float wdt = 0.42 * (1.0 - smoothstep(-0.9, 0.6, p.y)) + 0.02;
    heat = clamp(smoothstep(1.0, 0.0, rad / wdt) * smoothstep(-0.95, -0.75, p.y) * (1.1 + 0.3 * n), 0.0, 1.0); }
  vec3 c;
  if (V > 0.5 && V < 1.5) c = mix(vec3(0.05, 0.12, 0.85), vec3(0.55, 0.88, 1.0), heat) * (0.4 + 1.2 * heat) + vec3(1.0) * smoothstep(0.85, 1.0, heat) * 0.6;
  else if (V > 3.5 && V < 4.5) c = mix(DOM * 0.45, mix(DOM, vec3(1.0), 0.3), heat) * (0.25 + 0.75 * heat);
  else if (V > 4.5) c = mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.42, 0.08), heat) * (0.3 + 0.9 * heat);
  else c = mix(flame(heat * (V > 1.5 && V < 2.5 ? 1.0 : 0.92)), palRamp(heat), V > 1.5 && V < 2.5 ? 0.05 : 0.1) * (0.35 + (V > 1.5 && V < 2.5 ? 1.4 : 1.1) * heat);
  float d = heat * heat * (V > 4.5 ? 1.6 : (V > 2.5 && V < 3.5 ? 5.0 : (V > 3.5 && V < 4.5 ? 1.8 : 2.6))) * LY.x;
  if ((V > 1.5 && V < 2.5) || V > 4.5) { float em = embers(p + vec3(P0.z, 0.0, 0.0), t * sp) * (V > 4.5 ? 1.0 : 0.8); d += em * 6.0; c = mix(c, vec3(1.6, 0.75, 0.25), clamp(em * 2.0, 0.0, 1.0)); }
  return vec4(c, d);
}
/* aurora: thin curtains of light with fine vertical rays, rippling and following the sphere; colour runs up the palette */
vec4 auroraAt(vec3 p, float t) {
  float sp = LY.y; vec3 q = p * LY.z + vec3(P0.z * 3.7, 0.0, P0.z * 2.1);
  float f = fb4(vec3(q.x * 1.3, 0.0, q.z * 1.3) + vec3(t * 0.05 * sp, 0.0, t * 0.035 * sp)) + 0.12 * sin(q.x * 5.0 + t * 0.6 * sp);
  float sheet = exp(-pow((f - 0.5) * 11.0, 2.0)) + 0.5 * exp(-pow((f - 0.62) * 15.0, 2.0));
  float rays = 0.45 + 0.55 * fb4(vec3(q.x * 16.0, q.y * 0.7 - t * 0.25 * sp, q.z * 16.0));
  float vert = smoothstep(-0.75, -0.05, q.y) * (1.0 - smoothstep(0.15, 0.9, q.y));
  float d = sheet * rays * vert * 2.2 * LY.x;
  return vec4(mix(DOM, mix(COLS[0], DOM, 0.35), smoothstep(-0.6, 0.8, q.y)) * 1.9, d);
}

vec4 smokeVolAt(vec3 p, float t) { float sp = LY.y; vec3 sd3 = vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1); vec3 q = p * 1.3 * LY.z + sd3; q.y -= t * 0.12 * sp;
  vec3 wq = (vec3(fb4(q * 0.8 + vec3(0.0, 0.0, t * 0.05 * sp)), fb4(q * 0.8 + 4.1), fb4(q * 0.8 + 8.3)) - 0.5) * 2.0; float n = fb4(q + wq);
  float ero = fb4(q * 3.2 + vec3(0.0, -t * 0.25 * sp, 0.0)); float nn = n - (1.0 - n) * 0.45 * ero;
  return vec4(mix(COLS[0], vec3(0.5), 0.5), smoothstep(0.4, 0.78, nn) * 3.4 * LY.x); }
vec4 sandHazeAt(vec3 p, float t) { float sp = LY.y; float rr = length(p.xz) + 1e-3; float ang = atan(p.z, p.x); float a2 = ang + t * 0.9 * sp * (1.25 - rr);
  vec3 cyl = vec3(cos(a2) * 1.6 + rr * 6.0 * LY.z, sin(a2) * 1.6 + rr * 3.0 * LY.z, p.y * 6.5 * LY.z) + vec3(P0.z * 3.7, 0.0, 0.0);
  float st = fb4(cyl); float streak = smoothstep(0.54, 0.8, st);
  float gust = smoothstep(0.28, 0.72, fb4(vec3(cos(ang + t * 0.45 * sp) * 1.2, p.y * 1.4, sin(ang + t * 0.45 * sp) * 1.2) + vec3(0.0, t * 0.1, P0.z)));
  float d = (streak * 0.92 + 0.08) * gust * smoothstep(0.18, 0.85, rr) * 11.0 * LY.x;
  return vec4(mix(palRamp(0.45 + st * 0.5), COLS[4], 0.2) * (0.8 + 0.4 * st), d); }
vec4 snowPowderAt(vec3 p, float t) { float sp = LY.y; vec3 q = p * 2.2 * LY.z + vec3(P0.z * 3.7, t * 0.04 * sp, 0.0);
  float bed = smoothstep(-0.55, -0.9, p.y + (fb4(q) - 0.5) * 0.35); float drift = smoothstep(0.7, 0.92, fb4(q * 2.6 + vec3(t * 0.05 * sp, 0.0, 0.0)));
  return vec4(mix(palRamp(0.7), vec3(1.0), 0.6), (bed * 2.6 + drift * 0.35) * LY.x); }
/* thin-film interference from the optics: path difference 2 n d cos(theta_t) at 650, 532 and 450 nm, a half-wave shift at the
   first reflection; bands blend toward pastel as the film thickens (d in nanometres, n = 1.33 as for a soap film) */
vec3 thinFilm(float cosI, float dnm) { float n = 1.33; float cosT = sqrt(max(1.0 - (1.0 - cosI * cosI) / (n * n), 0.0)); float opd = 2.0 * n * dnm * cosT;
  vec3 I = 0.5 + 0.5 * cos(6.28318 * opd / vec3(650.0, 532.0, 450.0) + 3.14159); return mix(I, vec3(0.62), smoothstep(700.0, 1500.0, dnm) * 0.75); }
/* holograms: a thin film on the sphere whose thickness flows in slow swirls and drains under gravity (thinner at the top), reflecting its
   interference colours over what lies behind, weighted by Fresnel reflectance so they strengthen toward the rim */
vec3 filmOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 11.5 && Lk.w < 12.5)) continue;
    vec3 sp3 = vec3(q.x, -q.y, -z); float sp = Lk.y; vec3 fq = sp3 * 1.6 * Lk.z + vec3(P0.z * 3.7, 0.0, P0.z * 2.1);
    vec3 w = vec3(fb4(fq + vec3(0.0, t * 0.16 * sp, t * 0.05 * sp)), fb4(fq + vec3(4.3, -t * 0.13 * sp, 1.1)), 0.0) - 0.5;
    float thick = (180.0 + 900.0 * fb4(fq * 0.9 + w * 2.0 + vec3(0.0, t * 0.22 * sp, 0.0))) * mix(0.45, 1.25, clamp(0.5 - sp3.y * 0.5, 0.0, 1.0));
    float Fr = 0.04 + 0.96 * pow(1.0 - z, 5.0); float w2 = clamp((0.1 + 0.25 * pow(1.0 - z, 1.5) + 0.8 * Fr) * Lk.x, 0.0, 1.0);
    col = mix(col, col * 0.55 + thinFilm(z, thick) * 0.75, w2); }
  return col; }
/* sharp, folded noise from triangle waves, the structure professional aurora shaders build curtains from */
float triw(float x) { return abs(fract(x) - 0.5); }
float triNoise(vec2 p, float t) { float z = 1.8; float rz = 0.0; vec2 bp = p;
  for (int i = 0; i < 4; i++) { vec2 dg = vec2(triw(bp.x + triw(bp.y)), triw(bp.y + triw(bp.x))) * 1.2; p += dg / z + t * 0.12; bp *= 1.8; z *= 1.45; p *= 1.2;
    p = mat2(0.95534, 0.29552, -0.29552, 0.95534) * p; rz += triw(p.x + triw(p.y)) / z; } return clamp(rz * 1.6, 0.0, 1.0); }
/* aurora: four curtains at different depths, each met exactly where the viewing ray crosses it; a sharp bright lower edge fading upward,
   fine vertical rays drifting along it, waves travelling along its length, brighter where it folds toward the viewer; base, core and tip
   colours from the palette laid out like the emission lines; a night sky with faint stars behind */
vec3 auroraOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 3.5 && Lk.w < 4.5)) continue;
    float sp = Lk.y; float amt = Lk.x; float sc = max(Lk.z, 0.3); vec2 P = vec2(q.x, -q.y);
    vec3 sky = mix(vec3(0.012, 0.02, 0.05), vec3(0.03, 0.02, 0.07), smoothstep(-1.0, 1.0, P.y)); vec2 sg = floor(P * 90.0); float st = hh(vec3(sg, 3.0));
    sky += vec3(0.8, 0.85, 1.0) * step(0.985, st) * smoothstep(max(abs(SLO.w) * 1.3, 0.0025), 0.0, length(fract(P * 90.0) - 0.5) / 90.0) * (0.5 + 0.5 * sin(t * (1.0 + st * 3.0) + st * 40.0)) * 0.6;
    col = mix(col, sky, 0.85); vec3 acc = vec3(0.0);
    for (int c = 0; c < 4; c++) { float fc = float(c); float zc = -0.45 + fc * 0.3; if (r * r + zc * zc > 1.0) continue;
      float x = P.x / sc + fc * 1.7 + P0.z * 3.0;
      float wv = 0.16 * sin(x * 1.7 - t * 0.33 * sp + fc) + 0.07 * sin(x * 4.3 + t * 0.51 * sp + fc * 2.0) + (triNoise(vec2(x * 0.35, fc), t * 0.05 * sp) - 0.5) * 0.35;
      float dw = 0.16 * 1.7 * cos(x * 1.7 - t * 0.33 * sp + fc) + 0.07 * 4.3 * cos(x * 4.3 + t * 0.51 * sp + fc * 2.0); float fold = sqrt(1.0 + dw * dw * 2.5);
      float base = -0.35 + wv * 0.9 - fc * 0.05; float hgt = P.y - base;
      float edge = smoothstep(-0.02, 0.025, hgt) * exp(-max(hgt, 0.0) * (2.6 + fc * 0.4));
      float rays = 0.35 + 0.65 * triNoise(vec2(x * 7.0 - t * 0.25 * sp, hgt * 0.35 + fc * 3.0), t * 0.08 * sp);
      float surge = 0.65 + 0.35 * sin(x * 2.1 - t * 0.9 * sp + fc * 1.3);
      float I = edge * rays * surge * fold * (1.0 - fc * 0.18);
      vec3 cA = mix(COLS[1], vec3(0.45, 0.35, 1.0), 0.35); vec3 cB = DOM * 1.25; vec3 cC = mix(COLS[3], vec3(1.0, 0.35, 0.45), 0.25);
      vec3 cc = hgt < 0.06 ? mix(cA, cB, smoothstep(0.0, 0.06, hgt)) : mix(cB, cC, smoothstep(0.1, 0.6, hgt));
      acc += cc * I; }
    col += (vec3(1.0) - exp(-acc * 1.4 * (1.0 + P1.x * 1.2))) * amt; }
  return col; }
/* blackbody glow by temperature: dark red, orange, yellow, near white */
vec3 blackbody(float h) { vec3 c = mix(vec3(0.35, 0.02, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.45, h)); c = mix(c, vec3(1.0, 0.72, 0.25), smoothstep(0.45, 0.8, h)); return mix(c, vec3(1.0, 0.95, 0.8), smoothstep(0.8, 1.0, h)); }
/* 3D cellular noise: distances to the nearest and second-nearest cell points */
vec2 vor3(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); float d1 = 8.0; float d2 = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int m = -1; m <= 1; m++) { vec3 b = vec3(float(m), float(j), float(k));
    vec3 rv = b + vec3(hh(i + b), hh(i + b + 7.3), hh(i + b + 13.1)) - f; float d = dot(rv, rv); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(sqrt(d1), sqrt(d2)); }
/* plasma: a real plasma globe. Seven filaments from the electrode to contact points wandering over the glass; each displaced by sharp noise
   that grows toward the glass and forking near its end; a thin bright core and a broad glow; a bright spot where it meets the glass; dimmer
   on the far side; near-white at the electrode shifting to the palette's colour; fast flicker, slow wander */
vec3 plasmaOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 9.5 && Lk.w < 10.5)) continue;
    float sp = Lk.y; float amt = Lk.x; vec2 P = vec2(q.x, -q.y); vec3 acc = DOM * 0.06 * exp(-r * r * 2.5);
    for (int f = 0; f < 7; f++) { float ff = float(f) + P0.z * 5.0;
      vec3 e3 = normalize(vec3(sin(ff * 2.4 + t * 0.21 * sp) + 0.5 * sin(t * 0.53 * sp + ff * 1.7), cos(ff * 1.9 + t * 0.17 * sp) + 0.4 * sin(t * 0.37 * sp + ff), sin(ff * 3.1 + t * 0.13 * sp)));
      vec2 e2 = e3.xy * 0.97; float L = max(length(e2), 0.05); vec2 dir = e2 / L; vec2 nrm = vec2(-dir.y, dir.x); float back = smoothstep(-0.2, 0.4, e3.z);
      float sraw = dot(P, dir) / L; float s = clamp(sraw, 0.0, 1.0); float jit = t * 7.0 * sp + ff * 13.0;
      float off = (triNoise(vec2(s * 3.0 + ff, ff), jit * 0.03) - 0.5) * 0.4 * s * L + sin(s * 11.0 + jit) * 0.012 * s;
      float d = length(P - (dir * s * L + nrm * off)); float w = max(0.0035 + 0.006 * s, abs(SLO.w) * 0.9);
      float mask = smoothstep(-0.02, 0.06, sraw) * smoothstep(1.03, 0.98, sraw);
      float off2 = off + (triNoise(vec2(s * 5.0 + ff * 2.0, ff + 9.0), jit * 0.05) - 0.5) * 0.5 * max(s - 0.6, 0.0);
      float d2 = length(P - (dir * s * L + nrm * off2)); float w2 = w * 0.7;
      float I = exp(-d * d / (w * w)) * 1.4 + (w * w) / (d * d + w * w) * 0.32 + (exp(-d2 * d2 / (w2 * w2)) + (w2 * w2) / (d2 * d2 + w2 * w2) * 0.25) * smoothstep(0.6, 0.72, s) * 0.8;
      float spot = exp(-dot(P - e2, P - e2) / 0.0012) * 1.6 + exp(-dot(P - e2, P - e2) / 0.012) * 0.25;
      vec3 fc = mix(mix(vec3(1.0), DOM, 0.3), mix(DOM, COLS[1], 0.35), s);
      acc += fc * (I * mask + spot) * mix(1.0, 0.4, back) * (0.85 + 0.15 * sin(t * 23.0 * sp + ff * 7.0)); }
    acc += mix(vec3(1.0), DOM, 0.25) * (exp(-r * r / 0.0035) * 2.2 + exp(-r * r / 0.03) * 0.35); acc *= 1.0 + P1.x * 1.4;
    col += (vec3(1.0) - exp(-acc * 1.3)) * amt; }
  return col; }
/* lava: a molten ball. 3D cellular crust plates wrapped around the sphere, warped so they are irregular; glowing seams where plates meet, heat
   bleeding into their edges, coloured along a blackbody curve; rough basalt lit by the key light; slow drift, molten pools welling up, heat at the rim */
vec3 lavaOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 10.5 && Lk.w < 11.5)) continue;
    float sp = Lk.y; vec3 n = vec3(q.x, -q.y, -z); float an = t * 0.03 * sp; float ca = cos(an); float sa = sin(an);
    vec3 pp = vec3(n.x * ca + n.z * sa, n.y, -n.x * sa + n.z * ca) * 3.2 * Lk.z + vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1);
    pp += (vec3(fb4(pp * 0.5 + t * 0.02 * sp), fb4(pp * 0.5 + 5.1), fb4(pp * 0.5 + 9.7)) - 0.5) * 0.6;
    vec2 v = vor3(pp); float gap = v.y - v.x; float open = smoothstep(0.3, 0.62, fb4(pp * 1.4 + vec3(t * 0.02 * sp, 0.0, 0.0))); float crack = (1.0 - smoothstep(0.008, 0.05 + 0.03 * open, gap)) * (0.25 + 0.75 * open);
    float heat = clamp((crack * 0.78 + 0.18 * exp(-gap * 14.0) * open + 0.28 * smoothstep(0.74, 0.96, fb4(pp * 0.7 + vec3(0.0, t * 0.05 * sp, 0.0)))) * (0.85 + 0.15 * sin(t * 1.3 * sp + v.x * 20.0) + P1.x * 0.5), 0.0, 1.0);
    vec3 nb = normalize(n + (vec3(fb4(pp * 4.0 + 0.1), fb4(pp * 4.0 + 3.3), fb4(pp * 4.0 + 6.1)) - 0.5) * 0.6);
    float diff = max(dot(nb, normalize(vec3(-0.45, 0.62, -0.55))), 0.0); float bump = fb4(pp * 4.0);
    vec3 crust = mix(vec3(0.05, 0.045, 0.045), mix(COLS[0], vec3(0.2, 0.16, 0.14), 0.6) * 0.5, bump) * (0.22 + 0.78 * diff) + vec3(0.32, 0.05, 0.01) * exp(-gap * 7.0) * open * 0.35;
    vec3 glow = mix(blackbody(heat * 0.85), palRamp(0.85), 0.1) * (0.45 + 1.7 * heat);
    vec3 lv = crust + glow * smoothstep(0.05, 0.5, heat) + blackbody(0.5) * 0.12 * pow(1.0 - z, 3.0);
    col = mix(col, vec3(1.0) - exp(-lv * 0.95), clamp(Lk.x, 0.0, 1.0)); }
  return col; }
/* a photographic studio for reflections: a dark gradient, two large softboxes, a strip light and a warm floor bounce */
vec3 studioEnv(vec3 d) {
  vec3 c = mix(vec3(0.02, 0.022, 0.026), vec3(0.16, 0.17, 0.19), smoothstep(-0.2, 0.9, d.y)); vec2 a = vec2(atan(d.x, -d.z), asin(clamp(d.y, -1.0, 1.0)));
  float b1 = smoothstep(0.08, 0.0, max(abs(a.x + 0.7) - 0.35, abs(a.y - 0.55) - 0.22)); float b2 = smoothstep(0.1, 0.0, max(abs(a.x - 1.1) - 0.2, abs(a.y - 0.25) - 0.35));
  float strip = smoothstep(0.03, 0.0, abs(a.y + 0.05) - 0.02) * smoothstep(1.8, 1.2, abs(a.x));
  return c + vec3(1.0) * b1 * 2.2 + vec3(0.95, 0.97, 1.0) * b2 * 1.2 + vec3(1.0) * strip * 0.8 + vec3(0.25, 0.18, 0.12) * smoothstep(-0.1, -0.8, d.y); }
/* liquid aluminium: aluminium's reflectance with its Fresnel curve, lightly anodised toward the palette; the surface ripples like liquid metal,
   bending the studio's reflections as it moves; a touch of roughness from three nearby reflection samples */
vec3 metalOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 13.5 && Lk.w < 14.5)) continue;
    float sp = Lk.y; vec3 n = vec3(q.x, -q.y, -z); vec3 g = vec3(0.0);
    for (int i = 0; i < 4; i++) { float fi = float(i); vec3 dir = normalize(vec3(sin(fi * 2.3 + P0.z * 4.0), cos(fi * 1.7), sin(fi * 3.1 + 1.0)));
      float ph = dot(n, dir) * (5.0 + fi * 2.5) * Lk.z - t * (1.2 + fi * 0.5) * sp; g += dir * cos(ph) * (0.13 / (1.0 + fi * 0.6)); }
    vec3 sw = vec3(fb4(n * 2.2 + vec3(t * 0.15 * sp)), fb4(n * 2.2 + vec3(4.1, t * 0.12 * sp, 0.0)), fb4(n * 2.2 + vec3(8.3, 0.0, t * 0.13 * sp))) - 0.5;
    vec3 nn = normalize(n + (g + sw * 0.55) * Lk.x * (1.0 + P1.x * 2.2)); float cv = max(dot(nn, -vec3(0.0, 0.0, 1.0)), 0.0);
    vec3 F0 = mix(vec3(0.91, 0.92, 0.92), mix(DOM, vec3(1.0), 0.35), 0.28); vec3 F = F0 + (vec3(1.0) - F0) * pow(1.0 - cv, 5.0);
    vec3 rv = reflect(vec3(0.0, 0.0, 1.0), nn); vec2 uvR = clamp(gl_FragCoord.xy / uRes + vec2(rv.x, rv.y) * 0.22, vec2(0.002), vec2(0.998));
    vec3 world = (texture(uBack, uvR).rgb + texture(uBack, clamp(uvR + vec2(0.01, 0.0), vec2(0.002), vec2(0.998))).rgb + texture(uBack, clamp(uvR + vec2(0.0, 0.01), vec2(0.002), vec2(0.998))).rgb) / 3.0;
    vec3 env = mix(world * 1.04, vec3(1.0), smoothstep(0.3, 0.92, rv.y) * 0.9);
    env += vec3(1.0) * smoothstep(0.022, 0.0, abs(rv.y + 0.03) - 0.008) * 0.3 * smoothstep(0.95, 0.4, abs(rv.x));
    env += vec3(1.0, 0.98, 0.95) * smoothstep(0.72, 0.95, rv.x) * smoothstep(-0.2, 0.3, rv.y) * 0.55;
    env = mix(env, world * vec3(0.3, 0.28, 0.27), smoothstep(-0.06, -0.6, rv.y));
    col = min(F * env, vec3(1.0)); }
  return col; }
/* ocean: directional waves with sharpened (trochoid-like) crests and fine chop */
float oceanH(vec2 x, float t, float sp) { float h = 0.0; float a = 0.06; float k = 3.2;
  for (int i = 0; i < 4; i++) { float fi = float(i); vec2 di = normalize(vec2(cos(fi * 1.7 + 0.3), sin(fi * 1.7 + 0.3) * 0.6 + 0.4));
    float ph = dot(x, di) * k - t * sqrt(k) * 0.8 * sp + fi * 1.9; h += a * (i == 0 ? (pow(1.0 - abs(sin(ph * 0.5)), 1.5) * 2.0 - 0.7) : sin(ph)); a *= 0.5; k *= 1.6; }
  return (h + (fb4(vec3(x * 2.2, t * 0.2 * sp)) - 0.5) * 0.02) * (1.0 + P1.x * 1.6); }
/* ocean waves with foam: the sphere half-filled with water, tilted toward the viewer. Each ray finds where it meets the wavy surface; water's
   low Fresnel reflectance of the world above with a sun glint; below, light absorbed with depth (red first), shallow to deep, caustics on the
   bottom; thin crests glowing with light passing through; whitecap foam on crests and a line of foam where the water meets the glass */
vec3 oceanOver(vec3 col, vec2 q, float r, float z, float t, vec3 pin, vec3 rdi, float tex) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 14.5 && Lk.w < 15.5)) continue;
    float sp = Lk.y; float sc = max(Lk.z, 0.3); float ca = cos(0.26); float sa = sin(0.26); float h0 = -0.2;
    vec3 deep = mix(vec3(0.01, 0.06, 0.14), COLS[0] * 0.5, 0.35); vec3 shal = mix(vec3(0.1, 0.62, 0.66), mix(COLS[2], COLS[3], 0.5), 0.35);
    float prev = 0.0; float hitT = -1.0; bool under0 = false;
    for (int i = 0; i <= 28; i++) { float ti = tex * float(i) / 28.0; vec3 p = pin + rdi * ti; float u = p.y * ca - p.z * sa; float w = p.y * sa + p.z * ca;
      float f = u - (h0 + oceanH(vec2(p.x, w) / sc, t, sp)); if (i == 0) under0 = f < 0.0;
      if (i > 0 && prev > 0.0 && f <= 0.0) { hitT = ti - tex / 28.0 * f / (f - prev); break; } prev = f; }
    if (under0) { vec3 p = pin; float u = p.y * ca - p.z * sa; float dd = clamp((h0 - u) * 1.2, 0.0, 1.0);
      vec3 uw = mix(shal, deep, smoothstep(0.0, 0.9, dd)); float cst = pow(triNoise(vec2(p.x, p.z * 0.5 + u) * 3.0 / sc, t * 0.3 * sp), 3.0);
      col = uw + vec3(0.6, 0.9, 1.0) * cst * 0.25 * (1.0 - dd); continue; }
    if (hitT < 0.0) continue;
    vec3 hp = pin + rdi * hitT; float w0 = hp.y * sa + hp.z * ca; vec2 hx = vec2(hp.x, w0) / sc; float e2 = 0.01;
    float H = oceanH(hx, t, sp); vec3 nw = normalize(vec3(-(oceanH(hx + vec2(e2, 0.0), t, sp) - H) / e2 / sc, 1.0, -(oceanH(hx + vec2(0.0, e2), t, sp) - H) / e2 / sc));
    vec3 nrm = normalize(vec3(nw.x, nw.y * ca + nw.z * sa, -nw.y * sa + nw.z * ca)); float cv = clamp(dot(-rdi, nrm), 0.0, 1.0);
    float F = 0.02 + 0.98 * pow(1.0 - cv, 5.0); vec3 rv = reflect(rdi, nrm);
    vec3 sky = mix(texture(uBack, clamp(gl_FragCoord.xy / uRes + rv.xy * 0.2, vec2(0.002), vec2(0.998))).rgb, vec3(1.0), smoothstep(0.4, 0.95, rv.y) * 0.5);
    float sun = pow(max(dot(rv, normalize(vec3(-0.45, 0.62, -0.55))), 0.0), 220.0) * 3.0;
    float depth = max(tex - hitT, 0.0); vec3 absb = exp(-depth * vec3(2.6, 0.9, 0.55) * 1.4); vec3 body = mix(deep, shal, absb.g) * (0.75 + 0.35 * absb.b);
    float cst = pow(triNoise(hx * 2.2, t * 0.3 * sp), 3.0) * exp(-depth * 1.5); body += vec3(0.5, 0.85, 1.0) * cst * 0.3;
    float crest = smoothstep(0.03, 0.09, H); body += shal * crest * 0.22 * (1.0 - cv);
    vec3 water = mix(body, sky, F) + vec3(1.0, 0.98, 0.94) * sun;
    float foam = smoothstep(0.05, 0.09, H) * smoothstep(0.5, 0.78, fb4(vec3(hx * 2.6 - t * 0.15 * sp, 1.0))) * (0.6 + 0.4 * fb4(vec3(hx * 9.0, t * 0.3 * sp)));
    float wall = smoothstep(0.93, 0.995, length(hp)) * (0.6 + 0.4 * fb4(vec3(hx * 12.0, t * 0.5 * sp)));
    water = mix(water, vec3(0.94, 0.96, 0.97) * (0.8 + 0.2 * cv), clamp(max(foam, wall) * Lk.x, 0.0, 1.0));
    col = water; }
  return col; }
/* washing-machine foam: a mass of soap foam tumbling as the drum turns. Two sizes of 3D cells form the bubble walls; each bubble's cap
   catches the key light; some bubbles show soap-film interference colours; the foam is denser below, churning, thinning to show water */
vec3 foamOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 15.5 && Lk.w < 16.5)) continue;
    float sp = Lk.y; vec3 n = vec3(q.x, -q.y, -z); float an = t * 0.7 * sp + 0.3 * sin(t * 0.9 * sp) + P1.x * 0.9; float ca = cos(an); float sa = sin(an);
    vec3 pn = vec3(n.x, n.y * ca - n.z * sa, n.y * sa + n.z * ca); vec3 pp = pn * 4.5 * Lk.z + vec3(P0.z * 3.7, 0.0, P0.z * 2.1);
    pp += (vec3(fb4(pp * 0.4 + t * 0.2 * sp), fb4(pp * 0.4 + 5.1), fb4(pp * 0.4 + 9.7)) - 0.5) * 0.9;
    vec2 v1 = vor3(pp); vec2 v2 = vor3(pp * 2.3 + 11.0); float wall1 = 1.0 - smoothstep(0.0, 0.07, v1.y - v1.x); float wall2 = 1.0 - smoothstep(0.0, 0.06, v2.y - v2.x);
    float cap = pow(clamp(1.0 - v1.x * 1.9, 0.0, 1.0), 7.0); float diff = max(dot(n, normalize(vec3(-0.45, 0.62, -0.55))), 0.0);
    float soap = step(0.72, hh(floor(pp) + 3.1)) * (1.0 - smoothstep(0.1, 0.5, v1.x));
    float mass = smoothstep(0.25, 0.62, fb4(pn * 1.6 + vec3(0.0, t * 0.25 * sp, t * 0.1 * sp)) + 0.22 - n.y * 0.3);
    vec3 foamC = mix(vec3(0.95, 0.96, 0.97), mix(COLS[3], vec3(1.0), 0.7), 0.2) * (0.82 + 0.18 * diff);
    float dome = sqrt(max(1.0 - pow(clamp(v1.x * 1.6, 0.0, 1.0), 2.0), 0.0)); float dome2 = sqrt(max(1.0 - pow(clamp(v2.x * 1.6, 0.0, 1.0), 2.0), 0.0));
    float pocket = 1.0 - smoothstep(0.0, 0.035, v1.y - v1.x); float spec = pow(clamp(1.0 - v1.x * 4.5, 0.0, 1.0), 5.0);
    vec3 c = foamC * (0.8 + 0.18 * dome + 0.06 * dome2) - vec3(0.1, 0.095, 0.085) * pocket * pocket + vec3(0.28) * spec + (thinFilm(0.8 + 0.2 * diff, 350.0 + 400.0 * v1.x) - 0.5) * 0.3 * soap;
    vec3 water = mix(col, mix(COLS[1], vec3(0.75, 0.85, 0.9), 0.5), 0.35);
    col = mix(water, c, clamp(mass * Lk.x, 0.0, 1.0)); }
  return col; }
/* ─── themed miniatures: ceramic collectibles modelled from signed distances, rounded edges, soft three-point studio light ─── */
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdRBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
float sdCapCone(vec3 p, float h, float r1, float r2) { vec2 q = vec2(length(p.xz), p.y); vec2 k1 = vec2(r2, h); vec2 k2 = vec2(r2 - r1, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r1 : r2), abs(q.y) - h); vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0; return s * sqrt(min(dot(ca, ca), dot(cb, cb))); }
float sdCyl(vec3 p, float h, float r) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdTorus(vec3 p, float R, float r) { return length(vec2(length(p.xz) - R, p.y)) - r; }
vec3 rotY(vec3 p, float a) { float c = cos(a); float s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
vec2 scMin(vec2 a, vec2 b) { return a.x < b.x ? a : b; }
/* a fir tree: scalloped tiers blended together, a short trunk */
vec2 firTree(vec3 p, float h, float seed) { float d = 1e5; float y = 0.05 * h;
  for (int i = 0; i < 5; i++) { float fi = float(i); float th = h * (0.14 - fi * 0.015); float r1 = h * (0.44 - fi * 0.075); vec3 q = p - vec3(0.0, y + th, 0.0);
    float sc = 1.0 + 0.08 * cos(atan(q.z, q.x) * 11.0 + fi * 1.3 + seed) * smoothstep(0.3 * th, -th, q.y);
    float c = sdCapCone(vec3(q.x / sc, q.y, q.z / sc), th, r1, r1 * 0.1) * 0.85; d = fi == 0.0 ? c : smin(d, c, 0.02 * h); y += th * 1.55; }
  return scMin(vec2(d, 2.0), vec2(sdCyl(p - vec3(0.0, 0.04 * h, 0.0), 0.05 * h, 0.05 * h), 3.0)); }
/* a wrapped gift: a rounded box, two satin ribbons, a bow of two loops */
vec2 gift(vec3 p, vec3 b, float a, float cid) { p = rotY(p, a); vec2 r = vec2(sdRBox(p, b, 0.008), 6.0 + cid);
  float rib = min(sdRBox(p, vec3(b.x + 0.002, b.y + 0.002, 0.012), 0.004), sdRBox(p, vec3(0.012, b.y + 0.002, b.z + 0.002), 0.004));
  vec3 bp = p - vec3(0.0, b.y + 0.012, 0.0); float bow = min(sdTorus(vec3(bp.x - 0.02, bp.y, bp.z).yxz, 0.018, 0.006), sdTorus(vec3(bp.x + 0.02, bp.y, bp.z).yxz, 0.018, 0.006));
  return scMin(r, vec2(min(rib, bow), 7.0)); }
/* a porcelain Santa figurine: a long coat, a white-trimmed hem, a belt, a round beard, a head and a hat with a pompom; no face, only form and glaze */
vec2 santa(vec3 p) { float coat = sdCapCone(p - vec3(0.0, 0.1, 0.0), 0.1, 0.075, 0.045); float head = length(p - vec3(0.0, 0.225, 0.0)) - 0.038;
  float beard = length((p - vec3(0.0, 0.2, -0.018)) * vec3(1.0, 1.25, 1.1)) - 0.04; float hat = sdCapCone(p - vec3(0.0, 0.29, 0.0), 0.045, 0.036, 0.004);
  float pom = length(p - vec3(0.0, 0.34, 0.0)) - 0.013; float hem = sdTorus(p - vec3(0.0, 0.01, 0.0), 0.072, 0.011); float belt = sdTorus(p - vec3(0.0, 0.12, 0.0), 0.058, 0.007);
  vec2 r = vec2(smin(coat, hat, 0.005), 8.0); r = scMin(r, vec2(head, 10.0)); r = scMin(r, vec2(min(min(beard, pom), hem), 9.0)); return scMin(r, vec2(belt, 3.0)); }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / k1; }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a; vec3 ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
/* a five-petalled blossom facing along +y, s its radius */
float blossom(vec3 p, float s) { float a = atan(p.z, p.x); float rr = length(p.xz); return max(rr - s * (0.55 + 0.45 * pow(abs(cos(a * 2.5)), 0.7)), abs(p.y - rr * rr * 2.0) - s * 0.2) * 0.7; }
/* a glazed tulip on its stem: a cup of three lobed petals, two long leaves */
vec2 tulip(vec3 p, float h, float lean, float cid) { vec3 top = vec3(lean, h, 0.0); float stem = sdCap(p, vec3(0.0), top, 0.008);
  vec3 q = p - top - vec3(0.0, 0.035, 0.0); float cup = 1e5;
  for (int k = 0; k < 6; k++) { float fk = float(k); float ang = fk * 2.0944 + (k > 2 ? 1.0472 : 0.0); vec3 pq = rotY(q, ang) - vec3(k > 2 ? 0.011 : 0.019, 0.0, 0.0);
    pq = vec3(pq.x * cos(0.2) - pq.y * sin(0.2), pq.x * sin(0.2) + pq.y * cos(0.2), pq.z); pq.x += 18.0 * pq.z * pq.z * 0.5; cup = min(cup, sdEll(pq, vec3(0.012, 0.052, 0.027) * (k > 2 ? 0.93 : 1.0))); }
  float leaf = 1e5; for (int k = 0; k < 2; k++) { float fk = float(k); vec3 lq = rotY(p, 0.5 + fk * 3.4) - vec3(0.02, 0.0, 0.0); float u = clamp(lq.y / (h * (0.62 - fk * 0.1)), 0.0, 1.0);
    lq.x -= 0.09 * u * u * h * 3.0; lq.x += 0.012 * (lq.z * lq.z) * 40.0; float w = 0.024 * sin(3.1416 * pow(u, 0.7)) * (1.0 - 0.3 * u) + 0.002;
    leaf = min(leaf, max(max(abs(lq.z) - w, abs(lq.x) - 0.0035), max(-lq.y, lq.y - h * (0.62 - fk * 0.1))) * 0.7); }
  return scMin(vec2(cup, 17.0 + cid * 0.9), vec2(min(stem, leaf), 18.0)); }
/* a ribbed pumpkin with a short stem; hollow and carved when lantern is on (almond eyes, a crescent smile) */
vec2 pumpkin(vec3 p, float rr, float lantern, float cid) { float a = atan(p.z, p.x); float rib = 1.0 - 0.06 * (1.0 - abs(cos(a * 5.0)));
  float d = (length(p / vec3(1.0, 0.78, 1.0)) - rr * rib) * 0.75; float stem = sdCap(p, vec3(0.0, rr * 0.7, 0.0), vec3(0.02 * rr, rr * 1.05, 0.0), rr * 0.09);
  vec2 res = vec2(d, 25.0 + cid * 0.9);
  if (lantern > 0.5) { float din = d + rr * 0.1; float sh = max(d, -din); vec2 f = vec2(p.x, p.y) / rr;
    vec2 e1 = f - vec2(-0.36, 0.18); vec2 e2 = f - vec2(0.36, 0.18); float eye = min(length(e1 * vec2(1.0, 1.9)) - 0.17, length(e2 * vec2(1.0, 1.9)) - 0.17);
    float mouth = max(length(f - vec2(0.0, 0.05)) - 0.55, -(length(f - vec2(0.0, 0.28)) - 0.6)); mouth = max(mouth, abs(f.x) - 0.52);
    float face = max(min(eye, mouth) * rr, p.z); sh = max(sh, -face);
    res = vec2(sh, (din < 0.004 && length(p) < rr * 0.93) ? 27.0 : 25.0 + cid * 0.9); }
  return scMin(res, vec2(stem, 26.0)); }
/* a scallop shell: a fan with radiating ribs; a starfish: five rounded arms */
float scallop(vec3 p, float s) { float a = atan(p.x, -p.z); float rr = length(p.xz); float fan = max(rr - s * (0.95 + 0.05 * cos(a * 18.0)), abs(a) - 1.15);
  return max(fan, abs(p.y - 0.004 * cos(a * 18.0) - rr * 0.25) - s * 0.08) * 0.7; }
float starfish(vec3 p, float s) { float a = atan(p.z, p.x); float rr = length(p.xz); float arm = rr - s * (0.35 + 0.65 * pow(abs(cos(a * 2.5)), 3.0)); return max(arm, abs(p.y) - s * 0.12 * (1.0 - rr / s * 0.6)) * 0.7; }
/* a small deciduous tree: trunk, two limbs and a rounded canopy of bumpy blobs */
vec2 fallTree(vec3 p, float h, float sd) { float tr = min(sdCap(p, vec3(0.0), vec3(0.0, h * 0.55, 0.0), 0.03 * h * 1.3), min(sdCap(p, vec3(0.0, h * 0.35, 0.0), vec3(-0.18 * h, h * 0.62, 0.02), 0.018 * h * 1.3), sdCap(p, vec3(0.0, h * 0.42, 0.0), vec3(0.17 * h, h * 0.66, -0.03), 0.016 * h * 1.3)));
  float can = 1e5; for (int i = 0; i < 11; i++) { float fi = float(i); float ang = fi * 2.4 + sd * 4.0; float rr = 0.1 + 0.12 * fract(fi * 0.618); vec3 c = vec3(cos(ang) * rr * h * 1.4, h * (0.66 + 0.22 * fract(fi * 0.43 + 0.2)), sin(ang) * rr * h); can = smin(can, length(p - c) - h * (0.1 + 0.035 * hh(vec3(fi, sd, 3.0))), 0.035 * h); }
  can += (fb4(p * 34.0) - 0.5) * 0.035 + (fb4(p * 80.0) - 0.5) * 0.012; return scMin(vec2(tr, 23.0), vec2(can * 0.8, 24.0)); }
/* wheat: a thin curved stalk and a grain head */
float wheat(vec3 p, float h, float lean) { vec3 top = vec3(lean, h, 0.0); float st = sdCap(p, vec3(0.0), top, 0.004); vec3 hq = p - top - vec3(lean * 0.2, 0.045, 0.0);
  float head = sdEll(hq, vec3(0.014, 0.05, 0.014)) + 0.003 * sin(hq.y * 160.0) * step(abs(hq.y), 0.05); return min(st, head * 0.8); }
/* the scenes: 0 Christmas, 1 Easter with cherry blossoms, 2 Spring, 3 Summer, 4 Autumn, 5 Winter, 6 Halloween, 7 Thanksgiving */
vec2 sceneSD(vec3 pw, float sid, float t) { float sd = P0.z; float ct = cos(0.36); float st0 = sin(0.36); vec3 p = vec3(pw.x, pw.y * ct - pw.z * st0, pw.y * st0 + pw.z * ct);
  if (sid > 7.5) { float d = 1e5; for (int i = 0; i < 6; i++) { float fi = float(i); vec3 c = vec3(sin(t * 0.37 + fi * 2.1 + sd * 4.0) * 0.36, sin(t * 0.29 + fi * 1.3) * 0.3 - 0.05, cos(t * 0.33 + fi * 1.7 + sd) * 0.26);
      d = smin(d, length(pw - c) - (0.1 + 0.08 * hh(vec3(fi, sd, 5.0))), 0.14); } return vec2(d, 33.0); }
  if (sid > 2.5 && sid < 3.5) {
    float g = p.y + 0.34 - 0.07 * (1.0 - dot(p.xz, p.xz)) - 0.012 * sin(p.x * 9.0 + sd * 5.0) * cos(p.z * 7.0); float sea = p.y + 0.3; float shore = smoothstep(0.02, 0.16, p.z - 0.05 * sin(p.x * 6.0 + t * 0.8));
    vec2 r = vec2(max(mix(g, sea, shore), length(pw) - 0.93), shore > 0.55 ? 22.0 : 19.0);
    vec3 up = p - vec3(-0.08 + (hh(vec3(sd, 2.0, 1.0)) - 0.5) * 0.1, -0.29, -0.02); r = scMin(r, vec2(sdCap(up, vec3(0.0), vec3(0.02, 0.5, 0.0), 0.009), 3.0));
    vec3 cq = up - vec3(0.02, 0.5, 0.0); cq = vec3(cq.x * cos(0.38) + cq.y * sin(0.38), -cq.x * sin(0.38) + cq.y * cos(0.38), cq.z); float can = max(sdCapCone(cq - vec3(0.0, -0.04, 0.0), 0.05, 0.34, 0.02), -sdCapCone(cq - vec3(0.0, -0.058, 0.0), 0.05, 0.34, 0.02)); r = scMin(r, vec2(can * 0.8, 20.0));
    r = scMin(r, vec2(scallop(rotY(p - vec3(0.24, -0.255, -0.22), 0.4 + sd), 0.12), 21.0)); r = scMin(r, vec2(starfish(rotY(p - vec3(-0.3, -0.27, -0.26), sd * 3.0), 0.11), 21.5));
    return r; }
  if (sid > 3.5 && sid < 4.5) {
    vec2 r = vec2(max(p.y + 0.34 - 0.07 * (1.0 - dot(p.xz, p.xz)) - 0.015 * fb4(p * 18.0), length(pw) - 0.93), 12.5);
    vec2 tr = fallTree((p - vec3(0.0, -0.3, 0.08)) / 1.25, 0.8, sd); r = scMin(r, vec2(tr.x * 1.25, tr.y)); return r; }
  if (sid > 5.5 && sid < 6.5) {
    vec2 r = vec2(max(p.y + 0.34 - 0.07 * (1.0 - dot(p.xz, p.xz)) - 0.02 * sin(p.x * 5.0 + sd * 6.0) * cos(p.z * 4.0), length(pw) - 0.93), 12.5);
    r = scMin(r, pumpkin(p - vec3(0.02, -0.15, -0.08), 0.21, 1.0, 0.1));
    vec3 tp = p - vec3(-0.34, -0.3, 0.18); float br = min(sdCap(tp, vec3(0.0), vec3(0.04, 0.55, 0.0), 0.022), min(sdCap(tp, vec3(0.03, 0.34, 0.0), vec3(0.26, 0.58, -0.05), 0.012), sdCap(tp, vec3(0.035, 0.44, 0.0), vec3(-0.14, 0.68, 0.04), 0.01)));
    br = min(br, min(sdCap(tp, vec3(0.2, 0.52, -0.04), vec3(0.34, 0.56, -0.06), 0.006), sdCap(tp, vec3(0.04, 0.55, 0.0), vec3(0.1, 0.74, 0.0), 0.008)));
    return scMin(r, vec2(br, 23.0)); }
  if (sid > 6.5) {
    vec2 r = vec2(max(sdRBox(p - vec3(0.0, -0.4, 0.0), vec3(0.62, 0.08, 0.5), 0.03), length(pw) - 0.93), 29.0);
    r = scMin(r, pumpkin(p - vec3(-0.1, -0.17, 0.05), 0.19, 0.0, 0.05)); r = scMin(r, pumpkin(p - vec3(0.2, -0.235, -0.12), 0.12, 0.0, 0.55)); r = scMin(r, pumpkin(p - vec3(-0.34, -0.27, -0.16), 0.075, 0.0, 0.85));
    r = scMin(r, vec2(sdEll(rotY(p - vec3(0.06, -0.285, -0.3), 0.8) , vec3(0.07, 0.035, 0.035)) * 0.8, 32.0));
    float wh = 1e5; for (int i = 0; i < 6; i++) { float fi = float(i); wh = min(wh, wheat(p - vec3(0.34 + fi * 0.02, -0.32, 0.12 - fi * 0.015), 0.34 + 0.06 * fract(fi * 0.53), (fi - 2.5) * 0.03)); } r = scMin(r, vec2(wh, 28.0));
    vec3 cp = p - vec3(0.36, -0.32, -0.16); r = scMin(r, vec2(sdCyl(cp - vec3(0.0, 0.07, 0.0), 0.07, 0.03), 30.0)); r = scMin(r, vec2(sdEll(cp - vec3(0.0, 0.175, 0.0), vec3(0.012, 0.028, 0.012)), 31.0));
    return r; }
  if (sid > 0.5 && sid < 2.5) {
    vec2 r = vec2(max(p.y + 0.34 - 0.07 * (1.0 - dot(p.xz, p.xz)) - 0.015 * sin(p.x * 7.0 + sd * 6.0) * cos(p.z * 6.0), length(pw) - 0.93), 12.0);
    if (sid < 1.5) {
      vec3 np = (p - vec3(0.0, -0.25, 0.04)) / 1.7; vec3 nq = vec3(np.x, np.y * 1.6, np.z); float nest = smin(sdTorus(nq, 0.17, 0.06), sdCyl(np - vec3(0.0, -0.01, 0.0), 0.02, 0.17), 0.03) * 1.7;
      r = scMin(r, vec2(nest * 0.8, 13.0));
      for (int i = 0; i < 4; i++) { float fi = float(i); float ang = fi * 1.9 + sd * 4.0; vec3 ep = np - vec3(cos(ang) * 0.075 * step(0.5, fi), 0.06, sin(ang) * 0.075 * step(0.5, fi));
        ep = rotY(ep, ang); ep = vec3(ep.x, ep.y * cos(0.5) - ep.z * sin(0.5) * (fi > 0.5 ? 1.0 : 0.0), ep.z);
        r = scMin(r, vec2(sdEll(ep, vec3(0.052, 0.07, 0.052)) * 1.7, 14.0 + fract(fi * 0.29 + sd) * 0.9)); }
      vec3 b0 = vec3(-0.66, 0.2, 0.05); vec3 b1 = vec3(-0.3, 0.36, 0.0); vec3 b2 = vec3(0.12, 0.4, -0.05); vec3 b3 = vec3(0.52, 0.26, -0.1);
      float br = min(min(sdCap(p, b0, b1, 0.022), sdCap(p, b1, b2, 0.017)), min(sdCap(p, b2, b3, 0.012), sdCap(p, b1, b1 + vec3(0.05, 0.14, -0.05), 0.009)));
      r = scMin(r, vec2(br, 15.0));
      for (int i = 0; i < 16; i++) { float fi = float(i); float u = fract(fi * 0.0617 + 0.03); vec3 bp = u < 0.33 ? mix(b0, b1, u * 3.0) : (u < 0.66 ? mix(b1, b2, u * 3.0 - 1.0) : mix(b2, b3, u * 3.0 - 2.0));
        bp += vec3(0.0, 0.035, 0.0) + (vec3(hh(vec3(fi, 1.0, sd)), hh(vec3(fi, 2.0, sd)), hh(vec3(fi, 3.0, sd))) - 0.5) * vec3(0.04, 0.03, 0.06);
        vec3 lp = p - bp; lp = vec3(lp.x, lp.y * cos(0.5) + lp.z * sin(0.5), -lp.y * sin(0.5) + lp.z * cos(0.5)); r = scMin(r, vec2(blossom(rotY(lp, fi * 1.3), 0.055 + 0.02 * hh(vec3(fi, 4.0, sd))), 16.0)); }
      return r; }
    for (int i = 0; i < 7; i++) { float fi = float(i); float ang = fi * 2.4 + sd * 3.0; float rad = 0.03 + 0.16 * fract(fi * 0.618 + sd); vec3 tp = (p - vec3(cos(ang) * rad, -0.28, sin(ang) * rad * 0.8)) / 1.55;
      vec2 tl = tulip(tp, 0.26 + 0.1 * fract(fi * 0.43 + sd), (hh(vec3(fi, 7.0, sd)) - 0.5) * 0.08, fract(fi * 0.31 + sd)); r = scMin(r, vec2(tl.x * 1.55, tl.y)); }
    return r; }
  if (sid < 0.5) {
    vec2 r = vec2(max(p.y + 0.34 - 0.07 * (1.0 - dot(p.xz, p.xz)) - 0.02 * sin(p.x * 5.0 + sd * 6.0) * cos(p.z * 4.0), length(pw) - 0.93), 1.0);
    vec3 tp = p - vec3(-0.04 + (hh(vec3(sd, 1.0, 2.0)) - 0.5) * 0.12, -0.28, 0.1); r = scMin(r, firTree(tp, 0.82, sd * 9.0));
    vec3 sp = tp - vec3(0.0, 0.74, 0.0); r = scMin(r, vec2((abs(sp.x) + abs(sp.y) * 0.8 + abs(sp.z) - 0.055) * 0.57, 4.0));
    for (int i = 0; i < 16; i++) { float fi = float(i); float hy = 0.1 + fi * 0.036; float rad = 0.36 * (1.0 - hy / 0.8) + 0.006; float ang = fi * 1.9 + sd * 3.0; r = scMin(r, vec2(length(tp - vec3(cos(ang) * rad, hy, sin(ang) * rad)) - 0.009, 11.0)); }
    for (int i = 0; i < 8; i++) { float fi = float(i); float hy = 0.1 + fi * 0.07; float rad = 0.36 * (1.0 - hy / 0.8) + 0.018; float ang = fi * 2.39 + sd * 5.0;
      r = scMin(r, vec2(length(tp - vec3(cos(ang) * rad, hy, sin(ang) * rad)) - 0.03, 5.0 + fract(fi * 0.37 + sd) * 0.9)); }
    r = scMin(r, gift(p - vec3(0.3, -0.3 + 0.075, -0.1), vec3(0.075), 0.5 + sd, 0.2));
    r = scMin(r, gift(p - vec3(0.2, -0.3 + 0.05, -0.3), vec3(0.06, 0.05, 0.05), -0.3, 0.6));
    r = scMin(r, gift(p - vec3(-0.3, -0.3 + 0.045, -0.3), vec3(0.05, 0.045, 0.07), 0.8, 0.85));
    return scMin(r, santa(rotY(p - vec3(-0.34, -0.3, -0.06), 0.5))); }
  vec2 r = vec2(max(p.y + 0.3 - 0.07 * sin(p.x * 2.6 + sd * 5.0) * cos(p.z * 2.1 + 1.0) - 0.03 * sin(p.x * 7.0), length(pw) - 0.93), 1.0);
  for (int i = 0; i < 7; i++) { float fi = float(i); float ang = fi * 2.1 + sd * 3.0; float rad = 0.2 + 0.45 * fract(fi * 0.618 + sd); vec3 bp = vec3(cos(ang) * rad, 0.0, sin(ang) * rad * 0.8);
    float gy = -0.3 + 0.07 * sin(bp.x * 2.6 + sd * 5.0) * cos(bp.z * 2.1 + 1.0) + 0.03 * sin(bp.x * 7.0); float th = 0.34 + 0.34 * fract(fi * 0.43 + sd * 2.0);
    if (length(bp) < 0.75) r = scMin(r, firTree(p - vec3(bp.x, gy - 0.01, bp.z), th, fi + sd)); }
  vec3 cp = rotY(p - vec3(0.22, -0.27, -0.2), 0.6); float cabin = sdRBox(cp - vec3(0.0, 0.06, 0.0), vec3(0.09, 0.06, 0.07), 0.008);
  float roof = max(max(abs(cp.z) - 0.085, -(cp.y - 0.12)), (abs(cp.x) * 0.8 + (cp.y - 0.12)) - 0.08);
  r = scMin(r, vec2(cabin, 3.0)); r = scMin(r, vec2(roof * 0.8, 1.0));
  float win = sdRBox(cp - vec3(0.0, 0.06, -0.071), vec3(0.025, 0.022, 0.003), 0.003); return scMin(r, vec2(win, 11.0)); }
float scSoft(vec3 ro, vec3 rd, float sid, float t) { float res = 1.0; float tt = 0.012; for (int i = 0; i < 20; i++) { float h = sceneSD(ro + rd * tt, sid, t).x; res = min(res, 10.0 * h / tt); tt += clamp(h, 0.01, 0.08); if (res < 0.02 || tt > 1.6) break; } return clamp(res, 0.0, 1.0); }
float scAO(vec3 p, vec3 n, float sid, float t) { float o = 0.0; float w = 1.0; for (int i = 1; i <= 5; i++) { float h = 0.015 * float(i); o += (h - sceneSD(p + n * h, sid, t).x) * w; w *= 0.7; } return clamp(1.0 - o * 7.0, 0.0, 1.0); }
/* ceramic shading: a large key light above left, a fill at half strength from the right, soft shadows, contact occlusion, broad glaze highlights */
vec3 scShade(vec3 p, vec3 n, vec3 rd, float mid, float sid, float t) {
  if (mid > 32.5) { vec3 rv = reflect(rd, n); vec2 uvR = clamp(gl_FragCoord.xy / uRes + vec2(rv.x, rv.y) * 0.22, vec2(0.002), vec2(0.998)); vec3 world = texture(uBack, uvR).rgb;
    vec3 env = mix(world * 1.04, vec3(1.0), smoothstep(0.3, 0.92, rv.y) * 0.9) + vec3(1.0, 0.98, 0.95) * smoothstep(0.72, 0.95, rv.x) * smoothstep(-0.2, 0.3, rv.y) * 0.55;
    env = mix(env, world * vec3(0.26, 0.25, 0.24), smoothstep(-0.06, -0.6, rv.y)); float cv = max(dot(n, -rd), 0.0);
    vec3 F0 = mix(vec3(0.78, 0.78, 0.77), mix(DOM, vec3(1.0), 0.5), 0.12); return min((F0 + (vec3(1.0) - F0) * pow(1.0 - cv, 5.0)) * env, vec3(1.0)); }
  vec3 alb = vec3(0.9); float rough = 0.6; float metal = 0.0; vec3 emis = vec3(0.0);
  if (mid < 1.5) { alb = vec3(0.94, 0.95, 0.97); rough = 0.85; }
  else if (mid < 2.5) { alb = mix(vec3(0.05, 0.19, 0.12), mix(COLS[0], vec3(0.05, 0.2, 0.12), 0.7), 0.3); rough = 0.55; alb = mix(alb, vec3(0.94, 0.95, 0.97), smoothstep(0.55, 0.85, n.y) * (sid > 4.5 && sid < 5.5 ? 1.0 : 0.35)); }
  else if (mid < 3.5) { alb = vec3(0.32, 0.19, 0.11); rough = 0.7; }
  else if (mid < 4.5) { alb = vec3(1.0, 0.78, 0.42); rough = 0.25; metal = 1.0; }
  else if (mid < 5.95) { alb = palRamp(fract(mid) * 1.1); rough = 0.18; metal = 0.35; }
  else if (mid < 6.95) { alb = mix(palRamp(fract(mid)), vec3(0.95), 0.25); rough = 0.65; }
  else if (mid < 7.5) { alb = vec3(0.96, 0.86, 0.62); rough = 0.3; metal = 0.6; }
  else if (mid < 8.5) { alb = mix(vec3(0.55, 0.05, 0.07), DOM * 0.8, 0.15); rough = 0.45; }
  else if (mid < 9.5) { alb = vec3(0.95, 0.94, 0.92); rough = 0.75; }
  else if (mid < 10.5) { alb = vec3(0.86, 0.66, 0.56); rough = 0.6; }
  else if (mid < 11.5) { alb = vec3(1.0, 0.72, 0.38); emis = vec3(1.0, 0.7, 0.35) * 1.4; }
  else if (mid < 12.25) { alb = mix(vec3(0.46, 0.52, 0.38), vec3(0.56, 0.6, 0.45), fb4(p * 38.0)) * (0.9 + 0.1 * fb4(p * 120.0)); rough = 0.95; }
  else if (mid < 12.75) { float lf = smoothstep(0.3, 0.72, fb4(p * 6.5)); alb = mix(vec3(0.34, 0.29, 0.22), mix(vec3(0.74, 0.36, 0.13), mix(palRamp(0.7), vec3(0.82, 0.52, 0.16), 0.5), fb4(p * 4.5 + 3.0)), lf) * (0.92 + 0.08 * fb4(p * 60.0)) * (sid > 5.5 ? 0.6 : 1.0); rough = 0.9; }
  else if (mid < 13.5) { alb = mix(vec3(0.62, 0.48, 0.28), vec3(0.8, 0.66, 0.42), smoothstep(0.35, 0.65, fb4(vec3(atan(p.z, p.x) * 6.0, p.y * 40.0, length(p.xz) * 30.0)))); rough = 0.85; }
  else if (mid < 14.95) { alb = mix(palRamp(0.35 + fract(mid) * 0.65), vec3(0.97, 0.95, 0.92), 0.35); rough = 0.22; if (fract(mid) > 0.6 && abs(p.y - 0.02) < 0.008) { alb = vec3(1.0, 0.78, 0.42); metal = 1.0; } }
  else if (mid < 15.5) { alb = vec3(0.2, 0.13, 0.1); rough = 0.75; }
  else if (mid < 16.5) { alb = mix(vec3(1.0, 0.78, 0.86), mix(palRamp(0.85), vec3(1.0), 0.4), 0.25); rough = 0.55; emis = alb * 0.1; }
  else if (mid < 17.95) { alb = mix(palRamp(0.2 + fract(mid) * 0.8), vec3(1.0), 0.12); rough = 0.2; }
  else if (mid < 18.5) { alb = vec3(0.24, 0.42, 0.22); rough = 0.6; }
  else if (mid < 19.5) { alb = mix(vec3(0.86, 0.75, 0.58), vec3(0.93, 0.85, 0.7), fb4(p * 40.0)); rough = 0.95; }
  else if (mid < 20.5) { vec3 lp3 = vec3(p.x, p.y * cos(0.36) - p.z * sin(0.36), p.y * sin(0.36) + p.z * cos(0.36)); float stp = smoothstep(0.46, 0.54, fract(atan(lp3.z + 0.02, lp3.x + 0.06) * 8.0 / 6.2832)); alb = mix(vec3(0.96, 0.95, 0.92), mix(palRamp(0.3), DOM, 0.5), stp); rough = 0.5; }
  else if (mid < 21.25) { alb = mix(vec3(0.97, 0.9, 0.84), palRamp(0.85), 0.2); rough = 0.3; }
  else if (mid < 21.75) { alb = mix(vec3(0.9, 0.55, 0.38), palRamp(0.6), 0.3); rough = 0.6; }
  else if (mid < 22.5) { alb = mix(vec3(0.1, 0.42, 0.5), mix(COLS[1], COLS[2], 0.5), 0.3) * (0.85 + 0.3 * fb4(vec3(p.x * 14.0, p.z * 30.0, t * 0.4))); rough = 0.08; n = normalize(n + (vec3(fb4(p * 26.0 + vec3(t * 0.3, 0.0, 0.0)), 0.0, fb4(p * 26.0 + vec3(4.0, 0.0, t * 0.3))) - vec3(0.5, 0.0, 0.5)) * 0.5); }
  else if (mid < 23.5) { alb = vec3(0.24, 0.16, 0.11); rough = 0.8; }
  else if (mid < 24.5) { alb = mix(mix(vec3(0.78, 0.36, 0.12), vec3(0.62, 0.16, 0.08), fb4(p * 9.0)), mix(palRamp(0.7), vec3(0.85, 0.5, 0.15), 0.6), 0.35); rough = 0.65; }
  else if (mid < 25.95) { alb = mix(vec3(0.86, 0.45, 0.13), mix(palRamp(fract(mid)), vec3(0.93, 0.88, 0.76), step(0.5, fract(mid)) * step(fract(mid), 0.7)), fract(mid) > 0.5 ? 0.8 : 0.2); rough = 0.45; }
  else if (mid < 26.5) { alb = vec3(0.3, 0.3, 0.16); rough = 0.8; }
  else if (mid < 27.5) { alb = vec3(1.0, 0.6, 0.2); emis = vec3(1.0, 0.55, 0.18) * 2.2; }
  else if (mid < 28.5) { alb = vec3(0.86, 0.7, 0.4); rough = 0.7; }
  else if (mid < 29.5) { alb = mix(vec3(0.36, 0.22, 0.13), vec3(0.46, 0.3, 0.18), smoothstep(0.4, 0.6, fb4(vec3(p.x * 4.0, p.y * 40.0, p.z * 4.0) + vec3(fb4(p * 6.0))))); rough = 0.55; }
  else if (mid < 30.5) { alb = vec3(0.95, 0.9, 0.8); rough = 0.5; emis = vec3(0.35, 0.2, 0.08) * smoothstep(0.1, 0.16, p.y + 0.32 - 0.0); }
  else if (mid < 31.5) { alb = vec3(1.0, 0.8, 0.45); emis = vec3(1.0, 0.72, 0.32) * 3.0; }
  else { alb = mix(vec3(0.62, 0.66, 0.36), palRamp(0.5), 0.3); rough = 0.4; }
  vec3 L1 = normalize(vec3(-0.55, 0.75, -0.4)); vec3 L2 = normalize(vec3(0.65, 0.35, -0.55)); float sh = scSoft(p + n * 0.006, L1, sid, t); float ao = scAO(p, n, sid, t);
  bool night = sid > 4.5 && sid < 6.5; vec3 kc = night ? (sid > 5.5 ? vec3(0.62, 0.55, 0.95) * 0.55 : vec3(0.62, 0.72, 1.0) * 0.8) : (sid > 6.5 ? vec3(1.0, 0.88, 0.7) : vec3(1.0, 0.96, 0.9)); vec3 fc = night ? vec3(0.3, 0.3, 0.5) : vec3(0.85, 0.9, 1.0);
  float d1 = max(dot(n, L1), 0.0) * sh; float d2 = max(dot(n, L2), 0.0); float amb = 0.5 + 0.5 * n.y;
  vec3 col = alb * (kc * d1 * 1.05 + fc * d2 * 0.42 + fc * amb * ao * 0.42) * (1.0 - metal * 0.6);
  vec3 H = normalize(L1 - rd); float gl = pow(max(dot(n, H), 0.0), mix(12.0, 140.0, 1.0 - rough)) * (1.0 - rough) * sh;
  col += gl * mix(vec3(0.3), alb, metal) * kc * 1.3; col += metal * alb * (0.25 + 0.5 * pow(1.0 - max(dot(n, -rd), 0.0), 2.0)) * ao;
  col += pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * 0.07 * ao; col += emis;
  if (sid > 5.5 && sid < 6.5 && mid < 26.5) { vec3 lp = vec3(0.02, -0.15, -0.08); vec3 ct3 = vec3(p.x, p.y * cos(0.36) - p.z * sin(0.36), p.y * sin(0.36) + p.z * cos(0.36)); vec3 dl = lp - ct3; float dd = dot(dl, dl); col += alb * vec3(1.0, 0.55, 0.2) * max(dot(n, normalize(dl)), 0.0) * 0.5 / (1.0 + dd * 30.0) * (0.85 + 0.15 * sin(t * 9.0)); }
  if (sid > 6.5 && mid < 30.5) { vec3 lp = vec3(0.36, -0.15, -0.16); vec3 ct3 = vec3(p.x, p.y * cos(0.36) - p.z * sin(0.36), p.y * sin(0.36) + p.z * cos(0.36)); vec3 dl = lp - ct3; float dd = dot(dl, dl); col += alb * vec3(1.0, 0.7, 0.35) * max(dot(n, normalize(dl)), 0.0) * 0.35 / (1.0 + dd * 25.0); }
  if (mid < 1.5) { col += vec3(1.0) * step(0.985, hh(floor(p * 160.0))) * smoothstep(0.5, 0.15, length(fract(p * 160.0) - 0.5)) * sh * 0.4; col += alb * (sid > 4.5 ? vec3(0.16, 0.2, 0.32) : vec3(0.42, 0.44, 0.5)) * (1.0 - smoothstep(-0.4, 0.4, n.y)); }
  if ((mid > 11.5 && mid < 12.75) || (mid > 18.5 && mid < 19.5)) col += alb * (night ? vec3(0.14, 0.12, 0.2) : vec3(0.5, 0.52, 0.5)) * (1.0 - smoothstep(-0.4, 0.4, n.y));
  return col; }
/* the miniature: traced from the glass inward; returns its colour and the distance where it was met (or far away) */
float gSceneA = 1.0;
vec4 sceneRender(vec3 pin, vec3 rdi, float tex, float sid, float t) {
  float tt = 0.0; vec2 h = vec2(1.0, 0.0); bool hit = false; float px = abs(SLO.w); bool aa = SLO.w > 0.0; float dmin = 1e5; float tmin = 0.0; vec2 hmin = vec2(1.0, 0.0);
  for (int i = 0; i < 90; i++) { h = sceneSD(pin + rdi * tt, sid, t); if (h.x < dmin) { dmin = h.x; tmin = tt; hmin = h; } if (h.x < 0.0008) { hit = true; break; } tt += h.x * 0.9; if (tt > tex) break; }
  gSceneA = 1.0;
  if (!hit) { if (!aa || dmin > px * 1.5) return vec4(0.0, 0.0, 0.0, 1e5); gSceneA = 1.0 - dmin / (px * 1.5); tt = tmin; h = hmin; }
  vec3 p = pin + rdi * tt; vec2 e = vec2(0.0015, 0.0);
  vec3 n = normalize(vec3(sceneSD(p + e.xyy, sid, t).x - sceneSD(p - e.xyy, sid, t).x, sceneSD(p + e.yxy, sid, t).x - sceneSD(p - e.yxy, sid, t).x, sceneSD(p + e.yyx, sid, t).x - sceneSD(p - e.yyx, sid, t).x));
  return vec4(scShade(p, n, rdi, h.y, sid, t), hit ? tt : 1e4); }
/* opal: a milky, faintly blue glossy stone turning slowly; domains of ordered silica spheres each diffract one pure spectral colour toward the
   viewer, set by their spacing and the viewing angle, so the patches of colour shift as the stone turns */
vec3 opalOver(vec3 col, vec2 q, float r, float z, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 20.5 && Lk.w < 21.5)) continue;
    float sp = Lk.y; vec3 n = vec3(q.x, -q.y, -z); float an = t * 0.1 * sp; vec3 nr = vec3(n.x * cos(an) + n.z * sin(an), n.y, -n.x * sin(an) + n.z * cos(an));
    vec3 pp = nr * 4.0 * Lk.z + vec3(P0.z * 3.7, 0.0, P0.z * 2.1); float dom = fb4(pp * 0.9); float fire = (1.0 + P1.x * 0.8) * pow(smoothstep(0.38, 0.72, fb4(pp * 0.85 + 3.0)), 1.3) * (0.6 + 0.4 * fb4(pp * 2.2 + vec3(0.0, 0.0, an * 3.0)));
    float hue = fract(dom * 1.6 + dot(nr, vec3(0.3, 0.5, -0.8)) * 1.3);
    vec3 body = mix(vec3(0.86, 0.88, 0.92), mix(COLS[4], COLS[1], 0.3), 0.22) * (0.85 + 0.15 * fb4(pp * 2.0));
    vec3 play = mix(0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67))), vec3(1.0), 0.08) * 1.05; vec3 c = mix(body, play, fire * 0.82 * Lk.x);
    vec3 L = normalize(vec3(-0.45, 0.62, -0.55)); vec3 H = normalize(L + vec3(0.0, 0.0, -1.0)); c += vec3(1.0) * pow(max(dot(n, H), 0.0), 60.0) * 0.6 + vec3(1.0) * pow(1.0 - z, 3.0) * 0.12;
    col = c; }
  return col; }
/* golden-hour pollen: soft out-of-focus motes at three depths drifting in low sun, glowing where the backlight catches them; soft shafts of light
   falling through the glass from the upper right */
vec3 pollenOver(vec3 col, vec2 q, float r, float t) {
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!(Lk.w > 22.5 && Lk.w < 23.5)) continue;
    float sp = Lk.y; float px = abs(SLO.w); vec2 P = vec2(q.x, -q.y); vec2 L = vec2(0.95, 1.05); vec2 dl = P - L; float ang = atan(dl.y, dl.x);
    float shafts = smoothstep(0.35, 0.8, fb4(vec3(ang * 9.0, t * 0.04 * sp, 1.0))) * exp(-length(dl) * 0.9);
    vec3 warm = mix(vec3(1.0, 0.78, 0.42), palRamp(0.8), 0.25); col = mix(col, col * vec3(1.02, 0.96, 0.88) + warm * 0.08, 0.6) + warm * shafts * 0.55 * Lk.x;
    for (int j = 0; j < 3; j++) { float fj = float(j); float cs = 0.16 - fj * 0.04; vec2 mv = vec2(t * (0.02 + fj * 0.01) * sp + sin(t * 0.3 + fj) * 0.05, -t * (0.015 + fj * 0.006) * sp) + vec2(P0.z * 3.0, fj * 5.1);
      vec2 g = (P + mv) / cs; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float h = hh(vec3(id, fj + 20.0)); if (h < 0.88) continue;
      vec2 o = (vec2(hh(vec3(id, fj + 21.3)), hh(vec3(id, fj + 22.7))) - 0.5) * 0.5; float rad = (0.08 + 0.12 * hh(vec3(id, fj + 23.1))) * (1.0 + (2.0 - fj) * 0.35);
      float d = length(f - o) * cs; float soft = max(px * 1.5, rad * cs * (0.15 + (2.0 - fj) * 0.3));
      float disc = smoothstep(rad * cs + soft, rad * cs - soft, d); float back = 0.5 + 0.5 * smoothstep(1.4, 0.3, length(P + mv * 0.0 - L));
      col += warm * disc * (0.3 + 0.7 * back) * (0.32 + 0.16 * fj) * Lk.x * (1.0 + P1.x * 1.3) * smoothstep(1.0, 0.9, r); } }
  return col; }
/* thin-film interference colours, as on holographic foil */
vec3 spectral(float h) { return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67))); }
/* plasma: the classic plasma globe; luminous tendrils arc from a glowing core to the glass, wandering and flickering */
vec4 plasmaAt(vec3 p, float t) {
  float sp = LY.y; float g = 0.0; float rp = length(p);
  for (int k = 0; k < 6; k++) { float fk = float(k) + P0.z * 3.0;
    vec3 dk = normalize(vec3(sin(fk * 2.1 + t * 0.23 * sp) + 0.4 * sin(t * 0.61 * sp + fk), cos(fk * 1.7 + t * 0.19 * sp), sin(fk * 3.3 + t * 0.17 * sp) * 0.8));
    float al = dot(p, dk); vec3 pe = p - dk * al; float wig = (on3(vec3(al * 5.0 * LY.z, fk * 3.1, t * 1.6 * sp)) - 0.5) * 0.14 * al;
    float dist = length(pe) - abs(wig); float fl = 0.75 + 0.25 * sin(t * 13.0 * sp + fk * 5.0);
    g += exp(-dist * dist * 900.0) * smoothstep(-0.02, 0.1, al) * smoothstep(1.02, 0.85, al) * fl + exp(-dist * dist * 120.0) * 0.12 * smoothstep(0.0, 0.1, al) * smoothstep(1.02, 0.85, al); }
  g += exp(-rp * rp * 28.0) * 2.2;
  return vec4(mix(DOM, vec3(1.0), 0.25) * 1.5, g * 6.0 * LY.x); }
/* lava: molten rock churning slowly; a dark crust split by glowing cracks, with bright molten flows welling through */
vec4 lavaAt(vec3 p, float t) {
  float sp = LY.y; vec3 q = p * 1.6 * LY.z + vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1); q.y += t * 0.05 * sp;
  vec3 w = vec3(fb4(q * 0.7 + vec3(0.0, 0.0, t * 0.03 * sp)), fb4(q * 0.7 + 4.1), fb4(q * 0.7 + 8.3)) - 0.5; vec3 qw = q + w * 1.6;
  float cr = 1.0 - abs(2.0 * fb4(qw * 2.2) - 1.0); float crack = pow(cr, 9.0); float flow = smoothstep(0.62, 0.85, fb4(qw * 0.9 + vec3(0.0, -t * 0.06 * sp, 0.0)));
  float heat = clamp(crack * 1.3 + flow, 0.0, 1.0);
  vec3 crust = mix(COLS[0] * 0.35, vec3(0.08, 0.05, 0.05), 0.5); vec3 glow = mix(flame(0.55 + heat * 0.45), palRamp(0.8), 0.15) * (1.2 + 2.2 * heat);
  return vec4(mix(crust, glow, heat), smoothstep(0.25, 0.55, fb4(qw * 0.8)) * 7.0 * LY.x); }
/* holograms: holographic liquid; interference bands shift with the viewing angle and flow with the contents */
vec4 holoAt(vec3 p, float t) {
  float sp = LY.y; vec3 q = p * 1.4 * LY.z + vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1);
  vec3 w = vec3(fb4(q + vec3(0.0, 0.0, t * 0.06 * sp)), fb4(q + vec3(5.2, 1.3, -t * 0.05 * sp)), 0.0) - 0.5; float n = fb4(q + w * 1.8);
  float band = n * 3.2 + p.z * 1.4 + t * 0.05 * sp; vec3 c = mix(spectral(band), mix(palRamp(n), vec3(1.0), 0.3), 0.35) * 1.08;
  return vec4(c, smoothstep(0.35, 0.75, n) * 3.2 * LY.x); }
/* nebula stardust: glowing gas after the narrowband mapping (sulphur red, hydrogen gold, oxygen teal), tinted by the palette, cut by dark dust lanes */
vec4 nebulaAt(vec3 p, float t) { float sp = LY.y; vec3 q = p * 1.3 * LY.z + vec3(P0.z * 3.7, P0.z * 1.3, P0.z * 2.1);
  vec3 w = vec3(fb4(q * 0.8 + t * 0.012 * sp), fb4(q * 0.8 + 5.2), fb4(q * 0.8 + 9.1)) - 0.5; vec3 qw = q + w * 1.8; float gas = fb4(qw); float fil = 1.0 - abs(2.0 * fb4(qw * 2.1 + 4.0) - 1.0);
  float dust = smoothstep(0.58, 0.8, fb4(qw * 1.7 + 2.0)); float em = smoothstep(0.42, 0.8, gas) * (0.55 + 0.9 * pow(fil, 3.0)) * (1.0 - dust * 0.92);
  float hz = smoothstep(0.35, 0.65, fb4(qw * 0.7 + 7.0)); vec3 c = mix(vec3(0.95, 0.16, 0.32), vec3(0.1, 0.72, 0.86), hz); c = mix(c, vec3(1.0, 0.78, 0.38), smoothstep(0.72, 0.92, gas) * 0.55); c = mix(c, DOM, 0.25);
  c = max(mix(vec3(dot(c, vec3(0.3333))), c, 1.3), 0.0);
  return vec4(c * 1.6, em * 2.4 * LY.x); }
/* the volumetric part of each material: 1 ink, 2 mist, 3 fire, 4 aurora (fixed in place), 5 ink 2, 6 smoke, 7 sand haze, 8 snow powder, 9 glitter (clear liquid) */
vec4 matVol(vec3 s, vec3 p, float t, float ty) {
  if (ty < 1.5) return inkAt(s, t); if (ty < 2.5) return mistAt(s, t); if (ty < 3.5) return fireAt(s, t); if (ty < 4.5) return vec4(0.0);
  if (ty < 5.5) return inkAt2(s, t, 1.0); if (ty < 6.5) return smokeVolAt(s, t); if (ty < 7.5) return sandHazeAt(s, t); if (ty < 8.5) return snowPowderAt(s, t);
  if (ty < 9.5) return vec4(0.0); if (ty > 21.5 && ty < 22.5) return nebulaAt(s, t); return vec4(0.0); }
/* light for smoke and mist, after Schneider and Vos (Horizon Zero Dawn): a short march toward the key light gives the optical depth there
   (Beer-Lambert); the beer-powder term darkens thin edges and fills the interior; a Henyey-Greenstein phase (g 0.3); an ambient term for
   light bounced in from the surroundings, brighter higher up */
vec3 volLight(vec3 s, vec3 p, float t, float ty) {
  vec3 LD = normalize(vec3(-0.45, 0.62, -0.55)); float od = 0.0;
  for (int j = 1; j <= 4; j++) { float lj = 0.075 * float(j); od += matVol(s + LD * lj, p + LD * lj, t, ty).a * 0.075; }
  float beer = exp(-od * 1.1); float powder = 1.0 - exp(-od * 2.2); float E = mix(beer, 2.0 * beer * powder + beer * 0.35, 0.55);
  float g = 0.3; float ct = LD.z; float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * ct, 1.5); float ph = mix(1.0, hg, 0.35);
  float amb = 0.8 + 0.2 * clamp(s.y * 0.5 + 0.5, 0.0, 1.0);
  return vec3(0.4, 0.43, 0.5) * amb + vec3(1.0, 0.96, 0.9) * E * ph * 0.82; }
/* particles, drawn crisply over the volume in three depths: sand grains on a swirling wind, snowflakes falling and swaying, glitter turning in a vortex */
vec3 pLayer(vec2 q, float cs, vec2 mv, float rad, float seed) { vec2 g = (q + mv) / cs; vec2 id = floor(g); vec2 f = fract(g) - 0.5; float h = hh(vec3(id, seed));
  vec2 o = (vec2(hh(vec3(id, seed + 1.3)), hh(vec3(id, seed + 2.7))) - 0.5) * 0.6; return vec3(smoothstep(rad, rad * 0.3, length(f - o)) * step(0.4, h), hh(vec3(id, seed + 4.1)), hh(vec3(id, seed + 5.9))); }
vec3 particlesOver(vec3 col, vec2 q, float r, float t) {
  float ins = smoothstep(1.0, 0.93, r);
  for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; float ty = Lk.w; if (ty < 6.5 || ty > 7.5) continue; float sp = Lk.y; float sc = max(Lk.z, 0.2); float amt = Lk.x;
    for (int j = 0; j < 3; j++) { float fj = float(j); float dep = 1.0 - fj * 0.3;
      if (ty < 7.5) {
        float cs = (0.13 + fj * 0.04) / sc; vec2 g = q / cs + vec2(P0.z * 9.0, fj * 7.1); vec2 id = floor(g); vec2 cc = (id + 0.5 - vec2(P0.z * 9.0, fj * 7.1)) * cs; float h = hh(vec3(id, fj * 11.0 + 3.0));
        vec2 dir = normalize(vec2(-cc.y, cc.x) * (1.0 + 0.6 * sp) + (vec2(on3(vec3(cc * 2.0, t * 0.1)), on3(vec3(cc * 2.0 + 5.0, t * 0.1))) - 0.5) * 1.2 + vec2(0.001));
        float ph = fract(t * (0.9 + h * 0.8) * sp + h * 7.0); vec2 o = (vec2(hh(vec3(id, 1.3 + fj)), hh(vec3(id, 2.7 + fj))) - 0.5) * 0.5 * cs + dir * (ph - 0.5) * cs * 1.2;
        vec2 rel = q - cc - o; float along = dot(rel, dir); float across = dot(rel, vec2(-dir.y, dir.x)); float len = cs * (0.45 + 0.55 * sp * (1.0 - fj * 0.25));
        float streak = smoothstep(cs * 0.03, cs * 0.004, abs(across)) * smoothstep(-len, 0.0, along) * smoothstep(cs * 0.05, 0.0, along) * smoothstep(0.0, 0.15, ph) * smoothstep(1.0, 0.85, ph);
        float jet = smoothstep(0.18, 0.52, on3(vec3(atan(q.y, q.x) * 1.3 - t * 0.9 * sp, length(q) * 3.0, t * 0.15 + fj)));
        vec3 grain = (h > 0.6 ? mix(palRamp(0.25 + hh(vec3(id, 9.0)) * 0.4), COLS[0], 0.25) : mix(palRamp(0.55 + hh(vec3(id, 9.0)) * 0.45), COLS[4], 0.2)) * (0.85 + 0.3 * h) + vec3(1.0, 0.95, 0.85) * step(0.93, h) * 0.8;
        col = mix(col, grain, clamp(streak * step(0.55, h) * jet * amt * dep * ins * 1.2, 0.0, 1.0)); }
      else if (ty < 8.5) { vec3 pl = pLayer(q, (0.085 - fj * 0.02) / sc, vec2(sin(t * 0.5 * sp + fj * 1.7 + q.y * 2.0) * 0.04, -t * (0.12 + fj * 0.04) * sp) + vec2(P0.z * 2.0, fj * 5.3), 0.3 - fj * 0.05, fj * 13.0 + 7.0);
        col = mix(col, mix(palRamp(pl.y), vec3(1.0), 0.45) * (0.9 + 0.2 * pl.z), clamp(pl.x * amt * 0.9 * dep * ins, 0.0, 1.0)); }
      else { float ang = t * 0.25 * sp * (1.2 - r) + fj; vec2 rq = vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang));
        vec3 pl = pLayer(rq, (0.075 - fj * 0.015) / sc, vec2(P0.z * 3.0, fj * 9.1 + t * 0.03 * sp), 0.3, fj * 17.0 + 1.0);
        float glint = pow(0.5 + 0.5 * sin(t * (2.0 + pl.z * 4.0) * sp + pl.y * 40.0), 10.0);
        vec3 base = ty > 12.5 ? mix(spectral(pl.y * 1.7 + t * 0.1 * sp + r), vec3(1.0), 0.15) : palRamp(pl.y) * 0.85; vec3 gc = mix(base, vec3(1.0), glint * 0.9) * (0.9 + glint * 2.6);
        col = mix(col, min(gc, vec3(2.2)), clamp(pl.x * amt * (0.6 + 0.4 * glint) * dep * ins, 0.0, 1.0)); } } }
  return col; }
vec3 rock(vec3 s, float t) {
  if (SLO.x <= 0.001) return s;
  float rv = SLO.y; float c = fract(t * 0.075 + (on3(vec3(t * 0.021, 3.1, 0.0)) - 0.5) * 0.35 * rv);
  vec2 d = vec2(cos(6.2832 * c + (on3(vec3(t * 0.06, 1.3, 0.0)) - 0.5) * 1.6 * rv), -(0.55 * sin(12.5664 * c) + 0.45 * sin(6.2832 * c)) + (on3(vec3(2.7, t * 0.05, 0.0)) - 0.5) * 0.8 * rv);
  float surge = 0.3 + 0.7 * pow(0.5 + 0.5 * sin(t * 0.38 + (on3(vec3(t * 0.03, 0.0, 5.0)) - 0.5) * 4.0 * rv), 2.0);
  vec2 dn = d / max(length(d), 0.45); float k = dot(s.xy, dn) * (3.0 / max(SLO.z, 0.2)) - t * 1.4;
  vec2 slosh = d * (0.62 + 0.38 * sin(k)) + vec2(-dn.y, dn.x) * 0.22 * sin(k * 1.7 + t * 0.9);
  return s + vec3(slosh * 0.17 * SLO.x * surge, 0.0);
}
/* wave forms (WV.x): 0 pulse rings, 1 jagged, 2 side wave, 3 ocean waves, 4 knife, 5 Moses split, 6 leaf blower.
   Each onset of voice or music launches one; returns a displacement of the contents (xy) and a light (z) */
float ageEnv(float age, float k) { return exp(-age * k) * step(0.0, age) * smoothstep(0.0, 0.08, age); }
/* an ocean crest travelling along x (distance from where it started), varied along y */
float crest(float x, float y, vec2 q, float age) { float wob = on3(vec3(q * 3.5, age * 2.0)) - 0.5; return (0.55 + 0.45 * sin(x * 11.0 + y * 1.5 + wob * 3.0)) * exp(-x * x / 0.12) * (0.75 + 0.5 * wob); }
/* the height of one wave launched age seconds ago; each form is a real surface with slope */
float waveH(vec2 q, float age) {
  float t = WV.x; float r = length(q); vec2 dr = vec2(cos(WV.z), sin(WV.z)); vec2 pr = vec2(-dr.y, dr.x); vec2 src = -dr * 1.05;
  if (t < 0.5) { float amp = ageEnv(age, 2.2); float d = (r - age * 1.5) / 0.17; return exp(-d * d) * amp; }
  if (t < 1.5) { float amp = ageEnv(age, 2.2); float a = atan(q.y, q.x); float rr = r - age * 1.5 - 0.042 * sin(a * 9.0 + P0.z * 6.0) - 0.014 * sin(a * 23.0 + age * 8.0); float d = rr / 0.15; return exp(-d * d) * amp * 1.5; }
  if (t < 2.5) { float amp = ageEnv(age, 1.8); float d = length(q - src); float f = d - age * 1.8; return sin(f * 22.0) * exp(-f * f / 0.05) * smoothstep(0.0, 0.25, d) * amp * 0.9; }
  if (t < 3.5) { float amp = ageEnv(age, 1.35); float x = dot(q - src, dr) - age * 1.95; return crest(x, dot(q, pr), q, age) * amp * 2.0; }
  if (t < 5.5) { float amp = ageEnv(age, 0.95); float u = dot(q - src, dr); float v = dot(q, pr); float front = smoothstep(age * 3.1 + 0.3, age * 3.1 - 0.4, u); float w = 0.07 + 0.2 * smoothstep(0.0, 1.0, age); float flow = 0.2 * sin(u * 9.0 - age * 7.0) * exp(-v * v / (w * 2.0)); return (-exp(-v * v / w) * (1.0 + flow) + 0.22 * sin(abs(v) * 14.0 - age * 6.0) * exp(-abs(v) * 2.4) * smoothstep(0.0, 0.14, abs(v))) * front * amp * 1.5; }
  if (t < 6.5) { float amp = ageEnv(age, 0.95); vec2 dq = q - src; float d = length(dq); float f = d - age * 2.9; float cone = smoothstep(0.3, 0.88, dot(dq / max(d, 0.001), dr)); return (0.55 + 0.45 * on3(vec3(q * 6.0, age * 5.0))) * exp(-f * f / 0.14) * cone * amp * 2.8; }
  if (t < 7.5) { float amp = ageEnv(age, 1.35); float u = dot(q, dr); float T = GR2.w; float v = dot(q, pr) + 0.07 * sin(u * 4.5 + T * 1.2 + P0.z * 3.0) + 0.03 * sin(u * 11.0 - T * 0.8); float x = sqrt(v * v + 0.004) - 0.05 - age * 0.85; return crest(x * 1.6, u, q, age) * ageEnv(age, 2.4) * 1.1; }
  if (t < 8.5) { float amp = ageEnv(age, 2.0); float a = atan(q.y, q.x); float petal = 0.5 + 0.5 * cos(a * 6.0 + P0.z * 4.0); float rr = r - age * 1.4 - 0.1 * petal * smoothstep(0.0, 0.4, age); float d = rr / 0.14; return exp(-d * d) * amp * (1.1 + 0.5 * petal); }
  return 0.0;
}
/* forms that run continuously while there is sound (the Moses split line, spiral, wormhole): P2.w is how present the sound is, P1.x its loudness */
float steadyH(vec2 q) {
  float t = WV.x; float r = length(q); float T = GR2.w; float pres = P2.w; float e = P1.x;
  if (t > 8.5 && t < 9.5) { float sz = 0.3 + 1.1 * clamp(e * 1.7, 0.0, 1.0); float rr = r / sz; float a = atan(q.y, q.x); float ph = rr * 14.0 - T * 6.0 + a * 2.0; return (sin(ph) * exp(-rr * 1.1) * smoothstep(1.0, 0.1, rr) * 0.9 - exp(-rr * rr / 0.06) * 1.2) * pres * (0.6 + 0.9 * e); }
  if (t > 9.5) { float sz = 0.28 + 1.0 * clamp(e * 1.7, 0.0, 1.0); float a = atan(q.y, q.x); float ph = a * 3.0 - (r / sz) * 9.0 + T * 2.2; return pow(0.5 + 0.5 * sin(ph), 3.0) * smoothstep(sz, sz * 0.12, r) * pres * (0.6 + 0.9 * e) * 1.5; }
  return 0.0;
}
float wavesH(vec2 q) { float h = steadyH(q) + waveH(q, P2.x) + waveH(q, P2.y) + waveH(q, P2.z); if (WV.x < 1.5 || WV.x > 7.5) h *= smoothstep(0.02, 0.22, length(q)); return h; }
/* how the material moves: pushed along the slope of the waves; the Moses split parts it steadily; the leaf blower sweeps it along */
vec4 waves(vec2 q) { float e = 0.012; vec2 g = vec2(wavesH(q + vec2(e, 0.0)) - wavesH(q - vec2(e, 0.0)), wavesH(q + vec2(0.0, e)) - wavesH(q - vec2(0.0, e))) / (2.0 * e); vec2 disp = g * 0.02 * WV.y;
  vec2 dr = vec2(cos(WV.z), sin(WV.z)); vec2 pr = vec2(-dr.y, dr.x);
  if (WV.x > 4.5 && WV.x < 5.5) { float v = dot(q, pr); float amp = ageEnv(P2.x, 0.95) * WV.y; disp -= pr * v * exp(-v * v / 0.1) * 0.9 * amp; }
  if (WV.x > 5.5 && WV.x < 6.5) { for (int k = 0; k < 3; k++) { float age = k == 0 ? P2.x : (k == 1 ? P2.y : P2.z); float amp = ageEnv(age, 0.95); vec2 dq = q + dr * 1.05; float d = length(dq); float f = d - age * 2.9; float cone = smoothstep(0.3, 0.88, dot(dq / max(d, 0.001), dr)); disp -= dr * exp(-f * f / 0.2) * cone * amp * 0.16 * WV.y; } }
  if (WV.x > 8.5 && WV.x < 9.5) { float sz = 0.3 + 1.1 * clamp(P1.x * 1.7, 0.0, 1.0); disp += q * exp(-dot(q, q) * 2.0 / (sz * sz)) * 0.12 * P2.w * (0.4 + P1.x) * WV.y; }
  return vec4(disp, g * WV.y); }
float grainAt(vec2 fc) {
  float gt = GR2.x; vec2 gp = floor(fc / max(GR2.y, 0.5));
  if (gt < 0.5) return hh(vec3(gp, 11.0)) + hh(vec3(gp.yx + vec2(17.3, 5.9), 29.0)) - 1.0;
  if (gt < 1.5) return (hh(vec3(gp, 3.0)) - 0.5) * 0.9;
  if (gt < 2.5) { vec2 cp = floor(fc / (2.0 * max(GR2.y, 0.5))); return (hh(vec3(cp, 7.0)) + hh(vec3(cp.yx, 19.0)) - 1.0) * 1.2; }
  return 0.0;
}
/* smoke: soft, semi-transparent veils drifting over the material, like the haze in the ElevenLabs orbs. Domain-warped noise, stretched into
   streaks along a slowly turning flow and curling as it travels; each veil is a lighter version of the colour beneath it. MAT.z amount, MAT.w size, GR2.z speed. */
float smokeAt(vec3 p, float t) {
  if (MAT.z <= 0.001) return 0.0;
  float sp = GR2.z; float an = t * 0.035 * sp + on3(p * 0.6 + vec3(t * 0.01)) * 2.0; float ca = cos(an); float sa = sin(an);
  vec3 q = vec3(p.x * ca - p.y * sa, p.x * sa + p.y * ca, p.z) * 1.5 / max(MAT.w, 0.2);
  q = vec3(q.x * 0.55, q.y * 1.6, q.z);
  vec3 w = vec3(ofb(q + vec3(0.0, 0.0, t * 0.06 * sp)), ofb(q + vec3(5.2, 1.3, -t * 0.05 * sp)), ofb(q + vec3(-2.7, 8.1, t * 0.045 * sp)));
  float a = ofb(q * 1.2 + (w - 0.5) * 2.4 + vec3(t * 0.05 * sp, -t * 0.035 * sp, 0.0));
  float b = ofb(q * 2.6 + (w - 0.5) * 1.5 - vec3(0.0, t * 0.05 * sp, t * 0.02 * sp));
  float th = mix(0.62, 0.3, clamp(WV.w, 0.0, 1.0)); return smoothstep(th, th + 0.44, a * 0.7 + b * 0.3) * MAT.z;
}
/* blending modes: 0 normal, 1 screen, 2 overlay, 3 soft light, 4 multiply, 5 lighten, 6 darken, 7 colour, 8 luminosity */
vec3 blendMode(vec3 b, vec3 s, float m) {
  if (m < 1.5) return 1.0 - (1.0 - b) * (1.0 - s);
  if (m < 2.5) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
  if (m < 3.5) return mix(2.0 * b * s + b * b * (1.0 - 2.0 * s), sqrt(max(b, 0.0)) * (2.0 * s - 1.0) + 2.0 * b * (1.0 - s), step(0.5, s));
  if (m < 4.5) return b * s;
  if (m < 5.5) return max(b, s);
  if (m < 6.5) return min(b, s);
  vec3 lb = tolab(clamp(b, 0.0, 1.0)); vec3 ls = tolab(clamp(s, 0.0, 1.0));
  if (m < 7.5) return fromlab(vec3(lb.x, ls.y, ls.z));
  return fromlab(vec3(ls.x, lb.y, lb.z));
}
vec3 smokeOver(vec3 col, float sm, vec2 q) {
  vec3 lite = mix(DOM, vec3(1.0), SND.x); vec3 dkc = DOM * 0.3;
  vec3 veilL = MOT.z < 0.5 ? min(mix(col, lite, 0.55) * 1.04 + vec3(0.015), vec3(1.0)) : blendMode(col, lite, MOT.z);
  vec3 veilD = MOT.w < 0.5 ? mix(col, dkc, 0.62) : blendMode(col, dkc, MOT.w);
  float dk = pow(smoothstep(SND.y, 1.0, q.y), max(RIM.w, 0.1)) * RIM.z;
  return mix(col, mix(veilL, veilD, clamp(dk, 0.0, 1.0)), clamp(sm, 0.0, 1.0) * 0.55); }
vec3 envRefl(vec3 r) {
  vec3 c = mix(mix(vec3(0.9, 0.88, 0.86), vec3(0.06, 0.07, 0.1), uDark), mix(vec3(1.0), vec3(0.26, 0.28, 0.36), uDark), smoothstep(-0.3, 0.9, r.y));
  vec3 a = normalize(vec3(-0.55, 0.62, -0.56)); vec3 ax = normalize(cross(a, vec3(0.0, 1.0, 0.0))); vec3 ay = cross(ax, a); vec2 sb = vec2(dot(r, ax), dot(r, ay)) / max(dot(r, a), 0.05);
  c += vec3(1.35) * step(0.0, dot(r, a)) * (1.0 - smoothstep(0.26, 0.3, abs(sb.x))) * (1.0 - smoothstep(0.4, 0.46, abs(sb.y)));
  vec3 b2 = normalize(vec3(0.85, 0.15, -0.5)); c += vec3(0.55) * smoothstep(0.955, 0.985, dot(r, b2));
  c += vec3(0.25) * smoothstep(0.6, 1.0, -r.y) * (1.0 - uDark);
  return c;
}
vec3 rimLight(vec3 col, float r, float z, vec2 q, float pk) {
  float t = RIM.x; float k = RIM.y; vec3 lc = lightc(pk);
  if (t < 0.5) { float rimw = pow(1.0 - z, 1.7) * smoothstep(0.5, -0.8, q.x + q.y * 0.35); col = mix(col, lc, clamp(rimw * 0.6 * k, 0.0, 1.0)); return col * (1.0 - pow(1.0 - z, 2.4) * 0.16 * k * smoothstep(-0.2, 0.9, q.x + q.y)); }
  if (t < 1.5) return col + lc * pow(1.0 - z, 3.0) * 0.55 * k;
  if (t < 2.5) return col + lc * pow(1.0 - z, 5.0) * 1.1 * k * (0.55 + 0.45 * smoothstep(-0.6, 0.8, q.x - q.y));
  if (t < 3.5) { float w = pow(1.0 - z, 2.2) * 0.7 * k; return col + mix(vec3(1.0, 0.72, 0.52), vec3(0.62, 0.72, 1.0), smoothstep(-0.4, 0.4, q.x)) * w * 0.6; }
  if (t < 4.5) return mix(col, lc, smoothstep(0.62, 1.0, r) * 0.45 * k);
  return col;
}
vec4 outsideLayer(vec2 q, float r, vec2 suv, float pk) {
  vec2 so = q - vec2(0.0, SHD.z);
  float sh = SHD.x * 0.32 * (1.0 - smoothstep(0.45, 1.25 * SHD.y + 0.2, length(so * vec2(0.9, 2.3)))) * mix(1.0, 0.6, uDark);
  vec3 bg = vec3(0.0);
  float cau = GLS.x * exp(-dot((q - vec2(0.12, SHD.z + 0.36)) * vec2(3.2, 7.0), (q - vec2(0.12, SHD.z + 0.36)) * vec2(3.2, 7.0))) * 0.5;
  bg += lightc(pk) * cau * (1.0 - uDark * 0.3);
  if (RIM.x > 1.5 && RIM.x < 2.5) bg += lightc(pk) * exp(-(r - 1.0) * 10.0) * 0.35 * RIM.y;
  return vec4(bg, clamp(sh, 0.0, 1.0));
}
void main() {
  vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 q = (fc - uRect.xy) / uRect.z;
  float r = length(q);
  vec2 suv = gl_FragCoord.xy / uRes;
  float px = 1.5 / uRect.z;
  float pk = P0.y; float sd = P0.z; float tm = P0.w; float T = GR2.w;
  if (r > 1.0 + px) { frag = outsideLayer(q, r, suv, pk); return; }
  vec3 col;
  float z = sqrt(max(1.0 - r * r, 0.0));
  if (P0.x < 0.5) {
    /* Signature: the current orb, verbatim, with the global controls on top */
    vec4 wv0 = waves(q);
    float stir = (MOT.x > 0.5 && MOT.x < 1.5) ? MOT.y * (0.35 + P1.y) : P1.y;
    float sw0 = stir * pow(max(1.0 - r, 0.0), 1.6);
    vec2 qw = q - wv0.xy;
    vec2 qs = vec2(qw.x * cos(sw0) - qw.y * sin(sw0), qw.x * sin(sw0) + qw.y * cos(sw0));
    vec3 n = vec3(q.x, -q.y, z);
    vec3 ns = vec3(qs.x, -qs.y, z);
    float ring = wavesH(q) * WV.y;
    vec3 s = rock(motionShift(spin(ns, tm * 0.08), T), T);
    float e = 0.06;
    float f0 = ofield(s, tm, sd);
    float fx = ofield(rock(motionShift(spin(normalize(ns + vec3(e, 0.0, 0.0)), tm * 0.08), T), T), tm, sd);
    float fy = ofield(rock(motionShift(spin(normalize(ns + vec3(0.0, e, 0.0)), tm * 0.08), T), T), tm, sd);
    vec2 grad = vec2(fx - f0, fy - f0) / e;
    vec2 rad = q / max(r, 0.0001);
    vec3 nn = normalize(n - vec3(grad.x, grad.y, 0.0) * LOOK.w * 0.42 - vec3(wv0.z, -wv0.w, 0.0) * 0.05);
    vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
    float dif = 0.8 + 0.2 * dot(nn, L);
    float sheen = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), nn), L), 0.0), 5.0) * 0.1;
    float wvx;
    vec3 lab = fieldColor(s, tm, sd, f0, pk, P1.w, wvx);
    lab.x += ring * 0.06 + motionLight(r);
    lab = gradeLab(lab);
    col = fromlab(lab) * dif + vec3(sheen);
    col = rimLight(col, r, z, q, pk);
    col = smokeOver(col, smokeAt(vec3(q.x, -q.y, z), T), q);
    if (GLS.x > 0.001) {
      vec2 off = vec2(nn.x, -nn.y) * (1.0 - z) * 0.09 * GLS.z * (GLS.y - 1.0) * 3.0;
      vec2 mag = (suv - (vec2(uRect.x, uRes.y - uRect.y) / uRes)) * (1.0 - 1.0 / (1.0 + 0.35 * GLS.z));
      vec3 refr = vec3(texture(uBack, suv - mag + off * (1.0 + GLS.w)).r, texture(uBack, suv - mag + off).g, texture(uBack, suv - mag + off * (1.0 - GLS.w)).b);
      float fres = 0.04 + 0.96 * pow(1.0 - z, 5.0);
      vec3 glass = refr * (1.0 - fres * 0.25);
      col = mix(col, glass, GLS.x);
    }
  } else {
    /* Sphere: a real glass sphere; each ray refracts in, gathers the Signature field as coloured fluid through the volume, and refracts out to the backdrop */
    vec3 rd = vec3(0.0, 0.0, 1.0);
    vec4 wv0 = waves(q); float ring = wavesH(q) * WV.y; vec2 qv = q - wv0.xy * 0.9; float zv = sqrt(max(1.0 - dot(qv, qv), 0.0));
    vec3 pin = vec3(q.x, -q.y, -z);
    vec3 nin = pin;
    float ior = max(GLS.y, 1.0);
    vec3 rdi = refract(rd, nin, 1.0 / ior);
    float tex = max(-2.0 * dot(pin, rdi), 0.0);
    bool anyMat = false; bool anyEmit = false; bool anyGlit = false; bool anyHolo = false; bool anyAur = false; bool anyPla = false; bool anyLava = false; bool anyMetal = false; bool anyOcean = false; bool anyFoam = false; bool anyNeb = false; bool anyOpal = false; bool anyPol = false; for (int k = 0; k < 4; k++) { if (ML[k].w > 0.5) anyMat = true; if ((ML[k].w > 2.5 && ML[k].w < 4.5) || (ML[k].w > 9.5 && ML[k].w < 10.5) || (ML[k].w > 19.5 && ML[k].w < 20.5) || (ML[k].w > 21.5 && ML[k].w < 22.5)) anyEmit = true; if (ML[k].w > 21.5 && ML[k].w < 22.5) anyNeb = true; if (ML[k].w > 20.5 && ML[k].w < 21.5) anyOpal = true; if (ML[k].w > 22.5 && ML[k].w < 23.5) anyPol = true; if ((ML[k].w > 7.5 && ML[k].w < 9.5) || (ML[k].w > 12.5 && ML[k].w < 13.5) || (ML[k].w > 17.5 && ML[k].w < 20.5)) anyGlit = true; if (ML[k].w > 3.5 && ML[k].w < 4.5) anyAur = true; if (ML[k].w > 9.5 && ML[k].w < 10.5) anyPla = true; if (ML[k].w > 10.5 && ML[k].w < 11.5) anyLava = true; if (ML[k].w > 13.5 && ML[k].w < 14.5) anyMetal = true; if (ML[k].w > 14.5 && ML[k].w < 15.5) anyOcean = true; if (ML[k].w > 15.5 && ML[k].w < 16.5) anyFoam = true; if (ML[k].w > 11.5 && ML[k].w < 12.5) anyHolo = true; }
    const int NS = 26;
    bool anyScene = false; float sid = 0.0; for (int k = 0; k < 4; k++) { if (ML[k].w > 16.5 && ML[k].w < 17.5) { anyScene = true; sid = SHD.w; } }
    vec4 scn = vec4(0.0, 0.0, 0.0, 1e5);
    if (anyScene) { vec3 po = pin + vec3(-wv0.x, wv0.y, 0.0) * 0.6; float pxs = abs(SLO.w);
      if (SLO.w > 0.0) { vec4 s1 = sceneRender(po + vec3(-0.3, -0.3, 0.0) * pxs, rdi, tex, sid, T); float a1 = gSceneA * step(s1.w, 1e4); vec4 s2 = sceneRender(po + vec3(0.3, 0.3, 0.0) * pxs, rdi, tex, sid, T); float a2 = gSceneA * step(s2.w, 1e4);
        scn = vec4((s1.rgb * a1 + s2.rgb * a2) / max(a1 + a2, 1e-4), (a1 + a2 > 0.0) ? min(s1.w, s2.w) : 1e5); gSceneA = (a1 + a2) * 0.5; }
      else scn = sceneRender(po, rdi, tex, sid, T); }
    float ds = min(tex, scn.w < 1e4 ? scn.w : tex) / float(NS);
    float jit = hh(vec3(fc, 5.0));
    vec3 C = vec3(0.0); float Tr = 1.0; float nebOD = 0.0;
    float th = mix(0.9, 0.08, clamp(MAT.x, 0.0, 1.0));
    float dens = 7.0 + 18.0 * MAT.x;
    float sw0 = (MOT.x > 0.5 && MOT.x < 1.5) ? MOT.y * (0.35 + P1.y) : P1.y;
    for (int i = 0; i < NS; i++) {
      vec3 p = pin + rdi * (ds * (float(i) + jit));
      p.xy -= wv0.xy * (0.6 + 0.4 * length(p.xy));
      float rp = length(p);
      float ang = sw0 * pow(max(1.0 - rp, 0.0), 1.2);
      vec3 pr2 = vec3(p.x * cos(ang) - p.y * sin(ang), p.x * sin(ang) + p.y * cos(ang), p.z);
      vec3 s = motionShift(spin(vec3(pr2.x, pr2.y * cos(tm * 0.021) - pr2.z * sin(tm * 0.021), pr2.y * sin(tm * 0.021) + pr2.z * cos(tm * 0.021)), tm * 0.09 * MAT.y), T);
      s = rock(s, T);
      if (anyMat) {
        vec3 em = vec3(0.0); float emd = 0.0; float dsum = 0.0; vec3 csum = vec3(0.0);
        for (int k = 0; k < 4; k++) { LY = ML[k]; float ty = LY.w; if (ty < 0.5) continue; vec4 m = matVol(s, p, T, ty); if (m.a <= 0.0001) continue;
          if ((ty > 2.5 && ty < 4.5) || (ty > 9.5 && ty < 10.5) || (ty > 21.5 && ty < 22.5)) { em += m.rgb * m.a; emd += m.a; if (ty > 21.5) nebOD += m.a * ds; } else { vec3 mc = m.rgb; if ((ty > 5.5 && ty < 7.5)) mc *= volLight(s, p, T, ty); dsum += m.a; csum += mc * m.a; } }
        if (anyGlit) { vec3 LD0 = normalize(vec3(-0.45, 0.62, -0.55));
          for (int k = 0; k < 4; k++) { vec4 Lk = ML[k]; if (!((Lk.w > 7.5 && Lk.w < 9.5) || (Lk.w > 12.5 && Lk.w < 13.5) || (Lk.w > 17.5 && Lk.w < 20.5))) continue; bool snw = Lk.w < 8.5; bool plk = Lk.w > 19.5 && Lk.w < 20.5; bool pet = Lk.w > 17.5 && Lk.w < 19.5; bool lfk = Lk.w > 18.5 && Lk.w < 19.5; bool faa = SLO.w > 0.0;
            float an = T * 0.12 * Lk.y; float ca = cos(an); float sa = sin(an); mat3 Rv = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca);
            vec3 pv = Rv * p; vec3 rv = Rv * rdi; vec3 lv = Rv * LD0; float cs = (plk ? 14.0 : (snw || pet ? 8.0 : 11.0)) * max(Lk.z, 0.3); vec3 drift = vec3(0.0, T * (plk ? 0.02 : (snw ? 0.09 : (pet ? 0.055 : 0.05))) * Lk.y, 0.0); float pxc = abs(SLO.w) * cs * 1.2;
            mat3 Tg = mat3(0.8, 0.36, -0.48, -0.6, 0.48, -0.64, 0.0, 0.8, 0.6); vec3 pg = Tg * pv; vec3 rg = Tg * rv; vec3 lg = Tg * lv;
            for (int q2 = 0; q2 < 2; q2++) { vec3 ps2 = pg + rg * (ds * 0.5 * float(q2));
              vec3 id = floor(ps2 * cs + drift); float h = hh(id + vec3(P0.z * 7.0)); if (h < 1.0 - (plk ? 0.12 : (snw ? 0.16 : (pet ? 0.1 : 0.2))) * clamp(Lk.x, 0.0, 2.0)) continue;
              vec3 c = (id + 0.5 + (vec3(hh(id + 1.3), hh(id + 2.7), hh(id + 4.1)) - 0.5) * 0.5 - drift + (snw || pet ? vec3(sin(T * (pet ? 0.9 : 1.3) * Lk.y + h * 20.0) * (pet ? 0.3 : 0.18), 0.0, cos(T * 1.1 * Lk.y + h * 13.0) * 0.12) : vec3(0.0))) / cs;
              if (plk) { float ta = dot(c - pg, rg); if (ta < -ds * 0.5 || ta >= ds * 0.5) continue; float pdist = length(pg + rg * ta - c) * cs;
                float agit = clamp(smoothstep(0.6, 0.92, on3(c * 2.4 + vec3(0.0, T * 0.4 * Lk.y, T * 0.15)) + 0.2 * sin(T * 2.3 * Lk.y + h * 30.0)) + P1.x * 0.9, 0.0, 1.5);
                vec3 bio = mix(vec3(0.15, 0.72, 1.0), DOM, 0.22); C += Tr * bio * (exp(-pdist * pdist / 0.006) * 1.8 + exp(-pdist * pdist / 0.06) * 0.2) * agit * 1.3; continue; }
              vec3 n = normalize(vec3(sin(T * (0.6 + h * 0.9) * Lk.y + h * 40.0), cos(T * (0.5 + hh(id + 5.3) * 0.8) * Lk.y + h * 17.0), sin(T * 0.4 * Lk.y + h * 9.0) * 0.8 + 0.3));
              float den = dot(rg, n); if (abs(den) < 0.02) continue; float tt = dot(c - pg, n) / den; if (tt < -ds * 0.5 || tt >= ds * 0.5) continue;
              vec3 hv = (pg + rg * tt - c) * cs; float rr = length(hv); float fr = (snw ? 0.2 : (pet ? 0.24 : 0.15)) + 0.1 * hh(id + 6.1); if (rr > fr + (faa ? pxc : 0.0)) continue; float edge = faa ? smoothstep(fr + pxc, fr - pxc, rr) : smoothstep(fr, fr * 0.8, rr);
              if (snw) { vec3 ax = normalize(cross(n, vec3(0.2, 0.9, 0.3))); vec3 ay = cross(n, ax); float an2 = atan(dot(hv, ay), dot(hv, ax)) + h * 6.28;
                float arms = pow(abs(cos(an2 * 3.0)), 6.0); float lim = fr * (0.32 + 0.68 * arms) * (0.85 + 0.15 * sin(rr / fr * 18.0 + an2 * 6.0));
                edge = faa ? smoothstep(lim + pxc, lim - pxc, rr) : smoothstep(lim, lim * 0.7, rr); if (edge <= 0.0) continue; }
              if (pet) { vec3 ax = normalize(cross(n, vec3(0.2, 0.9, 0.3))); vec3 ay = cross(n, ax); float an3 = h * 6.28; vec2 uv2 = vec2(dot(hv, ax) * cos(an3) - dot(hv, ay) * sin(an3), dot(hv, ax) * sin(an3) + dot(hv, ay) * cos(an3));
                float pd = length(vec2(uv2.x / fr, uv2.y / (fr * 0.58))) - 1.0; float notch = length(uv2 - vec2(fr * 1.02, 0.0)) - fr * 0.16; pd = lfk ? (abs(uv2.y) / (fr * 0.42) - (1.0 - pow(abs(uv2.x) / fr, 1.6))) : max(pd, -notch / fr);
                edge = faa ? smoothstep(pxc / fr, -pxc / fr, pd) : smoothstep(0.0, -0.2, pd); if (edge <= 0.0) continue; }
              vec3 R = reflect(rg, n); float spk = pow(max(dot(R, lg), 0.0), 420.0) + 0.35 * pow(max(dot(R, Tg * (Rv * normalize(vec3(0.6, 0.3, -0.7)))), 0.0), 600.0);
              vec3 tint = lfk ? mix(mix(vec3(0.8, 0.36, 0.1), vec3(0.62, 0.16, 0.07), hh(id + 3.3)), mix(palRamp(0.6 + 0.4 * h), vec3(0.85, 0.55, 0.15), 0.5), 0.35) * (0.9 + 0.2 * step(0.08, abs(dot(hv, normalize(cross(n, vec3(0.2, 0.9, 0.3)))))) ) : pet ? mix(vec3(1.0, 0.76, 0.85), mix(palRamp(0.7 + 0.3 * h), vec3(1.0), 0.3), 0.25) * (0.92 + 0.08 * hh(id + 8.8)) : Lk.w > 12.5 ? thinFilm(abs(den), 300.0 + 500.0 * h) : (snw ? mix(vec3(0.94, 0.97, 1.0), palRamp(h), 0.08) : mix(palRamp(0.35 + h * 0.65), vec3(0.92), 0.3));
              vec3 metal = tint * (pet ? (0.7 + 0.25 * abs(dot(n, lg)) + 0.2 * max(dot(n, -lg), 0.0)) : snw ? (0.72 + 0.28 * abs(dot(n, lg))) : (0.55 + 0.35 * abs(dot(n, lg)) + 0.25 * pow(1.0 - abs(den), 2.0)));
              C += Tr * (metal + tint * spk * (snw || pet ? (pet ? 0.6 : 3.0) : 8.0) + vec3(1.0, 0.97, 0.92) * spk * (snw ? 1.5 : (pet ? 0.3 : 3.0))) * edge; Tr *= 1.0 - (snw ? 0.6 : (pet ? 0.85 : 0.75)) * edge; } } }
        C += Tr * em * ds * 0.45; Tr *= exp(-emd * ds * 0.06);
        if (dsum > 0.0001) { float a = 1.0 - exp(-dsum * ds); vec3 lit = (csum / dsum) * (0.82 + 0.4 * exp(-dsum * 0.6)); C += Tr * a * lit; Tr *= 1.0 - a; if (Tr < 0.01) break; }
        continue;
      }
      vec3 sn = s / max(rp, 0.2);
      float f0 = ofield(sn * mix(1.0, 1.35, 1.0 - rp), tm * MAT.y, sd);
      float shell = smoothstep(0.35, 0.93, rp) * (1.0 - smoothstep(0.985, 1.0, rp));
      float rho = smoothstep(th, th + 0.26, f0) * dens * mix(0.35, 1.0, shell);
      float pw = 0.0;
      if (rho + pw > 0.001) {
        float wvx; vec3 lab = fieldColor(sn, tm * MAT.y, sd, f0, pk, P1.w, wvx);
        lab.x += ring * 0.06 + motionLight(rp) + shell * 0.02;
        vec3 c = fromlab(gradeLab(lab));
        float a = 1.0 - exp(-(rho + pw) * ds);
        vec3 cc = c;
        C += Tr * a * cc; Tr *= 1.0 - a;
        if (Tr < 0.01) break;
      }
    }
    vec3 pe = pin + rdi * tex;
    vec3 rdo = refract(rdi, -pe, ior);
    if (dot(rdo, rdo) < 0.001) rdo = reflect(rdi, -pe);
    vec2 cuv = vec2(uRect.x, uRes.y - uRect.y) / uRes; vec2 rel = suv - cuv;
    vec2 bofs = rdo.xy * 0.55 * GLS.z;
    vec2 buv = cuv - rel * (0.35 + 0.25 * GLS.z) + vec2(bofs.x, bofs.y) * vec2(uRect.z / uRes.x, uRect.z / uRes.y);
    vec3 back = vec3(texture(uBack, buv + vec2(bofs.x * GLS.w, 0.0)).r, texture(uBack, buv).g, texture(uBack, buv - vec2(bofs.x * GLS.w, 0.0)).b);
    vec3 frost = mix(LC, COLS[2], 0.16) * (0.9 + 0.1 * z);
    vec3 inside = mix(frost, back * vec3(0.97, 0.975, 0.98), GLS.x);
    if (anyEmit) inside = mix(vec3(0.018, 0.02, 0.035), back * 0.22, GLS.x * 0.6);
    if (anyNeb) { vec2 P = vec2(q.x, -q.y); vec2 sg = floor(P * 70.0); float st = hh(vec3(sg, 9.0)); vec2 so = fract(P * 70.0) - 0.5 - (vec2(hh(vec3(sg, 14.0)), hh(vec3(sg, 15.0))) - 0.5) * 0.5;
      inside += vec3(0.9, 0.93, 1.0) * step(0.99, st) * smoothstep(max(abs(SLO.w) * 1.4, 0.003), 0.0, length(so) / 70.0) * (0.35 + 0.65 * hh(vec3(sg, 10.0))) * exp(-nebOD * 2.5); }
    if (anyScene && sid > 4.5 && sid < 6.5) { vec2 P = vec2(q.x, -q.y); inside = sid > 5.5 ? mix(vec3(0.05, 0.03, 0.08), vec3(0.16, 0.09, 0.22), smoothstep(-0.3, 1.0, P.y)) : mix(vec3(0.02, 0.035, 0.08), vec3(0.08, 0.1, 0.2), smoothstep(-0.3, 1.0, P.y)); vec2 sg = floor(P * 80.0); float st = hh(vec3(sg, 5.0));
      inside += vec3(0.85, 0.9, 1.0) * step(0.982, st) * smoothstep(max(abs(SLO.w) * 1.3, 0.0025), 0.0, length(fract(P * 80.0) - 0.5) / 80.0) * (0.55 + 0.45 * sin(T * (1.0 + st * 3.0) + st * 40.0)) * 0.7;
      inside += vec3(0.8, 0.85, 1.0) * exp(-dot(P - vec2(-0.45, 0.5), P - vec2(-0.45, 0.5)) * 60.0) * 0.9 + vec3(0.4, 0.45, 0.6) * exp(-dot(P - vec2(-0.45, 0.5), P - vec2(-0.45, 0.5)) * 8.0) * 0.12; }
    if (anyScene && scn.w <= 1e4) inside = mix(inside, scn.rgb, gSceneA);
    inside *= 1.0 - smoothstep(0.72, 0.98, r) * 0.35 * GLS.x;
    if (anyEmit) C = vec3(1.0) - exp(-C * 1.35);
    col = C + Tr * inside;
    float fres = 0.05 + 0.95 * pow(1.0 - z, 4.0);
    vec3 rr = reflect(rd, nin);
    col = col * (1.0 - fres * 0.12);
    col = smokeOver(col, smokeAt(vec3(q.x, -q.y, z), T), q);
    if (anyMat) col = particlesOver(col, qv, r, T);
    if (anyHolo) col = filmOver(col, qv, r, zv, T);
    if (anyAur) col = auroraOver(col, qv, r, zv, T);
    if (anyPla) col = plasmaOver(col, qv, r, zv, T);
    if (anyLava) col = lavaOver(col, qv, r, zv, T);
    if (anyMetal) col = metalOver(col, qv, r, zv, T);
    if (anyOpal) col = opalOver(col, qv, r, zv, T);
    if (anyPol) col = pollenOver(col, qv, r, T);
    if (anyOcean) col = oceanOver(col, qv, r, zv, T, pin + vec3(-wv0.x, wv0.y, 0.0) * 0.6, rdi, tex);
    if (anyFoam) col = foamOver(col, qv, r, zv, T);
    if (anyMat) col *= 1.0 + ring * 0.09;
    col = rimLight(col, r, z, q, pk);
  }
  col = col * (1.0 + grainAt(fc) * P1.z * 1.5);
  float al = 1.0 - smoothstep(1.0 - px, 1.0 + px, r);
  vec4 ol = outsideLayer(q, r, suv, pk);
  frag = vec4(col * al + ol.rgb * (1.0 - al), al + ol.a * (1.0 - al));
}
`;
const VS = `#version 300 es
in vec2 aPos; uniform vec4 uBox; void main() { gl_Position = vec4(uBox.xy + aPos * uBox.zw, 0.0, 1.0); }`;
const FULL_VS = `#version 300 es
in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
const PAL = { ember: 0, emerald: 1, violet: 2, oxblood: 3, citrus: 4, moon: 5 };
const RIMS = { signature: 0, fresnel: 1, backlit: 2, split: 3, inner: 4, none: 5 };
const GRAINS = { film: 0, fine: 1, coarse: 2, none: 3 };
const SOUNDS = { pulse: 0 };
const WAVES = { pulse: 0, jagged: 1, side: 2, ocean: 3, stream: 5, blower: 6, moses: 7, flower: 8, wormhole: 9, spiral: 10 };
const MATS = { none: 0, field: 0, ink: 1, mist: 2, fire: 3, aurora: 4, ink2: 5, smoke: 6, sand: 7, snow: 8, glitter: 9, plasma: 10, lava: 11, holo: 12, hologlitter: 13, metal: 14, ocean: 15, foam: 16, scene: 17, petals: 18, leaves: 19, plankton: 20, opal: 21, nebula: 22, pollen: 23 };
const MATS_PETALS = 18;
const SCENES = { christmas: 0, easter: 1, spring: 2, summer: 3, autumn: 4, winter: 5, halloween: 6, thanksgiving: 7, mercury: 8 };
const FIRES = { classic: 0, gas: 1, inferno: 2, candle: 3, spirit: 4, smoulder: 5 };
const BLENDS = { normal: 0, screen: 1, overlay: 2, softlight: 3, multiply: 4, lighten: 5, darken: 6, color: 7, luminosity: 8 };
const MOTIONS = { drift: 0, stir: 1, breathe: 2, ripples: 3, turbulence: 4, spectral: 5, tide: 6 };
const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
/* the palette's dominant colour: the most saturated of its five, preferring mid tones */
const dominant = (cols) => { let best = null, bs = -1; for (const h of cols) { const c = hex(h), mx = Math.max(...c), mn = Math.min(...c), l = (mx + mn) / 2, sc = (mx - mn) * (1 - Math.abs(l - 0.5) * 0.9); if (sc > bs) { bs = sc; best = c; } } return best; };
function create(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false });
  if (!gl) throw new Error('WebGL2 is not available');
  gl.getExtension('OES_standard_derivatives');
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = (vs, fs) => { const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++) { const a = gl.getActiveUniform(p, i); u[a.name.replace('[0]', '')] = gl.getUniformLocation(p, a.name); } return { p, u }; };
  const FLOAT = !!gl.getExtension('EXT_color_buffer_float');
  const imP = prog(FULL_VS, root.AvaOrbBackdrop.IMG_FS), meP = prog(FULL_VS, root.AvaOrbBackdrop.MESH_FS), orb = prog(VS, ORB_FS), blit = prog(FULL_VS, `#version 300 es
precision highp float; uniform sampler2D uTex; uniform vec2 uRes; out vec4 frag; void main() { frag = texture(uTex, gl_FragCoord.xy / uRes); }`);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  /* tex: the finished backdrop at full resolution (the orbs refract it and shade onto it); gTex: where each terrain ray landed */
  let tex = null, fbo = null, gTex = null, gFbo = null, GW = 0, GH = 0, W = 0, H = 0;
  const target = (w, h, fmt, type, ifmt, filt) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return [t, f]; };
  function resize(w, h) { if (w === W && h === H) return; W = w; H = h; canvas.width = w; canvas.height = h; [tex, gTex].forEach((t) => t && gl.deleteTexture(t)); [fbo, gFbo].forEach((f) => f && gl.deleteFramebuffer(f));
    [tex, fbo] = target(w, h, gl.RGBA, gl.UNSIGNED_BYTE, gl.RGBA8, gl.LINEAR);
    bdKey = ''; }
  let bdKey = '', bdT = -9;
  function backdrop(o) { const key = JSON.stringify(Object.assign({}, o, { time: 0 })) + W + 'x' + H; if (key !== bdKey || Math.abs((o.time || 0) - bdT) > 1 / 30 || o.force) { bdKey = key; bdT = o.time || 0; paintBackdrop(o); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H); gl.useProgram(blit.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(blit.u.uTex, 0); gl.uniform2f(blit.u.uRes, W, H); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  const imgTex = {};
  function imageTexture(id) { if (imgTex[id]) return imgTex[id]; const im = (root.AVA_LAB_IMGS || {})[id]; if (!im || !im.width) return null; const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); imgTex[id] = { t, w: im.width, h: im.height }; return imgTex[id]; }
  /* the backdrop: an image, a mesh gradient or a solid colour, painted into the texture the orbs refract and shade onto */
  function paintBackdrop(o) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H); const kind = o.kind || 'mesh';
    if (kind === 'image') { const it = imageTexture(o.image || 'swirl'); if (it) { gl.useProgram(imP.p); const u = imP.u; gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, it.t); gl.uniform1i(u.uImg, 0); gl.uniform2f(u.uRes, W, H); gl.uniform2f(u.uIS, it.w, it.h); gl.uniform1f(u.uZoom, o.zoom ?? 1); gl.uniform1f(u.uTime, o.time || 0); gl.uniform1f(u.uDrift, o.drift ?? 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return; } }
    const BK = root.AvaOrbBackdrop, soft = kind === 'solid' && o.soft && BK.SOFT[o.soft];
    if (kind === 'mesh' || kind === 'image' || soft) { const M = soft ? BK.SOFT[o.soft] : (BK.MESH[o.mesh] || BK.MESH.aura); gl.useProgram(meP.p); const u = meP.u; gl.uniform2f(u.uRes, W, H); gl.uniform1f(u.uTime, o.time || 0); gl.uniform1f(u.uDrift, o.drift ?? 1); gl.uniform1f(u.uSharp, soft ? 2.6 : 4.2); gl.uniform1f(u.uWarp, soft ? 0.38 : 0.55); gl.uniform3fv(u.uC, new Float32Array(M[1].flatMap(hex))); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return; }
    const c = hex(o.color || '#F3EEE8'); gl.clearColor(c[0], c[1], c[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  /* one orb: settings object o (see the schema), live state st = { energy, swirl, pulses:[ages], flow, bass, treble, time } */
  function draw(o, st, dark) {
    const u = orb.u, r = o.r, pad = 1.75; const sk = Object.assign({ enabled: false, amount: 1.5, density: 0.5, size: 1.37, speed: 4, light: 0, dark: 1, darkStart: -0.05, darkCurve: 1.84, lightBlend: 'normal', darkBlend: 'normal' }, o.smoke || {}); gl.useProgram(orb.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.uBack, 0);
    gl.uniform4f(u.uBox, (o.x / W) * 2 - 1, 1 - (o.y / H) * 2, (r * pad / W) * 2, (r * pad / H) * 2);
    gl.uniform2f(u.uRes, W, H); gl.uniform3f(u.uRect, o.x, o.y, r); gl.uniform1f(u.uDark, dark ? 1 : 0);
    const ages = (st.pulses || []).slice(-3); while (ages.length < 3) ages.unshift(-1);
    gl.uniform4f(u.P0, o.mode === 'sphere' ? 1 : 0, PAL[o.palette] ?? 6, o.flow.seed, st.flow);
    gl.uniform4f(u.P1, st.energy, st.swirl * o.flow.swirl, o.grain.enabled === false ? 0 : o.grain.amount, o.lift);
    gl.uniform4f(u.P2, ages[0], ages[1], ages[2], st.presence || 0);
    gl.uniform4f(u.LOOK, (o.grade.hue || 0) * Math.PI / 180, o.grade.chroma ?? 1, o.grade.light || 0, o.flow.relief ?? 1);
    gl.uniform4f(u.RIM, RIMS[o.rim.type] ?? 0, o.rim.strength ?? 1, sk.dark, sk.darkCurve);
    gl.uniform4f(u.SHD, o.shadow.amount, o.shadow.softness, o.shadow.offset, (o.material || {}).type === 'scene' ? (SCENES[(o.material || {}).scene] ?? 0) : (FIRES[(o.material || {}).fire] ?? 0));
    gl.uniform4f(u.GLS, o.glass.transparency, o.glass.ior, o.glass.magnify, o.glass.dispersion);
    gl.uniform4f(u.MAT, o.fill.density, o.fill.velocity, sk.enabled ? sk.amount : 0, sk.size);
    gl.uniform4f(u.GR2, GRAINS[o.grain.type] ?? 0, o.grain.size, sk.speed, st.time);
    gl.uniform4f(u.SND, sk.light, sk.darkStart, st.bass || 0, st.treble || 0);
    const pc = (o.custom ? o.colors : (root.AvaOrbSets.PALETTES[o.palette] || root.AvaOrbSets.PALETTES.violet).c), lc = o.custom ? (o.light || o.colors[4]) : (root.AvaOrbSets.PALETTES[o.palette] || root.AvaOrbSets.PALETTES.violet).l;
    gl.uniform1f(u.uCustom, 1); gl.uniform3fv(u.COLS, new Float32Array(pc.flatMap(hex))); gl.uniform3fv(u.LC, new Float32Array(hex(lc))); gl.uniform3fv(u.DOM, new Float32Array(dominant(pc)));
    gl.uniform4f(u.WV, WAVES[o.wave.form] ?? 0, o.wave.strength, ((o.wave.direction ?? 0) * Math.PI) / 180, sk.density); const mt = Object.assign({ type: 'field', amount: 1, velocity: 1, scale: 1 }, o.material || {}); gl.uniform4f(u.MT, mt.amount, mt.velocity, mt.scale, MATS[mt.type] ?? 0);
    const lay = [mt].concat((mt.mix || []).slice(0, 3)); while (lay.length < 4) lay.push({ type: 'none' }); gl.uniform4fv(u.ML, new Float32Array(lay.flatMap((l) => [l.amount ?? 1, l.velocity ?? 1, l.scale ?? 1, MATS[l.type] ?? 0])));
    const rk = Object.assign({ intensity: 2, variation: 0.35, size: 3 }, o.rock || {}); gl.uniform4f(u.SLO, rk.intensity, rk.variation, rk.size, (mt.aa === false ? -1 : 1) / Math.max(o.r, 1));
    gl.uniform4f(u.MOT, MOTIONS[o.motion.type] ?? 0, o.motion.strength, BLENDS[sk.lightBlend] ?? 0, BLENDS[sk.darkBlend] ?? 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.disable(gl.BLEND);
  }
  return { gl, resize, backdrop, draw, get size() { return [W, H]; } };
}
root.AvaOrbEngine = { create, PAL, RIMS, GRAINS, WAVES, MOTIONS };
})(typeof window !== 'undefined' ? window : globalThis);

/* Ava exporter: renders the current cut frame by frame and writes an MP4 in the browser.
   Video: WebCodecs VideoEncoder (H.264 first, then VP9, then AV1). Audio: the film's full mix through
   AudioEncoder (AAC, or Opus where AAC is missing). Container: mp4-muxer (MIT). */
(function (root) {
'use strict';
async function pickVideo(w, h, fps) {
  const br = (w >= 3840 ? 45e6 : w >= 2560 ? 24e6 : w >= 1920 ? 14e6 : 7e6) * (fps > 30 ? 1.5 : 1), lvl = w >= 3840 ? (fps > 30 ? '34' : '33') : w >= 2560 ? (fps > 30 ? '33' : '32') : w >= 1920 ? (fps > 30 ? '2A' : '28') : (fps > 30 ? '20' : '1F');
  const cands = [{ codec: 'avc1.6400' + lvl, mux: 'avc' }, { codec: 'avc1.4D00' + lvl, mux: 'avc' }, { codec: 'avc1.4200' + lvl, mux: 'avc' }, { codec: 'vp09.00.40.08', mux: 'vp9' }, { codec: 'av01.0.08M.08', mux: 'av1' }];
  for (const c of cands) { const cfg = { codec: c.codec, width: w, height: h, bitrate: br, framerate: fps, latencyMode: 'quality' }; try { const s = await VideoEncoder.isConfigSupported(cfg); if (s.supported) return { ...c, cfg }; } catch (e) { /* try the next codec */ } }
  return null;
}
async function pickAudio(sr) {
  if (!('AudioEncoder' in root)) return null;
  for (const c of [{ codec: 'mp4a.40.2', mux: 'aac', rate: sr }, { codec: 'mp4a.40.2', mux: 'aac', rate: 48000 }, { codec: 'opus', mux: 'opus', rate: 48000 }]) {
    const cfg = { codec: c.codec, sampleRate: c.rate, numberOfChannels: 2, bitrate: 192000 }; try { const s = await AudioEncoder.isConfigSupported(cfg); if (s.supported) return { ...c, cfg }; } catch (e) { /* next */ } }
  return null;
}
async function resample(buf, rate, dur) {
  if (buf.sampleRate === rate) return [buf.getChannelData(0), buf.getChannelData(1)];
  const oc = new OfflineAudioContext(2, Math.ceil(dur * rate), rate), src = oc.createBufferSource(); src.buffer = buf; src.connect(oc.destination); src.start(); const r = await oc.startRendering(); return [r.getChannelData(0), r.getChannelData(1)];
}
async function exportMP4({ film, render, settle, master, duration, w = 1920, h = 1080, fps = 30, onProgress = () => {}, signal = { cancelled: false } }) {
  if (!('VideoEncoder' in root) || !('VideoFrame' in root)) throw new Error('This browser cannot encode video. Try a recent Chrome, Edge, Safari or desktop Firefox.');
  const M = root.Mp4Muxer; if (!M) throw new Error('The MP4 writer did not load.');
  const vc = await pickVideo(w, h, fps); if (!vc) throw new Error('No MP4 video codec is available in this browser.');
  const ac = master ? await pickAudio(master.sampleRate) : null;
  const muxer = new M.Muxer({ target: new M.ArrayBufferTarget(), video: { codec: vc.mux, width: w, height: h }, audio: ac ? { codec: ac.mux, sampleRate: ac.cfg.sampleRate, numberOfChannels: 2 } : undefined, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failure = null;
  if (ac) {
    const enc = new AudioEncoder({ output: (c, m) => muxer.addAudioChunk(c, m), error: (e) => (failure = e) }); enc.configure(ac.cfg);
    const [L, R] = await resample(master, ac.cfg.sampleRate, duration), total = Math.min(L.length, Math.ceil(duration * ac.cfg.sampleRate)), step = 4800;
    for (let i = 0; i < total; i += step) { const n = Math.min(step, total - i), data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: ac.cfg.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / ac.cfg.sampleRate) * 1e6), data }); enc.encode(ad); ad.close(); }
    await enc.flush(); enc.close();
  }
  const venc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (failure = e) }); venc.configure(vc.cfg);
  const out = document.createElement('canvas'); out.width = w; out.height = h; const og = out.getContext('2d');
  const N = Math.ceil(duration * fps), t0 = performance.now();
  for (let f = 0; f < N; f++) {
    if (signal.cancelled) { try { venc.close(); } catch (e) { /* already closed */ } return null; }
    if (failure) throw failure;
    const T = f / fps; await settle(() => render(T)); render(T);
    og.drawImage(film, 0, 0, w, h);
    const vf = new VideoFrame(out, { timestamp: Math.round(T * 1e6), duration: Math.round(1e6 / fps) }); venc.encode(vf, { keyFrame: f % (fps * 2) === 0 }); vf.close();
    while (venc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
    if (f % 2 === 0 || f === N - 1) { const el = (performance.now() - t0) / 1000; onProgress(f + 1, N, el, (el / (f + 1)) * (N - f - 1)); await new Promise((r) => setTimeout(r, 0)); }
  }
  await venc.flush(); venc.close(); if (failure) throw failure; muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), codec: vc.codec, audio: ac ? ac.codec : 'none' };
}
/* in the published artifact the viewer confirms the save; elsewhere, a plain download */
async function save(blob, filename) {
  try { if (root.claude && root.claude.use) { const d = await root.claude.use('downloads'); if (d) { const r = await d.save({ filename, data: blob }); return r.status; } } }
  catch (e) { if (e && e.code) return e.code; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); return 'downloaded';
}
root.AvaExport = { exportMP4, save };
})(window);
