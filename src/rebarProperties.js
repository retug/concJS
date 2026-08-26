// A dictionary that maps US reinforcing-bar size to nominal diameter in inches.
export const rebarDia = {
    3: 0.375,
    4: 0.5,
    5: 0.625,
    6: 0.75,
    7: 0.875,
    8: 1.0,
    9: 1.128,
    10: 1.27,
    11: 1.41,
    14: 1.693,
    18: 2.257
};

// Standard nominal areas for ASTM reinforcing bars in square inches.
export const rebarArea = {
    3: 0.11,
    4: 0.20,
    5: 0.31,
    6: 0.44,
    7: 0.60,
    8: 0.79,
    9: 1.00,
    10: 1.27,
    11: 1.56,
    14: 2.25,
    18: 4.00
};

export function getRebarDiameter(rebar) {
    const explicitDiameter = Number(rebar?.rebarDiameter);
    if (Number.isFinite(explicitDiameter) && explicitDiameter > 0) return explicitDiameter;
    return rebarDia[rebar?.rebarSize];
}

export function getRebarArea(rebar) {
    const explicitArea = Number(rebar?.rebarArea);
    if (Number.isFinite(explicitArea) && explicitArea > 0) return explicitArea;
    const nominalArea = rebarArea[rebar?.rebarSize];
    if (Number.isFinite(nominalArea) && nominalArea > 0) return nominalArea;
    const diameter = getRebarDiameter(rebar);
    return Number.isFinite(diameter) ? (Math.PI / 4) * diameter ** 2 : 0;
}

