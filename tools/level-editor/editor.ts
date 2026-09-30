import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// ========================================
// Types
// ========================================
interface LevelData {
  version: number;
  name: string;
  arena: { width: number; height: number; centerX: number; centerY: number; boundaryRadius: number; groundColor?: string; backgroundImage?: string; boundaryShape?: 'circle' | 'rectangle' | 'capsule'; boundaryWidth?: number; boundaryHeight?: number; capsuleLength?: number; capsuleRadius?: number; capsuleDirection?: 'horizontal' | 'vertical' };
  spawnRules: {
    mode: 'edge_random' | 'fixed_points' | 'mixed';
    maxAlive: number; maxSmall: number; maxBig: number;
    bigChance: number;
    bigDistribution: { zombie_big: number; zombie_bomb: number; zombie_bouncing: number };
    spawnInterval: number; startDelay: number;
  };
  bossConfig: {
    triggerType: 'kill_count' | 'timer' | 'wave';
    triggerValue: number;
    bossType: string;
    spawnPosition: 'center' | 'custom';
    customX: number; customY: number;
  };
  obstacleConfig: { randomCount: number; types: string[]; minDistance: number };
  waves: WaveDef[];
  waveRestTime: number;
  spawnPoints: SpawnPoint[];
  obstacles: ObstacleDef[];
  items: ItemDef[];
  playerSpawns: Array<{ id: string; x: number; y: number }>;
}
interface WaveDef { wave: number; duration: number; smallRate: number; bigRate: number; description: string; triggerBoss?: boolean; }
interface SpawnPoint { id: string; x: number; y: number; zombieType: string; wave: number; count: number; interval: number; maxAlive: number; }
interface ObstacleDef { id: string; x: number; y: number; type: string; radius: number; }
interface ItemDef { id: string; x: number; y: number; type: string; respawnTime: number; }

// ========================================
// Globals
// ========================================
let levelData: LevelData = createDefaultLevel();
let selectedId: string | null = null;
let markers: Map<string, THREE.Mesh> = new Map();
let labels: THREE.Sprite[] = [];
let customNames: Map<string, string> = new Map(); // user-defined display names

function createTextSprite(text: string, color = '#ffffff'): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 32px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(120, 32, 1); // will be overridden by animate()
  return sprite;
}

/** Attach a label as child of a mesh (follows automatically) */
function attachLabel(mesh: THREE.Object3D, text: string, color?: string) {
  const sprite = createTextSprite(text, color);
  sprite.position.set(0, 30, 0); // above the marker
  mesh.add(sprite);
  labels.push(sprite);
}

/** Update label text on a 3D object (used when renaming) */
function updateObjectLabel(id: string) {
  const mesh = markers.get(id);
  if (!mesh) return;
  // Remove old label sprite from mesh children
  const oldSprite = mesh.children.find(c => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
  if (oldSprite) {
    mesh.remove(oldSprite);
    (oldSprite.material as THREE.SpriteMaterial).map?.dispose();
    oldSprite.material.dispose();
    labels = labels.filter(l => l !== oldSprite);
  }
  // Determine display text & color
  let text = '';
  let color = '#ffffff';
  const customName = customNames.get(id);

  if (id.startsWith('ps')) {
    const idx = (levelData.playerSpawns || []).findIndex(p => p.id === id);
    text = customName || `P${idx + 1}`;
    color = '#66aaff';
  } else {
    const sp = levelData.spawnPoints.find(s => s.id === id);
    if (sp) {
      text = customName || `${sp.zombieType.replace("zombie_", "")} W${sp.wave}`;
      color = '#' + (ZOMBIE_COLORS[sp.zombieType] ?? 0x94a3b8).toString(16).padStart(6, '0');
    }
    const ob = levelData.obstacles.find(o => o.id === id);
    if (ob) {
      text = customName || ob.type.replace("obstacle_", "");
      color = '#d4a574';
    }
    const it = levelData.items.find(i => i.id === id);
    if (it) {
      text = customName || it.type.replace("item_", "");
      color = '#22d3ee';
    }
  }

  if (text) attachLabel(mesh, text, color);
}
let bgImageMesh: THREE.Mesh | null = null;

const ZOMBIE_COLORS: Record<string, number> = {
  zombie_small: 0x4ade80, zombie_big: 0xfb923c, zombie_bomb: 0xf87171,
  zombie_bouncing: 0xfbbf24, zombie_golden: 0xfcd34d, zombie_black: 0xa78bfa,
  zombie_boss: 0xdc2626, zombie_car: 0x6b7280,
};
const OBSTACLE_COLOR = 0x8b5a2b;
const ITEM_COLOR = 0x22d3ee;
const PLAYER_COLOR = 0x3b82f6;

// ========================================
// Three.js Setup
// ========================================
const viewport = document.getElementById('viewport')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.OrthographicCamera(-960, 960, 540, -540, 1, 2000);
camera.position.set(0, 500, 0);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableRotate = false; // top-down only
controls.mouseButtons = { LEFT: undefined as any, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
controls.touches = { ONE: undefined as any, TWO: THREE.TOUCH.DOLLY_PAN };

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
dirLight.position.set(100, 500, 100);
scene.add(dirLight);

// Ground
const groundGeo = new THREE.PlaneGeometry(1920, 1080);
const groundMat = new THREE.MeshBasicMaterial({ color: 0x1a3d1a, side: THREE.DoubleSide });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1;
scene.add(ground);

// Grid helper
const gridHelper = new THREE.GridHelper(1920, 20, 0x333333, 0x222222);
scene.add(gridHelper);

// Raycaster for picking
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

// ========================================
// Resize
// ========================================
function resize() {
  const w = viewport.clientWidth;
  const h = viewport.clientHeight;
  renderer.setSize(w, h);
  const aspect = w / h;
  const halfW = 960;
  const halfH = halfW / aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ========================================
// Render Loop
// ========================================
// Selection highlight ring
// ========================================
let highlightRing: THREE.Mesh | null = null;

function createHighlightRing(): THREE.Mesh {
  const geo = new THREE.RingGeometry(28, 34, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff, transparent: true, opacity: 1.0, side: THREE.DoubleSide, depthTest: false });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 5;
  ring.renderOrder = 999;
  return ring;
}

function updateHighlight() {
  // Remove old ring from previous parent
  if (highlightRing && highlightRing.parent) {
    highlightRing.parent.remove(highlightRing);
  }

  if (!selectedId || selectedId === '__boundary' || selectedId === '__scene_settings') {
    return;
  }

  const mesh = markers.get(selectedId);
  if (!mesh) return;

  if (!highlightRing) highlightRing = createHighlightRing();

  // Scale ring to match object size
  const type = mesh.userData.type;
  let ringScale = 1.0;
  if (type === 'playerSpawn') ringScale = 1.0;
  else if (type === 'spawnPoint') ringScale = 0.85;
  else if (type === 'obstacle') {
    const ob = levelData.obstacles.find(o => o.id === selectedId);
    ringScale = ob ? ob.radius / 30 : 1.0;
  }
  else if (type === 'item') ringScale = 0.75;

  highlightRing.scale.set(ringScale, ringScale, ringScale);
  (highlightRing as any)._baseScale = ringScale;
  highlightRing.position.y = type === 'obstacle' || type === 'item' ? 12 : 5;
  mesh.add(highlightRing);
}

// ========================================
// Render Loop
// ========================================
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Keep labels at constant screen size regardless of zoom
  // Calculate world-units-per-pixel ratio
  const worldPerPx = (camera.right - camera.left) / renderer.domElement.clientWidth;
  // Target label size in screen pixels: ~120px wide, ~32px tall
  const labelW = worldPerPx * 120;
  const labelH = worldPerPx * 32;
  const labelOffsetY = worldPerPx * 24; // offset above marker in screen px
  for (const label of labels) {
    label.scale.set(labelW, labelH, 1);
    label.position.set(0, labelOffsetY, 0);
  }

  // Breathing pulse on highlight ring + label
  if (selectedId && selectedId !== '__boundary' && highlightRing && highlightRing.parent) {
    const t = performance.now() * 0.004;
    const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t)); // 0.4~1.0
    const ringMat = highlightRing.material as THREE.MeshBasicMaterial;
    ringMat.opacity = pulse;
    // Breathing scale on ring (use userData to store base)
    const base = (highlightRing as any)._baseScale ?? 1.0;
    const breathScale = base * (1.0 + 0.1 * Math.sin(t));
    highlightRing.scale.setScalar(breathScale);

    // Pulse the label more aggressively (opacity 0.15~1.0 + scale boost)
    const mesh = markers.get(selectedId);
    if (mesh) {
      const labelSprite = mesh.children.find(c => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (labelSprite) {
        const labelPulse = 0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t)); // 0.15~1.0
        (labelSprite.material as THREE.SpriteMaterial).opacity = labelPulse;
        // Scale label slightly larger at peak brightness
        const labelScale = 1.0 + 0.15 * (0.5 + 0.5 * Math.sin(t)); // 1.0~1.15
        const lw = worldPerPx * 120 * labelScale;
        const lh = worldPerPx * 32 * labelScale;
        labelSprite.scale.set(lw, lh, 1);
      }
    }
  }

  renderer.render(scene, camera);
}
animate();

