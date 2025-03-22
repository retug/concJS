import * as THREE from 'three';
import { scene } from './main.js'; 
import { rebarDia, addPoint, addRebarToScene, getAllSelectedRebar, getAllSelectedPnts, getAllSelectedConcShape } from '././threeJSscenefunctions.js'; 
import { ConcShape } from './concShape.js'; 


export function setupReplicateShortcut(sprite) {
    let lastCPressTime = 0;
    const doublePressInterval = 400;

    document.addEventListener('keydown', function (e) {
        const currentTime = new Date().getTime();

        if (e.key.toLowerCase() === 'c') {
            if (currentTime - lastCPressTime < doublePressInterval) {
                

                const Xreplicate = parseFloat(prompt("What value of X"));
                const Yreplicate = parseFloat(prompt("What value of Y"));
                alert("X value = " + Xreplicate + " Y value = " + Yreplicate);

                // Get updated selections
                const allSelectedPnts = getAllSelectedPnts();
                const allSelectedRebar = getAllSelectedRebar();
                const allSelectedConc = getAllSelectedConcShape(); // this returns an array now

                // Replicate points
                for (let i = 0; i < allSelectedPnts.length; i++) {
                    const xcurrent = allSelectedPnts[i].geometry.attributes.position.array[0];
                    const ycurrent = allSelectedPnts[i].geometry.attributes.position.array[1];
                    const newX = xcurrent + Xreplicate;
                    const newY = ycurrent + Yreplicate;

                    document.getElementById("X_Vals").value = newX;
                    document.getElementById("Y_Vals").value = newY;
                    addPoint();
                }

                // Replicate rebar
                for (const pnt of allSelectedRebar) {
                    const xcurrent = pnt.geometry.attributes.position.array[0];
                    const ycurrent = pnt.geometry.attributes.position.array[1];
                    const barSize = pnt.rebarSize;

                    const newX = xcurrent + Xreplicate;
                    const newY = ycurrent + Yreplicate;

                    document.getElementById("X_Vals").value = newX;
                    document.getElementById("Y_Vals").value = newY;
                    document.getElementById("rebar_Vals").value = barSize;

                    addRebarToScene(sprite);
                }

                // Replicate selected concrete shape
                const allSelectedConcs = getAllSelectedConcShape();
                for (const selectedConc of allSelectedConcs) {
                    // Skip if basePoints or baseshape is not defined
                    const originalPoints = selectedConc.basePoints || selectedConc.baseshape?.getPoints();
                
                    if (!originalPoints || originalPoints.length === 0) {
                        console.warn("❌ No base points found for concrete shape.");
                        continue;
                    }
                
                    // Offset base points
                    const newBasePoints = originalPoints.map(p => ({
                        x: p.x + Xreplicate,
                        y: p.y + Yreplicate
                    }));
                
                    // Offset holes
                    const newHoles = selectedConc.holes.map(hole => {
                        const newHole = new THREE.Path();
                        const holePts = hole.getPoints();
                        holePts.forEach((pt, idx) => {
                            const offsetPt = new THREE.Vector2(pt.x + Xreplicate, pt.y + Yreplicate);
                            if (idx === 0) {
                                newHole.moveTo(offsetPt.x, offsetPt.y);
                            } else {
                                newHole.lineTo(offsetPt.x, offsetPt.y);
                            }
                        });
                        return newHole;
                    });
                
                    // Create new ConcShape and add to scene
                    const newConcShape = new ConcShape(newBasePoints, selectedConc.material, newHoles);
                    newConcShape.generateMesh();
                    scene.add(newConcShape.mesh);
                }
            }

            lastCPressTime = currentTime;
        }
    });
}

export function setupMoveShortcut() {
    let mPressed = false;

    document.addEventListener('keydown', function (e) {
        if (e.key.toLowerCase() === 'm') {
            mPressed = true;
        }

        if (e.key.toLowerCase() === 'v' && mPressed) {
            const Xmove = parseFloat(prompt("Enter X movement"));
            const Ymove = parseFloat(prompt("Enter Y movement"));
            alert(`Moving selected objects by X = ${Xmove}, Y = ${Ymove}`);

            // Move points
            const selectedPnts = getAllSelectedPnts();
            for (const pnt of selectedPnts) {
                const positionAttr = pnt.geometry.attributes.position;
                positionAttr.array[0] += Xmove;
                positionAttr.array[1] += Ymove;
                positionAttr.needsUpdate = true;
                pnt.geometry.computeBoundingBox();
                pnt.geometry.computeBoundingSphere();
            }

            // Move rebar
            const selectedRebar = getAllSelectedRebar();
            for (const rebar of selectedRebar) {
                const posAttr = rebar.geometry.attributes.position;
                posAttr.array[0] += Xmove;
                posAttr.array[1] += Ymove;
                posAttr.needsUpdate = true;
                rebar.geometry.computeBoundingBox();
                rebar.geometry.computeBoundingSphere();
            }

            // Move concrete shapes
            // Move concrete shapes
            const allSelectedConc = getAllSelectedConcShape(); // this returns an array now
            for (const conc of allSelectedConc) {
                conc.generateMovedMesh(Xmove, Ymove, allSelectedConc);
            }
        }
    });

    document.addEventListener('keyup', function (e) {
        if (e.key.toLowerCase() === 'm') {
            mPressed = false;
        }
    });
}


