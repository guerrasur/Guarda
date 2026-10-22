# Conexión persistente de Guarda con Drive

Estado: servicio de conexión persistente configurado con Cloudflare Workers Free y D1 y URL pública en `src/drive-config.js`. El código 0.7.4 agrega una URL directa `/oauth/launch` protegida por comprobante de un solo uso para evitar que la PWA instalada en iOS quede en `about:blank`; mantiene la ruta de formulario anterior por compatibilidad. El código 0.7.3 agrega un paso de navegación de primer nivel y diagnóstico de errores de autorización. **El Worker actualizado debe volver a desplegarse** y la autorización real de Google debe verificarse antes de confirmar que la conexión está solucionada. No es necesario reiniciar cuentas, borrar notas ni cambiar la clave de cifrado.

## Diagnóstico del consentimiento (0.7.6)

El callback distingue credenciales rechazadas (CLIENT), comunicación (NETWORK), respuesta inválida (RESPONSE), servicio Google (GOOGLE), intercambio de autorización (TOKEN), identidad de Drive (IDENTITY), cifrado (ENCRYPT) y guardado D1 (STORAGE). Son mensajes fijos: no se publican valores secretos ni errores originales. Un intento fallido requiere iniciar otro desde Guarda; no promete recuperarlo automáticamente. Estos mensajes requieren desplegar el Worker actualizado, no solo GitHub Pages.

## Coste y alcance

Usar exclusivamente **Cloudflare Workers Free + D1 Free**. No contratar Workers Paid, R2, Firebase Functions ni pruebas de pago. Workers Free incluye 100.000 solicitudes diarias; D1 Free incluye 5 millones de filas leídas y 100.000 escritas por día. Al exceder los límites gratuitos fallan las operaciones; las notas siguen guardándose localmente. Verificar estos límites y el plan de la cuenta antes de desplegar.

El servidor conserva autorizaciones cifradas, no notas ni audios. El navegador obtiene accesos temporales y transfiere archivos directamente a Google Drive. Se mantiene el mismo cliente OAuth y `drive.file` para conservar el acceso a los archivos anteriores. No se muda el sitio: las notas de IndexedDB continúan en `https://guerrasur.github.io/Guarda/`.

## Activación del administrador

Requisitos: Node.js 22.13 o superior, una cuenta gratuita de Cloudflare y acceso al proyecto Google Cloud **GuardaNote**. No pegar secretos en el chat ni en GitHub. Los comandos siguientes se ejecutan desde la raíz del repositorio.

1. Crear la cuenta en https://dash.cloudflare.com/sign-up y confirmar **Workers Free**. Elegir el subdominio gratuito `workers.dev` de la cuenta. No es necesario comprar un dominio.
2. Instalar dependencias con `npm ci`. Iniciar sesión: `npx wrangler login`.
3. Crear solo la base de autorizaciones: `npx wrangler d1 create guarda-drive --config server/wrangler.jsonc`. Copiar el UUID devuelto a `database_id` en `server/wrangler.jsonc`. Si Wrangler ofrece escribir el binding, revisar que exista uno solo llamado `DB`.
4. Reemplazar `PUBLIC_ORIGIN` por `https://guarda-drive.TU-SUBDOMINIO.workers.dev`. Conservar `APP_ORIGIN` y `GOOGLE_CLIENT_ID`.
5. En Google Auth Platform → Clientes, abrir el mismo cliente web de GuardaNote y agregar a **URI de redirección autorizados**: `https://guarda-drive.TU-SUBDOMINIO.workers.dev/oauth/callback`. Conservar el origen JavaScript anterior. No cambiar el cliente por otro: `drive.file` concede acceso por aplicación.
6. Cargar el secreto del cliente con `npx wrangler secret put GOOGLE_CLIENT_SECRET --config server/wrangler.jsonc`. Introducirlo únicamente en la terminal/gestor de secretos de Cloudflare. Si el cliente no permite recuperar el secreto, crear uno nuevo para ese mismo cliente en Google; evitar invalidar un secreto que otro despliegue esté usando.
7. Generar una clave aleatoria de 32 bytes **una sola vez** en un gestor de contraseñas o terminal local y cargarla mediante `npx wrangler secret put ENCRYPTION_KEY --config server/wrangler.jsonc`. Debe estar codificada en base64url (43 caracteres). Para generarla en una terminal local: `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Guardar una copia privada; cambiarla sin migrar los datos impide descifrar las sesiones existentes.
8. Crear las tablas: `npm run broker:migrate`. Publicar: `npm run broker:deploy`. Estos comandos no cambian de plan ni habilitan facturación.
9. En Google Auth Platform → Público, revisar el estado de publicación. Si sigue como **Testing**, los refresh tokens de Drive caducan a los siete días. Completar lo necesario para pasar a producción, conservando las URL de privacidad y los permisos limitados. El código no puede cambiar ese ajuste por sí mismo.
10. Verificar y fijar la URL pública: `npm run broker:activate -- https://guarda-drive.TU-SUBDOMINIO.workers.dev`. El comando comprueba el cliente OAuth y CORS antes de modificar el frontend.
11. Incrementar la versión, ejecutar `npm run check`, `npm test` y `npm run build`, y publicar por el flujo de Pages existente. No afirmar activación hasta comprobar el despliegue y una autorización real.
12. Cada dispositivo conecta una vez el sistema nuevo. A partir de entonces la renovación no necesita ventanas de Google en el uso normal. Conservar permisos de prueba solo sirve para validar; no elimina el vencimiento semanal de Testing.

