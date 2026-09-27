/**
 * 關卡儲存管理系統
 * 使用 localStorage 進行本地儲存
 */

import { LevelThumbnailGenerator } from '@/utils/LevelThumbnailGenerator';

export interface SavedLevel {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  modifiedAt: string;
  levelData: any;
  entityCount: number;
  thumbnail?: string;
}

export class LevelStorage {
  private storageKey = 'douqi_saved_levels';
  private thumbnailGenerator: LevelThumbnailGenerator;
  
  constructor() {
    this.thumbnailGenerator = new LevelThumbnailGenerator({
      width: 120,
      height: 90,
      backgroundColor: '#1a1a1a',
      gridColor: '#333333',
      showGrid: true
    });
  }
  
  /**
   * 儲存關卡
   */
  saveLevel(level: Omit<SavedLevel, 'id' | 'createdAt' | 'modifiedAt'>): string {
    const levels = this.getAllLevels();
    
    // 檢查名稱是否已存在
    const existingLevel = levels.find(l => l.name === level.name);
    
    const now = new Date().toISOString();
    
    // 生成關卡縮圖
    const thumbnail = this.generateThumbnail(level.levelData);
    
    const savedLevel: SavedLevel = {
      id: existingLevel?.id || this.generateId(),
      createdAt: existingLevel?.createdAt || now,
      modifiedAt: now,
      thumbnail,
      ...level
    };
    
    if (existingLevel) {
      // 更新現有關卡
      const index = levels.findIndex(l => l.id === savedLevel.id);
      levels[index] = savedLevel;
    } else {
      // 新增關卡
      levels.push(savedLevel);
    }
    
    this.saveLevels(levels);
    return savedLevel.id;
  }
  
  /**
   * 載入關卡
   */
  loadLevel(id: string): SavedLevel | null {
    const levels = this.getAllLevels();
    return levels.find(level => level.id === id) || null;
  }
  
  /**
   * 取得所有關卡
   */
  getAllLevels(): SavedLevel[] {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('載入關卡失敗:', error);
      return [];
    }
  }
  
  /**
   * 刪除關卡
   */
  deleteLevel(id: string): boolean {
    const levels = this.getAllLevels();
    const filteredLevels = levels.filter(level => level.id !== id);
    
    if (filteredLevels.length !== levels.length) {
      this.saveLevels(filteredLevels);
      return true;
    }
    return false;
  }
  
  /**
   * 重新命名關卡
   */
  renameLevel(id: string, newName: string, newDescription?: string): boolean {
    const levels = this.getAllLevels();
    const level = levels.find(l => l.id === id);
    
    if (level) {
      // 檢查新名稱是否與其他關卡衝突
      const existingLevel = levels.find(l => l.id !== id && l.name === newName);
      if (existingLevel) {
        throw new Error(`關卡名稱 "${newName}" 已存在`);
      }
      
      level.name = newName;
      if (newDescription !== undefined) {
        level.description = newDescription;
      }
      level.modifiedAt = new Date().toISOString();
      
      this.saveLevels(levels);
      return true;
    }
    return false;
  }
  
  /**
   * 複製關卡
   */
  duplicateLevel(id: string, newName?: string): string | null {
    const originalLevel = this.loadLevel(id);
    if (!originalLevel) return null;
    
    const copyName = newName || `${originalLevel.name} - 副本`;
    
    // 確保名稱唯一性
    let finalName = copyName;
    let counter = 1;
    while (this.getAllLevels().some(l => l.name === finalName)) {
      finalName = `${copyName} (${counter})`;
      counter++;
    }
    
    const newId = this.saveLevel({
      name: finalName,
      description: originalLevel.description,
      levelData: JSON.parse(JSON.stringify(originalLevel.levelData)), // 深拷貝
      entityCount: originalLevel.entityCount,
      thumbnail: originalLevel.thumbnail
    });
    
    return newId;
  }
  
  /**
   * 匯出關卡資料
   */
  exportLevel(id: string): string | null {
    const level = this.loadLevel(id);
    if (!level) return null;
    
    return JSON.stringify(level, null, 2);
  }
  
  /**
   * 匯入關卡資料
   */
  importLevel(jsonData: string): string {
    try {
      const levelData = JSON.parse(jsonData);
      
      // 驗證資料格式
      if (!levelData.name || !levelData.levelData) {
        throw new Error('無效的關卡資料格式');
      }
      
      // 確保名稱唯一性
      let importName = levelData.name;
      let counter = 1;
      while (this.getAllLevels().some(l => l.name === importName)) {
        importName = `${levelData.name} (匯入${counter})`;
        counter++;
      }
      
      const newId = this.saveLevel({
        name: importName,
        description: levelData.description || '匯入的關卡',
        levelData: levelData.levelData,
        entityCount: levelData.entityCount || 0,
        thumbnail: levelData.thumbnail
      });
      
      return newId;
    } catch (error) {
      throw new Error(`關卡匯入失敗: ${error instanceof Error ? error.message : '未知錯誤'}`);
    }
  }
  
  /**
   * 取得關卡統計
   */
  getStatistics(): {
    totalLevels: number;
    totalEntities: number;
    latestModified: string | null;
  } {
    const levels = this.getAllLevels();
    const totalEntities = levels.reduce((sum, level) => sum + level.entityCount, 0);
    const latestModified = levels.length > 0 
      ? levels.reduce((latest, level) => 
          level.modifiedAt > latest ? level.modifiedAt : latest, 
          levels[0].modifiedAt
        )
      : null;
    
    return {
      totalLevels: levels.length,
      totalEntities,
      latestModified
    };
  }
  
  /**
   * 清除所有關卡
   */
  clearAllLevels(): void {
    localStorage.removeItem(this.storageKey);
  }
  
  /**
   * 生成關卡縮圖
   */
  private generateThumbnail(levelData: any): string {
    try {
      return this.thumbnailGenerator.generateThumbnail(levelData);
    } catch (error) {
      console.error('縮圖生成失敗:', error);
      return this.generateFallbackThumbnail();
    }
  }
  
  /**
   * 生成備用縮圖
   */
  private generateFallbackThumbnail(): string {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    
    // 簡單的灰色背景
    ctx.fillStyle = '#333333';
    ctx.fillRect(0, 0, 120, 90);
    
    // 添加文字
    ctx.fillStyle = '#cccccc';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('無預覽', 60, 50);
    
    return canvas.toDataURL('image/png', 0.8);
  }
  
  /**
   * 私有方法：儲存關卡陣列
   */
  private saveLevels(levels: SavedLevel[]): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(levels));
    } catch (error) {
      console.error('儲存關卡失敗:', error);
      throw new Error('儲存空間不足或其他儲存錯誤');
    }
  }
  
  /**
   * 私有方法：生成唯一ID
   */
  private generateId(): string {
    return `level_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
