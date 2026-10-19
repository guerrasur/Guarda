# Guarda

App web instalable de notas, listas y grabaciones de audio, inspirada en Google Keep. Identidad propia con el guardia medieval aprobado.

## Uso

Abrir la publicación de GitHub Pages del repositorio. En iPhone: Safari → Compartir → Agregar a inicio. En Chrome/Edge: menú → Instalar Guarda.

- Texto con formato, listas con casillas, imágenes y dibujos.
- Grabación real de audio dentro de la nota, con pausa, reproducción y descarga. No usa dictado ni transcripción.
- Búsqueda, filtros, etiquetas, colores, fondos, fijadas, archivo y papelera con restauración.
- Orden manual por arrastre; cada cambio de texto sube la nota al principio de su sección por defecto. Se desactiva desde Configuración → Subir notas actualizadas al principio.
- Apariencia clara, oscura o del dispositivo; vista de lista o cuadrícula.
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

20 pruebas automatizadas: persistencia tras reapertura, orden por edición y ajuste persistido, listas/archivo/restauración, sanitización, audio adjunto, MIME compatible, pausa/reanudación, fallos de permisos y almacenamiento, recuperación, backup con bytes originales y shell offline.

El entorno no dispuso del control de navegador de QA requerido para probar una previsualización local. La verificación automatizada usa un DOM simulado y IndexedDB simulado; la grabación/instalación en un iPhone físico queda pendiente de comprobar.

[Registro de observaciones de Keep y límites de REA](docs/keep-observaciones.md).
