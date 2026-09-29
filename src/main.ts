import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameConfig } from './config';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#12131a',
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: GameConfig.width,
    height: GameConfig.height
  },
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scene: [BootScene, TitleScene, GameScene, UIScene, GameOverScene]
};

console.log('正在創建Phaser遊戲實例...');
const game = new Phaser.Game(config);

// 除錯用把 game 實例掛到 window
(window as unknown as { __game: Phaser.Game }).__game = game;
console.log('Phaser遊戲實例創建完成！');

// 添加遊戲初始化檢測
game.events.once('ready', () => {
  console.log('遊戲初始化完成，所有場景已註冊');
  console.log('註冊的場景:', game.scene.keys);
  
  // 檢查關鍵貼圖是否存在
  const bootScene = game.scene.getScene('BootScene') as any;
  if (bootScene && bootScene.textures) {
    console.log('檢查ground貼圖:', bootScene.textures.exists('ground'));
    console.log('可用貼圖數量:', Object.keys(bootScene.textures.list).length);
    
    // 列出一些關鍵貼圖
    const keyTextures = ['ground', 'char-0', 'enemy-normal', 'item-A'];
    keyTextures.forEach(key => {
      console.log(`貼圖 ${key}:`, bootScene.textures.exists(key));
    });
  }
  
  // 添加貼圖載入錯誤監聽
  game.events.on('textureloaderror', (event: any) => {
    console.error('貼圖載入錯誤:', event);
  });
});
