import Plotly from 'plotly.js-dist-min';

const STORAGE_KEY = 'concretejs.workspace-layout.v1';
const defaults = { width: 300, split: 0.55, collapsed: false, chartCollapsed: false, designTab: 'section' };
let state = { ...defaults };
let mode = 'design';
let resizeMaterialChart = () => {};
let resizeFrame = null;

function saveLayout() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Layout still works without storage. */ }
}

function resizePlots() {
  if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = null;
    const results = document.getElementById('results');
    if (results?.clientHeight) results.style.setProperty('--results-height', `${results.clientHeight}px`);
    resizeMaterialChart();
    for (const plot of document.querySelectorAll('.js-plotly-plot')) {
      if (plot.clientWidth && plot.clientHeight) void Plotly.Plots.resize(plot);
    }
  });
}

function selectInspectorTab(tab, { focus = false, remember = true } = {}) {
  if (mode === 'analysis' && tab === 'section') tab = 'analysis';
  for (const button of document.querySelectorAll('[data-inspector-tab]')) {
    const selected = button.dataset.inspectorTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    document.getElementById(button.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) button.focus();
  }
  if (mode === 'design' && remember) {
    state.designTab = tab;
    saveLayout();
  }
}

function applyLayout() {
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  document.body.dataset.inspectorCollapsed = String(state.collapsed);
  document.documentElement.style.setProperty('--inspector-width', `${state.width}px`);
  document.getElementById('toggleInspector').setAttribute('aria-expanded', String(!state.collapsed));
  document.getElementById('inspectorBackdrop').hidden = state.collapsed || !mobile;
  const chartBody = document.getElementById('materialChartBody');
  chartBody.hidden = state.chartCollapsed;
  const chartToggle = document.getElementById('toggleMaterialChart');
  chartToggle.setAttribute('aria-expanded', String(!state.chartCollapsed));
  chartToggle.setAttribute('aria-label', `${state.chartCollapsed ? 'Expand' : 'Collapse'} stress strain plot`);
  chartToggle.textContent = state.chartCollapsed ? '+' : '−';
  const scene = document.getElementById('concGui');
  const results = document.getElementById('results');
  const divider = document.getElementById('drag-bar');
  scene.style.flex = mode === 'analysis' ? `${state.split} 1 0px` : '1 1 0px';
  results.style.flex = `${1 - state.split} 1 0px`;
  results.style.display = mode === 'analysis' ? 'block' : 'none';
  divider.style.display = mode === 'analysis' ? 'flex' : 'none';
  resizePlots();
}

function setCollapsed(collapsed, { focus = true } = {}) {
  state.collapsed = collapsed;
  applyLayout();
  saveLayout();
  if (focus) {
    if (collapsed) document.getElementById('toggleInspector').focus();
    else document.querySelector('[data-inspector-tab][aria-selected="true"]')?.focus();
  }
}

function bindDivider(element, { axis, getValue, setValue, fromPointer, step }) {
  let activePointer = null;
  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointer = event.pointerId;
    element.setPointerCapture(event.pointerId);
    document.body.classList.add(`resizing-${axis}`);
  });
  element.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointer) return;
    setValue(fromPointer(event));
    applyLayout();
  });
  const finish = () => {
    if (activePointer === null) return;
    activePointer = null;
    document.body.classList.remove(`resizing-${axis}`);
    saveLayout();
  };
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', finish);
  element.addEventListener('keydown', event => {
    const previous = axis === 'columns' ? 'ArrowLeft' : 'ArrowUp';
    const next = axis === 'columns' ? 'ArrowRight' : 'ArrowDown';
    if (![previous, next].includes(event.key)) return;
    event.preventDefault();
    setValue(getValue() + (event.key === previous ? -step : step));
    applyLayout();
    saveLayout();
  });
}

