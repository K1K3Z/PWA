export function cloudConfig(env) {
  const configuredOrigin = env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL;
  if (!configuredOrigin) throw new Error('Configura PUBLIC_ORIGIN o RENDER_EXTERNAL_URL con la URL HTTPS pública.');
  const url = new URL(configuredOrigin);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('La URL pública debe ser un origen HTTPS, sin ruta ni credenciales.');
  }
  const origin = url.origin;
  return {
    ...env,
    SHOPSTORE_DIR: env.SHOPSTORE_DIR || '../pwa-angular/dist/pwa/browser',
    SHOPSTORE_ORIGIN: origin,
    PUSH_DATABASE: env.PUSH_DATABASE || './data/subscriptions.sqlite',
    PUSH_APPS: JSON.stringify({ shopstore: { origins: [origin], sendToken: env.PUSH_SEND_TOKEN } }),
  };
}
