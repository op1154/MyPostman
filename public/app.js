import { parseCurl, toCurl, isJwt } from './curl.js';

const $ = (sel) => document.querySelector(sel);
const HISTORY_KEY = 'mypostm.history.v1';
const MAX_HISTORY = 40;

const el = {
  method: $('#method'),
  url: $('#url'),
  form: $('#requestBar'),
  send: $('#btnSend'),
  authType: $('#authType'),
  basicUser: $('#basicUser'),
  basicPass: $('#basicPass'),
  bearerToken: $('#bearerToken'),
  jwtToken: $('#jwtToken'),
  jwtPrefix: $('#jwtPrefix'),
  jwtTarget: $('#jwtTarget'),
  jwtKey: $('#jwtKey'),
  jwtPreview: $('#jwtPreview'),
  bodyType: $('#bodyType'),
  bodyText: $('#bodyText'),
  formTable: $('#formTable'),
  addForm: $('#btnAddForm'),
  paramsTable: $('#paramsTable'),
  headersTable: $('#headersTable'),
  respStatus: $('#respStatus'),
  respTime: $('#respTime'),
  respSize: $('#respSize'),
  respBody: $('#panel-resp-body'),
  respHeaders: $('#panel-resp-headers'),
  historyList: $('#historyList'),
  curlDialog: $('#curlDialog'),
  curlInput: $('#curlInput'),
  curlError: $('#curlError'),
  screenTabs: $('#screenTabs'),
  screenPanels: document.querySelectorAll('.screen-panel'),
  mcpUrl: $('#mcpUrl'),
  mcpMethod: $('#mcpMethod'),
  mcpRequest: $('#mcpRequest'),
  mcpHeaders: $('#mcpHeaders'),
  mcpResponse: $('#mcpResponse'),
  mcpStatus: $('#mcpStatus'),
  mcpToolName: $('#mcpToolName'),
  mcpToolArgs: $('#mcpToolArgs')
};

/* ---------------------------------------------------------- key/value rows */

function addRow(table, { enabled = true, key = '', value = '' } = {}) {
  const tbody = table.tBodies[0];
  const tr = document.createElement('tr');

  const checkCell = document.createElement('td');
  checkCell.className = 'check';
  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = enabled;
  checkCell.append(check);

  const keyCell = document.createElement('td');
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'key';
  keyInput.value = key;
  keyCell.append(keyInput);

  const valueCell = document.createElement('td');
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.placeholder = 'value';
  valueInput.value = value;
  valueCell.append(valueInput);

  const delCell = document.createElement('td');
  delCell.className = 'del';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'link';
  del.textContent = '\u00d7';
  del.addEventListener('click', () => {
    tr.remove();
    if (!tbody.rows.length) addRow(table);
  });
  delCell.append(del);

  tr.append(checkCell, keyCell, valueCell, delCell);
  tbody.append(tr);
  return tr;
}

function readRows(table) {
  return [...table.tBodies[0].rows]
    .map((tr) => ({
      enabled: tr.cells[0].querySelector('input').checked,
      key: tr.cells[1].querySelector('input').value.trim(),
      value: tr.cells[2].querySelector('input').value
    }))
    .filter((r) => r.key);
}

function setRows(table, rows) {
  table.tBodies[0].replaceChildren();
  (rows?.length ? rows : [{}]).forEach((r) => addRow(table, r));
}

document.querySelectorAll('[data-add-row]').forEach((btn) => {
  btn.addEventListener('click', () => addRow(document.getElementById(btn.dataset.addRow)));
});

/* ----------------------------------------------------------------- tabbing */

function wireTabs(navId) {
  const nav = document.getElementById(navId);
  nav.addEventListener('click', (event) => {
    const tab = event.target.closest('.tab');
    if (!tab) return;
    event.preventDefault();
    nav.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    const scope = nav.parentElement;
    nav.querySelectorAll('.tab').forEach((t) => {
      scope.querySelector('#' + t.dataset.panel)?.classList.toggle('active', t === tab);
    });
  });
}
wireTabs('requestTabs');
wireTabs('responseTabs');

el.screenTabs.addEventListener('click', (event) => {
  const tab = event.target.closest('.screen-tab');
  if (!tab) return;
  event.preventDefault();
  const targetPanel = tab.dataset.panel;
  el.screenTabs.querySelectorAll('.screen-tab').forEach((t) => t.classList.toggle('active', t === tab));
  el.screenPanels.forEach((panel) => panel.classList.toggle('active', panel.id === targetPanel));
  if (targetPanel === 'panel-mcp') {
    setMcpStatus('Idle');
  }
});

