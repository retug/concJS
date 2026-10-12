import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultMaterials } from '../src/materials.js';
import { createMaterialDraft, materialFromDraft, validateMaterialDraft } from '../src/materialEditorData.js';

test('copying concrete preserves properties and produces independent curve data', () => {
  const source = defaultMaterials.find(material => material.name === 'fc5ksi');
  const draft = createMaterialDraft(source, defaultMaterials);
  const copy = materialFromDraft(draft, defaultMaterials);
  assert.equal(copy.name, 'fc5ksi copy');
  assert.equal(copy.type, source.type);
  assert.equal(copy.normal_or_expected, source.normal_or_expected);
  assert.equal(copy.compressiveStrengthACI, source.compressiveStrengthACI);
  assert.deepEqual(copy.strainData, source.strainData);
  assert.deepEqual(copy.stressData, source.stressData);
  copy.stressData[1] = -6100;
  copy.strainData[1] = -0.5;
  assert.equal(source.stressData[1], -5000);
  assert.equal(source.strainData[1], -1);
  draft.rows[0].stress = -100;
  assert.equal(copy.stressData[0], 0);
});

test('copy names remain unique, including case variants, and expected strength is retained', () => {
  const source = defaultMaterials.find(material => material.name === 'fye75ksi');
  const draft = createMaterialDraft(source, [source, { name: 'FYE75KSI COPY' }, { name: 'fye75ksi copy 2' }]);
  assert.equal(draft.name, 'fye75ksi copy 3');
  assert.equal(draft.strengthBasis, 'expected');
  assert.equal(materialFromDraft(draft).normal_or_expected, 'expected');
});

test('blank, non-finite and duplicate strain points cannot be saved', () => {
  const draft = createMaterialDraft(defaultMaterials[0]);
  draft.name = 'valid name';
  draft.rows = [{ strain: '', stress: 0 }, { strain: 0, stress: Infinity }, { strain: 0, stress: 2000 }];
  const errors = validateMaterialDraft(draft);
  assert.ok(errors.some(error => error.field === 'strain:0'));
  assert.ok(errors.some(error => error.field === 'stress:1'));
  assert.ok(errors.some(error => error.field === 'strain:2'));
  assert.throws(() => materialFromDraft(draft), /finite strain/);
});

test('material names and concrete strengths are validated before creating a material', () => {
  const draft = createMaterialDraft(defaultMaterials[0]);
  draft.name = ' FC4KSI ';
  draft.compressiveStrengthACI = 0;
  let errors = validateMaterialDraft(draft, defaultMaterials);
  assert.ok(errors.some(error => error.field === 'name'));
  assert.ok(errors.some(error => error.field === 'compressiveStrengthACI'));
  draft.name = ' '; draft.rows = [];
  errors = validateMaterialDraft(draft);
  assert.ok(errors.some(error => error.field === 'name'));
  assert.ok(errors.some(error => error.field === 'rows'));
});

test('decreasing strain is rejected and steel does not require concrete strength', () => {
  const draft = {
    name: 'New steel', type: 'steel', strengthBasis: 'normal', compressiveStrengthACI: '',
    rows: [{ strain: -0.01, stress: -50000 }, { strain: 0.01, stress: 50000 }]
  };
  assert.deepEqual(validateMaterialDraft(draft), []);
  const steel = materialFromDraft(draft);
  assert.equal(steel.stress(0), 0);
  draft.rows.reverse();
  assert.ok(validateMaterialDraft(draft).some(error => error.field === 'strain:1'));
});
