/**
 * Experimental, linear elastic model of a prismatic rectangular column.
 * Compression is positive. x and y are the section's centroidal axes:
 * Ix = bx * by^3 / 12 and Mx bends around x; Iy = by * bx^3 / 12.
 * Results do not establish structural capacity or compliance with a standard.
 */

const INPUT_FIELDS = [
  'bxCm', 'byCm', 'lengthXM', 'lengthYM', 'kX', 'kY', 'eGPa',
  'rigidityFactor', 'nKn', 'mxKnm', 'myKnm', 'loadFactor',
];

const FIELD_LABELS = {
  bxCm: 'Dimensão bx',
  byCm: 'Dimensão by',
  lengthXM: 'Comprimento livre no eixo x',
  lengthYM: 'Comprimento livre no eixo y',
  kX: 'Coeficiente K no eixo x',
  kY: 'Coeficiente K no eixo y',
  eGPa: 'Módulo de elasticidade',
  rigidityFactor: 'Fator de rigidez',
  nKn: 'Força normal',
  mxKnm: 'Momento Mx',
  myKnm: 'Momento My',
  loadFactor: 'Multiplicador de esforços',
};

export class InputValidationError extends Error {
  constructor(issues) {
    super(issues.map(({ message }) => message).join(' '));
    this.name = 'InputValidationError';
    this.issues = issues;
  }
}

function validateInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new InputValidationError([
      { field: 'input', message: 'Informe os dados do modelo em um objeto.' },
    ]);
  }

  const issues = [];
  for (const field of INPUT_FIELDS) {
    const value = input[field];
    const label = FIELD_LABELS[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      issues.push({ field, message: `${label}: informe um número finito.` });
    } else if (field === 'nKn') {
      if (value < 0) {
        issues.push({ field, message: `${label}: use zero ou compressão positiva.` });
      }
    } else if (field !== 'mxKnm' && field !== 'myKnm' && value <= 0) {
      issues.push({ field, message: `${label}: o valor deve ser maior que zero.` });
    } else if (field === 'rigidityFactor' && value > 1) {
      issues.push({ field, message: `${label}: o valor deve ser no máximo 1.` });
    }
  }
  if (issues.length) throw new InputValidationError(issues);

  // Return an independent snapshot; do not mutate the caller's inputs.
  return Object.fromEntries(INPUT_FIELDS.map((field) => [field, input[field]]));
}

function checkCalculatedNumbers(values, positive = false) {
  if (values.some((value) => !Number.isFinite(value) || (positive && value <= 0))) {
    throw new InputValidationError([{
      field: 'input',
      message: 'Os valores excedem a faixa numérica do modelo. Revise as unidades e as magnitudes.',
    }]);
  }
}

/**
 * @param {{bxCm:number, byCm:number, lengthXM:number, lengthYM:number,
 *   kX:number, kY:number, eGPa:number, rigidityFactor:number, nKn:number,
 *   mxKnm:number, myKnm:number, loadFactor:number}} suppliedInput
 * @returns {object} Section properties, ideal Euler results and first-order stresses.
 * stress always uses the first-order loads after loadFactor, not amplified moments.
 * amplification/amplifiedMomentKnm are null on both axes when either ideal
 * Euler load is reached: there is no stable global equilibrium in this model.
 */
