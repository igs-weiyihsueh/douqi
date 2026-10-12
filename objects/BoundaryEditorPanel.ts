import Phaser from 'phaser';
import { SCENE_BG_TEXTURE_KEY } from '../controllers/ArtStyleController';
import { GameConfig } from '../config';
import {
  ARENA_PARAM_DEFS,
  SLOT_HEIGHT,
  clampArenaParam,
  defaultArenaParams,
  fitArenaParams,
  loadArenaParams,
  saveArenaParams,
  type ArenaParamDef,
  type ArenaParams
} from '../systems/arenaParams';

/** 面板版面與配色（畫面座標；面板置中於畫面） */
const LAYOUT = {
  WIDTH: 1640,
  HEIGHT: 900,
  DEPTH: 100,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.96,
  BORDER_COLOR: 0x34d399,
  BORDER_WIDTH: 2,
  /** 遮罩：面板開啟時壓暗背後的主選單 */
  DIM_ALPHA: 0.55,
  TITLE_Y: -405,
  SUBTITLE_Y: -370,
  /** 預覽：整格背景（世界 slotW × SLOT_HEIGHT）縮小後的左上角與縮放 */
  PREVIEW_LEFT: -780,
  PREVIEW_TOP: -330,
  PREVIEW_SCALE: 0.42,
  /** 不可踏入區的遮色、活動範圍外框、可拖曳邊線的感應高度 */
  BLOCKED_COLOR: 0xef4444,
  BLOCKED_ALPHA: 0.35,
  ARENA_LINE_COLOR: 0xfde047,
  ARENA_LINE_WIDTH: 3,
  DRAG_ZONE_HEIGHT: 24,
  /** 右側控制列 */
  ROW_X: 330,
  ROW_START_Y: -220,
  ROW_GAP: 90,
  MINUS_OFFSET_X: 230,
  VALUE_OFFSET_X: 300,
  PLUS_OFFSET_X: 370,
  ROW_HIGHLIGHT_WIDTH: 470,
  ROW_HIGHLIGHT_HEIGHT: 64,
  INFO_Y: 0,
  HELP_Y: 340,
  BUTTON_Y: 400,
  BUTTON_WIDTH: 170,
  BUTTON_HEIGHT: 42,
  BUTTON_GAP: 200,
  COLORS: {
    TEXT: '#e5e7eb',
    HINT: '#94a3b8',
    TITLE: '#6ee7b7',
    VALUE: '#fde68a',
    ROW_HIGHLIGHT: 0x065f46,
    STEP_BUTTON: '#6ee7b7',
    SAVE: 0x15803d,
    RESET: 0x92400e,
    CANCEL: 0x374151,
    NO_PREVIEW: 0x1f2937
  }
} as const;

/** 一列參數的 UI 元件 */
interface ParamRow {
  def: ArenaParamDef;
  highlight: Phaser.GameObjects.Rectangle;
  valueText: Phaser.GameObjects.Text;
}

/**
 * 主選單的地圖邊界編輯器面板：在縮小的整格背景圖上調整玩家活動範圍的上 / 下邊界（左右維持貼齊）。
 *
 * 操作：拖曳預覽上的黃色邊線、點 −/+，或鍵盤 ↑↓ 選擇、←→ 調整、Enter 儲存、Esc 取消。
 * 「儲存」寫入 localStorage 後關閉（下一局開始套用）；「恢復預設」只把數值拉回預設（仍需儲存）；「取消」不儲存直接關閉。
 */
