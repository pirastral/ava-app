"""Ava — Persian text-to-speech desktop app."""
import base64, json, sys, threading, traceback
from datetime import datetime
from pathlib import Path

import webview


def _res_path(name: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
    return base / name


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
        """Called from JS. Runs in a worker thread (pywebview does this for us)."""
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
                webview.SAVE_DIALOG, directory=str(Path.home()), save_filename=name)
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
        js_api=api, width=980, height=860, min_size=(420, 640))
    api._window = window
    webview.start()


if __name__ == "__main__":
    main()
