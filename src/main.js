import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import { toggleMaterialsAndShapesDiv, toggleShapeButtons, getActiveShape, createRectangleShape, addShapeToScene } from './materialsandShapes.js';
import { populateMaterialDropdown, updateChartAndTable, addUserDefinedRow, saveUserDefinedMaterial, populateRebarDropdown } from './materialsPlotting.js';
import * as SceneFunctions from './threeJSscenefunctions.js';
import { setupReplicateShortcut, setupMoveShortcut } from './CADfunctions.js';
import { CompositeConcShape } from './compositeShapeAnalysis.js';
import { initializeProjectPersistence } from './projectPersistence.js';
//required for webpack bundling
import "./materials.js";
import "./materialsandShapes.js";
import "./materialsPlotting.js";
import "./threeJSscenefunctions.js";
import "../src/style.css";
import "./tailwind.css";
import discTextureUrl from '../static/disc.png';




const loader = new THREE.TextureLoader();
let sprite = null; // Store the loaded texture globally


// ✅ Define global variables
window.selectedAngle = 0;
window.selectedStrainProfileIndex = 4;
window.allConcShapes = window.allConcShapes || [];  // ✅ Ensure global list exists

let designWorkspaceSnapshot = null;

function setWorkflowMode(mode, statusText) {
  const designTab = document.getElementById("designModeTab");
  const analysisTab = document.getElementById("analysisModeTab");
  const status = document.getElementById("workflowModeStatus");
  const showingAnalysis = mode === "analysis";

  designTab?.setAttribute("aria-selected", String(!showingAnalysis));
  analysisTab?.setAttribute("aria-selected", String(showingAnalysis));
  if (analysisTab) analysisTab.disabled = !showingAnalysis;
  if (status) status.textContent = statusText;
}

function captureMaterialState(material) {
  const materials = Array.isArray(material) ? material : [material];
  return materials.filter(Boolean).map(item => ({
    material: item,
    color: item.color?.clone() ?? null,
    opacity: item.opacity,
    transparent: item.transparent,
    wireframe: item.wireframe
  }));
}

function captureDesignWorkspace() {
  const captureObject = object => ({
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    visible: object.visible,
    positionAttribute: object.geometry?.attributes?.position?.array?.slice() ?? null,
    materials: captureMaterialState(object.material)
  });

  designWorkspaceSnapshot = {
    children: [...scene.children],
    objects: scene.children.map(captureObject),
    camera: {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      zoom: camera.zoom
    },
    controls: {
      target: controls.target.clone(),
      enableRotate: controls.enableRotate,
      enablePan: controls.enablePan,
      mouseButtons: { ...controls.mouseButtons },
      keys: { ...controls.keys }
    },
    userResultsDisplay: document.getElementById("userResults")?.style.display ?? "",
    shapeButtonsDisplay: document.getElementById("ShapeButtons")?.style.display ?? "",
    prebuiltShapesDisplay: document.getElementById("square_rect_oval_shapes")?.style.display ?? "",
    allConcShapes: window.allConcShapes
  };
}

function showAnalysisWorkspace(statusText = "Analysis results") {
  const userResults = document.getElementById("userResults");
  const concGui = document.getElementById("concGui");
  const results = document.getElementById("results");
  const dragBar = document.getElementById("drag-bar");
  const userInputProps = document.getElementById("userInputProps");
  const analysisResults = document.getElementById("analysisResults");

  if (userResults) userResults.style.display = "none";
  if (userInputProps) userInputProps.hidden = true;
  if (analysisResults) analysisResults.hidden = false;
  if (results) {
    results.style.display = "block";
    results.style.flex = "1";
  }
  if (dragBar) dragBar.style.display = "block";
  if (concGui) concGui.style.flex = "1";

  setWorkflowMode("analysis", statusText);
  requestAnimationFrame(SceneFunctions.resizeThreeJsScene);
}

