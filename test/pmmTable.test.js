import test from 'node:test';
import assert from 'node:assert/strict';
import { getPMMTableRows } from '../src/analysis/pmmTable.js';

test('PMM table preserves signed values and the solved design axial cap for each profile', () => {
  const results = { 15: { P: [[120, -20]], Mx: [[-3, 4]], My: [[5, -6]],
    phiP: [[70, -18]], phiMx: [[-1.95, 3.6]], phiMy: [[3.25, -5.4]] } };
  assert.deepEqual(getPMMTableRows(results, 15), [
    { index: 0, P: 120, Mx: -3, My: 5, phiP: 70, phiMx: -1.95, phiMy: 3.25 },
    { index: 1, P: -20, Mx: 4, My: -6, phiP: -18, phiMx: 3.6, phiMy: -5.4 }
  ]);
});

test('PMM table shows missing values as unavailable instead of fabricated zero capacity', () => {
  assert.deepEqual(getPMMTableRows({ 0: { P: [[0]], Mx: [[NaN]], phiP: [[Infinity]] } }, 0), [
    { index: 0, P: 0, Mx: null, My: null, phiP: null, phiMx: null, phiMy: null }
  ]);
  assert.deepEqual(getPMMTableRows({}, 90), []);
});
