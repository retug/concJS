import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';

const GEOMETRY_EPSILON = 1e-8;
const MAX_TRIANGLES_PER_REGION = 60000;
const MAX_THIN_REGION_ASPECT = 4;

/**
 * Concrete is the background material by convention.  Structural steel and
 * other overlays default above it, while every polygon can override this
 * value explicitly.
 */
export function defaultPriorityForMaterial(material) {
    return material?.type === 'steel' ? 1 : 0;
}

export function getShapePriority(shape) {
    const priority = Number(shape?.priority);
    return Number.isFinite(priority) ? priority : defaultPriorityForMaterial(shape?.material);
}

/** Convert a THREE.Shape (including openings) into polygon-clipping format. */
export function shapeToMultiPolygon(shape, curveDivisions = 96) {
    const baseShape = shape?.baseshape ?? shape;
    if (!baseShape?.extractPoints) {
        throw new Error('A section polygon must provide a valid THREE.Shape.');
    }

    const extracted = baseShape.extractPoints(curveDivisions);
    const exterior = normalizeRing(extracted.shape);
    if (exterior.length < 4) throw new Error('A section polygon needs at least three distinct exterior points.');

    const holes = (extracted.holes ?? [])
        .map(normalizeRing)
        .filter(ring => ring.length >= 4);
    return [[exterior, ...holes]];
}

/**
 * Resolve overlaps into disjoint material regions.  Larger priority values
 * win.  For equal priorities, the polygon created later wins so the outcome
 * remains deterministic and intuitive for overlays.
 */
export function resolveMaterialRegions(shapes) {
    const ranked = shapes
        .map((shape, sourceIndex) => ({ shape, sourceIndex, priority: getShapePriority(shape) }))
        .sort((left, right) => right.priority - left.priority || right.sourceIndex - left.sourceIndex);

    const regions = [];
    let occupied = [];

    for (const entry of ranked) {
        const geometry = shapeToMultiPolygon(entry.shape);
        const visibleGeometry = occupied.length
            ? polygonClipping.difference(geometry, occupied)
            : geometry;

        if (visibleGeometry?.length) {
            regions.push({
                ...entry,
                material: entry.shape.material,
                geometry: visibleGeometry,
                shortestSide: getShortestBoundarySegment(entry.shape)
            });
        }
        occupied = occupied.length
            ? polygonClipping.union(occupied, geometry)
            : geometry;
    }

    return regions;
}

/**
 * Build an exact, non-overlapping triangle mesh for all resolved material
 * regions.  The shortest polygon side caps the requested spacing so thin
 * plates cannot disappear inside a coarse global mesh.
 */
export function buildResolvedSectionMesh(shapes, options = {}) {
    const interiorSpacing = positiveFinite(options.interiorSpacing, 1);
    const edgeSpacing = positiveFinite(options.edgeSpacing, interiorSpacing);
    const regions = resolveMaterialRegions(shapes);
    const elements = [];
    const materialAreas = new Map();
    let area = 0;
    let firstMomentX = 0;
    let firstMomentY = 0;

    for (const region of regions) {
        // Thin polygons keep their exact two-sided boundary in the base
        // triangulation.  Cap their longitudinal stations at four times the
        // shortest side; this captures 1/4-in plates without forcing an
        // impractical isotropic 1/4-in mesh along a 10-ft wall.
        const localSpacing = Math.max(
            GEOMETRY_EPSILON,
            Math.min(
                interiorSpacing,
                edgeSpacing,
                (region.shortestSide || interiorSpacing) * MAX_THIN_REGION_ASPECT
            )
        );
        const baseTriangles = triangulateMultiPolygon(region.geometry);
        let regionTriangleCount = 0;

        for (const triangle of baseTriangles) {
            const refined = refineTriangle(triangle, localSpacing, region.shortestSide);
            regionTriangleCount += refined.length;
            if (regionTriangleCount > MAX_TRIANGLES_PER_REGION) {
                throw new Error(
                    `Meshing “${region.material?.name ?? 'material region'}” would exceed ` +
                    `${MAX_TRIANGLES_PER_REGION.toLocaleString()} triangles. Increase the mesh spacing or simplify the geometry.`
                );
            }

            for (const points of refined) {
                const triangleArea = getTriangleArea(points);
                if (triangleArea <= GEOMETRY_EPSILON) continue;
                const centroid = getTriangleCentroid(points);
                const element = createTriangleMesh(points, region);
                element.area = triangleArea;
                element.centroid = centroid;
                element.localMeshSpacing = localSpacing;
                elements.push(element);

                area += triangleArea;
                firstMomentX += triangleArea * centroid.x;
                firstMomentY += triangleArea * centroid.y;
                const material = region.material;
                const current = materialAreas.get(material) ?? {
                    material,
                    name: material?.name ?? 'Unspecified',
                    type: material?.type ?? 'other',
                    area: 0,
                    triangleCount: 0,
                    priorities: new Set()
                };
                current.area += triangleArea;
                current.triangleCount += 1;
                current.priorities.add(region.priority);
                materialAreas.set(material, current);
            }
        }
    }

    const centroidX = area > 0 ? firstMomentX / area : 0;
    const centroidY = area > 0 ? firstMomentY / area : 0;
    const materialSummary = [...materialAreas.values()]
        .map(item => ({
            ...item,
            priorities: [...item.priorities].sort((a, b) => b - a),
            percentage: area > 0 ? item.area / area * 100 : 0
        }))
        .sort((left, right) => right.area - left.area);

    return { elements, area, centroidX, centroidY, materialSummary, regions };
}

