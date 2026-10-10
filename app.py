import sys
import os
"""Ava — Persian text-to-speech desktop app."""
import multiprocessing
multiprocessing.freeze_support()  # stops helper processes from opening new app windows

import base64, faulthandler, json, os, sys, traceback
from datetime import datetime
from pathlib import Path

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
# Windows: torch and onnxruntime each bundle the Intel OpenMP DLL; without this
# flag, initializing both aborts the process instantly (the classic silent crash).
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
# Windows ships a legacy ANSI codepage (cp1252/cp1256) on stdio, which cannot
# encode a single Persian letter: the worker's first Persian status message
# died with "charmap codec can't encode characters in position 27". Persian is
# this app's native language — no stream, path, or username may break it.
# These lines run BEFORE any helper-process dispatch, so every process the app
# starts inherits UTF-8. errors="replace" guarantees a diagnostic can never
# itself crash a run.
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")
for _s in ("stdout", "stderr"):
    try:
        getattr(sys, _s).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# Helper-process modes: synthesis runs isolated from the app window.
if len(sys.argv) > 2 and sys.argv[1] == "--piper-worker":
    import engines
    engines.piper_worker_main(sys.argv[2])
    sys.exit(0)
if len(sys.argv) > 1 and sys.argv[1] == "--chatterbox-worker":
    import engines
    engines.chatterbox_worker_main()
    sys.exit(0)

# Crash log: anything fatal is written to AvaModels/ava.log
_logdir = Path.home() / "AvaModels"
_logdir.mkdir(exist_ok=True)
if getattr(sys, "frozen", False):
    _logfile = open(_logdir / "ava.log", "a", buffering=1, encoding="utf-8")
    sys.stdout = sys.stderr = _logfile
    faulthandler.enable(_logfile)

import subprocess
import threading
import time
import webview


def _res_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    return base / name


def _tr_en(msg):
    """Engine messages are written in Persian; in the English UI the ones a
    user meets most are translated here (exact and patterned)."""
    import re as _re
    try:
        from en_strings import EXACT, PATTERNS
    except Exception:
        return msg
    out = None
    if msg in EXACT:
        out = EXACT[msg]
    else:
        for pat, rep_ in PATTERNS:
            m = _re.match(pat, msg)
            if m:
                try:
                    out = rep_.format(*m.groups())
                except Exception:
                    out = rep_
                break
    if out is None:
        out = msg
    # digits and the short labels that ride inside messages
    out = out.translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹٫", "0123456789."))
    for fa, en in (("گوگل", "Google"), ("رونویسی", "Transcription"), ("موسیقی", "Music"), ("حرکت‌گذاری", "Diacritization"),
                   ("ژیرو", "Gyro"), ("امیر", "Amir"), ("مانا", "Mana"), ("چترباکس", "Chatterbox"), ("ثانیه", "s")):
        out = out.replace(fa, en)
    return out


def _downloads_dir() -> str:
    d = Path.home() / "Downloads"
    return str(d if d.is_dir() else Path.home())


_VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv", ".gif")


def _with_video_ext(path, suggested) -> str:
    """175: the saved video keeps its format's extension (taken from the suggested name); a name typed with another
    video extension gets the right one in its place; anything else gets the extension added."""
    ext = Path(str(suggested)).suffix.lower()
    if ext not in _VIDEO_EXTS:
        ext = ".mp4"
    p = str(path)
    cur = Path(p).suffix.lower()
    if cur == ext:
        return p
    if cur in _VIDEO_EXTS:
        return p[: -len(cur)] + ext
    return p + ext



def _FD(name):
    """169: pywebview's current dialog names (FileDialog.OPEN…), the old constants on older versions."""
    fd = getattr(webview, "FileDialog", None)
    return getattr(fd, name) if fd is not None and hasattr(fd, name) else getattr(webview, name + "_DIALOG")


_OUTBOX = {}


def _big(data):
    """169: large results (a whole music track) cross the bridge in pieces — one multi-megabyte
    string stalled the window ('downloading music…' forever although the download had finished)."""
    if len(data) <= 512 * 1024:
        return {"b64": base64.b64encode(data).decode("ascii")}
    import uuid
    tok = uuid.uuid4().hex
    _OUTBOX[tok] = data
    return {"blob": tok, "size": len(data)}


