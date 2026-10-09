import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraInteractionForMode,
  orthographicFitHeight,
  perspectiveFitDistance,
  rebarPointSize
} from '../src/cameraView.js';

test('top-view rebar uses its projected diameter and follows zoom and viewport resizing', () => {
  const camera = { isOrthographicCamera: true, top: 15, bottom: -15, zoom: 1 };
  assert.equal(rebarPointSize(1, camera, 600), 20);
  assert.equal(rebarPointSize(0.5, camera, 600), 10);
  assert.equal(rebarPointSize(1, camera, 300), 10);
  camera.zoom = 2;
  assert.equal(rebarPointSize(1, camera, 600), 40);
});

test('switching back to perspective restores the diameter for built-in size attenuation', () => {
  assert.equal(rebarPointSize(1.128, { isOrthographicCamera: false }, 600), 1.128);
});

test('orthographic fitting protects both the section height and width', () => {
  assert.equal(orthographicFitHeight({ x: 120, y: 18 }, 2, 1), 60);
  assert.equal(orthographicFitHeight({ x: 18, y: 120 }, 2, 1), 120);
  assert.equal(orthographicFitHeight({ x: 120, y: 18 }, 0.5, 1), 240);
});

test('perspective fitting moves farther away for a narrow viewport', () => {
  const fov = Math.PI / 3;
  const wideDistance = perspectiveFitDistance({ x: 120, y: 18 }, fov, 2, 1);
  const narrowDistance = perspectiveFitDistance({ x: 120, y: 18 }, fov, 0.5, 1);

  assert.ok(narrowDistance > wideDistance);
  assert.ok(Number.isFinite(wideDistance));
});

test('orthographic top view permits zoom but locks rotation and panning', () => {
  assert.deepEqual(cameraInteractionForMode('top'), {
    enableRotate: false,
    enablePan: false,
    enableZoom: true
  });
  assert.deepEqual(cameraInteractionForMode('perspective'), {
    enableRotate: true,
    enablePan: true,
    enableZoom: true
  });
});
