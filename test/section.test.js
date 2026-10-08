import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSection,
  SectionValidationError,
  concreteStress,
  steelStress,
  evaluateUniformSection,
} from '../src/section.js';

const baseInput = {
  bxCm: 9,
  byCm: 30,
  fckMpa: 30,
  fykMpa: 500,
  gammaC: 1.4,
  gammaS: 1.15,
  esGPa: 200,
  coverCm: 2.5,
  barDiameterMm: 10,
  barsX: 2,
  barsY: 3,
  nKn: 100,
  mxKnm: 0,
  myKnm: 0,
  points: 36,
  mesh: 24,
};

function close(actual, expected, relativeTolerance = 1e-7, absoluteTolerance = 1e-7) {
  assert.ok(Number.isFinite(actual), `Expected a finite value; received ${actual}`);
  const tolerance = Math.max(absoluteTolerance, relativeTolerance * Math.abs(expected));
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `Expected ${actual} to approximate ${expected} within ${tolerance}`,
  );
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function atAngle(result, angle) {
  const point = result.interaction.points.reduce((best, candidate) => (
    angleDistance(candidate.angleRad, angle) < angleDistance(best.angleRad, angle)
      ? candidate : best
  ));
  assert.ok(angleDistance(point.angleRad, angle) < 1e-8, `No contour point at angle ${angle}`);
  return point;
}

function assertValidation(input, field) {
  assert.throws(
    () => analyzeSection(input),
    (error) => error instanceof SectionValidationError
      && Array.isArray(error.issues)
      && error.issues.length > 0
      && (!field || error.issues.some((issue) => issue.field === field)),
    field ? `${field} must be rejected` : 'Invalid section must be rejected',
  );
}

test('concrete parabola and plateau and signed steel yield obey the material laws', () => {
  const peak = 0.85 * 30 / 1.4;
  close(concreteStress(-0.001, peak), 0);
  close(concreteStress(0, peak), 0);
  close(concreteStress(0.0005, peak), peak * 0.4375);
  close(concreteStress(0.001, peak), peak * 0.75);
  close(concreteStress(0.002, peak), peak);
  close(concreteStress(0.0035, peak), peak);

  const fyd = 500 / 1.15;
  close(steelStress(0, 200_000, fyd), 0);
  close(steelStress(0.001, 200_000, fyd), 200);
  close(steelStress(-0.001, 200_000, fyd), -200);
  close(steelStress(0.01, 200_000, fyd), fyd);
  close(steelStress(-0.01, 200_000, fyd), -fyd);
});

test('9 × 30 cm layout places six bars on the perimeter with face-to-center cover', () => {
  const result = analyzeSection(baseInput);
  const reinforcement = result.reinforcement;
  const barArea = Math.PI / 4; // Ø10 mm = Ø1 cm.
  assert.equal(reinforcement.count, 6);
  assert.equal(reinforcement.bars.length, 6);
  close(reinforcement.areaCm2, 6 * barArea);
  close(reinforcement.ratioPercent, 100 * 6 * barArea / 270);
  for (const bar of reinforcement.bars) {
    assert.ok([-2, 2].includes(bar.xCm));
    assert.ok([-12.5, 0, 12.5].includes(bar.yCm));
    close(bar.areaCm2, barArea);
  }
  assert.equal(new Set(reinforcement.bars.map((bar) => `${bar.xCm},${bar.yCm}`)).size, 6);
  close(result.materials.fcdMpa, 30 / 1.4);
  close(result.materials.concretePeakMpa, 0.85 * 30 / 1.4);
  close(result.materials.fydMpa, 500 / 1.15);
  close(result.materials.esMpa, 200_000);
  close(result.materials.epsilonC2, 0.002);
  close(result.materials.epsilonCu, 0.0035);
  close(result.materials.epsilonSu, 0.01);
});

test('uniform strain matches analytic net-concrete and steel forces without a mesh', () => {
  const areaSteel = 6 * Math.PI / 4;
  const areaConcrete = 9 * 30 - areaSteel;
  const peak = 0.85 * 30 / 1.4;
  const fyd = 500 / 1.15;
  const cases = [
    [0, 0],
    [0.001, 0.1 * (areaConcrete * peak * 0.75 + areaSteel * 200)],
    [0.002, 0.1 * (areaConcrete * peak + areaSteel * 400)],
    [0.0035, 0.1 * (areaConcrete * peak + areaSteel * fyd)],
    [-0.001, -0.1 * areaSteel * 200],
    [-0.01, -0.1 * areaSteel * fyd],
  ];
  for (const [epsilon, expectedKn] of cases) {
    const force = evaluateUniformSection(baseInput, epsilon);
    close(force.nKn, expectedKn);
    close(force.mxKnm, 0);
    close(force.myKnm, 0);
  }
  const result = analyzeSection(baseInput);
  // Uniform compression reaches its section-domain limit at epsilonC2.
  // The 3.5‰ helper result tests the material plateau, not the axial limit.
  close(result.axial.maxCompressionKn, cases[2][1]);
  close(result.axial.minCompressionKn, cases[5][1]);
});

