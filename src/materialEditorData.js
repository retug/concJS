import { StructuralMaterial } from './materials.js';

export function createMaterialDraft(source, materials = []) {
  const names = new Set(materials.map(material => material.name.toLocaleLowerCase()));
  const baseName = source ? `${source.name} copy` : '';
  let name = baseName;
  let suffix = 2;
  while (name && names.has(name.toLocaleLowerCase())) name = `${baseName} ${suffix++}`;
  return {
    name,
    type: source?.type ?? 'concrete',
    strengthBasis: source?.normal_or_expected ?? 'normal',
    compressiveStrengthACI: source?.compressiveStrengthACI ?? '',
    rows: source
      ? source.strainData.map((strain, index) => ({ strain, stress: source.stressData[index] }))
      : [{ strain: '', stress: '' }, { strain: '', stress: '' }]
  };
}

function numericValue(value) {
  return typeof value === 'string' && !value.trim() ? NaN : Number(value);
}

export function validateMaterialDraft(draft, materials = []) {
  const errors = [];
  const name = String(draft.name ?? '').trim();
  if (!name) errors.push({ field: 'name', message: 'Enter a material name.' });
  else if (materials.some(material => material.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    errors.push({ field: 'name', message: 'This material name is already in use. Choose a different name.' });
  }
  if (!['concrete', 'steel', 'other'].includes(draft.type)) {
    errors.push({ field: 'type', message: 'Choose a material type.' });
  }
  if (!['normal', 'expected'].includes(draft.strengthBasis)) {
    errors.push({ field: 'strengthBasis', message: 'Choose normal or expected strength.' });
  }
  const strength = numericValue(draft.compressiveStrengthACI);
  if (draft.type === 'concrete' && (!Number.isFinite(strength) || strength <= 0)) {
    errors.push({ field: 'compressiveStrengthACI', message: 'Enter a positive f′c in psi.' });
  }
  const rows = draft.rows ?? [];
  if (rows.length < 2) errors.push({ field: 'rows', message: 'Add at least two stress–strain points.' });
  rows.forEach((row, index) => {
    const strain = numericValue(row.strain);
    if (!Number.isFinite(strain)) {
      errors.push({ field: `strain:${index}`, message: `Row ${index + 1}: enter a finite strain.` });
    } else if (index && Number.isFinite(numericValue(rows[index - 1].strain)) && strain <= numericValue(rows[index - 1].strain)) {
      errors.push({ field: `strain:${index}`, message: `Row ${index + 1}: strain must be greater than the previous row.` });
    }
    if (!Number.isFinite(numericValue(row.stress))) {
      errors.push({ field: `stress:${index}`, message: `Row ${index + 1}: enter a finite stress in psi.` });
    }
  });
  return errors;
}

export function materialFromDraft(draft, materials = []) {
  const errors = validateMaterialDraft(draft, materials);
  if (errors.length) throw new Error(errors.map(error => error.message).join(' '));
  return new StructuralMaterial(
    draft.name.trim(),
    draft.type,
    draft.strengthBasis,
    draft.rows.map(row => Number(row.stress)),
    draft.rows.map(row => Number(row.strain)),
    draft.type === 'concrete' ? Number(draft.compressiveStrengthACI) : null
  );
}
