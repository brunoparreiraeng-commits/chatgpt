const SVG_NS = 'http://www.w3.org/2000/svg';
const PLOT = Object.freeze({ x: 72, y: 28, width: 596, height: 298 });
const COLORS = Object.freeze({ curve: '#2570b3', inside: '#087f82', outside: '#bd433b', grid: '#e3eaf0', axis: '#8397a5', text: '#526b7d', euler: '#aa7319' });
const format = (value, digits = 2) => Number.isFinite(value)
  ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(Math.abs(value) < 1e-10 ? 0 : value)
  : '—';

function svgElement(tag, attributes = {}, text) {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function validMoment(point) {
  return point && Number.isFinite(point.mxKnm) && Number.isFinite(point.myKnm);
}

function tickStep(span) {
  const raw = span / 5;
  const exponent = 10 ** Math.floor(Math.log10(raw || 1));
  const ratio = raw / exponent;
  return exponent * (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10);
}

/** Horizontal axis: My; vertical axis: Mx. Moments passed to the callback are
 * already design demands; the caller owns any conversion to original loads. */
export function createInteractionChart(container, { onDemandChange } = {}) {
  if (!container || typeof container.replaceChildren !== 'function') {
    throw new TypeError('O contêiner do gráfico de interação não foi encontrado.');
  }

  const root = element('div', 'interaction-chart');
  const controls = element('div', 'chart-controls');
  const instructions = element('p', 'chart-instructions', 'Clique ou arraste para ajustar os momentos. Use as setas com o gráfico em foco; Shift aumenta o passo. Role para ampliar.');
  const resetButton = element('button', 'icon-button chart-reset-view', 'Restaurar vista');
  resetButton.id = 'chart-reset-view';
  resetButton.type = 'button';
  resetButton.setAttribute('aria-label', 'Restaurar a escala inicial do gráfico');
  controls.append(instructions, resetButton);
  const canvas = element('div', 'chart-canvas');
  canvas.style.position = 'relative';
  const svg = svgElement('svg', {
    viewBox: '0 0 700 400', class: 'chart-svg', tabindex: 0,
    role: 'img', 'aria-label': 'Diagrama de interação: My no eixo horizontal e Mx no eixo vertical, em quilonewton-metro. Clique ou use as setas para ajustar a demanda.',
    preserveAspectRatio: 'xMidYMid meet',
  });
  svg.style.width = '100%';
  svg.style.height = 'auto';
  svg.style.display = 'block';
  svg.style.touchAction = 'none';
  const tooltip = element('div', 'chart-tooltip');
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'status');
  tooltip.style.position = 'absolute';
  tooltip.style.pointerEvents = 'none';
  const legend = element('div', 'chart-legend');
  const stateLabel = element('p', 'chart-state');
  stateLabel.setAttribute('aria-live', 'polite');
  canvas.append(svg, tooltip);
  root.append(controls, canvas, legend, stateLabel);
  container.replaceChildren(root);

  let current = null;
  let contour = [];
  let demand = null;
  let eulerDemand = null;
  let enabled = false;
  let baseView = { centerMy: 0, centerMx: 0, unitsPerPixel: 1 };
  let view = { ...baseView };
  let zoom = 1;
  let dragging = null;
  let preview = null;
  let lastExtentKey = null;
  let markerGroup = null;
  let hoverGroup = null;

  function project(point) {
    return {
      x: PLOT.x + PLOT.width / 2 + (point.myKnm - view.centerMy) / view.unitsPerPixel,
      y: PLOT.y + PLOT.height / 2 - (point.mxKnm - view.centerMx) / view.unitsPerPixel,
    };
  }

  function unproject(point) {
    return {
      myKnm: view.centerMy + (point.x - PLOT.x - PLOT.width / 2) * view.unitsPerPixel,
      mxKnm: view.centerMx - (point.y - PLOT.y - PLOT.height / 2) * view.unitsPerPixel,
    };
  }

  function pointerPosition(event) {
    // getScreenCTM also accounts for the viewBox letterboxing and CSS scaling.
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    try { return point.matrixTransform(matrix.inverse()); } catch { return null; }
  }

  function inPlot(point) {
    return point && point.x >= PLOT.x && point.x <= PLOT.x + PLOT.width
      && point.y >= PLOT.y && point.y <= PLOT.y + PLOT.height;
  }

  function clampToPlot(point) {
    return { x: Math.min(PLOT.x + PLOT.width, Math.max(PLOT.x, point.x)), y: Math.min(PLOT.y + PLOT.height, Math.max(PLOT.y, point.y)) };
  }

  function hideHover() {
    tooltip.hidden = true;
    hoverGroup?.replaceChildren();
  }

  function fitView() {
    const data = [...contour, ...(validMoment(demand) ? [demand] : []), ...(validMoment(eulerDemand) ? [eulerDemand] : [])];
    let maxMy = 0;
    let maxMx = 0;
    for (const point of data) {
      maxMy = Math.max(maxMy, Math.abs(point.myKnm));
      maxMx = Math.max(maxMx, Math.abs(point.mxKnm));
    }
    const scale = Math.max(maxMy / (PLOT.width / 2), maxMx / (PLOT.height / 2));
    baseView = { centerMy: 0, centerMx: 0, unitsPerPixel: scale > 0 ? scale * 1.2 : 2 / PLOT.height };
  }

  function addLegend(text, color, shape = 'line') {
    const item = element('span', 'chart-legend-item');
    const sample = svgElement('svg', { width: 22, height: 14, viewBox: '0 0 22 14', 'aria-hidden': 'true' });
    if (shape === 'diamond') sample.append(svgElement('path', { d: 'M11 2 L16 7 L11 12 L6 7 Z', fill: 'none', stroke: color, 'stroke-width': 2 }));
    else if (shape === 'point') sample.append(svgElement('circle', { cx: 11, cy: 7, r: 4, fill: color }));
    else sample.append(svgElement('line', { x1: 2, y1: 7, x2: 20, y2: 7, stroke: color, 'stroke-width': 2.5 }));
    item.append(sample, document.createTextNode(text));
    legend.append(item);
  }

  function drawMarker(group, point, color, kind, titleText) {
    const position = project(point);
    if (!inPlot(position)) return;
    const marker = kind === 'diamond'
      ? svgElement('path', { d: `M${position.x} ${position.y - 7}L${position.x + 7} ${position.y}L${position.x} ${position.y + 7}L${position.x - 7} ${position.y}Z`, fill: '#ffffff', stroke: color, 'stroke-width': 2.3 })
      : svgElement('circle', { cx: position.x, cy: position.y, r: 6.5, fill: color, stroke: '#ffffff', 'stroke-width': 2.2 });
    marker.append(svgElement('title', {}, titleText));
    group.append(marker);
  }

  function drawMarkers() {
    markerGroup?.replaceChildren();
    if (!markerGroup) return;
    const activeDemand = preview || demand;
    if (validMoment(eulerDemand)) drawMarker(markerGroup, eulerDemand, COLORS.euler, 'diamond', `Demanda com amplificação de Euler: Mx ${format(eulerDemand.mxKnm)}; My ${format(eulerDemand.myKnm)} kN·m.`);
    if (validMoment(activeDemand)) {
      const color = preview ? COLORS.text : current?.demand?.inside === false ? COLORS.outside : current?.demand?.inside === true ? COLORS.inside : COLORS.text;
      drawMarker(markerGroup, activeDemand, color, 'circle', `Demanda: Mx ${format(activeDemand.mxKnm)}; My ${format(activeDemand.myKnm)} kN·m.`);
    }
  }

  function draw() {
    hideHover();
    svg.dataset.zoom = String(zoom);
    svg.replaceChildren(svgElement('title', {}, 'Diagrama de interação Mx–My para a força normal informada'));
    const defs = svgElement('defs');
    const clip = svgElement('clipPath', { id: 'interaction-plot-clip' });
    clip.append(svgElement('rect', { x: PLOT.x, y: PLOT.y, width: PLOT.width, height: PLOT.height }));
    defs.append(clip);
    svg.append(defs, svgElement('rect', { x: PLOT.x, y: PLOT.y, width: PLOT.width, height: PLOT.height, fill: '#fbfdff', stroke: COLORS.grid }));
    const minMy = view.centerMy - PLOT.width / 2 * view.unitsPerPixel;
    const maxMy = view.centerMy + PLOT.width / 2 * view.unitsPerPixel;
    const minMx = view.centerMx - PLOT.height / 2 * view.unitsPerPixel;
    const maxMx = view.centerMx + PLOT.height / 2 * view.unitsPerPixel;
    const step = tickStep(Math.max(maxMy - minMy, maxMx - minMx));
    const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
    for (let value = Math.ceil(minMy / step) * step, count = 0; value <= maxMy + step * 1e-8 && count < 50; value += step, count++) {
      const x = project({ myKnm: value, mxKnm: 0 }).x;
      svg.append(svgElement('line', { x1: x, y1: PLOT.y, x2: x, y2: PLOT.y + PLOT.height, stroke: COLORS.grid }));
      svg.append(svgElement('text', { x, y: PLOT.y + PLOT.height + 20, 'text-anchor': 'middle', 'font-size': 11, fill: COLORS.text }, format(value, decimals)));
    }
    for (let value = Math.ceil(minMx / step) * step, count = 0; value <= maxMx + step * 1e-8 && count < 50; value += step, count++) {
      const y = project({ myKnm: 0, mxKnm: value }).y;
      svg.append(svgElement('line', { x1: PLOT.x, y1: y, x2: PLOT.x + PLOT.width, y2: y, stroke: COLORS.grid }));
      svg.append(svgElement('text', { x: PLOT.x - 10, y: y + 4, 'text-anchor': 'end', 'font-size': 11, fill: COLORS.text }, format(value, decimals)));
    }
    const origin = project({ myKnm: 0, mxKnm: 0 });
    if (origin.x >= PLOT.x && origin.x <= PLOT.x + PLOT.width) svg.append(svgElement('line', { x1: origin.x, y1: PLOT.y, x2: origin.x, y2: PLOT.y + PLOT.height, stroke: COLORS.axis, 'stroke-width': 1.2 }));
    if (origin.y >= PLOT.y && origin.y <= PLOT.y + PLOT.height) svg.append(svgElement('line', { x1: PLOT.x, y1: origin.y, x2: PLOT.x + PLOT.width, y2: origin.y, stroke: COLORS.axis, 'stroke-width': 1.2 }));
    svg.append(svgElement('text', { x: PLOT.x + PLOT.width / 2, y: 378, 'text-anchor': 'middle', 'font-size': 13, fill: COLORS.text }, 'My (kN·m)'));
    svg.append(svgElement('text', { x: 20, y: PLOT.y + PLOT.height / 2, transform: `rotate(-90 20 ${PLOT.y + PLOT.height / 2})`, 'text-anchor': 'middle', 'font-size': 13, fill: COLORS.text }, 'Mx (kN·m)'));
    if (enabled) {
      const path = contour.map((point, index) => {
        const { x, y } = project(point);
        return `${index ? 'L' : 'M'}${x} ${y}`;
      }).join(' ') + ' Z';
      svg.append(svgElement('path', { d: path, class: 'chart-contour', 'clip-path': 'url(#interaction-plot-clip)', fill: '#2570b31a', stroke: COLORS.curve, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
    } else {
      const message = !current ? 'Informe dados válidos para calcular o contorno.'
        : current.interaction?.status === 'axial-out-of-range' ? 'Força normal fora do intervalo do modelo.'
          : 'Contorno indisponível para estes dados.';
      svg.append(svgElement('text', { x: PLOT.x + PLOT.width / 2, y: PLOT.y + PLOT.height / 2 - 12, 'text-anchor': 'middle', 'font-size': 13, fill: COLORS.text }, message));
    }
    markerGroup = svgElement('g', { class: 'chart-markers', 'clip-path': 'url(#interaction-plot-clip)' });
    hoverGroup = svgElement('g', { class: 'chart-crosshair', 'pointer-events': 'none', 'clip-path': 'url(#interaction-plot-clip)' });
    svg.append(markerGroup, hoverGroup);
    drawMarkers();
    resetButton.disabled = !enabled;
  }

  function showNearest(event, position) {
    if (!enabled || !inPlot(position)) return hideHover();
    let nearest = null;
    let shortest = Infinity;
    for (const point of contour) {
      const screen = project(point);
      const distance = (position.x - screen.x) ** 2 + (position.y - screen.y) ** 2;
      if (distance < shortest) { nearest = point; shortest = distance; }
    }
    if (!nearest) return hideHover();
    const target = project(nearest);
    hoverGroup.replaceChildren(
      svgElement('line', { x1: PLOT.x, y1: target.y, x2: PLOT.x + PLOT.width, y2: target.y, stroke: COLORS.curve, 'stroke-dasharray': '3 4', opacity: .5 }),
      svgElement('line', { x1: target.x, y1: PLOT.y, x2: target.x, y2: PLOT.y + PLOT.height, stroke: COLORS.curve, 'stroke-dasharray': '3 4', opacity: .5 }),
      svgElement('circle', { cx: target.x, cy: target.y, r: 4, stroke: COLORS.curve, fill: '#ffffff', 'stroke-width': 2 }),
    );
    const axial = nearest.nKn ?? current.interaction?.nKn;
    tooltip.textContent = `Contorno: Mx ${format(nearest.mxKnm)} kN·m · My ${format(nearest.myKnm)} kN·m · c ${Number.isFinite(nearest.neutralAxisCm) ? `${format(nearest.neutralAxisCm)} cm` : '—'} · N ${format(axial)} kN`;
    const bounds = canvas.getBoundingClientRect();
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(4, Math.min(event.clientX - bounds.left + 12, bounds.width - tooltip.offsetWidth - 4))}px`;
    tooltip.style.top = `${Math.max(4, Math.min(event.clientY - bounds.top + 12, bounds.height - tooltip.offsetHeight - 4))}px`;
  }

  function publishDemand(point) {
    if (!validMoment(point) || typeof onDemandChange !== 'function') return;
    // Preserve precision without leaking floating-point display noise into inputs.
    onDemandChange({ mxKnm: Number(point.mxKnm.toPrecision(12)), myKnm: Number(point.myKnm.toPrecision(12)) });
  }

  svg.addEventListener('pointerdown', (event) => {
    const position = pointerPosition(event);
    if (!enabled || !inPlot(position) || (event.button !== 0 && event.pointerType === 'mouse')) return;
    event.preventDefault();
    svg.focus({ preventScroll: true });
    dragging = event.pointerId;
    preview = unproject(position);
    hideHover();
    svg.setPointerCapture?.(event.pointerId);
    drawMarkers();
  });
  svg.addEventListener('pointermove', (event) => {
    const position = pointerPosition(event);
    if (dragging === event.pointerId && position) {
      preview = unproject(clampToPlot(position));
      drawMarkers();
    } else if (position) showNearest(event, position);
  });
  svg.addEventListener('pointerup', (event) => {
    if (dragging !== event.pointerId) return;
    const position = pointerPosition(event);
    const selected = position ? unproject(clampToPlot(position)) : preview;
    dragging = null;
    preview = null;
    if (svg.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    publishDemand(selected);
    drawMarkers();
  });
  svg.addEventListener('pointercancel', () => { dragging = null; preview = null; hideHover(); drawMarkers(); });
  svg.addEventListener('lostpointercapture', () => { if (dragging !== null) { dragging = null; preview = null; drawMarkers(); } });
  svg.addEventListener('pointerleave', () => { if (dragging === null) hideHover(); });
  svg.addEventListener('blur', hideHover);
  svg.addEventListener('wheel', (event) => {
    const position = pointerPosition(event);
    if (!enabled || !inPlot(position)) return;
    event.preventDefault();
    const anchor = unproject(position);
    const nextZoom = Math.min(30, Math.max(.25, zoom * Math.exp(-Math.sign(event.deltaY) * .18)));
    if (nextZoom === zoom) return;
    zoom = nextZoom;
    view.unitsPerPixel = baseView.unitsPerPixel / zoom;
    view.centerMy = anchor.myKnm - (position.x - PLOT.x - PLOT.width / 2) * view.unitsPerPixel;
    view.centerMx = anchor.mxKnm + (position.y - PLOT.y - PLOT.height / 2) * view.unitsPerPixel;
    draw();
  }, { passive: false });
  svg.addEventListener('keydown', (event) => {
    if (!enabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const next = validMoment(demand) ? { ...demand } : { mxKnm: 0, myKnm: 0 };
    const step = view.unitsPerPixel * PLOT.height * .01 * (event.shiftKey ? 10 : 1);
    if (event.key === 'ArrowLeft') next.myKnm -= step;
    if (event.key === 'ArrowRight') next.myKnm += step;
    if (event.key === 'ArrowUp') next.mxKnm += step;
    if (event.key === 'ArrowDown') next.mxKnm -= step;
    publishDemand(next);
  });

  function resetView() {
    fitView();
    zoom = 1;
    view = { ...baseView };
    draw();
  }
  resetButton.addEventListener('click', resetView);

  function render(sectionResult, { eulerDemand: nextEuler = null } = {}) {
    current = sectionResult || null;
    contour = current?.interaction?.status === 'ok' && Array.isArray(current.interaction.points)
      ? current.interaction.points.filter(validMoment) : [];
    enabled = contour.length >= 3;
    demand = validMoment(current?.demand) ? current.demand : null;
    eulerDemand = current && validMoment(nextEuler) ? nextEuler : null;
    preview = null;
    dragging = null;
    const extentKey = contour.map(({ mxKnm, myKnm }) => `${mxKnm},${myKnm}`).join(';');
    const changedContour = extentKey !== lastExtentKey;
    lastExtentKey = extentKey;
    if (changedContour || !enabled) {
      fitView();
      view = { ...baseView };
      zoom = 1;
    } else if (zoom === 1) {
      // A new load outside the current extent still belongs in the initial view.
      fitView();
      view = { ...baseView };
    }
    legend.replaceChildren();
    if (enabled) addLegend('Contorno da seção calculada', COLORS.curve);
    if (demand) addLegend('Demanda informada', current.demand.inside === false ? COLORS.outside : current.demand.inside === true ? COLORS.inside : COLORS.text, 'point');
    if (eulerDemand) addLegend('Demanda amplificada pelo modelo de Euler', COLORS.euler, 'diamond');
    stateLabel.textContent = !current ? 'Gráfico aguardando dados válidos.'
      : !enabled ? current.interaction?.status === 'axial-out-of-range' ? 'Não há contorno para esta força normal no intervalo do modelo.' : 'Não foi possível gerar um contorno válido.'
        : `N = ${format(current.interaction.nKn)} kN. Demanda: Mx = ${format(demand?.mxKnm)} kN·m; My = ${format(demand?.myKnm)} kN·m. ${current.demand?.inside === true ? 'Demanda dentro do contorno calculado.' : current.demand?.inside === false ? 'Demanda fora do contorno calculado.' : 'Posição da demanda não definida.'}`;
    draw();
  }

  render(null);
  return { render, resetView };
}