test('fixed-N contour reaches axial equilibrium in every direction', () => {
  for (const nKn of [0, 100, 350]) {
    const result = analyzeSection({ ...baseInput, nKn });
    assert.equal(result.interaction.status, 'ok');
    assert.equal(result.interaction.points.length, 36);
    close(result.interaction.nKn, nKn);
    for (const point of result.interaction.points) {
      assert.ok(Number.isFinite(point.mxKnm));
      assert.ok(Number.isFinite(point.myKnm));
      assert.ok(Number.isFinite(point.neutralAxisCm));
      assert.ok(Number.isFinite(point.angleRad));
      assert.ok(Math.abs(point.residualKn) < 0.001, `Axial residual ${point.residualKn} kN`);
    }
  }
});

test('biaxial capacity has independent reflections and opposite-quadrant symmetry', () => {
  const result = analyzeSection(baseInput);
  for (const point of result.interaction.points) {
    const opposite = atAngle(result, point.angleRad + Math.PI);
    const reflectX = atAngle(result, Math.PI - point.angleRad);
    const reflectY = atAngle(result, -point.angleRad);
    close(opposite.mxKnm, -point.mxKnm, 2e-6, 2e-6);
    close(opposite.myKnm, -point.myKnm, 2e-6, 2e-6);
    close(reflectX.mxKnm, point.mxKnm, 2e-6, 2e-6);
    close(reflectX.myKnm, -point.myKnm, 2e-6, 2e-6);
    close(reflectY.mxKnm, -point.mxKnm, 2e-6, 2e-6);
    close(reflectY.myKnm, point.myKnm, 2e-6, 2e-6);
  }
  // Normal along x causes bending about y; normal along y causes bending about x.
  const xNormal = atAngle(result, 0);
  const yNormal = atAngle(result, Math.PI / 2);
  close(xNormal.mxKnm, 0, 0, 2e-6);
  close(yNormal.myKnm, 0, 0, 2e-6);
  assert.ok(xNormal.myKnm > 0);
  assert.ok(yNormal.mxKnm > xNormal.myKnm);
});

test('a 90-degree rotation swaps section axes and reinforcement with the correct signs', () => {
  const originalInput = {
    ...baseInput, bxCm: 18, byCm: 36, coverCm: 3,
    barDiameterMm: 12, barsX: 3, barsY: 5, nKn: 500,
  };
  const original = analyzeSection(originalInput);
  const rotated = analyzeSection({ ...originalInput, bxCm: 36, byCm: 18, barsX: 5, barsY: 3 });
  close(rotated.axial.maxCompressionKn, original.axial.maxCompressionKn);
  close(rotated.reinforcement.areaCm2, original.reinforcement.areaCm2);
  for (const point of original.interaction.points) {
    const counterpart = atAngle(rotated, point.angleRad + Math.PI / 2);
    close(counterpart.mxKnm, point.myKnm, 2e-6, 2e-6);
    close(counterpart.myKnm, -point.mxKnm, 2e-6, 2e-6);
  }
});

test('a square section with the same reinforcement on both axes has equal directional capacities', () => {
  const result = analyzeSection({
    ...baseInput, bxCm: 30, byCm: 30, barsX: 3, barsY: 3,
    coverCm: 3, barDiameterMm: 12, nKn: 500,
  });
  for (const point of result.interaction.points) {
    const counterpart = atAngle(result, Math.PI / 2 - point.angleRad);
    close(counterpart.mxKnm, point.myKnm, 2e-6, 2e-6);
    close(counterpart.myKnm, point.mxKnm, 2e-6, 2e-6);
  }
});

