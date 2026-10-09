import Plotly from 'plotly.js-dist-min';
import { getPlotUpdateCoordinator } from './plotUpdateCoordinator.js';

export function resizeResultPlot(plot) {
  const updates = getPlotUpdateCoordinator(plot);
  return updates.enqueue('resize', () => {
    if (plot.data) return Plotly.Plots.resize(plot);
  }).catch(error => console.warn('Result plot could not resize:', error));
}

export function disposeResultPlots(container) {
  for (const plot of container.querySelectorAll('.js-plotly-plot, #pmPlot, #mmPlot')) {
    const updates = getPlotUpdateCoordinator(plot);
    updates.dispose();
    // An already running draw must finish before purge; otherwise its promise
    // can recreate a WebGL scene after the old result nodes have been removed.
    void updates.whenIdle().then(() => Plotly.purge(plot))
      .catch(error => console.warn('Result plot could not be released:', error));
  }
}
