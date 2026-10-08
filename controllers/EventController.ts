import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy, EnemyType } from '../objects/Enemy';
import type { TelegraphFx } from '../systems/telegraphFx';
import { isRegularEnemy } from '../systems/enemyKinds';

/** 限時事件種類：摧毀尖塔 / 守護目標 / 佔領據點 */
export type EventKind = 'tower' | 'guard' | 'capture';

/** 開場演出的階段：走位 → 統一大字 → 各事件訊息（聚焦）→ 結束 */
type IntroStage = 'introMove' | 'unified' | 'perEvent' | 'done';

/**
 * EventController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface EventHost {
  /** 擁有者場景（建立圖形、tween、鏡頭用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（塔、守護目標從這裡取用；計算圈內怪數用） */
  readonly enemies: Phaser.Physics.Arcade.Group;
  /** 目前的移動區（事件目標生在中央；生怪位置的夾限） */
  arena(): Phaser.Geom.Rectangle;
  /** 目前移動區所在的整格（聚焦鏡頭的夾限與還原跟隨用） */
  currentSlot(): Phaser.Geom.Rectangle;
  /** 全部角色（開場走位、塔扇形命中判定用） */
  characters(): ReadonlyArray<Character>;
  /** P1（佔領進度只看 P1 是否在圈內） */
  player(): Character;
  /** 目前波次（塔血量成長用） */
  currentWave(): number;
  isGameOver(): boolean;
  /** 掛上一般敵人的攻擊回呼（近戰 / 射擊 / 雷射 / 投彈） */
  wireEnemyCallbacks(enemy: Enemy): void;
  /** 登記 / 移除 / 清除場景層級的預警特效 */
  addTelegraph(fx: TelegraphFx): void;
  removeTelegraph(fx: TelegraphFx): void;
  clearTelegraphsOf(owner: TelegraphFx['owner']): void;
  /** 對角色造成傷害（rootMs > 0 時附帶定身） */
  damageCharacter(c: Character, amount: number, fromX: number, fromY: number, rootMs: number): void;
  /** 生一隻召喚怪（不計波次配額） */
  spawnSummonAt(x: number, y: number, time: number, forceType?: EnemyType, leashImmune?: boolean, forceChase?: boolean): void;
  flashEnemy(enemy: Enemy): void;
  dropItemAt(x: number, y: number, time: number): void;
  shakeOnce(duration: number, intensity: number): void;
  showEventBanner(text: string): void;
  /** 鏡頭恢復跟隨玩家（限制在指定整格內） */
  enableFollow(slot: Phaser.Geom.Rectangle): void;
  /** 事件結束（成功或失敗，目標與 HUD 已清掉、獎勵已發）後，由場景決定清殘留怪 / 轉場 / 過關 */
  onEventEnded(): void;
}

/** 事件 HUD 內容（UIScene 的事件進度條） */
interface EventHudPayload {
  active: boolean;
  label: string;
  /** 進度條比例 0~1 */
  ratio: number;
  /** 剩餘毫秒（UIScene 補「Xs」後綴） */
  remainMs: number;
}

/** 開場大字樣式 */
const INTRO_BANNER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '42px', color: '#ffd166', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
};
/** 開場大字的垂直位置（畫面高度比例） */
const INTRO_BANNER_Y_RATIO = 0.3;
/** 開場大字疊在聚焦目標之上的深度差（高於壓黑遮罩，聚焦時大字不被壓暗） */
const INTRO_BANNER_DEPTH_OFFSET = 5;
/** 走位到位的距離容差 */
const WALK_ARRIVE_PX = 4;

/** 守護目標深度（高於一般怪，被怪群包圍時仍看得到）與其高亮環深度 */
const GUARD_NPC_DEPTH = 11;
const GUARD_HIGHLIGHT_DEPTH = 10;
/** 守護高亮環：外擴距離、閃爍週期、顏色 */
const GUARD_HIGHLIGHT_GAP = 10;
const GUARD_HIGHLIGHT_BLINK_MS = 200;
const GUARD_HIGHLIGHT_COLOR = 0x00e5ff;
/** 守護波怪在該側縱向排開時的隨機抖動（避免完全重疊） */
const GUARD_SPAWN_JITTER_Y = 20;

/** 佔領圈深度與顏色：可推進（綠）/ 玩家在圈內但有怪（黃）/ 玩家不在圈內（灰） */
const CAPTURE_DEPTH = 3;
const CAPTURE_COLOR_PROGRESS = 0x7bed9f;
const CAPTURE_COLOR_CONTESTED = 0xffd166;
const CAPTURE_COLOR_IDLE = 0x888888;
/** 佔領進度每幀以固定 60 FPS 推進 */
const CAPTURE_TICK_SEC = 1 / 60;

/** 塔開戰後首次扇形、首次出怪的延遲 */
const TOWER_FIRST_BLAST_DELAY_MS = 800;
const TOWER_FIRST_SPAWN_DELAY_MS = 500;
/** 塔召喚怪離塔的距離 */
const TOWER_SUMMON_DISTANCE = 300;
/** 塔扇形：預警深度、發射閃光深度與淡出、顏色 */
const TOWER_FAN_DEPTH = 4;
const TOWER_BLAST_DEPTH = 20;
const TOWER_BLAST_FADE_MS = 260;
const TOWER_FAN_COLOR = 0xff5555;
const TOWER_BLAST_COLOR = 0xff3344;
/** 守護、佔領開戰後首波的延遲 */
const GUARD_FIRST_SPAWN_DELAY_MS = 500;
const CAPTURE_FIRST_WAVE_DELAY_MS = 600;
/** 召喚怪生成位置離移動區邊緣的最小距離 */
const SUMMON_EDGE_MARGIN = 30;
/** 成功獎勵掉落圍成的圓半徑 */
const REWARD_DROP_RADIUS = 60;
/** 結果提示中的事件名稱 */
const EVENT_NAMES: Record<EventKind, string> = { tower: '塔', guard: '守護', capture: '佔領' };

