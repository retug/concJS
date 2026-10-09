const columns = ['P', 'Mx', 'My', 'phiP', 'phiMx', 'phiMy'];

export function getPMMTableRows(results, angle) {
  const data = results?.[angle];
  if (!data) return [];
  const values = Object.fromEntries(columns.map(key => [key, data[key]?.flat() ?? []]));
  return Array.from({ length: values.P.length }, (_, index) => ({
    index,
    ...Object.fromEntries(columns.map(key => [key,
      Number.isFinite(values[key][index]) ? values[key][index] : null
    ]))
  }));
}

export function markPMMTableSelection(index) {
  for (const row of document.querySelectorAll('#analysisResultsTable [data-profile]')) {
    const selected = Number(row.dataset.profile) === index;
    row.dataset.selected = String(selected);
    row.querySelector('button').setAttribute('aria-current', String(selected));
  }
}

export function renderPMMTable(host, results, angle, index, onSelect) {
  if (!host) return;
  const rows = getPMMTableRows(results, angle);
  const container = document.createElement('div');
  container.id = 'analysisResultsTable';
  container.className = 'pmm-table-scroll';
  container.tabIndex = 0;
  container.setAttribute('aria-label', `PMM values at ${angle} degrees`);
  const table = document.createElement('table');
  table.className = 'pmm-results-table';
  table.innerHTML = `
    <caption>${angle}° bending axis · ${rows.length} profiles. Select a profile to inspect its section response.</caption>
    <thead><tr><th scope="col">Profile</th><th scope="col">P <small>kips</small></th>
    <th scope="col">Mx <small>kip-ft</small></th><th scope="col">My <small>kip-ft</small></th>
    <th scope="col">φP <small>kips</small></th><th scope="col">φMx <small>kip-ft</small></th>
    <th scope="col">φMy <small>kip-ft</small></th></tr></thead>`;
  const body = document.createElement('tbody');
  const format = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const values of rows) {
    const row = document.createElement('tr');
    row.dataset.profile = values.index;
    const profileCell = document.createElement('th');
    profileCell.scope = 'row';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = values.index;
    button.setAttribute('aria-label', `Select strain profile ${values.index}`);
    profileCell.append(button);
    row.append(profileCell);
    for (const key of columns) {
      const cell = document.createElement('td');
      cell.textContent = values[key] === null ? '—' : format.format(values[key]);
      row.append(cell);
    }
    row.addEventListener('click', () => {
      // Keep the card heading and unit labels visible when a keyboard or
      // pointer selection scrolls a row into view inside the results pane.
      const resultsPane = host.closest('#results');
      if (resultsPane) resultsPane.scrollTop = 0;
      onSelect(values.index, angle);
    });
    body.append(row);
  }
  table.append(body);
  container.append(table);
  host.replaceChildren(container);
  markPMMTableSelection(index);
}
