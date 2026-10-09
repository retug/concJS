const ORANGE = '#ff8c69';
const ERROR = '#b91c1c';
const EPS = 1e-9;
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const distance = (a, b) => Math.hypot(...subtract(a, b));
const escapeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function onSegment(point, a, b) {
  const edge = subtract(b, a);
  const offset = subtract(point, a);
  const length = Math.hypot(...edge);
  return Math.abs(cross(edge, offset)) <= EPS * length
    && dot(offset, edge) >= -EPS * length
    && dot(subtract(point, b), edge) <= EPS * length;
}

function contains(point, vertices) {
  let inside = false;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b)) return true;
  const ab = subtract(b, a), cd = subtract(d, c);
  return cross(ab, subtract(c, a)) * cross(ab, subtract(d, a)) < 0
    && cross(cd, subtract(a, c)) * cross(cd, subtract(b, c)) < 0;
}

function closedCurve(result) {
  if (!Array.isArray(result.points) || result.points.length < 4
    || result.points.some(point => !Number.isFinite(point?.phi?.Mx) || !Number.isFinite(point?.phi?.My))) return null;
  const raw = result.points.map(point => [point.phi.Mx, point.phi.My]);
  const scale = Math.max(...raw.flat().map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0) return null;
  const normalized = raw.map(point => point.map(value => value / scale));
  if (distance(normalized[0], normalized.at(-1)) > EPS) return null;
  const vertices = normalized.slice(0, -1).filter((point, index) => !index || distance(point, normalized[index - 1]) > EPS);
  while (vertices.length > 1 && distance(vertices[0], vertices.at(-1)) <= EPS) vertices.pop();
  if (vertices.length < 3) return null;
  const area = vertices.reduce((sum, point, i) => sum + cross(point, vertices[(i + 1) % vertices.length]), 0);
  if (Math.abs(area) <= EPS * EPS) return null;
  // A folded/self-crossing polyline has no unambiguous radial envelope.
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 2; j < vertices.length; j++) {
      if (i === 0 && j === vertices.length - 1) continue;
      if (segmentsIntersect(vertices[i], vertices[(i + 1) % vertices.length], vertices[j], vertices[(j + 1) % vertices.length])) return null;
    }
  }
  return { vertices, scale };
}

function firstRayExit(vertices, direction) {
  const hits = [];
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length];
    const edge = subtract(b, a);
    const determinant = cross(direction, edge);
    if (Math.abs(determinant) <= EPS * Math.hypot(...edge)) {
      // A ray along a boundary can travel to the far endpoint before exiting.
      if (Math.abs(cross(a, direction)) <= EPS) {
        for (const point of [a, b]) {
          const t = dot(point, direction);
          if (t >= -EPS) hits.push(Math.max(0, t));
        }
      }
      continue;
    }
    const t = cross(a, edge) / determinant;
    const u = cross(a, direction) / determinant;
    if (t >= -EPS && u >= -EPS && u <= 1 + EPS) hits.push(Math.max(0, t));
  }
  hits.sort((a, b) => a - b);
  const unique = hits.filter((t, i) => !i || t - hits[i - 1] > EPS);
  for (let i = 0; i < unique.length; i++) {
    const t = unique[i];
    const probe = i + 1 < unique.length ? (t + unique[i + 1]) / 2 : t + 1;
    // Vertex tangencies and collinear runs do not end capacity while the next
    // ray interval remains inside or on the displayed curve.
    if (!contains(direction.map(value => value * probe), vertices)) return t;
  }
  return null;
}

/** Intersect the displayed, solved phi MM polyline; this never calculates DCR. */
export function createMMDemandOverlay(result, demand) {
  const empty = { traces: [], message: '', capacity: null };
  if (!result || !demand || ![result.axialLoad, demand.P, demand.M2, demand.M3].every(Number.isFinite)) return empty;
  const axialScale = Math.max(1, Math.abs(result.axialLoad), Math.abs(demand.P));
  if (Math.abs(result.axialLoad - demand.P) > EPS * axialScale) return empty;

  const demandTrace = {
    type: 'scatter', mode: 'markers', name: 'Selected demand',
    x: [demand.M2], y: [demand.M3], customdata: [demand.id],
    text: [escapeText(demand.name)],
    marker: { color: ORANGE, size: 10, symbol: 'diamond', line: { color: '#263747', width: 1.5 } },
    meta: { isMMDemandOverlay: true, kind: 'demand' },
    hovertemplate: '%{text}<br>M2 (Mx): %{x:.3f} kip-ft<br>M3 (My): %{y:.3f} kip-ft<extra>Demand</extra>'
  };
  const rayTrace = {
    type: 'scatter', mode: 'lines', name: 'Horizontal demand direction',
    x: [], y: [], line: { color: ORANGE, width: 2, dash: 'dash' },
    meta: { isMMDemandOverlay: true, kind: 'ray' }, showlegend: false, hoverinfo: 'skip'
  };
  const capacityTrace = {
    type: 'scatter', mode: 'markers', name: 'MM curve intersection',
    x: [], y: [],
    marker: { color: ORANGE, size: 11, symbol: 'circle-open', line: { color: ORANGE, width: 2 } },
    meta: { isMMDemandOverlay: true, kind: 'capacity' }, showlegend: false,
    hovertemplate: 'M2 (Mx): %{x:.3f} kip-ft<br>M3 (My): %{y:.3f} kip-ft<extra>MM curve intersection</extra>'
  };
  const overlay = { traces: [demandTrace, rayTrace, capacityTrace], message: '', capacity: null };
  const unavailable = message => ({ ...overlay, message });
  if (demand.M2 === 0 && demand.M3 === 0) return unavailable('No moment direction is defined for this demand.');
  rayTrace.x = [0, demand.M2];
  rayTrace.y = [0, demand.M3];
  const curve = closedCurve(result);
  if (!curve) return unavailable('A complete, closed φ MM curve is required for a horizontal intersection.');
  if (!contains([0, 0], curve.vertices)) return unavailable('The zero-moment point is outside this MM curve; a horizontal capacity is unavailable.');

  const demandScale = Math.max(Math.abs(demand.M2), Math.abs(demand.M3));
  const scaledDemand = [demand.M2 / demandScale, demand.M3 / demandScale];
  const length = Math.hypot(...scaledDemand);
  const direction = scaledDemand.map(value => value / length);
  const demandDistance = demandScale / curve.scale * length;
  const exit = firstRayExit(curve.vertices, direction);
  if (exit === null || !Number.isFinite(demandDistance)) return unavailable('A horizontal intersection could not be resolved for this demand.');
  const capacity = { P: demand.P, M2: direction[0] * exit * curve.scale, M3: direction[1] * exit * curve.scale };
  if (![capacity.M2, capacity.M3].every(Number.isFinite)) return unavailable('A horizontal intersection could not be resolved for this demand.');
  overlay.capacity = capacity;
  capacityTrace.x = [capacity.M2];
  capacityTrace.y = [capacity.M3];
  capacityTrace.showlegend = true;
  const beyond = demandDistance > exit + EPS * Math.max(1, exit);
  if (beyond) demandTrace.marker.color = ERROR;
  const end = beyond ? demand : capacity;
  rayTrace.x = [0, end.M2];
  rayTrace.y = [0, end.M3];
  overlay.message = beyond ? 'Demand lies beyond the solved φ MM curve.' : 'Horizontal intersection is on the solved φ MM curve.';
  return overlay;
}
