import * as PIXI from 'pixi.js';

export interface LevelConfig {
  name: string;
  description: string;
  gameTime: number;
  background?: string;
  entities: EntityData[];
  triggers: TriggerData[];
}

export interface EntityData {
  id: string;
  type: 'enemy' | 'item' | 'breakable';
  subType: string;
  x: number;
  y: number;
  properties: Record<string, any>;
}

export interface TriggerData {
  id: string;
  type: 'area' | 'time' | 'condition';
  x: number;
  y: number;
  width: number;
  height: number;
  conditions: any[];
  actions: any[];
}

/**
 * 關卡管理核心類別
 * 負責關卡資料管理、實體管理、序列化等
 */
export class LevelManager {
  private app: PIXI.Application;
  private config: LevelConfig;
  private entities: Map<string, PIXI.DisplayObject>;
  private triggers: Map<string, PIXI.Graphics>;
  private entityLayer: PIXI.Container;
  private triggerLayer: PIXI.Container;
  private selectedEntity: string | null = null;

  constructor(app: PIXI.Application) {
    this.app = app;
    this.entities = new Map();
    this.triggers = new Map();
    
    // 初始化圖層
    this.entityLayer = new PIXI.Container();
    this.triggerLayer = new PIXI.Container();
    
    this.app.stage.addChild(this.entityLayer);
    this.app.stage.addChild(this.triggerLayer);
    
    // 預設關卡配置
    this.config = {
      name: '新關卡',
      description: '',
      gameTime: 300,
      entities: [],
      triggers: [],
    };
  }

  /**
   * 取得當前關卡配置
   */
  getConfig(): LevelConfig {
    return this.config;
  }

  /**
   * 更新關卡基礎設定
   */
  updateConfig(updates: Partial<LevelConfig>): void {
    Object.assign(this.config, updates);
  }

  /**
   * 新增實體到關卡
   */
  addEntity(entityData: EntityData): void {
    // 移除已存在的實體
    if (this.entities.has(entityData.id)) {
      this.removeEntity(entityData.id);
    }

    // 建立顯示物件
    const sprite = this.createEntitySprite(entityData);
    sprite.x = entityData.x;
    sprite.y = entityData.y;
    sprite.interactive = true;
    sprite.cursor = 'pointer';

    // 綁定互動事件
    this.bindEntityEvents(sprite, entityData.id);

    // 加入到圖層和資料
    this.entityLayer.addChild(sprite);
    this.entities.set(entityData.id, sprite);
    
    // 更新配置
    const existingIndex = this.config.entities.findIndex(e => e.id === entityData.id);
    if (existingIndex >= 0) {
      this.config.entities[existingIndex] = entityData;
    } else {
      this.config.entities.push(entityData);
    }
  }

  /**
   * 移除實體
   */
  removeEntity(entityId: string): void {
    const sprite = this.entities.get(entityId);
    if (sprite) {
      this.entityLayer.removeChild(sprite);
      this.entities.delete(entityId);
    }

    this.config.entities = this.config.entities.filter(e => e.id !== entityId);
    
    if (this.selectedEntity === entityId) {
      this.selectedEntity = null;
    }
  }

  /**
   * 新增觸發器
   */
  addTrigger(triggerData: TriggerData): void {
    // 移除已存在的觸發器
    if (this.triggers.has(triggerData.id)) {
      this.removeTrigger(triggerData.id);
    }

    // 建立觸發器圖形
    const graphics = new PIXI.Graphics();
    graphics.lineStyle(2, 0x00ff00, 0.8);
    graphics.beginFill(0x00ff00, 0.2);
    graphics.drawRect(0, 0, triggerData.width, triggerData.height);
    graphics.endFill();
    
    graphics.x = triggerData.x;
    graphics.y = triggerData.y;
    graphics.interactive = true;
    graphics.cursor = 'pointer';

    // 綁定事件
    this.bindTriggerEvents(graphics, triggerData.id);

    // 加入到圖層和資料
    this.triggerLayer.addChild(graphics);
    this.triggers.set(triggerData.id, graphics);
    
    // 更新配置
    const existingIndex = this.config.triggers.findIndex(t => t.id === triggerData.id);
    if (existingIndex >= 0) {
      this.config.triggers[existingIndex] = triggerData;
    } else {
      this.config.triggers.push(triggerData);
    }
  }

