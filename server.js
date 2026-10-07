import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 5177;
const MAX_BODY = 10 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8'
};

/** Reads a request body with a hard size cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

// Headers the fetch/undici layer must control itself.
const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'proxy-connection'
]);

async function handleProxy(req, res) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Use POST' });
    return;
  }

  let spec;
  try {
    spec = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON envelope' });
    return;
  }

  let target;
  try {
    target = new URL(spec.url);
  } catch {
    sendJson(res, 400, { error: 'Invalid target URL' });
    return;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    sendJson(res, 400, { error: 'Only http and https targets are allowed' });
    return;
  }

  const headers = {};
  for (const [name, value] of Object.entries(spec.headers || {})) {
    if (!STRIPPED_REQUEST_HEADERS.has(String(name).toLowerCase())) {
      headers[name] = String(value);
    }
  }

  const method = String(spec.method || 'GET').toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method) && spec.body != null && spec.body !== '';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(spec.timeoutMs) || 60000);
  const started = Date.now();

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? spec.body : undefined,
      redirect: spec.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal
    });

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const responseHeaders = {};
    upstream.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    sendJson(res, 200, {
      ok: true,
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
      bodyBase64: buffer.toString('base64'),
      size: buffer.length,
      timeMs: Date.now() - started,
      finalUrl: upstream.url || target.toString()
    });
  } catch (err) {
    sendJson(res, 200, {
      ok: false,
      error: err.name === 'AbortError' ? 'Request timed out' : String(err.message || err),
      timeMs: Date.now() - started
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function handleStatic(req, res) {
  const requested = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname);
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relative);

  // Block path traversal outside the public directory.
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${HOST}`).pathname;
  if (pathname === '/api/proxy') {
    handleProxy(req, res).catch(() => sendJson(res, 500, { error: 'Proxy failure' }));
    return;
  }
  handleStatic(req, res).catch(() => sendJson(res, 500, { error: 'Server failure' }));
});

server.listen(PORT, HOST, () => {
  console.log(`MyPostm running at http://${HOST}:${PORT}`);
});
