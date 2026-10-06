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
function speakerOfLine(id){
  const ord = orderedLines(); for (let k = ord.indexOf(+id); k >= 0; k--){ const m = SPK_LINE.exec((S.lines[ord[k]] || {}).text || ''); if (m) return spkByName(m[2]) || null; }
  return null;
}
function spkVoice(id){
  const sp = speakerOfLine(id); if (!sp) return {}; const v = {};
  if (sp.engine) v.engine = sp.engine; ['gVoice', 'gPreset', 'gState', 'fishVoice', 'cbxVoice'].forEach(k => { if (sp[k]) v[k] = sp[k]; });
  return v;
}
// what is actually sent: the line without a KNOWN speaker's name (a line tone {…} stays); shift maps word offsets back
function spokenInfo(id){
  const t = (S.lines[id] || {}).text || '', m = SPK_LINE.exec(t);
  if (!m || !spkByName(m[2])){ return { s: t.trim(), shift: t.length - t.trimStart().length }; }
  const tone = m[1].trim(), rest = t.slice(m[0].length).trim(), s = tone ? tone + ' ' + rest : rest;
  return { s, shift: t.indexOf(rest, m[0].length) - (tone ? tone.length + 1 : 0) };
}
const spoken = id => spokenInfo(id).s;
const shiftWords = (W, off) => W ? W.map(w => ({ ...w, c0: w.c0 + off, c1: w.c1 + off })) : null;
function setSpk(i, k, v){ remember(); const sp = spkList()[i], before = sp.name; sp[k] = v;
  markDirty(id => { const s2 = speakerOfLine(id); return (s2 && s2.id === sp.id) || (k === 'name' && SPK_LINE.test(S.lines[id].text || '') && SPK_LINE.exec(S.lines[id].text)[2].trim() === before); });
  renderSpeakers(); renderScript(); autosave(); if (typeof VVER !== 'undefined') VVER++; }
function addSpeaker(){ remember(); const n = spkList().length + 1; spkList().push(SPK0(T(`گوینده ${FA(n)}`, `Speaker ${n}`))); renderSpeakers(); autosave(); }
function delSpeaker(i){ remember(); const sp = spkList()[i]; spkList().splice(i, 1); markDirty(id => SPK_LINE.test(S.lines[id].text || '') && SPK_LINE.exec(S.lines[id].text)[2].trim() === sp.name); renderSpeakers(); renderScript(); autosave(); }
function putSpeaker(i){ const sp = spkList()[i]; if (!sp || !sp.name) return; const ids = sel.size ? [...sel] : (lastLine ? [lastLine] : []); if (!ids.length) return say(T('اول خطی را انتخاب کنید.', 'Select a line first.'), 'err');
  remember(); ids.forEach(id => { const L = S.lines[id], m = SPK_LINE.exec(L.text || ''); L.text = (m ? m[1] + L.text.slice(m[0].length) : L.text).replace(/^(\s*(?:\{[^}]*\}\s*)?)/, `$1${sp.name}: `); const [, c] = clipOfLine(id); if (c && !c.unvoiced) L.dirty = true; });
  renderScript(); autosave(); }
