import Phaser from 'phaser';
import { GameConfig } from '../config';
import { Character } from '../objects/Character';
import { Enemy, type EnemyType } from '../objects/Enemy';
import { Item, type SkillType } from '../objects/Item';
import { updateRefillLatch, shouldSpawnMore, type WaveSpawnState } from '../systems/waveMath';
import { Bullet } from '../objects/Bullet';
import { Breakable } from '../objects/Breakable';
import { loadCharacterParams, type CharacterParams } from '../systems/characterParams';
import { createStageQueue, nextStageNode, revealStageNode, displayKindOf, type StageNode } from '../systems/stageQueue';
import type { TelegraphFx } from '../systems/telegraphFx';
import { BossController, type BossHost } from '../controllers/BossController';
import { ArtStyleController } from '../controllers/ArtStyleController';
import { GoIndicator } from '../controllers/GoIndicator';
import { HiddenGateController } from '../controllers/HiddenGateController';
import { TreasureRoomController } from '../controllers/TreasureRoomController';
import { TreasureEnemyController, type TreasureEnemyHost } from '../controllers/TreasureEnemyController';
import { BreakableController, type BreakableHost } from '../controllers/BreakableController';
import { ComboRewardController } from '../controllers/ComboRewardController';
import { SlotWorldController, type AreaTransition, type Side, type SlotWorldHost } from '../controllers/SlotWorldController';
import { PerfOverlay } from '../controllers/PerfOverlay';
import { GameDebugApi, type GameDebugHost } from '../controllers/GameDebugApi';
import { TargetingController, type TargetingHost } from '../controllers/TargetingController';
import { CharacterActionController, type CharacterActionHost, type SlowMoveKeys } from '../controllers/CharacterActionController';
import { SkillController, type SkillHost } from '../controllers/SkillController';
import { EventController, type EventHost, type EventKind } from '../controllers/EventController';
import { pointInOrientedRect } from '../systems/geometry';
import {
  applyEnemySeparationSteering, bounceEnemyOffBounds, joinsEnemySeparation,
  pushBreakablesFromCharacter, pushBreakablesFromEnemy, pushCharacterOutOfStructures, pushEnemiesAwayFromCharacter,
  pushEnemiesOutOfNpc, pushEnemyOutOfStructures, resolveEnemyOverlap, updateBreakableMotion
} from '../systems/bodySeparation';
import { drawEnemyChargeWarnings } from '../systems/enemyWarnings';
import { isFixedEnemy, isRegularEnemy } from '../systems/enemyKinds';

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
  /** 目前的移動區（玩家可活動範圍） */
  private get arena(): Phaser.Geom.Rectangle {
    return this.slotWorld.arena;
  }

  private enemies!: Phaser.Physics.Arcade.Group;  private items!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private breakables!: Phaser.GameObjects.Group;
  /** 可破壞物件的布置、打破與爆炸桶，每次 create() 重建 */
  private breakableCtl!: BreakableController;
  /** COMBO 連擊獎勵（頭上 UI 連擊數與彩票），每次 create() 重建 */
  private comboReward!: ComboRewardController;
  private chargeWarnGfx!: Phaser.GameObjects.Graphics;

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
  /** 除錯 / 自動化測試入口：`getScene('GameScene').debug.X()`，每次 create() 重建 */
  debug!: GameDebugApi;
  /** 區域世界（移動區、三格佈局、出口與轉場），每次 create() 重建 */
  private slotWorld!: SlotWorldController;
  /** 目前小關卡編號（1 起算、無限遞增） */
  private currentStage = 1;
  /** 小關卡寶箱佇列：[0] = 目前關卡，長度 = waveHud.visibleStages（見 systems/stageQueue.ts） */
  private stageQueue: StageNode[] = [];
  /** 目前小關卡是否進行中（startStage → completeStage 之間）；過場期間為 false，HUD 不採計殘留擊殺數 */
  private stageInProgress = false;
  /** 剛完成那關的寶箱階級：low → 左右出口平移；high → 上方出口閃黑 */
  private lastStageChest: 'low' | 'high' = 'low';
  private subWavesDone = 0;                // 當前子區已清波數
  private subWavesTarget = 0;              // 當前子區目標波數
  /** 事件結束時場上還有殘留怪→留給玩家打完才收尾;此旗標 true=等殘留清完再 onSubZoneComplete。 */
  private pendingEventComplete = false;
  /** 最後一波打完最後一隻怪時場上還有寶箱怪→延後開啟場景切換,等寶箱怪死/離場才 onSubZoneComplete。 */
  private pendingSubZoneComplete = false;
  /** 出口開啟時畫面邊緣的 GO 指示，每次 create() 重建 */
  private goIndicator!: GoIndicator;
  /** 隱藏入口（熔岩拱門），每次 create() 重建 */
  private hiddenGate!: HiddenGateController;
  /** 隱藏入口後的獎勵關（寶藏密室），每次 create() 重建 */
  private treasureRoom!: TreasureRoomController;
  /** 寶箱怪（關卡中與獎勵關），每次 create() 重建 */
  private treasures!: TreasureEnemyController;

  /** BOSS 系統（登場 / 招式 / 亂入離場 / 屍體 / 變身），每次 create() 重建 */
  private bossCtl!: BossController;
  /** 一次性招式（撿道具觸發），每次 create() 重建 */
  private skillCtl!: SkillController;
  /** 限時事件（塔 / 守護 / 佔領，含開場演出），每次 create() 重建 */
  private eventCtl!: EventController;


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
  private slowKeys?: SlowMoveKeys;
  /** 鎖定與瞄準（P1 鎖定目標、BOT 選目標、鎖定標記），每次 create() 重建 */
  private targeting!: TargetingController;
  /** 角色行動（出手、衝刺、慢速移動、BOT AI），每次 create() 重建 */
  private actions!: CharacterActionController;
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
    this.slotWorld = new SlotWorldController(this.createWorldHost());
    if (this.levelMode) {
      this.slotWorld.buildLevelLayout();
    } else {
      this.slotWorld.useFixedArena(new Phaser.Geom.Rectangle(arenaX, arenaY, arenaW, arenaH));
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
        ? this.slotWorld.slots
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
    this.eventCtl = new EventController(this.createEventHost());
    this.debug = new GameDebugApi(this.createDebugHost());
    this.goIndicator = new GoIndicator(this);
    new PerfOverlay(this); // 除錯 F9：實機效能監控（自行註冊熱鍵與場景關閉時的清理）
    this.hiddenGate = new HiddenGateController(this);
    this.treasures = new TreasureEnemyController(this.createTreasureHost());
    this.treasureRoom = new TreasureRoomController({
      scene: this,
      zone: () => this.slotWorld.centerZone,
      slot: () => this.slotWorld.centerSlot,
      roomTreasureCount: () => this.treasures.roomCount,
      spawnRoomTreasure: (x, y) => this.treasures.spawnRoomTreasure(x, y),
      dismissRoomTreasures: () => this.treasures.dismissRoom(),
      onFinished: () => this.onTreasureRoomFinished()
    });

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
    this.breakableCtl = new BreakableController(this.createBreakableHost());
    this.comboReward = new ComboRewardController(this, () => this.characters);
    this.chargeWarnGfx = this.add.graphics().setDepth(2);
    this.targeting = new TargetingController(this.createTargetingHost());
    this.actions = new CharacterActionController(this.createActionHost());

    // 開場只有 P1 一人。BOT 由按 B 逐一加入（見 tryAddBot）。
    this.createCharacter(0, false);

    // F4 用的 P1 皮膚與頭上覆蓋圖（需在 P1 建立後）
    this.artStyle.createPlayerOverlays();

    // 方案e:玩家建立後啟用鏡頭跟隨(限制在 A slot 內、deadzone 緩衝)。
    if (this.levelMode) this.slotWorld.enableFollow(this.slotWorld.centerSlot);

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
    // 除錯 H 鍵：立刻開啟這一區的隱藏入口（沒有拱門就先生成），可直接走進去
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.H).on('down', () => {
      if (!this.levelMode || this.hiddenGate.isOpen) return;
      this.hiddenGate.ensureSpawned(this.slotWorld.centerZone);
      this.slotWorld.openHiddenGateExit();
    });

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
        const level = this.slotWorld.level;
        this.slotWorld.debugPreviewLevel(level <= 1 ? GameConfig.stage.totalLevels : level - 1);
      });
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on('down', () => {
        const level = this.slotWorld.level;
        this.slotWorld.debugPreviewLevel(level >= GameConfig.stage.totalLevels ? 1 : level + 1);
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
      this.targeting.markPointerMoved(this.time.now);
    });

    this.game.events.on('ui-attack', this.queuePlayerAttack, this);
    // 道具開關觸控按鈕(UIScene 右上角)→ 呼叫現有 toggleItems();與鍵盤 I 鍵並存(兩者同一入口)。
    this.game.events.on('ui-toggle-items', this.toggleItems, this);
    // 初始同步按鈕面(依 config.items.spawnEnabled 的開/關)
    this.game.events.emit('items-state', this.itemsEnabled);

    // 開場第一波灑幾個可打破物件
    this.breakableCtl.spawnForWave();

    // 關卡制:關卡 1-A 開場——靜態布置 A 物件 + A 子區隨機(純波次 或 事件),顯示關卡標題。
    if (this.levelMode) {
      this.breakableCtl.placeStatic('L'); // 1-A 用預設一套布置
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
    this.currentStage = 1;
    this.stageInProgress = false;
    this.lastStageChest = 'low';
    this.stageQueue = createStageQueue(GameConfig.waveHud.visibleStages);
    this.subWavesDone = 0;
    this.subWavesTarget = 1;
    this.pendingEventComplete = false;
    this.pendingSubZoneComplete = false; // 重開清延後切換旗標
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
  private eventKindForWave(wave: number): EventKind {
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

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    this.survivalMs += delta;

    this.artStyle.update(time);
    this.goIndicator.update(delta);

    // COMBO 連擊計時（警告 / 中斷）
    this.comboReward.update();

    // 事件開場演出期間鎖操作、事件不計時也不生怪，只推進演出並重繪標記；演出結束（或逾時）才開戰
    if (this.eventCtl.isIntroActive) {
      this.eventCtl.updateIntro(time, delta);
      // 走位段由事件控制器移動角色（不清零速度）；其餘階段角色停在原地
      if (!this.eventCtl.isIntroWalking) {
        for (const c of this.characters) {
          if (!c.alive) continue;
          (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        }
      }
      this.targeting.drawMarkers();
      this.emitAim();
      return;
    }

    // 關卡制：轉場演出（平移、閃黑、自動走位）期間凍結遊戲邏輯，只重繪角色標記（角色被搬動後標記跟著走）
    if (this.levelMode && this.slotWorld.update(time, delta)) {
      this.targeting.drawMarkers();
      this.emitAim();
      return;
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
        this.eventCtl.onTimeStopEnd(frozenDur);
        this.bossCtl.onTimeStopEnd(frozenDur); // 亂入 BOSS 的離場倒數也凍結
        this.treasureRoom.onTimeStopEnd(frozenDur); // 獎勵關倒數也凍結
        this.treasures.onTimeStopEnd(frozenDur); // 寶箱怪的限時與跑點停頓也凍結
      }
    }

    // 強化期間能量每秒倒退(drainPerSec)，退到 0 → 解除強化。intermission 期間【暫停倒退】(凍結)。
    // BOT 也有能量強化→對【所有角色】做倒退解除(不再只 P1)。
    // 非戰鬥時暫停消退，避免玩家在過場浪費強化時間：波次間隔、區域之間（出口開放、平移、閃黑、自動走位）、時停中。
    const drainPaused =
      this.waveState === 'intermission' ||
      this.slotWorld.isBetweenAreas || // 出口開放、轉場、自動走位期間
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
    if (this.waveState === 'event') this.eventCtl.update(time);
    this.bossCtl.update(time);
    this.treasureRoom.update(time);
    this.updateEnemies(time);
    this.treasures.update(time); // 寶箱怪:跑點移動/金光閃爍/限時跑走
    this.treasures.updateRoom(time);
    this.finishPendingSubZoneIfTreasureGone(); // 延後的場景切換:寶箱怪死/離場後才開啟
    // 守護事件——怪移動後把怪推回守護目標外圈(不疊上去);玩家仍可穿越。放 updateEnemies 之後→怪這幀先移動再被推出,渲染前已在外緣。
    const guardNpc = this.eventCtl.guardNpc;
    if (this.waveState === 'event' && this.eventCtl.kind === 'guard' && guardNpc) pushEnemiesOutOfNpc(guardNpc, this.enemies, this.arena);
    this.updateItems(delta, time);
    updateBreakableMotion(this.breakables, this.arena, delta); // 可推動物件的位移 / 摩擦 / 邊界 / 互推
    this.updateBullets(time);
    this.updateChargerCollisions(time);

    // slow：先更新 P1 面向(aimAngle)+鍵盤八方向移動，再算鎖定/處理攻擊（同幀用最新面向，無延遲）。
    if (this.controlMode === 'slow') this.actions.handleSlowMovement(time);

    // P1：更新自動鎖定目標（滑鼠只選鎖誰，方向由目標決定）
    this.targeting.update(time);
    // 把 P1 鎖定鏡射到角色上，供多色點標記統一繪製
    this.player.lockedTarget = this.targeting.lockedTarget as unknown as
      (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;

    // P1：玩家輸入（招式演出鎖定中忽略輸入，角色不受玩家操控）
    // 時停期間非 owner 的 P1 被凍→忽略攻擊輸入(不能行動)。
    if (this.player.alive && this.playerAttackQueued) {
      this.playerAttackQueued = false;
      if (!this.player.isSkillLocked(time) && !this.isFrozenByTimestop(this.player)) {
        if (this.bossCtl.isTransformed) this.bossCtl.formAttack(time); // 變身 BOSS：攻擊鍵改放 BOSS 招式
        else this.actions.tryAct(this.player, time);
      }
    }
    // BOT：AI 決策（招式演出鎖定中略過）時停期間非 owner 的 BOT 被凍→停速度、不跑 AI。
    for (let i = 1; i < this.characters.length; i++) {
      const bot = this.characters[i];
      if (!bot.alive) continue;
      if (this.isFrozenByTimestop(bot)) { (bot.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0); continue; }
      if (!bot.isSkillLocked(time)) this.actions.updateBot(bot, time);
    }

    // 角色推進：招式演出鎖定中不推進衝刺（角色由演出 tween 驅動），仍夾在場內 + 標籤跟隨
    for (const c of this.characters) {
      if (!c.alive) continue;
      // 時停期間非 owner 角色【完全凍結】(停速度、不衝刺推進),owner 不受影響。
      if (this.isFrozenByTimestop(c)) {
        (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.actions.clampToArena(c);
        c.syncLabel();
        continue;
      }
      if (!c.isSkillLocked(time)) this.actions.handleDash(c, time);
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
      this.actions.clampToArena(c);
      c.syncLabel();
    }

    // 結算本幀道具互搶（位置近者得、原子拿取、避免雙重觸發）
    this.resolvePickups();

    this.targeting.drawMarkers();
    this.emitStats();
    this.emitAim();
  }

  /** 時停道具期間,此角色是否【被凍結】(非撿到者 owner 的角色都凍;owner 能動)。 */
  private isFrozenByTimestop(c: Character): boolean {
    return this.timeStopped && c !== this.timeStopOwner;
  }

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
    const guardNpc = this.eventCtl.guardNpc;
    if (this.waveState === 'event' && this.eventCtl.kind === 'guard' && guardNpc && guardNpc.active &&
        !isFixedEnemy(enemy)) {
      return guardNpc;
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

  /** 延後的場景切換：寶箱怪已打倒或離場 → 真正開啟切換。每幀在寶箱怪更新後檢查 */
  private finishPendingSubZoneIfTreasureGone(): void {
    if (!this.pendingSubZoneComplete) return;
    if (this.treasures.isOnField) return; // 寶箱怪還在→等它死/跑走
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
        this.breakableCtl.spawnForWave();
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
          //   延後(pendingSubZoneComplete),等寶箱怪【死掉或離場(跑走)】後才真正切換。
          //   無寶箱怪→直接開(同現在)。
          if (this.treasures.isOnField) {
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
        this.eventCtl.start(this.eventKindForWave(this.currentWave));
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

  // ========================= 關卡系統 =========================

  /** 區域的小關卡打完：依下一關開出口（問號 → 隨機雙出口；低階寶箱 → 左右出口；高階寶箱 → 上方出口） */
  private onSubZoneComplete(): void {
    // 清掉場上殘餘一般怪(進入選邊/出口階段,場地清乾淨)——保留還在場的寶箱怪(同場地,玩家可繼續打/它自己跑走)
    this.clearAllEnemies(true);
    this.waveState = 'clearing'; // 停止生怪
    const next = this.stageQueue[0];
    if (next.kind === 'mystery' && !next.revealed) {
      // 下一關是問號：隨機開兩個出口（不受方向限制），選哪條路就走哪種轉場，進去才揭曉
      this.treasures.fleeNow();
      this.slotWorld.openMysteryExits();
    } else if (this.lastStageChest === 'low') {
      // 低階寶箱：開放左右邊界（受 dirLock 限制），玩家走到邊界 → 鏡頭平移進相鄰區域
      // ③ 進 crossing 過場那刻:場上寶箱怪【直接逃走】(不留到過場/不跟到 B)。
      this.treasures.fleeNow();
      this.slotWorld.openCrossing();
    } else {
      // 高階寶箱：開上方出口 → 閃黑進新區域（方向限制解除）
      this.slotWorld.openTopExit();
    }
  }

  /** 獎勵關時間到：開上方出口，走出去閃黑到新區域，接著打佇列中的下一關 */
  private onTreasureRoomFinished(): void {
    this.slotWorld.openTopExit();
  }

  /**
   * 清掉場上一般怪(不計分,清場給轉場用)。keepTreasure=true 時【保留寶箱怪與亂入 BOSS】
   * (波次完成/子區完成不清它們,只有真正換場地才清/離場)。
   */
  private clearAllEnemies(keepTreasure = false): void {
    const tr = this.treasures.current;
    const intruder = this.bossCtl.isIntruder ? this.bossCtl.current : null;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active) continue;
      if (keepTreasure && e === tr) continue; // 保留還在場的寶箱怪(玩家可繼續打/它自己 lifetime 跑走)
      if (keepTreasure && e === intruder) continue; // 亂入 BOSS 不擋通關:子區完成後仍可繼續打,換區或時間到才離場
      e.dead = true; e.disableBody(true, true);
    }
    if (!keepTreasure) this.treasures.forget();
  }

  /**
   * 開始目前小關卡（stageQueue[0]）：清敵關卡，擊殺數依寶箱階級；問號寶箱在此揭曉並顯示橫幅。
   * 小遊戲關卡尚未實作
   */
  private startStage(): void {
    this.hiddenGate.spawnFor(this.slotWorld.centerZone); // 新區域開打：決定這一區是否出現隱藏入口
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

  /**
   * 清除所有角色殘留的移動狀態（衝刺中與速度）：轉場會直接搬動角色座標，
   * 若保留轉場前的衝刺終點，恢復操控時角色會自己衝回舊終點（例如往右平移後自動往左跑到邊界）
   */
  private resetCharacterMotion(): void {
    for (const c of this.characters) {
      if (c.isDashing) this.actions.endDashState(c);
      else c.stopMoving();
    }
  }

  /**
   * 建立 BreakableController 需要的場景能力
   */
  private createBreakableHost(): BreakableHost {
    return {
      scene: this,
      group: () => this.breakables,
      enemies: () => this.enemies,
      characters: () => this.characters,
      player: () => this.player,
      arena: () => this.arena,
      isLevelMode: () => this.levelMode,
      damageEnemyFrom: (actor, enemy, damage, knockback, fromX, fromY, time) => this.damageEnemyFrom(actor, enemy, damage, knockback, fromX, fromY, time),
      damageCharacterFrom: (c, amount, fromX, fromY) => this.damageCharacterFrom(c, amount, fromX, fromY),
      flashHurt: (c) => this.flashHurt(c),
      dropItemAt: (x, y, time) => this.dropItemAt(x, y, time),
      spawnExpandingRing: (x, y, radius, color, ms) => this.spawnExpandingRing(x, y, radius, color, ms),
      shakeOnce: (duration, intensity) => this.shakeOnce(duration, intensity)
    };
  }

  /**
   * 建立 TreasureEnemyController 需要的場景能力
   */
  private createTreasureHost(): TreasureEnemyHost {
    return {
      scene: this,
      enemies: () => this.enemies,
      arena: () => this.arena,
      player: () => this.player,
      isTimeStopped: () => this.timeStopped,
      isEventActive: () => this.eventCtl.kind !== null || this.waveState === 'event',
      waveProgress: () => ({ formations: this.waveFormations, quota: this.waveQuota, spawned: this.waveSpawned }),
      flashEnemy: (e) => this.flashEnemy(e),
      spawnDamageText: (x, y, amount) => this.spawnDamageText(x, y, amount),
      spawnExpandingRing: (x, y, radius, color, ms) => this.spawnExpandingRing(x, y, radius, color, ms),
      shakeOnce: (duration, intensity) => this.shakeOnce(duration, intensity)
    };
  }

  /**
   * 建立 GameDebugApi 需要的場景能力
   */
  private createDebugHost(): GameDebugHost {
    return {
      scene: this,
      characters: () => this.characters,
      player: () => this.player,
      enemies: () => this.enemies,
      items: () => this.items,
      breakables: () => this.breakables,
      arena: () => this.arena,
      boss: () => this.bossCtl,
      skills: () => this.skillCtl,
      events: () => this.eventCtl,
      targeting: () => this.targeting,
      isGameOver: () => this.gameOver,
      isTimeStopped: () => this.timeStopped,
      maxAlive: () => this.curMaxAlive(),
      activeFxCount: () => this.activeFxCount,
      attackDamage: () => this.curAttackDamage(),
      p1AttackHits: () => this.p1AttackHits,
      waveSnapshot: () => ({
        wave: this.currentWave, waveKilled: this.waveKilled, waveQuota: this.waveQuota,
        waveSpawned: this.waveSpawned, waveState: this.waveState
      }),
      setWaveState: (state) => { this.waveState = state; },
      emitStats: () => this.emitStats(),
      triggerGameOver: () => this.triggerGameOver(),
      applyHeal: (c) => this.applyHeal(c),
      addBot: () => this.tryAddBot(),
      dropItemAt: (x, y, time) => this.dropItemAt(x, y, time),
      damageEnemy: (actor, enemy, damage, knockback, time) => this.damageEnemy(actor, enemy, damage, knockback, time),
      teamKills: () => this.teamKills(),
      wireEnemyCallbacks: (e) => this.wireEnemyCallbacks(e)
    };
  }

  /**
   * 建立 TargetingController 需要的場景能力
   */
  private createTargetingHost(): TargetingHost {
    return {
      scene: this,
      enemies: () => this.enemies,
      items: () => this.items,
      characters: () => this.characters,
      player: () => this.player,
      isSlowMode: () => this.controlMode === 'slow',
      slowLockRadius: () => this.slowTuning.lockRadius
    };
  }

  /**
   * 建立 CharacterActionController 需要的場景能力
   */
  private createActionHost(): CharacterActionHost {
    return {
      enemies: () => this.enemies,
      player: () => this.player,
      arena: () => this.arena,
      walkBounds: () => this.slotWorld.walkBounds,
      targeting: () => this.targeting,
      isSlowMode: () => this.controlMode === 'slow',
      slowTuning: () => this.slowTuning,
      charParams: () => this.charParams,
      slowKeys: () => this.slowKeys!,
      isFrozenByTimestop: (c) => this.isFrozenByTimestop(c),
      guardNpc: () => this.eventCtl.guardNpc,
      attackDamage: () => this.curAttackDamage(),
      damageEnemy: (actor, enemy, damage, knockback, time) => this.damageEnemy(actor, enemy, damage, knockback, time),
      hitBreakablesInRange: (c, radius, half, useArc, damage, time) => this.breakableCtl.hitInRange(c, radius, half, useArc, damage, time),
      performAttackOn: (actor, primary, time) => this.performAttackOn(actor, primary, time),
      onComboHit: (c, time) => this.onComboHit(c, time),
      triggerComboHit: (c) => this.comboReward.hit(c),
      empowerAoe: (c, time) => this.empowerAoe(c, time),
      flashWhite: (c) => this.flashWhite(c),
      spawnMeleeArcEffect: (x, y, angle) => this.spawnMeleeArcEffect(x, y, angle)
    };
  }

  /**
   * 建立 SlotWorldController 需要的場景能力（只開放區域世界用得到的部分）
   */
  private createWorldHost(): SlotWorldHost {
    return {
      scene: this,
      characters: () => this.characters,
      player: () => this.player,
      goIndicator: () => this.goIndicator,
      hiddenGate: () => this.hiddenGate,
      recycleBackground: (side, slot) => this.artStyle.recycleBackground(side, slot),
      resetCharacterMotion: () => this.resetCharacterMotion(),
      onAreaLeave: (to) => this.onAreaLeave(to),
      clearArea: () => { this.breakableCtl.clearAll(); this.clearAllEnemies(); },
      onAreaEnter: (to, side) => this.onAreaEnter(to, side)
    };
  }

  /**
   * 離開目前區域：亂入 BOSS 離場；左右平移時清掉寶箱怪（別帶到下一區），走上方出口時結束獎勵關
   *
   * @param to 轉場去處
   */
  private onAreaLeave(to: AreaTransition): void {
    if (to === 'side') this.treasures.clear();
    this.bossCtl.onZoneLeave();
    if (to === 'nextArea') this.treasureRoom.end();
  }

  /**
   * 進入新區域：獎勵關直接開始倒數（不生一般怪）；其餘重新布置可破壞物件、波次計數歸零後開始佇列中的下一個小關卡
   *
   * @param to 轉場去處
   * @param side 左右平移時抵達的方向（決定物件布置的基調）
   */
  private onAreaEnter(to: AreaTransition, side: Side): void {
    if (to === 'treasureRoom') {
      this.waveState = 'clearing';
      this.treasureRoom.begin(this.time.now);
      return;
    }
    if (to === 'side') {
      this.breakableCtl.clearAll();
      this.breakableCtl.placeStatic(side);
    }
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    if (to === 'nextArea') this.breakableCtl.placeStatic('L'); // 新區域的物件布置一律用左側基調
    this.startStage();
    this.emitStats();
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
      triggerComboHit: (actor) => this.comboReward.hit(actor),
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
    if ((this.levelMode && this.isFinalLevel(this.slotWorld.level)) || this.isBossWave(this.currentWave)) {
      this.triggerClear();
      return;
    }
    // 關4 中場 BOSS 打完(非最終關)→【淡出→進下一關(關5 森林 A 子區)】,不通關不結束。
    if (this.levelMode && this.isBossLevel(this.slotWorld.level)) {
      this.slotWorld.startNextAreaTransition();
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
  // 限時事件（塔 / 守護 / 佔領）：事件本身在 EventController，這裡是場景提供的能力與事件結束後的接續
  // ===========================================================================

  /**
   * 建立 EventController 需要的場景能力（只開放事件系統用得到的部分）
   */
  private createEventHost(): EventHost {
    return {
      scene: this,
      enemies: this.enemies,
      arena: () => this.arena,
      currentSlot: () => this.slotWorld.currentSlot,
      characters: () => this.characters,
      player: () => this.player,
      currentWave: () => this.currentWave,
      isGameOver: () => this.gameOver,
      wireEnemyCallbacks: (e) => this.wireEnemyCallbacks(e),
      addTelegraph: (fx) => { this.telegraphFx.push(fx); },
      removeTelegraph: (fx) => this.removeTelegraphFx(fx),
      clearTelegraphsOf: (owner) => this.clearTelegraphsOf(owner),
      damageCharacter: (c, amount, fromX, fromY, rootMs) => this.damageCharacterFrom(c, amount, fromX, fromY, rootMs),
      spawnSummonAt: (x, y, time, forceType, leashImmune, forceChase) => this.spawnSummonAt(x, y, time, forceType, leashImmune, forceChase),
      flashEnemy: (e) => this.flashEnemy(e),
      dropItemAt: (x, y, time) => this.dropItemAt(x, y, time),
      shakeOnce: (duration, intensity) => this.shakeOnce(duration, intensity),
      showEventBanner: (text) => this.showEventBanner(text),
      enableFollow: (slot) => this.slotWorld.enableFollow(slot),
      onEventEnded: () => this.onEventEnded()
    };
  }

  /**
   * 事件結束後的接續：關卡制下場上還有殘留一般怪時先停止生怪、留給玩家打完（清完由 finishPendingEventIfCleared 接續），
   * 沒有殘留則進入選邊 / 出口；非關卡制直接過關
   */
  private onEventEnded(): void {
    if (this.levelMode) {
      if (this.countResidualEnemies() > 0) {
        this.pendingEventComplete = true;
        this.waveState = 'clearing';
        this.emitStats();
        return;
      }
      this.onSubZoneComplete();
      return;
    }
    this.enterIntermission();
  }

  /** 事件後殘留怪清完的收尾(由 onWaveKill 在 pendingEventComplete 時偵測 countResidualEnemies=0 呼叫)。 */
  private finishPendingEventIfCleared(): void {
    if (!this.pendingEventComplete) return;
    if (this.countResidualEnemies() > 0) return; // 還有殘留怪→繼續給玩家打
    this.pendingEventComplete = false;
    this.onSubZoneComplete(); // 殘留清完→真正進下一步(選邊/轉場)
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

  private clearWaveByCheat(): void {
    if (this.gameOver) return;
    // 事件進行中 → 直接完成事件（清理由事件控制器處理）
    if (this.waveState === 'event') {
      // 清掉場上小怪
      for (const child of this.enemies.getChildren()) {
        const e = child as Enemy;
        if (e.active && !e.dead && e.enemyType !== 'tower' && e.enemyType !== 'npc') {
          this.spawnDeathBurst(e.x, e.y);
          e.kill();
        }
      }
      this.eventCtl.complete(true);
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
        if (this.slotWorld.phase !== 'playing') return; // 出口開放或轉場中不處理
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
   *   BOSS 波召喚 BOSS、事件波啟動事件、否則 enterIntermission。
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
    this.treasures.trySpawn(time); // 每次波次生怪→roll 寶箱怪(場上只1隻)
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

      // 時間暫停中，敵人凍結（停速度、不跑 AI）；事件聚焦定格時也凍結。
      if (this.timeStopped || this.eventCtl.isFocusPaused) {
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
    if (GameConfig.enemySeparation.enabled && !this.timeStopped && !this.eventCtl.isFocusPaused) {
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
    const laserNpc = this.waveState === 'event' ? this.eventCtl.hittableGuardNpc : null;
    if (laserNpc && pointInOrientedRect(laserNpc.x, laserNpc.y, ox, oy, angle, 0, cfg.laserLength, cfg.laserWidth)) {
      if (now >= enemy.nextNpcHitAt) {
        enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
        this.eventCtl.hitGuardNpc();
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
        const bombNpc = this.waveState === 'event' ? this.eventCtl.hittableGuardNpc : null;
        if (bombNpc && Phaser.Math.Distance.Between(bombNpc.x, bombNpc.y, tx, ty) <= cfg.bombRadius) {
          if (now >= enemy.nextNpcHitAt) {
            enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
            this.eventCtl.hitGuardNpc();
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
      const npc = this.waveState === 'event' ? this.eventCtl.hittableGuardNpc : null;
      if (npc && bullet.active) {
        const hitR = GameConfig.enemy.shooter.bulletRadius + npc.getBodyRadius();
        if (Phaser.Math.Distance.Between(bullet.x, bullet.y, npc.x, npc.y) <= hitR) {
          bullet.recycle();
          if (time >= npc.bulletNpcHitAt) {
            npc.bulletNpcHitAt = time + GameConfig.event.guard.npcAttackCooldownMs;
            this.eventCtl.hitGuardNpc();
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
          if (ch.dashToItem && ch.isDashing) this.actions.endDashState(ch);
        }
      }
      if (this.targeting.lockedTarget === item) this.targeting.lockedTarget = null;
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
      breakBreakablesInCircle: (x, y, radius, _damage, time) => this.breakableCtl.breakInCircle(x, y, radius, time),
      breakBreakablesInRect: (ox, oy, dir, nearOffset, length, width, _damage, time) =>
        this.breakableCtl.breakInRect(ox, oy, dir, nearOffset, length, width, time),
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
    // 衝刺命中也算一次 COMBO 連擊
    this.comboReward.hit(actor);

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
    const cur = this.targeting.lockedTarget;
    // 當前鎖定目標:必須是敵人(非道具)、可傷、且在圓圈內才沿用
    if (cur && !this.targeting.isItem(cur)) {
      const e = cur as Enemy;
      if (typeof e.isVulnerable === 'function' && this.targeting.isLockableEnemy(e) &&
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
      this.comboReward.hit(c); // COMBO 獎勵：變身 AOE 命中算 1 下
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
    if (hitAny) this.comboReward.hit(c); // COMBO 獎勵：連段技命中算 1 下
    this.breakableCtl.breakInCircle(c.x, c.y, radius, time); // 圓形斬掃到木箱也打破
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
    if (hitAny) this.comboReward.hit(c); // COMBO 獎勵：連段技命中算 1 下
    this.breakableCtl.breakInRect(ox, oy, dir, 0, length, width, time); // 直線氣波掃到木箱也打破
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
          this.comboReward.hit(c);
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
    this.breakableCtl.breakInCircle(c.x, c.y, radius, time); // 爆發掃到木箱也打破
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
    if (enemy.enemyType === 'treasure') { this.treasures.hit(enemy, actor); return; }
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
      this.spawnExpandingRing(dx, dy, 120, 0xff8844, 400);
      this.eventCtl.onTowerDestroyed(); // 取消塔蓄力中的扇形預警，事件成功
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
    const lock = this.targeting.lockedTarget;
    if (this.targeting.isLockValid(lock)) {
      ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, lock!.x, lock!.y);
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
      currentLevel: this.slotWorld.level,
      // 小關卡卷軸 HUD：目前關卡編號、擊殺進度、本關與後續關卡的寶箱階級
      stage: this.currentStage,
      stageKilled: this.stageInProgress ? this.waveKilled : 0,
      stageQuota: this.waveQuota,
      stageChests: this.stageQueue.map(displayKindOf),
      subWavesDone: this.subWavesDone,
      subWavesTarget: this.subWavesTarget,
      progressPhase: this.slotWorld.phase,
      crossingOpen: this.slotWorld.isCrossingOpen,
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
