import * as THREE from 'three';
import Plotly from 'plotly.js-dist-min';
import { scene, controls, camera, renderer } from '../main.js';
import { rebarDia, setupRaycastingForResults } from '../threeJSscenefunctions.js';

export class AnalyzableConcreteSection {
    constructor(material) {
        this.material = material;
        this.FEMmesh = [];
        this.PMMXYresults = {};
        this.PMMUVresults = {};
        this.transformedFEMcentroids = {};
        this.FEMarea = 0;
        this.totalRebarArea = 0;
        this.centroidX = 0;
        this.centroidY = 0;
        this.strainProfiles = {};
        this.Pnmax = 0;
        this.rebarObjects = [];
    }

    initializeRebarObjects(allSelectedRebar) {
        this.resetAnalysisResults();
        this.rebarObjects = allSelectedRebar;
        this.totalRebarArea = this.rebarObjects.reduce((sum, rebar) => {
            const radius = rebarDia[rebar.rebarSize] / 2;
            return sum + Math.PI * radius * radius;
        }, 0);
    }

    resetAnalysisResults() {
        this.PMMXYresults = {};
        this.PMMUVresults = {};
        this.transformedFEMcentroids = {};
        this.strainProfiles = {};
        this.Pnmax = 0;
    }

    CalcPnmax(type) {
        if (type !== "other") {
            console.warn(`Unsupported type "${type}" passed to CalcPnmax. No calculation performed.`);
            return;
        }

        if (!this.material) {
            throw new Error("Concrete material is required before calculating Pnmax.");
        }

        const fpc = this.material.stress(-0.003);
        let totalSteelForce = 0;

        for (const rebar of this.rebarObjects) {
            const steelMaterial = rebar.materialData;
            if (!steelMaterial) continue;

            const area = (Math.PI / 4) * rebarDia[rebar.rebarSize] ** 2;
            totalSteelForce -= area * steelMaterial.stress(0.005);
        }

        const nominalAxialStrength = 0.85 * fpc * this.FEMarea + totalSteelForce;
        this.Pnmax = 0.8 * nominalAxialStrength / 1000;
        return this.Pnmax;
    }

    transformCoordinatesAtAngle(angle) {
        if (!this.FEMmesh || this.FEMmesh.length === 0) {
            console.error("❌ FEM mesh is empty, cannot transform coordinates.");
            return;
        }

        if (!this.transformedFEMcentroids) {
            this.transformedFEMcentroids = {};
        }

        const radians = (Math.PI / 180) * angle; // Convert degrees to radians
        const cosTheta = Math.cos(radians);
        const sinTheta = Math.sin(radians);

        // ✅ Transform Concrete Centroids
        let transformedConcrete = this.FEMmesh.map(mesh => {
            let u = cosTheta * (mesh.centroid.x - this.centroidX) + sinTheta * (mesh.centroid.y - this.centroidY);
            let v = -sinTheta * (mesh.centroid.x - this.centroidX) + cosTheta * (mesh.centroid.y - this.centroidY);
            // ✅ Store transformed coordinates inside the rebar object
            if (!mesh.transformedCentroid) mesh.transformedCentroid = {}; // Ensure dictionary exists
            mesh.transformedCentroid[angle] = {u, v}
            return { u, v };
        });

        // ✅ Transform Rebar Centroids (Stored in `rebarObjects`)
        let transformedRebar = this.rebarObjects.map(rebar => {
            let rebarX = rebar.geometry.attributes.position.array[0]
            let rebarY = rebar.geometry.attributes.position.array[1]
 
            let u = cosTheta * (rebarX - this.centroidX) + sinTheta * (rebarY - this.centroidY);
            let v = -sinTheta * (rebarX - this.centroidX) + cosTheta * (rebarY - this.centroidY);
            
            // ✅ Store transformed coordinates inside the rebar object
            if (!rebar.transformedCentroid) rebar.transformedCentroid = {}; // Ensure dictionary exists
            rebar.transformedCentroid[angle] = { u, v };

            return { u, v };
        });

        // ✅ Transform Centroid Coordinates
        let transformedCentroid = {
            u: cosTheta * (this.centroidX - this.centroidX) + sinTheta * (this.centroidY - this.centroidY),
            v: -sinTheta * (this.centroidX - this.centroidX) + cosTheta * (this.centroidY - this.centroidY)
        };

        // ✅ Store transformed data in the dictionary
        this.transformedFEMcentroids[angle] = {
            angle: angle,
            conc: transformedConcrete,         // ✅ Store concrete mesh UV data
            // rebar: this.rebarObjects,          // ✅ Store rebar objects with UV data
            centroidCoordinates: transformedCentroid  // ✅ Store transformed centroid
        };

        // ✅ Log the min/max U and V values
        const allUV = [...transformedConcrete, ...this.rebarObjects.map(rebar => rebar.transformedCentroid[angle])];
        const uVals = allUV.map(p => p.u);
        const vVals = allUV.map(p => p.v);

        this.populateAnalysisResults();
        

    }

