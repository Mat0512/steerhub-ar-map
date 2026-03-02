// app.js — camera, compass, and AR location pin overlay
import { loadMap, getLocation, getAllLocations, getRoutes, normalizeAngle } from './map.js';

// ── Constants ─────────────────────────────────────────────────────────────

const HFOV        = 60;   // estimated horizontal field of view (degrees)
const LERP        = 0.15; // compass smoothing factor per frame (0 = no smooth, 1 = instant)
const AIM_HOLD_MS = 1000; // ms to hold aim before auto-opening detail card

// ── State ─────────────────────────────────────────────────────────────────

let rawHeading     = null; // latest sensor value
let compassHeading = null; // smoothed value used for rendering
let routes         = [];
let selectedRoute  = null;
let lockedRoute    = null; // set by destination strip or pin tap
let pinHitAreas    = [];   // [{id, x, y, r}] rebuilt each frame
let nearestToCenter = null;
let aimTarget      = null;
let aimStartTime   = null;
let aimAutoOpened  = false;

// ── DOM refs ──────────────────────────────────────────────────────────────

const video         = document.getElementById('camera');
const canvas        = document.getElementById('overlay');
const ctx           = canvas.getContext('2d');
const detailCard    = document.getElementById('detail-card');
const compassNotice = document.getElementById('compass-notice');
const indexScreen   = document.getElementById('index-screen');
const destStrip     = document.getElementById('dest-strip');

// ── Entry point ───────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search);
const fromId = params.get('from');

async function init() {
  loadMap();

  if (!fromId) { showIndexScreen(); return; }

  const location = getLocation(fromId);
  if (!location) {
    showError(`Unknown QR location: <strong>${fromId}</strong><br>Please scan a QR code from the venue.`);
    return;
  }

  routes = getRoutes(fromId);

  const needsPermission =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (needsPermission) showStartScreen();
  else await startApp();
}

// ── Index screen ──────────────────────────────────────────────────────────

function showIndexScreen() {
  indexScreen.classList.remove('hidden');
  const list   = document.getElementById('location-list');
  const origin = window.location.origin + window.location.pathname;
  getAllLocations().forEach(loc => {
    const li = document.createElement('li');
    li.innerHTML = `
      <strong>${loc.name}</strong>
      <small>Floor ${loc.floor}</small>
      <span class="qr-url">${origin}?from=${loc.id}</span>
    `;
    list.appendChild(li);
  });
}

// ── Start screen (iOS) ────────────────────────────────────────────────────

function showStartScreen() {
  document.getElementById('start-screen').classList.remove('hidden');
  document.getElementById('start-btn').addEventListener('click', async () => {
    document.getElementById('start-screen').classList.add('hidden');
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') showCompassNotice();
    } catch { showCompassNotice(); }
    await startApp();
  }, { once: true });
}

// ── App startup ───────────────────────────────────────────────────────────

async function startApp() {
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  await startCamera();
  startCompass();
  buildDestStrip();
  canvas.addEventListener('click', onCanvasClick);
  requestAnimationFrame(drawLoop);
}

// ── Camera ────────────────────────────────────────────────────────────────

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch {
    video.style.display = 'none';
    document.body.style.background = '#0d0d1a';
  }
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}

// ── Compass ───────────────────────────────────────────────────────────────

function startCompass() {
  let fired = false;
  window.addEventListener('deviceorientation', (e) => {
    fired = true;
    if (typeof e.webkitCompassHeading === 'number') {
      rawHeading = e.webkitCompassHeading;
    } else if (e.alpha !== null) {
      rawHeading = (360 - e.alpha) % 360;
    }
  }, true);
  setTimeout(() => { if (!fired) showCompassNotice(); }, 3000);
}

function showCompassNotice() {
  compassNotice.classList.remove('hidden');
}

// Lerp between angles with correct 0°/360° wrap-around handling
function lerpAngle(current, target, t) {
  let diff = target - current;
  if (diff >  180) diff -= 360;
  if (diff < -180) diff += 360;
  return (current + diff * t + 360) % 360;
}

// ── Destination strip ─────────────────────────────────────────────────────

function buildDestStrip() {
  destStrip.classList.remove('hidden');
  routes.forEach(route => {
    const chip = document.createElement('div');
    chip.className    = 'dest-chip';
    chip.dataset.id   = route.id;
    chip.style.borderColor = route.color;
    chip.innerHTML = `
      <span class="chip-dot" style="background:${route.color}"></span>
      <span class="chip-name">${route.name}</span>
      <span class="chip-floor">F${route.floor}</span>
    `;
    chip.addEventListener('click', () => onChipClick(route, chip));
    destStrip.appendChild(chip);
  });
}

