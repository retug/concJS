import test from 'node:test';
import assert from 'node:assert/strict';
import { createCapacitySurface, buildPMMCapacitySurface, checkDemand } from '../src/analysis/demandCapacity.js';

const boxVertices = [
  [-1000, -200, -100], [-1000, -200, 100], [-1000, 200, -100], [-1000, 200, 100],
  [1000, -200, -100], [1000, -200, 100], [1000, 200, -100], [1000, 200, 100]
];
const boxFaces = [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
  [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]];
const surface = createCapacitySurface(boxVertices, boxFaces);
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);

test('constant axial load is the default and scales only moments in signed quadrants and on axial caps', () => {
  for (const P of [-1000, -400, 0, 400, 1000]) {
    for (const M2 of [-250, -80, 0, 80, 250]) {
      for (const M3 of [-150, -30, 0, 30, 150]) {
        if (M2 === 0 && M3 === 0) continue;
        const result = checkDemand(surface, { P, M2, M3 });
        const expected = Math.max(Math.abs(M2) / 200, Math.abs(M3) / 100);
        close(result.dcr, expected);
        assert.equal(result.method, 'constant-p');
        assert.equal(result.capacity.P, P);
        close(result.capacity.M2, M2 / expected);
        close(result.capacity.M3, M3 / expected);
        assert.deepEqual(result.rayOrigin, { P, M2: 0, M3: 0 });
        assert.equal(result.status, expected <= 1 ? 'within' : 'exceeds');
      }
    }
  }
});

test('fixed-P checks distinguish zero loads, pure axial membership and axial demand outside the surface', () => {
  assert.equal(checkDemand(surface, { P: 0, M2: 0, M3: 0 }).status, 'zero');
  for (const P of [-1000, -500, 500, 1000]) {
    const result = checkDemand(surface, { P, M2: 0, M3: 0 });
    assert.equal(result.status, 'within');
    assert.equal(result.dcr, null);
    assert.match(result.message, /No moment direction/);
  }
  for (const P of [-1200, 1200]) {
    for (const M2 of [0, 20]) {
      const result = checkDemand(surface, { P, M2, M3: 0 });
      assert.equal(result.status, 'exceeds');
      assert.equal(result.dcr, Infinity);
      assert.equal(result.capacity, null);
    }
  }
  assert.equal(checkDemand(surface, { P: -100, M2: 10, M3: 0 }, 'invalid').status, 'unresolved');
});

test('constant-P and origin methods agree at P=0 and give distinct analytical ratios away from it', () => {
  const generated = buildPMMCapacitySurface(generatedBicone());
  const demand = { P: -500, M2: 50, M3: 0 };
  // The sheared bicone at P=-500 has M2 capacity 100 + 10 = 110.
  close(checkDemand(generated, demand).dcr, 50 / 110);
  // On the origin ray, |P|/1000 + |M2 + .02P|/200 = .7.
  close(checkDemand(generated, demand, 'origin').dcr, 0.7);
  for (const M2 of [-100, 0, 100]) {
    for (const M3 of [-30, 0, 30]) {
      const fixed = checkDemand(generated, { P: 0, M2, M3 });
      const radial = checkDemand(generated, { P: 0, M2, M3 }, 'origin');
      close(fixed.dcr, radial.dcr);
    }
  }
  const asymmetric = checkDemand(generated, { P: -950, M2: 19, M3: 0 });
  assert.equal(asymmetric.status, 'unresolved');
  assert.match(asymmetric.message, /zero-moment point.*outside/);
  assert.equal(checkDemand(generated, { P: -950, M2: 0, M3: 0 }).status, 'exceeds');
});

test('horizontal rays preserve concavity and handle an immediate exit from a boundary origin', () => {
  // Swap the prism axes so the notched direction is M2 at a fixed P.
  const original = notchedPrism();
  const swap = vector => [vector[1], vector[0], vector[2]];
  const rotated = { scales: swap(original.scales), triangles: original.triangles.map(face => face.map(swap)) };
  const result = checkDemand(rotated, { P: 0.2, M2: 1.5, M3: 0 });
  close(result.dcr, 3);
  close(result.capacity.M2, 0.5);
  assert.equal(result.capacity.P, 0.2);
  const boundary = notchedPrism(0);
  const rotatedBoundary = { scales: swap(boundary.scales), triangles: boundary.triangles.map(face => face.map(swap)) };
  assert.equal(checkDemand(rotatedBoundary, { P: 0.2, M2: 1.5, M3: 0 }).dcr, Infinity);
});

