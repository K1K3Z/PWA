import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import webpush from 'web-push';
import { createPushServer } from './server.mjs';
import { cloudConfig } from './cloud-config.mjs';

test('cloud deployment uses its HTTPS origin, secure cookies and Angular route fallback', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'explorador-cloud-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><title>Explorador</title>');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const keys = webpush.generateVAPIDKeys();
  const origin = 'https://explorador.example.test';
  const frontendOrigin = 'https://pwa.example.test';
  const config = cloudConfig({
    RENDER_EXTERNAL_URL: origin,
    FRONTEND_ORIGIN: frontendOrigin,
    VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey,
    VAPID_SUBJECT: 'mailto:admin@example.test', PUSH_DATABASE: ':memory:',
    PUSH_SEND_TOKEN: 't'.repeat(32), SHOPSTORE_ADMIN_PASSWORD: 'p'.repeat(32),
    SHOPSTORE_DIR: directory,
  });
  assert.equal(config.SHOPSTORE_ORIGIN, origin);
  assert.deepEqual(JSON.parse(config.PUSH_APPS).shopstore.origins, [origin, frontendOrigin]);
  assert.throws(() => cloudConfig({ RENDER_EXTERNAL_URL: origin, FRONTEND_ORIGIN: 'http://example.test' }), /HTTPS/);
  assert.throws(() => cloudConfig({ RENDER_EXTERNAL_URL: 'http://example.test' }), /HTTPS/);
  assert.throws(() => cloudConfig({ PUBLIC_ORIGIN: origin + '/path' }), /HTTPS/);
  assert.throws(() => cloudConfig({}), /URL HTTPS/);
  const server = createPushServer(config, async () => { throw new Error('No debe enviar avisos.'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + '/health')).json(), { ok: true });
  assert.match(await (await fetch(base + '/acerca', { headers: { Accept: 'text/html' } })).text(), /Explorador/);
  assert.equal((await fetch(base + '/missing.js', { headers: { Accept: 'text/html' } })).status, 404);
  assert.equal((await fetch(base + '/api/missing', { headers: { Accept: 'text/html' } })).status, 404);
  const login = await fetch(base + '/api/shopstore/login.html', {
    method: 'POST', redirect: 'manual', headers: { Origin: origin },
    body: new URLSearchParams({ password: config.SHOPSTORE_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 303);
  assert.match(login.headers.get('set-cookie'), /; Secure/);
  const frontendLogin = await fetch(base + '/api/shopstore/login.html', {
    method: 'POST', redirect: 'manual', headers: { Origin: frontendOrigin },
    body: new URLSearchParams({ password: config.SHOPSTORE_ADMIN_PASSWORD }),
  });
  assert.equal(frontendLogin.status, 303);
  assert.match(frontendLogin.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Secure/);
  const session = frontendLogin.headers.get('set-cookie').split(';')[0];
  const fromFrontend = await fetch(base + '/api/shopstore/push', {
    method: 'POST', headers: { Origin: frontendOrigin, Cookie: session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Colección', body: 'Prueba sin destinatarios' }),
  });
  assert.deepEqual(await fromFrontend.json(), { enviadas: 0, expiradas: 0, fallidas: 0 });
  const blocked = await fetch(base + '/api/shopstore/push', {
    method: 'POST', headers: { Origin: 'https://untrusted.example.test', Cookie: session, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Colección', body: 'No autorizado' }),
  });
  assert.equal(blocked.status, 403);
  const configRequest = await fetch(base + '/api/apps/shopstore/config', { headers: { Origin: frontendOrigin } });
  assert.equal(configRequest.headers.get('access-control-allow-origin'), frontendOrigin);
});

test('isolates apps, protects sending, and removes expired and cancelled subscriptions', async (t) => {
  const vapid = webpush.generateVAPIDKeys();
  const origin = 'http://localhost:8081';
  const otherOrigin = 'https://example.test';
  const shopToken = 's'.repeat(32);
  const otherToken = 'o'.repeat(32);
  const password = 'p'.repeat(32);
  const delivered = [];
  const server = createPushServer({
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: 'mailto:admin@example.test',
    PUSH_DATABASE: ':memory:',
    PUSH_APPS: JSON.stringify({
      shopstore: { origins: [origin], sendToken: shopToken },
      other: { origins: [otherOrigin], sendToken: otherToken },
    }),
    SHOPSTORE_DIR: '../pwa-angular/dist/pwa/browser',
    SHOPSTORE_ORIGIN: origin,
    SHOPSTORE_ADMIN_PASSWORD: password,
  }, async (subscription, payload) => {
    if (subscription.endpoint.endsWith('/expired')) throw { statusCode: 410 };
    delivered.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, headers = {}) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const subscription = (name) => ({
    endpoint: 'https://fcm.googleapis.com/fcm/send/' + name,
    keys: { p256dh: vapid.publicKey, auth: Buffer.alloc(16, 1).toString('base64url') },
  });
  const notice = { title: 'Usuarios de Enrique', body: 'Usuario agregado.' };
  const shop = '/api/apps/shopstore';
  const other = '/api/apps/other';
  const config = await fetch(base + shop + '/config');
  assert.deepEqual(await config.json(), { publicKey: vapid.publicKey });
  assert.equal((await post(shop + '/subscribe', subscription('one'), { Origin: otherOrigin })).status, 403);
  assert.equal((await post(shop + '/subscribe', {
    ...subscription('one'), endpoint: 'https://localhost/internal',
  }, { Origin: origin })).status, 400);
  assert.equal((await post(shop + '/subscribe', subscription('one'), { Origin: origin })).status, 200);
  assert.equal((await post(shop + '/subscribe', subscription('expired'), { Origin: origin })).status, 200);
  assert.equal((await post(other + '/subscribe', subscription('two'), { Origin: otherOrigin })).status, 200);
  assert.equal((await post(shop + '/push', notice)).status, 401);
  assert.equal((await post(shop + '/push', notice, { Authorization: 'Bearer ' + otherToken })).status, 401);
  assert.equal((await post('/api/shopstore/push', notice, { Origin: origin })).status, 401);
  assert.equal(delivered.length, 0);

  const signedIn = await fetch(base + '/api/shopstore/login.html', {
    method: 'POST', redirect: 'manual', headers: { Origin: origin },
    body: new URLSearchParams({ password }),
  });
  assert.equal(signedIn.status, 303);
  const cookie = signedIn.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  const session = { Cookie: cookie.split(';')[0] };
  assert.equal((await post('/api/shopstore/push', notice, { ...session, Origin: otherOrigin })).status, 403);
  const sent = await post('/api/shopstore/push', notice, { ...session, Origin: origin });
  assert.deepEqual(await sent.json(), { enviadas: 1, expiradas: 1, fallidas: 0 });
  assert.deepEqual(delivered, [{ endpoint: subscription('one').endpoint, payload: { notification: notice } }]);

  assert.equal((await post(shop + '/unsubscribe', subscription('one'), { Origin: origin })).status, 200);
  const shopResult = await post(shop + '/push', notice, { Authorization: 'Bearer ' + shopToken });
  assert.deepEqual(await shopResult.json(), { enviadas: 0, expiradas: 0, fallidas: 0 });
  const otherResult = await post(other + '/push', notice, { Authorization: 'Bearer ' + otherToken });
  assert.deepEqual(await otherResult.json(), { enviadas: 1, expiradas: 0, fallidas: 0 });
  assert.equal(delivered.at(-1).endpoint, subscription('two').endpoint);
});
