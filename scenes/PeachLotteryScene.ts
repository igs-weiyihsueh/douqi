import Phaser from 'phaser';
import { GameConfig } from '../config';

/** 桃子狀態 */
interface Peach {
  id: number;
  region: number; // 0-3 對應四個區域
  x: number; y: number;
  sprite: Phaser.GameObjects.Image;
  rewardType: 'none' | 'small' | 'big'; // 獎勵類型：沒獎、小獎、大獎
  picked: boolean;    // 是否已被摘取
  isSelected: boolean; // 是否被玩家選定（點擊一次）
  isLocked: boolean;   // 桃子是否被鎖定
}

/** 玩家狀態 */
interface Player {
  id: number;        // 0=P1, 1-3=BOT
  region: number;    // 分配的區域 (0-3)
  isBot: boolean;
  sprite: Phaser.GameObjects.Image;
  eliminated: boolean;
  selectedPeach: number; // 當前選中的桃子ID
  rewardType: 'none' | 'small' | 'big'; // 本輪獲得的獎勵類型
  hasSelected: boolean;  // 是否已經選定桃子（點擊確認）
  // 控制相關
  keys?: Record<string, Phaser.Input.Keyboard.Key>;
  actionKey?: Phaser.Input.Keyboard.Key;
}

/**
 * 桃樹彩票小遊戲 - 新獎勵機制
 * 四名玩家分配四個區域，每區域4顆桃子。每輪10秒內選擇一顆桃子點擊確認。
 * 
 * 獎勵機制：
 * - 第1輪：只有小獎，所有人晉級（體驗輪）
 * - 第2輪起：三種結果 - 沒獎(淘汰)、小獎(晉級)、大獎(直接獲勝)
 * - 大獎：從第2輪才出現，必定只開出一個，獲得者直接獲勝
 * - 沒獎：從第2輪才出現，必定只開出一個，獲得者被淘汰
 * - 小獎：其餘都是小獎，可以晉級到下一輪
 * - 如果沒人抽到大獎，小獎者全部晉級
 */
export class PeachLotteryScene extends Phaser.Scene {
  private peaches: Peach[] = [];
  private players: Player[] = [];
  private currentRound = 1;
  private maxRounds = 4; // 最多4輪：4→3→2→1
  private roundTimeLimit = 10000; // 精確10秒
  private roundStartTime = 0;
  private phase: 'intro' | 'playing' | 'revealing' | 'ended' = 'intro';
  private running = false; // 控制遊戲邏輯是否運行
  
  // 🔧 診斷系統引用
  private keyboardCheckEvent?: Phaser.Time.TimerEvent;
  
  // 🎨 標準化布局系統
  private readonly LAYOUT = {
    ZONES: {
      HEADER: { y: 20, height: 80 },      // 標題區
      INFO: { y: 100, height: 60 },       // 回合/計時器
      GAME: { y: 180, height: 740 },      // 主遊戲區
      FOOTER: { y: 920, height: 160 }     // 結束按鈕區
    },
    MARGINS: { left: 60, right: 60, top: 20, bottom: 20 },
    PADDING: { small: 10, medium: 20, large: 30 }
  };

  // 🎨 統一深度層級系統
  private readonly DEPTHS = {
    BACKGROUND: -10,
    GAME_AREA: 0,        // 區域圓圈
    GAME_OBJECTS: 10,    // 桃子
    GAME_UI: 20,         // 區域狀態文字
    GLOBAL_UI: 30,       // 全局UI(計時器等)
    EFFECTS: 40,         // 選擇特效
    OVERLAY: 50          // 結束界面
  };

  // 🌳 重新設計的區域配置
  private regions = [
    { x: 400, y: 360, color: 0xff6b6b },   // P1左上 (紅)
    { x: 1520, y: 360, color: 0x4ecdc4 },  // P2右上 (綠) 
    { x: 400, y: 720, color: 0x45b7d1 },   // P3左下 (藍)
    { x: 1520, y: 720, color: 0xf9ca24 }   // P4右下 (黃)
  ];

  // UI元素
  private timerText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private statusTexts: Phaser.GameObjects.Text[] = [];
  
  // 結果顯示
  private endButtons: Array<{ x: number; y: number; cb: () => void }> = [];
  private endSelected = 0;
  private endHighlight?: Phaser.GameObjects.Rectangle;
  private introLayer?: Phaser.GameObjects.Container; // 說明浮層

  constructor() {
    super('PeachLotteryScene');
  }

