import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linearStrainAtPoint,
  responseColor,
  transformedVAtPoint
} from '../src/analysis/sectionResponseField.js';

test('strain is evaluated linearly at every section point', () => {
  const centroid = { x: 4, y: 3 };
  const profile = [0.001, -0.002];

  assert.equal(transformedVAtPoint(4, 1, centroid.x, centroid.y, 0), -2);
  assert.equal(linearStrainAtPoint(4, 1, centroid.x, centroid.y, 0, profile), -0.004);
  assert.equal(linearStrainAtPoint(4, 3, centroid.x, centroid.y, 0, profile), -0.002);
  assert.equal(linearStrainAtPoint(4, 5, centroid.x, centroid.y, 0, profile), 0);
});

test('strain transformation follows the neutral-axis angle', () => {
  assert.ok(Math.abs(transformedVAtPoint(2, 0, 0, 0, 90) + 2) < 1e-12);
  assert.ok(Math.abs(transformedVAtPoint(0, 2, 0, 0, 90)) < 1e-12);
});

test('response colors distinguish compression, neutral, and tension', () => {
  const compression = responseColor(-0.003, -0.003, 0.005);
  const neutral = responseColor(0, -0.003, 0.005);
  const tension = responseColor(0.005, -0.003, 0.005);

  assert.ok(compression[2] > compression[0]);
  assert.ok(neutral.every(component => component >= 220));
  assert.ok(tension[0] > tension[2]);
});
