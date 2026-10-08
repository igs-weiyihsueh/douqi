import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Enemy } from '../objects/Enemy';

/**
 * 畫一隻敵人的蓄力預警（無狀態；呼叫端每幀先 clear 共用的 graphics）：
 * - 近戰：攻擊範圍外框 + 由內而外填滿，填滿瞬間出手
 * - 投射兵：怪 → 落點連線 + 落點外框由內而外填滿
 *
 * @param g 共用的預警 graphics
 * @param enemy 敵人
 * @param time 目前場景時間
 */
export function drawEnemyChargeWarnings(
  g: Phaser.GameObjects.Graphics, enemy: Enemy, time: number
): void {
  if (enemy.isCharging()) {
    const R = GameConfig.enemy.attackRadius;
    g.lineStyle(2, 0xff3344, 0.85);
    g.strokeCircle(enemy.x, enemy.y, R);
    g.fillStyle(0xff3344, 0.35);
    g.fillCircle(enemy.x, enemy.y, R * enemy.chargeProgress(time));
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
