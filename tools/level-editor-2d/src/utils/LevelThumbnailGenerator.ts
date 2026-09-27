/**
 * 關卡縮圖生成器
 * 為關卡生成視覺化預覽縮圖
 */

export interface LevelThumbnailOptions {
  width?: number;
  height?: number;
  backgroundColor?: string;
  gridColor?: string;
  showGrid?: boolean;
}

export class LevelThumbnailGenerator {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: Required<LevelThumbnailOptions>;

  constructor(options: LevelThumbnailOptions = {}) {
    this.options = {
      width: 200,
      height: 150,
      backgroundColor: '#1a1a1a',
      gridColor: '#333333',
      showGrid: true,
      ...options
    };

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.options.width;
    this.canvas.height = this.options.height;
    
    this.ctx = this.canvas.getContext('2d')!;
  }

  /**
   * 生成關卡縮圖
   */
  generateThumbnail(levelData: any): string {
    this.clearCanvas();
    this.drawBackground();
    
    if (this.options.showGrid) {
      this.drawGrid();
    }
    
    if (levelData.entities) {
      this.drawEntities(levelData.entities);
    }
    
    return this.canvas.toDataURL('image/png', 0.8);
  }

  /**
   * 清空畫布
   */
  private clearCanvas(): void {
    this.ctx.clearRect(0, 0, this.options.width, this.options.height);
  }

  /**
   * 繪製背景
   */
  private drawBackground(): void {
    this.ctx.fillStyle = this.options.backgroundColor;
    this.ctx.fillRect(0, 0, this.options.width, this.options.height);
  }

