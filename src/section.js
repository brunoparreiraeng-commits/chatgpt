/**
 * Illustrative rectangular reinforced-concrete section model.
 * Plane sections, a parabolic-rectangular concrete law and bilinear steel are
 * integrated by midpoint fibers. This is not a column-design or code check.
 * Positive N and stress mean compression; Mx = integral(sigma * y dA),
 * My = integral(sigma * x dA). Lengths below are in cm, stresses in MPa.
 */

const EPSILON_C2 = 0.002;
const EPSILON_CU = 0.0035;
const EPSILON_SU = 0.01;
const FIELDS = [
  'bxCm', 'byCm', 'fckMpa', 'fykMpa', 'gammaC', 'gammaS', 'esGPa',
  'coverCm', 'barDiameterMm', 'barsX', 'barsY', 'nKn', 'mxKnm', 'myKnm',
  'points', 'mesh',
];
const RANGES = {
  fckMpa: [20, 50], fykMpa: [200, 600], gammaC: [1, 3], gammaS: [1, 3],
  esGPa: [150, 250], barsX: [2, 30], barsY: [2, 30],
  points: [36, 180], mesh: [20, 80],
};
const INTEGER_FIELDS = new Set(['barsX', 'barsY', 'points', 'mesh']);

export class SectionValidationError extends Error {
  constructor(issues) {
    super(issues.map(({ message }) => message).join(' '));
    this.name = 'SectionValidationError';
    this.issues = issues;
  }
}

function fail(field, message) {
  throw new SectionValidationError([{ field, message }]);
}

function finiteCalculated(values, positive = false) {
  if (values.some((value) => !Number.isFinite(value) || (positive && value <= 0))) {
    fail('input', 'Os valores excedem a faixa numérica do modelo de seção. Revise unidades e magnitudes.');
  }
}

function prepareSection(suppliedInput) {
  if (suppliedInput === null || typeof suppliedInput !== 'object' || Array.isArray(suppliedInput)) {
    fail('input', 'Informe os dados da seção em um objeto.');
  }
  const issues = [];
  for (const field of FIELDS) {
    const value = suppliedInput[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field, message: `${field}: informe um número finito.` });
      continue;
    }
    if (INTEGER_FIELDS.has(field) && !Number.isInteger(value)) {
      issues.push({ field, message: `${field}: informe um número inteiro.` });
    }
    if (RANGES[field]) {
      const [min, max] = RANGES[field];
      if (value < min || value > max) {
        issues.push({ field, message: `${field}: o modelo aceita valores entre ${min} e ${max}.` });
      }
    } else if (field === 'nKn') {
      if (value < 0) issues.push({ field, message: 'nKn: informe zero ou compressão positiva.' });
    } else if (field !== 'mxKnm' && field !== 'myKnm' && value <= 0) {
      issues.push({ field, message: `${field}: o valor deve ser maior que zero.` });
    }
  }
  if (issues.length) throw new SectionValidationError(issues);
  const input = Object.fromEntries(FIELDS.map((field) => [field, suppliedInput[field]]));
  const radiusCm = input.barDiameterMm / 20;
  const barAreaCm2 = Math.PI * radiusCm ** 2;
  const grossAreaCm2 = input.bxCm * input.byCm;
  finiteCalculated([radiusCm, barAreaCm2, grossAreaCm2], true);
  finiteCalculated([Math.hypot(input.bxCm, input.byCm), Math.hypot(input.mxKnm, input.myKnm)]);
  if (input.coverCm < radiusCm) {
    fail('coverCm', 'A distância face–centro deve ser pelo menos o raio da barra para mantê-la dentro da seção.');
  }
  if (input.coverCm >= Math.min(input.bxCm, input.byCm) / 2) {
    fail('coverCm', 'A distância face–centro deve ser menor que metade de ambas as dimensões.');
  }

  const halfX = input.bxCm / 2 - input.coverCm;
  const halfY = input.byCm / 2 - input.coverCm;
  const bars = [];
  for (let i = 0; i < input.barsX; i += 1) {
    const xCm = -halfX + 2 * halfX * i / (input.barsX - 1);
    bars.push({ xCm, yCm: -halfY, areaCm2: barAreaCm2 });
    bars.push({ xCm, yCm: halfY, areaCm2: barAreaCm2 });
  }
  for (let j = 1; j < input.barsY - 1; j += 1) {
    const yCm = -halfY + 2 * halfY * j / (input.barsY - 1);
    bars.push({ xCm: -halfX, yCm, areaCm2: barAreaCm2 });
    bars.push({ xCm: halfX, yCm, areaCm2: barAreaCm2 });
  }
  const diameterCm = radiusCm * 2;
  for (let i = 0; i < bars.length; i += 1) {
    for (let j = i + 1; j < bars.length; j += 1) {
      const spacing = Math.hypot(bars[i].xCm - bars[j].xCm, bars[i].yCm - bars[j].yCm);
      if (spacing < diameterCm * (1 - 1e-12)) {
        fail('reinforcement', 'As barras se sobrepõem. Revise diâmetro, quantidade, dimensões e distância face–centro.');
      }
    }
  }
  const totalSteelAreaCm2 = barAreaCm2 * bars.length;
  if (totalSteelAreaCm2 >= grossAreaCm2) {
    fail('reinforcement', 'A área de aço deve ser menor que a área bruta da seção.');
  }
  const materials = {
    fcdMpa: input.fckMpa / input.gammaC,
    fydMpa: input.fykMpa / input.gammaS,
    concretePeakMpa: 0.85 * input.fckMpa / input.gammaC,
    esMpa: input.esGPa * 1000,
    epsilonC2: EPSILON_C2,
    epsilonCu: EPSILON_CU,
    epsilonSu: EPSILON_SU,
  };
  const reinforcement = {
    bars,
    count: bars.length,
    areaCm2: totalSteelAreaCm2,
    ratioPercent: 100 * totalSteelAreaCm2 / grossAreaCm2,
  };
  const maxCompressionKn = 0.1 * (
    (grossAreaCm2 - totalSteelAreaCm2) * materials.concretePeakMpa
    + totalSteelAreaCm2 * steelStress(EPSILON_C2, materials.esMpa, materials.fydMpa)
  );
  const minCompressionKn = -0.1 * totalSteelAreaCm2 * materials.fydMpa;
  finiteCalculated([maxCompressionKn, totalSteelAreaCm2, reinforcement.ratioPercent], true);
  finiteCalculated([minCompressionKn]);
  return {
    input, materials, reinforcement, grossAreaCm2,
    axial: { maxCompressionKn, minCompressionKn },
  };
}

