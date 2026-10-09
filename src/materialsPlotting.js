import {
  DEFAULT_PLATED_CORE_STEEL_NAME,
  defaultMaterials,
  getACICompressiveStressGuide
} from "./materials.js";
import Chart from 'chart.js/auto';
import { resolveSectionResultPoint } from './analysis/resultSelection.js';
import {
  initializeMaterialEditor,
  openMaterialEditor,
  addMaterialEditorRow,
  saveMaterialEditor,
  updateMaterialCopyAction
} from './materialEditor.js';

const STRESS_CURVE_DATASET_ID = 'stress-curve';
const ACI_GUIDE_DATASET_ID = 'aci-compression-guide';
const SELECTED_POINT_DATASET_ID = 'selected-point';

export function populateMaterialDropdown() {
  const materialDropdown = document.getElementById("materialDropdown");
  const previousSelection = materialDropdown.value;
  materialDropdown.innerHTML = '<option disabled selected>Select a material</option>';

  defaultMaterials.forEach(material => {
    const option = document.createElement("option");
    option.value = material.name;
    option.textContent = material.name;
    materialDropdown.appendChild(option);
  });

  if (defaultMaterials.some(material => material.name === previousSelection)) {
    materialDropdown.value = previousSelection;
  }
  initializeMaterialEditor(material => {
    defaultMaterials.push(material);
    populateMaterialDropdown();
    populateRebarDropdown();
    materialDropdown.value = material.name;
    updateChartAndTable({ target: materialDropdown });
  });
  updateMaterialCopyAction();
}

export function populateRebarDropdown() {
  const rebarDropdown = document.getElementById("rebar_mat");
  const concDropdown = document.getElementById("concrete_mat");
  const plateDropdown = document.getElementById("plate_mat");
  const previousRebar = rebarDropdown.value;
  const previousConcrete = concDropdown.value;
  const previousPlate = plateDropdown?.value;

  rebarDropdown.innerHTML = "";
  concDropdown.innerHTML = "";
  if (plateDropdown) plateDropdown.innerHTML = "";

  const sortedRebarMaterials = [
    ...defaultMaterials.filter(material => material.type === "steel"),
    ...defaultMaterials.filter(material => material.type !== "steel")
  ];
  const sortedConcreteMaterials = [
    ...defaultMaterials.filter(material => material.type === "concrete"),
    ...defaultMaterials.filter(material => material.type !== "concrete")
  ];

  sortedRebarMaterials.forEach(material => {
    const rebarOption = document.createElement("option");
    rebarOption.value = material.name;
    rebarOption.textContent = material.name;
    rebarDropdown.appendChild(rebarOption);
    if (plateDropdown) plateDropdown.appendChild(rebarOption.cloneNode(true));
  });

  sortedConcreteMaterials.forEach(material => {
    const concOption = document.createElement("option");
    concOption.value = material.name;
    concOption.textContent = material.name;
    concDropdown.appendChild(concOption);
  });

  const hasMaterial = name => defaultMaterials.some(material => material.name === name);
  if (hasMaterial(previousRebar)) rebarDropdown.value = previousRebar;
  if (hasMaterial(previousConcrete)) concDropdown.value = previousConcrete;
  else if (hasMaterial('fc5ksi')) concDropdown.value = 'fc5ksi';
  if (plateDropdown && hasMaterial(previousPlate)) plateDropdown.value = previousPlate;
  else if (
    plateDropdown
    && defaultMaterials.some(material => material.name === DEFAULT_PLATED_CORE_STEEL_NAME)
  ) {
    plateDropdown.value = DEFAULT_PLATED_CORE_STEEL_NAME;
  }
}

function createStressCurveDataset(material) {
  return {
    id: STRESS_CURVE_DATASET_ID,
    label: "Stress vs. Strain",
    data: material?.stressData ?? [],
    borderWidth: 2,
    borderColor: "#1d4ed8"
  };
}

function createACIGuideDataset(material) {
  const guide = getACICompressiveStressGuide(material);
  if (!guide) return null;

  return {
    id: ACI_GUIDE_DATASET_ID,
    label: "0.85 f′c limit",
    data: guide.points,
    borderWidth: 2,
    borderColor: "#64748b",
    borderDash: [7, 5],
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    tension: 0
  };
}

