import { SceneEditor, SceneObjectData, SceneData, MaterialSlotInfo, ColliderData, ColliderType, AnimSegment } from './SceneEditor';
import { tgaToFile } from './tgaConverter';
import { PlayMode } from './PlayMode';
import { Timeline } from './Timeline';
import { VFXSystem, ParticleConfig, VFX_PRESETS } from '../runtime/VFXSystem';
import { QuarksVFXSystem } from '../runtime/QuarksVFXSystem';
import { VFXPositionGizmo } from './VFXPositionGizmo';
import { MarkerManager } from './MarkerManager';
import * as THREE from 'three';

// --- Level Naming System ---
class LevelNamingSystem {
  private lastDirHandle: any = null;

  /**
   * 根據關卡ID生成下一個可用的檔案名稱
   * 格式：level{levelId}_{編號}.json
   */
  async generateFileName(levelId: string): Promise<string> {
    const prefix = `level${levelId}_`;
    
    // 如果有記憶的資料夾，檢查現有檔案
    if (this.lastDirHandle) {
      try {
        const existingNumbers: number[] = [];
        
        // 遍歷資料夾中的檔案
        for await (const [name, handle] of this.lastDirHandle.entries()) {
          if (handle.kind === 'file' && name.startsWith(prefix) && name.endsWith('.json')) {
            // 提取編號部分，例如 level1_005.json → 005
            const match = name.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\.json$`));
            if (match) {
              existingNumbers.push(parseInt(match[1], 10));
            }
          }
        }
        
        // 找到下一個可用編號
        const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
        return `${prefix}${nextNumber.toString().padStart(3, '0')}`;
        
      } catch (err) {
        console.warn('無法檢查現有檔案，使用預設編號:', err);
      }
    }
    
    // 預設情況：使用 001
    return `${prefix}001`;
  }

  /**
   * 記住最後使用的資料夾
   */
  setLastDirHandle(handle: any) {
    this.lastDirHandle = handle;
  }

  /**
   * 取得最後使用的資料夾
   */
  getLastDirHandle() {
    return this.lastDirHandle;
  }
}

const levelNaming = new LevelNamingSystem();


// --- Editor Overlay (block interaction during load/save) ---
function showOverlay(text: string) {
  const overlay = document.getElementById('editor-overlay');
  const textEl = document.getElementById('overlay-text');
  if (overlay && textEl) {
    textEl.textContent = text;
    overlay.classList.remove('hidden');
  }
}
function hideOverlay() {
  const overlay = document.getElementById('editor-overlay');
  if (overlay) overlay.classList.add('hidden');
}


const container = document.getElementById('viewport')!;
const editor = new SceneEditor(container);
(window as any).editor = editor; // Expose for console debugging
const playMode = new PlayMode(editor);
const timeline = new Timeline();
const editorVfx = new QuarksVFXSystem(editor.getScene());
const markerManager = new MarkerManager(editor.getScene());
// AttackIndicator removed for 鬥氣割草 editor
const editorAttackIndicator: any = null;
const vfxGizmo = new VFXPositionGizmo(editor.getScene(), editor.getTransformControls());

function spawnEditorVFX(presetId: string, position: THREE.Vector3, obj: THREE.Object3D) {
  const rot = obj.rotation.y;
  const dir = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
  editorVfx.spawn(presetId, position, dir);
}

// Load persisted data (non-blocking, won't crash if DB fails)
editor.loadAssetLibraryFromStorage().then(() => {
  refreshAssetLibrary();
}).catch(() => {});
editor.loadPrefabsFromStorage().then(() => {
  refreshPrefabList();
}).catch(() => {});

// --- Undo / Redo ---
const undoBtn = document.getElementById('undo-btn')!;
const redoBtn = document.getElementById('redo-btn')!;

function refreshHistoryButtons() {
  undoBtn.classList.toggle('disabled', !editor.canUndo());
  redoBtn.classList.toggle('disabled', !editor.canRedo());
}

undoBtn.addEventListener('click', () => { editor.undo(); refreshAll(); });
redoBtn.addEventListener('click', () => { editor.redo(); refreshAll(); });

// --- New Scene ---
document.getElementById('new-scene-btn')!.addEventListener('click', () => {
  if (!confirm('確定要建立新場景嗎？未儲存的變更將遺失。')) return;
  editor.newScene();
  (document.getElementById('scene-name') as HTMLInputElement).value = '';
  const ambientSliderEl = document.getElementById('ed-ambient') as HTMLInputElement;
  const sunSliderEl = document.getElementById('ed-sun') as HTMLInputElement;
  ambientSliderEl.value = '1.5';
  sunSliderEl.value = '2.0';
  document.getElementById('ed-ambient-val')!.textContent = '1.50';
  document.getElementById('ed-sun-val')!.textContent = '2.00';
  refreshAll();
});

editor.onHistoryChange = () => {
  refreshHistoryButtons();
};

// Delete key: if a timeline marker is selected, delete the marker instead of the scene object
editor.onDeleteKey = () => {
  const selected = (timeline as any).selectedMarker;
  if (!selected) return false; // not handled, let SceneEditor handle it
  const track = (timeline as any).tracks?.[selected.trackIdx];
  const markerName = track?.markers?.[selected.markerIdx]?.label || 'marker';
  if (confirm(`確定要刪除 marker「${markerName}」嗎？`)) {
    if (track?.type === 'combat') {
      timeline.removeMarker(selected.trackIdx, selected.markerIdx);
      combatPropsPanel.classList.add('hidden');
      selectedCombatMarkerIdx = -1;
      saveCombatMarkersToSegment(timeline.getMarkers(1));
    } else {
      timeline.removeMarker(selected.trackIdx, selected.markerIdx);
      vfxGizmo.hide();
      markerPropsPanel.classList.add('hidden');
    }
  }
  return true; // handled
};

function refreshAll() {
  refreshObjectList();
  refreshInspector();
  refreshHistoryButtons();
}

// --- Object List ---
const objectList = document.getElementById('object-list')!;
const addModelInput = document.getElementById('add-model-input') as HTMLInputElement;

function refreshObjectList() {
  objectList.innerHTML = '';
  const all = editor.getAllMeta();
  all.forEach((meta) => {
    const li = document.createElement('li');
    li.dataset.id = meta.id;
    li.textContent = meta.name;
    if (meta.id === editor.getSelectedId()) li.classList.add('active');
    li.addEventListener('click', () => editor.select(meta.id));
    objectList.appendChild(li);
  });
}

addModelInput.addEventListener('change', async () => {
  const file = addModelInput.files?.[0];
  if (!file) return;
  try {
    await editor.addFBXFromFile(file);
    refreshObjectList();
    refreshAssetLibrary();
  } catch (err) {
    console.error('FBX 載入失敗:', err);
    alert(`FBX 載入失敗: ${(err as Error).message || err}`);
  }
  addModelInput.value = '';
});

editor.onSelect = (_id) => {
  refreshAll();
  if (_id && editor.isCameraObject(_id)) {
    showCameraPreview();
  } else {
    hideCameraPreview();
  }
};

editor.onTransformChange = () => {
  refreshInspector();
};

// --- Inspector ---
const inspector = document.getElementById('inspector')!;
const inspName = document.getElementById('insp-name') as HTMLInputElement;
const posX = document.getElementById('pos-x') as HTMLInputElement;
const posY = document.getElementById('pos-y') as HTMLInputElement;
const posZ = document.getElementById('pos-z') as HTMLInputElement;
const rotX = document.getElementById('rot-x') as HTMLInputElement;
const rotY = document.getElementById('rot-y') as HTMLInputElement;
const rotZ = document.getElementById('rot-z') as HTMLInputElement;
const sclX = document.getElementById('scl-x') as HTMLInputElement;
const sclY = document.getElementById('scl-y') as HTMLInputElement;
const sclZ = document.getElementById('scl-z') as HTMLInputElement;

function refreshInspector() {
  const id = editor.getSelectedId();
  if (!id) {
    inspector.classList.add('hidden');
    return;
  }
  inspector.classList.remove('hidden');
  const meta = editor.getMeta(id);
  if (!meta) return;

  inspName.value = meta.name;
  posX.value = meta.position[0].toFixed(2);
  posY.value = meta.position[1].toFixed(2);
  posZ.value = meta.position[2].toFixed(2);
  rotX.value = meta.rotation[0].toFixed(1);
  rotY.value = meta.rotation[1].toFixed(1);
  rotZ.value = meta.rotation[2].toFixed(1);
  sclX.value = meta.scale[0].toFixed(3);
  sclY.value = meta.scale[1].toFixed(3);
  sclZ.value = meta.scale[2].toFixed(3);

  refreshMaterialSlots(id);
  refreshColliderPanel();
  refreshAnimPanel();
  refreshBehaviorPanel();
  refreshCameraPanel();
  // 鬥氣割草 panel refresh (function defined later, called via reference)
  if ((window as any).__refreshSTPanel) (window as any).__refreshSTPanel();
}

function applyInspector() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;
  meta.name = inspName.value;
  editor.setObjectTransform(
    id,
    [parseFloat(posX.value) || 0, parseFloat(posY.value) || 0, parseFloat(posZ.value) || 0],
    [parseFloat(rotX.value) || 0, parseFloat(rotY.value) || 0, parseFloat(rotZ.value) || 0],
    [parseFloat(sclX.value) || 1, parseFloat(sclY.value) || 1, parseFloat(sclZ.value) || 1],
  );
  refreshObjectList();
}

[inspName, posX, posY, posZ, rotX, rotY, rotZ, sclX, sclY, sclZ].forEach((el) => {
  el.addEventListener('change', applyInspector);
});

// --- Transform Mode Buttons ---
document.getElementById('mode-translate')!.addEventListener('click', () => editor.setTransformMode('translate'));
document.getElementById('mode-rotate')!.addEventListener('click', () => editor.setTransformMode('rotate'));
document.getElementById('mode-scale')!.addEventListener('click', () => editor.setTransformMode('scale'));

// Block scale mode when VFX gizmo is active (scale is meaningless for particle effects)
editor.getTransformControls().addEventListener('change', () => {
  if (vfxGizmo.isActive() && editor.getTransformControls().getMode() === 'scale') {
    editor.getTransformControls().setMode('translate');
  }
});

// --- Delete ---
document.getElementById('delete-btn')!.addEventListener('click', () => {
  const id = editor.getSelectedId();
  if (id) { editor.removeObject(id); refreshObjectList(); refreshInspector(); }
});

// --- Duplicate ---
document.getElementById('duplicate-btn')!.addEventListener('click', async () => {
  const id = editor.getSelectedId();
  if (!id) return;
  editor.copy();
  await editor.paste();
  refreshAll();
});

// --- Collider ---
const colliderType = document.getElementById('collider-type') as HTMLSelectElement;
const colliderStatic = document.getElementById('collider-static') as HTMLInputElement;
const colliderTrigger = document.getElementById('collider-trigger') as HTMLInputElement;
const colSizePanel = document.getElementById('collider-size-panel')!;
const colSpherePanel = document.getElementById('collider-sphere-panel')!;
const colCapsulePanel = document.getElementById('collider-capsule-panel')!;
const colSizeX = document.getElementById('col-size-x') as HTMLInputElement;
const colSizeY = document.getElementById('col-size-y') as HTMLInputElement;
const colSizeZ = document.getElementById('col-size-z') as HTMLInputElement;
const colRadius = document.getElementById('col-radius') as HTMLInputElement;
const colCapRadius = document.getElementById('col-cap-radius') as HTMLInputElement;
const colCapHeight = document.getElementById('col-cap-height') as HTMLInputElement;
const colOffsetX = document.getElementById('col-offset-x') as HTMLInputElement;
const colOffsetY = document.getElementById('col-offset-y') as HTMLInputElement;
const colOffsetZ = document.getElementById('col-offset-z') as HTMLInputElement;

function refreshColliderPanel() {
  const id = editor.getSelectedId();
  if (!id) return;
  const collider = editor.getCollider(id);
  const bounds = editor.getObjectBounds(id);
  const obj = editor.getObjects().get(id);
  const scale = obj ? (Math.abs(obj.scale.x) + Math.abs(obj.scale.z)) / 2 : 1;

  // Sync panel enable checkbox with data
  const colliderEnabledEl = document.getElementById('collider-enabled') as HTMLInputElement;
  if (colliderEnabledEl) {
    const hasCollider = collider && collider.type !== 'none';
    colliderEnabledEl.checked = !!hasCollider;
    document.getElementById('collider-panel-wrap')?.classList.toggle('disabled', !hasCollider);
    if (hasCollider) {
      document.getElementById('collider-body')?.classList.add('open');
      document.getElementById('collider-arrow')?.classList.add('open');
    }
  }


  colliderType.value = collider?.type || 'none';
  colliderStatic.checked = collider?.isStatic ?? true;
  colliderTrigger.checked = collider?.isTrigger ?? false;

  // Show/hide sub-panels
  colSizePanel.classList.toggle('hidden', colliderType.value !== 'box');
  colSpherePanel.classList.toggle('hidden', colliderType.value !== 'sphere');
  colCapsulePanel.classList.toggle('hidden', colliderType.value !== 'capsule');

  // Display values in WORLD space (local value × scale) for intuitive editing
  const halfX = (collider?.sizeOverride?.[0] ?? bounds.x / 2) * scale;
  const halfY = (collider?.sizeOverride?.[1] ?? bounds.y / 2) * scale;
  const halfZ = (collider?.sizeOverride?.[2] ?? bounds.z / 2) * scale;
  colSizeX.value = halfX.toFixed(1);
  colSizeY.value = halfY.toFixed(1);
  colSizeZ.value = halfZ.toFixed(1);

  const sphereR = (collider?.radiusOverride ?? Math.max(bounds.x, bounds.y, bounds.z) / 2) * scale;
  colRadius.value = sphereR.toFixed(1);

  const capR = (collider?.radiusOverride ?? Math.max(bounds.x, bounds.z) / 2) * scale;
  const capH = (collider?.heightOverride ?? bounds.y) * scale;
  colCapRadius.value = capR.toFixed(1);
  colCapHeight.value = capH.toFixed(1);

  const off = collider?.offset || [0, 0, 0];
  colOffsetX.value = off[0].toFixed(1);
  colOffsetY.value = off[1].toFixed(1);
  colOffsetZ.value = off[2].toFixed(1);
}

function applyCollider() {
  const id = editor.getSelectedId();
  if (!id) return;
  const type = colliderType.value as ColliderType;
  const obj = editor.getObjects().get(id);
  const scale = obj ? (Math.abs(obj.scale.x) + Math.abs(obj.scale.z)) / 2 : 1;

  const data: ColliderData = {
    type,
    isStatic: colliderStatic.checked,
    isTrigger: colliderTrigger.checked,
  };

  // User enters world-space values; convert back to local space (÷ scale) for storage
  if (type === 'box') {
    data.sizeOverride = [
      (parseFloat(colSizeX.value) || 1) / scale,
      (parseFloat(colSizeY.value) || 1) / scale,
      (parseFloat(colSizeZ.value) || 1) / scale,
    ];
  } else if (type === 'sphere') {
    data.radiusOverride = (parseFloat(colRadius.value) || 1) / scale;
  } else if (type === 'capsule') {
    data.radiusOverride = (parseFloat(colCapRadius.value) || 1) / scale;
    data.heightOverride = (parseFloat(colCapHeight.value) || 2) / scale;
  }

  // Apply offset (stays in local space)
  const ox = parseFloat(colOffsetX.value) || 0;
  const oy = parseFloat(colOffsetY.value) || 0;
  const oz = parseFloat(colOffsetZ.value) || 0;
  if (ox !== 0 || oy !== 0 || oz !== 0) {
    data.offset = [ox, oy, oz];
  }

  editor.setCollider(id, data);
}

function applyColliderAndRefresh() {
  applyCollider();
  // Only toggle sub-panel visibility, don't reset values
  const type = colliderType.value;
  colSizePanel.classList.toggle('hidden', type !== 'box');
  colSpherePanel.classList.toggle('hidden', type !== 'sphere');
  colCapsulePanel.classList.toggle('hidden', type !== 'capsule');
}

colliderType.addEventListener('change', applyColliderAndRefresh);
colliderStatic.addEventListener('change', applyCollider);
colliderTrigger.addEventListener('change', applyCollider);
colSizeX.addEventListener('input', applyCollider);
colSizeY.addEventListener('input', applyCollider);
colSizeZ.addEventListener('input', applyCollider);
colRadius.addEventListener('input', applyCollider);
colCapRadius.addEventListener('input', applyCollider);
colCapHeight.addEventListener('input', applyCollider);
colOffsetX.addEventListener('input', applyCollider);
colOffsetY.addEventListener('input', applyCollider);
colOffsetZ.addEventListener('input', applyCollider);

document.getElementById('col-auto-fit')!.addEventListener('click', () => {
  const id = editor.getSelectedId();
  if (!id) return;
  const bounds = editor.getObjectBounds(id);
  const type = colliderType.value as ColliderType;
  const data: ColliderData = {
    type,
    isStatic: colliderStatic.checked,
    isTrigger: colliderTrigger.checked,
  };
  // Store in local space (auto-fit from bounds which are already local)
  if (type === 'box') {
    data.sizeOverride = [bounds.x / 2, bounds.y / 2, bounds.z / 2];
  } else if (type === 'sphere') {
    data.radiusOverride = Math.max(bounds.x, bounds.y, bounds.z) / 2;
  } else if (type === 'capsule') {
    data.radiusOverride = Math.max(bounds.x, bounds.z) / 2;
    data.heightOverride = bounds.y;
  }
  editor.setCollider(id, data);
  refreshColliderPanel(); // Will display as world-space (× scale)
});

document.getElementById('col-toggle-vis')!.addEventListener('click', () => {
  const visible = !editor.isColliderVisible();
  editor.setColliderVisibility(visible);
  (document.getElementById('col-toggle-vis') as HTMLButtonElement).textContent = visible ? '👁 顯示/隱藏' : '👁‍🗨 已隱藏';
});

// --- Animation Panel ---
const animPanel = document.getElementById('anim-panel')!;
const animNoData = document.getElementById('anim-no-data')!;
const animContent = document.getElementById('anim-content')!;
const animClipList = document.getElementById('anim-clip-list')!;
const segList = document.getElementById('seg-list')!;
const segClipSrc = document.getElementById('seg-clip-src') as HTMLSelectElement;
const segNameInput = document.getElementById('seg-name-input') as HTMLInputElement;
const segStartInput = document.getElementById('seg-start-input') as HTMLInputElement;
const segEndInput = document.getElementById('seg-end-input') as HTMLInputElement;

function refreshAnimPanel() {
  const id = editor.getSelectedId();
  if (!id) { animPanel.classList.add('hidden'); return; }
  animPanel.classList.remove('hidden');

  const hasAnim = editor.hasAnimations(id);
  animNoData.classList.toggle('hidden', hasAnim);
  animContent.classList.toggle('hidden', !hasAnim);

  if (!hasAnim) return;

  // Clip list
  const clips = editor.getAnimationClips(id);
  animClipList.innerHTML = '';
  clips.forEach((name) => {
    const frames = editor.getAnimationFrameCount(id, name);
    const li = document.createElement('li');
    li.style.cssText = 'padding:3px 6px;cursor:pointer;border-radius:3px;font-size:11px;display:flex;justify-content:space-between';
    li.innerHTML = `<span>${name}</span><span style="font-size:9px;color:#6c7086">${frames}f</span>`;
    li.addEventListener('click', () => {
      // Select this clip for timeline display
      const fps = editor.getObjectFPS(id) || 30;
      timelineActiveClipName = name;
      timelineActiveSegment = null;
      timelineAction = null;
      // Hide speed control (full clip, not segment)
      document.getElementById('tl-speed-control')!.style.display = 'none';
      timeline.playbackSpeed = 1.0;
      timeline.setTotalFrames(frames);
      timeline.setFPS(fps);
      timeline.setCurrentFrame(0);
      timeline.setTracks([
        { type: 'animation', name: name, clips: [{ startFrame: 0, endFrame: frames, name, color: '#89b4fa' }] },
        { type: 'vfx', name: 'VFX', clips: [] },
        { type: 'audio', name: 'Audio', clips: [] },
      ]);
      // Prepare the action for scrubbing
      const mixer = editor.getMixer(id);
      const clipObj = editor.getObjectAnimationClips(id)?.find(c => c.name === name);
      if (mixer && clipObj) {
        mixer.stopAllAction();
        const action = mixer.clipAction(clipObj);
        action.reset();
        action.paused = true;
        action.enabled = true;
        action.setEffectiveWeight(1);
        action.play();
        action.time = 0;
        mixer.update(0);
        timelineAction = action;
      }
    });
    li.addEventListener('mouseenter', () => li.style.background = '#313244');
    li.addEventListener('mouseleave', () => li.style.background = '');
    animClipList.appendChild(li);
  });

  // Segment source dropdown
  segClipSrc.innerHTML = '';
  clips.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    segClipSrc.appendChild(opt);
  });
  if (clips.length > 0) {
    segEndInput.value = String(editor.getAnimationFrameCount(id, clips[0]));
  }

  // Segment list
  const segs = editor.getObjectSegments(id);
  segList.innerHTML = '';
  segs.forEach((seg, idx) => {
    const li = document.createElement('li');
    li.style.cssText = 'padding:3px 6px;cursor:pointer;border-radius:3px;font-size:11px;display:flex;align-items:center;border-left:2px solid #a6e3a1;margin-left:4px';
    li.innerHTML = `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="來源: ${seg.clipName}">▸ ${seg.name} [${seg.startFrame}-${seg.endFrame}]${seg.speed && seg.speed !== 1.0 ? ` ×${seg.speed}` : ''} <span style="font-size:8px;color:#6c7086">← ${seg.clipName}</span></span><button style="width:16px;height:16px;padding:0;border:none;background:none;color:#f38ba8;font-size:10px;cursor:pointer;flex-shrink:0;margin-left:4px" data-idx="${idx}">✕</button>`;
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;

      // Highlight selected segment
      const allSegItems = segList.querySelectorAll('li');
      allSegItems.forEach((item: any) => item.style.background = '');
      li.style.background = '#313244';

      // Select segment for timeline display
      const totalFrames = seg.endFrame - seg.startFrame;
      const fps = editor.getObjectFPS(id) || 30;
      timelineActiveClipName = null;
      timelineActiveSegment = { name: seg.name, clipName: seg.clipName, startFrame: seg.startFrame, endFrame: seg.endFrame };
      timelineAction = null;

      // Show speed control
      const speedCtrl = document.getElementById('tl-speed-control')!;
      const speedInput = document.getElementById('tl-seg-speed') as HTMLInputElement;
      speedCtrl.style.display = 'inline-flex';
      speedInput.value = String(seg.speed ?? 1.0);
      (speedInput as any).__segIdx = idx;
      timeline.playbackSpeed = seg.speed ?? 1.0;

      // Build VFX markers from saved vfxEvents
      const vfxMarkers = (seg.vfxEvents || []).map(ev => ({
        frame: ev.frame,
        presetId: ev.presetId,
        label: ev.presetId.replace(/_/g, ' '),
        color: '#ff8800',
        offset: ev.offset,
        rotation: ev.rotation,
        scale: ev.scale ?? 1.0,
        followParent: ev.followParent,
      }));

      // Build Combat markers from saved combatEvents
      const combatMarkers = (seg.combatEvents || []).map(ev => ({
        frame: ev.frame,
        presetId: 'combat',
        label: ev.label || `Hit@${ev.frame}`,
        color: '#e64553',
      }));

      timeline.setTotalFrames(totalFrames);
      timeline.setFPS(fps);
      timeline.setCurrentFrame(0);
      timeline.setTracks([
        { type: 'animation', name: seg.name, clips: [{ startFrame: 0, endFrame: totalFrames, name: seg.name, color: '#a6e3a1' }] },
        { type: 'combat', name: 'Combat', clips: [], markers: combatMarkers },
        { type: 'vfx', name: 'VFX', clips: [], markers: vfxMarkers },
        { type: 'audio', name: 'Audio', clips: [] },
      ]);
      // Prepare the action for scrubbing
      const mixer = editor.getMixer(id);
      const clipObj = editor.getObjectAnimationClips(id)?.find(c => c.name === seg.clipName);
      if (mixer && clipObj) {
        mixer.stopAllAction();
        const action = mixer.clipAction(clipObj);
        action.reset();
        action.paused = true;
        action.enabled = true;
        action.setEffectiveWeight(1);
        action.timeScale = seg.speed ?? 1.0;
        action.play();
        action.time = seg.startFrame / fps;
        mixer.update(0);
        timelineAction = action;
      }
    });
    li.querySelector('button')!.addEventListener('click', () => {
      editor.removeSegment(id, idx);
      refreshAnimPanel();
    });
    segList.appendChild(li);
  });
}

segClipSrc.addEventListener('change', () => {
  const id = editor.getSelectedId();
  if (!id) return;
  segEndInput.value = String(editor.getAnimationFrameCount(id, segClipSrc.value));
});

document.getElementById('seg-add-btn')!.addEventListener('click', () => {
  const id = editor.getSelectedId();
  if (!id) return;
  const name = segNameInput.value.trim();
  const clipName = segClipSrc.value;
  const start = parseInt(segStartInput.value);
  const end = parseInt(segEndInput.value);
  if (!name || !clipName) { alert('請填寫名稱與選擇動作來源'); return; }
  if (start >= end) { alert('起始幀必須小於結尾幀'); return; }
  editor.addSegment(id, { name, clipName, startFrame: start, endFrame: end });
  segNameInput.value = '';
  refreshAnimPanel();
  refreshBehaviorPanel();
});

// Speed control change handler (for selected segment in Timeline)
document.getElementById('tl-seg-speed')!.addEventListener('change', () => {
  const id = editor.getSelectedId();
  if (!id) return;
  const speedInput = document.getElementById('tl-seg-speed') as HTMLInputElement;
  const segIdx = (speedInput as any).__segIdx;
  if (segIdx === undefined) return;
  const segs = editor.getObjectSegments(id);
  if (segIdx >= 0 && segIdx < segs.length) {
    const newSpeed = parseFloat(speedInput.value) || 1.0;
    segs[segIdx].speed = newSpeed !== 1.0 ? newSpeed : undefined;
    timeline.playbackSpeed = newSpeed;
    // Update timeScale on current timeline action if playing
    if (timelineAction) {
      timelineAction.timeScale = newSpeed;
    }
    refreshAnimPanel();
  }
});

const extraAnimInput = document.getElementById('extra-anim-input') as HTMLInputElement;
extraAnimInput.addEventListener('change', async () => {
  const id = editor.getSelectedId();
  const file = extraAnimInput.files?.[0];
  if (!id || !file) return;
  await editor.loadExtraAnimation(id, file);
  extraAnimInput.value = '';
  refreshAnimPanel();
  refreshBehaviorPanel();
});

// --- Behavior Panel ---
// Panel visibility now handled by collapsible UI
const behaviorWalk = document.getElementById('behavior-walk') as HTMLSelectElement;
const behaviorIdle = document.getElementById('behavior-idle') as HTMLSelectElement;
const behaviorSpeed = document.getElementById('behavior-speed') as HTMLInputElement;
const behaviorWalkEnabled = document.getElementById('behavior-walk-enabled') as HTMLInputElement;
const behaviorIdleEnabled = document.getElementById('behavior-idle-enabled') as HTMLInputElement;
const behaviorIsPlayer = document.getElementById('behavior-is-player') as HTMLInputElement;

// Combat fields
const combatHp = document.getElementById('combat-hp') as HTMLInputElement;
const combatAttackSeg = document.getElementById('combat-attack-seg') as HTMLSelectElement;
const combatHitSeg = document.getElementById('combat-hit-seg') as HTMLSelectElement;
const combatDeathSeg = document.getElementById('combat-death-seg') as HTMLSelectElement;
const combatAggressive = document.getElementById('combat-aggressive') as HTMLInputElement;
const combatAggroRange = document.getElementById('combat-aggro-range') as HTMLInputElement;
const combatTeam = document.getElementById('combat-team') as HTMLSelectElement;
const combatTarget0 = document.getElementById('combat-target-0') as HTMLInputElement;
const combatTarget1 = document.getElementById('combat-target-1') as HTMLInputElement;
const combatTarget2 = document.getElementById('combat-target-2') as HTMLInputElement;

// Multi-attack UI
const multiAttackList = document.getElementById('multi-attack-list') as HTMLDivElement;
const multiAttackAdd = document.getElementById('multi-attack-add') as HTMLButtonElement;
const combatAttackStrategy = document.getElementById('combat-attack-strategy') as HTMLSelectElement;

/** Format a key name for display */
function formatKeyDisplay(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'shift') return 'Shift';
  if (key === 'control') return 'Ctrl';
  if (key === 'alt') return 'Alt';
  if (key.startsWith('arrow')) return key.replace('arrow', '↑↓←→'.charAt(['up','down','left','right'].indexOf(key.slice(5))) || key.slice(5));
  return key.toUpperCase();
}

/** Get all currently bound keys (for conflict detection) */
function getAllBoundKeys(excludeIndex?: number): Set<string> {
  const bound = new Set<string>();
  const rows = multiAttackList.children;
  for (let i = 0; i < rows.length; i++) {
    if (i === excludeIndex) continue;
    const input = (rows[i] as HTMLElement).querySelector('[data-field="key"]') as HTMLInputElement;
    if (input?.dataset.keyValue) bound.add(input.dataset.keyValue);
  }
  // Also check dash key
  const dashKeyInput = document.getElementById('dash-key-input') as HTMLInputElement | null;
  if (dashKeyInput?.dataset.keyValue) bound.add(dashKeyInput.dataset.keyValue);
  return bound;
}

/** Create a key-capture input element */
function createKeyCaptureInput(currentKey: string, rowIndex: number): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.readOnly = true;
  input.value = formatKeyDisplay(currentKey);
  input.dataset.keyValue = currentKey;
  input.dataset.field = 'key';
  input.style.cssText = 'width:44px; font-size:10px; text-align:center; cursor:pointer; background:#2a2a4a; border:1px solid #555; border-radius:3px; color:#fff;';
  input.title = '點擊後按鍵綁定';

  input.addEventListener('focus', () => {
    input.value = '⌨ ...';
    input.style.borderColor = '#7fe7dd';
  });

  input.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const key = e.key.toLowerCase();
    // Ignore modifier-only presses as standalone? No, allow them
    const bound = getAllBoundKeys(rowIndex);
    if (bound.has(key)) {
      input.style.borderColor = '#f44';
      input.value = `⚠ ${formatKeyDisplay(key)} 已用`;
      setTimeout(() => {
        input.value = formatKeyDisplay(input.dataset.keyValue || '');
        input.style.borderColor = '#555';
        input.blur();
      }, 1000);
      return;
    }
    input.dataset.keyValue = key;
    input.value = formatKeyDisplay(key);
    input.style.borderColor = '#555';
    input.blur();
    applyMultiAttacks();
  });

  input.addEventListener('blur', () => {
    if (input.value === '⌨ ...') {
      input.value = formatKeyDisplay(input.dataset.keyValue || '');
    }
    input.style.borderColor = '#555';
  });

  return input;
}

function buildMultiAttackUI(attacks: Array<{ id: string; key: string; segment: string; cooldown: number }> | undefined, segOptions?: Array<{ value: string; label: string }>) {
  multiAttackList.innerHTML = '';
  if (!attacks || attacks.length === 0) return;

  const segs = segOptions || [];

  for (let i = 0; i < attacks.length; i++) {
    const atk = attacks[i];
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:3px; margin-bottom:2px; font-size:10px;';

    // Number label
    const numLabel = document.createElement('span');
    numLabel.style.cssText = 'color:#aaa; width:14px;';
    numLabel.textContent = String(i + 1);
    row.appendChild(numLabel);

    // Key capture input
    const keyInput = createKeyCaptureInput(atk.key, i);
    row.appendChild(keyInput);

    // Segment dropdown
    const segSelect = document.createElement('select');
    segSelect.dataset.field = 'segment';
    segSelect.style.cssText = 'flex:1; font-size:10px;';
    segSelect.innerHTML = `<option value="">（未指定）</option>${segs.filter(s => s.value).map(s => `<option value="${s.value}" ${s.value === atk.segment ? 'selected' : ''}>${s.label}</option>`).join('')}`;
    segSelect.addEventListener('change', () => applyMultiAttacks());
    row.appendChild(segSelect);

    // Cooldown input
    const cdInput = document.createElement('input');
    cdInput.type = 'number';
    cdInput.dataset.field = 'cooldown';
    cdInput.value = String(atk.cooldown);
    cdInput.step = '0.1';
    cdInput.min = '0';
    cdInput.style.cssText = 'width:36px; font-size:10px;';
    cdInput.title = '冷卻(秒)';
    cdInput.addEventListener('change', () => applyMultiAttacks());
    row.appendChild(cdInput);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.style.cssText = 'font-size:9px; padding:0 3px; color:#f44; cursor:pointer; background:none; border:1px solid #f44; border-radius:2px;';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => { row.remove(); applyMultiAttacks(); });
    row.appendChild(removeBtn);

    multiAttackList.appendChild(row);
  }
}

function readMultiAttacksFromUI(): Array<{ id: string; key: string; segment: string; cooldown: number }> {
  const attacks: Array<{ id: string; key: string; segment: string; cooldown: number }> = [];
  const rows = multiAttackList.children;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as HTMLElement;
    const keyInput = row.querySelector('[data-field="key"]') as HTMLInputElement;
    const key = keyInput?.dataset.keyValue || 'j';
    const segment = (row.querySelector('[data-field="segment"]') as HTMLSelectElement).value;
    const cooldown = parseFloat((row.querySelector('[data-field="cooldown"]') as HTMLInputElement).value) || 1.0;
    if (segment) {
      attacks.push({ id: `atk_${i}`, key, segment, cooldown });
    }
  }
  return attacks;
}

function applyMultiAttacks() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta?.behavior) return;
  const attacks = readMultiAttacksFromUI();
  meta.behavior.attacks = attacks.length > 0 ? attacks : undefined;
  meta.behavior.attackStrategy = (combatAttackStrategy.value as any) || 'random';
}

multiAttackAdd.addEventListener('click', () => {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;
  if (!meta.behavior) meta.behavior = {};
  const existing = meta.behavior.attacks || [];

  // Find next available key that's not already bound
  const usedKeys = new Set(existing.map(a => a.key));
  const defaultKeys = ['j', 'k', 'l', 'u', 'i', 'o', ' '];
  const nextKey = defaultKeys.find(k => !usedKeys.has(k)) || 'j';

  existing.push({ id: `atk_${existing.length}`, key: nextKey, segment: '', cooldown: 1.0 });
  meta.behavior.attacks = existing;

  // Build segment options for the dropdown
  const segments = editor.getObjectSegments(id);
  const clips = editor.getAnimationClips(id);
  const segOptions: Array<{ value: string; label: string }> = [{ value: '', label: '（未指定）' }];
  segments.forEach((seg: any) => segOptions.push({ value: `seg:${seg.name}`, label: `▸ ${seg.name} [${seg.startFrame}-${seg.endFrame}]` }));
  clips.forEach((clip: string) => segOptions.push({ value: `clip:${clip}`, label: `♪ ${clip}` }));

  buildMultiAttackUI(existing, segOptions);
});

combatAttackStrategy.addEventListener('change', applyMultiAttacks);

// --- Dash UI ---
const dashEnabled = document.getElementById('dash-enabled') as HTMLInputElement;
const dashFields = document.getElementById('dash-fields') as HTMLDivElement;
const dashKeyInput = document.getElementById('dash-key-input') as HTMLInputElement;
const dashDistance = document.getElementById('dash-distance') as HTMLInputElement;
const dashDuration = document.getElementById('dash-duration') as HTMLInputElement;
const dashCooldown = document.getElementById('dash-cooldown') as HTMLInputElement;
const dashSegment = document.getElementById('dash-segment') as HTMLSelectElement;
const dashInvincible = document.getElementById('dash-invincible') as HTMLInputElement;
const dashPhaseThrough = document.getElementById('dash-phase-through') as HTMLInputElement;

// Key data stored in dataset
dashKeyInput.dataset.keyValue = 'shift';

dashEnabled.addEventListener('change', () => {
  dashFields.style.display = dashEnabled.checked ? '' : 'none';
  applyDashConfig();
});

// Dash key capture (same pattern as attack keys)
dashKeyInput.addEventListener('focus', () => {
  dashKeyInput.value = '⌨ ...';
  dashKeyInput.style.borderColor = '#7fe7dd';
});
dashKeyInput.addEventListener('keydown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const key = e.key.toLowerCase();
  // Check conflict with attack keys
  const bound = getAllBoundKeys();
  if (bound.has(key)) {
    dashKeyInput.style.borderColor = '#f44';
    dashKeyInput.value = `⚠ ${formatKeyDisplay(key)} 已用`;
    setTimeout(() => {
      dashKeyInput.value = formatKeyDisplay(dashKeyInput.dataset.keyValue || 'shift');
      dashKeyInput.style.borderColor = '#555';
      dashKeyInput.blur();
    }, 1000);
    return;
  }
  dashKeyInput.dataset.keyValue = key;
  dashKeyInput.value = formatKeyDisplay(key);
  dashKeyInput.style.borderColor = '#555';
  dashKeyInput.blur();
  applyDashConfig();
});
dashKeyInput.addEventListener('blur', () => {
  if (dashKeyInput.value === '⌨ ...') {
    dashKeyInput.value = formatKeyDisplay(dashKeyInput.dataset.keyValue || 'shift');
  }
  dashKeyInput.style.borderColor = '#555';
});

dashDistance.addEventListener('change', applyDashConfig);
dashDuration.addEventListener('change', applyDashConfig);
dashCooldown.addEventListener('change', applyDashConfig);
dashSegment.addEventListener('change', applyDashConfig);
dashInvincible.addEventListener('change', applyDashConfig);
dashPhaseThrough.addEventListener('change', applyDashConfig);

function applyDashConfig() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta?.behavior) return;
  meta.behavior.dashEnabled = dashEnabled.checked;
  meta.behavior.dashKey = dashKeyInput.dataset.keyValue || 'shift';
  meta.behavior.dashDistance = parseFloat(dashDistance.value) || 120;
  meta.behavior.dashDuration = parseFloat(dashDuration.value) || 0.2;
  meta.behavior.dashCooldown = parseFloat(dashCooldown.value) || 1.5;
  meta.behavior.dashSegment = dashSegment.value || undefined;
  meta.behavior.dashInvincible = dashInvincible.checked;
  meta.behavior.dashPhaseThrough = dashPhaseThrough.checked;
}

function refreshDashUI(meta: any, segOptions: Array<{ value: string; label: string }>) {
  const b = meta?.behavior;
  dashEnabled.checked = b?.dashEnabled ?? false;
  dashFields.style.display = dashEnabled.checked ? '' : 'none';
  dashKeyInput.dataset.keyValue = b?.dashKey ?? 'shift';
  dashKeyInput.value = formatKeyDisplay(b?.dashKey ?? 'shift');
  dashDistance.value = String(b?.dashDistance ?? 120);
  dashDuration.value = String(b?.dashDuration ?? 0.2);
  dashCooldown.value = String(b?.dashCooldown ?? 1.5);
  dashInvincible.checked = b?.dashInvincible ?? true;
  dashPhaseThrough.checked = b?.dashPhaseThrough ?? true;
  // Build dash segment dropdown
  dashSegment.innerHTML = '';
  segOptions.forEach(opt => {
    const el = document.createElement('option');
    el.value = opt.value; el.textContent = opt.label;
    if (opt.value === (b?.dashSegment || '')) el.selected = true;
    dashSegment.appendChild(el);
  });
}

function refreshBehaviorPanel() {
  const id = editor.getSelectedId();
  if (!id) return;

  const hasAnim = editor.hasAnimations(id);

  // Sync behavior/combat panel enable states (uses meta declared below)
  const metaForPanels = editor.getMeta(id);
  const behaviorEnabledEl = document.getElementById('behavior-enabled') as HTMLInputElement;
  const combatEnabledEl = document.getElementById('combat-enabled') as HTMLInputElement;
  if (behaviorEnabledEl) {
    const hasBehavior = !!(metaForPanels?.behavior && (metaForPanels.behavior.walkSegment || metaForPanels.behavior.idleSegment || metaForPanels.behavior.isPlayer));
    behaviorEnabledEl.checked = hasBehavior;
    document.getElementById('behavior-panel-wrap')?.classList.toggle('disabled', !hasBehavior);
    if (hasBehavior) {
      document.getElementById('behavior-body')?.classList.add('open');
      document.getElementById('behavior-arrow')?.classList.add('open');
    }
  }
  if (combatEnabledEl) {
    const hasCombat = !!(metaForPanels?.behavior && (metaForPanels.behavior.hp || metaForPanels.behavior.attackDamage || metaForPanels.behavior.isAggressive));
    combatEnabledEl.checked = hasCombat;
    document.getElementById('combat-panel-wrap')?.classList.toggle('disabled', !hasCombat);
    if (hasCombat) {
      document.getElementById('combat-body')?.classList.add('open');
      document.getElementById('combat-arrow')?.classList.add('open');
    }
  }

  const meta = editor.getMeta(id);
  const segments = editor.getObjectSegments(id);
  const clips = editor.getAnimationClips(id);

  // Build options: custom segments + full clips
  const options: Array<{ value: string; label: string }> = [{ value: '', label: '（未指定）' }];
  segments.forEach((seg) => options.push({ value: `seg:${seg.name}`, label: `▸ ${seg.name} [${seg.startFrame}-${seg.endFrame}]` }));
  clips.forEach((clip) => options.push({ value: `clip:${clip}`, label: `♪ ${clip}` }));

  const buildSelect = (select: HTMLSelectElement, currentValue: string) => {
    select.innerHTML = '';
    options.forEach((opt) => {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      if (opt.value === currentValue) el.selected = true;
      select.appendChild(el);
    });
  };

  buildSelect(behaviorWalk, meta?.behavior?.walkSegment || '');
  buildSelect(behaviorIdle, meta?.behavior?.idleSegment || '');
  behaviorSpeed.value = String(meta?.behavior?.speed ?? 40);
  behaviorWalkEnabled.checked = meta?.behavior?.enableWalk !== false;
  behaviorIdleEnabled.checked = meta?.behavior?.enableIdle !== false;
  behaviorIsPlayer.checked = meta?.behavior?.isPlayer ?? false;

  // Combat fields
  combatHp.value = String(meta?.behavior?.hp ?? 100);
  combatAggressive.checked = meta?.behavior?.isAggressive ?? false;
  combatAggroRange.value = String(meta?.behavior?.aggroRange ?? 150);
  combatTeam.value = String(meta?.behavior?.team ?? (meta?.behavior?.isPlayer ? 0 : 1));
  const canAttack = meta?.behavior?.canAttackTeams ?? (meta?.behavior?.isPlayer ? [1] : [0]);
  combatTarget0.checked = canAttack.includes(0);
  combatTarget1.checked = canAttack.includes(1);
  combatTarget2.checked = canAttack.includes(2);

  buildSelect(combatAttackSeg, meta?.behavior?.attackSegment || '');
  buildSelect(combatHitSeg, meta?.behavior?.hitSegment || '');
  buildSelect(combatDeathSeg, meta?.behavior?.deathSegment || '');

  // Multi-attack UI
  buildMultiAttackUI(meta?.behavior?.attacks, options);
  combatAttackStrategy.value = meta?.behavior?.attackStrategy || 'random';

  // Dash UI
  refreshDashUI(meta, options);
}

function applyBehavior() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;

  meta.behavior = {
    walkSegment: behaviorWalk.value || undefined,
    idleSegment: behaviorIdle.value || undefined,
    speed: parseFloat(behaviorSpeed.value) || 40,
    enableWalk: behaviorWalkEnabled.checked,
    enableIdle: behaviorIdleEnabled.checked,
    isPlayer: behaviorIsPlayer.checked,
    // Combat
    hp: parseInt(combatHp.value) || 100,
    attackSegment: combatAttackSeg.value || undefined,
    hitSegment: combatHitSeg.value || undefined,
    deathSegment: combatDeathSeg.value || undefined,
    isAggressive: combatAggressive.checked,
    aggroRange: parseInt(combatAggroRange.value) || 150,
    team: parseInt(combatTeam.value),
    canAttackTeams: [
      ...(combatTarget0.checked ? [0] : []),
      ...(combatTarget1.checked ? [1] : []),
      ...(combatTarget2.checked ? [2] : []),
    ],
    // Multi-attack (preserve from UI)
    attacks: readMultiAttacksFromUI().length > 0 ? readMultiAttacksFromUI() : undefined,
    attackStrategy: (combatAttackStrategy.value as any) || 'random',
    // Dash
    dashEnabled: dashEnabled.checked,
    dashKey: dashKeyInput.dataset.keyValue || 'shift',
    dashDistance: parseFloat(dashDistance.value) || 120,
    dashDuration: parseFloat(dashDuration.value) || 0.2,
    dashCooldown: parseFloat(dashCooldown.value) || 1.5,
    dashSegment: dashSegment.value || undefined,
    dashInvincible: dashInvincible.checked,
    dashPhaseThrough: dashPhaseThrough.checked,
  };

  // Attack range visualization is only shown when combat marker is selected
  // Don't auto-show from behavior panel
}

behaviorWalk.addEventListener('change', applyBehavior);
behaviorIdle.addEventListener('change', applyBehavior);
behaviorSpeed.addEventListener('change', applyBehavior);
behaviorWalkEnabled.addEventListener('change', applyBehavior);
behaviorIdleEnabled.addEventListener('change', applyBehavior);
behaviorIsPlayer.addEventListener('change', applyBehavior);
combatHp.addEventListener('change', applyBehavior);
combatAttackSeg.addEventListener('change', applyBehavior);
combatHitSeg.addEventListener('change', applyBehavior);
combatDeathSeg.addEventListener('change', applyBehavior);
combatAggressive.addEventListener('change', applyBehavior);
combatAggroRange.addEventListener('change', applyBehavior);
combatTeam.addEventListener('change', applyBehavior);
combatTarget0.addEventListener('change', applyBehavior);
combatTarget1.addEventListener('change', applyBehavior);
combatTarget2.addEventListener('change', applyBehavior);

// Attack range visibility toggle
document.getElementById('combat-toggle-vis')!.addEventListener('click', () => {
  const visible = !editor.isAttackRangeVisible();
  editor.setAttackRangeVisibility(visible);
  (document.getElementById('combat-toggle-vis') as HTMLButtonElement).textContent = visible ? '👁 攻擊範圍顯示/隱藏' : '👁‍🗨 攻擊範圍已隱藏';
});

// --- Material Slots & Textures ---
const materialSlotsContainer = document.getElementById('material-slots')!;

function refreshMaterialSlots(id: string) {
  materialSlotsContainer.innerHTML = '';
  const slots = editor.getMaterialSlots(id);

  if (slots.length === 0) {
    materialSlotsContainer.innerHTML = '<p class="hint">無材質</p>';
    return;
  }

  slots.forEach((slot) => {
    const div = document.createElement('div');
    div.className = 'mat-slot';
    const statusIcons = [
      slot.hasMap ? '🎨' : '⬜',
      slot.hasNormalMap ? '🗺️' : '⬜',
      slot.hasRoughnessMap ? '📐' : '⬜',
    ].join('');

    div.innerHTML = `
      <div class="mat-slot-header">
        <span class="mat-slot-name">${slot.name}</span>
        <span class="mat-slot-mesh">${slot.meshName}</span>
      </div>
      <div class="mat-slot-status">${statusIcons} <span class="hint">Diff/Norm/Rough</span></div>
      <div class="mat-slot-actions">
        <label class="btn-mini">Diffuse<input type="file" accept=".png,.jpg,.jpeg,.webp,.tga" data-slot="${slot.index}" data-map="map" /></label>
        <label class="btn-mini">Normal<input type="file" accept=".png,.jpg,.jpeg,.webp,.tga" data-slot="${slot.index}" data-map="normalMap" /></label>
        <label class="btn-mini">Rough<input type="file" accept=".png,.jpg,.jpeg,.webp,.tga" data-slot="${slot.index}" data-map="roughnessMap" /></label>
      </div>
      <div class="mat-slot-tiling">
        <div class="input-row">
          <label>色調</label>
          <input type="color" class="mat-color" data-slot="${slot.index}" value="${slot.color}" />
          <label>亮度</label>
          <input type="range" class="mat-brightness" data-slot="${slot.index}" min="0.5" max="2" step="0.05" value="${slot.brightness.toFixed(2)}" style="width:60px" />
        </div>
        <div class="input-row">
          <label>Tile</label>
          <input type="number" class="tiling-x" data-slot="${slot.index}" step="0.1" min="0.01" value="${slot.tiling[0].toFixed(2)}" />
          <input type="number" class="tiling-y" data-slot="${slot.index}" step="0.1" min="0.01" value="${slot.tiling[1].toFixed(2)}" />
        </div>
        <div class="input-row">
          <label>Offset</label>
          <input type="number" class="offset-x" data-slot="${slot.index}" step="0.05" value="${slot.offset[0].toFixed(2)}" />
          <input type="number" class="offset-y" data-slot="${slot.index}" step="0.05" value="${slot.offset[1].toFixed(2)}" />
        </div>
      </div>
    `;
    materialSlotsContainer.appendChild(div);
  });

  // Bind file inputs
  materialSlotsContainer.querySelectorAll('input[type="file"]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const el = e.target as HTMLInputElement;
      let file = el.files?.[0];
      if (!file) return;
      // Auto-convert TGA
      if (file.name.toLowerCase().endsWith('.tga')) {
        file = await tgaToFile(file);
      }
      const slotIdx = parseInt(el.dataset.slot!);
      const mapType = el.dataset.map as 'map' | 'normalMap' | 'roughnessMap';
      const objId = editor.getSelectedId();
      if (objId) {
        editor.applyTexture(objId, file, mapType, slotIdx);
        refreshMaterialSlots(objId);
      }
    });
  });

  // Bind tiling/offset inputs
  materialSlotsContainer.querySelectorAll('.tiling-x, .tiling-y, .offset-x, .offset-y').forEach((input) => {
    input.addEventListener('change', (e) => {
      const el = e.target as HTMLInputElement;
      const slotIdx = parseInt(el.dataset.slot!);
      const objId = editor.getSelectedId();
      if (!objId) return;
      const row = el.closest('.mat-slot')!;
      const tx = parseFloat((row.querySelector(`.tiling-x[data-slot="${slotIdx}"]`) as HTMLInputElement).value) || 1;
      const ty = parseFloat((row.querySelector(`.tiling-y[data-slot="${slotIdx}"]`) as HTMLInputElement).value) || 1;
      const ox = parseFloat((row.querySelector(`.offset-x[data-slot="${slotIdx}"]`) as HTMLInputElement).value) || 0;
      const oy = parseFloat((row.querySelector(`.offset-y[data-slot="${slotIdx}"]`) as HTMLInputElement).value) || 0;
      editor.setTiling(objId, slotIdx, [tx, ty], [ox, oy]);
    });
  });

  // Bind color and brightness inputs
  materialSlotsContainer.querySelectorAll('.mat-color').forEach((input) => {
    input.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const slotIdx = parseInt(el.dataset.slot!);
      const objId = editor.getSelectedId();
      if (objId) editor.setMaterialColor(objId, slotIdx, el.value);
    });
  });
  materialSlotsContainer.querySelectorAll('.mat-brightness').forEach((input) => {
    input.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      const slotIdx = parseInt(el.dataset.slot!);
      const objId = editor.getSelectedId();
      if (objId) editor.setMaterialBrightness(objId, slotIdx, parseFloat(el.value));
    });
  });
}

// --- Asset Library ---
const assetList = document.getElementById('asset-list')!;

function refreshAssetLibrary() {
  assetList.innerHTML = '';
  const assets = editor.getAssetLibrary();
  if (assets.length === 0) {
    assetList.innerHTML = '<p class="hint">尚無素材，載入 FBX 後自動加入</p>';
    return;
  }
  assets.forEach((asset) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="asset-name">📦 ${asset.name}</span>
      <button class="btn-mini asset-spawn" data-id="${asset.assetId}">＋放置</button>
    `;
    assetList.appendChild(li);
  });

  assetList.querySelectorAll('.asset-spawn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const assetId = (e.currentTarget as HTMLElement).dataset.id!;
      await editor.spawnFromLibrary(assetId);
      refreshObjectList();
      refreshInspector();
    });
  });
}

