import Plotly from 'plotly.js-dist-min';
import { createDemandChecksPanel } from './DemandChecksPanel.js';
import { buildPMMCapacitySurface, checkDemand } from './demandCapacity.js';
import { getAnalysisConfiguration, updateAnalysisConfiguration } from '../projectState.js';

import { demandPlotTraces } from './demandPlotTraces.js';
export { demandPlotTraces };

export function initializeDemandChecks(section, host, plot) {
  const configuration = getAnalysisConfiguration();
  let cases = configuration.demandCases;
  let method = configuration.dcrMethod;
  let results = [];
  let selectedId = cases[0]?.id ?? null;
  let surface;
  let disposed = false;
  let plotQueue = Promise.resolve();
  const refreshPlot = () => {
    // Capture the latest arrays when the queued operation starts; editing and
    // selections can happen while Plotly is completing a prior update.
    plotQueue = plotQueue.catch(() => {}).then(async () => {
      if (disposed || !plot.isConnected || !plot.data) return;
      const traces = demandPlotTraces(cases, results, selectedId, method);
      const indices = traces.map(trace => plot.data.findIndex(item => item.meta?.isDemandCheck && item.meta.kind === trace.meta.kind));
      if (indices.some(index => index < 0)) return;
      // One redraw updates the markers, capacity point and ray together.
      await Plotly.restyle(plot, {
        x: traces.map(trace => trace.x), y: traces.map(trace => trace.y), z: traces.map(trace => trace.z),
        showlegend: traces.map(trace => trace.showlegend),
        name: traces.map(trace => trace.name), hovertemplate: traces.map(trace => trace.hovertemplate ?? ''),
        customdata: traces.map(trace => trace.customdata ?? []), text: traces.map(trace => trace.text ?? []),
        marker: traces.map(trace => trace.marker ?? {})
      }, indices);
    });
    return plotQueue;
  };
  const schedulePlotRefresh = () => { void refreshPlot().catch(error => console.warn('Demand plot could not refresh:', error)); };
  const selectedDemand = () => cases.find(item => item.id === selectedId) ?? null;
  const syncMMSlice = () => section.setActiveDemand(selectedDemand());
  const panel = createDemandChecksPanel(host, {
    cases,
    method,
    onMethodChange(nextMethod) {
      updateAnalysisConfiguration({ dcrMethod: nextMethod });
      method = nextMethod;
      results = [];
      schedulePlotRefresh();
    },
    onCasesChange(nextCases) {
      updateAnalysisConfiguration({ demandCases: nextCases });
      cases = nextCases;
      results = [];
      if (!cases.some(item => item.id === selectedId)) selectedId = cases[0]?.id ?? null;
      schedulePlotRefresh();
      syncMMSlice();
    },
    async onCheck(nextCases) {
      results = [];
      await new Promise(resolve => setTimeout(resolve, 0));
      if (disposed) return [];
      try {
        surface ??= buildPMMCapacitySurface(section.PMMXYresults);
      } catch (error) {
        results = nextCases.map(item => ({ id: item.id, method, status: 'unresolved', dcr: null, capacity: null, message: error.message }));
        await refreshPlot();
        return results;
      }
      const checked = [];
      for (let index = 0; index < nextCases.length; index++) {
        if (disposed) return [];
        checked.push(checkDemand(surface, nextCases[index], method));
        if (index % 10 === 9) await new Promise(resolve => setTimeout(resolve, 0));
      }
      results = checked;
      await refreshPlot();
      return results;
    },
    onSelect(id) {
      if (selectedId === id) return;
      selectedId = id;
      syncMMSlice();
      return refreshPlot();
    }
  });
  schedulePlotRefresh();
  return {
    getSelectedDemand() { const demand = selectedDemand(); return demand ? { ...demand } : null; },
    select(id) {
      if (!cases.some(item => item.id === id)) return;
      selectedId = id;
      syncMMSlice();
      void panel.setSelected(id);
      schedulePlotRefresh();
    },
    dispose() {
      disposed = true;
      surface = null;
      results = [];
      panel.dispose();
    }
  };
}
