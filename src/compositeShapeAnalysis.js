import Delaunator from 'delaunator';
import * as THREE from 'three';
import { scene } from "./main.js";
import { AnalyzableConcreteSection } from './analysis/AnalyzableConcreteSection.js';

export class CompositeConcShape extends AnalyzableConcreteSection {

    constructor(concShapes) {
        if (!Array.isArray(concShapes) || concShapes.length === 0) {
            throw new Error("A composite section requires at least one concrete shape.");
        }

        const uniqueMaterials = new Set(concShapes.map(shape => shape.material));
        if (uniqueMaterials.size !== 1) {
            throw new Error("Composite analysis requires all selected shapes to use the same concrete material.");
        }

        super(concShapes[0].material);
        this.concShapes = concShapes;
        this.combinedPoints = [];
        this.triangles = [];
    }

    generateCombinedMesh() {
        const allPoints = [];
    
        for (const shape of this.concShapes) {
            const { boundaryPnts, holePnts, generatedPnts } = shape.generateShapeDelaunayPoints();
            const combined = [...boundaryPnts, ...holePnts, ...generatedPnts];
            allPoints.push(...combined);
        }
    
        // ✅ Deduplicate points based on distance threshold
        const minDistance = 0.3;
        const uniquePoints = [];
    
        for (let i = 0; i < allPoints.length; i++) {
            const [x1, y1] = allPoints[i];
            let isDuplicate = false;
    
            for (let j = 0; j < uniquePoints.length; j++) {
                const [x2, y2] = uniquePoints[j];
                const distSq = (x1 - x2) ** 2 + (y1 - y2) ** 2;
                if (distSq < minDistance ** 2) {
                    isDuplicate = true;
                    break;
                }
            }
    
            if (!isDuplicate) {
                uniquePoints.push(allPoints[i]);
            }
        }
    
        this.combinedPoints = uniquePoints;
    
        // ✅ Delaunay triangulation on cleaned points
        const delaunay = Delaunator.from(this.combinedPoints);
        this.triangles = this._drawTriangles(delaunay.triangles, this.combinedPoints);
        this.FEMmesh = this._drawTrianglesThree(this.triangles);
    }

    _drawTriangles(triIndices, points) {
        const triangles = [];
        for (let i = 0; i < triIndices.length; i += 3) {
            triangles.push([
                points[triIndices[i]],
                points[triIndices[i + 1]],
                points[triIndices[i + 2]]
            ]);
        }
        return triangles;
    }

    _drawTrianglesThree(triangleData) {
        const elements = [];
        this.FEMarea = 0;
        this.centroidX = 0;
        this.centroidY = 0;

        for (let tri of triangleData) {
            const geometry = new THREE.BufferGeometry();
            const vertices = new Float32Array(tri.flatMap(([x, y]) => [x, y, 0]));
            geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
            geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices.length), 3));

            const material = new THREE.MeshBasicMaterial({ wireframe: true, vertexColors: true, side: THREE.DoubleSide });
            const mesh = new THREE.Mesh(geometry, material);

            // Compute area and centroid
            mesh.area = this._triangleArea(tri);
            mesh.centroid = this._triangleCentroid(tri);

            // Perform raycast check across all concShapes
            let isInside = false;
            for (const shape of this.concShapes) {
                if (!shape.containsEllipse && shape.rayCasting([mesh.centroid.x, mesh.centroid.y])[0]) {
                    isInside = true;
                    break;
                } else if (shape.containsEllipse && shape.rayCastingEllipse([mesh.centroid.x, mesh.centroid.y])[0]) {
                    isInside = true;
                    break;
                }
            }

            if (isInside) {
                scene.add(mesh);
                elements.push(mesh);

                this.FEMarea += mesh.area;
                this.centroidX += mesh.area * mesh.centroid.x;
                this.centroidY += mesh.area * mesh.centroid.y;
                mesh.userData.concShape = this.concShapes[0]; // This stores the reference to the parent ConcShape 
                // Future Work if you want to store multiple concrete Properties
                mesh.userData.compShape = this; // Used for plotting            
                }
            // Remove all objects from the scene that are not FEMmesh objects and keep all rebar objects
            scene.children = scene.children.filter(obj => this.FEMmesh.includes(obj) || obj.isRebar);
        }

        // Finalize centroid
        if (this.FEMarea > 0) {
            this.centroidX /= this.FEMarea;
            this.centroidY /= this.FEMarea;
        } else {
            console.warn("❌ Total FEM area is zero, cannot compute centroid.");
        }

        console.log("📐 FEM Area:", this.FEMarea.toFixed(2));
        console.log("📍 Centroid X:", this.centroidX.toFixed(2));
        console.log("📍 Centroid Y:", this.centroidY.toFixed(2));

        return elements;
    }

    _triangleArea([[x1, y1], [x2, y2], [x3, y3]]) {
        return Math.abs((x1 * y2 + x2 * y3 + x3 * y1) - (y1 * x2 + y2 * x3 + y3 * x1)) / 2;
    }

    _triangleCentroid([[x1, y1], [x2, y2], [x3, y3]]) {
        return {
            x: (x1 + x2 + x3) / 3,
            y: (y1 + y2 + y3) / 3
        };
    }

    // ✅ Stores Three.js Points objects directly

    checkMaterialConsistency() {
        const uniqueMaterials = new Set(this.concShapes.map(shape => shape.material));

        if (uniqueMaterials.size !== 1) {
            throw new Error("Composite analysis requires all selected shapes to use the same concrete material.");
        }

        return true;
    }

    // Generate Strain Profiles for the PMM Analysis, returns [m and b] of y = mx +b linear strain equation


    // Function to convert Mu and Mv to Mx and My


    //assumes a linear strain distribution


    // Given the angle, generate the associated P, Mu, Mv.

    
    //ACI 318-19 Table 21.2.2







    
    



    // ✅ Resets previously highlighted point to its default state


    // ✅ Highlights the selected point in the 3D PMM plot



    





    


    
    


    
    


    //Shift plus middle mouse button to rotate


}
