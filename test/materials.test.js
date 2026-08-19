import test from 'node:test';
import assert from 'node:assert/strict';
import {
  A992_GRADE_50_MATERIAL_NAME,
  DEFAULT_PLATED_CORE_STEEL_NAME,
  defaultMaterials
} from '../src/materials.js';

test('A992 Grade 50 is available with a 50 ksi yield plateau', () => {
  const material = defaultMaterials.find(
    candidate => candidate.name === A992_GRADE_50_MATERIAL_NAME
  );

  assert.ok(material);
  assert.equal(material.type, 'steel');
  assert.equal(material.normal_or_expected, 'normal');
  assert.equal(material.stress(0.001725), 50000);
  assert.equal(material.stress(-0.001725), -50000);
  assert.equal(material.stress(0.005), 50000);
});

test('plated concrete cores default to A992 Grade 50', () => {
  assert.equal(DEFAULT_PLATED_CORE_STEEL_NAME, A992_GRADE_50_MATERIAL_NAME);
});
