import type Phaser from 'phaser';

/**
 * 場景層級的蓄力 / 預警特效登記項（塔扇形、BOSS 招式填滿預警）。
 *
 * - 時停時暫停 tween、解除時續播
 * - 擁有者（塔 / BOSS）消失時強制清除 graphics 並標記 fired，避免殘留或誤發
 */
export interface TelegraphFx {
  /** 特效擁有者 */
  owner: 'tower' | 'boss';
  gfx: Phaser.GameObjects.Graphics;
  /** 填滿進度 tween（時停時暫停） */
  tween?: Phaser.Tweens.Tween;
  /** 已發射或已取消 */
  fired: boolean;
}
