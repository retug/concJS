export function isEditablePolygonMesh(object) {
  const sectionShape = object?.userData?.sectionShape
    ?? object?.userData?.concShape;
  return object?.isMesh === true && sectionShape?.mesh === object;
}

export function removeEditablePolygonMeshes(scene) {
  const editableMeshes = [...(scene?.children ?? [])].filter(isEditablePolygonMesh);
  for (const mesh of editableMeshes) scene.remove(mesh);
  return editableMeshes;
}

export function getAnalysisRaycastTargets(section) {
  return [
    ...(section?.FEMmesh ?? []),
    ...(section?.rebarObjects ?? [])
  ].filter(object => object?.visible !== false);
}
