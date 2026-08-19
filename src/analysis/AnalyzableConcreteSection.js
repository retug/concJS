import * as THREE from 'three';
import Plotly from 'plotly.js-dist-min';
import { scene, controls, camera, renderer } from '../main.js';
import { setupRaycastingForResults } from '../threeJSscenefunctions.js';
import { getRebarArea } from '../rebarProperties.js';
import { getAnalysisConfiguration, updateAnalysisConfiguration } from '../projectState.js';
import { MomentMomentAnalysis } from './MomentMomentAnalysis.js';
import { exportSectionAnalysisWorkbook } from './AnalysisExcelExporter.js';
import {
    linearStrainAtPoint,
    responseColor,
    responseGradientCSS
} from './sectionResponseField.js';
import { cameraInteractionForMode } from '../cameraView.js';

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
        this.strainProfileResponses = {};
        this.Pnmax = 0;
        this.rebarObjects = [];
        this.momentMomentAnalysis = null;
        this.currentMomentMomentResult = null;
        this.materialSummary = [];
        this.sectionResponseMode = 'stress';
        this.currentResponseAngle = null;
        this.currentStrainProfile = null;
        this.currentResponseSelection = null;
        this.selectedMomentMomentPoint = null;
    }

    initializeRebarObjects(allSelectedRebar) {
        this.resetAnalysisResults();
        this.rebarObjects = allSelectedRebar;
        this.totalRebarArea = this.rebarObjects.reduce((sum, rebar) => {
            return sum + getRebarArea(rebar);
        }, 0);
    }

    resetAnalysisResults() {
        this.PMMXYresults = {};
        this.PMMUVresults = {};
        this.transformedFEMcentroids = {};
        this.strainProfiles = {};
        this.strainProfileResponses = {};
        this.Pnmax = 0;
        this.momentMomentAnalysis = null;
        this.currentMomentMomentResult = null;
        this.currentResponseAngle = null;
        this.currentStrainProfile = null;
        this.currentResponseSelection = null;
        this.selectedMomentMomentPoint = null;
    }

    CalcPnmax(type) {
        if (type !== "other") {
            console.warn(`Unsupported type "${type}" passed to CalcPnmax. No calculation performed.`);
            return;
        }

        if (!this.FEMmesh.length) {
            throw new Error("A resolved section mesh is required before calculating Pnmax.");
        }

        let nominalAxialStrength = 0;
        for (const element of this.FEMmesh) {
            const material = element.userData?.material ?? element.userData?.concShape?.material ?? this.material;
            if (!material) continue;
            const materialFactor = material.type === 'concrete' ? 0.85 : 1;
            nominalAxialStrength += materialFactor * material.stress(-0.003) * element.area;
        }

        for (const rebar of this.rebarObjects) {
            const steelMaterial = rebar.materialData;
            if (!steelMaterial) continue;

            const area = getRebarArea(rebar);
            nominalAxialStrength -= area * steelMaterial.stress(0.005);
        }

        this.Pnmax = 0.8 * nominalAxialStrength / 1000;
        return this.Pnmax;
    }

    transformCoordinatesAtAngle(angle, updateAnalysisSummary = true) {
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

        if (updateAnalysisSummary) this.populateAnalysisResults();
        

    }

    generateStrains(angle) {
        if (!this.transformedFEMcentroids[angle]) {
            console.error(`❌ No transformed FEM centroids found for angle ${angle}`);
            return;
        }

        const concLocations = this.transformedFEMcentroids[angle].conc.map(point => point.v);
        const rebarLocations = this.rebarObjects
            .map(rebar => rebar.transformedCentroid[angle]?.v)
            .filter(value => value !== undefined);

        const plateSteelLocations = this.FEMmesh
            .filter(element => (element.userData?.material ?? element.userData?.concShape?.material)?.type === 'steel')
            .map(element => element.transformedCentroid?.[angle]?.v)
            .filter(value => value !== undefined);
        const tensionControlLocations = rebarLocations.length
            ? [...rebarLocations, ...plateSteelLocations]
            : plateSteelLocations.length
                ? plateSteelLocations
                : concLocations;

        if (!concLocations.length) {
            console.error("❌ Section element locations are empty. Cannot generate strain profiles.");
            return;
        }

        const { min: concreteMin, max: concreteMax } = this._getConcreteVBounds(angle);
        const rebarMin = Math.min(...tensionControlLocations);
        const rebarMax = Math.max(...tensionControlLocations);

        const positiveBranch = this._generateAdaptiveStrainBranch(angle, {
            compressionV: concreteMax,
            tensionV: rebarMin,
            concreteCentroids: concLocations,
            rebarLocations: tensionControlLocations,
            targetCount: 51
        });

        const negativeBranch = this._generateAdaptiveStrainBranch(angle, {
            compressionV: concreteMin,
            tensionV: rebarMax,
            concreteCentroids: concLocations,
            rebarLocations: tensionControlLocations,
            targetCount: 51
        });

        // Follow one branch from compression to tension and return on the other.
        // Pure tension and pure compression are shared endpoints, so the duplicate
        // endpoints from the return branch are removed. The final count is 100.
        const selectedNodes = [
            ...positiveBranch,
            ...negativeBranch.slice().reverse().slice(1, -1)
        ];
        const profiles = selectedNodes.map(node => node.profile);

        if (profiles.length !== 100) {
            throw new Error(`Expected 100 strain profiles at angle ${angle}, received ${profiles.length}.`);
        }

        this.strainProfiles[angle] = profiles;
        this.strainProfileResponses[angle] = selectedNodes.map(node => node.response);
        return profiles;
    }

    _getConcreteVBounds(angle) {
        const radians = (Math.PI / 180) * angle;
        const cosTheta = Math.cos(radians);
        const sinTheta = Math.sin(radians);
        let min = Infinity;
        let max = -Infinity;

        for (const mesh of this.FEMmesh) {
            const positions = mesh.geometry.attributes.position.array;
            for (let index = 0; index < positions.length; index += 3) {
                const x = positions[index] - this.centroidX;
                const y = positions[index + 1] - this.centroidY;
                const v = -sinTheta * x + cosTheta * y;
                min = Math.min(min, v);
                max = Math.max(max, v);
            }
        }

        if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
            throw new Error(`Unable to determine concrete depth at angle ${angle}.`);
        }

        return { min, max };
    }

    _generateAdaptiveStrainBranch(angle, options) {
        const {
            compressionV,
            tensionV,
            concreteCentroids,
            rebarLocations,
            targetCount
        } = options;
        const compressionStrain = -0.003;
        const pureTensionStrain = 0.00507;
        const tensionDistance = Math.abs(tensionV - compressionV);

        if (tensionDistance <= Number.EPSILON) {
            throw new Error("Compression and tension control points must be separated.");
        }

        const concreteDistances = concreteCentroids
            .map(value => Math.abs(value - compressionV))
            .filter(value => value > 1e-9);
        const rebarDistances = rebarLocations
            .map(value => Math.abs(value - compressionV))
            .filter(value => value > 1e-9);

        const nearestConcrete = Math.min(...concreteDistances);
        const nearestRebar = Math.min(...rebarDistances);
        const curvatureForZeroConcrete = 1.01 * Math.abs(compressionStrain) / nearestConcrete;
        const curvatureForYieldedSteel = 1.01 * (pureTensionStrain - compressionStrain) / nearestRebar;
        const terminalCurvature = Math.max(curvatureForZeroConcrete, curvatureForYieldedSteel);
        const terminalTensionStrain = Math.min(
            0.5,
            Math.max(0.025, compressionStrain + terminalCurvature * tensionDistance)
        );

        const controlTensionStrains = [
            -0.003,
            -0.0025,
            -0.002,
            -0.0015,
            -0.001,
            -0.0005,
            0,
            0.001,
            0.00207,
            0.003,
            0.004,
            0.00507,
            0.0075,
            0.01,
            0.015,
            0.025
        ].filter(value => value < terminalTensionStrain);

        controlTensionStrains.push(terminalTensionStrain);
        const pureTensionParameter = terminalTensionStrain
            + Math.max(0.001, 0.05 * (terminalTensionStrain - compressionStrain));
        controlTensionStrains.push(pureTensionParameter);

        const nodeCache = new Map();
        const createNode = parameter => {
            const key = parameter.toPrecision(15);
            if (nodeCache.has(key)) return nodeCache.get(key);

            const isPureTension = Math.abs(parameter - pureTensionParameter) < 1e-12;
            const profile = isPureTension
                ? [0, pureTensionStrain]
                : this._createControlledStrainProfile(
                    compressionV,
                    tensionV,
                    compressionStrain,
                    parameter
                );
            const node = {
                parameter,
                profile,
                response: this._calculateProfileResponse(angle, profile)
            };
            nodeCache.set(key, node);
            return node;
        };

        let nodes = controlTensionStrains.map(createNode);
        const scales = this._getResponseScales(nodes.map(node => node.response));
        const uniqueNodes = [];
        for (let index = 0; index < nodes.length; index += 1) {
            const node = nodes[index];
            const previous = uniqueNodes[uniqueNodes.length - 1];
            const equivalent = previous
                && this._responseDistance(node.response, previous.response, scales) < 1e-8;

            if (!equivalent) {
                uniqueNodes.push(node);
            } else if (index === nodes.length - 1) {
                // Prefer the exact uniform-tension state over an equivalent
                // high-curvature approximation at the branch endpoint.
                uniqueNodes[uniqueNodes.length - 1] = node;
            }
        }
        nodes = uniqueNodes;

        while (nodes.length < targetCount) {
            let bestSegment = null;

            for (let index = 0; index < nodes.length - 1; index += 1) {
                const left = nodes[index];
                const right = nodes[index + 1];
                let lowerParameter = left.parameter;
                let upperParameter = right.parameter;
                let midpoint = null;

                // If a midpoint lands on a material-response plateau, move toward
                // the changing end of the segment instead of spending a PMM point
                // on a duplicate response.
                for (let attempt = 0; attempt < 12; attempt += 1) {
                    const midpointParameter = (lowerParameter + upperParameter) / 2;
                    if (midpointParameter === lowerParameter || midpointParameter === upperParameter) break;

                    const candidate = createNode(midpointParameter);
                    const distanceFromLeft = this._responseDistance(
                        candidate.response,
                        left.response,
                        scales
                    );
                    const distanceFromRight = this._responseDistance(
                        candidate.response,
                        right.response,
                        scales
                    );

                    if (distanceFromLeft < 1e-8 && distanceFromRight < 1e-8) break;
                    if (distanceFromLeft < 1e-8) {
                        lowerParameter = midpointParameter;
                        continue;
                    }
                    if (distanceFromRight < 1e-8) {
                        upperParameter = midpointParameter;
                        continue;
                    }

                    midpoint = candidate;
                    break;
                }

                if (!midpoint) continue;

                const chordLength = this._responseDistance(left.response, right.response, scales);
                const interpolationRatio = (midpoint.parameter - left.parameter)
                    / (right.parameter - left.parameter);
                const interpolatedResponse = this._interpolateResponses(
                    left.response,
                    right.response,
                    interpolationRatio
                );
                const curvatureError = this._responseDistance(
                    midpoint.response,
                    interpolatedResponse,
                    scales
                );
                const score = chordLength + 4 * curvatureError;

                if (!bestSegment || score > bestSegment.score) {
                    bestSegment = { index, midpoint, score };
                }
            }

            if (!bestSegment) {
                throw new Error(`Unable to refine strain profiles at angle ${angle}.`);
            }

            nodes.splice(bestSegment.index + 1, 0, bestSegment.midpoint);
        }

        return nodes;
    }

    _createControlledStrainProfile(compressionV, tensionV, compressionStrain, tensionStrain) {
        const slope = (tensionStrain - compressionStrain) / (tensionV - compressionV);
        const intercept = compressionStrain - slope * compressionV;
        return [slope, intercept];
    }

    _getResponseScales(responses) {
        return {
            axial: Math.max(
                Math.abs(this.Pnmax),
                ...responses.map(response => Math.max(Math.abs(response.P), Math.abs(response.phiP))),
                1
            ),
            moment: Math.max(
                ...responses.map(response => Math.max(
                    Math.hypot(response.Mx, response.My),
                    Math.hypot(response.phiMx, response.phiMy)
                )),
                1
            )
        };
    }

    _responseDistance(left, right, scales) {
        const components = [
            (left.P - right.P) / scales.axial,
            (left.Mx - right.Mx) / scales.moment,
            (left.My - right.My) / scales.moment,
            (left.phiP - right.phiP) / scales.axial,
            (left.phiMx - right.phiMx) / scales.moment,
            (left.phiMy - right.phiMy) / scales.moment
        ];
        return Math.hypot(...components);
    }

    _interpolateResponses(left, right, ratio) {
        const interpolate = (start, end) => start + (end - start) * ratio;
        return {
            P: interpolate(left.P, right.P),
            Mx: interpolate(left.Mx, right.Mx),
            My: interpolate(left.My, right.My),
            phiP: interpolate(left.phiP, right.phiP),
            phiMx: interpolate(left.phiMx, right.phiMx),
            phiMy: interpolate(left.phiMy, right.phiMy)
        };
    }

    convertUVtoXY(angle, Mu, Mv) {
        let radians = (Math.PI / 180) * angle;
        const sinTheta = Math.sin(radians);
        const cosTheta = Math.cos(radians);

        // Coordinates are transformed as u = x cosθ + y sinθ and
        // v = -x sinθ + y cosθ. Mu and Mv contain the corresponding force
        // first moments, while the existing global convention is Mx = -ΣFy
        // and My = ΣFx. Applying the inverse rotation gives these signs.
        let Mx = -Mu * sinTheta - Mv * cosTheta;
        let My = Mu * cosTheta - Mv * sinTheta;
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

        const cachedResponses = this.strainProfileResponses[angle];
        const responses = cachedResponses?.length === this.strainProfiles[angle].length
            ? cachedResponses
            : this.strainProfiles[angle].map(
                profile => this._calculateProfileResponse(angle, profile)
            );

        this.PMMUVresults[angle] = {
            P: [responses.map(response => response.P)],
            Mu: [responses.map(response => response.Mu)],
            Mv: [responses.map(response => response.Mv)]
        };
        this.PMMXYresults[angle] = {
            P: [responses.map(response => response.P)],
            Mx: [responses.map(response => response.Mx)],
            My: [responses.map(response => response.My)],
            MaxRebarStrain: [responses.map(response => response.maxRebarStrain)],
            phiP: [responses.map(response => response.phiP)],
            phiMx: [responses.map(response => response.phiMx)],
            phiMy: [responses.map(response => response.phiMy)]
        };

        return this.PMMXYresults[angle];
    }

    _calculateProfileResponse(angle, strainProfile) {
        const transformed = this.transformedFEMcentroids[angle];
        const centroidU = transformed.centroidCoordinates.u;
        const centroidV = transformed.centroidCoordinates.v;
        let concreteForce = 0;
        let concreteMomentU = 0;
        let concreteMomentV = 0;
        let steelForce = 0;
        let steelMomentU = 0;
        let steelMomentV = 0;
        let maxRebarStrain = -Infinity;

        for (let index = 0; index < this.FEMmesh.length; index += 1) {
            const concreteElement = this.FEMmesh[index];
            const transformedConcrete = transformed.conc[index];
            if (!transformedConcrete) continue;

            const strain = this.strainFunction(
                strainProfile[0],
                transformedConcrete.v,
                strainProfile[1]
            );
            const elementMaterial = concreteElement.userData?.material
                ?? concreteElement.userData?.concShape?.material
                ?? this.material;
            const force = elementMaterial.stress(strain) * concreteElement.area;
            if (elementMaterial.type === 'steel') {
                maxRebarStrain = Math.max(maxRebarStrain, strain);
            }
            concreteForce += force;
            concreteMomentV += force * (centroidV - transformedConcrete.v);
            concreteMomentU += force * (centroidU - transformedConcrete.u);
        }

        for (const rebar of this.rebarObjects) {
            const transformedRebar = rebar.transformedCentroid[angle];
            if (!transformedRebar || !rebar.materialData) continue;

            const strain = this.strainFunction(
                strainProfile[0],
                transformedRebar.v,
                strainProfile[1]
            );
            const area = getRebarArea(rebar);
            const force = area * rebar.materialData.stress(strain);
            maxRebarStrain = Math.max(maxRebarStrain, strain);
            steelForce += force;
            steelMomentV += force * (centroidV - transformedRebar.v);
            steelMomentU += force * (centroidU - transformedRebar.u);
        }

        if (!Number.isFinite(maxRebarStrain)) {
            maxRebarStrain = Math.max(...this.FEMmesh.map((element, index) => {
                const transformedConcrete = transformed.conc[index];
                return transformedConcrete
                    ? this.strainFunction(strainProfile[0], transformedConcrete.v, strainProfile[1])
                    : -Infinity;
            }));
        }

        const P = (steelForce + concreteForce) / 1000;
        const Mu = (-steelMomentU - concreteMomentU) / 12 / 1000;
        const Mv = (-steelMomentV - concreteMomentV) / 12 / 1000;
        const { Mx, My } = this.convertUVtoXY(angle, Mu, Mv);
        const phi = this.calculatePhi("other", maxRebarStrain);
        const phiP = phi * Math.max(P, this.Pnmax);

        return {
            P,
            Mu,
            Mv,
            Mx,
            My,
            maxRebarStrain,
            phi,
            phiP,
            phiMx: phi * Mx,
            phiMy: phi * My
        };
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
                <div class="analysis-plots-grid">
                    <section class="analysis-plot-card">
                        <div class="analysis-plot-header">
                            <div><span class="analysis-eyebrow">Interaction surface</span><h3>Axial–Moment Capacity</h3></div>
                            <div class="plot-control-row">
                                <label for="angleSelection">Bending axis<select id="angleSelection"></select></label>
                                <label for="indexSelection">Strain profile<select id="indexSelection"></select></label>
                            </div>
                        </div>
                        <div id="pmPlot" class="analysis-plot"></div>
                    </section>

                    <section class="analysis-plot-card">
                        <div class="analysis-plot-header">
                            <div><span class="analysis-eyebrow">Constant axial slice</span><h3>Moment–Moment Capacity</h3></div>
                        </div>
                        <div class="plot-action-row">
                            <label for="mmAxialLoad">
                                Axial load (kips)<input id="mmAxialLoad" type="number" step="1" value="0">
                            </label>
                            <button id="generateMMButton" type="button">Generate MM</button>
                            <button id="exportAnalysisExcelButton" class="export-plot-button" type="button">Export Excel</button>
                        </div>
                        <div id="mmAxialRange" class="plot-helper-text"></div>
                        <div id="mmStatus" class="plot-status" role="status"></div>
                        <div id="excelExportStatus" class="plot-status" role="status"></div>
                        <div id="mmPlot" class="analysis-plot"></div>
                    </section>
                </div>
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
    
        let nominalColors = angles.map(angle => angle === selectedAngle ? "#0f4c81" : "#b8c4d1");
        let designColors = angles.map(angle => angle === selectedAngle ? "#0f766e" : "#a7d1cd");
        let symbolTypes = angles.map(angle => angle === selectedAngle ? "circle" : "cross");
    
        let originalTrace = {
            x: Mx_values, y: My_values, z: P_values,
            mode: "markers", type: "scatter3d",
            marker: { size: 5, color: nominalColors, opacity: 0.82, symbol: symbolTypes },
            name: "Nominal capacity",
            hovertemplate: "P - %{z:.1f} (k)<br> Mx - %{x:.1f} (kip*ft)<br> My - %{y:.1f} (kip*ft)<br> Index - %{customdata}",
            customdata: strainProfileIndices
        };
    
        let reducedTrace = {
            x: phiMx_values, y: phiMy_values, z: phiP_values,
            mode: "markers", type: "scatter3d",
            marker: { size: 5, color: designColors, opacity: 0.82, symbol: symbolTypes },
            name: "Design capacity (φ)",
            hovertemplate: "φP - %{z:.1f} (k)<br> φMx - %{x:.1f} (kip*ft)<br> φMy - %{y:.1f} (kip*ft)<br> Index - %{customdata}",
            customdata: strainProfileIndices
        };
    
        let layout = {
            paper_bgcolor: "#ffffff",
            plot_bgcolor: "#ffffff",
            font: { family: "Inter, system-ui, sans-serif", color: "#334155", size: 11 },
            scene: {
                bgcolor: "#ffffff",
                xaxis: { title: "Mx (kip-ft)", gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
                yaxis: { title: "My (kip-ft)", gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
                zaxis: { title: "P (kips)", gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
                aspectmode: "data",
                camera: { eye: { x: 1.45, y: 1.45, z: 1.05 } }
            },
            legend: { orientation: "h", x: 0, y: 1.04, bgcolor: "rgba(255,255,255,0.82)" },
            margin: { l: 0, r: 0, b: 0, t: 38 }
        };
    
        let plotDiv = document.getElementById("pmPlot");
    
        // ✅ If the plot already exists, just update it instead of redrawing
        const pmmTraces = [
            originalTrace,
            reducedTrace,
            ...this._createMomentMoment3DTraces(this.currentMomentMomentResult)
        ];

        if (plotDiv.data) {
            Plotly.react("pmPlot", pmmTraces, layout, { responsive: true, displaylogo: false });
        } else {
            Plotly.newPlot("pmPlot", pmmTraces, layout, { responsive: true, displaylogo: false });
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
                const clickedPoint = data.points[0];
                // MM slice points are display-only; PMM points continue to
                // drive the strain-profile and stress-result selection.
                if (
                    clickedPoint.data.meta?.isMomentMomentSlice
                    || clickedPoint.data.meta?.isPMMHighlight
                ) return;

                const clickedIndex = clickedPoint.customdata;
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

        this.setupMomentMomentControls();
    }

    setupMomentMomentControls() {
        const input = document.getElementById("mmAxialLoad");
        const button = document.getElementById("generateMMButton");
        const exportButton = document.getElementById("exportAnalysisExcelButton");
        const plot = document.getElementById("mmPlot");
        if (!input || !button || !plot) return;

        this.momentMomentAnalysis ??= new MomentMomentAnalysis(this);
        const limits = this.momentMomentAnalysis.getAxialLimits();
        const savedAxialLoad = getAnalysisConfiguration().momentMomentAxialLoad;
        if (!this.currentMomentMomentResult && Number.isFinite(savedAxialLoad)) {
            input.value = String(savedAxialLoad);
        }
        const currentValue = Number(input.value);

        // A newly created analysis starts by displaying the zero-axial-load
        // slice on both the 2D MM plot and the 3D PMM plot.
        if (!Number.isFinite(currentValue) || currentValue < limits.compression || currentValue > limits.tension) {
            input.value = limits.compression <= 0 && limits.tension >= 0
                ? "0"
                : ((limits.compression + limits.tension) / 2).toFixed(2);
        }

        this.validateMomentMomentInput();

        if (this.currentMomentMomentResult) {
            this.renderMomentMomentCurve(this.currentMomentMomentResult);
        } else {
            const emptyLayout = {
                title: "Calculating the P = 0 MM curve…",
                xaxis: { title: "Mx (kip-ft)" },
                yaxis: { title: "My (kip-ft)", scaleanchor: "x", scaleratio: 1 },
                margin: { l: 60, r: 20, b: 55, t: 50 }
            };
            if (plot.data) {
                Plotly.react(plot, [], emptyLayout, { responsive: true });
            } else {
                Plotly.newPlot(plot, [], emptyLayout, { responsive: true });
            }
        }

        if (!input.dataset.listenerAdded) {
            input.addEventListener("input", () => {
                const value = Number(input.value);
                if (Number.isFinite(value)) updateAnalysisConfiguration({ momentMomentAxialLoad: value });
                window.activeAnalysisSection?.validateMomentMomentInput();
            });
            input.dataset.listenerAdded = true;
        }

        if (!button.dataset.listenerAdded) {
            button.addEventListener("click", () => {
                window.activeAnalysisSection?.generateMomentMomentCurve();
            });
            button.dataset.listenerAdded = true;
        }

        if (exportButton && !exportButton.dataset.listenerAdded) {
            exportButton.addEventListener("click", () => {
                window.activeAnalysisSection?.exportAnalysisResultsToExcel();
            });
            exportButton.dataset.listenerAdded = "true";
        }

        this.updateAnalysisExportButtonState();

        if (!this.currentMomentMomentResult && !button.dataset.running) {
            void this.generateMomentMomentCurve();
        }
    }

    validateMomentMomentInput() {
        const input = document.getElementById("mmAxialLoad");
        const button = document.getElementById("generateMMButton");
        const range = document.getElementById("mmAxialRange");
        const status = document.getElementById("mmStatus");
        if (!input || !button || !range) return { valid: false };

        const solver = this.momentMomentAnalysis ?? new MomentMomentAnalysis(this);
        this.momentMomentAnalysis = solver;
        const limits = solver.getAxialLimits();
        const value = Number(input.value);
        input.min = String(limits.compression);
        input.max = String(limits.tension);
        const valid = input.value.trim() !== ""
            && Number.isFinite(value)
            && value >= limits.compression
            && value <= limits.tension;

        range.textContent = `Valid axial range: ${limits.compression.toFixed(2)} to ${limits.tension.toFixed(2)} kips`;
        input.style.color = valid ? "" : "#dc2626";
        input.style.borderColor = valid ? "#9ca3af" : "#dc2626";
        input.setAttribute("aria-invalid", String(!valid));
        button.disabled = !valid;
        button.style.opacity = valid ? "1" : "0.55";
        button.style.cursor = valid ? "pointer" : "not-allowed";

        if (!valid && status) {
            status.textContent = "Axial load is outside the section capacity range.";
            status.style.color = "#dc2626";
            status.dataset.validationError = "true";
        } else if (status?.dataset.validationError === "true") {
            status.textContent = "";
            status.style.color = "";
            delete status.dataset.validationError;
        }

        return { valid, value, limits };
    }

    async generateMomentMomentCurve() {
        const validation = this.validateMomentMomentInput();
        if (!validation.valid) return;

        const button = document.getElementById("generateMMButton");
        const input = document.getElementById("mmAxialLoad");
        const status = document.getElementById("mmStatus");
        button.disabled = true;
        input.disabled = true;
        button.dataset.running = "true";
        button.textContent = "Calculating…";
        this.updateAnalysisExportButtonState(true);
        status.style.color = "#4b5563";
        status.textContent = "Calculating initial MM points…";

        try {
            const result = await this.momentMomentAnalysis.generate(validation.value, {
                onProgress: progress => {
                    if (progress.stage === "initial") {
                        status.textContent = `Calculating MM points ${progress.completed}/${progress.total}…`;
                    } else {
                        status.textContent = `Refining MM curve (${progress.completed} points)…`;
                    }
                }
            });
            this.currentMomentMomentResult = result;
            this.selectedMomentMomentPoint = null;
            this.renderMomentMomentCurve(result);
            await this.renderMomentMomentCurveOnPMM(result);
        } catch (error) {
            console.error("Failed to generate MM curve:", error);
            status.textContent = error.message;
            status.style.color = "#dc2626";
        } finally {
            delete button.dataset.running;
            input.disabled = false;
            button.textContent = "Generate MM";
            this.validateMomentMomentInput();
            this.updateAnalysisExportButtonState();
        }
    }

    updateAnalysisExportButtonState(forceDisabled = false) {
        const button = document.getElementById("exportAnalysisExcelButton");
        if (!button || button.dataset.exporting === "true") return;

        const ready = !forceDisabled
            && Boolean(this.currentMomentMomentResult)
            && Object.keys(this.PMMXYresults ?? {}).length > 0;
        button.disabled = !ready;
        button.style.opacity = ready ? "1" : "0.55";
        button.style.cursor = ready ? "pointer" : "not-allowed";
        button.title = ready
            ? "Export the current MM curve and selected neutral-axis results"
            : "Wait for the MM curve to finish calculating";
    }

    async exportAnalysisResultsToExcel() {
        const button = document.getElementById("exportAnalysisExcelButton");
        const status = document.getElementById("excelExportStatus");
        if (!button || !this.currentMomentMomentResult) return;

        button.dataset.exporting = "true";
        button.disabled = true;
        button.textContent = "Building workbook…";
        if (status) {
            status.textContent = "Preparing section image and analysis tables…";
            status.style.color = "#4b5563";
        }

        try {
            const filename = await exportSectionAnalysisWorkbook(this);
            if (status) {
                status.textContent = `Downloaded ${filename}`;
                status.style.color = "#166534";
            }
        } catch (error) {
            console.error("Failed to export analysis workbook:", error);
            if (status) {
                status.textContent = `Excel export failed: ${error.message}`;
                status.style.color = "#dc2626";
            }
        } finally {
            delete button.dataset.exporting;
            button.textContent = "Export Excel";
            this.updateAnalysisExportButtonState();
        }
    }

    renderMomentMomentCurve(result) {
        const plot = document.getElementById("mmPlot");
        const status = document.getElementById("mmStatus");
        if (!plot || !status) return;

        const pointMetadata = result.points.map((point, pointIndex) => [point.angle, pointIndex]);
        const nominalTrace = {
            x: result.points.map(point => point.nominal?.Mx ?? null),
            y: result.points.map(point => point.nominal?.My ?? null),
            customdata: pointMetadata,
            mode: "lines+markers",
            type: "scatter",
            name: "Nominal MM",
            connectgaps: false,
            line: { color: "#0f4c81", width: 3 },
            marker: { color: "#0f4c81", size: 4 },
            meta: { isMomentMomentCurve: true, mode: 'nominal' },
            hovertemplate: "Mx: %{x:.2f} kip-ft<br>My: %{y:.2f} kip-ft<br>NA angle: %{customdata[0]:.2f}°<extra>Nominal</extra>"
        };
        const phiTrace = {
            x: result.points.map(point => point.phi?.Mx ?? null),
            y: result.points.map(point => point.phi?.My ?? null),
            customdata: pointMetadata,
            mode: "lines+markers",
            type: "scatter",
            name: "Design MM (φ)",
            connectgaps: false,
            line: { color: "#0f766e", width: 3 },
            marker: { color: "#0f766e", size: 4 },
            meta: { isMomentMomentCurve: true, mode: 'phi' },
            hovertemplate: "φMx: %{x:.2f} kip-ft<br>φMy: %{y:.2f} kip-ft<br>NA angle: %{customdata[0]:.2f}°<extra>φMM</extra>"
        };

        const traces = [nominalTrace, phiTrace];
        const selected = this.selectedMomentMomentPoint;
        const selectedPoint = selected ? result.points[selected.pointIndex] : null;
        const selectedSolution = selectedPoint?.[selected?.mode];
        if (selectedSolution) {
            traces.push({
                x: [selectedSolution.Mx],
                y: [selectedSolution.My],
                customdata: [[selectedPoint.angle, selected.pointIndex]],
                mode: 'markers',
                type: 'scatter',
                name: 'Selected MM point',
                marker: {
                    color: '#7c3aed',
                    size: 11,
                    symbol: 'diamond',
                    line: { color: '#ffffff', width: 1.5 }
                },
                meta: { isMomentMomentHighlight: true },
                hovertemplate: "Mx: %{x:.2f} kip-ft<br>My: %{y:.2f} kip-ft<extra>Selected</extra>"
            });
        }

        Plotly.react(plot, traces, {
            title: { text: `P = ${result.axialLoad.toFixed(2)} kips`, font: { size: 14, color: "#334155" } },
            paper_bgcolor: "#ffffff",
            plot_bgcolor: "#ffffff",
            font: { family: "Inter, system-ui, sans-serif", color: "#334155", size: 11 },
            xaxis: { title: "Mx (kip-ft)", zeroline: true, gridcolor: "#e2e8f0", zerolinecolor: "#94a3b8" },
            yaxis: {
                title: "My (kip-ft)",
                zeroline: true,
                gridcolor: "#e2e8f0",
                zerolinecolor: "#94a3b8",
                scaleanchor: "x",
                scaleratio: 1
            },
            legend: { orientation: "h", x: 0, y: 1.08 },
            margin: { l: 60, r: 20, b: 55, t: 55 }
        }, { responsive: true });

        if (!plot.dataset.responseSelectionListenerAdded) {
            plot.on('plotly_click', event => {
                const clicked = event.points?.[0];
                if (!clicked?.data?.meta?.isMomentMomentCurve) return;
                const pointIndex = Number(clicked.customdata?.[1] ?? clicked.pointIndex);
                window.activeAnalysisSection?.selectMomentMomentPoint?.(
                    pointIndex,
                    clicked.data.meta.mode
                );
            });
            plot.dataset.responseSelectionListenerAdded = 'true';
        }

        const nominalCount = result.points.filter(point => point.nominal).length;
        const phiCount = result.points.filter(point => point.phi).length;
        const generatedMessage = phiCount
            ? `Generated ${nominalCount} nominal and ${phiCount} φ MM points.`
            : `Generated ${nominalCount} nominal MM points. No φMM solutions exist at this axial load.`;
        const selectionMessage = selectedSolution
            ? ` Selected ${selected.mode === 'phi' ? 'design' : 'nominal'} point at ${selectedPoint.angle.toFixed(2)}°.`
            : '';
        status.textContent = generatedMessage + selectionMessage;
        status.style.color = phiCount ? "#166534" : "#92400e";
    }

    selectMomentMomentPoint(pointIndex, mode) {
        const result = this.currentMomentMomentResult;
        const point = result?.points?.[pointIndex];
        const solution = point?.[mode];
        if (!solution?.strainProfile) return;

        const normalizedAngle = ((point.angle % 360) + 360) % 360;
        this.selectedMomentMomentPoint = { pointIndex, mode };
        this.generate3dStressPlot(normalizedAngle, solution.strainProfile, {
            source: 'MM',
            title: 'Selected MM Values',
            subtitle: `${mode === 'phi' ? 'Design (φ)' : 'Nominal'} · NA angle ${point.angle.toFixed(2)}°`,
            rows: [{
                label: mode === 'phi' ? 'Design (φ)' : 'Nominal',
                P: solution.P,
                Mx: solution.Mx,
                My: solution.My
            }]
        });
        this.renderMomentMomentCurve(result);
        void this.renderMomentMomentCurveOnPMM(result);

        setTimeout(() => setupRaycastingForResults(scene, camera, renderer), 100);
    }

    _createMomentMoment3DTraces(result) {
        if (!result) return [];

        const createTrace = (mode, name, color) => {
            const hasSolutions = result.points.some(point => point[mode]);
            if (!hasSolutions) return null;

            return {
                x: result.points.map(point => point[mode]?.Mx ?? null),
                y: result.points.map(point => point[mode]?.My ?? null),
                // Plot the solved curve as an exact horizontal slice at the
                // axial load requested by the user.
                z: result.points.map(point => point[mode] ? result.axialLoad : null),
                customdata: result.points.map((point, pointIndex) => [point.angle, pointIndex]),
                mode: "lines+markers",
                type: "scatter3d",
                connectgaps: false,
                name,
                legendgroup: mode,
                line: { color, width: 7 },
                marker: { color, size: 3, opacity: 1 },
                meta: { isMomentMomentSlice: true, mode },
                hovertemplate: `${mode === "phi" ? "φ" : ""}Mx: %{x:.2f} kip-ft<br>`
                    + `${mode === "phi" ? "φ" : ""}My: %{y:.2f} kip-ft<br>`
                    + `P: %{z:.2f} kips<br>NA angle: %{customdata[0]:.2f}°<extra>${name}</extra>`
            };
        };

        const traces = [
            createTrace("nominal", "Nominal MM slice", "#0f4c81"),
            createTrace("phi", "Design MM slice (φ)", "#0f766e")
        ].filter(Boolean);

        const selected = this.selectedMomentMomentPoint;
        const selectedPoint = selected ? result.points[selected.pointIndex] : null;
        const selectedSolution = selectedPoint?.[selected?.mode];
        if (selectedSolution) {
            traces.push({
                x: [selectedSolution.Mx],
                y: [selectedSolution.My],
                z: [result.axialLoad],
                mode: 'markers',
                type: 'scatter3d',
                name: 'Selected MM point',
                marker: {
                    color: '#7c3aed',
                    size: 8,
                    symbol: 'diamond',
                    line: { color: '#ffffff', width: 1 }
                },
                meta: { isMomentMomentSlice: true, isMomentMomentHighlight: true },
                hovertemplate: 'Mx: %{x:.2f} kip-ft<br>My: %{y:.2f} kip-ft<br>P: %{z:.2f} kips<extra>Selected MM</extra>'
            });
        }
        return traces;
    }

    async renderMomentMomentCurveOnPMM(result) {
        const plot = document.getElementById("pmPlot");
        if (!plot?.data) return;

        const existingSliceIndices = plot.data
            .map((trace, index) => trace.meta?.isMomentMomentSlice ? index : -1)
            .filter(index => index >= 0);
        if (existingSliceIndices.length) {
            await Plotly.deleteTraces(plot, existingSliceIndices);
        }

        const traces = this._createMomentMoment3DTraces(result);
        if (traces.length) await Plotly.addTraces(plot, traces);
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
        let updatedNominalColors = originalColors.map((_, i) =>
            allAngles[i] === selectedAngle ? "#0f4c81" : "#b8c4d1"
        );
        let updatedDesignColors = originalColors.map((_, i) =>
            allAngles[i] === selectedAngle ? "#0f766e" : "#a7d1cd"
        );
    
        let updatedSymbols = originalSymbols.map((_, i) =>
            allAngles[i] === selectedAngle ? "circle" : "cross"
        );
    
        Plotly.restyle("pmPlot", {
            "marker.color": [updatedNominalColors],
            "marker.symbol": [updatedSymbols]
        }, [0]);
        Plotly.restyle("pmPlot", {
            "marker.color": [updatedDesignColors],
            "marker.symbol": [updatedSymbols]
        }, [1]);
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
        if (!plotDiv?.data) return;

        const highlightedTraceIndex = plotDiv.data.findIndex(
            trace => trace.meta?.isPMMHighlight
        );
        if (highlightedTraceIndex >= 0) {
            Plotly.deleteTraces(plotDiv, highlightedTraceIndex);
        }
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
            marker: { size: 9, color: "#7c3aed", opacity: 1.0, symbol: "diamond", line: { color: "#ffffff", width: 1 } },
            name: "Selected Point",
            meta: { isPMMHighlight: true },
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

    setSectionResponseMode(mode) {
        if (!['stress', 'strain'].includes(mode)) return;
        this.sectionResponseMode = mode;
        this.syncSectionResponseControl();
        if (this.currentStrainProfile && Number.isFinite(this.currentResponseAngle)) {
            this.render3dSectionResponse();
        }
    }

    syncSectionResponseControl() {
        document.querySelectorAll('input[name="sectionResponseMode"]').forEach(input => {
            input.checked = input.value === this.sectionResponseMode;
        });
        const hint = document.getElementById('sectionResponseHint');
        if (hint) {
            hint.textContent = this.sectionResponseMode === 'strain'
                ? 'Linear compatible strain'
                : 'Element stress';
        }
    }

    generate3dStressPlot(angle, strainProfile, selection = null) {
        if (!Array.isArray(strainProfile) || strainProfile.length < 2) return;
        if (!this.transformedFEMcentroids[angle]) {
            this.transformCoordinatesAtAngle(angle, false);
        }

        this.currentResponseAngle = Number(angle);
        this.currentStrainProfile = [...strainProfile];
        this.currentResponseSelection = selection ?? this.createPMMResponseSelection(angle);
        this.syncSectionResponseControl();
        this.render3dSectionResponse();
    }

    createPMMResponseSelection(angle) {
        const selectedIndex = Number(window.selectedIndex ?? 0);
        const data = this.PMMXYresults[angle];
        const valueAt = key => Number(data?.[key]?.[0]?.[selectedIndex] ?? 0);
        return {
            source: 'PMM',
            title: 'Selected PMM Values',
            subtitle: `NA angle ${Number(angle).toFixed(2)}° · Strain profile ${selectedIndex}`,
            rows: [
                {
                    label: 'Nominal',
                    P: valueAt('P'),
                    Mx: valueAt('Mx'),
                    My: valueAt('My')
                },
                {
                    label: 'Capacity',
                    P: valueAt('phiP'),
                    Mx: valueAt('phiMx'),
                    My: valueAt('phiMy')
                }
            ]
        };
    }

    render3dSectionResponse() {
        const mode = this.sectionResponseMode;
        const angle = this.currentResponseAngle;
        const strainProfile = this.currentStrainProfile;
        const responseDepth = 4;
        const concreteMat = this.material;
        const sectionValuesByElement = new Map();
        let sectionMin = Infinity;
        let sectionMax = -Infinity;

        const centroidStrain = element => {
            const transformed = element.transformedCentroid?.[angle];
            return transformed
                ? strainProfile[0] * transformed.v + strainProfile[1]
                : 0;
        };
        const elementMaterial = element => element.userData?.material
            ?? element.userData?.concShape?.material
            ?? concreteMat;

        for (const object of this.FEMmesh) {
            const positions = object.geometry?.attributes?.position?.array;
            if (!positions) continue;

            const values = [];
            const stress = elementMaterial(object).stress(centroidStrain(object));
            for (let index = 0; index < positions.length; index += 3) {
                const value = mode === 'strain'
                    ? linearStrainAtPoint(
                        positions[index],
                        positions[index + 1],
                        this.centroidX,
                        this.centroidY,
                        angle,
                        strainProfile
                    )
                    : stress;
                values.push(value);
                sectionMin = Math.min(sectionMin, value);
                sectionMax = Math.max(sectionMax, value);
            }
            sectionValuesByElement.set(object, values);
        }

        if (!Number.isFinite(sectionMin) || !Number.isFinite(sectionMax)) {
            sectionMin = 0;
            sectionMax = 0;
        }
        const sectionScale = Math.max(
            Math.abs(sectionMin),
            Math.abs(sectionMax),
            mode === 'stress' ? 1 : 1e-9
        );

        for (const [object, values] of sectionValuesByElement) {
            const positionAttribute = object.geometry.attributes.position;
            let colorAttribute = object.geometry.attributes.color;
            if (!colorAttribute || colorAttribute.array.length !== positionAttribute.array.length) {
                colorAttribute = new THREE.BufferAttribute(
                    new Float32Array(positionAttribute.array.length),
                    3
                );
                object.geometry.setAttribute('color', colorAttribute);
            }

            for (let vertexIndex = 0; vertexIndex < values.length; vertexIndex += 1) {
                const value = values[vertexIndex];
                const arrayIndex = vertexIndex * 3;
                const [red, green, blue] = responseColor(value, sectionMin, sectionMax);
                positionAttribute.array[arrayIndex + 2] = value / sectionScale * responseDepth;
                colorAttribute.array[arrayIndex] = red / 255;
                colorAttribute.array[arrayIndex + 1] = green / 255;
                colorAttribute.array[arrayIndex + 2] = blue / 255;
            }
            positionAttribute.needsUpdate = true;
            colorAttribute.needsUpdate = true;
            object.geometry.computeVertexNormals?.();
            object.geometry.computeBoundingBox();
            object.geometry.computeBoundingSphere();
        }

        const rebarResponses = this.rebarObjects.map(object => {
            const strain = centroidStrain(object);
            return {
                object,
                strain,
                stress: object.materialData?.stress?.(strain) ?? 0
            };
        });
        const rebarStresses = rebarResponses.map(item => item.stress).filter(Number.isFinite);
        const minRebarStress = rebarStresses.length ? Math.min(...rebarStresses) : Infinity;
        const maxRebarStress = rebarStresses.length ? Math.max(...rebarStresses) : -Infinity;
        const rebarStressScale = Math.max(
            Math.abs(minRebarStress),
            Math.abs(maxRebarStress),
            1
        );

        scene.children
            .filter(object => object.userData.isCustomArrow === true)
            .forEach(arrow => scene.remove(arrow));

        for (const { object, strain, stress } of rebarResponses) {
            const positionAttribute = object.geometry?.getAttribute?.('position');
            if (!positionAttribute) continue;

            const displayValue = mode === 'strain'
                ? strain
                : concreteMat.stress(strain);
            positionAttribute.array[2] = displayValue / sectionScale * responseDepth;
            positionAttribute.needsUpdate = true;
            object.geometry.computeBoundingBox();
            object.geometry.computeBoundingSphere();

            const colorValue = mode === 'strain' ? strain : stress;
            const colorMin = mode === 'strain' ? sectionMin : minRebarStress;
            const colorMax = mode === 'strain' ? sectionMax : maxRebarStress;
            const [red, green, blue] = responseColor(colorValue, colorMin, colorMax);
            object.material.color.setRGB(red / 255, green / 255, blue / 255);
            object.material.transparent = true;
            object.material.opacity = mode === 'strain' ? 0.9 : 0.78;
            object.material.needsUpdate = true;

            if (mode === 'stress') {
                const arrowLength = Math.abs(stress) / rebarStressScale * responseDepth;
                if (arrowLength > 0.04) {
                    const direction = new THREE.Vector3(0, 0, stress < 0 ? -1 : 1);
                    const start = new THREE.Vector3(
                        positionAttribute.array[0],
                        positionAttribute.array[1],
                        positionAttribute.array[2] + (stress < 0 ? arrowLength : 0)
                    );
                    const arrow = new THREE.ArrowHelper(
                        direction,
                        start,
                        arrowLength,
                        object.material.color.getHex(),
                        Math.min(0.3, arrowLength * 0.35),
                        Math.min(0.2, arrowLength * 0.25)
                    );
                    arrow.userData.isCustomArrow = true;
                    scene.add(arrow);
                }
            }
        }

        this.colorScaleHTML({
            mode,
            sectionMin: mode === 'stress' ? sectionMin / 1000 : sectionMin,
            sectionMax: mode === 'stress' ? sectionMax / 1000 : sectionMax,
            rebarMin: minRebarStress / 1000,
            rebarMax: maxRebarStress / 1000
        });
    }

    colorScaleHTML({ mode, sectionMin, sectionMax, rebarMin, rebarMax }) {
        const selectedPointProps = document.getElementById('selectedPointResultProps');
        if (!selectedPointProps) return;

        const selection = this.currentResponseSelection ?? this.createPMMResponseSelection(
            this.currentResponseAngle ?? 0
        );
        const rows = (selection.rows ?? []).map(row => `
            <tr>
                <td class="py-1 px-2 font-medium border border-gray-300">${row.label}</td>
                <td class="py-1 px-2 border border-gray-300">${Number(row.P ?? 0).toFixed(2)}</td>
                <td class="py-1 px-2 border border-gray-300">${Number(row.Mx ?? 0).toFixed(2)}</td>
                <td class="py-1 px-2 border border-gray-300">${Number(row.My ?? 0).toFixed(2)}</td>
            </tr>
        `).join('');
        const formatValue = value => mode === 'strain'
            ? Number(value).toExponential(3)
            : Number(value).toFixed(1);
        const hasRebarStress = mode === 'stress'
            && Number.isFinite(rebarMin)
            && Number.isFinite(rebarMax);

        selectedPointProps.innerHTML = `
            <div class="pmm-values p-3 bg-white shadow-md rounded-md">
                <h3 class="text-sm font-semibold text-center mb-1">${selection.title}</h3>
                <p class="response-selection-subtitle">${selection.subtitle ?? ''}</p>
                <table class="w-auto mx-auto border border-gray-300 text-center text-xs rounded-md overflow-hidden">
                    <thead class="bg-gray-100 text-gray-600">
                        <tr>
                            <th class="py-1 px-2 border border-gray-300"></th>
                            <th class="py-1 px-2 border border-gray-300">Axial (k)</th>
                            <th class="py-1 px-2 border border-gray-300">Mx (k*ft)</th>
                            <th class="py-1 px-2 border border-gray-300">My (k*ft)</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <div class="stress-scale">
                <p><strong>Section ${mode === 'strain' ? 'Strain (in/in)' : 'Polygon Stress (ksi)'}</strong></p>
                <div class="color-bar" style="background: ${responseGradientCSS(sectionMin, sectionMax)};"></div>
                <div class="scale-labels">
                    <span>${formatValue(sectionMin)}</span>
                    <span>${formatValue((sectionMin + sectionMax) / 2)}</span>
                    <span>${formatValue(sectionMax)}</span>
                </div>
                ${mode === 'strain' ? '<p class="response-field-note">Compatible strain is evaluated at every triangle vertex.</p>' : ''}
            </div>
            ${hasRebarStress ? `<div class="stress-scale">
                <p><strong>Rebar Stress (ksi)</strong></p>
                <div class="color-bar" style="background: ${responseGradientCSS(rebarMin, rebarMax)};"></div>
                <div class="scale-labels">
                    <span>${rebarMin.toFixed(1)}</span>
                    <span>${((rebarMin + rebarMax) / 2).toFixed(1)}</span>
                    <span>${rebarMax.toFixed(1)}</span>
                </div>
            </div>` : ''}
        `;
    }

    populateAnalysisResults() {
        let analysisResults = document.getElementById("analysisResults");
        let userInputProps = document.getElementById("userInputProps");

        if (!analysisResults) return;

        if (userInputProps) userInputProps.hidden = true;
        analysisResults.hidden = false;

    
        // ✅ Ensure `this.FEMarea` and `this.centroidX` exist
        let FEMarea = this.FEMarea || 0;
        let centroidX = this.centroidX || 0;
        let centroidY = this.centroidY || 0;
        let rebarArea = this.totalRebarArea||0;
        let reinforcementRatio = FEMarea > 0 ? (rebarArea / FEMarea) * 100 : 0;
        const escapeHTML = value => String(value).replace(/[&<>'"]/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
        const materialRows = (this.materialSummary ?? []).map((item, index) => `
            <tr>
                <td><span class="material-swatch material-swatch-${item.type}"></span>${escapeHTML(item.name)}</td>
                <td>${escapeHTML(item.type)}</td>
                <td>${item.area.toFixed(2)}</td>
                <td>${item.percentage.toFixed(1)}%</td>
                <td>${item.priorities.join(', ')}</td>
                <td>${item.triangleCount.toLocaleString()}</td>
            </tr>
        `).join('');

        analysisResults.innerHTML = `
        <div class="analysis-summary-card">
            <div class="analysis-summary-heading">
                <div>
                    <span class="analysis-eyebrow">Resolved section</span>
                    <h3>Section Properties</h3>
                </div>
                <span class="analysis-total-area">${FEMarea.toFixed(1)} in²</span>
            </div>
            <table class="section-metrics-table">
                <thead>
                    <tr>
                        <th>Polygon area</th><th>Rebar area</th><th>Rebar ratio</th><th>Centroid X</th><th>Centroid Y</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>${FEMarea.toFixed(2)} in²</td><td>${rebarArea.toFixed(2)} in²</td><td>${reinforcementRatio.toFixed(2)}%</td>
                        <td>${centroidX.toFixed(2)} in</td><td>${centroidY.toFixed(2)} in</td>
                    </tr>
                </tbody>
            </table>
            <div class="material-breakdown-heading">
                <h4>Material Breakdown</h4>
                <span>Priority-resolved FEM area</span>
            </div>
            <div class="material-breakdown-scroll">
                <table class="material-breakdown-table">
                    <thead><tr><th>Material</th><th>Type</th><th>Area (in²)</th><th>Share</th><th>Priority</th><th>Triangles</th></tr></thead>
                    <tbody>${materialRows || '<tr><td colspan="6">No material regions were generated.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
        `;
    }

    setupResultsControls(){
        console.log("Setting up results controls...");
        // Remove mouse interactions setup
        console.log(controls)

        // Re-enable orbit controls rotation and panning
        if (typeof controls !== 'undefined') {
            const interaction = cameraInteractionForMode(camera.isOrthographicCamera ? 'top' : 'perspective');
            controls.enableRotate = interaction.enableRotate;
            controls.enablePan = interaction.enablePan;
            controls.enableZoom = interaction.enableZoom;
            controls.mouseButtons = {
                LEFT: THREE.MOUSE.ROTATE,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN
            };
            
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
