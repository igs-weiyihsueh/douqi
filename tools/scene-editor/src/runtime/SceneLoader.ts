import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface AnimSegment {
  name: string;
  clipName: string;
  startFrame: number;
  endFrame: number;
  speed?: number;
}

export interface RuntimeObject {
  id: string;
  name: string;
  object3D: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  clips: THREE.AnimationClip[];
  segments: AnimSegment[];
  fps: number;
  currentAction: THREE.AnimationAction | null;
}

export class SceneLoader {
  private scene: THREE.Scene;
  private modelCache: Map<string, THREE.Group> = new Map();
  private objects: Map<string, RuntimeObject> = new Map();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  async loadBundle(file: File): Promise<RuntimeObject[]> {
    let raw: any;

    // Auto-detect gzip
    const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (header[0] === 0x1f && header[1] === 0x8b && 'DecompressionStream' in window) {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = file.stream().pipeThrough(ds);
      const text = await new Response(decompressedStream).text();
      raw = JSON.parse(text);
    } else {
      raw = JSON.parse(await file.text());
    }

    if (raw._format !== 'scene-bundle') {
      throw new Error('Not a valid scene bundle');
    }

    const { scene: sceneData, models, textures, clipNames, extraAnims } = raw;

    // Setup lighting
    this.setupLighting(sceneData);

    // Load models into cache
    for (const [modelPath, base64] of Object.entries(models as Record<string, string>)) {
      if (this.modelCache.has(modelPath)) continue;
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const loader = new FBXLoader();
      const fbx = await loader.loadAsync(url);
      URL.revokeObjectURL(url);
      this.upgradeMaterials(fbx);

      // Rename clips to match editor names if mapping exists
      if (clipNames && clipNames[modelPath] && fbx.animations) {
        const names = clipNames[modelPath] as string[];
        // First rename existing clips
        for (let i = 0; i < Math.min(names.length, fbx.animations.length); i++) {
          fbx.animations[i].name = names[i];
        }
      }

      // Load extra animation FBXs if any
      if (extraAnims && extraAnims[modelPath]) {
        const extraList = extraAnims[modelPath] as string[];
        for (const base64 of extraList) {
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const extraBlob = new Blob([bytes], { type: 'application/octet-stream' });
          const extraUrl = URL.createObjectURL(extraBlob);
          try {
            const extraFbx = await loader.loadAsync(extraUrl);
            if (extraFbx.animations.length > 0) {
              fbx.animations.push(...extraFbx.animations);
            }
          } catch { /* skip failed extra anims */ }
          URL.revokeObjectURL(extraUrl);
        }
        // Now rename all clips to match editor names
        if (clipNames && clipNames[modelPath]) {
          const names = clipNames[modelPath] as string[];
          for (let i = 0; i < Math.min(names.length, fbx.animations.length); i++) {
            fbx.animations[i].name = names[i];
          }
        }
      }

      this.modelCache.set(modelPath, fbx);
    }

    // Spawn objects
    const results: RuntimeObject[] = [];
    for (const objData of sceneData.objects) {
      const source = this.modelCache.get(objData.modelPath);
      if (!source) continue;

      const clone = SkeletonUtils.clone(source) as THREE.Group;
      clone.animations = source.animations;

      // Apply transform
      clone.position.set(...(objData.position as [number, number, number]));
      clone.rotation.set(
        THREE.MathUtils.degToRad(objData.rotation[0]),
        THREE.MathUtils.degToRad(objData.rotation[1]),
        THREE.MathUtils.degToRad(objData.rotation[2])
      );
      clone.scale.set(...(objData.scale as [number, number, number]));

      // Apply textures from bundle
      if (textures) {
        this.applyTextures(clone, objData.modelPath, textures);
      }

      // Apply per-material color/brightness from object data
      if (objData.textures) {
        this.applyMaterialProperties(clone, objData.textures);
      }

      this.scene.add(clone);

      // Setup animation
      let mixer: THREE.AnimationMixer | null = null;
      if (clone.animations.length > 0) {
        mixer = new THREE.AnimationMixer(clone);
      }

      const fps = this.detectFPS(clone.animations);
      const runtimeObj: RuntimeObject = {
        id: objData.id,
        name: objData.name,
        object3D: clone,
        mixer,
        clips: clone.animations,
        segments: objData.animations || [],
        fps,
        currentAction: null,
      };

      this.objects.set(objData.id, runtimeObj);
      results.push(runtimeObj);
    }

    return results;
  }

