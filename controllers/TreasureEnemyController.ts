import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';

/** 本波生怪進度（決定寶箱怪是否可能出現） */
export interface WaveProgress {
  /** 本波已出了幾次隊形 */
  formations: number;
  quota: number;
  spawned: number;
}

/**
 * TreasureEnemyController 需要場景提供的能力。由 GameScene 建立並傳入；控制器不直接存取場景私有成員。
 */
export interface TreasureEnemyHost {
  /** 擁有者場景（特效、tween 用） */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（之後才建立，用時才取） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** 目前的移動區 */
  arena(): Phaser.Geom.Rectangle;
  /** P1（寶箱怪出生點避開玩家） */
  player(): Character;
  /** 時停中（寶箱怪也凍結） */
  isTimeStopped(): boolean;
  /** 限時事件進行中（不生寶箱怪） */
  isEventActive(): boolean;
  waveProgress(): WaveProgress;
  flashEnemy(enemy: Enemy): void;
  spawnDamageText(x: number, y: number, amount: number): void;
  spawnExpandingRing(x: number, y: number, radius: number, color: number, ms?: number): void;
  shakeOnce(duration: number, intensity: number): void;
}

/** 波次生怪進度達配額的這個比例後才可能出現寶箱怪（避開首次生怪） */
const SPAWN_MIN_WAVE_FRACTION = 0.35;
/** 出生點：離移動區邊緣的距離、離 P1 的最小距離、嘗試次數 */
const SPAWN_EDGE_MARGIN = 20;
const SPAWN_AVOID_PLAYER = 120;
const SPAWN_TRIES = 20;
/** 跑點移動：到點判定距離 */
const MOVE_ARRIVE_PX = 16;
/** 跑走速度倍率與淡出時間：限時到自己跑走 / 換區前立即逃走 */
const FLEE_SPEED_MULT = 1.4;
const FLEE_FADE_MS = 700;
const FLEE_NOW_SPEED_MULT = 1.6;
const FLEE_NOW_FADE_MS = 500;
/** 金光閃爍：週期因子（tint）與光暈脈動週期因子 */
const TINT_PULSE_PERIOD = 140;
const GLOW_PULSE_PERIOD = 220;
/** 金色粒子環繞半徑 */
const SPARK_ORBIT_RADIUS = 30;
/** 打倒時的擴散圈與震動 */
const DEATH_RING_RADIUS = 100;
const DEATH_RING_COLOR = 0xffd700;
const DEATH_RING_MS = 450;
/** 出現提示橫幅樣式與位置 */
const BANNER_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '34px', color: '#ffe86a', stroke: '#000', strokeThickness: 5, fontStyle: 'bold'
};
const BANNER_Y_RATIO = 0.24;
const BANNER_DEPTH = 31;
/** 頭上彩票數字樣式 */
const TICKET_TEXT_STYLE: Phaser.Types.GameObjects.Text.TextStyle = {
  fontFamily: 'monospace', fontSize: '26px', color: '#ffd166', stroke: '#000000', strokeThickness: 5, fontStyle: 'bold'
};
const TICKET_TEXT_DEPTH = 40;
/** 金幣噴散深度 */
const COIN_DEPTH = 21;

/**
 * 寶箱怪：
 * - 關卡中：波次生怪時依機率出現（場上只會有一隻，限時事件期間與每波首次生怪不出），出現時顯示提示橫幅並加上金光與粒子；
 *   在場內跑點（衝到隨機點 → 停頓 → 再衝），限時沒打死就朝最近的牆跑走。換區前直接逃走、換區時清掉
 * - 獎勵關：從財寶裝飾跳出（可多隻、不限時），每次命中與打倒給命中者彩票，時間到全部跑走
 * - 命中只計次數不扣血（每下噴金幣、顯示剩餘次數），達到命中數就打倒並噴大量金幣
 */
export class TreasureEnemyController {
  /** 關卡中的寶箱怪（場上最多一隻） */
  private treasure: Enemy | null = null;
  private glow: Phaser.GameObjects.Graphics | null = null;
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private banner: Phaser.GameObjects.Text | null = null;
  /** 獎勵關中的寶箱怪 */
  private readonly roomTreasures = new Set<Enemy>();

