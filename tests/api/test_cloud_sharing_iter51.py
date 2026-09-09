"""Cloud share API regression tests (share/list/download/idempotency/permissions)."""

import io
import json
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import requests


BASE_URL = os.environ.get("APP_URL")
APP_PASSWORD = os.environ.get("APP_PASSWORD")
ADMIN_LOGIN = os.environ["ADMIN_LOGIN"]


def _must_env(name: str, value: str | None) -> str:
    if not value:
        pytest.skip(f"{name} is not set")
    return value.rstrip("/")


@pytest.fixture(scope="module")
def base_url() -> str:
    return _must_env("APP_URL", BASE_URL)


@pytest.fixture(scope="module")
def admin_password() -> str:
    return _must_env("APP_PASSWORD", APP_PASSWORD)


@pytest.fixture(scope="module")
def admin(base_url: str, admin_password: str):
    s = requests.Session()
    r = s.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": ADMIN_LOGIN, "password": admin_password},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return s


def _make_user(admin: requests.Session, base_url: str, role: str, plan_name: str = 'Pro') -> tuple[str, str]:
    login = f"iter51-{role}-{uuid.uuid4().hex[:8]}"
    password = f"Iter51-{uuid.uuid4().hex[:10]}"

    plans = admin.get(f"{base_url}/admin/api/plans", timeout=20)
    assert plans.status_code == 200, plans.text
    basic = next((p for p in plans.json() if p.get("name") == plan_name), None)
    assert basic, f"{plan_name} plan not found"

    key_resp = admin.post(
        f"{base_url}/admin/api/licenses",
        json={"planId": basic["id"], "days": 7, "count": 1, "note": f"iter51-{role}"},
        timeout=20,
    )
    assert key_resp.status_code == 200, key_resp.text
    key = key_resp.json()["keys"][0]

    reg = requests.Session().post(
        f"{base_url}/ai-api/auth/register",
        json={
            "login": login,
            "password": password,
            "passwordConfirm": password,
            "key": key,
        },
        timeout=20,
    )
    assert reg.status_code == 200, reg.text
    # Disposable credentials remain in this fixture, never in tracked reports.
    return login, password


