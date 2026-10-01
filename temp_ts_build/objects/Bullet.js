import Phaser from 'phaser';
import { GameConfig } from '../config';
/**
 * 遠攻怪（shooter）發射的子彈：直線飛行，命中角色扣血，逾時/出界回收。
 */
export class Bullet extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, 'bullet');
        this.expireAt = 0;
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.body.setCircle(GameConfig.enemy.shooter.bulletRadius, 1, 1);
        this.setDepth(8);
    }
    fire(x, y, angle, time) {
        this.enableBody(true, x, y, true, true);
        this.setActive(true);
        this.setVisible(true);
        const cfg = GameConfig.enemy.shooter;
        const body = this.body;
        body.setVelocity(Math.cos(angle) * cfg.bulletSpeed, Math.sin(angle) * cfg.bulletSpeed);
        this.expireAt = time + cfg.bulletLifespanMs;
    }
    /** 每幀檢查逾時/出界，回傳 true 表示已回收 */
    tick(time, bounds) {
        if (!this.active)
            return false;
        if (time >= this.expireAt ||
            this.x < bounds.left - 40 ||
            this.x > bounds.right + 40 ||
            this.y < bounds.top - 40 ||
            this.y > bounds.bottom + 40) {
            this.recycle();
            return true;
        }
        return false;
    }
    recycle() {
        this.disableBody(true, true);
        this.setActive(false);
        this.setVisible(false);
    }
}