test('material strength and steel area affect capacity consistently with the 2‰ compression limit', () => {
  const original = analyzeSection(baseInput);
  const strongerConcrete = analyzeSection({ ...baseInput, fckMpa: 40 });
  const strongerSteel = analyzeSection({ ...baseInput, fykMpa: 600 });
  const weakerSteel = analyzeSection({ ...baseInput, fykMpa: 300 });
  const moreSteel = analyzeSection({ ...baseInput, barDiameterMm: 12 });
  for (const result of [strongerConcrete, moreSteel]) {
    assert.ok(result.axial.maxCompressionKn > original.axial.maxCompressionKn);
  }
  assert.ok(original.axial.maxCompressionKn > weakerSteel.axial.maxCompressionKn);
  // At 2‰, Es*epsilon = 400 MPa: both fyk500 and fyk600 remain elastic.
  close(strongerSteel.axial.maxCompressionKn, original.axial.maxCompressionKn);
  assert.ok(moreSteel.reinforcement.areaCm2 > original.reinforcement.areaCm2);
  assert.ok(atAngle(moreSteel, 0).myKnm > atAngle(original, 0).myKnm);
  assert.ok(atAngle(strongerSteel, Math.PI / 2).mxKnm > atAngle(original, Math.PI / 2).mxKnm);
});

test('uniaxial bending agrees with an independent exact concrete integral and equilibrium root', () => {
  const input = {
    ...baseInput, bxCm: 30, byCm: 50, coverCm: 10,
    barDiameterMm: 32, barsX: 2, barsY: 2, nKn: 0,
  };
  const peak = 0.85 * 30 / 1.4;
  const fyd = 500 / 1.15;
  const barArea = Math.PI * 3.2 ** 2 / 4;
  const q = 0.002 / 0.0035;

  // In this example top bars remain elastic, bottom bars yield in tension,
  // and concrete reaches 3.5‰. Integrate the plateau and parabola exactly.
  function analytic(c) {
    const topBarStrain = 0.0035 * (1 - 10 / c);
    const ratio = topBarStrain / 0.002;
    const concreteAtTopBars = peak * (2 * ratio - ratio ** 2);
    const topBarNetStress = 200_000 * topBarStrain - concreteAtTopBars;
    const concreteForce = peak * 30 * c * (1 - q / 3); // MPa·cm².
    const centroidDepth = c * (0.5 - q / 3 + q ** 2 / 12) / (1 - q / 3);
    const nKn = 0.1 * (concreteForce + 2 * barArea * (topBarNetStress - fyd));
    const mxKnm = 0.001 * (
      concreteForce * (25 - centroidDepth)
      + 2 * barArea * topBarNetStress * 15
      + 2 * barArea * fyd * 15
    );
    return { nKn, mxKnm };
  }

  let low = 11;
  let high = 13;
  assert.ok(analytic(low).nKn < 0);
  assert.ok(analytic(high).nKn > 0);
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const c = (low + high) / 2;
    if (analytic(c).nKn < 0) low = c;
    else high = c;
  }
  const exactC = (low + high) / 2;
  const reference = analytic(exactC);
  close(reference.nKn, 0, 0, 1e-10);
  for (const [mesh, tolerance] of [[36, 0.01], [72, 0.005]]) {
    const result = analyzeSection({ ...input, mesh });
    const point = atAngle(result, Math.PI / 2);
    close(point.neutralAxisCm, exactC, tolerance);
    close(point.mxKnm, reference.mxKnm, tolerance);
    close(point.myKnm, 0, 0, 1e-6);
  }
});

test('a high steel ratio remains in equilibrium near the full-compression domain limit', () => {
  const input = {
    ...baseInput, bxCm: 20, byCm: 20, coverCm: 3,
    barDiameterMm: 32, barsX: 2, barsY: 2,
  };
  const max = analyzeSection(input).axial.maxCompressionKn;
  const result = analyzeSection({ ...input, nKn: max * 0.9999 });
  assert.ok(result.reinforcement.ratioPercent > 8);
  assert.equal(result.interaction.status, 'ok');
  assert.equal(result.interaction.points.length, 36);
  for (const point of result.interaction.points) {
    assert.ok(Math.abs(point.residualKn) < 0.001);
    assert.ok(Number.isFinite(point.mxKnm));
    assert.ok(Number.isFinite(point.myKnm));
    assert.ok(point.neutralAxisCm > 20);
  }
});

test('successive concrete mesh refinements approach the same biaxial contour', () => {
  const input = {
    ...baseInput, bxCm: 20, byCm: 35, coverCm: 3,
    barDiameterMm: 12, barsX: 3, barsY: 4, nKn: 450,
  };
  const coarse = analyzeSection({ ...input, mesh: 20 });
  const medium = analyzeSection({ ...input, mesh: 40 });
  const fine = analyzeSection({ ...input, mesh: 80 });
  let coarseError = 0;
  let mediumError = 0;
  for (const reference of fine.interaction.points) {
    const a = atAngle(coarse, reference.angleRad);
    const b = atAngle(medium, reference.angleRad);
    const referenceNorm = Math.hypot(reference.mxKnm, reference.myKnm);
    const errorA = Math.hypot(a.mxKnm - reference.mxKnm, a.myKnm - reference.myKnm) / referenceNorm;
    const errorB = Math.hypot(b.mxKnm - reference.mxKnm, b.myKnm - reference.myKnm) / referenceNorm;
    assert.ok(errorA < 0.02, `20×20 mesh relative error ${errorA}`);
    assert.ok(errorB < 0.008, `40×40 mesh relative error ${errorB}`);
    coarseError += errorA;
    mediumError += errorB;
  }
  assert.ok(mediumError < coarseError, '40×40 mesh should be closer overall to 80×80');
});