/** Concrete has no tensile resistance; the section model limits strain to 0.0035. */
export function concreteStress(epsilon, peakMpa) {
  if (epsilon <= 0) return 0;
  if (epsilon >= EPSILON_C2) return peakMpa;
  const ratio = epsilon / EPSILON_C2;
  return peakMpa * ratio * (2 - ratio);
}

export function steelStress(epsilon, esMpa, fydMpa) {
  return Math.max(-fydMpa, Math.min(fydMpa, esMpa * epsilon));
}

/** Analytic reference for a uniform strain, with concrete displaced by the bars. */
export function evaluateUniformSection(input, epsilon) {
  if (!Number.isFinite(epsilon) || epsilon < -EPSILON_SU || epsilon > EPSILON_CU) {
    fail('epsilon', 'A deformação uniforme deve estar entre −0,01 e 0,0035.');
  }
  const section = prepareSection(input);
  const { materials, reinforcement, grossAreaCm2 } = section;
  const nKn = 0.1 * (
    (grossAreaCm2 - reinforcement.areaCm2) * concreteStress(epsilon, materials.concretePeakMpa)
    + reinforcement.areaCm2 * steelStress(epsilon, materials.esMpa, materials.fydMpa)
  );
  finiteCalculated([nKn]);
  return { nKn, mxKnm: 0, myKnm: 0 };
}

function createFibers(input) {
  const count = input.mesh ** 2;
  const x = new Float64Array(count);
  const y = new Float64Array(count);
  let index = 0;
  for (let i = 0; i < input.mesh; i += 1) {
    for (let j = 0; j < input.mesh; j += 1) {
      x[index] = input.bxCm * ((i + 0.5) / input.mesh - 0.5);
      y[index] = input.byCm * ((j + 0.5) / input.mesh - 0.5);
      index += 1;
    }
  }
  return { x, y, areaCm2: input.bxCm * input.byCm / count };
}

