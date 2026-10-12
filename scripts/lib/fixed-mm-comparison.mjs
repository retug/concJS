import { percentDifference } from './verification-comparison.mjs';

const escape = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');
const format = value => (Math.abs(value) < 0.05 ? 0 : value)
  .toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const approvedResult = Object.freeze({
  pointCount: 119,
  angle: 0,
  P: -3770.75,
  Mx: 713254.43,
  My: -38193.83,
  phiP: -3775.72,
  phiMx: 646274.42,
  phiMy: -33806.88
});

function validPoint(point) {
  return point && ['angle', 'P', 'Mx', 'My', 'phiP', 'phiMx', 'phiMy']
    .every(key => Number.isFinite(point[key]));
}

/** Build the fixed-axial-load M–M comparison used by SpeedCore Example 3-2. */
export function buildFixedMMComparison(project, results, reference) {
  if (results?.schemaVersion !== 1 || results?.kind !== 'fixed-mm-results' ||
      !Array.isArray(results.points) || results.points.length < 3 ||
      !results.points.every(validPoint)) {
    throw new Error('Fixed M–M results must contain a schemaVersion 1 points array.');
  }
  if (reference?.schemaVersion !== 1 || reference?.kind !== 'fixed-mm-reference' ||
      !reference.point || !Number.isFinite(reference.point.Mx) || !Number.isFinite(reference.point.My)) {
    throw new Error('Fixed M–M reference must contain one published point.');
  }
  if (results.points.length !== approvedResult.pointCount) {
    throw new Error(`Fixed M–M result count changed: expected ${approvedResult.pointCount}, got ${results.points.length}.`);
  }
  const computedPoint = results.points.find(point => Math.abs(point.angle) < 1e-8) ?? results.points[0];
  for (const key of ['angle', 'P', 'Mx', 'My', 'phiP', 'phiMx', 'phiMy']) {
    if (Math.abs(computedPoint[key] - approvedResult[key]) > 0.01) {
      throw new Error(`Approved fixed M–M result changed at 0° (${key}).`);
    }
  }
  const published = { Mx: reference.point.Mx, My: reference.point.My };
  const computed = { Mx: computedPoint.Mx, My: computedPoint.My };
  const difference = {
    Mx: percentDifference(computed.Mx, published.Mx),
    My: percentDifference(computed.My, published.My)
  };
  const delta = { Mx: computed.Mx - published.Mx, My: computed.My - published.My };
  const ratio = {
    Mx: computed.Mx / published.Mx,
    My: null
  };
  const comparison = {
    schemaVersion: 1,
    kind: 'fixed-mm',
    statusLabel: `${results.points.length} RETUG M–M angles · 1 AISC point`,
    title: 'Published vs. computed · M–M at P = -3,770 kips',
    angle: 'fixed axial load',
    source: reference.source,
    resultSource: results.source,
    axialLoad: results.axialLoad,
    units: results.units,
    published,
    computed,
    difference,
    delta,
    ratio,
    computedAngle: computedPoint.angle,
    rows: [{
      id: 'plastic-moment-minus-3770',
      name: 'Plastic moment · P = -3,770 kips',
      match: `RETUG angle ${computedPoint.angle.toFixed(2)}°`,
      published: { P: reference.axialLoad, Mx: published.Mx, My: published.My },
      computed: { P: computedPoint.P, Mx: computed.Mx, My: computed.My },
      difference: { P: percentDifference(computedPoint.P, reference.axialLoad), Mx: difference.Mx, My: difference.My },
      delta: { Mx: delta.Mx, My: delta.My },
      ratio: { Mx: ratio.Mx, My: null }
    }],
    points: results.points,
    method: 'The supplied RETUG fixed-P result is plotted in Mx–My space. The 0° nominal point is compared with the published AISC plastic-moment point at the same target axial load; Mx and My are retained as separate components.',
    differenceDefinition: 'Difference (%) = 100 × |RETUG − AISC| / |AISC|. Because the published My is zero, a relative My percentage is undefined; the signed My delta is shown instead.',
    notes: [
      'The AISC design example reports a plastic moment of 8.81 × 10⁶ kip-in, or 734,166.67 kip-ft. The comparison point uses the supplied 731,416.67 kip-ft value shown for the plotted AISC result.',
      'The supplied RETUG result has a small nonzero My at 0° because the plated composite wall is unsymmetric about the weak axis.',
      'The attached model keeps its two demand cases: P = 0 and P = -3,770 kips, with M2 = 734,166.67 kip-ft. Load cases are preserved in the downloadable JSON for opening in the application.',
      'The source request contained 7,314,166.67 in one line; the comparison interprets that as 731,416.67 kip-ft to match the cited kip-in capacity and the supplied plot scale.'
    ]
  };
  comparison.chartSvg = renderFixedMMSvg(comparison);
  return comparison;
}

