import './style.css'
import * as THREE from 'three';
import { toggleMaterialsAndShapesDiv } from './materialsandShapes.js';



const scene = new THREE.Scene()
console.log(scene)

// Attach the function to the global window object
window.toggleMaterialsAndShapes = toggleMaterialsAndShapesDiv;
