import type { LevelData } from '@/types/LevelTypes';

/**
 * 鬥氣割草 - 關卡載入器
 * 負責從 JSON 檔案載入關卡資料並驗證格式
 */
export class LevelLoader {
  private loadedLevels: Map<string, LevelData> = new Map();
  
  /**
   * 載入指定關卡
   * @param levelName 關卡名稱（不含副檔名）
   * @returns Promise<LevelData> 關卡資料
   */
  async loadLevel(levelName: string): Promise<LevelData> {
    // 檢查快取
    if (this.loadedLevels.has(levelName)) {
      console.log(`[LevelLoader] 從快取載入關卡: ${levelName}`);
      return this.loadedLevels.get(levelName)!;
    }

    try {
      console.log(`[LevelLoader] 載入關卡檔案: ${levelName}`);
      
      const response = await fetch(`/assets/data/levels/${levelName}.json`);
      
      if (!response.ok) {
        throw new Error(`關卡檔案載入失敗: ${levelName} (${response.status})`);
      }

      const rawData = await response.json();
      const levelData = this.validateLevelData(rawData, levelName);
      
      // 存入快取
      this.loadedLevels.set(levelName, levelData);
      
      console.log(`[LevelLoader] 關卡載入成功: ${levelData.metadata.name}`);
      return levelData;
      
    } catch (error) {
      console.error(`[LevelLoader] 關卡載入失敗: ${levelName}`, error);
      throw new Error(`無法載入關卡 "${levelName}": ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }

  /**
   * 預載多個關卡
   * @param levelNames 關卡名稱陣列
   */
  async preloadLevels(levelNames: string[]): Promise<void> {
    console.log(`[LevelLoader] 開始預載 ${levelNames.length} 個關卡`);
    
    const loadPromises = levelNames.map(name => 
      this.loadLevel(name).catch(error => {
        console.warn(`[LevelLoader] 預載關卡失敗: ${name}`, error);
        return null;
      })
    );

    const results = await Promise.all(loadPromises);
    const successCount = results.filter(result => result !== null).length;
    
    console.log(`[LevelLoader] 預載完成: ${successCount}/${levelNames.length} 個關卡載入成功`);
  }

  /**
   * 驗證關卡資料格式
   * @param data 原始 JSON 資料
   * @param levelName 關卡名稱（用於錯誤報告）
   * @returns LevelData 驗證後的關卡資料
   */
  private validateLevelData(data: any, levelName: string): LevelData {
    const errors: string[] = [];

    // 檢查基本結構
    if (!data._format || data._format !== 'douqi-level') {
      errors.push('缺少有效的 _format 欄位');
    }

    if (!data._version) {
      errors.push('缺少 _version 欄位');
    }

    if (!data.metadata || typeof data.metadata !== 'object') {
      errors.push('缺少 metadata 物件');
    }

    if (!data.level || typeof data.level !== 'object') {
      errors.push('缺少 level 物件');
    }

    if (!data.gameplay || typeof data.gameplay !== 'object') {
      errors.push('缺少 gameplay 物件');
    }

    if (!Array.isArray(data.entities)) {
      errors.push('entities 必須是陣列');
    }

    if (!Array.isArray(data.events)) {
      errors.push('events 必須是陣列');
    }

    // 檢查必要欄位
    if (data.level) {
      if (!data.level.id || !data.level.name) {
        errors.push('level 缺少 id 或 name 欄位');
      }
      
      if (typeof data.level.timeLimit !== 'number' || data.level.timeLimit <= 0) {
        errors.push('timeLimit 必須是大於0的數字');
      }
      
      if (typeof data.level.scoreTarget !== 'number' || data.level.scoreTarget < 0) {
        errors.push('scoreTarget 必須是非負數字');
      }
    }

    // 檢查玩家起始資料
    if (data.gameplay) {
      if (!Array.isArray(data.gameplay.playerStartPosition) || data.gameplay.playerStartPosition.length !== 3) {
        errors.push('playerStartPosition 必須是長度為3的數字陣列');
      }
      
      if (!Array.isArray(data.gameplay.playerStartRotation) || data.gameplay.playerStartRotation.length !== 3) {
        errors.push('playerStartRotation 必須是長度為3的數字陣列');
      }
    }

    // 檢查實體資料
    if (Array.isArray(data.entities)) {
      data.entities.forEach((entity: any, index: number) => {
        if (!entity.id || !entity.type || !entity.name) {
          errors.push(`實體 [${index}] 缺少必要欄位 (id, type, name)`);
        }
        
        if (!Array.isArray(entity.position) || entity.position.length !== 3) {
          errors.push(`實體 [${index}] position 必須是長度為3的數字陣列`);
        }
        
        if (!entity.properties || typeof entity.properties !== 'object') {
          errors.push(`實體 [${index}] 缺少 properties 物件`);
        }
      });
    }

    // 如果有錯誤，拋出詳細訊息
    if (errors.length > 0) {
      throw new Error(`關卡 "${levelName}" 格式驗證失敗:\n${errors.map(err => `- ${err}`).join('\n')}`);
    }

    // 填補可選欄位的預設值
    const levelData: LevelData = {
      ...data,
      config: {
        backgroundMusic: '',
        ambientSounds: [],
        weatherEffects: { type: 'clear', windStrength: 0 },
        lighting: { timeOfDay: 'noon', shadowQuality: 'medium' },
        ...data.config
      }
    };

    return levelData;
  }

  /**
   * 清除關卡快取
   */
  clearCache(): void {
    this.loadedLevels.clear();
    console.log('[LevelLoader] 快取已清除');
  }

  /**
   * 取得已載入的關卡列表
   */
  getLoadedLevels(): string[] {
    return Array.from(this.loadedLevels.keys());
  }

  /**
   * 取得快取中的關卡資料
   */
  getCachedLevel(levelName: string): LevelData | null {
    return this.loadedLevels.get(levelName) || null;
  }
}
