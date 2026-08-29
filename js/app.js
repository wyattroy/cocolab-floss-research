/**
 * app.js — boots the gate, then the map and the written report beneath it.
 *
 * The graph is the argument; the report is the receipt. Every insight exists
 * in both, backed by the same decrypted object, so nothing is only reachable
 * through WebGL.
 */

import { initGate } from './gate.js';
import { initScene, initScatter2D, hasWebGL, quadrantOf, evidenceLabel } from './scene.js';

let DATA = null;
let VIZ = null;
let ORDER = [];          // insight ids in report order — drives panel prev/next
let activeQuadrant = 'all';
let evidenceFloor = 0;

const $ = (id) => document.getElementById(id);
const byId = (id) => DATA.insights.find((i) => i.id === id);

// ─── Hero copy ────────────────────────────────────────────────────────────────
function renderHero() {
  const m = DATA.meta;
  $('hero-eyebrow').textContent = `${m.round} · n=${m.n}`;
  $('hero-headline').textContent = m.headline;
  $('hero-standfirst').textContent = m.standfirst;
  $('nav-meta').textContent = `${DATA.insights.length} insights · ${m.n} participants`;
  document.title = `${m.client} — ${m.project}`;
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function countFor(qid) {
  return DATA.insights.filter(
    (i) =>
      (qid === 'all' || quadrantOf(i, DATA.quadrants).id === qid) &&
      i.axes.evidence >= evidenceFloor
  ).length;
}

function renderLegend() {
  const host = $('legend');
  host.innerHTML = '';

  const make = (id, label, color) => {
    const b = document.createElement('button');
    b.className = 'legend-chip' + (id === activeQuadrant ? ' is-active' : '');
    b.dataset.q = id;
    if (color) b.style.setProperty('--chip', color);
    b.innerHTML = `${label} <span class="legend-count">${countFor(id)}</span>`;
    b.addEventListener('click', () => setQuadrant(id === activeQuadrant ? 'all' : id));
    host.appendChild(b);
  };

  make('all', 'All');
  DATA.quadrants.forEach((q) => make(q.id, q.name, q.color));
}

function updateLegendCounts() {
  document.querySelectorAll('.legend-chip').forEach((chip) => {
    chip.querySelector('.legend-count').textContent = countFor(chip.dataset.q);
    chip.classList.toggle('is-active', chip.dataset.q === activeQuadrant);
  });
}

function setQuadrant(id) {
  activeQuadrant = id;
  VIZ.setQuadrant(id);
  updateLegendCounts();
  applyReportFilter();
}

// ─── Evidence floor ───────────────────────────────────────────────────────────
function evidenceFloorLabel(v) {
  if (v <= 0.01) return 'show all';
  if (v <= 0.45) return '≥ single voice';
  if (v <= 0.65) return '≥ two voices';
  if (v <= 0.85) return '≥ strong';
  return 'strongest only';
}

function initEvidenceSlider() {
  const slider = $('ev-slider');
  const out = $('ev-val');
  slider.addEventListener('input', () => {
    evidenceFloor = Number(slider.value) / 100;
    out.textContent = evidenceFloorLabel(evidenceFloor);
    VIZ.setEvidenceFloor(evidenceFloor);
    updateLegendCounts();
    applyReportFilter();
  });
}

// ─── Report ───────────────────────────────────────────────────────────────────
function renderAxisExplainers() {
  const host = $('axis-explainers');
  const a = DATA.axes;
  const blocks = [
    {
      h: 'Horizontal — in the hand ↔ in the world',
      body: [
        `<strong>${a.x.neg}.</strong> ${a.x.negBlurb}`,
        `<strong>${a.x.pos}.</strong> ${a.x.posBlurb}`,
      ],
    },
    {
      h: 'Vertical — function ↔ feeling',
      body: [
        `<strong>${a.y.neg}.</strong> ${a.y.negBlurb}`,
        `<strong>${a.y.pos}.</strong> ${a.y.posBlurb}`,
      ],
    },
    {
      h: 'Depth — how good is the evidence',
      body: [a.z.blurb],
    },
    {
      h: 'What the four groups are',
      body: [
        DATA.quadrants
          .map((q) => `<strong>${q.name}</strong> — ${q.sub.toLowerCase()}`)
          .join('. ') + '.',
      ],
    },
  ];
  host.innerHTML = blocks
    .map(
      (b) =>
        `<div class="axis-explainer"><h3>${b.h}</h3>${b.body
          .map((p) => `<p>${p}</p>`)
          .join('')}</div>`
    )
    .join('');
}

function renderReport() {
  const host = $('quadrant-sections');
  host.innerHTML = '';
  ORDER = [];

  DATA.quadrants.forEach((q) => {
    const items = DATA.insights
      .filter((i) => quadrantOf(i, DATA.quadrants).id === q.id)
      .sort((a, b) => b.axes.evidence - a.axes.evidence);

    const section = document.createElement('section');
    section.className = 'q-section';
    section.dataset.q = q.id;
    section.style.setProperty('--chip', q.color);

    const cards = items
      .map((i) => {
        ORDER.push(i.id);
        return `
          <button class="card" data-id="${i.id}">
            <span class="card-top">
              <span class="card-dot"></span>
              <span class="card-num">${String(i.n).padStart(2, '0')}</span>
              <span class="card-ev">${evidenceLabel(i)}</span>
            </span>
            <h3>${escapeHtml(i.title)}</h3>
            <p>${escapeHtml(i.takeaway)}</p>
            <span class="card-voices">${i.voices.join(' · ')}</span>
          </button>`;
      })
      .join('');

    section.innerHTML = `
      <div class="q-header">
        <span class="q-name">${q.name}</span>
        <span class="q-sub">${q.sub}</span>
        <span class="q-n">${items.length} insights</span>
      </div>
      <p class="q-thesis">${escapeHtml(q.thesis)}</p>
      <div class="card-grid">${cards}</div>`;

    host.appendChild(section);
  });

  host.querySelectorAll('.card').forEach((card) => {
    card.addEventListener('click', () => openPanel(card.dataset.id));
  });
}

function applyReportFilter() {
  document.querySelectorAll('.q-section').forEach((s) => {
    s.hidden = activeQuadrant !== 'all' && s.dataset.q !== activeQuadrant;
  });
  document.querySelectorAll('.card').forEach((c) => {
    c.hidden = byId(c.dataset.id).axes.evidence < evidenceFloor;
  });
}

// ─── Detail panel ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function meterRow(name, value, leftLabel, rightLabel) {
  const pct = Math.round(value * 100);
  const reading = value >= 0.5 ? rightLabel : leftLabel;
  return `
    <div class="p-meter-row">
      <span class="p-meter-name">${name}</span>
      <span class="p-meter-track"><span class="p-meter-fill" style="width:${pct}%"></span></span>
      <span class="p-meter-val">${reading}</span>
    </div>`;
}

