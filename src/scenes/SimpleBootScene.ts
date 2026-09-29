import Phaser from 'phaser';
import { LightGameConfig } from '../config-light';

/**
 * 簡化版啟動場景：只創建基礎貼圖，專注於載入速度
 */
export class SimpleBootScene extends Phaser.Scene {
  constructor() {
    super('SimpleBootScene');
  }

  create(): void {
    console.log('[SimpleBootScene] 開始創建基礎貼圖...');
    
    // 創建角色貼圖
    const colors = LightGameConfig.characters.colors;
    for (let i = 0; i < LightGameConfig.characters.count; i++) {
      this.makeHumanoidTexture(`char-${i}`, LightGameConfig.player.radius, colors[i], 0xffffff);
    }
    
    // 創建敵人貼圖
    const enemyType = LightGameConfig.enemy.types.normal;
    this.makeCircleTexture('enemy-normal', enemyType.radius, enemyType.color, enemyType.stroke);
    
    // 創建基礎粒子貼圖
    this.makeParticleTexture();
    
    console.log('[SimpleBootScene] 基礎貼圖創建完成，跳轉到標題場景');
    
    // 檢查URL參數決定跳轉
    const urlParams = new URLSearchParams(window.location.search);
    const startScene = urlParams.get('scene');
    
    if (startScene === 'levelSelect') {
      console.log('[SimpleBootScene] 編輯器測試模式：直接進入關卡選擇');
      // 暫時跳回標題，因為LevelSelectScene可能需要完整配置
      this.scene.start('TitleScene');
    } else {
      this.scene.start('TitleScene');
    }
  }

  /** 創建人型角色貼圖 */
  private makeHumanoidTexture(key: string, radius: number, color: number, _strokeColor: number): void {
    const size = radius * 2 + 6;
    const g = this.add.graphics();
    
    // 簡化的人型：圓頭 + 矩形身體
    g.fillStyle(color);
    g.fillCircle(size/2, size/3, radius/2); // 頭
    g.fillRect(size/2 - radius/3, size/3 + radius/3, radius*2/3, radius); // 身體
    
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 創建圓形貼圖 */
  private makeCircleTexture(key: string, radius: number, color: number, strokeColor: number): void {
    const size = radius * 2 + 6;
    const g = this.add.graphics();
    
    // 填滿
    g.fillStyle(color);
    g.fillCircle(size/2, size/2, radius);
    
    // 外框
    g.lineStyle(2, strokeColor);
    g.strokeCircle(size/2, size/2, radius);
    
    g.generateTexture(key, size, size);
    g.destroy();
  }

  /** 創建粒子貼圖 */
  private makeParticleTexture(): void {
    const g = this.add.graphics();
    g.fillStyle(0xffffff);
    g.fillCircle(2, 2, 2);
    g.generateTexture('particle', 4, 4);
    g.destroy();
  }
}
