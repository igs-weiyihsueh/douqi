import * as PIXI from 'pixi.js';

/**
 * 預覽畫面交互控制器 - 縮放和平移功能
 */
export class PreviewInteractionController {
  private canvas: HTMLCanvasElement;
  private container: PIXI.Container;
  private app: PIXI.Application;
  
  // 縮放和平移狀態
  private zoomLevel: number = 0.8; // 當前縮放級別
  private minZoom: number = 0.1;   // 最小縮放
  private maxZoom: number = 5.0;   // 最大縮放
  private zoomStep: number = 0.1;  // 縮放步進
  
  // 拖拽狀態
  private isDragging: boolean = false;
  private lastMousePos: { x: number; y: number } = { x: 0, y: 0 };
  private containerPos: { x: number; y: number } = { x: 0, y: 0 };
  
  // 事件監聽器引用 (用於清理)
  private wheelHandler!: (e: WheelEvent) => void;
  private mouseDownHandler!: (e: MouseEvent) => void;
  private mouseMoveHandler!: (e: MouseEvent) => void;
  private mouseUpHandler!: (e: MouseEvent) => void;
  private contextMenuHandler!: (e: MouseEvent) => void;
  
  constructor(canvas: HTMLCanvasElement, container: PIXI.Container, app: PIXI.Application) {
    this.canvas = canvas;
    this.container = container;
    this.app = app;
    
    console.log(`[PreviewInteractionController] === 初始化診斷 ===`);
    console.log(`[PreviewInteractionController] Canvas DOM尺寸: ${canvas.clientWidth}x${canvas.clientHeight}`);
    console.log(`[PreviewInteractionController] Canvas邏輯尺寸: ${canvas.width}x${canvas.height}`);
    console.log(`[PreviewInteractionController] App尺寸: ${app.screen.width}x${app.screen.height}`);
    
    // === 與診斷頁面完全一致的中心點計算 ===
    // 診斷頁面使用: posX = 400, posY = 225 (800x450的中心)
    this.containerPos.x = app.screen.width / 2;  // 400 for 800px width
    this.containerPos.y = app.screen.height / 2; // 225 for 450px height
    
    console.log(`[PreviewInteractionController] 計算的中心位置: (${this.containerPos.x}, ${this.containerPos.y})`);
    console.log(`[PreviewInteractionController] 診斷頁面參考: (400, 225)`);
    console.log(`[PreviewInteractionController] 初始縮放: ${this.zoomLevel}`);
    
    // 驗證尺寸合理性 - 應該是800x450
    if (app.screen.width === 800 && app.screen.height === 450) {
      console.log(`[PreviewInteractionController] ✅ 尺寸匹配診斷頁面: ${app.screen.width}x${app.screen.height}`);
    } else {
      console.warn(`[PreviewInteractionController] ⚠️ 尺寸不匹配: 期望800x450，實際${app.screen.width}x${app.screen.height}`);
    }
    
    this.initEventListeners();
    this.updateTransform();
    
    console.log(`[PreviewInteractionController] === 初始化完成 ===`);
  }

  /**
   * 初始化事件監聽器
   */
  private initEventListeners(): void {
    // 滾輪縮放
    this.wheelHandler = (e: WheelEvent) => this.onWheel(e);
    this.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    
    // 拖拽事件
    this.mouseDownHandler = (e: MouseEvent) => this.onMouseDown(e);
    this.mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e);
    this.mouseUpHandler = (e: MouseEvent) => this.onMouseUp(e);
    
    this.canvas.addEventListener('mousedown', this.mouseDownHandler);
    document.addEventListener('mousemove', this.mouseMoveHandler);
    document.addEventListener('mouseup', this.mouseUpHandler);
    
    // 禁用右鍵選單
    this.contextMenuHandler = (e: MouseEvent) => e.preventDefault();
    this.canvas.addEventListener('contextmenu', this.contextMenuHandler);
    
    // 鍵盤快捷鍵
    this.initKeyboardShortcuts();
    
