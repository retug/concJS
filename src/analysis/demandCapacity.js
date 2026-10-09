import { DEFAULT_DCR_METHOD, DCR_METHODS } from '../projectDemandInputs.js';

// Section checks scale the demand moments at constant P by default. The optional
// origin method scales P and both moments together. In each case DCR = 1 / lambda.
// The mesh follows the sampled PMM branches; a convex hull would incorrectly
// fill concave portions of a capacity surface. No strength factors are reapplied.
const EPS = 1e-9;
const subtract = (a, b) => a.map((value, i) => value - b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => Math.hypot(...a);
const normalize = a => a.map(value => value / norm(a));

function intersection(origin, direction, triangle) {
  const [a, b, c] = triangle;
  const edge1 = subtract(b, a), edge2 = subtract(c, a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-12 * norm(edge1) * norm(edge2)) return null;
  const offset = subtract(origin, a);
  const u = dot(offset, p) / determinant;
  const q = cross(offset, edge1);
  const v = dot(direction, q) / determinant;
  if (u < -EPS || v < -EPS || u + v > 1 + EPS) return null;
  const distance = dot(edge2, q) / determinant;
  return distance >= -EPS ? distance : null;
}

function onTriangle(point, [a, b, c]) {
  const e1 = subtract(b, a), e2 = subtract(c, a), offset = subtract(point, a);
  const normal = cross(e1, e2);
  if (Math.abs(dot(normal, offset)) > EPS * norm(normal)) return false;
  const d00 = dot(e1, e1), d01 = dot(e1, e2), d11 = dot(e2, e2);
  const d20 = dot(offset, e1), d21 = dot(offset, e2);
  const determinant = d00 * d11 - d01 * d01;
  if (determinant <= 0) return false;
  const u = (d11 * d20 - d01 * d21) / determinant;
  const v = (d00 * d21 - d01 * d20) / determinant;
  return u >= -EPS && v >= -EPS && u + v <= 1 + EPS;
}

function uniqueHits(triangles, origin, direction) {
  const hits = triangles.map(triangle => intersection(origin, direction, triangle))
    .filter(distance => distance !== null && distance > EPS).sort((a, b) => a - b);
  return hits.filter((distance, index) => !index || Math.abs(distance - hits[index - 1]) > EPS * Math.max(1, distance));
}

function contains(triangles, point) {
  if (triangles.some(triangle => onTriangle(point, triangle))) return true;
  // Independent rays avoid classifying an edge/vertex tangency as a crossing.
  const directions = [[1, 0.371, 0.529], [0.217, 1, 0.613], [0.419, 0.283, 1]];
  return directions.filter(direction => uniqueHits(triangles, point, normalize(direction)).length % 2 === 1).length >= 2;
}

/** Build a numerically scaled, closed triangle mesh. Coordinates are P, M2, M3. */
export function createCapacitySurface(vertices, faces) {
  if (vertices.length < 4 || !vertices.every(vertex => vertex.length === 3 && vertex.every(Number.isFinite))) {
    throw new Error('Capacity vertices are incomplete or non-finite. Regenerate PMM.');
  }
  const scales = [0, 1, 2].map(axis => Math.max(...vertices.map(vertex => Math.abs(vertex[axis]))) || 1);
  const points = vertices.map(vertex => vertex.map((value, axis) => value / scales[axis]));
  const edges = new Map();
  const triangles = [];
  for (const face of faces) {
    if (face.length !== 3 || !face.every(index => Number.isInteger(index) && points[index])) {
      throw new Error('Capacity surface has invalid triangles.');
    }
    const triangle = face.map(index => points[index]);
    if (norm(cross(subtract(triangle[1], triangle[0]), subtract(triangle[2], triangle[0]))) > 1e-14) triangles.push(triangle);
    for (let i = 0; i < 3; i++) {
      const key = [face[i], face[(i + 1) % 3]].sort((a, b) => a - b).join(':');
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  if (triangles.length < 4 || [...edges.values()].some(count => count !== 2)) {
    throw new Error('The capacity surface is not closed. Regenerate PMM before checking demands.');
  }
  if (!contains(triangles, [0, 0, 0])) {
    throw new Error('The generated surface does not contain zero load; a radial DCR is unavailable.');
  }
  return {
    scales,
    triangles,
    axialBounds: [Math.min(...points.map(point => point[0])), Math.max(...points.map(point => point[0]))]
  };
}

/** Shared sampled topology for checking and plotting; coordinates are P, Mx, My. */
export function buildPMMSurfaceMesh(results, mode = 'design') {
  if (!['nominal', 'design'].includes(mode)) throw new Error('Choose nominal or design PMM values.');
  const columns = mode === 'nominal' ? ['P', 'Mx', 'My'] : ['phiP', 'phiMx', 'phiMy'];
  // The app produces 13 closed loops with 100 adaptive strain profiles each.
  const angles = Array.from({ length: 13 }, (_, i) => i * 15);
  const loops = angles.map(angle => {
    const data = results?.[angle];
    const arrays = columns.map(key => data?.[key]?.flat());
    if (arrays.some(array => array?.length !== 100 || !array.every(Number.isFinite))) {
      throw new Error(`PMM results at ${angle}° are incomplete. Regenerate PMM before checking demands.`);
    }
    return arrays[0].map((_, index) => arrays.map(array => array[index]));
  });
  const vertices = [loops[0][0], loops[0][50]];
  const endpointScale = Math.max(1, ...loops.flat(2).map(Math.abs));
  for (const loop of loops) {
    if (norm(subtract(loop[0], vertices[0])) > endpointScale * 1e-7
      || norm(subtract(loop[50], vertices[1])) > endpointScale * 1e-7) {
      throw new Error('PMM branches have inconsistent axial endpoints. Regenerate PMM.');
    }
  }
  // Positive meridians cover 0..165°, negative meridians cover 180..345°.
  // The 180° loop is redundant. Keep the true (possibly eccentric) pole moments.
  const rings = [];
  for (const negative of [false, true]) {
    for (const loop of loops.slice(0, -1)) {
      const ring = [0];
      for (let index = 1; index < 50; index++) {
        ring.push(vertices.length);
        vertices.push(loop[negative ? 100 - index : index]);
      }
      ring.push(1);
      rings.push(ring);
    }
  }
  const faces = [];
  for (let ring = 0; ring < rings.length; ring++) {
    const a = rings[ring], b = rings[(ring + 1) % rings.length];
    faces.push([0, a[1], b[1]]);
    for (let index = 1; index < 49; index++) {
      faces.push([a[index], a[index + 1], b[index]], [a[index + 1], b[index + 1], b[index]]);
    }
    faces.push([a[49], 1, b[49]]);
  }
  return { vertices, faces };
}

export function buildPMMCapacitySurface(results) {
  const { vertices, faces } = buildPMMSurfaceMesh(results);
  return createCapacitySurface(vertices, faces);
}

export function checkDemand(surface, demand, method = DEFAULT_DCR_METHOD) {
  const rayOrigin = { P: method === 'constant-p' ? demand.P : 0, M2: 0, M3: 0 };
  const metadata = { id: demand.id, method, rayOrigin };
  const unavailable = message => ({ ...metadata, status: 'unresolved', dcr: null, capacity: null, message });
  const exceeds = message => ({ ...metadata, status: 'exceeds', dcr: Infinity, capacity: null, message });
  if (!DCR_METHODS.includes(method)) return unavailable('Choose a supported DCR method.');
  const values = [demand.P, demand.M2, demand.M3];
  if (!values.every(Number.isFinite)) return unavailable('Enter finite P, M2 and M3 values.');
  if (!surface?.triangles?.length) return unavailable('Generate a valid PMM surface first.');
  if (values.every(value => value === 0)) {
    return { ...metadata, status: 'zero', dcr: 0, capacity: null, message: 'Zero demand.' };
  }
  const origin = [rayOrigin.P / surface.scales[0], 0, 0];
  if (!origin.every(Number.isFinite)) return unavailable('Demand magnitude is outside the supported numeric range.');
  if (method === 'constant-p') {
    // Bounds are normalized like the triangles, so the tolerance is independent
    // of load units. The fallback also supports previously constructed surfaces.
    const axialBounds = surface.axialBounds ?? surface.triangles.reduce(([min, max], triangle) => [
      Math.min(min, ...triangle.map(point => point[0])),
      Math.max(max, ...triangle.map(point => point[0]))
    ], [Infinity, -Infinity]);
    if (origin[0] < axialBounds[0] - EPS || origin[0] > axialBounds[1] + EPS) {
      return exceeds('Axial demand is outside the generated φ-reduced capacity range.');
    }
    const axialPointWithin = contains(surface.triangles, origin);
    if (demand.M2 === 0 && demand.M3 === 0) {
      return axialPointWithin
        ? { ...metadata, status: 'within', dcr: null, capacity: null,
          message: 'Axial point is within capacity. No moment direction is defined, so constant-P DCR is unavailable.' }
        : exceeds('The axial point is outside the generated φ-reduced capacity surface.');
    }
    if (!axialPointWithin) {
      return unavailable('The zero-moment point at this P is outside the capacity surface. Use the origin method to check this asymmetric slice.');
    }
  }
  const vector = values.map((value, axis) => value / surface.scales[axis] - origin[axis]);
  const magnitude = norm(vector);
  if (!Number.isFinite(magnitude) || magnitude === 0) return unavailable('Demand magnitude is outside the supported numeric range.');
  const direction = vector.map(value => value / magnitude);
  const hits = uniqueHits(surface.triangles, origin, direction);
  const distance = hits[0];
  if (!distance || !contains(surface.triangles, direction.map((value, axis) => origin[axis] + value * distance / 2))) {
    return exceeds(method === 'constant-p'
      ? 'No positive moment capacity at this P along the demand direction.'
      : 'No positive capacity along this load direction.');
  }
  const ratio = magnitude / distance;
  // Round only floating-point noise at the boundary, keeping status and value consistent.
  const dcr = Math.abs(ratio - 1) <= 1e-12 ? 1 : ratio;
  const [P, M2, M3] = direction.map((value, axis) => (origin[axis] + value * distance) * surface.scales[axis]);
  return { ...metadata, status: dcr <= 1 ? 'within' : 'exceeds', dcr,
    capacity: { P: method === 'constant-p' ? demand.P : P, M2, M3 }, loadFactor: distance / magnitude,
    message: 'Linear interpolation of the generated φ-reduced PMM surface.' };
}
