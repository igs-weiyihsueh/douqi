import * as THREE from 'three';

export interface ParticleConfig {
  count: number;
  speed: number;
  speedVariance: number;
  size: number;
  sizeEnd: number;
  lifetime: number;
  lifetimeVariance: number;
  color: string;         // hex color e.g. '#ff4400'
  colorEnd?: string;     // fade to this color
  gravity: number;       // downward acceleration
  spread: number;        // cone spread angle in degrees (360 = sphere)
  direction: [number, number, number]; // base emission direction
  opacity: number;
  opacityEnd: number;
  texture?: string;      // 'circle' | 'spark' | 'ring' | 'star' (built-in)
  // Extended parameters
  renderMode?: 'billboard' | 'stretched' | 'trail';
  lengthFactor?: number;   // stretched mode: length multiplier (default 3)
  emitterShape?: 'point' | 'sphere' | 'cone' | 'circle';
  emitterRadius?: number;  // emission area radius (default 1)
  trailLength?: number;    // trail mode: length of trail
  orbitalForce?: number;   // rotational force around emission center
  drag?: number;           // velocity drag (0-1, 0=no drag)
  emissionMode?: 'burst' | 'continuous';  // burst=one-shot, continuous=ongoing
  emissionRate?: number;   // particles per second (continuous mode)
  duration?: number;       // effect total duration (continuous mode)
}

export interface VFXPreset {
  name: string;
  particles: ParticleConfig;
}

interface ActiveEffect {
  mesh: THREE.Points;
  positions: Float32Array;
  velocities: Float32Array;
  lifetimes: Float32Array;
  maxLifetimes: Float32Array;
  sizes: Float32Array;
  colors: Float32Array;
  config: ParticleConfig;
  scale: number;
  elapsed: number;
  maxLife: number;
}

// Built-in presets
export const VFX_PRESETS: Record<string, VFXPreset> = {
  hit_spark: {
    name: '打擊火花',
    particles: {
      count: 15,
      speed: 150,
      speedVariance: 60,
      size: 12,
      sizeEnd: 2,
      lifetime: 0.35,
      lifetimeVariance: 0.1,
      color: '#4488ff',
      colorEnd: '#2244aa',
      gravity: 200,
      spread: 120,
      direction: [0, 1, 0],
      opacity: 1,
      opacityEnd: 0,
      texture: 'circle',
    },
  },
  hit_blood: {
    name: '血液飛濺',
    particles: {
      count: 12,
      speed: 120,
      speedVariance: 40,
      size: 10,
      sizeEnd: 4,
      lifetime: 0.4,
      lifetimeVariance: 0.15,
      color: '#cc0000',
      colorEnd: '#660000',
      gravity: 300,
      spread: 90,
      direction: [0, 1, 0],
      opacity: 1,
      opacityEnd: 0,
      texture: 'circle',
    },
  },
  hit_dust: {
    name: '灰塵',
    particles: {
      count: 8,
      speed: 50,
      speedVariance: 25,
      size: 18,
      sizeEnd: 30,
      lifetime: 0.5,
      lifetimeVariance: 0.2,
      color: '#aa9977',
      colorEnd: '#665544',
      gravity: -20,
      spread: 360,
      direction: [0, 1, 0],
      opacity: 0.6,
      opacityEnd: 0,
      texture: 'circle',
    },
  },
  death_explosion: {
    name: '死亡爆炸',
    particles: {
      count: 25,
      speed: 200,
      speedVariance: 80,
      size: 15,
      sizeEnd: 4,
      lifetime: 0.6,
      lifetimeVariance: 0.2,
      color: '#ffffff',
      colorEnd: '#ffaa00',
      gravity: 150,
      spread: 360,
      direction: [0, 1, 0],
      opacity: 1,
      opacityEnd: 0,
      texture: 'star',
    },
  },
  heal_sparkle: {
    name: '治癒光芒',
    particles: {
      count: 20,
      speed: 40,
      speedVariance: 20,
      size: 8,
      sizeEnd: 0,
      lifetime: 0.8,
      lifetimeVariance: 0.3,
      color: '#44ff88',
      colorEnd: '#88ffcc',
      gravity: -50,
      spread: 360,
      direction: [0, 1, 0],
      opacity: 0.8,
      opacityEnd: 0,
      texture: 'star',
    },
  },
  attack_slash: {
    name: '斬擊揮砍',
    particles: {
      count: 10,
      speed: 180,
      speedVariance: 40,
      size: 10,
      sizeEnd: 3,
      lifetime: 0.2,
      lifetimeVariance: 0.05,
      color: '#ffffff',
      colorEnd: '#aaddff',
      gravity: 0,
      spread: 30,
      direction: [0, 0, 1],
      opacity: 1,
      opacityEnd: 0,
      texture: 'spark',
    },
  },
  attack_punch: {
    name: '拳擊衝擊',
    particles: {
      count: 8,
      speed: 100,
      speedVariance: 30,
      size: 14,
      sizeEnd: 6,
      lifetime: 0.25,
      lifetimeVariance: 0.08,
      color: '#ffdd44',
      colorEnd: '#ff8800',
      gravity: 50,
      spread: 60,
      direction: [0, 0, 1],
      opacity: 1,
      opacityEnd: 0,
      texture: 'circle',
    },
  },
  attack_energy: {
    name: '能量波動',
    particles: {
      count: 12,
      speed: 60,
      speedVariance: 20,
      size: 16,
      sizeEnd: 4,
      lifetime: 0.35,
      lifetimeVariance: 0.1,
      color: '#8844ff',
      colorEnd: '#4400aa',
      gravity: -20,
      spread: 45,
      direction: [0, 0, 1],
      opacity: 0.9,
      opacityEnd: 0,
      texture: 'ring',
    },
  },
};

