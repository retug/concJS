import { buildPMMSurfaceMesh } from './demandCapacity.js';

const ORANGE = '#ff8c69';
const MODES = [
  { basis: 'nominal', name: 'Nominal capacity', columns: ['P', 'Mx', 'My'], color: '#b8c4d1', opacity: 0.16, dash: 'dash' },
  { basis: 'design', name: 'Design capacity (φ)', columns: ['phiP', 'phiMx', 'phiMy'], color: '#94a3b8', opacity: 0.24, dash: 'solid' }
];

function surfaceTrace(results, mode) {
  const { vertices, faces } = buildPMMSurfaceMesh(results, mode.basis);
  return {
    type: 'mesh3d',
    name: mode.name,
    x: vertices.map(point => point[1]),
    y: vertices.map(point => point[2]),
    z: vertices.map(point => point[0]),
    i: faces.map(face => face[0]),
    j: faces.map(face => face[1]),
    k: faces.map(face => face[2]),
    color: mode.color,
    opacity: mode.opacity,
    flatshading: false,
    lighting: { ambient: 0.9, diffuse: 0.3, specular: 0.05, roughness: 0.9 },
    hoverinfo: 'skip',
    showlegend: true,
    legendgroup: `pmm-${mode.basis}`,
    meta: { isPMMSurface: true, strengthBasis: mode.basis }
  };
}

function selectedAxisTrace(results, selectedAngle, mode) {
  const arrays = mode.columns.map(column => results[selectedAngle]?.[column]?.flat());
  if (arrays.some(array => array?.length !== 100 || !array.every(Number.isFinite))) {
    throw new Error(`PMM results at ${selectedAngle}° are incomplete. Regenerate PMM before plotting.`);
  }
  // Close the loop with profile 0, retaining source metadata even at the seam.
  const indices = [...Array.from({ length: 100 }, (_, index) => index), 0];
  const prefix = mode.basis === 'design' ? 'φ' : '';
  return {
    type: 'scatter3d',
    mode: 'lines',
    name: `${selectedAngle}° · ${mode.name}`,
    x: indices.map(index => arrays[1][index]),
    y: indices.map(index => arrays[2][index]),
    z: indices.map(index => arrays[0][index]),
    line: { color: ORANGE, width: mode.basis === 'design' ? 5 : 4, dash: mode.dash },
    customdata: indices.map(index => [selectedAngle, index]),
    hovertemplate: `${prefix}P: %{z:.1f} kips<br>${prefix}M2 / Mx: %{x:.1f} kip-ft<br>`
      + `${prefix}M3 / My: %{y:.1f} kip-ft<br>Angle: %{customdata[0]}°<br>`
      + `Profile: %{customdata[1]}<extra>${mode.name}</extra>`,
    showlegend: true,
    legendgroup: `pmm-${mode.basis}`,
    meta: { isPMMAxis: true, mode: mode.basis === 'design' ? 'phi' : 'nominal', strengthBasis: mode.basis }
  };
}

/** Rebuild only the two clickable selected-axis loops when the angle changes. */
export function createPMMAxisTraces(results, selectedAngle) {
  const angle = Number(selectedAngle);
  if (!Number.isFinite(angle) || !results?.[angle]) throw new Error('Choose an available PMM bending angle.');
  return MODES.map(mode => selectedAxisTrace(results, angle, mode));
}

/** Nominal/design surfaces, followed by their clickable selected-axis loops. */
export function createPMMPlotTraces(results, selectedAngle) {
  const axisTraces = createPMMAxisTraces(results, selectedAngle);
  return [
    ...MODES.map(mode => surfaceTrace(results, mode)),
    ...axisTraces
  ];
}
