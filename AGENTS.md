# Guarda

App estática PWA local con IndexedDB; publicar en GitHub Pages bajo /Guarda/. No implementar nube sin pedido. Mantener identidad del guardia y grabación de audio real, sin dictado.

## Actualizaciones obligatorias
Sistema adaptado de guerrasur/abridorsimuleitor/updater.js.
- Incrementar SemVer en src/version.js, package.json, package-lock.json y texto inicial de index.html en cada cambio publicado; un único commit para toda la versión.
- Mostrar versión en encabezado y conservar botón Actualizar. Comprobar version.json relativo con timestamp y cache:no-store al iniciar, cada 5 minutos, al volver a la app y al recuperar conexión.
- Actualizar automáticamente solo ante una versión mayor. Esperar a cerrar la nota, diálogos y finalizar grabación/reproducción. Esperar confirmación de los guardados antes de recargar.
- scripts/build.mjs genera version.json con huella y versiona todas las referencias de scripts/estilos. El service worker debe preparar todos los archivos y confirmar versión/huella antes de SKIP_WAITING. No mezclar versiones ni crear bucles ante CDN/despliegues parciales.
- Conservar IndexedDB, audios, notas, etiquetas y ajustes. No desregistrar workers ni borrar caches de otros proyectos.
- Verificar npm run check, npm test y npm run build. Confirmar despliegue de Pages antes de afirmar publicación; distinguir pruebas simuladas de iPhone físico.
