import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Enemy } from '../objects/Enemy';

/** 衝鋒怪蓄力時預警線的長度 */
const CHARGER_WARN_LENGTH = 220;

/**
 * 畫一隻敵人的蓄力預警（無狀態；呼叫端每幀先 clear 共用的 graphics）：
 * - 近戰：攻擊範圍外框 + 由內而外填滿，填滿瞬間出手
 * - 衝鋒怪：朝目標的方向線
 * - 遠程兵雷射：全長細線 + 從怪端往盡頭填滿的粗線
 * - 投射兵：怪 → 落點連線 + 落點外框由內而外填滿
 *
 * @param g 共用的預警 graphics
 * @param enemy 敵人
 * @param target 敵人目前的目標（衝鋒方向用）；沒有目標時為 null
 * @param time 目前場景時間
 */
export function drawEnemyChargeWarnings(
  g: Phaser.GameObjects.Graphics, enemy: Enemy, target: { x: number; y: number } | null, time: number
): void {
  if (enemy.isCharging()) {
    const R = GameConfig.enemy.attackRadius;
    g.lineStyle(2, 0xff3344, 0.85);
    g.strokeCircle(enemy.x, enemy.y, R);
    g.fillStyle(0xff3344, 0.35);
    g.fillCircle(enemy.x, enemy.y, R * enemy.chargeProgress(time));
  }
  if (enemy.isChargerCharging() && target) {
    const angle = Phaser.Math.Angle.Between(enemy.x, enemy.y, target.x, target.y);
    g.lineStyle(3, 0xffaa00, 0.8);
    g.lineBetween(enemy.x, enemy.y, enemy.x + Math.cos(angle) * CHARGER_WARN_LENGTH, enemy.y + Math.sin(angle) * CHARGER_WARN_LENGTH);
  }
  if (enemy.isChargingLaser()) {
    const len = GameConfig.enemy.shooter.laserLength;
    const a = enemy.getLaserAngle();
    const p = enemy.laserChargeProgress(time);
    g.lineStyle(2, 0x66ff88, 0.4);
    g.lineBetween(enemy.x, enemy.y, enemy.x + Math.cos(a) * len, enemy.y + Math.sin(a) * len);
    g.lineStyle(6, 0x33ff66, 0.85);
    g.lineBetween(enemy.x, enemy.y, enemy.x + Math.cos(a) * len * p, enemy.y + Math.sin(a) * len * p);
  }
  if (enemy.isChargingBomb()) {
    const radius = GameConfig.enemy.bomber.bombRadius;
    const tgt = enemy.getBombTarget();
    const p = enemy.bombChargeProgress(time);
    g.lineStyle(2, 0xd08bff, 0.5);
    g.lineBetween(enemy.x, enemy.y, tgt.x, tgt.y);
    g.lineStyle(2, 0xff6a3a, 0.8);
    g.strokeCircle(tgt.x, tgt.y, radius);
    g.fillStyle(0xff6a3a, 0.22);
    g.fillCircle(tgt.x, tgt.y, radius * p);
  }
}
