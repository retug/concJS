import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateRebarForce,
  findRebarConcreteMaterial
} from '../src/analysis/rebarConcreteDisplacement.js';

function material(name, type, strength, stressAtStrain) {
  return {
    name,
    type,
    stressData: [0, -strength, 0],
    stress: stressAtStrain
  };
}

function element(x, y, concreteMaterial) {
  return {
    centroid: { x, y },
    userData: { material: concreteMaterial }
  };
}

function rebar(x, y) {
  return {
    geometry: {
      attributes: { position: { array: [x, y, 0] } }
    }
  };
}

test('compression rebar force subtracts concrete stress at the same strain', () => {
  const steel = material('Steel', 'steel', 60000, () => -60000);
  const concrete = material('Concrete', 'concrete', 5000, () => -5000);

  assert.equal(calculateRebarForce(2, steel, concrete, -0.003), -110000);
});

test('tension rebar force is not adjusted for concrete', () => {
  const steel = material('Steel', 'steel', 60000, () => 60000);
  const concrete = material('Concrete', 'concrete', 5000, () => 5000);

  assert.equal(calculateRebarForce(2, steel, concrete, 0.003), 120000);
});

test('the material at the closest concrete element centroid governs', () => {
  const near = material('Near', 'concrete', 4000, () => -4000);
  const far = material('Far', 'concrete', 9000, () => -9000);
  const selected = findRebarConcreteMaterial(rebar(0, 0), [
    element(0.25, 0, near),
    element(2, 0, far)
  ]);

  assert.equal(selected, near);
});

test('within one inch of the closest centroid, the strongest curve governs', () => {
  const closest = material('Closest', 'concrete', 4000, () => -4000);
  const stronger = material('Stronger', 'concrete', 8000, () => -8000);
  const selected = findRebarConcreteMaterial(rebar(0, 0), [
    element(0.25, 0, closest),
    element(1.25, 0, stronger)
  ]);

  assert.equal(selected, stronger);
});

test('non-concrete FEM elements are ignored during material selection', () => {
  const concrete = material('Concrete', 'concrete', 5000, () => -5000);
  const steel = material('Plate', 'steel', 50000, () => -50000);
  const selected = findRebarConcreteMaterial(rebar(0, 0), [
    element(0, 0, steel),
    element(3, 0, concrete)
  ]);

  assert.equal(selected, concrete);
});

test('a user-defined material assigned to concrete remains eligible', () => {
  const customConcrete = material('Custom Concrete', 'other', 7000, () => -7000);

  assert.equal(
    findRebarConcreteMaterial(rebar(0, 0), [element(0, 0, customConcrete)]),
    customConcrete
  );
});
