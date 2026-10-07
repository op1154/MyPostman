# MyPostm

A lightweight Postman-style API client that runs locally: import a cURL command, tweak the request, choose an authentication scheme, and send it.

## Run

With Python 3.8+ (no dependencies):

```powershell
python server.py
```

Or with Node.js 18+:

```powershell
npm start
```

Either way, open http://127.0.0.1:5177 and press `Ctrl+C` in the terminal to stop.

## Features

- **cURL import** — paste any `curl` command (`-X`, `-H`, `-d/--data*`, `-F`, `-u`, `-G`, `--url`, line continuations for bash/cmd/PowerShell). Query params, headers, body and auth are split into the right editors automatically.
- **Methods** — GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.
- **Authentication**
  - *No Auth*
  - *Basic* — username/password, encoded to `Authorization: Basic <base64>`
  - *Bearer* — `Authorization: Bearer <token>`
  - *JWT* — choose the header prefix, the key name, and whether to send it as a header or a query param; the header/payload and `exp` are decoded for inspection
- **Body** — JSON (with beautifier and validation), raw text, or `x-www-form-urlencoded` key/value rows. `Content-Type` is set automatically unless you override it.
- **Response viewer** — status, elapsed time, size, pretty-printed JSON, raw text, inline images, and full response headers.
- **History** — recent requests in the sidebar, click to reload. Copy the current request back out as cURL.

## Why a proxy?

Browsers block cross-origin XHR unless the target server sends CORS headers, so the server forwards requests from `POST /api/proxy`. It binds to `127.0.0.1` only, accepts `http`/`https` targets only, caps request bodies at 10 MB, and times out after 60 s.

> The proxy will call whatever URL you give it, including hosts on your local network. Keep it bound to localhost and do not expose it publicly.

## Layout

| File | Purpose |
| --- | --- |
| `server.py` | Static file server + request proxy (Python) |
| `server.js` | Same server for Node.js |
| `public/index.html` | UI markup |
| `public/styles.css` | Styling |
| `public/app.js` | Request building, auth, sending, rendering, history |
| `public/curl.js` | Shell tokenizer, cURL parser, cURL exporter |
