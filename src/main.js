import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import { toggleMaterialsAndShapesDiv, toggleShapeButtons, getActiveShape, createRectangleShape, addShapeToScene } from './materialsandShapes.js';
import { populateMaterialDropdown, updateChartAndTable, addUserDefinedRow, saveUserDefinedMaterial, populateRebarDropdown } from './materialsPlotting.js';
import * as SceneFunctions from './threeJSscenefunctions.js';
import { setupReplicateShortcut, setupMoveShortcut } from './CADfunctions.js';
import { CompositeConcShape } from './compositeShapeAnalysis.js';
import {
  initializeProjectPersistence,
  replaceCurrentProject,
  serializeCurrentProject,
  showProjectDiagnostics,
  showProjectNotice
} from './projectPersistence.js';
import { initializeProjectCache } from './projectCache.js';
import { removeEditablePolygonMeshes } from './analysisScene.js';
import {
  cameraInteractionForMode,
  perspectiveFitDistance,
  orthographicFitHeight
} from './cameraView.js';
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
let sceneCameraMode = 'perspective';
let savedPerspectiveView = null;

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
      mode: sceneCameraMode,
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
  const responseControl = document.getElementById("sectionResponseControl");

  if (userResults) userResults.style.display = "none";
  if (userInputProps) userInputProps.hidden = true;
  if (analysisResults) analysisResults.hidden = false;
  if (responseControl) responseControl.hidden = false;
  if (results) {
    results.style.display = "block";
    results.style.flex = "1";
  }
  if (dragBar) dragBar.style.display = "block";
  if (concGui) concGui.style.flex = "1";

  setDesignGridVisible(false);
  setSceneCameraMode('top');

  // The editable filled polygons are design-only objects. Removing them from
  // the live analysis scene exposes the resolved FEM surface and is safe
  // because captureDesignWorkspace() restores the original objects later.
  removeEditablePolygonMeshes(scene);

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

  setSceneCameraMode(snapshot.camera.mode ?? 'perspective', {
    fit: false,
    restorePerspective: false
  });
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
  const responseControl = document.getElementById("sectionResponseControl");
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
  if (responseControl) responseControl.hidden = true;
  if (shapeButtons) shapeButtons.style.display = snapshot.shapeButtonsDisplay;
  if (prebuiltShapes) prebuiltShapes.style.display = snapshot.prebuiltShapesDisplay;
  setDesignGridVisible(true);

  window.activeAnalysisSection?.resetAnalysisResults?.();
  window.activeAnalysisSection = null;
  window.allConcShapes = snapshot.allConcShapes;
  window.selectedAngle = 0;
  window.selectedStrainProfileIndex = 4;

  const threeJSDiv = document.getElementById("concGui");
  if (!mouseTrackingHandler) {
    mouseTrackingHandler = SceneFunctions.setupMouseTracking(threeJSDiv, intersectionPoint);
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

function frameCreatedShapes(shapes) {
  const meshes = (shapes ?? []).map(shape => shape?.mesh).filter(Boolean);
  fitCameraToObjects(meshes);
}

function getActiveCameraObjects() {
  const activeSection = window.activeAnalysisSection;
  const analysisObjects = [
    ...(activeSection?.FEMmesh ?? []),
    ...(activeSection?.rebarObjects ?? [])
  ].filter(Boolean);
  if (analysisObjects.length) return analysisObjects;

  const design = getDesignModel();
  return [
    ...design.concreteShapes.map(shape => shape?.mesh),
    ...design.reinforcement
  ].filter(Boolean);
}

function fitCameraToObjects(objects, padding = 1.18) {
  if (!objects?.length) return;
  const bounds = new THREE.Box3();
  for (const object of objects) bounds.expandByObject(object);
  if (bounds.isEmpty()) return;

  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const aspect = Math.max(concGui?.clientWidth ?? 1, 1) / Math.max(concGui?.clientHeight ?? 1, 1);

  if (camera.isOrthographicCamera) {
    const viewHeight = orthographicFitHeight(size, aspect, padding);
    camera.userData.fitSize = { x: size.x, y: size.y };
    camera.userData.fitPadding = padding;
    camera.userData.viewHeight = viewHeight;
    camera.left = -(viewHeight * aspect) / 2;
    camera.right = (viewHeight * aspect) / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    camera.zoom = 1;
    camera.position.set(center.x, center.y, center.z + Math.max(100, size.z * 4 + 20));
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
  } else {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const distance = perspectiveFitDistance(size, verticalFov, aspect, padding);
    camera.aspect = aspect;
    camera.position.set(center.x, center.y, center.z + distance + size.z / 2);
    camera.updateProjectionMatrix();
  }

  camera.lookAt(center);
  controls.target.copy(center);
  controls.update();
}

function captureCameraView(sourceCamera) {
  return {
    position: sourceCamera.position.clone(),
    quaternion: sourceCamera.quaternion.clone(),
    zoom: sourceCamera.zoom,
    target: controls.target.clone()
  };
}

function updateCameraControlUI(mode) {
  document.querySelectorAll('input[name="sectionCameraMode"]').forEach(input => {
    input.checked = input.value === mode;
  });
  const hint = document.getElementById('sectionCameraHint');
  if (hint) {
    hint.textContent = mode === 'top'
      ? 'Orthographic top view · zoom only'
      : 'Rotate, pan, and zoom';
  }
}

export function setSceneCameraMode(mode, { fit = true, restorePerspective = true } = {}) {
  const nextMode = mode === 'top' ? 'top' : 'perspective';

  if (nextMode === 'top') {
    if (camera.isPerspectiveCamera) savedPerspectiveView = captureCameraView(camera);
    camera = orthographicCamera;
  } else {
    camera = perspectiveCamera;
  }

  sceneCameraMode = nextMode;
  controls.object = camera;
  const interaction = cameraInteractionForMode(nextMode);
  controls.enableZoom = interaction.enableZoom;
  controls.enableRotate = interaction.enableRotate && Boolean(designWorkspaceSnapshot);
  controls.enablePan = interaction.enablePan && Boolean(designWorkspaceSnapshot);
  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  if (nextMode === 'perspective' && restorePerspective && savedPerspectiveView) {
    camera.position.copy(savedPerspectiveView.position);
    camera.quaternion.copy(savedPerspectiveView.quaternion);
    camera.zoom = savedPerspectiveView.zoom;
    controls.target.copy(savedPerspectiveView.target);
    camera.updateProjectionMatrix();
    controls.update();
  } else if (fit) {
    fitCameraToObjects(getActiveCameraObjects());
  }

  updateCameraControlUI(nextMode);
  SceneFunctions.resizeThreeJsScene();
  if (window.activeAnalysisSection) {
    SceneFunctions.setupRaycastingForResults(scene, camera, renderer);
  }
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
  const sceneReady = initScene(); // Cache restoration waits for the rebar texture.
  window.toggleMaterialsAndShapes = toggleMaterialsAndShapesDiv;
  window.addEventListener('resize', SceneFunctions.resizeThreeJsScene);
  SceneFunctions.setupDragAndAnalyze();
  toggleShapeButtons();
  populateMaterialDropdown();
  populateRebarDropdown();
  const projectPersistenceContext = {
    scene,
    getSprite,
    getDesignModel,
    prepareForProjectImport,
    refreshMaterialControls,
    onProjectReplaced: staged => {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        SceneFunctions.resizeThreeJsScene();
        frameCreatedShapes(staged.concreteShapes);
      }));
    }
  };
  initializeProjectPersistence(projectPersistenceContext);
  initializeProjectCache({
    ready: sceneReady,
    serializeProject: () => serializeCurrentProject(getDesignModel()),
    replaceProject: project => replaceCurrentProject(project, projectPersistenceContext),
    showNotice: showProjectNotice,
    showDiagnostics: showProjectDiagnostics
  });
  document.getElementById("designModeTab")?.addEventListener("click", returnToDesignWorkspace);
  document.querySelectorAll('input[name="sectionResponseMode"]').forEach(input => {
    input.addEventListener("change", event => {
      if (!event.target.checked) return;
      window.activeAnalysisSection?.setSectionResponseMode?.(event.target.value);
    });
  });
  document.querySelectorAll('input[name="sectionCameraMode"]').forEach(input => {
    input.addEventListener("change", event => {
      if (!event.target.checked) return;
      setSceneCameraMode(event.target.value);
    });
  });
  if (typeof ResizeObserver !== 'undefined') {
    const sceneResizeObserver = new ResizeObserver(() => SceneFunctions.resizeThreeJsScene());
    sceneResizeObserver.observe(concGui);
  }
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
      try {
        const createdShapes = addShapeToScene(scene, sprite);
        frameCreatedShapes(createdShapes);
      } catch (error) {
        console.error('Could not add prebuilt shape:', error);
        alert(error.message);
      }
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

          if (!selectedConcShapes || selectedConcShapes.length === 0) {
            alert("Select at least one section polygon to proceed. Rebar is optional for plate-composite sections.");
            return;
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
                console.info("No discrete rebar selected; using polygon material regions for analysis.");
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
                console.info("No discrete rebar selected; using polygon material regions for analysis.");
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
const initialAspect = Math.max(concGui.offsetWidth, 1) / Math.max(concGui.offsetHeight, 1);
const perspectiveCamera = new THREE.PerspectiveCamera(75, initialAspect, 0.1, 1000)
const orthographicCamera = new THREE.OrthographicCamera(-10 * initialAspect, 10 * initialAspect, 10, -10, 0.1, 2000)
let camera = perspectiveCamera;
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

perspectiveCamera.position.z = 50
orthographicCamera.position.z = 100

const axesHelper = new THREE.AxesHelper( 5 );
scene.add( axesHelper );

const gridPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const gridRaycaster = new THREE.Raycaster();
let gridHelper = null;
let gridSignature = '';

function setDesignGridVisible(visible) {
  if (gridHelper) gridHelper.visible = visible;
}

function gridStepForSpan(span) {
  const roughStep = Math.max(span / 180, 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

function visibleGridBounds() {
  camera.updateMatrixWorld();
  const bounds = new THREE.Box2();
  const hit = new THREE.Vector3();
  const corners = [
    new THREE.Vector2(-1, -1),
    new THREE.Vector2(1, -1),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(-1, 1)
  ];

  for (const corner of corners) {
    gridRaycaster.setFromCamera(corner, camera);
    if (!gridRaycaster.ray.intersectPlane(gridPlane, hit)) return null;
    bounds.expandByPoint(new THREE.Vector2(hit.x, hit.y));
  }
  return bounds.isEmpty() ? null : bounds;
}

function updateDynamicGrid() {
  // The design snapshot owns its helper objects while results are visible.
  // Freeze the grid during analysis so returning to design restores it intact.
  if (designWorkspaceSnapshot) return;
  const bounds = visibleGridBounds();
  if (!bounds) return;

  const center = bounds.getCenter(new THREE.Vector2());
  const span = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, 1);
  const step = gridStepForSpan(span);
  const centerX = Math.round(center.x / step) * step;
  const centerY = Math.round(center.y / step) * step;
  const halfExtent = Math.max(
    Math.abs(bounds.min.x - centerX),
    Math.abs(bounds.max.x - centerX),
    Math.abs(bounds.min.y - centerY),
    Math.abs(bounds.max.y - centerY)
  ) * 1.08;
  let divisions = Math.max(2, Math.ceil((halfExtent * 2) / step));
  if (divisions % 2 !== 0) divisions += 1;
  const size = divisions * step;
  const nextSignature = [centerX, centerY, size, divisions].join(':');
  if (nextSignature === gridSignature) return;

  const nextGrid = new THREE.GridHelper(size, divisions, 0x7b818a, 0xa7adb5);
  nextGrid.rotation.x = Math.PI / 2;
  nextGrid.position.set(centerX, centerY, -0.02);
  nextGrid.userData.isDynamicDesignGrid = true;
  nextGrid.renderOrder = -10;

  if (gridHelper) {
    scene.remove(gridHelper);
    gridHelper.geometry.dispose();
    const materials = Array.isArray(gridHelper.material) ? gridHelper.material : [gridHelper.material];
    materials.forEach(material => material?.dispose?.());
  }
  gridHelper = nextGrid;
  gridSignature = nextSignature;
  scene.add(gridHelper);
}

updateDynamicGrid();

// Assuming `concGui` is your top-level div
const topDiv = document.querySelector('#concGui');

// Create the intersection point marker
const intersectionPointGeometry = new THREE.SphereGeometry(0.3, 16, 16);
const intersectionPointMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
const intersectionPoint = new THREE.Mesh(intersectionPointGeometry, intersectionPointMaterial);
intersectionPoint.visible = false;
scene.add(intersectionPoint);

// Call the function to enable mouse tracking

  


// Call the function to enable mouse tracking and store the handler
let mouseTrackingHandler = SceneFunctions.setupMouseTracking(topDiv, intersectionPoint);
let mouseInteractionHandlers = SceneFunctions.setupMouseInteractions(topDiv);

renderer.render( scene, camera );
console.log(scene)

let frame = 0
function animate() {
  requestAnimationFrame(animate);  // Keep looping
  controls.update();               // Update OrbitControls
  updateDynamicGrid();             // Keep the design grid fitted to the visible XY plane
  renderer.render(scene, camera);  // Render the scene
}

animate();  // Start animation loop