function restoreObjectState(state) {
  const { object } = state;
  object.position.copy(state.position);
  object.quaternion.copy(state.quaternion);
  object.scale.copy(state.scale);
  object.visible = state.visible;

  const positionAttribute = object.geometry?.attributes?.position;
  if (positionAttribute && state.positionAttribute) {
    positionAttribute.array.set(state.positionAttribute);
    positionAttribute.needsUpdate = true;
    object.geometry.computeBoundingBox?.();
    object.geometry.computeBoundingSphere?.();
  }

  for (const materialState of state.materials) {
    const material = materialState.material;
    if (materialState.color && material.color) material.color.copy(materialState.color);
    material.opacity = materialState.opacity;
    material.transparent = materialState.transparent;
    if (materialState.wireframe !== undefined) material.wireframe = materialState.wireframe;
    material.needsUpdate = true;
  }
}

function disposeAnalysisObject(object) {
  object.geometry?.dispose?.();
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  for (const material of materials) material?.dispose?.();
}

function returnToDesignWorkspace() {
  if (!designWorkspaceSnapshot) return;

  const snapshot = designWorkspaceSnapshot;
  const designObjects = new Set(snapshot.children);
  SceneFunctions.teardownRaycastingForResults();

  for (const object of [...scene.children]) {
    scene.remove(object);
    if (!designObjects.has(object)) disposeAnalysisObject(object);
  }
  for (const state of snapshot.objects) {
    restoreObjectState(state);
    scene.add(state.object);
  }

  camera.position.copy(snapshot.camera.position);
  camera.quaternion.copy(snapshot.camera.quaternion);
  camera.zoom = snapshot.camera.zoom;
  camera.updateProjectionMatrix();
  controls.target.copy(snapshot.controls.target);
  controls.enableRotate = snapshot.controls.enableRotate;
  controls.enablePan = snapshot.controls.enablePan;
  controls.mouseButtons = { ...snapshot.controls.mouseButtons };
  controls.keys = { ...snapshot.controls.keys };
  controls.update();

  document.getElementById("analysis-results-controls-style")?.remove();
  document.getElementById("analysisResultsTable")?.remove();
  const userResults = document.getElementById("userResults");
  const results = document.getElementById("results");
  const dragBar = document.getElementById("drag-bar");
  const concGui = document.getElementById("concGui");
  const userInputProps = document.getElementById("userInputProps");
  const analysisResults = document.getElementById("analysisResults");
  const selectedPointResults = document.getElementById("selectedPointResultProps");
  const shapeButtons = document.getElementById("ShapeButtons");
  const prebuiltShapes = document.getElementById("square_rect_oval_shapes");

  if (userResults) userResults.style.display = snapshot.userResultsDisplay;
  if (results) {
    results.replaceChildren(Object.assign(document.createElement("h3"), { textContent: "Results" }));
    results.style.display = "none";
  }
  if (dragBar) dragBar.style.display = "none";
  if (concGui) concGui.style.flex = "1";
  if (userInputProps) userInputProps.hidden = false;
  if (analysisResults) {
    analysisResults.innerHTML = "";
    analysisResults.hidden = true;
  }
  if (selectedPointResults) selectedPointResults.innerHTML = "";
  if (shapeButtons) shapeButtons.style.display = snapshot.shapeButtonsDisplay;
  if (prebuiltShapes) prebuiltShapes.style.display = snapshot.prebuiltShapesDisplay;

  window.activeAnalysisSection?.resetAnalysisResults?.();
  window.activeAnalysisSection = null;
  window.allConcShapes = snapshot.allConcShapes;
  window.selectedAngle = 0;
  window.selectedStrainProfileIndex = 4;

  const threeJSDiv = document.getElementById("concGui");
  if (!mouseTrackingHandler) {
    mouseTrackingHandler = SceneFunctions.setupMouseTracking(threeJSDiv, plane, intersectionPoint);
  }
  if (!mouseInteractionHandlers) {
    mouseInteractionHandlers = SceneFunctions.setupMouseInteractions(threeJSDiv);
  }

  designWorkspaceSnapshot = null;
  setWorkflowMode("design", "Editing section — generate PM to analyze");
  requestAnimationFrame(SceneFunctions.resizeThreeJsScene);
}

