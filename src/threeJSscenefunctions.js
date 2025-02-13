import { camera, renderer, scene, getSprite } from "./main.js"; 
import * as THREE from 'three';
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js';
import { SelectionHelper } from 'three/examples/jsm/interactive/SelectionHelper.js';
import { defaultMaterials } from "./materials.js";


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



// Function to add a rebar point at (x, y) with a selected size and material
export function addRebar(x, y, barSize, scene, sprite) {
    if (!(barSize in rebarDia)) {
        console.error("Invalid rebar size:", barSize);
        return;
    }

    // Get the selected material from the dropdown
    let selectedMaterialName = document.getElementById("rebar_mat").value;

    // Find the corresponding material in defaultMaterials
    let materialObject = defaultMaterials.find(mat => mat.name === selectedMaterialName);

    if (!materialObject) {
        console.error("Material not found:", selectedMaterialName);
        return;
    }

    // Create rebar geometry
    const tempDotGeo = new THREE.BufferGeometry();
    tempDotGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, 0], 3));

    const selectedDotMaterial = new THREE.PointsMaterial({ 
        size: rebarDia[barSize], 
        map: sprite, 
        transparent: true, 
        color: 'blue' 
    });

    // Create the rebar point
    const tempDot = new THREE.Points(tempDotGeo, selectedDotMaterial);
    tempDot.isRebar = true;
    tempDot.rebarSize = barSize;
    tempDot.materialData = materialObject; // Store material class instance with the rebar point

    // Add to the Three.js scene
    scene.add(tempDot);

    console.log(`Rebar added at (${x}, ${y}) with bar size #${barSize} and material ${selectedMaterialName}`);
    console.log("Material Properties:", materialObject);
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
    let isLeftMouseDown = false;

    const selectionBox = new SelectionBox(camera, scene);
    const helper = new SelectionHelper(renderer, "selectBox");

    let allSelectedPnts = [];
    let allSelectedRebar = [];
    let allSelectedConc = [];

    threeJSDiv.addEventListener("pointerdown", function (event) {
        if (event.button === 1) {
            middlemouse = 1;
        } else if (event.button === 0) {
            isLeftMouseDown = true;
            if (!event.ctrlKey) resetSelections();
            setMousePosition(event);
            selectionBox.startPoint.set(mouse.x, mouse.y, 0.5);
        }
    });

    threeJSDiv.addEventListener("pointermove", function (event) {
        if (middlemouse !== 1 && isLeftMouseDown) {
            setMousePosition(event);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
            applySelectionColors(selectionBox.select());
        }
    });

    threeJSDiv.addEventListener("pointerup", function (event) {
        if (event.button === 0) isLeftMouseDown = false;
        if (middlemouse !== 1) {
            setMousePosition(event);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
            const allSelected = selectionBox.select();
            applySelectionColors(allSelected);
            processSelection(allSelected);
        }
        middlemouse = 0;
    });

    function setMousePosition(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;
    }

    function resetSelections() {
        for (const pnt of allSelectedPnts) pnt.material.color.set(0x00FF00);
        for (const pnt of allSelectedRebar) pnt.material.color.setHSL(0.0, 0.0, 0.5);
        for (const pnt of allSelectedConc) pnt.material.color.set(0xE5E5E5);
        allSelectedPnts = [];
        allSelectedRebar = [];
        allSelectedConc = [];
        updateTables();
    }

    function applySelectionColors(selectedObjects) {
        for (const obj of selectedObjects) {
            if (obj.isReference !== true && obj.isRebar !== true && obj.constructor.name === "Points") {
                obj.material.color.set(0xFF7F00);
            } else if (obj.isRebar === true && obj.constructor.name === "Points") {
                obj.material.color.set(0xFF7F00);
            } else if (obj.constructor.name === "Mesh") {
                obj.material.color.set(0xFF7F00);
            }
        }
    }

    function processSelection(selectedObjects) {
        for (const obj of selectedObjects) {
            if (obj.isReference !== true && obj.isRebar !== true && obj.constructor.name === "Points") {
                allSelectedPnts.push(obj);
            } else if (obj.isRebar === true && obj.constructor.name === "Points") {
                allSelectedRebar.push(obj);
            } else if (obj.constructor.name === "Mesh") {
                allSelectedConc.push(obj);
            }
        }
        updateTables();
    }

    function updateTables() {
        const pointTable = document.getElementById("pointData");
        pointTable.innerHTML = "";
        allSelectedPnts.forEach(point => {
            let row = document.createElement("tr");
            let Xinput = createInputField(point.geometry.attributes.position.array[0], newX => replacePoint(point, newX, point.geometry.attributes.position.array[1]));
            let Yinput = createInputField(point.geometry.attributes.position.array[1], newY => replacePoint(point, point.geometry.attributes.position.array[0], newY));

            row.appendChild(wrapInTableCell(Xinput));
            row.appendChild(wrapInTableCell(Yinput));
            pointTable.appendChild(row);
        });

        const rebarTable = document.getElementById("rebarData");
        rebarTable.innerHTML = "";
        allSelectedRebar.forEach(rebar => {
        let row = document.createElement("tr");
        let Xinput = createInputField(rebar.geometry.attributes.position.array[0], newX => replaceRebar(rebar, newX, rebar.geometry.attributes.position.array[1], rebar.rebarSize));
        let Yinput = createInputField(rebar.geometry.attributes.position.array[1], newY => replaceRebar(rebar, rebar.geometry.attributes.position.array[0], newY, rebar.rebarSize));
        let barDiaInput = createDropdown(rebar.rebarSize, newSize => replaceRebar(rebar, rebar.geometry.attributes.position.array[0], rebar.geometry.attributes.position.array[1], newSize));

        row.appendChild(wrapInTableCell(Xinput));
        row.appendChild(wrapInTableCell(Yinput));
        row.appendChild(wrapInTableCell(barDiaInput));
        rebarTable.appendChild(row);
    });

        document.getElementById("pointsSelected").innerText = allSelectedPnts.length;
        document.getElementById("rebarSelected").innerText = allSelectedRebar.length;
    }

    function createInputField(value, callback) {
        let input = document.createElement("input");
        input.type = "number";
        input.value = value;
        input.classList.add("numDropDown");
        input.addEventListener("change", () => callback(parseFloat(input.value) || 0));
        return input;
    }

    function createDropdown(selectedValue, callback) {
        let dropdown = document.createElement("select");
        let options = [3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 18];
        options.forEach(value => {
            let option = document.createElement("option");
            option.value = value;
            option.text = `#${value}`;
            if (value == selectedValue) option.selected = true;
            dropdown.appendChild(option);
        });
        dropdown.classList.add("numDropDown");
        dropdown.addEventListener("change", () => callback(parseInt(dropdown.value)));
        return dropdown;
    }

    function wrapInTableCell(content) {
        let cell = document.createElement("td");
        cell.appendChild(content);
        return cell;
    }

    function replacePoint(oldPoint, newX, newY) {
        scene.remove(oldPoint);
        allSelectedPnts = allSelectedPnts.filter(p => p !== oldPoint);

        let dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute('position', new THREE.Float32BufferAttribute([newX, newY, 0], 3));
        let dotMat = new THREE.PointsMaterial({ size: 0.5, color: 0x00FF00 });
        let newDot = new THREE.Points(dotGeo, dotMat);
        scene.add(newDot);
        allSelectedPnts.push(newDot);

        updateTables();
    }

    function replaceRebar(oldRebar, newX, newY, barSize) {
        const sprite = getSprite(); // Get the loaded sprite
        const oldIndex = allSelectedRebar.indexOf(oldRebar);
    
        if (oldIndex === -1) return; // Ensure old rebar exists in the selection list
    
        scene.remove(oldRebar); // Remove the old rebar from the scene
    
        // ✅ Create new rebar at updated position and store reference
        addRebar(newX, newY, barSize, scene, sprite);
    
        // ✅ Manually create a new Three.js Points object for selection tracking
        const tempDotGeo = new THREE.BufferGeometry();
        tempDotGeo.setAttribute('position', new THREE.Float32BufferAttribute([newX, newY, 0], 3));
    
        const selectedDotMaterial = new THREE.PointsMaterial({ size: 0.5, color: 'blue' });
        const newRebarPoint = new THREE.Points(tempDotGeo, selectedDotMaterial);
        
    
        // ✅ Replace the rebar in `allSelectedRebar` at the same index
        allSelectedRebar[oldIndex] = newRebarPoint;
    
        updateTables(); // ✅ Keep rebar in the table after update
    }
}

