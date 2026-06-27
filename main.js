import { CONFIG } from "./config.js";

// ─── DOM ────────────────────────────────────────────────────────────────────

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const menuOverlay = document.getElementById("menu-overlay");
const defeatOverlay = document.getElementById("defeat-overlay");
const finalScoreEl = document.getElementById("final-score");
const playBtn = document.getElementById("play-btn");
const restartBtn = document.getElementById("restart-btn");
const musicToggle = document.getElementById("music-toggle");
const waveProgressEl = document.getElementById("wave-progress");
const waveNumberEl = document.getElementById("wave-number");
const waveProgressFillEl = document.getElementById("wave-progress-fill");
const waveProgressRemainingEl = document.getElementById("wave-progress-remaining");

canvas.width = CONFIG.canvas.width;
canvas.height = CONFIG.canvas.height;

// ─── State ──────────────────────────────────────────────────────────────────

const State = {
  MENU: "menu",
  PLAYING: "playing",
  HIT_PAUSE: "hit_pause",
  RESPAWN: "respawn",
  WAVE_CLEAR: "wave_clear",
  GAME_OVER: "game_over",
};

const game = {
  state: State.MENU,
  score: 0,
  lives: CONFIG.lives.starting,
  wave: 1,
  ship: null,
  bullets: [],
  enemyBullets: [],
  asteroids: [],
  ufos: [],
  particles: [],
  scorePopups: [],
  hitFlashes: [],
  input: { left: false, right: false, thrust: false, fire: false, hyperspace: false },
  fireHeld: false,
  hyperspaceHeld: false,
  stateTimer: 0,
  shakeTimer: 0,
  shakeAmplitude: 0,
  shakeDurationMax: 0,
  impactPauseTimer: 0,
  waveLabelTimer: 0,
  waveTargetsTotal: 0,
  waveTargetsDestroyed: 0,
  largeUfoTimer: CONFIG.ufo.large.spawnIntervalMs * 0.5,
  smallUfoTimer: CONFIG.ufo.small.spawnIntervalMs * 0.75,
  audioEnabled: CONFIG.audio.enabledByDefault,
  hitPingStep: 0,
  hitPingResetTimer: 0,
  lastTime: 0,
};

// ─── Utilities ──────────────────────────────────────────────────────────────

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

function wrapEntity(e) {
  const w = CONFIG.canvas.width;
  const h = CONFIG.canvas.height;
  if (e.x < 0) e.x += w;
  if (e.x > w) e.x -= w;
  if (e.y < 0) e.y += h;
  if (e.y > h) e.y -= h;
}

function isOffscreen(e, margin = 0) {
  const w = CONFIG.canvas.width;
  const h = CONFIG.canvas.height;
  return e.x < -margin || e.x > w + margin || e.y < -margin || e.y > h + margin;
}

function circlesOverlap(a, ar, b, br) {
  return dist(a.x, a.y, b.x, b.y) < ar + br;
}

function keyMatches(code, list) {
  return list.includes(code);
}

function updateHud() {
  scoreEl.textContent = String(game.score);
  livesEl.textContent = String(game.lives);
}

function resetWaveProgress(initialCount) {
  game.waveTargetsTotal = initialCount;
  game.waveTargetsDestroyed = 0;
  updateWaveProgressUI();
}

function addWaveThreat(count = 1) {
  game.waveTargetsTotal += count;
  updateWaveProgressUI();
}

function markWaveThreatDestroyed() {
  game.waveTargetsDestroyed += 1;
  updateWaveProgressUI();
}

function getWaveProgress() {
  if (game.waveTargetsTotal <= 0) return 1;
  return Math.min(1, game.waveTargetsDestroyed / game.waveTargetsTotal);
}

function getWaveRemaining() {
  return game.asteroids.length + game.ufos.length;
}

function updateWaveProgressUI() {
  const visible =
    game.state !== State.MENU && game.state !== State.GAME_OVER;
  waveProgressEl.classList.toggle("hidden", !visible);

  if (!visible) return;

  waveNumberEl.textContent = `Wave ${game.wave}`;

  const progressPct = Math.round(getWaveProgress() * 100);
  waveProgressFillEl.style.width = `${progressPct}%`;
  waveProgressEl.setAttribute("aria-valuenow", String(progressPct));

  const remaining = getWaveRemaining();
  if (remaining === 0 && game.state === State.WAVE_CLEAR) {
    waveProgressRemainingEl.textContent = "Clear!";
  } else if (remaining === 1) {
    waveProgressRemainingEl.textContent = "1 left";
  } else {
    waveProgressRemainingEl.textContent = `${remaining} left`;
  }
}

function showOverlay(el, visible) {
  el.classList.toggle("hidden", !visible);
}

// ─── Audio ──────────────────────────────────────────────────────────────────

let audioCtx = null;

const music = new Audio();
music.loop = true;
music.preload = "auto";
music.src = CONFIG.assets.music;

let musicGain = null;
let musicConnected = false;

const thrustHum = {
  active: false,
  nodes: null,
  stopTimer: null,
};

function getAudioContext() {
  if (!game.audioEnabled) return null;
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}

function getMusicGainValue() {
  const { masterVolume, musicVolume, musicAttenuation } = CONFIG.audio;
  return musicVolume * masterVolume * musicAttenuation;
}

function connectMusicToAudioGraph() {
  const ac = getAudioContext();
  if (!ac || musicConnected) return;

  const source = ac.createMediaElementSource(music);
  musicGain = ac.createGain();
  source.connect(musicGain);
  musicGain.connect(ac.destination);
  musicConnected = true;
  music.volume = 1;
}

function syncMusic(shouldPlay = game.state !== State.MENU && game.state !== State.GAME_OVER) {
  connectMusicToAudioGraph();

  const gain = getMusicGainValue();
  if (musicGain) {
    musicGain.gain.value = game.audioEnabled && shouldPlay ? gain : 0;
  } else {
    music.volume = gain;
  }

  if (!game.audioEnabled || !shouldPlay) {
    music.pause();
    return;
  }

  music.play().catch(() => {});
}

