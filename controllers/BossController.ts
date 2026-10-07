import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { BossSkillKind, Enemy } from '../objects/Enemy';
import type { TelegraphFx } from '../systems/telegraphFx';

/**
 * BossController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface BossHost {
  /** 擁有者場景（建立圖形、tween、計時器用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（BOSS 從這裡取用；變身攻擊對其中的敵人結算） */
  readonly enemies: Phaser.Physics.Arcade.Group;
  /** 目前的移動區（BOSS 登場位置、衝刺終點與掉落位置的夾限） */
  arena(): Phaser.Geom.Rectangle;
  /** 全部角色（招式傷害判定用） */
  characters(): ReadonlyArray<Character>;
  /** P1 */
  player(): Character;
  isGameOver(): boolean;
  /** 是否為慢速模式（只有慢速模式會留 BOSS 屍體、可變身） */
  isSlowMode(): boolean;
  /** 掛上一般敵人的攻擊回呼（近戰 / 射擊 / 雷射 / 投彈） */
  wireEnemyCallbacks(enemy: Enemy): void;
  /** 登記 / 移除 / 清除場景層級的預警特效 */
  addTelegraph(fx: TelegraphFx): void;
  removeTelegraph(fx: TelegraphFx): void;
  clearTelegraphsOf(owner: TelegraphFx['owner']): void;
  /** 對角色造成傷害（rootMs > 0 時附帶定身） */
  damageCharacter(c: Character, amount: number, fromX: number, fromY: number, rootMs: number): void;
  /** 角色對敵人造成傷害（走場景的擊殺結算） */
  damageEnemy(actor: Character, enemy: Enemy, damage: number, knockback: number, time: number): void;
  /** 命中觸發 COMBO 獎勵累積 */
  triggerComboHit(actor: Character): void;
  dropItemAt(x: number, y: number, time: number): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  shakeOnce(duration: number, intensity: number): void;
  spawnDeathBurst(x: number, y: number): void;
  showEventBanner(text: string): void;
  emitStats(): void;
  /** 非亂入的波次 BOSS 被打倒後，由場景決定通關 / 轉場 / 過關 */
  onWaveBossDefeated(): void;
}

/** 亂入 BOSS 被打倒後留下的屍體：expireAt 前 P1 靠近按 Z 可變身 */
interface BossCorpse {
  img: Phaser.GameObjects.Image;
  hint: Phaser.GameObjects.Text;
  expireAt: number;
}

/** P1 變身 BOSS 的狀態 */
interface BossForm {
  until: number;
  /** 目前累積的範圍普攻命中次數（達 fanEvery 後下一擊為扇形） */
  normalHits: number;
  img: Phaser.GameObjects.Image;
  timer: Phaser.GameObjects.Text;
}

/** BOSS HUD 事件內容（UIScene 的 BOSS 提示大字） */
interface BossHudPayload {
  active: boolean;
  /** 亂入 BOSS 的剩餘秒數；非亂入為 null */
  secondsLeft: number | null;
}

/** 登場 / 離場 / 變身提示文字樣式 */
const BANNER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '46px', color: '#ff3355', stroke: '#000000', strokeThickness: 7, fontStyle: 'bold'
};
/** BOSS 頭上小字（彩票、屍體提示、變身倒數）樣式 */
const OVERHEAD_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '26px', color: '#ffd166', stroke: '#000000', strokeThickness: 5, fontStyle: 'bold'
};
/** 招式預警顏色：範圍 / 衝刺用紅、扇形用橘 */
const TELEGRAPH_RED = 0xff3355;
const TELEGRAPH_ORANGE = 0xffaa33;
/** 預警填色與輪廓透明度 */
const TELEGRAPH_FILL_ALPHA = 0.28;
const TELEGRAPH_LINE_ALPHA = 0.6;
/** 預警圖形深度（地面之上、角色之下） */
const TELEGRAPH_DEPTH = 4;

/**
 * BOSS 系統：波次 / 亂入 BOSS 的登場、三招輪替（範圍普攻 → 直線衝刺 → 扇形）、限時離場、
 * 命中掉彩票、擊倒後的屍體，以及 P1 變身 BOSS（範圍普攻、命中 fanEvery 次後扇形）。
 *
 * 場景每幀呼叫 update()，並在對應時機呼叫 onBossHit / onBossKilled / onZoneLeave 等。
 */
