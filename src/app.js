import { analyzeColumn, InputValidationError } from './analysis.js';

const MODEL_VERSION = '1.0.0';
const DEFAULT_INPUT = Object.freeze({
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
});

const form = document.querySelector('#column-form');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const formError = document.querySelector('#form-error');
const formState = document.querySelector('#form-state');
const exportButton = document.querySelector('#export-button');
const printButton = document.querySelector('#print-button');
let currentAnalysis = null;
let dirty = false;
let notificationTimer;

function number(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(normalized);
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function metric(id, value, unit) {
  const element = document.getElementById(id);
  element.replaceChildren(document.createTextNode(value));
  if (unit) {
    const suffix = document.createElement('small');
    suffix.textContent = ` ${unit}`;
    element.append(suffix);
  }
}

function readInput() {
  return Object.fromEntries(Object.keys(DEFAULT_INPUT).map((key) => {
    const value = form.elements.namedItem(key).value.trim();
    return [key, value === '' ? NaN : Number(value)];
  }));
}

function displayStatus(result) {
  status.className = 'analysis-status';
  status.replaceChildren();
  const hasLoads = result.loads.nKn !== 0 || result.loads.mxKnm !== 0 || result.loads.myKnm !== 0;
  const greatestRatio = Math.max(result.axes.x.ratio, result.axes.y.ratio);
  const prefix = document.createElement('strong');
  let description;

  if (!hasLoads) {
    prefix.textContent = 'Geometria e Euler calculados. ';
    description = 'Nenhum esforço aplicado foi informado. As tensões nulas não verificam a capacidade do pilar.';
  } else if (greatestRatio >= 1) {
    status.classList.add('is-critical');
    prefix.textContent = 'Limite do modelo de Euler atingido. ';
    description = 'A carga informada atinge ou ultrapassa a força crítica do modelo em pelo menos um eixo. A amplificação não é definida nos dois eixos; o modelo não determina o comportamento pós-crítico.';
  } else if (greatestRatio >= 0.8) {
    status.classList.add('is-warning');
    prefix.textContent = 'Alta sensibilidade no modelo ideal. ';
    description = 'A força normal se aproxima da força crítica teórica de Euler. Os resultados não fornecem uma margem de capacidade resistente.';
  } else {
    prefix.textContent = 'Análise elástica atualizada. ';
    description = 'Resultados sob as hipóteses informadas. Estar abaixo de Ncr não determina capacidade resistente nem adequação para uma obra.';
  }
  status.append(prefix, document.createTextNode(description));
}

function renderGeometry(result) {
  const { input, section } = result;
  metric('metric-section', `${number(input.bxCm, 0)} × ${number(input.byCm, 0)}`, 'cm');
  if (!Number.isInteger(input.bxCm) || !Number.isInteger(input.byCm)) {
    metric('metric-section', `${number(input.bxCm, 1)} × ${number(input.byCm, 1)}`, 'cm');
  }
  setText('metric-area', `Área: ${number(section.areaCm2, 1)} cm²`);
  setText('area-value', `${number(section.areaCm2, 2)} cm²`);
  setText('ix-value', `${number(section.ixCm4, 2)} cm⁴`);
  setText('iy-value', `${number(section.iyCm4, 2)} cm⁴`);
  setText('radius-value', `${number(section.rxCm, 2)} / ${number(section.ryCm, 2)} cm`);
  setText('section-modulus-value', `${number(section.wxCm3, 2)} / ${number(section.wyCm3, 2)} cm³`);
  setText('rigidity-value', `E = ${number(input.eGPa, 2)} GPa · EI × ${number(input.rigidityFactor, 3)}`);

  // Scale only the section drawing. The column is a schematic, not a support model.
  const maxDimension = Math.max(input.bxCm, input.byCm);
  const width = Math.max(4, 145 * input.bxCm / maxDimension);
  const height = Math.max(4, 145 * input.byCm / maxDimension);
  const left = 105 - width / 2;
  const top = 116 - height / 2;
  const shape = document.getElementById('section-shape');
  Object.entries({ x: left, y: top, width, height }).forEach(([key, value]) => shape.setAttribute(key, value));
  const horizontal = document.getElementById('dimension-bx');
  horizontal.setAttribute('x1', left);
  horizontal.setAttribute('x2', left + width);
  for (const [id, x] of [['dimension-bx-start', left], ['dimension-bx-end', left + width]]) {
    const tick = document.getElementById(id);
    tick.setAttribute('x1', x);
    tick.setAttribute('x2', x);
  }
  const dimX = Math.max(17, left - 17);
  const vertical = document.getElementById('dimension-by');
  Object.entries({ x1: dimX, x2: dimX, y1: top, y2: top + height }).forEach(([key, value]) => vertical.setAttribute(key, value));
  for (const [id, y] of [['dimension-by-start', top], ['dimension-by-end', top + height]]) {
    const tick = document.getElementById(id);
    Object.entries({ x1: dimX - 5, x2: dimX + 5, y1: y, y2: y }).forEach(([key, value]) => tick.setAttribute(key, value));
  }
  const labelY = document.getElementById('diagram-by');
  labelY.setAttribute('x', dimX - 12);
  labelY.setAttribute('transform', `rotate(-90 ${dimX - 12} 116)`);
  setText('diagram-bx', `${number(input.bxCm, 1)} cm`);
  setText('diagram-by', `${number(input.byCm, 1)} cm`);
  setText('diagram-length', input.lengthXM === input.lengthYM
    ? `${number(input.lengthXM, 1)} m livres`
    : `Lx ${number(input.lengthXM, 1)} / Ly ${number(input.lengthYM, 1)} m`);
  document.getElementById('section-diagram').setAttribute('aria-label', `Seção retangular de ${number(input.bxCm, 1)} por ${number(input.byCm, 1)} centímetros, com eixos de flexão x e y`);
}

function renderAxes(result) {
  const axes = Object.entries(result.axes);
  const slenderAxis = axes.reduce((greatest, entry) => entry[1].slenderness > greatest[1].slenderness ? entry : greatest);
  const criticalAxis = axes.reduce((least, entry) => entry[1].ncrKn < least[1].ncrKn ? entry : least);
  metric('metric-slenderness', number(slenderAxis[1].slenderness, 1));
  setText('metric-slenderness-axis', `Eixo ${slenderAxis[0]} · λ adimensional`);
  metric('metric-ncr', number(criticalAxis[1].ncrKn, 2), 'kN');
  setText('metric-ncr-axis', `Eixo ${criticalAxis[0]} · força crítica teórica`);
  for (const [key, axis] of axes) {
    setText(`${key}-effective-length`, `${number(axis.effectiveLengthM, 2)} m`);
    setText(`${key}-slenderness`, number(axis.slenderness, 2));
    setText(`${key}-ncr`, `${number(axis.ncrKn, 2)} kN`);
    setText(`${key}-ratio`, number(axis.ratio, 3));
    const ratioElement = document.getElementById(`${key}-ratio`);
    ratioElement.className = axis.ratio >= 1 ? 'beyond-limit' : axis.ratio >= 0.8 ? 'near-limit' : '';
    const canAmplify = Number.isFinite(axis.amplification) && axis.amplification !== null && axis.ratio < 1;
    setText(`${key}-amplification`, canAmplify ? `${number(axis.amplification, 3)} ×` : 'Fora do domínio');
    setText(`${key}-amplified-moment`, canAmplify ? `${number(axis.amplifiedMomentKnm, 3)} kN·m` : 'Não calculado');
  }
}

function renderStress(result) {
  setText('applied-n', `${number(result.loads.nKn, 2)} kN`);
  setText('applied-mx', `${number(result.loads.mxKnm, 3)} kN·m`);
  setText('applied-my', `${number(result.loads.myKnm, 3)} kN·m`);
  metric('stress-min', number(result.stress.minMpa, 3), 'MPa');
  metric('stress-max', number(result.stress.maxMpa, 3), 'MPa');
  const corners = document.getElementById('stress-corners');
  corners.replaceChildren();
  result.stress.corners.forEach((corner) => {
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = `(${number(corner.xCm, 2)}; ${number(corner.yCm, 2)}) cm`;
    const value = document.createElement('td');
    value.textContent = `${number(corner.mpa, 3)} MPa`;
    row.append(label, value);
    corners.append(row);
  });
}

function renderNotes(result) {
  const notes = document.getElementById('model-notes');
  notes.replaceChildren();
  for (const note of result.notes || []) {
    const element = document.createElement('li');
    element.textContent = typeof note === 'string' ? note : String(note.message || note);
    notes.append(element);
  }
}

function setClean() {
  dirty = false;
  formState.classList.remove('is-dirty');
  formState.textContent = 'Os resultados refletem os valores enviados para análise.';
  results.removeAttribute('data-stale');
  exportButton.disabled = false;
  printButton.disabled = false;
}

function updateAnalysis() {
  if (!form.reportValidity()) return false;
  results.setAttribute('aria-busy', 'true');
  formError.hidden = true;
  try {
    const analysis = analyzeColumn(readInput());
    renderGeometry(analysis);
    renderAxes(analysis);
    renderStress(analysis);
    renderNotes(analysis);
    displayStatus(analysis);
    currentAnalysis = analysis;
    setClean();
    return true;
  } catch (error) {
    const message = error instanceof InputValidationError
      ? error.message
      : 'Não foi possível concluir a análise. Revise as entradas e tente novamente.';
    formError.textContent = message;
    formError.hidden = false;
    results.setAttribute('data-stale', 'true');
    status.className = 'analysis-status is-error';
    status.textContent = `Análise não atualizada. ${message}`;
    exportButton.disabled = true;
    printButton.disabled = true;
    return false;
  } finally {
    results.setAttribute('aria-busy', 'false');
  }
}

function notify(message) {
  const element = document.getElementById('notification');
  clearTimeout(notificationTimer);
  element.textContent = message;
  element.hidden = false;
  notificationTimer = setTimeout(() => { element.hidden = true; }, 4500);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  updateAnalysis();
});

