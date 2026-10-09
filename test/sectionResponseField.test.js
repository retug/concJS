import test from 'node:test';
import assert from 'node:assert/strict';
import {
  linearStrainAtPoint,
  responseColor,
  responseColorCSS,
  responseGradientCSS,
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

test('uniform nonzero fields retain saturated compression or tension colors', () => {
  // Profile 0 gives one compressive strain and stress throughout the section.
  for (const value of [-0.003, -4.25, -50]) {
    assert.deepEqual(responseColor(value, value, value), [29, 78, 216]);
  }
  for (const value of [0.005, 50]) {
    assert.deepEqual(responseColor(value, value, value), [185, 28, 28]);
  }
  assert.deepEqual(responseColor(0, 0, 0), [226, 232, 240]);
});

test('one-sided fields fade toward numeric zero rather than the nearest extremum', () => {
  assert.deepEqual(responseColor(-100, -100, -25), [29, 78, 216]);
  assert.deepEqual(responseColor(-25, -100, -25), [177, 194, 234]);
  assert.deepEqual(responseColor(25, 25, 100), [216, 181, 187]);
  assert.deepEqual(responseColor(100, 25, 100), [185, 28, 28]);

  for (const [min, max] of [[-100, -25], [25, 100], [-100, 25]]) {
    assert.deepEqual(responseColor(0, min, max), [226, 232, 240]);
  }
});

test('mixed fields scale compression and tension separately from zero', () => {
  assert.deepEqual(responseColor(-25, -100, 20), [177, 194, 234]);
  assert.deepEqual(responseColor(5, -100, 20), [216, 181, 187]);
  assert.deepEqual(responseColor(-200, -100, 20), [29, 78, 216]);
  assert.deepEqual(responseColor(40, -100, 20), [185, 28, 28]);
});

test('legend colors match field colors for uniform and one-sided fields', () => {
  assert.equal(responseColorCSS(-50, -50, -50), 'rgb(29, 78, 216)');
  assert.equal(responseColorCSS(50, 50, 50), 'rgb(185, 28, 28)');
  assert.equal(responseGradientCSS(-50, -50),
    'linear-gradient(to right, rgb(29, 78, 216), rgb(29, 78, 216), rgb(29, 78, 216))');
  assert.equal(responseGradientCSS(50, 50),
    'linear-gradient(to right, rgb(185, 28, 28), rgb(185, 28, 28), rgb(185, 28, 28))');
  assert.equal(responseGradientCSS(0, 0),
    'linear-gradient(to right, rgb(226, 232, 240), rgb(226, 232, 240), rgb(226, 232, 240))');
  assert.equal(responseGradientCSS(-100, -25),
    'linear-gradient(to right, rgb(29, 78, 216), rgb(103, 136, 225), rgb(177, 194, 234))');
  assert.equal(responseGradientCSS(25, 100),
    'linear-gradient(to right, rgb(216, 181, 187), rgb(200, 105, 108), rgb(185, 28, 28))');
});

test('mixed-field legends position the light neutral color at numeric zero', () => {
  assert.equal(responseGradientCSS(-80, 20),
    'linear-gradient(to right, rgb(29, 78, 216) 0%, rgb(226, 232, 240) 80%, rgb(185, 28, 28) 100%)');
});
