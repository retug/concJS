import { camera, renderer, scene } from "./main.js"; 
import * as THREE from 'three';
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js';
import { SelectionHelper } from 'three/examples/jsm/interactive/SelectionHelper.js';


export function resizeThreeJsScene() {
    const concGui = document.getElementById('concGui');
    const canvas = document.querySelector('canvas');

    if (!concGui || !canvas) return;

    // Get new size
    const newWidth = concGui.clientWidth;
    const newHeight = concGui.clientHeight;

    // Update the renderer
    renderer.setSize(newWidth, newHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Force the canvas to match the new size
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;

    // Adjust camera aspect ratio
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
}

export function setupDragAndAnalyze() {
    const concGui = document.getElementById("concGui");
    const results = document.getElementById("results");
    const dragBar = document.getElementById("drag-bar");
    const analyzeButton = document.getElementById("analyze-button");
    const middleColumn = document.getElementById("middleColumn");

    let isDragging = false;

    // Ensure middleColumn has full height
    middleColumn.style.display = "flex";
    middleColumn.style.flexDirection = "column";
    middleColumn.style.height = "100%";

    // Set initial height percentages
    concGui.style.flex = "1"; // Takes 50% of the available space
    results.style.flex = "1"; // Takes 50% of the available space

    // Drag functionality
    dragBar.addEventListener("mousedown", (e) => {
        isDragging = true;
        document.body.style.cursor = "row-resize";
    });

    document.addEventListener("mousemove", (e) => {
        if (!isDragging) return;

        const middleColumnHeight = middleColumn.clientHeight;
        const offset = e.clientY - middleColumn.getBoundingClientRect().top;

        // Ensure valid heights (at least 50px each)
        const concHeightRatio = Math.max(50, offset) / middleColumnHeight;
        const resultsHeightRatio = Math.max(50, middleColumnHeight - offset - dragBar.clientHeight) / middleColumnHeight;

        // Set heights as flex ratios
        concGui.style.flex = concHeightRatio;
        results.style.flex = resultsHeightRatio;

        // Resize Three.js scene
        resizeThreeJsScene();
    });

    document.addEventListener("mouseup", () => {
        isDragging = false;
        document.body.style.cursor = "default";
    });

    // Hide results functionality
    analyzeButton.addEventListener("click", () => {
        if (results.style.display === "none") {
            // Show results
            results.style.display = "block";
            dragBar.style.display = "block";
            concGui.style.flex = "1";
            results.style.flex = "1";
            analyzeButton.textContent = "Analyze Shape";
        } else {
            // Hide results
            results.style.display = "none";
            dragBar.style.display = "none";
            concGui.style.flex = "1.9"; // Take full space
            analyzeButton.textContent = "Show Results";
        }

        // Resize Three.js scene
        resizeThreeJsScene();
    });
}


// A dictionary that given bar size, returns bar diameter
export const rebarDia = {
    3: 0.375,
    4: 0.5,
    5: 0.625,
    6: 0.75,
    7: 0.875,
    8: 1.0,
    9: 1.128,
    10: 1.27,
    11: 1.41,
    14: 1.693,
    18: 2.257
};



// Function to add a simple point at given (x, y) coordinates
export function addRebar(x, y, barSize, scene, sprite) {
    
    if (!(barSize in rebarDia)) {
        console.error("Invalid rebar size:", barSize);
        return;
    }

    // Create rebar geometry
    const tempDotGeo = new THREE.BufferGeometry();
    tempDotGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, 0], 3));
 
    const selectedDotMaterial = new THREE.PointsMaterial({ size: rebarDia[barSize], map: sprite, transparent: true, color: 'blue'});

    // Create the rebar point
    const tempDot = new THREE.Points(tempDotGeo, selectedDotMaterial);
    tempDot.isRebar = true;
    tempDot.rebarSize = barSize;

    // Add to the Three.js scene
    scene.add(tempDot);

    console.log("Rebar point added to scene:", tempDot);
}


export function setupMouseTracking(threeJSDiv, plane, intersectionPoint) {
    const mouse = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    threeJSDiv.addEventListener("mousemove", (event) => {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;

        // Update the raycaster
        raycaster.setFromCamera(mouse, camera);

        // Check for intersection with the plane
        const intersects = raycaster.intersectObject(plane);

        if (intersects.length > 0) {
            const intersectPoint = intersects[0].point;

            // Update the position of the intersection point and make it visible
            intersectionPoint.position.copy(intersectPoint);
            intersectionPoint.visible = true;

            // Update the displayed X and Y values
            const X = document.getElementById("xVal");
            const Y = document.getElementById("yVal");
            if (X && Y) {
                X.innerHTML = intersectPoint.x.toFixed(2);
                Y.innerHTML = intersectPoint.y.toFixed(2);
            }
        } else {
            // Hide the point if there's no intersection
            intersectionPoint.visible = false;
        }
    });
}

export function setupMouseInteractions(threeJSDiv) {
    
    const mouse = new THREE.Vector2();
    let middlemouse = 0;

    // SelectionBox
    const selectionBox = new SelectionBox(camera, scene);
    const helper = new SelectionHelper(renderer, "selectBox");

    // Selection Box Styling
    const selectionBoxDiv = document.createElement("div");


    document.body.appendChild(selectionBoxDiv);


    // Handle selection box events
    let isSelecting = false;

    threeJSDiv.addEventListener("pointerdown", function (event) {
        if (event.button === 0) {
            const rect = renderer.domElement.getBoundingClientRect();
            // Normalize mouse coordinates within concGui
            mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;
                
            console.log(`X: ${mouse.x}, Y: ${mouse.y}`);
    
            isSelecting = true;
            selectionBox.startPoint.set(mouse.x-1, mouse.y, 0.5);
        }
    });
    
    threeJSDiv.addEventListener("pointermove", function (event) {
        if (isSelecting) {
            const rect = renderer.domElement.getBoundingClientRect();
            // Normalize mouse coordinates within concGui
            mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;
            console.log(`Pointer Move - X: ${mouse.x}, Y: ${mouse.y}`);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
        }
    });

    threeJSDiv.addEventListener("pointerup", function (event) {
        const rect = renderer.domElement.getBoundingClientRect();
        // Normalize mouse coordinates within concGui
        mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;
    
        console.log(`Pointer Up - X: ${mouse.x}, Y: ${mouse.y}`);
    
        selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
        isSelecting = false;
    });
}