export class BossController {
  /** 目前場上的 BOSS（沒有為 null） */
  private boss: Enemy | null = null;
  /** 已登場的波次 BOSS 數（HP 成長用；亂入 BOSS 不計） */
  private waveBossCount = 0;
  /** 累積對 BOSS 的傷害，每跨過 dropEveryDamage 就噴一個道具 */
  private damageAccum = 0;
  /** 亂入 BOSS 的離場時間；0 = 場上的 BOSS 不是亂入（或沒有 BOSS） */
  private intruderLeaveAt = 0;
  private corpse: BossCorpse | null = null;
  private form: BossForm | null = null;

  constructor(private readonly host: BossHost) {}

  /** 目前場上的 BOSS */
  get current(): Enemy | null {
    return this.boss;
  }

  /** 場上的 BOSS 是否為限時亂入 BOSS */
  get isIntruder(): boolean {
    return this.intruderLeaveAt > 0 && this.boss !== null;
  }

  /** P1 是否正在變身 BOSS */
  get isTransformed(): boolean {
    return this.form !== null;
  }

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /**
   * 生成 BOSS（從場地中央登場）+ 登場提示 + HUD
   *
   * @param intruder true = 小關卡中的限時亂入 BOSS：固定 HP（stage.bossIntrude.hp）、不擋通關、時間到離場
   */
  spawn(intruder = false): void {
    const b = GameConfig.boss;
    const intrude = GameConfig.stage.bossIntrude;
    // HP 倍率：亂入 BOSS 換算成固定 HP；波次 BOSS 隨序號成長
    let hpMult = intrude.hp / b.baseHp;
    if (!intruder) {
      this.waveBossCount++;
      hpMult = 1 + (this.waveBossCount - 1) * b.hpGrowthPerBoss;
    }
    const now = this.scene.time.now;
    const arena = this.host.arena();
    const bx = arena.centerX, by = arena.centerY;
    const boss = this.host.enemies.get(bx, by) as Enemy | null;
    if (!boss) return;
    this.intruderLeaveAt = intruder ? now + intrude.durationMs : 0;
    this.host.wireEnemyCallbacks(boss);
    boss.onBossSkill = this.onBossSkill;
    boss.spawn(bx, by, now, 'boss', hpMult);
    boss.setScale(1);
    this.boss = boss;
    this.damageAccum = 0;
    const txt = this.scene.add
      .text(GameConfig.width / 2, GameConfig.height * 0.32, intruder ? 'BOSS 亂入！' : 'BOSS 出現！', BANNER_STYLE)
      .setOrigin(0.5)
      .setScrollFactor(0) // 固定畫面：鏡頭捲動時仍置中
      .setDepth(60)
      .setAlpha(0);
    this.scene.tweens.add({ targets: txt, alpha: 1, scale: { from: 0.6, to: 1.1 }, duration: 400, yoyo: true, hold: 800, onComplete: () => txt.destroy() });
    this.host.shakeOnce(200, 0.01);
    this.emitHud();
    this.host.emitStats();
  }

  /**
   * 每幀更新：HUD 倒數、亂入 BOSS 離場、屍體逾時、變身外觀與結束
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    this.emitHud();
    if (this.intruderLeaveAt > 0 && time >= this.intruderLeaveAt) this.dismissIntruder(true);
    if (this.corpse && time >= this.corpse.expireAt) this.clearCorpse();
    this.updateForm(time);
  }

  /**
   * 時停結束：亂入 BOSS 的離場倒數順延凍結時間
   *
   * @param frozenMs 凍結時長
   */
  onTimeStopEnd(frozenMs: number): void {
    if (this.intruderLeaveAt > 0) this.intruderLeaveAt += frozenMs;
  }

  /** 換區時：亂入 BOSS 離場、屍體消失 */
  onZoneLeave(): void {
    this.dismissIntruder(false);
    this.clearCorpse();
  }

  /** 作弊清場：BOSS 已由場景隨一般怪一起移除，這裡只收掉狀態與 HUD */
  forgetBoss(): void {
    if (!this.boss) return;
    this.boss = null;
    this.intruderLeaveAt = 0;
    this.emitHidden();
  }

