import { SectionAnalysis } from './SectionAnalysis.js';
import { StructuralMaterial } from '../materials.js';
import { createPath } from '../projectGeometry.js';
import { validateAndNormalizeProject } from '../projectFile.js';
import { buildResolvedSectionMesh } from '../sectionMeshing.js';

/** Reconstruct saved inputs using the same geometry, materials and FEM as the UI. */
export function analyzeProjectAtAngle(rawProject, angle = 90) {
  const validation = validateAndNormalizeProject(rawProject);
  if (!validation.canImport) throw new Error(validation.errors.join('; '));
  const project = validation.project;
  const materials = new Map(project.materials.map(saved => [saved.id, new StructuralMaterial(
    saved.name, saved.type, saved.strengthBasis,
    saved.stressStrain.map(point => point.stress),
    saved.stressStrain.map(point => point.strain), saved.compressiveStrengthACI
  )]));
  const shapes = project.concreteShapes.map(saved => {
    const baseshape = createPath(saved.geometry.exterior, true);
    baseshape.holes = saved.geometry.openings.map(contour => createPath(contour, false));
    return { baseshape, material: materials.get(saved.materialId), priority: saved.priority };
  });
  const section = new SectionAnalysis(shapes.find(shape => shape.material.type === 'concrete')?.material ?? shapes[0]?.material);
  section.initializeRebarObjects(project.reinforcement.map(saved => ({
    geometry: { attributes: { position: { array: new Float32Array([saved.x, saved.y, 0]) } } },
    materialData: materials.get(saved.materialId),
    rebarSize: saved.size.barNumber, rebarArea: saved.size.area, rebarDiameter: saved.size.diameter
  })));
  const resolved = buildResolvedSectionMesh(shapes, project.analysisConfiguration);
  Object.assign(section, { FEMmesh: resolved.elements, FEMarea: resolved.area,
    centroidX: resolved.centroidX, centroidY: resolved.centroidY, materialSummary: resolved.materialSummary });
  section.CalcPnmax('other');
  section.transformCoordinatesAtAngle(angle, false);
  section.generateStrains(angle);
  const result = section.generatePMM(angle);
  return { section, result, profiles: section.strainProfiles[angle] };
}
