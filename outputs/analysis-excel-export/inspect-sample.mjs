import fs from 'node:fs/promises';
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const input = await FileBlob.load('analysis-export-sample.xlsx');
const workbook = await SpreadsheetFile.importXlsx(input);
const inspection = await workbook.inspect({
    kind: 'workbook,sheet,region,drawing,formula',
    range: 'A1:L25',
    maxChars: 8000,
    tableMaxRows: 8,
    tableMaxCols: 12,
    options: { maxResults: 80 }
});
console.log(inspection.ndjson ?? inspection);

const preview = await workbook.render({
    sheetName: 'Summary',
    autoCrop: 'all',
    scale: 1,
    format: 'png'
});
await fs.writeFile('summary-preview.png', new Uint8Array(await preview.arrayBuffer()));

