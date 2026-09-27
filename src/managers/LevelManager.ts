import { LevelLoader } from '@/managers/LevelLoader';
import { LevelConfigScanner } from '@/managers/LevelConfigScanner';
import { EntitySpawner } from '@/systems/EntitySpawner';
import { EventTrigger } from '@/systems/EventTrigger';
import { ObjectReplacementSystem } from '@/systems/ObjectReplacementSystem';
import type { 
  LevelData, 
  LevelState, 
  PhaserEntity, 
  Objective,
  GameEntity,
  EntityProperties
} from '@/types/LevelTypes';

/**
 * 鬥氣割草 - 關卡管理器
 * 統合關卡載入、實體生成、事件觸發等系統，提供完整的關卡遊戲邏輯
 */
export class LevelManager {
  private scene: Phaser.Scene;
  private levelLoader: LevelLoader;
  private configScanner: LevelConfigScanner;
  private entitySpawner: EntitySpawner;
  private eventTrigger: EventTrigger;
  private objectReplacement: ObjectReplacementSystem;
  
  private currentLevel: LevelData | null = null;
  private levelState: LevelState;
  private gameTimer?: Phaser.Time.TimerEvent;
  
  // 回調函數
  private onObjectiveComplete?: (objective: Objective) => void;
  private onLevelComplete?: () => void;
  private onLevelFailed?: () => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.levelLoader = new LevelLoader();
    this.configScanner = new LevelConfigScanner();
    this.entitySpawner = new EntitySpawner(scene);
    this.eventTrigger = new EventTrigger(scene);
    this.objectReplacement = new ObjectReplacementSystem(scene);
    
    // 初始化關卡狀態
    this.levelState = {
      isLoaded: false,
      currentScore: 0,
      timeRemaining: 0,
      objectivesCompleted: 0,
      entitiesSpawned: [],
      activeEvents: []
    };

