import type { LevelData } from '@/types/LevelTypes';

/**
 * 關卡配置掃描器
 * 負責掃描指定關卡的所有配置檔案並提供隨機抽選功能
 * 檔案格式：level{id}_{編號}.json (例如 level1_001.json, level1_002.json)
 */
export class LevelConfigScanner {
  private configCache: Map<string, string[]> = new Map();
  private loadedConfigs: Map<string, LevelData> = new Map();

  /**
   * 掃描指定關卡的所有配置檔案
   * @param levelId 關卡ID (1-8)
   * @returns Promise<string[]> 可用的配置檔案名稱列表
   */
  async scanLevelConfigs(levelId: number): Promise<string[]> {
    const cacheKey = `level${levelId}`;
    
    // 檢查快取
    if (this.configCache.has(cacheKey)) {
      console.log(`[LevelConfigScanner] 從快取取得關卡 ${levelId} 配置列表`);
      return this.configCache.get(cacheKey)!;
    }

    console.log(`[LevelConfigScanner] 掃描關卡 ${levelId} 的配置檔案...`);
    const availableConfigs: string[] = [];

    try {
      // 嘗試載入編號001到999的配置檔案
      for (let i = 1; i <= 999; i++) {
        const configNumber = i.toString().padStart(3, '0');
        const configName = `level${levelId}_${configNumber}`;
        
        try {
          const response = await fetch(`/assets/data/levels/${configName}.json`);
          if (response.ok) {
            availableConfigs.push(configName);
            console.log(`[LevelConfigScanner] 找到配置: ${configName}.json`);
          } else if (response.status === 404) {
            // 404表示檔案不存在，這是正常的，繼續檢查下一個
            continue;
          } else {
            console.warn(`[LevelConfigScanner] 檔案 ${configName}.json 存在但無法載入 (${response.status})`);
          }
        } catch (error) {
          // 網路錯誤或其他問題，繼續檢查下一個
          continue;
        }
        
        // 如果連續10個編號都沒找到，可能沒有更多配置了
        if (availableConfigs.length > 0 && i - parseInt(availableConfigs[availableConfigs.length - 1].split('_')[1]) > 10) {
          break;
        }
      }

      // 存入快取
      this.configCache.set(cacheKey, availableConfigs);
      
      console.log(`[LevelConfigScanner] 關卡 ${levelId} 找到 ${availableConfigs.length} 個配置檔案:`, availableConfigs);
      return availableConfigs;

    } catch (error) {
      console.error(`[LevelConfigScanner] 掃描關卡 ${levelId} 配置時發生錯誤:`, error);
      return [];
    }
  }

  /**
   * 隨機選擇指定關卡的一個配置
   * @param levelId 關卡ID (1-8)  
   * @returns Promise<string | null> 隨機選中的配置名稱，無配置時返回null
   */
  async randomSelectConfig(levelId: number): Promise<string | null> {
    const availableConfigs = await this.scanLevelConfigs(levelId);
    
    if (availableConfigs.length === 0) {
      console.warn(`[LevelConfigScanner] 關卡 ${levelId} 沒有可用的配置檔案`);
      return null;
    }

    const randomIndex = Math.floor(Math.random() * availableConfigs.length);
    const selectedConfig = availableConfigs[randomIndex];
    
    console.log(`[LevelConfigScanner] 關卡 ${levelId} 隨機選擇配置: ${selectedConfig} (${randomIndex + 1}/${availableConfigs.length})`);
    return selectedConfig;
  }

  /**
   * 載入指定的關卡配置
   * @param configName 配置名稱 (例如 "level1_001")
   * @returns Promise<LevelData> 關卡資料
   */
  async loadConfig(configName: string): Promise<LevelData> {
    // 檢查快取
    if (this.loadedConfigs.has(configName)) {
      console.log(`[LevelConfigScanner] 從快取載入配置: ${configName}`);
      return this.loadedConfigs.get(configName)!;
    }

    try {
      console.log(`[LevelConfigScanner] 載入配置檔案: ${configName}.json`);
      
      const response = await fetch(`/assets/data/levels/${configName}.json`);
      
      if (!response.ok) {
        throw new Error(`配置檔案載入失敗: ${configName} (${response.status})`);
      }

      const rawData = await response.json();
      const levelData = this.validateConfigData(rawData, configName);
      
      // 存入快取
      this.loadedConfigs.set(configName, levelData);
      
      console.log(`[LevelConfigScanner] 配置載入成功: ${configName}`);
      return levelData;
      
    } catch (error) {
      console.error(`[LevelConfigScanner] 配置載入失敗: ${configName}`, error);
      throw new Error(`無法載入配置 "${configName}": ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }

  /**
   * 隨機載入指定關卡的配置
   * @param levelId 關卡ID (1-8)
   * @returns Promise<LevelData | null> 隨機載入的關卡資料，無配置時返回null
   */
  async randomLoadConfig(levelId: number): Promise<LevelData | null> {
    const selectedConfig = await this.randomSelectConfig(levelId);
    
    if (!selectedConfig) {
      return null;
    }

    return await this.loadConfig(selectedConfig);
  }

  /**
   * 驗證配置資料格式
   * @param rawData 原始JSON資料
   * @param configName 配置名稱
   * @returns LevelData 驗證後的關卡資料
   */
  private validateConfigData(rawData: any, configName: string): LevelData {
    // 基本格式檢查
    if (!rawData || typeof rawData !== 'object') {
      throw new Error(`配置格式錯誤: ${configName} - 不是有效的JSON物件`);
    }

    // 檢查必要欄位
    if (!rawData.name) {
      rawData.name = configName; // 如果沒有名稱，使用檔案名
    }

    if (!rawData.version) {
      rawData.version = '1.0'; // 預設版本
    }

    if (!rawData.entities || !Array.isArray(rawData.entities)) {
      rawData.entities = []; // 如果沒有實體，建立空陣列
    }

    // 轉換為標準LevelData格式
    const levelData: LevelData = {
      metadata: {
        name: rawData.name,
        version: rawData.version,
        author: rawData.author || '編輯器',
        description: rawData.description || `從 ${configName} 載入的關卡配置`
      },
      objectives: rawData.objectives || [],
      entities: rawData.entities,
      events: rawData.events || [],
      settings: rawData.settings || {}
    };

    return levelData;
  }

  /**
   * 清除快取
   */
  clearCache(): void {
    this.configCache.clear();
    this.loadedConfigs.clear();
    console.log('[LevelConfigScanner] 快取已清除');
  }

  /**
   * 取得指定關卡的配置統計
   * @param levelId 關卡ID (1-8)
   * @returns Promise<{total: number, cached: boolean}> 配置統計資訊
   */
  async getConfigStats(levelId: number): Promise<{total: number, cached: boolean}> {
    const cacheKey = `level${levelId}`;
    const cached = this.configCache.has(cacheKey);
    const configs = await this.scanLevelConfigs(levelId);
    
    return {
      total: configs.length,
      cached: cached
    };
  }
}