test('radial DCR agrees with an analytical box for axial, biaxial and combined loads in every sign quadrant', () => {
  for (const P of [-1200, -400, 0, 400, 1200]) {
    for (const M2 of [-250, 0, 80]) {
      for (const M3 of [-150, 0, 30]) {
        const result = checkDemand(surface, { P, M2, M3 }, 'origin');
        const expected = Math.max(Math.abs(P) / 1000, Math.abs(M2) / 200, Math.abs(M3) / 100);
        close(result.dcr, expected);
        assert.equal(result.status, expected === 0 ? 'zero' : expected <= 1 ? 'within' : 'exceeds');
        if (expected) {
          close(result.capacity.P, P / expected);
          close(result.capacity.M2, M2 / expected);
          close(result.capacity.M3, M3 / expected);
        }
      }
    }
  }
});

test('vertex and edge hits are deduplicated and demand scaling doubles DCR', () => {
  const demand = { P: -1000, M2: 200, M3: 100 };
  close(checkDemand(surface, demand, 'origin').dcr, 1);
  close(checkDemand(surface, { P: -2000, M2: 400, M3: 200 }, 'origin').dcr, 2);
  close(checkDemand(surface, { P: -1000, M2: 200, M3: 0 }, 'origin').dcr, 1);
  close(checkDemand(surface, { P: -500, M2: 1e-12, M3: 0 }, 'origin').dcr, 0.5);
  assert.equal(checkDemand(surface, { P: -1000.01, M2: 0, M3: 0 }, 'origin').status, 'exceeds');
});

test('axis normalization makes DCR independent of force/moment unit scaling', () => {
  const scales = [1e-4, 1e6, 1e2];
  const scaled = createCapacitySurface(boxVertices.map(point => point.map((value, i) => value * scales[i])), boxFaces);
  close(checkDemand(scaled, { P: -700 * scales[0], M2: 60 * scales[1], M3: -40 * scales[2] }, 'origin').dcr, 0.7);
});

test('zero demand is explicit, invalid inputs are unresolved, and unsupported directions never pass', () => {
  assert.equal(checkDemand(surface, { P: 0, M2: 0, M3: 0 }, 'origin').status, 'zero');
  assert.equal(checkDemand(surface, { P: NaN, M2: 0, M3: 0 }, 'origin').status, 'unresolved');
  assert.equal(checkDemand(null, { P: -1, M2: 0, M3: 0 }, 'origin').status, 'unresolved');
  const compressionOnly = createCapacitySurface(boxVertices.map(([P, x, y]) => [(P - 1000) / 2, x, y]), boxFaces);
  assert.equal(checkDemand(compressionOnly, { P: 100, M2: 0, M3: 0 }, 'origin').status, 'exceeds');
  assert.equal(checkDemand(compressionOnly, { P: 100, M2: 0, M3: 0 }, 'origin').dcr, Infinity);
  close(checkDemand(compressionOnly, { P: -500, M2: 0, M3: 0 }, 'origin').dcr, 0.5);
});

test('open, non-finite and zero-load-excluding surfaces are rejected', () => {
  assert.throws(() => createCapacitySurface(boxVertices, boxFaces.slice(1)), /not closed/);
  assert.throws(() => createCapacitySurface([[NaN, 0, 0], ...boxVertices.slice(1)], boxFaces), /non-finite/);
  assert.throws(() => createCapacitySurface(boxVertices.map(([P, x, y]) => [P + 2000, x, y]), boxFaces), /zero load/);
});

function notchedPrism(notchStart = 0.5) {
  // A concave cross-section extruded along M3. From the origin, the +P ray
  // exits at notchStart, re-enters at P=1, and exits the far wall at P=2.
  const contour = [[-2, -2], [2, -2], [2, 2], [1, 2], [1, -0.5],
    [notchStart, -0.5], [notchStart, 2], [-2, 2]];
  const vertices = [-1, 1].flatMap(z => contour.map(([P, M2]) => [P, M2, z]));
  const cap = [[6, 7, 0], [1, 2, 3], [5, 6, 0], [1, 3, 4], [4, 5, 0], [0, 1, 4]];
  const faces = [...cap, ...cap.map(face => face.map(index => index + contour.length))];
  for (let index = 0; index < contour.length; index++) {
    const next = (index + 1) % contour.length;
    faces.push([index, next, next + contour.length], [index, next + contour.length, index + contour.length]);
  }
  return createCapacitySurface(vertices, faces);
}

