import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import { hitFeel } from '../systems/hitFeelParams';
import { visibleBottomOffset } from '../systems/spriteFeet';

/** 畫面變形倍率（相對原始縮放） */
export interface ScaleMult {
  sx: number;
  sy: number;
}

/**
 * 衝刺中沿移動方向的拉長倍率：方向上放大、另一軸對應縮小，面積不變（參數取自打擊感設定）
 *
 * @param angle 移動方向（弧度）
 */
export function dashStretchMult(angle: number): ScaleMult {
  const s = hitFeel().dashStretch;
  const sx = 1 + s * Math.abs(Math.cos(angle));
  const sy = 1 + s * Math.abs(Math.sin(angle));
  const norm = Math.sqrt(sx * sy);
  return { sx: sx / norm, sy: sy / norm };
}

/**
 * 撞到敵人後 elapsedMs 的壓扁倍率：橫向放大、縱向縮小並線性回彈（參數取自打擊感設定）
 *
 * @param elapsedMs 撞到後經過的時間（毫秒）
 * @returns 倍率；回彈結束（或壓扁為 0）時為 null
 */
export function impactSquashAt(elapsedMs: number): ScaleMult | null {
  const p = hitFeel();
  if (p.impactSquash <= 0 || elapsedMs < 0 || elapsedMs >= p.impactSquashMs) return null;
  const k = 1 - elapsedMs / p.impactSquashMs;
  return { sx: 1 + p.impactSquash * k, sy: 1 - p.impactSquash * k };
}

/** DashFx 需要場景提供的能力 */
export interface DashFxHost {
  /** 全部角色 */
  characters(): ReadonlyArray<Character>;
  /** 角色畫面上實際看到的圖像（P1 新美術為皮膚圖） */
  displayImageOf(c: Character): Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
}

/** 套用變形前的原始畫面數值（畫完後原樣還原） */
interface SavedPose {
  img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite;
  y: number;
  scaleX: number;
  scaleY: number;
}

/**
 * 衝刺動態（純視覺，攻擊者自己）：
 * - 衝刺殘影：衝刺中每隔一段時間在原地留下一個淡出的殘影，撞到敵人起停止產生（「滑順 → 被卡住」的對比）
 * - 衝刺拉長：衝刺中沿移動方向拉長（面積不變）
 * - 撞擊壓扁：撞到敵人瞬間橫向放大、縱向縮小再回彈，腳底不動
 *
 * 變形與 HitReactionFx 相同：場景 POST_UPDATE（物理後處理之後）套用、遊戲 POST_RENDER 原樣還原，
 * 物理 body 與所有判定都看到原始數值。殘影只是另外加的圖，不影響任何物件
 */
export class DashFx {
  private saved: SavedPose[] = [];
  /** 每個角色上一次產生殘影的時間 */
  private readonly lastGhostAt = new Map<Character, number>();
  /** 殘影物件池（用完隱藏、重複使用） */
  private readonly ghosts: Phaser.GameObjects.Image[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly host: DashFxHost) {
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.apply, this);
    scene.game.events.on(Phaser.Core.Events.POST_RENDER, this.restore, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.restore();
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.apply, this);
      scene.game.events.off(Phaser.Core.Events.POST_RENDER, this.restore, this);
      this.lastGhostAt.clear();
      this.ghosts.length = 0;
    });
  }

  /** 繪製前：依每個角色的衝刺狀態套用拉長 / 壓扁、產生殘影 */
  private apply(): void {
    this.restore(); // 保險：上一幀若沒經過繪製就不會還原，先還原避免疊加
    const now = this.scene.time.now;
    for (const c of this.host.characters()) {
      if (!c.alive) continue;
      const img = this.host.displayImageOf(c);
      const dashingFree = c.isDashing && c.cutInUntil === 0; // 衝刺中、尚未撞到敵人
      const mult = dashingFree
        ? dashStretchMult(Math.atan2(c.dashDestY - c.y, c.dashDestX - c.x))
        : c.dashImpactAt > 0 ? impactSquashAt(now - c.dashImpactAt) : null;
      if (mult) this.transform(img, mult);
      if (dashingFree) this.maybeSpawnGhost(c, img, now);
    }
  }

  /**
   * 對圖像套用倍率（先記下原值），縱向縮放改變時把圖往下 / 上補，腳底留在原處
   *
   * @param img 角色畫面上的圖像
   * @param mult 倍率
   */
  private transform(img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, mult: ScaleMult): void {
    const pose: SavedPose = { img, y: img.y, scaleX: img.scaleX, scaleY: img.scaleY };
    this.saved.push(pose);
    const sy = pose.scaleY * mult.sy;
    const foot = visibleBottomOffset(this.scene.textures, img.texture.key);
    img.setScale(pose.scaleX * mult.sx, sy);
    img.setY(pose.y + foot * (pose.scaleY - sy));
  }

  /**
   * 間隔時間到就在角色目前的位置與樣子留下一個殘影（淡出後回收）
   *
   * @param c 角色
   * @param img 角色畫面上的圖像（已套用拉長）
   * @param now 目前場景時間
   */
  private maybeSpawnGhost(c: Character, img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, now: number): void {
    const cfg = GameConfig.dashFx;
    if (hitFeel().afterimageEnabled !== 1) return;
    if (now - (this.lastGhostAt.get(c) ?? -Infinity) < cfg.afterimageIntervalMs) return;
    const ghost = this.takeGhost();
    if (!ghost) return;
    this.lastGhostAt.set(c, now);
    ghost.setTexture(img.texture.key, img.frame.name)
      .setPosition(img.x, img.y)
      .setScale(img.scaleX, img.scaleY)
      .setFlipX(img.flipX)
      .setDepth(img.depth + cfg.afterimageDepthOffset)
      .setTint(cfg.afterimageTint)
      .setAlpha(cfg.afterimageAlpha)
      .setVisible(true);
    this.scene.tweens.add({
      targets: ghost, alpha: 0, duration: cfg.afterimageLifeMs,
      onComplete: () => ghost.setVisible(false)
    });
  }

  /** 從物件池取一個閒置的殘影（池滿且都在使用中時回傳 null） */
  private takeGhost(): Phaser.GameObjects.Image | null {
    const idle = this.ghosts.find((g) => !g.visible);
    if (idle) return idle;
    if (this.ghosts.length >= GameConfig.dashFx.afterimageMax) return null;
    const g = this.scene.add.image(0, 0, '__DEFAULT').setVisible(false);
    this.ghosts.push(g);
    return g;
  }

  /** 畫完後：把套用過變形的圖像原樣還原 */
  private restore(): void {
    for (const p of this.saved) {
      p.img.setScale(p.scaleX, p.scaleY);
      p.img.setY(p.y);
    }
    this.saved = [];
  }
}
