import * as THREE from 'three';
import Plotly from 'plotly.js-dist-min';
import { scene, controls, camera, renderer } from '../main.js';
import { setupRaycastingForResults } from '../threeJSscenefunctions.js';
import { getRebarArea } from '../rebarProperties.js';
import { getAnalysisConfiguration, updateAnalysisConfiguration } from '../projectState.js';
import { MomentMomentAnalysis } from './MomentMomentAnalysis.js';
import { exportSectionAnalysisWorkbook } from './AnalysisExcelExporter.js';

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

            const area = getRebarArea(rebar);
            totalSteelForce -= area * steelMaterial.stress(0.005);
        }

        const nominalAxialStrength = 0.85 * fpc * this.FEMarea + totalSteelForce;
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

        if (!rebarLocations.length || !concLocations.length) {
            console.error("❌ Rebar or Concrete locations are empty. Cannot generate strain profiles.");
            return;
        }

        const { min: concreteMin, max: concreteMax } = this._getConcreteVBounds(angle);
        const rebarMin = Math.min(...rebarLocations);
        const rebarMax = Math.max(...rebarLocations);

        const positiveBranch = this._generateAdaptiveStrainBranch(angle, {
            compressionV: concreteMax,
            tensionV: rebarMin,
            concreteCentroids: concLocations,
            rebarLocations,
            targetCount: 51
        });

        const negativeBranch = this._generateAdaptiveStrainBranch(angle, {
            compressionV: concreteMin,
            tensionV: rebarMax,
            concreteCentroids: concLocations,
            rebarLocations,
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
            const force = this.material.stress(strain) * concreteElement.area;
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
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 1rem; align-items: start;">
                    <section>
                        <h3>3D PMM Interaction Diagram</h3>
                        <label for="angleSelection">Select Bending Axis Angle:</label>
                        <select id="angleSelection"></select>

                        <label for="indexSelection">Select Strain Profile Index:</label>
                        <select id="indexSelection"></select>

                        <div id="pmPlot" style="width: 100%; height: 500px;"></div>
                    </section>

                    <section>
                        <h3>Moment-Moment Interaction Diagram</h3>
                        <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end;">
                            <label for="mmAxialLoad" style="display: grid; gap: 0.25rem;">
                                Axial load (kips)
                                <input id="mmAxialLoad" type="number" step="1" value="0" style="min-width: 10rem; border: 1px solid #9ca3af; border-radius: 0.25rem; padding: 0.35rem 0.5rem;">
                            </label>
                            <button id="generateMMButton" type="button" style="border: 1px solid #6b7280; border-radius: 0.25rem; padding: 0.4rem 0.75rem; background: #f3f4f6;">
                                Generate MM
                            </button>
                            <button id="exportAnalysisExcelButton" type="button" style="border: 1px solid #166534; border-radius: 0.25rem; padding: 0.4rem 0.75rem; background: #dcfce7; color: #14532d;">
                                Export Excel
                            </button>
                        </div>
                        <div id="mmAxialRange" style="margin-top: 0.35rem; font-size: 0.8rem; color: #4b5563;"></div>
                        <div id="mmStatus" role="status" style="min-height: 1.25rem; margin-top: 0.25rem; font-size: 0.8rem;"></div>
                        <div id="excelExportStatus" role="status" style="min-height: 1.25rem; margin-top: 0.15rem; font-size: 0.8rem;"></div>
                        <div id="mmPlot" style="width: 100%; height: 500px;"></div>
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
        const pmmTraces = [
            originalTrace,
            reducedTrace,
            ...this._createMomentMoment3DTraces(this.currentMomentMomentResult)
        ];

        if (plotDiv.data) {
            Plotly.react("pmPlot", pmmTraces, layout);
        } else {
            Plotly.newPlot("pmPlot", pmmTraces, layout);
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

        const angles = result.points.map(point => point.angle);
        const nominalTrace = {
            x: result.points.map(point => point.nominal?.Mx ?? null),
            y: result.points.map(point => point.nominal?.My ?? null),
            customdata: angles,
            mode: "lines+markers",
            type: "scatter",
            name: "Nominal MM",
            connectgaps: false,
            line: { color: "#f97316", width: 3 },
            marker: { color: "#f97316", size: 4 },
            hovertemplate: "Mx: %{x:.2f} kip-ft<br>My: %{y:.2f} kip-ft<br>NA angle: %{customdata:.2f}°<extra>Nominal</extra>"
        };
        const phiTrace = {
            x: result.points.map(point => point.phi?.Mx ?? null),
            y: result.points.map(point => point.phi?.My ?? null),
            customdata: angles,
            mode: "lines+markers",
            type: "scatter",
            name: "Reduced (φMM)",
            connectgaps: false,
            line: { color: "#2563eb", width: 3 },
            marker: { color: "#2563eb", size: 4 },
            hovertemplate: "φMx: %{x:.2f} kip-ft<br>φMy: %{y:.2f} kip-ft<br>NA angle: %{customdata:.2f}°<extra>φMM</extra>"
        };

        Plotly.react(plot, [nominalTrace, phiTrace], {
            title: `M-M Capacity at P = ${result.axialLoad.toFixed(2)} kips`,
            xaxis: { title: "Mx (kip-ft)", zeroline: true },
            yaxis: {
                title: "My (kip-ft)",
                zeroline: true,
                scaleanchor: "x",
                scaleratio: 1
            },
            legend: { orientation: "h" },
            margin: { l: 60, r: 20, b: 55, t: 55 }
        }, { responsive: true });

        const nominalCount = result.points.filter(point => point.nominal).length;
        const phiCount = result.points.filter(point => point.phi).length;
        status.textContent = phiCount
            ? `Generated ${nominalCount} nominal and ${phiCount} φ MM points.`
            : `Generated ${nominalCount} nominal MM points. No φMM solutions exist at this axial load.`;
        status.style.color = phiCount ? "#166534" : "#92400e";
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
                customdata: result.points.map(point => point.angle),
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
                    + `P: %{z:.2f} kips<br>NA angle: %{customdata:.2f}°<extra>${name}</extra>`
            };
        };

        return [
            createTrace("nominal", "Nominal MM slice", "#f97316"),
            createTrace("phi", "Reduced (φMM) slice", "#2563eb")
        ].filter(Boolean);
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
        let updatedColors = originalColors.map((_, i) =>
            allAngles[i] === selectedAngle ? "rgb(255, 100, 0)" : "rgb(200, 200, 200)"
        );
    
        let updatedSymbols = originalSymbols.map((_, i) =>
            allAngles[i] === selectedAngle ? "circle" : "cross"
        );
    
        Plotly.restyle("pmPlot", {
            "marker.color": [updatedColors],
            "marker.symbol": [updatedSymbols]
        }, [0, 1]);
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
            marker: { size: 10, color: "rgb(255, 0, 0)", opacity: 1.0, symbol: "diamond" },
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

        if (userInputProps) userInputProps.hidden = true;
        analysisResults.hidden = false;

    
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
