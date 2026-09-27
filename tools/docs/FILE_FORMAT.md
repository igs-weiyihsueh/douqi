# 📝 .douqi.json 檔案格式規範

> 鬥氣割草遊戲的標準化檔案格式定義，涵蓋場景檔案和關卡檔案的完整規格說明。

## 📋 格式概覽

### 檔案類型
- **場景檔案** (`*.douqi.json`)：3D 場景資料，由場景編輯器產生
- **關卡檔案** (`*.json`)：關卡邏輯配置，由關卡編輯器產生
- **編碼格式**：UTF-8
- **語法標準**：JSON (RFC 7159)

### 版本管理
```json
{
  "_format": "douqi-scene",     // 格式標識
  "_version": "1.0.0",          // 版本號 (語義化版本)
  "metadata": { ... },          // 元資料區塊
  "scene": { ... }              // 主要內容區塊
}
```

## 🏗️ 場景檔案格式 (.douqi.json)

### 基本結構
```json
{
  "_format": "douqi-scene",
  "_version": "1.0.0",
  "metadata": {
    "name": "string",           // 場景名稱
    "description": "string",    // 場景描述
    "created": "YYYY-MM-DD",    // 建立日期
    "modified": "YYYY-MM-DD",   // 修改日期
    "editor": "string",         // 編輯器標識
    "author": "string"          // 作者 (可選)
  },
  "scene": { ... },             // 場景設定
  "objects": [ ... ],           // 3D 物件清單
  "lights": [ ... ],            // 光源清單
  "effects": [ ... ]            // 特效清單
}
```

### 場景設定 (scene)
```json
{
  "scene": {
    "name": "測試場景",
    "ambientColor": "#ffffff",        // 環境光顏色 (hex)
    "ambientIntensity": 0.3,          // 環境光強度 (0-2)
    "sunColor": "#fff8dc",            // 太陽光顏色
    "sunIntensity": 1.0,              // 太陽光強度 
    "sunDirection": [100, 300, 150],  // 太陽光方向 [x,y,z]
    "fog": {                          // 霧效設定 (可選)
      "enabled": false,
      "color": "#cccccc",
      "near": 10,
      "far": 1000
    },
    "skybox": {                       // 天空盒 (可選)
      "type": "color|cubemap",
      "value": "#87ceeb"
    }
  }
}
```

### 3D 物件格式 (objects)
```json
{
  "objects": [
    {
      "id": "obj_001",                // 唯一識別碼
      "name": "地面",                 // 顯示名稱
      "type": "static_mesh",          // 物件類型
      "modelPath": "ground.fbx",      // 模型檔案路徑
      "position": [0, 0, 0],          // 位置 [x, y, z]
      "rotation": [0, 0, 0],          // 旋轉 [rx, ry, rz] (度)
      "scale": [1, 1, 1],             // 縮放 [sx, sy, sz]
      "visible": true,                // 是否可見
      "collider": {                   // 碰撞設定
        "type": "box|sphere|mesh|none",
        "isStatic": true,             // 是否靜態
        "isTrigger": false,           // 是否為觸發器
        "sizeOverride": [2, 2, 2],    // 自定義碰撞盒大小
        "offset": [0, 0, 0]           // 碰撞盒偏移
      },
      "textures": {                   // 材質設定
        "0": {                        // 材質槽索引
          "map": "texture.jpg",       // 貼圖檔案
          "tiling": [1, 1],           // UV 平鋪
          "offset": [0, 0],           // UV 偏移
          "color": "#ffffff",         // 色彩調整
          "metallic": 0.0,            // 金屬度 (0-1)
          "roughness": 0.5            // 粗糙度 (0-1)
        }
      },
      "properties": {                 // 自訂屬性
        "健康值": 100,
        "可互動": true
      },
      "tags": ["ground", "walkable"]  // 標籤清單
    }
  ]
}
```

### 光源格式 (lights)
```json
{
  "lights": [
    {
      "id": "light_001",
      "name": "主光源",
      "type": "directional|point|spot|ambient",
      "enabled": true,
      "color": "#ffffff",             // 光源顏色
      "intensity": 1.0,               // 光源強度
      "position": [0, 5, 0],          // 位置 (點光源/聚光燈)
      "direction": [0, -1, 0],        // 方向 (方向光/聚光燈)  
      "range": 10.0,                  // 照射範圍 (點光源/聚光燈)
      "angle": 30.0,                  // 照射角度 (聚光燈)
      "castShadows": true,            // 是否產生陰影
      "shadowQuality": "medium"       // 陰影品質
    }
  ]
}
```

