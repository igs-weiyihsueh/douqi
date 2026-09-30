import * as PIXI from 'pixi.js';
import { PreviewInteractionController } from '@/interaction/PreviewInteractionController';

/**
 * 預覽遊戲場景
 * 在編輯器中提供即時遊戲預覽
 */
export class PreviewGameScene {
  private app!: PIXI.Application;
  public container!: PIXI.Container;
  private entities: Map<string, PIXI.Graphics> = new Map();
  private interactionController!: PreviewInteractionController;

  constructor(canvasElement: HTMLCanvasElement, width: number, height: number) {
    console.log(`[PreviewGameScene] === 構造函數診斷 ===`);
    console.log(`[PreviewGameScene] 輸入參數: ${width}x${height}`);
    console.log(`[PreviewGameScene] Canvas DOM狀態: ${canvasElement.clientWidth}x${canvasElement.clientHeight}`);
    
    // 確保Canvas DOM屬性與診斷頁面完全一致
    canvasElement.width = width;
    canvasElement.height = height;
    canvasElement.style.width = `${width}px`;
    canvasElement.style.height = `${height}px`;
    canvasElement.style.display = 'block';
    canvasElement.style.margin = '0';
    canvasElement.style.background = '#2a2a2a';
    
    console.log(`[PreviewGameScene] Canvas設置後: ${canvasElement.width}x${canvasElement.height}`);
    
    // 使用與診斷頁面完全相同的PIXI初始化
    this.initPixiApp(canvasElement, width, height);
    this.setupScene();
    
    console.log(`[PreviewGameScene] === 構造函數完成 ===`);
  }

  /**
   * 初始化 Pixi 應用程式
   */
  private initPixiApp(canvas: HTMLCanvasElement, width: number, height: number): void {
    console.log(`[PreviewGameScene] === PIXI初始化診斷 ===`);
    console.log(`[PreviewGameScene] 目標尺寸: ${width}x${height}`);
    console.log(`[PreviewGameScene] Canvas DOM尺寸: ${canvas.clientWidth}x${canvas.clientHeight}`);
    console.log(`[PreviewGameScene] Canvas屬性尺寸: ${canvas.width}x${canvas.height}`);
    
    this.app = new PIXI.Application({
      view: canvas,
      width,
      height,
      backgroundColor: 0x2a2a2a, // 改為較亮的深灰色，更好的視覺效果
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });
    
    console.log(`[PreviewGameScene] PIXI App創建完成:`);
    console.log(`[PreviewGameScene] - App.screen: ${this.app.screen.width}x${this.app.screen.height}`);
    console.log(`[PreviewGameScene] - App.view尺寸: ${(this.app.view as HTMLCanvasElement).width}x${(this.app.view as HTMLCanvasElement).height}`);
    console.log(`[PreviewGameScene] - 解析度: ${this.app.renderer.resolution}`);
    console.log(`[PreviewGameScene] === PIXI初始化完成 ===`);
  }

