import type Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * P1 腳下圓盤（地面標記，無狀態繪製）。
 *
 * 畫在 GameScene 世界座標、深度在背景之上與敵人 / 角色之下：圓盤是地面上的東西，
 * 不能像 UIScene 那樣整層蓋在角色圖上；鏡頭捲動 / 縮放也會自動對齊。
 */

/** 圓盤深度：場景背景（0.5）之上、蓄力警示（2）/ 敵人（5）/ 角色（10）之下 */
export const FOOT_DISC_DEPTH = 1;

/** 快速模式裝飾圓盤：中心相對角色中心的偏移與尺寸（沿用原本的地盤畫法） */
const FAST_DISC = {
  OFFSET_X: -5,
  /** 角色身體半徑之外再往下的距離（總偏移 = 半徑 + 54） */
  BELOW_BODY: 54,
  /** 寬度 = 方向圓環半徑 × 此倍數 */
  WIDTH_SCALE: 2.5,
  /** 高度 = 寬度 × 此比例（透視壓扁） */
  FLATTEN: 0.2
} as const;

/** 慢速模式真空圈的形狀與位置（與判定共用的同一份資料） */
export interface VacuumDisk {
  /** 圈中心離角色中心的水平距離 */
  offsetX: number;
  /** 圈中心離角色中心的垂直距離（腳底 + 上下偏移） */
  offsetY: number;
  /** 左右半徑 */
  radius: number;
  /** 上下壓扁比例 */
  flatten: number;
}

/**
 * 重畫 P1 腳下圓盤：慢速模式畫真空圈（看到的圈即判定範圍），快速模式畫裝飾圓盤
 *
 * @param g 圓盤用的 Graphics（每次呼叫會先清除）
 * @param x 角色中心 x（世界座標）
 * @param y 角色中心 y（世界座標）
 * @param vacuum 慢速模式真空圈；null = 快速模式
 */
export function drawFootDisc(g: Phaser.GameObjects.Graphics, x: number, y: number, vacuum: VacuumDisk | null): void {
  const cfg = GameConfig.aim;
  g.clear();
  g.lineStyle(cfg.ringThickness, cfg.ringColor, cfg.ringAlpha);
  if (vacuum) {
    g.strokeEllipse(x + vacuum.offsetX, y + vacuum.offsetY, vacuum.radius * 2, vacuum.radius * vacuum.flatten * 2);
    return;
  }
  const width = cfg.ringRadius * FAST_DISC.WIDTH_SCALE;
  g.strokeEllipse(x + FAST_DISC.OFFSET_X, y + GameConfig.player.radius + FAST_DISC.BELOW_BODY, width, width * FAST_DISC.FLATTEN);
}
