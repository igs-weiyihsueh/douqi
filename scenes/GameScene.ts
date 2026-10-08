import Phaser from 'phaser';
import { GameConfig } from '../config';
import { Character } from '../objects/Character';
import { Enemy, type BossSkillKind, type EnemyType } from '../objects/Enemy';
import { Item, type SkillType } from '../objects/Item';
import { updateRefillLatch, shouldSpawnMore, type WaveSpawnState } from '../systems/waveMath';
import { Bullet } from '../objects/Bullet';
import { Breakable } from '../objects/Breakable';
import { loadCharacterParams, type CharacterParams } from '../systems/characterParams';
import { createStageQueue, nextStageNode, revealStageNode, displayKindOf, type StageNode } from '../systems/stageQueue';
import type { TelegraphFx } from '../systems/telegraphFx';
import { BossController, type BossHost } from '../controllers/BossController';
import { drawCorridorScenery, drawZoneScenery } from '../systems/zoneScenery';
import { ArtStyleController } from '../controllers/ArtStyleController';
import { SkillController, type SkillHost } from '../controllers/SkillController';
import { pointInOrientedRect } from '../systems/geometry';
import {
  applyEnemySeparationSteering, bounceEnemyOffBounds, joinsEnemySeparation,
  pushBreakablesFromCharacter, pushBreakablesFromEnemy, pushCharacterOutOfStructures, pushEnemiesAwayFromCharacter,
  pushEnemiesOutOfNpc, pushEnemyOutOfStructures, resolveEnemyOverlap, standCharacterOutside, updateBreakableMotion
} from '../systems/bodySeparation';
import { drawEnemyChargeWarnings } from '../systems/enemyWarnings';
import { isFixedEnemy, isRegularEnemy, isStructureEnemy } from '../systems/enemyKinds';

/**
 * GameScene：
 * - 4 個角色：P1（玩家滑鼠瞄準操作）＋ P2/P3/P4（BOT AI 代打），共用 Character 類別。
 * - 純滑鼠方向衝刺（遇第一個敵人停下攻擊）、命中累積鬥氣、集滿原地爆發（已削弱、保留擊退）。
 * - 敵人蓄力攻擊 AI，鎖定「最近的存活角色」。
 * - 各角色獨立血量，個別陣亡；全滅才遊戲結束。
 */
export class GameScene extends Phaser.Scene {
  private characters: Character[] = [];
  /** P1 = characters[0]，玩家操作 */
  private get player(): Character {
    return this.characters[0];
  }

  private enemies!: Phaser.Physics.Arcade.Group;  private items!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private breakables!: Phaser.GameObjects.Group;
  private arena!: Phaser.Geom.Rectangle;
  private chargeWarnGfx!: Phaser.GameObjects.Graphics;
  /** 鎖定標記繪圖層（P1 當前鎖定目標） */
  private lockGfx!: Phaser.GameObjects.Graphics;

  /** F4 新舊美術切換（背景圖、P1 皮膚與覆蓋 UI、一般怪外觀），每次 create() 重建 */
  private artStyle!: ArtStyleController;

  private survivalMs = 0;
  private gameOver = false;

  // 生成
  private spawnAccumulator = 0;
  private currentSpawnInterval: number = GameConfig.spawn.initialIntervalMs;
  /** 道具定時保底掉落計時 */
  private itemDropAccumulator = 0;

  // 波次制
  private currentWave = 1;
  private waveQuota = 0;
  private waveKilled = 0;
  private waveSpawned = 0;
  /** 階段2a:latch 補生栓(活怪跌破 threshold 開→補到 maxAlive 才關,防抖)。跨幀持有。 */
  private spawnRefilling = false;
  /** 階段2b 分配制:本波已生的近身組/場上組隻數(用來讓比例收斂 nearShare)+ 近身組輪派座位游標(多人平均分)。 */
  private nearSpawned = 0;
  private fieldSpawned = 0;
  private nearSeatCursor = 0;
  /** 本波已生成的【隊形次數】(spawnFormation 呼叫次數);寶箱怪只在第2次隊形起才 roll,確保「首次生怪」絕不出寶箱。 */
  private waveFormations = 0;
  private waveState: 'spawning' | 'clearing' | 'intermission' | 'boss' | 'event' = 'spawning';
  private intermissionUntil = 0;

  // 關卡系統(第一階段骨架)
  private levelMode = false;               // 是否啟用關卡制
  private currentLevel = 1;                // 場景配色用的關卡 key（無限關卡固定為 stage.sceneLevel）
  /** 目前小關卡編號（1 起算、無限遞增） */
  private currentStage = 1;
  /** 小關卡寶箱佇列：[0] = 目前關卡，長度 = waveHud.visibleStages（見 systems/stageQueue.ts） */
  private stageQueue: StageNode[] = [];
  /** 目前小關卡是否進行中（startStage → completeStage 之間）；過場期間為 false，HUD 不採計殘留擊殺數 */
  private stageInProgress = false;
  /** 剛完成那關的寶箱階級：low → 左右出口平移；high → 上方出口閃黑 */
  private lastStageChest: 'low' | 'high' = 'low';
  /** 左右轉場的方向限制：走過一側後只能繼續同方向（不能回頭），高階上方閃黑後解除；null = 兩側都開 */
  private dirLock: 'L' | 'R' | null = null;
  /** 目前區域（中央 slot）的場景變體：A = 荒城、B = 火山；相鄰區域一律是另一種（荒城 ↔ 火山交替） */
  private areaVariant: 'A' | 'B' = 'A';
  /** 各 slot 的場景繪製物件（key = slot 矩形）；區域往左右延伸時用來回收遠端 slot */
  private slotLayers = new Map<Phaser.Geom.Rectangle, Phaser.GameObjects.GameObject[]>();
  private currentSub: 'A' | 'B' = 'A';     // 當前子區
  private subWavesDone = 0;                // 當前子區已清波數
  private subWavesTarget = 0;              // 當前子區目標波數
  private lastChoice: 'L' | 'R' = 'L';     // 上一次 A→B 選的邊(影響 B 物件配置)
  /** 進程階段:playing=打波次 / choosing=A 清完等玩家選左右 / panning=鏡頭平移中 / exiting=B 清完等玩家走出口 / transition=閃黑切下一關 */
  private progressPhase: 'playing' | 'choosing' | 'panning' | 'exiting' | 'transition' = 'playing';
  /** 階段1:A 清波後開放邊界、玩家自由走去右 B 的「跨越中」狀態(playing 延續,不凍結)。 */
  private crossingOpen = false;
  /**
   * 新鏡頭機制:跨越子階段。
   * 'walk'    = 開放右邊界,玩家走向 A 右緣(鏡頭仍 follow)。
   * 'panning' = 玩家碰 A 右緣→鏡頭 cam.pan 到 B 中心定位(玩家凍結、帶過走廊)。
   * 'enter'   = 鏡頭已定位在 B 中心(固定不 follow),玩家操控角色走進 B 畫面。
   */
  private crossPhase: 'walk' | 'panning' | 'enter' = 'walk';
  /** 階段2:本次跨越鎖定的方向('L'/'R');walk 期未定為 null,碰邊界觸發後鎖定。 */
  private crossSide: 'L' | 'R' | null = null;
  /** 本次左右轉場開放的方向（一般依 dirLock；問號關前由隨機組合指定） */
  private crossAllowed = { L: true, R: true };
  /** 階段2:crossing 開放的時間戳(用於開放後短暫緩衝內不觸發,讓玩家看引導箭頭、不貼邊秒觸發)。 */
  private crossOpenAt = 0;
  /** ③關卡間閃黑後:角色自動走到下關定位的演出旗標(true 期間玩家不可操控,程式驅動走位)。 */
  private levelEntering = false;
  /** 事件結束時場上還有殘留怪→留給玩家打完才收尾;此旗標 true=等殘留清完再 onSubZoneComplete。 */
  private pendingEventComplete = false;
  /** 最後一波打完最後一隻怪時場上還有寶箱怪→延後開啟場景切換,等寶箱怪死/離場才 onSubZoneComplete。 */
  private pendingSubZoneComplete = false;
  /** 進B鏡頭跳一下修:進B後暫不硬收 camera bounds,等鏡頭平滑捲進此 slot 範圍內才收(避免 clamp 跳)。null=無待收。 */
  private pendingCamSlot: Phaser.Geom.Rectangle | null = null;
  private zoneA!: Phaser.Geom.Rectangle;   // A 子區【移動區】矩形(世界座標,置中)
  private zoneB!: Phaser.Geom.Rectangle;   // 當前 B 【移動區】(=選邊後指向 zoneBLeft 或 zoneBRight)
  private zoneBLeft!: Phaser.Geom.Rectangle;  // A 左側的 B 候選【移動區】
  private zoneBRight!: Phaser.Geom.Rectangle; // A 右側的 B 候選【移動區】
  // 方案e:每子區的「視野範圍(slot)」= 移動區 + 四周遠景邊距;camera 跟隨玩家限制在當前 slot 內。
  private slotA!: Phaser.Geom.Rectangle;
  private slotBLeft!: Phaser.Geom.Rectangle;
  private slotBRight!: Phaser.Geom.Rectangle;
  private choiceGfx: Phaser.GameObjects.Graphics | null = null;   // 左右箭頭繪圖
  /** 上方出口繪圖（與左右箭頭分開：問號關前兩者可能同時存在） */
  private exitGfx: Phaser.GameObjects.Graphics | null = null;
  private choiceHint: Phaser.GameObjects.Text | null = null;      // 提示文字
  /** 階段1:右走廊純色佔位底圖(進 B 後清)。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** 階段2:左走廊底圖。 */
  private corridorGfxL: Phaser.GameObjects.Graphics | null = null;
  private levelBanner: Phaser.GameObjects.Text | null = null;     // 關卡標題
  private treasureBanner: Phaser.GameObjects.Text | null = null;  // 寶箱怪出現提示橫幅
  // 事件波開場宣告(階段1):雙段大字+右滑出+時序gate+鎖操作。
  private eventIntroActive = false;
  private eventIntroStage: 'introMove' | 'unified' | 'perEvent' | 'done' = 'done';
  private eventIntroStageEndsAt = 0;   // 當前段(顯示滿)結束時間戳→觸發滑出
  private eventIntroSlideDone = false; // 當前段是否已觸發滑出
  private eventIntroHardEndsAt = 0;    // 逾時保底:整段開場強制結束時間戳
  private eventIntroBanner: Phaser.GameObjects.Text | null = null;
  private pendingEventKind: 'tower' | 'guard' | 'capture' | null = null;
  // 階段3:角色自動走位到目標(introMove,仿 updateLevelEnter)
  private eventIntroWalkEndsAt = 0;    // 走位逾時保底時間戳(到時 snap 到位推進)
  // 階段2:聚焦(pan+壓黑+凍敵定格)
  private eventFocusPause = false;                       // 獨立凍敵定格旗標(不借 timeStopped)
  private eventFocusPanning = false;                     // pan 進行中(pan 完才開壓黑/開始 focus 計時)
  private eventFocusDim: Phaser.GameObjects.Rectangle | null = null;   // 全螢幕壓黑遮罩
  private eventFocusGlow: Phaser.GameObjects.Arc | null = null;        // 目標亮暈(暖光暈)
  private eventFocusTarget: Phaser.GameObjects.Components.Depth | null = null; // 被聚焦目標(提 depth)
  private eventFocusTargetDepth = 0;                     // 目標原 depth(還原用)
  private sceneLayers: Phaser.GameObjects.GameObject[] = [];      // 第二階段:場景繪製物件(重繪時清掉)

  /** BOSS 系統（登場 / 招式 / 亂入離場 / 屍體 / 變身），每次 create() 重建 */
  private bossCtl!: BossController;
  /** 一次性招式（撿道具觸發），每次 create() 重建 */
  private skillCtl!: SkillController;

  // 事件系統
  private eventKind: 'tower' | 'guard' | 'capture' | null = null;
  private tower: Enemy | null = null;  private towerNextBlastAt = 0;
  private towerNextSpawnAt = 0;
  private towerBeamGroup = 0; // 塔光束交替兩組方向（0/1）
  private towerEndsAt = 0; // 塔事件限時倒數截止時間戳(限時內未打掉塔=失敗進下一波)
  private guardNpc: Enemy | null = null;
  private guardHighlight: Phaser.GameObjects.Graphics | null = null;
  private guardEndsAt = 0;
  private guardNextSpawnAt = 0;
  /** 守護【純時間間隔+循環】:guardWaveIdx 只用來選波種(% waves.length),不當結束依據。 */
  private guardWaveIdx = 0;
  /** 混合出波:當前波是否已生成(true=已生,才啟動清空判定,防生成幀 countGuardWaveAlive==0 誤觸)。 */
  private guardWaveActive = false;
  /** 線性遞增:全場累計出波次數(不重置);spawnGuardWave 用來算 perSide 加成。 */
  private guardGlobalWaveCount = 0;
  // 寶箱怪:場上同時只 1 隻(有則不再生);null=場上無寶箱怪
  private treasureEnemy: Enemy | null = null;
  // ③ 寶箱怪金光加強:發光圈(脈動 halo)+ 金色粒子環繞
  private treasureGlow: Phaser.GameObjects.Graphics | null = null;
  private treasureEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private captureProgress = 0; // 0~100
  private captureGfx: Phaser.GameObjects.Graphics | null = null;
  private captureCx = 0;
  private captureCy = 0;
  private captureWaveActive = false; // 目前是否有一波怪在場上待清
  private captureNextWaveAt = 0;     // 清完一波後、下一波生成時間
  private captureEndsAt = 0;         // 佔領時限截止時間

  // 玩家輸入
  private attackKey!: Phaser.Input.Keyboard.Key;
  private playerAttackQueued = false;
  /** 遊戲內道具開關(I 鍵 toggle):執行期旗標,初值取 config.items.spawnEnabled;dropItemAt 讀此值。 */
  private itemsEnabled: boolean = GameConfig.items.spawnEnabled;
  private itemToggleBanner: Phaser.GameObjects.Text | null = null;
  /** 操作模式——'fast'(現況:滑鼠融合瞄準+衝刺移動合一)｜'slow'(純鍵盤:八方向走+面向+範圍圈鎖定) */
  private controlMode: 'fast' | 'slow' = 'fast';
  /**
   * 慢速模式【即時可調參數】——遊戲中用下方調參欄位 −/+ 調整，即時生效。
   * 初值取自 config；slow 模式的鎖定範圍/衝刺距離/衝刺速度改讀這組(fast 仍讀 config 常數不受影響)。
   */
  private slowTuning: Record<'lockRadius' | 'dashDistance' | 'dashSpeed', number> = {
    lockRadius: GameConfig.slow.lockRadius,
    dashDistance: GameConfig.slow.dashDistance,
    dashSpeed: GameConfig.slow.dashSpeed
  };
  /** 角色編輯器的參數（慢速模式套用於 P1 與 BOT）；每次開局從存檔讀取 */
  private charParams: CharacterParams = loadCharacterParams();
  /** slow：八方向移動鍵（方向鍵 + WASD） */
  private slowKeys?: {
    up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key;
  };
  /** 滑鼠最後移動時間（判定 aimActive） */
  private lastPointerMoveAt = -Infinity;
  /** P1 當前鎖定目標 */
  private lockedTarget: Enemy | Item | null = null;
  /** 本幀道具互搶候選（道具 → 目前最近的碰觸角色），update() 末端結算 */
  private pendingPickups = new Map<Item, Character>();
  /** 目前存活中的視覺特效物件數（節流用，超過 maxActiveFx 就略過新視覺） */
  private activeFxCount = 0;
  /** 時間暫停中（全場敵人 + BOT 凍結；施展者不受影響，因其處於 skillLock） */
  private timeStopped = false;
  private timeStopUntil = 0;
  /** 時停道具的【撿到者(owner)】——時停期間 owner 能動,其他角色(+敵人)都停。 */
  private timeStopOwner: Character | null = null;
  /** 時停開始時間戳，用於解除時把敵人蓄力時間戳整批後移（凍結進度不流失） */
  private timeStopStartedAt = 0;
  
  /** 事件系統動態難度調整 - 進入事件時鎖定的玩家數量和難度係數 */
  private eventPlayerCount = 1;
  private eventDifficultyMultiplier = 1.0;
  
  /**
   * 場景層級蓄力/預警特效登記表（塔扇形、BOSS 招 fill）。
   * · 時停時暫停其 tween/延後其 fire 計時、解除時續；
   * · owner 死亡(塔/BOSS)時強制清除 graphics + 取消 pending fire，避免殘留/誤發。
   */
  private telegraphFx: TelegraphFx[] = [];

  /** 第8項：P1 普攻「命中動作」累計次數（一次攻擊命中≥1隻算1；只算 P1、不含 BOT/招式）。R復活/重開歸零。 */
  private p1AttackHits = 0;

  constructor() {
    super('GameScene');
  }

  /** 接收 TitleScene 傳入的操作模式（預設 fast，保持向後相容/直接啟動也不壞） */
  init(data?: { controlMode?: 'fast' | 'slow' }): void {
    this.controlMode = data?.controlMode === 'slow' ? 'slow' : 'fast';
  }

  create(): void {
    this.resetState();

    // 固定視角競技場
    const pad = GameConfig.arena.padding;
    const arenaX = pad;
    const arenaY = pad;
    const arenaW = GameConfig.width - pad * 2;
    const arenaH = GameConfig.height - pad * 2;

    // 關卡制:A 子區【置中】,B 可能在 A 的左側或右側(依玩家選邊)。
    //   世界佈局: [B-左候選][A-中央][B-右候選],世界寬 = 3×slot + 2×gap。
    //   選左→鏡頭往左移、B 呈現在左;選右→鏡頭往右移、B 在右(方向對應直覺)。
    this.levelMode = GameConfig.stage.enabled;
    if (this.levelMode) {
      const st = GameConfig.stage;
      const gap = st.subGap;
      const { width: slotW, height: slotH } = GameScene.stageSlotSize();
      const worldW = slotW * 3 + gap * 2;
      const worldH = slotH;
      // 三個 slot 水平並排:[B-左][A-中][B-右]
      const slotBLeftX = 0, slotAX = slotW + gap, slotBRightX = (slotW + gap) * 2;
      this.slotBLeft = new Phaser.Geom.Rectangle(slotBLeftX, 0, slotW, slotH);
      this.slotA = new Phaser.Geom.Rectangle(slotAX, 0, slotW, slotH);
      this.slotBRight = new Phaser.Geom.Rectangle(slotBRightX, 0, slotW, slotH);
      // 移動區(arena)= slot 扣掉左右/上下不可踏入邊距
      const mx = st.sceneMarginX, mt = st.sceneMarginTop;
      this.zoneBLeft = new Phaser.Geom.Rectangle(slotBLeftX + mx, mt, st.arenaW, st.arenaH);
      this.zoneA = new Phaser.Geom.Rectangle(slotAX + mx, mt, st.arenaW, st.arenaH);
      this.zoneBRight = new Phaser.Geom.Rectangle(slotBRightX + mx, mt, st.arenaW, st.arenaH);
      this.zoneB = this.zoneBRight;   // 佔位(選邊時重指)
      this.arena = this.zoneA;        // 當前移動區(切換時 reassign→108 處引用自動跟隨)
      // 物理世界 = arena(玩家只能在移動區內);camera bounds = 整個世界(可跟隨捲動露遠景)
      this.physics.world.setBounds(this.zoneA.x, this.zoneA.y, this.zoneA.width, this.zoneA.height);
      this.cameras.main.setBounds(0, 0, worldW, worldH);
      // 三格各繪製場景：中央 = areaVariant（開場為荒城），左右鄰格為另一種變體（火山）
      this.drawAreaScenes();
      // playing 鏡頭跟隨在玩家建立後啟用(見 create 末 setupFollowIfLevel)。
    } else {
      this.arena = new Phaser.Geom.Rectangle(arenaX, arenaY, arenaW, arenaH);
      this.physics.world.setBounds(arenaX, arenaY, arenaW, arenaH);
      this.cameras.main.setBounds(0, 0, GameConfig.width, GameConfig.height);
      // 地板 + 圍欄
      this.add
        .tileSprite(arenaX, arenaY, arenaW, arenaH, 'ground')
        .setOrigin(0, 0)
        .setDepth(0);
      const border = this.add.graphics().setDepth(1);
      border.lineStyle(
        GameConfig.arena.borderThickness,
        GameConfig.arena.borderColor,
        1
      );
      border.strokeRect(arenaX, arenaY, arenaW, arenaH);
    }

    // F4 新舊美術切換：需在 slot 佈局建立後，背景圖才能對齊各 slot
    this.artStyle = new ArtStyleController({
      scene: this,
      enemies: () => this.enemies, // 敵人群在之後才建立，用時才取
      player: () => this.player,
      backgroundRects: () => this.levelMode
        ? [this.slotBLeft, this.slotA, this.slotBRight]
        : [new Phaser.Geom.Rectangle(0, 0, GameConfig.width, GameConfig.height)]
    });
    this.artStyle.createBackgrounds();

    // 敵群
    this.enemies = this.physics.add.group({
      classType: Enemy,
      maxSize: GameConfig.spawn.maxAlive,
      runChildUpdate: false
    });
    this.bossCtl = new BossController(this.createBossHost());
    this.skillCtl = new SkillController(this.createSkillHost());

    // 道具群
    this.items = this.physics.add.group({
      classType: Item,
      maxSize: GameConfig.items.maxAlive,
      runChildUpdate: false
    });
    // 子彈群（shooter 用）
    this.bullets = this.physics.add.group({
      classType: Bullet,
      maxSize: GameConfig.enemy.shooter.maxBullets,
      runChildUpdate: false
    });
    // 可打破物件群——普通群(每個 Breakable 自帶靜態物理 body)；碰撞由 createCharacter 的 collider 處理。
    this.breakables = this.add.group({
      classType: Breakable,
      maxSize: GameConfig.breakable.maxAlive,
      runChildUpdate: false
    });
    this.chargeWarnGfx = this.add.graphics().setDepth(2);
    this.lockGfx = this.add.graphics().setDepth(12);

    // 開場只有 P1 一人。BOT 由按 B 逐一加入（見 tryAddBot）。
    this.createCharacter(0, false);

    // F4 用的 P1 皮膚與頭上覆蓋圖（需在 P1 建立後）
    this.artStyle.createPlayerOverlays();

    // 方案e:玩家建立後啟用鏡頭跟隨(限制在 A slot 內、deadzone 緩衝)。
    if (this.levelMode) this.enableFollow(this.slotA);

    // 玩家輸入：空白鍵 + 攻擊鈕
    this.attackKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );
    this.attackKey.on('down', () => this.queuePlayerAttack());

    // slow：八方向移動鍵（方向鍵 + WASD）。fast 模式不使用（不影響）。
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.slowKeys = {
      up: kb.addKey(KC.UP), down: kb.addKey(KC.DOWN),
      left: kb.addKey(KC.LEFT), right: kb.addKey(KC.RIGHT),
      w: kb.addKey(KC.W), a: kb.addKey(KC.A),
      s: kb.addKey(KC.S), d: kb.addKey(KC.D)
    };
    // slow：開場面向初值朝上（避免第一次攻擊朝 aimAngle=0 亂衝）
    if (this.controlMode === 'slow') this.player.aimAngle = -Math.PI / 2;
    // v55(slow-A)：慢速模式 P1【無血量、不會死】——被打只扣能量。fast 不設(有血會死，原樣)。
    if (this.controlMode === 'slow') this.player.noHpLoss = true;
    // 階段3:slow 模式 P1 啟用【強化型態造型】(升級變身視覺;fast 不開,維持原強化視覺)。
    if (this.controlMode === 'slow') this.player.empoweredForm = true;