function startThrustHum() {
  const ac = getAudioContext();
  if (!ac || thrustHum.active) return;

  if (thrustHum.stopTimer) {
    clearTimeout(thrustHum.stopTimer);
    thrustHum.stopTimer = null;
  }

  const cfg = CONFIG.audio;
  const now = ac.currentTime;
  const fadeSec = cfg.thrustHumFadeMs / 1000;

  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "sine";
  osc.frequency.value = cfg.thrustHumFreq;
  filter.type = "lowpass";
  filter.frequency.value = cfg.thrustHumFilterHz;
  filter.Q.value = 0.7;

  const targetVol = cfg.thrustHumVolume * cfg.masterVolume;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(targetVol, 0.0002), now + fadeSec);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);

  thrustHum.active = true;
  thrustHum.nodes = { osc, filter, gain };
}

function stopThrustHum() {
  if (!thrustHum.active || !thrustHum.nodes) return;

  const ac = audioCtx;
  const nodes = thrustHum.nodes;
  thrustHum.active = false;
  thrustHum.nodes = null;

  if (!ac) return;

  const now = ac.currentTime;
  const fadeSec = CONFIG.audio.thrustHumFadeMs / 1000;
  nodes.gain.gain.cancelScheduledValues(now);
  nodes.gain.gain.setValueAtTime(Math.max(nodes.gain.gain.value, 0.0001), now);
  nodes.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);

  if (thrustHum.stopTimer) clearTimeout(thrustHum.stopTimer);
  thrustHum.stopTimer = setTimeout(() => {
    try {
      nodes.osc.stop();
    } catch {
      // Oscillator may already be stopped.
    }
    thrustHum.stopTimer = null;
  }, CONFIG.audio.thrustHumFadeMs + 40);
}

function playTone({ freq = 440, duration = 0.1, type = "sine", volume = 0.12, freqEnd = null, attack = 0.008, startTime = null }) {
  const ac = getAudioContext();
  if (!ac) return;

  const now = startTime ?? ac.currentTime;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const vol = volume * CONFIG.audio.masterVolume;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (freqEnd) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 30), now + duration);
  }

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(vol, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playSciFiLaser({
  freq,
  freqEnd,
  duration = 0.08,
  type = "square",
  volume = 0.1,
  filterHz = 2400,
  filterType = "lowpass",
  attack = 0.004,
  startTime = null,
}) {
  const ac = getAudioContext();
  if (!ac) return;

  const now = startTime ?? ac.currentTime;
  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  const vol = volume * CONFIG.audio.masterVolume;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 30), now + duration);
  filter.type = filterType;
  filter.frequency.value = filterHz;
  filter.Q.value = filterType === "bandpass" ? 2.4 : 0.8;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(vol, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playSciFiBurst({
  duration = 0.16,
  volume = 0.11,
  filterStart = 1200,
  filterEnd = 140,
  filterType = "bandpass",
  q = 1.8,
  startTime = null,
}) {
  const ac = getAudioContext();
  if (!ac) return;

  const now = startTime ?? ac.currentTime;
  const bufferSize = Math.max(1, Math.floor(ac.sampleRate * duration));
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ac.createBufferSource();
  source.buffer = buffer;
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();
  const vol = volume * CONFIG.audio.masterVolume;

  filter.type = filterType;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(filterStart, now);
  filter.frequency.exponentialRampToValueAtTime(Math.max(filterEnd, 40), now + duration);

  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function playProjectileHitPing() {
  const ac = getAudioContext();
  if (!ac) return;

  const cfg = CONFIG.audio.hitPing;
  const step = Math.min(game.hitPingStep, cfg.maxStep);
  const now = ac.currentTime;
  const frequency = cfg.baseFreq * cfg.pitchRatio ** step;
  const vol = cfg.volume * CONFIG.audio.masterVolume;

  const osc = ac.createOscillator();
  const filter = ac.createBiquadFilter();
  const gain = ac.createGain();

  osc.type = "square";
  osc.frequency.setValueAtTime(frequency, now);
  osc.frequency.exponentialRampToValueAtTime(frequency * cfg.pitchBend, now + 0.04);
  filter.type = "bandpass";
  filter.frequency.value = frequency * 1.6;
  filter.Q.value = 3.2;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(vol, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + cfg.durationSec);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ac.destination);
  osc.start(now);
  osc.stop(now + cfg.durationSec + 0.02);

  game.hitPingStep += 1;
  game.hitPingResetTimer = cfg.comboResetMs;
}

function updateHitPingCombo(dt) {
  if (game.hitPingResetTimer <= 0) return;
  game.hitPingResetTimer -= dt * 1000;
  if (game.hitPingResetTimer <= 0) {
    game.hitPingStep = 0;
  }
}

const SFX = {
  spawn() {
    const ac = getAudioContext();
    if (!ac) return;
    const now = ac.currentTime;
    playSciFiLaser({ freq: 280, freqEnd: 920, duration: 0.14, volume: 0.08, type: "triangle", filterHz: 1800, startTime: now });
    playTone({ freq: 520, freqEnd: 1040, duration: 0.1, type: "square", volume: 0.06, startTime: now + 0.05 });
  },
  shoot() {
    playSciFiLaser({ freq: 1480, freqEnd: 160, duration: 0.09, volume: 0.1, type: "square", filterHz: 2600 });
  },
  destroy(size = "medium") {
    const scale = size === "large" ? 0.75 : size === "small" ? 1.35 : 1;
    playSciFiBurst({
      duration: 0.12 * scale,
      volume: 0.1,
      filterStart: 900 * scale,
      filterEnd: 120,
    });
    playSciFiLaser({
      freq: (size === "large" ? 220 : size === "small" ? 480 : 340) * scale,
      freqEnd: 50,
      duration: 0.12 * scale,
      volume: 0.08,
      type: "sawtooth",
      filterHz: 1400,
    });
  },
  ufoDestroy() {
    playSciFiBurst({ duration: 0.22, volume: 0.11, filterStart: 700, filterEnd: 90, q: 2.2 });
    playSciFiLaser({ freq: 520, freqEnd: 40, duration: 0.2, volume: 0.09, type: "square", filterHz: 1200 });
  },
  death() {
    playSciFiBurst({ duration: 0.35, volume: 0.13, filterStart: 1100, filterEnd: 60, q: 2.4 });
    playSciFiLaser({ freq: 380, freqEnd: 28, duration: 0.4, volume: 0.1, type: "sawtooth", filterHz: 900 });
    playTone({ freq: 160, freqEnd: 40, duration: 0.35, type: "square", volume: 0.07 });
  },
  hyperspace() {
    const ac = getAudioContext();
    if (!ac) return;
    const now = ac.currentTime;
    playSciFiBurst({ duration: 0.28, volume: 0.08, filterStart: 180, filterEnd: 4200, filterType: "bandpass", q: 2.8, startTime: now });
    playSciFiLaser({ freq: 90, freqEnd: 880, duration: 0.22, volume: 0.09, type: "sine", filterHz: 3200, startTime: now });
    playSciFiLaser({ freq: 880, freqEnd: 120, duration: 0.18, volume: 0.06, type: "triangle", filterHz: 1800, startTime: now + 0.12 });
  },
  wave() {
    const ac = getAudioContext();
    if (!ac) return;
    const now = ac.currentTime;
    [520, 780, 1040].forEach((freq, i) => {
      playTone({ freq, freqEnd: freq * 1.08, duration: 0.07, type: "square", volume: 0.07, startTime: now + i * 0.07 });
    });
  },
  ufoSpawn() {
    const ac = getAudioContext();
    if (!ac) return;
    const now = ac.currentTime;
    [440, 320, 440, 280].forEach((freq, i) => {
      playSciFiLaser({
        freq,
        freqEnd: freq * 0.65,
        duration: 0.07,
        volume: 0.06,
        type: "square",
        filterHz: 900,
        startTime: now + i * 0.08,
      });
    });
  },
  enemyShot() {
    playSciFiLaser({ freq: 520, freqEnd: 90, duration: 0.07, volume: 0.07, type: "triangle", filterHz: 1400 });
  },
};

// ─── Particles ──────────────────────────────────────────────────────────────

function spawnParticles(x, y, count, speedMin, speedMax, lifeMs, colors = null) {
  const color = colors?.color ?? CONFIG.colors.particle;
  const brightColor = colors?.bright ?? CONFIG.colors.particleBright;
  for (let i = 0; i < count; i += 1) {
    const angle = rand(0, Math.PI * 2);
    const speed = rand(speedMin, speedMax);
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: lifeMs,
      maxLife: lifeMs,
      size: rand(1.5, 3.5),
      color,
      brightColor,
    });
  }
}

