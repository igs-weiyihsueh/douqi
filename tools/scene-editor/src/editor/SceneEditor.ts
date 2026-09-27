import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface VFXEvent {
  frame: number;          // relative frame within segment
  presetId: string;       // VFX preset to trigger
  offset?: [number, number, number]; // position offset from object
  rotation?: [number, number, number]; // emission direction (euler degrees)
  scale?: number;         // size multiplier (default 1.0)
  followParent?: boolean; // if true, emitter follows the parent object (default: false = world space)
}

export interface CombatEvent {
  frame: number;        // hit-determination frame relative to segment start
  damage: number;       // damage dealt on hit
  range: number;        // attack reach distance (world units)
  angle: number;        // attack cone angle (degrees) — used for cone shape
  cooldown: number;     // minimum seconds before re-trigger
  shape?: 'cone' | 'circle' | 'rectangle'; // attack shape (default: cone)
  forwardOffset?: number; // move hit center forward by N units (default: 0)
  width?: number;       // rectangle width (only for rectangle shape)
  knockbackForce?: number;  // 擊退力度（方向自動計算：攻擊者→被擊者）
  knockbackUp?: number;     // 上升力度（0=純水平）
  knockback?: [number, number, number]; // legacy - deprecated
  showIndicator?: boolean;  // 顯示地面攻擊預警色塊
  label: string;        // display label on timeline marker
}

export interface AnimSegment {
  name: string;
  clipName: string;
  startFrame: number;
  endFrame: number;
  speed?: number;  // playback speed multiplier (default 1.0)
  vfxEvents?: VFXEvent[];
  combatEvents?: CombatEvent[];
}

export interface MaterialSlotInfo {
  index: number;
  name: string;
  meshName: string;
  hasMap: boolean;
  hasNormalMap: boolean;
  hasRoughnessMap: boolean;
  tiling: [number, number];
  offset: [number, number];
  color: string;       // hex color
  brightness: number;  // 0-2 multiplier
}

export type ColliderType = 'none' | 'box' | 'sphere' | 'capsule' | 'mesh';

export interface ColliderData {
  type: ColliderType;
  isTrigger: boolean;
  isStatic: boolean;
  sizeOverride?: [number, number, number];
  radiusOverride?: number;
  heightOverride?: number;
  offset?: [number, number, number]; // position offset from object center
  mass?: number;
  restitution?: number;
  friction?: number;
  knockbackForce?: number;
}

export interface SceneObjectData {
  id: string;
  name: string;
  modelPath: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  textures?: {
    [slotIndex: number]: {
      map?: string;
      normalMap?: string;
      roughnessMap?: string;
      tiling?: [number, number];
      offset?: [number, number];
      color?: string;
      brightness?: number;
    };
  };
  collider?: ColliderData;
  animations?: AnimSegment[];
  behavior?: {
    walkSegment?: string;
    idleSegment?: string;
    speed?: number;
    enableWalk?: boolean;
    enableIdle?: boolean;
    isPlayer?: boolean;
    // Combat
    hp?: number;
    attackDamage?: number;
    attackRange?: number;
    attackAngle?: number;
    attackCooldown?: number;
    attackSegment?: string;
    attackHitFrame?: number;
    hitSegment?: string;
    deathSegment?: string;
    isAggressive?: boolean;
    aggroRange?: number;
    // VFX
    hitVfx?: string;
    deathVfx?: string;
    attackVfx?: string;
    knockbackForce?: number;
    team?: number;
    canAttackTeams?: number[];
    // Multi-attack system
    attacks?: Array<{ id: string; key: string; segment: string; cooldown: number; hitFrame?: number; damage?: number; range?: number; angle?: number }>;
    attackStrategy?: 'random' | 'sequential' | 'distance';
    // Dash system
    dashEnabled?: boolean;
    dashKey?: string;
    dashDistance?: number;
    dashDuration?: number;
    dashCooldown?: number;
    dashSegment?: string;
    dashInvincible?: boolean;
    dashPhaseThrough?: boolean;
  };
  // 鬥氣割草 specific
  spinningTopTag?: 'none' | 'spawnPoint' | 'obstacle' | 'itemZone' | 'boundary';
  spawnConfig?: {
    zombieType: string;
    wave: number;
    count: number;
    interval: number;
    maxAlive: number;
  };
  itemZoneConfig?: {
    itemType: string;
    radius: number;
    respawnTime: number;
  };
}

export interface SceneData {
  name: string;
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunDirection: [number, number, number];
  objects: SceneObjectData[];
  camera?: {
    position: [number, number, number];
    rotation: [number, number, number];
    fov: number;
    near: number;
    far: number;
    aspect?: number;
    followTarget?: string; // object name to follow
    followOffset?: [number, number, number];
    lookOffset?: [number, number, number];
  };
}

export interface PrefabData {
  id: string;
  name: string;
  model: string;
  scale: [number, number, number];
  collider?: ColliderData;
  animations?: AnimSegment[];
  fps?: number;
  behavior?: {
    walkSegment?: string;
    idleSegment?: string;
    speed?: number;
    enableWalk?: boolean;
    enableIdle?: boolean;
    isPlayer?: boolean;
    // Combat
    hp?: number;
    attackDamage?: number;
    attackRange?: number;
    attackAngle?: number;
    attackCooldown?: number;
    attackSegment?: string;
    attackHitFrame?: number;
    hitSegment?: string;
    deathSegment?: string;
    isAggressive?: boolean;
    aggroRange?: number;
    // VFX
    hitVfx?: string;
    deathVfx?: string;
    attackVfx?: string;
    knockbackForce?: number;
    // Multi-attack system
    attacks?: Array<{ id: string; key: string; segment: string; cooldown: number; hitFrame?: number; damage?: number; range?: number; angle?: number }>;
    attackStrategy?: 'random' | 'sequential' | 'distance';
    // Dash system
    dashEnabled?: boolean;
    dashKey?: string;
    dashDistance?: number;
    dashDuration?: number;
    dashCooldown?: number;
    dashSegment?: string;
    dashInvincible?: boolean;
    dashPhaseThrough?: boolean;
  };
  textures?: {
    [slotIndex: number]: {
      map?: string;
      normalMap?: string;
      roughnessMap?: string;
      tiling?: [number, number];
      offset?: [number, number];
    };
  };
}

export interface GameSceneData {
  name: string;
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  sunDirection: [number, number, number];
  instances: Array<{
    prefab: string;
    name: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number, number];
  }>;
}

export class SceneEditor {
  private container: HTMLElement;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private orbitControls: OrbitControls;
  private transformControls: TransformControls;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();

  private objects: Map<string, THREE.Object3D> = new Map();
  private objectMeta: Map<string, SceneObjectData> = new Map();
  private selectedId: string | null = null;
  private idCounter = 0;

  // Animation mixers per object
  private mixers: Map<string, THREE.AnimationMixer> = new Map();
  private objectAnimations: Map<string, THREE.AnimationClip[]> = new Map();
  private currentActions: Map<string, THREE.AnimationAction> = new Map();
  private objectFPS: Map<string, number> = new Map();

  // Extra animation FBX blobs per modelPath (for bundle export)
  private extraAnimBlobs: Map<string, Array<{ name: string; blob: Blob }>> = new Map();

  // Selection box + flash animation
  private selectionBox: THREE.Object3D | null = null;
  private selectionFlash: THREE.LineSegments | null = null;
  private flashStartTime = 0;

  // Axis indicator (bottom-left corner)
  private axisScene!: THREE.Scene;
  private axisCamera!: THREE.PerspectiveCamera;

  // Undo/Redo
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private maxHistory = 50;
  private suppressHistory = false;

  // Asset library: cached FBX blobs for re-instantiation
  private assetLibrary: Map<string, { name: string; blob: Blob }> = new Map();

  // Geometry cache: parsed FBX models for clone-based instantiation
  private modelCache: Map<string, THREE.Group> = new Map();

  // Prefab registry: saved object templates with materials & collider
  private prefabRegistry: Map<string, PrefabData> = new Map();
  // Prefab texture cache: prefabId__slot__mapType -> dataUrl
  private prefabTextures: Map<string, string> = new Map();

  onPrefabChange: (() => void) | null = null;

  // Copy/Paste clipboard
  private clipboard: { assetId: string; meta: SceneObjectData; sourceId: string } | null = null;

  ambientLight!: THREE.AmbientLight;
  sunLight!: THREE.DirectionalLight;
  hemiLight!: THREE.HemisphereLight;

  onSelect: ((id: string | null) => void) | null = null;
  onTransformChange: ((id: string, data: SceneObjectData) => void) | null = null;
  onHistoryChange: (() => void) | null = null;
  onAssetLibraryChange: (() => void) | null = null;
  onUpdate: ((delta: number) => void) | null = null;
  onDeleteKey: (() => boolean) | null = null;  // return true if handled (e.g. marker delete)

  private inputLocked = false;
  private activeRenderCamera: THREE.PerspectiveCamera | null = null;

  /** Lock/unlock editor input (used during Play mode) */
  setInputLocked(locked: boolean) { this.inputLocked = locked; }

