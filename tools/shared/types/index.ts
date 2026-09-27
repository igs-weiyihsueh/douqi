/**
 * 編輯器共用型別定義
 * 從 SpinningTop 編輯器套件移植並適配鬥氣割草專案
 */

// ========================================
// 基礎幾何類型
// ========================================

export interface Vec2 {
  x: number;
  y: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

// ========================================
// 場景編輯器類型
// ========================================

export interface SceneObject {
  id: string;
  name: string;
  type: 'mesh' | 'light' | 'camera' | 'marker' | 'spawn_point';
  transform: Transform;
  visible: boolean;
  locked: boolean;
  properties: Record<string, any>;
}

export interface SceneData {
  version: number;
  name: string;
  objects: SceneObject[];
  environment: {
    backgroundColor: string;
    ambientLight: string;
    directionalLight: {
      color: string;
      intensity: number;
      direction: Vec3;
    };
  };
  camera: {
    position: Vec3;
    target: Vec3;
  };
}

// ========================================
// 關卡編輯器類型
// ========================================

export interface LevelData {
  version: number;
  name: string;
  arena: ArenaConfig;
  spawnRules: SpawnRuleConfig;
  bossConfig: BossConfig;
  obstacleConfig: ObstacleConfig;
  waves: WaveDef[];
  waveRestTime: number;
  spawnPoints: SpawnPoint[];
  obstacles: ObstacleDef[];
  items: ItemDef[];
  playerSpawns: PlayerSpawn[];
}

export interface ArenaConfig {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  boundaryRadius: number;
  groundColor?: string;
  backgroundImage?: string;
  boundaryShape?: 'circle' | 'rectangle' | 'capsule';
  boundaryWidth?: number;
  boundaryHeight?: number;
  capsuleLength?: number;
  capsuleRadius?: number;
  capsuleDirection?: 'horizontal' | 'vertical';
}

export interface SpawnRuleConfig {
  mode: 'edge_random' | 'fixed_points' | 'mixed';
  maxAlive: number;
  maxSmall: number;
  maxBig: number;
  bigChance: number;
  bigDistribution: {
    zombie_big: number;
    zombie_bomb: number;
    zombie_bouncing: number;
  };
  spawnInterval: number;
  startDelay: number;
}

export interface BossConfig {
  triggerType: 'kill_count' | 'timer' | 'wave';
  triggerValue: number;
  bossType: string;
  spawnPosition: 'center' | 'custom';
  customX: number;
  customY: number;
}

export interface ObstacleConfig {
  randomCount: number;
  types: string[];
  minDistance: number;
}

export interface WaveDef {
  wave: number;
  duration: number;
  smallRate: number;
  bigRate: number;
  description: string;
  triggerBoss?: boolean;
}

export interface SpawnPoint {
  id: string;
  x: number;
  y: number;
  zombieType: string;
  wave: number;
  count: number;
  interval: number;
  maxAlive: number;
}

export interface ObstacleDef {
  id: string;
  x: number;
  y: number;
  type: string;
  radius: number;
}

export interface ItemDef {
  id: string;
  x: number;
  y: number;
  type: string;
  respawnTime: number;
}

export interface PlayerSpawn {
  id: string;
  x: number;
  y: number;
}

// ========================================
// 編輯器通用類型
// ========================================

export interface EditorConfig {
  version: string;
  author: string;
  created: string;
  modified: string;
  description?: string;
}

export interface AssetReference {
  id: string;
  path: string;
  type: 'texture' | 'model' | 'audio' | 'data';
  metadata?: Record<string, any>;
}

// ========================================
// 導出預設值
// ========================================

export const DEFAULT_SCENE_DATA: SceneData = {
  version: 1,
  name: 'New Scene',
  objects: [],
  environment: {
    backgroundColor: '#2a2a2a',
    ambientLight: '#404040',
    directionalLight: {
      color: '#ffffff',
      intensity: 1,
      direction: { x: -1, y: -1, z: -1 }
    }
  },
  camera: {
    position: { x: 0, y: 5, z: 10 },
    target: { x: 0, y: 0, z: 0 }
  }
};

export const DEFAULT_LEVEL_DATA: Partial<LevelData> = {
  version: 1,
  name: 'New Level',
  arena: {
    width: 20,
    height: 20,
    centerX: 0,
    centerY: 0,
    boundaryRadius: 10,
    boundaryShape: 'circle'
  },
  waveRestTime: 3,
  spawnPoints: [],
  obstacles: [],
  items: [],
  playerSpawns: []
};
