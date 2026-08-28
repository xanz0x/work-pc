import base64
import hmac
import hashlib
import struct

SECRET = "JBSWY3DPEHPK3PXP"
CODE = "150155"
TS_MS = 1787876316808


def totp(secret_b32: str, ts_ms: int, step: int = 30, digits: int = 6) -> str:
    key = base64.b32decode(secret_b32.upper() + "=" * ((8 - len(secret_b32) % 8) % 8))
    counter = int(ts_ms / 1000) // step
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    off = mac[-1] & 0x0F
    binary = struct.unpack(">I", mac[off:off + 4])[0] & 0x7FFFFFFF
    return str(binary % (10 ** digits)).zfill(digits)


def test_totp_matches_ui():
    expected = totp(SECRET, TS_MS)
    print(f"expected={expected} ui={CODE}")
    assert expected == CODE
