// =====================================================================================
// 162 · SPEAKERS — any number, for every engine. Each line is its own request, so a line that
//       starts with a known speaker's «Name:» simply takes that speaker's engine and voice; the
//       name is never spoken. An unnamed line continues the previous speaker. The video tab
//       shows exactly these speakers (one orb each).
// =====================================================================================
const SPK_LINE = /^(\s*(?:\{[^}]*\}\s*)?)([^:：\n{}<>|]{1,24})[:：]\s*/;
const SPK0 = name => ({ id: 's' + (++uid), name: name || '', engine: '', gVoice: '', gPreset: '', gState: '', fishVoice: '', cbxVoice: '' });
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
  if (sp.engine) v.engine = sp.engine; ['gVoice', 'gPreset', 'gState', 'fishVoice', 'cbxVoice'].forEach(k => { if (sp[k]) v[k] = sp[k]; });
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
function bundledPreview(engine, voice){
  if (engine === 'google' && voice && !/^(lib|design|clone):/.test(voice)) return `previews/google/${S.proj.g_model}/${voice}.mp3`;
  if (LIGHT_ENGINES.includes(engine)) return `previews/light/${engine}.mp3`;
  if ((engine === 'chatterbox' || engine === 'fish') && (!voice || voice === 'default')) return `previews/${engine}/default.mp3`;
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
async function buildPreviews(){
  const jobs = [];
  MODELS.forEach(([model]) => G_VOICES.forEach(([v]) => { const p = previewPayload('google', v); p.g_model = model; jobs.push({ rel: `google/${model}/${v}.mp3`, payload: p }); }));
  LIGHT_ENGINES.forEach(e => jobs.push({ rel: `light/${e}.mp3`, payload: previewPayload(e, null) }));
  jobs.push({ rel: 'chatterbox/default.mp3', payload: previewPayload('chatterbox', 'default') }, { rel: 'fish/default.mp3', payload: previewPayload('fish', 'default') });
  if (!(await askYes(T('ساختنِ نمونه‌صداها', 'Make the voice samples'), T(`فقط نمونه‌هایی که در برنامه نیستند ساخته می‌شوند (با کلیدها و مدل‌های همین دستگاه) و بقیه از نسخهٔ برنامه کپی می‌شوند. پوشه‌ای انتخاب کنید؛ بعد آن را با نامِ previews کنارِ پوشهٔ ui در مخزن بگذارید تا در برنامه بسته‌بندی شود.`, `Only the missing samples are made (with this machine’s keys and models); the rest are copied from the app. Pick a folder, then add it to the repository as ui/previews so it ships with the app.`), T('انتخابِ پوشه و ساختن', 'Choose a folder and make them')))) return;   // 175: the app's dialog
  setBusy(true); try { const r = await API().previews_build(jobs); if (!r.ok){ if (r.error !== 'cancelled') say(r.error || '', 'err'); return; }
    const parts = T(`${FA(r.made)} ساخته شد، ${FA(r.copied || 0)} از نسخهٔ برنامه کپی شد، ${FA(r.kept || 0)} از قبل بود`, `${r.made} made, ${r.copied || 0} copied from the app, ${r.kept || 0} already there`);
    say(r.stopped ? T(`کلیدها تمام شد؛ ${parts}. ${FA(r.failed.length)} نمونه مانده — بعداً دوباره بزنید، فقط مانده‌ها ساخته می‌شوند. پوشه: ${r.folder}`, `Out of key quota: ${parts}. ${r.failed.length} left — run it again later to make just those. Folder: ${r.folder}`)
      : T(`${parts}${r.failed.length ? ` — ${FA(r.failed.length)} ساخته نشد` : ''}. پوشه: ${r.folder}`, `${parts}${r.failed.length ? ` — ${r.failed.length} failed` : ''}. Folder: ${r.folder}`), r.stopped || r.failed.length ? 'err' : 'ok'); }
  finally { setBusy(false); }
}

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
  if (eng === 'google') return `{${L.tone}} `; if (eng === 'fish') return (TONE_FISH[L.tone] || (L.tone.startsWith('[') ? L.tone : '')) + (TONE_FISH[L.tone] || L.tone.startsWith('[') ? ' ' : ''); return ''; }
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
// sound tags <…>, backchannels |…| and IPA /…/ as pills — the raw characters stay in the text (hidden), so offsets never move
function pills(html){
  return html.split(/(<[^>]+>)/).map(part => part.startsWith('<') ? part : part
    .replace(/&lt;([^&]{1,40}?)&gt;/g, '<span class="tagpill"><span class="tp-x">&lt;</span>$1<span class="tp-x">&gt;</span><span class="tpdel" contenteditable="false" data-tip="حذف" data-tip-en="Delete"><svg><use href="#i-x"/></svg></span></span>')
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
  if (distinct.length >= 2 || Object.values(counts).some(c => c >= 2)) distinct.forEach(n => { if (!spkByName(n)) spkList().push(SPK0(n)); });
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
function spkVoiceOf(x){ const v = {}; if (!x) return v; if (x.engine) v.engine = x.engine; ['gVoice', 'gPreset', 'gState', 'fishVoice', 'cbxVoice'].forEach(k => { if (x[k]) v[k] = x[k]; }); return v; }
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
const GROUP_EN = { 'مکث': 'Pauses', 'مکث و سرعت': 'Pauses and speed', 'خنده': 'Laughter', 'نفس و آه': 'Breaths and sighs', 'حالت و احساس': 'Mood and feeling', 'صداهای دهان': 'Mouth sounds', 'واکنش‌ها': 'Reactions', 'صدا و بلندی': 'Voice and volume', 'لحن': 'Tone', 'آواز': 'Singing', 'اشاره‌ها': 'Cues', 'جلوه‌ها': 'Effects', 'گریه': 'Crying', 'حرکت': 'Movement', 'صدای محیط': 'Environment' };
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
function lineProfile(id){ const e = lineEngine(id); if (e === 'google'){ const m = S.proj.g_model || ''; return /3\.8/.test(m) ? 'g38' : /2\.5/.test(m) ? 'g25' : 'g31'; } return e === 'fish' ? 'fish' : e === 'chatterbox' ? 'cbx' : 'light'; }
const PROFILE_NAME = { g38: ['Gemini 3.8', 'Gemini 3.8'], g31: ['Gemini 3.1', 'Gemini 3.1'], g25: ['Gemini 2.5', 'Gemini 2.5'], fish: ['Fish Audio', 'Fish Audio'], cbx: ['Chatterbox', 'Chatterbox'], light: ['صداهای سبک', 'Light voices'] };
const G31_TONES = () => ((G_TAGS.find(g => /حالت/.test(g[0])) || [0, []])[1]);
const FISH_TONES = () => (((DIRECTOR.fish_tags || []).find(g => /احساس/.test(g[0])) || [0, []])[1]);
function profileTones(p){ return p === 'g38' ? G38_TONES_ALL : p === 'g31' ? G31_TONES() : p === 'fish' ? FISH_TONES() : []; }
function toneAllowed(t, p){ if (!t) return true; if (p === 'g38') return !/^[\[<]/.test(t); return profileTones(p).includes(t); }
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
    if (L.tone && !toneAllowed(L.tone, p)){ L.tone = ''; edited.add(k); }
    const t2 = stripTags(L.text, p); if (t2 !== (L.text || '').trim()){ L.text = t2; edited.add(k); }
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
  if (p === 'g38') return /^[\[<]/.test(L.tone) ? '' : `{${L.tone}} `; if (p === 'g31') return L.tone.startsWith('[') && toneAllowed(L.tone, p) ? L.tone + ' ' : '';
  if (p === 'fish') return L.tone.startsWith('[') ? L.tone + ' ' : (TONE_FISH[L.tone] ? TONE_FISH[L.tone] + ' ' : ''); return ''; };
function toneProfileOf(ids){ const ps = [...new Set(ids.map(lineProfile))]; return ps.length === 1 ? ps[0] : null; }
setTone = function(tone){ const ids = sel.size ? [...sel] : (lastLine ? [lastLine] : []); if (!ids.length) return; const ok = ids.filter(id => !tone || toneAllowed(tone, lineProfile(id)));
  if (!ok.length) return say(T('این لحن برای موتورِ این خط نیست.', "That tone doesn’t work with this line’s engine."), 'err'); remember();
  ok.forEach(id => { const L = S.lines[id]; normLine(L); L.tone = tone || ''; }); renderScript(); autosave(); };
toneList = function(id){ return profileTones(lineProfile(id || (sel.size ? [...sel][0] : lastLine))); };
const toneShow = t => t.startsWith('[') ? t : toneLabel(t);
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
