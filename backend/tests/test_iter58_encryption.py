"""Iter58: verify provider key is encrypted-at-rest, storage-root, legacy migration."""
import os, json, shutil, time, requests, pytest, subprocess

BASE = os.environ.get("ITER58_BASE_URL", "http://localhost:3000").rstrip("/")
LOGIN = os.environ.get("ITER58_LOGIN", "admin")
PW = os.environ.get("ITER58_PASSWORD")
PROVIDER_FILE = "/app/.data/ai/provider.json"

@pytest.fixture(scope="module")
def sess():
    if not PW:
        pytest.skip("ITER58_PASSWORD is not configured")
    s = requests.Session()
    r = s.post(f"{BASE}/ai-api/auth/login", json={"login": LOGIN, "password": PW}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return s


def test_provider_on_disk_encrypted():
    """provider.json must contain apiKeyEnc, not plaintext apiKey."""
    data = json.loads(open(PROVIDER_FILE).read())
    assert "apiKeyEnc" in data and data["apiKeyEnc"], "apiKeyEnc missing"
    assert "apiKey" not in data, f"plaintext apiKey present! keys={list(data.keys())}"
    parts = data["apiKeyEnc"].split(":")
    assert len(parts) == 3, "expected iv:tag:ct format"


def test_provider_get(sess):
    r = sess.get(f"{BASE}/ai-api/ai/provider", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert d.get("hasKey") is True
    assert d.get("ready") is True
    assert d.get("keyHint", "").startswith("…")
    assert "apiKey" not in d, "API leaks apiKey!"


def test_provider_models_live(sess):
    r = sess.get(f"{BASE}/ai-api/ai/provider/models", timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    models = d.get("models") or []
    assert isinstance(models, list) and len(models) > 10, f"unexpected models count {len(models)}"


def test_storage_root_get(sess):
    r = sess.get(f"{BASE}/ai-api/cloud/storage-root", timeout=15)
    assert r.status_code == 200
    d = r.json()
    assert "root" in d


def test_legacy_apiKey_migrated(sess):
    """Write a legacy plaintext apiKey; after readProvider (via GET) it must be re-sealed."""
    with open(PROVIDER_FILE) as f:
        orig = f.read()
    orig_data = json.loads(orig)
    # inject fake legacy apiKey alongside removing apiKeyEnc temporarily.
    # But we don't know the plaintext of the current key. So use a fake test key,
    # then restore original after.
    legacy = {
        "kind": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "sk-or-legacy-test-KEY-1234",
        "model": orig_data["model"],
        "visionModel": orig_data.get("visionModel", orig_data["model"]),
    }
    try:
        with open(PROVIDER_FILE, "w") as f:
            json.dump(legacy, f)
        # Trigger read via GET
        r = sess.get(f"{BASE}/ai-api/ai/provider", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d.get("hasKey") is True
        assert d.get("keyHint") == "…1234", f"keyHint {d.get('keyHint')}"
        # Wait for background migration to finish
        for _ in range(20):
            with open(PROVIDER_FILE) as f:
                cur = json.load(f)
            if "apiKeyEnc" in cur and "apiKey" not in cur:
                break
            time.sleep(0.25)
        with open(PROVIDER_FILE) as f:
            cur = json.load(f)
        assert "apiKey" not in cur, f"legacy apiKey not migrated: {list(cur.keys())}"
        assert "apiKeyEnc" in cur and cur["apiKeyEnc"], "apiKeyEnc missing after migration"
    finally:
        # restore original file
        with open(PROVIDER_FILE, "w") as f:
            f.write(orig)


def test_cloud_browse(sess):
    r = sess.get(f"{BASE}/ai-api/cloud/browse", timeout=15)
    # Endpoint may need query params; still expect 200 or 400 (not 500)
    assert r.status_code in (200, 400), f"{r.status_code}: {r.text[:200]}"
