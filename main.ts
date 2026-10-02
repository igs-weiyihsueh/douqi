import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GameOverScene } from './scenes/GameOverScene';
import { MinigameMenuScene } from './scenes/MinigameMenuScene';
import { CollectRaceScene } from './scenes/CollectRaceScene';
import { PushSurvivalScene } from './scenes/PushSurvivalScene';
import { BombArenaScene } from './scenes/BombArenaScene';
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
  scene: [BootScene, TitleScene, GameScene, UIScene, GameOverScene, MinigameMenuScene, CollectRaceScene, PushSurvivalScene, BombArenaScene]
};

const game = new Phaser.Game(config);

// 除錯用把 game 實例掛到 window（無害；供自動化測試/主控台檢視）
(window as unknown as { __game: Phaser.Game }).__game = game;

// ★全局防護：阻止F5刷新頁面，但優先讓Phaser處理F5
window.addEventListener('keydown', (event) => {
  if (event.key === 'F5') {
    // 給Phaser一點時間處理，然後才阻止默認行為
    setTimeout(() => {
      event.preventDefault();
      event.stopPropagation();
      console.log('🔒 F5刷新已阻止（延遲攔截），F5專用於遊戲參數編輯器');
    }, 1);
  }
}, false); // 改為bubble模式，讓Phaser優先處理

// 額外防護：阻止右鍵菜單刷新
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
}, false);

console.log('🛡️ 瀏覽器熱鍵防護已啟用');

