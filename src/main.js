import './style.css';
import * as THREE from 'three';
import { toggleMaterialsAndShapesDiv, toggleShapeButtons } from './materialsandShapes.js';
import { populateMaterialDropdown, updateChartAndTable, addUserDefinedRow, saveUserDefinedMaterial, populateRebarDropdown } from './materialsPlotting.js';



const scene = new THREE.Scene()
console.log(scene)

// Attach the function to the global window object
window.toggleMaterialsAndShapes = toggleMaterialsAndShapesDiv;
document.addEventListener("DOMContentLoaded", () => {
  toggleShapeButtons();
  populateMaterialDropdown();
   // Call this function after populating default materials initially
   populateRebarDropdown();

  document.getElementById("materialDropdown").addEventListener("change", updateChartAndTable);
  document.getElementById("addRow").addEventListener("click", addUserDefinedRow);
  document.getElementById("saveMaterial").addEventListener("click", saveUserDefinedMaterial);
});
