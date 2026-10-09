// Saved demand inputs use kip and kip-ft about the section centroid.
// Axial force follows the analysis convention: negative is compression.
export const DEFAULT_DCR_METHOD = 'constant-p';
export const DCR_METHODS = Object.freeze(['constant-p', 'origin']);

export function normalizeDcrMethod(value = DEFAULT_DCR_METHOD, errors = []) {
  if (!DCR_METHODS.includes(value)) {
    errors.push('analysisConfiguration.dcrMethod must be "constant-p" or "origin".');
    return DEFAULT_DCR_METHOD;
  }
  return value;
}

export function copyDcrMethod(value) {
  const errors = [];
  const method = normalizeDcrMethod(value, errors);
  if (errors.length) throw new TypeError(errors.join(' '));
  return method;
}

export function normalizeDemandCases(value = [], errors = []) {
  const path = 'analysisConfiguration.demandCases';
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return [];
  }

  const seenIds = new Set();
  return value.flatMap((demand, index) => {
    const rowPath = `${path}[${index}]`;
    if (!demand || typeof demand !== 'object' || Array.isArray(demand)) {
      errors.push(`${rowPath} must be an object.`);
      return [];
    }
    const id = typeof demand.id === 'string' ? demand.id.trim() : '';
    const name = typeof demand.name === 'string' ? demand.name.trim() : '';
    if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/.test(id)) {
      errors.push(`${rowPath}.id must contain 1 to 128 characters without control characters.`);
    }
    if (seenIds.has(id)) errors.push(`${rowPath}.id duplicates demand id "${id}".`);
    seenIds.add(id);
    if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name)) {
      errors.push(`${rowPath}.name must contain 1 to 120 characters without control characters.`);
    }
    for (const key of ['P', 'M2', 'M3']) {
      if (typeof demand[key] !== 'number' || !Number.isFinite(demand[key])) {
        errors.push(`${rowPath}.${key} must be a finite number.`);
      }
    }
    // Explicitly copy only inputs; cached DCRs and capacity results are transient.
    return [{ id, name, P: demand.P, M2: demand.M2, M3: demand.M3 }];
  });
}

export function copyDemandCases(value) {
  const errors = [];
  const cases = normalizeDemandCases(value, errors);
  if (errors.length) throw new TypeError(errors.join(' '));
  return cases;
}