  /**
   * 移除觸發器
   */
  removeTrigger(triggerId: string): void {
    const graphics = this.triggers.get(triggerId);
    if (graphics) {
      this.triggerLayer.removeChild(graphics);
      this.triggers.delete(triggerId);
    }

    this.config.triggers = this.config.triggers.filter(t => t.id !== triggerId);
  }

  /**
   * 選擇實體
   */
  selectEntity(entityId: string | null): void {
    // 取消之前的選擇
    if (this.selectedEntity) {
      const prevSprite = this.entities.get(this.selectedEntity);
      if (prevSprite && 'tint' in prevSprite) {
        (prevSprite as any).tint = 0xffffff;
      }
    }

    // 選擇新實體
    this.selectedEntity = entityId;
    if (entityId) {
      const sprite = this.entities.get(entityId);
      if (sprite && 'tint' in sprite) {
        (sprite as any).tint = 0x4a90e2; // 藍色高亮
      }
    }
  }

  /**
   * 取得選中的實體ID
   */
  getSelectedEntity(): string | null {
    return this.selectedEntity;
  }

  /**
   * 序列化關卡資料
   */
  serialize(): LevelConfig {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * 匯出遊戲格式的關卡資料
   */
  exportForGame(): any {
    return {
      meta: {
        name: this.config.name,
        description: this.config.description,
        gameTime: this.config.gameTime,
        version: '1.0.0',
        exportTime: new Date().toISOString(),
      },
      entities: this.config.entities.map(entity => ({
        type: entity.type,
        subType: entity.subType,
        position: { x: entity.x, y: entity.y },
        ...entity.properties,
      })),
      triggers: this.config.triggers.map(trigger => ({
        type: trigger.type,
        area: {
          x: trigger.x,
          y: trigger.y,
          width: trigger.width,
          height: trigger.height,
        },
        conditions: trigger.conditions,
        actions: trigger.actions,
      })),
    };
  }

  /**
   * 載入關卡資料
   */
  load(levelData: LevelConfig): void {
    // 清空現有資料
    this.clearAll();
    
    // 載入配置
    this.config = JSON.parse(JSON.stringify(levelData));
    
    // 載入實體
    this.config.entities.forEach(entityData => {
      this.addEntity(entityData);
    });
    
    // 載入觸發器
    this.config.triggers.forEach(triggerData => {
      this.addTrigger(triggerData);
    });
  }

  /**
   * 清空所有資料
   */
  clearAll(): void {
    this.entityLayer.removeChildren();
    this.triggerLayer.removeChildren();
    this.entities.clear();
    this.triggers.clear();
    this.selectedEntity = null;
    
    this.config.entities = [];
    this.config.triggers = [];
  }

  /**
   * 建立實體精靈
   */
  private createEntitySprite(entityData: EntityData): PIXI.Sprite {
    // 這裡使用簡單的彩色方塊代表不同實體
    const texture = PIXI.Texture.WHITE;
    const sprite = new PIXI.Sprite(texture);
    
    // 根據實體類型設定顏色和大小
    switch (entityData.type) {
      case 'enemy':
        sprite.tint = 0xff4444;
        sprite.width = 32;
        sprite.height = 32;
        break;
      case 'item':
        sprite.tint = 0x44ff44;
        sprite.width = 24;
        sprite.height = 24;
        break;
      case 'breakable':
        sprite.tint = 0xffff44;
        sprite.width = 40;
        sprite.height = 40;
        break;
    }
    
    sprite.anchor.set(0.5);
    return sprite;
  }

  /**
   * 綁定實體互動事件
   */
  private bindEntityEvents(sprite: PIXI.DisplayObject, entityId: string): void {
    sprite.on('pointerdown', () => {
      this.selectEntity(entityId);
    });
  }

  /**
   * 綁定觸發器互動事件
   */
  private bindTriggerEvents(graphics: PIXI.Graphics, triggerId: string): void {
    graphics.on('pointerdown', () => {
      // 觸發器選擇邏輯
      console.log('選中觸發器:', triggerId);
    });
  }

  /**
   * 取得所有實體資料
   */
  getAllEntities(): EntityData[] {
    return [...this.config.entities];
  }

  /**
   * 取得實體數量
   */
  getEntityCount(): number {
    return this.config.entities.length;
  }
}
