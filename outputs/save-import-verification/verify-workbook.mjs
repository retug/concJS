import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';
import { buildAnalysisWorkbookBytes } from '../../src/analysis/AnalysisExcelExporter.js';

const outputDirectory = dirname(fileURLToPath(import.meta.url));
const workbookPath = join(outputDirectory, 'save-import-metadata-verification.xlsx');
const onePixelPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const model = {
  generated: new Date('2026-08-16T20:00:00-04:00'),
  project: {
    name: 'Pier 4 Retrofit',
    description: 'Imported and saved section input model.',
    notes: 'Verification metadata for the save/import workflow.'
  },
  selectedAngle: 30,
  mm: { axialLoad: -200 },
  selectedRows: [{
    index: 0,
    angle: 30,
    slope: -0.0002,
    intercept: 0.001,
    p: -500,
    mx: 120,
    my: 60,
    maxStrain: 0.005,
    phi: 0.9,
    phiP: -450,
    phiMx: 108,
    phiMy: 54
  }],
  mmRows: [{
    index: 0,
    angle: 0,
    nominalP: -200,
    nominalMx: 180,
    nominalMy: 0,
    nominalSlope: -0.0002,
    nominalIntercept: 0.001,
    phiP: -180,
    phiMx: 162,
    phiMy: 0,
    phiSlope: -0.00018,
    phiIntercept: 0.001
  }],
  imageDataUrl: onePixelPng,
  parameters: {
    concreteMaterial: 'Verification Concrete',
    width: 24,
    height: 24,
    concreteArea: 547.73,
    rebarCount: 1,
    steelArea: Math.PI / 4,
    reinforcementRatio: (Math.PI / 4) / 547.73,
    centroidX: 0,
    centroidY: 0,
    rebarSizes: '1 × #8',
    rebarMaterials: '1 × Verification Steel',
    edgeSpacing: 0.75,
    interiorSpacing: 1.25
  }
};

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(workbookPath, buildAnalysisWorkbookBytes(model));

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(workbookPath));
const summary = await workbook.inspect({
  kind: 'table',
  range: 'Summary!A1:L26',
  include: 'values,formulas',
  tableMaxRows: 26,
  tableMaxCols: 12,
  maxChars: 8000
});
const formulaErrors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan'
});

for (const sheetName of ['Summary', 'Selected NA Results', 'MM Results']) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(
    join(outputDirectory, `${sheetName.toLowerCase().replaceAll(' ', '-')}.png`),
    new Uint8Array(await preview.arrayBuffer())
  );
}

console.log(summary.ndjson ?? summary);
console.log(formulaErrors.ndjson ?? formulaErrors);
