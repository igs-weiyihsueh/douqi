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

// ★全局防護：更精準的F5攔截策略
let f5HandledByPhaser = false;

window.addEventListener('keydown', (event) => {
  if (event.key === 'F5') {
    // 等待Phaser處理
    setTimeout(() => {
      if (!f5HandledByPhaser) {
        // 只有當Phaser沒有處理時才阻止默認行為
        event.preventDefault();
        event.stopPropagation();
        console.log('🔒 F5刷新已阻止（Phaser未處理），F5專用於遊戲參數編輯器');
      }
      // 重置標記
      f5HandledByPhaser = false;
    }, 50); // 給Phaser更多時間
  }
}, false);

// 暴露全局標記供Phaser使用
(window as any).__f5HandledByPhaser = () => { f5HandledByPhaser = true; };

// 額外防護：阻止右鍵菜單刷新
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
}, false);

console.log('🛡️ 瀏覽器熱鍵防護已啟用');

