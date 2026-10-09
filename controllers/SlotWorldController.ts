import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { GoIndicator } from './GoIndicator';
import type { HiddenGateController } from './HiddenGateController';
import { destroyZoneScenery, drawCorridorScenery, drawZoneScenery } from '../systems/zoneScenery';

/** 左右方向 */
export type Side = 'L' | 'R';
/** 區域場景變體：A = 荒城、B = 火山 */
export type AreaVariant = 'A' | 'B';
/** 區域進程：playing = 區域內遊玩（含左右出口開放中）/ exiting = 上方出口開放 / transition = 閃黑轉場中 */
export type ProgressPhase = 'playing' | 'exiting' | 'transition';
/** 轉場去處：side = 左右平移到相鄰區域 / treasureRoom = 隱藏入口後的獎勵關 / nextArea = 上方出口閃黑到新區域 */
export type AreaTransition = 'side' | 'treasureRoom' | 'nextArea';

/** 左右轉場的子階段：walk = 出口開放、玩家走向邊緣 / panning = 鏡頭平移到相鄰區域 / enter = 全隊自動走進新區域 */
type CrossPhase = 'walk' | 'panning' | 'enter';

/**
 * SlotWorldController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface SlotWorldHost {
  /** 擁有者場景（物理範圍、鏡頭、圖形、tween 用） */
  readonly scene: Phaser.Scene;
  /** 全部角色（轉場時移動、放到定位） */
  characters(): ReadonlyArray<Character>;
  /** P1（觸發出口、鏡頭跟隨的對象） */
  player(): Character;
  /** GO 指示（出口開放時顯示，轉場開始時隱藏） */
  goIndicator(): GoIndicator;
  /** 隱藏入口（問號關前可能取代上方出口） */
  hiddenGate(): HiddenGateController;
  /** F4 背景圖：身後那張搬到前方新 slot */
  recycleBackground(side: Side, aheadSlot: Phaser.Geom.Rectangle): void;
  /** 清除所有角色的衝刺與速度（轉場會直接搬動角色座標） */
  resetCharacterMotion(): void;
  /** 離開目前區域（轉場開始時；左右平移則在抵達時）：場景收掉不帶到下一區的東西 */
  onAreaLeave(to: AreaTransition): void;
  /** 黑幕中換區前：清掉場上的物件與敵人 */
  clearArea(): void;
  /**
   * 進入新區域（鏡頭與角色已就定位）：場景布置物件並開打
   *
   * @param to 轉場去處
   * @param side 左右平移時抵達的方向（其餘轉場為 'L'）
   */
  onAreaEnter(to: AreaTransition, side: Side): void;
}

/** 轉場自動走位：速度、環狀定位半徑、到位容差 */
const AUTO_WALK_SPEED = 520;
const AUTO_WALK_RING_PX = 74;
const AUTO_WALK_ARRIVE_PX = 4;
/** 左右出口觸發線離移動區邊緣的額外距離（角色半徑之外） */
const CROSS_TRIGGER_INSET = 4;
/** 上方出口 / 隱藏入口的觸發距離加成（觸發距離之外） */
const TOP_EXIT_TRIGGER_EXTRA = 20;
/** 出口標記深度 */
const EXIT_MARKER_DEPTH = 20;
/** 出口標記呼吸閃爍：最低透明度、起伏幅度、週期因子 */
const EXIT_PULSE_MIN_ALPHA = 0.6;
const EXIT_PULSE_RANGE = 0.4;
const EXIT_PULSE_PERIOD = 300;
/** 下緣入口：離移動區下緣的距離、BOT 左右散開範圍 */
const ENTRY_BOTTOM_OFFSET = 40;
const ENTRY_BOT_SPREAD = 70;
/** 除錯關卡標題樣式與位置 */
const LEVEL_BANNER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '40px', color: '#ffd23f', stroke: '#000', strokeThickness: 4
};
const LEVEL_BANNER_Y_RATIO = 0.36;
const LEVEL_BANNER_DEPTH = 30;

/**
 * 關卡制的區域世界與轉場：
 * - 世界是水平並排的三格 slot：[左鄰][中央][右鄰]，每格 = 移動區（zone）+ 四周遠景邊距；玩家永遠在中央格遊玩，
 *   相鄰格是另一種場景變體（荒城 ↔ 火山交替）
 * - 左右轉場：開放出口後玩家走到邊緣 → 鏡頭平移到相鄰格 → 全隊自動走進去；抵達後世界往該側延伸一格
 *   （抵達格成為新中央、前方生成新格、回收身後最遠的格），並鎖定只能繼續同方向
 * - 上方出口：玩家走到出口 → 閃黑 → 三格重繪成新區域（方向限制解除）→ 全隊從下緣自動走到定位
 * - 隱藏入口：問號關前可能取代上方出口，走進去 → 閃黑 → 在中央格展開獎勵關
 *
 * 區域內的開打、清場與布置由場景透過 host 的 onAreaLeave / clearArea / onAreaEnter 處理。
 * 非關卡制時只提供固定的移動區（useFixedArena）。
 */
