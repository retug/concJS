import { buildPMMSurfaceMesh } from './demandCapacity.js';
import { momentArray } from './momentCoordinates.js';

const ORANGE = '#ff8c69';
// Each sampled bending axis keeps one color on both sides of the surface.
// 180° repeats the 0° meridian; the selected-axis overlay still supports it.
const AXIS_COLORS = [
  '#2563eb', '#0f766e', '#9333ea', '#059669', '#c026d3', '#0891b2',
  '#b45309', '#4f46e5', '#be185d', '#4d7c0f', '#0284c7', '#7e22ce'
];
const MODES = [
  { basis: 'nominal', name: 'Nominal capacity', columns: ['P', 'Mx', 'My'], color: '#b8c4d1', opacity: 0.16, dash: 'dash' },
  { basis: 'design', name: 'Design capacity (φ)', columns: ['phiP', 'phiMx', 'phiMy'], color: '#94a3b8', opacity: 0.24, dash: 'solid' }
];

function surfaceTrace(results, mode) {
  const { vertices, faces } = buildPMMSurfaceMesh(results, mode.basis);
  // The shared topology emits 49 interior vertices per meridian, after its
  // two axial poles. Each triangle begins on the starting meridian of its
  // strip (or on a pole followed by that meridian). Color existing triangles
  // without rebuilding the capacity surface or changing its coordinates.
  const facecolor = faces.map(face => {
    const vertex = face.find(index => index >= 2);
    const meridian = Math.floor((vertex - 2) / 49);
    return AXIS_COLORS[meridian % AXIS_COLORS.length];
  });
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
    facecolor,
    opacity: mode.opacity,
    flatshading: false,
    lighting: { ambient: 0.9, diffuse: 0.3, specular: 0.05, roughness: 0.9 },
    hoverinfo: 'skip',
    showlegend: true,
    legendgroup: `pmm-${mode.basis}`,
    meta: { isPMMSurface: true, strengthBasis: mode.basis }
  };
}

function axisTrace(results, selectedAngle, mode, selected = true) {
  const arrays = mode.columns.map(column => column.endsWith('Mx') || column === 'Mx'
    ? momentArray(results[selectedAngle], column)
    : column.endsWith('My') || column === 'My'
      ? momentArray(results[selectedAngle], column)
      : results[selectedAngle]?.[column]?.flat());
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
    line: {
      color: selected ? ORANGE : AXIS_COLORS[(selectedAngle / 15) % AXIS_COLORS.length],
      width: selected ? (mode.basis === 'design' ? 5 : 4) : (mode.basis === 'design' ? 2 : 1.5),
      dash: mode.dash
    },
    opacity: selected ? 1 : (mode.basis === 'design' ? 0.85 : 0.5),
    customdata: indices.map(index => [selectedAngle, index]),
    hovertemplate: `${prefix}P: %{z:.1f} kips<br>${prefix}M2 / Mx: %{x:.1f} kip-ft<br>`
      + `${prefix}M3 / My: %{y:.1f} kip-ft<br>Angle: %{customdata[0]}°<br>`
      + `Profile: %{customdata[1]}<extra>${mode.name}</extra>`,
    showlegend: selected,
    legendgroup: `pmm-${mode.basis}`,
    meta: {
      ...(selected ? { isPMMAxis: true } : { isPMMAngleGuide: true }),
      mode: mode.basis === 'design' ? 'phi' : 'nominal', strengthBasis: mode.basis
    }
  };
}

/** Rebuild only the two clickable selected-axis loops when the angle changes. */
export function createPMMAxisTraces(results, selectedAngle) {
  const angle = Number(selectedAngle);
  if (!Number.isFinite(angle) || !results?.[angle]) throw new Error('Choose an available PMM bending angle.');
  return MODES.map(mode => axisTrace(results, angle, mode));
}

/** Colored surface bands and angle guides, with the selected axis emphasized. */
export function createPMMPlotTraces(results, selectedAngle) {
  const axisTraces = createPMMAxisTraces(results, selectedAngle);
  return [
    ...MODES.map(mode => surfaceTrace(results, mode)),
    ...AXIS_COLORS.flatMap((_, index) => MODES.map(mode => axisTrace(results, index * 15, mode, false))),
    ...axisTraces
  ];
}
