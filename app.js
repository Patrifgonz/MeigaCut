/* ===================================================
   MeigaCut - Lógica principal
   ===================================================
   Aplicación para recortar stickers manualmente desde
   una lámina PNG. Funciona 100% en el navegador.
   =================================================== */

(function () {
    'use strict';

    /* ---------------------------------------------------
       Estado de la aplicación
       --------------------------------------------------- */
    const state = {
        image: null,            // HTMLImageElement cargada
        scale: 1,               // Escala imagen -> canvas displayed
        isDrawing: false,       // ¿Se está dibujando la selección?
        startX: 0,              // Coordenada X inicial (en píxeles de canvas)
        startY: 0,              // Coordenada Y inicial (en píxeles de canvas)
        currentSelection: null, // { x, y, w, h } en píxeles de canvas
        stickers: [],           // Array de stickers recortados
    };

    /* ---------------------------------------------------
       Referencias DOM
       --------------------------------------------------- */
    const $ = (id) => document.getElementById(id);

    const dom = {
        dropZone: $('dropZone'),
        fileInput: $('fileInput'),
        canvasContainer: $('canvasContainer'),
        canvas: $('canvas'),
        canvasWrapper: document.querySelector('.canvas-wrapper'),
        canvasArea: document.querySelector('.canvas-area'),
        selectionBox: $('selectionBox'),
        placeholder: $('placeholder'),
        newImageBtn: $('newImageBtn'),
        dimensionsInfo: $('dimensionsInfo'),
        selectionInfo: $('selectionInfo'),
        stickerList: $('stickerList'),
        stickerCount: $('stickerCount'),
        emptyState: $('emptyState'),
        downloadZipBtn: $('downloadZipBtn'),
        clearAllBtn: $('clearAllBtn'),
        toast: $('toast'),
    };

    const ctx = dom.canvas.getContext('2d');

    /* ---------------------------------------------------
       Notificaciones toast
       --------------------------------------------------- */
    let toastTimer = null;
    function showToast(message, type = '') {
        const t = dom.toast;
        t.textContent = message;
        t.className = 'toast show ' + type;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            t.className = 'toast hidden ' + type;
        }, 2400);
    }

    /* ---------------------------------------------------
       Carga de imagen (archivo o drag & drop)
       --------------------------------------------------- */
    function handleFile(file) {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast('Por favor, selecciona un archivo de imagen.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                state.image = img;
                renderImage();
                dom.dropZone.classList.add('hidden');
                dom.canvasContainer.classList.remove('hidden');
                dom.placeholder.classList.remove('hidden');
                updateDimensionsInfo();
                showToast('Imagen cargada correctamente', 'success');
            };
            img.onerror = () => showToast('Error al cargar la imagen.', 'error');
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // Eventos de selección de archivo
    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    });

    // Eventos drag & drop sobre la zona de drop
    ['dragenter', 'dragover'].forEach((ev) => {
        dom.dropZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.dropZone.classList.add('drag-over');
        });
    });

    ['dragleave', 'drop'].forEach((ev) => {
        dom.dropZone.addEventListener(ev, (e) => {
            e.preventDefault();
            e.stopPropagation();
            dom.dropZone.classList.remove('drag-over');
        });
    });

    dom.dropZone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        handleFile(file);
    });

    // Botón "Cargar otra imagen"
    dom.newImageBtn.addEventListener('click', () => {
        resetApp();
    });

    function resetApp() {
        state.image = null;
        state.currentSelection = null;
        ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
        dom.canvas.width = 0;
        dom.canvas.height = 0;
        hideSelection();
        dom.canvasContainer.classList.add('hidden');
        dom.dropZone.classList.remove('hidden');
        dom.fileInput.value = '';
        updateDimensionsInfo();
    }

    /* ---------------------------------------------------
       Renderizado de la imagen en el canvas
       ---------------------------------------------------
       Estrategia: el canvas tiene como tamaño interno las
       dimensiones originales de la imagen, y CSS lo escala
       para encajar en el contenedor. Esto preserva la
       transparencia y mantiene las coordenadas 1:1 con la
       imagen original.
       --------------------------------------------------- */
    function renderImage() {
        const img = state.image;
        dom.canvas.width = img.naturalWidth;
        dom.canvas.height = img.naturalHeight;
        ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
        ctx.drawImage(img, 0, 0);
        // Asegurar que el layout se ha aplicado antes de medir
        requestAnimationFrame(() => {
            updateScale();
            syncCanvasAreaSize();
        });
    }

    // Sincroniza el tamaño de .canvas-area con el del canvas,
    // para que las coordenadas CSS de la selección coincidan 1:1
    // con los píxeles del canvas, independientemente del centrado
    // o el aspect ratio.
    function syncCanvasAreaSize() {
        if (!dom.canvasArea) return;
        const rect = dom.canvas.getBoundingClientRect();
        dom.canvasArea.style.width = rect.width + 'px';
        dom.canvasArea.style.height = rect.height + 'px';
    }

    // Calcula la escala entre píxeles de canvas y píxeles CSS
    function updateScale() {
        if (dom.canvas.clientWidth === 0) {
            state.scale = 1;
            return;
        }
        state.scale = dom.canvas.width / dom.canvas.clientWidth;
    }

    function updateDimensionsInfo() {
        if (!state.image) {
            dom.dimensionsInfo.textContent = '-';
            return;
        }
        const w = state.image.naturalWidth;
        const h = state.image.naturalHeight;
        dom.dimensionsInfo.textContent = `Imagen: ${w} × ${h} px`;
    }

    /* ---------------------------------------------------
       Conversión de coordenadas
       ---------------------------------------------------
       event.offsetX / offsetY -> píxeles CSS dentro del canvas
       Multiplicamos por state.scale -> píxeles del canvas
       (que coinciden con píxeles de la imagen original)
       --------------------------------------------------- */
    function cssToCanvas(cssX, cssY) {
        return {
            x: cssX * state.scale,
            y: cssY * state.scale,
        };
    }

    function canvasToCss(cx, cy) {
        return {
            x: cx / state.scale,
            y: cy / state.scale,
        };
    }

    /* ---------------------------------------------------
       Gestión de la selección rectangular
       --------------------------------------------------- */
    function getCanvasPos(evt) {
        const rect = dom.canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top,
        };
    }

    function onMouseDown(e) {
        if (!state.image) return;
        e.preventDefault();
        updateScale();
        const pos = getCanvasPos(e);
        const canvasPos = cssToCanvas(pos.x, pos.y);
        state.isDrawing = true;
        state.startX = canvasPos.x;
        state.startY = canvasPos.y;
        state.currentSelection = { x: canvasPos.x, y: canvasPos.y, w: 0, h: 0 };
        showSelectionBox();
    }

    function onMouseMove(e) {
        if (!state.isDrawing) return;
        e.preventDefault();
        const pos = getCanvasPos(e);
        const canvasPos = cssToCanvas(pos.x, pos.y);

        // Normalizar: la selección puede ir en cualquier dirección
        const x = Math.min(state.startX, canvasPos.x);
        const y = Math.min(state.startY, canvasPos.y);
        const w = Math.abs(canvasPos.x - state.startX);
        const h = Math.abs(canvasPos.y - state.startY);

        state.currentSelection = { x, y, w, h };
        updateSelectionBox();
    }

    function onMouseUp(e) {
        if (!state.isDrawing) return;
        state.isDrawing = false;

        // Si la selección es demasiado pequeña, descartarla
        if (state.currentSelection.w < 4 || state.currentSelection.h < 4) {
            cancelSelection();
        }
    }

    /* ---------------------------------------------------
       Visualización de la caja de selección (overlay CSS)
       --------------------------------------------------- */
    function showSelectionBox() {
        dom.selectionBox.classList.remove('hidden');
        dom.placeholder.classList.add('hidden');
    }

    function hideSelection() {
        dom.selectionBox.classList.add('hidden');
        if (state.image) {
            dom.placeholder.classList.remove('hidden');
        }
    }

    function updateSelectionBox() {
        if (!state.currentSelection) return;
        const sel = state.currentSelection;
        const topLeft = canvasToCss(sel.x, sel.y);
        const w = sel.w / state.scale;
        const h = sel.h / state.scale;

        // Offset del canvas dentro de .canvas-area (por si el wrapper
        // no tiene exactamente el mismo tamaño que el canvas).
        let offX = 0;
        let offY = 0;
        if (dom.canvasArea) {
            const aRect = dom.canvasArea.getBoundingClientRect();
            const cRect = dom.canvas.getBoundingClientRect();
            offX = cRect.left - aRect.left;
            offY = cRect.top - aRect.top;
        }

        dom.selectionBox.style.left = (topLeft.x + offX) + 'px';
        dom.selectionBox.style.top = (topLeft.y + offY) + 'px';
        dom.selectionBox.style.width = w + 'px';
        dom.selectionBox.style.height = h + 'px';
        updateSelectionInfo();
    }

    function updateSelectionInfo() {
        if (!state.currentSelection || state.currentSelection.w === 0) {
            dom.selectionInfo.textContent = 'Sin selección';
            return;
        }
        const s = state.currentSelection;
        const w = Math.round(s.w);
        const h = Math.round(s.h);
        dom.selectionInfo.textContent = `Selección: ${w} × ${h} px`;
    }

    function cancelSelection() {
        state.isDrawing = false;
        state.currentSelection = null;
        hideSelection();
        updateSelectionInfo();
    }

    // Eventos de ratón en el canvas
    dom.canvas.addEventListener('mousedown', onMouseDown);
    dom.canvas.addEventListener('mousemove', onMouseMove);
    dom.canvas.addEventListener('mouseup', onMouseUp);
    dom.canvas.addEventListener('mouseleave', onMouseUp);

    // Recalcular escala al cambiar el tamaño de la ventana
    window.addEventListener('resize', () => {
        if (state.image) {
            updateScale();
            syncCanvasAreaSize();
            if (state.currentSelection) {
                updateSelectionBox();
            }
        }
    });

    /* ---------------------------------------------------
       Recortar la selección
       ---------------------------------------------------
       Crea un canvas temporal del tamaño exacto de la
       selección, dibuja la región desde el canvas principal
       y exporta a PNG (manteniendo transparencia).
       --------------------------------------------------- */
    function cropSelection() {
        if (!state.image || !state.currentSelection) {
            showToast('No hay selección activa', 'error');
            return;
        }

        const sel = state.currentSelection;
        const x = Math.max(0, Math.round(sel.x));
        const y = Math.max(0, Math.round(sel.y));
        const w = Math.min(
            Math.round(sel.w),
            dom.canvas.width - x
        );
        const h = Math.min(
            Math.round(sel.h),
            dom.canvas.height - y
        );

        if (w <= 0 || h <= 0) {
            showToast('Selección inválida', 'error');
            return;
        }

        // Canvas temporal con el recorte
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = w;
        tmpCanvas.height = h;
        const tmpCtx = tmpCanvas.getContext('2d');

        // Dibujar la región seleccionada desde el canvas principal.
        // Se transfiere la transparencia de forma nativa.
        tmpCtx.drawImage(
            dom.canvas,
            x, y, w, h,   // región fuente
            0, 0, w, h    // destino
        );

        tmpCanvas.toBlob((blob) => {
            if (!blob) {
                showToast('Error al generar el sticker', 'error');
                return;
            }
            const url = URL.createObjectURL(blob);
            const index = state.stickers.length + 1;
            const filename = `sticker_${String(index).padStart(3, '0')}.png`;

            state.stickers.push({
                id: Date.now() + Math.random(),
                filename,
                width: w,
                height: h,
                blob,
                url,
            });

            renderStickerList();
            cancelSelection();
            showToast(`Sticker ${filename} añadido`, 'success');
        }, 'image/png');
    }

    /* ---------------------------------------------------
       Teclado: Enter y Escape
       --------------------------------------------------- */
    document.addEventListener('keydown', (e) => {
        // Ignorar si el foco está en un input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            cropSelection();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelSelection();
        }
    });

    /* ---------------------------------------------------
       Renderizado de la lista de stickers
       --------------------------------------------------- */
    function renderStickerList() {
        dom.stickerList.innerHTML = '';
        dom.stickerCount.textContent = state.stickers.length;

        const hasStickers = state.stickers.length > 0;
        dom.emptyState.classList.toggle('hidden', hasStickers);
        dom.downloadZipBtn.disabled = !hasStickers;
        dom.clearAllBtn.disabled = !hasStickers;

        state.stickers.forEach((sticker) => {
            const li = document.createElement('li');
            li.className = 'sticker-item';
            li.innerHTML = `
                <img class="sticker-thumb" src="${sticker.url}" alt="${sticker.filename}" />
                <div class="sticker-info">
                    <div class="sticker-name">${sticker.filename}</div>
                    <div class="sticker-size">${sticker.width} × ${sticker.height} px</div>
                </div>
                <div class="sticker-actions">
                    <button class="icon-btn download" title="Descargar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </button>
                    <button class="icon-btn delete" title="Eliminar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                            <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                        </svg>
                    </button>
                </div>
            `;

            // Acciones de cada sticker
            li.querySelector('.download').addEventListener('click', () => {
                downloadSingleSticker(sticker);
            });
            li.querySelector('.delete').addEventListener('click', () => {
                removeSticker(sticker.id);
            });

            dom.stickerList.appendChild(li);
        });
    }

    function removeSticker(id) {
        const idx = state.stickers.findIndex((s) => s.id === id);
        if (idx === -1) return;
        URL.revokeObjectURL(state.stickers[idx].url);
        state.stickers.splice(idx, 1);
        // Renombrar para mantener la numeración correlativa
        state.stickers.forEach((s, i) => {
            s.filename = `sticker_${String(i + 1).padStart(3, '0')}.png`;
        });
        renderStickerList();
        showToast('Sticker eliminado', '');
    }

    function clearAllStickers() {
        if (state.stickers.length === 0) return;
        if (!confirm('¿Borrar todos los stickers?')) return;
        state.stickers.forEach((s) => URL.revokeObjectURL(s.url));
        state.stickers = [];
        renderStickerList();
        showToast('Lista vaciada', '');
    }

    dom.clearAllBtn.addEventListener('click', clearAllStickers);

    /* ---------------------------------------------------
       Descarga individual
       --------------------------------------------------- */
    function downloadSingleSticker(sticker) {
        const a = document.createElement('a');
        a.href = sticker.url;
        a.download = sticker.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    /* ---------------------------------------------------
       Descarga ZIP
       --------------------------------------------------- */
    dom.downloadZipBtn.addEventListener('click', async () => {
        if (state.stickers.length === 0) return;

        dom.downloadZipBtn.disabled = true;
        const originalText = dom.downloadZipBtn.textContent;
        dom.downloadZipBtn.textContent = 'Generando...';

        try {
            const zip = new JSZip();
            state.stickers.forEach((sticker) => {
                zip.file(sticker.filename, sticker.blob);
            });

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'stickers.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            showToast('ZIP descargado', 'success');
        } catch (err) {
            console.error(err);
            showToast('Error al generar el ZIP', 'error');
        } finally {
            dom.downloadZipBtn.textContent = originalText;
            dom.downloadZipBtn.disabled = false;
        }
    });

    /* ---------------------------------------------------
       Inicialización
       --------------------------------------------------- */
    renderStickerList();
})();
