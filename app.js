/* ===================================================
   MeigaCut - Lógica principal
   ===================================================
   Aplicación para recortar stickers manualmente desde
   una lámina PNG. Funciona 100% en el navegador.

   Dos modos de recorte:
     - Manual: clic + arrastrar para crear una selección.
     - Malla:  rejilla configurable con líneas arrastrables;
               clic en celda para seleccionarla y Enter
               para recortar todas las celdas marcadas.
   =================================================== */

(function () {
    'use strict';

    /* ---------------------------------------------------
       Estado de la aplicación
       --------------------------------------------------- */
    const MIN_CELL_PX = 8;            // Separación mínima entre líneas (píxeles canvas)
    const LINE_HIT_PX = 7;            // Radio de detección de línea en píxeles CSS

    const state = {
        image: null,                  // HTMLImageElement cargada
        scale: 1,                     // Escala canvas -> CSS
        isDrawing: false,             // ¿Se está dibujando la selección manual?
        startX: 0,                    // Coordenada X inicial (canvas px)
        startY: 0,                    // Coordenada Y inicial (canvas px)
        currentSelection: null,       // { x, y, w, h } en píxeles de canvas (modo manual)
        stickers: [],                 // Array de stickers recortados

        // Modo de recorte: 'manual' o 'grid'
        mode: 'manual',

        // Malla
        grid: null,                   // { rows, cols, margin, h: [], v: [] } (h/v en px canvas)
        selectedCells: new Set(),     // Set de strings "row,col" con celdas marcadas
        hoveringLine: null,           // { type: 'h'|'v', index } para feedback de cursor
        isDraggingLine: false,        // ¿Se está arrastrando una línea?
        dragOffset: 0,                // Offset (canvas px) entre la línea y el cursor al iniciar el drag
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
        placeholderText: $('placeholderText'),
        newImageBtn: $('newImageBtn'),
        dimensionsInfo: $('dimensionsInfo'),
        selectionInfo: $('selectionInfo'),
        stickerList: $('stickerList'),
        stickerCount: $('stickerCount'),
        emptyState: $('emptyState'),
        downloadZipBtn: $('downloadZipBtn'),
        clearAllBtn: $('clearAllBtn'),
        toast: $('toast'),
        // Modos
        manualModeBtn: $('manualModeBtn'),
        gridModeBtn: $('gridModeBtn'),
        hintManual: $('hintManual'),
        hintGrid: $('hintGrid'),
        hintSelectAll: $('hintSelectAll'),
        selectAllCellsBtn: $('selectAllCellsBtn'),
        // Modal de malla
        gridModal: $('gridModal'),
        gridRows: $('gridRows'),
        gridCols: $('gridCols'),
        gridMargin: $('gridMargin'),
        applyGridBtn: $('applyGridBtn'),
        cancelGridBtn: $('cancelGridBtn'),
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
                // Al cargar imagen nueva, descartamos la malla y volvemos a manual
                clearGrid();
                setMode('manual');
                updateDimensionsInfo();
                showToast('Imagen cargada correctamente', 'success');
            };
            img.onerror = () => showToast('Error al cargar la imagen.', 'error');
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
            handleFile(e.target.files[0]);
        }
    });

    // Drag & drop sobre la zona de drop
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

    dom.newImageBtn.addEventListener('click', resetApp);

    function resetApp() {
        state.image = null;
        state.currentSelection = null;
        clearGrid();
        ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
        dom.canvas.width = 0;
        dom.canvas.height = 0;
        hideSelection();
        dom.canvasContainer.classList.add('hidden');
        dom.dropZone.classList.remove('hidden');
        dom.fileInput.value = '';
        updateDimensionsInfo();
        updateSelectionInfo();
    }

    /* ---------------------------------------------------
       Renderizado del canvas
       ---------------------------------------------------
       El canvas siempre tiene las dimensiones originales
       de la imagen. El grid (si está activo) se dibuja
       encima de la imagen. La selección manual se gestiona
       con un overlay DOM para no contaminar el canvas.
       --------------------------------------------------- */
    function renderImage() {
        const img = state.image;
        dom.canvas.width = img.naturalWidth;
        dom.canvas.height = img.naturalHeight;
        requestAnimationFrame(() => {
            updateScale();
            syncCanvasAreaSize();
            redraw();
        });
    }

    // Repinta el canvas: primero la imagen, después la malla
    function redraw() {
        if (!state.image) return;
        ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
        ctx.drawImage(state.image, 0, 0);
        if (state.mode === 'grid' && state.grid) {
            drawGrid();
        }
    }

    // Sincroniza el tamaño de .canvas-area con el del canvas
    function syncCanvasAreaSize() {
        if (!dom.canvasArea) return;
        const rect = dom.canvas.getBoundingClientRect();
        dom.canvasArea.style.width = rect.width + 'px';
        dom.canvasArea.style.height = rect.height + 'px';
    }

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
       Conversión de coordenadas (CSS px <-> canvas px)
       --------------------------------------------------- */
    function getCanvasPos(evt) {
        const rect = dom.canvas.getBoundingClientRect();
        return {
            x: evt.clientX - rect.left,
            y: evt.clientY - rect.top,
        };
    }

    /* ---------------------------------------------------
       Cambio de modo
       --------------------------------------------------- */
    function setMode(mode) {
        state.mode = mode;

        // Actualizar UI de los botones
        dom.manualModeBtn.classList.toggle('active', mode === 'manual');
        dom.gridModeBtn.classList.toggle('active', mode === 'grid');

        // Mostrar/ocultar hints
        dom.hintManual.style.display = mode === 'manual' ? '' : 'none';
        dom.hintGrid.style.display = mode === 'grid' ? '' : 'none';

        // Botón "Todas" y su hint solo en modo malla con grid activa
        const showGridControls = mode === 'grid' && state.grid;
        dom.selectAllCellsBtn.style.display = showGridControls ? '' : 'none';
        dom.hintSelectAll.style.display = showGridControls ? '' : 'none';

        // Ajustes del canvas-wrapper según el modo
        if (mode === 'manual') {
            dom.canvas.style.cursor = 'crosshair';
            hideSelection();
            dom.placeholderText.textContent = 'Haz clic y arrastra sobre la imagen para crear una selección';
            // Al volver a manual desde grid, no reseteamos state.grid;
            // se mantiene por si el usuario quiere volver al mismo grid.
        } else {
            dom.canvas.style.cursor = 'default';
            hideSelection();
            if (state.grid) {
                dom.placeholderText.textContent = 'Malla activa. Arrastra las líneas para ajustar. Clic en celda para seleccionarla.';
                dom.placeholder.classList.add('hidden');
            } else {
                dom.placeholderText.textContent = 'Pulsa el botón Malla y configura filas/columnas para empezar.';
                dom.placeholder.classList.remove('hidden');
            }
        }

        updateSelectionInfo();
        redraw();
    }

    dom.manualModeBtn.addEventListener('click', () => {
        cancelSelection();
        setMode('manual');
    });

    dom.gridModeBtn.addEventListener('click', () => {
        if (!state.image) {
            showToast('Carga primero una imagen', 'error');
            return;
        }
        showGridModal();
    });

    /* ---------------------------------------------------
       Modal de configuración de malla
       --------------------------------------------------- */
    function showGridModal() {
        dom.gridRows.value = dom.gridRows.value || 3;
        dom.gridCols.value = dom.gridCols.value || 3;
        dom.gridMargin.value = dom.gridMargin.value || 20;
        dom.gridModal.classList.remove('hidden');
        setTimeout(() => dom.gridRows.focus(), 50);
    }

    function hideGridModal() {
        dom.gridModal.classList.add('hidden');
    }

    // Cerrar al pulsar backdrop o botones con data-close
    dom.gridModal.addEventListener('click', (e) => {
        if (e.target.dataset.close !== undefined) hideGridModal();
    });

    dom.cancelGridBtn.addEventListener('click', hideGridModal);

    dom.applyGridBtn.addEventListener('click', applyGridConfig);

    function applyGridConfig() {
        const rows = parseInt(dom.gridRows.value, 10);
        const cols = parseInt(dom.gridCols.value, 10);
        const margin = Math.max(0, parseInt(dom.gridMargin.value, 10) || 0);

        if (!Number.isFinite(rows) || rows < 1 || rows > 50) {
            showToast('Filas debe estar entre 1 y 50', 'error');
            return;
        }
        if (!Number.isFinite(cols) || cols < 1 || cols > 50) {
            showToast('Columnas debe estar entre 1 y 50', 'error');
            return;
        }

        buildGrid(rows, cols, margin);
        state.selectedCells.clear();
        hideGridModal();
        setMode('grid');
        showToast(`Malla ${rows}×${cols} creada`, 'success');
    }

    function buildGrid(rows, cols, margin) {
        const W = dom.canvas.width;
        const H = dom.canvas.height;
        const cellW = (W - 2 * margin) / cols;
        const cellH = (H - 2 * margin) / rows;

        const h = [];
        const v = [];
        for (let i = 0; i <= rows; i++) h.push(Math.round(margin + i * cellH));
        for (let j = 0; j <= cols; j++) v.push(Math.round(margin + j * cellW));

        state.grid = { rows, cols, margin, h, v };
    }

    function clearGrid() {
        state.grid = null;
        state.selectedCells.clear();
        state.hoveringLine = null;
        state.isDraggingLine = false;
    }

    // Marca todas las celdas de la malla actual
    function selectAllCells() {
        if (state.mode !== 'grid' || !state.grid) return;
        const { rows, cols } = state.grid;
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                state.selectedCells.add(`${i},${j}`);
            }
        }
        redraw();
        updateSelectionInfo();
    }

    dom.selectAllCellsBtn.addEventListener('click', selectAllCells);

    /* ---------------------------------------------------
       Dibujo de la malla sobre el canvas
       --------------------------------------------------- */
    function drawGrid() {
        const { h, v, rows, cols } = state.grid;

        // 1) Resaltar celdas seleccionadas
        ctx.save();
        ctx.fillStyle = 'rgba(124, 92, 255, 0.28)';
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                if (state.selectedCells.has(`${i},${j}`)) {
                    ctx.fillRect(v[j], h[i], v[j + 1] - v[j], h[i + 1] - h[i]);
                }
            }
        }
        ctx.restore();

        // 2) Dibujar líneas
        const lw = Math.max(1, Math.round(state.scale));   // 1 línea CSS px
        ctx.save();
        ctx.lineWidth = lw;
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 3;

        for (let i = 1; i < h.length - 1; i++) {
            ctx.beginPath();
            ctx.moveTo(0, h[i]);
            ctx.lineTo(dom.canvas.width, h[i]);
            ctx.stroke();
        }
        for (let j = 1; j < v.length - 1; j++) {
            ctx.beginPath();
            ctx.moveTo(v[j], 0);
            ctx.lineTo(v[j], dom.canvas.height);
            ctx.stroke();
        }
        ctx.restore();

        // 3) Dibujar marco exterior de la malla
        ctx.save();
        ctx.lineWidth = lw * 2;
        ctx.strokeStyle = 'rgba(124, 92, 255, 0.95)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
        ctx.shadowBlur = 4;
        const x0 = v[0];
        const y0 = h[0];
        const x1 = v[v.length - 1];
        const y1 = h[h.length - 1];
        ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        ctx.restore();

        // 4) Etiquetas de celda (escala según state.scale)
        ctx.save();
        const fontPx = Math.max(11, Math.round(16 * Math.min(1, state.scale / 2)));
        ctx.font = `bold ${fontPx}px -apple-system, "Segoe UI", Roboto, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 3;

        let n = 1;
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const cx = (v[j] + v[j + 1]) / 2;
                const cy = (h[i] + h[i + 1]) / 2;
                const label = String(n++);
                // Fondo del número para legibilidad
                const w = ctx.measureText(label).width;
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.fillRect(cx - w / 2 - 4, cy - fontPx / 2 - 2, w + 8, fontPx + 4);
                ctx.fillStyle = 'rgba(255,255,255,0.95)';
                ctx.fillText(label, cx, cy + 1);
            }
        }
        ctx.restore();
    }

    /* ---------------------------------------------------
       Detección de línea y celda bajo el cursor
       --------------------------------------------------- */
    function findLineAt(canvasX, canvasY) {
        // Devuelve { type, index } si el punto está cerca de una línea, si no null.
        // Los bordes exteriores también se pueden arrastrar.
        const { h, v } = state.grid;
        const tol = LINE_HIT_PX * state.scale; // tolerancia en píxeles canvas

        for (let i = 0; i < h.length; i++) {
            if (Math.abs(canvasY - h[i]) <= tol) return { type: 'h', index: i };
        }
        for (let j = 0; j < v.length; j++) {
            if (Math.abs(canvasX - v[j]) <= tol) return { type: 'v', index: j };
        }
        return null;
    }

    function getCellAt(canvasX, canvasY) {
        // Devuelve {row, col} o null si está fuera de la malla
        const { h, v, rows, cols } = state.grid;
        if (canvasX < v[0] || canvasX > v[cols] || canvasY < h[0] || canvasY > h[rows]) {
            return null;
        }
        // Buscar fila
        let row = 0;
        for (let i = 0; i < rows; i++) {
            if (canvasY >= h[i] && canvasY <= h[i + 1]) { row = i; break; }
        }
        let col = 0;
        for (let j = 0; j < cols; j++) {
            if (canvasX >= v[j] && canvasX <= v[j + 1]) { col = j; break; }
        }
        return { row, col };
    }

    /* ---------------------------------------------------
       Eventos de ratón (despachan según modo)
       --------------------------------------------------- */
    dom.canvas.addEventListener('mousedown', (e) => {
        if (!state.image) return;
        e.preventDefault();
        updateScale();
        syncCanvasAreaSize();

        if (state.mode === 'manual') {
            onManualMouseDown(e);
        } else if (state.mode === 'grid' && state.grid) {
            onGridMouseDown(e);
        }
    });

    dom.canvas.addEventListener('mousemove', (e) => {
        if (!state.image) return;
        e.preventDefault();

        if (state.mode === 'manual') {
            onManualMouseMove(e);
        } else if (state.mode === 'grid' && state.grid) {
            onGridMouseMove(e);
        }
    });

    dom.canvas.addEventListener('mouseup', (e) => {
        if (state.mode === 'manual') onManualMouseUp(e);
        else if (state.mode === 'grid') onGridMouseUp(e);
    });

    dom.canvas.addEventListener('mouseleave', (e) => {
        if (state.mode === 'manual') onManualMouseUp(e);
        else if (state.mode === 'grid') onGridMouseUp(e);
        // Limpiar feedback de línea al salir
        if (state.hoveringLine && !state.isDraggingLine) {
            state.hoveringLine = null;
            dom.canvas.style.cursor = state.mode === 'grid' ? 'default' : 'crosshair';
        }
    });

    /* ----- Modo manual ----- */
    function onManualMouseDown(e) {
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        state.isDrawing = true;
        state.startX = cp.x;
        state.startY = cp.y;
        state.currentSelection = { x: cp.x, y: cp.y, w: 0, h: 0 };
        showSelectionBox();
    }

    function onManualMouseMove(e) {
        if (!state.isDrawing) return;
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        const x = Math.min(state.startX, cp.x);
        const y = Math.min(state.startY, cp.y);
        const w = Math.abs(cp.x - state.startX);
        const h = Math.abs(cp.y - state.startY);
        state.currentSelection = { x, y, w, h };
        updateSelectionBox();
    }

    function onManualMouseUp() {
        if (!state.isDrawing) return;
        state.isDrawing = false;
        if (state.currentSelection.w < 4 || state.currentSelection.h < 4) {
            cancelSelection();
        }
    }

    function cssToCanvas(cssX, cssY) {
        return { x: cssX * state.scale, y: cssY * state.scale };
    }

    function canvasToCss(cx, cy) {
        return { x: cx / state.scale, y: cy / state.scale };
    }

    /* ----- Modo malla ----- */
    function onGridMouseDown(e) {
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        const line = findLineAt(cp.x, cp.y);

        if (line) {
            // Iniciar drag de la línea
            state.isDraggingLine = true;
            const arr = line.type === 'h' ? state.grid.h : state.grid.v;
            const coord = line.type === 'h' ? cp.y : cp.x;
            state.dragOffset = coord - arr[line.index];
            state.hoveringLine = line; // también por si el primer mousemove aún no se disparó
            dom.canvas.style.cursor = line.type === 'h' ? 'ns-resize' : 'ew-resize';
        } else {
            // Click en celda: alternar selección
            const cell = getCellAt(cp.x, cp.y);
            if (cell) {
                const key = `${cell.row},${cell.col}`;
                if (state.selectedCells.has(key)) state.selectedCells.delete(key);
                else state.selectedCells.add(key);
                redraw();
                updateSelectionInfo();
            }
        }
    }

    function onGridMouseMove(e) {
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);

        if (state.isDraggingLine) {
            dragLine(cp);
            return;
        }

        // Feedback de cursor al pasar por una línea
        const line = findLineAt(cp.x, cp.y);
        if ((line && !state.hoveringLine) || (!line && state.hoveringLine) ||
            (line && state.hoveringLine && (line.type !== state.hoveringLine.type || line.index !== state.hoveringLine.index))) {
            state.hoveringLine = line;
            dom.canvas.style.cursor = line
                ? (line.type === 'h' ? 'ns-resize' : 'ew-resize')
                : 'default';
        }
    }

    function onGridMouseUp() {
        if (state.isDraggingLine) {
            state.isDraggingLine = false;
            state.dragOffset = 0;
            dom.canvas.style.cursor = state.hoveringLine
                ? (state.hoveringLine.type === 'h' ? 'ns-resize' : 'ew-resize')
                : 'default';
        }
    }

    // Mueve la línea que se está arrastrando, respetando los vecinos
    // y el tamaño mínimo de celda.
    function dragLine(cp) {
        const { h, v } = state.grid;
        if (state.hoveringLine.type === 'h') {
            const i = state.hoveringLine.index;
            const minY = (i > 0 ? h[i - 1] : 0) + MIN_CELL_PX;
            const maxY = (i < h.length - 1 ? h[i + 1] : dom.canvas.height) - MIN_CELL_PX;
            h[i] = Math.max(minY, Math.min(maxY, cp.y - state.dragOffset));
        } else {
            const j = state.hoveringLine.index;
            const minX = (j > 0 ? v[j - 1] : 0) + MIN_CELL_PX;
            const maxX = (j < v.length - 1 ? v[j + 1] : dom.canvas.width) - MIN_CELL_PX;
            v[j] = Math.max(minX, Math.min(maxX, cp.x - state.dragOffset));
        }
        redraw();
        updateSelectionInfo();
    }

    /* ---------------------------------------------------
       Visualización de la caja de selección (modo manual)
       --------------------------------------------------- */
    function showSelectionBox() {
        dom.selectionBox.classList.remove('hidden');
        dom.placeholder.classList.add('hidden');
    }

    function hideSelection() {
        dom.selectionBox.classList.add('hidden');
        if (state.image && state.mode === 'manual') {
            dom.placeholder.classList.remove('hidden');
        }
    }

    function updateSelectionBox() {
        if (!state.currentSelection) return;
        const sel = state.currentSelection;
        const topLeft = canvasToCss(sel.x, sel.y);
        const w = sel.w / state.scale;
        const h = sel.h / state.scale;

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
        if (state.mode === 'manual') {
            if (!state.currentSelection || state.currentSelection.w === 0) {
                dom.selectionInfo.textContent = 'Sin selección';
                return;
            }
            const s = state.currentSelection;
            const w = Math.round(s.w);
            const h = Math.round(s.h);
            dom.selectionInfo.textContent = `Selección: ${w} × ${h} px`;
        } else if (state.mode === 'grid') {
            if (!state.grid) {
                dom.selectionInfo.textContent = 'Malla no configurada';
                return;
            }
            const total = state.grid.rows * state.grid.cols;
            const sel = state.selectedCells.size;
            dom.selectionInfo.textContent = `Malla ${state.grid.rows}×${state.grid.cols} · ${sel}/${total} celdas`;
        }
    }

    function cancelSelection() {
        if (state.mode === 'manual') {
            state.isDrawing = false;
            state.currentSelection = null;
            hideSelection();
        } else if (state.mode === 'grid') {
            state.selectedCells.clear();
        }
        updateSelectionInfo();
    }

    // Recalcular escala al cambiar el tamaño de la ventana
    window.addEventListener('resize', () => {
        if (state.image) {
            updateScale();
            syncCanvasAreaSize();
            redraw();
            if (state.mode === 'manual' && state.currentSelection) {
                updateSelectionBox();
            }
        }
    });

    /* ---------------------------------------------------
       Recortes
       ---------------------------------------------------
       Siempre recortamos desde state.image (la imagen
       original) para que la malla no se incluya en el
       PNG resultante.
       --------------------------------------------------- */
    function addStickerFromRect(x, y, w, h) {
        return new Promise((resolve) => {
            const ix = Math.max(0, Math.round(x));
            const iy = Math.max(0, Math.round(y));
            const iw = Math.min(Math.round(w), state.image.naturalWidth - ix);
            const ih = Math.min(Math.round(h), state.image.naturalHeight - iy);

            if (iw <= 0 || ih <= 0) {
                resolve(null);
                return;
            }

            const tmp = document.createElement('canvas');
            tmp.width = iw;
            tmp.height = ih;
            const tctx = tmp.getContext('2d');
            tctx.drawImage(state.image, ix, iy, iw, ih, 0, 0, iw, ih);

            tmp.toBlob((blob) => {
                if (!blob) { resolve(null); return; }
                const url = URL.createObjectURL(blob);
                const index = state.stickers.length + 1;
                const filename = `sticker_${String(index).padStart(3, '0')}.png`;
                state.stickers.push({
                    id: Date.now() + Math.random(),
                    filename,
                    width: iw,
                    height: ih,
                    blob,
                    url,
                });
                resolve({ filename, iw, ih });
            }, 'image/png');
        });
    }

    // Modo manual: recorta la selección actual
    async function cropManualSelection() {
        if (!state.image || !state.currentSelection) {
            showToast('No hay selección activa', 'error');
            return;
        }
        const s = state.currentSelection;
        const result = await addStickerFromRect(s.x, s.y, s.w, s.h);
        if (!result) {
            showToast('Selección inválida', 'error');
            return;
        }
        renderStickerList();
        cancelSelection();
        showToast(`Sticker ${result.filename} añadido`, 'success');
    }

    // Modo malla: recorta todas las celdas marcadas
    async function cropGridSelections() {
        if (!state.grid) {
            showToast('Configura primero la malla', 'error');
            return;
        }
        if (state.selectedCells.size === 0) {
            showToast('No hay celdas marcadas', 'error');
            return;
        }

        const { h, v, rows, cols } = state.grid;
        const sorted = Array.from(state.selectedCells)
            .map((k) => k.split(',').map(Number))
            .sort((a, b) => (a[0] * cols + a[1]) - (b[0] * cols + b[1]));

        let added = 0;
        for (const [i, j] of sorted) {
            const x = v[j];
            const y = h[i];
            const w = v[j + 1] - v[j];
            const hh = h[i + 1] - h[i];
            const r = await addStickerFromRect(x, y, w, hh);
            if (r) added++;
        }

        if (added > 0) {
            renderStickerList();
            state.selectedCells.clear();
            redraw();
            updateSelectionInfo();
            showToast(`${added} sticker(s) añadidos`, 'success');
        } else {
            showToast('No se pudo recortar ninguna celda', 'error');
        }
    }

    /* ---------------------------------------------------
       Teclado: Enter y Escape
       --------------------------------------------------- */
    document.addEventListener('keydown', (e) => {
        // Si la modal está abierta, gestionamos su cierre
        if (!dom.gridModal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideGridModal();
            }
            return;
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        // Ctrl/Cmd + A -> seleccionar todas las celdas (solo en modo malla)
        if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
            if (state.mode === 'grid' && state.grid) {
                e.preventDefault();
                selectAllCells();
            }
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (state.mode === 'manual') cropManualSelection();
            else if (state.mode === 'grid') cropGridSelections();
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
       Descargas
       --------------------------------------------------- */
    function downloadSingleSticker(sticker) {
        const a = document.createElement('a');
        a.href = sticker.url;
        a.download = sticker.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

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
    setMode('manual');
    renderStickerList();
})();
