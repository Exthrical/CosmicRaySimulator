import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x090a14);
scene.fog = new THREE.FogExp2(0x030347, 0.003);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 420);
camera.far = 5000;
camera.position.set(0, 22, 90);
camera.updateProjectionMatrix();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 15;
controls.maxDistance = 160;
controls.maxPolarAngle = Math.PI / 2.2;
controls.target.set(0, 8, 0);

const ambient = new THREE.AmbientLight(0x344769, 0.9);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(28, 60, 22);
scene.add(sun);

const grid = new THREE.GridHelper(260, 36, 0x0a1230, 0x051015);
grid.position.y = -12;
scene.add(grid);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(4000, 64),
  new THREE.MeshBasicMaterial({
    color: 0x050a16,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
  }),
);
ground.rotateX(-Math.PI / 2);
ground.position.y = -13.5;
scene.add(ground);

const typePalette = {
  proton: 0xffc26f,
  gamma: 0x7ef9ff,
  pion: 0xff7bac,
  muon: 0x88c4ff,
  electron: 0x66ffd7,
  positron: 0xffa3ff,
  neutrino: 0x7a7a7a,
  iron: 0xffd97d,
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
    return (
      this.position.y < -18 ||
      this.age > lifetimeMap[this.type] ||
      this.energy < 0.0005  //arbitrary, so keep very low
    );
  }
}

const maxParticles = 256000;
const particles = [];
const positions = new Float32Array(maxParticles * 3);
const colors = new Float32Array(maxParticles * 3);
const energies = new Float32Array(maxParticles);

const maxHits = 80000;
const hitPositions = new Float32Array(maxHits * 3);
const hitColors = new Float32Array(maxHits * 3);

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
);
particleGeometry.setAttribute(
  "color",
  new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage),
);
particleGeometry.setDrawRange(0, 0);
particleGeometry.setAttribute(
  "energy",
  new THREE.BufferAttribute(energies, 1).setUsage(THREE.DynamicDrawUsage),
);

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
  uniforms: {
    pointTexture: { value: particleTexture },
    size: { value: 3 },
  },
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

const pointCloud = new THREE.Points(particleGeometry, particleMaterial);
scene.add(pointCloud);

const hitGeometry = new THREE.BufferGeometry();
hitGeometry.setAttribute(
  "position",
  new THREE.BufferAttribute(hitPositions, 3).setUsage(THREE.DynamicDrawUsage),
);
hitGeometry.setAttribute(
  "color",
  new THREE.BufferAttribute(hitColors, 3).setUsage(THREE.DynamicDrawUsage),
);
hitGeometry.setDrawRange(0, 0);

