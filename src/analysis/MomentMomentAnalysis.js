// Bounds used to describe the strain-profile search path. Compression is
// negative in the section's sign convention; tension is positive.
const COMPRESSION_STRAIN = -0.003;
const PURE_TENSION_STRAIN = 0.00507;

/**
 * Generates an Mx-My interaction curve at one user-specified axial load.
 *
 * The numerical workflow is:
 *  1. rotate the section to a neutral-axis angle;
 *  2. sweep a family of compatible linear strain profiles;
 *  3. bracket and solve every profile that reaches the target axial load;
 *  4. keep the solution farthest outward in the angle's moment direction;
 *  5. insert more angles where the curve needs additional resolution.
 *
 * Nominal and phi-reduced forces are solved separately because phi varies with
 * strain, although both searches reuse the same section-response evaluations.
 */
export class MomentMomentAnalysis {
    constructor(section, options = {}) {
        this.section = section;
        // Angular settings control the coarse sweep and adaptive refinement.
        this.initialAngleStep = options.initialAngleStep ?? 5;
        this.minimumAngleStep = options.minimumAngleStep ?? 0.5;
        this.curveTolerance = options.curveTolerance ?? 0.005;
        this.maximumCurvePoints = options.maximumCurvePoints ?? 180;
        // Bisection is bounded so a difficult root cannot stall the UI.
        this.maximumRootIterations = options.maximumRootIterations ?? 60;
        this.angleCache = new Map();
        this.contextCache = new Map();
    }

    /** Return the nominal compression and tension limits for axial-load input. */
    getAxialLimits() {
        this._ensureAngleIsTransformed(0);
        const pureTension = this.section._calculateProfileResponse(
            0,
            [0, PURE_TENSION_STRAIN]
        );

        return {
            compression: this.section.Pnmax,
            tension: pureTension.P
        };
    }

    /**
     * Calculate nominal and phi-reduced MM curves at a constant axial load.
     * A phi point may be null when no reduced-strength solution exists there.
     */
    async generate(targetAxialLoad, options = {}) {
        const onProgress = options.onProgress ?? (() => {});
        const limits = this.getAxialLimits();
        const axialTolerance = Math.max(
            0.1,
            Math.abs(limits.tension - limits.compression) * 0.0001
        );

        if (!Number.isFinite(targetAxialLoad)) {
            throw new Error("Axial load must be a finite number.");
        }
        if (
            targetAxialLoad < limits.compression - axialTolerance
            || targetAxialLoad > limits.tension + axialTolerance
        ) {
            throw new RangeError(
                `Axial load must be between ${limits.compression.toFixed(2)} and ${limits.tension.toFixed(2)} kips.`
            );
        }

        this.angleCache.clear();
        this.contextCache.clear();
        this.targetAxialLoad = Math.min(
            limits.tension,
            Math.max(limits.compression, targetAxialLoad)
        );
        this.axialTolerance = axialTolerance;

        // First solve a closed coarse sweep. Keeping 360 as a display angle
        // allows the last segment to be refined while sharing the 0-degree solve.
        const angleNodes = [];
        const initialAngles = [];
        for (let angle = 0; angle < 360; angle += this.initialAngleStep) {
            initialAngles.push(angle);
        }
        initialAngles.push(360);

        for (let index = 0; index < initialAngles.length; index += 1) {
            angleNodes.push(this._solveAtAngle(initialAngles[index]));
            onProgress({
                stage: "initial",
                completed: index + 1,
                total: initialAngles.length
            });
            if ((index + 1) % 4 === 0) await this._yieldToBrowser();
        }

        let momentScale = this._getMomentScale(angleNodes);

        // Repeatedly insert the midpoint with the greatest interpolation error.
        // This spends the fixed point budget where the curve bends most.
        while (angleNodes.length < this.maximumCurvePoints) {
            let bestRefinement = null;

            for (let index = 0; index < angleNodes.length - 1; index += 1) {
                const left = angleNodes[index];
                const right = angleNodes[index + 1];
                const angleSpan = right.angle - left.angle;
                if (angleSpan <= this.minimumAngleStep) continue;

                const midpointAngle = (left.angle + right.angle) / 2;
                const midpoint = this._solveAtAngle(midpointAngle);
                const nominalError = this._curveInterpolationError(
                    left.nominal,
                    midpoint.nominal,
                    right.nominal,
                    momentScale
                );
                const phiError = this._curveInterpolationError(
                    left.phi,
                    midpoint.phi,
                    right.phi,
                    momentScale
                );
                const score = Math.max(nominalError, phiError);

                if (score > this.curveTolerance && (!bestRefinement || score > bestRefinement.score)) {
                    bestRefinement = { index, midpoint, score };
                }
            }

            if (!bestRefinement) break;
            angleNodes.splice(bestRefinement.index + 1, 0, bestRefinement.midpoint);
            momentScale = Math.max(momentScale, this._getMomentScale([bestRefinement.midpoint]));
            onProgress({
                stage: "refining",
                completed: angleNodes.length,
                total: this.maximumCurvePoints
            });
            await this._yieldToBrowser();
        }

        return {
            axialLoad: this.targetAxialLoad,
            axialTolerance,
            limits,
            points: angleNodes
        };
    }