    generateStrains(angle) {
        // ✅ Ensure the transformed FEM centroids exist for the given angle
        if (!this.transformedFEMcentroids[angle]) {
            console.error(`❌ No transformed FEM centroids found for angle ${angle}`);
            return;
        }

        // ✅ Extract transformed rebar and concrete locations
        let concLocations = this.transformedFEMcentroids[angle].conc.map(p => p.v);  // Get only V coordinates

        // ✅ Extract transformed rebar V coordinates
        let rebarLocations = this.rebarObjects
        .map(rebar => rebar.transformedCentroid[angle]?.v) // ✅ Access transformed V values
        .filter(v => v !== undefined); // ✅ Filter out undefined values

        if (!rebarLocations.length || !concLocations.length) {
            console.error("❌ Rebar or Concrete locations are empty. Cannot generate strain profiles.");
            return;
        }

        // ✅ Find min/max V positions for rebar and concrete
        let rebarMax = Math.max(...rebarLocations);
        let rebarMin = Math.min(...rebarLocations);
        let concMax = Math.max(...concLocations);
        let concMin = Math.min(...concLocations);

        console.log(`🔹 Angle ${angle}°:`);
        console.log(`   ✅ Rebar Max: ${rebarMax}, Min: ${rebarMin}`);
        console.log(`   ✅ Concrete Max: ${concMax}, Min: ${concMin}`);

        // ✅ Define strain limits
        let epsilon_c = -0.003;  // Concrete crushing strain
        let epsilon_t = 0.025;   // Maximum tension strain of profile
        let steps = 25;          // Number of steps for profile generation

        // ✅ Initialize strain profiles
        let strainProfileCtoT = [];
        let strainProfileTtoT = [];
        let strainProfileTtoC = [];
        let strainProfileCtoC = [];

        // ✅ Compute slope steps
        let slopeStepCtoT = ((epsilon_t - epsilon_c) / (concMax - rebarMin)) / (steps - 1);
        let slopeStepTtoT = ((epsilon_c - epsilon_t) / (concMax - rebarMin)) / (steps - 1);
        let slopeStepTtoC = -((epsilon_c - epsilon_t) / (rebarMax - concMin)) / (steps - 1);
        let slopeStepCtoC = -((epsilon_c - epsilon_t) / (rebarMax - concMin)) / (steps - 1);

        // ✅ Generate strain profiles
        for (let i = 0; i < steps; i++) {
            // ✅ Compression to Tension (C to T)
            strainProfileCtoT.push([
                -i * slopeStepCtoT, 
                epsilon_c - (-i * slopeStepCtoT) * concMax
            ]);

            // ✅ Tension Failure to Tension (T to T)
            strainProfileTtoT.push([
                -(epsilon_t - epsilon_c) / (concMax - rebarMin) - slopeStepTtoT * i,
                epsilon_t - (-(epsilon_t - epsilon_c) / (concMax - rebarMin) - slopeStepTtoT * i) * rebarMin
            ]);

            // ✅ Tension to Compression (T to C)
            strainProfileTtoC.push([
                slopeStepTtoC * i,
                epsilon_t - (i * slopeStepTtoC) * rebarMax
            ]);

            // ✅ Compression to Compression (C to C)
            strainProfileCtoC.push([
                -((epsilon_c - epsilon_t) / (rebarMax - concMin)) - slopeStepCtoC * i,
                epsilon_c - slopeStepCtoC * -(steps - 1 - i) * -concMin
            ]);
        }

        // ✅ Combine all strain profiles
        let strainProfile = strainProfileCtoT.concat(strainProfileTtoT, strainProfileTtoC, strainProfileCtoC);

        console.log(`✅ Generated strain profile for angle ${angle}:`, strainProfile);

        // ✅ Store strain profile in the class dictionary
        if (!this.strainProfiles) {
            this.strainProfiles = {}; 
        }
        this.strainProfiles[angle] = strainProfile;

        return strainProfile;
    }

    convertUVtoXY(angle, Mu, Mv) {
        let radians = (Math.PI / 180) * angle;
        let Mx = Mu * Math.sin(radians) - Mv * Math.cos(radians);
        let My = Mu * Math.cos(radians) + Mv * Math.sin(radians);
        return { Mx, My };
    }

    strainFunction(m, x, b) {
        return m*x+b
    }

    generatePMM(angle) {
        if (!this.transformedFEMcentroids[angle]) {
            console.error(`❌ No transformed centroids found for angle ${angle}`);
            return;
        }
        
        if (!this.strainProfiles[angle]) {
            console.error(`❌ No strain profiles found for angle ${angle}`);
            return;
        }
    
    
        console.log(`🔹 Generating PMM for angle ${angle}°...`);
    
        let totalAxialForceArray = []
        let totalMomentUArray = []
        let totalMomentVArray = []
        let totalMomentXArray = []
        let totalMomentYArray = []

        let totalPhiAxialForceArray = []
        let totalPhiMomentXArray = []
        let totalPhiMomentYArray = []

        


        // Retrieve centroid coordinates in U-V space
        let centroidU = this.transformedFEMcentroids[angle].centroidCoordinates.u;
        let centroidV = this.transformedFEMcentroids[angle].centroidCoordinates.v;

        // Get material properties
        let concMaterial = this.material;  // ✅ Concrete material stored in class

        if (!this.PMMUVresults) {
            this.PMMUVresults = {};
        }
        if (!this.PMMXYresults) {
            this.PMMXYresults = {};
        }
        if (!this.PMMUVresults[angle]) {
            this.PMMUVresults[angle] = { P: [], Mu: [], Mv: [] };
        }
        if (!this.PMMXYresults[angle]) {
            this.PMMXYresults[angle] = { P: [], Mx: [], My: [], MaxRebarStrain: [], phiP: [], phiMx: [], phiMy: [] };
        }
    
        //looping through each stress strain profile
        for (var strainProfile of this.strainProfiles[angle]) {
            let concForce = 0
            let concMomentV = 0
            let concMomentU = 0
            let steelForce = 0
            let steelMomentV = 0
            let steelMomentU = 0
            let maxRebarStrain = -Infinity; // Track the maximum rebar strain
    
    
            for (let i = 0; i < this.FEMmesh.length; i++) {
                let concEle = this.FEMmesh[i]; // Get the concrete element
                let transformedConc = this.transformedFEMcentroids[angle].conc[i]; // Get the transformed coordinates
            
                if (!transformedConc) {
                    console.warn(`⚠️ Missing transformed centroid for concrete element at index ${i}`);
                    continue;
                }
            
                let concStrain = this.strainFunction(strainProfile[0], transformedConc.v, strainProfile[1]);
                let nodalConcForce = concMaterial.stress(concStrain) * concEle.area;
            
            
                concForce += nodalConcForce;
                concMomentV += nodalConcForce * (centroidV - transformedConc.v);
                concMomentU += nodalConcForce * (centroidU - transformedConc.u);
            }
            
            for (let rebar of this.rebarObjects) {
                //area times stress(strain)
                let steelMaterial = rebar.materialData; // ✅ Retrieve steel material
                let transformedRebar = rebar.transformedCentroid[angle]; // ✅ Get transformed U/V at angle
                if (!transformedRebar) {
                    console.warn(`⚠️ No transformed coordinates for rebar at angle ${angle}`);
                    continue;
                }
    
                let rebarStrain = this.strainFunction(strainProfile[0], transformedRebar.v, strainProfile[1]);
                maxRebarStrain = Math.max(maxRebarStrain, rebarStrain); // Track the max strain
                let nodalSteelForce = (Math.PI / 4) * rebarDia[rebar.rebarSize] ** 2 * steelMaterial.stress(rebarStrain);

                steelForce += nodalSteelForce
                steelMomentV += nodalSteelForce*(centroidV-transformedRebar.v)
                steelMomentU += nodalSteelForce*(centroidU-transformedRebar.u)
            }
            let resultForce = (steelForce + concForce)/1000;
            let Mu = (-steelMomentU - concMomentU) / 12 / 1000;
            let Mv = (-steelMomentV - concMomentV) / 12 / 1000;
            let { Mx, My } = this.convertUVtoXY(angle, Mu, Mv);

            

            let phi = this.calculatePhi("other", maxRebarStrain);


            let cappedP = Math.max(resultForce, this.Pnmax)
            let phiP = phi * cappedP
            let phiMx = phi * Mx
            let phiMy = phi * My

            totalAxialForceArray.push(resultForce);
            totalMomentUArray.push(Mu);
            totalMomentVArray.push(Mv);

            totalMomentXArray.push(Mx);
            totalMomentYArray.push(My);

            totalPhiAxialForceArray.push(phiP);
            totalPhiMomentXArray.push(phiMx);
            totalPhiMomentYArray.push(phiMy);

        }



        this.PMMUVresults[angle].P.push(totalAxialForceArray);
        this.PMMUVresults[angle].Mu.push(totalMomentUArray);
        this.PMMUVresults[angle].Mv.push(totalMomentVArray);
        this.PMMXYresults[angle].P.push(totalAxialForceArray);
        this.PMMXYresults[angle].Mx.push(totalMomentXArray);
        this.PMMXYresults[angle].My.push(totalMomentYArray);


        // ✅ Store phi values
        this.PMMXYresults[angle].phiP.push(totalPhiAxialForceArray);
        this.PMMXYresults[angle].phiMx.push(totalPhiMomentXArray);
        this.PMMXYresults[angle].phiMy.push(totalPhiMomentYArray);
        console.log(this.PMMXYresults[angle])
    }

