import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

// Scene setup (keeps the new aesthetic but uses proven simulation logic)
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020204);
scene.fog = new THREE.FogExp2(0x020204, 0.004);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
camera.position.set(0, 35, 140);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 20;
controls.maxDistance = 300;
controls.target.set(0, 20, 0);

const ambient = new THREE.AmbientLight(0x344769, 1.4);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(20, 80, 50);
scene.add(sun);

const grid = new THREE.GridHelper(400, 40, 0x440000, 0x111111);
grid.position.y = -20;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4000, 64),
  new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, side: THREE.DoubleSide }),
);
ground.rotateX(-Math.PI / 2);
ground.position.y = -20.1;
scene.add(ground);

// Palettes and lifetimes (extends the original with new particle species)
const typePalette = {
  proton: 0xffc26f,
  gamma: 0x7ef9ff,
  pion: 0xff7bac,
  muon: 0x88c4ff,
  electron: 0x66ffd7,
  positron: 0xffa3ff,
  neutrino: 0x7a7a7a,
  iron: 0xffd97d,
  tau: 0x88ff00,
  antiproton: 0xb070ff,
};

const paletteCache = {};
for (const type in typePalette) {
  paletteCache[type] = new THREE.Color(typePalette[type]);
}

const lifetimeMap = {
  proton: 6,
  gamma: 1.2,
  pion: 1.0,
  muon: 3.2,
  electron: 1.7,
  positron: 1.4,
  neutrino: 0.6,
  iron: 6,
  tau: 0.5,
  antiproton: 6,
};

class Particle {
  constructor(type, position, velocity, energy) {
    this.type = type;
    this.position = position.clone();
    this.velocity = velocity.clone();
    this.energy = energy;
    this.age = 0;
  }

  update(delta) {
    this.age += delta;
    this.position.addScaledVector(this.velocity, delta);
    this.velocity.y -= delta * 3.8;
    if (this.type === "gamma") {
      this.velocity.multiplyScalar(0.995);
    }
    this.energy = Math.max(0, this.energy - delta * 0.08);
  }

  shouldExpire() {
    return this.position.y < -20 || this.age > lifetimeMap[this.type] || this.energy < 0.0005;
  }
}

// Buffers
const maxParticles = 20000;
const particles = [];
const positions = new Float32Array(maxParticles * 3);
const colors = new Float32Array(maxParticles * 3);
const energies = new Float32Array(maxParticles);

const maxHits = 16000;
const hitPositions = new Float32Array(maxHits * 3);
const hitColors = new Float32Array(maxHits * 3);
const hitEnergies = new Float32Array(maxHits);

// Geometry
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
particleGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
particleGeometry.setAttribute("energy", new THREE.BufferAttribute(energies, 1).setUsage(THREE.DynamicDrawUsage));
particleGeometry.setDrawRange(0, 0);

const hitGeometry = new THREE.BufferGeometry();
hitGeometry.setAttribute("position", new THREE.BufferAttribute(hitPositions, 3).setUsage(THREE.DynamicDrawUsage));
hitGeometry.setAttribute("color", new THREE.BufferAttribute(hitColors, 3).setUsage(THREE.DynamicDrawUsage));
hitGeometry.setAttribute("energy", new THREE.BufferAttribute(hitEnergies, 1).setUsage(THREE.DynamicDrawUsage));
hitGeometry.setDrawRange(0, 0);

// Point sprite
const spriteCanvas = document.createElement("canvas");
spriteCanvas.width = spriteCanvas.height = 64;
const spriteCtx = spriteCanvas.getContext("2d");
if (spriteCtx) {
  const gradient = spriteCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  spriteCtx.fillStyle = gradient;
  spriteCtx.fillRect(0, 0, 64, 64);
}
const particleTexture = new THREE.CanvasTexture(spriteCanvas);
particleTexture.minFilter = THREE.LinearFilter;
particleTexture.generateMipmaps = false;
particleTexture.needsUpdate = true;

