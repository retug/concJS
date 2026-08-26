export const CONCRETE_MATERIAL_TIE_DISTANCE = 1;

function elementMaterial(element) {
    return element?.userData?.material
        ?? element?.userData?.concShape?.material
        ?? null;
}

function materialStrength(material) {
    const stresses = Array.isArray(material?.stressData)
        ? material.stressData.filter(Number.isFinite)
        : [];
    return stresses.length ? Math.max(...stresses.map(Math.abs)) : 0;
}

function rebarCentroid(rebar) {
    const position = rebar?.geometry?.attributes?.position?.array;
    const x = Number(position?.[0]);
    const y = Number(position?.[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Select the concrete material represented by the nearest FEM centroid.
 * Materials whose nearest centroids are within one inch of the closest
 * centroid are treated as tied, with the strongest stress-strain curve
 * governing the tie.
 */
export function findRebarConcreteMaterial(
    rebar,
    elements,
    tieDistance = CONCRETE_MATERIAL_TIE_DISTANCE
) {
    const centroid = rebarCentroid(rebar);
    if (!centroid) return null;

    const nearestByMaterial = new Map();
    for (const element of elements ?? []) {
        const material = elementMaterial(element);
        // User-defined materials are stored as "other" even when assigned
        // through the concrete-material control. Only polygon steel is not
        // displaced concrete for this calculation.
        if (!material || material.type === 'steel' || typeof material.stress !== 'function') continue;

        const x = Number(element?.centroid?.x);
        const y = Number(element?.centroid?.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

        const distance = Math.hypot(x - centroid.x, y - centroid.y);
        const current = nearestByMaterial.get(material);
        if (!current || distance < current.distance) {
            nearestByMaterial.set(material, { material, distance });
        }
    }

    const candidates = [...nearestByMaterial.values()];
    if (!candidates.length) return null;

    const closestDistance = Math.min(...candidates.map(candidate => candidate.distance));
    const tolerance = Number.isFinite(tieDistance) && tieDistance >= 0 ? tieDistance : 0;
    return candidates
        .filter(candidate => candidate.distance <= closestDistance + tolerance)
        .sort((left, right) => (
            materialStrength(right.material) - materialStrength(left.material)
            || left.distance - right.distance
        ))[0].material;
}

/** Apply the displaced-concrete correction only when the bar is in compression. */
export function calculateRebarForce(area, steelMaterial, concreteMaterial, strain) {
    const steelStress = Number(steelMaterial?.stress?.(strain));
    if (!Number.isFinite(steelStress)) return 0;

    const concreteStress = strain < 0
        ? Number(concreteMaterial?.stress?.(strain))
        : 0;
    const adjustedConcreteStress = Number.isFinite(concreteStress) ? concreteStress : 0;
    return area * (steelStress - adjustedConcreteStress);
}
