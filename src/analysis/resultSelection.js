export function resolveSectionResultPoint(clickedObject, analysisSection) {
  const angle = Number(analysisSection?.currentResponseAngle);
  const strainProfile = analysisSection?.currentStrainProfile;
  if (!clickedObject || !Number.isFinite(angle) || !Array.isArray(strainProfile)) {
    return null;
  }

  const transformed = clickedObject.transformedCentroid?.[angle];
  if (!transformed || !Number.isFinite(transformed.v)) return null;

  const material = clickedObject.materialData
    ?? clickedObject.userData?.material
    ?? clickedObject.userData?.concShape?.material;
  if (!material || typeof material.stress !== 'function') return null;

  const strain = strainProfile[0] * transformed.v + strainProfile[1];
  return {
    angle,
    strain,
    stress: material.stress(strain),
    material
  };
}