function getDesignModel() {
  const designChildren = designWorkspaceSnapshot?.children ?? scene.children;
  const childSet = new Set(designChildren);
  return {
    concreteShapes: (window.allConcShapes ?? []).filter(shape => shape?.mesh && childSet.has(shape.mesh)),
    reinforcement: designChildren.filter(object => object?.isRebar === true)
  };
}

function prepareForProjectImport() {
  if (designWorkspaceSnapshot) {
    returnToDesignWorkspace();
  } else {
    SceneFunctions.teardownRaycastingForResults();
    window.activeAnalysisSection?.resetAnalysisResults?.();
    window.activeAnalysisSection = null;
    document.getElementById("analysis-results-controls-style")?.remove();
    document.getElementById("analysisResultsTable")?.remove();
    const results = document.getElementById("results");
    if (results) {
      results.replaceChildren(Object.assign(document.createElement("h3"), { textContent: "Results" }));
      results.style.display = "none";
    }
    const dragBar = document.getElementById("drag-bar");
    if (dragBar) dragBar.style.display = "none";
    setWorkflowMode("design", "Editing imported section — generate PM to analyze");
  }
  designWorkspaceSnapshot = null;
}

function refreshMaterialControls() {
  populateMaterialDropdown();
  populateRebarDropdown();
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
          url,
          (texture) => {
              console.log("Texture Loaded:", texture);
              resolve(texture);
          },
          undefined,
          (error) => {
              console.error("Texture Load Error:", error);
              reject(error);
          }
      );
  });
}

async function initScene() {
  try {
    // sprite = await loadTexture('/static/disc.png'); // Wait for texture to load
    //FOR DEPLOYMENT UPDATE THIS LINE
    sprite = await loadTexture(discTextureUrl);

      console.log("Sprite texture loaded, adding rebar...");
      // ✅ NOW we can safely call this
      setupReplicateShortcut(sprite);
      setupMoveShortcut(); // ⬅️ Add this line to bind the "m" + "v" shortcut



      // addRebar(5, 10, '18', scene, sprite); // Now, sprite is guaranteed to be available
  } catch (error) {
      console.error("Failed to load texture:", error);
  }
}

// ✅ Export a function to get the loaded sprite
export function getSprite() {
  return sprite;
}


document.addEventListener("DOMContentLoaded", () => {
  initScene(); // Initialize scene after texture loads
  window.toggleMaterialsAndShapes = toggleMaterialsAndShapesDiv;
  window.addEventListener('resize', SceneFunctions.resizeThreeJsScene);
  SceneFunctions.setupDragAndAnalyze();
  toggleShapeButtons();
  populateMaterialDropdown();
  populateRebarDropdown();
  initializeProjectPersistence({
    scene,
    getSprite,
    getDesignModel,
    prepareForProjectImport,
    refreshMaterialControls
  });
  document.getElementById("designModeTab")?.addEventListener("click", returnToDesignWorkspace);
  setWorkflowMode("design", "Editing section");


  // Attach addConcGeo to the "Conc" button
  const addPolyBtn = document.getElementById("addPolyBtn");
  if (addPolyBtn) {
      addPolyBtn.addEventListener("click", () => {
          console.log("Conc button clicked! Generating concrete shape...");
          SceneFunctions.addConcGeo(SceneFunctions.getAllSelectedPnts());
      });
  }

  const addHoleBtn = document.getElementById("addHoleBtn");
    if (addHoleBtn) {
        addHoleBtn.addEventListener("click", () => {
            console.log("Hole button clicked! Adding hole...");
            SceneFunctions.addHoleToShape(SceneFunctions.getAllSelectedConcShape(), SceneFunctions.getAllSelectedPnts());
        });
    }

  // Attach event listeners for material and rebar handling
  document.getElementById("materialDropdown").addEventListener("change", updateChartAndTable);
  document.getElementById("addRow").addEventListener("click", addUserDefinedRow);
  document.getElementById("saveMaterial").addEventListener("click", saveUserDefinedMaterial);

  document.getElementById("addShapestoScene").addEventListener("click", () => {
      if (!sprite) {
          console.warn("Texture not yet loaded, please wait.");
          return;
      }
      addShapeToScene(scene, sprite);
  });

  document.addEventListener('keyup', function (e) {
    if (e.key === "Delete") {
        console.log("Delete key pressed, attempting to delete elements...");
        SceneFunctions.deleteSelectedElements();
    }
  });
});