// --- Lighting ---
const ambientSlider = document.getElementById('ed-ambient') as HTMLInputElement;
const ambientColor = document.getElementById('ed-ambient-color') as HTMLInputElement;
const sunSlider = document.getElementById('ed-sun') as HTMLInputElement;
const sunColor = document.getElementById('ed-sun-color') as HTMLInputElement;

ambientSlider.addEventListener('input', () => {
  editor.setAmbient(parseFloat(ambientSlider.value), ambientColor.value);
  document.getElementById('ed-ambient-val')!.textContent = parseFloat(ambientSlider.value).toFixed(2);
});
ambientColor.addEventListener('input', () => editor.setAmbient(parseFloat(ambientSlider.value), ambientColor.value));
sunSlider.addEventListener('input', () => {
  editor.setSun(parseFloat(sunSlider.value), sunColor.value);
  document.getElementById('ed-sun-val')!.textContent = parseFloat(sunSlider.value).toFixed(2);
});
sunColor.addEventListener('input', () => editor.setSun(parseFloat(sunSlider.value), sunColor.value));

// --- Scene Save / Load (File System Access API for directory memory) ---

async function saveSceneWithPicker() {
  showOverlay('儲存中...');
  
  // 取得目前選擇的關卡和自動生成的檔案名稱
  const levelSelector = document.getElementById('level-selector') as HTMLSelectElement;
  const levelId = levelSelector.value;
  const sceneNameInput = document.getElementById('scene-name') as HTMLInputElement;
  const fileName = sceneNameInput.value || await levelNaming.generateFileName(levelId);

  if ('showSaveFilePicker' in window) {
    let handle: any;
    try {
      const opts: any = {
        suggestedName: `${fileName}.json`,
        types: [{ description: 'Level Scene File', accept: { 'application/json': ['.json'] } }],
      };
      
      // 使用關卡命名系統的目錄記憶
      const lastDir = levelNaming.getLastDirHandle();
      if (lastDir) opts.startIn = lastDir;
      
      handle = await (window as any).showSaveFilePicker(opts);
      levelNaming.setLastDirHandle(handle);
    } catch (err: any) {
      if (err.name === 'AbortError') { hideOverlay(); return; }
      // Fall through to fallback
      handle = null;
    }

    if (handle) {
      try {
        const blob = await editor.exportBundle(fileName);
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        hideOverlay();
        showToast(`✅ 關卡場景已儲存: ${fileName}.json`);
        
        // 更新檔案名稱顯示，準備下次儲存
        await updateSceneFileName();
        return;
      } catch (err) {
        hideOverlay();
        console.error('[Save] Write failed:', err);
        alert('寫入失敗: ' + (err as Error).message);
        return;
      }
    }
  }

  // Fallback download
  try {
    const blob = await editor.exportBundle(fileName);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`✅ 關卡場景已下載: ${fileName}.json`);
    
    // 更新檔案名稱顯示，準備下次儲存
    await updateSceneFileName();
  } catch (err) {
    alert('存檔失敗: ' + (err as Error).message);
  }
  hideOverlay();
}

