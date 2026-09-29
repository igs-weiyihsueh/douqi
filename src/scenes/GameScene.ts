import Phaser from 'phaser';
import { GameConfig } from '../config';
import { Character } from '../objects/Character';
import { Enemy, type EnemyType } from '../objects/Enemy';
import { Item, type SkillType } from '../objects/Item';
import { Bullet } from '../objects/Bullet';

/**
 * GameScene（重構版）：分離基本遊戲功能和關卡系統
 * 基本功能：4人共玩、波次戰鬥、背景渲染、物理系統
 * 關卡系統：複雜的多區域、選邊功能（可選擇性啟用）
 */
export class GameScene extends Phaser.Scene {
  private characters: Character[] = [];
  
  /** P1 = characters[0]，玩家操作 */
  private get player(): Character {
    return this.characters[0];
  }

  // === 基本遊戲物件 ===
  private enemies!: Phaser.Physics.Arcade.Group;
  private items!: Phaser.Physics.Arcade.Group;
  private bullets!: Phaser.Physics.Arcade.Group;
  private arena!: Phaser.Geom.Rectangle;
  private lockGfx!: Phaser.GameObjects.Graphics;

  // === 遊戲狀態 ===
  private survivalMs = 0;
  private gameOver = false;
  private spawnAccumulator = 0;
  private currentSpawnInterval: number = GameConfig.spawn.initialIntervalMs;

  // === 波次系統 ===
  private currentWave = 1;
  private waveQuota = 0;
  private waveKilled = 0;
  private waveState: 'spawning' | 'intermission' | 'clearing' = 'spawning';
  private intermissionUntil = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    console.log('[GameScene] 開始創建場景');

    // === 創建基本競技場 ===
    this.createBasicArena();
    
    // === 創建遊戲物件群組 ===
    this.createGameObjects();
    
    // === 創建角色 ===
    this.createCharacters();
    
    // === 設置物理碰撞 ===
    this.setupPhysics();
    
    // === 設置輸入控制 ===
    this.setupInput();
    
    // === 初始化波次系統 ===
    this.initializeWaveSystem();
    
    // === 啟動UIScene ===
    this.launchUIScene();
    
