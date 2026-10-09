import Chart from 'chart.js/auto';
import { defaultMaterials, getACICompressiveStressGuide } from './materials.js';
import { createMaterialDraft, materialFromDraft, validateMaterialDraft } from './materialEditorData.js';
import './materialEditor.css';

let editor;
let returnFocus;
let preview;
let onSaveMaterial;
let validationShown = false;

export function initializeMaterialEditor(onSave) {
  onSaveMaterial = onSave;
  if (editor) return;
  const inputs = document.getElementById('userDefinedInputs');
  if (!inputs) return;
  const library = document.getElementById('materialCreation');
  const actions = document.createElement('div');
  actions.className = 'material-library-actions';
  actions.innerHTML = '<button id="newMaterial" type="button">+ New material</button><button id="copyMaterial" type="button" disabled>Copy selected</button>';
  const status = document.createElement('p');
  status.id = 'materialLibraryStatus';
  status.className = 'material-library-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Choose a material to inspect or copy its stress–strain curve.';
  inputs.before(actions, status);

  editor = document.createElement('dialog');
  editor.id = 'materialEditorDialog';
  editor.className = 'material-editor';
  editor.setAttribute('aria-labelledby', 'materialEditorTitle');
  editor.setAttribute('aria-describedby', 'materialEditorDescription');
  editor.innerHTML = `
    <header class="material-editor-header">
      <div><h2 id="materialEditorTitle">New material</h2><p id="materialEditorDescription">Define a material and its stress–strain curve.</p></div>
      <button class="material-editor-close" type="button" aria-label="Close material editor">×</button>
    </header>
    <form id="materialEditorForm" novalidate>
      <div id="materialEditorErrors" class="material-editor-errors" role="alert" hidden></div>
      <footer class="material-editor-footer"><button id="cancelMaterialEditor" type="button">Cancel</button></footer>
    </form>`;
  document.body.append(editor);
  const form = editor.querySelector('form');
  const errors = document.getElementById('materialEditorErrors');
  errors.after(inputs);
  inputs.className = '';
  inputs.style.removeProperty('display');
  const properties = document.createElement('div');
  properties.className = 'material-editor-properties';
  const curve = document.createElement('div');
  curve.className = 'material-editor-curve';
  curve.innerHTML = '<h3>Stress–strain curve</h3><p class="material-editor-hint">Order points by increasing strain. Compression is negative; tension is positive.</p><div class="material-editor-table-scroll"></div><div class="material-editor-preview"><canvas id="materialEditorPreview" aria-label="Material curve preview"></canvas></div>';
  const propertyIds = ['materialName', 'materialType', 'compressiveStrengthACI', 'expectedStrength'];
  propertyIds.forEach(id => {
    const group = document.getElementById(id).parentElement;
    group.className = id === 'expectedStrength' ? 'material-editor-expected' : '';
    properties.append(group);
  });
  curve.querySelector('.material-editor-table-scroll').append(document.getElementById('userStressStrainTable'));
  const addRow = document.getElementById('addRow');
  addRow.className = '';
  addRow.type = 'button';
  curve.querySelector('.material-editor-preview').before(addRow);
  const saveButton = document.getElementById('saveMaterial');
  saveButton.className = '';
  saveButton.type = 'button';
  saveButton.textContent = 'Create material';
  editor.querySelector('footer').append(saveButton);
  inputs.replaceChildren(properties, curve);
  document.getElementById('materialName').autocomplete = 'off';
  document.getElementById('materialName').maxLength = 120;
  document.getElementById('compressiveStrengthACI').step = 'any';

  document.getElementById('newMaterial').addEventListener('click', () => openMaterialEditor());
  document.getElementById('copyMaterial').addEventListener('click', () => {
    const selected = defaultMaterials.find(material => material.name === document.getElementById('materialDropdown').value);
    if (selected) openMaterialEditor(selected);
  });
  editor.querySelector('.material-editor-close').addEventListener('click', () => editor.close());
  document.getElementById('cancelMaterialEditor').addEventListener('click', () => editor.close());
  editor.addEventListener('close', () => returnFocus?.isConnected && returnFocus.focus());
  // CAD shortcuts are global. Typing or deleting values in this dialog must stay in the editor.
  editor.addEventListener('keydown', event => {
    event.stopPropagation();
    if (event.key === 'Enter' && event.target.matches('input:not([type="checkbox"])')) {
      event.preventDefault();
      saveMaterialEditor();
    }
  });
  editor.addEventListener('keyup', event => event.stopPropagation());
  form.addEventListener('submit', event => { event.preventDefault(); saveMaterialEditor(); });
  form.addEventListener('input', () => {
    if (validationShown) showValidation(false);
    updatePreview();
  });
  form.addEventListener('change', updatePreview);
  library.addEventListener('change', updateMaterialCopyAction);
}

export function updateMaterialCopyAction() {
  const copy = document.getElementById('copyMaterial');
  if (copy) copy.disabled = !defaultMaterials.some(material => material.name === document.getElementById('materialDropdown')?.value);
}

export function openMaterialEditor(source) {
  if (!editor || editor.open) return;
  returnFocus = document.activeElement;
  validationShown = false;
  document.getElementById('materialEditorErrors').hidden = true;
  editor.querySelectorAll('[aria-invalid]').forEach(input => input.removeAttribute('aria-invalid'));
  const draft = createMaterialDraft(source, defaultMaterials);
  document.getElementById('materialEditorTitle').textContent = source ? 'Copy material' : 'New material';
  document.getElementById('materialEditorDescription').textContent = source
    ? `Start from ${source.name}. Changes apply only to your new material.`
    : 'Define a material and its stress–strain curve.';
  document.getElementById('materialName').value = draft.name;
  document.getElementById('materialType').value = draft.type;
  document.getElementById('expectedStrength').checked = draft.strengthBasis === 'expected';
  document.getElementById('compressiveStrengthACI').value = draft.compressiveStrengthACI;
  document.getElementById('compressiveStrengthACIField').style.display = draft.type === 'concrete' ? 'block' : 'none';
  document.getElementById('userStressStrainTable').tBodies[0].replaceChildren();
  draft.rows.forEach(row => addMaterialEditorRow(row));
  editor.showModal();
  updatePreview();
  document.getElementById('materialName').focus();
  document.getElementById('materialName').select();
}

