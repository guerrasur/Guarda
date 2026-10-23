# Guarda

App web instalable de notas, listas y grabaciones de audio, inspirada en Google Keep. Identidad propia con el guardia medieval aprobado.

v0.7.5: la conexión de Drive espera el resultado del servidor aunque el navegador
indique que la ventana de Google está cerrada por aislamiento. Se puede detener
una autorización pendiente desde «Desconectar este dispositivo»; se mantiene
el límite de diez minutos y se descartan respuestas posteriores a la cancelación.

v0.7.4: corrige la ventana about:blank al conectar Google Drive desde
una aplicación instalada en iPhone. La autorización se prepara con una prueba
de uso único y se abre directamente en el HTTPS del Worker en respuesta
al toque, sin navegar posteriormente una ventana vacía. No altera notas
locales ni sesiones anteriores.

v0.7.3: Guarda utiliza el servicio de conexión persistente con Drive en
Cloudflare Workers Free y D1. Incorpora renovación automática por dispositivo
sin guardar tokens renovables en el navegador. La nueva autorización pasa por una
navegación de primer nivel para verificar la cookie temporal, informa errores
del callback y espera el resultado aunque Google cierre el popup.
La publicación del Worker actualizado y la autorización real siguen pendientes
de verificación, y la aprobación de la marca en Google se gestiona por separado.
[Activación y arquitectura](server/README.md).

v0.6.15: recuperación temporal de Drive al recargar, renovación de consentimiento
existente al interactuar con el tablero y reintento tras fallos de conexión.
Respeta editores y diálogos, detiene intentos tras cancelar y verifica la cuenta
antes de habilitar el acceso. No garantiza una sesión permanente al cerrar iOS.

v0.6.14: los cambios de adjuntos recibidos desde otra pestaña esperan al cierre
del editor, conservando los archivos activos al fijar o recolorear una nota.

v0.6.13: tarjetas estables al editar o reordenar, adjuntos cargados por sección,
cursor conservado en listas, acciones múltiples reversibles y guardadas en una
sola transacción, y caché de adjuntos actualizada entre pestañas.

v0.6.12: continuidad temporal de Drive entre actualizaciones, reconexión con la
cuenta vinculada y recuperación de errores de red después de autorizar.
[Detalles de conexión](docs/google-drive.md).

v0.6.11: UI refinada, transiciones breves del editor y tablero, menús y botones
coherentes, foco conservado y soporte de movimiento reducido.
[Cambios visuales y validación](docs/ui-motion.md).

## Uso

Abrir la publicación de GitHub Pages del repositorio. En iPhone: Safari → Compartir → Agregar a inicio. En Chrome/Edge: menú → Instalar Guarda.

- Texto con formato, listas con casillas, imágenes y dibujos.
- Grabación real de audio dentro de la nota, con pausa, reproducción y descarga. No usa dictado ni transcripción.
- Búsqueda, filtros, etiquetas, colores, fondos, fijadas, archivo y papelera con restauración.
- Orden manual por arrastre: en celular, mantener pulsada la nota 450 ms y moverla; en computadora, arrastrarla con el mouse. El borde indica dónde quedará; al acercarse al borde de la pantalla, se desplaza la página. El gesto respeta las secciones Fijadas/Otras y guarda el orden localmente; cada cambio de texto sube la nota al principio de su sección por defecto. Se desactiva desde Configuración → Subir notas actualizadas al principio.
- Apariencia clara, oscura o del dispositivo; vista de lista o cuadrícula.
- Menú móvil debajo del encabezado completo y bloqueo de zoom por gestos, conservando el desplazamiento.
- Guardado automático en IndexedDB, audios como blobs y modo sin conexión mediante service worker.
- Copias de seguridad JSON completas con textos y archivos; restauración transaccional.
- Recordatorios dentro de la app mientras está abierta.

## Datos locales