export function initializeWorkspaceLayout({ onResizeMaterialChart = () => {} } = {}) {
  resizeMaterialChart = onResizeMaterialChart;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === 'object') {
      if (Number.isFinite(saved.width)) state.width = Math.max(260, Math.min(440, saved.width));
      if (Number.isFinite(saved.split)) state.split = Math.max(0.3, Math.min(0.75, saved.split));
      for (const key of ['collapsed', 'chartCollapsed']) if (typeof saved[key] === 'boolean') state[key] = saved[key];
      if (['section', 'materials', 'analysis'].includes(saved.designTab)) state.designTab = saved.designTab;
    }
  } catch { /* Ignore stale or unavailable layout preferences. */ }

  // Move existing controls without replacing nodes or their event handlers.
  const sectionPanel = document.getElementById('sectionInspectorPanel');
  const materialsPanel = document.getElementById('materialsInspectorPanel');
  const analysisPanel = document.getElementById('analysisInspectorPanel');
  const userResults = document.getElementById('userResults');
  sectionPanel.append(userResults);
  const shapes = document.createElement('details');
  shapes.id = 'shapeTemplates';
  const summary = document.createElement('summary');
  summary.textContent = 'Prebuilt shapes';
  shapes.append(summary, document.getElementById('materialsandShapes'));
  userResults.prepend(shapes);
  materialsPanel.append(document.getElementById('materialCreation'));
  analysisPanel.prepend(document.getElementById('analysisInput'));
  analysisPanel.append(document.getElementById('analysisResults'), document.getElementById('selectedPointResultProps'));
  document.getElementById('inspectorFooter').append(document.getElementById('analysis'));
  const editButton = document.createElement('button');
  editButton.id = 'inspectorEditSection';
  editButton.type = 'button';
  editButton.textContent = 'Edit section';
  editButton.hidden = true;
  editButton.addEventListener('click', () => document.getElementById('designModeTab').click());
  document.getElementById('inspectorFooter').append(editButton);

  for (const button of document.querySelectorAll('[data-inspector-tab]')) {
    button.addEventListener('click', () => selectInspectorTab(button.dataset.inspectorTab));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('[data-inspector-tab]')].filter(tab => !tab.disabled);
      const current = tabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectInspectorTab(tabs[next].dataset.inspectorTab, { focus: true });
    });
  }
  document.getElementById('collapseInspector').addEventListener('click', () => setCollapsed(true));
  document.getElementById('toggleInspector').addEventListener('click', () => setCollapsed(!state.collapsed));
  document.getElementById('inspectorBackdrop').addEventListener('click', () => setCollapsed(true));
  document.getElementById('workspaceInspector').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setCollapsed(true); }
  });
  document.getElementById('toggleMaterialChart').addEventListener('click', () => {
    state.chartCollapsed = !state.chartCollapsed;
    applyLayout();
    saveLayout();
  });
  document.getElementById('resetWorkspaceLayout').addEventListener('click', () => {
    state = { ...defaults };
    selectInspectorTab(mode === 'analysis' ? 'analysis' : state.designTab);
    applyLayout();
    saveLayout();
  });
  bindDivider(document.getElementById('inspectorResize'), {
    axis: 'columns', getValue: () => state.width, step: 10,
    setValue: value => { state.width = Math.max(260, Math.min(440, window.innerWidth * 0.45, value)); },
    fromPointer: event => event.clientX - document.body.getBoundingClientRect().left
  });
  bindDivider(document.getElementById('drag-bar'), {
    axis: 'rows', getValue: () => state.split, step: 0.025,
    setValue: value => { state.split = Math.max(0.3, Math.min(0.75, value)); },
    fromPointer: event => {
      const scene = document.getElementById('concGui');
      const results = document.getElementById('results');
      return (event.clientY - scene.getBoundingClientRect().top) / Math.max(scene.clientHeight + results.clientHeight, 1);
    }
  });
  window.addEventListener('resize', applyLayout);
  window.addEventListener('workspace:show-materials', () => {
    setCollapsed(false, { focus: false });
    selectInspectorTab('materials', { focus: true });
  });
  new ResizeObserver(resizePlots).observe(document.getElementById('results'));
  document.body.dataset.workspaceReady = 'true';
  setWorkspaceMode('design');
}

export function setWorkspaceMode(nextMode) {
  mode = nextMode;
  document.body.dataset.workspaceMode = mode;
  document.getElementById('sectionInspectorTab').disabled = mode === 'analysis';
  document.getElementById('analysisInput').hidden = mode === 'analysis';
  document.getElementById('analysisInspectorHint').hidden = mode === 'analysis';
  document.getElementById('analysis').hidden = mode === 'analysis';
  document.getElementById('inspectorEditSection').hidden = mode !== 'analysis';
  selectInspectorTab(mode === 'analysis' ? 'analysis' : state.designTab, { remember: false });
  applyLayout();
}
