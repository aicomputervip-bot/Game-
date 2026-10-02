const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const ui = {
  wave: document.querySelector('#wave-value'), score: document.querySelector('#score-value'), best: document.querySelector('#best-value'),
  health: document.querySelector('#health-number'), healthFill: document.querySelector('#health-fill'), ammo: document.querySelector('#ammo-value'),
  ammoFill: document.querySelector('#ammo-fill'), coordinate: document.querySelector('#coordinate'), overlay: document.querySelector('#overlay'),
  overlayKicker: document.querySelector('#overlay-kicker'), overlayTitle: document.querySelector('#overlay-title'), overlayCopy: document.querySelector('#overlay-copy'),
  toast: document.querySelector('#toast'), comms: document.querySelector('#comms-message'), pause: document.querySelector('#pause-button')
};

const keys = new Set();
const pointer = { x: 0, y: 0, down: false, active: false, id: null };
let savedBest = 0;
try { savedBest = Number(localStorage.getItem('neon-breach-best') || 0); } catch { /* Storage may be unavailable for local files. */ }
const state = { width: 800, height: 520, player: null, bullets: [], enemies: [], particles: [], obstacles: [], wave: 1, score: 0, best: savedBest, ammo: 24, health: 100, reload: 0, shotCooldown: 0, spawnTimer: 0, time: 0, shake: 0, running: true, over: false, paused: false, toastTimer: 0, touchStick: null };
const rand = (min, max) => min + Math.random() * (max - min);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.width = rect.width;
  state.height = rect.height;
  if (state.player) {
    state.player.x = clamp(state.player.x, 24, state.width - 24);
    state.player.y = clamp(state.player.y, 24, state.height - 24);
  }
  makeObstacles();
}

function makeObstacles() {
  const w = state.width, h = state.height;
  const scale = Math.min(w / 800, h / 520);
  state.obstacles = [
    { x: w * .23 - 37 * scale, y: h * .27 - 16 * scale, w: 74 * scale, h: 32 * scale },
    { x: w * .72 - 42 * scale, y: h * .31 - 17 * scale, w: 84 * scale, h: 34 * scale },
    { x: w * .47 - 35 * scale, y: h * .72 - 18 * scale, w: 70 * scale, h: 36 * scale },
    { x: w * .17 - 21 * scale, y: h * .76 - 13 * scale, w: 42 * scale, h: 26 * scale },
    { x: w * .83 - 23 * scale, y: h * .75 - 14 * scale, w: 46 * scale, h: 28 * scale }
  ];
}

function resetGame() {
  state.player = { x: state.width / 2, y: state.height / 2, angle: 0, radius: 13, invulnerable: 0 };
  state.bullets = []; state.enemies = []; state.particles = [];
  state.wave = 1; state.score = 0; state.ammo = 24; state.health = 100; state.reload = 0;
  state.shotCooldown = 0; state.spawnTimer = 0.6; state.time = 0; state.shake = 0;
  state.running = true; state.over = false; state.paused = false;
  ui.overlay.classList.add('hidden');
  ui.comms.textContent = 'Stay sharp, operator.';
  updateHud();
}

function updateHud() {
  ui.wave.textContent = String(state.wave).padStart(2, '0');
  ui.score.textContent = String(state.score).padStart(6, '0');
  ui.best.textContent = String(state.best).padStart(6, '0');
  ui.health.textContent = `${Math.ceil(state.health)}%`;
  ui.healthFill.style.width = `${state.health}%`;
  ui.healthFill.style.background = state.health <= 30 ? '#ff674d' : '';
  ui.ammo.textContent = String(state.ammo).padStart(2, '0');
  ui.ammoFill.style.width = `${state.ammo / 24 * 100}%`;
  ui.coordinate.textContent = `${String(Math.floor(state.player?.x || 0)).padStart(3, '0')} : ${String(Math.floor(state.player?.y || 0)).padStart(3, '0')}`;
}

function notify(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  state.toastTimer = 1.4;
}

function reload() {
  if (state.over || state.paused || state.reload > 0 || state.ammo === 24) return;
  state.reload = 1.05;
  ui.comms.textContent = 'Reloading. Keep moving.';
  notify('RELOADING');
}

function shoot() {
  if (state.shotCooldown > 0 || state.reload > 0 || state.over || state.paused) return;
  if (state.ammo <= 0) { reload(); return; }
  const player = state.player;
  const angle = player.angle + rand(-0.035, 0.035);
  state.bullets.push({ x: player.x + Math.cos(angle) * 18, y: player.y + Math.sin(angle) * 18, vx: Math.cos(angle) * 620, vy: Math.sin(angle) * 620, life: .65 });
  state.ammo--;
  state.shotCooldown = .14;
  state.shake = Math.max(state.shake, 1.7);
  burst(player.x + Math.cos(angle) * 19, player.y + Math.sin(angle) * 19, '#e6ff9a', 3, 65);
  updateHud();
}

