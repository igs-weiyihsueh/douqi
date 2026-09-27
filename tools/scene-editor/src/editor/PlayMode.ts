import * as THREE from 'three';
import { SceneEditor, SceneObjectData } from './SceneEditor';
import { SceneLoader, RuntimeObject } from '../runtime/SceneLoader';
import { CollisionSystem } from '../runtime/CollisionSystem';
import { QuarksVFXSystem } from '../runtime/QuarksVFXSystem';

/**
 * Simplified PlayMode for 鬥氣割草 scene editor.
 * Only handles animation preview — no combat, AI, or player controller.
 */
export class PlayMode {
  private editor: SceneEditor;
  private active = false;
  private savedState: string = '';

  private collisionSystem: CollisionSystem | null = null;
  private vfxSystem: QuarksVFXSystem | null = null;

  private mixers: THREE.AnimationMixer[] = [];
  private gameCamera: THREE.PerspectiveCamera;
  private originalCamera: THREE.PerspectiveCamera;

  constructor(editor: SceneEditor) {
    this.editor = editor;
    this.gameCamera = new THREE.PerspectiveCamera(60, 1, 1, 5000);
    this.originalCamera = editor.getCamera();
  }

  isActive(): boolean { return this.active; }

  start() {
    if (this.active) return;
    this.active = true;

    // Save state
    this.savedState = JSON.stringify(this.editor.getAllMeta());

    const scene = this.editor.getScene();
    const objects = this.editor.getObjects();
    const metas = this.editor.getAllMeta();

    // Setup VFX
    this.vfxSystem = new QuarksVFXSystem(scene);
    try {
      const raw = localStorage.getItem('douqi_vfx_custom_presets');
      if (raw) {
        const entries = JSON.parse(raw) as Array<[string, { name: string; particles: any }]>;
        for (const [id, data] of entries) {
          this.vfxSystem.registerPreset(id, data);
        }
      }
    } catch { /* ignore */ }

    // Setup collision (for visualization only)
    this.collisionSystem = new CollisionSystem();

    // Setup animation mixers for all objects
    this.mixers = [];
    for (const [id, obj] of objects) {
      const meta = metas.find(m => m.id === id);
      if (!meta) continue;

      // Create mixer if object has animations
      const clips = this.editor.getObjectAnimationClips(id);
      if (clips && clips.length > 0) {
        const mixer = new THREE.AnimationMixer(obj);
        this.mixers.push(mixer);

        // Play idle or first clip
        const behavior = meta.behavior;
        const idleSeg = behavior?.idleSegment;
        if (idleSeg) {
          const segName = idleSeg.startsWith('seg:') ? idleSeg.slice(4) : idleSeg;
          const segs = this.editor.getObjectSegments(id);
          const seg = segs.find(s => s.name === segName);
          if (seg) {
            const fps = this.editor.getObjectFPS(id) || 30;
            const baseClip = clips.find(c => c.name === seg.clipName);
            if (baseClip) {
              const subclip = THREE.AnimationUtils.subclip(baseClip, segName, seg.startFrame, seg.endFrame, fps);
              const action = mixer.clipAction(subclip);
              action.play();
            }
          }
        } else if (clips.length > 0) {
          const action = mixer.clipAction(clips[0]);
          action.play();
        }
      }
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;

    // Cleanup
    this.mixers.forEach(m => m.stopAllAction());
    this.mixers = [];

    if (this.vfxSystem) {
      this.vfxSystem.dispose();
      this.vfxSystem = null;
    }
    this.collisionSystem = null;
  }

  update(delta: number) {
    if (!this.active) return;
    this.mixers.forEach(m => m.update(delta));
    this.vfxSystem?.update(delta);
  }
}