export function getShortestBoundarySegment(shape) {
    const multiPolygon = shapeToMultiPolygon(shape);
    let shortest = Infinity;
    for (const polygon of multiPolygon) {
        for (const ring of polygon) {
            for (let index = 0; index < ring.length - 1; index += 1) {
                const [x1, y1] = ring[index];
                const [x2, y2] = ring[index + 1];
                const length = Math.hypot(x2 - x1, y2 - y1);
                if (length > GEOMETRY_EPSILON) shortest = Math.min(shortest, length);
            }
        }
    }
    return Number.isFinite(shortest) ? shortest : 1;
}

function triangulateMultiPolygon(multiPolygon) {
    const triangles = [];
    for (const polygon of multiPolygon ?? []) {
        if (!polygon?.length) continue;
        const contour = openRing(polygon[0]).map(([x, y]) => new THREE.Vector2(x, y));
        const holes = polygon.slice(1).map(ring => (
            openRing(ring).map(([x, y]) => new THREE.Vector2(x, y))
        ));
        if (contour.length < 3) continue;

        const vertices = [...contour, ...holes.flat()];
        const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
        for (const face of faces) {
            triangles.push(face.map(index => [vertices[index].x, vertices[index].y]));
        }
    }
    return triangles;
}

function refineTriangle(triangle, targetSpacing, shortestSide) {
    const completed = [];
    const pending = [triangle];
    const transverseSpacing = Math.min(targetSpacing, shortestSide || targetSpacing);
    const targetArea = 0.5 * targetSpacing * transverseSpacing * (1 + 1e-9);
    const maxLongitudinalEdge = targetSpacing * 2 * (1 + 1e-9);

    while (pending.length) {
        const current = pending.pop();
        const edgeLengths = [
            distance(current[0], current[1]),
            distance(current[1], current[2]),
            distance(current[2], current[0])
        ];
        const longest = Math.max(...edgeLengths);
        if (getTriangleArea(current) <= targetArea && longest <= maxLongitudinalEdge) {
            completed.push(current);
            continue;
        }

        const edgeIndex = edgeLengths.indexOf(longest);
        const edgeStart = current[edgeIndex];
        const edgeEnd = current[(edgeIndex + 1) % 3];
        const opposite = current[(edgeIndex + 2) % 3];
        const midpoint = [
            (edgeStart[0] + edgeEnd[0]) / 2,
            (edgeStart[1] + edgeEnd[1]) / 2
        ];
        pending.push([edgeStart, midpoint, opposite], [midpoint, edgeEnd, opposite]);
        if (pending.length + completed.length > MAX_TRIANGLES_PER_REGION) break;
    }

    return completed.concat(pending);
}

function createTriangleMesh(points, region) {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array(points.flatMap(([x, y]) => [x, y, 0]));
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices.length), 3));

    const material = new THREE.MeshBasicMaterial({
        wireframe: true,
        vertexColors: true,
        side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.concShape = region.shape;
    mesh.userData.sectionShape = region.shape;
    mesh.userData.material = region.material;
    mesh.userData.priority = region.priority;
    return mesh;
}

function normalizeRing(points) {
    const ring = [];
    for (const point of points ?? []) {
        const next = [Number(point.x ?? point[0]), Number(point.y ?? point[1])];
        if (!Number.isFinite(next[0]) || !Number.isFinite(next[1])) continue;
        const previous = ring.at(-1);
        if (!previous || distance(previous, next) > GEOMETRY_EPSILON) ring.push(next);
    }
    if (ring.length && distance(ring[0], ring.at(-1)) > GEOMETRY_EPSILON) ring.push([...ring[0]]);
    return ring;
}

function openRing(ring) {
    const normalized = normalizeRing(ring);
    return normalized.length > 1 ? normalized.slice(0, -1) : normalized;
}

function getTriangleArea([[x1, y1], [x2, y2], [x3, y3]]) {
    return Math.abs((x1 * y2 + x2 * y3 + x3 * y1) - (y1 * x2 + y2 * x3 + y3 * x1)) / 2;
}

function getTriangleCentroid([[x1, y1], [x2, y2], [x3, y3]]) {
    return { x: (x1 + x2 + x3) / 3, y: (y1 + y2 + y3) / 3 };
}

function distance([x1, y1], [x2, y2]) {
    return Math.hypot(x2 - x1, y2 - y1);
}

function positiveFinite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}