function updateParticles(dt) {
  game.particles = game.particles.filter((p) => {
    p.life -= dt * 1000;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98;
    p.vy *= 0.98;
    wrapEntity(p);
    return p.life > 0;
  });
}

function drawParticles() {
  for (const p of game.particles) {
    const alpha = p.life / p.maxLife;
    ctx.beginPath();
    ctx.fillStyle = alpha > 0.5 ? p.brightColor : p.color;
    ctx.globalAlpha = alpha * 0.9;
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function spawnScorePopup(x, y, points) {
  game.scorePopups.push({
    x,
    y,
    text: `+${points}`,
    life: CONFIG.effects.scorePopupLifeMs,
    maxLife: CONFIG.effects.scorePopupLifeMs,
    vy: CONFIG.effects.scorePopupDriftSpeed,
  });
}

function updateScorePopups(dt) {
  game.scorePopups = game.scorePopups.filter((p) => {
    p.life -= dt * 1000;
    p.y -= p.vy * dt;
    return p.life > 0;
  });
}

function drawScorePopups() {
  for (const p of game.scorePopups) {
    const alpha = Math.min(1, p.life / (p.maxLife * 0.55));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = CONFIG.colors.neonBright;
    ctx.font = `bold ${CONFIG.effects.scorePopupFontSize}px Courier New, monospace`;
    ctx.textAlign = "center";
    ctx.shadowColor = CONFIG.colors.neonGlow;
    ctx.shadowBlur = 10;
    ctx.fillText(p.text, p.x, p.y);
    ctx.restore();
  }
}

// ─── Entity Factories ───────────────────────────────────────────────────────

function createShip(x, y, invuln = true) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    thrusting: false,
    invulnMs: invuln ? CONFIG.ship.invulnMs : 0,
    bulletCooldown: 0,
    hyperspaceCooldown: 0,
    alive: true,
    thrustTimer: 0,
  };
}

function createBullet(x, y, angle, speed, fromEnemy = false) {
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: fromEnemy ? CONFIG.ufo.bulletLifetimeMs : CONFIG.bullet.lifetimeMs,
    radius: fromEnemy ? CONFIG.ufo.bulletRadius : CONFIG.bullet.radius,
    fromEnemy,
  };
}

function generateAsteroidShape(radius, vertices, jaggedness) {
  const offsets = [];
  for (let i = 0; i < vertices; i += 1) {
    offsets.push(1 - jaggedness + Math.random() * jaggedness * 2);
  }
  return offsets;
}

function createAsteroid(x, y, size, speedScale = 1) {
  const cfg = CONFIG.asteroid[size];
  const angle = rand(0, Math.PI * 2);
  const speed = cfg.speed * speedScale * rand(0.85, 1.15);
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    radius: cfg.radius,
    rotation: rand(0, Math.PI * 2),
    rotSpeed: rand(-1.8, 1.8),
    vertices: cfg.vertices,
    offsets: generateAsteroidShape(cfg.radius, cfg.vertices, CONFIG.asteroid.jaggedness),
    score: cfg.score,
  };
}

