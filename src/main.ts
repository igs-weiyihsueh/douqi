import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
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
  scene: [BootScene, TitleScene, GameScene]
};

console.log('正在創建Phaser遊戲實例...');
const game = new Phaser.Game(config);

// 除錯用把 game 實例掛到 window
(window as unknown as { __game: Phaser.Game }).__game = game;
console.log('Phaser遊戲實例創建完成！');
