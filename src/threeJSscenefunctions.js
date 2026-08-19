import { camera, renderer, scene, getSprite } from "./main.js"; 
import * as THREE from 'three';
import { rebarDia } from './rebarProperties.js';
export { rebarDia } from './rebarProperties.js';
import { SelectionBox } from 'three/examples/jsm/interactive/SelectionBox.js';
import { SelectionHelper } from 'three/examples/jsm/interactive/SelectionHelper.js';
import { defaultMaterials } from "./materials.js";
import { ConcShape } from './concShape.js';
import { updateStressStrainChart, plotSelectedPoint } from "./materialsPlotting.js";
import { defaultPriorityForMaterial, getShapePriority } from './sectionMeshing.js';
import { getAnalysisRaycastTargets } from './analysisScene.js';
import { orthographicFitHeight } from './cameraView.js';





let allSelectedPnts = []; // ✅ Declare globally so it is accessible everywhere
let allSelectedRebar = [];
let allSelectedConc = [];
let activeResultsRaycastingCleanup = null;



export function resizeThreeJsScene() {
    const concGui = document.getElementById('concGui');
    const canvas = document.querySelector('canvas');

    if (!concGui || !canvas) return;

    // Get new size
    const newWidth = Math.max(concGui.clientWidth, 1);
    const newHeight = Math.max(concGui.clientHeight, 1);

    // Update the renderer
    renderer.setSize(newWidth, newHeight, false);
    renderer.setPixelRatio(window.devicePixelRatio);

    // Force the canvas to match the new size
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;

    // Adjust camera aspect ratio
    const aspect = newWidth / newHeight;
    if (camera.isPerspectiveCamera) {
        camera.aspect = aspect;
    } else if (camera.isOrthographicCamera) {
        const fitSize = camera.userData.fitSize;
        const padding = camera.userData.fitPadding ?? 1.18;
        const viewHeight = fitSize
            ? orthographicFitHeight(fitSize, aspect, padding)
            : (camera.userData.viewHeight ?? 20);
        camera.userData.viewHeight = viewHeight;
        camera.left = -(viewHeight * aspect) / 2;
        camera.right = (viewHeight * aspect) / 2;
        camera.top = viewHeight / 2;
        camera.bottom = -viewHeight / 2;
    }
    camera.updateProjectionMatrix();
}

export function setupDragAndAnalyze() {
    const concGui = document.getElementById("concGui");
    const results = document.getElementById("results");
    const dragBar = document.getElementById("drag-bar");
    const middleColumn = document.getElementById("middleColumn");

    let isDragging = false;

    // Ensure middleColumn has full height
    middleColumn.style.display = "flex";
    middleColumn.style.flexDirection = "column";
    middleColumn.style.height = "100%";

    // Design mode starts with the editable scene using the full height. The
    // workflow tabs reveal the resizable results pane after analysis.
    concGui.style.flex = "1";
    results.style.flex = "1";
    results.style.display = "none";
    dragBar.style.display = "none";

    requestAnimationFrame(() => requestAnimationFrame(resizeThreeJsScene));

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

}


export function addRebar(x, y, barSize, scene, sprite, options = {}) {
    const diameter = Number(options.diameter ?? rebarDia[barSize]);
    const area = Number(options.area ?? ((Math.PI / 4) * diameter ** 2));
    if (!Number.isFinite(diameter) || diameter <= 0) {
        console.error("Invalid rebar size:", barSize);
        return null; // ✅ Return null if barSize is invalid
    }

    let selectedMaterialName = document.getElementById("rebar_mat")?.value;
    let materialObject = options.material ?? defaultMaterials.find(mat => mat.name === selectedMaterialName);

    if (!materialObject) {
        console.error("Material not found:", selectedMaterialName);
        return null; // ✅ Return null if material is not found
    }

    // ✅ Create rebar geometry
    const tempDotGeo = new THREE.BufferGeometry();
    tempDotGeo.setAttribute('position', new THREE.Float32BufferAttribute([x, y, 0], 3));

    // ✅ Create rebar material
    const selectedDotMaterial = new THREE.PointsMaterial({
        size: diameter,
        map: sprite,
        transparent: true,
        color: 0x334155
    });

    // ✅ Create Three.js Points object
    const tempDot = new THREE.Points(tempDotGeo, selectedDotMaterial);
    tempDot.isRebar = true; // ✅ Mark as rebar
    tempDot.rebarSize = Number(barSize); // ✅ Store rebar size
    tempDot.rebarDiameter = diameter;
    tempDot.rebarArea = Number.isFinite(area) && area > 0 ? area : (Math.PI / 4) * diameter ** 2;
    tempDot.materialData = materialObject; // ✅ Store material data

    // ✅ Add to the scene
    if (options.addToScene !== false) scene.add(tempDot);
    return tempDot; // ✅ Return the new rebar object
}

