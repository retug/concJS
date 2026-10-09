const coordinators = new WeakMap();

/** Serialize plot changes, retaining only the latest pending update of each kind. */
export function createPlotUpdateCoordinator(plot, { onError = () => {} } = {}) {
  const view = plot.ownerDocument.defaultView;
  const frame = view.requestAnimationFrame?.bind(view) ?? (callback => setTimeout(callback, 0));
  const cancelFrame = view.cancelAnimationFrame?.bind(view) ?? clearTimeout;
  const pending = new Map();
  const pointers = new Map();
  const idleWaiters = [];
  let running = false;
  let disposed = false;
  let scheduled = null;
  let dragged = false;
  let wheelTimer = null;

  const visible = () => plot.isConnected && plot.clientWidth > 0 && plot.clientHeight > 0;
  const isInteracting = () => pointers.size > 0 || wheelTimer !== null;
  const settleIdle = () => {
    if (!running && !pending.size) idleWaiters.splice(0).forEach(resolve => resolve());
  };
  const discard = predicate => {
    for (const [key, entry] of pending) {
      if (!predicate(entry)) continue;
      pending.delete(key);
      entry.waiters.forEach(({ resolve }) => resolve());
    }
    settleIdle();
  };

  async function drain() {
    scheduled = null;
    if (running || disposed) return;
    running = true;
    try {
      while (!disposed && !isInteracting() && visible() && pending.size) {
        const [key, entry] = pending.entries().next().value;
        pending.delete(key);
        try {
          const result = await entry.operation();
          entry.waiters.forEach(({ resolve }) => resolve(result));
        } catch (error) {
          entry.waiters.forEach(({ reject }) => reject(error));
          try { onError(error); } catch { /* Reporting must not stall later updates. */ }
        }
      }
    } finally {
      running = false;
      settleIdle();
    }
  }
  function schedule() {
    if (disposed || running || scheduled !== null || !pending.size) return;
    // Run after the browser has delivered mouseup to Plotly, which saves the
    // camera at the end of a gesture. Redrawing earlier restores an old camera.
    scheduled = frame(drain);
  }
  const down = event => {
    if (!pointers.size) dragged = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const move = event => {
    const start = pointers.get(event.pointerId);
    if (!start) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) {
      dragged = true;
      discard(entry => entry.selection);
    }
    // Recover when the mouse was released outside the window.
    if (event.pointerType === 'mouse' && event.buttons === 0) release(event);
  };
  const release = event => {
    if (event.type === 'pointercancel' || event.type === 'blur') {
      dragged = true;
      discard(entry => entry.selection);
    }
    if (event.type === 'blur') {
      pointers.clear();
      clearTimeout(wheelTimer);
      wheelTimer = null;
    } else pointers.delete(event.pointerId);
    schedule();
  };
  const wheel = () => {
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => { wheelTimer = null; schedule(); }, 120);
  };
  const listeners = [
    [plot, 'pointerdown', down], [plot, 'wheel', wheel],
    [view, 'pointermove', move], [view, 'pointerup', release],
    [view, 'pointercancel', release], [view, 'blur', release]
  ];
  for (const [target, name, callback] of listeners) target.addEventListener(name, callback, { capture: true, passive: true });
  const Observer = view.ResizeObserver;
  const observer = Observer ? new Observer(schedule) : null;
  observer?.observe(plot);

  return {
    get disposed() { return disposed; },
    isInteracting,
    enqueue(key, operation, { selection = false } = {}) {
      if (disposed || (selection && dragged)) return Promise.resolve();
      const completion = new Promise((resolve, reject) => {
        const previous = pending.get(key);
        pending.set(key, { operation, selection, waiters: [...(previous?.waiters ?? []), { resolve, reject }] });
      });
      schedule();
      return completion;
    },
    whenIdle() {
      return !running && !pending.size ? Promise.resolve() : new Promise(resolve => idleWaiters.push(resolve));
    },
    cancelPending() { discard(() => true); },
    dispose() {
      disposed = true;
      if (scheduled !== null) cancelFrame(scheduled);
      scheduled = null;
      clearTimeout(wheelTimer);
      wheelTimer = null;
      pointers.clear();
      observer?.disconnect();
      for (const [target, name, callback] of listeners) target.removeEventListener(name, callback, true);
      discard(() => true);
    }
  };
}

export function getPlotUpdateCoordinator(plot) {
  let coordinator = coordinators.get(plot);
  if (!coordinator || coordinator.disposed) {
    coordinator = createPlotUpdateCoordinator(plot);
    coordinators.set(plot, coordinator);
  }
  return coordinator;
}
