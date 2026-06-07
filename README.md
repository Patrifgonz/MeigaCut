# MeigaCut

Pequeña aplicación web para recortar stickers manualmente desde una lámina PNG. Funciona 100% en el navegador, sin backend.

## Características

- Carga de imagen PNG mediante **selector de archivo** o **arrastrar y soltar**.
- Selección rectangular con el ratón sobre un canvas.
- Recorte al pulsar **Enter**, cancelación con **Escape**.
- Vista previa de miniaturas en la barra lateral con descarga individual y borrado.
- Descarga de todos los recortes en un único **ZIP** (`sticker_001.png`, `sticker_002.png`, …).
- Conserva la **transparencia** original de la imagen.

## Uso

1. Carga una imagen PNG.
2. Pulsa y arrastra sobre la imagen para crear una selección rectangular.
3. Pulsa **Enter** para recortarla y añadirla a la lista.
4. Pulsa **Escape** si quieres cancelar la selección actual.
5. Cuando tengas todos los stickers, pulsa **Descargar ZIP**.

## Estructura del proyecto

```
MeigaCut/
├── index.html       # Estructura de la página
├── styles.css       # Estilos (tema oscuro)
├── app.js           # Lógica de la aplicación
├── jszip.min.js     # Librería ZIP (local, sin CDN)
└── README.md
```

## Cómo ejecutarla

No necesita build ni dependencias remotas. Basta con abrir `index.html` en cualquier navegador moderno.

Si prefieres servirla con un servidor local:

```bash
# Con Python 3
python -m http.server 8000

# Con Node
npx serve .
```

Y abre `http://localhost:8000` en el navegador.

## Detalles técnicos

- El canvas mantiene la resolución original de la imagen, así las coordenadas del recorte se corresponden 1:1 con los píxeles del archivo original.
- La selección se traduce entre píxeles del canvas y píxeles CSS mediante un factor de escala calculado en `updateScale()` y un offset calculado con `getBoundingClientRect()` para soportar cualquier aspect ratio.
- El recorte se hace en un canvas temporal con `drawImage()` y se exporta como blob PNG con `canvas.toBlob()`, lo que preserva el canal alfa.
- El ZIP se genera con JSZip (incluido localmente) a partir de los blobs en memoria.

## Atajos de teclado

| Tecla    | Acción                       |
|----------|------------------------------|
| `Enter`  | Recortar selección actual    |
| `Esc`    | Cancelar selección actual    |
