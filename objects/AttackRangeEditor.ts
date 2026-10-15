import Phaser from 'phaser';
import {
  ATTACK_RANGE_PARAM_DEFS, applyAttackRange, attackRange, attackRangeStore, type AttackRangeKey
} from '../systems/attackRangeParams';
import type { Character } from './Character';

/** 面板版面與配色（畫面座標，固定在畫面左側，不擋住中央的角色與木樁） */
const LAYOUT = {
  X: 20,
  Y: 110,
  WIDTH: 470,
  PADDING: 16,
  TITLE_HEIGHT: 56,
  ROW_HEIGHT: 46,
  BUTTON_HEIGHT: 40,
  DEPTH: 3000,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.9,
  BORDER_COLOR: 0x60a5fa,
  /** 每列：色票、名稱、數值、−、+ 的 x（相對面板左緣） */
  SWATCH_X: 24,
  LABEL_X: 40,
  VALUE_X: 300,
  MINUS_X: 370,
  PLUS_X: 425,
  SWATCH_SIZE: 12,
  FONT: 'monospace',
  COLORS: { TEXT: '#e5e7eb', HINT: '#94a3b8', TITLE: '#93c5fd', VALUE: '#fde68a', STEP: '#93c5fd', RESET: 0x92400e, CLOSE: 0x374151 }
} as const;

/** 各範圍在角色身上的顯示（顏色、填色透明度、線框透明度）；面板該列的色票同色 */
const OVERLAY = {
  DEPTH: 5,
  MELEE: { color: 0x38bdf8, fill: 0.16, line: 0.9 },
  TRIGGER: { color: 0xfacc15, fill: 0, line: 0.8 },
  CIRCLE: { color: 0xfb923c, fill: 0.08, line: 0.8 },
  LINE: { color: 0xc084fc, fill: 0.1, line: 0.8 },
  LINE_WIDTH: 2
} as const;

/** 各參數對應的範圍顏色（面板色票用） */
const KEY_COLORS: Readonly<Record<AttackRangeKey, number>> = {
  meleeRadius: OVERLAY.MELEE.color,
  meleeArcDeg: OVERLAY.MELEE.color,
  meleeEnemyRange: OVERLAY.TRIGGER.color,
  circleRadius: OVERLAY.CIRCLE.color,
  lineLength: OVERLAY.LINE.color,
  lineWidth: OVERLAY.LINE.color
};

/** 編輯器需要的場景資訊 */
export interface AttackRangeEditorHost {
  /** P1（範圍畫在 P1 身上，方向依 P1 面向） */
  player(): Character;
  /** 木樁的身體半徑（近戰觸發圈 = 觸發距離 + 木樁半徑，木樁中心進圈就是近戰）；沒有木樁時為 0 */
  dummyRadius(): number;
}

/**
 * 木樁模式的範圍編輯器（GameConfig.training.rangeEditorKey 開關）：畫面左側面板用滑鼠按 − / + 調整攻擊範圍
 * （systems/attackRangeParams，每次調整即時套用並存在瀏覽器），開啟期間在 P1 身上畫出各範圍：
 * 普攻扇形（藍）、近戰觸發圈（黃，木樁中心進圈就原地揮擊，否則衝刺）、圓形斬（橘）、直線氣波（紫，朝 P1 面向）
 */
export class AttackRangeEditor {
  private panel: Phaser.GameObjects.Container | null = null;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private readonly valueTexts = new Map<AttackRangeKey, Phaser.GameObjects.Text>();

  /**
   * @param scene 場景
   * @param host 場景資訊
   */
  constructor(private readonly scene: Phaser.Scene, private readonly host: AttackRangeEditorHost) {}

  /** 面板是否開啟中 */
  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** 開 / 關面板（範圍顯示跟著面板） */
  toggle(): void {
    if (this.panel) this.close();
    else this.open();
  }

