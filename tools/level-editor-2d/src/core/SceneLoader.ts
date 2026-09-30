import * as PIXI from 'pixi.js';

export interface SceneData {
  meta?: {
    name?: string;
    version?: string;
  };
  background?: {
    type: 'color' | 'image';
    value: string | number;
  };
  layers?: LayerData[];
  objects?: ObjectData[];
}

export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  objects: ObjectData[];
}

export interface ObjectData {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  rotation?: number;
  properties?: Record<string, any>;
}

/**
 * 場景載入器
 * 負責載入2D場景檔案並顯示為底圖
 */
export class SceneLoader {
  private app: PIXI.Application;
  private backgroundContainer: PIXI.Container;
  private sceneContainer: PIXI.Container;
  private loadedScene: SceneData | null = null;

  constructor(app: PIXI.Application) {
    this.app = app;
    
    // 建立場景圖層（在實體層下方）
    this.backgroundContainer = new PIXI.Container();
    this.sceneContainer = new PIXI.Container();
    
    this.app.stage.addChildAt(this.backgroundContainer, 0);
    this.app.stage.addChildAt(this.sceneContainer, 1);
  }

  /**
   * 載入場景資料
   */
  async loadScene(sceneData: SceneData): Promise<void> {
    try {
      // 清空現有場景
      this.clearScene();
      
      this.loadedScene = sceneData;
      
      // 載入背景
      if (sceneData.background) {
        await this.loadBackground(sceneData.background);
      }
      
      // 載入場景物件
      if (sceneData.objects) {
        await this.loadObjects(sceneData.objects);
      }
      
      // 載入圖層物件
      if (sceneData.layers) {
        await this.loadLayers(sceneData.layers);
      }
      
      console.log('場景載入完成:', sceneData.meta?.name || '未命名場景');
      
    } catch (error) {
      console.error('載入場景失敗:', error);
      throw error;
    }
  }

  /**
   * 載入背景
   */
  private async loadBackground(background: SceneData['background']): Promise<void> {
    if (!background) return;

    if (background.type === 'color') {
      // 純色背景
      const graphics = new PIXI.Graphics();
      graphics.beginFill(background.value as number);
      graphics.drawRect(0, 0, this.app.screen.width, this.app.screen.height);
      graphics.endFill();
      
      this.backgroundContainer.addChild(graphics);
      
    } else if (background.type === 'image') {
      // 圖片背景
      try {
        const texture = await PIXI.Assets.load(background.value as string);
        const sprite = new PIXI.Sprite(texture);
        
        // 調整背景圖片大小以適應畫布
        const scaleX = this.app.screen.width / texture.width;
        const scaleY = this.app.screen.height / texture.height;
        const scale = Math.min(scaleX, scaleY);
        
        sprite.scale.set(scale);
        sprite.x = (this.app.screen.width - sprite.width) / 2;
        sprite.y = (this.app.screen.height - sprite.height) / 2;
        
        this.backgroundContainer.addChild(sprite);
      } catch (error) {
        console.warn('載入背景圖片失敗:', background.value, error);
        
        // 回退到灰色背景
        const graphics = new PIXI.Graphics();
        graphics.beginFill(0x404040);
        graphics.drawRect(0, 0, this.app.screen.width, this.app.screen.height);
        graphics.endFill();
        
        this.backgroundContainer.addChild(graphics);
      }
    }
  }

  /**
   * 載入場景物件
   */
  private async loadObjects(objects: ObjectData[]): Promise<void> {
    for (const obj of objects) {
      try {
        const displayObject = await this.createSceneObject(obj);
        if (displayObject) {
          this.sceneContainer.addChild(displayObject);
        }
      } catch (error) {
        console.warn('載入場景物件失敗:', obj.id, error);
      }
    }
  }

  /**
   * 載入圖層
   */
  private async loadLayers(layers: LayerData[]): Promise<void> {
    // 按順序載入每個圖層
    for (const layer of layers) {
      if (!layer.visible) continue;
      
      const layerContainer = new PIXI.Container();
      layerContainer.alpha = layer.opacity || 1;
      
      // 載入圖層中的物件
      for (const obj of layer.objects || []) {
        try {
          const displayObject = await this.createSceneObject(obj);
          if (displayObject) {
            layerContainer.addChild(displayObject);
          }
        } catch (error) {
          console.warn('載入圖層物件失敗:', obj.id, error);
        }
      }
      
      this.sceneContainer.addChild(layerContainer);
    }
  }