function spawnAsteroidAtEdge(size, speedScale = 1) {
  const w = CONFIG.canvas.width;
  const h = CONFIG.canvas.height;
  const pad = CONFIG.asteroid.spawnEdgePadding;
  const edge = randInt(0, 3);
  let x;
  let y;
  if (edge === 0) {
    x = rand(0, w);
    y = -pad;
  } else if (edge === 1) {
    x = w + pad;
    y = rand(0, h);
  } else if (edge === 2) {
    x = rand(0, w);
    y = h + pad;
  } else {
    x = -pad;
    y = rand(0, h);
  }
  return createAsteroid(x, y, size, speedScale);
}

function createUfo(type) {
  const cfg = CONFIG.ufo[type];
  const w = CONFIG.canvas.width;
  const h = CONFIG.canvas.height;
  const fromLeft = Math.random() < 0.5;
  const y = rand(h * 0.15, h * 0.85);
  const x = fromLeft ? -CONFIG.ufo.spawnEdgePadding : w + CONFIG.ufo.spawnEdgePadding;
  const dir = fromLeft ? 1 : -1;
  return {
    type,
    x,
    y,
    vx: dir * cfg.speed,
    vy: rand(-20, 20),
    radius: cfg.radius,
    score: cfg.score,
    fireTimer: cfg.fireIntervalMs * rand(0.4, 0.9),
    wobble: rand(0, Math.PI * 2),
  };
}

// ─── Wave Management ────────────────────────────────────────────────────────

function waveSpeedScale() {
  return CONFIG.wave.speedMultiplierPerWave ** (game.wave - 1);
}

function spawnWave() {
  game.asteroids = [];
  const count = Math.min(
    CONFIG.wave.initialLargeCount + (game.wave - 1) * CONFIG.wave.countIncreasePerWave,
    CONFIG.wave.maxLargeCount,
  );
  const scale = waveSpeedScale();
  for (let i = 0; i < count; i += 1) {
    game.asteroids.push(spawnAsteroidAtEdge("large", scale));
  }
  resetWaveProgress(count);
  game.waveLabelTimer = CONFIG.wave.waveLabelMs;
  SFX.wave();
  spawnParticles(
    CONFIG.canvas.width / 2,
    CONFIG.canvas.height / 2,
    CONFIG.effects.spawnParticleCount,
    CONFIG.effects.particleSpeedMin,
    CONFIG.effects.particleSpeedMax,
    CONFIG.effects.particleLifeMs,
  );
}

function checkWaveClear() {
  if (game.asteroids.length === 0 && game.ufos.length === 0 && game.state === State.PLAYING) {
    game.state = State.WAVE_CLEAR;
    game.stateTimer = CONFIG.wave.waveClearDelayMs;
  }
}

// ─── Ship Logic ───────────────────────────────────────────────────────────────

function resetShip(invuln = true) {
  const cx = CONFIG.canvas.width / 2;
  const cy = CONFIG.canvas.height / 2;
  game.ship = createShip(cx, cy, invuln);
  SFX.spawn();
  spawnParticles(
    cx,
    cy,
    CONFIG.effects.spawnParticleCount,
    CONFIG.effects.particleSpeedMin * 0.6,
    CONFIG.effects.particleSpeedMax * 0.6,
    CONFIG.effects.particleLifeMs,
    {
      color: CONFIG.colors.player,
      bright: CONFIG.colors.player,
    },
  );
}

function fireBullet() {
  const ship = game.ship;
  if (!ship || !ship.alive || ship.bulletCooldown > 0) return;
  if (game.bullets.length >= CONFIG.bullet.maxOnScreen) return;

  const noseX = ship.x + Math.cos(ship.angle) * CONFIG.ship.radius;
  const noseY = ship.y + Math.sin(ship.angle) * CONFIG.ship.radius;
  game.bullets.push(createBullet(noseX, noseY, ship.angle, CONFIG.bullet.speed));
  ship.bulletCooldown = CONFIG.ship.bulletCooldownMs;
  SFX.shoot();
}

function isPositionUnsafe(x, y, radius) {
  for (const a of game.asteroids) {
    if (circlesOverlap({ x, y }, radius, a, a.radius)) return true;
  }
  for (const u of game.ufos) {
    if (circlesOverlap({ x, y }, radius, u, u.radius)) return true;
  }
  for (const b of game.enemyBullets) {
    if (circlesOverlap({ x, y }, radius, b, b.radius)) return true;
  }
  return false;
}

function hyperspace() {
  const ship = game.ship;
  if (!ship || !ship.alive || ship.hyperspaceCooldown > 0) return;

  ship.hyperspaceCooldown = CONFIG.ship.hyperspaceCooldownMs;
  SFX.hyperspace();

  const w = CONFIG.canvas.width;
  const h = CONFIG.canvas.height;
  let attempts = 0;
  let nx;
  let ny;
  do {
    nx = rand(CONFIG.ship.radius * 2, w - CONFIG.ship.radius * 2);
    ny = rand(CONFIG.ship.radius * 2, h - CONFIG.ship.radius * 2);
    attempts += 1;
  } while (isPositionUnsafe(nx, ny, CONFIG.ship.hyperspaceOverlapRadius) && attempts < 30);

  ship.x = nx;
  ship.y = ny;
  ship.vx = 0;
  ship.vy = 0;

  spawnParticles(nx, ny, 14, 80, 180, 400);

  if (isPositionUnsafe(nx, ny, CONFIG.ship.hyperspaceOverlapRadius)) {
    killPlayer();
  }
}