// Attach addPoint function to the button
document.getElementById("addPointBtn").addEventListener("click", SceneFunctions.addPoint);

// Attach addRebarToScene function properly
document.addEventListener("DOMContentLoaded", () => {

  
  document.getElementById("addRebarBtn").addEventListener("click", () => {
      if (!sprite) {
          console.warn("Texture not yet loaded, please wait.");
          return;
      }
      SceneFunctions.addRebarToScene(sprite);
  });


  const generatePMMBtn = document.getElementById("generatePMM-button");
  if (generatePMMBtn) {
      generatePMMBtn.addEventListener("click", () => {

          // Get the selected concrete shape
          const selectedConcShapes = SceneFunctions.getAllSelectedConcShape();
          const selectedRebar = SceneFunctions.getAllSelectedRebar();

          // ✅ Check if either is missing or empty
          if (!selectedConcShapes || selectedConcShapes.length === 0 || !selectedRebar || selectedRebar.length === 0) {
            alert("⚠️ You must select at least one concrete shape and one rebar to proceed.");
            return;
          }

          if (selectedConcShapes.length > 1) {
            const selectedMaterials = new Set(selectedConcShapes.map(shape => shape.material));
            if (selectedMaterials.size !== 1) {
              alert("Composite analysis requires all selected shapes to use the same concrete material.");
              return;
            }
          }

          const edgeSpacing = parseFloat(document.getElementById("edgeSpa").value);
          const interiorSpacing = parseFloat(document.getElementById("intSpa").value);
          if (!Number.isFinite(edgeSpacing) || !Number.isFinite(interiorSpacing)) {
            alert("Edge and interior spacing must be valid numbers.");
            return;
          }

          captureDesignWorkspace();
          showAnalysisWorkspace("Calculating PMM analysis…");
           
          const threeJSDiv = document.getElementById("concGui");

          if (mouseTrackingHandler) {
            threeJSDiv.removeEventListener("mousemove", mouseTrackingHandler);
            console.log("✅ Mouse tracking disabled.");
            mouseTrackingHandler = null; // Prevents multiple removals
          } else {
              console.warn("⚠️ Mouse tracking was already disabled or not assigned properly.");
          }

          // ✅ Disable Mouse Interactions
          if (mouseInteractionHandlers) {
            mouseInteractionHandlers.dispose();
            console.log("✅ Mouse interactions disabled.");
            mouseInteractionHandlers = null;
          }
            
          

          try {
          /////////////   BEGINNING ANALYSIS ///////////////////////
          if (selectedConcShapes.length === 1) {

            const selectedRebar = SceneFunctions.getAllSelectedRebar();
            if (!selectedRebar || selectedRebar.length === 0) {
                console.warn("❌ No rebar selected!");
            } else {
                console.log(`✅ Found rebar,`, selectedRebar);
            }
            const selectedConcShape = selectedConcShapes[0];
            window.activeAnalysisSection = selectedConcShape;
            // ✅ Fire initializeRebarObjects() independently
            selectedConcShape.initializeRebarObjects(selectedRebar);

            // Plot the generated FEM mesh elements in the scene
            if (selectedConcShape.rebarObjects.length > 0) {
              selectedConcShape.rebarObjects.forEach(rebar => {
                  scene.add(rebar);
              });
                console.log("Rebar successfully plotted in the scene.");
            } else {
                console.error("Rebar generation failed or returned empty.");
            }
            

            // // Generate FEM mesh for the selected concrete shape
            selectedConcShape.generateFEMMesh(interiorSpacing, edgeSpacing);

            // Plot the generated FEM mesh elements in the scene
            if (selectedConcShape.FEMmesh && selectedConcShape.FEMmesh.length > 0) {
                selectedConcShape.FEMmesh.forEach(mesh => {
                    scene.add(mesh);
                });

                console.log("FEM mesh successfully plotted in the scene.");
            } else {
                console.error("FEM mesh generation failed or returned empty.");
            }

            selectedConcShape.CalcPnmax("other");
            

            // ✅ Ensure transformation is done before PMM analysis
            console.log("🔹 Transforming coordinates for all angles...");
            for (let angle = 0; angle <= 180; angle += 15) {
                selectedConcShape.transformCoordinatesAtAngle(angle);
            }

            console.log("🔹 Generating PMM for all angles...");
            for (let angle = 0; angle <= 180; angle += 15) {
                selectedConcShape.generateStrains(angle);
                selectedConcShape.generatePMM(angle);
            }


            // ✅ Setup bending angles from 0° to 180° at 15° intervals
            selectedConcShape.setupBendingAngles();

            selectedConcShape.generate3dStressPlot(0, selectedConcShape.strainProfiles[0][0]);
            console.log("YOUR SHAPE")
            console.log(selectedConcShape)
            selectedConcShape.generateTableResults(window.selectedAngle);

            selectedConcShape.setupResultsControls();
            SceneFunctions.setupRaycastingForResults(scene, camera, renderer);
          }
          //testing for composite shape
          else {
            const selectedRebar = SceneFunctions.getAllSelectedRebar();
            const compConcShape = new CompositeConcShape(selectedConcShapes);
            compConcShape.initializeRebarObjects(selectedRebar);
            window.activeAnalysisSection = compConcShape;
        
            // Plot the generated FEM mesh elements in the scene
            if (compConcShape.rebarObjects.length > 0) {
                compConcShape.rebarObjects.forEach(rebar => {
                    scene.add(rebar);
                });
                console.log("Rebar successfully plotted in the scene.");
            } else {
                console.error("Rebar generation failed or returned empty.");
            }
        
            // Generate FEM mesh for the selected concrete shape
            compConcShape.generateCombinedMesh(interiorSpacing, edgeSpacing);
        
            // Plot the generated FEM mesh elements in the scene
            if (compConcShape.FEMmesh && compConcShape.FEMmesh.length > 0) {
                compConcShape.FEMmesh.forEach(mesh => {
                    scene.add(mesh);
                });
        
                console.log("FEM mesh successfully plotted in the scene.");
            } else {
                console.error("FEM mesh generation failed or returned empty.");
            }
            compConcShape.CalcPnmax("other");
            // ✅ Ensure transformation is done before PMM analysis
            console.log("🔹 Transforming coordinates for all angles...");
            for (let angle = 0; angle <= 180; angle += 15) {
              compConcShape.transformCoordinatesAtAngle(angle);
            }
            console.log("🔹 Generating PMM for all angles...");
            for (let angle = 0; angle <= 180; angle += 15) {
              compConcShape.generateStrains(angle);
              compConcShape.generatePMM(angle);
            }

            // ✅ Setup bending angles from 0° to 180° at 15° intervals
            compConcShape.setupBendingAngles();

            compConcShape.generate3dStressPlot(0, compConcShape.strainProfiles[0][0]);

            compConcShape.generateTableResults(window.selectedAngle);

            compConcShape.setupResultsControls();
            SceneFunctions.setupRaycastingForResults(scene, camera, renderer);
        }
          showAnalysisWorkspace("Analysis ready — edit the design to iterate");
          } catch (error) {
            console.error("Failed to generate PMM analysis:", error);
            alert(`Analysis failed: ${error.message}`);
            returnToDesignWorkspace();
          }
      });
  }
});