async function loadSceneWithPicker() {
  showOverlay('載入場景中...');
  if ('showOpenFilePicker' in window) {
    try {
      const opts: any = {
        types: [{ description: 'Level Scene File', accept: { 'application/json': ['.json'], 'application/octet-stream': ['.gz'] } }],
      };
      const lastDir = levelNaming.getLastDirHandle();
      if (lastDir) opts.startIn = lastDir;
      
      const [handle] = await (window as any).showOpenFilePicker(opts);
      levelNaming.setLastDirHandle(handle);
      
      const file = await handle.getFile();
      await processSceneFile(file);
      
      // 根據載入的檔案名稱更新關卡選擇器
      await updateLevelSelectorFromFileName(file.name);
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') { hideOverlay(); return; }
    }
  }
  loadSceneInput.click();
}

async function processSceneFile(file: File) {
  try {
    const { loaded, total } = await editor.importBundle(file);

    // Update UI
    const data = editor.exportScene('');
    const sceneNameInput = document.getElementById('scene-name') as HTMLInputElement;
    sceneNameInput.value = data.name || file.name.replace(/\.(json|gz)$/, '');
    
    ambientSlider.value = String(data.ambientIntensity);
    sunSlider.value = String(data.sunIntensity);
    document.getElementById('ed-ambient-val')!.textContent = data.ambientIntensity.toFixed(2);
    document.getElementById('ed-sun-val')!.textContent = data.sunIntensity.toFixed(2);

    if (loaded < total) {
      alert(`場景載入：${loaded}/${total} 個模型成功。\n部分模型資料可能損壞。`);
    }

    refreshAll();
    refreshAssetLibrary();
    // Clear any attack range helpers that might have been created from saved meta
    editor.clearAllAttackRangeHelpers();
    hideOverlay();
    showToast(`✅ 載入完成：${loaded} 個物件`);
  } catch (err) {
    hideOverlay();
    alert('場景載入失敗: ' + (err as Error).message);
    console.error(err);
  }
}