function updateShip(dt) {
  const ship = game.ship;
  if (!ship || !ship.alive) {
    stopThrustHum();
    return;
  }

  ship.bulletCooldown = Math.max(0, ship.bulletCooldown - dt * 1000);
  ship.hyperspaceCooldown = Math.max(0, ship.hyperspaceCooldown - dt * 1000);
  if (ship.invulnMs > 0) ship.invulnMs -= dt * 1000;

  if (game.input.left) ship.angle -= CONFIG.ship.rotationSpeed * dt;
  if (game.input.right) ship.angle += CONFIG.ship.rotationSpeed * dt;

  ship.thrusting = game.input.thrust;
  if (game.input.thrust) {
    startThrustHum();
    ship.vx += Math.cos(ship.angle) * CONFIG.ship.thrustAccel * dt;
    ship.vy += Math.sin(ship.angle) * CONFIG.ship.thrustAccel * dt;
    ship.thrustTimer += dt * 1000;
    if (ship.thrustTimer >= CONFIG.effects.thrustParticleIntervalMs) {
      ship.thrustTimer = 0;
      const tx = ship.x - Math.cos(ship.angle) * CONFIG.ship.radius * 0.8;
      const ty = ship.y - Math.sin(ship.angle) * CONFIG.ship.radius * 0.8;
      spawnParticles(tx, ty, 2, 20, 80, 250, {
        color: CONFIG.colors.player,
        bright: CONFIG.colors.player,
      });
    }
  } else {
    stopThrustHum();
  }

  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > CONFIG.ship.maxSpeed) {
    const scale = CONFIG.ship.maxSpeed / speed;
    ship.vx *= scale;
    ship.vy *= scale;
  }

  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  wrapEntity(ship);

  if (game.input.fire && !game.fireHeld) {
    fireBullet();
  }
  game.fireHeld = game.input.fire;

  if (game.input.hyperspace && !game.hyperspaceHeld) {
    hyperspace();
  }
  game.hyperspaceHeld = game.input.hyperspace;
}

// ─── UFO Logic ────────────────────────────────────────────────────────────────

function ufoFire(ufo) {
  if (game.enemyBullets.length >= CONFIG.ufo.maxOnScreen) return;

  let angle;
  const ship = game.ship;
  if (ship?.alive) {
    angle = Math.atan2(ship.y - ufo.y, ship.x - ufo.x);
    const spread = CONFIG.ufo[ufo.type].aimSpread;
    angle += rand(-spread, spread);
  } else {
    angle = rand(0, Math.PI * 2);
  }

  game.enemyBullets.push(createBullet(ufo.x, ufo.y, angle, CONFIG.ufo.bulletSpeed, true));
  SFX.enemyShot();
}

function updateUfos(dt) {
  for (const ufo of game.ufos) {
    ufo.wobble += dt * 3;
    ufo.y += Math.sin(ufo.wobble) * 30 * dt;
    ufo.x += ufo.vx * dt;
    ufo.y += ufo.vy * dt;
    wrapEntity(ufo);

    const cfg = CONFIG.ufo[ufo.type];
    ufo.fireTimer -= dt * 1000;
    if (ufo.fireTimer <= 0) {
      ufoFire(ufo);
      ufo.fireTimer = cfg.fireIntervalMs * rand(0.8, 1.2);
    }
  }
}

function updateUfoSpawning(dt) {
  if (game.state !== State.PLAYING) return;

  game.largeUfoTimer -= dt * 1000;
  if (game.largeUfoTimer <= 0 && game.ufos.filter((u) => u.type === "large").length === 0) {
    game.ufos.push(createUfo("large"));
    addWaveThreat(1);
    game.largeUfoTimer = CONFIG.ufo.large.spawnIntervalMs;
    SFX.ufoSpawn();
  }

  if (game.score >= CONFIG.ufo.small.scoreThreshold) {
    game.smallUfoTimer -= dt * 1000;
    if (game.smallUfoTimer <= 0 && game.ufos.filter((u) => u.type === "small").length === 0) {
      game.ufos.push(createUfo("small"));
      addWaveThreat(1);
      game.smallUfoTimer = CONFIG.ufo.small.spawnIntervalMs;
      SFX.ufoSpawn();
    }
  }
}

// ─── Collisions ─────────────────────────────────────────────────────────────

function splitAsteroid(asteroid) {
  game.score += asteroid.score;
  updateHud();
  spawnScorePopup(asteroid.x, asteroid.y, asteroid.score);
  markWaveThreatDestroyed();
  if (asteroid.size === "large" || asteroid.size === "medium") {
    addWaveThreat(1);
  }
  SFX.destroy(asteroid.size);
  spawnParticles(
    asteroid.x,
    asteroid.y,
    CONFIG.effects.hitParticleCount,
    CONFIG.effects.particleSpeedMin,
    CONFIG.effects.particleSpeedMax,
    CONFIG.effects.particleLifeMs,
  );

  if (asteroid.size === "large") {
    const scale = waveSpeedScale();
    game.asteroids.push(createAsteroid(asteroid.x, asteroid.y, "medium", scale));
    game.asteroids.push(createAsteroid(asteroid.x, asteroid.y, "medium", scale));
  } else if (asteroid.size === "medium") {
    const scale = waveSpeedScale();
    game.asteroids.push(createAsteroid(asteroid.x, asteroid.y, "small", scale));
    game.asteroids.push(createAsteroid(asteroid.x, asteroid.y, "small", scale));
  }
}

function destroyUfo(ufo) {
  game.score += ufo.score;
  updateHud();
  spawnScorePopup(ufo.x, ufo.y, ufo.score);
  markWaveThreatDestroyed();
  SFX.ufoDestroy();
  spawnParticles(
    ufo.x,
    ufo.y,
    CONFIG.effects.ufoDestroyParticleCount,
    CONFIG.effects.particleSpeedMin,
    CONFIG.effects.particleSpeedMax,
    CONFIG.effects.particleLifeMs,
  );
}

function triggerShake(durationMs, amplitude) {
  game.shakeDurationMax = Math.max(game.shakeDurationMax, durationMs);
  game.shakeTimer = Math.max(game.shakeTimer, durationMs);
  game.shakeAmplitude = Math.max(game.shakeAmplitude, amplitude);
}

