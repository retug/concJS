/** Colors used to distinguish concurrent axial-load bands in the 2D M–M chart. */
export const MM_LOAD_COLORS = [
  '#2563eb',
  '#d97706',
  '#059669',
  '#7c3aed',
  '#dc2626',
  '#0891b2',
  '#db2777',
  '#65a30d'
];

export function getMMLoadColor(index = 0) {
  return MM_LOAD_COLORS[((Number(index) % MM_LOAD_COLORS.length) + MM_LOAD_COLORS.length) % MM_LOAD_COLORS.length];
}

function isValidSolution(solution) {
  return solution && Number.isFinite(solution.Mx) && Number.isFinite(solution.My);
}

/** Build the nominal and design traces for one M–M axial-load band. */
export function createMM2DTraces(result, { loadIndex = 0 } = {}) {
  if (!result?.points?.length || !Number.isFinite(result.axialLoad)) return [];
  const color = getMMLoadColor(loadIndex);
  const loadLabel = `P = ${result.axialLoad.toFixed(2)} kips`;
  const pointMetadata = result.points.map((point, pointIndex) => [
    point.angle,
    pointIndex,
    result.axialLoad
  ]);

  return ['nominal', 'phi'].flatMap(mode => {
    if (!result.points.some(point => isValidSolution(point[mode]))) return [];
    const design = mode === 'phi';
    return [{
      x: result.points.map(point => isValidSolution(point[mode]) ? point[mode].Mx : null),
      y: result.points.map(point => isValidSolution(point[mode]) ? point[mode].My : null),
      customdata: pointMetadata,
      mode: 'lines+markers',
      type: 'scatter',
      name: `${loadLabel} · ${design ? 'Design φ' : 'Nominal'}`,
      legendgroup: `mm-load-${loadIndex}`,
      connectgaps: false,
      line: { color, width: 3, dash: design ? 'dash' : 'solid' },
      marker: { color, size: 4 },
      meta: {
        isMomentMomentCurve: true,
        mode,
        loadIndex,
        axialLoad: result.axialLoad
      },
      hovertemplate: `${design ? 'φ' : ''}Mx: %{x:.2f} kip-ft<br>`
        + `${design ? 'φ' : ''}My: %{y:.2f} kip-ft<br>`
        + `P: %{customdata[2]:.2f} kips<br>NA angle: %{customdata[0]:.2f}°<extra>${design ? 'Design φ' : 'Nominal'} · ${loadLabel}</extra>`
    }];
  });
}

/** Solved M–M contours at one axial load, also shown on the 3D PMM surface. */
export function createMM3DTraces(result, selected = null) {
  if (!result) return [];
  const valid = isValidSolution;
  const traces = ['nominal', 'phi'].flatMap(mode => {
    if (!result.points.some(point => valid(point[mode]))) return [];
    const name = mode === 'phi' ? 'Design MM slice (φ)' : 'Nominal MM slice';
    const color = mode === 'phi' ? '#d66a36' : '#0f4c81';
    return [{
      x: result.points.map(point => valid(point[mode]) ? point[mode].Mx : null),
      y: result.points.map(point => valid(point[mode]) ? point[mode].My : null),
      z: result.points.map(point => valid(point[mode]) ? result.axialLoad : null),
      customdata: result.points.map((point, pointIndex) => [point.angle, pointIndex]),
      mode: 'lines+markers', type: 'scatter3d', connectgaps: false,
      name, legendgroup: `mm-${mode}`,
      line: { color, width: 9, dash: mode === 'phi' ? 'dash' : 'solid' },
      marker: { color, size: 3, opacity: 1 },
      meta: { isMomentMomentSlice: true, mode },
      hovertemplate: `${mode === 'phi' ? 'φ' : ''}M2 / Mx: %{x:.2f} kip-ft<br>`
        + `${mode === 'phi' ? 'φ' : ''}M3 / My: %{y:.2f} kip-ft<br>`
        + `P: %{z:.2f} kips<br>NA angle: %{customdata[0]:.2f}°<extra>${name}</extra>`
    }];
  });
  const point = selected ? result.points[selected.pointIndex] : null;
  const solution = point?.[selected?.mode];
  if (valid(solution)) traces.push({
    x: [solution.Mx], y: [solution.My], z: [result.axialLoad],
    customdata: [[point.angle, selected.pointIndex]],
    mode: 'markers', type: 'scatter3d', name: 'Selected MM point',
    marker: { color: '#ff8c69', size: 10, symbol: 'diamond', line: { color: '#263747', width: 2 } },
    showlegend: false,
    meta: { isMomentMomentSlice: true, isMomentMomentHighlight: true, mode: selected.mode },
    hovertemplate: 'M2 / Mx: %{x:.2f} kip-ft<br>M3 / My: %{y:.2f} kip-ft<br>P: %{z:.2f} kips<extra>Selected MM</extra>'
  });
  return traces;
}
