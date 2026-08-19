import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraInteractionForMode,
  orthographicFitHeight,
  perspectiveFitDistance
} from '../src/cameraView.js';

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