/**
 * 根據檔案名稱更新關卡選擇器
 */
async function updateLevelSelectorFromFileName(fileName: string): Promise<void> {
  const match = fileName.match(/^level(\d+)_\d+\.json$/);
  if (match) {
    const levelId = match[1];
    const levelSelector = document.getElementById('level-selector') as HTMLSelectElement;
    levelSelector.value = levelId;
    
    // 更新檔案名稱顯示
    await updateSceneFileName();
  }
}

/**
 * 更新場景檔案名稱顯示
 */
async function updateSceneFileName(): Promise<void> {
  const levelSelector = document.getElementById('level-selector') as HTMLSelectElement;
  const levelId = levelSelector.value;
  const sceneNameInput = document.getElementById('scene-name') as HTMLInputElement;
  
  try {
    const fileName = await levelNaming.generateFileName(levelId);
    sceneNameInput.value = fileName;
  } catch (err) {
    console.warn('無法生成檔案名稱，使用預設:', err);
    sceneNameInput.value = `level${levelId}_001`;
  }
}

document.getElementById('save-scene-btn')!.addEventListener('click', () => saveSceneWithPicker());
document.getElementById('load-scene-btn')!.addEventListener('click', () => loadSceneWithPicker());

// --- Export for Game Runtime ---
document.getElementById('export-game-btn')!.addEventListener('click', async () => {
  const sceneNameInput = document.getElementById('scene-name') as HTMLInputElement;
  const fileName = sceneNameInput.value.trim() || 'untitled';
  showOverlay('匯出遊戲中...');

  if ('showDirectoryPicker' in window) {
    try {
      const opts: any = { mode: 'readwrite' };
      const lastDir = levelNaming.getLastDirHandle();
      if (lastDir) opts.startIn = lastDir;
      
      const dirHandle = await (window as any).showDirectoryPicker(opts);
      levelNaming.setLastDirHandle(dirHandle);

      const { sceneJson, prefabs, textureFiles, modelFiles } = await editor.exportForGame(fileName);

      // Create subdirectories
      const prefabDir = await dirHandle.getDirectoryHandle('prefabs', { create: true });
      const texDir = await dirHandle.getDirectoryHandle('textures', { create: true });
      const modelDir = await dirHandle.getDirectoryHandle('models', { create: true });

      // Write scene JSON (使用 .douqi.json 副檔名以符合遊戲格式)
      const jsonHandle = await dirHandle.getFileHandle(`${fileName}.douqi.json`, { create: true });
      const jsonW = await jsonHandle.createWritable();
      await jsonW.write(sceneJson);
      await jsonW.close();

      // Write prefabs
      for (const pf of prefabs) {
        const pfName = pf.path.replace('prefabs/', '');
        const fh = await prefabDir.getFileHandle(pfName, { create: true });
        const w = await fh.createWritable();
        await w.write(pf.json);
        await w.close();
      }

      // Write textures
      for (const tf of textureFiles) {
        const tfName = tf.path.replace('textures/', '');
        const fh = await texDir.getFileHandle(tfName, { create: true });
        const w = await fh.createWritable();
        await w.write(tf.blob);
        await w.close();
      }

      // Write models
      for (const mf of modelFiles) {
        const mfName = mf.path.replace('models/', '');
        const fh = await modelDir.getFileHandle(mfName, { create: true });
        const w = await fh.createWritable();
        await w.write(mf.blob);
        await w.close();
      }

      alert(
        `匯出完成！\n` +
        `📄 場景: ${fileName}.douqi.json\n` +
        `🧩 Prefab: ${prefabs.length} 個\n` +
        `🖼️ 貼圖: ${textureFiles.length} 個\n` +
        `📦 模型: ${modelFiles.length} 個`
      );
    } catch (err: any) {
      if (err.name === 'AbortError') { hideOverlay(); return; }
      alert('匯出失敗: ' + err.message);
    }
    hideOverlay();
  } else {
    // Fallback: download files individually
    const { sceneJson, prefabs, textureFiles, modelFiles } = await editor.exportForGame(fileName);

    const download = (content: string | Blob, fileName: string) => {
      const blob = typeof content === 'string' ? new Blob([content], { type: 'application/json' }) : content;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; a.click();
      URL.revokeObjectURL(url);
    };

    download(sceneJson, `${fileName}.douqi.json`);
    for (const pf of prefabs) download(pf.json, pf.path.replace('prefabs/', ''));
    for (const tf of textureFiles) download(tf.blob, tf.path.replace('textures/', ''));
    for (const mf of modelFiles) download(mf.blob, mf.path.replace('models/', ''));

    hideOverlay();
    alert(
      `已下載所有檔案。請依以下結構放置：\n` +
      `├── ${name}.scene.json\n` +
      `├── prefabs/  (${prefabs.length} 個 .prefab.json)\n` +
      `├── textures/ (${textureFiles.length} 個圖片)\n` +
      `└── models/   (${modelFiles.length} 個 .fbx)`
    );
  }
});

const loadSceneInput = document.getElementById('load-scene-input') as HTMLInputElement;
loadSceneInput.addEventListener('change', async () => {
  showOverlay('載入場景中...');
  const file = loadSceneInput.files?.[0];
  if (!file) { hideOverlay(); return; }
  await processSceneFile(file);
  loadSceneInput.value = '';
});

// --- Import Prefab File ---
const importPrefabInput = document.getElementById('import-prefab-input') as HTMLInputElement;
importPrefabInput.addEventListener('change', async () => {
  const file = importPrefabInput.files?.[0];
  if (!file) return;
  try {
    const pfId = await editor.importPrefabFromFile(file);
    if (pfId) {
      refreshPrefabList();
      refreshAssetLibrary();
      alert(`✅ Prefab 匯入成功！`);
    }
  } catch (err) {
    alert('Prefab 匯入失敗: ' + (err as Error).message);
  }
  importPrefabInput.value = '';
});

// --- Prefab Panel ---
const prefabList = document.getElementById('prefab-list')!;

function refreshPrefabList() {
  prefabList.innerHTML = '';
  const prefabs = editor.getPrefabList();
  if (prefabs.length === 0) {
    prefabList.innerHTML = '<p class="hint">選取物件後點「存為 Prefab」</p>';
    return;
  }
  prefabs.forEach((pf) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="prefab-info">
        <span>💎 ${pf.name}</span>
        <span class="prefab-model">${pf.model}</span>
      </div>
      <div class="prefab-actions">
        <button class="btn-mini prefab-spawn" data-id="${pf.id}">＋放置</button>
        <button class="btn-mini prefab-edit" data-id="${pf.id}">✏️</button>
        <button class="btn-mini prefab-del" data-id="${pf.id}" style="color:#f38ba8">✕</button>
      </div>
    `;
    prefabList.appendChild(li);
  });

  prefabList.querySelectorAll('.prefab-spawn').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const pfId = (e.currentTarget as HTMLElement).dataset.id!;
      await editor.spawnFromPrefab(pfId);
      refreshAll();
    });
  });

  prefabList.querySelectorAll('.prefab-edit').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      const pfId = (e.currentTarget as HTMLElement).dataset.id!;

      // Try to find an existing instance of this prefab on scene
      const existingId = editor.findObjectByPrefabId(pfId);
      if (existingId) {
        editor.select(existingId);
        refreshAll();
        return;
      }

      // No existing instance — spawn one and select it
      await editor.spawnFromPrefab(pfId);
      refreshAll();
    });
  });

  prefabList.querySelectorAll('.prefab-del').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const pfId = (e.currentTarget as HTMLElement).dataset.id!;
      if (confirm('確定刪除此 Prefab？')) {
        editor.deletePrefab(pfId);
        refreshPrefabList();
      }
    });
  });
}

editor.onPrefabChange = () => {
  refreshPrefabList();
};

// Initial state
refreshObjectList();
refreshInspector();
refreshHistoryButtons();
refreshAssetLibrary();
refreshPrefabList();

editor.onAssetLibraryChange = () => {
  refreshAssetLibrary();
};

// --- Save as Prefab (exports to file) ---
document.getElementById('save-prefab-btn')!.addEventListener('click', async () => {
  console.log('[Prefab] Save button clicked');
  const id = editor.getSelectedId();
  if (!id) { alert('請先選取一個物件'); return; }
  const meta = editor.getMeta(id);
  if (!meta) { alert('物件資料不存在'); return; }

  const defaultName = meta.name;

  // Save to internal registry
  const prefabId = editor.saveToPrefab(id, defaultName);
  if (!prefabId) { alert('❌ Prefab 建立失敗'); return; }

  // Export to file
  const blob = await editor.exportPrefabToFile(prefabId);
  if (!blob) { alert('❌ Prefab 資料匯出失敗'); return; }

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${defaultName}.prefab.json`,
        types: [{ description: 'Prefab File', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      refreshPrefabList();
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.warn('File picker failed, using download fallback', err);
    }
  }

  // Fallback: download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${defaultName}.prefab.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  refreshPrefabList();
});

