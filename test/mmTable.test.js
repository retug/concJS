import test from 'node:test';
import assert from 'node:assert/strict';
import { getMMTableRows } from '../src/analysis/mmTable.js';

test('MM table pairs independently solved nominal/design values on one row per angle', () => {
  const result = {
    axialLoad: -500,
    points: [{
      angle: 17.5,
      nominal: { P: -500.03, Mx: 180, My: -90, strainProfile: [-0.001, 0.003] },
      phi: { P: -499.98, Mx: 125, My: -48, strainProfile: [-0.002, 0.001] }
    }]
  };
  const original = structuredClone(result);
  assert.deepEqual(getMMTableRows(result), [
    { index: 0, angle: 17.5, axialLoad: -500, P: -500.03, Mx: 180, My: -90,
      phiP: -499.98, phiMx: 125, phiMy: -48, selectableModes: ['nominal', 'phi'] }
  ]);
  assert.deepEqual(result, original, 'Table extraction must not alter solved responses.');
});

test('MM table retains unavailable branches and real zeros without fabricating capacity', () => {
  const rows = getMMTableRows({ axialLoad: 0, points: [
    { angle: 0, nominal: { P: 0, Mx: 0, My: 20, strainProfile: [0, 0] }, phi: null },
    { angle: 90, nominal: null, phi: { P: 0, Mx: NaN, My: Infinity, strainProfile: [0, 0.003] } }
  ] });
  assert.deepEqual(rows[0], { index: 0, angle: 0, axialLoad: 0, P: 0, Mx: 0, My: 20,
    phiP: null, phiMx: null, phiMy: null, selectableModes: ['nominal'] });
  assert.deepEqual(rows[1], { index: 1, angle: 90, axialLoad: 0, P: null, Mx: null, My: null,
    phiP: 0, phiMx: null, phiMy: null, selectableModes: [] });
});

test('MM table keeps original adaptive point indices and the closing 360-degree solution', () => {
  const solution = { P: -100, Mx: 50, My: 0, strainProfile: [-0.002, 0.001] };
  const rows = getMMTableRows({ axialLoad: -100, points: [
    { angle: 0, nominal: solution },
    { angle: 2.5, nominal: solution },
    { angle: 360, nominal: solution, phi: solution }
  ] });
  assert.deepEqual(rows.map(row => [row.index, row.angle]), [
    [0, 0], [1, 2.5], [2, 360]
  ]);
});

test('MM response selection requires a valid solved strain profile and handles empty results', () => {
  assert.deepEqual(getMMTableRows(null), []);
  assert.deepEqual(getMMTableRows({}), []);
  assert.deepEqual(getMMTableRows({ points: [] }), []);
  const point = { P: 0, Mx: 1, My: 2 };
  for (const strainProfile of [undefined, [], [0], [0, NaN], [0, Infinity], [0, 0, 0]]) {
    const rows = getMMTableRows({ axialLoad: 0, points: [{ angle: 0, nominal: { ...point, strainProfile } }] });
    assert.deepEqual(rows[0].selectableModes, []);
  }
  const rows = getMMTableRows({ axialLoad: Infinity, points: [{ angle: NaN, nominal: { ...point, strainProfile: [0, 0] } }] });
  assert.equal(rows[0].angle, null);
  assert.equal(rows[0].axialLoad, null);
  assert.deepEqual(rows[0].selectableModes, []);
});

test('MM row selection falls back to design only when no valid nominal response exists', () => {
  const solution = { P: -100, Mx: 50, My: 0, strainProfile: [-0.002, 0.001] };
  const [row] = getMMTableRows({ axialLoad: -100, points: [{ angle: 15, nominal: null, phi: solution }] });
  assert.deepEqual(row.selectableModes, ['phi']);
  assert.equal(row.P, null);
  assert.equal(row.phiP, -100);
  assert.equal(row.phiMx, 50);
});
