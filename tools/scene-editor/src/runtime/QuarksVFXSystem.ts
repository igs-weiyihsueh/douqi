import * as THREE from 'three';
import {
  BatchedRenderer,
  ParticleSystem,
  ConstantValue,
  IntervalValue,
  ConstantColor,
  ConeEmitter,
  SphereEmitter,
  RenderMode,
  SizeOverLife,
  ColorOverLife,
  PiecewiseBezier,
  Bezier,
  Gradient,
} from 'three.quarks';
import { Vector3 as QVector3, Vector4 as QVector4 } from 'three.quarks';
import { ParticleConfig, VFXPreset, VFX_PRESETS } from './VFXSystem';

/**
 * three.quarks-based VFX system.
 * Drop-in replacement for the old CPU-based VFXSystem.
 * Same public API: spawn(presetId, position, direction?, scale?), update(delta).
 */
export class QuarksVFXSystem {
  private scene: THREE.Scene;
  private batchRenderer: BatchedRenderer;
  private customPresets: Map<string, VFXPreset> = new Map();
  private textureCache: Map<string, THREE.Texture> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.batchRenderer = new BatchedRenderer();
    scene.add(this.batchRenderer);
    this.buildTextures();
  }

  private buildTextures() {
    this.textureCache.set('circle', this.generateCircleTexture());
    this.textureCache.set('spark', this.generateSparkTexture());
    this.textureCache.set('ring', this.generateRingTexture());
    this.textureCache.set('star', this.generateStarTexture());
  }

  registerPreset(id: string, preset: VFXPreset) {
    this.customPresets.set(id, preset);
  }

  getPreset(id: string): VFXPreset | undefined {
    return this.customPresets.get(id) || VFX_PRESETS[id];
  }

  listPresets(): Array<{ id: string; name: string }> {
    const result: Array<{ id: string; name: string }> = [];
    for (const [id, p] of Object.entries(VFX_PRESETS)) {
      result.push({ id, name: p.name });
    }
    for (const [id, p] of this.customPresets) {
      result.push({ id, name: p.name });
    }
    return result;
  }

  getAllPresets(): Array<{ id: string; name: string }> {
    return this.listPresets();
  }

  /**
   * Spawn a particle effect at the given world position.
   * @param attachTo - if provided, emitter is attached to this object (follows it)
   */
  spawn(presetId: string, position: THREE.Vector3, direction?: THREE.Vector3, scale = 1.0, attachTo?: THREE.Object3D) {
    const preset = this.getPreset(presetId);
    if (!preset) { console.warn(`[Quarks] preset not found: ${presetId}`); return; }
    console.log(`[Quarks] spawn: ${presetId} at (${position.x.toFixed(0)}, ${position.y.toFixed(0)}, ${position.z.toFixed(0)}) follow=${!!attachTo}`);
    this.spawnFromConfig(preset.particles, position, direction, scale, attachTo);
  }

  /**
   * Spawn from a raw ParticleConfig (for editor preview).
   */
  spawnFromConfig(config: ParticleConfig, position: THREE.Vector3, direction?: THREE.Vector3, scale = 1.0, attachTo?: THREE.Object3D) {
    const texture = this.textureCache.get(config.texture || 'circle') || this.textureCache.get('circle')!;

    // Compute emission direction
    const baseDir = direction
      ? direction.clone().normalize()
      : new THREE.Vector3(config.direction[0], config.direction[1], config.direction[2]).normalize();

    const spreadRad = THREE.MathUtils.degToRad(config.spread / 2);

    // Emitter shape
    const emitterRadius = (config.emitterRadius ?? 1) * scale;
    let shape: any;
    const shapeType = config.emitterShape || (config.spread >= 350 ? 'sphere' : 'cone');
    switch (shapeType) {
      case 'sphere': shape = new SphereEmitter({ radius: emitterRadius }); break;
      case 'cone': shape = new ConeEmitter({ radius: emitterRadius, angle: spreadRad }); break;
      case 'circle': shape = new ConeEmitter({ radius: emitterRadius, angle: 0 }); break;
      case 'point': default: shape = new ConeEmitter({ radius: 0.01, angle: spreadRad }); break;
    }

    // Colors
    const startColor = new THREE.Color(config.color);
    const endColor = config.colorEnd ? new THREE.Color(config.colorEnd) : startColor.clone();

    // Render mode
    let renderMode = RenderMode.BillBoard;
    let rendererSettings: any = undefined;
    const rm = config.renderMode || 'billboard';
    if (rm === 'stretched') {
      renderMode = RenderMode.StretchedBillBoard;
      rendererSettings = { speedFactor: 0.05, lengthFactor: config.lengthFactor ?? 3 };
    } else if (rm === 'trail') {
      renderMode = RenderMode.Trail;
      rendererSettings = { startLength: new ConstantValue(config.trailLength ?? 10), followLocalOrigin: false };
    }

    // Emission mode
    const isContinuous = config.emissionMode === 'continuous';
    const effectDuration = isContinuous ? (config.duration ?? 1) : (config.lifetime + config.lifetimeVariance + 0.1);

    // Build particle system
    const psParams: any = {
      duration: effectDuration + 0.5,
      looping: false,
      startLife: new IntervalValue(
        Math.max(0.05, config.lifetime - config.lifetimeVariance),
        config.lifetime + config.lifetimeVariance
      ),
      startSpeed: new IntervalValue(
        Math.max(0, (config.speed - config.speedVariance) * scale),
        (config.speed + config.speedVariance) * scale
      ),
      startSize: new IntervalValue(config.size * scale * 0.5, config.size * scale),
      startColor: new ConstantColor(new QVector4(startColor.r, startColor.g, startColor.b, config.opacity)),
      emissionOverTime: isContinuous ? new ConstantValue(config.emissionRate ?? 20) : new ConstantValue(0),
      emissionBursts: isContinuous ? [] : [{
        time: 0,
        count: new ConstantValue(config.count),
        cycle: 1,
        interval: 0.01,
        probability: 1,
      }],
      shape,
      material: new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      renderMode,
      startTileIndex: new ConstantValue(0),
      worldSpace: true,
    };
    if (rendererSettings) psParams.rendererEmitterSettings = rendererSettings;

    const ps = new ParticleSystem(psParams);

    // Behaviors: Size over life
    const sizeRatio = config.sizeEnd / config.size;
    ps.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 1, sizeRatio, sizeRatio), 0]])));

    // Color over life
    const colorGradient = new Gradient(
      [[new QVector3(startColor.r, startColor.g, startColor.b), 0], [new QVector3(endColor.r, endColor.g, endColor.b), 1]],
      [[config.opacity, 0], [config.opacityEnd, 1]],
    );
    ps.addBehavior(new ColorOverLife(colorGradient));

    // Position & orient emitter
    // ConeEmitter emits along +Z by default
    const fwd = new THREE.Vector3(0, 0, 1);

    // Add to scene or attach to parent
    if (attachTo) {
      // Follow mode: emitter is child of the target object
      // Convert world position to local offset
      const invMatrix = attachTo.matrixWorld.clone().invert();
      const localPos = position.clone().applyMatrix4(invMatrix);
      ps.emitter.position.copy(localPos);

      // Don't set emitter local rotation — let it inherit parent's rotation naturally.
      // This means the emitter always emits in parent's forward (+Z) direction,
      // and when parent rotates, the emission direction follows.
      // The marker's rotation is baked into the initial emission direction by shape orientation.

      // Compensate for parent scale (so particle size isn't affected by object scale)
      const parentScale = new THREE.Vector3();
      attachTo.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), parentScale);
      const scaleCompensation = 1 / Math.max(parentScale.x, parentScale.y, parentScale.z);
      ps.emitter.scale.setScalar(scaleCompensation);

      attachTo.add(ps.emitter);
    } else {
      // World space: just set position and orient
      ps.emitter.position.copy(position);
      if (baseDir.distanceTo(fwd) > 0.01) {
        const quat = new THREE.Quaternion().setFromUnitVectors(fwd, baseDir);
        ps.emitter.quaternion.copy(quat);
      }
      this.scene.add(ps.emitter);
    }
    this.batchRenderer.addSystem(ps);

    // Auto-destroy
    const maxLife = effectDuration + config.lifetime + config.lifetimeVariance + 0.5;
    setTimeout(() => {
      this.batchRenderer.deleteSystem(ps);
      if (attachTo) {
        attachTo.remove(ps.emitter);
      } else {
        this.scene.remove(ps.emitter);
      }
    }, maxLife * 1000);
  }

  update(delta: number) {
    this.batchRenderer.update(delta);
  }

  /**
   * Spawn a dash trail effect attached to an object.
   * Creates large ghost-like particles that linger and fade along the dash path.
   */
  spawnDashTrail(emitterParent: THREE.Object3D, duration: number, color = '#66ddff') {
    const trailColor = new THREE.Color(color);
    const texture = this.textureCache.get('circle')!;

    const ps = new ParticleSystem({
      duration: 5, // long duration so system doesn't auto-end before particles finish
      looping: false,
      startLife: new IntervalValue(0.3, 1.2), // wide range: each particle lives different time
      startSpeed: new IntervalValue(20, 60), // random drift speed per particle
      startSize: new IntervalValue(80, 140), // large afterimage size
      startColor: new ConstantColor(new QVector4(trailColor.r, trailColor.g, trailColor.b, 0.7)),
      emissionOverTime: new ConstantValue(80),
      emissionBursts: [],
      shape: new SphereEmitter({ radius: 10 }),
      material: new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
      renderMode: RenderMode.BillBoard,
      startTileIndex: new ConstantValue(0),
      worldSpace: true,
    });

    // Each particle shrinks on its own timeline
    ps.addBehavior(new SizeOverLife(new PiecewiseBezier([[new Bezier(1, 0.6, 0.2, 0), 0]])));

    // Each particle fades on its own timeline
    const fadeGradient = new Gradient(
      [[new QVector3(trailColor.r, trailColor.g, trailColor.b), 0], [new QVector3(trailColor.r * 0.1, trailColor.g * 0.1, trailColor.b * 0.3), 1]],
      [[0.7, 0], [0, 1]],
    );
    ps.addBehavior(new ColorOverLife(fadeGradient));

    // Attach emitter to character
    emitterParent.add(ps.emitter);
    ps.emitter.position.set(0, 40, 0);

    this.batchRenderer.addSystem(ps);

    // After dash duration: stop emitting new particles (existing ones continue their life naturally)
    setTimeout(() => {
      // Set emission to 0 instead of pause — so existing particles keep animating
      (ps as any).emissionOverTime = new ConstantValue(0);
    }, duration * 1000);

    // Cleanup after all particles have died (max life = 1.2s + buffer)
    setTimeout(() => {
      this.batchRenderer.deleteSystem(ps);
      emitterParent.remove(ps.emitter);
    }, (duration + 1.5) * 1000);

    console.log(`[Quarks] dash trail spawned (duration: ${duration}s)`);
  }

  dispose() {
    this.scene.remove(this.batchRenderer);
  }

  // --- Texture generation ---

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
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
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
    const cx = size / 2, cy = size / 2;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const x = cx + Math.cos(angle) * (size / 2 - 4);
      const y = cy + Math.sin(angle) * (size / 2 - 4);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
}
