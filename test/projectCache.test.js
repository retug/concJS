import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  initializeProjectCache,
  PROJECT_CACHE_KEY,
  projectContentSignature
} from '../src/projectCache.js';

const fixtureUrl = new URL('./fixtures/import-project.json', import.meta.url);

async function loadFixture() {
  return JSON.parse(await readFile(fixtureUrl, 'utf8'));
}

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.entries.get(key) ?? null;
  }

  setItem(key, value) {
    this.entries.set(key, value);
  }

  removeItem(key) {
    this.entries.delete(key);
  }
}

class EventTargetStub {
  addEventListener() {}
  removeEventListener() {}
}

function createTimerStub() {
  return {
    callback: null,
    setInterval(callback) {
      this.callback = callback;
      return 1;
    },
    clearInterval() {}
  };
}

test('restores the latest valid cached project automatically', async () => {
  const cachedProject = await loadFixture();
  const storage = new MemoryStorage({ [PROJECT_CACHE_KEY]: JSON.stringify(cachedProject) });
  const timer = createTimerStub();
  let currentProject = null;
  const notices = [];

  const cache = initializeProjectCache({
    storage,
    pageTarget: new EventTargetStub(),
    setIntervalFn: timer.setInterval.bind(timer),
    clearIntervalFn: timer.clearInterval.bind(timer),
    serializeProject: () => currentProject ?? cachedProject,
    replaceProject: project => { currentProject = project; },
    showNotice: message => notices.push(message),
    showDiagnostics: () => assert.fail('Valid cache should not show diagnostics.')
  });

  assert.equal(await cache.restoration, true);
  assert.equal(currentProject.metadata.name, 'Import Verification');
  assert.match(notices[0], /Restored “Import Verification”/);
  cache.dispose();
});

test('autosave keeps input data and strips analysis results', async () => {
  let currentProject = await loadFixture();
  currentProject.results = { PMM: [1, 2, 3] };
  const storage = new MemoryStorage();
  const timer = createTimerStub();

  const cache = initializeProjectCache({
    storage,
    pageTarget: new EventTargetStub(),
    setIntervalFn: timer.setInterval.bind(timer),
    clearIntervalFn: timer.clearInterval.bind(timer),
    serializeProject: () => currentProject,
    replaceProject: () => {},
    showNotice: () => {},
    showDiagnostics: () => {}
  });
  await cache.restoration;

  currentProject = {
    ...currentProject,
    metadata: { ...currentProject.metadata, notes: 'Edited after startup' }
  };
  assert.equal(cache.saveNow(), true);
  const saved = JSON.parse(storage.getItem(PROJECT_CACHE_KEY));
  assert.equal(saved.metadata.notes, 'Edited after startup');
  assert.equal('results' in saved, false);
  cache.dispose();
});

test('invalid cached JSON opens blank, reports details, and is removed', async () => {
  const currentProject = await loadFixture();
  const storage = new MemoryStorage({ [PROJECT_CACHE_KEY]: '{not-json' });
  const timer = createTimerStub();
  const diagnostics = [];

  const cache = initializeProjectCache({
    storage,
    pageTarget: new EventTargetStub(),
    setIntervalFn: timer.setInterval.bind(timer),
    clearIntervalFn: timer.clearInterval.bind(timer),
    serializeProject: () => currentProject,
    replaceProject: () => assert.fail('Invalid cache must not replace the model.'),
    showNotice: () => {},
    showDiagnostics: diagnostic => diagnostics.push(diagnostic)
  });

  assert.equal(await cache.restoration, false);
  assert.equal(storage.getItem(PROJECT_CACHE_KEY), null);
  assert.match(diagnostics[0].summary, /blank model/i);
  assert.ok(diagnostics[0].details.length > 0);
  cache.dispose();
});

test('cache signatures ignore save timestamps', async () => {
  const project = await loadFixture();
  const later = { ...project, createdAt: '2030-01-01T00:00:00.000Z' };
  assert.equal(projectContentSignature(project), projectContentSignature(later));
});
