"""
app-licensing — offline, fingerprint-locked activation for a standalone desktop app.

The model
--------
- The app carries a PUBLIC key (safe to ship, baked into the binary).
- You keep the matching PRIVATE key OFFLINE (never in the app, never in the repo).
- Each machine derives a stable *fingerprint*. The user sends you a short
  request code containing it; you sign an activation for THAT fingerprint with
  your private key (issue_license.py). The app verifies the signature with the
  public key and stores the activation. On every launch it re-checks that the
  stored activation's fingerprint matches this machine.

What this gives you
-------------------
- A new machine cannot run the app without an activation you personally signed.
- An activation for one machine is useless on another (fingerprint-bound).
- No keygen is possible: acceptance is signature verification, not a checksum.
- Fully offline. No server, no phone-home, nothing destructive.

What it does NOT give you (be honest with yourself)
--------------------------------------------------
- It is not copy protection against someone who can read the code. The check
  lives in the client; a capable person can patch it out. It stops *spreading*
  among non-technical people, not reverse engineering. Real protection for a
  commercial product is server-side execution (keep the engine + keys on your
  server); see references/threat-model.md.

Dependencies: PyNaCl (Ed25519). `pip install pynacl`.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
from pathlib import Path

try:
    from nacl.signing import SigningKey, VerifyKey
    from nacl.exceptions import BadSignatureError
except Exception:  # pragma: no cover - the app must fail clearly if the dep is missing
    SigningKey = VerifyKey = None
    BadSignatureError = Exception


# ---------------------------------------------------------------- fingerprint
def machine_fingerprint() -> str:
    """A stable, non-reversible id for this machine.

    Sources, best-effort per OS, hashed together so the raw hardware ids never
    leave the machine. Falls back gracefully; a reinstall can change it (that is
    why re-issuing an activation must be easy — see the skill).
    """
    parts = [platform.system(), platform.machine()]
    sysname = platform.system()
    try:
        if sysname == "Darwin":
            out = subprocess.check_output(
                ["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"],
                text=True, stderr=subprocess.DEVNULL, timeout=5)
            m = re.search(r'"IOPlatformUUID"\s*=\s*"([^"]+)"', out)
            if m:
                parts.append(m.group(1))
        elif sysname == "Windows":
            out = subprocess.check_output(
                ["reg", "query", r"HKLM\SOFTWARE\Microsoft\Cryptography", "/v", "MachineGuid"],
                text=True, stderr=subprocess.DEVNULL, timeout=5)
            m = re.search(r"MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)", out)
            if m:
                parts.append(m.group(1))
        elif sysname == "Linux":
            for p in ("/etc/machine-id", "/var/lib/dbus/machine-id"):
                if Path(p).exists():
                    parts.append(Path(p).read_text().strip())
                    break
    except Exception:
        pass
    raw = "|".join(parts)
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return digest[:32]


def _b32(data: bytes) -> str:
    return base64.b32encode(data).decode("ascii").rstrip("=")


def _grp(s: str, n: int = 5) -> str:
    return "-".join(s[i:i + n] for i in range(0, len(s), n))


def request_code(fingerprint: str | None = None) -> str:
    """The human-transferable code the user reads/sends to you. It encodes the
    FULL fingerprint (base32, grouped), so you can issue from the code alone."""
    fp = fingerprint or machine_fingerprint()
    # No product prefix: a request code in transit or in a screenshot must not
    # identify the software (opsec — holders may be at risk).
    return _grp(_b32(bytes.fromhex(fp)), 5)


def fingerprint_from_code(code: str) -> str:
    """Inverse of request_code(): recover the 32-hex fingerprint from a code."""
    s = code.strip().upper()
    if s.startswith("AVA-"):          # accept old-style codes too
        s = s[4:]
    s = s.replace("-", "")
    pad = "=" * (-len(s) % 8)
    return base64.b32decode(s + pad).hex()


# ---------------------------------------------------------------- verify (app)
def _decode_activation(activation: str) -> dict:
    s = activation.strip().replace("\n", "")
    for pre in ("LIC-", "AVA-LIC-"):     # tolerate either form
        if s.upper().startswith(pre):
            s = s[len(pre):]
            break
    pad = "=" * (-len(s) % 4)
    payload = base64.urlsafe_b64decode(s + pad)
    return json.loads(payload.decode("utf-8"))


def verify_activation(activation: str, public_key_b64: str, fingerprint: str | None = None) -> dict:
    """Return the activation record if the signature is valid AND it is bound to
    this machine; raise ValueError otherwise. This is what the app calls.

    Record shape: {"fp":..., "licensee":..., "issued":..., "expires":<epoch|null>,
                   "seat":..., "sig":<b64 over the canonical body>}
    """
    if VerifyKey is None:
        raise RuntimeError("PyNaCl is not installed; cannot verify the licence.")
    rec = _decode_activation(activation)
    sig = base64.urlsafe_b64decode(rec["sig"] + "=" * (-len(rec["sig"]) % 4))
    body = _canonical_body(rec)
    vk = VerifyKey(base64.urlsafe_b64decode(public_key_b64 + "=" * (-len(public_key_b64) % 4)))
    try:
        vk.verify(body, sig)
    except BadSignatureError:
        raise ValueError("licence signature is invalid")
    fp = fingerprint or machine_fingerprint()
    if rec.get("fp") != fp:
        raise ValueError("licence is for a different machine")
    exp = rec.get("expires")
    if exp is not None:
        import time
        if time.time() > float(exp):
            raise ValueError("licence has expired")
    return rec


def _canonical_body(rec: dict) -> bytes:
    """The exact bytes that are signed — every field except the signature, in a
    fixed key order so signer and verifier agree byte-for-byte."""
    ordered = {k: rec[k] for k in ("fp", "licensee", "issued", "expires", "seat") if k in rec}
    return json.dumps(ordered, sort_keys=True, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------- store (app)
def _store_path(app_dir: Path) -> Path:
    return Path(app_dir) / "license.json"


def load_stored(app_dir: Path, public_key_b64: str) -> dict | None:
    """Read and re-verify the stored activation on launch. Returns the record if
    valid for THIS machine, else None (app should then ask for activation)."""
    p = _store_path(app_dir)
    if not p.exists():
        return None
    try:
        return verify_activation(p.read_text(encoding="utf-8"), public_key_b64)
    except Exception:
        return None


def store_activation(app_dir: Path, activation: str, public_key_b64: str) -> dict:
    """Verify then persist. Raises ValueError if the activation is not valid for
    this machine, so the app never stores a bad one."""
    rec = verify_activation(activation, public_key_b64)  # raises on bad/mismatch
    p = _store_path(app_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(activation.strip(), encoding="utf-8")
    return rec


# ---------------------------------------------------------------- CLI (dev aid)
if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "fingerprint":
        print("fingerprint:", machine_fingerprint())
        print("request code:", request_code())
    else:
        print("usage: python licensing.py fingerprint")
