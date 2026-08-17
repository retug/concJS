import { validateAndNormalizeProject } from './projectFile.js';

export const PROJECT_CACHE_KEY = 'concretejs:last-project';
export const PROJECT_CACHE_INTERVAL_MS = 750;

export function initializeProjectCache({
  serializeProject,
  replaceProject,
  showNotice,
  showDiagnostics,
  ready = Promise.resolve(),
  storage = window.localStorage,
  pageTarget = window,
  setIntervalFn = window.setInterval.bind(window),
  clearIntervalFn = window.clearInterval.bind(window)
}) {
  let lastSignature = null;
  let intervalId = null;
  let storageWarningShown = false;

  const saveNow = () => {
    let project;
    try {
      const validation = validateAndNormalizeProject(serializeProject());
      if (!validation.canImport) {
        throw new Error(`Current project inputs are not cacheable: ${validation.errors.join(' ')}`);
      }
      project = validation.project;
    } catch (error) {
      console.warn('Project cache skipped a transient model state:', error);
      return false;
    }

    const signature = projectContentSignature(project);
    if (signature === lastSignature) return false;

    try {
      storage.setItem(PROJECT_CACHE_KEY, JSON.stringify(project));
      lastSignature = signature;
      return true;
    } catch (error) {
      console.warn('Project cache could not write to browser storage:', error);
      if (!storageWarningShown) {
        showNotice('Automatic recovery could not save this session in browser storage.', 'warning');
        storageWarningShown = true;
      }
      return false;
    }
  };

  const restoration = Promise.resolve(ready)
    .then(() => restoreCachedProject({ storage, serializeProject, replaceProject, showNotice, showDiagnostics }))
    .then(restored => {
      lastSignature = projectContentSignature(serializeProject());
      intervalId = setIntervalFn(saveNow, PROJECT_CACHE_INTERVAL_MS);
      pageTarget.addEventListener('pagehide', saveNow);
      return restored;
    })
    .catch(error => {
      console.error('Project cache initialization failed:', error);
      showDiagnostics({
        title: 'Previous session could not be restored',
        summary: 'The app opened without restoring browser-cached inputs.',
        details: [error.message]
      });
      lastSignature = projectContentSignature(serializeProject());
      intervalId = setIntervalFn(saveNow, PROJECT_CACHE_INTERVAL_MS);
      pageTarget.addEventListener('pagehide', saveNow);
      return false;
    });

  return {
    restoration,
    saveNow,
    dispose() {
      if (intervalId !== null) clearIntervalFn(intervalId);
      pageTarget.removeEventListener('pagehide', saveNow);
    }
  };
}

export function projectContentSignature(project) {
  const inputOnlyProject = { ...project };
  delete inputOnlyProject.createdAt;
  return JSON.stringify(inputOnlyProject);
}

async function restoreCachedProject({ storage, replaceProject, showNotice, showDiagnostics }) {
  let cachedText;
  try {
    cachedText = storage.getItem(PROJECT_CACHE_KEY);
  } catch (error) {
    showDiagnostics({
      title: 'Automatic recovery is unavailable',
      summary: 'The browser did not allow access to its local project cache.',
      details: [error.message]
    });
    return false;
  }
  if (!cachedText) return false;

  let cachedValue;
  try {
    cachedValue = JSON.parse(cachedText);
  } catch (error) {
    removeInvalidCache(storage);
    showDiagnostics({
      title: 'Previous session could not be restored',
      summary: 'The cached project was not valid JSON. The app opened with a blank model.',
      details: [error.message]
    });
    return false;
  }

  const validation = validateAndNormalizeProject(cachedValue);
  if (!validation.canImport) {
    removeInvalidCache(storage);
    showDiagnostics({
      title: 'Previous session could not be restored',
      summary: 'The cached project was invalid. The app opened with a blank model.',
      details: validation.errors,
      warnings: validation.warnings
    });
    return false;
  }

  try {
    await replaceProject(validation.project);
  } catch (error) {
    removeInvalidCache(storage);
    showDiagnostics({
      title: 'Previous session could not be restored',
      summary: 'The cached inputs passed validation but could not be reconstructed. The app opened with a blank model.',
      details: [error.message]
    });
    return false;
  }

  const projectName = validation.project.metadata.name || 'your previous project';
  showNotice(`Restored “${projectName}” from this browser.`, validation.warnings.length ? 'warning' : 'success');
  if (validation.warnings.length) {
    showDiagnostics({
      title: 'Previous session restored with warnings',
      summary: 'Recognized cached inputs were restored. Saving again may discard unsupported data.',
      details: validation.warnings,
      warnings: validation.warnings
    });
  }
  return true;
}

function removeInvalidCache(storage) {
  try {
    storage.removeItem(PROJECT_CACHE_KEY);
  } catch (error) {
    console.warn('Invalid project cache could not be removed:', error);
  }
}
