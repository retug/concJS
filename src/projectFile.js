export const PROJECT_FORMAT = "concretejs-project";
export const PROJECT_SCHEMA_VERSION = 2;

export function createProjectDocument({
  metadata,
  materials,
  concreteShapes,
  reinforcement,
  analysisConfiguration,
  createdAt = new Date().toISOString()
}) {
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    createdAt,
    metadata: {
      name: metadata?.name ?? "",
      description: metadata?.description ?? "",
      notes: metadata?.notes ?? ""
    },
    units: {
      length: "in",
      stress: "psi",
      force: "kip",
      moment: "kip-ft"
    },
    materials,
    concreteShapes,
    reinforcement,
    analysisConfiguration: {
      edgeSpacing: analysisConfiguration.edgeSpacing,
      interiorSpacing: analysisConfiguration.interiorSpacing,
      momentMomentAxialLoad: analysisConfiguration.momentMomentAxialLoad
    }
  };
}

export function validateAndNormalizeProject(raw) {
  const errors = [];
  const warnings = [];

  if (!isRecord(raw)) {
    return result(null, ["The file must contain a JSON object."], warnings);
  }

  if (raw.format !== PROJECT_FORMAT) {
    errors.push(`format must be "${PROJECT_FORMAT}".`);
  }

  const schemaVersion = Number(raw.schemaVersion);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    errors.push("schemaVersion must be a positive integer.");
  }
  const isFutureVersion = Number.isInteger(schemaVersion) && schemaVersion > PROJECT_SCHEMA_VERSION;
  if (isFutureVersion) {
    warnings.push(
      `This file uses schema version ${schemaVersion}, but this app supports version ${PROJECT_SCHEMA_VERSION}. ` +
      "Recognized fields will be imported; saving again may discard unsupported data."
    );
  }

  if (!isRecord(raw.units) || raw.units.length !== "in") {
    errors.push('units.length must be "in". Unit conversion is not supported yet.');
  }

  const metadata = normalizeMetadata(raw.metadata, warnings);
  const materials = normalizeMaterials(raw.materials, errors, warnings, isFutureVersion);
  const materialsById = new Map(materials.map(material => [material.id, material]));
  const concreteShapes = normalizeConcreteShapes(
    raw.concreteShapes,
    materialsById,
    errors,
    warnings,
    isFutureVersion
  );
  const reinforcement = normalizeReinforcement(
    raw.reinforcement,
    new Set(materialsById.keys()),
    errors,
    warnings,
    isFutureVersion
  );
  const analysisConfiguration = normalizeAnalysisConfiguration(raw.analysisConfiguration, errors, warnings);

  const project = {
    format: PROJECT_FORMAT,
    schemaVersion: Number.isInteger(schemaVersion) ? schemaVersion : PROJECT_SCHEMA_VERSION,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    metadata,
    units: {
      length: "in",
      stress: "psi",
      force: "kip",
      moment: "kip-ft"
    },
    materials,
    concreteShapes,
    reinforcement,
    analysisConfiguration
  };

  return result(project, errors, warnings);
}

function normalizeMetadata(value, warnings) {
  if (value !== undefined && !isRecord(value)) {
    warnings.push("metadata was not an object and was replaced with blank project metadata.");
    value = {};
  }
  return {
    name: stringOrBlank(value?.name),
    description: stringOrBlank(value?.description),
    notes: stringOrBlank(value?.notes)
  };
}