export class VFXSystem {
  private scene: THREE.Scene;
  private effects: ActiveEffect[] = [];
  private textureCache: Map<string, THREE.Texture> = new Map();
  private customPresets: Map<string, VFXPreset> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.buildTextures();
  }

  private buildTextures() {
    // Generate procedural textures for particles
    this.textureCache.set('circle', this.generateCircleTexture());
    this.textureCache.set('spark', this.generateSparkTexture());
    this.textureCache.set('ring', this.generateRingTexture());
    this.textureCache.set('star', this.generateStarTexture());
  }

  private generateCircleTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private generateSparkTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 4);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private generateRingTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  private generateStarTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.translate(size / 2, size / 2);
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-1.5, -size / 2 + 4, 3, size - 8);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /** Register a custom preset (from editor) */
  registerPreset(id: string, preset: VFXPreset) {
    this.customPresets.set(id, preset);
  }

  getPreset(id: string): VFXPreset | undefined {
    return this.customPresets.get(id) || VFX_PRESETS[id];
  }

  getAllPresets(): Array<{ id: string; name: string }> {
    const result: Array<{ id: string; name: string }> = [];
    for (const [id, p] of Object.entries(VFX_PRESETS)) {
      result.push({ id, name: p.name });
    }
    for (const [id, p] of this.customPresets) {
      result.push({ id, name: p.name });
    }
    return result;
  }

  /**
   * Spawn a particle effect at the given world position.
   */
  spawn(presetId: string, position: THREE.Vector3, direction?: THREE.Vector3, scale = 1.0) {
    const preset = this.getPreset(presetId);
    if (!preset) return;
    this.spawnFromConfig(preset.particles, position, direction, scale);
  }

  /**
   * Spawn from a raw ParticleConfig (for editor preview).
   */
  spawnFromConfig(config: ParticleConfig, position: THREE.Vector3, direction?: THREE.Vector3, scale = 1.0) {
    const count = config.count;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const lifetimes = new Float32Array(count);
    const maxLifetimes = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    const baseDir = direction
      ? direction.clone().normalize()
      : new THREE.Vector3(config.direction[0], config.direction[1], config.direction[2]).normalize();

    const spreadRad = THREE.MathUtils.degToRad(config.spread / 2);
    const startColor = new THREE.Color(config.color);

    for (let i = 0; i < count; i++) {
      // Position: all start at spawn point
      positions[i * 3] = position.x;
      positions[i * 3 + 1] = position.y;
      positions[i * 3 + 2] = position.z;

      // Velocity: random within cone
      const speed = (config.speed + (Math.random() - 0.5) * 2 * config.speedVariance) * scale;
      const dir = this.randomConeDirection(baseDir, spreadRad);
      velocities[i * 3] = dir.x * speed;
      velocities[i * 3 + 1] = dir.y * speed;
      velocities[i * 3 + 2] = dir.z * speed;

      // Lifetime
      const lt = config.lifetime + (Math.random() - 0.5) * 2 * config.lifetimeVariance;
      lifetimes[i] = Math.max(0.05, lt);
      maxLifetimes[i] = lifetimes[i];

      // Size
      sizes[i] = config.size * scale;

      // Color
      colors[i * 3] = startColor.r;
      colors[i * 3 + 1] = startColor.g;
      colors[i * 3 + 2] = startColor.b;
    }

    // Create geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const texture = this.textureCache.get(config.texture || 'circle') || this.textureCache.get('circle')!;

    const material = new THREE.PointsMaterial({
      size: config.size * scale,
      map: texture,
      transparent: true,
      opacity: config.opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });

    const mesh = new THREE.Points(geometry, material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    const maxLife = config.lifetime + config.lifetimeVariance;
    this.effects.push({
      mesh,
      positions,
      velocities,
      lifetimes,
      maxLifetimes,
      sizes,
      colors,
      config,
      scale,
      elapsed: 0,
      maxLife,
    });
  }

  update(delta: number) {
    const toRemove: number[] = [];

    for (let ei = 0; ei < this.effects.length; ei++) {
      const effect = this.effects[ei];
      effect.elapsed += delta;

      // Remove if all particles dead
      if (effect.elapsed > effect.maxLife + 0.1) {
        toRemove.push(ei);
        continue;
      }

      const { positions, velocities, lifetimes, maxLifetimes, sizes, colors, config } = effect;
      const count = config.count;
      const effectScale = effect.scale;
      const startColor = new THREE.Color(config.color);
      const endColor = new THREE.Color(config.colorEnd || config.color);
      let allDead = true;

      for (let i = 0; i < count; i++) {
        lifetimes[i] -= delta;
        if (lifetimes[i] <= 0) {
          sizes[i] = 0;
          continue;
        }
        allDead = false;

        const t = 1 - lifetimes[i] / maxLifetimes[i]; // 0→1

        // Update position
        positions[i * 3] += velocities[i * 3] * delta;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * delta;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * delta;

        // Apply gravity
        velocities[i * 3 + 1] -= config.gravity * delta;

        // Lerp size (with scale applied)
        sizes[i] = THREE.MathUtils.lerp(config.size, config.sizeEnd, t) * effectScale;

        // Lerp color
        colors[i * 3] = THREE.MathUtils.lerp(startColor.r, endColor.r, t);
        colors[i * 3 + 1] = THREE.MathUtils.lerp(startColor.g, endColor.g, t);
        colors[i * 3 + 2] = THREE.MathUtils.lerp(startColor.b, endColor.b, t);
      }

      // Update geometry
      (effect.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (effect.mesh.geometry.attributes.size as THREE.BufferAttribute).needsUpdate = true;
      (effect.mesh.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;

      // Update material opacity
      const overallT = Math.min(1, effect.elapsed / effect.maxLife);
      (effect.mesh.material as THREE.PointsMaterial).opacity = THREE.MathUtils.lerp(config.opacity, config.opacityEnd, overallT);

      if (allDead) toRemove.push(ei);
    }

    // Cleanup
    for (let i = toRemove.length - 1; i >= 0; i--) {
      const idx = toRemove[i];
      const effect = this.effects[idx];
      this.scene.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      (effect.mesh.material as THREE.PointsMaterial).dispose();
      this.effects.splice(idx, 1);
    }
  }

  private randomConeDirection(baseDir: THREE.Vector3, halfAngle: number): THREE.Vector3 {
    // Random direction within a cone around baseDir
    const u = Math.random();
    const v = Math.random();
    const theta = halfAngle * Math.sqrt(u); // bias toward center
    const phi = 2 * Math.PI * v;

    // Create a local frame
    const up = Math.abs(baseDir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(baseDir, up).normalize();
    const forward = new THREE.Vector3().crossVectors(right, baseDir).normalize();

    const dir = baseDir.clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(right, Math.sin(theta) * Math.cos(phi))
      .addScaledVector(forward, Math.sin(theta) * Math.sin(phi));

    return dir.normalize();
  }

  dispose() {
    for (const effect of this.effects) {
      this.scene.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      (effect.mesh.material as THREE.PointsMaterial).dispose();
    }
    this.effects = [];
  }
}
