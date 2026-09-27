/**
 * 關卡配置檔案匯入系統
 * 支援用戶直接選擇JSON檔案並即時載入到遊戲中
 */
export class LevelImporter {
  private scene: Phaser.Scene;
  private fileInput: HTMLInputElement | null = null;
  private importedConfigs: Map<string, any> = new Map();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.createFileInput();
  }

  /**
   * 創建隱藏的檔案輸入元素
   */
  private createFileInput(): void {
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json';
    this.fileInput.multiple = true;
    this.fileInput.style.display = 'none';
    
    this.fileInput.addEventListener('change', (event) => {
      this.handleFileSelection(event);
    });
    
    document.body.appendChild(this.fileInput);
  }

  /**
   * 開啟檔案選擇對話框
   */
  public openFileDialog(): void {
    if (this.fileInput) {
      this.fileInput.click();
    }
  }

  /**
   * 處理檔案選擇事件
   */
  private handleFileSelection(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = target.files;
    
    if (!files) return;

    console.log(`[LevelImporter] 用戶選擇了 ${files.length} 個檔案`);
    
    Array.from(files).forEach(file => {
      this.processFile(file);
    });
  }

  /**
   * 處理單個檔案
   */
  private processFile(file: File): void {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const config = JSON.parse(content);
        
        // 驗證檔案格式
        if (this.validateConfig(config, file.name)) {
          this.importConfig(config, file.name);
        }
      } catch (error) {
        console.error(`[LevelImporter] 解析檔案失敗: ${file.name}`, error);
        this.showError(`檔案格式錯誤: ${file.name}`);
      }
    };
    
    reader.onerror = () => {
      console.error(`[LevelImporter] 讀取檔案失敗: ${file.name}`);
      this.showError(`無法讀取檔案: ${file.name}`);
    };
    
    reader.readAsText(file);
  }

  /**
   * 驗證關卡配置格式
   */
  private validateConfig(config: any, fileName: string): boolean {
    // 檢查必要欄位
    if (!config.entities || !Array.isArray(config.entities)) {
      this.showError(`${fileName}: 缺少entities陣列`);
      return false;
    }

    // 檢查檔名格式 (level{id}_{編號}.json)
    const levelPattern = /^level(\d+)_(\d{3})\.json$/;
    const match = fileName.match(levelPattern);
    
    if (!match) {
      this.showError(`${fileName}: 檔名格式錯誤，應為 level{id}_{編號}.json`);
      return false;
    }

    const levelId = parseInt(match[1]);
    if (levelId < 1 || levelId > 8) {
      this.showError(`${fileName}: 關卡ID應在1-8之間`);
      return false;
    }

    // 驗證entities格式
    for (const entity of config.entities) {
      if (!entity.id || !entity.type || !entity.position) {
        this.showError(`${fileName}: entities格式不正確`);
        return false;
      }
    }

    return true;
  }

  /**
   * 匯入關卡配置
   */
  private importConfig(config: any, fileName: string): void {
    const configKey = fileName.replace('.json', '');
    
    // 儲存到記憶體中
    this.importedConfigs.set(configKey, config);
    
    console.log(`[LevelImporter] 成功匯入: ${fileName}`);
    this.showSuccess(`成功匯入關卡: ${config.name || configKey}`);
    
    // 如果遊戲正在運行，觸發立即載入
    this.triggerConfigReload(configKey);
  }

  /**
   * 觸發配置重新載入
   */
  private triggerConfigReload(configKey: string): void {
    // 通知遊戲場景有新的配置可用
    this.scene.events.emit('level-config-imported', {
      configKey,
      config: this.importedConfigs.get(configKey)
    });
  }

  /**
   * 取得已匯入的配置
   */
  public getImportedConfig(levelId: number): any | null {
    // 優先使用匯入的配置
    for (const [key, config] of this.importedConfigs.entries()) {
      if (key.startsWith(`level${levelId}_`)) {
        return config;
      }
    }
    return null;
  }

  /**
   * 取得所有已匯入的配置
   */
  public getAllImportedConfigs(): Map<string, any> {
    return new Map(this.importedConfigs);
  }

  /**
   * 清除所有已匯入的配置
   */
  public clearImportedConfigs(): void {
    this.importedConfigs.clear();
    console.log('[LevelImporter] 已清除所有匯入的配置');
    this.showSuccess('已清除所有匯入的關卡配置');
  }

  /**
   * 顯示成功訊息
   */
  private showSuccess(message: string): void {
    // 創建臨時通知元素
    this.showNotification(message, 'success');
  }

  /**
   * 顯示錯誤訊息
   */
  private showError(message: string): void {
    this.showNotification(message, 'error');
  }

  /**
   * 顯示通知訊息
   */
  private showNotification(message: string, type: 'success' | 'error'): void {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 15px 20px;
      background: ${type === 'success' ? '#4CAF50' : '#f44336'};
      color: white;
      border-radius: 5px;
      font-family: Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 4px 8px rgba(0,0,0,0.3);
      z-index: 10000;
      max-width: 300px;
      word-wrap: break-word;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // 3秒後自動移除
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 3000);
  }

  /**
   * 銷毀匯入器
   */
  public destroy(): void {
    if (this.fileInput && this.fileInput.parentNode) {
      this.fileInput.parentNode.removeChild(this.fileInput);
      this.fileInput = null;
    }
    this.importedConfigs.clear();
  }
}
