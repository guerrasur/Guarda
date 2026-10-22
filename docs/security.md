# Seguridad y operación de Guarda 0.7.9

## Alcance y auditoría

Base auditada: `b9f4970`, versión 0.7.8. Continúan GitHub Pages `/Guarda/` y el Worker `guarda-drive`, con la misma base D1 y los mismos secretos. No hay migración de tablas, rotación de claves, cambios de dependencias, facturación ni publicación en Firebase.

Hallazgos corregidos:
- Solo el inicio tenía un límite; cada rechazo seguía escribiendo un contador SQL y cada IP/ventana creaba una fila. Se reemplazó por bindings nativos, sin contadores nuevos en D1.
- El formulario de inicio anterior podía reemplazar el vínculo de un popup: ahora reclama el intento mediante compare-and-swap y admite un solo inicio.
- `force` permitía renovar repetidamente tras otra pestaña. Se compara el hash del token rechazado, se conserva una pausa de 60 segundos tras renovar y se valida la propiedad del bloqueo al actualizar/liberarlo. Los clientes anteriores siguen admitidos. Web Locks ordena las solicitudes del mismo navegador; el bloqueo en D1 protege entre instancias.
- El polling de 1,5 segundos y los reintentos sin fin se reemplazaron por pausas crecientes con jitter y presupuestos de intentos.
- Se agregaron validación temprana de rutas/métodos/parámetros/tipos, límites de URL/cookie/cuerpo, tiempo máximo de lectura, CSP compatible con Pages y límites de copias JSON.
- El chequeo de despliegue seguía esperando 0.7.5: ahora lee la versión del commit y consulta la versión del Worker, sin crear autorizaciones. Pages deja de generar un segundo commit de iconos; los genera únicamente en el artefacto publicado.

Se revisaron y conservaron: `drive.file`; PKCE S256 hacia Google y prueba independiente de entrega; `state` aleatorio, cookie temporal Secure/HttpOnly/Lax vinculada al popup; comparación de identidad y cuenta vinculada; AES-GCM con contexto por registro; sesiones almacenadas como hash y excluidas de backups; errores redactados; redirecciones `manual` del Worker, sin seguir destinos externos. Las consultas repetidas del resultado durante diez minutos son deliberadas para recuperar una respuesta perdida: solo el propietario de la prueba puede leerlo y el callback se procesa una vez.

Desconectar elimina la sesión de **ese dispositivo**; no revoca globalmente el permiso de Google porque afectaría otros dispositivos. La revocación pendiente se conserva localmente si hay un corte. Para retirar todo acceso de la aplicación, usar los permisos de la cuenta de Google. Un access token ya emitido puede seguir vigente hasta su vencimiento; borrar la sesión impide futuras renovaciones.

## Límites iniciales

Todos son aproximados, por ubicación de Cloudflare, en ventanas de 60 segundos. No son contadores globales exactos. Las claves de sesiones/pruebas se resumen con SHA-256; los contadores de IP viven en la infraestructura nativa, no en D1 ni en logs de aplicación.

| Control | Límite | Motivo |
|---|---:|---|
| Total por IP | 600/min | Permitir varios usuarios/pestañas tras una red compartida y frenar ráfagas evidentes. |
| Crear autorización por IP | 20/min | Una conexión normal necesita un intento; margen para redes compartidas y reintentos manuales. |
| Cada operación de navegación OAuth por IP | 60/min | Cubre start, launch, continue y callback sin necesitar contadores SQL. |
| Polling por prueba secreta | 30/min | El cliente empieza con ~3 segundos y llega a 10 segundos. |
| Acceso o desconexión por sesión y operación | 30/min | Los tokens se reutilizan en memoria durante su vigencia. |
| Intentos de renovación por sesión | 4/min | Protege Google y las escrituras del bloqueo; las renovaciones exitosas además tienen pausa de 60 segundos. |