  getObject(id: string): RuntimeObject | undefined {
    return this.objects.get(id);
  }

  getAllObjects(): RuntimeObject[] {
    return Array.from(this.objects.values());
  }

  playSegment(obj: RuntimeObject, segmentName: string, loop = true) {
    if (!obj.mixer) { console.warn(`[playSegment] ${obj.name}: no mixer`); return; }
    const seg = obj.segments.find((s) => s.name === segmentName);
    if (!seg) { console.warn(`[playSegment] ${obj.name}: segment "${segmentName}" not found. Available:`, obj.segments.map(s => s.name)); return; }

    const clip = obj.clips.find((c) => c.name === seg.clipName);
    if (!clip) { console.warn(`[playSegment] ${obj.name}: clip "${seg.clipName}" not found. Available:`, obj.clips.map(c => c.name)); return; }

    const segKey = `${seg.clipName}_${seg.startFrame}_${seg.endFrame}`;

    // If this segment is already the current action and playing, skip
    if (obj.currentAction && obj.currentAction.getClip().name === segKey) {
      // Update timeScale in case speed was changed
      obj.currentAction.timeScale = seg.speed ?? 1.0;
      if (!obj.currentAction.paused && obj.currentAction.isRunning()) return;
      // If paused or stopped, reset and play
      obj.currentAction.reset().play();
      return;
    }

    if (obj.currentAction) obj.currentAction.fadeOut(0.2);

    const subClip = THREE.AnimationUtils.subclip(clip, segKey, seg.startFrame, seg.endFrame, obj.fps);
    const action = obj.mixer.clipAction(subClip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.timeScale = seg.speed ?? 1.0;
    action.reset().fadeIn(0.2).play();
    obj.currentAction = action;
  }

  playClip(obj: RuntimeObject, clipName: string, loop = true) {
    if (!obj.mixer) return;

    // Skip if same clip is already playing
    if (obj.currentAction && obj.currentAction.getClip().name === clipName && obj.currentAction.isRunning()) {
      return;
    }

    if (obj.currentAction) obj.currentAction.fadeOut(0.3);

    const clip = obj.clips.find((c) => c.name === clipName);
    if (!clip) return;

    const action = obj.mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.reset().fadeIn(0.3).play();
    obj.currentAction = action;
  }

  update(delta: number) {
    this.objects.forEach((obj) => {
      obj.mixer?.update(delta);
    });
  }

  private setupLighting(sceneData: any) {
    const ambient = new THREE.AmbientLight(
      sceneData.ambientColor || '#ffffff',
      sceneData.ambientIntensity ?? 1.8
    );
    this.scene.add(ambient);

    const sun = new THREE.DirectionalLight(
      sceneData.sunColor || '#ffffff',
      sceneData.sunIntensity ?? 1.5
    );
    const sunDir = sceneData.sunDirection || [100, 200, 150];
    sun.position.set(sunDir[0], sunDir[1], sunDir[2]);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 1500;
    const s = 500;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    this.scene.add(sun);

    const hemi = new THREE.HemisphereLight(0xccddff, 0x554433, 0.6);
    this.scene.add(hemi);

    const fill = new THREE.DirectionalLight(0xaaccff, 0.8);
    fill.position.set(-100, 100, -100);
    this.scene.add(fill);
  }

  private toonGradientMap: THREE.DataTexture | null = null;
  private ensureTexturePot(texture: THREE.Texture) {
    const img = texture.image as HTMLImageElement | HTMLCanvasElement | null;
    if (!img) return;
    const w = (img as any).width || (img as any).naturalWidth;
    const h = (img as any).height || (img as any).naturalHeight;
    if (!w || !h) return;
    const isPot = (v: number) => (v & (v - 1)) === 0 && v > 0;
    if (isPot(w) && isPot(h)) return;
    const nearestPot = (v: number) => Math.pow(2, Math.round(Math.log2(v)));
    const newW = nearestPot(w);
    const newH = nearestPot(h);
    const canvas = document.createElement('canvas');
    canvas.width = newW;
    canvas.height = newH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img as CanvasImageSource, 0, 0, newW, newH);
    texture.image = canvas;
    texture.needsUpdate = true;
  }