export function analyzeColumn(suppliedInput) {
  const input = validateInput(suppliedInput);
  const bxM = input.bxCm / 100;
  const byM = input.byCm / 100;
  const areaM2 = bxM * byM;
  const ixM4 = bxM * byM ** 3 / 12;
  const iyM4 = byM * bxM ** 3 / 12;
  const section = {
    areaCm2: areaM2 * 1e4,
    areaM2,
    ixM4,
    iyM4,
    ixCm4: ixM4 * 1e8,
    iyCm4: iyM4 * 1e8,
    rxCm: Math.sqrt(ixM4 / areaM2) * 100,
    ryCm: Math.sqrt(iyM4 / areaM2) * 100,
    wxCm3: ixM4 / (byM / 2) * 1e6,
    wyCm3: iyM4 / (bxM / 2) * 1e6,
  };
  checkCalculatedNumbers(Object.values(section), true);

  const loads = {
    nKn: input.nKn * input.loadFactor,
    mxKnm: input.mxKnm * input.loadFactor,
    myKnm: input.myKnm * input.loadFactor,
  };
  checkCalculatedNumbers(Object.values(loads));
  const effectiveEMpa = input.eGPa * 1000 * input.rigidityFactor;
  checkCalculatedNumbers([effectiveEMpa], true);

  function analyzeAxis(lengthM, k, radiusCm, inertiaM4) {
    const effectiveLengthM = k * lengthM;
    const slenderness = effectiveLengthM * 100 / radiusCm;
    const ncrKn = Math.PI ** 2 * effectiveEMpa * 1000 * inertiaM4 / effectiveLengthM ** 2;
    checkCalculatedNumbers([effectiveLengthM, slenderness, ncrKn], true);
    const ratio = loads.nKn / ncrKn;
    checkCalculatedNumbers([ratio]);
    return {
      effectiveLengthM, slenderness, ncrKn, ratio,
      amplification: null, amplifiedMomentKnm: null,
    };
  }

  const axes = {
    x: analyzeAxis(input.lengthXM, input.kX, section.rxCm, ixM4),
    y: analyzeAxis(input.lengthYM, input.kY, section.ryCm, iyM4),
  };
  const reachedEulerLoad = axes.x.ratio >= 1 || axes.y.ratio >= 1;
  if (!reachedEulerLoad) {
    for (const [axisName, momentKnm] of [['x', loads.mxKnm], ['y', loads.myKnm]]) {
      const axis = axes[axisName];
      axis.amplification = 1 / (1 - axis.ratio);
      axis.amplifiedMomentKnm = momentKnm * axis.amplification;
      checkCalculatedNumbers([axis.amplification, axis.amplifiedMomentKnm]);
    }
  }

  // Positive stress means compression. No material-strength check is performed.
  const corners = [];
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      const xCm = xSign * input.bxCm / 2;
      const yCm = ySign * input.byCm / 2;
      const mpa = (
        loads.nKn * 1000 / areaM2
        + loads.mxKnm * 1000 * (yCm / 100) / ixM4
        + loads.myKnm * 1000 * (xCm / 100) / iyM4
      ) / 1e6;
      checkCalculatedNumbers([mpa]);
      corners.push({ xCm, yCm, mpa });
    }
  }
  const stress = {
    minMpa: Math.min(...corners.map(({ mpa }) => mpa)),
    maxMpa: Math.max(...corners.map(({ mpa }) => mpa)),
    corners,
  };

  const notes = [
    'Modelo experimental: seção retangular homogênea, barra prismática e comportamento elástico linear.',
    'K e os comprimentos livres são entradas do usuário; vínculos e travamentos não são inferidos.',
    'Euler descreve uma barra ideal. O fator de rigidez é uma hipótese fornecida, sem previsão de fissuração, fluência ou armadura.',
    'A amplificação 1/(1 − N/Ncr) é uma aproximação demonstrativa para N < Ncr; não representa uma análise completa de segunda ordem.',
    'As tensões são de primeira ordem, com os esforços multiplicados pelo fator informado. Compressão é positiva; tração é negativa.',
    'Não há verificação de resistência, armadura, detalhamento, estabilidade global ou conformidade com a NBR 6118. Nenhum resultado declara segurança para execução.',
  ];
  if (reachedEulerLoad) {
    notes.push('A força normal atingiu ou ultrapassou Ncr em pelo menos um eixo: o modelo ideal perdeu estabilidade. A amplificação fica indefinida nos dois eixos; as tensões exibidas continuam sendo de primeira ordem.');
  }
  if (stress.minMpa < 0) {
    notes.push('A seção elástica homogênea apresenta tração. Este modelo não considera fissuração nem redistribuição de tensões no concreto armado.');
  }

  return { input, section, loads, axes, stress, notes };
}
