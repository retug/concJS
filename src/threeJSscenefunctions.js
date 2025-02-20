import { camera, renderer, scene, getSprite } from "./main.js"; 
import * as THREE from 'three';
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js';
import { SelectionHelper } from 'three/examples/jsm/interactive/SelectionHelper.js';
import { defaultMaterials } from "./materials.js";
import { ConcShape } from './concShape.js';



let allSelectedPnts = []; // ✅ Declare globally so it is accessible everywhere
let allSelectedRebar = [];
let allSelectedConc = [];



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
            analyzeButton.textContent = "Close Results";
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



export function addRebar(x, y, barSize, scene, sprite) {
    if (!(barSize in rebarDia)) {
        console.error("Invalid rebar size:", barSize);
        return null; // ✅ Return null if barSize is invalid
    }

    let selectedMaterialName = document.getElementById("rebar_mat").value;
    let materialObject = defaultMaterials.find(mat => mat.name === selectedMaterialName);

    if (!materialObject) {
        console.error("Material not found:", selectedMaterialName);
        return null; // ✅ Return null if material is not found
    }

    // ✅ Create rebar geometry
    const tempDotGeo = new THREE.BufferGeometry();
    tempDotGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, 0], 3));

    // ✅ Create rebar material
    const selectedDotMaterial = new THREE.PointsMaterial({
        size: rebarDia[barSize], // ✅ Use correct size from `rebarDia`
        map: sprite,
        transparent: true,
        color: 0xFF7F00 // ✅ Changed from 'blue' to 0xFF7F00
    });

    // ✅ Create Three.js Points object
    const tempDot = new THREE.Points(tempDotGeo, selectedDotMaterial);
    tempDot.isRebar = true; // ✅ Mark as rebar
    tempDot.rebarSize = barSize; // ✅ Store rebar size
    tempDot.materialData = materialObject; // ✅ Store material data

    // ✅ Add to the scene
    scene.add(tempDot);
    return tempDot; // ✅ Return the new rebar object
}

export function setupMouseTracking(threeJSDiv, plane, intersectionPoint) {
    const mouse = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    function onMouseMove(event) {
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
    }

    // Attach event listener
    threeJSDiv.addEventListener("mousemove", onMouseMove);

    // Return the function reference for later removal
    return onMouseMove;
}