  private getToonGradientMap(): THREE.DataTexture {
    if (this.toonGradientMap) return this.toonGradientMap;
    // Match editor's exact gradient: 3-step toon with RedFormat
    const colors = new Uint8Array([140, 200, 255]);
    const tex = new THREE.DataTexture(colors, colors.length, 1, THREE.RedFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this.toonGradientMap = tex;
    return tex;
  }

  private upgradeMaterials(fbx: THREE.Group) {
    const gradientMap = this.getToonGradientMap();
    fbx.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Set anisotropy on all existing textures
        const existingMats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of existingMats) {
          const mat = m as any;
          for (const prop of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap']) {
            if (mat[prop]?.isTexture) {
              this.ensureTexturePot(mat[prop]);
              mat[prop].anisotropy = 16;
              mat[prop].generateMipmaps = true;
              mat[prop].minFilter = THREE.LinearMipmapLinearFilter;
              mat[prop].magFilter = THREE.LinearFilter;
              mat[prop].needsUpdate = true;
            }
          }
        }
        const upgrade = (mat: THREE.Material): THREE.Material => {
          if ((mat as any).isMeshToonMaterial) return mat;
          const old = mat as any;
          const newMat = new THREE.MeshToonMaterial({
            color: old.color ?? 0xcccccc,
            map: old.map ?? null,
            gradientMap,
            side: THREE.DoubleSide,
            transparent: old.transparent ?? false,
            opacity: old.opacity ?? 1,
          });
          if (old.map) {
            old.map.colorSpace = THREE.SRGBColorSpace;
            this.ensureTexturePot(old.map);
            old.map.anisotropy = 16;
            old.map.generateMipmaps = true;
            old.map.minFilter = THREE.LinearMipmapLinearFilter;
            old.map.magFilter = THREE.LinearFilter;
            old.map.needsUpdate = true;
          }
          return newMat;
        };
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map(upgrade);
        } else {
          mesh.material = upgrade(mesh.material);
        }
      }
    });
  }

  private applyTextures(obj: THREE.Group, modelPath: string, textures: Record<string, any>) {
    const materials: THREE.Material[] = [];
    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          if ((m as any).isMeshStandardMaterial || (m as any).isMeshToonMaterial) {
            materials.push(m);
          }
        });
      }
    });

    for (let i = 0; i < materials.length; i++) {
      for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
        const key = `${modelPath}__${i}__${mapType}`;
        const entry = textures[key];
        if (entry) {
          const dataUrl = typeof entry === 'string' ? entry : entry.dataUrl;
          if (!dataUrl) continue;
          const texture = new THREE.TextureLoader().load(dataUrl);
          texture.colorSpace = mapType === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
          texture.flipY = true;
          texture.wrapS = THREE.RepeatWrapping;
          texture.wrapT = THREE.RepeatWrapping;
          if (entry.tiling) texture.repeat.set(entry.tiling[0], entry.tiling[1]);
          if (entry.offset) texture.offset.set(entry.offset[0], entry.offset[1]);
          (materials[i] as any)[mapType] = texture;
          materials[i].needsUpdate = true;
        }
      }
    }
  }

  private applyMaterialProperties(obj: THREE.Group, texturesMeta: Record<number, any>) {
    const materials: THREE.Material[] = [];
    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => materials.push(m));
      }
    });

    for (const [slotStr, props] of Object.entries(texturesMeta)) {
      const slotIndex = parseInt(slotStr);
      if (isNaN(slotIndex) || slotIndex >= materials.length) continue;
      const mat = materials[slotIndex] as any;

      // Apply color tint
      if (props.color && mat.color) {
        mat.color.set(props.color);
      }

      // Apply brightness via emissive (same as editor)
      if (props.brightness !== undefined && props.brightness !== 1.0 && mat.emissive) {
        const baseColor = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
        const emissiveStrength = Math.max(0, props.brightness - 1.0);
        mat.emissive.copy(baseColor).multiplyScalar(emissiveStrength);
      }

      mat.needsUpdate = true;
    }
  }

  private detectFPS(clips: THREE.AnimationClip[]): number {
    if (clips.length === 0) return 30;
    const track = clips[0].tracks[0];
    if (!track || track.times.length < 2) return 30;
    const fps = Math.round(1 / (track.times[1] - track.times[0]));
    return (fps > 0 && fps <= 120) ? fps : 30;
  }
}