/**
 * 限時事件（塔 / 守護 / 佔領）：事件波清完小怪後啟動，完成或失敗後由場景接著過關。
 *
 * 流程：start 生出事件目標 → 開場演出（全隊走到目標周圍 → 統一大字 → 鏡頭聚焦目標並顯示各事件訊息，期間鎖操作、凍結敵人）
 * → 開戰（事件計時、出怪）→ 成功 / 失敗 → 清目標、發獎勵 → host.onEventEnded()。
 * - 塔：持續出怪，每隔一段時間朝四方發大扇形（正十字、斜十字交替）；限時內打掉塔成功
 * - 守護：怪從左右兩側一波波衝向守護目標；撐滿時間成功，目標被打倒失敗
 * - 佔領：怪一波波生在據點圈內；P1 在圈內且圈內無怪時累積進度，滿了成功，時間到失敗
 *
 * 進場與開戰時依存活人數鎖定難度係數（塔血量、出怪數量），事件中途不再調整。
 */
export class EventController {
  private kindNow: EventKind | null = null;
  /** 開場演出中、尚未開戰的事件 */
  private pendingKind: EventKind | null = null;
  /** 依存活人數決定的難度係數（事件開始時鎖定） */
  private difficulty = 1;

  // 開場演出
  private introActive = false;
  private introStage: IntroStage = 'done';
  /** 目前階段的大字顯示到期（觸發滑出）或滑出結束的時間 */
  private introStageEndsAt = 0;
  /** 目前階段的大字是否已開始滑出 */
  private introSlideDone = false;
  /** 整段開場的逾時保底：到時強制結束，避免卡住 */
  private introHardEndsAt = 0;
  private introBanner: Phaser.GameObjects.Text | null = null;
  /** 走位段的逾時保底：到時直接放到定位 */
  private introWalkEndsAt = 0;

  // 聚焦（鏡頭移到目標 + 壓黑 + 凍結敵人）
  private focusPause = false;
  /** 鏡頭移動中（移動完才開始壓黑與聚焦計時） */
  private focusPanning = false;
  private focusDim: Phaser.GameObjects.Rectangle | null = null;
  private focusGlow: Phaser.GameObjects.Arc | null = null;
  /** 被聚焦的目標（暫時提高深度，結束時還原） */
  private focusTarget: Phaser.GameObjects.Components.Depth | null = null;
  private focusTargetDepth = 0;

  // 塔
  private tower: Enemy | null = null;
  private towerNextBlastAt = 0;
  private towerNextSpawnAt = 0;
  /** 扇形方向組：0 = 正十字、1 = 斜十字（每次發射交替） */
  private towerBeamGroup = 0;
  /** 限時截止（到時未打掉塔 = 失敗） */
  private towerEndsAt = 0;

  // 守護
  private guard: Enemy | null = null;
  private guardHighlight: Phaser.GameObjects.Graphics | null = null;
  /** 撐到這個時間即成功 */
  private guardEndsAt = 0;
  private guardNextSpawnAt = 0;
  /** 下一波的波種索引（循環取 waves） */
  private guardWaveIdx = 0;
  /** 目前這一波是否已生成（生成後才開始判斷是否清空，避免生成當幀被誤判為清空） */
  private guardWaveActive = false;
  /** 本次守護累計出了幾波（每循環一輪後增加每波數量） */
  private guardGlobalWaveCount = 0;

  // 佔領
  /** 佔領進度 0~100 */
  private captureProgress = 0;
  private captureGfx: Phaser.GameObjects.Graphics | null = null;
  private captureCx = 0;
  private captureCy = 0;
  /** 目前是否有一波怪在圈內待清 */
  private captureWaveActive = false;
  /** 圈內清空後，下一波生成的時間 */
  private captureNextWaveAt = 0;
  private captureEndsAt = 0;

  constructor(private readonly host: EventHost) {}

  /** 進行中的事件（含開場演出）；沒有為 null */
  get kind(): EventKind | null {
    return this.kindNow;
  }

  /** 守護目標（守護事件以外為 null） */
  get guardNpc(): Enemy | null {
    return this.guard;
  }

  /** 守護目標仍可被敵人攻擊時回傳它，否則為 null */
  get hittableGuardNpc(): Enemy | null {
    const npc = this.guard;
    return this.kindNow === 'guard' && npc && npc.active && !npc.dead ? npc : null;
  }

  /** 是否在開場演出中（場景鎖操作、只跑演出） */
  get isIntroActive(): boolean {
    return this.introActive;
  }

  /** 開場是否在走位段（角色位置由控制器驅動，場景不清零速度） */
  get isIntroWalking(): boolean {
    return this.introStage === 'introMove';
  }

