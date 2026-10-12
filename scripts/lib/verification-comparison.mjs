import { createHash } from 'node:crypto';
import { analyzeProjectAtAngle } from '../../src/analysis/headlessProject.js';

const resultKeys = ['P', 'Mx', 'My', 'phiP', 'phiMx', 'phiMy'];
export function modelFingerprint(project) {
  const inputs = { materials: project.materials, concreteShapes: project.concreteShapes,
    reinforcement: project.reinforcement, mesh: {
      edgeSpacing: project.analysisConfiguration.edgeSpacing,
      interiorSpacing: project.analysisConfiguration.interiorSpacing
    } };
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

/** A normal build checks the approved answers; it never replaces the baseline. */
export function verifyBaseline(project, baseline) {
  if (modelFingerprint(project) !== baseline.modelSha256) {
    throw new Error('Verification model inputs changed. Review the model and baseline before publishing.');
  }
  if (baseline.schemaVersion !== 1 || baseline.profiles?.length !== 100 || baseline.angle !== 90) {
    throw new Error('Expected the approved 90-degree, 100-profile baseline.');
  }
  const { result } = analyzeProjectAtAngle(project, baseline.angle);
  for (const [index, expected] of baseline.profiles.entries()) {
    if (expected.index !== index) throw new Error(`Invalid baseline profile order at ${index}.`);
    for (const key of resultKeys) {
      const actual = result[key][0][index];
      if (!Number.isFinite(expected[key]) || !Number.isFinite(actual) || Math.abs(actual - expected[key]) > 0.0051) {
        throw new Error(`Verification result changed at profile ${index}, ${key}: expected ${expected[key]}, computed ${actual}. Baseline was not updated.`);
      }
    }
    if (!Number.isFinite(expected.maxRebarStrain) || !Number.isFinite(result.MaxRebarStrain[0][index]) || Math.abs(result.MaxRebarStrain[0][index] - expected.maxRebarStrain) > 1e-10) {
      throw new Error(`Verification strain profile ${index} changed. Baseline was not updated.`);
    }
  }
  return true;
}

export function percentDifference(computed, published) {
  return published === 0 ? null : 100 * Math.abs(computed - published) / Math.abs(published);
}

function interpolate(left, right, fraction) {
  return Object.fromEntries([...resultKeys, 'maxRebarStrain'].map(key => [key,
    left[key] + fraction * (right[key] - left[key])
  ]));
}

function matchValue(branch, key, target, chooseLast = false) {
  const matches = [];
  for (let index = 0; index < branch.length - 1; index += 1) {
    const left = branch[index], right = branch[index + 1];
    if (Math.abs(left[key] - target) < 1e-10) {
      matches.push({ response: left, match: `Profile ${left.index}` });
      continue;
    }
    if (Math.abs(right[key] - target) < 1e-10) {
      matches.push({ response: right, match: `Profile ${right.index}` });
      continue;
    }
    if (left[key] === right[key]) continue;
    const fraction = (target - left[key]) / (right[key] - left[key]);
    if (fraction < 0 || fraction > 1) continue;
    matches.push({ response: interpolate(left, right, fraction),
      match: fraction === 1 ? `Profile ${right.index}` : `Interpolated: profiles ${left.index}–${right.index}` });
  }
  if (!matches.length) throw new Error(`No bracket for ${key} = ${target}.`);
  return chooseLast ? matches.at(-1) : matches[0];
}

export function compareControl(point, baseline, yieldStrain) {
  const profiles = baseline.profiles;
  const branch = point.direction === 1 ? profiles.slice(0, 51)
    : [profiles[0], ...profiles.slice(51).reverse(), profiles[50]];
  let selected;
  switch (point.kind) {
    case 'compression': selected = { response: profiles[0], match: 'Profile 0 · includes 0.80 axial cap' }; break;
    case 'tension': selected = { response: profiles[50], match: 'Profile 50 · uniform tension' }; break;
    case 'allowable':
      selected = matchValue(branch, 'phiP', -point.P, true);
      selected.match += ' · at published φP';
      break;
    case 'pure-bending': selected = matchValue(branch, 'phiP', 0); break;
    case 'zero-steel': selected = matchValue(branch.slice(0, -1), 'maxRebarStrain', 0); break;
    case 'half-yield': selected = matchValue(branch.slice(0, -1), 'maxRebarStrain', yieldStrain / 2); break;
    case 'balanced': selected = matchValue(branch.slice(0, -1), 'maxRebarStrain', yieldStrain); break;
    case 'tension-control': selected = matchValue(branch.slice(0, -1), 'maxRebarStrain', yieldStrain + 0.003); break;
    default: throw new Error(`Unsupported published control: ${point.kind}`);
  }
  const computed = { P: -selected.response.phiP, M2: selected.response.phiMx, M3: selected.response.phiMy };
  return { id: point.id, name: point.name, kind: point.kind, direction: point.direction,
    published: { P: point.P, M2: point.M2, M3: point.M3 }, computed, match: selected.match,
    difference: Object.fromEntries(['P', 'M2', 'M3'].map(key => [key, percentDifference(computed[key], point[key])])) };
}

export function buildComparison(project, baseline, reference) {
  verifyBaseline(project, baseline);
  const materialId = project.reinforcement[0].materialId;
  if (!project.reinforcement.every(bar => bar.materialId === materialId)) {
    throw new Error('Named steel-control comparison requires a single reinforcement material.');
  }
  const material = project.materials.find(item => item.id === materialId);
  const fy = Math.max(...material.stressStrain.map(point => point.stress));
  const yieldStrain = Math.min(...material.stressStrain.filter(point => point.stress === fy && point.strain > 0).map(point => point.strain));
  if (!Number.isFinite(yieldStrain)) throw new Error('Could not identify the saved steel yield strain.');
  const rows = reference.points.map(point => compareControl(point, baseline, yieldStrain));
  const comparison = { schemaVersion: 1, title: 'Published vs. computed', statusLabel: '100 RETUG profiles · 16 published controls', angle: baseline.angle,
    source: reference.source, resultSource: baseline.source, modelSha256: baseline.modelSha256,
    conventions: reference.conventions, yieldStrain,
    method: 'Named steel-control states; linear interpolation between supplied profiles where needed. Pure bending uses φP = 0; allowable compression uses the published φP and the end of the capped branch. Uniform compression retains the application’s 0.80 axial cap.',
    differenceDefinition: '100 × |RETUG − spColumn| / |spColumn|. A dash means the published component is zero, so a relative percentage is undefined.',
    rows, profiles: baseline.profiles,
    notes: [
      'P is shown positive in compression to match spColumn. The saved demand cases negate P; M2 = Mx and M3 = My. The 90° curve bends about the model’s Y axis (M3).',
      'Orange points are the supplied RETUG factored profiles; the dashed gray line is RETUG nominal strength. The teal line only joins the published control points as a visual guide; it is not a reconstructed spColumn design envelope.',
      'The maximum-compression row compares the displayed RETUG value, including its 0.80 axial cap, with spColumn’s uncapped φP maximum. The resulting 20% difference is a capacity-definition difference. spColumn’s allowable-compression row is the corresponding 0.80 limit.',
      `Named steel states use the saved curve’s yield strain (${yieldStrain.toFixed(5)}) and the current engine’s tension-control strain (${(yieldStrain + 0.003).toFixed(5)}). The spColumn report uses approximately 0.00276 and 0.00576. These inputs are not identical; the verification does not change them to force agreement.`,
      'The report notes that the increase in axial capacity between balanced and tension control is omitted from its design diagram. The table compares named states, rather than choosing an arbitrary intersection at the same factored axial load.',
      'Small M2 residuals come from the supplied mesh results. Published moments smaller than 0.1 kip-ft are normalized to zero. Values are based on the 3 in. saved mesh and a 100-profile curve; interpolation and displayed rounding are included.'
    ] };
  comparison.chartSvg = renderInteractionSvg(comparison);
  return comparison;
}

const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const number = value => (Math.abs(value) < 0.05 ? 0 : value).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function renderInteractionSvg(comparison) {
  const width = 1120, height = 630;
  const left = 94, right = 1090, top = 35, bottom = 535;
  const x = value => left + (value + 680000) / 1360000 * (right - left);
  const y = value => bottom - (value + 15000) / 125000 * (bottom - top);
  const path = points => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.M3).toFixed(2)},${y(point.P).toFixed(2)}`).join(' ');
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="comparison-chart-title comparison-chart-desc"><title id="comparison-chart-title">RETUG and spColumn axial force–moment interaction</title><desc id="comparison-chart-desc">Nominal and factored RETUG profiles with spColumn factored control points. Compression is positive; horizontal axis is M3 in kip-ft. The comparison table below provides the control-point values.</desc><rect width="1120" height="630" fill="white"/>`;
  for (const tick of [-600000,-400000,-200000,0,200000,400000,600000]) {
    svg += `<path d="M${x(tick)} ${top}V${bottom}" stroke="${tick === 0 ? '#aebdc7' : '#e8edf1'}"/><text x="${x(tick)}" y="${bottom + 28}" text-anchor="middle" fill="#526473" font-size="14">${tick / 1000}k</text>`;
  }
  for (const tick of [-10000,0,20000,40000,60000,80000,100000]) {
    svg += `<path d="M${left} ${y(tick)}H${right}" stroke="${tick === 0 ? '#aebdc7' : '#e8edf1'}"/><text x="${left - 14}" y="${y(tick) + 5}" text-anchor="end" fill="#526473" font-size="14">${tick / 1000}k</text>`;
  }
  svg += `<text x="${(left + right) / 2}" y="599" text-anchor="middle" fill="#263342" font-size="17">Moment M3 = My (kip-ft)</text><text transform="translate(23 ${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" fill="#263342" font-size="17">Axial load, P (kip) · compression positive</text>`;
  const nominal = comparison.profiles.map(row => ({ P: -row.P, M3: row.My }));
  const factored = comparison.profiles.map(row => ({ P: -row.phiP, M3: row.phiMy }));
  svg += `<g data-series="nominal"><path d="${path([...nominal, nominal[0]])}" fill="none" stroke="#8a9dac" stroke-width="2" stroke-dasharray="7 5"/></g>`;
  svg += `<g data-series="published">`;
  for (const direction of [1, -1]) {
    svg += `<path d="${path(comparison.rows.filter(row => row.direction === direction).map(row => row.published))}" fill="none" stroke="#277f88" stroke-width="2.6"/>`;
  }
  for (const row of comparison.rows) {
    const px = x(row.published.M3), py = y(row.published.P);
    svg += `<path d="M${px} ${py-5}l5 5 -5 5 -5 -5Z" fill="white" stroke="#277f88" stroke-width="2"><title>${escape(row.name)} · spColumn: P ${number(row.published.P)} kip; M3 ${number(row.published.M3)} kip-ft</title></path>`;
  }
  svg += '</g><g data-series="factored">';
  svg += `<path d="${path([...factored, factored[0]])}" fill="none" stroke="#ce6838" stroke-width="1.3" stroke-opacity="0.55"/>`;
  comparison.profiles.forEach((row, i) => {
    svg += `<circle cx="${x(factored[i].M3)}" cy="${y(factored[i].P)}" r="3.4" fill="#d66a36" stroke="white" stroke-width="0.7"><title>RETUG profile ${row.index}: φP ${number(-row.phiP)} kip; φM2 ${number(row.phiMx)} kip-ft; φM3 ${number(row.phiMy)} kip-ft</title></circle>`;
  });
  return svg + '</g></svg>';
}
