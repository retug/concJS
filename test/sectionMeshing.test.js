import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  buildResolvedSectionMesh,
  defaultPriorityForMaterial,
  resolveMaterialRegions
} from '../src/sectionMeshing.js';

const concrete = { name: 'Concrete', type: 'concrete' };
const steel = { name: 'Steel', type: 'steel' };

function rectangle(xMin, yMin, xMax, yMax, material, priority) {
  const baseshape = new THREE.Shape([
    new THREE.Vector2(xMin, yMin),
    new THREE.Vector2(xMax, yMin),
    new THREE.Vector2(xMax, yMax),
    new THREE.Vector2(xMin, yMax)
  ]);
  return { baseshape, material, priority };
}

test('steel defaults above concrete and higher-priority overlap owns the FEM area', () => {
  assert.equal(defaultPriorityForMaterial(concrete), 0);
  assert.equal(defaultPriorityForMaterial(steel), 1);

  const shapes = [
    rectangle(0, 0, 10, 10, concrete, 0),
    rectangle(0, 0, 1, 10, steel, 1)
  ];
  const resolved = buildResolvedSectionMesh(shapes, { interiorSpacing: 2, edgeSpacing: 2 });
  const byName = new Map(resolved.materialSummary.map(item => [item.name, item]));

  assert.ok(Math.abs(resolved.area - 100) < 1e-7);
  assert.ok(Math.abs(byName.get('Concrete').area - 90) < 1e-7);
  assert.ok(Math.abs(byName.get('Steel').area - 10) < 1e-7);
  assert.equal(resolved.elements.every(element => element.userData.material), true);
});

test('a low-priority polygon is subtracted from every higher-priority region', () => {
  const shapes = [
    rectangle(0, 0, 8, 8, concrete, 0),
    rectangle(1, 1, 7, 7, steel, 2),
    rectangle(2, 2, 6, 6, concrete, 3)
  ];
  const regions = resolveMaterialRegions(shapes);

  assert.deepEqual(regions.map(region => region.priority), [3, 2, 0]);
  const resolved = buildResolvedSectionMesh(shapes, { interiorSpacing: 2, edgeSpacing: 2 });
  const totalByType = resolved.materialSummary.reduce((map, item) => {
    map.set(item.type, (map.get(item.type) ?? 0) + item.area);
    return map;
  }, new Map());
  assert.ok(Math.abs(totalByType.get('steel') - 20) < 1e-7);
  assert.ok(Math.abs(totalByType.get('concrete') - 44) < 1e-7);
});

test('thin polygons cap longitudinal mesh spacing from their shortest side', () => {
  const plate = rectangle(0, 0, 12, 0.25, steel, 1);
  const resolved = buildResolvedSectionMesh([plate], { interiorSpacing: 4, edgeSpacing: 4 });
  const maxEdge = Math.max(...resolved.elements.flatMap(element => {
    const p = element.geometry.attributes.position.array;
    const points = [[p[0], p[1]], [p[3], p[4]], [p[6], p[7]]];
    return [
      Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]),
      Math.hypot(points[2][0] - points[1][0], points[2][1] - points[1][1]),
      Math.hypot(points[0][0] - points[2][0], points[0][1] - points[2][1])
    ];
  }));

  assert.equal(resolved.elements.every(element => element.localMeshSpacing === 1), true);
  assert.ok(maxEdge <= 2.000001, `expected max edge <= 2 in, received ${maxEdge}`);
  assert.ok(Math.abs(resolved.area - 3) < 1e-7);
});