const particleMaterial = new THREE.ShaderMaterial({
  uniforms: { pointTexture: { value: particleTexture }, size: { value: 3 } },
  vertexShader: `
    uniform float size;
    attribute float energy;
    varying vec3 vColor;
    varying float vEnergy;

    void main() {
      vColor = color;
      vEnergy = energy;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (200.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D pointTexture;
    varying vec3 vColor;
    varying float vEnergy;

    void main() {
      vec4 tex = texture(pointTexture, gl_PointCoord);
      if (tex.a < 0.05) discard;
      float alpha = mix(0.18, 3.0, vEnergy);
      gl_FragColor = vec4(vColor, alpha) * tex;
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
});

const hitMaterial = new THREE.ShaderMaterial({
  uniforms: { pointTexture: { value: particleTexture }, size: { value: 4 } },
  vertexShader: `
    uniform float size;
    attribute float energy;
    varying vec3 vColor;
    varying float vEnergy;

    void main() {
      vColor = color;
      vEnergy = energy;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size * (200.0 / -mvPosition.z);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: `
    uniform sampler2D pointTexture;
    varying vec3 vColor;
    varying float vEnergy;

    void main() {
      vec4 tex = texture(pointTexture, gl_PointCoord);
      if (tex.a < 0.05) discard;
      float alpha = mix(0.28, 2.0, vEnergy);
      gl_FragColor = vec4(vColor, alpha) * tex;
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexColors: true,
});

const pointCloud = new THREE.Points(particleGeometry, particleMaterial);
scene.add(pointCloud);
const hitCloud = new THREE.Points(hitGeometry, hitMaterial);
scene.add(hitCloud);

// UI references
const primaryTypeSelect = document.getElementById("primaryType");
const energyRange = document.getElementById("energyRange");
const driveRange = document.getElementById("driveRange");
const rateRange = document.getElementById("rateRange");
const energyValue = document.getElementById("energyValue");
const driveValue = document.getElementById("driveValue");
const rateValue = document.getElementById("rateValue");
const burstButton = document.getElementById("burstButton");
const clearButton = document.getElementById("clearButton");
const hitToggle = document.getElementById("hitToggle");
const clearHitsButton = document.getElementById("clearHits");
const cascadeToggle = document.getElementById("cascadeToggle");
const logElement = document.getElementById("consoleLog");
const sysTime = document.getElementById("sysTime");
const axisCanvas = document.getElementById("axisCanvas");
const axisCtx = axisCanvas?.getContext("2d");

const statsElements = {
  muon: document.getElementById("stat-muon"),
  gamma: document.getElementById("stat-gamma"),
  electron: document.getElementById("stat-electron"),
  hadrons: document.getElementById("stat-hadrons"),
  count: document.getElementById("particleCount"),
};

// Simulation state
const clock = new THREE.Clock();
let spawnAccumulator = 0;
let hitsActive = true;
let hitCount = 0;
let cascadeActive = false;

function brightnessFactor(energy) {
  const primaryEnergy = Math.max(parseFloat(energyRange.value) || 1, 0.5);
  const ratio = Math.min(energy / primaryEnergy, 1);
  return THREE.MathUtils.clamp(0.35 + 0.65 * ratio, 0.35, 1);
}

function createParticle(type, origin, energy, options = {}) {
  const scatter = options.scatter ?? 0.45;
  const upwardBias = options.upwardBias ?? 0;
  const baseSpeed = options.speed ?? 16;
  const direction = new THREE.Vector3(
    (Math.random() - 0.5) * scatter,
    -1 + upwardBias,
    (Math.random() - 0.5) * scatter,
  ).normalize();
  const speed = baseSpeed + energy * 5;
  const velocity = direction.multiplyScalar(speed);
  const position = origin.clone();
  return new Particle(type, position, velocity, Math.max(energy, 0.08));
}

function createPair(parent, typeA, typeB) {
  const share = parent.energy * 0.45;
  return [
    createParticle(typeA, parent.position, share, {
      scatter: 0.8,
      upwardBias: 0.2,
      speed: 20,
    }),
    createParticle(typeB, parent.position, share, {
      scatter: 0.85,
      upwardBias: 0.15,
      speed: 18,
    }),
  ];
}

function logEvent(msg) {
  if (!logElement) return;
  const line = document.createElement("div");
  line.className = "log-line";
  line.innerHTML = `>> ${msg}`;
  logElement.prepend(line);
  while (logElement.children.length > 14) {
    logElement.lastChild?.remove();
  }
}

function recordHit(particle) {
  if (!hitsActive) return;
  if (hitCount >= maxHits) {
    hitPositions.copyWithin(0, 3);
    hitColors.copyWithin(0, 3);
    hitEnergies.copyWithin(0, 1);
    hitCount = maxHits - 1;
  }
  const baseIdx = hitCount * 3;
  hitPositions[baseIdx] = particle.position.x;
  hitPositions[baseIdx + 1] = ground.position.y + 0.15;
  hitPositions[baseIdx + 2] = particle.position.z;
  const palette = paletteCache[particle.type] || paletteCache.proton;
  const bright = brightnessFactor(particle.energy);
  hitColors[baseIdx] = palette.r * bright;
  hitColors[baseIdx + 1] = palette.g * bright;
  hitColors[baseIdx + 2] = palette.b * bright;
  hitEnergies[hitCount] = bright;
  hitCount += 1;
  hitGeometry.setDrawRange(0, hitCount);
  hitGeometry.attributes.position.needsUpdate = true;
  hitGeometry.attributes.color.needsUpdate = true;
  hitGeometry.attributes.energy.needsUpdate = true;
}

function spawnPrimary(type = primaryTypeSelect?.value || "proton") {
  const energy = parseFloat(energyRange?.value || "1");
  const altitude = 70 + (Math.random() - 0.5) * 6;
  const origin = new THREE.Vector3((Math.random() - 0.5) * 10, altitude, (Math.random() - 0.5) * 10);
  const opts = { scatter: 0.2, speed: 18 };
  let energyScale = 1;

  switch (type) {
    case "gamma":
      opts.scatter = 0.08;
      opts.speed = 24;
      break;
    case "iron":
      opts.scatter = 0.25;
      opts.speed = 20;
      energyScale = 1.3;
      break;
    case "tau":
      opts.scatter = 0.18;
      opts.speed = 22;
      break;
    case "antiproton":
      opts.scatter = 0.22;
      opts.speed = 18;
      break;
    default:
      break;
  }

  const primary = createParticle(type, origin, energy * energyScale, opts);
  particles.push(primary);

  if (!cascadeActive) {
    const palette = paletteCache[type] || paletteCache.proton;
    const color = `#${palette.getHexString()}`;
    logEvent(`<span style="color:${color}">DETECTED: ${type.toUpperCase()} @ ${energy.toFixed(1)} TeV</span>`);
  }
}

function trimParticles() {
  if (particles.length <= maxParticles) return;
  particles.splice(0, particles.length - maxParticles);
}

function maybeBranch(particle, collector, delta) {
  const drive = parseFloat(driveRange.value);
  const baseProbability = 0.02 * drive + 0.015 * Math.min(particle.energy, 3);
  const chance = Math.min(1, baseProbability * delta);
  if (Math.random() > chance) return;

  const heightModifier = Math.max(0, Math.min(1, (particle.position.y + 20) / 90));
  if (Math.random() > 0.7 + 0.3 * heightModifier) return;

  switch (particle.type) {
    case "proton":
    case "antiproton":
    case "iron": {
      if (particle.age < 0.2) return;
      collector.push(createParticle("pion", particle.position, particle.energy * 0.7, { scatter: 0.4 }));
      collector.push(createParticle("pion", particle.position, particle.energy * 0.45, { scatter: 0.65 }));
      if (Math.random() < 0.5) {
        collector.push(...createPair(particle, "gamma", "gamma"));
      }
      if (particle.type === "iron" && Math.random() < 0.4) {
        collector.push(createParticle("muon", particle.position, particle.energy * 0.4, { scatter: 0.5, speed: 20 }));
      }
      if (particle.type === "antiproton" && Math.random() < 0.35) {
        collector.push(createParticle("gamma", particle.position, particle.energy * 0.5, { scatter: 0.5, speed: 22 }));
      }
      break;
    }
    case "gamma": {
      if (Math.random() < 0.55) {
        collector.push(...createPair(particle, "electron", "positron"));
      }
      break;
    }
    case "pion": {
      if (Math.random() < 0.65) {
        collector.push(
          createParticle("muon", particle.position, particle.energy * 0.7, { scatter: 0.25, speed: 19 }),
        );
        collector.push(
          createParticle("neutrino", particle.position, particle.energy * 0.2, {
            scatter: 0.4,
            upwardBias: 0.3,
            speed: 16,
          }),
        );
      }
      break;
    }
    case "tau": {
      if (particle.age > 0.05) {
        collector.push(createParticle("muon", particle.position, particle.energy * 0.6, { scatter: 0.3, speed: 20 }));
        collector.push(createParticle("neutrino", particle.position, particle.energy * 0.25, { scatter: 0.6, speed: 18 }));
        collector.push(createParticle("pion", particle.position, particle.energy * 0.35, { scatter: 0.6, speed: 18 }));
      }
      break;
    }
    case "muon": {
      if (particle.age > 0.4 && Math.random() < 0.45) {
        collector.push(
          createParticle("electron", particle.position, particle.energy * 0.5, { scatter: 0.35, speed: 14 }),
        );
        collector.push(
          createParticle("neutrino", particle.position, particle.energy * 0.15, {
            scatter: 0.5,
            upwardBias: 0.3,
            speed: 16,
          }),
        );
      }
      break;
    }
    case "electron":
    case "positron": {
      if (Math.random() < 0.3) {
        collector.push(
          createParticle("gamma", particle.position, particle.energy * 0.3, { scatter: 0.6, upwardBias: 0.1 }),
        );
      }
      break;
    }
    default:
      break;
  }
}

function updateParticles(delta) {
  const newParticles = [];
  if (cascadeActive) {
    const rate = parseFloat(rateRange.value);
    const interval = 1 / Math.max(rate, 0.1);
    spawnAccumulator += delta;
    while (spawnAccumulator >= interval) {
      spawnAccumulator -= interval;
      spawnPrimary(primaryTypeSelect.value);
    }
  } else {
    spawnAccumulator = 0;
  }

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.update(delta);
    maybeBranch(particle, newParticles, delta);
    const shouldDie = particle.shouldExpire();
    const hitFloor = particle.position.y < ground.position.y + 0.2;
    if (shouldDie) {
      if (hitFloor) {
        recordHit(particle);
      }
      particles.splice(i, 1);
    }
  }

  if (newParticles.length) {
    particles.push(...newParticles);
  }

  trimParticles();
}