function calculateContourPoint(section, fibers, angleRad) {
  const { input, materials, reinforcement } = section;
  const nx = Math.cos(angleRad);
  const ny = Math.sin(angleRad);
  const cornerProjectionCm = Math.abs(nx) * input.bxCm / 2 + Math.abs(ny) * input.byCm / 2;
  const depthCm = cornerProjectionCm * 2;
  const fiberDepths = new Float64Array(fibers.x.length);
  for (let i = 0; i < fiberDepths.length; i += 1) {
    fiberDepths[i] = cornerProjectionCm - nx * fibers.x[i] - ny * fibers.y[i];
  }
  const barDepths = new Float64Array(reinforcement.count);
  let deepestBarCm = 0;
  for (let i = 0; i < reinforcement.count; i += 1) {
    const bar = reinforcement.bars[i];
    barDepths[i] = cornerProjectionCm - nx * bar.xCm - ny * bar.yCm;
    deepestBarCm = Math.max(deepestBarCm, barDepths[i]);
  }

  function integrate(c, withMoments = false) {
    // For partially compressed sections, limit the extreme concrete corner
    // and the most tensile bar. For a fully compressed rectangle, rotate the
    // strain plane about epsilonC2 at d = (1 - epsilonC2/epsilonCu) * depth;
    // this approaches uniform epsilonC2 as c -> infinity, continuously at c=D.
    let topStrain;
    if (c >= depthCm) {
      topStrain = EPSILON_C2 / (1 - (1 - EPSILON_C2 / EPSILON_CU) * depthCm / c);
    } else {
      topStrain = c < deepestBarCm
        ? Math.min(EPSILON_CU, EPSILON_SU * c / (deepestBarCm - c))
        : EPSILON_CU;
    }
    const gradient = topStrain / c;
    let normal = 0;
    let momentX = 0;
    let momentY = 0;
    for (let i = 0; i < fiberDepths.length; i += 1) {
      const sigma = concreteStress(topStrain - gradient * fiberDepths[i], materials.concretePeakMpa);
      const force = sigma * fibers.areaCm2;
      normal += force;
      if (withMoments) {
        momentX += force * fibers.y[i];
        momentY += force * fibers.x[i];
      }
    }
    for (let i = 0; i < barDepths.length; i += 1) {
      const bar = reinforcement.bars[i];
      const epsilon = topStrain - gradient * barDepths[i];
      const stressDifference = steelStress(epsilon, materials.esMpa, materials.fydMpa)
        - concreteStress(epsilon, materials.concretePeakMpa);
      const force = stressDifference * bar.areaCm2;
      normal += force;
      if (withMoments) {
        momentX += force * bar.yCm;
        momentY += force * bar.xCm;
      }
    }
    return { nKn: normal * 0.1, mxKnm: momentX * 0.001, myKnm: momentY * 0.001 };
  }

  let low = depthCm * 1e-10;
  let high = depthCm;
  let lowForce = integrate(low).nKn;
  let highForce = integrate(high).nKn;
  const forceTolerance = Math.max(1e-7, section.axial.maxCompressionKn * 1e-9);
  // The target is nonnegative. The low boundary is a predominantly tensile
  // section; the high boundary approaches uniform compression as c -> infinity.
  if (lowForce > input.nKn + forceTolerance) {
    fail('input', 'Não foi possível delimitar a raiz de equilíbrio da seção. Revise a geometria de armaduras.');
  }
  let bracketSteps = 0;
  while (highForce < input.nKn && bracketSteps < 80) {
    high *= 2;
    highForce = integrate(high).nKn;
    bracketSteps += 1;
  }
  if (!Number.isFinite(highForce) || highForce < input.nKn - forceTolerance) {
    fail('input', 'Não foi possível obter equilíbrio axial na faixa numérica do modelo.');
  }
  let c = (low + high) / 2;
  for (let step = 0; step < 90; step += 1) {
    c = (low + high) / 2;
    const force = integrate(c).nKn;
    if (Math.abs(force - input.nKn) <= forceTolerance) break;
    if (force < input.nKn) {
      low = c;
      lowForce = force;
    } else {
      high = c;
    }
  }
  const result = integrate(c, true);
  const residualKn = result.nKn - input.nKn;
  finiteCalculated([result.mxKnm, result.myKnm, c, residualKn]);
  if (Math.abs(residualKn) > forceTolerance * 2) {
    fail('input', 'O equilíbrio axial não convergiu. Revise as entradas ou a resolução da malha.');
  }
  return { mxKnm: result.mxKnm, myKnm: result.myKnm, neutralAxisCm: c, angleRad, residualKn };
}