function spawnEnemy() {
  const margin = 22;
  const side = Math.floor(Math.random() * 4);
  const x = side === 0 ? margin : side === 1 ? state.width - margin : rand(margin, state.width - margin);
  const y = side === 2 ? margin : side === 3 ? state.height - margin : rand(margin, state.height - margin);
  state.enemies.push({ x, y, radius: rand(11, 14), hp: state.wave > 3 && Math.random() < .24 ? 2 : 1, speed: rand(40, 57) + state.wave * 3, hit: 0, phase: rand(0, 6.28) });
}

function burst(x, y, color, count = 8, speed = 130) {
  for (let i = 0; i < count; i++) {
    const angle = rand(0, Math.PI * 2), velocity = rand(speed * .3, speed);
    state.particles.push({ x, y, vx: Math.cos(angle) * velocity, vy: Math.sin(angle) * velocity, life: rand(.18, .48), maxLife: .48, color, size: rand(1.5, 3.5) });
  }
}

function hitPlayer() {
  if (state.player.invulnerable > 0) return;
  state.health = Math.max(0, state.health - 12);
  state.player.invulnerable = .65;
  state.shake = 7;
  burst(state.player.x, state.player.y, '#ff674d', 12, 170);
  ui.comms.textContent = state.health <= 30 ? 'Integrity critical!' : 'You took a hit. Stay mobile.';
  updateHud();
  if (state.health <= 0) endGame();
}

function endGame() {
  state.over = true;
  if (state.score > state.best) {
    state.best = state.score;
    try { localStorage.setItem('neon-breach-best', String(state.best)); } catch { /* Keep the run playable without storage. */ }
  }
  updateHud();
  ui.overlayKicker.textContent = 'SIGNAL LOST';
  ui.overlayTitle.textContent = 'Run ended.';
  ui.overlayCopy.textContent = `You reached wave ${state.wave} · ${state.score} points`;
  ui.overlay.classList.remove('hidden');
  document.querySelector('#overlay-action').innerHTML = '<span>↻</span> TRY AGAIN';
}

function togglePause() {
  if (state.over) return;
  state.paused = !state.paused;
  ui.pause.setAttribute('aria-label', state.paused ? 'Resume game' : 'Pause game');
  ui.overlay.classList.toggle('hidden', !state.paused);
  ui.overlayKicker.textContent = 'SIMULATION PAUSED';
  ui.overlayTitle.textContent = 'Take a breath.';
  ui.overlayCopy.textContent = 'The sector is waiting.';
  document.querySelector('#overlay-action').innerHTML = '<span>▶</span> RESUME';
}

function circleRectCollision(circle, rect) {
  const x = clamp(circle.x, rect.x, rect.x + rect.w), y = clamp(circle.y, rect.y, rect.y + rect.h);
  return Math.hypot(circle.x - x, circle.y - y) < circle.radius;
}

