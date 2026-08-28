"""Backend tests for WorkfloW AI feature (Next.js /ai-api/*).

Feature scope:
- Skills CRUD (built-in + custom)
- MCP config + skeleton actions (test/pull)
- System prompt read/write
- Chat SSE with tool-call loop and session file persistence
"""
import json
import os
import re
import time
import pytest
import requests

BASE_URL = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
AI_DIR = os.environ.get("AI_DIR", "/app/ai")


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- Skills ----------
class TestSkills:
    def test_list_skills_builtins(self, api):
        r = api.get(f"{BASE_URL}/ai-api/skills")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        ids = {s["id"] for s in data}
        assert {"find-file", "save-password", "notion-pull"} <= ids
        for s in data:
            if s["id"] in {"find-file", "save-password", "notion-pull"}:
                assert s["builtin"] is True

    def test_toggle_find_file_persists_file(self, api):
        r = api.put(f"{BASE_URL}/ai-api/skills/find-file", json={"enabled": False})
        assert r.status_code == 200
        assert r.json()["enabled"] is False
        with open(f"{AI_DIR}/skills/find-file.json") as f:
            disk = json.load(f)
        assert disk["enabled"] is False
        # restore
        r2 = api.put(f"{BASE_URL}/ai-api/skills/find-file", json={"enabled": True})
        assert r2.status_code == 200
        with open(f"{AI_DIR}/skills/find-file.json") as f:
            disk2 = json.load(f)
        assert disk2["enabled"] is True

    def test_create_and_delete_custom_skill(self, api):
        r = api.post(
            f"{BASE_URL}/ai-api/skills",
            json={"name": "TEST_custom", "instructions": "TEST_only"},
        )
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        assert sid.startswith("custom-")
        # Verify persistence
        r2 = api.get(f"{BASE_URL}/ai-api/skills")
        assert any(s["id"] == sid for s in r2.json())
        # Delete
        r3 = api.delete(f"{BASE_URL}/ai-api/skills/{sid}")
        assert r3.status_code == 200
        # Verify removed
        r4 = api.get(f"{BASE_URL}/ai-api/skills")
        assert not any(s["id"] == sid for s in r4.json())

    def test_delete_builtin_returns_400(self, api):
        r = api.delete(f"{BASE_URL}/ai-api/skills/find-file")
        assert r.status_code == 400
        assert "error" in r.json()

    def test_create_skill_validation(self, api):
        r = api.post(f"{BASE_URL}/ai-api/skills", json={"name": "", "instructions": ""})
        assert r.status_code == 400


