import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * TitleScene（v16）：進入遊戲的第一個畫面。
 * 顯示標題「鬥氣割草」+ 開始按鈕 + 操作說明。
 * 按下「開始」（點擊按鈕 / 任意鍵 / 空白鍵）才 scene.start('GameScene') + launch('UIScene')，
 * 此時 GameScene 才真正開打並開始生怪（在此之前不生怪）。
 */
export class TitleScene extends Phaser.Scene {
  private started = false;
  /** v47：目前用鍵盤選中的模式 + 黃框物件 + 兩鈕 x 座標 */
  private selected: 'fast' | 'slow' = 'fast';
  private highlightRect?: Phaser.GameObjects.Rectangle;
  private hlPos: { fast: number; slow: number } = { fast: 0, slow: 0 };

  // 邊界編輯器狀態
  private borderEditorActive = false;
  private borderEditorPanel?: Phaser.GameObjects.Container;
  private borderPreview?: Phaser.GameObjects.Graphics;
  private borderSliders: Array<{
    name: string; value: number; min: number; max: number; step: number;
    slider: Phaser.GameObjects.Rectangle; handle: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text; valueText: Phaser.GameObjects.Text;
  }> = [];
  private selectedBorderSlider = 0;

  // zoom編輯器狀態
  private zoomEditorActive = false;
  private zoomEditorPanel?: Phaser.GameObjects.Container;
  private zoomSliders: Array<{
    name: string; value: number; min: number; max: number; step: number;
    slider: Phaser.GameObjects.Rectangle; handle: Phaser.GameObjects.Rectangle;
    label: Phaser.GameObjects.Text; valueText: Phaser.GameObjects.Text;
  }> = [];
  private selectedZoomSlider = 0;

  constructor() {
    super('TitleScene');
  }

  /** v47：切換選取的模式——移動黃框到該鈕。 */
  private selectMode(mode: 'fast' | 'slow'): void {
    this.selected = mode;
    if (this.highlightRect) this.highlightRect.x = this.hlPos[mode];
  }

  create(): void {
    this.started = false;
    const w = GameConfig.width;
    const h = GameConfig.height;

    // 背景（沿用地板貼圖鋪滿 + 半透明暗底，讓文字清楚）
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 0, w, h, 0x0a0c14, 0.55).setOrigin(0, 0).setDepth(1);

