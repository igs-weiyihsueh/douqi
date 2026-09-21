import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * 遠攻怪（shooter）發射的子彈：直線飛行，命中角色扣血，逾時/出界回收。
 */
export class Bullet extends Phaser.Physics.Arcade.Sprite {
  private expireAt = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'bullet');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    (this.body as Phaser.Physics.Arcade.Body).setCircle(GameConfig.enemy.shooter.bulletRadius, 1, 1);
    this.setDepth(8);
  }

  fire(x: number, y: number, angle: number, time: number): void {
    this.enableBody(true, x, y, true, true);
    this.setActive(true);
    this.setVisible(true);
    const cfg = GameConfig.enemy.shooter;
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(angle) * cfg.bulletSpeed, Math.sin(angle) * cfg.bulletSpeed);
    this.expireAt = time + cfg.bulletLifespanMs;
  }

  /** 每幀檢查逾時/出界，回傳 true 表示已回收 */
  tick(time: number, bounds: Phaser.Geom.Rectangle): boolean {
    if (!this.active) return false;
    if (
      time >= this.expireAt ||
      this.x < bounds.left - 40 ||
      this.x > bounds.right + 40 ||
      this.y < bounds.top - 40 ||
      this.y > bounds.bottom + 40
    ) {
      this.recycle();
      return true;
    }
    return false;
  }

  recycle(): void {
    this.disableBody(true, true);
    this.setActive(false);
    this.setVisible(false);
  }
}
