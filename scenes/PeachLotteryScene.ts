import Phaser from 'phaser';
import { GameConfig } from '../config';

/** 桃子狀態 */
interface Peach {
  id: number;
  region: number; // 0-3 對應四個區域
  x: number; y: number;
  sprite: Phaser.GameObjects.Image;
  hasTicket: boolean; // 是否有彩票
  picked: boolean;    // 是否已被摘取
}

/** 玩家狀態 */
interface Player {
  id: number;        // 0=P1, 1-3=BOT
  region: number;    // 分配的區域 (0-3)
  isBot: boolean;
  sprite: Phaser.GameObjects.Image;
  eliminated: boolean;
  selectedPeach: number; // 當前選中的桃子ID
  hasTicket: boolean;    // 本輪是否獲得彩票
  hasConfirmedChoice: boolean; // 是否已確認選擇（P1按空格，BOT自動確認）
  // 控制相關
  keys?: Record<string, Phaser.Input.Keyboard.Key>;
  actionKey?: Phaser.Input.Keyboard.Key;
}

/**
 * 桃樹彩票小遊戲
 * 四名玩家分配四個區域，每區域4顆桃子。每輪10秒內選桃子，有彩票晉級無彩票淘汰。
 * 第2輪開始每輪淘汰一名，最後剩一名獲勝。
 */
export class PeachLotteryScene extends Phaser.Scene {
  private peaches: Peach[] = [];
  private players: Player[] = [];
  private currentRound = 1;
  private maxRounds = 4; // 最多4輪：4→3→2→1
  private roundTimeLimit = 10000; // 精確10秒
  private roundStartTime = 0;
  private phase: 'intro' | 'playing' | 'revealing' | 'ended' = 'intro';
  
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

  constructor() {
    super('PeachLotteryScene');
  }

  create(): void {
    const w = GameConfig.width;
    const h = GameConfig.height;

    console.log('🍑 [桃樹彩票] 開始重構版本初始化...');

    // 🎨 背景 - 使用標準深度
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(this.DEPTHS.BACKGROUND);
    this.add.rectangle(0, 0, w, h, 0x1a4c2b, 0.4).setOrigin(0, 0).setDepth(this.DEPTHS.BACKGROUND + 1);

    this.setupUI();
    this.setupPeaches();
    this.setupPlayers();
    
    console.log(`🍑 [桃樹彩票] 重構版初始化完成: ${this.players.length}名玩家, ${this.statusTexts.length}個狀態文字`);
    
    this.startNewRound();
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
          sprite: this.add.image(region.x + pos.dx, region.y + pos.dy, 'heart')
            .setDisplaySize(60, 60)
            .setTint(0xff1744)
            .setDepth(this.DEPTHS.GAME_OBJECTS),
          hasTicket: false,
          picked: false
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
      const region = this.regions[i];
      const player: Player = {
        id: i,
        region: i,
        isBot: i > 0,
        sprite: this.add.image(region.x, region.y - 40, 'heart')
          .setDisplaySize(35, 35)
          .setTint(region.color)
          .setDepth(this.DEPTHS.GAME_OBJECTS + 1),
        eliminated: false,
        selectedPeach: -1,
        hasTicket: false,
        hasConfirmedChoice: false  // 初始化確認狀態
      };

      // 玩家白色邊框指示器
      this.add.circle(region.x, region.y - 40, 20, 0x000000, 0)
        .setStrokeStyle(2, 0xffffff, 0.9)
        .setDepth(this.DEPTHS.GAME_OBJECTS);

      // P1特別標示 - 移至FOOTER區域
      if (i === 0) {
        const footerY = this.LAYOUT.ZONES.FOOTER.y + 30;
        this.add.text(GameConfig.width / 2, footerY, 
          '👤 你控制左上角紅色區域 | ←→ 選擇桃子，空格摘取', {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#ffffff',
          backgroundColor: '#e53e3e',
          padding: { x: 20, y: 8 },
          stroke: '#000000',
          strokeThickness: 2
        }).setOrigin(0.5).setDepth(this.DEPTHS.GLOBAL_UI);
        
        // P1玩家輕微脈動
        this.tweens.add({
          targets: player.sprite,
          scaleX: { from: 1, to: 1.15 },
          scaleY: { from: 1, to: 1.15 },
          duration: 1000,
          yoyo: true,
          repeat: -1
        });
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
      }

      this.players.push(player);
    }
    
