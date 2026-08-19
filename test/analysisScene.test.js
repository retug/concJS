import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAnalysisRaycastTargets,
  isEditablePolygonMesh,
  removeEditablePolygonMeshes
} from '../src/analysisScene.js';

test('analysis removes editable polygon meshes but keeps FEM and rebar objects', () => {
  const shape = {};
  const baseMesh = { isMesh: true, userData: { concShape: shape } };
  shape.mesh = baseMesh;
  const fem = { isMesh: true, userData: { concShape: shape } };
  const rebar = { isPoints: true };
  const scene = {
    children: [baseMesh, fem, rebar],
    remove(object) {
      this.children = this.children.filter(child => child !== object);
    }
  };

  assert.equal(isEditablePolygonMesh(baseMesh), true);
  assert.equal(isEditablePolygonMesh(fem), false);
  assert.deepEqual(removeEditablePolygonMeshes(scene), [baseMesh]);
  assert.deepEqual(scene.children, [fem, rebar]);
});

test('result raycasting targets only active FEM triangles and rebar', () => {
  const fem = { visible: true };
  const rebar = { visible: true };
  const hidden = { visible: false };
  assert.deepEqual(getAnalysisRaycastTargets({
    FEMmesh: [fem, hidden],
    rebarObjects: [rebar]
  }), [fem, rebar]);
});
