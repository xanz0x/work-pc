"""NF-11 · слепое хранилище синхронизации: регистрация, пароль пространства,
токен устройства, журнал шифртекстов, отзыв. Сервер ключа не знает — здесь
он и не нужен: клиент присылает произвольные байты, а мы проверяем только
контроль доступа и порядок.

Прогон: APP_URL=https://<preview> python3 -m pytest tests/api/test_sync.py -q
"""
import os
import secrets

import pytest
import requests

BASE = os.environ.get("APP_URL", os.environ.get("WF_BASE", "http://localhost:3000")).rstrip("/")
PASSWORD = os.environ.get("APP_PASSWORD", "IceKrymTeam13@")


@pytest.fixture(scope="module")
def s():
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"password": PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return s


SPACE = secrets.token_hex(16)
PASS = secrets.token_hex(32)
DEV_A = secrets.token_hex(8)
DEV_B = secrets.token_hex(8)
LABEL = {"ct": "AAAA", "iv": "BBBB"}


def hdr(dev, tok):
    return {"X-Sync-Space": SPACE, "X-Sync-Device": dev, "X-Sync-Token": tok}


def test_requires_session():
    assert requests.post(f"{BASE}/sync/devices", json={}, timeout=15).status_code == 401
    assert requests.get(f"{BASE}/sync/ops", timeout=15).status_code == 401


def test_register_and_wrong_pass(s):
    r = s.post(f"{BASE}/sync/devices", json={"spaceId": SPACE, "spacePass": PASS, "deviceId": DEV_A, "label": LABEL}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True and len(body["token"]) == 48
    pytest.tokA = body["token"]

    wrong = s.post(f"{BASE}/sync/devices", json={"spaceId": SPACE, "spacePass": secrets.token_hex(32), "deviceId": DEV_B, "label": LABEL}, timeout=15)
    assert wrong.status_code == 403 and wrong.json()["code"] == "WRONG_PASS"

    ok = s.post(f"{BASE}/sync/devices", json={"spaceId": SPACE, "spacePass": PASS, "deviceId": DEV_B, "label": LABEL}, timeout=15)
    assert ok.status_code == 200 and ok.json()["created"] is False
    pytest.tokB = ok.json()["token"]

    bad = s.post(f"{BASE}/sync/devices", json={"spaceId": "xyz", "spacePass": PASS, "deviceId": DEV_A, "label": LABEL}, timeout=15)
    assert bad.status_code == 400


def test_device_auth(s):
    assert s.get(f"{BASE}/sync/ops", headers=hdr(DEV_A, "nope"), timeout=15).status_code == 403
    r = s.get(f"{BASE}/sync/devices", headers=hdr(DEV_A, pytest.tokA), timeout=15)
    assert r.status_code == 200
    assert {d["id"] for d in r.json()["devices"]} == {DEV_A, DEV_B}
    assert r.json()["self"] == DEV_A
    assert all("tokenHash" not in d for d in r.json()["devices"])


def test_push_pull_order_and_self_filter(s):
    ops = [{"ct": "c1", "iv": "i1"}, {"ct": "c2", "iv": "i2"}]
    r = s.post(f"{BASE}/sync/ops", json={"ops": ops}, headers=hdr(DEV_A, pytest.tokA), timeout=15)
    assert r.status_code == 200 and r.json()["seq"] == 2

    own = s.get(f"{BASE}/sync/ops?since=0", headers=hdr(DEV_A, pytest.tokA), timeout=15).json()
    assert own["ops"] == [] and own["seq"] == 2

    other = s.get(f"{BASE}/sync/ops?since=0", headers=hdr(DEV_B, pytest.tokB), timeout=15).json()
    assert [o["ct"] for o in other["ops"]] == ["c1", "c2"]
    assert all(o["dev"] == DEV_A for o in other["ops"])
    assert other["ops"][0]["seq"] == 1

    after = s.get(f"{BASE}/sync/ops?since=2", headers=hdr(DEV_B, pytest.tokB), timeout=15).json()
    assert after["ops"] == []

    bad = s.post(f"{BASE}/sync/ops", json={"ops": []}, headers=hdr(DEV_A, pytest.tokA), timeout=15)
    assert bad.status_code == 400
    bad = s.post(f"{BASE}/sync/ops", json={"ops": [{"ct": 1}]}, headers=hdr(DEV_A, pytest.tokA), timeout=15)
    assert bad.status_code == 400


def test_revoke(s):
    r = s.delete(f"{BASE}/sync/devices?id={DEV_B}", headers=hdr(DEV_A, pytest.tokA), timeout=15)
    assert r.status_code == 200
    assert s.get(f"{BASE}/sync/ops", headers=hdr(DEV_B, pytest.tokB), timeout=15).status_code == 403
    again = s.post(f"{BASE}/sync/devices", json={"spaceId": SPACE, "spacePass": PASS, "deviceId": DEV_B, "label": LABEL}, timeout=15)
    assert again.status_code == 403 and again.json()["code"] == "REVOKED"
    devs = s.get(f"{BASE}/sync/devices", headers=hdr(DEV_A, pytest.tokA), timeout=15).json()["devices"]
    assert next(d for d in devs if d["id"] == DEV_B)["revokedAt"] is not None
