/**
 * 關卡掃描器 - 掃描遊戲中現有的關卡檔案
 */
export interface GameLevel {
  id: string;
  name: string;
  description: string;
  path: string;
  data?: any;
}

export class LevelScanner {
  private knownLevels: GameLevel[] = [];

  /**
   * 掃描可用的遊戲關卡
   * 目前已知關卡：test_level
   */
  async scanAvailableLevels(): Promise<GameLevel[]> {
    console.log('[LevelScanner] 開始掃描可用關卡');
    
    // 目前已知的遊戲關卡列表 - 使用相對路徑
    const knownLevelPaths = [
      '../assets/data/levels/test_level.json'
    ];
    
    const availableLevels: GameLevel[] = [];
    
    for (const path of knownLevelPaths) {
      try {
        console.log(`[LevelScanner] 檢查關卡: ${path}`);
        
        // 嘗試載入關卡檔案
        const response = await fetch(path);
        console.log(`[LevelScanner] 請求狀態: ${response.status} ${response.statusText} for ${path}`);
        
        if (!response.ok) {
          console.warn(`[LevelScanner] 關卡檔案不存在: ${path} (${response.status})`);
          continue;
        }
        
        const levelData = await response.json();
        console.log(`[LevelScanner] 成功載入關卡資料:`, levelData.metadata?.name);
        
        // 驗證關卡格式
        if (this.validateLevelData(levelData)) {
          availableLevels.push({
            id: levelData.level?.id || 'unknown',
            name: levelData.metadata?.name || levelData.level?.name || '未命名關卡',
            description: levelData.metadata?.description || levelData.level?.description || '無描述',
            path: path,
            data: levelData
          });
          
          console.log(`[LevelScanner] ✅ 找到有效關卡: ${levelData.metadata?.name}`);
        } else {
          console.warn(`[LevelScanner] ❌ 關卡格式無效: ${path}`);
        }
        
      } catch (error) {
        console.error(`[LevelScanner] 載入關卡失敗: ${path}`, error);
      }
    }
    
    this.knownLevels = availableLevels;
    console.log(`[LevelScanner] 掃描完成，找到 ${availableLevels.length} 個可用關卡`);
    
    return availableLevels;
  }

  /**
   * 驗證關卡資料格式
   */
  private validateLevelData(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }
    
    // 檢查必要欄位
    if (!data._format || data._format !== 'douqi-level') {
      return false;
    }
    
    if (!data.metadata || !data.level) {
      return false;
    }
    
    return true;
  }

  /**
   * 載入指定關卡的完整資料
   */
  async loadLevelData(levelId: string): Promise<any> {
    const level = this.knownLevels.find(l => l.id === levelId);
    if (!level) {
      throw new Error(`找不到關卡: ${levelId}`);
    }
    
    if (level.data) {
      return level.data;
    }
    
    // 重新載入關卡資料
    const response = await fetch(level.path);
    if (!response.ok) {
      throw new Error(`載入關卡失敗: ${level.path}`);
    }
    
    const levelData = await response.json();
    level.data = levelData;
    
    return levelData;
  }

  /**
   * 取得已掃描的關卡列表
   */
  getAvailableLevels(): GameLevel[] {
    return [...this.knownLevels];
  }
}