    // 標題
    this.add
      .text(w / 2, h * 0.22, '鬥氣割草', {
        fontFamily: 'monospace',
        fontSize: '72px',
        color: '#ffe66d',
        stroke: '#000000',
        strokeThickness: 8
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.add
      .text(w / 2, h * 0.32, 'Douqi Cutgrass — 一鍵割草 MVP', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#cbd5e1',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(5);

    // v46：兩個模式按鈕並排——「快速模式」「慢速模式」
    // v47：兩個模式按鈕 + 鍵盤選擇（方向鍵切換、選中黃框、空白鍵確認）。滑鼠點擊仍保留。
    const btnW = 240;
    const btnH = 66;
    const btnY = h * 0.5;
    const gap = 40;
    const cxFast = w / 2 - (btnW / 2 + gap / 2);
    const cxSlow = w / 2 + (btnW / 2 + gap / 2);
    // 黃色選中外框（罩在選中的鈕上）
    const highlight = this.add
      .rectangle(cxFast, btnY, btnW + 16, btnH + 16)
      .setStrokeStyle(5, 0xffe066, 1)
      .setDepth(7);
    const makeBtn = (cx: number, label: string, sub: string, color: number, hover: number, mode: 'fast' | 'slow'): void => {
      const bg = this.add
        .rectangle(cx, btnY, btnW, btnH, color, 0.92)
        .setStrokeStyle(4, 0xffffff, 0.9)
        .setDepth(5);
      this.add
        .text(cx, btnY - 9, label, { fontFamily: 'monospace', fontSize: '26px', color: '#ffffff', fontStyle: 'bold' })
        .setOrigin(0.5).setDepth(6);
      this.add
        .text(cx, btnY + 16, sub, { fontFamily: 'monospace', fontSize: '12px', color: '#ffffff' })
        .setOrigin(0.5).setDepth(6);
      const btn = this.add.container(0, 0, [bg]).setSize(btnW, btnH).setDepth(5);
      btn.setInteractive(
        new Phaser.Geom.Rectangle(cx - btnW / 2, btnY - btnH / 2, btnW, btnH),
        Phaser.Geom.Rectangle.Contains
      );
      // 滑鼠移入=同步選取(黃框跟過來)；點擊=確認
      btn.on('pointerover', () => { bg.setFillStyle(hover, 0.98); this.selectMode(mode); });
      btn.on('pointerout', () => bg.setFillStyle(color, 0.92));
      btn.on('pointerdown', () => this.startGame(mode));
    };
    makeBtn(cxFast, '快速模式', '滑鼠瞄準·衝刺', 0xff5a6e, 0xff7a8b, 'fast');
    makeBtn(cxSlow, '慢速模式', '鍵盤八方向·範圍鎖定', 0x4a90d9, 0x63a8ec, 'slow');
    // 選取狀態 + 黃框移動 + 脈動
    this.selected = 'fast';
    this.highlightRect = highlight;
    this.hlPos = { fast: cxFast, slow: cxSlow };
    this.selectMode('fast');
    this.tweens.add({ targets: highlight, alpha: { from: 1, to: 0.4 }, duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // 方向鍵切換選擇（左右/上下都可）
    const kb = this.input.keyboard!;
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const toFast = () => this.selectMode('fast');
    const toSlow = () => this.selectMode('slow');
    const toggle = () => this.selectMode(this.selected === 'fast' ? 'slow' : 'fast');
    kb.addKey(KC.LEFT).on('down', toFast);
    kb.addKey(KC.A).on('down', toFast);
    kb.addKey(KC.RIGHT).on('down', toSlow);
    kb.addKey(KC.D).on('down', toSlow);
    kb.addKey(KC.UP).on('down', toggle);
    kb.addKey(KC.DOWN).on('down', toggle);
    kb.addKey(KC.W).on('down', toggle);
    kb.addKey(KC.S).on('down', toggle);

    // 操作說明（v44：更新為最新玩法，分兩欄精簡呈現）
    const helpLeft = [
      '▍操作',
      '滑鼠瞄準：指向敵人／道具即鎖定',
      '　指空地→朝該方向走位',
      '　滑鼠靜止按攻擊→自動鎖最近怪',
      '攻擊(空白鍵／點擊)：衝向鎖定目標',
      '　可鎖道具衝過去撿(道具略優先)',
      '▍連段(依等級解鎖)',
      '連續命中→圓形斬Lv2／直線氣波Lv4',
      '／範圍爆發Lv6／滿連段→限時強化',
      '撿道具放招：旋風／落雷／居合',
      '　　　　　　震爆／時停／補血'
    ];
    const helpRight = [
      '▍關卡（10 關循環）',
      '第3/5/7關＝事件關',
      '第10關＝BOSS 王，打倒通關',
      '塔防：打掉持續放招的塔',
      '守護：保護 NPC 別被怪打死',
      '佔領：站據點圈內清空怪推進度(限時)',
      '▍其他',
      'B：加 BOT 夥伴（最多 4）',
      'R：P1 原地復活',
      'T：重新開始一局'
    ];
    const helpStyle = {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#e2e8f0',
      align: 'left' as const,
      lineSpacing: 4,
      stroke: '#000000',
      strokeThickness: 2
    };
    this.add
      .text(w * 0.5 - 24, h * 0.60, helpLeft.join('\n'), helpStyle)
      .setOrigin(1, 0)
      .setDepth(5);
    this.add
      .text(w * 0.5 + 24, h * 0.60, helpRight.join('\n'), helpStyle)
      .setOrigin(0, 0)
      .setDepth(5);

    // 提示：選擇模式
    const hint = this.add
      .text(w / 2, h * 0.585, '（← → 選擇模式，空白鍵確認；也可用滑鼠點擊）', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#94a3b8'
      })
      .setOrigin(0.5)
      .setDepth(5);
    this.tweens.add({ targets: hint, alpha: 0.3, duration: 700, yoyo: true, repeat: -1 });

    // v47：空白鍵 = 確認【目前選中(黃框)】的模式進入
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).once('down', () => this.startGame(this.selected));

    // ── 開發入口：Spine 場景編輯器（開發/美術團隊用工具，在遊戲中以全螢幕 iframe 開啟）──
    // 角落按鈕 + 快捷鍵 E。不擋原本模式選擇/開始流程。
    const edBtnW = 200, edBtnH = 44;
    const edX = w - edBtnW / 2 - 20, edY = h - edBtnH / 2 - 20; // 右下角
    const edBg = this.add
      .rectangle(edX, edY, edBtnW, edBtnH, 0x2d3748, 0.9)
      .setStrokeStyle(2, 0x9f7aea, 0.9)
      .setDepth(5);
    this.add
      .text(edX, edY, '🎨 場景編輯器 (E)', { fontFamily: 'monospace', fontSize: '16px', color: '#e9d8fd', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(6);
    const edBtn = this.add.container(0, 0, [edBg]).setSize(edBtnW, edBtnH).setDepth(5);
    edBtn.setInteractive(
      new Phaser.Geom.Rectangle(edX - edBtnW / 2, edY - edBtnH / 2, edBtnW, edBtnH),
      Phaser.Geom.Rectangle.Contains
    );
    edBtn.on('pointerover', () => edBg.setFillStyle(0x4a5568, 0.95));
    edBtn.on('pointerout', () => edBg.setFillStyle(0x2d3748, 0.9));
    edBtn.on('pointerdown', () => this.openSceneEditor());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E).on('down', () => this.openSceneEditor());

    // ── 藍色邊界調整編輯器：🔧 邊界設定 (B) → 開啟邊界長寬比調整編輯器 ──
    const borderBtnW = 200, borderBtnH = 44;
    const borderX = w - borderBtnW / 2 - 20, borderY = h - borderBtnH / 2 - 80; // 場景編輯器按鈕上方
    const borderBg = this.add
      .rectangle(borderX, borderY, borderBtnW, borderBtnH, 0x1e3a8a, 0.9)
      .setStrokeStyle(2, 0x3b82f6, 0.9)
      .setDepth(5);
    this.add
      .text(borderX, borderY, '🔧 邊界設定 (B)', { fontFamily: 'monospace', fontSize: '16px', color: '#dbeafe', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(6);
    const borderBtn = this.add.container(0, 0, [borderBg]).setSize(borderBtnW, borderBtnH).setDepth(5);
    borderBtn.setInteractive(
      new Phaser.Geom.Rectangle(borderX - borderBtnW / 2, borderY - borderBtnH / 2, borderBtnW, borderBtnH),
      Phaser.Geom.Rectangle.Contains
    );
    borderBtn.on('pointerover', () => borderBg.setFillStyle(0x1d4ed8, 0.95));
    borderBtn.on('pointerout', () => borderBg.setFillStyle(0x1e3a8a, 0.9));
    borderBtn.on('pointerdown', () => this.openBorderEditor());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B).on('down', () => this.openBorderEditor());

    // ── 相機zoom調整編輯器：🔍 Zoom設定 (Z) → 開啟相機縮放級別調整編輯器 ──
    const zoomBtnW = 200, zoomBtnH = 44;
    const zoomX = w - zoomBtnW / 2 - 20, zoomY = h - zoomBtnH / 2 - 130; // 邊界編輯器按鈕上方
    const zoomBg = this.add
      .rectangle(zoomX, zoomY, zoomBtnW, zoomBtnH, 0x064e3b, 0.9)
      .setStrokeStyle(2, 0x10b981, 0.9)
      .setDepth(5);
    this.add
      .text(zoomX, zoomY, '🔍 Zoom設定 (Z)', { fontFamily: 'monospace', fontSize: '16px', color: '#d1fae5', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(6);
    const zoomBtn = this.add.container(0, 0, [zoomBg]).setSize(zoomBtnW, zoomBtnH).setDepth(5);
    zoomBtn.setInteractive(
      new Phaser.Geom.Rectangle(zoomX - zoomBtnW / 2, zoomY - zoomBtnH / 2, zoomBtnW, zoomBtnH),
      Phaser.Geom.Rectangle.Contains
    );
    zoomBtn.on('pointerover', () => zoomBg.setFillStyle(0x047857, 0.95));
    zoomBtn.on('pointerout', () => zoomBg.setFillStyle(0x064e3b, 0.9));
    zoomBtn.on('pointerdown', () => this.openZoomEditor());
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Z).on('down', () => this.openZoomEditor());

    // ── 小遊戲入口：🎮 小遊戲 (G) → MinigameMenuScene（與 fast/slow 開始戰鬥並列，互不干擾）──
    const mgBtnW = 200, mgBtnH = 44;
    const mgX = mgBtnW / 2 + 20, mgY = h - mgBtnH / 2 - 20; // 左下角
    const mgBg = this.add
      .rectangle(mgX, mgY, mgBtnW, mgBtnH, 0x14532d, 0.9)
      .setStrokeStyle(2, 0x4ade80, 0.9)
      .setDepth(5);
    this.add
      .text(mgX, mgY, '🎮 小遊戲 (G)', { fontFamily: 'monospace', fontSize: '16px', color: '#bbf7d0', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(6);
    const mgBtn = this.add.container(0, 0, [mgBg]).setSize(mgBtnW, mgBtnH).setDepth(5);
    mgBtn.setInteractive(
      new Phaser.Geom.Rectangle(mgX - mgBtnW / 2, mgY - mgBtnH / 2, mgBtnW, mgBtnH),
      Phaser.Geom.Rectangle.Contains
    );
    mgBtn.on('pointerover', () => mgBg.setFillStyle(0x1d6b3c, 0.95));
    mgBtn.on('pointerout', () => mgBg.setFillStyle(0x14532d, 0.9));
    mgBtn.on('pointerdown', () => this.scene.start('MinigameMenuScene'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G).on('down', () => this.scene.start('MinigameMenuScene'));
  }

  /**
   * 在遊戲中打開 Spine 場景編輯器：全螢幕 overlay iframe 蓋在遊戲畫面上層，載入 public/editor/scene_editor.html。
   * 編輯器本身完全不改、在 iframe 內隔離運作(自帶 DOM/canvas/spine-webgl，不與 Phaser 衝突)。
   * 右上角關閉鈕(×) + Esc 鍵可關閉、移除 iframe、回到 TitleScene。開啟時暫停本場景(關閉時恢復)。
   */
  private openSceneEditor(): void {
    if (document.getElementById('scene-editor-overlay')) return; // 已開啟不重複
    // base: './' → 用 import.meta.env.BASE_URL 組相對路徑，dev/build 都正確
    const base = (import.meta as unknown as { env: { BASE_URL: string } }).env.BASE_URL || '/';
    const src = base.replace(/\/$/, '') + '/editor/scene_editor.html';

    const overlay = document.createElement('div');
    overlay.id = 'scene-editor-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99999;background:#1a1a1a;';

    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;border:0;display:block;';
    iframe.title = 'Spine 場景編輯器';
    overlay.appendChild(iframe);

    // 關閉鈕：放【左上角】(編輯器面板在右側320px、右上角會壓到面板標題+警告列)→移左上角 canvas 舞台空白區，不擋面板任何 UI
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕ 關閉編輯器 (Esc)';
    closeBtn.style.cssText =
      'position:absolute;top:12px;left:12px;z-index:100000;padding:8px 16px;' +
      'background:#e53e3e;color:#fff;border:2px solid #fff;border-radius:6px;' +
      'font:bold 15px monospace;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);';
    const close = (): void => this.closeSceneEditor();
    closeBtn.addEventListener('click', close);
    overlay.appendChild(closeBtn);

    // Esc 關閉(掛在 window，關閉時移除)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    (overlay as unknown as { __onKey: (e: KeyboardEvent) => void }).__onKey = onKey;

    document.body.appendChild(overlay);
    // 暫停本場景(編輯器全螢幕蓋住；關閉時恢復)
    this.scene.pause();
  }

  /** 關閉場景編輯器 overlay，移除 iframe/事件，恢復 TitleScene。 */
  private closeSceneEditor(): void {
    const overlay = document.getElementById('scene-editor-overlay');
    if (!overlay) return;
    const onKey = (overlay as unknown as { __onKey?: (e: KeyboardEvent) => void }).__onKey;
    if (onKey) window.removeEventListener('keydown', onKey);
    overlay.remove();
    this.scene.resume();
  }

  private startGame(mode: 'fast' | 'slow' = 'fast'): void {
    if (this.started) return; // 防重入（同時點擊+按鍵）
    this.started = true;
    
    // 恢復預設zoom（主菜單預覽不影響遊戲）
    this.cameras.main.setZoom(1.0);
    
    this.scene.start('GameScene', { controlMode: mode });
    this.scene.launch('UIScene');
  }

  /** 
   * 開啟藍色邊界調整編輯器：專門調整遊戲中藍色邊界線的長寬比
   * 實時預覽邊界變化，支援鍵盤和滑鼠操作
   */
  private openBorderEditor(): void {
    if (this.borderEditorActive || this.started) return;
    
    console.log('🔧 開啟邊界調整編輯器');
    this.borderEditorActive = true;
    this.selectedBorderSlider = 0;
    
    this.createBorderEditorPanel();
    this.createBorderPreview();
    this.setupBorderEditorControls();
  }

  /** 創建邊界編輯器面板 */
  private createBorderEditorPanel(): void {
    const width = 600;
    const height = 450;
    const x = GameConfig.width / 2;
    const y = GameConfig.height / 2;
    
    // 主容器
    this.borderEditorPanel = this.add.container(x, y).setDepth(100);
    
    // 背景
    const background = this.add.rectangle(0, 0, width, height, 0x1a202c, 0.95)
      .setStrokeStyle(3, 0x3b82f6, 0.8);
    this.borderEditorPanel.add(background);
    
    // 標題
    const title = this.add.text(0, -height/2 + 30, '🔧 藍色邊界線長寬比調整', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#3b82f6',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    this.borderEditorPanel.add(title);
    
    // 說明文字
    const description = this.add.text(0, -height/2 + 70, '調整藍色邊界的尺寸和位置，實時預覽效果', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#94a3b8'
    }).setOrigin(0.5);
    this.borderEditorPanel.add(description);
    
    // 創建滑條
    this.createBorderSliders();
    
    // 按鈕區域
    const buttonY = height/2 - 60;
    
    // 保存按鈕
    const saveBtn = this.add.rectangle(-80, buttonY, 120, 35, 0x10b981, 0.9)
      .setStrokeStyle(2, 0x34d399);
    const saveText = this.add.text(-80, buttonY, '保存設定', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    
    // 取消按鈕
    const cancelBtn = this.add.rectangle(80, buttonY, 120, 35, 0xdc2626, 0.9)
      .setStrokeStyle(2, 0xef4444);
    const cancelText = this.add.text(80, buttonY, '取消', {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    
    this.borderEditorPanel.add([saveBtn, saveText, cancelBtn, cancelText]);
    
    // 按鈕交互
    const saveBtnContainer = this.add.container(0, 0, [saveBtn]).setSize(120, 35);
    saveBtnContainer.setInteractive(new Phaser.Geom.Rectangle(-60, -17.5, 120, 35), Phaser.Geom.Rectangle.Contains);
    saveBtnContainer.on('pointerdown', () => this.saveBorderSettings());
    
    const cancelBtnContainer = this.add.container(0, 0, [cancelBtn]).setSize(120, 35);
    cancelBtnContainer.setInteractive(new Phaser.Geom.Rectangle(-60, -17.5, 120, 35), Phaser.Geom.Rectangle.Contains);
    cancelBtnContainer.on('pointerdown', () => this.closeBorderEditor());
    
    // 操作提示
    const instructions = this.add.text(0, height/2 - 20, '↑↓ 選擇參數  ←→ 調整數值  Enter 保存  Esc 取消', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#64748b'
    }).setOrigin(0.5);
    this.borderEditorPanel.add(instructions);
  }

  /** 創建邊界參數滑條 */
  private createBorderSliders(): void {
    const currentArenaW = this.levelMode ? GameConfig.stage.arenaW : (GameConfig.width - GameConfig.arena.padding * 2);
    const currentArenaH = this.levelMode ? GameConfig.stage.arenaH : (GameConfig.height - GameConfig.arena.padding * 2);
    const currentX = this.levelMode ? GameConfig.stage.sceneMargin : GameConfig.arena.padding;
    const currentY = this.levelMode ? GameConfig.stage.sceneMargin : GameConfig.arena.padding;
    
    const parameters = [
      { name: '邊界寬度', value: currentArenaW, min: 800, max: 1800, step: 20 },
      { name: '邊界高度', value: currentArenaH, min: 400, max: 1000, step: 20 },
      { name: '邊界X位置', value: currentX, min: 50, max: 500, step: 10 },
      { name: '邊界Y位置', value: currentY, min: 50, max: 300, step: 10 }
    ];
    
    this.borderSliders = [];
    const startY = -120;
    const spacing = 70;
    
    parameters.forEach((param, index) => {
      const y = startY + index * spacing;
      
      // 參數標籤
      const label = this.add.text(-250, y, param.name, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0, 0.5);
      
      // 滑條背景
      const sliderBg = this.add.rectangle(-50, y, 200, 20, 0x374151, 0.8)
        .setStrokeStyle(2, 0x4b5563);
      
      // 滑條手柄
      const progress = (param.value - param.min) / (param.max - param.min);
      const handleX = -50 + (progress - 0.5) * 200;
      const handle = this.add.rectangle(handleX, y, 16, 24, 0x3b82f6, 1)
        .setStrokeStyle(2, 0x1d4ed8);
      
      // 數值顯示
      const valueText = this.add.text(170, y, param.value.toString(), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#34d399',
        fontStyle: 'bold'
      }).setOrigin(0, 0.5);
      
      // 調整按鈕
      const decreaseBtn = this.add.text(200, y, '－', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ef4444',
        fontStyle: 'bold'
      }).setOrigin(0.5);
      
      const increaseBtn = this.add.text(230, y, '＋', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#10b981',
        fontStyle: 'bold'
      }).setOrigin(0.5);
      
      this.borderEditorPanel!.add([label, sliderBg, handle, valueText, decreaseBtn, increaseBtn]);
      
      // 添加滑鼠交互
      this.setupSliderInteractions(index, sliderBg, handle, decreaseBtn, increaseBtn, param);
      
      this.borderSliders.push({
        name: param.name,
        value: param.value,
        min: param.min,
        max: param.max,
        step: param.step,
        slider: sliderBg,
        handle: handle,
        label: label,
        valueText: valueText
      });
    });
    
    this.updateBorderSliderHighlight();
  }

  /** 設置滑條滑鼠交互 */
  private setupSliderInteractions(index: number, sliderBg: Phaser.GameObjects.Rectangle, handle: Phaser.GameObjects.Rectangle, decreaseBtn: Phaser.GameObjects.Text, increaseBtn: Phaser.GameObjects.Text, param: any): void {
    // 滑條點擊和拖拽
    sliderBg.setInteractive();
    sliderBg.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.selectedBorderSlider = index;
      this.updateBorderSliderHighlight();
      
      const localX = pointer.x - (this.borderEditorPanel!.x - 50);
      const progress = Phaser.Math.Clamp((localX + 100) / 200, 0, 1);
      const newValue = Math.round((param.min + progress * (param.max - param.min)) / param.step) * param.step;
      
      this.setBorderSliderValue(index, newValue);
    });
    
    // 手柄拖拽
    handle.setInteractive({ draggable: true });
    handle.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number) => {
      const clampedX = Phaser.Math.Clamp(dragX, -150, 50);
      handle.x = clampedX;
      
      const progress = (clampedX + 150) / 200;
      const newValue = Math.round((param.min + progress * (param.max - param.min)) / param.step) * param.step;
      
      this.setBorderSliderValue(index, newValue);
    });
    
    // 減少按鈕
    decreaseBtn.setInteractive();
    decreaseBtn.on('pointerdown', () => {
      this.selectedBorderSlider = index;
      this.updateBorderSliderHighlight();
      this.adjustBorderSlider(index, -1);
    });
    
    // 增加按鈕
    increaseBtn.setInteractive();
    increaseBtn.on('pointerdown', () => {
      this.selectedBorderSlider = index;
      this.updateBorderSliderHighlight();
      this.adjustBorderSlider(index, 1);
    });
    
    // 標籤點擊選中
    this.borderEditorPanel!.list[this.borderEditorPanel!.list.length - 6].setInteractive(); // label
    (this.borderEditorPanel!.list[this.borderEditorPanel!.list.length - 6] as Phaser.GameObjects.Text).on('pointerdown', () => {
      this.selectedBorderSlider = index;
      this.updateBorderSliderHighlight();
    });
  }

  /** 設置滑條數值 */
  private setBorderSliderValue(index: number, value: number): void {
    if (index < 0 || index >= this.borderSliders.length) return;
    
    const slider = this.borderSliders[index];
    const clampedValue = Phaser.Math.Clamp(value, slider.min, slider.max);
    
    if (clampedValue !== slider.value) {
      slider.value = clampedValue;
      slider.valueText.setText(clampedValue.toString());
      
      // 更新手柄位置
      const progress = (clampedValue - slider.min) / (slider.max - slider.min);
      const handleX = -50 + (progress - 0.5) * 200;
      slider.handle.x = handleX;
      
      // 更新預覽
      this.updateBorderPreview();
    }
  }

  /** 創建邊界預覽 */
  private createBorderPreview(): void {
    this.borderPreview = this.add.graphics().setDepth(50);
    this.updateBorderPreview();
  }

  /** 更新邊界預覽 */
  private updateBorderPreview(): void {
    if (!this.borderPreview || this.borderSliders.length === 0) return;
    
    this.borderPreview.clear();
    
    const width = this.borderSliders[0].value;   // 邊界寬度
    const height = this.borderSliders[1].value;  // 邊界高度
    const x = this.borderSliders[2].value;       // 邊界X位置
    const y = this.borderSliders[3].value;       // 邊界Y位置
    
    // 繪製預覽邊界（透明藍色填充 + 藍色邊框）
    this.borderPreview.lineStyle(4, 0x3b82f6, 0.8);
    this.borderPreview.fillStyle(0x3b82f6, 0.1);
    this.borderPreview.strokeRect(x, y, width, height);
    this.borderPreview.fillRect(x, y, width, height);
    
    // 添加尺寸標註
    this.borderPreview.lineStyle(2, 0xfbbf24, 0.8);
    
    // 寬度標註
    this.borderPreview.beginPath();
    this.borderPreview.moveTo(x, y - 20);
    this.borderPreview.lineTo(x + width, y - 20);
    this.borderPreview.stroke();
    
    // 高度標註
    this.borderPreview.beginPath();
    this.borderPreview.moveTo(x - 20, y);
    this.borderPreview.lineTo(x - 20, y + height);
    this.borderPreview.stroke();
  }

  /** 設置邊界編輯器控制 */
  private setupBorderEditorControls(): void {
    const keyboard = this.input.keyboard!;
    
    // 上下鍵選擇參數
    keyboard.addKey('UP').on('down', () => {
      if (!this.borderEditorActive) return;
      this.selectedBorderSlider = Math.max(0, this.selectedBorderSlider - 1);
      this.updateBorderSliderHighlight();
    });
    
    keyboard.addKey('DOWN').on('down', () => {
      if (!this.borderEditorActive) return;
      this.selectedBorderSlider = Math.min(this.borderSliders.length - 1, this.selectedBorderSlider + 1);
      this.updateBorderSliderHighlight();
    });
    
    // 左右鍵調整數值
    keyboard.addKey('LEFT').on('down', () => {
      if (!this.borderEditorActive) return;
      this.adjustBorderSlider(this.selectedBorderSlider, -1);
    });
    
    keyboard.addKey('RIGHT').on('down', () => {
      if (!this.borderEditorActive) return;
      this.adjustBorderSlider(this.selectedBorderSlider, 1);
    });
    
    // Enter保存，Esc取消
    keyboard.addKey('ENTER').on('down', () => {
      if (!this.borderEditorActive) return;
      this.saveBorderSettings();
    });
    
    keyboard.addKey('ESC').on('down', () => {
      if (!this.borderEditorActive) return;
      this.closeBorderEditor();
    });
  }

  /** 更新滑條高亮 */
  private updateBorderSliderHighlight(): void {
    this.borderSliders.forEach((slider, index) => {
      const isSelected = index === this.selectedBorderSlider;
      slider.label.setColor(isSelected ? '#fbbf24' : '#ffffff');
      slider.handle.setFillStyle(isSelected ? 0xfbbf24 : 0x3b82f6);
    });
  }

  /** 調整滑條數值 */
  private adjustBorderSlider(index: number, direction: number): void {
    if (index < 0 || index >= this.borderSliders.length) return;
    
    const slider = this.borderSliders[index];
    const newValue = Phaser.Math.Clamp(
      slider.value + (direction * slider.step),
      slider.min,
      slider.max
    );
    
    if (newValue !== slider.value) {
      slider.value = newValue;
      slider.valueText.setText(newValue.toString());
      
      // 更新手柄位置
      const progress = (newValue - slider.min) / (slider.max - slider.min);
      const handleX = -50 + (progress - 0.5) * 200;
      slider.handle.x = handleX;
      
      // 更新預覽
      this.updateBorderPreview();
    }
  }

  /** 保存邊界設定 */
  private saveBorderSettings(): void {
    console.log('💾 保存邊界設定');
    
    const width = this.borderSliders[0].value;
    const height = this.borderSliders[1].value;
    const x = this.borderSliders[2].value;
    const y = this.borderSliders[3].value;
    
    // 更新GameConfig（使用類型斷言繞過只讀限制）
    if (GameConfig.stage.enabled) {
      // 關卡模式
      (GameConfig.stage as any).arenaW = width;
      (GameConfig.stage as any).arenaH = height;
      (GameConfig.stage as any).sceneMargin = Math.max(x, y);
    } else {
      // 固定模式
      (GameConfig.arena as any).padding = Math.max(x, y);
    }
    
    console.log(`✅ 邊界設定已保存: ${width}×${height} 位置(${x},${y})`);
    
    // 生成配置代碼
    this.generateBorderConfigCode(width, height, x, y);
    
    this.closeBorderEditor();
  }

  /** 生成配置代碼 */
  private generateBorderConfigCode(width: number, height: number, x: number, y: number): void {
    let configCode = '';
    
    if (GameConfig.stage.enabled) {
      configCode = `
// 關卡模式邊界配置更新：
GameConfig.stage.arenaW = ${width};
GameConfig.stage.arenaH = ${height};
GameConfig.stage.sceneMargin = ${Math.max(x, y)};
      `.trim();
    } else {
      configCode = `
// 固定模式邊界配置更新：
GameConfig.arena.padding = ${Math.max(x, y)};
// 實際遊戲區域: ${GameConfig.width - Math.max(x, y) * 2}×${GameConfig.height - Math.max(x, y) * 2}
      `.trim();
    }
    
    console.log('📝 配置代碼:');
    console.log(configCode);
    console.log('請複製上述代碼到 config.ts 中對應位置');
  }

  /** 關閉邊界編輯器 */
  private closeBorderEditor(): void {
    if (!this.borderEditorActive) return;
    
    console.log('❌ 關閉邊界編輯器');
    
    this.borderEditorActive = false;
    this.selectedBorderSlider = 0;
    this.borderSliders = [];
    
    // 清理UI元素
    if (this.borderEditorPanel) {
      this.borderEditorPanel.destroy();
      this.borderEditorPanel = undefined;
    }
    
    if (this.borderPreview) {
      this.borderPreview.destroy();
      this.borderPreview = undefined;
    }
    
    // 清理鍵盤監聽
    this.input.keyboard?.removeAllKeys(true);
    
    // 重新設置原始控制
    this.setupOriginalControls();
  }

  /** 重新設置原始控制 */
  private setupOriginalControls(): void {
    const kb = this.input.keyboard!;
    const KC = Phaser.Input.Keyboard.KeyCodes;
    
    // 重新添加模式選擇控制
    const toFast = () => this.selectMode('fast');
    const toSlow = () => this.selectMode('slow');
    const toggle = () => this.selectMode(this.selected === 'fast' ? 'slow' : 'fast');
    
    kb.addKey(KC.LEFT).on('down', toFast);
    kb.addKey(KC.A).on('down', toFast);
    kb.addKey(KC.RIGHT).on('down', toSlow);
    kb.addKey(KC.D).on('down', toSlow);
    kb.addKey(KC.UP).on('down', toggle);
    kb.addKey(KC.DOWN).on('down', toggle);
    kb.addKey(KC.W).on('down', toggle);
    kb.addKey(KC.S).on('down', toggle);
    
    // 空白鍵確認
    kb.addKey(KC.SPACE).once('down', () => this.startGame(this.selected));
    
    // 其他快捷鍵
    kb.addKey(KC.E).on('down', () => this.openSceneEditor());
    kb.addKey(KC.B).on('down', () => this.openBorderEditor());
    kb.addKey(KC.Z).on('down', () => this.openZoomEditor());
    kb.addKey(KC.G).on('down', () => this.scene.start('MinigameMenuScene'));
  }

  /** 
   * 開啟相機zoom調整編輯器：專門調整遊戲中的相機縮放級別
   * 實時預覽zoom變化，支援鍵盤和滑鼠操作
   */
  private openZoomEditor(): void {
    if (this.zoomEditorActive || this.started) return;
    
    console.log('🔍 開啟相機zoom調整編輯器');
    this.zoomEditorActive = true;
    this.selectedZoomSlider = 0;
    
    this.createZoomEditorPanel();
    this.createZoomSliders();
    this.setupZoomEditorControls();
  }

  /** 創建zoom編輯器面板 */
  private createZoomEditorPanel(): void {
    const width = 600;
    const height = 350;
    const x = GameConfig.width / 2;
    const y = GameConfig.height / 2;
    
    // 主容器
    this.zoomEditorPanel = this.add.container(x, y).setDepth(100);
    
    // 背景
    const background = this.add.rectangle(0, 0, width, height, 0x0d2818, 0.95)
      .setStrokeStyle(3, 0x10b981, 0.8);
    this.zoomEditorPanel.add(background);
    
    // 標題
    const title = this.add.text(0, -height/2 + 30, '🔍 相機Zoom級別調整', {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#10b981',
      fontStyle: 'bold'
    }).setOrigin(0.5);
    this.zoomEditorPanel.add(title);
    
    // 說明文字
    const description = this.add.text(0, -height/2 + 70, '調整相機縮放級別，實時預覽效果', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#a7f3d0'
    }).setOrigin(0.5);
    this.zoomEditorPanel.add(description);
    
    // 操作說明
    const instructions = this.add.text(0, height/2 - 60, 
      '操作：↑↓選擇 ←→調整 數字鍵快速設定 Enter確認 Esc取消', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#6ee7b7'
    }).setOrigin(0.5);
    this.zoomEditorPanel.add(instructions);
    
    // 快捷值說明
    const shortcuts = this.add.text(0, height/2 - 35, 
      '快速設定：1鍵=0.5x 2鍵=0.75x 3鍵=1.0x 4鍵=1.5x 5鍵=2.0x 0鍵=3.0x', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#86efac'
    }).setOrigin(0.5);
    this.zoomEditorPanel.add(shortcuts);
  }

