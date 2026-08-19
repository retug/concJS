import {
  DEFAULT_PLATED_CORE_STEEL_NAME,
  StructuralMaterial,
  defaultMaterials
} from "./materials.js";
import Chart from 'chart.js/auto';
import { resolveSectionResultPoint } from './analysis/resultSelection.js';

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
    const plateDropdown = document.getElementById("plate_mat");

    rebarDropdown.innerHTML = ""; // Clear existing options
    concDropdown.innerHTML = ""; // Clear existing options
    if (plateDropdown) plateDropdown.innerHTML = "";

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
        if (plateDropdown) {
            const plateOption = rebarOption.cloneNode(true);
            plateDropdown.appendChild(plateOption);
        }
    });

    // Populate concrete dropdown
    sortedConcreteMaterials.forEach((material) => {
        const concOption = document.createElement("option");
        concOption.value = material.name;
        concOption.textContent = material.name;
        concDropdown.appendChild(concOption);
    });
    if (defaultMaterials.some(material => material.name === 'fc5ksi')) concDropdown.value = 'fc5ksi';
    if (
      plateDropdown
      && defaultMaterials.some(material => material.name === DEFAULT_PLATED_CORE_STEEL_NAME)
    ) {
      plateDropdown.value = DEFAULT_PLATED_CORE_STEEL_NAME;
    }
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
      borderColor: "#1d4ed8",
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
  // Remove the previous highlight completely. Retaining an empty anonymous
  // dataset makes Chart.js render an "undefined" legend item.
  stressStrainChart.data.datasets.splice(1);
  stressStrainChart.update();
}

export function plotSelectedPoint(clickedObject) {
  if (!clickedObject) {
      stressStrainChart.data.datasets.splice(1);
      stressStrainChart.update();
      return;
  }

  const resolvedPoint = resolveSectionResultPoint(
    clickedObject,
    window.activeAnalysisSection
  );
  if (!resolvedPoint) {
      console.warn('No active section response was available for the selected result object.');
      stressStrainChart.data.datasets.splice(1);
      stressStrainChart.update();
      return;
  }

  let selectedColor = '#7c3aed';
  if (clickedObject.userData?.concShape) {
      const colorAttribute = clickedObject.geometry.getAttribute("color");
      if (colorAttribute) {
          selectedColor = `rgb(
              ${Math.round(colorAttribute.array[0] * 255)}, 
              ${Math.round(colorAttribute.array[1] * 255)}, 
              ${Math.round(colorAttribute.array[2] * 255)}
          )`;
      }
      updateMaterialDropdown(clickedObject);
  } else if (clickedObject.materialData) {
      updateMaterialDropdown(clickedObject);
      const { r, g, b } = clickedObject.material.color;
      selectedColor = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }

  stressStrainChart.data.datasets[1] = {
      label: "Selected Point",
      data: [{ x: resolvedPoint.strain, y: resolvedPoint.stress }],
      backgroundColor: selectedColor,
      borderColor: selectedColor,
      pointRadius: 6,
      pointHoverRadius: 7,
      showLine: false
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
      selectedMaterial = clickedObject.userData.material ?? clickedObject.userData.concShape.material;
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