export function setupMouseInteractions(threeJSDiv) {
    const mouse = new THREE.Vector2();
    let middlemouse = 0;
    let isLeftMouseDown = false;

    const selectionBox = new SelectionBox(camera, scene);
    const helper = new SelectionHelper(renderer, "selectBox");

    function onPointerDown(event) {
        if (event.button === 1) {
            middlemouse = 1;
        } else if (event.button === 0) {
            isLeftMouseDown = true;
            if (!event.ctrlKey) resetSelections();
            setMousePosition(event);
            selectionBox.startPoint.set(mouse.x, mouse.y, 0.5);
        }
    }

    function onPointerMove(event) {
        if (middlemouse !== 1 && isLeftMouseDown) {
            setMousePosition(event);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
            applySelectionColors(selectionBox.select());
        }
    }

    function onPointerUp(event) {
        if (event.button === 0) isLeftMouseDown = false;
        if (middlemouse !== 1) {
            setMousePosition(event);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
            const allSelected = selectionBox.select();
            applySelectionColors(allSelected);
            processSelection(allSelected);
        }
        middlemouse = 0;
    }

    threeJSDiv.addEventListener("pointerdown", onPointerDown);
    threeJSDiv.addEventListener("pointermove", onPointerMove);
    threeJSDiv.addEventListener("pointerup", onPointerUp);

    function setMousePosition(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;
    }

    function resetSelections() {
        for (const pnt of allSelectedPnts) pnt.material.color.set(0x00FF00);
        for (const pnt of allSelectedRebar) pnt.material.color.setHSL(0.0, 0.0, 0.5);
        
        for (const concShape of allSelectedConc) {
            console.log('your concrete shape is a instance of concrete shape?', concShape instanceof ConcShape )
            if (concShape instanceof ConcShape && concShape.mesh && concShape.mesh.material) { // ✅ Ensure valid `ConcShape`
                concShape.mesh.material.color.set(0xE5E5E5);
            }
        }
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
            }
            else if (obj.constructor.name === "Mesh") {
                obj.material.color.set(0xFF7F00);

            } 
            else if (obj instanceof ConcShape) {
                obj.mesh.material.color.set(0xFF7F00);
            }
        }
    }

    function processSelection(selectedObjects) {
        for (const obj of selectedObjects) {
            if (obj.isReference !== true && obj.isRebar !== true && obj.constructor.name === "Points") {
                allSelectedPnts.push(obj);
            } else if (obj.isRebar === true && obj.constructor.name === "Points") {
                allSelectedRebar.push(obj);
                console.log(allSelectedRebar)
            } else if (obj.constructor.name === "Mesh" && obj.userData.concShape) {
                // allSelectedConc.push(obj);
                allSelectedConc.push(obj.userData.concShape);
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
    
            let Xinput = createInputField(
                rebar.geometry.attributes.position.array[0], 
                newX => replaceRebar(rebar, newX, rebar.geometry.attributes.position.array[1], rebar.rebarSize)
            );
    
            let Yinput = createInputField(
                rebar.geometry.attributes.position.array[1], 
                newY => replaceRebar(rebar, rebar.geometry.attributes.position.array[0], newY, rebar.rebarSize)
            );
    
            let barDiaInput = createDropdown(rebar.rebarSize, newSize => {
                replaceRebar(rebar, rebar.geometry.attributes.position.array[0], rebar.geometry.attributes.position.array[1], newSize);
            });

            let materialDropdown = createMaterialDropdown(rebar.materialData.name, newMaterial => {
                rebar.materialData = defaultMaterials.find(mat => mat.name === newMaterial) || rebar.materialData;
                updateTables(); // ✅ Update the table when material changes
            });
    
            row.appendChild(wrapInTableCell(Xinput));
            row.appendChild(wrapInTableCell(Yinput));
            row.appendChild(wrapInTableCell(barDiaInput));
            row.appendChild(wrapInTableCell(materialDropdown)); // ✅ Add material dropdown
            rebarTable.appendChild(row);
        });

        // ✅ Update concrete table
        const concTable = document.getElementById("concData");
        concTable.innerHTML = "";
        allSelectedConc.forEach(concShape => {
            let row = document.createElement("tr");

            let materialDropdown = createMaterialDropdown(concShape.material.name, newMaterial => {
                concShape.material = defaultMaterials.find(mat => mat.name === newMaterial) || concShape.material;
                updateTables();
                
            });

            row.appendChild(wrapInTableCell(materialDropdown)); // ✅ Add material dropdown for concrete
            concTable.appendChild(row);
        });

        document.getElementById("pointsSelected").innerText = allSelectedPnts.length;
        document.getElementById("rebarSelected").innerText = allSelectedRebar.length;
        document.getElementById("concSelected").innerText = allSelectedConc.length;

    }

    function createInputField(value, callback) {
        let input = document.createElement("input");
        input.type = "number";
        input.value = value;
        input.min = "0";
        input.step = "0.1";
        input.placeholder = "Enter value";

        // ✅ Apply the new class for consistent styling
        input.className = "appearance-none block w-full bg-gray-200 text-gray-700 border rounded py-1 px-2 leading-tight focus:outline-none focus:bg-white";
        input.addEventListener("change", () => callback(parseFloat(input.value) || 0));
        return input;
    }

    function createMaterialDropdown(selectedMaterial, callback) {
        let dropdown = document.createElement("select");
    
        // Apply Tailwind-style classes for consistent styling
        dropdown.className = "appearance-none block w-full bg-gray-200 text-gray-700 border rounded py-1 px-2 leading-tight focus:outline-none focus:bg-white";
    
        defaultMaterials.forEach(material => {
            let option = document.createElement("option");
            option.value = material.name;
            option.text = material.name;
            if (material.name === selectedMaterial) {
                option.selected = true; // ✅ Keep last selected material
            }
            dropdown.appendChild(option);
        });
    
        dropdown.addEventListener("change", () => callback(dropdown.value));
    
        return dropdown;
    }

    function createDropdown(selectedValue, callback) {
        let dropdown = document.createElement("select");
    
        let options = [3, 4, 5, 6, 7, 8, 9, 10, 11, 14, 18];

        // Apply Tailwind-style classes
        dropdown.className = "appearance-none block w-full bg-gray-200 border text-gray-700 py-1 px-2 pr-8 rounded leading-tight focus:outline-none focus:bg-white";
    
        options.forEach(value => {
            let option = document.createElement("option");
            option.value = value;
            option.text = `#${value}`;
            if (value == selectedValue) {
                option.selected = true; // ✅ Keep last selected value
            }
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
        // ✅ Create new rebar and store reference properly
        const newRebar = addRebar(newX, newY, barSize, scene, sprite);
        // ✅ Store the correct rebar object in `allSelectedRebar`
        allSelectedRebar[oldIndex] = newRebar;    
        updateTables(); // ✅ Keep rebar in the table after update
    }
    return { onPointerDown, onPointerMove, onPointerUp };
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
  }

  export function addRebarToScene(sprite) {
    // Get values from input fields
    let X = parseFloat(document.getElementById("X_Vals").value) || 0;
    let Y = parseFloat(document.getElementById("Y_Vals").value) || 0;
    let barSize = document.getElementById("rebar_Vals").value;

    if (!barSize) {
        return;
    }
    // Call addRebar function
    addRebar(X, Y, barSize, scene, sprite);
}

export function addConcGeo(allSelectedPnts) {
    if (!allSelectedPnts || allSelectedPnts.length < 3) {
        console.error("Not enough points to create a shape.");
        return;
    }

    // ✅ Convert Three.js Points objects to an array of Vector2 points
    const pointsArray = allSelectedPnts.map(pnt => 
        new THREE.Vector2(
            pnt.geometry.attributes.position.array[0], 
            pnt.geometry.attributes.position.array[1]
        )
    );

    // ✅ Create a ConcShape instance
    const material = new THREE.MeshStandardMaterial({
        color: 0xE5E5E5,
        transparent: true,
        opacity: 0.4
    });

    const materialNameConc = document.getElementById("concrete_mat").value;
    const selectedMaterialConc = defaultMaterials.find(material => material.name === materialNameConc);
    if (!selectedMaterialConc) {
        console.warn(`Material "${materialNameConc}" not found in default materials.`);
        return;
    }

    const concShape = new ConcShape(pointsArray, selectedMaterialConc);

    // ✅ Generate and add the mesh to the scene
    concShape.generateMesh();
    if (concShape.mesh) {
        scene.add(concShape.mesh);
    } else {
        console.error("Failed to generate concrete mesh.");
    }
}

export function addHoleToShape(selectedConcShape, allSelectedPnts) {
    if (!selectedConcShape || !allSelectedPnts || allSelectedPnts.length < 3) {
        console.error("Invalid selection: A concrete shape and at least 3 points are required.");
        return;
    }

    // ✅ Convert selected points into a hole
    const holePoints = allSelectedPnts.map(pnt =>
        new THREE.Vector2(
            pnt.geometry.attributes.position.array[0],
            pnt.geometry.attributes.position.array[1]
        )
    );

    // ✅ Remove existing shape from scene
    if (selectedConcShape.mesh) {
        scene.remove(selectedConcShape.mesh);
    }
    console.log(selectedConcShape)
    // ✅ Add the hole to the shape
    selectedConcShape.addHole(holePoints);

    // ✅ Generate and add the updated shape to the scene
    if (selectedConcShape.mesh) {
        scene.add(selectedConcShape.mesh);
    } else {
        console.error("Failed to generate updated concrete mesh.");
    }
}

export function getAllSelectedPnts() {
    return allSelectedPnts; // ✅ Returns the current selected points
}

export function getSelectedConcShape() {
    return allSelectedConc[0]; // ✅ Returns the first current selected concrete
}

export function getAllSelectedRebar() {
    console.log("🔹 Returning all selected rebar:", allSelectedRebar);
    return allSelectedRebar; // ✅ Ensure this function is defined and exported
}

// ✅ Move delete function to global scope
export function deleteSelectedElements() {
    console.log("deleteSelectedElements() function triggered");

    // ✅ Delete selected points
    for (const pnt of allSelectedPnts) {
        console.log("Removing point:", pnt);
        scene.remove(pnt);
    }
    allSelectedPnts = []; // ✅ Clear selection array
    document.getElementById("pointData").innerHTML = "";

    // ✅ Delete selected rebar
    for (const rebar of allSelectedRebar) {
        console.log("Removing rebar:", rebar);
        scene.remove(rebar);
    }
    allSelectedRebar = []; // ✅ Clear selection array
    document.getElementById("rebarData").innerHTML = "";

    // ✅ Delete selected concrete shapes
    for (const concShape of allSelectedConc) {
        if (concShape.mesh) {
            console.log("Removing concrete shape:", concShape.mesh);
            scene.remove(concShape.mesh);
        }
    }
    allSelectedConc = []; // ✅ Clear selection array
    document.getElementById("concData").innerHTML = "";
}