const concGui = document.querySelector('#concGui');

//Setting up the scene
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, concGui.offsetWidth/concGui.offsetHeight, 0.1, 1000)
const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: document.querySelector('canvas')
})

scene.background = new THREE.Color( 0xffffff );

// Export camera and renderer for use in other files
export { camera, renderer, scene, controls };


renderer.setSize(concGui.offsetWidth, concGui.offsetHeight)
renderer.setPixelRatio(window.devicePixelRatio)

//////////this the region of the dot///////////////
var dotGeometry = new THREE.BufferGeometry();
dotGeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [0,0,0], 3 ) );
var dotMaterial = new THREE.PointsMaterial( { size: 0.5, color: 0x000000 } );


var dot = new THREE.Points( dotGeometry, dotMaterial );

dot.isReference = true
scene.add( dot );

// Function to update dot position dynamically
function updateDotPosition() {
  let X = parseFloat(document.getElementById("X_Vals").value) || 0;
  let Y = parseFloat(document.getElementById("Y_Vals").value) || 0;

  // Update the position attribute of the existing dotGeometry
  let newPosition = new Float32Array([X, Y, 0]); 
  dot.geometry.attributes.position.array.set(newPosition);
  dot.geometry.attributes.position.needsUpdate = true; // Required for Three.js to recognize changes

  console.log(`Updated dot position to: (${X}, ${Y})`);
}

