//This file contains the main class "Structural Material" for the whole project
//Constructor requires a name, normal or expected, stress Data, strain Data

export class StructuralMaterial {
    constructor(name, type, n_or_e, stressData, strainData) {
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
      
      this.name = name;
      this.type = type;
      this.normal_or_expected = n_or_e;
      this.strainData = strainData;
      this.stressData = stressData;
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
              return stressData[i] + 
                  ((strain - strainData[i]) * (stressData[i + 1] - stressData[i])) / 
                  (strainData[i + 1] - strainData[i]);
          }
      }

      return 0; // Should never reach here
  }
  }
  
  export const defaultMaterials = [
    new StructuralMaterial(
      "fc4ksi",
      "concrete",
      "normal",
      [0, 4000, 4000, 10, 10],
      [0, 0.002, 0.005, 0.01, 0.1]
    ),
    new StructuralMaterial(
      "fce4ksi",
      "concrete",
      "expected",
      [0, 4000, 5000, 10, 10],
      [0, 0.002, 0.005, 0.01, 0.1]
    ),
    new StructuralMaterial(
        "fy60ksi",
        "steel",
        "normal",
        [-10, -60000, -60000, -60000, 0, 60000, 60000, 60000, 10],
        [-0.02, -0.01, -0.005, -0.00207, 0, 0.00207, 0.005, 0.01, 0.02]
      ),
      new StructuralMaterial(
        "fye75ksi",
        "steel",
        "expected",
        [-10, -75000, -75000, -60000, 0, 60000, 75000, 75000, 10],
        [-0.02, -0.01, -0.005, -0.00207, 0, 0.00207, 0.005, 0.01, 0.02]
      ),
  ];