  /** 聚焦定格中（敵人凍結） */
  get isFocusPaused(): boolean {
    return this.focusPause;
  }

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /**
   * 啟動事件：鎖定難度、在移動區中央生出事件目標，接著進入開場演出（演出結束才開始計時與出怪）
   *
   * @param kind 事件種類
   */
  start(kind: EventKind): void {
    this.kindNow = kind;
    const now = this.scene.time.now;
    const arena = this.host.arena();
    this.difficulty = this.difficultyFor(this.host.characters().filter((c) => c.alive).length);

    if (kind === 'tower') {
      const cfg = GameConfig.event.tower;
      const hpMult = (1 + (this.host.currentWave() - 1) * cfg.hpGrowthPerWave) * this.difficulty;
      const t = this.spawnTarget(arena.centerX, arena.centerY, now, 'tower', hpMult);
      if (t) this.tower = t;
      this.towerBeamGroup = 0;
    } else if (kind === 'guard') {
      const n = this.spawnTarget(arena.centerX, arena.centerY, now, 'npc', 1);
      if (n) {
        n.setDepth(GUARD_NPC_DEPTH);
        this.guard = n;
        if (this.guardHighlight) this.guardHighlight.destroy();
        this.guardHighlight = this.scene.add.graphics().setDepth(GUARD_HIGHLIGHT_DEPTH);
      }
    } else {
      this.captureCx = arena.centerX;
      this.captureCy = arena.centerY;
      this.captureProgress = 0;
      this.captureWaveActive = false;
      this.captureGfx = this.scene.add.graphics().setDepth(CAPTURE_DEPTH);
    }
    this.startIntro(kind);
  }

  /**
   * 每幀（開場演出中）：推進走位、大字、聚焦的時序；整段逾時則強制結束
   *
   * @param time 目前場景時間
   * @param delta 本幀毫秒
   */
  updateIntro(time: number, delta: number): void {
    if (time >= this.introHardEndsAt) { this.finishIntro(); return; }
    if (this.introStage === 'introMove') { this.updateIntroWalk(delta); return; }
    // 鏡頭移動中不推進計時（移動完才開始聚焦計時）
    if (this.focusPanning) return;
    if (!this.introSlideDone && time >= this.introStageEndsAt) {
      // 大字顯示到期 → 滑出；各事件訊息段同時結束聚焦
      this.slideOutIntroBanner();
      if (this.introStage === 'perEvent') this.endFocus();
      this.introSlideDone = true;
      this.introStageEndsAt = time + GameConfig.event.intro.slideOutSec * 1000;
      return;
    }
    if (this.introSlideDone && time >= this.introStageEndsAt) {
      // 滑出完成 → 下一段，或開場結束
      if (this.introStage === 'unified') this.startIntroStage('perEvent');
      else this.finishIntro();
    }
  }

  /**
   * 每幀（開戰後）：跑目前事件的邏輯並更新 HUD
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    if (this.kindNow === 'tower') this.updateTower(time);
    else if (this.kindNow === 'guard') this.updateGuard(time);
    else if (this.kindNow === 'capture') this.updateCapture(time);
    this.emitHud();
  }

  /**
   * 時停結束：塔發射、出怪與守護出波的排程順延凍結時間
   *
   * @param frozenMs 凍結時長
   */
  onTimeStopEnd(frozenMs: number): void {
    if (this.towerNextBlastAt > 0) this.towerNextBlastAt += frozenMs;
    if (this.towerNextSpawnAt > 0) this.towerNextSpawnAt += frozenMs;
    if (this.guardNextSpawnAt > 0) this.guardNextSpawnAt += frozenMs;
  }

  /** 塔被打倒（擊殺結算由場景處理）：取消蓄力中的扇形，事件成功 */
  onTowerDestroyed(): void {
    this.tower = null;
    this.host.clearTelegraphsOf('tower');
    this.complete(true);
  }

  /**
   * 敵人打中守護目標一次（攻擊冷卻由呼叫端判斷）：扣血、閃白；被打倒則事件失敗
   *
   * @returns 守護目標是否被打倒
   */
  hitGuardNpc(): boolean {
    const npc = this.guard;
    if (!npc) return false;
    const dead = npc.takeDamage(Math.max(1, Math.round(GameConfig.event.guard.npcContactDamage)));
    this.host.flashEnemy(npc);
    if (dead) {
      npc.kill();
      this.guard = null;
      this.complete(false);
    }
    return dead;
  }

  /**
   * 事件結束：清掉事件目標與 HUD，成功時在中央掉落獎勵，顯示結果提示，再交給場景接續
   *
   * @param success 是否成功
   */
  complete(success: boolean): void {
    const kind = this.kindNow;
    this.kindNow = null;
    if (this.tower) { if (this.tower.active) this.tower.kill(); this.tower = null; }
    if (this.guard) { if (this.guard.active) this.guard.kill(); this.guard = null; }
    if (this.guardHighlight) { this.guardHighlight.destroy(); this.guardHighlight = null; }
    if (this.captureGfx) { this.captureGfx.destroy(); this.captureGfx = null; }
    this.captureProgress = 0;
    this.emitHudPayload({ active: false, label: '', ratio: 0, remainMs: 0 });
    if (success) {
      const rw = GameConfig.event.rewards;
      const arena = this.host.arena();
      for (let i = 0; i < rw.dropCount; i++) {
        const ang = (i / rw.dropCount) * Math.PI * 2;
        this.host.dropItemAt(arena.centerX + Math.cos(ang) * REWARD_DROP_RADIUS, arena.centerY + Math.sin(ang) * REWARD_DROP_RADIUS, this.scene.time.now);
      }
      this.host.showEventBanner(`${kind ? EVENT_NAMES[kind] : EVENT_NAMES.capture} 成功！獎勵發放`);
    } else {
      this.host.showEventBanner('事件失敗…');
    }
    this.host.onEventEnded();
  }