// --- Update Prefab ---
const updatePrefabBtn = document.getElementById('update-prefab-btn')!;

updatePrefabBtn.addEventListener('click', () => {
  const id = editor.getSelectedId();
  if (!id) { alert('請先選取一個物件'); return; }
  const meta = editor.getMeta(id);
  if (!meta) return;

  const pfId = editor.findPrefabIdByModel(meta.modelPath);
  if (pfId) {
    editor.startEditPrefab(pfId);
    editor.finishEditPrefab(id);
    refreshPrefabList();
    showToast('✅ Prefab 已更新');
  } else {
    const newPfId = editor.saveToPrefab(id, meta.name);
    if (newPfId) {
      refreshPrefabList();
      showToast('✅ 已建立新 Prefab');
    }
  }
});

function showToast(msg: string) {
  const existing = document.getElementById('editor-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'editor-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.85); color: #fff; padding: 14px 28px;
    border-radius: 8px; font-size: 14px; font-weight: 600;
    pointer-events: none; z-index: 9999;
    animation: toastFade 1.5s ease forwards;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1500);
}

// --- Play Mode ---
const playBtn = document.getElementById('play-btn')!;
const stopBtn = document.getElementById('stop-btn')!;
const debugBtn = document.getElementById('debug-btn')!;
let debugVisible = false;

playBtn.addEventListener('click', () => {
  const metas = editor.getAllMeta().filter(m => m.modelPath !== '__camera__');
  const objects = editor.getObjects();
  const animMap = editor.getObjectAnimationsMap();
  const fpsMap = editor.getObjectFPSMap();

  editor.deselect();
  editor.stopAllAnimations();
  vfxGizmo.hide();
  editor.getOrbitControls().enabled = false;
  editor.setEditorHelpersVisible(false);
  editor.setInputLocked(true);
  // Ensure transform gizmo is fully gone
  editor.getTransformControls().detach();
  // Clear editor attack range helpers before Play (remove completely)
  editor.clearAllAttackRangeHelpers();

  // Get scene camera and follow settings
  const sceneCam = editor.getSceneCameraObject();
  const followTarget = editor.getCameraFollowTarget();

  playMode.start();

  // Hide camera preview during play
  hideCameraPreview();

  playBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  debugBtn.classList.remove('hidden');
  document.getElementById('left-panel')!.style.display = 'none';
  document.getElementById('right-panel')!.style.display = 'none';
  document.getElementById('timeline-panel')!.style.display = 'none';
  window.dispatchEvent(new Event('resize'));
  showToast('▶ 遊戲執行中 (WASD 移動)');
});

stopBtn.addEventListener('click', () => {
  playMode.stop();

  editor.getOrbitControls().enabled = true;
  editor.setEditorHelpersVisible(true);
  editor.setInputLocked(false);
  debugVisible = false;
  fpsVisible = false;
  fpsCounter.style.display = 'none';

  stopBtn.classList.add('hidden');
  debugBtn.classList.add('hidden');
  playBtn.classList.remove('hidden');
  document.getElementById('left-panel')!.style.display = '';
  document.getElementById('right-panel')!.style.display = '';
  document.getElementById('timeline-panel')!.style.display = '';
  window.dispatchEvent(new Event('resize'));
  refreshAll();
  showToast('⏹ 已停止');
});

debugBtn.addEventListener('click', () => {
  debugVisible = !debugVisible;
  // Only toggle collider/attack-range helpers, not transform controls or grid
  editor.setDebugHelpersVisible(debugVisible);
  // playMode.setDebugVisible removed
  // Toggle FPS counter
  fpsVisible = debugVisible;
  fpsCounter.style.display = debugVisible ? 'block' : 'none';
  debugBtn.textContent = debugVisible ? '🐛 Debug ON' : '🐛 Debug';
});

// --- FPS Counter ---
const fpsCounter = document.getElementById('fps-counter')!;
let fpsFrameCount = 0;
let fpsLastTime = performance.now();
let fpsVisible = false;

function updateFPS() {
  fpsFrameCount++;
  const now = performance.now();
  if (now - fpsLastTime >= 500) {
    const fps = Math.round(fpsFrameCount / ((now - fpsLastTime) / 1000));
    fpsCounter.textContent = `FPS: ${fps}`;
    fpsFrameCount = 0;
    fpsLastTime = now;
  }
}

// Hook PlayMode + VFX update into editor's animation loop
editor.onUpdate = (delta) => {
  if (playMode.isActive()) {
    playMode.update(delta);
    if (fpsVisible) updateFPS();
  }
  editorVfx.update(delta);
  editorAttackIndicator?.update(delta);
  vfxGizmo.update();
};

// --- Export Standalone Game (EXE) ---
document.getElementById('export-standalone-btn')!.addEventListener('click', async () => {
  const name = (document.getElementById('scene-name') as HTMLInputElement).value.trim() || 'game';

  // Ask user for output directory
  let outputDir = '';
  if ('showDirectoryPicker' in window) {
    try {
      const dirHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      // Get the directory path — we'll pass it to the server for copying
      // Note: File System Access API doesn't expose full path, so we ask user
      const pathPrompt = prompt(
        '已選擇輸出資料夾。\n請貼上該資料夾的完整路徑（例如 D:\\MyGame）：\n\n（因為瀏覽器安全限制，無法自動取得路徑）',
        ''
      );
      if (pathPrompt) outputDir = pathPrompt.trim();
    } catch (e: any) {
      if (e.name === 'AbortError') return;
    }
  }

  if (!outputDir) {
    outputDir = prompt('請輸入 EXE 輸出路徑（留空則輸出到專案的 release/ 資料夾）：', '') || '';
  }

  showOverlay('正在打包 EXE...\n（vite build + neu build，約 30 秒）');

  try {
    const bundleBlob = await editor.exportBundle(name);

    // exportBundle returns gzip — decompress to get JSON text for server
    let bundleText: string;
    const header = new Uint8Array(await bundleBlob.slice(0, 2).arrayBuffer());
    if (header[0] === 0x1f && header[1] === 0x8b && 'DecompressionStream' in window) {
      const ds = new (window as any).DecompressionStream('gzip');
      bundleText = await new Response(bundleBlob.stream().pipeThrough(ds)).text();
    } else {
      bundleText = await bundleBlob.text();
    }

    const resp = await fetch('/__build_exe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sceneBundle: bundleText,
        outputDir: outputDir || undefined,
      }),
    });
    const result = await resp.json();

    hideOverlay();
    if (result.success) {
      const outPath = result.path || 'release/';
      showToast(`✅ EXE 已產出`);
      alert(
        `打包完成！\n\n` +
        `📁 ${outPath}/DouQi_Game-win_x64.exe\n` +
        `📁 ${outPath}/resources.neu\n\n` +
        `兩個檔案放在一起即可執行遊戲。`
      );
    } else {
      alert('打包失敗: ' + result.error);
    }
  } catch (err: any) {
    hideOverlay();
    if (err.message?.includes('Failed to fetch')) {
      alert('⚠️ 無法連線 Vite dev server。\n\n請確認 npm run dev 正在執行，或手動執行「打包遊戲.bat」。');
      try {
        const bundleBlob2 = await editor.exportBundle(name);
        const header2 = new Uint8Array(await bundleBlob2.slice(0, 2).arrayBuffer());
        let text2: string;
        if (header2[0] === 0x1f && header2[1] === 0x8b && 'DecompressionStream' in window) {
          const ds2 = new (window as any).DecompressionStream('gzip');
          text2 = await new Response(bundleBlob2.stream().pipeThrough(ds2)).text();
        } else {
          text2 = await bundleBlob2.text();
        }
        await fetch('/__save_bundle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text2 });
      } catch { /* ignore */ }
    } else {
      alert('打包失敗: ' + err.message);
    }
  }
});

// --- Timeline Integration ---
let timelineActiveClipName: string | null = null;
let timelineActiveSegment: { name: string; clipName: string; startFrame: number; endFrame: number } | null = null;
let timelineAction: any = null;

let timelinePrevFrame = 0;

timeline.onFrameChange = (frame) => {
  const id = editor.getSelectedId();
  if (!id) return;
  if (!timelineAction) return;
  const fps = editor.getObjectFPS(id) || 30;

  if (timelineActiveSegment) {
    // Scrub within segment: frame is relative to segment start
    const absoluteTime = (timelineActiveSegment.startFrame + frame) / fps;
    timelineAction.time = absoluteTime;
    const mixer = editor.getMixer(id);
    if (mixer) mixer.update(0);
  } else if (timelineActiveClipName) {
    // Scrub full clip
    timelineAction.time = frame / fps;
    const mixer = editor.getMixer(id);
    if (mixer) mixer.update(0);
  }

  // Trigger VFX when playhead crosses marker frames during playback
  if (timeline.isPlaying() && timelineActiveSegment) {
    const vfxTrackMarkers = timeline.getMarkers(2); // VFX track is index 2
    for (const marker of vfxTrackMarkers) {
      if (timelinePrevFrame < marker.frame && frame >= marker.frame) {
        // Crossed this marker — spawn VFX at marker's configured offset
        const obj = editor.getObjects().get(id);
        if (obj) {
          const offset = marker.offset || [0, 50, 30];
          const localPos = new THREE.Vector3(offset[0], offset[1], offset[2]);
          const worldPos = localPos.applyMatrix4(obj.matrixWorld);

          // Direction from marker rotation (or default to object forward)
          let dir: THREE.Vector3;
          if (marker.rotation) {
            const euler = new THREE.Euler(
              THREE.MathUtils.degToRad(marker.rotation[0]),
              THREE.MathUtils.degToRad(marker.rotation[1]),
              THREE.MathUtils.degToRad(marker.rotation[2]),
            );
            dir = new THREE.Vector3(0, 0, 1).applyEuler(euler);
            // Apply parent rotation
            dir.applyQuaternion(obj.quaternion);
          } else {
            const rot = obj.rotation.y;
            dir = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
          }

          editorVfx.spawn(marker.presetId, worldPos, dir, marker.scale ?? 1.0);
        }
      }
    }

    // Trigger attack indicators when playhead crosses combat event frames with showIndicator
    if (timelineActiveSegment) {
      const id2 = editor.getSelectedId();
      if (id2) {
        const segs = editor.getObjectSegments(id2);
        const seg = segs.find(s => s.name === timelineActiveSegment!.name
          && s.clipName === timelineActiveSegment!.clipName
          && s.startFrame === timelineActiveSegment!.startFrame
          && s.endFrame === timelineActiveSegment!.endFrame);
        if (seg?.combatEvents) {
          for (const ev of seg.combatEvents) {
            if (!ev.showIndicator) continue;
            // Spawn at segment START (not at marker frame) so it fades in before hit
            const segStartFrame = timelineActiveSegment!.startFrame;
            const relativeFrame = 0; // trigger at start of segment playback
            if (timelinePrevFrame <= relativeFrame && frame > relativeFrame) {
              const obj = editor.getObjects().get(id2);
              if (obj && editorAttackIndicator) { // safe null check
                const fadeTime = ev.frame / fps; // fade in from start to marker frame
                editorAttackIndicator.spawn(
                  obj,
                  ev.shape || 'cone',
                  ev.range, ev.angle || 120, ev.width || 60,
                  ev.forwardOffset || 0,
                  Math.max(0.2, fadeTime),
                );
              }
            }
          }
        }
      }
    }
  }
  timelinePrevFrame = frame;
};

timeline.onPlayStateChange = (_playing) => {
  // Reset prev frame on play start to avoid false triggers
  if (_playing) timelinePrevFrame = timeline.getCurrentFrame();
};

// VFX Marker: double-click on VFX track adds a marker
timeline.onMarkerAdd = (trackIdx, frame) => {
  const id = editor.getSelectedId();
  if (!id) return;

  // Check if this is a Combat track or VFX track
  const track = (timeline as any).tracks?.[trackIdx];
  if (track?.type === 'combat') {
    // Add combat marker
    timeline.addMarker(trackIdx, {
      frame,
      presetId: 'combat',
      label: `Hit@${frame}`,
      color: '#e64553',
    });
    // Save immediately
    saveCombatMarkersToSegment(timeline.getMarkers(trackIdx));
  } else {
    // Add VFX marker
    timeline.addMarker(trackIdx, {
      frame,
      presetId: 'hit_spark',
      label: '打擊火花',
      color: '#ff8800',
      scale: 1.0,
    });
  }
};

// Marker change: save to correct segment field based on track type
timeline.onMarkerChanged = (trackIdx, markers) => {
  const id = editor.getSelectedId();
  if (!id || !timelineActiveSegment) return;
  const track = (timeline as any).tracks?.[trackIdx];
  if (track?.type === 'combat') {
    saveCombatMarkersToSegment(markers);
  } else {
    saveMarkersToSegment(markers);
  }
};

// VFX Marker: when a marker is selected, show property panel
const markerPropsPanel = document.getElementById('tl-marker-props')!;
const markerPresetSelect = document.getElementById('tl-marker-preset') as HTMLSelectElement;
const markerScaleInput = document.getElementById('tl-marker-scale') as HTMLInputElement;
const markerFrameLabel = document.getElementById('tl-marker-frame-label')!;
const markerDeleteBtn = document.getElementById('tl-marker-delete')!;

/** Refresh the marker preset dropdown to include custom presets */
function refreshMarkerPresetDropdown() {
  const currentValue = markerPresetSelect.value;
  markerPresetSelect.innerHTML = '';

  // Built-in presets by category
  const builtInGroups: Record<string, Array<{ id: string; name: string }>> = {
    '命中特效': [],
    '攻擊特效': [],
    '其他': [],
  };
  for (const [id, p] of Object.entries(VFX_PRESETS)) {
    if (id.startsWith('hit_')) builtInGroups['命中特效'].push({ id, name: p.name });
    else if (id.startsWith('attack_')) builtInGroups['攻擊特效'].push({ id, name: p.name });
    else builtInGroups['其他'].push({ id, name: p.name });
  }
  for (const [groupName, items] of Object.entries(builtInGroups)) {
    if (items.length === 0) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = groupName;
    for (const item of items) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = item.name;
      optgroup.appendChild(opt);
    }
    markerPresetSelect.appendChild(optgroup);
  }

  // Custom presets
  if (vfxCustomPresets.size > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = '⭐ 自製特效';
    for (const [id, p] of vfxCustomPresets) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = p.name;
      customGroup.appendChild(opt);
    }
    markerPresetSelect.appendChild(customGroup);
  }

  // Restore selection
  if (currentValue) markerPresetSelect.value = currentValue;
}

// Combat properties panel elements
const combatPropsPanel = document.getElementById('tl-combat-props')!;
const combatDamageInput = document.getElementById('tl-combat-damage') as HTMLInputElement;
const combatRangeInput = document.getElementById('tl-combat-range') as HTMLInputElement;
const combatAngleInput = document.getElementById('tl-combat-angle') as HTMLInputElement;
const combatCooldownInput = document.getElementById('tl-combat-cooldown') as HTMLInputElement;
const combatKbForce = document.getElementById('tl-combat-kb-force') as HTMLInputElement;
const combatKbUp = document.getElementById('tl-combat-kb-up') as HTMLInputElement;
const combatShapeSelect = document.getElementById('tl-combat-shape') as HTMLSelectElement;
const combatOffsetInput = document.getElementById('tl-combat-offset') as HTMLInputElement;
const combatWidthInput = document.getElementById('tl-combat-width') as HTMLInputElement;
const combatWidthLabel = document.getElementById('tl-combat-width-label')!;
const combatIndicatorCheck = document.getElementById('tl-combat-indicator') as HTMLInputElement;
const combatFrameLabel = document.getElementById('tl-combat-frame-label')!;
const combatDeleteBtn = document.getElementById('tl-combat-delete')!;

let selectedCombatMarkerIdx: number = -1;

