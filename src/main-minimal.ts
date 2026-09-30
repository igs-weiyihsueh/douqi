import Phaser from 'phaser';

// 極其簡化的測試
console.log('開始創建最簡遊戲...');

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: 800,
  height: 600,
  backgroundColor: '#2c3e50',
  scene: {
    create() {
      console.log('遊戲場景創建成功！');
      
      // 移除載入畫面
      const loading = document.getElementById('loading');
      if (loading) loading.style.display = 'none';
      
      // 顯示成功信息
      this.add.text(400, 300, '🎮 遊戲載入成功！', {
        fontSize: '32px',
        color: '#ffffff'
      }).setOrigin(0.5);
      
      this.add.text(400, 350, '點擊任意位置繼續', {
        fontSize: '16px',
        color: '#bdc3c7'
      }).setOrigin(0.5);
      
      // 添加點擊事件
      this.input.on('pointerdown', () => {
        this.add.text(400, 400, '✅ 交互正常工作！', {
          fontSize: '20px',
          color: '#2ecc71'
        }).setOrigin(0.5);
      });
    }
  }
};

new Phaser.Game(config);
