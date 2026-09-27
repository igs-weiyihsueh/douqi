import Phaser from 'phaser';

/**
 * 關卡選擇場景
 * 讓玩家選擇要遊玩的關卡（包含編輯器創建的關卡）
 */
export class LevelSelectScene extends Phaser.Scene {
  private availableLevels: Array<{id: string, name: string, description: string, source: 'builtin' | 'editor'}> = [];
  private selectedIndex: number = 0;
  private levelButtons: Phaser.GameObjects.Text[] = [];
  private buttonBackgrounds: Phaser.GameObjects.Rectangle[] = [];

  constructor() {
    super({ key: 'LevelSelectScene' });
  }

  create() {
    console.log('[LevelSelectScene] 建立關卡選擇場景');

    // 背景
    this.add.rectangle(640, 360, 1280, 720, 0x001122);

    // 標題
    this.add.text(640, 80, '🎮 關卡選擇', {
      fontSize: '48px',
      color: '#ffffff',
      fontFamily: 'monospace'
    }).setOrigin(0.5);

    // 說明文字
    this.add.text(640, 140, '選擇要挑戰的關卡', {
      fontSize: '24px',
      color: '#cccccc',
      fontFamily: 'monospace'
    }).setOrigin(0.5);

    // 載入可用關卡
    this.loadAvailableLevels();

    // 建立關卡按鈕
    this.createLevelButtons();

    // 控制說明
    this.add.text(640, 620, '↑↓ 選擇關卡 | ENTER 確認 | ESC 返回主選單 | R 重新整理', {
      fontSize: '18px',
      color: '#888888',
      fontFamily: 'monospace'
    }).setOrigin(0.5);

    // 設定輸入
    this.setupInput();

    // 檢查是否有編輯器測試關卡需要自動選擇
    this.checkForEditorTestLevel();

    // 更新選擇顯示
    this.updateSelection();
  }

  /**
   * 檢查編輯器測試關卡
   */
  private checkForEditorTestLevel(): void {
    try {
      // 查找最新的編輯器測試關卡
      const keys = Object.keys(localStorage);
      const testKeys = keys.filter(key => key.startsWith('douqi_level_test_'))
                          .sort() // 按時間戳排序
                          .reverse(); // 最新的在前

      if (testKeys.length > 0) {
        const latestTestKey = testKeys[0];
        const testData = localStorage.getItem(latestTestKey);
        
        if (testData) {
          console.log('[LevelSelectScene] 發現編輯器測試關卡，自動載入:', latestTestKey);
          
          // 找到對應的關卡索引
          const testLevelIndex = this.availableLevels.findIndex(level => level.id === latestTestKey);
          
          if (testLevelIndex >= 0) {
            // 自動選擇並啟動測試關卡
            this.selectedIndex = testLevelIndex;
            this.updateSelection();
            
            // 顯示自動測試提示
            const autoTestText = this.add.text(640, 180, '🎮 自動載入編輯器測試關卡！', {
              fontSize: '24px',
              color: '#00ff00',
              fontFamily: 'monospace'
            }).setOrigin(0.5);
            
            // 2秒後自動開始
            this.time.delayedCall(2000, () => {
              autoTestText.destroy();
              this.selectLevel();
            });
          }
        }
      }
    } catch (e) {
      console.warn('[LevelSelectScene] 檢查編輯器測試關卡失敗:', e);
    }
  }

  /**
   * 載入可用關卡
   */
  private loadAvailableLevels(): void {
    // 內建關卡
    this.availableLevels = [
      {
        id: 'test_level',
        name: '📚 新手教學',
        description: '學習基本操作和遊戲機制',
        source: 'builtin' as const
      }
    ];

    // 從編輯器載入關卡（localStorage）
    this.loadEditorLevels();
  }

  /**
   * 從編輯器載入關卡
   */
  private loadEditorLevels(): void {
    try {
      // 從localStorage讀取編輯器關卡
      const keys = Object.keys(localStorage);
      const levelKeys = keys.filter(key => key.startsWith('douqi_level_'));

      for (const key of levelKeys) {
        try {
          const levelDataStr = localStorage.getItem(key);
          if (levelDataStr) {
            const savedLevel = JSON.parse(levelDataStr);
            
            this.availableLevels.push({
              id: key,
              name: `🎯 ${savedLevel.name || '未命名關卡'}`,
              description: savedLevel.description || '編輯器創建的關卡',
              source: 'editor' as const
            });
          }
        } catch (e) {
          console.warn(`[LevelSelectScene] 無法載入關卡 ${key}:`, e);
        }
      }

      console.log(`[LevelSelectScene] 載入了 ${this.availableLevels.length} 個關卡`);
    } catch (e) {
      console.error('[LevelSelectScene] 載入編輯器關卡失敗:', e);
    }
  }

