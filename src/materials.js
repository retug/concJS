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
  ];