/* -------------------------------------------------------------------- auth */

function syncAuthPanels() {
  const type = el.authType.value;
  document.querySelectorAll('.auth-form').forEach((form) => {
    form.hidden = form.dataset.auth !== type;
  });
  renderJwtPreview();
}
el.authType.addEventListener('change', syncAuthPanels);

function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(segment.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function renderJwtPreview() {
  const token = el.jwtToken.value.trim();
  if (!token) {
    el.jwtPreview.textContent = 'Paste a JWT to decode its header and payload.';
    return;
  }
  if (!isJwt(token)) {
    el.jwtPreview.textContent = 'Not a well-formed JWT (expected three dot-separated segments).';
    return;
  }
  try {
    const [head, payload] = token.split('.');
    const claims = JSON.parse(base64UrlDecode(payload));
    let expiry = '';
    if (typeof claims.exp === 'number') {
      const date = new Date(claims.exp * 1000);
      expiry = `\n\nexp: ${date.toLocaleString()} ${date.getTime() < Date.now() ? '(EXPIRED)' : '(valid)'}`;
    }
    el.jwtPreview.textContent =
      'header: ' + JSON.stringify(JSON.parse(base64UrlDecode(head))) +
      '\npayload: ' + JSON.stringify(claims, null, 2) + expiry;
  } catch {
    el.jwtPreview.textContent = 'Could not decode the token segments.';
  }
}
el.jwtToken.addEventListener('input', renderJwtPreview);

/* ------------------------------------------------------------ body panel */

function syncBodyPanel() {
  const isForm = el.bodyType.value === 'form';
  el.bodyText.hidden = isForm || el.bodyType.value === 'none';
  el.formTable.hidden = !isForm;
  el.addForm.hidden = !isForm;
  el.bodyText.placeholder = el.bodyType.value === 'json' ? '{ "key": "value" }' : 'Raw request body';
}
el.bodyType.addEventListener('change', syncBodyPanel);

$('#btnFormatJson').addEventListener('click', () => {
  try {
    el.bodyText.value = JSON.stringify(JSON.parse(el.bodyText.value), null, 2);
  } catch (err) {
    alert('Invalid JSON: ' + err.message);
  }
});

/* -------------------------------------------------------- request builder */

function buildRequest() {
  const rawUrl = el.url.value.trim();
  if (!rawUrl) throw new Error('Enter a request URL');

  const url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl);
  for (const p of readRows(el.paramsTable)) {
    if (p.enabled) url.searchParams.append(p.key, p.value);
  }

  const headers = {};
  for (const h of readRows(el.headersTable)) {
    if (h.enabled) headers[h.key] = h.value;
  }

  switch (el.authType.value) {
    case 'basic': {
      const pair = `${el.basicUser.value}:${el.basicPass.value}`;
      const bytes = new TextEncoder().encode(pair);
      headers.Authorization = 'Basic ' + btoa(String.fromCharCode(...bytes));
      break;
    }
    case 'bearer': {
      const token = el.bearerToken.value.trim();
      if (token) headers.Authorization = 'Bearer ' + token;
      break;
    }
    case 'jwt': {
      const token = el.jwtToken.value.trim();
      const key = el.jwtKey.value.trim() || 'Authorization';
      if (token) {
        if (el.jwtTarget.value === 'query') {
          url.searchParams.set(key, token);
        } else {
          const prefix = el.jwtPrefix.value.trim();
          headers[key] = prefix ? `${prefix} ${token}` : token;
        }
      }
      break;
    }
  }

  const method = el.method.value;
  let body = null;

  if (!['GET', 'HEAD'].includes(method)) {
    if (el.bodyType.value === 'json') {
      body = el.bodyText.value.trim();
      if (body) {
        JSON.parse(body); // fail fast on malformed JSON
        if (!hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/json';
      }
    } else if (el.bodyType.value === 'text') {
      body = el.bodyText.value;
      if (body && !hasHeader(headers, 'content-type')) headers['Content-Type'] = 'text/plain';
    } else if (el.bodyType.value === 'form') {
      const params = new URLSearchParams();
      for (const f of readRows(el.formTable)) {
        if (f.enabled) params.append(f.key, f.value);
      }
      body = params.toString();
      if (body && !hasHeader(headers, 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  return { method, url: url.toString(), headers, body };
}

function hasHeader(headers, name) {
  return Object.keys(headers).some((k) => k.toLowerCase() === name);
}

/* ---------------------------------------------------------------- sending */

el.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let request;
  try {
    request = buildRequest();
  } catch (err) {
    showError(err.message);
    return;
  }

  el.send.disabled = true;
  el.send.textContent = 'Sending...';
  setStatus('...', null);
  el.respBody.textContent = '';
  el.respHeaders.textContent = '';

  try {
    const res = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, followRedirects: true })
    });
    const result = await res.json();
    if (!result.ok) {
      showError(result.error || 'Request failed');
      return;
    }
    renderResponse(result);
    pushHistory(request);
  } catch (err) {
    showError('Could not reach the local proxy: ' + err.message);
  } finally {
    el.send.disabled = false;
    el.send.textContent = 'Send';
  }
});

