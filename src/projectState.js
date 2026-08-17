const EMPTY_METADATA = Object.freeze({
  name: "",
  description: "",
  notes: ""
});

const DEFAULT_ANALYSIS_CONFIGURATION = Object.freeze({
  edgeSpacing: 1,
  interiorSpacing: 1,
  momentMomentAxialLoad: 0
});

let projectMetadata = { ...EMPTY_METADATA };
let analysisConfiguration = { ...DEFAULT_ANALYSIS_CONFIGURATION };

export function getProjectMetadata() {
  return { ...projectMetadata };
}

export function setProjectMetadata(metadata = {}) {
  projectMetadata = {
    name: String(metadata.name ?? "").trim(),
    description: String(metadata.description ?? "").trim(),
    notes: String(metadata.notes ?? "").trim()
  };
  return getProjectMetadata();
}

export function getAnalysisConfiguration() {
  return { ...analysisConfiguration };
}

export function setAnalysisConfiguration(configuration = {}) {
  analysisConfiguration = {
    edgeSpacing: finiteOrDefault(configuration.edgeSpacing, DEFAULT_ANALYSIS_CONFIGURATION.edgeSpacing),
    interiorSpacing: finiteOrDefault(configuration.interiorSpacing, DEFAULT_ANALYSIS_CONFIGURATION.interiorSpacing),
    momentMomentAxialLoad: finiteOrDefault(
      configuration.momentMomentAxialLoad,
      DEFAULT_ANALYSIS_CONFIGURATION.momentMomentAxialLoad
    )
  };
  return getAnalysisConfiguration();
}

export function updateAnalysisConfiguration(configuration = {}) {
  return setAnalysisConfiguration({ ...analysisConfiguration, ...configuration });
}

function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

