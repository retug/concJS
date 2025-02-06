import './style.css';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import { toggleMaterialsAndShapesDiv, toggleShapeButtons, getActiveShape, createRectangleShape, addShapeToScene } from './materialsandShapes.js';
import { populateMaterialDropdown, updateChartAndTable, addUserDefinedRow, saveUserDefinedMaterial, populateRebarDropdown } from './materialsPlotting.js';
import {resizeThreeJsScene, setupDragAndAnalyze, addRebar } from './threeJSscenefunctions.js'


const loader = new THREE.TextureLoader();
let sprite = null; // Store the loaded texture globally

// // Load rebar sprite texture and store it
// loader.load('/static/disc.png', function(texture) {
//     console.log("Texture Loaded:", texture);
//     sprite = texture; // Store the loaded texture
// }, undefined, function(error) {
//     console.error("Texture Load Error:", error);
// });

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
      addRebar(5, 10, '18', scene, sprite); // Now, sprite is guaranteed to be available
  } catch (error) {
      console.error("Failed to load texture:", error);
  }
}



// Attach the function to the global window object
window.toggleMaterialsAndShapes = toggleMaterialsAndShapesDiv;
window.addEventListener('resize', resizeThreeJsScene);
document.addEventListener("DOMContentLoaded", () => {
  initScene(); // Initialize scene after texture loads
  setupDragAndAnalyze();
  toggleShapeButtons();
  populateMaterialDropdown();
  populateRebarDropdown();

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
export { camera, renderer, scene };


renderer.setSize(concGui.offsetWidth, concGui.offsetHeight)
renderer.setPixelRatio(window.devicePixelRatio)

//////////this the region of the dot///////////////
var dotGeometry = new THREE.BufferGeometry();
dotGeometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [0,0,0], 3 ) );
var dotMaterial = new THREE.PointsMaterial( { size: 0.5, color: 0x000000 } );

var dot = new THREE.Points( dotGeometry, dotMaterial );

dot.isReference = true
scene.add( dot );



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

renderer.render( scene, camera );

let frame = 0
function animate() {
  requestAnimationFrame(animate);  // Keep looping
  controls.update();               // Update OrbitControls
  renderer.render(scene, camera);  // Render the scene
}

animate();  // Start animation loop