// ========================================
// Level Data → Scene
// ========================================
function rebuildScene() {
  // Clear existing markers
  for (const [, mesh] of markers) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  markers.clear();
  // Clear labels
  for (const label of labels) { scene.remove(label); (label.material as THREE.SpriteMaterial).map?.dispose(); label.material.dispose(); }
  labels = [];

  // Arena boundary
  const shape = levelData.arena.boundaryShape || 'circle';
  let boundaryMesh: THREE.Mesh | THREE.Line;

  if (shape === 'circle') {
    const r = levelData.arena.boundaryRadius || 480;
    const boundaryGeo = new THREE.RingGeometry(r - 3, r, 64);
    const boundaryMat = new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
    boundaryMesh = new THREE.Mesh(boundaryGeo, boundaryMat);
    boundaryMesh.rotation.x = -Math.PI / 2;
    boundaryMesh.position.set(0, 0.5, 0);
  } else if (shape === 'rectangle') {
    const w = levelData.arena.boundaryWidth || 1600;
    const h = levelData.arena.boundaryHeight || 900;
    const points = [
      new THREE.Vector3(-w/2, 0.5, -h/2), new THREE.Vector3(w/2, 0.5, -h/2),
      new THREE.Vector3(w/2, 0.5, h/2), new THREE.Vector3(-w/2, 0.5, h/2),
      new THREE.Vector3(-w/2, 0.5, -h/2),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.6, linewidth: 2 });
    boundaryMesh = new THREE.Line(geo, mat);
  } else {
    // Capsule
    const len = levelData.arena.capsuleLength || 800;
    const r = levelData.arena.capsuleRadius || 400;
    const dir = levelData.arena.capsuleDirection || 'horizontal';
    const segments = 32;
    const points: THREE.Vector3[] = [];

    if (dir === 'horizontal') {
      // Top straight line (left to right)
      // Right semicircle (top to bottom)
      for (let i = 0; i <= segments; i++) {
        const a = -Math.PI / 2 + (i / segments) * Math.PI;
        points.push(new THREE.Vector3(len/2 + Math.cos(a) * r, 0.5, Math.sin(a) * r));
      }
      // Left semicircle (bottom to top)
      for (let i = 0; i <= segments; i++) {
        const a = Math.PI / 2 + (i / segments) * Math.PI;
        points.push(new THREE.Vector3(-len/2 + Math.cos(a) * r, 0.5, Math.sin(a) * r));
      }
      points.push(points[0].clone()); // close
    } else {
      // Right straight line (top to bottom)
      // Bottom semicircle (right to left)
      for (let i = 0; i <= segments; i++) {
        const a = 0 + (i / segments) * Math.PI;
        points.push(new THREE.Vector3(Math.cos(a) * r, 0.5, len/2 + Math.sin(a) * r));
      }
      // Top semicircle (left to right)
      for (let i = 0; i <= segments; i++) {
        const a = Math.PI + (i / segments) * Math.PI;
        points.push(new THREE.Vector3(Math.cos(a) * r, 0.5, -len/2 + Math.sin(a) * r));
      }
      points.push(points[0].clone());
    }
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.6, linewidth: 2 });
    boundaryMesh = new THREE.Line(geo, mat);
  }
  boundaryMesh.userData.id = '__boundary';
  scene.add(boundaryMesh);
  markers.set('__boundary', boundaryMesh as any);

  // Player spawns (multiple) — ensure data array exists
  if (!levelData.playerSpawns || levelData.playerSpawns.length === 0) {
    levelData.playerSpawns = [{ id: 'ps1', x: 960, y: 540 }];
  }
  const spawns = levelData.playerSpawns;
  for (const ps of spawns) {
    const playerGeo = new THREE.CylinderGeometry(25, 25, 5, 16);
    const playerMat = new THREE.MeshBasicMaterial({ color: PLAYER_COLOR, transparent: true, opacity: 0.8 });
    (playerMat as any).userData = { baseOpacity: 0.8 };
    const playerMesh = new THREE.Mesh(playerGeo, playerMat);
    playerMesh.position.set(ps.x - 960, 2, ps.y - 540);
    playerMesh.userData.id = ps.id;
    playerMesh.userData.type = 'playerSpawn';
    scene.add(playerMesh);
    markers.set(ps.id, playerMesh);
    const pLabel = customNames.get(ps.id) || `P${spawns.indexOf(ps) + 1}`;
    attachLabel(playerMesh, pLabel, "#66aaff");
  }

  // Spawn points
  for (const sp of levelData.spawnPoints) {
    const color = ZOMBIE_COLORS[sp.zombieType] ?? 0x94a3b8;
    const geo = new THREE.CylinderGeometry(20, 20, 4, 8);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7 });
    (mat as any).userData = { baseOpacity: 0.7 };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(sp.x - 960, 2, sp.y - 540);
    mesh.userData.id = sp.id;
    mesh.userData.type = 'spawnPoint';
    scene.add(mesh);
    markers.set(sp.id, mesh);
    const spLabel = customNames.get(sp.id) || `${sp.zombieType.replace("zombie_", "")} W${sp.wave}`;
    attachLabel(mesh, spLabel, "#" + (ZOMBIE_COLORS[sp.zombieType] ?? 0x94a3b8).toString(16).padStart(6, "0"));
  }

  // Obstacles
  for (const ob of levelData.obstacles) {
    const geo = new THREE.CylinderGeometry(ob.radius, ob.radius, 20, 12);
    const mat = new THREE.MeshBasicMaterial({ color: OBSTACLE_COLOR, transparent: true, opacity: 0.8 });
    (mat as any).userData = { baseOpacity: 0.8 };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ob.x - 960, 10, ob.y - 540);
    mesh.userData.id = ob.id;
    mesh.userData.type = 'obstacle';
    scene.add(mesh);
    markers.set(ob.id, mesh);
    const obLabel = customNames.get(ob.id) || ob.type.replace("obstacle_", "");
    attachLabel(mesh, obLabel, "#d4a574");
  }

  // Items
  for (const it of levelData.items) {
    const geo = new THREE.BoxGeometry(20, 20, 20);
    const mat = new THREE.MeshBasicMaterial({ color: ITEM_COLOR, transparent: true, opacity: 0.7 });
    (mat as any).userData = { baseOpacity: 0.7 };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(it.x - 960, 10, it.y - 540);
    mesh.userData.id = it.id;
    mesh.userData.type = 'item';
    scene.add(mesh);
    markers.set(it.id, mesh);
    const itLabel = customNames.get(it.id) || it.type.replace("item_", "");
    attachLabel(mesh, itLabel, "#22d3ee");
  }

  refreshObjectList();
  setStatus(`場景已載入：${levelData.spawnPoints.length} 出怪點, ${levelData.obstacles.length} 障礙物, ${levelData.items.length} 道具`);
}

