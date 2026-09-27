import { ModelViewer, AnimSegment } from './ModelViewer';

const container = document.getElementById('viewer')!;
const loading = document.getElementById('loading')!;
const viewer = new ModelViewer(container);

let segments: AnimSegment[] = [];

// ===== Model loading =====
const modelInput = document.getElementById('model-input') as HTMLInputElement;
modelInput.addEventListener('change', async () => {
  const file = modelInput.files?.[0];
  if (!file) return;
  loading.style.display = 'block';
  const url = URL.createObjectURL(file);
  await viewer.loadFBX(url);
  URL.revokeObjectURL(url);
  loading.style.display = 'none';
  refreshFullList();
  refreshClipSelect();
});

// ===== Animation loading =====
const animInput = document.getElementById('anim-input') as HTMLInputElement;
animInput.addEventListener('change', async () => {
  const file = animInput.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  await viewer.loadAnimation(url);
  URL.revokeObjectURL(url);
  refreshFullList();
  refreshClipSelect();
});

// ===== Unified animation list (original clips + custom segments) =====
const animList = document.getElementById('animation-list')!;
const stopBtn = document.getElementById('stop-btn')!;
const pauseBtn = document.getElementById('pause-btn')!;
const resumeBtn = document.getElementById('resume-btn')!;

function clearActive() {
  animList.querySelectorAll('li').forEach((el) => el.classList.remove('active'));
}

function refreshFullList() {
  animList.innerHTML = '';

  // Original clips
  const names = viewer.getAnimationNames();
  names.forEach((name) => {
    const li = document.createElement('li');
    const frames = viewer.getAnimationFrameCount(name);
    li.innerHTML = `<span>${name || '(unnamed)'}</span><span class="seg-info">${frames}f</span>`;
    li.addEventListener('click', () => {
      clearActive();
      li.classList.add('active');
      viewer.playAnimation(name);
    });
    animList.appendChild(li);
  });

  // Custom segments
  segments.forEach((seg, idx) => {
    const li = document.createElement('li');
    li.classList.add('seg-item');
    li.innerHTML = `
      <span>▸ ${seg.name} <span class="seg-info">[${seg.startFrame}-${seg.endFrame}]</span></span>
      <button class="btn btn-danger btn-sm seg-del" data-idx="${idx}">✕</button>
    `;
    li.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('seg-del')) return;
      clearActive();
      li.classList.add('active');
      viewer.playSegment(seg.clipName, seg.startFrame, seg.endFrame, true);
    });
    li.querySelector('.seg-del')!.addEventListener('click', (e) => {
      e.stopPropagation();
      segments.splice(idx, 1);
      refreshFullList();
    });
    animList.appendChild(li);
  });
}

// ===== Playback controls =====
pauseBtn.addEventListener('click', () => viewer.pauseAnimation());
resumeBtn.addEventListener('click', () => viewer.resumeAnimation());
stopBtn.addEventListener('click', () => { viewer.stopAnimation(); clearActive(); });

// ===== Clip select dropdown =====
const segClipSelect = document.getElementById('seg-clip-select') as HTMLSelectElement;

function refreshClipSelect() {
  const names = viewer.getAnimationNames();
  segClipSelect.innerHTML = '';
  names.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name || '(unnamed)';
    segClipSelect.appendChild(opt);
  });
  if (names.length > 0) {
    (document.getElementById('seg-end') as HTMLInputElement).value =
      String(viewer.getAnimationFrameCount(names[0]));
  }
}

segClipSelect.addEventListener('change', () => {
  const frames = viewer.getAnimationFrameCount(segClipSelect.value);
  (document.getElementById('seg-end') as HTMLInputElement).value = String(frames);
});

// ===== Segment creation =====
const addSegBtn = document.getElementById('add-seg-btn')!;
const saveSegBtn = document.getElementById('save-seg-btn')!;
const loadSegInput = document.getElementById('load-seg-input') as HTMLInputElement;

addSegBtn.addEventListener('click', () => {
  const clipName = segClipSelect.value;
  const name = (document.getElementById('seg-name') as HTMLInputElement).value.trim();
  const startFrame = parseInt((document.getElementById('seg-start') as HTMLInputElement).value);
  const endFrame = parseInt((document.getElementById('seg-end') as HTMLInputElement).value);

  if (!clipName || !name) { alert('請填寫名稱與選擇動作來源'); return; }
  if (startFrame >= endFrame) { alert('起始幀必須小於結尾幀'); return; }

  segments.push({ name, clipName, startFrame, endFrame });
  refreshFullList();
});

