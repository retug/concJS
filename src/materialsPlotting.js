import { StructuralMaterial, defaultMaterials } from "./materials.js";
import Chart from 'chart.js/auto';

// Function to populate the material dropdown
export function populateMaterialDropdown() {
  const materialDropdown = document.getElementById("materialDropdown");
  materialDropdown.innerHTML = '<option disabled selected>Select a material</option>';
  
  defaultMaterials.forEach((material) => {
    const option = document.createElement("option");
    option.value = material.name;
    option.textContent = material.name;
    materialDropdown.appendChild(option);
  });

  const customOption = document.createElement("option");
  customOption.value = "Custom Material";
  customOption.textContent = "Custom Material";
  materialDropdown.appendChild(customOption);
}

// Function to populate rebar and concrete material dropdowns with prioritized materials
export function populateRebarDropdown() {
    const rebarDropdown = document.getElementById("rebar_mat");
    const concDropdown = document.getElementById("concrete_mat");

    rebarDropdown.innerHTML = ""; // Clear existing options
    concDropdown.innerHTML = ""; // Clear existing options

    // Sort materials so the priority type appears first
    const sortedRebarMaterials = [
        ...defaultMaterials.filter(material => material.type === "steel"), // Steel first
        ...defaultMaterials.filter(material => material.type !== "steel")  // Then others
    ];

    const sortedConcreteMaterials = [
        ...defaultMaterials.filter(material => material.type === "concrete"), // Concrete first
        ...defaultMaterials.filter(material => material.type !== "concrete")  // Then others
    ];

    // Populate rebar dropdown
    sortedRebarMaterials.forEach((material) => {
        const rebarOption = document.createElement("option");
        rebarOption.value = material.name;
        rebarOption.textContent = material.name;
        rebarDropdown.appendChild(rebarOption);
    });

    // Populate concrete dropdown
    sortedConcreteMaterials.forEach((material) => {
        const concOption = document.createElement("option");
        concOption.value = material.name;
        concOption.textContent = material.name;
        concDropdown.appendChild(concOption);
    });
}
  
 

// Initialize chart
const ctx = document.getElementById("stressStrainChart").getContext("2d");
export let stressStrainChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [{
      label: "Stress vs. Strain",
      data: [],
      borderWidth: 2,
      borderColor: "orange",
    }],
  },
  options: {
    responsive: true,
    scales: {
        x: {
          title: { display: true, text: "Strain" },
          type: 'linear',
        },

      y: { title: { display: true, text: "Stress (psi)" } },
    },
  },
});

// Function to update chart and table based on selected material
export function updateChartAndTable(event) {
  const selectedMaterialName = event.target.value;
  const selectedMaterial = defaultMaterials.find(material => material.name === selectedMaterialName);
  const userDefinedInputs = document.getElementById("userDefinedInputs");

  if (selectedMaterialName === "Custom Material") {
    userDefinedInputs.style.display = "block";
  } else {
    userDefinedInputs.style.display = "none";
    if (selectedMaterial) {
      stressStrainChart.data.labels = selectedMaterial.strainData;
      stressStrainChart.data.datasets[0].data = selectedMaterial.stressData;
      stressStrainChart.update();

      const tableBody = document.getElementById("stressStrainTable").querySelector("tbody");
      tableBody.innerHTML = "";
      selectedMaterial.strainData.forEach((strain, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `<td>${strain}</td><td>${selectedMaterial.stressData[index]}</td>`;
        tableBody.appendChild(row);
      });
    }
  }
}

// Function to add a row to the user-defined stress-strain table
export function addUserDefinedRow() {
  const newRow = document.createElement("tr");
  newRow.innerHTML = `
    <td><input type="number" step="0.0001" class="strainInput" /></td>
    <td><input type="number" step="0.01" class="stressInput" /></td>
    <td><button class="removeRow">Remove</button></td>
  `;
  newRow.querySelector(".removeRow").addEventListener("click", () => newRow.remove());
  document.getElementById("userStressStrainTable").querySelector("tbody").appendChild(newRow);
}

// Update rebar dropdown whenever a new material is added
export function saveUserDefinedMaterial() {
    const materialName = document.getElementById("materialName").value.trim();
    const expectedStrength = document.getElementById("expectedStrength").checked ? "expected" : "normal";
    const strainData = Array.from(document.querySelectorAll(".strainInput")).map(input => parseFloat(input.value));
    const stressData = Array.from(document.querySelectorAll(".stressInput")).map(input => parseFloat(input.value));

    if (!materialName || strainData.length === 0 || stressData.length === 0) {
        alert("Please fill in all fields and add at least one row of data.");
        return;
    }

    // Check if material already exists in the defaultMaterials list
    const isDuplicate = defaultMaterials.some(material => material.name === materialName);
    if (isDuplicate) {
        alert(`Material "${materialName}" already exists. Please choose a different name.`);
        return;
    }

    try {
        // Attempt to create a new StructuralMaterial instance
        const newMaterial = new StructuralMaterial(materialName, "other", expectedStrength, stressData, strainData);
        defaultMaterials.push(newMaterial);

        // Update the material dropdown
        const materialDropdown = document.getElementById("materialDropdown");
        const customOption = materialDropdown.querySelector("option[value='Custom Material']");
        const option = document.createElement("option");
        option.value = newMaterial.name;
        option.textContent = newMaterial.name;
        materialDropdown.insertBefore(option, customOption);

        alert(`New material "${materialName}" added successfully!`);

        // Clear inputs
        document.getElementById("materialName").value = "";
        document.getElementById("userStressStrainTable").querySelector("tbody").innerHTML = "";

        // Update rebar material dropdown
        populateRebarDropdown();
    } catch (error) {
        // Catch and alert user if strain data is not in increasing order
        if (error.message === "Strain data must be input from smallest to largest.") {
            alert("Error: Strain data must be input from smallest to largest.");
        } else {
            alert(`An unexpected error occurred: ${error.message}`);
        }
    }
}