timeline.onMarkerSelected = (marker) => {
  if (!marker) {
    markerPropsPanel.classList.add('hidden');
    combatPropsPanel.classList.add('hidden');
    vfxGizmo.hide();
    selectedCombatMarkerIdx = -1;
    // Hide attack range helper when no combat marker selected
    editor.clearAllAttackRangeHelpers();
    // Re-attach transform controls to selected object
    const id = editor.getSelectedId();
    if (id) {
      const obj = editor.getObjects().get(id);
      if (obj) editor.getTransformControls().attach(obj);
    }
    return;
  }

  // Determine if this is a combat or VFX marker
  const isCombat = marker.presetId === 'combat';

  if (isCombat) {
    // Show combat panel, hide VFX panel
    markerPropsPanel.classList.add('hidden');
    combatPropsPanel.classList.remove('hidden');
    vfxGizmo.hide();

    // Find the corresponding CombatEvent
    const id = editor.getSelectedId();
    if (id && timelineActiveSegment) {
      const segs = editor.getObjectSegments(id);
      const seg = segs.find(s => s.name === timelineActiveSegment!.name
        && s.clipName === timelineActiveSegment!.clipName
        && s.startFrame === timelineActiveSegment!.startFrame
        && s.endFrame === timelineActiveSegment!.endFrame);
      if (seg?.combatEvents) {
        const evIdx = seg.combatEvents.findIndex(e => e.frame === marker.frame);
        selectedCombatMarkerIdx = evIdx;
        if (evIdx >= 0) {
          const ev = seg.combatEvents[evIdx];
          combatFrameLabel.textContent = `幀: ${ev.frame}`;
          combatDamageInput.value = String(ev.damage);
          combatRangeInput.value = String(ev.range);
          combatAngleInput.value = String(ev.angle);
          combatCooldownInput.value = String(ev.cooldown);
          combatKbForce.value = String(ev.knockbackForce ?? 0);
          combatKbUp.value = String(ev.knockbackUp ?? 0);
          combatShapeSelect.value = ev.shape || 'cone';
          combatOffsetInput.value = String(ev.forwardOffset ?? 0);
          combatWidthInput.value = String(ev.width ?? 60);
          combatIndicatorCheck.checked = ev.showIndicator ?? false;
          // Show/hide width field based on shape
          const isRect = (ev.shape || 'cone') === 'rectangle';
          combatWidthInput.style.display = isRect ? '' : 'none';
          combatWidthLabel.style.display = isRect ? '' : 'none';

          // Show attack range helper with this event's range/angle/shape
          const meta = editor.getMeta(id);
          if (meta) {
            if (!meta.behavior) meta.behavior = {};
            meta.behavior.attackRange = ev.range;
            meta.behavior.attackAngle = ev.shape === 'circle' ? 360 : ev.angle;
            editor.updateAttackRangeHelper(id, ev.shape || 'cone', ev.forwardOffset, ev.width);
          }
        }
      }
    }
  } else {
    // Show VFX panel, hide combat panel
    combatPropsPanel.classList.add('hidden');
    markerPropsPanel.classList.remove('hidden');
    refreshMarkerPresetDropdown();
    markerPresetSelect.value = marker.presetId;
    markerScaleInput.value = String(marker.scale ?? 1.0);
    (document.getElementById('tl-marker-follow') as HTMLInputElement).checked = marker.followParent ?? false;
    markerFrameLabel.textContent = `Frame: ${marker.frame}`;

    // Show VFX position gizmo
    const id = editor.getSelectedId();
    if (id) {
      const obj = editor.getObjects().get(id);
      if (obj) {
        const offset = marker.offset || [0, 50, 30];
        const rotation = marker.rotation || [0, 0, 0];
        vfxGizmo.show(obj, offset as [number, number, number], rotation as [number, number, number]);
      }
    }
  }
};

// Combat panel input handlers
function applyCombatPanel() {
  const id = editor.getSelectedId();
  if (!id || !timelineActiveSegment || selectedCombatMarkerIdx < 0) return;
  const segs = editor.getObjectSegments(id);
  const seg = segs.find(s => s.name === timelineActiveSegment!.name
    && s.clipName === timelineActiveSegment!.clipName
    && s.startFrame === timelineActiveSegment!.startFrame
    && s.endFrame === timelineActiveSegment!.endFrame);
  if (!seg?.combatEvents?.[selectedCombatMarkerIdx]) return;
  const ev = seg.combatEvents[selectedCombatMarkerIdx];
  ev.damage = parseInt(combatDamageInput.value) || 10;
  ev.range = parseInt(combatRangeInput.value) || 30;
  ev.angle = parseInt(combatAngleInput.value) || 120;
  ev.cooldown = parseFloat(combatCooldownInput.value) || 1.0;
  ev.shape = combatShapeSelect.value as 'cone' | 'circle' | 'rectangle' || undefined;
  ev.forwardOffset = parseFloat(combatOffsetInput.value) || undefined;
  ev.width = combatShapeSelect.value === 'rectangle' ? (parseFloat(combatWidthInput.value) || 60) : undefined;
  ev.showIndicator = combatIndicatorCheck.checked ? true : undefined;
  const kbF = parseFloat(combatKbForce.value) || 0;
  const kbU = parseFloat(combatKbUp.value) || 0;
  ev.knockbackForce = kbF > 0 ? kbF : undefined;
  ev.knockbackUp = kbU > 0 ? kbU : undefined;
  ev.knockback = undefined;

  // Update attack range helper to reflect new range/angle from this combat event
  const meta = editor.getMeta(id);
  if (meta) {
    if (!meta.behavior) meta.behavior = {};
    meta.behavior.attackRange = ev.range;
    meta.behavior.attackAngle = ev.shape === 'circle' ? 360 : ev.angle;
    editor.updateAttackRangeHelper(id, ev.shape || 'cone', ev.forwardOffset, ev.width);
  }
}

combatDamageInput.addEventListener('change', applyCombatPanel);
combatRangeInput.addEventListener('change', applyCombatPanel);
combatAngleInput.addEventListener('change', applyCombatPanel);
combatCooldownInput.addEventListener('change', applyCombatPanel);
combatKbForce.addEventListener('change', applyCombatPanel);
combatKbUp.addEventListener('change', applyCombatPanel);
combatShapeSelect.addEventListener('change', () => {
  const isRect = combatShapeSelect.value === 'rectangle';
  combatWidthInput.style.display = isRect ? '' : 'none';
  combatWidthLabel.style.display = isRect ? '' : 'none';
  applyCombatPanel();
});
combatOffsetInput.addEventListener('change', applyCombatPanel);
combatWidthInput.addEventListener('change', applyCombatPanel);
combatIndicatorCheck.addEventListener('change', applyCombatPanel);

combatDeleteBtn.addEventListener('click', () => {
  const selected = (timeline as any).selectedMarker;
  if (selected) {
    timeline.removeMarker(selected.trackIdx, selected.markerIdx);
    combatPropsPanel.classList.add('hidden');
    selectedCombatMarkerIdx = -1;
    // Also remove from combatEvents
    const id = editor.getSelectedId();
    if (id && timelineActiveSegment) {
      const segs = editor.getObjectSegments(id);
      const seg = segs.find(s => s.name === timelineActiveSegment!.name
        && s.clipName === timelineActiveSegment!.clipName
        && s.startFrame === timelineActiveSegment!.startFrame
        && s.endFrame === timelineActiveSegment!.endFrame);
      if (seg?.combatEvents) {
        saveCombatMarkersToSegment(timeline.getMarkers(1)); // combat track index 1
      }
    }
  }
});

// VFX Gizmo offset change → save to marker
vfxGizmo.onChange = (offset, rotation) => {
  const marker = timeline.getSelectedMarker();
  if (!marker) return;
  marker.offset = offset;
  marker.rotation = rotation;
  const markers = timeline.getMarkers(2); // VFX track is now index 2
  saveMarkersToSegment(markers);
};

markerPresetSelect.addEventListener('change', () => {
  const marker = timeline.getSelectedMarker();
  if (!marker) return;
  marker.presetId = markerPresetSelect.value;
  marker.label = markerPresetSelect.options[markerPresetSelect.selectedIndex].textContent || marker.presetId;
  marker.color = '#ff8800';
  // Trigger save
  const tracks = timeline.getMarkers(2); // VFX track is index 2
  saveMarkersToSegment(tracks);
  timeline.setTracks(timeline['tracks']); // Force re-render
});

markerScaleInput.addEventListener('change', () => {
  const marker = timeline.getSelectedMarker();
  if (!marker) return;
  marker.scale = parseFloat(markerScaleInput.value) || 1.0;
  const tracks = timeline.getMarkers(2);
  saveMarkersToSegment(tracks);
});

document.getElementById('tl-marker-follow')!.addEventListener('change', () => {
  const marker = timeline.getSelectedMarker();
  if (!marker) return;
  marker.followParent = (document.getElementById('tl-marker-follow') as HTMLInputElement).checked;
  const tracks = timeline.getMarkers(2);
  saveMarkersToSegment(tracks);
});

markerDeleteBtn.addEventListener('click', () => {
  const selected = (timeline as any).selectedMarker;
  if (selected) {
    timeline.removeMarker(selected.trackIdx, selected.markerIdx);
    vfxGizmo.hide();
  }
});

// VFX gizmo mode switch buttons
const markerModeTranslate = document.getElementById('tl-marker-mode-translate')!;
const markerModeRotate = document.getElementById('tl-marker-mode-rotate')!;

function updateMarkerModeButtons() {
  const mode = vfxGizmo.getMode();
  markerModeTranslate.style.background = mode === 'translate' ? '#45475a' : 'none';
  markerModeRotate.style.background = mode === 'rotate' ? '#45475a' : 'none';
}

markerModeTranslate.addEventListener('click', () => {
  vfxGizmo.setMode('translate');
  updateMarkerModeButtons();
});

markerModeRotate.addEventListener('click', () => {
  vfxGizmo.setMode('rotate');
  updateMarkerModeButtons();
});

function saveMarkersToSegment(markers: any[]) {
  const id = editor.getSelectedId();
  if (!id || !timelineActiveSegment) return;
  const segs = editor.getObjectSegments(id);
  const seg = segs.find(s => s.name === timelineActiveSegment!.name
    && s.clipName === timelineActiveSegment!.clipName
    && s.startFrame === timelineActiveSegment!.startFrame
    && s.endFrame === timelineActiveSegment!.endFrame);
  if (seg) {
    seg.vfxEvents = markers.map(m => ({
      frame: m.frame,
      presetId: m.presetId,
      offset: m.offset,
      rotation: m.rotation,
      scale: m.scale,
      followParent: m.followParent || undefined,
    }));
  }
}

function saveCombatMarkersToSegment(markers: any[]) {
  const id = editor.getSelectedId();
  if (!id || !timelineActiveSegment) return;
  const segs = editor.getObjectSegments(id);
  const seg = segs.find(s => s.name === timelineActiveSegment!.name
    && s.clipName === timelineActiveSegment!.clipName
    && s.startFrame === timelineActiveSegment!.startFrame
    && s.endFrame === timelineActiveSegment!.endFrame);
  if (seg) {
    seg.combatEvents = markers.map(m => {
      const existing = seg.combatEvents?.find(e => e.frame === m.frame);
      return {
        frame: m.frame,
        damage: existing?.damage ?? 10,
        range: existing?.range ?? 30,
        angle: existing?.angle ?? 120,
        cooldown: existing?.cooldown ?? 1.0,
        shape: existing?.shape,
        forwardOffset: existing?.forwardOffset,
        width: existing?.width,
        showIndicator: existing?.showIndicator,
        knockbackForce: existing?.knockbackForce,
        knockbackUp: existing?.knockbackUp,
        label: m.label || `Hit@${m.frame}`,
      };
    });
  }
}

// Update timeline when selection changes
const origOnSelect = editor.onSelect;
editor.onSelect = (id) => {
  origOnSelect?.(id);

  // Always clear marker panels and helpers when selection changes
  markerPropsPanel.classList.add('hidden');
  combatPropsPanel.classList.add('hidden');
  vfxGizmo.hide();
  editor.clearAllAttackRangeHelpers();
  selectedCombatMarkerIdx = -1;
  document.getElementById('tl-speed-control')!.style.display = 'none';

  if (id) {
    updateTimelineForObject(id);
  } else {
    timeline.setTracks([]);
    timeline.setTotalFrames(120);
  }
};

/** Migrate legacy VFXEvent usage:'hit' to CombatEvent (run on segment load) */
function migrateLegacyHitEvents(seg: AnimSegment) {
  if (!seg.vfxEvents) return;
  const hitEvents = seg.vfxEvents.filter(e => (e as any).usage === 'hit');
  if (hitEvents.length === 0) return;

  if (!seg.combatEvents) seg.combatEvents = [];
  for (const hit of hitEvents) {
    // Only migrate if no combatEvent already exists at this frame
    if (!seg.combatEvents.some(c => c.frame === hit.frame)) {
      seg.combatEvents.push({
        frame: hit.frame,
        damage: 10,
        range: 30,
        angle: 120,
        cooldown: 1.0,
        label: `Hit@${hit.frame}`,
      });
    }
    // Remove legacy usage field from VFX event
    delete (hit as any).usage;
  }
}

function updateTimelineForObject(id: string) {
  const segments = editor.getObjectSegments(id);
  const clips = editor.getAnimationClips(id);
  const fps = editor.getObjectFPS(id) || 30;

  // Migrate any legacy hit events
  for (const seg of segments) {
    migrateLegacyHitEvents(seg);
  }
  timeline.setFPS(fps);

  // Find max frame across all segments/clips
  let maxFrame = 60;
  for (const seg of segments) {
    maxFrame = Math.max(maxFrame, seg.endFrame);
  }
  // Also check clips duration
  const clipList = editor.getObjectAnimationClips(id);
  if (clipList) {
    for (const clip of clipList) {
      maxFrame = Math.max(maxFrame, Math.round(clip.duration * fps));
    }
  }
  timeline.setTotalFrames(maxFrame);

  // Build tracks
  const tracks: Array<{ type: 'animation' | 'vfx' | 'audio'; name: string; clips: Array<{ startFrame: number; endFrame: number; name: string; color: string }> }> = [];

  // Animation track — show all segments as clips
  const animClips = segments.map((seg, i) => ({
    startFrame: seg.startFrame,
    endFrame: seg.endFrame,
    name: seg.name,
    color: ['#89b4fa', '#f9e2af', '#a6e3a1', '#f38ba8', '#cba6f7'][i % 5],
  }));
  tracks.push({ type: 'animation', name: 'Animation', clips: animClips });

  // VFX track (placeholder — will show VFX markers in Step 3)
  tracks.push({ type: 'vfx', name: 'VFX', clips: [] });

  // Audio track (placeholder)
  tracks.push({ type: 'audio', name: 'Audio', clips: [] });

  timeline.setTracks(tracks);
}

// --- Camera Object ---
const addCameraBtn = document.getElementById('add-camera-btn')!;
const cameraPreviewPanel = document.getElementById('camera-preview-panel')!;
const cameraPreviewCanvas = document.getElementById('camera-preview-canvas') as HTMLCanvasElement;
const cameraPreviewClose = document.getElementById('camera-preview-close')!;
const cameraPanel = document.getElementById('camera-panel')!;
const camFovInput = document.getElementById('cam-fov') as HTMLInputElement;
const camNearInput = document.getElementById('cam-near') as HTMLInputElement;
const camFarInput = document.getElementById('cam-far') as HTMLInputElement;
const camFollowEnabled = document.getElementById('cam-follow-enabled') as HTMLInputElement;
const camFollowSettings = document.getElementById('cam-follow-settings')!;
const camFollowTarget = document.getElementById('cam-follow-target') as HTMLSelectElement;
const camFollowOx = document.getElementById('cam-follow-ox') as HTMLInputElement;
const camFollowOy = document.getElementById('cam-follow-oy') as HTMLInputElement;
const camFollowOz = document.getElementById('cam-follow-oz') as HTMLInputElement;
const camLookOx = document.getElementById('cam-look-ox') as HTMLInputElement;
const camLookOy = document.getElementById('cam-look-oy') as HTMLInputElement;
const camLookOz = document.getElementById('cam-look-oz') as HTMLInputElement;

addCameraBtn.addEventListener('click', () => {
  if (editor.hasCameraObject()) {
    const camId = editor.getCameraObjectId();
    if (camId) editor.select(camId);
  } else {
    editor.addCameraObject();
    refreshAll();
  }
});

function showCameraPreview() {
  cameraPreviewPanel.classList.remove('hidden');
  if (!editor.getSceneCameraObject()) return;
  const rect = cameraPreviewCanvas.getBoundingClientRect();
  cameraPreviewCanvas.width = rect.width * window.devicePixelRatio;
  cameraPreviewCanvas.height = rect.height * window.devicePixelRatio;
  editor.setupCameraObjectPreview(cameraPreviewCanvas);
}

function hideCameraPreview() {
  cameraPreviewPanel.classList.add('hidden');
  editor.disposeCameraObjectPreview();
}

cameraPreviewClose.addEventListener('click', hideCameraPreview);