function setStatus(text, ok) {
  el.respStatus.textContent = text;
  el.respStatus.className = 'pill' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}

function showError(message) {
  setStatus('Error', false);
  el.respTime.textContent = '';
  el.respSize.textContent = '';
  el.respBody.textContent = message;
}

function renderResponse(result) {
  setStatus(`${result.status} ${result.statusText}`.trim(), result.status < 400);
  el.respTime.textContent = `${result.timeMs} ms`;
  el.respSize.textContent = formatBytes(result.size);

  el.respHeaders.textContent = Object.entries(result.headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const bytes = Uint8Array.from(atob(result.bodyBase64), (c) => c.charCodeAt(0));
  const contentType = (result.headers['content-type'] || '').toLowerCase();

  if (contentType.startsWith('image/')) {
    el.respBody.replaceChildren(Object.assign(new Image(), {
      src: `data:${contentType};base64,${result.bodyBase64}`,
      style: 'max-width:100%'
    }));
    return;
  }

  let text = new TextDecoder().decode(bytes);
  if (contentType.includes('json')) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch { /* leave raw */ }
  }
  el.respBody.textContent = text || '(empty body)';
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/* --------------------------------------------------------------- history */

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

/** Credentials are deliberately stripped before persisting. */
function pushHistory(request) {
  const safeHeaders = Object.fromEntries(
    Object.entries(request.headers).filter(([k]) => k.toLowerCase() !== 'authorization')
  );
  const entry = { method: request.method, url: request.url, headers: safeHeaders, body: request.body };
  const items = [entry, ...loadHistory().filter((i) => !(i.method === entry.method && i.url === entry.url))]
    .slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  renderHistory();
}

function renderHistory() {
  const items = loadHistory();
  el.historyList.replaceChildren();
  items.forEach((item, index) => {
    const li = document.createElement('li');
    const m = document.createElement('span');
    m.className = 'm';
    m.textContent = item.method;
    const u = document.createElement('span');
    u.className = 'u';
    u.textContent = item.url;
    li.append(m, u);
    li.title = item.url;
    li.addEventListener('click', () => restoreHistory(index));
    el.historyList.append(li);
  });
}

function restoreHistory(index) {
  const item = loadHistory()[index];
  if (!item) return;
  const url = new URL(item.url);
  const params = [];
  url.searchParams.forEach((v, k) => params.push({ enabled: true, key: k, value: v }));
  url.search = '';

  applyRequest({
    method: item.method,
    url: url.toString(),
    params,
    headers: Object.entries(item.headers || {}).map(([key, value]) => ({ enabled: true, key, value })),
    auth: { type: el.authType.value },
    bodyType: item.body ? (isJsonText(item.body) ? 'json' : 'text') : 'none',
    bodyText: item.body || '',
    formFields: []
  });
}

function isJsonText(text) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

$('#btnClearHistory').addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
});

/* ------------------------------------------------------------ curl import */

function applyRequest(req) {
  el.method.value = req.method;
  el.url.value = req.url;
  setRows(el.paramsTable, req.params);
  setRows(el.headersTable, req.headers);

  const auth = req.auth || { type: 'none' };
  el.authType.value = auth.type;
  if (auth.type === 'basic') {
    el.basicUser.value = auth.username || '';
    el.basicPass.value = auth.password || '';
  } else if (auth.type === 'bearer') {
    el.bearerToken.value = auth.token || '';
  } else if (auth.type === 'jwt') {
    el.jwtToken.value = auth.token || '';
    el.jwtPrefix.value = auth.prefix || 'Bearer';
    el.jwtTarget.value = auth.target || 'header';
    el.jwtKey.value = auth.key || 'Authorization';
  }
  syncAuthPanels();

  el.bodyType.value = req.bodyType || 'none';
  el.bodyText.value = req.bodyText || '';
  setRows(el.formTable, req.formFields);
  syncBodyPanel();
}

$('#btnImportCurl').addEventListener('click', () => {
  el.curlError.textContent = '';
  el.curlDialog.showModal();
});

