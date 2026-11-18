import { createHash, createHmac, createECDH, timingSafeEqual } from 'node:crypto';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const providers = new Set([
  'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com',
]);
const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hash = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(a), hash(b));
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req, contentType) {
  if (req.headers['content-type']?.split(';')[0].trim() !== contentType) {
    throw new RequestError(415, 'Tipo de contenido no compatible.');
  }
  if (Number(req.headers['content-length']) > 8192) {
    throw new RequestError(413, 'Solicitud demasiado grande.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 8192) {
      req.resume();
      throw new RequestError(413, 'Solicitud demasiado grande.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(req) {
  const body = await readBody(req, 'application/json');
  try {
    const data = JSON.parse(body);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch {
    // Return the same response for malformed JSON and unsupported shapes.
  }
  throw new RequestError(400, 'Se esperaba un objeto JSON.');
}

function subscriptionFrom(body) {
  const { endpoint, keys } = body;
  const encodedKey = (value, length) => typeof value === 'string'
    && /^[A-Za-z0-9_-]+$/.test(value) && Buffer.from(value, 'base64url').length === length;
  let url;
  try {
    if (typeof endpoint === 'string' && endpoint.length <= 2048) url = new URL(endpoint);
  } catch {
    // An invalid URL is handled below.
  }
  if (url?.protocol !== 'https:' || url.port || url.username || url.password || url.hash
      || !providers.has(url.hostname) || url.pathname === '/'
      || !encodedKey(keys?.p256dh, 65) || !encodedKey(keys?.auth, 16)) {
    throw new RequestError(400, 'Suscripción inválida o proveedor de avisos no admitido.');
  }
  return { endpoint: url.href, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

function readConfig(env) {
  const vapidDetails = {
    subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY,
  };
  webpush.setVapidDetails(vapidDetails.subject, vapidDetails.publicKey, vapidDetails.privateKey);
  const key = createECDH('prime256v1');
  key.setPrivateKey(Buffer.from(vapidDetails.privateKey, 'base64url'));
  if (key.getPublicKey().toString('base64url') !== vapidDetails.publicKey) {
    throw new Error('La clave pública VAPID no corresponde a la clave privada.');
  }

  const apps = new Map(Object.entries(JSON.parse(env.PUSH_APPS ?? '{}')));
  if (!apps.size || new Set([...apps.values()].map((app) => app.sendToken)).size !== apps.size) {
    throw new Error('Configura PUSH_APPS con una credencial de envío distinta por aplicación.');
  }
  for (const [id, app] of apps) {
    if (!/^[a-z0-9-]+$/.test(id) || typeof app.sendToken !== 'string' || app.sendToken.length < 32
        || !Array.isArray(app.origins) || !app.origins.length || !app.origins.every(validOrigin)) {
      throw new Error('Cada aplicación requiere un identificador, orígenes y un sendToken de al menos 32 caracteres.');
    }
  }
  if (env.SHOPSTORE_DIR && (!apps.get('shopstore')?.origins.includes(env.SHOPSTORE_ORIGIN)
      || (env.SHOPSTORE_ADMIN_PASSWORD?.length ?? 0) < 32)) {
    throw new Error('Configura SHOPSTORE_ORIGIN y una SHOPSTORE_ADMIN_PASSWORD de al menos 32 caracteres.');
  }
  return { apps, vapidDetails };
}

function validOrigin(origin) {
  try {
    const url = new URL(origin);
    return url.origin === origin && (url.protocol === 'https:'
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch {
    return false;
  }
}

export function createPushServer(env = process.env, deliver = webpush.sendNotification) {
  const { apps, vapidDetails } = readConfig(env);
  const databasePath = env.PUSH_DATABASE ?? './data/subscriptions.sqlite';
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
    app TEXT NOT NULL, endpoint TEXT NOT NULL, auth TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY (app, endpoint)
  )`);
  const find = db.prepare('SELECT auth FROM subscriptions WHERE app = ? AND endpoint = ?');
  const all = db.prepare('SELECT endpoint, auth, data FROM subscriptions WHERE app = ?');
  const count = db.prepare('SELECT COUNT(*) AS total FROM subscriptions WHERE app = ?');
  const save = db.prepare(`INSERT INTO subscriptions (app, endpoint, auth, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (app, endpoint) DO UPDATE SET data = excluded.data`);
  const remove = db.prepare('DELETE FROM subscriptions WHERE app = ? AND endpoint = ? AND auth = ?');
  const broadcasting = new Set();
  const loginAttempts = new Map();

  async function send(app, req, res) {
    const { title, body } = await readJson(req);
    if (typeof title !== 'string' || !title.trim() || title.length > 120
        || typeof body !== 'string' || !body.trim() || body.length > 500) {
      throw new RequestError(400, 'Escribe un título y un mensaje de hasta 120 y 500 caracteres.');
    }
    if (broadcasting.has(app)) throw new RequestError(429, 'Ya hay un envío en curso.');
    broadcasting.add(app);
    try {
      const rows = all.all(app);
      const payload = JSON.stringify({ notification: { title, body } });
      let enviadas = 0;
      let expiradas = 0;
      let fallidas = 0;
      for (let i = 0; i < rows.length; i += 20) {
        await Promise.all(rows.slice(i, i + 20).map(async (row) => {
          try {
            await deliver(JSON.parse(row.data), payload, { vapidDetails, TTL: 300, timeout: 5000 });
            enviadas++;
          } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) {
              remove.run(app, row.endpoint, row.auth);
              expiradas++;
            } else {
              fallidas++;
            }
          }
        }));
      }
      json(res, 200, { enviadas, expiradas, fallidas });
    } finally {
      broadcasting.delete(app);
    }
  }

  const signature = (expiry) => createHmac('sha256', env.SHOPSTORE_ADMIN_PASSWORD)
    .update(`shopstore:${expiry}`).digest('base64url');
  const cookieOptions = () => 'Path=/api/shopstore; HttpOnly; SameSite=Strict'
    + (env.SHOPSTORE_ORIGIN.startsWith('https:') ? '; Secure' : '');

  function hasSession(req) {
    const session = req.headers.cookie?.match(/(?:^|; )push_admin=(\d+)\.([A-Za-z0-9_-]+)/);
    return session && Number(session[1]) > Date.now() && sameSecret(session[2], signature(session[1]));
  }

  async function shopstore(path, req, res) {
    if (path === '/api/shopstore/login.html' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': types['.html'], 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
      res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Avisos del explorador</title>
        <h1>Avisos del explorador de Rick y Morty</h1>${hasSession(req)
          ? '<p>Sesión activa.</p><form method="post" action="/api/shopstore/logout"><button>Cerrar sesión</button></form>'
          : '<form method="post"><label>Contraseña de administrador <input type="password" name="password" required></label> <button>Entrar</button></form>'}
        <p><a href="/">Volver al explorador</a></p></html>`);
      return;
    }
    if (req.method !== 'POST') throw new RequestError(405, 'Método no admitido.');
    if (req.headers.origin !== env.SHOPSTORE_ORIGIN) throw new RequestError(403, 'Origen no autorizado.');
    if (path === '/api/shopstore/push') {
      if (!hasSession(req)) throw new RequestError(401, 'Inicia sesión para enviar avisos.');
      return send('shopstore', req, res);
    }
    if (path === '/api/shopstore/logout') {
      res.writeHead(303, { Location: '/api/shopstore/login.html',
        'Set-Cookie': `push_admin=; Max-Age=0; ${cookieOptions()}` });
      res.end();
      return;
    }
    if (path !== '/api/shopstore/login.html') throw new RequestError(404, 'Ruta no encontrada.');

    const password = new URLSearchParams(await readBody(req, 'application/x-www-form-urlencoded')).get('password');
    const now = Date.now();
    const ip = req.socket.remoteAddress;
    for (const [key, attempt] of loginAttempts) {
      if (attempt.until <= now) loginAttempts.delete(key);
    }
    const attempt = loginAttempts.get(ip) ?? { failures: 0, until: now + 60000 };
    if (attempt.failures >= 10) throw new RequestError(429, 'Espera un minuto antes de volver a intentar.');
    if (!sameSecret(password, env.SHOPSTORE_ADMIN_PASSWORD)) {
      attempt.failures++;
      loginAttempts.set(ip, attempt);
      throw new RequestError(401, 'Contraseña incorrecta.');
    }
    loginAttempts.delete(ip);
    const expiry = String(now + 8 * 60 * 60 * 1000);
    res.writeHead(303, { Location: '/',
      'Set-Cookie': `push_admin=${expiry}.${signature(expiry)}; Max-Age=28800; ${cookieOptions()}` });
    res.end();
  }

  function serveShopstore(path, req, res) {
    if (!env.SHOPSTORE_DIR || !['GET', 'HEAD'].includes(req.method)) {
      throw new RequestError(404, 'Ruta no encontrada.');
    }
    const root = resolve(env.SHOPSTORE_DIR);
    const decoded = decodeURIComponent(path);
    if (decoded.split('/').some((part) => part.startsWith('.')) || decoded.includes('\\')) {
      throw new RequestError(404, 'Archivo no encontrado.');
    }
    let file = resolve(root, decoded === '/' ? 'index.html' : `.${decoded}`);
    if (!file.startsWith(root + sep)) throw new RequestError(404, 'Archivo no encontrado.');
    let stats = statSync(file, { throwIfNoEntry: false });
    if (!stats?.isFile() && !extname(decoded) && req.headers.accept?.includes('text/html')) {
      file = resolve(root, 'index.html');
      stats = statSync(file, { throwIfNoEntry: false });
    }
    if (!stats?.isFile()) throw new RequestError(404, 'Compila la aplicación o comprueba la ruta solicitada.');
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache', 'Content-Length': stats.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }

  async function route(req, res) {
    const { pathname: path } = new URL(req.url, 'http://localhost');
    if (path === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
    if (path.startsWith('/api/shopstore/') && env.SHOPSTORE_DIR) return shopstore(path, req, res);
    const match = /^\/api\/apps\/([a-z0-9-]+)\/(config|subscribe|unsubscribe|push)$/.exec(path);
    if (!match) {
      if (path.startsWith('/api/')) throw new RequestError(404, 'Ruta no encontrada.');
      return serveShopstore(path, req, res);
    }
    const [, id, action] = match;
    const app = apps.get(id);
    if (!app) throw new RequestError(404, 'Aplicación no encontrada.');
    const { origin, authorization } = req.headers;
    if (action === 'push') {
      if (req.method !== 'POST') throw new RequestError(405, 'Método no admitido.');
      if (!sameSecret(authorization, `Bearer ${app.sendToken}`)) {
        throw new RequestError(401, 'Credencial de envío requerida.');
      }
      return send(id, req, res);
    }
    if (origin && !app.origins.includes(origin)) throw new RequestError(403, 'Origen no autorizado.');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type' });
      return res.end();
    }
    if (action === 'config' && req.method === 'GET') {
      return json(res, 200, { publicKey: vapidDetails.publicKey });
    }
    if (action === 'config' || req.method !== 'POST') throw new RequestError(405, 'Método no admitido.');
    if (!origin) throw new RequestError(403, 'Origen requerido.');
    const subscription = subscriptionFrom(await readJson(req));
    const { endpoint, keys: { auth } } = subscription;
    if (action === 'unsubscribe') {
      remove.run(id, endpoint, auth);
    } else {
      const existing = find.get(id, endpoint);
      if (existing && !sameSecret(existing.auth, auth)) throw new RequestError(409, 'La suscripción ya existe.');
      if (!existing && count.get(id).total >= 1000) throw new RequestError(429, 'Límite de suscripciones alcanzado.');
      save.run(id, endpoint, auth, JSON.stringify(subscription));
    }
    json(res, 200, { ok: true });
  }

  const server = createServer({ requestTimeout: 30000 }, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    route(req, res).catch((error) => {
      if (!(error instanceof RequestError)) console.error('Error interno:', error.message);
      if (res.headersSent) return res.destroy();
      json(res, error.status ?? 500, { error: error instanceof RequestError ? error.message : 'Error interno.' });
    });
  });
  server.once('close', () => db.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8081);
  createPushServer().listen(port, host, () => console.log(`Servidor push en ${host}:${port}`));
}
