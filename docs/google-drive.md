# Activar Google Drive en Guarda

## Estado de la conexión persistente

El cliente usa `https://guarda-drive.luchoguerra33.workers.dev`, configurado en
`DRIVE_BROKER_URL`, para recuperar la sesión al abrir la app y renovar el permiso
sin interacción. El 21 de octubre de 2026 se comprobó que `/v1/config` responde
con `persistent: true` al origen de Guarda y que Pages publica v0.7.4.
Estas comprobaciones no acreditan la autorización real con Google ni su
persistencia en un iPhone físico; esa prueba sigue pendiente.

La corrección v0.7.5 espera el resultado del servidor aunque la referencia de
la ventana informe `closed: true`: el aislamiento entre sitios puede producir
esa señal mientras Google sigue abierto. La espera termina por resultado,
desconexión explícita desde el panel o vencimiento de diez minutos.

La implementación utiliza Workers Free y D1 Free para custodiar permisos
cifrados; no guarda notas ni audios y no requiere cambiar la dirección del sitio.
Los tokens de Google siguen sin persistirse en el navegador; allí se conserva
una sesión revocable de Guarda excluida de copias y de sincronización. La
transición necesita una autorización inicial por dispositivo, con el mismo
cliente de GuardaNote y el mismo permiso `drive.file`. Revisar también el estado
Testing/Production de Google para evitar la expiración semanal.

[Configuración completa, diseño y comprobaciones del servidor](../server/README.md).

## Integración anterior, disponible si se desactiva el servidor

La integración está implementada y el **ID público de cliente OAuth de GuardaNote** está configurado desde v0.4.1. Los pasos siguientes documentan la configuración y sirven para revisar o recrear el cliente. No se utiliza secreto, contraseña, clave de API, servidor propio ni cuenta de servicio. No activar facturación ni una prueba de pago para esta configuración.

## Configuración inicial del administrador

1. Abrir https://console.cloud.google.com/ y crear un proyecto llamado Guarda (o seleccionar uno específico para esta app).
2. En APIs y servicios → Biblioteca, habilitar **Google Drive API**.
3. En **Google Auth Platform → Branding**, configurar nombre Guarda, correo de soporte y correo de contacto.
4. En **Audience / Público**, elegir **External / Externo** para cuentas Gmail. Durante las pruebas agregar el correo propio y el de cada persona que vaya a probar a **Test users / Usuarios de prueba**.
5. En **Data Access / Acceso a datos**, añadir exclusivamente `https://www.googleapis.com/auth/drive.file`.
6. En **Clients / Clientes → Create client / Crear cliente**, elegir **Web application / Aplicación web**. Nombre: Guarda web. En **Authorized JavaScript origins / Orígenes autorizados de JavaScript** poner exactamente `https://guerrasur.github.io` (sin `/Guarda/`). El flujo usa una ventana emergente: no requiere URI de redirección.
7. Copiar el **Client ID / ID de cliente**, terminado en `.apps.googleusercontent.com`. No compartir el secreto ni descargarlo al repositorio.
8. Para probar, en Guarda → Configuración → Google Drive → Configurar conexión de la app, pegar el ID y guardar. Conectar desde un toque explícito. Abrir primero desde Safari si la ventana de Google no se abre desde el modo instalado.
9. Para publicar la misma configuración para todos los usuarios, poner ese ID público en `src/drive-config.js`, incrementar versión y desplegar. No hace falta que cada usuario cree su propio proyecto.

Antes de abrir la app al público, revisar los requisitos de Branding/verificación y cambiar Audience de pruebas a producción. En pruebas solo pueden autorizar los correos agregados. La página de privacidad está en https://guerrasur.github.io/Guarda/privacidad.html y la página principal en https://guerrasur.github.io/Guarda/.

## Uso

Cada persona toca Conectar Google Drive, elige **su propia cuenta** y acepta el permiso de los archivos de Guarda. Los datos consumen el almacenamiento de esa cuenta. Los límites de solicitudes de la API corresponden al proyecto de la aplicación. No se ha habilitado facturación desde la app.

Los tokens de acceso solo viven en memoria. Guarda intenta conservar el acceso vigente al recargar o actualizar mediante una copia temporal en la memoria del service worker. La nueva página la consume una sola vez y comprueba la cuenta con Google antes de sincronizar. La copia dura como máximo hasta el vencimiento del token y desaparece si el navegador termina el worker; no es una sesión permanente. No escribe tokens en IndexedDB, localStorage, sessionStorage, cachés ni copias de seguridad.