test('a concave surface uses the first radial exit instead of its convex hull or a later crossing', () => {
  const concave = notchedPrism();
  close(checkDemand(concave, { P: 0.25, M2: 0, M3: 0 }, 'origin').dcr, 0.5);
  const beyondNotch = checkDemand(concave, { P: 1.5, M2: 0, M3: 0 }, 'origin');
  close(beyondNotch.dcr, 3);
  close(beyondNotch.capacity.P, 0.5);
  assert.equal(beyondNotch.status, 'exceeds');
  close(checkDemand(concave, { P: -1, M2: 0, M3: 0 }, 'origin').dcr, 0.5);
});

test('zero-load boundary rays distinguish a valid face direction from immediate exit and later re-entry', () => {
  const compressionOnly = createCapacitySurface(boxVertices.map(([P, x, y]) => [(P - 1000) / 2, x, y]), boxFaces);
  close(checkDemand(compressionOnly, { P: 0, M2: 100, M3: 0 }, 'origin').dcr, 0.5);
  const boundaryNotch = notchedPrism(0);
  // The remote lobe has positive intersections, but there is no continuous
  // capacity from zero in this direction because the ray leaves immediately.
  const unsupported = checkDemand(boundaryNotch, { P: 1.5, M2: 0, M3: 0 }, 'origin');
  assert.equal(unsupported.status, 'exceeds');
  assert.equal(unsupported.dcr, Infinity);
  assert.equal(unsupported.capacity, null);
  close(checkDemand(boundaryNotch, { P: -1, M2: 0, M3: 0 }, 'origin').dcr, 0.5);
});

function generatedBicone() {
  const results = {};
  for (let angle = 0; angle <= 180; angle += 15) {
    const branch = direction => Array.from({ length: 51 }, (_, index) => {
      const P = -1000 + 40 * index;
      const radius = 1 - Math.abs(P) / 1000;
      const radians = (angle + direction) * Math.PI / 180;
      return [P, radius * 200 * Math.cos(radians) - P * 0.02, radius * 100 * Math.sin(radians)];
    });
    const points = [...branch(0), ...branch(180).reverse().slice(1, -1)];
    results[angle] = Object.fromEntries(['phiP', 'phiMx', 'phiMy'].map((key, i) => [key, [points.map(point => point[i])]]));
  }
  return results;
}

test('PMM topology closes both adaptive branches, honors stored phi values and preserves eccentric poles', () => {
  const pmm = generatedBicone();
  const generated = buildPMMCapacitySurface(pmm);
  for (const angle of [0, 15, 90, 165, 180, 195, 270, 345]) {
    const radians = angle * Math.PI / 180;
    const demand = { P: -500, M2: 100 * Math.cos(radians) + 10, M3: 50 * Math.sin(radians) };
    close(checkDemand(generated, demand, 'origin').dcr, 1);
  }
  close(checkDemand(generated, { P: -500, M2: 10, M3: 0 }, 'origin').dcr, 0.5);
  // Between meridians, the check uses the inscribed linear surface.
  const angle = 7.5 * Math.PI / 180;
  close(checkDemand(generated, { P: 0, M2: 100 * Math.cos(angle), M3: 50 * Math.sin(angle) }, 'origin').dcr, 0.5 / Math.cos(angle));
  delete pmm[45];
  assert.throws(() => buildPMMCapacitySurface(pmm), /45°.*incomplete/);
});

test('a collapsed pure-tension pole gives no capacity for unsupported tension and pure bending', () => {
  const pmm = generatedBicone();
  for (const data of Object.values(pmm)) {
    for (let index = 0; index < 100; index++) {
      data.phiP[0][index] = (data.phiP[0][index] - 1000) / 2;
      // Move the eccentric tension endpoint to the true zero-load origin.
      data.phiMx[0][index] += 20;
    }
  }
  const generated = buildPMMCapacitySurface(pmm);
  assert.equal(checkDemand(generated, { P: 50, M2: 0, M3: 0 }, 'origin').status, 'exceeds');
  assert.equal(checkDemand(generated, { P: 0, M2: 50, M3: 0 }, 'origin').status, 'exceeds');
});