    _solveAtAngle(displayAngle) {
        const normalizedAngle = this._normalizeAngle(displayAngle);
        const cacheKey = normalizedAngle.toFixed(8);
        let cached = this.angleCache.get(cacheKey);

        // Adaptive refinement may request an angle that was already evaluated.
        if (!cached) {
            const context = this._createAngleContext(normalizedAngle);
            // Both modes share context.sampleCache, avoiding duplicate section
            // integrations when they inspect the same strain parameter.
            const nominalSolutions = this._findAxialSolutions(context, "nominal");
            const phiSolutions = this._findAxialSolutions(context, "phi");
            cached = {
                nominal: this._selectEnvelopeSolution(nominalSolutions, "nominal", normalizedAngle),
                phi: this._selectEnvelopeSolution(phiSolutions, "phi", normalizedAngle)
            };
            this.angleCache.set(cacheKey, cached);
        }

        return {
            angle: displayAngle,
            nominal: cached.nominal,
            phi: cached.phi
        };
    }

    _createAngleContext(angle) {
        const cacheKey = angle.toFixed(8);
        if (this.contextCache.has(cacheKey)) return this.contextCache.get(cacheKey);

        this._ensureAngleIsTransformed(angle);
        const { max: compressionV } = this.section._getConcreteVBounds(angle);
        const concreteCentroids = this.section.transformedFEMcentroids[angle].conc
            .map(point => point.v);
        const rebarLocations = this.section.rebarObjects
            .map(rebar => rebar.transformedCentroid[angle]?.v)
            .filter(value => value !== undefined);
        const plateSteelLocations = this.section.FEMmesh
            .filter(element => (element.userData?.material ?? element.userData?.concShape?.material)?.type === 'steel')
            .map(element => element.transformedCentroid?.[angle]?.v)
            .filter(value => value !== undefined);
        const tensionControlLocations = rebarLocations.length
            ? [...rebarLocations, ...plateSteelLocations]
            : plateSteelLocations.length
                ? plateSteelLocations
                : concreteCentroids;
        const tensionV = Math.min(...tensionControlLocations);
        const tensionDistance = Math.abs(tensionV - compressionV);

        if (!Number.isFinite(tensionDistance) || tensionDistance <= Number.EPSILON) {
            throw new Error(`Unable to establish a strain depth at angle ${angle}.`);
        }

        const concreteDistances = concreteCentroids
            .map(value => Math.abs(value - compressionV))
            .filter(value => value > 1e-9);
        const rebarDistances = tensionControlLocations
            .map(value => Math.abs(value - compressionV))
            .filter(value => value > 1e-9);
        const nearestConcrete = Math.min(...concreteDistances);
        const nearestRebar = Math.min(...rebarDistances);
        // Extend the strain path far enough for all concrete centroids to leave
        // compression and for all reinforcing bars to reach the tension limit.
        const terminalCurvature = Math.max(
            1.01 * Math.abs(COMPRESSION_STRAIN) / nearestConcrete,
            1.01 * (PURE_TENSION_STRAIN - COMPRESSION_STRAIN) / nearestRebar
        );
        const terminalTensionStrain = Math.min(
            0.5,
            Math.max(
                0.025,
                COMPRESSION_STRAIN + terminalCurvature * tensionDistance
            )
        );

        const context = {
            angle,
            compressionV,
            tensionV,
            terminalTensionStrain,
            sampleCache: new Map()
        };
        // Each parameter is the strain at the selected tension-side steel or
        // section control point.
        context.parameters = this._createSearchParameters(terminalTensionStrain);
        this.contextCache.set(cacheKey, context);
        return context;
    }

