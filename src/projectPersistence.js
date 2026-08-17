import * as THREE from 'three';
import { ConcShape } from './concShape.js';
import { StructuralMaterial, defaultMaterials } from './materials.js';
import { addRebar, resetProjectSelections } from './threeJSscenefunctions.js';
import { getRebarArea, getRebarDiameter, rebarDia } from './rebarProperties.js';
import {
  createProjectDocument,
  validateAndNormalizeProject
} from './projectFile.js';
import {
  getAnalysisConfiguration,
  getProjectMetadata,
  setAnalysisConfiguration,
  setProjectMetadata
} from './projectState.js';

export function initializeProjectPersistence({
  scene,
  getSprite,
  getDesignModel,
  prepareForProjectImport,
  refreshMaterialControls
}) {
  const saveButton = document.getElementById('saveProjectButton');
  const importButton = document.getElementById('importProjectButton');
  const saveModal = document.getElementById('saveProjectModal');
  const saveForm = document.getElementById('saveProjectForm');
  const fileInput = document.getElementById('projectFileInput');
  const importModal = document.getElementById('importProjectModal');

  saveButton?.addEventListener('click', () => {
    const metadata = getProjectMetadata();
    document.getElementById('projectName').value = metadata.name;
    document.getElementById('projectDescription').value = metadata.description;
    document.getElementById('projectNotes').value = metadata.notes;
    setModalOpen(saveModal, true);
    document.getElementById('projectName').focus();
  });

  document.getElementById('cancelSaveProject')?.addEventListener('click', () => setModalOpen(saveModal, false));
  document.getElementById('closeSaveProject')?.addEventListener('click', () => setModalOpen(saveModal, false));

  saveForm?.addEventListener('submit', event => {
    event.preventDefault();
    const metadata = {
      name: document.getElementById('projectName').value,
      description: document.getElementById('projectDescription').value,
      notes: document.getElementById('projectNotes').value
    };
    if (!metadata.name.trim()) {
      document.getElementById('projectName').focus();
      return;
    }

    setProjectMetadata(metadata);
    const project = serializeCurrentProject(getDesignModel());
    downloadJson(project, `${filenameSlug(metadata.name) || 'concretejs-project'}.json`);
    setModalOpen(saveModal, false);
    showNotice(`Saved “${metadata.name.trim()}” as a JSON project file.`, 'success');
  });

  importButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;

    let raw;
    try {
      raw = JSON.parse(await file.text());
    } catch (error) {
      showImportModal({
        title: 'Import failed',
        summary: `${file.name} is not valid JSON.`,
        details: [error.message],
        canConfirm: false
      });
      return;
    }

    const validation = validateAndNormalizeProject(raw);
    if (!validation.canImport) {
      showImportModal({
        title: 'Import failed',
        summary: `${file.name} could not be imported. Your current project was not changed.`,
        details: validation.errors,
        warnings: validation.warnings,
        canConfirm: false
      });
      return;
    }

    const project = validation.project;
    const modelSummary = `${project.concreteShapes.length} concrete shape(s), ` +
      `${project.reinforcement.length} rebar, and ${project.materials.length} material(s)`;
    showImportModal({
      title: 'Replace current project?',
      summary: `Import “${project.metadata.name || file.name}” with ${modelSummary}. ` +
        'This will completely replace the current model. Analysis will not run automatically.',
      details: validation.warnings,
      warnings: validation.warnings,
      canConfirm: true,
      onConfirm: () => {
        try {
          const staged = stageProject(project, scene, getSprite());
          prepareForProjectImport();
          commitStagedProject(staged, project, scene, getDesignModel, refreshMaterialControls);
          setModalOpen(importModal, false);
          showNotice(
            `Imported “${project.metadata.name || file.name}”. Press Generate PM when you are ready to analyze.`,
            validation.warnings.length ? 'warning' : 'success'
          );
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
  });

  document.getElementById('cancelImportProject')?.addEventListener('click', () => setModalOpen(importModal, false));
  document.getElementById('closeImportProject')?.addEventListener('click', () => setModalOpen(importModal, false));

  for (const modal of [saveModal, importModal]) {
    modal?.addEventListener('mousedown', event => {
      if (event.target === modal) setModalOpen(modal, false);
    });
  }
}

export function serializeCurrentProject({ concreteShapes, reinforcement }) {
  const materialIds = new Map(defaultMaterials.map((material, index) => [material, `material-${index + 1}`]));
  const materials = defaultMaterials.map((material, index) => ({
    id: `material-${index + 1}`,
    name: material.name,
    type: material.type,
    strengthBasis: material.normal_or_expected,
    stressStrain: material.strainData.map((strain, pointIndex) => ({
      strain,
      stress: material.stressData[pointIndex]
    }))
  }));

  const shapes = concreteShapes.map((shape, index) => ({
    id: `shape-${index + 1}`,
    materialId: requireMaterialId(materialIds, shape.material),
    geometry: {
      exterior: serializeContour(shape.baseshape),
      openings: shape.baseshape.holes.map(serializeContour)
    }
  }));

  const rebars = reinforcement.map((rebar, index) => {
    const position = rebar.geometry.attributes.position.array;
    const diameter = getRebarDiameter(rebar);
    return {
      id: `rebar-${index + 1}`,
      x: Number(position[0]),
      y: Number(position[1]),
      materialId: requireMaterialId(materialIds, rebar.materialData),
      size: {
        designation: `#${rebar.rebarSize}`,
        barNumber: Number(rebar.rebarSize),
        diameter,
        area: getRebarArea(rebar)
      }
    };
  });

  const currentAnalysis = getAnalysisConfiguration();
  const edgeSpacing = Number(document.getElementById('edgeSpa')?.value);
  const interiorSpacing = Number(document.getElementById('intSpa')?.value);
  const axialInput = Number(document.getElementById('mmAxialLoad')?.value);
  const analysisConfiguration = setAnalysisConfiguration({
    edgeSpacing: Number.isFinite(edgeSpacing) ? edgeSpacing : currentAnalysis.edgeSpacing,
    interiorSpacing: Number.isFinite(interiorSpacing) ? interiorSpacing : currentAnalysis.interiorSpacing,
    momentMomentAxialLoad: Number.isFinite(axialInput) ? axialInput : currentAnalysis.momentMomentAxialLoad
  });

  return createProjectDocument({
    metadata: getProjectMetadata(),
    materials,
    concreteShapes: shapes,
    reinforcement: rebars,
    analysisConfiguration
  });
}

function stageProject(project, scene, sprite) {
  const materials = project.materials.map(material => new StructuralMaterial(
    material.name,
    material.type,
    material.strengthBasis,
    material.stressStrain.map(point => point.stress),
    material.stressStrain.map(point => point.strain)
  ));
  const materialsById = new Map(project.materials.map((material, index) => [material.id, materials[index]]));

  const previousShapeRegistry = window.allConcShapes;
  window.allConcShapes = [];
  try {
    const concreteShapes = project.concreteShapes.map(shapeData => {
      const exterior = createPath(shapeData.geometry.exterior, true);
      const openings = shapeData.geometry.openings.map(contour => createPath(contour, false));
      const shape = new ConcShape(exterior, materialsById.get(shapeData.materialId), openings);
      shape.generateMesh();
      if (!shape.mesh) throw new Error(`Could not construct concrete shape ${shapeData.id}.`);
      return shape;
    });

    const reinforcement = project.reinforcement.map(bar => {
      const rebar = addRebar(bar.x, bar.y, bar.size.barNumber, scene, sprite, {
        material: materialsById.get(bar.materialId),
        diameter: bar.size.diameter,
        area: bar.size.area,
        addToScene: false
      });
      if (!rebar) throw new Error(`Could not construct reinforcement ${bar.id}.`);
      return rebar;
    });
    return { materials, concreteShapes, reinforcement };
  } finally {
    window.allConcShapes = previousShapeRegistry;
  }
}

function commitStagedProject(staged, project, scene, getDesignModel, refreshMaterialControls) {
  const current = getDesignModel();
  for (const shape of current.concreteShapes) scene.remove(shape.mesh);
  for (const rebar of current.reinforcement) scene.remove(rebar);
  for (const object of [...scene.children]) {
    if (object.type === 'Points' && object.isReference !== true && object.isRebar !== true) scene.remove(object);
  }

  defaultMaterials.splice(0, defaultMaterials.length, ...staged.materials);
  window.allConcShapes = staged.concreteShapes;
  for (const shape of staged.concreteShapes) scene.add(shape.mesh);
  for (const rebar of staged.reinforcement) scene.add(rebar);
  resetProjectSelections();

  setProjectMetadata(project.metadata);
  setAnalysisConfiguration(project.analysisConfiguration);
  if (document.getElementById('edgeSpa')) {
    document.getElementById('edgeSpa').value = String(project.analysisConfiguration.edgeSpacing);
  }
  if (document.getElementById('intSpa')) {
    document.getElementById('intSpa').value = String(project.analysisConfiguration.interiorSpacing);
  }
  refreshMaterialControls();
}

function serializeContour(path) {
  const supportedSegments = path.curves.map(serializeCurve);
  if (supportedSegments.every(Boolean)) return { segments: supportedSegments };
  return { segments: pointsToLineSegments(path.getPoints(96)) };
}

function serializeCurve(curve) {
  if (curve.type === 'LineCurve' && curve.v1 && curve.v2) {
    return {
      type: 'line',
      from: pointRecord(curve.v1),
      to: pointRecord(curve.v2)
    };
  }
  if (curve.type === 'EllipseCurve') {
    return {
      type: 'ellipse',
      center: { x: curve.aX, y: curve.aY },
      radiusX: curve.xRadius,
      radiusY: curve.yRadius,
      startAngle: curve.aStartAngle,
      endAngle: curve.aEndAngle,
      clockwise: curve.aClockwise,
      rotation: curve.aRotation
    };
  }
  return null;
}

function pointsToLineSegments(points) {
  if (points.length < 2) throw new Error('A concrete contour must contain at least two points.');
  const normalized = points.map(pointRecord);
  if (!samePoint(normalized[0], normalized.at(-1))) normalized.push({ ...normalized[0] });
  return normalized.slice(0, -1).map((point, index) => ({
    type: 'line',
    from: point,
    to: normalized[index + 1]
  }));
}

function createPath(contour, isShape) {
  const path = isShape ? new THREE.Shape() : new THREE.Path();
  path.curves = contour.segments.map(segment => {
    if (segment.type === 'line') {
      return new THREE.LineCurve(
        new THREE.Vector2(segment.from.x, segment.from.y),
        new THREE.Vector2(segment.to.x, segment.to.y)
      );
    }
    return new THREE.EllipseCurve(
      segment.center.x,
      segment.center.y,
      segment.radiusX,
      segment.radiusY,
      segment.startAngle,
      segment.endAngle,
      segment.clockwise,
      segment.rotation
    );
  });
  const lastCurve = path.curves.at(-1);
  if (lastCurve) path.currentPoint.copy(lastCurve.getPoint(1));
  return path;
}

function requireMaterialId(materialIds, material) {
  const id = materialIds.get(material);
  if (!id) throw new Error(`Material "${material?.name ?? 'unknown'}" is not registered.`);
  return id;
}

function pointRecord(point) {
  return { x: Number(point.x), y: Number(point.y) };
}

function samePoint(a, b) {
  return a.x === b.x && a.y === b.y;
}

function downloadJson(project, filename) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(project, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function filenameSlug(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function showImportModal({ title, summary, details = [], warnings = [], canConfirm, onConfirm }) {
  const modal = document.getElementById('importProjectModal');
  document.getElementById('importProjectTitle').textContent = title;
  document.getElementById('importProjectSummary').textContent = summary;
  const warning = document.getElementById('importProjectWarning');
  warning.hidden = warnings.length === 0;
  warning.textContent = warnings.length
    ? 'Warning: unsupported data may be discarded if this project is saved again.'
    : '';

  const detailsElement = document.getElementById('importProjectDetails');
  const list = document.getElementById('importProjectDetailList');
  list.replaceChildren(...details.map(message => Object.assign(document.createElement('li'), { textContent: message })));
  detailsElement.hidden = details.length === 0;
  detailsElement.open = !canConfirm;

  const confirmButton = document.getElementById('confirmImportProject');
  confirmButton.hidden = !canConfirm;
  confirmButton.onclick = canConfirm ? onConfirm : null;
  document.getElementById('cancelImportProject').textContent = canConfirm ? 'Cancel' : 'Close';
  setModalOpen(modal, true);
}

function showNotice(message, kind) {
  const notice = document.getElementById('projectNotice');
  if (!notice) return;
  notice.textContent = message;
  notice.dataset.kind = kind;
  notice.hidden = false;
  clearTimeout(showNotice.timeout);
  showNotice.timeout = setTimeout(() => { notice.hidden = true; }, 6000);
}

function setModalOpen(modal, open) {
  if (!modal) return;
  modal.classList.toggle('hidden', !open);
  modal.setAttribute('aria-hidden', String(!open));
}

