import type { GameEvent, LevelEventCallback } from '@/types/LevelTypes';

/**
 * 鬥氣割草 - 事件觸發器
 * 負責管理關卡中的時間事件、條件觸發等遊戲事件
 */
export class EventTrigger {
  private scene: Phaser.Scene;
  private events: Map<string, GameEvent> = new Map();
  private activeEvents: Set<string> = new Set();
  private timeBasedEvents: GameEvent[] = [];
  private conditionEvents: GameEvent[] = [];
  private eventCallbacks: Map<string, LevelEventCallback[]> = new Map();
  
  private gameStartTime: number = 0;
  private currentTime: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * 初始化事件系統
   * @param events 關卡事件配置
   */
  setupEvents(events: GameEvent[]): void {
    console.log(`[EventTrigger] 初始化 ${events.length} 個事件`);
    
    this.clearAllEvents();
    this.gameStartTime = Date.now();

    events.forEach(event => {
      this.events.set(event.id, event);

      // 分類事件類型
      if (typeof event.triggerTime === 'number') {
        this.timeBasedEvents.push(event);
      } else if (event.triggerCondition) {
        this.conditionEvents.push(event);
      }
    });

    // 按觸發時間排序
    this.timeBasedEvents.sort((a, b) => (a.triggerTime || 0) - (b.triggerTime || 0));

    console.log(`[EventTrigger] 事件初始化完成: ${this.timeBasedEvents.length} 個時間事件, ${this.conditionEvents.length} 個條件事件`);
  }

  /**
   * 更新事件系統（應在遊戲主迴圈中呼叫）
   * @param gameState 當前遊戲狀態
   */
  update(gameState: any): void {
    this.currentTime = (Date.now() - this.gameStartTime) / 1000; // 轉為秒

    // 檢查時間觸發事件
    this.checkTimeBasedEvents();
    
    // 檢查條件觸發事件
    this.checkConditionEvents(gameState);
  }

  /**
   * 檢查時間觸發事件
   */
  private checkTimeBasedEvents(): void {
    this.timeBasedEvents.forEach(event => {
      if (this.activeEvents.has(event.id)) return;
      
      if (event.triggerTime && this.currentTime >= event.triggerTime) {
        this.triggerEvent(event);
      }
    });
  }

  /**
   * 檢查條件觸發事件
   * @param gameState 遊戲狀態
   */
  private checkConditionEvents(gameState: any): void {
    this.conditionEvents.forEach(event => {
      if (this.activeEvents.has(event.id)) return;
      
      if (this.evaluateCondition(event.triggerCondition!, gameState)) {
        this.triggerEvent(event);
      }
    });
  }

