/**
 * 鬥氣割草 - 關卡資料型別定義
 * 對應關卡編輯器產出的 JSON 格式
 */

export interface LevelMetadata {
  name: string;
  description: string;
  created: string;
  editor: string;
  baseScene?: string;
  version?: string;
  author?: string;
}

export interface LevelConfig {
  id: string;
  name: string;
  description: string;
  difficulty: 'easy' | 'normal' | 'hard' | 'expert';
  timeLimit: number;      // 秒
  scoreTarget: number;    // 目標分數
}

export interface PlayerStartData {
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface CameraSettings {
  type: 'follow' | 'fixed' | 'orbital';
  distance?: number;
  height?: number;
  angle?: number;
}

export interface Objective {
  id: string;
  type: 'collect' | 'defeat' | 'survive' | 'reach';
  description: string;
  target: number;
  reward: number;
}

export interface GameplayConfig {
  playerStartPosition: [number, number, number];
  playerStartRotation: [number, number, number];
  cameraSettings: CameraSettings;
  objectives: Objective[];
}

export interface EntityProperties {
  [key: string]: any;
  health?: number;
  attackPower?: number;
  moveSpeed?: number;
  aiType?: string;
  value?: number;
  effectType?: string;
  duration?: number;
  multiplier?: number;
}

export interface GameEntity {
  id: string;
  type: 'enemy' | 'collectible' | 'powerup' | 'obstacle' | 'npc';
  name: string;
  position: [number, number, number];
  rotation: [number, number, number];
  properties: EntityProperties;
  patrolPoints?: [number, number, number][];
}

export interface GameEvent {
  id: string;
  type: 'enemy_wave' | 'bonus_event' | 'cutscene' | 'dialogue' | 'environment_change';
  triggerTime?: number;    // 觸發時間（秒）
  triggerCondition?: string; // 觸發條件
  description: string;
  duration?: number;
  enemies?: { type: string; count: number; spawnPoints: string[] }[];
  effect?: string;
  dialogueText?: string;
  [key: string]: any;
}

export interface LevelEnvironmentConfig {
  backgroundMusic?: string;
  ambientSounds?: string[];
  weatherEffects?: {
    type: 'clear' | 'rain' | 'snow' | 'fog';
    intensity?: number;
    windStrength?: number;
  };
  lighting?: {
    timeOfDay: 'dawn' | 'noon' | 'sunset' | 'night';
    shadowQuality: 'low' | 'medium' | 'high';
  };
}

export interface LevelData {
  _format: string;
  _version: string;
  metadata: LevelMetadata;
  level: LevelConfig;
  gameplay: GameplayConfig;
  entities: GameEntity[];
  events: GameEvent[];
  config: LevelEnvironmentConfig;
  objectives: Objective[];
  settings: any;
}

// Phaser 專用的轉換型別
export interface PhaserEntity {
  id: string;
  type: string;
  x: number;
  y: number;
  properties: EntityProperties;
  sprite?: Phaser.GameObjects.Sprite;
  body?: Phaser.Physics.Arcade.Body;
}

export interface LevelState {
  isLoaded: boolean;
  currentScore: number;
  timeRemaining: number;
  objectivesCompleted: number;
  entitiesSpawned: PhaserEntity[];
  activeEvents: GameEvent[];
}

export type LevelEventCallback = (event: GameEvent) => void;
export type EntitySpawnCallback = (entity: PhaserEntity) => void;
export type ObjectiveCompleteCallback = (objective: Objective) => void;