export class BoundaryEditorPanel {
  private readonly scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private dim: Phaser.GameObjects.Rectangle | null = null;
  private rows: ParamRow[] = [];
  private values: ArenaParams = defaultArenaParams();
  private selected = 0;
  /** 預覽上的不可踏入遮色與活動範圍外框（數值改變時重畫） */
  private overlay: Phaser.GameObjects.Graphics | null = null;
  /** 上 / 下邊線的拖曳感應區 */
  private dragZones: Phaser.GameObjects.Rectangle[] = [];
  private infoText: Phaser.GameObjects.Text | null = null;
  /** 正在拖曳的參數（沒有拖曳時 null） */
  private dragging: ArenaParamDef | null = null;
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);
  private readonly onPointerMove = (p: Phaser.Input.Pointer): void => this.handleDrag(p);
  private readonly onPointerUp = (): void => { this.dragging = null; };

  /** @param scene 所在場景（主選單）；主選單以 isOpen 判斷是否暫停自己的操作 */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /** 面板是否開啟中 */
  get isOpen(): boolean {
    return this.container !== null;
  }

  /** 開啟面板：讀取已儲存的參數並建立 UI */
  open(): void {
    if (this.isOpen) return;
    this.values = loadArenaParams();
    this.selected = 0;
    const cx = this.scene.scale.width / 2;
    const cy = this.scene.scale.height / 2;
    // 壓暗背景，同時攔住點擊不穿透到主選單按鈕
    this.dim = this.scene.add.rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0x000000, LAYOUT.DIM_ALPHA)
      .setOrigin(0, 0).setDepth(LAYOUT.DEPTH - 1).setInteractive();
    this.container = this.scene.add.container(cx, cy).setDepth(LAYOUT.DEPTH);
    this.buildFrame();
    this.buildPreview();
    this.rows = ARENA_PARAM_DEFS.map((def, i) => this.buildRow(def, i));
    this.buildButtons();
    this.refresh();
    this.scene.input.keyboard?.on('keydown', this.onKeyDown);
    this.scene.input.on('pointermove', this.onPointerMove);
    this.scene.input.on('pointerup', this.onPointerUp);
  }

  /** 關閉面板（不儲存） */
  close(): void {
    if (!this.isOpen) return;
    this.scene.input.keyboard?.off('keydown', this.onKeyDown);
    this.scene.input.off('pointermove', this.onPointerMove);
    this.scene.input.off('pointerup', this.onPointerUp);
    this.container?.destroy();
    this.dim?.destroy();
    this.container = null;
    this.dim = null;
    this.rows = [];
    this.dragZones = [];
    this.overlay = null;
    this.infoText = null;
    this.dragging = null;
  }

  /** 背景框、標題、說明文字 */
  private buildFrame(): void {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    c.add(this.scene.add.rectangle(0, 0, LAYOUT.WIDTH, LAYOUT.HEIGHT, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA)
      .setStrokeStyle(LAYOUT.BORDER_WIDTH, LAYOUT.BORDER_COLOR));
    c.add(this.scene.add.text(0, LAYOUT.TITLE_Y, '🗺 地圖邊界編輯器', {
      fontFamily: 'monospace', fontSize: '28px', color: colors.TITLE, fontStyle: 'bold'
    }).setOrigin(0.5));
    c.add(this.scene.add.text(0, LAYOUT.SUBTITLE_Y, '調整玩家活動範圍的上 / 下邊界（左右貼齊）· 下一局開始套用 · 儲存在此瀏覽器', {
      fontFamily: 'monospace', fontSize: '15px', color: colors.HINT
    }).setOrigin(0.5));
    c.add(this.scene.add.text(LAYOUT.ROW_X, LAYOUT.HELP_Y, '拖曳黃線 / ↑↓ 選擇　←→ 調整\nEnter 儲存　Esc 取消', {
      fontFamily: 'monospace', fontSize: '14px', color: colors.HINT, align: 'left'
    }).setOrigin(0, 0.5));
  }

  /** 預覽：縮小的整格背景圖（沒有圖時用底色）、不可踏入遮色與活動範圍外框、上下邊線的拖曳感應區 */
  private buildPreview(): void {
    const c = this.container!;
    const { width, height } = this.previewSize();
    if (this.scene.textures.exists(SCENE_BG_TEXTURE_KEY)) {
      c.add(this.scene.add.image(LAYOUT.PREVIEW_LEFT, LAYOUT.PREVIEW_TOP, SCENE_BG_TEXTURE_KEY)
        .setOrigin(0, 0).setDisplaySize(width, height));
    } else {
      c.add(this.scene.add.rectangle(LAYOUT.PREVIEW_LEFT, LAYOUT.PREVIEW_TOP, width, height, LAYOUT.COLORS.NO_PREVIEW).setOrigin(0, 0));
    }
    this.overlay = this.scene.add.graphics();
    c.add(this.overlay);
    this.dragZones = ARENA_PARAM_DEFS.map((def, i) => {
      const zone = this.scene.add.rectangle(LAYOUT.PREVIEW_LEFT, 0, width, LAYOUT.DRAG_ZONE_HEIGHT, 0xffffff, 0.001)
        .setOrigin(0, 0.5).setInteractive({ useHandCursor: true, cursor: 'ns-resize' });
      zone.on('pointerdown', () => { this.selected = i; this.dragging = def; this.refresh(); });
      c.add(zone);
      return zone;
    });
  }

  /** 整格背景在預覽上的尺寸 */
  private previewSize(): { width: number; height: number } {
    const st = GameConfig.stage;
    return { width: (st.arenaW + st.sceneMarginX * 2) * LAYOUT.PREVIEW_SCALE, height: SLOT_HEIGHT * LAYOUT.PREVIEW_SCALE };
  }

  /**
   * 建立一列參數：名稱、−/+ 按鈕、數值
   *
   * @param def 參數定義
   * @param index 列索引
   */
  private buildRow(def: ArenaParamDef, index: number): ParamRow {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    const y = LAYOUT.ROW_START_Y + index * LAYOUT.ROW_GAP;
    const highlight = this.scene.add.rectangle(LAYOUT.ROW_X - 10, y, LAYOUT.ROW_HIGHLIGHT_WIDTH, LAYOUT.ROW_HIGHLIGHT_HEIGHT, colors.ROW_HIGHLIGHT, 0.6)
      .setOrigin(0, 0.5).setVisible(false);
    const label = this.scene.add.text(LAYOUT.ROW_X, y, `${def.label}（${def.hint}）`, {
      fontFamily: 'monospace', fontSize: '18px', color: colors.TEXT
    }).setOrigin(0, 0.5);
    const button = (dx: number, text: string, dir: -1 | 1): Phaser.GameObjects.Text =>
      this.scene.add.text(LAYOUT.ROW_X + dx, y, text, {
        fontFamily: 'monospace', fontSize: '28px', color: colors.STEP_BUTTON, fontStyle: 'bold'
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
        .on('pointerdown', () => { this.selected = index; this.step(def, dir); });
    const valueText = this.scene.add.text(LAYOUT.ROW_X + LAYOUT.VALUE_OFFSET_X, y, '', {
      fontFamily: 'monospace', fontSize: '18px', color: colors.VALUE, fontStyle: 'bold'
    }).setOrigin(0.5);
    c.add([highlight, label, button(LAYOUT.MINUS_OFFSET_X, '−', -1), button(LAYOUT.PLUS_OFFSET_X, '+', 1), valueText]);
    if (index === ARENA_PARAM_DEFS.length - 1) {
      this.infoText = this.scene.add.text(LAYOUT.ROW_X, LAYOUT.INFO_Y, '', {
        fontFamily: 'monospace', fontSize: '18px', color: colors.TEXT, lineSpacing: 8
      }).setOrigin(0, 0.5);
      c.add(this.infoText);
    }
    return { def, highlight, valueText };
  }

  /** 底部按鈕：儲存 / 恢復預設 / 取消 */
  private buildButtons(): void {
    const colors = LAYOUT.COLORS;
    const specs: Array<{ label: string; color: number; action: () => void }> = [
      { label: '儲存 (Enter)', color: colors.SAVE, action: () => this.save() },
      { label: '恢復預設', color: colors.RESET, action: () => this.resetToDefaults() },
      { label: '取消 (Esc)', color: colors.CANCEL, action: () => this.close() }
    ];
    specs.forEach((spec, i) => {
      const x = (i - 1) * LAYOUT.BUTTON_GAP;
      const bg = this.scene.add.rectangle(x, LAYOUT.BUTTON_Y, LAYOUT.BUTTON_WIDTH, LAYOUT.BUTTON_HEIGHT, spec.color, 0.95)
        .setStrokeStyle(LAYOUT.BORDER_WIDTH, 0xffffff, 0.6).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', spec.action);
      const label = this.scene.add.text(x, LAYOUT.BUTTON_Y, spec.label, {
        fontFamily: 'monospace', fontSize: '16px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);
      this.container!.add([bg, label]);
    });
  }

  /**
   * 鍵盤操作：↑↓ 選擇、←→ 調整、Enter 儲存、Esc 取消
   *
   * @param e 鍵盤事件
   */
  private handleKey(e: KeyboardEvent): void {
    const def = this.rows[this.selected]?.def;
    switch (e.key) {
      case 'ArrowUp': this.selected = (this.selected + this.rows.length - 1) % this.rows.length; this.refresh(); break;
      case 'ArrowDown': this.selected = (this.selected + 1) % this.rows.length; this.refresh(); break;
      case 'ArrowLeft': if (def) this.step(def, -1); break;
      case 'ArrowRight': if (def) this.step(def, 1); break;
      case 'Enter': this.save(); break;
      case 'Escape': this.close(); break;
      default: break;
    }
  }

  /**
   * 拖曳邊線：依滑鼠在預覽上的高度換算邊界（上邊界 = 距背景上緣、下邊界 = 距背景下緣）
   *
   * @param pointer 滑鼠
   */
  private handleDrag(pointer: Phaser.Input.Pointer): void {
    const def = this.dragging;
    if (!def || !this.container) return;
    const worldY = (pointer.y - this.container.y - LAYOUT.PREVIEW_TOP) / LAYOUT.PREVIEW_SCALE;
    this.setValue(def, def.key === 'marginTop' ? worldY : SLOT_HEIGHT - worldY);
  }

  /**
   * 以 step 為單位增減參數
   *
   * @param def 參數定義
   * @param direction -1 減少、+1 增加
   */
  private step(def: ArenaParamDef, direction: -1 | 1): void {
    this.setValue(def, this.values[def.key] + direction * def.step);
  }

  /**
   * 設定參數值：對齊 step 格點、夾在合法範圍，並保留最小活動範圍（擠壓另一側），再更新畫面
   *
   * @param def 參數定義
   * @param value 目標值
   */
  private setValue(def: ArenaParamDef, value: number): void {
    const snapped = def.min + Math.round((value - def.min) / def.step) * def.step;
    this.values[def.key] = clampArenaParam(def, snapped);
    fitArenaParams(this.values, def.key);
    this.refresh();
  }

  /** 恢復預設（尚未儲存） */
  private resetToDefaults(): void {
    this.values = defaultArenaParams();
    this.refresh();
  }

  /** 儲存到 localStorage 並關閉 */
  private save(): void {
    saveArenaParams(this.values);
    this.close();
  }

  /** 依目前數值更新數值文字、選取高亮、活動範圍資訊與預覽 */
  private refresh(): void {
    this.rows.forEach((row, i) => {
      row.valueText.setText(`${this.values[row.def.key]}${row.def.unit}`);
      row.highlight.setVisible(i === this.selected);
    });
    const st = GameConfig.stage;
    const arenaH = SLOT_HEIGHT - this.values.marginTop - this.values.marginBottom;
    this.infoText?.setText(`活動範圍：${st.arenaW} × ${arenaH}\n背景格：${st.arenaW + st.sceneMarginX * 2} × ${SLOT_HEIGHT}`);
    this.drawOverlay();
  }

  /** 預覽：上下不可踏入區遮紅色、活動範圍畫黃框，拖曳感應區移到邊線上 */
  private drawOverlay(): void {
    const g = this.overlay;
    if (!g) return;
    const { width, height } = this.previewSize();
    const s = LAYOUT.PREVIEW_SCALE;
    const left = LAYOUT.PREVIEW_LEFT, top = LAYOUT.PREVIEW_TOP;
    const topH = this.values.marginTop * s;
    const bottomH = this.values.marginBottom * s;
    g.clear()
      .fillStyle(LAYOUT.BLOCKED_COLOR, LAYOUT.BLOCKED_ALPHA)
      .fillRect(left, top, width, topH)
      .fillRect(left, top + height - bottomH, width, bottomH)
      .lineStyle(LAYOUT.ARENA_LINE_WIDTH, LAYOUT.ARENA_LINE_COLOR, 1)
      .strokeRect(left, top + topH, width, height - topH - bottomH);
    this.dragZones[0]?.setY(top + topH);
    this.dragZones[1]?.setY(top + height - bottomH);
  }
}
