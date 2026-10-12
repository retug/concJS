import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProjectImportRequester } from '../src/projectImport.js';
import {
  initializeVerificationProject,
  VERIFICATION_CATALOG_URL,
  VERIFICATION_MODELS_URL
} from '../src/verificationProject.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/import-project.json', import.meta.url), 'utf8'));
const catalog = { cases: [{ id: 'problem1', title: 'First verification problem', modelFile: 'problem1.json' }] };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function setup({ model = fixture, caseCatalog = catalog, responses = [] } = {}) {
  const state = {
    currentProject: { metadata: { name: 'Work in progress' } },
    replacements: 0,
    dialogs: [],
    diagnostics: [],
    fetched: [],
    imported: []
  };
  const requestImport = createProjectImportRequester({
    showImportModal: dialog => state.dialogs.push(dialog),
    replaceProject: project => { state.currentProject = project; state.replacements += 1; },
    onImported: (...args) => state.imported.push(args)
  });
  const options = {
    search: '?verification=problem1',
    ready: Promise.resolve(),
    requestImport,
    showDiagnostics: diagnostic => state.diagnostics.push(diagnostic),
    fetchFn: async (url, init) => {
      state.fetched.push({ url, init });
      const override = responses[state.fetched.length - 1];
      if (override instanceof Error) throw override;
      return override ?? { ok: true, json: async () => url === VERIFICATION_CATALOG_URL ? caseCatalog : model };
    }
  };
  return { state, options };
}

test('bundled model waits for scene and cache restoration, then requires import confirmation', async () => {
  const { state, options } = setup();
  const sceneReady = deferred();
  const cacheReady = deferred();
  const pending = initializeVerificationProject({ ...options, ready: Promise.all([sceneReady.promise, cacheReady.promise]) });
  await Promise.resolve();
  assert.equal(state.fetched.length, 0);
  sceneReady.resolve();
  await Promise.resolve();
  assert.equal(state.fetched.length, 0);
  const restoredProject = { metadata: { name: 'Restored cached project' } };
  state.currentProject = restoredProject;
  cacheReady.resolve();

  assert.equal(await pending, true);
  assert.equal(state.currentProject, restoredProject);
  assert.equal(state.replacements, 0);
  assert.deepEqual(state.fetched.map(item => item.url), [
    VERIFICATION_CATALOG_URL, `${VERIFICATION_MODELS_URL}problem1.json`
  ]);
  for (const { init } of state.fetched) {
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.redirect, 'error');
  }
  assert.equal(state.dialogs.length, 1);
  const confirmation = state.dialogs[0];
  assert.equal(confirmation.canConfirm, true);
  assert.match(confirmation.summary, /completely replace the current model/);
  assert.match(confirmation.summary, /Analysis will not run automatically/);
  // Leaving the dialog unconfirmed (including Cancel/Close) cannot replace it.
  assert.equal(state.currentProject, restoredProject);
  confirmation.onConfirm();
  assert.equal(state.replacements, 1);
  assert.equal(state.currentProject.metadata.name, fixture.metadata.name);
  assert.equal(state.imported.length, 1);
});

test('ordinary app startup does not fetch a verification model', async () => {
  const { state, options } = setup();
  assert.equal(await initializeVerificationProject({ ...options, search: '?other=1' }), false);
  assert.deepEqual(state.fetched, []);
  assert.deepEqual(state.dialogs, []);
  assert.deepEqual(state.diagnostics, []);
});

test('unknown or invalid verification IDs never fetch a model or replace current work', async t => {
  for (const search of ['?verification=missing', '?verification=../problem1', '?verification=', '?verification=problem1&verification=problem2']) {
    await t.test(search, async () => {
      const { state, options } = setup();
      const current = state.currentProject;
      assert.equal(await initializeVerificationProject({ ...options, search }), false);
      assert.equal(state.currentProject, current);
      assert.equal(state.replacements, 0);
      assert.equal(state.dialogs.length, 0);
      assert.equal(state.diagnostics.length, 1);
      assert.ok(state.fetched.every(({ url }) => url === VERIFICATION_CATALOG_URL));
    });
  }
});

test('catalog cannot point to arbitrary URLs, paths, or ambiguous IDs', async t => {
  for (const modelFile of ['../problem1.json', 'nested/problem1.json', 'https://example.com/model.json', 'problem1.json?extra=1', '\\problem1.json']) {
    await t.test(modelFile, async () => {
      const { state, options } = setup({ caseCatalog: { cases: [{ ...catalog.cases[0], modelFile }] } });
      assert.equal(await initializeVerificationProject(options), false);
      assert.equal(state.fetched.length, 1);
      assert.equal(state.replacements, 0);
      assert.equal(state.diagnostics.length, 1);
    });
  }
  for (const caseCatalog of [{}, { cases: [catalog.cases[0], catalog.cases[0]] }]) {
    const { state, options } = setup({ caseCatalog });
    assert.equal(await initializeVerificationProject(options), false);
    assert.equal(state.fetched.length, 1);
    assert.equal(state.replacements, 0);
  }
});

test('malformed project documents use the normal import diagnostics without replacement', async () => {
  const { state, options } = setup({ model: { format: 'different-format' } });
  const current = state.currentProject;
  assert.equal(await initializeVerificationProject(options), false);
  assert.equal(state.currentProject, current);
  assert.equal(state.replacements, 0);
  assert.equal(state.dialogs[0].canConfirm, false);
  assert.ok(state.dialogs[0].details.length > 0);
  assert.equal(state.dialogs[0].onConfirm, undefined);
});

test('network, HTTP, and invalid JSON errors leave current work untouched', async t => {
  for (const [name, response, expected] of [
    ['network', new Error('Offline'), /could not be fetched/],
    ['HTTP', { ok: false, status: 404 }, /HTTP 404/],
    ['JSON', { ok: true, json: async () => { throw new SyntaxError('Bad JSON'); } }, /not valid JSON/]
  ]) {
    for (const failAt of ['catalog', 'model']) {
      await t.test(`${failAt} ${name}`, async () => {
        const responses = failAt === 'catalog' ? [response] : [null, response];
        const { state, options } = setup({ responses });
        const current = state.currentProject;
        assert.equal(await initializeVerificationProject(options), false);
        assert.equal(state.currentProject, current);
        assert.equal(state.replacements, 0);
        assert.equal(state.dialogs.length, 0);
        assert.match(state.diagnostics[0].details[0], expected);
      });
    }
  }
});

test('failed scene readiness prevents a bundled model import', async () => {
  const { state, options } = setup();
  const ready = deferred();
  const pending = initializeVerificationProject({ ...options, ready: ready.promise });
  ready.reject(new Error('Scene texture could not be loaded'));
  assert.equal(await pending, false);
  assert.equal(state.fetched.length, 0);
  assert.equal(state.replacements, 0);
  assert.match(state.diagnostics[0].details[0], /Scene texture/);
});

test('normal import warnings and saved demand inputs survive the bundled import path', async () => {
  const model = structuredClone(fixture);
  model.schemaVersion = 999;
  model.analysisConfiguration.demandCases = [{ id: 'demand-1', name: 'Published point', P: -300, M2: 125, M3: -50 }];
  const { state, options } = setup({ model });
  assert.equal(await initializeVerificationProject(options), true);
  assert.ok(state.dialogs[0].warnings.length > 0);
  state.dialogs[0].onConfirm();
  assert.deepEqual(state.currentProject.analysisConfiguration.demandCases, model.analysisConfiguration.demandCases);
  assert.ok(state.imported[0][2].length > 0);
});
