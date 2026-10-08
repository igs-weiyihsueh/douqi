import Phaser from 'phaser';
import { GameConfig } from '../config';
import { SKIN_TEXTURE } from '../controllers/ArtStyleController';
import { visibleBottomOffset } from '../systems/spriteFeet';
import {
  CHARACTER_PARAM_DEFS,
  clampCharacterParam,
  defaultCharacterParams,
  loadCharacterParams,
  saveCharacterParams,
  type CharacterParamDef,
  type CharacterParams
} from '../systems/characterParams';

/** 面板版面與配色（畫面座標；面板置中於畫面） */
const LAYOUT = {
  WIDTH: 1100,
  HEIGHT: 620,
  DEPTH: 100,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.96,
  BORDER_COLOR: 0x60a5fa,
  BORDER_WIDTH: 2,
  /** 遮罩：面板開啟時壓暗背後的主選單 */
  DIM_ALPHA: 0.55,
  TITLE_Y: -245,
  SUBTITLE_Y: -210,
  /** 第一列參數的 y 與列距 */
  ROW_START_Y: -150,
  ROW_GAP: 60,
  LABEL_X: -510,
  TRACK_X: -250,
  TRACK_WIDTH: 260,
  TRACK_HEIGHT: 10,
  HANDLE_WIDTH: 14,
  HANDLE_HEIGHT: 26,
  MINUS_X: 38,
  VALUE_X: 88,
  PLUS_X: 138,
  /** 選中列的底色條 */
  ROW_HIGHLIGHT_WIDTH: 1060,
  ROW_HIGHLIGHT_HEIGHT: 56,
  BUTTON_Y: 235,
  BUTTON_WIDTH: 150,
  BUTTON_HEIGHT: 40,
  BUTTON_GAP: 175,
  HELP_Y: 190,
  /** 預覽區域 */
  PREVIEW_X: 300,
  PREVIEW_Y: -50,
  PREVIEW_SCALE: 0.6,
  PREVIEW_TITLE_Y: -150,
  COLORS: {
    TEXT: '#e5e7eb',
    HINT: '#94a3b8',
    TITLE: '#93c5fd',
    VALUE: '#fde68a',
    TRACK: 0x374151,
    TRACK_FILL: 0x3b82f6,
    HANDLE: 0xf8fafc,
    ROW_HIGHLIGHT: 0x1e3a8a,
    STEP_BUTTON: '#93c5fd',
    SAVE: 0x15803d,
    RESET: 0x92400e,
    CANCEL: 0x374151
  }
} as const;

/** 一列參數的 UI 元件 */
interface ParamRow {
  def: CharacterParamDef;
  highlight: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  handle: Phaser.GameObjects.Rectangle;
  valueText: Phaser.GameObjects.Text;
}

/**
 * 主選單的角色編輯器面板：4 項角色參數（慢速模式，P1 與 BOT 共用）各一條滑桿。
 *
 * 操作：滑鼠點滑桿 / −+ 按鈕，或鍵盤 ↑↓ 選擇、←→ 調整、Enter 儲存、Esc 取消。
 * 「儲存」寫入 localStorage 後關閉；「恢復預設」只把滑桿拉回預設值（仍需儲存）；「取消」不儲存直接關閉。
 */