  /** 創建zoom滑桿控制項 */
  private createZoomSliders(): void {
    const config = GameConfig.zoomEditor;
    const parameters = [
      { name: '相機縮放級別', value: config.defaultZoom, min: config.minZoom, max: config.maxZoom, step: 0.05 }
    ];
    
    this.zoomSliders = [];
    const startY = -50;
    
    parameters.forEach((param, index) => {
      const y = startY + index * 80;
      
      // 參數標籤
      const label = this.add.text(-280, y, param.name, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
        fontStyle: 'bold'
      }).setOrigin(0, 0.5);
      
      // 滑條背景
      const sliderBg = this.add.rectangle(-50, y, 280, 24, 0x374151, 0.8)
        .setStrokeStyle(2, 0x059669);
      
      // 滑條手柄
      const progress = (param.value - param.min) / (param.max - param.min);
      const handleX = -50 + (progress - 0.5) * 280;
      const handle = this.add.rectangle(handleX, y, 20, 28, 0x10b981, 1)
        .setStrokeStyle(2, 0x047857);
      
      // 數值顯示
      const valueText = this.add.text(180, y, `${param.value.toFixed(2)}x`, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#34d399',
        fontStyle: 'bold'
      }).setOrigin(0, 0.5);
      
      // 預設置快速按鈕
      const presetY = y + 35;
      const presets = [
        { label: '0.5x', value: 0.5 },
        { label: '0.75x', value: 0.75 },
        { label: '1.0x', value: 1.0 },
        { label: '1.5x', value: 1.5 },
        { label: '2.0x', value: 2.0 },
        { label: '3.0x', value: 3.0 }
      ];
      
      presets.forEach((preset, i) => {
        const presetX = -250 + i * 85;
        const presetBtn = this.add.rectangle(presetX, presetY, 70, 24, 0x065f46, 0.8)
          .setStrokeStyle(1, 0x10b981)
          .setInteractive({ useHandCursor: true });
        
        const presetText = this.add.text(presetX, presetY, preset.label, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#d1fae5'
        }).setOrigin(0.5);
        
        this.zoomEditorPanel?.add(presetBtn);
        this.zoomEditorPanel?.add(presetText);
        
        presetBtn.on('pointerover', () => presetBtn.setFillStyle(0x047857, 1));
        presetBtn.on('pointerout', () => presetBtn.setFillStyle(0x065f46, 0.8));
        presetBtn.on('pointerdown', () => {
          this.updateZoomSliderValue(0, preset.value);
          this.applyZoomPreview();
        });
      });
      