function evaluateDemand(input, points) {
  const result = { mxKnm: input.mxKnm, myKnm: input.myKnm, inside: null, radialFactor: null };
  if (points.length < 3) return result;
  const magnitude = Math.hypot(input.mxKnm, input.myKnm);
  if (magnitude === 0) return { ...result, inside: true };
  const dx = input.mxKnm / magnitude;
  const dy = input.myKnm / magnitude;
  let radialDistance = Infinity;
  // Intersect the demand ray with actual neighboring contour samples. There is
  // no ellipse fit; the resolution of the sampled polygon remains an assumption.
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const ex = q.mxKnm - p.mxKnm;
    const ey = q.myKnm - p.myKnm;
    const denominator = dx * ey - dy * ex;
    if (denominator === 0) continue;
    const distance = (p.mxKnm * ey - p.myKnm * ex) / denominator;
    const position = (p.mxKnm * dy - p.myKnm * dx) / denominator;
    if (distance >= 0 && position >= -1e-10 && position <= 1 + 1e-10) {
      radialDistance = Math.min(radialDistance, distance);
    }
  }
  if (!Number.isFinite(radialDistance)) return result;
  const radialFactor = radialDistance / magnitude;
  finiteCalculated([radialFactor]);
  return { ...result, inside: radialFactor >= 1 - 1e-9, radialFactor };
}

export function analyzeSection(suppliedInput) {
  const section = prepareSection(suppliedInput);
  const { input, materials, reinforcement, axial } = section;
  const axialTolerance = Math.max(1e-7, axial.maxCompressionKn * 1e-9);
  let status = 'ok';
  let points = [];
  if (input.nKn > axial.maxCompressionKn + axialTolerance) {
    status = 'axial-out-of-range';
  } else if (Math.abs(input.nKn - axial.maxCompressionKn) <= axialTolerance) {
    status = 'degenerate';
  } else {
    const fibers = createFibers(input);
    for (let i = 0; i < input.points; i += 1) {
      points.push(calculateContourPoint(section, fibers, 2 * Math.PI * i / input.points));
    }
    const maxMoment = Math.max(...points.map(({ mxKnm, myKnm }) => Math.hypot(mxKnm, myKnm)));
    if (maxMoment < 1e-10) {
      status = 'degenerate';
      points = [];
    }
  }
  const interaction = {
    nKn: input.nKn,
    points,
    status,
    axialRange: { minKn: axial.minCompressionKn, maxKn: axial.maxCompressionKn },
  };
  const demand = evaluateDemand(input, points);
  const notes = [
    'Seção ilustrativa por compatibilidade de deformações: concreto sem tração, diagrama parábola–retângulo com pico 0,85 fck/γc e aço bilinear com patamar ±fyk/γs.',
    'A seção é retangular e as barras são simétricas no perímetro. A distância informada é face–centro da barra, não cobrimento nominal.',
    'A integração usa fibras de ponto médio e desconta o concreto equivalente na posição do centro de cada barra. A curva é amostrada por ângulos de plano de deformações; não é uma elipse ajustada.',
    'Na compressão parcial, a família de deformações limita o canto comprimido a 0,0035 e a barra mais tracionada a −0,01. Na compressão total, o plano gira pelo ponto de deformação 0,002 a 3/7 da profundidade projetada, até compressão uniforme a 0,002. Os domínios e verificações completos de uma norma não foram implementados.',
    'A força axial máxima usa compressão uniforme a 0,002 e a mínima usa tração uniforme do aço a −0,01. São limites deste modelo de seção; a curva nesta ferramenta admite apenas força axial não negativa.',
    'Estar dentro do polígono e o fator radial são relações geométricas desta seção ilustrativa; não são coeficientes de segurança nem autorização para executar uma estrutura.',
    'Esta análise de seção não verifica flambagem, efeitos de segunda ordem, estabilidade global, fissuração em serviço, detalhamento ou conformidade com a NBR 6118. A análise de Euler é independente e não valida esta curva.',
  ];
  if (status === 'axial-out-of-range') {
    notes.push('A força axial ultrapassa a compressão uniforme máxima deste modelo. Nenhum contorno Mx–My foi gerado.');
  } else if (status === 'degenerate') {
    notes.push('A compressão uniforme máxima ou um contorno sem dimensão útil produz um estado degenerado. Nenhum contorno Mx–My utilizável foi gerado.');
  }
  if (demand.mxKnm === 0 && demand.myKnm === 0 && status === 'ok') {
    notes.push('Para demanda de momentos nula, o fator radial não está definido.');
  }
  return { input, materials, reinforcement, axial, interaction, demand, notes };
}
