import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildAnalysisWorkbookBytes } from '../../src/analysis/AnalysisExcelExporter.js';
import sharp from 'sharp';

const outputDirectory = dirname(fileURLToPath(import.meta.url));
await mkdir(outputDirectory, { recursive: true });

const sampleSectionSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640" viewBox="0 0 960 640">
  <rect width="960" height="640" fill="white"/>
  <text x="72" y="52" font-family="Arial" font-size="28" font-weight="bold" fill="#102a43">Concrete Section and Reinforcement</text>
  <rect x="250" y="90" width="460" height="460" fill="#cbd5e1" stroke="#334e68" stroke-width="6"/>
  <g fill="#dc2626" stroke="#7f1d1d" stroke-width="3">
    <circle cx="290" cy="130" r="13"/><circle cx="480" cy="130" r="13"/><circle cx="670" cy="130" r="13"/>
    <circle cx="290" cy="320" r="13"/><circle cx="670" cy="320" r="13"/>
    <circle cx="290" cy="510" r="13"/><circle cx="480" cy="510" r="13"/><circle cx="670" cy="510" r="13"/>
  </g>
  <path d="M465 320h30M480 305v30" stroke="#2563eb" stroke-width="4"/>
  <text x="370" y="600" font-family="Arial" font-size="22" fill="#334e68">Overall width: 24.00 in</text>
</svg>`;
const pngBuffer = await sharp(Buffer.from(sampleSectionSvg)).png().toBuffer();
const png = `data:image/png;base64,${pngBuffer.toString('base64')}`;
const selectedRows = Array.from({ length: 8 }, (_, index) => ({
    index,
    angle: 30,
    slope: -0.0002 + index * 0.00005,
    intercept: -0.003 + index * 0.0008,
    p: -900 + index * 180,
    mx: 50 + index * 22,
    my: 20 + index * 9,
    maxStrain: 0.001 + index * 0.0007,
    phi: 0.65 + index * 0.03,
    phiP: -585 + index * 120,
    phiMx: 33 + index * 16,
    phiMy: 13 + index * 7
}));
const mmRows = Array.from({ length: 12 }, (_, index) => {
    const angle = index * 30;
    const radians = angle * Math.PI / 180;
    return {
        index,
        angle,
        nominalP: 0,
        nominalMx: 200 * Math.cos(radians),
        nominalMy: 150 * Math.sin(radians),
        nominalSlope: -0.00025,
        nominalIntercept: 0.001,
        phiP: index < 9 ? 0 : undefined,
        phiMx: index < 9 ? 150 * Math.cos(radians) : undefined,
        phiMy: index < 9 ? 110 * Math.sin(radians) : undefined,
        phiSlope: index < 9 ? -0.0002 : undefined,
        phiIntercept: index < 9 ? 0.0015 : undefined
    };
});

const model = {
    generated: new Date('2026-08-15T12:00:00-04:00'),
    selectedAngle: 30,
    mm: { axialLoad: 0 },
    selectedRows,
    mmRows,
    imageDataUrl: png,
    parameters: {
        concreteMaterial: 'fc4ksi',
        width: 24,
        height: 24,
        concreteArea: 576,
        rebarCount: 8,
        steelArea: 7.995,
        reinforcementRatio: 7.995 / 576,
        centroidX: 0,
        centroidY: 0,
        rebarSizes: '8 × #9',
        rebarMaterials: '8 × fy60ksi',
        edgeSpacing: 1,
        interiorSpacing: 1
    }
};

const bytes = buildAnalysisWorkbookBytes(model);
await writeFile(join(outputDirectory, 'analysis-export-sample.xlsx'), bytes);
