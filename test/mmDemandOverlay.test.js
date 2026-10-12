import test from 'node:test';
import assert from 'node:assert/strict';
import { createMMDemandOverlay } from '../src/analysis/mmDemandOverlay.js';

const demand = (M2, M3, P = -100) => ({ id: 'd1', name: 'Combo <1> & 2', P, M2, M3 });
const curve = vertices => ({ axialLoad: -100, points: vertices.map(([Mx, My]) => ({ phi: { Mx, My } })) });
const square = curve([[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);

test('intersection lies on the displayed curve and extends ray past an interior demand without a DCR', () => {
  const overlay = createMMDemandOverlay(square, demand(4, 2));
  assert.deepEqual(overlay.capacity, { P: -100, M2: 10, M3: 5 });
  assert.deepEqual(overlay.traces[1].x, [0, 10]);
  assert.deepEqual(overlay.traces[1].y, [0, 5]);
  assert.match(overlay.traces[0].text[0], /Combo &lt;1&gt; &amp; 2/);
  assert.equal(overlay.traces[0].marker.color, '#ff8c69');
  assert.equal(overlay.traces[2].name, 'MM curve intersection');
  assert.equal('dcr' in overlay, false);
});

test('outside demand is red and ray reaches demand while capacity stays on the curve', () => {
  const overlay = createMMDemandOverlay(square, demand(20, 10));
  assert.deepEqual(overlay.capacity, { P: -100, M2: 10, M3: 5 });
  assert.deepEqual(overlay.traces[1].x, [0, 20]);
  assert.equal(overlay.traces[0].marker.color, '#b91c1c');
  assert.match(overlay.message, /beyond/);
});

test('boundary/vertex intersections stay orange and work in negative directions', () => {
  const overlay = createMMDemandOverlay(square, demand(-10, -10));
  near(overlay.capacity.M2, -10);
  near(overlay.capacity.M3, -10);
  assert.equal(overlay.traces[0].marker.color, '#ff8c69');
});

test('concave curve uses its first exit rather than a convex hull or farther reentry', () => {
  const concave = curve([[-2, -2], [2, -2], [2, 1], [4, 1], [4, -2], [6, -2], [6, 2], [-2, 2], [-2, -2]]);
  const overlay = createMMDemandOverlay(concave, demand(1, 0));
  near(overlay.capacity.M2, 2);
  near(overlay.capacity.M3, 0);
});

test('vertex tangent does not stop the ray while the following interval remains inside', () => {
  const notched = curve([[-2, -2], [6, -2], [6, 2], [4, 2], [3, 0], [2, 2], [-2, 2], [-2, -2]]);
  const overlay = createMMDemandOverlay(notched, demand(1, 0));
  near(overlay.capacity.M2, 6);
});

test('collinear boundary rays reach the end and outward boundary rays have zero capacity', () => {
  const boundary = curve([[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  const along = createMMDemandOverlay(boundary, demand(3, 0));
  near(along.capacity.M2, 10);
  near(along.capacity.M3, 0);
  const outward = createMMDemandOverlay(boundary, demand(-1, 0));
  near(outward.capacity.M2, 0);
  near(outward.capacity.M3, 0);
  assert.equal(outward.traces[0].marker.color, '#b91c1c');
});

test('missing or mismatched selection does not overlay a different axial slice', () => {
  assert.deepEqual(createMMDemandOverlay(square, demand(1, 1, -101)).traces, []);
  assert.deepEqual(createMMDemandOverlay(null, demand(1, 1)).traces, []);
  assert.deepEqual(createMMDemandOverlay(square, null).traces, []);
});

test('incomplete, unclosed, degenerate, and crossing curves never claim a capacity', () => {
  const missing = structuredClone(square);
  missing.points[1].phi = null;
  const invalid = [missing, curve([[-10, -10], [10, -10], [10, 10], [-10, 10]]),
    curve([[0, 0], [1, 0], [2, 0], [0, 0]]),
    curve([[-2, -2], [2, 2], [-2, 2], [2, -2], [-2, -2]])];
  for (const result of invalid) {
    const overlay = createMMDemandOverlay(result, demand(1, 1));
    assert.equal(overlay.capacity, null);
    assert.equal(overlay.traces[0].x.length, 1);
    assert.equal(overlay.traces[2].x.length, 0);
    assert.match(overlay.message, /complete, closed/);
  }
});

test('outside origin and zero moment demand have explicit unavailable states', () => {
  const shifted = curve([[2, -1], [4, -1], [4, 1], [2, 1], [2, -1]]);
  const outside = createMMDemandOverlay(shifted, demand(3, 0));
  assert.equal(outside.capacity, null);
  assert.match(outside.message, /zero-moment point is outside/);
  const zero = createMMDemandOverlay(square, demand(0, 0));
  assert.equal(zero.capacity, null);
  assert.deepEqual(zero.traces[1].x, []);
  assert.match(zero.message, /No moment direction/);
});

test('curve normalization preserves intersection at small and large moment scales', () => {
  for (const scale of [1e-8, 1e8]) {
    const scaled = structuredClone(square);
    for (const point of scaled.points) {
      point.phi.Mx *= scale;
      point.phi.My *= scale;
    }
    const overlay = createMMDemandOverlay(scaled, demand(2 * scale, scale));
    near(overlay.capacity.M2 / scale, 10);
    near(overlay.capacity.M3 / scale, 5);
  }
});
