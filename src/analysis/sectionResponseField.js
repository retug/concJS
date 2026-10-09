const RESPONSE_COLORS = {
  negative: [29, 78, 216],
  neutral: [226, 232, 240],
  positive: [185, 28, 28]
};

export function transformedVAtPoint(x, y, centroidX, centroidY, angle) {
  const radians = Number(angle) * Math.PI / 180;
  return -Math.sin(radians) * (x - centroidX)
    + Math.cos(radians) * (y - centroidY);
}

export function linearStrainAtPoint(x, y, centroidX, centroidY, angle, strainProfile) {
  const v = transformedVAtPoint(x, y, centroidX, centroidY, angle);
  return Number(strainProfile?.[0] ?? 0) * v + Number(strainProfile?.[1] ?? 0);
}

function interpolateColor(left, right, ratio) {
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  return left.map((component, index) => (
    Math.round(component + (right[index] - component) * boundedRatio)
  ));
}

export function responseColor(value, min, max) {
  if (!Number.isFinite(value) || value === 0) {
    return [...RESPONSE_COLORS.neutral];
  }

  const finiteMin = Number.isFinite(min) ? min : 0;
  const finiteMax = Number.isFinite(max) ? max : finiteMin;
  const isCompression = value < 0;
  // Zero is always neutral, even when the displayed field is entirely one sign
  // or uniform (including the pure-compression strain profile).
  const magnitude = isCompression
    ? Math.max(0, -finiteMin, -finiteMax)
    : Math.max(0, finiteMin, finiteMax);
  return interpolateColor(
    RESPONSE_COLORS.neutral,
    isCompression ? RESPONSE_COLORS.negative : RESPONSE_COLORS.positive,
    magnitude > 0 ? Math.abs(value) / magnitude : 1
  );
}

export function responseColorCSS(value, min, max) {
  const [red, green, blue] = responseColor(value, min, max);
  return `rgb(${red}, ${green}, ${blue})`;
}

export function responseGradientCSS(min, max) {
  if (min < 0 && max > 0) {
    const zeroPosition = Math.max(0, Math.min(100, (-min / (max - min)) * 100));
    return `linear-gradient(to right, ${responseColorCSS(min, min, max)} 0%, `
      + `${responseColorCSS(0, min, max)} ${zeroPosition}%, `
      + `${responseColorCSS(max, min, max)} 100%)`;
  }
  return `linear-gradient(to right, ${responseColorCSS(min, min, max)}, `
    + `${responseColorCSS((min + max) / 2, min, max)}, `
    + `${responseColorCSS(max, min, max)})`;
}
