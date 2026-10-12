export const VERIFICATION_CATALOG_URL = '/static/concgui/verification/catalog.json';
export const VERIFICATION_MODELS_URL = '/static/concgui/verification/models/';

// Only a catalog id is accepted from the URL. The URL cannot select a remote
// host, an arbitrary project path, or a file outside the bundled model folder.
export async function initializeVerificationProject({
  ready,
  requestImport,
  showDiagnostics,
  search = window.location.search,
  fetchFn = window.fetch.bind(window)
}) {
  const parameters = new URLSearchParams(search);
  const id = parameters.get('verification');
  try {
    // Restoring a cached project after this dialog appeared could otherwise
    // replace the just-imported verification model or hide the user's work.
    await ready;
    if (!parameters.has('verification')) return false;
    if (parameters.getAll('verification').length !== 1 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error('The verification link has an invalid problem id. Open a problem from the verification index.');
    }

    const catalog = await fetchJson(fetchFn, VERIFICATION_CATALOG_URL, 'Verification catalog');
    if (!Array.isArray(catalog?.cases)) {
      throw new Error('The verification catalog does not contain a cases list.');
    }
    const matchingCases = catalog.cases.filter(item => item?.id === id);
    if (matchingCases.length !== 1) {
      throw new Error(`Verification problem “${id}” was not found in the catalog. Open a problem from the verification index.`);
    }
    const verificationCase = matchingCases[0];
    if (typeof verificationCase.modelFile !== 'string' || !/^[a-z0-9][a-z0-9_-]*\.json$/i.test(verificationCase.modelFile)) {
      throw new Error(`Verification problem “${id}” does not have a valid bundled model filename.`);
    }

    const raw = await fetchJson(fetchFn, `${VERIFICATION_MODELS_URL}${verificationCase.modelFile}`, 'Verification model');
    // requestImport validates the document and only offers the standard import
    // confirmation; fetching a model never replaces or analyzes it directly.
    return requestImport(raw, verificationCase.title || id);
  } catch (error) {
    if (!parameters.has('verification')) return false;
    showDiagnostics({
      title: 'Verification problem could not be opened',
      summary: 'Your current project was not changed. You can try the link again or import a downloaded project file.',
      details: [error.message || String(error)]
    });
    return false;
  }
}

async function fetchJson(fetchFn, url, label) {
  let response;
  try {
    response = await fetchFn(url, {
      credentials: 'same-origin',
      redirect: 'error',
      headers: { Accept: 'application/json' }
    });
  } catch (error) {
    throw new Error(`${label} could not be fetched. Check your connection and try again. ${error.message || ''}`.trim());
  }
  if (!response.ok) {
    throw new Error(`${label} could not be fetched (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}