    // B 鍵：逐一加入 BOT 夥伴（最多湊滿 characters.count）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B).on('down', () => {
      this.tryAddBot();
    });

    // Z 鍵:slow 能量滿 → 手動觸發強化(非自動)。fast 不用(fast 命中10自動觸發照舊)。
    // 靠近 BOSS 屍體時 Z 優先變身 BOSS；變身期間 Z 無作用
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z).on('down', () => {
      if (this.bossCtl.isTransformed) return;
      if (!this.bossCtl.tryTransform()) this.tryManualEmpower();
    });

    // R 鍵：P1 原地滿血復活（無限次）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', () => {
      this.revivePlayer();
    });

    // T 鍵：遊戲進行中隨時乾淨重開一局
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T).on('down', () => {
      this.restartRun();
    });

    // N 鍵：清除場上所有怪 + 立即完成當前波次（debug/爽度熱鍵，跳過事件/BOSS）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.N).on('down', () => {
      this.clearWaveByCheat();
    });

    // I 鍵:遊戲內【道具生成開關】toggle——即時 on/off + 螢幕橫幅提示;關→清掉場上現有道具(直覺)。
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I).on('down', () => {
      this.toggleItems();
    });

    // M 鍵：清場但「走正常過關判定」——清掉小怪並把本波打到達標，
    // 若當前是事件波→觸發事件、BOSS 波→召喚 BOSS、否則進 intermission。
    // （事件/BOSS 進行中則等同 N，直接完成，避免卡）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M).on('down', () => {
      this.clearWaveAndTrigger();
    });

    // ESC 鍵：回主菜單 — 讓玩家可以隨時退出遊戲回到 TitleScene
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on('down', () => {
      this.quitToTitle();
    });

    // 除錯熱鍵 [ / ] :切換預覽關卡場景(1-4),即時重繪當前子區地貌+遠景(給看 4 關對比用)。
    if (this.levelMode) {
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on('down', () => {
        this.debugPreviewLevel(this.currentLevel <= 1 ? GameConfig.stage.totalLevels : this.currentLevel - 1);
      });
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on('down', () => {
        this.debugPreviewLevel(this.currentLevel >= GameConfig.stage.totalLevels ? 1 : this.currentLevel + 1);
      });
    }

    // 滑鼠移動 → 更新 P1 瞄準方向 + 標記活躍時間
    // slow 模式純鍵盤，忽略滑鼠（aimAngle 由鍵盤 facing 設，不被滑鼠覆蓋）。
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.player.alive || this.controlMode === 'slow') return;
      this.player.aimAngle = Phaser.Math.Angle.Between(
        this.player.x,
        this.player.y,
        pointer.worldX,
        pointer.worldY
      );
      this.lastPointerMoveAt = this.time.now;
    });

    this.game.events.on('ui-attack', this.queuePlayerAttack, this);
    // 道具開關觸控按鈕(UIScene 右上角)→ 呼叫現有 toggleItems();與鍵盤 I 鍵並存(兩者同一入口)。
    this.game.events.on('ui-toggle-items', this.toggleItems, this);
    // 初始同步按鈕面(依 config.items.spawnEnabled 的開/關)
    this.game.events.emit('items-state', this.itemsEnabled);

    // 開場第一波灑幾個可打破物件
    this.spawnBreakablesForWave();

    // 關卡制:關卡 1-A 開場——靜態布置 A 物件 + A 子區隨機(純波次 或 事件),顯示關卡標題。
    if (this.levelMode) {
      this.placeStaticBreakables('L'); // 1-A 用預設一套布置
      this.progressPhase = 'playing';
      this.startStage();
      if (GameConfig.spawn.spawnOnStart) this.spawnFormation();
    } else if (GameConfig.spawn.spawnOnStart) {
      this.spawnFormation();
    }

    this.emitStats();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('ui-attack', this.queuePlayerAttack, this);
      this.game.events.off('ui-toggle-items', this.toggleItems, this);
    });
  }

  private resetState(): void {
    // 角色編輯器參數：每局重新讀取（主選單可能剛改過），衝刺距離/速度同步到慢速即時調參
    this.charParams = loadCharacterParams();
    this.slowTuning.dashDistance = this.charParams.dashDistance;
    this.slowTuning.dashSpeed = this.charParams.dashSpeed;
    this.characters = [];
    this.survivalMs = 0;
    this.gameOver = false;
    this.spawnAccumulator = 0;
    this.currentSpawnInterval = GameConfig.spawn.initialIntervalMs;
    this.itemDropAccumulator = 0;
    this.lastPointerMoveAt = -Infinity;
    this.lockedTarget = null;
    this.pendingPickups = new Map();
    this.activeFxCount = 0;
    this.timeStopped = false;
    this.timeStopUntil = 0;
    this.timeStopOwner = null;
    this.timeStopStartedAt = 0;
    this.telegraphFx = [];
    this.playerAttackQueued = false;
    // 波次制：重置回第 1 波
    this.currentWave = 1;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnRefilling = false; // 階段2a:重置 drip latch
    this.nearSpawned = 0; this.fieldSpawned = 0; this.nearSeatCursor = 0; // 階段2b:重置分配計數
    this.itemsEnabled = GameConfig.items.spawnEnabled; // 道具開關:重開回到 config 預設
    this.waveQuota = this.computeWaveQuota(1);
    this.waveState = 'spawning';
    this.intermissionUntil = 0;
    // 關卡系統重置
    this.currentLevel = GameConfig.stage.sceneLevel;
    this.currentStage = 1;
    this.stageInProgress = false;
    this.lastStageChest = 'low';
    this.stageQueue = createStageQueue(GameConfig.waveHud.visibleStages);
    this.dirLock = null;
    this.areaVariant = 'A';
    this.slotLayers = new Map();
    this.currentSub = 'A';
    this.subWavesDone = 0;
    this.subWavesTarget = 1;
    this.lastChoice = 'L';
    this.progressPhase = 'playing';
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
    if (this.exitGfx) { this.exitGfx.destroy(); this.exitGfx = null; }
    this.clearCrossArrows();
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    if (this.levelBanner) { this.levelBanner.destroy(); this.levelBanner = null; }
    this.eventKind = null;
    // 事件開場宣告狀態重置(防殘留/鎖操作卡死)
    this.eventIntroActive = false;
    this.eventIntroStage = 'done';
    this.eventIntroSlideDone = false;
    this.pendingEventKind = null;
    if (this.eventIntroBanner) { this.eventIntroBanner.destroy(); this.eventIntroBanner = null; }
    // 階段2聚焦殘留清除
    this.eventFocusPause = false;
    this.eventFocusPanning = false;
    this.eventFocusTarget = null;
    if (this.eventFocusDim) { this.eventFocusDim.destroy(); this.eventFocusDim = null; }
    if (this.eventFocusGlow) { this.eventFocusGlow.destroy(); this.eventFocusGlow = null; }
    this.tower = null;
    this.treasureEnemy = null; // 寶箱怪:重開清參照(敵人群由 resetState 其他處清)
    if (this.treasureBanner) { this.treasureBanner.destroy(); this.treasureBanner = null; }
    this.pendingEventComplete = false;
    this.pendingSubZoneComplete = false; // 重開清延後切換旗標
    this.guardNpc = null;
    if (this.guardHighlight) { this.guardHighlight.destroy(); this.guardHighlight = null; }
    if (this.captureGfx) { this.captureGfx.destroy(); this.captureGfx = null; }
    this.captureProgress = 0;
    this.captureWaveActive = false; // v39
    this.towerBeamGroup = 0;        // v39
  }

  /** 本波是否為 BOSS 波 */
  private isBossWave(wave: number): boolean {
    // 8 關循環，第 8/16/24… 關為 BOSS 關（壓軸）
    return wave % GameConfig.wave.wavesPerCycle === 0;
  }

  /**
   * 第二輪:關卡制的 BOSS 關判斷。關4=第一輪中場 BOSS(打完接關5森林,不通關);
   * 關 totalLevels(=8)=第二輪壓軸 BOSS(打完 triggerClear 真通關)。
   */
  private isBossLevel(lv: number): boolean {
    return lv === 4 || lv === GameConfig.stage.totalLevels;
  }

  /** 是否為【最終關】(打完真通關結束)——= totalLevels。 */
  private isFinalLevel(lv: number): boolean {
    return lv >= GameConfig.stage.totalLevels;
  }

  /** 本波是否事件波——8 關循環中的第 3/5/7 關（循環內位置 ∈ eventWaves） */
  private isEventWave(wave: number): boolean {
    if (this.isBossWave(wave)) return false;
    const per = GameConfig.wave.wavesPerCycle;
    const pos = ((wave - 1) % per) + 1; // 1..8 循環內位置
    return (GameConfig.wave.eventWaves as readonly number[]).includes(pos);
  }

  /** 本波輪到哪個事件——第3關→tower、第5關→guard、第7關→capture（依 eventWaves 順序輪替） */
  private eventKindForWave(wave: number): 'tower' | 'guard' | 'capture' {
    const per = GameConfig.wave.wavesPerCycle;
    const pos = ((wave - 1) % per) + 1;
    const idx = Math.max(0, (GameConfig.wave.eventWaves as readonly number[]).indexOf(pos));
    return (['tower', 'guard', 'capture'] as const)[idx % 3];
  }

  /** 第 N 波怪數 = baseQuota + (N-1)*quotaGrowth，夾 quotaCap；第8/9關(preBoss)×preBossQuotaMult 爆量 */
  private computeWaveQuota(wave: number): number {
    const w = GameConfig.wave;
    let q = w.baseQuota + (wave - 1) * w.quotaGrowth;
    // BOSS 前高潮關(循環內第 8/9 位)怪量加成
    const per = w.wavesPerCycle;
    const pos = ((wave - 1) % per) + 1;
    if ((w.preBossWaves as readonly number[]).includes(pos)) q *= w.preBossQuotaMult;
    q = Math.min(w.quotaCap, Math.round(q));
    // 階段2b 初期量:早期波次 targetProgress 太低→drip 填不滿 maxAlive→場面偏空。
    //   對【前 earlyWaves 波】把 target 墊到至少 initialFillMult×maxAlive→drip 補到接近滿場(2a 封頂機制不超 target 故安全)。
    const d = w.drip;
    if (wave <= d.earlyWaves) {
      const floor = Math.round(this.curMaxAlive() * d.initialFillMult);
      q = Math.max(q, floor);
    }
    return q;
  }

  private queuePlayerAttack(): void {
    if (this.gameOver || !this.player.alive) return;
    this.playerAttackQueued = true;
  }

  /** 建立一個角色（P1 或 BOT），並掛上道具拾取 overlap */
  private createCharacter(index: number, isBot: boolean): Character {
    let x = this.arena.centerX;
    let y = this.arena.centerY;
    if (isBot) {
      // 出現在 P1 附近，避免貼在敵人上：往隨機方向偏移一段距離
      const angle = Math.random() * Math.PI * 2;
      const off = GameConfig.characters.spawnSpreadRadius;
      const r = GameConfig.player.radius;
      x = Phaser.Math.Clamp(this.player.x + Math.cos(angle) * off, this.arena.left + r, this.arena.right - r);
      y = Phaser.Math.Clamp(this.player.y + Math.sin(angle) * off, this.arena.top + r, this.arena.bottom - r);
    }
    const c = new Character(this, x, y, index, isBot);
    // slow 模式下 BOT 也【noHpLoss 打不死】(與 P1 無差異;fast 則會死,不設)。P1 的 noHpLoss 在 create() 另設。
    if (this.controlMode === 'slow') c.noHpLoss = true;
    
    // 階段二測試：給角色初始Credit值
    c.credit = isBot ? 500 + index * 100 : 1000; // P1: 1000, BOT1: 600, BOT2: 700, BOT3: 800
    this.characters.push(c);
    this.physics.add.overlap(
      c,
      this.items,
      this.onPickupItem as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this
    );
    // 子彈命中角色
    this.physics.add.overlap(
      c,
      this.bullets,
      this.onBulletHitCharacter as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this
    );
    // 木箱與角色的碰撞由每幀手動分離處理（systems/bodySeparation），不用 Arcade collider（高速時會慢慢穿透）。
    return c;
  }

  /** 按 B：逐一加入一隻 BOT，最多湊滿 characters.count（含已加入過/已陣亡） */
  private tryAddBot(): void {
    if (this.gameOver) return;
    if (this.characters.length >= GameConfig.characters.count) return; // 已滿
    const index = this.characters.length; // 下一個索引 = 目前人數
    this.createCharacter(index, true);
  }

  /** 事件系統：偵測目前存活的角色數量（用於動態難度調整） */
  private getAliveCharacterCount(): number {
    return this.characters.filter(c => c.alive).length;
  }

  /** 事件系統：根據玩家數量計算難度係數 */
  private calculateEventDifficultyMultiplier(playerCount: number): number {
    const multipliers = GameConfig.event.dynamicDifficulty.playerCountMultipliers;
    return multipliers[playerCount] ?? multipliers[1] ?? 1.0; // 預設單人難度
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    this.survivalMs += delta;

    this.artStyle.update(time);

    // 階段三：更新COMBO計時系統
    this.updateComboTimers();

    // 事件波開場宣告(階段1):eventIntroActive 期間【鎖操作+凍事件生怪】,只跑開場大字時序 + 標記重繪。
    //   序列跑完(或逾時保底)finishEventIntro→beginEventCombat 才啟動事件計時/生怪。
    if (this.eventIntroActive) {
      this.updateEventIntro(time, delta);
      // 階段3:introMove 走位段由 updateEventIntroWalk 驅動位置(不清零覆蓋);其餘段角色停在原地(鎖操作)。
      if (this.eventIntroStage !== 'introMove') {
        for (const c of this.characters) {
          if (!c.alive) continue;
          (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        }
      }
      this.drawLockMarkers();
      this.emitAim();
      return;
    }

    // 關卡系統階段機:
    // panning(平移中)/transition(閃黑中)→凍結玩家/怪/攻擊,只讓 camera pan/fade 跑(Phaser 內部驅動)。
    if (this.levelMode) {
      if (this.progressPhase === 'panning' || this.progressPhase === 'transition') {
        // 凍結遊戲邏輯,但⑦仍重繪【身體範圍圓圈/面向圈】跟著角色(平移/閃黑移動後圓圈不留原地)。
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      // 新鏡頭機制:crossing 的鏡頭 pan 期間(碰A右緣→pan到B中心)【凍結玩家】讓鏡頭乾淨移動;
      //   pan 完 callback 轉 crossPhase='enter' 後,角色【自動走進B】(非玩家操控,過場演出)。
      if (this.crossingOpen && this.crossPhase === 'panning') {
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      // 新機制步驟3:'enter'——角色【自動移動】往右走進 B(玩家不操控);到 zoneBRight.left→arriveAtSideB。
      if (this.crossingOpen && this.crossPhase === 'enter') {
        this.autoWalkIntoB(delta);
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      // ③關卡間閃黑後:levelEntering 期間全隊自動走到 A 中心定位(玩家不操控);到位恢復。
      if (this.levelEntering) {
        this.updateLevelEnter(delta);
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      if (this.progressPhase === 'choosing') { this.updateChoosing(); this.pulseChoice(time); }
      else if (this.progressPhase === 'exiting') { this.updateExiting(); this.pulseChoice(time); }
      // 階段1:crossing 開放期間(progressPhase 仍 'playing',玩家自由走動不凍結)→偵測走進右 B。
      if (this.crossingOpen) this.updateCrossing();
      // 進B鏡頭跳一下修:進B後等鏡頭平滑捲進 slotB 範圍才收 bounds(避免硬收 clamp 跳)。
      if (this.pendingCamSlot) this.updatePendingCamShrink();
    }

    // 時間暫停到期 → 解除
    if (this.timeStopped && time >= this.timeStopUntil) {
      this.timeStopped = false;
      this.timeStopOwner = null; // 時停結束→清 owner(全部角色恢復可動)
      // 把凍結期間「該不流失的進度」補回——所有敵人絕對時間戳 + 塔/BOSS 發招時間戳整批後移 frozenDur，
      //          並 resume 蓄力/預警 tween。→ 蓄力從暫停點續，時停真的「凍住」了敵人蓄力節奏。
      const frozenDur = this.timeStopUntil - this.timeStopStartedAt;
      if (frozenDur > 0) {
        for (const ch of this.enemies.getChildren()) {
          const e = ch as Enemy;
          e.shiftTimers(frozenDur);
          e.pauseChargeTweens(false);
        }
        for (const fx of this.telegraphFx) fx.tween?.resume();
        // 塔/BOSS 場景層發招排程時間戳後移
        if (this.towerNextBlastAt > 0) this.towerNextBlastAt += frozenDur;
        if (this.towerNextSpawnAt > 0) this.towerNextSpawnAt += frozenDur;
        if (this.guardNextSpawnAt > 0) this.guardNextSpawnAt += frozenDur;
        this.bossCtl.onTimeStopEnd(frozenDur); // 亂入 BOSS 的離場倒數也凍結
        // ④ 寶箱怪時間戳(跑點停頓/出生限時)也後移,凍結期間不流失(否則暫停後跑點/限時錯亂)
        const tr = this.treasureEnemy;
        if (tr && tr.active) {
          tr.treasureSpawnAt += frozenDur;
          if (tr.treasurePauseUntil > 0) tr.treasurePauseUntil += frozenDur;
        }
      }
    }

    // 強化期間能量每秒倒退(drainPerSec)，退到 0 → 解除強化。intermission 期間【暫停倒退】(凍結)。
    // BOT 也有能量強化→對【所有角色】做倒退解除(不再只 P1)。
    // B 修:強化能量消退在【非戰鬥時暫停(凍結drain不扣)】——避免玩家在過場/間隔浪費強化時間。
    //   涵蓋:①波次間隔 intermission ②crossing 鏡頭平移/自動走進B(panning/enter)③閃黑轉場後自動走位(levelEntering)
    //   ④關卡間閃黑(transition)⑤選邊/出口過場(choosing/exiting)⑥時停道具發動中(timeStopped:全場凍結→強化倒數也凍,不白白流失)。
    const drainPaused =
      this.waveState === 'intermission' ||
      this.levelEntering ||
      this.crossingOpen ||   // ①修:涵蓋 crossing 全期(含 walk 選左右走廊)——強化中選左右能量不扣
      this.progressPhase === 'panning' || this.progressPhase === 'transition' ||
      this.progressPhase === 'choosing' || this.progressPhase === 'exiting' ||
      this.timeStopped;      // ⑥時停道具生效中:全場凍結,強化能量不 drain(時停結束才恢復)
    if (!drainPaused) {
      for (const ch of this.characters) {
        if (!ch.alive || !ch.empowered) continue;
        // 爆發亂打演出中（含表演定身時間）不扣能量：等同把變身時間延長爆發演出的長度
        if (ch.isBursting || time < ch.skillLockUntil) continue;
        ch.energy = Math.max(0, ch.energy - GameConfig.energy.drainPerSec * (delta / 1000));
        if (ch.energy <= 0) {
          ch.energy = 0;
          ch.empowered = false; // 能量耗盡 → 解除強化(視覺 aura 由 follow 事件自清)
          if (ch === this.player) this.emitStats();
        }
      }
    }

    // intermission 期間凍結「道具消失倒數」（每幀往後推 delta）；fast 強化倒數也凍結。
    if (this.waveState === 'intermission') {
      if (this.player.empowerUntil > time) this.player.empowerUntil += delta; // fast 強化倒數凍結(slow 用 empowered 旗標不受此)
      for (const child of this.items.getChildren()) {
        const it = child as Item;
        if (it.active) it.shiftExpire(delta);
      }
    }

    this.handleSpawning(delta);
    if (this.waveState === 'event') this.updateEvent(time);
    this.bossCtl.update(time);
    this.updateEnemies(time);
    this.updateTreasure(time); // 寶箱怪:跑點移動/金光閃爍/限時跑走
    this.finishPendingSubZoneIfTreasureGone(); // 延後的場景切換:寶箱怪死/離場後才開啟
    // 守護事件——怪移動後把怪推回守護目標外圈(不疊上去);玩家仍可穿越。放 updateEnemies 之後→怪這幀先移動再被推出,渲染前已在外緣。
    if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc) pushEnemiesOutOfNpc(this.guardNpc, this.enemies, this.arena);
    this.updateItems(delta, time);
    updateBreakableMotion(this.breakables, this.arena, delta); // 可推動物件的位移 / 摩擦 / 邊界 / 互推
    this.updateBullets(time);
    this.updateChargerCollisions(time);

    // slow：先更新 P1 面向(aimAngle)+鍵盤八方向移動，再算鎖定/處理攻擊（同幀用最新面向，無延遲）。
    if (this.controlMode === 'slow') this.handleSlowMovement(time);

    // P1：更新自動鎖定目標（滑鼠只選鎖誰，方向由目標決定）
    this.updateLockTarget(time);
    // 把 P1 鎖定鏡射到角色上，供多色點標記統一繪製
    this.player.lockedTarget = this.lockedTarget as unknown as
      (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;

    // P1：玩家輸入（招式演出鎖定中忽略輸入，角色不受玩家操控）
    // 時停期間非 owner 的 P1 被凍→忽略攻擊輸入(不能行動)。
    if (this.player.alive && this.playerAttackQueued) {
      this.playerAttackQueued = false;
      if (!this.player.isSkillLocked(time) && !this.isFrozenByTimestop(this.player)) {
        if (this.bossCtl.isTransformed) this.bossCtl.formAttack(time); // 變身 BOSS：攻擊鍵改放 BOSS 招式
        else this.tryAct(this.player, time);
      }
    }
    // BOT：AI 決策（招式演出鎖定中略過）時停期間非 owner 的 BOT 被凍→停速度、不跑 AI。
    for (let i = 1; i < this.characters.length; i++) {
      const bot = this.characters[i];
      if (!bot.alive) continue;
      if (this.isFrozenByTimestop(bot)) { (bot.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0); continue; }
      if (!bot.isSkillLocked(time)) this.updateBot(bot, time);
    }

    // slow：P1 鍵盤八方向持續移動 + 更新面向已在上方(updateLockTarget 前)處理。

    // 角色推進：招式演出鎖定中不跑 handleDash（角色由演出 tween 驅動），仍夾在場內 + 標籤跟隨
    for (const c of this.characters) {
      if (!c.alive) continue;
      // 時停期間非 owner 角色【完全凍結】(停速度、不衝刺推進),owner 不受影響。
      if (this.isFrozenByTimestop(c)) {
        (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.clampToArena(c);
        c.syncLabel();
        continue;
      }
      if (!c.isSkillLocked(time)) this.handleDash(c, time);
      // 人型面朝方向（招式演出/爆發期間由各自 tween 控制，不覆蓋）
      // 衝刺中面朝「固定衝刺終點方向」，避免換鎖定(改 aimAngle)讓角色亂轉；否則面朝 aimAngle
      if (!c.isSkillLocked(time) && !c.isBursting) {
        if (c.isDashing) {
          c.setRotation(Math.atan2(c.dashDestY - c.y, c.dashDestX - c.x));
        } else {
          c.setRotation(c.aimAngle);
        }
      }
      // 戰鬥時角色與一般怪輕微分離（不完全重疊）；衝刺中不套用(不影響衝刺打擊貼近手感)
      if (!c.isDashing && !c.isSkillLocked(time)) pushEnemiesAwayFromCharacter(c, this.enemies, this.arena);
      // 木箱擋角色（不可穿越）——每幀手動把重疊木箱的角色推回木箱外緣(可靠、高速不穿透)；衝刺中不套用(衝刺撞破)
      if (!c.isDashing && !c.isSkillLocked(time)) pushBreakablesFromCharacter(c, this.breakables);
      // 塔/BOSS 實體碰撞:角色不可穿過塔/BOSS 本體(含衝刺中也擋,不讓穿王/塔身)
      pushCharacterOutOfStructures(c, this.enemies);
      this.clampToArena(c);
      c.syncLabel();
    }

    // 結算本幀道具互搶（位置近者得、原子拿取、避免雙重觸發）
    this.resolvePickups();

    this.drawLockMarkers();
    this.emitStats();
    this.emitAim();
  }

  // ---------------------------------------------------------------------------
  // 自動鎖定
  // ---------------------------------------------------------------------------
  /** 鎖定目標是否為道具 */
  private isItem(t: Enemy | Item | null): t is Item {
    return t instanceof Item;
  }

  /** 鎖定目標目前是否有效（敵人=可傷、道具=場上存在） */
  private isLockValid(t: Enemy | Item | null): boolean {
    if (!t || !t.active) return false;
    if (this.isItem(t)) return true;
    const e = t as Enemy;
    if (e.enemyType === 'npc') return false; // 守護 NPC 不可鎖定
    if (e.enemyType === 'anchor') return true; // BOSS 戰錨點【可鎖定】（走位落點），雖不可被玩家傷害
    return e.isVulnerable();
  }

  /** 敵人是否可被鎖定/瞄準候選——可傷的怪 或 anchor（可鎖走位點）；排除 npc 與不可傷者。 */
  private isLockableEnemy(e: Enemy): boolean {
    if (!e.active) return false;
    if (e.enemyType === 'npc') return false;
    if (e.enemyType === 'anchor') return true;
    return e.isVulnerable();
  }

  private updateLockTarget(time: number): void {
    // slow 鎖定【重做】：純鍵盤——面向 aimAngle + 範圍圈 lockRadius。
    //   用戶需求：只要藍圈內有敵人，按空白就一定鎖去打——面向【對著】的敵人(35°錐內)優先；面向沒對著
    //   任何敵人但圈內有敵→鎖【圈內最近】的；圈內完全無敵→不鎖(按空白朝面向衝一段)。
    //   避免 箭頭翻轉 bug：用【黏著式】——已鎖且目標存活在圈內就【維持】，不每幀重搶、也【不因面向
    //   轉離而脫鎖】。只有目標死/離圈才重新取得。玩家主動把
    //   面向對準另一隻更接近面向的敵(35°錐內)才切換目標。→ 鎖定穩定、面向箭頭單一不閃。
    if (this.controlMode === 'slow') {
      if (!this.player.alive) { this.lockedTarget = null; return; }
      const R = this.slowTuning.lockRadius;
      const cur = this.lockedTarget;
      const curValid = this.isLockValid(cur) &&
        Phaser.Math.Distance.Between(this.player.x, this.player.y, cur!.x, cur!.y) <= R;
      if (curValid) {
        // 黏著維持當前鎖定(存活+在圈內)——不因面向轉離脫鎖(用戶要「圈內有敵就保持鎖」)。
        // 但若玩家主動把面向對準【另一隻在 35°錐內、且比當前更接近面向】的敵→切換到那隻(主動換目標，指哪打哪)。
        const aimTarget = this.pickAimConeTarget(this.player, R, true);
        if (aimTarget && aimTarget !== cur) {
          const toCur = Phaser.Math.Angle.Between(this.player.x, this.player.y, cur!.x, cur!.y);
          const curDiff = Math.abs(Phaser.Math.Angle.Wrap(toCur - this.player.aimAngle));
          const toAim = Phaser.Math.Angle.Between(this.player.x, this.player.y, aimTarget.x, aimTarget.y);
          const aimDiff = Math.abs(Phaser.Math.Angle.Wrap(toAim - this.player.aimAngle));
          if (aimDiff < curDiff) this.lockedTarget = aimTarget; // 面向對準的新目標更準才切
        }
        return;
      }
      // 無有效鎖定(初始/目標死/離圈)：① 面向錐形(35°)有對著的→鎖那隻(對準優先)；
      //   ② 面向沒對著但圈內有敵→鎖【圈內最近】的(不限角度，用戶要範圍內有就鎖)；③ 圈內無敵→null(朝面向衝)。
      this.lockedTarget = this.pickAimConeTarget(this.player, R, true)
        ?? this.pickNearestInCircle(this.player, R);
      return;
    }
    // 融合模式（autoLock=false）：鎖定 = 滑鼠方向錐形內最接近的怪（給鎖定框顯示 + actByAim 用）；
    // 錐形內無怪則 null（朝空地走位、不畫框）。
    if (!GameConfig.aim.autoLock) {
      if (!this.player.alive) { this.lockedTarget = null; return; }
      let t = this.pickAimConeTarget(this.player);
      // 滑鼠靜止且沒指到目標 → HUD 也顯示自動鎖最近的怪（與 actByAim 一致）
      if (!t && time - this.lastPointerMoveAt > GameConfig.lock.aimActiveWindowMs) {
        t = this.findNearestDamageableEnemy(this.player);
      }
      this.lockedTarget = t;
      return;
    }
    if (!this.player.alive) {
      this.lockedTarget = null;
      return;
    }

    const cur = this.lockedTarget;
    const curValid = this.isLockValid(cur);

    // 目標失效（敵人死亡 / 道具撿到或逾時消失 / 離場太遠）→ 立即改鎖新目標
    if (curValid) {
      const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, cur!.x, cur!.y);
      if (dist > GameConfig.lock.loseTargetRadius) {
        this.lockedTarget = this.acquireTarget(time);
        return;
      }
    } else {
      this.lockedTarget = this.acquireTarget(time);
      return;
    }

    // 黏著：已鎖且有效 → 預設保持；只有滑鼠移動(活躍)且「箭頭方向」與「當前鎖定目標方向」
    // 夾角超過門檻才重選（可能換成別的道具或敵人）。
    const aimActive = time - this.lastPointerMoveAt <= GameConfig.lock.aimActiveWindowMs;
    if (aimActive) {
      const toCur = Phaser.Math.Angle.Between(this.player.x, this.player.y, cur!.x, cur!.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toCur - this.player.aimAngle));
      if (diff > Phaser.Math.DegToRad(GameConfig.lock.switchAngleDeg)) {
        const next = this.pickTargetByAim(this.player);
        if (next) this.lockedTarget = next;
      }
    }
    // 否則（滑鼠不動或小幅抖動）→ 維持當前鎖定，不亂跳。
  }

  /** 無鎖定/失效時取得新目標：滑鼠活躍用箭頭方向選，否則選最近（皆含道具） */
  private acquireTarget(time: number): Enemy | Item | null {
    const aimActive = time - this.lastPointerMoveAt <= GameConfig.lock.aimActiveWindowMs;
    return aimActive ? this.pickTargetByAim(this.player) : this.findNearestLockable(this.player);
  }

  /**
   * 依「與 aimAngle 夾角 + 距離」評分，選箭頭方向最合適的候選（敵人 + 道具平等參與）。
   * 滑鼠指向誰就鎖誰，不強制道具優先。
   */
  private pickTargetByAim(c: Character): Enemy | Item | null {
    const maxR = GameConfig.lock.searchRadius;
    let best: Enemy | Item | null = null;
    let bestScore = Infinity;
    const consider = (obj: Enemy | Item): void => {
      const dist = Phaser.Math.Distance.Between(c.x, c.y, obj.x, obj.y);
      if (dist > maxR) return;
      const toObj = Phaser.Math.Angle.Between(c.x, c.y, obj.x, obj.y);
      const angleDiff = Math.abs(Phaser.Math.Angle.Wrap(toObj - c.aimAngle)); // 0~π
      const score = dist + angleDiff * GameConfig.lock.angleWeight; // 越小越好
      if (score < bestScore) {
        bestScore = score;
        best = obj;
      }
    };
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (this.isLockableEnemy(e)) consider(e);
    }
    for (const child of this.items.getChildren()) {
      const it = child as Item;
      if (it.active) consider(it);
    }
    return best;
  }

  /** 選最近的候選（敵人 + 道具），供滑鼠靜止時鎖定 */
  private findNearestLockable(c: Character): Enemy | Item | null {
    const maxR = GameConfig.lock.searchRadius;
    let best: Enemy | Item | null = null;
    let bestDist = Infinity;
    const consider = (obj: Enemy | Item): void => {
      const dist = Phaser.Math.Distance.Between(c.x, c.y, obj.x, obj.y);
      if (dist <= maxR && dist < bestDist) {
        bestDist = dist;
        best = obj;
      }
    };
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (this.isLockableEnemy(e)) consider(e);
    }
    for (const child of this.items.getChildren()) {
      const it = child as Item;
      if (it.active) consider(it);
    }
    return best;
  }

  /**
   * 多角色鎖定標記——同一目標(敵人或道具)只畫「一個共用框」，
   * 框上緣排開多個小色點，每點代表一個正鎖定此目標的角色(各自代表色)。
   * 支援 P1 + 多 BOT(未來多真人)鎖同目標而不重疊；目標消失/沒人鎖即不畫。
   */
  private drawLockMarkers(): void {
    this.lockGfx.clear();
    const m = GameConfig.lock.marker;

    // slow：原本的【自動鎖定範圍圈】已移除，避免與內層圓盤重疊
    // 專注於瞄準框功能，不再顯示範圍圈

    // 收集：目標 → 鎖定它的角色 index 列表（依角色順序，色點才穩定）
    const groups = new Map<Enemy | Item, number[]>();
    for (const c of this.characters) {
      if (!c.alive) continue;
      const t = c.lockedTarget as unknown as Enemy | Item | null;
      if (!this.isLockValid(t)) continue;
      const arr = groups.get(t!);
      if (arr) arr.push(c.index);
      else groups.set(t!, [c.index]);
    }

    for (const [t, indices] of groups) {
      // 一個共用框
      this.lockGfx.lineStyle(m.thickness, m.color, 0.95);
      this.lockGfx.strokeCircle(t.x, t.y, m.radius);
      const r = m.radius;
      const s = 6;
      const corners = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1]
      ];
      for (const [sx, sy] of corners) {
        this.lockGfx.lineBetween(t.x + sx * r, t.y + sy * r, t.x + sx * (r - s), t.y + sy * r);
        this.lockGfx.lineBetween(t.x + sx * r, t.y + sy * r, t.x + sx * r, t.y + sy * (r - s));
      }

      // 框上緣排開多個角色代表色小色點（置中排列，不重疊）
      const n = indices.length;
      const spacing = m.dotSpacing;
      const startX = t.x - ((n - 1) * spacing) / 2;
      const dotY = t.y - m.dotOrbit;
      for (let k = 0; k < n; k++) {
        const color = GameConfig.characters.colors[indices[k]] ?? 0xffffff;
        const dx = startX + k * spacing;
        this.lockGfx.fillStyle(color, 1);
        this.lockGfx.fillCircle(dx, dotY, m.dotRadius);
        this.lockGfx.lineStyle(1, 0x000000, 0.8);
        this.lockGfx.strokeCircle(dx, dotY, m.dotRadius);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // BOT AI：代打玩家操作（選方向、衝刺攻擊、集鬥氣、滿了爆發）
  // ---------------------------------------------------------------------------
  private updateBot(bot: Character, time: number): void {
    if (!bot.alive) return;

    // 衝刺/爆發進行中不打斷
    if (bot.isDashing || bot.isBursting) return;

    // BOT 目標 = 最近敵人 或「範圍內、越稀有越想搶」的道具（積極度中等，不為遠道具送死）
    const target = this.pickBotTarget(bot);
    bot.lockedTarget = target as unknown as
      (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;

    if (target) {
      bot.aimAngle = Phaser.Math.Angle.Between(bot.x, bot.y, target.x, target.y);
    } else {
      // 沒目標：朝敵群中心游走，避免呆站
      const center = this.getEnemyClusterCenter();
      if (center) {
        const a = Phaser.Math.Angle.Between(bot.x, bot.y, center.x, center.y);
        bot.aimAngle = a;
        const body = bot.body as Phaser.Physics.Arcade.Body;
        body.setVelocity(
          Math.cos(a) * GameConfig.bot.wanderSpeed,
          Math.sin(a) * GameConfig.bot.wanderSpeed
        );
      } else {
        bot.stopMoving();
      }
    }

    // 到出手時間才行動
    if (time < bot.nextBotActAt) return;
    const jitter = Phaser.Math.Between(
      -GameConfig.bot.attackJitterMs,
      GameConfig.bot.attackJitterMs
    );
    bot.nextBotActAt = time + GameConfig.bot.attackIntervalMs + jitter;

    // BOT 與 P1 無差異——爆發不再靠舊 spiritFull,改由連段技系統(onComboHit combo 達門檻9)自動觸發,同 P1。
    // 有目標才出手（近了扇形、遠了衝撞、道具則衝去搶，與 P1 共用 tryAct;命中→onComboHit 累積 combo→達門檻放圓/直/爆發）
    if (target) {
      this.tryAct(bot, time);
    }
  }

  /**
   * BOT 目標選擇——比較「最近敵人」與「範圍內最誘人的道具」，取較優者。
   * 道具吸引力：等效距離 = 實際距離 × distanceBias × (dropWeight)^rarityExponent（越稀有值越小=越想去）。
   * 只考慮 greedRadius 內的道具，避免為遠道具放棄戰鬥送死。
   */
  private pickBotTarget(bot: Character): Enemy | Item | null {
    const enemy = this.findNearestEnemyTo(bot, GameConfig.bot.targetSearchRadius);
    const enemyDist = enemy ? Phaser.Math.Distance.Between(bot.x, bot.y, enemy.x, enemy.y) : Infinity;

    const cfg = GameConfig.bot.item;
    const w = GameConfig.items.weights;
    let bestItem: Item | null = null;
    let bestItemScore = Infinity;
    for (const child of this.items.getChildren()) {
      const it = child as Item;
      if (!it.active || it.taken) continue;
      const dist = Phaser.Math.Distance.Between(bot.x, bot.y, it.x, it.y);
      if (dist > cfg.greedRadius) continue; // 超出貪婪範圍不搶
      // 稀有加權：權重越低(越稀有) → rarityFactor 越小 → 等效距離越小 → 越想搶
      const rarityFactor = Math.pow(w[it.skill] ?? 1, cfg.rarityExponent);
      const score = dist * cfg.distanceBias * rarityFactor;
      if (score < bestItemScore) {
        bestItemScore = score;
        bestItem = it;
      }
    }

    if (!bestItem) return enemy;
    if (!enemy) return bestItem;
    // 道具等效分數 vs 敵人實際距離：較小者勝（道具已含 bias/稀有加權）
    return bestItemScore <= enemyDist ? bestItem : enemy;
  }

  // ---------------------------------------------------------------------------
  // 角色行動（P1 與 BOT 共用）：朝「鎖定目標」帶位移的一擊（可追砍）
  // ---------------------------------------------------------------------------
  /** 不可推動的大型「不動」目標(BOSS/塔)——攻擊這些時停外緣原地揮、不衝進中心避免重疊。
   *  (anchor 是走位落點、玩家本就要衝過去，不算此類；一般怪可推動維持衝上去打。) */
  private isImmovableLargeTarget(e: Enemy | null): boolean {
    return !!e && e.active && isStructureEnemy(e);
  }

  /**
   * 對 BOSS/塔停外緣原地揮擊——把角色移到目標外緣 standoff(目標半徑+玩家半徑+margin)一次(若比現在近才移，
   * 不往裡擠)，面朝目標，performMeleeArc 打。反覆攻擊都停同一外緣、不重疊、不逐次內擠。
   */
  private standoffMeleeAttack(c: Character, target: Enemy, time: number): void {
    const standoff = target.getBodyRadius() + GameConfig.player.radius + 6;
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y);
    // 若已在攻擊範圍內(melee.range)：只在「比 standoff 更近(重疊/太貼)」時推到外緣，否則原地不動(不往裡衝)。
    if (dist <= GameConfig.melee.range) {
      if (dist < standoff) {
        // 太近/重疊 → 沿「目標→角色」方向退到外緣站定(不疊)
        const ang = dist > 0.001 ? Math.atan2(c.y - target.y, c.x - target.x) : c.aimAngle + Math.PI;
        const r = GameConfig.player.radius;
        const nx = Phaser.Math.Clamp(target.x + Math.cos(ang) * standoff, this.arena.left + r, this.arena.right - r);
        const ny = Phaser.Math.Clamp(target.y + Math.sin(ang) * standoff, this.arena.top + r, this.arena.bottom - r);
        c.setPosition(nx, ny);
      }
      this.performMeleeArc(c, time);
      c.nextAttackAllowedAt = time + this.attackCooldownMs();
      return;
    }
    // 還在攻擊範圍外 → 朝目標衝，但終點設在【外緣 standoff】而非中心 → 衝到外緣停、不穿進去
    const destX = target.x - Math.cos(c.aimAngle) * standoff;
    const destY = target.y - Math.sin(c.aimAngle) * standoff;
    this.beginDash(c, destX, destY, time, false);
  }

  private tryAct(c: Character, time: number): void {
    if (c.isBursting || c.isDashing) return;
    if (c.isRooted(time)) return; // 定身中不能行動（攻擊會位移）
    if (time < c.nextAttackAllowedAt) return;

    // 階段4:slow 模式 P1 強化(empowered)期間【唯一招=遠距圓範圍AOE】——
    //   Space 放【以角色為中心的圓 AOE】(不衝刺)、禁用普攻/連段;放完進冷卻。強化結束恢復正常攻擊。
    if (c === this.player && this.controlMode === 'slow' && c.empowered) {
      this.empowerAoe(c, time);
      return;
    }

    // 移除舊「BOT spiritFull→原地爆發」——BOT 已與 P1 無差異,爆發由連段技系統(onComboHit combo 達9)觸發。

    // 滑鼠方向優先模式（僅 P1）——攻擊方向直接用 aimAngle，不被自動鎖定綁死
    // slow 模式不走 actByAim（那含滑鼠靜止自動鎖/mouse 邏輯）；改走下方「用 this.lockedTarget」通用路徑——
    //      lockedTarget 已由 updateLockTarget 的 slow 分支(面向+範圍圈)每幀算好：有鎖→衝去打、無鎖→朝面向衝一段。
    if (c === this.player && this.controlMode !== 'slow' && !GameConfig.aim.autoLock) {
      this.actByAim(c, time);
      return;
    }

    // 決定目標：P1 用自動鎖定目標（敵人或道具）；BOT 用最近敵人（等於自動鎖定）
    // 決定目標：P1 用場景鎖定；BOT 用 updateBot 選好的 bot.lockedTarget（含道具搶奪）
    const target: Enemy | Item | null =
      c === this.player
        ? this.lockedTarget
        : (c.lockedTarget as unknown as Enemy | Item | null);

    // 無鎖定目標 → 朝目前 aimAngle 空揮小衝
    if (!this.isLockValid(target)) {
      // A 修:crossing 走廊無目標時,衝刺【朝角色當前面向 aimAngle】(面向左往左、面向右往右)——
      //   不再固定導向右(0)。之前導向右是為修「fast aimAngle 殘留反向往回衝」,但過度修正成面向左也往右。
      //   直接用玩家目前 aimAngle 即可(面向哪就往哪衝),不覆蓋。
      this.startDirectionDash(c, time);
      return;
    }

    // 鎖定的是道具 → 朝道具衝撞位移過去（碰到由 overlap 觸發拾取）
    if (this.isItem(target)) {
      c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
      this.startDirectionDashTo(c, target.x, target.y, time);
      return;
    }

    // 鎖定的是【不可推動的大型不動目標(BOSS/塔)】→ 不衝進中心(會重疊)，改停外緣原地揮擊。
    //   反覆攻擊時穩定停在 standoff 外緣、不逐次往裡擠、不重疊。快速+慢速共用此路徑。
    if (this.isImmovableLargeTarget(target as Enemy)) {
      this.standoffMeleeAttack(c, target as Enemy, time);
      return;
    }

    // 方向一律朝「角色→鎖定目標」（不用滑鼠裸方向 → 不打架）
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target!.x, target!.y);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, target!.x, target!.y);

    if (dist <= GameConfig.melee.range) {
      // 近：朝目標小位移貼身 + 扇形劍氣
      const step = Math.min(GameConfig.lock.meleeStep, Math.max(0, dist - GameConfig.player.radius));
      const r = GameConfig.player.radius;
      const nx = Phaser.Math.Clamp(c.x + Math.cos(c.aimAngle) * step, this.arena.left + r, this.arena.right - r);
      const ny = Phaser.Math.Clamp(c.y + Math.sin(c.aimAngle) * step, this.arena.top + r, this.arena.bottom - r);
      c.setPosition(nx, ny);
      this.performMeleeArc(c, time);
      c.nextAttackAllowedAt = time + this.attackCooldownMs();
      return;
    }
    // 遠：朝目標衝撞位移（衝刺遇敵停下打 + 衝擊特效）
    this.startDirectionDash(c, time);
  }

  /**
   * 融合瞄準（僅 P1，autoLock=false 為融合模式預設）：
   * 在滑鼠 aimAngle 方向的「錐形範圍(±aimConeDeg, searchRadius 內)」找可傷敵人：
   * · 找得到 → 選最接近滑鼠方向的那隻當鎖定目標，攻擊朝它（自動鎖定黏敵；近則原地扇形、遠則衝刺遇敵停）。
   * · 錐形內無怪（滑鼠指空方向）→ 朝滑鼠 aimAngle 自由衝刺位移（走位，不被拉回最近怪）。
   */
  private actByAim(c: Character, time: number): void {
    let target = this.pickAimConeTarget(c);
    // 滑鼠【靜止】(超過 aimActiveWindowMs 沒動)且錐形內沒指到目標 → 自動鎖【最近的可傷怪】(不鎖 anchor)，
    //         讓玩家不動滑鼠猛按也能自動掃怪；滑鼠【活躍】時維持指哪打哪/指空地走位。
    const aimActive = time - this.lastPointerMoveAt <= GameConfig.lock.aimActiveWindowMs;
    if (!target && !aimActive && c === this.player) {
      target = this.findNearestDamageableEnemy(c);
    }
    if (target) {
      // 鎖定：方向朝該目標；記錄鎖定供畫框
      this.lockedTarget = target;
      c.lockedTarget = target as unknown as
        (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;
      c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
      // 鎖定的是道具 → 朝道具位置衝過去撿（碰到由 overlap 觸發拾取，無磁吸）
      if (this.isItem(target)) {
        this.startDirectionDashTo(c, target.x, target.y, time);
        return;
      }
      const dist = Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y);
      // 鎖定的是 anchor（走位落點）→ 一律衝過去(不管遠近)，衝到停外緣不攻擊不傷害（handleDash 的 anchor 分支）
      if ((target as Enemy).enemyType === 'anchor') {
        this.startDirectionDash(c, time);
        return;
      }
      // 鎖定 BOSS/塔(不可推動大型不動目標)→ 停外緣原地揮擊、不衝進中心重疊(快速模式路徑)。
      if (this.isImmovableLargeTarget(target as Enemy)) {
        this.standoffMeleeAttack(c, target as Enemy, time);
        return;
      }
      if (dist <= GameConfig.melee.range) {
        // 近：貼身小位移 + 原地扇形劍氣
        const step = Math.min(GameConfig.lock.meleeStep, Math.max(0, dist - GameConfig.player.radius));
        const r = GameConfig.player.radius;
        const nx = Phaser.Math.Clamp(c.x + Math.cos(c.aimAngle) * step, this.arena.left + r, this.arena.right - r);
        const ny = Phaser.Math.Clamp(c.y + Math.sin(c.aimAngle) * step, this.arena.top + r, this.arena.bottom - r);
        c.setPosition(nx, ny);
        this.performMeleeArc(c, time);
        c.nextAttackAllowedAt = time + this.attackCooldownMs();
      } else {
        // 遠：朝該怪衝刺（沿用遇敵停下）
        this.startDirectionDash(c, time);
      }
      return;
    }
    // 錐形內無怪：清鎖定 + 朝面向自由衝刺位移
    this.lockedTarget = null;
    c.lockedTarget = null;
    // A 修:crossing 走廊無敵人按攻擊→【朝角色當前面向 aimAngle 衝】(面向左往左、右往右),
    //   不再固定導向右(0)。移除過度修正(原為修 fast 反向往回衝,但造成面向左也往右)。
    this.startDirectionDash(c, time);
  }

  /**
   * slow：在 lockRadius 圈內找【最近】的可鎖敵人(不限角度)——面向沒對著任何敵人但圈內有敵時，
   * 鎖圈內最近的那隻(用戶要「範圍內有敵人就鎖去打」)。只含敵人(isLockableEnemy)，不含道具/anchor。無則 null。
   */
  private pickNearestInCircle(c: Character, R: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDistSq = R * R;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!this.isLockableEnemy(e)) continue;
      const dx = e.x - c.x, dy = e.y - c.y;
      const distSq = dx * dx + dy * dy;
      if (distSq <= bestDistSq) { bestDistSq = distSq; best = e; }
    }
    return best;
  }

  /**
   * 在 c.aimAngle 方向的錐形(±aimConeDeg, searchR 內)找「最接近方向」的可鎖目標(敵/anchor/道具)。
   * 錐形外的不鎖（才能朝空地走位）。無則回 null。
   * 道具納入候選(略優先)。
   * 參數化——searchR 預設 fast 的 lock.searchRadius；slow 傳 slow.lockRadius(範圍圈)。
   *      limitAnchors=true 時 anchor 也受 searchR 限制(slow 範圍圈內才鎖 anchor)；fast 維持 anchor 不受 searchRadius 限。
   *      方向源永遠是 c.aimAngle——fast=滑鼠、slow=鍵盤面向，下游無感。
   */
  private pickAimConeTarget(
    c: Character,
    searchR: number = GameConfig.lock.searchRadius,
    limitAnchors = false
  ): Enemy | Item | null {
    const cone = Phaser.Math.DegToRad(GameConfig.aim.aimConeDeg);
    // 玩家「腳下」很近的目標(尤其站在錨點上時距≈0)方向不穩定、又因距離小恆被選，
    // 會黏死在腳下錨點/目標導致切不到 BOSS。低於此距離的候選一律排除，讓滑鼠能指向他處。
    const underfootR = GameConfig.player.radius + 12;
    let best: Enemy | Item | null = null;
    let bestScore = Infinity; // 已套用道具優惠後的「有效角度差」
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!this.isLockableEnemy(enemy)) continue; // 含 anchor（可鎖）、排除 npc/不可傷
      const dist = Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y);
      if (dist <= underfootR) continue; // 腳下目標排除（不能瞄、避免黏死）
      // fast 下 anchor 不受 searchRadius 限制(BOSS 四錨點需自由切換)；slow(limitAnchors)則一律受範圍圈限制
      if ((limitAnchors || enemy.enemyType !== 'anchor') && dist > searchR) continue;
      const toE = Phaser.Math.Angle.Between(c.x, c.y, enemy.x, enemy.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toE - c.aimAngle));
      if (diff > cone) continue; // 錐形外不鎖
      if (diff < bestScore) {
        bestScore = diff;
        best = enemy;
      }
    }
    // 道具納入候選（滑鼠/面向指向道具方向可鎖它去撿）；角度差打折 → 略優先於敵人。
    const itemMult = GameConfig.aim.itemAimPriorityMult;
    for (const child of this.items.getChildren()) {
      const item = child as Item;
      if (!item.active) continue;
      const dist = Phaser.Math.Distance.Between(c.x, c.y, item.x, item.y);
      if (dist <= underfootR) continue;
      if (dist > searchR) continue;
      const toI = Phaser.Math.Angle.Between(c.x, c.y, item.x, item.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toI - c.aimAngle));
      if (diff > cone) continue; // 錐形外不鎖（實際角度差要在錐內）
      const score = diff * itemMult; // 道具優惠：有效角度差打折
      if (score < bestScore) {
        bestScore = score;
        best = item;
      }
    }
    return best;
  }

  /**
   * 找最近的「可傷怪」（供滑鼠靜止時自動鎖）。排除 anchor/npc/不可傷者——
   * 靜止自動鎖只鎖真正能打的怪，不鎖走位錨點（避免站錨點附近一直空揮）。
   */
  private findNearestDamageableEnemy(c: Character): Enemy | null {
    const searchR = GameConfig.lock.searchRadius;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.isVulnerable()) continue;            // 可傷（自動排除 anchor/npc，因其 isVulnerable=false）
      const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
      if (d > searchR || d >= bestD) continue;
      bestD = d; best = e;
    }
    return best;
  }

  /** 扇形劍氣：朝 aimAngle 劈出扇形，範圍內敵人受普攻傷害+擊退 */
  private performMeleeArc(c: Character, time: number): void {
    const cfg = GameConfig.melee;
    // 扇形半徑/角度隨等級變大
    const emp = c.isEmpowered(time);
    const rangeMult = emp ? GameConfig.combo.empower.rangeMult : 1;
    const radius = cfg.radius * rangeMult;
    const arcDeg = cfg.arcDeg;
    const half = Phaser.Math.DegToRad(arcDeg) / 2;
    // 普攻傷害隨等級
    const atk = this.curAttackDamage() * (emp ? GameConfig.combo.empower.damageMult : 1);
    let hitCount = 0;
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      const dist = Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y);
      if (dist > radius) continue;
      const toEnemy = Phaser.Math.Angle.Between(c.x, c.y, enemy.x, enemy.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toEnemy - c.aimAngle));
      if (diff <= half) {
        this.damageEnemy(c, enemy, atk, GameConfig.player.knockback, time);
        hitCount++;
      }
    }
    // 普攻揮擊範圍(扇形)內順手打破可打破物件(不鎖定、不算 combo)
    this.hitBreakablesInRange(c, radius, half, true, atk, time);
    // 這次攻擊命中(≥1隻) → combo/鬥氣累積（P1 走連段系統、BOT 走舊鬥氣）
    if (hitCount > 0) {
      this.onComboHit(c, time);
      // 階段三：觸發COMBO獎勵系統（改為命中觸發而非擊殺觸發）
      this.triggerComboHit(c);
    }
    this.flashWhite(c);
    this.spawnMeleeArcEffect(c.x, c.y, c.aimAngle);
  }

  /**
   * slow：P1 鍵盤八方向持續移動（正常速度走，非瞬移）+ 更新面向 aimAngle。
   * 只在【非衝刺、非招式鎖定、非定身】時跑；衝刺中由 handleDash 控速度(共用 fast)。
   * 對角線正規化(不 √2 倍速)；有輸入才更新 aimAngle(無輸入維持最後面向)。邊界由 clampToArena 共用。
   */
  /** 時停道具期間,此角色是否【被凍結】(非撿到者 owner 的角色都凍;owner 能動)。 */
  private isFrozenByTimestop(c: Character): boolean {
    return this.timeStopped && c !== this.timeStopOwner;
  }

  private handleSlowMovement(time: number): void {
    const p = this.player;
    if (!p.alive) return;
    const body = p.body as Phaser.Physics.Arcade.Body;
    // 時停道具期間,非 owner 的角色(此處 P1)【被凍結不能操控移動】(owner 才能動)。
    if (this.isFrozenByTimestop(p)) { body.setVelocity(0, 0); return; }
    // 衝刺/招式演出/定身 → 不接管移動（velocity 由各自邏輯控；定身直接停）
    if (p.isDashing || p.isSkillLocked(time) || p.isBursting) return;
    if (p.isRooted(time)) { body.setVelocity(0, 0); return; }
    const k = this.slowKeys!;
    let dx = 0, dy = 0;
    if (k.left.isDown || k.a.isDown) dx -= 1;
    if (k.right.isDown || k.d.isDown) dx += 1;
    if (k.up.isDown || k.w.isDown) dy -= 1;
    if (k.down.isDown || k.s.isDown) dy += 1;
    if (dx === 0 && dy === 0) {
      body.setVelocity(0, 0);
      return;
    }
    // 正規化對角線 → 速度一致
    const len = Math.hypot(dx, dy);
    const nx = dx / len, ny = dy / len;
    const spd = this.charParams.moveSpeed; // 角色編輯器可調
    body.setVelocity(nx * spd, ny * spd);
    // 面向 = 移動方向（決定攻擊/鎖定方向）
    p.aimAngle = Math.atan2(ny, nx);
  }

  /** 普攻冷卻（毫秒）：慢速模式讀角色編輯器參數，快速模式讀 config */
  private attackCooldownMs(): number {
    return this.controlMode === 'slow' ? this.charParams.attackCooldownMs : GameConfig.player.attackCooldownMs;
  }

  private startDirectionDash(c: Character, time: number): void {
    // 強化期間走位/衝刺距離加大
    // slow 模式衝刺距離改讀即時可調 slowTuning.dashDistance；fast 讀 config 常數不變。
    // 用戶追加:slow 模式【所有角色含 BOT】都用短的 slowTuning.dashDistance(原本只 P1);fast 兩者都用 aim.dashDistance。
    const baseDist = (this.controlMode === 'slow')
      ? this.slowTuning.dashDistance
      : GameConfig.aim.dashDistance;
    const emp = c.isEmpowered(time);
    const dist = baseDist * (emp ? GameConfig.combo.empower.moveMult : 1);
    const destX = c.x + Math.cos(c.aimAngle) * dist;
    const destY = c.y + Math.sin(c.aimAngle) * dist;
    // 無鎖朝面向衝——若面向【對著場邊牆】(夾在場內後幾乎到不了任何地方)，衝刺會被 clamp 成原地=「按空白沒動作」。
    //   慢速模式常被逼到邊緣、面向朝外(牆)，此時 dest clamp≈原地 → 玩家覺得「沒衝」。改：偵測夾牆後實際
    //   可移動距離極小 → 改【原地揮擊(performMeleeArc)】，讓按空白一定有攻擊動作(不會像死鍵)。開曠處仍正常衝。
    //   只限 slow 模式(fast 維持原樣、byte 不變)。
    if (c === this.player && this.controlMode === 'slow') {
      const r = GameConfig.player.radius;
      const cx = Phaser.Math.Clamp(destX, this.arena.left + r, this.arena.right - r);
      const cy = Phaser.Math.Clamp(destY, this.arena.top + r, this.arena.bottom - r);
      const reach = Phaser.Math.Distance.Between(c.x, c.y, cx, cy);
      if (reach < GameConfig.player.radius) {
        // 面向被牆擋住、衝不出去 → 原地揮擊(仍有攻擊/命中判定)，按空白不落空。
        this.performMeleeArc(c, time);
        c.nextAttackAllowedAt = time + this.attackCooldownMs();
        return;
      }
    }
    this.beginDash(c, destX, destY, time, false);
  }

  /** 朝指定點（道具位置）衝撞位移過去，途中不因撞敵中止，碰到道具由 overlap 拾取 */
  private startDirectionDashTo(c: Character, x: number, y: number, time: number): void {
    this.beginDash(c, x, y, time, true);
  }

  /** 共用衝刺啟動：設定終點（夾在場內）、衝刺狀態、護盾、是否為撿道具衝刺 */
  /** 階段2:crossing 期間玩家可走範圍——walk 未鎖定側=左右全span;鎖定側後=該側聯集。 */
  private crossClampBounds(): Phaser.Geom.Rectangle {
    if (this.crossSide === 'L') return this.crossUnionRect('L');
    if (this.crossSide === 'R') return this.crossUnionRect('R');
    // walk 未鎖定:左右都能走(zoneBLeft.left → zoneBRight.right)
    const a = this.zoneA;
    return new Phaser.Geom.Rectangle(this.zoneBLeft.left, a.top, this.zoneBRight.right - this.zoneBLeft.left, a.height);
  }

  private beginDash(c: Character, destX: number, destY: number, time: number, toItem: boolean): void {
    const r = GameConfig.player.radius;
    // ④ crossing 期間衝刺 dest 用聯集夾取(否則被夾回 zoneA→衝不出去/看似往回)。
    const bnd = (this.crossingOpen && c === this.player) ? this.crossClampBounds() : this.arena;
    c.dashDestX = Phaser.Math.Clamp(destX, bnd.left + r, bnd.right - r);
    c.dashDestY = Phaser.Math.Clamp(destY, bnd.top + r, bnd.bottom - r);
    c.isDashing = true;
    c.dashToItem = toItem;
    c.nextAttackAllowedAt = time + this.attackCooldownMs();
    // 衝刺期間賦予護盾（無敵）+ 視覺光環，衝刺結束消失
    if (GameConfig.player.dashShieldInvuln) {
      c.dashShielded = true;
    }
    c.showDashShield(true);
  }

  /** 結束衝刺：關閉衝刺狀態、收回護盾（無敵）與視覺 */
  private endDashState(c: Character): void {
    c.isDashing = false;
    c.dashToItem = false;
    c.stopMoving();
    c.dashShielded = false;
    c.showDashShield(false);
  }

  private handleDash(c: Character, time: number): void {
    if (!c.isDashing) return;

    // 衝刺撞到可打破物件→【直接打破】(衝刺是攻擊、撞碎它，不被硬擋停)。只 P1；用衝撞半徑當圓形命中。
    if (c === this.player) {
      const bkRadius = GameConfig.aim.dashHitRadius;
      this.hitBreakablesInRange(c, bkRadius + GameConfig.breakable.radius, 0, false, 99999, time); // 大量傷害=一撞即破，衝刺不卡
    }

    // 衝去撿道具的衝刺，途中不因撞到敵人而中止（確保能撿到）
    if (!c.dashToItem) {
      // 衝撞命中半徑隨等級變大
      const hitRadius = GameConfig.aim.dashHitRadius;
      const hit = this.findFirstEnemyInRangeOf(c, hitRadius);
      if (hit) {
        c.stopMoving();
        this.performAttackOn(c, hit, time);
        // 衝向「不可推動」大型敵人(BOSS/塔)時，停在外緣避免重疊卡住
        if (isStructureEnemy(hit)) standCharacterOutside(c, hit, this.arena);
        this.endDashState(c);
        return;
      }
      // anchor-like 位移點(NPC/錨點)——衝到附近「停在外緣、不觸發攻擊、不重疊卡住」（走位落點）
      const anchor = this.findAnchorInDashPath(c, hitRadius);
      if (anchor) {
        c.stopMoving();
        standCharacterOutside(c, anchor, this.arena);
        this.endDashState(c);
        return;
      }
    }

    // 沒撞到敵人（或撿道具衝刺）→ 繼續朝「固定終點方向」衝；到終點停下。
    // 修正：衝刺速度方向改用「角色→固定終點(dashDestX/Y)」，而非 live aimAngle。
    // 之前用 aimAngle 導致：衝刺途中玩家移動滑鼠切換鎖定 → aimAngle 改變 → 衝刺被滑鼠牽著跑，
    // 因永遠到不了偏離的終點而持續亂飄 = 使用者回報的「換鎖定時大幅位移」。
    const dx = c.dashDestX - c.x;
    const dy = c.dashDestY - c.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 12) {
      c.stopMoving();
      this.endDashState(c);
      return;
    }
    const dashAngle = Math.atan2(dy, dx);
    const body = c.body as Phaser.Physics.Arcade.Body;
    // 強化期間衝向敵人速度加快
    // slow 模式衝刺速度改讀 slowTuning.dashSpeed（角色編輯器可調，P1 與 BOT 都套用）；fast 讀 config 常數不變。
    const baseDashSpeed = (this.controlMode === 'slow')
      ? this.slowTuning.dashSpeed
      : GameConfig.player.dashSpeed;
    const dashSpeed = baseDashSpeed * (c.isEmpowered(time) ? GameConfig.combo.empower.dashSpeedMult : 1);
    // 結束門檻隨速度放大，避免高速(強化)衝刺 overshoot 過終點 → 反向 → 牆邊來回震盪。
    //          剩餘距離 < 這一步會走的量(≈speed×一幀16ms×2 緩衝) 就直接視為到點、停下，不再設反向速度。
    const stopDist = Math.max(12, dashSpeed * 0.032);
    if (dist <= stopDist) {
      c.stopMoving();
      this.endDashState(c);
      return;
    }
    body.setVelocity(
      Math.cos(dashAngle) * dashSpeed,
      Math.sin(dashAngle) * dashSpeed
    );
  }

  private clampToArena(c: Character): void {
    const r = GameConfig.player.radius;
    // 階段2:crossing 開放期間,玩家/隊友可走 [左右span 或 鎖定側聯集](不再被夾在 zoneA)。
    const bnd = this.crossingOpen ? this.crossClampBounds() : this.arena;
    const cx = Phaser.Math.Clamp(c.x, bnd.left + r, bnd.right - r);
    const cy = Phaser.Math.Clamp(c.y, bnd.top + r, bnd.bottom - r);
    const clamped = (cx !== c.x || cy !== c.y);
    if (clamped) {
      c.setPosition(cx, cy);
      // 衝刺中撞到牆界被夾回 → 直接結束衝刺(速度歸零)，避免「clamp 拉回 vs 高速外衝」牆邊來回震盪、
      //          以及卡在 isDashing 狀態導致按攻擊衝不出去。
      if (c.isDashing) this.endDashState(c);
    }
  }

  /**
   * 找出衝刺路徑上「即將重疊到的 anchor-like 位移點」(NPC/錨點)。
   * 用「角色與其中心距離 ≤ 敵半徑 + 玩家半徑 + 邊界」判定重疊在即，回傳最近的一個。
   * anchor-like 不可被玩家傷害，這裡只用來讓衝刺停在外緣（走位落點），不攻擊。
   */
  private findAnchorInDashPath(c: Character, extra: number): Enemy | null {
    // 只在「往該 anchor 方向衝」時才停下——避免站在某 anchor 上往別處(BOSS/別錨點)衝時，
    // 腳下的 anchor 立刻把衝刺攔停（造成「黏在錨點、衝不出去打王」）。
    const dashDX = c.dashDestX - c.x;
    const dashDY = c.dashDestY - c.y;
    const dashLen = Math.hypot(dashDX, dashDY);
    const underfootR = GameConfig.player.radius + 12;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || !e.isAnchorLike()) continue;
      // 守護目標 NPC 可被衝刺【穿越】——不當作攔停落點（其他 anchor：塔走位錨點/佔領錨點 維持攔停）。
      //      讓玩家站 NPC 一側、敵人在另一側時，瞄敵人衝刺能穿過 NPC 打到後方的敵人，而非被 NPC 外緣攔停。
      if (e === this.guardNpc) continue;
      const reach = e.getBodyRadius() + GameConfig.player.radius + extra;
      const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
      // 站在(或極貼近)某 anchor 上時，該 anchor 不當作攔停點——玩家正要離開它衝往他處
      if (d <= underfootR) continue;
      if (d > reach || d >= bestD) continue;
      // 方向過濾：衝刺方向 與 (角色→anchor) 同向(dot>0) 才算「衝向它」；背向/側向的 anchor 不攔停
      if (dashLen > 1) {
        const dot = (dashDX * (e.x - c.x) + dashDY * (e.y - c.y)) / (dashLen * d);
        if (dot <= 0.2) continue; // 非朝向該 anchor → 不攔
      }
      bestD = d; best = e;
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // 目標搜尋
  // ---------------------------------------------------------------------------
  private findFirstEnemyInRangeOf(c: Character, radius: number): Enemy | null {
    const children = this.enemies.getChildren();
    let best: Enemy | null = null;
    // bug修:命中判定納入【敵人體型半徑】(edge-to-center),否則大體型(BOSS radius42/塔34)站著時,
    //   玩家衝到其外緣中心距離 > radius → 判定不到 → 撞外緣停下卻沒觸發攻擊 = BOSS/塔沒扣血。
    //   改成「衝撞半徑 + 敵人 body 半徑」為命中門檻;小怪 body 小、原本就在範圍內,加上只更容易命中不影響。
    //   以「超出各自命中門檻的量(dist - reach)」挑最近的一隻(貼身/重疊者最優先)。
    let bestExcess = Infinity;
    for (const child of children) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      const dx = enemy.x - c.x;
      const dy = enemy.y - c.y;
      const dist = Math.hypot(dx, dy);
      const reach = radius + enemy.getBodyRadius();
      if (dist <= reach) {
        const excess = dist - reach; // 越小(越貼/越重疊)越優先
        if (excess < bestExcess) { bestExcess = excess; best = enemy; }
      }
    }
    return best;
  }

  private findNearestEnemyTo(c: Character, maxRadius: number): Enemy | null {
    return this.findFirstEnemyInRangeOf(c, maxRadius);
  }

  /** 找最近的存活角色（敵人鎖定用） */
  /** 黏著目標:回傳離 (x,y) 最近存活角色的 seat(在 characters 的 index);找不到回 -1。 */
  private nearestSeat(x: number, y: number): number {
    let seat = -1, bestSq = Infinity;
    for (let i = 0; i < this.characters.length; i++) {
      const c = this.characters[i];
      if (!c || !c.alive) continue;
      const dx = c.x - x, dy = c.y - y, d = dx * dx + dy * dy;
      if (d < bestSq) { bestSq = d; seat = i; }
    }
    return seat;
  }

  /**
   * 黏著目標(階段1):決定一隻怪這一幀要追誰。優先序 = 【事件覆寫 > 黏著綁定 > 就近重綁】。
   * - 事件波(守護)：一般怪強制打 guardNpc(忽略黏著)。BOSS/塔/NPC/錨點不套用。
   * - 黏著:讀 targetSeat 綁定角色;若目標死/移除 → 立即重綁最近。
   *   若目標存活但距離 > stickyBreakRadius 持續 stickyBreakSec → 才重綁最近(防抖);否則黏著不換。
   * 回傳目標(角色或事件物件),null 表示原地。
   */
  private resolveEnemyTarget(enemy: Enemy, time: number): Character | { x: number; y: number } | null {
    // ① 事件覆寫(最高優先):守護事件期間一般怪打 NPC
    if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active &&
        !isFixedEnemy(enemy)) {
      return this.guardNpc;
    }
    // ② 黏著綁定
    const cfg = GameConfig.enemySticky;
    let seat = enemy.targetSeat;
    let bound: Character | null = (seat >= 0 && seat < this.characters.length) ? this.characters[seat] : null;
    // 目標死/移除 → 立即重綁最近
    if (!bound || !bound.alive) {
      seat = this.nearestSeat(enemy.x, enemy.y);
      enemy.targetSeat = seat;
      enemy.stickyOutOfRangeSince = 0;
      bound = (seat >= 0) ? this.characters[seat] : null;
      return bound;
    }
    // 目標存活但超距(>stickyBreakRadius)持續 stickyBreakSec → 才重綁(防抖);否則黏著
    const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, bound.x, bound.y);
    if (dist > cfg.stickyBreakRadius) {
      if (enemy.stickyOutOfRangeSince === 0) enemy.stickyOutOfRangeSince = time;
      else if (time - enemy.stickyOutOfRangeSince >= cfg.stickyBreakSec * 1000) {
        seat = this.nearestSeat(enemy.x, enemy.y);
        enemy.targetSeat = seat;
        enemy.stickyOutOfRangeSince = 0;
        bound = (seat >= 0) ? this.characters[seat] : bound;
      }
    } else {
      enemy.stickyOutOfRangeSince = 0; // 回到範圍內→清超距計時
    }
    return bound;
  }

  private getEnemyClusterCenter(): { x: number; y: number } | null {
    const children = this.enemies.getChildren();
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const child of children) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      sumX += enemy.x;
      sumY += enemy.y;
      count++;
    }
    if (count === 0) return null;
    return { x: sumX / count, y: sumY / count };
  }

  /**
   * 計算場上殘留的「一般敵人」數（排除 tower/npc/boss/anchor-like）。
   * 用於事件/上一波結束進下一波時，把殘留怪計入新波 quota。
   */
  private countResidualEnemies(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      // 寶箱怪完全獨立於波次系統:不計 quota(否則活到下波→quota+1→打不掉→卡死)
      if (!isRegularEnemy(e)) continue;
      n++;
    }
    return n;
  }

  /** 階段2a:場上【已實體化】的波次一般怪數(排除結構/寶箱/telegraph中)。drip 的 alive。 */
  private countWaveAlive(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || e.telegraphing) continue;
      if (!isRegularEnemy(e)) continue;
      n++;
    }
    return n;
  }

  /** 階段2a:場上【telegraph 登場中(未實體化)】的波次一般怪數。drip 的 pending(算進總量防超生)。 */
  private countWavePending(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || !e.telegraphing) continue;
      if (!isRegularEnemy(e)) continue;
      n++;
    }
    return n;
  }

  /** 場上是否還有【活著/未離場】的寶箱怪(treasure)。用於延後場景切換直到寶箱怪死/跑走。 */
  private hasTreasureOnField(): boolean {
    const t = this.treasureEnemy;
    return !!(t && t.active && !t.dead);
  }

  /** 延後的場景切換:寶箱怪已死/離場(treasureEnemy 清空)→真正開啟切換。每幀在 updateTreasure 後檢查。 */
  private finishPendingSubZoneIfTreasureGone(): void {
    if (!this.pendingSubZoneComplete) return;
    if (this.hasTreasureOnField()) return; // 寶箱怪還在→等它死/跑走
    this.pendingSubZoneComplete = false;
    this.onSubZoneComplete(); // 寶箱怪清了→真正進選邊/轉場
  }

  // ---------------------------------------------------------------------------
  // 生成
  // ---------------------------------------------------------------------------
  private handleSpawning(delta: number): void {
    // 波次制狀態機
    const time = this.time.now;

    if (this.waveState === 'intermission') {
      if (time >= this.intermissionUntil) {
        // 開始下一波
        this.currentWave++;
        // 事件/上一波殘留在場上的一般怪，計入這一波的目標數（不憑空消失）。
        // 殘留 R 隻：quota = base + R、waveSpawned = R（殘留視為已生），→ 只會再補生 base 隻新怪，
        // 總量 = R(殘留) + base(新生) = base+R，殺光殘留+新怪剛好達 quota。殘留被殺走 onWaveKill 計 waveKilled。
        const residual = this.countResidualEnemies();
        this.waveQuota = this.computeWaveQuota(this.currentWave) + residual;
        this.waveKilled = 0;
        this.waveSpawned = residual;
        this.spawnRefilling = true; // 階段2a:開波 latch 開→立刻補生首批(不冷場、初期飽滿)
        this.nearSpawned = 0; this.fieldSpawned = 0; // 階段2b:新波重置分配計數(比例每波獨立收斂)
        this.waveFormations = 0; // 新波:隊形次數歸零(寶箱怪第2隊形起才可能出)
        this.waveState = 'spawning';
        // 每波開始灑幾個可打破物件(清掉的下一波再補)
        this.spawnBreakablesForWave();
        // 開波首批怪立刻湧出，不冷場——直接生一組 + 歸零 accumulator（後續維持原節奏）
        this.spawnAccumulator = 0;
        // 階段2a:開波用 drip 補到 maxAlive(spawnFormation 內每隻 spawnBlocked 精準封頂,不超 target)
        if (!this.spawnBlocked()) {
          this.spawnFormation();
        }
        this.emitStats();
      }
      return;
    }

    if (this.waveState === 'clearing') {
      // 本波已生滿，等清完；此處不生成（清完的轉換在 onWaveKill 觸發）
      return;
    }

    if (this.waveState === 'boss') {
      // BOSS 波：小怪清完後 BOSS 已登場，等打倒 BOSS（不再生一般怪）
      return;
    }

    if (this.waveState === 'event') {
      // 事件波：事件自己管出怪(守護/佔領)，波次系統不再生一般怪
      return;
    }

    // waveState === 'spawning' —— 階段2a:drip 持續補生(latch 防抖)+ 聰明停生(封頂不超生)
    const survivalSec = this.survivalMs / 1000;
    const baseInterval = Math.max(
      GameConfig.spawn.minIntervalMs,
      GameConfig.spawn.initialIntervalMs - survivalSec * GameConfig.spawn.intervalDecayPerSec
    );
    // 等級越高出怪越快
    this.currentSpawnInterval = baseInterval;

    // drip 狀態:更新 latch(活怪+pending 跌破 threshold 開→補到 maxAlive 才關,防抖)
    const maxAlive = this.curMaxAlive();
    const alive = this.countWaveAlive();
    const pending = this.countWavePending();
    const occupancy = alive + pending;
    const spawnThreshold = Math.round(maxAlive * GameConfig.wave.drip.spawnThresholdRatio);
    this.spawnRefilling = updateRefillLatch(occupancy, maxAlive, spawnThreshold, this.spawnRefilling);

    const ws: WaveSpawnState = {
      progress: this.waveKilled,
      targetProgress: this.waveQuota,
      alive, pending, maxAlive, spawnThreshold,
      refilling: this.spawnRefilling
    };

    // 生產總量已達目標(progress+alive+pending>=target)→本波生產結束,停止再生(殺完剩下即達標過波)
    if (this.waveKilled + occupancy >= this.waveQuota) {
      this.waveState = 'clearing';
      return;
    }

    this.spawnAccumulator += delta;
    if (this.spawnAccumulator < this.currentSpawnInterval) return;

    // 聰明停生:只有 latch 開(occupancy 跌破 threshold)且未達封頂/上限時才補
    if (!shouldSpawnMore(ws)) return;
    this.spawnAccumulator = 0;

    // spawnFormation 內每隻 spawnEnemyAt 再走 spawnBlocked 精準封頂(formation 大小不會超生)
    this.spawnFormation();
  }

  /** 一隻怪被清掉時呼叫——計入本波進度；達配額 → intermission 或（BOSS 波）召喚 BOSS */
  private onWaveKill(): void {
    // 事件後殘留清剩怪階段:每殺一隻檢查殘留是否清完→清完才收尾進下一步(不走一般波次配額邏輯)。
    if (this.pendingEventComplete) {
      this.finishPendingEventIfCleared();
      return;
    }
    // 已在【延後場景切換(等寶箱怪清)】狀態:一般怪已清完,此時再殺到的多半是寶箱怪本身。
    //   不再走波次配額邏輯(subWavesDone 已+1);寶箱怪清空的真正切換由 finishPendingSubZoneIfTreasureGone 每幀處理。
    if (this.pendingSubZoneComplete) return;
    if (this.waveState === 'intermission' || this.waveState === 'boss' || this.waveState === 'event') return;
    this.waveKilled++;
    if (this.waveKilled >= this.waveQuota) {
      // 關卡制:清完一波 → 累計子區波數;達子區目標波數 → 進入選邊/出口階段(不走 BOSS/事件/無限)
      if (this.levelMode) {
        this.subWavesDone++;
        if (this.subWavesDone >= this.subWavesTarget) {
          this.completeStage();
          // 用戶需求:最後一波打完最後一隻怪時,若場上還有【寶箱怪】→【不立刻開啟場景切換】,
          //   延後(pendingSubZoneComplete),等寶箱怪【死掉或離場(跑走)】後(treasureEnemy 清空)才真正切換。
          //   無寶箱怪→直接開(同現在)。
          if (this.hasTreasureOnField()) {
            this.pendingSubZoneComplete = true;
            this.waveState = 'clearing'; // 停止生怪,等寶箱怪清了才切換
          } else {
            this.onSubZoneComplete();
          }
        } else {
          this.enterIntermission();
        }
        this.emitStats();
        return;
      }
      if (this.isBossWave(this.currentWave)) {
        // BOSS 波：小怪清完 → BOSS 登場（打倒才過關）
        this.waveState = 'boss';
        this.bossCtl.spawn();
      } else if (this.isEventWave(this.currentWave)) {
        // 事件波：小怪清完 → 啟動事件（完成才過關）
        this.waveState = 'event';
        this.startEvent(this.eventKindForWave(this.currentWave));
      } else {
        this.enterIntermission();
      }
    }
    this.emitStats();
  }

  /** 進入 intermission（過關）——供 BOSS 擊殺或作弊清場共用 */
  private enterIntermission(): void {
    this.waveState = 'intermission';
    this.intermissionUntil = this.time.now + GameConfig.wave.intermissionMs;
    this.showWaveClear();
    this.emitStats();
  }

  // ========================= 關卡系統(第一階段) =========================

  /** 子區(A 或 B)波數打完時呼叫:A→出現左右箭頭選邊;B→出現上/下出口。 */
  private onSubZoneComplete(): void {
    // 清掉場上殘餘一般怪(進入選邊/出口階段,場地清乾淨)——保留還在場的寶箱怪(同場地,玩家可繼續打/它自己跑走)
    this.clearAllEnemies(true);
    this.waveState = 'clearing'; // 停止生怪
    const next = this.stageQueue[0];
    if (next.kind === 'mystery' && !next.revealed) {
      // 下一關是問號：隨機開兩個出口（不受方向限制），選哪條路就走哪種轉場，進去才揭曉
      this.fleeTreasureNow();
      this.openMysteryExits();
    } else if (this.lastStageChest === 'low') {
      // 低階寶箱：開放左右邊界（受 dirLock 限制），玩家走到邊界 → 鏡頭平移進相鄰區域
      // ③ 進 crossing 過場那刻:場上寶箱怪【直接逃走】(不留到過場/不跟到 B)。
      this.fleeTreasureNow();
      this.openCrossing();
    } else {
      // 高階寶箱：開上方出口 → 閃黑進新區域（方向限制解除）
      this.progressPhase = 'exiting';
      this.showExit();
    }
    // 子區完成(要場景移動:選邊平移 / 出口閃黑)→【不顯示過關訊息】,直接進選邊/出口。
  }

  // ========================= 階段1/2:走過去進單邊 B(無縫走廊核心;左右對稱) =========================

  /** 可跨越聯集:zoneA + 該側走廊 + 該側 zoneB,合成大矩形(三者同高、水平相連)。 */
  private crossUnionRect(side: 'L' | 'R'): Phaser.Geom.Rectangle {
    const a = this.zoneA;
    if (side === 'R') { const bR = this.zoneBRight; return new Phaser.Geom.Rectangle(a.left, a.top, bR.right - a.left, a.height); }
    const bL = this.zoneBLeft; return new Phaser.Geom.Rectangle(bL.left, a.top, a.right - bL.left, a.height);
  }

  /**
   * 問號關前的雙出口：從 左+右 / 左+上 / 右+上 中挑一組，排除回頭方向（dirLock='L' 時不出現右，反之亦然）。
   * 左右照常走邊界平移（並設定 dirLock），上方走出口閃黑（解除 dirLock）；不顯示提示文字，只有箭頭與出口圖示
   */
  private openMysteryExits(): void {
    const back = this.dirLock === 'L' ? 'R' : this.dirLock === 'R' ? 'L' : null;
    const combos = GameConfig.stage.mysteryExitCombos.filter((c) => !back || !c.includes(back));
    const combo = combos[Phaser.Math.Between(0, combos.length - 1)];
    const L = combo.includes('L'), R = combo.includes('R'), up = combo.includes('U');
    this.openCrossing({ L, R }, false);
    if (up) {
      this.progressPhase = 'exiting'; // 左右轉場仍在 crossingOpen 下偵測；exiting 另外偵測上方出口
      this.showExit(false);
    }
  }

  /** 收掉上方出口的圖（問號關前選了另一條路時用） */
  private closeTopExit(): void {
    if (this.exitGfx) { this.exitGfx.destroy(); this.exitGfx = null; }
  }

  /**
   * 開放左右轉場：玩家走到 A 左緣 → 左過場、右緣 → 右過場（progressPhase 維持 'playing'）。
   * - 物理範圍、鏡頭範圍放寬到 A + 開放的側邊；開放側畫走廊；只開一側時預先鎖定 crossSide
   * - 玩家走到開放側的邊界 → updateCrossing → startCameraPanToB(side)
   *
   * @param allowed 開放的方向；省略時依 dirLock（走過一側後只開同側）
   * @param withHint 是否顯示「走到邊界前往下一區」提示文字
   */
  private openCrossing(allowed?: { L: boolean; R: boolean }, withHint = true): void {
    this.crossingOpen = true;
    this.crossPhase = 'walk';
    this.crossAllowed = allowed ?? { L: this.dirLock !== 'R', R: this.dirLock !== 'L' };
    const openL = this.crossAllowed.L;
    const openR = this.crossAllowed.R;
    // 只開一側時直接鎖定該側（crossClampBounds 只開放 A + 該側）；兩側都開時不鎖
    this.crossSide = openL && openR ? null : openL ? 'L' : 'R';
    this.crossOpenAt = this.time.now; // 記開放時間→緩衝期內不觸發
    this.progressPhase = 'playing';
    const a = this.zoneA;
    // 物理：可走範圍 = A + 開放的側邊
    const uL = openL ? this.zoneBLeft.left : a.left;
    const uR = openR ? this.zoneBRight.right : a.right;
    this.physics.world.setBounds(uL, a.top, uR - uL, a.height);
    // 鏡頭 bounds：涵蓋 A 與開放側的 slot；只放寬 bounds、不重呼叫 startFollow(避免 snap)
    const cam = this.cameras.main;
    const camL = openL ? this.slotBLeft.x : this.slotA.x;
    const camR = openR ? this.slotBRight.right : this.slotA.right;
    cam.setBounds(camL, this.slotA.y, camR - camL, this.slotA.height);
    // 開放側的走廊(填滿不露黑)
    if (openR) this.drawCorridorScene('R');
    if (openL) this.drawCorridorScene('L');
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    if (withHint) {
      const hint = openL && openR ? '← 走到左或右邊界前往下一區 →' : openL ? '← 走到左邊界前往下一區' : '走到右邊界前往下一區 →';
      this.choiceHint = this.add.text(this.zoneA.centerX, this.zoneA.top + 46, hint, {
        fontFamily: 'monospace', fontSize: '24px', color: '#ffe98a'
      }).setOrigin(0.5).setDepth(21).setScrollFactor(1);
    }
    // 引導箭頭(純視覺提示往左/右可走;非碰箭頭觸發——玩家仍需走到 A 左/右緣才觸發過場)。
    this.drawCrossingArrows();
  }

  /** 左右引導箭頭(純視覺):比照【出口 showExit 的 drawArrow 表現】(適中三角+白圈,size34,統一風格),A 左右緣左/右箭頭。觸發鎖定側後隱藏。 */
  private drawCrossingArrows(): void {
    this.clearCrossArrows();
    const g = this.add.graphics().setDepth(20).setScrollFactor(1);
    const a = this.arena;
    const midY = a.centerY;
    const inset = GameConfig.stage.arrowInset;
    // 比照 showExit:同一個 drawArrow(三角 s34 + 白描邊圈 r48),風格一致、適中大小。
    if (this.crossAllowed.L) this.drawArrow(g, a.left + inset, midY, -1, 0x7affc0);   // 左箭頭指左(同出口色系)
    if (this.crossAllowed.R) this.drawArrow(g, a.right - inset, midY, +1, 0x7affc0);  // 右箭頭指右
    this.choiceGfx = g;
  }

  /** 清掉引導箭頭。 */
  private clearCrossArrows(): void {
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
  }

  /**
   * 畫一側的走廊場景：填滿 A 該側邊緣到該側 B 之間、整個 slot 高度，避免轉場時露出黑塊（左右各存一份）
   *
   * @param side 走廊在 A 的哪一側
   */
  private drawCorridorScene(side: 'L' | 'R'): void {
    // 同側已有走廊（上一區留下或重複開放）→ 先清掉再畫，避免重疊殘留
    const old = side === 'R' ? this.corridorGfx : this.corridorGfxL;
    if (old) old.destroy();
    const x0 = side === 'R' ? this.zoneA.right : this.zoneBLeft.right;
    const x1 = side === 'R' ? this.zoneBRight.left : this.zoneA.left;
    const g = drawCorridorScenery(this, x0, x1, this.slotA, this.zoneA, this.currentLevel);
    if (side === 'R') this.corridorGfx = g; else this.corridorGfxL = g;
  }

  /**
   * 階段2 crossing 每幀(crossPhase='walk'):玩家走到 A【左緣】→左過場、【右緣】→右過場。
   * 開放後短暫緩衝(graceMs)內【不觸發】:讓玩家看到左右引導箭頭、離開邊界再走向想去的邊,
   *   避免「清波剛好貼 A 某側邊緣→開放瞬間秒觸發沒得選」。一旦觸發鎖定該側(panning 後不可反悔)。
   */
  private updateCrossing(): void {
    if (!this.crossingOpen || this.crossPhase !== 'walk') return;
    // 緩衝期內只顯示箭頭、不判邊界觸發
    const graceMs = GameConfig.stage.crossGraceMs ?? 700;
    if (this.time.now - this.crossOpenAt < graceMs) return;
    const r = GameConfig.player.radius;
    const trigR = this.zoneA.right - r - 4;
    const trigL = this.zoneA.left + r + 4;
    if (this.player.x >= trigR && this.crossAllowed.R) this.startCameraPanToB('R');
    else if (this.player.x <= trigL && this.crossAllowed.L) this.startCameraPanToB('L');
  }

  /**
   * 新機制步驟3:pan 定位 B 後,角色【自動移動】走進 B、停在【中心目標周圍環狀】(過場,玩家不操控)。
   * 用 crossSide 決定進哪側 B。全隊(P1+BOT,預留4人)環繞該側 B 中心 74px 4方位;全員到位→arriveAtSideB(side)。
   * 過場~4秒:速度提高(見 crossAutoSpeed)。
   */
  private autoWalkIntoB(delta: number): void {
    const side = this.crossSide ?? 'R';
    const zoneB = side === 'L' ? this.zoneBLeft : this.zoneBRight;
    const speed = 520;                          // 過場~4秒(4人從A遠處收斂到環狀約4s;單人更快)
    const step = speed * (delta / 1000);
    const cx = zoneB.centerX, cy = zoneB.centerY;
    const R = 74;
    const slotOf = (i: number) => { const ang = -Math.PI / 2 + i * (Math.PI / 2); return { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R }; };
    let allArrived = true;
    for (let i = 0; i < this.characters.length; i++) {
      const c = this.characters[i];
      if (!c.alive) continue;
      const t = slotOf(i);
      const dx = t.x - c.x, dy = t.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        allArrived = false;
        const mv = Math.min(step, dist);
        c.x += (dx / dist) * mv;
        c.y += (dy / dist) * mv;
        c.setRotation(Math.atan2(dy, dx));
        c.aimAngle = Math.atan2(dy, dx);
      } else {
        c.x = t.x; c.y = t.y;
      }
      (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
    if (allArrived) this.arriveAtSideB(side);
  }

  /**
   * ③關卡間閃黑後:全隊從 A 下緣入口【自動走到中心環狀定位】(比照 autoWalkIntoB 走位演出);
   * 期間玩家不可操控;全員到位→levelEntering=false 恢復操控開打。
   */
  private updateLevelEnter(delta: number): void {
    const speed = 520; // 同進 B 的自動走位速度(演出約 1~2 秒)
    const step = speed * (delta / 1000);
    const cx = this.zoneA.centerX, cy = this.zoneA.centerY;
    const R = 74;
    const slotOf = (i: number) => { const ang = -Math.PI / 2 + i * (Math.PI / 2); return { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R }; };
    let allArrived = true;
    for (let i = 0; i < this.characters.length; i++) {
      const c = this.characters[i];
      if (!c.alive) continue;
      const t = slotOf(i); // 比照 autoWalkIntoB:全員(含P1)環繞中心 74px 4方位,【正中心留給任務目標】不站中心
      const dx = t.x - c.x, dy = t.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 4) {
        allArrived = false;
        const mv = Math.min(step, dist);
        c.x += (dx / dist) * mv;
        c.y += (dy / dist) * mv;
        c.setRotation(Math.atan2(dy, dx));
        c.aimAngle = Math.atan2(dy, dx);
      } else {
        c.x = t.x; c.y = t.y;
      }
      (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
    if (allArrived) {
      this.levelEntering = false; // 到位→恢復操控
      for (const c of this.characters) if (c.alive) c.aimAngle = -Math.PI / 2;
    }
  }

  /**
   * 新機制:玩家碰 A 左/右緣→鎖定該側(crossSide)、鏡頭 cam.pan 平移到該側 B 中心並定位好(帶過走廊)。
   * pan 期玩家凍結;pan 完:camera bounds 收成 slotB【固定不 follow】、crossPhase='enter'、角色自動環繞走進 B。
   */
  private startCameraPanToB(side: 'L' | 'R'): void {
    this.crossPhase = 'panning';
    this.crossSide = side; // 鎖定該側,不可反悔
    this.resetCharacterMotion(); // 觸發邊界時可能正在衝刺，先清掉避免自動走位與衝刺互搶
    this.closeTopExit(); // 問號關前若同時開了上方出口，選了左右就關掉
    this.progressPhase = 'playing';
    // 觸發鎖定→隱藏引導箭頭(進 panning 後不再顯示,非碰箭頭觸發)。
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
    this.clearCrossArrows();
    const zoneB = side === 'L' ? this.zoneBLeft : this.zoneBRight;
    const slotB = side === 'L' ? this.slotBLeft : this.slotBRight;
    const cam = this.cameras.main;
    const halfW = cam.width / 2, halfH = cam.height / 2;
    const cx = Phaser.Math.Clamp(zoneB.centerX, slotB.left + halfW, slotB.right - halfW);
    const cy = Phaser.Math.Clamp(zoneB.centerY, slotB.top + halfH, slotB.bottom - halfH);
    cam.stopFollow();
    cam.pan(cx, cy, GameConfig.stage.panMs, 'Sine.easeInOut', false, (_c, progress) => {
      if (progress >= 1) {
        cam.setBounds(slotB.x, slotB.y, slotB.width, slotB.height);
        this.crossPhase = 'enter';
        if (this.choiceHint) { this.choiceHint.destroy();
          this.choiceHint = this.add.text(zoneB.centerX, zoneB.top + 46, '前往下一區…', {
            fontFamily: 'monospace', fontSize: '24px', color: '#ffe98a'
          }).setOrigin(0.5).setDepth(21).setScrollFactor(1);
        }
      }
    });
  }

  /**
   * 階段1/2:角色自動走進該側 B 環狀→到站。
   * - crossingOpen=false、清兩側走廊、arena=該側 zoneB、physics bounds 收回只剩 zoneB(關門)。
   * - camera 固定停在 B 中心(不 follow 單角色)→交棒零位移。
   * - clearTreasure、placeStaticBreakables(side)、rollSubZoneContent 開打。
   */
  private arriveAtSideB(side: 'L' | 'R'): void {
    this.crossingOpen = false;
    this.crossSide = null;
    this.lastChoice = side;
    this.dirLock = side; // 走過這一側後只能繼續同方向，直到高階上方閃黑
    this.clearTreasure();
    this.bossCtl.onZoneLeave();
    // 保留走廊(不清 corridorGfx/L)→A↔B 銜接不變黑塊。
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    // 世界往該側延伸一格：抵達的區域成為新的中央（A），前方再生成下一個 slot、回收身後最遠的 slot
    this.recenterOn(side);
    const zoneB = this.zoneA;
    const slotB = this.slotA;
    this.currentSub = 'A';
    this.zoneB = zoneB;
    this.arena = zoneB;
    this.physics.world.setBounds(zoneB.x, zoneB.y, zoneB.width, zoneB.height);
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.setBounds(slotB.x, slotB.y, slotB.width, slotB.height);
    const halfW = cam.width / 2, halfH = cam.height / 2;
    cam.centerOn(
      Phaser.Math.Clamp(zoneB.centerX, slotB.left + halfW, slotB.right - halfW),
      Phaser.Math.Clamp(zoneB.centerY, slotB.top + halfH, slotB.bottom - halfH)
    );
    this.pendingCamSlot = null;
    this.resetCharacterMotion();
    this.enableFollow(slotB, true); // 每個區域都跟隨玩家（移動區比畫面寬）；維持到位時的鏡頭位置不跳
    this.clearAllBreakables();
    this.placeStaticBreakables(side);
    this.progressPhase = 'playing';
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    this.startStage();
    this.emitStats();
  }

  /**
   * 把 side 側的 slot 重新標記為中央（A）：
   * - 原中央變成反側鄰格（場景物件保留，畫面不變）
   * - 身後最遠的 slot 回收（場景物件銷毀、F4 背景圖搬到前方新 slot 重用）
   * - 前方新增一個 slot 並繪製場景（變體 = 新中央的另一種）
   * - 走廊：中央與身後鄰格之間那條保留為反側走廊，前方走廊下次開放時再畫
   *
   * @param side 抵達的方向（L = 往左延伸、R = 往右延伸）
   */
  private recenterOn(side: 'L' | 'R'): void {
    const step = (side === 'R' ? 1 : -1) * (this.slotA.width + GameConfig.stage.subGap);
    const behindSlot = side === 'R' ? this.slotBLeft : this.slotBRight;
    const aheadSlot = side === 'R' ? this.slotBRight : this.slotBLeft;
    const aheadZone = side === 'R' ? this.zoneBRight : this.zoneBLeft;
    // 回收身後最遠 slot 的場景物件
    const removed = new Set(this.slotLayers.get(behindSlot) ?? []);
    for (const o of removed) o.destroy();
    this.slotLayers.delete(behindSlot);
    this.sceneLayers = this.sceneLayers.filter((o) => !removed.has(o));
    // 新的前方 slot：以抵達的 slot 為基準再往前一格（slot 與 zone 同步）
    const newAheadSlot = Phaser.Geom.Rectangle.Clone(aheadSlot);
    const newAheadZone = Phaser.Geom.Rectangle.Clone(aheadZone);
    newAheadSlot.x += step;
    newAheadZone.x += step;
    // 走廊：原「中央 ↔ 抵達側」那條變成新中央的身後走廊；原身後走廊所在的 slot 已回收
    if (side === 'R') {
      if (this.corridorGfxL) this.corridorGfxL.destroy();
      this.corridorGfxL = this.corridorGfx;
      this.corridorGfx = null;
    } else {
      if (this.corridorGfx) this.corridorGfx.destroy();
      this.corridorGfx = this.corridorGfxL;
      this.corridorGfxL = null;
    }
    // 重新標記：身後 = 原中央、中央 = 原抵達側、前方 = 新 slot
    const oldSlotA = this.slotA, oldZoneA = this.zoneA;
    this.slotA = aheadSlot;
    this.zoneA = aheadZone;
    if (side === 'R') {
      this.slotBLeft = oldSlotA; this.zoneBLeft = oldZoneA;
      this.slotBRight = newAheadSlot; this.zoneBRight = newAheadZone;
    } else {
      this.slotBRight = oldSlotA; this.zoneBRight = oldZoneA;
      this.slotBLeft = newAheadSlot; this.zoneBLeft = newAheadZone;
    }
    // 新中央的變體 = 原側邊的變體（與原中央相反）；前方新 slot 再交替
    this.areaVariant = this.otherVariant(this.areaVariant);
    this.drawZoneScene(newAheadSlot, newAheadZone, this.currentLevel, this.otherVariant(this.areaVariant));
    // F4 背景圖：身後那張搬到前方新 slot
    this.artStyle.recycleBackground(side, newAheadSlot);
  }

  /** 另一種場景變體（荒城 ↔ 火山） */
  private otherVariant(v: 'A' | 'B'): 'A' | 'B' {
    return v === 'A' ? 'B' : 'A';
  }

  /**
   * 進B鏡頭跳一下修:進B後每幀檢查——等 camera 已【平滑捲進 slotB 允許的 scroll 範圍內】才把 bounds 收成 slotB。
   * 這樣收 bounds 的那刻 camera 已在合法範圍→setBounds 不會 clamp→不跳。收完清 pendingCamSlot。
   * 期間 physics bounds 早已收成 zoneB(關門),玩家走不回 A;只是「鏡頭 bounds」延後收,純視覺不影響玩法。
   * 保險:若玩家一直停在 slotB 邊緣導致遲遲不進範圍,超過 maxWaitMs 也強制收(此時多半差距已很小)。
   */
  private pendingCamShrinkSince = 0;
  private updatePendingCamShrink(): void {
    const slot = this.pendingCamSlot!;
    const cam = this.cameras.main;
    // slotB 允許的 camera scroll 範圍(camera 已在此範圍→收 bounds 不 clamp)
    const minX = slot.x, maxX = slot.right - cam.width;
    const minY = slot.y, maxY = slot.bottom - cam.height;
    const sx = cam.scrollX, sy = cam.scrollY;
    const inX = sx >= minX - 0.5 && sx <= Math.max(minX, maxX) + 0.5;
    const inY = sy >= minY - 0.5 && sy <= Math.max(minY, maxY) + 0.5;
    if (this.pendingCamShrinkSince === 0) this.pendingCamShrinkSince = this.time.now;
    const waited = this.time.now - this.pendingCamShrinkSince > 2000; // 保險上限
    if ((inX && inY) || waited) {
      cam.setBounds(slot.x, slot.y, slot.width, slot.height);
      this.pendingCamSlot = null;
      this.pendingCamShrinkSince = 0;
    }
  }

  /**
   * 清掉場上一般怪(不計分,清場給轉場用)。keepTreasure=true 時【保留寶箱怪與亂入 BOSS】
   * (波次完成/子區完成不清它們,只有真正換場地才清/離場)。
   */
  private clearAllEnemies(keepTreasure = false): void {
    const tr = this.treasureEnemy;
    const intruder = this.bossCtl.isIntruder ? this.bossCtl.current : null;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active) continue;
      if (keepTreasure && e === tr) continue; // 保留還在場的寶箱怪(玩家可繼續打/它自己 lifetime 跑走)
      if (keepTreasure && e === intruder) continue; // 亂入 BOSS 不擋通關:子區完成後仍可繼續打,換區或時間到才離場
      e.dead = true; e.disableBody(true, true);
    }
    if (!keepTreasure) { this.treasureEnemy = null; this.clearTreasureFx(); }
  }

  /** 真正換場地(子區平移/關卡閃黑)時清掉寶箱怪(別帶到下一場地)。 */
  private clearTreasure(): void {
    if (this.treasureEnemy && this.treasureEnemy.active) { this.treasureEnemy.dead = true; this.treasureEnemy.disableBody(true, true); }
    this.treasureEnemy = null;
    this.clearTreasureFx();
  }

  /**
   * ③ 進 crossing 過場那刻:場上寶箱怪【直接觸發逃走(淡出移除)】,不留到過場/不跟到 B。
   * 沿用限時逃走的演出(朝最近牆外衝+淡出),但立即觸發(不等 lifetime)。
   */
  private fleeTreasureNow(): void {
    const t = this.treasureEnemy;
    if (!t || !t.active || t.treasureFleeing) return;
    const cfg = GameConfig.enemy.treasure;
    t.telegraphing = false;
    t.treasureFleeing = true;
    const a = this.arena;
    const toLeft = t.x - a.left, toRight = a.right - t.x, toTop = t.y - a.top, toBottom = a.bottom - t.y;
    const m = Math.min(toLeft, toRight, toTop, toBottom);
    let fx = 0, fy = 0;
    if (m === toLeft) fx = -1; else if (m === toRight) fx = 1; else if (m === toTop) fy = -1; else fy = 1;
    const body = t.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(fx * cfg.moveSpeed * 1.6, fy * cfg.moveSpeed * 1.6);
    this.tweens.add({ targets: t, alpha: 0, duration: 500, onComplete: () => {
      if (this.treasureEnemy === t) this.treasureEnemy = null;
      this.clearTreasureFx();
      t.kill();
    }});
  }

  /** 清掉場上所有可破壞物件(切子區/轉場時用,避免上一子區的物件殘留)。 */
  private clearAllBreakables(): void {
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (bk.active) bk.despawn();
    }
  }

  /** 畫一個三角箭頭(dir=+1 右 / -1 左)。 */
  private drawArrow(g: Phaser.GameObjects.Graphics, x: number, y: number, dir: number, color: number): void {
    g.fillStyle(color, 0.9);
    const s = 34;
    g.beginPath();
    g.moveTo(x + dir * s, y);
    g.lineTo(x - dir * s, y - s);
    g.lineTo(x - dir * s, y + s);
    g.closePath();
    g.fillPath();
    g.lineStyle(4, 0xffffff, 0.8);
    g.strokeCircle(x, y, s + 14);
  }

  /**
   * 開上方出口：玩家走進 → 閃黑到新區域
   *
   * @param withHint 是否顯示「走進上方出口」提示文字（問號關前不顯示）
   */
  private showExit(withHint = true): void {
    if (this.exitGfx) this.exitGfx.destroy();
    const g = this.add.graphics().setDepth(20);
    const a = this.arena;
    const inset = GameConfig.stage.exitInset;
    const ey = a.top + inset;
    // 出口：上方發光門（高階寶箱 → 閃黑進新區域）
    g.fillStyle(0x7affc0, 0.85);
    g.fillRect(a.centerX - 60, ey - 16, 120, 32);
    g.lineStyle(4, 0xffffff, 0.8);
    g.strokeRect(a.centerX - 60, ey - 16, 120, 32);
    // 向上箭頭（門的下方，指向門）
    g.fillStyle(0x7affc0, 0.9);
    g.beginPath();
    g.moveTo(a.centerX, ey + 30);
    g.lineTo(a.centerX - 22, ey + 58);
    g.lineTo(a.centerX + 22, ey + 58);
    g.closePath();
    g.fillPath();
    this.exitGfx = g;
    if (!withHint) return;
    if (this.choiceHint) this.choiceHint.destroy();
    this.choiceHint = this.add.text(a.centerX, ey + 90, '走進上方出口前往新區域 ↑', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffe98a'
    }).setOrigin(0.5).setDepth(21);
  }

  /** choosing 階段每幀:偵測玩家走到左/右箭頭 → 記錄選邊 → 平移到 B。 */
  private updateChoosing(): void {
    const a = this.arena;
    const midY = a.centerY;
    const inset = GameConfig.stage.arrowInset;
    const dTrig = GameConfig.stage.triggerDist;
    const px = this.player.x, py = this.player.y;
    if (Phaser.Math.Distance.Between(px, py, a.left + inset, midY) <= dTrig) {
      this.lastChoice = 'L';
      this.startPanToB();
    } else if (Phaser.Math.Distance.Between(px, py, a.right - inset, midY) <= dTrig) {
      this.lastChoice = 'R';
      this.startPanToB();
    }
  }

  /** 開始平移到 B:依選邊決定 B 在左或右(方向對應直覺)。停跟隨→camera pan 跨 slot→到位切 currentArena=B→重啟跟隨→開打。 */
  private startPanToB(): void {
    this.progressPhase = 'panning';
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    // 選左→B 在 A 左側(鏡頭往左);選右→B 在 A 右側(鏡頭往右)。
    this.zoneB = this.lastChoice === 'L' ? this.zoneBLeft : this.zoneBRight;
    const slotB = this.lastChoice === 'L' ? this.slotBLeft : this.slotBRight;
    // 真正換場地(A→B 平移)→清掉 A 場上的寶箱怪(別帶到 B)
    this.clearTreasure();
    this.bossCtl.onZoneLeave();

    // ③ 順滑平移:先把玩家/物件放進 B、切 arena(遊戲凍結中,不影響畫面),
    //   再把 camera 從當前位置【一路 pan 到玩家在 B 的最終畫面位置】,pan 完才 enableFollow→無「先中央再彈回」。
    this.currentSub = 'B';
    this.arena = this.zoneB;
    this.physics.world.setBounds(this.zoneB.x, this.zoneB.y, this.zoneB.width, this.zoneB.height);
    // ⑥ 玩家從【B 進來那側的邊緣】進場(選左→從 B 右緣進、選右→從 B 左緣進),貼邊緣不閃到中途。
    const pr = GameConfig.player.radius;
    const edgeX = this.lastChoice === 'L' ? this.zoneB.right - pr - 6 : this.zoneB.left + pr + 6;
    const entryY = this.zoneB.centerY;
    let idx = 0;
    for (const c of this.characters) {
      if (!c.alive) continue;
      // P1 貼邊緣;BOT 略靠內一點點,仍在邊緣附近,不散到中間
      const inset = c === this.player ? 0 : (idx + 1) * 26;
      c.x = this.lastChoice === 'L' ? edgeX - inset : edgeX + inset;
      c.y = entryY + Phaser.Math.Between(-30, 30);
      idx++;
      (c.body as Phaser.Physics.Arcade.Body).reset(c.x, c.y);
    }
    this.clearAllBreakables();
    this.placeStaticBreakables(this.lastChoice);

    // 停跟隨、bounds 放大到整個世界(pan 能跨 slot)。
    this.disableFollow();
    // 目標 camera 中心 = 玩家位置,但 clamp 在 B slot 內(= follow 最終會停的位置)→pan 到這裡就不會彈。
    const cam = this.cameras.main;
    const halfW = cam.width / 2, halfH = cam.height / 2;
    const targetCX = Phaser.Math.Clamp(this.player.x, slotB.left + halfW, slotB.right - halfW);
    const targetCY = Phaser.Math.Clamp(this.player.y, slotB.top + halfH, slotB.bottom - halfH);
    cam.pan(targetCX, targetCY, GameConfig.stage.panMs, 'Sine.easeInOut', false, (_c, progress) => {
      if (progress >= 1) this.arriveAtB(slotB);
    });
  }

  /** 平移到位:重啟跟隨、隨機決定 B 內容(純波次 1-2 波 或 限時事件 塔/守護/佔領)。 */
  private arriveAtB(slotB: Phaser.Geom.Rectangle): void {
    // 重啟鏡頭跟隨到 B 的 slot(camera 已 pan 到玩家位置→startFollow 不會跳)
    this.enableFollow(slotB);
    this.progressPhase = 'playing';
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    this.startStage();
    this.emitStats();
  }

  /**
   * 開始目前小關卡（stageQueue[0]）：清敵關卡，擊殺數依寶箱階級；問號寶箱在此揭曉並顯示橫幅。
   * 小遊戲關卡尚未實作
   */
  private startStage(): void {
    const node = this.stageQueue[0];
    const wasMystery = node.kind === 'mystery' && !node.revealed;
    const chest = revealStageNode(node);
    if (wasMystery) this.showEventBanner(chest === 'high' ? '問號揭曉：高階寶箱！' : '問號揭曉：低階寶箱');
    if (wasMystery && chest === 'high' && Math.random() < GameConfig.stage.bossIntrude.chance) {
      // 等揭曉橫幅播完再登場，避免兩個橫幅疊在一起
      this.time.delayedCall(GameConfig.stage.bossIntrude.entryDelayMs, () => {
        if (this.gameOver || !this.stageInProgress || this.bossCtl.current) return;
        this.bossCtl.spawn(true);
      });
    }
    this.subWavesDone = 0;
    this.subWavesTarget = 1;
    this.waveQuota = GameConfig.stage.quotaByChest[chest];
    this.waveFormations = 0; // 首波隊形次數歸零（寶箱怪第 2 隊形起才可能出）
    this.waveState = 'spawning';
    this.stageInProgress = true;
  }

  /**
   * 小關卡完成：依寶箱階級直接發彩票給每位存活玩家（面板播報獎特效），關卡編號 +1（卷軸 HUD 隨之遞補）
   */
  private completeStage(): void {
    const chest = revealStageNode(this.stageQueue[0]);
    this.lastStageChest = chest;
    const tickets = GameConfig.stage.chestTickets[chest];
    for (const c of this.characters) {
      if (c.alive) this.grantStageReward(c, tickets);
    }
    this.currentStage++;
    // 佇列往前推一格，最右邊依規則生成新節點
    this.stageQueue.shift();
    this.stageQueue.push(nextStageNode(this.stageQueue));
    this.stageInProgress = false;
  }

  /**
   * 發放小關卡寶箱獎勵：彩票加到該角色 Credit，並在下方面板播放彩票特效
   *
   * @param c 獲得獎勵的角色
   * @param tickets 彩票張數
   */
  private grantStageReward(c: Character, tickets: number): void {
    c.credit += tickets;
    const uiScene = this.scene.get('UIScene') as any;
    // 彩票噴發數量隨張數變化：沿用 COMBO 報獎特效，以張數作為里程碑參數
    uiScene?.playComboRewardFx?.(c.index, tickets, tickets);
  }

  /** exiting 階段每幀:偵測玩家走進下方出口 → 閃黑轉場到下一關 A。 */
  private updateExiting(): void {
    const a = this.arena;
    const inset = GameConfig.stage.exitInset;
    const ey = a.top + inset;
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, a.centerX, ey) <= GameConfig.stage.triggerDist + 20) {
      this.startTransition();
    }
  }

  /** 閃黑轉場:fade out → 重置到 (level+1)-A(停跟隨、camera 拉回 A、清 B 物件、布置新場景) → fade in。 */
  private startTransition(): void {
    this.progressPhase = 'transition';
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
    this.closeTopExit();
    this.bossCtl.onZoneLeave();
    // 問號關前若左右也同時開放：選了上方就收掉左右轉場狀態
    this.crossingOpen = false;
    this.crossSide = null;
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    const cam = this.cameras.main;
    const fade = GameConfig.stage.fadeMs;
    this.disableFollow(); // 停跟隨,避免 fade 期間 camera 仍追玩家
    cam.fadeOut(fade, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.advanceToNextLevel();
      cam.fadeIn(fade, 0, 0, 0);
    });
  }

  /** 進到下一關(黑幕中執行):關卡+1;一般關→A 子區開打;BOSS 關(關4/關8)→純BOSS戰。 */
  private advanceToNextLevel(): void {
    // 清掉 B 的可破壞物件
    this.clearAllBreakables();
    this.clearAllEnemies();

    this.currentSub = 'A';
    this.arena = this.zoneA; // 拉回 A 子區(置中)
    // physics bounds = A 移動區
    this.physics.world.setBounds(this.zoneA.x, this.zoneA.y, this.zoneA.width, this.zoneA.height);
    // 新區域：場景變體交替（荒城 ↔ 火山）、左右方向限制解除；三格重繪（相鄰格為另一種變體）
    this.dirLock = null;
    this.areaVariant = this.otherVariant(this.areaVariant);
    this.drawAreaScenes();
    // ③玩家進下關【自動走到定位】演出:角色先放在 A【下緣入口】(=從上一關出口走進來的方向),
    //   然後 updateLevelEnter 程式驅動全隊走到 A 中心環狀定位,到位才恢復操控(不再閃黑完就瞬間定住)。
    const cx = this.zoneA.centerX;
    const entryY = this.zoneA.bottom - 40; // 下緣入口(對應出口在下方)
    for (const c of this.characters) {
      if (!c.alive) continue;
      const off = c === this.player ? 0 : Phaser.Math.Between(-70, 70);
      c.x = cx + off;
      c.y = entryY;
      c.aimAngle = -Math.PI / 2; // 面向場內(往上)
      (c.body as Phaser.Physics.Arcade.Body).reset(c.x, c.y);
    }
    // 重啟鏡頭跟隨到 A slot（角色被搬到新位置，清掉轉場前的衝刺狀態）
    this.resetCharacterMotion();
    this.enableFollow(this.slotA);
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    // 新關卡 A 子區靜態布置物件(隨機布置)——先布置物件再 roll(事件用當前 arena)
    this.placeStaticBreakables('L');
    this.startStage();
    // 啟動自動走位演出:progressPhase 保持 playing,但 levelEntering=true→update() 走 updateLevelEnter,
    //   全隊走到中心環狀定位、期間玩家輸入不生效(見 update 開頭 gate),到位恢復。
    this.levelEntering = true;
    this.progressPhase = 'playing';
    this.emitStats();
  }

  /** 靜態布置可破壞物件(木箱/桶),依選邊配置,座標為子區內比例。不進 spawn 循環=不重生。 */
  private placeStaticBreakables(choice: 'L' | 'R'): void {
    // 每區隨機布置:數量+位置隨機,不再每區都一樣。保留選邊基調(R 側多桶)。避開中心與邊緣、彼此不重疊。
    const cfg = GameConfig.stage.breakablesRandom;
    const a = this.arena;
    const minWH = Math.min(a.width, a.height);
    const placed: Array<{ x: number; y: number }> = [];
    const spacing = cfg.minSpacingR * minWH;
    const centerAvoid = cfg.centerAvoidR * minWH;
    const cx = a.centerX, cy = a.centerY;
    const pick = (): { x: number; y: number } | null => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = a.left + Phaser.Math.FloatBetween(cfg.marginX, 1 - cfg.marginX) * a.width;
        const y = a.top + Phaser.Math.FloatBetween(cfg.marginY, 1 - cfg.marginY) * a.height;
        if (Phaser.Math.Distance.Between(x, y, cx, cy) < centerAvoid) continue;      // 避開中心
        if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < 90) continue; // 避開玩家
        let ok = true;
        for (const p of placed) { if (Phaser.Math.Distance.Between(x, y, p.x, p.y) < spacing) { ok = false; break; } }
        if (ok) return { x, y };
      }
      return null;
    };
    const crateN = Phaser.Math.Between(cfg.crateMin, cfg.crateMax);
    // 基調:R 側桶上限 +barrelBiasExtra(某側多桶);L 側維持
    const barrelMax = cfg.barrelMax + (choice === 'R' ? cfg.barrelBiasExtra : 0);
    const barrelN = Phaser.Math.Between(cfg.barrelMin, barrelMax);
    for (let i = 0; i < crateN; i++) {
      const pt = pick(); if (!pt) break;
      placed.push(pt);
      const bk = this.breakables.get(pt.x, pt.y) as Breakable | null;
      if (bk) bk.spawnBreakable(pt.x, pt.y, 'crate');
    }
    for (let i = 0; i < barrelN; i++) {
      const pt = pick(); if (!pt) break;
      placed.push(pt);
      const bk = this.breakables.get(pt.x, pt.y) as Breakable | null;
      if (bk) bk.spawnBreakable(pt.x, pt.y, 'barrel');
    }
  }

  /** 關卡標題橫幅(短暫顯示)。 */
  private showLevelBanner(): void {
    if (this.levelBanner) this.levelBanner.destroy();
    // 固定畫面(setScrollFactor 0):不隨鏡頭跟隨捲動位移。
    this.levelBanner = this.add.text(GameConfig.width / 2, GameConfig.height * 0.36, `關卡 ${this.currentLevel} - ${this.currentSub}`, {
      fontFamily: 'monospace', fontSize: '40px', color: '#ffd23f', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: this.levelBanner, alpha: 1, duration: 250, yoyo: true, hold: 900,
      onComplete: () => { if (this.levelBanner) { this.levelBanner.destroy(); this.levelBanner = null; } } });
  }

  /** 寶箱怪出現提示橫幅(比照 showLevelBanner 風格,金色醒目,固定畫面短暫停留淡出)。 */
  private showTreasureBanner(): void {
    if (this.treasureBanner) { this.treasureBanner.destroy(); this.treasureBanner = null; }
    const cfg = GameConfig.enemy.treasure;
    const t = this.add.text(GameConfig.width / 2, GameConfig.height * 0.24, cfg.bannerText, {
      fontFamily: 'monospace', fontSize: '34px', color: '#ffe86a', stroke: '#000', strokeThickness: 5, fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(31).setAlpha(0).setScale(0.7);
    this.treasureBanner = t;
    // 彈入(scale+alpha)→停留 bannerHoldMs→淡出
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 260, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: cfg.bannerHoldMs, duration: 450,
      onComplete: () => { if (this.treasureBanner === t) this.treasureBanner = null; t.destroy(); } });
  }

  /**
   * I 鍵:切換遊戲內道具生成開關(即時生效)。關→額外清掉場上現有道具(直覺:「關道具」=場上馬上乾淨)。
   * 底層改 this.itemsEnabled(dropItemAt 讀它);config.items.spawnEnabled 只當初始預設。
   */
  private toggleItems(): void {
    this.itemsEnabled = !this.itemsEnabled;
    if (!this.itemsEnabled) this.clearAllItems(); // 關→清場上現有道具
    this.showItemToggleBanner(this.itemsEnabled);
    this.game.events.emit('items-state', this.itemsEnabled); // 同步 UIScene 觸控按鈕面(色/字)
  }

  /** 清掉場上所有現存道具(關道具開關時用)。 */
  private clearAllItems(): void {
    for (const child of this.items.getChildren()) {
      const item = child as Item;
      if (item.active) item.despawn();
    }
  }

  /** 道具開關切換提示橫幅:「道具:開 / 道具:關」。 */
  private showItemToggleBanner(on: boolean): void {
    if (this.itemToggleBanner) { this.itemToggleBanner.destroy(); this.itemToggleBanner = null; }
    const txt = on ? '道具:開' : '道具:關';
    const color = on ? '#7bed9f' : '#ff8b8b';
    const t = this.add.text(GameConfig.width / 2, GameConfig.height * 0.18, txt, {
      fontFamily: 'monospace', fontSize: '30px', color, stroke: '#000', strokeThickness: 5, fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(31).setAlpha(0).setScale(0.7);
    this.itemToggleBanner = t;
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 220, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 1100, duration: 400,
      onComplete: () => { if (this.itemToggleBanner === t) this.itemToggleBanner = null; t.destroy(); } });
  }

  /** 選邊箭頭/出口的脈動(alpha 呼吸)提示。 */
  private pulseChoice(time: number): void {
    const a = 0.6 + 0.4 * Math.abs(Math.sin(time / 300));
    if (this.choiceGfx) this.choiceGfx.setAlpha(a);
    if (this.exitGfx) this.exitGfx.setAlpha(a);
  }

  /** 除錯:切換預覽關卡場景(不動流程,只重繪當前子區三區地貌+遠景),給看 4 關對比。 */
  private debugPreviewLevel(level: number): void {
    this.currentLevel = Phaser.Math.Clamp(level, 1, GameConfig.stage.totalLevels);
    this.clearSceneLayers();
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, 'B');
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, 'A');
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, 'B');
    this.showLevelBanner();
  }

  // ========================= 第二階段:場景視覺(程式繪製) =========================

  /** 清掉所有場景繪製物件(重繪關卡時用)。 */
  private clearSceneLayers(): void {
    for (const o of this.sceneLayers) o.destroy();
    this.sceneLayers = [];
    this.slotLayers.clear();
    // 階段2:切關卡/重繪場景時一併清掉走廊底圖(左右),避免上一關殘留。
    if (this.corridorGfx) { this.corridorGfx.destroy(); this.corridorGfx = null; }
    if (this.corridorGfxL) { this.corridorGfxL.destroy(); this.corridorGfxL = null; }
  }

  /** 清掉並重繪目前三格場景：中央 = areaVariant，左右鄰格 = 另一種變體 */
  private drawAreaScenes(): void {
    this.clearSceneLayers();
    const side = this.otherVariant(this.areaVariant);
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, side);
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, this.areaVariant);
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, side);
  }

  /**
   * 方案e:啟用鏡頭跟隨玩家(限制在當前 slot 內、deadzone 緩衝)。playing 時用。
   *
   * @param slot 跟隨範圍（鏡頭 bounds）
   * @param keepScroll true = 維持目前鏡頭位置不跳（startFollow 預設會立即置中到玩家）；
   *   玩家在 deadzone 內時鏡頭不動，離開後才平滑跟上。轉場到位後使用，避免鏡頭「再動一下」
   */
  private enableFollow(slot: Phaser.Geom.Rectangle, keepScroll = false): void {
    const cam = this.cameras.main;
    const st = GameConfig.stage;
    const sx = cam.scrollX, sy = cam.scrollY;
    cam.setBounds(slot.x, slot.y, slot.width, slot.height); // 跟隨限制在當前 slot→不會露出隔壁子區
    // 📹 用戶要求：X/Y軸分別設定，Y軸跟隨更溫和
    cam.startFollow(this.player, true, st.followLerp, st.followLerpY);
    cam.setDeadzone(st.followDeadzoneW, st.followDeadzoneH);
    if (keepScroll) cam.setScroll(sx, sy);
  }

  /**
   * 清除所有角色殘留的移動狀態（衝刺中與速度）：轉場會直接搬動角色座標，
   * 若保留轉場前的衝刺終點，恢復操控時角色會自己衝回舊終點（例如往右平移後自動往左跑到邊界）
   */
  private resetCharacterMotion(): void {
    for (const c of this.characters) {
      if (c.isDashing) this.endDashState(c);
      else c.stopMoving();
    }
  }

  /** 停止鏡頭跟隨(切區平移/閃黑轉場前用),並把 bounds 放大到整個世界(讓 pan 能跨 slot)。 */
  private disableFollow(): void {
    const cam = this.cameras.main;
    cam.stopFollow();
    cam.setBounds(this.slotBLeft.x, this.slotA.y, this.slotBRight.right - this.slotBLeft.x, this.slotA.height);
  }

  /** 關卡制單一 slot 尺寸 = 移動區 + 左右/上下不可踏入邊距(見 GameConfig.stage) */
  private static stageSlotSize(): { width: number; height: number } {
    const st = GameConfig.stage;
    return {
      width: st.arenaW + st.sceneMarginX * 2,
      height: st.arenaH + st.sceneMarginTop + st.sceneMarginBottom
    };
  }

  /**
   * 繪製一個子區的場景（見 systems/zoneScenery），並登記到 sceneLayers 與該 slot 的 slotLayers，
   * 往左右延伸世界時可單獨回收這個 slot 的物件
   *
   * @param slot 子區所在的整格
   * @param zone 移動區
   * @param level 場景配色關卡
   * @param variant 子區變體
   */
  private drawZoneScene(slot: Phaser.Geom.Rectangle, zone: Phaser.Geom.Rectangle, level: number, variant: 'A' | 'B'): void {
    const objects = drawZoneScenery(this, slot, zone, level, variant);
    this.sceneLayers.push(...objects);
    this.slotLayers.set(slot, objects);
  }

  /**
   * 建立 BossController 需要的場景能力（只開放 BOSS 系統用得到的部分）
   */
  private createBossHost(): BossHost {
    return {
      scene: this,
      enemies: this.enemies,
      arena: () => this.arena,
      characters: () => this.characters,
      player: () => this.player,
      isGameOver: () => this.gameOver,
      isSlowMode: () => this.controlMode === 'slow',
      wireEnemyCallbacks: (e) => this.wireEnemyCallbacks(e),
      addTelegraph: (fx) => { this.telegraphFx.push(fx); },
      removeTelegraph: (fx) => this.removeTelegraphFx(fx),
      clearTelegraphsOf: (owner) => this.clearTelegraphsOf(owner),
      damageCharacter: (c, amount, fromX, fromY, rootMs) => this.damageCharacterFrom(c, amount, fromX, fromY, rootMs),
      damageEnemy: (actor, enemy, damage, knockback, time) => this.damageEnemy(actor, enemy, damage, knockback, time),
      triggerComboHit: (actor) => this.triggerComboHit(actor),
      dropItemAt: (x, y, time) => this.dropItemAt(x, y, time),
      spawnExpandingRing: (x, y, radius, color, ms) => this.spawnExpandingRing(x, y, radius, color, ms),
      shakeOnce: (duration, intensity) => this.shakeOnce(duration, intensity),
      spawnDeathBurst: (x, y) => this.spawnDeathBurst(x, y),
      showEventBanner: (text) => this.showEventBanner(text),
      emitStats: () => this.emitStats(),
      onWaveBossDefeated: () => this.onWaveBossDefeated()
    };
  }

  /** BOSS 召喚的小怪（不計 waveSpawned/quota） */
  private spawnSummonAt(x: number, y: number, time: number, forceType?: EnemyType, leashImmune = false, forceChase = false): void {
    const type = forceType ?? this.pickEnemyType();
    const enemy = this.enemies.get(x, y) as Enemy | null;
    if (!enemy) return;
    enemy.onAttackFire = this.onEnemyAttackFire;
    enemy.onShoot = this.onEnemyShoot;
    enemy.onLaserFire = this.onEnemyLaserFire;
    enemy.onBombThrow = this.onEnemyBombThrow;
    enemy.spawn(x, y, time, type);
    enemy.targetSeat = this.nearestSeat(x, y); // 黏著:召喚怪也綁最近角色(守護波 resolveEnemyTarget 會覆寫成 guardNpc)
    if (leashImmune) { enemy.leashRadius = Infinity; enemy.leashTravelDist = Infinity; } // 守護波怪免疫 leash(一直衝 NPC)
    if (forceChase) enemy.forceChase = true; // 守護波怪:無視 alertRadius 生成即直衝目標(NPC)
  }

  /** 波次 BOSS 被打倒（BossController 回呼）：決定通關、轉場或該波過關 */
  private onWaveBossDefeated(): void {
    // 第二輪:壓軸 BOSS(最終關 totalLevels=8)或無限循環的波次 BOSS 打倒 → 通關勝利畫面。
    if ((this.levelMode && this.isFinalLevel(this.currentLevel)) || this.isBossWave(this.currentWave)) {
      this.triggerClear();
      return;
    }
    // 關4 中場 BOSS 打完(非最終關)→【淡出→進下一關(關5 森林 A 子區)】,不通關不結束。
    if (this.levelMode && this.isBossLevel(this.currentLevel)) {
      this.startTransition(); // fade out → advanceToNextLevel(關5 森林) → fade in
      return;
    }
    // 該波過關
    this.enterIntermission();
  }

  /** 通關（打倒第 8 關壓軸 BOSS）——顯示通關結算畫面（可重開）。仿 triggerGameOver 但 won=true。 */
  private triggerClear(): void {
    this.gameOver = true;
    if (this.hitstopActive) {
      try { this.physics.world.resume(); } catch (_e) { /* ignore */ }
      this.hitstopActive = false;
    }
    for (const c of this.characters) c.stopMoving();
    const stats = {
      teamKills: this.teamKills(),
      perKills: this.characters.map((c) => c.kills),
      labels: GameConfig.characters.labels.slice(0, this.characters.length),
      survivalMs: this.survivalMs,
      p1AttackHits: this.p1AttackHits,
      won: true,
      controlMode: this.controlMode // 重開保留模式
    };
    this.scene.stop('UIScene');
    this.scene.launch('GameOverScene', stats);
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.stop();
  }

  // ===========================================================================
  // 事件系統（塔 / 守護 / 佔領）——仿 BOSS 波：清完小怪→啟動事件→完成才過關
  // ===========================================================================
  private startEvent(kind: 'tower' | 'guard' | 'capture'): void {
    this.eventKind = kind;
    const now = this.time.now;
    
    // 人數偵測與難度設定 - 在事件開始時鎖定難度，中途不再調整
    this.eventPlayerCount = this.getAliveCharacterCount();
    this.eventDifficultyMultiplier = this.calculateEventDifficultyMultiplier(this.eventPlayerCount);
    
    if (kind === 'tower') {
      const cfg = GameConfig.event.tower;
      // 塔血量根據人數調整
      const baseHpMult = 1 + (this.currentWave - 1) * cfg.hpGrowthPerWave;
      const adjustedHpMult = baseHpMult * this.eventDifficultyMultiplier;
      const tx = this.arena.centerX;
      const ty = this.arena.centerY;
      const t = this.enemies.get(tx, ty) as Enemy | null;
      if (t) {
        this.wireEnemyCallbacks(t);
        t.spawn(tx, ty, now, 'tower', adjustedHpMult);
        (t as unknown as { telegraphing: boolean }).telegraphing = false;
        (t.body as Phaser.Physics.Arcade.Body).enable = true;
        t.setAlpha(1);
        this.tower = t;
      }
      this.towerBeamGroup = 0;
    } else if (kind === 'guard') {
      const nx = this.arena.centerX;
      const ny = this.arena.centerY;
      const n = this.enemies.get(nx, ny) as Enemy | null;
      if (n) {
        this.wireEnemyCallbacks(n);
        n.spawn(nx, ny, now, 'npc', 1);
        (n as unknown as { telegraphing: boolean }).telegraphing = false;
        (n.body as Phaser.Physics.Arcade.Body).enable = true;
        n.setAlpha(1);
        n.setDepth(11); // 守護NPC depth 提到怪(depth5)之上→被怪群包圍時仍看得到,不被貼圖蓋住
        this.guardNpc = n;
        // 守護NPC高亮環(青色描邊,每幀跟隨),被包圍也一眼可辨
        if (this.guardHighlight) this.guardHighlight.destroy();
        this.guardHighlight = this.add.graphics().setDepth(10);
      }
    } else {
      this.captureCx = this.arena.centerX;
      this.captureCy = this.arena.centerY;
      this.captureProgress = 0;
      this.captureWaveActive = false;   // v39
      this.captureGfx = this.add.graphics().setDepth(3);
    }
    // 事件開場宣告序列:生目標後【先跑開場(雙段大字+滑出),不啟動事件計時/生怪】,序列結束才 beginEventCombat。
    this.startEventIntro(kind);
  }

  /**
   * 事件波開場宣告(階段1):雙段大字+右滑出+鎖操作 gate。
   * 第一段統一大字「限時事件來了!」→顯示→右滑出;第二段各事件訊息(聚焦stub計時)→顯示→右滑出;
   * 兩段完 finishEventIntro→beginEventCombat(啟動計時/生怪)。逾時保底 eventIntroHardEndsAt 防卡死。
   */
  private startEventIntro(kind: 'tower' | 'guard' | 'capture'): void {
    const cfg = GameConfig.event.intro;
    const now = this.time.now;
    this.pendingEventKind = kind;
    this.eventIntroActive = true;
    this.eventIntroHardEndsAt = now + cfg.maxIntroSec * 1000; // 逾時保底
    this.emitEventHud(); // 清 HUD(事件尚未真正開始)
    this.startEventIntroWalk(); // 階段3:先角色自動走到目標周圍→再大字/聚焦
  }

  /** 階段3:進 introMove 走位段——全隊自動走到目標(arena.center)周圍定位;到位/逾時→進統一大字。 */
  private startEventIntroWalk(): void {
    const cfg = GameConfig.event.intro;
    this.eventIntroStage = 'introMove';
    this.eventIntroSlideDone = false;
    this.eventIntroWalkEndsAt = this.time.now + cfg.maxWalkSec * 1000; // 走位逾時保底
  }

  /** 階段3每幀:全隊朝目標(arena.center)周圍環狀定位走(仿 updateLevelEnter);全到位 or 逾時→snap→進統一大字。 */
  private updateEventIntroWalk(delta: number): void {
    const cfg = GameConfig.event.intro;
    const speed = cfg.walkSpeed;
    const step = speed * (delta / 1000);
    const cx = this.arena.centerX, cy = this.arena.centerY; // 目標=事件目標物(生在 arena 中心)
    const R = cfg.walkRingPx;
    const slotOf = (i: number) => { const ang = -Math.PI / 2 + i * (Math.PI / 2); return { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R }; };
    const timedOut = this.time.now >= this.eventIntroWalkEndsAt;
    let allArrived = true;
    for (let i = 0; i < this.characters.length; i++) {
      const c = this.characters[i];
      if (!c.alive) continue;
      const t = slotOf(i); // 全員環繞目標 R,正中心留給目標物
      const dx = t.x - c.x, dy = t.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (timedOut) { c.x = t.x; c.y = t.y; c.aimAngle = Math.atan2(cy - c.y || -1, cx - c.x || 0); } // 逾時 snap 到位
      else if (dist > 4) {
        allArrived = false;
        const mv = Math.min(step, dist);
        c.x += (dx / dist) * mv; c.y += (dy / dist) * mv;
        c.setRotation(Math.atan2(dy, dx)); c.aimAngle = Math.atan2(dy, dx); // 走路面向移動方向
      } else { c.x = t.x; c.y = t.y; }
      (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
    if (allArrived || timedOut) {
      // 全員面向目標中心,進統一大字段
      for (const c of this.characters) if (c.alive) c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, cx, cy);
      this.startEventIntroStage('unified');
    }
  }

  /** 開始開場某一段:顯示對應大字,設本段「顯示滿」時間戳(到時觸發右滑出)。 */
  private startEventIntroStage(stage: 'unified' | 'perEvent'): void {
    const cfg = GameConfig.event.intro;
    const now = this.time.now;
    this.eventIntroStage = stage;
    this.eventIntroSlideDone = false;
    const holdSec = stage === 'unified' ? cfg.unifiedHoldSec : cfg.focusHoldSec;
    // 顯示滿 = 淡入 + hold(到時觸發滑出)
    this.eventIntroStageEndsAt = now + (cfg.fadeInSec + holdSec) * 1000;
    const text = stage === 'unified'
      ? cfg.unifiedText
      : ((cfg.perEventText as Record<string, string>)[this.pendingEventKind ?? 'tower'] ?? '');
    this.showEventIntroBanner(text);
    // 階段2:第二段=真聚焦——先 pan 鏡頭到目標置中,pan 完才開壓黑+開始 focus 計時(pan 期間不計時)。
    if (stage === 'perEvent') this.beginEventFocus();
  }

  /** 階段2:開始聚焦——camera pan 到目標物置中(複用 crossing 的 stopFollow+pan 手法),pan 完 onFocusPanComplete。 */
  private beginEventFocus(): void {
    const cfg = GameConfig.event.intro;
    const cam = this.cameras.main;
    // 目標世界座標=arena.center(三種事件目標都生在中心)
    const tx = this.arena.centerX, ty = this.arena.centerY;
    this.eventFocusPanning = true; // pan 期間 updateEventIntro 不推進 hold 計時
    cam.stopFollow();
    const halfW = cam.width / 2, halfH = cam.height / 2;
    // clamp 到當前 slot(避免 pan 出界露黑);用當前 arena 對應 slot
    const slot = this.currentSlotRect();
    const cx = Phaser.Math.Clamp(tx, slot.left + halfW, slot.right - halfW);
    const cy = Phaser.Math.Clamp(ty, slot.top + halfH, slot.bottom - halfH);
    cam.pan(cx, cy, cfg.panMs, 'Sine.easeInOut', false, (_c, progress) => {
      if (progress >= 1 && this.eventFocusPanning) this.onFocusPanComplete();
    });
  }

  /** 當前 arena 對應的 slot 矩形(pan clamp / follow 還原用)。 */
  private currentSlotRect(): Phaser.Geom.Rectangle {
    if (this.arena === this.zoneBLeft) return this.slotBLeft;
    if (this.arena === this.zoneBRight) return this.slotBRight;
    return this.slotA;
  }

  /** pan 完:開壓黑聚光 + 目標提 depth 露出 + 凍敵定格(eventFocusPause)+ 開始 focus hold 計時。 */
  private onFocusPanComplete(): void {
    const cfg = GameConfig.event.intro;
    this.eventFocusPanning = false;
    this.eventFocusPause = true; // 獨立凍敵定格旗標(非借 timeStopped);開場 gate 本已凍全場,此旗標語意明確+供事件邏輯查用
    // 目標物提 depth(高於遮罩)——三型別:tower/guard=Enemy、capture=captureGfx(Graphics)
    const target = this.getEventFocusTarget();
    this.eventFocusTarget = target;
    if (target) {
      this.eventFocusTargetDepth = (target as unknown as { depth: number }).depth ?? 0;
      target.setDepth(cfg.focusTargetDepth);
    }
    // 佔領事件:聚焦時【先把據點圈畫出來】(combat 才每幀畫,聚焦期間沒畫→只有空中心)。
    //   畫在 captureGfx(已提 depth972 露出遮罩之上),讓玩家在聚焦時就看到「要守的據點圈」,與聚光圈對齊。
    if (this.pendingEventKind === 'capture' && this.captureGfx) {
      const R = GameConfig.event.capture.captureRadius;
      this.captureGfx.clear();
      this.captureGfx.lineStyle(3, 0xffd166, 0.9);
      this.captureGfx.strokeCircle(this.captureCx, this.captureCy, R);
      this.captureGfx.fillStyle(0xffd166, 0.06);
      this.captureGfx.fillCircle(this.captureCx, this.captureCy, R);
    }
    // 壓黑遮罩(全螢幕黑,setScrollFactor0 釘螢幕)——depth 在目標之下、遊戲物件之上
    const dim = this.add.rectangle(GameConfig.width / 2, GameConfig.height / 2, GameConfig.width, GameConfig.height, 0x000000, 0)
      .setScrollFactor(0).setDepth(cfg.focusTargetDepth - 2);
    this.eventFocusDim = dim;
    this.tweens.add({ targets: dim, fillAlpha: cfg.dimAlpha, duration: cfg.dimFadeSec * 1000 });
    // 目標亮暈(暖光暈,ADD):目標已被 pan 置中→用螢幕中央座標,setScrollFactor0。
    // 佔領事件:聚光圈半徑依【實際據點圈半徑 captureRadius × 倍率】對齊玩家看到的據點(無鏡頭縮放→世界半徑=螢幕px);塔/守護維持固定 spotlightRadiusPx。
    const glowRadius = this.pendingEventKind === 'capture'
      ? GameConfig.event.capture.captureRadius * cfg.captureSpotlightMult
      : cfg.spotlightRadiusPx;
    const glow = this.add.circle(GameConfig.width / 2, GameConfig.height / 2, glowRadius, cfg.spotlightColor, 0)
      .setScrollFactor(0).setDepth(cfg.focusTargetDepth - 1).setBlendMode(Phaser.BlendModes.ADD);
    this.eventFocusGlow = glow;
    // 佔領大圈用較低 alpha(避免大範圍 ADD 洗掉壓黑),塔/守護小圈維持 spotlightAlpha。
    const glowAlpha = this.pendingEventKind === 'capture' ? cfg.captureSpotlightAlpha : cfg.spotlightAlpha;
    this.tweens.add({ targets: glow, fillAlpha: glowAlpha, duration: cfg.dimFadeSec * 1000 });
    // pan 完才開始 focus hold 計時(第二段顯示滿=淡入已完+hold)
    this.eventIntroStageEndsAt = this.time.now + cfg.focusHoldSec * 1000;
  }

  /** 取得當前事件的聚焦目標物(tower/guard=Enemy,capture=captureGfx)。 */
  private getEventFocusTarget(): Phaser.GameObjects.Components.Depth | null {
    if (this.pendingEventKind === 'tower') return this.tower as unknown as Phaser.GameObjects.Components.Depth;
    if (this.pendingEventKind === 'guard') return this.guardNpc as unknown as Phaser.GameObjects.Components.Depth;
    if (this.pendingEventKind === 'capture') return this.captureGfx as unknown as Phaser.GameObjects.Components.Depth;
    return null;
  }

  /** 聚焦結束:壓黑/亮暈 fadeOut、目標 depth 還原、eventFocusPause=false、鏡頭恢復 follow 當前 slot。 */
  private endEventFocus(): void {
    const cfg = GameConfig.event.intro;
    this.eventFocusPause = false;
    this.eventFocusPanning = false;
    // 目標 depth 還原
    if (this.eventFocusTarget) { this.eventFocusTarget.setDepth(this.eventFocusTargetDepth); this.eventFocusTarget = null; }
    // 壓黑/亮暈 fadeOut 後銷毀
    const dim = this.eventFocusDim; this.eventFocusDim = null;
    if (dim) this.tweens.add({ targets: dim, fillAlpha: 0, duration: cfg.dimFadeSec * 1000, onComplete: () => dim.destroy() });
    const glow = this.eventFocusGlow; this.eventFocusGlow = null;
    if (glow) this.tweens.add({ targets: glow, fillAlpha: 0, duration: cfg.dimFadeSec * 1000, onComplete: () => glow.destroy() });
    // 鏡頭恢復 follow 當前 slot
    this.enableFollow(this.currentSlotRect());
  }

  /** 開場大字:淡入(fadeInSec)→停在畫面(hold 由 stage 計時控制)→由 slideOutEventIntroBanner 觸發右滑出。 */
  private showEventIntroBanner(text: string): void {
    if (this.eventIntroBanner) { this.eventIntroBanner.destroy(); this.eventIntroBanner = null; }
    const cfg = GameConfig.event.intro;
    const t = this.add.text(GameConfig.width / 2, GameConfig.height * 0.3, text, {
      fontFamily: 'monospace', fontSize: '42px', color: '#ffd166', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(cfg.focusTargetDepth + 5).setAlpha(0); // depth 提到壓黑遮罩(focusTargetDepth-2)之上→聚焦時大字清晰不被壓黑
    this.eventIntroBanner = t;
    this.tweens.add({ targets: t, alpha: 1, duration: cfg.fadeInSec * 1000, ease: 'Quad.easeOut' });
  }

  /** 觸發當前段大字【向右滑出】(x 往右 + alpha 淡出);滑完不自動推進(由狀態機計時推進)。 */
  private slideOutEventIntroBanner(): void {
    const cfg = GameConfig.event.intro;
    const t = this.eventIntroBanner;
    if (!t) return;
    this.eventIntroBanner = null;
    this.tweens.add({
      targets: t, x: t.x + cfg.slideOutDistPx, alpha: 0,
      duration: cfg.slideOutSec * 1000, ease: 'Back.easeIn',
      onComplete: () => t.destroy()
    });
  }

  /** 開場每幀:推進雙段大字時序 + 逾時保底。gate 期間玩家鎖操作、事件不生怪。 */
  private updateEventIntro(time: number, delta: number): void {
    // 逾時保底:整段開場超時→強制結束解鎖(防卡死,最高風險)
    if (time >= this.eventIntroHardEndsAt) { this.finishEventIntro(); return; }
    // 階段3:introMove 走位段——全隊走到目標周圍(到位/逾時→進統一大字)
    if (this.eventIntroStage === 'introMove') { this.updateEventIntroWalk(delta); return; }
    // 階段2:pan 進行中→不推進 hold 計時(等 onFocusPanComplete 才開始 focus hold)
    if (this.eventFocusPanning) return;
    if (!this.eventIntroSlideDone && time >= this.eventIntroStageEndsAt) {
      // 本段顯示滿→觸發右滑出;perEvent 段同時結束聚焦(壓黑消/鏡頭回follow/目標depth還原)
      this.slideOutEventIntroBanner();
      if (this.eventIntroStage === 'perEvent') this.endEventFocus();
      this.eventIntroSlideDone = true;
      this.eventIntroStageEndsAt = time + GameConfig.event.intro.slideOutSec * 1000; // 複用:滑出結束時間
      return;
    }
    if (this.eventIntroSlideDone && time >= this.eventIntroStageEndsAt) {
      // 滑出完成→推進
      if (this.eventIntroStage === 'unified') {
        this.startEventIntroStage('perEvent'); // 第一段完→第二段各事件訊息(真聚焦)
      } else {
        this.finishEventIntro(); // 第二段完→開場結束,啟動事件
      }
    }
  }

  /** 開場結束:清狀態(一定執行,恢復操作)+ 啟動事件計時/生怪。 */
  private finishEventIntro(): void {
    this.eventIntroActive = false;
    this.eventIntroStage = 'done';
    this.eventIntroSlideDone = false;
    if (this.eventIntroBanner) { this.eventIntroBanner.destroy(); this.eventIntroBanner = null; }
    // 逾時保底:確保聚焦殘留(壓黑/亮暈/目標depth/凍敵/pan/follow)一定清乾淨,防卡死/畫面殘留黑幕。
    this.eventFocusPause = false;
    this.eventFocusPanning = false;
    if (this.eventFocusTarget) { this.eventFocusTarget.setDepth(this.eventFocusTargetDepth); this.eventFocusTarget = null; }
    if (this.eventFocusDim) { this.eventFocusDim.destroy(); this.eventFocusDim = null; }
    if (this.eventFocusGlow) { this.eventFocusGlow.destroy(); this.eventFocusGlow = null; }
    // 若聚焦被中途強制結束(仍在 pan/未 endFocus)→恢復鏡頭 follow 當前 slot
    this.enableFollow(this.currentSlotRect());
    const kind = this.pendingEventKind;
    this.pendingEventKind = null;
    if (kind) this.beginEventCombat(kind);
  }

  /** 開場宣告結束後才啟動:事件計時 + 首波生怪排程 + HUD(目標物此刻起才攻擊/生怪)。舊登場橫幅已移除(與新開場宣告重疊)。 */
  private beginEventCombat(kind: 'tower' | 'guard' | 'capture'): void {
    const now = this.time.now;
    if (kind === 'tower') {
      const cfg = GameConfig.event.tower;
      this.towerNextBlastAt = now + 800; // 首次光束延遲
      this.towerNextSpawnAt = now + 500;
      this.towerBeamGroup = 0;
      this.towerEndsAt = now + cfg.timeLimitMs; // 限時倒數:此時間到仍未打掉塔→失敗進下一波
    } else if (kind === 'guard') {
      const cfg = GameConfig.event.guard;
      this.guardEndsAt = now + cfg.durationMs; // 純時間制:撐滿 durationMs(60s)=守護成功(唯一成功時限)
      this.guardNextSpawnAt = now + 500;
      // 守護【混合制+循環】:guardWaveIdx 選波種,guardWaveActive 防誤判,guardGlobalWaveCount 遞增計數
      this.guardWaveIdx = 0;
      this.guardWaveActive = false;
      this.guardGlobalWaveCount = 0;
    } else {
      this.captureNextWaveAt = now + 600; // 首波稍後生
      this.captureEndsAt = now + GameConfig.event.capture.timeLimitMs; // 時限
    }
    // 用戶調整:開戰不再跳舊事件橫幅(塔事件/守護NPC/佔領據點)——與新開場宣告重疊。HUD/計時保留。
    this.emitEventHud();
  }

  /** 掛上敵人回呼（生成點共用） */
  private wireEnemyCallbacks(e: Enemy): void {
    e.onAttackFire = this.onEnemyAttackFire;
    e.onShoot = this.onEnemyShoot;
    e.onLaserFire = this.onEnemyLaserFire;
    e.onBombThrow = this.onEnemyBombThrow;
  }

  /** 事件登場提示（仿 BOSS 出現） */
  private showEventBanner(text: string): void {
    const txt = this.add
      .text(GameConfig.width / 2, GameConfig.height * 0.32, text, {
        fontFamily: 'monospace', fontSize: '40px', color: '#ffd166', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
      })
      .setOrigin(0.5).setScrollFactor(0).setDepth(60).setAlpha(0); // 固定畫面:鏡頭捲動時仍置中
    this.tweens.add({ targets: txt, alpha: 1, scale: { from: 0.6, to: 1.1 }, duration: 400, yoyo: true, hold: 900, onComplete: () => txt.destroy() });
    this.shakeOnce(180, 0.008);
  }

  /** 事件 HUD 更新（label/ratio/remainMs） */
  private emitEventHud(): void {
    if (this.eventKind === 'tower') {
      this.game.events.emit('event-hud', { active: true, label: '塔 HP', ratio: this.tower ? this.tower.hpRatio() : 0, remainMs: Math.max(0, this.towerEndsAt - this.time.now) });
    } else if (this.eventKind === 'guard') {
      // 純時間制:HUD 顯示【守護目標 + 剩餘倒數(UIScene 依 remainMs 補「Xs」後綴)】,不再顯示「第X/4波」(波次已循環)。
      this.game.events.emit('event-hud', { active: true, label: '守護目標', ratio: this.guardNpc ? this.guardNpc.hpRatio() : 0, remainMs: Math.max(0, this.guardEndsAt - this.time.now) });
    } else if (this.eventKind === 'capture') {
      this.game.events.emit('event-hud', { active: true, label: '佔領', ratio: this.captureProgress / 100, remainMs: Math.max(0, this.captureEndsAt - this.time.now) });
    } else {
      this.game.events.emit('event-hud', { active: false, label: '', ratio: 0, remainMs: 0 });
    }
  }

  /** 每幀事件更新（waveState==='event' 時由 update 呼叫） */
  private updateEvent(time: number): void {
    if (this.eventKind === 'tower') this.updateTowerEvent(time);
    else if (this.eventKind === 'guard') this.updateGuardEvent(time);
    else if (this.eventKind === 'capture') this.updateCaptureEvent(time);
    this.emitEventHud();
  }

  private updateTowerEvent(time: number): void {
    const cfg = GameConfig.event.tower;
    if (!this.tower || !this.tower.active || this.tower.dead) {
      return; // 塔被打掉的完成在 kill 路徑處理
    }
    // 限時到仍未打掉塔 → 失敗(比照其他事件結束):completeEvent(false) 撤塔/清扇形/停出怪/不給獎勵→進下一波。
    if (time >= this.towerEndsAt) {
      this.clearTelegraphsOf('tower'); // 清塔蓄力中的扇形預警 + 取消發射
      this.completeEvent(false);
      return;
    }
    // 塔事件持續出怪（無視波次配額，直到塔被打掉），根據人數調整生怪數量
    if (time >= this.towerNextSpawnAt) {
      this.towerNextSpawnAt = time + cfg.spawnIntervalMs;
      const adjustedSpawnBatch = Math.max(1, Math.round(cfg.spawnBatch * this.eventDifficultyMultiplier));
      for (let k = 0; k < adjustedSpawnBatch; k++) {
        const ang = Math.random() * Math.PI * 2;
        this.spawnSummonAt(
          Phaser.Math.Clamp(this.tower.x + Math.cos(ang) * 300, this.arena.left + 30, this.arena.right - 30),
          Phaser.Math.Clamp(this.tower.y + Math.sin(ang) * 300, this.arena.top + 30, this.arena.bottom - 30),
          time
        );
      }
    }
    // 每 cycleMs 發一組「4 大扇形」，正十字組(0/90/180/270)↔斜十字組(45/135/225/315)交替
    if (time >= this.towerNextBlastAt) {
      const fb = cfg.fanBlast;
      this.towerNextBlastAt = time + fb.cycleMs;
      const ox = this.tower.x;
      const oy = this.tower.y;
      // towerBeamGroup 0=正十字(baseAngle 0)、1=斜十字(baseAngle 45)
      const baseDeg = this.towerBeamGroup === 0 ? 0 : 45;
      this.towerBeamGroup = 1 - this.towerBeamGroup;
      const arc = Phaser.Math.DegToRad(fb.arcDeg);
      for (let i = 0; i < fb.count; i++) {
        const centerAng = Phaser.Math.DegToRad(baseDeg + i * 90);
        this.towerFanTelegraph(ox, oy, centerAng, arc, fb.radius, fb.fillMs, fb.damage);
      }
    }
  }

  /**
   * 塔的單個大扇形——以塔為圓心、中心角 centerAng、張角 arc、半徑 radius。
   * 先「填滿式預警」(半徑 0→radius 漸長 + 漸顯)，填滿瞬間發射並判定命中：
   * 角色距塔 ≤ radius(+玩家半徑) 且 角度落在 [centerAng ± arc/2] 內 → damageCharacterFrom(無敵可擋)。
   * 玩家站【兩扇形之間的縫隙】可閃；正十字↔斜十字交替剛好逼玩家換位。
   */
  private towerFanTelegraph(ox: number, oy: number, centerAng: number, arc: number, radius: number, fillMs: number, dmg: number): void {
    const g = this.add.graphics().setDepth(4);
    const half = arc / 2;
    const a0 = centerAng - half, a1 = centerAng + half;
    const drawFan = (gfx: Phaser.GameObjects.Graphics, r: number) => {
      gfx.beginPath();
      gfx.moveTo(ox, oy);
      gfx.arc(ox, oy, r, a0, a1, false);
      gfx.closePath();
    };
    // 登記此預警特效（供時停暫停 + 塔死亡強制清除）
    const fx: { owner: 'tower' | 'boss'; gfx: Phaser.GameObjects.Graphics; tween?: Phaser.Tweens.Tween; fired: boolean } =
      { owner: 'tower', gfx: g, fired: false };
    this.telegraphFx.push(fx);
    const p = { t: 0 };
    fx.tween = this.tweens.add({
      targets: p, t: 1, duration: fillMs,
      onUpdate: () => {
        g.clear();
        // 外框（完整扇形輪廓）
        g.lineStyle(2, 0xff5555, 0.5);
        drawFan(g, radius); g.strokePath();
        // 由塔往外填滿（半徑漸長）
        g.fillStyle(0xff5555, 0.30);
        drawFan(g, radius * p.t); g.fillPath();
      },
      onComplete: () => {
        fx.fired = true;
        this.removeTelegraphFx(fx);
        g.destroy();
        if (this.gameOver || !this.tower || !this.tower.active) return; // 塔已死 → 不發射
        // 發射視覺（亮扇形一閃）
        const blast = this.add.graphics().setDepth(20);
        blast.fillStyle(0xff3344, 0.5);
        blast.beginPath(); blast.moveTo(ox, oy); blast.arc(ox, oy, radius, a0, a1, false); blast.closePath(); blast.fillPath();
        this.tweens.add({ targets: blast, alpha: 0, duration: 260, onComplete: () => blast.destroy() });
        this.shakeOnce(90, 0.006);
        // 命中判定：角色距塔 ≤ radius 且 角度落扇形內
        for (const c of this.characters) {
          if (!c.alive) continue;
          const rx = c.x - ox, ry = c.y - oy;
          const dist = Math.hypot(rx, ry);
          if (dist > radius + GameConfig.player.radius) continue;
          const ang = Math.atan2(ry, rx);
          const diff = Math.abs(Phaser.Math.Angle.Wrap(ang - centerAng));
          if (diff <= half) {
            // 塔扇形命中 → 扣血 + 定身 2 秒
            this.damageCharacterFrom(c, dmg, ox, oy, GameConfig.event.tower.fanBlast.rootMs);
          }
        }
      }
    });
  }

  /** 從登記表移除一筆（不 destroy graphics，呼叫端自理） */
  private removeTelegraphFx(fx: { gfx: Phaser.GameObjects.Graphics }): void {
    const i = this.telegraphFx.findIndex((e) => e === fx);
    if (i >= 0) this.telegraphFx.splice(i, 1);
  }

  /**
   * owner(塔/BOSS)死亡 → 強制清除其所有【蓄力中未發射】的預警特效 + 取消發射。
   * 停掉 fill tween、destroy graphics、標記 fired(其 onComplete 若殘留執行也因 !tower/!boss 或已移除而不發)。
   */
  private clearTelegraphsOf(owner: 'tower' | 'boss'): void {
    for (const fx of this.telegraphFx) {
      if (fx.owner === owner && !fx.fired) {
        fx.fired = true;
        fx.tween?.remove();
        fx.gfx.destroy();
      }
    }
    this.telegraphFx = this.telegraphFx.filter((e) => e.owner !== owner);
  }

  private updateGuardEvent(time: number): void {
    const cfg = GameConfig.event.guard;
    if (!this.guardNpc || !this.guardNpc.active || this.guardNpc.dead) {
      // NPC 死亡 → 事件失敗（仍過關但無獎勵）
      this.completeEvent(false);
      return;
    }
    // 守護NPC高亮環——被怪群包圍也一眼可辨(NPC depth11在怪之上、環depth10、脈動閃爍)
    if (this.guardHighlight) {
      const npcRef = this.guardNpc;
      const hr = npcRef.getBodyRadius() + 10;
      const blink = Math.floor(time / 200) % 2 === 0;
      this.guardHighlight.clear();
      this.guardHighlight.lineStyle(3, 0x00e5ff, blink ? 0.95 : 0.55);
      this.guardHighlight.strokeCircle(npcRef.x, npcRef.y, hr);
      this.guardHighlight.lineStyle(2, 0xffffff, 0.5);
      this.guardHighlight.strokeCircle(npcRef.x, npcRef.y, hr + 4);
    }

    // 守護【混合制+循環】:「清空 OR 8秒」較早者出下一波;4波循環重複;每波數量線性遞增(C點)。
    //   guardWaveActive=true 代表當前波已生成(才啟動清空判定,防生成幀 countGuardWaveAlive==0 誤觸)。
    const waves = cfg.waves;
    if (!this.guardWaveActive && time >= this.guardNextSpawnAt) {
      // 出下一波
      this.spawnGuardWave(this.guardWaveIdx % waves.length, time);
      this.guardWaveIdx++;
      this.guardGlobalWaveCount++;
      this.guardWaveActive = true;
      this.guardNextSpawnAt = time + cfg.waveSpawnIntervalMs; // 8秒上限
    } else if (this.guardWaveActive) {
      // 清空 OR 8秒到 → 準備出下一波
      const allGone = this.countGuardWaveAlive() === 0;
      if (allGone || time >= this.guardNextSpawnAt) {
        this.guardWaveActive = false;
        // 若清空提前→立刻出(guardNextSpawnAt=now),否則已到 8 秒也馬上觸發上面的生波
        if (allGone) this.guardNextSpawnAt = time; // 立即觸發下波
      }
    }

    // 敵人接觸 NPC → NPC 扣血(邏輯不動)
    const npc = this.guardNpc;
    const contactR = npc.getBodyRadius() + cfg.contactRange;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e === npc || e.enemyType === 'tower' || e.enemyType === 'npc') continue;
      if (!e.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, npc.x, npc.y) <= contactR) {
        // v37fix(A)：每隻怪對 NPC 的接觸傷害有攻擊冷卻，不再每幀扣血（配合 npcHp 能撐時間）
        if (time < e.nextNpcHitAt) continue;
        e.nextNpcHitAt = time + cfg.npcAttackCooldownMs;
        const dead = npc.takeDamage(Math.max(1, Math.round(cfg.npcContactDamage)));
        this.flashEnemy(npc);
        if (dead) { npc.kill(); this.guardNpc = null; this.completeEvent(false); return; }
      }
    }
    // 純時間制:撐滿 durationMs(60s)→ 守護成功。
    if (time >= this.guardEndsAt) {
      this.completeEvent(true);
    }
  }

  /** 守護波:場上活躍的守護波怪數(排除 NPC/tower/anchor/treasure/BOSS);==0=清空可出下一波。 */
  private countGuardWaveAlive(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      if (!isRegularEnemy(e)) continue;
      n++;
    }
    return n;
  }

  /**
   * 守護波腳本:在【左右兩側】各生該波指定怪種(perSide 隻),y 在場內均分散開。守護波怪免疫 leash(一直衝 NPC)。
   */
  private spawnGuardWave(waveIdx: number, time: number): void {
    const cfg = GameConfig.event.guard;
    const wave = cfg.waves[waveIdx];
    if (!wave) return;
    const inset = GameConfig.spawn.edgeInset;
    const leftX = this.arena.left + cfg.sideMargin;
    const rightX = this.arena.right - cfg.sideMargin;
    const yTop = this.arena.top + inset;
    const yBot = this.arena.bottom - inset;
    
    // 改進的守護怪物遞增：每循環一輪(4波)後才+1/側，根據人數調整
    const cyclesDone = Math.floor((this.guardGlobalWaveCount - 1) / cfg.wavesPerCycle);
    const bonus = Math.max(0, cyclesDone) * cfg.waveCountStep;
    // 根據事件難度係數調整怪物數量
    const difficultyAdjustedBonus = Math.round(bonus * this.eventDifficultyMultiplier);
    
    for (const side of [leftX, rightX]) {
      // 該側總隻數 = 各怪種 clamp(基準 perSide + bonus, 1, waveCountCap) 相加
      const entries: string[] = [];
      for (const spec of wave) {
        const baseCount = Math.round(spec.perSide * this.eventDifficultyMultiplier);
        const n = Phaser.Math.Clamp(baseCount + difficultyAdjustedBonus, 1, cfg.waveCountCap);
        for (let i = 0; i < n; i++) entries.push(spec.type);
      }
      const n = entries.length;
      for (let i = 0; i < n; i++) {
        // y 均分散開(n 隻沿該側縱向鋪開,加點抖動避免完全重疊)
        const t = n > 1 ? i / (n - 1) : 0.5;
        const y = Phaser.Math.Clamp(yTop + (yBot - yTop) * t + Phaser.Math.Between(-20, 20), yTop, yBot);
        this.spawnSummonAt(side, y, time, entries[i] as EnemyType, true, true); // leashImmune=true, forceChase=true
      }
    }
  }

  private updateCaptureEvent(time: number): void {
    const cfg = GameConfig.event.capture;
    const cx = this.captureCx;
    const cy = this.captureCy;
    const R = cfg.captureRadius;

    // 圈內存活怪數
    let enemiesIn = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || !e.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, cx, cy) <= R) enemiesIn++;
    }

    // 一波一波出——【圈內存活怪==0】就出下一波（不管殺死或被推/擊退出圈外，圈外的不算）
    if (this.captureWaveActive) {
      if (enemiesIn === 0) {
        // 圈內已無怪 → 排程下一波
        this.captureWaveActive = false;
        this.captureNextWaveAt = time + cfg.waveGapMs;
      }
    } else if (time >= this.captureNextWaveAt) {
      // 生下一波：全部生在【佔領圈內】，根據事件難度係數調整數量
      const adjustedWaveSize = Math.max(1, Math.round(cfg.waveSize * this.eventDifficultyMultiplier));
      for (let i = 0; i < adjustedWaveSize; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * R * cfg.spawnInsideRatio; // 均勻分佈於圈內
        this.spawnSummonAt(
          Phaser.Math.Clamp(cx + Math.cos(a) * rr, this.arena.left + 30, this.arena.right - 30),
          Phaser.Math.Clamp(cy + Math.sin(a) * rr, this.arena.top + 30, this.arena.bottom - 30),
          time
        );
      }
      this.captureWaveActive = true;
    }

    // 玩家是否在圈內
    const p = this.player;
    const playerIn = p.alive && Phaser.Math.Distance.Between(p.x, p.y, cx, cy) <= R;
    // 圈內【無怪】且【玩家在圈內】→ 進度增加；有怪則停住
    if (playerIn && enemiesIn === 0) {
      this.captureProgress = Math.min(100, this.captureProgress + cfg.progressPerSec * (1 / 60));
    }
    // 畫佔領圈：綠=可推進(玩家在圈+無怪)、黃=玩家在圈但有怪、灰=玩家不在圈
    if (this.captureGfx) {
      this.captureGfx.clear();
      const col = (playerIn && enemiesIn === 0) ? 0x7bed9f : (playerIn ? 0xffd166 : 0x888888);
      this.captureGfx.lineStyle(3, col, 0.85);
      this.captureGfx.strokeCircle(cx, cy, R);
      this.captureGfx.fillStyle(col, 0.08);
      this.captureGfx.fillCircle(cx, cy, R);
    }
    if (this.captureProgress >= 100) {
      this.completeEvent(true);
      return;
    }
    // 時限到、進度未滿 → 失敗（過關無獎勵，比照守護失敗）
    if (time >= this.captureEndsAt) {
      this.completeEvent(false);
    }
  }

  /** 事件完成/失敗：清理 + (成功給獎勵) + 過關進下一波 */
  private completeEvent(success: boolean): void {
    const kind = this.eventKind;
    this.eventKind = null;
    // 清理事件物件
    if (this.tower) { if (this.tower.active) this.tower.kill(); this.tower = null; }
    if (this.guardNpc) { if (this.guardNpc.active) this.guardNpc.kill(); this.guardNpc = null; }
    if (this.guardHighlight) { this.guardHighlight.destroy(); this.guardHighlight = null; } // 清高亮環
    if (this.captureGfx) { this.captureGfx.destroy(); this.captureGfx = null; }
    this.captureProgress = 0;
    this.game.events.emit('event-hud', { active: false, label: '', ratio: 0, remainMs: 0 });
    // 成功給獎勵
    if (success) {
      const rw = GameConfig.event.rewards;
      const cx = this.arena.centerX;
      const cy = this.arena.centerY;
      for (let i = 0; i < rw.dropCount; i++) {
        const ang = (i / rw.dropCount) * Math.PI * 2;
        this.dropItemAt(cx + Math.cos(ang) * 60, cy + Math.sin(ang) * 60, this.time.now);
      }
      this.showEventBanner(`${kind === 'tower' ? '塔' : kind === 'guard' ? '守護' : '佔領'} 成功！獎勵發放`);
    } else {
      this.showEventBanner('事件失敗…');
    }
    // 關卡制:A/B 子區事件完成/時間到→接 onSubZoneComplete(A→出左右箭頭選邊、B→出上下出口);否則舊無限波次進 intermission。
    if (this.levelMode) {
      // 新增:事件結束時若【場上還有殘留一般怪】→不立刻收尾,留著給玩家打完(進 clearingResidual),
      //   停生新怪、事件目標/UI已收(上面清了),等殘留清完(countResidualEnemies=0)才真正進下一步。
      if (this.countResidualEnemies() > 0) {
        this.pendingEventComplete = true;
        this.waveState = 'clearing'; // 停生新怪、等清完;殘留怪留著可打
        this.emitStats();
        return;
      }
      this.onSubZoneComplete();
      return;
    }
    // 過關進下一波
    this.enterIntermission();
  }

  /** 事件後殘留怪清完的收尾(由 onWaveKill 在 pendingEventComplete 時偵測 countResidualEnemies=0 呼叫)。 */
  private finishPendingEventIfCleared(): void {
    if (!this.pendingEventComplete) return;
    if (this.countResidualEnemies() > 0) return; // 還有殘留怪→繼續給玩家打
    this.pendingEventComplete = false;
    this.onSubZoneComplete(); // 殘留清完→真正進下一步(選邊/轉場)
  }

  private clearWaveByCheat(): void {
    if (this.gameOver) return;
    // 事件進行中 → 直接完成事件（清理由 completeEvent 處理）
    if (this.waveState === 'event') {
      // 清掉場上小怪
      for (const child of this.enemies.getChildren()) {
        const e = child as Enemy;
        if (e.active && !e.dead && e.enemyType !== 'tower' && e.enemyType !== 'npc') {
          this.spawnDeathBurst(e.x, e.y);
          e.kill();
        }
      }
      this.completeEvent(true);
      return;
    }
    // 清除場上所有存活敵人（直接移除，不計殺、不給經驗、不掉落）——不含 treasure(波次清場不清寶箱怪)
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (e.active && !e.dead && e.enemyType !== 'treasure') {
        this.spawnDeathBurst(e.x, e.y);
        e.kill();
      }
    }
    // 若有 BOSS，一併清掉並收尾
    this.bossCtl.forgetBoss();
    // 強制完成當前波次
    if (this.waveState !== 'intermission') {
      // 關卡制:N 也要走【正常子區完成判定】(累計 subWavesDone→達 target 出箭頭/出口),不可繞過 onWaveKill。
      if (this.levelMode) {
        if (this.progressPhase !== 'playing') return; // choosing/exiting/panning/transition 中不處理
        this.waveSpawned = this.waveQuota;
        this.waveKilled = this.waveQuota - 1; // 讓 onWaveKill 這一擊剛好達標，走正常分支(累計子區波數)
        this.onWaveKill();
        return;
      }
      this.waveSpawned = this.waveQuota;
      this.waveKilled = this.waveQuota;
      this.enterIntermission();
    }
  }

  /**
   * M 鍵：清掉場上小怪，並「走正常過關判定」觸發當前波該有的事件/BOSS。
   * - spawning/clearing：清小怪 → waveKilled 補到 quota → 依 onWaveKill 達標邏輯：
   *   BOSS 波召喚 BOSS、事件波 startEvent、否則 enterIntermission。
   * - event/boss 進行中：等同 N，直接完成（避免卡）。
   */
  private clearWaveAndTrigger(): void {
    if (this.gameOver) return;
    // 事件/BOSS 進行中 → 直接完成（沿用 N 的收尾）
    if (this.waveState === 'event' || this.waveState === 'boss') {
      this.clearWaveByCheat();
      return;
    }
    if (this.waveState === 'intermission') return; // 間隙不處理
    // 清掉場上小怪（不含 tower/npc；不含 treasure 寶箱怪——波次完成不清寶箱怪,同真實遊玩)
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (e.active && !e.dead && e.enemyType !== 'tower' && e.enemyType !== 'npc' && e.enemyType !== 'treasure') {
        this.spawnDeathBurst(e.x, e.y);
        e.kill();
      }
    }
    // 走正常過關判定：把本波打到達標，觸發事件/BOSS/intermission
    this.waveSpawned = this.waveQuota;
    this.waveKilled = this.waveQuota - 1; // 讓 onWaveKill 這一擊剛好達標，走正常分支
    this.onWaveKill();
  }

  /** 過關提示（Wave N Clear / 下一波） */
  private showWaveClear(): void {
    // ⑤ 同子區還有下一波→顯示簡潔「NEXT WAVE」。固定畫面(setScrollFactor 0)不隨鏡頭跟隨捲動位移。
    const cx = GameConfig.width / 2;
    const cy = GameConfig.height * 0.4;
    const txt = this.add
      .text(cx, cy, 'NEXT WAVE', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffe66d',
        stroke: '#000000',
        strokeThickness: 6,
        align: 'center',
        fontStyle: 'bold'
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(60)
      .setAlpha(0);
    this.tweens.add({
      targets: txt,
      alpha: 1,
      scale: { from: 0.7, to: 1 },
      duration: 300,
      yoyo: true,
      hold: GameConfig.wave.intermissionMs - 700,
      onComplete: () => txt.destroy()
    });
  }

  private spawnFormation(): void {
    const time = this.time.now;
    this.waveFormations++; // 本波隊形計數(第1次=首次生怪,寶箱不出;第2次起才可能 roll)
    // 階段2b 分配制:每次補生決定生【近身組(綁旁邊玩家、近戰環形)】或【場上組(散佈、含遠程)】,
    //   讓本波比例收斂到 nearShare。目前近身占比 < nearShare → 生近身;否則生場上。
    const alloc = GameConfig.spawnAlloc;
    const totalSoFar = this.nearSpawned + this.fieldSpawned;
    const nearRatio = totalSoFar > 0 ? this.nearSpawned / totalSoFar : 0;
    const wantNear = nearRatio < alloc.nearShare;
    if (wantNear) this.spawnNearBatch(time);
    else this.spawnFieldBatch(time);
    this.trySpawnTreasure(time); // 每次波次生怪→roll 寶箱怪(場上只1隻)
  }

  /**
   * 階段2b 近身組:在【輪派的存活玩家】身旁 nearRingRadius 環形生 nearPerPlayer(3~5)隻【近戰為主】,
   * 綁定該玩家 seat(接階段1黏著)。多人→輪派游標平均分配每個 seat;solo→都在 P1 旁。
   * 每隻仍走 spawnBlocked 精準封頂(不超 target/maxAlive)。
   */
  private spawnNearBatch(time: number): void {
    const alloc = GameConfig.spawnAlloc;
    // 存活座位
    const seats: number[] = [];
    for (let i = 0; i < this.characters.length; i++) if (this.characters[i]?.alive) seats.push(i);
    if (seats.length === 0) return;
    // 輪派下一個座位(多人平均分)
    const seat = seats[this.nearSeatCursor % seats.length];
    this.nearSeatCursor++;
    const focus = this.characters[seat];
    const n = Phaser.Math.Between(alloc.nearPerPlayerMin, alloc.nearPerPlayerMax);
    const start = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      if (this.spawnBlocked()) return;
      const a = start + (i / n) * Math.PI * 2;
      const x = focus.x + Math.cos(a) * alloc.nearRingRadius;
      const y = focus.y + Math.sin(a) * alloc.nearRingRadius;
      this.spawnEnemyAt(x, y, time, alloc.nearTypes as EnemyType[], seat);
      this.nearSpawned++;
    }
  }

  /**
   * 階段2b/3 場上組:在【離所有玩家 fieldMinDistFromPlayer 遠】的點散佈一叢、【含遠程】(全池),綁就近角色。
   * 階段3:出生點加大離玩家距離→場上組生更遠、待命(配合縮小的 alertRadius),不一出生就在旁。
   */
  private spawnFieldBatch(time: number): void {
    const cfg = GameConfig.formation.scatter;
    const alloc = GameConfig.spawnAlloc;
    const raw = Phaser.Math.Between(cfg.minCount, cfg.maxCount);
    const count = Math.max(3, Math.round(raw * this.curAliveScale()));
    const { x: cx, y: cy } = this.randomFieldPoint(alloc.fieldMinDistFromPlayer);
    const pool = alloc.fieldTypes.length > 0 ? (alloc.fieldTypes as EnemyType[]) : undefined; // undefined=全池
    for (let i = 0; i < count; i++) {
      if (this.spawnBlocked()) return;
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.random() * cfg.areaRadius;
      const ex = Phaser.Math.Clamp(cx + Math.cos(ang) * rad, this.arena.left + 20, this.arena.right - 20);
      const ey = Phaser.Math.Clamp(cy + Math.sin(ang) * rad, this.arena.top + 20, this.arena.bottom - 20);
      this.spawnEnemyAt(ex, ey, time, pool, -1); // seat -1 → 生成點就近綁
      this.fieldSpawned++;
    }
  }

  /** 階段3:找一個離【所有存活玩家】至少 minDist 的隨機場內點(場上組遠處出生用);找不到退回最遠嘗試點。 */
  private randomFieldPoint(minDist: number): { x: number; y: number } {
    const inset = GameConfig.spawn.edgeInset + 40;
    let bx = this.arena.centerX, by = this.arena.centerY, bestMin = -1;
    for (let attempt = 0; attempt < 16; attempt++) {
      const x = Phaser.Math.Between(this.arena.left + inset, this.arena.right - inset);
      const y = Phaser.Math.Between(this.arena.top + inset, this.arena.bottom - inset);
      let nearest = Infinity;
      for (const c of this.characters) {
        if (!c.alive) continue;
        nearest = Math.min(nearest, Phaser.Math.Distance.Between(x, y, c.x, c.y));
      }
      if (nearest >= minDist) return { x, y };       // 夠遠→直接用
      if (nearest > bestMin) { bestMin = nearest; bx = x; by = y; } // 記最遠的備援(小場地放不下 minDist 時)
    }
    return { x: bx, y: by };
  }

  /** 寶箱怪:每次波次生怪時 roll 機率出現;場上已有一隻則不再生。生在場內隨機點、避開角色。 */
  private trySpawnTreasure(time: number): void {
    // ② 限時事件(塔/守護/佔領)期間【不生寶箱怪】
    if (this.eventKind !== null || this.waveState === 'event') return;
    if (this.treasureEnemy && this.treasureEnemy.active && !this.treasureEnemy.dead) return; // 只1隻
    // ④ 不在波次【首次生怪】那刻出現。修:用【本波隊形次數】為主判準——
    //   waveFormations<=1(=第一次隊形,即首次生怪)一律不出;第2次隊形起、且已生成 ~35% 配額後才可能 roll。
    //   (舊版只用 waveSpawned<quota×0.35,但首次隊形本身若已≥35%配額就漏擋→1A 開頭仍出寶箱。)
    if (this.waveFormations <= 1) return;
    const quota = Math.max(1, this.waveQuota);
    const midFraction = 0.35; // 波次進行到 ~35% 後才可能 roll 寶箱(避開首次生怪)
    if (this.waveSpawned < quota * midFraction) return;
    this.treasureEnemy = null;
    const cfg = GameConfig.enemy.treasure;
    if (Math.random() >= cfg.spawnChance) return;
    const a = this.arena, r = GameConfig.enemy.types.treasure.radius;
    let x = a.centerX, y = a.centerY;
    for (let attempt = 0; attempt < 20; attempt++) {
      x = Phaser.Math.Between(a.left + r + 20, a.right - r - 20);
      y = Phaser.Math.Between(a.top + r + 20, a.bottom - r - 20);
      // 避開玩家出生點/太近玩家
      if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) > 120) break;
    }
    const t = this.enemies.get(x, y) as Enemy | null;
    if (!t) return;
    t.spawn(x, y, time, 'treasure', 1);
    this.treasureEnemy = t;
    this.showTreasureBanner(); // 寶箱怪出現→顯示提示橫幅(玩家注意去追打)
    // ③ 金光加強:發光 halo 圈(depth 稍低於怪)+ 金色粒子環繞(醒目吸睛)
    this.clearTreasureFx();
    this.treasureGlow = this.add.graphics().setDepth((t.depth || 5) - 1);
    this.treasureEmitter = this.add.particles(x, y, 'spark', {
      speed: { min: 10, max: 30 }, angle: { min: 0, max: 360 },
      lifespan: 900, scale: { start: 0.55, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffe86a, 0xffd23f, 0xffb020], frequency: 90, quantity: 1, blendMode: 'ADD',
      emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, 30), quantity: 12 } as any
    }).setDepth((t.depth || 5) + 1);
    this.treasureEmitter.startFollow(t);
  }

  /** 清掉寶箱怪金光特效(移除/死亡時)。 */
  private clearTreasureFx(): void {
    if (this.treasureGlow) { this.treasureGlow.destroy(); this.treasureGlow = null; }
    if (this.treasureEmitter) { this.treasureEmitter.destroy(); this.treasureEmitter = null; }
  }

  /** 寶箱怪每幀:金光閃爍 + 跑點移動(快速衝到隨機點→停頓→再衝) + 限時10秒未打死→跑走消失。 */
  private updateTreasure(time: number): void {
    const t = this.treasureEnemy;
    if (!t || !t.active || t.dead) { this.treasureEnemy = null; this.clearTreasureFx(); return; }
    const cfg = GameConfig.enemy.treasure;
    const body = t.body as Phaser.Physics.Arcade.Body;
    // ③ 金光 halo:脈動發光圈跟著寶箱怪(醒目)
    if (this.treasureGlow) {
      const g = this.treasureGlow;
      g.clear();
      const rp = 26 + 8 * Math.abs(Math.sin(time / 220));
      g.fillStyle(0xffd23f, 0.12); g.fillCircle(t.x, t.y, rp + 14);
      g.fillStyle(0xffe86a, 0.18); g.fillCircle(t.x, t.y, rp);
      g.lineStyle(3, 0xffe86a, 0.5 + 0.3 * Math.abs(Math.sin(time / 220))); g.strokeCircle(t.x, t.y, rp + 6);
    }
    // ④ 時間暫停中:寶箱怪也凍結(停速度、不跑跑點/限時邏輯)——與其他怪一致。時間戳在解除時整批後移(見 update)。
    if (this.timeStopped) { body.setVelocity(0, 0); return; }
    // 金光閃爍(每幀微調 tint 亮度,醒目)
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time / 140));
    t.setTint(Phaser.Display.Color.GetColor(255, Math.round(210 * pulse) + 45, Math.round(63 * pulse)));

    // telegraph 中(出場提示)不動、不計限時起點由 treasureSpawnAt(spawn 時設)
    if (t.telegraphing) { body.setVelocity(0, 0); return; }

    // 限時:出現滿 lifetimeMs 未打死→跑走(淡出移除)
    if (!t.treasureFleeing && time - t.treasureSpawnAt >= cfg.lifetimeMs) {
      t.treasureFleeing = true;
      // 朝最近牆外方向衝走 + 淡出
      const a = this.arena;
      const toLeft = t.x - a.left, toRight = a.right - t.x, toTop = t.y - a.top, toBottom = a.bottom - t.y;
      const m = Math.min(toLeft, toRight, toTop, toBottom);
      let fx = 0, fy = 0;
      if (m === toLeft) fx = -1; else if (m === toRight) fx = 1; else if (m === toTop) fy = -1; else fy = 1;
      body.setVelocity(fx * cfg.moveSpeed * 1.4, fy * cfg.moveSpeed * 1.4);
      this.tweens.add({ targets: t, alpha: 0, duration: 700, onComplete: () => {
        if (this.treasureEnemy === t) this.treasureEnemy = null;
        this.clearTreasureFx();
        t.kill();
      }});
      return;
    }
    if (t.treasureFleeing) return; // 跑走中維持速度直到淡出移除

    // 跑點移動:停頓中→靜止;停頓結束→挑新隨機點快速衝過去;到點→進入停頓。
    if (time < t.treasurePauseUntil) {
      body.setVelocity(0, 0); // 停頓靜止(玩家追打空檔)
      return;
    }
    const arrived = Phaser.Math.Distance.Between(t.x, t.y, t.treasureMoveTX, t.treasureMoveTY) <= 16;
    const idle = body.velocity.x === 0 && body.velocity.y === 0;
    if (arrived || idle) {
      if (arrived && t.treasurePauseUntil === 0 && !idle) {
        // 剛衝到點→排停頓(玩家可趁機追打)
        t.treasurePauseUntil = time + Phaser.Math.Between(cfg.pauseMinMs, cfg.pauseMaxMs);
        body.setVelocity(0, 0);
        return;
      }
      // 停頓完 或 靜止待命→挑新點快速衝
      const a = this.arena, r = GameConfig.enemy.types.treasure.radius;
      t.treasureMoveTX = Phaser.Math.Between(a.left + r + 20, a.right - r - 20);
      t.treasureMoveTY = Phaser.Math.Between(a.top + r + 20, a.bottom - r - 20);
      t.treasurePauseUntil = 0;
      const ang = Phaser.Math.Angle.Between(t.x, t.y, t.treasureMoveTX, t.treasureMoveTY);
      body.setVelocity(Math.cos(ang) * cfg.moveSpeed, Math.sin(ang) * cfg.moveSpeed);
      return;
    }
    // 衝刺途中:持續朝目標點(修正方向,避免 overshoot 亂飄)
    const ang = Phaser.Math.Angle.Between(t.x, t.y, t.treasureMoveTX, t.treasureMoveTY);
    body.setVelocity(Math.cos(ang) * cfg.moveSpeed, Math.sin(ang) * cfg.moveSpeed);
  }

  /** 命中寶箱怪:計 1 下 + 噴少量金幣;達 hitsToKill 死亡→噴大量金幣。回傳 true=已處理(呼叫端不走一般扣血)。 */
  private hitTreasure(enemy: Enemy): boolean {
    if (enemy.enemyType !== 'treasure' || enemy.dead || !enemy.active) return false;
    if (enemy.treasureFleeing) { enemy.kill(); if (this.treasureEnemy === enemy) this.treasureEnemy = null; return true; } // 跑走中被打到→直接消(算打到)
    const cfg = GameConfig.enemy.treasure;
    enemy.treasureHits++;
    this.flashEnemy(enemy);
    this.spawnCoins(enemy.x, enemy.y, cfg.coinsPerHit, false); // 每下少量金幣
    this.spawnDamageText(enemy.x, enemy.y - 10, cfg.hitsToKill - enemy.treasureHits); // 顯示剩餘命中數
    if (enemy.treasureHits >= cfg.hitsToKill) {
      const dx = enemy.x, dy = enemy.y;
      enemy.kill();
      if (this.treasureEnemy === enemy) this.treasureEnemy = null;
      this.clearTreasureFx(); // ③ 死亡清金光特效
      this.spawnCoins(dx, dy, cfg.coinsOnDeath, true); // 死亡大量金幣(華麗)
      this.spawnExpandingRing(dx, dy, 100, 0xffd700, 450);
      this.shakeOnce(120, 0.006);
    }
    return true;
  }

  /** 金幣噴散特效(純視覺,不進道具/分數):金幣往上飛+散開+落下淡出。big=死亡大量。 */
  private spawnCoins(x: number, y: number, count: number, big: boolean): void {
    for (let i = 0; i < count; i++) {
      const coin = this.add.image(x, y, 'coin').setDepth(21);
      const ang = -Math.PI / 2 + Phaser.Math.FloatBetween(-1, 1) * (big ? 1.2 : 0.7);
      const spd = big ? Phaser.Math.Between(120, 300) : Phaser.Math.Between(60, 150);
      const vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd;
      const dur = big ? Phaser.Math.Between(600, 1000) : Phaser.Math.Between(400, 650);
      const tx = x + vx * (dur / 1000);
      const ty = y + vy * (dur / 1000) + (big ? 120 : 70); // 拋物線:先上後落
      this.tweens.add({
        targets: coin, x: tx, y: ty, alpha: { from: 1, to: 0 },
        angle: Phaser.Math.Between(-180, 180), scale: { from: big ? 1.2 : 0.9, to: 0.4 },
        duration: dur, ease: 'Quad.easeOut', onComplete: () => coin.destroy()
      });
    }
  }

  /**
   * 階段2b:生成一隻怪。pool=限定敵種池(undefined=全池,pickEnemyType 預設);
   * assignSeat>=0→綁定該座位(近身組綁旁邊玩家);-1→生成點就近綁(場上組)。BOSS 一律綁 P1。
   */
  private spawnEnemyAt(x: number, y: number, time: number, pool?: EnemyType[], assignSeat = -1): void {
    const type = this.pickEnemyType(pool);
    const inset = GameConfig.spawn.edgeInset;
    const r = GameConfig.enemy.types[type].radius;
    const cx = Phaser.Math.Clamp(x, this.arena.left + inset + r, this.arena.right - inset - r);
    const cy = Phaser.Math.Clamp(y, this.arena.top + inset + r, this.arena.bottom - inset - r);
    const enemy = this.enemies.get(cx, cy) as Enemy | null;
    if (!enemy) return;
    enemy.onAttackFire = this.onEnemyAttackFire;
    enemy.onShoot = this.onEnemyShoot;
    enemy.onLaserFire = this.onEnemyLaserFire;
    enemy.onBombThrow = this.onEnemyBombThrow;
    enemy.spawn(cx, cy, time, type);
    // 黏著目標(階段1):BOSS 綁 P1(seat0);近身組綁指定 seat;其餘生成點就近綁。之後黏著不亂換。
    enemy.targetSeat = enemy.isBoss ? 0 : (assignSeat >= 0 ? assignSeat : this.nearestSeat(cx, cy));
    enemy.stickyOutOfRangeSince = 0;
    // leash 拴繩:場上組(assignSeat<0)套 config fieldLeashRadius;近身組(assignSeat>=0)用大值≈不套用(貼玩家);BOSS/塔不追不套用。
    enemy.leashRadius = (enemy.isBoss || type === 'tower')
      ? Infinity
      : (assignSeat >= 0 ? GameConfig.spawnAlloc.nearLeashRadius : GameConfig.spawnAlloc.fieldLeashRadius);
    // leash 第二條(累積路程):同上分派——場上組=config、近身組=大值、BOSS/塔=Infinity。
    enemy.leashTravelDist = (enemy.isBoss || type === 'tower')
      ? Infinity
      : (assignSeat >= 0 ? GameConfig.spawnAlloc.nearLeashTravelDist : GameConfig.spawnAlloc.fieldLeashTravelDist);
    // 計入本波已生成數
    this.waveSpawned++;
  }

  /**
   * 階段2a:每隻怪生成前的封頂檢查(precise per-enemy,formation 大小不影響)。
   * ① 場上(含 telegraph pending)已達 maxAlive → 阻。
   * ② 生產總量(progress + alive + pending)已達 targetProgress → 阻(絕不超生,波騎頭號雷)。
   * progress=waveKilled、targetProgress=waveQuota。
   */
  private spawnBlocked(): boolean {
    const maxAlive = this.curMaxAlive();
    const alive = this.countWaveAlive();
    const pending = this.countWavePending();
    if (alive + pending >= maxAlive) return true;                    // ① 場上上限
    if (this.waveKilled + alive + pending >= this.waveQuota) return true; // ② 生產總量封頂
    return false;
  }

  /** 依各類型 spawnWeight 權重隨機選一種敵人 */
  /**
   * 依 spawnWeight 權重隨機選一種敵人(只在 currentWave 已解鎖的類型間抽選)。
   * 階段2b:restrictPool 限定敵種池(如近身組近戰池)→在【解鎖∩限定池∩有權重】中抽;交集空→退回全解鎖池。
   */
  private pickEnemyType(restrictPool?: EnemyType[]): EnemyType {
    const types = GameConfig.enemy.types;
    const unlock = GameConfig.enemy.unlockByWave as Record<string, number>;
    // 已解鎖 & 有權重的類型（依波次）
    let pool = (Object.keys(types) as EnemyType[]).filter(
      (k) => (unlock[k] ?? Infinity) <= this.currentWave && types[k].spawnWeight > 0
    );
    if (restrictPool && restrictPool.length > 0) {
      const restricted = pool.filter((k) => restrictPool.includes(k));
      if (restricted.length > 0) pool = restricted; // 交集非空才限定;空(如早期近戰未解鎖)→退回全池
    }
    if (pool.length === 0) return 'normal';
    let total = 0;
    for (const k of pool) total += types[k].spawnWeight;
    let roll = Math.random() * total;
    for (const k of pool) {
      roll -= types[k].spawnWeight;
      if (roll <= 0) return k;
    }
    return pool[0];
  }

  // ---------------------------------------------------------------------------
  // 敵人更新（鎖定最近存活角色 + 蓄力/衝鋒預警）
  // ---------------------------------------------------------------------------
  private updateEnemies(time: number): void {
    this.chargeWarnGfx.clear();
    const children = this.enemies.getChildren();
    // 仇恨警戒上限(point4):先統計每個角色 seat 目前被幾隻【被動】怪盯上(chase 中),
    //   再對「被動且該 seat 已達上限」的 patrol 怪設 chaseBlocked=true→不讓新的被動怪進 chase。
    //   主動怪(aggroActive:被玩家打過)與 forceChase(守護波)怪不計入、不受限。
    const cap = GameConfig.enemy.ai.aggroCapPassive;
    const passiveChasers: number[] = new Array(this.characters.length).fill(0);
    for (const child of children) {
      const e = child as Enemy;
      if (!e.active) continue;
      if (e.aggroActive || e.forceChase) continue;         // 主動/事件怪不計
      if (e.getAiState() !== 'chase') continue;            // 只算真的在追的
      const seat = e.targetSeat;
      if (seat >= 0 && seat < passiveChasers.length) passiveChasers[seat]++;
    }
    for (const child of children) {
      const e = child as Enemy;
      if (!e.active) continue;
      // 被動 patrol 怪:若其綁定 seat 已達上限→封鎖(維持 patrol,不進 chase);否則放行。
      // 用【累加配額】avoid 同幀多隻 patrol 一起湧入超過上限:currentChasers 起算,每放行一隻 +1;
      //   達 cap 後其餘 patrol 怪一律封鎖。已在 chase 的不動(不回收→符合「不退回」規格)。
      if (!e.aggroActive && !e.forceChase && e.getAiState() === 'patrol') {
        const seat = e.targetSeat;
        if (seat >= 0 && seat < passiveChasers.length) {
          if (passiveChasers[seat] < cap) {
            e.chaseBlocked = false;   // 放行→占一個名額
            passiveChasers[seat]++;
          } else {
            e.chaseBlocked = true;    // 名額滿→封鎖,維持 patrol
          }
        } else {
          e.chaseBlocked = false;
        }
      } else {
        e.chaseBlocked = false; // 主動/forceChase/已在 chase 的怪不封鎖
      }
    }
    for (const child of children) {
      const enemy = child as Enemy;
      if (!enemy.active) continue;

      // 時間暫停中，敵人凍結（停速度、不跑 AI）;階段2:事件聚焦定格(eventFocusPause)也凍敵。
      if (this.timeStopped || this.eventFocusPause) {
        (enemy.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      } else {
        // 黏著目標(階段1):追【綁定目標】(生成時綁最近、黏著不亂換),事件覆寫>黏著>就近重綁。
        //   取代舊「每幀 findNearestCharacter 選最近」→ 別的角色走過去不會把已綁的怪吸走(解問題③)。
        const target: Character | { x: number; y: number } | null = this.resolveEnemyTarget(enemy, time);
        const tx = target ? target.x : enemy.x;
        const ty = target ? target.y : enemy.y;
        enemy.updateAI(tx, ty, time);

        drawEnemyChargeWarnings(this.chargeWarnGfx, enemy, target, time);
      }

      // 邊界反彈——敵人被擊飛超出場地時 clamp 回內側並反向該軸速度
      bounceEnemyOffBounds(enemy, this.arena);
      // 怪推開木箱、不可穿過塔 / BOSS 本體（時停中怪凍結，不套用）
      if (!this.timeStopped) {
        pushBreakablesFromEnemy(enemy, this.breakables);
        pushEnemyOutOfStructures(enemy, this.enemies);
      }
    }

    // 敵人↔敵人碰撞分離(異靈藍圖):時停/事件聚焦定格中不跑(怪凍結)。
    if (GameConfig.enemySeparation.enabled && !this.timeStopped && !this.eventFocusPause) {
      const separators: Enemy[] = [];
      for (const child of children) {
        const e = child as Enemy;
        if (joinsEnemySeparation(e)) separators.push(e);
      }
      // 軟分離（改移動方向）為主，硬分離（推開殘留重疊）補刀
      for (const e of separators) applyEnemySeparationSteering(e, separators);
      resolveEnemyOverlap(separators, this.arena);
    }
  }

  /** 敵人蓄力發動：對 attackRadius 內「所有存活角色」判定扣血 */
  private onEnemyAttackFire = (enemy: Enemy): void => {
    if (this.gameOver) return;
    const time = this.time.now;
    this.spawnAttackFlash(enemy.x, enemy.y);

    for (const c of this.characters) {
      if (!c.alive) continue;
      const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, c.x, c.y);
      if (dist > GameConfig.enemy.attackRadius) continue;
      // 敵人傷害隨等級成長（Lv1 較低 → Lv10 = 現值）
      const dmg = Math.max(1, Math.round(GameConfig.enemy.attackDamage));
      const applied = c.takeDamage(dmg, time);
      if (applied) {
        this.flashHurt(c);
        // 受擊不再震動（只有爆發震動）
        if (c.hp <= 0) this.killCharacter(c);
      }
    }
  };

  private killCharacter(c: Character): void {
    c.die();
    // GameOver 僅在「全員陣亡且場上不只 P1（有 BOT 一起團滅）」時觸發。
    // 只有 P1 時，P1 陣亡不進結算——留原地可用 R 隨時滿血復活、或 T 重開，避免卡死。
    if (this.aliveCount() === 0 && this.characters.length > 1) {
      this.triggerGameOver();
    }
  }

  /** R 熱鍵——原地滿血復活 P1（無限次），恢復可操控與正常戰鬥 */
  private revivePlayer(): void {
    if (this.gameOver) return;
    if (this.player.alive) return;
    this.player.revive();
    // 第8項：R 復活 → P1 命中計數歸零
    this.p1AttackHits = 0;
    this.player.setPosition(
      Phaser.Math.Clamp(this.player.x, this.arena.left + GameConfig.player.radius, this.arena.right - GameConfig.player.radius),
      Phaser.Math.Clamp(this.player.y, this.arena.top + GameConfig.player.radius, this.arena.bottom - GameConfig.player.radius)
    );
    this.emitStats();
  }

  /** T 熱鍵——遊戲進行中直接乾淨重開一局（沿用 create 的 resetState/scene 重啟機制） */
  private restartRun(): void {
    // 清殘留 tween/timer，避免重啟後回呼觸及已銷毀物件（沿用 GameOver 的乾淨重啟做法）
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.stop('UIScene');
    this.scene.start('GameScene', { controlMode: this.controlMode }); // 重開保留當前操作模式
    this.scene.launch('UIScene');
  }

  /** ESC 熱鍵——返回主菜單（清理場景狀態，停止 UIScene，回到 TitleScene） */
  private quitToTitle(): void {
    // 清理 tween/timer 避免洩漏
    this.tweens.killAll();
    this.time.removeAllEvents();
    // 停止 UIScene 並回到主菜單
    this.scene.stop('UIScene');
    this.scene.start('TitleScene');
  }

  private aliveCount(): number {
    return this.characters.reduce((n, c) => n + (c.alive ? 1 : 0), 0);
  }

  // --- shooter 子彈 ---
  /** shooter 發射子彈 */
  private onEnemyShoot = (enemy: Enemy, angle: number): void => {
    if (this.gameOver) return;
    const bullet = this.bullets.get(enemy.x, enemy.y) as Bullet | null;
    if (!bullet) return;
    bullet.fire(enemy.x, enemy.y, angle, this.time.now);
  };

  /** 遠程兵雷射填滿發射：以怪為起點朝鎖定方向的直線 AOE，命中存活角色扣血 + 短暫雷射演出 */
  private onEnemyLaserFire = (enemy: Enemy, angle: number): void => {
    if (this.gameOver || !enemy.active) return;
    const cfg = GameConfig.enemy.shooter;
    const ox = enemy.x;
    const oy = enemy.y;
    const now = this.time.now;

    // 直線 AOE：對每個存活角色，判定其是否在「以怪為起點、朝 angle、長 laserLength、寬 laserWidth」矩形內
    for (const c of this.characters) {
      if (!c.alive) continue;
      if (c.isInvulnerable(now)) continue;
      if (pointInOrientedRect(c.x, c.y, ox, oy, angle, 0, cfg.laserLength, cfg.laserWidth)) {
        this.damageCharacterFrom(c, cfg.laserDamage, ox, oy);
      }
    }
    // 守護事件:雷射也對 guardNpc 判傷(per-enemy 冷卻,同近戰路徑)
    if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active && !this.guardNpc.dead) {
      if (pointInOrientedRect(this.guardNpc.x, this.guardNpc.y, ox, oy, angle, 0, cfg.laserLength, cfg.laserWidth)) {
        if (now >= enemy.nextNpcHitAt) {
          enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
          const gcfg = GameConfig.event.guard;
          const dead = this.guardNpc.takeDamage(Math.max(1, Math.round(gcfg.npcContactDamage)));
          this.flashEnemy(this.guardNpc);
          if (dead) { this.guardNpc.kill(); this.guardNpc = null; this.completeEvent(false); }
        }
      }
    }

    // 演出：一道亮綠雷射（旋轉矩形），短暫存在後淡出
    const ex = ox + Math.cos(angle) * cfg.laserLength;
    const ey = oy + Math.sin(angle) * cfg.laserLength;
    const beam = this.add
      .rectangle((ox + ex) / 2, (oy + ey) / 2, cfg.laserLength, cfg.laserWidth, 0x44ff77, 0.85)
      .setRotation(angle)
      .setDepth(19);
    beam.setStrokeStyle(2, 0xccffdd, 0.9);
    this.tweens.add({
      targets: beam,
      alpha: 0,
      duration: cfg.laserOnDurationMs,
      onComplete: () => beam.destroy()
    });
  };

  /** 投射兵投彈：炸彈飛向鎖定落點(tx,ty)，落點顯示預警圈，到點爆炸對半徑內存活角色扣血 */
  private onEnemyBombThrow = (enemy: Enemy, tx: number, ty: number): void => {
    if (this.gameOver || !enemy.active) return;
    const cfg = GameConfig.enemy.bomber;
    const sx = enemy.x;
    const sy = enemy.y;

    // 落點預警圈（紅圈，飛行期間存在）
    const warn = this.add.circle(tx, ty, cfg.bombRadius, 0xff4d4d, 0.15).setDepth(3);
    warn.setStrokeStyle(2, 0xff4d4d, 0.7);
    const warnTween = this.tweens.add({
      targets: warn,
      alpha: 0.3,
      duration: 200,
      yoyo: true,
      repeat: -1
    });

    // 炸彈飛行物（紫色小球，從怪拋向落點）
    const bomb = this.add.circle(sx, sy, 8, 0xe0b0ff, 1).setDepth(21);
    bomb.setStrokeStyle(2, 0x7a3fb0, 1);
    this.tweens.add({
      targets: bomb,
      x: tx,
      y: ty,
      duration: cfg.bombFlightMs,
      ease: 'Sine.easeIn',
      onComplete: () => {
        bomb.destroy();
        warnTween.remove();
        warn.destroy();
        if (this.gameOver) return;
        // 落地爆炸：半徑內存活角色扣血
        const now = this.time.now;
        for (const c of this.characters) {
          if (!c.alive || c.isInvulnerable(now)) continue;
          if (Phaser.Math.Distance.Between(c.x, c.y, tx, ty) <= cfg.bombRadius) {
            this.damageCharacterFrom(c, cfg.bombDamage, tx, ty);
          }
        }
        // 守護事件:炸彈爆炸也對 guardNpc 判傷(per-enemy 冷卻,同近戰路徑)
        if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active && !this.guardNpc.dead) {
          if (Phaser.Math.Distance.Between(this.guardNpc.x, this.guardNpc.y, tx, ty) <= cfg.bombRadius) {
            if (now >= enemy.nextNpcHitAt) {
              enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
              const gcfg = GameConfig.event.guard;
              const dead = this.guardNpc.takeDamage(Math.max(1, Math.round(gcfg.npcContactDamage)));
              this.flashEnemy(this.guardNpc);
              if (dead) { this.guardNpc.kill(); this.guardNpc = null; this.completeEvent(false); }
            }
          }
        }
        // 爆炸視覺
        this.spawnExpandingRing(tx, ty, cfg.bombRadius, 0xff6a3a, 260);
        this.shakeOnce(80, 0.006);
      }
    });
  };

  private updateBullets(time: number): void {
    for (const child of this.bullets.getChildren()) {
      const bullet = child as Bullet;
      if (!bullet.active) continue;
      // 時間暫停中，子彈也凍結（停速度、不計逾時）
      if (this.timeStopped) {
        (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        continue;
      }
      bullet.tick(time, this.arena);
      // 守護事件:子彈命中 guardNpc 判傷(NPC 全域冷卻 bulletNpcHitAt;子彈命中後回收)
      if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active && !this.guardNpc.dead && bullet.active) {
        const hitR = GameConfig.enemy.shooter.bulletRadius + this.guardNpc.getBodyRadius();
        if (Phaser.Math.Distance.Between(bullet.x, bullet.y, this.guardNpc.x, this.guardNpc.y) <= hitR) {
          bullet.recycle();
          if (time >= this.guardNpc.bulletNpcHitAt) {
            const gcfg = GameConfig.event.guard;
            this.guardNpc.bulletNpcHitAt = time + gcfg.npcAttackCooldownMs;
            const dead = this.guardNpc.takeDamage(Math.max(1, Math.round(gcfg.npcContactDamage)));
            this.flashEnemy(this.guardNpc);
            if (dead) { this.guardNpc.kill(); this.guardNpc = null; this.completeEvent(false); }
          }
        }
      }
    }
  }

  /** 子彈命中角色：扣血、回收子彈 */
  private onBulletHitCharacter = (
    charObj: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    bulletObj: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ): void => {
    if (this.gameOver) return;
    const c = charObj as unknown as Character;
    const bullet = bulletObj as unknown as Bullet;
    if (!c.alive || !bullet.active) return;
    bullet.recycle();
    const applied = c.takeDamage(
      Math.max(1, Math.round(GameConfig.enemy.shooter.bulletDamage)),
      this.time.now
    );
    if (applied) {
      this.flashHurt(c);
      if (c.hp <= 0) this.killCharacter(c);
    }
  };

  /** 直線雷射等來源對角色扣血（含 enemyDamageScale），從 (fromX,fromY) 方向做受傷回饋。
   *  rootMs>0 時，命中後定身該角色 rootMs 毫秒（禁移動+禁攻擊；塔扇形/BOSS招用 2000）。 */
  private damageCharacterFrom(c: Character, amount: number, _fromX: number, _fromY: number, rootMs = 0): void {
    if (!c.alive) return;
    const applied = c.takeDamage(
      Math.max(1, Math.round(amount)),
      this.time.now
    );
    if (applied) {
      this.flashHurt(c);
      // 塔扇形/BOSS 招命中 → 定身 2 秒（取現有與新值較大者，避免縮短既有定身）
      if (rootMs > 0) {
        c.rootedUntil = Math.max(c.rootedUntil, this.time.now + rootMs);
      }
      if (c.hp <= 0) this.killCharacter(c);
    }
  }

  // --- charger 衝刺撞擊：衝刺中的衝鋒怪撞到角色造成傷害 ---
  private updateChargerCollisions(time: number): void {
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active || !enemy.isChargerDashing()) continue;
      const hitR = GameConfig.enemy.charger.dashHitRadius + GameConfig.player.radius;
      for (const c of this.characters) {
        if (!c.alive) continue;
        if (Phaser.Math.Distance.Between(enemy.x, enemy.y, c.x, c.y) <= hitR) {
          const applied = c.takeDamage(
            Math.max(1, Math.round(GameConfig.enemy.charger.dashDamage)),
            time
          );
          if (applied) {
            this.flashHurt(c);
            if (c.hp <= 0) this.killCharacter(c);
          }
        }
      }
    }
  }

  private spawnAttackFlash(x: number, y: number): void {
    const ring = this.add
      .circle(x, y, GameConfig.enemy.attackRadius, 0xff3344, 0.35)
      .setDepth(3);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 1.15,
      duration: 160,
      onComplete: () => ring.destroy()
    });
  }

  // ---------------------------------------------------------------------------
  // 道具系統
  // ---------------------------------------------------------------------------
  private updateItems(delta: number, time: number): void {
    // 定時保底掉落
    if (GameConfig.items.periodicDropMs > 0) {
      this.itemDropAccumulator += delta;
      if (this.itemDropAccumulator >= GameConfig.items.periodicDropMs) {
        this.itemDropAccumulator = 0;
        const inset = GameConfig.spawn.edgeInset + 40;
        const x = Phaser.Math.Between(this.arena.left + inset, this.arena.right - inset);
        const y = Phaser.Math.Between(this.arena.top + inset, this.arena.bottom - inset);
        this.dropItemAt(x, y, time);
      }
    }
    // 逾時消失
    for (const child of this.items.getChildren()) {
      const item = child as Item;
      if (item.active) item.tick(time);
    }
  }

  private dropItemAt(x: number, y: number, time: number): void {
    if (!this.itemsEnabled) return; // 道具總開關(config 初值 + I 鍵 toggle):關閉→任何來源都不生成道具(殺怪掉落/寶箱獎勵/定時)
    if (this.items.countActive(true) >= GameConfig.items.maxAlive) return;
    const skill = this.pickDropSkill();
    const inset = GameConfig.spawn.edgeInset;
    const cx = Phaser.Math.Clamp(x, this.arena.left + inset, this.arena.right - inset);
    const cy = Phaser.Math.Clamp(y, this.arena.top + inset, this.arena.bottom - inset);
    const item = this.items.get(cx, cy) as Item | null;
    if (!item) return;
    item.spawnItem(cx, cy, skill, time);
  }

  // ---------------------------------------------------------------------------
  // 可打破物件（瓶罐/箱子）
  // ---------------------------------------------------------------------------
  /** 每波開始成堆灑可打破物件——幾堆、每堆幾個聚在一起，堆遠離場地中心、避開玩家/彼此。 */
  private spawnBreakablesForWave(): void {
    // 關卡制:可破壞物件改【進入子區時靜態布置】(placeStaticBreakables),不隨波次重生。
    if (this.levelMode) return;
    const cfg = GameConfig.breakable;
    const inset = cfg.edgeInset;
    const ccx = this.arena.centerX, ccy = this.arena.centerY;
    const clusterCenters: Array<{ x: number; y: number }> = [];
    for (let cl = 0; cl < cfg.clustersPerWave; cl++) {
      if (this.breakables.countActive(true) >= cfg.maxAlive) break;
      // 找一個堆中心：遠離場地中心(>minDistFromCenter)、避開玩家、避開其他堆
      let hx = 0, hy = 0, ok = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = Phaser.Math.Between(this.arena.left + inset, this.arena.right - inset);
        const y = Phaser.Math.Between(this.arena.top + inset, this.arena.bottom - inset);
        if (Phaser.Math.Distance.Between(x, y, ccx, ccy) < cfg.minDistFromCenter) continue; // 太靠中心
        if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < cfg.safeDistanceFromPlayer) continue;
        let clash = false;
        for (const c of clusterCenters) {
          if (Phaser.Math.Distance.Between(x, y, c.x, c.y) < cfg.minClusterSpacing) { clash = true; break; }
        }
        if (clash) continue;
        hx = x; hy = y; ok = true; break;
      }
      if (!ok) continue;
      clusterCenters.push({ x: hx, y: hy });
      // 堆內幾個木箱：排成【不互疊】的一叢——用小陣列/環狀排開，彼此間距≥木箱直徑。
      const placed: Array<{ x: number; y: number }> = [];
      const minGap = cfg.radius * 2 + 4; // 彼此至少一個直徑+縫，不互疊
      for (let n = 0; n < cfg.perCluster; n++) {
        if (this.breakables.countActive(true) >= cfg.maxAlive) break;
        let bx = 0, by = 0, placedOk = false;
        for (let attempt = 0; attempt < 16; attempt++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * cfg.clusterSpread;
          const x = Phaser.Math.Clamp(hx + Math.cos(ang) * rad, this.arena.left + inset, this.arena.right - inset);
          const y = Phaser.Math.Clamp(hy + Math.sin(ang) * rad, this.arena.top + inset, this.arena.bottom - inset);
          if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < GameConfig.player.radius + cfg.radius + 8) continue;
          // 同堆不互疊：與已放的木箱間距≥minGap
          let overlap = false;
          for (const q of placed) { if (Phaser.Math.Distance.Between(x, y, q.x, q.y) < minGap) { overlap = true; break; } }
          if (overlap) continue;
          bx = x; by = y; placedOk = true; break;
        }
        if (!placedOk) continue;
        placed.push({ x: bx, y: by });
        const bk = this.breakables.get(bx, by) as Breakable | null;
        if (!bk) break;
        bk.spawnBreakable(bx, by);
      }
    }
    // 每波再灑少量【爆炸桶】(比照木箱位置規則：遠離中心/避玩家/不與現有物件互疊)。
    const bcfg = cfg.barrel;
    let placedBarrels = 0;
    for (let n = 0; n < bcfg.perWave; n++) {
      if (this.breakables.countActive(true) >= cfg.maxAlive) break;
      let bx = 0, by = 0, ok2 = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = Phaser.Math.Between(this.arena.left + inset, this.arena.right - inset);
        const y = Phaser.Math.Between(this.arena.top + inset, this.arena.bottom - inset);
        if (Phaser.Math.Distance.Between(x, y, ccx, ccy) < cfg.minDistFromCenter) continue;
        if (Phaser.Math.Distance.Between(x, y, this.player.x, this.player.y) < cfg.safeDistanceFromPlayer) continue;
        // 不與任何現有物件(木箱/桶)互疊
        let clash = false;
        for (const ch of this.breakables.getChildren()) {
          const o = ch as Breakable;
          if (!o.active) continue;
          const need = o.explosive ? bcfg.minBarrelSpacing : (cfg.radius * 2 + 6);
          if (Phaser.Math.Distance.Between(x, y, o.x, o.y) < need) { clash = true; break; }
        }
        if (clash) continue;
        bx = x; by = y; ok2 = true; break;
      }
      if (!ok2) continue;
      const bk = this.breakables.get(bx, by) as Breakable | null;
      if (!bk) break;
      bk.spawnBreakable(bx, by, 'barrel');
      placedBarrels++;
    }
    void placedBarrels;
  }

  /**
   * 玩家攻擊(普攻揮擊/衝刺命中)命中判定內順手打破範圍內的可打破物件。
   * 不納入自動鎖定(玩家不會自動衝去打)，只是揮到/衝到就扣 HP。打破→碎裂特效 + 有機率(同怪物 dropChance)掉道具。
   * @param useArc true=扇形(普攻,需在 aimAngle±half 內)；false=圓形(衝刺,範圍內即中)
   */
  /** 招式 AOE(道具招/連段招)【直接秒碎】範圍內圓形的可打破物件(不管剩餘 hp)；
   *  掉落上限：一次呼叫最多 maxDropPerBreak 個掉道具，其餘只碎不掉(避免一招炸一堆洗版)。 */
  private breakBreakablesInCircle(x: number, y: number, radius: number, _amount: number, time: number): void {
    let drops = 0;
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (Phaser.Math.Distance.Between(x, y, bk.x, bk.y) <= radius + bk.getBodyRadius()) {
        if (bk.fusing) continue; // 已在fuse倒數的爆炸桶跳過(它本來就會爆),不再設dead→避免殭屍
        bk.dead = true; // 秒碎
        const allowDrop = drops < GameConfig.breakable.maxDropPerBreak;
        this.breakBreakable(bk, time, allowDrop);
        if (allowDrop) drops++;
      }
    }
  }

  /** 招式 AOE 對【朝 dir 的定向矩形】內可打破物件【直接秒碎】+ 掉落上限。 */
  private breakBreakablesInRect(ox: number, oy: number, dir: number, back: number, length: number, width: number, _amount: number, time: number): void {
    let drops = 0;
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (pointInOrientedRect(bk.x, bk.y, ox, oy, dir, back, length, width)) {
        if (bk.fusing) continue; // 已在fuse倒數的爆炸桶跳過,不再設dead→避免殭屍
        bk.dead = true; // 秒碎
        const allowDrop = drops < GameConfig.breakable.maxDropPerBreak;
        this.breakBreakable(bk, time, allowDrop);
        if (allowDrop) drops++;
      }
    }
  }

  private hitBreakablesInRange(c: Character, radius: number, half: number, useArc: boolean, atk: number, time: number): void {
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      const dist = Phaser.Math.Distance.Between(c.x, c.y, bk.x, bk.y);
      if (dist > radius + bk.getBodyRadius()) continue;
      if (useArc) {
        const toBk = Phaser.Math.Angle.Between(c.x, c.y, bk.x, bk.y);
        const diff = Math.abs(Phaser.Math.Angle.Wrap(toBk - c.aimAngle));
        if (diff > half) continue;
      }
      if (bk.hit(atk)) this.breakBreakable(bk, time);
    }
  }

  /** 打破一個物件：爆炸桶→進入 fuse 倒數(延遲爆)；木箱→碎裂特效 + (allowDrop 時)掉道具 + 回收。 */
  private breakBreakable(bk: Breakable, time: number, allowDrop = true): void {
    if (bk.explosive) { this.startBarrelFuse(bk, allowDrop); return; }
    const bx = bk.x, by = bk.y;
    // 碎裂特效：小粒子爆開
    this.spawnBreakParticles(bx, by);
    bk.despawn();
    // 有機率掉道具(共用怪物掉率 dropChance、同 pickDropSkill 加權)
    if (allowDrop && Math.random() < GameConfig.items.dropChance) this.dropItemAt(bx, by, time);
  }

  /**
   * 爆炸桶打破→進入 fuse 倒數(延遲爆,像蓄力)：桶標記 fusing(不再被打)、閃紅抖動、地面出現【警示範圍圈】
   * (半徑=explodeRadius，由內而外填滿+閃爍，跟隨桶移動——fuse 期間桶仍可被推)，倒數 fuseMs 完→explodeBarrel。
   * 怪/玩家看到警示圈有時間跑出範圍閃避。
   */
  private startBarrelFuse(bk: Breakable, allowDrop: boolean): void {
    if (bk.fusing) { bk.dead = false; return; } // 已在fuse中→還原任何被呼叫端剛設的dead(避免AOE秒碎設dead後在此早退→殭屍),不重啟fuse
    const bcfg = GameConfig.breakable.barrel;
    // hit()/AOE 打破時已把 bk.dead 設 true(代表「被打破」)，但爆炸桶被打破=進入 fuse 倒數(還活著、將爆)，
    // 不是立即消失。這裡把 dead 還原(改由 fusing 表示狀態)，否則 fuse/推動/再受擊迴圈都會因 dead 跳過→桶變殭屍(不受擊/不能推)。
    bk.dead = false;
    bk.fusing = true;
    const R = bcfg.explodeRadius;
    const g = this.add.graphics().setDepth(4);
    const start = this.time.now;
    // 地面警示圈：外框 + 由內而外填滿 + 邊閃；跟隨桶(fuse 期間桶可被推)
    const ev = this.time.addEvent({
      delay: 16, loop: true,
      callback: () => {
        if (!bk.active || bk.dead) { g.destroy(); ev.remove(); return; }
        const p = Phaser.Math.Clamp((this.time.now - start) / bcfg.fuseMs, 0, 1);
        g.clear();
        const blink = Math.floor(this.time.now / 90) % 2 === 0;
        g.lineStyle(3, 0xff3322, blink ? 0.95 : 0.5);
        g.strokeCircle(bk.x, bk.y, R);
        g.fillStyle(0xff5522, 0.18 + 0.12 * p);
        g.fillCircle(bk.x, bk.y, R * p);
        // 桶身閃紅(將爆)：紅↔正常貼圖交替；不用 setTintFill(0xffffff)(會變純白塊,爆炸/清除時序若殘留=白塊bug)
        if (blink) bk.setTint(0xff4422); else bk.clearTint();
        bk.setPosition(bk.x, bk.y);
      }
    });
    this.time.delayedCall(bcfg.fuseMs, () => {
      g.destroy(); ev.remove();
      if (bk.active && !bk.dead) this.explodeBarrel(bk, this.time.now, 0, allowDrop);
    });
  }

  /**
   * 引爆爆炸桶：範圍 AOE 爆炸——閃白+強震+火光特效；範圍內【怪】低傷+朝外擊退(炸飛)；
   * 【玩家】受影響(快扣血/慢掉能量、不擊退)；連鎖引爆範圍內其他桶(深度上限 maxChainDepth)。
   * @param depth 連鎖深度(0=首爆)；@param allowDrop 是否可掉道具
   */
  private explodeBarrel(bk: Breakable, time: number, depth: number, allowDrop = true): void {
    const bcfg = GameConfig.breakable.barrel;
    const ex = bk.x, ey = bk.y;
    bk.dead = true;
    bk.despawn();
    // ── 特效：火光擴散圈 + 粒子 + 閃白 + 強震 ──
    this.spawnExpandingRing(ex, ey, bcfg.explodeRadius, 0xff6a1a, 360);
    const core = this.add.circle(ex, ey, bcfg.explodeRadius * 0.4, 0xffd400, 0.8).setDepth(30);
    this.tweens.add({ targets: core, alpha: 0, scale: 2.2, duration: 300, onComplete: () => core.destroy() });
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2, spd = 90 + Math.random() * 150;
      const col = Math.random() < 0.5 ? 0xff6a1a : 0xffd400;
      const pr = this.add.rectangle(ex, ey, 6, 6, col).setDepth(31);
      this.tweens.add({ targets: pr, x: ex + Math.cos(a) * spd, y: ey + Math.sin(a) * spd, alpha: 0, angle: Phaser.Math.Between(-180, 180), duration: 360, onComplete: () => pr.destroy() });
    }
    this.shakeOnce(GameConfig.juice.burstShakeDuration + 40, GameConfig.juice.burstShakeIntensity * 1.6);
    // ── 範圍內【怪】：低傷 + 朝外擊退(炸飛)。boss/tower/anchor/npc 不擊退。 ──
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || !e.isVulnerable()) continue;
      const d = Phaser.Math.Distance.Between(ex, ey, e.x, e.y);
      if (d > bcfg.explodeRadius + e.getBodyRadius()) continue;
      this.damageEnemyFrom(this.player, e, bcfg.explodeDamage, 0, ex, ey, time); // 低傷(不用內建擊退,下面自訂位移擊退)
      if (!e.active || e.dead) continue;
      if (!isFixedEnemy(e)) {
        const ang = d > 0.001 ? Math.atan2(e.y - ey, e.x - ex) : Math.random() * Math.PI * 2;
        const nx = Phaser.Math.Clamp(e.x + Math.cos(ang) * bcfg.knockback, this.arena.left + e.getBodyRadius(), this.arena.right - e.getBodyRadius());
        const ny = Phaser.Math.Clamp(e.y + Math.sin(ang) * bcfg.knockback, this.arena.top + e.getBodyRadius(), this.arena.bottom - e.getBodyRadius());
        e.setPosition(nx, ny); // 一次性強位移=擊退炸飛(明顯)
      }
    }
    // ── 炸到【玩家】：快速扣血 / 慢速掉能量(比照 takeDamage noHpLoss)、玩家不擊退。 ──
    for (const c of this.characters) {
      if (!c.alive) continue;
      if (Phaser.Math.Distance.Between(ex, ey, c.x, c.y) <= bcfg.explodeRadius + GameConfig.player.radius) {
        this.damageCharacterFrom(c, bcfg.explodeDamage, ex, ey); // takeDamage 內部:noHpLoss(慢速)只 energy-1、fast 扣血；均不擊退
        this.flashHurt(c);
      }
    }
    // ── 掉道具(低機率,主打爆炸不主打掉落) ──
    if (allowDrop && Math.random() < bcfg.dropChance) this.dropItemAt(ex, ey, time);
    // ── 連鎖引爆範圍內其他桶(深度上限) ──
    if (depth < bcfg.maxChainDepth) {
      for (const child of this.breakables.getChildren()) {
        const other = child as Breakable;
        if (!other.active || other.dead || !other.explosive) continue;
        if (Phaser.Math.Distance.Between(ex, ey, other.x, other.y) <= bcfg.explodeRadius + other.getBodyRadius()) {
          // 稍延遲連鎖(視覺上一顆接一顆)、深度+1，超過上限的桶不再往下連鎖(但仍會被引爆一次)
          this.time.delayedCall(90, () => { if (other.active && !other.dead) this.explodeBarrel(other, this.time.now, depth + 1, false); });
        }
      }
    }
  }

  /** 打破碎裂小粒子特效 */
  private spawnBreakParticles(x: number, y: number): void {
    const cfg = GameConfig.breakable;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      const spd = 60 + Math.random() * 80;
      const p = this.add.rectangle(x, y, 5, 5, cfg.color).setDepth(11);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(ang) * spd,
        y: y + Math.sin(ang) * spd,
        alpha: 0,
        angle: Phaser.Math.Between(-180, 180),
        duration: 320,
        onComplete: () => p.destroy()
      });
    }
  }

  /** 加權隨機挑掉落招式（T 時停權重明顯低於其他 4 種）。慢速排除補血 H(慢速無血量、H 無意義)。 */
  private pickDropSkill(): SkillType {
    const w = GameConfig.items.weights;
    // 只慢速排除 H(補血)——慢速已拔血量；快速維持有 H。
    const skills: SkillType[] = this.controlMode === 'slow'
      ? ['A', 'B', 'C', 'E', 'F', 'T']
      : ['A', 'B', 'C', 'E', 'F', 'H', 'T'];
    let total = 0;
    for (const s of skills) total += w[s];
    let roll = Math.random() * total;
    for (const s of skills) {
      roll -= w[s];
      if (roll <= 0) return s;
    }
    return 'A';
  }

  private onPickupItem = (
    charObj: Phaser.Types.Physics.Arcade.GameObjectWithBody,
    itemObj: Phaser.Types.Physics.Arcade.GameObjectWithBody
  ): void => {
    if (this.gameOver) return;
    const c = charObj as unknown as Character;
    const item = itemObj as unknown as Item;
    if (!c.alive || !item.active || item.taken) return;
    if (c.timestopping) return; // 時停穿梭的瞬移位移不吃道具(經過道具不觸發拾取)
    // 互搶——同一幀可能有多個角色碰到同一道具，先登記候選，
    // 於 update() 末端統一「位置近者得」原子結算，避免雙重觸發。
    const prev = this.pendingPickups.get(item);
    if (!prev) {
      this.pendingPickups.set(item, c);
    } else {
      const dPrev = Phaser.Math.Distance.Between(prev.x, prev.y, item.x, item.y);
      const dCur = Phaser.Math.Distance.Between(c.x, c.y, item.x, item.y);
      if (dCur < dPrev) this.pendingPickups.set(item, c);
    }
  };

  /** 結算本幀所有道具互搶——每個道具只給「最近的角色」，原子拿取 + 觸發招式 */
  private resolvePickups(): void {
    if (this.pendingPickups.size === 0) return;
    const time = this.time.now;
    for (const [item, c] of this.pendingPickups) {
      if (item.taken || !item.active) continue; // 已被結算過
      if (!c.alive) continue;
      const skill = item.skill;
      // 時停(T)若【spreadRadius 內無可傷敵人】→ 不觸發、不消耗道具（留在場上），避免對空氣空放大招。
      if (skill === 'T' && !this.skillCtl.hasTimestopTarget(c)) {
        continue; // 不設 taken、不 despawn → 道具保留
      }
      item.taken = true; // 原子旗標：從此其他人碰到都跳過
      // 清除所有鎖定此道具的角色鎖定 + 結束其撿道具衝刺
      for (const ch of this.characters) {
        if (ch.lockedTarget === (item as unknown as Phaser.GameObjects.GameObject)) {
          ch.lockedTarget = null;
          if (ch.dashToItem && ch.isDashing) this.endDashState(ch);
        }
      }
      if (this.lockedTarget === item) this.lockedTarget = null;
      item.despawn();
      // 補血道具(H) → 只補撿到的角色，不走招式演出；其餘照觸發招式
      if (skill === 'H') this.applyHeal(c);
      else this.skillCtl.cast(c, skill, time);
    }
    this.pendingPickups.clear();
  }

  /** 補血——只補撿到的角色固定量(不超 maxHp) + 綠光/跳字回饋 */
  private applyHeal(c: Character): void {
    if (!c.alive) return;
    const before = c.hp;
    c.hp = Math.min(GameConfig.player.maxHp, c.hp + GameConfig.heal.amount);
    const gained = c.hp - before;
    // 綠光圈 + +N 跳字
    const ring = this.add.circle(c.x, c.y, 10, 0x2ecc71, 0.5).setDepth(22);
    ring.setStrokeStyle(3, 0x2ecc71, 0.9);
    this.tweens.add({
      targets: ring,
      radius: 44,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
    const txt = this.add
      .text(c.x, c.y - 12, `+${gained}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#5ef08a',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({
      targets: txt,
      y: c.y - 48,
      alpha: 0,
      duration: 620,
      ease: 'Cubic.easeOut',
      onComplete: () => txt.destroy()
    });
    this.emitStats();
  }

  // ---------------------------------------------------------------------------
  // 一次性招式（吃道具觸發，P1 與 BOT 共用；實作見 controllers/SkillController）
  // ---------------------------------------------------------------------------

  /**
   * 建立 SkillController 需要的場景能力（只開放招式用得到的部分）
   */
  private createSkillHost(): SkillHost {
    return {
      scene: this,
      enemies: this.enemies,
      arena: () => this.arena,
      isGameOver: () => this.gameOver,
      damageEnemy: (actor, enemy, damage, knockback, time) => this.damageEnemy(actor, enemy, damage, knockback, time),
      damageEnemyFrom: (actor, enemy, damage, knockback, fromX, fromY, time) =>
        this.damageEnemyFrom(actor, enemy, damage, knockback, fromX, fromY, time),
      breakBreakablesInCircle: (x, y, radius, damage, time) => this.breakBreakablesInCircle(x, y, radius, damage, time),
      breakBreakablesInRect: (ox, oy, dir, nearOffset, length, width, damage, time) =>
        this.breakBreakablesInRect(ox, oy, dir, nearOffset, length, width, damage, time),
      spawnExpandingRing: (x, y, radius, color, ms) => this.spawnExpandingRing(x, y, radius, color, ms),
      shakeOnce: (duration, intensity) => this.shakeOnce(duration, intensity),
      beginTimeStop: (owner, time, durationMs) => this.beginTimeStop(owner, time, durationMs)
    };
  }

  /**
   * 開始全場時停（時停招式回呼）：owner 以外的角色與所有敵人凍結 durationMs，
   * 敵人蓄力與場景層預警（塔 / BOSS）的 tween 一併暫停，解除時由 update() 補回凍結時間
   *
   * @param owner 施放者（時停期間唯一能行動的角色）
   * @param time 目前場景時間
   * @param durationMs 時停時長
   */
  private beginTimeStop(owner: Character, time: number, durationMs: number): void {
    this.timeStopped = true;
    this.timeStopUntil = time + durationMs;
    this.timeStopStartedAt = time;
    this.timeStopOwner = owner;
    for (const ch of this.enemies.getChildren()) (ch as Enemy).pauseChargeTweens(true);
    for (const fx of this.telegraphFx) fx.tween?.pause();
  }

  // 招式視覺占位特效
  private spawnExpandingRing(x: number, y: number, radius: number, color: number, ms = 300): void {
    const ring = this.add.circle(x, y, 10, color, 0.35).setDepth(20);
    ring.setStrokeStyle(4, color, 0.9);
    this.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration: ms,
      ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
  }

  // ---------------------------------------------------------------------------
  // 普攻
  // ---------------------------------------------------------------------------
  private performAttackOn(actor: Character, primary: Enemy, time: number): void {
    // 普攻命中半徑隨等級變大
    const emp = actor.isEmpowered(time);
    const hitRadius = GameConfig.player.attackHitRadius * (emp ? GameConfig.combo.empower.rangeMult : 1);
    const children = this.enemies.getChildren();
    const atk = this.curAttackDamage() * (emp ? GameConfig.combo.empower.damageMult : 1); // 隨等級 + 強化加成
    for (const child of children) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      const dist = Phaser.Math.Distance.Between(actor.x, actor.y, enemy.x, enemy.y);
      if (dist <= hitRadius || enemy === primary) {
        this.damageEnemy(actor, enemy, atk, GameConfig.player.knockback, time);
      }
    }
    // 衝撞命中(必中 primary) → combo/鬥氣累積
    this.onComboHit(actor, time);
    // 階段三：衝刺命中也觸發COMBO獎勵系統
    this.triggerComboHit(actor);

    this.flashWhite(actor);
    // 一般攻擊命中不再震動（只保留閃白/傷害數字/擊退）
    this.spawnSlashEffect(primary.x, primary.y);
    // 遠距衝撞命中的明顯衝擊特效
    this.spawnImpactEffect(primary.x, primary.y);
  }

  /** 衝撞命中衝擊特效：衝擊圈 + 命中點亮閃 */
  private spawnImpactEffect(x: number, y: number): void {
    const cfg = GameConfig.impact;
    const ring = this.add.circle(x, y, 8, cfg.ringColor, 0).setDepth(41);
    ring.setStrokeStyle(5, cfg.ringColor, 0.95);
    this.tweens.add({
      targets: ring,
      radius: cfg.ringRadius,
      alpha: 0,
      duration: cfg.ringMs,
      ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
    const core = this.add.circle(x, y, cfg.ringRadius * 0.35, cfg.coreColor, 0.9).setDepth(42);
    this.tweens.add({
      targets: core,
      alpha: 0,
      scale: 1.4,
      duration: cfg.ringMs * 0.7,
      onComplete: () => core.destroy()
    });
  }

  /** 原地扇形劍氣特效：朝 aimAngle 畫一個淡出扇形 */
  private spawnMeleeArcEffect(x: number, y: number, angle: number): void {
    const cfg = GameConfig.melee;
    const half = Phaser.Math.DegToRad(cfg.arcDeg) / 2;
    const g = this.add.graphics().setDepth(41);
    g.fillStyle(cfg.arcColor, cfg.arcAlpha);
    g.slice(x, y, cfg.radius, angle - half, angle + half, false);
    g.fillPath();
    // 外弧亮線
    g.lineStyle(3, cfg.arcColor, Math.min(1, cfg.arcAlpha + 0.4));
    g.beginPath();
    g.arc(x, y, cfg.radius, angle - half, angle + half);
    g.strokePath();
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: cfg.arcFadeMs,
      onComplete: () => g.destroy()
    });
  }

  // ---------------------------------------------------------------------------
  // 爆發連招
  // ---------------------------------------------------------------------------
  /**
   * 普攻命中一次的 combo/鬥氣累積。
   * P1：走連段系統（combo++、達 4/8/12 觸發已解鎖的圓形/直線/強化爆發、到 12 歸零）+ p1AttackHits 統計。
   * BOT：維持舊鬥氣（gainSpiritHit，滿了在 tryAct 觸發舊爆發）。
   */
  /** slow：combo 歸零門檻/上限 = 直線招式門檻。 */
  private slowComboCap(): number {
    const cfg = GameConfig.combo;
    return cfg.slowThresholds.line; // 8
  }

  private onComboHit(c: Character, time: number): void {
    // BOT 與 P1 無差異——連段技 combo 系統對所有角色生效(原本 BOT 只走舊 gainSpiritHit 只累積爆發鬥氣)。
    const isP1 = c === this.player;
    if (isP1) this.p1AttackHits++;
    const cfg = GameConfig.combo;

    // ── 慢速模式：COMBO 與能量【兩套獨立系統】，同一次命中兩條各 +1 ──
    if (this.controlMode === 'slow') {
      // 【A. COMBO(招式)】歸零門檻 cap = 目前【已解鎖最高階招】的門檻(無空白浪費、低階招頻繁觸發)。
      const cap = this.slowComboCap();
      c.spirit = Math.min(cap, c.spirit + 1);
      const combo = c.spirit;
      // 各招在自身門檻觸發：4圓/8氣波（爆發改為變身專屬，見 registerEmpowerAoeHit）
      if (combo === cfg.slowThresholds.circle) this.comboCircle(c, time);
      if (combo === cfg.slowThresholds.line) this.comboLine(c, time);
      // 達已解鎖最高招門檻(cap) → 該輪最高招已在上面觸發 → 歸零重來
      if (combo >= cap) c.spirit = 0;
      // 【B. 能量(強化)】能量改【擊殺獲得】(見 grantKillEnergy),此處【不再命中+1】。
      // 保留:被打中 -1(Character.takeDamage)、滿 trigger 改【按 Z 手動觸發】(見 tryManualEmpower),非自動。
      if (isP1) this.emitStats();
      return;
    }

    // ── 快速模式：一條 combo，3圓/6直/9爆發/10強化，到10歸零 ──
    c.spirit = Math.min(cfg.max, c.spirit + 1);
    const combo = c.spirit;
    if (combo === cfg.thresholds.circle) {
      this.comboCircle(c, time);
    }
    if (combo === cfg.thresholds.line) {
      this.comboLine(c, time);
    }
    if (combo === cfg.thresholds.burst) {
      this.triggerBurst(c, time);
    }
    if (combo >= cfg.thresholds.empower) {
      this.comboEmpower(c, time);
      c.spirit = 0;
    }
    if (isP1) this.emitStats();
  }

  /**
   * 【實驗性】進入招式「表演時間」:設 skillLockUntil = now + ms → 角色定身(fast衝刺/slow走位輸入全鎖)+無敵(isInvulnerable含skillLockUntil)。
   * enabled=false 直接跳過(整組拔掉→維持原本瞬發不鎖)。用 Math.max 避免縮短既有更長的鎖(如爆發連打)。
   */
  private enterPerformance(c: Character, ms: number, time: number): void {
    if (!GameConfig.performanceTime.enabled) return;
    c.skillLockUntil = Math.max(c.skillLockUntil, time + ms);
    c.stopMoving();
  }

  /** 能量增加(夾在 0~max);強化期間不加(純倒退)。slow 能量系統用。 */
  private gainEnergy(c: Character, amount: number): void {
    if (c.empowered) return; // 強化期間純倒退,不加
    const ecfg = GameConfig.energy;
    c.energy = Math.min(ecfg.max, c.energy + amount);
    if (c === this.player) this.emitStats();
  }

  /** 擊殺獲得能量——依怪種 perKill 表給量(未列用 default)。 */
  private grantKillEnergy(c: Character, etype: string): void {
    const ecfg = GameConfig.energy;
    const amount = ecfg.perKill[etype] ?? ecfg.perKill.default;
    this.gainEnergy(c, amount);
  }

  /** 按 Z 手動觸發強化(slow P1、能量滿 trigger、非強化中才可)。回傳是否觸發。 */
  private tryManualEmpower(): boolean {
    if (this.controlMode !== 'slow') return false;
    const c = this.player;
    const ecfg = GameConfig.energy;
    if (!c || !c.alive || c.empowered) return false;
    if (c.energy < ecfg.trigger) return false;
    this.comboEmpower(c, this.time.now);
    return true;
  }

  /**
   * 階段4(改):強化期唯一招——【用現有自動鎖定選目標→打攻擊過去→以目標為中心炸圓AOE】。
   * (a)沿用平常自動鎖定(this.lockedTarget / findNearestDamageableEnemy,同 searchRadius 範圍)選目標;無怪→不放(不進冷卻,可再按)。
   * (b)朝目標射出衝擊投射視覺(projSpeed);(c)到達目標→以【目標位置】為中心炸圓AOE(radius,縮小)傷周圍敵人。
   * 角色不位移(不衝刺)。
   */
  private empowerAoe(c: Character, time: number): void {
    const cfg = GameConfig.combo.empower.aoe;
    // AOE 鎖定【限角色圓圈(slow 藍圈 lockRadius)內、且只鎖敵人(徹底排除道具/非敵人)】。
    //   ①徹底排除道具:不直接用 this.lockedTarget(那可能是道具);改自己掃 this.enemies 只取【可傷敵人】。
    //   ②限圓圈:只考慮【距角色 ≤ lockRadius(藍圈半徑)】的敵人,圈外不鎖不打(不再用 searchRadius520)。
    //   優先鎖【當前自動鎖定目標(若它是圈內敵人)】以維持一致,否則圈內最近的敵人。
    const R = (this.controlMode === 'slow') ? this.slowTuning.lockRadius : GameConfig.lock.searchRadius;
    let target: Enemy | null = null;
    const cur = this.lockedTarget;
    // 當前鎖定目標:必須是敵人(非道具)、可傷、且在圓圈內才沿用
    if (cur && !this.isItem(cur)) {
      const e = cur as Enemy;
      if (typeof e.isVulnerable === 'function' && this.isLockableEnemy(e) &&
          Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y) <= R) {
        target = e;
      }
    }
    // 否則:掃圓圈內最近的【可傷敵人】(只敵人,絕不道具)
    if (!target) {
      let bestD = R * R;
      for (const child of this.enemies.getChildren()) {
        const e = child as Enemy;
        if (!e.active || e.dead || !e.isVulnerable()) continue; // isVulnerable 已排除 anchor/npc;敵人群本就無道具
        const dx = e.x - c.x, dy = e.y - c.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD) { bestD = d2; target = e; }
      }
    }
    if (!target || !target.active || target.dead) return; // 圓圈內無敵→不放(不進冷卻,可再按)
    c.nextAttackAllowedAt = time + cfg.cooldownMs; // 放了才進冷卻
    c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y); // 面向目標
    const tx = target.x, ty = target.y;
    // (b) 攻擊投射視覺:從角色飛向目標
    const proj = this.add.circle(c.x, c.y, 10, cfg.projColor, 0.95).setDepth(16);
    proj.setStrokeStyle(3, 0xffffff, 0.9);
    const dist = Phaser.Math.Distance.Between(c.x, c.y, tx, ty);
    const dur = Math.max(60, (dist / cfg.projSpeed) * 1000);
    this.tweens.add({
      targets: proj, x: tx, y: ty, duration: dur, ease: 'Quad.easeIn',
      onComplete: () => {
        proj.destroy();
        this.empowerAoeBurst(c, tx, ty, time); // (c) 目標處炸 AOE
      }
    });
  }

  /** 以(tx,ty)【目標位置】為中心炸圓 AOE——傷該圓內所有可傷敵人 + 擴張圈視覺 + 輕震。 */
  private empowerAoeBurst(c: Character, tx: number, ty: number, time: number): void {
    const cfg = GameConfig.combo.empower.aoe;
    const radius = cfg.radius;
    const dmg = cfg.damage * GameConfig.combo.empower.damageMult;
    this.spawnExpandingRing(tx, ty, radius, cfg.color, cfg.ringMs);
    this.spawnExpandingRing(tx, ty, radius * 0.6, 0xfff2a8, cfg.ringMs * 0.8);
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity * 0.5);
    let hitAny = false;
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(tx, ty, enemy.x, enemy.y) <= radius) {
        this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, tx, ty, time); // 以目標為爆心
        hitAny = true;
      }
    }
    if (hitAny) {
      this.triggerComboHit(c); // COMBO 獎勵：變身 AOE 命中算 1 下
      this.registerEmpowerAoeHit(c, time);
    }
  }

  /**
   * 慢速變身專屬爆發：記一次 AOE 命中，每滿 burstEveryAoeHits 次觸發一次爆發亂打（可重複）。
   *
   * @param c 施放 AOE 的角色
   * @param time 目前時間
   */
  private registerEmpowerAoeHit(c: Character, time: number): void {
    const cfg = GameConfig.combo;
    c.empowerAoeHits++;
    if (c.empowerAoeHits % cfg.empower.burstEveryAoeHits !== 0) return;
    if (c.isBursting) return;
    this.triggerBurst(c, time);
  }

  /** 連段①圓形範圍技（combo4, Lv3）：以角色為中心瞬發圓形 AOE + 擴張環（不鎖角色） */
  private comboCircle(c: Character, time: number): void {
    const cfg = GameConfig.combo.circle;
    const radius = cfg.radius;
    const dmg = cfg.damage * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1);
    this.spawnExpandingRing(c.x, c.y, radius, 0x00e5ff, 280);
    let hitAny = false;
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= radius) {
        this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, c.x, c.y, time);
        hitAny = true;
      }
    }
    if (hitAny) this.triggerComboHit(c); // COMBO 獎勵：連段技命中算 1 下
    this.breakBreakablesInCircle(c.x, c.y, radius, dmg, time); // 圓形斬掃到木箱也打破
    this.shakeOnce(80, 0.006);
    this.enterPerformance(c, GameConfig.performanceTime.circle, time); // 表演時間:定身無敵
  }

  /** 連段②直線範圍技（combo8, Lv6）：朝 aimAngle 瞬發直線矩形貫穿 */
  private comboLine(c: Character, time: number): void {
    const cfg = GameConfig.combo.line;
    const length = cfg.length;
    const width = cfg.width;
    const dmg = cfg.damage * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1);
    const dir = c.aimAngle;
    const ox = c.x;
    const oy = c.y;
    // 視覺：一道旋轉矩形斬擊帶
    const band = this.add
      .rectangle(ox + Math.cos(dir) * length / 2, oy + Math.sin(dir) * length / 2, length, width, 0xff4d6d, 0.4)
      .setRotation(dir)
      .setDepth(20);
    band.setStrokeStyle(2, 0xffccd5, 0.7);
    this.tweens.add({ targets: band, alpha: 0, duration: 300, onComplete: () => band.destroy() });
    let hitAny = false;
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, 0, length, width)) {
        this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, ox, oy, time);
        hitAny = true;
      }
    }
    if (hitAny) this.triggerComboHit(c); // COMBO 獎勵：連段技命中算 1 下
    this.breakBreakablesInRect(ox, oy, dir, 0, length, width, dmg, time); // 直線氣波掃到木箱也打破
    this.shakeOnce(80, 0.006);
    this.enterPerformance(c, GameConfig.performanceTime.line, time); // 表演時間:定身無敵
  }

  /**
   * 限時強化。fast：empowerUntil=time+durationMs(固定時間)、光環到時自清。
   * slow：empowered=true(能量驅動)、光環綁旗標，能量倒退到0(update)才解除。
   */
  private comboEmpower(c: Character, time: number): void {
    // BOT 也用能量驅動強化(slow)——slow 判定改成「模式=slow」(不再限 P1),BOT 在 slow 也走 empowered 旗標+能量倒退解除。
    const slow = this.controlMode === 'slow';
    if (slow) {
      if (c.empowered) return;
      c.empowered = true;
      c.empowerAoeHits = 0; // 變身專屬爆發計數：每次變身重新累積
    } else {
      c.empowerUntil = time + GameConfig.combo.empower.durationMs;
    }
    // 觸發瞬間演出
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
    this.spawnExpandingRing(c.x, c.y, 120, 0xffd700, 400);
    // 持續整段強化的金色光環（跟隨角色、脈動），強化解除時(empowered=false)自清。
    const aura = this.add.circle(c.x, c.y, GameConfig.player.radius + 16, 0xffd700, 0.22).setDepth(8);
    aura.setStrokeStyle(3, 0xffe066, 0.9);
    const pulse = this.tweens.add({
      targets: aura,
      scale: { from: 1, to: 1.25 },
      alpha: 0.12,
      duration: 400,
      yoyo: true,
      repeat: -1
    });
    // 每幀跟隨角色；強化結束(fast:empowerUntil過期 / slow:empowered=false / 角色死)自清
    const follow = this.time.addEvent({
      delay: 16,
      loop: true,
      callback: () => {
        if (!c.isEmpowered(this.time.now) || !c.alive) {
          pulse.remove();
          follow.remove();
          aura.destroy();
          return;
        }
        aura.setPosition(c.x, c.y);
      }
    });
    if (c === this.player) this.game.events.emit('empower-start', {});
    this.emitStats();
  }

  private triggerBurst(c: Character, time: number): void {
    c.isBursting = true;
    if (GameConfig.burst.invuln) {
      c.invulnUntil = time + GameConfig.burst.hits * GameConfig.burst.intervalMs + 300;
    }
    // 表演時間:爆發鎖定+無敵延長到 performanceTime.burst(如2秒)——連打(~880ms)結束後仍站著定身無敵至2秒。
    this.enterPerformance(c, GameConfig.performanceTime.burst, time);
    c.stopMoving();

    if (c === this.player) {
      this.game.events.emit('burst-start');
    }
    // 只有爆發時震動，且同時間最多一個（guarded）
    this.shakeOnce(
      GameConfig.juice.burstShakeDuration,
      GameConfig.juice.burstShakeIntensity
    );

    let hitCount = 0;
    let comboCounted = false; // COMBO 獎勵：爆發整招只算 1 下（第一次有段命中時計入）
    const burstTimer = this.time.addEvent({
      delay: GameConfig.burst.intervalMs,
      repeat: GameConfig.burst.hits - 1,
      callback: () => {
        if (this.burstTick(c) && !comboCounted) {
          comboCounted = true;
          this.triggerComboHit(c);
        }
        hitCount++;
        if (hitCount >= GameConfig.burst.hits) this.endBurst(c);
      }
    });

    this.time.delayedCall(
      GameConfig.burst.hits * GameConfig.burst.intervalMs + 500,
      () => {
        if (c.isBursting) {
          burstTimer.remove(false);
          this.endBurst(c);
        }
      }
    );
  }

  /** 爆發的單段攻擊。@returns 這段是否命中至少一隻敵人 */
  private burstTick(c: Character): boolean {
    if (this.gameOver || !c.alive) return false;
    const time = this.time.now;
    const radius = GameConfig.burst.radius;
    const children = this.enemies.getChildren();
    let hitAny = false;
    for (const child of children) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      const dist = Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y);
      if (dist <= radius) {
        this.damageEnemy(c, enemy, GameConfig.burst.damagePerHit, GameConfig.burst.knockback, time);
        hitAny = true;
      }
    }
    this.breakBreakablesInCircle(c.x, c.y, radius, GameConfig.burst.damagePerHit, time); // 爆發掃到木箱也打破
    // 這段有打中敵人 → 觸發極短 hitstop（破頓）+ 命中閃白/小震動強化打擊感
    // hitstop=physics.world.pause() 全域暫停物理(含P1)→只在【施放者=P1】時觸發,
    //   否則 BOT 爆發的 hitstop 會反覆 pause 物理把 P1 也凍住(=「BOT爆發停P1」bug)。
    //   P1 自己爆發時本在定身表演中,hitstop 只給 P1 打擊手感、不影響操控。閃白/震動維持(純視覺)。
    if (hitAny) {
      if (c === this.player) this.triggerHitstop(GameConfig.burst.hitstopMs);
      this.flashWhite(c);
      this.shakeOnce(60, 0.006);
    }
    const ox = Phaser.Math.Between(-radius / 2, radius / 2);
    const oy = Phaser.Math.Between(-radius / 2, radius / 2);
    this.spawnSlashEffect(c.x + ox, c.y + oy);
    return hitAny;
  }

  /**
   * 極短命中頓感（hitstop）——短暫暫停物理世界(敵人/位移凝滯)，用真實時鐘(setTimeout)恢復，
   * 不動 time.timeScale（避免拖慢爆發本身的 delayedCall 節奏），不會卡死。重疊呼叫只延長恢復時間。
   */
  private hitstopRestoreAt = 0;
  private hitstopActive = false;
  private triggerHitstop(ms: number): void {
    if (ms <= 0 || this.gameOver) return;
    if (!this.hitstopActive) {
      this.hitstopActive = true;
      this.physics.world.pause();
    }
    const until = Date.now() + ms;
    if (until > this.hitstopRestoreAt) this.hitstopRestoreAt = until;
    const restore = (): void => {
      const remain = this.hitstopRestoreAt - Date.now();
      if (remain > 0) {
        setTimeout(restore, remain);
        return;
      }
      try {
        if (this.hitstopActive && this.physics && this.physics.world) {
          this.physics.world.resume();
        }
      } catch (_e) {
        /* scene 可能已停用，忽略 */
      }
      this.hitstopActive = false;
    };
    setTimeout(restore, ms);
  }

  private endBurst(c: Character): void {
    if (!c.isBursting) return;
    c.isBursting = false;
    // P1 的 combo 由 onComboHit 管理(到10才歸零)，爆發(combo9)結束不可清 combo，
    // 否則永遠到不了 combo10 的限時強化。只有 BOT(舊鬥氣爆發)在此歸零。
    if (c !== this.player) c.spirit = 0;
    c.stopMoving();
    if (c === this.player) this.game.events.emit('burst-end');
  }

  // ---------------------------------------------------------------------------
  // 傷害 / 擊殺
  // ---------------------------------------------------------------------------
  /**
   * 角色對敵人造成傷害，擊退方向以角色位置為準（見 damageEnemyFrom）
   */
  private damageEnemy(actor: Character, enemy: Enemy, damage: number, knockback: number, time: number): void {
    this.damageEnemyFrom(actor, enemy, damage, knockback, actor.x, actor.y, time);
  }

  /**
   * 角色對敵人造成傷害並結算擊殺；擊退、盾怪正面減傷都以 (fromX, fromY) 為來源（AOE 招式傳落點，近戰傳角色位置）。
   *
   * - 已死亡 / 失效的敵人不再受理，避免同一幀重複命中；寶箱怪改走命中次數制
   * - 被打中的怪標記為主動仇恨，不受被動追擊上限限制
   * - 打中 BOSS：交給 BossController（噴道具、亂入 BOSS 掉彩票）；慢速模式下有機率給 P1 能量
   * - 擊殺：BOSS → BossController；塔 → 事件完成；NPC / 錨點不會被打死（防呆）；
   *   一般怪 → 計擊殺、推進關卡、慢速模式給 P1 能量（不論是誰擊殺）、機率掉道具
   * - COMBO 與鬥氣由攻擊動作本身累積，這裡不處理
   *
   * @param actor 攻擊的角色
   * @param enemy 被打的敵人
   * @param damage 基礎傷害
   * @param knockback 擊退力道
   * @param fromX 傷害來源 x
   * @param fromY 傷害來源 y
   * @param time 目前場景時間
   */
  private damageEnemyFrom(
    actor: Character, enemy: Enemy, damage: number, knockback: number, fromX: number, fromY: number, time: number
  ): void {
    if (enemy.dead || !enemy.active) return;
    if (enemy.enemyType === 'treasure') { this.hitTreasure(enemy); return; }
    const dmg = Math.max(1, Math.round(damage * enemy.damageMultiplierFrom(fromX, fromY)));
    enemy.aggroActive = true;
    const dead = enemy.takeDamage(dmg);
    if (enemy.isBoss) {
      this.bossCtl.onBossHit(actor, enemy, dmg, time);
      if (this.controlMode === 'slow' && !enemy.dead) {
        const ecfg = GameConfig.energy;
        if (!this.player.empowered && Math.random() < ecfg.bossHitChance) this.gainEnergy(this.player, ecfg.bossHitAmount);
      }
    }
    enemy.applyKnockback(fromX, fromY, knockback, time);
    this.spawnDamageText(enemy.x, enemy.y, dmg);
    this.flashEnemy(enemy);
    // 擊殺只結算一次：takeDamage 判定死亡、且尚未被標記 dead 的才處理
    if (!dead || enemy.dead) return;
    const dx = enemy.x, dy = enemy.y;
    const wasBoss = enemy.isBoss;
    const etype = enemy.enemyType;
    enemy.kill();
    if (wasBoss) {
      actor.kills++;
      this.bossCtl.onBossKilled(dx, dy); // 大爆炸 + 掉落（波次 BOSS 再回呼 onWaveBossDefeated）
    } else if (etype === 'tower') {
      this.tower = null;
      this.clearTelegraphsOf('tower'); // 取消塔蓄力中的扇形預警
      this.spawnExpandingRing(dx, dy, 120, 0xff8844, 400);
      this.completeEvent(true);
    } else if (etype !== 'npc' && etype !== 'anchor') {
      actor.kills++;
      this.onWaveKill();
      this.spawnDeathBurst(dx, dy);
      if (this.controlMode === 'slow') this.grantKillEnergy(this.player, etype);
      if (Math.random() < GameConfig.items.dropChance) this.dropItemAt(dx, dy, time);
    }
  }

  // ---------------------------------------------------------------------------
  // 打擊感 / 特效
  // ---------------------------------------------------------------------------
  /**
   * 螢幕震動：同時間最多一個。若鏡頭已在震動則忽略新的（不疊加）。
   * 目前僅爆發連招會呼叫此函式；一般命中不再震動。
   */
  private shakeOnce(duration: number, intensity: number): void {
    const fx = this.cameras.main;
    // Phaser 的 shake effect 有 isRunning 旗標；正在震動就不再疊加
    if (fx.shakeEffect && fx.shakeEffect.isRunning) return;
    fx.shake(duration, intensity);
  }

  private flashWhite(c: Character): void {
    c.setTintFill(0xffffff);
    this.time.delayedCall(GameConfig.juice.flashMs, () => {
      if (c.active && c.alive) c.clearTint();
    });
  }

  private flashHurt(c: Character): void {
    c.setTint(0xff4444);
    this.time.delayedCall(120, () => {
      if (c.active && c.alive) c.clearTint();
    });
  }

  private flashEnemy(enemy: Enemy): void {
    enemy.setTintFill(0xffffff);
    this.time.delayedCall(GameConfig.juice.flashMs, () => {
      if (enemy.active) enemy.clearTint();
    });
  }

  private spawnDamageText(x: number, y: number, amount: number): void {
    // 節流：特效已達上限就略過視覺（傷害/計殺不受影響）
    if (this.activeFxCount >= GameConfig.juice.maxActiveFx) return;
    this.activeFxCount++;
    const text = this.add
      .text(x, y - 10, `${amount}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffe66d',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(50);
    this.tweens.add({
      targets: text,
      y: y - 48,
      alpha: 0,
      duration: GameConfig.juice.damageTextMs,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        text.destroy();
        this.activeFxCount--;
      }
    });
  }

  private spawnSlashEffect(x: number, y: number): void {
    const ring = this.add.circle(x, y, 6, 0xffffff, 0.9).setDepth(40);
    this.tweens.add({
      targets: ring,
      radius: 42,
      alpha: 0,
      duration: 200,
      ease: 'Cubic.easeOut',
      onUpdate: () => ring.setRadius(ring.radius),
      onComplete: () => ring.destroy()
    });
  }

  private spawnDeathBurst(x: number, y: number): void {
    // 節流：特效已達上限就略過死亡粒子（計殺/掉落不受影響）
    if (this.activeFxCount >= GameConfig.juice.maxActiveFx) return;
    this.activeFxCount++;
    const emitter = this.add.particles(x, y, 'spark', {
      speed: { min: 60, max: 220 },
      angle: { min: 0, max: 360 },
      scale: { start: 1, end: 0 },
      lifespan: 300,
      quantity: GameConfig.juice.deathBurstParticles,
      tint: 0xff5a6e
    });
    emitter.setDepth(45);
    this.time.delayedCall(320, () => {
      emitter.destroy();
      this.activeFxCount--;
    });
  }

  // ---------------------------------------------------------------------------
  // 遊戲結束（全滅）
  // ---------------------------------------------------------------------------
  private triggerGameOver(): void {
    this.gameOver = true;
    // 確保 hitstop 沒把物理留在暫停狀態
    if (this.hitstopActive) {
      try { this.physics.world.resume(); } catch (_e) { /* ignore */ }
      this.hitstopActive = false;
    }
    for (const c of this.characters) c.stopMoving();

    const stats = {
      teamKills: this.teamKills(),
      perKills: this.characters.map((c) => c.kills),
      labels: GameConfig.characters.labels.slice(0, this.characters.length),
      survivalMs: this.survivalMs,
      // 第8項：本場 P1 普攻總命中次數
      p1AttackHits: this.p1AttackHits,
      controlMode: this.controlMode // 重開保留模式
    };

    this.scene.stop('UIScene');
    this.scene.launch('GameOverScene', stats);
    // 根因修復③：改用 stop 而非 pause —— paused 的 GameScene 其 SPACE 攻擊鍵監聽仍活著會搶結算畫面的 SPACE。
    // 停場景前先清掉殘留 tween/timer，避免它們在物件被銷毀後回呼造成 glTexture null 之類的錯誤。
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.stop();
  }

  private teamKills(): number {
    return this.characters.reduce((n, c) => n + c.kills, 0);
  }

  // ---------------------------------------------------------------------------

  /** 難度成長：目前等級對應的敵人生成量上限 */
  /** 怪量隨場上存活角色數縮放（1人0.4 → 4人1.0） */
  private curAliveScale(): number {
    const n = this.aliveCount();
    const cfg = GameConfig.spawn.aliveScale;
    return Phaser.Math.Clamp(cfg.base + (n - 1) * cfg.perAlive, cfg.base, 1);
  }

  private curMaxAlive(): number {
    // aliveScale 縮放，移除等級成長
    let cap = Math.max(1, Math.round(GameConfig.spawn.maxAlive * this.curAliveScale()));
    // 單人存活時再套硬上限（多人不受影響）
    if (this.aliveCount() === 1) cap = Math.min(cap, GameConfig.spawn.soloMaxAliveCap);
    return cap;
  }

  /** 角色普攻傷害 */
  private curAttackDamage(): number {
    return GameConfig.player.attackDamage;
  }

  /** 除錯/自動化測試用：立即讓所有角色陣亡以觸發結算（不影響正常玩法） */
  debugForceGameOver(): void {
    if (this.gameOver) return;
    for (const c of this.characters) {
      c.hp = 0;
      if (c.alive) c.die();
    }
    this.triggerGameOver();
  }

  /** 除錯/自動化測試用：對 P1 觸發指定招式（不影響正常玩法） */
  debugTriggerSkill(skill: 'A' | 'B' | 'C' | 'E' | 'T'): void {
    if (this.gameOver || !this.player.alive) return;
    this.skillCtl.cast(this.player, skill, this.time.now);
  }

  /** 除錯：回傳目前關鍵狀態 */
  debugState(): Record<string, unknown> {
    return {
      gameOver: this.gameOver,
      timeStopped: this.timeStopped,
      p1SkillLocked: this.player ? this.player.isSkillLocked(this.time.now) : null,
      p1Invuln: this.player ? this.player.isInvulnerable(this.time.now) : null,
      enemyCount: this.enemies ? this.enemies.countActive(true) : null,
      maxAlive: this.curMaxAlive(),
      activeFxCount: this.activeFxCount,
      attackDamage: Math.round(this.curAttackDamage()),
      p1AttackHits: this.p1AttackHits,
      wave: this.currentWave,
      waveKilled: this.waveKilled,
      waveQuota: this.waveQuota,
      waveSpawned: this.waveSpawned,
      waveState: this.waveState,
      combo: this.player.spirit,
      energy: this.player.energy,
      p1Empowered: this.player.isEmpowered(this.time.now)
    };
  }

  /** 除錯：對 P1 施放補血（測 heal） */
  debugHealP1(): { before: number; after: number } {
    const before = this.player.hp;
    this.applyHeal(this.player);
    return { before, after: this.player.hp };
  }

  /** 除錯：直接生成一隻 BOSS（測 BOSS 戰/血條） */
  debugSpawnBoss(): void {
    this.waveState = 'boss';
    this.bossCtl.spawn();
  }

  /** 除錯：直接生成一隻限時亂入 BOSS（測亂入計時 / 命中掉彩票 / 離場） */
  debugSpawnIntruderBoss(): void {
    if (!this.bossCtl.current) this.bossCtl.spawn(true);
  }

  /** 除錯：直接施放 BOSS 指定招式（a/b/c）——需先有 BOSS 在場 */
  debugBossSkill(kind: BossSkillKind): void {
    this.bossCtl.debugCast(kind);
  }

  /** 除錯：暫停/恢復 BOSS 自動輪替招式（隔離單招測試用） */
  debugPauseBossSkills(v: boolean): void {
    this.bossCtl.debugPauseSkills(v);
  }

  /** 除錯：設定當前波次（測波次/BOSS 觸發） */
  debugSetWave(n: number): void {
    this.currentWave = Math.max(1, Math.floor(n));
    this.waveQuota = this.computeWaveQuota(this.currentWave);
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.waveState = 'spawning';
    this.emitStats();
  }

  /** 除錯：直接觸發指定事件（測塔/守護/佔領） */
  debugTriggerEvent(kind: 'tower' | 'guard' | 'capture'): void {
    this.waveState = 'event';
    this.startEvent(kind);
    this.emitStats();
  }

  /** 除錯：可打破物件狀態(數量 + 位置 + 種類)。 */
  debugBreakables(): Record<string, unknown> {
    const list = this.breakables.getChildren().filter((c) => (c as Breakable).active).map((c) => {
      const bk = c as Breakable;
      return { x: Math.round(bk.x), y: Math.round(bk.y), hp: bk.hp, kind: bk.kind };
    });
    return { count: list.length, barrels: list.filter((b) => b.kind === 'barrel').length, list };
  }

  /** 除錯：在指定點(相對玩家偏移)生一個可打破物件(kind 'crate'|'barrel')，回傳其索引。 */
  debugSpawnBreakableAt(dx: number, dy: number, kind: 'crate' | 'barrel' = 'crate'): number {
    const x = this.player.x + dx, y = this.player.y + dy;
    const bk = this.breakables.get(x, y) as Breakable | null;
    if (!bk) return -1;
    bk.spawnBreakable(x, y, kind);
    return this.breakables.getChildren().indexOf(bk);
  }

  /** 除錯：回傳事件狀態 */
  debugEventState(): Record<string, unknown> {
    return {
      waveState: this.waveState,
      eventKind: this.eventKind,
      towerHp: this.tower ? this.tower.hp : null,
      npcHp: this.guardNpc ? this.guardNpc.hp : null,
      guardRemainMs: this.guardNpc ? Math.max(0, this.guardEndsAt - this.time.now) : null,
      captureProgress: Math.round(this.captureProgress)
    };
  }

  /** 除錯：壓力測試——在 P1 周圍密集生成 n 隻已實體化(可傷)的一般怪 */
  debugStressSpawn(n: number): number {
    const now = this.time.now;
    let made = 0;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = 40 + Math.random() * 160;
      const x = Phaser.Math.Clamp(this.player.x + Math.cos(ang) * rad, this.arena.left + 20, this.arena.right - 20);
      const y = Phaser.Math.Clamp(this.player.y + Math.sin(ang) * rad, this.arena.top + 20, this.arena.bottom - 20);
      const e = this.enemies.get(x, y) as Enemy | null;
      if (!e) break;
      e.onAttackFire = this.onEnemyAttackFire;
      e.onAttackFire = this.onEnemyAttackFire;
      e.onShoot = this.onEnemyShoot;
      e.onLaserFire = this.onEnemyLaserFire;
      e.onBombThrow = this.onEnemyBombThrow;
      e.spawn(x, y, now, 'normal', 1);
      // 立即實體化(跳過登場提示)，讓時停能吃到、可測結算負載
      (e as unknown as { telegraphing: boolean }).telegraphing = false;
      (e.body as Phaser.Physics.Arcade.Body).enable = true;
      e.setAlpha(1);
      made++;
    }
    return made;
  }

  /** 除錯：在指定點掉一個道具（測鎖定/衝去撿） */
  debugDropItem(x: number, y: number): void {
    this.dropItemAt(x, y, this.time.now);
  }

  /** 除錯：清空所有敵人，並在距 P1 指定距離處生一隻已實體化的一般怪，回傳其索引狀態 */
  debugSpawnProbeAt(distFromP1: number): void {
    for (const ch of this.enemies.getChildren()) {
      const e = ch as Enemy;
      if (e.active) e.kill();
    }
    const now = this.time.now;
    const x = Phaser.Math.Clamp(this.player.x + distFromP1, this.arena.left + 30, this.arena.right - 30);
    const y = this.player.y;
    const e = this.enemies.get(x, y) as Enemy | null;
    if (!e) return;
    e.onAttackFire = this.onEnemyAttackFire;
    e.onShoot = this.onEnemyShoot;
    e.onLaserFire = this.onEnemyLaserFire;
    e.onBombThrow = this.onEnemyBombThrow;
    e.spawn(x, y, now, 'normal', 1);
    (e as unknown as { telegraphing: boolean }).telegraphing = false;
    (e.body as Phaser.Physics.Arcade.Body).enable = true;
    e.setAlpha(1);
  }

  /** 除錯：在距 P1 指定距離生一隻指定 type 的已實體化敵人（測 shooter 雷射等） */
  debugSpawnType(type: EnemyType, distFromP1: number): void {
    const now = this.time.now;
    const x = Phaser.Math.Clamp(this.player.x + distFromP1, this.arena.left + 30, this.arena.right - 30);
    const y = this.player.y;
    const e = this.enemies.get(x, y) as Enemy | null;
    if (!e) return;
    e.onAttackFire = this.onEnemyAttackFire;
    e.onShoot = this.onEnemyShoot;
    e.onLaserFire = this.onEnemyLaserFire;
    e.onBombThrow = this.onEnemyBombThrow;
    e.spawn(x, y, now, type, 1);
    (e as unknown as { telegraphing: boolean }).telegraphing = false;
    (e.body as Phaser.Physics.Arcade.Body).enable = true;
    e.setAlpha(1);
  }

  /** 除錯：回傳第一隻活著敵人的 AI 狀態 + 到 P1 距離 */
  debugProbeState(): Record<string, unknown> {
    for (const ch of this.enemies.getChildren()) {
      const e = ch as Enemy;
      if (e.active && !e.dead) {
        return {
          aiState: e.getAiState(),
          distToP1: Math.round(Phaser.Math.Distance.Between(e.x, e.y, this.player.x, this.player.y)),
          ex: Math.round(e.x)
        };
      }
    }
    return { aiState: 'none' };
  }

  /** 除錯：施放居合並回傳起點；供測試比對結束後是否回到起點附近 */
  debugIaidoStart(): { x: number; y: number } {
    const p = this.player;
    this.skillCtl.cast(p, 'C', this.time.now);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  }

  debugP1Pos(): { x: number; y: number } {
    return { x: Math.round(this.player.x), y: Math.round(this.player.y) };
  }

  /** 除錯：模擬滑鼠指向某點（設 aimAngle + 標記活躍），用來測鎖定評分 */
  debugAimToward(x: number, y: number): void {
    this.player.aimAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, x, y);
    this.lastPointerMoveAt = this.time.now;
  }

  /** 除錯：加一個 BOT（同 B 鍵） */
  debugAddBot(): void {
    this.tryAddBot();
  }

  /** 除錯：在 BOT(index) 附近 offset 掉道具，立刻回報 pickBotTarget 是否選中該道具 */
  debugBotWouldGrabItem(index: number, offset = 40): boolean {
    const bot = this.characters[index];
    if (!bot) return false;
    this.dropItemAt(bot.x + offset, bot.y + offset, this.time.now);
    const t = this.pickBotTarget(bot);
    return t instanceof Item;
  }

  /**
   * 除錯：測擊殺原子性——挑一隻可傷敵人，把 HP 設到很低，讓兩個角色「同幀」各打一次致命傷，
   * 回報：kill 前後 team 擊殺數變化、道具數變化、該敵 dead 旗標。應只 +1 kill、最多掉 1 個道具。
   */
  debugSimulSameFrameKill(): Record<string, unknown> {
    // 確保有 2 個角色
    while (this.characters.length < 2) this.tryAddBot();
    const a = this.characters[0];
    const b = this.characters[1];
    // 找一隻可傷敵人
    let target: Enemy | null = null;
    for (const ch of this.enemies.getChildren()) {
      const e = ch as Enemy;
      if (e.active && e.isVulnerable() && !e.dead) { target = e; break; }
    }
    if (!target) return { error: 'no enemy' };
    target.hp = 5; // 兩擊都會致命
    const killsBefore = this.teamKills();
    const itemsBefore = this.items.countActive(true);
    const now = this.time.now;
    // 同幀兩個致命命中（大傷害）
    this.damageEnemy(a, target, 9999, 0, now);
    this.damageEnemy(b, target, 9999, 0, now);
    return {
      killsBefore,
      killsAfter: this.teamKills(),
      killDelta: this.teamKills() - killsBefore,
      itemsBefore,
      itemsAfter: this.items.countActive(true),
      itemDelta: this.items.countActive(true) - itemsBefore,
      enemyDead: target.dead
    };
  }

  /** 除錯：回傳各角色鎖定/位置 + 道具狀態（測互搶/多色點） */
  debugCharsLock(): Record<string, unknown> {
    const items = this.items
      ? this.items.getChildren().map((ch) => {
          const it = ch as Item;
          return { skill: it.skill, taken: it.taken, active: it.active, x: Math.round(it.x), y: Math.round(it.y) };
        })
      : [];
    return {
      chars: this.characters.map((c) => ({
        index: c.index,
        alive: c.alive,
        x: Math.round(c.x),
        y: Math.round(c.y),
        lockIsItem: c.lockedTarget instanceof Item,
        hasLock: !!c.lockedTarget,
        dashToItem: c.dashToItem,
        spirit: c.spirit
      })),
      items,
      itemsAlive: this.items ? this.items.countActive(true) : 0
    };
  }

  /** 除錯：回傳目前鎖定狀態（是否鎖到道具） */
  debugLockInfo(): Record<string, unknown> {
    const t = this.lockedTarget;
    return {
      hasLock: !!t,
      lockIsItem: this.isItem(t),
      lockX: t ? Math.round(t.x) : null,
      lockY: t ? Math.round(t.y) : null,
      itemsAlive: this.items ? this.items.countActive(true) : null,
      p1Dashing: this.player ? this.player.isDashing : null,
      p1DashToItem: this.player ? this.player.dashToItem : null,
      p1x: this.player ? Math.round(this.player.x) : null,
      p1y: this.player ? Math.round(this.player.y) : null
    };
  }

  // ---------------------------------------------------------------------------
  // UI 同步
  // ---------------------------------------------------------------------------
  private emitAim(): void {
    if (!this.player.alive) {
      this.game.events.emit('aim', { alive: false, x: 0, y: 0, angle: 0, dashDistance: 0, showDashLine: false });
      return;
    }
    // 指示線方向若有鎖定目標（敵人或道具）則指向目標，否則沿用瞄準角
    let ang = this.player.aimAngle;
    if (this.isLockValid(this.lockedTarget)) {
      ang = Phaser.Math.Angle.Between(
        this.player.x,
        this.player.y,
        this.lockedTarget!.x,
        this.lockedTarget!.y
      );
    }
    this.game.events.emit('aim', {
      alive: true,
      x: this.player.x,
      y: this.player.y,
      angle: ang,
      dashDistance: GameConfig.aim.dashDistance,
      // slow 模式不畫「衝刺距離延長指示線」(用戶要拿掉那條延長瞄準線)；fast 維持顯示。
      showDashLine: this.controlMode !== 'slow'
    });
  }

  /**
   * 階段三：觸發COMBO命中獎勵系統
   *
   * 計數規則：每一次「出手」命中至少一隻敵人 → COMBO +1（打中幾隻都只算 1，擊殺不另外加）
   * - 普攻揮擊、衝刺撞擊、連段技（圓/直線）、變身 AOE 各算 1 下
   * - 爆發整招算 1 下
   *
   * @param actor 執行命中的角色
   */
  private triggerComboHit(actor: any): void {
    const currentTime = this.time.now;
    const combo = actor.comboState;
    
    // 更新連擊數和時間
    combo.currentStreak++;
    combo.lastKillTime = currentTime;  // 沿用lastKillTime變數名，但實際記錄lastHitTime
    combo.isWarning = false; // 重置警告狀態
    
    // 檢查是否達到獎勵里程碑
    this.checkAndGrantComboReward(actor);
  }

  /**
   * 階段三：檢查並發放COMBO獎勵
   *
   * 當角色連擊數達到配置的里程碑時自動發放票券獎勵
   *
   * 獎勵計算邏輯：
   * - 遍歷所有里程碑(5, 10, 20, 50, 100連擊)
   * - 如果當前連擊數 === 里程碑值 → 觸發獎勵
   * - 發放對應票券數量(1, 3, 10, 50, 100張)
   * - 更新下個目標里程碑
   * - 播放獎勵特效和音效
   *
   * 防重複機制：只在連擊數剛好等於里程碑時觸發一次
   * 最後一階（上限，100 連擊）：立即發獎並歸零重新累積，不等中斷
   *
   * @param actor 觸發獎勵的角色對象
   */
  private checkAndGrantComboReward(actor: any): void {
    const combo = actor.comboState;
    const config = GameConfig.comboReward;
    const lastIndex = config.MILESTONES.length - 1;

    // 達上限：立即發最高階獎勵並歸零（較低階的待發獎勵被最高階取代）
    if (combo.currentStreak >= config.MILESTONES[lastIndex]) {
      this.grantComboReward(actor, config.REWARDS[lastIndex], config.MILESTONES[lastIndex]);
      this.resetComboStreak(combo);
      return;
    }
    
    // 檢查是否達到任何里程碑
    for (let i = 0; i < config.MILESTONES.length; i++) {
      if (combo.currentStreak === config.MILESTONES[i]) {
        // 修復觸發邏輯：標記達到里程碑，但暫不觸發獎勵
        combo.pendingRewardIndex = i;
        combo.pendingRewardTickets = config.REWARDS[i];
        combo.pendingRewardMilestone = config.MILESTONES[i];
        
        // 更新下個里程碑目標
        combo.nextMilestone = i + 1 < config.MILESTONES.length ? 
          config.MILESTONES[i + 1] : 
          config.MILESTONES[config.MILESTONES.length - 1];
        
        break;
      }
    }
  }

  /**
   * 發放 COMBO 獎勵：票券加到該角色的 Credit，並在下方面板播放彩票噴發與獲得文字
   *
   * @param actor 獲得獎勵的角色
   * @param tickets 票券數量
   * @param milestone 達成的里程碑（連擊數，影響彩票噴發數量/速度）
   */
  private grantComboReward(actor: any, tickets: number, milestone: number): void {
    const combo = actor.comboState;
    combo.ticketsEarned += tickets;
    actor.credit += tickets; // 同步更新Credit顯示
    const uiScene = this.scene.get('UIScene') as any;
    if (uiScene?.playComboRewardFx) {
      uiScene.playComboRewardFx(actor.index, tickets, milestone);
    } else {
      console.error('❌ UIScene.playComboRewardFx 不存在，COMBO 獎勵特效無法播放');
    }
  }

  /**
   * COMBO 歸零：清除連擊數、警告狀態與待發獎勵，下個目標回到第一個里程碑
   *
   * @param combo 角色的 comboState
   */
  private resetComboStreak(combo: any): void {
    combo.currentStreak = 0;
    combo.isWarning = false;
    combo.nextMilestone = GameConfig.comboReward.MILESTONES[0];
    combo.pendingRewardIndex = undefined;
    combo.pendingRewardTickets = undefined;
    combo.pendingRewardMilestone = undefined;
  }
  
  /**
   * 階段三：更新所有角色的COMBO計時系統
   *
   * 實現基於時機視窗的連擊重置機制：
   * - 正常期：連擊持續累積，UI顯示綠色
   * - 警告期(1.5-2秒)：UI閃爍橙色/紅色，提醒玩家時間緊迫
   * - 超時重置(>2秒)：連擊歸零，重回起始狀態
   *
   * 算法說明：
   * 1. 計算每個角色的 timeSinceLastKill = currentTime - lastKillTime
   * 2. 如果 timeSinceLastKill >= STREAK_TIMEOUT_MS → 重置連擊
   * 3. 如果 timeSinceLastKill >= WARNING_START_MS → 進入警告狀態
   * 4. 警告狀態觸發UI閃爍動畫，增強緊迫感
   *
   * 在Phaser.update()中每幀調用，確保即時響應玩家操作
   */
  private updateComboTimers(): void {
    const currentTime = this.time.now;
    const config = GameConfig.comboReward;
    
    for (const character of this.characters) {
      const combo = character.comboState;
      
      if (combo.currentStreak > 0) {
        const timeSinceLastKill = currentTime - combo.lastKillTime;
        
        if (timeSinceLastKill >= config.STREAK_TIMEOUT_MS) {
          // 修復邏輯：COMBO中斷前先觸發待處理的獎勵
          if (combo.pendingRewardTickets !== undefined && combo.pendingRewardTickets > 0) {
            this.grantComboReward(character, combo.pendingRewardTickets, combo.pendingRewardMilestone!);
          }
          // 超時：重置COMBO到初始狀態
          this.resetComboStreak(combo);
        } else if (timeSinceLastKill >= config.WARNING_START_MS) {
          // 進入警告期：觸發UI閃爍提醒
          combo.isWarning = true;
        } else {
          // 正常狀態：保持UI穩定顯示
          combo.isWarning = false;
        }
      }
    }
  }

  private emitStats(): void {
    this.game.events.emit('stats', {
      chars: this.characters.map((c) => ({
        label: GameConfig.characters.labels[c.index],
        color: GameConfig.characters.colors[c.index],
        hp: c.hp,
        maxHp: GameConfig.player.maxHp,
        spirit: c.spirit,
        maxSpirit: GameConfig.spirit.hitsToBurst,
        kills: c.kills,
        alive: c.alive,
        isPlayer: c.index === 0,
        // 頭上UI修復：添加角色世界座標
        x: c.x,
        y: c.y,
        // 階段二：Credit點數
        credit: c.credit,
        // 階段三：COMBO獎勵系統狀態
        combo: { ...c.comboState }  // 淺拷貝避免引用問題
      })),
      teamKills: this.teamKills(),
      survivalMs: this.survivalMs,
      playerBurstReady: this.player.alive && this.player.spiritFull,
      count: this.characters.length,
      maxCount: GameConfig.characters.count,
      // 第8項：P1 普攻累計命中次數
      p1AttackHits: this.p1AttackHits,
      // 波次制
      wave: this.currentWave,
      waveKilled: this.waveKilled,
      waveQuota: this.waveQuota,
      waveState: this.waveState,
      // 波次進度 HUD 用:關卡制當前子區進度(只純波次顯示;事件/BOSS/非 levelMode 隱藏)
      levelMode: this.levelMode,
      currentLevel: this.currentLevel,
      currentSub: this.currentSub,
      // 小關卡卷軸 HUD：目前關卡編號、擊殺進度、本關與後續關卡的寶箱階級
      stage: this.currentStage,
      stageKilled: this.stageInProgress ? this.waveKilled : 0,
      stageQuota: this.waveQuota,
      stageChests: this.stageQueue.map(displayKindOf),
      subWavesDone: this.subWavesDone,
      subWavesTarget: this.subWavesTarget,
      progressPhase: this.progressPhase,
      crossingOpen: this.crossingOpen,
      // 連段系統（P1）。slow=兩套(combo 歸零門檻跟已解鎖最高招 + 能量獨立)；fast=一條(3/6/9/10)。
      controlMode: this.controlMode,
      combo: this.player.spirit,
      // slow：combo 上限=已解鎖最高招門檻(3/6/9)；fast=10
      comboMax: this.controlMode === 'slow' ? this.slowComboCap() : GameConfig.combo.max,
      comboThresholds: GameConfig.combo.thresholds,
      // fast 強化倒數(slow 不用)
      empowerRemainMs: Math.max(0, this.player.empowerUntil - this.time.now),
      // 能量系統(slow 用)
      energy: this.player.energy,
      energyMax: GameConfig.energy.max,
      energyTrigger: GameConfig.energy.trigger,
      empowered: this.player.empowered
    });
  }

  /** 一般怪生成時應使用的外觀（Enemy.spawn 查詢；隨 F4 切換） */
  public getNormalEnemyTextureConfig(): { texture: string; scale: number } {
    return this.artStyle.normalEnemyLook();
  }
}
