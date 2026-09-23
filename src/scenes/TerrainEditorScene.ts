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
    console.log('🏔️ 地形編輯器場景啟動 (新版)');
    
    // 設置背景 - 與GameScene保持一致的視覺風格
    this.add.tileSprite(0, 0, GameConfig.width, GameConfig.height, 'ground')
      .setOrigin(0, 0)
      .setDepth(0);
    
    // 半透明遮罩，讓UI更清楚
    this.add.rectangle(0, 0, GameConfig.width, GameConfig.height, 0x0a0c14, 0.3)
      .setOrigin(0, 0)
      .setDepth(1);
    
    // 創建預覽區域容器 - 確保座標系統與GameScene完全一致
    this.createPreviewArea();
    
    // 創建UI控制面板
    this.createControlPanel();
    
    // 設置返回功能
    this.setupReturnControls();
  }

  /**
   * 創建預覽區域 - 座標系統與實際遊戲畫面完全一致
   */
  private createPreviewArea(): void {
    // 預覽區域邊框 - 顯示實際遊戲區域範圍
    const previewBorder = this.add.graphics();
    previewBorder.lineStyle(2, 0xffffff, 0.5);
    previewBorder.strokeRect(0, 0, GameConfig.width, GameConfig.height);
    previewBorder.setDepth(10);
    
    // 添加座標系參考線
    this.createCoordinateReference();
    
    // 添加預覽區域標題
    this.add.text(GameConfig.width / 2, 30, '地形預覽區域', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    })
    .setOrigin(0.5)
    .setDepth(15);
    
    // 座標系說明
    this.add.text(GameConfig.width / 2, 60, `遊戲座標系：${GameConfig.width} × ${GameConfig.height}`, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#cccccc',
      stroke: '#000000',
      strokeThickness: 1
    })
    .setOrigin(0.5)
    .setDepth(15);
  }

  /**
   * 創建座標系參考線
   */
  private createCoordinateReference(): void {
    const refLines = this.add.graphics();
    refLines.lineStyle(1, 0x666666, 0.3);
    
    // 中心十字線
    const centerX = GameConfig.width / 2;
    const centerY = GameConfig.height / 2;
    
    // 垂直中心線
    refLines.moveTo(centerX, 0);
    refLines.lineTo(centerX, GameConfig.height);
    
    // 水平中心線
    refLines.moveTo(0, centerY);
    refLines.lineTo(GameConfig.width, centerY);
    
    // 網格線 (每100px一條)
    for (let x = 100; x < GameConfig.width; x += 100) {
      refLines.moveTo(x, 0);
      refLines.lineTo(x, GameConfig.height);
    }
    
    for (let y = 100; y < GameConfig.height; y += 100) {
      refLines.moveTo(0, y);
      refLines.lineTo(GameConfig.width, y);
    }
    
    refLines.strokePath();
    refLines.setDepth(2);
    
    // 座標標註
    this.add.text(10, 10, '(0, 0)', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#999999'
    })
    .setDepth(15);
    
    this.add.text(GameConfig.width - 80, GameConfig.height - 25, `(${GameConfig.width}, ${GameConfig.height})`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#999999'
    })
    .setDepth(15);
  }

  /**
   * 創建控制面板
   */
  private createControlPanel(): void {
    // 控制面板背景
    const panelBg = this.add.rectangle(GameConfig.width / 2, GameConfig.height - 80, 600, 120, 0x1a1a1a, 0.9);
    panelBg.setStrokeStyle(2, 0x666666, 0.8);
    panelBg.setDepth(20);
    
    // 面板標題
    this.add.text(GameConfig.width / 2, GameConfig.height - 130, '地形編輯器控制面板', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 2
    })
    .setOrigin(0.5)
    .setDepth(25);
    
    // 狀態信息
    this.add.text(GameConfig.width / 2, GameConfig.height - 100, '預覽模式 - 編輯功能開發中', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffdd44',
      stroke: '#000000',
      strokeThickness: 1
    })
    .setOrigin(0.5)
    .setDepth(25);
    
    // 返回按鈕
    this.createReturnButton();
  }

  /**
   * 創建返回按鈕
   */
  private createReturnButton(): void {
    const btnWidth = 160;
    const btnHeight = 40;
    const btnX = GameConfig.width / 2;
    const btnY = GameConfig.height - 50;
    
    // 按鈕背景
    const btnBg = this.add.rectangle(btnX, btnY, btnWidth, btnHeight, 0xff5a6e, 0.9);
    btnBg.setStrokeStyle(2, 0xffffff, 0.9);
    btnBg.setDepth(25);
    
    // 按鈕文字
    this.add.text(btnX, btnY, '返回主菜單 (Esc)', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold'
    })
    .setOrigin(0.5)
    .setDepth(30);
    
    // 按鈕交互
    const btnContainer = this.add.container(0, 0, [btnBg]);
    btnContainer.setSize(btnWidth, btnHeight);
    btnContainer.setInteractive(
      new Phaser.Geom.Rectangle(btnX - btnWidth / 2, btnY - btnHeight / 2, btnWidth, btnHeight),
      Phaser.Geom.Rectangle.Contains
    );
    
    btnContainer.on('pointerover', () => btnBg.setFillStyle(0xff7a8b, 0.95));
    btnContainer.on('pointerout', () => btnBg.setFillStyle(0xff5a6e, 0.9));
    btnContainer.on('pointerdown', () => this.returnToTitle());
    btnContainer.setDepth(25);
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