  /**
   * 建立關卡按鈕
   */
  private createLevelButtons(): void {
    // 清除舊的按鈕
    this.levelButtons.forEach(btn => btn.destroy());
    this.buttonBackgrounds.forEach(bg => bg.destroy());
    this.levelButtons = [];
    this.buttonBackgrounds = [];

    if (this.availableLevels.length === 0) {
      this.add.text(640, 350, '沒有可用的關卡\n\n請使用編輯器創建關卡或檢查遊戲文件', {
        fontSize: '24px',
        color: '#ff6666',
        fontFamily: 'monospace',
        align: 'center'
      }).setOrigin(0.5);
      return;
    }

    const startY = 200;
    const spacing = 70;
    const maxVisibleLevels = 6;
    const scrollOffset = Math.max(0, this.selectedIndex - maxVisibleLevels + 1);

    for (let i = 0; i < Math.min(maxVisibleLevels, this.availableLevels.length); i++) {
      const levelIndex = scrollOffset + i;
      if (levelIndex >= this.availableLevels.length) break;

      const level = this.availableLevels[levelIndex];
      const y = startY + i * spacing;

      // 關卡按鈕背景
      const buttonBg = this.add.rectangle(640, y, 600, 60, 0x333333);
      buttonBg.setStrokeStyle(2, 0x666666);
      this.buttonBackgrounds.push(buttonBg);

      // 關卡名稱
      const buttonText = this.add.text(640, y - 10, level.name, {
        fontSize: '24px',
        color: '#ffffff',
        fontFamily: 'monospace'
      }).setOrigin(0.5);
      this.levelButtons.push(buttonText);

      // 關卡描述
      this.add.text(640, y + 15, level.description, {
        fontSize: '14px',
        color: level.source === 'editor' ? '#88ccff' : '#cccccc',
        fontFamily: 'monospace'
      }).setOrigin(0.5);

      // 來源標記
      const sourceText = level.source === 'editor' ? '編輯器' : '內建';
      this.add.text(900, y, sourceText, {
        fontSize: '12px',
        color: level.source === 'editor' ? '#00ff88' : '#ffaa00',
        fontFamily: 'monospace'
      }).setOrigin(0.5);

      // 滑鼠互動
      buttonBg.setInteractive();
      buttonBg.on('pointerover', () => {
        this.selectedIndex = levelIndex;
        this.updateSelection();
      });
      buttonBg.on('pointerdown', () => {
        this.selectLevel();
      });
    }
  }

  /**
   * 設定輸入控制
   */
  private setupInput(): void {
    // 上下鍵選擇關卡
    this.input.keyboard!.on('keydown-UP', () => {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      this.updateSelection();
      this.refreshButtons();
    });

    this.input.keyboard!.on('keydown-DOWN', () => {
      this.selectedIndex = Math.min(this.availableLevels.length - 1, this.selectedIndex + 1);
      this.updateSelection();
      this.refreshButtons();
    });

    // 確認選擇
    this.input.keyboard!.on('keydown-ENTER', () => {
      this.selectLevel();
    });

    // 返回主選單
    this.input.keyboard!.on('keydown-ESC', () => {
      this.scene.start('TitleScene');
    });

    // 重新整理關卡列表
    this.input.keyboard!.on('keydown-R', () => {
      this.refreshLevels();
    });
  }

  /**
   * 重新整理按鈕顯示
   */
  private refreshButtons(): void {
    this.createLevelButtons();
    this.updateSelection();
  }

  /**
   * 重新整理關卡列表
   */
  private refreshLevels(): void {
    this.loadAvailableLevels();
    this.selectedIndex = 0;
    this.createLevelButtons();
    this.updateSelection();
    
    // 顯示重新整理提示
    const refreshText = this.add.text(640, 180, '關卡列表已重新整理！', {
      fontSize: '20px',
      color: '#00ff00',
      fontFamily: 'monospace'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: refreshText,
      alpha: 0,
      y: 160,
      duration: 2000,
      onComplete: () => refreshText.destroy()
    });
  }