    // 設置Canvas樣式
    this.canvas.style.cursor = 'grab';
  }

  /**
   * 初始化鍵盤快捷鍵
   */
  private initKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // 只在Canvas有焦點或滑鼠懸停時響應
      const rect = this.canvas.getBoundingClientRect();
      const isMouseOver = (
        this.lastMousePos.x >= rect.left && this.lastMousePos.x <= rect.right &&
        this.lastMousePos.y >= rect.top && this.lastMousePos.y <= rect.bottom
      );
      
      if (!isMouseOver && document.activeElement !== this.canvas) return;

      switch (e.code) {
        case 'Equal':  // + 鍵 (放大)
        case 'NumpadAdd':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.setZoom(Math.min(this.maxZoom, this.zoomLevel + 0.2));
          }
          break;
          
        case 'Minus':  // - 鍵 (縮小)
        case 'NumpadSubtract':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.setZoom(Math.max(this.minZoom, this.zoomLevel - 0.2));
          }
          break;
          
        case 'Digit0':  // 0 鍵 (重置)
        case 'Numpad0':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.resetView();
          }
          break;
          
        case 'KeyF':  // F 鍵 (適合視窗)
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            // 需要從外部獲取實體位置，這裡先重置
            this.resetView();
          }
          break;
      }
    });
    
    // 更新滑鼠位置（用於判斷是否在Canvas上）
    document.addEventListener('mousemove', (e: MouseEvent) => {
      this.lastMousePos.x = e.clientX;
      this.lastMousePos.y = e.clientY;
    });
  }

  /**
   * 滾輪縮放處理
   */
  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    
    // 獲取滑鼠在Canvas中的位置
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // 計算縮放方向和步進
    const delta = e.deltaY > 0 ? -this.zoomStep : this.zoomStep;
    const ctrlKey = e.ctrlKey || e.metaKey; // 支援 Ctrl/Cmd 精細縮放
    const finalDelta = ctrlKey ? delta * 0.3 : delta; // 精細縮放時減小步進
    
    const oldZoom = this.zoomLevel;
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel + finalDelta));
    
    if (this.zoomLevel !== oldZoom) {
      // 以滑鼠位置為中心縮放
      this.zoomAtPoint(mouseX, mouseY, oldZoom, this.zoomLevel);
      this.updateTransform();
      this.updateZoomDisplay();
      
      console.log(`[PreviewInteractionController] 縮放: ${this.zoomLevel.toFixed(2)}x (${ctrlKey ? '精細' : '普通'}模式)`);
    }
  }

  /**
   * 以指定點為中心縮放
   */
  private zoomAtPoint(mouseX: number, mouseY: number, oldZoom: number, newZoom: number): void {
    // 計算滑鼠在世界坐標中的位置
    const worldX = (mouseX - this.containerPos.x) / oldZoom;
    const worldY = (mouseY - this.containerPos.y) / oldZoom;
    
    // 計算縮放後容器應該移動的距離
    const newContainerX = mouseX - worldX * newZoom;
    const newContainerY = mouseY - worldY * newZoom;
    
    this.containerPos.x = newContainerX;
    this.containerPos.y = newContainerY;
  }

  /**
   * 滑鼠按下處理
   */
  private onMouseDown(e: MouseEvent): void {
    if (e.button === 0 || e.button === 2) { // 左鍵或右鍵
      this.isDragging = true;
      this.lastMousePos.x = e.clientX;
      this.lastMousePos.y = e.clientY;
      this.canvas.style.cursor = 'grabbing';
      
      console.log('[PreviewInteractionController] 開始拖拽');
    }
  }

  /**
   * 滑鼠移動處理
   */
  private onMouseMove(e: MouseEvent): void {
    if (this.isDragging) {
      const deltaX = e.clientX - this.lastMousePos.x;
      const deltaY = e.clientY - this.lastMousePos.y;
      
      this.containerPos.x += deltaX;
      this.containerPos.y += deltaY;
      
      this.lastMousePos.x = e.clientX;
      this.lastMousePos.y = e.clientY;
      
      this.updateTransform();
    }
  }

  /**
   * 滑鼠釋放處理
   */
  private onMouseUp(_e: MouseEvent): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
      
      console.log('[PreviewInteractionController] 結束拖拽');
    }
  }

  /**
   * 更新容器變換
   */
  private updateTransform(): void {
    const oldX = this.container.x;
    const oldY = this.container.y;
    const oldScale = this.container.scale.x;
    
    this.container.x = this.containerPos.x;
    this.container.y = this.containerPos.y;
    this.container.scale.set(this.zoomLevel);
    
    // 診斷日誌（只在變化時輸出）
    if (oldX !== this.container.x || oldY !== this.container.y || oldScale !== this.zoomLevel) {
      console.log(`[PreviewInteractionController] 變換更新: 位置(${this.container.x.toFixed(1)}, ${this.container.y.toFixed(1)}) 縮放${this.zoomLevel.toFixed(2)}x`);
    }
  }

  /**
   * 重置視角到適合視窗
   */
  public resetView(): void {
    // 重置到初始狀態
    this.zoomLevel = 0.8;
    this.containerPos.x = this.app.screen.width / 2;
    this.containerPos.y = this.app.screen.height / 2;
    
    this.updateTransform();
    this.updateZoomDisplay();
    
    console.log('[PreviewInteractionController] 重置視角');
  }

  /**
   * 適合視窗 (根據實體範圍自動調整)
   */
  public fitToView(entities: Array<{ x: number; y: number }>): void {
    if (entities.length === 0) {
      this.resetView();
      return;
    }
    
    // 計算實體邊界
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    entities.forEach(entity => {
      minX = Math.min(minX, entity.x);
      maxX = Math.max(maxX, entity.x);
      minY = Math.min(minY, entity.y);
      maxY = Math.max(maxY, entity.y);
    });
    
    // 添加邊距
    const margin = 100;
    minX -= margin;
    maxX += margin;
    minY -= margin;
    maxY += margin;
    
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    
    // 計算適合的縮放級別
    const scaleX = (this.app.screen.width * 0.8) / boundsWidth;
    const scaleY = (this.app.screen.height * 0.8) / boundsHeight;
    const targetZoom = Math.min(scaleX, scaleY, this.maxZoom);
    
    this.zoomLevel = Math.max(this.minZoom, targetZoom);
    
    // 計算中心位置
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    
    this.containerPos.x = this.app.screen.width / 2 - centerX * this.zoomLevel;
    this.containerPos.y = this.app.screen.height / 2 - centerY * this.zoomLevel;
    
    this.updateTransform();
    this.updateZoomDisplay();
    
    console.log(`[PreviewInteractionController] 適合視窗: 縮放 ${this.zoomLevel.toFixed(2)}x`);
  }

  /**
   * 設置縮放級別
   */
  public setZoom(zoom: number): void {
    const centerX = this.app.screen.width / 2;
    const centerY = this.app.screen.height / 2;
    
    this.zoomAtPoint(centerX, centerY, this.zoomLevel, Math.max(this.minZoom, Math.min(this.maxZoom, zoom)));
    this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
    
    this.updateTransform();
    this.updateZoomDisplay();
  }

  /**
   * 更新縮放顯示
   */
  private updateZoomDisplay(): void {
    const zoomElement = document.getElementById('preview-zoom');
    if (zoomElement) {
      zoomElement.textContent = `${Math.round(this.zoomLevel * 100)}%`;
    }
  }

  /**
   * 取得當前縮放級別
   */
  public getZoomLevel(): number {
    return this.zoomLevel;
  }

  /**
   * 調整畫布尺寸時更新
   */
  public resize(width: number, height: number): void {
    // 保持相對位置
    const oldCenterX = this.app.screen.width / 2;
    const oldCenterY = this.app.screen.height / 2;
    const newCenterX = width / 2;
    const newCenterY = height / 2;
    
    this.containerPos.x += newCenterX - oldCenterX;
    this.containerPos.y += newCenterY - oldCenterY;
    
    this.updateTransform();
  }

  /**
   * 清理事件監聽器
   */
  public destroy(): void {
    this.canvas.removeEventListener('wheel', this.wheelHandler);
    this.canvas.removeEventListener('mousedown', this.mouseDownHandler);
    this.canvas.removeEventListener('contextmenu', this.contextMenuHandler);
    document.removeEventListener('mousemove', this.mouseMoveHandler);
    document.removeEventListener('mouseup', this.mouseUpHandler);
    
    console.log('[PreviewInteractionController] 交互控制器已銷毀');
  }
}
