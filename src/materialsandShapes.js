// This is a file to contain all functionality for material defintions and shape defintions.
// Materials are a class contained in materials.js
// Shapes are a function to create a concShape base class, found in file concShape.js

import { ConcShape } from './concShape.js'; // Adjust path as needed
import * as THREE from 'three';
import { defaultMaterials } from "./materials.js";
import { resizeThreeJsScene, setupDragAndAnalyze } from "./threeJSscenefunctions.js";
import { addRebar } from './threeJSscenefunctions.js';


export function toggleMaterialsAndShapesDiv() {
    const materialsAndShapes = document.getElementById('materialsandShapes');
    const userResults = document.getElementById('userResults');
    const middleColumn = document.getElementById('middleColumn');
    const shapeContent = document.getElementById('shapeContent');
    const button = document.querySelector('.toggle-button');
    const closedContainer = document.getElementById('materialsandShapesClosed');
    const expandedContainer = document.getElementById('materialsandShapesExpanded');

    if (shapeContent.style.display === 'none') {
        // Reopen: Reset width to exactly 16.667%
        shapeContent.style.display = 'block';
        materialsAndShapes.style.width = '16.667%';
        materialsAndShapes.style.flex = '0 0 16.667%'; // Prevent flex from overriding width
        middleColumn.style.flexGrow = '1'; // Reset to normal
        button.innerHTML = '&#xab;'; 
        button.setAttribute('data-tooltip', 'Close materials and shapes');

        expandedContainer.appendChild(button);
        button.style.position = 'static'; 
    } else {
        // Close: Collapse `#materialsandShapes`
        shapeContent.style.display = 'none';
        materialsAndShapes.style.width = '0';
        materialsAndShapes.style.flex = '0 0 0';
        materialsAndShapes.style.overflow = 'hidden';
        userResults.style.width = '16.667%';
        userResults.style.flex = '0 0 16.667%'; // Prevent flex from overriding width
        middleColumn.style.width = '66.667%';
        middleColumn.style.flex = '0 0 66.667%'; // Prevent flex from overriding width
        middleColumn.style.flexGrow = '1'; // Prevent excessive expansion

        closedContainer.appendChild(button);
        button.style.position = 'absolute';
        button.style.top = '10px';
        button.style.right = '10px';
        button.innerHTML = '&#xbb;';
        button.setAttribute('data-tooltip', 'Show materials and shapes');
    }

    // Resize Three.js scene
    setTimeout(resizeThreeJsScene, 100);
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
        new THREE.Vector2(-width / 2, -length / 2),
        new THREE.Vector2(width / 2, -length / 2),
        new THREE.Vector2(width / 2, length / 2),
        new THREE.Vector2(-width / 2, length / 2),
        new THREE.Vector2(-width / 2, -length / 2) // Close the shape
    ];
}

// export function addShapeToScene(scene) {  // Accept scene as a parameter
//     const activeShape = getActiveShape();
//     if (!activeShape) {
//         console.warn('No active shape selected');
//         return;
//     }

//     const length = parseFloat(document.getElementById('length_input').value);
//     const width = parseFloat(document.getElementById('width_input').value);
//     if (isNaN(length) || isNaN(width) || length <= 0 || width <= 0) {
//         console.warn('Invalid length or width');
//         return;
//     }

//     // Get the selected concrete material
//     const materialNameConc = document.getElementById("concrete_mat").value;
//     const selectedMaterialConc = defaultMaterials.find(material => material.name === materialNameConc);

//     if (!selectedMaterialConc) {
//         console.warn(`Material "${materialName}" not found in default materials.`);
//         return;
//     }

//     // Get the selected rebar material
//     const materialNameRebar = document.getElementById("rebar_mat").value;
//     const selectedMaterialRebar = defaultMaterials.find(material => material.name === materialNameRebar);
//     console.log(selectedMaterialRebar)
//     if (!selectedMaterialRebar) {
//         console.warn(`Material "${materialName}" not found in default materials.`);
//         return;
//     }


//     let concShape;
//     if (activeShape === 'rectangle') {
//         const points = createRectangleShape(length, width);
//         concShape = new ConcShape(points, selectedMaterialConc);
//     } else {
//         console.warn('Only rectangle shape is currently implemented');
//         return;
//     }

//     concShape.generateMesh();
//     scene.add(concShape.mesh);  // Use the passed scene
//     console.log(concShape)

//     addEvenlySpacedPoints(concShape, 4, offset, scene, sprite)
// }

export function addShapeToScene(scene, sprite) { // Accept sprite as a parameter
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

    // Get the segment count (number of rebars) from input
    const segmentCount = parseInt(document.getElementById('rebar_quantity').value);
    if (isNaN(segmentCount) || segmentCount < 1) {
        console.warn('Invalid rebar quantity');
        return;
    }

    // Get the selected concrete material
    const materialNameConc = document.getElementById("concrete_mat").value;
    const selectedMaterialConc = defaultMaterials.find(material => material.name === materialNameConc);

    if (!selectedMaterialConc) {
        console.warn(`Material "${materialNameConc}" not found in default materials.`);
        return;
    }

    // Get the selected rebar material
    const materialNameRebar = document.getElementById("rebar_mat").value;
    const selectedMaterialRebar = defaultMaterials.find(material => material.name === materialNameRebar);

    if (!selectedMaterialRebar) {
        console.warn(`Material "${materialNameRebar}" not found in default materials.`);
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
    scene.add(concShape.mesh);

    console.log("Concrete shape added:", concShape);

    // Call addEvenlySpacedPoints with the segment count from input
    addEvenlySpacedPoints(concShape.baseshape, segmentCount, 0, scene, sprite);
}



// Function to create evenly spaced rebar points around the shape
export function addEvenlySpacedPoints(shape, segmentCount, offset = 0, scene, sprite) {
    if (!shape || !sprite) {
        console.error("Invalid shape or texture (sprite) missing.");
        return;
    }

    const path = new THREE.Path(shape.getPoints());
    console.log("Path points:", path);

    const totalLength = path.getLength();
    const segmentLength = totalLength / segmentCount;
    const points = [];

    for (let i = 0; i <= segmentCount; i++) {
        const u = i / segmentCount;
        const point = path.getPointAt(u);

        if (!point) continue;  // Ensure point exists

        // Compute normal at the point for offsetting
        const tangent = path.getTangentAt(u);
        const normal = new THREE.Vector2(-tangent.y, tangent.x).normalize();

        // Offset the point
        const offsetPoint = new THREE.Vector2(
            point.x + normal.x * offset,
            point.y + normal.y * offset
        );

        points.push(offsetPoint);

        // Add rebar at the computed point
        addRebar(offsetPoint.x, offsetPoint.y, '18', scene, sprite);
    }

    console.log("Rebar points added:", points);
}

