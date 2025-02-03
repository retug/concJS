// This is a file to contain all functionality for material defintions and shape defintions.
// Materials are a class contained in _______
// Shapes are a function to create a _______ base class.

import { ConcShape } from './concShape.js'; // Adjust path as needed
import * as THREE from 'three';
import { defaultMaterials } from "./materials.js";


export function toggleMaterialsAndShapesDiv() {
    const materialsAndShapes = document.getElementById('materialsandShapes');
    const button = document.querySelector('.toggle-button');
    const closedContainer = document.getElementById('materialsandShapesClosed');
    const expandedContainer = document.getElementById('materialsandShapesExpanded');

    if (shapeContent.style.display === 'none') {
        // Show content and reset width
        shapeContent.style.display = 'block';
        materialsAndShapes.style.width = '16.666%'; // Reset to default width
        button.innerHTML = '&#xab;'; // Left-pointing double arrow
        button.setAttribute('data-tooltip', 'Close materials and shapes');

        // Move button back to expanded container
        expandedContainer.appendChild(button);
        button.style.position = 'static'; // Reset button position
    } else {
        // Hide content and shrink the container
        shapeContent.style.display = 'none';
        materialsAndShapes.style.width = '0'; // Collapse width
        materialsAndShapes.style.overflow = 'hidden'; // Hide overflow

        // Move button to the closed container
        closedContainer.appendChild(button);
        button.style.position = 'absolute'; // Keep button positioned
        button.style.top = '10px'; // Set distance from the top
        button.style.right = '10px'; // Set distance from the right
        button.innerHTML = '&#xbb;'; // Right-pointing double arrow
        button.setAttribute('data-tooltip', 'Show materials and shapes');
    }
}

export function toggleShapeButtons() {
    const rectangleButton = document.getElementById("rectangleButton");
    const barbellButton = document.getElementById("barbellButton");
  
    rectangleButton.addEventListener("click", () => {
      rectangleButton.classList.add("active");
      barbellButton.classList.remove("active");
    });
  
    barbellButton.addEventListener("click", () => {
      barbellButton.classList.add("active");
      rectangleButton.classList.remove("active");
    });
}

// Function to check which button is active
export function getActiveShape() {
    if (document.getElementById('rectangleButton').classList.contains('active')) {
        return 'rectangle';
    } else if (document.getElementById('barbellButton').classList.contains('active')) {
        return 'barbell';
    }
    return null;
}

// Function to create a rectangle shape from length and width
export function createRectangleShape(length, width) {
    return [
        new THREE.Vector2(-length / 2, -width / 2),
        new THREE.Vector2(length / 2, -width / 2),
        new THREE.Vector2(length / 2, width / 2),
        new THREE.Vector2(-length / 2, width / 2),
        new THREE.Vector2(-length / 2, -width / 2) // Close the shape
    ];
}

export function addShapeToScene(scene) {  // Accept scene as a parameter
    const activeShape = getActiveShape();
    if (!activeShape) {
        console.warn('No active shape selected');
        return;
    }

    const length = parseFloat(document.getElementById('length_input').value);
    const width = parseFloat(document.getElementById('width_input').value);
    if (isNaN(length) || isNaN(width) || length <= 0 || width <= 0) {
        console.warn('Invalid length or width');
        return;
    }

    // Get the selected concrete material
    const materialNameConc = document.getElementById("concrete_mat").value;
    const selectedMaterialConc = defaultMaterials.find(material => material.name === materialNameConc);

    if (!selectedMaterialConc) {
        console.warn(`Material "${materialName}" not found in default materials.`);
        return;
    }

    // Get the selected rebar material
    const materialNameRebar = document.getElementById("rebar_mat").value;
    const selectedMaterialRebar = defaultMaterials.find(material => material.name === materialNameRebar);
    console.log(selectedMaterialRebar)
    if (!selectedMaterialRebar) {
        console.warn(`Material "${materialName}" not found in default materials.`);
        return;
    }


    let concShape;
    if (activeShape === 'rectangle') {
        const points = createRectangleShape(length, width);
        concShape = new ConcShape(points, selectedMaterialConc);
    } else {
        console.warn('Only rectangle shape is currently implemented');
        return;
    }

    concShape.generateMesh();
    scene.add(concShape.mesh);  // Use the passed scene
    console.log(concShape)
}

