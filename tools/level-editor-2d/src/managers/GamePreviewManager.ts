import { PreviewGameScene } from '@/preview/PreviewGameScene';

/**
 * 遊戲預覽管理器 - 在中央區域嵌入真實遊戲引擎預覽
 */
export class GamePreviewManager {
  private previewScene?: PreviewGameScene;
  private gameContainer: HTMLElement;
  private previewCanvas: HTMLCanvasElement;
  private currentLevel: any = null;

  constructor() {
    this.gameContainer = document.getElementById('game-preview')!;
    
    // 使用現有的遊戲畫布，而不是創建新的
    this.previewCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
    
    if (!this.previewCanvas) {
      // 如果沒有現有Canvas，則創建新的
      this.previewCanvas = document.createElement('canvas');
      this.previewCanvas.id = 'game-canvas';
      this.previewCanvas.style.display = 'block';
      this.gameContainer.appendChild(this.previewCanvas);
    }
    
    console.log('[GamePreviewManager] 預覽管理器初始化完成，使用Canvas:', this.previewCanvas.id);
  }

  /**
   * 載入關卡到預覽
   */
  async loadLevel(levelData: any): Promise<void> {
    console.log('[GamePreviewManager] 載入關卡到預覽:', levelData.metadata?.name);
    
    try {
      // 銷毀舊的預覽場景
      if (this.previewScene) {
        this.previewScene.destroy();
      }
      
      // === 根本修復：使用固定尺寸，與診斷頁面完全一致 ===
      // 不再使用複雜的動態計算，直接使用診斷頁面的成功配置
      const previewWidth = 800;  // 固定寬度
      const previewHeight = 450; // 固定高度 (16:9比例)
      
      console.log(`[GamePreviewManager] === 統一配置診斷 ===`);
      console.log(`[GamePreviewManager] 使用固定Canvas尺寸: ${previewWidth}x${previewHeight}`);
      console.log(`[GamePreviewManager] 比例確認: ${(previewWidth/previewHeight).toFixed(3)} (標準16:9: 1.778)`);
      console.log(`[GamePreviewManager] 配置來源: 與debug-simple.html完全一致`);
      console.log(`[GamePreviewManager] === 統一配置完成 ===`);
      
      // 創建新的預覽場景 - 使用固定尺寸
      this.previewScene = new PreviewGameScene(
        this.previewCanvas, 
        previewWidth, 
        previewHeight
      );
      
      // 確保Canvas樣式正確 - 與診斷頁面一致
      this.previewCanvas.style.margin = '0';
      this.previewCanvas.style.display = 'block';
      this.previewCanvas.style.background = '#2a2a2a';
      
      // 載入關卡資料到預覽
      await this.previewScene.loadLevelData(levelData);
      
      // 顯示預覽容器，隱藏提示
      this.showPreview();
      
      // 儲存當前關卡
      this.currentLevel = levelData;
      
      // 更新實體計數顯示
      this.updateEntityCount();
      
      // 綁定預覽控制按鈕
      this.bindPreviewControls();
      
      console.log('[GamePreviewManager] 關卡載入完成');
      
    } catch (error) {
      console.error('[GamePreviewManager] 載入關卡失敗:', error);
      this.showError('載入關卡失敗: ' + (error as Error).message);
    }
  }

  /**
   * 清除預覽
   */
  clearPreview(): void {
    console.log('[GamePreviewManager] 清除預覽');
    
    if (this.previewScene) {
      this.previewScene.destroy();
      this.previewScene = undefined;
    }
    
    this.currentLevel = null;
    this.hidePreview();
  }

  /**
   * 更新實體（當編輯器修改實體時調用）
   */
  updateEntity(entityId: string, changes: any): void {
    if (this.previewScene && this.currentLevel) {
      console.log('[GamePreviewManager] 更新實體:', entityId, changes);
      
      // 找到對應實體並更新
      const entities = this.currentLevel.entities || [];
      const entity = entities.find((e: any) => e.id === entityId);
      
      if (entity) {
        // 應用變更
        Object.assign(entity, changes);
        
        // 通知預覽場景更新
        this.previewScene.updateEntity(entityId, entity);
      }
    }
  }

  /**
   * 添加實體
   */
  addEntity(entity: any): void {
    if (this.previewScene && this.currentLevel) {
      console.log('[GamePreviewManager] 添加實體:', entity);
      
      // 添加到關卡資料
      if (!this.currentLevel.entities) {
        this.currentLevel.entities = [];
      }
      this.currentLevel.entities.push(entity);
      
      // 通知預覽場景
      this.previewScene.addEntity(entity);
    }
  }

