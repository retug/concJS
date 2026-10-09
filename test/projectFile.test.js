import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_SCHEMA_VERSION,
  createProjectDocument,
  validateAndNormalizeProject
} from '../src/projectFile.js';

function makeProject() {
  return createProjectDocument({
    metadata: {
      name: 'Bridge Pier P-2',
      description: 'Two-cell pier section',
      notes: 'Use expected material strengths for assessment.'
    },
    materials: [
      {
        id: 'material-1',
        name: 'fc5ksi',
        type: 'concrete',
        strengthBasis: 'normal',
        compressiveStrengthACI: 5000,
        stressStrain: [
          { strain: -0.003, stress: -5000 },
          { strain: 0, stress: 0 }
        ]
      },
      {
        id: 'material-2',
        name: 'fy60ksi',
        type: 'steel',
        strengthBasis: 'normal',
        stressStrain: [
          { strain: -0.00207, stress: -60000 },
          { strain: 0.00207, stress: 60000 }
        ]
      }
    ],
    concreteShapes: [
      {
        id: 'shape-1',
        materialId: 'material-1',
        priority: 4,
        geometry: {
          exterior: {
            segments: [
              { type: 'line', from: { x: 0, y: 0 }, to: { x: 24, y: 0 } },
              { type: 'line', from: { x: 24, y: 0 }, to: { x: 24, y: 24 } },
              { type: 'line', from: { x: 24, y: 24 }, to: { x: 0, y: 24 } },
              { type: 'line', from: { x: 0, y: 24 }, to: { x: 0, y: 0 } }
            ]
          },
          openings: [
            {
              segments: [
                {
                  type: 'ellipse',
                  center: { x: 12, y: 12 },
                  radiusX: 3,
                  radiusY: 3,
                  startAngle: 0,
                  endAngle: Math.PI * 2,
                  clockwise: false,
                  rotation: 0
                }
              ]
            }
          ]
        }
      }
    ],
    reinforcement: [
      {
        id: 'rebar-1',
        x: 3,
        y: 3,
        materialId: 'material-2',
        size: {
          designation: '#8',
          barNumber: 8,
          diameter: 1,
          area: Math.PI / 4
        }
      }
    ],
    analysisConfiguration: {
      edgeSpacing: 0.75,
      interiorSpacing: 1.5,
      momentMomentAxialLoad: -250
    },
    createdAt: '2026-08-16T12:00:00.000Z'
  });
}

test('valid project round-trips all input groups', () => {
  const source = makeProject();
  const validation = validateAndNormalizeProject(JSON.parse(JSON.stringify(source)));

  assert.equal(validation.canImport, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.project.metadata.name, 'Bridge Pier P-2');
  assert.equal(validation.project.materials[0].compressiveStrengthACI, 5000);
  assert.equal(validation.project.concreteShapes[0].geometry.openings.length, 1);
  assert.equal(validation.project.concreteShapes[0].priority, 4);
  assert.equal(validation.project.reinforcement[0].size.diameter, 1);
  assert.equal(validation.project.reinforcement[0].size.area, Math.PI / 4);
  assert.equal(validation.project.analysisConfiguration.momentMomentAxialLoad, -250);
  assert.equal('results' in validation.project, false);
});

test('concrete materials require compressiveStrengthACI', () => {
  const source = makeProject();
  delete source.materials[0].compressiveStrengthACI;

  const validation = validateAndNormalizeProject(source);

  assert.equal(validation.canImport, false);
  assert.match(validation.errors.join(' '), /compressiveStrengthACI must be a positive number/i);
});

test('version 1 shapes migrate to material-based priorities', () => {
  const source = makeProject();
  source.schemaVersion = 1;
  delete source.concreteShapes[0].priority;
  source.concreteShapes.push({
    ...structuredClone(source.concreteShapes[0]),
    id: 'shape-2',
    materialId: 'material-2'
  });

  const validation = validateAndNormalizeProject(source);

  assert.equal(validation.canImport, true);
  assert.deepEqual(validation.project.concreteShapes.map(shape => shape.priority), [0, 1]);
});

test('newer schema versions import recognized fields with a prominent data-loss warning', () => {
  const source = makeProject();
  source.schemaVersion = PROJECT_SCHEMA_VERSION + 3;
  source.futureSolver = { proprietarySetting: true };

  const validation = validateAndNormalizeProject(source);

  assert.equal(validation.canImport, true);
  assert.match(validation.warnings.join(' '), /saving again may discard unsupported data/i);
  assert.equal('futureSolver' in validation.project, false);
});

test('invalid material references block replacement', () => {
  const source = makeProject();
  source.reinforcement[0].materialId = 'missing-material';

  const validation = validateAndNormalizeProject(source);

  assert.equal(validation.canImport, false);
  assert.match(validation.errors.join(' '), /does not reference a saved material/i);
});

