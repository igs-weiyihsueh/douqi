import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * v57/v59 可打破物件（瓶罐/箱子）：場上每波成堆隨機灑。
 * - 只有【玩家攻擊(普攻揮擊/衝刺命中/道具招 AOE)】能打破，敵人不能破壞，靜止、不攻擊玩家。
 * - v59：帶「碰撞」擋角色（不可穿越）——碰撞用 GameScene 每幀【手動分離 blockCharacterFromBreakables】實作
 *   (Arcade circle collider 高速持續推會 creep 穿透，改手動把角色推回木箱外緣，可靠)。衝刺撞到→直接打破(不擋)。
 * - 命中判定/分離都用距離數學(不依賴 physics body)，是純顯示 sprite。
 */
export type BreakableKind = 'crate' | 'barrel';

/**
 * v57/v59 可打破物件（瓶罐/箱子）；v61 加【爆炸桶 barrel】(打破時範圍爆炸+擊退怪+炸玩家+連鎖)。
 * - 只有【玩家攻擊(普攻揮擊/衝刺命中/道具招 AOE)】能打破/引爆，敵人不能破壞，靜止、不攻擊玩家。
 * - 帶「碰撞」擋角色+怪（不可穿越）——用 GameScene 每幀【手動分離】(Arcade collider 會 creep)。衝刺撞到→直接打破/引爆。
 * - 命中判定/分離都用距離數學(不依賴 physics body)，是純顯示 sprite。
 */
export class Breakable extends Phaser.GameObjects.Sprite {
  hp: number = GameConfig.breakable.hp;
  dead = false;
  kind: BreakableKind = 'crate';
  /** v62：可推動——被撞時的速度(像素/秒)，每幀由 GameScene 整合+摩擦衰減+邊界/物件分離。 */
  vx = 0;
  vy = 0;
  /** v62：爆炸桶已打破進入 fuse 倒數(等待爆炸)——期間不再被打、地面警示圈跟隨。 */
  fusing = false;
  get explosive(): boolean { return this.kind === 'barrel'; }

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'breakable-jar');
    scene.add.existing(this);
    this.setDepth(5);
  }

  spawnBreakable(x: number, y: number, kind: BreakableKind = 'crate'): void {
    this.kind = kind;
    this.hp = kind === 'barrel' ? GameConfig.breakable.barrel.hp : GameConfig.breakable.hp;
    this.dead = false;
    this.fusing = false;
    this.vx = 0; this.vy = 0;
    this.setTexture(kind === 'barrel' ? 'breakable-barrel' : 'breakable-jar');
    this.setPosition(x, y);
    this.setActive(true);
    this.setVisible(true);
    this.setAlpha(1);
    this.setScale(1);
    this.clearTint();
  }

  /** 玩家攻擊命中：扣 HP，回傳是否被打破(hp<=0)。v62：fuse 倒數中(爆炸桶已打破)不再被打。 */
  hit(amount: number): boolean {
    if (this.dead || this.fusing || !this.active) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    // 受擊回饋：閃白一下
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => { if (this.active) this.clearTint(); });
    return false;
  }

  /** 半徑(命中/碰撞分離判定用) */
  getBodyRadius(): number {
    return GameConfig.breakable.radius;
  }

  despawn(): void {
    this.clearTint();
    this.setAlpha(1);
    this.setActive(false);
    this.setVisible(false);
  }
}
