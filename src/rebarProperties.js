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

export function getRebarDiameter(rebar) {
    const explicitDiameter = Number(rebar?.rebarDiameter);
    if (Number.isFinite(explicitDiameter) && explicitDiameter > 0) return explicitDiameter;
    return rebarDia[rebar?.rebarSize];
}

export function getRebarArea(rebar) {
    const explicitArea = Number(rebar?.rebarArea);
    if (Number.isFinite(explicitArea) && explicitArea > 0) return explicitArea;
    const diameter = getRebarDiameter(rebar);
    return Number.isFinite(diameter) ? (Math.PI / 4) * diameter ** 2 : 0;
}