// ========================================
// Object List
// ========================================
const objectList = document.getElementById('object-list')!;

function refreshObjectList() {
  objectList.innerHTML = '';
  // Scene settings (always first, cannot delete)
  addListItem('__scene_settings', '⚙️ 場景設定');
  // Player spawns
  for (let i = 0; i < (levelData.playerSpawns || []).length; i++) {
    const ps = levelData.playerSpawns[i];
    const defaultLabel = `🎮 玩家出生點 ${i + 1}`;
    addListItem(ps.id, customNames.get(ps.id) || defaultLabel);
  }
  // Spawn points
  for (const sp of levelData.spawnPoints) {
    const emoji = '🧟';
    const defaultLabel = `${emoji} ${sp.zombieType.replace('zombie_', '')} (波${sp.wave})`;
    addListItem(sp.id, customNames.get(sp.id) || defaultLabel);
  }
  // Obstacles
  for (const ob of levelData.obstacles) {
    const defaultLabel = `🧱 ${ob.type.replace('obstacle_', '')}`;
    addListItem(ob.id, customNames.get(ob.id) || defaultLabel);
  }
  // Items
  for (const it of levelData.items) {
    const defaultLabel = `💎 ${it.type.replace('item_', '')}`;
    addListItem(it.id, customNames.get(it.id) || defaultLabel);
  }
}

function addListItem(id: string, label: string) {
  const li = document.createElement('li');
  const displayName = customNames.get(id) || label;
  li.dataset.id = id;
  if (id === selectedId) li.classList.add('selected');

  // Text span
  const textSpan = document.createElement('span');
  textSpan.textContent = displayName;
  textSpan.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
  li.appendChild(textSpan);

  // Rename button (not for scene settings)
  if (id !== '__scene_settings') {
    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✏️';
    renameBtn.title = '改名';
    renameBtn.style.cssText = 'background:none; border:none; cursor:pointer; font-size:10px; padding:0 2px; opacity:0.5; flex-shrink:0;';
    renameBtn.addEventListener('mouseenter', () => renameBtn.style.opacity = '1');
    renameBtn.addEventListener('mouseleave', () => renameBtn.style.opacity = '0.5');
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(li, id, label);
    });
    li.appendChild(renameBtn);
  }

  li.style.cssText += 'display:flex; align-items:center; gap:2px;';
  li.addEventListener('click', () => selectObject(id));
  objectList.appendChild(li);
}

function startRename(li: HTMLElement, id: string, defaultLabel: string) {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = customNames.get(id) || defaultLabel;
  input.style.cssText = 'width:100%; font-size:11px; padding:2px 4px; background:#0f3460; color:#e0e0e0; border:1px solid #4fc3f7; border-radius:3px; box-sizing:border-box;';
  li.innerHTML = '';
  li.appendChild(input);
  input.focus();
  input.select();

  const commit = () => {
    const newName = input.value.trim();
    if (newName && newName !== defaultLabel) {
      customNames.set(id, newName);
    } else if (!newName || newName === defaultLabel) {
      customNames.delete(id);
    }
    updateObjectLabel(id);
    refreshObjectList();
  };
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (ke) => {
    if (ke.key === 'Enter') { input.blur(); }
    if (ke.key === 'Escape') { input.value = defaultLabel; input.blur(); }
  });
}

// ========================================
// Selection & Properties
// ========================================
function selectObject(id: string | null) {
  // Restore previous selected label opacity
  if (selectedId && selectedId !== '__boundary') {
    const prevMesh = markers.get(selectedId);
    if (prevMesh) {
      const labelSprite = prevMesh.children.find(c => c instanceof THREE.Sprite) as THREE.Sprite | undefined;
      if (labelSprite) {
        (labelSprite.material as THREE.SpriteMaterial).opacity = 1.0;
      }
    }
  }

  selectedId = id;
  refreshObjectList();
  // Show/hide appropriate panels
  const propsSection = document.getElementById('props-section')!;
  const sceneSettings = document.getElementById('scene-settings-section');
  if (id === '__scene_settings') {
    propsSection.style.display = 'none';
    if (sceneSettings) sceneSettings.style.display = '';
  } else {
    if (sceneSettings) sceneSettings.style.display = 'none';
    showProperties(id);
  }
  // Update highlight ring
  updateHighlight();
}

