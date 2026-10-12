/** Read the two equivalent moment naming conventions used by saved demand data
 * (M2/M3) and section response data (Mx/My). Plotting must preserve both. */
export function momentX(value) {
  for (const candidate of [value?.Mx, value?.M2, value?.phiMx, value?.phiM2]) {
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

export function momentY(value) {
  for (const candidate of [value?.My, value?.M3, value?.phiMy, value?.phiM3]) {
    if (Number.isFinite(candidate)) return candidate;
  }
  return null;
}

export function momentArray(data, axis) {
  const design = axis.startsWith('phi');
  const primary = axis.endsWith('Mx') ? data?.[design ? 'phiMx' : 'Mx'] : data?.[design ? 'phiMy' : 'My'];
  const fallback = axis.endsWith('Mx') ? data?.[design ? 'phiM2' : 'M2'] : data?.[design ? 'phiM3' : 'M3'];
  const values = Array.isArray(primary) && primary.length ? primary : fallback;
  return Array.isArray(values) ? values.flat() : null;
}