function refreshCameraPanel() {
  const id = editor.getSelectedId();
  const isCamera = id !== null && editor.isCameraObject(id);

  cameraPanel.classList.toggle('hidden', !isCamera);

  // Hide irrelevant panels when camera is selected
  const matPanel = document.getElementById('material-slots')!.parentElement!;
  const texPanel = matPanel.nextElementSibling as HTMLElement;
  const operationsPanel = texPanel?.nextElementSibling as HTMLElement;
  if (isCamera) {
    matPanel.classList.add('hidden');
    if (texPanel) texPanel.classList.add('hidden');
    // Hide prefab buttons in operations panel
    if (operationsPanel) {
      const prefabRow = operationsPanel.querySelector('.action-row:last-child') as HTMLElement;
      if (prefabRow) prefabRow.style.display = 'none';
    }
  } else if (id) {
    matPanel.classList.remove('hidden');
    if (texPanel) texPanel.classList.remove('hidden');
    if (operationsPanel) {
      const prefabRow = operationsPanel.querySelector('.action-row:last-child') as HTMLElement;
      if (prefabRow) prefabRow.style.display = '';
    }
  }

  if (!isCamera) return;

  camFovInput.value = String(editor.getCameraFov());
  camNearInput.value = String(editor.getCameraNear());
  camFarInput.value = String(editor.getCameraFar());

  // Aspect ratio
  const aspect = editor.getCameraAspect();
  const camAspect = document.getElementById('cam-aspect') as HTMLSelectElement;
  const camAspectCustomEl = document.getElementById('cam-aspect-custom')!;
  // Find closest match
  let matched = false;
  for (const opt of Array.from(camAspect.options)) {
    if (opt.value !== 'custom' && Math.abs(parseFloat(opt.value) - aspect) < 0.02) {
      camAspect.value = opt.value;
      matched = true;
      break;
    }
  }
  if (!matched) {
    camAspect.value = 'custom';
    camAspectCustomEl.style.display = '';
    // Compute approximate W/H from aspect
    const w = Math.round(aspect * 1080);
    (document.getElementById('cam-aspect-w') as HTMLInputElement).value = String(w);
    (document.getElementById('cam-aspect-h') as HTMLInputElement).value = '1080';
  } else {
    camAspectCustomEl.style.display = 'none';
  }

  // Follow target
  const followTarget = editor.getCameraFollowTarget();
  camFollowEnabled.checked = followTarget !== null;
  camFollowSettings.classList.toggle('hidden', !camFollowEnabled.checked);

  // Populate target dropdown with scene objects (excluding camera)
  camFollowTarget.innerHTML = '';
  const allMeta = editor.getAllMeta().filter(m => m.modelPath !== '__camera__');
  allMeta.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.name;
    opt.textContent = m.name;
    if (m.name === followTarget) opt.selected = true;
    camFollowTarget.appendChild(opt);
  });

  const offset = editor.getCameraFollowOffset();
  camFollowOx.value = String(offset[0]);
  camFollowOy.value = String(offset[1]);
  camFollowOz.value = String(offset[2]);

  const lookOff = editor.getCameraLookOffset();
  camLookOx.value = String(lookOff[0]);
  camLookOy.value = String(lookOff[1]);
  camLookOz.value = String(lookOff[2]);
}

function applyCameraFollow() {
  if (camFollowEnabled.checked) {
    editor.setCameraFollowTarget(camFollowTarget.value || null);
    editor.setCameraFollowOffset([
      parseFloat(camFollowOx.value) || 0,
      parseFloat(camFollowOy.value) || 250,
      parseFloat(camFollowOz.value) || 350,
    ]);
    editor.setCameraLookOffset([
      parseFloat(camLookOx.value) || 0,
      parseFloat(camLookOy.value) || 30,
      parseFloat(camLookOz.value) || 0,
    ]);
  } else {
    editor.setCameraFollowTarget(null);
  }
  camFollowSettings.classList.toggle('hidden', !camFollowEnabled.checked);
}

camFovInput.addEventListener('change', () => {
  editor.setCameraFov(parseFloat(camFovInput.value) || 60);
});

const camAspectSelect = document.getElementById('cam-aspect') as HTMLSelectElement;
const camAspectCustom = document.getElementById('cam-aspect-custom')!;
const camAspectW = document.getElementById('cam-aspect-w') as HTMLInputElement;
const camAspectH = document.getElementById('cam-aspect-h') as HTMLInputElement;

function applyCameraAspect() {
  const val = camAspectSelect.value;
  if (val === 'custom') {
    camAspectCustom.style.display = '';
    const w = parseInt(camAspectW.value) || 1920;
    const h = parseInt(camAspectH.value) || 1080;
    editor.setCameraAspect(w / h);
  } else {
    camAspectCustom.style.display = 'none';
    editor.setCameraAspect(parseFloat(val));
  }
}

camAspectSelect.addEventListener('change', applyCameraAspect);
camAspectW.addEventListener('change', applyCameraAspect);
camAspectH.addEventListener('change', applyCameraAspect);

camNearInput.addEventListener('change', () => {
  editor.setCameraNearFar(parseFloat(camNearInput.value) || 1, parseFloat(camFarInput.value) || 5000);
});
camFarInput.addEventListener('change', () => {
  editor.setCameraNearFar(parseFloat(camNearInput.value) || 1, parseFloat(camFarInput.value) || 5000);
});
camFollowEnabled.addEventListener('change', applyCameraFollow);
camFollowTarget.addEventListener('change', applyCameraFollow);
camFollowOx.addEventListener('change', applyCameraFollow);
camFollowOy.addEventListener('change', applyCameraFollow);
camFollowOz.addEventListener('change', applyCameraFollow);
camLookOx.addEventListener('change', applyCameraFollow);
camLookOy.addEventListener('change', applyCameraFollow);
camLookOz.addEventListener('change', applyCameraFollow);

editor.onCameraObjectChange = () => {
  refreshObjectList();
  addCameraBtn.textContent = editor.hasCameraObject() ? '🎥 選取攝影機' : '🎥 攝影機';
};

// Make camera preview draggable
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
const cameraPreviewHeader = document.getElementById('camera-preview-header')!;

cameraPreviewHeader.addEventListener('mousedown', (e) => {
  isDragging = true;
  const rect = cameraPreviewPanel.getBoundingClientRect();
  dragOffsetX = e.clientX - rect.left;
  dragOffsetY = e.clientY - rect.top;
  e.preventDefault();
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const parent = cameraPreviewPanel.parentElement!;
  const parentRect = parent.getBoundingClientRect();
  const newLeft = e.clientX - parentRect.left - dragOffsetX;
  const newTop = e.clientY - parentRect.top - dragOffsetY;
  cameraPreviewPanel.style.left = Math.max(0, newLeft) + 'px';
  cameraPreviewPanel.style.top = Math.max(0, newTop) + 'px';
  cameraPreviewPanel.style.right = 'auto';
  cameraPreviewPanel.style.bottom = 'auto';
});

document.addEventListener('mouseup', () => { isDragging = false; });

// ========================================
// 💥 VFX Editor Mode
// ========================================

const vfxEditorBtn = document.getElementById('vfx-editor-btn')!;
const vfxEditorPanel = document.getElementById('vfx-editor-panel')!;
const vfxEditorClose = document.getElementById('vfx-editor-close')!;
const inspectorEl = document.getElementById('inspector')!;

let vfxEditorActive = false;
let vfxEditorLoopHandle: ReturnType<typeof setInterval> | null = null;

// Custom presets storage (persisted via localStorage)
const VFX_PRESETS_STORAGE_KEY = 'douqi_vfx_custom_presets';
let vfxCustomPresets: Map<string, { name: string; particles: any }> = new Map();

// Load custom presets from localStorage on startup
(function loadVfxPresetsFromStorage() {
  try {
    const raw = localStorage.getItem(VFX_PRESETS_STORAGE_KEY);
    if (raw) {
      const entries = JSON.parse(raw) as Array<[string, { name: string; particles: any }]>;
      for (const [id, data] of entries) {
        vfxCustomPresets.set(id, data);
        editorVfx.registerPreset(id, data);
      }
    }
  } catch (e) { /* ignore corrupt data */ }
})();

function saveVfxPresetsToStorage() {
  const entries = Array.from(vfxCustomPresets.entries());
  localStorage.setItem(VFX_PRESETS_STORAGE_KEY, JSON.stringify(entries));
}

function enterVfxEditorMode() {
  vfxEditorActive = true;
  vfxEditorBtn.classList.add('active');
  inspectorEl.classList.add('hidden');
  vfxEditorPanel.classList.remove('hidden');
  refreshVfxPresetList();
}

function exitVfxEditorMode() {
  vfxEditorActive = false;
  vfxEditorBtn.classList.remove('active');
  vfxEditorPanel.classList.add('hidden');
  inspectorEl.classList.remove('hidden');
  stopVfxLoop();
  refreshInspector();
}

vfxEditorBtn.addEventListener('click', () => {
  if (vfxEditorActive) exitVfxEditorMode();
  else enterVfxEditorMode();
});
vfxEditorClose.addEventListener('click', exitVfxEditorMode);

// Preset list
const vfxEdPresetList = document.getElementById('vfx-ed-preset-list') as HTMLSelectElement;

function refreshVfxPresetList() {
  vfxEdPresetList.innerHTML = '<option value="">— 新特效 —</option>';
  // Built-in presets
  const builtIn = editorVfx.getAllPresets();
  for (const p of builtIn) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.id})`;
    vfxEdPresetList.appendChild(opt);
  }
  // Custom presets
  for (const [id, p] of vfxCustomPresets) {
    if (builtIn.find((b: { id: string }) => b.id === id)) continue; // skip if overrides built-in
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `⭐ ${p.name} (${id})`;
    vfxEdPresetList.appendChild(opt);
  }
}

// Load preset into fields
document.getElementById('vfx-ed-load-preset')!.addEventListener('click', () => {
  const id = vfxEdPresetList.value;
  if (!id) { resetVfxEdFields(); return; }
  const preset = vfxCustomPresets.get(id) || editorVfx.getPreset(id);
  if (!preset) return;
  const p = preset.particles || (preset as any);
  loadVfxEdFields(id, preset.name, p);
});

function loadVfxEdFields(id: string, name: string, p: any) {
  (document.getElementById('vfx-ed-name') as HTMLInputElement).value = name;
  (document.getElementById('vfx-ed-count') as HTMLInputElement).value = String(p.count ?? 15);
  (document.getElementById('vfx-ed-size') as HTMLInputElement).value = String(p.size ?? 12);
  (document.getElementById('vfx-ed-size-end') as HTMLInputElement).value = String(p.sizeEnd ?? 2);
  (document.getElementById('vfx-ed-speed') as HTMLInputElement).value = String(p.speed ?? 150);
  (document.getElementById('vfx-ed-speed-var') as HTMLInputElement).value = String(p.speedVariance ?? 60);
  (document.getElementById('vfx-ed-life') as HTMLInputElement).value = String(p.lifetime ?? 0.35);
  (document.getElementById('vfx-ed-life-var') as HTMLInputElement).value = String(p.lifetimeVariance ?? 0.1);
  (document.getElementById('vfx-ed-color') as HTMLInputElement).value = p.color ?? '#4488ff';
  (document.getElementById('vfx-ed-color-end') as HTMLInputElement).value = p.colorEnd ?? '#2244aa';
  (document.getElementById('vfx-ed-opacity') as HTMLInputElement).value = String(p.opacity ?? 1);
  (document.getElementById('vfx-ed-opacity-end') as HTMLInputElement).value = String(p.opacityEnd ?? 0);
  (document.getElementById('vfx-ed-gravity') as HTMLInputElement).value = String(p.gravity ?? 200);
  (document.getElementById('vfx-ed-spread') as HTMLInputElement).value = String(p.spread ?? 120);
  (document.getElementById('vfx-ed-dir-x') as HTMLInputElement).value = String(p.direction?.[0] ?? 0);
  (document.getElementById('vfx-ed-dir-y') as HTMLInputElement).value = String(p.direction?.[1] ?? 1);
  (document.getElementById('vfx-ed-dir-z') as HTMLInputElement).value = String(p.direction?.[2] ?? 0);
  (document.getElementById('vfx-ed-texture') as HTMLSelectElement).value = p.texture ?? 'circle';
  // Extended
  (document.getElementById('vfx-ed-render-mode') as HTMLSelectElement).value = p.renderMode ?? 'billboard';
  (document.getElementById('vfx-ed-length-factor') as HTMLInputElement).value = String(p.lengthFactor ?? 3);
  (document.getElementById('vfx-ed-trail-length') as HTMLInputElement).value = String(p.trailLength ?? 10);
  (document.getElementById('vfx-ed-emitter-shape') as HTMLSelectElement).value = p.emitterShape ?? 'point';
  (document.getElementById('vfx-ed-emitter-radius') as HTMLInputElement).value = String(p.emitterRadius ?? 1);
  (document.getElementById('vfx-ed-orbital') as HTMLInputElement).value = String(p.orbitalForce ?? 0);
  (document.getElementById('vfx-ed-drag') as HTMLInputElement).value = String(p.drag ?? 0);
  (document.getElementById('vfx-ed-emission-mode') as HTMLSelectElement).value = p.emissionMode ?? 'burst';
  (document.getElementById('vfx-ed-emission-rate') as HTMLInputElement).value = String(p.emissionRate ?? 20);
  (document.getElementById('vfx-ed-duration') as HTMLInputElement).value = String(p.duration ?? 1);
  vfxEdPresetList.value = id;
}

function resetVfxEdFields() {
  loadVfxEdFields('', '新特效', {
    count: 15, size: 12, sizeEnd: 2, speed: 150, speedVariance: 60,
    lifetime: 0.35, lifetimeVariance: 0.1, color: '#4488ff', colorEnd: '#2244aa',
    opacity: 1, opacityEnd: 0, gravity: 200, spread: 120,
    direction: [0, 0, 1], texture: 'circle',
    renderMode: 'billboard', lengthFactor: 3, trailLength: 10,
    emitterShape: 'point', emitterRadius: 1,
    orbitalForce: 0, drag: 0,
    emissionMode: 'burst', emissionRate: 20, duration: 1,
  });
}

function readVfxEdFields(): { name: string; particles: any } {
  return {
    name: (document.getElementById('vfx-ed-name') as HTMLInputElement).value || '新特效',
    particles: {
      count: parseInt((document.getElementById('vfx-ed-count') as HTMLInputElement).value) || 15,
      size: parseFloat((document.getElementById('vfx-ed-size') as HTMLInputElement).value) || 12,
      sizeEnd: parseFloat((document.getElementById('vfx-ed-size-end') as HTMLInputElement).value) || 2,
      speed: parseFloat((document.getElementById('vfx-ed-speed') as HTMLInputElement).value) || 150,
      speedVariance: parseFloat((document.getElementById('vfx-ed-speed-var') as HTMLInputElement).value) || 60,
      lifetime: parseFloat((document.getElementById('vfx-ed-life') as HTMLInputElement).value) || 0.35,
      lifetimeVariance: parseFloat((document.getElementById('vfx-ed-life-var') as HTMLInputElement).value) || 0.1,
      color: (document.getElementById('vfx-ed-color') as HTMLInputElement).value,
      colorEnd: (document.getElementById('vfx-ed-color-end') as HTMLInputElement).value,
      opacity: parseFloat((document.getElementById('vfx-ed-opacity') as HTMLInputElement).value) ?? 1,
      opacityEnd: parseFloat((document.getElementById('vfx-ed-opacity-end') as HTMLInputElement).value) ?? 0,
      gravity: parseFloat((document.getElementById('vfx-ed-gravity') as HTMLInputElement).value) || 0,
      spread: parseFloat((document.getElementById('vfx-ed-spread') as HTMLInputElement).value) || 120,
      direction: [
        parseFloat((document.getElementById('vfx-ed-dir-x') as HTMLInputElement).value) || 0,
        parseFloat((document.getElementById('vfx-ed-dir-y') as HTMLInputElement).value) || 1,
        parseFloat((document.getElementById('vfx-ed-dir-z') as HTMLInputElement).value) || 0,
      ] as [number, number, number],
      texture: (document.getElementById('vfx-ed-texture') as HTMLSelectElement).value || 'circle',
      // Extended
      renderMode: (document.getElementById('vfx-ed-render-mode') as HTMLSelectElement).value || 'billboard',
      lengthFactor: parseFloat((document.getElementById('vfx-ed-length-factor') as HTMLInputElement).value) || 3,
      trailLength: parseFloat((document.getElementById('vfx-ed-trail-length') as HTMLInputElement).value) || 10,
      emitterShape: (document.getElementById('vfx-ed-emitter-shape') as HTMLSelectElement).value || 'point',
      emitterRadius: parseFloat((document.getElementById('vfx-ed-emitter-radius') as HTMLInputElement).value) || 1,
      orbitalForce: parseFloat((document.getElementById('vfx-ed-orbital') as HTMLInputElement).value) || 0,
      drag: parseFloat((document.getElementById('vfx-ed-drag') as HTMLInputElement).value) || 0,
      emissionMode: (document.getElementById('vfx-ed-emission-mode') as HTMLSelectElement).value || 'burst',
      emissionRate: parseFloat((document.getElementById('vfx-ed-emission-rate') as HTMLInputElement).value) || 20,
      duration: parseFloat((document.getElementById('vfx-ed-duration') as HTMLInputElement).value) || 1,
    },
  };
}

// Preview
document.getElementById('vfx-ed-preview')!.addEventListener('click', () => {
  const { particles } = readVfxEdFields();
  // Spawn at scene center with configured direction
  const pos = new THREE.Vector3(0, 50, 0);
  const dir = new THREE.Vector3(particles.direction[0], particles.direction[1], particles.direction[2]).normalize();
  editorVfx.spawnFromConfig(particles, pos, dir.lengthSq() > 0 ? dir : undefined);
});

// Loop
function stopVfxLoop() {
  if (vfxEditorLoopHandle) {
    clearInterval(vfxEditorLoopHandle);
    vfxEditorLoopHandle = null;
    document.getElementById('vfx-ed-loop')!.style.background = '#555';
  }
}

document.getElementById('vfx-ed-loop')!.addEventListener('click', () => {
  if (vfxEditorLoopHandle) {
    stopVfxLoop();
  } else {
    const btn = document.getElementById('vfx-ed-loop')!;
    btn.style.background = '#45a049';
    vfxEditorLoopHandle = setInterval(() => {
      const { particles } = readVfxEdFields();
      const pos = new THREE.Vector3(0, 50, 0);
      const dir = new THREE.Vector3(particles.direction[0], particles.direction[1], particles.direction[2]).normalize();
      editorVfx.spawnFromConfig(particles, pos, dir.lengthSq() > 0 ? dir : undefined);
    }, 1000);
    // Also fire once immediately
    const { particles } = readVfxEdFields();
    const pos = new THREE.Vector3(0, 50, 0);
    const dir = new THREE.Vector3(particles.direction[0], particles.direction[1], particles.direction[2]).normalize();
    editorVfx.spawnFromConfig(particles, pos, dir.lengthSq() > 0 ? dir : undefined);
  }
});

// Save preset
// Save preset to file
document.getElementById('vfx-ed-save')!.addEventListener('click', async () => {
  const data = readVfxEdFields();
  const id = data.name || '新特效';
  const json = JSON.stringify({ id, name: data.name, particles: data.particles }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  // Use File System Access API if available (lets user pick location)
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${id}.vfx.json`,
        types: [{ description: 'VFX Preset', accept: { 'application/json': ['.vfx.json', '.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      // Also register in memory for current session
      vfxCustomPresets.set(id, data);
      editorVfx.registerPreset(id, data);
      saveVfxPresetsToStorage();
      refreshVfxPresetList();
      vfxEdPresetList.value = id;
      showToast(`✅ 特效已存檔：${id}.vfx.json`);
    } catch (e: any) {
      if (e.name !== 'AbortError') alert('存檔失敗：' + e.message);
    }
  } else {
    // Fallback: download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${id}.vfx.json`; a.click();
    URL.revokeObjectURL(url);
    vfxCustomPresets.set(id, data);
    editorVfx.registerPreset(id, data);
    saveVfxPresetsToStorage();
    refreshVfxPresetList();
    vfxEdPresetList.value = id;
    showToast(`✅ 特效已下載：${id}.vfx.json`);
  }
});