### 特效格式 (effects)
```json
{
  "effects": [
    {
      "id": "effect_001",
      "name": "環境粒子",
      "type": "particle_system|weather|ambient",
      "enabled": true,
      "position": [0, 2, 0],
      "properties": {
        "particleCount": 100,
        "lifetime": 5.0,
        "emissionRate": 20,
        "startSize": 0.1,
        "endSize": 0.05,
        "startColor": "#ffffff",
        "endColor": "#00000000",
        "texture": "particle.png",
        "blendMode": "additive",
        "gravity": [0, -2, 0],
        "velocity": [0, 1, 0],
        "randomness": 0.5
      }
    }
  ]
}
```

## 🎮 關卡檔案格式 (.json)

### 基本結構
```json
{
  "_format": "douqi-level",
  "_version": "1.0.0", 
  "metadata": {
    "name": "level_001",
    "description": "測試關卡",
    "created": "2026-09-24",
    "editor": "douqi-level-editor",
    "baseScene": "test_scene"         // 基礎場景檔案名
  },
  "level": { ... },                   // 關卡基本設定
  "gameplay": { ... },                // 遊戲玩法設定
  "entities": [ ... ],                // 遊戲實體清單
  "events": [ ... ],                  // 事件觸發清單
  "config": { ... }                   // 環境配置
}
```

### 關卡基本設定 (level)
```json
{
  "level": {
    "id": "level_001",                // 關卡唯一 ID
    "name": "森林試煉",               // 關卡顯示名稱  
    "description": "第一個測試關卡",  // 關卡描述
    "difficulty": "easy",             // 難度等級
    "timeLimit": 300,                 // 時間限制 (秒)
    "scoreTarget": 1000,              // 目標分數
    "maxPlayers": 1,                  // 最大玩家數
    "allowRespawn": true,             // 是否允許重生
    "respawnCost": 10                 // 重生代價 (分數扣除)
  }
}
```

### 遊戲玩法設定 (gameplay)
```json
{
  "gameplay": {
    "playerStartPosition": [0, 0.5, 0],   // 玩家起始位置
    "playerStartRotation": [0, 0, 0],     // 玩家起始旋轉
    "cameraSettings": {                   // 攝影機設定
      "type": "follow|fixed|free",
      "distance": 8,                      // 跟隨距離
      "height": 6,                        // 攝影機高度
      "angle": 30,                        // 俯仰角度
      "smoothness": 5.0                   // 平滑度
    },
    "objectives": [                       // 遊戲目標
      {
        "id": "obj_001",
        "type": "collect|defeat|survive|reach|score",
        "description": "收集10個能量球",
        "target": 10,                     // 目標數值
        "current": 0,                     // 當前進度
        "reward": 500,                    // 獎勵分數
        "required": true,                 // 是否為必要目標
        "hidden": false                   // 是否為隱藏目標
      }
    ],
    "powerups": {                         // 強化道具設定
      "attackBoost": {
        "duration": 15,
        "multiplier": 1.5
      },
      "speedBoost": {
        "duration": 10,  
        "multiplier": 2.0
      }
    }
  }
}
```

