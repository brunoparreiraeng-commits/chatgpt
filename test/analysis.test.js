import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeColumn, InputValidationError } from '../src/analysis.js';

const baseInput = {
  bxCm: 9,
  byCm: 30,
  lengthXM: 6,
  lengthYM: 6,
  kX: 1,
  kY: 1,
  eGPa: 25,
  rigidityFactor: 1,
  nKn: 0,
  mxKnm: 0,
  myKnm: 0,
  loadFactor: 1,
};

function close(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `Expected ${actual} to be approximately ${expected}`,
  );
}

test('9 × 30 cm geometry, section moduli and radii follow the two bending axes', () => {
  const { section } = analyzeColumn(baseInput);
  close(section.areaCm2, 270);
  close(section.areaM2, 0.027);
  close(section.ixCm4, 20_250);
  close(section.iyCm4, 1_822.5);
  close(section.ixM4, 0.0002025);
  close(section.iyM4, 0.000018225);
  close(section.rxCm, 8.660254037844387);
  close(section.ryCm, 2.598076211353316);
  close(section.wxCm3, 1_350);
  close(section.wyCm3, 405);
});

test('a 6 m free segment has known Euler loads and the y axis is the weak axis', () => {
  const { axes } = analyzeColumn(baseInput);
  close(axes.x.effectiveLengthM, 6);
  close(axes.y.effectiveLengthM, 6);
  close(axes.x.slenderness, 69.2820323027551);
  close(axes.y.slenderness, 230.9401076758503);
  close(axes.x.ncrKn, 1_387.913118903191);
  close(axes.y.ncrKn, 124.9121807012872);
  close(axes.x.ncrKn / axes.y.ncrKn, 100 / 9);
});

test('doubling free length quarters Euler load and doubles slenderness', () => {
  const six = analyzeColumn(baseInput);
  const three = analyzeColumn({ ...baseInput, lengthXM: 3, lengthYM: 3 });
  for (const axis of ['x', 'y']) {
    close(three.axes[axis].ncrKn / six.axes[axis].ncrKn, 4);
    close(six.axes[axis].slenderness / three.axes[axis].slenderness, 2);
  }
});

test('K = 2 doubles effective length and quarters the Euler load on that axis', () => {
  const normal = analyzeColumn(baseInput);
  const modified = analyzeColumn({ ...baseInput, kX: 2 });
  close(modified.axes.x.effectiveLengthM, 12);
  close(normal.axes.x.ncrKn / modified.axes.x.ncrKn, 4);
  close(modified.axes.x.slenderness / normal.axes.x.slenderness, 2);
  assert.deepEqual(normal.axes.y, modified.axes.y);
});

test('rigidity reduction changes Euler loads linearly without changing geometry', () => {
  const gross = analyzeColumn(baseInput);
  const reduced = analyzeColumn({ ...baseInput, rigidityFactor: 0.4 });
  close(reduced.axes.x.ncrKn / gross.axes.x.ncrKn, 0.4);
  close(reduced.axes.y.ncrKn / gross.axes.y.ncrKn, 0.4);
  assert.deepEqual(gross.section, reduced.section);
});

test('zero loads give zero first-order stress, unit amplification and zero moments', () => {
  const result = analyzeColumn(baseInput);
  for (const axis of ['x', 'y']) {
    assert.equal(result.axes[axis].ratio, 0);
    assert.equal(result.axes[axis].amplification, 1);
    assert.equal(result.axes[axis].amplifiedMomentKnm, 0);
  }
  assert.equal(result.stress.minMpa, 0);
  assert.equal(result.stress.maxMpa, 0);
  assert.equal(result.stress.corners.length, 4);
  assert.ok(result.stress.corners.every(({ mpa }) => mpa === 0));
});

test('near Euler, amplification preserves the signed moment', () => {
  const critical = analyzeColumn(baseInput).axes.y.ncrKn;
  const result = analyzeColumn({ ...baseInput, nKn: critical * 0.99, myKnm: -2 });
  close(result.axes.y.ratio, 0.99);
  close(result.axes.y.amplification, 100);
  close(result.axes.y.amplifiedMomentKnm, -200);
  assert.ok(result.axes.x.ratio < 1);
});