form.addEventListener('input', () => {
  dirty = true;
  formState.classList.add('is-dirty');
  formState.textContent = 'Entradas alteradas. Atualize a análise para refletir este cenário.';
  results.setAttribute('data-stale', 'true');
  status.className = 'analysis-status is-warning';
  status.textContent = 'Resultados desatualizados: os números abaixo pertencem ao último cenário calculado. Atualize a análise para usar as entradas atuais.';
});

document.getElementById('reset-button').addEventListener('click', () => {
  for (const [key, value] of Object.entries(DEFAULT_INPUT)) form.elements.namedItem(key).value = String(value);
  updateAnalysis();
  notify('Cenário restaurado: 9 × 30 cm e 6 m livres, sem esforços informados.');
});

exportButton.addEventListener('click', () => {
  if (dirty && !updateAnalysis()) return;
  if (!currentAnalysis) return;
  const exportData = {
    application: 'Pilar · Laboratório elástico',
    version: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    model: {
      label: 'Modelo experimental de barra elástica ideal',
      normativeVerification: false,
      dimensionalGammaNApplied: false,
      interpretation: 'Força crítica teórica de Euler; não representa carga admissível, capacidade resistente ou dimensionamento de obra.',
      limitations: ['fissuração', 'fluência', 'armadura', 'imperfeições', 'capacidade resistente', 'conexões', 'interação com a estrutura', 'verificações normativas'],
    },
    inputs: currentAnalysis.input,
    results: currentAnalysis,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const download = document.createElement('a');
  download.href = url;
  download.download = 'pilar-cenario-experimental.json';
  document.body.append(download);
  download.click();
  download.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('Cenário, hipóteses e resultados exportados em JSON.');
});

printButton.addEventListener('click', () => {
  if (dirty && !updateAnalysis()) return;
  if (!currentAnalysis) return;
  window.print();
});

// Browser print shortcuts also need the inputs and displayed results to agree.
window.addEventListener('beforeprint', () => {
  if (dirty) updateAnalysis();
  document.querySelector('.method-panel details').open = true;
});

updateAnalysis();