  /**
   * BOSS 被角色命中（非擊殺結算前）：累積傷害噴道具；亂入 BOSS 依機率掉彩票給命中者
   *
   * @param actor 命中的角色
   * @param boss 被命中的 BOSS
   * @param damage 實際傷害
   * @param time 目前場景時間
   */
  onBossHit(actor: Character, boss: Enemy, damage: number, time: number): void {
    this.accumDamageDrop(damage, time);
    if (this.intruderLeaveAt > 0 && !boss.dead) this.rollHitTicket(actor, boss);
  }

  /**
   * BOSS 被擊殺：大爆炸 + 掉多個道具；亂入 BOSS 留下屍體（不擋通關），波次 BOSS 交給場景決定後續
   *
   * @param bx 擊殺位置 x
   * @param by 擊殺位置 y
   */
  onBossKilled(bx: number, by: number): void {
    const intruder = this.intruderLeaveAt > 0;
    this.intruderLeaveAt = 0;
    this.boss = null;
    this.host.clearTelegraphsOf('boss'); // 清掉蓄力中的招式預警並取消發射
    this.emitHidden();
    const cfg = GameConfig.boss;
    this.host.spawnExpandingRing(bx, by, cfg.skills.a.radius * 1.4, 0xffd700, 500);
    this.host.shakeOnce(300, 0.014);
    for (let i = 0; i < 12; i++) this.host.spawnDeathBurst(bx + Phaser.Math.Between(-40, 40), by + Phaser.Math.Between(-40, 40));
    // 道具掉在 dropDist 外圈，避免被 BOSS 身體擋住撿不到
    const arena = this.host.arena();
    for (let i = 0; i < cfg.dropCount; i++) {
      const ang = (i / cfg.dropCount) * Math.PI * 2;
      const dx = Phaser.Math.Clamp(bx + Math.cos(ang) * cfg.dropDist, arena.left + 20, arena.right - 20);
      const dy = Phaser.Math.Clamp(by + Math.sin(ang) * cfg.dropDist, arena.top + 20, arena.bottom - 20);
      this.host.dropItemAt(dx, dy, this.scene.time.now);
    }
    if (intruder) {
      this.spawnCorpse(bx, by);
      return;
    }
    this.host.onWaveBossDefeated();
  }

  /**
   * P1 在 BOSS 屍體 reachDist 內時變身 BOSS
   *
   * @returns 是否變身成功（false 時 Z 照舊處理強化）
   */
  tryTransform(): boolean {
    const corpse = this.corpse;
    const p = this.host.player();
    if (!corpse || !p || !p.alive || this.form) return false;
    if (Phaser.Math.Distance.Between(p.x, p.y, corpse.img.x, corpse.img.y) > GameConfig.boss.transform.reachDist) return false;
    this.startForm();
    return true;
  }