  /** 每幀：面板開啟時重畫 P1 身上的範圍 */
  update(): void {
    if (!this.overlay) return;
    const p = this.host.player();
    const range = attackRange();
    const g = this.overlay.clear();
    const angle = p.aimAngle;
    const half = Phaser.Math.DegToRad(range.meleeArcDeg) / 2;
    // 普攻扇形
    g.fillStyle(OVERLAY.MELEE.color, OVERLAY.MELEE.fill).slice(p.x, p.y, range.meleeRadius, angle - half, angle + half, false).fillPath();
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.MELEE.color, OVERLAY.MELEE.line)
      .beginPath().slice(p.x, p.y, range.meleeRadius, angle - half, angle + half, false).closePath().strokePath();
    // 近戰觸發圈
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.TRIGGER.color, OVERLAY.TRIGGER.line)
      .strokeCircle(p.x, p.y, range.meleeEnemyRange + this.host.dummyRadius());
    // 圓形斬
    g.fillStyle(OVERLAY.CIRCLE.color, OVERLAY.CIRCLE.fill).fillCircle(p.x, p.y, range.circleRadius);
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.CIRCLE.color, OVERLAY.CIRCLE.line).strokeCircle(p.x, p.y, range.circleRadius);
    // 直線氣波（從角色往面向延伸的長方形）
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const hw = range.lineWidth / 2, len = range.lineLength;
    const corners = [
      new Phaser.Math.Vector2(p.x - sin * hw, p.y + cos * hw),
      new Phaser.Math.Vector2(p.x + sin * hw, p.y - cos * hw),
      new Phaser.Math.Vector2(p.x + cos * len + sin * hw, p.y + sin * len - cos * hw),
      new Phaser.Math.Vector2(p.x + cos * len - sin * hw, p.y + sin * len + cos * hw)
    ];
    g.fillStyle(OVERLAY.LINE.color, OVERLAY.LINE.fill).fillPoints(corners, true);
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.LINE.color, OVERLAY.LINE.line).strokePoints(corners, true);
  }

  /** 開啟面板與範圍顯示 */
  private open(): void {
    const defs = ATTACK_RANGE_PARAM_DEFS;
    const height = LAYOUT.TITLE_HEIGHT + defs.length * LAYOUT.ROW_HEIGHT + LAYOUT.BUTTON_HEIGHT + LAYOUT.PADDING * 2;
    const panel = this.scene.add.container(LAYOUT.X, LAYOUT.Y).setScrollFactor(0).setDepth(LAYOUT.DEPTH);
    panel.add(this.scene.add.rectangle(0, 0, LAYOUT.WIDTH, height, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA)
      .setOrigin(0, 0).setStrokeStyle(2, LAYOUT.BORDER_COLOR).setInteractive());
    panel.add(this.text(LAYOUT.PADDING, LAYOUT.PADDING, '範圍編輯器（P 開關）', LAYOUT.COLORS.TITLE, '20px'));
    panel.add(this.text(LAYOUT.PADDING, LAYOUT.PADDING + 26, '用滑鼠按 − / +，調整立即生效並存在瀏覽器', LAYOUT.COLORS.HINT, '13px'));
    defs.forEach((def, i) => {
      const y = LAYOUT.TITLE_HEIGHT + LAYOUT.PADDING + i * LAYOUT.ROW_HEIGHT + LAYOUT.ROW_HEIGHT / 2;
      panel.add(this.scene.add.rectangle(LAYOUT.SWATCH_X, y, LAYOUT.SWATCH_SIZE, LAYOUT.SWATCH_SIZE, KEY_COLORS[def.key]));
      panel.add(this.text(LAYOUT.LABEL_X, y - 10, def.label, LAYOUT.COLORS.TEXT, '16px'));
      if (def.hint) panel.add(this.text(LAYOUT.LABEL_X, y + 9, def.hint, LAYOUT.COLORS.HINT, '11px'));
      const value = this.text(LAYOUT.VALUE_X, y, '', LAYOUT.COLORS.VALUE, '16px').setOrigin(0.5);
      this.valueTexts.set(def.key, value);
      panel.add(value);
      panel.add(this.stepButton(LAYOUT.MINUS_X, y, '−', () => this.step(def.key, -1)));
      panel.add(this.stepButton(LAYOUT.PLUS_X, y, '+', () => this.step(def.key, 1)));
    });
    const buttonY = height - LAYOUT.PADDING - LAYOUT.BUTTON_HEIGHT / 2;
    panel.add(this.button(LAYOUT.WIDTH / 4, buttonY, '恢復預設', LAYOUT.COLORS.RESET, () => this.reset()));
    panel.add(this.button((LAYOUT.WIDTH * 3) / 4, buttonY, '關閉', LAYOUT.COLORS.CLOSE, () => this.close()));
    this.panel = panel;
    this.overlay = this.scene.add.graphics().setDepth(OVERLAY.DEPTH);
    this.refreshValues();
    this.update();
  }

  /** 關閉面板與範圍顯示 */
  private close(): void {
    this.panel?.destroy();
    this.panel = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.valueTexts.clear();
  }

  /**
   * 調整一項參數一格（夾在範圍內），立即套用並存檔
   *
   * @param key 參數
   * @param dir −1 減少 / +1 增加
   */
  private step(key: AttackRangeKey, dir: -1 | 1): void {
    const def = ATTACK_RANGE_PARAM_DEFS.find((d) => d.key === key)!;
    const values = { ...attackRange() };
    values[key] = attackRangeStore.clamp(def, values[key] + dir * def.step);
    applyAttackRange(values);
    this.refreshValues();
  }

  /** 全部恢復預設 */
  private reset(): void {
    applyAttackRange(attackRangeStore.defaults());
    this.refreshValues();
  }

  /** 更新面板上的數值 */
  private refreshValues(): void {
    const values = attackRange();
    for (const def of ATTACK_RANGE_PARAM_DEFS) this.valueTexts.get(def.key)?.setText(`${values[def.key]}${def.unit}`);
  }

  /**
   * 面板文字
   *
   * @param x 左緣 x（相對面板）
   * @param y 上緣 y（相對面板）
   * @param content 文字
   * @param color 顏色
   * @param size 字級
   */
  private text(x: number, y: number, content: string, color: string, size: string): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, content, { fontFamily: LAYOUT.FONT, fontSize: size, color });
  }

  /**
   * − / + 按鈕
   *
   * @param x 中心 x（相對面板）
   * @param y 中心 y（相對面板）
   * @param label 文字
   * @param onClick 點擊時呼叫
   */
  private stepButton(x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    return this.text(x, y, label, LAYOUT.COLORS.STEP, '26px').setOrigin(0.5)
      .setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
  }

  /**
   * 底部按鈕（底色方塊 + 文字）
   *
   * @param x 中心 x（相對面板）
   * @param y 中心 y（相對面板）
   * @param label 文字
   * @param color 底色
   * @param onClick 點擊時呼叫
   */
  private button(x: number, y: number, label: string, color: number, onClick: () => void): Phaser.GameObjects.Container {
    const width = LAYOUT.WIDTH / 2 - LAYOUT.PADDING * 2;
    const bg = this.scene.add.rectangle(0, 0, width, LAYOUT.BUTTON_HEIGHT, color).setInteractive({ useHandCursor: true }).on('pointerdown', onClick);
    const caption = this.text(0, 0, label, LAYOUT.COLORS.TEXT, '16px').setOrigin(0.5);
    return this.scene.add.container(x, y, [bg, caption]);
  }
}