function onChipClick(route, chip) {
  if (navigator.vibrate) navigator.vibrate(30);
  if (lockedRoute?.id === route.id) {
    // Tap again to unlock
    lockedRoute   = null;
    selectedRoute = null;
    detailCard.classList.add('hidden');
    clearChipSelection();
  } else {
    lockedRoute   = route;
    selectedRoute = route;
    showDetail(route);
    setChipSelection(route.id);
  }
}

function setChipSelection(id) {
  document.querySelectorAll('.dest-chip').forEach(c => {
    c.classList.toggle('locked', c.dataset.id === id);
    c.classList.toggle('faded',  c.dataset.id !== id);
  });
}

function clearChipSelection() {
  document.querySelectorAll('.dest-chip').forEach(c => {
    c.classList.remove('locked', 'faded');
  });
}

// ── Draw loop ─────────────────────────────────────────────────────────────

function drawLoop() {
  // Smooth the compass every frame so pins glide between sensor readings
  if (rawHeading !== null) {
    compassHeading = compassHeading === null
      ? rawHeading
      : lerpAngle(compassHeading, rawHeading, LERP);
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  pinHitAreas = [];
  if (routes.length > 0) drawScene();
  requestAnimationFrame(drawLoop);
}

// ── Scene ─────────────────────────────────────────────────────────────────

function drawScene() {
  const halfFov  = HFOV / 2;
  const inView   = [];
  const offLeft  = [];
  const offRight = [];

  routes.forEach(route => {
    if (compassHeading === null) {
      inView.push({ route, angleDiff: 0 });
      return;
    }
    const angleDiff = normalizeAngle(route.bearing - compassHeading);
    if (Math.abs(angleDiff) <= halfFov) {
      inView.push({ route, angleDiff });
    } else if (angleDiff > 0) {
      offRight.push({ route, angleDiff });
    } else {
      offLeft.push({ route, angleDiff });
    }
  });

  // Find pin nearest to screen centre for aim + highlight logic
  nearestToCenter = null;
  let nearestDiff = Infinity;
  inView.forEach(({ route, angleDiff }) => {
    if (Math.abs(angleDiff) < nearestDiff) {
      nearestDiff     = Math.abs(angleDiff);
      nearestToCenter = route;
    }
  });

  updateAimTarget(nearestToCenter, nearestDiff);

  // Build pin layout and resolve overlaps
  const pins = inView.map(({ route, angleDiff }, i) => ({
    route,
    angleDiff,
    x: compassHeading === null
      ? canvas.width * (i + 1) / (inView.length + 1)
      : canvas.width / 2 + (angleDiff / halfFov) * (canvas.width / 2),
    y: canvas.height * 0.38,
  }));

  resolveOverlaps(pins);

  // Draw farther pins first so nearer ones appear on top
  [...pins]
    .sort((a, b) => Math.abs(b.angleDiff) - Math.abs(a.angleDiff))
    .forEach(({ route, x, y }) => drawPin(x, y, route));

  drawEdgeIndicators(offLeft,  'left');
  drawEdgeIndicators(offRight, 'right');
  drawFloorIndicator();
}

// ── Auto-aim logic ────────────────────────────────────────────────────────

function updateAimTarget(nearest, nearestDiff) {
  if (nearest && nearestDiff < 8) {
    if (aimTarget?.id !== nearest.id) {
      aimTarget     = nearest;
      aimStartTime  = performance.now();
      aimAutoOpened = false;
    } else if (!aimAutoOpened && performance.now() - aimStartTime > AIM_HOLD_MS) {
      aimAutoOpened = true;
      selectedRoute = aimTarget;
      lockedRoute   = aimTarget;
      showDetail(aimTarget);
      setChipSelection(aimTarget.id);
      if (navigator.vibrate) navigator.vibrate([40, 30, 40]);
    }
  } else {
    aimTarget     = null;
    aimStartTime  = null;
    aimAutoOpened = false;
  }
}

// ── Overlap resolution ────────────────────────────────────────────────────

function resolveOverlaps(pins) {
  if (pins.length <= 1) return;
  const MIN_X_SEP = 34 * 2 + 20;
  const ROW_STEP  = 115;
  const baseY     = pins[0].y;
  pins.sort((a, b) => a.x - b.x);

  for (let i = 1; i < pins.length; i++) {
    if (pins[i].x - pins[i - 1].x >= MIN_X_SEP) continue;
    const usedY = pins.slice(0, i)
      .filter(p => pins[i].x - p.x < MIN_X_SEP)
      .map(p => p.y);
    const candidates = [];
    for (let step = 1; step <= pins.length; step++) {
      candidates.push(baseY - step * ROW_STEP);
      candidates.push(baseY + step * ROW_STEP);
    }
    const chosen = candidates.find(y => !usedY.some(u => Math.abs(u - y) < ROW_STEP * 0.8));
    if (chosen !== undefined) pins[i].y = chosen;
  }
}

// ── Location pin ──────────────────────────────────────────────────────────

function drawPin(x, y, route) {
  const isSelected = selectedRoute?.id === route.id;
  const isAimed    = nearestToCenter?.id === route.id && compassHeading !== null;
  const isFaded    = lockedRoute !== null && lockedRoute.id !== route.id;
  const now        = performance.now();
  const baseY      = canvas.height * 0.38;
  const r          = isSelected ? 42 : (isAimed ? 38 : 34);
  const tipH       = 16;

  ctx.globalAlpha = isFaded ? 0.28 : 1;

  // Dashed stem for staggered pins
  if (Math.abs(y - baseY) > 10) {
    const stemTop    = y > baseY ? y - r - 2        : y + r + tipH + 2;
    const stemBottom = y > baseY ? baseY - 34 - tipH : baseY + 34 + tipH;
    ctx.beginPath();
    ctx.moveTo(x, stemTop);
    ctx.lineTo(x, stemBottom);
    ctx.strokeStyle = route.color;
    ctx.lineWidth   = 2;
    ctx.setLineDash([5, 4]);
    ctx.globalAlpha = isFaded ? 0.12 : 0.4;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = isFaded ? 0.28 : 1;
  }

  // Pulse ring
  const pulseSin   = Math.sin(now / 700);
  const pulseR     = r + 10 + 5 * Math.abs(pulseSin);
  const pulseAlpha = (0.18 + 0.12 * pulseSin) * (isFaded ? 0.3 : 1);
  ctx.beginPath();
  ctx.arc(x, y, pulseR, 0, Math.PI * 2);
  ctx.strokeStyle = route.color;
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = pulseAlpha;
  ctx.stroke();
  ctx.globalAlpha = isFaded ? 0.28 : 1;

  // Aimed-at ring + progress arc
  if (isAimed) {
    ctx.beginPath();
    ctx.arc(x, y, r + 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 2;
    ctx.globalAlpha = isFaded ? 0.15 : 0.6;
    ctx.stroke();

    if (aimTarget?.id === route.id && aimStartTime) {
      const progress = Math.min(1, (now - aimStartTime) / AIM_HOLD_MS);
      ctx.beginPath();
      ctx.arc(x, y, r + 12, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 3;
      ctx.globalAlpha = isFaded ? 0.2 : 0.95;
      ctx.stroke();
    }
    ctx.globalAlpha = isFaded ? 0.28 : 1;
  }

  // Glow
  ctx.shadowColor = route.color;
  ctx.shadowBlur  = isSelected ? 32 : (isAimed ? 24 : 16);

  // Circle body
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = route.color;
  ctx.fill();

  // Teardrop tip
  ctx.beginPath();
  ctx.moveTo(x - r * 0.42, y + r * 0.72);
  ctx.lineTo(x + r * 0.42, y + r * 0.72);
  ctx.lineTo(x, y + r + tipH);
  ctx.closePath();
  ctx.fillStyle = route.color;
  ctx.fill();

  ctx.shadowBlur = 0;

  // Inner highlight
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();

  // Floor number inside circle
  ctx.fillStyle    = '#fff';
  ctx.font         = `bold ${Math.round(r * 0.54)}px sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`F${route.floor}`, x, y);
  ctx.textBaseline = 'alphabetic';

  // Name + distance label pill below pin
  const labelY = y + r + tipH + 18;
  ctx.font = 'bold 13px sans-serif';
  const nameW  = ctx.measureText(route.name).width;
  ctx.font = '11px sans-serif';
  const distW  = ctx.measureText(route.distance).width;
  const pillW  = Math.min(Math.max(nameW, distW) + 28, 170);
  const pillH  = 42;

  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  roundRect(x - pillW / 2, labelY - 14, pillW, pillH, 8);
  ctx.fill();
  ctx.strokeStyle = route.color;
  ctx.lineWidth   = 1.5;
  roundRect(x - pillW / 2, labelY - 14, pillW, pillH, 8);
  ctx.stroke();

  ctx.font      = 'bold 13px sans-serif';
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(route.name, x, labelY + 1);

  ctx.font      = '11px sans-serif';
  ctx.fillStyle = route.color;
  ctx.fillText(route.distance, x, labelY + 17);

  ctx.globalAlpha = 1;

  // Register hit area for tap detection
  pinHitAreas.push({ id: route.id, x, y: y + (r + tipH) / 2, r: r + tipH });
}

// ── Edge indicators ───────────────────────────────────────────────────────

function drawEdgeIndicators(routeList, side) {
  if (routeList.length === 0) return;
  const pillW  = 130;
  const pillH  = 46;
  const margin = 8;
  const pillX  = side === 'left' ? margin : canvas.width - margin - pillW;
  let   pillY  = canvas.height * 0.25;

  routeList.forEach(({ route, angleDiff }) => {
    const isFaded = lockedRoute !== null && lockedRoute.id !== route.id;
    ctx.globalAlpha = isFaded ? 0.28 : 1;

    const midY    = pillY + pillH / 2;
    const turnDeg = Math.round(Math.abs(angleDiff));

    ctx.fillStyle = 'rgba(0,0,0,0.78)';
    roundRect(pillX, pillY, pillW, pillH, 12);
    ctx.fill();
    ctx.strokeStyle = route.color;
    ctx.lineWidth   = 2;
    roundRect(pillX, pillY, pillW, pillH, 12);
    ctx.stroke();

    // Chevron arrow
    const chevSize = 8;
    const chevX    = side === 'left' ? pillX + 18 : pillX + pillW - 18;
    ctx.strokeStyle = route.color;
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.beginPath();
    if (side === 'left') {
      ctx.moveTo(chevX + chevSize, midY - chevSize);
      ctx.lineTo(chevX,            midY);
      ctx.lineTo(chevX + chevSize, midY + chevSize);
    } else {
      ctx.moveTo(chevX - chevSize, midY - chevSize);
      ctx.lineTo(chevX,            midY);
      ctx.lineTo(chevX - chevSize, midY + chevSize);
    }
    ctx.stroke();

    const textX = side === 'left' ? pillX + 34 : pillX + pillW - 34;
    ctx.textAlign = side === 'left' ? 'left' : 'right';

    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 12px sans-serif';
    ctx.fillText(route.name, textX, midY - 6);

    ctx.fillStyle = route.color;
    ctx.font      = '11px sans-serif';
    ctx.fillText(`${turnDeg}° ${side}`, textX, midY + 10);

    ctx.globalAlpha = 1;
    pillY += pillH + 10;
  });
}

// ── Floor indicator (top-right corner) ───────────────────────────────────

function drawFloorIndicator() {
  const location = getLocation(fromId);
  if (!location) return;

  const text = `Floor ${location.floor}`;
  ctx.font = 'bold 13px sans-serif';
  const w = ctx.measureText(text).width + 24;
  const h = 32;
  const x = canvas.width - w - 12;
  const y = 12;

  ctx.globalAlpha = 1;
  ctx.fillStyle   = 'rgba(0,0,0,0.65)';
  roundRect(x, y, w, h, 8);
  ctx.fill();

  ctx.fillStyle    = '#fff';
  ctx.textAlign    = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width - 12 - 12, y + h / 2);
  ctx.textBaseline = 'alphabetic';
}

// ── Canvas roundRect helper ───────────────────────────────────────────────

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}

// ── Tap / click handling ──────────────────────────────────────────────────

function onCanvasClick(e) {
  const rect   = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  let hit = null;
  pinHitAreas.forEach(({ id, x, y, r }) => {
    if (Math.hypot(clickX - x, clickY - y) <= r + 12) {
      hit = routes.find(route => route.id === id);
    }
  });

  if (hit) {
    if (navigator.vibrate) navigator.vibrate(30);
    selectedRoute = hit;
    lockedRoute   = hit;
    showDetail(hit);
    setChipSelection(hit.id);
  } else {
    selectedRoute = null;
    lockedRoute   = null;
    detailCard.classList.add('hidden');
    clearChipSelection();
  }
}

function showDetail(route) {
  document.getElementById('detail-name').textContent     = route.name;
  document.getElementById('detail-floor').textContent    = `Floor ${route.floor}`;
  document.getElementById('detail-hint').textContent     = route.hint;
  document.getElementById('detail-distance').textContent = `Distance: ${route.distance}`;
  document.getElementById('detail-steps').textContent    = route.steps;
  detailCard.classList.remove('hidden');
}

document.getElementById('close-btn').addEventListener('click', () => {
  detailCard.classList.add('hidden');
  selectedRoute = null;
  lockedRoute   = null;
  clearChipSelection();
});

// ── Error state ───────────────────────────────────────────────────────────

function showError(msg) {
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;background:#0d0d1a;display:flex;align-items:center;justify-content:center;padding:2rem;">
      <div style="color:#fff;font-family:sans-serif;text-align:center;max-width:320px;line-height:1.6;">
        <div style="font-size:2.5rem;margin-bottom:1rem;">!</div>
        <p>${msg}</p>
        <button onclick="location.reload()" style="margin-top:1.5rem;padding:0.75rem 2rem;background:#4CAF50;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;">Reload</button>
      </div>
    </div>
  `;
}

// ── Start ─────────────────────────────────────────────────────────────────

init();
