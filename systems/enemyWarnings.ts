import Phaser from 'phaser';
import type { Enemy } from '../objects/Enemy';
import { drawHitShape, placeHitShape, type PlacedHitShape } from './hitShapes';
import { monsterAttackFor, placeBombAttack } from './monsterAttackParams';

/** 近戰蓄力預警：顏色、外框與填色透明度 */
const MELEE_WARN = { color: 0xff3344, line: 0.85, fill: 0.35 };
/** 投擲蓄力預警：怪 → 落點連線、落點範圍的顏色與透明度 */
const BOMB_WARN = { lineColor: 0xd08bff, lineAlpha: 0.5, color: 0xff6a3a, line: 0.8, fill: 0.22 };
const WARN_LINE_WIDTH = 2;

/**
 * 畫一隻敵人的蓄力預警（無狀態；呼叫端每幀先 clear 共用的 graphics）。範圍就是實際打得到的範圍
 * （systems/monsterAttackParams，範圍 / 判定編輯器的怪物頁可調）：
 * - 近戰：攻擊範圍外框 + 由內而外填滿，填滿瞬間出手
 * - 投射兵：怪 → 落點連線 + 爆炸範圍外框由內而外填滿
 *
 * @param g 共用的預警 graphics
 * @param enemy 敵人
 * @param time 目前場景時間
 */
export function drawEnemyChargeWarnings(
  g: Phaser.GameObjects.Graphics, enemy: Enemy, time: number
): void {
  if (enemy.isCharging()) {
    const shape = monsterAttackFor(enemy.enemyType).shape;
    drawWarning(g, placeHitShape(shape, enemy.x, enemy.y, enemy.facing), placeHitShape(shape, enemy.x, enemy.y, enemy.facing, enemy.chargeProgress(time)),
      MELEE_WARN.color, MELEE_WARN.line, MELEE_WARN.fill);
  }
  if (enemy.isChargingBomb()) {
    const tgt = enemy.getBombTarget();
    g.lineStyle(WARN_LINE_WIDTH, BOMB_WARN.lineColor, BOMB_WARN.lineAlpha);
    g.lineBetween(enemy.x, enemy.y, tgt.x, tgt.y);
    drawWarning(g, placeBombAttack(enemy.x, enemy.y, tgt.x, tgt.y), placeBombAttack(enemy.x, enemy.y, tgt.x, tgt.y, enemy.bombChargeProgress(time)),
      BOMB_WARN.color, BOMB_WARN.line, BOMB_WARN.fill);
  }
}

/**
 * 預警：完整範圍只畫外框，蓄力進度的範圍（尺寸 × 進度）只填色
 *
 * @param g 畫布
 * @param full 完整範圍
 * @param progress 依蓄力進度縮放的範圍
 * @param color 顏色
 * @param lineAlpha 外框透明度
 * @param fillAlpha 填色透明度
 */
function drawWarning(
  g: Phaser.GameObjects.Graphics, full: PlacedHitShape, progress: PlacedHitShape,
  color: number, lineAlpha: number, fillAlpha: number
): void {
  g.fillStyle(color, 0).lineStyle(WARN_LINE_WIDTH, color, lineAlpha);
  drawHitShape(g, full);
  g.fillStyle(color, fillAlpha).lineStyle(WARN_LINE_WIDTH, color, 0);
  drawHitShape(g, progress);
}
