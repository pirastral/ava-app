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


class Api:
    def __init__(self):
        self._window = None

    _lang = "fa"

    def set_lang(self, lang):
        Api._lang = "en" if lang == "en" else "fa"
        return {"ok": True, "lang": Api._lang}

    def _status(self, msg, pct=None):
        if Api._lang == "en":
            msg = _tr_en(msg)
        payload = json.dumps({"msg": msg, "pct": pct})
        try:
            self._window.evaluate_js(f"window.avaStatus({payload})")
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
            return {"ok": True, "b64": b64, "gulp": gid}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

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
            mp3, n, mode = engines.patch_gulp(req["gulp"], req["text"],
                                              req.get("sel_start"), req.get("sel_end"),
                                              req["payload"], self._status)
            b64 = base64.b64encode(mp3).decode("ascii")
            return {"ok": True, "b64": b64, "gulp": req["gulp"], "changed": n, "mode": mode}
        except Exception as e:
            if type(e).__name__ != "Cancelled":
                traceback.print_exc()
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

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
            return {"ok": True, "b64": base64.b64encode(mp3).decode("ascii"), "seconds": round(len(pcm) / sr, 1)}
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
                webview.OPEN_DIALOG, directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.ogg;*.flac;*.m4a;*.aac)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            gid, mp3, name, seconds = engines.file_gulp(path)
            return {"ok": True, "gulp": gid, "b64": base64.b64encode(mp3).decode("ascii"), "name": name, "seconds": seconds}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def set_gain(self, gid, percent):
        try:
            import engines
            return {"ok": True, "b64": base64.b64encode(engines.set_gain(gid, float(percent))).decode("ascii")}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def cbx_voice_delete(self, voice_id):
        try:
            import engines
            return {"ok": True, "voices": engines.cbx_voice_delete(voice_id)}
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
            return {"ok": True, "b64": base64.b64encode(engines.pcm_to_mp3(pcm, sr)).decode("ascii"), "seconds": round(len(pcm) / sr, 1)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_delete(self, file):
        try:
            import engines
            return {"ok": True, "items": engines.music_delete(file)}
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

    def music_fetch(self, provider, item):
        try:
            import engines
            engines._job_start()
            pcm, sr, entry = engines.music_fetch(provider, item, self._status)
            return {"ok": True, "b64": base64.b64encode(engines.pcm_to_mp3(pcm, sr)).decode("ascii"),
                    "seconds": round(len(pcm) / sr, 1), "entry": entry, "credit": engines.music_credit(entry)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}

    def music_import(self):
        try:
            import engines
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG, directory=_downloads_dir(), allow_multiple=False,
                file_types=("Audio (*.wav;*.mp3;*.ogg;*.flac;*.m4a)",))
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            pcm, sr, entry = engines.music_import(path, self._status)
            return {"ok": True, "b64": base64.b64encode(engines.pcm_to_mp3(pcm, sr)).decode("ascii"),
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
                webview.OPEN_DIALOG, directory=_downloads_dir(), allow_multiple=False,
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
                "fish_tags": engines.FISH_TAGS, "fish_models": [[k, v["label"], v["paid"]] for k, v in engines.FISH_MODELS.items()],
                "fish_library_tags": engines.FISH_LIBRARY_TAGS}

    def settings_get(self):
        import engines
        return {"ok": True, **engines.settings_get()}

    def settings_set(self, kv):
        try:
            import engines
            return {"ok": True, **engines.settings_set(**(kv or {}))}
        except Exception as e:
            return {"ok": False, "error": str(e)}

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
                webview.SAVE_DIALOG, directory=_downloads_dir(), save_filename=name)
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
                webview.OPEN_DIALOG, directory=_downloads_dir(), allow_multiple=False,
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

    def save_mp3(self, b64, suffix=""):
        try:
            name = "ava-" + datetime.now().strftime("%Y-%m-%d-%H-%M-%S") + (("-" + suffix) if suffix else "") + ".mp3"
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG, directory=_downloads_dir(), save_filename=name)
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            Path(path).write_bytes(base64.b64decode(b64))
            return {"ok": True, "path": str(path)}
        except Exception as e:
            return {"ok": False, "error": (_tr_en(str(e)) if Api._lang == "en" else str(e))}


def main():
    api = Api()
    window = webview.create_window(
        "آوای جاوید شاه — تبدیل متن فارسی به گفتار",
        url=str(_res_path("ui") / "index.html"),
        js_api=api, width=980, height=880, min_size=(420, 640))
    api._window = window
    webview.start()


if __name__ == "__main__":
    main()