function update(dt) {
  if (state.over || state.paused) return;
  state.time += dt;
  state.shotCooldown = Math.max(0, state.shotCooldown - dt);
  state.shake = Math.max(0, state.shake - dt * 22);
  state.toastTimer = Math.max(0, state.toastTimer - dt);
  if (!state.toastTimer) ui.toast.classList.remove('show');
  if (state.player.invulnerable > 0) state.player.invulnerable -= dt;

  if (state.reload > 0) {
    state.reload -= dt;
    if (state.reload <= 0) { state.ammo = 24; ui.comms.textContent = 'Magazine topped off.'; updateHud(); }
  }

  const player = state.player;
  if (pointer.active) player.angle = Math.atan2(pointer.y - player.y, pointer.x - player.x);
  let moveX = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let moveY = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  if (state.touchStick) { moveX += state.touchStick.x; moveY += state.touchStick.y; }
  const length = Math.hypot(moveX, moveY) || 1;
  player.x = clamp(player.x + moveX / length * 220 * dt, 17, state.width - 17);
  player.y = clamp(player.y + moveY / length * 220 * dt, 17, state.height - 17);
  for (const obstacle of state.obstacles) if (circleRectCollision(player, obstacle)) {
    player.x -= moveX / length * 220 * dt;
    player.y -= moveY / length * 220 * dt;
  }
  if (pointer.down) shoot();

  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0) {
    spawnEnemy();
    state.spawnTimer = Math.max(.26, .95 - state.wave * .07);
  }
  if (state.score >= state.wave * 120) {
    state.wave++;
    ui.comms.textContent = `Wave ${state.wave}. They're closing in.`;
    notify(`WAVE ${String(state.wave).padStart(2, '0')} INCOMING`);
    updateHud();
  }

  for (const bullet of state.bullets) {
    bullet.x += bullet.vx * dt; bullet.y += bullet.vy * dt; bullet.life -= dt;
    if (state.obstacles.some(obstacle => bullet.x > obstacle.x && bullet.x < obstacle.x + obstacle.w && bullet.y > obstacle.y && bullet.y < obstacle.y + obstacle.h)) bullet.life = 0;
    for (const enemy of state.enemies) if (bullet.life > 0 && distance(bullet, enemy) < enemy.radius + 3) {
      bullet.life = 0; enemy.hp--; enemy.hit = .12;
      burst(bullet.x, bullet.y, '#ffc47c', 4, 90);
      if (enemy.hp <= 0) {
        enemy.dead = true; state.score += 10; burst(enemy.x, enemy.y, '#ff674d', 10, 145);
        if (state.score > state.best) { state.best = state.score; }
        updateHud();
      }
    }
  }
  state.bullets = state.bullets.filter(bullet => bullet.life > 0 && bullet.x > -10 && bullet.x < state.width + 10 && bullet.y > -10 && bullet.y < state.height + 10);

  for (const enemy of state.enemies) {
    if (enemy.dead) continue;
    enemy.hit = Math.max(0, enemy.hit - dt);
    const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
    const speed = enemy.speed * (1 + Math.sin(state.time * 3 + enemy.phase) * .04);
    const next = { x: enemy.x + Math.cos(angle) * speed * dt, y: enemy.y + Math.sin(angle) * speed * dt, radius: enemy.radius };
    if (!state.obstacles.some(obstacle => circleRectCollision(next, obstacle))) { enemy.x = next.x; enemy.y = next.y; }
    if (distance(enemy, player) < enemy.radius + player.radius) hitPlayer();
  }
  state.enemies = state.enemies.filter(enemy => !enemy.dead);
  for (const particle of state.particles) { particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vx *= .96; particle.vy *= .96; particle.life -= dt; }
  state.particles = state.particles.filter(particle => particle.life > 0);
  updateHud();
}

function drawGrid() {
  const { width: w, height: h } = state;
  ctx.fillStyle = '#172121'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#d6e9d008'; ctx.lineWidth = 1;
  const gap = Math.max(24, Math.min(w, h) / 15);
  for (let x = 0; x < w; x += gap) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  for (let y = 0; y < h; y += gap) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  ctx.strokeStyle = '#d0f36b18'; ctx.setLineDash([3, 8]); ctx.strokeRect(12, 12, w - 24, h - 24); ctx.setLineDash([]);
  for (let i = 0; i < 26; i++) {
    const x = (i * 127.7) % w, y = (i * 83.3) % h;
    ctx.fillStyle = '#e4eee0' + (i % 3 ? '10' : '18'); ctx.fillRect(x, y, 2, 2);
  }
}

function drawObstacles() {
  for (const obstacle of state.obstacles) {
    ctx.fillStyle = '#293635'; ctx.fillRect(obstacle.x, obstacle.y, obstacle.w, obstacle.h);
    ctx.fillStyle = '#394644'; ctx.fillRect(obstacle.x + 3, obstacle.y + 3, obstacle.w - 6, obstacle.h - 6);
    ctx.strokeStyle = '#71817a'; ctx.lineWidth = 1; ctx.strokeRect(obstacle.x + 3.5, obstacle.y + 3.5, obstacle.w - 7, obstacle.h - 7);
    ctx.fillStyle = '#a6b39b';
    for (let x = obstacle.x + 10; x < obstacle.x + obstacle.w - 5; x += 12) ctx.fillRect(x, obstacle.y + 8, 3, 2);
    ctx.fillStyle = '#0f1717'; ctx.fillRect(obstacle.x + 5, obstacle.y + obstacle.h - 7, obstacle.w - 10, 3);
  }
}