  /** 除錯：事件狀態 */
  debugState(): Record<string, unknown> {
    return {
      eventKind: this.kindNow,
      towerHp: this.tower ? this.tower.hp : null,
      npcHp: this.guard ? this.guard.hp : null,
      guardRemainMs: this.guard ? Math.max(0, this.guardEndsAt - this.scene.time.now) : null,
      captureProgress: Math.round(this.captureProgress)
    };
  }

  /**
   * 依存活人數取難度係數（設定沒有對應人數時用單人難度）
   *
   * @param playerCount 存活人數
   */
  private difficultyFor(playerCount: number): number {
    const multipliers = GameConfig.event.dynamicDifficulty.playerCountMultipliers;
    return multipliers[playerCount] ?? multipliers[1] ?? 1.0;
  }

  /** 從敵人池取一隻作為事件目標（塔 / 守護目標），立即可見、可被攻擊 */
  private spawnTarget(x: number, y: number, now: number, type: EnemyType, hpMult: number): Enemy | null {
    const e = this.host.enemies.get(x, y) as Enemy | null;
    if (!e) return null;
    this.host.wireEnemyCallbacks(e);
    e.spawn(x, y, now, type, hpMult);
    (e as unknown as { telegraphing: boolean }).telegraphing = false;
    (e.body as Phaser.Physics.Arcade.Body).enable = true;
    e.setAlpha(1);
    return e;
  }

  // ===========================================================================
  // 開場演出
  // ===========================================================================

  /** 開始開場演出：設定逾時保底、送出 HUD（倒數尚未開始），先進走位段 */
  private startIntro(kind: EventKind): void {
    const cfg = GameConfig.event.intro;
    const now = this.scene.time.now;
    this.pendingKind = kind;
    this.introActive = true;
    this.introHardEndsAt = now + cfg.maxIntroSec * 1000;
    this.emitHud();
    this.introStage = 'introMove';
    this.introSlideDone = false;
    this.introWalkEndsAt = now + cfg.maxWalkSec * 1000;
  }

  /** 走位段每幀：全隊走到目標周圍的環狀定位；全員到位或逾時（直接放到定位）→ 進統一大字 */
  private updateIntroWalk(delta: number): void {
    const cfg = GameConfig.event.intro;
    const step = cfg.walkSpeed * (delta / 1000);
    const arena = this.host.arena();
    const cx = arena.centerX, cy = arena.centerY;
    const R = cfg.walkRingPx;
    // 第 i 人站在目標正上方起算、每 90° 一個定位（中心留給目標）
    const slotOf = (i: number) => { const ang = -Math.PI / 2 + i * (Math.PI / 2); return { x: cx + Math.cos(ang) * R, y: cy + Math.sin(ang) * R }; };
    const timedOut = this.scene.time.now >= this.introWalkEndsAt;
    const characters = this.host.characters();
    let allArrived = true;
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      if (!c.alive) continue;
      const t = slotOf(i);
      const dx = t.x - c.x, dy = t.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (timedOut) { c.x = t.x; c.y = t.y; c.aimAngle = Math.atan2(cy - c.y || -1, cx - c.x || 0); }
      else if (dist > WALK_ARRIVE_PX) {
        allArrived = false;
        const mv = Math.min(step, dist);
        c.x += (dx / dist) * mv; c.y += (dy / dist) * mv;
        c.setRotation(Math.atan2(dy, dx)); c.aimAngle = Math.atan2(dy, dx); // 面向移動方向
      } else { c.x = t.x; c.y = t.y; }
      (c.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    }
    if (allArrived || timedOut) {
      for (const c of characters) if (c.alive) c.aimAngle = Phaser.Math.Angle.Between(c.x, c.y, cx, cy);
      this.startIntroStage('unified');
    }
  }

  /** 開始大字段：顯示對應大字，設定顯示到期時間；各事件訊息段同時開始聚焦 */
  private startIntroStage(stage: 'unified' | 'perEvent'): void {
    const cfg = GameConfig.event.intro;
    this.introStage = stage;
    this.introSlideDone = false;
    const holdSec = stage === 'unified' ? cfg.unifiedHoldSec : cfg.focusHoldSec;
    this.introStageEndsAt = this.scene.time.now + (cfg.fadeInSec + holdSec) * 1000;
    const text = stage === 'unified'
      ? cfg.unifiedText
      : ((cfg.perEventText as Record<string, string>)[this.pendingKind ?? 'tower'] ?? '');
    this.showIntroBanner(text);
    if (stage === 'perEvent') this.beginFocus();
  }

  /** 開場大字：淡入後停在畫面上，由 slideOutIntroBanner 滑出 */
  private showIntroBanner(text: string): void {
    if (this.introBanner) { this.introBanner.destroy(); this.introBanner = null; }
    const cfg = GameConfig.event.intro;
    const t = this.scene.add.text(GameConfig.width / 2, GameConfig.height * INTRO_BANNER_Y_RATIO, text, INTRO_BANNER_STYLE)
      .setOrigin(0.5).setScrollFactor(0).setDepth(cfg.focusTargetDepth + INTRO_BANNER_DEPTH_OFFSET).setAlpha(0);
    this.introBanner = t;
    this.scene.tweens.add({ targets: t, alpha: 1, duration: cfg.fadeInSec * 1000, ease: 'Quad.easeOut' });
  }

