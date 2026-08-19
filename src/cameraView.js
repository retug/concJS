const MIN_VIEW_SIZE = 1e-6;

export function perspectiveFitDistance(size, verticalFovRadians, aspect, padding = 1.18) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const safeVerticalFov = Number.isFinite(verticalFovRadians) && verticalFovRadians > 0
    ? verticalFovRadians
    : Math.PI / 3;
  const horizontalFov = 2 * Math.atan(Math.tan(safeVerticalFov / 2) * safeAspect);
  const width = Math.max(Number(size?.x) || 0, MIN_VIEW_SIZE);
  const height = Math.max(Number(size?.y) || 0, MIN_VIEW_SIZE);

  return Math.max(
    height / (2 * Math.tan(safeVerticalFov / 2)),
    width / (2 * Math.tan(horizontalFov / 2)),
    1
  ) * padding;
}

export function orthographicFitHeight(size, aspect, padding = 1.18) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const width = Math.max(Number(size?.x) || 0, MIN_VIEW_SIZE);
  const height = Math.max(Number(size?.y) || 0, MIN_VIEW_SIZE);
  return Math.max(height, width / safeAspect, 1) * padding;
}

export function cameraInteractionForMode(mode) {
  const topView = mode === 'top';
  return {
    enableRotate: !topView,
    enablePan: !topView,
    enableZoom: true
  };
}
