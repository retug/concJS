// This is a file to contain all functionality for material defintions and shape defintions.
// Materials are a class contained in materials.js
// Shapes are a function to create a concShape base class, found in file concShape.js

import { ConcShape } from './concShape.js'; // Adjust path as needed
import * as THREE from 'three';
import { defaultMaterials } from "./materials.js";
import { resizeThreeJsScene, setupDragAndAnalyze } from "./threeJSscenefunctions.js";
import { addRebar, rebarDia } from './threeJSscenefunctions.js';


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

//Function to Create Barbell
function createCurvedRectangleShape(length, width) {
    const curvedRectangleShape = new THREE.Shape();
  
    // Calculate radii and offsets
    const radius = length / 2;
    const halfWidth = width / 2;
  
    // Start path at the bottom-left corner of the left arc
    curvedRectangleShape.moveTo(-radius, -halfWidth);
    const centerX = length / 2 - width / 2;
  
    // Draw the left arc
    curvedRectangleShape.absarc(
      -centerX,
      0,
      width / 2,
      Math.PI / 2,
      -Math.PI / 2,
      false
    );
  
    // Draw the top line
    curvedRectangleShape.lineTo(centerX, -halfWidth);
  
    // Draw the right arc
    curvedRectangleShape.absarc(
      centerX,
      0,
      width / 2,
      -Math.PI / 2,
      Math.PI / 2,
      false
    );
  
    // Draw the bottom line
    curvedRectangleShape.lineTo(centerX, halfWidth);
    // Automatically close the path
    curvedRectangleShape.closePath();
  
    return curvedRectangleShape;
  }

// export function addShapeToScene(scene, sprite) { // Accept sprite as a parameter
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

//     // Get the segment count (number of rebars) from input
//     const segmentCount = parseInt(document.getElementById('rebar_quantity').value);
//     if (isNaN(segmentCount) || segmentCount < 1) {
//         console.warn('Invalid rebar quantity');
//         return;
//     }

//     // Get the selected concrete material
//     const materialNameConc = document.getElementById("concrete_mat").value;
//     const selectedMaterialConc = defaultMaterials.find(material => material.name === materialNameConc);

//     if (!selectedMaterialConc) {
//         console.warn(`Material "${materialNameConc}" not found in default materials.`);
//         return;
//     }

//     // Get the selected rebar material
//     const materialNameRebar = document.getElementById("rebar_mat").value;
//     const selectedMaterialRebar = defaultMaterials.find(material => material.name === materialNameRebar);

//     if (!selectedMaterialRebar) {
//         console.warn(`Material "${materialNameRebar}" not found in default materials.`);
//         return;
//     }

//     // Get the rebar offset value from input
//     const rebarOffset = parseFloat(document.getElementById('rebar_offset').value);
//     if (isNaN(rebarOffset) || rebarOffset < 0) {
//         console.warn('Invalid rebar offset, using default value 2 inches.');
//         rebarOffset = 2; // Default to 2 inches if invalid
//     }
//     const rebarSize = parseFloat(document.getElementById('rebar').value);
//     console.log(rebarSize)
//     const rebarDiameter = rebarDia[rebarSize];
//     console.log(rebarDiameter)
//     if (!rebarDiameter) {
//         console.error("Invalid rebar size:", rebarSize);
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
//     scene.add(concShape.mesh);

//     console.log("Concrete shape added:", concShape);

//     console.log("Offset Specd:", rebarOffset);
//     // Call addEvenlySpacedPoints with the segment count from input
//     addEvenlySpacedPointsAlongCurve(concShape.baseshape, segmentCount, rebarOffset, scene, sprite, rebarSize);
// }

export function addShapeToScene(scene, sprite) { 
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

    const segmentCount = parseInt(document.getElementById('rebar_quantity').value);
    if (isNaN(segmentCount) || segmentCount < 1) {
        console.warn('Invalid rebar quantity');
        return;
    }

    const materialNameConc = document.getElementById("concrete_mat").value;
    const selectedMaterialConc = defaultMaterials.find(material => material.name === materialNameConc);
    if (!selectedMaterialConc) {
        console.warn(`Material "${materialNameConc}" not found in default materials.`);
        return;
    }

    const materialNameRebar = document.getElementById("rebar_mat").value;
    const selectedMaterialRebar = defaultMaterials.find(material => material.name === materialNameRebar);
    if (!selectedMaterialRebar) {
        console.warn(`Material "${materialNameRebar}" not found in default materials.`);
        return;
    }

    let rebarOffset = parseFloat(document.getElementById('rebar_offset').value);
    if (isNaN(rebarOffset) || rebarOffset < 0) {
        console.warn('Invalid rebar offset, using default value 2 inches.');
        rebarOffset = 2;
    }

    const rebarSize = parseFloat(document.getElementById('rebar').value);
    const rebarDiameter = rebarDia[rebarSize];
    if (!rebarDiameter) {
        console.error("Invalid rebar size:", rebarSize);
        return;
    }

    let concShape;
    
    if (activeShape === 'rectangle') {
        const points = createRectangleShape(length, width);
        concShape = new ConcShape(points, selectedMaterialConc);
    } else if (activeShape === 'barbell') {
        const barbellShape = createCurvedRectangleShape(length, width);
        concShape = new ConcShape(barbellShape, selectedMaterialConc);
    } else {
        console.warn('Only rectangle and barbell shapes are currently implemented');
        return;
    }

    concShape.generateMesh();
    scene.add(concShape.mesh);
    console.log("Concrete shape added:", concShape);

    console.log("Offset Specified:", rebarOffset);

    if (activeShape === 'barbell') {
        addEvenlySpacedPointswithOffset(concShape.baseshape, segmentCount, rebarOffset, scene, sprite, rebarSize);
    } else {
        addEvenlySpacedPointsAlongCurve(concShape.baseshape, segmentCount, rebarOffset, scene, sprite, rebarSize);
    }
}




