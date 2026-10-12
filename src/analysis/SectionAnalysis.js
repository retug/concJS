// Shared numerical engine for the interactive application and regression runs.
// Methods are kept in one place so verification exercises production calculations.
import { getRebarArea } from '../rebarProperties.js';
import { calculateRebarForce, findRebarConcreteMaterial } from './rebarConcreteDisplacement.js';

export class SectionAnalysis {
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
        this.momentMomentResults = [];
        this.mmLoadTargets = [];
        this.materialSummary = [];
        this.sectionResponseMode = 'stress';
        this.currentResponseAngle = null;
        this.currentStrainProfile = null;
        this.currentResponseSelection = null;
        this.selectedMomentMomentPoint = null;
        this.activeDemand = null;
        this.mmGeneration = 0;
        this.mmAbortController = null;
        this.mmPendingLoad = null;
        this.pmmPlotUpdates = null;
        this.rebarConcreteMaterials = new Map();
        this.rebarConcreteMaterialMesh = null;
    }

    initializeRebarObjects(allSelectedRebar) {
        this.resetAnalysisResults();
        this.rebarObjects = allSelectedRebar;
        this.rebarConcreteMaterials.clear();
        this.rebarConcreteMaterialMesh = null;
        this.totalRebarArea = this.rebarObjects.reduce((sum, rebar) => {
            return sum + getRebarArea(rebar);
        }, 0);
    }

    resetAnalysisResults() {
        this.pmmPlotUpdates?.cancelPending();
        this.mmAbortController?.abort();
        this.mmGeneration += 1;
        this.mmPendingLoad = null;
        this.activeDemand = null;
        this.demandChecks?.dispose();
        this.demandChecks = null;
        this.PMMXYresults = {};
        this.PMMUVresults = {};
        this.transformedFEMcentroids = {};
        this.strainProfiles = {};
        this.strainProfileResponses = {};
        this.Pnmax = 0;
        this.momentMomentAnalysis = null;
        this.currentMomentMomentResult = null;
        this.momentMomentResults = [];
        this.mmLoadTargets = [];
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
            nominalAxialStrength += material.stress(-0.003) * element.area;
        }

        for (const rebar of this.rebarObjects) {
            const steelMaterial = rebar.materialData;
            if (!steelMaterial) continue;

            const area = getRebarArea(rebar);
            const strain = -0.003;
            const concreteMaterial = this.getRebarConcreteMaterial(rebar);
            nominalAxialStrength += calculateRebarForce(
                area,
                steelMaterial,
                concreteMaterial,
                strain
            );
        }

        this.Pnmax = 0.8 * nominalAxialStrength / 1000;
        return this.Pnmax;
    }

    getRebarConcreteMaterial(rebar) {
        if (this.rebarConcreteMaterialMesh !== this.FEMmesh) {
            this.rebarConcreteMaterials.clear();
            this.rebarConcreteMaterialMesh = this.FEMmesh;
        }
        if (!this.rebarConcreteMaterials.has(rebar)) {
            this.rebarConcreteMaterials.set(
                rebar,
                findRebarConcreteMaterial(rebar, this.FEMmesh)
            );
        }
        return this.rebarConcreteMaterials.get(rebar);
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
            const force = calculateRebarForce(
                area,
                rebar.materialData,
                this.getRebarConcreteMaterial(rebar),
                strain
            );
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

}
