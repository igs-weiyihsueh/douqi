import Phaser from 'phaser';
import { GameConfig } from '../config';

interface GameOverData {
  teamKills: number;
  perKills: number[];
  labels: string[];
  survivalMs: number;
  /** v25 第8項：本場 P1 普攻總命中次數 */
  p1AttackHits?: number;
  /** v39：是否為「通關」（打倒第 8 關 BOSS）；true=通關畫面、false/未給=全員陣亡 */
  won?: boolean;
  /** v46：本場操作模式，重開時沿用 */
  controlMode?: 'fast' | 'slow';
}

/**
 * GameOverScene（v6）：全員陣亡後的結算。
 * 顯示團隊總擊殺、各角色擊殺、存活時間，可重新開始。
 */
export class GameOverScene extends Phaser.Scene {
  private restarting = false;
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private controlMode: 'fast' | 'slow' = 'fast'; // v46：沿用本場模式重開
  private onSpace = (): void => this.restart();

  constructor() {
    super('GameOverScene');
  }

  create(data: GameOverData): void {
    // 根因修復①：每次 create 重設旗標（Phaser 重用同一 scene 實例，屬性不會自動歸零）
    this.restarting = false;
    this.controlMode = data.controlMode === 'slow' ? 'slow' : 'fast'; // v46

    const w = GameConfig.width;
    const h = GameConfig.height;

    this.add.rectangle(0, 0, w, h, 0x000000, 0.7).setOrigin(0, 0);

    // v39：通關(won)顯示金色「通關！」；否則紅色「全員陣亡」
    this.add
      .text(w / 2, h / 2 - 150, data.won ? '通關！擊倒最終 BOSS' : '全員陣亡', {
        fontFamily: 'monospace',
        fontSize: '46px',
        color: data.won ? '#ffd700' : '#ff5a6e',
        stroke: '#000000',
        strokeThickness: 6
      })
      .setOrigin(0.5);

    this.add
      .text(w / 2, h / 2 - 80, `團隊總分（總擊殺）：${data.teamKills}`, {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#ffe66d'
      })
      .setOrigin(0.5);

    this.add
      .text(w / 2, h / 2 - 42, `存活時間：${(data.survivalMs / 1000).toFixed(1)} 秒`, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#ffffff'
      })
      .setOrigin(0.5);

    // 各自擊殺
    const perLine = data.perKills
      .map((k, i) => `${data.labels[i] ?? 'P' + (i + 1)}: ${k}`)
      .join('    ');
    this.add
      .text(w / 2, h / 2 + 2, perLine, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#cbd5e1'
      })
      .setOrigin(0.5);

    // v25 第8項：本場 P1 普攻總命中次數
    this.add
      .text(w / 2, h / 2 + 32, `P1 普攻命中次數：${data.p1AttackHits ?? 0}`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#8be9fd'
      })
      .setOrigin(0.5);

    const btn = this.add
      .text(w / 2, h / 2 + 70, '  重新開始  ', {
        fontFamily: 'monospace',
        fontSize: '26px',
        color: '#0a0a0a',
        backgroundColor: '#4ade80',
        padding: { x: 12, y: 8 }
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setStyle({ backgroundColor: '#86efac' }));
    btn.on('pointerout', () => btn.setStyle({ backgroundColor: '#4ade80' }));
    btn.on('pointerdown', () => this.restart());

    // 根因修復②：SPACE 監聽用具名 handler，並在 shutdown 時移除，避免跨場景累積/殘留
    this.spaceKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.spaceKey.on('down', this.onSpace);
    this.input.keyboard!.on('keydown-SPACE', this.onSpace);
    // 點畫面任一處也可重開
    this.input.on('pointerdown', this.onSpace);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.spaceKey?.off('down', this.onSpace);
      this.input.keyboard?.off('keydown-SPACE', this.onSpace);
      this.input.off('pointerdown', this.onSpace);
      // 移除這顆 key，避免下次重複註冊
      if (this.spaceKey) {
        this.input.keyboard?.removeKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.spaceKey = undefined;
      }
    });

    this.add
      .text(w / 2, h / 2 + 120, '（點擊按鈕/畫面或按空白鍵重新開始）', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#94a3b8'
      })
      .setOrigin(0.5);
  }

  private restart(): void {
    if (this.restarting) return; // 防同一幀重複觸發
    this.restarting = true;
    // 根因修復③：GameScene 已被 stop（非 pause，見 triggerGameOver），這裡乾淨全新啟動。
    // 先停 UI 與自己，再 start GameScene（會重跑 init/create，狀態全新）+ 重啟 UIScene。
    this.scene.stop('UIScene');
    this.scene.start('GameScene', { controlMode: this.controlMode }); // v46：沿用本場模式
    this.scene.launch('UIScene');
    this.scene.stop(); // 停掉自己（GameOverScene），放最後避免中斷上面的排程
  }
}