  /** 目前的大字向右滑出並淡出（滑完不推進，由 updateIntro 計時推進） */
  private slideOutIntroBanner(): void {
    const cfg = GameConfig.event.intro;
    const t = this.introBanner;
    if (!t) return;
    this.introBanner = null;
    this.scene.tweens.add({
      targets: t, x: t.x + cfg.slideOutDistPx, alpha: 0,
      duration: cfg.slideOutSec * 1000, ease: 'Back.easeIn',
      onComplete: () => t.destroy()
    });
  }

  /** 開場結束：清掉演出殘留（逾時強制結束時也一定清乾淨）、鏡頭恢復跟隨，開戰 */
  private finishIntro(): void {
    this.introActive = false;
    this.introStage = 'done';
    this.introSlideDone = false;
    if (this.introBanner) { this.introBanner.destroy(); this.introBanner = null; }
    this.focusPause = false;
    this.focusPanning = false;
    if (this.focusTarget) { this.focusTarget.setDepth(this.focusTargetDepth); this.focusTarget = null; }
    if (this.focusDim) { this.focusDim.destroy(); this.focusDim = null; }
    if (this.focusGlow) { this.focusGlow.destroy(); this.focusGlow = null; }
    this.host.enableFollow(this.host.currentSlot());
    const kind = this.pendingKind;
    this.pendingKind = null;
    if (kind) this.beginCombat(kind);
  }

  /** 開戰：開始事件計時與首波出怪排程 */
  private beginCombat(kind: EventKind): void {
    const now = this.scene.time.now;
    if (kind === 'tower') {
      this.towerNextBlastAt = now + TOWER_FIRST_BLAST_DELAY_MS;
      this.towerNextSpawnAt = now + TOWER_FIRST_SPAWN_DELAY_MS;
      this.towerBeamGroup = 0;
      this.towerEndsAt = now + GameConfig.event.tower.timeLimitMs;
    } else if (kind === 'guard') {
      this.guardEndsAt = now + GameConfig.event.guard.durationMs;
      this.guardNextSpawnAt = now + GUARD_FIRST_SPAWN_DELAY_MS;
      this.guardWaveIdx = 0;
      this.guardWaveActive = false;
      this.guardGlobalWaveCount = 0;
    } else {
      this.captureNextWaveAt = now + CAPTURE_FIRST_WAVE_DELAY_MS;
      this.captureEndsAt = now + GameConfig.event.capture.timeLimitMs;
    }
    this.emitHud();
  }

  // ===========================================================================
  // 聚焦
  // ===========================================================================

  /** 開始聚焦：停止跟隨，鏡頭移到目標置中（夾在目前整格內），移動完才壓黑並開始計時 */
  private beginFocus(): void {
    const cfg = GameConfig.event.intro;
    const cam = this.scene.cameras.main;
    const arena = this.host.arena();
    this.focusPanning = true;
    cam.stopFollow();
    const halfW = cam.width / 2, halfH = cam.height / 2;
    const slot = this.host.currentSlot();
    const cx = Phaser.Math.Clamp(arena.centerX, slot.left + halfW, slot.right - halfW);
    const cy = Phaser.Math.Clamp(arena.centerY, slot.top + halfH, slot.bottom - halfH);
    cam.pan(cx, cy, cfg.panMs, 'Sine.easeInOut', false, (_c, progress) => {
      if (progress >= 1 && this.focusPanning) this.onFocusPanComplete();
    });
  }

  /** 鏡頭到位：凍結敵人、目標提高深度露出遮罩、壓黑加亮暈，開始聚焦計時 */
  private onFocusPanComplete(): void {
    const cfg = GameConfig.event.intro;
    this.focusPanning = false;
    this.focusPause = true;
    const target = this.focusTargetOf(this.pendingKind);
    this.focusTarget = target;
    if (target) {
      this.focusTargetDepth = (target as unknown as { depth: number }).depth ?? 0;
      target.setDepth(cfg.focusTargetDepth);
    }
    // 佔領：聚焦時先畫出據點圈（開戰後才每幀重畫），讓玩家看到要守的範圍
    if (this.pendingKind === 'capture' && this.captureGfx) {
      const R = GameConfig.event.capture.captureRadius;
      this.captureGfx.clear();
      this.captureGfx.lineStyle(3, CAPTURE_COLOR_CONTESTED, 0.9);
      this.captureGfx.strokeCircle(this.captureCx, this.captureCy, R);
      this.captureGfx.fillStyle(CAPTURE_COLOR_CONTESTED, 0.06);
      this.captureGfx.fillCircle(this.captureCx, this.captureCy, R);
    }
    // 全螢幕壓黑：在目標之下、其他遊戲物件之上
    const dim = this.scene.add.rectangle(GameConfig.width / 2, GameConfig.height / 2, GameConfig.width, GameConfig.height, 0x000000, 0)
      .setScrollFactor(0).setDepth(cfg.focusTargetDepth - 2);
    this.focusDim = dim;
    this.scene.tweens.add({ targets: dim, fillAlpha: cfg.dimAlpha, duration: cfg.dimFadeSec * 1000 });
    // 目標亮暈：目標已在畫面中央。佔領的亮暈對齊據點圈大小、用較低透明度（大範圍疊加才不會洗掉壓黑）
    const isCapture = this.pendingKind === 'capture';
    const glowRadius = isCapture ? GameConfig.event.capture.captureRadius * cfg.captureSpotlightMult : cfg.spotlightRadiusPx;
    const glow = this.scene.add.circle(GameConfig.width / 2, GameConfig.height / 2, glowRadius, cfg.spotlightColor, 0)
      .setScrollFactor(0).setDepth(cfg.focusTargetDepth - 1).setBlendMode(Phaser.BlendModes.ADD);
    this.focusGlow = glow;
    this.scene.tweens.add({ targets: glow, fillAlpha: isCapture ? cfg.captureSpotlightAlpha : cfg.spotlightAlpha, duration: cfg.dimFadeSec * 1000 });
    this.introStageEndsAt = this.scene.time.now + cfg.focusHoldSec * 1000;
  }

