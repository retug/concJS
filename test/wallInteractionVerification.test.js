import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildComparison, compareControl, percentDifference, verifyBaseline } from '../scripts/lib/verification-comparison.mjs';
import { validateAndNormalizeProject, createProjectDocument } from '../src/projectFile.js';

const directory = new URL('../verification/complicatedSPColumn/', import.meta.url);
const readJson = async filename => JSON.parse(await readFile(new URL(filename, directory), 'utf8'));
const [project, baseline, reference] = await Promise.all([
  readJson('sp-column-sepcial-structural-wall-copmressive.json'),
  readJson('retug-90deg-baseline.json'), readJson('published-control-points.json')
]);

test('production wall analysis reproduces every supplied 90-degree nominal and factored profile', () => {
  assert.equal(verifyBaseline(project, baseline), true);
});

test('a changed answer or model cannot silently replace the approved verification baseline', () => {
  const changed = structuredClone(baseline);
  changed.profiles[27].phiMy += 1;
  assert.throws(() => verifyBaseline(project, changed), /result changed.*27.*phiMy/);
  const changedModel = structuredClone(project);
  changedModel.analysisConfiguration.interiorSpacing = 2;
  assert.throws(() => verifyBaseline(changedModel, baseline), /model inputs changed/);
});

test('the fixed numerical baseline retains all 100 user-pasted values without transcription changes', async () => {
  const text = await readFile(new URL('retug-90deg-results.txt', directory), 'utf8');
  const rows = text.split(/\r?\n/).filter(line => /^\d+\t/.test(line));
  assert.equal(rows.length, 100);
  const keys = ['P', 'Mx', 'My', 'phiP', 'phiMx', 'phiMy'];
  rows.forEach((line, index) => {
    const values = line.replaceAll(',', '').split('\t').map(Number);
    assert.equal(values[0], index);
    keys.forEach((key, column) => assert.equal(baseline.profiles[index][key] || 0, values[column + 1] || 0));
  });
});

test('both published branches are saved as demand inputs with compression sign and My mapping', () => {
  const validation = validateAndNormalizeProject(project);
  assert.equal(validation.canImport, true);
  const saved = createProjectDocument(validation.project);
  const demands = saved.analysisConfiguration.demandCases;
  assert.equal(demands.length, 16);
  for (const published of reference.points) {
    const demand = demands.find(row => row.id === `spcolumn-${published.id}`);
    assert.equal(demand.P || 0, -published.P || 0);
    assert.equal(demand.M2, 0);
    assert.equal(demand.M3, published.M3);
  }
  assert.equal(demands[0].P, -67102);
  assert.equal(demands[1].M3, 195926.19);
  assert.equal(demands[9].M3, -195926.33);
});

test('named states stay on the intended branch when the factored curve folds', () => {
  const balanced = compareControl(reference.points[4], baseline, 0.00207);
  const tensionControl = compareControl(reference.points[5], baseline, 0.00207);
  assert.equal(balanced.match, 'Profile 13');
  assert.equal(balanced.computed.M3, 407808.96);
  assert.equal(tensionControl.match, 'Profile 16');
  assert.equal(tensionControl.computed.M3, 541077.52);
  const reverse = compareControl(reference.points[12], baseline, 0.00207);
  assert.equal(reverse.computed.M3, -407808.96);
  assert.equal(reverse.match, 'Profile 87');
});

test('pure bending and the axial cap are interpolated from the supplied curve without hiding cap differences', () => {
  const pure = compareControl(reference.points[6], baseline, 0.00207);
  assert.ok(Math.abs(pure.computed.P) < 1e-9);
  assert.ok(Math.abs(pure.computed.M3 - 139649.341923) < 0.1);
  assert.equal(pure.difference.P, null);
  const compression = compareControl(reference.points[0], baseline, 0.00207);
  assert.equal(compression.computed.P, 53681.62);
  assert.ok(Math.abs(compression.difference.P - 20) < 0.001);
  const allowable = compareControl(reference.points[1], baseline, 0.00207);
  assert.ok(Math.abs(allowable.computed.P - 53681.6) < 1e-9);
  assert.ok(allowable.computed.M3 > 181501 && allowable.computed.M3 < 181503);
});

test('percentage error uses reference magnitude and handles zero denominators honestly', () => {
  assert.equal(percentDifference(-110, -100), 10);
  assert.equal(percentDifference(90, 100), 10);
  assert.equal(percentDifference(0, 0), null);
  assert.equal(percentDifference(1, 0), null);
});

test('the comparison exposes all rows, original profiles and distinct plot layers', () => {
  const comparison = buildComparison(project, baseline, reference);
  assert.equal(comparison.rows.length, 16);
  assert.equal(comparison.profiles.length, 100);
  assert.match(comparison.chartSvg, /data-series="nominal"/);
  assert.match(comparison.chartSvg, /data-series="published"/);
  assert.match(comparison.chartSvg, /data-series="factored"/);
  assert.equal((comparison.chartSvg.match(/<circle /g) ?? []).length, 100);
  assert.match(comparison.method, /Named steel-control/);
});
