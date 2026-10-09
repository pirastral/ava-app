// =====================================================================================
// 162 · SPEAKERS — any number, for every engine. Each line is its own request, so a line that
//       starts with a known speaker's «Name:» simply takes that speaker's engine and voice; the
//       name is never spoken. An unnamed line continues the previous speaker. The video tab
//       shows exactly these speakers (one orb each).
// =====================================================================================
const SPK_LINE = /^(\s*(?:\{[^}]*\}\s*)?)([^:：\n{}<>|]{1,24})[:：]\s*/;
const SPK0 = name => ({ id: 's' + (++uid), name: name || '', engine: '', gVoice: (S.proj && S.proj.g_voice) || '', gModel: '', gPreset: '', gState: '', fishVoice: (S.proj && S.proj.fish && S.proj.fish.voice) || '', cbxVoice: (S.proj && S.proj.cbx && S.proj.cbx.voice) || '' });   // 176: the project's voices, chosen
function migrateSpeakers(){
  const out = [], has = n => out.some(o => o.name === n);
  (typeof CAST !== 'undefined' ? CAST : []).forEach(c => { if (c.name && !has(c.name)) out.push({ ...SPK0(c.name), gVoice: c.voice || '', gState: c.style || '' }); });
  const d = S.proj.duo; if (d && d.on) [d.a, d.b].forEach(x => { if (x && x.name && !has(x.name)) out.push({ ...SPK0(x.name), gVoice: x.voice || '' }); });
  ((S.proj.fish || {}).speakers || []).forEach(x => { if (x.name && !has(x.name)) out.push({ ...SPK0(x.name), engine: 'fish', fishVoice: x.voice || '', gPreset: x.preset || '' }); });
  return out;
}
function spkList(){ if (!Array.isArray(S.proj.speakers)) S.proj.speakers = migrateSpeakers(); return S.proj.speakers; }
const spkByName = n => spkList().find(s => s.name && s.name === String(n || '').trim());

function spkVoice(id){
  const sp = speakerOfLine(id); if (!sp) return {}; const v = {};
  if (sp.engine) v.engine = sp.engine; ['gVoice', 'gModel', 'gPreset', 'gState', 'fishVoice', 'cbxVoice'].forEach(k => { if (sp[k]) v[k] = sp[k]; });   // 176: + the speaker's model
  return v;
}
// what is actually sent: the line without a KNOWN speaker's name (a line tone {…} stays); shift maps word offsets back

const spoken = id => spokenInfo(id).s;
const shiftWords = (W, off, cuts) => W ? W.map(w => { const add = p => (cuts || []).reduce((acc, [cp, ln]) => acc + (cp <= p ? ln : 0), 0); return { ...w, c0: w.c0 + off + add(w.c0), c1: w.c1 + off + add(Math.max(w.c0, w.c1 - 1)) }; }).filter(w => w.c1 > 0) : null;
const shiftWordsFor = (W, id) => { const si = spokenInfo(id); return shiftWords(W, si.shift, si.cuts); };   // words inside the unsent tone prefix are dropped


function spkEngine(sp){ return sp.engine || S.proj.engine; }
function spkVoiceOptions(sp){
  const e = spkEngine(sp);
  if (e === 'google') return voiceOptions(sp.gVoice || '', false).replace('<optgroup', `<option value="" ${sp.gVoice ? '' : 'selected'}>${T('— صدای پروژه —', "— project's voice —")}</option><optgroup`);
  if (e === 'fish') return `<option value="">${T('— صدای پروژه —', "— project's voice —")}</option>` + fishOptions(sp.fishVoice || '');   // 169: the groups survive (copying .options flattened them)
  if (e === 'chatterbox') return `<option value="">${T('— صدای پروژه —', "— project's voice —")}</option><option value="default" ${sp.cbxVoice === 'default' ? 'selected' : ''}>${T('پیش‌فرض', 'Default')}</option>` + cbxGroups(CBX_VOICES, sp.cbxVoice, false);
  return null;                                                                                        // a light voice IS its engine
}
const SPK_VKEY = { google: 'gVoice', fish: 'fishVoice', chatterbox: 'cbxVoice' };

