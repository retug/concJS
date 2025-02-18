import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import { toggleMaterialsAndShapesDiv, toggleShapeButtons, getActiveShape, createRectangleShape, addShapeToScene } from './materialsandShapes.js';
import { populateMaterialDropdown, updateChartAndTable, addUserDefinedRow, saveUserDefinedMaterial, populateRebarDropdown } from './materialsPlotting.js';
import * as SceneFunctions from './threeJSscenefunctions.js';


const loader = new THREE.TextureLoader();
let sprite = null; // Store the loaded texture globally

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
      sprite = await loadTexture('/static/disc.png'); // Wait for texture to load

      console.log("Sprite texture loaded, adding rebar...");
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
            SceneFunctions.addHoleToShape(SceneFunctions.getSelectedConcShape(), SceneFunctions.getAllSelectedPnts());
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
          console.log("Generate PM button clicked! Creating FEM mesh...");

          // Get the selected concrete shape
          const selectedConcShape = SceneFunctions.getSelectedConcShape();
          if (!selectedConcShape) {
              console.warn("No concrete shape selected!");
              return;
          }

           // ✅ Get selected rebar
          const selectedRebar = SceneFunctions.getAllSelectedRebar();
          if (!selectedRebar || selectedRebar.length === 0) {
              console.warn("❌ No rebar selected!");
          } else {
              console.log(`✅ Found rebar,`, selectedRebar);
          }

        // ✅ Fire initializeRebarObjects() independently
        selectedConcShape.initializeRebarObjects(selectedRebar);
        

        

          

          // Read input values for edge and interior spacing
          const edgeSpacing = parseFloat(document.getElementById("edgeSpa").value);
          const interiorSpacing = parseFloat(document.getElementById("intSpa").value);

          if (isNaN(edgeSpacing) || isNaN(interiorSpacing)) {
              console.error("Invalid edge or interior spacing input!");
              return;
          }

          // Generate FEM mesh for the selected concrete shape
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
          let angle = 45;
          // ✅ Transform coordinates for 45-degree angle
          selectedConcShape.transformCoordinatesAtAngle(angle, selectedRebar);
          // ✅ Generate Strain profiles for the given angle
          selectedConcShape.generateStrains(angle);

          console.log(`✅ rebar objects.`, selectedConcShape.rebarObjects);
          selectedConcShape.generatePMM(angle)
          selectedConcShape.plotPMMResults();
          selectedConcShape.generate3dStressPlot(angle, selectedConcShape.strainProfiles[angle][5]);
          selectedConcShape.setupResultsControls();

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
SceneFunctions.setupMouseTracking(topDiv, plane, intersectionPoint);
SceneFunctions.setupMouseInteractions(topDiv);

renderer.render( scene, camera );

let frame = 0
function animate() {
  requestAnimationFrame(animate);  // Keep looping
  controls.update();               // Update OrbitControls
  renderer.render(scene, camera);  // Render the scene
}

animate();  // Start animation loop