    calculatePhi(type, maxRebarStrain) {
        if (type === "spiral") return; // ✅ Do nothing if "spiral"
    
        let phi;
        if (maxRebarStrain < 0.00207) {
            phi = 0.65;
        } else if (maxRebarStrain >= 0.00507) {
            phi = 0.9;
        } else {
            phi = 0.65 + 0.25 * (maxRebarStrain - 0.00207) / 0.003;
        }
    
        return phi;
    }

    plotPMMResults() {
        if (!this.PMMXYresults || Object.keys(this.PMMXYresults).length === 0) {
            console.error("❌ No PMM XY results available to plot.");
            return;
        }

        window.activeAnalysisSection = this;
    
        let uniqueAngles = Object.keys(this.PMMXYresults).map(Number);
        let angleDropdown = document.getElementById("angleSelection");
        
        // ✅ If dropdown doesn't exist yet, create it and populate
        if (!angleDropdown) {
            let resultsDiv = document.getElementById("results");
            resultsDiv.innerHTML = `
                <h3>3D PMM Interaction Diagram</h3>
                <label for="angleSelection">Select Bending Axis Angle:</label>
                <select id="angleSelection"></select>

                <label for="indexSelection">Select Strain Profile Index:</label>
                <select id="indexSelection"></select>

                <div id='pmPlot' style='width: 100%; height: 500px;'></div>
            `;
            this.populateAngleDropdown(uniqueAngles);
            
            angleDropdown = document.getElementById("angleSelection");
        }
    
        let selectedAngle = parseFloat(angleDropdown.value) || uniqueAngles[0];
        this.populateIndexDropdown(selectedAngle)
    
        let P_values = [], Mx_values = [], My_values = [];
        let phiP_values = [], phiMx_values = [], phiMy_values = [];
        let angles = [], strainProfileIndices = [];
    
        for (let angle in this.PMMXYresults) {
            let numPoints = this.PMMXYresults[angle].P.flat().length;
            P_values.push(...this.PMMXYresults[angle].P.flat());
            Mx_values.push(...this.PMMXYresults[angle].Mx.flat());
            My_values.push(...this.PMMXYresults[angle].My.flat());
    
            phiP_values.push(...this.PMMXYresults[angle].phiP.flat());
            phiMx_values.push(...this.PMMXYresults[angle].phiMx.flat());
            phiMy_values.push(...this.PMMXYresults[angle].phiMy.flat());
    
            angles.push(...Array(numPoints).fill(Number(angle)));
            strainProfileIndices.push(...Array.from({ length: numPoints }, (_, i) => i));
        }
    
        let colors = angles.map(angle => angle === selectedAngle ? "rgb(255, 100, 0)" : "rgb(200, 200, 200)");
        let symbolTypes = angles.map(angle => angle === selectedAngle ? "circle" : "cross");
    
        let originalTrace = {
            x: Mx_values, y: My_values, z: P_values,
            mode: "markers", type: "scatter3d",
            marker: { size: 6, color: colors, opacity: 0.8, symbol: symbolTypes },
            name: "Original PMM",
            hovertemplate: "P - %{z:.1f} (k)<br> Mx - %{x:.1f} (kip*ft)<br> My - %{y:.1f} (kip*ft)<br> Index - %{customdata}",
            customdata: strainProfileIndices
        };
    
        let reducedTrace = {
            x: phiMx_values, y: phiMy_values, z: phiP_values,
            mode: "markers", type: "scatter3d",
            marker: { size: 6, color: colors, opacity: 0.8, symbol: symbolTypes },
            name: "Reduced (φPMM)",
            hovertemplate: "φP - %{z:.1f} (k)<br> φMx - %{x:.1f} (kip*ft)<br> φMy - %{y:.1f} (kip*ft)<br> Index - %{customdata}",
            customdata: strainProfileIndices
        };
    
        let layout = {
            title: "3D P-M Interaction Diagram",
            scene: {
                xaxis: { title: "Mx (kip-ft)" },
                yaxis: { title: "My (kip-ft)" },
                zaxis: { title: "P (k)" },
                aspectmode: "cube"
            },
            margin: { l: 0, r: 0, b: 0, t: 50 }
        };
    
        let plotDiv = document.getElementById("pmPlot");
    
        // ✅ If the plot already exists, just update it instead of redrawing
        if (plotDiv.data) {
            Plotly.react("pmPlot", [originalTrace, reducedTrace], layout);
        } else {
            Plotly.newPlot("pmPlot", [originalTrace, reducedTrace], layout);
        }
    
        // ✅ Attach event listener only once
        if (!angleDropdown.dataset.listenerAdded) {
            angleDropdown.addEventListener("change", () => {
                const section = window.activeAnalysisSection;
                const newAngle = parseFloat(angleDropdown.value);
                const selectedIndex = window.selectedIndex || 0;

                window.selectedAngle = newAngle;
                section.populateIndexDropdown(newAngle);
                indexDropdown.value = selectedIndex;
                section.updatePMMHighlight();
                section.resetHighlightedPoint();
                section.highlightSelectedPoint(selectedIndex, newAngle);
                section.generate3dStressPlot(newAngle, section.strainProfiles[newAngle][selectedIndex]);
            });
            angleDropdown.dataset.listenerAdded = true;
        }

        let indexDropdown = document.getElementById("indexSelection");
    
        // ✅ Ensure highlight updates initially
        this.updatePMMHighlight();
        // ✅ Add Click Event Listener to Fire for Selected Angle Only
        if (!plotDiv.dataset.listenerAdded) {
            plotDiv.on('plotly_click', (data) => {
                const section = window.activeAnalysisSection;
                const clickedIndex = data.points[0].customdata;
                const clickedAngle = parseFloat(angleDropdown.value);

                window.selectedIndex = clickedIndex;
                window.selectedAngle = clickedAngle;
                indexDropdown.value = clickedIndex;

                section.generate3dStressPlot(
                    clickedAngle,
                    section.strainProfiles[clickedAngle][clickedIndex]
                );

                setTimeout(() => {
                    setupRaycastingForResults(scene, camera, renderer);
                }, 100);
            });
            plotDiv.dataset.listenerAdded = true;
        }

        // ✅ Add Event Listener for `indexSelection` dropdown
        if (!indexDropdown.dataset.listenerAdded) {
            indexDropdown.addEventListener("change", () => {
                const section = window.activeAnalysisSection;
                const selectedIndex = parseInt(indexDropdown.value, 10);
                const selectedAngle = parseFloat(angleDropdown.value);

                window.selectedIndex = selectedIndex;
                window.selectedAngle = selectedAngle;

                console.log(`📌 Strain Profile Index Changed: Angle ${selectedAngle}, Index ${selectedIndex}`);

                // ✅ Generate 3D stress plot based on new index
                section.generate3dStressPlot(
                    selectedAngle,
                    section.strainProfiles[selectedAngle][selectedIndex]
                );
                section.resetHighlightedPoint();
                section.highlightSelectedPoint(selectedIndex, selectedAngle);

            });
            indexDropdown.dataset.listenerAdded = true;
        }
    }

