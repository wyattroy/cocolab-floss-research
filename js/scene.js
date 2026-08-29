/**
 * scene.js — the 2×2×2 insight map.
 *
 * Adapted from the 3D project graph on wyattroy.com: same spring-driven orbit
 * and zoom, same HTML-labels-projected-onto-a-WebGL-canvas trick, same warm
 * white ground. The differences are that the third axis carries evidence
 * strength rather than time, and each tile draws its own face (number, title,
 * evidence dots) so the map is readable at rest instead of only on hover.
 *
 *   x  in the hand  ←→  in the world
 *   y  function     ←→  feeling
 *   z  emerging     ←→  proven   (proven sits closer to the viewer)
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ─── Layout ───────────────────────────────────────────────────────────────────
const R = 5.5;        // half-extent of the x/y plane
const Z_EMERGING = -6;
const Z_PROVEN = 6;

const TILE_W = 1.95;
const TILE_H = 1.18;
const TILE_D = 0.07;

// ─── Camera / interaction feel ────────────────────────────────────────────────
const CAM_ZOOM_MIN = 0.62;  // multiplier on the fit distance when zoomed all the way in
const CAM_ZOOM_MAX = 1.97;  // ...and all the way out
const CAM_START_FRAC = 0.36;

// The map opens slightly off-axis. Face-on, a 2x2x2 looks exactly like a 2x2 —
// the third axis only becomes visible once there is some parallax.
const START_THETA = -0.26;
const START_PHI = 0.11;
const CAM_TARGET = new THREE.Vector3(0, 0, 0);

const ZOOM_WHEEL_SPEED = 0.022;
const ZOOM_PINCH_SPEED = 0.05;
const ZOOM_STIFFNESS = 0.18;
const ZOOM_DAMPING = 0.62;

const DRAG_MAX_H = (52 * Math.PI) / 180;
const DRAG_MAX_V = (38 * Math.PI) / 180;
const DRAG_SPEED = 0.0042;
const DRAG_STIFFNESS = 0.16;
const DRAG_DAMPING = 0.62;

const HOVER_SCALE = 1.16;
const SELECT_SCALE = 1.24;
const SCALE_STIFFNESS = 0.22;
const SCALE_DAMPING = 0.55;

const DIM_OPACITY = 0.12;   // filtered-out tiles stay as ghosts for context
const FADE_LERP = 0.14;

const ENTRY_STAGGER_MS = 45;
const ENTRY_FADE_MS = 520;

const LABEL_MARGIN = 76;
const EVIDENCE_LABEL_ANGLE = (7 * Math.PI) / 180;

// ─── Small helpers ────────────────────────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function makeSpring(initial = 0) {
  return { current: initial, target: initial, velocity: 0 };
}
function tickSpring(s, stiffness, damping) {
  s.velocity += (s.target - s.current) * stiffness;
  s.velocity *= 1 - damping;
  s.current += s.velocity;
  return s.current;
}

export function quadrantOf(insight, quadrants) {
  const hand = insight.axes.world <= 0.5;
  const feeling = insight.axes.feeling > 0.5;
  return quadrants.find((q) => q.hand === hand && q.feeling === feeling);
}

export function evidenceLabel(insight) {
  const n = insight.voices.length;
  if (n >= 3) return 'All three voices';
  if (n === 2) return 'Two voices';
  return insight.axes.evidence >= 0.5 ? 'Single voice' : 'Concept signal';
}

/* ─── Card face texture ───────────────────────────────────────────────────────
   Each tile paints its own face into a 2D canvas. Drawing text rather than
   loading an image keeps the whole site to three network requests and means
   the map stays readable when zoomed out, which is the point of it. */
const FACE_W = 1024;
const FACE_H = Math.round(FACE_W * (TILE_H / TILE_W));