  /**
   * 建立場景物件的顯示物件
   */
  private async createSceneObject(obj: ObjectData): Promise<PIXI.DisplayObject | null> {
    let displayObject: PIXI.DisplayObject | null = null;

    switch (obj.type) {
      case 'rectangle':
      case 'rect':
        displayObject = this.createRectangle(obj);
        break;
        
      case 'circle':
        displayObject = this.createCircle(obj);
        break;
        
      case 'line':
        displayObject = this.createLine(obj);
        break;
        
      case 'sprite':
      case 'image':
        displayObject = await this.createSprite(obj);
        break;
        
      case 'text':
        displayObject = this.createText(obj);
        break;
        
      default:
        // 未知類型，建立佔位符
        displayObject = this.createPlaceholder(obj);
        break;
    }

    if (displayObject) {
      displayObject.x = obj.x;
      displayObject.y = obj.y;
      
      if (obj.rotation) {
        displayObject.rotation = obj.rotation;
      }
      
      // 場景物件不可互動（只作為底圖）
      displayObject.interactive = false;
      displayObject.alpha = 0.7; // 半透明顯示
    }

    return displayObject;
  }

  /**
   * 建立矩形
   */
  private createRectangle(obj: ObjectData): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    const width = obj.width || 100;
    const height = obj.height || 100;
    const color = obj.properties?.color || 0x888888;
    const fill = obj.properties?.fill !== false;
    
    if (fill) {
      graphics.beginFill(color, 0.5);
    }
    
    graphics.lineStyle(2, color);
    graphics.drawRect(0, 0, width, height);
    
    if (fill) {
      graphics.endFill();
    }
    
    return graphics;
  }

  /**
   * 建立圓形
   */
  private createCircle(obj: ObjectData): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    const radius = obj.properties?.radius || 50;
    const color = obj.properties?.color || 0x888888;
    const fill = obj.properties?.fill !== false;
    
    if (fill) {
      graphics.beginFill(color, 0.5);
    }
    
    graphics.lineStyle(2, color);
    graphics.drawCircle(0, 0, radius);
    
    if (fill) {
      graphics.endFill();
    }
    
    return graphics;
  }

  /**
   * 建立線條
   */
  private createLine(obj: ObjectData): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    const endX = obj.properties?.endX || 100;
    const endY = obj.properties?.endY || 0;
    const color = obj.properties?.color || 0x888888;
    const thickness = obj.properties?.thickness || 2;
    
    graphics.lineStyle(thickness, color);
    graphics.moveTo(0, 0);
    graphics.lineTo(endX, endY);
    
    return graphics;
  }

  /**
   * 建立精靈
   */
  private async createSprite(obj: ObjectData): Promise<PIXI.DisplayObject | null> {
    const imagePath = obj.properties?.image || obj.properties?.src;
    if (!imagePath) return null;
    
    try {
      const texture = await PIXI.Assets.load(imagePath);
      const sprite = new PIXI.Sprite(texture);
      
      if (obj.width) sprite.width = obj.width;
      if (obj.height) sprite.height = obj.height;
      
      return sprite;
    } catch (error) {
      console.warn('載入精靈圖片失敗:', imagePath, error);
      return this.createPlaceholder(obj);
    }
  }

  /**
   * 建立文字
   */
  private createText(obj: ObjectData): PIXI.Text {
    const text = obj.properties?.text || 'Text';
    const style = new PIXI.TextStyle({
      fontFamily: obj.properties?.fontFamily || 'Arial',
      fontSize: obj.properties?.fontSize || 24,
      fill: obj.properties?.color || 0xffffff,
    });
    
    return new PIXI.Text(text, style);
  }

  /**
   * 建立佔位符
   */
  private createPlaceholder(obj: ObjectData): PIXI.Graphics {
    const graphics = new PIXI.Graphics();
    const width = obj.width || 50;
    const height = obj.height || 50;
    
    graphics.lineStyle(2, 0xff00ff);
    graphics.beginFill(0xff00ff, 0.2);
    graphics.drawRect(0, 0, width, height);
    graphics.endFill();
    
    // 畫X標記
    graphics.moveTo(0, 0);
    graphics.lineTo(width, height);
    graphics.moveTo(width, 0);
    graphics.lineTo(0, height);
    
    return graphics;
  }

  /**
   * 清空場景
   */
  private clearScene(): void {
    this.backgroundContainer.removeChildren();
    this.sceneContainer.removeChildren();
    this.loadedScene = null;
  }

  /**
   * 取得載入的場景資料
   */
  getLoadedScene(): SceneData | null {
    return this.loadedScene;
  }

  /**
   * 設定場景可見性
   */
  setSceneVisible(visible: boolean): void {
    this.backgroundContainer.visible = visible;
    this.sceneContainer.visible = visible;
  }

  /**
   * 設定場景透明度
   */
  setSceneOpacity(opacity: number): void {
    this.backgroundContainer.alpha = opacity;
    this.sceneContainer.alpha = opacity;
  }
}