function showProperties(id: string | null) {
  const section = document.getElementById('props-section')!;
  const title = document.getElementById('props-title')!;
  const content = document.getElementById('props-content')!;
  if (!id) { section.style.display = 'none'; return; }
  section.style.display = '';

  if (id.startsWith('ps')) {
    const ps = levelData.playerSpawns?.find(p => p.id === id);
    if (ps) {
      title.textContent = '🎮 玩家出生點';
      content.innerHTML = `
        <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${ps.x}" /></div>
        <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${ps.y}" /></div>
      `;
      bindInput('p-x', (v) => { ps.x = v; updateMarkerPos(id); });
      bindInput('p-y', (v) => { ps.y = v; updateMarkerPos(id); });
      return;
    }
  }

  if (id === '__player') {
    // Legacy single player spawn (backward compat)
    title.textContent = '🎮 玩家出生點';
    content.innerHTML = `<p class="hint">使用新的多玩家出生點系統</p>`;
    return;
  }

  const sp = levelData.spawnPoints.find(s => s.id === id);
  if (sp) {
    title.textContent = '🧟 出怪點';
    content.innerHTML = `
      <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${sp.x}" /></div>
      <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${sp.y}" /></div>
      <div class="prop-row"><label>殭屍類型</label><select id="p-ztype">
        <option value="zombie_small" ${sp.zombieType==='zombie_small'?'selected':''}>小殭屍</option>
        <option value="zombie_big" ${sp.zombieType==='zombie_big'?'selected':''}>大殭屍</option>
        <option value="zombie_bomb" ${sp.zombieType==='zombie_bomb'?'selected':''}>炸彈</option>
        <option value="zombie_bouncing" ${sp.zombieType==='zombie_bouncing'?'selected':''}>彈跳</option>
        <option value="zombie_golden" ${sp.zombieType==='zombie_golden'?'selected':''}>黃金</option>
        <option value="zombie_black" ${sp.zombieType==='zombie_black'?'selected':''}>黑暗</option>
        <option value="zombie_boss" ${sp.zombieType==='zombie_boss'?'selected':''}>Boss</option>
      </select></div>
      <div class="prop-row"><label>波次</label><input type="number" id="p-wave" value="${sp.wave}" min="1" /></div>
      <div class="prop-row"><label>數量</label><input type="number" id="p-count" value="${sp.count}" min="1" /></div>
      <div class="prop-row"><label>間隔(秒)</label><input type="number" id="p-interval" value="${sp.interval}" step="0.5" /></div>
      <div class="prop-row"><label>同時上限</label><input type="number" id="p-max" value="${sp.maxAlive}" min="1" /></div>
    `;
    bindInput('p-x', (v) => { sp.x = v; updateMarkerPos(id); });
    bindInput('p-y', (v) => { sp.y = v; updateMarkerPos(id); });
    bindSelect('p-ztype', (v) => { sp.zombieType = v; rebuildScene(); selectObject(id); });
    bindInput('p-wave', (v) => { sp.wave = v; refreshObjectList(); });
    bindInput('p-count', (v) => sp.count = v);
    bindInput('p-interval', (v) => sp.interval = v);
    bindInput('p-max', (v) => sp.maxAlive = v);
    return;
  }

  const ob = levelData.obstacles.find(o => o.id === id);
  if (ob) {
    title.textContent = '🧱 障礙物';
    content.innerHTML = `
      <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${ob.x}" /></div>
      <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${ob.y}" /></div>
      <div class="prop-row"><label>類型</label><select id="p-otype">
        <option value="obstacle_barrel" ${ob.type==='obstacle_barrel'?'selected':''}>木桶</option>
        <option value="fire_chest" ${ob.type==='fire_chest'?'selected':''}>火屬性寶箱</option>
      </select></div>
      <div class="prop-row"><label>半徑</label><input type="number" id="p-radius" value="${ob.radius}" /></div>
    `;
    bindInput('p-x', (v) => { ob.x = v; updateMarkerPos(id); });
    bindInput('p-y', (v) => { ob.y = v; updateMarkerPos(id); });
    bindSelect('p-otype', (v) => ob.type = v);
    bindInput('p-radius', (v) => { ob.radius = v; rebuildScene(); selectObject(id); });
    return;
  }

  const it = levelData.items.find(i => i.id === id);
  if (it) {
    title.textContent = '💎 道具';
    content.innerHTML = `
      <div class="prop-row"><label>X</label><input type="number" id="p-x" value="${it.x}" /></div>
      <div class="prop-row"><label>Y</label><input type="number" id="p-y" value="${it.y}" /></div>
      <div class="prop-row"><label>類型</label><select id="p-itype">
        <option value="item_crate" ${it.type==='item_crate'?'selected':''}>補給箱</option>
        <option value="item_ticket" ${it.type==='item_ticket'?'selected':''}>抽獎券</option>
        <option value="item_key" ${it.type==='item_key'?'selected':''}>鑰匙</option>
      </select></div>
      <div class="prop-row"><label>重生(秒)</label><input type="number" id="p-respawn" value="${it.respawnTime}" /></div>
    `;
    bindInput('p-x', (v) => { it.x = v; updateMarkerPos(id); });
    bindInput('p-y', (v) => { it.y = v; updateMarkerPos(id); });
    bindSelect('p-itype', (v) => it.type = v);
    bindInput('p-respawn', (v) => it.respawnTime = v);
    return;
  }
}

function updateMarkerPos(id: string) {
  const mesh = markers.get(id);
  if (!mesh) return;
  const ps = levelData.playerSpawns?.find(p => p.id === id);
  if (ps) { mesh.position.set(ps.x - 960, 2, ps.y - 540); return; }
  const sp = levelData.spawnPoints.find(s => s.id === id);
  if (sp) { mesh.position.set(sp.x - 960, 2, sp.y - 540); return; }
  const ob = levelData.obstacles.find(o => o.id === id);
  if (ob) { mesh.position.set(ob.x - 960, 10, ob.y - 540); return; }
  const it = levelData.items.find(i => i.id === id);
  if (it) { mesh.position.set(it.x - 960, 10, it.y - 540); return; }
}

function bindInput(elId: string, cb: (v: number) => void) {
  const el = document.getElementById(elId) as HTMLInputElement;
  if (!el) return;
  el.addEventListener('change', () => cb(parseFloat(el.value) || 0));
}
function bindSelect(elId: string, cb: (v: string) => void) {
  const el = document.getElementById(elId) as HTMLSelectElement;
  if (!el) return;
  el.addEventListener('change', () => cb(el.value));
}

// ========================================
// Picking & Drag (unified pointer handling)
// ========================================
let dragging = false;
let dragStarted = false;
let pointerDownPos = { x: 0, y: 0 };

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  pointerDownPos = { x: e.clientX, y: e.clientY };
  dragStarted = false;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  // Check what we're clicking on
  const meshes = Array.from(markers.values());
  const hits = raycaster.intersectObjects(meshes, false);
  const hitId = hits.length > 0 ? hits[0].object.userData.id : null;

  if (hitId && hitId !== '__boundary') {
    // Select this object
    selectObject(hitId);
    // Prepare for potential drag
    dragStarted = true;
    controls.enabled = false;
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragStarted) return;
  // Only start actual drag after moving a few pixels (prevents accidental drag on click)
  const dx = e.clientX - pointerDownPos.x;
  const dy = e.clientY - pointerDownPos.y;
  if (!dragging && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    dragging = true;
  }
  if (!dragging || !selectedId) return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const pt = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, pt);
  if (pt) {
    const gameX = Math.round(pt.x + 960);
    const gameY = Math.round(pt.z + 540);
    const ps = levelData.playerSpawns?.find(p => p.id === selectedId); if (ps) { ps.x = gameX; ps.y = gameY; }
    const sp = levelData.spawnPoints.find(s => s.id === selectedId);
    if (sp) { sp.x = gameX; sp.y = gameY; }
    const ob = levelData.obstacles.find(o => o.id === selectedId);
    if (ob) { ob.x = gameX; ob.y = gameY; }
    const it = levelData.items.find(i => i.id === selectedId);
    if (it) { it.x = gameX; it.y = gameY; }
    updateMarkerPos(selectedId);
    showProperties(selectedId);
  }
});

renderer.domElement.addEventListener('pointerup', (e) => {
  if (e.button !== 0) return;
  if (dragStarted && !dragging) {
    // It was just a click (no drag movement)
    // Selection already happened in pointerdown
    // If clicked empty space, deselect
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const meshes = Array.from(markers.values());
    const hits = raycaster.intersectObjects(meshes, false);
    const hitId = hits.length > 0 ? hits[0].object.userData.id : null;
    if (!hitId || hitId === '__boundary') {
      selectObject(null);
    }
  }
  dragging = false;
  dragStarted = false;
  controls.enabled = true;
});

// Also handle click on empty space to deselect
renderer.domElement.addEventListener('click', (e) => {
  // Only deselect if no drag happened and nothing was hit in pointerdown
  // (handled by pointerup above)
});

// ========================================
// Toolbar Actions
// ========================================
document.getElementById('btn-add-spawn')!.addEventListener('click', () => {
  const id = 'sp_' + Date.now();
  levelData.spawnPoints.push({ id, x: 960, y: 540, zombieType: 'zombie_small', wave: 1, count: 1, interval: 2, maxAlive: 5 });
  rebuildScene();
  selectObject(id);
});

document.getElementById('btn-add-obstacle')!.addEventListener('click', () => {
  const id = 'ob_' + Date.now();
  levelData.obstacles.push({ id, x: 960, y: 540, type: 'obstacle_barrel', radius: 30 });
  rebuildScene();
  selectObject(id);
});

