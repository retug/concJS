import test from 'node:test';
import assert from 'node:assert/strict';
import { getAnalysisConfiguration } from '../src/projectState.js';

test('new analyses default to 3-inch edge and interior meshing', () => {
  const configuration = getAnalysisConfiguration();

  assert.equal(configuration.edgeSpacing, 3);
  assert.equal(configuration.interiorSpacing, 3);
});
