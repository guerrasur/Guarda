# UI y movimiento · v0.6.11

Esta pasada conserva el guardia, los colores de las notas y todas las funciones
existentes. Toma como referencias la organización de Keep, la continuidad de
Material Motion y la atención a la lectura de Bear.

- Tarjetas y superficies con radios coherentes, sombras suaves y tipografía del
  sistema. Mejor jerarquía entre título, contenido, etiquetas y acciones.
- Apertura/cierre del editor con transiciones breves. En escritorio, el
  movimiento toma la posición de origen de la tarjeta. El editor móvil a
  pantalla completa usa fundido: transformar su contenedor desplaza las barras
  fijas y puede cambiar el lugar de los botones durante un toque.
- Reordenamiento FLIP del tablero, entrada de notas nuevas y salida visual al
  archivar/eliminar/filtrar. Las escrituras no esperan a las animaciones.
- Cambio de lista/cuadrícula, menús, avisos, selección, filtros, papelera de
  arrastre y botones con el mismo ritmo. No se agregan librerías ni peticiones.
- Límite de 40 tarjetas visibles y cuatro salidas simultáneas. Se cancelan las
  transiciones anteriores al encadenar acciones. No se animan tarjetas fuera de
  pantalla, pestañas ocultas ni dispositivos con movimiento reducido activado.
- El editor aísla el tablero y mantiene la navegación por Tab en sus controles.
  Recupera el foco en la tarjeta actual al cerrar, aunque se haya reconstruido
  el tablero. Abrir notas sigue sin enfocar campos que desplieguen el teclado.
- El cierre bloquea nuevas entradas mientras guarda; ante un error, mantiene
  texto y editor disponibles para reintentar.

## Referencias

- [Keep: organizar notas](https://support.google.com/keep/answer/6191044)
- [Material Motion](https://m3.material.io/styles/motion)
- [Material: transformar superficies](https://m1.material.io/motion/transforming-material.html)
- [Bear: opciones tipográficas](https://bear.app/faq/typography-options/)

## Verificación

`npm run check`, `npm test` y `npm run build`. Pruebas de cancelación, movimiento
reducido, límite de animaciones, salida sin elementos accesibles duplicados,
barra móvil estable, recuperación del foco y reintento de guardado.

Revisión manual en Chrome de escritorio y en un marco de 390 × 844 px: crear,
editar, colorear, fijar listas, archivar/deshacer, cambiar de vista y tema oscuro.
El servidor de QA usa HTTP, por lo que su copia local incluye únicamente un
adaptador de `crypto.randomUUID` para ese entorno; no se publica ese adaptador.
No equivale a una prueba en Safari/iPhone físico ni de OAuth real.

## v0.7.10 · gestos y continuidad

- Mantener 450 ms selecciona la nota con contorno, sin tic visible ni cambio
  de tamaño. Mover más de 12 px después de la pulsación inicia el arrastre y
  muestra la papelera. Un deslizamiento previo cancela la pulsación y permite scroll.
- Seleccionar y cancelar actualizan las mismas tarjetas, conservando sus
  controles y adjuntos. Espacio selecciona con teclado; Enter abre la nota.
- El listener que bloquea touchmove para arrastrar existe solo durante el gesto;
  no queda un bloqueo global de cada movimiento del dedo.
- Al abrir se conserva la posición del tablero y se bloquea el fondo. Volver
  restaura esa posición. La transición de cierre comienza mientras se guarda;
  un error devuelve el editor visible para reintentar sin perder contenido.
- En móvil se anima la capa completa, incluido su fondo, sin transformar las
  barras fijas. Apertura de 180 ms y cierre de 120 ms, con movimiento reducido.
- Las acciones de tarjeta se ocultan en dispositivos sin hover; siguen en el
  editor. La selección tiene su barra de acciones y no altera las listas.

Verificación: check, suite automatizada y build. Nuevas pruebas de selección
sin reemplazo de DOM, separación pulsación/arrastre, swipe sin selección,
cierre concurrente con guardado, restauración de scroll y cancelación de
fotogramas retenidos. No se verificó en iPhone físico ni se acreditó QA visual:
este entorno no dispone de binarios de navegador para Playwright.