Los métodos/rutas inválidos, cuerpos declarados de más de 2048 bytes y parámetros desconocidos se rechazan antes de D1. La lectura real también limita a 2048 bytes y 5 segundos. URL y cookie: hasta 8192 caracteres. Origin/CORS son controles de navegador adicionales, nunca sustituyen las pruebas secretas, las sesiones o los límites.

Los bindings están en `server/wrangler.jsonc`, namespaces 420790–420794, reservados para este Worker. Si falta un binding necesario, el endpoint devuelve 503 antes de tocar D1. No se añadió CAPTCHA ni un servicio adicional. Se conserva la antigua tabla `rate_limits` vacía por compatibilidad, sin nuevas escrituras. Un cron horario limpia filas vencidas mediante índices ya existentes; no modifica sesiones vigentes.

## Saturación y recuperación

- `Retry-After` admite segundos y fecha HTTP. El cliente respeta ese mínimo, incluso al tocar de nuevo un botón; agrega variación aleatoria a sus pausas. No persiste tokens de Google.
- OAuth: hasta diez minutos/120 consultas, hasta seis fallos temporales consecutivos; no se cierra el intento solo porque iOS informe la ventana como cerrada. No se prepara otra autorización automáticamente al terminar.
- Sincronización: hasta ocho fallos consecutivos en un ciclo. Luego queda pendiente, con mensaje, hasta un reintento manual, reapertura o recuperación de internet. Los cambios locales continúan guardándose. Un reintento explícito tampoco saltea una pausa activa del servidor.
- D1: los errores reconocibles de cuota muestran `DRIVE_QUOTA`; los demás se tratan como indisponibilidad temporal. Un circuito en memoria por instancia reduce nuevas consultas durante 15 minutos para cuotas reconocidas o 30 segundos para fallos inesperados. No es una garantía global: otras instancias pueden consultar D1.
- Los fallos temporales, HTML de error de Cloudflare, mantenimiento y límites no eliminan credenciales. No se muestra “sincronizado” hasta completar el proceso real. Se mantienen transacciones, comprobaciones de revisión, copias de conflictos y guardados antes de actualizar.

## Mantenimiento: activar y desactivar

En Cloudflare → Workers & Pages → **guarda-drive** → Settings → Variables and Secrets, agregar una variable de texto y guardar/desplegar:

| Objetivo | Variable | Activar | Desactivar |
|---|---|---|---|
| Pausar nuevas conexiones | `DRIVE_NEW_CONNECTIONS` | `paused` | `open` o eliminar |
| Suspender toda la integración | `DRIVE_MAINTENANCE` | `1` | `0` o eliminar |

Ambos controles están **desactivados por defecto**: no se incluyen valores activos en el repositorio. `keep_vars: true` evita borrar los controles agregados desde el panel en el siguiente despliegue. No editar GOOGLE_CLIENT_SECRET ni ENCRYPTION_KEY.

La pausa de nuevas conexiones bloquea begin/start/launch; los popups que ya salieron hacia Google pueden completar callback/poll, y las sesiones existentes siguen operativas. El mantenimiento total devuelve 503 con Retry-After 300 antes de D1, incluso al desconectar: la app conserva la revocación pendiente para enviarla después. Las notas locales siguen disponibles. Tras desactivar, el cliente puede esperar el Retry-After anterior; después permite reintentar. Las operaciones que ya estaban en curso pueden terminar.

## Contenido y hosting

El HTML enriquecido se limpia con una lista de etiquetas y sin atributos; textos, nombres y etiquetas se escapan. Solo imágenes raster admitidas se previsualizan. HTML/SVG y otros archivos se descargan, no se insertan como documentos activos. Keep ya limita ZIP, cantidad de entradas, expansión y rutas; se conservan esos controles.

Las copias locales y respuestas de snapshots de Drive se limitan a 200 MB antes/durante la lectura. Se limita la cantidad de registros (50.000 por colección) y la suma de adjuntos codificados antes de decodificar. Una copia que exceda los límites se rechaza sin reemplazar notas ni borrar el archivo original; tampoco se sube un snapshot que luego no se podría leer. Las grabaciones existentes no se recortan. Los límites habituales de adjuntos elegidos siguen siendo 20 MB por archivo y 50 MB por nota.

