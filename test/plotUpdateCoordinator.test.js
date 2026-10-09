import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlotUpdateCoordinator } from '../src/analysis/plotUpdateCoordinator.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

async function waitFor(predicate, message = 'Expected queued operation to start.') {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await nextTurn();
  }
}

function pointer(target, type, pointerId = 1, coordinates = {}) {
  const event = new Event(type);
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    pointerType: { value: 'mouse' },
    button: { value: 0 },
    buttons: { value: ['pointerup', 'pointercancel'].includes(type) ? 0 : 1 },
    clientX: { value: coordinates.x ?? 0 },
    clientY: { value: coordinates.y ?? 0 }
  });
  target.dispatchEvent(event);
}

function fixture(t, options = {}) {
  const observers = [];
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    notify(target) { if (this.targets.has(target)) this.callback([{ target }], this); }
  }
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver;
  const windowTarget = new EventTarget();
  windowTarget.ResizeObserver = FakeResizeObserver;
  windowTarget.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
  windowTarget.cancelAnimationFrame = clearTimeout;
  const documentTarget = new EventTarget();
  documentTarget.defaultView = windowTarget;
  const plot = new EventTarget();
  Object.assign(plot, { ownerDocument: documentTarget, isConnected: true, clientWidth: 800, clientHeight: 400 });
  const coordinator = createPlotUpdateCoordinator(plot, options);
  t.after(() => {
    coordinator.dispose();
    if (previousObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = previousObserver;
  });
  return {
    plot, windowTarget, documentTarget, coordinator,
    resize() { for (const observer of observers) observer.notify(plot); }
  };
}

test('plot updates are serialized across awaited callbacks and whenIdle waits for completion', async t => {
  const { coordinator } = fixture(t);
  const gate = deferred();
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const first = coordinator.enqueue('surface', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push('surface start');
    await gate.promise;
    calls.push('surface end');
    active -= 1;
    return 'surface result';
  });
  await waitFor(() => calls.length > 0);
  const second = coordinator.enqueue('selection', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push('selection start');
    await nextTurn();
    calls.push('selection end');
    active -= 1;
    return 'selection result';
  });
  let idle = false;
  const finished = coordinator.whenIdle().then(() => { idle = true; });
  await nextTurn();
  assert.deepEqual(calls, ['surface start']);
  assert.equal(idle, false);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), ['surface result', 'selection result']);
  await finished;
  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, ['surface start', 'surface end', 'selection start', 'selection end']);
});

test('same-key pending updates coalesce and every caller receives the latest result', async t => {
  const { coordinator } = fixture(t);
  const gate = deferred();
  let started = false;
  const blocker = coordinator.enqueue('in-flight', async () => { started = true; await gate.promise; });
  await waitFor(() => started);
  const calls = [];
  const old = coordinator.enqueue('demand-markers', () => { calls.push('old'); return 'old'; });
  const middle = coordinator.enqueue('demand-markers', () => { calls.push('middle'); return 'middle'; });
  const latest = coordinator.enqueue('demand-markers', () => { calls.push('latest'); return 'latest'; });
  const other = coordinator.enqueue('mm-slice', () => { calls.push('slice'); return 'slice'; });
  gate.resolve();
  await blocker;
  assert.deepEqual(await Promise.all([old, middle, latest]), ['latest', 'latest', 'latest']);
  assert.equal(await other, 'slice');
  await coordinator.whenIdle();
  assert.deepEqual(calls, ['latest', 'slice']);
});

for (const releaseEvent of ['pointerup', 'pointercancel', 'blur']) {
  test(`plot updates pause for a pointer gesture and resume after window ${releaseEvent}`, async t => {
    const { coordinator, plot, windowTarget } = fixture(t);
    pointer(plot, 'pointerdown');
    assert.equal(coordinator.isInteracting(), true);
    let called = false;
    const pending = coordinator.enqueue('selection', () => { called = true; return 42; });
    await nextTurn();
    await nextTurn();
    assert.equal(called, false, 'No Plotly mutation may start during the active drag.');
    if (releaseEvent === 'blur') windowTarget.dispatchEvent(new Event('blur'));
    else pointer(windowTarget, releaseEvent);
    assert.equal(coordinator.isInteracting(), false);
    assert.equal(await pending, 42);
    await coordinator.whenIdle();
    assert.equal(called, true);
  });
}

test('starting a gesture during an async update holds the next update until release', async t => {
  const { coordinator, plot, windowTarget } = fixture(t);
  const gate = deferred();
  const calls = [];
  const first = coordinator.enqueue('first', async () => { calls.push('first'); await gate.promise; });
  await waitFor(() => calls.length > 0);
  pointer(plot, 'pointerdown');
  const second = coordinator.enqueue('next', () => { calls.push('next'); });
  gate.resolve();
  await first;
  await nextTurn();
  assert.deepEqual(calls, ['first']);
  pointer(windowTarget, 'pointerup');
  await second;
  assert.deepEqual(calls, ['first', 'next']);
});

test('click selection waits for pointer release before executing', async t => {
  const { coordinator, plot, windowTarget } = fixture(t);
  pointer(plot, 'pointerdown', 1, { x: 100, y: 100 });
  let called = false;
  const selection = coordinator.enqueue('selection', () => { called = true; return 'selected'; }, { selection: true });
  await nextTurn();
  assert.equal(called, false);
  pointer(windowTarget, 'pointermove', 1, { x: 102, y: 101 });
  pointer(windowTarget, 'pointerup', 1, { x: 102, y: 101 });
  assert.equal(await selection, 'selected');
  assert.equal(called, true);
});