function spkEngine(sp){ return sp.engine || S.proj.engine; }
function spkVoiceOptions(sp){
  const e = spkEngine(sp);
  if (e === 'google') return voiceOptions(sp.gVoice || '', false).replace('<optgroup', `<option value="" ${sp.gVoice ? '' : 'selected'}>${T('— صدای پروژه —', "— project's voice —")}</option><optgroup`);
  if (e === 'fish') return `<option value="">${T('— صدای پروژه —', "— project's voice —")}</option>` + [...$('fishVoice').options].map(o => `<option value="${escapeHtml(o.value)}" ${o.value === sp.fishVoice ? 'selected' : ''}>${escapeHtml(o.text)}</option>`).join('');
  if (e === 'chatterbox') return `<option value="">${T('— صدای پروژه —', "— project's voice —")}</option>` + [...$('cbxVoice').options].map(o => `<option value="${escapeHtml(o.value)}" ${o.value === sp.cbxVoice ? 'selected' : ''}>${escapeHtml(o.text)}</option>`).join('');
  return null;                                                                                        // a light voice IS its engine
}
const SPK_VKEY = { google: 'gVoice', fish: 'fishVoice', chatterbox: 'cbxVoice' };
function renderSpeakers(){
  const box = $('spkList'); if (!box) return; const L = spkList();
  box.innerHTML = L.map((sp, i) => { const e = spkEngine(sp), vo = spkVoiceOptions(sp), vk = SPK_VKEY[e];
    return `<div class="space-y-1.5 rounded-field border border-base-300 p-1.5" data-si="${i}">
      <div class="flex items-center gap-1.5"><input class="input input-xs min-w-0 flex-1" dir="auto" value="${escapeHtml(sp.name)}" placeholder="${T('نام', 'Name')}" onchange="setSpk(${i}, 'name', this.value.trim())">
        <button class="btn btn-ghost btn-xs btn-square" onclick="previewSpeaker(${i})" data-tip="شنیدنِ صدا" data-tip-en="Hear the voice"><svg class="size-3.5"><use href="#i-play"/></svg></button>
        <button class="btn btn-ghost btn-xs btn-square" onclick="putSpeaker(${i})" data-tip="گذاشتنِ این نام سرِ خطِ انتخاب‌شده" data-tip-en="Put this name at the start of the selected line"><svg class="size-3.5"><use href="#i-corner-down-left"/></svg></button>
        <button class="btn btn-ghost btn-xs btn-square hover:text-error" onclick="delSpeaker(${i})" data-tip="حذفِ گوینده" data-tip-en="Remove speaker"><svg class="size-3.5"><use href="#i-trash-2"/></svg></button></div>
      <div class="grid grid-cols-2 gap-1.5"><select class="select select-xs" data-spk-engine="${i}" onchange="setSpk(${i}, 'engine', this.value)"><option value="">${T('— موتورِ پروژه —', "— project's engine —")}</option>${ENGINES.map(([v, l]) => `<option value="${v}" ${v === sp.engine ? 'selected' : ''}>${escapeHtml(l.split(' — ')[0])}</option>`).join('')}</select>
        ${vo ? `<select class="select select-xs" data-spk-voice="${i}" data-preview="${e}" onchange="setSpk(${i}, '${vk}', this.value)">${vo}</select>` : `<span class="self-center text-xs text-base-content/60">${T('صدای خودِ موتور', "the engine's own voice")}</span>`}</div>
      ${e === 'google' || e === 'fish' ? `<select class="select select-xs w-full" onchange="setSpk(${i}, 'gPreset', this.value)"><option value="">${T('— سبکِ پروژه —', "— project's style —")}</option>${G_PRESETS.map(p => `<option value="${escapeHtml(p[0])}" ${p[0] === sp.gPreset ? 'selected' : ''}>${escapeHtml(p[1])}</option>`).join('')}</select>` : ''}</div>`; }).join('')
    || `<p class="text-xs text-base-content/50">${T('هنوز گوینده‌ای نیست؛ همهٔ خط‌ها با صدای پروژه خوانده می‌شوند.', "No speakers yet; every line uses the project's voice.")}</p>`;
  box.querySelectorAll('select').forEach(el => { enh(el); if (el.dataset.spkVoice !== undefined){ const i = +el.dataset.spkVoice; el._preview = v => previewVoice(spkEngine(spkList()[i]), v || null); } });
}
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
  if (!confirm(T(`${FA(jobs.length)} نمونه‌صدا ساخته می‌شود (یک بار، با کلیدها و مدل‌های همین دستگاه). پوشه‌ای انتخاب کنید؛ بعد آن را با نامِ previews کنارِ پوشهٔ ui در مخزن بگذارید تا در برنامه بسته‌بندی شود.`, `${jobs.length} voice samples will be made (once, with this machine's keys and models). Pick a folder; then put it in the repository as ui/previews so it ships inside the app.`))) return;
  setBusy(true); try { const r = await API().previews_build(jobs); if (!r.ok){ if (r.error !== 'cancelled') say(r.error || '', 'err'); return; }
    say(T(`${FA(r.made)} نمونه در ${r.folder} ساخته شد` + (r.failed.length ? ` — ${FA(r.failed.length)} ساخته نشد` : ''), `${r.made} samples made in ${r.folder}` + (r.failed.length ? ` — ${r.failed.length} failed` : '')), r.failed.length ? 'err' : 'ok'); }
  finally { setBusy(false); }
}