## Operación y protección contra abuso (0.7.9)

Ver [auditoría, límites, mantenimiento y riesgos](../docs/security.md). No requiere migración de D1 ni cambios de secretos.

## Diseño y seguridad

- El navegador conserva un identificador secreto y revocable de **su sesión de Guarda** en IndexedDB. No es un token de Google. Las claves `drive-broker-*` se excluyen de exportaciones, importaciones y sincronización, igual que el resto de `drive-*`.
- Los tokens de Google renovables y el acceso temporal cacheado se cifran con AES-GCM y contexto por registro. D1 guarda únicamente el hash del secreto de sesión; el servidor nunca entrega el refresh token al navegador. El secreto OAuth y la clave de cifrado se almacenan como secretos de Workers, fuera del repositorio.
- El inicio actual abre una URL HTTPS con un ticket de lanzamiento de uso único; se conserva el formulario POST anterior para clientes instalados. El formulario valida `Origin` y ambos mecanismos exigen pruebas secretas y una adquisición atómica. Ese paso crea una cookie `__Host-`, Secure, HttpOnly, SameSite=Lax de diez minutos. Su hash se vincula al intento antes de redirigir a Google. Evita aceptar un consentimiento obtenido en otro navegador a partir de un enlace reenviado.
- OAuth usa estado aleatorio de un solo uso y PKCE. La entrega de la sesión exige una prueba aleatoria que nunca se envía a Google. El resultado queda cifrado durante diez minutos para poder repetir una consulta si se corta la red. Un intento que nunca se utiliza no conserva el permiso durante un año.
- Las API del servicio usan `Authorization: Bearer` y `credentials: omit`, sin cookies entre sitios. Solo el popup usa la cookie de primer nivel y la borra al terminar. No requiere trasladar notas a otro origen para funcionar en Safari.
- Antes de guardar o renovar, el servidor consulta la identidad en Drive y compara `permissionId`. El cliente vuelve a comparar la cuenta vinculada antes de aceptar el acceso. No se mezclan cuentas. Las llamadas directas a Drive conservan las validaciones del motor de sincronización existente.
- Renovación serializada por una concesión temporal en D1, además de compartir la solicitud dentro de cada página. Un 401 real de Drive provoca una renovación y un solo reintento. Fallos de red, límites y errores de configuración conservan el permiso; una revocación real lo elimina.
- Desconectar borra la credencial local y revoca esa sesión en el servidor. Sin internet queda una revocación pendiente para la próxima apertura o conexión. No revoca globalmente el permiso de Google porque afectaría a otros dispositivos. También se puede revocar Guarda desde la cuenta de Google.
- Las sesiones utilizadas expiran tras un año sin uso; el uso cercano al vencimiento las extiende. Un cron borra registros vencidos. Los intentos de autorización se limitan por un hash temporal de IP; no se guardan direcciones IP sin procesar. Los logs de observabilidad del Worker están desactivados; no agregar logs de solicitudes OAuth, cuerpos ni cabeceras.

## Comprobaciones antes de habilitarlo

Las pruebas de Node usan SQLite y Google simulado. La suite también ejecuta workerd con D1 y rate limits locales reales, pero Google sigue simulado: no prueba consentimiento real ni Safari físico. `npm run broker:dry-run` compila el Worker sin desplegar ni requerir una cuenta.

En un iPhone, probar: primera autorización; cierre completo y reapertura; acceso vencido después de una hora; actualización de Guarda; modo avión y recuperación; dos pestañas; cuenta equivocada; desconexión y revocación desde Google. En cada caso comprobar que una nota local nueva se conserva y termina en la carpeta ya existente, sin intervención salvo cuando Google haya revocado el permiso. Probar también la pérdida de red después del consentimiento y el bloqueo/cierre del popup.

## Referencias

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/workspace/drive/api/guides/limits
