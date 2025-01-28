import './style.css'
import * as THREE from 'three';
import { toggleMaterialsAndShapesDiv, toggleShapeButtons } from './materialsandShapes.js';



const scene = new THREE.Scene()
console.log(scene)

// Attach the function to the global window object
window.toggleMaterialsAndShapes = toggleMaterialsAndShapesDiv;
// Call the function when the DOM is loaded
document.addEventListener("DOMContentLoaded", toggleShapeButtons);
