import Phaser from 'phaser';
import { LevelManager } from '@/managers/LevelManager';
import type { Objective } from '@/types/LevelTypes';

/**
 * 鬥氣割草 - 主遊戲場景（支援關卡載入系統）
 * 整合關卡管理器，支援動態載入關卡配置
 */
export class LevelGameScene extends Phaser.Scene {
  // 關卡系統
  private levelManager!: LevelManager;
  private currentLevelName: string = '';
  private customLevelData: any = null;
  private isCustomLevel: boolean = false;
  
  // 遊戲物件
  private player!: Phaser.GameObjects.Sprite;
  private enemies!: Phaser.Physics.Arcade.Group;
  private collectibles!: Phaser.Physics.Arcade.Group;
  private powerups!: Phaser.Physics.Arcade.Group;
  
  // UI 元素
  private scoreText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private objectiveText!: Phaser.GameObjects.Text;
  private uiContainer!: Phaser.GameObjects.Container;

  // 遊戲狀態
  private gameStarted: boolean = false;
  private gamePaused: boolean = false;

  constructor() {
    super({ key: 'LevelGameScene' });
  }

  init(data: { levelName?: string, levelData?: any, isCustomLevel?: boolean } = {}) {
    this.currentLevelName = data.levelName || 'test_level';
    this.customLevelData = data.levelData || null;
    this.isCustomLevel = data.isCustomLevel || false;
    
    if (this.isCustomLevel && this.customLevelData) {
      console.log(`[LevelGameScene] 初始化自定義關卡: ${this.customLevelData.level?.name}`);
    } else {
      console.log(`[LevelGameScene] 初始化內建關卡: ${this.currentLevelName}`);
    }
  }

  preload() {
    // 建立臨時素材（實際專案中應載入真實圖片）
    this.createTemporaryAssets();
  }

  create() {
    console.log('[LevelGameScene] 建立場景');

    // 初始化物理系統
    this.setupPhysics();
    
    // 初始化關卡管理器
    this.setupLevelManager();
    
    // 建立遊戲群組
    this.createGameGroups();
    
    // 建立玩家
    this.createPlayer();
    
    // 建立 UI
    this.createUI();
    
    // 設定輸入
    this.setupInput();
    
    // 載入關卡
    this.loadCurrentLevel();
  }

  /**
   * 設定物理系統
   */
  private setupPhysics(): void {
    this.physics.world.setBounds(0, 0, 1600, 1200);
    this.cameras.main.setBounds(0, 0, 1600, 1200);
  }

  /**
   * 初始化關卡管理器
   */
  private setupLevelManager(): void {
    this.levelManager = new LevelManager(this);
    
    // 設定回調函數
    this.levelManager.setObjectiveCompleteCallback((objective: Objective) => {
      this.onObjectiveComplete(objective);
    });
    
    this.levelManager.setLevelCompleteCallback(() => {
      this.onLevelComplete();
    });
    
    this.levelManager.setLevelFailedCallback(() => {
      this.onLevelFailed();
    });
  }

  /**
   * 建立遊戲物件群組
   */
  private createGameGroups(): void {
    // 建立物理群組
    this.enemies = this.physics.add.group({
      runChildUpdate: true
    });
    
    this.collectibles = this.physics.add.group();
    this.powerups = this.physics.add.group();

    // 設定碰撞檢測
    this.physics.add.overlap(this.player, this.collectibles, this.collectItem as any, undefined, this);
    this.physics.add.overlap(this.player, this.powerups, this.collectPowerup as any, undefined, this);
    this.physics.add.overlap(this.player, this.enemies, this.playerHitEnemy as any, undefined, this);
  }

  /**
   * 建立玩家
   */
  private createPlayer(): void {
    // 建立玩家精靈（暫時位置，會被關卡設定覆蓋）
    this.player = this.physics.add.sprite(400, 300, 'player');
    this.player.setName('player');
    
    // 設定玩家物理屬性
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    if (playerBody) {
      playerBody.setSize(30, 30);
      playerBody.setMaxVelocity(200, 200);
      playerBody.setDrag(300, 300);
      playerBody.setCollideWorldBounds(true);
    }
    
    // 攝影機跟隨玩家
    this.cameras.main.startFollow(this.player);
    this.cameras.main.setZoom(0.8);
  }

  /**
   * 建立 UI
   */
  private createUI(): void {
    // UI 容器
    this.uiContainer = this.add.container(0, 0);
    this.uiContainer.setScrollFactor(0); // 固定在螢幕上
    
    // 分數顯示
    this.scoreText = this.add.text(20, 20, '分數: 0', {
      fontSize: '24px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 10, y: 5 }
    });
    
    // 計時器顯示
    this.timerText = this.add.text(20, 60, '時間: 00:00', {
      fontSize: '20px',
      color: '#ffffff',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 10, y: 5 }
    });
    