const hitMaterial = new THREE.ShaderMaterial({
  uniforms: {
    pointTexture: { value: particleTexture },
    size: { value: 4 },
  },
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
const hitCloud = new THREE.Points(hitGeometry, hitMaterial);
scene.add(hitCloud);

const clock = new THREE.Clock();
let spawnAccumulator = 0;

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
const hitLabel = document.getElementById("hitLabel");
const clearHitsButton = document.getElementById("clearHits");
const axisCanvas = document.getElementById("axisCanvas");
const axisCtx = axisCanvas?.getContext("2d");
const cascadeToggle = document.getElementById("cascadeToggle");
const cascadeLabel = document.getElementById("cascadeLabel");
const infoToggle = document.getElementById("infoToggle");
const overlayDescription = document.getElementById("overlayDescription");

const statsElements = {
  proton: document.getElementById("stat-proton"),
  gamma: document.getElementById("stat-gamma"),
  pion: document.getElementById("stat-pion"),
  muon: document.getElementById("stat-muon"),
  electron: document.getElementById("stat-electron"),
  positron: document.getElementById("stat-positron"),
  neutrino: document.getElementById("stat-neutrino"),
  iron: document.getElementById("stat-iron"),
};

const particleCountElement = document.getElementById("particleCount");
let hitsActive = true;
let hitCount = 0;
let descriptionVisible = true;

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

function brightnessFactor(energy) {
  const primaryEnergy = Math.max(parseFloat(energyRange.value) || 1, 0.5);
  const ratio = Math.min(energy / primaryEnergy, 1);
  return THREE.MathUtils.clamp(0.35 + 0.65 * ratio, 0.35, 1);
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

function recordHit(particle) {
  if (!hitsActive) return;
  if (hitCount >= maxHits) {
    hitPositions.copyWithin(0, 3);
    hitColors.copyWithin(0, 3);
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
  hitCount += 1;
  hitGeometry.setDrawRange(0, hitCount);
  hitGeometry.attributes.position.needsUpdate = true;
  hitGeometry.attributes.color.needsUpdate = true;
}


function spawnPrimary(type) {
  const energy = parseFloat(energyRange.value);
  const altitude = 70 + (Math.random() - 0.5) * 6;
  const origin = new THREE.Vector3(
    (Math.random() - 0.5) * 10,
    altitude,
    (Math.random() - 0.5) * 10,
  );
  const opts = {
    scatter: type === "gamma" ? 0.08 : 0.2,
    speed: type === "gamma" ? 24 : 18,
  };
  if (type === "iron") {
    opts.scatter = 0.25;
    opts.speed = 20;
  }
  const primary = createParticle(type, origin, energy * (type === "iron" ? 1.3 : 1), opts);
  particles.push(primary);
}

burstButton.addEventListener("click", () => spawnPrimary(primaryTypeSelect.value));
let cascadeActive = false;
cascadeToggle.addEventListener("change", () => {
  cascadeActive = cascadeToggle.checked;
  cascadeLabel.textContent = cascadeActive ? "on" : "off";
  if (cascadeActive) {
    spawnAccumulator = 0;
    spawnPrimary(primaryTypeSelect.value);
  }
});
hitToggle.addEventListener("change", () => {
  hitsActive = hitToggle.checked;
  hitLabel.textContent = hitsActive ? "on" : "off";
});
clearHitsButton.addEventListener("click", () => {
  hitCount = 0;
  hitGeometry.setDrawRange(0, 0);
  hitGeometry.attributes.position.needsUpdate = true;
  hitGeometry.attributes.color.needsUpdate = true;
});
clearButton.addEventListener("click", () => {
  particles.length = 0;
});

energyRange.addEventListener("input", () => {
  energyValue.textContent = parseFloat(energyRange.value).toFixed(1);
});
driveRange.addEventListener("input", () => {
  driveValue.textContent = parseFloat(driveRange.value).toFixed(2);
});
rateRange.addEventListener("input", () => {
  rateValue.textContent = parseFloat(rateRange.value).toFixed(2);
});

infoToggle?.addEventListener("click", () => {
  descriptionVisible = !descriptionVisible;
  if (overlayDescription) {
    overlayDescription.classList.toggle("collapsed", !descriptionVisible);
  }
  infoToggle.textContent = descriptionVisible ? "Hide intro" : "Show intro";
  infoToggle.setAttribute("aria-expanded", descriptionVisible ? "true" : "false");
});

function trimParticles() {
  if (particles.length <= maxParticles) return;
  particles.splice(0, particles.length - maxParticles);
}

function maybeBranch(particle, collector) {
  const drive = parseFloat(driveRange.value);
  const baseProbability = 0.02 * drive + 0.015 * Math.min(particle.energy, 3);
  if (Math.random() > baseProbability) return;
  const heightModifier = Math.max(0, Math.min(1, (particle.position.y + 20) / 90));
  if (Math.random() > 0.7 + 0.3 * heightModifier) return;

  // Electromagnetic shower suppression at low altitude
  const altitudeFactor = Math.max(0, (particle.position.y + 10) / 80);
  
  switch (particle.type) {
    case "proton": {
      if (particle.age < 0.2) return;
      // Proton produces mainly pions
      collector.push(createParticle("pion", particle.position, particle.energy * 0.7, { scatter: 0.4 }));
      collector.push(createParticle("pion", particle.position, particle.energy * 0.45, { scatter: 0.65 }));
      // Fewer gammas from protons
      if (Math.random() < 0.25) {
        collector.push(...createPair(particle, "gamma", "gamma"));
      }
      break;
    }
    case "iron": {
      if (particle.age < 0.15) return;
      // Iron fragments create a MUCH wider shower
      const fragments = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < fragments; i++) {
        collector.push(createParticle("pion", particle.position, particle.energy * 0.5, { scatter: 1.2 }));
      }
      // Iron produces more muons
      if (Math.random() < 0.7) {
        collector.push(createParticle("muon", particle.position, particle.energy * 0.5, { scatter: 0.8, speed: 20 }));
        collector.push(createParticle("muon", particle.position, particle.energy * 0.4, { scatter: 0.9, speed: 18 }));
      }
      // Some proton fragments
      if (Math.random() < 0.5) {
        collector.push(createParticle("proton", particle.position, particle.energy * 0.4, { scatter: 0.9 }));
      }
      break;
    }
    case "gamma": {
      // Suppress electromagnetic cascade at low altitude
      const emProb = 0.35 * altitudeFactor;
      if (Math.random() < emProb) {
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
          createParticle("neutrino", particle.position, particle.energy * 0.2, { scatter: 0.4, upwardBias: 0.3, speed: 16 }),
        );
      }
      break;
    }
    case "muon": {
      if (particle.age > 0.4 && Math.random() < 0.45) {
        collector.push(
          createParticle("electron", particle.position, particle.energy * 0.5, { scatter: 0.35, speed: 14 }),
        );
        collector.push(
          createParticle("neutrino", particle.position, particle.energy * 0.15, { scatter: 0.5, upwardBias: 0.3, speed: 16 }),
        );
      }
      break;
    }
    case "electron":
    case "positron": {
      // Strongly suppress at low altitude
      const emProb = 0.18 * altitudeFactor;
      if (Math.random() < emProb) {
        collector.push(createParticle("gamma", particle.position, particle.energy * 0.3, { scatter: 0.6, upwardBias: 0.1 }));
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
    const hitFloor = particle.position.y < -18;
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
  const counts = {
    proton: 0,
    gamma: 0,
    pion: 0,
    muon: 0,
    electron: 0,
    positron: 0,
    neutrino: 0,
    iron: 0,
  };
  for (const particle of particles) {
    counts[particle.type] += 1;
  }
  for (const type in counts) {
    if (statsElements[type]) {
      statsElements[type].textContent = counts[type];
    }
  }
  particleCountElement.textContent = particles.length;
}

function drawAxisMini() {
  if (!axisCtx) return;
  const width = axisCanvas.width;
  const height = axisCanvas.height;
  axisCtx.clearRect(0, 0, width, height);
  axisCtx.fillStyle = "rgba(4,7,18,0.96)";
  axisCtx.fillRect(0, 0, width, height);

  const centerX = width * 0.35;
  axisCtx.strokeStyle = "rgba(255,255,255,0.45)";
  axisCtx.lineWidth = 1;
  axisCtx.beginPath();
  axisCtx.moveTo(centerX, 4);
  axisCtx.lineTo(centerX, height - 4);
  axisCtx.stroke();

  const ticks = [0, 20, 40, 60, 80];
  axisCtx.fillStyle = "rgba(255,255,255,0.65)";
  axisCtx.font = "0.55rem 'Space Grotesk', sans-serif";
  ticks.forEach((value) => {
    const normalized = (value + 20) / 100; // map [-20,80] to 0-1
    const y = height - normalized * height;
    axisCtx.beginPath();
    axisCtx.moveTo(centerX, y);
    axisCtx.lineTo(centerX - 8, y);
    axisCtx.stroke();
    axisCtx.fillText(`${value} km`, centerX + 6, y + 4);
  });

  let drawn = 0;
  for (let i = particles.length - 1; i >= 0 && drawn < 80; i -= 1) {
    const particle = particles[i];
    const palette = paletteCache[particle.type] || paletteCache.proton;
    const bright = brightnessFactor(particle.energy);
    const normX = THREE.MathUtils.clamp((particle.position.x + 25) / 50, 0, 1);
    const normY = THREE.MathUtils.clamp((particle.position.y + 20) / 100, 0, 1);
    const x = centerX + 6 + normX * (width - centerX - 16);
    const y = height - normY * height;
    const r = Math.round(palette.r * 255 * bright);
    const g = Math.round(palette.g * 255 * bright);
    const b = Math.round(palette.b * 255 * bright);
    axisCtx.fillStyle = `rgba(${r},${g},${b},${0.65 + 0.3 * bright})`;
    axisCtx.beginPath();
    axisCtx.arc(x, y, 1.25, 0, Math.PI * 2);
    axisCtx.fill();
    drawn += 1;
  }
}

function energizeControls() {
  energyValue.textContent = parseFloat(energyRange.value).toFixed(1);
  driveValue.textContent = parseFloat(driveRange.value).toFixed(2);
  rateValue.textContent = parseFloat(rateRange.value).toFixed(2);
  cascadeLabel.textContent = cascadeToggle.checked ? "on" : "off";
  hitLabel.textContent = hitToggle.checked ? "on" : "off";
}

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", onResize);

function animate() {
  const delta = Math.min(clock.getDelta(), 0.045);
  controls.update();
  updateParticles(delta);
  refreshPointCloud();
  updateStats();
  drawAxisMini();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

energizeControls();
animate();