document.getElementById('btn-add-item')!.addEventListener('click', () => {
  const id = 'it_' + Date.now();
  levelData.items.push({ id, x: 960, y: 540, type: 'item_crate', respawnTime: 15 });
  rebuildScene();
  selectObject(id);
});

document.getElementById('btn-add-player')!.addEventListener('click', () => {
  if (!levelData.playerSpawns) levelData.playerSpawns = [];
  const id = 'ps' + (levelData.playerSpawns.length + 1);
  levelData.playerSpawns.push({ id, x: 960 + levelData.playerSpawns.length * 60, y: 540 });
  rebuildScene();
  selectObject(id);
});

document.getElementById('btn-delete')!.addEventListener('click', () => {
  if (!selectedId || selectedId === '__boundary' || selectedId === '__scene_settings') return;
  if (!confirm('確定刪除？')) return;
  levelData.playerSpawns = (levelData.playerSpawns || []).filter(p => p.id !== selectedId);
  levelData.spawnPoints = levelData.spawnPoints.filter(s => s.id !== selectedId);
  levelData.obstacles = levelData.obstacles.filter(o => o.id !== selectedId);
  levelData.items = levelData.items.filter(i => i.id !== selectedId);
  selectObject(null);
  rebuildScene();
});

document.getElementById('btn-new')!.addEventListener('click', () => {
  if (!confirm('建立新關卡？未存檔的變更將遺失。')) return;
  levelData = createDefaultLevel();
  rebuildScene();
  selectObject(null);
});

// Delete key shortcut
window.addEventListener('keydown', (e) => {
  if (e.key === 'Delete' && selectedId && selectedId !== '__boundary' && selectedId !== '__scene_settings') {
    if (confirm('確定刪除？')) {
      levelData.playerSpawns = (levelData.playerSpawns || []).filter(p => p.id !== selectedId);
      levelData.spawnPoints = levelData.spawnPoints.filter(s => s.id !== selectedId);
      levelData.obstacles = levelData.obstacles.filter(o => o.id !== selectedId);
      levelData.items = levelData.items.filter(i => i.id !== selectedId);
      selectObject(null);
      rebuildScene();
    }
  }
});

// ========================================
// 存檔直達磁碟（dev server 中介，見 vite.config.ts）
// ========================================
const API_BASE = '/__api';

/** 遊戲讀哪個場景，這裡就寫哪個（GameEngine 預設讀 default，可用 ?scene=xxx 換） */
let targetSceneName = localStorage.getItem('lv_target_scene') || 'default';

async function postJson(url: string, body: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, path: data.path };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 工作檔內容（含編輯器專用欄位） */
function buildWorkData(): any {
  const saveData: any = { ...levelData };
  if (customNames.size > 0) {
    saveData.customNames = Object.fromEntries(customNames);
  }
  return saveData;
}

