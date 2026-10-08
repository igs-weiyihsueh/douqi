import Phaser from 'phaser';
import {
  HIT_FEEL_PARAM_DEFS,
  HIT_FEEL_GROUPS,
  HIT_FEEL_PRESETS,
  hitFeelStore,
  reloadHitFeel,
  setHitFeel,
  applyHitFeelPreset,
  type HitFeelParamDef,
  type HitFeelParams,
  type HitFeelGroup
} from '../systems/hitFeelParams';
import { HitFeelPreview } from './HitFeelPreview';

/** 面板版面與配色（畫面座標；面板置中於畫面） */
const LAYOUT = {
  WIDTH: 1400,
  HEIGHT: 800,
  DEPTH: 100,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.96,
  BORDER_COLOR: 0x60a5fa,
  BORDER_WIDTH: 2,
  /** 遮罩：面板開啟時壓暗背後的主選單 */
  DIM_ALPHA: 0.55,
  /** 標題與副標 */
  TITLE_Y: -350,
  SUBTITLE_Y: -315,
  /** 分頁按鈕區域 */
  TAB_Y: -260,
  TAB_BUTTON_WIDTH: 120,
  TAB_BUTTON_HEIGHT: 36,
  TAB_BUTTON_GAP: 10,
  /** 參數列區域 */
  ROW_START_Y: -200,
  ROW_GAP: 50,
  LABEL_X: -640,
  TRACK_X: -380,
  TRACK_WIDTH: 200,
  TRACK_HEIGHT: 10,
  HANDLE_WIDTH: 14,
  HANDLE_HEIGHT: 26,
  MINUS_X: -120,
  VALUE_X: -70,
  PLUS_X: -20,
  /** 選中列的底色條 */
  ROW_HIGHLIGHT_WIDTH: 1340,
  ROW_HIGHLIGHT_HEIGHT: 46,
  /** 預設組合按鈕區域 */
  PRESET_Y: 60,
  PRESET_BUTTON_WIDTH: 100,
  PRESET_BUTTON_HEIGHT: 40,
  PRESET_BUTTON_GAP: 20,
  /** 底部按鈕 */
  BUTTON_Y: 280,
  BUTTON_WIDTH: 150,
  BUTTON_HEIGHT: 40,
  BUTTON_GAP: 175,
  /** 預覽區域 */
  PREVIEW_X: 460,
  PREVIEW_Y: -50,
  PREVIEW_WIDTH: 480,
  PREVIEW_HEIGHT: 360,
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
    TAB_ACTIVE: 0x3b82f6,
    TAB_INACTIVE: 0x374151,
    PRESET: 0x7c3aed,
    SAVE: 0x15803d,
    RESET: 0x92400e,
    CANCEL: 0x374151
  }
} as const;

/** 一列參數的 UI 元件 */
interface ParamRow {
  def: HitFeelParamDef;
  highlight: Phaser.GameObjects.Rectangle;
  fill: Phaser.GameObjects.Rectangle;
  handle: Phaser.GameObjects.Rectangle;
  valueText: Phaser.GameObjects.Text;
}

/**
 * 主選單的打擊感編輯器面板：18 項打擊感參數分 4 組顯示，每組一頁。
 *
 * 操作：Tab/Shift+Tab 或 Q/E 切換分頁，滑鼠點滑桿 / −+ 按鈕，或鍵盤 ↑↓ 選擇、←→ 調整、Enter 儲存、Esc 取消。
 * 「儲存」寫入 localStorage 後關閉；「恢復預設」只把滑桿拉回預設值（仍需儲存）；「取消」不儲存直接關閉。
 */
export class HitFeelEditorPanel {
  private readonly scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private dim: Phaser.GameObjects.Rectangle | null = null;
  private preview: HitFeelPreview | null = null;
  private groups: HitFeelGroup[] = [];
  private currentGroupIndex = 0;
  private rows: ParamRow[] = [];
  private values: HitFeelParams = hitFeelStore.defaults();
  private selected = 0;
  private tabButtons: Phaser.GameObjects.Rectangle[] = [];
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private readonly onKeyDown = (e: KeyboardEvent): void => this.handleKey(e);

