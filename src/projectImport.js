import { validateAndNormalizeProject } from './projectFile.js';

// Both local files and bundled verification models must pass through this
// dialog before they can replace the live project.
export function createProjectImportRequester({ showImportModal, replaceProject, onImported }) {
  return function requestImport(raw, displayName = 'Project') {
    const validation = validateAndNormalizeProject(raw);
    if (!validation.canImport) {
      showImportModal({
        title: 'Import failed',
        summary: `${displayName} could not be imported. Your current project was not changed.`,
        details: validation.errors,
        warnings: validation.warnings,
        canConfirm: false
      });
      return false;
    }

    const project = validation.project;
    const modelSummary = `${project.concreteShapes.length} concrete shape(s), ` +
      `${project.reinforcement.length} rebar, and ${project.materials.length} material(s)`;
    showImportModal({
      title: 'Replace current project?',
      summary: `Import “${project.metadata.name || displayName}” with ${modelSummary}. ` +
        'This will completely replace the current model. Analysis will not run automatically.',
      details: validation.warnings,
      warnings: validation.warnings,
      canConfirm: true,
      onConfirm: () => {
        try {
          replaceProject(project);
          onImported(project, displayName, validation.warnings);
        } catch (error) {
          console.error('Project import failed:', error);
          showImportModal({
            title: 'Import failed',
            summary: 'The project could not be constructed. Your current project was not changed.',
            details: [error.message],
            canConfirm: false
          });
        }
      }
    });
    return true;
  };
}
