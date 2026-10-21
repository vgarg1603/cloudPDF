"""End-to-end check of the local API, including a two-file merge."""

from __future__ import annotations

import io
import json
import threading
import urllib.error
import urllib.request
from pathlib import Path

from pypdf import PdfReader

from local_server import serve
from tests.pdf_factory import blank_pdf


def _request(method: str, url: str, data: bytes | None = None, headers: dict[str, str] | None = None):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def _start(tmp_path: Path) -> str:
    server = serve(tmp_path, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    port = server.server_address[1]
    return f"http://127.0.0.1:{port}"


def test_merge_two_pdfs_through_the_local_api(tmp_path: Path):
    base = _start(tmp_path)
    status, raw = _request(
        "POST",
        f"{base}/jobs",
        json.dumps(
            {
                "operation": "merge",
                "files": [
                    {"name": "first.pdf", "contentType": "application/pdf"},
                    {"name": "second.pdf", "contentType": "application/pdf"},
                ],
            }
        ).encode(),
        {"Content-Type": "application/json"},
    )
    assert status == 201
    created = json.loads(raw)
    first, second = blank_pdf([200, 210]), blank_pdf([300])
    for upload, payload in zip(created["uploads"], (first, second)):
        code, _ = _request(
            "PUT",
            base + upload["url"],
            payload,
            upload["headers"],
        )
        assert code == 200

    download = None
    for _ in range(50):
        code, body = _request("GET", f"{base}/jobs/{created['jobId']}")
        assert code == 200
        job = json.loads(body)
        if job["status"] == "DONE":
            download = job["downloadUrl"]
            break
        if job["status"] == "FAILED":
            raise AssertionError(job["error"])
        threading.Event().wait(0.05)
    assert download

    code, merged = _request("GET", base + download)
    assert code == 200
    reader = PdfReader(io.BytesIO(merged))
    assert [float(page.mediabox.width) for page in reader.pages] == [200, 210, 300]


def test_protect_does_not_keep_the_password_after_success(tmp_path: Path):
    base = _start(tmp_path)
    status, raw = _request(
        "POST",
        f"{base}/jobs",
        json.dumps(
            {
                "operation": "protect",
                "files": [{"name": "secret.pdf", "contentType": "application/pdf"}],
                "options": {"password": "classroom"},
            }
        ).encode(),
        {"Content-Type": "application/json"},
    )
    assert status == 201
    assert b"classroom" not in raw
    created = json.loads(raw)
    code, _ = _request(
        "PUT",
        base + created["uploads"][0]["url"],
        blank_pdf([180]),
        created["uploads"][0]["headers"],
    )
    assert code == 200
    for _ in range(50):
        _, body = _request("GET", f"{base}/jobs/{created['jobId']}")
        job = json.loads(body)
        if job["status"] in {"DONE", "FAILED"}:
            break
        threading.Event().wait(0.05)
    assert job["status"] == "DONE"
    stored = json.loads((tmp_path / created["jobId"] / "job.json").read_text())
    assert "password" not in stored
    assert stored["options"] == {}


def test_unknown_operation_is_rejected(tmp_path: Path):
    base = _start(tmp_path)
    status, raw = _request(
        "POST",
        f"{base}/jobs",
        json.dumps({"operation": "shred", "files": []}).encode(),
        {"Content-Type": "application/json"},
    )
    assert status == 400
    assert "Unknown" in json.loads(raw)["error"]