export class SlotWorldController {
  private arenaRect!: Phaser.Geom.Rectangle;
  private zoneA!: Phaser.Geom.Rectangle;
  private zoneBLeft!: Phaser.Geom.Rectangle;
  private zoneBRight!: Phaser.Geom.Rectangle;
  private slotA!: Phaser.Geom.Rectangle;
  private slotBLeft!: Phaser.Geom.Rectangle;
  private slotBRight!: Phaser.Geom.Rectangle;

  /** 場景配色用的關卡 */
  private currentLevel: number = GameConfig.stage.sceneLevel;
  /** 中央格的場景變體（相鄰格一律是另一種） */
  private areaVariant: AreaVariant = 'A';
  /** 左右轉場的方向限制：走過一側後只能繼續同方向，上方閃黑後解除；null = 兩側都開 */
  private dirLock: Side | null = null;
  private progressPhase: ProgressPhase = 'playing';
  /** 閃黑進新區域後，全隊自動走到定位中（期間玩家不可操控） */
  private levelEntering = false;

  // 左右轉場
  private crossingOpen = false;
  private crossPhase: CrossPhase = 'walk';
  /** 這次轉場鎖定的方向；兩側都開、玩家尚未走到邊緣時為 null */
  private crossSide: Side | null = null;
  /** 這次開放的方向（一般依 dirLock；問號關前由隨機組合指定） */
  private crossAllowed = { L: true, R: true };
  /** 出口開放的時間（之後 crossGraceMs 內不觸發，避免清完波剛好貼在邊緣就直接轉場） */
  private crossOpenAt = 0;

  // 場景繪製物件
  private sceneLayers: Phaser.GameObjects.GameObject[] = [];
  /** 各格的場景物件（key = slot 矩形）；世界往左右延伸時用來回收遠端的格 */
  private slotLayers = new Map<Phaser.Geom.Rectangle, Phaser.GameObjects.GameObject[]>();
  /** 中央格與右 / 左鄰格之間的走廊 */
  private corridorGfx: Phaser.GameObjects.Graphics | null = null;
  private corridorGfxL: Phaser.GameObjects.Graphics | null = null;
  /** 左右出口標記 */
  private choiceGfx: Phaser.GameObjects.Graphics | null = null;
  /** 上方出口標記（與左右出口分開：問號關前兩者可能同時存在） */
  private exitGfx: Phaser.GameObjects.Graphics | null = null;
  private levelBanner: Phaser.GameObjects.Text | null = null;

  /**
   * 鏡頭跟隨的目標點：所有存活角色外框（最左～最右、最上～最下）的中心；只有一人時就是他的位置。
   * 每次繪製前（PRE_RENDER）更新，鏡頭讀到的值與直接跟隨角色時相同（單人時行為不變）
   */
  private readonly followTarget = { x: 0, y: 0 };

