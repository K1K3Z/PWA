# Publicar el explorador y el servidor push

Este paquete sirve Angular y la API push desde el mismo servicio y dominio HTTPS. No requiere cambiar las rutas del frontend. El identificador interno `shopstore` se conserva.

## Estado

Preparado para Render con Docker y plan Free. Todavía no está publicado: hace falta una cuenta de Render, un repositorio propio y configurar las variables privadas. El archivo render.yaml no contrata recursos de pago.

El plan Free suspende el servicio tras un tiempo sin tráfico, tarda en reactivarse y pierde el archivo SQLite al reiniciarse, suspenderse o desplegarse. La app vuelve a registrar las suscripciones cuando los clientes la abren con conexión. Esto sirve para una demostración académica; para conservar suscripciones aunque los clientes no vuelvan a abrir la app se necesita almacenamiento persistente. No se ha contratado ninguno.

## Publicar

1. Crea tu cuenta en https://dashboard.render.com/ e inicia sesión personalmente.
2. Usa un repositorio propio con el contenido del paquete `cloud-package`. No subas `.env`, bases SQLite ni node_modules. El remoto Git que existía en el proyecto original no se modifica.
3. En Render crea un Blueprint desde ese repositorio. La configuración viene en render.yaml: servicio Docker, plan Free y comprobación de salud /health.
4. Configura VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY con los valores del servidor local, y VAPID_SUBJECT con un contacto real en formato mailto:tu-correo. Introduce los valores privados únicamente en Environment de Render; no los pegues en el chat ni en el repositorio. PUSH_SEND_TOKEN y SHOPSTORE_ADMIN_PASSWORD se generan en Render.
5. Render proporciona RENDER_EXTERNAL_URL; el arranque utiliza ese origen para permitir las suscripciones y proteger los envíos. Para otro proveedor o dominio propio, configura PUBLIC_ORIGIN con el origen HTTPS exacto.
6. Espera a que termine el despliegue y a que /health devuelva {"ok":true}. Conserva la URL HTTPS de la aplicación y la de /api/apps/shopstore/config como evidencia del servidor.
7. En la URL pública activa los avisos. La suscripción de localhost no se traslada automáticamente al dominio nuevo. Abre Administrar avisos e inicia sesión con SHOPSTORE_ADMIN_PASSWORD de Render.
8. Prueba el botón de aviso y las acciones de la colección. Comprueba la recepción real en Chrome; un contador de envíos por sí solo no demuestra que se mostró el aviso.
9. Carga una página completa, espera la activación del service worker y comprueba la recarga sin conexión en Chrome.

## Contenedor

Dockerfile usa Node 24, compila Angular y copia solo el frontend generado y el servidor a la imagen final. No incluye archivos .env ni la base local. La terminación HTTPS la proporciona el alojamiento. El servidor escucha el puerto PORT del proveedor en 0.0.0.0.

En local continúa usando el arranque habitual de push-server; cloud.mjs es el arranque del contenedor. No se han sustituido las claves ni la configuración locales.

Documentación: https://render.com/docs/docker y https://render.com/docs/free
