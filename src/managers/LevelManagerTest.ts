/**
 * LevelManager 格式轉換測試
 * 用於驗證編輯器格式轉換功能
 */

// 模擬編輯器匯出的格式
const editorLevelData = {
  name: "編輯器關卡",
  version: "1.0",
  entities: [
    {
      type: "wooden_box",
      position: [2, 0, -1],
      color: 9127187,
      id: "entity_1"
    },
    {
      type: "bomb",
      position: [-1, 0, 1],
      color: 16729156,
      id: "entity_2"
    },
    {
      type: "stone",
      position: [1, 0, 2],
      color: 8421504,
      id: "entity_3"
    }
  ]
};

// 預期轉換後的完整格式
const expectedGameFormat = {
  _format: "douqi-level",
  _version: "1.0.0",
  metadata: {
    name: "編輯器關卡",
    description: "從簡潔編輯器匯入的關卡",
    created: "2026-09-27",
    editor: "simple-editor",
    baseScene: "default"
  },
  level: {
    id: "level_timestamp",
    name: "編輯器關卡", 
    description: "透過簡潔編輯器創建的關卡",
    difficulty: "normal",
    timeLimit: 180,
    scoreTarget: 1000
  },
  gameplay: {
    playerStartPosition: [0, 0.5, 0],
    playerStartRotation: [0, 0, 0],
    cameraSettings: {
      type: "follow",
      distance: 8,
      height: 6,
      angle: 30
    },
    objectives: [
      {
        id: "obj_collect",
        type: "collect",
        description: "收集所有道具",
        target: 1, // 1個bomb
        reward: 500
      },
      {
        id: "obj_survive",
        type: "survive",
        description: "存活到時間結束", 
        target: 1,
        reward: 300
      }
    ]
  },
  entities: [
    {
      id: "entity_1",
      type: "obstacle",
      name: "木箱_1",
      position: [2, 0, -1],
      rotation: [0, 0, 0],
      properties: {
        health: 100,
        destructible: true,
        blockMovement: true,
        material: 'wood',
        dropItems: ['coin'],
        dropChance: 0.3
      }
    },
    {
      id: "entity_2", 
      type: "powerup",
      name: "炸彈_2",
      position: [-1, 0, 1],
      rotation: [0, 0, 0],
      properties: {
        effectType: 'explosive',
        explosionRadius: 100,
        explosionDamage: 50,
        duration: 0,
        value: 0,
        autoTrigger: true,
        triggerDelay: 1.0
      }
    },
    {
      id: "entity_3",
      type: "obstacle", 
      name: "石頭_3",
      position: [1, 0, 2],
      rotation: [0, 0, 0],
      properties: {
        health: 200,
        destructible: false,
        blockMovement: true,
        material: 'stone',
        resistance: 'physical'
      }
    }
  ],
  events: [],
  config: {
    backgroundMusic: "default_battle.ogg",
    ambientSounds: ["wind.ogg"],
    weatherEffects: {
      type: "clear",
      windStrength: 0.3
    },
    lighting: {
      timeOfDay: "noon",
      shadowQuality: "medium"
    }
  }
};

export { editorLevelData, expectedGameFormat };
