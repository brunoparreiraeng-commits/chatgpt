import { analyzeColumn, InputValidationError } from './analysis.js';
import { analyzeSection, SectionValidationError } from './section.js';
import { createInteractionChart } from './chart.js';

const MODEL_VERSION = '1.1.0';
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
  fckMpa: 30,
  fykMpa: 500,
  gammaC: 1.4,
  gammaS: 1.15,
  esGPa: 200,
  coverCm: 2.5,
  barDiameterMm: 10,
  barsX: 2,
  barsY: 3,
});
const SECTION_RESOLUTION = Object.freeze({ points: 72, mesh: 36 });

const form = document.querySelector('#column-form');
const results = document.querySelector('#results');
const status = document.querySelector('#status');
const formError = document.querySelector('#form-error');
const formState = document.querySelector('#form-state');
const exportButton = document.querySelector('#export-button');
const printButton = document.querySelector('#print-button');
const sectionStatus = document.querySelector('#section-status');
const eulerMarkerCheckbox = document.querySelector('#show-euler-marker');
let currentAnalysis = null;
let dirty = false;
let notificationTimer;
const chart = createInteractionChart(document.querySelector('#interaction-chart'), {
  onDemandChange: ({ mxKnm, myKnm }) => {
    const factor = Number(form.elements.namedItem('loadFactor').value);
    if (!Number.isFinite(factor) || factor <= 0) return;
    form.elements.namedItem('mxKnm').value = String(Number((mxKnm / factor).toPrecision(12)));
    form.elements.namedItem('myKnm').value = String(Number((myKnm / factor).toPrecision(12)));
    if (updateAnalysis()) notify('Momentos atualizados pelo gráfico.');
  },
});

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

function renderGeometry(result, reinforcedSection) {
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
  const barGroup = document.getElementById('section-bars');
  barGroup.replaceChildren();
  const drawingScale = 145 / maxDimension;
  for (const bar of reinforcedSection?.reinforcement?.bars || []) {
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', 105 + bar.xCm * drawingScale);
    dot.setAttribute('cy', 116 - bar.yCm * drawingScale);
    dot.setAttribute('r', Math.max(1.7, reinforcedSection.input.barDiameterMm / 20 * drawingScale));
    dot.setAttribute('class', 'reinforcement-bar');
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `Barra: x ${number(bar.xCm, 2)} cm; y ${number(bar.yCm, 2)} cm; As ${number(bar.areaCm2, 3)} cm²`;
    dot.append(title);
    barGroup.append(dot);
  }
}

function renderSection(sectionResult) {
  const { materials, reinforcement, interaction, demand, input } = sectionResult;
  setText('reinforcement-area', `${number(reinforcement.areaCm2, 2)} cm²`);
  setText('reinforcement-count', `${reinforcement.count} barras φ${number(input.barDiameterMm, 0)} mm`);
  setText('reinforcement-ratio', `${number(reinforcement.ratioPercent, 2)} %`);
  setText('design-materials', `${number(materials.fcdMpa, 2)} / ${number(materials.fydMpa, 2)} MPa`);
  setText('concrete-peak', `Pico do concreto: ${number(materials.concretePeakMpa, 2)} MPa`);
  sectionStatus.className = 'section-status';
  if (interaction.status === 'axial-out-of-range') {
    sectionStatus.classList.add('is-warning');
    sectionStatus.textContent = `N = ${number(interaction.nKn, 2)} kN está fora do intervalo axial deste modelo de seção (${number(interaction.axialRange.minKn, 2)} a ${number(interaction.axialRange.maxKn, 2)} kN). O contorno não é gerado.`;
  } else if (interaction.status !== 'ok') {
    sectionStatus.classList.add('is-warning');
    sectionStatus.textContent = 'O contorno da seção é degenerado ou não pode ser comparado para estes parâmetros. Nenhuma conclusão sobre o pilar é obtida.';
  } else if (demand.inside === false) {
    sectionStatus.classList.add('is-critical');
    sectionStatus.textContent = `N = ${number(interaction.nKn, 2)} kN · ponto de primeira ordem fora do contorno calculado da seção. Esta comparação não é uma verificação global do pilar.`;
  } else if (demand.inside === true) {
    sectionStatus.textContent = `N = ${number(interaction.nKn, 2)} kN · ponto de primeira ordem dentro do contorno deste modelo simplificado de seção. Isso não verifica estabilidade global ou adequação para uma obra.`;
  } else {
    sectionStatus.classList.add('is-warning');
    sectionStatus.textContent = `Contorno calculado para N = ${number(interaction.nKn, 2)} kN. A posição da demanda não foi comparada.`;
  }
}

