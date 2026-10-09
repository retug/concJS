const columns = ['P', 'Mx', 'My', 'phiP', 'phiMx', 'phiMy'];
const finiteOrNull = value => Number.isFinite(value) ? value : null;

function hasResponse(solution) {
  return [solution?.P, solution?.Mx, solution?.My].every(Number.isFinite)
    && Array.isArray(solution?.strainProfile) && solution.strainProfile.length === 2
    && solution.strainProfile.every(Number.isFinite);
}

/** Preserve each branch's independently solved point and its original selection index. */
export function getMMTableRows(result) {
  if (!Array.isArray(result?.points)) return [];
  return result.points.map((point, index) => {
    const angle = finiteOrNull(point?.angle);
    const selectableModes = angle === null ? [] : ['nominal', 'phi'].filter(mode => hasResponse(point?.[mode]));
    return {
      index,
      angle,
      axialLoad: finiteOrNull(result.axialLoad),
      P: finiteOrNull(point?.nominal?.P),
      Mx: finiteOrNull(point?.nominal?.Mx),
      My: finiteOrNull(point?.nominal?.My),
      phiP: finiteOrNull(point?.phi?.P),
      phiMx: finiteOrNull(point?.phi?.Mx),
      phiMy: finiteOrNull(point?.phi?.My),
      selectableModes
    };
  });
}

export function markMMTableSelection(selectedPoint, host = document) {
  for (const row of host.querySelectorAll('[data-mm-point]')) {
    const selected = selectedPoint != null
      && Number(row.dataset.mmPoint) === selectedPoint.pointIndex;
    row.dataset.selected = String(selected);
    row.setAttribute('aria-current', String(selected));
    row.setAttribute('aria-label', `${row.dataset.responseLabel}${selected ? ` Selected ${selectedPoint.mode === 'phi' ? 'design' : 'nominal'} profile.` : ''}`);
    for (const cell of row.querySelectorAll('[data-mm-mode]')) {
      cell.dataset.responseSelected = String(selected && cell.dataset.mmMode === selectedPoint.mode);
    }
  }
}

function createCell(tag, text) {
  const cell = document.createElement(tag);
  cell.textContent = text;
  return cell;
}

/** Render selectable nominal/design MM solutions; onSelect receives (pointIndex, mode). */
export function renderMMTable(host, result, selectedPoint, onSelect) {
  if (!host) return;
  const rows = getMMTableRows(result);
  const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const display = value => value === null ? '—' : format.format(value);
  const container = document.createElement('div');
  container.id = 'mmResultsTable';
  container.className = 'pmm-table-scroll';
  container.tabIndex = 0;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Moment-moment nominal and design results');
  const table = document.createElement('table');
  table.className = 'pmm-results-table';
  const caption = document.createElement('caption');
  caption.textContent = rows.length
    ? `Target P = ${display(finiteOrNull(result.axialLoad))} kips · ${rows.length} angles. Nominal and design (φ) points are solved separately at this axial load. Select a row for its nominal strain profile, or φ values for its design profile.`
    : 'Generate an MM curve to view its nominal and design results.';
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  for (const [label, unit] of [
    ['NA angle', 'degrees'], ['P', 'kips'], ['Mx', 'kip-ft'], ['My', 'kip-ft'],
    ['φP', 'kips'], ['φMx', 'kip-ft'], ['φMy', 'kip-ft']
  ]) {
    const cell = createCell('th', label);
    cell.scope = 'col';
    if (unit) cell.append(createCell('small', unit));
    header.append(cell);
  }
  head.append(header);
  const body = document.createElement('tbody');
  for (const values of rows) {
    const row = document.createElement('tr');
    row.dataset.mmPoint = String(values.index);
    row.tabIndex = values.selectableModes.length ? 0 : -1;
    row.setAttribute('aria-disabled', String(!values.selectableModes.length));
    row.dataset.responseLabel = `Strain profiles at ${display(values.angle)} degrees. Enter selects the row; left arrow selects nominal, right arrow selects design.`;
    const angle = createCell('th', display(values.angle));
    angle.scope = 'row';
    row.append(angle);
    for (const key of columns) {
      const cell = createCell('td', display(values[key]));
      const mode = key.startsWith('phi') ? 'phi' : 'nominal';
      cell.dataset.mmMode = mode;
      cell.setAttribute('aria-disabled', String(!values.selectableModes.includes(mode)));
      cell.title = values.selectableModes.includes(mode)
        ? `Show ${mode === 'phi' ? 'design (φ)' : 'nominal'} strain profile`
        : 'No solved strain response is available for this branch.';
      row.append(cell);
    }
    const select = (mode = values.selectableModes[0]) => {
      if (!values.selectableModes.includes(mode)) return;
      markMMTableSelection({ pointIndex: values.index, mode }, container);
      onSelect?.(values.index, mode);
    };
    row.addEventListener('click', event => {
      if (values.selectableModes.length) row.focus({ preventScroll: true });
      select(event.target.closest('[data-mm-mode]')?.dataset.mmMode);
    });
    row.addEventListener('keydown', event => {
      if (!['Enter', ' ', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      select(event.key === 'ArrowLeft' ? 'nominal' : event.key === 'ArrowRight' ? 'phi' : undefined);
    });
    body.append(row);
  }
  if (!rows.length) {
    const row = document.createElement('tr');
    const cell = createCell('td', 'No MM results available.');
    cell.colSpan = 7;
    row.append(cell);
    body.append(row);
  }
  table.append(caption, head, body);
  container.append(table);
  host.replaceChildren(container);
  markMMTableSelection(selectedPoint, container);
}