class Api:
    def __init__(self):
        self._window = None

    _lang = "fa"

    def set_lang(self, lang):
        Api._lang = "en" if lang == "en" else "fa"
        return {"ok": True, "lang": Api._lang}

    _keys_seen = 0

    def set_appearance(self, dark):
        """177: the native lists (daisyUI selects are the system's menus) follow the app's day/night theme."""
        if sys.platform != "darwin":
            return {"ok": True}
        try:
            from AppKit import NSApplication, NSAppearance
            from PyObjCTools import AppHelper
            name = "NSAppearanceNameDarkAqua" if dark else "NSAppearanceNameAqua"

            def go():
                try:
                    NSApplication.sharedApplication().setAppearance_(NSAppearance.appearanceNamed_(name))
                except Exception:
                    pass
            AppHelper.callAfter(go)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _status(self, msg, pct=None):
        if Api._lang == "en":
            msg = _tr_en(msg)
        payload = json.dumps({"msg": msg, "pct": pct})
        try:
            self._window.evaluate_js(f"window.avaStatus({payload})")
        except Exception:
            pass
        try:   # 176: a key ran out (or came back) — the header's badge counts again, live
            import engines
            n = engines._KEYS_CHANGED["n"]
            if n != Api._keys_seen:
                Api._keys_seen = n
                self._window.evaluate_js("window.avaKeysChanged && window.avaKeysChanged()")
        except Exception:
            pass

    def generate(self, payload):
        try:
            import engines
            mp3 = engines.generate(payload, self._status)
            b64 = base64.b64encode(mp3).decode("ascii")
            return {"ok": True, "b64": b64, "kb": len(mp3) // 1024}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def generate_gulp(self, payload):
        try:
            import engines
            mp3, gid = engines.generate_gulp(payload, self._status)
            b64 = base64.b64encode(mp3).decode("ascii")
            return {"ok": True, "b64": b64, "gulp": gid, "lines": engines.gulp_lines(gid)}   # 153: each line's span
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def gulp_words(self, gid):
        """176: a part's line spans with their words timed again — after a project opens, or once the timing model is ready."""
        try:
            import engines
            return {"ok": True, "lines": engines.gulp_lines(gid), "timing": engines.ctc_state()}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def timing_state(self):
        """176: is the letter-timing model on this machine (ready · downloading NN% · failed)?"""
        try:
            import engines
            return {"ok": True, **engines.ctc_state()}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def reset_gulps(self):
        try:
            import engines
            engines.reset_gulps()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def patch_gulp(self, req):
        try:
            import engines
            mp3, n, mode, new_gid = engines.patch_gulp(req["gulp"], req["text"],
                                              req.get("sel_start"), req.get("sel_end"),
                                              req["payload"], self._status)
            b64 = base64.b64encode(mp3).decode("ascii")
            return {"ok": True, "b64": b64, "gulp": new_gid, "changed": n, "mode": mode, "lines": engines.gulp_lines(new_gid)}   # 140: a NEW part id; 153: line spans
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def gulp_cut(self, req):
        """177: the part with one stretch of silence taken out (a pause the voice left under a reaction)."""
        try:
            import engines
            mp3, new_gid = engines.gulp_cut(req["gulp"], req["t0"], req["t1"])
            return {"ok": True, "b64": base64.b64encode(mp3).decode("ascii"), "gulp": new_gid, "lines": engines.gulp_lines(new_gid)}
        except Exception as e:
            traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def timeline_files(self, spec, music=None):
        """153: the final file(s) from the timeline — clips at their positions, trims and rows."""
        try:
            import engines
            engines._job_start()
            files = engines.timeline_files(spec, music, self._status)
            out = {"ok": True, "b64": base64.b64encode(files["clean"]).decode("ascii"),
                   "kb": len(files["clean"]) // 1024, "seconds": files["seconds"]}
            if "music" in files:
                out["b64_music"] = base64.b64encode(files["music"]).decode("ascii")
                out["kb_music"] = len(files["music"]) // 1024
            return out
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def session(self):
        """154: the engine session — parts made in another session are no longer in memory."""
        import engines
        return {"ok": True, "session": engines.SESSION, "build": engines.BUILD}

    def gulp_audio(self, gid):
        """154: a part's audio and line spans, for the new editor."""
        try:
            import engines
            mp3, lines = engines.gulp_audio(gid)
            return {"ok": True, "b64": base64.b64encode(mp3).decode("ascii"), "lines": lines}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def timeline_captions(self, req):
        """153: SRT/VTT from the subtitle cues, with their own timings."""
        try:
            import engines
            return {"ok": True, "text": engines.timeline_captions(req.get("cues", []), req.get("fmt", "srt"))}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def splice(self, ids, music=None):
        """Final file(s): always the clean one; with music when asked (96)."""
        try:
            import engines
            engines._job_start()
            files = engines.final_files(ids, music, self._status)
            out = {"ok": True, "b64": base64.b64encode(files["clean"]).decode("ascii"),
                   "kb": len(files["clean"]) // 1024, "seconds": files["seconds"]}
            if "music" in files:
                out["b64_music"] = base64.b64encode(files["music"]).decode("ascii")
                out["kb_music"] = len(files["music"]) // 1024
            return out
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 96: background music (Lyria 3.5) -----------------------------------
    def music_generate(self, preset="piano", custom="", seconds=60):
        try:
            import engines
            engines._job_start()
            pcm, sr = engines.lyria_music(preset, custom, float(seconds), self._status)
            mp3 = engines.pcm_to_mp3(pcm, sr)
            return {"ok": True, **_big(mp3), "seconds": round(len(pcm) / sr, 1)}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def new_document(self):
        try:
            import engines
            engines.new_document()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 182 · safeguards: unsaved changes, the recovery copy, quitting, letting a project go ------------------------
    def set_dirty(self, dirty):
        """The page says whether there are unsaved changes (the window's close button asks only then)."""
        _STATE["dirty"] = bool(dirty)
        return {"ok": True}

    def app_quit(self, discard_recovery=False):
        """Close the window for real (after the page asked about unsaved changes)."""
        import engines
        _STATE["allow_close"] = True
        if discard_recovery:
            engines.recovery_clear()
        w = self._window
        threading.Thread(target=lambda: w.destroy(), daemon=True).start()
        return {"ok": True}

    def recovery_write(self, doc, path=None, name=None):
        try:
            import engines
            engines.recovery_write(doc or {}, path, name)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def recovery_info(self):
        import engines
        return {"ok": True, "info": engines.recovery_info() if _STATE.get("recovery_offer") else None}

    def recovery_later(self):
        """The offer was closed without a choice: the copy stays and is offered again at the next launch."""
        _STATE["recovery_offer"] = False
        return {"ok": True}

    def recovery_open(self):
        try:
            import engines
            r = engines.recovery_open()
            _STATE["recovery_offer"] = False
            return _opened((r.get("recovery") or {}).get("path"), r)
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def recovery_discard(self):
        import engines
        engines.recovery_discard()
        _STATE["recovery_offer"] = False
        return {"ok": True}

    def project_forget(self, keep_ids=None):
        """A new project: everything the previous one held in memory goes."""
        import engines
        return {"ok": True, "gone": engines.project_forget(keep_ids or [])}

    def project_commit(self, keep_ids=None):
        """182: the page has taken the opened project — the previous one's parts and music go; the file's music is the
        engine's music from now on (exporting and saving again keep it)."""
        import engines
        return {"ok": True, "gone": engines.project_commit(keep_ids or [])}

    def project_drop(self, ids=None):
        """182: the page said no to the opened file (saved by a newer build): its parts go, the current project stays."""
        import engines
        return {"ok": True, "gone": engines.project_drop(ids or [])}

    def gc_gulps(self, keep_ids):
        try:
            import engines
            return {"ok": True, "kept": engines.gc_gulps(keep_ids or [])}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_styles(self):
        import engines
        return {"ok": True, "styles": [[k, label] for k, label, _ in engines.MUSIC_STYLES]}

    def file_gulp(self):
        try:
            import engines
            result = self._window.create_file_dialog(
                _FD('OPEN'), directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.ogg;*.flac;*.m4a;*.aac)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            gid, mp3, name, seconds = engines.file_gulp(path)
            return {"ok": True, "gulp": gid, "b64": base64.b64encode(mp3).decode("ascii"), "name": name, "seconds": seconds}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def asset_gulp(self, aid, name=""):
        """182: an audio file the window put in the asset store (dropped or picked) becomes a part. fmt: this computer
        cannot decode it here — the window decodes it itself and hands over plain WAV."""
        try:
            import engines
            gid, mp3, nm, seconds = engines.asset_gulp(aid, name or None)
            return {"ok": True, "gulp": gid, **_big(mp3), "name": nm, "seconds": seconds}
        except Exception as e:
            import engines
            return {"ok": False, "fmt": isinstance(e, engines.AudioFormatError), "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def asset_to_mp3(self, aid, name=""):
        """182: an audio file the window cannot decode — decoded here, kept as an MP3 asset."""
        try:
            import engines
            return {"ok": True, **engines.asset_to_mp3(aid, name or None)}
        except Exception as e:
            import engines
            return {"ok": False, "fmt": isinstance(e, engines.AudioFormatError), "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def asset_drop(self, aid):
        try:
            import engines
            return {"ok": bool(engines.asset_drop(aid))}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def music_import_asset(self, aid, name=""):
        """182: the music library's import from a file picked in the window (the limits, then the same as music_import)."""
        try:
            import engines
            pcm, sr, entry = engines.music_import_asset(aid, name or None, self._status)
            return {"ok": True, **_big(engines.pcm_to_mp3(pcm, sr)),
                    "seconds": round(len(pcm) / sr, 1), "entry": entry}
        except Exception as e:
            import engines
            return {"ok": False, "fmt": isinstance(e, engines.AudioFormatError), "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def set_gain(self, gid, percent):
        try:
            import engines
            return {"ok": True, "b64": base64.b64encode(engines.set_gain(gid, float(percent))).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def cbx_voice_delete(self, voice_id):
        try:
            import engines
            voices, token = engines.cbx_voice_delete(voice_id)   # 182: the file waits in the trash (the step can be undone)
            return {"ok": True, "voices": voices, "token": token}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def cbx_voice_restore(self, token):
        try:
            import engines
            return {"ok": True, "voices": engines.cbx_voice_restore(token)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def silence_gulp(self, seconds):
        try:
            import engines
            gid, mp3 = engines.silence_gulp(float(seconds))
            return {"ok": True, "gulp": gid, "b64": base64.b64encode(mp3).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def clone_gulp(self, gid):
        try:
            import engines
            ngid, mp3 = engines.clone_gulp(gid)
            return {"ok": True, "gulp": ngid, "b64": base64.b64encode(mp3).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def drop_gulp(self, gid):
        try:
            import engines
            engines.drop_gulp(gid)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_list(self):
        try:
            import engines
            return {"ok": True, "items": engines.music_list()}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_load(self, file):
        try:
            import engines
            pcm, sr = engines.music_load(file)
            return {"ok": True, **_big(engines.pcm_to_mp3(pcm, sr)), "seconds": round(len(pcm) / sr, 1)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_delete(self, file):
        try:
            import engines
            items = engines.music_delete(file)
            last = dict(getattr(engines, "_MUSIC_LAST_DELETE", {}) or {})   # 182: what an undo needs to bring it back
            return {"ok": True, "items": items, "token": last.get("token"), "entry": last.get("entry")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_restore(self, token, entry=None):
        try:
            import engines
            return {"ok": True, "items": engines.music_restore(token, entry)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_search(self, provider, query, key="", style="ambient", page=1):
        try:
            import engines
            engines._job_start()
            if key and provider in ("freesound", "jamendo"):
                engines.save_key(provider, key)
            key = key or engines.music_key(provider)
            return {"ok": True, **engines.music_search(provider, query, key, self._status, style=style, page=page)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def blob_read(self, tok, offset=0, size=786432):
        """169: a piece of a large result (sizes are multiples of 3, so the base64 pieces join)."""
        data = _OUTBOX.get(tok)
        if data is None:
            return {"ok": False, "error": "gone"}
        chunk = data[int(offset):int(offset) + int(size)]
        if int(offset) + int(size) >= len(data):
            _OUTBOX.pop(tok, None)
        return {"ok": True, "b64": base64.b64encode(chunk).decode("ascii")}

    def sfx_read(self, file):
        """170: the bytes of a bundled sound effect (ui/sfx/<family>/<key>.mp3) — the window decodes them for playback."""
        try:
            rel = str(file).replace("\\", "/")
            if not (rel.startswith("sfx/") or rel.startswith("music/")) or ".." in rel:   # 176: a built-in music track can be an effect clip too
                return {"ok": False, "error": "bad path"}
            p = Path(_res_path(str(Path("ui") / rel)))
            if not p.exists():
                return {"ok": False, "error": "missing"}
            return {"ok": True, "b64": base64.b64encode(p.read_bytes()).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def ui_diag(self, name, data=None):
        """171: the window reports its own timings to the log."""
        try:
            import engines
            engines._diag("ui_" + str(name)[:40], **{str(k)[:30]: (v if isinstance(v, (int, float)) else str(v)[:80]) for k, v in (data or {}).items()})
        except Exception:
            pass
        return {"ok": True}

    def gulp_info(self, gid):
        try:
            import engines
            return {"ok": True, "engine": engines.gulp_engine(gid)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def music_fetch(self, provider, item):
        try:
            import engines
            engines._job_start()
            pcm, sr, entry = engines.music_fetch(provider, item, self._status)
            import time as _t; t0 = _t.time(); mp3 = engines.pcm_to_mp3(pcm, sr)
            engines._diag("music_bridge", encode_ms=int((_t.time() - t0) * 1000), mp3_bytes=len(mp3))
            self._status("موسیقی را به ویرایشگر می‌فرستم…")
            return {"ok": True, **_big(mp3),
                    "seconds": round(len(pcm) / sr, 1), "entry": entry, "credit": engines.music_credit(entry)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_import(self):
        try:
            import engines
            result = self._window.create_file_dialog(
                _FD('OPEN'), directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.ogg;*.flac;*.m4a)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            pcm, sr, entry = engines.music_import(path, self._status)
            return {"ok": True, **_big(engines.pcm_to_mp3(pcm, sr)),
                    "seconds": round(len(pcm) / sr, 1), "entry": entry}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_keys(self):
        try:
            import engines
            return {"ok": True, "freesound": engines.music_key("freesound"), "jamendo": engines.music_key("jamendo"),
                    "builtin": {"freesound": not engines.load_key("freesound") and bool(engines.builtin_key("freesound")),
                                "jamendo": not engines.load_key("jamendo") and bool(engines.builtin_key("jamendo"))}}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 116: Fish Audio ----------------------------------------------------
    def fish_key_get(self):
        import engines
        return {"ok": True, "key": engines.fish_key()}

    def fish_key_set(self, key):
        try:
            import engines
            engines.save_key("fish", (key or "").strip())
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def fish_probe(self):
        try:
            import engines
            w = engines.fish_wallet()
            return {"ok": "error" not in w, **w}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def fish_library(self, query="", tag="", language="", licensed=False, sort="score", page=1, category="", quality="curated"):
        try:
            import engines
            return {"ok": True, **engines.fish_library(query, tag or None, language or None, bool(licensed), sort or "score", int(page or 1), category=category or None, quality=quality or "curated")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def fish_my_voices(self):
        try:
            import engines
            return {"ok": True, "items": engines.fish_my_voices()}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def fish_delete_voice(self, model_id):
        try:
            import engines
            engines.fish_delete_voice(model_id[2:] if model_id.startswith("m:") else model_id)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def fish_clone(self, title="", transcript="", enhance=False):
        """Pick a clip from disk and make it a persistent private Fish voice."""
        try:
            import engines
            result = self._window.create_file_dialog(
                _FD('OPEN'), directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.m4a;*.flac)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            mid = engines.fish_clone_create(path, title or Path(path).stem, self._status, transcript or None, bool(enhance))
            return {"ok": True, "id": "m:" + mid}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def fish_voice_design(self, instruction, reference_text="", language="", n=2, speed=1.0, seed=None):
        try:
            import engines
            engines._job_start()
            return {"ok": True, "candidates": engines.fish_voice_design(instruction, reference_text, language or None, int(n), float(speed), seed, self._status)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def fish_design_keep(self, b64_wav, title):
        try:
            import engines
            return {"ok": True, "id": engines.fish_design_keep(b64_wav, title or "Designed voice", self._status)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def director_lists(self):
        import engines
        return {"ok": True, "ages": [[a[0], a[1], a[2]] for a in engines.DIRECTOR_AGES],
                "states": [[a[0], a[1], a[2]] for a in engines.DIRECTOR_STATES],
                "fish_tags": engines.FISH_TAGS, "fish_models": [[k, v["label"], v["paid"], v.get("en", v["label"])] for k, v in engines.FISH_MODELS.items()],
                "fish_library_tags": engines.FISH_LIBRARY_TAGS}

    # ---- 151: Gemini 3.8 voices ------------------------------------------------
    # ---- 161: the video tab's assets and the streamed MP4 save ------------------------
    def asset_begin(self, name, mime, size=0):
        import engines
        try:
            return {"ok": True, "id": engines.asset_begin(name, mime, size)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def asset_chunk(self, aid, b64):
        import engines
        try:
            return {"ok": engines.asset_chunk(aid, b64)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def asset_end(self, aid):
        import engines
        return {"ok": True, "asset": engines.asset_end(aid)}

    def asset_info(self, aid):
        import engines
        return {"ok": True, "asset": engines.asset_info(aid)}

    def asset_read(self, aid, offset=0, size=4194304):
        import engines
        try:
            return {"ok": True, "b64": engines.asset_read(aid, offset, size)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def video_save_open(self, suggested="video.mp4", need_mb=0):
        """Ask where to save the video, then accept it in chunks (big files never cross in one piece).
        175: the file keeps the format's own extension (.mp4 · .mov · .webm · .mkv · .gif) — it used to become ….webm.mp4.
        182: asked BEFORE the encoding (the file is written while it is made); need_mb = its estimated size — a disk
        without that much room says so (with the numbers) before anything starts."""
        try:
            import engines
            res = self._window.create_file_dialog(_FD('SAVE'), directory=_downloads_dir(), save_filename=suggested)
            if not res:
                return {"ok": False, "error": "cancelled"}
            path = _with_video_ext(res if isinstance(res, str) else res[0], suggested)
            if need_mb:
                engines.need_room(Path(path).parent, float(need_mb))
            return {"ok": True, "job": engines.save_stream_open(path), "path": str(path)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def video_save_chunk(self, job, b64):
        import engines
        try:
            return {"ok": engines.save_stream_chunk(job, b64)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def video_save_at(self, job, b64, position):
        import engines
        try:
            return {"ok": engines.save_stream_at(job, b64, position)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def video_save_abort(self, job):
        import engines
        try:
            return {"ok": engines.save_stream_abort(job)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def video_save_close(self, job):
        import engines
        try:
            return {"ok": True, "path": engines.save_stream_close(job)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 162: voice previews ------------------------------------------------------------
    def mp3_begin(self, sr, ch):
        import engines
        return {"ok": True, "job": engines.mp3_begin(sr, ch)}

    def mp3_chunk(self, job, b64):
        import engines
        return {"ok": engines.mp3_chunk(job, b64)}

    def mp3_end(self, job):
        import engines
        try:
            return {"ok": True, "b64": engines.mp3_end(job)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def voice_preview(self, payload):
        try:
            import engines
            return {"ok": True, "b64": base64.b64encode(engines.voice_preview(payload or {}, self._status)).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def previews_build(self, jobs):
        """Build the bundled previews into a folder the founder picks (then commit it as ui/previews)."""
        try:
            import engines
            res = self._window.create_file_dialog(_FD('FOLDER'), directory=_downloads_dir())
            if not res:
                return {"ok": False, "error": "cancelled"}
            folder = res if isinstance(res, str) else res[0]
            return {"ok": True, **engines.previews_build(jobs or [], folder, self._status, bundled_dir=str(_res_path("ui") / "previews"))}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def project_save(self, doc, path=None):
        """160: save the whole project — document, voiced parts, music — as one .ava file. 170: with a path, write over it (Save)."""
        try:
            import engines
            # 182: written beside the file and swapped in only when complete (a crash or a full disk mid-save can no
            #      longer destroy the only copy); the version it replaces goes to AvaModels/backups; the recovery copy is
            #      refreshed with it, so it is never older than the saved file
            if not (path and str(path).lower().endswith(".ava")):
                res = self._window.create_file_dialog(_FD('SAVE'), directory=_downloads_dir(), save_filename="project.ava")
                if not res:
                    return {"ok": False, "error": "cancelled"}
                path = res if isinstance(res, str) else res[0]
                if not str(path).lower().endswith(".ava"):
                    path = str(path) + ".ava"
            path = engines.project_save_safe(doc or {}, path)
            try:
                engines.recovery_write(doc or {}, path, Path(str(path)).stem, from_save=True)
            except Exception as e:
                print("[ava] recovery copy after save:", e)
            return {"ok": True, "path": str(path)}   # the page says whether anything changed meanwhile (set_dirty)
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def pending_open(self):
        """180: the .ava the app was asked to open (double-clicked in Finder or Explorer) — handed over once, when the page is up."""
        _OPEN_REQ["ready"] = True
        p, _OPEN_REQ["path"] = _OPEN_REQ["path"], None
        return {"ok": True, "path": p}

    def project_open_path(self, path):
        """180: open a given .ava without a dialog (a double-clicked file)."""
        try:
            import engines
            if not path or not str(path).lower().endswith(".ava") or not os.path.isfile(str(path)):
                raise RuntimeError(("This project file was not found: " if Api._lang == "en" else "فایل پروژه پیدا نشد: ") + str(path))
            return _opened(str(path), engines.project_unpack(str(path)))
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def project_open(self):
        """160: reopen a .ava project exactly as it was saved."""
        try:
            import engines
            res = self._window.create_file_dialog(_FD('OPEN'), directory=_downloads_dir(), allow_multiple=False,
                                                  file_types=("Avaye Javid Shah project (*.ava)",))
            if not res:
                return {"ok": False, "error": "cancelled"}
            path = res if isinstance(res, str) else res[0]
            return _opened(str(path), engines.project_unpack(str(path)))
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_voices(self, req=None):
        """159: one page of the Extended Voice Library with filters."""
        try:
            import engines
            req = req or {}
            return {"ok": True, **engines.g38_voice_page(req.get("filters") or {}, req.get("page_token") or "", self._status)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_library(self, req=None):
        try:
            import engines
            v = engines.g38_library(self._status, (req or {}).get("language") or "fa-IR", bool((req or {}).get("force")))
            return {"ok": True, "voices": v}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 152 ------------------------------------------------------------------
    def g38_search(self, req):
        try:
            import engines
            return {"ok": True, "voices": engines.g38_library_search(req or {}, self._status)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_preview(self, req):
        try:
            import engines
            pcm, sr = engines.g38_preview(req.get("voice", "Charon"), req.get("style", ""), req.get("text", ""),
                                          req.get("cfg") or {}, self._status)
            return {"ok": True, "b64": base64.b64encode(engines.pcm_to_mp3(pcm, sr)).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_design(self, req):
        try:
            import engines
            return {"ok": True, "design": engines.g38_design_create(req.get("name", ""), req.get("prompt", ""),
                                                                    req.get("gender", ""), self._status)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_designs(self):
        import engines
        return {"ok": True, "designs": engines.g38_designs()}

    def g38_design_delete(self, req):
        import engines
        engines.g38_design_delete(req.get("id", ""))
        return {"ok": True}

    def g38_clones(self):
        import engines
        return {"ok": True, "clones": engines.g38_clones(), "consent": engines.G38_CONSENT_EN,
                "tags": engines.G38_TAGS}

    def g38_pick_audio(self, req):
        """Pick a reference or consent recording from disk."""
        try:
            result = self._window.create_file_dialog(
                _FD('OPEN'), directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.ogg;*.flac;*.m4a;*.webm)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            import engines
            engines.audio_limits_check(path)                            # 182: the import limits on every way in
            _, secs = engines._to_wav24k_mono(open(path, "rb").read())
            engines.audio_seconds_check(secs, os.path.basename(path))
            return {"ok": True, "path": path, "seconds": round(secs, 1), "name": os.path.basename(path)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_clone_create(self, req):
        try:
            import engines
            c = engines.g38_clone_create(req.get("name", ""), req["ref"], req["consent"], self._status)
            return {"ok": True, "clone": c}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def g38_clone_delete(self, req):
        import engines
        engines.g38_clone_delete(req.get("id", ""))
        return {"ok": True}

    # ---- 148: network / VPN route --------------------------------------------
    def net_get(self):
        import engines
        ns = engines.net_settings()
        return {"ok": True, **ns, "route": engines._NET.get("label") or ""}

    def net_set(self, req):
        import engines
        engines.settings_set(net_mode=req.get("mode", "auto"), net_custom=(req.get("custom") or "").strip())
        engines._NET.update(route=None, label="", checked=0.0, failed={})
        return {"ok": True}

    def net_test(self):
        import engines
        engines._NET.update(route=None, label="", checked=0.0, failed={})
        ok, label, report = engines.ensure_route(lambda *a, **k: None, force=True)
        return {"ok": True, "reached": ok, "label": label,
                "text": engines.net_status_text(ok, label, report),
                "tried": [{"route": r, "result": v} for r, v in report]}

    def settings_get(self):
        import engines
        return {"ok": True, **engines.settings_get()}

    def settings_set(self, kv):
        try:
            import engines
            return {"ok": True, **engines.settings_set(**(kv or {}))}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    # ---- 126: activation ----------------------------------------------------
    def license_state(self):
        import engines
        return engines.license_status()

    def license_activate(self, activation):
        import engines
        return engines.license_activate(activation or "")

    def license_enter_app(self):
        """Called by the gate after a successful activation: swap the window to
        the app itself. One window, no reload flash, nothing behind the gate."""
        try:
            self._window.load_url(str(_res_path("ui") / "index.html"))
            self._window.resize(980, 880)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def license_quit(self):
        try:
            self._window.destroy()
        except Exception:
            pass
        return {"ok": True}

    # ---- 127 ----------------------------------------------------------------
    def take_report(self):
        """Sentences that are still missing from the last generation, if any."""
        import engines
        out = engines.take_report()
        if Api._lang == "en":
            out = [{**h, "text": h.get("text", "")} for h in out]
        return {"ok": True, "holes": out}

    def quota_headroom(self):
        import engines
        u, t = engines.google_quota_headroom()
        return {"ok": True, "usable": u, "total": t}

    def music_presets(self):
        import engines
        return {"ok": True, "presets": list(engines.MUSIC_PRESETS.keys())}

    # ---- 96: captions -------------------------------------------------------
    def captions(self, ids):
        try:
            import engines
            engines._job_start()
            return {"ok": True, **engines.captions_for(ids, self._status)}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def save_text(self, text, ext="srt"):
        try:
            name = "ava-" + datetime.now().strftime("%Y-%m-%d-%H-%M-%S") + "." + ext
            result = self._window.create_file_dialog(
                _FD('SAVE'), directory=_downloads_dir(), save_filename=name)
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            Path(path).write_text(text, encoding="utf-8")
            return {"ok": True, "path": str(path)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def ezafe(self, text, tool="local", key=""):
        """Run the chosen diacritization tool and return marked text for the editor."""
        try:
            import engines
            marked = engines.ezafe_apply(text, self._status, tool=tool, key=key)
            return {"ok": True, "text": marked}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def build(self):
        import engines
        return {"n": engines.BUILD, "fa": engines.BUILD_FA}

    # ---- 91: cancel whatever is running, in every engine -------------------
    def cancel(self):
        try:
            import engines
            engines.cancel()
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 90: chatterbox voice library --------------------------------------
    def cbx_voices(self):
        try:
            import engines
            return {"ok": True, "voices": engines.cbx_voices()}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def cbx_voice_add(self):
        """Pick a clip with the OS file dialog and add it to the user library."""
        try:
            import engines
            result = self._window.create_file_dialog(
                _FD('OPEN'), directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.m4a;*.flac;*.ogg;*.aac)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            v = engines.cbx_voice_add(path)
            return {"ok": True, "voice": v, "voices": engines.cbx_voices()}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    # ---- 90: Google keys (shared by the Google voice and the diacritizer) --
    def google_keys(self):
        try:
            import engines
            return {"ok": True, "keys": engines.google_keys_status()}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def google_probe(self, model=None):
        try:
            import engines
            return engines.google_probe(model, self._status)
        except Exception as e:
            return {"ok": False, "msg": str(e)}

    def google_keys_set(self, keys):
        try:
            import engines
            return {"ok": True, "keys": engines.google_keys_set(list(keys or []))}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def open_url(self, url):
        try:
            import webbrowser
            if isinstance(url, str) and url.startswith("https://"):
                webbrowser.open(url)
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def timeline_export(self, spec, music=None, suffix=""):
        """169: render the composition and save it in one step — the finished file never crosses the bridge."""
        try:
            import engines
            engines._job_start()
            files = engines.timeline_files(spec, music, self._status)
            data = files.get("music") if (music and files.get("music")) else files["clean"]
            name = "ava-" + datetime.now().strftime("%Y-%m-%d-%H-%M-%S") + (("-" + suffix) if suffix else "") + ".mp3"
            result = self._window.create_file_dialog(_FD('SAVE'), directory=_downloads_dir(), save_filename=name)
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            Path(path).write_bytes(data)
            return {"ok": True, "path": str(path), "seconds": files.get("seconds")}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def open_log_folder(self):
        """169: reveal ava.log in the user's AvaModels folder — resolved from the home folder at run time, never a fixed path."""
        try:
            log = _logdir / "ava.log"
            if sys.platform == "darwin":
                subprocess.Popen(["open", "-R", str(log)] if log.exists() else ["open", str(_logdir)])
            elif sys.platform.startswith("win"):
                subprocess.Popen(["explorer", "/select," + str(log)] if log.exists() else ["explorer", str(_logdir)])
            else:
                subprocess.Popen(["xdg-open", str(_logdir)])
            return {"ok": True, "path": str(_logdir)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def save_mp3(self, b64, suffix=""):
        try:
            name = "ava-" + datetime.now().strftime("%Y-%m-%d-%H-%M-%S") + (("-" + suffix) if suffix else "") + ".mp3"
            result = self._window.create_file_dialog(
                _FD('SAVE'), directory=_downloads_dir(), save_filename=name)
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            data = base64.b64decode(b64)
            import engines
            engines.need_room(Path(path).parent, len(data) / (1 << 20))   # 182: room on the disk first (with the numbers)
            Path(path).write_bytes(data)
            return {"ok": True, "path": str(path)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}


# 180 · THE .ava FILE TYPE — its own document icon in Finder and Explorer (a page with the app's own crown — 181: in neutral
#       greys, like Finder's own document icons — ava-doc.icns / ava-doc.ico, made by tools/make_doc_icon.py) and a
#       double-click opens the project in the app.
#       macOS: the bundle declares the type (build.spec); Finder's request to open a file arrives as an Apple Event, taken
#       here by pywebview's app delegate (without it macOS would say the app cannot open the file).
#       Windows: there is no installer, so the app registers the type for this user at launch (HKCU — no admin rights; written
#       again only when something changed, e.g. the app folder moved or an update brought a new icon) and receives the file
#       in its arguments.
_OPEN_REQ = {"path": None, "ready": False, "window": None}
# 182 · the app's own state for the safeguards: unsaved changes (told by the page), a close the page has allowed, and
#       whether the last session ended without closing normally (its recovery copy is then offered once)
_STATE = {"dirty": False, "allow_close": False, "recovery_offer": False}


def _opened(path, unpacked):
    """182: a project file has been read. Nothing of the current project is let go here — the page may still say no
    (a file saved by a newer build); once it has taken the project it commits (project_commit), else drops it."""
    import engines
    return {"ok": True, "path": path, **unpacked, "build_now": engines.BUILD}


def _call_page(js):
    """182: never wait for the page from inside a macOS event (the window's own thread would wait for itself — the freeze
    of a .ava double-clicked while the app was open); the script is handed over from a helper thread."""
    w = _OPEN_REQ.get("window")
    if w is None:
        return

    def run():
        try:
            w.evaluate_js(js)
        except Exception as e:
            print("[ava] page call:", e)
    threading.Thread(target=run, daemon=True).start()


def _focus_window():
    w = _OPEN_REQ.get("window")
    if w is None:
        return

    def run():
        try:
            w.restore()
        except Exception:
            pass
        try:
            w.show()
        except Exception:
            pass
        if os.name == "nt":   # Windows only brings a window forward this way
            try:
                w.on_top = True
                time.sleep(0.15)
                w.on_top = False
            except Exception:
                pass
    threading.Thread(target=run, daemon=True).start()



def _open_request(path):
    """A .ava to open: kept until the page asks for it; a page that is already up is told at once.
    182: told from a helper thread — this runs inside macOS's «open these files» event on the window's own thread, and
    waiting there for the page froze the app (a .ava double-clicked while the app was open)."""
    _OPEN_REQ["path"] = str(path)
    w = _OPEN_REQ.get("window")
    if w is not None and _OPEN_REQ.get("ready"):
        _OPEN_REQ["path"] = None
        _call_page("window.avaOpenPath && window.avaOpenPath(" + json.dumps(str(path)) + ")")
        _focus_window()


def _ava_in_args():
    for a in sys.argv[1:]:
        if str(a).lower().endswith(".ava") and os.path.isfile(a):
            return os.path.abspath(a)
    return None


def _register_ava_windows():
    if os.name != "nt" or not getattr(sys, "frozen", False):
        return
    try:
        import winreg
        import ctypes
        ico = str(_res_path("ava-doc.ico"))
        if not os.path.isfile(ico):
            return
        prog = "AvayeJavidShah.Project"
        # 181: a fingerprint of the icon's pictures, kept beside the type. An update that brings a new icon to the same place
        #      changes it, so the type is written again and Explorer is told to drop the icon it remembers (it keeps showing
        #      the old one otherwise — the icon's path alone has not changed)
        import hashlib
        with open(ico, "rb") as f:
            stamp = hashlib.sha1(f.read()).hexdigest()[:16]
        want = [("Software\\Classes\\.ava", "", prog),
                ("Software\\Classes\\.ava\\OpenWithProgids", prog, ""),
                ("Software\\Classes\\" + prog, "", "Avaye Javid Shah project"),
                ("Software\\Classes\\" + prog, "AvaIcon", stamp),
                ("Software\\Classes\\" + prog + "\\DefaultIcon", "", ico + ",0"),
                ("Software\\Classes\\" + prog + "\\shell\\open\\command", "", '"' + sys.executable + '" "%1"')]
        changed = False
        for key, name, val in want:
            with winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER, key, 0, winreg.KEY_READ | winreg.KEY_WRITE) as k:
                try:
                    cur = winreg.QueryValueEx(k, name)[0]
                except OSError:
                    cur = None
                if cur != val:
                    winreg.SetValueEx(k, name, 0, winreg.REG_SZ, val)
                    changed = True
        if changed:   # Explorer redraws the icons of every .ava file (a new icon included)
            ctypes.windll.shell32.SHChangeNotify(0x08000000, 0x1000, None, None)   # SHCNE_ASSOCCHANGED, SHCNF_FLUSH
    except Exception as e:
        print("[ava] .ava file type (Windows):", e)


def _mac_open_files():
    if sys.platform != "darwin":
        return
    try:
        from webview.platforms.cocoa import BrowserView

        class AvaAppDelegate(BrowserView.AppDelegate):
            def application_openFiles_(self, app, filenames):
                try:
                    for f in list(filenames or []):
                        if str(f).lower().endswith(".ava"):
                            _open_request(str(f))
                finally:
                    try:
                        app.replyToOpenOrPrint_(0)   # NSApplicationDelegateReplySuccess
                    except Exception:
                        pass
        BrowserView.AppDelegate = AvaAppDelegate
    except Exception as e:
        print("[ava] .ava file type (macOS):", e)


def _instance_addr():
    import hashlib
    who = hashlib.sha1(str(Path.home()).encode("utf-8")).hexdigest()[:10]
    if os.name == "nt":
        return r"\\.\pipe\avaye-javid-shah-" + who, "AF_PIPE"
    return str(Path.home() / "AvaModels" / ".instance.sock"), "AF_UNIX"


def _single_instance(first):
    """182 · one copy of the app at a time (the founder's log showed two running at once): a second launch hands its file
    (if any) to the running copy, which comes forward, and quits. False = this launch should quit."""
    from multiprocessing.connection import Listener, Client
    addr, fam = _instance_addr()
    key = b"ava-instance-1"
    try:
        c = Client(addr, family=fam, authkey=key)
        try:
            if os.name == "nt":
                import ctypes
                ctypes.windll.user32.AllowSetForegroundWindow(-1)   # ASFW_ANY: the running copy may come forward
        except Exception:
            pass
        c.send({"open": first})
        c.close()
        return False
    except Exception:
        pass
    try:
        if fam == "AF_UNIX" and os.path.exists(addr):
            os.unlink(addr)   # left by a copy that did not close normally
        listener = Listener(addr, family=fam, authkey=key)
    except Exception as e:
        print("[ava] single instance:", e)
        return True

    def serve():
        while True:
            try:
                conn = listener.accept()
                msg = conn.recv()
                conn.close()
            except Exception:
                continue
            p = (msg or {}).get("open") if isinstance(msg, dict) else None
            if p:
                _open_request(p)
            else:
                _focus_window()
    threading.Thread(target=serve, daemon=True).start()
    return True


def _mac_refresh_icons_once():
    """182 · once per build on macOS: the app re-registers itself with Launch Services and drops the stale Quick Look
    thumbnails, so .ava files saved before the type existed show the crown too (they kept the plain icon)."""
    if sys.platform != "darwin" or not getattr(sys, "frozen", False):
        return
    import engines
    mark = Path.home() / "AvaModels" / ".icons-refreshed"
    try:
        if mark.exists() and mark.read_text().strip() == str(engines.BUILD):
            return
    except Exception:
        pass

    def run():
        try:
            bundle = Path(sys.executable).resolve().parents[2]
            ls = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
            if os.path.exists(ls) and str(bundle).endswith(".app"):
                subprocess.run([ls, "-f", str(bundle)], timeout=60, capture_output=True)
            if os.path.exists("/usr/bin/qlmanage"):
                subprocess.run(["/usr/bin/qlmanage", "-r", "cache"], timeout=60, capture_output=True)
            # Spotlight keeps the type a file was given when it was first indexed: .ava files indexed before the app
            # declared the type still carry a «dynamic» type there, and Finder draws them plain. They are indexed again
            # (the files themselves are not touched).
            if os.path.exists("/usr/bin/mdfind") and os.path.exists("/usr/bin/mdimport"):
                r = subprocess.run(["/usr/bin/mdfind", "kMDItemFSName == '*.ava'c"], timeout=60, capture_output=True, text=True)
                paths = [q for q in (r.stdout or "").splitlines() if q.lower().endswith(".ava") and os.path.isfile(q)][:5000]
                for i in range(0, len(paths), 200):
                    subprocess.run(["/usr/bin/mdimport", *paths[i:i + 200]], timeout=180, capture_output=True)
            mark.parent.mkdir(parents=True, exist_ok=True); mark.write_text(str(engines.BUILD))
        except Exception as e:
            print("[ava] icon refresh:", e)
    threading.Thread(target=run, daemon=True).start()


def _session_begin():
    """182 · a recovery copy left behind by a session that did not end normally is offered (engines.recovery_session_begin)."""
    import engines
    try:
        engines._RECOVERY_DIR.mkdir(parents=True, exist_ok=True)
        _STATE["recovery_offer"] = engines.recovery_session_begin()
    except Exception as e:
        print("[ava] recovery at launch:", e)


def _on_closing():
    """182 · the window's close button (and ⌘Q): with unsaved changes the page asks first — Save, Don't save or Cancel —
    and closes the window itself afterwards (app_quit). Nothing here may wait for the page (macOS calls this on the
    window's own thread)."""
    if _STATE["dirty"] and not _STATE["allow_close"]:
        _call_page("window.avaAskBeforeClose && window.avaAskBeforeClose()")
        return False
    return True


def _on_closed():
    """182 · a normal close with nothing unsaved (or after Save / Don't save): this session's recovery copy goes."""
    import engines
    try:
        if not _STATE["dirty"] or _STATE["allow_close"]:
            engines.recovery_clear()
    except Exception:
        pass


def main():
    first = _ava_in_args()
    if not _single_instance(first):
        return   # 182: the running copy opens the file
    api = Api()
    _register_ava_windows()
    _mac_open_files()
    _mac_refresh_icons_once()
    _session_begin()
    try:
        engines_mod = __import__("engines"); engines_mod.trash_purge()   # 182: deletions of the last session are final now
    except Exception as e:
        print("[ava] trash:", e)
    if first:
        _OPEN_REQ["path"] = first
    # 126: the gate is the WHOLE window until the licence verifies — the app's UI
    # is never loaded behind it, so there is nothing to reveal by closing a dialog.
    import engines
    licensed = engines.license_status()["ok"]
    if licensed:
        engines.warm_route()          # 150: find a network route in the background at launch
    # 159: open 16:9, as large as fits inside 90% of the screen
    win_w, win_h = 1600, 900
    try:
        sc = webview.screens[0]
        W, H = int(sc.width * 0.9), int(sc.height * 0.9)
        win_w, win_h = (W, int(W * 9 / 16)) if W * 9 / 16 <= H else (int(H * 16 / 9), H)
    except Exception:
        pass
    window = webview.create_window(
        "آوای جاوید شاه — تبدیل متن فارسی به گفتار",
        url=str(_res_path("ui") / ("index.html" if licensed else "gate.html")),
        js_api=api, width=win_w if licensed else 720, height=win_h if licensed else 760,
        min_size=(420, 640))
    api._window = window
    _OPEN_REQ["window"] = window
    try:   # 182: unsaved changes are asked about before the window closes
        window.events.closing += _on_closing
        window.events.closed += _on_closed
    except Exception as e:
        print("[ava] close guard:", e)
    # 177 · the window's own process (WKWebView's web content on macOS) is watched with the engine and the Chatterbox
    #       worker: every 30 s into the log, and a warning on the page past a quarter of the computer's memory (179)
    web = {"pid": None}

    def _grab_web_pid():
        if sys.platform != "darwin":
            return
        try:
            from webview.platforms.cocoa import BrowserView
            from PyObjCTools import AppHelper

            def grab():
                try:
                    for bv in list(BrowserView.instances.values()):
                        wk = getattr(bv, "webview", None) or getattr(bv, "webkit", None)
                        f = getattr(wk, "_webProcessIdentifier", None) if wk is not None else None
                        if f:
                            web["pid"] = int(f()) or None
                            return
                except Exception:
                    pass
            AppHelper.callAfter(grab)
        except Exception:
            pass
    try:
        window.events.loaded += _grab_web_pid
    except Exception:
        pass

    def _mem_warn(main_mb, web_mb):
        big = max(main_mb, web_mb) / 1024
        if Api._lang == "en":
            msg = f"The app is using {big:.1f} GB of memory — save the project and reopen the app."
        else:
            msg = f"برنامه {big:.1f} گیگابایت حافظه گرفته — پروژه را ذخیره کنید و برنامه را دوباره باز کنید."
        try:
            window.evaluate_js(f"window.avaStatus({json.dumps({'msg': msg, 'pct': None, 'kind': 'err'})})")
        except Exception:
            pass
    engines.mem_watch(lambda: web["pid"], _mem_warn)
    if licensed:   # 176: the letter-timing model — fetched once in the background, then the page re-times what it shows
        def _timing_ready():
            try:
                window.evaluate_js("window.avaTimingReady && window.avaTimingReady()")
            except Exception:
                pass
        engines.ctc_warm(api._status, notify=_timing_ready)
    webview.start()


if __name__ == "__main__":
    main()
