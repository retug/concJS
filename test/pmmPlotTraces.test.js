import test from 'node:test';
import assert from 'node:assert/strict';
import { createPMMPlotTraces, createPMMAxisTraces } from '../src/analysis/pmmPlotTraces.js';
import { buildPMMCapacitySurface, checkDemand } from '../src/analysis/demandCapacity.js';

function sampledPMM() {
  const results = {};
  for (let angle = 0; angle <= 180; angle += 15) {
    const branch = direction => Array.from({ length: 51 }, (_, index) => {
      const P = -1000 + 40 * index;
      const radius = 1 - Math.abs(P) / 1000;
      const radians = (angle + direction) * Math.PI / 180;
      return [P, radius * 200 * Math.cos(radians) - P * 0.02,
        radius * 100 * Math.sin(radians) + P * 0.01];
    });
    const points = [...branch(0), ...branch(180).reverse().slice(1, -1)];
    results[angle] = Object.fromEntries(['P', 'Mx', 'My'].map((key, axis) => [key, [points.map(point => point[axis])]]));
    for (const [source, target] of [['P', 'phiP'], ['Mx', 'phiMx'], ['My', 'phiMy']]) {
      results[angle][target] = [results[angle][source][0].map(value => source === 'P' ? Math.max(-500, value * 0.7) : value * 0.7)];
    }
  }
  return results;
}

test('PMM traces draw explicit closed nominal/design meshes and preserve capped eccentric endpoints', () => {
  const results = sampledPMM();
  const original = structuredClone(results);
  const traces = createPMMPlotTraces(results, 45);
  assert.equal(traces.length, 4);
  for (const mesh of traces.slice(0, 2)) {
    assert.equal(mesh.type, 'mesh3d');
    assert.equal(mesh.meta.isPMMSurface, true);
    assert.equal(mesh.hoverinfo, 'skip');
    assert.ok(mesh.opacity > 0 && mesh.opacity < 0.3);
    assert.equal(mesh.x.length, 1178);
    assert.equal(mesh.i.length, 2352);
    assert.equal(mesh.alphahull, undefined);
    const edges = new Map();
    for (let index = 0; index < mesh.i.length; index++) {
      const face = [mesh.i[index], mesh.j[index], mesh.k[index]];
      assert.equal(new Set(face).size, 3);
      assert.ok(face.every(vertex => Number.isInteger(vertex) && vertex >= 0 && vertex < mesh.x.length));
      for (let edge = 0; edge < 3; edge++) {
        const key = [face[edge], face[(edge + 1) % 3]].sort((a, b) => a - b).join(':');
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2));
    assert.equal(mesh.x.length - edges.size + mesh.i.length, 2);
  }
  const [nominal, design] = traces;
  assert.deepEqual([nominal.z[0], nominal.x[0], nominal.y[0]], [-1000, 20, -10]);
  assert.deepEqual([design.z[0], design.x[0], design.y[0]], [-500, 14, -7]);
  assert.deepEqual([design.z[1], design.x[1], design.y[1]], [700, -14, 7]);
  assert.equal(Math.min(...design.z), -500);
  assert.deepEqual(results, original);
});

test('mesh edges follow adjacent sampled meridians across both half-surfaces and the wrap seam', () => {
  const nominal = createPMMPlotTraces(sampledPMM(), 0)[0];
  const angles = nominal.x.map((x, index) => {
    const P = nominal.z[index];
    if (Math.abs(P) === 1000) return null;
    return Math.atan2((nominal.y[index] - P * 0.01) / 100, (x + P * 0.02) / 200);
  });
  let wrapSeen = false;
  let negativeHalfSeen = false;
  for (let index = 0; index < nominal.i.length; index++) {
    const face = [nominal.i[index], nominal.j[index], nominal.k[index]];
    for (let edge = 0; edge < 3; edge++) {
      const first = angles[face[edge]], second = angles[face[(edge + 1) % 3]];
      if (first === null || second === null) continue;
      const rawDifference = Math.abs(first - second);
      const difference = Math.min(rawDifference, 2 * Math.PI - rawDifference);
      assert.ok(difference <= Math.PI / 12 + 1e-12);
      if (rawDifference > Math.PI) wrapSeen = true;
      if (first < -Math.PI / 2) negativeHalfSeen = true;
    }
  }
  assert.equal(wrapSeen, true);
  assert.equal(negativeHalfSeen, true);
});

test('selected-axis loops close in orange and retain exact angle/profile metadata for picking', () => {
  const results = sampledPMM();
  for (const angle of [0, 45, 180]) {
    const traces = createPMMPlotTraces(results, String(angle));
    for (const [offset, prefix] of [[2, ''], [3, 'phi']]) {
      const line = traces[offset];
      assert.equal(line.type, 'scatter3d');
      assert.equal(line.mode, 'lines');
      assert.equal(line.line.color, '#ff8c69');
      assert.equal(line.meta.isPMMAxis, true);
      assert.equal(line.meta.mode, prefix ? 'phi' : 'nominal');
      assert.equal(line.meta.isPMMSurface, undefined);
      assert.equal(line.customdata.length, 101);
      for (let index = 0; index <= 100; index++) {
        const profile = index % 100;
        assert.deepEqual(line.customdata[index], [angle, profile]);
        assert.equal(line.x[index], results[angle][`${prefix}Mx`][0][profile]);
        assert.equal(line.y[index], results[angle][`${prefix}My`][0][profile]);
        assert.equal(line.z[index], results[angle][`${prefix}P`][0][profile]);
      }
    }
    assert.equal(traces[2].line.dash, 'dash');
    assert.equal(traces[3].line.dash, 'solid');
    assert.deepEqual(createPMMAxisTraces(results, angle), traces.slice(2));
  }
});

test('displayed design triangles agree with the checking surface instead of reapplying phi or taking a hull', () => {
  const results = sampledPMM();
  const design = createPMMPlotTraces(results, 0)[1];
  const surface = buildPMMCapacitySurface(results);
  const visualTriangles = design.i.map((first, index) => [first, design.j[index], design.k[index]]
    .map(vertex => [design.z[vertex], design.x[vertex], design.y[vertex]]
      .map((value, axis) => value / surface.scales[axis])));
  const visualSurface = { scales: surface.scales, triangles: visualTriangles };
  const demand = { P: -200, M2: 35, M3: 10 };
  assert.deepEqual(checkDemand(visualSurface, demand), checkDemand(surface, demand));
});

test('incomplete PMM data or an unavailable selected angle is rejected before plotting', () => {
  const results = sampledPMM();
  assert.throws(() => createPMMPlotTraces(results, 10), /available.*angle/);
  delete results[75];
  assert.throws(() => createPMMPlotTraces(results, 0), /75°.*incomplete/);
});
