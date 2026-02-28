import * as THREE from 'https://esm.sh/three@0.160.0';
import { OrbitControls } from 'https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js';

// ── Cluster colours ───────────────────────────────────────────────────────────
const CLUSTER_COLORS = [
  '#66fcf1', '#ff6b6b', '#ffd93d', '#6bcb77',
  '#4d96ff', '#ff922b', '#cc5de8', '#f06595',
];
function clusterColor(id) { return CLUSTER_COLORS[id % CLUSTER_COLORS.length]; }

// Top-5 rank styles: [color, alpha, glow, scale]
const RANK_STYLES = [
  ['#ffd700', 1.0, 32, 2.2],  // #1 — gold, massive
  ['#ffffff', 0.95, 20, 1.7], // #2
  ['#ffffff', 0.85, 14, 1.45],// #3
  ['#ffffff', 0.75, 10, 1.25],// #4
  ['#ffffff', 0.65,  7, 1.1], // #5
];

// ── Three.js setup ────────────────────────────────────────────────────────────
const wrap = document.getElementById('vibe-canvas-wrap');

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setClearColor(0x000000, 0);
wrap.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 300);
camera.position.set(0, 0, 14);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping   = true;
controls.dampingFactor   = 0.07;
controls.autoRotate      = true;
controls.autoRotateSpeed = 0.6;
controls.enableZoom      = false;
controls.enablePan       = false;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));

function resize() {
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(wrap);
resize();

(function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();

// ── Sprite builder ────────────────────────────────────────────────────────────
function makeTexture(word, color, alpha, glow) {
  const cv  = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const fontSize = 13;
  ctx.font = `600 ${fontSize}px 'Segoe UI', sans-serif`;
  const tw  = ctx.measureText(word).width;
  cv.width  = Math.ceil(tw) + 20;
  cv.height = fontSize + 12;
  if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.font         = `600 ${fontSize}px 'Segoe UI', sans-serif`;
  ctx.fillStyle    = color;
  ctx.globalAlpha  = alpha;
  ctx.textBaseline = 'middle';
  ctx.fillText(word, 10, cv.height / 2);
  return new THREE.CanvasTexture(cv);
}

function applySprite(item, color, alpha, glow, scale) {
  const old = spriteMap.get(item.word);
  if (old) { old.material.map.dispose(); scene.remove(old); }
  const tex = makeTexture(item.word, color, alpha, glow);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  const h   = 0.38 * scale;
  spr.scale.set(h * (tex.image.width / tex.image.height), h, 1);
  spr.position.set(item.x, item.y, item.z);
  scene.add(spr);
  spriteMap.set(item.word, spr);
}

// ── State ─────────────────────────────────────────────────────────────────────
let coordsData = [];
let spriteMap  = new Map();

// mode: 'idle' | 'voting' | 'result'
let mode       = 'idle';
let roundWords = new Set();
let liveVotes  = {};
let top5       = [];   // [{ word, rank (0-based), count }] — persists until next panel

const sidebarTitleEl = document.getElementById('vibe-sidebar-title');
const vibeCurrentEl  = document.getElementById('vibe-current');
const countdownEl    = document.getElementById('vote-countdown');
let countdownTimer   = null;

// ── Render all sprites according to current state ─────────────────────────────
function refreshAll() {
  const top5Words = top5.map(t => t.word);

  for (const item of coordsData) {
    const rankEntry = top5.find(t => t.word === item.word);
    const voteCount = liveVotes[item.word];

    if (mode === 'result') {
      if (rankEntry) {
        // Top 5 — use rank style, tint with cluster color for ranks 2-5
        const [color, alpha, glow, scale] = RANK_STYLES[rankEntry.rank];
        const finalColor = rankEntry.rank === 0 ? color : clusterColor(item.cluster);
        applySprite(item, finalColor, alpha, glow, scale);
      } else {
        // Everything else — nearly invisible
        applySprite(item, '#0d1f2a', 0.18, 0, 0.7);
      }

    } else if (mode === 'voting') {
      if (voteCount > 0) {
        // Actively voted — brighten by count
        const color = clusterColor(item.cluster);
        const alpha = Math.min(0.7 + voteCount * 0.1, 1.0);
        const glow  = 6 + voteCount * 5;
        const scale = 1.0 + Math.min(voteCount * 0.1, 0.6);
        applySprite(item, color, alpha, glow, scale);
      } else if (roundWords.has(item.word)) {
        // In this round but not yet voted — subtle highlight
        applySprite(item, clusterColor(item.cluster), 0.55, 4, 0.9);
      } else {
        // Not in this round — dim
        applySprite(item, '#1a3040', 0.3, 0, 0.8);
      }

    } else {
      // Idle — all dim, but top5 from last round still gently glowing
      if (rankEntry) {
        const [color, alpha, glow, scale] = RANK_STYLES[rankEntry.rank];
        const finalColor = rankEntry.rank === 0 ? color : clusterColor(item.cluster);
        applySprite(item, finalColor, alpha * 0.6, glow * 0.5, scale * 0.85);
      } else {
        applySprite(item, '#1a3040', 0.3, 0, 0.8);
      }
    }
  }
}

// ── Partial refresh — only update changed sprites (during live voting) ─────────
function refreshWords(words) {
  for (const word of words) {
    const item = coordsData.find(d => d.word === word);
    if (!item) continue;
    const voteCount = liveVotes[word] || 0;
    const color = clusterColor(item.cluster);
    const alpha = Math.min(0.7 + voteCount * 0.1, 1.0);
    const glow  = 6 + voteCount * 5;
    const scale = 1.0 + Math.min(voteCount * 0.1, 0.6);
    applySprite(item, color, alpha, glow, scale);
  }
}

// ── Events ────────────────────────────────────────────────────────────────────
window.addEventListener('lyria_panel_start', ({ detail: { words, duration } }) => {
  mode       = 'voting';
  roundWords = new Set(words);
  liveVotes  = {};
  top5       = [];

  sidebarTitleEl.textContent = 'LIVE VOTES';
  vibeCurrentEl.innerHTML    = '';
  refreshAll();

  // Countdown
  let remaining = Math.ceil(duration / 1000);
  countdownEl.textContent = `${remaining}s`;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    remaining--;
    countdownEl.textContent = remaining > 0 ? `${remaining}s` : '';
    if (remaining <= 0) clearInterval(countdownTimer);
  }, 1000);
});

window.addEventListener('lyria_vote_update', ({ detail: { votes: v } }) => {
  const changed = Object.keys(v).filter(w => liveVotes[w] !== v[w]);
  liveVotes = v;
  if (mode === 'voting') refreshWords(changed);
});

window.addEventListener('lyria_panel_result', ({ detail: { winner, votes: v } }) => {
  clearInterval(countdownTimer);
  countdownEl.textContent = '';
  mode      = 'result';
  liveVotes = v || {};

  // Build top 5 from vote counts
  const sorted = Object.entries(liveVotes)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  top5 = sorted.map(([word, count], rank) => ({ word, count, rank }));

  sidebarTitleEl.textContent = 'TOP VIBES';
  if (winner) vibeCurrentEl.innerHTML = `<span>${winner}</span>`;

  refreshAll();
});

// ── Load coords ───────────────────────────────────────────────────────────────
try {
  const res  = await fetch('/music_coords.json');
  coordsData = await res.json();
  refreshAll();
} catch (e) {
  console.warn('[VibeSidebar] Failed to load music_coords.json:', e.message);
}