// Attach event listeners to X and Y input fields
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("X_Vals").addEventListener("input", updateDotPosition);
  document.getElementById("Y_Vals").addEventListener("input", updateDotPosition);
});





const light = new THREE.DirectionalLight(0xffffff, 1)
light.position.set(0, -1, 5)
scene.add(light)

const backLight = new THREE.DirectionalLight(0xffffff, 1)
backLight.position.set(0, 0, -5)
scene.add(backLight)

const controls = new OrbitControls(camera, renderer.domElement)
controls.mouseButtons = {MIDDLE: THREE.MOUSE.PAN}
controls.enableRotate = false;
//controls.enablePan = false;

camera.position.z = 50

const axesHelper = new THREE.AxesHelper( 5 );
scene.add( axesHelper );

const size = 20;
const divisions = 20;

const gridHelper = new THREE.GridHelper( size, divisions );
gridHelper.rotation.x=Math.PI/2; //gets grid oriented in XY axis
scene.add( gridHelper );

// Assuming `concGui` is your top-level div
const topDiv = document.querySelector('#concGui');

// Create a reference plane for intersection detection
const planeGeometry = new THREE.PlaneGeometry(50, 50);
const planeMaterial = new THREE.MeshBasicMaterial({ visible: false });
const plane = new THREE.Mesh(planeGeometry, planeMaterial);
scene.add(plane);

// Create the intersection point marker
const intersectionPointGeometry = new THREE.SphereGeometry(0.3, 16, 16);
const intersectionPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const intersectionPoint = new THREE.Mesh(intersectionPointGeometry, intersectionPointMaterial);
intersectionPoint.visible = false;
scene.add(intersectionPoint);

// Call the function to enable mouse tracking

  


// Call the function to enable mouse tracking and store the handler
let mouseTrackingHandler = SceneFunctions.setupMouseTracking(topDiv, plane, intersectionPoint);
let mouseInteractionHandlers = SceneFunctions.setupMouseInteractions(topDiv);

renderer.render( scene, camera );
console.log(scene)

let frame = 0
function animate() {
  requestAnimationFrame(animate);  // Keep looping
  controls.update();               // Update OrbitControls
  renderer.render(scene, camera);  // Render the scene
}

animate();  // Start animation loop
