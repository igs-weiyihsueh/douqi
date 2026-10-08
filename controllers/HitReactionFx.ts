import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Enemy } from '../objects/Enemy';
import { visibleBottomOffset } from '../systems/spriteFeet';

/** 黃金比例的小數部分：讓同一次火花的各顆速度均勻錯開（不用亂數，不影響遊戲的隨機序列） */
const GOLDEN_FRACTION = 0.618033988749895;
/** 火花貼圖（BootScene 產生的 spark）與使用的 frame */
const SPARK_TEXTURE = 'spark';
const SPARK_FRAME = '__BASE';

/** 一隻敵人正在進行的受擊反應 */
interface Reaction {
  enemy: Enemy;
  /** 反應開始的場景時間 */
  startAt: number;
}

/** 套用反應前的原始畫面數值（畫完後原樣還原） */
interface SavedPose {
  enemy: Enemy;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * 命中特效（純視覺，不影響判定、數值與隨機序列）：
 * - 命中火花：沿攻擊方向的錐形噴出亮色粒子；強化攻擊改金色、數量加倍
 * - 受擊反應：壓扁回彈（橫向放大、縱向縮小，腳底不動）+ 輕微左右抖動
 *
 * 受擊反應只在「物理與邏輯都算完、準備繪製」時套用（場景 POST_UPDATE），畫完立刻（遊戲 POST_RENDER）
 * 原樣還原位置與縮放：物理 body、碰撞、腳底量測與鍵盤 / 滑鼠事件處理永遠看到原始數值。
 * 火花的角度 / 速度依序號計算，不呼叫亂數。
 */
export class HitReactionFx {
  private readonly reactions = new Map<Enemy, Reaction>();
  private saved: SavedPose[] = [];
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly empoweredSparks: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(private readonly scene: Phaser.Scene) {
    this.sparks = this.createSparkEmitter();
    this.empoweredSparks = this.createSparkEmitter();
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.applyReactions, this);
    scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.restorePoses, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.restorePoses();
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.applyReactions, this);
      scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.restorePoses, this);
      this.reactions.clear();
      this.saved = [];
    });
  }

  /**
   * 敵人被命中：噴火花並開始受擊反應
   *
   * @param enemy 被打的敵人
   * @param fromX 攻擊來源 x（火花往遠離來源的方向噴）
   * @param fromY 攻擊來源 y
   * @param empowered 是否為強化攻擊（金色、數量加倍）
   */
  onEnemyHit(enemy: Enemy, fromX: number, fromY: number, empowered: boolean): void {
    this.emitSparks(enemy.x, enemy.y, Math.atan2(enemy.y - fromY, enemy.x - fromX), empowered);
    this.reactions.set(enemy, { enemy, startAt: this.scene.time.now });
  }

  /** 建立一個不自動發射的火花發射器（每次命中逐顆發射） */
  private createSparkEmitter(): Phaser.GameObjects.Particles.ParticleEmitter {
    const cfg = GameConfig.juice.hitSpark;
    return this.scene.add.particles(0, 0, SPARK_TEXTURE, {
      emitting: false,
      lifespan: cfg.lifespanMs,
      speed: 0,
      angle: 0,
      frame: SPARK_FRAME, // 指定單一 frame：未指定時 Phaser 每顆粒子會用亂數從紋理的所有 frame 中挑一個
      scale: { start: cfg.scale, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD
    }).setDepth(cfg.depth);
  }

  /**
   * 在命中點沿方向噴一束火花：角度在錐形內平均分佈，速度依序號錯開，顏色輪流
   *
   * @param x 命中點 x
   * @param y 命中點 y
   * @param angle 噴發方向（弧度）
   * @param empowered 是否為強化攻擊
   */
  private emitSparks(x: number, y: number, angle: number, empowered: boolean): void {
    const cfg = GameConfig.juice.hitSpark;
    const emitter = empowered ? this.empoweredSparks : this.sparks;
    const colors = empowered ? cfg.empoweredColors : cfg.colors;
    const count = empowered ? cfg.empoweredCount : cfg.count;
    const baseDeg = Phaser.Math.RadToDeg(angle);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count; // 0~1，錐形內平均分佈
      const speedT = (i * GOLDEN_FRACTION) % 1;
      emitter.setEmitterAngle(baseDeg + (t - 0.5) * cfg.coneDeg);
      emitter.setParticleSpeed(cfg.speedMin + (cfg.speedMax - cfg.speedMin) * speedT);
      emitter.setParticleTint(colors[i % colors.length]);
      emitter.emitParticle(1, x, y);
    }
  }

  /**
   * 繪製前：對反應中的敵人套用壓扁回彈與抖動（先記下原始數值），結束的反應移除
   */
  private applyReactions(): void {
    this.restorePoses(); // 保險：上一幀若沒經過繪製就不會還原，先還原避免疊加
    const cfg = GameConfig.juice.hitReaction;
    const now = this.scene.time.now;
    for (const [enemy, r] of this.reactions) {
      const elapsed = now - r.startAt;
      if (!enemy.active || enemy.dead || elapsed >= cfg.durationMs) {
        this.reactions.delete(enemy);
        continue;
      }
      const s = 1 - elapsed / cfg.durationMs; // 反應強度：1 → 0 線性衰減
      const pose: SavedPose = { enemy, x: enemy.x, y: enemy.y, scaleX: enemy.scaleX, scaleY: enemy.scaleY };
      this.saved.push(pose);
      const sx = pose.scaleX * (1 + cfg.squash * s);
      const sy = pose.scaleY * (1 - cfg.squash * s);
      // 縱向縮小時把圖往下補，腳底留在原處（站在地上被打扁，而不是整個縮向中心）
      const foot = visibleBottomOffset(this.scene.textures, enemy.texture.key);
      const jitter = cfg.jitterPx * s * Math.sin((elapsed / cfg.durationMs) * cfg.jitterCycles * Math.PI * 2);
      enemy.setScale(sx, sy);
      enemy.setPosition(pose.x + jitter, pose.y + foot * (pose.scaleY - sy));
    }
  }

  /** 畫完後：把套用過反應的敵人原樣還原位置與縮放 */
  private restorePoses(): void {
    for (const p of this.saved) {
      p.enemy.setScale(p.scaleX, p.scaleY);
      p.enemy.setPosition(p.x, p.y);
    }
    this.saved = [];
  }
}
