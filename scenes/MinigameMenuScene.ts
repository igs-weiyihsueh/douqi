import Phaser from 'phaser';
import { GameConfig } from '../config';
import { MINIGAMES } from '../minigames/registry';

/**
 * 小遊戲選單場景：依 MINIGAMES 登錄表自動列出所有小遊戲，點選進入。
 * 可擴充：新增小遊戲只要在 registry.ts 加一項 + 註冊 Scene，這裡自動出現。
 */
export class MinigameMenuScene extends Phaser.Scene {
  private selected = 0;
  private cards: Array<{ bg: Phaser.GameObjects.Rectangle; cy: number }> = [];
  private highlight?: Phaser.GameObjects.Rectangle;

  constructor() {
    super('MinigameMenuScene');
  }

  private selectCard(i: number): void {
    if (!MINIGAMES.length) return;
    this.selected = ((i % MINIGAMES.length) + MINIGAMES.length) % MINIGAMES.length;
    if (this.highlight) this.highlight.y = this.cards[this.selected].cy;
  }

  create(): void {
    const w = GameConfig.width;
    const h = GameConfig.height;
    this.selected = 0;
    this.cards = [];

    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 0, w, h, 0x0a0c14, 0.6).setOrigin(0, 0).setDepth(1);

    this.add
      .text(w / 2, h * 0.14, '🎮 小遊戲', {
        fontFamily: 'monospace', fontSize: '56px', color: '#7ee7ff', stroke: '#000', strokeThickness: 7
      })
      .setOrigin(0.5).setDepth(5);
    this.add
      .text(w / 2, h * 0.22, '選擇一個小遊戲（非戰鬥趣味關卡）', {
        fontFamily: 'monospace', fontSize: '16px', color: '#cbd5e1'
      })
      .setOrigin(0.5).setDepth(5);

    // 依 registry 列出小遊戲卡片
    const cardW = 520, cardH = 92, gap = 18;
    const startY = h * 0.32;
    // 選中高亮外框(黃色,脈動)
    this.highlight = this.add.rectangle(w / 2, startY, cardW + 14, cardH + 14)
      .setStrokeStyle(5, 0xffe066, 1).setDepth(7);
    this.tweens.add({ targets: this.highlight, alpha: { from: 1, to: 0.4 }, duration: 600, yoyo: true, repeat: -1 });
    MINIGAMES.forEach((mg, i) => {
      const cy = startY + i * (cardH + gap);
      const bg = this.add
        .rectangle(w / 2, cy, cardW, cardH, 0x1e2a44, 0.95)
        .setStrokeStyle(3, 0x4a90d9, 0.9)
        .setDepth(5);
      this.cards.push({ bg, cy });
      this.add
        .text(w / 2 - cardW / 2 + 30, cy, mg.icon, { fontFamily: 'monospace', fontSize: '40px' })
        .setOrigin(0, 0.5).setDepth(6);
      this.add
        .text(w / 2 - cardW / 2 + 90, cy - 16, mg.name, {
          fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', fontStyle: 'bold'
        })
        .setOrigin(0, 0.5).setDepth(6);
      this.add
        .text(w / 2 - cardW / 2 + 90, cy + 16, mg.desc, {
          fontFamily: 'monospace', fontSize: '12px', color: '#a9c0e0', wordWrap: { width: cardW - 110 }
        })
        .setOrigin(0, 0.5).setDepth(6);
      const card = this.add.container(0, 0, [bg]).setSize(cardW, cardH).setDepth(5);
      card.setInteractive(
        new Phaser.Geom.Rectangle(w / 2 - cardW / 2, cy - cardH / 2, cardW, cardH),
        Phaser.Geom.Rectangle.Contains
      );
      card.on('pointerover', () => { bg.setFillStyle(0x2a3d63, 0.98); this.selectCard(i); });
      card.on('pointerout', () => bg.setFillStyle(0x1e2a44, 0.95));
      card.on('pointerdown', () => this.scene.start(mg.sceneKey));
    });
    this.selectCard(0);

    // 返回 TitleScene
    const backW = 200, backH = 48;
    const bx = w / 2, by = h * 0.9;
    const backBg = this.add
      .rectangle(bx, by, backW, backH, 0x2d3748, 0.92)
      .setStrokeStyle(2, 0xffffff, 0.7)
      .setDepth(5);
    this.add
      .text(bx, by, '← 返回主選單 (Esc)', { fontFamily: 'monospace', fontSize: '16px', color: '#e2e8f0' })
      .setOrigin(0.5).setDepth(6);
    const back = this.add.container(0, 0, [backBg]).setSize(backW, backH).setDepth(5);
    back.setInteractive(
      new Phaser.Geom.Rectangle(bx - backW / 2, by - backH / 2, backW, backH),
      Phaser.Geom.Rectangle.Contains
    );
    back.on('pointerover', () => backBg.setFillStyle(0x4a5568, 0.96));
    back.on('pointerout', () => backBg.setFillStyle(0x2d3748, 0.92));
    back.on('pointerdown', () => this.scene.start('TitleScene'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC).on('down', () => this.scene.start('TitleScene'));

    // 鍵盤選擇(上下/WS切換選中卡片)+ 空白/Enter 確認進入(同 TitleScene 選 fast/slow 的操作感)
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    const up = () => this.selectCard(this.selected - 1);
    const down = () => this.selectCard(this.selected + 1);
    kb.addKey(KC.UP).on('down', up);
    kb.addKey(KC.W).on('down', up);
    kb.addKey(KC.DOWN).on('down', down);
    kb.addKey(KC.S).on('down', down);
    const confirm = () => { const mg = MINIGAMES[this.selected]; if (mg) this.scene.start(mg.sceneKey); };
    kb.addKey(KC.SPACE).on('down', confirm);
    kb.addKey(KC.ENTER).on('down', confirm);
  }
}
