# Activar Google Drive en Guarda

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

Los tokens de acceso solo viven en memoria. Al recargar o vencer la sesión puede ser necesario volver a tocar Conectar. Esto evita almacenar credenciales y funciona sin un backend para renovar sesiones. Desconectar deja las notas locales y los archivos remotos; el permiso también puede revocarse en la cuenta de Google. Se impide cambiar la cuenta vinculada a las notas locales para evitar mezclas: usar otro perfil/navegador para una segunda cuenta.

Sincroniza tras cambios guardados (con una breve espera), cada minuto con la app visible, al volver y al recuperar conexión, siempre que haya sesión válida y no se esté editando, grabando o reproduciendo. Sin sesión/internet sigue el guardado local. Incluye notas, listas, etiquetas, orden, papelera y archivos. Apariencia y demás preferencias son propias de cada dispositivo.

## Datos y conflictos

La carpeta Guarda contiene un archivo JSON de estado por dispositivo, con notas y adjuntos codificados. No se crea un archivo nuevo por cada edición. La primera versión prioriza conservar los datos y la recuperación: una actualización de estado incluye el contenido completo de ese dispositivo, por lo que el volumen transferido aumenta con los audios. Los archivos remotos que no cambiaron se reutilizan en memoria mientras la app está abierta. No es una biblioteca optimizada para grandes archivos multimedia.

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