function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // If we ran out of lines mid-sentence, mark the truncation honestly.
  const used = lines.join(' ').split(/\s+/).length;
  if (used < words.length && lines.length) {
    let last = lines[lines.length - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.includes(' ')) {
      last = last.slice(0, last.lastIndexOf(' '));
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

function makeFaceTexture(insight, quadrant) {
  const cv = document.createElement('canvas');
  cv.width = FACE_W;
  cv.height = FACE_H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = '#FCFCFB';
  ctx.fillRect(0, 0, FACE_W, FACE_H);

  // Quadrant colour bar down the left edge
  ctx.fillStyle = quadrant.color;
  ctx.fillRect(0, 0, 18, FACE_H);

  const padL = 62;
  const padT = 60;

  // Number
  ctx.fillStyle = '#A5A29B';
  ctx.font = '500 34px "DM Mono", ui-monospace, monospace';
  ctx.textBaseline = 'top';
  ctx.fillText(String(insight.n).padStart(2, '0'), padL, padT);

  // Evidence dots, top right — four pips, filled by strength
  const pips = 3;
  const filled = insight.voices.length;
  for (let i = 0; i < pips; i++) {
    ctx.beginPath();
    ctx.arc(FACE_W - 62 - i * 30, padT + 16, 8, 0, Math.PI * 2);
    ctx.fillStyle = i < filled ? quadrant.color : '#E2E1DC';
    ctx.fill();
  }

  // Title
  ctx.fillStyle = '#1A1A18';
  ctx.font = '400 60px "Source Serif 4", Georgia, serif';
  const lines = wrapLines(ctx, insight.title, FACE_W - padL - 62, 4);
  const lineH = 74;
  let y = padT + 84;
  for (const line of lines) {
    ctx.fillText(line, padL, y);
    y += lineH;
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}


/* A faint tinted panel per quadrant on the back wall, captioned with the
   quadrant's name. Without these the four groups are something you have to be
   told about; with them the structure is just visible. */
function makeQuadrantPanel(quadrant) {
  const W = 512;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');

  ctx.fillStyle = quadrant.color;
  ctx.globalAlpha = 0.05;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;

  ctx.fillStyle = quadrant.color;
  ctx.globalAlpha = 0.42;
  ctx.font = '500 30px "DM Mono", ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const name = quadrant.name.toUpperCase().split('').join('\u2009');
  ctx.fillText(name, W / 2, H / 2);
  ctx.globalAlpha = 1;

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(R, R), mat);
  // hand -> negative x, feeling -> positive y
  mesh.position.set(
    (quadrant.hand ? -1 : 1) * (R / 2),
    (quadrant.feeling ? 1 : -1) * (R / 2),
    Z_EMERGING - 0.05
  );
  mesh.renderOrder = -1;
  return mesh;
}

// ─── Grid: the 2×2×2 scaffold ─────────────────────────────────────────────────
function addScaffold(scene, quadrants) {
  const group = new THREE.Group();

  quadrants.forEach((q) => group.add(makeQuadrantPanel(q)));

  const faint = new THREE.LineBasicMaterial({ color: '#D8D8D5', transparent: true, opacity: 0.55 });
  const mid = new THREE.LineBasicMaterial({ color: '#B4B3AE', transparent: true, opacity: 0.5 });
  const strong = new THREE.LineBasicMaterial({ color: '#8E8C86', transparent: true, opacity: 0.75 });

  const seg = (pts, mat) =>
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mat));

  // Back plane grid (at the emerging end) — gives the volume a floor to read against
  const back = [];
  for (let i = -R; i <= R; i += 1.1) {
    back.push(new THREE.Vector3(i, -R, Z_EMERGING), new THREE.Vector3(i, R, Z_EMERGING));
    back.push(new THREE.Vector3(-R, i, Z_EMERGING), new THREE.Vector3(R, i, Z_EMERGING));
  }
  seg(back, faint);

  // The 2×2 split, extruded through the full depth: the x=0 and y=0 planes.
  const planes = [];
  for (let z = Z_EMERGING; z <= Z_PROVEN + 0.01; z += 2) {
    planes.push(new THREE.Vector3(0, -R, z), new THREE.Vector3(0, R, z));
    planes.push(new THREE.Vector3(-R, 0, z), new THREE.Vector3(R, 0, z));
  }
  planes.push(new THREE.Vector3(0, -R, Z_EMERGING), new THREE.Vector3(0, -R, Z_PROVEN));
  planes.push(new THREE.Vector3(0, R, Z_EMERGING), new THREE.Vector3(0, R, Z_PROVEN));
  planes.push(new THREE.Vector3(-R, 0, Z_EMERGING), new THREE.Vector3(-R, 0, Z_PROVEN));
  planes.push(new THREE.Vector3(R, 0, Z_EMERGING), new THREE.Vector3(R, 0, Z_PROVEN));
  seg(planes, mid);

  // The third split — the evidence midpoint at z = 0. This is what makes it a
  // 2×2×2 rather than a 2×2 with depth for decoration.
  const midZ = [];
  const corners = [
    new THREE.Vector3(-R, -R, 0), new THREE.Vector3(R, -R, 0),
    new THREE.Vector3(R, R, 0), new THREE.Vector3(-R, R, 0),
  ];
  for (let i = 0; i < 4; i++) midZ.push(corners[i], corners[(i + 1) % 4]);
  seg(midZ, strong);

  // Bounding box of the volume
  const box = [];
  const zs = [Z_EMERGING, Z_PROVEN];
  for (const z of zs) {
    const c = [
      new THREE.Vector3(-R, -R, z), new THREE.Vector3(R, -R, z),
      new THREE.Vector3(R, R, z), new THREE.Vector3(-R, R, z),
    ];
    for (let i = 0; i < 4; i++) box.push(c[i], c[(i + 1) % 4]);
  }
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    box.push(new THREE.Vector3(sx * R, sy * R, Z_EMERGING), new THREE.Vector3(sx * R, sy * R, Z_PROVEN));
  }
  seg(box, faint);

  scene.add(group);
  return group;
}

