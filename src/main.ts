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
import { TerrainEditorScene } from './scenes/TerrainEditorScene';
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
  scene: [BootScene, TitleScene, GameScene, UIScene, GameOverScene, MinigameMenuScene, CollectRaceScene, PushSurvivalScene, BombArenaScene, TerrainEditorScene]
};

const game = new Phaser.Game(config);

// 除錯用把 game 實例掛到 window（無害；供自動化測試/主控台檢視）
(window as unknown as { __game: Phaser.Game }).__game = game;
