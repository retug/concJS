import { getRebarDiameter } from '../rebarProperties.js';
import { getProjectMetadata } from '../projectState.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const encoder = new TextEncoder();

function escapeXml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;');
}

function columnName(index) {
    let value = index;
    let name = '';
    while (value > 0) {
        value -= 1;
        name = String.fromCharCode(65 + value % 26) + name;
        value = Math.floor(value / 26);
    }
    return name;
}

function makeCell(row, column, value, style = 0, type = 'number') {
    const reference = `${columnName(column)}${row}`;
    if (value === null || value === undefined || (type === 'number' && !Number.isFinite(value))) {
        return `<c r="${reference}" s="${style}"/>`;
    }
    if (type === 'string') {
        return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    }
    if (type === 'formula') {
        return `<c r="${reference}" s="${style}"><f>${escapeXml(value.formula)}</f><v>${value.result}</v></c>`;
    }
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
}

function makeRow(row, cells, height) {
    const attributes = height ? ` ht="${height}" customHeight="1"` : '';
    return `<row r="${row}"${attributes}>${cells.join('')}</row>`;
}

function makeWorksheet({ rows, columns, merges = [], freezeRows = 0, autoFilter, drawing = false }) {
    const lastRow = Math.max(rows.length, 1);
    const lastColumn = Math.max(columns.length, 1);
    const columnXml = columns
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join('');
    const freezeXml = freezeRows > 0
        ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
        : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1:${columnName(lastColumn)}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0">${freezeXml}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>${columnXml}</cols>
  <sheetData>${rows.join('')}</sheetData>
  ${autoFilter ? `<autoFilter ref="${autoFilter}"/>` : ''}
  ${merges.length ? `<mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}
  <pageMargins left="0.35" right="0.35" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
  ${drawing ? '<drawing r:id="rId1"/>' : ''}
</worksheet>`;
}

function getShapeLoops(section) {
    const shapes = Array.isArray(section.concShapes) && section.concShapes.length
        ? section.concShapes
        : [section];

    return shapes.map(shape => {
        if (shape.baseshape?.extractPoints) {
            const points = shape.baseshape.extractPoints(96);
            return {
                exterior: points.shape.map(point => ({ x: point.x, y: point.y })),
                holes: points.holes.map(hole => hole.map(point => ({ x: point.x, y: point.y })))
            };
        }

        const position = shape.mesh?.geometry?.attributes?.position?.array;
        const exterior = [];
        for (let index = 0; position && index < position.length; index += 3) {
            exterior.push({ x: position[index], y: position[index + 1] });
        }
        return { exterior, holes: [] };
    }).filter(loop => loop.exterior.length);
}

function getConcreteBounds(loops, rebars = []) {
    const points = loops.flatMap(loop => [loop.exterior, ...loop.holes]).flat();
    if (!points.length) {
        points.push(...rebars.map(rebar => ({
            x: rebar.geometry.attributes.position.array[0],
            y: rebar.geometry.attributes.position.array[1]
        })));
    }
    if (!points.length) points.push({ x: -1, y: -1 }, { x: 1, y: 1 });

    return points.reduce((bounds, point) => ({
        minX: Math.min(bounds.minX, point.x),
        maxX: Math.max(bounds.maxX, point.x),
        minY: Math.min(bounds.minY, point.y),
        maxY: Math.max(bounds.maxY, point.y)
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
}

function createSectionImage(section, loops, bounds) {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 640;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create the section image.');

    const margin = { left: 92, right: 52, top: 70, bottom: 84 };
    const width = Math.max(bounds.maxX - bounds.minX, 1);
    const height = Math.max(bounds.maxY - bounds.minY, 1);
    const scale = Math.min(
        (canvas.width - margin.left - margin.right) / width,
        (canvas.height - margin.top - margin.bottom) / height
    );
    const drawingWidth = width * scale;
    const drawingHeight = height * scale;
    const offsetX = margin.left + (canvas.width - margin.left - margin.right - drawingWidth) / 2;
    const offsetY = margin.top + (canvas.height - margin.top - margin.bottom - drawingHeight) / 2;
    const project = point => ({
        x: offsetX + (point.x - bounds.minX) * scale,
        y: offsetY + (bounds.maxY - point.y) * scale
    });

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#102a43';
    context.font = 'bold 25px Arial, sans-serif';
    context.fillText('Concrete Section and Reinforcement', margin.left, 36);

    context.strokeStyle = '#dbe4ee';
    context.lineWidth = 1;
    for (let index = 0; index <= 8; index += 1) {
        const x = margin.left + index * (canvas.width - margin.left - margin.right) / 8;
        const y = margin.top + index * (canvas.height - margin.top - margin.bottom) / 8;
        context.beginPath();
        context.moveTo(x, margin.top);
        context.lineTo(x, canvas.height - margin.bottom);
        context.stroke();
        context.beginPath();
        context.moveTo(margin.left, y);
        context.lineTo(canvas.width - margin.right, y);
        context.stroke();
    }

    for (const loop of loops) {
        context.beginPath();
        const addPath = points => {
            points.forEach((point, index) => {
                const projected = project(point);
                if (index === 0) context.moveTo(projected.x, projected.y);
                else context.lineTo(projected.x, projected.y);
            });
            context.closePath();
        };
        addPath(loop.exterior);
        loop.holes.forEach(addPath);
        context.fillStyle = '#cbd5e1';
        context.fill('evenodd');
        context.strokeStyle = '#334e68';
        context.lineWidth = 3;
        context.stroke();
    }

    for (const rebar of section.rebarObjects ?? []) {
        const position = rebar.geometry?.attributes?.position?.array;
        if (!position) continue;
        const center = project({ x: position[0], y: position[1] });
        const diameter = getRebarDiameter(rebar) ?? 0.5;
        const radius = Math.max(4, diameter * scale / 2);
        context.beginPath();
        context.arc(center.x, center.y, radius, 0, Math.PI * 2);
        context.fillStyle = '#dc2626';
        context.fill();
        context.strokeStyle = '#7f1d1d';
        context.lineWidth = 1.5;
        context.stroke();
    }

    const centroid = project({ x: section.centroidX ?? 0, y: section.centroidY ?? 0 });
    context.strokeStyle = '#2563eb';
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(centroid.x - 10, centroid.y);
    context.lineTo(centroid.x + 10, centroid.y);
    context.moveTo(centroid.x, centroid.y - 10);
    context.lineTo(centroid.x, centroid.y + 10);
    context.stroke();

    context.fillStyle = '#334e68';
    context.font = '18px Arial, sans-serif';
    context.textAlign = 'center';
    context.fillText(`Overall width: ${width.toFixed(2)} in`, canvas.width / 2, canvas.height - 42);
    context.save();
    context.translate(28, canvas.height / 2);
    context.rotate(-Math.PI / 2);
    context.fillText(`Overall height: ${height.toFixed(2)} in`, 0, 0);
    context.restore();

    context.textAlign = 'left';
    context.fillStyle = '#dc2626';
    context.beginPath();
    context.arc(canvas.width - 208, 35, 7, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#334e68';
    context.font = '16px Arial, sans-serif';
    context.fillText('Reinforcing bar', canvas.width - 192, 41);

    return canvas.toDataURL('image/png');
}

function base64ToBytes(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function collectRebarSummary(rebars) {
    const quantities = new Map();
    const materials = new Map();
    for (const rebar of rebars) {
        const size = `#${rebar.rebarSize}`;
        const material = rebar.materialData?.name ?? 'Unspecified';
        quantities.set(size, (quantities.get(size) ?? 0) + 1);
        materials.set(material, (materials.get(material) ?? 0) + 1);
    }
    return {
        sizes: [...quantities].map(([size, quantity]) => `${quantity} × ${size}`).join(', ') || 'None',
        materials: [...materials].map(([material, quantity]) => `${quantity} × ${material}`).join(', ') || 'None'
    };
}

function collectWorkbookModel(section) {
    const angleElement = document.getElementById('angleSelection');
    const availableAngles = Object.keys(section.PMMXYresults ?? {}).map(Number);
    const selectedAngle = Number(angleElement?.value ?? availableAngles[0]);
    const selected = section.PMMXYresults[selectedAngle];
    const mm = section.currentMomentMomentResult;
    if (!selected) throw new Error('No PMM results exist for the selected neutral-axis angle.');
    if (!mm) throw new Error('Generate an MM curve before exporting.');

    const loops = getShapeLoops(section);
    const bounds = getConcreteBounds(loops, section.rebarObjects);
    const rebars = section.rebarObjects ?? [];
    const rebarSummary = collectRebarSummary(rebars);
    const responseRows = section.strainProfileResponses?.[selectedAngle] ?? [];
    const profiles = section.strainProfiles?.[selectedAngle] ?? [];
    const p = selected.P?.flat() ?? [];
    const mx = selected.Mx?.flat() ?? [];
    const my = selected.My?.flat() ?? [];
    const maxStrain = selected.MaxRebarStrain?.flat() ?? [];
    const phiP = selected.phiP?.flat() ?? [];
    const phiMx = selected.phiMx?.flat() ?? [];
    const phiMy = selected.phiMy?.flat() ?? [];

    const selectedRows = p.map((value, index) => ({
        index,
        angle: selectedAngle,
        slope: profiles[index]?.[0],
        intercept: profiles[index]?.[1],
        p: value,
        mx: mx[index],
        my: my[index],
        maxStrain: maxStrain[index],
        phi: responseRows[index]?.phi,
        phiP: phiP[index],
        phiMx: phiMx[index],
        phiMy: phiMy[index]
    }));

    const mmRows = mm.points.map((point, index) => ({
        index,
        angle: point.angle,
        nominalP: point.nominal?.P,
        nominalMx: point.nominal?.Mx,
        nominalMy: point.nominal?.My,
        nominalSlope: point.nominal?.strainProfile?.[0],
        nominalIntercept: point.nominal?.strainProfile?.[1],
        phiP: point.phi?.P,
        phiMx: point.phi?.Mx,
        phiMy: point.phi?.My,
        phiSlope: point.phi?.strainProfile?.[0],
        phiIntercept: point.phi?.strainProfile?.[1]
    }));

    return {
        generated: new Date(),
        project: getProjectMetadata(),
        selectedAngle,
        mm,
        selectedRows,
        mmRows,
        loops,
        bounds,
        imageDataUrl: createSectionImage(section, loops, bounds),
        parameters: {
            concreteMaterial: section.material?.name ?? 'Unspecified',
            width: bounds.maxX - bounds.minX,
            height: bounds.maxY - bounds.minY,
            concreteArea: section.FEMarea ?? 0,
            rebarCount: rebars.length,
            steelArea: section.totalRebarArea ?? 0,
            reinforcementRatio: section.FEMarea ? section.totalRebarArea / section.FEMarea : 0,
            centroidX: section.centroidX ?? 0,
            centroidY: section.centroidY ?? 0,
            rebarSizes: rebarSummary.sizes,
            rebarMaterials: rebarSummary.materials,
            edgeSpacing: Number(document.getElementById('edgeSpa')?.value),
            interiorSpacing: Number(document.getElementById('intSpa')?.value)
        }
    };
}

function buildSummarySheet(model) {
    const p = model.parameters;
    const project = model.project ?? {};
    const nominalCount = model.mmRows.filter(row => Number.isFinite(row.nominalMx)).length;
    const phiCount = model.mmRows.filter(row => Number.isFinite(row.phiMx)).length;
    const rows = [
        makeRow(1, [makeCell(1, 1, 'Concrete Section Analysis Export', 1, 'string')], 28),
        makeRow(2, [makeCell(2, 1, 'Project name', 3, 'string'), makeCell(2, 2, project.name || 'Untitled project', 9, 'string')]),
        makeRow(3, [makeCell(3, 1, 'Description', 3, 'string'), makeCell(3, 2, project.description || '', 9, 'string')], 36),
        makeRow(4, [makeCell(4, 1, 'Notes', 3, 'string'), makeCell(4, 2, project.notes || '', 9, 'string')], 54),
        makeRow(5, [
            makeCell(5, 1, 'Generated', 3, 'string'),
            makeCell(5, 2, model.generated.toLocaleString(), 0, 'string')
        ]),
        makeRow(7, [
            makeCell(7, 1, 'Section Parameters', 2, 'string'),
            makeCell(7, 4, 'Section Image', 2, 'string')
        ], 22),
        makeRow(8, [makeCell(8, 1, 'Concrete material', 3, 'string'), makeCell(8, 2, p.concreteMaterial, 0, 'string')]),
        makeRow(9, [makeCell(9, 1, 'Overall width (in)', 3, 'string'), makeCell(9, 2, p.width, 4)]),
        makeRow(10, [makeCell(10, 1, 'Overall height (in)', 3, 'string'), makeCell(10, 2, p.height, 4)]),
        makeRow(11, [makeCell(11, 1, 'Concrete area (in²)', 3, 'string'), makeCell(11, 2, p.concreteArea, 4)]),
        makeRow(12, [makeCell(12, 1, 'Total number of rebar', 3, 'string'), makeCell(12, 2, p.rebarCount, 7)]),
        makeRow(13, [makeCell(13, 1, 'Total steel area (in²)', 3, 'string'), makeCell(13, 2, p.steelArea, 4)]),
        makeRow(14, [
            makeCell(14, 1, 'Reinforcement ratio', 3, 'string'),
            makeCell(14, 2, { formula: 'B13/B11', result: p.reinforcementRatio }, 8, 'formula')
        ]),
        makeRow(15, [makeCell(15, 1, 'Centroid X (in)', 3, 'string'), makeCell(15, 2, p.centroidX, 4)]),
        makeRow(16, [makeCell(16, 1, 'Centroid Y (in)', 3, 'string'), makeCell(16, 2, p.centroidY, 4)]),
        makeRow(17, [makeCell(17, 1, 'Rebar provided', 3, 'string'), makeCell(17, 2, p.rebarSizes, 0, 'string')]),
        makeRow(18, [makeCell(18, 1, 'Rebar material(s)', 3, 'string'), makeCell(18, 2, p.rebarMaterials, 0, 'string')]),
        makeRow(19, [makeCell(19, 1, 'Edge mesh spacing (in)', 3, 'string'), makeCell(19, 2, p.edgeSpacing, 4)]),
        makeRow(20, [makeCell(20, 1, 'Interior mesh spacing (in)', 3, 'string'), makeCell(20, 2, p.interiorSpacing, 4)]),
        makeRow(22, [makeCell(22, 1, 'Exported Analysis', 2, 'string')], 22),
        makeRow(23, [makeCell(23, 1, 'Selected NA angle (deg)', 3, 'string'), makeCell(23, 2, model.selectedAngle, 4)]),
        makeRow(24, [makeCell(24, 1, 'MM axial load (kips)', 3, 'string'), makeCell(24, 2, model.mm.axialLoad, 4)]),
        makeRow(25, [makeCell(25, 1, 'Nominal MM points', 3, 'string'), makeCell(25, 2, nominalCount, 7)]),
        makeRow(26, [makeCell(26, 1, 'φMM points', 3, 'string'), makeCell(26, 2, phiCount, 7)])
    ];

    return makeWorksheet({
        rows,
        columns: [29, 30, 3, 13, 13, 13, 13, 13, 13, 13, 13, 13],
        merges: ['A1:L1', 'B2:L2', 'B3:L3', 'B4:L4', 'A7:B7', 'D7:L7', 'A22:B22'],
        drawing: true
    });
}

function buildSelectedAngleSheet(model) {
    const headers = [
        'Profile', 'NA Angle (deg)', 'Strain Slope', 'Strain Intercept',
        'P (kips)', 'Mx (kip-ft)', 'My (kip-ft)', 'Max Rebar Strain',
        'φ', 'φP (kips)', 'φMx (kip-ft)', 'φMy (kip-ft)'
    ];
    const rows = [
        makeRow(1, [makeCell(1, 1, 'Selected Neutral-Axis PMM Results', 1, 'string')], 28),
        makeRow(2, [
            makeCell(2, 1, 'Neutral-axis angle (deg)', 3, 'string'),
            makeCell(2, 2, model.selectedAngle, 4)
        ]),
        makeRow(4, headers.map((header, index) => makeCell(4, index + 1, header, 5, 'string')), 28)
    ];

    model.selectedRows.forEach((item, index) => {
        const row = index + 5;
        const values = [
            item.index, item.angle, item.slope, item.intercept, item.p, item.mx,
            item.my, item.maxStrain, item.phi, item.phiP, item.phiMx, item.phiMy
        ];
        rows.push(makeRow(row, values.map((value, column) =>
            makeCell(row, column + 1, value, column === 0 ? 7 : 6)
        )));
    });

    const lastRow = Math.max(5, model.selectedRows.length + 4);
    return makeWorksheet({
        rows,
        columns: [24, 16, 16, 18, 15, 15, 15, 19, 10, 15, 15, 15],
        merges: ['A1:L1'],
        freezeRows: 4,
        autoFilter: `A4:L${lastRow}`
    });
}

function buildMomentMomentSheet(model) {
    const headers = [
        'Point', 'NA Angle (deg)', 'Nominal P (kips)', 'Nominal Mx (kip-ft)',
        'Nominal My (kip-ft)', 'Nominal Strain Slope', 'Nominal Strain Intercept',
        'φP (kips)', 'φMx (kip-ft)', 'φMy (kip-ft)', 'φ Strain Slope', 'φ Strain Intercept'
    ];
    const rows = [
        makeRow(1, [makeCell(1, 1, 'Moment-Moment Results', 1, 'string')], 28),
        makeRow(2, [
            makeCell(2, 1, 'Target axial load (kips)', 3, 'string'),
            makeCell(2, 2, model.mm.axialLoad, 4),
            makeCell(2, 4, 'Blank φ cells mean no reduced-strength solution exists.', 0, 'string')
        ]),
        makeRow(4, headers.map((header, index) => makeCell(4, index + 1, header, 5, 'string')), 32)
    ];

    model.mmRows.forEach((item, index) => {
        const row = index + 5;
        const values = [
            item.index, item.angle, item.nominalP, item.nominalMx, item.nominalMy,
            item.nominalSlope, item.nominalIntercept, item.phiP, item.phiMx,
            item.phiMy, item.phiSlope, item.phiIntercept
        ];
        rows.push(makeRow(row, values.map((value, column) =>
            makeCell(row, column + 1, value, column === 0 ? 7 : 6)
        )));
    });

    const lastRow = Math.max(5, model.mmRows.length + 4);
    return makeWorksheet({
        rows,
        columns: [24, 16, 18, 20, 20, 21, 23, 15, 17, 17, 18, 20],
        merges: ['A1:L1', 'D2:L2'],
        freezeRows: 4,
        autoFilter: `A4:L${lastRow}`
    });
}

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
        let crc = value;
        for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
        table[value] = crc >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
    view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
}

function concatenate(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
}

function createZip(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const date = new Date();
    const fileCount = files.size ?? files.length;
    const dosTime = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() / 2) & 0x1f);
    const dosDate = (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f);

    for (const [name, content] of files) {
        const nameBytes = encoder.encode(name);
        const bytes = typeof content === 'string' ? encoder.encode(content) : content;
        const crc = crc32(bytes);
        const localHeader = new Uint8Array(30);
        const localView = new DataView(localHeader.buffer);
        writeUint32(localView, 0, 0x04034b50);
        writeUint16(localView, 4, 20);
        writeUint16(localView, 6, 0x0800);
        writeUint16(localView, 8, 0);
        writeUint16(localView, 10, dosTime);
        writeUint16(localView, 12, dosDate);
        writeUint32(localView, 14, crc);
        writeUint32(localView, 18, bytes.length);
        writeUint32(localView, 22, bytes.length);
        writeUint16(localView, 26, nameBytes.length);
        localParts.push(localHeader, nameBytes, bytes);

        const centralHeader = new Uint8Array(46);
        const centralView = new DataView(centralHeader.buffer);
        writeUint32(centralView, 0, 0x02014b50);
        writeUint16(centralView, 4, 20);
        writeUint16(centralView, 6, 20);
        writeUint16(centralView, 8, 0x0800);
        writeUint16(centralView, 10, 0);
        writeUint16(centralView, 12, dosTime);
        writeUint16(centralView, 14, dosDate);
        writeUint32(centralView, 16, crc);
        writeUint32(centralView, 20, bytes.length);
        writeUint32(centralView, 24, bytes.length);
        writeUint16(centralView, 28, nameBytes.length);
        writeUint32(centralView, 42, localOffset);
        centralParts.push(centralHeader, nameBytes);
        localOffset += localHeader.length + nameBytes.length + bytes.length;
    }

    const localBytes = concatenate(localParts);
    const centralBytes = concatenate(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    writeUint32(endView, 0, 0x06054b50);
    writeUint16(endView, 8, fileCount);
    writeUint16(endView, 10, fileCount);
    writeUint32(endView, 12, centralBytes.length);
    writeUint32(endView, 16, localBytes.length);
    return concatenate([localBytes, centralBytes, end]);
}

export function buildAnalysisWorkbookBytes(model) {
    const files = new Map();
    files.set('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
</Types>`);
    files.set('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
    files.set('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="14000"/></bookViews>
  <sheets>
    <sheet name="Summary" sheetId="1" r:id="rId1"/>
    <sheet name="Selected NA Results" sheetId="2" r:id="rId2"/>
    <sheet name="MM Results" sheetId="3" r:id="rId3"/>
  </sheets>
  <calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1"/>
</workbook>`);
    files.set('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
    files.set('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="0.00000"/><numFmt numFmtId="166" formatCode="0.00%"/></numFmts>
  <fonts count="4">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FF243B53"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF102A43"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF1F5F9"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCBD5E1"/></left><right style="thin"><color rgb="FFCBD5E1"/></right><top style="thin"><color rgb="FFCBD5E1"/></top><bottom style="thin"><color rgb="FFCBD5E1"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`);
    files.set('xl/worksheets/sheet1.xml', buildSummarySheet(model));
    files.set('xl/worksheets/sheet2.xml', buildSelectedAngleSheet(model));
    files.set('xl/worksheets/sheet3.xml', buildMomentMomentSheet(model));
    files.set('xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
    files.set('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:oneCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>7</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="6858000" cy="4572000"/>
    <xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Concrete Section.png"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6858000" cy="4572000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`);
    files.set('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/section.png"/></Relationships>`);
    files.set('xl/media/section.png', base64ToBytes(model.imageDataUrl));
    return createZip(files);
}

function makeFilename(model) {
    const date = model.generated.toISOString().slice(0, 10);
    const angle = String(model.selectedAngle).replace('-', 'neg-').replace('.', 'p');
    const axial = model.mm.axialLoad.toFixed(2).replace('-', 'neg-').replace('.', 'p');
    return `concrete-analysis_${date}_NA-${angle}_P-${axial}.xlsx`;
}

/**
 * Build and download one workbook containing the section summary, the PMM
 * results for the selected neutral-axis angle, and the currently displayed MM
 * slice. The workbook is assembled client-side, so no project data is uploaded.
 */
export async function exportSectionAnalysisWorkbook(section) {
    const model = collectWorkbookModel(section);
    const bytes = buildAnalysisWorkbookBytes(model);
    const filename = makeFilename(model);
    const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
}