function spawnAsteroidFlash(asteroid, flashMs) {
  game.hitFlashes.push({
    kind: "asteroid",
    x: asteroid.x,
    y: asteroid.y,
    radius: asteroid.radius,
    vertices: asteroid.vertices,
    offsets: asteroid.offsets.slice(),
    rotation: asteroid.rotation,
    life: flashMs,
    maxLife: flashMs,
  });
}

function spawnUfoFlash(ufo, flashMs) {
  game.hitFlashes.push({
    kind: "ufo",
    x: ufo.x,
    y: ufo.y,
    radius: ufo.radius,
    ufoType: ufo.type,
    life: flashMs,
    maxLife: flashMs,
  });
}

function spawnShipFlash(ship, flashMs) {
  game.hitFlashes.push({
    kind: "ship",
    x: ship.x,
    y: ship.y,
    angle: ship.angle,
    life: flashMs,
    maxLife: flashMs,
  });
}

function triggerProjectileHitFeel(entity) {
  const fx = CONFIG.effects;
  game.impactPauseTimer = Math.max(game.impactPauseTimer, fx.projectileHitPauseMs);
  triggerShake(fx.projectileShakeDurationMs, fx.projectileShakeAmplitude);
  if (entity.size) {
    spawnAsteroidFlash(entity, fx.projectileHitFlashMs);
  } else {
    spawnUfoFlash(entity, fx.projectileHitFlashMs);
  }
  spawnParticles(
    entity.x,
    entity.y,
    fx.bulletHitParticleCount,
    fx.particleSpeedMin * 0.5,
    fx.particleSpeedMax * 0.65,
    fx.particleLifeMs * 0.55,
  );
  playProjectileHitPing();
}

function killPlayer(hitEntity = null) {
  const ship = game.ship;
  if (!ship || !ship.alive || ship.invulnMs > 0) return;

  stopThrustHum();
  ship.alive = false;
  game.hitPingStep = 0;
  game.hitPingResetTimer = 0;
  game.lives -= 1;
  updateHud();

  SFX.death();
  spawnParticles(
    ship.x,
    ship.y,
    CONFIG.effects.deathParticleCount,
    CONFIG.effects.particleSpeedMin,
    CONFIG.effects.particleSpeedMax,
    CONFIG.effects.particleLifeMs * 1.2,
    {
      color: CONFIG.colors.player,
      bright: CONFIG.colors.player,
    },
  );

  game.shakeTimer = CONFIG.effects.shakeDurationMs;
  game.shakeDurationMax = CONFIG.effects.shakeDurationMs;
  game.shakeAmplitude = CONFIG.effects.shakeAmplitude;
  if (hitEntity?.size) {
    spawnAsteroidFlash(hitEntity, CONFIG.effects.hitFlashMs);
  } else if (hitEntity?.type) {
    spawnUfoFlash(hitEntity, CONFIG.effects.hitFlashMs);
  } else {
    spawnShipFlash(ship, CONFIG.effects.hitFlashMs);
  }
  game.stateTimer = CONFIG.effects.hitPauseMs;
  game.state = State.HIT_PAUSE;

  game.bullets = [];
}

function handleCollisions() {
  const ship = game.ship;

  // Player bullets vs asteroids
  game.bullets = game.bullets.filter((b) => {
    let hit = false;
    for (let i = game.asteroids.length - 1; i >= 0; i -= 1) {
      const a = game.asteroids[i];
      if (circlesOverlap(b, b.radius, a, a.radius)) {
        game.asteroids.splice(i, 1);
        triggerProjectileHitFeel(a);
        splitAsteroid(a);
        hit = true;
        break;
      }
    }
    if (hit) return false;

    for (let i = game.ufos.length - 1; i >= 0; i -= 1) {
      const u = game.ufos[i];
      if (circlesOverlap(b, b.radius, u, u.radius)) {
        game.ufos.splice(i, 1);
        triggerProjectileHitFeel(u);
        destroyUfo(u);
        return false;
      }
    }
    return true;
  });

  if (!ship?.alive || ship.invulnMs > 0) {
    checkWaveClear();
    return;
  }

  // Ship vs asteroids
  for (const a of game.asteroids) {
    if (circlesOverlap(ship, CONFIG.ship.radius * 0.7, a, a.radius * 0.85)) {
      killPlayer(a);
      return;
    }
  }

  // Ship vs ufos
  for (const u of game.ufos) {
    if (circlesOverlap(ship, CONFIG.ship.radius * 0.7, u, u.radius * 0.85)) {
      killPlayer(u);
      return;
    }
  }

  // Enemy bullets vs ship
  game.enemyBullets = game.enemyBullets.filter((b) => {
    if (circlesOverlap(b, b.radius, ship, CONFIG.ship.radius * 0.6)) {
      killPlayer();
      return false;
    }
    return true;
  });

  checkWaveClear();
}

// ─── Update Loop ────────────────────────────────────────────────────────────

function updateBullets(dt) {
  game.bullets = game.bullets.filter((b) => {
    b.life -= dt * 1000;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (isOffscreen(b, b.radius)) return false;
    return b.life > 0;
  });

  game.enemyBullets = game.enemyBullets.filter((b) => {
    b.life -= dt * 1000;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (isOffscreen(b, b.radius)) return false;
    return b.life > 0;
  });
}

function updateAsteroids(dt) {
  for (const a of game.asteroids) {
    a.x += a.vx * dt;
    a.y += a.vy * dt;
    a.rotation += a.rotSpeed * dt;
    wrapEntity(a);
  }
}

function updateHitFlashes(dt) {
  game.hitFlashes = game.hitFlashes.filter((f) => {
    f.life -= dt * 1000;
    return f.life > 0;
  });
}

function decayImpactEffects(dt) {
  if (game.shakeTimer > 0) {
    game.shakeTimer -= dt * 1000;
    if (game.shakeTimer <= 0) {
      game.shakeAmplitude = 0;
      game.shakeDurationMax = 0;
    }
  }
  updateHitFlashes(dt);
  if (game.waveLabelTimer > 0) game.waveLabelTimer -= dt * 1000;
}