### 遊戲實體格式 (entities)
```json
{
  "entities": [
    {
      "id": "enemy_001",
      "type": "enemy|collectible|powerup|npc|interactive",
      "name": "基礎敵人",
      "position": [3, 0, 3],
      "rotation": [0, 0, 0],
      "scale": [1, 1, 1],
      "enabled": true,
      "properties": {
        // 敵人專用屬性
        "health": 100,
        "maxHealth": 100,
        "attackPower": 20,
        "defense": 5,
        "moveSpeed": 2.0,
        "attackRange": 1.5,
        "sightRange": 5.0,
        "aiType": "patrol|chase|guard|aggressive",
        "dropItems": ["energy_orb", "health_pack"],
        "dropChance": 0.3,
        "experience": 50,
        
        // 收集品專用屬性  
        "value": 50,                      // 分數價值
        "collectType": "energy|health|key|treasure",
        "autoRotate": true,
        "rotateSpeed": 90,
        "effectRadius": 1.0,
        
        // 強化道具專用屬性
        "effectType": "attack|speed|health|shield",
        "duration": 10.0,
        "multiplier": 1.5,
        "stackable": false,
        "consumeOnUse": true
      },
      "patrolPoints": [                   // 敵人巡邏路徑
        [3, 0, 3],
        [3, 0, -3], 
        [-3, 0, -3],
        [-3, 0, 3]
      ],
      "animations": {                     // 動畫設定
        "idle": "idle_anim",
        "walk": "walk_anim", 
        "attack": "attack_anim",
        "death": "death_anim"
      },
      "sounds": {                         // 音效設定
        "spawn": "enemy_spawn.ogg",
        "attack": "enemy_attack.ogg",
        "death": "enemy_death.ogg"
      }
    }
  ]
}
```

### 事件系統格式 (events)
```json
{
  "events": [
    {
      "id": "event_001",
      "name": "敵人波次",
      "type": "time|condition|manual|repeating",
      "enabled": true,
      "trigger": {
        // 時間觸發
        "type": "time",
        "time": 60,                       // 觸發時間 (秒)
        
        // 條件觸發  
        "type": "condition",
        "condition": {
          "type": "enemyCount|playerHealth|score|itemCount",
          "operator": "==|!=|>|<|>=|<=",
          "value": 5
        },
        
        // 重複觸發
        "type": "repeating", 
        "interval": 30,                   // 重複間隔
        "maxRepeats": 5                   // 最大重複次數
      },
      "actions": [                        // 觸發動作
        {
          "type": "spawn_enemy",
          "enemyType": "basic_enemy",
          "count": 3,
          "spawnPoints": ["spawn_01", "spawn_02"],
          "interval": 2                   // 生成間隔
        },
        {
          "type": "show_message",
          "message": "敵人來襲！",
          "duration": 3
        },
        {
          "type": "play_sound",
          "soundFile": "warning.ogg",
          "volume": 0.8
        },
        {
          "type": "camera_shake",
          "intensity": 0.5,
          "duration": 1.0
        }
      ],
      "conditions": {                     // 前置條件
        "requiredEvents": ["event_000"],  // 必須先觸發的事件
        "playerLevel": 1,                 // 最低玩家等級
        "itemsRequired": ["key_red"]      // 必須持有的物品
      }
    }
  ]
}
```

### 環境配置格式 (config)
```json
{
  "config": {
    "audio": {
      "backgroundMusic": "battle_theme.ogg",
      "musicVolume": 0.7,
      "loopMusic": true,
      "fadeInTime": 2.0,
      "ambientSounds": [
        {
          "file": "wind.ogg",
          "volume": 0.3,
          "loop": true,
          "fadeDistance": 10
        }
      ]
    },
    "weather": {
      "type": "clear|rain|snow|fog|storm",
      "intensity": 0.5,                  // 天氣強度
      "windStrength": 0.3,               // 風力強度
      "windDirection": [1, 0, 0],        // 風向
      "precipitation": true,              // 是否有降水
      "lightning": false                  // 是否有閃電
    },
    "lighting": {
      "timeOfDay": "dawn|morning|noon|evening|night",
      "dynamicLighting": false,           // 動態光照
      "shadowQuality": "low|medium|high|ultra",
      "ambientOcclusion": true,
      "bloom": true,
      "colorGrading": {
        "contrast": 1.0,
        "saturation": 1.0,
        "brightness": 0.0,
        "gamma": 1.0
      }
    },
    "physics": {
      "gravity": [0, -9.81, 0],          // 重力向量
      "airResistance": 0.1,              // 空氣阻力
      "groundFriction": 0.8,             // 地面摩擦力
      "bounceRestitution": 0.3           // 反彈係數
    },
    "performance": {
      "maxDrawCalls": 1000,              // 最大繪製調用數
      "lodDistance": [10, 25, 50],       // LOD 距離設定
      "cullDistance": 100,               // 遮擋剔除距離
      "particleLimit": 500,              // 粒子數量限制
      "shadowDistance": 50               // 陰影渲染距離
    }
  }
}
```

## 🔧 資料類型定義