    _createSearchParameters(terminalTensionStrain) {
        // Explicit parameters preserve important material/control strain states.
        const parameters = new Set([
            -0.003,
            -0.0025,
            -0.00207,
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
            0.025,
            terminalTensionStrain
        ]);

        // Cubic spacing concentrates samples near maximum compression, where
        // axial response often changes faster than it does in deep tension.
        for (let index = 0; index <= 32; index += 1) {
            const ratio = index / 32;
            const parameter = COMPRESSION_STRAIN
                + (terminalTensionStrain - COMPRESSION_STRAIN) * ratio ** 3;
            parameters.add(parameter);
        }

        return [...parameters]
            .filter(value => value >= COMPRESSION_STRAIN && value <= terminalTensionStrain)
            .sort((left, right) => left - right);
    }

    _findAxialSolutions(context, mode) {
        // The coarse samples discover every apparent crossing of the requested
        // axial-load level; there can be more than one crossing at an angle.
        const samples = context.parameters.map(parameter => this._evaluateParameter(context, parameter));
        const solutions = [];

        for (let index = 0; index < samples.length; index += 1) {
            const sample = samples[index];
            const residual = this._getAxialValue(sample.response, mode) - this.targetAxialLoad;
            if (Math.abs(residual) <= this.axialTolerance) solutions.push(sample);

            if (index === samples.length - 1) continue;
            const next = samples[index + 1];
            const nextResidual = this._getAxialValue(next.response, mode) - this.targetAxialLoad;
            // Opposite residual signs form a bracket containing a root.
            if (residual * nextResidual < 0) {
                const bracketedSolution = this._solveBracket(context, sample, next, mode);
                if (bracketedSolution) solutions.push(bracketedSolution);
            }
        }

        return this._deduplicateSolutions(solutions, mode);
    }

    _solveBracket(context, initialLeft, initialRight, mode) {
        let left = initialLeft;
        let right = initialRight;
        let leftResidual = this._getAxialValue(left.response, mode) - this.targetAxialLoad;
        let best = Math.abs(leftResidual)
            <= Math.abs(this._getAxialValue(right.response, mode) - this.targetAxialLoad)
            ? left
            : right;

        // This is a deterministic bisection root solve, not a general-purpose
        // optimization routine. It needs no derivatives or starting guess once
        // a sign-changing bracket has been found.
        for (let iteration = 0; iteration < this.maximumRootIterations; iteration += 1) {
            const midpointParameter = (left.parameter + right.parameter) / 2;
            const midpoint = this._evaluateParameter(context, midpointParameter);
            const midpointResidual = this._getAxialValue(midpoint.response, mode) - this.targetAxialLoad;

            if (
                Math.abs(midpointResidual)
                < Math.abs(this._getAxialValue(best.response, mode) - this.targetAxialLoad)
            ) {
                best = midpoint;
            }
            if (Math.abs(midpointResidual) <= this.axialTolerance) return midpoint;

            if (leftResidual * midpointResidual <= 0) {
                right = midpoint;
            } else {
                left = midpoint;
                leftResidual = midpointResidual;
            }
        }

        // Do not allow a failed bracket solve to masquerade as a point on the
        // requested constant-axial-load curve.
        const bestResidual = this._getAxialValue(best.response, mode) - this.targetAxialLoad;
        return Math.abs(bestResidual) <= this.axialTolerance ? best : null;
    }

