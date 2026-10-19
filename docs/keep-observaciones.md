# Reconstrucción de Guarda: referencia y límites

Fecha: 2026-10-19. Objetivo: interfaz y funciones locales de Google Keep, con marca Guarda y grabación de audio en vez de dictado. No se reconstruye su nube.

## Observado directamente en el navegador

La URL solicitada `/u/1/` redirigió al inicio de sesión y, después de autenticarse, a `/u/0/`. Se inspeccionó la interfaz y un editor vacío; no se copiaron notas personales.

- Cabecera con menú, marca, búsqueda, vista de lista y configuración.
- Barra lateral: Notas, Recordatorios, Editar etiquetas, Archivo y Papelera.
- Campo central “Crear una nota…”, nueva lista, dibujo e imagen.
- Editor con título, texto, fijado, formato, fondo, recordatorio, imagen y menú Más.
- Menú Más del editor vacío: etiqueta, dibujo y casillas de verificación.
- Paleta observada: Predeterminado, Coral, Durazno, Arena, Menta, Verde salvia, Gris niebla, Tormenta, Atardecer, Flores, Arcilla y Pizarra.
- Fondos temáticos y selector de tema oscuro en configuración.

Estas son observaciones de UI, no evidencia de cómo funciona su implementación interna ni de paridad completa de funciones.

## Ejecución de la skill REA

Se leyó la skill `reverse-engineer-anything` del checkout local de `morluto/rea`. No había herramientas MCP de REA conectadas, por lo que se probó el CLI oficial `rea-agents@6.7.0`.

`doctor --client codex --json` falló: el entorno Linux no pudo ejecutar la consulta de propiedad de procesos mediante `ps` (`fatal library error, lookup self`).

Se identificó desde el DOM el recurso público servido por Keep y se descargó una copia para análisis estático fuera del repositorio. El análisis `analyze-javascript-application` avanzó hasta el inventario y falló al iniciar el proceso de análisis por el mismo problema de `ps`.

Evidencia parcial de REA: `ev_a92c6356df7ae3bb0882088c797d06ba1af61ce22f7d169b3bc4a7b99e753111`.

SHA-256 del directorio inventariado: `458f4670b8ba2939741affd92ccc9e7b1a23570792369e96b2ebe927a4ad399a`.

La evidencia parcial acredita inventario e identidad del artefacto, no el análisis de su lógica. No se afirma que REA haya descompilado Keep ni que haya observado interacciones de navegador. Las observaciones de UI anteriores se obtuvieron con el navegador disponible.

No se distribuye código de Google, cookies, credenciales ni capturas de notas privadas en este repositorio.

## Implementación propia y diferencias

- Interfaz propia en HTML/CSS/JavaScript, con iconos de trazo originales y el logo aprobado.
- Grabaciones mediante MediaRecorder, blobs de audio, pausa, reproducción y descarga.
- IndexedDB local; PWA y shell sin conexión; ningún servicio de sincronización.
- Fondos locales simplificados (papel, puntos y música), no los recursos gráficos originales de Google.
- Sin colaboradores, importación automática de Keep, historial de versiones de nube ni avisos con la app cerrada.
- Papelera conservada hasta su vaciado explícito, sin borrado automático a los siete días.
- Orden por actualización activado por defecto, con ajuste para desactivarlo; las fijadas conservan su sección.

## Estado de las preguntas

| Pregunta | Estado |
| --- | --- |
| Estructura visual principal y editor | Observada; reconstruida |
| Inventario del bundle mediante REA | Parcial |
| Lógica interna del bundle | No resuelta por limitación de proceso Linux |
| Texto/listas/adjuntos locales | Implementados y probados automáticamente |
| Audio grabado en vez de dictado | Implementado; probado con MediaRecorder simulado |
| Instalación y micrófono en iPhone real | Pendiente de prueba en dispositivo |
| Nube y sincronización | Fuera del alcance solicitado |