export class CharacterEditorPanel {
  private readonly scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private dim: Phaser.GameObjects.Rectangle | null = null;
  private rows: ParamRow[] = [];
  private values: CharacterParams = defaultCharacterParams();
  private selected = 0;
  /** 預覽用的角色圖 */
  private previewCharacter: Phaser.GameObjects.Image | null = null;
  /** 預覽用的真空圈線條 */
  private previewVacuum: Phaser.GameObjects.Graphics | null = null;
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);

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
    this.values = loadCharacterParams();
    this.selected = 0;
    const cx = this.scene.scale.width / 2;
    const cy = this.scene.scale.height / 2;
    // 壓暗背景，同時攔住點擊不穿透到主選單按鈕
    this.dim = this.scene.add.rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0x000000, LAYOUT.DIM_ALPHA)
      .setOrigin(0, 0).setDepth(LAYOUT.DEPTH - 1).setInteractive();
    this.container = this.scene.add.container(cx, cy).setDepth(LAYOUT.DEPTH);
    this.buildFrame();
    this.rows = CHARACTER_PARAM_DEFS.map((def, i) => this.buildRow(def, i));
    this.buildButtons();
    this.refresh();
    this.scene.input.keyboard?.on('keydown', this.onKeyDown);
  }

  /** 關閉面板（不儲存） */
  close(): void {
    if (!this.isOpen) return;
    this.scene.input.keyboard?.off('keydown', this.onKeyDown);
    this.container?.destroy();
    this.dim?.destroy();
    this.container = null;
    this.dim = null;
    this.rows = [];
  }

  /** 背景框、標題、說明文字 */
  private buildFrame(): void {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    c.add(this.scene.add.rectangle(0, 0, LAYOUT.WIDTH, LAYOUT.HEIGHT, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA)
      .setStrokeStyle(LAYOUT.BORDER_WIDTH, LAYOUT.BORDER_COLOR));
    c.add(this.scene.add.text(0, LAYOUT.TITLE_Y, '🛠 角色編輯器', {
      fontFamily: 'monospace', fontSize: '28px', color: colors.TITLE, fontStyle: 'bold'
    }).setOrigin(0.5));
    c.add(this.scene.add.text(0, LAYOUT.SUBTITLE_Y, '慢速模式 · P1 與 BOT 共用 · 儲存在此瀏覽器', {
      fontFamily: 'monospace', fontSize: '15px', color: colors.HINT
    }).setOrigin(0.5));
    c.add(this.scene.add.text(0, LAYOUT.HELP_Y, '↑↓ 選擇　←→ 調整　Enter 儲存　Esc 取消', {
      fontFamily: 'monospace', fontSize: '14px', color: colors.HINT
    }).setOrigin(0.5));

    // 預覽區域
    this.buildPreview(c);
  }

  /**
   * 建立一列參數：名稱、滑桿（可點擊跳值）、−/+ 按鈕、數值
   *
   * @param def 參數定義
   * @param index 列索引
   * @returns 該列的 UI 元件
   */
  private buildRow(def: CharacterParamDef, index: number): ParamRow {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    const y = LAYOUT.ROW_START_Y + index * LAYOUT.ROW_GAP;
    const highlight = this.scene.add.rectangle(0, y, LAYOUT.ROW_HIGHLIGHT_WIDTH, LAYOUT.ROW_HIGHLIGHT_HEIGHT, colors.ROW_HIGHLIGHT, 0.6)
      .setVisible(false);
    const label = def.hint ? `${def.label}（${def.hint}）` : def.label;
    const labelText = this.scene.add.text(LAYOUT.LABEL_X, y, label, {
      fontFamily: 'monospace', fontSize: '18px', color: colors.TEXT
    }).setOrigin(0, 0.5);
    // 滑桿：底軌 + 填色 + 把手；點擊底軌依位置設定數值
    const track = this.scene.add.rectangle(LAYOUT.TRACK_X, y, LAYOUT.TRACK_WIDTH, LAYOUT.TRACK_HEIGHT, colors.TRACK)
      .setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
    track.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const ratio = Phaser.Math.Clamp((pointer.x - this.container!.x - LAYOUT.TRACK_X) / LAYOUT.TRACK_WIDTH, 0, 1);
      this.selected = index;
      this.setValue(def, def.min + ratio * (def.max - def.min));
    });
    const fill = this.scene.add.rectangle(LAYOUT.TRACK_X, y, 0, LAYOUT.TRACK_HEIGHT, colors.TRACK_FILL).setOrigin(0, 0.5);
    const handle = this.scene.add.rectangle(LAYOUT.TRACK_X, y, LAYOUT.HANDLE_WIDTH, LAYOUT.HANDLE_HEIGHT, colors.HANDLE);
    const minus = this.makeStepButton(LAYOUT.MINUS_X, y, '−', () => { this.selected = index; this.step(def, -1); });
    const plus = this.makeStepButton(LAYOUT.PLUS_X, y, '+', () => { this.selected = index; this.step(def, 1); });
    const valueText = this.scene.add.text(LAYOUT.VALUE_X, y, '', {
      fontFamily: 'monospace', fontSize: '18px', color: colors.VALUE, fontStyle: 'bold'
    }).setOrigin(0.5);
    c.add([highlight, labelText, track, fill, handle, minus, plus, valueText]);
    return { def, highlight, fill, handle, valueText };
  }

  /**
   * 建立 −/+ 微調按鈕
   *
   * @param x 按鈕 x（容器座標）
   * @param y 按鈕 y（容器座標）
   * @param text 按鈕文字
   * @param onClick 點擊回呼
   */
  private makeStepButton(x: number, y: number, text: string, onClick: () => void): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, {
      fontFamily: 'monospace', fontSize: '26px', color: LAYOUT.COLORS.STEP_BUTTON, fontStyle: 'bold'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
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
   * 以 step 為單位增減參數
   *
   * @param def 參數定義
   * @param direction -1 減少、+1 增加
   */
  private step(def: CharacterParamDef, direction: -1 | 1): void {
    this.setValue(def, this.values[def.key] + direction * def.step);
  }

  /**
   * 設定參數值：對齊 step 格點並夾在合法範圍，再更新畫面
   *
   * @param def 參數定義
   * @param value 目標值
   */
  /** 計算step的小數位數 */
  private stepDecimals(step: number): number {
    return step.toString().split('.')[1]?.length || 0;
  }

  /**
   * 依據step的小數位數四捨五入，避免浮點誤差
   * @param value 要處理的數值
   * @param step 步進值
   * @returns 四捨五入後的數值
   */
  private roundByStep(value: number, step: number): number {
    const decimalPlaces = this.stepDecimals(step);
    return Math.round(value * Math.pow(10, decimalPlaces)) / Math.pow(10, decimalPlaces);
  }

  /**
   * 依據step的小數位數格式化數值顯示
   * @param value 要格式化的數值
   * @param step 步進值
   * @returns 格式化後的字串
   */
  private formatByStep(value: number, step: number): string {
    const decimalPlaces = this.stepDecimals(step);
    return value.toFixed(decimalPlaces);
  }

  /**
   * 設定參數值並更新顯示
   * @param def 參數定義
   * @param value 新數值
   */
  private setValue(def: CharacterParamDef, value: number): void {
    const snapped = def.min + Math.round((value - def.min) / def.step) * def.step;
    const rounded = this.roundByStep(snapped, def.step);
    this.values[def.key] = clampCharacterParam(def, rounded);
    this.refresh();
  }

  /** 恢復預設：滑桿回到預設值（尚未儲存） */
  private resetToDefaults(): void {
    this.values = defaultCharacterParams();
    this.refresh();
  }

  /** 儲存到 localStorage 並關閉 */
  private save(): void {
    saveCharacterParams(this.values);
    this.close();
  }

  /** 依目前數值與選取列更新所有滑桿、數值與高亮 */
  private refresh(): void {
    this.rows.forEach((row, i) => {
      const { def } = row;
      const value = this.values[def.key];
      const ratio = (value - def.min) / (def.max - def.min);
      row.fill.width = LAYOUT.TRACK_WIDTH * ratio;
      row.handle.x = LAYOUT.TRACK_X + LAYOUT.TRACK_WIDTH * ratio;
      const formattedValue = this.formatByStep(value, def.step);
      row.valueText.setText(def.unit ? `${formattedValue}${def.unit}` : formattedValue);
      row.highlight.setVisible(i === this.selected);
    });
    this.updatePreview();
  }

  /** 建立預覽區域 */
  private buildPreview(container: Phaser.GameObjects.Container): void {
    const colors = LAYOUT.COLORS;
    
    // 預覽標題
    container.add(this.scene.add.text(LAYOUT.PREVIEW_X, LAYOUT.PREVIEW_TITLE_Y, '真空圈預覽', {
      fontFamily: 'monospace', fontSize: '16px', color: colors.TITLE, fontStyle: 'bold'
    }).setOrigin(0.5));
    
    // 預覽角色圖片
    if (this.scene.textures.exists(SKIN_TEXTURE)) {
      this.previewCharacter = this.scene.add.image(LAYOUT.PREVIEW_X, LAYOUT.PREVIEW_Y, SKIN_TEXTURE)
        .setScale(LAYOUT.PREVIEW_SCALE)
        .setDepth(LAYOUT.DEPTH + 1);
      container.add(this.previewCharacter);
    }

    // 真空圈預覽
    this.previewVacuum = this.scene.add.graphics().setDepth(LAYOUT.DEPTH + 1);
    container.add(this.previewVacuum);
  }

  /** 更新預覽顯示 */
  private updatePreview(): void {
    if (!this.previewVacuum) return;

    const vacuum = this.previewVacuum;
    vacuum.clear();

    if (this.previewCharacter) {
      const scale = LAYOUT.PREVIEW_SCALE;
      const charX = LAYOUT.PREVIEW_X;
      const charY = LAYOUT.PREVIEW_Y;
      
      // 計算腳底位置
      const bottomOffset = visibleBottomOffset(this.scene.textures, this.previewCharacter.texture.key);
      const footY = charY + bottomOffset * scale;

      // 真空圈參數
      const radius = this.values.vacuumRadius;
      const flatten = this.values.vacuumFlatten;
      const offsetX = this.values.vacuumOffsetX;
      const offsetY = this.values.vacuumOffsetY;

      // 真空圈尺寸和位置
      const ellipseWidth = radius * 2 * scale;
      const ellipseHeight = radius * flatten * 2 * scale;
      const ellipseCenterX = charX + offsetX * scale;
      const ellipseCenterY = footY + offsetY * scale;

      // 繪製真空圈橢圓
      const aimConfig = GameConfig.aim;
      vacuum.lineStyle(aimConfig.ringThickness, aimConfig.ringColor, aimConfig.ringAlpha);
      vacuum.strokeEllipse(ellipseCenterX, ellipseCenterY, ellipseWidth, ellipseHeight);
    }
  }
}
