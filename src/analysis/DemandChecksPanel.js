import './demandChecks.css';
import { DEFAULT_DCR_METHOD } from '../projectDemandInputs.js';

let panelSequence = 0;

const METHOD_TEXT = {
  'constant-p': 'Hold P fixed and cast a horizontal ray from zero moment at that axial load. DCR compares moment demand with moment capacity in the same plane.',
  origin: 'Cast a ray from 0,0,0 through the demand. Scale P, M2 and M3 together; DCR = 1 / capacity load factor.'
};
const STATUS_LABELS = {
  within: 'Within capacity',
  exceeds: 'Exceeds capacity',
  unresolved: 'Unresolved',
  zero: 'Zero demand'
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className = '') {
  const node = element('button', className, text);
  node.type = 'button';
  return node;
}

function copyCases(cases) {
  return cases.map(({ id, name, P, M2, M3 }) => ({ id, name, P, M2, M3 }));
}

function formatValue(value) {
  if (!Number.isFinite(value)) return '—';
  if (value !== 0 && (Math.abs(value) >= 1e7 || Math.abs(value) < 0.001)) return value.toExponential(3);
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function formatDcr(result) {
  if (result?.dcr === Infinity) return '∞';
  if (!Number.isFinite(result?.dcr)) return '—';
  const rounded = result.dcr.toFixed(3);
  // Preserve the distinction at the boundary even when three decimals round to one.
  if (result.dcr > 1 && rounded === '1.000') return '1.000+';
  if (result.dcr < 1 && rounded === '1.000') return '<1.000';
  return rounded;
}

/** Create an independent demand editor and results view inside an existing panel. */
export function createDemandChecksPanel(host, {
  cases: initialCases = [],
  method: initialMethod = DEFAULT_DCR_METHOD,
  onCasesChange = () => {},
  onMethodChange = () => {},
  onCheck = async () => [],
  onSelect = () => {}
} = {}) {
  const prefix = `demand-checks-${++panelSequence}`;
  let cases = copyCases(initialCases);
  let selectedMethod = initialMethod;
  let results = new Map();
  let selectedId = cases[0]?.id ?? null;
  let editingId = null;
  let busy = false;
  let disposed = false;
  let validationShown = false;
  let sequence = 0;

  const panel = element('section', 'demand-checks');
  panel.setAttribute('aria-label', 'Demand and capacity checks');
  const introduction = element('div', 'demand-checks-introduction');
  introduction.append(
    element('h3', '', 'Demand checks'),
    element('p', '', 'Enter factored loads to check against the generated φ-reduced PMM capacity.'),
    element('p', 'demand-checks-convention', 'Negative P = compression; positive P = tension. M2 = Mx and M3 = My, about the section centroid.')
  );

  const methodControls = element('div', 'demand-checks-method-controls');
  const methodLabel = element('label', '', 'DCR method');
  const methodSelect = element('select');
  methodSelect.id = `${prefix}-method`;
  methodSelect.name = 'dcrMethod';
  methodLabel.htmlFor = methodSelect.id;
  for (const [value, label] of [
    ['constant-p', 'Constant axial load (horizontal ray)'],
    ['origin', 'DCRs cast from 0,0,0']
  ]) {
    const option = element('option', '', label);
    option.value = value;
    methodSelect.append(option);
  }
  methodSelect.value = selectedMethod;
  const methodHelp = element('p', 'demand-checks-method-help', METHOD_TEXT[selectedMethod]);
  methodHelp.id = `${prefix}-method-help`;
  methodSelect.setAttribute('aria-describedby', methodHelp.id);
  methodControls.append(methodLabel, methodSelect, methodHelp);

  const form = element('form', 'demand-checks-form');
  form.noValidate = true;
  const fields = {};
  const fieldGrid = element('div', 'demand-checks-fields');
  const specifications = [
    { key: 'name', label: 'Name (optional)', placeholder: 'e.g. Level 1 · Combo 1', type: 'text' },
    { key: 'P', label: 'P (kips)', placeholder: '−500', type: 'number' },
    { key: 'M2', label: 'M2 (Mx) (kip-ft)', placeholder: '0', type: 'number' },
    { key: 'M3', label: 'M3 (My) (kip-ft)', placeholder: '0', type: 'number' }
  ];
  for (const specification of specifications) {
    const group = element('div', `demand-checks-field demand-checks-field-${specification.key}`);
    const label = element('label', '', specification.label);
    const input = element('input');
    input.id = `${prefix}-${specification.key}`;
    input.name = specification.key;
    input.type = specification.type;
    input.placeholder = specification.placeholder;
    input.autocomplete = 'off';
    label.htmlFor = input.id;
    if (specification.type === 'number') {
      input.step = 'any';
      input.required = true;
    } else {
      input.maxLength = 120;
    }
    fields[specification.key] = input;
    group.append(label, input);
    fieldGrid.append(group);
  }
  const errors = element('p', 'demand-checks-error');
  errors.id = `${prefix}-errors`;
  errors.setAttribute('role', 'alert');
  errors.hidden = true;
  const formActions = element('div', 'demand-checks-form-actions');
  const save = button('Add demand', 'demand-checks-secondary');
  save.type = 'submit';
  const cancel = button('Cancel edit', 'demand-checks-secondary');
  cancel.hidden = true;
  formActions.append(save, cancel);
  form.append(fieldGrid, errors, formActions);

  const toolbar = element('div', 'demand-checks-toolbar');
  const check = button('Check demands', 'demand-checks-primary');
  const status = element('p', 'demand-checks-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  toolbar.append(check, status);
  const empty = element('p', 'demand-checks-empty', 'No demands yet. Add P, M2 and M3 above, then check the saved demands.');
  const tableScroll = element('div', 'demand-checks-table-scroll');
  const table = element('table', 'demand-checks-table');
  const caption = element('caption', 'demand-checks-sr-only', 'Saved demands and demand-capacity ratios');
  const head = element('thead');
  const header = element('tr');
  for (const label of ['Demand', 'P (kips)', 'M2 (kip-ft)', 'M3 (kip-ft)', 'DCR', 'Status', 'Actions']) {
    const cell = element('th', '', label);
    cell.scope = 'col';
    header.append(cell);
  }
  head.append(header);
  const body = element('tbody');
  table.append(caption, head, body);
  tableScroll.append(table);
  const detail = element('div', 'demand-checks-detail');
  detail.setAttribute('aria-live', 'polite');
  const method = element('p', 'demand-checks-method', 'Based on the generated, linearly interpolated φ-reduced PMM surface. Section capacity only; demands must include any required moment magnification.');
  panel.append(introduction, methodControls, form, toolbar, empty, tableScroll, detail, method);
  host.replaceChildren(panel);

  function showError(message, invalidKeys = []) {
    errors.textContent = message;
    errors.hidden = !message;
    for (const [key, input] of Object.entries(fields)) {
      if (invalidKeys.includes(key)) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errors.id);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
    }
  }

  function readForm() {
    const values = {};
    const invalidKeys = [];
    for (const key of ['P', 'M2', 'M3']) {
      const raw = fields[key].value.trim();
      const value = Number(raw);
      if (!raw || fields[key].validity.badInput || !Number.isFinite(value)) invalidKeys.push(key);
      values[key] = value;
    }
    if (invalidKeys.length) {
      validationShown = true;
      showError(`Enter a finite number for ${invalidKeys.join(', ')}. Enter 0 for an unloaded component.`, invalidKeys);
      return null;
    }
    showError('');
    return { name: fields.name.value.trim(), ...values };
  }

  function nextName() {
    let number = 1;
    while (cases.some(demand => demand.name === `Demand ${number}`)) number += 1;
    return `Demand ${number}`;
  }

  function resetForm() {
    editingId = null;
    validationShown = false;
    form.reset();
    showError('');
    save.textContent = 'Add demand';
    cancel.hidden = true;
  }

  function updateControls() {
    panel.setAttribute('aria-busy', String(busy));
    panel.querySelectorAll('button, input, select').forEach(control => { control.disabled = busy; });
    check.disabled = busy || !cases.length || editingId !== null;
    check.textContent = busy ? 'Working…' : 'Check demands';
  }

  function restoreFocus(control) {
    if (disposed || panel.closest('[hidden]')) return;
    // Do not steal focus if the user switched to another part of the workspace.
    if (document.activeElement === document.body || panel.contains(document.activeElement)) {
      control?.focus({ preventScroll: true });
    }
  }

  function renderStatus() {
    if (busy) return;
    if (editingId !== null) {
      status.textContent = 'Save or cancel this edit before checking demands.';
    } else if (!cases.length) {
      status.textContent = '';
    } else if (!results.size) {
      status.textContent = `${cases.length} saved ${cases.length === 1 ? 'demand' : 'demands'} · ready to check`;
    } else {
      const exceeded = [...results.values()].filter(result => result.status === 'exceeds').length;
      const unresolved = [...results.values()].filter(result => result.status === 'unresolved').length;
      const parts = [`${results.size} checked`];
      if (exceeded) parts.push(`${exceeded} exceed capacity`);
      if (unresolved) parts.push(`${unresolved} unresolved`);
      status.textContent = parts.join(' · ');
    }
  }

  function renderDetail() {
    detail.replaceChildren();
    const demand = cases.find(item => item.id === selectedId);
    if (!demand) {
      detail.hidden = true;
      return;
    }
    detail.hidden = false;
    const result = results.get(demand.id);
    detail.dataset.status = result?.status ?? 'unchecked';
    detail.append(element('h4', '', demand.name));
    if (!result) {
      detail.append(element('p', '', 'Run Check demands to calculate this demand’s DCR and capacity point.'));
      return;
    }
    const summary = element('p', 'demand-checks-detail-status', `${STATUS_LABELS[result.status] ?? 'Unresolved'} · DCR ${formatDcr(result)}`);
    detail.append(summary);
    if (result.message) detail.append(element('p', '', result.message));
    if (result.capacity && ['P', 'M2', 'M3'].every(key => Number.isFinite(result.capacity[key]))) {
      const capacity = element('dl', 'demand-checks-capacity');
      for (const [label, value] of [
        [selectedMethod === 'constant-p' ? 'Fixed P (kips)' : 'φP capacity (kips)', result.capacity.P],
        ['φM2 capacity (kip-ft)', result.capacity.M2],
        ['φM3 capacity (kip-ft)', result.capacity.M3]
      ]) {
        const group = element('div');
        group.append(element('dt', '', label), element('dd', '', formatValue(value)));
        capacity.append(group);
      }
      detail.append(capacity);
    }
  }

  async function selectDemand(id, notify = true) {
    if (disposed || !cases.some(demand => demand.id === id)) return;
    selectedId = id;
    for (const row of body.rows) {
      const selected = row.dataset.demandId === String(id);
      row.dataset.selected = String(selected);
      row.querySelector('.demand-checks-select').setAttribute('aria-pressed', String(selected));
    }
    renderDetail();
    if (notify) {
      try { await onSelect(id); }
      catch (error) { if (!disposed) showError(error?.message || 'Could not display the selected demand.'); }
    }
  }

  function renderRows() {
    body.replaceChildren();
    empty.hidden = Boolean(cases.length);
    tableScroll.hidden = !cases.length;
    for (const demand of cases) {
      const result = results.get(demand.id);
      const row = element('tr');
      row.dataset.demandId = String(demand.id);
      row.dataset.selected = String(demand.id === selectedId);
      row.dataset.status = result?.status ?? 'unchecked';
      const nameCell = element('th');
      nameCell.scope = 'row';
      const select = button(demand.name, 'demand-checks-select');
      select.setAttribute('aria-pressed', String(demand.id === selectedId));
      select.setAttribute('aria-label', `Select ${demand.name}`);
      select.addEventListener('click', () => selectDemand(demand.id));
      nameCell.append(select);
      row.append(nameCell);
      for (const key of ['P', 'M2', 'M3']) row.append(element('td', 'demand-checks-number', formatValue(demand[key])));
      const dcrCell = element('td', 'demand-checks-number demand-checks-dcr', formatDcr(result));
      if (Number.isFinite(result?.dcr)) dcrCell.title = `DCR ${result.dcr.toPrecision(8)}`;
      row.append(dcrCell, element('td', 'demand-checks-result-status', result ? STATUS_LABELS[result.status] ?? 'Unresolved' : 'Not checked'));
      const actionsCell = element('td');
      const actions = element('div', 'demand-checks-row-actions');
      const edit = button('Edit');
      const remove = button('Remove', 'demand-checks-remove');
      edit.setAttribute('aria-label', `Edit ${demand.name}`);
      remove.setAttribute('aria-label', `Remove ${demand.name}`);
      edit.addEventListener('click', () => {
        if (busy) return;
        editingId = demand.id;
        validationShown = false;
        showError('');
        for (const key of ['name', 'P', 'M2', 'M3']) fields[key].value = demand[key];
        save.textContent = 'Save demand';
        cancel.hidden = false;
        selectDemand(demand.id);
        updateControls();
        renderStatus();
        fields.name.focus();
      });
      remove.addEventListener('click', async () => {
        if (busy) return;
        const remaining = cases.filter(item => item.id !== demand.id);
        const nextSelected = selectedId === demand.id ? remaining[0]?.id ?? null : selectedId;
        await commitCases(remaining, nextSelected, true);
      });
      actions.append(edit, remove);
      actionsCell.append(actions);
      row.append(actionsCell);
      row.addEventListener('click', event => {
        if (!busy && !event.target.closest('button')) selectDemand(demand.id);
      });
      body.append(row);
    }
    renderDetail();
    renderStatus();
    updateControls();
  }

  async function commitCases(nextCases, nextSelected, focusRow = false) {
    busy = true;
    showError('');
    status.textContent = 'Saving demands…';
    updateControls();
    try {
      await onCasesChange(copyCases(nextCases));
      if (disposed) return;
      cases = copyCases(nextCases);
      results.clear();
      selectedId = nextSelected;
      resetForm();
      renderRows();
      if (selectedId !== null) await selectDemand(selectedId);
    } catch (error) {
      if (!disposed) showError(error?.message || 'Could not save this demand. Please try again.');
    } finally {
      if (!disposed) {
        busy = false;
        updateControls();
        renderStatus();
        const row = [...body.rows].find(item => item.dataset.demandId === selectedId);
        restoreFocus(focusRow ? row?.querySelector('.demand-checks-select') ?? fields.name : fields.name);
      }
    }
  }

  function setResults(nextResults) {
    if (disposed) return;
    const next = Array.isArray(nextResults) ? nextResults : [];
    results = new Map(cases.map(demand => {
      const result = next.find(item => item.id === demand.id);
      return [demand.id, result ?? { id: demand.id, status: 'unresolved', dcr: null, capacity: null, message: 'No capacity result was returned for this demand.' }];
    }));
    renderRows();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const draft = readForm();
    if (!draft) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }
    const id = editingId ?? globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${++sequence}`;
    const demand = { id, ...draft, name: draft.name || nextName() };
    const nextCases = editingId === null ? [...cases, demand] : cases.map(item => item.id === editingId ? demand : item);
    await commitCases(nextCases, id);
  });
  form.addEventListener('input', () => { if (validationShown) readForm(); });
  methodSelect.addEventListener('change', async () => {
    if (busy) return;
    const nextMethod = methodSelect.value;
    busy = true;
    showError('');
    status.textContent = 'Changing DCR method…';
    updateControls();
    try {
      await onMethodChange(nextMethod);
      if (disposed) return;
      selectedMethod = nextMethod;
      methodHelp.textContent = METHOD_TEXT[selectedMethod];
      results.clear();
      renderRows();
    } catch (error) {
      if (!disposed) {
        methodSelect.value = selectedMethod;
        showError(error?.message || 'Could not change the DCR method.');
      }
    } finally {
      if (!disposed) {
        busy = false;
        updateControls();
        renderStatus();
        restoreFocus(methodSelect);
      }
    }
  });
  cancel.addEventListener('click', () => {
    if (!busy) { resetForm(); updateControls(); renderStatus(); restoreFocus(fields.name); }
  });
  check.addEventListener('click', async () => {
    if (busy || !cases.length || editingId !== null) return;
    busy = true;
    showError('');
    status.textContent = `Checking ${cases.length} ${cases.length === 1 ? 'demand' : 'demands'}…`;
    updateControls();
    try {
      const checked = await onCheck(copyCases(cases));
      if (disposed) return;
      setResults(checked);
      await selectDemand(selectedId ?? cases[0].id);
    } catch (error) {
      if (!disposed) {
        results.clear();
        renderRows();
        showError(error?.message || 'The demands could not be checked. Please try again.');
      }
    } finally {
      if (!disposed) {
        busy = false;
        updateControls();
        renderStatus();
        restoreFocus(check);
      }
    }
  });
  // Section-editing shortcuts must not see typing, deletion, or arrows in this panel.
  for (const eventName of ['keydown', 'keyup', 'keypress']) panel.addEventListener(eventName, event => event.stopPropagation());
  renderRows();

  return {
    setSelected(id) { return selectDemand(id, false); },
    setResults,
    getCases() { return copyCases(cases); },
    dispose() { disposed = true; panel.remove(); }
  };
}
