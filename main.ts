import Phaser from 'phaser';
import { SpinePlugin } from '@esotericsoftware/spine-phaser';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GameOverScene } from './scenes/GameOverScene';
import { MinigameMenuScene } from './scenes/MinigameMenuScene';
import { CollectRaceScene } from './scenes/CollectRaceScene';
import { PushSurvivalScene } from './scenes/PushSurvivalScene';
import { BombArenaScene } from './scenes/BombArenaScene';
import { PeachLotteryScene } from './scenes/PeachLotteryScene';
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
  // Spine 動畫（怪物骨架動畫，見 EnemySpineController）
  plugins: {
    scene: [{ key: 'spine.SpinePlugin', plugin: SpinePlugin, mapping: 'spine' }]
  },
  physics: {
    default: 'arcade',
    arcade: {
      debug: false
    }
  },
  scene: [BootScene, TitleScene, GameScene, UIScene, GameOverScene, MinigameMenuScene, CollectRaceScene, PushSurvivalScene, BombArenaScene, PeachLotteryScene]
};

const game = new Phaser.Game(config);

// 除錯用把 game 實例掛到 window（無害；供自動化測試/主控台檢視）
(window as unknown as { __game: Phaser.Game }).__game = game;

// 額外防護：阻止右鍵菜單刷新
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
}, false);

console.log('🛡️ 瀏覽器右鍵防護已啟用（參數編輯器改用UI按鈕）');