  constructor(private readonly host: TreasureEnemyHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /** 關卡中的寶箱怪（沒有則 null） */
  get current(): Enemy | null {
    return this.treasure;
  }

  /** 關卡中的寶箱怪還活著、未離場 */
  get isOnField(): boolean {
    const t = this.treasure;
    return !!(t && t.active && !t.dead);
  }

  /** 獎勵關中場上的寶箱怪數量 */
  get roomCount(): number {
    return this.roomTreasures.size;
  }

  /**
   * 波次生怪時擲骰出寶箱怪：限時事件中、場上已有一隻、本波第一次隊形、生怪進度未達配額 35% 時都不出；
   * 出現在場內隨機點（盡量避開 P1），顯示提示橫幅並加上金光與粒子
   *
   * @param time 目前場景時間
   */
  trySpawn(time: number): void {
    if (this.host.isEventActive()) return;
    if (this.isOnField) return;
    const wave = this.host.waveProgress();
    if (wave.formations <= 1) return;
    if (wave.spawned < Math.max(1, wave.quota) * SPAWN_MIN_WAVE_FRACTION) return;
    this.treasure = null;
    if (Math.random() >= GameConfig.enemy.treasure.spawnChance) return;
    const a = this.host.arena(), r = GameConfig.enemy.types.treasure.radius;
    const p = this.host.player();
    let x = a.centerX, y = a.centerY;
    for (let attempt = 0; attempt < SPAWN_TRIES; attempt++) {
      x = Phaser.Math.Between(a.left + r + SPAWN_EDGE_MARGIN, a.right - r - SPAWN_EDGE_MARGIN);
      y = Phaser.Math.Between(a.top + r + SPAWN_EDGE_MARGIN, a.bottom - r - SPAWN_EDGE_MARGIN);
      if (Phaser.Math.Distance.Between(x, y, p.x, p.y) > SPAWN_AVOID_PLAYER) break;
    }
    const t = this.host.enemies().get(x, y) as Enemy | null;
    if (!t) return;
    t.spawn(x, y, time, 'treasure', 1);
    this.treasure = t;
    this.showBanner();
    this.clearFx();
    // 金光：脈動光暈（在寶箱怪之下）+ 環繞的金色粒子（在之上）
    this.glow = this.scene.add.graphics().setDepth((t.depth || 5) - 1);
    this.emitter = this.scene.add.particles(x, y, 'spark', {
      speed: { min: 10, max: 30 }, angle: { min: 0, max: 360 },
      lifespan: 900, scale: { start: 0.55, end: 0 }, alpha: { start: 1, end: 0 },
      tint: [0xffe86a, 0xffd23f, 0xffb020], frequency: 90, quantity: 1, blendMode: 'ADD',
      emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, SPARK_ORBIT_RADIUS), quantity: 12 } as any
    }).setDepth((t.depth || 5) + 1);
    this.emitter.startFollow(t);
  }

  /**
   * 每幀（關卡中的寶箱怪）：金光脈動、閃爍、跑點移動與限時跑走；時停中凍結
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    const t = this.treasure;
    if (!t || !t.active || t.dead) { this.treasure = null; this.clearFx(); return; }
    if (this.glow) {
      const g = this.glow;
      g.clear();
      const pulse = Math.abs(Math.sin(time / GLOW_PULSE_PERIOD));
      const rp = 26 + 8 * pulse;
      g.fillStyle(0xffd23f, 0.12); g.fillCircle(t.x, t.y, rp + 14);
      g.fillStyle(0xffe86a, 0.18); g.fillCircle(t.x, t.y, rp);
      g.lineStyle(3, 0xffe86a, 0.5 + 0.3 * pulse); g.strokeCircle(t.x, t.y, rp + 6);
    }
    if (this.host.isTimeStopped()) { (t.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0); return; }
    this.applyGoldTint(t, time);
    this.stepMovement(t, time, GameConfig.enemy.treasure.lifetimeMs);
  }

  /**
   * 每幀（獎勵關的寶箱怪）：閃爍與跑點移動（不限時）；時停中凍結
   *
   * @param time 目前場景時間
   */
  updateRoom(time: number): void {
    for (const t of this.roomTreasures) {
      if (!t.active || t.dead) { this.roomTreasures.delete(t); continue; }
      if (this.host.isTimeStopped()) { (t.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0); continue; }
      this.applyGoldTint(t, time);
      this.stepMovement(t, time, null);
    }
  }

  /**
   * 時停結束：關卡中寶箱怪的出生時間與停頓結束時間順延凍結時間（限時與跑點節奏不流失）
   *
   * @param frozenMs 凍結時長
   */
  onTimeStopEnd(frozenMs: number): void {
    const t = this.treasure;
    if (t && t.active) {
      t.treasureSpawnAt += frozenMs;
      if (t.treasurePauseUntil > 0) t.treasurePauseUntil += frozenMs;
    }
  }

  /**
   * 獎勵關：從財寶裝飾位置跳出一隻寶箱怪（不限時，時間到統一離場）
   *
   * @param x 裝飾位置 x
   * @param y 裝飾位置 y
   */
  spawnRoomTreasure(x: number, y: number): void {
    const t = this.host.enemies().get(x, y) as Enemy | null;
    if (!t) return;
    t.spawn(x, y, this.scene.time.now, 'treasure', 1);
    this.roomTreasures.add(t);
    this.spawnCoins(x, y, GameConfig.stage.treasureRoom.spawnCoinBurst, true);
  }

  /** 獎勵關時間到：場上的寶箱怪全部跑走 */
  dismissRoom(): void {
    for (const t of this.roomTreasures) {
      if (t.active && !t.dead && !t.treasureFleeing) this.flee(t);
    }
  }

  /**
   * 命中寶箱怪：計一下並噴少量金幣、顯示剩餘次數，達到命中數就打倒並噴大量金幣。
   * 獎勵關的寶箱怪改用 treasureRoom.hitsToKill，每次命中給命中者 ticketsPerHit 張彩票、打倒再給 ticketsOnKill 張
   *
   * @param enemy 寶箱怪
   * @param actor 命中的角色
   * @returns true = 已處理（呼叫端不走一般扣血）
   */
  hit(enemy: Enemy, actor: Character): boolean {
    if (enemy.enemyType !== 'treasure' || enemy.dead || !enemy.active) return false;
    const inRoom = this.roomTreasures.has(enemy);
    if (enemy.treasureFleeing) {
      // 關卡中的寶箱怪跑走途中被打到算打到（直接消失）；獎勵關時間到後跑走的不再給獎勵
      if (!inRoom) { enemy.kill(); if (this.treasure === enemy) this.treasure = null; }
      return true;
    }
    const cfg = GameConfig.enemy.treasure;
    const room = GameConfig.stage.treasureRoom;
    const hitsToKill = inRoom ? room.hitsToKill : cfg.hitsToKill;
    enemy.treasureHits++;
    this.host.flashEnemy(enemy);
    this.spawnCoins(enemy.x, enemy.y, cfg.coinsPerHit, false);
    this.host.spawnDamageText(enemy.x, enemy.y - 10, hitsToKill - enemy.treasureHits);
    if (inRoom) {
      actor.credit += room.ticketsPerHit;
      this.popTicketText(enemy.x, enemy.y - 40, room.ticketsPerHit);
    }
    if (enemy.treasureHits >= hitsToKill) {
      const dx = enemy.x, dy = enemy.y;
      enemy.kill();
      if (inRoom) {
        this.roomTreasures.delete(enemy);
        actor.credit += room.ticketsOnKill;
        this.popTicketText(dx, dy - 70, room.ticketsOnKill);
      }
      if (this.treasure === enemy) { this.treasure = null; this.clearFx(); }
      this.spawnCoins(dx, dy, cfg.coinsOnDeath, true);
      this.host.spawnExpandingRing(dx, dy, DEATH_RING_RADIUS, DEATH_RING_COLOR, DEATH_RING_MS);
      this.host.shakeOnce(120, 0.006);
    }
    return true;
  }

  /** 進入左右轉場那刻：關卡中的寶箱怪立即朝最近的牆逃走並淡出（不跟到下一區） */
  fleeNow(): void {
    const t = this.treasure;
    if (!t || !t.active || t.treasureFleeing) return;
    t.telegraphing = false;
    t.treasureFleeing = true;
    this.runToNearestWall(t, FLEE_NOW_SPEED_MULT);
    this.scene.tweens.add({ targets: t, alpha: 0, duration: FLEE_NOW_FADE_MS, onComplete: () => {
      if (this.treasure === t) this.treasure = null;
      this.clearFx();
      t.kill();
    }});
  }

  /** 真正換區時：關卡中的寶箱怪直接移除（不帶到下一區） */
  clear(): void {
    const t = this.treasure;
    if (t && t.active) { t.dead = true; t.disableBody(true, true); }
    this.forget();
  }

  /** 寶箱怪已由呼叫端隨敵人一起清掉：只放掉參照與金光 */
  forget(): void {
    this.treasure = null;
    this.clearFx();
  }

  /**
   * 跑點移動（關卡與獎勵關共用）：出場預告中不動；衝到隨機點 → 停頓 pauseMin~Max → 再衝。
   * lifetimeMs 不為 null 時，出現滿這麼久還沒打倒就跑走
   *
   * @param t 寶箱怪
   * @param time 目前場景時間
   * @param lifetimeMs 限時（獎勵關不限時，傳 null）
   */
  private stepMovement(t: Enemy, time: number, lifetimeMs: number | null): void {
    const cfg = GameConfig.enemy.treasure;
    const body = t.body as Phaser.Physics.Arcade.Body;
    if (t.telegraphing) { body.setVelocity(0, 0); return; }
    if (lifetimeMs !== null && !t.treasureFleeing && time - t.treasureSpawnAt >= lifetimeMs) {
      this.flee(t);
      return;
    }
    if (t.treasureFleeing) return; // 跑走中維持速度直到淡出移除
    if (time < t.treasurePauseUntil) {
      body.setVelocity(0, 0); // 停頓中（玩家追打的空檔）
      return;
    }
    const arrived = Phaser.Math.Distance.Between(t.x, t.y, t.treasureMoveTX, t.treasureMoveTY) <= MOVE_ARRIVE_PX;
    const idle = body.velocity.x === 0 && body.velocity.y === 0;
    if (arrived || idle) {
      if (arrived && t.treasurePauseUntil === 0 && !idle) {
        // 剛衝到點 → 停頓
        t.treasurePauseUntil = time + Phaser.Math.Between(cfg.pauseMinMs, cfg.pauseMaxMs);
        body.setVelocity(0, 0);
        return;
      }
      // 停頓完或靜止待命 → 挑新點衝過去
      const a = this.host.arena(), r = GameConfig.enemy.types.treasure.radius;
      t.treasureMoveTX = Phaser.Math.Between(a.left + r + SPAWN_EDGE_MARGIN, a.right - r - SPAWN_EDGE_MARGIN);
      t.treasureMoveTY = Phaser.Math.Between(a.top + r + SPAWN_EDGE_MARGIN, a.bottom - r - SPAWN_EDGE_MARGIN);
      t.treasurePauseUntil = 0;
    }
    // 朝目標點衝（途中每幀修正方向，避免越過目標亂飄）
    const ang = Phaser.Math.Angle.Between(t.x, t.y, t.treasureMoveTX, t.treasureMoveTY);
    body.setVelocity(Math.cos(ang) * cfg.moveSpeed, Math.sin(ang) * cfg.moveSpeed);
  }

  /** 限時到或獎勵關結束：朝最近的牆跑走並淡出移除 */
  private flee(t: Enemy): void {
    t.treasureFleeing = true;
    this.runToNearestWall(t, FLEE_SPEED_MULT);
    this.scene.tweens.add({ targets: t, alpha: 0, duration: FLEE_FADE_MS, onComplete: () => {
      if (this.treasure === t) { this.treasure = null; this.clearFx(); }
      this.roomTreasures.delete(t);
      t.kill();
    }});
  }

  /** 朝移動區最近的一側以 moveSpeed × speedMult 衝出去 */
  private runToNearestWall(t: Enemy, speedMult: number): void {
    const a = this.host.arena();
    const toLeft = t.x - a.left, toRight = a.right - t.x, toTop = t.y - a.top, toBottom = a.bottom - t.y;
    const m = Math.min(toLeft, toRight, toTop, toBottom);
    let fx = 0, fy = 0;
    if (m === toLeft) fx = -1; else if (m === toRight) fx = 1; else if (m === toTop) fy = -1; else fy = 1;
    const speed = GameConfig.enemy.treasure.moveSpeed * speedMult;
    (t.body as Phaser.Physics.Arcade.Body).setVelocity(fx * speed, fy * speed);
  }

  /** 金色閃爍（每幀依時間調整 tint 亮度） */
  private applyGoldTint(t: Enemy, time: number): void {
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(time / TINT_PULSE_PERIOD));
    t.setTint(Phaser.Display.Color.GetColor(255, Math.round(210 * pulse) + 45, Math.round(63 * pulse)));
  }

  private clearFx(): void {
    if (this.glow) { this.glow.destroy(); this.glow = null; }
    if (this.emitter) { this.emitter.destroy(); this.emitter = null; }
  }

  /** 出現提示橫幅：彈入 → 停留 bannerHoldMs → 淡出 */
  private showBanner(): void {
    if (this.banner) { this.banner.destroy(); this.banner = null; }
    const cfg = GameConfig.enemy.treasure;
    const t = this.scene.add.text(GameConfig.width / 2, GameConfig.height * BANNER_Y_RATIO, cfg.bannerText, BANNER_STYLE)
      .setOrigin(0.5).setScrollFactor(0).setDepth(BANNER_DEPTH).setAlpha(0).setScale(0.7);
    this.banner = t;
    this.scene.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 260, ease: 'Back.out' });
    this.scene.tweens.add({ targets: t, alpha: 0, delay: cfg.bannerHoldMs, duration: 450,
      onComplete: () => { if (this.banner === t) this.banner = null; t.destroy(); } });
  }

  /** 頭上飄出「+N 🎫」 */
  private popTicketText(x: number, y: number, tickets: number): void {
    const txt = this.scene.add.text(x, y, `+${tickets} 🎫`, TICKET_TEXT_STYLE).setOrigin(0.5).setDepth(TICKET_TEXT_DEPTH);
    this.scene.tweens.add({ targets: txt, y: y - 60, alpha: 0, duration: 800, onComplete: () => txt.destroy() });
  }

  /**
   * 金幣噴散（純視覺）：往上拋出、散開後落下淡出
   *
   * @param big true = 打倒時的大量金幣（拋得更高更遠）
   */
  private spawnCoins(x: number, y: number, count: number, big: boolean): void {
    for (let i = 0; i < count; i++) {
      const coin = this.scene.add.image(x, y, 'coin').setDepth(COIN_DEPTH);
      const ang = -Math.PI / 2 + Phaser.Math.FloatBetween(-1, 1) * (big ? 1.2 : 0.7);
      const spd = big ? Phaser.Math.Between(120, 300) : Phaser.Math.Between(60, 150);
      const vx = Math.cos(ang) * spd, vy = Math.sin(ang) * spd;
      const dur = big ? Phaser.Math.Between(600, 1000) : Phaser.Math.Between(400, 650);
      this.scene.tweens.add({
        targets: coin, x: x + vx * (dur / 1000), y: y + vy * (dur / 1000) + (big ? 120 : 70),
        alpha: { from: 1, to: 0 }, angle: Phaser.Math.Between(-180, 180), scale: { from: big ? 1.2 : 0.9, to: 0.4 },
        duration: dur, ease: 'Quad.easeOut', onComplete: () => coin.destroy()
      });
    }
  }
}