  /**
   * 更新選擇顯示
   */
  private updateSelection(): void {
    // 重新計算可見區域
    const maxVisibleLevels = 6;
    const scrollOffset = Math.max(0, this.selectedIndex - maxVisibleLevels + 1);

    this.levelButtons.forEach((button, index) => {
      const levelIndex = scrollOffset + index;
      if (levelIndex === this.selectedIndex) {
        button.setColor('#ffff00');
        button.setFontSize('28px');
        if (this.buttonBackgrounds[index]) {
          this.buttonBackgrounds[index].setFillStyle(0x555555);
          this.buttonBackgrounds[index].setStrokeStyle(3, 0xffff00);
        }
      } else {
        button.setColor('#ffffff');
        button.setFontSize('24px');
        if (this.buttonBackgrounds[index]) {
          this.buttonBackgrounds[index].setFillStyle(0x333333);
          this.buttonBackgrounds[index].setStrokeStyle(2, 0x666666);
        }
      }
    });
  }

  /**
   * 選擇關卡並開始遊戲
   */
  private selectLevel(): void {
    if (this.availableLevels.length === 0) return;

    const selectedLevel = this.availableLevels[this.selectedIndex];
    console.log(`[LevelSelectScene] 選擇關卡: ${selectedLevel.name} (${selectedLevel.id})`);

    // 播放確認音效
    this.playSelectSound();

    // 根據關卡來源決定如何啟動
    if (selectedLevel.source === 'editor') {
      // 編輯器關卡：載入localStorage中的關卡數據
      this.loadEditorLevel(selectedLevel.id);
    } else {
      // 內建關卡：使用傳統方式
      this.scene.start('LevelGameScene', { levelName: selectedLevel.id });
    }
  }

  /**
   * 載入編輯器關卡
   */
  private loadEditorLevel(levelId: string): void {
    try {
      const levelDataStr = localStorage.getItem(levelId);
      if (levelDataStr) {
        const savedLevel = JSON.parse(levelDataStr);
        
        // 轉換編輯器格式到遊戲格式
        const gameData = this.convertEditorToGameFormat(savedLevel);
        
        console.log('[LevelSelectScene] 載入編輯器關卡:', gameData);
        
        // 啟動遊戲場景並傳入關卡數據
        this.scene.start('LevelGameScene', { 
          levelData: gameData,
          isCustomLevel: true 
        });
      } else {
        throw new Error('關卡數據不存在');
      }
    } catch (e) {
      console.error('[LevelSelectScene] 載入編輯器關卡失敗:', e);
      
      // 顯示錯誤訊息
      const errorText = this.add.text(640, 350, `載入關卡失敗: ${e}`, {
        fontSize: '24px',
        color: '#ff0000',
        fontFamily: 'monospace'
      }).setOrigin(0.5);

      this.time.delayedCall(3000, () => errorText.destroy());
    }
  }

  /**
   * 轉換編輯器格式到遊戲格式
   */
  private convertEditorToGameFormat(savedLevel: any): any {
    return {
      metadata: {
        name: savedLevel.name || 'Untitled Level',
        description: savedLevel.description || '',
        created: savedLevel.lastModified || new Date().toISOString(),
        editor: '2D Level Editor'
      },
      level: {
        id: 'custom_' + Date.now(),
        name: savedLevel.name || 'Custom Level',
        description: savedLevel.description || '',
        difficulty: savedLevel.difficulty || 'normal',
        timeLimit: savedLevel.gameTime || 300,
        scoreTarget: savedLevel.targetScore || 1000
      },
      gameplay: {
        playerStartPosition: [0, 0, 0],
        playerStartRotation: [0, 0, 0],
        cameraSettings: {
          type: 'follow' as const
        },
        objectives: [
          {
            id: 'main_objective',
            type: 'collect' as const,
            description: '收集所有道具',
            target: savedLevel.entities?.filter((e: any) => e.type === 'item').length || 10,
            reward: 100
          }
        ]
      },
      entities: savedLevel.entities || [],
      events: savedLevel.events || []
    };
  }

  /**
   * 播放選擇音效
   */
  private playSelectSound(): void {
    // 簡單的視覺回饋
    this.cameras.main.flash(200, 255, 255, 255, false);
  }
}