  /**
   * 評估觸發條件
   * @param condition 條件字串
   * @param gameState 遊戲狀態
   */
  private evaluateCondition(condition: string, gameState: any): boolean {
    try {
      // 簡單的條件評估器，實際應用中可擴展為更複雜的表達式解析
      if (condition.includes('score >')) {
        const targetScore = parseInt(condition.split('score >')[1].trim());
        return gameState.score > targetScore;
      }
      
      if (condition.includes('enemies_defeated >=')) {
        const target = parseInt(condition.split('enemies_defeated >=')[1].trim());
        return gameState.enemiesDefeated >= target;
      }
      
      if (condition.includes('collectibles >=')) {
        const target = parseInt(condition.split('collectibles >=')[1].trim());
        return gameState.collectiblesGathered >= target;
      }
      
      if (condition.includes('player_health <')) {
        const threshold = parseInt(condition.split('player_health <')[1].trim());
        return gameState.playerHealth < threshold;
      }

      // 位置條件
      if (condition.includes('player_at')) {
        const coords = condition.match(/player_at\s*\(([^)]+)\)/);
        if (coords) {
          const [x, y] = coords[1].split(',').map(n => parseFloat(n.trim()));
          const distance = Phaser.Math.Distance.Between(
            gameState.playerX || 0,
            gameState.playerY || 0,
            x, y
          );
          return distance < 50; // 50像素內視為到達
        }
      }

      return false;
    } catch (error) {
      console.error(`[EventTrigger] 條件評估失敗: ${condition}`, error);
      return false;
    }
  }

  /**
   * 觸發事件
   * @param event 事件配置
   */
  private triggerEvent(event: GameEvent): void {
    console.log(`[EventTrigger] 觸發事件: ${event.id} - ${event.description}`);
    
    this.activeEvents.add(event.id);

    // 執行事件邏輯
    switch (event.type) {
      case 'enemy_wave':
        this.handleEnemyWave(event);
        break;
      
      case 'bonus_event':
        this.handleBonusEvent(event);
        break;
      
      case 'cutscene':
        this.handleCutscene(event);
        break;
      
      case 'dialogue':
        this.handleDialogue(event);
        break;
      
      case 'environment_change':
        this.handleEnvironmentChange(event);
        break;
      
      default:
        console.warn(`[EventTrigger] 未知事件類型: ${event.type}`);
    }

    // 觸發註冊的回調函數
    this.executeCallbacks(event.type, event);

    // 如果事件有持續時間，設定結束時間
    if (event.duration) {
      this.scene.time.delayedCall(event.duration * 1000, () => {
        this.endEvent(event);
      });
    }
  }

  /**
   * 處理敵人波次事件
   */
  private handleEnemyWave(event: GameEvent): void {
    if (!event.enemies) return;

    event.enemies.forEach(waveConfig => {
      for (let i = 0; i < waveConfig.count; i++) {
        // 這裡應該調用實體生成器來生成敵人
        // 為了簡化，我們只是記錄日誌
        console.log(`[EventTrigger] 生成敵人: ${waveConfig.type} at ${waveConfig.spawnPoints[i % waveConfig.spawnPoints.length]}`);
      }
    });

    // 顯示警告訊息
    this.showEventMessage(`敵人襲來！${event.description}`);
  }

  /**
   * 處理加分事件
   */
  private handleBonusEvent(event: GameEvent): void {
    console.log(`[EventTrigger] 啟動加分事件: ${event.effect}`);
    
    // 這裡應該設定遊戲狀態修改器
    if (event.effect === 'double_score') {
      this.showEventMessage('雙倍得分時間開始！', 0x00ff00);
    }
  }

  /**
   * 處理過場動畫
   */
  private handleCutscene(event: GameEvent): void {
    console.log(`[EventTrigger] 播放過場動畫: ${event.id}`);
    this.showEventMessage(`過場: ${event.description}`);
  }

  /**
   * 處理對話事件
   */
  private handleDialogue(event: GameEvent): void {
    const dialogueText = event.dialogueText || event.description;
    console.log(`[EventTrigger] 顯示對話: ${dialogueText}`);
    this.showEventMessage(dialogueText, 0x0080ff);
  }

  /**
   * 處理環境變化
   */
  private handleEnvironmentChange(event: GameEvent): void {
    console.log(`[EventTrigger] 環境變化: ${event.description}`);
    this.showEventMessage(`環境變化: ${event.description}`, 0xff8000);
  }

  /**
   * 顯示事件訊息
   */
  private showEventMessage(text: string, color: number = 0xffffff): void {
    // 在螢幕上顯示事件訊息
    const messageText = this.scene.add.text(400, 100, text, {
      fontSize: '24px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      backgroundColor: 'rgba(0,0,0,0.7)',
      padding: { x: 20, y: 10 }
    }).setOrigin(0.5);

    // 3秒後淡出
    this.scene.tweens.add({
      targets: messageText,
      alpha: 0,
      y: messageText.y - 50,
      duration: 3000,
      ease: 'Power2',
      onComplete: () => messageText.destroy()
    });
  }

  /**
   * 結束事件
   */
  private endEvent(event: GameEvent): void {
    console.log(`[EventTrigger] 事件結束: ${event.id}`);
    this.activeEvents.delete(event.id);

    // 結束特定效果
    if (event.type === 'bonus_event' && event.effect === 'double_score') {
      this.showEventMessage('雙倍得分時間結束', 0xff4444);
    }
  }

  /**
   * 註冊事件回調
   */
  addEventListener(eventType: string, callback: LevelEventCallback): void {
    if (!this.eventCallbacks.has(eventType)) {
      this.eventCallbacks.set(eventType, []);
    }
    this.eventCallbacks.get(eventType)!.push(callback);
  }

  /**
   * 移除事件回調
   */
  removeEventListener(eventType: string, callback: LevelEventCallback): void {
    const callbacks = this.eventCallbacks.get(eventType);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * 執行回調函數
   */
  private executeCallbacks(eventType: string, event: GameEvent): void {
    const callbacks = this.eventCallbacks.get(eventType);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(event);
        } catch (error) {
          console.error(`[EventTrigger] 回調執行失敗: ${eventType}`, error);
        }
      });
    }
  }

  /**
   * 手動觸發事件
   */
  manualTrigger(eventId: string): void {
    const event = this.events.get(eventId);
    if (event && !this.activeEvents.has(eventId)) {
      this.triggerEvent(event);
    }
  }

  /**
   * 檢查事件是否已觸發
   */
  isEventActive(eventId: string): boolean {
    return this.activeEvents.has(eventId);
  }

  /**
   * 取得所有作用中的事件
   */
  getActiveEvents(): GameEvent[] {
    return Array.from(this.activeEvents).map(id => this.events.get(id)!).filter(Boolean);
  }

  /**
   * 清除所有事件
   */
  clearAllEvents(): void {
    this.events.clear();
    this.activeEvents.clear();
    this.timeBasedEvents = [];
    this.conditionEvents = [];
    console.log('[EventTrigger] 所有事件已清除');
  }
}
