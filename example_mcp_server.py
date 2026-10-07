"""Minimal MCP example server for MyPostm's MCP Inspector.

This intentionally uses only the Python standard library so it can be run without
external dependencies. It exposes a simple HTTP JSON-RPC endpoint at /mcp that
accepts MCP-style requests from the browser inspector in the app.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = 3001
ENDPOINT = "/mcp"


class MCPHandler(BaseHTTPRequestHandler):
    server_version = "MCPExample/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Keep console output concise.
        print(f"{self.command} {self.path} -> {args[1] if len(args) > 1 else ''}")

    def do_GET(self):
        if urlparse(self.path).path == ENDPOINT:
            self._send_json(200, {
                "name": "MyPostm Example MCP Server",
                "status": "ready",
                "endpoint": ENDPOINT,
                "methods": [
                    "initialize",
                    "ping",
                    "tools/list",
                    "tools/call",
                    "resources/list",
                    "resources/read",
                    "prompts/list",
                    "prompts/get",
                    "completion/complete",
                ],
            })
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if urlparse(self.path).path != ENDPOINT:
            self._send_json(404, {"jsonrpc": "2.0", "error": {"code": -32601, "message": "Method not found"}, "id": None})
            return

        try:
            length = int(self.headers.get("Content-Length") or "0")
            body = self.rfile.read(length) if length else b"{}"
            payload = json.loads(body.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"jsonrpc": "2.0", "error": {"code": -32600, "message": "Invalid JSON"}, "id": None})
            return

        try:
            response = self._handle_request(payload)
            self._send_json(200, response)
        except Exception as exc:  # pragma: no cover - defensive guard
            self._send_json(500, {
                "jsonrpc": "2.0",
                "error": {"code": -32603, "message": str(exc)},
                "id": payload.get("id") if isinstance(payload, dict) else None,
            })

    def _handle_request(self, payload):
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object")

        method = payload.get("method")
        req_id = payload.get("id")

        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {"listChanged": True},
                        "resources": {"subscribe": False, "listChanged": False},
                        "prompts": {"listChanged": False},
                    },
                    "serverInfo": {
                        "name": "MyPostm Example MCP Server",
                        "version": "1.0.0",
                    },
                },
            }

        if method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": {"ok": True}}

        if method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "echo",
                            "description": "Echo a message back to the client.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "message": {"type": "string"},
                                },
                                "required": ["message"],
                            },
                        },
                        {
                            "name": "sum",
                            "description": "Add two numbers.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "a": {"type": "number"},
                                    "b": {"type": "number"},
                                },
                                "required": ["a", "b"],
                            },
                        },
                    ]
                },
            }

        if method == "tools/call":
            params = payload.get("params") or {}
            tool_name = params.get("name")
            arguments = params.get("arguments") or {}

            if tool_name == "echo":
                text = str(arguments.get("message", ""))
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": f"Echo: {text}"}],
                        "structuredContent": {"message": text},
                    },
                }

            if tool_name == "sum":
                a = float(arguments.get("a", 0))
                b = float(arguments.get("b", 0))
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [{"type": "text", "text": f"{a} + {b} = {a + b}"}],
                        "structuredContent": {"sum": a + b},
                    },
                }

            raise ValueError(f"Unknown tool: {tool_name}")

        if method == "resources/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "resources": [
                        {
                            "uri": "file:///demo/example.txt",
                            "name": "example.txt",
                            "mimeType": "text/plain",
                        }
                    ]
                },
            }

        if method == "resources/read":
            params = payload.get("params") or {}
            uri = params.get("uri")
            if uri == "file:///demo/example.txt":
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "contents": [{
                            "uri": uri,
                            "mimeType": "text/plain",
                            "text": "This is a sample resource served by the example MCP server.",
                        }],
                    },
                }
            raise ValueError(f"Unknown resource: {uri}")

        if method == "prompts/list":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "prompts": [
                        {
                            "name": "welcome",
                            "description": "Return a welcome message for the user.",
                        }
                    ]
                },
            }

        if method == "prompts/get":
            params = payload.get("params") or {}
            name = params.get("name")
            if name == "welcome":
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "description": "Welcome prompt",
                        "messages": [
                            {
                                "role": "user",
                                "content": {"type": "text", "text": "Welcome to MyPostm!"},
                            }
                        ],
                    },
                }
            raise ValueError(f"Unknown prompt: {name}")

        if method == "completion/complete":
            params = payload.get("params") or {}
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "values": [
                        f"completion for {params.get('ref', {}).get('name', 'unknown')}",
                    ],
                    "total": 1,
                },
            }

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }

    def _send_json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.end_headers()


if __name__ == "__main__":
    print(f"MCP example server running at http://{HOST}:{PORT}{ENDPOINT}")
    server = ThreadingHTTPServer((HOST, PORT), MCPHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping example MCP server...")
    finally:
        server.server_close()