function refreshPointCloud() {
  const count = particles.length;
  for (let i = 0; i < count; i += 1) {
    const particle = particles[i];
    const idx = i * 3;
    positions[idx] = particle.position.x;
    positions[idx + 1] = particle.position.y;
    positions[idx + 2] = particle.position.z;
    const palette = paletteCache[particle.type] || paletteCache.proton;
    const bright = brightnessFactor(particle.energy);
    colors[idx] = palette.r * bright;
    colors[idx + 1] = palette.g * bright;
    colors[idx + 2] = palette.b * bright;
    energies[i] = bright;
  }
  particleGeometry.setDrawRange(0, count);
  particleGeometry.attributes.position.needsUpdate = true;
  particleGeometry.attributes.color.needsUpdate = true;
  particleGeometry.attributes.energy.needsUpdate = true;
}

function updateStats() {
  const counts = { muon: 0, gamma: 0, electron: 0, hadrons: 0 };
  for (const particle of particles) {
    if (particle.type === "muon") {
      counts.muon += 1;
    } else if (particle.type === "gamma") {
      counts.gamma += 1;
    } else if (particle.type === "electron" || particle.type === "positron") {
      counts.electron += 1;
    } else if (particle.type === "proton" || particle.type === "pion" || particle.type === "iron" || particle.type === "antiproton") {
      counts.hadrons += 1;
    } else if (particle.type === "tau") {
      counts.hadrons += 1;
    }
  }

  if (statsElements.muon) statsElements.muon.textContent = counts.muon;
  if (statsElements.gamma) statsElements.gamma.textContent = counts.gamma;
  if (statsElements.electron) statsElements.electron.textContent = counts.electron;
  if (statsElements.hadrons) statsElements.hadrons.textContent = counts.hadrons;
  if (statsElements.count) statsElements.count.textContent = particles.length;
}

