import { scene } from './main.js';
import { AnalyzableConcreteSection } from './analysis/AnalyzableConcreteSection.js';
import { buildResolvedSectionMesh } from './sectionMeshing.js';

/**
 * Analysis container for one or more overlapping section polygons. Input
 * polygons stay intact for editing; the FEM mesh is their resolved boolean
 * arrangement, with one governing material on every triangle.
 */
export class CompositeConcShape extends AnalyzableConcreteSection {
    constructor(concShapes) {
        if (!Array.isArray(concShapes) || concShapes.length === 0) {
            throw new Error('A composite section requires at least one section polygon.');
        }

        const primaryMaterial = concShapes.find(shape => shape.material?.type === 'concrete')?.material
            ?? concShapes[0].material;
        super(primaryMaterial);
        this.concShapes = concShapes;
        this.combinedPoints = [];
        this.triangles = [];
        this.materialSummary = [];
        this.resolvedRegions = [];
    }

    generateCombinedMesh(interiorSpacing, edgeSpacing) {
        const resolved = buildResolvedSectionMesh(this.concShapes, {
            interiorSpacing,
            edgeSpacing
        });
        this.FEMmesh = resolved.elements;
        this.FEMarea = resolved.area;
        this.centroidX = resolved.centroidX;
        this.centroidY = resolved.centroidY;
        this.materialSummary = resolved.materialSummary;
        this.resolvedRegions = resolved.regions;

        for (const element of this.FEMmesh) {
            element.userData.compShape = this;
            scene.add(element);
        }

        return this.FEMmesh;
    }

    checkMaterialConsistency() {
        return true;
    }
}