export function updateStressStrainChart(materialData) {
  if (!materialData) {
      console.warn("No material data found for this object.");
      return;
  }

  // Update chart with material's stress-strain data
  stressStrainChart.data.labels = materialData.strainData;
  stressStrainChart.data.datasets[0].data = materialData.stressData;
  stressStrainChart.update();

  // Clear previous selected point (if any)
  plotSelectedPoint(null); // Clears the previously plotted highlight
}

export function plotSelectedPoint(clickedObject,strainProfileIndex, angle) {
  if (!clickedObject) {
      // Clear the previous point
      stressStrainChart.data.datasets[1] = { data: [] }; 
      stressStrainChart.update();
      return;
  }

  let strain, stress, selectedColor;

  if (clickedObject.userData.concShape) {
      // Get strain and stress for concrete
      let concreteMat = clickedObject.userData.concShape.material;
      let transformed = clickedObject.transformedCentroid[angle];


      // ✅ Extract strain profile using the given index
      let strainProfile = clickedObject.userData.concShape.strainProfiles[angle][strainProfileIndex];


      strain = strainProfile[0] * transformed.v + strainProfile[1];
      stress = concreteMat.stress(strain);
      // Extract color from mesh material
      // ✅ Extract color from mesh geometry attributes
      const colorAttribute = clickedObject.geometry.getAttribute("color");
      if (colorAttribute) {
          // Get first vertex color (assuming uniform coloring)
          selectedColor = `rgb(
              ${Math.round(colorAttribute.array[0] * 255)}, 
              ${Math.round(colorAttribute.array[1] * 255)}, 
              ${Math.round(colorAttribute.array[2] * 255)}
          )`;
      } else {
          console.warn("⚠️ No color attribute found in mesh, defaulting to gray.");
          selectedColor = "gray"; // Default fallback
      }
      console.log("YOUR SELECTED CONC COLOR")
      console.log(selectedColor)

      // ✅ Update the material dropdown based on selected object
      updateMaterialDropdown(clickedObject);
  } else if (clickedObject.materialData) {
      // ✅ Get rebar material
      let rebarMat = clickedObject.materialData;

      // ✅ Retrieve the transformed centroid for the clicked rebar
      let transformed = clickedObject.transformedCentroid[angle];

      if (!transformed) {
          console.warn(`⚠️ No transformed coordinates for rebar element at angle ${angle}`);
          return;
      }

      // ✅ Find the ConcShape that owns this rebar object
      let parentConcShape = findConcShapeForRebar(clickedObject);
      if (!parentConcShape) {
          console.error("❌ Could not find the parent ConcShape for the selected rebar.");
          return;
      }

      // ✅ Extract strain profile using the given index
      let strainProfile = parentConcShape.strainProfiles[angle][strainProfileIndex];

      if (!strainProfile) {
          console.error(`❌ No strain profile found for angle ${angle} and index ${strainProfileIndex}`);
          return;
      }

      // ✅ Update the material dropdown based on selected object
      updateMaterialDropdown(clickedObject);

      // ✅ Compute strain using the selected strain profile
      strain = strainProfile[0] * transformed.v + strainProfile[1];

      // ✅ Compute stress using rebar material
      stress = rebarMat.stress(strain);
      // Extract color from rebar material
      selectedColor = `rgb(${clickedObject.material.color.r * 255}, ${clickedObject.material.color.g * 255}, ${clickedObject.material.color.b * 255})`;

      console.log("YOUR SELECTED REBAR COLOR")
      console.log(selectedColor)
  }

    function findConcShapeForRebar(rebarObject) {
      for (let concShape of allConcShapes) {  // 🔹 `allConcShapes` should contain all instances of ConcShape
          if (concShape.rebarObjects.includes(rebarObject)) {
              return concShape;
          }
      }
      return null;  // ❌ No matching ConcShape found
  }

  // ✅ Plot the selected stress-strain point on the chart
  stressStrainChart.data.datasets[1] = {
      label: "Selected Point",
      data: [{ x: strain, y: stress }],
      backgroundColor: selectedColor,
      borderColor: selectedColor,
      pointRadius: 6
  };

  stressStrainChart.update();
}


function updateMaterialDropdown(clickedObject) {
  const materialDropdown = document.getElementById("materialDropdown");

  if (!materialDropdown) {
      console.error("❌ Material dropdown not found!");
      return;
  }

  let selectedMaterial = null;

  if (clickedObject.userData.concShape) {
      // ✅ Concrete Mesh selected
      selectedMaterial = clickedObject.userData.concShape.material;
  } else if (clickedObject.materialData) {
      // ✅ Rebar selected
      selectedMaterial = clickedObject.materialData;
  } else {
      console.warn("⚠️ No valid material found for the selected object.");
      return;
  }

  // ✅ Update the dropdown to match the selected material
  for (let option of materialDropdown.options) {
      if (option.value === selectedMaterial.name) {
          option.selected = true;
          return;
      }
  }

  // ✅ If material isn't found in the dropdown, select "Custom Material"
  materialDropdown.value = "Custom Material";
}
