import { LevelScanner, GameLevel } from '@/core/LevelScanner';
import { GamePreviewManager } from '@/managers/GamePreviewManager';

/**
 * 鬥氣割草 2D關卡編輯器 - 關卡載入版本
 * 主要功能：載入現有關卡 → 在中央顯示遊戲預覽 → 編輯並即時同步
 */
class LevelEditor {
  private levelScanner!: LevelScanner;
  private gamePreviewManager!: GamePreviewManager;
  private levelSelector!: HTMLSelectElement;
  private availableLevels: GameLevel[] = [];
  private currentLevel: GameLevel | null = null;

  constructor() {
    console.log('[LevelEditor] 初始化關卡編輯器');
    
    // 等待DOM載入完成後初始化
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  /**
   * 初始化編輯器
   */
  private async init(): Promise<void> {
    console.log('[LevelEditor] 開始初始化');
    
    try {
      // 初始化核心組件
      this.levelScanner = new LevelScanner();
      this.gamePreviewManager = new GamePreviewManager();
      
      // 取得UI元素
      this.levelSelector = document.getElementById('level-selector') as HTMLSelectElement;
      if (!this.levelSelector) {
        throw new Error('找不到關卡選擇器 #level-selector');
      }
      
      // 初始化UI事件
      this.initUI();
      
      // 掃描可用關卡
      await this.scanAvailableLevels();
      
      // 設置視窗調整
      window.addEventListener('resize', () => this.gamePreviewManager.resize());
      
      console.log('[LevelEditor] 編輯器初始化完成');
      
    } catch (error) {
      console.error('[LevelEditor] 初始化失敗:', error);
    }
  }

  /**
   * 初始化UI事件
   */
  private initUI(): void {
    console.log('[LevelEditor] 初始化UI事件');
    
    // 關卡選擇事件
    this.levelSelector.addEventListener('change', (e) => {
      const target = e.target as HTMLSelectElement;
      this.onLevelSelected(target.value);
    });
    
    // 其他工具列按鈕事件（保持原有功能）
    this.bindToolbarEvents();
  }

  /**
   * 綁定工具列事件
   */
  private bindToolbarEvents(): void {
    // 存檔
    const saveBtn = document.getElementById('btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.saveLevel());
    }
    
    // 載入
    const loadBtn = document.getElementById('btn-load');
    if (loadBtn) {
      loadBtn.addEventListener('click', () => this.loadLevel());
    }
    
    // 管理
    const manageBtn = document.getElementById('btn-manage');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => this.manageLevel());
    }
    
    // 測試關卡
    const testBtn = document.getElementById('btn-test');
    if (testBtn) {
      testBtn.addEventListener('click', () => this.testLevel());
    }
  }

  /**
   * 掃描可用關卡
   */
  private async scanAvailableLevels(): Promise<void> {
    console.log('[LevelEditor] 掃描可用關卡');
    
    try {
      this.availableLevels = await this.levelScanner.scanAvailableLevels();
      
      // 更新下拉選單
      this.updateLevelSelector();
      
      console.log(`[LevelEditor] 找到 ${this.availableLevels.length} 個可用關卡`);
      
    } catch (error) {
      console.error('[LevelEditor] 掃描關卡失敗:', error);
    }
  }

  /**
   * 更新關卡選擇器
   */
  private updateLevelSelector(): void {
    // 清空現有選項（保留預設選項）
    this.levelSelector.innerHTML = '<option value="">選擇關卡...</option>';
    
    // 添加可用關卡
    this.availableLevels.forEach(level => {
      const option = document.createElement('option');
      option.value = level.id;
      option.textContent = `${level.name}`;
      option.title = level.description;
      this.levelSelector.appendChild(option);
      console.log(`[LevelEditor] 添加關卡選項: ${level.id} - ${level.name}`);
    });
    
    console.log(`[LevelEditor] 更新關卡選擇器，共 ${this.availableLevels.length} 個選項`);
    
    // 如果沒有關卡，顯示提示
    if (this.availableLevels.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = '沒有找到可用關卡';
      option.disabled = true;
      this.levelSelector.appendChild(option);
      console.warn('[LevelEditor] ⚠️ 沒有找到任何可用關卡');
    }
  }

  /**
   * 處理關卡選擇
   */
  private async onLevelSelected(levelId: string): Promise<void> {
    if (!levelId) {
      // 清空選擇
      this.currentLevel = null;
      this.gamePreviewManager.clearPreview();
      console.log('[LevelEditor] 清空關卡選擇');
      return;
    }
    
    console.log(`[LevelEditor] 選擇關卡: ${levelId}`);
    
    try {
      // 找到對應關卡
      const level = this.availableLevels.find(l => l.id === levelId);
      if (!level) {
        throw new Error(`找不到關卡: ${levelId}`);
      }
      
      // 載入關卡資料
      const levelData = await this.levelScanner.loadLevelData(levelId);
      
      // 載入到預覽
      await this.gamePreviewManager.loadLevel(levelData);
      
      // 更新當前關卡
      this.currentLevel = level;
      
      console.log(`[LevelEditor] 關卡載入成功: ${level.name}`);
      
    } catch (error) {
      console.error('[LevelEditor] 載入關卡失敗:', error);
      
      // 重置選擇器
      this.levelSelector.value = '';
      this.currentLevel = null;
      this.gamePreviewManager.clearPreview();
    }
  }

  /**
   * 存檔
   */
  private saveLevel(): void {
    if (!this.currentLevel) {
      alert('請先選擇一個關卡');
      return;
    }
    
    console.log('[LevelEditor] 存檔關卡:', this.currentLevel.name);
    
    // 取得當前關卡資料
    const levelData = this.gamePreviewManager.getCurrentLevel();
    if (levelData) {
      // 存檔邏輯（可以存到localStorage或匯出檔案）
      localStorage.setItem(`editor_level_${this.currentLevel.id}`, JSON.stringify(levelData));
      alert(`關卡 "${this.currentLevel.name}" 已存檔`);
    }
  }

  /**
   * 載入
   */
  private loadLevel(): void {
    // 現有的載入邏輯（從localStorage載入用戶創建的關卡）
    console.log('[LevelEditor] 載入用戶關卡');
  }

  /**
   * 管理
   */
  private manageLevel(): void {
    console.log('[LevelEditor] 關卡管理');
  }

  /**
   * 測試關卡
   */
  private testLevel(): void {
    if (!this.currentLevel) {
      alert('請先選擇一個關卡');
      return;
    }
    
    console.log('[LevelEditor] 測試關卡:', this.currentLevel.name);
    
    // 構建測試URL
    const gameUrl = '../../index.html';
    const params = new URLSearchParams({
      scene: 'levelSelect',
      level: this.currentLevel.id
    });
    
    // 開啟遊戲
    window.open(`${gameUrl}?${params.toString()}`, '_blank');
  }
}

// 創建編輯器實例
new LevelEditor();