    populateIndexDropdown(angle) {
        let indexDropdown = document.getElementById("indexSelection");
        indexDropdown.innerHTML = ""; // Clear previous options
    
        if (!this.PMMXYresults[angle]) return;
    
        let numProfiles = this.PMMXYresults[angle].P[0].length;
    
        for (let i = 0; i < numProfiles; i++) {
            let option = document.createElement("option");
            option.value = i;
            option.text = `Profile ${i}`;
            indexDropdown.appendChild(option);
        }
    
        indexDropdown.value = 0; // Default to first profile
    }

    updatePMMHighlight() {
        let selectedAngle = parseFloat(document.getElementById("angleSelection").value);
        console.log("YOUR SELECTED ANGLE IS", selectedAngle);
        this.generateTableResults(selectedAngle)
    
        let plotDiv = document.getElementById("pmPlot");
        if (!plotDiv || !plotDiv.data) return;
    
        // ✅ Extract all angles corresponding to each PMM data point
        let allAngles = [];
        for (let angle in this.PMMXYresults) {
            let numPoints = this.PMMXYresults[angle].P.flat().length;
            allAngles.push(...Array(numPoints).fill(Number(angle))); // Repeat angle for each data point
        }
    
        let originalColors = plotDiv.data[0].marker.color; // Get existing colors
        let originalSymbols = plotDiv.data[0].marker.symbol; // Get existing symbols
    
        // ✅ Highlight all points belonging to the selected angle
        let updatedColors = originalColors.map((_, i) =>
            allAngles[i] === selectedAngle ? "rgb(255, 100, 0)" : "rgb(200, 200, 200)"
        );
    
        let updatedSymbols = originalSymbols.map((_, i) =>
            allAngles[i] === selectedAngle ? "circle" : "cross"
        );
    
        Plotly.restyle("pmPlot", {
            "marker.color": [updatedColors],
            "marker.symbol": [updatedSymbols]
        });
    }

    populateAngleDropdown(angles) {
        let angleDropdown = document.getElementById("angleSelection");
        angleDropdown.innerHTML = ""; // Clear previous options
    
        angles.forEach(angle => {
            let option = document.createElement("option");
            option.value = angle;
            option.text = `${angle}°`;
            angleDropdown.appendChild(option);
        });
    
        angleDropdown.value = angles[0]; // Default to first angle
    }