### 基礎資料類型
```typescript
// 3D 向量 (位置、方向、顏色等)
type Vector3 = [number, number, number];

// 2D 向量 (UV 座標、平鋪等)  
type Vector2 = [number, number];

// 顏色值 (十六進位格式)
type Color = string;  // "#ffffff", "#ff0000aa"

// 識別碼 (物件 ID、事件 ID 等)
type ID = string;     // "obj_001", "enemy_wave_1"

// 檔案路徑 (相對路徑)
type FilePath = string; // "models/enemy.fbx", "textures/ground.jpg"

// 時間戳 (秒數或 ISO 格式)
type Timestamp = number | string; // 123.45 或 "2026-09-24T10:30:00Z"
```

### 列舉類型定義
```typescript
// 物件類型
enum ObjectType {
  StaticMesh = "static_mesh",
  SkinnedMesh = "skinned_mesh", 
  SpawnPoint = "spawn_point",
  Trigger = "trigger",
  Interactive = "interactive"
}

// 碰撞類型
enum ColliderType {
  None = "none",
  Box = "box",
  Sphere = "sphere", 
  Mesh = "mesh",
  Capsule = "capsule"
}

// 光源類型
enum LightType {
  Directional = "directional",
  Point = "point",
  Spot = "spot",
  Ambient = "ambient"
}

// 難度等級
enum Difficulty {
  Easy = "easy",
  Normal = "normal", 
  Hard = "hard",
  Expert = "expert"
}

// AI 類型
enum AIType {
  Patrol = "patrol",
  Chase = "chase",
  Guard = "guard",
  Random = "random",
  Aggressive = "aggressive"
}
```

## ✅ 格式驗證

### JSON Schema 驗證
使用 JSON Schema 驗證檔案格式正確性：

```bash
# 安裝驗證工具
npm install -g ajv-cli

# 驗證場景檔案
ajv validate -s douqi-scene.schema.json -d scene.douqi.json

# 驗證關卡檔案  
ajv validate -s douqi-level.schema.json -d level.json
```

### 基本格式檢查
```javascript
// 檢查必要欄位
function validateBasicFormat(data) {
  const required = ['_format', '_version', 'metadata'];
  return required.every(field => field in data);
}

// 檢查版本相容性
function checkVersion(version) {
  const major = parseInt(version.split('.')[0]);
  return major === 1; // 支援 v1.x.x
}
```

### 常見錯誤檢查
1. **JSON 語法錯誤**：使用 `JSON.parse()` 檢查
2. **必要欄位遺漏**：檢查 `_format`, `_version`, `metadata`
3. **資料類型錯誤**：位置座標必須為數字陣列
4. **ID 重複**：確保所有物件 ID 唯一
5. **檔案路徑錯誤**：檢查引用的模型和貼圖檔案存在

## 🚨 最佳實踐

### 檔案組織
```
public/
├── scenes/              # 場景檔案
│   ├── level_001.douqi.json
│   ├── level_002.douqi.json
│   └── boss_arena.douqi.json
├── assets/data/levels/  # 關卡配置
│   ├── level_001.json
│   ├── level_002.json  
│   └── boss_arena.json
└── assets/             # 遊戲資源
    ├── models/         # 3D 模型
    ├── textures/       # 貼圖材質
    └── audio/          # 音效檔案
```

### 命名慣例
- **檔案名稱**：使用小寫+下底線 (`level_001`, `forest_scene`)
- **物件 ID**：使用類型前綴 (`obj_`, `enemy_`, `light_`)
- **事件 ID**：使用描述性名稱 (`wave_1`, `boss_spawn`)
- **貼圖路徑**：相對於 `public/assets/` 的路徑

### 效能考量
- **檔案大小**：單個場景檔案建議 < 2MB
- **物件數量**：單場景建議 < 200 個物件
- **貼圖解析度**：建議 ≤ 2048x2048
- **模型複雜度**：建議 ≤ 10K 三角面數

### 版本控制
- 主要格式變更時遞增主版本號
- 新增欄位時遞增次版本號  
- Bug 修正時遞增修訂版本號
- 保持向下相容性

---

**📝 .douqi.json 檔案格式規範 - 標準化、高效能、易維護！**

*制定於 2026-09-24 | 格式版本 v1.0.0*