  /** @param scene 所在場景（主選單）；主選單以 isOpen 判斷是否暫停自己的操作 */
  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.groups = [...HIT_FEEL_GROUPS];
  }

  /** 面板是否開啟中 */
  get isOpen(): boolean {
    return this.container !== null;
  }

  /** 開啟面板：讀取已儲存的參數並建立 UI */
  open(): void {
    if (this.isOpen) return;
    this.values = hitFeelStore.load();
    this.currentGroupIndex = 0;
    this.selected = 0;
    const cx = this.scene.scale.width / 2;
    const cy = this.scene.scale.height / 2;
    
    // 壓暗背景，同時攔住點擊不穿透到主選單按鈕
    this.dim = this.scene.add.rectangle(0, 0, this.scene.scale.width, this.scene.scale.height, 0x000000, LAYOUT.DIM_ALPHA)
      .setOrigin(0, 0).setDepth(LAYOUT.DEPTH - 1).setInteractive();
    this.container = this.scene.add.container(cx, cy).setDepth(LAYOUT.DEPTH);
    
    this.buildFrame();
    this.buildTabs();
    this.buildPresetButtons();
    this.buildBottomButtons();
    this.buildPreview();
    this.switchToGroup(0);
    this.refresh();
    this.scene.input.keyboard?.on('keydown', this.onKeyDown);
  }

  /** 關閉面板（不儲存） */
  close(): void {
    if (!this.isOpen) return;
    this.scene.input.keyboard?.off('keydown', this.onKeyDown);
    this.preview?.destroy();
    this.preview = null;
    this.container?.destroy();
    this.dim?.destroy();
    this.container = null;
    this.dim = null;
    reloadHitFeel(); // 還原預覽用的暫時值
  }

  /** 建立面板底板與標題 */
  private buildFrame(): void {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    
    // 底板
    const bg = this.scene.add.rectangle(0, 0, LAYOUT.WIDTH, LAYOUT.HEIGHT, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA)
      .setStrokeStyle(LAYOUT.BORDER_WIDTH, LAYOUT.BORDER_COLOR);
    
    // 標題
    const title = this.scene.add.text(0, LAYOUT.TITLE_Y, '⚔ 打擊感編輯器', {
      fontFamily: 'monospace', fontSize: '28px', color: colors.TITLE, fontStyle: 'bold'
    }).setOrigin(0.5);
    
    const subtitle = this.scene.add.text(0, LAYOUT.SUBTITLE_Y, '調整命中凍結、受擊反應、火花特效與衝刺切入', {
      fontFamily: 'monospace', fontSize: '16px', color: colors.HINT
    }).setOrigin(0.5);
    
    c.add([bg, title, subtitle]);
  }

  /** 建立分頁按鈕 */
  private buildTabs(): void {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    const totalWidth = HIT_FEEL_GROUPS.length * LAYOUT.TAB_BUTTON_WIDTH + (HIT_FEEL_GROUPS.length - 1) * LAYOUT.TAB_BUTTON_GAP;
    const startX = -totalWidth / 2 + LAYOUT.TAB_BUTTON_WIDTH / 2;
    
    HIT_FEEL_GROUPS.forEach((group, i) => {
      const x = startX + i * (LAYOUT.TAB_BUTTON_WIDTH + LAYOUT.TAB_BUTTON_GAP);
      const bg = this.scene.add.rectangle(x, LAYOUT.TAB_Y, LAYOUT.TAB_BUTTON_WIDTH, LAYOUT.TAB_BUTTON_HEIGHT, colors.TAB_INACTIVE, 0.9)
        .setStrokeStyle(1, 0xffffff, 0.3).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => this.switchToGroup(i));
      
      const text = this.scene.add.text(x, LAYOUT.TAB_Y, group.title, {
        fontFamily: 'monospace', fontSize: '14px', color: colors.TEXT, fontStyle: 'bold'
      }).setOrigin(0.5);
      
      this.tabButtons.push(bg);
      this.tabTexts.push(text);
      c.add([bg, text]);
    });
  }

  /** 建立預設組合按鈕 */
  private buildPresetButtons(): void {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    const totalWidth = HIT_FEEL_PRESETS.length * LAYOUT.PRESET_BUTTON_WIDTH + (HIT_FEEL_PRESETS.length - 1) * LAYOUT.PRESET_BUTTON_GAP;
    const startX = -totalWidth / 2 + LAYOUT.PRESET_BUTTON_WIDTH / 2;
    
    HIT_FEEL_PRESETS.forEach((preset, i) => {
      const x = startX + i * (LAYOUT.PRESET_BUTTON_WIDTH + LAYOUT.PRESET_BUTTON_GAP);
      const bg = this.scene.add.rectangle(x, LAYOUT.PRESET_Y, LAYOUT.PRESET_BUTTON_WIDTH, LAYOUT.PRESET_BUTTON_HEIGHT, colors.PRESET, 0.9)
        .setStrokeStyle(LAYOUT.BORDER_WIDTH, 0xffffff, 0.6).setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        this.values = applyHitFeelPreset(preset.values);
        this.refresh();
        this.updatePreview();
      });
      
      const text = this.scene.add.text(x, LAYOUT.PRESET_Y, preset.name, {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold'
      }).setOrigin(0.5);
      
      c.add([bg, text]);
    });
  }

  /** 建立底部按鈕：儲存 / 恢復預設 / 取消 */
  private buildBottomButtons(): void {
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

  /** 建立預覽區域 */
  private buildPreview(): void {
    this.preview = new HitFeelPreview(this.scene, this.container!, LAYOUT.PREVIEW_X, LAYOUT.PREVIEW_Y, LAYOUT.DEPTH);
  }

  /** 切換到指定分組 */
  private switchToGroup(index: number): void {
    if (index < 0 || index >= this.groups.length) return;
    this.currentGroupIndex = index;
    this.selected = 0;
    
    // 更新分頁按鈕樣式
    this.tabButtons.forEach((btn, i) => {
      btn.setFillStyle(i === index ? LAYOUT.COLORS.TAB_ACTIVE : LAYOUT.COLORS.TAB_INACTIVE);
    });
    
    // 清除舊的參數列
    this.rows.forEach(row => {
      row.highlight.destroy();
      row.fill.destroy();
      row.handle.destroy();
      row.valueText.destroy();
    });
    this.rows = [];
    
    // 建立當前組的參數列
    const group = this.groups[index];
    group.keys.forEach((key, i) => {
      const def = HIT_FEEL_PARAM_DEFS.find(d => d.key === key)!;
      this.rows.push(this.buildRow(def, i));
    });
  }

  /**
   * 建立一列參數的 UI
   *
   * @param def 參數定義
   * @param index 在當前組中的列索引
   * @returns 該列的 UI 元件
   */
  private buildRow(def: HitFeelParamDef, index: number): ParamRow {
    const c = this.container!;
    const colors = LAYOUT.COLORS;
    const y = LAYOUT.ROW_START_Y + index * LAYOUT.ROW_GAP;
    
    const highlight = this.scene.add.rectangle(0, y, LAYOUT.ROW_HIGHLIGHT_WIDTH, LAYOUT.ROW_HIGHLIGHT_HEIGHT, colors.ROW_HIGHLIGHT, 0.6)
      .setVisible(false);
    
    const label = def.hint ? `${def.label}（${def.hint}）` : def.label;
    const labelText = this.scene.add.text(LAYOUT.LABEL_X, y, label, {
      fontFamily: 'monospace', fontSize: '16px', color: colors.TEXT
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
      fontFamily: 'monospace', fontSize: '16px', color: colors.VALUE, fontStyle: 'bold'
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
      fontFamily: 'monospace', fontSize: '24px', color: LAYOUT.COLORS.STEP_BUTTON, fontStyle: 'bold'
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
  }

  /**
   * 鍵盤操作：Tab/Shift+Tab 或 Q/E 切換分頁、↑↓ 選擇、←→ 調整、Enter 儲存、Esc 取消
   *
   * @param e 鍵盤事件
   */
  private handleKey(e: KeyboardEvent): void {
    const def = this.rows[this.selected]?.def;
    
    if (e.key === 'Tab') {
      e.preventDefault();
      const direction = e.shiftKey ? -1 : 1;
      this.switchToGroup((this.currentGroupIndex + direction + this.groups.length) % this.groups.length);
    } else if (e.key === 'q' || e.key === 'Q') {
      this.switchToGroup((this.currentGroupIndex - 1 + this.groups.length) % this.groups.length);
    } else if (e.key === 'e' || e.key === 'E') {
      this.switchToGroup((this.currentGroupIndex + 1) % this.groups.length);
    } else if (e.key === 'ArrowUp') {
      this.selected = Math.max(0, this.selected - 1);
      this.refresh();
    } else if (e.key === 'ArrowDown') {
      this.selected = Math.min(this.rows.length - 1, this.selected + 1);
      this.refresh();
    } else if (e.key === 'ArrowLeft' && def) {
      this.step(def, -1);
    } else if (e.key === 'ArrowRight' && def) {
      this.step(def, 1);
    } else if (e.key === 'Enter') {
      this.save();
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  /**
   * 調整參數數值（−/+ 按鈕或鍵盤 ←→）
   *
   * @param def 參數定義
   * @param direction 調整方向：+1 增加、-1 減少
   */
  private step(def: HitFeelParamDef, direction: number): void {
    const current = this.values[def.key];
    const newValue = current + direction * def.step;
    this.setValue(def, newValue);
  }

  /**
   * 設定參數值並更新顯示
   *
   * @param def 參數定義
   * @param value 新數值
   */
  private setValue(def: HitFeelParamDef, value: number): void {
    this.values[def.key] = hitFeelStore.clamp(def, value);
    this.refresh();
    this.updatePreview();
  }

  /** 恢復為預設值 */
  private resetToDefaults(): void {
    this.values = hitFeelStore.defaults();
    this.refresh();
    this.updatePreview();
  }

  /** 儲存並關閉 */
  private save(): void {
    hitFeelStore.save(this.values);
    reloadHitFeel();
    this.close();
  }

  /** 更新預覽 */
  private updatePreview(): void {
    setHitFeel(this.values);
    this.preview?.restart();
  }

  /** 更新所有 UI 顯示 */
  private refresh(): void {
    this.rows.forEach((row, i) => {
      const { def, highlight, fill, handle, valueText } = row;
      const value = this.values[def.key];
      const ratio = (value - def.min) / (def.max - def.min);
      
      // 選中狀態
      highlight.setVisible(i === this.selected);
      
      // 滑桿填色與把手位置
      fill.setSize(LAYOUT.TRACK_WIDTH * ratio, LAYOUT.TRACK_HEIGHT);
      handle.setX(LAYOUT.TRACK_X + LAYOUT.TRACK_WIDTH * ratio);
      
      // 數值顯示
      if (def.min === 0 && def.max === 1 && def.step === 1) {
        // 開關類參數顯示「開/關」
        valueText.setText(value === 1 ? '開' : '關');
      } else {
        // 一般數值參數
        const displayValue = this.formatByStep(value, def.step);
        valueText.setText(def.unit ? `${displayValue} ${def.unit}` : displayValue);
      }
    });
  }

  /**
   * 依據step的小數位數計算
   *
   * @param step 步進值
   * @returns 小數位數
   */
  private stepDecimals(step: number): number {
    return step.toString().split('.')[1]?.length || 0;
  }

  /**
   * 依據step的小數位數格式化顯示
   *
   * @param value 要顯示的數值
   * @param step 步進值
   * @returns 格式化後的字串
   */
  private formatByStep(value: number, step: number): string {
    const decimalPlaces = this.stepDecimals(step);
    return value.toFixed(decimalPlaces);
  }
}