// Save
document.getElementById('btn-save')!.addEventListener('click', async () => {
  // Sync UI values back to data
  saveConfigFromUI();

  const saveData = buildWorkData();

  const json = JSON.stringify(saveData, null, 2);
  const sceneJson = JSON.stringify(buildSceneData(), null, 2);

  // 先走 dev server：工作檔與遊戲場景檔一起落到專案正確位置
  const levelRes = await postJson(`${API_BASE}/save-level`, json);
  if (levelRes.ok) {
    const sceneRes = await postJson(
      `${API_BASE}/save-scene?name=${encodeURIComponent(targetSceneName)}`,
      sceneJson,
    );
    if (sceneRes.ok) {
      setStatus(`✅ 已存檔：${levelRes.path} ＋ ${sceneRes.path}（重跑遊戲即可看到）`);
    } else {
      setStatus(`⚠️ 工作檔已存（${levelRes.path}），但遊戲場景寫入失敗：${sceneRes.error}`);
    }
    return;
  }

  // dev server 不在（例如開的是 build 後的靜態頁）才退回瀏覽器存檔
  setStatus(`⚠️ 無法寫入專案（${levelRes.error}），改用瀏覽器存檔`);
  const blob = new Blob([json], { type: 'application/json' });

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${levelData.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}.json`,
        types: [{ description: 'Level JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`✅ 已存檔：${levelData.name}`);
    } catch (e: any) {
      if (e.name !== 'AbortError') alert('存檔失敗：' + e.message);
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'level.json'; a.click();
    URL.revokeObjectURL(url);
    setStatus('✅ 已下載 level.json');
  }
});

// ========================================
// Export to Game Format (.douqi.json)
// ========================================

/** level-editor v2 格式 → 遊戲吃的 .douqi.json 格式 */
function buildSceneData(): any {
  const arena = levelData.arena;
  const shape = arena.boundaryShape || 'circle';

  // Build arena bounds
  let bounds: any = { shape };
  if (shape === 'capsule') {
    const len = arena.capsuleLength || 800;
    const r = arena.capsuleRadius || 400;
    const cx = arena.centerX ?? 960;
    const cy = arena.centerY ?? 540;
    bounds.capsuleLeftX = cx - len / 2;
    bounds.capsuleRightX = cx + len / 2;
    bounds.capsuleRadius = r;
    bounds.centerY = cy;
  } else if (shape === 'circle') {
    bounds.radius = arena.boundaryRadius || 480;
    bounds.center = [arena.centerX ?? 960, arena.centerY ?? 540, 0];
  } else if (shape === 'rectangle') {
    bounds.width = arena.boundaryWidth || 1600;
    bounds.height = arena.boundaryHeight || 900;
    bounds.center = [arena.centerX ?? 960, arena.centerY ?? 540, 0];
  }

  // Player spawns
  const playerSpawns = (levelData.playerSpawns || []).map((ps, i) => ({
    id: ps.id,
    position: [ps.x, ps.y, 0] as [number, number, number],
    label: customNames.get(ps.id) || `P${i + 1}`,
  }));

  // Obstacles → fixed mode
  const fixedObstacles = levelData.obstacles.map(ob => ({
    id: ob.id,
    position: [ob.x, ob.y, 0] as [number, number, number],
    size: [ob.radius * 2, ob.radius * 2] as [number, number],
    durability: 5,
  }));

  // Spawn points
  const spawnPoints = levelData.spawnPoints.map(sp => ({
    id: sp.id,
    position: [sp.x, sp.y, 0] as [number, number, number],
    zombieType: sp.zombieType,
    spawnConfig: {
      wave: sp.wave,
      count: sp.count,
      interval: sp.interval,
      maxAlive: sp.maxAlive,
    },
  }));

  // Items → itemZones
  const itemZones = levelData.items.map(it => ({
    id: it.id,
    position: [it.x, it.y, 0] as [number, number, number],
    radius: 30,
    itemType: it.type,
    respawnTime: it.respawnTime,
  }));

  // Build the .douqi.json
  const gameData = {
    version: 1,
    name: levelData.name,
    description: `由關卡編輯器匯出`,
    arena: {
      type: shape,
      bounds,
      canvas: { width: arena.width || 1920, height: arena.height || 1080 },
    },
    playerSpawns,
    launchPadZones: [],
    obstacles: {
      mode: fixedObstacles.length > 0 ? 'fixed' : 'random',
      count: fixedObstacles.length || (levelData.obstacleConfig?.randomCount ?? 3),
      sizeRange: { minW: 75, maxW: 115, minH: 75, maxH: 115 },
      constraints: {
        minDistFromSpawn: 350,
        minDistFromLaunchPad: 220,
        minDistBetween: 100,
        mustBeInsideArena: true,
        arenaMargin: 40,
      },
      fixed: fixedObstacles,
    },
    spawnPoints,
    itemZones,
    camera: {
      position: [arena.centerX ?? 960, arena.centerY ?? 540, 0],
      zoom: 1.0,
      followTarget: 'center',
    },
    // Extended fields for future SpawnSystem integration
    _levelEditor: {
      spawnRules: levelData.spawnRules,
      bossConfig: levelData.bossConfig,
      waves: levelData.waves,
      waveRestTime: levelData.waveRestTime,
    },
  };

  return gameData;
}

/**
 * 遊戲場景 .douqi.json → level-editor v2 格式（buildSceneData 的反向）
 * base 提供場景檔沒有的編輯器專用欄位（背景圖、障礙物種類、obstacleConfig）。
 */
function sceneToLevelData(scene: any, base: LevelData): LevelData {
  const out: LevelData = JSON.parse(JSON.stringify(base));

  if (typeof scene.name === 'string') out.name = scene.name;

  const b = scene.arena?.bounds;
  if (b?.shape) {
    out.arena.boundaryShape = b.shape;
    if (b.shape === 'capsule' && b.capsuleLeftX != null && b.capsuleRightX != null) {
      out.arena.capsuleLength = b.capsuleRightX - b.capsuleLeftX;
      out.arena.capsuleRadius = b.capsuleRadius ?? out.arena.capsuleRadius;
      out.arena.centerX = (b.capsuleLeftX + b.capsuleRightX) / 2;
      out.arena.centerY = b.centerY ?? out.arena.centerY;
    } else if (b.shape === 'circle') {
      out.arena.boundaryRadius = b.radius ?? out.arena.boundaryRadius;
      if (Array.isArray(b.center)) { out.arena.centerX = b.center[0]; out.arena.centerY = b.center[1]; }
    } else if (b.shape === 'rectangle') {
      out.arena.boundaryWidth = b.width ?? out.arena.boundaryWidth;
      out.arena.boundaryHeight = b.height ?? out.arena.boundaryHeight;
      if (Array.isArray(b.center)) { out.arena.centerX = b.center[0]; out.arena.centerY = b.center[1]; }
    }
  }
  if (scene.arena?.canvas) {
    out.arena.width = scene.arena.canvas.width ?? out.arena.width;
    out.arena.height = scene.arena.canvas.height ?? out.arena.height;
  }

  if (Array.isArray(scene.playerSpawns)) {
    out.playerSpawns = scene.playerSpawns.map((ps: any) => ({
      id: ps.id, x: ps.position[0], y: ps.position[1],
    }));
    // 場景的 label 若不是預設 P1/P2…，視為使用者自訂名稱
    scene.playerSpawns.forEach((ps: any, i: number) => {
      if (ps.label && ps.label !== `P${i + 1}`) customNames.set(ps.id, ps.label);
    });
  }

  // 場景檔沒有障礙物種類，沿用工作檔同 id 的設定，找不到就給預設
  const typeById = new Map((base.obstacles || []).map(o => [o.id, o.type] as const));
  if (Array.isArray(scene.obstacles?.fixed)) {
    out.obstacles = scene.obstacles.fixed.map((ob: any) => ({
      id: ob.id,
      x: ob.position[0],
      y: ob.position[1],
      type: typeById.get(ob.id) ?? 'obstacle_barrel',
      radius: (ob.size?.[0] ?? 60) / 2,
    }));
  }

  if (Array.isArray(scene.spawnPoints)) {
    out.spawnPoints = scene.spawnPoints.map((sp: any) => ({
      id: sp.id,
      x: sp.position[0],
      y: sp.position[1],
      zombieType: sp.zombieType,
      wave: sp.spawnConfig?.wave ?? 1,
      count: sp.spawnConfig?.count ?? 1,
      interval: sp.spawnConfig?.interval ?? 2,
      maxAlive: sp.spawnConfig?.maxAlive ?? 5,
    }));
  }

  if (Array.isArray(scene.itemZones)) {
    out.items = scene.itemZones.map((iz: any) => ({
      id: iz.id,
      x: iz.position[0],
      y: iz.position[1],
      type: iz.itemType,
      respawnTime: iz.respawnTime,
    }));
  }

  const le = scene._levelEditor;
  if (le) {
    if (le.spawnRules) out.spawnRules = le.spawnRules;
    if (le.bossConfig) out.bossConfig = le.bossConfig;
    if (Array.isArray(le.waves)) out.waves = le.waves;
    if (le.waveRestTime != null) out.waveRestTime = le.waveRestTime;
  }

  return out;
}

document.getElementById('btn-export-game')!.addEventListener('click', async () => {
  saveConfigFromUI();
  const gameData = buildSceneData();

  const json = JSON.stringify(gameData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  if ('showSaveFilePicker' in window) {
    try {
      const safeName = levelData.name.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${safeName}.douqi.json`,
        types: [{ description: 'SpinningTop Scene', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus(`🎮 已匯出遊戲格式：${safeName}.spinningtop.json`);
    } catch (e: any) {
      if (e.name !== 'AbortError') alert('匯出失敗：' + e.message);
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${levelData.name.replace(/[^a-zA-Z0-9_\-]/g, '_')}.spinningtop.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('🎮 已下載 .spinningtop.json');
  }
});

// Load
const fileInput = document.getElementById('file-input') as HTMLInputElement;
document.getElementById('btn-load')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    // Restore custom names if present
    if (parsed.customNames) {
      customNames = new Map(Object.entries(parsed.customNames));
      delete parsed.customNames;
    } else {
      customNames.clear();
    }
    levelData = parsed;
    loadConfigToUI();
    rebuildScene();
    selectObject(null);
    setStatus(`✅ 已載入：${file.name}`);
  } catch { alert('載入失敗：檔案格式不正確'); }
  fileInput.value = '';
});

// ========================================
// Utils
// ========================================
function createDefaultLevel(): LevelData {
  return {
    version: 2, name: '新關卡',
    arena: { width: 1920, height: 1080, centerX: 960, centerY: 540, boundaryRadius: 480, groundColor: '#2d5a27' },
    spawnRules: {
      mode: 'edge_random', maxAlive: 26, maxSmall: 20, maxBig: 6,
      bigChance: 0.3, bigDistribution: { zombie_big: 50, zombie_bomb: 33, zombie_bouncing: 17 },
      spawnInterval: 1.5, startDelay: 2.0,
    },
    bossConfig: { triggerType: 'kill_count', triggerValue: 80, bossType: 'zombie_boss', spawnPosition: 'center', customX: 960, customY: 540 },
    obstacleConfig: { randomCount: 3, types: ['obstacle_barrel', 'fire_chest'], minDistance: 100 },
    waves: [
      { wave: 1, duration: 30, smallRate: 1.5, bigRate: 0, description: '暖身波' },
      { wave: 2, duration: 45, smallRate: 1.2, bigRate: 0.3, description: '大型登場' },
      { wave: 3, duration: 60, smallRate: 1.0, bigRate: 0.5, description: '高壓波' },
    ],
    waveRestTime: 3,
    spawnPoints: [], obstacles: [], items: [],
    playerSpawns: [{ id: 'ps1', x: 960, y: 540 }],
  };
}

function setStatus(msg: string) {
  document.getElementById('status')!.textContent = msg;
}

function genId(): string { return Math.random().toString(36).slice(2, 8); }