    _evaluateParameter(context, parameter) {
        const key = parameter.toPrecision(15);
        if (context.sampleCache.has(key)) return context.sampleCache.get(key);

        const atPureTension = Math.abs(parameter - context.terminalTensionStrain) < 1e-12;
        // The search endpoint is uniform pure tension. All other samples keep
        // the compression edge at -0.003 and vary the tension-side strain.
        const profile = atPureTension
            ? [0, PURE_TENSION_STRAIN]
            : this.section._createControlledStrainProfile(
                context.compressionV,
                context.tensionV,
                COMPRESSION_STRAIN,
                parameter
            );
        const sample = {
            parameter,
            profile,
            response: this.section._calculateProfileResponse(context.angle, profile)
        };
        context.sampleCache.set(key, sample);
        return sample;
    }

    _getAxialValue(response, mode) {
        // Nominal compression cannot exceed Pn,max. Phi mode uses the reduced
        // force calculated for that specific strain profile.
        return mode === "phi"
            ? response.phiP
            : Math.max(response.P, this.section.Pnmax);
    }

    _deduplicateSolutions(solutions, mode) {
        const unique = [];
        for (const solution of solutions) {
            // Adjacent coarse brackets can converge to the same physical root.
            const duplicate = unique.some(existing => {
                const existingMoment = mode === "phi"
                    ? [existing.response.phiMx, existing.response.phiMy]
                    : [existing.response.Mx, existing.response.My];
                const solutionMoment = mode === "phi"
                    ? [solution.response.phiMx, solution.response.phiMy]
                    : [solution.response.Mx, solution.response.My];
                return Math.hypot(
                    existingMoment[0] - solutionMoment[0],
                    existingMoment[1] - solutionMoment[1]
                ) < 1e-6;
            });
            if (!duplicate) unique.push(solution);
        }
        return unique;
    }

    _selectEnvelopeSolution(solutions, mode, angle) {
        if (!solutions.length) return null;
        // If several strain profiles reach the same axial load, retain the one
        // with the largest outward moment projection: the MM envelope point.
        const best = solutions.reduce((currentBest, candidate) => {
            const bestProjection = this._getOutwardMomentProjection(currentBest.response, mode, angle);
            const candidateProjection = this._getOutwardMomentProjection(candidate.response, mode, angle);
            return candidateProjection > bestProjection ? candidate : currentBest;
        });
        const response = best.response;

        return mode === "phi"
            ? {
                Mx: response.phiMx,
                My: response.phiMy,
                P: response.phiP,
                strainProfile: best.profile
            }
            : {
                Mx: response.Mx,
                My: response.My,
                P: Math.max(response.P, this.section.Pnmax),
                strainProfile: best.profile
            };
    }

    _getOutwardMomentProjection(response, mode, angle) {
        const radians = angle * Math.PI / 180;
        const Mx = mode === "phi" ? response.phiMx : response.Mx;
        const My = mode === "phi" ? response.phiMy : response.My;
        // With the section's local/global convention, increasing neutral-axis
        // angle points outward along [cosθ, sinθ].
        return Mx * Math.cos(radians) + My * Math.sin(radians);
    }

    _curveInterpolationError(left, midpoint, right, scale) {
        const presentCount = [left, midpoint, right].filter(Boolean).length;
        if (presentCount === 0) return 0;
        // Force refinement near boundaries where a phi solution appears or
        // disappears, while allowing an entirely absent phi segment.
        if (presentCount !== 3) return 1;

        const expectedMx = (left.Mx + right.Mx) / 2;
        const expectedMy = (left.My + right.My) / 2;
        return Math.hypot(
            midpoint.Mx - expectedMx,
            midpoint.My - expectedMy
        ) / scale;
    }

    _getMomentScale(nodes) {
        return Math.max(
            ...nodes.flatMap(node => [node.nominal, node.phi])
                .filter(Boolean)
                .map(point => Math.hypot(point.Mx, point.My)),
            1
        );
    }

    _ensureAngleIsTransformed(angle) {
        // Coordinate transformation is cached by the section for later solves.
        if (!this.section.transformedFEMcentroids[angle]) {
            this.section.transformCoordinatesAtAngle(angle, false);
        }
    }

    _normalizeAngle(angle) {
        const normalized = angle % 360;
        return normalized < 0 ? normalized + 360 : normalized;
    }

    _yieldToBrowser() {
        // Release the main thread so progress and rendering remain responsive.
        return new Promise(resolve => {
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(() => resolve());
            } else {
                setTimeout(resolve, 0);
            }
        });
    }
}