Pages no permite definir encabezados HTTP arbitrarios desde este repositorio: la CSP se entrega como meta, autoriza el hash exacto del bootstrap y bloquea scripts inline arbitrarios, objetos y cambios de base. Se admite estilo inline por la UI existente. El Worker sí envía no-store, no-referrer, nosniff y DENY; el callback tiene CSP con nonce y frame-ancestors. No se promete protección contra framing de Pages mediante una meta que el navegador ignoraría.

## Riesgos y cuota que permanece

- **Cada solicitud que llega al Worker consume su cuota**, incluso OPTIONS, 400, 401, 429 y mantenimiento. Los límites nativos se ejecutan dentro del Worker. Un ataque distribuido puede agotar el plan gratuito pese a estas defensas.
- Las solicitudes válidas admitidas todavía leen/escriben D1, y OAuth/renovación llaman a Google. El cron también consume filas leídas/escritas. Los topes de Workers y D1 son independientes; no hay una garantía de que “se corta y listo” sin afectar la integración.
- Los límites por ubicación son aproximados y pueden excederse; IP móviles compartidas pueden sufrir falsos positivos. Ajustar con uso observado, sin habilitar logs sensibles.
- Si Cloudflare rechaza antes de ejecutar el Worker, puede responder HTML sin CORS ni Retry-After legible: el cliente solo puede informar indisponibilidad, conservar datos y pausar reintentos, no diagnosticar la cuota exacta.
- El ticket de lanzamiento y el código OAuth atraviesan URLs por el protocolo/navegación del popup. Son temporales y no bastan para leer una sesión: se requieren prueba privada y cookie. Se evita el referrer, se limpia la URL del callback y no hay logs de aplicación. No capturar URLs completas con herramientas de analítica o depuración.
- Un XSS, una extensión maliciosa o acceso al dispositivo puede robar la sesión local. GitHub Pages comparte origen con las demás apps de `guerrasur.github.io`: conservar todas esas apps confiables. La separación por ruta no aísla IndexedDB frente a scripts del mismo origen. Una futura migración a origen dedicado puede mejorar este aislamiento; esta versión no la realiza.
- No se comprueban antivirus de adjuntos descargados. CSP y validación reducen ejecución accidental dentro de Guarda, no garantizan seguridad de un archivo abierto con otra aplicación.

## Validación y despliegue

Ejecutar `npm ci`, `npm run check`, `npm test`, `npm run build`, `npm run broker:dry-run`. `npm test` incluye Miniflare/workerd y D1 locales usando la versión incluida por Wrangler, sin recursos remotos ni dependencias nuevas. Google es simulado incluso en esa prueba. Se cubren límites, origen falsificado, cuenta/prueba ajena, replays, bloqueo de renovación, rechazo de redirecciones, mantenimiento, cuota, reintentos acotados, recuperación y conservación local.

Subir un solo commit a main dispara Pages y, si sigue conectado, Workers Builds. Verificar ambos estados del commit y las respuestas públicas `version.json` y `/v1/config` (este último con Origin permitido). El Worker informa versión 0.7.9. No hay migración D1 que ejecutar. Si Workers Builds falla o no se dispara, desplegar ese mismo commit con `npm run broker:deploy` desde una sesión autorizada, manteniendo bindings y secretos. No usar cuentas temporales de Wrangler.

La autorización real con Google y Safari/iPhone físico requieren una prueba con el usuario; no se presentan mocks como prueba de eso.

Referencias oficiales revisadas: [Rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [GA de bindings](https://developers.cloudflare.com/changelog/post/2025-09-19-ratelimit-workers-ga/), [Workers Free y cuotas](https://developers.cloudflare.com/workers/platform/limits/), [precios Workers](https://developers.cloudflare.com/workers/platform/pricing/), [precios D1](https://developers.cloudflare.com/d1/platform/pricing/). Los bindings no agregan un servicio facturable configurado; no se cambia el plan. Sus límites son aproximados y no sustituyen un límite global estricto.
