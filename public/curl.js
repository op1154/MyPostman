/**
 * Minimal shell-aware tokenizer + cURL command parser.
 * Supports: -X/--request, -H/--header, -d/--data/--data-raw/--data-binary/--data-urlencode,
 * -u/--user, --url, -G/--get, --compressed, -k/--insecure, -L/--location, -F/--form.
 */

export function tokenize(input) {
  const text = input
    .replace(/\\\r?\n/g, ' ')   // line continuations (POSIX)
    .replace(/\^\r?\n/g, ' ')   // line continuations (cmd.exe)
    .replace(/`\r?\n/g, ' ');   // line continuations (PowerShell)

  const tokens = [];
  let current = '';
  let started = false;
  let quote = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else if (ch === '\\' && quote === '"' && i + 1 < text.length) {
        current += text[++i];
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < text.length) {
      current += text[++i];
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    }
    current += ch;
    started = true;
  }

  if (quote) throw new Error('Unbalanced quote in cURL command');
  if (started) tokens.push(current);
  return tokens;
}

const DATA_FLAGS = new Set(['-d', '--data', '--data-raw', '--data-ascii', '--data-binary', '--data-urlencode']);

export function parseCurl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a cURL command first');

  const tokens = tokenize(raw);
  if (!tokens.length) throw new Error('Nothing to parse');
  if (!/^curl(\.exe)?$/i.test(tokens[0])) throw new Error('Command must start with "curl"');

  const result = {
    method: null,
    url: '',
    headers: [],
    dataParts: [],
    formParts: [],
    user: null,
    forceGet: false,
    followRedirects: false
  };

  for (let i = 1; i < tokens.length; i++) {
    let token = tokens[i];
    const next = () => {
      if (i + 1 >= tokens.length) throw new Error(`Missing value for ${token}`);
      return tokens[++i];
    };

    // Split "--header=value" form.
    let inlineValue = null;
    if (token.startsWith('--') && token.includes('=')) {
      const idx = token.indexOf('=');
      inlineValue = token.slice(idx + 1);
      token = token.slice(0, idx);
    }
    const value = () => (inlineValue !== null ? inlineValue : next());

    if (token === '-X' || token === '--request') {
      result.method = value().toUpperCase();
    } else if (token === '-H' || token === '--header') {
      const header = value();
      const idx = header.indexOf(':');
      if (idx > 0) {
        result.headers.push([header.slice(0, idx).trim(), header.slice(idx + 1).trim()]);
      }
    } else if (DATA_FLAGS.has(token)) {
      result.dataParts.push(value());
    } else if (token === '-F' || token === '--form') {
      result.formParts.push(value());
    } else if (token === '-u' || token === '--user') {
      result.user = value();
    } else if (token === '--url') {
      result.url = value();
    } else if (token === '-G' || token === '--get') {
      result.forceGet = true;
    } else if (token === '-L' || token === '--location') {
      result.followRedirects = true;
    } else if (token === '-A' || token === '--user-agent') {
      result.headers.push(['User-Agent', value()]);
    } else if (token === '-b' || token === '--cookie') {
      result.headers.push(['Cookie', value()]);
    } else if (token === '-e' || token === '--referer') {
      result.headers.push(['Referer', value()]);
    } else if (token === '-o' || token === '--output' || token === '--connect-timeout' || token === '--max-time') {
      value(); // consume and ignore
    } else if (token.startsWith('-')) {
      // Boolean flags such as --compressed, -k, -s, -v: nothing to consume.
      if (inlineValue !== null) continue;
    } else if (!result.url) {
      result.url = token;
    }
  }

  if (!result.url) throw new Error('No URL found in the cURL command');
  if (!/^https?:\/\//i.test(result.url)) result.url = 'https://' + result.url.replace(/^\/+/, '');

  const url = new URL(result.url);
  const body = result.dataParts.join('&');

  if (result.forceGet && body) {
    for (const pair of body.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) url.searchParams.append(decodeURIComponent(k), decodeURIComponent(v));
    }
  }

  const method = result.method || ((body || result.formParts.length) && !result.forceGet ? 'POST' : 'GET');

  const params = [];
  url.searchParams.forEach((v, k) => params.push({ enabled: true, key: k, value: v }));
  url.search = '';

  const headers = [];
  let auth = { type: 'none' };

  for (const [key, val] of result.headers) {
    if (key.toLowerCase() === 'authorization') {
      const [scheme, ...rest] = val.split(/\s+/);
      const token = rest.join(' ');
      if (/^basic$/i.test(scheme) && token) {
        try {
          const [user, ...pass] = atob(token).split(':');
          auth = { type: 'basic', username: user, password: pass.join(':') };
          continue;
        } catch { /* fall through to raw header */ }
      } else if (/^bearer$/i.test(scheme) && token) {
        auth = isJwt(token)
          ? { type: 'jwt', token, prefix: scheme, target: 'header', key: 'Authorization' }
          : { type: 'bearer', token };
        continue;
      }
    }
    headers.push({ enabled: true, key, value: val });
  }

  if (result.user) {
    const [user, ...pass] = result.user.split(':');
    auth = { type: 'basic', username: user, password: pass.join(':') };
  }

  let bodyType = 'none';
  let bodyText = '';
  const formFields = [];

  if (result.formParts.length) {
    bodyType = 'form';
    for (const part of result.formParts) {
      const idx = part.indexOf('=');
      if (idx > 0) formFields.push({ enabled: true, key: part.slice(0, idx), value: part.slice(idx + 1) });
    }
  } else if (body && !result.forceGet) {
    const contentType = (headers.find((h) => h.key.toLowerCase() === 'content-type')?.value || '').toLowerCase();
    if (contentType.includes('x-www-form-urlencoded') || (!contentType && /^[^{[]+=/.test(body))) {
      bodyType = 'form';
      for (const pair of body.split('&')) {
        const [k, v = ''] = pair.split('=');
        if (k) formFields.push({ enabled: true, key: decodeURIComponent(k), value: decodeURIComponent(v) });
      }
    } else {
      bodyType = isJsonLike(body) ? 'json' : 'text';
      bodyText = body;
    }
  }

  return {
    method,
    url: url.toString(),
    params,
    headers,
    auth,
    bodyType,
    bodyText,
    formFields,
    followRedirects: result.followRedirects
  };
}

export function isJwt(token) {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(String(token || '').trim());
}

function isJsonLike(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** Builds a copy-pasteable cURL command from the resolved request. */
export function toCurl({ method, url, headers, body }) {
  const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
  const lines = [`curl -X ${method} ${quote(url)}`];
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`  -H ${quote(`${key}: ${value}`)}`);
  }
  if (body) lines.push(`  --data-raw ${quote(body)}`);
  return lines.join(' \\\n');
}
