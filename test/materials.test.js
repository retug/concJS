import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACI_CONCRETE_STRESS_FACTOR,
  A992_GRADE_50_MATERIAL_NAME,
  DEFAULT_PLATED_CORE_STEEL_NAME,
  StructuralMaterial,
  defaultMaterials,
  getACICompressiveStressGuide
} from '../src/materials.js';

test('default concrete materials carry their specified ACI compressive strength', () => {
  const strengths = new Map(
    defaultMaterials
      .filter(material => material.type === 'concrete')
      .map(material => [material.name, material.compressiveStrengthACI])
  );

  assert.deepEqual(strengths, new Map([
    ['fc4ksi', 4000],
    ['fc5ksi', 5000],
    ['fc6ksi', 6000],
    ['fce4ksi', 4000]
  ]));
});

test('concrete stress is capped at 0.85 f\'c without changing the input curve', () => {
  const material = new StructuralMaterial(
    'Test Concrete',
    'concrete',
    'normal',
    [0, -4000, -4000, 0],
    [-2, -1, -0.002, 0],
    4000
  );

  assert.equal(material.stress(-0.003), -ACI_CONCRETE_STRESS_FACTOR * 4000);
  assert.equal(material.stress(-0.001), -2000);
  assert.deepEqual(material.stressData, [0, -4000, -4000, 0]);
});

test('the ACI plot guide runs from the descending-branch intersection to zero strain', () => {
  const material = defaultMaterials.find(candidate => candidate.name === 'fc4ksi');
  const guide = getACICompressiveStressGuide(material);

  assert.equal(guide.stress, -3400);
  assert.ok(Math.abs(guide.intersectionStrain - (-1.15)) < 1e-12);
  assert.deepEqual(guide.points, [
    { x: guide.intersectionStrain, y: -3400 },
    { x: 0, y: -3400 }
  ]);
});

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