// ═════════════════════════════════════════════════════════════════════════════
export function initScene(data, { onSelect } = {}) {
  const canvas = document.getElementById('three-canvas');
  const hoverEl = document.getElementById('hover-label');
  const isTouch = window.matchMedia('(hover: none)').matches;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.offsetWidth, canvas.offsetHeight, false);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#FFFFFF');

  const camera = new THREE.PerspectiveCamera(46, canvas.offsetWidth / canvas.offsetHeight, 0.1, 400);

  // Smallest camera distance at which the whole volume still fits the frame,
  // accounting for aspect: a tall narrow viewport is constrained by width.
  function fitDistance() {
    const halfExtent = R * (window.innerWidth < 900 ? 1.15 : 1.38);
    const tanHalfV = Math.tan((camera.fov * Math.PI) / 360);
    return Math.max(halfExtent / tanHalfV, halfExtent / (tanHalfV * camera.aspect));
  }

  scene.add(new THREE.AmbientLight('#FFFFFF', 2.6));
  const key = new THREE.DirectionalLight('#FFFFFF', 0.9);
  key.position.set(2, 4, 8);
  scene.add(key);

  addScaffold(scene, data.quadrants);

  // ─── Tiles ──────────────────────────────────────────────────────────────────
  const tiles = [];
  const meshToInsight = new Map();
  const startedAt = performance.now();

  // Nearest-first so the staggered entry reads as depth resolving out of the page.
  const ordered = [...data.insights].sort((a, b) => b.axes.evidence - a.axes.evidence);

  ordered.forEach((insight, i) => {
    const q = quadrantOf(insight, data.quadrants);
    const x = (insight.axes.world - 0.5) * 2 * R * 0.92;
    const y = (insight.axes.feeling - 0.5) * 2 * R * 0.92;
    const z = Z_EMERGING + insight.axes.evidence * (Z_PROVEN - Z_EMERGING);

    const geo = new THREE.BoxGeometry(TILE_W, TILE_H, TILE_D);
    const edge = new THREE.MeshBasicMaterial({ color: q.color, transparent: true, opacity: 0 });
    const face = new THREE.MeshBasicMaterial({
      map: makeFaceTexture(insight, q),
      transparent: true,
      opacity: 0,
    });
    const backMat = new THREE.MeshBasicMaterial({ color: '#EDEDEA', transparent: true, opacity: 0 });
    // BoxGeometry material order: +x, -x, +y, -y, +z (front), -z (back)
    const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, face, backMat]);
    mesh.position.set(x, y, z);
    mesh.frustumCulled = false;

    mesh.userData = {
      insight,
      quadrant: q,
      face,
      edge,
      backMat,
      scale: makeSpring(1),
      opacity: 0,
      targetOpacity: 1,
      revealAt: i * ENTRY_STAGGER_MS,
      visible: true,
    };

    scene.add(mesh);
    tiles.push(mesh);
    meshToInsight.set(mesh, insight);
  });

  // ─── Camera state ───────────────────────────────────────────────────────────
  const zoom = makeSpring(CAM_START_FRAC);       // 0 = near, 1 = far
  const theta = makeSpring(START_THETA);         // yaw
  const phi = makeSpring(START_PHI);             // pitch
  let evidenceLabelOpacity = 0;

  function resetView() {
    zoom.target = CAM_START_FRAC;
    theta.target = START_THETA;
    phi.target = START_PHI;
  }

  // ─── Pointer: drag to orbit ─────────────────────────────────────────────────
  let dragging = false;
  let moved = 0;
  let lastX = 0;
  let lastY = 0;

  let hasInteracted = false;
  function markInteracted() {
    if (hasInteracted) return;
    hasInteracted = true;
    window.dispatchEvent(new CustomEvent('viz:interact'));
  }

  function pointerDown(x, y) {
    markInteracted();
    dragging = true;
    moved = 0;
    lastX = x;
    lastY = y;
  }
  function pointerMove(x, y) {
    if (!dragging) return;
    const dx = x - lastX;
    const dy = y - lastY;
    lastX = x;
    lastY = y;
    moved += Math.abs(dx) + Math.abs(dy);
    theta.target = clamp(theta.target + dx * DRAG_SPEED, -DRAG_MAX_H, DRAG_MAX_H);
    phi.target = clamp(phi.target - dy * DRAG_SPEED, -DRAG_MAX_V, DRAG_MAX_V);
  }
  function pointerUp() { dragging = false; }

  canvas.addEventListener('mousedown', (e) => { pointerDown(e.clientX, e.clientY); canvas.style.cursor = 'grabbing'; });
  window.addEventListener('mousemove', (e) => pointerMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', () => { pointerUp(); canvas.style.cursor = ''; });

  // Touch: one finger orbits, two fingers pinch-zoom.
  let pinchDist = 0;
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      pointerDown(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      dragging = false;
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1 && dragging) {
      e.preventDefault();
      pointerMove(e.touches[0].clientX, e.touches[0].clientY);
    } else if (e.touches.length === 2) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchDist) zoom.target = clamp(zoom.target - (d - pinchDist) * ZOOM_PINCH_SPEED * 0.02, 0, 1);
      pinchDist = d;
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    if (e.touches.length === 0) { pointerUp(); pinchDist = 0; }
  }, { passive: true });

  // Wheel over the canvas zooms the model rather than scrolling the page —
  // standard for a 3D viewer, and the report below is reached by its own link.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    markInteracted();
    zoom.target = clamp(zoom.target + e.deltaY * ZOOM_WHEEL_SPEED * 0.01, 0, 1);
  }, { passive: false });

  // ─── Raycasting: hover + click ──────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered = null;
  let selected = null;

  function pickAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(tiles.filter((t) => t.userData.visible), false);
    return hits.length ? hits[0].object : null;
  }

  function showHover(mesh, clientX, clientY) {
    if (!mesh) { hoverEl.hidden = true; return; }
    const { insight, quadrant } = mesh.userData;
    const rect = canvas.getBoundingClientRect();
    hoverEl.innerHTML = '';
    const q = document.createElement('span');
    q.className = 'hl-q';
    q.textContent = `${quadrant.name} · ${evidenceLabel(insight)}`;
    hoverEl.append(q, document.createTextNode(insight.title));
    hoverEl.hidden = false;
    hoverEl.style.left = `${clientX - rect.left}px`;
    hoverEl.style.top = `${clientY - rect.top}px`;
  }

  canvas.addEventListener('mousemove', (e) => {
    if (dragging) { hoverEl.hidden = true; return; }
    const hit = pickAt(e.clientX, e.clientY);
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit ? 'pointer' : '';
    }
    showHover(hit, e.clientX, e.clientY);
  });

  canvas.addEventListener('mouseleave', () => { hovered = null; hoverEl.hidden = true; });

  canvas.addEventListener('click', (e) => {
    if (moved > 6) return; // that was a drag, not a click
    const hit = pickAt(e.clientX, e.clientY);
    if (hit && onSelect) onSelect(hit.userData.insight.id);
  });

  // On touch, a tap should open the panel directly — there is no hover state
  // to preview into, so the tooltip step would just cost a tap.
  if (isTouch) {
    canvas.addEventListener('touchend', (e) => {
      if (moved > 8 || e.changedTouches.length !== 1) return;
      const t = e.changedTouches[0];
      const hit = pickAt(t.clientX, t.clientY);
      if (hit && onSelect) onSelect(hit.userData.insight.id);
    });
  }

  // ─── Label projection ───────────────────────────────────────────────────────
  function project(vec) {
    const v = vec.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * canvas.offsetWidth,
      y: (-v.y * 0.5 + 0.5) * canvas.offsetHeight,
      behind: v.z > 1,
    };
  }

  // Pin a label to the viewport edge along the ray from centre to its axis tip,
  // so endpoint labels stay on screen at every zoom level.
  function pinToEdge(ox, oy, tx, ty, m) {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const dx = tx - ox;
    const dy = ty - oy;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return { x: tx, y: ty };
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (w - m.side - ox) / dx);
    if (dx < 0) t = Math.min(t, (m.side - ox) / dx);
    if (dy > 0) t = Math.min(t, (h - m.bottom - oy) / dy);
    if (dy < 0) t = Math.min(t, (m.top - oy) / dy);
    if (!isFinite(t) || t < 0) {
      return { x: clamp(tx, m.side, w - m.side), y: clamp(ty, m.top, h - m.bottom) };
    }
    return { x: ox + dx * t, y: oy + dy * t };
  }

  function placeLabel(el, x, y, rotate = '') {
    const halfW = el.offsetWidth / 2 + 6;
    const halfH = el.offsetHeight / 2 + 6;
    const cx = clamp(x, halfW, Math.max(halfW, canvas.offsetWidth - halfW));
    const cy = clamp(y, halfH, Math.max(halfH, canvas.offsetHeight - halfH));
    el.style.transform = `translate(-50%, -50%) translate(${cx}px, ${cy}px) ${rotate}`;
  }

  const endpoints = [
    { id: 'label-hand', pos: new THREE.Vector3(-R * 1.25, 0, 0) },
    { id: 'label-world', pos: new THREE.Vector3(R * 1.25, 0, 0) },
    { id: 'label-function', pos: new THREE.Vector3(0, -R * 1.25, 0) },
    { id: 'label-feeling', pos: new THREE.Vector3(0, R * 1.25, 0) },
  ].map((e) => ({ ...e, el: document.getElementById(e.id) }));

  const evEl = document.getElementById('label-evidence');

  // ─── Public API state ───────────────────────────────────────────────────────
  let activeQuadrant = 'all';
  let evidenceFloor = 0;

  function applyVisibility() {
    tiles.forEach((mesh) => {
      const { insight, quadrant } = mesh.userData;
      const passesQuadrant = activeQuadrant === 'all' || quadrant.id === activeQuadrant;
      const passesEvidence = insight.axes.evidence >= evidenceFloor;
      const on = passesQuadrant && passesEvidence;
      mesh.userData.visible = on;
      mesh.userData.targetOpacity = on ? 1 : DIM_OPACITY;
    });
  }

  // ─── Render loop ────────────────────────────────────────────────────────────
  function margins() {
    const narrow = window.innerWidth < 900;
    const h = canvas.offsetHeight;
    return narrow
      ? { side: 46, top: Math.round(h * 0.26), bottom: Math.round(h * 0.16) }
      : { side: LABEL_MARGIN, top: LABEL_MARGIN + 30, bottom: LABEL_MARGIN };
  }
  let rafId = null;
  let running = true;

  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!running) return;

    tickSpring(zoom, ZOOM_STIFFNESS, ZOOM_DAMPING);
    tickSpring(theta, DRAG_STIFFNESS, DRAG_DAMPING);
    tickSpring(phi, DRAG_STIFFNESS, DRAG_DAMPING);

    const dist = fitDistance() * (CAM_ZOOM_MIN + zoom.current * (CAM_ZOOM_MAX - CAM_ZOOM_MIN));
    const pos = new THREE.Vector3(0, 0, dist);
    pos.applyQuaternion(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(phi.current, theta.current, 0, 'YXZ'))
    );
    camera.position.copy(pos);
    camera.lookAt(CAM_TARGET);
    camera.updateMatrixWorld();

    // Tiles: entry fade, filter fade, hover/select spring
    const elapsed = performance.now() - startedAt;
    tiles.forEach((mesh) => {
      const u = mesh.userData;

      const entry = clamp((elapsed - u.revealAt) / ENTRY_FADE_MS, 0, 1);
      const wanted = u.targetOpacity * entry;
      u.opacity += (wanted - u.opacity) * FADE_LERP;
      const o = u.opacity;
      u.face.opacity = o;
      u.edge.opacity = o;
      u.backMat.opacity = o;

      const isSel = selected === mesh;
      const isHov = hovered === mesh;
      u.scale.target = isSel ? SELECT_SCALE : isHov ? HOVER_SCALE : 1;
      const s = tickSpring(u.scale, SCALE_STIFFNESS, SCALE_DAMPING);
      mesh.scale.setScalar(s);
    });

    // Axis endpoint labels
    const origin = project(CAM_TARGET);
    const m = margins();
    endpoints.forEach(({ el, pos: p }) => {
      if (!el) return;
      const pr = project(p);
      if (pr.behind) { el.style.opacity = 0; return; }
      el.style.opacity = 1;
      const edge = pinToEdge(origin.x, origin.y, pr.x, pr.y, m);
      placeLabel(el, edge.x, edge.y);
    });

    // The evidence axis label only makes sense once the view is off-axis
    // enough for depth to be visible — otherwise it points straight at you.
    if (evEl) {
      const a = project(new THREE.Vector3(R * 1.04, -R * 1.04, Z_EMERGING));
      const b = project(new THREE.Vector3(R * 1.04, -R * 1.04, Z_PROVEN));
      const offAxis = Math.abs(theta.current) + Math.abs(phi.current);
      const want = !a.behind && !b.behind && offAxis > EVIDENCE_LABEL_ANGLE ? 1 : 0;
      evidenceLabelOpacity += (want - evidenceLabelOpacity) * 0.09;
      evEl.style.opacity = evidenceLabelOpacity;
      if (evidenceLabelOpacity > 0.01) {
        const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        const flip = Math.abs(deg) > 90 ? 180 : 0;
        placeLabel(evEl, (a.x + b.x) / 2, (a.y + b.y) / 2, `rotate(${deg + flip}deg)`);
      }
    }

    renderer.render(scene, camera);
  }

  // ─── Resize ─────────────────────────────────────────────────────────────────
  function onResize() {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', onResize);

  // Stop burning frames when the hero is scrolled away or the tab is hidden.
  const hero = document.getElementById('hero');
  const io = new IntersectionObserver(
    ([entry]) => { running = entry.isIntersecting && !document.hidden; },
    { threshold: 0.02 }
  );
  io.observe(hero);
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden && hero.getBoundingClientRect().bottom > 0;
  });

  frame();

  return {
    setQuadrant(id) { activeQuadrant = id; applyVisibility(); },
    setEvidenceFloor(v) { evidenceFloor = v; applyVisibility(); },
    select(id) {
      selected = tiles.find((t) => t.userData.insight.id === id) || null;
      if (selected) {
        // Ease toward the selected tile without yanking the camera: nudge the
        // orbit so it is comfortably in frame, and zoom in a little.
        zoom.target = clamp(zoom.target - 0.1, 0.18, 1);
      }
    },
    clearSelection() { selected = null; },
    reset() { resetView(); hasInteracted = false; },
    dispose() {
      cancelAnimationFrame(rafId);
      io.disconnect();
      window.removeEventListener('resize', onResize);
      renderer.dispose();
    },
  };
}

