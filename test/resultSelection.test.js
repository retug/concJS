import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSectionResultPoint } from '../src/analysis/resultSelection.js';

const steel = {
  name: 'fy60ksi',
  stress: strain => strain * 29000000
};

test('a rebar result uses the active analysis strain profile', () => {
  const rebar = {
    materialData: steel,
    transformedCentroid: { 45: { v: 3 } }
  };
  const section = {
    currentResponseAngle: 45,
    currentStrainProfile: [0.001, -0.002]
  };

  const result = resolveSectionResultPoint(rebar, section);
  assert.equal(result.material, steel);
  assert.equal(result.strain, 0.001);
  assert.equal(result.stress, 29000);
});

test('a FEM result uses its governing polygon material', () => {
  const concrete = { name: 'fc5ksi', stress: strain => strain * 1000000 };
  const element = {
    userData: { material: concrete },
    transformedCentroid: { 0: { v: -2 } }
  };
  const section = {
    currentResponseAngle: 0,
    currentStrainProfile: [0.0005, -0.001]
  };

  const result = resolveSectionResultPoint(element, section);
  assert.equal(result.strain, -0.002);
  assert.equal(result.stress, -2000);
});

test('missing active response data does not create an undefined chart point', () => {
  assert.equal(resolveSectionResultPoint({ materialData: steel }, null), null);
});