export function resetProjectSelections() {
    allSelectedPnts = [];
    allSelectedRebar = [];
    allSelectedConc = [];
    document.getElementById("pointData")?.replaceChildren();
    document.getElementById("rebarData")?.replaceChildren();
    document.getElementById("concData")?.replaceChildren();
    if (document.getElementById("pointsSelected")) document.getElementById("pointsSelected").textContent = "0";
    if (document.getElementById("rebarSelected")) document.getElementById("rebarSelected").textContent = "0";
    if (document.getElementById("concSelected")) document.getElementById("concSelected").textContent = "0";
}

export function setupMouseTracking(threeJSDiv, intersectionPoint) {
    const mouse = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();
    const xyPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersectPoint = new THREE.Vector3();

    function onMouseMove(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / (rect.right - rect.left)) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / (rect.bottom - rect.top)) * 2 + 1;

        // Update the raycaster
        raycaster.setFromCamera(mouse, camera);

        // Intersect an infinite XY work plane. Mouse tracking is therefore not
        // limited by the visible grid's current geometry or camera zoom.
        if (raycaster.ray.intersectPlane(xyPlane, intersectPoint)) {
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
    const raycaster = new THREE.Raycaster();
    raycaster.params.Points.threshold = 1.25;
    let middlemouse = 0;
    let isLeftMouseDown = false;
    let pointerStart = null;

    const selectionBox = new SelectionBox(camera, scene);
    const helper = new SelectionHelper(renderer, "selectBox");

    function onPointerDown(event) {
        //Prevents resetting the scene selections if you select the buttons
        if (event.target.closest("button, input, select, textarea, .modal, .ui")) return; 

        if (event.button === 1) {
            middlemouse = 1;
        } else if (event.button === 0) {
            isLeftMouseDown = true;
            pointerStart = { x: event.clientX, y: event.clientY };
            if (!event.ctrlKey) resetSelections();
            setMousePosition(event);
            selectionBox.startPoint.set(mouse.x, mouse.y, 0.5);
        }
    }

    function onPointerMove(event) {
        if (middlemouse !== 1 && isLeftMouseDown) {
            setMousePosition(event);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
        }
    }

    function onPointerUp(event) {
        if (event.button === 0) isLeftMouseDown = false;
        if (middlemouse !== 1) {
            setMousePosition(event);
            selectionBox.endPoint.set(mouse.x, mouse.y, 0.5);
            const distance = pointerStart
                ? Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
                : 0;
            const allSelected = distance <= 4
                ? getClickSelection()
                : getWindowSelection(selectionBox.startPoint, selectionBox.endPoint);
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
                concShape.mesh.material.color.set(concShape.material?.type === 'steel' ? 0x64748B : 0xCBD5E1);
            }
        }
        allSelectedPnts = [];
        allSelectedRebar = [];
        allSelectedConc = [];
        updateTables();
    }

    function applySelectionColors(selectedObjects) {
        for (const obj of selectedObjects) {
            if (obj.isReference !== true && obj.isRebar !== true && obj.isPoints === true) {
                obj.material.color.set(0x2563EB);
            } else if (obj.isRebar === true && obj.isPoints === true) {
                obj.material.color.set(0x2563EB);
            }
            else if (obj.isMesh === true) {
                obj.material.color.set(0x2563EB);

            } 
            else if (obj instanceof ConcShape) {
                obj.mesh.material.color.set(0x2563EB);
            }
        }
    }

    function processSelection(selectedObjects) {
        for (const obj of selectedObjects) {
            if (obj.isReference !== true && obj.isRebar !== true && obj.isPoints === true) {
                if (!allSelectedPnts.includes(obj)) allSelectedPnts.push(obj);
            } else if (obj.isRebar === true && obj.isPoints === true) {
                if (!allSelectedRebar.includes(obj)) allSelectedRebar.push(obj);
                console.log(allSelectedRebar)
            } else if (obj.isMesh === true && obj.userData.concShape) {
                if (!allSelectedConc.includes(obj.userData.concShape)) allSelectedConc.push(obj.userData.concShape);
            }
        }
        updateTables();
    }

    function getClickSelection() {
        raycaster.setFromCamera(mouse, camera);
        const intersections = raycaster.intersectObjects(scene.children, true)
            .filter(hit => isSelectable(hit.object));
        const pointHit = intersections.find(hit => hit.object.isPoints === true);
        if (pointHit) return [pointHit.object];

        const polygonHits = intersections
            .filter(hit => hit.object.isMesh === true && hit.object.userData?.concShape)
            .sort((left, right) => (
                getShapePriority(right.object.userData.concShape) - getShapePriority(left.object.userData.concShape)
            ));
        return polygonHits.length ? [polygonHits[0].object] : [];
    }

    function getWindowSelection(start, end) {
        const bounds = {
            left: Math.min(start.x, end.x),
            right: Math.max(start.x, end.x),
            bottom: Math.min(start.y, end.y),
            top: Math.max(start.y, end.y)
        };
        return scene.children.filter(object => {
            if (!isSelectable(object)) return false;
            if (object.isPoints === true) {
                const position = object.geometry?.attributes?.position;
                if (!position) return false;
                const point = object.localToWorld(new THREE.Vector3(
                    position.getX(0), position.getY(0), position.getZ(0)
                )).project(camera);
                return pointInBounds(point, bounds, 0.012);
            }
            return object.isMesh === true && meshIntersectsSelection(object, bounds);
        });
    }

    function isSelectable(object) {
        return object?.visible !== false && (
            (object.isPoints === true && object.isReference !== true)
            || (object.isMesh === true && Boolean(object.userData?.concShape))
        );
    }

    function meshIntersectsSelection(object, bounds) {
        const geometry = object.geometry;
        const positions = geometry?.attributes?.position;
        if (!positions) return false;
        const index = geometry.index;
        const triangleCount = index ? index.count / 3 : positions.count / 3;
        const projected = vertexIndex => {
            const sourceIndex = index ? index.getX(vertexIndex) : vertexIndex;
            return object.localToWorld(new THREE.Vector3(
                positions.getX(sourceIndex), positions.getY(sourceIndex), positions.getZ(sourceIndex)
            )).project(camera);
        };

        for (let triangle = 0; triangle < triangleCount; triangle += 1) {
            const points = [0, 1, 2].map(offset => projected(triangle * 3 + offset));
            if (triangleIntersectsBounds(points, bounds)) return true;
        }
        return false;
    }

    function triangleIntersectsBounds(points, bounds) {
        if (points.some(point => pointInBounds(point, bounds))) return true;
        const corners = [
            { x: bounds.left, y: bounds.bottom },
            { x: bounds.right, y: bounds.bottom },
            { x: bounds.right, y: bounds.top },
            { x: bounds.left, y: bounds.top }
        ];
        if (corners.some(corner => pointInTriangle(corner, points))) return true;

        const triangleEdges = [[0, 1], [1, 2], [2, 0]].map(([a, b]) => [points[a], points[b]]);
        const rectangleEdges = [[0, 1], [1, 2], [2, 3], [3, 0]].map(([a, b]) => [corners[a], corners[b]]);
        return triangleEdges.some(edge => rectangleEdges.some(rectEdge => segmentsIntersect(edge, rectEdge)));
    }

    function pointInBounds(point, bounds, padding = 0) {
        return point.x >= bounds.left - padding && point.x <= bounds.right + padding
            && point.y >= bounds.bottom - padding && point.y <= bounds.top + padding;
    }

    function pointInTriangle(point, [a, b, c]) {
        const cross = (p1, p2, p3) => (
            (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y)
        );
        const d1 = cross(point, a, b);
        const d2 = cross(point, b, c);
        const d3 = cross(point, c, a);
        return !(d1 < 0 || d2 < 0 || d3 < 0) || !(d1 > 0 || d2 > 0 || d3 > 0);
    }

    function segmentsIntersect([a, b], [c, d]) {
        const orientation = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
        return orientation(a, b, c) !== orientation(a, b, d)
            && orientation(c, d, a) !== orientation(c, d, b);
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
                const previousMaterial = concShape.material;
                const wasDefaultPriority = concShape.priority === defaultPriorityForMaterial(previousMaterial);
                concShape.material = defaultMaterials.find(mat => mat.name === newMaterial) || concShape.material;
                if (wasDefaultPriority) concShape.priority = defaultPriorityForMaterial(concShape.material);
                concShape.mesh.userData.material = concShape.material;
                concShape.mesh.userData.priority = concShape.priority;
                concShape.mesh.material.color.set(concShape.material?.type === 'steel' ? 0x64748B : 0xCBD5E1);
                updateTables();
            });

            const priorityInput = createInputField(concShape.priority, newPriority => {
                concShape.priority = newPriority;
                concShape.mesh.userData.priority = newPriority;
            });

            row.appendChild(wrapInTableCell(materialDropdown));
            row.appendChild(wrapInTableCell(priorityInput));
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

    // Functions to toggle table views
    function pointSelection() {

        document.getElementById("pointInfo").style.display = "inline";
        document.getElementById("pointInfo").style.display = "";
        document.getElementById("rebarInfo").style.display = "none";
        document.getElementById("concInfo").style.display = "none";
        
    
        document.getElementById("Points").style.backgroundColor = '#1a202c';
        document.getElementById("Points").style.color = 'white';
        document.getElementById("Rebar").style.backgroundColor = 'white';
        document.getElementById("Rebar").style.color = '#4a5568';
        document.getElementById("Conc").style.backgroundColor = 'white';
        document.getElementById("Conc").style.color = '#4a5568';

    }
    
    function rebarSelection() {

        document.getElementById("pointInfo").style.display = "none";
        document.getElementById("rebarInfo").style.display = "inline";
        document.getElementById("rebarInfo").style.display = "";
        //For some reason, style.display inline messes up with the styling of the table. Add it then remove makes this work
        document.getElementById("concInfo").style.display = "none";
    
        document.getElementById("Points").style.backgroundColor = 'white';
        document.getElementById("Points").style.color = '#4a5568';
        document.getElementById("Rebar").style.backgroundColor = '#1a202c';
        document.getElementById("Rebar").style.color = 'white';
        document.getElementById("Conc").style.backgroundColor = 'white';
        document.getElementById("Conc").style.color = '#4a5568';
    
        
    }
    
    function concSelection() {

        document.getElementById("pointInfo").style.display = "none";
        document.getElementById("rebarInfo").style.display = "none";
        document.getElementById("concInfo").style.display = "inline";
        document.getElementById("concInfo").style.display = "";
    
        document.getElementById("Points").style.backgroundColor = 'white';
        document.getElementById("Points").style.color = '#4a5568';
        document.getElementById("Rebar").style.backgroundColor = 'white';
        document.getElementById("Rebar").style.color = '#4a5568';
        document.getElementById("Conc").style.backgroundColor = '#1a202c';
        document.getElementById("Conc").style.color = 'white';
    }
    
    // Event listeners for buttons
    document.getElementById("Points").onclick = pointSelection;
    document.getElementById("Rebar").onclick = rebarSelection;
    document.getElementById("Conc").onclick = concSelection;
  

    const dispose = () => {
        threeJSDiv.removeEventListener("pointerdown", onPointerDown);
        threeJSDiv.removeEventListener("pointermove", onPointerMove);
        threeJSDiv.removeEventListener("pointerup", onPointerUp);
        helper.dispose?.();
    };

    return { onPointerDown, onPointerMove, onPointerUp, dispose };
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
    if (selectedConcShape[0].mesh) {
        scene.remove(selectedConcShape[0].mesh);
    }
    console.log(selectedConcShape)
    // ✅ Add the hole to the shape
    selectedConcShape[0].addHole(holePoints);

    // ✅ Generate and add the updated shape to the scene
    if (selectedConcShape[0].mesh) {
        scene.add(selectedConcShape[0].mesh);
    } else {
        console.error("Failed to generate updated concrete mesh.");
    }
}