$('#btnDoImport').addEventListener('click', (event) => {
  try {
    applyRequest(parseCurl(el.curlInput.value));
    el.curlError.textContent = '';
  } catch (err) {
    event.preventDefault();
    el.curlError.textContent = err.message;
  }
});

$('#btnCopyCurl').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(toCurl(buildRequest()));
    flash($('#btnCopyCurl'), 'Copied!');
  } catch (err) {
    alert(err.message);
  }
});

$('#btnCopyResp').addEventListener('click', async () => {
  await navigator.clipboard.writeText(el.respBody.textContent);
  flash($('#btnCopyResp'), 'Copied!');
});

$('#btnCopyMcp').addEventListener('click', async () => {
  await navigator.clipboard.writeText(el.mcpResponse.textContent);
  flash($('#btnCopyMcp'), 'Copied!');
});

function setMcpStatus(text, ok = null) {
  el.mcpStatus.textContent = text;
  el.mcpStatus.className = 'pill' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}

function parseJsonField(field, fallback, label) {
  const raw = field.value.trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
}

function buildMcpPayload(method, bodyOverride) {
  const methodName = method || el.mcpMethod.value;
  const payload = bodyOverride ?? parseJsonField(el.mcpRequest, {}, 'Request payload');
  const base = { jsonrpc: '2.0', id: Date.now(), method: methodName };
  if (methodName === 'tools/call') {
    return { ...base, params: { name: el.mcpToolName.value.trim() || 'example_tool', arguments: parseJsonField(el.mcpToolArgs, {}, 'Tool arguments') } };
  }
  const params = methodName === 'initialize' ? payload : payload && typeof payload === 'object' ? payload : {};
  return { ...base, params };
}

function tryPrettyPrintMcpResponse(text) {
  if (!text) return '(empty response)';

  const normalized = text.trim();
  const lines = normalized.split(/\r?\n/);
  const dataLines = lines.filter((line) => /^data:\s*/i.test(line.trim()));
  if (dataLines.length) {
    const data = dataLines.map((line) => line.replace(/^data:\s*/i, '')).join('\n').trim();
    if (data) {
      try {
        return JSON.stringify(JSON.parse(data), null, 2);
      } catch {
        return data;
      }
    }
  }

  try {
    return JSON.stringify(JSON.parse(normalized), null, 2);
  } catch {
    return normalized;
  }
}

async function sendMcpRequest(methodName, overridePayload) {
  const url = el.mcpUrl.value.trim();
  if (!url) {
    throw new Error('Enter the server URL before sending an MCP request.');
  }

  const headers = parseJsonField(el.mcpHeaders, {}, 'Headers');
  const payload = buildMcpPayload(methodName, overridePayload);

  setMcpStatus('Sending...', null);
  el.mcpResponse.textContent = 'Waiting for response...';

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    el.mcpResponse.textContent = tryPrettyPrintMcpResponse(text);
    setMcpStatus(`HTTP ${res.status}`, res.ok);
  } catch (err) {
    el.mcpResponse.textContent = `Request failed: ${err.message}`;
    setMcpStatus('Error', false);
  }
}

$('#btnMcpSend').addEventListener('click', () => {
  sendMcpRequest(el.mcpMethod.value).catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

$('#btnMcpInitialize').addEventListener('click', () => {
  el.mcpMethod.value = 'initialize';
  sendMcpRequest('initialize').catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

$('#btnMcpPing').addEventListener('click', () => {
  el.mcpMethod.value = 'ping';
  sendMcpRequest('ping', { ping: true }).catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

$('#btnMcpListTools').addEventListener('click', () => {
  el.mcpMethod.value = 'tools/list';
  sendMcpRequest('tools/list', {}).catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

$('#btnMcpListResources').addEventListener('click', () => {
  el.mcpMethod.value = 'resources/list';
  sendMcpRequest('resources/list', {}).catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

$('#btnMcpListPrompts').addEventListener('click', () => {
  el.mcpMethod.value = 'prompts/list';
  sendMcpRequest('prompts/list', {}).catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

$('#btnMcpCallTool').addEventListener('click', () => {
  el.mcpMethod.value = 'tools/call';
  sendMcpRequest('tools/call').catch((err) => {
    el.mcpResponse.textContent = err.message;
    setMcpStatus('Error', false);
  });
});

function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = original; }, 1200);
}

/* ------------------------------------------------------------------ init */

[el.paramsTable, el.headersTable, el.formTable].forEach((t) => addRow(t));
syncAuthPanels();
syncBodyPanel();
renderHistory();
setStatus('Idle', null);
el.respBody.textContent = 'Send a request to see the response here.';
