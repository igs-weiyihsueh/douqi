import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * 🏔️ 地形編輯器場景 (重新實作版)
 * 
 * 基礎功能：
 * - 預覽畫面：座標系統與實際遊戲畫面完全一致
 * - 返回主菜單功能
 * - 為後續編輯功能預留擴展空間
 */
export class TerrainEditorScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TerrainEditorScene' });
  }

  create(): void {
    console.log('🏔️ 地形編輯器場景啟動 (簡化版)');
    
    // 計算實際遊戲區域邊界 (與 GameScene 完全一致)
    const pad = GameConfig.arena.padding; // 48px
    const arenaX = pad;
    const arenaY = pad;
    const arenaW = GameConfig.width - pad * 2;  // 1184px
    const arenaH = GameConfig.height - pad * 2; // 624px
    
    // 設置黑色背景 (外圍區域)
    this.add.rectangle(0, 0, GameConfig.width, GameConfig.height, 0x000000)
      .setOrigin(0, 0)
      .setDepth(0);
    
    // 創建實際遊戲區域背景 - 與GameScene保持一致
    this.add.tileSprite(arenaX, arenaY, arenaW, arenaH, 'ground')
      .setOrigin(0, 0)
      .setDepth(1);
    
    // 添加遊戲區域邊框 (與 GameScene 圍欄一致)
    const border = this.add.graphics().setDepth(2);
    border.lineStyle(
      GameConfig.arena.borderThickness,
      GameConfig.arena.borderColor,
      1.0
    );
    border.strokeRect(arenaX, arenaY, arenaW, arenaH);
    
    // 設置返回功能
    this.setupReturnControls();
  }

  /**
   * 設置返回控制
   */
  private setupReturnControls(): void {
    // ESC鍵返回
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.ESC)
      .on('down', () => this.returnToTitle());
  }

  /**
   * 返回主菜單
   */
  private returnToTitle(): void {
    console.log('返回主菜單');
    this.scene.start('TitleScene');
  }
}