    // 目標顯示
    this.objectiveText = this.add.text(20, 100, '目標: 載入中...', {
      fontSize: '18px',
      color: '#ffff00',
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 10, y: 5 }
    });
    
    // 將 UI 元素加入容器
    this.uiContainer.add([this.scoreText, this.timerText, this.objectiveText]);
  }

  /**
   * 設定輸入控制
   */
  private setupInput(): void {
    // 滑鼠控制
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.gameStarted || this.gamePaused) return;
      
      // 玩家朝滑鼠方向移動
      const angle = Phaser.Math.Angle.Between(
        this.player.x, this.player.y,
        pointer.worldX, pointer.worldY
      );
      
      const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
      if (playerBody) {
        this.physics.velocityFromAngle(
          angle * 180 / Math.PI,
          200,
          playerBody.velocity
        );
      }
    });

    // 暫停鍵
    this.input.keyboard!.on('keydown-ESC', () => {
      this.togglePause();
    });

    // 重新載入關卡（開發用）
    this.input.keyboard!.on('keydown-R', () => {
      this.scene.restart({ levelName: this.currentLevelName });
    });
  }

  /**
   * 載入當前關卡
   */
  private async loadCurrentLevel(): Promise<void> {
    try {
      if (this.isCustomLevel && this.customLevelData) {
        console.log('[LevelGameScene] 載入自定義關卡:', this.customLevelData.level?.name);
        
        // 顯示載入訊息
        this.showMessage('載入自定義關卡中...', 2000);
        
        // 直接載入自定義關卡數據
        await this.levelManager.initCustomLevel(this.customLevelData);
        
      } else {
        console.log(`[LevelGameScene] 開始載入內建關卡: ${this.currentLevelName}`);
        
        // 顯示載入訊息
        this.showMessage('載入關卡中...', 2000);
        
        // 載入內建關卡
        await this.levelManager.initLevel(this.currentLevelName);
      }
      
      // 更新 UI
      this.updateUI();
      
      // 開始遊戲
      this.gameStarted = true;
      
      console.log('[LevelGameScene] 關卡載入完成');
      this.showMessage('關卡載入完成！開始遊戲！', 2000, 0x00ff00);
      
    } catch (error) {
      console.error('[LevelGameScene] 關卡載入失敗:', error);
      this.showMessage(`關卡載入失敗: ${error}`, 5000, 0xff0000);
      
      // 載入失敗時返回關卡選擇
      this.time.delayedCall(3000, () => {
        this.scene.start('LevelSelectScene');
      });
    }
  }

  update() {
    if (!this.gameStarted || this.gamePaused) return;
    
    // 更新 UI
    this.updateUI();
  }

  /**
   * 更新 UI 顯示
   */
  private updateUI(): void {
    const levelState = this.levelManager.getLevelState();
    const currentLevel = this.levelManager.getCurrentLevel();
    
    if (!currentLevel) return;

    // 更新分數
    this.scoreText.setText(`分數: ${levelState.currentScore} / ${currentLevel.level.scoreTarget}`);
    
    // 更新計時器
    const minutes = Math.floor(levelState.timeRemaining / 60);
    const seconds = levelState.timeRemaining % 60;
    this.timerText.setText(`時間: ${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
    
    // 更新目標進度
    const totalObjectives = currentLevel.gameplay.objectives.length;
    this.objectiveText.setText(`目標: ${levelState.objectivesCompleted} / ${totalObjectives} 完成`);
  }

  /**
   * 碰撞處理 - 收集物品
   */
  private collectItem(_player: any, item: any): void {
    const itemSprite = item as Phaser.GameObjects.Sprite;
    const value = itemSprite.getData('value') || 10;
    
    // 透過關卡管理器增加分數
    this.levelManager.addScore(value);
    
    // 移除物品
    item.destroy();
    
    // 播放收集效果
    this.playCollectEffect(itemSprite.x, itemSprite.y);
  }

  /**
   * 碰撞處理 - 收集強化道具
   */
  private collectPowerup(_player: any, powerup: any): void {
    const powerupSprite = powerup as Phaser.GameObjects.Sprite;
    const effectType = powerupSprite.getData('effectType') || 'speed_boost';
    
    console.log(`[LevelGameScene] 使用強化道具: ${effectType}`);
    
    // 移除道具
    powerup.destroy();
    
    // 播放強化效果
    this.playPowerupEffect(powerupSprite.x, powerupSprite.y);
  }

  /**
   * 碰撞處理 - 玩家碰到敵人
   */
  private playerHitEnemy(player: any, enemy: any): void {
    // 簡單的傷害處理
    console.log('[LevelGameScene] 玩家受到傷害');
    
    // 擊退效果
    const enemySprite = enemy as Phaser.GameObjects.Sprite;
    const playerSprite = player as Phaser.GameObjects.Sprite;
    const angle = Phaser.Math.Angle.Between(enemySprite.x, enemySprite.y, playerSprite.x, playerSprite.y);
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    if (playerBody) {
      this.physics.velocityFromAngle(angle * 180 / Math.PI, 300, playerBody.velocity);
    }
  }

  /**
   * 目標完成回調
   */
  private onObjectiveComplete(objective: Objective): void {
    console.log(`[LevelGameScene] 目標完成: ${objective.description}`);
    this.showMessage(`目標完成: ${objective.description} (+${objective.reward} 分)`, 3000, 0x00ff00);
    
    // 播放完成音效和特效
    this.playObjectiveCompleteEffect();
  }

  /**
   * 關卡完成回調
   */
  private onLevelComplete(): void {
    console.log('[LevelGameScene] 關卡完成！');
    this.gameStarted = false;
    
    this.showMessage('關卡完成！恭喜！', 5000, 0x00ff00);
    
    // 3 秒後回到選單或載入下一關
    this.time.delayedCall(3000, () => {
      this.scene.start('MinigameMenuScene'); // 或者載入下一關
    });
  }

  /**
   * 關卡失敗回調
   */
  private onLevelFailed(): void {
    console.log('[LevelGameScene] 關卡失敗');
    this.gameStarted = false;
    
    this.showMessage('關卡失敗！時間用完了...', 5000, 0xff0000);
    
    // 3 秒後重新開始或回到選單
    this.time.delayedCall(3000, () => {
      this.scene.restart({ levelName: this.currentLevelName });
    });
  }

  /**
   * 切換暫停狀態
   */
  private togglePause(): void {
    this.gamePaused = !this.gamePaused;
    
    if (this.gamePaused) {
      this.physics.pause();
      this.showMessage('遊戲暫停 (按 ESC 繼續)', 0, 0xffff00);
    } else {
      this.physics.resume();
    }
  }

  /**
   * 顯示訊息
   */
  private showMessage(text: string, duration: number = 2000, color: number = 0xffffff): void {
    const messageText = this.add.text(400, 200, text, {
      fontSize: '28px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      backgroundColor: 'rgba(0,0,0,0.8)',
      padding: { x: 20, y: 10 },
      align: 'center'
    }).setOrigin(0.5).setScrollFactor(0);

    if (duration > 0) {
      this.tweens.add({
        targets: messageText,
        alpha: 0,
        y: messageText.y - 50,
        duration: duration,
        ease: 'Power2',
        onComplete: () => messageText.destroy()
      });
    } else {
      // 永久顯示，需手動清除
      this.time.delayedCall(100, () => {
        messageText.setData('persistent', true);
      });
    }
  }

  /**
   * 播放收集效果
   */
  private playCollectEffect(x: number, y: number): void {
    // 簡單的粒子效果
    const circle = this.add.circle(x, y, 10, 0xffff00);
    circle.setScrollFactor(0.5);
    
    this.tweens.add({
      targets: circle,
      scaleX: 3,
      scaleY: 3,
      alpha: 0,
      duration: 300,
      onComplete: () => circle.destroy()
    });
  }

  /**
   * 播放強化效果
   */
  private playPowerupEffect(x: number, y: number): void {
    const ring = this.add.circle(x, y, 20, 0x00ff00, 0.5);
    
    this.tweens.add({
      targets: ring,
      scaleX: 4,
      scaleY: 4,
      alpha: 0,
      duration: 600,
      onComplete: () => ring.destroy()
    });
  }

  /**
   * 播放目標完成效果
   */
  private playObjectiveCompleteEffect(): void {
    // 螢幕閃光效果
    const flash = this.add.rectangle(400, 300, 800, 600, 0xffffff, 0.3);
    flash.setScrollFactor(0);
    
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 500,
      onComplete: () => flash.destroy()
    });
  }

  /**
   * 建立臨時素材
   */
  private createTemporaryAssets(): void {
    // 建立簡單的顏色方塊作為臨時素材
    const graphics = this.add.graphics();
    
    // 玩家 - 藍色方塊
    graphics.fillStyle(0x0080ff);
    graphics.fillRect(0, 0, 32, 32);
    graphics.generateTexture('player', 32, 32);
    
    graphics.clear();
  }

  /**
   * 載入指定關卡
   */
  loadLevel(levelName: string): void {
    this.currentLevelName = levelName;
    this.scene.restart({ levelName: levelName });
  }

  /**
   * 場景清理
   */
  destroy(): void {
    if (this.levelManager) {
      this.levelManager.destroy();
    }
  }
}