// ===== Save / Load segments =====
saveSegBtn.addEventListener('click', () => {
  if (segments.length === 0) { alert('尚無區段可匯出'); return; }
  const blob = new Blob([JSON.stringify(segments, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'animation-segments.json';
  a.click();
  URL.revokeObjectURL(url);
});

loadSegInput.addEventListener('change', async () => {
  const file = loadSegInput.files?.[0];
  if (!file) return;
  try {
    const loaded = JSON.parse(await file.text()) as AnimSegment[];
    if (!Array.isArray(loaded)) throw new Error('invalid');
    segments = loaded;
    refreshFullList();
  } catch {
    alert('JSON 格式錯誤');
  }
});

// ===== Texture loading =====
const textureInput = document.getElementById('texture-input') as HTMLInputElement;
textureInput.addEventListener('change', () => {
  const file = textureInput.files?.[0];
  if (!file) return;
  viewer.loadTexture(URL.createObjectURL(file), 'map');
});

const normalInput = document.getElementById('normal-input') as HTMLInputElement;
normalInput.addEventListener('change', () => {
  const file = normalInput.files?.[0];
  if (!file) return;
  viewer.loadTexture(URL.createObjectURL(file), 'normalMap');
});

const roughnessInput = document.getElementById('roughness-input') as HTMLInputElement;
roughnessInput.addEventListener('change', () => {
  const file = roughnessInput.files?.[0];
  if (!file) return;
  viewer.loadTexture(URL.createObjectURL(file), 'roughnessMap');
});

// ===== Light controls =====
function setupLightSlider(sliderId: string, valId: string, lightName: 'ambient' | 'key' | 'fill' | 'hemi') {
  const slider = document.getElementById(sliderId) as HTMLInputElement;
  const valSpan = document.getElementById(valId)!;
  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    valSpan.textContent = v.toFixed(2);
    viewer.setLightIntensity(lightName, v);
  });
}

setupLightSlider('light-ambient', 'light-ambient-val', 'ambient');
setupLightSlider('light-key', 'light-key-val', 'key');
setupLightSlider('light-fill', 'light-fill-val', 'fill');
setupLightSlider('light-hemi', 'light-hemi-val', 'hemi');

function setupColorPicker(pickerId: string, lightName: 'ambient' | 'key' | 'fill') {
  const picker = document.getElementById(pickerId) as HTMLInputElement;
  picker.addEventListener('input', () => {
    viewer.setLightColor(lightName, picker.value);
  });
}

setupColorPicker('color-ambient', 'ambient');
setupColorPicker('color-key', 'key');
setupColorPicker('color-fill', 'fill');

// ===== Model Manifest Export / Import =====
export interface ModelManifest {
  model: string;
  scale: number;
  textures: {
    map?: string;
    normalMap?: string;
    roughnessMap?: string;
  };
  animations: AnimSegment[];
  fps: number;
}

const exportManifestBtn = document.getElementById('export-manifest-btn')!;
const importManifestInput = document.getElementById('import-manifest-input') as HTMLInputElement;

exportManifestBtn.addEventListener('click', () => {
  const modelPath = (document.getElementById('manifest-model-path') as HTMLInputElement).value.trim();
  const diffuse = (document.getElementById('manifest-diffuse') as HTMLInputElement).value.trim();
  const normal = (document.getElementById('manifest-normal') as HTMLInputElement).value.trim();
  const roughness = (document.getElementById('manifest-roughness') as HTMLInputElement).value.trim();
  const scale = parseFloat((document.getElementById('manifest-scale') as HTMLInputElement).value) || 1;

  if (!modelPath) { alert('請填寫模型路徑'); return; }

  const manifest: ModelManifest = {
    model: modelPath,
    scale,
    textures: {},
    animations: segments,
    fps: viewer.getFPS(),
  };
  if (diffuse) manifest.textures.map = diffuse;
  if (normal) manifest.textures.normalMap = normal;
  if (roughness) manifest.textures.roughnessMap = roughness;

  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Use model filename as manifest name
  const baseName = modelPath.split('/').pop()?.replace('.fbx', '') || 'model';
  a.download = `${baseName}.manifest.json`;
  a.click();
  URL.revokeObjectURL(url);
});

importManifestInput.addEventListener('change', async () => {
  const file = importManifestInput.files?.[0];
  if (!file) return;
  try {
    const manifest = JSON.parse(await file.text()) as ModelManifest;
    if (!manifest.model) throw new Error('invalid');

    // Fill in path fields
    (document.getElementById('manifest-model-path') as HTMLInputElement).value = manifest.model;
    (document.getElementById('manifest-diffuse') as HTMLInputElement).value = manifest.textures?.map || '';
    (document.getElementById('manifest-normal') as HTMLInputElement).value = manifest.textures?.normalMap || '';
    (document.getElementById('manifest-roughness') as HTMLInputElement).value = manifest.textures?.roughnessMap || '';
    (document.getElementById('manifest-scale') as HTMLInputElement).value = String(manifest.scale ?? 1);

    // Restore animation segments
    if (Array.isArray(manifest.animations)) {
      segments = manifest.animations;
      refreshFullList();
    }
  } catch {
    alert('Manifest JSON 格式錯誤');
  }
});