// ========================================
// Background Image
// ========================================
function updateBackgroundImage(dataUrl?: string) {
  // Remove old
  if (bgImageMesh) {
    scene.remove(bgImageMesh);
    (bgImageMesh.material as THREE.Material).dispose();
    bgImageMesh.geometry.dispose();
    bgImageMesh = null;
  }

  if (!dataUrl) {
    document.getElementById('bg-image-name')!.textContent = '未設定';
    return;
  }

  const texture = new THREE.TextureLoader().load(dataUrl);
  texture.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(levelData.arena.width, levelData.arena.height);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
  bgImageMesh = new THREE.Mesh(geo, mat);
  bgImageMesh.rotation.x = -Math.PI / 2;
  bgImageMesh.position.y = 0; // just above the green ground
  scene.add(bgImageMesh);
  document.getElementById('bg-image-name')!.textContent = '✅ 已設定';
}

document.getElementById('bg-image-input')!.addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = reader.result as string;
    levelData.arena.backgroundImage = dataUrl;
    updateBackgroundImage(dataUrl);
  };
  reader.readAsDataURL(file);
});

// ========================================
// Config Panel Bindings
// ========================================
function loadConfigToUI() {
  (document.getElementById('level-name') as HTMLInputElement).value = levelData.name || '';
  (document.getElementById('arena-radius') as HTMLInputElement).value = String(levelData.arena?.boundaryRadius ?? 480);
  (document.getElementById('arena-color') as HTMLInputElement).value = levelData.arena?.groundColor || '#2d5a27';

  // Boundary shape
  const shape = levelData.arena?.boundaryShape || 'circle';
  (document.getElementById('arena-shape') as HTMLSelectElement).value = shape;
  updateShapeFields(shape);
  (document.getElementById('arena-rect-w') as HTMLInputElement).value = String(levelData.arena?.boundaryWidth ?? 1600);
  (document.getElementById('arena-rect-h') as HTMLInputElement).value = String(levelData.arena?.boundaryHeight ?? 900);
  (document.getElementById('arena-cap-length') as HTMLInputElement).value = String(levelData.arena?.capsuleLength ?? 800);
  (document.getElementById('arena-cap-radius') as HTMLInputElement).value = String(levelData.arena?.capsuleRadius ?? 400);
  (document.getElementById('arena-cap-dir') as HTMLSelectElement).value = levelData.arena?.capsuleDirection || 'horizontal';

  // Background image
  updateBackgroundImage(levelData.arena?.backgroundImage);

  // Spawn rules
  const sr = levelData.spawnRules;
  if (sr) {
    (document.getElementById('spawn-mode') as HTMLSelectElement).value = sr.mode || 'edge_random';
    (document.getElementById('spawn-max-alive') as HTMLInputElement).value = String(sr.maxAlive ?? 26);
    (document.getElementById('spawn-max-small') as HTMLInputElement).value = String(sr.maxSmall ?? 20);
    (document.getElementById('spawn-max-big') as HTMLInputElement).value = String(sr.maxBig ?? 6);
    (document.getElementById('spawn-big-chance') as HTMLInputElement).value = String((sr.bigChance ?? 0.3) * 100);
    (document.getElementById('spawn-interval') as HTMLInputElement).value = String(sr.spawnInterval ?? 1.5);
    (document.getElementById('spawn-delay') as HTMLInputElement).value = String(sr.startDelay ?? 2);
    (document.getElementById('dist-big') as HTMLInputElement).value = String(sr.bigDistribution?.zombie_big ?? 50);
    (document.getElementById('dist-bomb') as HTMLInputElement).value = String(sr.bigDistribution?.zombie_bomb ?? 33);
    (document.getElementById('dist-bounce') as HTMLInputElement).value = String(sr.bigDistribution?.zombie_bouncing ?? 17);
  }

  // Boss config
  const bc = levelData.bossConfig;
  if (bc) {
    (document.getElementById('boss-trigger') as HTMLSelectElement).value = bc.triggerType || 'kill_count';
    (document.getElementById('boss-trigger-value') as HTMLInputElement).value = String(bc.triggerValue ?? 80);
    (document.getElementById('boss-type') as HTMLSelectElement).value = bc.bossType || 'zombie_boss';
    (document.getElementById('boss-pos') as HTMLSelectElement).value = bc.spawnPosition || 'center';
    (document.getElementById('boss-x') as HTMLInputElement).value = String(bc.customX ?? 960);
    (document.getElementById('boss-y') as HTMLInputElement).value = String(bc.customY ?? 540);
    document.getElementById('boss-custom-pos')!.style.display = bc.spawnPosition === 'custom' ? '' : 'none';
  }

  // Obstacle config
  const oc = levelData.obstacleConfig;
  if (oc) {
    (document.getElementById('obs-random-count') as HTMLInputElement).value = String(oc.randomCount ?? 3);
    (document.getElementById('obs-min-dist') as HTMLInputElement).value = String(oc.minDistance ?? 100);
  }

  // Waves
  (document.getElementById('wave-rest') as HTMLInputElement).value = String(levelData.waveRestTime ?? 3);
  rebuildWaveList();
}

function saveConfigFromUI() {
  levelData.name = (document.getElementById('level-name') as HTMLInputElement).value;
  levelData.arena.boundaryRadius = parseFloat((document.getElementById('arena-radius') as HTMLInputElement).value) || 480;
  levelData.arena.groundColor = (document.getElementById('arena-color') as HTMLInputElement).value;
  levelData.arena.boundaryShape = (document.getElementById('arena-shape') as HTMLSelectElement).value as any || 'circle';
  levelData.arena.boundaryWidth = parseFloat((document.getElementById('arena-rect-w') as HTMLInputElement).value) || 1600;
  levelData.arena.boundaryHeight = parseFloat((document.getElementById('arena-rect-h') as HTMLInputElement).value) || 900;
  levelData.arena.capsuleLength = parseFloat((document.getElementById('arena-cap-length') as HTMLInputElement).value) || 800;
  levelData.arena.capsuleRadius = parseFloat((document.getElementById('arena-cap-radius') as HTMLInputElement).value) || 400;
  levelData.arena.capsuleDirection = (document.getElementById('arena-cap-dir') as HTMLSelectElement).value as any || 'horizontal';

  // Spawn rules
  if (!levelData.spawnRules) levelData.spawnRules = createDefaultLevel().spawnRules;
  levelData.spawnRules.mode = (document.getElementById('spawn-mode') as HTMLSelectElement).value as any;
  levelData.spawnRules.maxAlive = parseInt((document.getElementById('spawn-max-alive') as HTMLInputElement).value) || 26;
  levelData.spawnRules.maxSmall = parseInt((document.getElementById('spawn-max-small') as HTMLInputElement).value) || 20;
  levelData.spawnRules.maxBig = parseInt((document.getElementById('spawn-max-big') as HTMLInputElement).value) || 6;
  levelData.spawnRules.bigChance = (parseFloat((document.getElementById('spawn-big-chance') as HTMLInputElement).value) || 30) / 100;
  levelData.spawnRules.spawnInterval = parseFloat((document.getElementById('spawn-interval') as HTMLInputElement).value) || 1.5;
  levelData.spawnRules.startDelay = parseFloat((document.getElementById('spawn-delay') as HTMLInputElement).value) || 2;
  levelData.spawnRules.bigDistribution = {
    zombie_big: parseInt((document.getElementById('dist-big') as HTMLInputElement).value) || 50,
    zombie_bomb: parseInt((document.getElementById('dist-bomb') as HTMLInputElement).value) || 33,
    zombie_bouncing: parseInt((document.getElementById('dist-bounce') as HTMLInputElement).value) || 17,
  };

  // Boss config
  if (!levelData.bossConfig) levelData.bossConfig = createDefaultLevel().bossConfig;
  levelData.bossConfig.triggerType = (document.getElementById('boss-trigger') as HTMLSelectElement).value as any;
  levelData.bossConfig.triggerValue = parseInt((document.getElementById('boss-trigger-value') as HTMLInputElement).value) || 80;
  levelData.bossConfig.bossType = (document.getElementById('boss-type') as HTMLSelectElement).value;
  levelData.bossConfig.spawnPosition = (document.getElementById('boss-pos') as HTMLSelectElement).value as any;
  levelData.bossConfig.customX = parseInt((document.getElementById('boss-x') as HTMLInputElement).value) || 960;
  levelData.bossConfig.customY = parseInt((document.getElementById('boss-y') as HTMLInputElement).value) || 540;

  // Obstacle config
  if (!levelData.obstacleConfig) levelData.obstacleConfig = createDefaultLevel().obstacleConfig;
  levelData.obstacleConfig.randomCount = parseInt((document.getElementById('obs-random-count') as HTMLInputElement).value) || 3;
  levelData.obstacleConfig.minDistance = parseInt((document.getElementById('obs-min-dist') as HTMLInputElement).value) || 100;

  // Waves
  levelData.waveRestTime = parseFloat((document.getElementById('wave-rest') as HTMLInputElement).value) || 3;
}

