"""Static file server + request proxy for MyPostm. Python stdlib only.

Equivalent to server.js; use whichever runtime is available.
    python server.py
"""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "5177"))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
MAX_BODY = 10 * 1024 * 1024
DEFAULT_TIMEOUT = 60

# Headers the HTTP layer must control itself.
STRIPPED_REQUEST_HEADERS = {
    "host",
    "connection",
    "content-length",
    "transfer-encoding",
    "keep-alive",
    "upgrade",
    "proxy-connection",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "MyPostm/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter console
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    def _send_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        self._serve_static()

    def do_POST(self) -> None:
        if urlparse(self.path).path == "/api/proxy":
            self._proxy()
        else:
            self._send_json(404, {"error": "Not found"})

    def _serve_static(self) -> None:
        requested = unquote(urlparse(self.path).path)
        relative = "index.html" if requested == "/" else requested.lstrip("/")
        file_path = os.path.abspath(os.path.join(PUBLIC_DIR, relative))

        # Block path traversal outside the public directory.
        if file_path != PUBLIC_DIR and not file_path.startswith(PUBLIC_DIR + os.sep):
            self._send_json(403, {"error": "Forbidden"})
            return

        try:
            with open(file_path, "rb") as handle:
                data = handle.read()
        except OSError:
            self._send_json(404, {"error": "Not found"})
            return

        content_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
        if content_type.startswith(("text/", "application/javascript")) or file_path.endswith(".js"):
            content_type = ("text/javascript" if file_path.endswith(".js") else content_type) + "; charset=utf-8"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _proxy(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            self._send_json(413, {"error": "Request body too large"})
            return

        try:
            spec = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, OSError):
            self._send_json(400, {"error": "Invalid JSON envelope"})
            return

        target = urlparse(str(spec.get("url", "")))
        if target.scheme not in ("http", "https") or not target.netloc:
            self._send_json(400, {"error": "Only http and https targets are allowed"})
            return

        method = str(spec.get("method") or "GET").upper()
        body = spec.get("body")
        payload = body.encode("utf-8") if body and method not in ("GET", "HEAD") else None

        request = urllib.request.Request(spec["url"], data=payload, method=method)
        for name, value in (spec.get("headers") or {}).items():
            if str(name).lower() not in STRIPPED_REQUEST_HEADERS:
                request.add_header(str(name), str(value))

        timeout = float(spec.get("timeoutMs") or DEFAULT_TIMEOUT * 1000) / 1000
        started = time.monotonic()

        try:
            with urllib.request.urlopen(request, timeout=timeout) as upstream:
                self._send_upstream(upstream, started, upstream.status, upstream.reason)
        except urllib.error.HTTPError as err:  # 4xx/5xx are valid responses here
            self._send_upstream(err, started, err.code, err.reason)
        except Exception as err:  # noqa: BLE001 - surface any transport failure to the UI
            self._send_json(200, {
                "ok": False,
                "error": str(err),
                "timeMs": int((time.monotonic() - started) * 1000),
            })

    def _send_upstream(self, response, started: float, status: int, reason: str) -> None:
        content = response.read()
        self._send_json(200, {
            "ok": True,
            "status": status,
            "statusText": reason or "",
            "headers": {k.lower(): v for k, v in response.headers.items()},
            "bodyBase64": base64.b64encode(content).decode("ascii"),
            "size": len(content),
            "timeMs": int((time.monotonic() - started) * 1000),
            "finalUrl": response.geturl(),
        })


if __name__ == "__main__":
    print(f"MyPostm running at http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
