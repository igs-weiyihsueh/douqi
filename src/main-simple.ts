import Phaser from 'phaser';

// 極簡化的遊戲配置，專注於載入問題診斷
class SimpleBootScene extends Phaser.Scene {
  constructor() {
    super('SimpleBootScene');
  }

  preload() {
    console.log('[SimpleBootScene] 開始預載...');
    // 創建簡單的測試圖形
    this.load.image('test', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==');
  }

  create() {
    console.log('[SimpleBootScene] 創建場景...');
    
    // 創建簡單測試物件
    const rect = this.add.rectangle(640, 360, 100, 100, 0xff0000);
    this.add.text(640, 360, '遊戲載入成功！', { 
      fontSize: '32px', 
      color: '#ffffff',
      fontFamily: 'Arial'
    }).setOrigin(0.5);
    
    // 添加簡單動畫
    this.tweens.add({
      targets: rect,
      rotation: Math.PI * 2,
      duration: 2000,
      repeat: -1
    });
    
    console.log('[SimpleBootScene] 場景創建完成！');
  }
}

// 最簡化的遊戲配置
const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#12131a',
  width: 1280,
  height: 720,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  scene: [SimpleBootScene]
};

// 創建遊戲實例
console.log('開始創建Phaser遊戲...');
const game = new Phaser.Game(config);

// 調試信息
console.log('Phaser遊戲實例已創建:', game);
(window as any).__game = game;
(window as any).__phaser = Phaser;

// 移除載入畫面
setTimeout(() => {
  const loadingElement = document.getElementById('loading');
  if (loadingElement) {
    loadingElement.style.display = 'none';
    console.log('載入畫面已隱藏');
  }
}, 1000);
