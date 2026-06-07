# MeigaCut

Pequeña aplicación web para recortar stickers desde una lámina PNG con dos modos: selección manual y malla configurable. Funciona 100% en el navegador, sin backend.

## Características

- Carga de imagen PNG mediante **selector de archivo** o **arrastrar y soltar**.
- **Modo manual**: selección rectangular con el ratón sobre un canvas, con handles de redimensionado (8 puntos) y repositionamiento.
- **Modo malla**: configurar filas, columnas y margen para dividir la imagen en celdas; arrastrar líneas interiores y esquinas para ajustar; clic en celdas para seleccionarlas.
- **Mover y redimensionar toda la malla**: arrastrar desde una celda para mover el rectángulo completo; 8 handles exteriores para redimensionar proporcionalmente.
- **Atajos de teclado**: `Enter` (recortar), `Escape` (cancelar), `Ctrl+A` (seleccionar todas las celdas en modo malla).
- Vista previa de miniaturas en la barra lateral con descarga individual y borrado.
- Descarga de todos los recortes en un único **ZIP** (`sticker_001.png`, `sticker_002.png`, …).
- Conserva la **transparencia** original de la imagen.
- Modal de confirmación reutilizable para acciones destructivas.

## Uso

### Modo manual
1. Carga una imagen PNG.
2. Pulsa el botón **Manual**.
3. Haz clic y arrastra sobre la imagen para crear una selección rectangular.
4. Usa los 8 handles para redimensionar, o arrastra desde dentro para reposicionar.
5. Pulsa **Enter** para recortar y añadir a la lista.

### Modo malla
1. Carga una imagen PNG.
2. Pulsa el botón **Malla** y configura filas, columnas y margen.
3. Arrastra las líneas interiores para ajustar la cuadrícula.
4. Arrastra las 4 esquinas exteriores para mover dos líneas a la vez.
5. Haz clic en una celda para seleccionarla (se resalta en morado).
6. Usa **Ctrl+A** o el botón **Todas** para seleccionar todas las celdas.
7. **Mover la malla**: haz clic en una celda sin líneas ni esquinas y arrastra.
8. **Redimensionar la malla**: usa los 8 handles del borde exterior.
9. Pulsa **Enter** para recortar las celdas seleccionadas.

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
- La malla se dibuja directamente sobre el canvas (sin overlay) para que las líneas no se incluyan en el PNG recortado.
- El redimensionado de la malla completa usa escalado proporcional: las líneas interiores mantienen su relación con los bordes.

## Atajos de teclado

| Tecla       | Acción                                          |
|-------------|-------------------------------------------------|
| `Enter`     | Recortar selección/celdas actuales              |
| `Esc`       | Cancelar selección actual                       |
| `Ctrl+A`    | Seleccionar todas las celdas (modo malla)       |