export function addPoint() {
    var X1 = parseFloat(document.getElementById("X_Vals").value);
    var Y1 = parseFloat(document.getElementById("Y_Vals").value);
  
    if (isNaN(X1) || isNaN(Y1)) {
      console.error("Invalid input for X or Y");
      return;
    }
  
    var tempDotGeo = new THREE.BufferGeometry();
    tempDotGeo.setAttribute('position', new THREE.Float32BufferAttribute([X1, Y1, 0], 3));
  
    var selectedDotMaterial = new THREE.PointsMaterial({ size: 0.5, color: 0x00FF00 });
    var tempDot = new THREE.Points(tempDotGeo, selectedDotMaterial);
    
    scene.add(tempDot);
    console.log(`Added point at (${X1}, ${Y1})`);
  }

  export function addRebarToScene(sprite) {
    // Get values from input fields
    let X = parseFloat(document.getElementById("X_Vals").value) || 0;
    let Y = parseFloat(document.getElementById("Y_Vals").value) || 0;
    let barSize = document.getElementById("rebar_Vals").value;

    if (!barSize) {
        console.error("Invalid rebar size selected");
        return;
    }

    console.log(`Adding rebar at (${X}, ${Y}) with bar size #${barSize}`);

    // Call addRebar function
    addRebar(X, Y, barSize, scene, sprite);
}