  /**
   * 移除實體
   */
  removeEntity(entityId: string): void {
    if (this.previewScene && this.currentLevel) {
      console.log('[GamePreviewManager] 移除實體:', entityId);
      
      // 從關卡資料移除
      if (this.currentLevel.entities) {
        this.currentLevel.entities = this.currentLevel.entities.filter(
          (e: any) => e.id !== entityId
        );
      }
      
      // 通知預覽場景
      this.previewScene.removeEntity(entityId);
    }
  }

  /**
   * 顯示預覽
   */
  private showPreview(): void {
    this.gameContainer.style.display = 'block';
    
    const prompt = document.getElementById('level-prompt');
    if (prompt) {
      prompt.style.display = 'none';
    }
  }

  /**
   * 隱藏預覽
   */
  private hidePreview(): void {
    this.gameContainer.style.display = 'none';
    
    const prompt = document.getElementById('level-prompt');
    if (prompt) {
      prompt.style.display = 'block';
    }
  }

  /**
   * 顯示錯誤訊息
   */
  private showError(message: string): void {
    const prompt = document.getElementById('level-prompt');
    if (prompt) {
      prompt.innerHTML = `
        <h3>❌ 載入失敗</h3>
        <p>${message}</p>
        <p>請選擇其他關卡或檢查關卡檔案</p>
      `;
      prompt.style.display = 'block';
    }
    
    this.gameContainer.style.display = 'none';
  }

  /**
   * 取得當前載入的關卡資料
   */
  getCurrentLevel(): any {
    return this.currentLevel;
  }

  /**
   * 更新實體計數顯示
   */
  private updateEntityCount(): void {
    if (this.previewScene) {
      const count = this.previewScene.getEntityCount();
      const entityCountElement = document.getElementById('entity-count');
      if (entityCountElement) {
        entityCountElement.textContent = `實體: ${count}`;
      }
      console.log(`[GamePreviewManager] 更新實體計數: ${count}`);
    }
  }

  /**
   * 綁定預覽控制按鈕
   */
  private bindPreviewControls(): void {
    // 適合視窗按鈕
    const fitViewBtn = document.getElementById('fit-view');
    if (fitViewBtn) {
      fitViewBtn.addEventListener('click', () => {
        if (this.previewScene) {
          this.previewScene.fitToView();
          console.log('[GamePreviewManager] 適合視窗');
        }
      });
    }

    // 重置視角按鈕
    const resetBtn = document.getElementById('reset-camera');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (this.previewScene) {
          this.previewScene.resetCamera();
          console.log('[GamePreviewManager] 重置視角');
        }
      });
    }

    // 放大按鈕
    const zoomInBtn = document.getElementById('zoom-in');
    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => {
        if (this.previewScene) {
          const currentZoom = (this.previewScene as any).interactionController?.getZoomLevel() || 0.8;
          this.previewScene.setZoom(Math.min(5.0, currentZoom + 0.2));
          console.log('[GamePreviewManager] 放大');
        }
      });
    }

    // 縮小按鈕
    const zoomOutBtn = document.getElementById('zoom-out');
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => {
        if (this.previewScene) {
          const currentZoom = (this.previewScene as any).interactionController?.getZoomLevel() || 0.8;
          this.previewScene.setZoom(Math.max(0.1, currentZoom - 0.2));
          console.log('[GamePreviewManager] 縮小');
        }
      });
    }
  }

  /**
   * 調整預覽尺寸
   */
  resize(): void {
    if (this.previewScene) {
      const containerRect = this.gameContainer.getBoundingClientRect();
      const aspectRatio = 1280 / 720; // 16:9
      
      let newWidth = containerRect.width - 40;
      let newHeight = containerRect.height - 40;
      
      // 保持16:9比例
      if (newWidth / newHeight > aspectRatio) {
        newWidth = newHeight * aspectRatio;
      } else {
        newHeight = newWidth / aspectRatio;
      }
      
      // 確保合適的最小尺寸
      const minWidth = Math.min(800, containerRect.width - 40);
      const minHeight = minWidth / aspectRatio;
      
      newWidth = Math.max(minWidth, newWidth);
      newHeight = Math.max(minHeight, newHeight);
      
      console.log(`[GamePreviewManager] 調整尺寸: ${newWidth}x${newHeight}`);
      
      this.previewScene.resize(newWidth, newHeight);
    }
  }
}
