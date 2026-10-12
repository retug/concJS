import { DEFAULT_DCR_METHOD } from '../projectDemandInputs.js';

const escapeText = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const number = value => Number.isFinite(value) ? value.toFixed(3) : '—';

// Keep three traces so updating demands does not add/remove plot traces.
export function demandPlotTraces(cases = [], results = [], selectedId = null, method = DEFAULT_DCR_METHOD) {
  const checked = new Map(results.map(result => [result.id, result]));
  const demand = cases.find(item => item.id === selectedId);
  const selectedResult = checked.get(selectedId);
  // Never show a capacity point computed with another method.
  const result = selectedResult?.method === method ? selectedResult : null;
  const capacity = result?.capacity;
  const lineEnd = capacity && result.loadFactor > 1 ? capacity : demand;
  const rayOrigin = result?.rayOrigin ?? { P: method === 'constant-p' ? demand?.P ?? 0 : 0, M2: 0, M3: 0 };
  return [
    {
      type: 'scatter3d', mode: 'markers', name: 'Demands',
      x: cases.map(item => item.M2), y: cases.map(item => item.M3), z: cases.map(item => item.P),
      customdata: cases.map(item => item.id),
      text: cases.map(item => {
        const candidate = checked.get(item.id);
        const result = candidate?.method === method ? candidate : null;
        return `${escapeText(item.name)}<br>DCR: ${result?.dcr === Infinity ? 'No capacity' : result ? number(result.dcr) : 'Not checked'}`;
      }),
      marker: {
        color: cases.map(item => checked.get(item.id)?.method === method && checked.get(item.id)?.status === 'exceeds' ? '#b91c1c' : '#ff8c69'),
        size: cases.map(item => item.id === selectedId ? 10 : 7), symbol: 'diamond',
        line: { color: '#263747', width: 1.5 }
      },
      meta: { isDemandCheck: true, kind: 'demand' }, showlegend: cases.length > 0,
      hovertemplate: '%{text}<br>P: %{z:.3f} kips<br>M2 (Mx): %{x:.3f} kip-ft<br>M3 (My): %{y:.3f} kip-ft<extra>Demand</extra>'
    },
    {
      type: 'scatter3d', mode: 'markers', name: method === 'constant-p' ? 'φ capacity at fixed P' : 'φ capacity from 0,0,0',
      x: capacity ? [capacity.M2] : [], y: capacity ? [capacity.M3] : [], z: capacity ? [capacity.P] : [],
      customdata: capacity ? [selectedId] : [], marker: { color: '#ff8c69', size: 8, symbol: 'circle-open', line: { color: '#263747', width: 2 } },
      meta: { isDemandCheck: true, kind: 'capacity' }, showlegend: Boolean(capacity),
      hovertemplate: `${method === 'constant-p' ? 'Fixed P' : 'φP'}: %{z:.3f} kips<br>φM2: %{x:.3f} kip-ft<br>φM3: %{y:.3f} kip-ft<extra>Capacity</extra>`
    },
    {
      type: 'scatter3d', mode: 'lines', name: 'Demand direction',
      x: lineEnd ? [rayOrigin.M2, lineEnd.M2] : [], y: lineEnd ? [rayOrigin.M3, lineEnd.M3] : [], z: lineEnd ? [rayOrigin.P, lineEnd.P] : [],
      line: { color: '#ff8c69', width: 4, dash: 'dash' },
      meta: { isDemandCheck: true, kind: 'ray' }, showlegend: false, hoverinfo: 'skip'
    }
  ];
}