  /**
   * 設置場景
   */
  private setupScene(): void {
    // 安全檢查：確保PIXI App已正確初始化
    if (!this.app) {
      console.error('[PreviewGameScene] PIXI App未初始化！');
      return;
    }
    
    if (!this.app.stage) {
      console.error('[PreviewGameScene] PIXI App.stage未初始化！');
      return;
    }
    
    console.log(`[PreviewGameScene] === 場景設置診斷 ===`);
    console.log(`[PreviewGameScene] App狀態: ${this.app ? '✅' : '❌'}`);
    console.log(`[PreviewGameScene] Stage狀態: ${this.app.stage ? '✅' : '❌'}`);
    console.log(`[PreviewGameScene] Stage子物件數: ${this.app.stage.children.length}`);
    
    // 創建主容器
    this.container = new PIXI.Container();
    this.app.stage.addChild(this.container);
    
    console.log(`[PreviewGameScene] 主容器已添加，Stage子物件數: ${this.app.stage.children.length}`);

    // 設置背景網格
    this.createBackground();

    // 延遲初始化交互控制器，確保PIXI完全就緒
    requestAnimationFrame(() => {
      if (this.app && this.container) {
        this.interactionController = new PreviewInteractionController(
          this.app.view as HTMLCanvasElement,
          this.container,
          this.app
        );
        console.log('[PreviewGameScene] 交互控制器延遲初始化完成');
      } else {
        console.error('[PreviewGameScene] 交互控制器初始化失敗：App或Container未就緒');
      }
    });
    
    console.log('[PreviewGameScene] === 場景設置完成 ===');
  }
  private createBackground(): void {
    // 安全檢查：確保App和stage已初始化
    if (!this.app || !this.app.stage) {
      console.error('[PreviewGameScene] 無法創建背景：App或stage未初始化');
      return;
    }
    
    // 真實遊戲單位網格 (每100像素一格，方便觀察)
    const gridSize = 100;
    const graphics = new PIXI.Graphics();
    
    // 繪製網格線 - 增加可見度
    graphics.lineStyle(0.8, 0x444444, 0.4); // 稍微更粗更亮的網格線
    
    // 垂直線
    for (let x = 0; x <= this.app.screen.width; x += gridSize) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, this.app.screen.height);
    }
    
    // 水平線
    for (let y = 0; y <= this.app.screen.height; y += gridSize) {
      graphics.moveTo(0, y);
      graphics.lineTo(this.app.screen.width, y);
    }
    
    // 添加中心十字線 (0,0 位置)
    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;
    
    graphics.lineStyle(2, 0x666666, 0.8); // 更明顯的中心線
    graphics.moveTo(centerX - 30, centerY);
    graphics.lineTo(centerX + 30, centerY);
    graphics.moveTo(centerX, centerY - 30);
    graphics.lineTo(centerX, centerY + 30);

    this.app.stage.addChildAt(graphics, 0);
    
    console.log(`[PreviewGameScene] 背景網格: ${gridSize}px 間距, 中心點 (${centerX}, ${centerY})`);
  }


  /**
   * 載入關卡資料
   */
  loadLevelData(levelData: any): void {
    console.log('[PreviewGameScene] 開始載入關卡資料:', levelData.metadata?.name);
    this.clearEntities();
    
    if (levelData?.entities && Array.isArray(levelData.entities)) {
      console.log(`[PreviewGameScene] 發現 ${levelData.entities.length} 個實體`);
      
      levelData.entities.forEach((entity: any, index: number) => {
        console.log(`[PreviewGameScene] 載入實體 ${index + 1}:`, {
          id: entity.id,
          type: entity.type,
          name: entity.name,
          position: entity.position
        });
        this.addEntity(entity);
      });
      
      console.log(`[PreviewGameScene] 完成載入，共渲染 ${this.entities.size} 個實體`);
    } else {
      console.warn('[PreviewGameScene] 沒有找到有效的實體陣列');
    }
  }

  /**
   * 清除所有實體
   */
  private clearEntities(): void {
    if (!this.container) {
      console.warn('[PreviewGameScene] 容器未初始化，無法清除實體');
      // 仍然清除entities Map，避免內存洩漏
      this.entities.forEach(sprite => {
        if (sprite && sprite.destroy) {
          sprite.destroy();
        }
      });
      this.entities.clear();
      return;
    }
    
    this.entities.forEach(sprite => {
      if (this.container && sprite) {
        this.container.removeChild(sprite);
        sprite.destroy();
      }
    });
    this.entities.clear();
  }

  /**
   * 新增實體
   */
  addEntity(entity: any): void {
    if (!entity.id) {
      console.warn('[PreviewGameScene] 實體缺少 id:', entity);
      return;
    }
    
    if (!entity.position) {
      console.warn('[PreviewGameScene] 實體缺少 position:', entity);
      return;
    }
    
    // 安全檢查：確保容器已初始化
    if (!this.container) {
      console.error('[PreviewGameScene] 容器未初始化，無法添加實體:', entity.id);
      return;
    }

    console.log(`[PreviewGameScene] 開始渲染實體: ${entity.id} (${entity.type})`);
    
    const sprite = this.createEntitySprite(entity);
    if (sprite) {
      this.entities.set(entity.id, sprite);
      this.container.addChild(sprite);
      console.log(`[PreviewGameScene] ✅ 成功渲染實體: ${entity.id} 於位置 (${sprite.x}, ${sprite.y})`);
    } else {
      console.error(`[PreviewGameScene] ❌ 實體渲染失敗: ${entity.id}`);
    }
  }

  /**
   * 更新實體
   */
  updateEntity(entityId: string, entity: any): void {
    const existingSprite = this.entities.get(entityId);
    if (existingSprite) {
      this.container.removeChild(existingSprite);
      existingSprite.destroy();
      this.entities.delete(entityId);
    }
    
    this.addEntity(entity);
  }

  /**
   * 移除實體
   */
  removeEntity(entityId: string): void {
    const sprite = this.entities.get(entityId);
    if (sprite) {
      this.container.removeChild(sprite);
      sprite.destroy();
      this.entities.delete(entityId);
    }
  }

  /**
   * 創建實體精靈 - 1:1座標對應，與真實遊戲一致
   */
  private createEntitySprite(entity: any): PIXI.Graphics | null {
    try {
      const graphics = new PIXI.Graphics();
      
      // 1:1 座標對應，移除不必要的放大
      // 遊戲中: position[0] = X軸, position[2] = Z軸(對應2D的Y軸)
      const x = entity.position[0] || 0;  // 直接使用遊戲單位，無放大
      const y = entity.position[2] || 0;  // Z軸對應Y軸
      
      graphics.x = x;
      graphics.y = -y; // 翻轉Y軸 (遊戲坐標系轉換)
      
      console.log(`[PreviewGameScene] 實體 ${entity.id} 位置: 遊戲(${entity.position[0]},${entity.position[2]}) → 預覽(${x},${-y})`);
      
      // 根據實體類型繪製不同形狀和顏色
      switch (entity.type) {
        case 'enemy':
          this.drawEnemy(graphics, entity);
          console.log(`[PreviewGameScene] 渲染敵人: ${entity.id}`);
          break;
        case 'collectible':  // 修正: 使用 collectible 而不是 item
          this.drawItem(graphics, entity);
          console.log(`[PreviewGameScene] 渲染道具: ${entity.id}`);
          break;
        case 'powerup':
          this.drawPowerup(graphics, entity);
          console.log(`[PreviewGameScene] 渲染強化: ${entity.id}`);
          break;
        case 'obstacle':
          this.drawObstacle(graphics, entity);
          console.log(`[PreviewGameScene] 渲染障礙: ${entity.id}`);
          break;
        case 'npc':
          this.drawNpc(graphics, entity);
          console.log(`[PreviewGameScene] 渲染NPC: ${entity.id}`);
          break;
        default:
          this.drawDefault(graphics, entity);
          console.log(`[PreviewGameScene] 未知實體類型 ${entity.type}，使用預設外觀: ${entity.id}`);
          break;
      }

      return graphics;
    } catch (error) {
      console.error(`[PreviewGameScene] 創建實體精靈失敗: ${entity.id}`, error);
      return null;
    }
  }

  /**
   * 繪製敵人 - 符合真實遊戲尺寸
   */
  private drawEnemy(graphics: PIXI.Graphics, entity: any): void {
    // 真實遊戲中敵人大小 (參考 config.ts 中的敵人半徑)
    const size = 14; // normal 敵人半徑 14px
    
    // 根據子類型選擇顏色
    let color = 0xff4444;
    switch (entity.properties?.aiType) {
      case 'fast': color = 0xff8844; break;
      case 'tank': 
        color = 0x8844ff; 
        // tank 敵人更大
        const tankSize = 22; // tank 敵人半徑 22px
        graphics.beginFill(color);
        graphics.drawCircle(0, 0, tankSize);
        graphics.endFill();
        graphics.lineStyle(2, 0x000000);
        graphics.drawCircle(0, 0, tankSize);
        return;
      case 'mage': color = 0xff44ff; break;
    }
    
    graphics.beginFill(color);
    graphics.drawCircle(0, 0, size);
    graphics.endFill();
    
    // 添加邊框
    graphics.lineStyle(1, 0x000000);
    graphics.drawCircle(0, 0, size);
    
    // 添加簡單的眼睛 (縮小以符合新尺寸)
    graphics.beginFill(0xffffff);
    graphics.drawCircle(-size/3, -size/3, 2);
    graphics.drawCircle(size/3, -size/3, 2);
    graphics.endFill();
  }

  /**
   * 繪製道具 - 符合真實遊戲尺寸
   */
  private drawItem(graphics: PIXI.Graphics, entity: any): void {
    // 真實遊戲中道具大小
    const size = 8; // 道具通常較小
    
    // 根據道具類型選擇顏色
    let color = 0xffff44; // 默認金色
    switch (entity.properties?.effectType) {
      case 'energy': color = 0x44ffff; break; // 能量球 - 青色
      case 'health': color = 0xff4444; break; // 血瓶 - 紅色
      case 'coin': color = 0xffff44; break;   // 金幣 - 金色
    }
    
    // 繪製圓形道具 (大多數道具是圓形的)
    graphics.beginFill(color);
    graphics.drawCircle(0, 0, size);
    graphics.endFill();
    
    // 添加邊框
    graphics.lineStyle(1, 0x000000);
    graphics.drawCircle(0, 0, size);
    
    // 添加閃光效果 (縮小以符合新尺寸)
    graphics.lineStyle(1, 0xffffff, 0.8);
    graphics.moveTo(-size/2, -size/2);
    graphics.lineTo(-size/4, -size/2);
    graphics.moveTo(-size/2, -size/2);
    graphics.lineTo(-size/2, -size/4);
  }

  /**
   * 繪製強化道具 - 符合真實遊戲尺寸
   */
  private drawPowerup(graphics: PIXI.Graphics, entity: any): void {
    // 真實遊戲中強化道具大小
    const size = 12; // 強化道具稍大於普通道具
    
    // 根據強化類型選擇顏色
    let color = 0x44ff44; // 默認綠色
    switch (entity.properties?.effectType) {
      case 'attack_boost': color = 0xff8844; break; // 攻擊強化 - 橙色
      case 'shield': color = 0x4488ff; break;       // 護盾 - 藍色
      case 'speed': color = 0x44ff44; break;        // 速度 - 綠色
    }
    
    // 繪製星形 (6角星)
    const points: number[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const outerRadius = size;
      const innerRadius = size * 0.5;
      
      // 外角點
      points.push(Math.cos(angle) * outerRadius);
      points.push(Math.sin(angle) * outerRadius);
      
      // 內角點
      const innerAngle = angle + Math.PI / 6;
      points.push(Math.cos(innerAngle) * innerRadius);
      points.push(Math.sin(innerAngle) * innerRadius);
    }
    
    graphics.beginFill(color);
    graphics.drawPolygon(points);
    graphics.endFill();
    
    // 添加邊框
    graphics.lineStyle(1, 0x000000);
    graphics.drawPolygon(points);
  }

  /**
   * 繪製障礙物
   */
  private drawObstacle(graphics: PIXI.Graphics, entity: any): void {
    const size = 25;
    
    // 根據子類型選擇顏色和形狀
    let color = 0x888888;
    switch (entity.subType) {
      case 'tree': 
        color = 0x228822;
        // 繪製樹
        graphics.beginFill(0x8B4513); // 樹幹
        graphics.drawRect(-3, 0, 6, size);
        graphics.endFill();
        
        graphics.beginFill(color); // 樹葉
        graphics.drawCircle(0, -size * 0.3, size * 0.8);
        graphics.endFill();
        return;
      case 'wall':
        color = 0x666666;
        break;
      case 'rock':
        color = 0x444444;
        break;
    }
    
    graphics.beginFill(color);
    graphics.drawRect(-size, -size, size * 2, size * 2);
    graphics.endFill();
    
    // 添加邊框
    graphics.lineStyle(2, 0x000000);
    graphics.drawRect(-size, -size, size * 2, size * 2);
  }

  /**
   * 繪製NPC
   */
  private drawNpc(graphics: PIXI.Graphics, _entity: any): void {
    const size = 18;
    
    graphics.beginFill(0x44aaff);
    graphics.drawCircle(0, 0, size);
    graphics.endFill();
    
    // 添加邊框
    graphics.lineStyle(2, 0x000000);
    graphics.drawCircle(0, 0, size);
    
    // 添加友好標記
    graphics.lineStyle(3, 0xffffff);
    graphics.moveTo(-8, 0);
    graphics.lineTo(8, 0);
    graphics.moveTo(0, -8);
    graphics.lineTo(0, 8);
  }

  /**
   * 繪製預設實體
   */
  private drawDefault(_graphics: PIXI.Graphics, _entity: any): void {
    const size = 16;
    
    _graphics.beginFill(0x888888);
    _graphics.drawCircle(0, 0, size);
    _graphics.endFill();
    
    _graphics.lineStyle(2, 0x000000);
    _graphics.drawCircle(0, 0, size);
  }

  /**
   * 重置視角
   */
  resetCamera(): void {
    if (this.interactionController) {
      this.interactionController.resetView();
    } else {
      // 備用方法：延遲執行直到控制器就緒
      const waitForController = () => {
        if (this.interactionController) {
          this.interactionController.resetView();
        } else {
          setTimeout(waitForController, 100);
        }
      };
      waitForController();
    }
  }

  /**
   * 設置縮放
   */
  setZoom(scale: number): void {
    if (this.interactionController) {
      this.interactionController.setZoom(scale);
    } else {
      // 備用方法：延遲執行直到控制器就緒
      const waitForController = () => {
        if (this.interactionController) {
          this.interactionController.setZoom(scale);
        } else {
          setTimeout(waitForController, 100);
        }
      };
      waitForController();
    }
  }

  /**
   * 適合視窗 - 根據實體自動調整視角
   */
  fitToView(): void {
    if (this.interactionController) {
      // 收集所有實體位置
      const entityPositions: Array<{ x: number; y: number }> = [];
      this.entities.forEach(sprite => {
        entityPositions.push({ x: sprite.x, y: sprite.y });
      });
      
      this.interactionController.fitToView(entityPositions);
    } else {
      // 備用方法：延遲執行直到控制器就緒
      const waitForController = () => {
        if (this.interactionController) {
          const entityPositions: Array<{ x: number; y: number }> = [];
          this.entities.forEach(sprite => {
            entityPositions.push({ x: sprite.x, y: sprite.y });
          });
          this.interactionController.fitToView(entityPositions);
        } else {
          setTimeout(waitForController, 100);
        }
      };
      waitForController();
    }
  }

  /**
   * 獲取所有實體數量
   */
  getEntityCount(): number {
    return this.entities.size;
  }

  /**
   * 調整預覽尺寸
   */
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
    
    // 通知交互控制器更新
    if (this.interactionController) {
      this.interactionController.resize(width, height);
    } else {
      // 備用方法：重新設置相機位置
      this.container.x = width / 2;
      this.container.y = height / 2;
    }
  }

  /**
   * 銷毀預覽
   */
  destroy(): void {
    // 銷毀交互控制器
    if (this.interactionController) {
      this.interactionController.destroy();
    }
    
    this.clearEntities();
    this.app.destroy(true, { children: true });
  }
}