// Load preset from file
const vfxEdFileInput = document.getElementById('vfx-ed-file-input') as HTMLInputElement;
document.getElementById('vfx-ed-load-file')!.addEventListener('click', () => {
  vfxEdFileInput.click();
});
vfxEdFileInput.addEventListener('change', async () => {
  const file = vfxEdFileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const id = data.id || data.name || file.name.replace(/\.vfx\.json$|\.json$/, '');
    const preset = { name: data.name || id, particles: data.particles };
    vfxCustomPresets.set(id, preset);
    editorVfx.registerPreset(id, preset);
    saveVfxPresetsToStorage();
    refreshVfxPresetList();
    loadVfxEdFields(id, preset.name, preset.particles);
    showToast(`✅ 已載入特效：${preset.name}`);
  } catch (e) {
    alert('載入失敗：檔案格式不正確');
  }
  vfxEdFileInput.value = '';
});

// Delete preset
document.getElementById('vfx-ed-delete')!.addEventListener('click', () => {
  const id = vfxEdPresetList.value;
  if (!id) return;
  if (!vfxCustomPresets.has(id)) { alert('內建特效無法刪除'); return; }
  if (!confirm(`確定要刪除「${vfxCustomPresets.get(id)?.name}」嗎？`)) return;
  vfxCustomPresets.delete(id);
  saveVfxPresetsToStorage();
  refreshVfxPresetList();
  resetVfxEdFields();
  showToast(`🗑️ 已刪除特效：${id}`);
});

// Helper: show toast (reuses existing showToast function from above)

// ========================================
// 🎯 鬥氣割草 Tag System + Export
// ========================================

const stTag = document.getElementById('st-tag') as HTMLSelectElement;
const stSpawnConfig = document.getElementById('st-spawn-config') as HTMLDivElement;
const stItemConfig = document.getElementById('st-item-config') as HTMLDivElement;
const stZombieType = document.getElementById('st-zombie-type') as HTMLSelectElement;
const stWave = document.getElementById('st-wave') as HTMLInputElement;
const stCount = document.getElementById('st-count') as HTMLInputElement;
const stInterval = document.getElementById('st-interval') as HTMLInputElement;
const stMaxAlive = document.getElementById('st-max-alive') as HTMLInputElement;
const stItemType = document.getElementById('st-item-type') as HTMLSelectElement;
const stItemRadius = document.getElementById('st-item-radius') as HTMLInputElement;
const stItemRespawn = document.getElementById('st-item-respawn') as HTMLInputElement;

function refreshSpinningTopPanel() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;

  const tag = meta.spinningTopTag || 'none';
  stTag.value = tag;
  stSpawnConfig.style.display = tag === 'spawnPoint' ? '' : 'none';
  stItemConfig.style.display = tag === 'itemZone' ? '' : 'none';

  // Load spawn config
  if (meta.spawnConfig) {
    stZombieType.value = meta.spawnConfig.zombieType || 'zombie_small';
    stWave.value = String(meta.spawnConfig.wave ?? 1);
    stCount.value = String(meta.spawnConfig.count ?? 1);
    stInterval.value = String(meta.spawnConfig.interval ?? 2);
    stMaxAlive.value = String(meta.spawnConfig.maxAlive ?? 5);
  }

  // Load item zone config
  if (meta.itemZoneConfig) {
    stItemType.value = meta.itemZoneConfig.itemType || 'coin';
    stItemRadius.value = String(meta.itemZoneConfig.radius ?? 30);
    stItemRespawn.value = String(meta.itemZoneConfig.respawnTime ?? 10);
  }

  // Ensure marker is displayed
  updateMarkerForObject(id, meta);
}

function applySpinningTopTag() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;

  const tag = stTag.value as any;
  meta.spinningTopTag = tag === 'none' ? undefined : tag;

  stSpawnConfig.style.display = tag === 'spawnPoint' ? '' : 'none';
  stItemConfig.style.display = tag === 'itemZone' ? '' : 'none';

  // Initialize default configs
  if (tag === 'spawnPoint' && !meta.spawnConfig) {
    meta.spawnConfig = { zombieType: 'zombie_small', wave: 1, count: 1, interval: 2, maxAlive: 5 };
  }
  if (tag === 'itemZone' && !meta.itemZoneConfig) {
    meta.itemZoneConfig = { itemType: 'coin', radius: 30, respawnTime: 10 };
  }

  // Update marker visual
  updateMarkerForObject(id, meta);
}

function applySpawnConfig() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;
  meta.spawnConfig = {
    zombieType: stZombieType.value,
    wave: parseInt(stWave.value) || 1,
    count: parseInt(stCount.value) || 1,
    interval: parseFloat(stInterval.value) || 2,
    maxAlive: parseInt(stMaxAlive.value) || 5,
  };
  updateMarkerForObject(id, meta);
}

function applyItemZoneConfig() {
  const id = editor.getSelectedId();
  if (!id) return;
  const meta = editor.getMeta(id);
  if (!meta) return;
  meta.itemZoneConfig = {
    itemType: stItemType.value,
    radius: parseFloat(stItemRadius.value) || 30,
    respawnTime: parseFloat(stItemRespawn.value) || 10,
  };
  updateMarkerForObject(id, meta);
}

/** Update marker visual for a given object */
function updateMarkerForObject(id: string, meta: SceneObjectData) {
  const obj = editor.getObjects().get(id) || null;
  const hasModel = !!(meta.modelPath && meta.modelPath !== '__empty__' && meta.modelPath !== '__camera__');
  markerManager.update(id, obj, meta.spinningTopTag, {
    zombieType: meta.spawnConfig?.zombieType,
    itemRadius: meta.itemZoneConfig?.radius,
    hasModel,
    boundaryRadius: meta.scale ? Math.max(meta.scale[0], meta.scale[2]) * 50 : 300,
  });
}

// Event listeners
stTag.addEventListener('change', applySpinningTopTag);
stZombieType.addEventListener('change', applySpawnConfig);
stWave.addEventListener('change', applySpawnConfig);
stCount.addEventListener('change', applySpawnConfig);
stInterval.addEventListener('change', applySpawnConfig);
stMaxAlive.addEventListener('change', applySpawnConfig);
stItemType.addEventListener('change', applyItemZoneConfig);
stItemRadius.addEventListener('change', applyItemZoneConfig);
stItemRespawn.addEventListener('change', applyItemZoneConfig);

// Register refresh hook for refreshInspector
(window as any).__refreshSTPanel = refreshSpinningTopPanel;

// ========================================
// 🎯 SpinningTop Scene Export
// ========================================

interface SpinningTopSceneExport {
  version: 1;
  name: string;
  description?: string;
  arena: {
    type?: string;
    bounds: {
      shape: 'capsule' | 'circle' | 'rectangle';
      // capsule
      capsuleLeftX?: number;
      capsuleRightX?: number;
      capsuleRadius?: number;
      centerY?: number;
      // circle
      radius?: number;
      // rectangle
      width?: number;
      height?: number;
      center: [number, number, number];
    };
    canvas?: { width: number; height: number };
  };
  playerSpawns?: Array<{
    id: string;
    position: [number, number, number];
    label?: string;
  }>;
  launchPadZones?: Array<{
    id: string;
    position: [number, number, number];
    note?: string;
  }>;
  obstacles: {
    mode: 'random' | 'fixed' | 'mixed';
    count: number;
    sizeRange?: { minW: number; maxW: number; minH: number; maxH: number };
    constraints?: {
      minDistFromSpawn?: number;
      minDistFromLaunchPad?: number;
      minDistBetween?: number;
      mustBeInsideArena?: boolean;
      arenaMargin?: number;
    };
    fixed?: Array<{
      id: string;
      position: [number, number, number];
      size: [number, number];
      rotation?: number;
      durability?: number;
    }>;
  };
  spawnPoints: Array<{
    id: string;
    position: [number, number, number];
    rotation: [number, number, number];
    zombieType: string;
    spawnConfig: { wave: number; count: number; interval: number; maxAlive: number };
  }>;
  itemZones: Array<{
    id: string;
    position: [number, number, number];
    radius: number;
    itemType: string;
    respawnTime: number;
  }>;
  camera?: {
    position: [number, number, number];
    zoom?: number;
    followTarget?: string;
  };
}

async function exportSpinningTopScene() {
  const metas = editor.getAllMeta();
  const sceneName = (document.getElementById('scene-name') as HTMLInputElement).value || 'untitled';

  // Find boundary object for arena bounds
  const boundary = metas.find(m => m.spinningTopTag === 'boundary');
  const boundaryRadius = boundary ? Math.max(Math.abs(boundary.scale[0]), Math.abs(boundary.scale[2])) * 50 : 480;
  const boundaryCenter = boundary ? boundary.position : [960, 540, 0] as [number, number, number];

  const arena = {
    type: 'capsule',
    bounds: {
      shape: 'capsule' as const,
      capsuleLeftX: 540,
      capsuleRightX: 1380,
      capsuleRadius: boundaryRadius,
      centerY: boundaryCenter[1] || 540,
      center: boundaryCenter,
    },
    canvas: { width: 1920, height: 1080 },
  };

  // Player spawns (4 corners)
  const playerSpawns = [
    { id: 'spawn_p1', position: [129, 885, 0] as [number, number, number], label: 'P1 (左下)' },
    { id: 'spawn_p2', position: [1791, 885, 0] as [number, number, number], label: 'P2 (右下)' },
    { id: 'spawn_p3', position: [129, 199, 0] as [number, number, number], label: 'P3 (左上)' },
    { id: 'spawn_p4', position: [1791, 199, 0] as [number, number, number], label: 'P4 (右上)' },
  ];

  // Launch pad zones
  const launchPadZones = [
    { id: 'pad_zone_1', position: [360, 840, 0] as [number, number, number], note: '左側發射台' },
    { id: 'pad_zone_2', position: [1560, 240, 0] as [number, number, number], note: '右側發射台' },
    { id: 'pad_zone_3', position: [960, 540, 0] as [number, number, number], note: '中央發射台' },
  ];

  // Spawn points (zombie spawners)
  const spawnPoints = metas
    .filter(m => m.spinningTopTag === 'spawnPoint' && m.spawnConfig)
    .map(m => ({
      id: m.id,
      position: m.position,
      rotation: m.rotation,
      zombieType: m.spawnConfig!.zombieType,
      spawnConfig: {
        wave: m.spawnConfig!.wave,
        count: m.spawnConfig!.count,
        interval: m.spawnConfig!.interval,
        maxAlive: m.spawnConfig!.maxAlive,
      },
    }));

  // Obstacles — collect tagged obstacles as fixed positions
  const fixedObstacles = metas
    .filter(m => m.spinningTopTag === 'obstacle')
    .map(m => ({
      id: m.id,
      position: m.position,
      size: [
        (m.collider?.sizeOverride?.[0] ?? m.scale[0] * 100),
        (m.collider?.sizeOverride?.[2] ?? m.scale[2] * 100),
      ] as [number, number],
      rotation: m.rotation[1] || 0,
      durability: 5,
    }));

  const obstacles = {
    mode: (fixedObstacles.length > 0 ? 'fixed' : 'random') as 'fixed' | 'random' | 'mixed',
    count: fixedObstacles.length > 0 ? fixedObstacles.length : 3,
    sizeRange: { minW: 75, maxW: 115, minH: 75, maxH: 115 },
    constraints: {
      minDistFromSpawn: 350,
      minDistFromLaunchPad: 220,
      minDistBetween: 100,
      mustBeInsideArena: true,
      arenaMargin: 40,
    },
    fixed: fixedObstacles,
  };

  // Item zones
  const itemZones = metas
    .filter(m => m.spinningTopTag === 'itemZone' && m.itemZoneConfig)
    .map(m => ({
      id: m.id,
      position: m.position,
      radius: m.itemZoneConfig!.radius,
      itemType: m.itemZoneConfig!.itemType,
      respawnTime: m.itemZoneConfig!.respawnTime,
    }));

  // Camera
  const camera = {
    position: [960, 540, 0] as [number, number, number],
    zoom: 1.0,
    followTarget: 'center',
  };

  const exportData: SpinningTopSceneExport = {
    version: 1,
    name: sceneName,
    description: `場景「${sceneName}」由編輯器匯出`,
    arena,
    playerSpawns,
    launchPadZones,
    obstacles,
    spawnPoints,
    itemZones,
    camera,
  };

  const json = JSON.stringify(exportData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  if ('showSaveFilePicker' in window) {
    try {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: `${sceneName}.spinningtop.json`,
        types: [{ description: 'SpinningTop Scene', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast(`✅ SpinningTop 場景已匯出：${sceneName}`);
    } catch (e: any) {
      if (e.name !== 'AbortError') alert('匯出失敗：' + e.message);
    }
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${sceneName}.spinningtop.json`; a.click();
    URL.revokeObjectURL(url);
    showToast(`✅ SpinningTop 場景已下載：${sceneName}`);
  }
}

document.getElementById('export-spinningtop-btn')!.addEventListener('click', exportSpinningTopScene);

// --- Level Selector Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  const levelSelector = document.getElementById('level-selector') as HTMLSelectElement;
  
  // 關卡選擇器變更事件
  levelSelector.addEventListener('change', async () => {
    await updateSceneFileName();
  });
  
  // 初始化檔案名稱
  await updateSceneFileName();
  
  console.log('✅ 關卡選擇器與自動命名系統已初始化');
});
