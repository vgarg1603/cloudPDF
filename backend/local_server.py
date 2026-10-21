"""Local stand-in for API Gateway, S3, and the SQS worker.

The same processor code runs here. Upload URLs point at this process instead of S3,
and a background thread plays the role of the queue consumer.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from src.common.validation import MAX_UPLOAD_BYTES, validate_request
from src.processors.dispatch import execute

logger = logging.getLogger(__name__)
JOB_ID = re.compile(r"^[0-9a-fA-F-]{36}$")
UPLOAD_PATH = re.compile(r"^/jobs/([0-9a-fA-F-]{36})/files/(\d+)$")
RESULT_PATH = re.compile(r"^/jobs/([0-9a-fA-F-]{36})/result$")
JOB_PATH = re.compile(r"^/jobs/([0-9a-fA-F-]{36})$")


class Store:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def create(self, job: dict[str, Any]) -> None:
        with self._lock:
            folder = self.root / job["jobId"] / "files"
            folder.mkdir(parents=True, exist_ok=True)
            self._write(job)

    def read(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            return self._read(job_id)

    def update(self, job_id: str, mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any] | None:
        with self._lock:
            job = self._read(job_id)
            if job is None:
                return None
            mutate(job)
            self._write(job)
            return job

    def _job_path(self, job_id: str) -> Path:
        return self.root / job_id / "job.json"

    def _read(self, job_id: str) -> dict[str, Any] | None:
        path = self._job_path(job_id)
        if not path.is_file():
            return None
        return json.loads(path.read_text())

    def _write(self, job: dict[str, Any]) -> None:
        path = self._job_path(job["jobId"])
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(job))
        temporary.replace(path)


def make_handler(store: Store) -> type[BaseHTTPRequestHandler]:
    class LocalHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt: str, *args: Any) -> None:
            logger.info("%s %s", self.command, self.path)

        def do_OPTIONS(self) -> None:
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_POST(self) -> None:
            path = _path(self.path)
            if path != "/jobs":
                self._json(404, {"error": "Not found"})
                return
            try:
                length = int(self.headers.get("Content-Length") or "0")
                if length > 100_000:
                    self._json(413, {"error": "Request is too large"})
                    return
                body = json.loads(self.rfile.read(length) or b"{}")
                operation, files, options = validate_request(body)
            except json.JSONDecodeError:
                self._json(400, {"error": "Request body must be JSON"})
                return
            except ValueError as exc:
                self._json(400, {"error": str(exc)})
                return

            job_id = str(uuid.uuid4())
            records = []
            uploads = []
            for index, item in enumerate(files):
                stored = f"{index:02d}-{item['name']}"
                records.append(
                    {
                        "name": item["name"],
                        "contentType": item["contentType"],
                        "stored": stored,
                    }
                )
                uploads.append(
                    {
                        "url": f"/jobs/{job_id}/files/{index}",
                        "method": "PUT",
                        "headers": {"Content-Type": item["contentType"]},
                    }
                )
            job = {
                "jobId": job_id,
                "operation": operation,
                "status": "UPLOADING",
                "files": records,
                "options": {key: value for key, value in options.items() if key != "password"},
                "receivedIndexes": [],
                "error": None,
                "resultName": None,
                "contentType": None,
            }
            if operation == "protect":
                job["password"] = options["password"]
            store.create(job)
            logger.info("Created local job %s operation %s", job_id, operation)
            self._json(201, {"jobId": job_id, "status": "UPLOADING", "uploads": uploads})

        def do_PUT(self) -> None:
            match = UPLOAD_PATH.match(_path(self.path))
            if not match:
                self._json(404, {"error": "Not found"})
                return
            job_id, index_text = match.group(1), int(match.group(2))
            try:
                length = int(self.headers.get("Content-Length") or "0")
            except ValueError:
                self._json(400, {"error": "Upload is empty"})
                return
            if length <= 0:
                self._json(400, {"error": "Upload is empty"})
                return
            if length > MAX_UPLOAD_BYTES:
                self._json(413, {"error": "A file exceeds the 20 MB limit"})
                return
            data = self.rfile.read(length)
            ready = False

            def mutate(job: dict[str, Any]) -> None:
                nonlocal ready
                if index_text >= len(job["files"]):
                    raise ValueError("Unknown file index")
                if job["status"] not in {"UPLOADING", "FAILED"}:
                    raise ValueError("This job is no longer accepting uploads")
                received = set(job.get("receivedIndexes") or [])
                target = store.root / job_id / "files" / job["files"][index_text]["stored"]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
                received.add(index_text)
                job["receivedIndexes"] = sorted(received)
                if len(received) == len(job["files"]):
                    job["status"] = "PROCESSING"
                    ready = True

            try:
                updated = store.update(job_id, mutate)
            except ValueError as exc:
                self._json(409, {"error": str(exc)})
                return
            if updated is None:
                self._json(404, {"error": "Job not found"})
                return
            if ready:
                threading.Thread(target=_process, args=(store, job_id), daemon=True).start()
            self._json(200, {"ok": True})

        def do_GET(self) -> None:
            path = _path(self.path)
            result_match = RESULT_PATH.match(path)
            if result_match:
                self._send_result(result_match.group(1))
                return
            job_match = JOB_PATH.match(path)
            if not job_match:
                self._json(404, {"error": "Not found"})
                return
            job = store.read(job_match.group(1))
            if job is None:
                self._json(404, {"error": "Job not found"})
                return
            download = None
            if job["status"] == "DONE":
                download = f"/jobs/{job['jobId']}/result"
            self._json(
                200,
                {
                    "jobId": job["jobId"],
                    "operation": job["operation"],
                    "status": job["status"],
                    "error": job.get("error"),
                    "fileName": job.get("resultName"),
                    "downloadUrl": download,
                },
            )

        def _send_result(self, job_id: str) -> None:
            job = store.read(job_id)
            result = store.root / job_id / "result"
            if job is None or job.get("status") != "DONE" or not result.is_file():
                self._json(409, {"error": "Result is not ready"})
                return
            payload = result.read_bytes()
            filename = job.get("resultName") or "result"
            self.send_response(200)
            self.send_header("content-type", job.get("contentType") or "application/octet-stream")
            self.send_header("content-length", str(len(payload)))
            self.send_header("content-disposition", f'attachment; filename="{filename}"')
            self._cors()
            self.end_headers()
            self.wfile.write(payload)

        def _json(self, status: int, payload: dict[str, Any]) -> None:
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)

        def _cors(self) -> None:
            self.send_header("access-control-allow-origin", "*")
            self.send_header("access-control-allow-methods", "GET, POST, PUT, OPTIONS")
            self.send_header("access-control-allow-headers", "content-type, accept")

    return LocalHandler


def _process(store: Store, job_id: str) -> None:
    job = store.read(job_id)
    if job is None:
        return
    try:
        blobs = []
        for item in job["files"]:
            blobs.append((store.root / job_id / "files" / item["stored"]).read_bytes())
        options = dict(job.get("options") or {})
        if job.get("password"):
            options["password"] = job["password"]
        data, media_type, filename = execute(job["operation"], blobs, options)
    except ValueError as exc:
        _mark_failed(store, job_id, str(exc), drop_password=True)
        logger.info("Local job %s rejected: %s", job_id, exc)
        return
    except Exception:
        logger.exception("Local job %s failed", job_id)
        _mark_failed(store, job_id, "Processing failed", drop_password=False)
        return

    (store.root / job_id / "result").write_bytes(data)

    def finish(record: dict[str, Any]) -> None:
        record["status"] = "DONE"
        record["resultName"] = filename
        record["contentType"] = media_type
        record["error"] = None
        record.pop("password", None)

    store.update(job_id, finish)
    logger.info("Finished local job %s bytes %s", job_id, len(data))


def _mark_failed(store: Store, job_id: str, message: str, drop_password: bool) -> None:
    def mutate(record: dict[str, Any]) -> None:
        record["status"] = "FAILED"
        record["error"] = message
        if drop_password:
            record.pop("password", None)

    store.update(job_id, mutate)


def _path(raw: str) -> str:
    path = urlparse(raw).path
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    return path


def serve(data_dir: Path, host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), make_handler(Store(data_dir)))
    return server


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    data_dir = Path(os.environ.get("LOCAL_DATA_DIR", Path(__file__).resolve().parent / ".data"))
    port = int(os.environ.get("PORT", "8000"))
    server = serve(data_dir, port=port)
    bound_host, bound_port = server.server_address[:2]
    logger.info("Local PDF API listening on http://%s:%s", bound_host, bound_port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
