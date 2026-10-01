import Phaser from 'phaser';
import { GameConfig } from '../config';
/**
 * 道具（v8）：場上掉落，角色碰到即觸發對應一次性招式。
 * 4 種以顏色 + 字母圖示區分（A 旋風斬 / B 天降雷擊 / C 居合貫穿 / E 全屏震爆）。
 */
export class Item extends Phaser.Physics.Arcade.Sprite {
    constructor(scene, x, y) {
        super(scene, x, y, `item-A`);
        this.skill = 'A';
        /** v15：原子拾取旗標——第一個拿到的角色設 true，其餘同幀碰到者略過，避免雙重觸發 */
        this.taken = false;
        this.expireAt = 0;
        scene.add.existing(this);
        scene.physics.add.existing(this);
        this.body.setCircle(GameConfig.items.radius, 2, 2);
        this.setDepth(6);
        this.iconText = scene.add
            .text(x, y, 'A', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#0a0a0a',
            fontStyle: 'bold'
        })
            .setOrigin(0.5)
            .setDepth(7);
    }
    spawnItem(x, y, skill, time) {
        this.skill = skill;
        this.taken = false;
        this.setTexture(`item-${skill}`);
        this.enableBody(true, x, y, true, true);
        this.setActive(true);
        this.setVisible(true);
        this.setAlpha(1);
        this.setScale(1);
        this.expireAt = time + GameConfig.items.lifespanMs;
        this.iconText.setText(skill);
        this.iconText.setPosition(x, y);
        this.iconText.setVisible(true);
        this.iconText.setAlpha(1);
        // 輕微脈動吸引注意（v11：無護盾，碰到即可拾取）
        this.blinkTween?.remove();
        this.blinkTween = this.scene.tweens.add({
            targets: this,
            scale: { from: 1, to: 1.15 },
            duration: 500,
            yoyo: true,
            repeat: -1
        });
    }
    /** v34：把到期時間往後推 ms（intermission 暫停倒數用） */
    shiftExpire(ms) {
        if (this.active)
            this.expireAt += ms;
    }
    /** 每幀：同步圖示位置、處理逾時閃爍與消失。回傳 true 表示已消失需回收。 */
    tick(time) {
        if (!this.active)
            return false;
        this.iconText.setPosition(this.x, this.y);
        const remain = this.expireAt - time;
        if (remain <= 0) {
            this.despawn();
            return true;
        }
        if (remain <= GameConfig.items.blinkBeforeMs) {
            const on = Math.floor(time / 120) % 2 === 0;
            this.setAlpha(on ? 1 : 0.3);
            this.iconText.setAlpha(on ? 1 : 0.3);
        }
        return false;
    }
    despawn() {
        this.blinkTween?.remove();
        this.blinkTween = undefined;
        this.iconText.setVisible(false);
        this.setAlpha(1);
        this.clearTint();
        this.disableBody(true, true);
        this.setActive(false);
        this.setVisible(false);
    }
}