function openPanel(id) {
  const i = byId(id);
  if (!i) return;
  const q = quadrantOf(i, DATA.quadrants);
  const panel = $('panel');
  const body = $('panel-body');

  panel.style.setProperty('--chip', q.color);
  body.innerHTML = `
    <div class="p-head">
      <span class="p-num">${String(i.n).padStart(2, '0')} / ${DATA.insights.length}</span>
      <span class="p-chip">${q.name}</span>
    </div>
    <h2 class="p-title">${escapeHtml(i.title)}</h2>
    <p class="p-takeaway">${escapeHtml(i.takeaway)}</p>

    <div class="p-meters">
      ${meterRow('Placement', i.axes.world, 'In the hand', 'In the world')}
      ${meterRow('Register', i.axes.feeling, 'Function', 'Feeling')}
      ${meterRow('Evidence', i.axes.evidence, evidenceLabel(i), evidenceLabel(i))}
    </div>

    <div class="p-section">
      <p class="p-label">In their words</p>
      ${i.quotes
        .map(
          (qt) =>
            `<p class="p-quote"><span class="p-quote-who">${escapeHtml(qt.who)}</span>${escapeHtml(qt.text)}</p>`
        )
        .join('')}
    </div>

    <div class="p-section">
      <p class="p-label">How strong is this</p>
      <p class="p-body">${escapeHtml(i.reading)}</p>
    </div>

    <div class="p-section p-sowhat">
      <p class="p-label">So what</p>
      <p class="p-body">${escapeHtml(i.soWhat)}</p>
    </div>

    <div class="p-section">
      <p class="p-label">Voices</p>
      <div class="p-voices">${i.voices.map((v) => `<span class="p-voice">${escapeHtml(v)}</span>`).join('')}</div>
    </div>`;

  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add('is-open'));
  body.scrollTop = 0;

  const idx = ORDER.indexOf(id);
  $('panel-pos').textContent = `${idx + 1} of ${ORDER.length}`;
  $('panel-prev').disabled = idx <= 0;
  $('panel-next').disabled = idx >= ORDER.length - 1;
  panel.dataset.id = id;

  VIZ.select(id);
  history.replaceState(null, '', `#${id}`);
}

function closePanel() {
  const panel = $('panel');
  panel.classList.remove('is-open');
  setTimeout(() => { panel.hidden = true; }, 400);
  VIZ.clearSelection();
  history.replaceState(null, '', location.pathname);
}

function stepPanel(delta) {
  const idx = ORDER.indexOf($('panel').dataset.id);
  const next = ORDER[idx + delta];
  if (next) openPanel(next);
}

function initPanel() {
  $('panel-close').addEventListener('click', closePanel);
  $('panel-prev').addEventListener('click', () => stepPanel(-1));
  $('panel-next').addEventListener('click', () => stepPanel(1));

  document.addEventListener('keydown', (e) => {
    if ($('panel').hidden) return;
    if (e.key === 'Escape') closePanel();
    if (e.key === 'ArrowLeft') stepPanel(-1);
    if (e.key === 'ArrowRight') stepPanel(1);
  });
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
function boot(data) {
  DATA = data;
  $('app').hidden = false;

  renderHero();
  renderAxisExplainers();
  renderReport();

  VIZ = hasWebGL()
    ? initScene(DATA, { onSelect: openPanel })
    : initScatter2D(DATA, { onSelect: openPanel });

  if (!hasWebGL()) {
    $('hero-hint').textContent = 'WebGL unavailable — showing the flat map';
    $('label-evidence').hidden = true;
  }

  renderLegend();
  initEvidenceSlider();
  initPanel();

  window.addEventListener('viz:interact', () => $('hero-intro').classList.add('is-faded'));

  $('btn-reset').addEventListener('click', () => {
    VIZ.reset();
    $('hero-intro').classList.remove('is-faded');
    setQuadrant('all');
    $('ev-slider').value = 0;
    evidenceFloor = 0;
    $('ev-val').textContent = 'show all';
    VIZ.setEvidenceFloor(0);
    updateLegendCounts();
    applyReportFilter();
  });

  // Deep link straight to an insight, e.g. …/#thickness
  const hash = location.hash.slice(1);
  if (hash && byId(hash)) setTimeout(() => openPanel(hash), 500);
}

initGate(boot);