    resetHighlightedPoint() {
        let plotDiv = document.getElementById("pmPlot");
        if (!plotDiv || plotDiv.data.length < 3) return; // Ensure a highlighted point exists

        // Remove the last trace, which is the highlighted point
        Plotly.deleteTraces(plotDiv, plotDiv.data.length - 1);
    }

    highlightSelectedPoint(index, selectedAngle) {
        let plotDiv = document.getElementById("pmPlot");
        let selectedData = this.PMMXYresults[selectedAngle];

        if (!selectedData) {
            console.error(`❌ No PMM data found for angle ${selectedAngle}`);
            return;
        }

        let Mx_selected = selectedData.Mx.flat()[index];
        let My_selected = selectedData.My.flat()[index];
        let P_selected = selectedData.P.flat()[index];

        let newTrace = {
            x: [Mx_selected],
            y: [My_selected],
            z: [P_selected],
            mode: "markers",
            type: "scatter3d",
            marker: { size: 10, color: "rgb(255, 0, 0)", opacity: 1.0, symbol: "diamond" },
            name: "Selected Point",
            hovertemplate: "P - %{z:.1f} (k)<br> Mx - %{x:.1f} (kip*ft)<br> My - %{y:.1f} (kip*ft)<br>"
        };

        Plotly.addTraces(plotDiv, newTrace);
    }

    setupBendingAngles() {
        // for (let angle = 0; angle <= 180; angle += 15) {
        //     this.generatePMM(angle);
        // }
        this.plotPMMResults();
    }

