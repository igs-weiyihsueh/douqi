import Phaser from 'phaser';
import { GameConfig, levelLerp } from '../config';
import { Character } from '../objects/Character';
import { Enemy, type EnemyType } from '../objects/Enemy';
import { Item, type SkillType } from '../objects/Item';
import { updateRefillLatch, shouldSpawnMore, type WaveSpawnState } from '../systems/waveMath';
import { Bullet } from '../objects/Bullet';
import { Breakable } from '../objects/Breakable';

/**
 * GameScene（v6：本地單機模擬 4 人共玩）：
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

  private survivalMs = 0;
  private gameOver = false;

  // 生成
  private spawnAccumulator = 0;
  private currentSpawnInterval: number = GameConfig.spawn.initialIntervalMs;
  /** 道具定時保底掉落計時 */
  private itemDropAccumulator = 0;

  // v27 波次制
  private currentWave = 1;
  private waveQuota = 0;
  private waveKilled = 0;
  private waveSpawned = 0;
  /** ★階段2a:latch 補生栓(活怪跌破 threshold 開→補到 maxAlive 才關,防抖)。跨幀持有。 */
  private spawnRefilling = false;
  /** ★階段2b 分配制:本波已生的近身組/場上組隻數(用來讓比例收斂 nearShare)+ 近身組輪派座位游標(多人平均分)。 */
  private nearSpawned = 0;
  private fieldSpawned = 0;
  private nearSeatCursor = 0;
  /** ★本波已生成的【隊形次數】(spawnFormation 呼叫次數);寶箱怪只在第2次隊形起才 roll,確保「首次生怪」絕不出寶箱。 */
  private waveFormations = 0;
  private waveState: 'spawning' | 'clearing' | 'intermission' | 'boss' | 'event' = 'spawning';
  private intermissionUntil = 0;

  // ★關卡系統(第一階段骨架)
  private levelMode = false;               // 是否啟用關卡制
  private currentLevel = 1;                // 1..totalLevels
  private currentSub: 'A' | 'B' = 'A';     // 當前子區
  private eventBag: string[] = [];         // ★事件洗牌佇列(shuffle bag):一輪內 tower/guard/capture 各出一次不重複,pop 空→重洗
  private subWavesDone = 0;                // 當前子區已清波數
  private subWavesTarget = 0;              // 當前子區目標波數
  private lastChoice: 'L' | 'R' = 'L';     // 上一次 A→B 選的邊(影響 B 物件配置)
  /** 進程階段:playing=打波次 / choosing=A 清完等玩家選左右 / panning=鏡頭平移中 / exiting=B 清完等玩家走出口 / transition=閃黑切下一關 */
  private progressPhase: 'playing' | 'choosing' | 'panning' | 'exiting' | 'transition' = 'playing';
  /** ★階段1:A 清波後開放邊界、玩家自由走去右 B 的「跨越中」狀態(playing 延續,不凍結)。 */
  private crossingOpen = false;
  /**
   * ★新鏡頭機制:跨越子階段。
   * 'walk'    = 開放右邊界,玩家走向 A 右緣(鏡頭仍 follow)。
   * 'panning' = 玩家碰 A 右緣→鏡頭 cam.pan 到 B 中心定位(玩家凍結、帶過走廊)。
   * 'enter'   = 鏡頭已定位在 B 中心(固定不 follow),玩家操控角色走進 B 畫面。
   */
  private crossPhase: 'walk' | 'panning' | 'enter' = 'walk';
  /** ★階段2:本次跨越鎖定的方向('L'/'R');walk 期未定為 null,碰邊界觸發後鎖定。 */
  private crossSide: 'L' | 'R' | null = null;
  /** ★階段2:crossing 開放的時間戳(用於開放後短暫緩衝內不觸發,讓玩家看引導箭頭、不貼邊秒觸發)。 */
  private crossOpenAt = 0;
  /** ★③關卡間閃黑後:角色自動走到下關定位的演出旗標(true 期間玩家不可操控,程式驅動走位)。 */
  private levelEntering = false;
  /** ★不可事件接事件:記錄上一個子區類型(事件/純波次);上一子區='event'→這子區強制純波次。 */
  private lastSubZoneKind: 'event' | 'wave' | null = null;
  /** ★事件結束時場上還有殘留怪→留給玩家打完才收尾;此旗標 true=等殘留清完再 onSubZoneComplete。 */
  private pendingEventComplete = false;
  /** ★最後一波打完最後一隻怪時場上還有寶箱怪→延後開啟場景切換,等寶箱怪死/離場才 onSubZoneComplete。 */
  private pendingSubZoneComplete = false;
  /** ★v59 階段2:場上能量球(飛向P1的視覺演出)數量,做輕量上限。 */
  private energyOrbCount = 0;
  /** ★進B鏡頭跳一下修:進B後暫不硬收 camera bounds,等鏡頭平滑捲進此 slot 範圍內才收(避免 clamp 跳)。null=無待收。 */
  private pendingCamSlot: Phaser.Geom.Rectangle | null = null;
  private zoneA!: Phaser.Geom.Rectangle;   // A 子區【移動區】矩形(世界座標,置中)
  private zoneB!: Phaser.Geom.Rectangle;   // 當前 B 【移動區】(=選邊後指向 zoneBLeft 或 zoneBRight)
  private zoneBLeft!: Phaser.Geom.Rectangle;  // A 左側的 B 候選【移動區】
  private zoneBRight!: Phaser.Geom.Rectangle; // A 右側的 B 候選【移動區】
  // ★方案e:每子區的「視野範圍(slot)」= 移動區 + 四周遠景邊距;camera 跟隨玩家限制在當前 slot 內。
  private slotA!: Phaser.Geom.Rectangle;
  private slotBLeft!: Phaser.Geom.Rectangle;
  private slotBRight!: Phaser.Geom.Rectangle;
  private choiceGfx: Phaser.GameObjects.Graphics | null = null;   // 左右箭頭/上下出口繪圖
  private choiceHint: Phaser.GameObjects.Text | null = null;      // 提示文字
  /** ★階段1:右走廊純色佔位底圖(進 B 後清)。 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  /** ★階段2:左走廊底圖。 */
  private corridorGfxL: Phaser.GameObjects.Graphics | null = null;
  private levelBanner: Phaser.GameObjects.Text | null = null;     // 關卡標題
  private treasureBanner: Phaser.GameObjects.Text | null = null;  // ★寶箱怪出現提示橫幅
  // ★事件波開場宣告(階段1):雙段大字+右滑出+時序gate+鎖操作。
  private eventIntroActive = false;
  private eventIntroStage: 'introMove' | 'unified' | 'perEvent' | 'done' = 'done';
  private eventIntroStageEndsAt = 0;   // 當前段(顯示滿)結束時間戳→觸發滑出
  private eventIntroSlideDone = false; // 當前段是否已觸發滑出
  private eventIntroHardEndsAt = 0;    // ★逾時保底:整段開場強制結束時間戳
  private eventIntroBanner: Phaser.GameObjects.Text | null = null;
  private pendingEventKind: 'tower' | 'guard' | 'capture' | null = null;
  // ★階段3:角色自動走位到目標(introMove,仿 updateLevelEnter)
  private eventIntroWalkEndsAt = 0;    // ★走位逾時保底時間戳(到時 snap 到位推進)
  // ★階段2:聚焦(pan+壓黑+凍敵定格)
  private eventFocusPause = false;                       // 獨立凍敵定格旗標(不借 timeStopped)
  private eventFocusPanning = false;                     // pan 進行中(pan 完才開壓黑/開始 focus 計時)
  private eventFocusDim: Phaser.GameObjects.Rectangle | null = null;   // 全螢幕壓黑遮罩
  private eventFocusGlow: Phaser.GameObjects.Arc | null = null;        // 目標亮暈(暖光暈)
  private eventFocusTarget: Phaser.GameObjects.Components.Depth | null = null; // 被聚焦目標(提 depth)
  private eventFocusTargetDepth = 0;                     // 目標原 depth(還原用)
  private sceneLayers: Phaser.GameObjects.GameObject[] = [];      // ★第二階段:場景繪製物件(重繪時清掉)

  // v28 BOSS
  private boss: Enemy | null = null;
  private bossCount = 0;
  private bossDamageAccum = 0; // v35：累積對 BOSS 的傷害，跨過 dropEveryDamage 就噴道具
  private bossAnchors: Enemy[] = []; // v36：BOSS 戰錨點（走位落點）
  private bossCasting = false;       // v38：BOSS 是否正在蓄招（招式 fill 中）；gap 空檔才丟球
  private bossGapBallAt = 0;         // v38：下次 gap 球投擲時間

  // v33 事件系統
  private eventKind: 'tower' | 'guard' | 'capture' | null = null;
  private tower: Enemy | null = null;  private towerNextBlastAt = 0;
  private towerNextSpawnAt = 0;
  private towerBeamGroup = 0; // v39：塔光束交替兩組方向（0/1）
  private towerEndsAt = 0; // ★塔事件限時倒數截止時間戳(限時內未打掉塔=失敗進下一波)
  private guardNpc: Enemy | null = null;
  private guardHighlight: Phaser.GameObjects.Graphics | null = null;
  private guardEndsAt = 0;
  private guardNextSpawnAt = 0;
  /** ★守護【純時間間隔+循環】:guardWaveIdx 只用來選波種(% waves.length),不當結束依據。 */
  private guardWaveIdx = 0;
  /** ★混合出波:當前波是否已生成(true=已生,才啟動清空判定,防生成幀 countGuardWaveAlive==0 誤觸)。 */
  private guardWaveActive = false;
  /** ★線性遞增:全場累計出波次數(不重置);spawnGuardWave 用來算 perSide 加成。 */
  private guardGlobalWaveCount = 0;
  // ★寶箱怪:場上同時只 1 隻(有則不再生);null=場上無寶箱怪
  private treasureEnemy: Enemy | null = null;
  // ★③ 寶箱怪金光加強:發光圈(脈動 halo)+ 金色粒子環繞
  private treasureGlow: Phaser.GameObjects.Graphics | null = null;
  private treasureEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private captureProgress = 0; // 0~100
  private captureGfx: Phaser.GameObjects.Graphics | null = null;
  private captureCx = 0;
  private captureCy = 0;
  private captureWaveActive = false; // v39：目前是否有一波怪在場上待清
  private captureNextWaveAt = 0;     // v39：清完一波後、下一波生成時間
  private captureEndsAt = 0;         // v40(1)：佔領時限截止時間

  // 玩家輸入
  private attackKey!: Phaser.Input.Keyboard.Key;
  private playerAttackQueued = false;
  /** ★遊戲內道具開關(I 鍵 toggle):執行期旗標,初值取 config.items.spawnEnabled;dropItemAt 讀此值。 */
  private itemsEnabled: boolean = GameConfig.items.spawnEnabled;
  private itemToggleBanner: Phaser.GameObjects.Text | null = null;
  /** v46：操作模式——'fast'(現況:滑鼠融合瞄準+衝刺移動合一)｜'slow'(純鍵盤:八方向走+面向+範圍圈鎖定) */
  private controlMode: 'fast' | 'slow' = 'fast';
  /**
   * v47：慢速模式【即時可調參數】——遊戲中用下方調參欄位 −/+ 調整，即時生效。
   * 初值取自 config；slow 模式的鎖定範圍/衝刺距離/衝刺速度改讀這組(fast 仍讀 config 常數不受影響)。
   */
  private slowTuning: Record<'lockRadius' | 'dashDistance' | 'dashSpeed', number> = {
    lockRadius: GameConfig.slow.lockRadius,
    dashDistance: GameConfig.slow.dashDistance,
    dashSpeed: GameConfig.slow.dashSpeed
  };
  /** v46 slow：八方向移動鍵（方向鍵 + WASD） */
  private slowKeys?: {
    up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key;
    w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key;
    s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key;
  };
  /** 滑鼠最後移動時間（判定 aimActive） */
  private lastPointerMoveAt = -Infinity;
  /** P1 當前鎖定目標（v14.2：可為敵人或道具） */
  private lockedTarget: Enemy | Item | null = null;
  /** v15：本幀道具互搶候選（道具 → 目前最近的碰觸角色），update() 末端結算 */
  private pendingPickups = new Map<Item, Character>();
  /** v17.1：目前存活中的視覺特效物件數（節流用，超過 maxActiveFx 就略過新視覺） */
  private activeFxCount = 0;
  /** v13：時間暫停中（全場敵人 + BOT 凍結；施展者不受影響，因其處於 skillLock） */
  private timeStopped = false;
  private timeStopUntil = 0;
  /** ★v63:時停道具的【撿到者(owner)】——時停期間 owner 能動,其他角色(+敵人)都停。 */
  private timeStopOwner: Character | null = null;
  /** v45(2)：時停開始時間戳，用於解除時把敵人蓄力時間戳整批後移（凍結進度不流失） */
  private timeStopStartedAt = 0;
  
  /** ★事件系統動態難度調整 - 進入事件時鎖定的玩家數量和難度係數 */
  private eventPlayerCount = 1;
  private eventDifficultyMultiplier = 1.0;
  
  /**
   * v45(2)(4)：場景層級蓄力/預警特效登記表（塔扇形、BOSS 招 fill）。
   * · 時停時暫停其 tween/延後其 fire 計時、解除時續；
   * · owner 死亡(塔/BOSS)時強制清除 graphics + 取消 pending fire，避免殘留/誤發。
   */
  private telegraphFx: Array<{
    owner: 'tower' | 'boss';
    gfx: Phaser.GameObjects.Graphics;
    tween?: Phaser.Tweens.Tween;
    fired: boolean;
  }> = [];

  /** v14 等級制（團隊共用） */
  private teamLevel = GameConfig.level.cap; // ★拔等級:固定滿等(不再升級);levelLerp/cur* 自動回滿等 base
  private teamExp = 0;
  /** 已累積到「當前等級起點」的經驗（用來算當前等級內進度） */
  private teamExpAtLevelStart = 0;

  /** v25 第8項：P1 普攻「命中動作」累計次數（一次攻擊命中≥1隻算1；只算 P1、不含 BOT/招式）。R復活/重開歸零。 */
  private p1AttackHits = 0;

  constructor() {
    super('GameScene');
  }

  /** v46：接收 TitleScene 傳入的操作模式（預設 fast，保持向後相容/直接啟動也不壞） */
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

    // ★關卡制:A 子區【置中】,B 可能在 A 的左側或右側(依玩家選邊)。
    //   世界佈局: [B-左候選][A-中央][B-右候選],世界寬 = 3×畫面 + 2×gap。
    //   選左→鏡頭往左移、B 呈現在左;選右→鏡頭往右移、B 在右(方向對應直覺)。
    this.levelMode = GameConfig.stage.enabled;
    if (this.levelMode) {
      const gap = GameConfig.stage.subGap;
      const st = GameConfig.stage;
      const aW = st.arenaW, aH = st.arenaH, m = st.sceneMargin;
      const slotW = aW + m * 2, slotH = aH + m * 2;
      const worldW = slotW * 3 + gap * 2;
      const worldH = slotH;
      // 三個 slot 水平並排:[B-左][A-中][B-右];每 slot 內 arena 置中。
      const slotBLeftX = 0, slotAX = slotW + gap, slotBRightX = (slotW + gap) * 2;
      this.slotBLeft = new Phaser.Geom.Rectangle(slotBLeftX, 0, slotW, slotH);
      this.slotA = new Phaser.Geom.Rectangle(slotAX, 0, slotW, slotH);
      this.slotBRight = new Phaser.Geom.Rectangle(slotBRightX, 0, slotW, slotH);
      // 移動區(arena)= slot 內置中
      this.zoneBLeft = new Phaser.Geom.Rectangle(slotBLeftX + m, m, aW, aH);
      this.zoneA = new Phaser.Geom.Rectangle(slotAX + m, m, aW, aH);
      this.zoneBRight = new Phaser.Geom.Rectangle(slotBRightX + m, m, aW, aH);
      this.zoneB = this.zoneBRight;   // 佔位(選邊時重指)
      this.arena = this.zoneA;        // 當前移動區(切換時 reassign→108 處引用自動跟隨)
      // 物理世界 = arena(玩家只能在移動區內);camera bounds = 整個世界(可跟隨捲動露遠景)
      this.physics.world.setBounds(this.zoneA.x, this.zoneA.y, this.zoneA.width, this.zoneA.height);
      this.cameras.main.setBounds(0, 0, worldW, worldH);
      // 三個子區各繪製場景:zoneA=變體A(荒城遠景)、B候選=變體B(火山遠景);遠景畫在各自 slot 範圍。
      this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, 'B');
      this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, 'A');
      this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, 'B');
      // ★playing 鏡頭跟隨在玩家建立後啟用(見 create 末 setupFollowIfLevel)。
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

    // 敵群
    this.enemies = this.physics.add.group({
      classType: Enemy,
      maxSize: GameConfig.spawn.maxAlive,
      runChildUpdate: false
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
    // v57/v59 可打破物件群——普通群(每個 Breakable 自帶靜態物理 body)；碰撞由 createCharacter 的 collider 處理。
    this.breakables = this.add.group({
      classType: Breakable,
      maxSize: GameConfig.breakable.maxAlive,
      runChildUpdate: false
    });
    this.chargeWarnGfx = this.add.graphics().setDepth(2);
    this.lockGfx = this.add.graphics().setDepth(12);

    // v8 追加：開場只有 P1 一人。BOT 由按 B 逐一加入（見 tryAddBot）。
    this.createCharacter(0, false);

    // ★方案e:玩家建立後啟用鏡頭跟隨(限制在 A slot 內、deadzone 緩衝)。
    if (this.levelMode) this.enableFollow(this.slotA);

    // 玩家輸入：空白鍵 + 攻擊鈕
    this.attackKey = this.input.keyboard!.addKey(
      Phaser.Input.Keyboard.KeyCodes.SPACE
    );
    this.attackKey.on('down', () => this.queuePlayerAttack());

    // v46 slow：八方向移動鍵（方向鍵 + WASD）。fast 模式不使用（不影響）。
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.slowKeys = {
      up: kb.addKey(KC.UP), down: kb.addKey(KC.DOWN),
      left: kb.addKey(KC.LEFT), right: kb.addKey(KC.RIGHT),
      w: kb.addKey(KC.W), a: kb.addKey(KC.A),
      s: kb.addKey(KC.S), d: kb.addKey(KC.D)
    };
    // v46 slow：開場面向初值朝上（避免第一次攻擊朝 aimAngle=0 亂衝）
    if (this.controlMode === 'slow') this.player.aimAngle = -Math.PI / 2;
    // v55(slow-A)：慢速模式 P1【無血量、不會死】——被打只扣能量。fast 不設(有血會死，原樣)。
    if (this.controlMode === 'slow') this.player.noHpLoss = true;
    // ★v60 階段3:slow 模式 P1 啟用【強化型態造型】(升級變身視覺;fast 不開,維持原強化視覺)。
    if (this.controlMode === 'slow') this.player.empoweredForm = true;
    // ★UI調整①:慢速調參面板改由 config.debug.showSlowTuningPanel 控制(預設關)。
    if (this.controlMode === 'slow') this.createSlowTuningPanel();

    // B 鍵：逐一加入 BOT 夥伴（最多湊滿 characters.count）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B).on('down', () => {
      this.tryAddBot();
    });

    // ★v58 Z 鍵:slow 能量滿 → 手動觸發強化(非自動)。fast 不用(fast 命中10自動觸發照舊)。
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z).on('down', () => {
      this.tryManualEmpower();
    });

    // v16 R 鍵：P1 原地滿血復活（無限次）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', () => {
      this.revivePlayer();
    });

    // v16 T 鍵：遊戲進行中隨時乾淨重開一局
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T).on('down', () => {
      this.restartRun();
    });

    // v28 N 鍵：清除場上所有怪 + 立即完成當前波次（debug/爽度熱鍵，跳過事件/BOSS）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.N).on('down', () => {
      this.clearWaveByCheat();
    });

    // ★I 鍵:遊戲內【道具生成開關】toggle——即時 on/off + 螢幕橫幅提示;關→清掉場上現有道具(直覺)。
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.I).on('down', () => {
      this.toggleItems();
    });

    // v35(10) M 鍵：清場但「走正常過關判定」——清掉小怪並把本波打到達標，
    // 若當前是事件波→觸發事件、BOSS 波→召喚 BOSS、否則進 intermission。
    // （事件/BOSS 進行中則等同 N，直接完成，避免卡）
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M).on('down', () => {
      this.clearWaveAndTrigger();
    });

    // ★除錯熱鍵 L(Level):團隊等級直接滿等→三招(圓/直/爆發)+強化立即解鎖。只在主戰鬥 GameScene 綁定(小遊戲/選單/編輯器不誤觸)。
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.L).on('down', () => {
      this.maxLevelCheat();
    });

    // ★除錯熱鍵 [ / ] :切換預覽關卡場景(1-4),即時重繪當前子區地貌+遠景(給看 4 關對比用)。
    if (this.levelMode) {
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.OPEN_BRACKET).on('down', () => {
        this.debugPreviewLevel(this.currentLevel <= 1 ? GameConfig.stage.totalLevels : this.currentLevel - 1);
      });
      this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.CLOSED_BRACKET).on('down', () => {
        this.debugPreviewLevel(this.currentLevel >= GameConfig.stage.totalLevels ? 1 : this.currentLevel + 1);
      });
    }

    // 滑鼠移動 → 更新 P1 瞄準方向 + 標記活躍時間（v12：滑鼠只決定「鎖哪隻」）
    // v46：slow 模式純鍵盤，忽略滑鼠（aimAngle 由鍵盤 facing 設，不被滑鼠覆蓋）。
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
    // ★道具開關觸控按鈕(UIScene 右上角)→ 呼叫現有 toggleItems();與鍵盤 I 鍵並存(兩者同一入口)。
    this.game.events.on('ui-toggle-items', this.toggleItems, this);
    // ★初始同步按鈕面(依 config.items.spawnEnabled 的開/關)
    this.game.events.emit('items-state', this.itemsEnabled);

    // v57：開場第一波灑幾個可打破物件
    this.spawnBreakablesForWave();

    // ★關卡制:關卡 1-A 開場——靜態布置 A 物件 + A 子區隨機(純波次 或 事件),顯示關卡標題。
    if (this.levelMode) {
      this.placeStaticBreakables('L'); // 1-A 用預設一套布置
      this.progressPhase = 'playing';
      this.rollSubZoneContent(true);   // 1-A 隨機:純波次(wavesA) 或 事件
      // 純波次才開場生一組怪(事件由 startEvent 自管生怪)
      if (this.waveState === 'spawning' && GameConfig.spawn.spawnOnStart) {
        this.spawnFormation();
      }
      this.showLevelBanner();
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
    this.teamLevel = GameConfig.level.cap; // ★拔等級:重開也固定滿等
    this.teamExp = 0;
    this.teamExpAtLevelStart = 0;
    this.playerAttackQueued = false;
    // v27 波次制：重置回第 1 波
    this.currentWave = 1;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnRefilling = false; // ★階段2a:重置 drip latch
    this.nearSpawned = 0; this.fieldSpawned = 0; this.nearSeatCursor = 0; // ★階段2b:重置分配計數
    this.itemsEnabled = GameConfig.items.spawnEnabled; // ★道具開關:重開回到 config 預設
    this.waveQuota = this.computeWaveQuota(1);
    this.waveState = 'spawning';
    this.intermissionUntil = 0;
    // ★關卡系統重置
    this.currentLevel = 1;
    this.currentSub = 'A';
    this.eventBag = []; // ★事件洗牌佇列:重開清空→下次要事件時重洗一輪
    this.subWavesDone = 0;
    this.subWavesTarget = GameConfig.stage.wavesA;
    this.lastChoice = 'L';
    this.progressPhase = 'playing';
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
    this.clearCrossArrows();
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    if (this.levelBanner) { this.levelBanner.destroy(); this.levelBanner = null; }
    this.boss = null;
    this.bossCount = 0;
    this.bossAnchors = []; // v36
    this.eventKind = null;
    // ★事件開場宣告狀態重置(防殘留/鎖操作卡死)
    this.eventIntroActive = false;
    this.eventIntroStage = 'done';
    this.eventIntroSlideDone = false;
    this.pendingEventKind = null;
    if (this.eventIntroBanner) { this.eventIntroBanner.destroy(); this.eventIntroBanner = null; }
    // ★階段2聚焦殘留清除
    this.eventFocusPause = false;
    this.eventFocusPanning = false;
    this.eventFocusTarget = null;
    if (this.eventFocusDim) { this.eventFocusDim.destroy(); this.eventFocusDim = null; }
    if (this.eventFocusGlow) { this.eventFocusGlow.destroy(); this.eventFocusGlow = null; }
    this.tower = null;
    this.treasureEnemy = null; // ★寶箱怪:重開清參照(敵人群由 resetState 其他處清)
    if (this.treasureBanner) { this.treasureBanner.destroy(); this.treasureBanner = null; }
    this.pendingEventComplete = false;
    this.pendingSubZoneComplete = false; // ★重開清延後切換旗標
    this.guardNpc = null;
    if (this.guardHighlight) { this.guardHighlight.destroy(); this.guardHighlight = null; }
    if (this.captureGfx) { this.captureGfx.destroy(); this.captureGfx = null; }
    this.captureProgress = 0;
    this.captureWaveActive = false; // v39
    this.towerBeamGroup = 0;        // v39
  }

  /** v28：本波是否為 BOSS 波 */
  private isBossWave(wave: number): boolean {
    // v39：8 關循環，第 8/16/24… 關為 BOSS 關（壓軸）
    return wave % GameConfig.wave.wavesPerCycle === 0;
  }

  /**
   * ★第二輪:關卡制的 BOSS 關判斷。關4=第一輪中場 BOSS(打完接關5森林,不通關);
   * 關 totalLevels(=8)=第二輪壓軸 BOSS(打完 triggerClear 真通關)。
   */
  private isBossLevel(lv: number): boolean {
    return lv === 4 || lv === GameConfig.stage.totalLevels;
  }

  /** ★是否為【最終關】(打完真通關結束)——= totalLevels。 */
  private isFinalLevel(lv: number): boolean {
    return lv >= GameConfig.stage.totalLevels;
  }

  /** v33/39：本波是否事件波——8 關循環中的第 3/5/7 關（循環內位置 ∈ eventWaves） */
  private isEventWave(wave: number): boolean {
    if (this.isBossWave(wave)) return false;
    const per = GameConfig.wave.wavesPerCycle;
    const pos = ((wave - 1) % per) + 1; // 1..8 循環內位置
    return (GameConfig.wave.eventWaves as readonly number[]).includes(pos);
  }

  /** v33/39：本波輪到哪個事件——第3關→tower、第5關→guard、第7關→capture（依 eventWaves 順序輪替） */
  private eventKindForWave(wave: number): 'tower' | 'guard' | 'capture' {
    const per = GameConfig.wave.wavesPerCycle;
    const pos = ((wave - 1) % per) + 1;
    const idx = Math.max(0, (GameConfig.wave.eventWaves as readonly number[]).indexOf(pos));
    return (['tower', 'guard', 'capture'] as const)[idx % 3];
  }

  /** v27/42：第 N 波怪數 = baseQuota + (N-1)*quotaGrowth，夾 quotaCap；第8/9關(preBoss)×preBossQuotaMult 爆量 */
  private computeWaveQuota(wave: number): number {
    const w = GameConfig.wave;
    let q = w.baseQuota + (wave - 1) * w.quotaGrowth;
    // v42：BOSS 前高潮關(循環內第 8/9 位)怪量加成
    const per = w.wavesPerCycle;
    const pos = ((wave - 1) % per) + 1;
    if ((w.preBossWaves as readonly number[]).includes(pos)) q *= w.preBossQuotaMult;
    q = Math.min(w.quotaCap, Math.round(q));
    // ★階段2b 初期量:早期波次 targetProgress 太低→drip 填不滿 maxAlive→場面偏空。
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
    // ★v8:slow 模式下 BOT 也【noHpLoss 打不死】(與 P1 無差異;fast 則會死,不設)。P1 的 noHpLoss 在 create() 另設。
    if (this.controlMode === 'slow') c.noHpLoss = true;
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
    // v59：木箱擋角色的碰撞改用【每幀手動分離 blockCharacterFromBreakables】(Arcade circle collider 高速會 creep 穿透)。
    return c;
  }

  /** 按 B：逐一加入一隻 BOT，最多湊滿 characters.count（含已加入過/已陣亡） */
  private tryAddBot(): void {
    if (this.gameOver) return;
    if (this.characters.length >= GameConfig.characters.count) return; // 已滿
    const index = this.characters.length; // 下一個索引 = 目前人數
    this.createCharacter(index, true);
  }

  /** ★事件系統：偵測目前存活的角色數量（用於動態難度調整） */
  private getAliveCharacterCount(): number {
    return this.characters.filter(c => c.alive).length;
  }

  /** ★事件系統：根據玩家數量計算難度係數 */
  private calculateEventDifficultyMultiplier(playerCount: number): number {
    const multipliers = GameConfig.event.dynamicDifficulty.playerCountMultipliers;
    return multipliers[playerCount] ?? multipliers[1] ?? 1.0; // 預設單人難度
  }

  update(time: number, delta: number): void {
    if (this.gameOver) return;

    this.survivalMs += delta;

    // ★事件波開場宣告(階段1):eventIntroActive 期間【鎖操作+凍事件生怪】,只跑開場大字時序 + 標記重繪。
    //   序列跑完(或逾時保底)finishEventIntro→beginEventCombat 才啟動事件計時/生怪。
    if (this.eventIntroActive) {
      this.updateEventIntro(time, delta);
      // ★階段3:introMove 走位段由 updateEventIntroWalk 驅動位置(不清零覆蓋);其餘段角色停在原地(鎖操作)。
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

    // ★關卡系統階段機:
    // panning(平移中)/transition(閃黑中)→凍結玩家/怪/攻擊,只讓 camera pan/fade 跑(Phaser 內部驅動)。
    if (this.levelMode) {
      if (this.progressPhase === 'panning' || this.progressPhase === 'transition') {
        // 凍結遊戲邏輯,但★⑦仍重繪【身體範圍圓圈/面向圈】跟著角色(平移/閃黑移動後圓圈不留原地)。
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      // ★新鏡頭機制:crossing 的鏡頭 pan 期間(碰A右緣→pan到B中心)【凍結玩家】讓鏡頭乾淨移動;
      //   pan 完 callback 轉 crossPhase='enter' 後,角色【自動走進B】(非玩家操控,過場演出)。
      if (this.crossingOpen && this.crossPhase === 'panning') {
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      // ★新機制步驟3:'enter'——角色【自動移動】往右走進 B(玩家不操控);到 zoneBRight.left→arriveAtSideB。
      if (this.crossingOpen && this.crossPhase === 'enter') {
        this.autoWalkIntoB(delta);
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      // ★③關卡間閃黑後:levelEntering 期間全隊自動走到 A 中心定位(玩家不操控);到位恢復。
      if (this.levelEntering) {
        this.updateLevelEnter(delta);
        this.drawLockMarkers();
        this.emitAim();
        return;
      }
      if (this.progressPhase === 'choosing') { this.updateChoosing(); this.pulseChoice(time); }
      else if (this.progressPhase === 'exiting') { this.updateExiting(); this.pulseChoice(time); }
      // ★階段1:crossing 開放期間(progressPhase 仍 'playing',玩家自由走動不凍結)→偵測走進右 B。
      if (this.crossingOpen) this.updateCrossing();
      // ★進B鏡頭跳一下修:進B後等鏡頭平滑捲進 slotB 範圍才收 bounds(避免硬收 clamp 跳)。
      if (this.pendingCamSlot) this.updatePendingCamShrink();
    }

    // v13：時間暫停到期 → 解除
    if (this.timeStopped && time >= this.timeStopUntil) {
      this.timeStopped = false;
      this.timeStopOwner = null; // ★v63:時停結束→清 owner(全部角色恢復可動)
      // v45(2)：把凍結期間「該不流失的進度」補回——所有敵人絕對時間戳 + 塔/BOSS 發招時間戳整批後移 frozenDur，
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
        if (this.bossGapBallAt > 0) this.bossGapBallAt += frozenDur;
        // ★④ 寶箱怪時間戳(跑點停頓/出生限時)也後移,凍結期間不流失(否則暫停後跑點/限時錯亂)
        const tr = this.treasureEnemy;
        if (tr && tr.active) {
          tr.treasureSpawnAt += frozenDur;
          if (tr.treasurePauseUntil > 0) tr.treasurePauseUntil += frozenDur;
        }
      }
    }

    // v55：強化期間能量每秒倒退(drainPerSec)，退到 0 → 解除強化。intermission 期間【暫停倒退】(凍結)。
    // ★v8:BOT 也有能量強化→對【所有角色】做倒退解除(不再只 P1)。
    // ★B 修:強化能量消退在【非戰鬥時暫停(凍結drain不扣)】——避免玩家在過場/間隔浪費強化時間。
    //   涵蓋:①波次間隔 intermission ②crossing 鏡頭平移/自動走進B(panning/enter)③閃黑轉場後自動走位(levelEntering)
    //   ④關卡間閃黑(transition)⑤選邊/出口過場(choosing/exiting)⑥★時停道具發動中(timeStopped:全場凍結→強化倒數也凍,不白白流失)。
    const drainPaused =
      this.waveState === 'intermission' ||
      this.levelEntering ||
      this.crossingOpen ||   // ★①修:涵蓋 crossing 全期(含 walk 選左右走廊)——強化中選左右能量不扣
      this.progressPhase === 'panning' || this.progressPhase === 'transition' ||
      this.progressPhase === 'choosing' || this.progressPhase === 'exiting' ||
      this.timeStopped;      // ★⑥時停道具生效中:全場凍結,強化能量不 drain(時停結束才恢復)
    if (!drainPaused) {
      for (const ch of this.characters) {
        if (!ch.alive || !ch.empowered) continue;
        ch.energy = Math.max(0, ch.energy - GameConfig.energy.drainPerSec * (delta / 1000));
        if (ch.energy <= 0) {
          ch.energy = 0;
          ch.empowered = false; // 能量耗盡 → 解除強化(視覺 aura 由 follow 事件自清)
          if (ch === this.player) this.emitStats();
        }
      }
    }

    // v34：intermission 期間凍結「道具消失倒數」（每幀往後推 delta）；fast 強化倒數也凍結。
    if (this.waveState === 'intermission') {
      if (this.player.empowerUntil > time) this.player.empowerUntil += delta; // fast 強化倒數凍結(slow 用 empowered 旗標不受此)
      for (const child of this.items.getChildren()) {
        const it = child as Item;
        if (it.active) it.shiftExpire(delta);
      }
    }

    this.handleSpawning(delta);
    if (this.waveState === 'event') this.updateEvent(time);
    if (this.waveState === 'boss') this.updateBossGapBalls(time); // v38：gap 空檔丟球
    this.updateEnemies(time);
    this.updateTreasure(time); // ★寶箱怪:跑點移動/金光閃爍/限時跑走
    this.finishPendingSubZoneIfTreasureGone(); // ★延後的場景切換:寶箱怪死/離場後才開啟
    // v62:守護事件——怪移動後把怪推回守護目標外圈(不疊上去);玩家仍可穿越。放 updateEnemies 之後→怪這幀先移動再被推出,渲染前已在外緣。
    if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc) this.separateEnemiesFromGuardNpc(this.guardNpc);
    this.updateItems(delta, time);
    this.updateBreakables(delta); // v62：可推動物件的速度整合/摩擦/邊界/物件間分離
    this.updateBullets(time);
    this.updateChargerCollisions(time);

    // v46 slow：先更新 P1 面向(aimAngle)+鍵盤八方向移動，再算鎖定/處理攻擊（同幀用最新面向，無延遲）。
    if (this.controlMode === 'slow') this.handleSlowMovement(time);

    // P1：更新自動鎖定目標（滑鼠只選鎖誰，方向由目標決定）
    this.updateLockTarget(time);
    // v15：把 P1 鎖定鏡射到角色上，供多色點標記統一繪製
    this.player.lockedTarget = this.lockedTarget as unknown as
      (Phaser.GameObjects.GameObject & { x: number; y: number }) | null;

    // P1：玩家輸入（招式演出鎖定中忽略輸入，角色不受玩家操控）
    // ★v63:時停期間非 owner 的 P1 被凍→忽略攻擊輸入(不能行動)。
    if (this.player.alive && this.playerAttackQueued) {
      this.playerAttackQueued = false;
      if (!this.player.isSkillLocked(time) && !this.isFrozenByTimestop(this.player)) {
        this.tryAct(this.player, time);
      }
    }
    // BOT：AI 決策（招式演出鎖定中略過）★v63:時停期間非 owner 的 BOT 被凍→停速度、不跑 AI。
    for (let i = 1; i < this.characters.length; i++) {
      const bot = this.characters[i];
      if (!bot.alive) continue;
      if (this.isFrozenByTimestop(bot)) { (bot.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0); continue; }
      if (!bot.isSkillLocked(time)) this.updateBot(bot, time);
    }

    // v46 slow：P1 鍵盤八方向持續移動 + 更新面向已在上方(updateLockTarget 前)處理。

    // 角色推進：招式演出鎖定中不跑 handleDash（角色由演出 tween 驅動），仍夾在場內 + 標籤跟隨
    for (const c of this.characters) {
      if (!c.alive) continue;
      // ★v63:時停期間非 owner 角色【完全凍結】(停速度、不衝刺推進),owner 不受影響。
      if (this.isFrozenByTimestop(c)) {
        (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        this.clampToArena(c);
        c.syncLabel();
        continue;
      }
      if (!c.isSkillLocked(time)) this.handleDash(c, time);
      // v17：人型面朝方向（招式演出/爆發期間由各自 tween 控制，不覆蓋）
      // v18.1：衝刺中面朝「固定衝刺終點方向」，避免換鎖定(改 aimAngle)讓角色亂轉；否則面朝 aimAngle
      if (!c.isSkillLocked(time) && !c.isBursting) {
        if (c.isDashing) {
          c.setRotation(Math.atan2(c.dashDestY - c.y, c.dashDestX - c.x));
        } else {
          c.setRotation(c.aimAngle);
        }
      }
      // v40(3)：戰鬥時角色與一般怪輕微分離（不完全重疊）；衝刺中不套用(不影響衝刺打擊貼近手感)
      if (!c.isDashing && !c.isSkillLocked(time)) this.separateCharacterFromEnemies(c);
      // v59：木箱擋角色（不可穿越）——每幀手動把重疊木箱的角色推回木箱外緣(可靠、高速不穿透)；衝刺中不套用(衝刺撞破)
      if (!c.isDashing && !c.isSkillLocked(time)) this.blockCharacterFromBreakables(c);
      // ★塔/BOSS 實體碰撞:角色不可穿過塔/BOSS 本體(含衝刺中也擋,不讓穿王/塔身)
      this.blockCharacterFromStructures(c);
      this.clampToArena(c);
      c.syncLabel();
    }

    // v15：結算本幀道具互搶（位置近者得、原子拿取、避免雙重觸發）
    this.resolvePickups();

    this.drawLockMarkers();
    this.emitStats();
    this.emitAim();
  }

  // ---------------------------------------------------------------------------
  // 自動鎖定（v12；v14.2：候選同時含敵人與道具，滑鼠指向誰就鎖誰）
  // ---------------------------------------------------------------------------
  /** v14.2：鎖定目標是否為道具 */
  private isItem(t: Enemy | Item | null): t is Item {
    return t instanceof Item;
  }

  /** v14.2：鎖定目標目前是否有效（敵人=可傷、道具=場上存在） */
  private isLockValid(t: Enemy | Item | null): boolean {
    if (!t || !t.active) return false;
    if (this.isItem(t)) return true;
    const e = t as Enemy;
    if (e.enemyType === 'npc') return false; // v34：守護 NPC 不可鎖定
    if (e.enemyType === 'anchor') return true; // v36：BOSS 戰錨點【可鎖定】（走位落點），雖不可被玩家傷害
    return e.isVulnerable();
  }

  /** v36：敵人是否可被鎖定/瞄準候選——可傷的怪 或 anchor（可鎖走位點）；排除 npc 與不可傷者。 */
  private isLockableEnemy(e: Enemy): boolean {
    if (!e.active) return false;
    if (e.enemyType === 'npc') return false;
    if (e.enemyType === 'anchor') return true;
    return e.isVulnerable();
  }

  private updateLockTarget(time: number): void {
    // v54 slow 鎖定【重做】：純鍵盤——面向 aimAngle + 範圍圈 lockRadius。
    //   用戶需求：只要藍圈內有敵人，按空白就一定鎖去打——面向【對著】的敵人(35°錐內)優先；面向沒對著
    //   任何敵人但圈內有敵→鎖【圈內最近】的；圈內完全無敵→不鎖(按空白朝面向衝一段)。
    //   ★避免 v50 箭頭翻轉 bug：用【黏著式】——已鎖且目標存活在圈內就【維持】，不每幀重搶、也【不因面向
    //   轉離而脫鎖】(v52 那樣會跟「圈內有就鎖」打架造成每幀翻轉)。只有目標死/離圈才重新取得。玩家主動把
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
    // v30 融合模式（autoLock=false）：鎖定 = 滑鼠方向錐形內最接近的怪（給鎖定框顯示 + actByAim 用）；
    // 錐形內無怪則 null（朝空地走位、不畫框）。
    if (!GameConfig.aim.autoLock) {
      if (!this.player.alive) { this.lockedTarget = null; return; }
      let t = this.pickAimConeTarget(this.player);
      // v39(4)：滑鼠靜止且沒指到目標 → HUD 也顯示自動鎖最近的怪（與 actByAim 一致）
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
   * v15：多角色鎖定標記——同一目標(敵人或道具)只畫「一個共用框」，
   * 框上緣排開多個小色點，每點代表一個正鎖定此目標的角色(各自代表色)。
   * 支援 P1 + 多 BOT(未來多真人)鎖同目標而不重疊；目標消失/沒人鎖即不畫。
   */
  private drawLockMarkers(): void {
    this.lockGfx.clear();
    const m = GameConfig.lock.marker;

    // v46 slow：畫玩家周圍的【自動鎖定範圍圈】(半透明圈+環)。只 slow 顯示、fast 不畫。
    // v47：半徑改讀即時可調 slowTuning.lockRadius；移除面向指示線(只留圈+環)。
    if (this.controlMode === 'slow' && this.player.alive) {
      const R = this.slowTuning.lockRadius;
      const px = this.player.x, py = this.player.y;
      this.lockGfx.fillStyle(0x66ccff, 0.05);
      this.lockGfx.fillCircle(px, py, R);
      this.lockGfx.lineStyle(2, 0x66ccff, 0.35);
      this.lockGfx.strokeCircle(px, py, R);
    }

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

    // v15：BOT 目標 = 最近敵人 或「範圍內、越稀有越想搶」的道具（積極度中等，不為遠道具送死）
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

    // ★v8:BOT 與 P1 無差異——爆發不再靠舊 spiritFull,改由連段技系統(onComboHit combo 達門檻9)自動觸發,同 P1。
    // 有目標才出手（近了扇形、遠了衝撞、道具則衝去搶，與 P1 共用 tryAct;命中→onComboHit 累積 combo→達門檻放圓/直/爆發）
    if (target) {
      this.tryAct(bot, time);
    }
  }

  /**
   * v15：BOT 目標選擇——比較「最近敵人」與「範圍內最誘人的道具」，取較優者。
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
  // 角色行動（P1 與 BOT 共用）：v12 朝「鎖定目標」帶位移的一擊（可追砍）
  // ---------------------------------------------------------------------------
  /** v51(2)：不可推動的大型「不動」目標(BOSS/塔)——攻擊這些時停外緣原地揮、不衝進中心避免重疊。
   *  (anchor 是走位落點、玩家本就要衝過去，不算此類；一般怪可推動維持衝上去打。) */
  private isImmovableLargeTarget(e: Enemy | null): boolean {
    if (!e || !e.active) return false;
    return e.isBoss || e.enemyType === 'tower';
  }

  /**
   * v51(2)：對 BOSS/塔停外緣原地揮擊——把角色移到目標外緣 standoff(目標半徑+玩家半徑+margin)一次(若比現在近才移，
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
      c.nextAttackAllowedAt = time + GameConfig.player.attackCooldownMs;
      return;
    }
    // 還在攻擊範圍外 → 朝目標衝，但終點設在【外緣 standoff】而非中心 → 衝到外緣停、不穿進去
    const destX = target.x - Math.cos(c.aimAngle) * standoff;
    const destY = target.y - Math.sin(c.aimAngle) * standoff;
    this.beginDash(c, destX, destY, time, false);
  }

  private tryAct(c: Character, time: number): void {
    if (c.isBursting || c.isDashing) return;
    if (c.isRooted(time)) return; // v34：定身中不能行動（攻擊會位移）
    if (time < c.nextAttackAllowedAt) return;

    // ★v62 階段4:slow 模式 P1 強化(empowered)期間【唯一招=遠距圓範圍AOE】——
    //   Space 放【以角色為中心的圓 AOE】(不衝刺)、禁用普攻/連段;放完進冷卻。強化結束恢復正常攻擊。
    if (c === this.player && this.controlMode === 'slow' && c.empowered) {
      this.empowerAoe(c, time);
      return;
    }

    // ★v8:移除舊「BOT spiritFull→原地爆發」——BOT 已與 P1 無差異,爆發由連段技系統(onComboHit combo 達9)觸發。

    // v29：滑鼠方向優先模式（僅 P1）——攻擊方向直接用 aimAngle，不被自動鎖定綁死
    // v46：slow 模式不走 actByAim（那含滑鼠靜止自動鎖/mouse 邏輯）；改走下方「用 this.lockedTarget」通用路徑——
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
      // ★A 修:crossing 走廊無目標時,衝刺【朝角色當前面向 aimAngle】(面向左往左、面向右往右)——
      //   不再固定導向右(0)。之前導向右是為修「fast aimAngle 殘留反向往回衝」,但過度修正成面向左也往右。
      //   直接用玩家目前 aimAngle 即可(面向哪就往哪衝),不覆蓋。
      this.startDirectionDash(c, time);
      return;
    }

    // v14.2：鎖定的是道具 → 朝道具衝撞位移過去（碰到由 overlap 觸發拾取）
    if (this.isItem(target)) {
      c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, target.x, target.y);
      this.startDirectionDashTo(c, target.x, target.y, time);
      return;
    }

    // v51(2)：鎖定的是【不可推動的大型不動目標(BOSS/塔)】→ 不衝進中心(會重疊)，改停外緣原地揮擊。
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
      c.nextAttackAllowedAt = time + GameConfig.player.attackCooldownMs;
      return;
    }
    // 遠：朝目標衝撞位移（衝刺遇敵停下打 + 衝擊特效）
    this.startDirectionDash(c, time);
  }

  /**
   * v30 融合瞄準（僅 P1，autoLock=false 為融合模式預設）：
   * 在滑鼠 aimAngle 方向的「錐形範圍(±aimConeDeg, searchRadius 內)」找可傷敵人：
   * · 找得到 → 選最接近滑鼠方向的那隻當鎖定目標，攻擊朝它（自動鎖定黏敵；近則原地扇形、遠則衝刺遇敵停）。
   * · 錐形內無怪（滑鼠指空方向）→ 朝滑鼠 aimAngle 自由衝刺位移（走位，不被拉回最近怪）。
   */
  private actByAim(c: Character, time: number): void {
    let target = this.pickAimConeTarget(c);
    // v39(4)：滑鼠【靜止】(超過 aimActiveWindowMs 沒動)且錐形內沒指到目標 → 自動鎖【最近的可傷怪】(不鎖 anchor)，
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
      // v44：鎖定的是道具 → 朝道具位置衝過去撿（碰到由 overlap 觸發拾取，無磁吸）
      if (this.isItem(target)) {
        this.startDirectionDashTo(c, target.x, target.y, time);
        return;
      }
      const dist = Phaser.Math.Distance.Between(c.x, c.y, target.x, target.y);
      // v36：鎖定的是 anchor（走位落點）→ 一律衝過去(不管遠近)，衝到停外緣不攻擊不傷害（handleDash 的 anchor 分支）
      if ((target as Enemy).enemyType === 'anchor') {
        this.startDirectionDash(c, time);
        return;
      }
      // v51(2)：鎖定 BOSS/塔(不可推動大型不動目標)→ 停外緣原地揮擊、不衝進中心重疊(快速模式路徑)。
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
        c.nextAttackAllowedAt = time + GameConfig.player.attackCooldownMs;
      } else {
        // 遠：朝該怪衝刺（沿用遇敵停下）
        this.startDirectionDash(c, time);
      }
      return;
    }
    // 錐形內無怪：清鎖定 + 朝面向自由衝刺位移
    this.lockedTarget = null;
    c.lockedTarget = null;
    // ★A 修:crossing 走廊無敵人按攻擊→【朝角色當前面向 aimAngle 衝】(面向左往左、右往右),
    //   不再固定導向右(0)。移除過度修正(原為修 fast 反向往回衝,但造成面向左也往右)。
    this.startDirectionDash(c, time);
  }

  /**
   * v54 slow：在 lockRadius 圈內找【最近】的可鎖敵人(不限角度)——面向沒對著任何敵人但圈內有敵時，
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
   * v30：在 c.aimAngle 方向的錐形(±aimConeDeg, searchR 內)找「最接近方向」的可鎖目標(敵/anchor/道具)。
   * 錐形外的不鎖（才能朝空地走位）。無則回 null。
   * v44：道具納入候選(略優先)。
   * v46：參數化——searchR 預設 fast 的 lock.searchRadius；slow 傳 slow.lockRadius(範圍圈)。
   *      limitAnchors=true 時 anchor 也受 searchR 限制(slow 範圍圈內才鎖 anchor)；fast 維持 anchor 不受 searchRadius 限。
   *      方向源永遠是 c.aimAngle——fast=滑鼠、slow=鍵盤面向，下游無感。
   */
  private pickAimConeTarget(
    c: Character,
    searchR: number = GameConfig.lock.searchRadius,
    limitAnchors = false
  ): Enemy | Item | null {
    const cone = Phaser.Math.DegToRad(GameConfig.aim.aimConeDeg);
    // v37fix：玩家「腳下」很近的目標(尤其站在錨點上時距≈0)方向不穩定、又因距離小恆被選，
    // 會黏死在腳下錨點/目標導致切不到 BOSS。低於此距離的候選一律排除，讓滑鼠能指向他處。
    const underfootR = GameConfig.player.radius + 12;
    let best: Enemy | Item | null = null;
    let bestScore = Infinity; // 已套用道具優惠後的「有效角度差」
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!this.isLockableEnemy(enemy)) continue; // v36：含 anchor（可鎖）、排除 npc/不可傷
      const dist = Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y);
      if (dist <= underfootR) continue; // v37fix：腳下目標排除（不能瞄、避免黏死）
      // v37：fast 下 anchor 不受 searchRadius 限制(BOSS 四錨點需自由切換)；v46 slow(limitAnchors)則一律受範圍圈限制
      if ((limitAnchors || enemy.enemyType !== 'anchor') && dist > searchR) continue;
      const toE = Phaser.Math.Angle.Between(c.x, c.y, enemy.x, enemy.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(toE - c.aimAngle));
      if (diff > cone) continue; // 錐形外不鎖
      if (diff < bestScore) {
        bestScore = diff;
        best = enemy;
      }
    }
    // v44：道具納入候選（滑鼠/面向指向道具方向可鎖它去撿）；角度差打折 → 略優先於敵人。
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
   * v39(4)：找最近的「可傷怪」（供滑鼠靜止時自動鎖）。排除 anchor/npc/不可傷者——
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
    // v14：扇形半徑/角度隨等級變大；v31：強化狀態範圍×rangeMult
    const emp = c.isEmpowered(time);
    const rangeMult = emp ? GameConfig.combo.empower.rangeMult : 1;
    const radius = levelLerp(cfg.radius, GameConfig.level.character.meleeRadiusLv1Scale, this.teamLevel) * rangeMult;
    const arcDeg = levelLerp(cfg.arcDeg, GameConfig.level.character.meleeArcDegLv1Scale, this.teamLevel);
    const half = Phaser.Math.DegToRad(arcDeg) / 2;
    // v21：普攻傷害隨等級；v31：強化狀態 ×damageMult
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
    // v57：普攻揮擊範圍(扇形)內順手打破可打破物件(不鎖定、不算 combo)
    this.hitBreakablesInRange(c, radius, half, true, atk, time);
    // v31：這次攻擊命中(≥1隻) → combo/鬥氣累積（P1 走連段系統、BOT 走舊鬥氣）
    if (hitCount > 0) {
      this.onComboHit(c, time);
    }
    this.flashWhite(c);
    this.spawnMeleeArcEffect(c.x, c.y, c.aimAngle);
  }

  /**
   * v47：慢速模式即時調參欄位——三列(藍圈lockRadius/衝刺距離dashDistance/衝刺速度dashSpeed)，
   * 每列 −/+ 按鈕(滑鼠點擊,不佔用方向鍵/空白鍵)即時調整 this.slowTuning，立刻生效。
   * v48(1)：下限放寬(dashDistance→80、dashSpeed→400、lockRadius→60)。
   * v48(2)：面板移到【右側垂直排列】，避開下方角色 HUD 狀態列(h-52 那排)與上方 HUD，不重疊。
   */
  private createSlowTuningPanel(): void {
    // ★UI調整①:用戶要求隱藏慢速即時調參面板→直接 early-return(保留下方程式供日後除錯)。
    if (!GameConfig.debug?.showSlowTuningPanel) return;
    const W = GameConfig.width;
    const DEPTH = 40; // 高於遊戲物件
    // 面板：右側垂直長條(避開頂部 team/wave HUD 與底部 4 欄角色狀態列)
    const panelW = 176;
    const panelX = W - panelW - 8; // 貼右邊
    const panelY = 150;            // 頂部 HUD(Lv/expbar 到 ~116)之下
    const rowGap = 78;
    const panelH = 24 + rowGap * 3;
    this.add.rectangle(panelX, panelY, panelW, panelH, 0x0a0c14, 0.72).setOrigin(0, 0).setDepth(DEPTH);
    this.add.rectangle(panelX, panelY, panelW, 2, 0x66ccff, 0.6).setOrigin(0, 0).setDepth(DEPTH + 1);
    this.add.text(panelX + 8, panelY + 5, '慢速即時調參', {
      fontFamily: 'monospace', fontSize: '13px', color: '#9adcff'
    }).setDepth(DEPTH + 1);

    type Key = 'lockRadius' | 'dashDistance' | 'dashSpeed';
    const rows: Array<{ key: Key; label: string; min: number; max: number; step: number }> = [
      { key: 'lockRadius', label: '藍色範圍', min: 60, max: 500, step: 20 },
      { key: 'dashDistance', label: '衝刺距離', min: 80, max: 600, step: 20 },
      { key: 'dashSpeed', label: '衝刺速度', min: 400, max: 2200, step: 100 }
    ];
    rows.forEach((row, i) => {
      const cx = panelX + 8;
      const cy = panelY + 26 + rowGap * i;
      this.add.text(cx, cy, row.label, {
        fontFamily: 'monospace', fontSize: '14px', color: '#e2e8f0'
      }).setDepth(DEPTH + 1);
      // 數值文字
      const valText = this.add.text(cx, cy + 20, String(this.slowTuning[row.key]), {
        fontFamily: 'monospace', fontSize: '20px', color: '#ffe066', fontStyle: 'bold'
      }).setDepth(DEPTH + 1);
      const mkBtn = (bx: number, sign: '−' | '+', delta: number): void => {
        const bg = this.add.rectangle(bx, cy + 28, 34, 34, 0x334155, 0.95)
          .setStrokeStyle(2, 0x66ccff, 0.8).setDepth(DEPTH + 1)
          .setInteractive({ useHandCursor: true });
        this.add.text(bx, cy + 28, sign, {
          fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(DEPTH + 2);
        bg.on('pointerover', () => bg.setFillStyle(0x475569, 1));
        bg.on('pointerout', () => bg.setFillStyle(0x334155, 0.95));
        bg.on('pointerdown', () => {
          const next = Phaser.Math.Clamp(this.slowTuning[row.key] + delta, row.min, row.max);
          this.slowTuning[row.key] = next;
          valText.setText(String(next)); // 即時更新顯示（圈/衝刺讀 slowTuning，下一幀自動生效）
        });
      };
      mkBtn(cx + 92, '−', -row.step);
      mkBtn(cx + 132, '+', row.step);
    });
  }

  /**
   * v46 slow：P1 鍵盤八方向持續移動（正常速度走，非瞬移）+ 更新面向 aimAngle。
   * 只在【非衝刺、非招式鎖定、非定身】時跑；衝刺中由 handleDash 控速度(共用 fast)。
   * 對角線正規化(不 √2 倍速)；有輸入才更新 aimAngle(無輸入維持最後面向)。邊界由 clampToArena 共用。
   */
  /** ★v63:時停道具期間,此角色是否【被凍結】(非撿到者 owner 的角色都凍;owner 能動)。 */
  private isFrozenByTimestop(c: Character): boolean {
    return this.timeStopped && c !== this.timeStopOwner;
  }

  private handleSlowMovement(time: number): void {
    const p = this.player;
    if (!p.alive) return;
    const body = p.body as Phaser.Physics.Arcade.Body;
    // ★v63:時停道具期間,非 owner 的角色(此處 P1)【被凍結不能操控移動】(owner 才能動)。
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
    const spd = GameConfig.slow.moveSpeed;
    body.setVelocity(nx * spd, ny * spd);
    // 面向 = 移動方向（決定攻擊/鎖定方向）
    p.aimAngle = Math.atan2(ny, nx);
  }

  private startDirectionDash(c: Character, time: number): void {
    // v35：強化期間走位/衝刺距離加大
    // v47：slow 模式衝刺距離改讀即時可調 slowTuning.dashDistance；fast 讀 config 常數不變。
    // ★用戶追加:slow 模式【所有角色含 BOT】都用短的 slowTuning.dashDistance(原本只 P1);fast 兩者都用 aim.dashDistance。
    const baseDist = (this.controlMode === 'slow')
      ? this.slowTuning.dashDistance
      : GameConfig.aim.dashDistance;
    const emp = c.isEmpowered(time);
    const dist = baseDist * (emp ? GameConfig.combo.empower.moveMult : 1);
    const destX = c.x + Math.cos(c.aimAngle) * dist;
    const destY = c.y + Math.sin(c.aimAngle) * dist;
    // v53：無鎖朝面向衝——若面向【對著場邊牆】(夾在場內後幾乎到不了任何地方)，衝刺會被 clamp 成原地=「按空白沒動作」。
    //   慢速模式常被逼到邊緣、面向朝外(牆)，此時 dest clamp≈原地 → 玩家覺得「沒衝」。改：偵測夾牆後實際
    //   可移動距離極小 → 改【原地揮擊(performMeleeArc)】，讓按空白一定有攻擊動作(不會像死鍵)。開曠處仍正常衝。
    //   ★只限 slow 模式(fast 維持原樣、byte 不變)。
    if (c === this.player && this.controlMode === 'slow') {
      const r = GameConfig.player.radius;
      const cx = Phaser.Math.Clamp(destX, this.arena.left + r, this.arena.right - r);
      const cy = Phaser.Math.Clamp(destY, this.arena.top + r, this.arena.bottom - r);
      const reach = Phaser.Math.Distance.Between(c.x, c.y, cx, cy);
      if (reach < GameConfig.player.radius) {
        // 面向被牆擋住、衝不出去 → 原地揮擊(仍有攻擊/命中判定)，按空白不落空。
        this.performMeleeArc(c, time);
        c.nextAttackAllowedAt = time + GameConfig.player.attackCooldownMs;
        return;
      }
    }
    this.beginDash(c, destX, destY, time, false);
  }

  /** v14.2：朝指定點（道具位置）衝撞位移過去，途中不因撞敵中止，碰到道具由 overlap 拾取 */
  private startDirectionDashTo(c: Character, x: number, y: number, time: number): void {
    this.beginDash(c, x, y, time, true);
  }

  /** 共用衝刺啟動：設定終點（夾在場內）、衝刺狀態、護盾、是否為撿道具衝刺 */
  /** ★階段2:crossing 期間玩家可走範圍——walk 未鎖定側=左右全span;鎖定側後=該側聯集。 */
  private crossClampBounds(): Phaser.Geom.Rectangle {
    if (this.crossSide === 'L') return this.crossUnionRect('L');
    if (this.crossSide === 'R') return this.crossUnionRect('R');
    // walk 未鎖定:左右都能走(zoneBLeft.left → zoneBRight.right)
    const a = this.zoneA;
    return new Phaser.Geom.Rectangle(this.zoneBLeft.left, a.top, this.zoneBRight.right - this.zoneBLeft.left, a.height);
  }

  private beginDash(c: Character, destX: number, destY: number, time: number, toItem: boolean): void {
    const r = GameConfig.player.radius;
    // ★④ crossing 期間衝刺 dest 用聯集夾取(否則被夾回 zoneA→衝不出去/看似往回)。
    const bnd = (this.crossingOpen && c === this.player) ? this.crossClampBounds() : this.arena;
    c.dashDestX = Phaser.Math.Clamp(destX, bnd.left + r, bnd.right - r);
    c.dashDestY = Phaser.Math.Clamp(destY, bnd.top + r, bnd.bottom - r);
    c.isDashing = true;
    c.dashToItem = toItem;
    c.nextAttackAllowedAt = time + GameConfig.player.attackCooldownMs;
    // v11：衝刺期間賦予護盾（無敵）+ 視覺光環，衝刺結束消失
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

    // v57/v59：衝刺撞到可打破物件→【直接打破】(衝刺是攻擊、撞碎它，不被硬擋停)。只 P1；用衝撞半徑當圓形命中。
    if (c === this.player) {
      const bkRadius = levelLerp(
        GameConfig.aim.dashHitRadius,
        GameConfig.level.character.dashHitRadiusLv1Scale,
        this.teamLevel
      );
      this.hitBreakablesInRange(c, bkRadius + GameConfig.breakable.radius, 0, false, 99999, time); // 大量傷害=一撞即破，衝刺不卡
    }

    // v14.2：衝去撿道具的衝刺，途中不因撞到敵人而中止（確保能撿到）
    if (!c.dashToItem) {
      // v14：衝撞命中半徑隨等級變大
      const hitRadius = levelLerp(
        GameConfig.aim.dashHitRadius,
        GameConfig.level.character.dashHitRadiusLv1Scale,
        this.teamLevel
      );
      const hit = this.findFirstEnemyInRangeOf(c, hitRadius);
      if (hit) {
        c.stopMoving();
        this.performAttackOn(c, hit, time);
        // v35：衝向「不可推動」大型敵人(BOSS/塔)時，停在外緣避免重疊卡住
        if (hit.isBoss || hit.enemyType === 'tower') {
          this.pushCharacterOutOf(c, hit);
        }
        this.endDashState(c);
        return;
      }
      // v35：anchor-like 位移點(NPC/錨點)——衝到附近「停在外緣、不觸發攻擊、不重疊卡住」（走位落點）
      const anchor = this.findAnchorInDashPath(c, hitRadius);
      if (anchor) {
        c.stopMoving();
        this.pushCharacterOutOf(c, anchor);
        this.endDashState(c);
        return;
      }
    }

    // 沒撞到敵人（或撿道具衝刺）→ 繼續朝「固定終點方向」衝；到終點停下。
    // v18.1 修正：衝刺速度方向改用「角色→固定終點(dashDestX/Y)」，而非 live aimAngle。
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
    // v35：強化期間衝向敵人速度加快
    // v47：slow 模式(僅 P1)衝刺速度改讀即時可調 slowTuning.dashSpeed；fast 讀 config 常數不變。
    const baseDashSpeed = (this.controlMode === 'slow' && c === this.player)
      ? this.slowTuning.dashSpeed
      : GameConfig.player.dashSpeed;
    const dashSpeed = baseDashSpeed * (c.isEmpowered(time) ? GameConfig.combo.empower.dashSpeedMult : 1);
    // v41(1)：結束門檻隨速度放大，避免高速(強化)衝刺 overshoot 過終點 → 反向 → 牆邊來回震盪。
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

  /**
   * v60→v62：怪碰到木箱/桶【推動物件】(不再擋怪)。每幀若「可推動一般怪」與物件重疊→把【物件】朝
   * 「怪→物件」方向推出重疊 + 給推速度(沿此方向)，物件自然被推著走(下面 updateBreakables 整合摩擦/邊界/物件間分離)。
   * 只怪推、不動怪AI(怪照追玩家、把擋路物件推開)。排除 boss/tower/anchor/npc。
   */
  private blockEnemyFromBreakables(e: Enemy): void {
    if (e.isBoss || e.enemyType === 'tower' || e.isAnchorLike() || e.enemyType === 'npc') return;
    if (!e.active || e.dead) return;
    const er = e.getBodyRadius();
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      const minDist = er + bk.getBodyRadius();
      const dx = bk.x - e.x, dy = bk.y - e.y; // 怪→物件方向 = 把物件往外推
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const overlap = minDist - d;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        bk.setPosition(bk.x + nx * overlap, bk.y + ny * overlap); // 推出重疊
        const spd = Math.min(GameConfig.breakable.push.maxPushSpeed, GameConfig.slow.moveSpeed);
        bk.vx += nx * spd; bk.vy += ny * spd; // 給推速度(累加,updateBreakables 會摩擦衰減)
      }
    }
  }

  /**
   * ★塔/BOSS 實體碰撞:一般怪不可穿過塔/BOSS 本體。每幀把重疊的怪【硬推回本體外緣】(全額,無 maxStep 鬆弛)。
   * 補「敵人碰撞分離」對 immovable 的鬆弛不足(衝鋒怪高速可能穿)。塔/BOSS 自己不動。
   */
  private blockEnemyFromStructures(e: Enemy): void {
    if (e.isBoss || e.enemyType === 'tower' || e.isAnchorLike() || e.enemyType === 'npc') return; // 結構本身不被此推
    if (!e.active || e.dead || e.telegraphing) return;
    const er = e.getBodyRadius();
    for (const child of this.enemies.getChildren()) {
      const s = child as Enemy;
      if (!s.active || s.dead || s.telegraphing) continue;
      if (!(s.isBoss || s.enemyType === 'tower')) continue; // 只被塔/BOSS 擋
      const minDist = er + s.getBodyRadius();
      const dx = e.x - s.x, dy = e.y - s.y; // 塔/BOSS→怪 = 把怪往外推
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const overlap = minDist - d;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        e.setPosition(e.x + nx * overlap, e.y + ny * overlap); // 怪被推出、塔/BOSS 不動
      }
    }
  }

  /**
   * 「角色→物件」方向推出重疊 + 給推速度。衝刺中不呼叫(呼叫端已擋→衝刺撞物件由 handleDash 一撞即破/引爆)。
   * → 可把爆炸桶推到怪群裡再打破。物件的速度整合/摩擦停下/邊界/物件間分離由 updateBreakables 處理。
   */
  private blockCharacterFromBreakables(c: Character): void {
    const pr = GameConfig.player.radius;
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      const minDist = pr + bk.getBodyRadius();
      const dx = bk.x - c.x, dy = bk.y - c.y; // 角色→物件方向 = 把物件往外推
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const overlap = minDist - d;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        bk.setPosition(bk.x + nx * overlap, bk.y + ny * overlap); // 推出重疊(物件離開角色)
        const spd = GameConfig.breakable.push.maxPushSpeed;
        bk.vx += nx * spd; bk.vy += ny * spd;
      }
    }
  }

  /**
   * ★塔/BOSS 實體碰撞:角色不可穿過塔/BOSS 本體(immovable 大型)。
   * 每幀把重疊塔/BOSS 圓的角色【推回本體外緣】(角色被擋、塔/BOSS 不動)。衝刺中也擋(不讓衝刺穿王/塔身)。
   */
  private blockCharacterFromStructures(c: Character): void {
    const pr = GameConfig.player.radius;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || e.telegraphing) continue;
      if (!(e.isBoss || e.enemyType === 'tower')) continue; // 只擋塔/BOSS 本體
      const minDist = pr + e.getBodyRadius();
      const dx = c.x - e.x, dy = c.y - e.y; // 塔/BOSS→角色 = 把角色往外推
      const d = Math.hypot(dx, dy);
      if (d < minDist && d >= 0) {
        const overlap = minDist - d;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        c.setPosition(c.x + nx * overlap, c.y + ny * overlap); // 角色被推出、塔/BOSS 不動
      }
    }
  }

  /**
   * v62：守護事件——把【怪】推回守護目標(NPC)外緣，怪【圍外圈打】不疊在守護目標上。
   * 用手動位置校正分離(同 blockEnemyFromBreakables，非 Arcade collider→circle collider 高速推會 creep 穿透)。
   * ★只推【怪】、【玩家可穿越】(玩家不做此分離，保留衝刺穿越走位)。防卡死:只推怪位置出重疊、不動怪AI(怪仍朝NPC攻擊、被擋自然圍外圈)、排除 boss/tower/其他 npc/anchor。
   * ★怪被擋在外緣(dist = 怪半徑+NPC半徑26 ≈ 40~48) 仍在接觸傷害範圍內(NPC半徑26+contactRange30=56)→怪照樣攻擊NPC扣血、事件正常進行。
   */
  private separateEnemiesFromGuardNpc(npc: Enemy): void {
    if (!npc.active || npc.dead) return;
    const nr = npc.getBodyRadius();
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      if (e === npc || e.isBoss || e.enemyType === 'tower' || e.enemyType === 'npc' || e.isAnchorLike()) continue;
      const minDist = e.getBodyRadius() + nr;
      const dx = e.x - npc.x, dy = e.y - npc.y;
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const overlap = minDist - d;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        // 只推怪出重疊到外緣→圍外圈;夾在場內
        const ex = Phaser.Math.Clamp(e.x + nx * overlap, this.arena.left + 20, this.arena.right - 20);
        const ey = Phaser.Math.Clamp(e.y + ny * overlap, this.arena.top + 20, this.arena.bottom - 20);
        e.setPosition(ex, ey);
      }
    }
  }

  /**
   * v62：每幀更新可推動物件——速度整合(位移)+摩擦衰減停下 + 夾在場內(推到牆停) + 物件間不重疊(互推)。
   */
  private updateBreakables(delta: number): void {
    const dt = delta / 1000;
    const children = this.breakables.getChildren();
    // 0. ★殭屍防護網:任何 active 但 dead 卻沒在 fuse(=沒進正常爆炸/回收流程)的物件→強制回收。
    //    確保「dead=true 且 active=true 且 !fusing」的殭屍桶絕不可能存在(受擊/推動迴圈開頭都靠 dead 判斷,殭屍會卡場上無法攻擊)。
    for (const child of children) {
      const bk = child as Breakable;
      if (bk.active && bk.dead && !bk.fusing) bk.despawn();
    }
    // 1. 速度整合 + 摩擦 + 邊界
    for (const child of children) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (bk.vx === 0 && bk.vy === 0) continue;
      // 位移
      let nx = bk.x + bk.vx * dt, ny = bk.y + bk.vy * dt;
      // 邊界:推到牆停(clamp + 該軸速度歸零)
      const r = bk.getBodyRadius();
      if (nx < this.arena.left + r) { nx = this.arena.left + r; bk.vx = 0; }
      else if (nx > this.arena.right - r) { nx = this.arena.right - r; bk.vx = 0; }
      if (ny < this.arena.top + r) { ny = this.arena.top + r; bk.vy = 0; }
      else if (ny > this.arena.bottom - r) { ny = this.arena.bottom - r; bk.vy = 0; }
      bk.setPosition(nx, ny);
      // 摩擦衰減
      const f = Math.max(0, 1 - GameConfig.breakable.push.friction * dt);
      bk.vx *= f; bk.vy *= f;
      if (Math.abs(bk.vx) < 3 && Math.abs(bk.vy) < 3) { bk.vx = 0; bk.vy = 0; }
    }
    // 2. 物件間不重疊(兩兩分離,各推一半;被推的桶頂到別的桶會一起被頂開)
    for (let i = 0; i < children.length; i++) {
      const a = children[i] as Breakable;
      if (!a.active || a.dead) continue;
      for (let j = i + 1; j < children.length; j++) {
        const b = children[j] as Breakable;
        if (!b.active || b.dead) continue;
        const minDist = a.getBodyRadius() + b.getBodyRadius();
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist && d > 0.001) {
          const push = (minDist - d) / 2;
          const nx = dx / d, ny = dy / d;
          a.setPosition(
            Phaser.Math.Clamp(a.x - nx * push, this.arena.left + a.getBodyRadius(), this.arena.right - a.getBodyRadius()),
            Phaser.Math.Clamp(a.y - ny * push, this.arena.top + a.getBodyRadius(), this.arena.bottom - a.getBodyRadius())
          );
          b.setPosition(
            Phaser.Math.Clamp(b.x + nx * push, this.arena.left + b.getBodyRadius(), this.arena.right - b.getBodyRadius()),
            Phaser.Math.Clamp(b.y + ny * push, this.arena.top + b.getBodyRadius(), this.arena.bottom - b.getBodyRadius())
          );
        }
      }
    }
  }

  private clampToArena(c: Character): void {
    const r = GameConfig.player.radius;
    // ★階段2:crossing 開放期間,玩家/隊友可走 [左右span 或 鎖定側聯集](不再被夾在 zoneA)。
    const bnd = this.crossingOpen ? this.crossClampBounds() : this.arena;
    const cx = Phaser.Math.Clamp(c.x, bnd.left + r, bnd.right - r);
    const cy = Phaser.Math.Clamp(c.y, bnd.top + r, bnd.bottom - r);
    const clamped = (cx !== c.x || cy !== c.y);
    if (clamped) {
      c.setPosition(cx, cy);
      // v41(1)：衝刺中撞到牆界被夾回 → 直接結束衝刺(速度歸零)，避免「clamp 拉回 vs 高速外衝」牆邊來回震盪、
      //          以及卡在 isDashing 狀態導致按攻擊衝不出去。
      if (c.isDashing) this.endDashState(c);
    }
  }

  /**
   * v40(3)→v56：角色與「一般怪」不重疊。★v56(B方案)：改成【推怪離開角色】(角色位置不動、由玩家控制)，
   * 而非原本推角色——原本推角色會被怪群從同側圍上來累加分離力推著走(失去走位感)。現在把重疊的怪各自
   * 朝「離開角色」方向推出重疊(角色不被推)，怪被角色擋在外圍不疊進來。
   * 只推【可推動一般怪】(排除 anchor/npc/tower/boss，那些各有停外緣/穿越邏輯)。角色衝刺時不套用(呼叫端已擋)，
   * 衝刺穿怪打手感不變。怪推怪(怪之間)維持原樣，這裡只改角色↔怪。
   */
  private separateCharacterFromEnemies(c: Character): void {
    const pr = GameConfig.player.radius;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      if (e.isBoss || e.enemyType === 'tower' || e.isAnchorLike()) continue; // 非可推動大型/位移點跳過
      const minDist = pr + e.getBodyRadius();
      const dx = e.x - c.x, dy = e.y - c.y; // v56：方向 = 角色→怪 (把怪往外推)
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const overlap = minDist - d;
        let nx: number, ny: number;
        if (d > 0.001) { nx = dx / d; ny = dy / d; }
        else { nx = 1; ny = 0; } // 完全重疊：給預設外推方向
        // 把怪推到剛好不重疊(全額 overlap)，夾在場內。角色位置完全不動。
        const er = e.getBodyRadius();
        const nex = Phaser.Math.Clamp(e.x + nx * overlap, this.arena.left + er, this.arena.right - er);
        const ney = Phaser.Math.Clamp(e.y + ny * overlap, this.arena.top + er, this.arena.bottom - er);
        e.setPosition(nex, ney);
      }
    }
  }

  /**
   * v35：找出衝刺路徑上「即將重疊到的 anchor-like 位移點」(NPC/錨點)。
   * 用「角色與其中心距離 ≤ 敵半徑 + 玩家半徑 + 邊界」判定重疊在即，回傳最近的一個。
   * anchor-like 不可被玩家傷害，這裡只用來讓衝刺停在外緣（走位落點），不攻擊。
   */
  private findAnchorInDashPath(c: Character, extra: number): Enemy | null {
    // v37fix：只在「往該 anchor 方向衝」時才停下——避免站在某 anchor 上往別處(BOSS/別錨點)衝時，
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
      // v43：守護目標 NPC 可被衝刺【穿越】——不當作攔停落點（其他 anchor：塔走位錨點/佔領錨點 維持攔停）。
      //      讓玩家站 NPC 一側、敵人在另一側時，瞄敵人衝刺能穿過 NPC 打到後方的敵人，而非被 NPC 外緣攔停。
      if (e === this.guardNpc) continue;
      const reach = e.getBodyRadius() + GameConfig.player.radius + extra;
      const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
      // v37fix：站在(或極貼近)某 anchor 上時，該 anchor 不當作攔停點——玩家正要離開它衝往他處
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

  /**
   * v35：衝向「不可推動」大型敵人(BOSS/塔) 或 anchor-like 位移點(NPC/錨點) 後，
   * 若角色與其重疊，把角色移到外緣站定，避免卡在牠身上。
   * 站位方向 = 敵人中心 → 角色（角色原本靠近的一側）；退到 (敵半徑 + 玩家半徑 + margin)。
   */
  private pushCharacterOutOf(c: Character, e: Enemy): void {
    const standoff = e.getBodyRadius() + GameConfig.player.radius + 6;
    const dx = c.x - e.x;
    const dy = c.y - e.y;
    const d = Math.hypot(dx, dy);
    if (d >= standoff) return; // 沒重疊就不動
    // d≈0（正中）時給一個預設方向（沿角色朝向的反方向退出）
    const ang = d > 0.001 ? Math.atan2(dy, dx) : c.aimAngle + Math.PI;
    const r = GameConfig.player.radius;
    const nx = Phaser.Math.Clamp(e.x + Math.cos(ang) * standoff, this.arena.left + r, this.arena.right - r);
    const ny = Phaser.Math.Clamp(e.y + Math.sin(ang) * standoff, this.arena.top + r, this.arena.bottom - r);
    c.setPosition(nx, ny);
  }

  // ---------------------------------------------------------------------------
  // 目標搜尋
  // ---------------------------------------------------------------------------
  private findFirstEnemyInRangeOf(c: Character, radius: number): Enemy | null {
    const children = this.enemies.getChildren();
    let best: Enemy | null = null;
    // ★bug修:命中判定納入【敵人體型半徑】(edge-to-center),否則大體型(BOSS radius42/塔34)站著時,
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
  /** ★黏著目標:回傳離 (x,y) 最近存活角色的 seat(在 characters 的 index);找不到回 -1。 */
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
   * ★黏著目標(階段1):決定一隻怪這一幀要追誰。優先序 = 【事件覆寫 > 黏著綁定 > 就近重綁】。
   * - 事件波(守護)：一般怪強制打 guardNpc(忽略黏著)。BOSS/塔/NPC/錨點不套用。
   * - 黏著:讀 targetSeat 綁定角色;若目標死/移除 → 立即重綁最近。
   *   若目標存活但距離 > stickyBreakRadius 持續 stickyBreakSec → 才重綁最近(防抖);否則黏著不換。
   * 回傳目標(角色或事件物件),null 表示原地。
   */
  private resolveEnemyTarget(enemy: Enemy, time: number): Character | { x: number; y: number } | null {
    // ① 事件覆寫(最高優先):守護事件期間一般怪打 NPC
    if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active &&
        enemy.enemyType !== 'npc' && enemy.enemyType !== 'tower' && enemy.enemyType !== 'anchor' && !enemy.isBoss) {
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
   * v35(12)：計算場上殘留的「一般敵人」數（排除 tower/npc/boss/anchor-like）。
   * 用於事件/上一波結束進下一波時，把殘留怪計入新波 quota。
   */
  private countResidualEnemies(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      // ★寶箱怪完全獨立於波次系統:不計 quota(否則活到下波→quota+1→打不掉→卡死)
      if (e.isBoss || e.enemyType === 'tower' || e.enemyType === 'npc' || e.enemyType === 'treasure' || e.isAnchorLike()) continue;
      n++;
    }
    return n;
  }

  /** ★階段2a:場上【已實體化】的波次一般怪數(排除結構/寶箱/telegraph中)。drip 的 alive。 */
  private countWaveAlive(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || e.telegraphing) continue;
      if (e.isBoss || e.enemyType === 'tower' || e.enemyType === 'npc' || e.enemyType === 'treasure' || e.isAnchorLike()) continue;
      n++;
    }
    return n;
  }

  /** ★階段2a:場上【telegraph 登場中(未實體化)】的波次一般怪數。drip 的 pending(★算進總量防超生)。 */
  private countWavePending(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || !e.telegraphing) continue;
      if (e.isBoss || e.enemyType === 'tower' || e.enemyType === 'npc' || e.enemyType === 'treasure' || e.isAnchorLike()) continue;
      n++;
    }
    return n;
  }

  /** ★場上是否還有【活著/未離場】的寶箱怪(treasure)。用於延後場景切換直到寶箱怪死/跑走。 */
  private hasTreasureOnField(): boolean {
    const t = this.treasureEnemy;
    return !!(t && t.active && !t.dead);
  }

  /** ★延後的場景切換:寶箱怪已死/離場(treasureEnemy 清空)→真正開啟切換。每幀在 updateTreasure 後檢查。 */
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
    // v27 波次制狀態機
    const time = this.time.now;

    if (this.waveState === 'intermission') {
      if (time >= this.intermissionUntil) {
        // 開始下一波
        this.currentWave++;
        // v35(12)：事件/上一波殘留在場上的一般怪，計入這一波的目標數（不憑空消失）。
        // 殘留 R 隻：quota = base + R、waveSpawned = R（殘留視為已生），→ 只會再補生 base 隻新怪，
        // 總量 = R(殘留) + base(新生) = base+R，殺光殘留+新怪剛好達 quota。殘留被殺走 onWaveKill 計 waveKilled。
        const residual = this.countResidualEnemies();
        this.waveQuota = this.computeWaveQuota(this.currentWave) + residual;
        this.waveKilled = 0;
        this.waveSpawned = residual;
        this.spawnRefilling = true; // ★階段2a:開波 latch 開→立刻補生首批(不冷場、初期飽滿)
        this.nearSpawned = 0; this.fieldSpawned = 0; // ★階段2b:新波重置分配計數(比例每波獨立收斂)
        this.waveFormations = 0; // ★新波:隊形次數歸零(寶箱怪第2隊形起才可能出)
        this.waveState = 'spawning';
        // v57：每波開始灑幾個可打破物件(清掉的下一波再補)
        this.spawnBreakablesForWave();
        // v35(8)：開波首批怪立刻湧出，不冷場——直接生一組 + 歸零 accumulator（後續維持原節奏）
        this.spawnAccumulator = 0;
        // ★階段2a:開波用 drip 補到 maxAlive(spawnFormation 內每隻 spawnBlocked 精準封頂,不超 target)
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
      // v33 事件波：事件自己管出怪(守護/佔領)，波次系統不再生一般怪
      return;
    }

    // waveState === 'spawning' —— ★階段2a:drip 持續補生(latch 防抖)+ 聰明停生(封頂不超生)
    const survivalSec = this.survivalMs / 1000;
    const baseInterval = Math.max(
      GameConfig.spawn.minIntervalMs,
      GameConfig.spawn.initialIntervalMs - survivalSec * GameConfig.spawn.intervalDecayPerSec
    );
    // v14：等級越高出怪越快
    this.currentSpawnInterval = baseInterval * this.curSpawnIntervalMult();

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

    // ★聰明停生:只有 latch 開(occupancy 跌破 threshold)且未達封頂/上限時才補
    if (!shouldSpawnMore(ws)) return;
    this.spawnAccumulator = 0;

    // spawnFormation 內每隻 spawnEnemyAt 再走 spawnBlocked 精準封頂(formation 大小不會超生)
    this.spawnFormation();
  }

  /** v27：一隻怪被清掉時呼叫——計入本波進度；達配額 → intermission 或（BOSS 波）召喚 BOSS */
  private onWaveKill(): void {
    // ★事件後殘留清剩怪階段:每殺一隻檢查殘留是否清完→清完才收尾進下一步(不走一般波次配額邏輯)。
    if (this.pendingEventComplete) {
      this.finishPendingEventIfCleared();
      return;
    }
    // ★已在【延後場景切換(等寶箱怪清)】狀態:一般怪已清完,此時再殺到的多半是寶箱怪本身。
    //   不再走波次配額邏輯(subWavesDone 已+1);寶箱怪清空的真正切換由 finishPendingSubZoneIfTreasureGone 每幀處理。
    if (this.pendingSubZoneComplete) return;
    if (this.waveState === 'intermission' || this.waveState === 'boss' || this.waveState === 'event') return;
    this.waveKilled++;
    if (this.waveKilled >= this.waveQuota) {
      // ★關卡制:清完一波 → 累計子區波數;達子區目標波數 → 進入選邊/出口階段(不走 BOSS/事件/無限)
      if (this.levelMode) {
        this.subWavesDone++;
        if (this.subWavesDone >= this.subWavesTarget) {
          // ★用戶需求:最後一波打完最後一隻怪時,若場上還有【寶箱怪】→【不立刻開啟場景切換】,
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
        this.spawnBoss();
      } else if (this.isEventWave(this.currentWave)) {
        // v33 事件波：小怪清完 → 啟動事件（完成才過關）
        this.waveState = 'event';
        this.startEvent(this.eventKindForWave(this.currentWave));
      } else {
        this.enterIntermission();
      }
    }
    this.emitStats();
  }

  /** v28：進入 intermission（過關）——供 BOSS 擊殺或作弊清場共用 */
  private enterIntermission(): void {
    this.waveState = 'intermission';
    this.intermissionUntil = this.time.now + GameConfig.wave.intermissionMs;
    this.showWaveClear();
    this.emitStats();
  }

  // ========================= ★關卡系統(第一階段) =========================

  /** 子區(A 或 B)波數打完時呼叫:A→出現左右箭頭選邊;B→出現上/下出口。 */
  private onSubZoneComplete(): void {
    // 清掉場上殘餘一般怪(進入選邊/出口階段,場地清乾淨)——★保留還在場的寶箱怪(同場地,玩家可繼續打/它自己跑走)
    this.clearAllEnemies(true);
    this.waveState = 'clearing'; // 停止生怪
    if (this.currentSub === 'A') {
      // ★階段2:A 清波→【不進 choosing】,開放左右邊界,玩家走左/右邊界→過場進左/右 B。
      // ★③ 進 crossing 過場那刻:場上寶箱怪【直接逃走】(不留到過場/不跟到 B)。
      this.fleeTreasureNow();
      this.openCrossing();
    } else {
      this.progressPhase = 'exiting';
      this.showExit();
    }
    // ★⑤ 子區完成(要場景移動:選邊平移 / 出口閃黑)→【不顯示過關訊息】,直接進選邊/出口。
  }

  // ========================= ★階段1/2:走過去進單邊 B(無縫走廊核心;左右對稱) =========================

  /** ★可跨越聯集:zoneA + 該側走廊 + 該側 zoneB,合成大矩形(三者同高、水平相連)。 */
  private crossUnionRect(side: 'L' | 'R'): Phaser.Geom.Rectangle {
    const a = this.zoneA;
    if (side === 'R') { const bR = this.zoneBRight; return new Phaser.Geom.Rectangle(a.left, a.top, bR.right - a.left, a.height); }
    const bL = this.zoneBLeft; return new Phaser.Geom.Rectangle(bL.left, a.top, a.right - bL.left, a.height);
  }

  /**
   * ★階段2:A 清波→【左右邊界都開放】,玩家走到 A 左緣→左過場、右緣→右過場。
   * - crossingOpen=true、crossPhase='walk'、crossSide=null(尚未鎖定);progressPhase 維持 'playing'。
   * - physics.world.bounds 放寬到【左右都能走】的大聯集(zoneBLeft.left → zoneBRight.right)。
   * - camera bounds 放寬到【slotBLeft.x → slotBRight.right】整段(垂直 slot 高)。
   * - 左右走廊都畫(不露黑)。玩家走到哪邊邊界→updateCrossing 鎖定該側 startCameraPanToB(side)。
   */
  private openCrossing(): void {
    this.crossingOpen = true;
    this.crossPhase = 'walk';
    this.crossSide = null;
    this.crossOpenAt = this.time.now; // ★記開放時間→緩衝期內不觸發
    this.progressPhase = 'playing';
    // 物理:左右都能走(zoneBLeft.left → zoneBRight.right,arena 高)
    const a = this.zoneA;
    const uL = this.zoneBLeft.left, uR = this.zoneBRight.right;
    this.physics.world.setBounds(uL, a.top, uR - uL, a.height);
    // 鏡頭 bounds:slotBLeft.x → slotBRight.right(整段 slot 高);只放寬 bounds、不重呼叫 startFollow(避免 snap)。
    const cam = this.cameras.main;
    cam.setBounds(this.slotBLeft.x, this.slotA.y, this.slotBRight.right - this.slotBLeft.x, this.slotA.height);
    // 左右走廊都畫(填滿不露黑)
    this.drawCorridorScene('R');
    this.drawCorridorScene('L');
    // 提示:左右都可走
    if (this.choiceHint) this.choiceHint.destroy();
    this.choiceHint = this.add.text(this.zoneA.centerX, this.zoneA.top + 46, '← 走到左或右邊界前往下一區 →', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffe98a'
    }).setOrigin(0.5).setDepth(21).setScrollFactor(1);
    // ★引導箭頭(純視覺提示往左/右可走;非碰箭頭觸發——玩家仍需走到 A 左/右緣才觸發過場)。
    this.drawCrossingArrows();
  }

  /** ★左右引導箭頭(純視覺):比照【出口 showExit 的 drawArrow 表現】(適中三角+白圈,size34,統一風格),A 左右緣左/右箭頭。觸發鎖定側後隱藏。 */
  private drawCrossingArrows(): void {
    this.clearCrossArrows();
    const g = this.add.graphics().setDepth(20).setScrollFactor(1);
    const a = this.arena;
    const midY = a.centerY;
    const inset = GameConfig.stage.arrowInset;
    // 比照 showExit:同一個 drawArrow(三角 s34 + 白描邊圈 r48),風格一致、適中大小。
    this.drawArrow(g, a.left + inset, midY, -1, 0x7affc0);   // 左箭頭指左(同出口色系)
    this.drawArrow(g, a.right - inset, midY, +1, 0x7affc0);  // 右箭頭指右
    this.choiceGfx = g;
  }

  /** 清掉引導箭頭。 */
  private clearCrossArrows(): void {
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
  }

  /**
   * ★②③ 走廊場景(側別):填滿 A 該側緣 → 該側 B 之間【整個 slot 垂直範圍】,避免露黑塊。多個走廊各存一份 gfx。
   */
  private drawCorridorScene(side: 'L' | 'R'): void {
    const sc = GameConfig.scene;
    const lv = (sc.levels as Record<number, any>)[this.currentLevel] ?? (sc.levels as Record<number, any>)[1];
    // 走廊水平範圍:右=A右緣→右B左緣;左=左B右緣→A左緣。
    const x0 = side === 'R' ? this.zoneA.right : this.zoneBLeft.right;
    const x1 = side === 'R' ? this.zoneBRight.left : this.zoneA.left;
    const yTop = this.slotA.y, hFull = this.slotA.height, w = x1 - x0;
    const g = this.add.graphics().setDepth(-3);
    g.fillGradientStyle(lv.skyTop, lv.skyTop, lv.skyBottom, lv.skyBottom, 1);
    g.fillRect(x0, yTop, w, hFull);
    const gy = this.zoneA.top, gh = this.zoneA.height;
    g.fillStyle(lv.groundBase ?? 0x6b5a3a, 1);
    g.fillRect(x0, gy, w, gh);
    // ★走廊配合主題:森林=草叢/落葉;洞窟=碎岩/微弱冷光;其餘=碎石。走廊吃當前主題 palette 不突兀。
    const theme = this.sceneThemeOf(this.currentLevel);
    if (theme === 'forest') {
      for (let i = 0; i < 60; i++) {
        const px = Phaser.Math.Between(x0 + 4, x0 + w - 4), py = Phaser.Math.Between(gy + 4, gy + gh - 4);
        if (Math.random() < 0.6) { // 草叢
          g.lineStyle(1, lv.groundLight, 0.5);
          for (let k = 0; k < 3; k++) { const a = -Math.PI / 2 + Phaser.Math.FloatBetween(-0.5, 0.5); const ln = Phaser.Math.Between(5, 11); g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * ln, py + Math.sin(a) * ln); g.strokePath(); }
        } else { g.fillStyle(GameConfig.scene.forestLeaf, 0.45); g.fillCircle(px, py, Phaser.Math.Between(2, 4)); }
      }
      g.lineStyle(0, 0, 0);
    } else if (theme === 'cave') {
      for (let i = 0; i < 60; i++) {
        const px = Phaser.Math.Between(x0 + 4, x0 + w - 4), py = Phaser.Math.Between(gy + 4, gy + gh - 4);
        const roll = Math.random();
        if (roll < 0.6) { g.fillStyle(lv.pebble ?? 0x40454d, 0.6); g.fillCircle(px, py, Phaser.Math.Between(2, 5)); }
        else if (roll < 0.85) { g.fillStyle(lv.groundDark, 0.5); g.fillCircle(px, py, Phaser.Math.Between(4, 9)); }
        else if (lv.glow) { g.fillStyle(lv.glow, 0.22); g.fillCircle(px, py, Phaser.Math.Between(4, 10)); }
      }
    }
    g.lineStyle(3, lv.groundDark ?? 0x4a4030, 0.8);
    g.strokeRect(x0, gy, w, gh);
    if (side === 'R') this.corridorGfx = g; else this.corridorGfxL = g;
  }

  /**
   * ★階段2 crossing 每幀(crossPhase='walk'):玩家走到 A【左緣】→左過場、【右緣】→右過場。
   * ★開放後短暫緩衝(graceMs)內【不觸發】:讓玩家看到左右引導箭頭、離開邊界再走向想去的邊,
   *   避免「清波剛好貼 A 某側邊緣→開放瞬間秒觸發沒得選」。一旦觸發鎖定該側(panning 後不可反悔)。
   */
  private updateCrossing(): void {
    if (!this.crossingOpen || this.crossPhase !== 'walk') return;
    // ★緩衝期內只顯示箭頭、不判邊界觸發
    const graceMs = GameConfig.stage.crossGraceMs ?? 700;
    if (this.time.now - this.crossOpenAt < graceMs) return;
    const r = GameConfig.player.radius;
    const trigR = this.zoneA.right - r - 4;
    const trigL = this.zoneA.left + r + 4;
    if (this.player.x >= trigR) this.startCameraPanToB('R');
    else if (this.player.x <= trigL) this.startCameraPanToB('L');
  }

  /**
   * ★新機制步驟3:pan 定位 B 後,角色【自動移動】走進 B、停在【中心目標周圍環狀】(過場,玩家不操控)。
   * 用 crossSide 決定進哪側 B。全隊(P1+BOT,預留4人)環繞該側 B 中心 74px 4方位;全員到位→arriveAtSideB(side)。
   * ★過場~4秒:速度提高(見 crossAutoSpeed)。
   */
  private autoWalkIntoB(delta: number): void {
    const side = this.crossSide ?? 'R';
    const zoneB = side === 'L' ? this.zoneBLeft : this.zoneBRight;
    const speed = 520;                          // ★過場~4秒(4人從A遠處收斂到環狀約4s;單人更快)
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
   * ★③關卡間閃黑後:全隊從 A 下緣入口【自動走到中心環狀定位】(比照 autoWalkIntoB 走位演出);
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
      const t = slotOf(i); // ★比照 autoWalkIntoB:全員(含P1)環繞中心 74px 4方位,【正中心留給任務目標】不站中心
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
   * ★新機制:玩家碰 A 左/右緣→鎖定該側(crossSide)、鏡頭 cam.pan 平移到該側 B 中心並定位好(帶過走廊)。
   * pan 期玩家凍結;pan 完:camera bounds 收成 slotB【固定不 follow】、crossPhase='enter'、角色自動環繞走進 B。
   */
  private startCameraPanToB(side: 'L' | 'R'): void {
    this.crossPhase = 'panning';
    this.crossSide = side; // ★鎖定該側,不可反悔
    // ★觸發鎖定→隱藏引導箭頭(進 panning 後不再顯示,非碰箭頭觸發)。
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
   * ★階段1/2:角色自動走進該側 B 環狀→到站。
   * - crossingOpen=false、清兩側走廊、arena=該側 zoneB、physics bounds 收回只剩 zoneB(關門)。
   * - camera 固定停在 B 中心(不 follow 單角色)→交棒零位移。
   * - clearTreasure、placeStaticBreakables(side)、rollSubZoneContent 開打。
   */
  private arriveAtSideB(side: 'L' | 'R'): void {
    this.crossingOpen = false;
    this.crossSide = null;
    this.lastChoice = side;
    const zoneB = side === 'L' ? this.zoneBLeft : this.zoneBRight;
    const slotB = side === 'L' ? this.slotBLeft : this.slotBRight;
    this.clearTreasure();
    // ★保留走廊(不清 corridorGfx/L)→A↔B 銜接不變黑塊。
    if (this.choiceHint) { this.choiceHint.destroy(); this.choiceHint = null; }
    this.currentSub = 'B';
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
    this.clearAllBreakables();
    this.placeStaticBreakables(side);
    this.progressPhase = 'playing';
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    this.rollSubZoneContent(false);
    this.emitStats();
  }

  /**
   * ★進B鏡頭跳一下修:進B後每幀檢查——等 camera 已【平滑捲進 slotB 允許的 scroll 範圍內】才把 bounds 收成 slotB。
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

  /** 清掉場上一般怪(不計分,清場給轉場用)。keepTreasure=true 時【保留寶箱怪】(波次完成/子區完成不清它,只有真正換場地才清)。 */
  private clearAllEnemies(keepTreasure = false): void {
    const tr = this.treasureEnemy;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active) continue;
      if (keepTreasure && e === tr) continue; // ★保留還在場的寶箱怪(玩家可繼續打/它自己 lifetime 跑走)
      e.dead = true; e.disableBody(true, true);
    }
    if (!keepTreasure) { this.treasureEnemy = null; this.clearTreasureFx(); }
  }

  /** ★真正換場地(子區平移/關卡閃黑)時清掉寶箱怪(別帶到下一場地)。 */
  private clearTreasure(): void {
    if (this.treasureEnemy && this.treasureEnemy.active) { this.treasureEnemy.dead = true; this.treasureEnemy.disableBody(true, true); }
    this.treasureEnemy = null;
    this.clearTreasureFx();
  }

  /**
   * ★③ 進 crossing 過場那刻:場上寶箱怪【直接觸發逃走(淡出移除)】,不留到過場/不跟到 B。
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

  /** B 清完:上下出口(第一階段用下方出口),玩家走進 → 閃黑到下一關 A。 */
  private showExit(): void {
    if (this.choiceGfx) this.choiceGfx.destroy();
    const g = this.add.graphics().setDepth(20);
    const a = this.arena;
    const inset = GameConfig.stage.exitInset;
    const ey = a.bottom - inset;
    // 出口:下方發光門
    g.fillStyle(0x7affc0, 0.85);
    g.fillRect(a.centerX - 60, ey - 16, 120, 32);
    g.lineStyle(4, 0xffffff, 0.8);
    g.strokeRect(a.centerX - 60, ey - 16, 120, 32);
    this.drawArrow(g, a.centerX, ey - 60, 0, 0x7affc0); // 佔位(dir 0→退化三角,改畫向下箭頭)
    // 明確向下箭頭
    g.fillStyle(0x7affc0, 0.9);
    g.beginPath();
    g.moveTo(a.centerX, ey - 30);
    g.lineTo(a.centerX - 22, ey - 58);
    g.lineTo(a.centerX + 22, ey - 58);
    g.closePath();
    g.fillPath();
    this.choiceGfx = g;
    if (this.choiceHint) this.choiceHint.destroy();
    this.choiceHint = this.add.text(a.centerX, a.top + 46, '走進下方出口前往下一關 ↓', {
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
    // ★選左→B 在 A 左側(鏡頭往左);選右→B 在 A 右側(鏡頭往右)。
    this.zoneB = this.lastChoice === 'L' ? this.zoneBLeft : this.zoneBRight;
    const slotB = this.lastChoice === 'L' ? this.slotBLeft : this.slotBRight;
    // ★真正換場地(A→B 平移)→清掉 A 場上的寶箱怪(別帶到 B)
    this.clearTreasure();

    // ★③ 順滑平移:先把玩家/物件放進 B、切 arena(遊戲凍結中,不影響畫面),
    //   再把 camera 從當前位置【一路 pan 到玩家在 B 的最終畫面位置】,pan 完才 enableFollow→無「先中央再彈回」。
    this.currentSub = 'B';
    this.arena = this.zoneB;
    this.physics.world.setBounds(this.zoneB.x, this.zoneB.y, this.zoneB.width, this.zoneB.height);
    // ★⑥ 玩家從【B 進來那側的邊緣】進場(選左→從 B 右緣進、選右→從 B 左緣進),貼邊緣不閃到中途。
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

  /** 平移到位:重啟跟隨、★隨機決定 B 內容(純波次 1-2 波 或 限時事件 塔/守護/佔領)。 */
  private arriveAtB(slotB: Phaser.Geom.Rectangle): void {
    // ★重啟鏡頭跟隨到 B 的 slot(camera 已 pan 到玩家位置→startFollow 不會跳)
    this.enableFollow(slotB);
    this.progressPhase = 'playing';
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    this.rollSubZoneContent(false); // B 子區隨機:事件 或 純波次(1-2波)
    this.emitStats();
  }

  /**
   * ★子區進場隨機:roll bEventChance→限時事件(塔/守護/佔領隨機抽,在 currentArena 觸發) 或 純波次。
   * isA=true(A子區):純波次波數=wavesA;isA=false(B子區):純波次波數=隨機 wavesBMin~Max(較少)。
   * 各子區(每關A、每關B)獨立隨機。事件用 this.arena(=當前子區)座標→塔/NPC/圈生在當前場地。
   */
  /**
   * ★事件洗牌佇列(shuffle bag):一輪內 tower/guard/capture 各出一次不重複,出完再洗下一輪。
   * bag 空→用 bEventPool 複製一份 Fisher-Yates 洗牌填入;pop 一個當本次事件種類。
   */
  private drawEventKind(): 'tower' | 'guard' | 'capture' {
    if (this.eventBag.length === 0) {
      const bag = [...(GameConfig.stage.bEventPool as ReadonlyArray<string>)];
      // Fisher-Yates 洗牌
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Phaser.Math.Between(0, i);
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
      this.eventBag = bag;
    }
    return (this.eventBag.pop() ?? 'tower') as 'tower' | 'guard' | 'capture';
  }

  private rollSubZoneContent(isA: boolean): void {
    const st = GameConfig.stage;
    this.subWavesDone = 0;
    // ★①關卡1 的 A 子區(1-A)固定純波次、不放事件(當作開場教學區);其餘子區照常隨機。
    // ★新增:不可【事件接事件】——上一個子區是事件→這個子區強制純波次(跳過事件 roll)。
    const forcePureWaves = (isA && this.currentLevel === 1) || this.lastSubZoneKind === 'event';
    if (!forcePureWaves && Math.random() < st.bEventChance) {
      const kind = this.drawEventKind();
      this.subWavesTarget = 0;       // 事件模式不靠波數
      this.waveState = 'event';
      this.lastSubZoneKind = 'event'; // ★記錄本子區為事件→下一子區強制純波次
      this.startEvent(kind);
    } else {
      this.lastSubZoneKind = 'wave'; // ★記錄本子區為純波次
      this.subWavesTarget = isA ? st.wavesA : Phaser.Math.Between(st.wavesBMin, st.wavesBMax);
      this.waveQuota = this.computeWaveQuota(this.currentWave);
      this.waveFormations = 0; // ★子區首波:隊形次數歸零(寶箱怪第2隊形起才可能出→首次生怪不出)
      this.waveState = 'spawning';
    }
  }

  /** exiting 階段每幀:偵測玩家走進下方出口 → 閃黑轉場到下一關 A。 */
  private updateExiting(): void {
    const a = this.arena;
    const inset = GameConfig.stage.exitInset;
    const ey = a.bottom - inset;
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, a.centerX, ey) <= GameConfig.stage.triggerDist + 20) {
      this.startTransition();
    }
  }

  /** 閃黑轉場:fade out → 重置到 (level+1)-A(停跟隨、camera 拉回 A、清 B 物件、布置新場景) → fade in。 */
  private startTransition(): void {
    this.progressPhase = 'transition';
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
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
    this.currentLevel++;

    // ★第二輪:BOSS 關(關4 中場BOSS / 關8 壓軸BOSS)→純BOSS戰。其餘關→一般 A/B 子區。
    if (this.isBossLevel(this.currentLevel)) {
      this.startBossLevel();
      return;
    }

    this.currentSub = 'A';
    this.arena = this.zoneA; // 拉回 A 子區(置中)
    // physics bounds = A 移動區
    this.physics.world.setBounds(this.zoneA.x, this.zoneA.y, this.zoneA.width, this.zoneA.height);
    // ★第二階段:重繪新關卡場景(地貌換成新關卡、A/B 遠景),用 slot 版簽名
    this.clearSceneLayers();
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, 'B');
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, 'A');
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, 'B');
    // ★③玩家進下關【自動走到定位】演出:角色先放在 A【下緣入口】(=從上一關出口走進來的方向),
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
    // ★重啟鏡頭跟隨到 A slot
    this.enableFollow(this.slotA);
    this.currentWave++;
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.spawnAccumulator = 0;
    // ★新關卡 A 子區靜態布置物件(隨機布置)——先布置物件再 roll(事件用當前 arena)
    this.placeStaticBreakables('L');
    // ★A 子區也隨機:純波次(wavesA) 或 限時事件(塔/守護/佔領)
    this.rollSubZoneContent(true);
    this.showLevelBanner();
    // ★啟動自動走位演出:progressPhase 保持 playing,但 levelEntering=true→update() 走 updateLevelEnter,
    //   全隊走到中心環狀定位、期間玩家輸入不生效(見 update 開頭 gate),到位恢復。
    this.levelEntering = true;
    this.progressPhase = 'playing';
    this.emitStats();
  }

  /** ★步驟2:關卡4 純BOSS戰——火山岩盤戰場(用 A slot 當戰場)、直接生 BOSS、打贏→通關(onBossKilled→triggerClear)。 */
  private startBossLevel(): void {
    this.currentSub = 'A';
    this.arena = this.zoneA; // BOSS 戰場 = A slot 的移動區(火山岩盤地貌)
    this.physics.world.setBounds(this.zoneA.x, this.zoneA.y, this.zoneA.width, this.zoneA.height);
    // 重繪關卡4 場景(火山岩盤 A 荒城 / B 火山遠景,三區都畫,戰場在 A)
    this.clearSceneLayers();
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, 'B');
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, 'A');
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, 'B');
    // 玩家回 A 中心偏下(BOSS 生中央)
    const cx = this.zoneA.centerX, cy = this.zoneA.bottom - 90;
    for (const c of this.characters) {
      if (!c.alive) continue;
      const off = c === this.player ? 0 : Phaser.Math.Between(24, 50);
      c.x = cx + Phaser.Math.Between(-off, off);
      c.y = cy + Phaser.Math.Between(-20, 20);
      (c.body as Phaser.Physics.Arcade.Body).reset(c.x, c.y);
    }
    this.enableFollow(this.slotA);
    // BOSS 戰:progressPhase=playing、waveState=boss、直接生 BOSS(不生一般波次)
    this.progressPhase = 'playing';
    this.waveState = 'boss';
    this.spawnAccumulator = 0;
    this.spawnBoss();
    this.showLevelBanner(); // 顯示「關卡 4 - A」(BOSS 戰)
    this.emitStats();
  }

  /** 靜態布置可破壞物件(木箱/桶),依選邊配置,座標為子區內比例。不進 spawn 循環=不重生。 */
  private placeStaticBreakables(choice: 'L' | 'R'): void {
    // ★每區隨機布置:數量+位置隨機,不再每區都一樣。保留選邊基調(R 側多桶)。避開中心與邊緣、彼此不重疊。
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
    // ★固定畫面(setScrollFactor 0):不隨鏡頭跟隨捲動位移。
    this.levelBanner = this.add.text(GameConfig.width / 2, GameConfig.height * 0.36, `關卡 ${this.currentLevel} - ${this.currentSub}`, {
      fontFamily: 'monospace', fontSize: '40px', color: '#ffd23f', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setScrollFactor(0).setDepth(30).setAlpha(0);
    this.tweens.add({ targets: this.levelBanner, alpha: 1, duration: 250, yoyo: true, hold: 900,
      onComplete: () => { if (this.levelBanner) { this.levelBanner.destroy(); this.levelBanner = null; } } });
  }

  /** ★寶箱怪出現提示橫幅(比照 showLevelBanner 風格,金色醒目,固定畫面短暫停留淡出)。 */
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
   * ★I 鍵:切換遊戲內道具生成開關(即時生效)。關→額外清掉場上現有道具(直覺:「關道具」=場上馬上乾淨)。
   * 底層改 this.itemsEnabled(dropItemAt 讀它);config.items.spawnEnabled 只當初始預設。
   */
  private toggleItems(): void {
    this.itemsEnabled = !this.itemsEnabled;
    if (!this.itemsEnabled) this.clearAllItems(); // 關→清場上現有道具
    this.showItemToggleBanner(this.itemsEnabled);
    this.game.events.emit('items-state', this.itemsEnabled); // ★同步 UIScene 觸控按鈕面(色/字)
  }

  /** 清掉場上所有現存道具(關道具開關時用)。 */
  private clearAllItems(): void {
    for (const child of this.items.getChildren()) {
      const item = child as Item;
      if (item.active) item.despawn();
    }
  }

  /** ★道具開關切換提示橫幅:「道具:開 / 道具:關」。 */
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
    if (this.choiceGfx) this.choiceGfx.setAlpha(0.6 + 0.4 * Math.abs(Math.sin(time / 300)));
  }

  /** ★除錯:切換預覽關卡場景(不動流程,只重繪當前子區三區地貌+遠景),給看 4 關對比。 */
  private debugPreviewLevel(level: number): void {
    this.currentLevel = Phaser.Math.Clamp(level, 1, GameConfig.stage.totalLevels);
    this.clearSceneLayers();
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, 'B');
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, 'A');
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, 'B');
    this.showLevelBanner();
  }

  // ========================= ★第二階段:場景視覺(程式繪製) =========================

  /** 清掉所有場景繪製物件(重繪關卡時用)。 */
  private clearSceneLayers(): void {
    for (const o of this.sceneLayers) o.destroy();
    this.sceneLayers = [];
    // ★階段2:切關卡/重繪場景時一併清掉走廊底圖(左右),避免上一關殘留。
    if (this.corridorGfx) { this.corridorGfx.destroy(); this.corridorGfx = null; }
    if (this.corridorGfxL) { this.corridorGfxL.destroy(); this.corridorGfxL = null; }
  }

  /** ★方案e:啟用鏡頭跟隨玩家(限制在當前 slot 內、deadzone 緩衝)。playing 時用。 */
  private enableFollow(slot: Phaser.Geom.Rectangle): void {
    const cam = this.cameras.main;
    const st = GameConfig.stage;
    cam.setBounds(slot.x, slot.y, slot.width, slot.height); // 跟隨限制在當前 slot→不會露出隔壁子區
    cam.startFollow(this.player, true, st.followLerp, st.followLerp);
    cam.setDeadzone(st.followDeadzoneW, st.followDeadzoneH);
  }

  /** 停止鏡頭跟隨(切區平移/閃黑轉場前用),並把 bounds 放大到整個世界(讓 pan 能跨 slot)。 */
  private disableFollow(): void {
    const cam = this.cameras.main;
    cam.stopFollow();
    const st = GameConfig.stage;
    const slotW = st.arenaW + st.sceneMargin * 2, slotH = st.arenaH + st.sceneMargin * 2;
    const worldW = slotW * 3 + GameConfig.stage.subGap * 2;
    cam.setBounds(0, 0, worldW, slotH);
  }

  /**
   * 程式繪製一個子區的場景:遠景(畫滿整個 slot=移動區+四周遠景邊距)→移動區地貌(arena)→餘燼粒子。
   * ★方案e:slot 比畫面大,camera 跟隨玩家走到邊緣時露出 slot 邊緣的遠景(荒城/火山)。
   * 靜態底圖用 graphics 一次畫好(depth 0/1),粒子適量,不拖累割草。
   */
  /** ★場景主題:關1-4=荒城/火山(wasteland)、關5-6=森林(forest)、關7-8=洞窟(cave,階段3)。 */
  private sceneThemeOf(level: number): 'wasteland' | 'forest' | 'cave' {
    if (level >= 7) return 'cave';
    if (level >= 5) return 'forest';
    return 'wasteland';
  }

  private drawZoneScene(slot: Phaser.Geom.Rectangle, zone: Phaser.Geom.Rectangle, level: number, variant: 'A' | 'B'): void {
    const sc = GameConfig.scene;
    const lv = (sc.levels as Record<number, any>)[level] ?? (sc.levels as Record<number, any>)[1];
    const theme = this.sceneThemeOf(level); // ★主題:'wasteland'(1-4 荒城火山) | 'forest'(5-6) | 'cave'(7-8)
    const isForest = theme === 'forest';
    const isCave = theme === 'cave';

    // ---- 1) 遠景天空漸層(畫滿整個 slot) ----
    const sky = this.add.graphics().setDepth(-3);
    sky.fillGradientStyle(lv.skyTop, lv.skyTop, lv.skyBottom, lv.skyBottom, 1);
    sky.fillRect(slot.x, slot.y, slot.width, slot.height);
    this.sceneLayers.push(sky);

    // ---- 2) 遠景剪影(上方天際線帶) ----
    const far = this.add.graphics().setDepth(-2);
    const bandH = Math.round((zone.top - slot.top) * 1.15);
    const bandTop = slot.top + Math.max(16, (zone.top - slot.top) * 0.1);
    if (isForest) {
      if (variant === 'A') this.drawFarForest(far, slot.x + 16, bandTop, slot.width - 32, bandH, 'A');
      else this.drawFarForest(far, slot.x + 16, bandTop, slot.width - 32, bandH, 'B');
    } else if (isCave) {
      this.drawFarCave(far, slot.x + 16, bandTop, slot.width - 32, bandH, variant);
    } else if (variant === 'A') this.drawFarRuinedCity(far, slot.x + 16, bandTop, slot.width - 32, bandH);
    else this.drawFarVolcano(far, slot.x + 16, bandTop, slot.width - 32, bandH);
    this.sceneLayers.push(far);

    // ---- 2b) 移動區外圍荒地(slot 內、arena 外)——鋪暗荒地 + 【散布細節填滿空蕩】(碎石堆/斷牆殘骸/熔岩窪) ----
    const outer = this.add.graphics().setDepth(-1);
    outer.fillStyle(lv.groundDark, 0.7);
    outer.fillRect(slot.x, zone.bottom, slot.width, slot.bottom - zone.bottom); // 下方
    outer.fillRect(slot.x, zone.top, zone.left - slot.left, zone.height);       // 左
    outer.fillRect(zone.right, zone.top, slot.right - zone.right, zone.height); // 右
    // 外圍散布細節:在 slot 內、arena 外的區域灑碎石/殘骸/(火山)熔岩窪,別留大片空
    const inArena = (x: number, y: number) => x > zone.left - 10 && x < zone.right + 10 && y > zone.top - 10 && y < zone.bottom + 10;
    for (let i = 0; i < 140; i++) {
      const x = Phaser.Math.Between(slot.left + 6, slot.right - 6);
      const y = Phaser.Math.Between(slot.top + bandH, slot.bottom - 6); // band 以下
      if (inArena(x, y)) continue;
      const roll = Math.random();
      if (isCave) {
        // ★洞窟外圍:碎岩堆/暗岩塊/水漬反光/微弱冷光斑
        if (roll < 0.42) { // 碎岩堆(暗灰多顆)
          outer.fillStyle(lv.pebble, 0.6);
          for (let k = 0; k < 3; k++) outer.fillCircle(x + Phaser.Math.Between(-6, 6), y + Phaser.Math.Between(-5, 5), Phaser.Math.Between(3, 7));
        } else if (roll < 0.7) { // 暗岩塊(多邊)
          outer.fillStyle(lv.groundDark, 0.6);
          const pts: Phaser.Geom.Point[] = []; const rr = Phaser.Math.Between(8, 18);
          for (let s = 0; s < 5; s++) { const a = (s / 5) * Math.PI * 2; const rad = rr * (0.6 + Math.random() * 0.5); pts.push(new Phaser.Geom.Point(x + Math.cos(a) * rad, y + Math.sin(a) * rad)); }
          outer.fillPoints(pts, true);
        } else if (roll < 0.86) { // 水漬反光(冷色橢圓 + 高光)
          outer.fillStyle(GameConfig.scene.caveGlow, 0.14); outer.fillCircle(x, y, Phaser.Math.Between(6, 14));
          outer.fillStyle(GameConfig.scene.caveMote, 0.2); outer.fillCircle(x - 2, y - 1, Phaser.Math.Between(2, 4));
        } else if (lv.glow) { // 微弱冷光斑(磷光)
          outer.fillStyle(lv.glow, 0.3); outer.fillCircle(x, y, Phaser.Math.Between(3, 8));
        } else {
          outer.fillStyle(lv.groundBase, 0.4); outer.fillCircle(x, y, Phaser.Math.Between(6, 14));
        }
      } else if (isForest) {
        // ★森林外圍:灌木叢/蕨葉/苔石/落葉,鋪滿林間空地
        if (roll < 0.4) { // 灌木叢(深綠橢圓簇)
          outer.fillStyle(lv.groundDark, 0.55);
          for (let k = 0; k < 3; k++) outer.fillCircle(x + Phaser.Math.Between(-8, 8), y + Phaser.Math.Between(-6, 6), Phaser.Math.Between(6, 12));
        } else if (roll < 0.68) { // 蕨葉/草叢(亮綠細條放射)
          outer.lineStyle(2, lv.groundLight, 0.5);
          for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + Phaser.Math.FloatBetween(-0.7, 0.7); const ln = Phaser.Math.Between(8, 16); outer.beginPath(); outer.moveTo(x, y); outer.lineTo(x + Math.cos(a) * ln, y + Math.sin(a) * ln); outer.strokePath(); }
          outer.lineStyle(0, 0, 0);
        } else if (roll < 0.85) { // 苔石(灰綠圓)
          outer.fillStyle(lv.pebble, 0.6); outer.fillCircle(x, y, Phaser.Math.Between(4, 9));
          outer.fillStyle(lv.groundLight, 0.35); outer.fillCircle(x - 2, y - 2, Phaser.Math.Between(2, 4));
        } else { // 落葉(小黃綠點)
          outer.fillStyle(GameConfig.scene.forestLeaf, 0.45); outer.fillCircle(x, y, Phaser.Math.Between(2, 4));
        }
      } else if (roll < 0.5) { // 碎石
        outer.fillStyle(lv.pebble, 0.5); outer.fillCircle(x, y, Phaser.Math.Between(2, 5));
      } else if (roll < 0.82) { // 斷牆/岩塊殘骸(暗矩形)
        outer.fillStyle(lv.groundLight, 0.28); outer.fillRect(x, y, Phaser.Math.Between(10, 28), Phaser.Math.Between(6, 16));
      } else if (variant === 'B' || lv.glow) { // 火山/熔岩關:熔岩窪(橘紅發光)
        outer.fillStyle((GameConfig.scene.farB.lava as number), 0.35); outer.fillCircle(x, y, Phaser.Math.Between(4, 10));
      } else { // 荒城關:更多土斑
        outer.fillStyle(lv.groundBase, 0.4); outer.fillCircle(x, y, Phaser.Math.Between(8, 20));
      }
    }
    this.sceneLayers.push(outer);

    // ---- 3) 移動區地貌(場地地面):generateTexture 一次性靜態底圖(質感調更乾裂:不規則多邊斑塊) ----
    const key = `zone-ground-L${level}-${variant}-${Math.round(zone.x)}`;
    if (this.textures.exists(key)) this.textures.remove(key);
    const gt = this.make.graphics({ x: 0, y: 0 }, false);
    const w = Math.round(zone.width), h = Math.round(zone.height);
    gt.fillStyle(lv.groundBase, 1); gt.fillRect(0, 0, w, h);
    if (isForest) {
      this.drawForestGround(gt, w, h, lv, level);
    } else if (isCave) {
      this.drawCaveGround(gt, w, h, lv, level);
    } else {
    // 不規則多邊斑塊(比柔和圓點更像乾裂土塊)
    for (let i = 0; i < 120; i++) {
      const bx = Phaser.Math.Between(0, w), by = Phaser.Math.Between(0, h);
      const rr = Phaser.Math.Between(10, 34);
      gt.fillStyle(Math.random() < 0.5 ? lv.groundDark : lv.groundLight, 0.14);
      const pts: Phaser.Geom.Point[] = [];
      const sides = Phaser.Math.Between(4, 6);
      for (let s = 0; s < sides; s++) {
        const a = (s / sides) * Math.PI * 2;
        const rad = rr * (0.6 + Math.random() * 0.5);
        pts.push(new Phaser.Geom.Point(bx + Math.cos(a) * rad, by + Math.sin(a) * rad));
      }
      gt.fillPoints(pts, true);
    }
    // 龜裂縫線(較密的多邊折線,像龜裂紋)
    gt.lineStyle(2, lv.crackColor, 0.85);
    for (let c = 0; c < 16; c++) {
      let cx = Phaser.Math.Between(0, w), cy = Phaser.Math.Between(0, h);
      gt.beginPath(); gt.moveTo(cx, cy);
      const segs = Phaser.Math.Between(3, 6);
      for (let s = 0; s < segs; s++) { cx += Phaser.Math.Between(-70, 70); cy += Phaser.Math.Between(-55, 55); gt.lineTo(cx, cy); }
      gt.strokePath();
    }
    if (lv.glow) {
      gt.lineStyle(4, lv.glow, 0.5);
      for (let c = 0; c < 5; c++) {
        let cx = Phaser.Math.Between(0, w), cy = Phaser.Math.Between(0, h);
        gt.beginPath(); gt.moveTo(cx, cy);
        for (let s = 0; s < 4; s++) { cx += Phaser.Math.Between(-50, 50); cy += Phaser.Math.Between(-40, 40); gt.lineTo(cx, cy); }
        gt.strokePath();
      }
    }
    for (let i = 0; i < 70; i++) {
      gt.fillStyle(lv.pebble, 0.8);
      gt.fillCircle(Phaser.Math.Between(4, w - 4), Phaser.Math.Between(4, h - 4), Phaser.Math.Between(1, 3));
    }
    // 關3【焦黑廢墟】:斷裂城磚散落(灰石磚塊,帶暗縫,像斷牆碎塊)
    if (level === 3) {
      for (let i = 0; i < 30; i++) {
        const bx = Phaser.Math.Between(6, w - 26), by = Phaser.Math.Between(6, h - 16);
        const bw = Phaser.Math.Between(14, 28), bh = Phaser.Math.Between(8, 16);
        const stone = [0x6a6058, 0x554b44, 0x736658][Phaser.Math.Between(0, 2)];
        gt.fillStyle(stone, 0.9); gt.fillRect(bx, by, bw, bh);
        gt.fillStyle(0x1a1512, 0.6); gt.fillRect(bx, by + bh / 2 - 1, bw, 2); // 磚縫
        gt.lineStyle(1, 0x2a241f, 0.7); gt.strokeRect(bx, by, bw, bh);
      }
      gt.lineStyle(0, 0, 0);
    }
    // 關4【火山岩盤】:深岩多邊裂塊(暗色岩板拼接感)
    if (level === 4) {
      for (let i = 0; i < 18; i++) {
        const bx = Phaser.Math.Between(10, w - 10), by = Phaser.Math.Between(10, h - 10);
        gt.fillStyle(0x1a1211, 0.5);
        const pts: Phaser.Geom.Point[] = [];
        const sides = Phaser.Math.Between(5, 6), rr = Phaser.Math.Between(18, 40);
        for (let s = 0; s < sides; s++) { const a = (s / sides) * Math.PI * 2; const rad = rr * (0.7 + Math.random() * 0.4); pts.push(new Phaser.Geom.Point(bx + Math.cos(a) * rad, by + Math.sin(a) * rad)); }
        gt.fillPoints(pts, true);
      }
    }
    }
    gt.generateTexture(key, w, h); gt.destroy();
    const ground = this.add.image(zone.x, zone.y, key).setOrigin(0, 0).setDepth(0);
    this.sceneLayers.push(ground);

    // ---- 4) 圍欄(區隔移動區,讓玩家清楚可走範圍) ----
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(GameConfig.arena.borderThickness, GameConfig.arena.borderColor, 1);
    border.strokeRect(zone.x, zone.y, zone.width, zone.height);
    this.sceneLayers.push(border);

    // ---- 5) 餘燼火點粒子(畫在整個 slot;火山關4/熔岩關2 更多、B 變體更多) ----
    if (sc.emberCount > 0) {
      if (isForest) {
        const leafCount = variant === 'B' ? Math.round(sc.emberCount * 0.9) : Math.round(sc.emberCount * 0.7);
        const leaves = this.add.particles(0, 0, 'spark', {
          x: { min: slot.x, max: slot.right },
          y: { min: slot.y, max: slot.bottom - 40 },
          lifespan: 5200, speedY: { min: 10, max: 26 }, speedX: { min: -20, max: 20 },
          gravityY: 6, rotate: { min: 0, max: 360 },
          scale: { start: 0.6, end: 0.35 }, alpha: { start: 0.85, end: 0 },
          tint: [GameConfig.scene.forestLeaf, lv.groundLight], frequency: Math.max(120, 2400 / Math.max(4, leafCount)), quantity: 1
        }).setDepth(2);
        this.sceneLayers.push(leaves);
        // 林間光點(晨光/螢火,ADD 微亮),A 較多
        const moteCount = variant === 'A' ? Math.round(sc.emberCount * 0.5) : Math.round(sc.emberCount * 0.3);
        const motes = this.add.particles(0, 0, 'spark', {
          x: { min: slot.x, max: slot.right }, y: { min: slot.y + bandH * 0.5, max: slot.bottom - 20 },
          lifespan: 3000, speedY: { min: -10, max: -24 }, speedX: { min: -6, max: 6 },
          scale: { start: 0.4, end: 0 }, alpha: { start: 0.7, end: 0 },
          tint: GameConfig.scene.forestMote, frequency: Math.max(140, 2600 / Math.max(3, moteCount)), quantity: 1, blendMode: 'ADD'
        }).setDepth(2);
        this.sceneLayers.push(motes);
      } else if (isCave) {
        // ★洞窟:下落水滴(暗灰,帶重力)+ 冷光螢點(藍白 ADD)+ 微塵。B(深淵)更暗、螢點少。
        const dripCount = Math.round(sc.emberCount * 0.5);
        const drips = this.add.particles(0, 0, 'spark', {
          x: { min: slot.x, max: slot.right }, y: { min: slot.y + bandH * 0.4, max: slot.y + bandH * 0.9 },
          lifespan: 1600, speedY: { min: 120, max: 220 }, speedX: { min: -4, max: 4 }, gravityY: 120,
          scale: { start: 0.28, end: 0.12 }, alpha: { start: 0.7, end: 0 },
          tint: GameConfig.scene.caveDrip, frequency: Math.max(200, 3200 / Math.max(3, dripCount)), quantity: 1
        }).setDepth(2);
        this.sceneLayers.push(drips);
        // 冷光螢點(磷光/水光,ADD 微亮飄浮)
        const glowCount = variant === 'A' ? Math.round(sc.emberCount * 0.6) : Math.round(sc.emberCount * 0.35);
        const glows = this.add.particles(0, 0, 'spark', {
          x: { min: slot.x, max: slot.right }, y: { min: slot.y + bandH * 0.6, max: slot.bottom - 16 },
          lifespan: 3400, speedY: { min: -6, max: -16 }, speedX: { min: -8, max: 8 },
          scale: { start: 0.42, end: 0 }, alpha: { start: 0.65, end: 0 },
          tint: [GameConfig.scene.caveMote, GameConfig.scene.caveGlow], frequency: Math.max(150, 2600 / Math.max(3, glowCount)), quantity: 1, blendMode: 'ADD'
        }).setDepth(2);
        this.sceneLayers.push(glows);
      } else {
      const glowColor = variant === 'B' ? (sc.farB.lava as number) : (lv.glow || 0xff8a3a);
      // 關4(火山岩盤)餘燼最多、關2(熔岩)次之;B 變體(火山遠景)加成。
      const levelMult = level === 4 ? 1.8 : level === 2 ? 1.3 : 1.0;
      const base = variant === 'B' ? sc.emberCount : Math.round(sc.emberCount * 0.6);
      const count = Math.max(4, Math.round(base * levelMult));
      const emitter = this.add.particles(0, 0, 'spark', {
        x: { min: slot.x, max: slot.right },
        y: { min: slot.y, max: slot.bottom },
        lifespan: 2600, speedY: { min: -18, max: -42 }, speedX: { min: -8, max: 8 },
        scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 },
        tint: glowColor, frequency: Math.max(45, 1800 / count), quantity: 1, blendMode: 'ADD'
      }).setDepth(2);
      this.sceneLayers.push(emitter);
      }
    }
  }

  /** 遠景:荒城天際線(傾頹城牆 + 破塔剪影)——元素縮小、更密,填滿帶狀不空蕩。 */
  private drawFarRuinedCity(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const f = GameConfig.scene.farA;
    g.fillStyle(f.hazeTop, 0.5); g.fillRect(x, y, w, h);
    const base = y + h;
    // 遠層小剪影(更遠更小更淡,墊背景層次)
    g.fillStyle(f.tower, 0.5);
    for (let bx = x; bx < x + w; bx += Phaser.Math.Between(30, 55)) {
      const bh = Phaser.Math.Between(14, Math.max(20, h * 0.4));
      g.fillRect(bx, base - bh, Phaser.Math.Between(14, 26), bh);
    }
    // 城牆(縮小高度、更密,少缺口)
    g.fillStyle(f.wall, 0.95);
    let wx = x;
    const wallMax = Math.max(24, h * 0.55);
    while (wx < x + w) {
      const seg = Phaser.Math.Between(30, 60);
      const wh = Phaser.Math.Between(Math.round(wallMax * 0.4), Math.round(wallMax)) * (Math.random() < 0.12 ? 0 : 1);
      g.fillRect(wx, base - wh, seg, wh);
      if (wh > 0) for (let m = wx; m < wx + seg; m += 14) g.fillRect(m, base - wh - 6, 7, 6);
      wx += seg + Phaser.Math.Between(2, 8);
    }
    // 破塔(縮小,分散更多根)
    g.fillStyle(f.tower, 0.95);
    const towers = Math.max(4, Math.round(w / 220));
    for (let t = 0; t < towers; t++) {
      const tx = x + 20 + (t + 0.5) * (w / towers) + Phaser.Math.Between(-30, 30);
      const tw = Phaser.Math.Between(18, 28), th = Phaser.Math.Between(Math.round(wallMax * 0.8), Math.round(wallMax * 1.4));
      g.fillRect(tx, base - th, tw, th);
      g.fillTriangle(tx, base - th, tx + tw, base - th, tx + tw * 0.5, base - th - Phaser.Math.Between(5, 14));
    }
  }

  /** 遠景:火山噴發(紅天 + 噴煙 + 熔岩流下山)——山體縮小、多座填滿。 */
  private drawFarVolcano(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number): void {
    const f = GameConfig.scene.farB;
    g.fillStyle(f.glowSky, 0.4); g.fillRect(x, y, w, h);
    const base = y + h;
    // 遠層低矮山巒(填滿底線,墊背景)
    g.fillStyle(f.smoke, 0.55);
    for (let mx = x; mx < x + w; mx += Phaser.Math.Between(70, 120)) {
      const mw = Phaser.Math.Between(70, 130), mh = Phaser.Math.Between(Math.round(h * 0.3), Math.round(h * 0.55));
      g.fillTriangle(mx - mw / 2, base, mx + mw / 2, base, mx, base - mh);
    }
    // 主火山(縮小,2 座)分散
    const peaks = 2;
    for (let p = 0; p < peaks; p++) {
      const mx = x + (p + 0.5) * (w / peaks) + Phaser.Math.Between(-40, 40);
      const mw = Phaser.Math.Between(Math.round(w * 0.18), Math.round(w * 0.26));
      const mh = Math.max(30, h * 0.7);
      const mtop = base - mh;
      g.fillStyle(f.smoke, 0.98);
      g.fillTriangle(mx - mw / 2, base, mx + mw / 2, base, mx, mtop);
      // 熔岩流
      g.lineStyle(2, f.lava, 0.85);
      for (let l = 0; l < 2; l++) {
        let lx = mx + Phaser.Math.Between(-10, 10), ly = mtop + 4;
        g.beginPath(); g.moveTo(lx, ly);
        for (let s = 0; s < 4; s++) { lx += Phaser.Math.Between(-12, 12); ly += Phaser.Math.Between(10, 18); g.lineTo(lx, ly); }
        g.strokePath();
      }
      // 噴煙 + 山口亮點
      for (let s = 0; s < 4; s++) { g.fillStyle(f.smoke, 0.35); g.fillCircle(mx + Phaser.Math.Between(-20, 20), mtop - Phaser.Math.Between(2, 26), Phaser.Math.Between(10, 20)); }
      g.fillStyle(f.lava, 0.9); g.fillCircle(mx, mtop + 3, 6);
    }
  }

  /**
   * ★第二輪森林地貌(關5-6):在 generateTexture 的 graphics 上畫【森林地面】——
   * 草地底 + 大片草皮斑塊(明暗綠)+ 草叢(細條)+ 蕨葉簇 + 落葉 + 苔石 + 藤蔓 + 林間光斑。
   * level 6(幽深林地)比 level 5(翠綠森林)更暗更密(darkBias)。
   */
  private drawForestGround(gt: Phaser.GameObjects.Graphics, w: number, h: number, lv: any, level: number): void {
    const leaf = GameConfig.scene.forestLeaf as number;
    const deep = level >= 6; // 幽深林地:更暗更密
    // 大片草皮斑塊(不規則多邊,明暗綠交錯,做出草地起伏)
    for (let i = 0; i < 150; i++) {
      const bx = Phaser.Math.Between(0, w), by = Phaser.Math.Between(0, h);
      const rr = Phaser.Math.Between(14, 40);
      gt.fillStyle(Math.random() < (deep ? 0.62 : 0.5) ? lv.groundDark : lv.groundLight, deep ? 0.18 : 0.16);
      const pts: Phaser.Geom.Point[] = [];
      const sides = Phaser.Math.Between(5, 7);
      for (let s = 0; s < sides; s++) { const a = (s / sides) * Math.PI * 2; const rad = rr * (0.55 + Math.random() * 0.6); pts.push(new Phaser.Geom.Point(bx + Math.cos(a) * rad, by + Math.sin(a) * rad)); }
      gt.fillPoints(pts, true);
    }
    // 草叢(向上放射的細綠條,鋪滿地面草感)
    const tufts = deep ? 220 : 260;
    for (let i = 0; i < tufts; i++) {
      const x = Phaser.Math.Between(2, w - 2), y = Phaser.Math.Between(2, h - 2);
      const blades = Phaser.Math.Between(3, 5);
      const col = Math.random() < 0.5 ? lv.groundLight : leaf;
      gt.lineStyle(1, col, deep ? 0.4 : 0.55);
      for (let k = 0; k < blades; k++) { const a = -Math.PI / 2 + Phaser.Math.FloatBetween(-0.6, 0.6); const ln = Phaser.Math.Between(5, 12); gt.beginPath(); gt.moveTo(x, y); gt.lineTo(x + Math.cos(a) * ln, y + Math.sin(a) * ln); gt.strokePath(); }
    }
    gt.lineStyle(0, 0, 0);
    // 蕨葉簇(較大的深綠圓簇,像矮灌木/蕨)
    for (let i = 0; i < (deep ? 26 : 20); i++) {
      const x = Phaser.Math.Between(10, w - 10), y = Phaser.Math.Between(10, h - 10);
      gt.fillStyle(lv.groundDark, 0.5);
      for (let k = 0; k < 4; k++) gt.fillCircle(x + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-8, 8), Phaser.Math.Between(5, 11));
      gt.fillStyle(lv.groundLight, 0.3); gt.fillCircle(x, y - 3, Phaser.Math.Between(3, 6)); // 受光高光
    }
    // 苔石(灰綠圓 + 高光)
    for (let i = 0; i < 22; i++) {
      const x = Phaser.Math.Between(6, w - 6), y = Phaser.Math.Between(6, h - 6);
      gt.fillStyle(lv.pebble, 0.7); gt.fillCircle(x, y, Phaser.Math.Between(4, 9));
      gt.fillStyle(lv.groundLight, 0.35); gt.fillCircle(x - 2, y - 2, Phaser.Math.Between(2, 4));
    }
    // 藤蔓(蜿蜒綠折線,爬過地面)
    gt.lineStyle(2, lv.groundDark, 0.55);
    for (let c = 0; c < (deep ? 10 : 7); c++) {
      let cx = Phaser.Math.Between(0, w), cy = Phaser.Math.Between(0, h);
      gt.beginPath(); gt.moveTo(cx, cy);
      const segs = Phaser.Math.Between(4, 7);
      for (let s = 0; s < segs; s++) { cx += Phaser.Math.Between(-60, 60); cy += Phaser.Math.Between(-50, 50); gt.lineTo(cx, cy); }
      gt.strokePath();
    }
    gt.lineStyle(0, 0, 0);
    // 落葉(小黃綠點,散落)
    for (let i = 0; i < 90; i++) { gt.fillStyle(leaf, 0.5); gt.fillCircle(Phaser.Math.Between(4, w - 4), Phaser.Math.Between(4, h - 4), Phaser.Math.Between(1, 3)); }
    // 林間光斑(晨光穿過林冠灑地,淡黃綠大圓,level 5 較多較亮)
    const dapples = deep ? 6 : 12;
    for (let i = 0; i < dapples; i++) {
      const x = Phaser.Math.Between(30, w - 30), y = Phaser.Math.Between(30, h - 30);
      gt.fillStyle(GameConfig.scene.forestMote as number, deep ? 0.05 : 0.09); gt.fillCircle(x, y, Phaser.Math.Between(26, 54));
    }
  }

  /**
   * ★第二輪森林遠景(關5-6):遠樹林/林冠剪影——遠層霧綠林冠帶 + 一排排樹冠(圓叢)+ 樹幹,
   * 比照 drawFarRuinedCity/drawFarVolcano 的分層填滿手法。sideA=晨光林緣(亮)、sideB=幽深林冠(深)。
   */
  private drawFarForest(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, side: 'A' | 'B'): void {
    const f = side === 'A' ? GameConfig.scene.farForestA : GameConfig.scene.farForestB;
    g.fillStyle(f.haze, 0.5); g.fillRect(x, y, w, h); // 林間霧
    const base = y + h;
    // 遠層低矮林冠(墊背景,淡)
    g.fillStyle(f.canopyDark, 0.5);
    for (let bx = x; bx < x + w; bx += Phaser.Math.Between(26, 46)) {
      const bh = Phaser.Math.Between(Math.round(h * 0.2), Math.round(h * 0.45));
      for (let k = 0; k < 3; k++) g.fillCircle(bx + Phaser.Math.Between(-10, 10), base - bh + Phaser.Math.Between(-6, 6), Phaser.Math.Between(10, 20));
    }
    // 中層樹群(樹幹 + 圓叢樹冠,一排,密)
    let tx = x;
    while (tx < x + w) {
      const seg = Phaser.Math.Between(30, 54);
      const th = Phaser.Math.Between(Math.round(h * 0.4), Math.round(h * 0.8));
      const topY = base - th;
      // 樹幹
      g.fillStyle(f.trunk, 0.9); g.fillRect(tx + seg * 0.4, base - th * 0.5, Math.max(3, seg * 0.12), th * 0.5);
      // 樹冠(重疊圓叢)
      g.fillStyle(f.canopy, 0.95);
      for (let k = 0; k < 5; k++) g.fillCircle(tx + seg * 0.5 + Phaser.Math.Between(-seg * 0.3, seg * 0.3), topY + Phaser.Math.Between(-4, 14), Phaser.Math.Between(Math.round(seg * 0.28), Math.round(seg * 0.5)));
      // 受光高光(頂部亮綠)
      g.fillStyle(f.haze, 0.5); g.fillCircle(tx + seg * 0.5, topY + 2, Phaser.Math.Between(6, 12));
      tx += seg + Phaser.Math.Between(2, 10);
    }
    // 前層幾棵較大的樹冠(近林緣,更飽和)
    const bigs = Math.max(3, Math.round(w / 260));
    for (let t = 0; t < bigs; t++) {
      const cx = x + 30 + (t + 0.5) * (w / bigs) + Phaser.Math.Between(-30, 30);
      const ch = Phaser.Math.Between(Math.round(h * 0.7), Math.round(h * 1.05));
      const topY = base - ch;
      g.fillStyle(f.trunk, 0.95); g.fillRect(cx - 4, base - ch * 0.45, 8, ch * 0.45);
      g.fillStyle(f.canopy, 1);
      for (let k = 0; k < 7; k++) g.fillCircle(cx + Phaser.Math.Between(-26, 26), topY + Phaser.Math.Between(-6, 22), Phaser.Math.Between(14, 26));
    }
  }

  /**
   * ★第二輪洞窟地貌(關7-8):岩石地面——暗岩底 + 岩板拼接(多邊暗塊)+ 碎石 + 裂縫 + 水漬反光 +
   * 微弱冷光斑(microglow 磷光/水光)。level 8(深淵)比 level 7(陰森洞窟)更暗更密、冷光更少更冷。
   */
  private drawCaveGround(gt: Phaser.GameObjects.Graphics, w: number, h: number, lv: any, level: number): void {
    const deep = level >= 8;
    const glow = (lv.glow || GameConfig.scene.caveGlow) as number;
    // 岩板拼接(大多邊暗塊,像洞窟岩盤地)
    for (let i = 0; i < 90; i++) {
      const bx = Phaser.Math.Between(0, w), by = Phaser.Math.Between(0, h);
      const rr = Phaser.Math.Between(18, 46);
      gt.fillStyle(Math.random() < 0.6 ? lv.groundDark : lv.groundLight, deep ? 0.2 : 0.16);
      const pts: Phaser.Geom.Point[] = [];
      const sides = Phaser.Math.Between(5, 7);
      for (let s = 0; s < sides; s++) { const a = (s / sides) * Math.PI * 2; const rad = rr * (0.6 + Math.random() * 0.5); pts.push(new Phaser.Geom.Point(bx + Math.cos(a) * rad, by + Math.sin(a) * rad)); }
      gt.fillPoints(pts, true);
    }
    // 岩板縫(暗折線,拼接感)
    gt.lineStyle(2, lv.crackColor, 0.8);
    for (let c = 0; c < 20; c++) {
      let cx = Phaser.Math.Between(0, w), cy = Phaser.Math.Between(0, h);
      gt.beginPath(); gt.moveTo(cx, cy);
      const segs = Phaser.Math.Between(3, 6);
      for (let s = 0; s < segs; s++) { cx += Phaser.Math.Between(-80, 80); cy += Phaser.Math.Between(-60, 60); gt.lineTo(cx, cy); }
      gt.strokePath();
    }
    gt.lineStyle(0, 0, 0);
    // 碎石(散落暗灰顆粒)
    for (let i = 0; i < 120; i++) { gt.fillStyle(lv.pebble, 0.7); gt.fillCircle(Phaser.Math.Between(4, w - 4), Phaser.Math.Between(4, h - 4), Phaser.Math.Between(1, 4)); }
    // 較大碎岩塊(多邊,帶暗邊)
    for (let i = 0; i < (deep ? 24 : 18); i++) {
      const bx = Phaser.Math.Between(10, w - 10), by = Phaser.Math.Between(10, h - 10);
      gt.fillStyle(lv.groundLight, 0.5);
      const pts: Phaser.Geom.Point[] = []; const rr = Phaser.Math.Between(8, 18);
      for (let s = 0; s < 5; s++) { const a = (s / 5) * Math.PI * 2; const rad = rr * (0.6 + Math.random() * 0.5); pts.push(new Phaser.Geom.Point(bx + Math.cos(a) * rad, by + Math.sin(a) * rad)); }
      gt.fillPoints(pts, true);
    }
    // 水漬反光(冷色橢圓 + 白冷高光,潮濕地感)
    for (let i = 0; i < (deep ? 8 : 12); i++) {
      const x = Phaser.Math.Between(20, w - 20), y = Phaser.Math.Between(20, h - 20);
      gt.fillStyle(GameConfig.scene.caveGlow, 0.12); gt.fillEllipse ? gt.fillEllipse(x, y, Phaser.Math.Between(24, 50), Phaser.Math.Between(10, 20)) : gt.fillCircle(x, y, Phaser.Math.Between(14, 26));
      gt.fillStyle(GameConfig.scene.caveMote, 0.16); gt.fillCircle(x - 4, y - 2, Phaser.Math.Between(2, 5));
    }
    // 微弱冷光斑(microglow 磷光,散布小冷光圓;深淵更少)
    const glows = deep ? 8 : 16;
    for (let i = 0; i < glows; i++) {
      const x = Phaser.Math.Between(10, w - 10), y = Phaser.Math.Between(10, h - 10);
      gt.fillStyle(glow, deep ? 0.1 : 0.16); gt.fillCircle(x, y, Phaser.Math.Between(3, 8));
      gt.fillStyle(glow, deep ? 0.05 : 0.08); gt.fillCircle(x, y, Phaser.Math.Between(10, 20)); // 外暈
    }
  }

  /**
   * ★第二輪洞窟遠景(關7-8):岩壁/鐘乳石(上垂)/石筍(下立)/洞穴輪廓/深處冷光。
   * 比照 drawFarForest/Volcano 分層填滿。variant A=洞口微光(較亮)、B=洞窟深淵(更暗)。
   */
  private drawFarCave(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, variant: 'A' | 'B'): void {
    const f = variant === 'A' ? GameConfig.scene.farCaveA : GameConfig.scene.farCaveB;
    const base = y + h;
    // 岩壁底色 + 深處冷光暈(洞穴縱深感)
    g.fillStyle(f.rockDark, 0.85); g.fillRect(x, y, w, h);
    // 深處冷光(幾處微光洞,ADD 感用半透明疊)
    for (let i = 0; i < Math.max(2, Math.round(w / 320)); i++) {
      const gx = x + (i + 0.5) * (w / Math.max(2, Math.round(w / 320))) + Phaser.Math.Between(-40, 40);
      const gy = y + h * 0.55;
      g.fillStyle(f.haze, 0.4); g.fillCircle(gx, gy, Phaser.Math.Between(20, 40));
      g.fillStyle(f.glow, variant === 'A' ? 0.35 : 0.22); g.fillCircle(gx, gy, Phaser.Math.Between(8, 18));
    }
    // 岩壁塊(參差暗岩,填背景)
    g.fillStyle(f.rock, 0.9);
    for (let bx = x; bx < x + w; bx += Phaser.Math.Between(34, 60)) {
      const bw = Phaser.Math.Between(34, 64), bh = Phaser.Math.Between(Math.round(h * 0.3), Math.round(h * 0.7));
      const pts: Phaser.Geom.Point[] = [
        new Phaser.Geom.Point(bx, base), new Phaser.Geom.Point(bx, base - bh),
        new Phaser.Geom.Point(bx + bw * 0.5, base - bh - Phaser.Math.Between(0, 16)),
        new Phaser.Geom.Point(bx + bw, base - bh), new Phaser.Geom.Point(bx + bw, base)
      ];
      g.fillPoints(pts, true);
    }
    // 鐘乳石(從頂部向下垂的三角錐,密)
    g.fillStyle(f.rock, 0.95);
    for (let sx = x; sx < x + w; sx += Phaser.Math.Between(24, 46)) {
      const sw = Phaser.Math.Between(8, 20), sh = Phaser.Math.Between(Math.round(h * 0.18), Math.round(h * 0.5));
      g.fillTriangle(sx, y, sx + sw, y, sx + sw * 0.5, y + sh);
      // 尖端冷光滴
      if (Math.random() < 0.25) { g.fillStyle(f.glow, 0.5); g.fillCircle(sx + sw * 0.5, y + sh, 2); g.fillStyle(f.rock, 0.95); }
    }
    // 石筍(從底部向上立的三角錐,前景)
    g.fillStyle(f.rockDark, 0.98);
    for (let sx = x + 12; sx < x + w; sx += Phaser.Math.Between(40, 80)) {
      const sw = Phaser.Math.Between(12, 26), sh = Phaser.Math.Between(Math.round(h * 0.2), Math.round(h * 0.5));
      g.fillTriangle(sx - sw * 0.5, base, sx + sw * 0.5, base, sx, base - sh);
    }
    // 洞穴輪廓(頂部拱形暗邊,框出洞內)
    g.lineStyle(3, f.rockDark, 0.7);
    g.beginPath(); g.moveTo(x, y + h * 0.2);
    for (let ax = x; ax <= x + w; ax += 40) { g.lineTo(ax, y + Phaser.Math.Between(4, 24)); }
    g.strokePath(); g.lineStyle(0, 0, 0);
  }

  /** v28：生成 BOSS（HP 隨第幾隻 BOSS + 等級成長）+ 登場提示 + 血條啟用 */
  private spawnBoss(): void {
    this.bossCount++;
    const b = GameConfig.boss;
    // HP 倍率：隨 boss 序號成長 × 等級 HP 縮放
    const hpMult = (1 + (this.bossCount - 1) * b.hpGrowthPerBoss) * this.curEnemyHpScale();
    // v35：BOSS 暫改固定在場地正中央不動
    const bx = this.arena.centerX;
    const by = b.stationary ? this.arena.centerY : this.arena.top + b.radius + 40;
    const boss = this.enemies.get(bx, by) as Enemy | null;
    if (!boss) return;
    boss.onAttackFire = this.onEnemyAttackFire;
    boss.onShoot = this.onEnemyShoot;
    boss.onLaserFire = this.onEnemyLaserFire;
    boss.onBombThrow = this.onEnemyBombThrow;
    boss.onBossSkill = this.onBossSkill; // v36：四招輪替
    boss.spawn(bx, by, this.time.now, 'boss', hpMult);
    boss.setScale(1);
    this.boss = boss;
    this.spawnBossAnchors(); // v36：生成 4 個錨點
    this.bossDamageAccum = 0; // v35
    this.bossCasting = false; // v38
    this.bossGapBallAt = this.time.now + GameConfig.boss.gapBall.intervalMs; // v38：開場先進 gap 丟球
    // 登場提示
    const txt = this.add
      .text(GameConfig.width / 2, GameConfig.height * 0.32, 'BOSS 出現！', {
        fontFamily: 'monospace',
        fontSize: '46px',
        color: '#ff3355',
        stroke: '#000000',
        strokeThickness: 7,
        fontStyle: 'bold'
      })
      .setOrigin(0.5)
      .setDepth(60)
      .setAlpha(0);
    this.tweens.add({ targets: txt, alpha: 1, scale: { from: 0.6, to: 1.1 }, duration: 400, yoyo: true, hold: 800, onComplete: () => txt.destroy() });
    this.shakeOnce(200, 0.01);
    this.game.events.emit('boss-hp', { active: true, ratio: 1 });
    this.emitStats();
  }

  /** v28 BOSS 招式 (a)：近身大範圍橫掃（前搖預警圈 → 發動對範圍內角色扣血） */
  /**
   * v36/39：BOSS 三招輪替總入口（a→c→d，v39 移除 b）。
   * a：自身圓炸；c：瞄玩家 250° 扇形；d：左右半場接力。
   */
  private onBossSkill = (boss: Enemy, kind: 'a' | 'b' | 'c' | 'd', tx: number, ty: number): void => {
    if (this.gameOver || !boss.active) return;
    // v38：招式蓄力期間 = casting，gap 空檔才丟球。以該招 fill 總時長標記 casting 結束。
    this.bossCasting = true;
    const sk = GameConfig.boss.skills;
    const fill = kind === 'a' ? sk.a.fillMs : kind === 'b' ? sk.b.fillMs : kind === 'c' ? sk.c.fillMs : sk.d.fillMs;
    const total = kind === 'd' ? sk.d.fillMs * sk.d.halfOverlap + sk.d.fillMs : fill; // d 接力較長
    // v39(1)：招式【完全釋放完】後才起算 gap——此刻 casting 結束、開始丟 gap 球、並排程下一招 = 釋放完 + gapMs
    this.time.delayedCall(total + 50, () => {
      this.bossCasting = false;
      const now = this.time.now;
      this.bossGapBallAt = now + GameConfig.boss.gapBall.intervalMs;
      if (this.boss && this.boss.active) this.boss.scheduleBossNextAttack(now + sk.gapMs);
    });
    if (kind === 'a') this.bossSkillA(boss);
    else if (kind === 'b') this.bossSkillB(boss);
    else if (kind === 'c') this.bossSkillC(boss, tx, ty);
    else this.bossSkillD(boss);
  };

  /**
   * v38(F)：BOSS 出招間隔(gap 空檔，非蓄招中)每 gapBall.intervalMs 朝玩家丟一顆球狀飛行投射物。
   * 命中 damageCharacterFrom(小傷害)，填補空檔小威脅、比大招好閃。
   */
  private updateBossGapBalls(time: number): void {
    const boss = this.boss;
    if (!boss || !boss.active) return;
    if (this.bossCasting) return; // 蓄招中不丟
    if (time < this.bossGapBallAt) return;
    this.bossGapBallAt = time + GameConfig.boss.gapBall.intervalMs;
    this.spawnBossGapBall(boss);
  }

  private spawnBossGapBall(boss: Enemy): void {
    const cfg = GameConfig.boss.gapBall;
    // 朝丟出當下最近存活角色方向直線飛
    const target = this.nearestAliveCharacter(boss.x, boss.y) ?? this.player;
    const ang = Phaser.Math.Angle.Between(boss.x, boss.y, target.x, target.y);
    const ball = this.add.circle(boss.x, boss.y, cfg.radius, cfg.color, 1).setDepth(22);
    ball.setStrokeStyle(2, 0xffffff, 0.8);
    const vx = Math.cos(ang) * cfg.speed;
    const vy = Math.sin(ang) * cfg.speed;
    let hitDone = false;
    const ev = this.time.addEvent({
      delay: 16, loop: true, callback: () => {
        if (this.gameOver || !ball.active) { ev.remove(); return; }
        ball.x += vx * 0.016;
        ball.y += vy * 0.016;
        // 命中角色
        for (const c of this.characters) {
          if (!c.alive || c.isInvulnerable(this.time.now)) continue;
          if (Phaser.Math.Distance.Between(ball.x, ball.y, c.x, c.y) <= cfg.radius + GameConfig.player.radius) {
            this.damageCharacterFrom(c, cfg.damage, ball.x, ball.y);
            hitDone = true; break;
          }
        }
        // 飛出場 或 命中 → 銷毀
        if (hitDone || ball.x < this.arena.left - 40 || ball.x > this.arena.right + 40 ||
            ball.y < this.arena.top - 40 || ball.y > this.arena.bottom + 40) {
          ev.remove(); ball.destroy();
        }
      }
    });
  }

  /** 找離某點最近的存活角色 */
  private nearestAliveCharacter(x: number, y: number): Character | null {
    let best: Character | null = null; let bestD = Infinity;
    for (const c of this.characters) {
      if (!c.alive) continue;
      const d = Phaser.Math.Distance.Between(x, y, c.x, c.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  /** 對「符合 pred(距離/角度) 的環境內存活角色」在 fill 完成後結算傷害；pred 回 true = 命中。
   *  v45(5)：BOSS 招命中 → 扣血 + 定身 rootMs（預設 2000；無敵仍可擋傷）。 */
  private bossReleaseDamage(pred: (c: Character) => boolean, dmg: number, rootMs = GameConfig.boss.skillRootMs): void {
    const now = this.time.now;
    for (const c of this.characters) {
      if (!c.alive || c.isInvulnerable(now)) continue; // 無敵擋傷
      if (pred(c)) this.damageCharacterFrom(c, dmg, c.x, c.y, rootMs);
    }
  }

  /** v36 招 a：以 BOSS 為中心的實心大圓轟炸（由內而外填滿預警 → 圓內扣血） */
  private bossSkillA(boss: Enemy): void {
    const s = GameConfig.boss.skills.a;
    const ox = boss.x, oy = boss.y;
    const g = this.add.graphics().setDepth(4);
    const fx: { owner: 'tower' | 'boss'; gfx: Phaser.GameObjects.Graphics; tween?: Phaser.Tweens.Tween; fired: boolean } =
      { owner: 'boss', gfx: g, fired: false };
    this.telegraphFx.push(fx);
    const p = { t: 0 };
    fx.tween = this.tweens.add({
      targets: p, t: 1, duration: s.fillMs,
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, 0xff3355, 0.6); g.strokeCircle(ox, oy, s.radius);
        g.fillStyle(0xff3355, 0.28);
        g.fillCircle(ox, oy, s.radius * p.t); // 由內而外填滿實心圓
      },
      onComplete: () => {
        fx.fired = true; this.removeTelegraphFx(fx);
        g.destroy();
        if (this.gameOver || !boss.active) return;
        this.spawnExpandingRing(ox, oy, s.radius, 0xff3355, 300);
        this.shakeOnce(120, 0.008);
        this.bossReleaseDamage(c => Phaser.Math.Distance.Between(c.x, c.y, ox, oy) <= s.radius, s.damage);
      }
    });
  }

  /** v36 招 b：全場轟炸、只有 BOSS 周圍 safeRadius(=a.radius) 圓形安全（由外而內填滿逼玩家進中心） */
  private bossSkillB(boss: Enemy): void {
    const s = GameConfig.boss.skills.b;
    const safeR = GameConfig.boss.skills.a.radius;
    const ox = boss.x, oy = boss.y;
    const maxR = Math.hypot(GameConfig.width, GameConfig.height); // 覆蓋全場的外半徑
    const g = this.add.graphics().setDepth(4);
    const fx: { owner: 'tower' | 'boss'; gfx: Phaser.GameObjects.Graphics; tween?: Phaser.Tweens.Tween; fired: boolean } =
      { owner: 'boss', gfx: g, fired: false };
    this.telegraphFx.push(fx);
    const p = { t: 0 };
    fx.tween = this.tweens.add({
      targets: p, t: 1, duration: s.fillMs,
      onUpdate: () => {
        g.clear();
        // 安全圈輪廓（綠）：提示這裡安全
        g.lineStyle(3, 0x66ff99, 0.8); g.strokeCircle(ox, oy, safeR);
        // 危險區由外而內填滿逼近安全圈：填到 maxR → safeR
        const innerR = maxR - (maxR - safeR) * p.t;
        g.fillStyle(0xff3355, 0.26);
        g.beginPath();
        g.arc(ox, oy, maxR, 0, Math.PI * 2, false);
        g.arc(ox, oy, innerR, 0, Math.PI * 2, true);
        g.closePath();
        g.fillPath();
      },
      onComplete: () => {
        fx.fired = true; this.removeTelegraphFx(fx);
        g.destroy();
        if (this.gameOver || !boss.active) return;
        this.spawnExpandingRing(ox, oy, safeR, 0x66ff99, 300);
        this.shakeOnce(140, 0.009);
        // 安全區外（距 BOSS > safeR）= 全場都打
        this.bossReleaseDamage(c => Phaser.Math.Distance.Between(c.x, c.y, ox, oy) > safeR, s.damage);
      }
    });
  }

  /** v36 招 c：瞄施放當下玩家方向的 250° 大扇形（留 110° 缺口），扇形內扣血 */
  private bossSkillC(boss: Enemy, tx: number, ty: number): void {
    const s = GameConfig.boss.skills.c;
    const ox = boss.x, oy = boss.y;
    const center = Phaser.Math.Angle.Between(ox, oy, tx, ty); // 朝玩家
    const half = Phaser.Math.DegToRad(s.arcDeg) / 2;
    const g = this.add.graphics().setDepth(4);
    const inArc = (c: Character): boolean => {
      const d = Phaser.Math.Distance.Between(c.x, c.y, ox, oy);
      if (d > s.range) return false;
      const a = Phaser.Math.Angle.Between(ox, oy, c.x, c.y);
      const diff = Math.abs(Phaser.Math.Angle.Wrap(a - center));
      return diff <= half; // 在扇形內（缺口在 center 反方向 ±(180-arc/2)）
    };
    const p = { t: 0 };
    const fxC: { owner: 'tower' | 'boss'; gfx: Phaser.GameObjects.Graphics; tween?: Phaser.Tweens.Tween; fired: boolean } =
      { owner: 'boss', gfx: g, fired: false };
    this.telegraphFx.push(fxC);
    fxC.tween = this.tweens.add({
      targets: p, t: 1, duration: s.fillMs,
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, 0xffaa33, 0.6);
        // 扇形輪廓
        g.beginPath(); g.arc(ox, oy, s.range, center - half, center + half, false); g.strokePath();
        // 由內而外填滿的扇形
        g.fillStyle(0xffaa33, 0.28);
        g.slice(ox, oy, s.range * p.t, center - half, center + half, false);
        g.fillPath();
      },
      onComplete: () => {
        fxC.fired = true; this.removeTelegraphFx(fxC);
        g.destroy();
        if (this.gameOver || !boss.active) return;
        this.spawnExpandingRing(ox, oy, s.range, 0xffaa33, 260);
        this.shakeOnce(120, 0.008);
        this.bossReleaseDamage(inArc, s.damage);
      }
    });
  }

  /** v36 招 d：左右半場接力轟炸（左半先炸，左半 fill 到 halfOverlap 時右半開始 fill）
   *  v58：右半改由【左半 fill tween 的實際進度】觸發(而非獨立 delayedCall)——delayedCall 不受時停 pause/resume
   *  影響，時停後會與左半失步(左半被凍、右半計時照跑)導致左右同時蓄力；綁左半進度後，時停凍左半→右半也跟著晚觸發。 */
  private bossSkillD(boss: Enemy): void {
    const s = GameConfig.boss.skills.d;
    let rightStarted = false;
    // 左半（x < cx）先炸；左半 fill 進度到 halfOverlap 時才觸發右半(接力、隨時停一起凍結)
    this.bossHalfTelegraph('left', s.fillMs, s.damage, (progress) => {
      if (rightStarted || progress < s.halfOverlap) return;
      rightStarted = true;
      if (this.gameOver || !boss.active) return;
      this.bossHalfTelegraph('right', s.fillMs, s.damage);
    });
  }

  /** v36 招 d 輔助：半場矩形填滿預警 → 釋放對該半邊角色扣血。v58：onProgress 每幀回報 fill 進度(左半接力觸發右半用)。 */
  private bossHalfTelegraph(side: 'left' | 'right', fillMs: number, dmg: number, onProgress?: (t: number) => void): void {
    const cx = this.arena.centerX;
    const left = side === 'left' ? this.arena.left : cx;
    const right = side === 'left' ? cx : this.arena.right;
    const top = this.arena.top, bottom = this.arena.bottom;
    const w = right - left, h = bottom - top;
    const color = side === 'left' ? 0xff5577 : 0xff8844;
    const g = this.add.graphics().setDepth(4);
    const fxD: { owner: 'tower' | 'boss'; gfx: Phaser.GameObjects.Graphics; tween?: Phaser.Tweens.Tween; fired: boolean } =
      { owner: 'boss', gfx: g, fired: false };
    this.telegraphFx.push(fxD);
    const p = { t: 0 };
    fxD.tween = this.tweens.add({
      targets: p, t: 1, duration: fillMs,
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, color, 0.6); g.strokeRect(left, top, w, h);
        // 由上而下填滿該半場矩形
        g.fillStyle(color, 0.26);
        g.fillRect(left, top, w, h * p.t);
        if (onProgress) onProgress(p.t); // v58：左半 fill 進度回報 → 到 halfOverlap 觸發右半(接力，隨時停一起凍)
      },
      onComplete: () => {
        fxD.fired = true; this.removeTelegraphFx(fxD);
        g.destroy();
        if (this.gameOver || !this.boss || !this.boss.active) return; // v45(4)：BOSS 已死 → 不發射
        this.shakeOnce(110, 0.008);
        const inHalf = (c: Character): boolean => side === 'left' ? c.x < cx : c.x >= cx;
        this.bossReleaseDamage(inHalf, dmg);
      }
    });
  }

  /**
   * v36：BOSS 戰生成 4 個錨點（上/下/左/右，距 BOSS anchorDist，夾在場內）。
   * 錨點 = anchor-like 位移點：可鎖定、可衝過去當走位落點、衝到不攻擊不傷害、不可被玩家傷。
   */
  private spawnBossAnchors(): void {
    this.clearBossAnchors();
    if (!GameConfig.boss.bossAnchorsEnabled) return; // v41(3)：暫時關閉錨點
    const b = GameConfig.boss;
    const boss = this.boss;
    if (!boss) return;
    const dirs = [
      { dx: 0, dy: -1 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 1, dy: 0 }
    ];
    const r = GameConfig.enemy.types.anchor.radius;
    const now = this.time.now;
    for (let i = 0; i < b.anchorCount && i < dirs.length; i++) {
      const d = dirs[i];
      const ax = Phaser.Math.Clamp(boss.x + d.dx * b.anchorDist, this.arena.left + r + 10, this.arena.right - r - 10);
      const ay = Phaser.Math.Clamp(boss.y + d.dy * b.anchorDist, this.arena.top + r + 10, this.arena.bottom - r - 10);
      const a = this.enemies.get(ax, ay) as Enemy | null;
      if (!a) continue;
      this.wireEnemyCallbacks(a);
      a.spawn(ax, ay, now, 'anchor', 1);
      (a as unknown as { telegraphing: boolean }).telegraphing = false;
      (a.body as Phaser.Physics.Arcade.Body).enable = true;
      a.setAlpha(1);
      this.bossAnchors.push(a);
    }
  }

  /** v36：清除所有 BOSS 戰錨點（BOSS 被打倒/戰鬥結束時） */
  private clearBossAnchors(): void {
    for (const a of this.bossAnchors) {
      if (a && a.active) a.kill();
    }
    this.bossAnchors = [];
  }

  /** v28：BOSS 召喚的小怪（不計 waveSpawned/quota） */
  private spawnSummonAt(x: number, y: number, time: number, forceType?: EnemyType, leashImmune = false, forceChase = false): void {
    const type = forceType ?? this.pickEnemyType();
    const enemy = this.enemies.get(x, y) as Enemy | null;
    if (!enemy) return;
    enemy.onAttackFire = this.onEnemyAttackFire;
    enemy.onShoot = this.onEnemyShoot;
    enemy.onLaserFire = this.onEnemyLaserFire;
    enemy.onBombThrow = this.onEnemyBombThrow;
    enemy.spawn(x, y, time, type, this.curEnemyHpScale());
    enemy.targetSeat = this.nearestSeat(x, y); // ★黏著:召喚怪也綁最近角色(守護波 resolveEnemyTarget 會覆寫成 guardNpc)
    if (leashImmune) { enemy.leashRadius = Infinity; enemy.leashTravelDist = Infinity; } // ★守護波怪免疫 leash(一直衝 NPC)
    if (forceChase) enemy.forceChase = true; // ★守護波怪:無視 alertRadius 生成即直衝目標(NPC)
  }

  /**
   * v35：打 BOSS 過程噴道具——累積傷害每跨過 dropEveryDamage 門檻，就在 BOSS 附近掉 1 個道具。
   * 讓玩家打高血量 BOSS 時能撿道具續戰。
   */
  private accumBossDamageDrop(dmg: number, time: number): void {
    const boss = this.boss;
    if (!boss || !boss.active) return;
    const per = GameConfig.boss.dropEveryDamage;
    if (per <= 0) return;
    this.bossDamageAccum += dmg;
    while (this.bossDamageAccum >= per) {
      this.bossDamageAccum -= per;
      // v44：噴在 BOSS 外圈(距 dropDist±scatter，隨機方向)，不掉腳邊被身體擋住撿不到
      const dd = GameConfig.boss.dropDist;
      const sc = GameConfig.boss.dropScatter;
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const rad = dd + Phaser.Math.Between(-sc * 0.4, sc * 0.4);
      const dx = Phaser.Math.Clamp(boss.x + Math.cos(ang) * rad, this.arena.left + 20, this.arena.right - 20);
      const dy = Phaser.Math.Clamp(boss.y + Math.sin(ang) * rad, this.arena.top + 20, this.arena.bottom - 20);
      this.dropItemAt(dx, dy, time);
    }
  }

  /** v28：BOSS 被擊殺——大爆炸 + 掉多個道具 + 該波過關 */
  private onBossKilled(bx: number, by: number): void {
    this.boss = null;
    this.clearTelegraphsOf('boss'); // v45(4)：清掉 BOSS 蓄力中的招式預警特效 + 取消發射
    this.clearBossAnchors(); // v36：清除錨點
    this.game.events.emit('boss-hp', { active: false, ratio: 0 });
    // 大爆炸
    this.spawnExpandingRing(bx, by, GameConfig.boss.sweepRadius * 1.4, 0xffd700, 500);
    this.shakeOnce(300, 0.014);
    for (let i = 0; i < 12; i++) this.spawnDeathBurst(bx + Phaser.Math.Between(-40, 40), by + Phaser.Math.Between(-40, 40));
    // 掉多個道具（v44：距 BOSS dropDist，避免掉腳邊被身體擋住撿不到）
    for (let i = 0; i < GameConfig.boss.dropCount; i++) {
      const ang = (i / GameConfig.boss.dropCount) * Math.PI * 2;
      const dd = GameConfig.boss.dropDist;
      const dx2 = Phaser.Math.Clamp(bx + Math.cos(ang) * dd, this.arena.left + 20, this.arena.right - 20);
      const dy2 = Phaser.Math.Clamp(by + Math.sin(ang) * dd, this.arena.top + 20, this.arena.bottom - 20);
      this.dropItemAt(dx2, dy2, this.time.now);
    }
    // ★第二輪:壓軸 BOSS(最終關 totalLevels=8)或無限循環的波次 BOSS 打倒 → 通關勝利畫面。
    if ((this.levelMode && this.isFinalLevel(this.currentLevel)) || this.isBossWave(this.currentWave)) {
      this.triggerClear();
      return;
    }
    // ★關4 中場 BOSS 打完(非最終關)→【淡出→進下一關(關5 森林 A 子區)】,不通關不結束。
    if (this.levelMode && this.isBossLevel(this.currentLevel)) {
      this.startTransition(); // fade out → advanceToNextLevel(關5 森林) → fade in
      return;
    }
    // 該波過關
    this.enterIntermission();
  }

  /** v39：通關（打倒第 8 關壓軸 BOSS）——顯示通關結算畫面（可重開）。仿 triggerGameOver 但 won=true。 */
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
      controlMode: this.controlMode // v46：重開保留模式
    };
    this.scene.stop('UIScene');
    this.scene.launch('GameOverScene', stats);
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.stop();
  }

  // ===========================================================================
  // v33 事件系統（塔 / 守護 / 佔領）——仿 BOSS 波：清完小怪→啟動事件→完成才過關
  // ===========================================================================
  private startEvent(kind: 'tower' | 'guard' | 'capture'): void {
    this.eventKind = kind;
    const now = this.time.now;
    
    // ★人數偵測與難度設定 - 在事件開始時鎖定難度，中途不再調整
    this.eventPlayerCount = this.getAliveCharacterCount();
    this.eventDifficultyMultiplier = this.calculateEventDifficultyMultiplier(this.eventPlayerCount);
    
    if (kind === 'tower') {
      const cfg = GameConfig.event.tower;
      // ★塔血量根據人數調整
      const baseHpMult = (1 + (this.currentWave - 1) * cfg.hpGrowthPerWave) * this.curEnemyHpScale();
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
        n.setDepth(11); // v62修:守護NPC depth 提到怪(depth5)之上→被怪群包圍時仍看得到,不被貼圖蓋住
        this.guardNpc = n;
        // v62:守護NPC高亮環(青色描邊,每幀跟隨),被包圍也一眼可辨
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
    // ★事件開場宣告序列:生目標後【先跑開場(雙段大字+滑出),不啟動事件計時/生怪】,序列結束才 beginEventCombat。
    this.startEventIntro(kind);
  }

  /**
   * ★事件波開場宣告(階段1):雙段大字+右滑出+鎖操作 gate。
   * 第一段統一大字「限時事件來了!」→顯示→右滑出;第二段各事件訊息(聚焦stub計時)→顯示→右滑出;
   * 兩段完 finishEventIntro→beginEventCombat(啟動計時/生怪)。逾時保底 eventIntroHardEndsAt 防卡死。
   */
  private startEventIntro(kind: 'tower' | 'guard' | 'capture'): void {
    const cfg = GameConfig.event.intro;
    const now = this.time.now;
    this.pendingEventKind = kind;
    this.eventIntroActive = true;
    this.eventIntroHardEndsAt = now + cfg.maxIntroSec * 1000; // ★逾時保底
    this.emitEventHud(); // 清 HUD(事件尚未真正開始)
    this.startEventIntroWalk(); // ★階段3:先角色自動走到目標周圍→再大字/聚焦
  }

  /** ★階段3:進 introMove 走位段——全隊自動走到目標(arena.center)周圍定位;到位/逾時→進統一大字。 */
  private startEventIntroWalk(): void {
    const cfg = GameConfig.event.intro;
    this.eventIntroStage = 'introMove';
    this.eventIntroSlideDone = false;
    this.eventIntroWalkEndsAt = this.time.now + cfg.maxWalkSec * 1000; // ★走位逾時保底
  }

  /** ★階段3每幀:全隊朝目標(arena.center)周圍環狀定位走(仿 updateLevelEnter);全到位 or 逾時→snap→進統一大字。 */
  private updateEventIntroWalk(delta: number): void {
    const cfg = GameConfig.event.intro;
    const speed = cfg.walkSpeed;
    const step = speed * (delta / 1000);
    const cx = this.arena.centerX, cy = this.arena.centerY; // ★目標=事件目標物(生在 arena 中心)
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
      if (timedOut) { c.x = t.x; c.y = t.y; c.aimAngle = Math.atan2(cy - c.y || -1, cx - c.x || 0); } // ★逾時 snap 到位
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
    // ★階段2:第二段=真聚焦——先 pan 鏡頭到目標置中,pan 完才開壓黑+開始 focus 計時(pan 期間不計時)。
    if (stage === 'perEvent') this.beginEventFocus();
  }

  /** ★階段2:開始聚焦——camera pan 到目標物置中(複用 crossing 的 stopFollow+pan 手法),pan 完 onFocusPanComplete。 */
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

  /** ★pan 完:開壓黑聚光 + 目標提 depth 露出 + 凍敵定格(eventFocusPause)+ 開始 focus hold 計時。 */
  private onFocusPanComplete(): void {
    const cfg = GameConfig.event.intro;
    this.eventFocusPanning = false;
    this.eventFocusPause = true; // ★獨立凍敵定格旗標(非借 timeStopped);開場 gate 本已凍全場,此旗標語意明確+供事件邏輯查用
    // 目標物提 depth(高於遮罩)——三型別:tower/guard=Enemy、capture=captureGfx(Graphics)
    const target = this.getEventFocusTarget();
    this.eventFocusTarget = target;
    if (target) {
      this.eventFocusTargetDepth = (target as unknown as { depth: number }).depth ?? 0;
      target.setDepth(cfg.focusTargetDepth);
    }
    // ★佔領事件:聚焦時【先把據點圈畫出來】(combat 才每幀畫,聚焦期間沒畫→只有空中心)。
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
    // ★佔領事件:聚光圈半徑依【實際據點圈半徑 captureRadius × 倍率】對齊玩家看到的據點(無鏡頭縮放→世界半徑=螢幕px);塔/守護維持固定 spotlightRadiusPx。
    const glowRadius = this.pendingEventKind === 'capture'
      ? GameConfig.event.capture.captureRadius * cfg.captureSpotlightMult
      : cfg.spotlightRadiusPx;
    const glow = this.add.circle(GameConfig.width / 2, GameConfig.height / 2, glowRadius, cfg.spotlightColor, 0)
      .setScrollFactor(0).setDepth(cfg.focusTargetDepth - 1).setBlendMode(Phaser.BlendModes.ADD);
    this.eventFocusGlow = glow;
    // ★佔領大圈用較低 alpha(避免大範圍 ADD 洗掉壓黑),塔/守護小圈維持 spotlightAlpha。
    const glowAlpha = this.pendingEventKind === 'capture' ? cfg.captureSpotlightAlpha : cfg.spotlightAlpha;
    this.tweens.add({ targets: glow, fillAlpha: glowAlpha, duration: cfg.dimFadeSec * 1000 });
    // ★pan 完才開始 focus hold 計時(第二段顯示滿=淡入已完+hold)
    this.eventIntroStageEndsAt = this.time.now + cfg.focusHoldSec * 1000;
  }

  /** 取得當前事件的聚焦目標物(tower/guard=Enemy,capture=captureGfx)。 */
  private getEventFocusTarget(): Phaser.GameObjects.Components.Depth | null {
    if (this.pendingEventKind === 'tower') return this.tower as unknown as Phaser.GameObjects.Components.Depth;
    if (this.pendingEventKind === 'guard') return this.guardNpc as unknown as Phaser.GameObjects.Components.Depth;
    if (this.pendingEventKind === 'capture') return this.captureGfx as unknown as Phaser.GameObjects.Components.Depth;
    return null;
  }

  /** ★聚焦結束:壓黑/亮暈 fadeOut、目標 depth 還原、eventFocusPause=false、鏡頭恢復 follow 當前 slot。 */
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

  /** ★開場大字:淡入(fadeInSec)→停在畫面(hold 由 stage 計時控制)→由 slideOutEventIntroBanner 觸發右滑出。 */
  private showEventIntroBanner(text: string): void {
    if (this.eventIntroBanner) { this.eventIntroBanner.destroy(); this.eventIntroBanner = null; }
    const cfg = GameConfig.event.intro;
    const t = this.add.text(GameConfig.width / 2, GameConfig.height * 0.3, text, {
      fontFamily: 'monospace', fontSize: '42px', color: '#ffd166', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(cfg.focusTargetDepth + 5).setAlpha(0); // ★depth 提到壓黑遮罩(focusTargetDepth-2)之上→聚焦時大字清晰不被壓黑
    this.eventIntroBanner = t;
    this.tweens.add({ targets: t, alpha: 1, duration: cfg.fadeInSec * 1000, ease: 'Quad.easeOut' });
  }

  /** ★觸發當前段大字【向右滑出】(x 往右 + alpha 淡出);滑完不自動推進(由狀態機計時推進)。 */
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

  /** ★開場每幀:推進雙段大字時序 + 逾時保底。gate 期間玩家鎖操作、事件不生怪。 */
  private updateEventIntro(time: number, delta: number): void {
    // 逾時保底:整段開場超時→強制結束解鎖(防卡死,最高風險)
    if (time >= this.eventIntroHardEndsAt) { this.finishEventIntro(); return; }
    // ★階段3:introMove 走位段——全隊走到目標周圍(到位/逾時→進統一大字)
    if (this.eventIntroStage === 'introMove') { this.updateEventIntroWalk(delta); return; }
    // ★階段2:pan 進行中→不推進 hold 計時(等 onFocusPanComplete 才開始 focus hold)
    if (this.eventFocusPanning) return;
    if (!this.eventIntroSlideDone && time >= this.eventIntroStageEndsAt) {
      // 本段顯示滿→觸發右滑出;★perEvent 段同時結束聚焦(壓黑消/鏡頭回follow/目標depth還原)
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

  /** ★開場結束:清狀態(一定執行,恢復操作)+ 啟動事件計時/生怪。 */
  private finishEventIntro(): void {
    this.eventIntroActive = false;
    this.eventIntroStage = 'done';
    this.eventIntroSlideDone = false;
    if (this.eventIntroBanner) { this.eventIntroBanner.destroy(); this.eventIntroBanner = null; }
    // ★逾時保底:確保聚焦殘留(壓黑/亮暈/目標depth/凍敵/pan/follow)一定清乾淨,防卡死/畫面殘留黑幕。
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

  /** ★開場宣告結束後才啟動:事件計時 + 首波生怪排程 + HUD(目標物此刻起才攻擊/生怪)。舊登場橫幅已移除(與新開場宣告重疊)。 */
  private beginEventCombat(kind: 'tower' | 'guard' | 'capture'): void {
    const now = this.time.now;
    if (kind === 'tower') {
      const cfg = GameConfig.event.tower;
      this.towerNextBlastAt = now + 800; // v39：首次光束延遲
      this.towerNextSpawnAt = now + 500;
      this.towerBeamGroup = 0;
      this.towerEndsAt = now + cfg.timeLimitMs; // ★限時倒數:此時間到仍未打掉塔→失敗進下一波
    } else if (kind === 'guard') {
      const cfg = GameConfig.event.guard;
      this.guardEndsAt = now + cfg.durationMs; // ★純時間制:撐滿 durationMs(60s)=守護成功(唯一成功時限)
      this.guardNextSpawnAt = now + 500;
      // ★守護【混合制+循環】:guardWaveIdx 選波種,guardWaveActive 防誤判,guardGlobalWaveCount 遞增計數
      this.guardWaveIdx = 0;
      this.guardWaveActive = false;
      this.guardGlobalWaveCount = 0;
    } else {
      this.captureNextWaveAt = now + 600; // v39：首波稍後生
      this.captureEndsAt = now + GameConfig.event.capture.timeLimitMs; // v40(1)：時限
    }
    // ★用戶調整:開戰不再跳舊事件橫幅(塔事件/守護NPC/佔領據點)——與新開場宣告重疊。HUD/計時保留。
    this.emitEventHud();
  }

  /** 掛上敵人回呼（生成點共用） */
  private wireEnemyCallbacks(e: Enemy): void {
    e.onAttackFire = this.onEnemyAttackFire;
    e.onShoot = this.onEnemyShoot;
    e.onLaserFire = this.onEnemyLaserFire;
    e.onBombThrow = this.onEnemyBombThrow;
    e.onBossSkill = this.onBossSkill; // v36
  }

  /** v33 事件登場提示（仿 BOSS 出現） */
  private showEventBanner(text: string): void {
    const txt = this.add
      .text(GameConfig.width / 2, GameConfig.height * 0.32, text, {
        fontFamily: 'monospace', fontSize: '40px', color: '#ffd166', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
      })
      .setOrigin(0.5).setDepth(60).setAlpha(0);
    this.tweens.add({ targets: txt, alpha: 1, scale: { from: 0.6, to: 1.1 }, duration: 400, yoyo: true, hold: 900, onComplete: () => txt.destroy() });
    this.shakeOnce(180, 0.008);
  }

  /** v33 事件 HUD 更新（label/ratio/remainMs） */
  private emitEventHud(): void {
    if (this.eventKind === 'tower') {
      this.game.events.emit('event-hud', { active: true, label: '塔 HP', ratio: this.tower ? this.tower.hpRatio() : 0, remainMs: Math.max(0, this.towerEndsAt - this.time.now) });
    } else if (this.eventKind === 'guard') {
      // ★純時間制:HUD 顯示【守護目標 + 剩餘倒數(UIScene 依 remainMs 補「Xs」後綴)】,不再顯示「第X/4波」(波次已循環)。
      this.game.events.emit('event-hud', { active: true, label: '守護目標', ratio: this.guardNpc ? this.guardNpc.hpRatio() : 0, remainMs: Math.max(0, this.guardEndsAt - this.time.now) });
    } else if (this.eventKind === 'capture') {
      this.game.events.emit('event-hud', { active: true, label: '佔領', ratio: this.captureProgress / 100, remainMs: Math.max(0, this.captureEndsAt - this.time.now) });
    } else {
      this.game.events.emit('event-hud', { active: false, label: '', ratio: 0, remainMs: 0 });
    }
  }

  /** v33 每幀事件更新（waveState==='event' 時由 update 呼叫） */
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
    // ★限時到仍未打掉塔 → 失敗(比照其他事件結束):completeEvent(false) 撤塔/清扇形/停出怪/不給獎勵→進下一波。
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
    // v44：每 cycleMs 發一組「4 大扇形」，正十字組(0/90/180/270)↔斜十字組(45/135/225/315)交替
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
   * v44：塔的單個大扇形——以塔為圓心、中心角 centerAng、張角 arc、半徑 radius。
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
    // v45(2)(4)：登記此預警特效（供時停暫停 + 塔死亡強制清除）
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
        if (this.gameOver || !this.tower || !this.tower.active) return; // v45(4)：塔已死 → 不發射
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
            // v45(5)：塔扇形命中 → 扣血 + 定身 2 秒
            this.damageCharacterFrom(c, dmg, ox, oy, GameConfig.event.tower.fanBlast.rootMs);
          }
        }
      }
    });
  }

  /** v45：從登記表移除一筆（不 destroy graphics，呼叫端自理） */
  private removeTelegraphFx(fx: { gfx: Phaser.GameObjects.Graphics }): void {
    const i = this.telegraphFx.findIndex((e) => e === fx);
    if (i >= 0) this.telegraphFx.splice(i, 1);
  }

  /**
   * v45(4)：owner(塔/BOSS)死亡 → 強制清除其所有【蓄力中未發射】的預警特效 + 取消發射。
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
    // v62:守護NPC高亮環——被怪群包圍也一眼可辨(NPC depth11在怪之上、環depth10、脈動閃爍)
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

    // ★守護【混合制+循環】:「清空 OR 8秒」較早者出下一波;4波循環重複;每波數量線性遞增(C點)。
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
        const dead = npc.takeDamage(Math.max(1, Math.round(cfg.npcContactDamage * this.curEnemyDamageScale())));
        this.flashEnemy(npc);
        if (dead) { npc.kill(); this.guardNpc = null; this.completeEvent(false); return; }
      }
    }
    // ★純時間制:撐滿 durationMs(60s)→ 守護成功。
    if (time >= this.guardEndsAt) {
      this.completeEvent(true);
    }
  }

  /** ★守護波:場上活躍的守護波怪數(排除 NPC/tower/anchor/treasure/BOSS);==0=清空可出下一波。 */
  private countGuardWaveAlive(): number {
    let n = 0;
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      if (e.enemyType === 'tower' || e.enemyType === 'npc' || e.enemyType === 'treasure' || e.isAnchorLike() || e.isBoss) continue;
      n++;
    }
    return n;
  }

  /**
   * ★守護波腳本:在【左右兩側】各生該波指定怪種(perSide 隻),y 在場內均分散開。守護波怪免疫 leash(一直衝 NPC)。
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
    
    // ★改進的守護怪物遞增：每循環一輪(4波)後才+1/側，根據人數調整
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

    // v41：一波一波出——【圈內存活怪==0】就出下一波（不管殺死或被推/擊退出圈外，圈外的不算）
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
    // v39：圈內【無怪】且【玩家在圈內】→ 進度增加；有怪則停住
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
    // v40(1)：時限到、進度未滿 → 失敗（過關無獎勵，比照守護失敗）
    if (time >= this.captureEndsAt) {
      this.completeEvent(false);
    }
  }

  /** v33 事件完成/失敗：清理 + (成功給獎勵) + 過關進下一波 */
  private completeEvent(success: boolean): void {
    const kind = this.eventKind;
    this.eventKind = null;
    // 清理事件物件
    if (this.tower) { if (this.tower.active) this.tower.kill(); this.tower = null; }
    if (this.guardNpc) { if (this.guardNpc.active) this.guardNpc.kill(); this.guardNpc = null; }
    if (this.guardHighlight) { this.guardHighlight.destroy(); this.guardHighlight = null; } // v62:清高亮環
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
      for (let i = 0; i < rw.expKills; i++) this.grantKillExp('normal');
      this.showEventBanner(`${kind === 'tower' ? '塔' : kind === 'guard' ? '守護' : '佔領'} 成功！獎勵發放`);
    } else {
      this.showEventBanner('事件失敗…');
    }
    // ★關卡制:A/B 子區事件完成/時間到→接 onSubZoneComplete(A→出左右箭頭選邊、B→出上下出口);否則舊無限波次進 intermission。
    if (this.levelMode) {
      // ★新增:事件結束時若【場上還有殘留一般怪】→不立刻收尾,留著給玩家打完(進 clearingResidual),
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

  /** ★事件後殘留怪清完的收尾(由 onWaveKill 在 pendingEventComplete 時偵測 countResidualEnemies=0 呼叫)。 */
  private finishPendingEventIfCleared(): void {
    if (!this.pendingEventComplete) return;
    if (this.countResidualEnemies() > 0) return; // 還有殘留怪→繼續給玩家打
    this.pendingEventComplete = false;
    this.onSubZoneComplete(); // 殘留清完→真正進下一步(選邊/轉場)
  }

  private clearWaveByCheat(): void {
    if (this.gameOver) return;
    // v33：事件進行中 → 直接完成事件（清理由 completeEvent 處理）
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
    // 清除場上所有存活敵人（直接移除，不計殺、不給經驗、不掉落）——★不含 treasure(波次清場不清寶箱怪)
    for (const child of this.enemies.getChildren()) {
      const e = child as Enemy;
      if (e.active && !e.dead && e.enemyType !== 'treasure') {
        this.spawnDeathBurst(e.x, e.y);
        e.kill();
      }
    }
    // 若有 BOSS，一併清掉並收尾
    if (this.boss) {
      this.boss = null;
      this.clearBossAnchors(); // v36
      this.game.events.emit('boss-hp', { active: false, ratio: 0 });
    }
    // 強制完成當前波次
    if (this.waveState !== 'intermission') {
      // ★關卡制:N 也要走【正常子區完成判定】(累計 subWavesDone→達 target 出箭頭/出口),不可繞過 onWaveKill。
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
   * v35(10) M 鍵：清掉場上小怪，並「走正常過關判定」觸發當前波該有的事件/BOSS。
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
    // 清掉場上小怪（不含 tower/npc；★不含 treasure 寶箱怪——波次完成不清寶箱怪,同真實遊玩)
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

  /** v27：過關提示（Wave N Clear / 下一波） */
  private showWaveClear(): void {
    // ★⑤ 同子區還有下一波→顯示簡潔「NEXT WAVE」。★固定畫面(setScrollFactor 0)不隨鏡頭跟隨捲動位移。
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
    this.waveFormations++; // ★本波隊形計數(第1次=首次生怪,寶箱不出;第2次起才可能 roll)
    // ★階段2b 分配制:每次補生決定生【近身組(綁旁邊玩家、近戰環形)】或【場上組(散佈、含遠程)】,
    //   讓本波比例收斂到 nearShare。目前近身占比 < nearShare → 生近身;否則生場上。
    const alloc = GameConfig.spawnAlloc;
    const totalSoFar = this.nearSpawned + this.fieldSpawned;
    const nearRatio = totalSoFar > 0 ? this.nearSpawned / totalSoFar : 0;
    const wantNear = nearRatio < alloc.nearShare;
    if (wantNear) this.spawnNearBatch(time);
    else this.spawnFieldBatch(time);
    this.trySpawnTreasure(time); // ★每次波次生怪→roll 寶箱怪(場上只1隻)
  }

  /**
   * ★階段2b 近身組:在【輪派的存活玩家】身旁 nearRingRadius 環形生 nearPerPlayer(3~5)隻【近戰為主】,
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
   * ★階段2b/3 場上組:在【離所有玩家 fieldMinDistFromPlayer 遠】的點散佈一叢、【含遠程】(全池),綁就近角色。
   * ★階段3:出生點加大離玩家距離→場上組生更遠、待命(配合縮小的 alertRadius),不一出生就在旁。
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

  /** ★階段3:找一個離【所有存活玩家】至少 minDist 的隨機場內點(場上組遠處出生用);找不到退回最遠嘗試點。 */
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

  /** ★寶箱怪:每次波次生怪時 roll 機率出現;場上已有一隻則不再生。生在場內隨機點、避開角色。 */
  private trySpawnTreasure(time: number): void {
    // ★② 限時事件(塔/守護/佔領)期間【不生寶箱怪】
    if (this.eventKind !== null || this.waveState === 'event') return;
    if (this.treasureEnemy && this.treasureEnemy.active && !this.treasureEnemy.dead) return; // 只1隻
    // ★④ 不在波次【首次生怪】那刻出現。修:用【本波隊形次數】為主判準——
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
    this.showTreasureBanner(); // ★寶箱怪出現→顯示提示橫幅(玩家注意去追打)
    // ★③ 金光加強:發光 halo 圈(depth 稍低於怪)+ 金色粒子環繞(醒目吸睛)
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

  /** ★寶箱怪每幀:金光閃爍 + 跑點移動(快速衝到隨機點→停頓→再衝) + 限時10秒未打死→跑走消失。 */
  private updateTreasure(time: number): void {
    const t = this.treasureEnemy;
    if (!t || !t.active || t.dead) { this.treasureEnemy = null; this.clearTreasureFx(); return; }
    const cfg = GameConfig.enemy.treasure;
    const body = t.body as Phaser.Physics.Arcade.Body;
    // ★③ 金光 halo:脈動發光圈跟著寶箱怪(醒目)
    if (this.treasureGlow) {
      const g = this.treasureGlow;
      g.clear();
      const rp = 26 + 8 * Math.abs(Math.sin(time / 220));
      g.fillStyle(0xffd23f, 0.12); g.fillCircle(t.x, t.y, rp + 14);
      g.fillStyle(0xffe86a, 0.18); g.fillCircle(t.x, t.y, rp);
      g.lineStyle(3, 0xffe86a, 0.5 + 0.3 * Math.abs(Math.sin(time / 220))); g.strokeCircle(t.x, t.y, rp + 6);
    }
    // ★④ 時間暫停中:寶箱怪也凍結(停速度、不跑跑點/限時邏輯)——與其他怪一致。時間戳在解除時整批後移(見 update)。
    if (this.timeStopped) { body.setVelocity(0, 0); return; }
    // 金光閃爍(每幀微調 tint 亮度,醒目)
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time / 140));
    t.setTint(Phaser.Display.Color.GetColor(255, Math.round(210 * pulse) + 45, Math.round(63 * pulse)));

    // telegraph 中(出場提示)不動、不計限時起點由 treasureSpawnAt(spawn 時設)
    if (t.telegraphing) { body.setVelocity(0, 0); return; }

    // ★限時:出現滿 lifetimeMs 未打死→跑走(淡出移除)
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

    // ★跑點移動:停頓中→靜止;停頓結束→挑新隨機點快速衝過去;到點→進入停頓。
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

  /** ★命中寶箱怪:計 1 下 + 噴少量金幣;達 hitsToKill 死亡→噴大量金幣。回傳 true=已處理(呼叫端不走一般扣血)。 */
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
      this.clearTreasureFx(); // ★③ 死亡清金光特效
      this.spawnCoins(dx, dy, cfg.coinsOnDeath, true); // 死亡大量金幣(華麗)
      this.spawnExpandingRing(dx, dy, 100, 0xffd700, 450);
      this.shakeOnce(120, 0.006);
    }
    return true;
  }

  /** ★金幣噴散特效(純視覺,不進道具/分數):金幣往上飛+散開+落下淡出。big=死亡大量。 */
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
   * ★階段2b:生成一隻怪。pool=限定敵種池(undefined=全池,pickEnemyType 預設);
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
    enemy.spawn(cx, cy, time, type, this.curEnemyHpScale());
    // ★黏著目標(階段1):BOSS 綁 P1(seat0);近身組綁指定 seat;其餘生成點就近綁。之後黏著不亂換。
    enemy.targetSeat = enemy.isBoss ? 0 : (assignSeat >= 0 ? assignSeat : this.nearestSeat(cx, cy));
    enemy.stickyOutOfRangeSince = 0;
    // ★leash 拴繩:場上組(assignSeat<0)套 config fieldLeashRadius;近身組(assignSeat>=0)用大值≈不套用(貼玩家);BOSS/塔不追不套用。
    enemy.leashRadius = (enemy.isBoss || type === 'tower')
      ? Infinity
      : (assignSeat >= 0 ? GameConfig.spawnAlloc.nearLeashRadius : GameConfig.spawnAlloc.fieldLeashRadius);
    // ★leash 第二條(累積路程):同上分派——場上組=config、近身組=大值、BOSS/塔=Infinity。
    enemy.leashTravelDist = (enemy.isBoss || type === 'tower')
      ? Infinity
      : (assignSeat >= 0 ? GameConfig.spawnAlloc.nearLeashTravelDist : GameConfig.spawnAlloc.fieldLeashTravelDist);
    // v27：計入本波已生成數
    this.waveSpawned++;
  }

  /**
   * ★階段2a:每隻怪生成前的封頂檢查(precise per-enemy,formation 大小不影響)。
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

  /** 依各類型 spawnWeight 權重隨機選一種敵人（v27：只在 currentWave 已解鎖的類型間抽選） */
  /**
   * 依 spawnWeight 權重隨機選一種敵人(只在 currentWave 已解鎖的類型間抽選)。
   * ★階段2b:restrictPool 限定敵種池(如近身組近戰池)→在【解鎖∩限定池∩有權重】中抽;交集空→退回全解鎖池。
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
    // ★仇恨警戒上限(point4):先統計每個角色 seat 目前被幾隻【被動】怪盯上(chase 中),
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
      // ★用【累加配額】avoid 同幀多隻 patrol 一起湧入超過上限:currentChasers 起算,每放行一隻 +1;
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

      // v13：時間暫停中，敵人凍結（停速度、不跑 AI）;★階段2:事件聚焦定格(eventFocusPause)也凍敵。
      if (this.timeStopped || this.eventFocusPause) {
        (enemy.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      } else {
        // ★黏著目標(階段1):追【綁定目標】(生成時綁最近、黏著不亂換),事件覆寫>黏著>就近重綁。
        //   取代舊「每幀 findNearestCharacter 選最近」→ 別的角色走過去不會把已綁的怪吸走(解問題③)。
        const target: Character | { x: number; y: number } | null = this.resolveEnemyTarget(enemy, time);
        const tx = target ? target.x : enemy.x;
        const ty = target ? target.y : enemy.y;
        enemy.updateAI(tx, ty, time);

        // v18：近戰蓄力「由內而外填滿」讀條式預警——填滿(進度1)瞬間發動攻擊
        if (enemy.isCharging()) {
          const R = GameConfig.enemy.attackRadius;
          const p = enemy.chargeProgress(time);
          // 外框（攻擊範圍輪廓）
          this.chargeWarnGfx.lineStyle(2, 0xff3344, 0.85);
          this.chargeWarnGfx.strokeCircle(enemy.x, enemy.y, R);
          // 由內而外填滿的實心圈（半徑 = R×進度）
          this.chargeWarnGfx.fillStyle(0xff3344, 0.35);
          this.chargeWarnGfx.fillCircle(enemy.x, enemy.y, R * p);
        }
        // 衝鋒怪蓄力預警
        if (enemy.isChargerCharging() && target) {
          const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
          const len = 220;
          this.chargeWarnGfx.lineStyle(3, 0xffaa00, 0.8);
          this.chargeWarnGfx.lineBetween(
            enemy.x,
            enemy.y,
            enemy.x + Math.cos(angle) * len,
            enemy.y + Math.sin(angle) * len
          );
        }
        // v25 遠程兵雷射蓄力預警：以怪為起點朝鎖定方向，從怪端往盡頭「填滿」
        if (enemy.isChargingLaser()) {
          const cfg = GameConfig.enemy.shooter;
          const a = enemy.getLaserAngle();
          const p = enemy.laserChargeProgress(time);
          const ex = enemy.x + Math.cos(a) * cfg.laserLength;
          const ey = enemy.y + Math.sin(a) * cfg.laserLength;
          // 全長細虛線（預示方向與盡頭）
          this.chargeWarnGfx.lineStyle(2, 0x66ff88, 0.4);
          this.chargeWarnGfx.lineBetween(enemy.x, enemy.y, ex, ey);
          // 由怪端往盡頭填滿的較粗實線（長度 = laserLength×進度）
          const fx = enemy.x + Math.cos(a) * cfg.laserLength * p;
          const fy = enemy.y + Math.sin(a) * cfg.laserLength * p;
          this.chargeWarnGfx.lineStyle(6, 0x33ff66, 0.85);
          this.chargeWarnGfx.lineBetween(enemy.x, enemy.y, fx, fy);
        }
        // v26 投射兵蓄力預警：畫「怪→鎖定落點」的線 + 落點圈（進度環）
        if (enemy.isChargingBomb()) {
          const cfg = GameConfig.enemy.bomber;
          const tgt = enemy.getBombTarget();
          const p = enemy.bombChargeProgress(time);
          this.chargeWarnGfx.lineStyle(2, 0xd08bff, 0.5);
          this.chargeWarnGfx.lineBetween(enemy.x, enemy.y, tgt.x, tgt.y);
          // 落點外框 + 由內而外填滿（讀條）
          this.chargeWarnGfx.lineStyle(2, 0xff6a3a, 0.8);
          this.chargeWarnGfx.strokeCircle(tgt.x, tgt.y, cfg.bombRadius);
          this.chargeWarnGfx.fillStyle(0xff6a3a, 0.22);
          this.chargeWarnGfx.fillCircle(tgt.x, tgt.y, cfg.bombRadius * p);
        }
      }

      // v13：邊界反彈——敵人被擊飛超出場地時 clamp 回內側並反向該軸速度
      this.bounceEnemyOffBounds(enemy);
      // v60：怪也被木箱擋(手動位置校正分離、防卡死)。只擋可推動一般怪(排除 boss/tower/anchor/npc)。
      //   時停中不套用(怪凍結)。只推出重疊、不改 AI 目標→怪仍朝玩家走、被木箱擋時自然沿邊繞、不卡死。
      if (!this.timeStopped) this.blockEnemyFromBreakables(enemy);
      // ★塔/BOSS 實體碰撞:一般怪不可穿過塔/BOSS 本體(硬推出外緣,補分離的鬆弛不足;衝鋒怪也擋)。
      if (!this.timeStopped) this.blockEnemyFromStructures(enemy);
    }

    // ★敵人↔敵人碰撞分離(異靈藍圖):時停/事件聚焦定格中不跑(怪凍結)。
    if (GameConfig.enemySeparation.enabled && !this.timeStopped && !this.eventFocusPause) {
      const separators: Enemy[] = [];
      for (const child of children) {
        const e = child as Enemy;
        if (this.enemySeparates(e)) separators.push(e);
      }
      // ① 軟分離 steering(主力):改可動怪的移動方向(合成追擊+分離)。
      for (const e of separators) this.applyEnemySeparationSteering(e, separators);
      // ② 硬 de-overlap(補刀):推開殘留重疊,迭代收斂。
      this.resolveEnemyOverlap(separators);
    }

    // v28：BOSS 血條更新（若存活）
    if (this.boss) {
      if (this.boss.active && !this.boss.dead) {
        this.game.events.emit('boss-hp', { active: true, ratio: this.boss.hpRatio() });
      }
    }
  }

  /** v13 邊界反彈：敵人位置超出 arena 時夾回內側，並反向撞牆軸的速度 */
  private bounceEnemyOffBounds(enemy: Enemy): void {
    const r = enemy.getBodyRadius();
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    const rest = GameConfig.arena.bounceRestitution;
    const left = this.arena.left + r;
    const right = this.arena.right - r;
    const top = this.arena.top + r;
    const bottom = this.arena.bottom - r;
    if (enemy.x < left) {
      enemy.x = left;
      if (body.velocity.x < 0) body.velocity.x = -body.velocity.x * rest;
    } else if (enemy.x > right) {
      enemy.x = right;
      if (body.velocity.x > 0) body.velocity.x = -body.velocity.x * rest;
    }
    if (enemy.y < top) {
      enemy.y = top;
      if (body.velocity.y < 0) body.velocity.y = -body.velocity.y * rest;
    } else if (enemy.y > bottom) {
      enemy.y = bottom;
      if (body.velocity.y > 0) body.velocity.y = -body.velocity.y * rest;
    }
  }

  // ===========================================================================
  // ★敵人↔敵人碰撞分離（異靈藍圖 8df9c4fd）：軟分離 steering(主力) + 硬 de-overlap(補刀)
  // ===========================================================================
  /**
   * immovable(像牆,只推別人自己不動)：BOSS / 塔 / 錨點 / 守護NPC / 寶箱怪(跑點) / 蓄力站定中的怪。
   * 蓄力中的怪站定詠唱→被推走會亂掉演出,故當牆。
   */
  private enemyIsImmovable(e: Enemy): boolean {
    if (e.isBoss || e.enemyType === 'tower' || e.isAnchorLike() || e.enemyType === 'npc' || e.enemyType === 'treasure') return true;
    // 蓄力/詠唱中站定像牆(近戰蓄力/衝鋒蓄力/雷射蓄力/投射蓄力)
    if (e.isCharging() || e.isChargerCharging() || e.isChargingLaser() || e.isChargingBomb()) return true;
    return false;
  }

  /** 參與分離的怪(可推動、活著、非 telegraph/錨點) */
  private enemySeparates(e: Enemy): boolean {
    return e.active && !e.dead && !e.telegraphing && e.enemyType !== 'anchor';
  }

  /**
   * ① 軟分離 steering(主力)：對 radiusPx 內每鄰居算遠離向量(平方加權 w=t*t,越近推力越大),
   * 再 combineWithSeparation(把怪【當前移動方向】先正規化 + 分離向量×weight 合成)→改敵移動【方向】,保速度大小。
   * ★toTarget(=當前速度方向)先正規化再加分離,否則遠距追擊速度淹沒分離力→還是疊團(藍圖最關鍵踩雷)。
   * 對 immovable 怪不改向(自己不動);對速度≈0(站定)的怪不改向(方向由硬解處理)。
   */
  private applyEnemySeparationSteering(enemy: Enemy, neighbors: Enemy[]): void {
    if (this.enemyIsImmovable(enemy)) return;
    const body = enemy.body as Phaser.Physics.Arcade.Body;
    const spd = Math.hypot(body.velocity.x, body.velocity.y);
    if (spd < 1) return; // 站定的怪不 steering(交給硬解),避免原地抖
    const cfg = GameConfig.enemySeparation;
    const R = cfg.radiusPx;
    let sx = 0, sy = 0;
    for (const other of neighbors) {
      if (other === enemy) continue;
      const dx = enemy.x - other.x, dy = enemy.y - other.y; // 自己←鄰居 = 遠離方向
      const dist = Math.hypot(dx, dy);
      if (dist >= R) continue;
      let nx: number, ny: number;
      if (dist > 0.001) { nx = dx / dist; ny = dy / dist; }
      else { nx = 1; ny = 0; } // 完全重疊→預設方向(硬解會用 index 定向)
      const t = (R - dist) / R;      // 0(邊緣)~1(貼身)
      const w = t * t;               // ★平方加權:越近推力越大
      sx += nx * w; sy += ny * w;
    }
    if (sx === 0 && sy === 0) return; // 無鄰居影響
    // combineWithSeparation:toTarget(當前速度方向)先正規化 + 分離×weight → 合成新方向
    const tdx = body.velocity.x / spd, tdy = body.velocity.y / spd;
    let fx = tdx + sx * cfg.weight, fy = tdy + sy * cfg.weight;
    const fl = Math.hypot(fx, fy);
    if (fl < 0.001) return;
    fx /= fl; fy /= fl;
    body.velocity.x = fx * spd; body.velocity.y = fy * spd; // 保原速度大小,只改方向
  }

  /**
   * ② 硬 de-overlap(補刀)：兩兩距離 < r_i+r_j 沿連線推開重疊量,迭代收斂。
   * - 完全重疊(dist≈0)用 index 定向(i 左推、j 右推)避免 NaN 爆衝。
   * - 一方 immovable(像牆)→只推另一方(全額);兩方皆可動→各推一半。
   * - 單幀每次推移夾 maxStepPx(鬆弛分多幀,玩家衝進怪群不瞬移)。位置夾在場內。
   * ★TODO(多人效能):現直白 O(n²)×iter2,solo(~35隻)可接受。多人 maxAlive 破百(416)時
   *   改【空間網格 grid】或【軟分離只取最近 K 鄰居】優化(海牛/用戶同意先 solo、多人再做)。
   */
  private resolveEnemyOverlap(agents: Enemy[]): void {
    const cfg = GameConfig.enemySeparation;
    const maxStep = cfg.maxStepPx;
    const clampX = (e: Enemy, x: number) => Phaser.Math.Clamp(x, this.arena.left + e.getBodyRadius(), this.arena.right - e.getBodyRadius());
    const clampY = (e: Enemy, y: number) => Phaser.Math.Clamp(y, this.arena.top + e.getBodyRadius(), this.arena.bottom - e.getBodyRadius());
    for (let iter = 0; iter < cfg.iterations; iter++) {
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.active || a.dead) continue;
        const ar = a.getBodyRadius();
        const aImm = this.enemyIsImmovable(a);
        for (let j = i + 1; j < agents.length; j++) {
          const b = agents[j];
          if (!b.active || b.dead) continue;
          const br = b.getBodyRadius();
          const minDist = ar + br;
          let dx = b.x - a.x, dy = b.y - a.y; // a→b
          let dist = Math.hypot(dx, dy);
          if (dist >= minDist) continue;
          let nx: number, ny: number;
          if (dist > 0.001) { nx = dx / dist; ny = dy / dist; }
          else { nx = 1; ny = 0; dist = 0; } // 完全重疊:index 定向(i 左 a←、j 右 b→)避免 NaN
          let overlap = minDist - dist;
          if (overlap > maxStep) overlap = maxStep; // 單幀鬆弛,分多幀收斂
          const bImm = this.enemyIsImmovable(b);
          if (aImm && bImm) continue; // 兩牆不互推
          if (aImm) {
            // a 不動→b 全額往外(+n)
            b.setPosition(clampX(b, b.x + nx * overlap), clampY(b, b.y + ny * overlap));
          } else if (bImm) {
            // b 不動→a 全額往內(-n)
            a.setPosition(clampX(a, a.x - nx * overlap), clampY(a, a.y - ny * overlap));
          } else {
            // 兩方可動→各推一半
            const half = overlap * 0.5;
            a.setPosition(clampX(a, a.x - nx * half), clampY(a, a.y - ny * half));
            b.setPosition(clampX(b, b.x + nx * half), clampY(b, b.y + ny * half));
          }
        }
      }
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
      // v14：敵人傷害隨等級成長（Lv1 較低 → Lv10 = 現值）
      const dmg = Math.max(1, Math.round(GameConfig.enemy.attackDamage * this.curEnemyDamageScale()));
      const applied = c.takeDamage(dmg, time);
      if (applied) {
        this.flashHurt(c);
        // v7：受擊不再震動（只有爆發震動）
        if (c.hp <= 0) this.killCharacter(c);
      }
    }
  };

  private killCharacter(c: Character): void {
    c.die();
    // v16：GameOver 僅在「全員陣亡且場上不只 P1（有 BOT 一起團滅）」時觸發。
    // 只有 P1 時，P1 陣亡不進結算——留原地可用 R 隨時滿血復活、或 T 重開，避免卡死。
    if (this.aliveCount() === 0 && this.characters.length > 1) {
      this.triggerGameOver();
    }
  }

  /** v16：R 熱鍵——原地滿血復活 P1（無限次），恢復可操控與正常戰鬥 */
  private revivePlayer(): void {
    if (this.gameOver) return;
    if (this.player.alive) return;
    this.player.revive();
    // v25 第8項：R 復活 → P1 命中計數歸零
    this.p1AttackHits = 0;
    this.player.setPosition(
      Phaser.Math.Clamp(this.player.x, this.arena.left + GameConfig.player.radius, this.arena.right - GameConfig.player.radius),
      Phaser.Math.Clamp(this.player.y, this.arena.top + GameConfig.player.radius, this.arena.bottom - GameConfig.player.radius)
    );
    this.emitStats();
  }

  /** v16：T 熱鍵——遊戲進行中直接乾淨重開一局（沿用 create 的 resetState/scene 重啟機制） */
  private restartRun(): void {
    // 清殘留 tween/timer，避免重啟後回呼觸及已銷毀物件（沿用 GameOver 的乾淨重啟做法）
    this.tweens.killAll();
    this.time.removeAllEvents();
    this.scene.stop('UIScene');
    this.scene.start('GameScene', { controlMode: this.controlMode }); // v46：重開保留當前操作模式
    this.scene.launch('UIScene');
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

  /** v25 遠程兵雷射填滿發射：以怪為起點朝鎖定方向的直線 AOE，命中存活角色扣血 + 短暫雷射演出 */
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
      if (this.pointInOrientedRect(c.x, c.y, ox, oy, angle, 0, cfg.laserLength, cfg.laserWidth)) {
        this.damageCharacterFrom(c, cfg.laserDamage, ox, oy);
      }
    }
    // ★守護事件:雷射也對 guardNpc 判傷(per-enemy 冷卻,同近戰路徑)
    if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active && !this.guardNpc.dead) {
      if (this.pointInOrientedRect(this.guardNpc.x, this.guardNpc.y, ox, oy, angle, 0, cfg.laserLength, cfg.laserWidth)) {
        if (now >= enemy.nextNpcHitAt) {
          enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
          const gcfg = GameConfig.event.guard;
          const dead = this.guardNpc.takeDamage(Math.max(1, Math.round(gcfg.npcContactDamage * this.curEnemyDamageScale())));
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

  /** v26 投射兵投彈：炸彈飛向鎖定落點(tx,ty)，落點顯示預警圈，到點爆炸對半徑內存活角色扣血 */
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
        // ★守護事件:炸彈爆炸也對 guardNpc 判傷(per-enemy 冷卻,同近戰路徑)
        if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active && !this.guardNpc.dead) {
          if (Phaser.Math.Distance.Between(this.guardNpc.x, this.guardNpc.y, tx, ty) <= cfg.bombRadius) {
            if (now >= enemy.nextNpcHitAt) {
              enemy.nextNpcHitAt = now + GameConfig.event.guard.npcAttackCooldownMs;
              const gcfg = GameConfig.event.guard;
              const dead = this.guardNpc.takeDamage(Math.max(1, Math.round(gcfg.npcContactDamage * this.curEnemyDamageScale())));
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
      // v13：時間暫停中，子彈也凍結（停速度、不計逾時）
      if (this.timeStopped) {
        (bullet.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
        continue;
      }
      bullet.tick(time, this.arena);
      // ★守護事件:子彈命中 guardNpc 判傷(NPC 全域冷卻 bulletNpcHitAt;子彈命中後回收)
      if (this.waveState === 'event' && this.eventKind === 'guard' && this.guardNpc && this.guardNpc.active && !this.guardNpc.dead && bullet.active) {
        const hitR = GameConfig.enemy.shooter.bulletRadius + this.guardNpc.getBodyRadius();
        if (Phaser.Math.Distance.Between(bullet.x, bullet.y, this.guardNpc.x, this.guardNpc.y) <= hitR) {
          bullet.recycle();
          if (time >= this.guardNpc.bulletNpcHitAt) {
            const gcfg = GameConfig.event.guard;
            this.guardNpc.bulletNpcHitAt = time + gcfg.npcAttackCooldownMs;
            const dead = this.guardNpc.takeDamage(Math.max(1, Math.round(gcfg.npcContactDamage * this.curEnemyDamageScale())));
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
      Math.max(1, Math.round(GameConfig.enemy.shooter.bulletDamage * this.curEnemyDamageScale())),
      this.time.now
    );
    if (applied) {
      this.flashHurt(c);
      if (c.hp <= 0) this.killCharacter(c);
    }
  };

  /** v25：直線雷射等來源對角色扣血（含 enemyDamageScale），從 (fromX,fromY) 方向做受傷回饋。
   *  v45(5)：rootMs>0 時，命中後定身該角色 rootMs 毫秒（禁移動+禁攻擊；塔扇形/BOSS招用 2000）。 */
  private damageCharacterFrom(c: Character, amount: number, _fromX: number, _fromY: number, rootMs = 0): void {
    if (!c.alive) return;
    const applied = c.takeDamage(
      Math.max(1, Math.round(amount * this.curEnemyDamageScale())),
      this.time.now
    );
    if (applied) {
      this.flashHurt(c);
      // v45(5)：塔扇形/BOSS 招命中 → 定身 2 秒（取現有與新值較大者，避免縮短既有定身）
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
            Math.max(1, Math.round(GameConfig.enemy.charger.dashDamage * this.curEnemyDamageScale())),
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
    if (!this.itemsEnabled) return; // ★道具總開關(config 初值 + I 鍵 toggle):關閉→任何來源都不生成道具(殺怪掉落/寶箱獎勵/定時)
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
  // v57 可打破物件（瓶罐/箱子）
  // ---------------------------------------------------------------------------
  /** v57/v59：每波開始成堆灑可打破物件——幾堆、每堆幾個聚在一起，堆遠離場地中心、避開玩家/彼此。 */
  private spawnBreakablesForWave(): void {
    // ★關卡制:可破壞物件改【進入子區時靜態布置】(placeStaticBreakables),不隨波次重生。
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
      // 堆內幾個木箱：v60 排成【不互疊】的一叢——用小陣列/環狀排開，彼此間距≥木箱直徑。
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
    // v61：每波再灑少量【爆炸桶】(比照木箱位置規則：遠離中心/避玩家/不與現有物件互疊)。
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
        // 不與任何現有物件(木箱/桶)互疊；v62：與【其他爆炸桶】拉大間距 minBarrelSpacing(≥explodeR×1.5→一個爆碰不到另一個)
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
  /** v59/v60：招式 AOE(道具招/連段招)【直接秒碎】範圍內圓形的可打破物件(不管剩餘 hp)；
   *  v60 掉落上限：一次呼叫最多 maxDropPerBreak 個掉道具，其餘只碎不掉(避免一招炸一堆洗版)。 */
  private breakBreakablesInCircle(x: number, y: number, radius: number, _amount: number, time: number): void {
    let drops = 0;
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (Phaser.Math.Distance.Between(x, y, bk.x, bk.y) <= radius + bk.getBodyRadius()) {
        if (bk.fusing) continue; // v62修:已在fuse倒數的爆炸桶跳過(它本來就會爆),不再設dead→避免殭屍
        bk.dead = true; // 秒碎
        const allowDrop = drops < GameConfig.breakable.maxDropPerBreak;
        this.breakBreakable(bk, time, allowDrop);
        if (allowDrop) drops++;
      }
    }
  }

  /** v59/v60：招式 AOE 對【朝 dir 的定向矩形】內可打破物件【直接秒碎】+ 掉落上限。 */
  private breakBreakablesInRect(ox: number, oy: number, dir: number, back: number, length: number, width: number, _amount: number, time: number): void {
    let drops = 0;
    for (const child of this.breakables.getChildren()) {
      const bk = child as Breakable;
      if (!bk.active || bk.dead) continue;
      if (this.pointInOrientedRect(bk.x, bk.y, ox, oy, dir, back, length, width)) {
        if (bk.fusing) continue; // v62修:已在fuse倒數的爆炸桶跳過,不再設dead→避免殭屍
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

  /** 打破一個物件：v61/v62 爆炸桶→進入 fuse 倒數(延遲爆)；木箱→碎裂特效 + (allowDrop 時)掉道具 + 回收。 */
  private breakBreakable(bk: Breakable, time: number, allowDrop = true): void {
    if (bk.explosive) { this.startBarrelFuse(bk, allowDrop); return; }
    const bx = bk.x, by = bk.y;
    // 碎裂特效：小粒子爆開
    this.spawnBreakParticles(bx, by);
    bk.despawn();
    // 有機率掉道具(共用怪物掉率 dropChance、同 pickDropSkill 加權)；v60：allowDrop=false 時不掉(招式炸多箱的掉落上限)
    if (allowDrop && Math.random() < GameConfig.items.dropChance) this.dropItemAt(bx, by, time);
  }

  /**
   * v62 爆炸桶打破→進入 fuse 倒數(延遲爆,像蓄力)：桶標記 fusing(不再被打)、閃紅抖動、地面出現【警示範圍圈】
   * (半徑=explodeRadius，由內而外填滿+閃爍，跟隨桶移動——fuse 期間桶仍可被推)，倒數 fuseMs 完→explodeBarrel。
   * 怪/玩家看到警示圈有時間跑出範圍閃避。
   */
  private startBarrelFuse(bk: Breakable, allowDrop: boolean): void {
    if (bk.fusing) { bk.dead = false; return; } // v62修:已在fuse中→還原任何被呼叫端剛設的dead(避免AOE秒碎設dead後在此早退→殭屍),不重啟fuse
    const bcfg = GameConfig.breakable.barrel;
    // v62 修：hit()/AOE 打破時已把 bk.dead 設 true(代表「被打破」)，但爆炸桶被打破=進入 fuse 倒數(還活著、將爆)，
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
        // 桶身閃紅(將爆)：紅↔正常貼圖交替；★不用 setTintFill(0xffffff)(會變純白塊,爆炸/清除時序若殘留=白塊bug)
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
   * v61 引爆爆炸桶：範圍 AOE 爆炸——閃白+強震+火光特效；範圍內【怪】低傷+朝外擊退(炸飛)；
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
      const bigImmovable = e.isBoss || e.enemyType === 'tower' || e.isAnchorLike() || e.enemyType === 'npc';
      if (!bigImmovable) {
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

  /** v14：加權隨機挑掉落招式（T 時停權重明顯低於其他 4 種）。v57：慢速排除補血 H(慢速無血量、H 無意義)。 */
  private pickDropSkill(): SkillType {
    const w = GameConfig.items.weights;
    // v57：★只慢速排除 H(補血)——慢速已拔血量；快速維持有 H。
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
    if (c.timestopping) return; // v59：時停穿梭的瞬移位移不吃道具(經過道具不觸發拾取)
    // v15：互搶——同一幀可能有多個角色碰到同一道具，先登記候選，
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

  /** v15：結算本幀所有道具互搶——每個道具只給「最近的角色」，原子拿取 + 觸發招式 */
  private resolvePickups(): void {
    if (this.pendingPickups.size === 0) return;
    const time = this.time.now;
    for (const [item, c] of this.pendingPickups) {
      if (item.taken || !item.active) continue; // 已被結算過
      if (!c.alive) continue;
      const skill = item.skill;
      // v45(1)：時停(T)若【spreadRadius 內無可傷敵人】→ 不觸發、不消耗道具（留在場上），避免對空氣空放大招。
      if (skill === 'T' && !this.hasTimestopTarget(c)) {
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
      // v21：補血道具(H) → 只補撿到的角色，不走招式演出；其餘照觸發招式
      if (skill === 'H') this.applyHeal(c);
      else this.triggerSkill(c, skill, time);
    }
    this.pendingPickups.clear();
  }

  /** v21：補血——只補撿到的角色固定量(不超 maxHp) + 綠光/跳字回饋 */
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
  // 一次性招式（吃道具觸發，P1 與 BOT 共用）
  // ---------------------------------------------------------------------------
  private triggerSkill(c: Character, skill: SkillType, time: number): void {
    switch (skill) {
      case 'A':
        this.skillWhirlwind(c, time);
        break;
      case 'B':
        this.skillThunder(c, time);
        break;
      case 'C':
        this.skillIaido(c, time);
        break;
      case 'E':
        this.skillShockwave(c, time);
        break;
      case 'F':
        this.skillFlame(c, time);
        break;
      case 'T':
        this.skillTimestop(c, time);
        break;
    }
  }

  /** v13：進入招式演出鎖定（期間無敵 + 玩家不可操控）。回傳演出結束時間戳。 */
  private lockSkill(c: Character, durationMs: number, time: number): number {
    c.isDashing = false;
    c.isBursting = false;
    c.stopMoving();
    c.skillLockUntil = time + durationMs;
    return c.skillLockUntil;
  }

  /** A 旋風斬：原地旋轉演出，多段捲擊 + 強力外拋。期間無敵不可控。 */
  private skillWhirlwind(c: Character, _time: number): void {
    const cfg = GameConfig.skills.whirlwind;
    // v27：放置式——不鎖角色、不原地轉；在施放座標放一個獨立地面旋風場，持續 durationMs DOT
    const radius = cfg.radius * this.curSkillRadiusScale();
    const dmg = cfg.damagePerHit * this.curSkillDamageScale();
    const ox = c.x; // 座標快照，固定不動
    const oy = c.y;

    // 旋風場視覺：兩個旋轉的旋風圈（獨立物件，自己轉，持續整個效期）
    const ring1 = this.add.circle(ox, oy, radius, 0x00e5ff, 0.08).setDepth(3);
    ring1.setStrokeStyle(3, 0x00e5ff, 0.5);
    // 旋臂（graphics 畫幾條放射線，持續自轉）
    const arms = this.add.graphics().setDepth(4);
    const drawArms = (rot: number): void => {
      arms.clear();
      arms.lineStyle(4, 0x66f0ff, 0.55);
      for (let k = 0; k < 4; k++) {
        const a = rot + (k / 4) * Math.PI * 2;
        arms.lineBetween(ox, oy, ox + Math.cos(a) * radius, oy + Math.sin(a) * radius);
      }
    };
    const spinState = { rot: 0 };
    const spinTween = this.tweens.add({
      targets: spinState,
      rot: Math.PI * 2 * (cfg.durationMs / 600), // 每 600ms 一圈
      duration: cfg.durationMs,
      ease: 'Linear',
      onUpdate: () => drawArms(spinState.rot)
    });
    // 圈的輕微脈動
    const pulse = this.tweens.add({ targets: ring1, alpha: 0.16, duration: 300, yoyo: true, repeat: -1 });
    this.spawnExpandingRing(ox, oy, radius, 0x00e5ff);

    // DOT：每 tickMs 對固定圓心 radius 內敵人造成傷害（不擊退）
    const ticks = Math.max(1, Math.floor(cfg.durationMs / cfg.tickMs));
    const dotEvent = this.time.addEvent({
      delay: cfg.tickMs,
      repeat: ticks - 1,
      callback: () => {
        if (this.gameOver) return;
        const now = this.time.now;
        for (const child of this.enemies.getChildren()) {
          const enemy = child as Enemy;
          if (!enemy.isVulnerable()) continue;
          if (Phaser.Math.Distance.Between(ox, oy, enemy.x, enemy.y) <= radius) {
            this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, ox, oy, now);
          }
        }
        this.breakBreakablesInCircle(ox, oy, radius, dmg, now); // v59：旋風場掃到木箱也打破
      }
    });

    // 效期結束清理旋風場（角色不受影響，可繼續行動/再放）
    this.time.delayedCall(cfg.durationMs, () => {
      spinTween.remove();
      pulse.remove();
      dotEvent.remove();
      arms.destroy();
      ring1.destroy();
    });
  }

  /** B 天降雷擊（v20）：在角色周圍以順時針依序打出環繞一圈的落雷。期間無敵不可控。 */
  private skillThunder(c: Character, time: number): void {
    const cfg = GameConfig.skills.thunder;
    const total = cfg.chargeMs + cfg.strikes * cfg.strikeDelayMs + 300;
    this.lockSkill(c, total, time);
    // v14：爆炸半徑/傷害隨等級成長
    const radius = cfg.radius * this.curSkillRadiusScale();
    const orbit = cfg.orbitRadius * this.curSkillRadiusScale();
    const dmg = cfg.damage * this.curSkillDamageScale();

    // 演出：蓄力（放大亮起前搖）
    this.tweens.add({ targets: c, scale: { from: 1, to: 1.3 }, duration: cfg.chargeMs, yoyo: true });
    const chargeRing = this.add.circle(c.x, c.y, 10, 0xffd700, 0.4).setDepth(20);
    this.tweens.add({ targets: chargeRing, radius: 46, alpha: 0, duration: cfg.chargeMs, onUpdate: () => chargeRing.setRadius(chargeRing.radius), onComplete: () => chargeRing.destroy() });

    // 蓄力後：以角色為圓心，順時針依序在環繞一圈的等距落點打雷
    const startAngle = -Math.PI / 2; // 從正上方開始
    this.time.delayedCall(cfg.chargeMs, () => {
      if (this.gameOver || !c.alive) return;
      for (let i = 0; i < cfg.strikes; i++) {
        // 順時針（角度遞增）
        const a = startAngle + (i / cfg.strikes) * Math.PI * 2;
        this.time.delayedCall(i * cfg.strikeDelayMs, () => {
          if (this.gameOver || !c.alive) return;
          const sx = Phaser.Math.Clamp(c.x + Math.cos(a) * orbit, this.arena.left, this.arena.right);
          const sy = Phaser.Math.Clamp(c.y + Math.sin(a) * orbit, this.arena.top, this.arena.bottom);
          this.spawnThunderStrike(sx, sy, radius);
          const now = this.time.now;
          for (const child of this.enemies.getChildren()) {
            const enemy = child as Enemy;
            if (!enemy.isVulnerable()) continue;
            if (Phaser.Math.Distance.Between(sx, sy, enemy.x, enemy.y) <= radius) {
              this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, sx, sy, now);
            }
          }
          this.breakBreakablesInCircle(sx, sy, radius, dmg, now); // v59：落雷點掃到木箱也打破
        });
      }
    });
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
  }

  /** C 居合貫穿：短暫預備 → 朝指定方向高速斬出，貫穿路徑上所有敵人。期間無敵不可控。 */
  /** C 居合貫穿（v18：衝出去再衝回起點，來回兩趟貫穿）。期間無敵不可控。 */
  /**
   * v25：居合選向——朝「有怪最多」的方向切。掃描存活敵人，
   * 對每個敵人方向當候選，計算「以該方向為中心 ±halfCone 扇形內的敵人數（近的加權高）」，選最高分方向。
   * 無敵人時退回 aimAngle。
   */
  private pickIaidoAngle(c: Character): number {
    const enemies = this.enemies
      .getChildren()
      .map((e) => e as Enemy)
      .filter((e) => e.active && e.isVulnerable());
    if (enemies.length === 0) return c.aimAngle;
    // v28：純粹瞄準「怪最多的方向」——放寬扇形至 45°、以「數量」為主，近距只給極小加權(不被單隻近怪帶走)
    const halfCone = Phaser.Math.DegToRad(45);
    let bestAngle = c.aimAngle;
    let bestScore = -1;
    for (const cand of enemies) {
      const candAngle = Phaser.Math.Angle.Between(c.x, c.y, cand.x, cand.y);
      let score = 0;
      for (const e of enemies) {
        const a = Phaser.Math.Angle.Between(c.x, c.y, e.x, e.y);
        if (Math.abs(Phaser.Math.Angle.Wrap(a - candAngle)) <= halfCone) {
          const d = Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y);
          score += 1 + 0.15 * (200 / (d + 200)); // 數量為主，近距加權大幅減弱
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestAngle = candAngle;
      }
    }
    return bestAngle;
  }

  private skillIaido(c: Character, time: number): void {
    const cfg = GameConfig.skills.iaido;
    // v25：主動挑「有怪的方向」——在多個候選方向中，選一個「前方扇形內敵人最多」的方向切
    const angle = this.pickIaidoAngle(c);
    const r = GameConfig.player.radius;
    const startX = c.x;
    const startY = c.y;
    const destX = Phaser.Math.Clamp(startX + Math.cos(angle) * cfg.distance, this.arena.left + r, this.arena.right - r);
    const destY = Phaser.Math.Clamp(startY + Math.sin(angle) * cfg.distance, this.arena.top + r, this.arena.bottom - r);
    const travel = Phaser.Math.Distance.Between(startX, startY, destX, destY);
    const legMs = Math.max(60, (travel / cfg.speed) * 1000);
    // 演出總時長：預備 + 去程 + 回程 + 收尾
    this.lockSkill(c, cfg.windupMs + legMs * 2 + 160, time);
    // v14：貫穿判定半徑/傷害隨等級成長
    const hitRadius = cfg.hitRadius * this.curSkillRadiusScale();
    const dmg = cfg.damage * this.curSkillDamageScale();

    // 一趟突進：朝 (tx,ty) 高速斬過去，沿途貫穿（各趟獨立 hitSet，同隻每趟可各中一次）
    const dashLeg = (tx: number, ty: number, faceAngle: number, onDone: () => void): void => {
      if (this.gameOver || !c.alive) return;
      c.setRotation(faceAngle);
      // v21：畫「與判定一致的寬斬擊帶」（寬 ≈ hitRadius*2），去程/回程都畫
      this.spawnSlashBand(c.x, c.y, tx, ty, hitRadius * 2, 0xff4d6d);
      const hitSet = new Set<Enemy>();
      this.tweens.add({
        targets: c,
        x: tx,
        y: ty,
        duration: legMs,
        ease: 'Linear',
        onUpdate: () => {
          const now = this.time.now;
          for (const child of this.enemies.getChildren()) {
            const enemy = child as Enemy;
            if (!enemy.isVulnerable() || hitSet.has(enemy)) continue;
            if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= hitRadius) {
              hitSet.add(enemy);
              this.damageEnemy(c, enemy, dmg, cfg.knockback, now);
            }
          }
          this.breakBreakablesInCircle(c.x, c.y, hitRadius, dmg, now); // v59：居合斬路徑掃到木箱也打破
        },
        onComplete: onDone
      });
    };

    // 演出：預備（面向）→ 去程斬出 → 回程斬回起點
    c.setRotation(angle);
    this.time.delayedCall(cfg.windupMs, () => {
      dashLeg(destX, destY, angle, () => {
        if (this.gameOver || !c.alive) {
          c.stopMoving();
          c.setRotation(0);
          return;
        }
        // 回程：面向反方向斬回起點
        dashLeg(startX, startY, angle + Math.PI, () => {
          c.stopMoving();
          c.setRotation(0);
        });
      });
    });
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
  }

  /** E 全屏震爆：角色跳起 → 往下砸 → 落地全屏衝擊波。期間無敵不可控。 */
  private skillShockwave(c: Character, time: number): void {
    const cfg = GameConfig.skills.shockwave;
    this.lockSkill(c, cfg.jumpMs + cfg.slamMs + 200, time);
    // v14：範圍/傷害隨等級成長
    const radius = cfg.radius * this.curSkillRadiusScale();
    const dmg = cfg.damage * this.curSkillDamageScale();

    const baseScale = 1;
    // 跳起（放大表現騰空）→ 落下（縮回）
    this.tweens.add({
      targets: c,
      scale: baseScale * 1.6,
      duration: cfg.jumpMs,
      ease: 'Sine.easeOut',
      yoyo: false,
      onComplete: () => {
        this.tweens.add({
          targets: c,
          scale: baseScale,
          duration: cfg.slamMs,
          ease: 'Sine.easeIn',
          onComplete: () => {
            if (this.gameOver || !c.alive) return;
            // 落地：全屏衝擊波
            this.spawnExpandingRing(c.x, c.y, radius, 0xa855f7, cfg.visualMs);
            this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
            const now = this.time.now;
            for (const child of this.enemies.getChildren()) {
              const enemy = child as Enemy;
              if (!enemy.isVulnerable()) continue;
              if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= radius) {
                this.damageEnemy(c, enemy, dmg, cfg.knockback, now);
              }
            }
            this.breakBreakablesInCircle(c.x, c.y, radius, dmg, now); // v59：震爆掃到木箱也打破
          }
        });
      }
    });
  }

  /** F 噴火（v21：長方形火道 + 長方形燒灼區）：朝隨機有敵方向噴火(當下命中矩形)，地面留燒灼矩形持續傷害。期間無敵不可控。 */
  private skillFlame(c: Character, time: number): void {
    const cfg = GameConfig.skills.flame;
    this.lockSkill(c, cfg.windupMs + cfg.sprayMs + 200, time);
    // 範圍/傷害隨等級成長
    const rs = this.curSkillRadiusScale();
    const flameLength = cfg.flameLength * rs;
    const flameWidth = cfg.flameWidth * rs;
    const burnLength = cfg.burnLength * rs;
    const burnWidth = cfg.burnWidth * rs;
    const burstDmg = cfg.burstDamage * this.curSkillDamageScale();
    const tickDmg = cfg.tickDamage * this.curSkillDamageScale();

    // v25：以自身為中心，往四個方向（十字）各噴一條火道 + 燒灼區
    const ox = c.x;
    const oy = c.y;
    const baseDir = c.aimAngle; // 以瞄準方向為基準，四方向 = base, base+90, +180, +270
    const dirs = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((d) => baseDir + d);
    c.setRotation(baseDir);

    this.time.delayedCall(cfg.windupMs, () => {
      if (this.gameOver || !c.alive) return;
      const now = this.time.now;
      for (const dir of dirs) {
        // 火道視覺（旋轉矩形，近端在角色）
        const flame = this.add
          .rectangle(ox + Math.cos(dir) * flameLength / 2, oy + Math.sin(dir) * flameLength / 2, flameLength, flameWidth, 0xff7a1a, 0.45)
          .setRotation(dir)
          .setDepth(20);
        this.tweens.add({ targets: flame, alpha: 0, duration: cfg.sprayMs, onComplete: () => flame.destroy() });

        // 噴出當下：此方向火道內敵人直接傷害
        for (const child of this.enemies.getChildren()) {
          const enemy = child as Enemy;
          if (!enemy.isVulnerable()) continue;
          if (this.pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, 0, flameLength, flameWidth)) {
            this.damageEnemyFrom(c, enemy, burstDmg, cfg.knockback, ox, oy, now);
          }
        }
        this.breakBreakablesInRect(ox, oy, dir, 0, flameLength, flameWidth, burstDmg, now); // v59：噴火火道掃到木箱也打破

        // 此方向地面燒灼矩形
        const bcx = ox + Math.cos(dir) * (cfg.burnStart + burnLength / 2);
        const bcy = oy + Math.sin(dir) * (cfg.burnStart + burnLength / 2);
        const burnGfx = this.add
          .rectangle(bcx, bcy, burnLength, burnWidth, 0xff5a1a, 0.22)
          .setRotation(dir)
          .setStrokeStyle(2, 0xff7a1a, 0.6)
          .setDepth(3);
        this.tweens.add({ targets: burnGfx, alpha: 0.32, duration: 300, yoyo: true, repeat: -1 });
        const ticks = Math.max(1, Math.floor(cfg.burnDurationMs / cfg.tickMs));
        this.time.addEvent({
          delay: cfg.tickMs,
          repeat: ticks - 1,
          callback: () => {
            if (this.gameOver) return;
            const t2 = this.time.now;
            for (const child of this.enemies.getChildren()) {
              const enemy = child as Enemy;
              if (!enemy.isVulnerable()) continue;
              if (this.pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, cfg.burnStart, burnLength, burnWidth)) {
                this.damageEnemyFrom(c, enemy, tickDmg, 0, bcx, bcy, t2);
              }
            }
          }
        });
        this.time.delayedCall(cfg.burnDurationMs, () => {
          this.tweens.killTweensOf(burnGfx);
          burnGfx.destroy();
        });
      }
    });
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
  }

  /**
   * v21：判定點 (px,py) 是否在「以 (ox,oy) 為起點、沿 dir 方向」的長方形內。
   * 矩形沿 dir 從 nearOffset 延伸 length（縱向），橫向總寬 width（左右各 width/2）。
   */
  private pointInOrientedRect(
    px: number, py: number,
    ox: number, oy: number,
    dir: number, nearOffset: number, length: number, width: number
  ): boolean {
    const dx = px - ox;
    const dy = py - oy;
    // 投影到 dir（縱向 along）與垂直方向（橫向 across）
    const along = dx * Math.cos(dir) + dy * Math.sin(dir);
    const across = -dx * Math.sin(dir) + dy * Math.cos(dir);
    return along >= nearOffset && along <= nearOffset + length && Math.abs(across) <= width / 2;
  }

  /** T 時間暫停：全場凍結，角色連續穿梭衝撞散佈全場的敵人，結束統一結算高傷打飛。期間無敵不可控。 */
  /** v45(1)：時停施展前檢查——spreadRadius 內是否有可傷敵人（無 → 不觸發、不消耗道具）。 */
  private hasTimestopTarget(c: Character): boolean {
    const cfg = GameConfig.skills.timestop;
    for (const ch of this.enemies.getChildren()) {
      const e = ch as Enemy;
      if (e.active && e.isVulnerable() &&
          Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y) <= cfg.spreadRadius) {
        return true;
      }
    }
    return false;
  }

  private skillTimestop(c: Character, time: number): void {
    const cfg = GameConfig.skills.timestop;
    this.lockSkill(c, cfg.durationMs + 150, time);
    // v59：時停穿梭期間旗標——瞬移位移經過道具不吃；時停結束清除(正常走過才撿)。
    c.timestopping = true;
    this.time.delayedCall(cfg.durationMs + 150, () => { c.timestopping = false; });

    // 啟動全場凍結（施展者處於 skillLock，不受凍結影響）
    this.timeStopped = true;
    this.timeStopUntil = time + cfg.durationMs;
    this.timeStopStartedAt = time;
    this.timeStopOwner = c; // ★v63:記錄撿到者→時停期間只 owner 能動,其他角色停
    // v45(2)：時停開始——暫停所有敵人蓄力 tween + 場景層預警(塔/BOSS fill) tween，進度凍結不流失
    for (const ch of this.enemies.getChildren()) (ch as Enemy).pauseChargeTweens(true);
    for (const fx of this.telegraphFx) fx.tween?.pause();

    // 全屏微暗覆蓋，強調時停氛圍
    const overlay = this.add
      .rectangle(0, 0, GameConfig.width, GameConfig.height, 0x2233aa, 0.12)
      .setOrigin(0, 0)
      .setDepth(15);
    this.time.delayedCall(cfg.durationMs, () => overlay.destroy());

    // 挑要穿梭的敵人：在 spreadRadius 內的敵人，依距離排序後「均勻散佈」抽樣，
    // 讓角色穿梭到更遠、更分散的目標（涵蓋範圍明顯更大），最多 dashes 隻。
    const pool = this.enemies
      .getChildren()
      .map((ch) => ch as Enemy)
      .filter(
        (e) =>
          e.active &&
          e.isVulnerable() &&
          Phaser.Math.Distance.Between(c.x, c.y, e.x, e.y) <= cfg.spreadRadius
      )
      .sort(
        (a, b) =>
          Phaser.Math.Distance.Between(c.x, c.y, a.x, a.y) -
          Phaser.Math.Distance.Between(c.x, c.y, b.x, b.y)
      );
    // v45(1)：pool 為空理論上不會進來（resolvePickups 已擋），保險 return。
    if (pool.length === 0) { this.timeStopped = false; return; }

    // v45(1)：決定 dashes 次穿梭的目標序列。
    // · pool 夠多(>=dashes)：均勻散佈抽 dashes 個（原行為）。
    // · pool 不足(1..dashes-1)：仍做滿 dashes 次，循環重複現有目標（targets[i % pool.length]）
    //   → 目標少(尤其只有1隻)時對牠【連續穿梭連斬多下】，大招不虧。
    const targets: Enemy[] = [];
    if (pool.length >= cfg.dashes) {
      for (let i = 0; i < cfg.dashes; i++) {
        const idx = Math.round((i / (cfg.dashes - 1)) * (pool.length - 1));
        targets.push(pool[idx]);
      }
    } else {
      for (let i = 0; i < cfg.dashes; i++) {
        targets.push(pool[i % pool.length]);
      }
    }

    // v45(1)：改用「命中次數」累計——每次穿梭把 hitRadius 內敵人的命中數 +1，
    //          結束時傷害 = dmg × 命中次數 → 重複穿梭到同一敵人（單目標連斬）會多段累加。
    const hitCount = new Map<Enemy, number>();
    const hitRadius = cfg.hitRadius * this.curSkillRadiusScale();
    const dmg = cfg.damage * this.curSkillDamageScale();
    const stepMs = cfg.durationMs / Math.max(1, targets.length + 1);
    // v51(3)：單目標(或目標少)連斬時，落點改到【目標周圍環上來回點】而非目標正中心 → 角色在目標周圍
    //   來回閃現連斬、不疊在目標身上。多目標時 offset 仍套用(各目標周圍小環、視覺更自然)。命中判定仍以目標為圓心。
    const offsetR = GameConfig.skills.timestop.orbitOffset;
    const arenaR = GameConfig.player.radius;
    targets.forEach((target, i) => {
      this.time.delayedCall(i * stepMs, () => {
        if (this.gameOver || !c.alive || !target.active) return;
        const fromX = c.x;
        const fromY = c.y;
        // v51(3)：落點 = 目標周圍環上、來回兩側交替的點(不落在目標中心，避免重疊)。
        // 角度隨穿梭序列擺動：偶數在一側、奇數在對側，並小幅旋轉，做出「周圍來回」感。
        const swing = (i % 2 === 0 ? 1 : -1) * (Math.PI * 0.55) + i * 0.7;
        const lx = Phaser.Math.Clamp(target.x + Math.cos(swing) * offsetR, this.arena.left + arenaR, this.arena.right - arenaR);
        const ly = Phaser.Math.Clamp(target.y + Math.sin(swing) * offsetR, this.arena.top + arenaR, this.arena.bottom - arenaR);
        c.setPosition(lx, ly);
        c.aimAngle = Phaser.Math.Angle.Between(lx, ly, target.x, target.y); // 面朝目標(揮擊感)
        this.spawnTrailLine(fromX, fromY, lx, ly, 0xffffff);
        // 記錄穿撞範圍內敵人（以【目標】為圓心 hitRadius；每次穿梭 +1，結束結算多段——連斬效果不變）
        for (const child of this.enemies.getChildren()) {
          const enemy = child as Enemy;
          if (!enemy.isVulnerable()) continue;
          if (Phaser.Math.Distance.Between(target.x, target.y, enemy.x, enemy.y) <= hitRadius) {
            hitCount.set(enemy, (hitCount.get(enemy) ?? 0) + 1);
          }
        }
        this.breakBreakablesInCircle(target.x, target.y, hitRadius, dmg, this.time.now); // v59：時停連斬掃到木箱也打破
      });
    });

    // 時停結束：對記錄到的敵人結算高傷 + 打飛。
    // v17.1 效能：改「分幀攤開」而非同幀全打——每幀處理一批(timestopSettlePerFrame)，
    // 避免 hitSet 很大時單幀爆量傷害跳字/死亡粒子拖垮 render 造成卡死/當掉。
    this.time.delayedCall(cfg.durationMs, () => {
      const list = Array.from(hitCount.keys());
      const perFrame = GameConfig.juice.timestopSettlePerFrame;
      let idx = 0;
      const settleBatch = (): void => {
        if (this.gameOver) return;
        const now = this.time.now;
        const end = Math.min(idx + perFrame, list.length);
        for (; idx < end; idx++) {
          const enemy = list[idx];
          if (!enemy.active || !enemy.isVulnerable()) continue;
          // v45(1)：多段——傷害 = 單段 dmg × 該敵被穿梭命中的次數（單目標連斬會累加多下）
          const times = hitCount.get(enemy) ?? 1;
          this.damageEnemy(c, enemy, dmg * times, cfg.knockback, now);
        }
      };
      // 第一批立即處理，其餘用逐幀 timer 分散
      settleBatch();
      if (idx < list.length) {
        const ev = this.time.addEvent({
          delay: 16, // 約每幀
          loop: true,
          callback: () => {
            settleBatch();
            if (idx >= list.length || this.gameOver) ev.remove();
          }
        });
      }
      this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
      // 凍結解除交由 update() 依 timeStopUntil 處理
    });
  }

  /** 傷害 + 以指定來源點擊退（雷擊落點用） */
  private damageEnemyFrom(
    actor: Character,
    enemy: Enemy,
    damage: number,
    knockback: number,
    fromX: number,
    fromY: number,
    time: number
  ): void {
    // v15：已被結算死亡/失效的敵人不再受理（防同幀重複命中）
    if (enemy.dead || !enemy.active) return;
    // ★寶箱怪:圓/直等 AOE 命中也走命中次數制(計1下+金幣),不走一般扣血。
    if (enemy.enemyType === 'treasure') { this.hitTreasure(enemy); return; }
    const dmg = Math.max(1, Math.round(damage * enemy.damageMultiplierFrom(fromX, fromY)));
    enemy.aggroActive = true; // ★主動仇恨:被玩家攻擊命中→標記主動,不計入被動警戒上限、永遠可追
    const dead = enemy.takeDamage(dmg);
    if (enemy.isBoss) {
      this.accumBossDamageDrop(dmg, time); // v35：打 BOSS 過程噴道具
      // ★v58→v61 修:BOSS 命中給能量也改【隊伍任何人命中 BOSS 都可能給 P1 能量】(同上,避免只 P1 命中才給)。
      if (this.controlMode === 'slow' && !enemy.dead) {
        const ecfg = GameConfig.energy;
        if (!this.player.empowered && Math.random() < ecfg.bossHitChance) {
          this.gainEnergy(this.player, ecfg.bossHitAmount);
          this.spawnEnergyOrb(enemy.x, enemy.y); // ★v59:BOSS 給能量也掉能量球飛P1(回饋)
        }
      }
    }
    enemy.applyKnockback(fromX, fromY, knockback, time);
    this.spawnDamageText(enemy.x, enemy.y, dmg);
    this.flashEnemy(enemy);
    // v15：擊殺原子性——只有「尚未被結算死亡」的敵人才計殺/掉落/kill()，防同幀重複
    if (dead && !enemy.dead) {
      const dx = enemy.x;
      const dy = enemy.y;
      const wasBoss = enemy.isBoss;
      const etype = enemy.enemyType;
      enemy.kill();
      if (wasBoss) {
        actor.kills++;
        this.grantKillExp(etype);
        this.onBossKilled(dx, dy); // v28：BOSS 擊殺 → 大爆炸+掉落+過關
      } else if (etype === 'tower') {
        this.tower = null; // v33：打掉塔 → 事件完成
        this.clearTelegraphsOf('tower'); // v45(4)：清掉塔蓄力中的扇形預警特效 + 取消發射
        this.spawnExpandingRing(dx, dy, 120, 0xff8844, 400);
        this.completeEvent(true);
      } else if (etype === 'npc' || etype === 'anchor') {
        // NPC/錨點為 anchor-like 位移點，玩家傷不到；此分支僅防呆，不計殺
      } else {
        actor.kills++;
        this.grantKillExp(etype);
        this.onWaveKill();
        this.spawnDeathBurst(dx, dy);
        // ★v58→v61 修:能量改【隊伍任何人擊殺都給 P1 能量】(僅 P1 有能量系統)。
        //   根因:舊版 gate `actor===player` 只在 P1 親自最後一擊才給→有 BOT 隊友時多數怪被 BOT 殺→P1 幾乎集不到能量
        //   (實測團隊25殺 P1 只親殺7→能量僅24)。用戶「打死怪就獲得能量」的直覺=只要怪死就給 P1。
        //   BOT 本身無能量系統,給 P1 不影響 BOT。能量球從怪死處飛向 P1(值已在此加好)。
        if (this.controlMode === 'slow') {
          this.grantKillEnergy(this.player, etype);
          this.spawnEnergyOrb(dx, dy); // 一隻一顆飛球(簡潔,代表獲得能量)
        }
        if (Math.random() < GameConfig.items.dropChance) this.dropItemAt(dx, dy, time);
      }
    }
    // v19：鬥氣改「命中次數」制，改由攻擊動作(performMeleeArc/performAttackOn)一次+1，此處不再逐隻累積
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

  private spawnThunderStrike(x: number, y: number, radius: number): void {
    const bolt = this.add.circle(x, y, radius, 0xffd700, 0.5).setDepth(20);
    const core = this.add.circle(x, y, radius * 0.4, 0xffffff, 0.9).setDepth(21);
    this.tweens.add({
      targets: [bolt, core],
      alpha: 0,
      duration: 240,
      onComplete: () => {
        bolt.destroy();
        core.destroy();
      }
    });
  }

  private spawnTrailLine(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const g = this.add.graphics().setDepth(20);
    g.lineStyle(10, color, 0.7);
    g.lineBetween(x1, y1, x2, y2);
    this.tweens.add({
      targets: g,
      alpha: 0,
      duration: 260,
      onComplete: () => g.destroy()
    });
  }

  /** v21：寬斬擊帶（半透明帶狀矩形，寬度與判定一致），供居合來回顯示 */
  private spawnSlashBand(x1: number, y1: number, x2: number, y2: number, width: number, color: number): void {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const len = Phaser.Math.Distance.Between(x1, y1, x2, y2);
    const ang = Phaser.Math.Angle.Between(x1, y1, x2, y2);
    const band = this.add
      .rectangle(cx, cy, len, width, color, 0.35)
      .setRotation(ang)
      .setDepth(20);
    band.setStrokeStyle(2, color, 0.6);
    this.tweens.add({
      targets: band,
      alpha: 0,
      duration: 300,
      onComplete: () => band.destroy()
    });
  }

  // ---------------------------------------------------------------------------
  // 普攻
  // ---------------------------------------------------------------------------
  private performAttackOn(actor: Character, primary: Enemy, time: number): void {
    // v14：普攻命中半徑隨等級變大；v31：強化狀態 ×rangeMult
    const emp = actor.isEmpowered(time);
    const hitRadius = levelLerp(
      GameConfig.player.attackHitRadius,
      GameConfig.level.character.attackHitRadiusLv1Scale,
      this.teamLevel
    ) * (emp ? GameConfig.combo.empower.rangeMult : 1);
    const children = this.enemies.getChildren();
    const atk = this.curAttackDamage() * (emp ? GameConfig.combo.empower.damageMult : 1); // v21 隨等級 + v31 強化加成
    for (const child of children) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      const dist = Phaser.Math.Distance.Between(actor.x, actor.y, enemy.x, enemy.y);
      if (dist <= hitRadius || enemy === primary) {
        this.damageEnemy(actor, enemy, atk, GameConfig.player.knockback, time);
      }
    }
    // v31：衝撞命中(必中 primary) → combo/鬥氣累積
    this.onComboHit(actor, time);

    this.flashWhite(actor);
    // v7：一般攻擊命中不再震動（只保留閃白/傷害數字/擊退）
    this.spawnSlashEffect(primary.x, primary.y);
    // v10：遠距衝撞命中的明顯衝擊特效
    this.spawnImpactEffect(primary.x, primary.y);
  }

  /** v10 衝撞命中衝擊特效：衝擊圈 + 命中點亮閃 */
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

  /** v10 原地扇形劍氣特效：朝 aimAngle 畫一個淡出扇形 */
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
  // 爆發連招（原地施放，v6 削弱、保留擊退）
  // ---------------------------------------------------------------------------
  /**
   * v31：普攻命中一次的 combo/鬥氣累積。
   * P1：走連段系統（combo++、達 4/8/12 觸發已解鎖的圓形/直線/強化爆發、到 12 歸零）+ p1AttackHits 統計。
   * BOT：維持舊鬥氣（gainSpiritHit，滿了在 tryAct 觸發舊爆發）。
   */
  /** v56 slow：combo 歸零門檻/上限 = 目前已解鎖最高階招門檻(爆發9 / 氣波6 / 圓形3)。 */
  private slowComboCap(): number {
    const cfg = GameConfig.combo;
    const lvl = this.teamLevel;
    if (lvl >= cfg.unlockLevel.burst) return cfg.thresholds.burst; // 9
    if (lvl >= cfg.unlockLevel.line) return cfg.thresholds.line;   // 6
    return cfg.thresholds.circle;                                  // 3
  }

  private onComboHit(c: Character, time: number): void {
    // ★v8:BOT 與 P1 無差異——連段技 combo 系統對所有角色生效(原本 BOT 只走舊 gainSpiritHit 只累積爆發鬥氣)。
    const isP1 = c === this.player;
    if (isP1) this.p1AttackHits++;
    const cfg = GameConfig.combo;
    const lvl = this.teamLevel;

    // ── 慢速模式(v55/v56)：COMBO 與能量【兩套獨立系統】，同一次命中兩條各 +1 ──
    if (this.controlMode === 'slow') {
      // 【A. COMBO(招式)】v56：歸零門檻 cap = 目前【已解鎖最高階招】的門檻(無空白浪費、低階招頻繁觸發)。
      const cap = this.slowComboCap();
      c.spirit = Math.min(cap, c.spirit + 1);
      const combo = c.spirit;
      // 各招在自身門檻觸發(需解鎖)：3圓/6氣波/9爆發
      if (combo === cfg.thresholds.circle && lvl >= cfg.unlockLevel.circle) this.comboCircle(c, time);
      if (combo === cfg.thresholds.line && lvl >= cfg.unlockLevel.line) this.comboLine(c, time);
      if (combo === cfg.thresholds.burst && lvl >= cfg.unlockLevel.burst) this.triggerBurst(c, time);
      // 達已解鎖最高招門檻(cap) → 該輪最高招已在上面觸發 → 歸零重來
      if (combo >= cap) c.spirit = 0;
      // 【B. 能量(強化)】v58:能量改【擊殺獲得】(見 grantKillEnergy),此處【不再命中+1】。
      // 保留:被打中 -1(Character.takeDamage)、滿 trigger 改【按 Z 手動觸發】(見 tryManualEmpower),非自動。
      if (isP1) this.emitStats();
      return;
    }

    // ── 快速模式(原樣，v55 不動)：一條 combo，3圓/6直/9爆發/10強化，到10歸零 ──
    c.spirit = Math.min(cfg.max, c.spirit + 1);
    const combo = c.spirit;
    if (combo === cfg.thresholds.circle && lvl >= cfg.unlockLevel.circle) {
      this.comboCircle(c, time);
    }
    if (combo === cfg.thresholds.line && lvl >= cfg.unlockLevel.line) {
      this.comboLine(c, time);
    }
    if (combo === cfg.thresholds.burst && lvl >= cfg.unlockLevel.burst) {
      this.triggerBurst(c, time);
    }
    if (combo >= cfg.thresholds.empower) {
      if (lvl >= cfg.unlockLevel.empower) this.comboEmpower(c, time);
      c.spirit = 0;
    }
    if (isP1) this.emitStats();
  }

  /**
   * ★【實驗性】進入招式「表演時間」:設 skillLockUntil = now + ms → 角色定身(fast衝刺/slow走位輸入全鎖)+無敵(isInvulnerable含skillLockUntil)。
   * enabled=false 直接跳過(整組拔掉→維持原本瞬發不鎖)。用 Math.max 避免縮短既有更長的鎖(如爆發連打)。
   */
  private enterPerformance(c: Character, ms: number, time: number): void {
    if (!GameConfig.performanceTime.enabled) return;
    c.skillLockUntil = Math.max(c.skillLockUntil, time + ms);
    c.stopMoving();
  }

  /** ★v58:能量增加(夾在 0~max);強化期間不加(純倒退)。slow 能量系統用。 */
  private gainEnergy(c: Character, amount: number): void {
    if (c.empowered) return; // 強化期間純倒退,不加
    const ecfg = GameConfig.energy;
    c.energy = Math.min(ecfg.max, c.energy + amount);
    if (c === this.player) this.emitStats();
  }

  /** ★v58:擊殺獲得能量——依怪種 perKill 表給量(未列用 default)。 */
  private grantKillEnergy(c: Character, etype: string): void {
    const ecfg = GameConfig.energy;
    const amount = ecfg.perKill[etype] ?? ecfg.perKill.default;
    this.gainEnergy(c, amount);
  }

  /**
   * ★v59 階段2:在 (x,y) 生成【能量球】飛向 P1 的【純視覺演出】(不加值——值已在擊殺當下 grantKillEnergy 加好)。
   * 輕量:場上上限 maxAlive;用 Graphics 小球(亮綠,與金幣區別)+ 先散射再 tween 追 P1、到達淡出。
   */
  private spawnEnergyOrb(x: number, y: number): void {
    if (this.controlMode !== 'slow') return; // 只 slow 有能量系統
    const cfg = GameConfig.energy.orb;
    if (!cfg.enabled) return; // ★開關關閉:不生飛能量球(能量值仍照常加,只無視覺)
    if (this.energyOrbCount >= cfg.maxAlive) return; // 輕量上限,避免多殺洗版
    this.energyOrbCount++;
    const orb = this.add.circle(x, y, cfg.radius, cfg.color, 1).setDepth(14);
    orb.setStrokeStyle(2, cfg.glowColor, 0.9);
    // 先小噴散射:短暫位移一下,再飛向 P1(有"掉出來再被吸走"的感覺)
    const ang = Math.random() * Math.PI * 2;
    const sx = x + Math.cos(ang) * cfg.scatter;
    const sy = y + Math.sin(ang) * cfg.scatter;
    const cleanup = () => { orb.destroy(); this.energyOrbCount = Math.max(0, this.energyOrbCount - 1); };
    this.tweens.add({
      targets: orb, x: sx, y: sy, duration: 120, ease: 'Quad.easeOut',
      onComplete: () => {
        if (!this.player || !this.player.active) { cleanup(); return; }
        // 每幀追蹤 P1 目前位置飛過去(P1 會動),用 timer 逼近 + 尺寸淡出
        const flyMs = cfg.flyMs;
        const start = this.time.now;
        const ev = this.time.addEvent({ delay: 16, loop: true, callback: () => {
          if (!orb.active) { ev.remove(); return; }
          if (!this.player || !this.player.active) { ev.remove(); cleanup(); return; }
          const t = Phaser.Math.Clamp((this.time.now - start) / flyMs, 0, 1);
          // 朝 P1 目前位置 lerp,尾段加速吸入
          const k = 0.18 + 0.5 * t;
          orb.x += (this.player.x - orb.x) * k;
          orb.y += (this.player.y - orb.y) * k;
          orb.setScale(1 - 0.4 * t);
          const d = Phaser.Math.Distance.Between(orb.x, orb.y, this.player.x, this.player.y);
          if (d <= this.player.displayWidth * 0.5 + 4 || t >= 1) {
            ev.remove();
            // 到達:小吸收閃光
            const flash = this.add.circle(this.player.x, this.player.y, 10, cfg.glowColor, 0.9).setDepth(15);
            this.tweens.add({ targets: flash, scale: { from: 0.6, to: 1.6 }, alpha: 0, duration: 200, onComplete: () => flash.destroy() });
            cleanup();
          }
        }});
      }
    });
  }

  /** ★v58:按 Z 手動觸發強化(slow P1、能量滿 trigger、已解鎖、非強化中才可)。回傳是否觸發。 */
  private tryManualEmpower(): boolean {
    if (this.controlMode !== 'slow') return false;
    const c = this.player;
    const ecfg = GameConfig.energy;
    if (!c || !c.alive || c.empowered) return false;
    if (c.energy < ecfg.trigger || this.teamLevel < ecfg.unlockLevel) return false;
    this.comboEmpower(c, this.time.now);
    return true;
  }

  /**
   * ★v63 階段4(改):強化期唯一招——【用現有自動鎖定選目標→打攻擊過去→以目標為中心炸圓AOE】。
   * (a)沿用平常自動鎖定(this.lockedTarget / findNearestDamageableEnemy,同 searchRadius 範圍)選目標;無怪→不放(不進冷卻,可再按)。
   * (b)朝目標射出衝擊投射視覺(projSpeed);(c)到達目標→以【目標位置】為中心炸圓AOE(radius,縮小)傷周圍敵人。
   * 角色不位移(不衝刺)。
   */
  private empowerAoe(c: Character, time: number): void {
    const cfg = GameConfig.combo.empower.aoe;
    // ★v64 修:AOE 鎖定【限角色圓圈(slow 藍圈 lockRadius)內、且只鎖敵人(徹底排除道具/非敵人)】。
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

  /** ★v63:以(tx,ty)【目標位置】為中心炸圓 AOE——傷該圓內所有可傷敵人 + 擴張圈視覺 + 輕震。 */
  private empowerAoeBurst(c: Character, tx: number, ty: number, time: number): void {
    const cfg = GameConfig.combo.empower.aoe;
    const radius = cfg.radius * this.curSkillRadiusScale();
    const dmg = cfg.damage * this.curSkillDamageScale() * GameConfig.combo.empower.damageMult;
    this.spawnExpandingRing(tx, ty, radius, cfg.color, cfg.ringMs);
    this.spawnExpandingRing(tx, ty, radius * 0.6, 0xfff2a8, cfg.ringMs * 0.8);
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity * 0.5);
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(tx, ty, enemy.x, enemy.y) <= radius) {
        this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, tx, ty, time); // 以目標為爆心
      }
    }
  }

  /** v31 連段①圓形範圍技（combo4, Lv3）：以角色為中心瞬發圓形 AOE + 擴張環（不鎖角色） */
  private comboCircle(c: Character, time: number): void {
    const cfg = GameConfig.combo.circle;
    const radius = cfg.radius * this.curSkillRadiusScale();
    const dmg = cfg.damage * this.curSkillDamageScale() * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1);
    this.spawnExpandingRing(c.x, c.y, radius, 0x00e5ff, 280);
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(c.x, c.y, enemy.x, enemy.y) <= radius) {
        this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, c.x, c.y, time);
      }
    }
    this.breakBreakablesInCircle(c.x, c.y, radius, dmg, time); // v59：圓形斬掃到木箱也打破
    this.shakeOnce(80, 0.006);
    this.enterPerformance(c, GameConfig.performanceTime.circle, time); // ★表演時間:定身無敵
  }

  /** v31 連段②直線範圍技（combo8, Lv6）：朝 aimAngle 瞬發直線矩形貫穿 */
  private comboLine(c: Character, time: number): void {
    const cfg = GameConfig.combo.line;
    const rs = this.curSkillRadiusScale();
    const length = cfg.length * rs;
    const width = cfg.width * rs;
    const dmg = cfg.damage * this.curSkillDamageScale() * (c.isEmpowered(time) ? GameConfig.combo.empower.damageMult : 1);
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
    for (const child of this.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.isVulnerable()) continue;
      if (this.pointInOrientedRect(enemy.x, enemy.y, ox, oy, dir, 0, length, width)) {
        this.damageEnemyFrom(c, enemy, dmg, cfg.knockback, ox, oy, time);
      }
    }
    this.breakBreakablesInRect(ox, oy, dir, 0, length, width, dmg, time); // v59：直線氣波掃到木箱也打破
    this.shakeOnce(80, 0.006);
    this.enterPerformance(c, GameConfig.performanceTime.line, time); // ★表演時間:定身無敵
  }

  /**
   * 限時強化。fast：empowerUntil=time+durationMs(固定時間)、光環到時自清。
   * v55 slow：empowered=true(能量驅動)、光環綁旗標，能量倒退到0(update)才解除。
   */
  private comboEmpower(c: Character, time: number): void {
    // ★v8:BOT 也用能量驅動強化(slow)——slow 判定改成「模式=slow」(不再限 P1),BOT 在 slow 也走 empowered 旗標+能量倒退解除。
    const slow = this.controlMode === 'slow';
    if (slow) {
      if (c.empowered) return;
      c.empowered = true;
    } else {
      c.empowerUntil = time + GameConfig.combo.empower.durationMs;
    }
    // 觸發瞬間演出
    this.shakeOnce(GameConfig.juice.burstShakeDuration, GameConfig.juice.burstShakeIntensity);
    this.spawnExpandingRing(c.x, c.y, 120, 0xffd700, 400);
    // v32→v55：持續整段強化的金色光環（跟隨角色、脈動），強化解除時(empowered=false)自清。
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
    // ★表演時間:爆發鎖定+無敵延長到 performanceTime.burst(如2秒)——連打(~880ms)結束後仍站著定身無敵至2秒。
    this.enterPerformance(c, GameConfig.performanceTime.burst, time);
    c.stopMoving();

    if (c === this.player) {
      this.game.events.emit('burst-start');
    }
    // v7：只有爆發時震動，且同時間最多一個（guarded）
    this.shakeOnce(
      GameConfig.juice.burstShakeDuration,
      GameConfig.juice.burstShakeIntensity
    );

    let hitCount = 0;
    const burstTimer = this.time.addEvent({
      delay: GameConfig.burst.intervalMs,
      repeat: GameConfig.burst.hits - 1,
      callback: () => {
        this.burstTick(c);
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

  private burstTick(c: Character): void {
    if (this.gameOver || !c.alive) return;
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
    this.breakBreakablesInCircle(c.x, c.y, radius, GameConfig.burst.damagePerHit, time); // v59：爆發掃到木箱也打破
    // v26：這段有打中敵人 → 觸發極短 hitstop（破頓）+ 命中閃白/小震動強化打擊感
    // ★v63 修:hitstop=physics.world.pause() 全域暫停物理(含P1)→只在【施放者=P1】時觸發,
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
  }

  /**
   * v26：極短命中頓感（hitstop）——短暫暫停物理世界(敵人/位移凝滯)，用真實時鐘(setTimeout)恢復，
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
    // v32：P1 的 combo 由 onComboHit 管理(到10才歸零)，爆發(combo9)結束不可清 combo，
    // 否則永遠到不了 combo10 的限時強化。只有 BOT(舊鬥氣爆發)在此歸零。
    if (c !== this.player) c.spirit = 0;
    c.stopMoving();
    if (c === this.player) this.game.events.emit('burst-end');
  }

  // ---------------------------------------------------------------------------
  // 傷害 / 擊殺
  // ---------------------------------------------------------------------------
  private damageEnemy(
    actor: Character,
    enemy: Enemy,
    damage: number,
    knockback: number,
    time: number
  ): void {
    // v15：已被結算死亡/失效的敵人不再受理（防同幀重複命中）
    if (enemy.dead || !enemy.active) return;
    // ★寶箱怪:走命中次數制(計1下+噴金幣,達20死噴大量),不走一般扣血。普攻/衝刺/連段技命中都經此→都算數。
    if (enemy.enemyType === 'treasure') { this.hitTreasure(enemy); return; }
    // 盾怪：從正面打大幅減傷（依攻擊者位置判定）
    const dmg = Math.max(1, Math.round(damage * enemy.damageMultiplierFrom(actor.x, actor.y)));
    enemy.aggroActive = true; // ★主動仇恨:被玩家攻擊命中→標記主動,不計入被動警戒上限、永遠可追
    const dead = enemy.takeDamage(dmg);
    if (enemy.isBoss) {
      this.accumBossDamageDrop(dmg, time); // v35：打 BOSS 過程噴道具
      // ★v61:BOSS 命中(非擊殺)機率給 P1 能量(與 damageEnemyFrom 一致;普攻/衝刺打BOSS也算)。
      if (this.controlMode === 'slow' && !enemy.dead) {
        const ecfg = GameConfig.energy;
        if (!this.player.empowered && Math.random() < ecfg.bossHitChance) {
          this.gainEnergy(this.player, ecfg.bossHitAmount);
          this.spawnEnergyOrb(enemy.x, enemy.y);
        }
      }
    }
    enemy.applyKnockback(actor.x, actor.y, knockback, time);
    this.spawnDamageText(enemy.x, enemy.y, dmg);
    this.flashEnemy(enemy);

    if (dead && !enemy.dead) {
      const dx = enemy.x;
      const dy = enemy.y;
      const wasBoss = enemy.isBoss;
      const etype = enemy.enemyType;
      enemy.kill();
      if (wasBoss) {
        actor.kills++;
        this.grantKillExp(etype);
        this.onBossKilled(dx, dy);
      } else if (etype === 'tower') {
        this.tower = null;
        this.clearTelegraphsOf('tower'); // v45(4)：清掉塔蓄力中的扇形預警特效 + 取消發射
        this.spawnExpandingRing(dx, dy, 120, 0xff8844, 400);
        this.completeEvent(true);
      } else if (etype === 'npc' || etype === 'anchor') {
        // v35/36：NPC/錨點為 anchor-like 位移點，玩家傷不到（isVulnerable=false）；此分支僅防呆，不處理
      } else {
        actor.kills++;
        this.grantKillExp(etype);
        this.onWaveKill();
        this.spawnDeathBurst(dx, dy);
        // ★v61 修「能量每5隻才跳」根因:普攻(performMeleeArc→此 damageEnemy)擊殺【原本沒給能量】——
        //   只有連段技(circle/line/burst 走 damageEnemyFrom)擊殺才給→玩家一般攻擊殺怪不加,直到連段技觸發一次AOE殺多隻才批次跳(≈每幾隻)。
        //   修:此處(隊伍任何人擊殺)同樣 grantKillEnergy(P1)+能量球→每殺一隻立即加、即時反饋。
        if (this.controlMode === 'slow') {
          this.grantKillEnergy(this.player, etype);
          this.spawnEnergyOrb(dx, dy);
        }
        // 掉落道具（機率）
        if (Math.random() < GameConfig.items.dropChance) {
          this.dropItemAt(dx, dy, time);
        }
      }
    }

    // v19：鬥氣改「命中次數」制，改由攻擊動作一次+1，此處不再逐隻累積
  }

  // ---------------------------------------------------------------------------
  // 打擊感 / 特效
  // ---------------------------------------------------------------------------
  /**
   * 螢幕震動（v7）：同時間最多一個。若鏡頭已在震動則忽略新的（不疊加）。
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
    // v17.1 節流：特效已達上限就略過視覺（傷害/計殺不受影響）
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
    // v17.1 節流：特效已達上限就略過死亡粒子（計殺/掉落不受影響）
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
    // v26：確保 hitstop 沒把物理留在暫停狀態
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
      // v25 第8項：本場 P1 普攻總命中次數
      p1AttackHits: this.p1AttackHits,
      controlMode: this.controlMode // v46：重開保留模式
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
  // v14 等級制（團隊共用經驗/等級 + 各項成長內插）
  // ---------------------------------------------------------------------------
  /** 從 Lv n 升到 Lv n+1 所需經驗（n 為 1-based 當前等級）；已達 cap 回傳 Infinity */
  private expToNext(level: number): number {
    const arr = GameConfig.level.expToNext;
    if (level >= GameConfig.level.cap) return Infinity;
    return arr[level - 1] ?? arr[arr.length - 1];
  }

  /** ★拔等級:擊殺不再給經驗/不升級(固定滿等)。保留空實作,呼叫點不動。 */
  private grantKillExp(_type: EnemyType): void {
    // no-op(等級系統已移除;數值固定滿等,難度改由波次/怪種控制)
  }

  /** v17：升級特效——所有存活角色身上金色擴張光環 + 畫面上方「LEVEL UP Lv.N」放大淡出 */
  /** ★拔等級:L 鍵除錯滿等已無意義(數值固定滿等、招式全開)→ no-op。 */
  private maxLevelCheat(): void {
    // no-op(等級系統已移除;開局即滿等/全招)
  }

  /** 難度成長：目前等級對應的敵人生成量上限 */
  /** v20：怪量隨場上存活角色數縮放（1人0.4 → 4人1.0） */
  private curAliveScale(): number {
    const n = this.aliveCount();
    const cfg = GameConfig.spawn.aliveScale;
    return Phaser.Math.Clamp(cfg.base + (n - 1) * cfg.perAlive, cfg.base, 1);
  }

  private curMaxAlive(): number {
    // v20：先算等級成長的上限，再乘上「存活角色數縮放」
    const byLevel = levelLerp(GameConfig.spawn.maxAlive, GameConfig.level.difficulty.maxAliveLv1Scale, this.teamLevel);
    let cap = Math.max(1, Math.round(byLevel * this.curAliveScale()));
    // v23：單人存活時再套硬上限（多人不受影響）
    if (this.aliveCount() === 1) cap = Math.min(cap, GameConfig.spawn.soloMaxAliveCap);
    return cap;
  }

  /** 難度成長：目前等級對應的生成間隔倍率（Lv1 較慢 → Lv10 = 1x） */
  private curSpawnIntervalMult(): number {
    // Lv1 = spawnIntervalLv1Mult，Lv10 = 1；用 base=1、lv1Scale=該倍率 反向內插
    return levelLerp(1, GameConfig.level.difficulty.spawnIntervalLv1Mult, this.teamLevel);
  }

  /** 難度成長：敵人 HP 倍率 */
  private curEnemyHpScale(): number {
    return levelLerp(1, GameConfig.level.difficulty.enemyHpLv1Scale, this.teamLevel);
  }

  /** 難度成長：敵人攻擊/接觸傷害倍率 */
  private curEnemyDamageScale(): number {
    return levelLerp(1, GameConfig.level.difficulty.enemyDamageLv1Scale, this.teamLevel);
  }

  /** 角色成長：招式傷害倍率 */
  private curSkillDamageScale(): number {
    return levelLerp(1, GameConfig.level.character.skillDamageLv1Scale, this.teamLevel);
  }

  /** 角色成長：招式範圍倍率 */
  private curSkillRadiusScale(): number {
    return levelLerp(1, GameConfig.level.character.skillRadiusLv1Scale, this.teamLevel);
  }

  /** v21 角色成長：普攻傷害隨等級（Lv1 = 現值×0.6 → Lv10 = 現值） */
  private curAttackDamage(): number {
    return levelLerp(
      GameConfig.player.attackDamage,
      GameConfig.level.character.attackDamageLv1Scale,
      this.teamLevel
    );
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
    this.triggerSkill(this.player, skill, this.time.now);
  }

  /** 除錯：回傳目前關鍵狀態 */
  debugState(): Record<string, unknown> {
    return {
      gameOver: this.gameOver,
      timeStopped: this.timeStopped,
      p1SkillLocked: this.player ? this.player.isSkillLocked(this.time.now) : null,
      p1Invuln: this.player ? this.player.isInvulnerable(this.time.now) : null,
      enemyCount: this.enemies ? this.enemies.countActive(true) : null,
      level: this.teamLevel,
      exp: this.teamExp,
      maxAlive: this.curMaxAlive(),
      spawnMult: this.curSpawnIntervalMult(),
      enemyHpScale: this.curEnemyHpScale(),
      enemyDmgScale: this.curEnemyDamageScale(),
      skillDmgScale: this.curSkillDamageScale(),
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

  /** v21 除錯：對 P1 施放補血（測 heal） */
  debugHealP1(): { before: number; after: number } {
    const before = this.player.hp;
    this.applyHeal(this.player);
    return { before, after: this.player.hp };
  }

  /** v28 除錯：直接生成一隻 BOSS（測 BOSS 戰/血條） */
  debugSpawnBoss(): void {
    this.waveState = 'boss';
    this.spawnBoss();
  }

  /** v36 除錯：直接施放 BOSS 指定招式（a/b/c/d）——需先有 BOSS 在場 */
  debugBossSkill(kind: 'a' | 'b' | 'c' | 'd'): void {
    const boss = this.boss;
    if (!boss || !boss.active) return;
    const p = this.player;
    this.onBossSkill(boss, kind, p.x, p.y);
  }

  /** v36 除錯：暫停/恢復 BOSS 自動輪替招式（隔離單招測試用） */
  debugPauseBossSkills(v: boolean): void {
    if (this.boss) this.boss.bossSkillsPaused = v;
  }

  /** v36 除錯：回報錨點狀態 */
  debugBossAnchors(): Array<{ x: number; y: number; type: string; lockable: boolean }> {
    return this.bossAnchors.filter(a => a && a.active).map(a => ({
      x: Math.round(a.x), y: Math.round(a.y), type: a.enemyType, lockable: this.isLockableEnemy(a)
    }));
  }

  /** v28 除錯：設定當前波次（測波次/BOSS 觸發） */
  debugSetWave(n: number): void {
    this.currentWave = Math.max(1, Math.floor(n));
    this.waveQuota = this.computeWaveQuota(this.currentWave);
    this.waveKilled = 0;
    this.waveSpawned = 0;
    this.waveState = 'spawning';
    this.emitStats();
  }

  /** v33 除錯：直接觸發指定事件（測塔/守護/佔領） */
  debugTriggerEvent(kind: 'tower' | 'guard' | 'capture'): void {
    this.waveState = 'event';
    this.startEvent(kind);
    this.emitStats();
  }

  /** v57/v61 除錯：可打破物件狀態(數量 + 位置 + 種類)。 */
  debugBreakables(): Record<string, unknown> {
    const list = this.breakables.getChildren().filter((c) => (c as Breakable).active).map((c) => {
      const bk = c as Breakable;
      return { x: Math.round(bk.x), y: Math.round(bk.y), hp: bk.hp, kind: bk.kind };
    });
    return { count: list.length, barrels: list.filter((b) => b.kind === 'barrel').length, list };
  }

  /** v57/v61 除錯：在指定點(相對玩家偏移)生一個可打破物件(kind 'crate'|'barrel')，回傳其索引。 */
  debugSpawnBreakableAt(dx: number, dy: number, kind: 'crate' | 'barrel' = 'crate'): number {
    const x = this.player.x + dx, y = this.player.y + dy;
    const bk = this.breakables.get(x, y) as Breakable | null;
    if (!bk) return -1;
    bk.spawnBreakable(x, y, kind);
    return this.breakables.getChildren().indexOf(bk);
  }

  /** v33 除錯：回傳事件狀態 */
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

  /** 除錯：直接灌經驗（測升級/成長用） */
  debugGrantExp(kills: number, type: EnemyType = 'normal'): void {
    for (let i = 0; i < kills; i++) this.grantKillExp(type);
    this.emitStats();
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

  /** v18 除錯：清空所有敵人，並在距 P1 指定距離處生一隻已實體化的一般怪，回傳其索引狀態 */
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

  /** v25 除錯：在距 P1 指定距離生一隻指定 type 的已實體化敵人（測 shooter 雷射等） */
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

  /** v18 除錯：回傳第一隻活著敵人的 AI 狀態 + 到 P1 距離 */
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

  /** v18 除錯：施放居合並回傳起點；供測試比對結束後是否回到起點附近 */
  debugIaidoStart(): { x: number; y: number } {
    const p = this.player;
    this.triggerSkill(p, 'C', this.time.now);
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
    // v12：指示線方向若有鎖定目標（敵人或道具）則指向目標，否則沿用瞄準角
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
      // v49：slow 模式不畫「衝刺距離延長指示線」(用戶要拿掉那條延長瞄準線)；fast 維持顯示。
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
        isPlayer: c.index === 0
      })),
      teamKills: this.teamKills(),
      survivalMs: this.survivalMs,
      playerBurstReady: this.player.alive && this.player.spiritFull,
      count: this.characters.length,
      maxCount: GameConfig.characters.count,
      // v14 等級制
      level: this.teamLevel,
      levelCap: GameConfig.level.cap,
      levelExpInto: this.teamExp - this.teamExpAtLevelStart,
      levelExpNeed: this.teamLevel >= GameConfig.level.cap ? 0 : this.expToNext(this.teamLevel),
      // v25 第8項：P1 普攻累計命中次數
      p1AttackHits: this.p1AttackHits,
      // v27 波次制
      wave: this.currentWave,
      waveKilled: this.waveKilled,
      waveQuota: this.waveQuota,
      waveState: this.waveState,
      // ★波次進度 HUD 用:關卡制當前子區進度(只純波次顯示;事件/BOSS/非 levelMode 隱藏)
      levelMode: this.levelMode,
      currentLevel: this.currentLevel,
      currentSub: this.currentSub,
      subWavesDone: this.subWavesDone,
      subWavesTarget: this.subWavesTarget,
      progressPhase: this.progressPhase,
      crossingOpen: this.crossingOpen,
      // v31/v55/v56 連段系統（P1）。slow=兩套(combo 歸零門檻跟已解鎖最高招 + 能量獨立)；fast=一條(3/6/9/10)。
      controlMode: this.controlMode,
      combo: this.player.spirit,
      // slow：combo 上限=已解鎖最高招門檻(3/6/9)；fast=10
      comboMax: this.controlMode === 'slow' ? this.slowComboCap() : GameConfig.combo.max,
      comboThresholds: GameConfig.combo.thresholds,
      comboUnlocked: {
        circle: this.teamLevel >= GameConfig.combo.unlockLevel.circle,
        line: this.teamLevel >= GameConfig.combo.unlockLevel.line,
        burst: this.teamLevel >= GameConfig.combo.unlockLevel.burst,
        empower: this.teamLevel >= GameConfig.combo.unlockLevel.empower
      },
      // fast 強化倒數(slow 不用)
      empowerRemainMs: Math.max(0, this.player.empowerUntil - this.time.now),
      // v55 能量系統(slow 用)
      energy: this.player.energy,
      energyMax: GameConfig.energy.max,
      energyTrigger: GameConfig.energy.trigger,
      empowered: this.player.empowered
    });
  }
}
