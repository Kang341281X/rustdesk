const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const ROOT = __dirname;
const DATA_DIR = process.env.PILOTX_DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE =
  process.env.PILOTX_LICENSE_DATA || path.join(DATA_DIR, 'licenses.json');
const HOST = process.env.PILOTX_ADMIN_HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || process.env.PILOTX_ADMIN_PORT || 3000);
const PUBLIC_BASE_PATH = normalizePrefix(
  process.env.PILOTX_PUBLIC_BASE_PATH || '',
);
const DEFAULT_BASE_PATH = '/pilotx-admin';
const DEFAULT_ADMIN_USERNAME = 'kang341281x';
const DEFAULT_ADMIN_PASSWORD = 'WKANGang123.';

const ADMIN_USERNAME = normalizeLoginValue(
  process.env.PILOTX_ADMIN_USERNAME || DEFAULT_ADMIN_USERNAME,
);
const ADMIN_PASSWORD = normalizePasswordValue(
  process.env.PILOTX_ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD,
);
const ALLOW_DEFAULT_ADMIN =
  String(process.env.PILOTX_ALLOW_DEFAULT_ADMIN || 'true').toLowerCase() !==
  'false';
const TOKEN_SECRET =
  process.env.PILOTX_ADMIN_TOKEN_SECRET ||
  crypto
    .createHash('sha256')
    .update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}:PilotX`)
    .digest('hex');
const LICENSE_SECRET =
  process.env.PILOTX_LICENSE_SECRET || 'PilotX-WKANG-2026';
const TOKEN_TTL_SECONDS = Number(
  process.env.PILOTX_ADMIN_TOKEN_TTL_SECONDS || 12 * 60 * 60,
);
const REFRESH_AFTER_SECONDS = 30 * 60;

const alphabet =
  '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const durations = {
  A: { label: '30分钟', seconds: 30 * 60 },
  D: { label: '3小时', seconds: 3 * 60 * 60 },
  B: { label: '1天', seconds: 24 * 60 * 60 },
  C: { label: '2天', seconds: 2 * 24 * 60 * 60 },
  E: { label: '7天', seconds: 7 * 24 * 60 * 60 },
};

function normalizeLoginValue(value) {
  return String(value || '').trim();
}

function normalizePasswordValue(value) {
  return normalizeLoginValue(value).replace(/[。．｡]/g, '.');
}

function isAdminCredential(username, password) {
  const user = normalizeLoginValue(username);
  const pass = normalizePasswordValue(password);
  const candidates = [[ADMIN_USERNAME, ADMIN_PASSWORD]];
  if (ALLOW_DEFAULT_ADMIN) {
    candidates.push([DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD]);
  }
  return candidates.some(
    ([candidateUser, candidatePass]) =>
      user === candidateUser && passwordMatches(candidatePass, pass),
  );
}

function passwordMatches(expected, actual) {
  if (actual === expected) return true;
  return expected.endsWith('.') && actual === expected.slice(0, -1);
}

function normalizePrefix(value) {
  if (!value) return '';
  let prefix = String(value).split(',')[0].trim();
  if (!prefix) return '';
  if (!prefix.startsWith('/')) prefix = `/${prefix}`;
  return prefix.replace(/\/+$/g, '');
}

function forwardedPrefix(req) {
  const raw = req.headers['x-forwarded-prefix'] || PUBLIC_BASE_PATH;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return normalizePrefix(value);
}

function requestUrl(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  url.pathname = normalizePathname(url.pathname, forwardedPrefix(req));
  return url;
}

function normalizePathname(pathname, forwarded = '') {
  let normalized = pathname.replace(/\/{2,}/g, '/');
  const prefixes = [forwarded, forwardedPrefixFromPath(pathname), PUBLIC_BASE_PATH, DEFAULT_BASE_PATH]
    .map(normalizePrefix)
    .filter(Boolean);
  for (const prefix of [...new Set(prefixes)]) {
    if (normalized === prefix) {
      normalized = '/';
      break;
    }
    if (normalized.startsWith(`${prefix}/`)) {
      normalized = normalized.slice(prefix.length) || '/';
      break;
    }
  }
  if (normalized.startsWith('/api/') && normalized.length > 1) {
    normalized = normalized.replace(/\/+$/g, '');
  }
  return normalized || '/';
}

function forwardedPrefixFromPath(pathname) {
  const marker = '/api/';
  const index = pathname.indexOf(marker);
  if (index <= 0) return '';
  return pathname.slice(0, index);
}

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ licenses: [], updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  }
}

function readStore() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(parsed)) {
      return { licenses: parsed };
    }
    if (parsed && Array.isArray(parsed.licenses)) {
      return parsed;
    }
  } catch (error) {
    console.error(`Failed to read ${DATA_FILE}:`, error);
  }
  return { licenses: [] };
}

function writeStore(store) {
  ensureStore();
  const payload = {
    ...store,
    updatedAt: new Date().toISOString(),
  };
  const tempFile = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tempFile, DATA_FILE);
}

function normalizeRecord(record, now = Date.now()) {
  if (!record.id) record.id = randomId();
  if (!record.generatedAt) record.generatedAt = new Date().toISOString();
  if (!record.durationKey || !durations[record.durationKey]) {
    record.durationKey = 'B';
  }
  record.durationSeconds = durations[record.durationKey].seconds;
  if (record.activatedAt) {
    const activatedAtMs = Date.parse(record.activatedAt);
    record.expiresAt = Number.isNaN(activatedAtMs)
      ? 0
      : activatedAtMs + record.durationSeconds * 1000;
  } else {
    record.expiresAt = 0;
  }
  if (record.revokedAt) {
    record.status = 'revoked';
  } else if (record.activatedAt && record.expiresAt <= now) {
    record.status = 'expired';
  } else if (record.activatedAt) {
    record.status = 'active';
  } else {
    record.status = 'unused';
  }
  return record;
}

function normalizeStore(store) {
  const now = Date.now();
  store.licenses = (store.licenses || [])
    .filter((record) => record && record.code)
    .map((record) => normalizeRecord(record, now));
  return store;
}

function publicRecord(record) {
  const now = Date.now();
  const normalized = normalizeRecord({ ...record }, now);
  const remainingSeconds =
    normalized.expiresAt && normalized.status === 'active'
      ? Math.max(0, Math.floor((normalized.expiresAt - now) / 1000))
      : 0;
  return {
    id: normalized.id,
    code: normalized.code,
    durationKey: normalized.durationKey,
    durationSeconds: normalized.durationSeconds,
    generatedAt: normalized.generatedAt || '',
    activatedAt: normalized.activatedAt || '',
    expiresAt: normalized.expiresAt || 0,
    lastRefreshAt: normalized.lastRefreshAt || '',
    revokedAt: normalized.revokedAt || '',
    status: normalized.status,
    note: normalized.note || '',
    deviceId: normalized.deviceId || '',
    deviceName: normalized.deviceName || '',
    app: normalized.app || '',
    version: normalized.version || '',
    remainingSeconds,
  };
}

function randomId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function toBase62BigInt(value, length) {
  let out = '';
  const base = BigInt(alphabet.length);
  while (value > 0n) {
    out = alphabet[Number(value % base)] + out;
    value /= base;
  }
  return out.padStart(length, '0').slice(-length);
}

function toBase62(value, length) {
  let out = '';
  value >>>= 0;
  for (let i = 0; i < length; i += 1) {
    out = alphabet[value % alphabet.length] + out;
    value = Math.floor(value / alphabet.length);
  }
  return out;
}

function checksum(body) {
  let hash = 0x811c9dc5;
  const input = Buffer.from(`${body}|${LICENSE_SECRET}`, 'utf8');
  for (const unit of input) {
    hash ^= unit;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return toBase62(hash, 5);
}

function isValidCodeShape(code) {
  if (!/^[A-Za-z0-9]{18}$/.test(code)) return false;
  const body = code.slice(0, 13);
  return Boolean(durations[body[0]]) && checksum(body) === code.slice(13);
}

function makeCode(durationKey) {
  const randomTail = crypto.randomInt(0, 4096);
  const stamp = BigInt(Date.now()) * 4096n + BigInt(randomTail);
  const body = durationKey + toBase62BigInt(stamp, 12);
  return body + checksum(body);
}

function createLicenses(durationKey, count, note, existingCodes) {
  const generated = [];
  const amount = Math.min(Math.max(Number(count) || 1, 1), 500);
  const safeDuration = durations[durationKey] ? durationKey : 'B';
  while (generated.length < amount) {
    const code = makeCode(safeDuration);
    if (existingCodes.has(code)) continue;
    existingCodes.add(code);
    generated.push(
      normalizeRecord({
        id: randomId(),
        code,
        durationKey: safeDuration,
        durationSeconds: durations[safeDuration].seconds,
        generatedAt: new Date().toISOString(),
        activatedAt: '',
        expiresAt: 0,
        lastRefreshAt: '',
        revokedAt: '',
        status: 'unused',
        note: String(note || '').trim(),
        deviceId: '',
        deviceName: '',
        app: '',
        version: '',
      }),
    );
  }
  return generated;
}

function jsonResponse(res, statusCode, payload) {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function textResponse(res, statusCode, text, contentType = 'text/plain') {
  setCorsHeaders(res);
  res.writeHead(statusCode, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function setCorsHeaders(res) {
  res.setHeader(
    'Access-Control-Allow-Origin',
    process.env.PILOTX_CORS_ORIGIN || '*',
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type,Authorization,X-Requested-With',
  );
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error('request_body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    '=',
  );
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signToken(payload) {
  const body = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(body)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return null;
  }
  try {
    const payload = JSON.parse(base64UrlDecode(body));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload || payload.sub !== ADMIN_USERNAME) {
    jsonResponse(res, 401, { ok: false, message: '请先登录管理员账号。' });
    return null;
  }
  return payload;
}

function sanitizeImportedRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const code = String(item.code || '').trim();
  const durationKey = String(item.durationKey || code[0] || '').toUpperCase();
  if (!code || !durations[durationKey]) return null;
  const activatedAt = item.activatedAt ? String(item.activatedAt) : '';
  const durationSeconds = durations[durationKey].seconds;
  const expiresAt = Number(item.expiresAt) || Number(item.expires_at) || 0;
  return normalizeRecord({
    id: item.id ? String(item.id) : randomId(),
    code,
    durationKey,
    durationSeconds,
    generatedAt: item.generatedAt
      ? String(item.generatedAt)
      : new Date().toISOString(),
    activatedAt,
    expiresAt:
      expiresAt ||
      (activatedAt ? Date.parse(activatedAt) + durationSeconds * 1000 : 0),
    lastRefreshAt: item.lastRefreshAt ? String(item.lastRefreshAt) : '',
    revokedAt: item.revokedAt ? String(item.revokedAt) : '',
    status: item.status ? String(item.status) : 'unused',
    note: item.note ? String(item.note) : '',
    deviceId: item.deviceId || item.device_id ? String(item.deviceId || item.device_id) : '',
    deviceName:
      item.deviceName || item.device_name
        ? String(item.deviceName || item.device_name)
        : '',
    app: item.app ? String(item.app) : '',
    version: item.version ? String(item.version) : '',
  });
}

function clientIdentity(body) {
  const deviceId = String(body.device_id || body.deviceId || '').trim();
  const deviceName = String(body.device_name || body.deviceName || '').trim();
  return {
    deviceId,
    deviceName,
    app: String(body.app || '').trim(),
    version: String(body.version || '').trim(),
  };
}

function clientFailure(res, status, message) {
  jsonResponse(res, 200, {
    valid: false,
    status,
    message,
    refresh_after_seconds: REFRESH_AFTER_SECONDS,
  });
}

function maskCode(code) {
  return `${String(code).slice(0, 4)}...${String(code).slice(-4)}`;
}

function clientSuccess(res, record) {
  const now = Date.now();
  jsonResponse(res, 200, {
    valid: true,
    status: record.status,
    code: record.code,
    duration_key: record.durationKey,
    duration_seconds: record.durationSeconds,
    activated_at: record.activatedAt || '',
    expires_at: record.expiresAt,
    expiresAt: record.expiresAt,
    remaining_seconds: Math.max(0, Math.floor((record.expiresAt - now) / 1000)),
    refresh_after_seconds: REFRESH_AFTER_SECONDS,
  });
}

function handleClientLicense(res, action, body) {
  const code = String(body.code || '').trim();
  const identity = clientIdentity(body);
  if (!code || !isValidCodeShape(code)) {
    clientFailure(res, 'invalid', '许可证无效，请重新咨询客服。');
    return;
  }
  if (!identity.deviceId) {
    clientFailure(res, 'invalid_device', '无法识别当前设备，许可证激活失败。');
    return;
  }

  const store = normalizeStore(readStore());
  const record = store.licenses.find((item) => item.code === code);
  if (!record) {
    clientFailure(res, 'not_found', '许可证不存在或已被删除。');
    return;
  }

  normalizeRecord(record);
  if (record.status === 'revoked') {
    clientFailure(res, 'revoked', '许可证已被管理员终止。');
    return;
  }
  if (record.status === 'expired') {
    clientFailure(res, 'expired', '许可证已失效，请重新咨询客服。');
    return;
  }
  if (record.deviceId && record.deviceId !== identity.deviceId) {
    clientFailure(res, 'device_mismatch', '许可证已绑定其他控制端。');
    return;
  }
  if (action === 'status') {
    if (record.status === 'unused') {
      clientFailure(res, 'unused', '许可证尚未激活，请重新输入许可证。');
      return;
    }
    clientSuccess(res, record);
    return;
  }
  const now = Date.now();
  if (!record.activatedAt) {
    record.activatedAt = new Date(now).toISOString();
    record.expiresAt = now + durations[record.durationKey].seconds * 1000;
  }
  record.deviceId = identity.deviceId;
  record.deviceName = identity.deviceName;
  record.app = identity.app;
  record.version = identity.version;
  record.lastRefreshAt = new Date(now).toISOString();
  normalizeRecord(record, now);
  writeStore(store);
  console.log(
    `[license:${action}] ${maskCode(record.code)} ${record.status} ${record.deviceId} ${record.deviceName || ''}`.trim(),
  );
  clientSuccess(res, record);
}

async function handleAdmin(req, res, url) {
  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = normalizeLoginValue(body.username);
    const password = normalizePasswordValue(body.password);
    if (!isAdminCredential(username, password)) {
      jsonResponse(res, 401, { ok: false, message: '用户名或密码错误。' });
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const token = signToken({
      sub: ADMIN_USERNAME,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
    });
    jsonResponse(res, 200, {
      ok: true,
      token,
      expiresAt: (now + TOKEN_TTL_SECONDS) * 1000,
      username: ADMIN_USERNAME,
    });
    return;
  }

  if (!requireAdmin(req, res)) return;

  if (url.pathname === '/api/admin/licenses' && req.method === 'GET') {
    const store = normalizeStore(readStore());
    writeStore(store);
    jsonResponse(res, 200, {
      ok: true,
      records: store.licenses.map(publicRecord),
      durations,
      serverTime: Date.now(),
    });
    return;
  }

  if (url.pathname === '/api/admin/licenses' && req.method === 'POST') {
    const body = await readBody(req);
    const store = normalizeStore(readStore());
    const existingCodes = new Set(store.licenses.map((item) => item.code));
    const generated = createLicenses(
      String(body.durationKey || 'B').toUpperCase(),
      body.count,
      body.note,
      existingCodes,
    );
    store.licenses = [...generated, ...store.licenses];
    writeStore(store);
    jsonResponse(res, 200, {
      ok: true,
      records: generated.map(publicRecord),
      all: store.licenses.map(publicRecord),
    });
    return;
  }

  if (url.pathname === '/api/admin/import' && req.method === 'POST') {
    const body = await readBody(req);
    const incoming = Array.isArray(body.records)
      ? body.records
      : Array.isArray(body)
        ? body
        : [];
    const sanitized = incoming.map(sanitizeImportedRecord).filter(Boolean);
    const store = normalizeStore(readStore());
    if (body.mode === 'replace') {
      store.licenses = sanitized;
    } else {
      const byCode = new Map(store.licenses.map((item) => [item.code, item]));
      for (const record of sanitized) {
        byCode.set(record.code, { ...(byCode.get(record.code) || {}), ...record });
      }
      store.licenses = [...byCode.values()].map((record) => normalizeRecord(record));
    }
    writeStore(store);
    jsonResponse(res, 200, {
      ok: true,
      imported: sanitized.length,
      records: store.licenses.map(publicRecord),
    });
    return;
  }

  if (url.pathname === '/api/admin/licenses/bulk-delete' && req.method === 'POST') {
    const body = await readBody(req);
    const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
    const store = normalizeStore(readStore());
    const before = store.licenses.length;
    store.licenses = store.licenses.filter((record) => !ids.has(record.id));
    writeStore(store);
    jsonResponse(res, 200, {
      ok: true,
      deleted: before - store.licenses.length,
      records: store.licenses.map(publicRecord),
    });
    return;
  }

  const match = url.pathname.match(/^\/api\/admin\/licenses\/([^/]+)(?:\/([^/]+))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const action = match[2] || '';
    const store = normalizeStore(readStore());
    const record = store.licenses.find((item) => item.id === id);
    if (!record) {
      jsonResponse(res, 404, { ok: false, message: '许可证不存在。' });
      return;
    }

    if (req.method === 'PATCH' && !action) {
      const body = await readBody(req);
      if (body.note !== undefined) record.note = String(body.note || '').trim();
      const nextDuration = String(body.durationKey || record.durationKey).toUpperCase();
      if (durations[nextDuration]) {
        record.durationKey = nextDuration;
        record.durationSeconds = durations[nextDuration].seconds;
        if (record.activatedAt) {
          record.expiresAt =
            Date.parse(record.activatedAt) + record.durationSeconds * 1000;
        }
      }
      normalizeRecord(record);
      writeStore(store);
      jsonResponse(res, 200, { ok: true, record: publicRecord(record) });
      return;
    }

    if (req.method === 'DELETE' && !action) {
      store.licenses = store.licenses.filter((item) => item.id !== id);
      writeStore(store);
      jsonResponse(res, 200, {
        ok: true,
        records: store.licenses.map(publicRecord),
      });
      return;
    }

    if (req.method === 'POST' && action === 'terminate') {
      const body = await readBody(req);
      const now = new Date().toISOString();
      record.revokedAt = record.revokedAt || now;
      record.lastAdminActionAt = now;
      record.lastAdminAction = 'terminate';
      if (body.reason) record.terminateReason = String(body.reason);
      normalizeRecord(record);
      writeStore(store);
      jsonResponse(res, 200, { ok: true, record: publicRecord(record) });
      return;
    }
  }

  jsonResponse(res, 404, { ok: false, message: '接口不存在。' });
}

async function handleApi(req, res, url) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (url.pathname === '/api/health') {
      jsonResponse(res, 200, { ok: true, serverTime: Date.now() });
      return;
    }
    if (url.pathname.startsWith('/api/admin/')) {
      await handleAdmin(req, res, url);
      return;
    }
    if (
      (url.pathname === '/api/licenses/activate' ||
        url.pathname === '/api/licenses/refresh' ||
        url.pathname === '/api/licenses/status') &&
      req.method === 'POST'
    ) {
      const body = await readBody(req);
      const action = url.pathname.endsWith('/refresh')
        ? 'refresh'
        : url.pathname.endsWith('/status')
          ? 'status'
          : 'activate';
      handleClientLicense(res, action, body);
      return;
    }
    jsonResponse(res, 404, { ok: false, message: '接口不存在。' });
  } catch (error) {
    if (error.message === 'invalid_json') {
      jsonResponse(res, 400, { ok: false, message: '请求 JSON 格式错误。' });
      return;
    }
    if (error.message === 'request_body_too_large') {
      jsonResponse(res, 413, { ok: false, message: '请求内容过大。' });
      return;
    }
    console.error(error);
    jsonResponse(res, 500, { ok: false, message: '服务器内部错误。' });
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html';
    case '.css':
      return 'text/css';
    case '.js':
      return 'application/javascript';
    case '.json':
      return 'application/json';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname);
  const target = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.resolve(ROOT, `.${target}`);
  if (!filePath.startsWith(ROOT) || filePath.startsWith(DATA_DIR)) {
    textResponse(res, 403, 'Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      textResponse(res, 404, 'Not found');
      return;
    }
    setCorsHeaders(res);
    res.writeHead(200, {
      'Content-Type': `${contentType(filePath)}; charset=utf-8`,
      'Cache-Control': filePath.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

function createServer() {
  ensureStore();
  return http.createServer((req, res) => {
    const url = requestUrl(req);
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  });
}

if (require.main === module) {
  createServer().listen(PORT, HOST, () => {
    console.log(`PilotX admin listening on http://${HOST}:${PORT}`);
    console.log(`License data: ${DATA_FILE}`);
  });
}

module.exports = {
  createServer,
  durations,
  makeCode,
  checksum,
  isValidCodeShape,
};
