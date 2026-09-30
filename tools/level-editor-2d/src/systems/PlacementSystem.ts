import * as PIXI from 'pixi.js';
import { LevelManager, EntityData } from '@/core/LevelManager';

/**
 * 實體放置系統
 * 處理實體的拖拉放置、編輯等操作
 */
export class PlacementSystem {
  private app: PIXI.Application;
  private levelManager: LevelManager;
  private currentTool: string = 'select';
  private isDragging: boolean = false;
  // private dragOffset: { x: number; y: number } = { x: 0, y: 0 }; // 預留給未來拖拉功能

  constructor(app: PIXI.Application, levelManager: LevelManager) {
    this.app = app;
    this.levelManager = levelManager;
    this.bindEvents();
  }

  /**
   * 設定當前工具
   */
  setTool(tool: string): void {
    this.currentTool = tool;
    this.app.stage.cursor = tool === 'select' ? 'default' : 'crosshair';
  }

  /**
   * 取得當前工具
   */
  getCurrentTool(): string {
    return this.currentTool;
  }

  /**
   * 在指定位置放置實體
   */
  placeEntity(entityType: string, subType: string, x: number, y: number): void {
    const entityData: EntityData = {
      id: this.generateEntityId(),
      type: entityType as any,
      subType,
      x,
      y,
      properties: this.getDefaultProperties(entityType, subType),
    };

    this.levelManager.addEntity(entityData);
    
    // 觸發實體放置事件供預覽系統使用
    document.dispatchEvent(new CustomEvent('entityPlaced', {
      detail: { entity: entityData }
    }));
  }

  /**
   * 綁定事件監聽器
   */
  private bindEvents(): void {
    this.app.stage.on('pointerdown', this.onPointerDown.bind(this));
    this.app.stage.on('pointermove', this.onPointerMove.bind(this));
    this.app.stage.on('pointerup', this.onPointerUp.bind(this));
  }

  /**
   * 滑鼠按下事件
   */
  private onPointerDown(event: PIXI.FederatedPointerEvent): void {
    const pos = event.global;

    if (this.currentTool === 'select') {
      // 選擇模式：檢查是否點擊了實體
      // 實際的選擇邏輯會在 LevelManager 中處理
    } else if (this.currentTool.startsWith('place_')) {
      // 放置模式：在點擊位置放置實體
      const [, entityType, subType] = this.currentTool.split('_');
      this.placeEntity(entityType, subType || entityType, pos.x, pos.y);
    }
  }

  /**
   * 滑鼠移動事件
   */
  private onPointerMove(_event: PIXI.FederatedPointerEvent): void {
    if (this.isDragging) {
      // 拖拉選中的實體
      const selectedId = this.levelManager.getSelectedEntity();
      if (selectedId) {
        // 這裡需要實現實體位置更新邏輯
        // 暫時留空，後續實現
      }
    }
  }

  /**
   * 滑鼠放開事件
   */
  private onPointerUp(_event: PIXI.FederatedPointerEvent): void {
    this.isDragging = false;
  }

  /**
   * 生成唯一實體ID
   */
  private generateEntityId(): string {
    return `entity_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 取得實體預設屬性
   */
  private getDefaultProperties(entityType: string, _subType: string): Record<string, any> {
    const defaults: Record<string, Record<string, any>> = {
      enemy: {
        health: 100,
        speed: 50,
        damage: 20,
        aiType: 'patrol',
      },
      item: {
        value: 10,
        type: 'coin',
        respawn: false,
      },
      breakable: {
        health: 50,
        drops: ['coin'],
        breakable: true,
      },
    };

    return defaults[entityType] || {};
  }
}