Si falta el acceso, la app prepara la librería de Google y, para una cuenta ya vinculada con correo conocido, intenta recuperarlo al hacer clic o tocar una zona libre del tablero. Se usa `prompt: 'none'`: Google no debe presentar pantallas de acceso o consentimiento; el navegador todavía puede abrir una ventana transitoria o bloquearla. Nunca se intenta mientras se edita, graba, reproduce o usa un diálogo. Si Google requiere confirmación, hay que tocar Reconectar Google Drive desde el perfil. Cancelar o fallar la autorización detiene los intentos automáticos de esa página hasta una reconexión correcta. La librería se vuelve a preparar después de un fallo de red.

Desconectar desactiva la recuperación automática y borra la copia en memoria; conserva las notas locales y los archivos remotos. El permiso también puede revocarse en la cuenta de Google. Se comprueba la cuenta antes de considerar utilizable el acceso y antes de sincronizar, para evitar mezclar las notas con otra cuenta. Usar otro perfil/navegador para una segunda cuenta.

Sincroniza tras cambios guardados (con una breve espera), cada minuto con la app visible, al volver y al recuperar conexión, siempre que haya sesión válida y no se esté editando, grabando o reproduciendo. Sin sesión/internet sigue el guardado local. Incluye notas, listas, etiquetas, orden, papelera y archivos. Apariencia y demás preferencias son propias de cada dispositivo.

## Datos y conflictos

Desde v0.7.14, la carpeta `GuardaNotes-<usuario>` (por ejemplo, `GuardaNotes-gebomandra`) contiene un JSON de estado por dispositivo y archivos multimedia individuales con su nombre y formato original. El JSON guarda texto, metadatos y referencias a los archivos, sin incrustar sus bytes. Editar texto actualiza el JSON; solo se sube un archivo multimedia cuando su contenido todavía no está en Drive. Los adjuntos idénticos comparten un archivo aunque pertenezcan a notas o dispositivos distintos. No se crea un JSON por cada edición.

La sincronización continúa leyendo los estados anteriores con adjuntos incrustados. Cada dispositivo migra su propio estado a la versión 2 en su siguiente sincronización, aunque no haya ediciones: primero confirma todos los adjuntos y después reemplaza el JSON. Una falla conserva el estado anterior y permite reintentar reutilizando archivos ya subidos. Actualizar Guarda en todos los dispositivos: las versiones anteriores rechazan de forma segura el formato nuevo. No se eliminan automáticamente adjuntos ni copias antiguas, porque otros dispositivos sin conexión o conflictos pueden necesitarlos.

Las descargas reutilizan los adjuntos locales verificados por huella incluso después de recargar la app. Los archivos que faltan se descargan con límites de tamaño y se comprueba su huella antes de aplicar cambios. Los backups exportados manualmente siguen siendo JSON completos y autocontenidos. El límite de restauración/sincronización continúa siendo 200 MB de datos codificados; este cambio reduce el tráfico de red, pero no elimina la preparación local de la copia completa.

Relojes vectoriales y marcadores de eliminación distinguen cambios posteriores de cambios concurrentes. Dos ediciones diferentes se conservan mediante notas con sufijo “(conflicto)”; no se mezcla automáticamente su texto. Ante edición concurrente con una eliminación definitiva, se conserva la edición. La aplicación comprueba una revisión transaccional local antes de aplicar descargas, de modo que una edición surgida durante la red no se reemplaza. Web Locks serializa los intentos entre pestañas del mismo navegador.

No editar manualmente los JSON internos. Borrar una nota definitivamente se propaga al sincronizar; otros dispositivos sin conexión y revisiones anteriores de Drive pueden conservar copias. Borrar la carpeta por fuera de Guarda no equivale a borrar las notas locales y estas podrían volver a subirse al conectar.

## Verificación pendiente

Las pruebas automatizadas simulan Drive/OAuth e IndexedDB y cubren sincronización entre dispositivos, conflictos con audio, eliminación, errores de red, cambios durante subidas, cuentas distintas, autorización cancelada, tokens vencidos y cargas reanudables. La autorización y transferencia real requieren el Client ID, habilitación de la API y una cuenta autorizada. No afirmar una prueba real ni de iPhone físico hasta completarla.

## Referencias oficiales

- https://developers.google.com/workspace/drive/api/quickstart/js
- https://developers.google.com/workspace/guides/configure-oauth-consent
- https://developers.google.com/identity/oauth2/web/guides/use-token-model
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/limits