// Boss position toggle
document.getElementById('boss-pos')!.addEventListener('change', () => {
  document.getElementById('boss-custom-pos')!.style.display =
    (document.getElementById('boss-pos') as HTMLSelectElement).value === 'custom' ? '' : 'none';
});

// Boundary shape switching & live update
function updateShapeFields(shape: string) {
  document.getElementById('shape-circle-fields')!.style.display = shape === 'circle' ? '' : 'none';
  document.getElementById('shape-rect-fields')!.style.display = shape === 'rectangle' ? '' : 'none';
  document.getElementById('shape-capsule-fields')!.style.display = shape === 'capsule' ? '' : 'none';
}

document.getElementById('arena-shape')!.addEventListener('change', () => {
  const shape = (document.getElementById('arena-shape') as HTMLSelectElement).value;
  updateShapeFields(shape);
  levelData.arena.boundaryShape = shape as any;
  rebuildScene();
});

// Live update boundary on parameter change
for (const id of ['arena-radius', 'arena-rect-w', 'arena-rect-h', 'arena-cap-length', 'arena-cap-radius']) {
  document.getElementById(id)?.addEventListener('change', () => {
    saveConfigFromUI();
    rebuildScene();
  });
}
document.getElementById('arena-cap-dir')?.addEventListener('change', () => {
  saveConfigFromUI();
  rebuildScene();
});

// ========================================
// Wave List UI
// ========================================
function rebuildWaveList() {
  const container = document.getElementById('wave-list')!;
  container.innerHTML = '';
  if (!levelData.waves) levelData.waves = [];

  for (let i = 0; i < levelData.waves.length; i++) {
    const w = levelData.waves[i];
    const div = document.createElement('div');
    div.style.cssText = 'padding:4px; margin-bottom:4px; background:#0f3460; border-radius:4px; font-size:10px;';
    div.innerHTML = `
      <div class="prop-row"><label>波${w.wave}</label><input type="text" data-wi="${i}" data-field="desc" value="${w.description}" style="flex:1;" /><button data-rm="${i}" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:11px;">✕</button></div>
      <div class="prop-row"><label>持續(秒)</label><input type="number" data-wi="${i}" data-field="duration" value="${w.duration}" style="width:45px;" /><label>小率</label><input type="number" data-wi="${i}" data-field="smallRate" value="${w.smallRate}" step="0.1" style="width:40px;" /><label>大率</label><input type="number" data-wi="${i}" data-field="bigRate" value="${w.bigRate}" step="0.1" style="width:40px;" /></div>
    `;
    container.appendChild(div);

    // Bind inputs
    div.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('change', () => {
        const idx = parseInt(inp.dataset.wi!);
        const field = inp.dataset.field!;
        if (field === 'desc') levelData.waves[idx].description = inp.value;
        else if (field === 'duration') levelData.waves[idx].duration = parseFloat(inp.value) || 0;
        else if (field === 'smallRate') levelData.waves[idx].smallRate = parseFloat(inp.value) || 0;
        else if (field === 'bigRate') levelData.waves[idx].bigRate = parseFloat(inp.value) || 0;
      });
    });
    div.querySelector(`[data-rm="${i}"]`)!.addEventListener('click', () => {
      levelData.waves.splice(i, 1);
      // Re-number
      levelData.waves.forEach((wv, j) => wv.wave = j + 1);
      rebuildWaveList();
    });
  }
}

document.getElementById('btn-add-wave')!.addEventListener('click', () => {
  if (!levelData.waves) levelData.waves = [];
  const num = levelData.waves.length + 1;
  levelData.waves.push({ wave: num, duration: 30, smallRate: 1.0, bigRate: 0.3, description: `波次 ${num}` });
  rebuildWaveList();
});

// ========================================
// Init
// ========================================
// ========================================
// Panel Resizer
// ========================================
const panelResizer = document.getElementById('panel-resizer')!;
const panel = document.getElementById('panel')!;
let isResizing = false;

panelResizer.addEventListener('mousedown', (e) => {
  isResizing = true;
  panelResizer.classList.add('active');
  e.preventDefault();
});

window.addEventListener('mousemove', (e) => {
  if (!isResizing) return;
  const containerRect = document.getElementById('main')!.getBoundingClientRect();
  const newWidth = containerRect.right - e.clientX;
  if (newWidth >= 200 && newWidth <= 500) {
    panel.style.width = newWidth + 'px';
    resize(); // update 3D viewport
  }
});

window.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    panelResizer.classList.remove('active');
  }
});

// ========================================
// 目標場景（決定存檔寫進哪個 .spinningtop.json）
// ========================================
const targetSceneInput = document.getElementById('target-scene') as HTMLInputElement | null;
if (targetSceneInput) {
  targetSceneInput.value = targetSceneName;
  targetSceneInput.addEventListener('change', () => {
    const v = targetSceneInput.value.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(v)) {
      alert('場景名只能用英數字、底線與減號');
      targetSceneInput.value = targetSceneName;
      return;
    }
    targetSceneName = v;
    localStorage.setItem('lv_target_scene', v);
    setStatus(`🎯 存檔目標場景：${v}.spinningtop.json`);
  });
}

// ========================================
// Init
// ========================================
/**
 * 開檔順序：
 * 1. 工作檔 Level01.json —— 拿背景圖、障礙物種類等場景檔沒有的編輯器欄位
 * 2. 遊戲場景檔 —— 幾何與出怪配置以「遊戲真正讀到的那份」為準，避免工作檔過期時
 *    一存檔就把遊戲現況覆蓋掉
 */
async function initLevelData() {
  let loadedAny = false;

  try {
    const r = await fetch('/Level/Level01.json');
    if (r.ok) {
      levelData = await r.json();
      loadedAny = true;
    }
  } catch { /* 工作檔沒有就用預設關卡 */ }

  try {
    const r = await fetch(`${API_BASE}/scene?name=${encodeURIComponent(targetSceneName)}`);
    if (r.ok) {
      levelData = sceneToLevelData(await r.json(), levelData);
      loadedAny = true;
      setStatus(`📂 已載入遊戲場景 ${targetSceneName}.spinningtop.json`);
    }
  } catch { /* dev server 不在或場景檔不存在，就只用工作檔 */ }

  if (loadedAny) loadConfigToUI();
  rebuildScene();
}

initLevelData();
