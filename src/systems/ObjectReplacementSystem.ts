import type { LevelData, GameEntity } from '@/types/LevelTypes';
import { LevelConfigScanner } from '@/managers/LevelConfigScanner';

/**
 * 物件替換系統
 * 負責將編輯器配置的物件替換遊戲中的隨機生成物件
 * 與現有的敵人生成、可破壞物件生成系統整合
 */
export class ObjectReplacementSystem {
  private scene: Phaser.Scene;
  private configScanner: LevelConfigScanner;
  private currentLevelId: number = 1;
  private currentSubZone: 'A' | 'B' = 'A';
  private loadedConfig: LevelData | null = null;

  // 物件分類
  private staticObjects: GameEntity[] = []; // 靜態物件 (木箱、桶等)
  private enemies: GameEntity[] = [];       // 敵人配置
  private items: GameEntity[] = [];         // 道具配置
  private decorations: GameEntity[] = [];   // 裝飾物件

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.configScanner = new LevelConfigScanner();
  }

  /**
   * 設定當前關卡和子區
   * @param levelId 關卡ID (1-8)
   * @param subZone 子區 ('A' 或 'B')
   */
  setCurrentLevel(levelId: number, subZone: 'A' | 'B' = 'A'): void {
    this.currentLevelId = levelId;
    this.currentSubZone = subZone;
    console.log(`[ObjectReplacement] 設定關卡 ${levelId}-${subZone}`);
  }

  /**
   * 載入當前關卡的隨機配置
   * @returns Promise<boolean> 是否成功載入配置
   */
  async loadRandomConfig(): Promise<boolean> {
    try {
      console.log(`[ObjectReplacement] 為關卡 ${this.currentLevelId}-${this.currentSubZone} 載入隨機配置...`);
      
      this.loadedConfig = await this.configScanner.randomLoadConfig(this.currentLevelId);
      
      if (!this.loadedConfig) {
        console.warn(`[ObjectReplacement] 關卡 ${this.currentLevelId} 沒有可用的配置`);
        return false;
      }

      // 分類物件
      this.categorizeObjects();
      
      console.log(`[ObjectReplacement] 配置載入成功: ${this.loadedConfig.metadata.name}`);
      console.log(`- 靜態物件: ${this.staticObjects.length}`);
      console.log(`- 敵人: ${this.enemies.length}`);
      console.log(`- 道具: ${this.items.length}`);
      console.log(`- 裝飾: ${this.decorations.length}`);
      
      return true;

    } catch (error) {
      console.error(`[ObjectReplacement] 載入配置失敗:`, error);
      return false;
    }
  }

  /**
   * 替換靜態物件 (木箱、桶等可破壞物件)
   * 在 GameScene.spawnBreakablesForWave() 或 placeStaticBreakables() 中調用
   * @param defaultObjects 預設要生成的物件列表
   * @returns GameEntity[] 替換後的物件列表
   */
  replaceStaticObjects(defaultObjects: any[]): any[] {
    if (!this.loadedConfig || this.staticObjects.length === 0) {
      console.log(`[ObjectReplacement] 沒有配置或靜態物件，使用預設生成`);
      return defaultObjects;
    }

    console.log(`[ObjectReplacement] 用 ${this.staticObjects.length} 個編輯器物件替換 ${defaultObjects.length} 個預設物件`);
    
    const replacedObjects = this.staticObjects.map(entity => {
      return {
        x: entity.position[0] * 50, // 轉換座標比例
        y: entity.position[2] * 50, // 使用z座標作為y
        type: this.convertEntityType(entity.type),
        properties: entity.properties || {}
      };
    });

    return replacedObjects;
  }

  /**
   * 替換敵人生成位置
   * 在 GameScene.spawnFormation() 中調用
   * @param defaultPositions 預設敵人位置
   * @returns any[] 替換後的敵人生成配置
   */
  replaceEnemySpawns(defaultPositions: any[]): any[] {
    if (!this.loadedConfig || this.enemies.length === 0) {
      console.log(`[ObjectReplacement] 沒有配置或敵人物件，使用預設生成`);
      return defaultPositions;
    }

    console.log(`[ObjectReplacement] 用 ${this.enemies.length} 個編輯器敵人替換預設生成`);
    
    const replacedEnemies = this.enemies.map(entity => {
      return {
        x: entity.position[0] * 50,
        y: entity.position[2] * 50,
        type: this.convertEnemyType(entity.type),
        properties: entity.properties || {}
      };
    });

    return replacedEnemies;
  }

  /**
   * 替換道具生成
   * 在 GameScene.dropItemAt() 中調用
   * @returns any[] 預配置的道具位置
   */
  replaceItemSpawns(): any[] {
    if (!this.loadedConfig || this.items.length === 0) {
      return [];
    }

    console.log(`[ObjectReplacement] 生成 ${this.items.length} 個預配置道具`);
    
    const replacedItems = this.items.map(entity => {
      return {
        x: entity.position[0] * 50,
        y: entity.position[2] * 50,
        type: this.convertItemType(entity.type),
        properties: entity.properties || {}
      };
    });

    return replacedItems;
  }

  /**
   * 檢查是否有可用的配置
   * @returns boolean 是否有已載入的配置
   */
  hasLoadedConfig(): boolean {
    return this.loadedConfig !== null;
  }

  /**
   * 檢查指定類型的物件是否有替換配置
   * @param objectType 物件類型 ('static', 'enemy', 'item', 'decoration')
   * @returns boolean 是否有該類型的替換物件
   */
  hasReplacementFor(objectType: 'static' | 'enemy' | 'item' | 'decoration'): boolean {
    switch (objectType) {
      case 'static': return this.staticObjects.length > 0;
      case 'enemy': return this.enemies.length > 0;
      case 'item': return this.items.length > 0;
      case 'decoration': return this.decorations.length > 0;
      default: return false;
    }
  }

  /**
   * 取得當前配置資訊
   * @returns object 配置統計資訊
   */
  getConfigInfo(): any {
    if (!this.loadedConfig) {
      return null;
    }

    return {
      name: this.loadedConfig.metadata.name,
      version: this.loadedConfig.metadata.version,
      totalEntities: this.loadedConfig.entities.length,
      staticObjects: this.staticObjects.length,
      enemies: this.enemies.length,
      items: this.items.length,
      decorations: this.decorations.length,
      levelId: this.currentLevelId,
      subZone: this.currentSubZone
    };
  }

  /**
   * 清除當前配置
   */
  clearConfig(): void {
    this.loadedConfig = null;
    this.staticObjects = [];
    this.enemies = [];
    this.items = [];
    this.decorations = [];
    console.log(`[ObjectReplacement] 已清除配置`);
  }

  /**
   * 物件分類
   */
  private categorizeObjects(): void {
    if (!this.loadedConfig) return;

    this.staticObjects = [];
    this.enemies = [];
    this.items = [];
    this.decorations = [];

    this.loadedConfig.entities.forEach(entity => {
      switch (this.getEntityCategory(entity.type)) {
        case 'static':
          this.staticObjects.push(entity);
          break;
        case 'enemy':
          this.enemies.push(entity);
          break;
        case 'item':
          this.items.push(entity);
          break;
        case 'decoration':
          this.decorations.push(entity);
          break;
        default:
          console.warn(`[ObjectReplacement] 未知物件類型: ${entity.type}`);
      }
    });
  }

  /**
   * 判斷實體分類
   */
  private getEntityCategory(type: string): 'static' | 'enemy' | 'item' | 'decoration' {
    // 靜態物件 (可破壞)
    if (['box', 'crate', 'barrel', 'obstacle', 'breakable'].includes(type.toLowerCase())) {
      return 'static';
    }
    
    // 敵人
    if (['enemy', 'normal', 'tank', 'shooter', 'bomber', 'boss'].includes(type.toLowerCase())) {
      return 'enemy';
    }
    
    // 道具
    if (['item', 'powerup', 'skill', 'weapon'].includes(type.toLowerCase())) {
      return 'item';
    }
    
    // 預設為裝飾
    return 'decoration';
  }

  /**
   * 轉換實體類型為遊戲內部類型
   */
  private convertEntityType(type: string): string {
    const typeMap: {[key: string]: string} = {
      'box': 'breakable',
      'crate': 'breakable', 
      'barrel': 'barrel',
      'obstacle': 'breakable',
      'breakable': 'breakable'
    };

    return typeMap[type.toLowerCase()] || type;
  }

  /**
   * 轉換敵人類型
   */
  private convertEnemyType(type: string): string {
    const enemyMap: {[key: string]: string} = {
      'enemy': 'normal',
      'normal': 'normal',
      'tank': 'tank', 
      'shooter': 'shooter',
      'bomber': 'bomber',
      'boss': 'boss'
    };

    return enemyMap[type.toLowerCase()] || 'normal';
  }

  /**
   * 轉換道具類型
   */
  private convertItemType(type: string): string {
    const itemMap: {[key: string]: string} = {
      'item': 'A',
      'powerup': 'B',
      'skill': 'C', 
      'weapon': 'E'
    };

    return itemMap[type.toLowerCase()] || 'A';
  }
}
