function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('La URL pública debe ser un origen HTTPS, sin ruta ni credenciales.');
  }
  return url.origin;
}

export function cloudConfig(env) {
  const configuredOrigin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL;
  if (!configuredOrigin) throw new Error('Configura PUBLIC_ORIGIN o RENDER_EXTERNAL_URL con la URL HTTPS pública.');
  const origin = httpsOrigin(configuredOrigin);
  const origins = [...new Set([origin, ...(env.FRONTEND_ORIGIN ? [httpsOrigin(env.FRONTEND_ORIGIN)] : [])])];
  return {
    ...env,
    SHOPSTORE_DIR: env.SHOPSTORE_DIR || '../pwa-angular/dist/pwa/browser',
    SHOPSTORE_ORIGIN: origin,
    PUSH_DATABASE: env.PUSH_DATABASE || './data/subscriptions.sqlite',
    PUSH_APPS: JSON.stringify({ shopstore: { origins, sendToken: env.PUSH_SEND_TOKEN } }),
  };
}