  /** 聚焦目標：塔 / 守護目標，或佔領圈圖形 */
  private focusTargetOf(kind: EventKind | null): Phaser.GameObjects.Components.Depth | null {
    if (kind === 'tower') return this.tower as unknown as Phaser.GameObjects.Components.Depth;
    if (kind === 'guard') return this.guard as unknown as Phaser.GameObjects.Components.Depth;
    if (kind === 'capture') return this.captureGfx as unknown as Phaser.GameObjects.Components.Depth;
    return null;
  }

  /** 聚焦結束：解除凍結、目標深度還原、壓黑與亮暈淡出、鏡頭恢復跟隨 */
  private endFocus(): void {
    const cfg = GameConfig.event.intro;
    this.focusPause = false;
    this.focusPanning = false;
    if (this.focusTarget) { this.focusTarget.setDepth(this.focusTargetDepth); this.focusTarget = null; }
    const dim = this.focusDim; this.focusDim = null;
    if (dim) this.scene.tweens.add({ targets: dim, fillAlpha: 0, duration: cfg.dimFadeSec * 1000, onComplete: () => dim.destroy() });
    const glow = this.focusGlow; this.focusGlow = null;
    if (glow) this.scene.tweens.add({ targets: glow, fillAlpha: 0, duration: cfg.dimFadeSec * 1000, onComplete: () => glow.destroy() });
    this.host.enableFollow(this.host.currentSlot());
  }

  // ===========================================================================
  // HUD
  // ===========================================================================

  /** 送出目前事件的 HUD（名稱、進度比例、剩餘時間） */
  private emitHud(): void {
    const now = this.scene.time.now;
    if (this.kindNow === 'tower') {
      this.emitHudPayload({ active: true, label: '塔 HP', ratio: this.tower ? this.tower.hpRatio() : 0, remainMs: Math.max(0, this.towerEndsAt - now) });
    } else if (this.kindNow === 'guard') {
      this.emitHudPayload({ active: true, label: '守護目標', ratio: this.guard ? this.guard.hpRatio() : 0, remainMs: Math.max(0, this.guardEndsAt - now) });
    } else if (this.kindNow === 'capture') {
      this.emitHudPayload({ active: true, label: '佔領', ratio: this.captureProgress / 100, remainMs: Math.max(0, this.captureEndsAt - now) });
    } else {
      this.emitHudPayload({ active: false, label: '', ratio: 0, remainMs: 0 });
    }
  }

  private emitHudPayload(payload: EventHudPayload): void {
    this.scene.game.events.emit('event-hud', payload);
  }

  // ===========================================================================
  // 塔
  // ===========================================================================

  /** 塔：限時到失敗；持續在塔周圍出怪；每 cycleMs 發一組四方大扇形（正十字、斜十字交替） */
  private updateTower(time: number): void {
    const cfg = GameConfig.event.tower;
    const tower = this.tower;
    if (!tower || !tower.active || tower.dead) return; // 打掉塔的成功由 onTowerDestroyed 處理
    if (time >= this.towerEndsAt) {
      this.host.clearTelegraphsOf('tower');
      this.complete(false);
      return;
    }
    if (time >= this.towerNextSpawnAt) {
      this.towerNextSpawnAt = time + cfg.spawnIntervalMs;
      const arena = this.host.arena();
      const batch = Math.max(1, Math.round(cfg.spawnBatch * this.difficulty));
      for (let k = 0; k < batch; k++) {
        const ang = Math.random() * Math.PI * 2;
        this.host.spawnSummonAt(
          Phaser.Math.Clamp(tower.x + Math.cos(ang) * TOWER_SUMMON_DISTANCE, arena.left + SUMMON_EDGE_MARGIN, arena.right - SUMMON_EDGE_MARGIN),
          Phaser.Math.Clamp(tower.y + Math.sin(ang) * TOWER_SUMMON_DISTANCE, arena.top + SUMMON_EDGE_MARGIN, arena.bottom - SUMMON_EDGE_MARGIN),
          time
        );
      }
    }
    if (time >= this.towerNextBlastAt) {
      const fb = cfg.fanBlast;
      this.towerNextBlastAt = time + fb.cycleMs;
      const baseDeg = this.towerBeamGroup === 0 ? 0 : 45;
      this.towerBeamGroup = 1 - this.towerBeamGroup;
      const arc = Phaser.Math.DegToRad(fb.arcDeg);
      for (let i = 0; i < fb.count; i++) {
        this.towerFanTelegraph(tower.x, tower.y, Phaser.Math.DegToRad(baseDeg + i * 90), arc, fb.radius, fb.fillMs, fb.damage);
      }
    }
  }