function normalizeMaterials(value, errors, warnings, isFutureVersion) {
  if (!Array.isArray(value)) {
    errors.push("materials must be an array.");
    return [];
  }

  const seenIds = new Set();
  const seenNames = new Set();
  return value.flatMap((material, index) => {
    const path = `materials[${index}]`;
    if (!isRecord(material)) {
      errors.push(`${path} must be an object.`);
      return [];
    }

    const id = normalizeId(material.id, `material-${index + 1}`, `${path}.id`, errors, warnings, isFutureVersion);
    const name = stringOrBlank(material.name);
    const type = material.type;
    const strengthBasis = material.strengthBasis;
    const points = material.stressStrain;

    if (!name) errors.push(`${path}.name is required.`);
    if (!['concrete', 'steel', 'other'].includes(type)) {
      errors.push(`${path}.type must be concrete, steel, or other.`);
    }
    if (!['normal', 'expected'].includes(strengthBasis)) {
      errors.push(`${path}.strengthBasis must be normal or expected.`);
    }
    if (!Array.isArray(points) || points.length < 2) {
      errors.push(`${path}.stressStrain must contain at least two points.`);
      return [];
    }

    const stressStrain = points.flatMap((point, pointIndex) => {
      if (!isRecord(point) || !isFiniteNumber(point.strain) || !isFiniteNumber(point.stress)) {
        errors.push(`${path}.stressStrain[${pointIndex}] must contain finite strain and stress values.`);
        return [];
      }
      return [{ strain: Number(point.strain), stress: Number(point.stress) }];
    });
    for (let pointIndex = 1; pointIndex < stressStrain.length; pointIndex += 1) {
      if (stressStrain[pointIndex].strain < stressStrain[pointIndex - 1].strain) {
        errors.push(`${path}.stressStrain must be ordered from lowest to highest strain.`);
        break;
      }
    }

    if (seenIds.has(id)) errors.push(`${path}.id duplicates material id "${id}".`);
    if (seenNames.has(name)) errors.push(`${path}.name duplicates material name "${name}".`);
    seenIds.add(id);
    seenNames.add(name);

    return [{ id, name, type, strengthBasis, stressStrain }];
  });
}

function normalizeConcreteShapes(value, materialsById, errors, warnings, isFutureVersion) {
  if (!Array.isArray(value)) {
    errors.push("concreteShapes must be an array.");
    return [];
  }

  const seenIds = new Set();
  return value.flatMap((shape, index) => {
    const path = `concreteShapes[${index}]`;
    if (!isRecord(shape)) {
      errors.push(`${path} must be an object.`);
      return [];
    }
    const id = normalizeId(shape.id, `shape-${index + 1}`, `${path}.id`, errors, warnings, isFutureVersion);
    const materialId = stringOrBlank(shape.materialId);
    if (!materialsById.has(materialId)) errors.push(`${path}.materialId does not reference a saved material.`);
    const defaultPriority = materialsById.get(materialId)?.type === 'steel' ? 1 : 0;
    const priority = finiteNumber(shape.priority ?? defaultPriority, `${path}.priority`, errors) ?? defaultPriority;
    if (seenIds.has(id)) errors.push(`${path}.id duplicates shape id "${id}".`);
    seenIds.add(id);

    if (!isRecord(shape.geometry)) {
      errors.push(`${path}.geometry must be an object.`);
      return [];
    }
    const exterior = normalizeContour(shape.geometry.exterior, `${path}.geometry.exterior`, errors, warnings, isFutureVersion);
    const openingValues = shape.geometry.openings ?? [];
    if (!Array.isArray(openingValues)) {
      errors.push(`${path}.geometry.openings must be an array.`);
    }
    const openings = Array.isArray(openingValues)
      ? openingValues.map((opening, openingIndex) => normalizeContour(
          opening,
          `${path}.geometry.openings[${openingIndex}]`,
          errors,
          warnings,
          isFutureVersion
        )).filter(Boolean)
      : [];

    return exterior ? [{ id, materialId, priority, geometry: { exterior, openings } }] : [];
  });
}

function normalizeContour(value, path, errors, warnings, isFutureVersion) {
  if (!isRecord(value) || !Array.isArray(value.segments) || value.segments.length === 0) {
    errors.push(`${path}.segments must be a non-empty array.`);
    return null;
  }

  const segments = value.segments.flatMap((segment, index) => {
    const segmentPath = `${path}.segments[${index}]`;
    if (!isRecord(segment)) {
      errors.push(`${segmentPath} must be an object.`);
      return [];
    }
    if (segment.type === "line") {
      const from = normalizePoint(segment.from, `${segmentPath}.from`, errors);
      const to = normalizePoint(segment.to, `${segmentPath}.to`, errors);
      return from && to ? [{ type: "line", from, to }] : [];
    }
    if (segment.type === "ellipse") {
      const center = normalizePoint(segment.center, `${segmentPath}.center`, errors);
      const radiusX = positiveNumber(segment.radiusX, `${segmentPath}.radiusX`, errors);
      const radiusY = positiveNumber(segment.radiusY, `${segmentPath}.radiusY`, errors);
      const startAngle = finiteNumber(segment.startAngle, `${segmentPath}.startAngle`, errors);
      const endAngle = finiteNumber(segment.endAngle, `${segmentPath}.endAngle`, errors);
      const rotation = finiteNumber(segment.rotation ?? 0, `${segmentPath}.rotation`, errors);
      if (!center || radiusX === null || radiusY === null || startAngle === null || endAngle === null || rotation === null) {
        return [];
      }
      return [{
        type: "ellipse",
        center,
        radiusX,
        radiusY,
        startAngle,
        endAngle,
        clockwise: Boolean(segment.clockwise),
        rotation
      }];
    }

    const message = `${segmentPath}.type "${stringOrBlank(segment.type)}" is not supported.`;
    if (isFutureVersion) warnings.push(`${message} The segment was skipped.`);
    else errors.push(message);
    return [];
  });

  if (segments.length === 0) {
    errors.push(`${path} does not contain any supported geometry segments.`);
    return null;
  }
  return { segments };
}