  constructor(private readonly host: SlotWorldHost) {
    host.scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this.updateFollowTarget, this);
    host.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      host.scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this.updateFollowTarget, this);
    });
  }

  /** 更新鏡頭跟隨目標點為存活角色外框中心（全員陣亡時維持原位） */
  private updateFollowTarget(): void {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const c of this.host.characters()) {
      if (!c.alive) continue;
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    }
    if (minX === Infinity) return;
    this.followTarget.x = (minX + maxX) / 2;
    this.followTarget.y = (minY + maxY) / 2;
  }

  /** 目前的移動區（玩家可活動範圍、生怪與布置的範圍） */
  get arena(): Phaser.Geom.Rectangle {
    return this.arenaRect;
  }

  /** 中央格的移動區 */
  get centerZone(): Phaser.Geom.Rectangle {
    return this.zoneA;
  }

  /** 中央格 */
  get centerSlot(): Phaser.Geom.Rectangle {
    return this.slotA;
  }

  /** 三格（左鄰、中央、右鄰），F4 背景圖對齊用 */
  get slots(): Phaser.Geom.Rectangle[] {
    return [this.slotBLeft, this.slotA, this.slotBRight];
  }

  /** 目前移動區所在的格（鏡頭夾限與恢復跟隨用） */
  get currentSlot(): Phaser.Geom.Rectangle {
    if (this.arenaRect === this.zoneBLeft) return this.slotBLeft;
    if (this.arenaRect === this.zoneBRight) return this.slotBRight;
    return this.slotA;
  }

  /** 場景配色用的關卡 */
  get level(): number {
    return this.currentLevel;
  }

  get phase(): ProgressPhase {
    return this.progressPhase;
  }

  /** 左右出口開放中（含平移與自動走進新區域） */
  get isCrossingOpen(): boolean {
    return this.crossingOpen;
  }

  /** 是否在區域之間（出口開放、轉場、自動走位中）：這段期間強化能量不消退 */
  get isBetweenAreas(): boolean {
    return this.levelEntering || this.crossingOpen || this.progressPhase !== 'playing';
  }

  /**
   * 角色可活動的範圍：左右出口開放時放寬到中央格 + 開放側（鎖定方向後只含該側），否則為目前移動區
   */
  get walkBounds(): Phaser.Geom.Rectangle {
    if (!this.crossingOpen) return this.arenaRect;
    if (this.crossSide) return this.crossUnionRect(this.crossSide);
    const a = this.zoneA;
    return new Phaser.Geom.Rectangle(this.zoneBLeft.left, a.top, this.zoneBRight.right - this.zoneBLeft.left, a.height);
  }

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /** 非關卡制：固定的移動區 */
  useFixedArena(rect: Phaser.Geom.Rectangle): void {
    this.arenaRect = rect;
  }

  /**
   * 關卡制：建立三格佈局、物理範圍限制在中央移動區、鏡頭範圍涵蓋整個世界，並繪製三格場景
   */
  buildLevelLayout(): void {
    const st = GameConfig.stage;
    const gap = st.subGap;
    const slotW = st.arenaW + st.sceneMarginX * 2;
    const slotH = st.arenaH + st.sceneMarginTop + st.sceneMarginBottom;
    const worldW = slotW * 3 + gap * 2;
    const slotBLeftX = 0, slotAX = slotW + gap, slotBRightX = (slotW + gap) * 2;
    this.slotBLeft = new Phaser.Geom.Rectangle(slotBLeftX, 0, slotW, slotH);
    this.slotA = new Phaser.Geom.Rectangle(slotAX, 0, slotW, slotH);
    this.slotBRight = new Phaser.Geom.Rectangle(slotBRightX, 0, slotW, slotH);
    // 移動區 = 格扣掉左右 / 上下不可踏入的遠景邊距
    const mx = st.sceneMarginX, mt = st.sceneMarginTop;
    this.zoneBLeft = new Phaser.Geom.Rectangle(slotBLeftX + mx, mt, st.arenaW, st.arenaH);
    this.zoneA = new Phaser.Geom.Rectangle(slotAX + mx, mt, st.arenaW, st.arenaH);
    this.zoneBRight = new Phaser.Geom.Rectangle(slotBRightX + mx, mt, st.arenaW, st.arenaH);
    this.arenaRect = this.zoneA;
    this.setPhysicsBounds(this.zoneA);
    this.scene.cameras.main.setBounds(0, 0, worldW, slotH);
    this.drawAreaScenes();
  }

  /**
   * 每幀（關卡制）：推進轉場演出與出口觸發
   *
   * @param time 目前場景時間
   * @param delta 本幀毫秒
   * @returns true = 轉場演出中，場景這一幀不跑遊戲邏輯
   */
  update(time: number, delta: number): boolean {
    if (this.progressPhase === 'transition') return true;
    if (this.crossingOpen && this.crossPhase === 'panning') return true;
    if (this.crossingOpen && this.crossPhase === 'enter') {
      const side = this.crossSide ?? 'R';
      if (this.autoWalkTo(side === 'L' ? this.zoneBLeft : this.zoneBRight, delta)) this.arriveAtSide(side);
      return true;
    }
    if (this.levelEntering) {
      if (this.autoWalkTo(this.zoneA, delta)) {
        this.levelEntering = false;
        for (const c of this.host.characters()) if (c.alive) c.aimAngle = -Math.PI / 2;
      }
      return true;
    }
    if (this.progressPhase === 'exiting') this.updateTopExit();
    if (this.progressPhase === 'playing' || this.progressPhase === 'exiting') this.updateHiddenGateEntry();
    if (this.choiceGfx || this.exitGfx) this.pulseExitMarkers(time);
    if (this.crossingOpen) this.updateCrossing();
    return false;
  }

  /**
   * 啟用鏡頭跟隨全隊（存活角色外框中心，單人時即該角色），限制在指定格內（不露出相鄰格），帶 deadzone 緩衝
   *
   * @param slot 跟隨範圍
   * @param keepScroll true = 維持目前鏡頭位置不跳（startFollow 預設會立即置中到玩家）；轉場到位後使用
   */
  enableFollow(slot: Phaser.Geom.Rectangle, keepScroll = false): void {
    const cam = this.scene.cameras.main;
    const st = GameConfig.stage;
    const sx = cam.scrollX, sy = cam.scrollY;
    cam.setBounds(slot.x, slot.y, slot.width, slot.height);
    this.updateFollowTarget(); // startFollow 會立即對準目標，先更新成目前位置
    cam.startFollow(this.followTarget, true, st.followLerp, st.followLerpY);
    cam.setDeadzone(st.followDeadzoneW, st.followDeadzoneH);
    if (keepScroll) cam.setScroll(sx, sy);
  }

  // ===========================================================================
  // 出口
  // ===========================================================================

  /**
   * 開放左右出口：物理範圍與鏡頭範圍放寬到中央格 + 開放側、開放側畫走廊、出口標記與 GO；只開一側時直接鎖定該側
   *
   * @param allowed 開放的方向；省略時依 dirLock（走過一側後只開同側）
   */
  openCrossing(allowed?: { L: boolean; R: boolean }): void {
    this.crossingOpen = true;
    this.crossPhase = 'walk';
    this.crossAllowed = allowed ?? { L: this.dirLock !== 'R', R: this.dirLock !== 'L' };
    const openL = this.crossAllowed.L;
    const openR = this.crossAllowed.R;
    this.crossSide = openL && openR ? null : openL ? 'L' : 'R';
    this.crossOpenAt = this.scene.time.now;
    this.progressPhase = 'playing';
    const a = this.zoneA;
    const uL = openL ? this.zoneBLeft.left : a.left;
    const uR = openR ? this.zoneBRight.right : a.right;
    this.scene.physics.world.setBounds(uL, a.top, uR - uL, a.height);
    // 只放寬鏡頭範圍、不重新 startFollow（避免鏡頭跳）
    const camL = openL ? this.slotBLeft.x : this.slotA.x;
    const camR = openR ? this.slotBRight.right : this.slotA.right;
    this.scene.cameras.main.setBounds(camL, this.slotA.y, camR - camL, this.slotA.height);
    if (openR) this.drawCorridorScene('R');
    if (openL) this.drawCorridorScene('L');
    this.drawCrossingMarkers();
  }

  /** 開放上方出口（玩家走到出口 → 閃黑到新區域） */
  openTopExit(): void {
    this.progressPhase = 'exiting';
    this.showTopExit();
  }

  /**
   * 問號關前的雙出口：從 左+右 / 左+上 / 右+上 中挑一組，排除回頭方向（dirLock = 'L' 時不出現右，反之亦然）。
   * 左右照常平移；上方閃黑（這一區有隱藏入口時依機率改開拱門取代上方出口）
   */
  openMysteryExits(): void {
    const back = this.dirLock === 'L' ? 'R' : this.dirLock === 'R' ? 'L' : null;
    const combos = GameConfig.stage.mysteryExitCombos.filter((c) => !back || !c.includes(back));
    const combo = combos[Phaser.Math.Between(0, combos.length - 1)];
    this.openCrossing({ L: combo.includes('L'), R: combo.includes('R') });
    if (combo.includes('U')) {
      this.progressPhase = 'exiting'; // 左右出口仍在 crossingOpen 下偵測
      if (this.host.hiddenGate().exists && Math.random() < GameConfig.stage.hiddenGate.openChance) this.openHiddenGateExit();
      else this.showTopExit();
    }
  }

  /** 開啟隱藏入口作為出口：拱門發光，GO 指向拱門洞口 */
  openHiddenGateExit(): void {
    const gate = this.host.hiddenGate();
    gate.open();
    const d = gate.doorway;
    if (d) this.host.goIndicator().show('U', d.x, d.y, d.radius);
  }

  /** 畫中央移動區左右緣開放方向的出口標記並顯示 GO（玩家走到該側邊緣觸發） */
  private drawCrossingMarkers(): void {
    this.clearCrossingMarkers();
    const g = this.scene.add.graphics().setDepth(EXIT_MARKER_DEPTH).setScrollFactor(1);
    const a = this.arenaRect;
    const midY = a.centerY;
    const inset = GameConfig.stage.arrowInset;
    const orbR = GameConfig.stage.exitOrb.radius;
    const go = this.host.goIndicator();
    if (this.crossAllowed.L) {
      this.drawExitOrb(g, a.left + inset, midY);
      go.show('L', a.left + inset, midY, orbR);
    }
    if (this.crossAllowed.R) {
      this.drawExitOrb(g, a.right - inset, midY);
      go.show('R', a.right - inset, midY, orbR);
    }
    this.choiceGfx = g;
  }

  private clearCrossingMarkers(): void {
    if (this.choiceGfx) { this.choiceGfx.destroy(); this.choiceGfx = null; }
  }

  /** 上方出口標記：場地上緣中央（距邊 arrowInset），並顯示 GO */
  private showTopExit(): void {
    if (this.exitGfx) this.exitGfx.destroy();
    const g = this.scene.add.graphics().setDepth(EXIT_MARKER_DEPTH);
    const { x, y } = this.topExitPoint();
    this.drawExitOrb(g, x, y);
    this.exitGfx = g;
    this.host.goIndicator().show('U', x, y, GameConfig.stage.exitOrb.radius);
  }

  /** 收掉上方出口的標記與 GO */
  private closeTopExit(): void {
    if (this.exitGfx) { this.exitGfx.destroy(); this.exitGfx = null; }
    this.host.goIndicator().hide('U');
  }

  /** 上方出口位置（出口標記圓心，也是觸發點） */
  private topExitPoint(): { x: number; y: number } {
    return { x: this.arenaRect.centerX, y: this.arenaRect.top + GameConfig.stage.arrowInset };
  }

  /**
   * 出口標記（左 / 右 / 上共用樣式）：外圍由外往內疊幾層半透明光暈，中間實心圓與亮色核心
   *
   * @param g 畫在哪個 graphics
   * @param x 圓心 x
   * @param y 圓心 y
   */
  private drawExitOrb(g: Phaser.GameObjects.Graphics, x: number, y: number): void {
    const cfg = GameConfig.stage.exitOrb;
    for (let i = cfg.glowLayers; i >= 1; i--) {
      g.fillStyle(cfg.color, cfg.glowAlpha / cfg.glowLayers);
      g.fillCircle(x, y, cfg.radius + (cfg.glowRadius * i) / cfg.glowLayers);
    }
    g.fillStyle(cfg.color, 1);
    g.fillCircle(x, y, cfg.radius);
    g.fillStyle(cfg.coreColor, 0.9);
    g.fillCircle(x, y, cfg.radius * 0.5);
  }

  /** 出口標記的呼吸閃爍 */
  private pulseExitMarkers(time: number): void {
    const a = EXIT_PULSE_MIN_ALPHA + EXIT_PULSE_RANGE * Math.abs(Math.sin(time / EXIT_PULSE_PERIOD));
    if (this.choiceGfx) this.choiceGfx.setAlpha(a);
    if (this.exitGfx) this.exitGfx.setAlpha(a);
  }

  /** 上方出口開放中：玩家走到出口 → 閃黑到新區域（上方出口被隱藏入口取代時沒有標記） */
  private updateTopExit(): void {
    if (!this.exitGfx) return;
    const { x, y } = this.topExitPoint();
    const p = this.host.player();
    if (Phaser.Math.Distance.Between(p.x, p.y, x, y) <= GameConfig.stage.triggerDist + TOP_EXIT_TRIGGER_EXTRA) {
      this.startNextAreaTransition();
    }
  }

  /** 隱藏入口開啟時：玩家走到拱門入口就進入（已選左右開始轉場就不再判定） */
  private updateHiddenGateEntry(): void {
    const gate = this.host.hiddenGate();
    const e = gate.entrance;
    if (!gate.isOpen || !e) return;
    if (this.crossingOpen && this.crossPhase !== 'walk') return;
    const p = this.host.player();
    if (Phaser.Math.Distance.Between(p.x, p.y, e.x, e.y) <= GameConfig.stage.triggerDist + TOP_EXIT_TRIGGER_EXTRA) {
      this.enterHiddenGate();
    }
  }

  /** 左右出口開放中：開放緩衝期過後，玩家走到中央移動區左 / 右緣 → 開始往該側平移 */
  private updateCrossing(): void {
    if (this.crossPhase !== 'walk') return;
    if (this.scene.time.now - this.crossOpenAt < GameConfig.stage.crossGraceMs) return;
    const r = GameConfig.player.radius;
    const p = this.host.player();
    if (p.x >= this.zoneA.right - r - CROSS_TRIGGER_INSET && this.crossAllowed.R) this.startPanToSide('R');
    else if (p.x <= this.zoneA.left + r + CROSS_TRIGGER_INSET && this.crossAllowed.L) this.startPanToSide('L');
  }

  // ===========================================================================
  // 轉場
  // ===========================================================================

  /**
   * 往一側平移：鎖定該側（不可反悔）、收掉出口與 GO，鏡頭平移到該側格的移動區中央；
   * 平移期間凍結遊戲，平移完鏡頭範圍收成該格、全隊自動走進去
   */
  private startPanToSide(side: Side): void {
    this.crossPhase = 'panning';
    this.crossSide = side;
    this.host.resetCharacterMotion(); // 觸發時可能正在衝刺，先清掉避免與自動走位互搶
    this.closeTopExit(); // 問號關前若同時開了上方出口，選了左右就關掉
    this.progressPhase = 'playing';
    this.clearCrossingMarkers();
    this.host.goIndicator().hideAll();
    const zone = side === 'L' ? this.zoneBLeft : this.zoneBRight;
    const slot = side === 'L' ? this.slotBLeft : this.slotBRight;
    const cam = this.scene.cameras.main;
    const halfW = cam.width / 2, halfH = cam.height / 2;
    const cx = Phaser.Math.Clamp(zone.centerX, slot.left + halfW, slot.right - halfW);
    const cy = Phaser.Math.Clamp(zone.centerY, slot.top + halfH, slot.bottom - halfH);
    cam.stopFollow();
    cam.pan(cx, cy, GameConfig.stage.panMs, 'Sine.easeInOut', false, (_c, progress) => {
      if (progress >= 1) {
        cam.setBounds(slot.x, slot.y, slot.width, slot.height);
        this.crossPhase = 'enter';
      }
    });
  }

  /**
   * 全隊自動走到移動區中央周圍的環狀定位（第 i 人從正上方起每 90° 一個位置，中心留給任務目標）
   *
   * @param zone 目標移動區
   * @param delta 本幀毫秒
   * @returns 是否全員到位
   */
  private autoWalkTo(zone: Phaser.Geom.Rectangle, delta: number): boolean {
    const step = AUTO_WALK_SPEED * (delta / 1000);
    const cx = zone.centerX, cy = zone.centerY;
    const R = AUTO_WALK_RING_PX;
    const slotOf = (i: number) => { const ang = -Math.PI / 2 + i * (Math.PI / 2); return { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R }; };
    const characters = this.host.characters();
    let allArrived = true;
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      if (!c.alive) continue;
      const t = slotOf(i);
      const dx = t.x - c.x, dy = t.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist > AUTO_WALK_ARRIVE_PX) {
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
    return allArrived;
  }

  /**
   * 左右轉場全隊到位：世界往該側延伸一格（抵達格成為新中央），物理範圍收回新中央移動區、
   * 鏡頭固定在到位時的位置後恢復跟隨（不跳），交給場景開打。之後只能繼續往同方向轉場
   */
  private arriveAtSide(side: Side): void {
    this.crossingOpen = false;
    this.crossSide = null;
    this.dirLock = side;
    this.host.onAreaLeave('side');
    this.host.goIndicator().hideAll();
    this.recenterOn(side);
    const zone = this.zoneA;
    const slot = this.slotA;
    this.arenaRect = zone;
    this.setPhysicsBounds(zone);
    const cam = this.scene.cameras.main;
    cam.stopFollow();
    cam.setBounds(slot.x, slot.y, slot.width, slot.height);
    const halfW = cam.width / 2, halfH = cam.height / 2;
    cam.centerOn(
      Phaser.Math.Clamp(zone.centerX, slot.left + halfW, slot.right - halfW),
      Phaser.Math.Clamp(zone.centerY, slot.top + halfH, slot.bottom - halfH)
    );
    this.host.resetCharacterMotion();
    this.enableFollow(slot, true);
    this.progressPhase = 'playing';
    this.host.onAreaEnter('side', side);
  }

  /** 走進隱藏入口：收掉其他出口，閃黑後在中央格展開獎勵關 */
  private enterHiddenGate(): void {
    this.host.hiddenGate().clear();
    this.progressPhase = 'transition';
    this.clearCrossingMarkers();
    this.closeTopExit();
    this.host.onAreaLeave('treasureRoom');
    this.crossingOpen = false;
    this.crossSide = null;
    this.host.goIndicator().hideAll();
    this.fadeThrough(() => {
      this.host.clearArea();
      this.resetToCenterZone();
      this.progressPhase = 'playing';
      this.host.onAreaEnter('treasureRoom', 'L');
    });
  }

  /** 閃黑到新區域（走進上方出口，或中場 BOSS 打倒後）：收掉其他出口，黑幕中三格重繪成新區域（方向限制解除），全隊從下緣自動走到定位 */
  startNextAreaTransition(): void {
    this.progressPhase = 'transition';
    this.clearCrossingMarkers();
    this.closeTopExit();
    this.host.onAreaLeave('nextArea');
    this.crossingOpen = false; // 問號關前若左右也同時開放，選了上方就收掉
    this.crossSide = null;
    this.host.goIndicator().hideAll();
    this.fadeThrough(() => {
      this.host.clearArea();
      this.dirLock = null;
      this.areaVariant = otherVariant(this.areaVariant);
      this.arenaRect = this.zoneA;
      this.setPhysicsBounds(this.zoneA);
      this.drawAreaScenes();
      this.placeCharactersAtEntry();
      this.enableFollow(this.slotA);
      this.levelEntering = true;
      this.progressPhase = 'playing';
      this.host.onAreaEnter('nextArea', 'L');
    });
  }

  /**
   * 閃黑轉場：停止跟隨並放寬鏡頭範圍，淡出 → 黑幕中執行 onBlack → 淡入
   *
   * @param onBlack 黑幕中要做的事
   */
  private fadeThrough(onBlack: () => void): void {
    const cam = this.scene.cameras.main;
    const fade = GameConfig.stage.fadeMs;
    this.disableFollow();
    cam.fadeOut(fade, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      onBlack();
      cam.fadeIn(fade, 0, 0, 0);
    });
  }

  /** 移動區回到中央格、全隊放到下緣入口，鏡頭跟隨中央格 */
  private resetToCenterZone(): void {
    this.arenaRect = this.zoneA;
    this.setPhysicsBounds(this.zoneA);
    this.placeCharactersAtEntry();
    this.enableFollow(this.slotA);
  }

  /** 全隊放到中央移動區下緣入口（P1 在中央、BOT 左右散開），面向場內，並清掉轉場前的移動狀態 */
  private placeCharactersAtEntry(): void {
    const cx = this.zoneA.centerX;
    const entryY = this.zoneA.bottom - ENTRY_BOTTOM_OFFSET;
    const player = this.host.player();
    for (const c of this.host.characters()) {
      if (!c.alive) continue;
      const off = c === player ? 0 : Phaser.Math.Between(-ENTRY_BOT_SPREAD, ENTRY_BOT_SPREAD);
      c.x = cx + off;
      c.y = entryY;
      c.aimAngle = -Math.PI / 2;
      (c.body as Phaser.Physics.Arcade.Body).reset(c.x, c.y);
    }
    this.host.resetCharacterMotion();
  }

  /** 停止鏡頭跟隨，鏡頭範圍放寬到整個世界（平移與閃黑前用） */
  private disableFollow(): void {
    const cam = this.scene.cameras.main;
    cam.stopFollow();
    cam.setBounds(this.slotBLeft.x, this.slotA.y, this.slotBRight.right - this.slotBLeft.x, this.slotA.height);
  }

  private setPhysicsBounds(zone: Phaser.Geom.Rectangle): void {
    this.scene.physics.world.setBounds(zone.x, zone.y, zone.width, zone.height);
  }

  /** 中央移動區 + 該側走廊 + 該側鄰格移動區合成的大矩形（三者同高、水平相連） */
  private crossUnionRect(side: Side): Phaser.Geom.Rectangle {
    const a = this.zoneA;
    if (side === 'R') return new Phaser.Geom.Rectangle(a.left, a.top, this.zoneBRight.right - a.left, a.height);
    return new Phaser.Geom.Rectangle(this.zoneBLeft.left, a.top, a.right - this.zoneBLeft.left, a.height);
  }

  // ===========================================================================
  // 場景繪製
  // ===========================================================================

  /**
   * 把 side 側的格重新標記為中央：
   * - 原中央變成反側鄰格（場景物件保留，畫面不變）
   * - 身後最遠的格回收（場景物件銷毀、F4 背景圖搬到前方新格重用）
   * - 前方新增一格並繪製場景（變體 = 新中央的另一種）
   * - 走廊：中央與身後鄰格之間那條保留為反側走廊，前方走廊下次開放時再畫
   *
   * @param side 抵達的方向（L = 往左延伸、R = 往右延伸）
   */
  private recenterOn(side: Side): void {
    const step = (side === 'R' ? 1 : -1) * (this.slotA.width + GameConfig.stage.subGap);
    const behindSlot = side === 'R' ? this.slotBLeft : this.slotBRight;
    const aheadSlot = side === 'R' ? this.slotBRight : this.slotBLeft;
    const aheadZone = side === 'R' ? this.zoneBRight : this.zoneBLeft;
    const removed = new Set(this.slotLayers.get(behindSlot) ?? []);
    destroyZoneScenery(this.scene, removed);
    this.slotLayers.delete(behindSlot);
    this.sceneLayers = this.sceneLayers.filter((o) => !removed.has(o));
    const newAheadSlot = Phaser.Geom.Rectangle.Clone(aheadSlot);
    const newAheadZone = Phaser.Geom.Rectangle.Clone(aheadZone);
    newAheadSlot.x += step;
    newAheadZone.x += step;
    // 原「中央 ↔ 抵達側」走廊變成新中央的身後走廊；原身後走廊所在的格已回收
    if (side === 'R') {
      if (this.corridorGfxL) this.corridorGfxL.destroy();
      this.corridorGfxL = this.corridorGfx;
      this.corridorGfx = null;
    } else {
      if (this.corridorGfx) this.corridorGfx.destroy();
      this.corridorGfx = this.corridorGfxL;
      this.corridorGfxL = null;
    }
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
    this.areaVariant = otherVariant(this.areaVariant);
    this.drawZoneScene(newAheadSlot, newAheadZone, this.currentLevel, otherVariant(this.areaVariant));
    this.host.recycleBackground(side, newAheadSlot);
  }

  /**
   * 一側的走廊：填滿中央移動區該側邊緣到鄰格移動區之間、整格高度，避免轉場時露出黑塊
   *
   * @param side 走廊在中央的哪一側
   */
  private drawCorridorScene(side: Side): void {
    const old = side === 'R' ? this.corridorGfx : this.corridorGfxL;
    if (old) old.destroy();
    const x0 = side === 'R' ? this.zoneA.right : this.zoneBLeft.right;
    const x1 = side === 'R' ? this.zoneBRight.left : this.zoneA.left;
    const g = drawCorridorScenery(this.scene, x0, x1, this.slotA, this.zoneA, this.currentLevel);
    if (side === 'R') this.corridorGfx = g; else this.corridorGfxL = g;
  }

  /** 清掉並重繪三格場景：中央 = areaVariant，左右鄰格 = 另一種變體 */
  private drawAreaScenes(): void {
    this.clearSceneLayers();
    const side = otherVariant(this.areaVariant);
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, side);
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, this.areaVariant);
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, side);
  }

  /** 清掉所有場景繪製物件與走廊 */
  private clearSceneLayers(): void {
    destroyZoneScenery(this.scene, this.sceneLayers);
    this.sceneLayers = [];
    this.slotLayers.clear();
    if (this.corridorGfx) { this.corridorGfx.destroy(); this.corridorGfx = null; }
    if (this.corridorGfxL) { this.corridorGfxL.destroy(); this.corridorGfxL = null; }
  }

  /** 繪製一格的場景，登記到 sceneLayers 與該格的 slotLayers（往左右延伸時可單獨回收） */
  private drawZoneScene(slot: Phaser.Geom.Rectangle, zone: Phaser.Geom.Rectangle, level: number, variant: AreaVariant): void {
    const objects = drawZoneScenery(this.scene, slot, zone, level, variant);
    this.sceneLayers.push(...objects);
    this.slotLayers.set(slot, objects);
  }

  /**
   * 除錯：切換預覽關卡配色（不動流程，只重繪三格場景），並顯示關卡標題
   *
   * @param level 關卡（夾在 1 ~ totalLevels）
   */
  debugPreviewLevel(level: number): void {
    this.currentLevel = Phaser.Math.Clamp(level, 1, GameConfig.stage.totalLevels);
    this.clearSceneLayers();
    this.drawZoneScene(this.slotBLeft, this.zoneBLeft, this.currentLevel, 'B');
    this.drawZoneScene(this.slotA, this.zoneA, this.currentLevel, 'A');
    this.drawZoneScene(this.slotBRight, this.zoneBRight, this.currentLevel, 'B');
    if (this.levelBanner) this.levelBanner.destroy();
    const banner = this.scene.add.text(GameConfig.width / 2, GameConfig.height * LEVEL_BANNER_Y_RATIO, `關卡 ${this.currentLevel} - A`, LEVEL_BANNER_STYLE)
      .setOrigin(0.5).setScrollFactor(0).setDepth(LEVEL_BANNER_DEPTH).setAlpha(0);
    this.levelBanner = banner;
    this.scene.tweens.add({ targets: banner, alpha: 1, duration: 250, yoyo: true, hold: 900,
      onComplete: () => { if (this.levelBanner) { this.levelBanner.destroy(); this.levelBanner = null; } } });
  }
}

/** 另一種場景變體（荒城 ↔ 火山） */
function otherVariant(v: AreaVariant): AreaVariant {
  return v === 'A' ? 'B' : 'A';
}
