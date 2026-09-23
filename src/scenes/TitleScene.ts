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

    // ── 地形編輯器入口：🏔️ 地形編輯器 (M) → TerrainEditorScene（獨立編輯器場景）──
    const teBtnW = 200, teBtnH = 44;
    const teX = w / 2, teY = h - teBtnH / 2 - 20; // 底部中央
    const teBg = this.add
      .rectangle(teX, teY, teBtnW, teBtnH, 0x7c2d12, 0.9)
      .setStrokeStyle(2, 0xff4500, 0.9)
      .setDepth(5);
    this.add
      .text(teX, teY, '🏔️ 地形編輯器 (M)', { fontFamily: 'monospace', fontSize: '16px', color: '#fed7aa', fontStyle: 'bold' })
      .setOrigin(0.5).setDepth(6);
    const teBtn = this.add.container(0, 0, [teBg]).setSize(teBtnW, teBtnH).setDepth(5);
    teBtn.setInteractive(
      new Phaser.Geom.Rectangle(teX - teBtnW / 2, teY - teBtnH / 2, teBtnW, teBtnH),
      Phaser.Geom.Rectangle.Contains
    );
    teBtn.on('pointerover', () => teBg.setFillStyle(0x9a3412, 0.95));
    teBtn.on('pointerout', () => teBg.setFillStyle(0x7c2d12, 0.9));
    teBtn.on('pointerdown', () => this.scene.start('TerrainEditorScene'));
    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M).on('down', () => this.scene.start('TerrainEditorScene'));

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
    this.scene.start('GameScene', { controlMode: mode });
    this.scene.launch('UIScene');
  }
}