function setChartMaterial(material) {
  const chartMaterialLabel = document.getElementById("chartMaterialLabel");
  if (chartMaterialLabel) {
    chartMaterialLabel.textContent = material?.name ?? "Select a material or element";
  }
  stressStrainChart.data.labels = material?.strainData ?? [];
  const guideDataset = createACIGuideDataset(material);
  stressStrainChart.data.datasets = [
    createStressCurveDataset(material),
    ...(guideDataset ? [guideDataset] : [])
  ];
}

function removeSelectedPoint() {
  stressStrainChart.data.datasets = stressStrainChart.data.datasets.filter(
    dataset => dataset.id !== SELECTED_POINT_DATASET_ID
  );
}

const ctx = document.getElementById("stressStrainChart").getContext("2d");
export let stressStrainChart = new Chart(ctx, {
  type: "line",
  data: {
    labels: [],
    datasets: [createStressCurveDataset(null)]
  },
  options: {
    responsive: true,
    scales: {
      x: {
        title: { display: true, text: "Strain" },
        type: 'linear'
      },
      y: { title: { display: true, text: "Stress (psi)" } }
    }
  }
});

export function updateChartAndTable(event) {
  const selectedMaterialName = event.target.value;
  const selectedMaterial = defaultMaterials.find(
    material => material.name === selectedMaterialName
  );
  if (selectedMaterialName === "Custom Material") {
    openMaterialEditor();
    return;
  }
  updateMaterialCopyAction();
  if (!selectedMaterial) return;

  setChartMaterial(selectedMaterial);
  stressStrainChart.update();

  const tableBody = document.getElementById("stressStrainTable").querySelector("tbody");
  tableBody.innerHTML = "";
  selectedMaterial.strainData.forEach((strain, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${strain}</td><td>${selectedMaterial.stressData[index]}</td>`;
    tableBody.appendChild(row);
  });
}

export function updateCustomConcreteStrengthVisibility() {
  const materialType = document.getElementById("materialType")?.value;
  const field = document.getElementById("compressiveStrengthACIField");
  const input = document.getElementById("compressiveStrengthACI");
  if (!field || !input) return;

  const isConcrete = materialType === "concrete";
  field.style.display = isConcrete ? "flex" : "none";
  input.required = isConcrete;
  if (!isConcrete) input.value = "";
}

export function addUserDefinedRow() {
  addMaterialEditorRow();
}

export function saveUserDefinedMaterial() {
  saveMaterialEditor();
}

export function updateStressStrainChart(materialData) {
  if (!materialData) {
    console.warn("No material data found for this object.");
    return;
  }

  setChartMaterial(materialData);
  stressStrainChart.update();
}

export function plotSelectedPoint(clickedObject) {
  if (!clickedObject) {
    removeSelectedPoint();
    stressStrainChart.update();
    return;
  }

  const resolvedPoint = resolveSectionResultPoint(
    clickedObject,
    window.activeAnalysisSection
  );
  if (!resolvedPoint) {
    console.warn('No active section response was available for the selected result object.');
    removeSelectedPoint();
    stressStrainChart.update();
    return;
  }

  const selectedColor = '#ff8c69';
  if (clickedObject.userData?.concShape) {
    updateMaterialDropdown(clickedObject);
  } else if (clickedObject.materialData) {
    updateMaterialDropdown(clickedObject);
  }

  removeSelectedPoint();
  stressStrainChart.data.datasets.push({
    id: SELECTED_POINT_DATASET_ID,
    label: "Selected Point",
    data: [{ x: resolvedPoint.strain, y: resolvedPoint.stress }],
    backgroundColor: selectedColor,
    borderColor: selectedColor,
    pointRadius: 6,
    pointHoverRadius: 7,
    showLine: false
  });

  stressStrainChart.update();
}

function updateMaterialDropdown(clickedObject) {
  const materialDropdown = document.getElementById("materialDropdown");
  if (!materialDropdown) {
    console.error("Material dropdown not found.");
    return;
  }

  let selectedMaterial = null;
  if (clickedObject.userData?.concShape) {
    selectedMaterial = clickedObject.userData.material
      ?? clickedObject.userData.concShape.material;
  } else if (clickedObject.materialData) {
    selectedMaterial = clickedObject.materialData;
  } else {
    console.warn("No valid material found for the selected object.");
    return;
  }

  for (const option of materialDropdown.options) {
    if (option.value === selectedMaterial.name) {
      option.selected = true;
      updateChartAndTable({ target: materialDropdown });
      return;
    }
  }

  materialDropdown.selectedIndex = 0;
  updateMaterialCopyAction();
}
