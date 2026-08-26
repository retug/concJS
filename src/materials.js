//This file contains the main class "Structural Material" for the whole project
//Constructor requires a name, normal or expected, stress Data, strain Data

export const ACI_CONCRETE_STRESS_FACTOR = 0.85;

export class StructuralMaterial {
    constructor(name, type, n_or_e, stressData, strainData, compressiveStrengthACI = null) {
      if (!["concrete", "steel", "other"].includes(type)) {
        throw new Error(
          "Invalid material type. Valid options are: 'concrete', 'steel', or 'other'."
        );
      }
      if (!["normal", "expected"].includes(n_or_e)) {
        throw new Error("Invalid, Must be normal or expected.");
      }
      if (!this.isIncreasing(strainData)) {
        throw new Error(
          "Strain data must be input from smallest to largest."
        );
      }

      const normalizedCompressiveStrength = Number(compressiveStrengthACI);
      if (
        type === "concrete"
        && (!Number.isFinite(normalizedCompressiveStrength) || normalizedCompressiveStrength <= 0)
      ) {
        throw new Error("Concrete materials require a positive f'c value in psi.");
      }
      
      this.name = name;
      this.type = type;
      this.normal_or_expected = n_or_e;
      this.strainData = strainData;
      this.stressData = stressData;
      if (type === "concrete") {
        this.compressiveStrengthACI = normalizedCompressiveStrength;
      }
    }
  
    isIncreasing(data) {
      for (let i = 1; i < data.length; i++) {
        if (data[i] < data[i - 1]) {
          return false;
        }
      }
      return true;
    }

    // ✅ Interpolates stress values based on input strain
    stress(strain) {
      const strainData = this.strainData;
      const stressData = this.stressData;

      // ✅ If strain is out of range, return 0 stress
      if (strain < strainData[0] || strain > strainData[strainData.length - 1]) {
          return 0;
      }

      // ✅ Loop through the stress-strain data and interpolate
      for (let i = 0; i < strainData.length - 1; i++) {
          if (strain >= strainData[i] && strain <= strainData[i + 1]) {
              // Linear interpolation formula
              const interpolatedStress = stressData[i] +
                  ((strain - strainData[i]) * (stressData[i + 1] - stressData[i])) / 
                  (strainData[i + 1] - strainData[i]);
              if (this.type !== "concrete") return interpolatedStress;

              const maximumCompressiveStress = -ACI_CONCRETE_STRESS_FACTOR
                * this.compressiveStrengthACI;
              return Math.max(interpolatedStress, maximumCompressiveStress);
          }
      }

      return 0; // Should never reach here
  }
  }

export const A992_GRADE_50_MATERIAL_NAME = "A992 Grade 50";
export const DEFAULT_PLATED_CORE_STEEL_NAME = A992_GRADE_50_MATERIAL_NAME;

export function getACICompressiveStressGuide(material) {
  if (
    material?.type !== "concrete"
    || !Number.isFinite(material.compressiveStrengthACI)
    || material.compressiveStrengthACI <= 0
  ) {
    return null;
  }

  const strainData = material.strainData ?? [];
  const stressData = material.stressData ?? [];
  const limitingStress = -ACI_CONCRETE_STRESS_FACTOR * material.compressiveStrengthACI;
  const intersections = [];

  for (let index = 0; index < Math.min(strainData.length, stressData.length) - 1; index += 1) {
    const startStrain = strainData[index];
    const endStrain = strainData[index + 1];
    const startStress = stressData[index];
    const endStress = stressData[index + 1];
    const stressChange = endStress - startStress;
    if (!Number.isFinite(stressChange) || stressChange === 0) continue;

    const interpolationRatio = (limitingStress - startStress) / stressChange;
    if (interpolationRatio < 0 || interpolationRatio > 1) continue;

    const strain = startStrain + interpolationRatio * (endStrain - startStrain);
    if (Number.isFinite(strain) && strain <= 0) {
      intersections.push({ strain, descendsAsStrainIncreases: stressChange < 0 });
    }
  }

  const intersection = intersections.find(candidate => candidate.descendsAsStrainIncreases)
    ?? intersections.at(-1);
  if (!intersection || intersection.strain >= 0) return null;

  return {
    stress: limitingStress,
    intersectionStrain: intersection.strain,
    points: [
      { x: intersection.strain, y: limitingStress },
      { x: 0, y: limitingStress }
    ]
  };
}
  
  export const defaultMaterials = [
    new StructuralMaterial(
      "fc4ksi",
      "concrete",
      "normal",
      [0, -4000, -4000, 0],
      [-2, -1, -0.002, 0.],
      4000
    ),
    new StructuralMaterial(
      "fc5ksi",
      "concrete",
      "normal",
      [0, -5000, -5000, 0],
      [-2, -1, -0.002, 0.],
      5000
    ),
    new StructuralMaterial(
      "fc6ksi",
      "concrete",
      "normal",
      [0, -6000, -6000, 0],
      [-2, -1, -0.002, 0.],
      6000
    ),
    new StructuralMaterial(
      "fce4ksi",
      "concrete",
      "expected",
      [0, -5000, -5000, 0],
      [-2, -1, -0.002, 0.],
      4000
    ),
    new StructuralMaterial(
      "fy50ksi",
      "steel",
      "normal",
      [-10, -50000, -50000, -50000, 0, 50000, 50000, 50000, 10],
      [-2, -1, -0.005, -0.001725, 0, 0.001725, 0.005, 1, 2]
    ),
    new StructuralMaterial(
      "fy60ksi",
      "steel",
      "normal",
      [-10, -60000, -60000, -60000, 0, 60000, 60000, 60000, 10],
      [-2, -1, -0.005, -0.00207, 0, 0.00207, 0.005, 1, 2]
    ),
    new StructuralMaterial(
      A992_GRADE_50_MATERIAL_NAME,
      "steel",
      "normal",
      [-10, -50000, -50000, -50000, 0, 50000, 50000, 50000, 10],
      [-2, -1, -0.005, -0.001725, 0, 0.001725, 0.005, 1, 2]
    ),
    new StructuralMaterial(
      "fye75ksi",
      "steel",
      "expected",
      [-10, -75000, -75000, -60000, 0, 60000, 75000, 75000, 10],
      [-2, -1, -0.005, -0.00207, 0, 0.00207, 0.005, 1, 2]
    ),
  ];