function drawAxisMini() {
  if (!axisCtx || !axisCanvas) return;
  const width = axisCanvas.width;
  const height = axisCanvas.height;
  axisCtx.clearRect(0, 0, width, height);
  axisCtx.fillStyle = "rgba(5,6,12,0.9)";
  axisCtx.fillRect(0, 0, width, height);

  const centerX = width * 0.3;
  axisCtx.strokeStyle = "rgba(255,88,88,0.45)";
  axisCtx.lineWidth = 1;
  axisCtx.beginPath();
  axisCtx.moveTo(centerX, 4);
  axisCtx.lineTo(centerX, height - 4);
  axisCtx.stroke();

  const ticks = [0, 20, 40, 60, 80];
  axisCtx.fillStyle = "rgba(255,255,255,0.65)";
  axisCtx.font = "11px 'Share Tech Mono', monospace";
  ticks.forEach((value) => {
    const normalized = (value + 20) / 100;
    const y = height - normalized * height;
    axisCtx.beginPath();
    axisCtx.moveTo(centerX, y);
    axisCtx.lineTo(centerX - 10, y);
    axisCtx.stroke();
    axisCtx.fillText(`${value} km`, centerX + 8, y + 4);
  });

  let drawn = 0;
  for (let i = particles.length - 1; i >= 0 && drawn < 120; i -= 1) {
    const particle = particles[i];
    const palette = paletteCache[particle.type] || paletteCache.proton;
    const bright = brightnessFactor(particle.energy);
    const normX = THREE.MathUtils.clamp((particle.position.x + 25) / 50, 0, 1);
    const normY = THREE.MathUtils.clamp((particle.position.y + 20) / 100, 0, 1);
    const x = centerX + 6 + normX * (width - centerX - 12);
    const y = height - normY * height;
    const r = Math.round(palette.r * 255 * bright);
    const g = Math.round(palette.g * 255 * bright);
    const b = Math.round(palette.b * 255 * bright);
    axisCtx.fillStyle = `rgba(${r},${g},${b},${0.65 + 0.3 * bright})`;
    axisCtx.fillRect(x, y, 2, 2);
    drawn += 1;
  }
}