El guardado local no requiere cuenta. La sincronización opcional usa el Drive de cada persona, sin servidor de datos propio. El ID público de OAuth de GuardaNote está configurado; mientras no se conecte una cuenta, cada navegador/dispositivo conserva sus propias notas. Borrar datos del navegador puede eliminarlas; exportar copias desde Configuración. La app solicita almacenamiento persistente cuando el navegador lo permite.

La captura del micrófono necesita HTTPS o localhost y permiso del usuario. Se prioriza audio/mp4 en Safari y se elige un formato compatible en otros navegadores. Al pasar la app al fondo, se intenta detener y guardar la grabación; los fragmentos ya persistidos se recuperan al reabrir. No se promete grabación continua con el iPhone bloqueado.

## Desarrollo y publicación

Requiere Node.js 22.13 o posterior.

```sh
npm ci
npm run check
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

Abrir `http://localhost:8000`. En producción, publicar el contenido de `dist/` mediante HTTPS. Todas las rutas son relativas y funcionan bajo `/Guarda/`.

El workflow `.github/workflows/pages.yml` verifica, construye y publica en GitHub Pages al subir a `main`. La fuente de Pages debe ser **GitHub Actions**.

El procesamiento local de ZIP usa una copia de fflate 0.8.2 incluida en la app (licencia MIT en src/vendor/fflate-LICENSE.txt); no se descarga código durante la importación. La conexión anterior carga Google Identity Services; el servicio persistente opcional usa el flujo de código de Google. Las dependencias npm son para desarrollo, pruebas y despliegue; no se cargan en la app.

## Verificación

Pruebas automatizadas de persistencia tras reapertura, orden por edición y ajuste persistido, listas/archivo/restauración, sanitización, audio adjunto, MIME compatible, pausa/reanudación, fallos de permisos y almacenamiento, recuperación, backup con bytes originales y shell offline. La conexión persistente agrega OAuth con Google simulado y SQLite real: renovación, revocación, aislamiento de cuentas, callback vinculado al navegador, concurrencia y desconexión sin red.

Se verificó la carga de la publicación de Pages en un navegador real. Las pruebas automatizadas usan un DOM simulado y IndexedDB simulado; la grabación/instalación en un iPhone físico queda pendiente de comprobar.

[Registro de observaciones de Keep y límites de REA](docs/keep-observaciones.md).

## Actualizaciones

Sistema adaptado de `guerrasur/abridorsimuleitor`. La versión aparece debajo del nombre Guarda y el botón **Actualizar** está al pie del tablero. Busca una versión mayor al abrir, cada cinco minutos, al volver a la app y al recuperar conexión. Una versión nueva muestra un cartel superior con el botón Actualizar. Se aplica cuando el usuario lo pulsa y no hay nota, diálogo, grabación o reproducción en curso, después de confirmar los guardados de IndexedDB. No borra notas, audios ni ajustes.

El build genera `version.json` con SemVer y huella del contenido; versiona las referencias de módulos y estilos. El service worker prepara el shell completo antes de activarse y confirma versión/huella al actualizador. Las navegaciones usan ese shell coherente, incluso offline. Se bloquean recargas repetidas ante publicaciones parciales; el botón manual permite reintentar.

Para publicar cambios, aumentar `src/version.js`, `package.json`, `package-lock.json` y la versión inicial de `index.html` en el mismo commit. `npm run build` genera las referencias y metadatos de producción. No editar `dist/` a mano.

Al migrar desde una instalación anterior sin actualizador, puede ser necesario cerrar todas las ventanas y pestañas de Guarda y abrirla nuevamente una vez; no borrar los datos del sitio. Las versiones siguientes avisan cuando hay una actualización disponible.

En v0.3.2 se corrigieron cierres simultáneos del editor, mensajes de error al deshacer y cancelación del arrastre al usar dos dedos, pasar al fondo o redibujarse el tablero. Al soltar se verifica la posición final del dedo/mouse.

## Google Drive (v0.4.0)

Conexión opcional desde Configuración → Google Drive. Implementa sincronización de notas, listas, etiquetas y archivos con la cuenta de cada usuario, conservación de conflictos y protección transaccional de ediciones locales. El ID público de OAuth de GuardaNote está incorporado desde v0.4.1. La primera autorización real debe completarse en Google desde Conectar Google Drive. Los tokens solo viven en memoria y puede ser necesario reconectar al reabrir la app o vencer la sesión. No se activan servicios pagos desde Guarda.

