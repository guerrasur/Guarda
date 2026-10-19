# Guarda
Guarda (Notes/Notas)

## Favicon

El icono aprobado del guardia con barba está en `public/favicon.svg`, recortado sin margen exterior y con esquinas transparentes. El SVG incorpora la imagen original en PNG, sin dependencias externas.

Al crear la app, incluir en `<head>`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
```

La ruta supone que `public/` se sirve desde la raíz. Ajustar el prefijo si se publica en una subcarpeta.
