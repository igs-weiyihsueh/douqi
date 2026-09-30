import { LevelStorage, SavedLevel } from '@/storage/LevelStorage';

/**
 * 關卡管理UI組件
 * 處理儲存、載入、管理關卡的所有UI互動
 */
export class LevelManagerUI {
  private storage: LevelStorage;
  private onLevelLoad?: (levelData: any) => void;
  private onLevelTest?: (levelData: any) => void;

  constructor() {
    this.storage = new LevelStorage();
  }

  /**
   * 設定回調函數
   */
  setCallbacks(callbacks: {
    onLevelLoad?: (levelData: any) => void;
    onLevelTest?: (levelData: any) => void;
  }): void {
    this.onLevelLoad = callbacks.onLevelLoad;
    this.onLevelTest = callbacks.onLevelTest;
  }

  /**
   * 顯示儲存關卡對話框
   */
  showSaveDialog(currentLevelData: any): void {
    const modal = this.createModal('save-level-modal', '💾 儲存關卡');
    
    const form = document.createElement('form');
    form.innerHTML = `
      <div class="input-group">
        <label>關卡名稱 *</label>
        <input type="text" id="level-name" placeholder="輸入關卡名稱" required>
      </div>
      
      <div class="input-group">
        <label>關卡描述</label>
        <textarea id="level-description" rows="3" placeholder="描述關卡內容和玩法..."></textarea>
      </div>
      
      <div class="info-text">
        <small>實體數量: ${this.countEntities(currentLevelData)} 個</small>
      </div>
      
      <div class="modal-buttons">
        <button type="button" class="btn secondary" onclick="this.closest('.modal').remove()">取消</button>
        <button type="submit" class="btn">儲存</button>
      </div>
    `;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleSave(currentLevelData, modal);
    });

    modal.querySelector('.modal-content')!.appendChild(form);
    document.body.appendChild(modal);

    // 自動聚焦名稱輸入框
    (modal.querySelector('#level-name') as HTMLInputElement).focus();
  }

  /**
   * 顯示載入關卡對話框
   */
  showLoadDialog(): void {
    const modal = this.createModal('load-level-modal', '📂 載入關卡');
    
    const content = modal.querySelector('.modal-content')!;
    content.appendChild(this.createLevelList('load'));
    
    document.body.appendChild(modal);
  }

  /**
   * 顯示管理關卡對話框
   */
  showManageDialog(): void {
    const modal = this.createModal('manage-level-modal', '🗂️ 管理關卡');
    
    const content = modal.querySelector('.modal-content')!;
    
    // 統計資訊
    const stats = this.storage.getStatistics();
    const statsDiv = document.createElement('div');
    statsDiv.className = 'level-stats';
    statsDiv.innerHTML = `
      <h4>📊 關卡統計</h4>
      <p>總關卡數: ${stats.totalLevels} 個</p>
      <p>總實體數: ${stats.totalEntities} 個</p>
      ${stats.latestModified ? `<p>最後修改: ${new Date(stats.latestModified).toLocaleString()}</p>` : ''}
    `;
    content.appendChild(statsDiv);
    
    // 管理按鈕
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'manage-actions';
    actionsDiv.innerHTML = `
      <button class="btn secondary" onclick="document.getElementById('import-file').click()">📥 匯入關卡</button>
      <input type="file" id="import-file" accept=".json" style="display: none;">
      <button class="btn secondary" onclick="this.clearAllLevels()">🗑️ 清除所有關卡</button>
    `;
    content.appendChild(actionsDiv);
    
    // 關卡列表
    content.appendChild(this.createLevelList('manage'));
    
    // 綁定匯入事件
    const importFile = modal.querySelector('#import-file') as HTMLInputElement;
    importFile.addEventListener('change', (e) => {
      this.handleImport(e.target as HTMLInputElement);
    });
    
    document.body.appendChild(modal);
  }

  /**
   * 顯示測試關卡選擇對話框
   */
  showTestDialog(): void {
    const modal = this.createModal('test-level-modal', '🎮 選擇測試關卡');
    
    const content = modal.querySelector('.modal-content')!;
    
    // 當前編輯關卡選項
    const currentOption = document.createElement('div');
    currentOption.className = 'current-level-option';
    currentOption.innerHTML = `
      <div class="level-item current">
        <div class="level-info">
          <h4>⚡ 當前編輯的關卡</h4>
          <p>測試正在編輯中的關卡內容</p>
        </div>
        <button class="btn test-current">立即測試</button>
      </div>
      <hr>
    `;
    content.appendChild(currentOption);
    
    // 綁定當前關卡測試
    currentOption.querySelector('.test-current')?.addEventListener('click', () => {
      modal.remove();
      if (this.onLevelTest) {
        // 觸發當前編輯關卡的測試
        document.getElementById('test-level')?.click();
      }
    });
    
    // 已儲存關卡列表
    content.appendChild(this.createLevelList('test'));
    
    document.body.appendChild(modal);
  }

  /**
   * 創建模態對話框
   */
  private createModal(id: string, title: string): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = id;
    modal.innerHTML = `
      <div class="modal-overlay" onclick="this.parentElement.remove()"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" onclick="this.closest('.modal').remove()">✕</button>
        </div>
      </div>
    `;
    
    this.addModalStyles();
    return modal;
  }

  /**
   * 創建關卡列表
   */
  private createLevelList(mode: 'load' | 'manage' | 'test'): HTMLElement {
    const container = document.createElement('div');
    container.className = 'level-list';
    
    const levels = this.storage.getAllLevels().sort((a, b) => 
      new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
    );
    
    if (levels.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>🎮 還沒有儲存的關卡</p>
          <p>開始設計你的第一個關卡吧！</p>
        </div>
      `;
      return container;
    }
    
    levels.forEach(level => {
      const item = this.createLevelItem(level, mode);
      container.appendChild(item);
    });
    
    return container;
  }

  /**
   * 創建關卡項目
   */
  private createLevelItem(level: SavedLevel, mode: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'level-item';
    
    const modifiedDate = new Date(level.modifiedAt).toLocaleString();
    
    item.innerHTML = `
      <div class="level-thumbnail">
        ${level.thumbnail ? 
          `<img src="${level.thumbnail}" alt="${level.name} 預覽" class="thumbnail-img">` : 
          '<div class="no-thumbnail">無預覽</div>'
        }
      </div>
      <div class="level-info">
        <h4>${level.name}</h4>
        <p class="level-description">${level.description || '無描述'}</p>
        <div class="level-stats">
          <span class="stat-item">🔴 實體: ${level.entityCount}個</span>
          <span class="stat-item">📅 ${modifiedDate}</span>
        </div>
      </div>
      <div class="level-actions">
        ${this.getLevelActions(level, mode)}
      </div>
    `;
    
    this.bindLevelActions(item, level, mode);
    return item;
  }

  /**
   * 取得關卡操作按鈕
   */
  private getLevelActions(_level: SavedLevel, mode: string): string {
    switch (mode) {
      case 'load':
        return `
          <button class="btn" data-action="load">載入</button>
          <button class="btn secondary" data-action="test">測試</button>
        `;
      case 'manage':
        return `
          <button class="btn secondary" data-action="rename">重命名</button>
          <button class="btn secondary" data-action="duplicate">複製</button>
          <button class="btn secondary" data-action="export">匯出</button>
          <button class="btn secondary" data-action="delete">刪除</button>
        `;
      case 'test':
        return `
          <button class="btn" data-action="test">測試關卡</button>
        `;
      default:
        return '';
    }
  }

  /**
   * 綁定關卡操作事件
   */
  private bindLevelActions(item: HTMLElement, level: SavedLevel, _mode: string): void {
    const buttons = item.querySelectorAll('[data-action]');
    
    buttons.forEach(button => {
      button.addEventListener('click', (e) => {
        const action = (e.target as HTMLElement).getAttribute('data-action');
        this.handleLevelAction(action!, level, item);
      });
    });
  }

  /**
   * 處理關卡操作
   */
  private handleLevelAction(action: string, level: SavedLevel, item: HTMLElement): void {
    switch (action) {
      case 'load':
        this.handleLoad(level);
        break;
      case 'test':
        this.handleTest(level);
        break;
      case 'rename':
        this.handleRename(level, item);
        break;
      case 'duplicate':
        this.handleDuplicate(level);
        break;
      case 'export':
        this.handleExport(level);
        break;
      case 'delete':
        this.handleDelete(level, item);
        break;
    }
  }

  /**
   * 處理儲存
   */
  private handleSave(levelData: any, modal: HTMLElement): void {
    const nameInput = modal.querySelector('#level-name') as HTMLInputElement;
    const descInput = modal.querySelector('#level-description') as HTMLTextAreaElement;
    
    const name = nameInput.value.trim();
    if (!name) {
      this.showMessage('請輸入關卡名稱', 'error');
      return;
    }
    
    try {
      this.storage.saveLevel({
        name,
        description: descInput.value.trim(),
        levelData,
        entityCount: this.countEntities(levelData)
      });
      
      this.showMessage(`關卡 "${name}" 儲存成功！`, 'success');
      modal.remove();
    } catch (error) {
      this.showMessage(`儲存失敗: ${error}`, 'error');
    }
  }

  /**
   * 處理載入
   */
  private handleLoad(level: SavedLevel): void {
    if (this.onLevelLoad) {
      this.onLevelLoad(level.levelData);
      this.showMessage(`關卡 "${level.name}" 載入成功！`, 'success');
      document.querySelector('.modal')?.remove();
    }
  }

  /**
   * 處理測試
   */
  private handleTest(level: SavedLevel): void {
    if (this.onLevelTest) {
      this.onLevelTest(level.levelData);
      this.showMessage(`開始測試 "${level.name}"`, 'info');
      document.querySelector('.modal')?.remove();
    }
  }

  /**
   * 處理重命名
   */
  private handleRename(level: SavedLevel, item: HTMLElement): void {
    const newName = prompt('請輸入新的關卡名稱:', level.name);
    if (!newName || newName.trim() === level.name) return;
    
    try {
      this.storage.renameLevel(level.id, newName.trim());
      this.showMessage(`關卡重命名成功！`, 'success');
      
      // 更新顯示
      const nameElement = item.querySelector('h4')!;
      nameElement.textContent = newName.trim();
    } catch (error) {
      this.showMessage(`重命名失敗: ${error}`, 'error');
    }
  }

  /**
   * 處理複製
   */
  private handleDuplicate(level: SavedLevel): void {
    try {
      this.storage.duplicateLevel(level.id);
      this.showMessage(`關卡複製成功！`, 'success');
      
      // 重新載入列表
      setTimeout(() => {
        document.querySelector('.modal')?.remove();
        this.showManageDialog();
      }, 1000);
    } catch (error) {
      this.showMessage(`複製失敗: ${error}`, 'error');
    }
  }

  /**
   * 處理匯出
   */
  private handleExport(level: SavedLevel): void {
    const data = this.storage.exportLevel(level.id);
    if (data) {
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${level.name}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      this.showMessage(`關卡 "${level.name}" 匯出成功！`, 'success');
    }
  }

  /**
   * 處理刪除
   */
  private handleDelete(_level: SavedLevel, item: HTMLElement): void {
    const levelName = _level.name;
    if (confirm(`確定要刪除關卡 "${levelName}" 嗎？此操作無法復原。`)) {
      const success = this.storage.deleteLevel(_level.id);
      if (success) {
        this.showMessage(`關卡 "${levelName}" 已刪除`, 'success');
        item.remove();
      } else {
        this.showMessage('刪除失敗', 'error');
      }
    }
  }

  /**
   * 處理匯入
   */
  private handleImport(input: HTMLInputElement): void {
    const file = input.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const jsonData = e.target?.result as string;
        this.storage.importLevel(jsonData);
        this.showMessage('關卡匯入成功！', 'success');
        
        // 重新載入列表
        setTimeout(() => {
          document.querySelector('.modal')?.remove();
          this.showManageDialog();
        }, 1000);
      } catch (error) {
        this.showMessage(`匯入失敗: ${error}`, 'error');
      }
    };
    reader.readAsText(file);
  }

  /**
   * 計算實體數量
   */
  private countEntities(levelData: any): number {
    return levelData?.entities?.length || 0;
  }

  /**
   * 顯示訊息
   */
  private showMessage(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const message = document.createElement('div');
    message.className = `toast toast-${type}`;
    message.textContent = text;
    
    document.body.appendChild(message);
    
    setTimeout(() => {
      message.classList.add('show');
    }, 100);
    
    setTimeout(() => {
      message.classList.remove('show');
      setTimeout(() => message.remove(), 300);
    }, 3000);
  }

  /**
   * 添加模態對話框樣式
   */
  private addModalStyles(): void {
    if (document.getElementById('level-manager-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'level-manager-styles';
    style.textContent = `
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .modal-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(5px);
      }

      .modal-content {
        position: relative;
        background: #2a2a2a;
        border-radius: 10px;
        border: 1px solid #404040;
        max-width: 600px;
        max-height: 80vh;
        width: 90%;
        overflow-y: auto;
        box-shadow: 0 20px 40px rgba(0,0,0,0.3);
      }

      .modal-header {
        padding: 20px;
        border-bottom: 1px solid #404040;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .modal-header h3 {
        margin: 0;
        color: #ffffff;
        font-size: 20px;
      }

      .modal-close {
        background: none;
        border: none;
        color: #cccccc;
        font-size: 20px;
        cursor: pointer;
        padding: 5px;
        border-radius: 3px;
      }

      .modal-close:hover {
        background: #404040;
        color: #ffffff;
      }

      .modal form {
        padding: 20px;
      }

      .info-text {
        color: #888888;
        font-size: 14px;
        margin: 10px 0;
      }

      .modal-buttons {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 20px;
      }

      .level-list {
        max-height: 400px;
        overflow-y: auto;
        padding: 20px;
      }

      .level-item {
        display: flex;
        align-items: flex-start;
        gap: 15px;
        padding: 15px;
        border: 1px solid #404040;
        border-radius: 8px;
        margin-bottom: 12px;
        background: #333333;
        transition: all 0.2s ease;
      }

      .level-item:hover {
        border-color: #4a90e2;
        background: #3a3a3a;
      }

      .level-item.current {
        border-color: #4a90e2;
        background: #1a2634;
      }

      .level-thumbnail {
        flex-shrink: 0;
        width: 120px;
        height: 90px;
        border-radius: 6px;
        overflow: hidden;
        border: 1px solid #555555;
        background: #222222;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .thumbnail-img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 4px;
      }

      .no-thumbnail {
        color: #888888;
        font-size: 12px;
        text-align: center;
      }

      .level-info {
        flex: 1;
        min-width: 0;
      }

      .level-info h4 {
        margin: 0 0 8px 0;
        color: #ffffff;
        font-size: 18px;
        font-weight: 600;
      }

      .level-description {
        margin: 0 0 10px 0;
        color: #cccccc;
        font-size: 14px;
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
      }

      .level-stats {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
      }

      .stat-item {
        color: #888888;
        font-size: 12px;
        background: rgba(255,255,255,0.05);
        padding: 4px 8px;
        border-radius: 12px;
        white-space: nowrap;
      }

      .level-actions {
        display: flex;
        gap: 5px;
        flex-shrink: 0;
      }

      .level-actions .btn {
        padding: 5px 10px;
        font-size: 12px;
      }

      .empty-state {
        text-align: center;
        padding: 40px;
        color: #888888;
      }

      .empty-state p:first-child {
        font-size: 18px;
        margin-bottom: 10px;
      }

      .level-stats {
        padding: 20px;
        border-bottom: 1px solid #404040;
        background: #1a1a1a;
      }

      .level-stats h4 {
        margin: 0 0 10px 0;
        color: #ffffff;
      }

      .level-stats p {
        margin: 5px 0;
        color: #cccccc;
        font-size: 14px;
      }

      .manage-actions {
        padding: 15px 20px;
        border-bottom: 1px solid #404040;
        display: flex;
        gap: 10px;
      }

      .toast {
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        font-size: 14px;
        z-index: 10001;
        transform: translateX(100%);
        transition: transform 0.3s ease;
      }

      .toast.show {
        transform: translateX(0);
      }

      .toast-success { background: #28a745; }
      .toast-error { background: #dc3545; }
      .toast-info { background: #17a2b8; }
    `;
    
    document.head.appendChild(style);
  }
}
