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
let voiceFloor = 1;   // minimum participants who said it: 1 = show all

const $ = (id) => document.getElementById(id);
const byId = (id) => DATA.insights.find((i) => i.id === id);

// ─── Hero copy ────────────────────────────────────────────────────────────────
// Portraits ship inside the encrypted payload as data URIs, so they are only
// available to someone who has the password — these are research participants'
// faces, and the repository itself is public.
async function loadAvatars(meta) {
  if (!meta || !meta.avatars) return null;
  // Load via onload rather than decode(): decode() can sit unresolved in some
  // environments, and this runs before the scene is built, so a hang here would
  // leave an unlocked page with nothing on it. Each portrait also gets its own
  // timeout — a missing face costs a solid disc, never the whole map.
  const pairs = await Promise.all(
    Object.entries(meta.avatars).map(async ([who, src]) => {
      const img = new Image();
      const settled = new Promise((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
      });
      img.src = src;
      const ok = await Promise.race([
        settled,
        new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      return ok ? [who, img] : null;
    })
  );
  return Object.fromEntries(pairs.filter(Boolean));
}

function renderHero() {
  const m = DATA.meta;
  $('hero-eyebrow').textContent = `${m.round} · n=${m.n}`;
  $('hero-headline').textContent = m.headline;
  $('hero-standfirst').textContent = m.standfirst;
  $('nav-meta').textContent = `${DATA.insights.length} insights · ${m.n} participants`;
  // The client's name lives only in the encrypted payload, so it appears in the
  // markup and the tab title only once someone has actually unlocked the page.
  $('nav-logo').innerHTML =
    `${m.client} <span class="nav-sep">/</span> Floss Pick Research`;
  $('foot-line').textContent = `${m.client} · ${m.project} · ${m.round}`;
  document.title = `${m.client} — ${m.project}`;
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function countFor(qid) {
  return DATA.insights.filter(
    (i) =>
      (qid === 'all' || quadrantOf(i, DATA.quadrants).id === qid) &&
      i.voices.length >= voiceFloor
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
// The slider culls by how many participants actually said a thing, which is a
// claim the reader can check against the quotes. It deliberately does NOT use
// axes.evidence: that score also carries how strongly a finding was held, so
// the 1-, 2- and 3-voice score ranges overlap (a 1-voice finding reaches 0.70,
// a 2-voice one starts at 0.68) and no threshold on it could honestly be
// labeled "2 voices". Depth in the 3D view still shows the finer score.
const VOICE_FLOOR_LABELS = { 1: 'show all', 2: '≥ 2 voices', 3: 'all 3 voices' };

function initEvidenceSlider() {
  const slider = $('ev-slider');
  const out = $('ev-val');
  slider.addEventListener('input', () => {
    voiceFloor = Number(slider.value);
    out.textContent = VOICE_FLOOR_LABELS[voiceFloor];
    VIZ.setVoiceFloor(voiceFloor);
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
      h: 'Depth — how many people raised it',
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
    c.hidden = byId(c.dataset.id).voices.length < voiceFloor;
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
      <p class="p-label">Worth discussing</p>
      <p class="p-body">${escapeHtml(i.soWhat)}</p>
    </div>

    <div class="p-section">
      <p class="p-label">Voices</p>
      <div class="p-voices">${i.voices.map((v) => `<span class="p-voice">${escapeHtml(v)}</span>`).join('')}</div>
    </div>`;

  panel.hidden = false;
  // Force a reflow so the browser has a start value for the slide-in transform.
  // Deferring this to requestAnimationFrame instead ties the panel's opening to
  // the frame rate, and it visibly lags on a throttled or slow device.
  void panel.offsetWidth;
  panel.classList.add('is-open');
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
async function boot(data) {
  DATA = data;
  $('app').hidden = false;

  renderHero();
  renderAxisExplainers();
  renderReport();

  // Card faces are drawn into a 2D canvas, so their type is measured with
  // whatever font is available at that instant. Building them before the
  // webfonts land would fit every title against the Georgia fallback and bake
  // the wrong size into the textures. Wait for the fonts — but never
  // indefinitely, because one that fails to load must not cost us the map.
  // `document.fonts.ready` alone is not enough: a webfont is only fetched when
  // something needs it, and canvas measureText does not count as needing it.
  // Ask for these two faces explicitly, then wait for the set to settle.
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('400 100px "Source Serif 4"'),
        document.fonts.load('500 34px "DM Mono"'),
      ]).then(() => document.fonts.ready),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch {
    // Fonts are a nicety. If they fail, the fit is still measured with whatever
    // font actually resolves — the same one used to draw — so nothing overflows.
  }

  const avatars = await loadAvatars(DATA.meta);

  VIZ = hasWebGL()
    ? initScene(DATA, { onSelect: openPanel, avatars })
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
    $('ev-slider').value = 1;
    voiceFloor = 1;
    $('ev-val').textContent = VOICE_FLOOR_LABELS[1];
    VIZ.setVoiceFloor(1);
    updateLegendCounts();
    applyReportFilter();
  });

  // Deep link straight to an insight, e.g. …/#thickness
  const hash = location.hash.slice(1);
  if (hash && byId(hash)) setTimeout(() => openPanel(hash), 500);
}

initGate(boot);
