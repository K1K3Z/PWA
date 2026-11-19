# PWA y servidor en servicios distintos

- PWA: https://pwa-app-9e60.onrender.com
- Servidor: https://enrique-rickmorty.onrender.com
- Salud del servidor: https://enrique-rickmorty.onrender.com/health

FRONTEND_ORIGIN en el Blueprint permite el origen exacto de la PWA además del dominio del servidor. Las cookies administrativas siguen siendo HttpOnly, Secure y SameSite=Strict.

En el servicio estático PWA APP, configura estas reglas en Redirects/Rewrites, en este orden:

| Source | Destination | Action |
| --- | --- | --- |
| /api/* | https://enrique-rickmorty.onrender.com/api/* | Rewrite |
| /* | /index.html | Rewrite |

La primera regla sirve las rutas de la API a través del dominio de la PWA. Conserva las cookies del inicio de sesión sin depender de cookies de terceros. La segunda permite recargar las rutas Angular. El service worker ya excluye /api/** de la navegación offline y no guarda las respuestas privadas de esas rutas.

No cambies push.config.ts por URLs absolutas sin adaptar también la autenticación. No copies secretos del backend a las variables ni al código del sitio estático.

Después de guardar las reglas, abre /api/apps/shopstore/config desde el dominio de la PWA: debe responder JSON con publicKey. Abre Administrar avisos desde la PWA e inicia sesión allí. Activa los avisos en ese nuevo dominio y comprueba la recepción real. La suscripción del dominio anterior es independiente.

La configuración local existente sigue funcionando sin FRONTEND_ORIGIN.
