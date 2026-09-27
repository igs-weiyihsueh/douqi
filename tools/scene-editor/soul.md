# 3DEG_Ag — 專案知識庫

> 網頁版 3D 遊戲場景編輯器 + 執行器（類似簡化 Unity）
> 技術：Three.js + TypeScript + Vite + Neutralino/Electron
> 路徑：/mnt/f/KiroProjects/3DEG_Ag/

---

## 架構總覽

```
src/
├── editor/          # 編輯器邏輯
│   ├── editorApp.ts (80KB) — 主入口，面板互動、工具列
│   ├── SceneEditor.ts (121KB) — 場景管理、物件操作、序列化
│   ├── PlayMode.ts — 編輯器內遊戲預覽模式
│   ├── Timeline.ts — 時間軸面板（關鍵幀、VFX/Combat markers）
│   ├── VFXPositionGizmo.ts — VFX 位置拖曳工具
│   └── tgaConverter.ts — TGA 貼圖轉換
├── runtime/         # 遊戲執行時系統
│   ├── gameApp.ts — 獨立遊戲入口（game.html）
│   ├── SceneLoader.ts — 場景 JSON → Three.js 物件
│   ├── CombatSystem.ts — 戰鬥（HP/攻擊/受傷/死亡）
│   ├── AIPatrol.ts — AI 狀態機（巡邏/追擊/攻擊）
│   ├── PlayerController.ts — WASD 移動 + 攻擊
│   ├── CollisionSystem.ts — 2D 圓形碰撞（實際使用）
│   ├── PhysicsSystem.ts — Rapier3D WASM（目前效果差）
│   ├── VFXSystem.ts — 粒子特效
│   ├── DamagePopup.ts — 傷害跳字
│   └── DissolveEffect.ts — 死亡消融效果
├── viewer/          # 模型檢視器
├── core/            # 共用核心（Game, SceneManager, ManifestLoader）
├── ecs/             # ECS 基類（未實際使用，class-based 為主）
├── scenes/          # 場景抽象
├── input/           # InputManager
└── assets/          # AssetLoader
```

## 四個入口頁面

| 頁面 | 入口 TS | 用途 |
|------|---------|------|
| editor.html | editorApp.ts | 場景編輯器（三欄 UI + 時間軸） |
| game.html | gameApp.ts | 獨立遊戲執行（載入場景 bundle） |
| viewer.html | viewerApp.ts | 模型檢視器 |
| index.html | main.ts | 首頁/Landing |

## 關鍵設計

### 雙環境同步
- **PlayMode.ts**（編輯器按 Play）和 **gameApp.ts**（獨立遊戲）是兩套獨立執行環境
- 功能必須兩邊同步修改
- PlayMode 用 editor 的 camera、scene、objects；gameApp 自己載入場景

### 碰撞系統（兩套並存）
- **CollisionSystem** — 2D 圓形推擠，PlayerController 和 AIPatrol 實際使用這套
- **PhysicsSystem** — Rapier3D WASM，有 body 但運動結果被 CollisionSystem 覆蓋
- 結論：PhysicsSystem 目前只有擊退(knockback)有用，正常移動不經過它

### 場景格式
- JSON bundle（含 FBX base64 + 貼圖 base64）
- 物件屬性：id, name, position, rotation, scale, modelPath, collider, behavior, animations
- Prefab：.prefab.json（含材質、碰撞、動畫設定的模板）

### 動畫系統
- 使用 Three.js AnimationMixer
- 動畫切段（segments）：在一個 FBX clip 內用 startFrame/endFrame 定義子動畫
- 重要：clone 物件後必須重建 mixer（`new THREE.AnimationMixer(clone)`）
- 材質共享問題：同模型多實例共用材質 → dissolve 必須 clone 材質

---

## 已完成功能清單