[Configuración y límites de Google Drive](docs/google-drive.md). [Privacidad](https://guerrasur.github.io/Guarda/privacidad.html).

## Importar Google Keep (v0.5.0)

Configuración → **Importar notas de Keep** abre el paso a paso de Google Takeout, con enlace y selección local de ZIP/JSON. Elegir solo Keep en Takeout, exportar una vez como ZIP y descargar la copia. No hace falta descomprimirla; si la exportación tiene varias partes, seleccionarlas juntas. También se admiten JSON sueltos y sus adjuntos.

La vista previa muestra notas, archivos, duplicados y adjuntos faltantes antes de confirmar. La importación es aditiva y transaccional: no reemplaza notas existentes, evita reimportar copias idénticas y conserva texto, listas/casillas, etiquetas, fechas, colores equivalentes, fijadas, archivo, imágenes/dibujos y audio. Los colaboradores y recordatorios no se transfieren. No hay sincronización continua con Keep. Una nota modificada en una nueva exportación se incorpora como copia; no sobrescribe la versión ya importada.

Máximo 100 MB de entrada por selección, 200 MB descomprimidos, 50 MB por adjunto y 8 MB por JSON. Las exportaciones mayores deben dividirse. No se ejecuta el HTML de Takeout ni se descargan adjuntos desde URLs. Si Drive está conectado, las notas se sincronizan como las demás notas de Guarda.

Referencias: https://support.google.com/keep/answer/10017039 y https://support.google.com/accounts/answer/3024190. La compatibilidad se probó con fixtures ZIP/JSON representativos; un archivo real del usuario puede revelar variantes adicionales del formato.

## Seguridad y operación

La versión 0.7.9 incorpora límites sin contadores en D1, pausas de reintento, mantenimiento y pruebas en workerd. Ver [límites, auditoría y operación](docs/security.md).

### Modo cuaderno (v0.9.0)

Desde el menú izquierdo, **Modo cuaderno** abre el último cuaderno y su última
hoja visitada. La estantería permite crear otros con título y 25, 50 o 100 hojas.
El formato principal tiene **40 letras por renglón y 400 caracteres por hoja**;
también se ofrecen renglones de 35 letras y 350 caracteres. El formato no cambia
según el dispositivo. Los cuadernos anteriores de 200/250 caracteres se amplían
a 400 al abrirlos, conservando todas las hojas, su contenido y sus tachados.

La barra inferior ofrece lectura/desplazamiento, escritura y tachado mediante
iconos. En lectura, arrastrar horizontalmente mueve la hoja y permite pasar a
la siguiente o anterior; los movimientos verticales desplazan la hoja cuando
el área visible resulta pequeña. Las flechas permiten la misma navegación sin
gestos. Tocar el número de página abre las miniaturas y el salto a cualquier hoja.
La ayuda está disponible bajo su icono, sin explicaciones permanentes en la hoja.
Las animaciones respetan la preferencia de movimiento reducido.

El lápiz abre el teclado y continúa al final. Borrar, cortar o reemplazar una
selección **tacha el texto original** y conserva su espacio; lo nuevo siempre
se agrega al final sin desplazar tinta anterior. La marca verde indica dónde
continúa la escritura, y el cursor rojo, dónde se está tachando. Un pegado que
excede el espacio disponible se rechaza completo con un aviso.

La hoja sigue la altura y los desplazamientos de la pantalla visible cuando
iOS abre el teclado; el fondo queda bloqueado y recupera su posición al salir.
Se conserva IndexedDB, recuperación local inmediata, exportación/importación
y sincronización opcional de Drive. Las descargas y actualizaciones de la app
esperan a cerrar el cuaderno; las subidas pueden realizarse tras la pausa habitual.
Las pruebas automatizadas no sustituyen una comprobación en un iPhone físico.