// =====================================================================================
// 162 · VOICE PREVIEWS — «پایَنده ایران، جاوید شاه!»: from the app package when bundled,
//       otherwise made once on first play (and cached by the engine)
// =====================================================================================
const LIGHT_ENGINES = ['mana', 'gyro', 'amir'];
function previewPayload(engine, voice){
  const v = { engine, gVoice: S.proj.g_voice, gPreset: 'neutral', gState: '' };
  if (engine === 'google' && voice) v.gVoice = voice; if (engine === 'fish' && voice) v.fishVoice = voice; if (engine === 'chatterbox' && voice) v.cbxVoice = voice;
  return payloadFor(v, 'پایَنده ایران، جاوید شاه!');
}
// 176: every Chatterbox voice and every Fish «نمونه» voice (a Chatterbox clip used as Fish's reference) has its own file
function pvName(id){ const s = String(id || ''), base = s.replace(/\.(wav|mp3|flac|ogg|m4a)$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_'); let h = 0; for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0; return base + '_' + h.toString(36); }
function bundledPreview(engine, voice){
  if (engine === 'google' && voice && !/^(lib|design|clone):/.test(voice)) return `previews/google/${S.proj.g_model}/${voice}.mp3`;
  if (LIGHT_ENGINES.includes(engine)) return `previews/light/${engine}.mp3`;
  if ((engine === 'chatterbox' || engine === 'fish') && (!voice || voice === 'default')) return `previews/${engine}/default.mp3`;
  if (engine === 'chatterbox') return `previews/chatterbox/${pvName(voice)}.mp3`;
  if (engine === 'fish' && /^[bu]:/.test(String(voice))) return `previews/fish/${pvName(voice)}.mp3`;
  return null;
}
async function previewVoice(engine, voice){
  const key = 'pv:' + engine + ':' + (voice || '') + ':' + S.proj.g_model; if (prevKey === key && !PREV.paused) return stopPreview();
  const url = bundledPreview(engine, voice);
  if (url && await new Promise(res => { const a = new Audio(); a.oncanplaythrough = () => res(true); a.onerror = () => res(false); a.src = url; setTimeout(() => res(false), 1500); })) return togglePreview(key, url);
  say(T('نمونهٔ صدا ساخته می‌شود…', 'Making the voice sample…'), 'ok');
  const r = await API().voice_preview(previewPayload(engine, voice)); if (!r || !r.ok) return say((r && r.error) || T('نمونه ساخته نشد.', 'Could not make the sample.'), 'err');
  say('', 'ok'); togglePreview(key, URL.createObjectURL(b64Blob(r.b64, 'audio/mpeg')));
}
function previewSpeaker(i){ const sp = spkList()[i], e = spkEngine(sp); previewVoice(e, e === 'google' ? (sp.gVoice || S.proj.g_voice) : e === 'fish' ? (sp.fishVoice || S.proj.fish.voice) : e === 'chatterbox' ? (sp.cbxVoice || S.proj.cbx.voice) : null); }
// 177 · the samples of every built-in voice ship with the app (levelled to one loudness: tools/level_previews.py); a
//       voice of your own gets its sample once, when it is made, and keeps it (the engine's cache, keyed by the voice)
function makeSampleNow(engine, voice){ try { setTimeout(() => { API().voice_preview(previewPayload(engine, voice)).catch(() => {}); }, 300); } catch (e) {} }

// =====================================================================================
// 164 · speaker and tone are LINE PROPERTIES shown as chips at the start of each line (as in the mock);
//       every line has an avatar button that opens a speaker menu. Sound tags show as pills.
// =====================================================================================
const SPK_COLORS = ['#5b7cff', '#22c4b5', '#f2b233', '#e5677e', '#9b7bff', '#4cc38a', '#ff8a4c', '#3fb6e8'];
const spkColor = k => SPK_COLORS[((k % SPK_COLORS.length) + SPK_COLORS.length) % SPK_COLORS.length];
const initials = n => { const w = String(n || '').trim().split(/\s+/).filter(Boolean); return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase(); };
function speakerOfLine(id){ const L = S.lines[id]; return (L && L.spk && spkList().find(s => s.id === L.spk)) || null; }
// what is sent: the line tone first (3.8 reads it), then the text; shift maps word offsets back onto the editor text
const OVL_RE = /\|([^|\n]{1,60})\|/g;
// 171: the line tone in each engine's own form — Gemini {tone}; Fish its bracket cue; Chatterbox and the light voices NONE (they read it aloud)
const TONE_FISH = { 'شاد': '[happy]', 'آرام': '[calm]', 'غمگین': '[sad]', 'عصبانی': '[angry]', 'ترسیده': '[scared]', 'مضطرب': '[nervous]', 'متفکر': '[curious]', 'عاشقانه و مهربان': '[soft tone]', 'مطمئن': '[confident]', 'خسته و بی‌رمق': '[depressed]', 'در حال گریه': '[sobbing]', 'شیطون و بازیگوش': '[excited]', 'متعجب': '[surprised]', 'مصمم': '[confident]', 'دلتنگِ گذشته': '[nostalgic]', 'حماسی و قهرمانانه': '[very excited]', 'مراقبه‌وار': '[calm]' };
function tonePrefix(id){ const L = S.lines[id] || {}; if (!L.tone) return ''; const eng = typeof lineEngine === 'function' ? lineEngine(id) : 'google';
  if (eng === 'google'){ if (lineProfile(id) === 'g31') return L.tone.startsWith('[') ? L.tone + ' ' : `[${String(TONE_EN[L.tone] || L.tone).toLowerCase()}] `; return `{${L.tone}} `; }   /* 177: on 3.1 the tone is that line's own direction tag */ if (eng === 'fish') return (TONE_FISH[L.tone] || (L.tone.startsWith('[') ? L.tone : '')) + (TONE_FISH[L.tone] || L.tone.startsWith('[') ? ' ' : ''); return ''; }
function spokenInfo(id){ const L = S.lines[id] || {}, t = L.text || '', pre = tonePrefix(id), body = t.trim();
  // 169: overlaps |…| are NOT read by the line's voice — each is voiced by its own speaker and laid over the line
  const cuts = []; let s = '', last = 0; body.replace(new RegExp(OVL_RE.source, 'g'), (m, inner, off) => { s += body.slice(last, off); cuts.push([pre.length + s.length, m.length]); last = off + m.length; return m; }); s += body.slice(last);
  return { s: pre + s, shift: (t.length - t.trimStart().length) - pre.length, cuts }; }
// old documents and pasted scripts: a leading {tone} becomes the tone; a leading «Name:» of a known speaker becomes the speaker
function normLine(L){
  if (!L || typeof L.text !== 'string') return; let t = L.text, m;
  if ((m = /^\s*\{([^{}\n]{1,40})\}\s*/.exec(t))){ L.tone = m[1].trim(); t = t.slice(m[0].length); }
  if ((m = SPK_LINE.exec(t)) && spkByName(m[2])){ L.spk = spkByName(m[2]).id; t = t.slice(m[0].length); if (m[1] && /\{([^{}]+)\}/.test(m[1])) L.tone = /\{([^{}]+)\}/.exec(m[1])[1].trim(); }
  if ((m = /^\s*\{([^{}\n]{1,40})\}\s*/.exec(t))){ L.tone = m[1].trim(); t = t.slice(m[0].length); }   // a tone written after the name
  L.text = t;
}
function spkSummary(sp){ const e = spkEngine(sp), en = engShort(e);
  const voice = e === 'google' ? (sp.gVoice || S.proj.g_voice) : e === 'fish' ? (((([...($('fishVoice') || { options: [] }).options].find(o => o.value === (sp.fishVoice || S.proj.fish.voice))) || {}).text) || sp.fishVoice || T('صدای پروژه', "project's voice")) : e === 'chatterbox' ? (sp.cbxVoice || S.proj.cbx.voice) : '';
  const style = sp.gPreset ? presetName(sp.gPreset) : ''; return [en, voice, style].filter(Boolean).join(' · '); }
function setSpk(i, k, v){ remember(); const sp = spkList()[i]; sp[k] = v; markDirty(id => (S.lines[id] || {}).spk === sp.id); renderSpeakers(); renderScript(); autosave(); if (typeof VVER !== 'undefined') VVER++; }
function delSpeaker(i){ remember(); const sp = spkList()[i]; spkList().splice(i, 1); Object.values(S.lines).forEach(L => { if (L.spk === sp.id){ L.spk = undefined; L.dirty = true; } }); SPK_OPEN = null; renderSpeakers(); renderScript(); autosave(); }
let SPK_OPEN = null;
function toggleSpkEdit(id){ SPK_OPEN = SPK_OPEN === id ? null : id; renderSpeakers(); }
function addSpeaker(){ remember(); const n = spkList().length + 1, sp = SPK0(T(`گوینده ${FA(n)}`, `Speaker ${n}`)); spkList().push(sp); SPK_OPEN = sp.id; renderSpeakers(); autosave();
  const box = $('spkOpen'); if (box) box.checked = true; setTimeout(() => { const el = document.querySelector(`#spkList [data-edit="${sp.id}"] input`); if (el){ el.focus(); el.select(); } }, 30); }
function openSpeakers(addNew){ showInsp('proj', true); const box = $('spkOpen'); if (box) box.checked = true; if (addNew) addSpeaker(); }
// 168: speaker colours come from the theme (8 warm-leaning colours, light and dark tones); a speaker may carry a photo
const spkN = k => ((k % 8) + 8) % 8 + 1;
const spkBg = k => `background:var(--spk${spkN(k)});color:var(--spk${spkN(k)}-on)`;
const spkVars = k => `--sc:var(--spk${spkN(k)});--si:var(--spk${spkN(k)}-ink);--so:var(--spk${spkN(k)}-on)`;
const spkFace = sp => sp && sp.photo ? `<img src="${sp.photo}" alt="" class="size-full rounded-full object-cover">` : escapeHtml(initials((sp && sp.name) || ''));
function pickSpkPhoto(i){
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { const f = inp.files && inp.files[0]; if (!f) return; const rd = new FileReader();
    rd.onload = () => { const im = new Image(); im.onload = () => { const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), s = Math.max(N / im.width, N / im.height);
      g.drawImage(im, (N - im.width * s) / 2, (N - im.height * s) / 2, im.width * s, im.height * s); setSpkPhoto(i, c.toDataURL('image/jpeg', 0.86)); }; im.src = rd.result; };
    rd.readAsDataURL(f); };
  inp.click(); }
// the photo is not a voice change: no line is marked for re-voicing
function setSpkPhoto(i, url){ const sp = spkList()[i]; if (!sp) return; remember(); if (url) sp.photo = url; else delete sp.photo; renderSpeakers(); renderScript(); autosave(); if (typeof VVER !== 'undefined') VVER++; }
function renderSpeakers(){
  const box = $('spkList'); if (!box) return; const L = spkList(); if ($('spkCount')) $('spkCount').textContent = FA(L.length);
  box.innerHTML = L.map((sp, i) => { const e = spkEngine(sp), vo = spkVoiceOptions(sp), vk = SPK_VKEY[e], open = SPK_OPEN === sp.id;
    return `<li class="list-row items-center gap-3 py-2">
        <div class="group/av relative shrink-0"><button class="grid size-10 place-items-center overflow-hidden rounded-full text-sm font-bold" style="${spkBg(i)}" onclick="pickSpkPhoto(${i})" data-tip="${sp.photo ? 'عوض کردنِ عکس' : 'افزودنِ عکس'}" data-tip-en="${sp.photo ? 'Change photo' : 'Add a photo'}" aria-label="photo">${spkFace(sp)}</button>${sp.photo ? `<div class="spkph-act pointer-events-none absolute inset-0 flex items-center justify-center gap-0.5 rounded-full bg-black/55 opacity-0 transition-opacity group-hover/av:pointer-events-auto group-hover/av:opacity-100"><button class="grid size-5 place-items-center rounded-full text-white hover:bg-white/25" onclick="pickSpkPhoto(${i})" data-tip="عوض کردنِ عکس" data-tip-en="Change photo" aria-label="change photo"><svg class="size-3"><use href="#i-refresh-cw"/></svg></button><button class="grid size-5 place-items-center rounded-full text-white hover:bg-white/25" onclick="setSpkPhoto(${i}, null)" data-tip="حذفِ عکس" data-tip-en="Remove photo" aria-label="remove photo"><svg class="size-3"><use href="#i-trash-2"/></svg></button></div>` : `<span class="pointer-events-none absolute -bottom-0.5 -end-0.5 grid size-4 place-items-center rounded-full bg-base-100 text-base-content/70 opacity-0 shadow-sm transition-opacity group-hover/av:opacity-100"><svg class="size-2.5"><use href="#i-camera"/></svg></span>`}</div>
        <button class="min-w-0 cursor-pointer text-start" onclick="toggleSpkEdit('${sp.id}')"><div class="truncate text-sm font-semibold">${escapeHtml(sp.name || T('بی‌نام', 'Unnamed'))}</div><div class="truncate text-xs text-base-content/60">${escapeHtml(spkSummary(sp))}</div></button>
        <button class="btn btn-ghost btn-sm btn-circle" onclick="previewSpeaker(${i})" data-tip="شنیدنِ صدا" data-tip-en="Hear the voice" aria-label="play"><svg class="size-4"><use href="#i-play"/></svg></button>
      </li>${open ? `<li class="space-y-2 border-t border-base-300 px-3 pb-3 pt-2" data-edit="${sp.id}">
        <input class="input input-sm w-full" dir="auto" value="${escapeHtml(sp.name)}" placeholder="${T('نام', 'Name')}" onchange="setSpk(${i}, 'name', this.value.trim())">
        <select class="select select-sm w-full" onchange="setSpk(${i}, 'engine', this.value)"><option value="">${T('موتورِ پروژه', "The project's engine")}</option>${ENGINES.map(([v, l]) => `<option value="${v}" ${v === sp.engine ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select>
        ${e === 'google' ? `<select class="select select-sm w-full" onchange="setSpk(${i}, 'gModel', this.value)"><option value="">${T('مدلِ پروژه', "The project's model")}: ${escapeHtml(modelShort(S.proj.g_model))}</option>${MODELS.map(m => `<option value="${m[0]}" ${m[0] === sp.gModel ? 'selected' : ''}>${escapeHtml(modelShort(m[0]))}</option>`).join('')}</select>` : ''}
        ${vo ? `<select class="select select-sm w-full" data-spk-voice="${i}" data-preview="${e}" onchange="setSpk(${i}, '${vk}', this.value)">${vo}</select>` : ''}
        ${e === 'google' || e === 'fish' ? `<select class="select select-sm w-full" onchange="setSpk(${i}, 'gPreset', this.value)"><option value="">${T('سبکِ پروژه', "The project's style")}</option>${G_PRESETS.map(p => `<option value="${escapeHtml(p[0])}" ${p[0] === sp.gPreset ? 'selected' : ''}>${escapeHtml(p[1])}</option>`).join('')}</select>` : ''}
        <div class="flex justify-end"><button class="btn btn-ghost btn-sm gap-1.5 text-error" onclick="delSpeaker(${i})"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('حذفِ گوینده', 'Remove speaker')}</button></div></li>` : ''}`; }).join('')
    || `<li class="px-3 py-3 text-xs text-base-content/60">${T('هنوز گوینده‌ای نیست؛ همهٔ خط‌ها با صدای پروژه خوانده می‌شوند.', "No speakers yet; every line uses the project's voice.")}</li>`;
  box.querySelectorAll('select').forEach(el => { enh(el); if (el.dataset.spkVoice !== undefined){ const i = +el.dataset.spkVoice; el._preview = v => previewVoice(spkEngine(spkList()[i]), v || null); } });
}
// the chips at the start of a line
function spkChip(id){ const L = S.lines[id], sp = speakerOfLine(id), k = sp ? spkList().indexOf(sp) : -1;
  return sp ? `<button class="spkchip me-1 inline-flex max-w-[12rem] items-center border gap-1.5 rounded-full py-0.5 pe-2.5 ps-0.5 align-middle text-xs font-semibold" style="${spkVars(k)}" contenteditable="false" onmousedown="event.preventDefault()" onclick="openSpkMenu(event, ${id})"><span class="spkav grid size-5 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold">${spkFace(sp)}</span><span class="truncate">${escapeHtml(sp.name)}</span></button>`
    : `<button class="spkchip spkph me-1 inline-grid size-6 place-items-center rounded-full border border-dashed border-base-content/30 align-middle text-base-content/45 hover:border-primary hover:text-primary" contenteditable="false" onmousedown="event.preventDefault()" onclick="openSpkMenu(event, ${id})" data-tip="گوینده‌ی این خط" data-tip-en="This line's speaker"><svg class="size-3.5"><use href="#i-user-round-plus"/></svg></button>`; }
function toneChip(id){ const L = S.lines[id]; return L && L.tone ? `<button class="badge badge-soft badge-accent badge-sm me-1 gap-1 align-middle" contenteditable="false" onmousedown="event.preventDefault()" onclick="openToneMenu(event, ${id})"><svg class="size-3"><use href="#i-smile"/></svg>${escapeHtml(toneLabel(L.tone))}</button>` : ''; }
// 177 · A SOUND TAG IS A CHIP LIKE THE LINE'S TONE — the same daisyUI badge; a click opens a menu with Delete first and
//       the other tags of the line's engine; no ✕. The raw characters stay in the text (hidden), so offsets never move.
const TAG_RAW_RE = /<[^<>\n]{1,40}>|\[[^\[\]\n]{1,40}\]/g;
function soundTagLists(p){ if (p === 'fish') return (DIRECTOR.fish_tags || []).map(([g, list]) => [groupLabel(g), list]);
  if (p === 'cbx' || p === 'light') return [[T('مکث', 'Pauses'), ['[مکث]', '[مکث بلند]']]];
  if (p === 'g25') return []; if (p === 'g38') return G38_TAGS.map(([g, list]) => [groupLabel(g), list]);
  return G_TAGS.map(([g, list]) => [groupLabel(g), list]); }
function isSoundTag(raw){ raw = String(raw || '').trim(); if (raw.startsWith('<')) return true;
  return G_TAGS.some(([, l]) => l.includes(raw)) || (DIRECTOR.fish_tags || []).some(([, l]) => l.includes(raw)) || raw === '[مکث]' || raw === '[مکث بلند]' || raw === '[short pause]' || raw === '[long pause]'; }
function tagChipHtml(o, inner, c){ return `<span class="tagpill badge badge-soft badge-accent badge-sm gap-1 align-middle" data-tagchip="1"><svg class="size-3" contenteditable="false"><use href="#i-audio-lines"/></svg><span class="tp-x">${o}</span>${inner}<span class="tp-x">${c}</span></span>`; }
function tagChipRaw(pill){ return [...pill.childNodes].filter(n => n.nodeType === 3 || (n.classList && n.classList.contains('tp-x'))).map(n => n.textContent).join('').trim(); }
function openTagChip(pill){ const ln = pill.closest('.ln'), id = ln ? +ln.dataset.id : null, L = id != null ? S.lines[id] : null; if (!L) return;
  const chips = [...ln.querySelectorAll('.lt .tagpill[data-tagchip]')], k = chips.indexOf(pill), raw = tagChipRaw(pill), groups = soundTagLists(lineProfile(id));
  const item = t => `<li><a dir="ltr" data-tagpick="${escapeHtml(t)}" class="${t === raw ? 'menu-active' : ''}">${escapeHtml(t.replace(/^[<\[]|[>\]]$/g, ''))}</a></li>`;
  const html = `<ul class="menu menu-sm w-full p-1"><li class="mb-1 border-b border-base-300 pb-1"><a data-tagpick="" class="gap-2 text-error"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('حذفِ این تگ', 'Delete this tag')}</a></li>`
    + groups.map(([g, list]) => `<li class="menu-title">${escapeHtml(g)}</li>` + list.map(item).join('')).join('') + `</ul>`;
  lineMenu(pill, html, e => { const a = e.target.closest('[data-tagpick]'); if (!a) return; closeDD(); setTagAt(id, k, raw, a.dataset.tagpick); }); }
function setTagAt(id, k, raw, to){ const L = S.lines[id]; if (!L) return; const text = L.text || ''; let n = -1, hit = null; TAG_RAW_RE.lastIndex = 0; let m;
  while ((m = TAG_RAW_RE.exec(text))){ if (!isSoundTag(m[0])) continue; n++; if (n === k){ hit = m; break; } }
  if (!hit || hit[0].trim() !== raw){ const i = text.indexOf(raw); if (i < 0) return; hit = { index: i, 0: raw }; }
  remember(); const a = hit.index, b = a + hit[0].length;
  L.text = to ? text.slice(0, a) + to + text.slice(b) : (text.slice(0, a).replace(/[ \u00a0]+$/, '') + (text.slice(b).match(/^[ \u00a0]*/)[0] ? ' ' : '') + text.slice(b).replace(/^[ \u00a0]+/, '')).replace(/^ +/, '');
  if (typeof afterChange === 'function') afterChange(); else { renderScript(); autosave(); } }
document.addEventListener('click', ev => { const pill = ev.target.closest && ev.target.closest('#editor .tagpill[data-tagchip]'); if (!pill) return; ev.preventDefault(); ev.stopPropagation(); openTagChip(pill); }, true);
document.addEventListener('mousedown', ev => { if (ev.target.closest && ev.target.closest('#editor .tagpill[data-tagchip]')) ev.preventDefault(); }, true);   // the caret stays where it was
// sound tags <…>, backchannels |…| and IPA /…/ as pills — the raw characters stay in the text (hidden), so offsets never move
function pills(html){
  return html.split(/(<[^>]+>)/).map(part => part.startsWith('<') ? part : part
    .replace(/&lt;([^&]{1,40}?)&gt;/g, (m, inner) => tagChipHtml('&lt;', inner, '&gt;'))   /* 177: the line tone's chip; a click opens its menu */
    .replace(/\[([^\[\]]{1,40})\]/g, (m, inner) => isSoundTag('[' + inner + ']') ? tagChipHtml('[', inner, ']') : m)
    .replace(/\|([^|]{1,60}?)\|/g, (m, inner) => { const mm = /^\s*([^:：|]{1,30})[:：]\s*/.exec(inner), s0 = mm && spkByName(mm[1]), k = s0 ? spkList().indexOf(s0) : -1;   // 169
      const av = `<span class="ovav spkav grid size-5 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold" contenteditable="false" style="${k >= 0 ? spkVars(k) + ';background:var(--sc);color:var(--so)' : ''}">${k >= 0 ? spkFace(s0) : '<svg class="size-3"><use href="#i-user"/></svg>'}</span>`;   /* 175: the speaker chip's own avatar — same size, same initials */
      const rest = mm && s0 ? inner.slice(mm[0].length) : inner, md = /^(\s*\{[^{}]{1,40}\}\s*)/.exec(rest);
      return `<span class="tagpill pipe" data-ovl="1"><span class="tp-x">|</span>${av}${mm && s0 ? `<span class="tp-x">${mm[0]}</span>` : ''}${md ? `<span class="ovmood">${md[1]}</span>${rest.slice(md[1].length)}` : rest}<span class="tp-x">|</span></span>`; })
    .replace(/(^|\s)\/([^/\s][^/]{0,60}?)\//g, '$1<span class="tagpill ipa"><span class="tp-x">/</span>$2<span class="tp-x">/</span></span>')).join('');
}
function placeMenu(m, b, w){ const r = b.getBoundingClientRect(); m.style.width = Math.min(w, innerWidth - 16) + 'px'; m.style.maxHeight = Math.min(380, Math.max(160, Math.max(innerHeight - r.bottom, r.top) - 16)) + 'px';
  m.style.left = Math.max(8, Math.min(innerWidth - Math.min(w, innerWidth - 16) - 8, r.right - Math.min(w, innerWidth - 16))) + 'px';
  const below = innerHeight - r.bottom > 220 || innerHeight - r.bottom > r.top; m.style.top = below ? (r.bottom + 4) + 'px' : ''; m.style.bottom = below ? '' : (innerHeight - r.top + 4) + 'px'; }
function lineMenu(b, html, onPick){ const m = $('ddMenu'); if (m.parentElement !== document.body) document.body.appendChild(m); m._sel = null; m.dir = lang === 'fa' ? 'rtl' : 'ltr'; m.innerHTML = html; m.classList.remove('hidden'); placeMenu(m, b, 280); m.onclick = e => onPick(e); }
function linesFor(id){ return sel.has(+id) && sel.size > 1 ? [...sel] : [+id]; }
function openSpkMenu(ev, id){
  ev.stopPropagation(); const L = spkList(), cur = (S.lines[id] || {}).spk || '';
  const row = (sp, k) => `<li><a data-spk="${sp ? sp.id : ''}" class="gap-2 ${cur === (sp ? sp.id : '') ? 'menu-active' : ''}">${sp ? `<span class="grid size-6 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold" style="${spkBg(k)}">${spkFace(sp)}</span><span class="min-w-0 flex-1"><span class="block font-semibold">${escapeHtml(sp.name)}</span><span class="block truncate text-xs text-base-content/60">${escapeHtml(spkSummary(sp))}</span></span>` : `<span class="size-6 shrink-0 rounded-full border border-dashed border-base-content/30"></span><span class="flex-1">${T('بدونِ گوینده — صدای پروژه', "No speaker — the project's voice")}</span>`}</a></li>`;
  lineMenu(ev.currentTarget, `<ul class="menu menu-sm w-full p-1">${cur ? `<li class="mb-1 border-b border-base-300 pb-1"><a data-spk="" class="gap-2 text-error"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('حذفِ گوینده از این خط', 'Remove the speaker from this line')}</a></li>` : ''}${L.map(row).join('')}${row(null)}<li class="mt-1 border-t border-base-300 pt-1"><a data-spk-add class="gap-2"><svg class="size-4"><use href="#i-plus"/></svg>${T('افزودنِ گوینده…', 'Add a speaker…')}</a></li></ul>`, e => {
    const a = e.target.closest('[data-spk]'), add = e.target.closest('[data-spk-add]'); if (add){ closeDD(); openSpeakers(true); return; } if (!a) return;
    remember(); linesFor(id).forEach(x => { const LL = S.lines[x]; if (!LL) return; const was = LL.spk || ''; LL.spk = a.dataset.spk || undefined; if (was !== (a.dataset.spk || '')){ const [, c] = clipOfLine(x); if (c && !c.unvoiced) LL.dirty = true; } });
    closeDD(); renderScript(); autosave(); if (typeof VVER !== 'undefined') VVER++; });
}
function toneList(){ const el = $('toneMenu'); const v = el ? [...el.querySelectorAll('[data-tone]')].map(a => a.dataset.tone).filter(Boolean) : []; return v.length ? v : ['شاد', 'آرام', 'غمگین', 'سوگوار']; }
function openToneMenu(ev, id){ ev.stopPropagation(); const cur = (S.lines[id] || {}).tone || '';
  lineMenu(ev.currentTarget, `<ul class="menu menu-sm w-full p-1">${cur ? `<li class="mb-1 border-b border-base-300 pb-1"><a data-tone-pick="" class="gap-2 text-error"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('حذفِ لحن', 'Remove the tone')}</a></li>` : ''}${toneList().map(t => `<li><a data-tone-pick="${escapeHtml(t)}" class="${t === cur ? 'menu-active' : ''}">${escapeHtml(toneLabel(t))}</a></li>`).join('')}<li class="mt-1 border-t border-base-300 pt-1"><a data-tone-pick="">${T('— لحنِ پروژه —', "— the project's tone —")}</a></li></ul>`, e => {
    const a = e.target.closest('[data-tone-pick]'); if (!a) return; sel = new Set(linesFor(id)); closeDD(); setTone(a.dataset.tonePick); });
}
// paste: «Name:» and «{tone}» become chips; a script whose names recur gets its speakers; unnamed lines keep the previous speaker
function pasteParts(parts){
  const names = parts.map(p => { const m = SPK_LINE.exec(p.replace(/^\s*\{[^{}\n]{1,40}\}\s*/, '')); return m ? m[2].trim() : null; }).filter(Boolean);
  const counts = names.reduce((a, n) => (a[n] = (a[n] || 0) + 1, a), {}), distinct = Object.keys(counts);
  let added = 0; if (distinct.length >= 2 || Object.values(counts).some(c => c >= 2)) distinct.forEach(n => { if (!spkByName(n)){ spkList().push(SPK0(n)); added++; } });
  if (added) setTimeout(() => { try { renderSpeakers(); } catch (e) {} }, 0);   // 177: the Speakers list and its count show them at once (they waited for the next redraw)
  let last; return parts.map(p => { const L = { text: p, dirty: false, voice: null }; normLine(L); if (L.spk) last = L.spk; else if (last) L.spk = last; return L; });
}

// =====================================================================================
// 169 · OVERLAPS |…| — a reaction voiced by its OWN speaker and laid over the line at the point where it sits
//       (the line's voice never reads it and never pauses). «|مریم: آره|» names the speaker; «|آره|» is the first OTHER speaker.
// =====================================================================================
function ovlList(id){ const t = (S.lines[id] || {}).text || '', out = [], re = new RegExp(OVL_RE.source, 'g'); let m;
  while ((m = re.exec(t))){ const mm = /^\s*([^:：|]{1,30})[:：]\s*/.exec(m[1]), s0 = mm && spkByName(mm[1]); let body = (s0 ? m[1].slice(mm[0].length) : m[1]).trim(); const md = /^\{([^{}]{1,40})\}\s*/.exec(body); if (md) body = body.slice(md[0].length).trim();
    out.push({ pos: m.index, end: m.index + m[0].length, raw: m[0], text: body, mood: md ? md[1] : '', spk: s0 || null }); }
  return out; }
function ovlSpeaker(id, o){ if (o.spk) return o.spk; const own = speakerOfLine(id); return spkList().find(x => x !== own) || null; }
function spkVoiceOf(x){ const v = {}; if (!x) return v; if (x.engine) v.engine = x.engine; ['gVoice', 'gModel', 'gPreset', 'gState', 'fishVoice', 'cbxVoice'].forEach(k => { if (x[k]) v[k] = x[k]; }); return v; }
const ovlVoice = (id, o) => ({ engine: S.proj.engine, gVoice: S.proj.g_voice, gPreset: S.proj.g_preset, gState: S.proj.g_state, ...spkVoiceOf(ovlSpeaker(id, o)) });
const ovlKey = (id, o) => { const x = ovlSpeaker(id, o); return JSON.stringify([o.text, o.mood || '', x ? x.id : '', spkVoiceOf(x)]); };
const ovlSpoken = (id, o) => (o.mood && ovlVoice(id, o).engine === 'google' && isG38() ? `{${o.mood}} ` : '') + o.text;   // 170: the mood reaches Gemini 3.8 only   // the speaker's OWN settings only — project defaults never mark a line
function ovlSig(id){ return ovlList(id).map(o => ovlKey(id, o)).join('|'); }
function ovlMissing(id){ const L = S.lines[id] || {}; return ovlList(id).some(o => o.text && !AUD.get((L.ovlA || {})[ovlKey(id, o)])); }
async function voiceOverlays(ids){
  for (const id of ids){ const L = S.lines[id]; if (!L) continue; const keep = {};
    if (ovlList(id).some(o => o.mood && !(ovlVoice(id, o).engine === 'google' && isG38()))){ L.text = L.text.replace(/\|([^|\n]{1,60})\|/g, (m, inner) => '|' + inner.replace(/\{[^{}]{1,40}\}\s*/, '') + '|'); }   // 170: a mood is 3.8-only — other engines drop it on regeneration
    for (const o of ovlList(id)){ if (!o.text) continue; const key = ovlKey(id, o); let g = (L.ovlA || {})[key];
      if (g === undefined || !AUD.get(g)){ const pl = payloadFor(ovlVoice(id, o), ovlSpoken(id, o)); pl.g38_cast = []; pl.duo = false; pl.g_duo = false; pl.ovl = true; pl.g_continuity = false; pl.f_continuity = false; pl.g_lead_in = '';   // 170/171: one voice, alone — and never the previous line's tail as a lead-in (the stray first word)
        const r = await API().generate_gulp(pl); if (!r.ok) throw new Error(r.error || T('خطای ناشناخته', 'Unknown error')); await storeAudio(r.gulp, r.b64); g = r.gulp; }
      keep[key] = g; }
    L.ovlA = keep; } }
function charTime(c, text, pos){ const W = clipWords(c, text);
  if (W && W.length){ for (const w of W){ if (pos <= w.c0) return w.t0; if (pos < w.c1) return w.t0 + (w.t1 - w.t0) * (pos - w.c0) / Math.max(1, w.c1 - w.c0); } return W[W.length - 1].t1; }
  const [v0, v1] = voicedSpan(c), w = Array.from(text, letterW), tot = w.reduce((s, x) => s + x, 0) || 1, part = w.slice(0, pos).reduce((s, x) => s + x, 0); return v0 + (v1 - v0) * part / tot; }
function clipOverlays(c){ if (!c || c.unvoiced || !c.lines || c.lines.length !== 1) return []; const id = c.lines[0], L = S.lines[id]; if (!L || !L.ovlA) return [];
  const out = []; ovlList(id).forEach(o => { const g = L.ovlA[ovlKey(id, o)], a = g !== undefined && AUD.get(g); if (!a || !a.buf) return;
    const tt = charTime(c, L.text || '', o.pos); if (tt < c.in - 0.01 || tt > c.out + 0.01) return;   // trimmed out of the clip → not heard
    out.push({ gulp: g, at: c.at + Math.max(0, tt - c.in), len: a.buf.duration }); });
  return out; }

// 170: English labels for the tones and tag groups (the values stay Persian — they are what the engine reads)
const TONE_EN = { 'شاد': 'Happy', 'آرام': 'Calm', 'غمگین': 'Sad', 'عصبانی': 'Angry', 'ترسیده': 'Scared', 'مضطرب': 'Anxious', 'متفکر': 'Thoughtful', 'عاشقانه و مهربان': 'Loving and kind', 'مطمئن': 'Confident', 'خسته و بی‌رمق': 'Tired and listless', 'در حال گریه': 'Crying', 'شیطون و بازیگوش': 'Mischievous and playful', 'متعجب': 'Surprised', 'مصمم': 'Determined', 'دلتنگِ گذشته': 'Nostalgic', 'حماسی و قهرمانانه': 'Epic and heroic', 'مراقبه‌وار': 'Meditative' };
const GROUP_EN = { 'مکث': 'Pauses', 'مکث و سرعت': 'Pauses and speed', 'خنده': 'Laughter', 'نفس و آه': 'Breaths and sighs', 'حالت و احساس': 'Mood and feeling', 'صداهای دهان': 'Mouth sounds', 'واکنش‌ها': 'Reactions', 'صدا و بلندی': 'Voice and volume', 'لحن': 'Tone', 'آواز': 'Singing', 'اشاره‌ها': 'Cues', 'جلوه‌ها': 'Effects', 'گریه': 'Crying', 'حرکت': 'Movement', 'صدای محیط': 'Environment', 'احساس‌ها': 'Emotions', 'شدت و لحن': 'Intensity and tone', 'صداها و واکنش‌ها': 'Sounds and reactions', 'جمع': 'Crowd' };   /* 177: Fish's groups */
function toneLabel(t){ return lang === 'fa' ? t : (TONE_EN[t] || I18N_EN[t] || t); }   /* 175: all 85 moods */
function groupLabel(g){ return lang === 'fa' ? g : (GROUP_EN[g] || I18N_EN[g] || g); }

// =====================================================================================
// 175 · ENGINE-AWARE TONES, TAGS AND VOICES — each line has a profile (Gemini 3.8 / 3.1 / 2.5, Fish, Chatterbox,
//       light voices). The tone and tag menus list only that profile's own items; when a line's profile changes,
//       what the new engine cannot do is removed (overlaps stay: their audio is separate and paid for); a voice the new
//       engine cannot use is replaced by its default, and where a chosen voice does not carry over (or was replaced) the
//       avatar gets a warning dot, which clears when that engine's voice menu is opened (this line's tab, the project tab,
//       or the speaker's own). An empty voice slot means the project's voice for that engine and is left empty.
// =====================================================================================
const UNIVERSAL_PAUSES = ['[مکث]', '[مکث بلند]', '[short pause]', '[long pause]'];
function toneOk(){ try { return !!profileTones(curProfile()).length; } catch (e) { return false; } }
function lineProfile(id){ const e = lineEngine(id); if (e === 'google'){ const m = lineVoice(id).gModel || S.proj.g_model || ''; return /3\.8/.test(m) ? 'g38' : /2\.5/.test(m) ? 'g25' : 'g31'; } return e === 'fish' ? 'fish' : e === 'chatterbox' ? 'cbx' : 'light'; }
const PROFILE_NAME = { g38: ['Gemini 3.8', 'Gemini 3.8'], g31: ['Gemini 3.1', 'Gemini 3.1'], g25: ['Gemini 2.5', 'Gemini 2.5'], fish: ['Fish Audio', 'Fish Audio'], cbx: ['Chatterbox', 'Chatterbox'], light: ['صداهای سبک', 'Light voices'] };
const G31_TONES = () => ((G_TAGS.find(g => /حالت/.test(g[0])) || [0, []])[1]);
const FISH_TONES = () => (((DIRECTOR.fish_tags || []).find(g => /احساس/.test(g[0])) || [0, []])[1]);
function profileTones(p){ return p === 'g38' || p === 'g31' ? G38_TONES_ALL : p === 'fish' ? FISH_TONES() : []; }   /* 177: Gemini 3.1 takes the same tones (sent as a direction tag) */
function toneAllowed(t, p){ if (!t) return true; if (p === 'g38') return !/^[\[<]/.test(t); if (p === 'g31' && G31_TONES().includes(t)) return true; return profileTones(p).includes(t); }
function tagAllowed(tag, p){ if (UNIVERSAL_PAUSES.includes(tag)) return true; if (tag.startsWith('<')) return p === 'g38';
  if (tag.startsWith('[')) return p === 'fish' || (p === 'g31' && G_TAGS.some(g => g[1].includes(tag))); return true; }
function stripTags(text, p){ const keep = []; const masked = String(text || '').replace(/\|[^|\n]{1,60}\|/g, m => { keep.push(m); return `␂${keep.length - 1}␃`; });
  const out = masked.replace(/<[^<>\n]{1,40}>|\[[^\[\]\n]{1,40}\]/g, tag => tagAllowed(tag, p) ? tag : '␄').replace(/\s*␄\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
  return out.replace(/␂(\d+)␃/g, (m, k) => keep[+k] || ''); }
function voiceValid(eng, v){ if (!v) return false;
  if (eng === 'google'){ if (G_VOICES.some(x => x[0] === v)) return true; if (!isG38()) return false;
    return v.startsWith('lib:') ? LIBV.some(x => 'lib:' + x.id === v) : v.startsWith('design:') ? DESIGNS.some(x => 'design:' + x.id === v) : v.startsWith('clone:') ? CLONES.some(x => 'clone:' + x.id === v) : false; }
  if (eng === 'chatterbox') return v === 'default' || (CBX_VOICES || []).some(x => x.id === v); return true; }
function defaultVoice(eng){ if (eng === 'google') return voiceValid('google', S.proj.g_voice) ? S.proj.g_voice : 'Charon'; if (eng === 'fish') return (S.proj.fish && S.proj.fish.voice) || ''; if (eng === 'chatterbox') return (S.proj.cbx && S.proj.cbx.voice) || 'default'; return ''; }
const PROF_ENG = { g38: 'google', g31: 'google', g25: 'google', fish: 'fish', cbx: 'chatterbox', light: '' };
const projVoice = eng => eng === 'google' ? S.proj.g_voice : eng === 'fish' ? (S.proj.fish && S.proj.fish.voice) : eng === 'chatterbox' ? ((S.proj.cbx && S.proj.cbx.voice) || 'default') : '';
function reconcileEngines(){ let changed = 0; const fixed = new Set(), moved = [], edited = new Set();
  const todo = Object.keys(S.lines).filter(k => { const L = S.lines[k]; if (!L) return false; const p = lineProfile(+k); if (L.prof === undefined){ L.prof = p; return false; } return L.prof !== p; });
  if (!todo.length) return 0;
  /* 175: what a switch changes by itself is not an edit — a line that was clean stays clean (its fingerprint is re-taken),
     and the overlaps' audio, already paid for, is found again under the new voice; only a removed tag or tone marks it */
  const clean = {}, ovl = []; Object.keys(S.lines).forEach(k => { const L = S.lines[k]; if (!L) return; if (L.madeSig !== undefined && !L.dirty) clean[k] = lineSig(+k) === L.madeSig;
    if (L.ovlA) ovlList(+k).forEach(o => { const g = L.ovlA[ovlKey(+k, o)]; if (g) ovl.push([+k, o, g]); }); });
  todo.forEach(k => { const id = +k, L = S.lines[id], p = lineProfile(id), prevKey = SPK_VKEY[PROF_ENG[L.prof] || ''];
    /* 176: a tone or a tag the new engine cannot do is KEPT (dimmed, not sent) until the line is regenerated with it */
    const eng = lineEngine(id), key = SPK_VKEY[eng], sp = speakerOfLine(id);
    if (key){ const own = L.voice && L.voice[key], other = k2 => prevKey && prevKey !== key && k2 && k2[prevKey];
      /* a voice that the new engine cannot use is replaced by its default; an empty slot already means the project's
         voice for this engine, so it stays empty — the dot shows only where a chosen voice does not carry over */
      if (own){ if (!voiceValid(eng, own)){ L.voice[key] = defaultVoice(eng); L.vwarn = eng; } }
      else if (other(L.voice)) L.vwarn = eng;
      if (!own && sp){ const sv = sp[key];
        if (sv && !voiceValid(eng, sv)){ if (!fixed.has(sp.id + ':' + eng)){ sp[key] = defaultVoice(eng); fixed.add(sp.id + ':' + eng); } L.vwarn = eng; }
        else if (!sv && !voiceValid(eng, projVoice(eng))){ if (!fixed.has(sp.id + ':' + eng)){ sp[key] = defaultVoice(eng); fixed.add(sp.id + ':' + eng); } L.vwarn = eng; }   /* the project's own voice is no good here either */
        else if (!sv && other(sp)) L.vwarn = eng; } }
    L.prof = p; moved.push(id); changed++; });
  moved.forEach(id => { const L = S.lines[id], sp = speakerOfLine(id), eng = lineEngine(id); if (sp && fixed.has(sp.id + ':' + eng)) L.vwarn = eng; });
  ovl.forEach(([id, o, g]) => { const L = S.lines[id]; if (!L) return; const key = ovlKey(id, o); L.ovlA = L.ovlA || {}; if (!L.ovlA[key]) L.ovlA[key] = g; });
  Object.keys(clean).forEach(k => { if (!clean[k] || edited.has(k)) return; const L = S.lines[k]; if (!L) return; L.madeSig = lineSig(+k); L.madeMain = mainSig(+k); });
  return changed; }
// every render records each line's profile and reconciles the ones whose profile changed (an engine or model switch,
// a speaker with another engine) — so new lines are known before any switch happens
const _renderScript175 = renderScript;
renderScript = function(){ let n = 0; try { n = reconcileEngines(); } catch (err) { console.warn(err); } const r = _renderScript175.apply(this, arguments);
  if (n){ try { buildTagMenus(); renderSpeakers(); } catch (err) {} autosave(); } return r; };
// the tone: in each engine's own form (Gemini 3.8 {tone}; Gemini 3.1 and Fish their bracket tag; none for the others)
tonePrefix = function(id){ const L = S.lines[id] || {}; if (!L.tone) return ''; const p = lineProfile(id);
  if (p === 'g38') return /^[\[<]/.test(L.tone) ? '' : `{${L.tone}} `; if (p === 'g31'){ if (!toneAllowed(L.tone, p)) return ''; return L.tone.startsWith('[') ? L.tone + ' ' : `[${String(TONE_EN[L.tone] || L.tone).toLowerCase()}] `; }   /* 177: a Persian tone on 3.1 becomes the line's own direction tag */
  if (p === 'fish') return L.tone.startsWith('[') ? L.tone + ' ' : (TONE_FISH[L.tone] ? TONE_FISH[L.tone] + ' ' : ''); return ''; };
function toneProfileOf(ids){ const ps = [...new Set(ids.map(lineProfile))]; return ps.length === 1 ? ps[0] : null; }
setTone = function(tone){ const ids = sel.size ? [...sel] : (lastLine ? [lastLine] : []); if (!ids.length) return; const ok = ids.filter(id => !tone || toneAllowed(tone, lineProfile(id)));
  if (!ok.length) return say(T('این لحن برای موتورِ این خط نیست.', "That tone doesn’t work with this line’s engine."), 'err'); remember();
  ok.forEach(id => { const L = S.lines[id]; normLine(L); L.tone = tone || ''; }); renderScript(); autosave(); };
toneList = function(id){ return profileTones(lineProfile(id || (sel.size ? [...sel][0] : lastLine))); };
const toneShow = t => t.startsWith('[') ? t.replace(/^\[|\]$/g, '') : toneLabel(t);   // 176: a Fish tone without its brackets
function toneMenuHtml(id, cur){ const p = lineProfile(id), list = profileTones(p), name = T(...PROFILE_NAME[p]);
  if (!list.length) return `<li class="menu-title whitespace-normal">${T(`${name} لحن نمی‌گیرد.`, `${name} doesn’t support line tones.`)}</li>`;
  return `<li class="menu-title">${T('لحنِ این خط', "This line's tone")} · ${escapeHtml(name)}</li>` + list.map(t => `<li><a data-tone-pick="${escapeHtml(t)}" class="${t === cur ? 'menu-active' : ''}" ${t.startsWith('[') ? 'dir="ltr"' : ''}>${escapeHtml(toneShow(t))}</a></li>`).join('')
    + (p === 'g38' ? `<li class="mt-1 border-t border-base-300 pt-1"><a data-tone-custom="1" class="gap-2"><svg class="size-4"><use href="#i-pencil"/></svg>${T('لحنِ دلخواه…', 'A tone of your own…')}</a></li>` : ''); }
openToneMenu = function(ev, id){ ev.stopPropagation(); const cur = (S.lines[id] || {}).tone || '';
  lineMenu(ev.currentTarget, `<ul class="menu menu-sm w-full p-1">${cur ? `<li class="mb-1 border-b border-base-300 pb-1"><a data-tone-pick="" class="gap-2 text-error"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('حذفِ لحن', 'Remove the tone')}</a></li>` : ''}${toneMenuHtml(id, cur)}</ul>`, async e => {
    const c = e.target.closest('[data-tone-custom]'); if (c){ closeDD(); const t = await askText(T('لحنِ دلخواه', 'A tone of your own'), T('مثلاً: «خسته ولی امیدوار»', 'e.g. "tired but hopeful"'), ''); if (t && t.trim()){ sel = new Set(linesFor(id)); setTone(t.trim()); } return; }
    const a = e.target.closest('[data-tone-pick]'); if (!a) return; sel = new Set(linesFor(id)); closeDD(); setTone(a.dataset.tonePick); }); };
// the toolbar's tone and tag menus follow the selected line's profile (the project's when nothing is selected)
const curProfile = () => sel.size ? (toneProfileOf([...sel]) || lineProfile([...sel][0])) : (lastLine && S.lines[lastLine] ? lineProfile(lastLine) : (S.proj.engine === 'google' ? (isG38() ? 'g38' : /2\.5/.test(S.proj.g_model || '') ? 'g25' : 'g31') : S.proj.engine === 'fish' ? 'fish' : S.proj.engine === 'chatterbox' ? 'cbx' : 'light'));
buildToneMenu = function(){ const p = curProfile(), m = $('tagMenu');
  if (m) m.querySelectorAll('[data-x="ipa"], [data-x="ipa-title"], [data-x="ovl"]').forEach(x => x.remove());
  if (m && p === 'g38') m.insertAdjacentHTML('beforeend', `<li class="menu-title" data-x="ipa-title">${T('تلفظ و هم‌زمانی', 'Pronunciation & overlap')}</li><li data-x="ipa"><a onmousedown="event.preventDefault()" onclick="insertIPA()">${T('تلفظ با IPA: /…/', 'Pronounce with IPA: /…/')}</a></li><li data-x="ovl"><a onmousedown="event.preventDefault()" onclick="insertOverlap()">${T('واکنشِ هم‌زمان: |…|', 'Overlapping reaction: |…|')}</a></li>`);
  const tm = $('toneMenu'); if (!tm) return; const id = sel.size ? [...sel][0] : lastLine, list = profileTones(p), name = T(...PROFILE_NAME[p]);
  tm.innerHTML = list.length ? `<li class="menu-title">${escapeHtml(name)}</li>` + list.map(t => `<li><a data-tone="${escapeHtml(t)}" ${t.startsWith('[') ? 'dir="ltr"' : ''}>${escapeHtml(toneShow(t))}</a></li>`).join('') : `<li class="menu-title whitespace-normal">${T(`${name} لحن نمی‌گیرد.`, `${name} doesn’t support line tones.`)}</li>`; };
const _buildTagMenus175 = buildTagMenus;
buildTagMenus = function(){ const p = curProfile(), m = $('tagMenu'), item = t => `<li><a dir="ltr" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</a></li>`;
  if (!m) return; if (p === 'fish'){ m.innerHTML = (DIRECTOR.fish_tags || []).map(([g, list]) => `<li class="menu-title">${escapeHtml(groupLabel(g))}</li>` + list.map(item).join('')).join(''); return buildToneMenu(); }
  if (p === 'cbx' || p === 'light'){ m.innerHTML = `<li class="menu-title whitespace-normal">${T('این موتور فقط مکث می‌گیرد', 'This engine supports pauses only')}</li>` + ['[مکث]', '[مکث بلند]'].map(item).join(''); return buildToneMenu(); }
  if (p === 'g25'){ m.innerHTML = `<li class="menu-title whitespace-normal">${T('مدل‌های 2.5 برچسبِ صوتی نمی‌گیرند.', 'Gemini 2.5 models don’t support sound tags.')}</li>`; return buildToneMenu(); }
  if (p === 'g38') m.innerHTML = G38_TAGS.map(([g, list]) => `<li class="menu-title">${escapeHtml(groupLabel(g))}</li>` + list.map(item).join('')).join('') + `<li class="menu-title">${T('واکنشِ شنونده', 'Listener reactions')}</li>` + G38_BACK.map(item).join('');
  else m.innerHTML = G_TAGS.map(([g, list]) => `<li class="menu-title">${escapeHtml(groupLabel(g))}</li>` + list.map(item).join('')).join('');
  buildToneMenu(); };
// the warning dot on the line's speaker avatar (and on the speaker in the list); it clears when that engine's voice menu opens
const _spkChip175 = spkChip;
spkChip = function(id){ const h = _spkChip175.apply(this, arguments), L = S.lines[id]; if (!L || !L.vwarn || !speakerOfLine(id)) return h;
  return h.replace('<button class="spkchip ', '<button class="spkchip relative ').replace('<span class="spkav ', `<i class="vwarn" title="${escapeHtml(T('صدای این گوینده در این موتور نبود؛ صدای پیش‌فرضِ موتور گذاشته شد.', "This speaker had no voice in this engine; the engine's default voice was set."))}"></i><span class="spkav `); };
const _renderSpeakers175 = renderSpeakers;
renderSpeakers = function(){ const r = _renderSpeakers175.apply(this, arguments); const box = $('spkList'); if (!box) return r;
  spkList().forEach((sp, i) => { if (!Object.values(S.lines).some(L => L && L.vwarn && L.spk === sp.id)) return; const av = box.querySelectorAll('.list-row')[i]; const b = av && av.querySelector('.group\\/av'); if (b && !b.querySelector('.vwarn')) b.insertAdjacentHTML('beforeend', '<i class="vwarn"></i>'); }); return r; };
const VOICE_SEL = { pVoice: 'google', fishVoice: 'fish', cbxVoice: 'chatterbox', ln_gVoice: 'google', ln_fishVoice: 'fish', ln_cbxVoice: 'chatterbox' };
function clearVWarn(selEl){ const id0 = selEl && selEl.id, eng = VOICE_SEL[id0], si = selEl && selEl.dataset && selEl.dataset.spkVoice; let n = 0;
  if (si !== undefined){ const sp = spkList()[+si]; if (sp) Object.values(S.lines).forEach(L => { if (L && L.vwarn && L.spk === sp.id){ delete L.vwarn; n++; } }); }
  else if (eng && id0.startsWith('ln_')){ const id = [...sel][0], L = id && S.lines[id]; if (L && L.vwarn){ delete L.vwarn; n++; } }
  else if (eng) Object.values(S.lines).forEach(L => { if (L && L.vwarn === eng){ delete L.vwarn; n++; } });
  if (n){ renderScript(); renderSpeakers(); autosave(); } }
const _openDD175 = openDD; openDD = function(s){ try { clearVWarn(s); } catch (err) {} return _openDD175.apply(this, arguments); };


// =====================================================================================
// 176 · REACTIONS ARE TIMED CLIPS — a reaction lives on its line as a record (text · speaker · mood · its own audio)
//       anchored to a TIME in that line's voice; the clip on a speech track is drawn from it, and the script shows a
//       badge floating over the text at the letter heard at that moment. The text no longer carries |…| tags, so moving
//       a reaction never touches the line (never «edited»), regenerating the line never re-voices it, and its audio
//       is its own (saved, renumbered and found again with the project).
// =====================================================================================
const reactsOf = id => (S.lines[id] && S.lines[id].reacts) || [];
const rSpk = r => (r && r.spk && spkList().find(s => s.id === r.spk)) || null;
const rVoice = r => ({ engine: S.proj.engine, gVoice: S.proj.g_voice, gPreset: S.proj.g_preset, gState: S.proj.g_state, ...spkVoiceOf(rSpk(r)) });
const rKey = r => JSON.stringify([r.text, r.mood || '', r.spk || '', spkVoiceOf(rSpk(r))]);
const rSpoken = r => (r.mood && rVoice(r).engine === 'google' && /3\.8/.test(rVoice(r).gModel || S.proj.g_model) ? `{${r.mood}} ` : '') + r.text;
const rHasAudio = r => r.gulp != null && !!(AUD.get(r.gulp) || {}).buf;
const rVoiced = r => rHasAudio(r) && r.made === rKey(r);
const rLen = r => rHasAudio(r) ? AUD.get(r.gulp).buf.duration : Math.max(0.5, 0.3 + 0.075 * String(r.text || '').replace(/\s/g, '').length);
function hostOf(id){ const [, c] = clipOfLine(id); return c && !c.type && c.lines.length === 1 ? c : null; }
function rFind(rid){ for (const k of Object.keys(S.lines)){ const r = reactsOf(+k).find(x => x.id === rid); if (r) return [+k, r]; } return [null, null]; }
// where a reaction sits on the timeline: its time in the line's voice; after the line is re-voiced, the letter it was on
function rAt(id, r){ const c = hostOf(id); if (!c) return null; const text = (S.lines[id] || {}).text || '';
  if (!c.unvoiced && c.gulp != null){
    if (r.t == null || r.hostGulp !== c.gulp){ r.t = charTime(c, text, Math.max(0, Math.min(r.pos || 0, text.length))); r.hostGulp = c.gulp; }
    return c.at + (r.t - c.in); }
  return c.at + dur(c) * Math.min(1, Math.max(0, (r.pos || 0) / Math.max(1, text.length))); }
// old documents and pasted scripts: every |Name: {mood} text| becomes a reaction at that letter (its audio kept)
function migrateReacts(){
  Object.keys(S.lines).forEach(k => { const id = +k, L = S.lines[id]; if (!L || typeof L.text !== 'string') return;
    if (typeof L.madeSig === 'string'){ try { const a = JSON.parse(L.madeSig); if (Array.isArray(a) && a.length === 5) L.madeSig = JSON.stringify(a.slice(0, 4)); } catch (err) {} }   // the line's fingerprint no longer holds its reactions
    if (!/\|[^|\n]{1,60}\|/.test(L.text)){ if (L.ovlA) delete L.ovlA; return; }
    const list = ovlList(id), [, c] = clipOfLine(id), oldClips = S.tracks.flatMap(t => t.clips.filter(x => x.type === 'ovl' && x.line === id).map(x => [t, x]));
    let text = L.text, removed = 0, n = 0; L.reacts = L.reacts || [];
    list.forEach(o => { const p = o.pos - removed, len = o.raw.length; text = text.slice(0, p) + text.slice(p + len); removed += len;
      if (c && Array.isArray(c.words)) c.words = c.words.map(w => w.c0 >= p + len ? { ...w, c0: w.c0 - len, c1: w.c1 - len } : w);
      if (!o.text) return; const sp = ovlSpeaker(id, o), key = ovlKey(id, o), g = (L.ovlA || {})[key], was = oldClips.find(([, x]) => String(x.ovid) === id + ':' + n); n++;
      L.reacts.push({ id: 'rx' + (++uid), text: o.text, spk: sp ? sp.id : '', mood: o.mood || '', pos: p, t: null, hostGulp: null, gulp: g != null ? g : null, made: g != null ? key : null, gain: was ? (was[1].gain ?? 1) : 1, track: was ? was[0].id : null }); });
    L.text = text; delete L.ovlA; });
}
// the clips, drawn from the records (never saved as the source of truth)
syncOvlClips = function(){
  const old = new Map(); S.tracks.forEach(t => t.clips.forEach(c => { if (c.type === 'ovl') old.set(c.rid || c.id, t); })); S.tracks.forEach(t => { t.clips = t.clips.filter(c => c.type !== 'ovl'); });
  orderedLines().forEach(id => { const L = S.lines[id]; if (!L || !Array.isArray(L.reacts) || !L.reacts.length) return; const host = hostOf(id); if (!host) return; const [ht] = clipOfLine(id), hti = S.tracks.indexOf(ht);
    L.reacts.forEach(r => { const at = rAt(id, r); if (at == null) return;
      if (!host.unvoiced && r.t != null) r.pos = timeToChar(host, L.text || '', r.t - 0.001);   // the time rules; the letter follows it (just before the letter heard then)
      if (at < host.at - 0.05 || at > host.at + dur(host) + 0.05) return;   // trimmed out of its line: not heard, not shown
      const c = { id: r.id, rid: r.id, type: 'ovl', lines: [], line: id, gulp: rHasAudio(r) ? r.gulp : null, in: 0, out: rLen(r), at: Math.max(0, at), gain: r.gain ?? 1, name: r.text, pending: !rVoiced(r) };
      const pref = r.track && S.tracks.find(t => t.id === r.track), prev = old.get(r.id);
      let t = [pref, prev].find(x => x && S.tracks.includes(x) && x.kind === 'speech' && x !== ht && trackFree(x, c));
      for (let i = hti + 1; !t && i < S.tracks.length; i++) if (S.tracks[i].kind === 'speech' && S.tracks[i] !== ht && trackFree(S.tracks[i], c)) t = S.tracks[i];
      if (!t) t = newTrack(hti + 1, 'speech');
      r.track = t.id; t.clips.push(c); t.clips.sort((a, b) => a.at - b.at); }); });
};
// the badge over the text: at the letter heard at the reaction's moment, raised 90% above the line (177), with its apron —
// the badge's width, from its middle down to the foot of the line, solid to 80% then fading out
function drawReactBadges(){
  const ed = $('editor'); if (!ed) return; let layer = $('rxLayer'); if (!layer){ layer = document.createElement('div'); layer.id = 'rxLayer'; layer.className = 'pointer-events-none absolute inset-0 z-20'; ed.appendChild(layer); }
  else if (layer.parentElement !== ed) ed.appendChild(layer);
  const er = ed.getBoundingClientRect(); let html = '';
  orderedLines().forEach(id => { const L = S.lines[id], rs = reactsOf(id); const ln = ed.querySelector(`.ln[data-id="${id}"]`); if (ln) ln.classList.toggle('rxroom', rs.length > 0); if (!rs.length || !ln) return;
    const lt = ln.querySelector('.lt'), host = hostOf(id), text = L.text || ''; if (!lt) return;
    rs.forEach(r => { let pos = Math.max(0, Math.min(text.length, r.pos || 0));
      if (host && !host.unvoiced && r.t != null && r.hostGulp === host.gulp) pos = timeToChar(host, text, r.t - 0.001);
      const tw = document.createTreeWalker(lt, NodeFilter.SHOW_TEXT); let node, left = pos, last = null;
      while ((node = tw.nextNode())){ last = node; if (left <= node.length) break; left -= node.length; }
      const rg = document.createRange(); if (node) rg.setStart(node, left); else if (last) rg.setStart(last, last.length); else rg.setStart(lt, 0); rg.collapse(true);
      const rc = rg.getClientRects()[0] || rg.getBoundingClientRect(); if (!rc || (!rc.height && !rc.width && !rc.left)) return;
      const sp = rSpk(r), k = sp ? spkList().indexOf(sp) : -1, x = rc.left - er.left, y = rc.top - er.top + rc.height * 0.1, yBot = rc.bottom - er.top;   /* 177: 90% above the line */
      const on = selClip === r.id, pend = !rVoiced(r);
      html += `<span class="rxapron pointer-events-none absolute" data-ap="${r.id}" style="left:${x}px;top:${y}px;width:0;height:0"></span>`;
      html += `<button data-bot="${yBot}" class="rxbadge pointer-events-auto absolute flex max-w-[14rem] -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full border bg-base-100 py-0.5 pe-2 ps-0.5 text-[11px] font-semibold leading-none shadow-sm ${pend ? 'border-dashed border-base-content/40 text-base-content/70' : 'border-primary/40 text-primary'} ${on ? 'ring-2 ring-primary' : ''}" style="left:${x}px;top:${y}px" data-rx="${r.id}" data-line="${id}" contenteditable="false" onmousedown="event.preventDefault()" title="${escapeHtml(r.text)}"><span class="grid size-4 shrink-0 place-items-center overflow-hidden rounded-full text-[8px] font-bold" style="${k >= 0 ? spkVars(k) + ';background:var(--sc);color:var(--so)' : ''}">${k >= 0 ? spkFace(sp) : '<svg class="size-2.5"><use href="#i-user"/></svg>'}</span><span class="ui truncate" dir="auto">${escapeHtml(r.text)}</span>${pend ? '<svg class="size-3 shrink-0 opacity-70"><use href="#i-refresh-cw"/></svg>' : ''}</button>`; }); });
  layer.innerHTML = html;
  layer.querySelectorAll('.rxbadge').forEach(b => { const ap = layer.querySelector(`.rxapron[data-ap="${b.dataset.rx}"]`); if (!ap) return;   /* the apron: the badge's own width, from its middle to the line's foot */
    const w = b.offsetWidth, h = b.offsetHeight, top = parseFloat(b.style.top) - h / 2, bot = +b.dataset.bot; Object.assign(ap.style, { width: w + 'px', left: (parseFloat(b.style.left) - w / 2) + 'px', top: top + 'px', height: Math.max(0, bot - top) + 'px' }); }); }
document.addEventListener('click', ev => { const b = ev.target.closest('.rxbadge'); if (!b) return; ev.preventDefault(); ev.stopPropagation(); editReact(+b.dataset.line, b.dataset.rx); }, true);
const _renderScript176 = renderScript;
renderScript = function(){ try { migrateReacts(); } catch (err) { console.warn(err); } const r = _renderScript176.apply(this, arguments); try { drawReactBadges(); } catch (err) { console.warn(err); } return r; };
if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { try { drawReactBadges(); } catch (err) {} }).observe(document.getElementById('editor') || document.body);
document.addEventListener('input', ev => { if (ev.target && ev.target.closest && ev.target.closest('#editor .lt')) requestAnimationFrame(() => { try { drawReactBadges(); } catch (err) {} }); }, true);
// the dialog: who, what, mood — Save, Regenerate (a fresh take of the same reaction), Delete
function askReact(own, cur, preset, note){ return new Promise(done => {   /* 177: a ready-made text; an unvoiced reaction says «Add» and is made on Add */
  const fresh = !cur || !rVoiced(cur);
  let d = $('ovlDlg'); if (!d){ d = document.createElement('dialog'); d.id = 'ovlDlg'; d.className = 'modal'; document.body.appendChild(d); }
  const list = spkList(), dflt = cur ? rSpk(cur) : (list.find(x => x !== own) || null), dir = lang === 'fa' ? 'rtl' : 'ltr';
  const PRE = [T('آره', 'Yeah'), T('اوهوم', 'Mm-hmm'), T('آها', 'Aha'), T('واقعاً؟', 'Really?'), T('عجب!', 'Wow!'), T('درسته', 'Right'), T('نه بابا!', 'No way!'), T('خب', 'Well…')];
  const g38For = sp0 => ((sp0 && sp0.engine) || S.proj.engine) === 'google' && /3\.8/.test((sp0 && sp0.gModel) || S.proj.g_model);   // 176: the speaker's own model
  d.innerHTML = `<div class="modal-box ui flex max-h-[88vh] max-w-xl flex-col overflow-y-auto p-6" dir="${dir}"><div class="mb-5 flex items-start gap-3"><span class="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"><svg class="size-5"><use href="#i-message-circle"/></svg></span><div class="min-w-0 flex-1"><h3 class="text-lg font-bold">${T('واکنشِ هم‌زمان', 'Overlapping reaction')}</h3><p class="text-sm text-base-content/60">${T('کسِ دیگری وسطِ همین خط، روی صدای گوینده، واکنش نشان می‌دهد؛ خودِ خط مکث نمی‌کند. کلیپش را روی خطِ زمان هر جا بخواهید بکشید.', "Someone reacts in the middle of this line, over the speaker’s voice — the line doesn’t pause. Drag its clip anywhere on the timeline.")}</p></div><form method="dialog"><button class="btn btn-ghost btn-circle" aria-label="close"><svg class="size-5"><use href="#i-x"/></svg></button></form></div>
    <div class="space-y-4"><label class="block"><span class="mb-1.5 block text-sm font-semibold">${T('چه کسی می‌گوید', 'Who says it')}</span><select id="ovlSpk" class="select w-full">${list.length ? list.map((x, k) => `<option value="${k}" ${x === dflt ? 'selected' : ''}>${escapeHtml(x.name)}${x === own ? T(' — گویندهٔ همین خط', " — this line's speaker") : ''}</option>`).join('') : `<option value="">${T('— صدای پروژه —', "— project's voice —")}</option>`}</select></label>
      <div><label class="block"><span class="mb-1.5 block text-sm font-semibold">${T('چه می‌گوید', 'What they say')}</span><input id="ovlText" class="input w-full" dir="auto" value="${escapeHtml(cur ? cur.text : (preset || ''))}" placeholder="${T('مثلاً: واقعاً؟', 'e.g. really?')}"></label>
        <div class="mt-2 flex flex-wrap gap-1.5">${PRE.map(x => `<button type="button" class="badge badge-soft badge-primary h-auto cursor-pointer py-1" data-ovl="${escapeHtml(x)}">${escapeHtml(x)}</button>`).join('')}</div></div>
      <label class="block" id="ovlMoodRow"><span class="mb-1.5 block text-sm font-semibold">${T('با چه حالی', 'Mood')} <span class="font-normal text-base-content/50">· Gemini 3.8</span></span><select id="ovlMood" class="select w-full"><option value="">${T('— بی‌حالت —', '— none —')}</option>${G38_TONES_ALL.map(t => `<option value="${escapeHtml(t)}" ${cur && cur.mood === t ? 'selected' : ''}>${escapeHtml(toneLabel(t))}</option>`).join('')}</select></label></div>
    <div class="modal-action">${cur ? `<button class="btn btn-ghost me-auto text-error" data-act="del"><svg class="size-4"><use href="#i-trash-2"/></svg>${T('حذف', 'Delete')}</button><button class="btn gap-1.5" data-act="regen"><svg class="size-4"><use href="#i-refresh-cw"/></svg>${T('بازتولید', 'Regenerate')}</button>` : `<button class="btn" data-act="no">${T('لغو', 'Cancel')}</button>`}<button class="btn btn-primary gap-1.5" data-act="ok"><svg class="size-4"><use href="#i-${fresh ? 'plus' : 'check'}"/></svg><span>${fresh ? T('افزودن', 'Add') : T('ذخیره', 'Save')}</span></button></div>${note ? `<p class="mt-3 text-xs text-base-content/60">${escapeHtml(note)}</p>` : ''}</div><form method="dialog" class="modal-backdrop"><button>close</button></form>`;
  let fin = false; const end = v => { if (fin) return; fin = true; if (d.open) d.close(); done(v); };
  const read = () => { const k0 = $('ovlSpk').value, s0 = k0 === '' ? null : spkList()[+k0]; return { text: $('ovlText').value.trim(), spk: s0, mood: g38For(s0) ? $('ovlMood').value : '' }; };
  const moodRow = () => { const k0 = $('ovlSpk').value, s0 = k0 === '' ? null : spkList()[+k0]; $('ovlMoodRow').classList.toggle('hidden', !g38For(s0)); };
  d.querySelectorAll('[data-ovl]').forEach(b => b.onclick = () => { $('ovlText').value = b.dataset.ovl; $('ovlText').focus(); });
  d.querySelectorAll('[data-act=no]').forEach(b => b.onclick = () => end(null));
  const del = d.querySelector('[data-act=del]'); if (del) del.onclick = () => end({ remove: true });
  const rg = d.querySelector('[data-act=regen]'); if (rg) rg.onclick = () => end({ ...read(), regen: true });
  d.querySelector('[data-act=ok]').onclick = () => end(read());
  $('ovlText').onkeydown = ev => { if (ev.key === 'Enter'){ ev.preventDefault(); d.querySelector('[data-act=ok]').click(); } };
  $('ovlSpk').addEventListener('change', moodRow); enh($('ovlSpk')); enh($('ovlMood')); moodRow();
  d.addEventListener('close', () => end(null), { once: true }); d.showModal(); setTimeout(() => $('ovlText').focus(), 30); }); }
// voicing: its own request, its own audio — never with the line, never replaced by the line
async function voiceReact(r, force){ if (!force && rVoiced(r)) return true;
  const pl = payloadFor(rVoice(r), rSpoken(r)); pl.g38_cast = []; pl.duo = false; pl.g_duo = false; pl.ovl = true; pl.g_continuity = false; pl.f_continuity = false; pl.g_lead_in = '';
  if (r.mood && !(rVoice(r).engine === 'google' && isG38())) r.mood = '';   // a mood is Gemini 3.8's only
  const res = await API().generate_gulp(pl); if (!res || !res.ok) throw new Error((res && res.error) || T('خطای ناشناخته', 'Unknown error'));
  await storeAudio(res.gulp, res.b64); r.gulp = res.gulp; r.made = rKey(r); return true; }
async function voiceReactUI(r, force){ if (busy) return false; setBusy(true); let ok = false;
  try { ok = await voiceReact(r, force); say(T('واکنش ساخته شد.', 'The reaction is ready.'), 'ok'); } catch (err) { say(isCancel(err) ? T('لغو شد.', 'Canceled.') : (err.message || String(err)), isCancel(err) ? 'ok' : 'err'); }
  finally { setBusy(false); renderScript(); renderTimeline(); autosave(); } return ok; }
async function voicePendingReacts(){ let n = 0; for (const id of orderedLines()) for (const r of reactsOf(id)) if (!rVoiced(r) && (r.text || '').trim()){ await voiceReact(r, false); n++; } return n; }
// insert at the caret: its clip appears at once (dashed until its audio is made, which starts right away)
function caretPosIn(id){ const lt = document.querySelector(`#editor .ln[data-id="${id}"] .lt`), L = S.lines[id]; if (!lt || !L) return (L && L.text || '').length;
  const rng = lastRange && lt.contains(lastRange.startContainer) ? lastRange : null; if (!rng) return (L.text || '').length;
  const r = document.createRange(); r.selectNodeContents(lt); r.setEnd(rng.startContainer, rng.startOffset); return Math.min((L.text || '').length, r.toString().length); }
async function insertReact(preset){ const id = caretLine(); if (!id) return say(T('اول در یک خط کلیک کنید.', 'Click in a line first.'), 'err');
  const pos = caretPosIn(id), own = speakerOfLine(id), res = await askReact(own, null, typeof preset === 'string' ? preset : ''); if (!res || !res.text) return; remember();
  const L = S.lines[id], host = hostOf(id), r = { id: 'rx' + (++uid), text: res.text, spk: res.spk ? res.spk.id : '', mood: res.mood || '', pos, t: null, hostGulp: null, gulp: null, made: null, gain: 1, track: null };
  if (host && !host.unvoiced && host.gulp != null){ r.t = charTime(host, L.text || '', pos); r.hostGulp = host.gulp; }
  (L.reacts = L.reacts || []).push(r); selClip = r.id; renderScript(); renderTimeline(); autosave();
  await voiceReactUI(r, false); }
async function editReact(id, rid){ const L = S.lines[id], r = reactsOf(id).find(x => x.id === rid); if (!r) return; selClip = r.id; renderTimeline(); drawReactBadges();
  const res = await askReact(speakerOfLine(id), r); if (!res) return; remember();
  if (res.remove){ L.reacts = L.reacts.filter(x => x !== r); selClip = null; renderScript(); renderTimeline(); autosave(); return; }
  if (res.text){ r.text = res.text; r.spk = res.spk ? res.spk.id : ''; r.mood = res.mood || ''; }
  renderScript(); renderTimeline(); autosave(); if (res.regen || !rVoiced(r)) await voiceReactUI(r, true); }
// 177 · A REACTION WITHOUT ITS AUDIO ASKS FOR IT — after a line is made or re-made, each of its reactions still without
//       audio (typed with |…|, an old document's) opens the reaction dialog in turn: pick who says it and how, «Add»
//       makes it; Cancel leaves it (dashed) and stops asking for now
var RX_SKIP = new Map();   // reactions just passed over with Cancel are not asked about again right away
async function askPendingReacts(ids){ const list = [], now = Date.now(); (ids || orderedLines()).forEach(id => reactsOf(id).forEach(r => { if (!rVoiced(r) && String(r.text || '').trim() && !(now - (RX_SKIP.get(r.id) || 0) < 8000)) list.push([id, r]); }));
  for (let k = 0; k < list.length; k++){ const [id, r] = list[k]; if (!reactsOf(id).includes(r)) continue; selClip = r.id; renderTimeline(); drawReactBadges();
    const left = list.length - k - 1, res = await askReact(speakerOfLine(id), r, null, left ? T(`${left} واکنشِ دیگر هم منتظرِ صداست.`, `${left} more reaction${left > 1 ? 's' : ''} waiting for audio.`) : '');
    if (!res){ list.slice(k).forEach(([, x]) => RX_SKIP.set(x.id, Date.now())); break; } remember();
    if (res.remove){ S.lines[id].reacts = reactsOf(id).filter(x => x !== r); selClip = null; renderScript(); renderTimeline(); autosave(); continue; }
    if (res.text){ r.text = res.text; r.spk = res.spk ? res.spk.id : ''; r.mood = res.mood || ''; }
    renderScript(); renderTimeline(); autosave(); await voiceReactUI(r, true); } }
// after a line is made or re-made (one, several, or everything), the reactions waiting for audio ask for it
{ const _ga177 = generateAll; generateAll = async function(){ const r = await _ga177.apply(this, arguments); try { if (!busy) await askPendingReacts(); } catch (err) { console.warn(err); } return r; }; }
{ const _rs177 = revoiceSelected; revoiceSelected = async function(){ const ids = sel.size ? orderedLines().filter(id => sel.has(id)) : []; const r = await _rs177.apply(this, arguments); try { if (ids.length && !busy) await askPendingReacts(ids); } catch (err) { console.warn(err); } return r; }; }
// a ready-made reaction from the tags menu («آره», «اوهوم», «absolutely»…) opens the dialog filled in — who says it, how — and Add makes it
{ const _it177 = insertTag; insertTag = function(tag){ const m = /^\|([^|]+)\|$/.exec(String(tag || '').trim()); if (m) return insertReact(m[1].trim()); return _it177.apply(this, arguments); }; }
// 177: the badge in the text follows the selection on the timeline at once (it kept the previous one highlighted)
function rxSyncSel(){ const L = $('rxLayer'); if (L) L.querySelectorAll('.rxbadge').forEach(b => { const on = b.dataset.rx === String(selClip); b.classList.toggle('ring-2', on); b.classList.toggle('ring-primary', on); }); }
{ const _ps177 = paintSel; paintSel = function(){ const r = _ps177.apply(this, arguments); try { rxSyncSel(); } catch (err) {} return r; }; }
{ const _rt177 = renderTimeline; renderTimeline = function(){ const r = _rt177.apply(this, arguments); try { rxSyncSel(); } catch (err) {} return r; }; }
// =====================================================================================
// 177 · THE VOICE NEVER WAITS UNDER A REACTION — Google sometimes left a gap mid-sentence where a reaction is laid over
//       the line (the founder's project: 0.78 s after «شد که», under «نه بابا!»). Three things, in order:
//       · the text it reads has no runs of no-break spaces any more (they were read as hesitations) and the request
//         asks for one continuous flow (engine: google_text, g_steady);
//       · after a take, a gap between two words that the reaction is heard over — mid-sentence (nothing written
//         between those words), much longer than the line's other gaps — means a fresh take, at most twice;
//       · if it is still there, the silence itself is taken out of the part (engine: gulp_cut — only a pause, never
//         speech), leaving a natural 0.12 s.
// =====================================================================================
function rxSteady(ids){ return (ids || []).some(id => reactsOf(id).some(r => String(r.text || '').trim())); }
function rxPauseFind(id){ const [, c] = clipOfLine(id), L = S.lines[id]; if (!c || c.unvoiced || c.gulp == null || !L) return null;
  const text = L.text || '', W = clipWords(c, text), rs = reactsOf(id).filter(r => String(r.text || '').trim()); if (!W || W.length < 3 || !rs.length) return null;
  const gaps = []; for (let i = 0; i < W.length - 1; i++){ const g = W[i + 1].t0 - W[i].t1, between = text.slice(W[i].c1, W[i + 1].c0), word = String(W[i].w || '');
    gaps.push({ i, g, a: W[i].t1, b: W[i + 1].t0, mid: /^[\s ‌]*$/.test(between) && !/[.!?؟،,;؛:…»"]$/.test(word) }); }
  const mids = gaps.filter(x => x.mid).map(x => x.g).sort((a, b) => a - b), med = mids.length ? mids[Math.floor(mids.length / 2)] : 0.05, lim = Math.max(0.3, med * 2.5);
  let best = null; rs.forEach(r => { const rt = charTime(c, text, Math.max(0, Math.min(text.length, r.pos || 0))), len = rLen(r), w0 = rt - 0.15, w1 = rt + len + 0.15;
    gaps.forEach(x => { if (!x.mid || x.g <= lim || x.b < w0 || x.a > w1) return; if (!best || x.g > best.g) best = { ...x, rid: r.id }; }); });
  return best; }
async function rxAdoptGulp(oldG, r){ await storeAudio(r.gulp, r.b64);
  const owners = speechClips().filter(x => x.gulp === oldG && !x.file).sort((a, b) => (a.gi || 0) - (b.gi || 0) || a.in - b.in), ids = owners.flatMap(x => x.lines), spans = r.lines || [];
  if (!spans.length || spans.length !== ids.length || spans[0].whole) return false;
  owners.forEach(o => { const k = ids.indexOf(o.lines[0]), sp = spans[k], before = dur(o), [t] = clipOfLine(o.lines[0]); if (!sp) return;
    o.gulp = r.gulp; o.gi = k; o.src = [sp.t0, sp.t1]; o.words = shiftWordsFor(sp.words, o.lines[0]);
    o.trimIn = Math.min(o.trimIn || 0, Math.max(0, sp.t1 - sp.t0 - 0.2)); o.trimOut = Math.min(o.trimOut || 0, Math.max(0, sp.t1 - sp.t0 - 0.2 - o.trimIn));
    o.in = sp.t0 + o.trimIn; o.out = sp.t1 - o.trimOut; const delta = dur(o) - before; if (Math.abs(delta) > 0.001 && t) shiftAfter(t, o.at + before - 0.001, delta, o); });
  return true; }
async function rxCloseGap(id, hit){ const [, c] = clipOfLine(id); if (!c || typeof API().gulp_cut !== 'function') return false; const keep = 0.06;
  const r = await API().gulp_cut({ gulp: c.gulp, t0: hit.a + keep, t1: hit.b - keep }); if (!r || !r.ok) return false; return rxAdoptGulp(c.gulp, r); }
async function rxNoPause(ids, rv){ let fixed = 0;
  for (const id of ids){ for (let k = 0; k < 3; k++){ const hit = rxPauseFind(id); if (!hit) break;
      if (k < 2){ say(T(`صدای اصلی زیرِ یک واکنش مکث کرد؛ این خط دوباره ساخته می‌شود (${k + 1} از 2)…`, `The voice paused under a reaction — making this line again (${k + 1} of 2)…`), 'ok'); const [, c] = clipOfLine(id); if (!c) break; await rv(c, [id]); continue; }
      say(T('مکث هنوز بود؛ خودِ سکوت برداشته می‌شود…', 'The pause is still there — taking the silence itself out…'), 'ok'); if (await rxCloseGap(id, hit)) fixed++; break; } }
  if (fixed){ renderScript(); renderTimeline(); say(T('مکثِ زیرِ واکنش برداشته شد.', 'The pause under the reaction was taken out.'), 'ok'); } return fixed; }
{ const _rv177 = revoice; revoice = async function(c, selectOnly){ const r = await _rv177.apply(this, arguments);
    try { const ids = (selectOnly && selectOnly.length ? selectOnly : (c && c.lines) || []).filter(id => S.lines[id] && rxSteady([id])); if (ids.length) await rxNoPause(ids, _rv177); } catch (err) { console.warn('no pause', err); } return r; };
  const _vr177 = voiceRun; voiceRun = async function(run){ const ids0 = run.clips.flatMap(c => c.lines); const r = await _vr177.apply(this, arguments);
    try { const ids = ids0.filter(id => S.lines[id] && rxSteady([id])); if (ids.length) await rxNoPause(ids, _rv177); } catch (err) { console.warn('no pause', err); } return r; }; }
// the clip's toolbar and keys (the old names, new meaning)
ovlDel = function(){ const [, c] = findClip(selClip); if (!c || c.type !== 'ovl') return; const [id, r] = rFind(c.rid || c.id); if (!r) return; remember(); S.lines[id].reacts = reactsOf(id).filter(x => x !== r); selClip = null; renderScript(); renderTimeline(); autosave(); };
ovlDup = function(){ const [, c] = findClip(selClip); if (!c || c.type !== 'ovl') return; const [id, r] = rFind(c.rid || c.id); if (!r) return; remember();
  const n = { ...JSON.parse(JSON.stringify(r)), id: 'rx' + (++uid) }; reactsOf(id).push(n);   // right after the original, on its track when there is room
  const T1 = c.at + dur(c), [t] = findClip(c.id); n.track = t ? t.id : r.track; selClip = n.id; placeReact(n, id, T1); renderScript(); renderTimeline(); autosave(); };
ovlRegen = async function(){ const [, c] = findClip(selClip); if (!c || c.type !== 'ovl') return; const [, r] = rFind(c.rid || c.id); if (!r) return; remember(); await voiceReactUI(r, true); };
function ovlEdit(){ const [, c] = findClip(selClip); if (!c || c.type !== 'ovl') return; const [id] = rFind(c.rid || c.id); if (id != null) editReact(id, c.rid || c.id); }
// a reaction's new moment (and line, when it is dropped over another one); the drop lane becomes its track
function placeReact(r, id, T0){ const cands = speechClips().filter(s => s.lines.length === 1 && T0 >= s.at - 0.05 && T0 <= s.at + dur(s) + 0.05);
  const host = cands.find(s => s.lines[0] === id) || cands.sort((a, b) => Math.abs(a.at + dur(a) / 2 - T0) - Math.abs(b.at + dur(b) / 2 - T0))[0]; if (!host) return false;
  const id2 = host.lines[0]; if (id2 !== id){ S.lines[id].reacts = reactsOf(id).filter(x => x !== r); (S.lines[id2].reacts = S.lines[id2].reacts || []).push(r); }
  const text = S.lines[id2].text || '';
  if (host.unvoiced || host.gulp == null){ r.t = null; r.hostGulp = null; r.pos = Math.round(Math.max(0, Math.min(1, (T0 - host.at) / Math.max(0.05, dur(host)))) * text.length); }
  else { r.t = host.in + (T0 - host.at); r.hostGulp = host.gulp; r.pos = timeToChar(host, text, r.t - 0.001); }
  return true; }
ovlMoveTo = function(c, T0, ti){ const [id, r] = rFind(c.rid || c.id); if (!r) return renderTimeline();
  if (!placeReact(r, id, T0)){ say(T('واکنش باید روی یک خط بیفتد.', 'A reaction has to sit over a line.'), 'err'); return renderTimeline(); }
  if (ti != null && S.tracks[ti] && S.tracks[ti].kind === 'speech') r.track = S.tracks[ti].id;
  renderScript(); renderTimeline(); autosave(); };
insertOverlap = insertReact;
voiceOverlays = async function(){ };   // a line's regeneration never re-voices its reactions
ovlMissing = () => false;
// 176: the shared dropdown list stayed inside a dialog after it closed — and a dialog that rebuilds itself (the
//      reaction dialog does, every time it opens) destroyed it: from then on every dropdown there was dead. It goes
//      back to the page whenever it closes or its dialog closes, and is re-made if anything removed it.
function ddHome(){ let m = document.getElementById('ddMenu'); if (!m){ m = document.createElement('ul'); m.id = 'ddMenu'; m.className = 'menu menu-sm fixed z-[1100] hidden max-h-80 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-200 p-1.5 shadow-xl'; document.body.appendChild(m); } return m; }
{ const _closeDD176 = closeDD; closeDD = function(){ const m = ddHome(); const r = _closeDD176.apply(this, arguments); if (m.parentElement !== document.body) document.body.appendChild(m); return r; };
  const _openDD176 = openDD; openDD = function(){ ddHome(); return _openDD176.apply(this, arguments); }; }
document.addEventListener('close', ev => { const d = ev.target; if (!d || d.tagName !== 'DIALOG') return; const m = document.getElementById('ddMenu'); if (m && d.contains(m)){ m.classList.add('hidden'); m._sel = null; document.body.appendChild(m); } }, true);


// =====================================================================================
// 176 · LINES KEEP WHAT THEY ARE — a split carries every setting; a Gemini model per line and per speaker (tones and
//       tags follow it); a tone or tag that the line's engine cannot do waits, dimmed and unsent, until the line is
//       regenerated with that engine (switching back restores it); the voice an engine fell back to is shown chosen.
// =====================================================================================
function inheritLine(L){ const o = {}; if (!L) return o;
  ['spk', 'tone', 'prof', 'vwarn'].forEach(k => { if (L[k] !== undefined && L[k] !== null && L[k] !== '') o[k] = L[k]; });
  o.voice = L.voice ? JSON.parse(JSON.stringify(L.voice)) : null; return o; }
function moveReactsAfter(L, N, test, fix){ if (!L || !Array.isArray(L.reacts) || !L.reacts.length) return; const go = L.reacts.filter(test); if (!go.length) return;
  L.reacts = L.reacts.filter(r => !go.includes(r)); N.reacts = (N.reacts || []).concat(go.map(r => { fix(r); return r; })); }
function modelShort(m){ const row = (typeof MODELS !== 'undefined' ? MODELS : []).find(x => x[0] === m); return row ? String(row[1]).split(' — ')[0] : String(m || '').replace(/^gemini-/, ''); }
function fishVoiceName(v){ if (!v || v === 'default') return T('پیش‌فرض Fish Audio', 'Fish Audio default'); const all = [...(FISH_VOICES || []).map(x => [x._id || x.id, x.title || x.name]), ...(FISH_USED || []).map(x => [x.id, x.title]), ...(FISH_DESIGNED || []).map(x => [x.id, x.title])];
  const hit = all.find(x => x[0] === v); return hit ? (hit[1] || v) : v; }
const lineModel = id => lineVoice(id).gModel || S.proj.g_model;
// what is sent: tags the line's engine can do; a foreign tag is cut out (its offsets recorded, so word times map back)
spokenInfo = function(id){ const L = S.lines[id] || {}, t = L.text || '', pre = tonePrefix(id), body = t.trim(), p = lineProfile(id);
  const re = new RegExp(OVL_RE.source + '|<[^<>\\n]{1,40}>|\\[[^\\[\\]\\n]{1,40}\\]', 'g'), cuts = []; let s = '', last = 0, m;
  while ((m = re.exec(body))){ const raw = m[0], off = m.index; if (!raw.startsWith('|') && tagAllowed(raw, p)) continue;
    let len = raw.length; if (!raw.startsWith('|') && body[off + len] === ' ' && (off === 0 || body[off - 1] === ' ')) len++;
    s += body.slice(last, off); cuts.push([pre.length + s.length, len]); last = off + len; re.lastIndex = Math.max(re.lastIndex, last); }
  s += body.slice(last);
  return { s: pre + s, shift: (t.length - t.trimStart().length) - pre.length, cuts }; };
// regenerating a line with its engine: what that engine cannot do goes for good (and the reactions' letters follow)
function commitProfile(id){ const L = S.lines[id]; if (!L) return; const p = lineProfile(id);
  if (L.tone && !toneAllowed(L.tone, p)) L.tone = '';
  // 177: a dropped tag takes the spaces around it (plain or no-break) and leaves one space between words — none at the
  //      line's ends, before punctuation, or where the tag was glued to its neighbours
  const re = /<[^<>\n]{1,40}>|\[[^\[\]\n]{1,40}\]/g, text = L.text || '', segs = []; let m;
  while ((m = re.exec(text))){ if (tagAllowed(m[0], p)) continue; let a = m.index, e = a + m[0].length; const t0 = a, t1 = e;
    while (a > 0 && /[ \u00a0]/.test(text[a - 1])) a--; while (e < text.length && /[ \u00a0]/.test(text[e])) e++;
    const last = segs[segs.length - 1]; if (last && a <= last[1]){ last[1] = Math.max(last[1], e); last[2] = last[2] || a < t0 || e > t1; continue; }
    segs.push([a, e, a < t0 || e > t1]); }
  if (!segs.length) return;
  let out = '', at = 0; const map = [];
  segs.forEach(([a, e, ws]) => { const nx = text[e] || '', pv = text[a - 1] || '', rep = ws && a > 0 && e < text.length && !/[.,!?؟،؛:…»)\]]/.test(nx) && !/[«(\[]/.test(pv) ? ' ' : '';
    out += text.slice(at, a) + rep; map.push([a, e, rep.length]); at = e; });
  out += text.slice(at); L.text = out;
  const moved = pos => { let d = 0; for (const [a, e, r] of map){ if (pos >= e) d += e - a - r; else if (pos > a) d += pos - a - Math.min(r, pos - a); } return pos - d; };
  (L.reacts || []).forEach(r => { r.pos = moved(r.pos || 0); }); }
{ const _voiceRun176 = voiceRun; voiceRun = async function(run){ try { (run && run.clips || []).forEach(c => (c.lines || []).forEach(commitProfile)); } catch (err) { console.warn(err); } return _voiceRun176.apply(this, arguments); };
  const _revoice176 = revoice; revoice = async function(c, selectOnly){ try { const targets = selectOnly ? selectOnly : (c.lines.filter(id => S.lines[id] && S.lines[id].dirty).length ? c.lines.filter(id => S.lines[id].dirty) : c.lines); targets.forEach(commitProfile); } catch (err) { console.warn(err); } return _revoice176.apply(this, arguments); }; }
// the script shows a waiting tone or tag dimmed, with why
toneChip = function(id){ const L = S.lines[id]; if (!L || !L.tone) return ''; const p = lineProfile(id), off = !toneAllowed(L.tone, p), lab = L.tone.startsWith('[') ? L.tone.replace(/^\[|\]$/g, '') : toneLabel(L.tone);
  return `<button class="badge badge-soft badge-accent badge-sm me-1 gap-1 align-middle ${off ? 'opacity-45 line-through' : ''}" contenteditable="false" onmousedown="event.preventDefault()" onclick="openToneMenu(event, ${id})" ${off ? `data-tip="${escapeHtml(T(`${PROFILE_NAME[p][0]} این لحن را نمی‌گیرد؛ اگر این خط را با همین موتور دوباره بسازید، حذف می‌شود.`, `${PROFILE_NAME[p][1]} can’t do this tone; it goes when you regenerate this line with it.`))}"` : ''}><svg class="size-3"><use href="#i-smile"/></svg>${escapeHtml(lab)}</button>`; };
function dimForeignTags(){ document.querySelectorAll('#editor .ln').forEach(ln => { const id = +ln.dataset.id; if (!S.lines[id]) return; const p = lineProfile(id);
  ln.querySelectorAll('.lt .tagpill:not(.pipe):not(.ipa)').forEach(pill => { const raw = [...pill.childNodes].filter(n => !(n.classList && n.classList.contains('tpdel'))).map(n => n.textContent).join('').trim();
    const off = raw && !tagAllowed(raw, p); pill.classList.toggle('tp-off', !!off);
    if (off){ pill.setAttribute('data-tip', T(`${PROFILE_NAME[p][0]} این تگ را نمی‌گیرد؛ فرستاده نمی‌شود و اگر این خط را با همین موتور دوباره بسازید، حذف می‌شود.`, `${PROFILE_NAME[p][1]} can’t do this tag; it isn’t sent, and it goes when you regenerate this line with it.`)); } else pill.removeAttribute('data-tip'); }); }); }
{ const _rs176b = renderScript; renderScript = function(){ const r = _rs176b.apply(this, arguments); try { dimForeignTags(); } catch (err) {} return r; }; }
// the voice an engine fell back to (the warning dot) is the one shown chosen in the line's voice menu
{ const _fli176 = fillLineInspector; fillLineInspector = function(id){ const r = _fli176.apply(this, arguments);
  try { const L = S.lines[id], eng = lineEngine(id), key = SPK_VKEY[eng];
    if (L && L.vwarn === eng && key && !(L.voice && L.voice[key])){ const el = $('ln_' + key), eff = lineVoice(id)[key] || defaultVoice(eng); if (el && [...el.options].some(o => o.value === eff)){ el.value = eff; refreshEnh(el); } } } catch (err) {}
  return r; }; }
{ const _setLineOpt176 = setLineOpt; setLineOpt = function(k, v){ const r = _setLineOpt176.apply(this, arguments); if (k === 'gModel'){ try { buildTagMenus(); } catch (err) {} } return r; }; }
// 176: a Persian tone that Fish knows as its own tag ({غمگین} → [sad]) is a tone Fish can do — not «waiting»
{ const _toneAllowed176 = toneAllowed; toneAllowed = function(t, p){ return _toneAllowed176(t, p) || (p === 'fish' && typeof TONE_FISH !== 'undefined' && !!TONE_FISH[t]); }; }
// 176: an engine switch that replaces a speaker's voice by itself does not throw away the reactions already voiced
//      (their audio is separate and paid for — 175's rule for overlaps)
{ const _reconcile176 = reconcileEngines; reconcileEngines = function(){ const voiced = []; try { Object.keys(S.lines).forEach(k => reactsOf(+k).forEach(r => { if (rVoiced(r)) voiced.push(r); })); } catch (err) {}
  const n = _reconcile176.apply(this, arguments); if (n) voiced.forEach(r => { if (rHasAudio(r)) r.made = rKey(r); }); return n; }; }


// 176 · sound clips saved with the old family's paths play from their new place; deleting a clip while it plays (or
//       while a preview plays) silences it at once
function migrateSfxPaths(){ const moved = (sfxIdx() || {}).moved || {}; if (!Object.keys(moved).length) return;
  const fix = o => { if (o && o.type === 'sfx' && moved[o.file]){ o.file = moved[o.file]; const it = sfxItems().find(x => x.file === o.file); if (it) o.name = T(it.fa, it.en); } };
  S.tracks.forEach(t => t.clips.forEach(fix)); if (typeof V !== 'undefined' && V && Array.isArray(V.objects)) V.objects.forEach(fix); }
{ const _restoreSnap176 = restoreSnap; restoreSnap = function(){ const r = _restoreSnap176.apply(this, arguments); try { migrateSfxPaths(); } catch (err) { console.warn(err); } return r; }; }
function silenceAfterDelete(){ try { stopPreview(); } catch (err) {} if (SFX_PREV){ try { SFX_PREV.stop(); } catch (err) {} SFX_PREV = null; }
  if (playing){ const t = playhead; stopPlay(); seekVisual(t); startPlay(); } }
{ const _del = delMusicClip; delMusicClip = function(){ const r = _del.apply(this, arguments); silenceAfterDelete(); return r; };
  const _rm = removeMusic; removeMusic = function(){ const r = _rm.apply(this, arguments); silenceAfterDelete(); return r; };
  const _od = ovlDel; ovlDel = function(){ const r = _od.apply(this, arguments); silenceAfterDelete(); return r; };
  const _dc = delClip; delClip = function(){ const r = _dc.apply(this, arguments); if (playing){ const t = playhead; stopPlay(); seekVisual(t); startPlay(); } return r; }; }