for (const gestureEnd of ['drag', 'pointercancel', 'blur']) {
  test(`a ${gestureEnd} discards queued click selection but preserves ordinary updates`, async t => {
    const { coordinator, plot, windowTarget } = fixture(t);
    pointer(plot, 'pointerdown', 1, { x: 100, y: 100 });
    const calls = [];
    const selection = coordinator.enqueue('selection', () => { calls.push('accidental selection'); }, { selection: true });
    const ordinary = coordinator.enqueue('demand-markers', () => { calls.push('demand markers'); return 'refreshed'; });
    await nextTurn();
    assert.deepEqual(calls, []);
    if (gestureEnd === 'drag') {
      pointer(windowTarget, 'pointermove', 1, { x: 108, y: 100 });
      pointer(windowTarget, 'pointerup', 1, { x: 108, y: 100 });
    } else if (gestureEnd === 'blur') {
      windowTarget.dispatchEvent(new Event('blur'));
    } else {
      pointer(windowTarget, 'pointercancel', 1, { x: 100, y: 100 });
    }
    assert.equal(await selection, undefined);
    assert.equal(await ordinary, 'refreshed');
    await coordinator.whenIdle();
    assert.deepEqual(calls, ['demand markers']);
  });
}

test('a rejected update reports its error without wedging later work', async t => {
  const errors = [];
  const { coordinator } = fixture(t, { onError: error => errors.push(error) });
  const failure = new Error('Plotly context was replaced');
  const failed = coordinator.enqueue('broken', async () => { throw failure; });
  const expectedRejection = assert.rejects(failed, error => error === failure);
  const next = coordinator.enqueue('healthy', () => 'recovered');
  await expectedRejection;
  assert.equal(await next, 'recovered');
  await coordinator.whenIdle();
  assert.deepEqual(errors, [failure]);
});

for (const hiddenProperty of ['isConnected', 'clientWidth', 'clientHeight']) {
  test(`hidden/detached plots (${hiddenProperty}) wait until a resize shows them again`, async t => {
    const { coordinator, plot, resize } = fixture(t);
    const original = plot[hiddenProperty];
    plot[hiddenProperty] = hiddenProperty === 'isConnected' ? false : 0;
    let called = false;
    const pending = coordinator.enqueue('surface', () => { called = true; return 'visible'; });
    await nextTurn();
    await nextTurn();
    assert.equal(called, false);
    plot[hiddenProperty] = original;
    resize();
    assert.equal(await pending, 'visible');
    assert.equal(called, true);
    await coordinator.whenIdle();
  });
}

test('manual enqueue resumes previously hidden work and still coalesces stale updates', async t => {
  const { coordinator, plot } = fixture(t);
  plot.clientWidth = 0;
  const calls = [];
  const stale = coordinator.enqueue('surface', () => { calls.push('stale'); return 'stale'; });
  await nextTurn();
  assert.deepEqual(calls, []);
  plot.clientWidth = 800;
  const latest = coordinator.enqueue('surface', () => { calls.push('latest'); return 'latest'; });
  assert.deepEqual(await Promise.all([stale, latest]), ['latest', 'latest']);
  await coordinator.whenIdle();
  assert.deepEqual(calls, ['latest']);
});

test('cancelPending settles queued callers without executing stale callbacks or cancelling running work', async t => {
  const { coordinator } = fixture(t);
  const gate = deferred();
  const calls = [];
  const active = coordinator.enqueue('active', async () => { calls.push('active'); await gate.promise; return 'finished'; });
  await waitFor(() => calls.length > 0);
  const canceled = coordinator.enqueue('surface', () => { calls.push('canceled'); });
  const coalesced = coordinator.enqueue('surface', () => { calls.push('also canceled'); });
  coordinator.cancelPending();
  assert.deepEqual(await Promise.all([canceled, coalesced]), [undefined, undefined]);
  const replacement = coordinator.enqueue('surface', () => { calls.push('replacement'); return 'new'; });
  gate.resolve();
  assert.equal(await active, 'finished');
  assert.equal(await replacement, 'new');
  await coordinator.whenIdle();
  assert.deepEqual(calls, ['active', 'replacement']);
});

test('dispose prevents queued and late callbacks even when a running update resolves afterward', async t => {
  const { coordinator, plot, windowTarget, resize } = fixture(t);
  const gate = deferred();
  const calls = [];
  const active = coordinator.enqueue('active', async () => { calls.push('active'); await gate.promise; return 'finished'; });
  await waitFor(() => calls.length > 0);
  const queued = coordinator.enqueue('surface', () => { calls.push('stale'); });
  coordinator.dispose();
  assert.equal(await queued, undefined);
  assert.equal(await coordinator.enqueue('late', () => { calls.push('late'); }), undefined);
  pointer(plot, 'pointerdown');
  pointer(windowTarget, 'pointerup');
  windowTarget.dispatchEvent(new Event('blur'));
  resize();
  gate.resolve();
  await active;
  await coordinator.whenIdle();
  assert.deepEqual(calls, ['active']);
  assert.equal(coordinator.isInteracting(), false);
});
