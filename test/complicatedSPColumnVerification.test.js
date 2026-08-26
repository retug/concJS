import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StructuralMaterial } from '../src/materials.js';
import { calculateRebarForce } from '../src/analysis/rebarConcreteDisplacement.js';

const projectUrl = new URL(
  '../verification/complicatedSPColumn/sp-column-sepcial-structural-wall-copmressive.json',
  import.meta.url
);

function materialFromProject(savedMaterial) {
  return new StructuralMaterial(
    savedMaterial.name,
    savedMaterial.type,
    savedMaterial.strengthBasis,
    savedMaterial.stressStrain.map(point => point.stress),
    savedMaterial.stressStrain.map(point => point.strain),
    savedMaterial.compressiveStrengthACI
  );
}

function lineContourArea(contour) {
  const points = contour.segments.map(segment => segment.from);
  return Math.abs(points.reduce((twiceArea, point, index) => {
    const next = points[(index + 1) % points.length];
    return twiceArea + point.x * next.y - next.x * point.y;
  }, 0)) / 2;
}

test('the SP Column uniform-compression profile matches the target axial force', async () => {
  const project = JSON.parse(await readFile(projectUrl, 'utf8'));
  const savedMaterials = new Map(project.materials.map(material => [material.id, material]));
  const materials = new Map(
    project.materials.map(material => [material.id, materialFromProject(material)])
  );
  const strain = -0.003;

  const concreteForce = project.concreteShapes.reduce((force, shape) => {
    const area = lineContourArea(shape.geometry.exterior)
      - shape.geometry.openings.reduce((sum, opening) => sum + lineContourArea(opening), 0);
    return force + area * materials.get(shape.materialId).stress(strain);
  }, 0);

  const concreteMaterial = materials.get(project.concreteShapes[0].materialId);
  const rebarForce = project.reinforcement.reduce((force, rebar) => (
    force + calculateRebarForce(
      rebar.size.area,
      materials.get(rebar.materialId),
      concreteMaterial,
      strain
    )
  ), 0);
  const axialForceKips = (concreteForce + rebarForce) / 1000;

  assert.equal(savedMaterials.get(project.concreteShapes[0].materialId).name, 'fc6ksi');
  assert.ok(Math.abs(axialForceKips - (-103233.876)) < 1e-6);
});