test('at and above Euler, no amplification or amplified moment is returned even for M = 0', () => {
  const critical = analyzeColumn(baseInput).axes.y.ncrKn;
  for (const scale of [1, 1.1]) {
    const result = analyzeColumn({ ...baseInput, nKn: critical * scale });
    assert.equal(result.axes.y.amplification, null);
    assert.equal(result.axes.y.amplifiedMomentKnm, null);
    assert.equal(result.axes.x.amplification, null);
    assert.equal(result.axes.x.amplifiedMomentKnm, null);
    assert.ok(result.axes.x.ratio < 1);
    assert.ok(result.notes.some((note) => note.includes('atingiu ou ultrapassou')));
    assert.ok(Number.isFinite(result.stress.maxMpa));
  }
});

test('mixed moments give the known first-order corner extrema after the load multiplier', () => {
  // 20 × 40 cm: A = 0.08 m²; Wx = 0.005333333 m³; Wy = 0.002666667 m³.
  // Factored N = 160 kN, Mx = 16 kNm, My = -8 kNm:
  // uniform compression 2 MPa, each bending contribution has magnitude 3 MPa.
  const result = analyzeColumn({
    ...baseInput, bxCm: 20, byCm: 40,
    nKn: 80, mxKnm: 8, myKnm: -4, loadFactor: 2,
  });
  assert.deepEqual(result.loads, { nKn: 160, mxKnm: 16, myKnm: -8 });
  close(result.stress.minMpa, -4);
  close(result.stress.maxMpa, 8);
  const at = (x, y) => result.stress.corners.find(({ xCm, yCm }) => xCm === x && yCm === y).mpa;
  close(at(-10, -20), 2);
  close(at(-10, 20), 8);
  close(at(10, -20), -4);
  close(at(10, 20), 2);
  assert.ok(result.axes.x.amplifiedMomentKnm > 16);
  assert.ok(result.axes.y.amplifiedMomentKnm < -8);
  assert.ok(result.notes.some((note) => note.includes('primeira ordem')));
});

test('analysis does not mutate inputs and returns an independent input snapshot', () => {
  const original = { ...baseInput };
  const input = Object.freeze({ ...original });
  const result = analyzeColumn(input);
  assert.deepEqual(input, original);
  assert.deepEqual(result.input, original);
  assert.notEqual(result.input, input);
});

test('invalid numbers and physical input ranges produce field-specific validation errors', () => {
  const invalidCases = [
    ['bxCm', 0], ['byCm', -1], ['lengthXM', 0], ['lengthYM', -6],
    ['kX', 0], ['kY', -1], ['eGPa', 0],
    ['rigidityFactor', 0], ['rigidityFactor', 1.01],
    ['nKn', -1], ['loadFactor', 0],
    ['mxKnm', NaN], ['myKnm', Infinity], ['nKn', -Infinity],
    ['eGPa', '25'], ['bxCm', undefined],
  ];
  for (const [field, value] of invalidCases) {
    assert.throws(
      () => analyzeColumn({ ...baseInput, [field]: value }),
      (error) => error instanceof InputValidationError && error.issues.some((issue) => issue.field === field),
      `${field} = ${String(value)} must be rejected`,
    );
  }
});

test('malformed input and numerically unrepresentable geometry or loads are rejected', () => {
  for (const input of [null, undefined, [], 'input']) {
    assert.throws(() => analyzeColumn(input), InputValidationError);
  }
  for (const input of [
    { ...baseInput, bxCm: Number.MAX_VALUE, byCm: Number.MAX_VALUE },
    { ...baseInput, bxCm: Number.MIN_VALUE },
    { ...baseInput, nKn: Number.MAX_VALUE, loadFactor: 2 },
  ]) {
    assert.throws(() => analyzeColumn(input), InputValidationError);
  }
});
