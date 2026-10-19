# Guarda

App web instalable de notas, listas y grabaciones de audio, inspirada en Google Keep. Identidad propia con el guardia medieval aprobado.

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

No hay cuenta, servidor de datos ni sincronización de nube. Cada navegador/dispositivo tiene sus propias notas. Borrar datos del navegador puede eliminarlas; exportar copias desde Configuración. La app solicita almacenamiento persistente cuando el navegador lo permite.

La captura del micrófono necesita HTTPS o localhost y permiso del usuario. Se prioriza audio/mp4 en Safari y se elige un formato compatible en otros navegadores. Al pasar la app al fondo, se intenta detener y guardar la grabación; los fragmentos ya persistidos se recuperan al reabrir. No se promete grabación continua con el iPhone bloqueado.

## Desarrollo y publicación

Requiere Node.js 22 o posterior.

```sh
npm ci
npm run check
npm test
npm run build
python3 -m http.server 8000 --directory dist
```

Abrir `http://localhost:8000`. En producción, publicar el contenido de `dist/` mediante HTTPS. Todas las rutas son relativas y funcionan bajo `/Guarda/`.

El workflow `.github/workflows/pages.yml` verifica, construye y publica en GitHub Pages al subir a `main`. La fuente de Pages debe ser **GitHub Actions**.

El código de aplicación no depende de bibliotecas externas ni carga fuentes o servicios de terceros. Las dependencias npm se utilizan solo en las pruebas.

## Verificación

36 pruebas automatizadas: persistencia tras reapertura, orden por edición y ajuste persistido, listas/archivo/restauración, sanitización, audio adjunto, MIME compatible, pausa/reanudación, fallos de permisos y almacenamiento, recuperación, backup con bytes originales y shell offline.

Se verificó la carga de la publicación de Pages en un navegador real. Las pruebas automatizadas usan un DOM simulado y IndexedDB simulado; la grabación/instalación en un iPhone físico queda pendiente de comprobar.

[Registro de observaciones de Keep y límites de REA](docs/keep-observaciones.md).

## Actualizaciones

Sistema adaptado de `guerrasur/abridorsimuleitor`. La versión aparece debajo del nombre Guarda y el botón **Actualizar** está al pie del tablero. Busca una versión mayor al abrir, cada cinco minutos, al volver a la app y al recuperar conexión. La actualización se aplica automáticamente cuando no hay nota, diálogo, grabación o reproducción en curso, después de confirmar los guardados de IndexedDB. No borra notas, audios ni ajustes.

El build genera `version.json` con SemVer y huella del contenido; versiona las referencias de módulos y estilos. El service worker prepara el shell completo antes de activarse y confirma versión/huella al actualizador. Las navegaciones usan ese shell coherente, incluso offline. Se bloquean recargas repetidas ante publicaciones parciales; el botón manual permite reintentar.

Para publicar cambios, aumentar `src/version.js`, `package.json`, `package-lock.json` y la versión inicial de `index.html` en el mismo commit. `npm run build` genera las referencias y metadatos de producción. No editar `dist/` a mano.

Al migrar desde una instalación anterior sin actualizador, puede ser necesario cerrar todas las ventanas y pestañas de Guarda y abrirla nuevamente una vez; no borrar los datos del sitio. Las versiones siguientes se actualizan automáticamente.