    console.log('👥 [桃樹彩票] 玩家設置完成');
  }

  private startNewRound(): void {
    if (this.currentRound > this.maxRounds) {
      this.endGame();
      return;
    }

    console.log(`🍑 [桃樹彩票] 開始第${this.currentRound}輪`);
    
    this.phase = 'playing';
    this.roundStartTime = this.time.now;

    // 重置桃子狀態並隨機分配彩票
    this.resetPeaches();
    this.assignTickets();
    
    // 重置玩家選擇 - 修復：P1不自動選擇，但需要有初始選中的桃子用於顯示
    this.players.forEach(player => {
      if (!player.eliminated) {
        if (player.isBot) {
          // BOT自動選擇初始桃子
          player.selectedPeach = this.getRandomPeachInRegion(player.region);
        } else {
          // P1玩家有初始選中的桃子，但不算"已選擇"
          player.selectedPeach = this.getRandomPeachInRegion(player.region);
        }
        player.hasTicket = false;
        player.hasConfirmedChoice = false; // 重要：重置確認狀態
      }
    });

    this.updateUI();
  }

  private resetPeaches(): void {
    this.peaches.forEach(peach => {
      if (!peach.picked) {
        peach.sprite.setTint(0xff69b4).setAlpha(1);
        peach.hasTicket = false;
      }
    });
  }

  private assignTickets(): void {
    // 計算需要多少張彩票
    const alivePlayers = this.players.filter(p => !p.eliminated);
    const ticketsNeeded = Math.max(1, alivePlayers.length - 1); // 至少1張，最多比玩家少1

    // 在每個活躍玩家的區域中隨機分配彩票
    const availablePeaches = this.peaches.filter(peach => 
      !peach.picked && alivePlayers.some(p => p.region === peach.region)
    );
    
    // 隨機選擇桃子分配彩票
    const shuffled = [...availablePeaches].sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(ticketsNeeded, shuffled.length); i++) {
      shuffled[i].hasTicket = true;
    }

    console.log(`🎫 第${this.currentRound}輪: ${alivePlayers.length}名玩家, ${ticketsNeeded}張彩票`);
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

    if (this.phase === 'playing') {
      this.updatePlaying();
    }
    this.updateUI();
  }

  private updatePlaying(): void {
    const elapsed = this.time.now - this.roundStartTime;
    const remaining = this.roundTimeLimit - elapsed;

    if (remaining <= 0) {
      // 時間到，沒確認選擇的玩家淘汰
      this.players.forEach(player => {
        if (!player.eliminated && !player.hasConfirmedChoice) {
          player.eliminated = true;
          console.log(`⏰ 玩家${player.id}超時淘汰`);
        }
      });
      this.revealResults();
      return;
    }

    // 處理P1輸入
    this.handlePlayerInput();
    
    // BOT AI - 修改為確認選擇而非自動確認
    this.updateBots();

    // 檢查是否所有活躍玩家都已確認選擇
    const alivePlayers = this.players.filter(p => !p.eliminated);
    const allConfirmed = alivePlayers.every(p => p.hasConfirmedChoice);
    if (allConfirmed) {
      console.log('✅ 所有玩家都已確認選擇，揭曉結果');
      this.revealResults();
    }
  }

  private handlePlayerInput(): void {
    if (this.players.length === 0) return; // 確保players已初始化
    
    const player = this.players[0]; // P1
    if (!player || player.eliminated || !player.keys || !player.actionKey) {
      // 調試信息
      if (!player) console.log('🚨 P1玩家對象不存在');
      else if (player.eliminated) console.log('🚨 P1玩家已被淘汰');
      else if (!player.keys) console.log('🚨 P1鍵盤未初始化');
      else if (!player.actionKey) console.log('🚨 P1動作鍵未初始化');
      return;
    }

    const regionPeaches = this.peaches.filter(p => p.region === player.region && !p.picked);
    if (regionPeaches.length === 0) {
      console.log('🚨 P1區域沒有可用桃子');
      return;
    }

    // 方向鍵選擇桃子 - 基於2x2網格的真實位置
    let moved = false;
    
    if (Phaser.Input.Keyboard.JustDown(player.keys.left) || 
        Phaser.Input.Keyboard.JustDown(player.keys.right) || 
        Phaser.Input.Keyboard.JustDown(player.keys.up) || 
        Phaser.Input.Keyboard.JustDown(player.keys.down)) {
      
      console.log('🎯 檢測到方向鍵輸入');
      
      // 找到當前選中桃子的網格位置
      const currentPeach = regionPeaches.find(p => p.id === player.selectedPeach);
      if (!currentPeach) {
        console.log('🚨 當前選中桃子不存在');
        return;
      }
      
      // 基於桃子的相對位置計算網格座標
      const region = this.regions[player.region];
      const currentGridX = currentPeach.x > region.x ? 1 : 0; // 右側為1，左側為0
      const currentGridY = currentPeach.y > region.y ? 1 : 0; // 下方為1，上方為0
      
      console.log(`🎯 當前網格位置: (${currentGridX}, ${currentGridY})`);
      
      let newGridX = currentGridX;
      let newGridY = currentGridY;
      
      // 根據按鍵調整網格位置
      if (Phaser.Input.Keyboard.JustDown(player.keys.left)) {
        newGridX = Math.max(0, currentGridX - 1);
        moved = true;
        console.log('🎯 按下左鍵');
      }
      if (Phaser.Input.Keyboard.JustDown(player.keys.right)) {
        newGridX = Math.min(1, currentGridX + 1);  
        moved = true;
        console.log('🎯 按下右鍵');
      }
      if (Phaser.Input.Keyboard.JustDown(player.keys.up)) {
        newGridY = Math.max(0, currentGridY - 1);
        moved = true;
        console.log('🎯 按下上鍵');
      }
      if (Phaser.Input.Keyboard.JustDown(player.keys.down)) {
        newGridY = Math.min(1, currentGridY + 1);
        moved = true;
        console.log('🎯 按下下鍵');
      }
      
      // 如果位置有變化，找到對應的桃子
      if (moved && (newGridX !== currentGridX || newGridY !== currentGridY)) {
        const targetPeach = regionPeaches.find(p => {
          const targetGridX = p.x > region.x ? 1 : 0;
          const targetGridY = p.y > region.y ? 1 : 0;
          return targetGridX === newGridX && targetGridY === newGridY;
        });
        
        if (targetPeach) {
          player.selectedPeach = targetPeach.id;
          console.log(`🎯 P1移動到網格位置 (${newGridX}, ${newGridY}), 桃子ID: ${targetPeach.id}`);
        } else {
          console.log(`🚨 找不到目標桃子 (${newGridX}, ${newGridY})`);
        }
      } else if (moved) {
        console.log(`🎯 已在邊界，無法移動到 (${newGridX}, ${newGridY})`);
      }
    }

    // 空格鍵確認選擇
    if (Phaser.Input.Keyboard.JustDown(player.actionKey)) {
      console.log(`🎯 P1確認選擇桃子${player.selectedPeach}`);
      this.confirmChoice(player);
    }
  }

  private updateBots(): void {
    this.players.forEach(player => {
      if (player.eliminated || !player.isBot || player.hasConfirmedChoice) return;
      
      // BOT在時間過半後有機率確認選擇
      const elapsed = this.time.now - this.roundStartTime;
      if (elapsed > this.roundTimeLimit * 0.3 && Math.random() < 0.01) { // 降低自動確認機率
        console.log(`🤖 BOT${player.id}自動確認選擇`);
        this.confirmChoice(player);
      }
    });
  }

  private confirmChoice(player: Player): void {
    if (player.hasConfirmedChoice || player.selectedPeach === -1) return;
    
    player.hasConfirmedChoice = true;
    console.log(`✅ 玩家${player.id}確認選擇桃子${player.selectedPeach}`);
  }

  private pickPeach(player: Player): void {
    if (player.selectedPeach === -1) return;
    
    const peach = this.peaches.find(p => p.id === player.selectedPeach);
    if (!peach || peach.picked) return;

    peach.picked = true;
    peach.sprite.setAlpha(0.5);
    player.hasTicket = peach.hasTicket;

    // 移除選擇指示器
    const selector = peach.sprite.getData('selector');
    if (selector) {
      selector.destroy();
      peach.sprite.setData('selector', null);
    }

    // 創建大型結果顯示
    const resultText = peach.hasTicket ? '🎫 中獎!' : '❌ 沒中';
    const resultColor = peach.hasTicket ? '#00ff00' : '#ff0000';
    
    // 視覺效果 - 更大更明顯
    if (peach.hasTicket) {
      peach.sprite.setTint(0x00ff00).setDisplaySize(100, 100); // 綠色大桃子
      
      // 勝利光芒效果
      const glow = this.add.circle(peach.x, peach.y, 80, 0x00ff00, 0.3)
        .setDepth(30);
      this.tweens.add({
        targets: glow,
        scaleX: { from: 1, to: 2 },
        scaleY: { from: 1, to: 2 },
        alpha: { from: 0.3, to: 0 },
        duration: 1000,
        onComplete: () => glow.destroy()
      });
    } else {
      peach.sprite.setTint(0xff0000).setDisplaySize(100, 100); // 紅色大桃子
      
      // 失敗震動效果
      this.tweens.add({
        targets: peach.sprite,
        x: peach.x - 10,
        duration: 50,
        yoyo: true,
        repeat: 5
      });
    }

    // 大型浮動結果文字
    const floatingText = this.add.text(peach.x, peach.y - 60, resultText, {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: resultColor,
      backgroundColor: '#000000',
      padding: { x: 15, y: 10 },
      stroke: '#ffffff',
      strokeThickness: 3
    }).setOrigin(0.5).setDepth(50);

    // 浮動動畫
    this.tweens.add({
      targets: floatingText,
      y: peach.y - 120,
      alpha: { from: 1, to: 0 },
      duration: 2000,
      onComplete: () => floatingText.destroy()
    });

    player.selectedPeach = -1; // 重置選擇
  }

  private revealResults(): void {
    this.phase = 'revealing';
    
    console.log('🎭 揭曉結果階段開始');
    
    // 先為所有確認選擇的玩家摘取桃子
    this.players.forEach(player => {
      if (!player.eliminated && player.hasConfirmedChoice) {
        this.pickPeach(player);
      }
    });
    
    // 短暫延遲後處理淘汰
    this.time.delayedCall(1500, () => {
      // 淘汰沒有彩票的玩家
      this.players.forEach(player => {
        if (!player.eliminated && !player.hasTicket) {
          player.eliminated = true;
          player.sprite.setAlpha(0.3);
          console.log(`💀 玩家${player.id}被淘汰`);
        }
      });

      // 2秒後開始下一輪
      this.time.delayedCall(2000, () => {
        this.currentRound++;
        this.startNewRound();
      });
    });
  }

  private endGame(): void {
    this.phase = 'ended';
    const winners = this.players.filter(p => !p.eliminated);
    
    if (winners.length === 1) {
      const winner = winners[0];
      const winnerName = winner.id === 0 ? 'P1 (你)' : `BOT${winner.id}`;
      
      this.add.text(GameConfig.width / 2, 400, 
        `🏆 ${winnerName} 獲得大獎！`, {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffd700',
        stroke: '#000',
        strokeThickness: 6
      }).setOrigin(0.5).setDepth(20);
    }

    this.setupEndButtons();
  }

  private setupEndButtons(): void {
    const w = GameConfig.width, h = GameConfig.height;
    
    this.endButtons = [
      { 
        x: w / 2 - 130, y: h * 0.78,
        cb: () => this.scene.restart()
      },
      { 
        x: w / 2 + 130, y: h * 0.78,
        cb: () => this.scene.start('MinigameMenuScene')
      }
    ];

    this.makeEndButton(this.endButtons[0].x, this.endButtons[0].y, '🔄 再玩一次', 0x4a90d9);
    this.makeEndButton(this.endButtons[1].x, this.endButtons[1].y, '← 小遊戲選單', 0x2d3748);
    
    // 鍵盤選擇
    this.endSelected = 0;
    this.endHighlight = this.add.rectangle(
      this.endButtons[0].x, this.endButtons[0].y, 240, 52
    ).setStrokeStyle(3, 0xffe066, 1).setDepth(25);

    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    kb.addKey(KC.LEFT).on('down', () => this.selectEndButton(-1));
    kb.addKey(KC.RIGHT).on('down', () => this.selectEndButton(1));
    kb.addKey(KC.SPACE).on('down', () => this.endButtons[this.endSelected].cb());
    kb.addKey(KC.ENTER).on('down', () => this.endButtons[this.endSelected].cb());
  }

  private makeEndButton(x: number, y: number, text: string, color: number): void {
    const bg = this.add.rectangle(x, y, 240, 48, color, 0.9)
      .setStrokeStyle(2, 0xffffff, 0.8).setDepth(24);
    
    this.add.text(x, y, text, {
      fontFamily: 'monospace', 
      fontSize: '16px', 
      color: '#ffffff'
    }).setOrigin(0.5).setDepth(25);

    const btn = this.add.container(0, 0, [bg]).setSize(240, 48).setDepth(24);
    btn.setInteractive(
      new Phaser.Geom.Rectangle(x - 120, y - 24, 240, 48),
      Phaser.Geom.Rectangle.Contains
    );
    btn.on('pointerover', () => bg.setFillStyle(color + 0x202020, 1));
    btn.on('pointerout', () => bg.setFillStyle(color, 0.9));
    btn.on('pointerdown', () => {
      if (text.includes('再玩')) this.scene.restart();
      else this.scene.start('MinigameMenuScene');
    });
  }

  private selectEndButton(dir: number): void {
    if (this.endButtons.length === 0) return; // 防止空數組錯誤
    
    this.endSelected = (this.endSelected + dir + this.endButtons.length) % this.endButtons.length;
    const btn = this.endButtons[this.endSelected];
    if (this.endHighlight && btn) {
      this.endHighlight.x = btn.x;
      this.endHighlight.y = btn.y;
    }
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
        if (player.hasConfirmedChoice) {
          statusText.setText(`${name}: ✅已確認`).setColor('#00ff00');
        } else {
          statusText.setText(`${name}: 🎯選擇中`).setColor('#ffd700');
        }
      } else {
        const result = player.hasTicket ? '🎫晉級' : '❌淘汰';
        statusText.setText(`${name}: ${result}`)
          .setColor(player.hasTicket ? '#4ecdc4' : '#ff6b6b');
      }
    });

    // 選擇指示器 - 重新實現更清晰的反饋
    if (this.players.length > 0) {
      const p1 = this.players[0];
      if (p1 && !p1.eliminated && p1.selectedPeach !== -1) {
        const selectedPeach = this.peaches.find(p => p.id === p1.selectedPeach);
        if (selectedPeach && !selectedPeach.picked) {
          // 黃色高亮選中的桃子
          selectedPeach.sprite.setDisplaySize(75, 75).setTint(0xffff00);
          
          // 創建選擇指示器
          if (!selectedPeach.sprite.getData('selector')) {
            const selector = this.add.circle(selectedPeach.x, selectedPeach.y, 45, 0x000000, 0)
              .setStrokeStyle(4, 0xffff00, 1)
              .setDepth(this.DEPTHS.EFFECTS);
            
            this.tweens.add({
              targets: selector,
              scaleX: { from: 1, to: 1.2 },
              scaleY: { from: 1, to: 1.2 },
              duration: 800,
              yoyo: true,
              repeat: -1
            });
            
            selectedPeach.sprite.setData('selector', selector);
          }
        }
      }

      // 重置其他桃子
      this.peaches.forEach(peach => {
        if (p1 && peach.id !== p1.selectedPeach && !peach.picked) {
          peach.sprite.setDisplaySize(60, 60).setTint(0xff1744);
          
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