function updatePlaying(dt) {
  if (game.impactPauseTimer > 0) {
    game.impactPauseTimer -= dt * 1000;
    updateParticles(dt);
    updateScorePopups(dt);
    updateHitPingCombo(dt);
    decayImpactEffects(dt);
    return;
  }

  updateShip(dt);
  updateBullets(dt);
  updateAsteroids(dt);
  updateUfos(dt);
  updateUfoSpawning(dt);
  handleCollisions();
  updateParticles(dt);
  updateScorePopups(dt);
  updateHitPingCombo(dt);
  decayImpactEffects(dt);
}

function updateStateMachine(dt) {
  if (game.state === State.PLAYING) {
    updatePlaying(dt);
    return;
  }

  if (game.state === State.HIT_PAUSE) {
    game.stateTimer -= dt * 1000;
    decayImpactEffects(dt);
    updateParticles(dt);
    updateScorePopups(dt);
    updateAsteroids(dt);
    updateUfos(dt);
    updateBullets(dt);

    if (game.stateTimer <= 0) {
      if (game.lives <= 0) {
        game.state = State.GAME_OVER;
        finalScoreEl.textContent = `Score: ${game.score}`;
        showOverlay(defeatOverlay, true);
        syncMusic(false);
      } else {
        game.state = State.RESPAWN;
        game.stateTimer = CONFIG.effects.respawnDelayMs;
      }
    }
    return;
  }

  if (game.state === State.RESPAWN) {
    game.stateTimer -= dt * 1000;
    updateParticles(dt);
    updateScorePopups(dt);
    updateAsteroids(dt);
    updateUfos(dt);
    updateBullets(dt);

    if (game.stateTimer <= 0) {
      resetShip(true);
      game.state = State.PLAYING;
    }
    return;
  }

  if (game.state === State.WAVE_CLEAR) {
    game.stateTimer -= dt * 1000;
    updateParticles(dt);
    updateScorePopups(dt);

    if (game.stateTimer <= 0) {
      game.wave += 1;
      game.enemyBullets = [];
      spawnWave();
      game.state = State.PLAYING;
    }
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function getShakeOffset() {
  if (game.shakeTimer <= 0) return { x: 0, y: 0 };
  const duration = game.shakeDurationMax || CONFIG.effects.shakeDurationMs;
  const progress = 1 - game.shakeTimer / duration;
  const amplitude = game.shakeAmplitude * (1 - progress);
  return {
    x: Math.sin(game.shakeTimer * 0.085) * amplitude,
    y: Math.cos(game.shakeTimer * 0.11) * amplitude * 0.55,
  };
}

function drawAsteroid(a) {
  ctx.strokeStyle = CONFIG.colors.neon;
  ctx.lineWidth = CONFIG.asteroid.lineWidth;
  ctx.shadowColor = CONFIG.colors.neonGlow;
  ctx.shadowBlur = 6;
  ctx.beginPath();
  for (let i = 0; i < a.vertices; i += 1) {
    const angle = a.rotation + (i / a.vertices) * Math.PI * 2;
    const r = a.radius * a.offsets[i];
    const px = a.x + Math.cos(angle) * r;
    const py = a.y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawShip(ship) {
  if (!ship.alive) return;

  const blink = ship.invulnMs > 0 && Math.floor(ship.invulnMs / 120) % 2 === 0;
  if (blink) return;

  ctx.save();
  ctx.translate(ship.x, ship.y);
  ctx.rotate(ship.angle);

  ctx.strokeStyle = CONFIG.colors.player;
  ctx.lineWidth = CONFIG.ship.lineWidth;
  ctx.shadowColor = CONFIG.colors.playerGlow;
  ctx.shadowBlur = 8;

  ctx.beginPath();
  ctx.moveTo(CONFIG.ship.radius, 0);
  ctx.lineTo(-CONFIG.ship.radius * 0.7, CONFIG.ship.radius * 0.65);
  ctx.lineTo(-CONFIG.ship.radius * 0.4, 0);
  ctx.lineTo(-CONFIG.ship.radius * 0.7, -CONFIG.ship.radius * 0.65);
  ctx.closePath();
  ctx.stroke();

  if (ship.thrusting) {
    ctx.strokeStyle = CONFIG.colors.playerThrust;
    ctx.lineWidth = CONFIG.ship.thrustTrailWidth;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(-CONFIG.ship.radius * 0.5, 0);
    ctx.lineTo(-CONFIG.ship.radius * 1.3 - rand(0, 4), 0);
    ctx.stroke();
  }

  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawUfo(ufo) {
  ctx.strokeStyle = CONFIG.colors.neon;
  ctx.lineWidth = CONFIG.ufo[ufo.type].lineWidth;
  ctx.shadowColor = CONFIG.colors.neonGlow;
  ctx.shadowBlur = 6;

  const r = ufo.radius;
  ctx.beginPath();
  ctx.ellipse(ufo.x, ufo.y, r * 1.4, r * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(ufo.x, ufo.y - r * 0.25, r * 0.45, Math.PI, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(ufo.x - r * 0.9, ufo.y);
  ctx.lineTo(ufo.x + r * 0.9, ufo.y);
  ctx.stroke();

  ctx.shadowBlur = 0;
}

function drawBullets() {
  ctx.strokeStyle = CONFIG.colors.player;
  ctx.lineWidth = CONFIG.bullet.lineWidth;
  ctx.shadowColor = CONFIG.colors.playerGlow;
  ctx.shadowBlur = 4;

  for (const b of game.bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = CONFIG.colors.neonDim;
  for (const b of game.enemyBullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

function drawWaveLabel() {
  if (game.waveLabelTimer <= 0) return;
  const alpha = Math.min(1, game.waveLabelTimer / 400);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = CONFIG.colors.neon;
  ctx.font = "bold 28px Courier New, monospace";
  ctx.textAlign = "center";
  ctx.shadowColor = CONFIG.colors.neonGlow;
  ctx.shadowBlur = 12;
  ctx.fillText(`WAVE ${game.wave}`, CONFIG.canvas.width / 2, CONFIG.canvas.height / 2 - 40);
  ctx.restore();
}

function drawHitFlashes() {
  const interval = CONFIG.effects.hitFlashIntervalMs;

  for (const f of game.hitFlashes) {
    const on = Math.floor(f.life / interval) % 2 === 0;
    if (!on) continue;

    const alpha = Math.min(1, f.life / (f.maxLife * 0.55)) * 0.9;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = CONFIG.colors.hitFlash;
    ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
    ctx.shadowColor = "rgba(255, 255, 255, 0.85)";
    ctx.shadowBlur = 14;

    if (f.kind === "asteroid") {
      ctx.lineWidth = CONFIG.asteroid.lineWidth + 1;
      ctx.beginPath();
      for (let i = 0; i < f.vertices; i += 1) {
        const angle = f.rotation + (i / f.vertices) * Math.PI * 2;
        const r = f.radius * f.offsets[i];
        const px = f.x + Math.cos(angle) * r;
        const py = f.y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (f.kind === "ufo") {
      ctx.lineWidth = CONFIG.ufo[f.ufoType].lineWidth + 1;
      const r = f.radius;
      ctx.beginPath();
      ctx.ellipse(f.x, f.y, r * 1.4, r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(f.x, f.y - r * 0.25, r * 0.45, Math.PI, 0);
      ctx.stroke();
    } else if (f.kind === "ship") {
      ctx.lineWidth = CONFIG.ship.lineWidth + 1;
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);
      ctx.beginPath();
      ctx.moveTo(CONFIG.ship.radius, 0);
      ctx.lineTo(-CONFIG.ship.radius * 0.7, CONFIG.ship.radius * 0.65);
      ctx.lineTo(-CONFIG.ship.radius * 0.4, 0);
      ctx.lineTo(-CONFIG.ship.radius * 0.7, -CONFIG.ship.radius * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }
}

function render() {
  ctx.fillStyle = CONFIG.colors.background;
  ctx.fillRect(0, 0, CONFIG.canvas.width, CONFIG.canvas.height);

  const shake = getShakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);

  for (const a of game.asteroids) drawAsteroid(a);
  for (const u of game.ufos) drawUfo(u);
  drawBullets();
  drawParticles();
  drawScorePopups();
  drawHitFlashes();
  if (game.ship) drawShip(game.ship);
  drawWaveLabel();

  ctx.restore();
}

// ─── Game Flow ──────────────────────────────────────────────────────────────

function startGame() {
  stopThrustHum();
  game.score = 0;
  game.lives = CONFIG.lives.starting;
  game.wave = 1;
  game.bullets = [];
  game.enemyBullets = [];
  game.ufos = [];
  game.particles = [];
  game.scorePopups = [];
  game.hitFlashes = [];
  game.largeUfoTimer = CONFIG.ufo.large.spawnIntervalMs * 0.5;
  game.smallUfoTimer = CONFIG.ufo.small.spawnIntervalMs * 0.75;
  game.shakeTimer = 0;
  game.shakeAmplitude = 0;
  game.shakeDurationMax = 0;
  game.impactPauseTimer = 0;
  game.waveLabelTimer = 0;
  game.hitPingStep = 0;
  game.hitPingResetTimer = 0;

  updateHud();
  showOverlay(menuOverlay, false);
  showOverlay(defeatOverlay, false);

  resetShip(true);
  spawnWave();
  game.state = State.PLAYING;
  syncMusic(true);
}

function gameLoop(timestamp) {
  const dt = Math.min((timestamp - game.lastTime) / 1000, 0.05);
  game.lastTime = timestamp;

  if (game.state !== State.MENU && game.state !== State.GAME_OVER) {
    updateStateMachine(dt);
  }

  updateWaveProgressUI();
  render();
  requestAnimationFrame(gameLoop);
}

// ─── Input ──────────────────────────────────────────────────────────────────

function setKey(code, down) {
  if (keyMatches(code, CONFIG.keys.rotateLeft)) game.input.left = down;
  if (keyMatches(code, CONFIG.keys.rotateRight)) game.input.right = down;
  if (keyMatches(code, CONFIG.keys.thrust)) game.input.thrust = down;
  if (keyMatches(code, CONFIG.keys.fire)) game.input.fire = down;
  if (keyMatches(code, CONFIG.keys.hyperspace)) game.input.hyperspace = down;
}

window.addEventListener("keydown", (e) => {
  if (keyMatches(e.code, [...CONFIG.keys.rotateLeft, ...CONFIG.keys.rotateRight, ...CONFIG.keys.thrust, ...CONFIG.keys.fire, ...CONFIG.keys.hyperspace])) {
    e.preventDefault();
  }
  setKey(e.code, true);
  getAudioContext();
});

window.addEventListener("keyup", (e) => {
  setKey(e.code, false);
});

playBtn.addEventListener("click", () => {
  getAudioContext();
  startGame();
});

restartBtn.addEventListener("click", () => {
  getAudioContext();
  startGame();
});

musicToggle.addEventListener("click", () => {
  game.audioEnabled = !game.audioEnabled;
  musicToggle.textContent = game.audioEnabled ? "Sound: On" : "Sound: Off";
  if (game.audioEnabled) {
    getAudioContext();
  } else {
    stopThrustHum();
  }
  syncMusic();
});

// ─── Boot ───────────────────────────────────────────────────────────────────

updateHud();
showOverlay(menuOverlay, true);
showOverlay(defeatOverlay, false);
musicToggle.textContent = game.audioEnabled ? "Sound: On" : "Sound: Off";
syncMusic(false);
game.lastTime = performance.now();
requestAnimationFrame(gameLoop);