  create(): void {
    const w = GameConfig.width;
    const h = GameConfig.height;

    console.log('🍑 [桃樹彩票] 開始重構版本初始化...');
    
    // 🔧 完整狀態重置 - 修復scene.restart()後狀態混亂問題
    this.peaches = [];
    this.players = [];
    this.currentRound = 1;
    this.roundStartTime = 0;
    this.phase = 'intro';
    this.running = false;
    this.statusTexts = [];
    this.endButtons = [];
    this.endSelected = 0;
    this.endHighlight = undefined;
    this.introLayer = undefined;
    this.keyboardCheckEvent = undefined;
    
    // 🔧 註冊清理事件
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.keyboardCheckEvent) {
        this.keyboardCheckEvent.destroy();
        this.keyboardCheckEvent = undefined;
      }
    });

    // 🎨 背景 - 使用標準深度
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(this.DEPTHS.BACKGROUND);
    this.add.rectangle(0, 0, w, h, 0x1a4c2b, 0.4).setOrigin(0, 0).setDepth(this.DEPTHS.BACKGROUND + 1);

    this.setupUI();
    this.setupPeaches();
    this.setupPlayers();
    
    console.log(`🍑 [桃樹彩票] 重構版初始化完成: ${this.players.length}名玩家, ${this.statusTexts.length}個狀態文字`);
    
    // 🔄 修復生命週期：先顯示說明，不立即開始遊戲
    this.phase = 'intro';
    this.running = false;
    this.showIntro();
  }

  private setupUI(): void {
    const w = GameConfig.width;
    
    // 🎨 HEADER區域 - 僅主標題
    const headerCenter = { x: w / 2, y: this.LAYOUT.ZONES.HEADER.y + 40 };
    this.add.text(headerCenter.x, headerCenter.y, '🍑 桃樹彩票', {
      fontFamily: 'monospace',
      fontSize: '42px',
      color: '#ff4757',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(this.DEPTHS.GLOBAL_UI);

    // 🎨 INFO區域 - 回合信息和計時器並排
    const infoCenter = { x: w / 2, y: this.LAYOUT.ZONES.INFO.y + 30 };
    
    // 回合顯示 - 左側
    this.roundText = this.add.text(infoCenter.x - 200, infoCenter.y, '', {
      fontFamily: 'monospace',
      fontSize: '20px', 
      color: '#ffffff',
      backgroundColor: '#4a5568',
      padding: { x: 15, y: 8 },
      stroke: '#000000',
      strokeThickness: 1
    }).setOrigin(0.5).setDepth(this.DEPTHS.GLOBAL_UI);

    // 計時器 - 右側
    this.timerText = this.add.text(infoCenter.x + 200, infoCenter.y, '', {
      fontFamily: 'monospace',
      fontSize: '28px',
      color: '#ffffff',
      backgroundColor: '#e53e3e',
      padding: { x: 20, y: 10 },
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(this.DEPTHS.GLOBAL_UI);

    // 🎨 初始化狀態文字數組 - 將在setupPeaches中創建
    this.statusTexts = [];
  }

  private setupPeaches(): void {
    // 🌳 桃子在區域內的相對位置 (2x2排列)
    const peachPositions = [
      { dx: -40, dy: -40 }, { dx: 40, dy: -40 },
      { dx: -40, dy: 40 }, { dx: 40, dy: 40 }
    ];

    let peachId = 0;
    for (let regionId = 0; regionId < 4; regionId++) {
      const region = this.regions[regionId];
      
      // 🎨 區域背景圓圈 - 使用標準深度
      const regionCircle = this.add.circle(region.x, region.y, 120, region.color, 0.12)
        .setStrokeStyle(4, region.color, 0.8)
        .setDepth(this.DEPTHS.GAME_AREA);
        
      // 區域輕微脈動效果
      this.tweens.add({
        targets: regionCircle,
        scaleX: { from: 1, to: 1.03 },
        scaleY: { from: 1, to: 1.03 },
        duration: 1200,
        yoyo: true,
        repeat: -1
      });
      
      // 🍑 創建桃子
      for (let i = 0; i < 4; i++) {
        const pos = peachPositions[i];
        const peach: Peach = {
          id: peachId++,
          region: regionId,
          x: region.x + pos.dx,
          y: region.y + pos.dy,
          sprite: this.add.image(region.x + pos.dx, region.y + pos.dy, 'peach')
            .setDisplaySize(60, 60)
            .setDepth(this.DEPTHS.GAME_OBJECTS),
          rewardType: 'small',  // 初始化為小獎
          picked: false,
          isSelected: false,    // 初始化選定狀態
          isLocked: false       // 初始化鎖定狀態
        };
        
        // 桃子白色邊框
        this.add.circle(peach.x, peach.y, 32, 0x000000, 0)
          .setStrokeStyle(2, 0xffffff, 0.8)
          .setDepth(this.DEPTHS.GAME_OBJECTS - 1);
        
        this.peaches.push(peach);
      }
      
      // 🎨 區域標籤 - 放在區域上方安全位置
      this.add.text(region.x, region.y - 160, `P${regionId + 1} 區域`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: `#${region.color.toString(16).padStart(6, '0')}`,
        padding: { x: 12, y: 6 },
        stroke: '#000000',
        strokeThickness: 2
      }).setOrigin(0.5).setDepth(this.DEPTHS.GAME_UI);

      // 🎨 狀態文字 - 放在區域標籤上方
      const statusText = this.add.text(
        region.x, 
        region.y - 190,  // 區域標籤上方30px
        '', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        backgroundColor: '#2d3748',
        padding: { x: 10, y: 5 },
        stroke: '#000000',
        strokeThickness: 1
      }).setOrigin(0.5).setDepth(this.DEPTHS.GAME_UI);
      this.statusTexts.push(statusText);
    }

    console.log('🌳 [桃樹彩票] 遊戲區域重構完成');
  }

  private setupPlayers(): void {
    for (let i = 0; i < 4; i++) {
      const player: Player = {
        id: i,
        region: i,
        isBot: i > 0,
        sprite: this.add.image(0, 0, 'peach').setVisible(false), // 創建但隱藏，保持接口兼容性
        eliminated: false,
        selectedPeach: -1,
        rewardType: 'small',   // 初始化獎勵類型
        hasSelected: false     // 初始化選定狀態
      };

      // P1特別標示 - 移至FOOTER區域
      if (i === 0) {
        const footerY = this.LAYOUT.ZONES.FOOTER.y + 30;
        this.add.text(GameConfig.width / 2, footerY, 
          '👤 你控制左上角紅色區域 | ←→ 選擇桃子，空格確認選擇', {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#ffffff',
          backgroundColor: '#e53e3e',
          padding: { x: 20, y: 8 },
          stroke: '#000000',
          strokeThickness: 2
        }).setOrigin(0.5).setDepth(this.DEPTHS.GLOBAL_UI);
      }

      // P1控制設置
      if (i === 0) {
        const KC = Phaser.Input.Keyboard.KeyCodes;
        const kb = this.input.keyboard!;
        
        player.keys = {
          left: kb.addKey(KC.LEFT),
          right: kb.addKey(KC.RIGHT),
          up: kb.addKey(KC.UP),
          down: kb.addKey(KC.DOWN)
        };
        player.actionKey = kb.addKey(KC.SPACE);
        
        // 添加統一的空格鍵處理
        player.actionKey.on('down', () => this.onSpace());
      }

      this.players.push(player);
    }
    
    console.log('👥 [桃樹彩票] 玩家設置完成');
  }

  // ── 顯示遊戲說明浮層 ──
  private showIntro(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const cont = this.add.container(0, 0).setDepth(60); // 比所有遊戲元素都高
    cont.add(this.add.rectangle(0, 0, w, h, 0x05070c, 0.85).setOrigin(0, 0));
    const panel = this.add.rectangle(w / 2, h / 2, 720, 480, 0x121a2e, 0.98).setStrokeStyle(4, 0xff6b6b, 0.9);
    cont.add(panel);

    // 標題
    cont.add(this.add.text(w / 2, h / 2 - 190, '🍑 桃樹彩票', {
      fontFamily: 'monospace', fontSize: '42px', color: '#ff4757', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 6
    }).setOrigin(0.5));

    // 遊戲規則
    const rules = [
      '⭐ 4名玩家分配到4個區域，每區域有4顆桃子',
      '⭐ 每輪10秒內選擇一顆桃子並點擊確認(空格鍵)',
      '⭐ 第1輪：只有小獎，所有人晉級（體驗輪）',
      '⭐ 第2輪起：三種結果 - 沒獎(淘汰)、小獎(晉級)、大獎(獲勝)',
      '⭐ 大獎只有1個且直接獲勝，沒獎只有1個且被淘汰',
      '',
      '🎮 操作方式：',
      '   ←→↑↓ 方向鍵：選擇桃子 (2x2網格)',
      '   空格鍵：確認選擇當前桃子',
      '',
      '🔧 鍵盤測試：按任意方向鍵測試...'
    ];
    
    cont.add(this.add.text(w / 2, h / 2 - 40, rules.join('\n'), {
      fontFamily: 'monospace', fontSize: '16px', color: '#e2e8f0', 
      align: 'left', lineSpacing: 8
    }).setOrigin(0.5));

    // 開始提示
    const startHint = this.add.text(w / 2, h / 2 + 170, '按【空白鍵】開始遊戲！', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffe66d', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3
    }).setOrigin(0.5);
    cont.add(startHint);

    // 鍵盤測試文本
    const testText = this.add.text(w / 2, h / 2 + 200, '鍵盤狀態: 等待輸入...', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffd700'
    }).setOrigin(0.5);
    cont.add(testText);

    // 添加鍵盤測試邏輯
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    const testKeys = {
      left: kb.addKey(KC.LEFT),
      right: kb.addKey(KC.RIGHT),
      up: kb.addKey(KC.UP),
      down: kb.addKey(KC.DOWN)
    };

    const checkKeys = () => {
      // 🔧 安全檢查：確保文本對象還存在
      if (!testText || !testText.active || testText.scene === null) {
        console.log('🚨 testText已被銷毀，停止鍵盤檢查');
        return;
      }
      
      try {
        const pressed = [];
        if (testKeys.left.isDown) pressed.push('LEFT');
        if (testKeys.right.isDown) pressed.push('RIGHT');
        if (testKeys.up.isDown) pressed.push('UP');
        if (testKeys.down.isDown) pressed.push('DOWN');
        
        if (pressed.length > 0) {
          testText.setText(`鍵盤狀態: ${pressed.join('+')} 被按下`);
        } else {
          testText.setText('鍵盤狀態: 等待輸入...');
        }
      } catch (error) {
        console.log('🚨 setText錯誤:', error);
        // 停止這個檢查循環
        if (this.keyboardCheckEvent) {
          this.keyboardCheckEvent.destroy();
          this.keyboardCheckEvent = undefined;
        }
      }
    };

    // 添加定時檢查，並保存引用以便清理
    this.keyboardCheckEvent = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: checkKeys
    });
    
    // 開始提示閃爍效果
    this.tweens.add({ 
      targets: startHint, 
      alpha: 0.4, 
      duration: 700, 
      yoyo: true, 
      repeat: -1 
    });

    // 點擊任意處開始
    panel.setInteractive(new Phaser.Geom.Rectangle(-360, -240, 720, 480), Phaser.Geom.Rectangle.Contains);
    cont.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    cont.on('pointerdown', () => this.startPlaying());
    
    this.introLayer = cont;
    
    // 顯示最大輪次數
    this.timerText.setText('準備中...');
  }

  // ── 開始遊戲 ──
  private startPlaying(): void {
    if (this.phase !== 'intro') return;
    
    console.log('🎮 [桃樹彩票] 遊戲開始！');
    
    this.phase = 'playing';
    
    // 🔧 清理診斷系統定時器
    if (this.keyboardCheckEvent) {
      this.keyboardCheckEvent.destroy();
      this.keyboardCheckEvent = undefined;
    }
    
    if (this.introLayer) { 
      this.introLayer.destroy(); 
      this.introLayer = undefined; 
    }
    
    this.running = true;
    this.startNewRound();
  }

  // ── 空格鍵處理 ──
  private onSpace(): void {
    if (this.phase === 'intro') { 
      this.startPlaying(); 
      return; 
    }
    if (this.phase === 'playing' && this.running) {
      const player = this.players[0];
      if (player && !player.eliminated && !player.hasSelected) {
        this.selectPeachForPlayer(player);
      }
    }
  }

  private startNewRound(): void {
    if (this.currentRound > this.maxRounds) {
      this.endGame();
      return;
    }

    console.log(`🍑 [桃樹彩票] 開始第${this.currentRound}輪`);
    
    this.phase = 'playing';
    this.running = true;        // 🚨 關鍵修復：啟動遊戲邏輯
    this.roundStartTime = this.time.now;

    console.log(`🔧 DEBUG: 第${this.currentRound}輪開始 - phase=${this.phase}, running=${this.running}`);

    // 重置桃子狀態並隨機分配彩票
    this.resetPeaches();
    this.assignRewards();
    
    // 重置玩家選擇 - 修復：P1不自動選擇，但需要有初始選中的桃子用於顯示
    this.players.forEach(player => {
      if (!player.eliminated) {
        if (player.isBot) {
          // BOT自動選擇初始桃子
          player.selectedPeach = this.getRandomPeachInRegion(player.region);
        } else {
          // P1玩家有初始選中的桃子，但不算"已選擇"
          player.selectedPeach = this.getRandomPeachInRegion(player.region);
          console.log(`🔧 DEBUG: P1初始選中桃子${player.selectedPeach}`);
        }
        player.rewardType = 'small';   // 重置獎勵類型
        player.hasSelected = false;    // 重置選定狀態
        console.log(`🔧 DEBUG: 玩家${player.id} - selectedPeach=${player.selectedPeach}, hasSelected=${player.hasSelected}`);
      }
    });

    this.updateUI();
    
    // 🔧 修復「再玩一次」後選擇框消失 - 延遲更新確保所有狀態就緒
    this.time.delayedCall(100, () => {
      this.updateUI();
    });
  }

  private resetPeaches(): void {
    this.peaches.forEach(peach => {
      if (!peach.picked) {
        // 只重置未開過的桃子
        peach.sprite.clearTint().setAlpha(1).setDisplaySize(60, 60);
        peach.rewardType = 'small';
        peach.isSelected = false;
        peach.isLocked = false;
        
        // 清理選定標記
        const selectedMark = peach.sprite.getData('selectedMark');
        if (selectedMark) {
          selectedMark.destroy();
          peach.sprite.setData('selectedMark', null);
        }
        
        // 移除選擇指示器
        const selector = peach.sprite.getData('selector');
        if (selector) {
          selector.destroy();
          peach.sprite.setData('selector', null);
        }
      } else {
        // 已開過的桃子保持暗淡顯示，表示不可再用
        peach.sprite.setAlpha(0.3).setTint(0x666666); // 灰色暗淡
        peach.isSelected = false; // 重置選定狀態
        peach.isLocked = true;    // 鎖定不可選
        console.log(`🔒 桃子${peach.id}已使用過，不可重複選擇`);
      }
    });
  }

  private assignRewards(): void {
    const alivePlayers = this.players.filter(p => !p.eliminated);
    
    if (this.currentRound === 1) {
      // 第一輪：只有小獎，所有人晉級
      console.log(`🏆 第1輪特別模式: 所有${alivePlayers.length}名玩家都獲得小獎（體驗輪）`);
      
      // 為每個玩家區域設置小獎
      alivePlayers.forEach(player => {
        const regionPeaches = this.peaches.filter(peach => 
          peach.region === player.region && !peach.picked
        );
        if (regionPeaches.length > 0) {
          // 為該區域的所有桃子設置小獎
          regionPeaches.forEach(peach => {
            peach.rewardType = 'small';
          });
          console.log(`🏅 為玩家${player.id}區域設置小獎`);
        }
      });
    } else {
      // 第二輪起：三種獎勵機制
      console.log(`🏆 第${this.currentRound}輪: ${alivePlayers.length}名玩家，設置獎勵...`);
      
      // 重置所有桃子為小獎
      this.peaches.forEach(peach => {
        if (!peach.picked) {
          peach.rewardType = 'small';
        }
      });
      
      // 獲取所有活躍玩家的可用桃子
      const availablePeaches = this.peaches.filter(peach => 
        !peach.picked && alivePlayers.some(p => p.region === peach.region)
      );
      
      if (availablePeaches.length >= 2) {
        // 隨機選擇桃子分配特殊獎勵
        const shuffled = [...availablePeaches].sort(() => Math.random() - 0.5);
        
        // 設置1個大獎（直接獲勝）
        shuffled[0].rewardType = 'big';
        console.log(`🏆 桃子${shuffled[0].id}設為大獎`);
        
        // 設置1個沒獎（淘汰）
        shuffled[1].rewardType = 'none';
        console.log(`💀 桃子${shuffled[1].id}設為沒獎`);
        
        // 其餘都是小獎（晉級）
        console.log(`🏅 其他${shuffled.length - 2}個桃子為小獎`);
      }
    }
  }

  private getRandomPeachInRegion(regionId: number): number {
    const regionPeaches = this.peaches.filter(p => p.region === regionId && !p.picked);
    if (regionPeaches.length === 0) return -1;
    return regionPeaches[Math.floor(Math.random() * regionPeaches.length)].id;
  }

  update(): void {
    // 確保所有初始化完成
    if (!this.roundText || !this.timerText || this.statusTexts.length === 0 || this.players.length === 0) {
      return;
    }

    // 使用running控制遊戲邏輯
    if (this.phase === 'playing' && this.running) {
      this.updatePlaying();
      // 🚨 關鍵修復：確保每幀更新UI以顯示時間倒數
      this.updateUI();
    }
  }

  private updatePlaying(): void {
    const elapsed = this.time.now - this.roundStartTime;
    const remaining = this.roundTimeLimit - elapsed;

    // 調試日志：每2秒打印一次狀態
    if (Math.floor(elapsed / 2000) !== Math.floor((elapsed - 16.67) / 2000)) {
      console.log(`🔧 DEBUG: 第${this.currentRound}輪 - 剩餘時間: ${(remaining/1000).toFixed(1)}s, running=${this.running}, phase=${this.phase}`);
    }

    if (remaining <= 0) {
      // 時間到的處理：為未選定的玩家自動選定桃子
      if (this.currentRound === 1) {
        console.log('⏰ 第1輪時間到 - 為未選定的玩家自動選定桃子');
      } else {
        console.log('⏰ 時間到 - 為未選定的玩家自動選定桃子');
      }
      
      // 為未選定的玩家自動選定一個桃子
      this.players.forEach(player => {
        if (!player.eliminated && !player.hasSelected) {
          this.autoSelectPeachForPlayer(player);
          console.log(`🍑 自動為玩家${player.id}選定桃子`);
        }
      });
      
      this.beginReveal();
      return;
    }

    // 處理P1輸入
    this.handlePlayerInput();
    
    // BOT AI
    this.updateBots();

    // 檢查是否所有活躍玩家都已選定桃子
    const alivePlayers = this.players.filter(p => !p.eliminated);
    const allSelected = alivePlayers.every(p => p.hasSelected);
    if (allSelected) {
      console.log('✅ 所有玩家都已選定桃子，揭曉結果');
      this.beginReveal();
    }
  }

  private handlePlayerInput(): void {
    if (!this.running || this.players.length === 0) {
      return;
    }

    const player = this.players[0]; // P1
    if (!player || player.eliminated || !player.keys || !player.actionKey) {
      return;
    }

    // 如果已經選定桃子，禁止移動選擇
    if (player.hasSelected) {
      return;
    }

    // 獲取可選擇的桃子（未鎖定、未摘取、在玩家區域內）
    const regionPeaches = this.peaches.filter(p => 
      p.region === player.region && !p.picked && !p.isLocked
    );
    if (regionPeaches.length === 0) {
      return;
    }

    // 確保P1有選中的桃子，且該桃子可選擇
    if (player.selectedPeach === -1 || !this.canSelectPeach(player, player.selectedPeach)) {
      // 選擇第一個可用的桃子
      const availablePeach = regionPeaches.find(p => this.canSelectPeach(player, p.id));
      if (availablePeach) {
        player.selectedPeach = availablePeach.id;
        this.updateUI(); // 狀態變化時更新UI
      }
    }

    // 簡化的方向鍵邏輯：左右循環選擇
    let moved = false;
    const currentIndex = regionPeaches.findIndex(p => p.id === player.selectedPeach);
    let newIndex = currentIndex;

    if (Phaser.Input.Keyboard.JustDown(player.keys.left)) {
      newIndex = (currentIndex - 1 + regionPeaches.length) % regionPeaches.length;
      moved = true;
    }
    if (Phaser.Input.Keyboard.JustDown(player.keys.right)) {
      newIndex = (currentIndex + 1) % regionPeaches.length;
      moved = true;
    }
    if (Phaser.Input.Keyboard.JustDown(player.keys.up)) {
      newIndex = (currentIndex - 2 + regionPeaches.length) % regionPeaches.length;
      moved = true;
    }
    if (Phaser.Input.Keyboard.JustDown(player.keys.down)) {
      newIndex = (currentIndex + 2) % regionPeaches.length;
      moved = true;
    }

    if (moved && newIndex !== currentIndex) {
      const targetPeach = regionPeaches[newIndex];
      if (this.canSelectPeach(player, targetPeach.id)) {
        player.selectedPeach = targetPeach.id;
        this.updateUI(); // 狀態變化時更新UI
      }
    }
  }

  private updateBots(): void {
    this.players.forEach(player => {
      if (player.eliminated || !player.isBot || player.hasSelected) return;
      
      // BOT在時間過1/4後開始選定桃子，速度更快
      const elapsed = this.time.now - this.roundStartTime;
      if (elapsed > this.roundTimeLimit * 0.25) {
        // 提高AI選擇速度，讓遊戲更流暢
        const p1Eliminated = this.players[0]?.eliminated || false;
        const selectChance = p1Eliminated ? 0.15 : 0.08; // 大幅提高選擇機率
        
        // BOT模擬選定行為
        if (Math.random() < selectChance) {
          this.selectPeachForPlayer(player);
        }
      }
    });
  }

  // ── 選定桃子機制（新）──
  private selectPeachForPlayer(player: Player): void {
    if (player.selectedPeach === -1 || player.hasSelected) return;
    
    const peach = this.peaches.find(p => p.id === player.selectedPeach);
    if (!peach || peach.picked || peach.isLocked) return;
    
    // 標記桃子為已選定
    peach.isSelected = true;
    player.hasSelected = true;
    
    console.log(`✅ 玩家${player.id}選定桃子${peach.id}`);
    
    // 視覺反饋：選定的桃子加上特殊效果
    peach.sprite.setTint(0xffff00); // 黃色表示選定
    peach.sprite.setDisplaySize(70, 70); // 稍微放大
    
    // 添加選定標記
    const selectedMark = this.add.text(peach.x, peach.y - 40, '✓ 已選定', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#ffff00',
      backgroundColor: '#000000',
      padding: { x: 6, y: 3 },
    }).setOrigin(0.5).setDepth(40);
    
    peach.sprite.setData('selectedMark', selectedMark);
    
    this.updateUI(); // 更新UI顯示狀態變化
  }

  // ── 為玩家自動選定桃子（超時時使用）──
  private autoSelectPeachForPlayer(player: Player): void {
    // 獲取玩家區域內可用的桃子
    const availablePeaches = this.peaches.filter(p => 
      p.region === player.region && !p.picked && !p.isLocked
    );
    
    if (availablePeaches.length === 0) return;
    
    // 選擇一個桃子（優先選擇已選中的，或第一個可用的）
    let targetPeach = availablePeaches.find(p => p.id === player.selectedPeach);
    if (!targetPeach) {
      targetPeach = availablePeaches[0];
      player.selectedPeach = targetPeach.id;
    }
    
    // 選定桃子
    this.selectPeachForPlayer(player);
  }

  // ── 選擇機制優化：只允許選擇未鎖定的桃子 ──
  private canSelectPeach(player: Player, peachId: number): boolean {
    if (player.hasSelected) return false; // 已經選定桃子，不能再選擇
    
    const peach = this.peaches.find(p => p.id === peachId);
    if (!peach) return false;
    
    return !peach.isLocked && !peach.picked && peach.region === player.region;
  }

  // ── 開始結果揭曉階段 ──
  private beginReveal(): void {
    console.log('🎭 開始結果揭曉階段');
    
    this.phase = 'revealing';
    this.running = false; // 停止遊戲邏輯更新
    
    // 為所有已選定的玩家揭曉獎勵
    this.players.forEach(player => {
      if (!player.eliminated && player.hasSelected) {
        this.revealPeachForPlayer(player);
      }
    });
    
    // 短暫延遲後處理結果
    this.time.delayedCall(3000, () => {
      this.processResults();
    });
  }

  // ── 為玩家揭曉桃子獎勵 ──
  private revealPeachForPlayer(player: Player): void {
    if (player.selectedPeach === -1) return;
    
    const peach = this.peaches.find(p => p.id === player.selectedPeach);
    if (!peach) return;

    // 標記桃子為已摘取
    peach.picked = true;
    player.rewardType = peach.rewardType;

    // 移除選定標記
    const selectedMark = peach.sprite.getData('selectedMark');
    if (selectedMark) {
      selectedMark.destroy();
      peach.sprite.setData('selectedMark', null);
    }

    // 根據獎勵類型設置不同的視覺效果
    let resultText: string;
    let resultColor: string;
    let tintColor: number;
    
    switch (peach.rewardType) {
      case 'big':
        resultText = '🏆 大獎！直接獲勝！';
        resultColor = '#ffd700';  // 金色
        tintColor = 0xffd700;
        break;
      case 'small':
        resultText = '🏅 小獎！晉級下一輪！';
        resultColor = '#00ff00';  // 綠色
        tintColor = 0x00ff00;
        break;
      case 'none':
        resultText = '💀 沒獎！被淘汰！';
        resultColor = '#ff0000';  // 紅色
        tintColor = 0xff0000;
        break;
    }

    // 視覺效果
    peach.sprite.setTint(tintColor).setDisplaySize(80, 80);
    
    // 光芒效果
    const glow = this.add.circle(peach.x, peach.y, 60, tintColor, 0.3)
      .setDepth(30);
    this.tweens.add({
      targets: glow,
      scaleX: { from: 1, to: 2 },
      scaleY: { from: 1, to: 2 },
      alpha: { from: 0.3, to: 0 },
      duration: 1500,
      onComplete: () => glow.destroy()
    });

    // 結果文字
    const floatingText = this.add.text(peach.x, peach.y - 80, resultText, {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: resultColor,
      backgroundColor: '#000000',
      padding: { x: 12, y: 8 },
      stroke: '#ffffff',
      strokeThickness: 2
    }).setOrigin(0.5).setDepth(50);

    // 浮動動畫
    this.tweens.add({
      targets: floatingText,
      y: peach.y - 140,
      alpha: { from: 1, to: 0 },
      duration: 2800,
      ease: 'Power2.easeOut',
      onComplete: () => floatingText.destroy()
    });

    console.log(`🎊 玩家${player.id}揭曉桃子${peach.id}: ${peach.rewardType}`);
    
    // 標記桃子為已使用，後續輪次不可再選
    this.time.delayedCall(2000, () => {
      // 延遲標記，讓結果展示完成
      const usedMark = this.add.text(peach.x, peach.y + 40, '✗ 已使用', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#666666',
        backgroundColor: '#000000',
        padding: { x: 6, y: 3 }
      }).setOrigin(0.5).setDepth(25).setAlpha(0.8);
      
      peach.sprite.setData('usedMark', usedMark);
      console.log(`🔒 桃子${peach.id}標記為已使用，後續輪次不可選擇`);
    });
  }

  // ── 處理獎勵結果 ──
  private processResults(): void {
    console.log('🏆 處理獎勵結果');
    
    const alivePlayers = this.players.filter(p => !p.eliminated);
    
    // 檢查是否有人獲得大獎
    const bigWinner = alivePlayers.find(p => p.rewardType === 'big');
    if (bigWinner) {
      // 有人獲得大獎，直接獲勝
      console.log(`🏆 玩家${bigWinner.id}獲得大獎，直接獲勝！`);
      this.time.delayedCall(1500, () => {
        this.endGame();
      });
      return;
    }
    
    // 沒有大獎，處理正常淘汰邏輯
    if (this.currentRound === 1) {
      // 第一輪：所有人晉級
      console.log('🎊 第1輪結束 - 所有人晉級！（體驗輪）');
    } else {
      // 第二輪起：淘汰獲得沒獎的玩家
      alivePlayers.forEach(player => {
        if (player.rewardType === 'none') {
          player.eliminated = true;
          player.sprite.setAlpha(0.3);
          console.log(`💀 玩家${player.id}獲得沒獎，被淘汰`);
        }
      });
    }

    // 檢查遊戲是否結束
    const remainingPlayers = this.players.filter(p => !p.eliminated);
    
    if (remainingPlayers.length <= 1 || this.currentRound >= this.maxRounds) {
      // 遊戲結束
      this.time.delayedCall(1500, () => {
        this.endGame();
      });
    } else {
      // 下一輪
      this.time.delayedCall(1500, () => {
        this.currentRound++;
        this.startNewRound();
      });
    }
  }

  private endGame(): void {
    console.log('🏆 遊戲結束');
    
    this.phase = 'ended';
    this.running = false;
    
    const w = GameConfig.width, h = GameConfig.height;
    
    // 添加半透明背景
    this.add.rectangle(0, 0, w, h, 0x000000, 0.75).setOrigin(0, 0).setDepth(this.DEPTHS.OVERLAY);
    
    // 找出獲勝者
    const alivePlayers = this.players.filter(p => !p.eliminated);
    
    let resultTitle: string;
    let resultColor: string;
    
    if (alivePlayers.length === 1) {
      const winner = alivePlayers[0];
      const winnerName = winner.id === 0 ? '你' : `BOT${winner.id}`;
      resultTitle = `🏆 ${winnerName} 獲勝！`;
      resultColor = winner.id === 0 ? '#00ff00' : '#4ecdc4';
    } else if (alivePlayers.length > 1) {
      resultTitle = `🤝 ${alivePlayers.length}名玩家平手！`;
      resultColor = '#ffd700';
    } else {
      resultTitle = '💀 全軍覆沒！';
      resultColor = '#ff6b6b';
    }
    
    // 結果標題
    this.add.text(w / 2, h * 0.25, resultTitle, {
      fontFamily: 'monospace',
      fontSize: '42px',
      color: resultColor,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(this.DEPTHS.OVERLAY + 1);
    
    // 遊戲統計
    const stats = [
      `完成輪數: ${this.currentRound - 1}/${this.maxRounds}`,
      `存活玩家: ${alivePlayers.length}/4`
    ];
    
    this.add.text(w / 2, h * 0.4, stats.join('\n'), {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffffff',
      align: 'center',
      lineSpacing: 8
    }).setOrigin(0.5).setDepth(this.DEPTHS.OVERLAY + 1);
    
    this.setupEndButtons();
  }

  private setupEndButtons(): void {
    const w = GameConfig.width, h = GameConfig.height;
    
    this.endButtons = [];
    this.endSelected = 0;
    this.makeEndButton(w / 2 - 140, h * 0.7, '🔄 再玩一次', 0x4a90d9, () => this.scene.restart());
    this.makeEndButton(w / 2 + 140, h * 0.7, '← 小遊戲選單', 0x2d3748, () => this.quitToMenu());
    
    // 選中高亮框
    this.endHighlight = this.add.rectangle(0, 0, 240, 65)
      .setStrokeStyle(4, 0xffe066, 1)
      .setDepth(this.DEPTHS.OVERLAY + 2);
    this.tweens.add({ 
      targets: this.endHighlight, 
      alpha: { from: 1, to: 0.4 }, 
      duration: 600, 
      yoyo: true, 
      repeat: -1 
    });
    this.selectEndButton(0);
    
    // 鍵盤控制
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    const toggle = () => this.selectEndButton(this.endSelected === 0 ? 1 : 0);
    kb.addKey(KC.LEFT).on('down', () => this.selectEndButton(0));
    kb.addKey(KC.RIGHT).on('down', () => this.selectEndButton(1));
    kb.addKey(KC.UP).on('down', toggle);
    kb.addKey(KC.DOWN).on('down', toggle);
    
    const confirm = () => { 
      const btn = this.endButtons[this.endSelected]; 
      if (btn) btn.cb(); 
    };
    kb.addKey(KC.SPACE).on('down', confirm);
    kb.addKey(KC.ENTER).on('down', confirm);
  }

  private makeEndButton(x: number, y: number, text: string, color: number, cb: () => void): void {
    const bg = this.add.rectangle(x, y, 240, 60, color, 0.95)
      .setStrokeStyle(2, 0xffffff, 0.8)
      .setDepth(this.DEPTHS.OVERLAY + 1);
    
    this.add.text(x, y, text, {
      fontFamily: 'monospace', 
      fontSize: '18px', 
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5).setDepth(this.DEPTHS.OVERLAY + 2);

    const btn = this.add.container(0, 0, [bg]).setSize(240, 60)
      .setDepth(this.DEPTHS.OVERLAY + 1);
    btn.setInteractive(
      new Phaser.Geom.Rectangle(x - 120, y - 30, 240, 60),
      Phaser.Geom.Rectangle.Contains
    );
    
    const idx = this.endButtons.length;
    btn.on('pointerover', () => { 
      bg.setFillStyle(color, 1); 
      this.selectEndButton(idx); 
    });
    btn.on('pointerdown', cb);
    
    this.endButtons.push({ x, y, cb });
  }

  private selectEndButton(index: number): void {
    this.endSelected = index;
    const btn = this.endButtons[index];
    if (btn && this.endHighlight) { 
      this.endHighlight.setPosition(btn.x, btn.y); 
    }
  }

  private quitToMenu(): void {
    this.scene.start('MinigameMenuScene');
  }

  private updateUI(): void {
    // 更新回合信息
    const alivePlayers = this.players.filter(p => !p.eliminated);
    this.roundText.setText(`第${this.currentRound}輪 (${alivePlayers.length}名)`);

    // 更新計時器 - 修正計算邏輯
    if (this.phase === 'playing') {
      const remaining = Math.max(0, this.roundTimeLimit - (this.time.now - this.roundStartTime));
      const seconds = Math.ceil(remaining / 1000); // 使用Math.ceil，確保準確倒數
      this.timerText.setText(`⏰ ${Math.max(0, seconds)}秒`);
      
      // 時間緊迫時的視覺警告
      if (seconds <= 3) {
        this.timerText.setBackgroundColor('#ff0000');
        this.timerText.setAlpha(seconds % 2 === 0 ? 1 : 0.6);
      } else if (seconds <= 5) {
        this.timerText.setBackgroundColor('#ff6b47');
        this.timerText.setAlpha(1);
      } else {
        this.timerText.setBackgroundColor('#e53e3e');
        this.timerText.setAlpha(1);
      }
    } else {
      this.timerText.setText('準備中...');
      this.timerText.setBackgroundColor('#4a5568');
      this.timerText.setAlpha(1);
    }

    // 更新玩家狀態 - 顯示確認狀態
    this.players.forEach((player, i) => {
      if (!this.statusTexts[i]) return;
      
      const statusText = this.statusTexts[i];
      const name = player.id === 0 ? 'P1' : `B${player.id}`;
      
      if (player.eliminated) {
        statusText.setText(`${name}: ❌淘汰`).setColor('#ff6b6b');
      } else if (this.phase === 'playing') {
        if (player.hasSelected) {
          statusText.setText(`${name}: ✅已選定`).setColor('#00ff00');
        } else {
          statusText.setText(`${name}: 🎯選擇中`).setColor('#ffd700');
        }
      } else {
        // 顯示獎勵結果
        let result: string;
        let color: string;
        switch (player.rewardType) {
          case 'big':
            result = '🏆大獎';
            color = '#ffd700';
            break;
          case 'small':
            result = '🏅晉級';
            color = '#4ecdc4';
            break;
          case 'none':
            result = '❌淘汰';
            color = '#ff6b6b';
            break;
        }
        statusText.setText(`${name}: ${result}`).setColor(color);
      }
    });

    // 選擇指示器 - 重新實現更清晰的反饋
    if (this.players.length > 0) {
      const p1 = this.players[0];
      
      if (p1 && !p1.eliminated && p1.selectedPeach !== -1) {
        const selectedPeach = this.peaches.find(p => p.id === p1.selectedPeach);
        
        if (selectedPeach && !selectedPeach.picked) {
          // 選中的桃子：放大顯示，但保持原色
          selectedPeach.sprite.setDisplaySize(75, 75).clearTint();
          
          // 🔧 強制重新創建選擇指示器，避免重新開始後的狀態問題
          const existingSelector = selectedPeach.sprite.getData('selector');
          if (existingSelector) {
            existingSelector.destroy();
            selectedPeach.sprite.setData('selector', null);
          }
          
          // 創建新的選擇指示器（更明顯的黃色圓圈）
          const selector = this.add.circle(selectedPeach.x, selectedPeach.y, 45, 0x000000, 0)
            .setStrokeStyle(5, 0xffd700, 1)
            .setDepth(this.DEPTHS.EFFECTS);
          
          this.tweens.add({
            targets: selector,
            scaleX: { from: 1, to: 1.3 },
            scaleY: { from: 1, to: 1.3 },
            duration: 700,
            yoyo: true,
            repeat: -1
          });
          
          selectedPeach.sprite.setData('selector', selector);
        }
      }

      // 重置其他桃子
      this.peaches.forEach(peach => {
        if (p1 && peach.id !== p1.selectedPeach && !peach.picked) {
          peach.sprite.setDisplaySize(60, 60).clearTint();
          
          const selector = peach.sprite.getData('selector');
          if (selector) {
            selector.destroy();
            peach.sprite.setData('selector', null);
          }
        }
      });
    }
  }
}
