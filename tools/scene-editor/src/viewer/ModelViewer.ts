import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

export interface AnimSegment {
  name: string;
  clipName: string;
  startFrame: number;
  endFrame: number;
}

export class ModelViewer {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private mixer: THREE.AnimationMixer | null = null;
  private clock = new THREE.Clock();
  private currentModel: THREE.Group | null = null;
  private animations: THREE.AnimationClip[] = [];
  private currentAction: THREE.AnimationAction | null = null;
  private fps = 30;
  private paused = false;

  // Exposed lights for UI control
  ambientLight!: THREE.AmbientLight;
  keyLight!: THREE.DirectionalLight;
  fillLight!: THREE.DirectionalLight;
  hemiLight!: THREE.HemisphereLight;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x3a3a4e);

    this.camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / container.clientHeight, 0.1, 5000
    );
    this.camera.position.set(0, 100, 200);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 50, 0);

    this.setupLights();
    this.setupGround();
    this.setupAxisHelper();
    this.animate();

    window.addEventListener('resize', this.onResize);
  }

  private setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(this.ambientLight);

    this.keyLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.keyLight.position.set(100, 200, 150);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.setScalar(2048);
    this.keyLight.shadow.camera.near = 0.5;
    this.keyLight.shadow.camera.far = 800;
    this.keyLight.shadow.camera.left = -300;
    this.keyLight.shadow.camera.right = 300;
    this.keyLight.shadow.camera.top = 300;
    this.keyLight.shadow.camera.bottom = -300;
    this.scene.add(this.keyLight);

    this.fillLight = new THREE.DirectionalLight(0xaaccff, 0.8);
    this.fillLight.position.set(-100, 100, -100);
    this.scene.add(this.fillLight);

    this.hemiLight = new THREE.HemisphereLight(0xccddff, 0x554433, 0.6);
    this.scene.add(this.hemiLight);
  }

  private setupGround() {
    const grid = new THREE.GridHelper(500, 50, 0x555577, 0x333355);
    this.scene.add(grid);
  }

  private setupAxisHelper() {
    const axesHelper = new THREE.AxesHelper(100);
    this.scene.add(axesHelper);

    // Add XYZ labels using sprites
    const makeLabel = (text: string, color: number, pos: THREE.Vector3) => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 32, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const mat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(pos);
      sprite.scale.set(12, 12, 1);
      this.scene.add(sprite);
    };

    makeLabel('X', 0xff4444, new THREE.Vector3(110, 0, 0));
    makeLabel('Y', 0x44ff44, new THREE.Vector3(0, 110, 0));
    makeLabel('Z', 0x4488ff, new THREE.Vector3(0, 0, 110));
  }

  // --- Light control API ---
  setLightIntensity(light: 'ambient' | 'key' | 'fill' | 'hemi', intensity: number) {
    const map = { ambient: this.ambientLight, key: this.keyLight, fill: this.fillLight, hemi: this.hemiLight };
    map[light].intensity = intensity;
  }

  setLightColor(light: 'ambient' | 'key' | 'fill', color: string) {
    const map = { ambient: this.ambientLight, key: this.keyLight, fill: this.fillLight };
    map[light].color.set(color);
  }

  async loadFBX(url: string): Promise<void> {
    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(url);

    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      this.mixer?.stopAllAction();
      this.mixer = null;
    }

    this.currentModel = fbx;
    this.scene.add(fbx);

    fbx.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => this.upgradeMaterial(m));
        } else {
          mesh.material = this.upgradeMaterial(mesh.material);
        }
      }
    });

    this.animations = fbx.animations;
    if (this.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(fbx);
    }

    if (this.animations.length > 0) {
      const firstClip = this.animations[0];
      if (firstClip.tracks.length > 0) {
        const track = firstClip.tracks[0];
        const times = track.times;
        if (times.length > 1) {
          this.fps = Math.round(1 / (times[1] - times[0]));
          if (this.fps <= 0 || this.fps > 120) this.fps = 30;
        }
      }
    }

    this.fitCamera(fbx);
  }

  private upgradeMaterial(mat: THREE.Material): THREE.Material {
    if ((mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) return mat;
    const oldMat = mat as THREE.MeshPhongMaterial;
    const newMat = new THREE.MeshStandardMaterial({
      color: oldMat.color ?? 0xcccccc,
      map: oldMat.map ?? null,
      normalMap: oldMat.normalMap ?? null,
      roughness: 0.6,
      metalness: 0.1,
      side: THREE.DoubleSide,
      transparent: oldMat.transparent,
      opacity: oldMat.opacity,
    });
    if (oldMat.map) {
      oldMat.map.colorSpace = THREE.SRGBColorSpace;
    }
    return newMat;
  }

  async loadAnimation(url: string): Promise<void> {
    if (!this.currentModel) return;
    const loader = new FBXLoader();
    const anim = await loader.loadAsync(url);
    if (anim.animations.length > 0) {
      this.animations.push(...anim.animations);
      if (!this.mixer) {
        this.mixer = new THREE.AnimationMixer(this.currentModel);
      }
    }
  }

  loadTexture(url: string, mapType: 'map' | 'normalMap' | 'roughnessMap' | 'metalnessMap' | 'aoMap' | 'emissiveMap' = 'map') {
    if (!this.currentModel) return;
    const textureLoader = new THREE.TextureLoader();
    const texture = textureLoader.load(url);
    texture.colorSpace = mapType === 'map' || mapType === 'emissiveMap'
      ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    texture.flipY = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;

    this.currentModel.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if (stdMat.isMeshStandardMaterial) {
            (stdMat as any)[mapType] = texture;
            stdMat.needsUpdate = true;
          }
        });
      }
    });
  }

  getFPS(): number { return this.fps; }

  getAnimationNames(): string[] {
    return this.animations.map((clip) => clip.name);
  }

  getAnimationFrameCount(clipName: string): number {
    const clip = this.animations.find((c) => c.name === clipName);
    if (!clip) return 0;
    return Math.round(clip.duration * this.fps);
  }

  playAnimation(name: string, loop = true) {
    if (!this.mixer) return;
    if (this.currentAction) {
      this.currentAction.fadeOut(0.3);
    }
    const clip = this.animations.find((c) => c.name === name);
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.reset().fadeIn(0.3).play();
    this.currentAction = action;
    this.paused = false;
  }

  playSegment(clipName: string, startFrame: number, endFrame: number, loop = true) {
    if (!this.mixer) return;
    const clip = this.animations.find((c) => c.name === clipName);
    if (!clip) return;

    if (this.currentAction) {
      this.currentAction.fadeOut(0.2);
    }

    const subClip = THREE.AnimationUtils.subclip(
      clip, `${clipName}_${startFrame}_${endFrame}`, startFrame, endFrame, this.fps
    );

    const action = this.mixer.clipAction(subClip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.reset().fadeIn(0.2).play();
    this.currentAction = action;
    this.paused = false;
  }

  pauseAnimation() {
    if (this.currentAction) {
      this.currentAction.paused = true;
      this.paused = true;
    }
  }

  resumeAnimation() {
    if (this.currentAction) {
      this.currentAction.paused = false;
      this.paused = false;
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  stopAnimation() {
    if (this.currentAction) {
      this.currentAction.fadeOut(0.3);
      this.currentAction = null;
    }
    this.paused = false;
  }

  private fitCamera(object: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(center);
    this.camera.position.copy(center);
    this.camera.position.z += size * 1.5;
    this.camera.position.y += size * 0.5;
    this.camera.updateProjectionMatrix();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    this.mixer?.update(delta);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