    console.log('[GameScene] 場景創建完成');
  }

  /**
   * 創建基本競技場 - 不依賴關卡系統的核心功能
   */
  private createBasicArena(): void {
    console.log('[GameScene] 創建基本競技場');
    
    const pad = GameConfig.arena.padding;
    const arenaX = pad;
    const arenaY = pad;
    const arenaW = GameConfig.width - pad * 2;
    const arenaH = GameConfig.height - pad * 2;

    // 設置競技場區域
    this.arena = new Phaser.Geom.Rectangle(arenaX, arenaY, arenaW, arenaH);
    this.physics.world.setBounds(arenaX, arenaY, arenaW, arenaH);
    this.cameras.main.setBounds(0, 0, GameConfig.width, GameConfig.height);
    
    console.log('[GameScene] 競技場尺寸:', arenaX, arenaY, arenaW, arenaH);
    console.log('[GameScene] 檢查ground貼圖存在:', this.textures.exists('ground'));
    
    // 創建地板背景
    const groundSprite = this.add
      .tileSprite(arenaX, arenaY, arenaW, arenaH, 'ground')
      .setOrigin(0, 0)
      .setDepth(0);
    console.log('[GameScene] ground貼圖創建:', groundSprite ? '成功' : '失敗');
    
    // 創建邊框
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(
      GameConfig.arena.borderThickness,
      GameConfig.arena.borderColor,
      1
    );
    border.strokeRect(arenaX, arenaY, arenaW, arenaH);
    console.log('[GameScene] 競技場邊框創建完成');
  }

  /**
   * 創建遊戲物件群組
   */
  private createGameObjects(): void {
    this.enemies = this.physics.add.group();
    this.items = this.physics.add.group();
    this.bullets = this.physics.add.group();
    
    // 繪圖層
    this.lockGfx = this.add.graphics().setDepth(15);
    
    console.log('[GameScene] 遊戲物件群組創建完成');
  }

  /**
   * 創建4個角色
   */
  private createCharacters(): void {
    // 基本開始位置
    const centerX = GameConfig.width / 2;
    const centerY = GameConfig.height / 2;
    const startPositions = [
      { x: centerX - 50, y: centerY },
      { x: centerX + 50, y: centerY },
      { x: centerX, y: centerY - 50 },
      { x: centerX, y: centerY + 50 }
    ];
    
    for (let i = 0; i < 4; i++) {
      const pos = startPositions[i];
      const character = new Character(this, pos.x, pos.y, i, i > 0);
      this.characters.push(character);
    }
    
    console.log('[GameScene] 4個角色創建完成');
  }

  /**
   * 設置物理碰撞
   */
  private setupPhysics(): void {
    // 角色與敵人碰撞
    this.characters.forEach(char => {
      this.physics.add.overlap(char, this.enemies, this.onCharacterHitEnemy, undefined, this);
    });
    
    // 子彈與敵人碰撞
    this.physics.add.overlap(this.bullets, this.enemies, this.onBulletHitEnemy, undefined, this);
    
    // 角色與道具碰撞
    this.characters.forEach(char => {
      this.physics.add.overlap(char, this.items, this.onCharacterCollectItem, undefined, this);
    });
    
    console.log('[GameScene] 物理碰撞設置完成');
  }

  /**
   * 設置輸入控制
   */
  private setupInput(): void {
    // 滑鼠點擊時觸發玩家行動（暫時簡化版）
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.gameOver && this.player.alive) {
        console.log(`[GameScene] 玩家點擊位置: (${pointer.worldX}, ${pointer.worldY})`);
        // 這裡可以添加角色移動/攻擊邏輯
      }
    });
    
    console.log('[GameScene] 輸入控制設置完成');
  }

  /**
   * 初始化波次系統
   */
  private initializeWaveSystem(): void {
    this.currentWave = 1;
    this.waveQuota = GameConfig.wave.baseQuota;
    this.waveKilled = 0;
    this.waveState = 'spawning';
    this.intermissionUntil = 0;
    
    // 開場生成怪物
    if (GameConfig.spawn.spawnOnStart) {
      this.spawnFormation();
    }
    
    console.log('[GameScene] 波次系統初始化完成');
  }

  /**
   * 啟動UIScene
   */
  private launchUIScene(): void {
    if (!this.scene.isActive('UIScene')) {
      console.log('[GameScene] 啟動UIScene');
      this.scene.launch('UIScene', { gameScene: this });
    } else {
      console.log('[GameScene] UIScene已經運行，跳過啟動');
    }
  }

  /**
   * 主要更新循環
   */
  update(_time: number, delta: number): void {
    if (this.gameOver) return;

    this.survivalMs += delta;

    // 更新角色
    this.characters.forEach(char => char.update(delta));

    // 更新敵人
    this.enemies.children.entries.forEach(enemy => {
      if (enemy instanceof Enemy) {
        enemy.update(delta);
      }
    });

    // 更新道具
    this.items.children.entries.forEach(item => {
      if (item instanceof Item) {
        item.update(delta);
      }
    });

    // 處理波次邏輯
    this.updateWaveLogic(delta);

    // 處理生成
    this.updateSpawning(delta);

    // 更新瞄準標記
    this.updateLockIndicator();

    // 檢查遊戲結束
    this.checkGameOver();
  }

  /**
   * 更新波次邏輯
   */
  private updateWaveLogic(_delta: number): void {
    if (this.waveState === 'intermission') {
      if (this.time.now >= this.intermissionUntil) {
        this.startNextWave();
      }
    }
  }

  /**
   * 更新生成邏輯
   */
  private updateSpawning(delta: number): void {
    if (this.waveState !== 'spawning') return;

    this.spawnAccumulator += delta;
    
    if (this.spawnAccumulator >= this.currentSpawnInterval) {
      // 簡化版生成邏輯：如果場上怪物少於5個且還沒達到波次目標
      if (this.enemies.children.size < 5 && this.waveKilled < this.waveQuota) {
        this.spawnRandomEnemy();
        this.spawnAccumulator = 0;
      }
    }
  }

  /**
   * 生成隨機敵人
   */
  private spawnRandomEnemy(): void {
    const types: EnemyType[] = ['normal', 'tank'];
    const type = Phaser.Utils.Array.GetRandom(types);
    
    const spawnPoint = this.getRandomSpawnPoint();
    const enemy = new Enemy(this, spawnPoint.x, spawnPoint.y);
    enemy.spawn(spawnPoint.x, spawnPoint.y, this.time.now, type);
    this.enemies.add(enemy);
    
    console.log(`[GameScene] 生成敵人: ${type} at (${spawnPoint.x}, ${spawnPoint.y})`);
  }

  /**
   * 生成怪物編隊
   */
  private spawnFormation(): void {
    const formationSize = Math.min(3, this.waveQuota - this.waveKilled);
    
    for (let i = 0; i < formationSize; i++) {
      setTimeout(() => {
        if (this.waveState === 'spawning') {
          this.spawnRandomEnemy();
        }
      }, i * 200);
    }
    
    console.log(`[GameScene] 生成編隊: ${formationSize}個敵人`);
  }

  /**
   * 獲取隨機生成點
   */
  private getRandomSpawnPoint(): { x: number, y: number } {
    const margin = 50;
    const side = Math.random() < 0.5 ? 'left' : 'right';
    
    if (side === 'left') {
      return {
        x: this.arena.left + margin,
        y: Phaser.Math.Between(this.arena.top + margin, this.arena.bottom - margin)
      };
    } else {
      return {
        x: this.arena.right - margin,
        y: Phaser.Math.Between(this.arena.top + margin, this.arena.bottom - margin)
      };
    }
  }

  /**
   * 開始下一波
   */
  private startNextWave(): void {
    this.currentWave++;
    this.waveQuota = Math.floor(GameConfig.wave.baseQuota * Math.pow(1.2, this.currentWave - 1));
    this.waveKilled = 0;
    this.waveState = 'spawning';
    
    console.log(`[GameScene] 開始第${this.currentWave}波，目標擊殺: ${this.waveQuota}`);
    
    // 減少生成間隔
    this.currentSpawnInterval *= 0.95;
    this.currentSpawnInterval = Math.max(this.currentSpawnInterval, GameConfig.spawn.minIntervalMs);
  }

  /**
   * 角色受到敵人傷害
   */
  private onCharacterHitEnemy(character: any, enemy: any): void {
    if (character instanceof Character && enemy instanceof Enemy) {
      const currentTime = this.time.now;
      character.takeDamage(1, currentTime); // 使用固定傷害值1
      
      if (!character.alive) {
        console.log(`[GameScene] 角色${character.index}陣亡`);
      }
    }
  }

  /**
   * 子彈擊中敵人
   */
  private onBulletHitEnemy(bullet: any, enemy: any): void {
    if (bullet instanceof Bullet && enemy instanceof Enemy) {
      const damage = 1; // 固定傷害值
      
      // 簡化版敵人受傷邏輯
      if (enemy.takeDamage) {
        enemy.takeDamage(damage);
      }
      
      bullet.destroy();
      
      // 檢查敵人是否被擊殺
      if (enemy.active === false || (enemy as any).hp <= 0) {
        this.onEnemyKilled(enemy);
      }
    }
  }

  /**
   * 敵人被擊殺
   */
  private onEnemyKilled(enemy: Enemy): void {
    this.waveKilled++;
    console.log(`[GameScene] 擊殺敵人，進度: ${this.waveKilled}/${this.waveQuota}`);
    
    // 掉落道具機率
    if (Math.random() < GameConfig.items.dropChance) {
      this.spawnItem(enemy.x, enemy.y);
    }
    
    // 檢查波次完成
    if (this.waveKilled >= this.waveQuota) {
      this.onWaveComplete();
    }
    
    // 移除敵人
    enemy.destroy();
  }

  /**
   * 波次完成
   */
  private onWaveComplete(): void {
    console.log(`[GameScene] 第${this.currentWave}波完成`);
    
    this.waveState = 'intermission';
    this.intermissionUntil = this.time.now + GameConfig.wave.intermissionMs;
    
    // 顯示過關訊息
    this.showWaveClear();
  }

  /**
   * 顯示過關訊息
   */
  private showWaveClear(): void {
    const centerX = GameConfig.width / 2;
    const centerY = GameConfig.height / 2;
    
    const text = this.add.text(centerX, centerY, `第${this.currentWave}波完成！`, {
      fontSize: '48px',
      color: '#00ff00',
      stroke: '#000000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(100);
    
    // 2秒後淡出
    this.tweens.add({
      targets: text,
      alpha: 0,
      duration: 2000,
      onComplete: () => text.destroy()
    });
  }

  /**
   * 生成道具
   */
  private spawnItem(x: number, y: number): void {
    const types: SkillType[] = ['A', 'B', 'C'];
    const type = Phaser.Utils.Array.GetRandom(types);
    
    const item = new Item(this, x, y);
    item.spawnItem(x, y, type, this.time.now);
    this.items.add(item);
    
    console.log(`[GameScene] 生成道具: ${type} at (${x}, ${y})`);
  }

  /**
   * 角色收集道具
   */
  private onCharacterCollectItem(character: any, item: any): void {
    if (character instanceof Character && item instanceof Item) {
      // 簡化版道具收集邏輯
      console.log(`[GameScene] 角色${character.index}收集道具`);
      item.destroy();
    }
  }

  /**
   * 更新瞄準標記
   */
  private updateLockIndicator(): void {
    this.lockGfx.clear();
    
    if (this.player.alive && this.player.lockedTarget) {
      const target = this.player.lockedTarget;
      if (target && target.active) {
        this.lockGfx.lineStyle(3, 0xff0000, 1);
        this.lockGfx.strokeCircle(target.x, target.y, 25);
      }
    }
  }

  /**
   * 檢查遊戲結束
   */
  private checkGameOver(): void {
    const aliveCount = this.characters.filter(char => char.alive).length;
    
    if (aliveCount === 0 && !this.gameOver) {
      this.gameOver = true;
      console.log('[GameScene] 遊戲結束 - 全員陣亡');
      
      // 延遲顯示遊戲結束畫面
      this.time.delayedCall(2000, () => {
        this.scene.start('GameOverScene', {
          survivalMs: this.survivalMs,
          wavesCleared: this.currentWave - 1
        });
      });
    }
  }

  /**
   * 重新開始遊戲
   */
  restart(): void {
    console.log('[GameScene] 重新開始遊戲');
    
    // 停止UIScene
    if (this.scene.isActive('UIScene')) {
      this.scene.stop('UIScene');
    }
    
    // 重新啟動GameScene
    this.scene.restart();
  }

  // === 外部介面方法 ===
  
  /**
   * 獲取存活角色列表
   */
  getAliveCharacters(): Character[] {
    return this.characters.filter(char => char.alive);
  }

  /**
   * 獲取遊戲統計
   */
  getGameStats() {
    return {
      survivalMs: this.survivalMs,
      currentWave: this.currentWave,
      waveKilled: this.waveKilled,
      waveQuota: this.waveQuota,
      aliveCharacters: this.getAliveCharacters().length
    };
  }

  /**
   * 獲取玩家角色
   */
  getPlayer(): Character {
    return this.player;
  }

  /**
   * 是否遊戲結束
   */
  isGameOver(): boolean {
    return this.gameOver;
  }
}