/* ─── 2D fallback ─────────────────────────────────────────────────────────────
   WebGL can be unavailable (old device, hardened browser, remote desktop).
   Rather than showing an empty hero, draw the same 2×2 as an SVG scatter with
   evidence encoded as dot size instead of depth. */
export function initScatter2D(data, { onSelect } = {}) {
  const host = document.getElementById('scatter-2d');
  const canvas = document.getElementById('three-canvas');
  canvas.hidden = true;
  host.hidden = false;

  const W = 1000;
  const H = 700;
  const pad = 80;
  const sx = (world) => pad + world * (W - pad * 2);
  const sy = (feeling) => H - pad - feeling * (H - pad * 2);

  const svg = [`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">`];
  svg.push(`<line x1="${W / 2}" y1="${pad - 24}" x2="${W / 2}" y2="${H - pad + 24}" stroke="#B4B3AE" stroke-width="1"/>`);
  svg.push(`<line x1="${pad - 30}" y1="${H / 2}" x2="${W - pad + 30}" y2="${H / 2}" stroke="#B4B3AE" stroke-width="1"/>`);

  for (const ins of data.insights) {
    const q = quadrantOf(ins, data.quadrants);
    const r = 9 + ins.axes.evidence * 13;
    svg.push(
      `<g class="s2d-node" data-id="${ins.id}" style="cursor:pointer">` +
        `<circle cx="${sx(ins.axes.world).toFixed(1)}" cy="${sy(ins.axes.feeling).toFixed(1)}" r="${r.toFixed(1)}" fill="${q.color}" fill-opacity="0.82"/>` +
        `<text x="${sx(ins.axes.world).toFixed(1)}" y="${(sy(ins.axes.feeling) + 4).toFixed(1)}" text-anchor="middle" font-family="DM Mono, monospace" font-size="12" fill="#fff">${ins.n}</text>` +
        `<title>${ins.title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</title>` +
      `</g>`
    );
  }
  svg.push('</svg>');
  host.innerHTML = svg.join('');

  host.querySelectorAll('.s2d-node').forEach((node) => {
    node.addEventListener('click', () => onSelect && onSelect(node.dataset.id));
  });

  return {
    setQuadrant(id) {
      host.querySelectorAll('.s2d-node').forEach((node) => {
        const ins = data.insights.find((i) => i.id === node.dataset.id);
        const q = quadrantOf(ins, data.quadrants);
        node.style.opacity = id === 'all' || q.id === id ? 1 : 0.15;
      });
    },
    setEvidenceFloor() {},
    select() {},
    clearSelection() {},
    reset() {},
    dispose() {},
  };
}

export function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}
