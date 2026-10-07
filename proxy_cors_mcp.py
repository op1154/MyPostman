"""CORS Proxy para acessar MCP servers externos como LangChain MCP."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import urllib.error
import json
from urllib.parse import urlparse

class CustomRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Handler customizado que segue redirects mesmo para POST."""
    
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        """Permite redirect para POST preservando o método."""
        m = req.get_method()
        if code in (301, 302, 303, 307, 308) and m in ("GET", "HEAD", "POST"):
            # Para 307 e 308, preserva o método original
            # Para outros, usa GET exceto para POST que vira GET
            if code in (307, 308):
                # Preserva POST
                return urllib.request.Request(
                    newurl,
                    data=req.data,
                    headers=req.headers,
                    origin_req_host=req.origin_req_host,
                    unverifiable=req.unverifiable
                )
            else:
                # Redirect padrão (POST vira GET)
                return urllib.request.Request(
                    newurl,
                    headers=req.headers,
                    origin_req_host=req.origin_req_host,
                    unverifiable=req.unverifiable
                )
        return None

class CORSProxyHandler(BaseHTTPRequestHandler):
    """Handler que adiciona CORS headers e redireciona requisições."""

    def log_message(self, fmt, *args):
        # Log mais conciso
        print(f"[PROXY] {self.command} {self.path} -> {args[0] if args else 'OK'}")

    def do_OPTIONS(self):
        """Responde a requisições OPTIONS com headers CORS."""
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()

    def do_POST(self):
        """Redireciona POST requests para o servidor MCP final."""
        # Extrai o URL alvo do path
        # Exemplo: /https://docs.langchain.com/mcp/ -> https://docs.langchain.com/mcp/
        target_url = self.path.lstrip('/')
        
        if not target_url:
            self._send_error(400, "URL destino não fornecida")
            return

        # Lê o corpo da requisição
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            # Cria um opener com o custom redirect handler
            opener = urllib.request.build_opener(CustomRedirectHandler())
            
            # Cria requisição para o servidor alvo
            req = urllib.request.Request(
                target_url,
                data=body,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json, text/event-stream",
                    "User-Agent": "CORS-Proxy/1.0"
                },
                method="POST"
            )

            # Envia requisição e recebe resposta (com seguimento de redirects POST)
            response = opener.open(req, timeout=30)
            response_data = response.read()
            response_status = response.status

            # Retorna resposta com headers CORS
            self.send_response(response_status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_data)))
            self.end_headers()
            self.wfile.write(response_data)
            response.close()

        except urllib.error.HTTPError as e:
            # Para erros HTTP, tenta ler a resposta
            try:
                error_body = e.read()
                self._send_error(e.code, f"HTTP {e.code}: {error_body.decode('utf-8', errors='ignore')}")
            except:
                self._send_error(e.code, f"HTTP Error {e.code}: {e.reason}")
        except urllib.error.URLError as e:
            self._send_error(502, f"Erro ao conectar: {str(e)}")
        except Exception as e:
            self._send_error(500, f"Erro interno: {str(e)}")

    def do_GET(self):
        """Redireciona GET requests também."""
        target_url = self.path.lstrip('/')
        
        if not target_url:
            self._send_json(200, {
                "status": "CORS Proxy running",
                "usage": "POST /https://example.com/mcp/",
                "example": "http://127.0.0.1:8888/https://docs.langchain.com/mcp/"
            })
            return

        try:
            req = urllib.request.Request(
                target_url,
                headers={
                    "Accept": "application/json, text/event-stream",
                    "User-Agent": "CORS-Proxy/1.0"
                }
            )

            with urllib.request.urlopen(req, timeout=30) as response:
                response_data = response.read()

            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(response_data)

        except Exception as e:
            self._send_error(500, f"Erro: {str(e)}")

    def _send_json(self, status, data):
        """Helper para enviar resposta JSON com CORS."""
        response_data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_data)))
        self.end_headers()
        self.wfile.write(response_data)

    def _send_error(self, status, message):
        """Helper para enviar erro JSON."""
        self._send_json(status, {"error": message})


if __name__ == "__main__":
    HOST = "127.0.0.1"
    PORT = 8888

    server = ThreadingHTTPServer((HOST, PORT), CORSProxyHandler)
    print(f"\n✅ CORS Proxy rodando em http://{HOST}:{PORT}")
    print(f"\n📝 Como usar no MCP Inspector:")
    print(f"   Server URL: http://127.0.0.1:8888/https://docs.langchain.com/mcp/")
    print(f"\n⚠️  Pressione Ctrl+C para parar\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Parando CORS Proxy...")
    finally:
        server.server_close()
        print("✅ Proxy encerrado")
