import * as THREE from 'three';

export function createPath(contour, isShape) {
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