test('unsupported length units block import instead of silently changing geometry', () => {
  const source = makeProject();
  source.units.length = 'mm';

  const validation = validateAndNormalizeProject(source);

  assert.equal(validation.canImport, false);
  assert.match(validation.errors.join(' '), /unit conversion is not supported/i);
});

test('demand inputs round-trip with signed and zero values without calculated results', () => {
  const source = makeProject();
  const demandCases = [
    { id: 'd1', name: 'Compression', P: -300, M2: 0, M3: 42.5, dcr: 0.75 },
    { id: 'd2', name: 'Tension', P: 80, M2: -12, M3: 0, capacity: { P: 200 } }
  ];
  source.analysisConfiguration.demandCases = demandCases;
  const saved = createProjectDocument(source);
  demandCases[0].P = -999;
  assert.equal(saved.analysisConfiguration.demandCases[0].P, -300);
  const validation = validateAndNormalizeProject(JSON.parse(JSON.stringify(saved)));
  assert.equal(validation.canImport, true);
  assert.deepEqual(validation.project.analysisConfiguration.demandCases, [
    { id: 'd1', name: 'Compression', P: -300, M2: 0, M3: 42.5 },
    { id: 'd2', name: 'Tension', P: 80, M2: -12, M3: 0 }
  ]);
  saved.analysisConfiguration.demandCases[0].M3 = -100;
  assert.equal(validation.project.analysisConfiguration.demandCases[0].M3, 42.5);
});

test('existing projects without demand cases import with an empty list', () => {
  for (const version of [1, 2, 3]) {
    const source = makeProject();
    source.schemaVersion = version;
    delete source.analysisConfiguration.demandCases;
    delete source.analysisConfiguration.dcrMethod;
    const validation = validateAndNormalizeProject(source);
    assert.equal(validation.canImport, true);
    assert.deepEqual(validation.project.analysisConfiguration.demandCases, []);
    assert.equal(validation.project.analysisConfiguration.dcrMethod, 'constant-p');
  }
});

test('both demand check methods round-trip with all analysis inputs', () => {
  for (const dcrMethod of ['constant-p', 'origin']) {
    const source = makeProject();
    source.analysisConfiguration.dcrMethod = dcrMethod;
    source.analysisConfiguration.demandCases = [{ id: 'd1', name: 'Demand', P: -300, M2: 0, M3: -20 }];
    const saved = createProjectDocument(source);
    const validation = validateAndNormalizeProject(JSON.parse(JSON.stringify(saved)));
    assert.equal(validation.canImport, true);
    assert.deepEqual(validation.project.analysisConfiguration, source.analysisConfiguration);
  }
});

test('missing demand check method defaults at save and import while invalid settings are rejected', () => {
  const legacy = makeProject();
  delete legacy.analysisConfiguration.dcrMethod;
  assert.equal(createProjectDocument(legacy).analysisConfiguration.dcrMethod, 'constant-p');
  assert.equal(validateAndNormalizeProject(legacy).project.analysisConfiguration.dcrMethod, 'constant-p');
  for (const dcrMethod of ['', 'Origin', 'constant-P', null, false, 0, {}]) {
    const source = makeProject();
    source.analysisConfiguration.dcrMethod = dcrMethod;
    const validation = validateAndNormalizeProject(source);
    assert.equal(validation.canImport, false);
    assert.match(validation.errors.join(' '), /analysisConfiguration\.dcrMethod must be/);
    assert.throws(() => createProjectDocument(source), /dcrMethod must be/);
  }
});

test('malformed demand values and ambiguous identifiers prevent project replacement', () => {
  const valid = { id: 'd1', name: 'Case 1', P: -200, M2: 10, M3: 0 };
  const invalidCases = [
    [null],
    [{ ...valid, id: ' ' }],
    [valid, { ...valid, id: ' d1 ' }],
    [{ ...valid, name: '' }],
    [{ ...valid, name: 'x'.repeat(121) }],
    [{ ...valid, name: 'Case\n1' }],
    [{ ...valid, P: null }],
    [{ ...valid, M2: '10' }],
    [{ ...valid, M2: NaN }],
    [{ ...valid, M3: Infinity }],
    [{ ...valid, P: false }],
    {}
  ];
  for (const demandCases of invalidCases) {
    const source = makeProject();
    source.analysisConfiguration.demandCases = demandCases;
    const validation = validateAndNormalizeProject(source);
    assert.equal(validation.canImport, false);
    assert.match(validation.errors.join(' '), /analysisConfiguration\.demandCases/);
  }
});

test('demand files reject unsupported force and moment units', () => {
  for (const [unit, value] of [['force', 'kN'], ['moment', 'kip-in']]) {
    const source = makeProject();
    source.analysisConfiguration.demandCases = [{ id: 'd1', name: 'Demand', P: -10, M2: 1, M3: 0 }];
    source.units[unit] = value;
    const validation = validateAndNormalizeProject(source);
    assert.equal(validation.canImport, false);
    assert.match(validation.errors.join(' '), /Unit conversion is not supported/);
  }
});