export function getAllSelectedPnts() {
    return allSelectedPnts; // ✅ Returns the current selected points
}

export function getAllSelectedConcShape() {
    // return allSelectedConc[0]; // ✅ Returns the first current selected concrete
    return allSelectedConc; // ✅ Returns the first current selected concrete
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

export function teardownRaycastingForResults() {
    activeResultsRaycastingCleanup?.();
    activeResultsRaycastingCleanup = null;
}

export function setupRaycastingForResults(scene, camera, renderer) {
    // Replacing the previous handlers makes repeated analysis iterations and
    // PMM point selections idempotent instead of accumulating listeners.
    teardownRaycastingForResults();

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let hoveredObject = null;
    let hoveredRebar = null;
    let originalRebarOpacity = 0.5;
    let originalMeshWireframe = true;

    function updateRaycaster(event) {
        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        // Design geometry, helpers, and response arrows must never intercept a
        // result click. Only the active section's FEM and rebar are selectable.
        return raycaster.intersectObjects(
            getAnalysisRaycastTargets(window.activeAnalysisSection),
            true
        );
    }

    function onMouseMove(event) {
        let intersects = updateRaycaster(event);
        let meshFound = false;
        let rebarFound = false;


        for (const intersect of intersects) {
            const object = intersect.object;

            if (object instanceof THREE.Mesh && !meshFound) {
                if (hoveredObject !== object) {
                    if (hoveredObject) hoveredObject.material.wireframe = originalMeshWireframe;
                    hoveredObject = object;
                    originalMeshWireframe = object.material.wireframe;
                    hoveredObject.material.wireframe = false;
                }
                meshFound = true;
            }

            // Check for rebar points
            if (object instanceof THREE.Points && !rebarFound) {
                if (hoveredRebar !== object) {
                    if (hoveredRebar) hoveredRebar.material.opacity = originalRebarOpacity; // Restore opacity
                    originalRebarOpacity = object.material.opacity;
                    object.material.transparent = true;
                    object.material.opacity = 1; // Make invisible on hover
                    hoveredRebar = object;
                }
                rebarFound = true;
            }
        }

        // ✅ Restore previous properties when mouse leaves
        if (!meshFound && hoveredObject) {
            hoveredObject.material.wireframe = originalMeshWireframe;
            hoveredObject = null;
        }

        if (!rebarFound && hoveredRebar) {
            hoveredRebar.material.opacity = originalRebarOpacity;
            hoveredRebar = null;
        }
    }

    function onClick(event) {
        let intersects = updateRaycaster(event);
        if (intersects.length === 0) return;

        console.log("YOU CLICKED", intersects);

        let pointsObjects = intersects.filter(i => i.object instanceof THREE.Points);
        let meshObjects = intersects.filter(i => i.object instanceof THREE.Mesh);
        let selectedObject = pointsObjects.length > 0 ? pointsObjects[0].object : meshObjects[0]?.object;

        if (!selectedObject) return;
        console.log("SELECTED OBJECT:", selectedObject);
        console.log("YOUR ANGLE IS", window.selectedAngle);
        console.log("YOUR INDEX IS", window.selectedStrainProfileIndex);


        if (selectedObject instanceof THREE.Mesh && selectedObject.userData) {
            console.log("Concrete Mesh Clicked:", selectedObject);
            updateStressStrainChart(selectedObject.userData.material ?? selectedObject.userData.concShape.material);
            plotSelectedPoint(selectedObject);
        } else if (selectedObject instanceof THREE.Points && selectedObject.materialData) {
            console.log("Rebar Point Clicked:", selectedObject);
            updateStressStrainChart(selectedObject.materialData);
            plotSelectedPoint(selectedObject);
        }
    }

    renderer.domElement.addEventListener('mousemove', onMouseMove);
    renderer.domElement.addEventListener('click', onClick);

    activeResultsRaycastingCleanup = () => {
        renderer.domElement.removeEventListener('mousemove', onMouseMove);
        renderer.domElement.removeEventListener('click', onClick);
        if (hoveredObject) hoveredObject.material.wireframe = originalMeshWireframe;
        if (hoveredRebar) hoveredRebar.material.opacity = originalRebarOpacity;
    };

    return activeResultsRaycastingCleanup;
}