function renderChart(analysis = currentAnalysis) {
  if (!analysis) {
    chart.render(null);
    eulerMarkerCheckbox.disabled = true;
    setText('euler-marker-note', 'Atualize a análise para usar o gráfico.');
    return;
  }
  const xMoment = analysis.axes.x.amplifiedMomentKnm;
  const yMoment = analysis.axes.y.amplifiedMomentKnm;
  const eulerDefined = Number.isFinite(xMoment) && xMoment !== null && Number.isFinite(yMoment) && yMoment !== null;
  eulerMarkerCheckbox.disabled = !eulerDefined;
  setText('euler-marker-note', eulerDefined ? 'Hipótese ideal; não é análise global de segunda ordem.' : 'Amplificação de Euler indefinida para esta carga.');
  chart.render(analysis.reinforcedSection, {
    eulerDemand: eulerDefined && eulerMarkerCheckbox.checked ? { mxKnm: xMoment, myKnm: yMoment } : null,
  });
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

function renderNotes(result, sectionResult) {
  const notes = document.getElementById('model-notes');
  notes.replaceChildren();
  for (const note of result.notes || []) {
    const element = document.createElement('li');
    element.textContent = `Módulo elástico: ${typeof note === 'string' ? note : String(note.message || note)}`;
    notes.append(element);
  }
  for (const note of sectionResult.notes || []) {
    const element = document.createElement('li');
    element.textContent = `Modelo da seção: ${typeof note === 'string' ? note : String(note.message || note)}`;
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
  if (!form.reportValidity()) {
    dirty = true;
    results.setAttribute('data-stale', 'true');
    formState.classList.add('is-dirty');
    formState.textContent = 'Corrija as entradas inválidas e atualize a análise.';
    status.className = 'analysis-status is-warning';
    status.textContent = 'Análise não atualizada: existem entradas inválidas. Os números anteriores não representam este formulário.';
    sectionStatus.className = 'section-status is-warning';
    sectionStatus.textContent = 'Corrija as entradas para gerar um novo contorno.';
    renderChart(null);
    exportButton.disabled = true;
    printButton.disabled = true;
    return false;
  }
  results.setAttribute('aria-busy', 'true');
  formError.hidden = true;
  try {
    const input = readInput();
    const analysis = analyzeColumn(input);
    const reinforcedSection = analyzeSection({
      bxCm: input.bxCm, byCm: input.byCm,
      fckMpa: input.fckMpa, fykMpa: input.fykMpa,
      gammaC: input.gammaC, gammaS: input.gammaS,
      esGPa: input.esGPa, coverCm: input.coverCm,
      barDiameterMm: input.barDiameterMm,
      barsX: input.barsX, barsY: input.barsY,
      ...analysis.loads, ...SECTION_RESOLUTION,
    });
    renderGeometry(analysis, reinforcedSection);
    renderAxes(analysis);
    renderStress(analysis);
    renderSection(reinforcedSection);
    renderNotes(analysis, reinforcedSection);
    displayStatus(analysis);
    currentAnalysis = { ...analysis, input: { ...input }, reinforcedSection };
    renderChart();
    setClean();
    return true;
  } catch (error) {
    const message = error instanceof InputValidationError || error instanceof SectionValidationError
      ? error.message
      : 'Não foi possível concluir a análise. Revise as entradas e tente novamente.';
    formError.textContent = message;
    formError.hidden = false;
    results.setAttribute('data-stale', 'true');
    status.className = 'analysis-status is-error';
    status.textContent = `Análise não atualizada. ${message}`;
    sectionStatus.className = 'section-status is-warning';
    sectionStatus.textContent = 'Dados inválidos: o contorno foi removido. Revise materiais e configuração das barras.';
    renderChart(null);
    for (const id of ['reinforcement-area', 'reinforcement-count', 'reinforcement-ratio', 'design-materials', 'concrete-peak']) setText(id, '—');
    document.getElementById('section-bars').replaceChildren();
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
  sectionStatus.className = 'section-status is-warning';
  sectionStatus.textContent = 'Entradas alteradas. Atualize a análise para recalcular o contorno e os esforços.';
  renderChart(null);
});

document.getElementById('reset-button').addEventListener('click', () => {
  for (const [key, value] of Object.entries(DEFAULT_INPUT)) form.elements.namedItem(key).value = String(value);
  updateAnalysis();
  notify('Cenário restaurado: 9 × 30 cm e 6 m livres, sem esforços informados.');
});

document.getElementById('example-button').addEventListener('click', () => {
  const example = { ...DEFAULT_INPUT, bxCm: 40, byCm: 40, lengthXM: 8, lengthYM: 8, coverCm: 5, barDiameterMm: 20, barsX: 4, barsY: 4, nKn: 3000 };
  for (const [key, value] of Object.entries(example)) form.elements.namedItem(key).value = String(value);
  eulerMarkerCheckbox.checked = false;
  updateAnalysis();
  chart.resetView();
  notify('Exemplo de demonstração carregado: 40 × 40 cm, 12 barras φ20 e N = 3.000 kN.');
});

eulerMarkerCheckbox.addEventListener('change', () => {
  if (!dirty) renderChart();
});

exportButton.addEventListener('click', () => {
  if (dirty && !updateAnalysis()) return;
  if (!currentAnalysis) return;
  const exportData = {
    application: 'Pilar · Laboratório elástico',
    version: MODEL_VERSION,
    generatedAt: new Date().toISOString(),
    model: {
      label: 'Modelo experimental de seção de concreto armado e barra elástica ideal',
      normativeVerification: false,
      dimensionalGammaNApplied: false,
      interpretation: 'O contorno representa a seção simplificada para N fixo. Euler representa estabilidade de uma barra ideal. Nenhum dos resultados constitui dimensionamento completo ou adequação para uma obra.',
      sectionAssumptions: {
        concrete: 'Parábola–retângulo; pico 0,85 fck/γc; concreto tracionado desprezado.',
        steel: 'Barras periféricas, comportamento elastoplástico e tensão limite fyk/γs.',
        coverDefinition: 'Distância da face ao centro das barras; não representa cobrimento nominal.',
        discretization: SECTION_RESOLUTION,
        demands: 'N, Mx e My após multiplicador de ações; curva comparada com primeira ordem.',
      },
      limitations: ['fluência', 'imperfeições', 'detalhamento de armaduras', 'estribos', 'conexões', 'análise global não linear', 'interação com a estrutura', 'verificações normativas'],
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
  document.querySelectorAll('.input-details').forEach((element) => { element.open = true; });
});

updateAnalysis();