# ---------- MCP ----------
class TestMcp:
    def test_list_and_update_notion(self, api):
        r = api.get(f"{BASE_URL}/ai-api/mcp")
        assert r.status_code == 200
        assert any(m["id"] == "notion" for m in r.json())

        r2 = api.put(f"{BASE_URL}/ai-api/mcp/notion", json={"host": "192.168.1.10"})
        assert r2.status_code == 200
        assert r2.json()["host"] == "192.168.1.10"
        with open(f"{AI_DIR}/mcp/notion.json") as f:
            disk = json.load(f)
        assert disk["host"] == "192.168.1.10"

    def test_action_test(self, api):
        # ensure host set
        api.put(f"{BASE_URL}/ai-api/mcp/notion", json={"host": "192.168.1.10", "enabled": True})
        r = api.post(f"{BASE_URL}/ai-api/mcp/notion", json={"action": "test"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d.get("mode") == "skeleton"

    def test_action_pull_mock(self, api):
        api.put(f"{BASE_URL}/ai-api/mcp/notion", json={"enabled": True})
        r = api.post(f"{BASE_URL}/ai-api/mcp/notion", json={"action": "pull", "query": "X"})
        assert r.status_code == 200
        d = r.json()
        assert d["ok"] is True
        assert d.get("mock") is True
        assert "doc" in d and "title" in d["doc"]

    def test_unknown_action(self, api):
        r = api.post(f"{BASE_URL}/ai-api/mcp/notion", json={"action": "foo"})
        assert r.status_code == 400


# ---------- System prompt ----------
class TestSystem:
    def test_get_system(self, api):
        r = api.get(f"{BASE_URL}/ai-api/system")
        assert r.status_code == 200
        assert isinstance(r.json().get("text"), str)

    def test_put_system_roundtrip(self, api):
        # save original
        orig = api.get(f"{BASE_URL}/ai-api/system").json()["text"]
        new_text = orig + "\n\nTEST_MARKER_42"
        r = api.put(f"{BASE_URL}/ai-api/system", json={"text": new_text})
        assert r.status_code == 200
        with open(f"{AI_DIR}/system.md") as f:
            disk = f.read()
        assert "TEST_MARKER_42" in disk
        # restore
        r2 = api.put(f"{BASE_URL}/ai-api/system", json={"text": orig})
        assert r2.status_code == 200

    def test_put_system_empty_rejected(self, api):
        r = api.put(f"{BASE_URL}/ai-api/system", json={"text": "   "})
        assert r.status_code == 400


# ---------- Chat SSE ----------
def _parse_sse(text):
    events = []
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("data:"):
            try:
                events.append(json.loads(line[5:].strip()))
            except Exception:
                pass
    return events


class TestChat:
    def test_chat_text_streams_and_persists_session(self, api):
        sid = f"test-sess-{int(time.time())}"
        r = requests.post(
            f"{BASE_URL}/ai-api/chat",
            json={
                "sessionId": sid,
                "title": "TEST",
                "text": "Ответь одним словом: привет",
            },
            stream=True,
            timeout=90,
        )
        assert r.status_code == 200
        body = r.text
        events = _parse_sse(body)
        types = [e.get("t") for e in events]
        assert "end" in types, f"no end event; events={types[:20]}"
        # Should have text deltas OR at least an end without error
        errs = [e for e in events if e.get("t") == "err"]
        assert not errs, f"stream errors: {errs}"
        # session file exists
        p = f"{AI_DIR}/sessions/{sid}.json"
        assert os.path.exists(p)
        with open(p) as f:
            s = json.load(f)
        assert s["id"] == sid
        assert len(s["llm"]) >= 2  # user + assistant
        # cleanup
        api.delete(f"{BASE_URL}/ai-api/sessions/{sid}")
        assert not os.path.exists(p)

    def test_chat_tool_call_find_file(self, api):
        sid = f"test-tool-{int(time.time())}"
        ctx = {
            "files": [
                {"id": "f1", "name": "Смета_офис_2025.xlsx", "cat": "финансы", "tags": ["смета", "офис"]},
                {"id": "f2", "name": "Договор аренды.pdf", "cat": "договоры", "tags": ["аренда"]},
            ],
            "scanned": 2,
            "lock": "открыт",
        }
        r = requests.post(
            f"{BASE_URL}/ai-api/chat",
            json={
                "sessionId": sid,
                "text": "Где смета на офис? Используй инструмент find_file для поиска.",
                "ctx": ctx,
            },
            timeout=120,
        )
        assert r.status_code == 200
        events = _parse_sse(r.text)
        tool_events = [e for e in events if e.get("t") == "tool"]
        # Model may or may not call the tool — but based on system prompt should
        if tool_events:
            calls = tool_events[0]["calls"]
            names = {c["name"] for c in calls}
            assert "find_file" in names, f"expected find_file, got {names}"
            # Now simulate second POST with toolResults
            tc = next(c for c in calls if c["name"] == "find_file")
            r2 = requests.post(
                f"{BASE_URL}/ai-api/chat",
                json={
                    "sessionId": sid,
                    "toolResults": [
                        {"id": tc["id"], "name": "find_file", "content": json.dumps({"found": [ctx["files"][0]]})}
                    ],
                    "ctx": ctx,
                },
                timeout=120,
            )
            assert r2.status_code == 200
            ev2 = _parse_sse(r2.text)
            assert any(e.get("t") == "end" for e in ev2)
            has_text = any(e.get("t") == "d" for e in ev2)
            assert has_text, "expected assistant text after tool results"
        else:
            pytest.skip("model didn't call tool this run (non-deterministic)")
        # cleanup
        api.delete(f"{BASE_URL}/ai-api/sessions/{sid}")


# ---------- Sessions CRUD ----------
class TestSessions:
    def test_create_get_patch_delete(self, api):
        sid = f"test-sess-crud-{int(time.time())}"
        r = api.post(f"{BASE_URL}/ai-api/sessions", json={"id": sid, "title": "TEST_crud"})
        assert r.status_code == 200
        assert r.json()["id"] == sid

        rg = api.get(f"{BASE_URL}/ai-api/sessions/{sid}")
        assert rg.status_code == 200
        assert rg.json()["title"] == "TEST_crud"

        rp = api.patch(f"{BASE_URL}/ai-api/sessions/{sid}", json={"title": "TEST_renamed"})
        assert rp.status_code == 200

        rg2 = api.get(f"{BASE_URL}/ai-api/sessions/{sid}")
        assert rg2.json()["title"] == "TEST_renamed"

        rl = api.get(f"{BASE_URL}/ai-api/sessions")
        assert rl.status_code == 200
        assert any(s["id"] == sid for s in rl.json())

        rd = api.delete(f"{BASE_URL}/ai-api/sessions/{sid}")
        assert rd.status_code == 200

        rg3 = api.get(f"{BASE_URL}/ai-api/sessions/{sid}")
        assert rg3.status_code == 404