      this.zoomEditorPanel?.add(label);
      this.zoomEditorPanel?.add(sliderBg);
      this.zoomEditorPanel?.add(handle);
      this.zoomEditorPanel?.add(valueText);
      
      this.zoomSliders.push({
        name: param.name,
        value: param.value,
        min: param.min,
        max: param.max,
        step: param.step,
        slider: sliderBg,
        handle,
        label,
        valueText
      });
    });
    
    // 初始預覽
    this.applyZoomPreview();
  }

  /** 設置zoom編輯器鍵盤控制 */
  private setupZoomEditorControls(): void {
    const kb = this.input.keyboard!;
    const KC = Phaser.Input.Keyboard.KeyCodes;
    
    // 清除原有控制
    kb.removeAllKeys(true);
    
    // 上下選擇滑桿
    kb.addKey(KC.UP).on('down', () => {
      this.selectedZoomSlider = Math.max(0, this.selectedZoomSlider - 1);
      this.updateZoomSliderHighlight();
    });
    
    kb.addKey(KC.DOWN).on('down', () => {
      this.selectedZoomSlider = Math.min(this.zoomSliders.length - 1, this.selectedZoomSlider + 1);
      this.updateZoomSliderHighlight();
    });
    
    // 左右調整數值
    kb.addKey(KC.LEFT).on('down', () => {
      const slider = this.zoomSliders[this.selectedZoomSlider];
      if (slider) {
        const newValue = Math.max(slider.min, slider.value - slider.step);
        this.updateZoomSliderValue(this.selectedZoomSlider, newValue);
        this.applyZoomPreview();
      }
    });
    
    kb.addKey(KC.RIGHT).on('down', () => {
      const slider = this.zoomSliders[this.selectedZoomSlider];
      if (slider) {
        const newValue = Math.min(slider.max, slider.value + slider.step);
        this.updateZoomSliderValue(this.selectedZoomSlider, newValue);
        this.applyZoomPreview();
      }
    });
    
    // 數字鍵快速設定
    const presets: Record<string, number> = { '1': 0.5, '2': 0.75, '3': 1.0, '4': 1.5, '5': 2.0, '0': 3.0 };
    Object.entries(presets).forEach(([key, value]) => {
      const keyCode = key === '0' ? KC.ZERO : key === '1' ? KC.ONE : key === '2' ? KC.TWO : 
                      key === '3' ? KC.THREE : key === '4' ? KC.FOUR : KC.FIVE;
      kb.addKey(keyCode).on('down', () => {
        this.updateZoomSliderValue(0, value);
        this.applyZoomPreview();
      });
    });
    
    // 確認和取消
    kb.addKey(KC.ENTER).on('down', () => this.saveZoomSettings());
    kb.addKey(KC.ESC).on('down', () => this.closeZoomEditor());
    
    // 初始高亮
    this.updateZoomSliderHighlight();
  }

  /** 更新zoom滑桿數值 */
  private updateZoomSliderValue(index: number, newValue: number): void {
    const slider = this.zoomSliders[index];
    if (!slider) return;
    
    slider.value = Math.max(slider.min, Math.min(slider.max, newValue));
    slider.valueText.setText(`${slider.value.toFixed(2)}x`);
    
    // 更新手柄位置
    const progress = (slider.value - slider.min) / (slider.max - slider.min);
    const handleX = slider.slider.x + (progress - 0.5) * 280;
    slider.handle.x = handleX;
  }

  /** 更新zoom滑桿高亮 */
  private updateZoomSliderHighlight(): void {
    this.zoomSliders.forEach((slider, index) => {
      const isSelected = index === this.selectedZoomSlider;
      slider.label.setColor(isSelected ? '#34d399' : '#ffffff');
      slider.handle.setStrokeStyle(2, isSelected ? 0xfbbf24 : 0x047857);
    });
  }

  /** 應用zoom預覽效果 */
  private applyZoomPreview(): void {
    const zoomValue = this.zoomSliders[0]?.value || 1.0;
    
    // 在主菜單中應用zoom預覽
    this.cameras.main.setZoom(zoomValue);
    
    console.log(`🔍 預覽zoom: ${zoomValue.toFixed(2)}x`);
  }

  /** 保存zoom設定 */
  private saveZoomSettings(): void {
    const zoomValue = this.zoomSliders[0]?.value || 1.0;
    
    // 更新配置
    (GameConfig.zoomEditor as any).defaultZoom = zoomValue;
    
    console.log(`✅ 已保存zoom設定: ${zoomValue.toFixed(2)}x`);
    
    // 關閉編輯器
    this.closeZoomEditor();
  }

  /** 關閉zoom編輯器 */
  private closeZoomEditor(): void {
    if (!this.zoomEditorActive) return;
    
    console.log('🔍 關閉zoom編輯器');
    this.zoomEditorActive = false;
    
    // 恢復預設zoom
    this.cameras.main.setZoom(1.0);
    
    // 清理UI元素
    if (this.zoomEditorPanel) {
      this.zoomEditorPanel.destroy();
      this.zoomEditorPanel = undefined;
    }
    
    // 清空滑桿陣列
    this.zoomSliders = [];
    
    // 清理鍵盤監聽
    this.input.keyboard?.removeAllKeys(true);
    
    // 重新設置原始控制
    this.setupOriginalControls();
  }

  private get levelMode(): boolean {
    return GameConfig.stage.enabled;
  }
}