export function renderFixedMMSvg(comparison) {
  const width = 1120, height = 630;
  const left = 94, right = 1090, top = 48, bottom = 535;
  const allX = comparison.points.flatMap(point => [point.Mx, point.phiMx, comparison.published.Mx]);
  const allY = comparison.points.flatMap(point => [point.My, point.phiMy, comparison.published.My]);
  const minX = Math.min(...allX), maxX = Math.max(...allX), minY = Math.min(...allY), maxY = Math.max(...allY);
  const padX = Math.max((maxX - minX) * 0.08, 50000), padY = Math.max((maxY - minY) * 0.12, 25000);
  const xMin = minX - padX, xMax = maxX + padX, yMin = minY - padY, yMax = maxY + padY;
  const x = value => left + (value - xMin) / (xMax - xMin) * (right - left);
  const y = value => bottom - (value - yMin) / (yMax - yMin) * (bottom - top);
  const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.x).toFixed(2)},${y(point.y).toFixed(2)}`).join(' ');
  const ticks = (min, max, count = 5) => Array.from({ length: count + 1 }, (_, index) => min + (max - min) * index / count);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="fixed-mm-title fixed-mm-desc"><title id="fixed-mm-title">RETUG and AISC fixed-P M–M comparison</title><desc id="fixed-mm-desc">RETUG nominal and factored Mx–My curves at P = -3,770 kips with the AISC published plastic-moment point.</desc><rect width="${width}" height="${height}" fill="white"/>`;
  for (const tick of ticks(xMin, xMax)) {
    const px = x(tick);
    svg += `<path d="M${px.toFixed(2)} ${top}V${bottom}" stroke="${Math.abs(tick) < 1 ? '#aebdc7' : '#e8edf1'}"/><text x="${px.toFixed(2)}" y="${bottom + 28}" text-anchor="middle" fill="#526473" font-size="14">${(tick / 1000).toFixed(0)}k</text>`;
  }
  for (const tick of ticks(yMin, yMax)) {
    const py = y(tick);
    svg += `<path d="M${left} ${py.toFixed(2)}H${right}" stroke="${Math.abs(tick) < 1 ? '#aebdc7' : '#e8edf1'}"/><text x="${left - 14}" y="${(py + 5).toFixed(2)}" text-anchor="end" fill="#526473" font-size="14">${(tick / 1000).toFixed(0)}k</text>`;
  }
  svg += `<text x="${(left + right) / 2}" y="599" text-anchor="middle" fill="#263342" font-size="17">Mx (kip-ft)</text><text transform="translate(23 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" fill="#263342" font-size="17">My (kip-ft)</text>`;
  const nominal = comparison.points.map(point => ({ x: point.Mx, y: point.My }));
  const factored = comparison.points.map(point => ({ x: point.phiMx, y: point.phiMy }));
  svg += `<g data-series="nominal"><path d="${path([...nominal, nominal[0]])}" fill="none" stroke="#8a9dac" stroke-width="2.4" stroke-dasharray="8 5"/></g>`;
  svg += `<g data-series="factored"><path d="${path([...factored, factored[0]])}" fill="none" stroke="#e2673d" stroke-width="2.8"/>`;
  factored.forEach((point, index) => { svg += `<circle cx="${x(point.x).toFixed(2)}" cy="${y(point.y).toFixed(2)}" r="2.5" fill="#e2673d"><title>RETUG factored angle ${comparison.points[index].angle.toFixed(2)}°: Mx ${format(point.x)} kip-ft; My ${format(point.y)} kip-ft</title></circle>`; });
  svg += '</g><g data-series="published">';
  const publishedX = x(comparison.published.Mx), publishedY = y(comparison.published.My);
  svg += `<path d="M${publishedX} ${publishedY - 8}l8 8 -8 8 -8 -8Z" fill="#fff" stroke="#277f88" stroke-width="2.5"><title>AISC published point: Mx ${format(comparison.published.Mx)} kip-ft; My ${format(comparison.published.My)} kip-ft</title></path>`;
  svg += `<circle cx="${x(comparison.computed.Mx).toFixed(2)}" cy="${y(comparison.computed.My).toFixed(2)}" r="6" fill="#e2673d" stroke="white" stroke-width="1.5"><title>RETUG nominal at 0°: Mx ${format(comparison.computed.Mx)} kip-ft; My ${format(comparison.computed.My)} kip-ft</title></circle></g>`;
  return svg + '</svg>';
}