    this.setupEventListeners();
  }

  /**
   * 載入並初始化關卡
   * @param levelName 關卡名稱
   */
  async initLevel(levelName: string): Promise<void> {
    try {
      console.log(`[LevelManager] 開始載入關卡: ${levelName}`);

      // 清理前一個關卡
      this.cleanup();

      // 載入關卡資料
      this.currentLevel = await this.levelLoader.loadLevel(levelName);
      
      // 初始化關卡狀態
      this.initLevelState();
      
      // 設定遊戲規則
      this.setupGameRules();
      
      // 初始化玩家位置
      this.setupPlayer();
      
      // 生成關卡實體
      this.spawnLevelEntities();
      
      // 設定事件系統
      this.setupLevelEvents();
      
      // 開始遊戲計時器
      this.startGameTimer();
      
      console.log(`[LevelManager] 關卡載入完成: ${this.currentLevel.metadata.name}`);
      this.levelState.isLoaded = true;

    } catch (error) {
      console.error(`[LevelManager] 關卡載入失敗: ${levelName}`, error);
      throw error;
    }
  }

  /**
   * 載入並初始化自定義關卡（編輯器創建）
   * @param levelData 自定義關卡數據
   */
  async initCustomLevel(levelData: any): Promise<void> {
    try {
      console.log(`[LevelManager] 開始載入自定義關卡: ${levelData.metadata?.name || levelData.name}`);

      // 清理前一個關卡
      this.cleanup();

      // 檢查並轉換編輯器簡化格式
      const convertedLevelData = this.convertEditorFormatIfNeeded(levelData);
      this.currentLevel = convertedLevelData;
      
      // 初始化關卡狀態
      this.initLevelState();
      
      // 設定遊戲規則
      this.setupGameRules();
      
      // 初始化玩家位置
      this.setupPlayer();
      
      // 生成關卡實體
      this.spawnLevelEntities();
      
      // 設定事件系統
      this.setupLevelEvents();
      
      // 開始遊戲計時器
      this.startGameTimer();
      
      console.log(`[LevelManager] 自定義關卡載入完成: ${this.currentLevel.metadata.name}`);
      this.levelState.isLoaded = true;

    } catch (error) {
      console.error(`[LevelManager] 自定義關卡載入失敗:`, error);
      throw error;
    }
  }

  /**
   * 初始化關卡狀態
   */
  private initLevelState(): void {
    if (!this.currentLevel) return;

    this.levelState = {
      isLoaded: false,
      currentScore: 0,
      timeRemaining: this.currentLevel.level.timeLimit,
      objectivesCompleted: 0,
      entitiesSpawned: [],
      activeEvents: []
    };
  }

  /**
   * 設定遊戲規則
   */
  private setupGameRules(): void {
    if (!this.currentLevel) return;

    const config = this.currentLevel.level;
    
    console.log(`[LevelManager] 設定遊戲規則:`);
    console.log(`  - 時間限制: ${config.timeLimit} 秒`);
    console.log(`  - 目標分數: ${config.scoreTarget}`);
    console.log(`  - 難度: ${config.difficulty}`);
    
    // 根據難度調整遊戲參數
    this.applyDifficultySettings(config.difficulty);
  }

  /**
   * 根據難度調整遊戲設定
   */
  private applyDifficultySettings(difficulty: string): void {
    const settings = {
      easy: { enemySpeedMultiplier: 0.8, enemyHealthMultiplier: 0.7, scoreMultiplier: 1.0 },
      normal: { enemySpeedMultiplier: 1.0, enemyHealthMultiplier: 1.0, scoreMultiplier: 1.0 },
      hard: { enemySpeedMultiplier: 1.3, enemyHealthMultiplier: 1.5, scoreMultiplier: 1.2 },
      expert: { enemySpeedMultiplier: 1.6, enemyHealthMultiplier: 2.0, scoreMultiplier: 1.5 }
    };

    const difficultySettings = settings[difficulty as keyof typeof settings] || settings.normal;
    
    // 將難度設定儲存到場景資料中，供其他系統使用
    this.scene.data.set('difficultySettings', difficultySettings);
    
    console.log(`[LevelManager] 套用難度設定 (${difficulty}):`, difficultySettings);
  }

  /**
   * 設定玩家初始位置
   */
  private setupPlayer(): void {
    if (!this.currentLevel) return;

    const gameplay = this.currentLevel.gameplay;
    
    // 轉換 3D 座標到 2D
    const playerX = gameplay.playerStartPosition[0] * 50 + 400;
    const playerY = gameplay.playerStartPosition[2] * 50 + 300;
    
    console.log(`[LevelManager] 設定玩家起始位置: (${playerX}, ${playerY})`);
    
    // 假設場景中有玩家物件
    const player = this.scene.children.getByName('player') as Phaser.GameObjects.Sprite;
    if (player) {
      player.setPosition(playerX, playerY);
      
      // 設定旋轉（轉換 Y 軸旋轉為 2D 角度）
      const rotation = gameplay.playerStartRotation[1] * Math.PI / 180;
      player.setRotation(rotation);
    }

    // 設定攝影機（如果需要）
    this.setupCamera(gameplay.cameraSettings);
  }

  /**
   * 設定攝影機
   */
  private setupCamera(cameraSettings: any): void {
    const camera = this.scene.cameras.main;
    
    if (cameraSettings.type === 'follow') {
      const player = this.scene.children.getByName('player');
      if (player) {
        camera.startFollow(player);
        
        if (cameraSettings.distance) {
          camera.setZoom(800 / cameraSettings.distance); // 簡化的縮放計算
        }
      }
    }
  }

  /**
   * 生成關卡實體
   */
  private spawnLevelEntities(): void {
    if (!this.currentLevel) return;

    console.log(`[LevelManager] 開始生成關卡實體`);
    
    const entities = this.entitySpawner.spawnEntities(this.currentLevel.entities);
    this.levelState.entitiesSpawned = entities;
    
    // 設定實體互動邏輯
    this.setupEntityInteractions();
  }

  /**
   * 設定實體互動邏輯
   */
  private setupEntityInteractions(): void {
    this.levelState.entitiesSpawned.forEach(entity => {
      if (!entity.sprite) return;

      switch (entity.type) {
        case 'collectible':
          entity.sprite.on('pointerdown', () => this.collectItem(entity));
          break;
        
        case 'enemy':
          entity.sprite.on('pointerdown', () => this.attackEnemy(entity));
          break;
        
        case 'powerup':
          entity.sprite.on('pointerdown', () => this.collectPowerup(entity));
          break;
      }
    });
  }

  /**
   * 設定關卡事件
   */
  private setupLevelEvents(): void {
    if (!this.currentLevel) return;

    this.eventTrigger.setupEvents(this.currentLevel.events);
  }

  /**
   * 開始遊戲計時器
   */
  private startGameTimer(): void {
    if (!this.currentLevel) return;

    console.log(`[LevelManager] 開始計時器: ${this.levelState.timeRemaining} 秒`);

    this.gameTimer = this.scene.time.addEvent({
      delay: 1000,
      callback: this.updateGameTimer,
      callbackScope: this,
      repeat: this.levelState.timeRemaining - 1
    });
  }

  /**
   * 更新遊戲計時器
   */
  private updateGameTimer(): void {
    this.levelState.timeRemaining--;
    
    // 更新事件系統
    this.eventTrigger.update({
      score: this.levelState.currentScore,
      timeRemaining: this.levelState.timeRemaining,
      playerHealth: 100, // 這應該從實際玩家狀態取得
      playerX: 400, // 玩家位置
      playerY: 300,
      enemiesDefeated: this.getDefeatedEnemiesCount(),
      collectiblesGathered: this.getCollectedItemsCount()
    });

    // 檢查時間結束
    if (this.levelState.timeRemaining <= 0) {
      this.checkLevelComplete();
    }
  }

  /**
   * 收集物品
   */
  private collectItem(entity: PhaserEntity): void {
    const value = entity.properties.value || 10;
    this.addScore(value);
    
    // 移除實體
    this.entitySpawner.destroyEntity(entity.id);
    
    console.log(`[LevelManager] 收集物品: ${entity.id} (+${value} 分)`);
    
    // 檢查目標達成
    this.checkObjectives();
  }

  /**
   * 攻擊敵人
   */
  private attackEnemy(entity: PhaserEntity): void {
    const health = entity.properties.health || 100;
    const damage = 25; // 預設攻擊力
    
    entity.properties.health = health - damage;
    
    if (entity.properties.health <= 0) {
      // 敵人死亡
      const reward = entity.properties.reward || 50;
      this.addScore(reward);
      this.entitySpawner.destroyEntity(entity.id);
      
      console.log(`[LevelManager] 擊敗敵人: ${entity.id} (+${reward} 分)`);
      this.checkObjectives();
    } else {
      console.log(`[LevelManager] 攻擊敵人: ${entity.id} (剩餘血量: ${entity.properties.health})`);
    }
  }

  /**
   * 收集強化道具
   */
  private collectPowerup(entity: PhaserEntity): void {
    console.log(`[LevelManager] 使用強化道具: ${entity.properties.effectType}`);
    
    // 啟用強化效果
    this.applyPowerupEffect(entity.properties);
    
    // 移除道具
    this.entitySpawner.destroyEntity(entity.id);
  }

  /**
   * 套用強化效果
   */
  private applyPowerupEffect(properties: any): void {
    const duration = (properties.duration || 10) * 1000; // 轉為毫秒
    
    switch (properties.effectType) {
      case 'attack_boost':
        this.scene.data.set('attackMultiplier', properties.multiplier || 1.5);
        this.scene.time.delayedCall(duration, () => {
          this.scene.data.set('attackMultiplier', 1.0);
        });
        break;
      
      case 'speed_boost':
        this.scene.data.set('speedMultiplier', properties.multiplier || 1.5);
        this.scene.time.delayedCall(duration, () => {
          this.scene.data.set('speedMultiplier', 1.0);
        });
        break;
    }
  }

  /**
   * 增加分數
   */
  addScore(points: number): void {
    const multiplier = this.scene.data.get('scoreMultiplier') || 1.0;
    const actualPoints = Math.floor(points * multiplier);
    
    this.levelState.currentScore += actualPoints;
    console.log(`[LevelManager] 分數增加: +${actualPoints} (總分: ${this.levelState.currentScore})`);
  }

  /**
   * 檢查目標完成
   */
  private checkObjectives(): void {
    if (!this.currentLevel) return;

    const objectives = this.currentLevel.gameplay.objectives;
    let completedCount = 0;

    objectives.forEach(objective => {
      let isComplete = false;
      
      switch (objective.type) {
        case 'collect':
          isComplete = this.getCollectedItemsCount() >= objective.target;
          break;
        
        case 'defeat':
          isComplete = this.getDefeatedEnemiesCount() >= objective.target;
          break;
        
        case 'survive':
          isComplete = this.levelState.timeRemaining <= 0; // 存活到時間結束
          break;
        
        default:
          isComplete = this.levelState.currentScore >= objective.target;
      }

      if (isComplete) {
        completedCount++;
        if (this.onObjectiveComplete) {
          this.onObjectiveComplete(objective);
        }
      }
    });

    this.levelState.objectivesCompleted = completedCount;
    
    // 檢查關卡完成
    if (completedCount >= objectives.length) {
      this.checkLevelComplete();
    }
  }

  /**
   * 檢查關卡完成
   */
  private checkLevelComplete(): void {
    if (!this.currentLevel) return;

    const hasTimeRemaining = this.levelState.timeRemaining > 0;
    const hasMetScoreTarget = this.levelState.currentScore >= this.currentLevel.level.scoreTarget;
    const hasCompletedObjectives = this.levelState.objectivesCompleted >= this.currentLevel.gameplay.objectives.length;

    if (hasCompletedObjectives && (hasTimeRemaining || hasMetScoreTarget)) {
      this.completLevel();
    } else if (this.levelState.timeRemaining <= 0 && !hasMetScoreTarget) {
      this.failLevel();
    }
  }

  /**
   * 關卡完成
   */
  private completLevel(): void {
    console.log(`[LevelManager] 關卡完成！分數: ${this.levelState.currentScore}`);
    
    if (this.gameTimer) {
      this.gameTimer.remove();
    }

    if (this.onLevelComplete) {
      this.onLevelComplete();
    }
  }

  /**
   * 關卡失敗
   */
  private failLevel(): void {
    console.log(`[LevelManager] 關卡失敗！分數: ${this.levelState.currentScore}`);
    
    if (this.gameTimer) {
      this.gameTimer.remove();
    }

    if (this.onLevelFailed) {
      this.onLevelFailed();
    }
  }

  /**
   * 設定事件監聽器
   */
  private setupEventListeners(): void {
    // 實體生成回調
    this.entitySpawner.setSpawnCallback((entity) => {
      console.log(`[LevelManager] 實體生成: ${entity.id}`);
    });
  }

  /**
   * 取得統計資訊
   */
  private getCollectedItemsCount(): number {
    const totalCollectibles = this.currentLevel?.entities.filter(e => e.type === 'collectible').length || 0;
    const remainingCollectibles = this.entitySpawner.getEntitiesByType('collectible').length;
    return totalCollectibles - remainingCollectibles;
  }

  private getDefeatedEnemiesCount(): number {
    const totalEnemies = this.currentLevel?.entities.filter(e => e.type === 'enemy').length || 0;
    const remainingEnemies = this.entitySpawner.getEntitiesByType('enemy').length;
    return totalEnemies - remainingEnemies;
  }

  /**
   * 設定回調函數
   */
  setObjectiveCompleteCallback(callback: (objective: Objective) => void): void {
    this.onObjectiveComplete = callback;
  }

  setLevelCompleteCallback(callback: () => void): void {
    this.onLevelComplete = callback;
  }

  setLevelFailedCallback(callback: () => void): void {
    this.onLevelFailed = callback;
  }

  /**
   * 取得關卡狀態
   */
  getLevelState(): LevelState {
    return { ...this.levelState };
  }

  /**
   * 取得當前關卡資料
   */
  getCurrentLevel(): LevelData | null {
    return this.currentLevel;
  }

  /**
   * 檢查並轉換編輯器簡化格式為完整遊戲格式
   * @param rawData 原始關卡資料
   * @returns 轉換後的完整格式
   */
  private convertEditorFormatIfNeeded(rawData: any): LevelData {
    // 檢查是否為編輯器簡化格式
    if (this.isEditorFormat(rawData)) {
      console.log('[LevelManager] 檢測到編輯器簡化格式，開始轉換...');
      return this.convertEditorFormat(rawData);
    }
    
    // 檢查是否為完整遊戲格式
    if (this.isCompleteGameFormat(rawData)) {
      console.log('[LevelManager] 檢測到完整遊戲格式，直接使用');
      return rawData as LevelData;
    }
    
    throw new Error('不支援的關卡格式');
  }

  /**
   * 判斷是否為編輯器簡化格式
   * 特徵：有 name、version、entities 但沒有 _format
   */
  private isEditorFormat(data: any): boolean {
    return (
      data &&
      typeof data === 'object' &&
      !data._format && // 沒有遊戲格式標識
      data.name &&
      data.version &&
      Array.isArray(data.entities) &&
      data.entities.length > 0 &&
      // 檢查實體格式特徵（編輯器特有的color欄位）
      data.entities.some((entity: any) => 
        entity.color !== undefined && 
        typeof entity.color === 'number' &&
        entity.type && 
        ['wooden_box', 'bomb', 'stone'].includes(entity.type)
      )
    );
  }

  /**
   * 判斷是否為完整遊戲格式
   */
  private isCompleteGameFormat(data: any): boolean {
    return (
      data &&
      typeof data === 'object' &&
      data._format === 'douqi-level' &&
      data._version &&
      data.metadata &&
      data.level &&
      data.gameplay &&
      Array.isArray(data.entities) &&
      Array.isArray(data.events) &&
      data.config
    );
  }

  /**
   * 轉換編輯器格式為遊戲格式
   */
  private convertEditorFormat(editorData: any): LevelData {
    const timestamp = Date.now();
    const dateString = new Date().toISOString().split('T')[0];
    
    console.log(`[LevelManager] 轉換編輯器格式: ${editorData.entities.length} 個實體`);
    
    return {
      _format: "douqi-level",
      _version: "1.0.0",
      metadata: {
        name: editorData.name || `編輯器關卡_${timestamp}`,
        description: "從簡潔編輯器匯入的關卡",
        created: dateString,
        editor: "simple-editor",
        baseScene: "default"
      },
      level: {
        id: `level_${timestamp}`,
        name: editorData.name || "編輯器關卡",
        description: "透過簡潔編輯器創建的關卡",
        difficulty: "normal",
        timeLimit: 180, // 3分鐘預設
        scoreTarget: 1000 // 預設目標分數
      },
      gameplay: {
        playerStartPosition: [0, 0.5, 0], // 中心位置
        playerStartRotation: [0, 0, 0],
        cameraSettings: {
          type: "follow",
          distance: 8,
          height: 6,
          angle: 30
        },
        objectives: [
          {
            id: "obj_collect",
            type: "collect",
            description: "收集所有道具",
            target: this.countCollectiblesInEditorData(editorData.entities),
            reward: 500
          },
          {
            id: "obj_survive",
            type: "survive", 
            description: "存活到時間結束",
            target: 1,
            reward: 300
          }
        ]
      },
      entities: editorData.entities.map((entity: any, index: number) => 
        this.convertEditorEntity(entity, index)
      ),
      events: [], // 編輯器沒有事件系統，留空
      config: {
        backgroundMusic: "default_battle.ogg",
        ambientSounds: ["wind.ogg"],
        weatherEffects: {
          type: "clear",
          windStrength: 0.3
        },
        lighting: {
          timeOfDay: "noon",
          shadowQuality: "medium"
        }
      }
    };
  }

  /**
   * 轉換編輯器實體為遊戲實體
   */
  private convertEditorEntity(editorEntity: any, index: number): GameEntity {
    const gameType = this.mapEditorTypeToGameType(editorEntity.type);
    const entityName = this.generateEntityName(editorEntity.type, index);
    
    return {
      id: editorEntity.id || `entity_${index}`,
      type: gameType,
      name: entityName,
      position: editorEntity.position || [0, 0, 0], // 編輯器已經是正確格式
      rotation: [0, 0, 0], // 編輯器沒有旋轉，使用預設值
      properties: this.generateEntityProperties(editorEntity.type, editorEntity.color)
    };
  }

  /**
   * 映射編輯器類型到遊戲類型
   */
  private mapEditorTypeToGameType(editorType: string): 'enemy' | 'collectible' | 'powerup' | 'obstacle' | 'npc' {
    const typeMapping: { [key: string]: 'enemy' | 'collectible' | 'powerup' | 'obstacle' | 'npc' } = {
      'wooden_box': 'obstacle',  // 木箱 → 障礙物
      'bomb': 'powerup',         // 炸彈 → 強化道具（爆炸類型）
      'stone': 'obstacle'        // 石頭 → 障礙物
    };

    return typeMapping[editorType] || 'obstacle';
  }

  /**
   * 生成實體名稱
   */
  private generateEntityName(editorType: string, index: number): string {
    const nameMapping: { [key: string]: string } = {
      'wooden_box': '木箱',
      'bomb': '炸彈',
      'stone': '石頭'
    };

    const baseName = nameMapping[editorType] || '未知物件';
    return `${baseName}_${index + 1}`;
  }

  /**
   * 根據編輯器類型生成遊戲屬性
   */
  private generateEntityProperties(editorType: string, color?: number): EntityProperties {
    switch (editorType) {
      case 'wooden_box':
        return {
          health: 100,
          destructible: true,
          blockMovement: true,
          material: 'wood',
          dropItems: ['coin'],
          dropChance: 0.3
        };

      case 'bomb':
        return {
          effectType: 'explosive',
          explosionRadius: 100,
          explosionDamage: 50,
          duration: 0, // 即時效果
          value: 0, // 不是收集道具
          autoTrigger: true,
          triggerDelay: 1.0
        };

      case 'stone':
        return {
          health: 200,
          destructible: false,
          blockMovement: true,
          material: 'stone',
          resistance: 'physical'
        };

      default:
        return {
          health: 50,
          destructible: true
        };
    }
  }

  /**
   * 載入指定關卡和子區的隨機配置
   * 用於AB區切換時載入編輯器配置
   * @param levelId 關卡ID (1-8)
   * @param subZone 子區 ('A' 或 'B')
   * @returns Promise<boolean> 是否成功載入配置
   */
  async loadSubZoneConfig(levelId: number, subZone: 'A' | 'B' = 'A'): Promise<boolean> {
    try {
      console.log(`[LevelManager] 載入關卡 ${levelId}-${subZone} 的隨機配置...`);
      
      // 設定物件替換系統的關卡資訊
      this.objectReplacement.setCurrentLevel(levelId, subZone);
      
      // 載入隨機配置
      const success = await this.objectReplacement.loadRandomConfig();
      
      if (success) {
        const configInfo = this.objectReplacement.getConfigInfo();
        console.log(`[LevelManager] 子區配置載入成功:`, configInfo);
      } else {
        console.warn(`[LevelManager] 關卡 ${levelId}-${subZone} 沒有可用的編輯器配置，使用預設生成`);
      }
      
      return success;
      
    } catch (error) {
      console.error(`[LevelManager] 載入子區配置失敗:`, error);
      return false;
    }
  }

  /**
   * 檢查關卡是否有編輯器配置
   * @param levelId 關卡ID (1-8)
   * @returns Promise<{total: number, cached: boolean}> 配置統計
   */
  async checkLevelConfigs(levelId: number): Promise<{total: number, cached: boolean}> {
    return await this.configScanner.getConfigStats(levelId);
  }

  /**
   * 取得物件替換系統
   * 讓GameScene可以在生成物件時調用替換功能
   * @returns ObjectReplacementSystem 物件替換系統實例
   */
  getObjectReplacementSystem(): ObjectReplacementSystem {
    return this.objectReplacement;
  }

  /**
   * 清除當前的子區配置
   * 在離開關卡或切換子區時調用
   */
  clearSubZoneConfig(): void {
    this.objectReplacement.clearConfig();
    console.log('[LevelManager] 已清除子區配置');
  }

  /**
   * 計算編輯器資料中可收集物件的數量
   */
  private countCollectiblesInEditorData(entities: any[]): number {
    // 在編輯器格式中，bomb 轉換為 powerup，可以算作收集目標
    return entities.filter(entity => entity.type === 'bomb').length || 1;
  }

  /**
   * 清理關卡資源
   */
  private cleanup(): void {
    if (this.gameTimer) {
      this.gameTimer.remove();
      this.gameTimer = undefined;
    }
    
    this.entitySpawner.clearAllEntities();
    this.eventTrigger.clearAllEvents();
    this.objectReplacement.clearConfig();
    
    this.currentLevel = null;
    this.levelState.isLoaded = false;
    
    console.log('[LevelManager] 關卡資源已清理');
  }

  /**
   * 銷毀管理器
   */
  destroy(): void {
    this.cleanup();
    this.levelLoader.clearCache();
    this.configScanner.clearCache();
  }
}