function drawPlayer() {
  const p = state.player;
  if (p.invulnerable > 0 && Math.floor(state.time * 18) % 2) return;
  ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
  ctx.fillStyle = '#d0f36b20'; ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d0f36b'; ctx.fillRect(0, -3, 24, 6);
  ctx.fillStyle = '#a9c94f'; ctx.fillRect(13, -2, 12, 4);
  ctx.fillStyle = '#c6ddd0'; ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#23302c'; ctx.beginPath(); ctx.arc(1, 0, 7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d0f36b'; ctx.beginPath(); ctx.arc(4, 0, 2.3, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function render() {
  const w = state.width, h = state.height;
  ctx.save();
  if (state.shake > 0) ctx.translate(rand(-state.shake, state.shake), rand(-state.shake, state.shake));
  drawGrid(); drawObstacles();
  for (const bullet of state.bullets) {
    ctx.fillStyle = '#e6ff9a'; ctx.shadowColor = '#d0f36b'; ctx.shadowBlur = 9;
    ctx.beginPath(); ctx.arc(bullet.x, bullet.y, 2.2, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  }
  for (const enemy of state.enemies) {
    const pulse = Math.sin(state.time * 6 + enemy.phase) * 1.2;
    ctx.fillStyle = '#ff674d20'; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 8 + pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = enemy.hit ? '#fff0d3' : '#ff674d'; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#512e2b'; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius * .53, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffd0a1'; ctx.fillRect(enemy.x - 2, enemy.y - 2, 4, 4);
    if (enemy.hp > 1) { ctx.strokeStyle = '#ffb26b'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(enemy.x, enemy.y, enemy.radius + 3, 0, Math.PI * 2); ctx.stroke(); }
  }
  drawPlayer();
  for (const particle of state.particles) { ctx.globalAlpha = Math.max(0, particle.life / particle.maxLife); ctx.fillStyle = particle.color; ctx.fillRect(particle.x, particle.y, particle.size, particle.size); }
  ctx.globalAlpha = 1;
  if (pointer.active) {
    ctx.strokeStyle = '#e7f0d8'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 7, 0, Math.PI * 2); ctx.moveTo(pointer.x - 12, pointer.y); ctx.lineTo(pointer.x - 5, pointer.y); ctx.moveTo(pointer.x + 5, pointer.y); ctx.lineTo(pointer.x + 12, pointer.y); ctx.moveTo(pointer.x, pointer.y - 12); ctx.lineTo(pointer.x, pointer.y - 5); ctx.moveTo(pointer.x, pointer.y + 5); ctx.lineTo(pointer.x, pointer.y + 12); ctx.stroke();
  }
  ctx.restore();
  if (state.paused) { ctx.fillStyle = '#10171966'; ctx.fillRect(0, 0, w, h); }
}

let previous = performance.now();
function loop(now) {
  const dt = Math.min((now - previous) / 1000, .035); previous = now;
  update(dt); render(); requestAnimationFrame(loop);
}

function setPointer(event) {
  if (state.touchStick?.id === event.pointerId) {
    state.touchStick.x = clamp((event.clientX - state.touchStick.originX) / 48, -1, 1);
    state.touchStick.y = clamp((event.clientY - state.touchStick.originY) / 48, -1, 1);
    return;
  }
  const rect = canvas.getBoundingClientRect();
  pointer.x = event.clientX - rect.left;
  pointer.y = event.clientY - rect.top;
  pointer.active = true;
  if (state.player) state.player.angle = Math.atan2(pointer.y - state.player.y, pointer.x - state.player.x);
}

canvas.addEventListener('pointermove', setPointer);
canvas.addEventListener('pointerdown', event => {
  canvas.setPointerCapture(event.pointerId);
  const rect = canvas.getBoundingClientRect();
  if (event.pointerType === 'touch' && event.clientX - rect.left < rect.width * .48) {
    state.touchStick = { id: event.pointerId, originX: event.clientX, originY: event.clientY, x: 0, y: 0 };
    return;
  }
  setPointer(event); pointer.down = true; pointer.id = event.pointerId; shoot();
});
canvas.addEventListener('pointerup', event => {
  if (state.touchStick?.id === event.pointerId) state.touchStick = null;
  if (pointer.id === event.pointerId) { pointer.down = false; pointer.id = null; }
});
canvas.addEventListener('pointercancel', event => {
  if (pointer.id === event.pointerId) { pointer.down = false; pointer.id = null; }
  if (state.touchStick?.id === event.pointerId) state.touchStick = null;
});
canvas.addEventListener('pointerleave', () => { if (!pointer.down) pointer.active = false; });
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
  keys.add(key);
  if (key === ' ' && !event.repeat) reload();
  if (key === 'escape' && !event.repeat) togglePause();
  if (key === 'r' && state.over) resetGame();
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
window.addEventListener('blur', () => { keys.clear(); pointer.down = false; pointer.id = null; state.touchStick = null; });
ui.pause.addEventListener('click', togglePause);
document.querySelector('#reload-button').addEventListener('click', reload);
document.querySelector('#overlay-action').addEventListener('click', () => state.over ? resetGame() : togglePause());
window.addEventListener('resize', resize);

resize(); resetGame(); requestAnimationFrame(loop);