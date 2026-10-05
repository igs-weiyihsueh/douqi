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
  private roundTimeLimit = 10000; // 10秒
  private roundStartTime = 0;
  private phase: 'intro' | 'playing' | 'revealing' | 'ended' = 'intro';
  
  // 桃樹區域配置 (1920x1080)
  private regions = [
    { x: 480, y: 300, color: 0xff6b6b }, // 左上 - P1 (紅)
    { x: 1440, y: 300, color: 0x4ecdc4 }, // 右上 - P2 (綠) 
    { x: 480, y: 780, color: 0x45b7d1 }, // 左下 - P3 (藍)
    { x: 1440, y: 780, color: 0xf9ca24 }  // 右下 - P4 (黃)
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

    // 背景
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 0, w, h, 0x2d5016, 0.3).setOrigin(0, 0).setDepth(1); // 綠色桃園背景

    // 標題
    this.add.text(w / 2, 50, '🍑 桃樹彩票', {
      fontFamily: 'monospace',
      fontSize: '48px',
      color: '#ff6b6b',
      stroke: '#000',
      strokeThickness: 6
    }).setOrigin(0.5).setDepth(10);

    this.setupUI();
    this.setupPeaches();
    this.setupPlayers();
    
    // 調試日誌
    console.log(`🍑 [桃樹彩票] 初始化完成: ${this.players.length}名玩家, ${this.statusTexts.length}個狀態文字`);
    
    this.startNewRound();
  }

  private setupUI(): void {
    const w = GameConfig.width;
    
    // 回合顯示
    this.roundText = this.add.text(w / 2, 120, '', {
      fontFamily: 'monospace',
      fontSize: '24px', 
      color: '#ffffff',
      backgroundColor: '#2d3748',
      padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setDepth(10);

    // 計時器
    this.timerText = this.add.text(w / 2, 160, '', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: '#f56565',
      stroke: '#000',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(10);

    // 操作說明
    this.add.text(w / 2, 200, 
      'P1: 方向鍵選桃子，空格摘取 | BOT: 自動選擇', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#a0aec0'
    }).setOrigin(0.5).setDepth(10);

    // 玩家狀態顯示區域
    this.statusTexts = [];
    for (let i = 0; i < 4; i++) {
      const statusText = this.add.text(
        this.regions[i].x, 
        this.regions[i].y - 80,
        '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
        backgroundColor: '#2d3748',
        padding: { x: 12, y: 6 }
      }).setOrigin(0.5).setDepth(10);
      this.statusTexts.push(statusText);
    }
  }

  private setupPeaches(): void {
    // 每個區域4顆桃子，2x2排列
    const peachPositions = [
      { dx: -40, dy: -40 }, { dx: 40, dy: -40 },
      { dx: -40, dy: 40 }, { dx: 40, dy: 40 }
    ];

    let peachId = 0;
    for (let regionId = 0; regionId < 4; regionId++) {
      const region = this.regions[regionId];
      
      for (let i = 0; i < 4; i++) {
        const pos = peachPositions[i];
        const peach: Peach = {
          id: peachId++,
          region: regionId,
          x: region.x + pos.dx,
          y: region.y + pos.dy,
          sprite: this.add.image(region.x + pos.dx, region.y + pos.dy, 'heart')
            .setDisplaySize(60, 60)
            .setTint(0xff69b4) // 粉色桃子
            .setDepth(5),
          hasTicket: false, // 稍後隨機分配
          picked: false
        };
        
        this.peaches.push(peach);
      }

      // 區域標示圓圈
      this.add.circle(region.x, region.y, 120, region.color, 0.1)
        .setStrokeStyle(4, region.color, 0.8)
        .setDepth(2);
      
      // 區域標籤
      this.add.text(region.x, region.y - 140, `P${regionId + 1} 區域`, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: `#${region.color.toString(16).padStart(6, '0')}`,
        stroke: '#000',
        strokeThickness: 3
      }).setOrigin(0.5).setDepth(10);
    }
  }

  private setupPlayers(): void {
    for (let i = 0; i < 4; i++) {
      const region = this.regions[i];
      const player: Player = {
        id: i,
        region: i,
        isBot: i > 0, // P1是玩家，P2-P4是BOT
        sprite: this.add.image(region.x, region.y - 50, 'heart')
          .setDisplaySize(40, 40)
          .setTint(region.color)
          .setDepth(8),
        eliminated: false,
        selectedPeach: -1,
        hasTicket: false
      };

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
  }

  private startNewRound(): void {
    if (this.currentRound > this.maxRounds) {
      this.endGame();
      return;
    }

    this.phase = 'playing';
    this.roundStartTime = this.time.now;

    // 重置桃子狀態並隨機分配彩票
    this.resetPeaches();
    this.assignTickets();
    
    // 重置玩家選擇
    this.players.forEach(player => {
      if (!player.eliminated) {
        player.selectedPeach = this.getRandomPeachInRegion(player.region);
        player.hasTicket = false;
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
      // 時間到，沒選擇的玩家淘汰
      this.players.forEach(player => {
        if (!player.eliminated && player.selectedPeach === -1) {
          player.eliminated = true;
        }
      });
      this.revealResults();
      return;
    }

    // 處理P1輸入
    this.handlePlayerInput();
    
    // BOT AI
    this.updateBots();

    // 檢查是否所有活躍玩家都已選擇
    const alivePlayers = this.players.filter(p => !p.eliminated);
    const allSelected = alivePlayers.every(p => p.selectedPeach !== -1);
    if (allSelected) {
      this.revealResults();
    }
  }

  private handlePlayerInput(): void {
    if (this.players.length === 0) return; // 確保players已初始化
    
    const player = this.players[0]; // P1
    if (!player || player.eliminated || !player.keys || !player.actionKey) return;

    const regionPeaches = this.peaches.filter(p => p.region === player.region && !p.picked);
    if (regionPeaches.length === 0) return;

    // 方向鍵選擇桃子
    if (player.keys.left.isDown || player.keys.right.isDown || 
        player.keys.up.isDown || player.keys.down.isDown) {
      
      // 簡化版：循環選擇區域內的桃子
      const currentIndex = regionPeaches.findIndex(p => p.id === player.selectedPeach);
      let nextIndex = currentIndex;
      
      if (player.keys.right.isDown) nextIndex = (currentIndex + 1) % regionPeaches.length;
      if (player.keys.left.isDown) nextIndex = (currentIndex - 1 + regionPeaches.length) % regionPeaches.length;
      
      player.selectedPeach = regionPeaches[nextIndex].id;
    }

    // 空格鍵確認選擇
    if (Phaser.Input.Keyboard.JustDown(player.actionKey)) {
      this.pickPeach(player);
    }
  }

  private updateBots(): void {
    this.players.forEach(player => {
      if (player.eliminated || !player.isBot || player.selectedPeach === -1) return;
      
      // BOT有50%機率在時間過半後自動摘取
      const elapsed = this.time.now - this.roundStartTime;
      if (elapsed > this.roundTimeLimit * 0.5 && Math.random() < 0.02) { // 每frame 2%機率
        this.pickPeach(player);
      }
    });
  }

  private pickPeach(player: Player): void {
    if (player.selectedPeach === -1) return;
    
    const peach = this.peaches.find(p => p.id === player.selectedPeach);
    if (!peach || peach.picked) return;

    peach.picked = true;
    peach.sprite.setAlpha(0.3);
    player.hasTicket = peach.hasTicket;

    // 視覺效果
    if (peach.hasTicket) {
      peach.sprite.setTint(0x00ff00); // 綠色 = 有彩票
      this.add.text(peach.x, peach.y - 30, '🎫', {
        fontSize: '24px'
      }).setDepth(20);
    } else {
      peach.sprite.setTint(0xff0000); // 紅色 = 沒彩票
      this.add.text(peach.x, peach.y - 30, '❌', {
        fontSize: '24px'
      }).setDepth(20);
    }

    player.selectedPeach = -1; // 重置選擇
  }

  private revealResults(): void {
    this.phase = 'revealing';
    
    // 淘汰沒有彩票的玩家
    this.players.forEach(player => {
      if (!player.eliminated && !player.hasTicket) {
        player.eliminated = true;
        player.sprite.setAlpha(0.3);
      }
    });

    // 2秒後開始下一輪
    this.time.delayedCall(2000, () => {
      this.currentRound++;
      this.startNewRound();
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
    this.roundText.setText(`第 ${this.currentRound} 輪 (${alivePlayers.length} 名玩家)`);

    // 更新計時器
    if (this.phase === 'playing') {
      const remaining = Math.max(0, this.roundTimeLimit - (this.time.now - this.roundStartTime));
      const seconds = Math.ceil(remaining / 1000);
      this.timerText.setText(`⏰ ${seconds}秒`);
      
      // 時間緊迫時變紅
      if (seconds <= 3) {
        this.timerText.setColor('#ff0000');
      } else {
        this.timerText.setColor('#f56565');
      }
    } else {
      this.timerText.setText('');
    }

    // 更新玩家狀態 - 添加安全檢查
    this.players.forEach((player, i) => {
      // 確保statusTexts[i]存在
      if (!this.statusTexts[i]) {
        console.warn(`StatusText ${i} not initialized`);
        return;
      }
      
      const statusText = this.statusTexts[i];
      const name = player.id === 0 ? 'P1' : `BOT${player.id}`;
      
      if (player.eliminated) {
        statusText.setText(`${name} - 淘汰`).setColor('#ff6b6b');
      } else if (this.phase === 'playing') {
        const selected = player.selectedPeach !== -1 ? '✓' : '選擇中...';
        statusText.setText(`${name} - ${selected}`).setColor('#4ecdc4');
      } else {
        statusText.setText(`${name} - ${player.hasTicket ? '🎫晉級' : '淘汰'}`);
      }
    });

    // 高亮當前選中的桃子 (僅P1) - 添加安全檢查
    if (this.players.length > 0) {
      const p1 = this.players[0];
      if (p1 && !p1.eliminated && p1.selectedPeach !== -1) {
        const selectedPeach = this.peaches.find(p => p.id === p1.selectedPeach);
        if (selectedPeach && !selectedPeach.picked) {
          // 簡單的高亮效果：稍微放大
          selectedPeach.sprite.setDisplaySize(70, 70);
        }
      }

      // 重置其他桃子大小
      this.peaches.forEach(peach => {
        if (p1 && peach.id !== p1.selectedPeach && !peach.picked) {
          peach.sprite.setDisplaySize(60, 60);
        }
      });
    }
  }
}