### 編輯器
- [x] 三欄面板：物件列表 / 3D 視口 / 檢查器
- [x] FBX 模型匯入 + 多貼圖
- [x] Transform 工具（移動/旋轉/縮放 + 快捷鍵 W/E/R）
- [x] Undo/Redo（Ctrl+Z / Ctrl+Y）
- [x] 場景儲存/載入（JSON）
- [x] 素材庫（已載入模型複用）
- [x] Prefab 系統（儲存/載入含材質+碰撞+動畫的模板）
- [x] 動畫段落編輯（自訂 start/end frame）
- [x] 時間軸面板（VFX markers + Combat markers）
- [x] 碰撞體面板（box/sphere/capsule, auto-fit, offset）
- [x] 行為面板（isPlayer, walk/idle 動畫, speed）
- [x] 戰鬥面板（HP, team, attack/hit/death 動畫, aggro）
- [x] 攝影機系統（FOV, aspect ratio, follow target + offset）
- [x] 燈光設定（ambient + sun/directional）
- [x] Play Mode（在編輯器內即時遊玩測試）
- [x] 匯出遊戲 bundle / 匯出獨立遊戲
- [x] 載入/儲存 overlay（進度指示）
- [x] 可折疊面板 + 啟用開關（碰撞/行為/戰鬥）
- [x] Ctrl+/ Debug 模式
- [x] 攻擊範圍視覺化

### 遊戲執行時
- [x] 場景 bundle 載入
- [x] WASD + Space/J 攻擊 玩家控制
- [x] AI 巡邏 + 追擊 + 攻擊狀態機
- [x] 戰鬥系統（攻擊判定、傷害、受擊硬直、死亡）
- [x] 陣營系統（team 0/1/2 + canAttackTeams）
- [x] 擊退系統（knockbackForce/knockbackUp → 位移）
- [x] VFX 粒子特效（8+ 內建 preset）
- [x] 傷害跳字（DamagePopup）
- [x] 死亡消融（DissolveEffect，材質 clone + 淡出）
- [x] 敵人重生（snapshot 方式：原始 scale/材質/碰撞還原）
- [x] 重生時碰撞體移除（可穿過屍體）→ 重生加回
- [x] AnimationMixer 重建（解決死亡姿勢卡住）
- [x] Rapier3D 物理引擎（已接入但效果有限）
- [x] Neutralino 打包（release/ + 打包遊戲.bat）

---

## 已知問題 / 待改善

### 高優先
1. **PhysicsSystem 實際上無效** — 移動由 CollisionSystem 處理，Rapier body 被覆蓋。需決定：要用 Rapier 取代 CollisionSystem？還是移除 Rapier？
2. **幀率依賴的旋轉** — AIPatrol/PlayerController 的 rotation lerp 用固定因子（0.08/0.15），非 delta-based
3. **場景邊界硬編碼** — ±450 寫死在 AIPatrol + PlayerController

### 中優先
4. **VFXSystem 無 object pool** — 每次 spawn 建/銷 geometry，高頻戰鬥可能 GC 壓力
5. **editorApp.ts / SceneEditor.ts 巨大** — 各 80KB/121KB，需要拆分
6. **PhysicsSystem.update() 忽略 delta** — 用 Rapier 預設步進，模擬速度可能不一致
7. **重力單位** — gravity = -9.81 × 60，暗示 pixel 單位但無文件

### 低優先 / 已知限制
8. **PlayerController 的 camera 參數未使用** — dead reference
9. **AIPatrol playWalk/startWalkAnim 重複方法**
10. **ECS 基類未使用** — 實際為 class-based 系統
11. **VFX 無持續型效果**（火焰、光環等）

---

## 建置與開發

```bash
# 開發（WSL 內可直接跑）
cd /mnt/f/KiroProjects/3DEG_Ag
npx vite dev

# 建置（必須在 Windows 執行，WSL rollup native 不相容）
powershell.exe -Command "cd 'F:\KiroProjects\3DEG_Ag'; npx vite build"

# 型別檢查
npx tsc --noEmit
```

## 重要技術筆記

- Three.js clone() 不複製 AnimationMixer → 要用 SkeletonUtils.clone 或重建 mixer
- 材質共享：同模型多實例共用材質 → dissolve/特效修改材質前要 clone
- Catppuccin Mocha 主題色（#1e1e2e, #89b4fa, #a6e3a1 等）
- UI 全繁體中文
- Git repo 已有，每個修正 commit 一次
