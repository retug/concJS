document.querySelectorAll('[data-comparison-chart]').forEach(chart => {
  chart.querySelectorAll('[data-toggle-series]').forEach(button => {
    button.addEventListener('click', () => {
      const visible = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(visible));
      chart.querySelectorAll(`[data-series="${button.dataset.toggleSeries}"]`).forEach(layer => {
        layer.classList.toggle('verification-series-hidden', !visible);
      });
    });
  });
});