function energizeControls() {
  if (energyValue) energyValue.textContent = parseFloat(energyRange.value).toFixed(1);
  if (driveValue) driveValue.textContent = parseFloat(driveRange.value).toFixed(2);
  if (rateValue) rateValue.textContent = parseFloat(rateRange.value).toFixed(2);
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

burstButton?.addEventListener("click", () => spawnPrimary(primaryTypeSelect.value));
cascadeToggle?.addEventListener("change", () => {
  cascadeActive = cascadeToggle.checked;
  if (cascadeActive) {
    spawnAccumulator = 0;
    spawnPrimary(primaryTypeSelect.value);
  }
});
hitToggle?.addEventListener("change", () => {
  hitsActive = hitToggle.checked;
});
clearButton?.addEventListener("click", () => {
  particles.length = 0;
});
clearHitsButton?.addEventListener("click", () => {
  hitCount = 0;
  hitGeometry.setDrawRange(0, 0);
  hitGeometry.attributes.position.needsUpdate = true;
  hitGeometry.attributes.color.needsUpdate = true;
  hitGeometry.attributes.energy.needsUpdate = true;
});

energyRange?.addEventListener("input", () => energyValue && (energyValue.textContent = parseFloat(energyRange.value).toFixed(1)));
driveRange?.addEventListener("input", () => driveValue && (driveValue.textContent = parseFloat(driveRange.value).toFixed(2)));
rateRange?.addEventListener("input", () => rateValue && (rateValue.textContent = parseFloat(rateRange.value).toFixed(2)));

window.addEventListener("resize", onResize);

function animate() {
  const delta = Math.min(clock.getDelta(), 0.045);
  controls.update();
  updateParticles(delta);
  refreshPointCloud();
  updateStats();
  drawAxisMini();
  if (sysTime) {
    const now = new Date();
    sysTime.textContent = now.toLocaleTimeString("en-GB");
  }
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

energizeControls();
animate();
