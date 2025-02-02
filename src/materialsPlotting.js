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
    const materialName = document.getElementById("materialName").value;
    const expectedStrength = document.getElementById("expectedStrength").checked ? "expected" : "normal";
    const strainData = Array.from(document.querySelectorAll(".strainInput")).map(input => parseFloat(input.value));
    const stressData = Array.from(document.querySelectorAll(".stressInput")).map(input => parseFloat(input.value));
  
    if (materialName && strainData.length && stressData.length) {
      const newMaterial = new StructuralMaterial(materialName, "other", expectedStrength, stressData, strainData);
      defaultMaterials.push(newMaterial);
      
      const materialDropdown = document.getElementById("materialDropdown");
      const customOption = materialDropdown.querySelector("option[value='Custom Material']");
      const option = document.createElement("option");
      option.value = newMaterial.name;
      option.textContent = newMaterial.name;
      materialDropdown.insertBefore(option, customOption);
      
      alert("New material added successfully!");
      
      // Clear inputs
      document.getElementById("materialName").value = "";
      document.getElementById("userStressStrainTable").querySelector("tbody").innerHTML = "";
  
      // Update rebar material dropdown
      populateRebarDropdown();
    } else {
      alert("Please fill in all fields and add at least one row of data.");
    }
  }
