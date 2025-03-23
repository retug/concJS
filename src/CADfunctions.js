import * as THREE from 'three';
import { scene } from './main.js'; 
import { rebarDia, addPoint, addRebarToScene, getAllSelectedRebar, getAllSelectedPnts, getAllSelectedConcShape } from '././threeJSscenefunctions.js'; 
import { ConcShape } from './concShape.js'; 


export function setupReplicateShortcut(sprite) {
    let lastCPressTime = 0;
    const doublePressInterval = 400;

    function replicateAction() {
        const Xreplicate = parseFloat(prompt("What value of X"));
        const Yreplicate = parseFloat(prompt("What value of Y"));
        alert("X value = " + Xreplicate + " Y value = " + Yreplicate);

        const allSelectedPnts = getAllSelectedPnts();
        const allSelectedRebar = getAllSelectedRebar();
        const allSelectedConc = getAllSelectedConcShape();

        for (let i = 0; i < allSelectedPnts.length; i++) {
            const xcurrent = allSelectedPnts[i].geometry.attributes.position.array[0];
            const ycurrent = allSelectedPnts[i].geometry.attributes.position.array[1];
            const newX = xcurrent + Xreplicate;
            const newY = ycurrent + Yreplicate;

            document.getElementById("X_Vals").value = newX;
            document.getElementById("Y_Vals").value = newY;
            addPoint();
        }

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

        for (const selectedConc of allSelectedConc) {
            const originalPoints = selectedConc.basePoints || selectedConc.baseshape?.getPoints();
            if (!originalPoints || originalPoints.length === 0) continue;

            const newBasePoints = originalPoints.map(p => ({ x: p.x + Xreplicate, y: p.y + Yreplicate }));
            const newHoles = selectedConc.holes.map(hole => {
                const newHole = new THREE.Path();
                hole.getPoints().forEach((pt, i) => {
                    const offset = new THREE.Vector2(pt.x + Xreplicate, pt.y + Yreplicate);
                    i === 0 ? newHole.moveTo(offset.x, offset.y) : newHole.lineTo(offset.x, offset.y);
                });
                return newHole;
            });

            const newConcShape = new ConcShape(newBasePoints, selectedConc.material, newHoles);
            newConcShape.generateMesh();
            scene.add(newConcShape.mesh);
        }
    }

    // Keyboard shortcut
    document.addEventListener('keydown', function (e) {
        const currentTime = new Date().getTime();
        if (e.key.toLowerCase() === 'c') {
            if (currentTime - lastCPressTime < doublePressInterval) {
                replicateAction();
            }
            lastCPressTime = currentTime;
        }
    });

    // Button click hookup
    const replicateBtn = document.getElementById("replicateBtn");
    if (replicateBtn) {
        replicateBtn.addEventListener("click", replicateAction);
    }
}

export function setupMoveShortcut() {
    let mPressed = false;

    function moveAction() {
        debugger;
        
        const Xmove = parseFloat(prompt("Enter X movement"));
        const Ymove = parseFloat(prompt("Enter Y movement"));
        alert(`Moving selected objects by X = ${Xmove}, Y = ${Ymove}`);

        const selectedPnts = getAllSelectedPnts();
        for (const pnt of selectedPnts) {
            const pos = pnt.geometry.attributes.position;
            pos.array[0] += Xmove;
            pos.array[1] += Ymove;
            pos.needsUpdate = true;
            pnt.geometry.computeBoundingBox();
            pnt.geometry.computeBoundingSphere();
        }

        const selectedRebar = getAllSelectedRebar();
        for (const rebar of selectedRebar) {
            const pos = rebar.geometry.attributes.position;
            pos.array[0] += Xmove;
            pos.array[1] += Ymove;
            pos.needsUpdate = true;
            rebar.geometry.computeBoundingBox();
            rebar.geometry.computeBoundingSphere();
        }

        const selectedConc = getAllSelectedConcShape();
        for (const conc of selectedConc) {
            conc.generateMovedMesh(Xmove, Ymove, selectedConc);
        }
    }

    // Keyboard shortcut
    document.addEventListener('keydown', function (e) {
        if (e.key.toLowerCase() === 'm') {
            mPressed = true;
        }

        if (e.key.toLowerCase() === 'v' && mPressed) {
            moveAction();
        }
    });

    document.addEventListener('keyup', function (e) {
        if (e.key.toLowerCase() === 'm') {
            mPressed = false;
        }
    });

    // Button click hookup
    const moveBtn = document.getElementById("moveBtn");
    if (moveBtn) {
        moveBtn.addEventListener("click", moveAction);
    }
}






