# Guarda

App estática PWA local con IndexedDB; publicar en GitHub Pages bajo /Guarda/. Drive está autorizado como integración opcional; no habilitar facturación ni otras nubes sin pedido. Mantener identidad del guardia y grabación de audio real, sin dictado.

## Actualizaciones obligatorias
Sistema adaptado de guerrasur/abridorsimuleitor/updater.js.
- Incrementar SemVer en src/version.js, package.json, package-lock.json y texto inicial de index.html en cada cambio publicado; un único commit para toda la versión.
- Mostrar versión en encabezado y conservar botón Actualizar. Comprobar version.json relativo con timestamp y cache:no-store al iniciar, cada 5 minutos, al volver a la app y al recuperar conexión.
- Actualizar automáticamente solo ante una versión mayor. Esperar a cerrar la nota, diálogos y finalizar grabación/reproducción. Esperar confirmación de los guardados antes de recargar.
- scripts/build.mjs genera version.json con huella y versiona todas las referencias de scripts/estilos. El service worker debe preparar todos los archivos y confirmar versión/huella antes de SKIP_WAITING. No mezclar versiones ni crear bucles ante CDN/despliegues parciales.
- Conservar IndexedDB, audios, notas, etiquetas y ajustes. No desregistrar workers ni borrar caches de otros proyectos.
- Verificar npm run check, npm test y npm run build. Confirmar despliegue de Pages antes de afirmar publicación; distinguir pruebas simuladas de iPhone físico.

## Drive
- OAuth con drive.file, tokens solo en memoria. Client ID público en src/drive-config.js; nunca guardar secretos.
- Estado local y cuenta vinculada no deben mezclarse con otras cuentas ni exportarse como configuración de otro dispositivo.
- Preservar relojes vectoriales, copias de conflictos y marcadores de eliminación. Validar archivos antes de modificarlos.
- Aplicar descargas solo si la revisión local no cambió durante la red; respetar editores/grabación y Web Locks.
- Las pruebas con OAuth/Drive simulado no acreditan autorización real; el Client ID de GuardaNote está configurado; la autorización real requiere una cuenta autorizada. Ver docs/google-drive.md.