    generate3dStressPlot(angle, strainProfile) {
        //this function will update the 3d scene, plotting the stress of each element in the scene.
        //given the angle and strainProfile, calculate the stress at the centroid of all concrete elemments given strain.
        // Then modify concrete FEMmesh z index to plot stress, times a factor say 2 (stress/2 for 4ksi concrete is 2 units of displacment.) apply this to all FEMmesh objects in the scene.
        // let positions = mesh.geometry.attributes.position.array, positions[i + 2] = zOffset; positions[i + 5] = zOffset; positions[i + 8] = zOffset;
        // do a similar process for all rebarObjects in the scene. offset the rebar point object by its stress with some factor say stress/5
        // Function to calculate stress based on strain profile
        // Function to calculate stress based on strain profile, U, and V values

        const concreteScaleFactor = 4; // Adjust as needed
        const rebarScaleFactor = 5; // Adjust as needed
        const arrowScaleFactor = 4;
        let minConcreteStress = Infinity, maxConcreteStress = -Infinity;
        let minRebarStress = Infinity, maxRebarStress = -Infinity;

        function calculateStress(element, strainProfile, angle, concreteMat) {
            let transformed = element.transformedCentroid[angle]; // Get transformed U/V at angle
            if (!transformed) {
                console.warn(`⚠️ No transformed coordinates for element at angle ${angle}`);
                return 0;
            }
            
            let strain = strainProfile[0] * transformed.v + strainProfile[1];
            if (element instanceof THREE.Mesh) {
                return concreteMat.stress(strain);
            }
            else {
                return element.materialData.stress(strain);
            }
        }
        //used to plot point at concrete stress location.
        function calculateRebarNormalizedStress(element, strainProfile, angle, concreteMat) {
            let transformed = element.transformedCentroid[angle]; // Get transformed U/V at angle
            if (!transformed) {
                console.warn(`⚠️ No transformed coordinates for element at angle ${angle}`);
                return 0;
            }
            let strain = strainProfile[0] * transformed.v + strainProfile[1];
            return concreteMat.stress(strain);
        }

        let minZ = Infinity, maxZ = -Infinity;

        // Iterate through all FEMmesh objects in the scene
        const concreteMat = this.material

        this.FEMmesh.forEach((object) => {
            if (!object.geometry || !object.geometry.attributes.position) return;

            let positions = object.geometry.attributes.position.array;
            let stress = calculateStress(object, strainProfile, angle, concreteMat);
            minConcreteStress = Math.min(minConcreteStress, stress);
            maxConcreteStress = Math.max(maxConcreteStress, stress);
            let zOffset = (stress / 4000) * concreteScaleFactor;

            for (let i = 2; i < positions.length; i += 9) {
                let newZ = zOffset;
                minZ = Math.min(minZ, newZ);
                maxZ = Math.max(maxZ, newZ);
            }
        });
        
        // Second pass to update position and apply colors
        this.FEMmesh.forEach((object) => {
            let positions = object.geometry.attributes.position.array;
            let colors = object.geometry.attributes.color.array;
            let stress = calculateStress(object, strainProfile, angle, concreteMat);
            let zOffset = (stress / 4000) * concreteScaleFactor;
        
            for (let i = 0; i < positions.length; i += 3) { // Loop through ALL vertices
                positions[i + 2] = zOffset; // Modify Z-coordinate
        
                let normalizedZ = (positions[i + 2] - minZ) / (maxZ - minZ);
        
                // Assign color per vertex
                colors[i] = 1 - normalizedZ;  // Red channel
                colors[i + 1] = 0;            // Green channel
                colors[i + 2] = normalizedZ;  // Blue channel
            }
        
            object.geometry.attributes.position.needsUpdate = true;
            object.geometry.attributes.color.needsUpdate = true;
            object.geometry.computeBoundingBox()
            object.geometry.computeBoundingSphere()
        });

        let minZrebar = Infinity, maxZrebar = -Infinity;

        this.rebarObjects.forEach((object) => {
            if (!object.geometry || !object.geometry.attributes.position) return;

            // let positions = object.geometry.attributes.position.array;

            let stress = calculateStress(object, strainProfile, angle, object.materialData);
            minRebarStress = Math.min(minRebarStress, stress);
            maxRebarStress = Math.max(maxRebarStress, stress);
            
            
            let zOffset = (stress / 60000) * rebarScaleFactor;
            let newZ = zOffset;
            minZrebar = Math.min(minZ, newZ);
            maxZrebar = Math.max(maxZ, newZ);
        });

        // ✅ Remove existing arrows before adding new ones
        scene.children.filter(obj => obj.userData.isCustomArrow === true).forEach(arrow => scene.remove(arrow));


        // Second pass to update position and apply colors
        this.rebarObjects.forEach((object) => {
            // Get the position attribute
            let positionAttribute = object.geometry.getAttribute('position');

            // Access the underlying Float32Array
            let p = positionAttribute.array;

            //let's plot the point at the location of the concrete stress to allow the point to be in the same position.
            //the length of the arrow will be based on the actual rebar stress in the object
            // start point of arrow head
            let rebarNormalizestress  = calculateRebarNormalizedStress(object, strainProfile, angle, concreteMat);
            let zOffsetRebar = (rebarNormalizestress / 4000) * concreteScaleFactor;

            let stress = calculateStress(object, strainProfile, angle, object.materialData);
            // Update the z value of the first vertex
            p[2] = zOffsetRebar;
            // Mark the attribute as needing an update
            positionAttribute.needsUpdate = true;
            object.geometry.computeBoundingBox()
            object.geometry.computeBoundingSphere()

            // Normalize rebar stress for coloring
            let normalizedStress = Math.abs(stress) / 60000; // Normalize for color mapping
            normalizedStress = Math.min(normalizedStress, 1); // Ensure max value of 1

            // Assign colors
            let rebarColor = new THREE.Color();
            if (stress < 0) {
                // 🔴 **Compression: Fully Red if Normalized Stress = 1, otherwise Red-to-Purple**
                let red = 1.0;  // Always fully red
                let green = 0.0; // No green component
                let blue = normalizedStress === 1 ? 0.0 : normalizedStress * 0.8; // Fully red if 1, else red to purple

                rebarColor.setRGB(red, green, blue);
            } else {
                // 🔵 **Tension: Fully Blue if Normalized Stress = 0, otherwise Blue-to-Green**
                let red = 0.0; // No red component
                let green = normalizedStress;  // Green increases with stress
                let blue = normalizedStress === 0 ? 1.0 : 1.0 - (normalizedStress * 0.5); // Fully blue at 0 stress

                rebarColor.setRGB(red, green, blue);
            }
            object.material.color = rebarColor;
            // ✅ Set transparency to 50%
            object.material.transparent = true;
            object.material.opacity = 0.5;
            object.material.needsUpdate = true;

            // Create and add arrow
            let startX = p[0];
            let startY = p[1];
            let extrusionDepth = p[2];

            let arrowDirection = new THREE.Vector3(0, 0, stress < 0 ? -1 : 1); // Flip for compression
            let arrowLength = Math.abs(stress) / 60000 * arrowScaleFactor; // Scale by stress

            let start, end;
            if (stress < 0) {
                // 📌 **Compression: Start in air, end at rebar**
                start = [startX, startY, extrusionDepth + arrowLength];
                end = [startX, startY, extrusionDepth];
            } else {
                // 📌 **Tension: Start at rebar, extend outward**
                start = [startX, startY, extrusionDepth];
                end = [startX, startY, extrusionDepth + arrowLength];
            }
            // Call the new custom arrow function
            createCustomArrow(start, end, rebarColor.getHex(), 0.1, 0.3, stress);
            
        });

        function createCustomArrow(start, end, color, thickness = 0.1, coneSize = 0.3, stress) {
            const arrowGroup = new THREE.Group();
        
            // Convert start and end to Vector3
            const startVec = new THREE.Vector3(...start);
            const endVec = new THREE.Vector3(...end);
        
            // Compute direction and length
            const direction = new THREE.Vector3().subVectors(endVec, startVec);
            const length = direction.length();
            direction.normalize();
        
            // Create cylinder for the shaft
            const shaftGeometry = new THREE.CylinderGeometry(thickness, thickness, length - coneSize, 12);
            const shaftMaterial = new THREE.MeshBasicMaterial({ color: color });
            const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
        
            // Align the shaft along the Z-axis
            shaft.position.set(0, 0, (length - coneSize) / 2);
            shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction); // Align to direction
        
            // Create cone for the arrowhead
            const coneGeometry = new THREE.ConeGeometry(coneSize * 1.5, coneSize, 12);
            const coneMaterial = new THREE.MeshBasicMaterial({ color: color });
            const cone = new THREE.Mesh(coneGeometry, coneMaterial);
        
            // Position the cone
            cone.position.set(0, 0, length - coneSize / 2);
        
            // Reverse cone direction if in compression (stress < 0)
            let coneDirection = direction.clone(); // Copy direction so shaft is not affected
            if (stress < 0) {
                coneDirection.negate(); // Flip only the cone direction
            }
        
            // Rotate the cone to align with direction
            cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), coneDirection);
        
            // Add shaft and cone to arrow group
            arrowGroup.add(shaft);
            arrowGroup.add(cone);
            //This is to filter and remove from the scene.
            arrowGroup.userData.isCustomArrow = true
        
            // Position the entire arrow
            arrowGroup.position.copy(startVec);
            arrowGroup.position.z += 0.5;  // ✅ Move up by 0.5 units in the Z direction
            arrowGroup.lookAt(endVec);
        
            scene.add(arrowGroup);
            return arrowGroup;
        }

        // ✅ Update the concShape class with new stress values
        minConcreteStress = minConcreteStress / 1000; // Convert to ksi
        maxConcreteStress = maxConcreteStress / 1000;
        minRebarStress = minRebarStress / 1000;
        maxRebarStress = maxRebarStress / 1000;

        console.log("Min/Max Concrete Stress:", minConcreteStress, maxConcreteStress);
        console.log("Min/Max Rebar Stress:", minRebarStress, maxRebarStress);

        // ✅ Inject the updated color scale
        this.colorScaleHTML(minConcreteStress, maxConcreteStress, minRebarStress, maxRebarStress);
    }

    colorScaleHTML(minConcreteStress, maxConcreteStress, minRebarStress, maxRebarStress) {
        let selectedPointProps = document.getElementById("selectedPointResultProps");
        if (!selectedPointProps) return;

        // ✅ Retrieve the selected PMM results
        let selectedAngle = window.selectedAngle || 0;  // Ensure angle is defined
        let selectedIndex = window.selectedIndex || 0; // Ensure index is defined
        console.log("YOUR SELECTED INDEX IS", selectedIndex)
        window.selectedStrainProfileIndex = selectedIndex

        let P = this.PMMXYresults[selectedAngle]?.P[0]?.[selectedIndex] || 0;
        let Mx = this.PMMXYresults[selectedAngle]?.Mx[0]?.[selectedIndex] || 0;
        let My = this.PMMXYresults[selectedAngle]?.My[0]?.[selectedIndex] || 0;

        let phiP = this.PMMXYresults[selectedAngle]?.phiP[0]?.[selectedIndex] || 0;
        let phiMx = this.PMMXYresults[selectedAngle]?.phiMx[0]?.[selectedIndex] || 0;
        let phiMy = this.PMMXYresults[selectedAngle]?.phiMy[0]?.[selectedIndex] || 0;
    
        // ✅ Generate color stops for concrete and rebar
        let concreteColors = this.generateColorScale(minConcreteStress, maxConcreteStress, this.getConcreteColor);
        let rebarColors = this.generateColorScale(minRebarStress, maxRebarStress, this.getRebarColor);
    
        selectedPointProps.innerHTML = `
            <div class="pmm-values p-3 bg-white shadow-md rounded-md">
                <h3 class="text-sm font-semibold text-center mb-2">Selected PMM Values</h3>
                <table class="w-auto mx-auto border border-gray-300 text-center text-xs rounded-md overflow-hidden">
                    <thead class="bg-gray-100 text-gray-600">
                        <tr>
                            <th class="py-1 px-2 border border-gray-300"></th>
                            <th class="py-1 px-2 border border-gray-300">Axial (k)</th>
                            <th class="py-1 px-2 border border-gray-300">Mx (k*ft)</th>
                            <th class="py-1 px-2 border border-gray-300">My (k*ft)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr class="bg-white hover:bg-gray-50">
                            <td class="py-1 px-2 font-medium border border-gray-300">Nominal</td>
                            <td class="py-1 px-2 border border-gray-300">${P.toFixed(2)}</td>
                            <td class="py-1 px-2 border border-gray-300">${Mx.toFixed(2)}</td>
                            <td class="py-1 px-2 border border-gray-300">${My.toFixed(2)}</td>
                        </tr>
                        <tr class="bg-gray-50 hover:bg-gray-100">
                            <td class="py-1 px-2 font-medium border border-gray-300">Capacity</td>
                            <td class="py-1 px-2 border border-gray-300">${phiP.toFixed(2)}</td>
                            <td class="py-1 px-2 border border-gray-300">${phiMx.toFixed(2)}</td>
                            <td class="py-1 px-2 border border-gray-300">${phiMy.toFixed(2)}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <div class="stress-scale">
                <p><strong>Concrete Stress (ksi)</strong></p>
                <div class="color-bar" style="background: ${concreteColors};"></div>
                <div class="scale-labels">
                    <span>${minConcreteStress.toFixed(1)}</span> 
                    <span>${((minConcreteStress + maxConcreteStress) / 2).toFixed(1)}</span> 
                    <span>${maxConcreteStress.toFixed(1)}</span>
                </div>
            </div>
    
            <div class="stress-scale">
                <p><strong>Rebar Stress (ksi)</strong></p>
                <div class="color-bar" style="background: ${rebarColors};"></div>
                <div class="scale-labels">
                    <span>${minRebarStress.toFixed(1)}</span> 
                    <span>${((minRebarStress + maxRebarStress) / 2).toFixed(1)}</span> 
                    <span>${maxRebarStress.toFixed(1)}</span>
                </div>
            </div>
        `;
    }

    generateColorScale(min, max, colorFunction) {
        if (min === max) {
            return colorFunction(max, min, max); // Solid color when min == max
        }
        return `linear-gradient(to right, ${colorFunction(min, min, max)}, ${colorFunction((min + max) / 2, min, max)}, ${colorFunction(max, min, max)})`;
    }

    getConcreteColor(stress, minConcreteStress, maxConcreteStress) {
        let normalized = (stress - minConcreteStress) / (maxConcreteStress - minConcreteStress);
        return `rgb(${(1 - normalized) * 255}, 0, ${normalized * 255})`; // Red to Blue
    }

    getRebarColor(stress, minRebarStress, maxRebarStress) {
        let normalized = Math.abs(stress) / (maxRebarStress || 1);
    
        if (minRebarStress === maxRebarStress) {
            return stress < 0 ? "rgb(255, 0, 0)" : "rgb(0, 255, 0)"; // Solid red or green
        }
    
        if (stress < 0) {
            // 🔴 **Compression: Fully Red if Normalized = 1, otherwise Red-to-Purple**
            let red = 255;
            let green = 0;
            let blue = normalized === 1 ? 0 : normalized * 200; // Fully red if 1, else red to purple
            return `rgb(${red}, ${green}, ${blue})`;
        } else {
            // 🔵 **Tension: Fully Blue if Normalized = 0, otherwise Blue-to-Green**
            let red = 0;
            let green = normalized * 255; // Green increases with stress
            let blue = normalized === 0 ? 255 : 255 - (normalized * 125); // Fully blue at 0 stress
            return `rgb(${red}, ${green}, ${blue})`;
        }
    }

    populateAnalysisResults() {
        let analysisResults = document.getElementById("analysisResults");
        let userInputProps = document.getElementById("userInputProps");

        if (!analysisResults) return;

        if (userInputProps) {
            userInputProps.innerHTML = "";
        }

    
        // ✅ Ensure `this.FEMarea` and `this.centroidX` exist
        let FEMarea = this.FEMarea || 0;
        let centroidX = this.centroidX || 0;
        let centroidY = this.centroidY || 0;
        let rebarArea = this.totalRebarArea||0;
        let reinforcementRatio = (rebarArea / FEMarea) * 100; // Convert to percentage
        
    
        // ✅ Inject content dynamically
        analysisResults.innerHTML = `
        <div class="pmm-values p-3 bg-white shadow-md rounded-md">
            <h3 class="text-sm font-semibold text-center mb-2">Concrete Shape Properties</h3>
            <table class="w-auto mx-auto border border-gray-300 text-center text-xs rounded-md overflow-hidden">
                <thead class="bg-gray-100 text-gray-600">
                    <tr>
                        <th class="py-1 px-2 border border-gray-300" title="Concrete Area (in²)">Conc Area</th>
                        <th class="py-1 px-2 border border-gray-300" title="Rebar Area (in²)">Stl Area</th>
                        <th class="py-1 px-2 border border-gray-300" title="Reinforcing Ratio (%)">ρ (%)</th>
                        <th class="py-1 px-2 border border-gray-300" title="X Centriod of Shape (in)">X (in)</th>
                        <th class="py-1 px-2 border border-gray-300" title="Y Centriod of Shape (in)">Y (in)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr class="bg-white hover:bg-gray-50">
                        <td class="py-1 px-2 border border-gray-300">${FEMarea.toFixed(1)}</td>
                        <td class="py-1 px-2 border border-gray-300">${rebarArea.toFixed(2)}</td>
                        <td class="py-1 px-2 border border-gray-300">${reinforcementRatio.toFixed(2)}</td>
                        <td class="py-1 px-2 border border-gray-300">${centroidX.toFixed(1)}</td>
                        <td class="py-1 px-2 border border-gray-300">${centroidY.toFixed(1)}</td>
                    </tr>
                </tbody>
            </table>
        </div>
        `;
    }

    setupResultsControls(){
        console.log("Setting up results controls...");
        // Remove mouse interactions setup
        console.log(controls)

        // Re-enable orbit controls rotation and panning
        if (typeof controls !== 'undefined') {
            controls.enableRotate = true;
            controls.enablePan = true;
            
            // Assign default controls
            // controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; // Right mouse rotates
            controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;   // Middle mouse pans
    
            // Assign Shift + Middle Mouse Button to Rotate
            controls.keys = { SHIFT: THREE.MOUSE.ROTATE };
    
            console.log(controls);
        }

        // Modify .selectBox CSS to be invisible
        if (!document.getElementById('analysis-results-controls-style')) {
            const style = document.createElement('style');
            style.id = 'analysis-results-controls-style';
            style.innerHTML = `
                .selectBox {
                    border: none !important;
                    background-color: transparent !important;
                    position: fixed !important;
                }
            `;
            document.head.appendChild(style);
        }
    }

    generateTableResults(selectedAngle) {
        // Retrieve the PMM results arrays (extracting the first element)
        let P = this.PMMXYresults[selectedAngle]?.P?.[0] || [];
        let Mx = this.PMMXYresults[selectedAngle]?.Mx?.[0] || [];
        let My = this.PMMXYresults[selectedAngle]?.My?.[0] || [];
        let phiP = this.PMMXYresults[selectedAngle]?.phiP?.[0] || [];
        let phiMx = this.PMMXYresults[selectedAngle]?.phiMx?.[0] || [];
        let phiMy = this.PMMXYresults[selectedAngle]?.phiMy?.[0] || [];
    
        // Determine the number of rows (assumes all arrays have the same length)
        let rowCount = Math.max(P.length, Mx.length, My.length, phiP.length, phiMx.length, phiMy.length);
    
        // Construct table rows dynamically
        let rowsHTML = "";
        for (let i = 0; i < rowCount; i++) {
            rowsHTML += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="py-1 px-2 border border-gray-300">${(P[i] ?? 0).toFixed(2)}</td>
                    <td class="py-1 px-2 border border-gray-300">${(Mx[i] ?? 0).toFixed(2)}</td>
                    <td class="py-1 px-2 border border-gray-300">${(My[i] ?? 0).toFixed(2)}</td>
                    <td class="py-1 px-2 border border-gray-300">${(phiP[i] ?? 0).toFixed(2)}</td>
                    <td class="py-1 px-2 border border-gray-300">${(phiMx[i] ?? 0).toFixed(2)}</td>
                    <td class="py-1 px-2 border border-gray-300">${(phiMy[i] ?? 0).toFixed(2)}</td>
                </tr>
            `;
        }
    
        // Construct the full results table
        let tableHTML = `
            <div id="analysisResultsTable" class="pmm-values p-3 bg-white shadow-md rounded-md mt-4">
                <h3 class="text-sm font-semibold text-center mb-2">
                    Analysis Results - Bending Angle = ${selectedAngle}
                </h3>
                <div class="max-h-64 overflow-y-auto overflow-x-auto border border-gray-500 w-full">
                    <table class="w-auto mx-auto border border-gray-300 text-center text-xs rounded-md overflow-hidden">
                        <thead class="bg-gray-100 text-gray-600">
                            <tr>
                                <th class="py-1 px-2 border border-gray-300">Axial (k)</th>
                                <th class="py-1 px-2 border border-gray-300">Mx (k*ft)</th>
                                <th class="py-1 px-2 border border-gray-300">My (k*ft)</th>
                                <th class="py-1 px-2 border border-gray-300">ϕP (k)</th>
                                <th class="py-1 px-2 border border-gray-300">ϕMx (k*ft)</th>
                                <th class="py-1 px-2 border border-gray-300">ϕMy (k*ft)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHTML}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    
        // Inject or replace the results table inside "materialsandShapes"
        let materialsAndShapesDiv = document.getElementById("materialsandShapes");
        let existingTable = document.getElementById("analysisResultsTable");


    
        if (existingTable) {
            // Replace the existing table if it exists
            existingTable.outerHTML = tableHTML;
        } else {
            let stressStrainChart = document.getElementById("stressStrainChart");
            if (stressStrainChart) {
                stressStrainChart.insertAdjacentHTML("afterend", tableHTML);
            } else {
                materialsAndShapesDiv.insertAdjacentHTML("beforeend", tableHTML);
            }
        }
    
        // Hide the ShapeButtons and square_rect_oval_shapes sections
        document.getElementById("ShapeButtons").style.display = "none";
        document.getElementById("square_rect_oval_shapes").style.display = "none";
    }
}
