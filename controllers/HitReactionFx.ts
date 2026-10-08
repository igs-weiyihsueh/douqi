import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Enemy } from '../objects/Enemy';
import { hitFeel } from '../systems/hitFeelParams';
import { visibleBottomOffset } from '../systems/spriteFeet';

/** 黃金比例的小數部分：讓同一次火花的各顆速度均勻錯開（不用亂數，不影響遊戲的隨機序列） */
const GOLDEN_FRACTION = 0.618033988749895;
/** 火花貼圖（BootScene 產生的 spark）與使用的 frame */
const SPARK_TEXTURE = 'spark';
const SPARK_FRAME = '__BASE';

/** 受擊反應在某個時間點的畫面變形（相對原始縮放的倍率與水平抖動） */
export interface HitPose {
  scaleXMult: number;
  scaleYMult: number;
  jitterX: number;
}

/**
 * 受擊反應在受擊後 elapsedMs 的變形：橫向放大、縱向縮小並線性回彈，加上左右抖動（參數取自打擊感設定）
 *
 * @param elapsedMs 受擊後經過的時間（毫秒）
 * @returns 變形；反應已結束（或反應時間為 0）時回傳 null
 */
export function hitPoseAt(elapsedMs: number): HitPose | null {
  const p = hitFeel();
  if (p.reactionMs <= 0 || elapsedMs < 0 || elapsedMs >= p.reactionMs) return null;
  const t = elapsedMs / p.reactionMs;
  const s = 1 - t; // 反應強度：1 → 0 線性衰減
  return {
    scaleXMult: 1 + p.squash * s,
    scaleYMult: 1 - p.squash * s,
    jitterX: p.jitterPx * s * Math.sin(t * p.jitterCycles * Math.PI * 2)
  };
}

/**
 * 命中火花發射器：在命中點沿方向的錐形逐顆噴出火花（參數取自打擊感設定）。
 * 角度 / 速度依序號計算、指定單一 frame，不呼叫亂數（不影響遊戲的隨機序列）。
 * 主遊戲與打擊感編輯器預覽共用
 */
export class HitSparks {
  /** 依火花大小分開的發射器（縮放的起訖值建立後無法修改，大小不同就用不同發射器） */
  private readonly emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();

  /**
   * @param scene 所在場景
   * @param depth 火花深度
   */
  constructor(private readonly scene: Phaser.Scene, private readonly depth: number) {}

  /**
   * 噴一束火花：角度在錐形內平均分佈，速度依序號錯開，顏色輪流
   *
   * @param x 命中點 x
   * @param y 命中點 y
   * @param angle 噴發方向（弧度）
   * @param empowered 強化攻擊（金色、數量 × empoweredCountMult）
   * @param sizeMult 尺寸倍率（大小與飛行速度一起放大；F4 大圖用）
   */
  emit(x: number, y: number, angle: number, empowered: boolean, sizeMult = 1): void {
    const p = hitFeel();
    const cfg = GameConfig.juice.hitSpark;
    const count = Math.round(p.sparkCount * (empowered ? cfg.empoweredCountMult : 1));
    if (count <= 0) return;
    const emitter = this.emitterFor(p.sparkScale * sizeMult);
    emitter.setParticleLifespan(p.sparkLifespanMs);
    const colors = empowered ? cfg.empoweredColors : cfg.colors;
    const speedMin = Math.min(cfg.speedMin, p.sparkSpeedMax);
    const baseDeg = Phaser.Math.RadToDeg(angle);
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count; // 0~1，錐形內平均分佈
      const speedT = (i * GOLDEN_FRACTION) % 1;
      emitter.setEmitterAngle(baseDeg + (t - 0.5) * p.sparkConeDeg);
      emitter.setParticleSpeed((speedMin + (p.sparkSpeedMax - speedMin) * speedT) * sizeMult);
      emitter.setParticleTint(colors[i % colors.length]);
      emitter.emitParticle(1, x, y);
    }
  }

  /** 銷毀所有發射器（編輯器預覽關閉時） */
  destroy(): void {
    for (const e of this.emitters.values()) e.destroy();
    this.emitters.clear();
  }

  /** 取得（必要時建立）指定火花大小的發射器 */
  private emitterFor(scale: number): Phaser.GameObjects.Particles.ParticleEmitter {
    const existing = this.emitters.get(scale);
    if (existing) return existing;
    const emitter = this.scene.add.particles(0, 0, SPARK_TEXTURE, {
      emitting: false,
      speed: 0,
      angle: 0,
      frame: SPARK_FRAME, // 指定單一 frame：未指定時 Phaser 每顆粒子會用亂數從紋理的所有 frame 中挑一個
      scale: { start: scale, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: Phaser.BlendModes.ADD
    }).setDepth(this.depth);
    this.emitters.set(scale, emitter);
    return emitter;
  }
}

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
 * - 命中火花（HitSparks）：沿攻擊方向的錐形噴出亮色粒子；強化攻擊改金色、數量加倍
 * - 受擊反應（hitPoseAt）：壓扁回彈（橫向放大、縱向縮小，腳底不動）+ 輕微左右抖動
 *
 * 受擊反應只在「物理與邏輯都算完、準備繪製」時套用（場景 POST_UPDATE），畫完立刻（遊戲 POST_RENDER）
 * 原樣還原位置與縮放：物理 body、碰撞、腳底量測與鍵盤 / 滑鼠事件處理永遠看到原始數值。
 */
export class HitReactionFx {
  private readonly reactions = new Map<Enemy, Reaction>();
  private saved: SavedPose[] = [];
  private readonly sparks: HitSparks;

  constructor(private readonly scene: Phaser.Scene) {
    this.sparks = new HitSparks(scene, GameConfig.juice.hitSpark.depth);
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
   * @param sizeMult 火花尺寸倍率（F4 大圖用，見 GameScene.hitFxScale）
   */
  onEnemyHit(enemy: Enemy, fromX: number, fromY: number, empowered: boolean, sizeMult = 1): void {
    this.sparks.emit(enemy.x, enemy.y, Math.atan2(enemy.y - fromY, enemy.x - fromX), empowered, sizeMult);
    this.reactions.set(enemy, { enemy, startAt: this.scene.time.now });
  }

  /** 繪製前：對反應中的敵人套用壓扁回彈與抖動（先記下原始數值），結束的反應移除 */
  private applyReactions(): void {
    this.restorePoses(); // 保險：上一幀若沒經過繪製就不會還原，先還原避免疊加
    const now = this.scene.time.now;
    for (const [enemy, r] of this.reactions) {
      const pose = enemy.active && !enemy.dead ? hitPoseAt(now - r.startAt) : null;
      if (!pose) {
        this.reactions.delete(enemy);
        continue;
      }
      const saved: SavedPose = { enemy, x: enemy.x, y: enemy.y, scaleX: enemy.scaleX, scaleY: enemy.scaleY };
      this.saved.push(saved);
      const sy = saved.scaleY * pose.scaleYMult;
      // 縱向縮小時把圖往下補，腳底留在原處（站在地上被打扁，而不是整個縮向中心）
      const foot = visibleBottomOffset(this.scene.textures, enemy.texture.key);
      enemy.setScale(saved.scaleX * pose.scaleXMult, sy);
      enemy.setPosition(saved.x + pose.jitterX, saved.y + foot * (saved.scaleY - sy));
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