export function addMaterialEditorRow(values = {}) {
  const tableBody = document.getElementById('userStressStrainTable').tBodies[0];
  const row = document.createElement('tr');
  row.innerHTML = '<td><input type="number" step="any" class="strainInput"></td><td><input type="number" step="any" class="stressInput"></td><td><button type="button" class="removeRow">×</button></td>';
  row.querySelector('.strainInput').value = values.strain ?? '';
  row.querySelector('.stressInput').value = values.stress ?? '';
  row.querySelector('button').addEventListener('click', () => {
    const nextFocus = row.nextElementSibling?.querySelector('input') ?? row.previousElementSibling?.querySelector('input') ?? document.getElementById('addRow');
    row.remove();
    labelRows();
    if (validationShown) showValidation(false);
    updatePreview();
    nextFocus.focus();
  });
  tableBody.append(row);
  labelRows();
  if (editor?.open) {
    row.querySelector('input').focus();
    updatePreview();
  }
}

function labelRows() {
  Array.from(document.getElementById('userStressStrainTable').tBodies[0].rows).forEach((row, index) => {
    row.querySelector('.strainInput').setAttribute('aria-label', `Row ${index + 1} strain`);
    row.querySelector('.stressInput').setAttribute('aria-label', `Row ${index + 1} stress in psi`);
    row.querySelector('button').setAttribute('aria-label', `Remove row ${index + 1}`);
  });
}

function readDraft() {
  return {
    name: document.getElementById('materialName').value,
    type: document.getElementById('materialType').value,
    strengthBasis: document.getElementById('expectedStrength').checked ? 'expected' : 'normal',
    compressiveStrengthACI: document.getElementById('compressiveStrengthACI').value,
    rows: Array.from(document.getElementById('userStressStrainTable').tBodies[0].rows).map(row => ({
      strain: row.querySelector('.strainInput').value,
      stress: row.querySelector('.stressInput').value
    }))
  };
}

function fieldForError(field) {
  const fields = { name: 'materialName', type: 'materialType', strengthBasis: 'expectedStrength', compressiveStrengthACI: 'compressiveStrengthACI', rows: 'addRow' };
  if (fields[field]) return document.getElementById(fields[field]);
  const [kind, index] = field.split(':');
  return document.getElementById('userStressStrainTable').tBodies[0].rows[Number(index)]?.querySelector(`.${kind}Input`);
}

function showValidation(focus) {
  validationShown = true;
  const errors = validateMaterialDraft(readDraft(), defaultMaterials);
  const container = document.getElementById('materialEditorErrors');
  container.replaceChildren();
  container.hidden = !errors.length;
  editor.querySelectorAll('[aria-invalid]').forEach(input => {
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  });
  const list = document.createElement('ul');
  errors.forEach((error, index) => {
    const item = document.createElement('li');
    item.id = `materialValidation${index}`;
    item.textContent = error.message;
    list.append(item);
    const field = fieldForError(error.field);
    field?.setAttribute('aria-invalid', 'true');
    field?.setAttribute('aria-describedby', item.id);
  });
  container.append(list);
  if (focus && errors.length) fieldForError(errors[0].field)?.focus();
  return errors.length === 0;
}

export function saveMaterialEditor() {
  if (!editor?.open || !showValidation(true)) return;
  const material = materialFromDraft(readDraft(), defaultMaterials);
  onSaveMaterial(material);
  document.getElementById('materialLibraryStatus').textContent = `Created ${material.name}. Ready to assign to your section.`;
  editor.close();
}

function updatePreview() {
  if (!editor?.open) return;
  const draft = readDraft();
  const points = draft.rows
    .filter(row => row.strain.trim() && row.stress.trim())
    .map(row => ({ x: Number(row.strain), y: Number(row.stress) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  const ordered = points.every((point, index) => !index || point.x > points[index - 1].x);
  const guide = ordered ? getACICompressiveStressGuide({
    type: draft.type,
    compressiveStrengthACI: Number(draft.compressiveStrengthACI),
    strainData: points.map(point => point.x),
    stressData: points.map(point => point.y)
  }) : null;
  const datasets = [{
    label: 'Stress–strain', data: points, borderWidth: 2,
    borderColor: '#1d4ed8', pointRadius: 2, showLine: ordered,
    segment: { borderColor: context => (context.p0.parsed.y + context.p1.parsed.y) / 2 > 0 ? '#b91c1c' : '#1d4ed8' },
    pointBackgroundColor: points.map(point => point.y > 0 ? '#b91c1c' : '#1d4ed8')
  }];
  if (guide) datasets.push({ label: '0.85 f′c limit', data: guide.points, borderColor: '#64748b', borderDash: [5, 4], borderWidth: 1, pointRadius: 0 });
  if (!preview) preview = new Chart(document.getElementById('materialEditorPreview'), {
    type: 'line', data: { datasets }, options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Strain' }, ticks: { maxTicksLimit: 4 } },
        y: { title: { display: true, text: 'Stress (psi)' }, ticks: { maxTicksLimit: 4 } }
      }
    }
  });
  else { preview.data.datasets = datasets; preview.update('none'); }
}