def _login(base_url: str, login: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(
        f"{base_url}/ai-api/auth/login",
        json={"login": login, "password": password},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def users(admin: requests.Session, base_url: str):
    member_login, member_password = _make_user(admin, base_url, "member")
    outsider_login, outsider_password = _make_user(admin, base_url, "outsider")

    member = _login(base_url, member_login, member_password)
    outsider = _login(base_url, outsider_login, outsider_password)

    # Join shared drive only for member user.
    cloud = admin.get(f"{base_url}/ai-api/cloud", timeout=20)
    assert cloud.status_code == 200, cloud.text
    invite = cloud.json().get("inviteCode")
    assert invite
    join = member.post(f"{base_url}/ai-api/cloud/join", json={"code": invite}, timeout=20)
    assert join.status_code == 200, join.text

    payload = {
        "member_login": member_login,
        "member_password": member_password,
        "outsider_login": outsider_login,
        "outsider_password": outsider_password,
        "member": member,
        "outsider": outsider,
    }
    yield payload

    # Cleanup created users.
    for login in (member_login, outsider_login):
        users_resp = admin.get(f"{base_url}/admin/api/users", timeout=20)
        if users_resp.status_code != 200:
            continue
        uid = next((u["id"] for u in users_resp.json() if u.get("login") == login), None)
        if uid:
            admin.delete(f"{base_url}/admin/api/users/{uid}", timeout=20)


@pytest.fixture(scope='module', autouse=True)
def cleanup_test_copies(admin, base_url):
    before = {f['id'] for f in admin.get(f'{base_url}/ai-api/cloud', timeout=20).json().get('files', [])}
    yield
    rows = admin.get(f'{base_url}/ai-api/cloud', timeout=20).json().get('files', [])
    for row in rows:
        if row['id'] not in before and (row.get('source', {}).get('id', '').startswith('iter51-') or row['name'].startswith('iter51-')):
            admin.delete(f"{base_url}/ai-api/cloud/file/{row['id']}", timeout=20)


@pytest.fixture(scope="module")
def shared_artifacts(admin: requests.Session, base_url: str):
    raw = b"WSX\x00\x01\x00\xff\x10END\x00BIN"
    source_id = f"iter51-file-{uuid.uuid4().hex[:8]}"
    files = {"file": ("iter51-null.bin", io.BytesIO(raw), "application/octet-stream")}
    first = admin.post(
        f"{base_url}/ai-api/cloud/share",
        data={"sourceId": source_id},
        files=files,
        timeout=30,
    )
    assert first.status_code == 201, first.text
    file_id = first.json()["file"]["id"]

    note_source = f"iter51-note-{uuid.uuid4().hex[:8]}"
    note_payload = {
        "kind": "note",
        "sourceId": note_source,
        "title": "ITER51 note",
        "body": "line-1\nline-2",
        "tags": ["iter51", "shared", "iter51"],
        "secret": "must-not-store",
        "locked": True,
        "expiresAt": int(time.time() * 1000) + 5000,
        "pinnedTo": "f-local-id",
    }
    note_resp = admin.post(f"{base_url}/ai-api/cloud/share", json=note_payload, timeout=30)
    assert note_resp.status_code == 201, note_resp.text
    note_id = note_resp.json()["file"]["id"]

    yield {
        "file_source": source_id,
        "file_cloud_id": file_id,
        "file_bytes": raw,
        "note_source": note_source,
        "note_cloud_id": note_id,
        "note_expected": {
            "title": note_payload["title"],
            "body": note_payload["body"],
            "tags": ["iter51", "shared"],
        },
    }


class TestCloudShareIter51:
    """Cloud share backend checks for binary integrity, idempotency and permissions."""

    def test_share_binary_and_download_preserves_all_bytes(self, admin, base_url, shared_artifacts):
        r = admin.get(f"{base_url}/ai-api/cloud/file/{shared_artifacts['file_cloud_id']}", timeout=30)
        assert r.status_code == 200
        assert r.content == shared_artifacts["file_bytes"]

    def test_share_idempotent_same_source_returns_same_cloud_id(self, admin, base_url, shared_artifacts):
        files = {
            "file": (
                "iter51-null.bin",
                io.BytesIO(shared_artifacts["file_bytes"]),
                "application/octet-stream",
            )
        }
        r = admin.post(
            f"{base_url}/ai-api/cloud/share",
            data={"sourceId": shared_artifacts["file_source"]},
            files=files,
            timeout=30,
        )
        assert r.status_code == 201, r.text
        assert r.json()["file"]["id"] == shared_artifacts["file_cloud_id"]

    def test_share_concurrent_same_source_single_cloud_id(self, admin_password, base_url, shared_artifacts):
        source_id = f"iter51-concurrent-{uuid.uuid4().hex[:8]}"
        payload = b"ABC\x00DEF\x00GHI"

        def _share_once() -> tuple[int, str]:
            s = requests.Session()
            login = s.post(
                f"{base_url}/ai-api/auth/login",
                json={"login": ADMIN_LOGIN, "password": admin_password},
                timeout=20,
            )
            assert login.status_code == 200
            files = {"file": ("iter51-concurrent.bin", io.BytesIO(payload), "application/octet-stream")}
            r = s.post(
                f"{base_url}/ai-api/cloud/share",
                data={"sourceId": source_id},
                files=files,
                timeout=30,
            )
            return r.status_code, r.json()["file"]["id"]

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: _share_once(), range(4)))

        statuses = [x[0] for x in results]
        ids = {x[1] for x in results}
        assert statuses == [201, 201, 201, 201]
        assert len(ids) == 1

    def test_share_note_snapshot_and_download_json(self, admin, base_url, shared_artifacts):
        listing = admin.get(f"{base_url}/ai-api/cloud", timeout=20)
        assert listing.status_code == 200
        data = listing.json()
        notes = [f for f in data["files"] if f.get("kind") == "note"]
        target = next((n for n in notes if n["id"] == shared_artifacts["note_cloud_id"]), None)
        assert target is not None
        assert target["note"]["body"] == shared_artifacts["note_expected"]["body"]
        assert target["note"]["tags"] == shared_artifacts["note_expected"]["tags"]
        assert "path" not in target

        download = admin.get(f"{base_url}/ai-api/cloud/file/{shared_artifacts['note_cloud_id']}", timeout=20)
        assert download.status_code == 200
        body = json.loads(download.content.decode("utf-8"))
        assert body == shared_artifacts["note_expected"]
        assert "secret" not in body and "locked" not in body and "expiresAt" not in body and "pinnedTo" not in body

    def test_soft_delete_then_republish_creates_new_copy(self, admin, base_url):
        source_id = f"iter51-repub-{uuid.uuid4().hex[:8]}"
        bytes1 = b"FIRST\x00VALUE"
        first = admin.post(
            f"{base_url}/ai-api/cloud/share",
            data={"sourceId": source_id},
            files={"file": ("iter51-repub.bin", io.BytesIO(bytes1), "application/octet-stream")},
            timeout=30,
        )
        assert first.status_code == 201, first.text
        cloud_id_1 = first.json()["file"]["id"]

        rm = admin.delete(f"{base_url}/ai-api/cloud/file/{cloud_id_1}", timeout=20)
        assert rm.status_code == 200, rm.text

        second = admin.post(
            f"{base_url}/ai-api/cloud/share",
            data={"sourceId": source_id},
            files={"file": ("iter51-repub.bin", io.BytesIO(bytes1), "application/octet-stream")},
            timeout=30,
        )
        assert second.status_code == 201, second.text
        cloud_id_2 = second.json()["file"]["id"]
        assert cloud_id_2 != cloud_id_1

    def test_upload_rename_delete_routes_still_work(self, admin, base_url):
        up = admin.post(
            f"{base_url}/ai-api/cloud/upload",
            files={"file": ("iter51-upload.txt", io.BytesIO(b"hello upload"), "text/plain")},
            data={"dir": ""},
            timeout=20,
        )
        assert up.status_code == 201, up.text
        cloud_id = up.json()["file"]["id"]

        ren = admin.patch(
            f"{base_url}/ai-api/cloud/file/{cloud_id}",
            json={"name": "iter51-renamed.txt"},
            timeout=20,
        )
        assert ren.status_code == 200, ren.text

        listing = admin.get(f"{base_url}/ai-api/cloud", timeout=20)
        assert listing.status_code == 200
        row = next((f for f in listing.json()["files"] if f["id"] == cloud_id), None)
        assert row and row["name"] == "iter51-renamed.txt"

        rm = admin.delete(f"{base_url}/ai-api/cloud/file/{cloud_id}", timeout=20)
        assert rm.status_code == 200, rm.text

    def test_drive_view_hides_path_and_hides_other_owner_source(self, admin, users, base_url, shared_artifacts):
        member = users["member"]
        r = member.get(f"{base_url}/ai-api/cloud", timeout=20)
        assert r.status_code == 200
        assert r.json().get("member") is True
        target = next((f for f in r.json().get("files", []) if f["id"] == shared_artifacts["file_cloud_id"]), None)
        assert target is not None
        assert "path" not in target
        assert "source" not in target

    def test_permissions_member_nonmember_and_unauth(self, admin, users, base_url, shared_artifacts):
        member = users["member"]
        outsider = users["outsider"]

        share_file_forbidden = member.post(
            f"{base_url}/ai-api/cloud/share",
            data={"sourceId": f"iter51-member-forbidden-{uuid.uuid4().hex[:6]}"},
            files={"file": ("f.bin", io.BytesIO(b"x"), "application/octet-stream")},
            timeout=20,
        )
        assert share_file_forbidden.status_code == 403

        share_note_forbidden = member.post(
            f"{base_url}/ai-api/cloud/share",
            json={"kind": "note", "sourceId": "n", "title": "t", "body": "b", "tags": []},
            timeout=20,
        )
        assert share_note_forbidden.status_code == 403

        upload_forbidden = member.post(
            f"{base_url}/ai-api/cloud/upload",
            data={"dir": ""},
            files={"file": ("m.txt", io.BytesIO(b"member"), "text/plain")},
            timeout=20,
        )
        assert upload_forbidden.status_code == 403

        delete_forbidden = member.delete(
            f"{base_url}/ai-api/cloud/file/{shared_artifacts['file_cloud_id']}", timeout=20
        )
        assert delete_forbidden.status_code == 403

        outsider_list = outsider.get(f"{base_url}/ai-api/cloud", timeout=20)
        assert outsider_list.status_code == 200
        assert outsider_list.json().get("member") is False
        assert outsider_list.json().get("files") == []

        outsider_download = outsider.get(
            f"{base_url}/ai-api/cloud/file/{shared_artifacts['file_cloud_id']}", timeout=20
        )
        assert outsider_download.status_code == 403

        unauth = requests.Session()
        unauth_list = unauth.get(f"{base_url}/ai-api/cloud", timeout=20)
        assert unauth_list.status_code == 401
        unauth_download = unauth.get(
            f"{base_url}/ai-api/cloud/file/{shared_artifacts['file_cloud_id']}", timeout=20
        )
        assert unauth_download.status_code == 401
