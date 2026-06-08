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
    const SNAP_THRESHOLD = 3;         // Umbral de snap: si override está a <3px de la línea base, se borra
    const HANDLE_RADIUS = 5;          // Radio de los handles de línea (píxeles CSS)
    const handleCursorMap = {
        nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize',
        e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize',
        sw: 'nesw-resize', w: 'ew-resize',
    };

    const state = {
        image: null,                  // HTMLImageElement cargada
        scale: 1,                     // Escala canvas -> CSS
        isDrawing: false,             // ¿Se está dibujando la selección manual?
        isMoving: false,              // ¿Se está moviendo una selección manual existente?
        isResizing: false,            // ¿Se está redimensionando la selección manual?
        resizeHandle: null,           // 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
        moveStart: null,              // { x, y } canvas px: punto donde se empezó a mover
        moveInitial: null,            // { x, y } canvas px: posición inicial de la selección al empezar a mover
        startX: 0,                    // Coordenada X inicial (canvas px)
        startY: 0,                    // Coordenada Y inicial (canvas px)
        currentSelection: null,       // { x, y, w, h } en píxeles de canvas (modo manual)
        stickers: [],                 // Array de stickers recortados

        // Modo de recorte: 'manual' o 'grid'
        mode: 'manual',

        // Malla
        grid: null,                   // { rows, cols, margin, h: [], v: [] } (h/v en px canvas)
        selectedCells: new Set(),     // Set de strings "row,col" con celdas marcadas
        hoveringLine: null,           // { type: 'h'|'v'|'corner', ... } para feedback de cursor
        isDraggingLine: false,        // ¿Se está arrastrando una línea o esquina?
        dragOffset: { x: 0, y: 0 },   // Offset (canvas px) entre la línea/esquina y el cursor al iniciar el drag
        // Arrastre / redimensionado del rectángulo completo de la malla
        isGridDragging: false,        // ¿Se está moviendo toda la malla?
        gridDragPending: false,       // Clic en celda pendiente de distinguir click vs drag
        gridDragStart: null,          // { x, y } canvas px
        gridDragInitial: null,        // copia del grid al inicio del arrastre
        gridDragCell: null,           // { row, col } celda clickeada para grid drag
        isGridResizing: false,        // ¿Se está redimensionando toda la malla?
        gridResizeHandle: null,       // 'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'
        gridResizeStart: null,        // { x, y } canvas px
        gridResizeInitial: null,      // copia del grid al inicio del redimensionado
        // Arrastre de borde de celda individual
        hoveringCellEdge: null,       // { row, col, edge } borde bajo el cursor
        isDraggingCellEdge: false,    // ¿Se está arrastrando un borde de celda?
        dragCellEdgeStart: null,      // { row, col, edge, startValue, baseLine }
        // Arrastre de cuerpo de celda (mover celda completa)
        isDraggingCell: false,        // ¿Se está moviendo una celda completa?
        dragCellStart: null,          // { row, col, cursorStart: {x,y}, initialOverrides }
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
        // Modal de confirmación
        confirmModal: $('confirmModal'),
        confirmModalTitle: $('confirmModalTitle'),
        confirmModalMessage: $('confirmModalMessage'),
        confirmModalIcon: $('confirmModalIcon'),
        confirmModalOk: $('confirmModalOk'),
        confirmModalCancel: $('confirmModalCancel'),
        // Borde de la malla (modo malla)
        gridBoundary: $('gridBoundary'),
        // Quitar fondo
        removeBgToggle: $('removeBgToggle'),
        // Botón recortar (móvil)
        cropBtn: $('cropBtn'),
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
        updateGridBoundary();
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

    function updateGridBoundary() {
        if (!state.grid || state.mode !== 'grid') {
            dom.gridBoundary.classList.add('hidden');
            return;
        }
        const { h, v, rows, cols } = state.grid;
        const area = dom.canvasArea || dom.canvas.parentElement;
        const areaRect = area.getBoundingClientRect();
        const canvasRect = dom.canvas.getBoundingClientRect();
        const offX = canvasRect.left - areaRect.left;
        const offY = canvasRect.top - areaRect.top;

        const left   = v[0] / state.scale + offX;
        const top    = h[0] / state.scale + offY;
        const right  = v[cols] / state.scale + offX;
        const bottom = h[rows] / state.scale + offY;

        dom.gridBoundary.classList.remove('hidden');
        dom.gridBoundary.style.left   = left + 'px';
        dom.gridBoundary.style.top    = top + 'px';
        dom.gridBoundary.style.width  = (right - left) + 'px';
        dom.gridBoundary.style.height = (bottom - top) + 'px';
    }

    /* ---------------------------------------------------
       Resolución de bounds de celda (con overrides)
       --------------------------------------------------- */
    function getCellBounds(i, j) {
        const g = state.grid;
        const key = `${i},${j}`;
        const ov = (g.cellOverrides && g.cellOverrides[key]) || {};

        let top    = ov.top    !== undefined ? ov.top    : g.h[i];
        let bottom = ov.bottom !== undefined ? ov.bottom : g.h[i + 1];
        let left   = ov.left   !== undefined ? ov.left   : g.v[j];
        let right  = ov.right  !== undefined ? ov.right  : g.v[j + 1];

        // Enforzar tamaño mínimo
        if (bottom - top < MIN_CELL_PX) bottom = top + MIN_CELL_PX;
        if (right - left < MIN_CELL_PX) right = left + MIN_CELL_PX;

        return { x: left, y: top, w: right - left, h: bottom - top };
    }

    function setCellOverride(i, j, edge, value) {
        const g = state.grid;
        if (!g.cellOverrides) g.cellOverrides = {};
        const key = `${i},${j}`;

        // Línea base para este borde
        let baseLine;
        if (edge === 'top')    baseLine = g.h[i];
        else if (edge === 'bottom') baseLine = g.h[i + 1];
        else if (edge === 'left')   baseLine = g.v[j];
        else if (edge === 'right')  baseLine = g.v[j + 1];

        // Snap: si el valor está cerca de la línea base, borrar override
        if (Math.abs(value - baseLine) <= SNAP_THRESHOLD) {
            if (g.cellOverrides[key]) {
                delete g.cellOverrides[key][edge];
                if (Object.keys(g.cellOverrides[key]).length === 0) {
                    delete g.cellOverrides[key];
                }
            }
            return baseLine;
        }

        if (!g.cellOverrides[key]) g.cellOverrides[key] = {};
        g.cellOverrides[key][edge] = value;
        return value;
    }

    /* ---------------------------------------------------
       Detección de borde de celda bajo el cursor
       --------------------------------------------------- */
    function findCellEdgeAt(canvasX, canvasY) {
        if (!state.grid) return null;
        const { rows, cols } = state.grid;
        const tol = LINE_HIT_PX * state.scale;

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const b = getCellBounds(i, j);

                // Borde superior (solo si no es el borde exterior superior de la malla)
                if (i > 0 && Math.abs(canvasY - b.y) <= tol &&
                    canvasX >= b.x && canvasX <= b.x + b.w) {
                    return { row: i, col: j, edge: 'top' };
                }
                // Borde inferior (solo si no es el borde exterior inferior)
                if (i < rows - 1 && Math.abs(canvasY - (b.y + b.h)) <= tol &&
                    canvasX >= b.x && canvasX <= b.x + b.w) {
                    return { row: i, col: j, edge: 'bottom' };
                }
                // Borde izquierdo (solo si no es el borde exterior izquierdo)
                if (j > 0 && Math.abs(canvasX - b.x) <= tol &&
                    canvasY >= b.y && canvasY <= b.y + b.h) {
                    return { row: i, col: j, edge: 'left' };
                }
                // Borde derecho (solo si no es el borde exterior derecho)
                if (j < cols - 1 && Math.abs(canvasX - (b.x + b.w)) <= tol &&
                    canvasY >= b.y && canvasY <= b.y + b.h) {
                    return { row: i, col: j, edge: 'right' };
                }
            }
        }
        return null;
    }

    /* ----- Movimiento de toda la malla (arrastre de celda) ----- */
    function moveGrid(dx, dy) {
        const g = state.grid;
        const W = dom.canvas.width;
        const H = dom.canvas.height;
        const { rows, cols } = g;

        const minX = g.v[0];
        const maxX = W - g.v[cols];
        const minY = g.h[0];
        const maxY = H - g.h[rows];
        const clampedDx = Math.max(-minX, Math.min(maxX, dx));
        const clampedDy = Math.max(-minY, Math.min(maxY, dy));

        for (let j = 0; j <= cols; j++) g.v[j] = g.v[j] + clampedDx;
        for (let i = 0; i <= rows; i++) g.h[i] = g.h[i] + clampedDy;

        // También mover todos los overrides de celdas
        if (g.cellOverrides) {
            for (const key in g.cellOverrides) {
                const ov = g.cellOverrides[key];
                if (ov.top !== undefined) ov.top += clampedDy;
                if (ov.bottom !== undefined) ov.bottom += clampedDy;
                if (ov.left !== undefined) ov.left += clampedDx;
                if (ov.right !== undefined) ov.right += clampedDx;
            }
        }
    }

    /* ----- Redimensionado proporcional de toda la malla ----- */
    function resizeGrid(handle, cp) {
        const g = state.grid;
        const W = dom.canvas.width;
        const H = dom.canvas.height;
        const { rows, cols } = g;
        const gi = state.gridResizeInitial;

        // Limpiar overrides al redimensionar la malla completa
        g.cellOverrides = {};

        // Determinar qué borde se mueve y cuáles son fijos
        let fixedX0, fixedX1, fixedY0, fixedY1;
        if (handle === 'nw' || handle === 'w' || handle === 'sw') {
            fixedX0 = gi.v[0];
            fixedX1 = gi.v[cols];
            g.v[0] = Math.max(0, Math.min(gi.v[1] - MIN_CELL_PX, cp.x));
            fixedX0 = g.v[0];
        } else if (handle === 'ne' || handle === 'e' || handle === 'se') {
            fixedX0 = gi.v[0];
            fixedX1 = W;
            g.v[cols] = Math.max(gi.v[cols - 1] + MIN_CELL_PX, Math.min(W, cp.x));
            fixedX1 = g.v[cols];
        } else {
            fixedX0 = gi.v[0];
            fixedX1 = gi.v[cols];
        }

        if (handle === 'nw' || handle === 'n' || handle === 'ne') {
            fixedY0 = gi.h[0];
            fixedY1 = gi.h[rows];
            g.h[0] = Math.max(0, Math.min(gi.h[1] - MIN_CELL_PX, cp.y));
            fixedY0 = g.h[0];
        } else if (handle === 'sw' || handle === 's' || handle === 'se') {
            fixedY0 = gi.h[0];
            fixedY1 = H;
            g.h[rows] = Math.max(gi.h[rows - 1] + MIN_CELL_PX, Math.min(H, cp.y));
            fixedY1 = g.h[rows];
        } else {
            fixedY0 = gi.h[0];
            fixedY1 = gi.h[rows];
        }

        const rangeX = fixedX1 - fixedX0;
        const rangeY = fixedY1 - fixedY0;

        // Escalar las líneas interiores proporcionalmente
        if (rangeX > 0) {
            for (let j = 1; j < cols; j++) {
                const ratio = (gi.v[j] - gi.v[0]) / (gi.v[cols] - gi.v[0]);
                g.v[j] = Math.round(fixedX0 + ratio * rangeX);
            }
        }
        if (rangeY > 0) {
            for (let i = 1; i < rows; i++) {
                const ratio = (gi.h[i] - gi.h[0]) / (gi.h[rows] - gi.h[0]);
                g.h[i] = Math.round(fixedY0 + ratio * rangeY);
            }
        }
    }

    /* ----- Handles del borde de malla ----- */
    function onGridBoundaryHandleMouseDown(e, handle) {
        e.preventDefault();
        e.stopPropagation();
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        state.isGridResizing = true;
        state.gridResizeHandle = handle;
        state.gridResizeStart = cp;
        state.gridResizeInitial = {
            h: [...state.grid.h],
            v: [...state.grid.v],
        };
        document.body.classList.add('is-resizing');
        document.body.style.cursor = handleCursorMap[handle] || 'default';
        document.addEventListener('pointermove', onGridResizeMouseMove);
        document.addEventListener('pointerup', onGridResizeMouseUp);
    }

    function onGridResizeMouseMove(e) {
        if (!state.isGridResizing) return;
        e.preventDefault();
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        resizeGrid(state.gridResizeHandle, cp);
        redraw();
        updateSelectionInfo();
    }

    function onGridResizeMouseUp() {
        state.isGridResizing = false;
        state.gridResizeHandle = null;
        state.gridResizeStart = null;
        state.gridResizeInitial = null;
        document.body.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.removeEventListener('pointermove', onGridResizeMouseMove);
        document.removeEventListener('pointerup', onGridResizeMouseUp);
    }

    // Cablear handles del borde de malla
    document.querySelectorAll('[data-gbhandle]').forEach((el) => {
        const handle = el.dataset.gbhandle;
        el.addEventListener('pointerdown', (e) => onGridBoundaryHandleMouseDown(e, handle));
    });

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

    // Cursor CSS asociado a cada handle
    const HANDLE_CURSORS = {
        nw: 'nwse-resize',
        n:  'ns-resize',
        ne: 'nesw-resize',
        e:  'ew-resize',
        se: 'nwse-resize',
        s:  'ns-resize',
        sw: 'nesw-resize',
        w:  'ew-resize',
    };

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
            dom.gridBoundary.classList.add('hidden');
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
        updateGridBoundary();
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
        dom.gridMargin.value = dom.gridMargin.value || 0;
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

    /* ---------------------------------------------------
       Modal de confirmación genérica
       ---------------------------------------------------
       Sustituye a window.confirm() con una modal coherente
       con el resto de la UI. Recibe el texto y un callback.
       --------------------------------------------------- */
    function showConfirmModal({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = true, onConfirm }) {
        dom.confirmModalTitle.textContent = title;
        dom.confirmModalMessage.textContent = message;
        dom.confirmModalOk.textContent = confirmText;
        dom.confirmModalCancel.textContent = cancelText;
        dom.confirmModalOk.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
        dom.confirmModalIcon.className = 'modal-icon ' + (danger ? 'modal-icon-warning' : 'modal-icon-info');

        // Reemplazar handler del botón OK para esta confirmación
        dom.confirmModalOk.onclick = () => {
            hideConfirmModal();
            if (typeof onConfirm === 'function') onConfirm();
        };

        dom.confirmModal.classList.remove('hidden');
    }

    function hideConfirmModal() {
        dom.confirmModal.classList.add('hidden');
    }

    // Cerrar al pulsar backdrop o botón con data-confirm-close
    dom.confirmModal.addEventListener('click', (e) => {
        if (e.target.dataset.confirmClose !== undefined) hideConfirmModal();
    });

    function buildGrid(rows, cols, margin) {
        const W = dom.canvas.width;
        const H = dom.canvas.height;
        const cellW = (W - 2 * margin) / cols;
        const cellH = (H - 2 * margin) / rows;

        const h = [];
        const v = [];
        for (let i = 0; i <= rows; i++) h.push(Math.round(margin + i * cellH));
        for (let j = 0; j <= cols; j++) v.push(Math.round(margin + j * cellW));

        state.grid = { rows, cols, margin, h, v, cellOverrides: {} };
    }

    function clearGrid() {
        state.grid = null;
        state.selectedCells.clear();
        state.hoveringLine = null;
        state.isDraggingLine = false;
        state.isGridDragging = false;
        state.gridDragPending = false;
        state.gridDragStart = null;
        state.gridDragInitial = null;
        state.gridDragCell = null;
        state.isGridResizing = false;
        state.gridResizeHandle = null;
        state.gridResizeStart = null;
        state.gridResizeInitial = null;
        state.hoveringCellEdge = null;
        state.isDraggingCellEdge = false;
        state.dragCellEdgeStart = null;
        state.isDraggingCell = false;
        state.dragCellStart = null;
        dom.gridBoundary.classList.add('hidden');
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
        const { h, v, rows, cols, cellOverrides } = state.grid;
        const co = cellOverrides || {};

        // 1) Resaltar celdas seleccionadas
        ctx.save();
        ctx.fillStyle = 'rgba(124, 92, 255, 0.28)';
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                if (state.selectedCells.has(`${i},${j}`)) {
                    const b = getCellBounds(i, j);
                    ctx.fillRect(b.x, b.y, b.w, b.h);
                }
            }
        }
        ctx.restore();

        // 2) Dibujar bordes de celda (compartidos + overrides)
        const lw = Math.max(1, Math.round(state.scale));
        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = 3;

        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const b = getCellBounds(i, j);
                const key = `${i},${j}`;
                const ov = co[key] || {};

                ctx.lineWidth = lw;

                // Borde superior
                if (ov.top !== undefined) {
                    ctx.strokeStyle = 'rgba(124, 92, 255, 0.8)';
                    ctx.setLineDash([4 * state.scale, 3 * state.scale]);
                } else {
                    ctx.strokeStyle = '#ffffff';
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.moveTo(b.x, b.y);
                ctx.lineTo(b.x + b.w, b.y);
                ctx.stroke();

                // Borde inferior (solo si es la última fila o tiene override)
                if (i === rows - 1 || ov.bottom !== undefined) {
                    if (ov.bottom !== undefined) {
                        ctx.strokeStyle = 'rgba(124, 92, 255, 0.8)';
                        ctx.setLineDash([4 * state.scale, 3 * state.scale]);
                    } else {
                        ctx.strokeStyle = '#ffffff';
                        ctx.setLineDash([]);
                    }
                    ctx.beginPath();
                    ctx.moveTo(b.x, b.y + b.h);
                    ctx.lineTo(b.x + b.w, b.y + b.h);
                    ctx.stroke();
                }

                // Borde izquierdo
                if (ov.left !== undefined) {
                    ctx.strokeStyle = 'rgba(124, 92, 255, 0.8)';
                    ctx.setLineDash([4 * state.scale, 3 * state.scale]);
                } else {
                    ctx.strokeStyle = '#ffffff';
                    ctx.setLineDash([]);
                }
                ctx.beginPath();
                ctx.moveTo(b.x, b.y);
                ctx.lineTo(b.x, b.y + b.h);
                ctx.stroke();

                // Borde derecho (solo si es la última columna o tiene override)
                if (j === cols - 1 || ov.right !== undefined) {
                    if (ov.right !== undefined) {
                        ctx.strokeStyle = 'rgba(124, 92, 255, 0.8)';
                        ctx.setLineDash([4 * state.scale, 3 * state.scale]);
                    } else {
                        ctx.strokeStyle = '#ffffff';
                        ctx.setLineDash([]);
                    }
                    ctx.beginPath();
                    ctx.moveTo(b.x + b.w, b.y);
                    ctx.lineTo(b.x + b.w, b.y + b.h);
                    ctx.stroke();
                }
            }
        }
        ctx.setLineDash([]);
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

        // 4) Handles de líneas (círculos en puntos medios de líneas interiores)
        const hr = HANDLE_RADIUS * state.scale;
        const gridCenterX = (v[0] + v[v.length - 1]) / 2;
        const gridCenterY = (h[0] + h[h.length - 1]) / 2;
        ctx.save();
        for (let i = 1; i < h.length - 1; i++) {
            const cx = gridCenterX;
            const cy = h[i];
            ctx.beginPath();
            ctx.arc(cx, cy, hr, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = 'rgba(124, 92, 255, 0.9)';
            ctx.lineWidth = Math.max(1, Math.round(1.5 * state.scale));
            ctx.stroke();
        }
        for (let j = 1; j < v.length - 1; j++) {
            const cx = v[j];
            const cy = gridCenterY;
            ctx.beginPath();
            ctx.arc(cx, cy, hr, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = 'rgba(124, 92, 255, 0.9)';
            ctx.lineWidth = Math.max(1, Math.round(1.5 * state.scale));
            ctx.stroke();
        }
        ctx.restore();

        // 5) Highlight del borde de celda bajo el cursor
        if (state.hoveringCellEdge) {
            const { row, col, edge } = state.hoveringCellEdge;
            const b = getCellBounds(row, col);
            ctx.save();
            ctx.strokeStyle = 'rgba(124, 92, 255, 1)';
            ctx.lineWidth = Math.max(2, Math.round(2 * state.scale));
            ctx.shadowColor = 'rgba(124, 92, 255, 0.5)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            if (edge === 'top')    { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y); }
            if (edge === 'bottom') { ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x + b.w, b.y + b.h); }
            if (edge === 'left')   { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x, b.y + b.h); }
            if (edge === 'right')  { ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); }
            ctx.stroke();
            ctx.restore();
        }

        // 6) Etiquetas de celda
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
                const b = getCellBounds(i, j);
                const cx = b.x + b.w / 2;
                const cy = b.y + b.h / 2;
                const label = String(n++);
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
       Detección de línea (solo en handles/círculos), esquina y borde de celda
       --------------------------------------------------- */
    function findLineHandleAt(canvasX, canvasY) {
        const { h, v } = state.grid;
        const handleTol = (HANDLE_RADIUS + 2) * state.scale;

        const midX = (v[0] + v[v.length - 1]) / 2;
        for (let i = 1; i < h.length - 1; i++) {
            if (Math.abs(canvasX - midX) <= handleTol &&
                Math.abs(canvasY - h[i]) <= handleTol) {
                return { type: 'h', index: i };
            }
        }
        const midY = (h[0] + h[h.length - 1]) / 2;
        for (let j = 1; j < v.length - 1; j++) {
            if (Math.abs(canvasX - v[j]) <= handleTol &&
                Math.abs(canvasY - midY) <= handleTol) {
                return { type: 'v', index: j };
            }
        }
        return null;
    }

    // Detecta si el cursor está cerca de una de las 4 esquinas
    // exteriores de la malla (intersecciones de líneas de borde).
    // Devuelve { i, j, cursor } o null.
    function findCornerAt(canvasX, canvasY) {
        const { h, v, rows, cols } = state.grid;
        const tol = LINE_HIT_PX * state.scale;
        // Solo las 4 intersecciones exteriores
        const corners = [
            { i: 0,     j: 0,     cursor: 'nwse-resize' },
            { i: 0,     j: cols,  cursor: 'nesw-resize' },
            { i: rows,  j: 0,     cursor: 'nesw-resize' },
            { i: rows,  j: cols,  cursor: 'nwse-resize' },
        ];
        for (const c of corners) {
            if (Math.abs(canvasX - v[c.j]) <= tol &&
                Math.abs(canvasY - h[c.i]) <= tol) {
                return c;
            }
        }
        return null;
    }

    function getCellAt(canvasX, canvasY) {
        if (!state.grid) return null;
        const { rows, cols } = state.grid;
        for (let i = 0; i < rows; i++) {
            for (let j = 0; j < cols; j++) {
                const b = getCellBounds(i, j);
                if (canvasX >= b.x && canvasX <= b.x + b.w &&
                    canvasY >= b.y && canvasY <= b.y + b.h) {
                    return { row: i, col: j };
                }
            }
        }
        return null;
    }

    /* ---------------------------------------------------
       Eventos de ratón (despachan según modo)
       --------------------------------------------------- */
    dom.canvas.addEventListener('pointerdown', (e) => {
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

    dom.canvas.addEventListener('pointermove', (e) => {
        if (!state.image) return;
        e.preventDefault();

        if (state.mode === 'manual') {
            onManualMouseMove(e);
        } else if (state.mode === 'grid' && state.grid) {
            onGridMouseMove(e);
        }
    });

    dom.canvas.addEventListener('pointerup', (e) => {
        if (state.mode === 'manual') onManualMouseUp(e);
        else if (state.mode === 'grid') onGridMouseUp(e);
    });

    dom.canvas.addEventListener('pointerleave', (e) => {
        if (state.mode === 'manual') onManualMouseUp(e);
        else if (state.mode === 'grid') onGridMouseUp(e);
        if (state.hoveringLine && !state.isDraggingLine) {
            state.hoveringLine = null;
            dom.canvas.style.cursor = state.mode === 'grid' ? 'default' : 'crosshair';
        }
        if (state.hoveringCellEdge && !state.isDraggingCellEdge) {
            state.hoveringCellEdge = null;
            redraw();
        }
    });

    /* ----- Modo manual ----- */

    // ¿El punto (canvasX, canvasY) cae dentro de la selección actual?
    function pointInSelection(canvasX, canvasY) {
        const s = state.currentSelection;
        if (!s || s.w === 0 || s.h === 0) return false;
        return canvasX >= s.x && canvasX <= s.x + s.w &&
               canvasY >= s.y && canvasY <= s.y + s.h;
    }

    // Listeners a nivel de document durante draw/move manuales.
    // Se usan en lugar del mousemove del canvas para que la interacción
    // no se rompa cuando el cursor pasa por encima de los handles
    // (que tienen pointer-events: auto y dispararían mouseleave del canvas).
    function onManualDragMove(e) {
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);

        if (state.isMoving) {
            const dx = cp.x - state.moveStart.x;
            const dy = cp.y - state.moveStart.y;
            const s = state.currentSelection;
            let nx = state.moveInitial.x + dx;
            let ny = state.moveInitial.y + dy;
            nx = Math.max(0, Math.min(dom.canvas.width - s.w, nx));
            ny = Math.max(0, Math.min(dom.canvas.height - s.h, ny));
            s.x = nx;
            s.y = ny;
            updateSelectionBox();
        } else if (state.isDrawing) {
            const x = Math.min(state.startX, cp.x);
            const y = Math.min(state.startY, cp.y);
            const w = Math.abs(cp.x - state.startX);
            const h = Math.abs(cp.y - state.startY);
            state.currentSelection = { x, y, w, h };
            updateSelectionBox();
        }
    }

    function onManualDragUp() {
        if (state.isMoving) {
            state.isMoving = false;
            state.moveStart = null;
            state.moveInitial = null;
        } else if (state.isDrawing) {
            state.isDrawing = false;
            if (!state.currentSelection ||
                state.currentSelection.w < 4 ||
                state.currentSelection.h < 4) {
                cancelSelection();
            }
        }
        document.removeEventListener('pointermove', onManualDragMove);
        document.removeEventListener('pointerup', onManualDragUp);
    }

    function attachManualDragListeners() {
        document.addEventListener('pointermove', onManualDragMove);
        document.addEventListener('pointerup', onManualDragUp);
    }

    function onManualMouseDown(e) {
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);

        // Si ya hay selección y se hace clic DENTRO, moverla
        if (pointInSelection(cp.x, cp.y)) {
            state.isMoving = true;
            state.moveStart = { x: cp.x, y: cp.y };
            state.moveInitial = { x: state.currentSelection.x, y: state.currentSelection.y };
            dom.canvas.style.cursor = 'move';
            attachManualDragListeners();
            return;
        }

        // Si no, empezar una nueva selección desde cero
        state.isDrawing = true;
        state.startX = cp.x;
        state.startY = cp.y;
        state.currentSelection = { x: cp.x, y: cp.y, w: 0, h: 0 };
        showSelectionBox();
        attachManualDragListeners();
    }

    function onManualMouseMove(e) {
        // Solo para feedback de cursor cuando NO estamos arrastrando
        if (state.isDrawing || state.isMoving) return;
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        dom.canvas.style.cursor = pointInSelection(cp.x, cp.y) ? 'move' : 'crosshair';
    }

    function onManualMouseUp() {
        // El final del drag lo gestiona onManualDragUp (listener de document).
        // Este handler queda como no-op para mantener la simetría con el
        // dispatch del modo grid.
    }

    /* ----- Redimensionado de la selección manual ----- */

    const MIN_SEL_PX = 4;

    // Redimensiona la selección desde el handle que se está arrastrando.
    // El lado/esquina opuesta queda fijo.
    function resizeSelection(mouseX, mouseY) {
        const s = state.currentSelection;
        if (!s || !state.resizeHandle) return;

        const right = s.x + s.w;
        const bottom = s.y + s.h;
        let nx = s.x, ny = s.y, nw = s.w, nh = s.h;

        switch (state.resizeHandle) {
            case 'nw': nx = mouseX; ny = mouseY; nw = right - nx;  nh = bottom - ny; break;
            case 'n':                       ny = mouseY; nh = bottom - ny;            break;
            case 'ne':                      ny = mouseY; nw = mouseX - s.x; nh = bottom - ny; break;
            case 'e':                                            nw = mouseX - s.x;            break;
            case 'se':                                           nw = mouseX - s.x; nh = mouseY - s.y; break;
            case 's':                                                              nh = mouseY - s.y; break;
            case 'sw': nx = mouseX; nw = right - nx;  nh = mouseY - s.y;            break;
            case 'w':  nx = mouseX; nw = right - nx;                                  break;
        }

        // Tamaño mínimo: si la dimensión cae por debajo, anclar al lado opuesto
        if (nw < MIN_SEL_PX) {
            if (state.resizeHandle === 'nw' || state.resizeHandle === 'w' || state.resizeHandle === 'sw') {
                nx = right - MIN_SEL_PX;
            }
            nw = MIN_SEL_PX;
        }
        if (nh < MIN_SEL_PX) {
            if (state.resizeHandle === 'nw' || state.resizeHandle === 'n' || state.resizeHandle === 'ne') {
                ny = bottom - MIN_SEL_PX;
            }
            nh = MIN_SEL_PX;
        }

        // Limitar a los bordes del canvas
        if (nx < 0) { nw += nx; nx = 0; }
        if (ny < 0) { nh += ny; ny = 0; }
        if (nx + nw > dom.canvas.width) nw = dom.canvas.width - nx;
        if (ny + nh > dom.canvas.height) nh = dom.canvas.height - ny;

        s.x = nx; s.y = ny; s.w = nw; s.h = nh;
        updateSelectionBox();
        updateSelectionInfo();
    }

    function onHandleMouseDown(e, handle) {
        e.stopPropagation();
        e.preventDefault();
        state.isResizing = true;
        state.resizeHandle = handle;
        // Cursor global mientras dure el drag
        document.body.classList.add('is-resizing');
        document.body.style.cursor = HANDLE_CURSORS[handle];
        document.addEventListener('pointermove', onResizeMouseMove);
        document.addEventListener('pointerup', onResizeMouseUp);
    }

    function onResizeMouseMove(e) {
        if (!state.isResizing) return;
        e.preventDefault();
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);
        resizeSelection(cp.x, cp.y);
    }

    function onResizeMouseUp() {
        state.isResizing = false;
        state.resizeHandle = null;
        document.body.classList.remove('is-resizing');
        document.body.style.cursor = '';
        document.removeEventListener('pointermove', onResizeMouseMove);
        document.removeEventListener('pointerup', onResizeMouseUp);
    }

    // Cablear los 8 handles
    document.querySelectorAll('.sel-handle').forEach((el) => {
        const handle = el.dataset.handle;
        el.addEventListener('pointerdown', (e) => onHandleMouseDown(e, handle));
    });

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

        // 1) Esquinas exteriores (prioridad máxima)
        const corner = findCornerAt(cp.x, cp.y);
        if (corner) {
            state.isDraggingLine = true;
            state.hoveringLine = { type: 'corner', corner };
            state.dragOffset = {
                x: cp.x - state.grid.v[corner.j],
                y: cp.y - state.grid.h[corner.i],
            };
            dom.canvas.style.cursor = corner.cursor;
            return;
        }

        // 2) Handles de línea (círculos en puntos medios)
        const line = findLineHandleAt(cp.x, cp.y);
        if (line) {
            state.isDraggingLine = true;
            state.hoveringLine = line;
            state.dragOffset = line.type === 'h'
                ? { x: 0, y: cp.y - state.grid.h[line.index] }
                : { x: cp.x - state.grid.v[line.index], y: 0 };
            dom.canvas.style.cursor = line.type === 'h' ? 'ns-resize' : 'ew-resize';
            return;
        }

        // 3) Borde de celda individual — override individual
        const edge = findCellEdgeAt(cp.x, cp.y);
        if (edge) {
            state.isDraggingCellEdge = true;
            const b = getCellBounds(edge.row, edge.col);
            const startVal = edge.edge === 'top' ? b.y :
                             edge.edge === 'bottom' ? b.y + b.h :
                             edge.edge === 'left' ? b.x : b.x + b.w;
            state.dragCellEdgeStart = {
                row: edge.row, col: edge.col, edge: edge.edge,
                startValue: startVal,
                cursorStart: { x: cp.x, y: cp.y },
            };
            dom.canvas.style.cursor = (edge.edge === 'top' || edge.edge === 'bottom') ? 'ns-resize' : 'ew-resize';
            return;
        }

        // 4) Cuerpo de celda → preparar drag de celda o toggle
        const cell = getCellAt(cp.x, cp.y);
        if (cell) {
            state.gridDragPending = true;
            state.gridDragStart = cp;
            state.gridDragCell = cell;
            state.gridDragInitial = {
                h: [...state.grid.h],
                v: [...state.grid.v],
                overrides: JSON.parse(JSON.stringify(state.grid.cellOverrides || {})),
            };
        }
    }

    function onGridMouseMove(e) {
        const pos = getCanvasPos(e);
        const cp = cssToCanvas(pos.x, pos.y);

        // Arrastre activo de línea/esquina
        if (state.isDraggingLine) {
            dragLine(cp);
            return;
        }

        // Arrastre activo de borde de celda
        if (state.isDraggingCellEdge && state.dragCellEdgeStart) {
            dragCellEdge(cp);
            return;
        }

        // Arrastre activo de cuerpo de celda
        if (state.isDraggingCell && state.dragCellStart) {
            dragCellBody(cp);
            return;
        }

        // Grid drag threshold → arrastrar celda individual
        if (state.gridDragPending && state.gridDragStart) {
            const dx = cp.x - state.gridDragStart.x;
            const dy = cp.y - state.gridDragStart.y;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                state.gridDragPending = false;
                state.isDraggingCell = true;
                const cell = state.gridDragCell;
                const b = getCellBounds(cell.row, cell.col);
                state.dragCellStart = {
                    row: cell.row,
                    col: cell.col,
                    cursorStart: { x: state.gridDragStart.x, y: state.gridDragStart.y },
                    initialBounds: { x: b.x, y: b.y, w: b.w, h: b.h },
                };
                document.body.classList.add('is-resizing');
                document.body.style.cursor = 'move';
            }
        }

        // --- Feedback de cursor (hover) ---

        // 1) Esquinas
        const corner = findCornerAt(cp.x, cp.y);
        if (corner) {
            state.hoveringCellEdge = null;
            if (!state.hoveringLine ||
                state.hoveringLine.type !== 'corner' ||
                state.hoveringLine.corner.i !== corner.i ||
                state.hoveringLine.corner.j !== corner.j) {
                state.hoveringLine = { type: 'corner', corner };
                dom.canvas.style.cursor = corner.cursor;
            }
            redraw();
            return;
        }

        // 2) Handles de línea
        const line = findLineHandleAt(cp.x, cp.y);
        if (line) {
            state.hoveringCellEdge = null;
            const changed = !state.hoveringLine ||
                state.hoveringLine.type !== line.type ||
                state.hoveringLine.index !== line.index;
            if (changed) {
                state.hoveringLine = line;
                dom.canvas.style.cursor = line.type === 'h' ? 'ns-resize' : 'ew-resize';
            }
            redraw();
            return;
        }

        // 3) Borde de celda
        const edge = findCellEdgeAt(cp.x, cp.y);
        if (edge) {
            state.hoveringLine = null;
            const prev = state.hoveringCellEdge;
            const edgeChanged = !prev || prev.row !== edge.row || prev.col !== edge.col || prev.edge !== edge.edge;
            if (edgeChanged) {
                state.hoveringCellEdge = edge;
                dom.canvas.style.cursor = (edge.edge === 'top' || edge.edge === 'bottom') ? 'ns-resize' : 'ew-resize';
                redraw();
            }
            return;
        }

        // 4) Fuera de todo
        if (state.hoveringCellEdge || state.hoveringLine) {
            state.hoveringCellEdge = null;
            state.hoveringLine = null;
            dom.canvas.style.cursor = 'default';
            redraw();
        }
    }

    function onGridMouseUp(e) {
        if (state.isDraggingLine) {
            state.isDraggingLine = false;
            state.dragOffset = { x: 0, y: 0 };
            if (state.hoveringLine) {
                if (state.hoveringLine.type === 'corner') {
                    dom.canvas.style.cursor = state.hoveringLine.corner.cursor;
                } else if (state.hoveringLine.type === 'h') {
                    dom.canvas.style.cursor = 'ns-resize';
                } else if (state.hoveringLine.type === 'v') {
                    dom.canvas.style.cursor = 'ew-resize';
                }
            } else {
                dom.canvas.style.cursor = 'default';
            }
            return;
        }

        if (state.isDraggingCellEdge) {
            state.isDraggingCellEdge = false;
            state.dragCellEdgeStart = null;
            dom.canvas.style.cursor = 'default';
            redraw();
            return;
        }

        if (state.isDraggingCell) {
            state.isDraggingCell = false;
            state.dragCellStart = null;
            document.body.classList.remove('is-resizing');
            document.body.style.cursor = '';
            redraw();
            return;
        }

        // Grid drag pending without threshold → click toggle
        if (state.gridDragPending) {
            state.gridDragPending = false;
            state.gridDragStart = null;
            state.gridDragInitial = null;
            state.gridDragCell = null;
            const pos = getCanvasPos(e);
            const cp = cssToCanvas(pos.x, pos.y);
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

    // Mueve la línea o esquina que se está arrastrando, respetando
    // los vecinos y el tamaño mínimo de celda.
    function dragLine(cp) {
        const { h, v } = state.grid;
        const hl = state.hoveringLine;

        if (hl.type === 'h') {
            const i = hl.index;
            const minY = (i > 0 ? h[i - 1] : 0) + MIN_CELL_PX;
            const maxY = (i < h.length - 1 ? h[i + 1] : dom.canvas.height) - MIN_CELL_PX;
            h[i] = Math.max(minY, Math.min(maxY, cp.y - state.dragOffset.y));
        } else if (hl.type === 'v') {
            const j = hl.index;
            const minX = (j > 0 ? v[j - 1] : 0) + MIN_CELL_PX;
            const maxX = (j < v.length - 1 ? v[j + 1] : dom.canvas.width) - MIN_CELL_PX;
            v[j] = Math.max(minX, Math.min(maxX, cp.x - state.dragOffset.x));
        } else if (hl.type === 'corner') {
            // Arrastrar las dos líneas perpendiculares a la vez
            const { i, j } = hl.corner;
            const minY = (i > 0 ? h[i - 1] : 0) + MIN_CELL_PX;
            const maxY = (i < h.length - 1 ? h[i + 1] : dom.canvas.height) - MIN_CELL_PX;
            h[i] = Math.max(minY, Math.min(maxY, cp.y - state.dragOffset.y));
            const minX = (j > 0 ? v[j - 1] : 0) + MIN_CELL_PX;
            const maxX = (j < v.length - 1 ? v[j + 1] : dom.canvas.width) - MIN_CELL_PX;
            v[j] = Math.max(minX, Math.min(maxX, cp.x - state.dragOffset.x));
        }
        redraw();
        updateSelectionInfo();
    }

    /* ---------------------------------------------------
       Arrastre de borde de celda individual
       --------------------------------------------------- */
    function dragCellEdge(cp) {
        const ds = state.dragCellEdgeStart;
        const { row, col, edge, startValue, cursorStart } = ds;
        const delta = (edge === 'top' || edge === 'bottom') ? cp.y - cursorStart.y : cp.x - cursorStart.x;
        let newValue = startValue + delta;

        const b = getCellBounds(row, col);
        if (edge === 'top') {
            const minVal = (row > 0 ? getCellBounds(row - 1, col).y + getCellBounds(row - 1, col).h : 0) + MIN_CELL_PX;
            const maxVal = b.y + b.h - MIN_CELL_PX;
            newValue = Math.max(minVal, Math.min(maxVal, newValue));
        } else if (edge === 'bottom') {
            const minVal = b.y + MIN_CELL_PX;
            const maxVal = (row < state.grid.rows - 1 ? getCellBounds(row + 1, col).y : dom.canvas.height) - MIN_CELL_PX;
            newValue = Math.max(minVal, Math.min(maxVal, newValue));
        } else if (edge === 'left') {
            const minVal = (col > 0 ? getCellBounds(row, col - 1).x + getCellBounds(row, col - 1).w : 0) + MIN_CELL_PX;
            const maxVal = b.x + b.w - MIN_CELL_PX;
            newValue = Math.max(minVal, Math.min(maxVal, newValue));
        } else if (edge === 'right') {
            const minVal = b.x + MIN_CELL_PX;
            const maxVal = (col < state.grid.cols - 1 ? getCellBounds(row, col + 1).x : dom.canvas.width) - MIN_CELL_PX;
            newValue = Math.max(minVal, Math.min(maxVal, newValue));
        }

        setCellOverride(row, col, edge, newValue);
        redraw();
        updateSelectionInfo();
    }

    /* ---------------------------------------------------
       Arrastre de cuerpo de celda (mover celda completa)
       --------------------------------------------------- */
    function dragCellBody(cp) {
        const ds = state.dragCellStart;
        const { row, col, cursorStart, initialBounds } = ds;
        const dx = cp.x - cursorStart.x;
        const dy = cp.y - cursorStart.y;

        let newX = initialBounds.x + dx;
        let newY = initialBounds.y + dy;

        // Clamp a los límites del canvas
        newX = Math.max(0, Math.min(dom.canvas.width - initialBounds.w, newX));
        newY = Math.max(0, Math.min(dom.canvas.height - initialBounds.h, newY));

        setCellOverride(row, col, 'left', newX);
        setCellOverride(row, col, 'right', newX + initialBounds.w);
        setCellOverride(row, col, 'top', newY);
        setCellOverride(row, col, 'bottom', newY + initialBounds.h);

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
            state.isMoving = false;
            state.isResizing = false;
            state.resizeHandle = null;
            state.moveStart = null;
            state.moveInitial = null;
            state.currentSelection = null;
            document.body.classList.remove('is-resizing');
            document.body.style.cursor = '';
            hideSelection();
        } else if (state.mode === 'grid') {
            state.selectedCells.clear();
            state.isDraggingLine = false;
            state.isGridDragging = false;
            state.gridDragPending = false;
            state.gridDragStart = null;
            state.gridDragInitial = null;
            state.gridDragCell = null;
            state.isGridResizing = false;
            state.gridResizeHandle = null;
            state.hoveringCellEdge = null;
            state.isDraggingCellEdge = false;
            state.dragCellEdgeStart = null;
            state.isDraggingCell = false;
            state.dragCellStart = null;
            document.body.classList.remove('is-resizing');
            document.body.style.cursor = '';
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
       Quitar fondo (flood fill desde bordes)
       --------------------------------------------------- */
    const BG_TOLERANCE = 30;

    function removeBackground(canvas) {
        const ctx2 = canvas.getContext('2d');
        const { width: W, height: H } = canvas;
        const imageData = ctx2.getImageData(0, 0, W, H);
        const data = imageData.data;

        const samples = [];
        for (let x = 0; x < W; x++) {
            samples.push(getPixel(data, x, 0, W));
            samples.push(getPixel(data, x, H - 1, W));
        }
        for (let y = 0; y < H; y++) {
            samples.push(getPixel(data, 0, y, W));
            samples.push(getPixel(data, W - 1, y, W));
        }

        const bg = medianColor(samples);

        const visited = new Uint8Array(W * H);
        const queue = [];

        for (let x = 0; x < W; x++) {
            if (colorMatch(getPixel(data, x, 0, W), bg)) queue.push(x);
            if (colorMatch(getPixel(data, x, H - 1, W), bg)) queue.push(x + (H - 1) * W);
        }
        for (let y = 0; y < H; y++) {
            if (colorMatch(getPixel(data, 0, y, W), bg)) queue.push(y * W);
            if (colorMatch(getPixel(data, W - 1, y, W), bg)) queue.push((W - 1) + y * W);
        }

        for (const idx of queue) visited[idx] = 1;

        let head = 0;
        while (head < queue.length) {
            const idx = queue[head++];
            data[idx * 4 + 3] = 0;

            const px = idx % W;
            const py = (idx - px) / W;
            if (py > 0 && !visited[idx - W] && colorMatch(getPixel(data, px, py - 1, W), bg)) {
                visited[idx - W] = 1; queue.push(idx - W);
            }
            if (py < H - 1 && !visited[idx + W] && colorMatch(getPixel(data, px, py + 1, W), bg)) {
                visited[idx + W] = 1; queue.push(idx + W);
            }
            if (px > 0 && !visited[idx - 1] && colorMatch(getPixel(data, px - 1, py, W), bg)) {
                visited[idx - 1] = 1; queue.push(idx - 1);
            }
            if (px < W - 1 && !visited[idx + 1] && colorMatch(getPixel(data, px + 1, py, W), bg)) {
                visited[idx + 1] = 1; queue.push(idx + 1);
            }
        }

        ctx2.putImageData(imageData, 0, 0);
    }

    function getPixel(data, x, y, W) {
        const i = (y * W + x) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    }

    function colorMatch(a, b) {
        return Math.abs(a[0] - b[0]) <= BG_TOLERANCE &&
               Math.abs(a[1] - b[1]) <= BG_TOLERANCE &&
               Math.abs(a[2] - b[2]) <= BG_TOLERANCE;
    }

    function medianColor(samples) {
        const byR = [...samples].sort((a, b) => a[0] - b[0]);
        const byG = [...samples].sort((a, b) => a[1] - b[1]);
        const byB = [...samples].sort((a, b) => a[2] - b[2]);
        const mid = Math.floor(samples.length / 2);
        return [byR[mid][0], byG[mid][1], byB[mid][2]];
    }

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

            if (dom.removeBgToggle.checked) {
                removeBackground(tmp);
            }

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

        const { rows, cols } = state.grid;
        const sorted = Array.from(state.selectedCells)
            .map((k) => k.split(',').map(Number))
            .sort((a, b) => (a[0] * cols + a[1]) - (b[0] * cols + b[1]));

        let added = 0;
        for (const [i, j] of sorted) {
            const b = getCellBounds(i, j);
            const r = await addStickerFromRect(b.x, b.y, b.w, b.h);
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
        // Si la modal de malla está abierta, gestionamos su cierre
        if (!dom.gridModal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideGridModal();
            }
            return;
        }

        // Si la modal de confirmación está abierta, Esc la cierra
        if (!dom.confirmModal.classList.contains('hidden')) {
            if (e.key === 'Escape') {
                e.preventDefault();
                hideConfirmModal();
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

    // Botón "Recortar" (para móvil donde no hay teclado)
    dom.cropBtn.addEventListener('click', () => {
        if (state.mode === 'manual') cropManualSelection();
        else if (state.mode === 'grid') cropGridSelections();
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
        const count = state.stickers.length;
        showConfirmModal({
            title: 'Borrar todos los stickers',
            message: `Se eliminarán ${count} sticker${count !== 1 ? 's' : ''} de la lista. Esta acción no se puede deshacer.`,
            confirmText: 'Sí, borrar todo',
            cancelText: 'Cancelar',
            danger: true,
            onConfirm: () => {
                state.stickers.forEach((s) => URL.revokeObjectURL(s.url));
                state.stickers = [];
                renderStickerList();
                showToast('Lista vaciada', '');
            },
        });
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
