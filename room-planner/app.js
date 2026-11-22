(() => {
  'use strict';

  /* =========================================================
     1. 常量与预设配置
     ========================================================= */
  const STORAGE_KEY = 'lifetools_room_planner_v2';
  const IDB_NAME = 'RoomPlannerDB';
  const IDB_STORE = 'state';

  // 实测还原的矢量户型尺寸（cm）：691 x 830 cm
  const VECTOR_PLAN = {
    width: 691,
    height: 830
  };

  // 窗内沿和墙内沿均使用世界坐标（cm）。
  const balconyWindowInside = 19;
  const dividerX = 296;
  const leftReturn = { x: 19, y: balconyWindowInside + 115, width: 39, height: 25 };
  const rightReturn = { x: dividerX - 48, y: balconyWindowInside + 94, width: 48, height: 18 };
  const bedroomAWallY = leftReturn.y + leftReturn.height + 260;
  const bedroomAWallThickness = 9;
  const wardrobeWidth = 131;
  const wardrobeDepth = 60;
  const bedroomBay = { left: 314, right: 593, top: balconyWindowInside, bottom: balconyWindowInside + 81 };
  const bayWall = { left: bedroomBay.right - 27, right: bedroomBay.right, top: bedroomBay.bottom, bottom: bedroomBay.bottom + 47 };
  const doorWidth = { entry: 95, bedroomA: 86, bedroomB: 82 };
  const entryHingeX = 301;
  const entryJambX = entryHingeX - doorWidth.entry;
  const bedroomBHingeX = bedroomBay.left;
  const bedroomBJambX = bedroomBHingeX + doorWidth.bedroomB;

  const ITEM_COLORS = [
    { id: 'sage',    name: '鼠尾草绿', fill: '#D9E8DE', stroke: '#4A785E', accent: '#3B664E' },
    { id: 'sky',     name: '灰蓝',     fill: '#DCE8F2', stroke: '#466D8F', accent: '#335A7C' },
    { id: 'sand',    name: '暖木沙',   fill: '#EFE1CE', stroke: '#9B754B', accent: '#825D36' },
    { id: 'terra',   name: '陶土粉',   fill: '#F1DDD6', stroke: '#A46252', accent: '#8E4E3E' },
    { id: 'lavender',name: '淡紫灰',   fill: '#E5E1F0', stroke: '#6E6394', accent: '#584E7D' },
    { id: 'slate',   name: '浅岩灰',   fill: '#E3E6EA', stroke: '#5C6672', accent: '#444D58' }
  ];

  const ITEM_PRESETS = [
    { name: '双人床 1.5m', width: 150, depth: 200, color: 'sand' },
    { name: '双人床 1.8m', width: 180, depth: 200, color: 'sand' },
    { name: '升降书桌',   width: 140, depth: 70,  color: 'sky' },
    { name: '人体工学椅', width: 65,  depth: 65,  color: 'slate' },
    { name: '衣柜',       width: 150, depth: 60,  color: 'sand' },
    { name: '床头柜',     width: 45,  depth: 40,  color: 'sand' },
    { name: '三人沙发',   width: 210, depth: 90,  color: 'sage' },
    { name: '茶几',       width: 100, depth: 60,  color: 'sage' },
    { name: '餐桌',       width: 130, depth: 80,  color: 'terra' },
    { name: '电视柜',     width: 180, depth: 40,  color: 'slate' },
    { name: '冰箱',       width: 65,  depth: 70,  color: 'sky' },
    { name: '书架 / 机柜', width: 80, depth: 40,  color: 'lavender' }
  ];

  // 依据原图轮廓估算的厘米坐标，尺寸为旋转前的宽、深。前面的地毯和台面绘制在底层。
  const ORIGINAL_ITEMS = [
    { name: '客厅地毯', shape: 'rug', cx: 116.1, cy: 664.5, width: 148, depth: 157, color: 'sand', stackable: true },
    { name: '厨房操作台', shape: 'counter', cx: 446.4, cy: 777.2, width: 144, depth: 61, color: 'sand', fixture: true },
    { name: '厨房转角台面', shape: 'counterL', cx: 614.2, cy: 702.6, width: 109, depth: 130, color: 'sand', fixture: true },
    { name: '淋浴隔断', shape: 'shower', cx: 544.9, cy: 573.5, width: 88, depth: 142, color: 'sky', stackable: true, fixture: true },
    { name: '阳台书桌', shape: 'desk', cx: 269.2, cy: 98.0, width: 100, depth: 48, color: 'sand', rotation: 90 },
    { name: '阳台书椅', shape: 'chair', cx: 226.4, cy: 98.6, width: 45, depth: 38, color: 'sage', rotation: 270 },
    { name: '卧室 B 书桌', shape: 'desk', cx: 532.0, cy: 97.4, width: 101, depth: 50, color: 'sand', rotation: 90 },
    { name: '卧室 B 书椅', shape: 'chair', cx: 485.1, cy: 106.2, width: 43, depth: 43, color: 'sky', rotation: 270 },
    { name: '卧室 A 双人床', shape: 'bed', cx: 126.1, cy: 291.7, width: 151, depth: 208, color: 'sage', rotation: 270 },
    { name: '卧室 B 双人床', shape: 'bed', cx: 484.5, cy: 227.8, width: 155, depth: 209, color: 'sky', rotation: 90 },
    { name: '卧室 A 床头柜', shape: 'nightstand', cx: 47.5, cy: 193.1, width: 46, depth: 43, color: 'sand' },
    { name: '卧室 B 床头柜', shape: 'nightstand', cx: 565.5, cy: 328.1, width: 45, depth: 46, color: 'sand' },
    { name: '卧室 A 衣柜', shape: 'wardrobe', cx: leftReturn.x + wardrobeWidth / 2, cy: bedroomAWallY - wardrobeDepth / 2,
      width: wardrobeWidth, depth: wardrobeDepth, rotation: 180, color: 'sand' },
    { name: '卧室 B 衣柜', shape: 'wardrobe', cx: 522.6, cy: 387.4, width: 135, depth: 54, color: 'sand' },
    { name: '餐椅（左）', shape: 'chair', cx: 71.6, cy: 506.0, width: 40, depth: 45, color: 'sand', rotation: 270, stackable: true, note: '原图未标名称，按餐桌旁座位轮廓估算。' },
    { name: '餐椅（右）', shape: 'chair', cx: 164.2, cy: 506.0, width: 40, depth: 47, color: 'sand', rotation: 90, stackable: true, note: '原图未标名称，按餐桌旁座位轮廓估算。' },
    { name: '折叠餐桌', shape: 'roundTable', cx: 119.1, cy: 506.0, width: 69, depth: 70, color: 'sand' },
    { name: '客厅沙发', shape: 'sofa', cx: 58.1, cy: 664.5, width: 124, depth: 67, color: 'sage', rotation: 270 },
    { name: '圆茶几', shape: 'roundTable', cx: 140.2, cy: 663.9, width: 60, depth: 60, color: 'sand' },
    { name: '入户矮柜', shape: 'cabinet', cx: 98.0, cy: 790.7, width: 81, depth: 34, color: 'slate', note: '原图仅画出矩形，暂按矮柜标记。' },
    { name: '洗手台', shape: 'basin', cx: 461.6, cy: 451.4, width: 79, depth: 50, color: 'sky', fixture: true },
    { name: '马桶', shape: 'toilet', cx: 461.1, cy: 608.1, width: 45, depth: 73, color: 'slate', fixture: true },
    { name: '厨房水槽', shape: 'sink', cx: 640.0, cy: 708.5, width: 48, depth: 43, color: 'slate', stackable: true, fixture: true },
    { name: '厨房嵌入设备', shape: 'appliance', cx: 483.3, cy: 777.2, width: 61, depth: 52, color: 'slate', stackable: true, fixture: true, note: '底部台面上的未标名设备，按外轮廓估算。' },
    { name: '单眼灶', shape: 'hob', cx: 419.4, cy: 780.1, width: 29, depth: 39, color: 'slate', stackable: true, fixture: true },
    { name: '淋浴花洒', shape: 'spray', cx: 546.1, cy: 628.7, width: 18, depth: 32, color: 'slate', stackable: true, fixture: true },
    { name: '地漏（左）', shape: 'drain', cx: 430.0, cy: 632.8, width: 11, depth: 12, color: 'slate', stackable: true, fixture: true },
    { name: '地漏（右）', shape: 'drain', cx: 578.4, cy: 631.6, width: 12, depth: 12, color: 'slate', stackable: true, fixture: true },
    { name: '阳台台灯', shape: 'lamp', cx: 268.7, cy: 128.6, width: 26, depth: 27, color: 'sand', stackable: true },
    { name: '卧室 A 床头灯', shape: 'lamp', cx: 47.5, cy: 194.3, width: 27, depth: 27, color: 'sand', stackable: true },
    { name: '卧室 B 床头灯', shape: 'lamp', cx: 565.5, cy: 327.5, width: 28, depth: 28, color: 'sand', stackable: true },
  ];

  // 按沿客厅左墙从上往下的顺序排列。宽沿墙，深朝向客厅。
  const LIVING_WALL_ITEMS = [
    { name: '冰箱', shape: 'fridge', width: 50, depth: 60, color: 'slate' },
    { name: '置物架（上）', shape: 'shelf', width: 120, depth: 40, color: 'sand' },
    { name: '置物架（下）', shape: 'shelf', width: 120, depth: 40, color: 'sand' }
  ];

  const OUTLET_TYPES = [
    { id: 'power10', name: '五孔插座',   short: '电', color: '#D97706', isPower: true,  defaultNote: '离地 30 cm' },
    { id: 'power16', name: '16A 大功率', short: '空', color: '#C93B3B', isPower: true,  defaultNote: '空调/大功率专用' },
    { id: 'network', name: '网口 / 光纤', short: '网', color: '#0F766E', isPower: false, defaultNote: '千兆网口' },
    { id: 'switch',  name: '开关面板',   short: '开', color: '#475569', isPower: false, defaultNote: '离地 130 cm' },
    { id: 'floor',   name: '地插 / 水口', short: '地', color: '#6D28D9', isPower: true,  defaultNote: '地面/预留点位' }
  ];

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /* =========================================================
     2. 应用状态
     ========================================================= */
  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function createReferenceItem(source) {
    return { id: uid('item'), rotation: 0, stackable: false, locked: false, note: '', ...source };
  }

  function createDefaultState(saved) {
    let wallY = bedroomAWallY + bedroomAWallThickness;
    const wallItems = LIVING_WALL_ITEMS.map(source => {
      const cy = wallY + source.width / 2;
      wallY += source.width;
      return createReferenceItem({ ...source, cx: leftReturn.x + source.depth / 2, cy, rotation: 270 });
    });
    const reference = {
      id: uid('plan'), name: '原图布置', editableFixtures: true, floorplanMode: 'vector',
      items: [...ORIGINAL_ITEMS.map(createReferenceItem), ...wallItems]
    };
    const defaults = {
      version: 2,
      floorplanMode: 'vector', // 'vector' | 'image'
      vectorOptions: {
        showFixtures: true,
        showDoorSwings: true,
        showFloorTexture: true
      },
      background: null, // { dataUrl, naturalWidth, naturalHeight, cmPerPx, calibrated, opacity, rotation }
      outlets: [], // 房间共用插孔：{ id, type, x, y, label, count, note }
      plans: [reference],
      activePlanId: reference.id,
      originalLayoutVersion: 5,
      settings: {
        snapCm: 5,
        showPowerLine: true
      }
    };
    if (!saved || !Array.isArray(saved.plans) || !saved.plans.length) {
      clearFixedAreas(reference.items);
      return defaults;
    }
    const loaded = {
      ...defaults, ...saved,
      vectorOptions: { ...defaults.vectorOptions, ...saved.vectorOptions },
      settings: { ...defaults.settings, ...saved.settings }
    };
    if (!saved.originalLayoutVersion) {
      loaded.plans = [...saved.plans, reference];
      const isEmpty = saved.plans.length === 1 && !saved.plans[0].items?.length &&
        !saved.outlets?.length && !saved.background && saved.floorplanMode !== 'image';
      if (isEmpty) loaded.activePlanId = reference.id;
    } else if (saved.originalLayoutVersion < defaults.originalLayoutVersion) {
      const plan = loaded.plans.find(p => p.name === reference.name && p.editableFixtures);
      if (plan && saved.originalLayoutVersion < 3) {
        const wardrobe = reference.items.find(item => item.name === '卧室 A 衣柜');
        const existing = plan.items.find(item => item.name === wardrobe.name) ||
          plan.items.find(item => item.shape === 'wardrobe' && item.cx === 125.5 && item.cy === 432);
        // 已载入过衣柜的存档仅修正此前估算的位置，保留后续移动与删除。
        const atPriorPosition = existing && ((existing.cx === 84.5 && existing.cy === 449) ||
          (existing.cx === 125.5 && existing.cy === 432));
        if (existing && (saved.originalLayoutVersion === 1 || atPriorPosition)) {
          const { width, depth, rotation, cx, cy, shape } = wardrobe;
          Object.assign(existing, { width, depth, rotation, cx, cy, shape });
        } else if (!existing && saved.originalLayoutVersion === 1) {
          plan.items.push(wardrobe);
        }
      }
      if (plan && saved.originalLayoutVersion < 4) {
        for (const measured of wallItems) {
          let existing = plan.items.find(item => item.name === measured.name);
          if (measured.shape === 'fridge') {
            const fridges = plan.items.filter(item => item.shape === 'fridge');
            const original = fridges.find(item => item.cx === 344.9 && item.cy === 774.8);
            existing = original || existing || (fridges.length === 1 ? fridges[0] : null);
          }
          if (existing) {
            const { cx, cy, width, depth, rotation, shape } = measured;
            Object.assign(existing, { cx, cy, width, depth, rotation, shape });
          } else {
            plan.items.push(measured);
          }
        }
      }
    }
    loaded.originalLayoutVersion = Math.max(defaults.originalLayoutVersion, saved.originalLayoutVersion || 0);
    for (const plan of loaded.plans) {
      if (usesVectorDrawing(plan, loaded)) clearFixedAreas(plan.items);
    }
    return loaded;
  }

  function sharedRoomState() {
    return createDefaultState(JSON.parse(document.getElementById('sharedRoomLayout').textContent));
  }

  let state = sharedRoomState();

  // 临时交互态（不落盘）
  const ui = {
    tool: 'select', // 'select' | 'draw-item' | 'place-outlet' | 'measure' | 'calibrate'
    placement: null, // 在画布上选定的添加位置（cm）
    selected: null, // { kind: 'item'|'outlet', id: string } | null
    checkedItems: new Set(),
    selectedColor: ITEM_COLORS[1].id,
    selectedOutletType: OUTLET_TYPES[0].id,
    areaInputMode: false,
    spacePressed: false,
    view: {
      autoFit: true,
      tx: 0,
      ty: 0,
      scale: 0.9 // screen px per cm
    },
    drag: null, // 当前拖拽会话
    guides: [], // 智能对齐辅助线
    measureLine: null, // { x1, y1, x2, y2 }
    calibrateLine: null, // { x1, y1, x2, y2 }
    drawBox: null, // { x1, y1, x2, y2 }
    editingPlanId: null
  };

  // 撤销 / 重做栈
  const history = {
    past: [],
    future: [],
    max: 50
  };

  /* =========================================================
     3. DOM 引用
     ========================================================= */
  const $ = (id) => document.getElementById(id);

  const dom = {
    planTabs: $('planTabs'),
    btnDuplicatePlan: $('btnDuplicatePlan'),
    btnUndo: $('btnUndo'),
    btnRedo: $('btnRedo'),
    btnImportJson: $('btnImportJson'),
    btnExportJson: $('btnExportJson'),
    btnExportPng: $('btnExportPng'),
    jsonFileInput: $('jsonFileInput'),

    addItemForm: $('addItemForm'),
    btnToggleAreaMode: $('btnToggleAreaMode'),
    dimInputRow: $('dimInputRow'),
    areaInputRow: $('areaInputRow'),
    newItemName: $('newItemName'),
    newItemW: $('newItemW'),
    newItemD: $('newItemD'),
    newItemArea: $('newItemArea'),
    newItemRatio: $('newItemRatio'),
    newItemAreaPreview: $('newItemAreaPreview'),
    newItemColors: $('newItemColors'),
    presetGrid: $('presetGrid'),
    itemCountBadge: $('itemCountBadge'),
    totalAreaSummary: $('totalAreaSummary'),
    itemList: $('itemList'),

    outletTypeGrid: $('outletTypeGrid'),
    btnStartPlaceOutlet: $('btnStartPlaceOutlet'),
    outletCountBadge: $('outletCountBadge'),
    outletList: $('outletList'),

    btnModeVector: $('btnModeVector'),
    btnModeImage: $('btnModeImage'),
    vectorControls: $('vectorControls'),
    imageModePanel: $('imageModePanel'),
    toggleFixtures: $('toggleFixtures'),
    toggleDoorSwings: $('toggleDoorSwings'),
    toggleFloorTexture: $('toggleFloorTexture'),

    floorplanDropzone: $('floorplanDropzone'),
    floorplanFileInput: $('floorplanFileInput'),
    bgControls: $('bgControls'),
    scaleDot: $('scaleDot'),
    scaleStatusText: $('scaleStatusText'),
    btnCalibrateFromPanel: $('btnCalibrateFromPanel'),
    bgOpacity: $('bgOpacity'),
    bgOpacityVal: $('bgOpacityVal'),
    btnRotateBg: $('btnRotateBg'),
    btnRemoveBg: $('btnRemoveBg'),
    btnClearItems: $('btnClearItems'),
    btnClearAll: $('btnClearAll'),

    canvasStage: $('canvasStage'),
    canvasSvg: $('canvasSvg'),
    viewportGroup: $('viewportGroup'),
    floorplanLayer: $('floorplanLayer'),
    itemsLayer: $('itemsLayer'),
    outletsLayer: $('outletsLayer'),
    overlayLayer: $('overlayLayer'),
    modeBanner: $('modeBanner'),
    modeBannerText: $('modeBannerText'),
    btnCancelMode: $('btnCancelMode'),
    dropOverlay: $('dropOverlay'),

    floatingActions: $('floatingActions'),

    scaleBarLine: $('scaleBarLine'),
    scaleBarLabel: $('scaleBarLabel'),
    snapSelect: $('snapSelect'),
    togglePowerLine: $('togglePowerLine'),
    btnZoomOut: $('btnZoomOut'),
    zoomLabel: $('zoomLabel'),
    btnZoomIn: $('btnZoomIn'),
    btnFitView: $('btnFitView'),

    inspectorPanel: $('inspectorPanel'),

    calibrateModal: $('calibrateModal'),
    calibrateForm: $('calibrateForm'),
    calibrateLength: $('calibrateLength'),
    calibrateUnit: $('calibrateUnit'),
    btnCancelCalibrate: $('btnCancelCalibrate'),

    planModal: $('planModal'),
    planForm: $('planForm'),
    planNameInput: $('planNameInput'),
    btnDeletePlan: $('btnDeletePlan'),
    btnCancelPlanModal: $('btnCancelPlanModal'),

    toastContainer: $('toastContainer')
  };

  /* =========================================================
     4. 持久化存储（IndexedDB 优先，回退 localStorage）
     ========================================================= */
  function openIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('No IDB'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistState, 220);
  }

  async function persistState() {
    const serialized = JSON.stringify(state);
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(serialized, STORAGE_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch (e) {
        // 忽略超额错误
      }
    }
  }

  async function loadPersistedState() {
    try {
      const db = await openIdb();
      const raw = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  /* =========================================================
     5. 撤销/重做与状态辅助函数
     ========================================================= */
  function snapshotState() {
    return JSON.stringify(state);
  }

  function pushHistory() {
    history.past.push(snapshotState());
    if (history.past.length > history.max) history.past.shift();
    history.future = [];
    updateHistoryButtons();
  }

  function undo() {
    if (!history.past.length) return;
    history.future.push(snapshotState());
    state = JSON.parse(history.past.pop());
    ensureSelectionValid();
    updateHistoryButtons();
    scheduleSave();
    renderAll();
    showToast('已撤销');
  }

  function redo() {
    if (!history.future.length) return;
    history.past.push(snapshotState());
    state = JSON.parse(history.future.pop());
    ensureSelectionValid();
    updateHistoryButtons();
    scheduleSave();
    renderAll();
    showToast('已重做');
  }

  function updateHistoryButtons() {
    dom.btnUndo.disabled = history.past.length === 0;
    dom.btnRedo.disabled = history.future.length === 0;
  }

  function getActivePlan() {
    let plan = state.plans.find((p) => p.id === state.activePlanId);
    if (!plan) {
      plan = state.plans[0];
      state.activePlanId = plan.id;
    }
    return plan;
  }

  function floorplanMode() {
    return getActivePlan().floorplanMode ?? state.floorplanMode;
  }

  function usesVectorDrawing(plan = getActivePlan(), project = state) {
    return (plan.floorplanMode ?? project.floorplanMode) !== 'image' || !project.background;
  }

  function setFloorplanMode(mode) {
    const plan = getActivePlan();
    if (plan.floorplanMode !== undefined) plan.floorplanMode = mode;
    else state.floorplanMode = mode;
    if (mode === 'vector') {
      for (const p of state.plans) {
        if (usesVectorDrawing(p)) clearFixedAreas(p.items);
      }
    }
  }

  function visibleItems() {
    const items = getActivePlan().items;
    return state.vectorOptions.showFixtures === false ? items.filter(item => !item.fixture) : items;
  }

  function getItemById(id) {
    return getActivePlan().items.find((it) => it.id === id) || null;
  }

  function getOutletById(id) {
    return state.outlets.find((o) => o.id === id) || null;
  }

  function ensureSelectionValid() {
    ui.checkedItems.clear();
    if (!ui.selected) return;
    if (ui.selected.kind === 'item' && !getItemById(ui.selected.id)) {
      ui.selected = null;
    } else if (ui.selected.kind === 'outlet' && !getOutletById(ui.selected.id)) {
      ui.selected = null;
    }
  }

  function getColorDef(id) {
    return ITEM_COLORS.find((c) => c.id === id) || ITEM_COLORS[0];
  }

  function getOutletTypeDef(id) {
    return OUTLET_TYPES.find((t) => t.id === id) || OUTLET_TYPES[0];
  }

  function getItemBox(item) {
    const rot = ((item.rotation || 0) % 360 + 360) % 360;
    const swapped = rot === 90 || rot === 270;
    const effW = swapped ? item.depth : item.width;
    const effD = swapped ? item.width : item.depth;
    return {
      effW,
      effD,
      left: item.cx - effW / 2,
      right: item.cx + effW / 2,
      top: item.cy - effD / 2,
      bottom: item.cy + effD / 2
    };
  }

  function calcAreaSqm(w, d) {
    return (w * d) / 10000;
  }

  function overlapsBox(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  function fixedAreaName(box) {
    if (overlapsBox(box, bedroomBay)) return '飘窗';
    if (overlapsBox(box, bayWall)) return '固定墙块';
    return '';
  }

  function placementIssue(item) {
    if (!usesVectorDrawing()) return '';
    const area = fixedAreaName(getItemBox(item));
    return area ? `物品占到了${area}，请换个位置` : '';
  }

  function canPlaceItem(item) {
    const message = placementIssue(item);
    if (message) showToast(message);
    return !message;
  }

  // 旧图中压到飘窗或墙块的家具优先移到卧室内最近的空位，保留尺寸和朝向。
  function clearFixedAreas(items) {
    const displaced = items.filter(item => fixedAreaName(getItemBox(item)));
    if (!displaced.length) return;
    const occupied = items.filter(item => !displaced.includes(item) && !item.stackable)
      .map(getItemBox).filter(box => overlapsBox(box, { ...bedroomBay, top: bedroomBay.bottom, bottom: 415 }));
    displaced.sort((a, b) => b.width * b.depth - a.width * a.depth);
    for (const item of displaced) {
      const { effW, effD, left, top } = getItemBox(item);
      const xs = new Set([left, bedroomBay.left, bedroomBay.right - effW]);
      const ys = new Set([top, bedroomBay.bottom, 415 - effD]);
      for (const box of [bayWall, ...occupied]) {
        xs.add(box.left - effW).add(box.right);
        ys.add(box.top - effD).add(box.bottom);
      }
      let best = null;
      let distance = Infinity;
      for (const x of xs) for (const y of ys) {
        const box = { left: x, top: y, right: x + effW, bottom: y + effD };
        if (x < bedroomBay.left || box.right > bedroomBay.right || y < bedroomBay.bottom || box.bottom > 415) continue;
        if (fixedAreaName(box) || (!item.stackable && occupied.some(other => overlapsBox(other, box)))) continue;
        const delta = Math.hypot(x - left, y - top);
        if (delta < distance) { distance = delta; best = box; }
      }
      // 房间过满或物品过大时，仅向室内移出禁放区，沿用已有的家具重叠提示。
      if (best) item.cx = best.left + effW / 2;
      const below = left + effW > bayWall.left && left < bayWall.right ? bayWall.bottom : bedroomBay.bottom;
      item.cy = (best ? best.top : below) + effD / 2;
      if (!item.stackable) occupied.push(getItemBox(item));
    }
  }

  function formatArea(sqm) {
    return sqm < 0.1 ? sqm.toFixed(3) : sqm.toFixed(2);
  }

  function formatDim(cm) {
    return Math.round(cm * 10) / 10;
  }

  function snapValue(val, step) {
    if (!step || step <= 0) return Math.round(val * 10) / 10;
    return Math.round(val / step) * step;
  }

  function getFloorplanBounds() {
    if (floorplanMode() === 'image' && state.background) {
      const bg = state.background;
      const rot = ((bg.rotation || 0) % 360 + 360) % 360;
      const rawW = bg.naturalWidth * bg.cmPerPx;
      const rawH = bg.naturalHeight * bg.cmPerPx;
      const w = (rot === 90 || rot === 270) ? rawH : rawW;
      const h = (rot === 90 || rot === 270) ? rawW : rawH;
      return { x: 0, y: 0, width: w, height: h };
    }
    return { x: 0, y: 0, width: VECTOR_PLAN.width, height: VECTOR_PLAN.height };
  }

  /* =========================================================
     6. 坐标转换与视图控制
     ========================================================= */
  function clientToWorld(clientX, clientY) {
    const rect = dom.canvasSvg.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      x: (sx - ui.view.tx) / ui.view.scale,
      y: (sy - ui.view.ty) / ui.view.scale
    };
  }

  function worldToStage(wx, wy) {
    return {
      x: wx * ui.view.scale + ui.view.tx,
      y: wy * ui.view.scale + ui.view.ty
    };
  }

  function applyViewportTransform() {
    dom.viewportGroup.setAttribute(
      'transform',
      `translate(${ui.view.tx.toFixed(2)}, ${ui.view.ty.toFixed(2)}) scale(${ui.view.scale.toFixed(4)})`
    );
    $('dimensionLayer').style.fontSize = `${11 / ui.view.scale}px`;
    updateZoomAndScaleBar();
    updatePlacementActions();
  }

  function fitView() {
    const rect = dom.canvasSvg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const bounds = getFloorplanBounds();
    // 矢量户型底部有入户小三角，预留 26cm 高度；底部避开悬浮 HUD
    const extraBottomCm = floorplanMode() === 'vector' ? 28 : 0;
    const totalH = bounds.height + extraBottomCm;
    const compact = rect.width <= 700;
    const padX = compact ? 33 : 74;
    const padTop = compact ? 52 : 62;
    const padBottom = compact ? 122 : 110;
    ui.view.autoFit = true;
    const availW = Math.max(1, rect.width - padX * 2);
    const availH = Math.max(1, rect.height - padTop - padBottom);
    const scale = Math.min(availW / bounds.width, availH / totalH, 2.2);
    ui.view.scale = scale;
    ui.view.tx = (rect.width - bounds.width * ui.view.scale) / 2 - bounds.x * ui.view.scale;
    ui.view.ty = padTop + (availH - totalH * ui.view.scale) / 2 - bounds.y * ui.view.scale;
    applyViewportTransform();
    renderItems();
  }

  // 面板开合和窗口缩放共用同一次尺寸更新，保留手动平移、缩放后的观察位置。
  let canvasSize = null;
  function syncCanvasSize() {
    const rect = dom.canvasSvg.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const previous = canvasSize;
    if (previous && rect.width === previous.width && rect.height === previous.height) return;
    canvasSize = { width: rect.width, height: rect.height };
    if (ui.view.autoFit || !previous) {
      fitView();
    } else {
      ui.view.tx += (rect.width - previous.width) / 2;
      ui.view.ty += (rect.height - previous.height) / 2;
      applyViewportTransform();
    }
  }

  function zoomAt(factor, centerX, centerY) {
    const rect = dom.canvasSvg.getBoundingClientRect();
    const cx = centerX !== undefined ? centerX : rect.width / 2;
    const cy = centerY !== undefined ? centerY : rect.height / 2;
    const wx = (cx - ui.view.tx) / ui.view.scale;
    const wy = (cy - ui.view.ty) / ui.view.scale;
    const nextScale = Math.min(4.5, Math.max(0.22, ui.view.scale * factor));
    ui.view.autoFit = false;
    ui.view.scale = nextScale;
    ui.view.tx = cx - wx * nextScale;
    ui.view.ty = cy - wy * nextScale;
    applyViewportTransform();
    renderItems();
  }

  function updateZoomAndScaleBar() {
    // 100% 基准约为 0.85 px/cm（即 1 米约 85 px）
    const pct = Math.round((ui.view.scale / 0.85) * 100);
    dom.zoomLabel.textContent = `${pct}%`;

    // 选择美观的标尺长度（20 / 50 / 100 / 200 cm）
    const candidates = [20, 50, 100, 200, 500];
    let chosen = 100;
    for (const c of candidates) {
      const px = c * ui.view.scale;
      if (px >= 54 && px <= 130) {
        chosen = c;
        break;
      }
    }
    const barPx = Math.max(40, Math.min(140, chosen * ui.view.scale));
    dom.scaleBarLine.style.width = `${Math.round(barPx)}px`;
    dom.scaleBarLabel.textContent = chosen >= 100 ? `${chosen / 100} m` : `${chosen} cm`;
  }

  /* =========================================================
     7. SVG 辅助构造器
     ========================================================= */
  function svgEl(tag, attrs = {}, parent = null) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v !== undefined && v !== null) el.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(el);
    return el;
  }

  /* =========================================================
     8. 精绘矢量户型渲染（基于用户上传户型，全去文字、真实比例）
     ========================================================= */
  function renderFloorplan() {
    dom.floorplanLayer.innerHTML = '';
    const bounds = getFloorplanBounds();
    const pad = Math.max(bounds.width, bounds.height) * 0.095;
    $('planThumbnail').setAttribute('viewBox', `${-pad} ${-pad} ${bounds.width + 2 * pad} ${bounds.height + 2 * pad}`);
    const dimensionLayer = $('dimensionLayer');
    dimensionLayer.replaceChildren();
    if (usesVectorDrawing()) {
      const { width, height } = VECTOR_PLAN;
      for (const vertical of [false, true]) {
        const length = vertical ? height : width;
        const rule = svgEl('g', { transform: vertical ? 'translate(-32,0) rotate(-90)' : 'translate(0,-28)' }, dimensionLayer);
        const end = vertical ? -length : length;
        svgEl('path', { d: `M0 -5V5 M0 0H${end} M${end} -5V5`, fill: 'none', stroke: '#8D9AAF', 'stroke-width': 1.2 }, rule);
        svgEl('text', { x: end / 2, y: -6, 'text-anchor': 'middle', fill: '#546378', 'font-weight': 500 }, rule).textContent = `${(length / 100).toFixed(2)} m`;
      }
    }

    if (!usesVectorDrawing()) {
      renderCustomImageFloorplan();
      return;
    }

    const opts = state.vectorOptions || { showFixtures: true, showDoorSwings: true, showFloorTexture: true };
    const root = svgEl('g', { id: 'vectorFloorplanRoot' }, dom.floorplanLayer);

    // 整体白底外轮廓阴影层（精确沿着实际室内外轮廓包络，不含室外采光槽）
    const envelopePath = [
      'M 0 0',
      'L 611 0',
      'L 611 646',
      'L 671 646',
      'L 671 567',
      'L 691 567',
      'L 691 830',
      'L 0 830',
      'Z'
    ].join(' ');
    svgEl('path', {
      d: envelopePath,
      fill: '#FAF8F4',
      filter: 'url(#planShadow)'
    }, root);

    // ----- A. 地面材质分区（无任何文字） -----
    const floors = svgEl('g', { id: 'floorZones' }, root);
    const woodFill = opts.showFloorTexture ? 'url(#woodPattern)' : '#EBDFC9';
    const stoneFill = opts.showFloorTexture ? 'url(#stonePattern)' : '#F3F0E8';
    const bathFill = opts.showFloorTexture ? 'url(#bathTilePattern)' : '#D6E8ED';
    const balconyFill = opts.showFloorTexture ? 'url(#balconyPattern)' : '#DFE6DC';

    // 门洞内的材质分界在两段短墙中心之间直连。
    const leftTipX = leftReturn.x + leftReturn.width;
    const leftMidY = leftReturn.y + leftReturn.height / 2;
    const rightMidY = rightReturn.y + rightReturn.height / 2;
    const threshold = `19,${leftMidY} ${leftTipX},${leftMidY} ${rightReturn.x},${rightMidY} ${dividerX},${rightMidY}`;
    svgEl('polygon', { points: `${threshold} ${dividerX},${balconyWindowInside} 19,${balconyWindowInside}`, fill: balconyFill }, floors);
    // 飘窗台面
    const bay = svgEl('rect', {
      x: bedroomBay.left, y: bedroomBay.top, width: bedroomBay.right - bedroomBay.left,
      height: bedroomBay.bottom - bedroomBay.top, fill: 'url(#bayStone)'
    }, floors);
    svgEl('title', {}, bay).textContent = '飘窗 · 进深 81 cm · 不能摆放家具';
    svgEl('line', { x1: bedroomBay.left, y1: bedroomBay.bottom, x2: bedroomBay.right, y2: bedroomBay.bottom, stroke: '#B6BEC2', 'stroke-width': 1.2 }, floors);

    // 卧室 A（左上）
    svgEl('polygon', { points: `${threshold} ${dividerX},${bedroomAWallY} 19,${bedroomAWallY}`, fill: woodFill }, floors);
    // 卧室 B（右上 + 门厅）
    svgEl('path', {
      d: `M ${bedroomBay.left} ${bedroomBay.bottom} H ${bedroomBay.right} V 416 H 410 V 460 H ${bedroomBay.left} Z`,
      fill: woodFill
    }, floors);

    // 客厅 + 过道 + 厨房地面
    svgEl('path', {
      d: `M 19 ${bedroomAWallY} H ${dividerX} V 460 H 410 V 655 H 671 V 810 H 19 Z`,
      fill: stoneFill
    }, floors);

    // 卫生间地面
    svgEl('rect', { x: 418, y: 424, width: 175, height: 223, fill: bathFill }, floors);

    // 阳台与卧室 A 之间的细微地面压条线（仅视觉区分，不阻挡摆放）
    svgEl('line', {
      x1: leftTipX, y1: leftMidY, x2: rightReturn.x, y2: rightMidY,
      stroke: '#D6CEC1', 'stroke-width': 1.2, 'stroke-dasharray': '5 4'
    }, floors);

    // ----- B. 固定厨卫与管道井设施（简约建筑线稿，可开关） -----
    if (opts.showFixtures) {
      const fix = svgEl('g', { id: 'fixedFixtures', opacity: '0.94' }, root);

      // 1) 卫生间右上角管道井 & 风道（建筑斜纹）
      svgEl('rect', {
        x: 506, y: 424, width: 87, height: 68,
        fill: 'url(#shaftHatch)', stroke: '#8E97A0', 'stroke-width': 1.1
      }, fix);
      // 三个小管井交叉线
      const shafts = [
        [506, 424, 30, 68],
        [536, 464, 28, 28],
        [564, 464, 29, 28]
      ];
      for (const [sx, sy, sw, sh] of shafts) {
        svgEl('rect', { x: sx, y: sy, width: sw, height: sh, fill: 'none', stroke: '#8C959E', 'stroke-width': 0.9 }, fix);
        svgEl('line', { x1: sx, y1: sy, x2: sx + sw, y2: sy + sh, stroke: '#9BA4AD', 'stroke-width': 0.7 }, fix);
        svgEl('line', { x1: sx + sw, y1: sy, x2: sx, y2: sy + sh, stroke: '#9BA4AD', 'stroke-width': 0.7 }, fix);
      }

      if (!getActivePlan().editableFixtures) {
        // 2) 卫生间洗手台
        svgEl('rect', {
          x: 420, y: 425, width: 84, height: 47, rx: 2,
          fill: '#FFFFFF', stroke: '#7B8B94', 'stroke-width': 1.1
        }, fix);
        svgEl('rect', {
          x: 438, y: 432, width: 48, height: 32, rx: 5,
          fill: '#F1F7F9', stroke: '#8FA3AE', 'stroke-width': 0.95
        }, fix);
        svgEl('circle', { cx: 462, cy: 438, r: 2.3, fill: '#7B8B94' }, fix);

        // 3) 卫生间马桶
        svgEl('rect', {
          x: 441, y: 615, width: 38, height: 26, rx: 4,
          fill: '#FFFFFF', stroke: '#7B8B94', 'stroke-width': 1.1
        }, fix);
        svgEl('ellipse', {
          cx: 460, cy: 593, rx: 17, ry: 24,
          fill: '#FFFFFF', stroke: '#7B8B94', 'stroke-width': 1.1
        }, fix);
        svgEl('ellipse', {
          cx: 460, cy: 591, rx: 11.5, ry: 17,
          fill: '#F1F7F9', stroke: '#9BAFB9', 'stroke-width': 0.85
        }, fix);

        // 4) 淋浴区玻璃隔断 + 花洒 + 地漏
        svgEl('rect', {
          x: 503, y: 492, width: 90, height: 154,
          fill: '#D8E9EE', opacity: '0.45'
        }, fix);
        svgEl('line', {
          x1: 503, y1: 492, x2: 503, y2: 646,
          stroke: '#648594', 'stroke-width': 2.2, 'stroke-dasharray': '10 3'
        }, fix);
        svgEl('line', {
          x1: 503, y1: 492, x2: 593, y2: 492,
          stroke: '#648594', 'stroke-width': 1.4
        }, fix);
        // 花洒图标
        svgEl('circle', { cx: 550, cy: 622, r: 6.5, fill: '#FFFFFF', stroke: '#6E8591', 'stroke-width': 1 }, fix);
        svgEl('line', { x1: 550, y1: 628.5, x2: 550, y2: 644, stroke: '#6E8591', 'stroke-width': 1.2 }, fix);
        // 两个地漏小方块
        for (const [dx, dy] of [[424, 628], [574, 628]]) {
          svgEl('rect', { x: dx, y: dy, width: 11, height: 11, fill: '#FFFFFF', stroke: '#8E9FA8', 'stroke-width': 0.85 }, fix);
          svgEl('line', { x1: dx, y1: dy, x2: dx + 11, y2: dy + 11, stroke: '#8E9FA8', 'stroke-width': 0.65 }, fix);
          svgEl('line', { x1: dx + 11, y1: dy, x2: dx, y2: dy + 11, stroke: '#8E9FA8', 'stroke-width': 0.65 }, fix);
        }

        // 5) 厨房固定操作台面（底部操作台 + 右侧水槽台，左侧冰箱空位保留空白以便放设备）
        svgEl('rect', {
          x: 386, y: 744, width: 154, height: 65, rx: 1.5,
          fill: '#FDFBF7', stroke: '#A3988C', 'stroke-width': 1.1
        }, fix);
        // 嵌入式炉灶 / 厨电示意（简约双圆）
        svgEl('rect', {
          x: 468, y: 752, width: 64, height: 48, rx: 4,
          fill: '#F7F3EC', stroke: '#B0A598', 'stroke-width': 0.9
        }, fix);
        svgEl('circle', { cx: 486, cy: 776, r: 11, fill: 'none', stroke: '#8E8478', 'stroke-width': 1 }, fix);
        svgEl('circle', { cx: 486, cy: 776, r: 4.5, fill: 'none', stroke: '#8E8478', 'stroke-width': 0.85 }, fix);
        svgEl('circle', { cx: 514, cy: 776, r: 9.5, fill: 'none', stroke: '#8E8478', 'stroke-width': 1 }, fix);
        svgEl('circle', { cx: 514, cy: 776, r: 4, fill: 'none', stroke: '#8E8478', 'stroke-width': 0.85 }, fix);
        // 左侧嵌入式厨电小方框
        svgEl('rect', {
          x: 404, y: 754, width: 42, height: 44, rx: 3,
          fill: '#F7F3EC', stroke: '#B0A598', 'stroke-width': 0.9
        }, fix);
        svgEl('circle', { cx: 425, cy: 776, r: 10, fill: 'none', stroke: '#9B9186', 'stroke-width': 0.9 }, fix);

        // 厨房右侧水槽区
        svgEl('rect', {
          x: 604, y: 657, width: 66, height: 115, rx: 1.5,
          fill: '#FDFBF7', stroke: '#A3988C', 'stroke-width': 1.1
        }, fix);
        svgEl('rect', {
          x: 615, y: 684, width: 44, height: 56, rx: 5,
          fill: '#F2F6F7', stroke: '#92A0A6', 'stroke-width': 0.95
        }, fix);
        svgEl('circle', { cx: 639, cy: 712, r: 3, fill: '#92A0A6' }, fix);
        svgEl('line', { x1: 659, y1: 712, x2: 646, y2: 712, stroke: '#7D8B91', 'stroke-width': 1.5, 'stroke-linecap': 'round' }, fix);
      }

      // 厨房右下烟道/管道井（斜纹）
      const kitchenShafts = [
        [540, 744, 18, 65],
        [611, 773, 59, 36]
      ];
      for (const [sx, sy, sw, sh] of kitchenShafts) {
        svgEl('rect', {
          x: sx, y: sy, width: sw, height: sh,
          fill: 'url(#shaftHatch)', stroke: '#8E97A0', 'stroke-width': 1
        }, fix);
      }
    }

    // ----- C. 窗户（建筑双线玻璃窗） -----
    const windows = svgEl('g', { id: 'windowsLayer' }, root);
    function drawHorizontalWindow(x, y, w, h) {
      svgEl('rect', { x, y, width: w, height: h, fill: '#FFFFFF', stroke: '#525B64', 'stroke-width': 1.1 }, windows);
      svgEl('rect', { x, y: y + h * 0.28, width: w, height: h * 0.44, fill: '#C8DEE6', stroke: '#5D7482', 'stroke-width': 0.9 }, windows);
      svgEl('line', { x1: x, y1: y + h / 2, x2: x + w, y2: y + h / 2, stroke: '#5D7482', 'stroke-width': 0.7 }, windows);
    }
    function drawVerticalWindow(x, y, w, h) {
      svgEl('rect', { x, y, width: w, height: h, fill: '#FFFFFF', stroke: '#525B64', 'stroke-width': 1.1 }, windows);
      svgEl('rect', { x: x + w * 0.28, y, width: w * 0.44, height: h, fill: '#C8DEE6', stroke: '#5D7482', 'stroke-width': 0.9 }, windows);
      svgEl('line', { x1: x + w / 2, y1: y, x2: x + w / 2, y2: y + h, stroke: '#5D7482', 'stroke-width': 0.7 }, windows);
    }

    // 阳台顶部通窗
    drawHorizontalWindow(19, 1, dividerX - 19, balconyWindowInside - 1);
    // 飘窗顶部通窗
    drawHorizontalWindow(314, 1, 279, 18);
    // 飘窗右侧小窗
    drawVerticalWindow(593, 19, 17, 56);
    // 卫生间右侧窗户
    drawVerticalWindow(593, 567, 17, 60);
    // 厨房右侧采光窗
    drawHorizontalWindow(611, 646, 60, 10);

    // ----- D. 开门弧线（防家具挡门，可开关） -----
    if (opts.showDoorSwings) {
      const doors = svgEl('g', { id: 'doorSwingsLayer' }, root);

      // 辅助画门函数：铰链(hx,hy)，开启门扇终点(lx,ly)，关闭门洞终点(cx,cy)，顺逆时针sweep
      function drawDoor(hx, hy, lx, ly, cx, cy, r, sweepFlag) {
        // 门扇扫过淡淡底色
        svgEl('path', {
          d: `M ${hx} ${hy} L ${lx} ${ly} A ${r} ${r} 0 0 ${sweepFlag} ${cx} ${cy} Z`,
          fill: '#C6B7A4',
          opacity: '0.13'
        }, doors);
        // 虚线开门弧
        svgEl('path', {
          d: `M ${lx} ${ly} A ${r} ${r} 0 0 ${sweepFlag} ${cx} ${cy}`,
          fill: 'none',
          stroke: '#9B8F80',
          'stroke-width': 1.1,
          'stroke-dasharray': '4 3'
        }, doors);
        // 门扇实线
        svgEl('line', {
          x1: hx, y1: hy, x2: lx, y2: ly,
          stroke: '#7D6F5D',
          'stroke-width': 3.2,
          'stroke-linecap': 'round'
        }, doors);
      }

      // 两扇卧室门均向卧室内开，铰链位于中隔墙两侧。
      drawDoor(dividerX, bedroomAWallY, dividerX, bedroomAWallY - doorWidth.bedroomA,
        dividerX - doorWidth.bedroomA, bedroomAWallY, doorWidth.bedroomA, 0);
      drawDoor(bedroomBHingeX, 459, bedroomBHingeX, 459 - doorWidth.bedroomB, bedroomBJambX, 459, doorWidth.bedroomB, 1);
      // 3) 卫生间门：铰链在上(418, 478)，向卫生间右内开，门宽 80cm
      drawDoor(418, 478, 498, 478, 418, 558, 80, 1);
      // 入户门右侧铰链，向内开。
      drawDoor(entryHingeX, 810, entryHingeX, 810 - doorWidth.entry, entryJambX, 810, doorWidth.entry, 0);
      // 5) 飘窗右侧内开小窗弧线
      svgEl('path', {
        d: 'M 593 74 A 44 44 0 0 1 555 46 L 593 26',
        fill: 'none',
        stroke: '#9AA6AE',
        'stroke-width': 0.9,
        'stroke-dasharray': '3 3'
      }, doors);
    }

    // 入户门门槛与极简入口小三角提示（优雅深青灰，非刺眼大红）
    svgEl('rect', { x: entryJambX, y: 814, width: doorWidth.entry, height: 10, fill: '#E8DFD3', stroke: '#B9AC9C', 'stroke-width': 0.8 }, root);
    const entryCenter = entryJambX + doorWidth.entry / 2;
    svgEl('polygon', {
      points: `${entryCenter},836 ${entryCenter - 10},852 ${entryCenter + 10},852`,
      fill: '#1865CF',
      opacity: '0.78'
    }, root);

    // ----- E. 承重墙、剪力墙、柱体与隔墙（精确 cm 坐标） -----
    const walls = svgEl('g', { id: 'wallsLayer', filter: 'url(#wallShadow)' }, root);
    const WALL_FILL = '#354352';
    const PART_FILL = '#495765';

    // 主承重墙与结构柱
    const structuralRects = [
      // 左侧外墙全长
      [0, 0, 19, 830],
      // 中间承重隔墙（阳台/卧室 A 与 飘窗/卧室 B 之间）
      [dividerX, 0, 18, 467],
      // 右侧外墙（上段窗头、中段主墙、下段卫窗下墙）
      [593, 0, 18, 19],
      [593, 75, 18, 492],
      [593, 627, 18, 29],
      // 最右侧厨房外墙
      [671, 567, 20, 263],
      // 底部外墙（入户门左侧 & 右侧）
      [0, 810, entryJambX, 20],
      [entryHingeX, 810, VECTOR_PLAN.width - entryHingeX, 20],

      // 结构柱 / 梁垛（与原图逐一对应）
      [19, 20, 38, 10],    // 阳台左上小垛
      [leftReturn.x, leftReturn.y, leftReturn.width, leftReturn.height],
      [rightReturn.x, rightReturn.y, rightReturn.width, rightReturn.height],
      [19, 775, 34, 35],   // 客厅左下柱
      [35, 755, 18, 20],   // 客厅左下柱内小凹垛
      [bayWall.left, bayWall.top, bayWall.right - bayWall.left, bayWall.bottom - bayWall.top],
      [558, 415, 35, 52],  // 卧室B/卫生间 右中柱
      [558, 776, 53, 34]   // 厨房底右柱
    ];

    for (const [x, y, w, h] of structuralRects) {
      svgEl('rect', { x, y, width: w, height: h, fill: WALL_FILL }, walls);
    }

    // 室内轻质隔墙（10cm 墙厚）
    const partitionRects = [
      [19, bedroomAWallY, dividerX - doorWidth.bedroomA - 19, bedroomAWallThickness],
      [bedroomBJambX, 459, 409 - bedroomBJambX, bedroomAWallThickness], // 门洞右沿接卫生间左墙
      [409, 415, 184, 10], // 卫生间顶隔墙
      [409, 415, 10, 63],  // 卫生间左隔墙（门上）
      [409, 558, 10, 98],  // 卫生间左隔墙（门下）
      [409, 646, 202, 10], // 卫生间底隔墙
      [306, 587, 10, 223]  // 客厅/厨房隔墙
    ];

    for (const [x, y, w, h] of partitionRects) {
      svgEl('rect', { x, y, width: w, height: h, fill: PART_FILL }, walls);
    }
  }

  function renderCustomImageFloorplan() {
    const bg = state.background;
    if (!bg) return;
    const rawW = bg.naturalWidth * bg.cmPerPx;
    const rawH = bg.naturalHeight * bg.cmPerPx;
    const rot = ((bg.rotation || 0) % 360 + 360) % 360;
    const g = svgEl('g', { opacity: String(bg.opacity ?? 0.75) }, dom.floorplanLayer);

    let transform = '';
    if (rot === 90) transform = `translate(${rawH}, 0) rotate(90)`;
    else if (rot === 180) transform = `translate(${rawW}, ${rawH}) rotate(180)`;
    else if (rot === 270) transform = `translate(0, ${rawW}) rotate(270)`;

    const inner = svgEl('g', { transform }, g);
    svgEl('image', {
      href: bg.dataUrl,
      x: 0,
      y: 0,
      width: rawW,
      height: rawH,
      preserveAspectRatio: 'none'
    }, inner);
  }

  /* =========================================================
     9. 渲染设备/家具、插孔与辅助叠加层
     ========================================================= */
  function findOverlappingItemIds(items) {
    const overlapping = new Set();
    const boxes = items.map((it) => ({ item: it, box: getItemBox(it) }));
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].item.stackable) continue;
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[j].item.stackable) continue;
        const a = boxes[i].box;
        const b = boxes[j].box;
        // 留 0.5 cm 容差，紧贴摆放不算碰撞
        const hit = a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
        if (hit) {
          overlapping.add(boxes[i].item.id);
          overlapping.add(boxes[j].item.id);
        }
      }
    }
    return overlapping;
  }

  function renderItems(scale = ui.view.scale, showSelection = true) {
    dom.itemsLayer.innerHTML = '';
    const items = visibleItems();
    const overlappingIds = findOverlappingItemIds(items);

    for (const item of items) {
      const box = getItemBox(item);
      const col = getColorDef(item.color);
      const isSelected = showSelection && (ui.checkedItems.has(item.id) ||
        (ui.selected?.kind === 'item' && ui.selected.id === item.id));
      const isOverlap = overlappingIds.has(item.id);
      const rot = ((item.rotation || 0) % 360 + 360) % 360;

      const g = svgEl('g', {
        class: `item-group${item.locked ? ' locked' : ''}`,
        'data-kind': 'item',
        'data-id': item.id
      }, dom.itemsLayer);

      const symbol = item.shape && document.getElementById(`piece-${item.shape}`);
      if (symbol?.localName === 'symbol') {
        const object = svgEl('g', { transform: `translate(${item.cx} ${item.cy}) rotate(${rot})` }, g);
        const bounds = { x: -item.width / 2, y: -item.depth / 2, width: item.width, height: item.depth };
        svgEl('rect', { ...bounds, fill: 'transparent' }, object);
        svgEl('use', {
          ...bounds, href: `#${symbol.id}`, fill: col.fill,
          stroke: isOverlap ? '#B43B3A' : col.stroke, 'stroke-width': 1.6,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }, object);
      } else {
        // 同一组局部坐标描述设备与正面，旋转时两者绕同一个中心点转动。
        const object = svgEl('g', { transform: `translate(${item.cx} ${item.cy}) rotate(${rot})` }, g);
        svgEl('rect', {
          x: -item.width / 2, y: -item.depth / 2, width: item.width, height: item.depth,
          rx: Math.min(4, Math.min(item.width, item.depth) * 0.12),
          fill: col.fill, 'fill-opacity': item.stackable ? 0.84 : 0.92,
          stroke: isOverlap ? '#C93B3B' : (isSelected ? '#1865CF' : col.stroke),
          'stroke-width': isSelected ? 2.4 : (isOverlap ? 2 : 1.4),
          'stroke-dasharray': isOverlap ? '5 3' : (item.stackable ? '3 2' : null)
        }, object);
        const bar = Math.min(4.5, Math.min(item.width, item.depth) * 0.14);
        const inset = Math.min(8, Math.min(item.width, item.depth) * 0.18);
        svgEl('rect', {
          x: -item.width / 2 + inset, y: item.depth / 2 - bar - 1.5,
          width: Math.max(4, item.width - 2 * inset), height: bar, rx: bar / 2, fill: col.accent, opacity: 0.68
        }, object);
      }

      // 选中外框高亮虚线
      if (isSelected) {
        svgEl('rect', {
          x: box.left - 3,
          y: box.top - 3,
          width: box.effW + 6,
          height: box.effD + 6,
          rx: 5,
          fill: 'none',
          stroke: '#1865CF',
          'stroke-width': 1.2,
          'stroke-dasharray': '4 3',
          'pointer-events': 'none'
        }, g);
      }

      // 小物品优先显示名称，有足够的屏幕空间时再显示尺寸。
      svgEl('title', {}, g).textContent = `${item.name} · ${formatDim(item.width)} × ${formatDim(item.depth)} cm`;
      if (symbol && !item.showLabel && !isSelected) continue;
      const available = Math.max(0, box.effW - 6);
      const chars = Array.from(String(item.name || '物品'));
      const glyphWidth = (char) => char.codePointAt(0) > 255 ? 1 : 0.58;
      const units = chars.reduce((sum, char) => sum + glyphWidth(char), 0);
      const size = Math.min(box.effD * 0.45, 14 / scale, Math.max(9 / scale, available / Math.max(1, units)));
      if (available < size || size * scale < 7) continue;
      let label = chars.join('');
      if (units * size > available) {
        let used = 1;
        label = '';
        for (const char of chars) {
          used += glyphWidth(char);
          if (used * size > available) break;
          label += char;
        }
        label += '…';
      }
      const showSize = box.effW * scale >= 82 && box.effD * scale >= 44;
      svgEl('text', {
        x: item.cx, y: item.cy + (showSize ? -3 / scale : size * 0.32),
        'text-anchor': 'middle', 'font-size': size, 'font-weight': 600,
        fill: '#26354A', 'pointer-events': 'none'
      }, g).textContent = label;
      if (showSize) {
        svgEl('text', {
          x: item.cx, y: item.cy + 12 / scale, 'text-anchor': 'middle',
          'font-size': 10 / scale, fill: '#526074', 'pointer-events': 'none'
        }, g).textContent = `${formatDim(item.width)} × ${formatDim(item.depth)} cm`;
      }
    }
  }

  function renderOutlets() {
    dom.outletsLayer.innerHTML = '';

    for (const o of state.outlets) {
      const def = getOutletTypeDef(o.type);
      const isSelected = ui.selected && ui.selected.kind === 'outlet' && ui.selected.id === o.id;

      const g = svgEl('g', {
        class: 'outlet-group',
        'data-kind': 'outlet',
        'data-id': o.id,
        transform: `translate(${o.x}, ${o.y})`
      }, dom.outletsLayer);

      svgEl('circle', { class: 'outlet-hit', r: 10, fill: 'transparent' }, g);

      // 选中光环
      if (isSelected) {
        svgEl('circle', {
          cx: 0, cy: 0, r: 15,
          fill: def.color,
          opacity: '0.18'
        }, g);
        svgEl('circle', {
          cx: 0, cy: 0, r: 13.5,
          fill: 'none',
          stroke: def.color,
          'stroke-width': 1.5,
          'stroke-dasharray': '3 2'
        }, g);
      }

      // 外白环 + 彩色圆标
      svgEl('circle', {
        cx: 0, cy: 0, r: 10.5,
        fill: '#FFFFFF',
        stroke: def.color,
        'stroke-width': 2
      }, g);
      svgEl('circle', {
        cx: 0, cy: 0, r: 7.5,
        fill: def.color
      }, g);

      const glyph = svgEl('text', {
        x: 0,
        y: 3.3,
        'text-anchor': 'middle',
        'font-size': '9',
        'font-weight': '700',
        fill: '#FFFFFF',
        'pointer-events': 'none'
      }, g);
      glyph.textContent = def.short;

      // 数量角标（如 ×2）
      if (o.count && o.count > 1) {
        svgEl('rect', {
          x: 6, y: -13, width: 17, height: 11, rx: 5.5,
          fill: '#1F2328', stroke: '#FFFFFF', 'stroke-width': 1
        }, g);
        const cnt = svgEl('text', {
          x: 14.5, y: -4.5,
          'text-anchor': 'middle',
          'font-size': '7.5',
          'font-weight': '700',
          fill: '#FFFFFF',
          'pointer-events': 'none'
        }, g);
        cnt.textContent = `×${o.count}`;
      }

      // 简短标签（若有自定义名称则显示在下方）
      if (o.label) {
        const labelLen = o.label.length * 8.5 + 10;
        svgEl('rect', {
          x: -labelLen / 2, y: 13, width: labelLen, height: 14, rx: 4,
          fill: 'rgba(255,255,255,0.92)',
          stroke: 'rgba(31,35,40,0.14)',
          'stroke-width': 0.8,
          'pointer-events': 'none'
        }, g);
        const txt = svgEl('text', {
          x: 0, y: 22.8,
          'text-anchor': 'middle',
          'font-size': '8.5',
          'font-weight': '500',
          fill: '#1F2328',
          'pointer-events': 'none'
        }, g);
        txt.textContent = o.label;
      }
    }
  }

  function findNearestPowerOutlet(item) {
    const powerOutlets = state.outlets.filter((o) => getOutletTypeDef(o.type).isPower);
    if (!powerOutlets.length) return null;
    const box = getItemBox(item);
    let best = null;
    let bestDist = Infinity;
    let bestAnchor = null;
    for (const o of powerOutlets) {
      // 从设备外边缘最近点测量，比中心点更贴合实际走线距离，也不遮挡设备文字
      const ax = Math.max(box.left, Math.min(box.right, o.x));
      const ay = Math.max(box.top, Math.min(box.bottom, o.y));
      const d = Math.hypot(o.x - ax, o.y - ay);
      if (d < bestDist) {
        bestDist = d;
        best = o;
        bestAnchor = { x: ax, y: ay };
      }
    }
    return best ? { outlet: best, distCm: bestDist, anchor: bestAnchor } : null;
  }

  function renderOverlay() {
    dom.overlayLayer.innerHTML = '';

    // 1) 智能对齐参考线
    for (const guide of ui.guides) {
      svgEl('line', {
        x1: guide.x1,
        y1: guide.y1,
        x2: guide.x2,
        y2: guide.y2,
        stroke: '#1865CF',
        'stroke-width': 1,
        'stroke-dasharray': '4 3',
        opacity: '0.8'
      }, dom.overlayLayer);
    }

    // 2) 选中设备到最近电源插座的距离虚线（从设备外边缘连向插座，不遮挡内部文字）
    if (state.settings.showPowerLine && ui.selected && ui.selected.kind === 'item') {
      const item = getItemById(ui.selected.id);
      if (item) {
        const nearest = findNearestPowerOutlet(item);
        if (nearest) {
          const { outlet, distCm, anchor } = nearest;
          svgEl('line', {
            x1: anchor.x,
            y1: anchor.y,
            x2: outlet.x,
            y2: outlet.y,
            stroke: '#D97706',
            'stroke-width': 1.5,
            'stroke-dasharray': '5 3',
            opacity: '0.9'
          }, dom.overlayLayer);
          svgEl('circle', { cx: anchor.x, cy: anchor.y, r: 2.8, fill: '#D97706' }, dom.overlayLayer);

          let mx = (anchor.x + outlet.x) / 2;
          let my = (anchor.y + outlet.y) / 2;
          // 若距离非常近，把距离标签微抬 16 cm 避免压住图标或边缘
          if (distCm < 46) my -= 16;
          const label = distCm < 1 ? '紧贴插座' : (distCm >= 100 ? `${(distCm / 100).toFixed(2)} m` : `${Math.round(distCm)} cm`);
          const bw = Math.max(46, label.length * 6.8 + 12);
          svgEl('rect', {
            x: mx - bw / 2, y: my - 9, width: bw, height: 18, rx: 9,
            fill: '#FFFBF2', stroke: '#D97706', 'stroke-width': 1
          }, dom.overlayLayer);
          const t = svgEl('text', {
            x: mx, y: my + 3.4,
            'text-anchor': 'middle',
            'font-size': '9.5',
            'font-weight': '600',
            'font-family': 'ui-monospace, Menlo, monospace',
            fill: '#9A5B04'
          }, dom.overlayLayer);
          t.textContent = label;
        }
      }
    }

    // 3) 框选新设备矩形
    if (ui.drawBox) {
      const x = Math.min(ui.drawBox.x1, ui.drawBox.x2);
      const y = Math.min(ui.drawBox.y1, ui.drawBox.y2);
      const w = Math.abs(ui.drawBox.x2 - ui.drawBox.x1);
      const h = Math.abs(ui.drawBox.y2 - ui.drawBox.y1);
      svgEl('rect', {
        x, y, width: w, height: h, rx: 3,
        fill: 'rgba(30, 95, 116, 0.14)',
        stroke: '#1865CF',
        'stroke-width': 1.6,
        'stroke-dasharray': '5 3'
      }, dom.overlayLayer);
      if (w > 12 && h > 12) {
        const label = `${Math.round(w)} × ${Math.round(h)} cm (${formatArea(calcAreaSqm(w, h))}㎡)`;
        const bw = label.length * 6.5 + 14;
        svgEl('rect', {
          x: x + w / 2 - bw / 2, y: y - 24, width: bw, height: 19, rx: 5,
          fill: '#1F2328'
        }, dom.overlayLayer);
        const t = svgEl('text', {
          x: x + w / 2, y: y - 11,
          'text-anchor': 'middle',
          'font-size': '10',
          fill: '#FFFFFF',
          'font-family': 'ui-monospace, Menlo, monospace'
        }, dom.overlayLayer);
        t.textContent = label;
      }
    }

    // 4) 测距线 / 校准线
    const activeLine = ui.measureLine || ui.calibrateLine;
    if (activeLine) {
      const isCal = Boolean(ui.calibrateLine);
      const color = isCal ? '#C93B3B' : '#1865CF';
      const { x1, y1, x2, y2 } = activeLine;
      const dist = Math.hypot(x2 - x1, y2 - y1);
      svgEl('line', {
        x1, y1, x2, y2,
        stroke: color,
        'stroke-width': 2,
        'stroke-dasharray': isCal ? '6 3' : null
      }, dom.overlayLayer);
      svgEl('circle', { cx: x1, cy: y1, r: 4, fill: color }, dom.overlayLayer);
      svgEl('circle', { cx: x2, cy: y2, r: 4, fill: color }, dom.overlayLayer);

      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const txt = isCal
        ? `参考线段（松开输入实际长度）`
        : (dist >= 100 ? `${(dist / 100).toFixed(2)} m (${Math.round(dist)} cm)` : `${Math.round(dist)} cm`);
      const bw = txt.length * 6.8 + 16;
      svgEl('rect', {
        x: mx - bw / 2, y: my - 26, width: bw, height: 20, rx: 6,
        fill: color
      }, dom.overlayLayer);
      const t = svgEl('text', {
        x: mx, y: my - 12.5,
        'text-anchor': 'middle',
        'font-size': '10',
        'font-weight': '600',
        fill: '#FFFFFF',
        'font-family': 'ui-monospace, Menlo, monospace'
      }, dom.overlayLayer);
      t.textContent = txt;
    }
  }

  /* =========================================================
     10. 选择面板与画布上的添加操作
     ========================================================= */
  function showPanel(panel) {
    const previous = document.body.dataset.panel;
    const scroller = document.querySelector('.sheet-scroller');
    if (previous === 'multi' && panel !== 'multi') ui.checkedItems.clear();
    document.body.dataset.panel = panel;
    $('contextSheet').inert = panel === 'canvas';
    syncCanvasSize();
    if (previous !== panel && (previous === 'multi' || panel === 'multi')) {
      renderItems();
      renderItemList();
    }
    const sameList = ['list', 'multi'].includes(previous) && ['list', 'multi'].includes(panel);
    if (previous !== panel && !sameList) scroller.scrollTop = 0;
    $('moreMenu').open = false;
    $('planSwitcher').open = false;
    if (panel !== 'add') ui.placement = null;
    const marker = $('placementLayer');
    marker.replaceChildren();
    const titles = {
      add: '在此添加', settings: '画布设置', list: '物品与插座', multi: '多选物品',
      inspect: ui.selected?.kind === 'outlet' ? '编辑插座' : '编辑物品',
      summary: '方案概览'
    };
    $('sheetTitle').textContent = titles[panel] || '';
    const closeLabel = panel === 'inspect' ? '完成编辑' : '关闭';
    $('closeSheet').title = closeLabel;
    $('closeSheet').setAttribute('aria-label', closeLabel);
    $('multiToggle').textContent = panel === 'multi' ? '完成' : '多选';
    $('multiToggle').setAttribute('aria-label', panel === 'multi' ? '完成多选' : '多选物品');
    $('sheetSub').textContent = panel === 'multi' ? '在图上点选，或在清单勾选' : '';
    if (panel === 'add' && ui.placement) {
      const { x, y } = ui.placement;
      const area = usesVectorDrawing() && fixedAreaName({ left: x, right: x, top: y, bottom: y });
      $('sheetSub').textContent = area ? `${area} · 不能摆放家具` : `位置  ${formatDim(x)}, ${formatDim(y)} cm`;
      const target = svgEl('g', { transform: `translate(${x} ${y})` }, marker);
      svgEl('circle', { r: 13, fill: '#EAF3FF', stroke: '#1362CE', 'stroke-width': 2 }, target);
      svgEl('path', { d: 'M-6 0H6 M0 -6V6', stroke: '#1362CE', 'stroke-width': 2 }, target);
    }
    if (panel === 'detail' || panel === 'inspect' || panel === 'summary') renderInspector();
    updatePlacementActions();
    if (panel !== 'canvas' && previous !== panel) $('sheetTitle').focus({ preventScroll: true });
  }

  function dismissPanel() {
    const panel = document.body.dataset.panel;
    if (panel === 'detail' || !ui.selected) selectEntity(null, null);
    else showPanel('detail');
    if (document.body.dataset.panel === 'canvas') dom.canvasSvg.focus({ preventScroll: true });
  }

  function openAddAt(point, fullForm = true) {
    setTool('select');
    selectEntity(null, null);
    ui.placement = { x: snapValue(point.x, 0), y: snapValue(point.y, 0) };
    if (fullForm) showPanel('add');
    else {
      const { x, y } = ui.placement;
      svgEl('circle', { cx: x, cy: y, r: 5, fill: '#1362CE', stroke: '#fff', 'stroke-width': 2 }, $('placementLayer'));
      updatePlacementActions();
    }
  }

  function placeItem(item) {
    const point = ui.placement || getViewportCenterWorld();
    const placed = addItem({ ...item, cx: point.x, cy: point.y });
    return placed;
  }

  function placeOutlet(type) {
    const point = ui.placement || getViewportCenterWorld();
    addOutlet(point.x, point.y, type);
  }

  function updatePlacementActions() {
    if (!ui.placement || document.body.dataset.panel !== 'canvas' || ui.tool !== 'select') {
      dom.floatingActions.classList.add('hidden');
      return;
    }
    const { x, y } = worldToStage(ui.placement.x, ui.placement.y);
    const { width, height } = dom.canvasStage.getBoundingClientRect();
    dom.floatingActions.classList.toggle('hidden', x < 0 || y < 0 || x > width || y > height);
    const margin = dom.floatingActions.offsetWidth / 2 + 8;
    const left = Math.max(margin, Math.min(width - margin, x));
    const top = y < 55 ? y + 53 : y - 10;
    dom.floatingActions.style.left = `${Math.round(left)}px`;
    dom.floatingActions.style.top = `${Math.round(top)}px`;
  }

  /* =========================================================
     11. 操作面板与顶部方案栏渲染
     ========================================================= */
  function renderPlanTabs() {
    const active = getActivePlan();
    $('dockPlanName').textContent = active.name;
    $('dockCounts').textContent = `${active.items.length} 件物品 · ${state.outlets.length} 个插孔`;
    dom.planTabs.innerHTML = '';
    for (const plan of state.plans) {
      const btn = document.createElement('button');
      btn.className = `plan-tab${plan.id === state.activePlanId ? ' active' : ''}`;
      btn.textContent = plan.name;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', String(plan.id === state.activePlanId));
      btn.title = `切换到${plan.name}`;
      btn.addEventListener('click', () => {
        $('planSwitcher').open = false;
        if (state.activePlanId !== plan.id) {
          showPanel('canvas');
          const previousMode = floorplanMode();
          state.activePlanId = plan.id;
          ui.selected = null;
          scheduleSave();
          renderAll();
          if (previousMode !== floorplanMode()) fitView();
        }
      });
      dom.planTabs.appendChild(btn);
    }
  }

  function renderItemList() {
    const plan = getActivePlan();
    const multi = document.body.dataset.panel === 'multi';
    if (multi) updateCheckedItems();
    dom.itemCountBadge.textContent = String(plan.items.length);
    const totalArea = plan.items.reduce((sum, it) => sum + calcAreaSqm(it.width, it.depth), 0);
    dom.totalAreaSummary.textContent = `共 ${formatArea(totalArea)} ㎡`;

    dom.itemList.innerHTML = '';
    if (!plan.items.length) {
      dom.itemList.innerHTML = multi
        ? '<div class="entity-empty">当前方案没有可选物品。</div>'
        : '<div class="entity-empty">还没有物品。轻点画布空白处即可添加。</div>';
      return;
    }

    for (const item of plan.items) {
      const col = getColorDef(item.color);
      const isSelected = ui.selected && ui.selected.kind === 'item' && ui.selected.id === item.id;
      const row = document.createElement(multi ? 'label' : 'div');
      row.className = `entity-row${isSelected ? ' selected' : ''}`;
      row.innerHTML = `
        <span class="entity-dot" style="background:${col.fill}; border-color:${col.stroke}"></span>
        <span class="entity-meta">
          <span class="entity-title">${escapeHtml(item.name)}${item.locked ? ' 🔒' : ''}</span>
          <span class="entity-sub">${formatDim(item.width)}×${formatDim(item.depth)} cm · ${formatArea(calcAreaSqm(item.width, item.depth))} ㎡ · ${item.rotation || 0}°</span>
        </span>
        ${multi ? '<input class="item-check" type="checkbox">' : '<button class="entity-del" title="删除">×</button>'}
      `;
      dom.itemList.appendChild(row);
      if (multi) {
        const checkbox = row.querySelector('.item-check');
        checkbox.dataset.id = item.id;
        checkbox.checked = ui.checkedItems.has(item.id);
        row.classList.toggle('selected', checkbox.checked);
        checkbox.addEventListener('change', () => toggleCheckedItem(item.id));
        continue;
      }
      row.addEventListener('click', (e) => {
        if (e.target.closest('.entity-del')) return;
        if (item.fixture && !state.vectorOptions.showFixtures) {
          state.vectorOptions.showFixtures = true;
          scheduleSave();
          renderFloorplan();
          renderFloorplanPanel();
        }
        selectEntity('item', item.id);
      });
      row.querySelector('.entity-del').addEventListener('click', () => deleteItems([item.id]));
    }
  }

  function startMultiSelection(seedId) {
    if (seedId) ui.checkedItems.add(seedId);
    ui.selected = null;
    setTool('select');
    renderOutlets();
    renderOutletList();
    showPanel('multi');
  }

  function updateCheckedItems() {
    $('multiCount').textContent = `已选 ${ui.checkedItems.size} 件`;
    $('deleteSelectedItems').disabled = !ui.checkedItems.size;
  }

  function toggleCheckedItem(id) {
    if (ui.checkedItems.has(id)) ui.checkedItems.delete(id);
    else ui.checkedItems.add(id);
    for (const checkbox of dom.itemList.querySelectorAll('.item-check')) {
      checkbox.checked = ui.checkedItems.has(checkbox.dataset.id);
      checkbox.closest('label').classList.toggle('selected', checkbox.checked);
    }
    updateCheckedItems();
    renderItems();
  }

  function renderOutletList() {
    dom.outletCountBadge.textContent = String(state.outlets.length);
    dom.outletList.innerHTML = '';
    if (!state.outlets.length) {
      dom.outletList.innerHTML = '<div class="entity-empty">还没有插座。轻点画布，选择插座即可标注。</div>';
      return;
    }

    for (const o of state.outlets) {
      const def = getOutletTypeDef(o.type);
      const isSelected = ui.selected && ui.selected.kind === 'outlet' && ui.selected.id === o.id;
      const row = document.createElement('div');
      row.className = `entity-row${isSelected ? ' selected' : ''}`;
      row.innerHTML = `
        <span class="entity-dot round" style="background:${def.color}; border-color:${def.color}"></span>
        <div class="entity-meta">
          <div class="entity-title">${escapeHtml(o.label || def.name)}${o.count > 1 ? ` ×${o.count}` : ''}</div>
          <div class="entity-sub">${def.name}${o.note ? ` · ${escapeHtml(o.note)}` : ''}</div>
        </div>
        <button class="entity-del" title="删除">×</button>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.entity-del')) return;
        selectEntity('outlet', o.id);
      });
      row.querySelector('.entity-del').addEventListener('click', () => deleteOutlet(o.id));
      dom.outletList.appendChild(row);
    }
  }

  function renderFloorplanPanel() {
    const isVec = floorplanMode() !== 'image';
    dom.btnModeVector.classList.toggle('active', isVec);
    dom.btnModeImage.classList.toggle('active', !isVec);
    dom.vectorControls.classList.toggle('hidden', !isVec);
    dom.imageModePanel.classList.toggle('hidden', isVec);

    const opts = state.vectorOptions || {};
    dom.toggleFixtures.checked = opts.showFixtures !== false;
    dom.toggleDoorSwings.checked = opts.showDoorSwings !== false;
    dom.toggleFloorTexture.checked = opts.showFloorTexture !== false;

    const hasBg = Boolean(state.background);
    dom.bgControls.classList.toggle('hidden', !hasBg);
    if (hasBg) {
      const pct = Math.round((state.background.opacity ?? 0.75) * 100);
      dom.bgOpacity.value = String(pct);
      dom.bgOpacityVal.textContent = `${pct}%`;
      dom.scaleDot.classList.toggle('calibrated', Boolean(state.background.calibrated));
      dom.scaleStatusText.textContent = state.background.calibrated
        ? '比例尺已校准'
        : '尚未校准比例尺';
    }
  }

  function renderInspector() {
    const panel = dom.inspectorPanel;
    const view = document.body.dataset.panel;
    if (!['summary', 'detail', 'inspect'].includes(view)) return;
    if (view !== 'summary' && !ui.selected) {
      showPanel('canvas');
      return;
    }
    if (view === 'detail') {
      const item = ui.selected.kind === 'item' ? getItemById(ui.selected.id) : getOutletById(ui.selected.id);
      if (!item) { selectEntity(null, null); return; }
      let rows;
      if (ui.selected.kind === 'item') {
        $('sheetTitle').textContent = item.name;
        rows = [
          ['尺寸', `${formatDim(item.width)} × ${formatDim(item.depth)} cm`],
          ['占地', `${formatArea(calcAreaSqm(item.width, item.depth))} ㎡`],
          ['朝向', `${item.rotation || 0}°`]
        ];
        if (item.locked) rows.push(['状态', '已锁定']);
      } else {
        const type = getOutletTypeDef(item.type);
        $('sheetTitle').textContent = item.label || type.name;
        rows = [['数量', `${item.count || 1} 个`], ['位置', `${formatDim(item.x)}, ${formatDim(item.y)} cm`]];
        if (item.label) rows.unshift(['类型', type.name]);
      }
      if (item.note) rows.push(['备注', item.note]);
      $('selectionFacts').innerHTML = rows.map(([label, value]) =>
        `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
      return;
    }
    const overview = view === 'summary';
    if (!overview) $('sheetTitle').textContent = ui.selected.kind === 'outlet' ? '编辑插座' : '编辑物品';

    // A. 选中了设备
    if (!overview && ui.selected && ui.selected.kind === 'item') {
      const item = getItemById(ui.selected.id);
      if (item) {
        const box = getItemBox(item);
        const area = calcAreaSqm(item.width, item.depth);
        const nearest = findNearestPowerOutlet(item);
        const rot = ((item.rotation || 0) % 360 + 360) % 360;

        panel.innerHTML = `
          <div class="inspector-section">
            <div class="compact-form">
              <div class="field">
                <label for="inspName">画布文字</label>
                <input id="inspName" type="text" value="${escapeAttr(item.name)}" />
              </div>

              <div class="field-row">
                <div class="field">
                  <label>宽 (cm)</label>
                  <input id="inspW" type="number" min="5" max="2000" step="1" value="${formatDim(item.width)}" />
                </div>
                <div class="field-x">×</div>
                <div class="field">
                  <label>深 (cm)</label>
                  <input id="inspD" type="number" min="5" max="2000" step="1" value="${formatDim(item.depth)}" />
                </div>
              </div>

              <div class="field">
                <label>朝向 · ${rot}°</label>
                <div class="btn-row" style="margin-top:5px;">
                  <button type="button" class="btn btn-subtle btn-sm" id="inspRotCCW">↺ 逆时针 90°</button>
                  <button type="button" class="btn btn-secondary btn-sm" id="inspRotCW">↻ 顺时针 90°</button>
                </div>
              </div>

              <div class="field-inline">
                <span class="field-label">色块</span>
                <div class="color-swatches" id="inspColors">
                  ${ITEM_COLORS.map((c) => `
                    <button type="button" class="color-swatch${item.color === c.id ? ' active' : ''}" data-color="${c.id}" style="background:${c.fill}; border-color:${c.stroke}" title="${c.name}"></button>
                  `).join('')}
                </div>
              </div>

              <details class="advanced inspector-extra"><summary>更多属性</summary><div class="advanced-body compact-form">
              <div class="field">
                <label>按面积等比缩放 (㎡)</label>
                <input id="inspArea" type="number" min="0.01" max="100" step="any" value="${formatArea(area)}" />
              </div>

              <label class="toggle-row">
                <input type="checkbox" id="inspStackable" ${item.stackable ? 'checked' : ''} />
                <span>桌面/可叠放设备（不提示重叠）</span>
              </label>
              <label class="toggle-row">
                <input type="checkbox" id="inspLocked" ${item.locked ? 'checked' : ''} />
                <span>锁定位置（防止误拖）</span>
              </label>

              <div class="field">
                <label>备注</label>
                <textarea id="inspNote" placeholder="如：高度、开门方向、供电需求">${escapeHtml(item.note || '')}</textarea>
              </div></div></details>
            </div>
          </div>

          <details class="advanced position-details"><summary>位置与供电距离</summary><div class="advanced-body">
            <div class="compact-form">
              <div class="field-row">
                <div class="field">
                  <label>左距 X (cm)</label>
                  <input id="inspX" type="number" step="1" value="${Math.round(box.left)}" />
                </div>
                <div class="field">
                  <label>上距 Y (cm)</label>
                  <input id="inspY" type="number" step="1" value="${Math.round(box.top)}" />
                </div>
              </div>
              ${nearest ? `
                <div class="distance-card">
                  <div class="distance-card-label">距离最近电源插孔（${escapeHtml(nearest.outlet.label || getOutletTypeDef(nearest.outlet.type).name)}）</div>
                  <div class="distance-card-val">${nearest.distCm >= 100 ? `${(nearest.distCm / 100).toFixed(2)} 米` : `${Math.round(nearest.distCm)} 厘米`}</div>
                </div>
              ` : `
                <div class="info-card">
                  <div class="info-card-sub">在墙上标注电源插孔后，此处会自动计算设备到最近插座的距离。</div>
                </div>
              `}
            </div>
          </div>

          </details>
          <div class="inspector-section">
            <div class="btn-row">
              <button type="button" class="btn btn-subtle btn-sm" id="inspDuplicate">复制</button>
              <button type="button" class="btn btn-danger-subtle btn-sm" id="inspDelete">删除设备</button>
            </div>
          </div>
        `;

        bindItemInspectorEvents(item.id);
        return;
      }
    }

    // B. 选中了插孔
    if (!overview && ui.selected && ui.selected.kind === 'outlet') {
      const o = getOutletById(ui.selected.id);
      if (o) {
        const def = getOutletTypeDef(o.type);
        panel.innerHTML = `
          <div class="inspector-section">
            <div class="inspector-header">
              <span class="inspector-title">插孔点位属性</span>
              <span class="inspector-badge" style="color:${def.color}">${def.name}</span>
            </div>
            <div class="compact-form">
              <div class="field">
                <label>标签名称</label>
                <input id="inspOutletLabel" type="text" placeholder="如：床头五孔、书桌网口" value="${escapeAttr(o.label || '')}" />
              </div>

              <div class="field">
                <label>插孔类型</label>
                <select id="inspOutletType">
                  ${OUTLET_TYPES.map((t) => `<option value="${t.id}" ${o.type === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                </select>
              </div>

              <div class="field-row">
                <div class="field">
                  <label>孔位/面板数量</label>
                  <input id="inspOutletCount" type="number" min="1" max="12" step="1" value="${o.count || 1}" />
                </div>
              </div>

              <div class="field">
                <label>高度 / 备注</label>
                <input id="inspOutletNote" type="text" placeholder="如：离地 30 cm / 桌面高度" value="${escapeAttr(o.note || '')}" />
              </div>

              <div class="field-row">
                <div class="field">
                  <label>坐标 X (cm)</label>
                  <input id="inspOutletX" type="number" step="1" value="${Math.round(o.x)}" />
                </div>
                <div class="field">
                  <label>坐标 Y (cm)</label>
                  <input id="inspOutletY" type="number" step="1" value="${Math.round(o.y)}" />
                </div>
              </div>
            </div>
          </div>

          <div class="inspector-section">
            <button type="button" class="btn btn-danger-subtle btn-block btn-sm" id="inspOutletDelete">删除此插孔</button>
          </div>
        `;
        bindOutletInspectorEvents(o.id);
        return;
      }
    }

    // C. 未选中任何元素：显示概览与快捷键
    const plan = getActivePlan();
    const totalArea = plan.items.reduce((sum, it) => sum + calcAreaSqm(it.width, it.depth), 0);
    const bounds = getFloorplanBounds();

    panel.innerHTML = `
      <div class="inspector-section">
        <div class="inspector-header">
          <span class="inspector-title">${escapeHtml(plan.name)} · 概览</span>
          <button type="button" class="link-btn" id="inspRenamePlan">重命名</button>
        </div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">设备数量</div>
            <div class="stat-val">${plan.items.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">设备总占地</div>
            <div class="stat-val">${formatArea(totalArea)} ㎡</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">墙面插孔</div>
            <div class="stat-val">${state.outlets.length}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">户型外框</div>
            <div class="stat-val" style="font-size:13px;">${(bounds.width / 100).toFixed(2)}×${(bounds.height / 100).toFixed(2)}m</div>
          </div>
        </div>
      </div>

      <div class="inspector-section">
        <div class="inspector-header">
          <span class="inspector-title">快捷键</span>
        </div>
        <div class="shortcut-list">
          <div class="shortcut-row"><span>顺时针旋转 90°</span><span class="kbd">R</span></div>
          <div class="shortcut-row"><span>逆时针旋转 90°</span><span class="kbd">⇧ R</span></div>
          <div class="shortcut-row"><span>微调 1 cm / 10 cm</span><span class="kbd">↑↓←→ / ⇧</span></div>
          <div class="shortcut-row"><span>临时关闭吸附</span><span class="kbd">按住 Alt</span></div>
          <div class="shortcut-row"><span>平移画布</span><span class="kbd">空格 + 拖动</span></div>
          <div class="shortcut-row"><span>缩放画布</span><span class="kbd">滚轮 / 双指</span></div>
          <div class="shortcut-row"><span>复制选中设备</span><span class="kbd">⌘ D</span></div>
          <div class="shortcut-row"><span>撤销 / 重做</span><span class="kbd">⌘ Z / ⇧⌘ Z</span></div>
        </div>
      </div>
    `;

    const renameBtn = $('inspRenamePlan');
    if (renameBtn) {
      renameBtn.addEventListener('click', () => openPlanModal(plan.id));
    }
  }

  function bindItemInspectorEvents(itemId) {
    const mutate = (fn, recordHistory = true) => {
      const item = getItemById(itemId);
      if (!item) return;
      const next = { ...item };
      fn(next);
      if (!canPlaceItem(next)) {
        renderInspector();
        return;
      }
      if (recordHistory) pushHistory();
      Object.assign(item, next);
      scheduleSave();
      renderItems();
      renderOverlay();
      renderItemList();
    };

    $('inspName').addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (v) mutate((it) => { it.name = v; it.showLabel = true; });
    });

    $('inspW').addEventListener('change', (e) => {
      const v = Math.max(5, Math.min(2000, parseFloat(e.target.value) || 50));
      mutate((it) => { it.width = v; });
      renderInspector();
    });

    $('inspD').addEventListener('change', (e) => {
      const v = Math.max(5, Math.min(2000, parseFloat(e.target.value) || 50));
      mutate((it) => { it.depth = v; });
      renderInspector();
    });

    $('inspArea').addEventListener('change', (e) => {
      const targetArea = Math.max(0.01, Math.min(100, parseFloat(e.target.value) || 0.5));
      mutate((it) => {
        const cur = calcAreaSqm(it.width, it.depth);
        const factor = Math.sqrt(targetArea / cur);
        it.width = Math.max(5, Math.round(it.width * factor));
        it.depth = Math.max(5, Math.round(it.depth * factor));
      });
      renderInspector();
    });

    $('inspRotCCW').addEventListener('click', () => rotateSelected(-90));
    $('inspRotCW').addEventListener('click', () => rotateSelected(90));

    document.querySelectorAll('#inspColors .color-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const color = btn.dataset.color;
        mutate((it) => { it.color = color; });
        renderInspector();
      });
    });

    $('inspStackable').addEventListener('change', (e) => {
      mutate((it) => { it.stackable = e.target.checked; });
    });

    $('inspLocked').addEventListener('change', (e) => {
      mutate((it) => { it.locked = e.target.checked; });
    });

    $('inspNote').addEventListener('change', (e) => {
      mutate((it) => { it.note = e.target.value; });
    });

    $('inspX').addEventListener('change', (e) => {
      const left = parseFloat(e.target.value);
      if (!Number.isNaN(left)) {
        mutate((it) => {
          const box = getItemBox(it);
          it.cx = left + box.effW / 2;
        });
      }
    });

    $('inspY').addEventListener('change', (e) => {
      const top = parseFloat(e.target.value);
      if (!Number.isNaN(top)) {
        mutate((it) => {
          const box = getItemBox(it);
          it.cy = top + box.effD / 2;
        });
      }
    });

    $('inspDuplicate').addEventListener('click', duplicateSelected);
    $('inspDelete').addEventListener('click', () => deleteItems([itemId]));
  }

  function bindOutletInspectorEvents(outletId) {
    const mutate = (fn) => {
      const o = getOutletById(outletId);
      if (!o) return;
      pushHistory();
      fn(o);
      scheduleSave();
      renderOutlets();
      renderOverlay();
      renderOutletList();
    };

    $('inspOutletLabel').addEventListener('change', (e) => {
      mutate((o) => { o.label = e.target.value.trim(); });
    });
    $('inspOutletType').addEventListener('change', (e) => {
      mutate((o) => { o.type = e.target.value; });
      renderInspector();
    });
    $('inspOutletCount').addEventListener('change', (e) => {
      const c = Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1));
      mutate((o) => { o.count = c; });
    });
    $('inspOutletNote').addEventListener('change', (e) => {
      mutate((o) => { o.note = e.target.value.trim(); });
    });
    $('inspOutletX').addEventListener('change', (e) => {
      const x = parseFloat(e.target.value);
      if (!Number.isNaN(x)) mutate((o) => { o.x = x; });
    });
    $('inspOutletY').addEventListener('change', (e) => {
      const y = parseFloat(e.target.value);
      if (!Number.isNaN(y)) mutate((o) => { o.y = y; });
    });
    $('inspOutletDelete').addEventListener('click', () => deleteOutlet(outletId));
  }

  function renderAll() {
    renderPlanTabs();
    renderFloorplan();
    renderItems();
    renderOutlets();
    renderOverlay();
    renderItemList();
    renderOutletList();
    renderFloorplanPanel();
    renderInspector();
    updateHistoryButtons();
    dom.snapSelect.value = String(state.settings.snapCm ?? 5);
    dom.togglePowerLine.checked = state.settings.showPowerLine !== false;
  }

  /* =========================================================
     12. 核心业务操作（增删改、旋转、复制、选择）
     ========================================================= */
  function selectEntity(kind, id) {
    ui.selected = kind && id ? { kind, id } : null;
    renderItems();
    renderOutlets();
    renderOverlay();
    renderItemList();
    renderOutletList();
    showPanel(ui.selected ? 'detail' : 'canvas');
  }

  function getViewportCenterWorld() {
    const rect = dom.canvasSvg.getBoundingClientRect();
    const wx = (rect.width / 2 - ui.view.tx) / ui.view.scale;
    const wy = (rect.height / 2 - ui.view.ty) / ui.view.scale;
    return { x: wx, y: wy };
  }

  function addItem({ name, width, depth, color, cx, cy, rotation = 0 }) {
    const plan = getActivePlan();
    const center = cx !== undefined && cy !== undefined ? { x: cx, y: cy } : getViewportCenterWorld();
    const step = state.settings.snapCm || 0;
    // 稍微错开避免完全重叠
    const jitter = (plan.items.length % 5) * 10;
    const item = {
      id: uid('item'),
      name: name || '未命名设备',
      width: Math.max(5, Math.round(width)),
      depth: Math.max(5, Math.round(depth)),
      cx: snapValue(center.x + (cx === undefined ? jitter : 0), step),
      cy: snapValue(center.y + (cy === undefined ? jitter : 0), step),
      rotation,
      color: color || ui.selectedColor,
      stackable: false,
      locked: false,
      note: ''
    };
    if (!canPlaceItem(item)) return null;
    pushHistory();
    plan.items.push(item);
    ui.selected = { kind: 'item', id: item.id };
    scheduleSave();
    showPanel('detail');
    renderAll();
    showToast(`已添加「${item.name}」(${item.width}×${item.depth} cm)`);
    return item;
  }

  function addOutlet(x, y, typeId) {
    pushHistory();
    const def = getOutletTypeDef(typeId || ui.selectedOutletType);
    const step = state.settings.snapCm || 0;
    const outlet = {
      id: uid('out'),
      type: def.id,
      x: snapValue(x, step > 0 ? Math.min(step, 2) : 0),
      y: snapValue(y, step > 0 ? Math.min(step, 2) : 0),
      label: '',
      count: 1,
      note: def.defaultNote
    };
    state.outlets.push(outlet);
    ui.selected = { kind: 'outlet', id: outlet.id };
    scheduleSave();
    showPanel('detail');
    renderAll();
    showToast(`已标注「${def.name}」`);
  }

  function rotateSelected(deltaDeg) {
    if (!ui.selected || ui.selected.kind !== 'item') return;
    const item = getItemById(ui.selected.id);
    if (!item) return;
    if (item.locked) {
      showToast('该设备已锁定，请先解锁再旋转');
      return;
    }
    const next = { ...item, rotation: (((item.rotation || 0) + deltaDeg) % 360 + 360) % 360 };
    // 旋转后按网格轻吸附左上角，确保边缘干净对齐
    const step = state.settings.snapCm || 0;
    if (step > 0) {
      const box = getItemBox(next);
      const snappedLeft = snapValue(box.left, step);
      const snappedTop = snapValue(box.top, step);
      next.cx = snappedLeft + box.effW / 2;
      next.cy = snappedTop + box.effD / 2;
    }
    if (!canPlaceItem(next)) return;
    pushHistory();
    Object.assign(item, next);
    scheduleSave();
    renderItems();
    renderOverlay();
    renderItemList();
    renderInspector();
  }

  function duplicateSelected() {
    if (!ui.selected || ui.selected.kind !== 'item') return;
    const src = getItemById(ui.selected.id);
    if (!src) return;
    const copy = {
      ...src,
      id: uid('item'),
      cx: src.cx + 25,
      cy: src.cy + 25,
      locked: false
    };
    if (!canPlaceItem(copy)) return;
    pushHistory();
    getActivePlan().items.push(copy);
    ui.selected = { kind: 'item', id: copy.id };
    scheduleSave();
    showPanel('detail');
    renderAll();
    showToast(`已复制「${copy.name}」`);
  }

  function deleteItems(ids) {
    const plan = getActivePlan();
    const removed = new Set(ids);
    const remaining = plan.items.filter(item => !removed.has(item.id));
    const count = plan.items.length - remaining.length;
    if (!count) return;
    pushHistory();
    plan.items = remaining;
    ui.checkedItems.clear();
    if (ui.selected?.kind === 'item' && removed.has(ui.selected.id)) {
      ui.selected = null;
    }
    if (!ui.selected && ['multi', 'list'].includes(document.body.dataset.panel)) showPanel('canvas');
    scheduleSave();
    renderAll();
    showToast(`已删除 ${count} 件物品`);
  }

  function deleteOutlet(id) {
    const idx = state.outlets.findIndex((o) => o.id === id);
    if (idx === -1) return;
    pushHistory();
    state.outlets.splice(idx, 1);
    if (ui.selected && ui.selected.kind === 'outlet' && ui.selected.id === id) {
      ui.selected = null;
    }
    if (!ui.selected && document.body.dataset.panel === 'list') showPanel('canvas');
    scheduleSave();
    renderAll();
  }

  /* =========================================================
     13. 智能对齐辅助线计算
     ========================================================= */
  function computeSnappedPosition(item, targetCx, targetCy, bypassSnap) {
    ui.guides = [];
    const box = getItemBox({ ...item, cx: targetCx, cy: targetCy });
    let cx = targetCx;
    let cy = targetCy;

    if (bypassSnap) {
      return { cx: Math.round(cx * 10) / 10, cy: Math.round(cy * 10) / 10 };
    }

    const threshold = 6 / Math.max(0.4, ui.view.scale);
    const plan = getActivePlan();
    const bounds = getFloorplanBounds();

    // 候选 X 对齐参考线（其他设备边缘/中心 + 户型关键内墙线）
    const xTargets = [19, dividerX, 314, 410, 418, 593, 671, bounds.width];
    const yTargets = [20, 415, 459, 646, 810, bounds.height];
    if (floorplanMode() === 'vector') {
      xTargets.push(leftReturn.x + leftReturn.width, rightReturn.x, bayWall.left, bedroomBJambX, dividerX - doorWidth.bedroomA, entryJambX);
      yTargets.push(balconyWindowInside, leftReturn.y, leftReturn.y + leftReturn.height,
        rightReturn.y, rightReturn.y + rightReturn.height, bedroomAWallY, bedroomBay.bottom, bayWall.bottom);
    } else {
      yTargets.push(79, 150);
    }

    for (const other of visibleItems()) {
      if (other.id === item.id) continue;
      const ob = getItemBox(other);
      xTargets.push(ob.left, other.cx, ob.right);
      yTargets.push(ob.top, other.cy, ob.bottom);
    }

    const itemXs = [
      { val: box.left, offset: box.effW / 2 },
      { val: targetCx, offset: 0 },
      { val: box.right, offset: -box.effW / 2 }
    ];
    let bestDx = threshold + 1;
    let snapLineX = null;
    for (const ix of itemXs) {
      for (const tx of xTargets) {
        const d = Math.abs(ix.val - tx);
        if (d < bestDx) {
          bestDx = d;
          cx = tx + ix.offset;
          snapLineX = tx;
        }
      }
    }

    const itemYs = [
      { val: box.top, offset: box.effD / 2 },
      { val: targetCy, offset: 0 },
      { val: box.bottom, offset: -box.effD / 2 }
    ];
    let bestDy = threshold + 1;
    let snapLineY = null;
    for (const iy of itemYs) {
      for (const ty of yTargets) {
        const d = Math.abs(iy.val - ty);
        if (d < bestDy) {
          bestDy = d;
          cy = ty + iy.offset;
          snapLineY = ty;
        }
      }
    }

    const step = state.settings.snapCm || 0;
    if (snapLineX !== null) {
      ui.guides.push({ x1: snapLineX, y1: -50, x2: snapLineX, y2: bounds.height + 50 });
    } else if (step > 0) {
      const snappedLeft = snapValue(cx - box.effW / 2, step);
      cx = snappedLeft + box.effW / 2;
    }

    if (snapLineY !== null) {
      ui.guides.push({ x1: -50, y1: snapLineY, x2: bounds.width + 50, y2: snapLineY });
    } else if (step > 0) {
      const snappedTop = snapValue(cy - box.effD / 2, step);
      cy = snappedTop + box.effD / 2;
    }

    return { cx, cy };
  }

  /* =========================================================
     14. 工具切换与画布指针交互
     ========================================================= */
  function setTool(tool) {
    if (tool === 'calibrate' && (floorplanMode() !== 'image' || !state.background)) {
      showToast('矢量户型已按 1:1 真实厘米校准；上传自定义图片底图后可使用此工具');
      return;
    }
    if (tool !== 'select') selectEntity(null, null);
    ui.tool = tool;
    ui.measureLine = null;
    ui.calibrateLine = null;
    ui.drawBox = null;

    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    const stage = dom.canvasStage;
    stage.classList.remove('mode-crosshair', 'mode-pan');
    if (tool !== 'select') stage.classList.add('mode-crosshair');

    const hints = {
      'draw-item': '在画布上按住并拖动，框出设备占地大小',
      'place-outlet': `点击墙面或画布放置「${getOutletTypeDef(ui.selectedOutletType).name}」，可连续标注`,
      'measure': '在画布上按住拖动，测量任意两点间距（过道宽、离墙距等）',
      'calibrate': '在底图上沿已知长度的墙体或门洞拉出一条参考线'
    };

    if (hints[tool]) {
      dom.modeBannerText.textContent = hints[tool];
      dom.modeBanner.classList.remove('hidden');
    } else {
      dom.modeBanner.classList.add('hidden');
    }

    renderOverlay();
  }

  function setupCanvasInteractions() {
    const svg = dom.canvasSvg;

    svg.addEventListener('pointerdown', (e) => {
      // 中键或按住空格 -> 平移画布
      if (!e.isPrimary) return;
      if (e.button === 1 || (e.button === 0 && ui.spacePressed)) {
        e.preventDefault();
        svg.setPointerCapture(e.pointerId);
        dom.canvasStage.classList.add('mode-panning');
        ui.drag = {
          kind: 'pan',
          startClientX: e.clientX,
          startClientY: e.clientY,
          origTx: ui.view.tx,
          origTy: ui.view.ty
        };
        return;
      }

      if (e.button !== 0) return;

      const world = clientToWorld(e.clientX, e.clientY);
      const press = { startClientX: e.clientX, startClientY: e.clientY, crossedThreshold: false };

      // 工具：标插孔
      if (ui.tool === 'place-outlet') {
        addOutlet(world.x, world.y, ui.selectedOutletType);
        return;
      }

      // 工具：框选设备
      if (ui.tool === 'draw-item') {
        svg.setPointerCapture(e.pointerId);
        const step = state.settings.snapCm || 0;
        const sx = snapValue(world.x, step);
        const sy = snapValue(world.y, step);
        ui.drawBox = { x1: sx, y1: sy, x2: sx, y2: sy };
        ui.drag = { kind: 'draw-item' };
        renderOverlay();
        return;
      }

      // 工具：测距
      if (ui.tool === 'measure') {
        svg.setPointerCapture(e.pointerId);
        ui.measureLine = { x1: world.x, y1: world.y, x2: world.x, y2: world.y };
        ui.drag = { kind: 'measure' };
        renderOverlay();
        return;
      }

      // 工具：校准比例尺
      if (ui.tool === 'calibrate') {
        svg.setPointerCapture(e.pointerId);
        ui.calibrateLine = { x1: world.x, y1: world.y, x2: world.x, y2: world.y };
        ui.drag = { kind: 'calibrate' };
        renderOverlay();
        return;
      }

      // 工具：选择 / 拖拽
      const multi = document.body.dataset.panel === 'multi';
      const hitItem = e.target.closest('.item-group');
      if (hitItem && (multi || e.shiftKey || e.metaKey || e.ctrlKey)) {
        svg.setPointerCapture(e.pointerId);
        ui.drag = { ...press, kind: 'pick-item', id: hitItem.dataset.id };
        return;
      }
      const hitOutlet = e.target.closest('.outlet-group');
      if (hitOutlet && !multi) {
        const id = hitOutlet.dataset.id;
        const outlet = getOutletById(id);
        if (outlet) {
          selectEntity('outlet', id);
          svg.setPointerCapture(e.pointerId);
          ui.drag = {
            ...press,
            kind: 'move-outlet',
            id,
            offsetX: world.x - outlet.x,
            offsetY: world.y - outlet.y,
            moved: false,
            snapshotBefore: snapshotState()
          };
          return;
        }
      }

      if (hitItem) {
        const id = hitItem.dataset.id;
        const item = getItemById(id);
        if (item) {
          selectEntity('item', id);
          if (item.locked) return;
          svg.setPointerCapture(e.pointerId);
          ui.drag = {
            ...press,
            kind: 'move-item',
            id,
            offsetX: world.x - item.cx,
            offsetY: world.y - item.cy,
            moved: false,
            snapshotBefore: snapshotState()
          };
          return;
        }
      }

      // 松开时区分轻点与平移，避免拖动开始时改变画布宽度。
      svg.setPointerCapture(e.pointerId);
      dom.canvasStage.classList.add('mode-panning');
      ui.drag = {
        ...press,
        kind: 'pan',
        tapWorld: multi ? null : world,
        origTx: ui.view.tx,
        origTy: ui.view.ty
      };
    });

    svg.addEventListener('pointermove', (e) => {
      if (!ui.drag || !e.isPrimary) return;
      if (ui.drag.crossedThreshold === false) {
        if (Math.hypot(e.clientX - ui.drag.startClientX, e.clientY - ui.drag.startClientY) < 5) return;
        ui.drag.crossedThreshold = true;
      }
      const world = clientToWorld(e.clientX, e.clientY);

      if (ui.drag.kind === 'pan') {
        ui.view.autoFit = false;
        ui.view.tx = ui.drag.origTx + (e.clientX - ui.drag.startClientX);
        ui.view.ty = ui.drag.origTy + (e.clientY - ui.drag.startClientY);
        applyViewportTransform();
        return;
      }

      if (ui.drag.kind === 'move-item') {
        const item = getItemById(ui.drag.id);
        if (!item) return;
        const targetCx = world.x - ui.drag.offsetX;
        const targetCy = world.y - ui.drag.offsetY;
        const snapped = computeSnappedPosition(item, targetCx, targetCy, e.altKey);
        ui.drag.blocked = placementIssue({ ...item, ...snapped });
        if (ui.drag.blocked) {
          ui.guides = [];
          renderOverlay();
          return;
        }
        if (snapped.cx !== item.cx || snapped.cy !== item.cy) {
          ui.drag.moved = true;
          item.cx = snapped.cx;
          item.cy = snapped.cy;
          renderItems();
          renderOverlay();
        }
        return;
      }

      if (ui.drag.kind === 'move-outlet') {
        const outlet = getOutletById(ui.drag.id);
        if (!outlet) return;
        const step = e.altKey ? 0 : Math.min(state.settings.snapCm || 0, 2);
        const nx = snapValue(world.x - ui.drag.offsetX, step);
        const ny = snapValue(world.y - ui.drag.offsetY, step);
        if (nx !== outlet.x || ny !== outlet.y) {
          ui.drag.moved = true;
          outlet.x = nx;
          outlet.y = ny;
          renderOutlets();
          renderOverlay();
        }
        return;
      }

      if (ui.drag.kind === 'draw-item' && ui.drawBox) {
        const step = e.altKey ? 0 : (state.settings.snapCm || 0);
        ui.drawBox.x2 = snapValue(world.x, step);
        ui.drawBox.y2 = snapValue(world.y, step);
        renderOverlay();
        return;
      }

      if (ui.drag.kind === 'measure' && ui.measureLine) {
        let x2 = world.x;
        let y2 = world.y;
        if (e.shiftKey) {
          if (Math.abs(x2 - ui.measureLine.x1) > Math.abs(y2 - ui.measureLine.y1)) y2 = ui.measureLine.y1;
          else x2 = ui.measureLine.x1;
        }
        ui.measureLine.x2 = x2;
        ui.measureLine.y2 = y2;
        renderOverlay();
        return;
      }

      if (ui.drag.kind === 'calibrate' && ui.calibrateLine) {
        let x2 = world.x;
        let y2 = world.y;
        if (e.shiftKey) {
          if (Math.abs(x2 - ui.calibrateLine.x1) > Math.abs(y2 - ui.calibrateLine.y1)) y2 = ui.calibrateLine.y1;
          else x2 = ui.calibrateLine.x1;
        }
        ui.calibrateLine.x2 = x2;
        ui.calibrateLine.y2 = y2;
        renderOverlay();
      }
    });

    svg.addEventListener('pointerup', (e) => {
      if (!ui.drag) return;
      if (!e.isPrimary) return;
      const drag = ui.drag;
      ui.drag = null;
      ui.guides = [];
      dom.canvasStage.classList.remove('mode-panning');
      try { svg.releasePointerCapture(e.pointerId); } catch (_) {}

      if (drag.kind === 'pick-item') {
        if (!drag.crossedThreshold) {
          if (document.body.dataset.panel !== 'multi') {
            const seed = ui.selected?.kind === 'item' ? ui.selected.id : null;
            startMultiSelection(seed === drag.id ? null : seed);
          }
          toggleCheckedItem(drag.id);
        }
        return;
      }
      if (drag.tapWorld && !drag.crossedThreshold) {
        openAddAt(drag.tapWorld, document.body.dataset.panel === 'add');
        return;
      }
      if (drag.kind === 'move-item' || drag.kind === 'move-outlet') {
        if (drag.blocked) showToast(drag.blocked);
        if (drag.moved) {
          history.past.push(drag.snapshotBefore);
          if (history.past.length > history.max) history.past.shift();
          history.future = [];
          updateHistoryButtons();
          scheduleSave();
          renderInspector();
          renderItemList();
          renderOutletList();
        }
        renderOverlay();
        return;
      }

      if (drag.kind === 'draw-item' && ui.drawBox) {
        const w = Math.abs(ui.drawBox.x2 - ui.drawBox.x1);
        const h = Math.abs(ui.drawBox.y2 - ui.drawBox.y1);
        const cx = (ui.drawBox.x1 + ui.drawBox.x2) / 2;
        const cy = (ui.drawBox.y1 + ui.drawBox.y2) / 2;
        ui.drawBox = null;
        if (w >= 12 && h >= 12) {
          const plan = getActivePlan();
          addItem({
            name: `设备 ${plan.items.length + 1}`,
            width: Math.round(w),
            depth: Math.round(h),
            cx,
            cy
          });
          setTool('select');
        } else {
          renderOverlay();
        }
        return;
      }

      if (drag.kind === 'calibrate' && ui.calibrateLine) {
        const dist = Math.hypot(
          ui.calibrateLine.x2 - ui.calibrateLine.x1,
          ui.calibrateLine.y2 - ui.calibrateLine.y1
        );
        if (dist >= 10) {
          openCalibrateModal(dist);
        } else {
          ui.calibrateLine = null;
          renderOverlay();
        }
      }
    });

    svg.addEventListener('pointercancel', (event) => {
      if (!event.isPrimary) return;
      if (ui.drag?.snapshotBefore && ui.drag.moved) state = JSON.parse(ui.drag.snapshotBefore);
      ui.drag = null;
      ui.guides = [];
      ui.drawBox = null;
      ui.calibrateLine = null;
      ui.measureLine = null;
      dom.canvasStage.classList.remove('mode-panning');
      renderAll();
    });

    // 滚轮缩放（以指针位置为中心）
    svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
  }

  /* =========================================================
     15. 自定义底图上传、粘贴、拖拽与校准
     ========================================================= */
  function loadImageFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('请上传图片文件（JPG / PNG / WebP）');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const img = new Image();
      img.onload = () => {
        pushHistory();
        const maxSide = Math.max(img.naturalWidth, img.naturalHeight);
        // 默认先假设最长边 750 cm，提示校准
        state.background = {
          dataUrl,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          cmPerPx: 750 / maxSide,
          calibrated: false,
          opacity: 0.78,
          rotation: 0
        };
        setFloorplanMode('image');
        scheduleSave();
        renderAll();
        fitView();
        showToast('已导入自定义底图，点击「校比例尺」可按实际尺寸校准');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  let pendingCalibrateDistCm = 0;
  function openCalibrateModal(distCm) {
    pendingCalibrateDistCm = distCm;
    dom.calibrateLength.value = String(Math.round(distCm));
    dom.calibrateUnit.value = 'cm';
    dom.calibrateModal.classList.remove('hidden');
    setTimeout(() => dom.calibrateLength.select(), 20);
  }

  function closeCalibrateModal() {
    dom.calibrateModal.classList.add('hidden');
    ui.calibrateLine = null;
    setTool('select');
  }

  /* =========================================================
     16. 方案管理（新建/复制/重命名/删除）
     ========================================================= */
  function duplicateCurrentPlan() {
    pushHistory();
    showPanel('canvas');
    const cur = getActivePlan();
    const nextIdx = state.plans.length + 1;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const suffix = letters[nextIdx - 1] || String(nextIdx);
    const newPlan = {
      ...cur,
      id: uid('plan'),
      name: `方案 ${suffix}`,
      items: cur.items.map((it) => ({ ...it, id: uid('item') }))
    };
    state.plans.push(newPlan);
    state.activePlanId = newPlan.id;
    ui.selected = null;
    scheduleSave();
    renderAll();
    showToast(`已复制为「${newPlan.name}」，可自由调整对比`);
  }

  function openPlanModal(planId) {
    const plan = state.plans.find((p) => p.id === planId);
    if (!plan) return;
    ui.editingPlanId = planId;
    dom.planNameInput.value = plan.name;
    dom.btnDeletePlan.disabled = state.plans.length <= 1;
    dom.planModal.classList.remove('hidden');
    setTimeout(() => dom.planNameInput.select(), 20);
  }

  function closePlanModal() {
    dom.planModal.classList.add('hidden');
    ui.editingPlanId = null;
  }

  /* =========================================================
     17. 导出 JSON / 导入 JSON / 导出 2x 高清 PNG
     ========================================================= */
  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `房间布局_${getActivePlan().name}_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已保存 JSON 项目文件');
  }

  function importJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.plans) || !parsed.plans.length) {
          throw new Error('Invalid format');
        }
        pushHistory();
        state = createDefaultState(parsed);
        ui.selected = null;
        ui.checkedItems.clear();
        scheduleSave();
        renderAll();
        fitView();
        showToast('项目文件已导入');
      } catch (_) {
        showToast('导入失败：文件格式不正确');
      }
    };
    reader.readAsText(file);
  }

  function exportPng() {
    // 清除临时选中高亮，导出干净图纸
    const prevSelected = ui.selected;
    ui.selected = null;
    renderItems(1, false);
    renderOutlets();
    renderOverlay();

    const bounds = getFloorplanBounds();
    const pad = 42;
    const vbX = bounds.x - pad;
    const vbY = bounds.y - pad;
    const vbW = bounds.width + pad * 2;
    const vbH = bounds.height + pad * 2 + 24;

    // 克隆干净 SVG 用于光栅化
    const clone = svgEl('svg', {
      xmlns: SVG_NS,
      width: Math.round(vbW * 2),
      height: Math.round(vbH * 2),
      viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`
    });

    // 复制 defs
    const defsClone = dom.canvasSvg.querySelector('defs').cloneNode(true);
    clone.appendChild(defsClone);

    // 柔和米白底色
    svgEl('rect', { x: vbX, y: vbY, width: vbW, height: vbH, fill: '#F0F4F9' }, clone);
    // 图纸浅网格
    svgEl('rect', { x: vbX, y: vbY, width: vbW, height: vbH, fill: 'url(#gridPatternLarge)', opacity: '0.65' }, clone);

    clone.appendChild(dom.floorplanLayer.cloneNode(true));
    clone.appendChild(dom.itemsLayer.cloneNode(true));
    clone.appendChild(dom.outletsLayer.cloneNode(true));

    // 左下角加简洁 1m 比例尺
    const sx = bounds.x;
    const sy = bounds.y + bounds.height + 24;
    svgEl('path', {
      d: `M ${sx} ${sy - 5} L ${sx} ${sy} L ${sx + 100} ${sy} L ${sx + 100} ${sy - 5}`,
      fill: 'none', stroke: '#3A4047', 'stroke-width': 1.6
    }, clone);
    const st = svgEl('text', {
      x: sx + 108, y: sy + 1,
      'font-size': '11',
      'font-family': '-apple-system, PingFang SC, sans-serif',
      fill: '#3A4047'
    }, clone);
    st.textContent = `1.0 m · ${getActivePlan().name}`;

    // 恢复选中态
    ui.selected = prevSelected;
    renderItems();
    renderOutlets();
    renderOverlay();

    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(clone);
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vbW * 2);
      canvas.height = Math.round(vbH * 2);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `房间布局_${getActivePlan().name}.png`;
      a.click();
      showToast('已导出高清 PNG 图片');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      showToast('图片导出失败，请重试');
    };
    img.src = url;
  }

  /* =========================================================
     18. 初始化静态控件与事件绑定
     ========================================================= */
  function initStaticControls() {
    // 颜色色块
    dom.newItemColors.innerHTML = '';
    for (const c of ITEM_COLORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `color-swatch${c.id === ui.selectedColor ? ' active' : ''}`;
      btn.style.background = c.fill;
      btn.style.borderColor = c.stroke;
      btn.title = c.name;
      btn.addEventListener('click', () => {
        ui.selectedColor = c.id;
        dom.newItemColors.querySelectorAll('.color-swatch').forEach((b, i) => {
          b.classList.toggle('active', ITEM_COLORS[i].id === c.id);
        });
      });
      dom.newItemColors.appendChild(btn);
    }

    // 常用设备预设
    dom.presetGrid.innerHTML = '';
    for (const [index, p] of ITEM_PRESETS.entries()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset-btn';
      btn.innerHTML = `
        <span class="preset-image" style="background-position:${(index % 4) * 100 / 3}% ${Math.floor(index / 4) * 50}%" aria-hidden="true"></span>
        <span class="preset-name">${p.name}</span>
        <span class="preset-dim">${p.width}×${p.depth} · ${formatArea(calcAreaSqm(p.width, p.depth))}㎡</span>
      `;
      btn.addEventListener('click', () => {
        placeItem(p);
      });
      dom.presetGrid.appendChild(btn);
    }

    // 插孔类型卡片
    dom.outletTypeGrid.innerHTML = '';
    for (const t of OUTLET_TYPES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `outlet-type-btn${t.id === ui.selectedOutletType ? ' active' : ''}`;
      btn.innerHTML = `
        <span class="outlet-type-swatch" style="background:${t.color}">${t.short}</span>
        <span class="outlet-type-label">${t.name}</span>
      `;
      btn.addEventListener('click', () => {
        ui.selectedOutletType = t.id;
        dom.outletTypeGrid.querySelectorAll('.outlet-type-btn').forEach((b, i) => {
          b.classList.toggle('active', OUTLET_TYPES[i].id === t.id);
        });
        if (ui.tool === 'place-outlet') setTool('place-outlet');
      });
      dom.outletTypeGrid.appendChild(btn);
    }
  }

  function updateAddItemPreview() {
    if (ui.areaInputMode) {
      const area = Math.max(0.01, parseFloat(dom.newItemArea.value) || 0.5);
      const ratio = parseFloat(dom.newItemRatio.value) || 1;
      const d = Math.round(Math.sqrt((area * 10000) / ratio));
      const w = Math.round(d * ratio);
      dom.newItemAreaPreview.textContent = `推算尺寸：${w} × ${d} cm（${formatArea(calcAreaSqm(w, d))} ㎡）`;
    } else {
      const w = Math.max(1, parseFloat(dom.newItemW.value) || 0);
      const d = Math.max(1, parseFloat(dom.newItemD.value) || 0);
      dom.newItemAreaPreview.textContent = `占地面积：${formatArea(calcAreaSqm(w, d))} ㎡（${w} × ${d} cm）`;
    }
  }

  function bindUiEvents() {
    $('multiToggle').addEventListener('click', () => {
      const panel = document.body.dataset.panel;
      if (panel === 'multi') dismissPanel();
      else startMultiSelection(panel !== 'list' && ui.selected?.kind === 'item' ? ui.selected.id : null);
    });
    $('deleteSelectedItems').addEventListener('click', () => deleteItems(ui.checkedItems));
    $('btnAddHere').addEventListener('click', () => openAddAt(ui.placement || getViewportCenterWorld()));
    const addSquare = () => placeItem({
      name: `物品 ${getActivePlan().items.length + 1}`, width: 60, depth: 60, color: ui.selectedColor
    });
    $('quickItem').addEventListener('click', addSquare);
    $('addPointItem').addEventListener('click', addSquare);
    $('addPointOutlet').addEventListener('click', () => placeOutlet('power10'));
    $('addPointMore').addEventListener('click', () => showPanel('add'));
    $('quickOutlet').addEventListener('click', () => placeOutlet('power10'));
    $('closeSheet').addEventListener('click', dismissPanel);
    document.querySelectorAll('[data-open]').forEach((button) => {
      button.addEventListener('click', () => showPanel(button.dataset.open));
    });
    document.addEventListener('click', (event) => {
      if (!event.target.closest('#moreMenu > summary')) $('moreMenu').open = false;
      if (!event.target.closest('#planSwitcher > summary')) $('planSwitcher').open = false;
    });
    dom.canvasSvg.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openAddAt(getViewportCenterWorld());
    });

    // 画布与菜单工具按钮
    document.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => setTool(ui.tool === btn.dataset.tool ? 'select' : btn.dataset.tool));
    });

    dom.btnCancelMode.addEventListener('click', () => setTool('select'));
    dom.btnDuplicatePlan.addEventListener('click', duplicateCurrentPlan);
    dom.btnUndo.addEventListener('click', undo);
    dom.btnRedo.addEventListener('click', redo);

    dom.btnExportJson.addEventListener('click', exportJson);
    dom.btnImportJson.addEventListener('click', () => dom.jsonFileInput.click());
    dom.jsonFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) importJsonFile(e.target.files[0]);
      e.target.value = '';
    });
    dom.btnExportPng.addEventListener('click', exportPng);

    // 切换长宽输入 / 面积反推输入
    dom.btnToggleAreaMode.addEventListener('click', () => {
      ui.areaInputMode = !ui.areaInputMode;
      dom.newItemW.disabled = dom.newItemD.disabled = ui.areaInputMode;
      dom.newItemArea.disabled = dom.newItemRatio.disabled = !ui.areaInputMode;
      dom.dimInputRow.classList.toggle('hidden', ui.areaInputMode);
      dom.areaInputRow.classList.toggle('hidden', !ui.areaInputMode);
      dom.btnToggleAreaMode.textContent = ui.areaInputMode ? '改按长宽填' : '按面积算';
      updateAddItemPreview();
    });

    [dom.newItemW, dom.newItemD, dom.newItemArea, dom.newItemRatio].forEach((el) => {
      el.addEventListener('input', updateAddItemPreview);
    });

    // 添加设备表单提交
    dom.addItemForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = dom.newItemName.value.trim() || `物品 ${getActivePlan().items.length + 1}`;
      let w, d;
      if (ui.areaInputMode) {
        const area = Math.max(0.01, parseFloat(dom.newItemArea.value) || 0.5);
        const ratio = parseFloat(dom.newItemRatio.value) || 1;
        d = Math.max(5, Math.round(Math.sqrt((area * 10000) / ratio)));
        w = Math.max(5, Math.round(d * ratio));
      } else {
        w = Math.max(5, parseFloat(dom.newItemW.value) || 100);
        d = Math.max(5, parseFloat(dom.newItemD.value) || 60);
      }
      if (placeItem({ name, width: w, depth: d, color: ui.selectedColor })) dom.newItemName.value = '';
    });

    // 进入标插孔模式
    dom.btnStartPlaceOutlet.addEventListener('click', () => placeOutlet(ui.selectedOutletType));

    // 户型模式切换
    dom.btnModeVector.addEventListener('click', () => {
      if (floorplanMode() !== 'vector') pushHistory();
      setFloorplanMode('vector');
      scheduleSave();
      renderAll();
      fitView();
    });
    dom.btnModeImage.addEventListener('click', () => {
      setFloorplanMode('image');
      scheduleSave();
      renderFloorplan();
      renderFloorplanPanel();
      if (state.background) fitView();
    });

    dom.toggleFixtures.addEventListener('change', (e) => {
      state.vectorOptions.showFixtures = e.target.checked;
      if (!e.target.checked && ui.selected?.kind === 'item' && getItemById(ui.selected.id)?.fixture) ui.selected = null;
      scheduleSave();
      renderAll();
    });
    dom.toggleDoorSwings.addEventListener('change', (e) => {
      state.vectorOptions.showDoorSwings = e.target.checked;
      scheduleSave();
      renderFloorplan();
    });
    dom.toggleFloorTexture.addEventListener('change', (e) => {
      state.vectorOptions.showFloorTexture = e.target.checked;
      scheduleSave();
      renderFloorplan();
    });

    // 上传自定义底图
    dom.floorplanDropzone.addEventListener('click', () => dom.floorplanFileInput.click());
    dom.floorplanFileInput.addEventListener('change', (e) => {
      if (e.target.files[0]) loadImageFile(e.target.files[0]);
      e.target.value = '';
    });

    dom.bgOpacity.addEventListener('input', (e) => {
      if (!state.background) return;
      const pct = parseInt(e.target.value, 10);
      state.background.opacity = pct / 100;
      dom.bgOpacityVal.textContent = `${pct}%`;
      renderFloorplan();
      scheduleSave();
    });

    dom.btnRotateBg.addEventListener('click', () => {
      if (!state.background) return;
      pushHistory();
      state.background.rotation = ((state.background.rotation || 0) + 90) % 360;
      scheduleSave();
      renderFloorplan();
      fitView();
    });

    dom.btnRemoveBg.addEventListener('click', () => {
      if (!state.background) return;
      pushHistory();
      state.background = null;
      setFloorplanMode('vector');
      scheduleSave();
      renderAll();
      fitView();
      showToast('已切回精绘矢量户型');
    });

    dom.btnCalibrateFromPanel.addEventListener('click', () => setTool('calibrate'));

    dom.btnClearItems.addEventListener('click', () => {
      const plan = getActivePlan();
      if (!plan.items.length) return;
      if (!confirm(`确定清空「${plan.name}」中的所有设备吗？（墙面插孔会保留）`)) return;
      pushHistory();
      plan.items = [];
      ui.selected = null;
      scheduleSave();
      renderAll();
      showToast('已清空当前方案设备');
    });

    dom.btnClearAll.addEventListener('click', () => {
      if (!confirm('确定重置全部方案、设备与插孔数据吗？')) return;
      pushHistory();
      state = sharedRoomState();
      ui.selected = null;
      ui.checkedItems.clear();
      scheduleSave();
      renderAll();
      fitView();
      showToast('已重置项目');
    });

    $('editSelection').addEventListener('click', () => showPanel('inspect'));

    // 底部 HUD
    dom.snapSelect.addEventListener('change', (e) => {
      state.settings.snapCm = parseInt(e.target.value, 10) || 0;
      scheduleSave();
    });
    dom.togglePowerLine.addEventListener('change', (e) => {
      state.settings.showPowerLine = e.target.checked;
      scheduleSave();
      renderOverlay();
    });
    dom.btnZoomIn.addEventListener('click', () => zoomAt(1.2));
    dom.btnZoomOut.addEventListener('click', () => zoomAt(1 / 1.2));
    dom.btnFitView.addEventListener('click', fitView);

    // 校准弹窗
    dom.btnCancelCalibrate.addEventListener('click', closeCalibrateModal);
    dom.calibrateForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!state.background || pendingCalibrateDistCm <= 0) {
        closeCalibrateModal();
        return;
      }
      const val = parseFloat(dom.calibrateLength.value);
      if (!val || val <= 0) return;
      const realCm = dom.calibrateUnit.value === 'm' ? val * 100 : val;
      const ratio = realCm / pendingCalibrateDistCm;

      pushHistory();
      state.background.cmPerPx *= ratio;
      state.background.calibrated = true;
      // 插孔固定在墙面上，随底图等比同步缩放
      for (const o of state.outlets) {
        o.x *= ratio;
        o.y *= ratio;
      }
      scheduleSave();
      closeCalibrateModal();
      renderAll();
      fitView();
      showToast('比例尺校准完成');
    });

    // 方案编辑弹窗
    dom.btnCancelPlanModal.addEventListener('click', closePlanModal);
    dom.planForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = dom.planNameInput.value.trim();
      if (!name || !ui.editingPlanId) return;
      const plan = state.plans.find((p) => p.id === ui.editingPlanId);
      if (plan) {
        pushHistory();
        plan.name = name;
        scheduleSave();
        renderPlanTabs();
        renderInspector();
      }
      closePlanModal();
    });
    dom.btnDeletePlan.addEventListener('click', () => {
      if (state.plans.length <= 1 || !ui.editingPlanId) return;
      pushHistory();
      state.plans = state.plans.filter((p) => p.id !== ui.editingPlanId);
      if (state.activePlanId === ui.editingPlanId) {
        state.activePlanId = state.plans[0].id;
        ui.checkedItems.clear();
      }
      ui.selected = null;
      scheduleSave();
      closePlanModal();
      renderAll();
      showToast('已删除方案');
    });

    // 拖放图片到画布
    let dragCounter = 0;
    dom.canvasStage.addEventListener('dragenter', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        dragCounter++;
        dom.dropOverlay.classList.remove('hidden');
      }
    });
    dom.canvasStage.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
        e.preventDefault();
      }
    });
    dom.canvasStage.addEventListener('dragleave', () => {
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) dom.dropOverlay.classList.add('hidden');
    });
    dom.canvasStage.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dom.dropOverlay.classList.add('hidden');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadImageFile(file);
    });

    // 粘贴剪贴板图片（Cmd+V）
    window.addEventListener('paste', (e) => {
      const target = e.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith('image/')) {
          const file = it.getAsFile();
          if (file) loadImageFile(file);
          break;
        }
      }
    });

    // 键盘快捷键
    window.addEventListener('keydown', (e) => {
      const isInput = e.target && (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.tagName === 'SELECT'
      );

      if (e.key === 'Escape') {
        if (!dom.calibrateModal.classList.contains('hidden')) closeCalibrateModal();
        else if (!dom.planModal.classList.contains('hidden')) closePlanModal();
        else if ($('planSwitcher').open) $('planSwitcher').open = false;
        else if ($('moreMenu').open) $('moreMenu').open = false;
        else if (document.body.dataset.panel !== 'canvas') dismissPanel();
        else if (ui.tool !== 'select') setTool('select');
        else selectEntity(null, null);
        return;
      }

      const typing = isInput && !e.target.matches('.item-check');
      if (!typing && document.body.dataset.panel === 'multi' && (e.key === 'Delete' || e.key === 'Backspace')) {
        if (dom.planModal.classList.contains('hidden') && dom.calibrateModal.classList.contains('hidden')) {
          e.preventDefault();
          deleteItems(ui.checkedItems);
        }
        return;
      }
      if (typing || (isInput && e.code === 'Space')) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      if (e.code === 'Space' && !ui.spacePressed) {
        e.preventDefault();
        ui.spacePressed = true;
        dom.canvasStage.classList.add('mode-pan');
        return;
      }

      const key = e.key.toLowerCase();
      if (key === 'r' && !meta) {
        e.preventDefault();
        rotateSelected(e.shiftKey ? -90 : 90);
        return;
      }
      if (key === 'v' && !meta) { setTool('select'); return; }
      if (key === 'd' && !meta) { setTool('draw-item'); return; }
      if (key === 'p' && !meta) { setTool('place-outlet'); return; }
      if (key === 'm' && !meta) { setTool('measure'); return; }
      if (key === 'c' && !meta) { setTool('calibrate'); return; }
      if (key === '0' && !meta) { fitView(); return; }
      if ((key === '=' || key === '+') && !meta) { zoomAt(1.18); return; }
      if (key === '-' && !meta) { zoomAt(1 / 1.18); return; }

      if ((e.key === 'Delete' || e.key === 'Backspace') && ui.selected) {
        e.preventDefault();
        if (ui.selected.kind === 'item') deleteItems([ui.selected.id]);
        else if (ui.selected.kind === 'outlet') deleteOutlet(ui.selected.id);
        return;
      }

      // 方向键微调选中物体或插孔
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && ui.selected) {
        e.preventDefault();
        const delta = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -delta : (e.key === 'ArrowRight' ? delta : 0);
        const dy = e.key === 'ArrowUp' ? -delta : (e.key === 'ArrowDown' ? delta : 0);

        if (ui.selected.kind === 'item') {
          const item = getItemById(ui.selected.id);
          if (item && !item.locked) {
            if (!canPlaceItem({ ...item, cx: item.cx + dx, cy: item.cy + dy })) return;
            pushHistory();
            item.cx += dx;
            item.cy += dy;
            scheduleSave();
            renderItems();
            renderOverlay();
            renderInspector();
          }
        } else if (ui.selected.kind === 'outlet') {
          const o = getOutletById(ui.selected.id);
          if (o) {
            pushHistory();
            o.x += dx;
            o.y += dy;
            scheduleSave();
            renderOutlets();
            renderOverlay();
            renderInspector();
          }
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        ui.spacePressed = false;
        dom.canvasStage.classList.remove('mode-pan');
      }
    });

    window.addEventListener('resize', () => {
    });
  }

  /* =========================================================
     19. 工具函数（Toast & XSS 安全转义）
     ========================================================= */
  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    dom.toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, '&#39;');
  }

  /* =========================================================
     20. 启动入口
     ========================================================= */
  async function boot() {
    initStaticControls();
    bindUiEvents();
    setupCanvasInteractions();

    const saved = await loadPersistedState();
    if (saved && Array.isArray(saved.plans) && saved.plans.length) {
      state = createDefaultState(saved);
      if (saved.originalLayoutVersion !== state.originalLayoutVersion) scheduleSave();
    }

    updateAddItemPreview();
    renderAll();
    syncCanvasSize();
    if (window.ResizeObserver) {
      new ResizeObserver(syncCanvasSize).observe(dom.canvasStage);
    } else {
      window.addEventListener('resize', syncCanvasSize);
    }
  }

  boot();
})();