  /**
   * 變身 BOSS 的攻擊（按下立即出招、有冷卻）：平常是以自己為中心的範圍普攻；
   * 普攻累積命中 fanEvery 次後，下一擊自動變成朝面向的扇形攻擊，之後重新計數
   *
   * @param time 目前場景時間
   */
  formAttack(time: number): void {
    const form = this.form;
    const p = this.host.player();
    if (!form || time < p.nextAttackAllowedAt) return;
    const cfg = GameConfig.boss.transform;
    p.nextAttackAllowedAt = time + cfg.attackCooldownMs;
    const useFan = form.normalHits >= cfg.fanEvery;
    const half = Phaser.Math.DegToRad(cfg.fan.arcDeg) / 2;
    const range = useFan ? cfg.fan.range : cfg.normal.radius;
    const damage = useFan ? cfg.fan.damage : cfg.normal.damage;
    let hitCount = 0;
    for (const child of this.host.enemies.getChildren()) {
      const enemy = child as Enemy;
      if (!enemy.active || enemy.dead || !enemy.isVulnerable()) continue;
      if (Phaser.Math.Distance.Between(p.x, p.y, enemy.x, enemy.y) > range + enemy.getBodyRadius()) continue;
      if (useFan) {
        const diff = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(p.x, p.y, enemy.x, enemy.y) - p.aimAngle));
        if (diff > half) continue;
      }
      this.host.damageEnemy(p, enemy, damage, cfg.knockback, time);
      hitCount++;
    }
    if (hitCount > 0) this.host.triggerComboHit(p); // COMBO 獎勵照常累積（命中觸發）
    if (useFan) {
      form.normalHits = 0;
      this.spawnFanFlash(p.x, p.y, p.aimAngle, range, half, TELEGRAPH_ORANGE);
      this.host.shakeOnce(120, 0.008);
    } else {
      if (hitCount > 0) form.normalHits++;
      this.host.spawnExpandingRing(p.x, p.y, range, TELEGRAPH_RED, 260);
    }
  }

  /**
   * 除錯：直接施放指定招式（需有 BOSS 在場）
   *
   * @param kind 招式
   */
  debugCast(kind: BossSkillKind): void {
    const boss = this.boss;
    if (!boss || !boss.active) return;
    const p = this.host.player();
    this.onBossSkill(boss, kind, p.x, p.y);
  }

  /**
   * 除錯：暫停 / 恢復 BOSS 自動輪替招式
   *
   * @param paused 是否暫停
   */
  debugPauseSkills(paused: boolean): void {
    if (this.boss) this.boss.bossSkillsPaused = paused;
  }

  // ---------------------------------------------------------------------------
  // 亂入 BOSS：HUD、離場、命中掉彩票、噴道具
  // ---------------------------------------------------------------------------

  /** 更新 BOSS 提示（不顯示血量）：亂入 BOSS 附上離場倒數秒數 */
  private emitHud(): void {
    const boss = this.boss;
    if (!boss || !boss.active || boss.dead) return;
    const secondsLeft = this.intruderLeaveAt > 0
      ? Math.ceil(Math.max(0, this.intruderLeaveAt - this.scene.time.now) / 1000)
      : null;
    const payload: BossHudPayload = { active: true, secondsLeft };
    this.scene.game.events.emit('boss-hud', payload);
  }

  /** 隱藏 BOSS 提示 */
  private emitHidden(): void {
    const payload: BossHudPayload = { active: false, secondsLeft: null };
    this.scene.game.events.emit('boss-hud', payload);
  }

  /**
   * 亂入 BOSS 離場（淡出、無獎勵）：時間到或換區時呼叫；場上沒有亂入 BOSS 時不做事
   *
   * @param timeUp true = 時間到（顯示離場橫幅）；false = 換區時順便帶走
   */
  private dismissIntruder(timeUp: boolean): void {
    const boss = this.boss;
    if (this.intruderLeaveAt <= 0 || !boss) return;
    this.intruderLeaveAt = 0;
    this.boss = null;
    this.host.clearTelegraphsOf('boss');
    this.emitHidden();
    boss.dead = true; // 立即不可再被命中，淡出後才關閉物理
    this.scene.tweens.add({
      targets: boss, alpha: 0, duration: GameConfig.stage.bossIntrude.leaveFadeMs,
      onComplete: () => { if (boss.dead) boss.disableBody(true, true); } // 淡出期間被物件池重用時不關閉
    });
    if (timeUp) this.host.showEventBanner('BOSS 離開了…');
  }

  /**
   * 亂入 BOSS 被命中時，依機率掉彩票給命中的角色（BOSS 頭上飄出「+N 🎫」）
   *
   * @param actor 命中的角色
   * @param boss 被命中的 BOSS
   */
  private rollHitTicket(actor: Character, boss: Enemy): void {
    const cfg = GameConfig.stage.bossIntrude;
    if (Math.random() >= cfg.hitTicketChance) return;
    actor.credit += cfg.hitTickets;
    const txt = this.scene.add.text(boss.x, boss.y - boss.getBodyRadius(), `+${cfg.hitTickets} 🎫`, OVERHEAD_STYLE)
      .setOrigin(0.5).setDepth(40);
    this.scene.tweens.add({ targets: txt, y: txt.y - 60, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
  }

  /**
   * 打 BOSS 過程噴道具：累積傷害每跨過 dropEveryDamage，就在 BOSS 外圈隨機方向掉 1 個道具
   *
   * @param damage 本次傷害
   * @param time 目前場景時間
   */
  private accumDamageDrop(damage: number, time: number): void {
    const boss = this.boss;
    const cfg = GameConfig.boss;
    if (!boss || !boss.active || cfg.dropEveryDamage <= 0) return;
    this.damageAccum += damage;
    const arena = this.host.arena();
    while (this.damageAccum >= cfg.dropEveryDamage) {
      this.damageAccum -= cfg.dropEveryDamage;
      const ang = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const rad = cfg.dropDist + Phaser.Math.Between(-cfg.dropScatter * 0.4, cfg.dropScatter * 0.4);
      const dx = Phaser.Math.Clamp(boss.x + Math.cos(ang) * rad, arena.left + 20, arena.right - 20);
      const dy = Phaser.Math.Clamp(boss.y + Math.sin(ang) * rad, arena.top + 20, arena.bottom - 20);
      this.host.dropItemAt(dx, dy, time);
    }
  }

  // ---------------------------------------------------------------------------
  // 屍體與變身 BOSS
  // ---------------------------------------------------------------------------

  /**
   * 留下亂入 BOSS 的屍體（只限慢速模式）：灰色 BOSS 圖 + 上方「按 Z 變成 BOSS」提示，transform.corpseMs 後消失
   *
   * @param x 屍體位置 x
   * @param y 屍體位置 y
   */
  private spawnCorpse(x: number, y: number): void {
    if (!this.host.isSlowMode()) return;
    this.clearCorpse();
    const cfg = GameConfig.boss.transform;
    const img = this.scene.add.image(x, y, 'enemy-boss').setTint(cfg.corpseTint).setAlpha(cfg.corpseAlpha).setDepth(5);
    const hint = this.scene.add.text(x, y - GameConfig.boss.radius - 30, '按 Z 變成 BOSS', OVERHEAD_STYLE)
      .setOrigin(0.5).setDepth(41);
    this.scene.tweens.add({ targets: hint, alpha: 0.35, duration: 450, yoyo: true, repeat: -1 });
    this.corpse = { img, hint, expireAt: this.scene.time.now + cfg.corpseMs };
  }

  /** 移除 BOSS 屍體（逾時、變身或換區時） */
  private clearCorpse(): void {
    if (!this.corpse) return;
    this.scene.tweens.killTweensOf(this.corpse.hint);
    this.corpse.img.destroy();
    this.corpse.hint.destroy();
    this.corpse = null;
  }

  /** 開始變身 BOSS：P1 換成 BOSS 外觀、無敵 durationMs，頭上顯示剩餘秒數 */
  private startForm(): void {
    const cfg = GameConfig.boss.transform;
    const p = this.host.player();
    this.clearCorpse();
    const until = this.scene.time.now + cfg.durationMs;
    p.invulnUntil = Math.max(p.invulnUntil, until);
    p.setAlpha(0); // 原角色隱藏，由 BOSS 圖代替顯示（物理本體不變）
    const img = this.scene.add.image(p.x, p.y, 'enemy-boss').setDepth(p.depth + 1);
    const timer = this.scene.add.text(p.x, p.y - GameConfig.boss.radius - 22, '', { ...OVERHEAD_STYLE, fontSize: '22px' })
      .setOrigin(0.5).setDepth(41);
    this.form = { until, normalHits: 0, img, timer };
    this.host.spawnExpandingRing(p.x, p.y, cfg.normal.radius, 0xffd700, 400);
    this.host.showEventBanner('變身 BOSS！');
  }

  /**
   * 每幀更新變身 BOSS：外觀與倒數跟著 P1，時間到或 P1 倒下時變回原角色
   *
   * @param time 目前場景時間
   */
  private updateForm(time: number): void {
    const form = this.form;
    if (!form) return;
    const p = this.host.player();
    if (time >= form.until || !p.alive) {
      this.endForm();
      return;
    }
    form.img.setPosition(p.x, p.y);
    form.timer.setPosition(p.x, p.y - GameConfig.boss.radius - 22).setText(`BOSS ${Math.ceil((form.until - time) / 1000)}s`);
  }

  /** 結束變身 BOSS，變回原角色 */
  private endForm(): void {
    const form = this.form;
    if (!form) return;
    this.form = null;
    form.img.destroy();
    form.timer.destroy();
    const p = this.host.player();
    if (p.alive) p.setAlpha(1);
    this.host.spawnExpandingRing(p.x, p.y, GameConfig.boss.radius * 2, 0xffffff, 300);
  }

  /**
   * 扇形閃光特效（填滿後淡出）
   *
   * @param x 圓心 x
   * @param y 圓心 y
   * @param angle 扇形中心方向（弧度）
   * @param range 半徑
   * @param half 半角（弧度）
   * @param color 顏色
   */
  private spawnFanFlash(x: number, y: number, angle: number, range: number, half: number, color: number): void {
    const g = this.scene.add.graphics().setDepth(TELEGRAPH_DEPTH);
    g.fillStyle(color, 0.45);
    g.slice(x, y, range, angle - half, angle + half, false);
    g.fillPath();
    this.scene.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
  }

  // ---------------------------------------------------------------------------
  // BOSS 招式
  // ---------------------------------------------------------------------------

  /**
   * BOSS 三招輪替總入口（a 範圍普攻 → b 直線衝刺 → c 扇形攻擊）：蓄力期間與衝刺中 BOSS 不移動；
   * 招式完全放完後才排下一招（gapMs 從放完起算，時停凍結蓄力時也跟著順延）
   *
   * @param boss 施放的 BOSS
   * @param kind 招式
   * @param tx 施放當下目標 x（b / c 瞄準用）
   * @param ty 施放當下目標 y
   */
  private readonly onBossSkill = (boss: Enemy, kind: BossSkillKind, tx: number, ty: number): void => {
    if (this.host.isGameOver() || !boss.active) return;
    boss.bossCasting = true;
    const done = (): void => {
      boss.bossCasting = false;
      if (this.boss === boss && boss.active) boss.scheduleBossNextAttack(this.scene.time.now + GameConfig.boss.skills.gapMs);
    };
    if (kind === 'a') this.castRange(boss, done);
    else if (kind === 'b') this.castDash(boss, tx, ty, done);
    else this.castFan(boss, tx, ty, done);
  };

  /**
   * 登記一個 BOSS 招式預警：chargeMs 內每幀呼叫 draw(進度 0..1)，填滿後銷毀圖形並呼叫 release
   *
   * @param draw 依進度重畫預警
   * @param release 預警填滿時呼叫
   */
  private telegraph(draw: (g: Phaser.GameObjects.Graphics, t: number) => void, release: () => void): void {
    const g = this.scene.add.graphics().setDepth(TELEGRAPH_DEPTH);
    const fx: TelegraphFx = { owner: 'boss', gfx: g, fired: false };
    this.host.addTelegraph(fx);
    const p = { t: 0 };
    fx.tween = this.scene.tweens.add({
      targets: p, t: 1, duration: GameConfig.boss.skills.chargeMs,
      onUpdate: () => { g.clear(); draw(g, p.t); },
      onComplete: () => {
        fx.fired = true;
        this.host.removeTelegraph(fx);
        g.destroy();
        release();
      }
    });
  }

  /**
   * 對符合 pred 的存活角色結算招式傷害（無敵擋傷），命中附帶定身 skillRootMs
   *
   * @param pred 命中判定
   * @param damage 傷害
   */
  private releaseDamage(pred: (c: Character) => boolean, damage: number): void {
    const now = this.scene.time.now;
    for (const c of this.host.characters()) {
      if (!c.alive || c.isInvulnerable(now)) continue;
      if (pred(c)) this.host.damageCharacter(c, damage, c.x, c.y, GameConfig.boss.skillRootMs);
    }
  }

  /**
   * 招 a 範圍普攻：以 BOSS 為中心的圓形，由內而外填滿預警 → 圓內角色扣血
   *
   * @param boss 施放的 BOSS
   * @param onDone 招式放完時呼叫
   */
  private castRange(boss: Enemy, onDone: () => void): void {
    const s = GameConfig.boss.skills.a;
    const ox = boss.x, oy = boss.y;
    this.telegraph((g, t) => {
      g.lineStyle(2, TELEGRAPH_RED, TELEGRAPH_LINE_ALPHA); g.strokeCircle(ox, oy, s.radius);
      g.fillStyle(TELEGRAPH_RED, TELEGRAPH_FILL_ALPHA); g.fillCircle(ox, oy, s.radius * t);
    }, () => {
      onDone();
      if (this.host.isGameOver() || !boss.active) return;
      this.host.spawnExpandingRing(ox, oy, s.radius, TELEGRAPH_RED, 300);
      this.host.shakeOnce(120, 0.008);
      this.releaseDamage(c => Phaser.Math.Distance.Between(c.x, c.y, ox, oy) <= s.radius, s.damage);
    });
  }

  /**
   * 招 b 直線衝刺：蓄力期間顯示朝目標方向的直線預警（由起點往終點填滿），
   * 放出時直線內角色扣血，BOSS 沿線衝到終點（衝刺 dashMs，終點夾在場內）
   *
   * @param boss 施放的 BOSS
   * @param tx 瞄準點 x
   * @param ty 瞄準點 y
   * @param onDone 衝刺結束時呼叫
   */
  private castDash(boss: Enemy, tx: number, ty: number, onDone: () => void): void {
    const s = GameConfig.boss.skills.b;
    const arena = this.host.arena();
    const ox = boss.x, oy = boss.y;
    const ang = Phaser.Math.Angle.Between(ox, oy, tx, ty);
    const inset = GameConfig.boss.radius;
    const ex = Phaser.Math.Clamp(ox + Math.cos(ang) * s.length, arena.left + inset, arena.right - inset);
    const ey = Phaser.Math.Clamp(oy + Math.sin(ang) * s.length, arena.top + inset, arena.bottom - inset);
    const len = Phaser.Math.Distance.Between(ox, oy, ex, ey);
    const halfW = s.width / 2;
    // 直線帶的四個角：起點與目前填滿位置，各沿垂直方向 ±halfW
    const nx = -Math.sin(ang) * halfW, ny = Math.cos(ang) * halfW;
    const strip = (t: number): Phaser.Math.Vector2[] => {
      const px = ox + (ex - ox) * t, py = oy + (ey - oy) * t;
      return [new Phaser.Math.Vector2(ox + nx, oy + ny), new Phaser.Math.Vector2(px + nx, py + ny),
        new Phaser.Math.Vector2(px - nx, py - ny), new Phaser.Math.Vector2(ox - nx, oy - ny)];
    };
    this.telegraph((g, t) => {
      g.lineStyle(2, TELEGRAPH_RED, TELEGRAPH_LINE_ALPHA); g.strokePoints(strip(1), true);
      g.fillStyle(TELEGRAPH_RED, TELEGRAPH_FILL_ALPHA); g.fillPoints(strip(t), true);
    }, () => {
      if (this.host.isGameOver() || !boss.active) { onDone(); return; }
      this.host.shakeOnce(120, 0.008);
      const hitR = halfW + GameConfig.player.radius;
      this.releaseDamage(c => distanceToSegment(c.x, c.y, ox, oy, ex, ey) <= hitR, s.damage);
      boss.startBossDash(ang, len / (s.dashMs / 1000), s.dashMs, this.scene.time.now);
      this.scene.time.delayedCall(s.dashMs, onDone);
    });
  }

  /**
   * 招 c 扇形攻擊：朝施放當下目標方向的 arcDeg 扇形，由內而外填滿 → 扇形內角色扣血
   *
   * @param boss 施放的 BOSS
   * @param tx 瞄準點 x
   * @param ty 瞄準點 y
   * @param onDone 招式放完時呼叫
   */
  private castFan(boss: Enemy, tx: number, ty: number, onDone: () => void): void {
    const s = GameConfig.boss.skills.c;
    const ox = boss.x, oy = boss.y;
    const center = Phaser.Math.Angle.Between(ox, oy, tx, ty);
    const half = Phaser.Math.DegToRad(s.arcDeg) / 2;
    const inArc = (c: Character): boolean => {
      if (Phaser.Math.Distance.Between(c.x, c.y, ox, oy) > s.range) return false;
      const diff = Math.abs(Phaser.Math.Angle.Wrap(Phaser.Math.Angle.Between(ox, oy, c.x, c.y) - center));
      return diff <= half;
    };
    this.telegraph((g, t) => {
      g.lineStyle(2, TELEGRAPH_ORANGE, TELEGRAPH_LINE_ALPHA);
      g.beginPath(); g.arc(ox, oy, s.range, center - half, center + half, false); g.strokePath();
      g.fillStyle(TELEGRAPH_ORANGE, TELEGRAPH_FILL_ALPHA);
      g.slice(ox, oy, s.range * t, center - half, center + half, false);
      g.fillPath();
    }, () => {
      onDone();
      if (this.host.isGameOver() || !boss.active) return;
      this.host.spawnExpandingRing(ox, oy, s.range, TELEGRAPH_ORANGE, 260);
      this.host.shakeOnce(120, 0.008);
      this.releaseDamage(inArc, s.damage);
    });
  }
}

/**
 * 點 (x, y) 到線段 (x1, y1)-(x2, y2) 的最短距離
 */
function distanceToSegment(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq > 0 ? Phaser.Math.Clamp(((x - x1) * dx + (y - y1) * dy) / lenSq, 0, 1) : 0;
  return Phaser.Math.Distance.Between(x, y, x1 + dx * t, y1 + dy * t);
}