  /**
   * 塔的一個大扇形：先從塔往外填滿做預警，填滿時發射並判定命中。
   * 角色離塔不超過 radius（含角色半徑）且角度在扇形內 → 受傷並定身（無敵可擋）；站在兩扇形之間的縫隙可閃開
   *
   * @param ox 塔 x
   * @param oy 塔 y
   * @param centerAng 扇形中心角（弧度）
   * @param arc 扇形張角（弧度）
   * @param radius 扇形半徑
   * @param fillMs 預警填滿時間
   * @param dmg 命中傷害
   */
  private towerFanTelegraph(ox: number, oy: number, centerAng: number, arc: number, radius: number, fillMs: number, dmg: number): void {
    const g = this.scene.add.graphics().setDepth(TOWER_FAN_DEPTH);
    const half = arc / 2;
    const a0 = centerAng - half, a1 = centerAng + half;
    const drawFan = (gfx: Phaser.GameObjects.Graphics, r: number) => {
      gfx.beginPath();
      gfx.moveTo(ox, oy);
      gfx.arc(ox, oy, r, a0, a1, false);
      gfx.closePath();
    };
    // 登記預警（時停時暫停；塔消失時強制清除）
    const fx: TelegraphFx = { owner: 'tower', gfx: g, fired: false };
    this.host.addTelegraph(fx);
    const p = { t: 0 };
    fx.tween = this.scene.tweens.add({
      targets: p, t: 1, duration: fillMs,
      onUpdate: () => {
        g.clear();
        g.lineStyle(2, TOWER_FAN_COLOR, 0.5);
        drawFan(g, radius); g.strokePath();
        g.fillStyle(TOWER_FAN_COLOR, 0.30);
        drawFan(g, radius * p.t); g.fillPath();
      },
      onComplete: () => {
        fx.fired = true;
        this.host.removeTelegraph(fx);
        g.destroy();
        if (this.host.isGameOver() || !this.tower || !this.tower.active) return; // 塔已消失 → 不發射
        const blast = this.scene.add.graphics().setDepth(TOWER_BLAST_DEPTH);
        blast.fillStyle(TOWER_BLAST_COLOR, 0.5);
        blast.beginPath(); blast.moveTo(ox, oy); blast.arc(ox, oy, radius, a0, a1, false); blast.closePath(); blast.fillPath();
        this.scene.tweens.add({ targets: blast, alpha: 0, duration: TOWER_BLAST_FADE_MS, onComplete: () => blast.destroy() });
        this.host.shakeOnce(90, 0.006);
        for (const c of this.host.characters()) {
          if (!c.alive) continue;
          const rx = c.x - ox, ry = c.y - oy;
          if (Math.hypot(rx, ry) > radius + GameConfig.player.radius) continue;
          const diff = Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(ry, rx) - centerAng));
          if (diff <= half) this.host.damageCharacter(c, dmg, ox, oy, GameConfig.event.tower.fanBlast.rootMs);
        }
      }
    });
  }

  // ===========================================================================
  // 守護
  // ===========================================================================

  /**
   * 守護：目標被打倒失敗；高亮環跟隨目標；「上一波清空」或「出波間隔到」較早者出下一波（波種循環）；
   * 敵人碰到目標造成傷害（每隻怪有攻擊冷卻）；撐滿時間成功
   */
  private updateGuard(time: number): void {
    const cfg = GameConfig.event.guard;
    const npc = this.guard;
    if (!npc || !npc.active || npc.dead) {
      this.complete(false);
      return;
    }
    if (this.guardHighlight) {
      const hr = npc.getBodyRadius() + GUARD_HIGHLIGHT_GAP;
      const blink = Math.floor(time / GUARD_HIGHLIGHT_BLINK_MS) % 2 === 0;
      this.guardHighlight.clear();
      this.guardHighlight.lineStyle(3, GUARD_HIGHLIGHT_COLOR, blink ? 0.95 : 0.55);
      this.guardHighlight.strokeCircle(npc.x, npc.y, hr);
      this.guardHighlight.lineStyle(2, 0xffffff, 0.5);
      this.guardHighlight.strokeCircle(npc.x, npc.y, hr + 4);
    }

    const waves = cfg.waves;
    if (!this.guardWaveActive && time >= this.guardNextSpawnAt) {
      this.spawnGuardWave(this.guardWaveIdx % waves.length, time);
      this.guardWaveIdx++;
      this.guardGlobalWaveCount++;
      this.guardWaveActive = true;
      this.guardNextSpawnAt = time + cfg.waveSpawnIntervalMs;
    } else if (this.guardWaveActive) {
      const allGone = this.countGuardWaveAlive() === 0;
      if (allGone || time >= this.guardNextSpawnAt) {
        this.guardWaveActive = false;
        // 提前清空 → 下一幀立刻出波；間隔到則已過 guardNextSpawnAt，同樣下一幀出波
        if (allGone) this.guardNextSpawnAt = time;
      }
    }

    const contactR = npc.getBodyRadius() + cfg.contactRange;
    for (const child of this.host.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e === npc || e.enemyType === 'tower' || e.enemyType === 'npc') continue;
      if (!e.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, npc.x, npc.y) <= contactR) {
        if (time < e.nextNpcHitAt) continue;
        e.nextNpcHitAt = time + cfg.npcAttackCooldownMs;
        if (this.hitGuardNpc()) return;
      }
    }
    if (time >= this.guardEndsAt) this.complete(true);
  }

  /** 場上存活的一般怪數量（不含事件目標、寶箱怪、BOSS）；0 = 這一波清空 */
  private countGuardWaveAlive(): number {
    let n = 0;
    for (const child of this.host.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead) continue;
      if (!isRegularEnemy(e)) continue;
      n++;
    }
    return n;
  }

  /**
   * 生一波守護怪：左右兩側各生該波指定的怪種，沿該側縱向均分排開；守護波怪不受活動範圍限制，一直衝向目標。
   * 每種怪的數量 = 基準 perSide × 難度係數 + 循環加成，夾在 1 ~ waveCountCap
   *
   * @param waveIdx 波種索引
   * @param time 目前場景時間
   */
  private spawnGuardWave(waveIdx: number, time: number): void {
    const cfg = GameConfig.event.guard;
    const wave = cfg.waves[waveIdx];
    if (!wave) return;
    const arena = this.host.arena();
    const inset = GameConfig.spawn.edgeInset;
    const leftX = arena.left + cfg.sideMargin;
    const rightX = arena.right - cfg.sideMargin;
    const yTop = arena.top + inset;
    const yBot = arena.bottom - inset;

    // 每跑完一輪波種（wavesPerCycle 波），每種怪每側多 waveCountStep 隻
    const cyclesDone = Math.floor((this.guardGlobalWaveCount - 1) / cfg.wavesPerCycle);
    const bonus = Math.round(Math.max(0, cyclesDone) * cfg.waveCountStep * this.difficulty);

    for (const side of [leftX, rightX]) {
      const entries: string[] = [];
      for (const spec of wave) {
        const baseCount = Math.round(spec.perSide * this.difficulty);
        const n = Phaser.Math.Clamp(baseCount + bonus, 1, cfg.waveCountCap);
        for (let i = 0; i < n; i++) entries.push(spec.type);
      }
      const n = entries.length;
      for (let i = 0; i < n; i++) {
        const t = n > 1 ? i / (n - 1) : 0.5;
        const y = Phaser.Math.Clamp(yTop + (yBot - yTop) * t + Phaser.Math.Between(-GUARD_SPAWN_JITTER_Y, GUARD_SPAWN_JITTER_Y), yTop, yBot);
        this.host.spawnSummonAt(side, y, time, entries[i] as EnemyType, true, true);
      }
    }
  }

  // ===========================================================================
  // 佔領
  // ===========================================================================

  /**
   * 佔領：圈內沒怪了就排下一波（被擊退出圈也算）；P1 在圈內且圈內無怪時累積進度；
   * 圈依狀態變色；進度滿成功，時間到失敗
   */
  private updateCapture(time: number): void {
    const cfg = GameConfig.event.capture;
    const cx = this.captureCx;
    const cy = this.captureCy;
    const R = cfg.captureRadius;

    let enemiesIn = 0;
    for (const child of this.host.enemies.getChildren()) {
      const e = child as Enemy;
      if (!e.active || !e.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(e.x, e.y, cx, cy) <= R) enemiesIn++;
    }

    if (this.captureWaveActive) {
      if (enemiesIn === 0) {
        this.captureWaveActive = false;
        this.captureNextWaveAt = time + cfg.waveGapMs;
      }
    } else if (time >= this.captureNextWaveAt) {
      // 整波生在圈內（面積均勻分布）
      const arena = this.host.arena();
      const size = Math.max(1, Math.round(cfg.waveSize * this.difficulty));
      for (let i = 0; i < size; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * R * cfg.spawnInsideRatio;
        this.host.spawnSummonAt(
          Phaser.Math.Clamp(cx + Math.cos(a) * rr, arena.left + SUMMON_EDGE_MARGIN, arena.right - SUMMON_EDGE_MARGIN),
          Phaser.Math.Clamp(cy + Math.sin(a) * rr, arena.top + SUMMON_EDGE_MARGIN, arena.bottom - SUMMON_EDGE_MARGIN),
          time
        );
      }
      this.captureWaveActive = true;
    }

    const p = this.host.player();
    const playerIn = p.alive && Phaser.Math.Distance.Between(p.x, p.y, cx, cy) <= R;
    if (playerIn && enemiesIn === 0) {
      this.captureProgress = Math.min(100, this.captureProgress + cfg.progressPerSec * CAPTURE_TICK_SEC);
    }
    if (this.captureGfx) {
      this.captureGfx.clear();
      const col = (playerIn && enemiesIn === 0) ? CAPTURE_COLOR_PROGRESS : (playerIn ? CAPTURE_COLOR_CONTESTED : CAPTURE_COLOR_IDLE);
      this.captureGfx.lineStyle(3, col, 0.85);
      this.captureGfx.strokeCircle(cx, cy, R);
      this.captureGfx.fillStyle(col, 0.08);
      this.captureGfx.fillCircle(cx, cy, R);
    }
    if (this.captureProgress >= 100) {
      this.complete(true);
      return;
    }
    if (time >= this.captureEndsAt) this.complete(false);
  }
}