// Function to create evenly spaced rebar points around the shape
//Use this function with Bar Bells
export function addEvenlySpacedPointswithOffset(shape, segmentCount, offset = 0, scene, sprite, rebarSize) {
    if (!shape || !sprite) {
        console.error("Invalid shape or texture (sprite) missing.");
        return;
    }

    const path = new THREE.Path(shape.getPoints());
    console.log("Path points:", path);

    const totalLength = path.getLength();
    const segmentLength = totalLength / segmentCount;
    const points = [];

    for (let i = 0; i <= segmentCount-1; i++) {
        const u = (i) / segmentCount;
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
        addRebar(offsetPoint.x, offsetPoint.y, rebarSize, scene, sprite);
    }

    console.log("Rebar points added:", points);
}

// Function to create evenly spaced rebar points along an offset contour
//Use this function with Rectangles and Squares.
export function addEvenlySpacedPointsAlongCurve(baseShape, segmentCount, offset, scene, sprite, rebarSize) {
    if (!baseShape || !(baseShape instanceof THREE.Shape) || !sprite) {
        console.error("Invalid shape or missing texture (sprite). ");
        return;
    }

    // Offset the shape
    const offsetShape = OffsetContour(offset, baseShape);
    if (!offsetShape) {
        console.error("Failed to generate offset shape.");
        return;
    }
    console.log("Offset Specd:", offsetShape);


    // Create a path from the offset shape
    const path = new THREE.Path(offsetShape.getPoints());
    const totalLength = path.getLength();
    const segmentLength = totalLength / segmentCount;
    const points = [];

    for (let i = 0; i <= segmentCount - 1; i++) {
        const u = i / segmentCount;
        const point = path.getPointAt(u);
        if (!point) continue;
        points.push(point);

        // Add rebar at the computed point
        addRebar(point.x, point.y, rebarSize, scene, sprite);
    }

    console.log("Rebar points added to offset curve:", points);
}

//Given a shape, create the offset shape. Useful for Squares and Rectangles and Generating evenly
//spaced rebar across the cross section
function OffsetContour(offset, shape) {
    let points = shape.getPoints().slice(0, -1); // Exclude the last point
    console.log("your base object points are", points)
    let result = [];
    offset = new THREE.BufferAttribute(new Float32Array([offset, 0, 0]), 3);

    for (let i = 0; i < points.length; i++) {
        let v1 = new THREE.Vector2().subVectors(points[i - 1 < 0 ? points.length - 1 : i - 1], points[i]);
        let v2 = new THREE.Vector2().subVectors(points[i + 1 == points.length ? 0 : i + 1], points[i]);
        let angle = v2.angle() - v1.angle();
        let halfAngle = angle * 0.5;
  
        let hA = halfAngle;
        let tA = v2.angle() + Math.PI * 0.5;
  
        let shift = Math.tan(hA - Math.PI * 0.5);
        let shiftMatrix = new THREE.Matrix4().set(
               1, 0, 0, 0, 
          -shift, 1, 0, 0,
               0, 0, 1, 0,
               0, 0, 0, 1
        );
  
  
        let tempAngle = tA;
        let rotationMatrix = new THREE.Matrix4().set(
          Math.cos(tempAngle), -Math.sin(tempAngle), 0, 0,
          Math.sin(tempAngle),  Math.cos(tempAngle), 0, 0,
                            0,                    0, 1, 0,
                            0,                    0, 0, 1
        );
  
        let translationMatrix = new THREE.Matrix4().set(
          1, 0, 0, points[i].x,
          0, 1, 0, points[i].y,
          0, 0, 1, 0,
          0, 0, 0, 1,
        );
  
        let cloneOffset = offset.clone();

        cloneOffset.applyMatrix4(shiftMatrix);
        cloneOffset.applyMatrix4(rotationMatrix);
        cloneOffset.applyMatrix4(translationMatrix);

        result.push(new THREE.Vector2(cloneOffset.getX(0), cloneOffset.getY(0)));
      }
      result.push(result[0].clone()); // Ensure the shape is closed
      return new THREE.Shape(result); //Returns an offset shape
}

