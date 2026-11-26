#!/usr/bin/env python3
"""
Local OGG Review Server with HTTP Range support (for smooth audio seeking).
Serves:
  /           -> tools/ogg_review/index.html
  /catalog.json -> tools/ogg_review/catalog.json
  /raw/<path> -> tools/_neon_bgm_raw/<path>
"""
import os
import re
import json
import mimetypes
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import unquote

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "_neon_bgm_raw"))
REVIEWS_FILE = os.path.join(BASE_DIR, "reviews.json")
PORT = 8765

mimetypes.add_type("audio/ogg", ".ogg")


class RangeRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Keep console clean

    def do_GET(self):
        path = unquote(self.path.split("?")[0])
        if path == "/" or path == "/index.html":
            self._serve_file(os.path.join(BASE_DIR, "index.html"), "text/html; charset=utf-8")
        elif path == "/catalog.json":
            self._serve_file(os.path.join(BASE_DIR, "catalog.json"), "application/json; charset=utf-8")
        elif path == "/api/reviews":
            data = {"slots": {}, "tracks": {}}
            if os.path.isfile(REVIEWS_FILE):
                try:
                    with open(REVIEWS_FILE, "r", encoding="utf-8") as f:
                        loaded = json.load(f)
                        if isinstance(loaded, dict):
                            data = loaded
                except Exception:
                    pass
            body = json.dumps(data, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        elif path.startswith("/raw/"):
            rel = path[5:].lstrip("/").replace("/", os.sep)
            target = os.path.abspath(os.path.join(RAW_DIR, rel))
            if not target.startswith(RAW_DIR) or not os.path.isfile(target):
                self.send_error(404, "Track not found")
                return
            self._serve_file(target, "audio/ogg")
        else:
            self.send_error(404, "Not found")

    def do_POST(self):
        path = unquote(self.path.split("?")[0])
        if path == "/api/reviews":
            length = int(self.headers.get("Content-Length", "0") or "0")
            raw = self.rfile.read(length) if length > 0 else b"{}"
            try:
                parsed = json.loads(raw.decode("utf-8"))
                with open(REVIEWS_FILE, "w", encoding="utf-8") as f:
                    json.dump(parsed, f, ensure_ascii=False, indent=2)
                resp = b'{"ok":true}'
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            except Exception as e:
                self.send_error(400, str(e))
        else:
            self.send_error(404, "Not found")

    def _serve_file(self, filepath: str, content_type: str):
        if not os.path.isfile(filepath):
            self.send_error(404, "File not found")
            return
        file_size = os.path.getsize(filepath)
        range_header = self.headers.get("Range")

        if range_header:
            m = re.match(r"bytes=(\d+)-(\d*)", range_header)
            if m:
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else file_size - 1
                end = min(end, file_size - 1)
                if start > end or start >= file_size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{file_size}")
                    self.end_headers()
                    return
                length = end - start + 1
                self.send_response(206)
                self.send_header("Content-Type", content_type)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self.send_header("Content-Length", str(length))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                with open(filepath, "rb") as f:
                    f.seek(start)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
                return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(file_size))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        with open(filepath, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)


if __name__ == "__main__":
    ThreadingHTTPServer.allow_reuse_address = True
    ThreadingHTTPServer.daemon_threads = True
    server = ThreadingHTTPServer(("127.0.0.1", PORT), RangeRequestHandler)
    print(f"OGG Review Server running at http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