Desde v0.6.1, una autorización sin respuesta vence a los 90 segundos y permite reintentar. Las respuestas tardías de intentos cancelados se ignoran. Si Google no carga, el botón permite reintentar la preparación y luego abrir la autorización desde un nuevo toque. Un `403 access_denied` de la pantalla de Google también requiere revisar Audience/usuarios de prueba del proyecto; la app no puede concederse ese permiso. Solo se recuerda información de vinculación, nunca tokens, y se excluye de las exportaciones.

La migración reutiliza y renombra la carpeta anterior marcada por Guarda, o utiliza la carpeta dedicada existente. Después de validar los estados y adjuntos, mueve a ella únicamente los archivos de sincronización creados por la app y pertenecientes a la cuenta actual. No elimina carpetas antiguas ni archivos ajenos. El panel de Drive muestra el nombre de la carpeta y permite abrirla cuando ya fue localizada.

Los intentos simultáneos comparten una sola sincronización. Las operaciones de edición posponen la aplicación de cambios hasta volver a un estado seguro, sin consultas continuas mientras se lee una nota. Al cerrar notas o diálogos y terminar la reproducción se reanuda el guardado. Los cortes de conexión y fallos temporales (incluidos los límites de solicitudes) conservan la sesión y reintentan con espera creciente; los errores de permisos y de cuota se muestran por separado. Los controles se actualizan al terminar una subida.

Si existen varias copias de estado del mismo dispositivo, se combinan con las mismas reglas de conflictos y se actualiza una copia canónica; las copias anteriores se conservan, sin bloquear la sincronización ni eliminar información.


## Continuidad entre versiones (v0.6.12)

La primera actualización desde v0.6.11 todavía necesita una reconexión: esa
versión anterior no implementa el traspaso. Después, las actualizaciones
controladas por Guarda intentan conservar el acceso temporal vigente. Una
recarga manual, cerrar la app, reiniciar el navegador o la terminación del
worker no garantizan la continuidad. Esto no extiende la duración del token ni
renueva permisos sin intervención.

Se usa `login_hint`, el parámetro documentado por Google, para sugerir la cuenta
vinculada. Las nuevas autorizaciones siguen iniciándose desde un toque explícito;
no se abren ventanas automáticamente al volver a la app. La preparación de la
librería comparte una sola promesa para evitar estados prematuros y duplicados.

Si la red falla después del consentimiento, se conserva el token en memoria
como identidad pendiente y se reintenta comprobar la cuenta sin volver a pedir
OAuth. Hasta comprobarla, no se suben ni descargan notas. Un 401 tardío de una
petición anterior no invalida una autorización más nueva. Los errores de permisos,
cuota, sesión y red mantienen tratamientos separados.

Las pruebas simulan el worker, el cambio de controlador, dos instancias de la
app, OAuth y la API. Comprueban actualización→traspaso→recarga→identificación→sync
sin un segundo popup, expiración/terminación del worker, aislamiento de cuentas,
consumo único y desconexión explícita. No acreditan una autorización real en
Safari ni la continuidad en un iPhone físico.

Una sesión duradera con renovación automática aun después de cerrar la app
requiere otra arquitectura: flujo de código con backend y refresh tokens
protegidos. No se incorporan secretos al frontend ni infraestructura de terceros.
Referencia: https://developers.google.com/identity/oauth2/web/guides/use-code-model


### Recuperación de sesión (0.6.15)

Se amplía el traspaso de v0.6.12 a las recargas normales y a los eventos de salida
u ocultamiento. El límite anterior de 60 segundos se reemplaza por el vencimiento
del propio token. Sigue siendo una recuperación de mejor esfuerzo: el navegador
puede terminar el worker en cualquier momento y una nueva pestaña no hereda
necesariamente su identificador.

La recuperación al iniciar se completa antes de permitir una nueva autorización.
Las respuestas de otra cuenta se rechazan antes de habilitar la sesión; un acceso
revocado se elimina del traspaso. La renovación automática usa consentimiento
existente y nunca cierra el diálogo que el usuario esté usando. La desconexión se
aplica antes de esperar a que el worker confirme la limpieza.

Las pruebas adicionales cubren esos casos, cancelación, confirmación requerida,
fallo inicial de Google, vuelta de internet y apertura de una nota durante OAuth.
Se simulan los eventos confiables: no prueban la activación de ventanas de Safari
ni un inicio de sesión real en iPhone. La expiración y la terminación del worker
se prueban por separado, comprobando que realmente se aceptó una sesión vigente.

La renovación permanente sin interacción requiere OAuth de servidor con acceso
offline y custodia de refresh tokens; GitHub Pages por sí solo no ofrece eso.
