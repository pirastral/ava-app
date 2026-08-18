"""Ava — Persian text-to-speech desktop app."""
import multiprocessing
multiprocessing.freeze_support()  # stops helper processes from opening new app windows

import base64, faulthandler, json, os, sys, traceback
from datetime import datetime
from pathlib import Path

os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

# Helper-process mode: light-voice synthesis runs here, isolated from the app.
if len(sys.argv) > 2 and sys.argv[1] == "--piper-worker":
    import engines
    engines.piper_worker_main(sys.argv[2])
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


def _downloads_dir() -> str:
    d = Path.home() / "Downloads"
    return str(d if d.is_dir() else Path.home())


class Api:
    def __init__(self):
        self._window = None

    def _status(self, msg, pct=None):
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
            traceback.print_exc()
            return {"ok": False, "error": str(e)}

    def save_mp3(self, b64):
        try:
            name = "ava-" + datetime.now().strftime("%Y-%m-%d-%H-%M-%S") + ".mp3"
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG, directory=_downloads_dir(), save_filename=name)
            if not result:
                return {"ok": False, "error": "cancelled"}
            path = result if isinstance(result, str) else result[0]
            Path(path).write_bytes(base64.b64decode(b64))
            return {"ok": True, "path": str(path)}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def main():
    api = Api()
    window = webview.create_window(
        "آوا — تبدیل متن فارسی به گفتار",
        url=str(_res_path("ui") / "index.html"),
        js_api=api, width=980, height=880, min_size=(420, 640))
    api._window = window
    webview.start()


if __name__ == "__main__":
    main()