test('applied moments change demand classification without changing fixed-N capacity', () => {
  const original = analyzeSection(baseInput);
  const capacity = atAngle(original, Math.PI / 2);
  const small = analyzeSection({ ...baseInput, mxKnm: capacity.mxKnm * 0.5 });
  const large = analyzeSection({ ...baseInput, mxKnm: capacity.mxKnm * 1.5 });
  assert.deepEqual(small.interaction, original.interaction);
  assert.deepEqual(large.interaction, original.interaction);
  assert.equal(original.demand.inside, true);
  assert.equal(original.demand.radialFactor, null);
  assert.equal(small.demand.inside, true);
  assert.equal(large.demand.inside, false);
  close(small.demand.radialFactor, 2, 2e-6);
  close(large.demand.radialFactor, 2 / 3, 2e-6);
  const negative = analyzeSection({ ...baseInput, mxKnm: -capacity.mxKnm * 0.5 });
  assert.equal(negative.demand.inside, true);
  close(negative.demand.radialFactor, small.demand.radialFactor, 2e-6);
});

test('maximum uniform compression and excess axial force return no fictitious interaction curve', () => {
  const max = analyzeSection(baseInput).axial.maxCompressionKn;
  const uniform = analyzeSection({ ...baseInput, nKn: max });
  assert.equal(uniform.interaction.status, 'degenerate');
  assert.equal(uniform.interaction.points.length, 0);
  assert.equal(uniform.demand.inside, null);
  assert.equal(uniform.demand.radialFactor, null);
  const excess = analyzeSection({ ...baseInput, nKn: max * 1.01 });
  assert.equal(excess.interaction.status, 'axial-out-of-range');
  assert.equal(excess.interaction.points.length, 0);
  assert.equal(excess.demand.inside, null);
  assert.equal(excess.demand.radialFactor, null);
  close(excess.interaction.axialRange.maxKn, max);
});

test('input snapshots are independent and frozen input is not mutated', () => {
  const input = Object.freeze({ ...baseInput });
  const result = analyzeSection(input);
  assert.deepEqual(input, baseInput);
  assert.deepEqual(result.input, baseInput);
  assert.notEqual(result.input, input);
});

test('invalid material ranges, nonfinite numbers and noninteger discretization identify their fields', () => {
  const invalidCases = [
    ['bxCm', 0], ['byCm', -1], ['bxCm', Infinity],
    ['fckMpa', 19], ['fckMpa', 51], ['fykMpa', 199], ['fykMpa', 601],
    ['gammaC', 0.99], ['gammaC', 3.01], ['gammaS', 0.99], ['gammaS', 3.01],
    ['esGPa', 149], ['esGPa', 251], ['coverCm', -1], ['barDiameterMm', 0],
    ['barsX', 1], ['barsY', 31], ['barsX', 2.5], ['barsY', 2.5],
    ['points', 35], ['points', 181], ['points', 36.5],
    ['mesh', 19], ['mesh', 81], ['mesh', 20.5],
    ['nKn', -1], ['nKn', NaN], ['mxKnm', Infinity], ['myKnm', -Infinity],
    ['fckMpa', '30'], ['nKn', '100'],
  ];
  for (const [field, value] of invalidCases) {
    assertValidation({ ...baseInput, [field]: value }, field);
  }
});

test('impossible cover, overlapping bars and numerically unrepresentable geometry are rejected', () => {
  const invalidCases = [
    { ...baseInput, coverCm: 0.2 }, // Ø10 mm radius cannot fit inside this cover.
    { ...baseInput, coverCm: 4.6 }, // Centers cannot fit inside the 9 cm side.
    { ...baseInput, barsX: 10 }, // The short face cannot fit ten Ø10 mm bars.
    { ...baseInput, barsY: 30 },
    { ...baseInput, bxCm: Number.MAX_VALUE, byCm: Number.MAX_VALUE },
    { ...baseInput, bxCm: Number.MIN_VALUE },
  ];
  for (const input of invalidCases) assertValidation(input);
  for (const input of [null, [], 'section']) assertValidation(input);
});