  /**
   * 繪製網格
   */
  private drawGrid(): void {
    this.ctx.strokeStyle = this.options.gridColor;
    this.ctx.lineWidth = 0.5;
    this.ctx.globalAlpha = 0.3;

    const gridSize = 20;
    
    // 垂直線
    for (let x = 0; x <= this.options.width; x += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(x, 0);
      this.ctx.lineTo(x, this.options.height);
      this.ctx.stroke();
    }
    
    // 水平線
    for (let y = 0; y <= this.options.height; y += gridSize) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.options.width, y);
      this.ctx.stroke();
    }
    
    this.ctx.globalAlpha = 1.0;
  }

  /**
   * 繪製實體
   */
  private drawEntities(entities: any[]): void {
    entities.forEach(entity => {
      this.drawEntity(entity);
    });
  }

  /**
   * 繪製單一實體
   */
  private drawEntity(entity: any): void {
    // 將世界座標轉換為縮圖座標
    const thumbnailX = this.worldToThumbnailX(entity.position[0]);
    const thumbnailY = this.worldToThumbnailY(entity.position[2]); // 使用Z座標作為Y

    // 確保座標在畫布範圍內
    if (thumbnailX < 0 || thumbnailX > this.options.width || 
        thumbnailY < 0 || thumbnailY > this.options.height) {
      return;
    }

    this.ctx.save();

    switch (entity.type) {
      case 'enemy':
        this.drawEnemy(thumbnailX, thumbnailY);
        break;
      case 'collectible':
        this.drawCollectible(thumbnailX, thumbnailY);
        break;
      case 'powerup':
        this.drawPowerup(thumbnailX, thumbnailY);
        break;
      case 'obstacle':
        this.drawObstacle(thumbnailX, thumbnailY);
        break;
      case 'npc':
        this.drawNPC(thumbnailX, thumbnailY);
        break;
      default:
        this.drawDefault(thumbnailX, thumbnailY);
    }

    this.ctx.restore();
  }

  /**
   * 繪製敵人
   */
  private drawEnemy(x: number, y: number): void {
    this.ctx.fillStyle = '#ff4444';
    this.ctx.strokeStyle = '#cc0000';
    this.ctx.lineWidth = 1;
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    
    // 添加危險標記
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '8px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('!', x, y + 2);
  }

  /**
   * 繪製收集品
   */
  private drawCollectible(x: number, y: number): void {
    this.ctx.fillStyle = '#ffdd44';
    this.ctx.strokeStyle = '#ffaa00';
    this.ctx.lineWidth = 1;
    
    // 繪製星形
    this.drawStar(x, y, 5, 3, 1.5);
  }

  /**
   * 繪製強化道具
   */
  private drawPowerup(x: number, y: number): void {
    this.ctx.fillStyle = '#44ff44';
    this.ctx.strokeStyle = '#00cc00';
    this.ctx.lineWidth = 1;
    
    // 繪製菱形
    this.ctx.beginPath();
    this.ctx.moveTo(x, y - 4);
    this.ctx.lineTo(x + 4, y);
    this.ctx.lineTo(x, y + 4);
    this.ctx.lineTo(x - 4, y);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
    
    // 添加閃光效果
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(x - 1, y - 3, 2, 6);
    this.ctx.fillRect(x - 3, y - 1, 6, 2);
  }

  /**
   * 繪製障礙物
   */
  private drawObstacle(x: number, y: number): void {
    this.ctx.fillStyle = '#8b4513';
    this.ctx.strokeStyle = '#5d2f0a';
    this.ctx.lineWidth = 1;
    
    this.ctx.fillRect(x - 3, y - 3, 6, 6);
    this.ctx.strokeRect(x - 3, y - 3, 6, 6);
  }

  /**
   * 繪製NPC
   */
  private drawNPC(x: number, y: number): void {
    this.ctx.fillStyle = '#0080ff';
    this.ctx.strokeStyle = '#0066cc';
    this.ctx.lineWidth = 1;
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
    
    // 添加對話框標記
    this.ctx.fillStyle = '#ffffff';
    this.ctx.font = '6px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('💬', x, y + 1);
  }

  /**
   * 繪製預設實體
   */
  private drawDefault(x: number, y: number): void {
    this.ctx.fillStyle = '#cccccc';
    this.ctx.strokeStyle = '#888888';
    this.ctx.lineWidth = 1;
    
    this.ctx.beginPath();
    this.ctx.arc(x, y, 3, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.stroke();
  }

  /**
   * 繪製星形
   */
  private drawStar(x: number, y: number, spikes: number, outerRadius: number, innerRadius: number): void {
    let rot = Math.PI / 2 * 3;
    const step = Math.PI / spikes;

    this.ctx.beginPath();
    this.ctx.moveTo(x, y - outerRadius);

    for (let i = 0; i < spikes; i++) {
      const outerX = x + Math.cos(rot) * outerRadius;
      const outerY = y + Math.sin(rot) * outerRadius;
      this.ctx.lineTo(outerX, outerY);
      rot += step;

      const innerX = x + Math.cos(rot) * innerRadius;
      const innerY = y + Math.sin(rot) * innerRadius;
      this.ctx.lineTo(innerX, innerY);
      rot += step;
    }

    this.ctx.lineTo(x, y - outerRadius);
    this.ctx.closePath();
    this.ctx.fill();
    this.ctx.stroke();
  }

  /**
   * 世界座標轉縮圖X座標
   */
  private worldToThumbnailX(worldX: number): number {
    // 假設世界座標範圍是 -10 到 10
    const worldRange = 20;
    const normalizedX = (worldX + 10) / worldRange; // 0-1
    return normalizedX * this.options.width;
  }

  /**
   * 世界座標轉縮圖Y座標
   */
  private worldToThumbnailY(worldZ: number): number {
    // 假設世界座標範圍是 -10 到 10
    const worldRange = 20;
    const normalizedZ = (worldZ + 10) / worldRange; // 0-1
    return normalizedZ * this.options.height;
  }

  /**
   * 取得畫布元素（用於除錯）
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * 設定選項
   */
  setOptions(options: Partial<LevelThumbnailOptions>): void {
    this.options = { ...this.options, ...options };
    
    if (options.width || options.height) {
      this.canvas.width = this.options.width;
      this.canvas.height = this.options.height;
    }
  }
}
