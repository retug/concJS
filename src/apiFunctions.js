import * as THREE from 'three'; 
import { defaultMaterials, getMaterialByName } from './materials.js';
import { ConcShape } from './concShape.js'; 
import { CompositeConcShape } from'./compositeShapeAnalysis.js';


export async function analyzeFromJSON(jsonData) {
    debugger;
    console.log(jsonData.Concrete.ConcreteMaterial)
    const concreteMaterial = getMaterialByName(jsonData.Concrete.ConcreteMaterial);
    console.log(concreteMaterial)
  
    // Convert all input points [x, y] → {x, y}
    const convertPoints = (arr) => arr.map(([x, y]) => ({ x, y }));
  
    const concShapes = jsonData.Concrete.ConcreteShape.map((shape, i) => {
      console.log(`Shape[${i}]`, shape);
    
      const { concShapePnts, type } = shape;
    
      if (type === "polygon") {
        return new ConcShape(convertPoints(concShapePnts), concreteMaterial);
      } else {
        console.warn("Unsupported shape type:", type);
        return null;
      }
    }).filter(shape => shape !== null);

    console.log(concShapes)
  
    // Add holes to the first shape only
    if (concShapes.length && jsonData.Concrete.ConcreteShapeHoles) {
      jsonData.Concrete.ConcreteShapeHoles.forEach(({ concShapePnts, type }) => {
        if (type === "polygon") {
          concShapes[0].addHole(convertPoints(concShapePnts));
        }
      });
    }
  
    const rebarObjects = jsonData.Rebar.map(({ x, y, size, material }) => {
        const geometry = new THREE.BufferGeometry();
        const vertices = new Float32Array([x, y, 0]); // Assuming z = 0 for 2D
        geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      
        const pointsMaterial = new THREE.PointsMaterial({
          color: 0xff0000,
          size: 0.3,
          sizeAttenuation: false
        });

      
        const point = new THREE.Points(geometry, pointsMaterial);
        point.isRebar = true;
        point.rebarSize = size;
        point.materialData = getMaterialByName(material);
      
        return point;
    });
  
    let result;
  
    // === SINGLE SHAPE ANALYSIS ===
    if (concShapes.length === 1) {
      const shape = concShapes[0];
      shape.initializeRebarObjects(rebarObjects);
      shape.generateFEMMesh(jsonData.interiorSpacing, jsonData.edgeSpacing);
      shape.CalcPnmax("other");
  
      for (let angle = 0; angle <= 180; angle += 15) {
        shape.transformCoordinatesAtAngle(angle, true);
      }
      for (let angle = 0; angle <= 180; angle += 15) {
        shape.generateStrains(angle);
        shape.generatePMM(angle);
      }
  
        
      result = shape.PMMXYresults

  
    } else {
      // === COMPOSITE ANALYSIS ===
      const composite = new CompositeConcShape(concShapes);
      composite.initializeRebarObjects(rebarObjects);
  
      const isMaterialConsistent = composite.checkMaterialConsistency();
      composite.material = concShapes[0].material;
      if (!isMaterialConsistent) {
        alert("⚠️ Warning: Selected shapes have different concrete materials. Results will be inaccurate.");
      }
  
      composite.generateCombinedMesh(jsonData.interiorSpacing, jsonData.edgeSpacing);
      composite.CalcPnmax("other");
  
      for (let angle = 0; angle <= 180; angle += 15) {
        composite.transformCoordinatesAtAngle(angle, true);
      }
      for (let angle = 0; angle <= 180; angle += 15) {
        composite.generateStrains(angle);
        composite.generatePMM(angle);
      }

  
      result = composite.PMMXYresults;

    }
  
    return result;
}