function normalizeReinforcement(value, materialIds, errors, warnings, isFutureVersion) {
  if (!Array.isArray(value)) {
    errors.push("reinforcement must be an array.");
    return [];
  }

  const seenIds = new Set();
  return value.flatMap((bar, index) => {
    const path = `reinforcement[${index}]`;
    if (!isRecord(bar) || !isRecord(bar.size)) {
      errors.push(`${path} and ${path}.size must be objects.`);
      return [];
    }
    const id = normalizeId(bar.id, `rebar-${index + 1}`, `${path}.id`, errors, warnings, isFutureVersion);
    const x = finiteNumber(bar.x, `${path}.x`, errors);
    const y = finiteNumber(bar.y, `${path}.y`, errors);
    const materialId = stringOrBlank(bar.materialId);
    const designation = stringOrBlank(bar.size.designation);
    const barNumber = finiteNumber(bar.size.barNumber, `${path}.size.barNumber`, errors);
    const diameter = positiveNumber(bar.size.diameter, `${path}.size.diameter`, errors);
    const area = positiveNumber(bar.size.area, `${path}.size.area`, errors);
    if (!designation) errors.push(`${path}.size.designation is required.`);
    if (!materialIds.has(materialId)) errors.push(`${path}.materialId does not reference a saved material.`);
    if (seenIds.has(id)) errors.push(`${path}.id duplicates reinforcement id "${id}".`);
    seenIds.add(id);
    if ([x, y, barNumber, diameter, area].some(item => item === null)) return [];
    return [{ id, x, y, materialId, size: { designation, barNumber, diameter, area } }];
  });
}

function normalizeAnalysisConfiguration(value, errors, warnings) {
  if (!isRecord(value)) {
    warnings.push("analysisConfiguration was missing; default analysis inputs were used.");
    value = {};
  }
  return {
    edgeSpacing: positiveNumber(value.edgeSpacing ?? 1, "analysisConfiguration.edgeSpacing", errors) ?? 1,
    interiorSpacing: positiveNumber(value.interiorSpacing ?? 1, "analysisConfiguration.interiorSpacing", errors) ?? 1,
    momentMomentAxialLoad: finiteNumber(
      value.momentMomentAxialLoad ?? 0,
      "analysisConfiguration.momentMomentAxialLoad",
      errors
    ) ?? 0
  };
}

function normalizeId(value, fallback, path, errors, warnings, isFutureVersion) {
  const id = stringOrBlank(value);
  if (id) return id;
  if (isFutureVersion) {
    warnings.push(`${path} was missing; generated "${fallback}" for best-effort import.`);
    return fallback;
  }
  errors.push(`${path} is required.`);
  return fallback;
}

function normalizePoint(value, path, errors) {
  if (!isRecord(value) || !isFiniteNumber(value.x) || !isFiniteNumber(value.y)) {
    errors.push(`${path} must contain finite x and y values.`);
    return null;
  }
  return { x: Number(value.x), y: Number(value.y) };
}

function positiveNumber(value, path, errors) {
  const number = finiteNumber(value, path, errors);
  if (number !== null && number <= 0) {
    errors.push(`${path} must be greater than zero.`);
    return null;
  }
  return number;
}

function finiteNumber(value, path, errors) {
  if (!isFiniteNumber(value)) {
    errors.push(`${path} must be a finite number.`);
    return null;
  }
  return Number(value);
}

function isFiniteNumber(value) {
  return value !== "" && Number.isFinite(Number(value));
}

function stringOrBlank(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function result(project, errors, warnings) {
  return { project, errors, warnings, canImport: errors.length === 0 };
}

