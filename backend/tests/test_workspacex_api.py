"""Backend API tests for WorkSpaceX iteration 57.

Focus: auth login, AI provider config, models listing, cloud storage root.
Uses external preview URL via APP_URL env or hardcoded fallback (matches .env.local APP_URL).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("APP_URL", "https://next-chat-build.preview.emergentagent.com").rstrip("/")
LOGIN = os.environ.get("ADMIN_LOGIN", "admin")
PASSWORD = os.environ.get("APP_PASSWORD", "<APP_PASSWORD>")


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{BASE_URL}/ai-api/auth/login", json={"login": LOGIN, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text[:200]}"
    data = r.json()
    assert data.get("ok") is True
    assert data["user"]["login"] == LOGIN
    return s


# --- Auth ---
class TestAuth:
    def test_login_invalid(self):
        r = requests.post(f"{BASE_URL}/ai-api/auth/login", json={"login": "admin", "password": "wrong"}, timeout=15)
        assert r.status_code == 401
        assert "code" in r.json()

    def test_provider_unauthenticated(self):
        r = requests.get(f"{BASE_URL}/ai-api/ai/provider", timeout=15)
        assert r.status_code in (401, 403)


# --- AI Provider ---
class TestAiProvider:
    def test_provider_get(self, session):
        r = session.get(f"{BASE_URL}/ai-api/ai/provider", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["kind"] == "openrouter"
        assert d["model"] == "z-ai/glm-5.3-flash"
        assert d["ready"] is True
        assert d["hasKey"] is True
        # Ensure API key not leaked
        assert "apiKey" not in d

    def test_engine_status(self, session):
        r = session.get(f"{BASE_URL}/ai-api/engine", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["provider"]["ok"] is True
        assert d["provider"]["kind"] == "openrouter"
        assert d["provider"]["model"] == "z-ai/glm-5.3-flash"

    def test_openrouter_models_list(self, session):
        """Real OpenRouter call to fetch models list."""
        r = session.get(f"{BASE_URL}/ai-api/ai/provider/models", timeout=60)
        assert r.status_code == 200
        d = r.json()
        models = d.get("models") or []
        assert isinstance(models, list) and len(models) > 20, f"Expected populated models list, got {len(models)}"
        # Each model must have id + name to be renderable in UI
        sample = models[0]
        assert "id" in sample and "name" in sample
        # Vision metadata must be present so the UI can filter
        assert "vision" in sample

    def test_persist_custom_then_restore_openrouter(self, session):
        """Save a Custom Endpoint config, then verify it persists via GET, then restore OpenRouter."""
        # Save custom
        custom = {
            "kind": "custom",
            "baseUrl": "https://example.test/v1",
            "apiKey": "test-token-xyz",
            "model": "custom-model-1",
        }
        r = session.put(f"{BASE_URL}/ai-api/ai/provider", json=custom, timeout=15)
        assert r.status_code in (200, 201), f"Save custom failed: {r.status_code} {r.text[:200]}"
        # Verify persistence
        r2 = session.get(f"{BASE_URL}/ai-api/ai/provider", timeout=15)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2["kind"] == "custom"
        assert d2["baseUrl"] == "https://example.test/v1"
        assert d2["model"] == "custom-model-1"

        # Restore OpenRouter
        restore = {
            "kind": "openrouter",
            "baseUrl": "https://openrouter.ai/api/v1",
            "apiKey": "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",
            "model": "z-ai/glm-5.3-flash",
            "visionModel": "z-ai/glm-5.3-flash",
        }
        r3 = session.put(f"{BASE_URL}/ai-api/ai/provider", json=restore, timeout=15)
        assert r3.status_code in (200, 201)
        r4 = session.get(f"{BASE_URL}/ai-api/ai/provider", timeout=15)
        d4 = r4.json()
        assert d4["kind"] == "openrouter"
        assert d4["model"] == "z-ai/glm-5.3-flash"
        assert d4["ready"] is True


# --- Cloud storage root & upload path ---
class TestCloudStorage:
    def test_storage_root_get(self, session):
        r = session.get(f"{BASE_URL}/ai-api/cloud/storage-root", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "root" in d  # may be null before user configures

    def test_models_endpoint_alias(self, session):
        r = session.get(f"{BASE_URL}/ai-api/models", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("ok") is True
        assert isinstance(d.get("models"), list)