  /** Override the render camera (for Play mode using scene camera directly) */
  setRenderCamera(cam: THREE.PerspectiveCamera | null) { this.activeRenderCamera = cam; }

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x4a4a5e);

    this.camera = new THREE.PerspectiveCamera(
      60, container.clientWidth / container.clientHeight, 0.1, 10000
    );
    this.camera.position.set(0, 200, 400);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.target.set(0, 0, 0);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
    });
    this.transformControls.addEventListener('objectChange', () => {
      this.syncTransformToMeta();
    });
    // Push history when drag ends
    this.transformControls.addEventListener('mouseUp', () => {
      this.pushHistory();
    });
    this.scene.add(this.transformControls.getHelper());

    this.setupLights();
    this.setupGround();
    this.setupEvents();
    this.setupAxisIndicator();
    this.animate();
  }

  private setupLights() {
    this.ambientLight = new THREE.AmbientLight(0xffffff, 1.8);
    this.scene.add(this.ambientLight);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
    this.sunLight.position.set(100, 200, 150);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.setScalar(2048);
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 1500;
    const s = 500;
    this.sunLight.shadow.camera.left = -s;
    this.sunLight.shadow.camera.right = s;
    this.sunLight.shadow.camera.top = s;
    this.sunLight.shadow.camera.bottom = -s;
    this.scene.add(this.sunLight);

    // Fill light from opposite side
    const fillLight = new THREE.DirectionalLight(0xaaccff, 0.8);
    fillLight.position.set(-100, 100, -100);
    this.scene.add(fillLight);

    this.hemiLight = new THREE.HemisphereLight(0xccddff, 0x554433, 0.6);
    this.scene.add(this.hemiLight);
  }

  private setupGround() {
    const grid = new THREE.GridHelper(1000, 100, 0x8888aa, 0x666688);
    this.scene.add(grid);

    const axes = new THREE.AxesHelper(150);
    this.scene.add(axes);

    // XYZ axis labels
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
      sprite.scale.set(16, 16, 1);
      this.scene.add(sprite);
    };
    makeLabel('X', 0xff4444, new THREE.Vector3(165, 0, 0));
    makeLabel('Y', 0x44ff44, new THREE.Vector3(0, 165, 0));
    makeLabel('Z', 0x4488ff, new THREE.Vector3(0, 0, 165));
  }

  private setupEvents() {
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
  }

  private setupAxisIndicator() {
    // Create a small scene with XYZ axes that mirrors the main camera orientation
    this.axisScene = new THREE.Scene();
    this.axisCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.axisCamera.position.set(0, 0, 4);

    // Create colored axes using cylinders (LineBasicMaterial.linewidth doesn't work in WebGL)
    const axisLength = 0.8;
    const axisThickness = 0.03;
    const createAxis = (dir: THREE.Vector3, color: number, label: string) => {
      const mat = new THREE.MeshBasicMaterial({ color });

      // Cylinder shaft
      const cylGeo = new THREE.CylinderGeometry(axisThickness, axisThickness, axisLength, 8);
      const cyl = new THREE.Mesh(cylGeo, mat);
      // Position at midpoint along axis direction
      cyl.position.copy(dir.clone().multiplyScalar(axisLength / 2));
      // Rotate cylinder to align with axis direction
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      this.axisScene.add(cyl);

      // Cone tip
      const coneGeo = new THREE.ConeGeometry(0.07, 0.2, 12);
      const cone = new THREE.Mesh(coneGeo, mat);
      cone.position.copy(dir.clone().multiplyScalar(axisLength + 0.1));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      this.axisScene.add(cone);

      // Label sprite
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.font = 'bold 48px Arial';
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(dir.clone().multiplyScalar(axisLength + 0.35));
      sprite.scale.set(0.4, 0.4, 1);
      this.axisScene.add(sprite);
    };

    createAxis(new THREE.Vector3(1, 0, 0), 0xff4444, 'X');
    createAxis(new THREE.Vector3(0, 1, 0), 0x44ff44, 'Y');
    createAxis(new THREE.Vector3(0, 0, 1), 0x4488ff, 'Z');

    // Small center sphere
    const centerGeo = new THREE.SphereGeometry(0.05, 8, 8);
    const centerMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
    this.axisScene.add(new THREE.Mesh(centerGeo, centerMat));
  }

  private renderAxisIndicator() {
    const cam = this.activeRenderCamera ?? this.camera;
    // Mirror main camera rotation to axis camera
    this.axisCamera.quaternion.copy(cam.quaternion);
    this.axisCamera.position.set(0, 0, 4).applyQuaternion(cam.quaternion);
    this.axisCamera.lookAt(0, 0, 0);

    // Render in bottom-left corner with transparent background
    const size = 120;
    const renderer = this.renderer;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    const prevViewport = new THREE.Vector4();
    renderer.getViewport(prevViewport);
    const prevScissor = new THREE.Vector4();
    renderer.getScissor(prevScissor);
    const prevScissorTest = renderer.getScissorTest();

    renderer.setViewport(10, 10, size, size);
    renderer.setScissor(10, 10, size, size);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.axisScene, this.axisCamera);

    // Restore
    renderer.autoClear = prevAutoClear;
    renderer.setViewport(prevViewport);
    renderer.setScissor(prevScissor);
    renderer.setScissorTest(prevScissorTest);
  }

  private pointerDownPos: { x: number; y: number } | null = null;

  private onPointerDown = (e: PointerEvent) => {
    if (this.inputLocked) return;
    if (this.transformControls.dragging) return;
    // Record mouse position to detect click vs drag
    this.pointerDownPos = { x: e.clientX, y: e.clientY };
    // Register one-time pointerup for click detection
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp, { once: true });
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.pointerDownPos) return;
    // Only count as click if mouse barely moved (< 5px)
    const dx = e.clientX - this.pointerDownPos.x;
    const dy = e.clientY - this.pointerDownPos.y;
    this.pointerDownPos = null;
    if (dx * dx + dy * dy > 25) return; // Was a drag (orbit/pan), not a click

    if (this.inputLocked) return;
    if (this.transformControls.dragging) return;

    const rect = this.container.getBoundingClientRect();
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.objects.forEach((obj) => {
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) meshes.push(child);
      });
    });

    const intersects = this.raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      const hit = intersects[0].object;
      for (const [id, obj] of this.objects) {
        let found = false;
        obj.traverse((child) => { if (child === hit) found = true; });
        if (found) {
          this.select(id);
          return;
        }
      }
    } else {
      this.deselect();
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.inputLocked) return;
    // Ignore when typing in input fields
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    if (e.key === 'w') this.transformControls.setMode('translate');
    if (e.key === 'e') this.transformControls.setMode('rotate');
    if (e.key === 'r') {
      // Scale mode — will be blocked by VFXPositionGizmo if it's active
      this.transformControls.setMode('scale');
    }
    if (e.key === 'Delete' && this.selectedId) {
      // Check if a marker is selected (external handler takes priority)
      if (this.onDeleteKey && this.onDeleteKey()) return; // handled externally
      const meta = this.objectMeta.get(this.selectedId);
      const name = meta?.name || this.selectedId;
      if (confirm(`確定要刪除「${name}」嗎？`)) {
        this.removeObject(this.selectedId);
      }
    }
    if (e.key === 'Escape') this.deselect();

    // Undo/Redo
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); this.undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); this.redo(); }

    // Copy/Paste
    if (e.ctrlKey && e.key === 'c') { e.preventDefault(); this.copy(); }
    if (e.ctrlKey && e.key === 'v') { e.preventDefault(); this.paste(); }
  };

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.activeRenderCamera && this.activeRenderCamera !== this.camera) {
      this.activeRenderCamera.aspect = w / h;
      this.activeRenderCamera.updateProjectionMatrix();
    }
    this.renderer.setSize(w, h);
  };

  private syncTransformToMeta() {
    if (!this.selectedId) return;
    const obj = this.objects.get(this.selectedId);
    const meta = this.objectMeta.get(this.selectedId);
    if (!obj || !meta) return;

    meta.position = [obj.position.x, obj.position.y, obj.position.z];
    meta.rotation = [
      THREE.MathUtils.radToDeg(obj.rotation.x),
      THREE.MathUtils.radToDeg(obj.rotation.y),
      THREE.MathUtils.radToDeg(obj.rotation.z),
    ];
    meta.scale = [obj.scale.x, obj.scale.y, obj.scale.z];

    this.onTransformChange?.(this.selectedId, meta);
  }

  /** Sync all object transforms from 3D objects to meta (ensures export is accurate) */
  private syncAllTransforms() {
    for (const [id, obj] of this.objects) {
      const meta = this.objectMeta.get(id);
      if (!meta) continue;
      meta.position = [obj.position.x, obj.position.y, obj.position.z];
      meta.rotation = [
        THREE.MathUtils.radToDeg(obj.rotation.x),
        THREE.MathUtils.radToDeg(obj.rotation.y),
        THREE.MathUtils.radToDeg(obj.rotation.z),
      ];
      meta.scale = [obj.scale.x, obj.scale.y, obj.scale.z];
    }
  }

  // --- Public API ---

  select(id: string) {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.selectedId = id;
    this.transformControls.attach(obj);
    this.updateSelectionBox(obj);
    this.onSelect?.(id);
  }

  deselect() {
    this.selectedId = null;
    this.transformControls.detach();
    this.clearSelectionBox();
    this.onSelect?.(null);
  }

  private updateSelectionBox(obj: THREE.Object3D) {
    this.clearSelectionBox();
    // Compute bounding box from mesh geometry only (exclude helpers)
    const box = new THREE.Box3();
    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            const meshBox = mesh.geometry.boundingBox.clone();
            meshBox.applyMatrix4(mesh.matrixWorld);
            box.union(meshBox);
          }
        }
      }
    });
    if (box.isEmpty()) box.setFromObject(obj);

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const geo = new THREE.BoxGeometry(size.x + 4, size.y + 4, size.z + 4);
    const edges = new THREE.EdgesGeometry(geo);
    const mat = new THREE.LineDashedMaterial({ color: 0x00ffff, transparent: true, opacity: 0.9, dashSize: 8, gapSize: 4 });
    this.selectionBox = new THREE.LineSegments(edges, mat) as any;
    (this.selectionBox as any).computeLineDistances();
    this.selectionBox!.position.copy(center);
    this.selectionBox!.userData.__isOutline = true;
    this.scene.add(this.selectionBox!);

    // Flash effect
    const flashGeo = new THREE.BoxGeometry(size.x * 1.02, size.y * 1.02, size.z * 1.02);
    const flashEdges = new THREE.EdgesGeometry(flashGeo);
    const flashMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 });
    this.selectionFlash = new THREE.LineSegments(flashEdges, flashMat);
    this.selectionFlash.position.copy(center);
    this.selectionFlash.userData.__isOutline = true;
    this.scene.add(this.selectionFlash);
    this.flashStartTime = performance.now();
  }

  private clearSelectionBox() {
    if (this.selectionBox) {
      this.scene.remove(this.selectionBox);
      if ((this.selectionBox as any).geometry) (this.selectionBox as any).geometry.dispose();
      if ((this.selectionBox as any).material) (this.selectionBox as any).material.dispose();
      this.selectionBox = null;
    }
    if (this.selectionFlash) {
      this.scene.remove(this.selectionFlash);
      this.selectionFlash.geometry.dispose();
      (this.selectionFlash.material as THREE.LineBasicMaterial).dispose();
      this.selectionFlash = null;
    }
  }

  private updateFlash() {
    if (!this.selectionFlash) return;
    const elapsed = (performance.now() - this.flashStartTime) / 1000;
    const duration = 0.6; // seconds
    if (elapsed >= duration) {
      this.scene.remove(this.selectionFlash);
      this.selectionFlash.geometry.dispose();
      (this.selectionFlash.material as THREE.LineBasicMaterial).dispose();
      this.selectionFlash = null;
    } else {
      const t = elapsed / duration;
      const mat = this.selectionFlash.material as THREE.LineBasicMaterial;
      mat.opacity = 1.0 - t;
      // Lerp color from white to cyan
      mat.color.setRGB(1.0 - t * 1.0, 1.0 - t * 0.0, 1.0 - t * 0.0);
    }
  }

  getSelectedId(): string | null { return this.selectedId; }

  setTransformMode(mode: 'translate' | 'rotate' | 'scale') {
    this.transformControls.setMode(mode);
  }

  private upgradeMaterial(mat: THREE.Material): THREE.Material {
    if ((mat as any).isMeshToonMaterial) return mat;
    const oldMat = mat as any;

    // Create a 3-step toon gradient for cel-shading look
    const gradientMap = this.getToonGradientMap();

    const newMat = new THREE.MeshToonMaterial({
      color: oldMat.color ?? 0xcccccc,
      map: oldMat.map ?? null,
      gradientMap,
      side: THREE.DoubleSide,
      transparent: oldMat.transparent ?? false,
      opacity: oldMat.opacity ?? 1,
    });

    if (oldMat.map) {
      oldMat.map.colorSpace = THREE.SRGBColorSpace;
      this.ensurePowerOfTwo(oldMat.map);
      oldMat.map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      oldMat.map.generateMipmaps = true;
      oldMat.map.minFilter = THREE.LinearMipmapLinearFilter;
      oldMat.map.magFilter = THREE.LinearFilter;
      oldMat.map.needsUpdate = true;
    }
    return newMat;
  }

  private _toonGradientMap: THREE.DataTexture | null = null;
  /** Resize texture image to nearest power-of-two if needed (fixes mipmap generation issues) */
  private ensurePowerOfTwo(texture: THREE.Texture) {
    const img = texture.image as HTMLImageElement | HTMLCanvasElement | null;
    if (!img) return;
    const w = (img as any).width || (img as any).naturalWidth;
    const h = (img as any).height || (img as any).naturalHeight;
    if (!w || !h) return;

    const isPot = (v: number) => (v & (v - 1)) === 0 && v > 0;
    if (isPot(w) && isPot(h)) return; // already PoT

    // Resize to nearest PoT
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
    if (this._toonGradientMap) return this._toonGradientMap;
    // 3-step gradient: soft shadow → mid → full light (brighter for cartoon look)
    const colors = new Uint8Array([140, 200, 255]);
    const tex = new THREE.DataTexture(colors, colors.length, 1, THREE.RedFormat);
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    tex.needsUpdate = true;
    this._toonGradientMap = tex;
    return tex;
  }

  private prepareFBX(fbx: THREE.Group) {
    fbx.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Set anisotropy on all existing textures before material upgrade
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          const mat = m as any;
          for (const prop of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap']) {
            if (mat[prop]?.isTexture) {
              this.ensurePowerOfTwo(mat[prop]);
              mat[prop].anisotropy = this.renderer.capabilities.getMaxAnisotropy();
              mat[prop].generateMipmaps = true;
              mat[prop].minFilter = THREE.LinearMipmapLinearFilter;
              mat[prop].magFilter = THREE.LinearFilter;
              mat[prop].needsUpdate = true;
            }
          }
        }
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((m) => this.upgradeMaterial(m));
        } else {
          mesh.material = this.upgradeMaterial(mesh.material);
        }
      }
    });
  }

  // Load or clone from model cache
  private async getOrLoadModel(assetId: string): Promise<THREE.Group> {
    const cacheKey = assetId;
    if (this.modelCache.has(cacheKey)) {
      // Clone from cache (shares geometry buffers, independent skeleton)
      const source = this.modelCache.get(cacheKey)!;
      const clone = SkeletonUtils.clone(source) as THREE.Group;
      // Copy animations reference
      clone.animations = source.animations;
      return clone;
    }

    // First load ??parse FBX and cache the original
    const asset = this.assetLibrary.get(assetId);
    if (!asset) throw new Error(`Asset ${assetId} not found`);
    const url = URL.createObjectURL(asset.blob);
    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(url);
    URL.revokeObjectURL(url);
    this.prepareFBX(fbx);

    // Store in cache
    this.modelCache.set(cacheKey, fbx);

    // Return a clone (keep cache source untouched)
    const clone = SkeletonUtils.clone(fbx) as THREE.Group;
    clone.animations = fbx.animations;
    return clone;
  }

  private setupAnimations(id: string, fbx: THREE.Group) {
    if (fbx.animations && fbx.animations.length > 0) {
      const mixer = new THREE.AnimationMixer(fbx);
      this.mixers.set(id, mixer);
      this.objectAnimations.set(id, [...fbx.animations]);

      // Detect FPS from first clip
      const firstClip = fbx.animations[0];
      if (firstClip.tracks.length > 0) {
        const times = firstClip.tracks[0].times;
        if (times.length > 1) {
          let fps = Math.round(1 / (times[1] - times[0]));
          if (fps <= 0 || fps > 120) fps = 30;
          this.objectFPS.set(id, fps);
        }
      }
      if (!this.objectFPS.has(id)) this.objectFPS.set(id, 30);
    }
  }

  // --- Animation API ---

  getAnimationClips(id: string): string[] {
    return (this.objectAnimations.get(id) || []).map((c) => c.name || '(unnamed)');
  }

  getAnimationFrameCount(id: string, clipName: string): number {
    const clips = this.objectAnimations.get(id) || [];
    const fps = this.objectFPS.get(id) || 30;
    const clip = clips.find((c) => c.name === clipName);
    return clip ? Math.round(clip.duration * fps) : 0;
  }

  getObjectFPS(id: string): number {
    return this.objectFPS.get(id) || 30;
  }

  getMixer(id: string): THREE.AnimationMixer | undefined {
    return this.mixers.get(id);
  }

  getObjectAnimationClips(id: string): THREE.AnimationClip[] | undefined {
    return this.objectAnimations.get(id);
  }

  playAnimation(id: string, clipName: string, loop = true) {
    const mixer = this.mixers.get(id);
    const clips = this.objectAnimations.get(id);
    if (!mixer || !clips) return;

    // Stop current
    const current = this.currentActions.get(id);
    if (current) current.fadeOut(0.3);

    const clip = clips.find((c) => c.name === clipName);
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.reset().fadeIn(0.3).play();
    this.currentActions.set(id, action);
  }

  playSegment(id: string, clipName: string, startFrame: number, endFrame: number, loop = true) {
    const mixer = this.mixers.get(id);
    const clips = this.objectAnimations.get(id);
    const fps = this.objectFPS.get(id) || 30;
    if (!mixer || !clips) return;

    const current = this.currentActions.get(id);
    if (current) current.fadeOut(0.2);

    const clip = clips.find((c) => c.name === clipName);
    if (!clip) return;

    const subClip = THREE.AnimationUtils.subclip(clip, `${clipName}_${startFrame}_${endFrame}`, startFrame, endFrame, fps);
    const action = mixer.clipAction(subClip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
    action.reset().fadeIn(0.2).play();
    this.currentActions.set(id, action);
  }

  stopAnimation(id: string) {
    const current = this.currentActions.get(id);
    if (current) { current.fadeOut(0.3); this.currentActions.delete(id); }
  }

  /** Stop all editor preview animations and reset mixers */
  stopAllAnimations() {
    for (const [id, action] of this.currentActions) {
      action.stop();
    }
    this.currentActions.clear();
    for (const [, mixer] of this.mixers) {
      mixer.stopAllAction();
    }
  }

  pauseAnimation(id: string) {
    const current = this.currentActions.get(id);
    if (current) current.paused = true;
  }

  resumeAnimation(id: string) {
    const current = this.currentActions.get(id);
    if (current) current.paused = false;
  }

  async loadExtraAnimation(id: string, file: File): Promise<void> {
    const obj = this.objects.get(id);
    if (!obj) return;
    const meta = this.objectMeta.get(id);
    const url = URL.createObjectURL(file);
    const loader = new FBXLoader();
    const anim = await loader.loadAsync(url);
    URL.revokeObjectURL(url);

    if (anim.animations.length > 0) {
      let clips = this.objectAnimations.get(id);
      if (!clips) { clips = []; this.objectAnimations.set(id, clips); }

      // Rename clips to avoid duplicates
      const existingNames = new Set(clips.map((c) => c.name));
      const baseName = file.name.replace(/\.fbx$/i, '');
      for (const clip of anim.animations) {
        let name = clip.name || baseName;
        if (existingNames.has(name)) {
          let i = 2;
          while (existingNames.has(`${name}_${i}`)) i++;
          name = `${name}_${i}`;
        }
        clip.name = name;
        existingNames.add(name);
      }

      clips.push(...anim.animations);
      if (!this.mixers.has(id)) {
        this.mixers.set(id, new THREE.AnimationMixer(obj));
      }

      // Store blob for bundle export (keyed by modelPath)
      if (meta) {
        let blobs = this.extraAnimBlobs.get(meta.modelPath);
        if (!blobs) { blobs = []; this.extraAnimBlobs.set(meta.modelPath, blobs); }
        blobs.push({ name: file.name, blob: new File([file], file.name, { type: file.type }) });
      }
    }
  }

  getObjectSegments(id: string): AnimSegment[] {
    return this.objectMeta.get(id)?.animations || [];
  }

  addSegment(id: string, seg: AnimSegment) {
    const meta = this.objectMeta.get(id);
    if (!meta) return;
    if (!meta.animations) meta.animations = [];
    meta.animations.push(seg);
  }

  removeSegment(id: string, index: number) {
    const meta = this.objectMeta.get(id);
    if (!meta?.animations) return;
    meta.animations.splice(index, 1);
  }

  hasAnimations(id: string): boolean {
    return (this.objectAnimations.get(id)?.length || 0) > 0;
  }

  async addFBXFromFile(file: File, name?: string): Promise<string> {
    // Add to asset library for re-spawning (clone the file blob)
    this.addToAssetLibrary(new File([file], file.name, { type: file.type }));

    const url = URL.createObjectURL(file);
    const id = this.generateId();
    const loader = new FBXLoader();
    let fbx: THREE.Group;
    try {
      fbx = await loader.loadAsync(url);
    } catch (err) {
      URL.revokeObjectURL(url);
      throw err;
    }
    URL.revokeObjectURL(url);

    this.prepareFBX(fbx);
    this.setupAnimations(id, fbx);

    this.scene.add(fbx);
    this.objects.set(id, fbx);

    const meta: SceneObjectData = {
      id,
      name: name || file.name.replace('.fbx', ''),
      modelPath: file.name,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    this.objectMeta.set(id, meta);
    this.select(id);
    this.pushHistory();
    return id;
  }

  async addFBXFromUrl(url: string, name: string, modelPath: string): Promise<string> {
    const id = this.generateId();
    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(url);

    this.prepareFBX(fbx);
    this.setupAnimations(id, fbx);

    this.scene.add(fbx);
    this.objects.set(id, fbx);

    const meta: SceneObjectData = {
      id,
      name,
      modelPath,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    this.objectMeta.set(id, meta);
    return id;
  }

  removeObject(id: string) {
    // If it's the camera object, use dedicated removal
    if (id === this.cameraObjectId) {
      this.removeCameraObject();
      return;
    }
    const obj = this.objects.get(id);
    if (!obj) return;
    if (this.selectedId === id) this.deselect();
    this.scene.remove(obj);
    this.objects.delete(id);
    this.objectMeta.delete(id);
    this.pushHistory();
  }

  setObjectTransform(id: string, pos?: [number, number, number], rot?: [number, number, number], scl?: [number, number, number]) {
    const obj = this.objects.get(id);
    const meta = this.objectMeta.get(id);
    if (!obj || !meta) return;

    if (pos) {
      obj.position.set(...pos);
      meta.position = pos;
    }
    if (rot) {
      obj.rotation.set(
        THREE.MathUtils.degToRad(rot[0]),
        THREE.MathUtils.degToRad(rot[1]),
        THREE.MathUtils.degToRad(rot[2])
      );
      meta.rotation = rot;
    }
    if (scl) {
      obj.scale.set(...scl);
      meta.scale = scl;
    }
  }

  applyTexture(id: string, file: File, mapType: 'map' | 'normalMap' | 'roughnessMap', slotIndex?: number) {
    const obj = this.objects.get(id);
    if (!obj) return;
    const url = URL.createObjectURL(file);
    const texture = new THREE.TextureLoader().load(url, () => {
      URL.revokeObjectURL(url);
    });
    texture.colorSpace = mapType === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    texture.flipY = true;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    if (slotIndex !== undefined) {
      // Apply to specific material slot
      const slots = this.collectMaterialSlots(obj);
      const materials = this.collectMaterials(obj);
      if (slotIndex >= 0 && slotIndex < materials.length) {
        const mat = materials[slotIndex] as any;
        if (mapType === 'map' || mat[mapType] !== undefined) {
          mat[mapType] = texture;
          mat.needsUpdate = true;
        }
      }
    } else {
      // Apply to all materials
      obj.traverse((child: THREE.Object3D) => {
        if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
          const mesh = child as THREE.Mesh;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          mats.forEach((mat) => {
            const m = mat as any;
            if (mapType === 'map' || m[mapType] !== undefined) {
              m[mapType] = texture;
              m.needsUpdate = true;
            }
          });
        }
      });
    }

    const meta = this.objectMeta.get(id);
    if (meta) {
      if (!meta.textures) meta.textures = {};
      const idx = slotIndex ?? 0;
      if (!meta.textures[idx]) meta.textures[idx] = {};
      meta.textures[idx]![mapType] = file.name;
    }
  }

  setTiling(id: string, slotIndex: number, tiling: [number, number], offset: [number, number]) {
    const obj = this.objects.get(id);
    if (!obj) return;
    const materials = this.collectMaterials(obj);
    if (slotIndex < 0 || slotIndex >= materials.length) return;

    const stdMat = materials[slotIndex] as THREE.MeshStandardMaterial;
    if (!stdMat.isMeshStandardMaterial && !(stdMat as any).isMeshToonMaterial) return;

    const textures = [stdMat.map, stdMat.normalMap, stdMat.roughnessMap, stdMat.aoMap, stdMat.emissiveMap];
    textures.forEach((tex) => {
      if (tex) {
        tex.repeat.set(tiling[0], tiling[1]);
        tex.offset.set(offset[0], offset[1]);
        tex.needsUpdate = true;
      }
    });
    stdMat.needsUpdate = true;

    // Save to meta
    const meta = this.objectMeta.get(id);
    if (meta) {
      if (!meta.textures) meta.textures = {};
      if (!meta.textures[slotIndex]) meta.textures[slotIndex] = {};
      meta.textures[slotIndex]!.tiling = tiling;
      meta.textures[slotIndex]!.offset = offset;
    }
  }

  getMaterialSlots(id: string): MaterialSlotInfo[] {
    const obj = this.objects.get(id);
    if (!obj) return [];
    return this.collectMaterialSlots(obj);
  }

  setMaterialColor(id: string, slotIndex: number, color: string) {
    const obj = this.objects.get(id);
    if (!obj) return;
    const materials = this.collectMaterials(obj);
    if (slotIndex < 0 || slotIndex >= materials.length) return;
    const mat = materials[slotIndex] as any;
    if (mat.color) {
      mat.color.set(color);
      mat.needsUpdate = true;
    }
    // Save to meta
    const meta = this.objectMeta.get(id);
    if (meta) {
      if (!meta.textures) meta.textures = {};
      if (!meta.textures[slotIndex]) meta.textures[slotIndex] = {};
      meta.textures[slotIndex]!.color = color;
    }
  }

  setMaterialBrightness(id: string, slotIndex: number, brightness: number) {
    const obj = this.objects.get(id);
    if (!obj) return;
    const materials = this.collectMaterials(obj);
    if (slotIndex < 0 || slotIndex >= materials.length) return;
    const mat = materials[slotIndex] as any;
    mat.userData = mat.userData || {};
    mat.userData.__brightness = brightness;
    // Apply brightness via emissive on ToonMaterial
    if (mat.emissive) {
      const baseColor = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
      const emissiveStrength = Math.max(0, brightness - 1.0);
      mat.emissive.copy(baseColor).multiplyScalar(emissiveStrength);
      mat.needsUpdate = true;
    }
    // Save to meta
    const meta = this.objectMeta.get(id);
    if (meta) {
      if (!meta.textures) meta.textures = {};
      if (!meta.textures[slotIndex]) meta.textures[slotIndex] = {};
      meta.textures[slotIndex]!.brightness = brightness;
    }
  }

  // --- Collider ---

  private colliderHelpers: Map<string, THREE.Object3D> = new Map();
  private colliderVisible = true;

  setColliderVisibility(visible: boolean) {
    this.colliderVisible = visible;
    this.colliderHelpers.forEach((helper) => { helper.visible = visible; });
  }

  isColliderVisible(): boolean { return this.colliderVisible; }

  // Hide/show all editor helpers (grid, axes, colliders, selection box)
  setEditorHelpersVisible(visible: boolean) {
    this.scene.traverse((child) => {
      if (child instanceof THREE.GridHelper ||
          child instanceof THREE.AxesHelper ||
          (child as THREE.Sprite).isSprite ||
          (child.userData as any).__isColliderHelper ||
          (child.userData as any).__isOutline ||
          (child.userData as any).__isCameraObject) {
        child.visible = visible;
      }
    });
    if (!visible) {
      // Hide: detach, hide everything, clear selection
      this.transformControls.detach();
      this.transformControls.getHelper().visible = false;
      this.transformControls.enabled = false;
      this.clearSelectionBox();
      this.selectedId = null;
    } else {
      // Restore: re-enable transform controls, reset visibility to default state
      this.transformControls.getHelper().visible = true;
      this.transformControls.enabled = true;
      // Nothing is selected yet so gizmo won't render until user selects
    }
  }

  /** Show/hide only debug helpers (colliders, attack range) without editor controls (for play mode) */
  setDebugHelpersVisible(visible: boolean) {
    this.scene.traverse((child) => {
      if ((child.userData as any).__isColliderHelper) {
        child.visible = visible;
      }
    });
  }

  setCollider(id: string, collider: ColliderData) {
    const meta = this.objectMeta.get(id);
    if (!meta) return;
    meta.collider = collider;
    this.updateColliderHelper(id);
  }

  getCollider(id: string): ColliderData | undefined {
    return this.objectMeta.get(id)?.collider;
  }

  getObjectBounds(id: string): THREE.Vector3 {
    const obj = this.objects.get(id);
    if (!obj) return new THREE.Vector3(1, 1, 1);

    // Calculate bounds in LOCAL space (without the object's own transform)
    // This gives the "model size" which will be scaled by the object's scale at runtime
    const box = new THREE.Box3();
    const inverseWorldMatrix = obj.matrixWorld.clone().invert();

    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            const meshBox = mesh.geometry.boundingBox.clone();
            // Transform mesh bounds to the object's LOCAL space (removes object's world transform)
            const localMatrix = inverseWorldMatrix.clone().multiply(mesh.matrixWorld);
            meshBox.applyMatrix4(localMatrix);
            box.union(meshBox);
          }
        }
      }
    });

    if (box.isEmpty()) {
      // Fallback: use object's bounding box but remove scale
      box.setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const s = obj.scale;
      size.x /= Math.abs(s.x) || 1;
      size.y /= Math.abs(s.y) || 1;
      size.z /= Math.abs(s.z) || 1;
      return size;
    }

    return box.getSize(new THREE.Vector3());
  }

  getObjectBoundsBox(id: string): THREE.Box3 {
    const obj = this.objects.get(id);
    const box = new THREE.Box3();
    if (!obj) return box;

    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.computeBoundingBox();
          if (mesh.geometry.boundingBox) {
            const meshBox = mesh.geometry.boundingBox.clone();
            meshBox.applyMatrix4(mesh.matrixWorld);
            box.union(meshBox);
          }
        }
      }
    });

    if (box.isEmpty()) box.setFromObject(obj);
    return box;
  }

  private updateColliderHelper(id: string) {
    // Remove old helper
    const old = this.colliderHelpers.get(id);
    if (old) { old.parent?.remove(old); this.colliderHelpers.delete(id); }

    const obj = this.objects.get(id);
    const meta = this.objectMeta.get(id);
    if (!obj || !meta?.collider || meta.collider.type === 'none') return;

    const bounds = this.getObjectBounds(id);
    const box = this.getObjectBoundsBox(id);
    const center = box.getCenter(new THREE.Vector3());
    const objPos = obj.position.clone();
    const worldOffset = center.sub(objPos);
    // Convert world offset to local space (divide by object scale)
    const s = obj.scale;
    const localOffset = new THREE.Vector3(
      s.x !== 0 ? worldOffset.x / s.x : 0,
      s.y !== 0 ? worldOffset.y / s.y : 0,
      s.z !== 0 ? worldOffset.z / s.z : 0
    );

    let helper: THREE.Object3D;
    const color = meta.collider.isTrigger ? 0xffff00 : 0x00ff00;
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 });

    switch (meta.collider.type) {
      case 'box': {
        const size = meta.collider.sizeOverride
          ? new THREE.Vector3(...meta.collider.sizeOverride).multiplyScalar(2)
          : bounds;
        const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
        const edges = new THREE.EdgesGeometry(geo);
        helper = new THREE.LineSegments(edges, lineMat);
        break;
      }
      case 'sphere': {
        const radius = meta.collider.radiusOverride ?? Math.max(bounds.x, bounds.y, bounds.z) / 2;
        // Use multiple circle rings to visualize sphere
        const group = new THREE.Group();
        const segments = 48;
        for (const axis of ['xy', 'xz', 'yz'] as const) {
          const points: THREE.Vector3[] = [];
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;
            if (axis === 'xy') points.push(new THREE.Vector3(x, y, 0));
            else if (axis === 'xz') points.push(new THREE.Vector3(x, 0, y));
            else points.push(new THREE.Vector3(0, x, y));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          group.add(new THREE.Line(geo, lineMat));
        }
        helper = group;
        break;
      }
      case 'capsule': {
        const radius = meta.collider.radiusOverride ?? Math.max(bounds.x, bounds.z) / 2;
        const height = meta.collider.heightOverride ?? bounds.y;
        const halfH = Math.max(0, (height - radius * 2) / 2);
        const group = new THREE.Group();
        const segments = 48;
        // Top/bottom circles
        for (const yOff of [halfH, -halfH]) {
          const points: THREE.Vector3[] = [];
          for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            points.push(new THREE.Vector3(Math.cos(angle) * radius, yOff, Math.sin(angle) * radius));
          }
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          group.add(new THREE.Line(geo, lineMat));
        }
        // Vertical lines
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const x = Math.cos(angle) * radius;
          const z = Math.sin(angle) * radius;
          const points = [new THREE.Vector3(x, -halfH, z), new THREE.Vector3(x, halfH, z)];
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          group.add(new THREE.Line(geo, lineMat));
        }
        // Top/bottom hemisphere arcs
        for (const [sign, yBase] of [[1, halfH], [-1, -halfH]] as [number, number][]) {
          for (const axis of ['xz', 'yz'] as const) {
            const points: THREE.Vector3[] = [];
            for (let i = 0; i <= segments / 2; i++) {
              const angle = (i / (segments / 2)) * Math.PI * sign;
              const r = Math.cos(angle) * radius;
              const h = Math.sin(angle) * radius * sign + yBase;
              if (axis === 'xz') points.push(new THREE.Vector3(r, h, 0));
              else points.push(new THREE.Vector3(0, h, r));
            }
            const geo = new THREE.BufferGeometry().setFromPoints(points);
            group.add(new THREE.Line(geo, lineMat));
          }
        }
        helper = group;
        break;
      }
      case 'mesh': {
        const edges = new THREE.Group();
        obj.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
            const edgeGeo = new THREE.EdgesGeometry((child as THREE.Mesh).geometry);
            const line = new THREE.LineSegments(edgeGeo, lineMat.clone());
            line.position.copy(child.position);
            line.rotation.copy(child.rotation);
            line.scale.copy(child.scale);
            edges.add(line);
          }
        });
        helper = edges;
        helper.position.set(0, 0, 0);
        helper.userData.__isColliderHelper = true;
        helper.visible = this.colliderVisible;
        helper.renderOrder = 999;
        (helper as any).raycast = () => {};
        obj.add(helper);
        this.colliderHelpers.set(id, helper);
        return;
      }
      default:
        return;
    }

    // Apply offset
    const offset = meta.collider.offset || [0, 0, 0];
    helper.position.set(
      localOffset.x + offset[0],
      localOffset.y + offset[1],
      localOffset.z + offset[2]
    );
    helper.userData.__isColliderHelper = true;
    helper.visible = this.colliderVisible;
    helper.renderOrder = 999;
    (helper as any).raycast = () => {};
    obj.add(helper);
    this.colliderHelpers.set(id, helper);
  }

  refreshColliderHelpers() {
    for (const id of this.objects.keys()) {
      this.updateColliderHelper(id);
    }
  }

  // --- Attack Range Helper ---
  private attackRangeHelpers: Map<string, THREE.Object3D> = new Map();
  private attackRangeVisible = true;

  setAttackRangeVisibility(visible: boolean) {
    this.attackRangeVisible = visible;
    this.attackRangeHelpers.forEach((helper) => { helper.visible = visible; });
  }

  /** Remove all attack range helpers from scene entirely */
  clearAllAttackRangeHelpers() {
    for (const [id, helper] of this.attackRangeHelpers) {
      helper.parent?.remove(helper);
      helper.traverse((c: any) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
    }
    this.attackRangeHelpers.clear();
  }

  isAttackRangeVisible(): boolean { return this.attackRangeVisible; }

  updateAttackRangeHelper(id: string, shape?: 'cone' | 'circle' | 'rectangle', forwardOffset?: number, width?: number) {
    // Remove old
    const old = this.attackRangeHelpers.get(id);
    if (old) { old.parent?.remove(old); this.attackRangeHelpers.delete(id); }

    // Only show when explicitly called with valid parameters from combat marker selection
    if (!shape) return;

    const obj = this.objects.get(id);
    const meta = this.objectMeta.get(id);
    if (!obj || !meta?.behavior) return;

    const range = meta.behavior.attackRange;
    if (!range || range <= 0) return;

    const angleDeg = meta.behavior.attackAngle ?? 120;
    const actualShape = shape || 'cone';
    const offset = forwardOffset || 0;

    let helper: THREE.Group;
    if (actualShape === 'circle') {
      helper = this.createAttackCircleHelper(range, offset);
    } else if (actualShape === 'rectangle') {
      helper = this.createAttackRectHelper(range, width || 60, offset);
    } else {
      helper = this.createAttackConeHelper(range, angleDeg, offset);
    }

    helper.userData.__isColliderHelper = true;
    helper.visible = this.attackRangeVisible;
    helper.renderOrder = 998;
    (helper as any).raycast = () => {};

    // Counter-scale: helper is in world units but attached to a scaled parent
    const s = obj.scale;
    helper.scale.set(
      s.x !== 0 ? 1 / s.x : 1,
      s.y !== 0 ? 1 / s.y : 1,
      s.z !== 0 ? 1 / s.z : 1,
    );

    obj.add(helper);
    this.attackRangeHelpers.set(id, helper);
  }

  private createAttackConeHelper(range: number, angleDeg: number, offset = 0): THREE.Group {
    const group = new THREE.Group();
    const color = 0xff4444;
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });

    const halfAngle = THREE.MathUtils.degToRad(angleDeg / 2);
    const segments = 24;
    const y = 1;

    // Origin point (with forward offset)
    const originZ = offset;

    // Arc
    const arcPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const angle = -halfAngle + t * (halfAngle * 2);
      const x = Math.sin(angle) * range;
      const z = originZ + Math.cos(angle) * range;
      arcPoints.push(new THREE.Vector3(x, y, z));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    group.add(new THREE.Line(arcGeo, lineMat));

    // Side lines
    const leftAngle = -halfAngle;
    const rightAngle = halfAngle;
    const leftLine = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, y, originZ),
      new THREE.Vector3(Math.sin(leftAngle) * range, y, originZ + Math.cos(leftAngle) * range),
    ]);
    const rightLine = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, y, originZ),
      new THREE.Vector3(Math.sin(rightAngle) * range, y, originZ + Math.cos(rightAngle) * range),
    ]);
    group.add(new THREE.Line(leftLine, lineMat));
    group.add(new THREE.Line(rightLine, lineMat));

    return group;
  }

  private createAttackCircleHelper(radius: number, offset = 0): THREE.Group {
    const group = new THREE.Group();
    const color = 0xff4444;
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const segments = 32;
    const y = 1;

    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        offset + Math.sin(angle) * radius
      ));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(geo, lineMat));

    // Offset indicator line (from origin to circle center)
    if (offset > 0) {
      const indicatorGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, y, 0),
        new THREE.Vector3(0, y, offset),
      ]);
      const dashMat = new THREE.LineDashedMaterial({ color, dashSize: 5, gapSize: 5, transparent: true, opacity: 0.4 });
      const line = new THREE.Line(indicatorGeo, dashMat);
      line.computeLineDistances();
      group.add(line);
    }

    return group;
  }

  private createAttackRectHelper(length: number, width: number, offset = 0): THREE.Group {
    const group = new THREE.Group();
    const color = 0xff4444;
    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const y = 1;
    const halfW = width / 2;

    // Rectangle: from offset to offset+length, width centered
    const points: THREE.Vector3[] = [
      new THREE.Vector3(-halfW, y, offset),
      new THREE.Vector3(halfW, y, offset),
      new THREE.Vector3(halfW, y, offset + length),
      new THREE.Vector3(-halfW, y, offset + length),
      new THREE.Vector3(-halfW, y, offset), // close
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    group.add(new THREE.Line(geo, lineMat));

    // Center line
    if (offset > 0) {
      const indicatorGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, y, 0),
        new THREE.Vector3(0, y, offset),
      ]);
      const dashMat = new THREE.LineDashedMaterial({ color, dashSize: 5, gapSize: 5, transparent: true, opacity: 0.4 });
      const line = new THREE.Line(indicatorGeo, dashMat);
      line.computeLineDistances();
      group.add(line);
    }

    return group;
  }

  refreshAttackRangeHelpers() {
    for (const id of this.objects.keys()) {
      this.updateAttackRangeHelper(id);
    }
  }

  private collectMaterialSlots(obj: THREE.Object3D): MaterialSlotInfo[] {
    const slots: MaterialSlotInfo[] = [];
    let index = 0;
    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
        const mesh = child as THREE.Mesh;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mat) => {
          const m = mat as any;
          const refTex = m.map || m.normalMap || m.roughnessMap;
          const color = m.color ? '#' + m.color.getHexString() : '#ffffff';
          const brightness = m.userData?.__brightness ?? 1.0;
          slots.push({
            index: index++,
            name: mat.name || `material_${index}`,
            meshName: mesh.name || '(unnamed mesh)',
            hasMap: !!m.map,
            hasNormalMap: !!m.normalMap,
            hasRoughnessMap: !!m.roughnessMap,
            tiling: refTex ? [refTex.repeat.x, refTex.repeat.y] : [1, 1],
            offset: refTex ? [refTex.offset.x, refTex.offset.y] : [0, 0],
            color,
            brightness,
          });
        });
      }
    });
    return slots;
  }

  private collectMaterials(obj: THREE.Object3D): THREE.Material[] {
    const mats: THREE.Material[] = [];
    obj.traverse((child: THREE.Object3D) => {
      if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
        const mesh = child as THREE.Mesh;
        if (Array.isArray(mesh.material)) {
          mats.push(...mesh.material);
        } else {
          mats.push(mesh.material);
        }
      }
    });
    return mats;
  }

  setAmbient(intensity: number, color?: string) {
    this.ambientLight.intensity = intensity;
    if (color) this.ambientLight.color.set(color);
  }

  setSun(intensity: number, color?: string, direction?: [number, number, number]) {
    this.sunLight.intensity = intensity;
    if (color) this.sunLight.color.set(color);
    if (direction) this.sunLight.position.set(...direction);
  }

  getAllMeta(): SceneObjectData[] {
    return Array.from(this.objectMeta.values());
  }

  findObjectByPrefabId(prefabId: string): string | null {
    const prefab = this.prefabRegistry.get(prefabId);
    if (!prefab) return null;
    for (const [id, meta] of this.objectMeta) {
      if (meta.modelPath === prefab.model || meta.name === prefab.name) {
        return id;
      }
    }
    return null;
  }

  findPrefabIdByModel(modelPath: string): string | null {
    const fileName = modelPath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';
    const nameNoExt = fileName.replace(/\.fbx$/i, '');
    for (const [pfId, prefab] of this.prefabRegistry) {
      const pfModel = prefab.model.toLowerCase();
      const pfName = pfModel.replace(/\.fbx$/i, '');
      if (pfModel === fileName || pfName === nameNoExt || prefab.model === modelPath) {
        return pfId;
      }
    }
    return null;
  }

  getMeta(id: string): SceneObjectData | undefined {
    return this.objectMeta.get(id);
  }

  // Expose internals for PlayMode
  getScene(): THREE.Scene { return this.scene; }
  getCamera(): THREE.PerspectiveCamera { return this.camera; }
  getRenderer(): THREE.WebGLRenderer { return this.renderer; }
  getObjects(): Map<string, THREE.Object3D> { return this.objects; }
  getObjectMetaMap(): Map<string, SceneObjectData> { return this.objectMeta; }
  getObjectAnimationsMap(): Map<string, THREE.AnimationClip[]> { return this.objectAnimations; }
  getObjectFPSMap(): Map<string, number> { return this.objectFPS; }
  getOrbitControls() { return this.orbitControls; }
  getTransformControls() { return this.transformControls; }

  // --- Scene Save/Load ---

  newScene() {
    this.suppressHistory = true;
    // Remove camera object
    if (this.cameraObjectId) {
      if (this.cameraHelper) { this.scene.remove(this.cameraHelper); this.cameraHelper = null; }
      this.sceneCameraObj = null;
      this.cameraObjectId = null;
      this.disposeCameraObjectPreview();
    }
    for (const id of Array.from(this.objects.keys())) {
      const obj = this.objects.get(id)!;
      if (this.selectedId === id) this.deselect();
      this.scene.remove(obj);
      this.objects.delete(id);
      this.objectMeta.delete(id);
    }
    // Reset lighting to defaults
    this.setAmbient(1.5, '#ffffff');
    this.setSun(2.0, '#ffffff', [100, 300, 150]);
    // Clear history
    this.undoStack = [];
    this.redoStack = [];
    this.suppressHistory = false;
    this.onHistoryChange?.();
    this.onSelect?.(null);
    if (this.onCameraObjectChange) this.onCameraObjectChange();
  }

  exportScene(sceneName: string): SceneData {
    // Sync all object transforms from 3D to meta before export
    this.syncAllTransforms();

    const objects = this.getAllMeta().filter(m => m.modelPath !== '__camera__');
    const data: SceneData = {
      name: sceneName,
      ambientColor: '#' + this.ambientLight.color.getHexString(),
      ambientIntensity: this.ambientLight.intensity,
      sunColor: '#' + this.sunLight.color.getHexString(),
      sunIntensity: this.sunLight.intensity,
      sunDirection: [this.sunLight.position.x, this.sunLight.position.y, this.sunLight.position.z],
      objects,
    };
    const camExport = this.getCameraExportData();
    if (camExport) data.camera = camExport;
    return data;
  }

  // --- Scene Bundle (self-contained save/load) ---

  async exportBundle(sceneName: string): Promise<Blob> {
    const sceneData = this.exportScene(sceneName);

    // Collect unique model paths and their FBX blobs from asset library
    const modelBlobs: Record<string, string> = {}; // modelPath -> base64
    const neededPaths = new Set(sceneData.objects.map((o) => o.modelPath));
    for (const path of neededPaths) {
      const assetId = this.findAssetByName(path);
      if (assetId) {
        const asset = this.assetLibrary.get(assetId);
        if (asset) {
          const arrayBuf = await asset.blob.arrayBuffer();
          modelBlobs[path] = this.arrayBufferToBase64(arrayBuf);
        }
      }
    }

    // Collect texture data
    const textureBlobs: Record<string, { dataUrl: string; tiling: [number, number]; offset: [number, number] }> = {};
    for (const [id, obj] of this.objects) {
      const meta = this.objectMeta.get(id);
      if (!meta) continue;
      const materials = this.collectMaterials(obj);
      for (let i = 0; i < materials.length; i++) {
        const mat = materials[i] as THREE.MeshStandardMaterial;
        if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
        for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
          const tex = (mat as any)[mapType] as THREE.Texture | null;
          if (tex && tex.image) {
            try {
              const dataUrl = this.textureToDataUrl(tex);
              if (dataUrl) {
                const key = `${meta.modelPath}__${i}__${mapType}`;
                textureBlobs[key] = {
                  dataUrl,
                  tiling: [tex.repeat.x, tex.repeat.y],
                  offset: [tex.offset.x, tex.offset.y],
                };
              }
            } catch { /* skip */ }
          }
        }
      }
    }

    // Collect clip name mappings per model (so runtime can rename clips to match)
    const clipNames: Record<string, string[]> = {};
    for (const [id, _obj] of this.objects) {
      const meta = this.objectMeta.get(id);
      if (!meta) continue;
      if (clipNames[meta.modelPath]) continue;
      const clips = this.objectAnimations.get(id);
      if (clips && clips.length > 0) {
        clipNames[meta.modelPath] = clips.map((c) => c.name);
      }
    }

    // Collect extra animation FBX blobs
    const extraAnims: Record<string, string[]> = {};
    for (const [modelPath, blobs] of this.extraAnimBlobs) {
      const base64List: string[] = [];
      for (const { blob } of blobs) {
        const buf = await blob.arrayBuffer();
        base64List.push(this.arrayBufferToBase64(buf));
      }
      extraAnims[modelPath] = base64List;
    }

    const bundle = {
      _format: 'scene-bundle',
      _version: 2,
      scene: sceneData,
      models: modelBlobs,
      textures: textureBlobs,
      clipNames,
      extraAnims,
    };

    console.log('[Bundle] Saving objects:', sceneData.objects.map(o => ({
      name: o.name, collider: o.collider?.type, animations: o.animations?.length, behavior: o.behavior
    })));

    const jsonStr = JSON.stringify(bundle);

    // Compress with gzip if supported
    if ('CompressionStream' in window) {
      const blob = new Blob([jsonStr]);
      const cs = new CompressionStream('gzip');
      const compressedStream = blob.stream().pipeThrough(cs);
      const compressedBlob = await new Response(compressedStream).blob();
      return new Blob([compressedBlob], { type: 'application/gzip' });
    }

    return new Blob([jsonStr], { type: 'application/json' });
  }

  async importBundle(file: File): Promise<{ loaded: number; total: number }> {
    let raw: any;

    // Auto-detect gzip (first 2 bytes = 0x1f 0x8b)
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
      // Legacy scene JSON (no bundle) ??fall back to old import
      const data = raw as SceneData;
      if (!data.objects || !Array.isArray(data.objects)) throw new Error('Invalid scene file');
      await this.importScene(data);
      return { loaded: this.getAllMeta().length, total: data.objects.length };
    }

    const { scene, models, textures, extraAnims: bundleExtraAnims, clipNames: bundleClipNames } = raw as {
      scene: SceneData;
      models: Record<string, string>;
      textures: Record<string, { dataUrl: string; tiling: [number, number]; offset: [number, number] }>;
      extraAnims?: Record<string, string[]>;
      clipNames?: Record<string, string[]>;
    };

    // First, inject models into asset library from bundle
    for (const [modelPath, base64] of Object.entries(models)) {
      const arrayBuf = this.base64ToArrayBuffer(base64);
      const fileName = modelPath.split('/').pop()?.split('\\').pop() || modelPath;
      const blob = new File([arrayBuf], fileName, { type: 'application/octet-stream' });
      this.addToAssetLibrary(blob);
    }

    // Now import scene (all models should be in library now)
    this.suppressHistory = true;

    // Clear existing camera
    if (this.cameraObjectId) {
      if (this.cameraHelper) { this.scene.remove(this.cameraHelper); this.cameraHelper = null; }
      this.sceneCameraObj = null;
      this.cameraObjectId = null;
      this.cameraFollowTarget = null;
      this.disposeCameraObjectPreview();
    }

    // Clear existing objects
    for (const id of Array.from(this.objects.keys())) {
      const obj = this.objects.get(id)!;
      if (this.selectedId === id) this.deselect();
      this.scene.remove(obj);
      this.objects.delete(id);
      this.objectMeta.delete(id);
    }

    this.setAmbient(scene.ambientIntensity, scene.ambientColor);
    this.setSun(scene.sunIntensity, scene.sunColor, scene.sunDirection);

    let loaded = 0;
    console.log('[Bundle] Loading objects:', scene.objects.map((o: any) => ({
      name: o.name, collider: o.collider?.type, animations: o.animations?.length, behavior: o.behavior
    })));
    for (const objData of scene.objects) {
      const libraryMatch = this.findAssetByName(objData.modelPath);
      if (libraryMatch) {
        try {
          const id = await this.spawnFromLibraryRaw(libraryMatch, objData.name, objData.modelPath);
          if (id) {
            this.setObjectTransform(id, objData.position, objData.rotation, objData.scale);
            const meta = this.objectMeta.get(id);
            if (meta) {
              if (objData.collider) {
                meta.collider = objData.collider;
              }
              if (objData.animations) {
                meta.animations = objData.animations;
              }
              if (objData.behavior) {
                meta.behavior = objData.behavior;
              }
              if (objData.textures) {
                meta.textures = objData.textures;
              }
            }
            loaded++;
          }
        } catch (err) {
          console.warn(`載入失敗: ${objData.modelPath}`, err);
        }
      }
    }

    // Load extra animations from bundle
    if (bundleExtraAnims) {
      for (const [modelPath, base64List] of Object.entries(bundleExtraAnims)) {
        // Find an object with this modelPath to load anims onto
        const targetId = Array.from(this.objectMeta.entries()).find(([, m]) => m.modelPath === modelPath)?.[0];
        if (!targetId) continue;
        const targetObj = this.objects.get(targetId);
        if (!targetObj) continue;

        for (const base64 of base64List) {
          const arrayBuf = this.base64ToArrayBuffer(base64);
          const blob = new File([arrayBuf], 'extra_anim.fbx', { type: 'application/octet-stream' });
          const url = URL.createObjectURL(blob);
          try {
            const loader = new FBXLoader();
            const anim = await loader.loadAsync(url);
            if (anim.animations.length > 0) {
              let clips = this.objectAnimations.get(targetId);
              if (!clips) { clips = []; this.objectAnimations.set(targetId, clips); }
              clips.push(...anim.animations);
            }
          } catch { /* skip */ }
          URL.revokeObjectURL(url);
        }

        // Rename clips to match editor names
        if (bundleClipNames && bundleClipNames[modelPath]) {
          const clips = this.objectAnimations.get(targetId);
          if (clips) {
            const names = bundleClipNames[modelPath];
            for (let i = 0; i < Math.min(names.length, clips.length); i++) {
              clips[i].name = names[i];
            }
          }
        }

        // Store blobs for re-export
        const blobs = base64List.map((b64) => {
          const buf = this.base64ToArrayBuffer(b64);
          return { name: 'extra_anim.fbx', blob: new File([buf], 'extra_anim.fbx', { type: 'application/octet-stream' }) };
        });
        this.extraAnimBlobs.set(modelPath, blobs);
      }
    }

    // Apply textures from bundle
    for (const [id, obj] of this.objects) {
      const meta = this.objectMeta.get(id);
      if (!meta) continue;
      const materials = this.collectMaterials(obj);
      for (let i = 0; i < materials.length; i++) {
        const mat = materials[i] as THREE.MeshStandardMaterial;
        if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
        for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
          const key = `${meta.modelPath}__${i}__${mapType}`;
          const entry = textures[key];
          if (entry) {
            const texture = new THREE.TextureLoader().load(entry.dataUrl);
            texture.colorSpace = mapType === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
            texture.flipY = true;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(entry.tiling[0], entry.tiling[1]);
            texture.offset.set(entry.offset[0], entry.offset[1]);
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            (mat as any)[mapType] = texture;
            mat.needsUpdate = true;

            if (!meta.textures) meta.textures = {};
            if (!meta.textures[i]) meta.textures[i] = {};
            meta.textures[i]![mapType] = key;
            meta.textures[i]!.tiling = entry.tiling;
            meta.textures[i]!.offset = entry.offset;
          }
        }
        // Restore per-slot color and brightness from meta
        if (meta.textures?.[i]?.color) {
          (mat as any).color?.set(meta.textures[i]!.color);
          mat.needsUpdate = true;
        }
        if (meta.textures?.[i]?.brightness !== undefined) {
          const brightness = meta.textures[i]!.brightness!;
          (mat as any).userData = (mat as any).userData || {};
          (mat as any).userData.__brightness = brightness;
          if ((mat as any).emissive) {
            const baseColor = (mat as any).color ? (mat as any).color.clone() : new THREE.Color(0xffffff);
            const emissiveStrength = Math.max(0, brightness - 1.0);
            (mat as any).emissive.copy(baseColor).multiplyScalar(emissiveStrength);
            mat.needsUpdate = true;
          }
        }
      }
    }

    this.suppressHistory = false;
    this.pushHistory();

    // Rebuild collider helpers after a frame delay (geometry needs to be ready)
    requestAnimationFrame(() => {
      for (const [objId, objMeta] of this.objectMeta) {
        if (objMeta.collider && objMeta.collider.type !== 'none') {
          this.updateColliderHelper(objId);
        }
        if (objMeta.behavior?.attackRange) {
          this.updateAttackRangeHelper(objId);
        }
      }
    });

    // Restore camera object from bundle
    if (scene.camera) {
      this.restoreCameraFromData(scene.camera);
    }

    return { loaded, total: scene.objects.length };
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // --- Texture persistence (IndexedDB, editor-only) ---

  async saveTexturesToStorage() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('textures', 'readwrite');
      const store = tx.objectStore('textures');
      store.clear();
      for (const [id, obj] of this.objects) {
        const meta = this.objectMeta.get(id);
        if (!meta) continue;
        const materials = this.collectMaterials(obj);
        for (let i = 0; i < materials.length; i++) {
          const mat = materials[i] as THREE.MeshStandardMaterial;
          if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
          for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
            const tex = (mat as any)[mapType] as THREE.Texture | null;
            if (tex && tex.image) {
              try {
                const dataUrl = this.textureToDataUrl(tex);
                if (dataUrl) {
                  const key = `${meta.modelPath}__${i}__${mapType}`;
                  store.put({
                    key,
                    dataUrl,
                    tiling: [tex.repeat.x, tex.repeat.y],
                    offset: [tex.offset.x, tex.offset.y],
                  });
                }
              } catch { /* skip */ }
            }
          }
        }
      }
      db.close();
    } catch (err) {
      console.warn('Failed to save textures:', err);
    }
  }

  async loadTexturesFromStorage() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('textures', 'readonly');
      const store = tx.objectStore('textures');
      const all: Array<{ key: string; dataUrl: string; tiling?: [number, number]; offset?: [number, number] }> = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();

      if (all.length === 0) return;

      for (const [id, obj] of this.objects) {
        const meta = this.objectMeta.get(id);
        if (!meta) continue;
        const materials = this.collectMaterials(obj);
        for (let i = 0; i < materials.length; i++) {
          const mat = materials[i] as THREE.MeshStandardMaterial;
          if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
          for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
            const key = `${meta.modelPath}__${i}__${mapType}`;
            const entry = all.find((e) => e.key === key);
            if (entry) {
              const texture = new THREE.TextureLoader().load(entry.dataUrl);
              texture.colorSpace = mapType === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
              texture.flipY = true;
              texture.wrapS = THREE.RepeatWrapping;
              texture.wrapT = THREE.RepeatWrapping;
              texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
              if (entry.tiling) {
                texture.repeat.set(entry.tiling[0], entry.tiling[1]);
              }
              if (entry.offset) {
                texture.offset.set(entry.offset[0], entry.offset[1]);
              }
              (mat as any)[mapType] = texture;
              mat.needsUpdate = true;

              // Also update meta
              if (!meta.textures) meta.textures = {};
              if (!meta.textures[i]) meta.textures[i] = {};
              if (entry.tiling) meta.textures[i]!.tiling = entry.tiling;
              if (entry.offset) meta.textures[i]!.offset = entry.offset;
            }
          }
        }
      }
    } catch (err) {
      console.warn('Failed to load textures from storage:', err);
    }
  }

  // --- Prefab & Game Export ---

  async exportForGame(sceneName: string): Promise<{
    sceneJson: string;
    prefabs: Array<{ path: string; json: string }>;
    textureFiles: Array<{ path: string; blob: Blob }>;
    modelFiles: Array<{ path: string; blob: Blob }>;
  }> {
    const prefabMap = new Map<string, { prefab: PrefabData; objIds: string[] }>();
    const textureFiles: Array<{ path: string; blob: Blob }> = [];
    const modelFiles: Array<{ path: string; blob: Blob }> = [];

    // Group objects by modelPath (same model = same prefab)
    for (const [id, _obj] of this.objects) {
      const meta = this.objectMeta.get(id);
      if (!meta) continue;
      const prefabId = meta.modelPath.replace(/\.fbx$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');

      if (!prefabMap.has(prefabId)) {
        prefabMap.set(prefabId, {
          prefab: {
            id: prefabId,
            name: meta.name.replace(/_copy\d*$/, ''),
            model: `models/${meta.modelPath}`,
            scale: [1, 1, 1],
            collider: meta.collider,
            textures: meta.textures ? JSON.parse(JSON.stringify(meta.textures)) : undefined,
          },
          objIds: [],
        });
      }
      prefabMap.get(prefabId)!.objIds.push(id);
    }

    // Export textures for each prefab
    for (const [prefabId, { prefab }] of prefabMap) {
      // Find any instance to extract textures from
      const firstId = prefabMap.get(prefabId)!.objIds[0];
      const obj = this.objects.get(firstId);
      if (!obj) continue;

      const materials = this.collectMaterials(obj);
      for (let i = 0; i < materials.length; i++) {
        const mat = materials[i] as THREE.MeshStandardMaterial;
        if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
        for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
          const tex = (mat as any)[mapType] as THREE.Texture | null;
          if (tex && tex.image) {
            const fileName = `textures/${prefabId}_slot${i}_${mapType}.png`;
            const blob = this.textureToBlob(tex);
            if (blob) {
              textureFiles.push({ path: fileName, blob });
              if (!prefab.textures) prefab.textures = {};
              if (!prefab.textures[i]) prefab.textures[i] = {};
              prefab.textures[i]![mapType] = fileName;
              if (tex.repeat.x !== 1 || tex.repeat.y !== 1) {
                prefab.textures[i]!.tiling = [tex.repeat.x, tex.repeat.y];
              }
              if (tex.offset.x !== 0 || tex.offset.y !== 0) {
                prefab.textures[i]!.offset = [tex.offset.x, tex.offset.y];
              }
            }
          }
        }
      }

      // Export model FBX blob
      const assetId = this.findAssetByName(prefab.model.replace('models/', ''));
      if (assetId) {
        const asset = this.assetLibrary.get(assetId);
        if (asset) {
          modelFiles.push({ path: prefab.model, blob: asset.blob });
        }
      }
    }

    // Build game scene (instances referencing prefabs)
    const instances = [];
    for (const [_prefabId, { objIds }] of prefabMap) {
      for (const objId of objIds) {
        const meta = this.objectMeta.get(objId)!;
        const prefabId = meta.modelPath.replace(/\.fbx$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
        instances.push({
          prefab: prefabId,
          name: meta.name,
          position: meta.position,
          rotation: meta.rotation,
          scale: meta.scale,
        });
      }
    }

    const gameScene: GameSceneData = {
      name: sceneName,
      ambientColor: '#' + this.ambientLight.color.getHexString(),
      ambientIntensity: this.ambientLight.intensity,
      sunColor: '#' + this.sunLight.color.getHexString(),
      sunIntensity: this.sunLight.intensity,
      sunDirection: [this.sunLight.position.x, this.sunLight.position.y, this.sunLight.position.z],
      instances,
    };

    // Build prefab JSON files
    const prefabs: Array<{ path: string; json: string }> = [];
    for (const [prefabId, { prefab }] of prefabMap) {
      prefabs.push({
        path: `prefabs/${prefabId}.prefab.json`,
        json: JSON.stringify(prefab, null, 2),
      });
    }

    return {
      sceneJson: JSON.stringify(gameScene, null, 2),
      prefabs,
      textureFiles,
      modelFiles,
    };
  }

  private textureToDataUrl(tex: THREE.Texture, quality = 0.8): string | null {
    const img = tex.image as HTMLImageElement | HTMLCanvasElement | null;
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = (img as any).width || (img as any).naturalWidth || 256;
    canvas.height = (img as any).height || (img as any).naturalHeight || 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    // Use JPEG for diffuse maps (much smaller), PNG for maps needing alpha
    const hasAlpha = this.canvasHasAlpha(ctx, canvas.width, canvas.height);
    if (hasAlpha) {
      return canvas.toDataURL('image/png');
    }
    return canvas.toDataURL('image/jpeg', quality);
  }

  private canvasHasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    // Sample a few pixels to check if alpha channel is used
    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(1, Math.floor(data.length / (4 * 200))); // sample ~200 pixels
    for (let i = 3; i < data.length; i += 4 * step) {
      if (data[i] < 250) return true; // found non-opaque pixel
    }
    return false;
  }

  private textureToBlob(tex: THREE.Texture): Blob | null {
    const img = tex.image as HTMLImageElement | HTMLCanvasElement | null;
    if (!img) return null;
    const canvas = document.createElement('canvas');
    canvas.width = (img as any).width || (img as any).naturalWidth || 256;
    canvas.height = (img as any).height || (img as any).naturalHeight || 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img as CanvasImageSource, 0, 0);
    const hasAlpha = this.canvasHasAlpha(ctx, canvas.width, canvas.height);
    const dataUrl = hasAlpha
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', 0.8);
    const binary = atob(dataUrl.split(',')[1]);
    const array = new Uint8Array(binary.length);
    for (let k = 0; k < binary.length; k++) array[k] = binary.charCodeAt(k);
    return new Blob([array], { type: hasAlpha ? 'image/png' : 'image/jpeg' });
  }

  async importScene(data: SceneData, baseUrl?: string): Promise<string[]> {
    this.suppressHistory = true;

    // Clear existing camera
    if (this.cameraObjectId) {
      if (this.cameraHelper) { this.scene.remove(this.cameraHelper); this.cameraHelper = null; }
      this.sceneCameraObj = null;
      this.cameraObjectId = null;
      this.cameraFollowTarget = null;
      this.disposeCameraObjectPreview();
    }

    // Clear existing objects
    for (const id of Array.from(this.objects.keys())) {
      const obj = this.objects.get(id)!;
      if (this.selectedId === id) this.deselect();
      this.scene.remove(obj);
      this.objects.delete(id);
      this.objectMeta.delete(id);
    }

    this.setAmbient(data.ambientIntensity, data.ambientColor);
    this.setSun(data.sunIntensity, data.sunColor, data.sunDirection);

    // Try to load models from asset library first, then from URL
    const missingModels: string[] = [];
    for (const objData of data.objects) {
      let id: string | null = null;

      // Try to find in asset library by matching model name
      const libraryMatch = this.findAssetByName(objData.modelPath);
      if (libraryMatch) {
        try {
          id = await this.spawnFromLibraryRaw(libraryMatch, objData.name, objData.modelPath);
        } catch (err) {
          console.warn(`素材庫載入失敗 ${objData.modelPath}:`, err);
        }
      }

      // If not in library, try URL loading
      if (!id) {
        const url = baseUrl ? `${baseUrl}/${objData.modelPath}` : objData.modelPath;
        try {
          id = await this.addFBXFromUrl(url, objData.name, objData.modelPath);
        } catch (err) {
          missingModels.push(objData.modelPath);
        }
      }

      if (id) {
        this.setObjectTransform(id, objData.position, objData.rotation, objData.scale);
        const meta = this.objectMeta.get(id);
        if (meta) {
          if (objData.collider) {
            meta.collider = objData.collider;
            this.updateColliderHelper(id);
          }
          if (objData.animations) {
            meta.animations = objData.animations;
          }
          if (objData.behavior) {
            meta.behavior = objData.behavior;
          }
          if (objData.textures) {
            meta.textures = objData.textures;
          }
        }
      }
    }

    this.suppressHistory = false;
    this.pushHistory();

    // Apply material color/brightness from meta
    for (const [id, obj] of this.objects) {
      const meta = this.objectMeta.get(id);
      if (!meta?.textures) continue;
      const materials = this.collectMaterials(obj);
      for (const [slotStr, texInfo] of Object.entries(meta.textures)) {
        const slot = parseInt(slotStr);
        if (slot < 0 || slot >= materials.length) continue;
        const mat = materials[slot] as any;
        if (texInfo.color && mat.color) {
          mat.color.set(texInfo.color);
          mat.needsUpdate = true;
        }
        if (texInfo.brightness !== undefined) {
          mat.userData = mat.userData || {};
          mat.userData.__brightness = texInfo.brightness;
          if (mat.emissive) {
            const baseColor = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
            const emissiveStrength = Math.max(0, texInfo.brightness - 1.0);
            mat.emissive.copy(baseColor).multiplyScalar(emissiveStrength);
            mat.needsUpdate = true;
          }
        }
      }
    }

    // Rebuild collider helpers after a frame delay
    requestAnimationFrame(() => {
      for (const [objId, objMeta] of this.objectMeta) {
        if (objMeta.collider && objMeta.collider.type !== 'none') {
          this.updateColliderHelper(objId);
        }
        if (objMeta.behavior?.attackRange) {
          this.updateAttackRangeHelper(objId);
        }
      }
    });

    // Restore camera object if saved in scene data
    if (data.camera) {
      this.restoreCameraFromData(data.camera);
    }

    return missingModels;
  }

  private findAssetByName(modelPath: string): string | null {
    if (!modelPath) return null;
    // Extract just the filename without path and extension
    const fileName = modelPath.split('/').pop()?.split('\\').pop()?.toLowerCase() || '';
    const nameNoExt = fileName.replace(/\.fbx$/i, '');

    for (const [assetId, asset] of this.assetLibrary) {
      const assetName = asset.name.toLowerCase();
      // Match by: exact name, name+.fbx, or partial match
      if (
        assetName === nameNoExt ||
        assetName === fileName ||
        assetName + '.fbx' === fileName ||
        nameNoExt === assetName.replace(/\.fbx$/i, '')
      ) {
        return assetId;
      }
    }
    return null;
  }

  private async spawnFromLibraryRaw(assetId: string, name: string, modelPath: string): Promise<string | null> {
    const asset = this.assetLibrary.get(assetId);
    if (!asset) return null;

    const id = this.generateId();
    const fbx = await this.getOrLoadModel(assetId);

    this.setupAnimations(id, fbx);
    this.scene.add(fbx);
    this.objects.set(id, fbx);

    const meta: SceneObjectData = {
      id,
      name,
      modelPath,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    this.objectMeta.set(id, meta);
    return id;
  }

  // --- Undo / Redo ---

  pushHistory() {
    if (this.suppressHistory) return;
    const snapshot = JSON.stringify(this.getAllMeta());
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
    this.redoStack = [];
    this.onHistoryChange?.();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const current = JSON.stringify(this.getAllMeta());
    this.redoStack.push(current);
    const prev = this.undoStack.pop()!;
    this.restoreFromSnapshot(JSON.parse(prev));
    this.onHistoryChange?.();
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const current = JSON.stringify(this.getAllMeta());
    this.undoStack.push(current);
    const next = this.redoStack.pop()!;
    this.restoreFromSnapshot(JSON.parse(next));
    this.onHistoryChange?.();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  private restoreFromSnapshot(metas: SceneObjectData[]) {
    this.suppressHistory = true;
    // Apply transforms from snapshot to existing objects
    for (const meta of metas) {
      // Skip camera object — don't undo camera position changes
      // (camera is managed independently and shouldn't be affected by undo of other operations)
      if (meta.modelPath === '__camera__') continue;

      const obj = this.objects.get(meta.id);
      if (obj) {
        this.setObjectTransform(meta.id, meta.position, meta.rotation, meta.scale);
        // Update name
        const existing = this.objectMeta.get(meta.id);
        if (existing) existing.name = meta.name;
      }
    }
    // Remove objects not in snapshot (but never remove camera object via undo)
    for (const id of Array.from(this.objects.keys())) {
      if (id === this.cameraObjectId) continue;
      if (!metas.find((m) => m.id === id)) {
        const obj = this.objects.get(id)!;
        if (this.selectedId === id) this.deselect();
        this.scene.remove(obj);
        this.objects.delete(id);
        this.objectMeta.delete(id);
      }
    }
    this.suppressHistory = false;
    this.onSelect?.(this.selectedId);
  }

  // --- Copy / Paste ---

  copy() {
    if (!this.selectedId) return;
    const meta = this.objectMeta.get(this.selectedId);
    if (!meta) return;
    const assetId = this.findAssetByName(meta.modelPath);
    if (!assetId) return;
    this.clipboard = { assetId, meta: JSON.parse(JSON.stringify(meta)), sourceId: this.selectedId };
  }

  paste() {
    if (!this.clipboard) return;
    this.pasteFromClipboard();
  }

  private async pasteFromClipboard() {
    if (!this.clipboard) return;
    const { assetId, meta: srcMeta, sourceId } = this.clipboard;
    const asset = this.assetLibrary.get(assetId);
    if (!asset) return;

    const url = URL.createObjectURL(asset.blob);
    const id = this.generateId();
    const loader = new FBXLoader();
    const fbx = await loader.loadAsync(url);
    URL.revokeObjectURL(url);

    this.prepareFBX(fbx);
    this.scene.add(fbx);
    this.objects.set(id, fbx);

    // Offset position slightly from source
    const offset: [number, number, number] = [
      srcMeta.position[0] + 50,
      srcMeta.position[1],
      srcMeta.position[2] + 50,
    ];

    const meta: SceneObjectData = {
      id,
      name: srcMeta.name + '_copy',
      modelPath: srcMeta.modelPath,
      position: offset,
      rotation: [...srcMeta.rotation] as [number, number, number],
      scale: [...srcMeta.scale] as [number, number, number],
      textures: srcMeta.textures ? JSON.parse(JSON.stringify(srcMeta.textures)) : undefined,
      collider: srcMeta.collider ? JSON.parse(JSON.stringify(srcMeta.collider)) : undefined,
      animations: srcMeta.animations ? JSON.parse(JSON.stringify(srcMeta.animations)) : undefined,
      behavior: srcMeta.behavior ? { ...srcMeta.behavior } : undefined,
    };
    this.objectMeta.set(id, meta);
    this.setObjectTransform(id, meta.position, meta.rotation, meta.scale);
    this.setupAnimations(id, fbx);

    // Show collider helper if applicable
    if (meta.collider && meta.collider.type !== 'none') {
      this.updateColliderHelper(id);
    }

    // Copy textures from source object
    const sourceObj = this.objects.get(sourceId);
    if (sourceObj) {
      const srcMats = this.collectMaterials(sourceObj);
      const dstMats = this.collectMaterials(fbx);
      for (let i = 0; i < Math.min(srcMats.length, dstMats.length); i++) {
        const srcMat = srcMats[i] as THREE.MeshStandardMaterial;
        const dstMat = dstMats[i] as THREE.MeshStandardMaterial;
        if ((!srcMat.isMeshStandardMaterial && !(srcMat as any).isMeshToonMaterial) || (!dstMat.isMeshStandardMaterial && !(dstMat as any).isMeshToonMaterial)) continue;
        for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
          const srcTex = (srcMat as any)[mapType] as THREE.Texture | null;
          if (srcTex) {
            const clonedTex = srcTex.clone();
            clonedTex.needsUpdate = true;
            (dstMat as any)[mapType] = clonedTex;
            dstMat.needsUpdate = true;
          }
        }
      }
    }

    this.select(id);
    this.pushHistory();
    this.onSelect?.(id);
  }

  canPaste(): boolean { return this.clipboard !== null; }

  // --- Asset Library ---

  addToAssetLibrary(file: File): string {
    // Dedup: check if same filename already exists
    for (const [existingId, asset] of this.assetLibrary) {
      if (asset.name.toLowerCase() === file.name.replace('.fbx', '').toLowerCase()) {
        return existingId; // Already exists, skip
      }
    }
    const assetId = `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    this.assetLibrary.set(assetId, { name: file.name.replace('.fbx', ''), blob: file });
    this.saveAssetLibraryToStorage();
    this.onAssetLibraryChange?.();
    return assetId;
  }

  getAssetLibrary(): Array<{ assetId: string; name: string }> {
    const result: Array<{ assetId: string; name: string }> = [];
    this.assetLibrary.forEach((val, key) => {
      result.push({ assetId: key, name: val.name });
    });
    return result;
  }

  async spawnFromLibrary(assetId: string): Promise<string | null> {
    const asset = this.assetLibrary.get(assetId);
    if (!asset) return null;

    const id = this.generateId();
    const fbx = await this.getOrLoadModel(assetId);

    this.setupAnimations(id, fbx);
    this.scene.add(fbx);
    this.objects.set(id, fbx);

    const meta: SceneObjectData = {
      id,
      name: asset.name,
      modelPath: asset.name + '.fbx',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    this.objectMeta.set(id, meta);
    this.select(id);
    this.pushHistory();
    return id;
  }

  removeFromAssetLibrary(assetId: string) {
    this.assetLibrary.delete(assetId);
    this.saveAssetLibraryToStorage();
    this.onAssetLibraryChange?.();
  }

  // --- Prefab Management ---

  saveToPrefab(id: string, prefabName?: string): string | null {
    const obj = this.objects.get(id);
    const meta = this.objectMeta.get(id);
    if (!obj || !meta) return null;
    // Camera object cannot be saved as prefab
    if (id === this.cameraObjectId) return null;

    const prefabId = prefabName
      ? prefabName.replace(/[^a-zA-Z0-9_-]/g, '_')
      : meta.modelPath.replace(/\.fbx$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_') + '_' + Date.now().toString(36);

    // Capture texture data from the live object
    const materials = this.collectMaterials(obj);
    const textures: PrefabData['textures'] = {};
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i] as THREE.MeshStandardMaterial;
      if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
      for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
        const tex = (mat as any)[mapType] as THREE.Texture | null;
        if (tex && tex.image) {
          if (!textures[i]) textures[i] = {};
          textures[i]![mapType] = `${prefabId}__${i}__${mapType}`;
          if (tex.repeat.x !== 1 || tex.repeat.y !== 1) textures[i]!.tiling = [tex.repeat.x, tex.repeat.y];
          if (tex.offset.x !== 0 || tex.offset.y !== 0) textures[i]!.offset = [tex.offset.x, tex.offset.y];
          // Cache the texture dataUrl
          try {
            const dataUrl = this.textureToDataUrl(tex);
            if (dataUrl) this.prefabTextures.set(`${prefabId}__${i}__${mapType}`, dataUrl);
          } catch { /* skip */ }
        }
      }
    }

    const prefab: PrefabData = {
      id: prefabId,
      name: prefabName || meta.name,
      model: meta.modelPath,
      scale: [...meta.scale] as [number, number, number],
      collider: meta.collider ? JSON.parse(JSON.stringify(meta.collider)) : undefined,
      animations: meta.animations && meta.animations.length > 0 ? [...meta.animations] : undefined,
      fps: this.objectFPS.get(id),
      behavior: meta.behavior ? { ...meta.behavior } : undefined,
      textures: Object.keys(textures).length > 0 ? textures : undefined,
    };

    this.prefabRegistry.set(prefabId, prefab);
    this.savePrefabsToStorage();
    this.onPrefabChange?.();
    return prefabId;
  }

  // Update an existing prefab from the currently selected object
  updatePrefab(prefabId: string, id: string): boolean {
    const obj = this.objects.get(id);
    const meta = this.objectMeta.get(id);
    if (!obj || !meta) return false;

    const existing = this.prefabRegistry.get(prefabId);
    if (!existing) return false;

    // Recapture textures
    const materials = this.collectMaterials(obj);
    const textures: PrefabData['textures'] = {};
    for (let i = 0; i < materials.length; i++) {
      const mat = materials[i] as THREE.MeshStandardMaterial;
      if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
      for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
        const tex = (mat as any)[mapType] as THREE.Texture | null;
        if (tex && tex.image) {
          if (!textures[i]) textures[i] = {};
          textures[i]![mapType] = `${prefabId}__${i}__${mapType}`;
          if (tex.repeat.x !== 1 || tex.repeat.y !== 1) textures[i]!.tiling = [tex.repeat.x, tex.repeat.y];
          if (tex.offset.x !== 0 || tex.offset.y !== 0) textures[i]!.offset = [tex.offset.x, tex.offset.y];
          try {
            const dataUrl = this.textureToDataUrl(tex);
            if (dataUrl) this.prefabTextures.set(`${prefabId}__${i}__${mapType}`, dataUrl);
          } catch { /* skip */ }
        }
      }
    }

    // Update prefab data
    existing.scale = [...meta.scale] as [number, number, number];
    existing.collider = meta.collider ? JSON.parse(JSON.stringify(meta.collider)) : existing.collider;
    existing.animations = meta.animations && meta.animations.length > 0 ? [...meta.animations] : existing.animations;
    existing.fps = this.objectFPS.get(id) || existing.fps;
    existing.behavior = meta.behavior ? { ...meta.behavior } : existing.behavior;
    existing.textures = Object.keys(textures).length > 0 ? textures : existing.textures;

    this.savePrefabsToStorage();
    this.onPrefabChange?.();

    // Sync all other instances of this prefab on scene
    this.syncPrefabInstances(prefabId, id);

    return true;
  }

  private syncPrefabInstances(prefabId: string, sourceId: string) {
    const prefab = this.prefabRegistry.get(prefabId);
    if (!prefab) return;
    const sourceObj = this.objects.get(sourceId);
    if (!sourceObj) return;
    const sourceMeta = this.objectMeta.get(sourceId);

    for (const [objId, objMeta] of this.objectMeta) {
      if (objId === sourceId) continue;
      if (objMeta.modelPath !== prefab.model) continue;

      const targetObj = this.objects.get(objId);
      if (!targetObj) continue;

      // Sync collider (only if source has one)
      if (sourceMeta?.collider) {
        objMeta.collider = JSON.parse(JSON.stringify(sourceMeta.collider));
        this.updateColliderHelper(objId);
      }

      // Sync animations
      if (sourceMeta?.animations && sourceMeta.animations.length > 0) {
        objMeta.animations = JSON.parse(JSON.stringify(sourceMeta.animations));
      }

      // Sync behavior
      if (sourceMeta?.behavior) {
        objMeta.behavior = { ...sourceMeta.behavior };
        this.updateAttackRangeHelper(objId);
      }

      // Sync textures
      const srcMats = this.collectMaterials(sourceObj);
      const dstMats = this.collectMaterials(targetObj);
      for (let i = 0; i < Math.min(srcMats.length, dstMats.length); i++) {
        const srcMat = srcMats[i] as THREE.MeshStandardMaterial;
        const dstMat = dstMats[i] as THREE.MeshStandardMaterial;
        if ((!srcMat.isMeshStandardMaterial && !(srcMat as any).isMeshToonMaterial) || (!dstMat.isMeshStandardMaterial && !(dstMat as any).isMeshToonMaterial)) continue;
        for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
          const srcTex = (srcMat as any)[mapType] as THREE.Texture | null;
          if (srcTex) {
            const cloned = srcTex.clone();
            cloned.needsUpdate = true;
            (dstMat as any)[mapType] = cloned;
          } else {
            (dstMat as any)[mapType] = null;
          }
          dstMat.needsUpdate = true;
        }
      }
    }
  }

  // Track which prefab is currently being edited
  private editingPrefabId: string | null = null;

  startEditPrefab(prefabId: string): string | null {
    this.editingPrefabId = prefabId;
    return prefabId;
  }

  getEditingPrefabId(): string | null {
    return this.editingPrefabId;
  }

  finishEditPrefab(id: string): boolean {
    if (!this.editingPrefabId) return false;
    const result = this.updatePrefab(this.editingPrefabId, id);
    this.editingPrefabId = null;
    return result;
  }

  cancelEditPrefab() {
    this.editingPrefabId = null;
  }

  async spawnFromPrefab(prefabId: string): Promise<string | null> {
    const prefab = this.prefabRegistry.get(prefabId);
    if (!prefab) return null;

    const assetId = this.findAssetByName(prefab.model);
    if (!assetId) return null;

    const id = this.generateId();
    const fbx = await this.getOrLoadModel(assetId);

    this.setupAnimations(id, fbx);
    this.scene.add(fbx);
    this.objects.set(id, fbx);

    const meta: SceneObjectData = {
      id,
      name: prefab.name,
      modelPath: prefab.model,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [...prefab.scale] as [number, number, number],
      collider: prefab.collider ? JSON.parse(JSON.stringify(prefab.collider)) : undefined,
      animations: prefab.animations ? JSON.parse(JSON.stringify(prefab.animations)) : undefined,
      behavior: prefab.behavior ? { ...prefab.behavior } : undefined,
      textures: prefab.textures ? JSON.parse(JSON.stringify(prefab.textures)) : undefined,
    };
    this.objectMeta.set(id, meta);
    this.setObjectTransform(id, meta.position, meta.rotation, meta.scale);

    // Apply textures from prefab cache
    if (prefab.textures) {
      const materials = this.collectMaterials(fbx);
      for (const [slotStr, texInfo] of Object.entries(prefab.textures)) {
        const slot = parseInt(slotStr);
        if (slot >= materials.length) continue;
        const mat = materials[slot] as THREE.MeshStandardMaterial;
        if (!mat.isMeshStandardMaterial && !(mat as any).isMeshToonMaterial) continue;
        for (const mapType of ['map', 'normalMap', 'roughnessMap'] as const) {
          const texKey = texInfo[mapType];
          if (!texKey) continue;
          const dataUrl = this.prefabTextures.get(texKey);
          if (dataUrl) {
            const texture = new THREE.TextureLoader().load(dataUrl);
            texture.colorSpace = mapType === 'map' ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
            texture.flipY = true;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
            if (texInfo.tiling) texture.repeat.set(texInfo.tiling[0], texInfo.tiling[1]);
            if (texInfo.offset) texture.offset.set(texInfo.offset[0], texInfo.offset[1]);
            (mat as any)[mapType] = texture;
            mat.needsUpdate = true;
          }
        }
      }
    }

    // Apply collider helper
    if (meta.collider && meta.collider.type !== 'none') {
      this.updateColliderHelper(id);
    }

    // Apply attack range helper
    if (meta.behavior?.attackRange) {
      this.updateAttackRangeHelper(id);
    }

    this.select(id);
    this.pushHistory();
    return id;
  }

  getPrefabList(): Array<{ id: string; name: string; model: string }> {
    const result: Array<{ id: string; name: string; model: string }> = [];
    this.prefabRegistry.forEach((p) => result.push({ id: p.id, name: p.name, model: p.model }));
    return result;
  }

  deletePrefab(prefabId: string) {
    this.prefabRegistry.delete(prefabId);
    // Clean texture cache
    for (const key of Array.from(this.prefabTextures.keys())) {
      if (key.startsWith(prefabId + '__')) this.prefabTextures.delete(key);
    }
    this.savePrefabsToStorage();
    this.onPrefabChange?.();
  }

  // --- Prefab File Export/Import (project-level files) ---

  async exportPrefabToFile(prefabId: string): Promise<Blob | null> {
    const prefab = this.prefabRegistry.get(prefabId);
    if (!prefab) return null;

    // Include texture data in the prefab file
    const texData: Record<string, string> = {};
    for (const [key, dataUrl] of this.prefabTextures) {
      if (key.startsWith(prefabId + '__')) {
        texData[key] = dataUrl;
      }
    }

    // Include model blob
    const assetId = this.findAssetByName(prefab.model);
    let modelBase64: string | undefined;
    if (assetId) {
      const asset = this.assetLibrary.get(assetId);
      if (asset) {
        modelBase64 = this.arrayBufferToBase64(await asset.blob.arrayBuffer());
      }
    }

    const fileData = {
      _format: 'prefab-file',
      _version: 1,
      prefab,
      textures: texData,
      model: modelBase64,
    };

    return new Blob([JSON.stringify(fileData, null, 2)], { type: 'application/json' });
  }

  async importPrefabFromFile(file: File): Promise<string | null> {
    const raw = JSON.parse(await file.text());
    if (raw._format !== 'prefab-file') throw new Error('不是有效的 Prefab 檔案');

    const { prefab, textures, model } = raw as {
      prefab: PrefabData;
      textures: Record<string, string>;
      model?: string;
    };

    // Inject model into asset library
    if (model) {
      const arrayBuf = this.base64ToArrayBuffer(model);
      const fileName = prefab.model.split('/').pop() || prefab.model;
      const blob = new File([arrayBuf], fileName, { type: 'application/octet-stream' });
      this.addToAssetLibrary(blob);
    }

    // Inject textures
    for (const [key, dataUrl] of Object.entries(textures)) {
      this.prefabTextures.set(key, dataUrl);
    }

    // Register prefab
    this.prefabRegistry.set(prefab.id, prefab);
    this.savePrefabsToStorage();
    this.onPrefabChange?.();
    return prefab.id;
  }

  // --- Prefab Persistence (IndexedDB cache) ---

  async savePrefabsToStorage() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('prefabs', 'readwrite');
      const store = tx.objectStore('prefabs');
      store.clear();
      for (const [id, prefab] of this.prefabRegistry) {
        const texEntries: Record<string, string> = {};
        for (const [key, dataUrl] of this.prefabTextures) {
          if (key.startsWith(id + '__')) texEntries[key] = dataUrl;
        }
        store.put({ id, prefab: JSON.stringify(prefab), textures: texEntries });
      }
      db.close();
    } catch (err) {
      console.warn('Failed to save prefabs:', err);
    }
  }

  async loadPrefabsFromStorage() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('prefabs', 'readonly');
      const store = tx.objectStore('prefabs');
      const all: Array<{ id: string; prefab: string; textures: Record<string, string> }> = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();

      for (const item of all) {
        const prefab = JSON.parse(item.prefab) as PrefabData;
        this.prefabRegistry.set(item.id, prefab);
        for (const [key, dataUrl] of Object.entries(item.textures)) {
          this.prefabTextures.set(key, dataUrl);
        }
      }
      this.onPrefabChange?.();
    } catch (err) {
      console.warn('Failed to load prefabs:', err);
    }
  }

  // --- Asset Library Persistence (IndexedDB) ---

  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('SceneEditorAssets', 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('textures')) {
          db.createObjectStore('textures', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('prefabs')) {
          db.createObjectStore('prefabs', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => {
        console.warn('IndexedDB upgrade blocked - close other tabs');
        reject(new Error('DB blocked'));
      };
    });
  }

  async saveAssetLibraryToStorage() {
    try {
      // Collect all data first (async), then write in one transaction (sync)
      const entries: Array<{ id: string; name: string; data: ArrayBuffer; fileName: string }> = [];
      for (const [id, asset] of this.assetLibrary) {
        const arrayBuffer = await (asset.blob as File).arrayBuffer();
        entries.push({ id, name: asset.name, data: arrayBuffer, fileName: asset.name + '.fbx' });
      }
      const db = await this.openDB();
      const tx = db.transaction('assets', 'readwrite');
      const store = tx.objectStore('assets');
      store.clear();
      for (const entry of entries) {
        store.put(entry);
      }
      db.close();
    } catch (err) {
      console.warn('Failed to save asset library:', err);
    }
  }

  async loadAssetLibraryFromStorage() {
    try {
      const db = await this.openDB();
      const tx = db.transaction('assets', 'readonly');
      const store = tx.objectStore('assets');
      const all: Array<{ id: string; name: string; data: ArrayBuffer; fileName: string }> = await new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();

      for (const item of all) {
        const blob = new File([item.data], item.fileName || item.name + '.fbx', { type: 'application/octet-stream' });
        this.assetLibrary.set(item.id, { name: item.name, blob });
      }
      this.onAssetLibraryChange?.();
    } catch (err) {
      console.warn('Failed to load asset library:', err);
    }
  }

  private generateId(): string {
    return `obj_${++this.idCounter}_${Date.now().toString(36)}`;
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    this.mixers.forEach((mixer) => mixer.update(delta));
    this.orbitControls.update();
    if (this.selectionBox && this.selectedId) {
      // Update selection box position and size to follow object (exclude helpers)
      const obj = this.objects.get(this.selectedId);
      if (obj) {
        const box = new THREE.Box3();
        obj.traverse((child: THREE.Object3D) => {
          if ((child as THREE.Mesh).isMesh && !(child.userData as any).__isOutline && !(child.userData as any).__isColliderHelper) {
            const mesh = child as THREE.Mesh;
            if (mesh.geometry) {
              mesh.geometry.computeBoundingBox();
              if (mesh.geometry.boundingBox) {
                const meshBox = mesh.geometry.boundingBox.clone();
                meshBox.applyMatrix4(mesh.matrixWorld);
                box.union(meshBox);
              }
            }
          }
        });
        if (!box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          this.selectionBox.position.copy(center);
          // Update geometry to match current size
          const size = box.getSize(new THREE.Vector3());
          const oldGeo = (this.selectionBox as any).geometry as THREE.BufferGeometry;
          oldGeo.dispose();
          const newGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x + 4, size.y + 4, size.z + 4));
          (this.selectionBox as any).geometry = newGeo;
          (this.selectionBox as any).computeLineDistances();
        }
      }
    }
    this.updateFlash();
    if (this.onUpdate) this.onUpdate(delta);

    // Ensure clean renderer state before main render
    this.renderer.setScissorTest(false);
    this.renderer.autoClear = true;
    this.renderer.render(this.scene, this.activeRenderCamera ?? this.camera);

    // Render axis indicator in bottom-left corner
    this.renderAxisIndicator();

    // Render camera preview if active (legacy)
    if (this.previewCamera && this.previewRenderer) {
      this.previewRenderer.render(this.scene, this.previewCamera);
    }

    // Render scene camera object preview
    this.renderCameraObjectPreview();

    // Keep camera helper in sync after transforms
    this.updateCameraHelper();
  };

  // --- Camera Preview ---
  private previewCamera: THREE.PerspectiveCamera | null = null;
  private previewRenderer: THREE.WebGLRenderer | null = null;

  setupCameraPreview(canvas: HTMLCanvasElement) {
    this.previewCamera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 10000);
    this.previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.previewRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.previewRenderer.setPixelRatio(window.devicePixelRatio);
    this.previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.previewRenderer.toneMappingExposure = 1.4;
    this.previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  updateCameraPreview(offset: [number, number, number], lookOffset: [number, number, number]) {
    if (!this.previewCamera || !this.selectedId) return;
    const obj = this.objects.get(this.selectedId);
    if (!obj) return;
    const pos = obj.position.clone();
    this.previewCamera.position.set(pos.x + offset[0], pos.y + offset[1], pos.z + offset[2]);
    this.previewCamera.lookAt(pos.x + lookOffset[0], pos.y + lookOffset[1], pos.z + lookOffset[2]);
  }

  disposeCameraPreview() {
    this.previewRenderer?.dispose();
    this.previewRenderer = null;
    this.previewCamera = null;
  }

  // --- Scene Camera Object ---
  private cameraObjectId: string | null = null;
  private cameraHelper: THREE.CameraHelper | null = null;
  private sceneCameraObj: THREE.PerspectiveCamera | null = null;
  private cameraPreviewCanvas: HTMLCanvasElement | null = null;
  private cameraPreviewRenderer: THREE.WebGLRenderer | null = null;
  private cameraFollowTarget: string | null = null; // object name to follow
  private cameraFollowOffset: THREE.Vector3 = new THREE.Vector3(0, 250, 350);
  private cameraLookOffset: THREE.Vector3 = new THREE.Vector3(0, 30, 0);

  onCameraObjectChange: (() => void) | null = null;

  getCameraObjectId(): string | null { return this.cameraObjectId; }

  hasCameraObject(): boolean { return this.cameraObjectId !== null; }

  addCameraObject(): string {
    // Only allow one camera object
    if (this.cameraObjectId) return this.cameraObjectId;

    const id = this.generateId();
    this.cameraObjectId = id;

    // Create an internal PerspectiveCamera as a scene object
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 1, 5000);
    cam.position.set(0, 200, 400);
    cam.lookAt(0, 0, 0);
    cam.userData.__isCameraObject = true;
    cam.userData.__editorHelper = true;
    this.sceneCameraObj = cam;
    this.scene.add(cam);

    // Create a frustum helper
    const helper = new THREE.CameraHelper(cam);
    helper.userData.__isCameraObject = true;
    helper.userData.__editorHelper = true;
    this.cameraHelper = helper;
    this.scene.add(helper);

    // Register in objects/meta maps for selection & transform
    this.objects.set(id, cam);
    const meta: SceneObjectData = {
      id,
      name: '🎥 攝影機',
      modelPath: '__camera__',
      position: [cam.position.x, cam.position.y, cam.position.z],
      rotation: [
        THREE.MathUtils.radToDeg(cam.rotation.x),
        THREE.MathUtils.radToDeg(cam.rotation.y),
        THREE.MathUtils.radToDeg(cam.rotation.z),
      ],
      scale: [1, 1, 1],
    };
    this.objectMeta.set(id, meta);
    this.pushHistory();
    if (this.onCameraObjectChange) this.onCameraObjectChange();
    return id;
  }

  removeCameraObject() {
    if (!this.cameraObjectId) return;
    const cam = this.objects.get(this.cameraObjectId);
    if (cam) this.scene.remove(cam);
    if (this.cameraHelper) { this.scene.remove(this.cameraHelper); this.cameraHelper = null; }
    this.objects.delete(this.cameraObjectId);
    this.objectMeta.delete(this.cameraObjectId);
    if (this.selectedId === this.cameraObjectId) this.deselect();
    this.sceneCameraObj = null;
    this.cameraObjectId = null;
    this.disposeCameraObjectPreview();
    this.pushHistory();
    if (this.onCameraObjectChange) this.onCameraObjectChange();
  }

  getSceneCameraObject(): THREE.PerspectiveCamera | null { return this.sceneCameraObj; }

  /** Update scene camera params (called from inspector panel) */
  setCameraFov(fov: number) {
    if (!this.sceneCameraObj) return;
    this.sceneCameraObj.fov = fov;
    this.sceneCameraObj.updateProjectionMatrix();
    if (this.cameraHelper) this.cameraHelper.update();
  }

  setCameraNearFar(near: number, far: number) {
    if (!this.sceneCameraObj) return;
    this.sceneCameraObj.near = near;
    this.sceneCameraObj.far = far;
    this.sceneCameraObj.updateProjectionMatrix();
    if (this.cameraHelper) this.cameraHelper.update();
  }

  getCameraFov(): number { return this.sceneCameraObj?.fov ?? 60; }
  getCameraNear(): number { return this.sceneCameraObj?.near ?? 1; }
  getCameraFar(): number { return this.sceneCameraObj?.far ?? 5000; }
  getCameraAspect(): number { return this.sceneCameraObj?.aspect ?? 16 / 9; }

  setCameraAspect(aspect: number) {
    if (!this.sceneCameraObj) return;
    this.sceneCameraObj.aspect = aspect;
    this.sceneCameraObj.updateProjectionMatrix();
    if (this.cameraHelper) this.cameraHelper.update();
  }

  // Follow target
  setCameraFollowTarget(targetName: string | null) { this.cameraFollowTarget = targetName; }
  getCameraFollowTarget(): string | null { return this.cameraFollowTarget; }

  setCameraFollowOffset(offset: [number, number, number]) { this.cameraFollowOffset.set(...offset); }
  getCameraFollowOffset(): [number, number, number] { return [this.cameraFollowOffset.x, this.cameraFollowOffset.y, this.cameraFollowOffset.z]; }

  setCameraLookOffset(offset: [number, number, number]) { this.cameraLookOffset.set(...offset); }
  getCameraLookOffset(): [number, number, number] { return [this.cameraLookOffset.x, this.cameraLookOffset.y, this.cameraLookOffset.z]; }

  /** Get camera data for export (includes follow settings) */
  getCameraExportData(): SceneData['camera'] | undefined {
    if (!this.cameraObjectId || !this.sceneCameraObj) return undefined;
    const meta = this.objectMeta.get(this.cameraObjectId);
    if (!meta) return undefined;

    // Always read live values from the 3D object to avoid stale meta
    const cam = this.sceneCameraObj;
    const position: [number, number, number] = [cam.position.x, cam.position.y, cam.position.z];
    const rotation: [number, number, number] = [
      THREE.MathUtils.radToDeg(cam.rotation.x),
      THREE.MathUtils.radToDeg(cam.rotation.y),
      THREE.MathUtils.radToDeg(cam.rotation.z),
    ];

    // Also sync meta so it stays consistent
    meta.position = position;
    meta.rotation = rotation;

    const data: SceneData['camera'] = {
      position,
      rotation,
      fov: cam.fov,
      near: cam.near,
      far: cam.far,
      aspect: cam.aspect,
    };
    if (this.cameraFollowTarget) {
      data!.followTarget = this.cameraFollowTarget;
      data!.followOffset = [this.cameraFollowOffset.x, this.cameraFollowOffset.y, this.cameraFollowOffset.z];
      data!.lookOffset = [this.cameraLookOffset.x, this.cameraLookOffset.y, this.cameraLookOffset.z];
    }
    return data;
  }

  /** Restore camera from imported data */
  restoreCameraFromData(camData: NonNullable<SceneData['camera']>) {
    if (this.cameraObjectId) this.removeCameraObject();
    this.addCameraObject();
    if (this.cameraObjectId && this.sceneCameraObj) {
      this.setObjectTransform(this.cameraObjectId, camData.position, camData.rotation, [1, 1, 1]);
      this.setCameraFov(camData.fov ?? 60);
      this.setCameraNearFar(camData.near ?? 1, camData.far ?? 5000);
      if (camData.aspect) this.setCameraAspect(camData.aspect);
      if (camData.followTarget) {
        this.cameraFollowTarget = camData.followTarget;
        this.cameraFollowOffset.set(...(camData.followOffset || [0, 250, 350]));
        this.cameraLookOffset.set(...(camData.lookOffset || [0, 30, 0]));
      } else {
        this.cameraFollowTarget = null;
        this.cameraFollowOffset.set(0, 250, 350);
        this.cameraLookOffset.set(0, 30, 0);
      }
      // Ensure camera helper reflects new transform
      if (this.cameraHelper) this.cameraHelper.update();
    }
    if (this.onCameraObjectChange) this.onCameraObjectChange();
  }

  /** Setup floating preview window for the scene camera */
  setupCameraObjectPreview(canvas: HTMLCanvasElement) {
    this.cameraPreviewCanvas = canvas;
    this.cameraPreviewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.cameraPreviewRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
    this.cameraPreviewRenderer.setPixelRatio(window.devicePixelRatio);
    this.cameraPreviewRenderer.toneMapping = THREE.NoToneMapping;
    this.cameraPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  disposeCameraObjectPreview() {
    this.cameraPreviewRenderer?.dispose();
    this.cameraPreviewRenderer = null;
    this.cameraPreviewCanvas = null;
  }

  /** Called every frame to render camera object preview */
  renderCameraObjectPreview() {
    if (!this.cameraPreviewRenderer || !this.sceneCameraObj) return;

    // Use a temporary quaternion for follow-target lookAt so we don't mutate the scene camera object
    const savedQuat = this.sceneCameraObj.quaternion.clone();

    if (this.cameraFollowTarget) {
      const targetMeta = Array.from(this.objectMeta.values()).find(m => m.name === this.cameraFollowTarget);
      if (targetMeta) {
        const targetObj = this.objects.get(targetMeta.id);
        if (targetObj) {
          this.sceneCameraObj.lookAt(targetObj.position);
        }
      }
    }

    // Temporarily hide the camera helper so it doesn't appear in its own view
    const helperVis = this.cameraHelper?.visible;
    if (this.cameraHelper) this.cameraHelper.visible = false;
    this.cameraPreviewRenderer.render(this.scene, this.sceneCameraObj);
    if (this.cameraHelper && helperVis !== undefined) this.cameraHelper.visible = helperVis;

    // Restore original quaternion
    this.sceneCameraObj.quaternion.copy(savedQuat);
  }

  /** Sync camera helper after transform changes */
  private updateCameraHelper() {
    if (!this.sceneCameraObj || !this.cameraHelper) return;
    this.cameraHelper.update();
  }

  isCameraObject(id: string): boolean {
    return id === this.cameraObjectId;
  }

  dispose() {
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
