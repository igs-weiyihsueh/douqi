import Phaser from 'phaser';
import {
  ATTACK_HIT_EVENT, ATTACK_MOVES, ATTACK_TUNING_PARAM_DEFS, applyAttackTuning, attackTuning, attackTuningStore,
  isTimedMove, moveShape, type AttackMove, type AttackTuningKey
} from '../systems/attackTuningParams';
import { HIT_SHAPE_KINDS, HIT_SHAPE_LABELS, drawHitShape, placeHitShape, type HitShapeKind } from '../systems/hitShapes';
import type { Character } from './Character';

/** 面板版面與配色（畫面座標，固定在畫面左側，不擋住中央的角色與木樁） */
const LAYOUT = {
  X: 20,
  Y: 110,
  WIDTH: 470,
  PADDING: 16,
  TITLE_HEIGHT: 56,
  /** 招式分頁：每列 TABS_PER_ROW 個 */
  TAB_HEIGHT: 36,
  TABS_PER_ROW: 3,
  TAB_GAP: 6,
  ROW_HEIGHT: 40,
  SECTION_GAP: 12,
  BUTTON_HEIGHT: 40,
  DEPTH: 3000,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.92,
  BORDER_COLOR: 0x60a5fa,
  TAB_COLOR: 0x1f2937,
  TAB_SELECTED_COLOR: 0x1e3a8a,
  /** 每列：名稱、數值、−、+ 的 x（相對面板左緣） */
  LABEL_X: 24,
  VALUE_X: 300,
  MINUS_X: 370,
  PLUS_X: 425,
  SWATCH_SIZE: 12,
  FONT: 'monospace',
  COLORS: {
    TEXT: '#e5e7eb', HINT: '#94a3b8', TITLE: '#93c5fd', VALUE: '#fde68a', STEP: '#93c5fd',
    MOVE_RESET: 0x7c2d12, RESET: 0x92400e, CLOSE: 0x374151
  }
} as const;

/** 角色身上的範圍顯示（顏色、填色透明度、線框透明度）；招式分頁的色票同色 */
const OVERLAY = {
  DEPTH: 5,
  MOVES: {
    attack1: { color: 0x38bdf8, fill: 0.18, line: 0.9 },
    attack2: { color: 0x34d399, fill: 0.18, line: 0.9 },
    circle: { color: 0xfb923c, fill: 0.12, line: 0.9 },
    line: { color: 0xc084fc, fill: 0.14, line: 0.9 },
    burst: { color: 0xf472b6, fill: 0.12, line: 0.9 },
    dash: { color: 0xfde047, fill: 0.12, line: 0.9 }
  } as Readonly<Record<AttackMove, { color: number; fill: number; line: number }>>,
  TRIGGER: { color: 0xfacc15, line: 0.6 },
  LINE_WIDTH: 2,
  /** 沒有木樁時，衝刺攻擊的範圍畫在角色前方這個距離（衝刺攻擊以撞擊點為基準） */
  DASH_PREVIEW_DISTANCE: 150,
  /** 判定那一刻該招範圍閃亮：填色透明度改成 FLASH_FILL，持續 FLASH_MS（不是正在調的招式也會暫時畫出來） */
  FLASH_FILL: 0.5,
  FLASH_MS: 200
} as const;

/** 各形狀要顯示的尺寸欄位 */
const SHAPE_SIZE_FIELDS: Readonly<Record<HitShapeKind, ReadonlyArray<'radius' | 'arcDeg' | 'length' | 'width'>>> = {
  arc: ['radius', 'arcDeg'],
  circle: ['radius'],
  rect: ['length', 'width']
};

/** 招式判定事件的處理函式 */
type HitHandler = (c: Character, move: AttackMove) => void;

/** 編輯器需要的場景資訊 */
export interface AttackTuningEditorHost {
  /** P1（範圍畫在 P1 身上，方向依 P1 面向） */
  player(): Character;
  /** 木樁（近戰觸發圈加上它的半徑；衝刺攻擊的範圍畫在它身上）；沒有時為 null */
  dummy(): { x: number; y: number; radius: number } | null;
}

/**
 * 木樁模式的範圍 / 判定編輯器（GameConfig.training.tuningEditorKey 開關）：畫面左側面板上方是招式分頁
 * （普攻 1、普攻 2、圓形斬、直線氣波、爆發、衝刺攻擊），選一招後用滑鼠調整它的形狀（扇形 / 圓形 / 長方形）、
 * 判定中心往前 / 往側邊偏移、該形狀的尺寸與判定時間點（systems/attackTuningParams，每次調整即時套用並存在瀏覽器）；
 * 最下面是普攻共用的近戰觸發距離。
 *
 * - 面板建在 UIScene：UIScene 疊在遊戲場景上面且有「點畫面任何地方 = 攻擊」，面板放在遊戲場景會收不到點擊；
 *   面板上的點擊都會攔下來（stopPropagation），不會觸發攻擊
 * - 角色身上只畫選中招式的範圍（衝刺攻擊以撞擊點為基準，畫在木樁身上）與黃色的近戰觸發圈；
 *   P1 任何一招判定的那一刻，該招範圍閃亮一下，方便對照動作調整判定時間點
 */
export class AttackTuningEditor {
  private panel: Phaser.GameObjects.Container | null = null;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private readonly valueTexts = new Map<AttackTuningKey, Phaser.GameObjects.Text>();
  /** 選中的招式（面板顯示它的參數，角色身上畫它的範圍） */
  private selected: AttackMove = 'attack1';
  /** 各招範圍閃亮到何時（場景時間） */
  private readonly flashUntil: Record<AttackMove, number> = { attack1: 0, attack2: 0, circle: 0, line: 0, burst: 0, dash: 0 };

  /**
   * 建立編輯器並監聽招式判定事件（P1 判定時閃亮該招範圍；場景關閉時取消監聽並收掉面板）
   *
   * @param scene 遊戲場景（範圍畫在這裡）
   * @param host 場景資訊
   */
  constructor(private readonly scene: Phaser.Scene, private readonly host: AttackTuningEditorHost) {
    const onHit: HitHandler = (c, move) => {
      if (c === host.player()) this.flashUntil[move] = scene.time.now + OVERLAY.FLASH_MS;
    };
    scene.events.on(ATTACK_HIT_EVENT, onHit);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(ATTACK_HIT_EVENT, onHit);
      this.close();
    });
  }

  /** 面板是否開啟中 */
  get isOpen(): boolean {
    return this.panel !== null;
  }

  /** 開 / 關面板（範圍顯示跟著面板） */
  toggle(): void {
    if (this.panel) this.close();
    else this.open();
  }

  /** 每幀：面板開啟時重畫範圍（選中的招式 + 正在閃亮的招式 + 近戰觸發圈） */
  update(): void {
    if (!this.overlay) return;
    const p = this.host.player();
    const g = this.overlay.clear();
    const now = this.scene.time.now;
    for (const { move } of ATTACK_MOVES) {
      const flashing = now < this.flashUntil[move];
      if (move !== this.selected && !flashing) continue;
      const style = OVERLAY.MOVES[move];
      const anchor = this.anchorOf(move, p);
      g.fillStyle(style.color, flashing ? OVERLAY.FLASH_FILL : style.fill).lineStyle(OVERLAY.LINE_WIDTH, style.color, style.line);
      drawHitShape(g, placeHitShape(moveShape(move), anchor.x, anchor.y, p.aimAngle));
    }
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.TRIGGER.color, OVERLAY.TRIGGER.line)
      .strokeCircle(p.x, p.y, attackTuning().meleeEnemyRange + (this.host.dummy()?.radius ?? 0));
  }

  /**
   * 一招範圍的基準點：衝刺攻擊是撞擊點（畫在木樁身上；沒有木樁時畫在角色前方），其餘是角色
   *
   * @param move 招式
   * @param p P1
   */
  private anchorOf(move: AttackMove, p: Character): { x: number; y: number } {
    if (move !== 'dash') return p;
    const dummy = this.host.dummy();
    if (dummy) return dummy;
    return { x: p.x + Math.cos(p.aimAngle) * OVERLAY.DASH_PREVIEW_DISTANCE, y: p.y + Math.sin(p.aimAngle) * OVERLAY.DASH_PREVIEW_DISTANCE };
  }

  /** 開啟面板與範圍顯示 */
  private open(): void {
    this.overlay = this.scene.add.graphics().setDepth(OVERLAY.DEPTH);
    this.render();
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

  /** （重新）建立面板：招式分頁 + 選中招式的參數（依它目前的形狀）+ 近戰觸發距離 + 底部按鈕；建在 UIScene */
  private render(): void {
    this.panel?.destroy();
    this.valueTexts.clear();
    const ui = this.scene.scene.get('UIScene');
    const keys = this.moveKeys(this.selected, moveShape(this.selected).kind);
    const tabRows = Math.ceil(ATTACK_MOVES.length / LAYOUT.TABS_PER_ROW);
    const height = LAYOUT.TITLE_HEIGHT + tabRows * (LAYOUT.TAB_HEIGHT + LAYOUT.TAB_GAP) + LAYOUT.SECTION_GAP
      + (keys.length + 1) * LAYOUT.ROW_HEIGHT + LAYOUT.SECTION_GAP * 2 + LAYOUT.BUTTON_HEIGHT + LAYOUT.PADDING * 2;
    const panel = ui.add.container(LAYOUT.X, LAYOUT.Y).setDepth(LAYOUT.DEPTH);
    panel.add(this.blockClicks(ui.add.rectangle(0, 0, LAYOUT.WIDTH, height, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA)
      .setOrigin(0, 0).setStrokeStyle(2, LAYOUT.BORDER_COLOR)));
    panel.add(this.text(ui, LAYOUT.PADDING, LAYOUT.PADDING, '範圍 / 判定編輯器（P 開關）', LAYOUT.COLORS.TITLE, '20px'));
    panel.add(this.text(ui, LAYOUT.PADDING, LAYOUT.PADDING + 26, '選一招，調它的形狀、位置與判定時間', LAYOUT.COLORS.HINT, '13px'));
    // 招式分頁
    let y = LAYOUT.TITLE_HEIGHT;
    const tabWidth = (LAYOUT.WIDTH - LAYOUT.PADDING * 2 - LAYOUT.TAB_GAP * (LAYOUT.TABS_PER_ROW - 1)) / LAYOUT.TABS_PER_ROW;
    ATTACK_MOVES.forEach(({ move, label }, i) => {
      const col = i % LAYOUT.TABS_PER_ROW, row = Math.floor(i / LAYOUT.TABS_PER_ROW);
      const tx = LAYOUT.PADDING + col * (tabWidth + LAYOUT.TAB_GAP), ty = y + row * (LAYOUT.TAB_HEIGHT + LAYOUT.TAB_GAP);
      const color = move === this.selected ? LAYOUT.TAB_SELECTED_COLOR : LAYOUT.TAB_COLOR;
      panel.add(this.blockClicks(ui.add.rectangle(tx, ty, tabWidth, LAYOUT.TAB_HEIGHT, color).setOrigin(0, 0)
        .setStrokeStyle(1, OVERLAY.MOVES[move].color), () => this.select(move)));
      panel.add(ui.add.rectangle(tx + 14, ty + LAYOUT.TAB_HEIGHT / 2, LAYOUT.SWATCH_SIZE, LAYOUT.SWATCH_SIZE, OVERLAY.MOVES[move].color));
      panel.add(this.text(ui, tx + 28, ty + LAYOUT.TAB_HEIGHT / 2, label, LAYOUT.COLORS.TEXT, '15px').setOrigin(0, 0.5));
    });
    y += tabRows * (LAYOUT.TAB_HEIGHT + LAYOUT.TAB_GAP) + LAYOUT.SECTION_GAP;
    // 選中招式的參數
    for (const key of keys) {
      this.addRow(ui, panel, key, y);
      y += LAYOUT.ROW_HEIGHT;
    }
    y += LAYOUT.SECTION_GAP;
    this.addRow(ui, panel, 'meleeEnemyRange', y);
    y += LAYOUT.ROW_HEIGHT + LAYOUT.SECTION_GAP;
    // 底部按鈕
    const buttonY = y + LAYOUT.BUTTON_HEIGHT / 2;
    const third = LAYOUT.WIDTH / 3;
    panel.add(this.button(ui, third / 2, buttonY, '這招恢復預設', LAYOUT.COLORS.MOVE_RESET, () => this.resetMove()));
    panel.add(this.button(ui, third * 1.5, buttonY, '全部恢復預設', LAYOUT.COLORS.RESET, () => this.resetAll()));
    panel.add(this.button(ui, third * 2.5, buttonY, '關閉', LAYOUT.COLORS.CLOSE, () => this.close()));
    this.panel = panel;
    this.refreshValues();
  }

  /**
   * 一招在目前形狀下要顯示的參數：形狀、往前 / 往側邊偏移、該形狀的尺寸、判定時間（有的話）
   *
   * @param move 招式
   * @param kind 目前形狀
   */
  private moveKeys(move: AttackMove, kind: HitShapeKind): AttackTuningKey[] {
    const keys: AttackTuningKey[] = [`${move}.shape`, `${move}.offsetForward`, `${move}.offsetSide`];
    for (const field of SHAPE_SIZE_FIELDS[kind]) keys.push(`${move}.${field}`);
    if (isTimedMove(move)) keys.push(`${move}.hitMs`);
    return keys;
  }

  /**
   * 加一列參數：名稱、說明、數值與 − / +（形狀那一列的數值顯示形狀名稱，◀ / ▶ 循環切換）
   *
   * @param ui 面板所在場景
   * @param panel 面板
   * @param key 參數
   * @param y 列的上緣（相對面板）
   */
  private addRow(ui: Phaser.Scene, panel: Phaser.GameObjects.Container, key: AttackTuningKey, y: number): void {
    const def = ATTACK_TUNING_PARAM_DEFS.find((d) => d.key === key)!;
    const rowY = y + LAYOUT.ROW_HEIGHT / 2;
    panel.add(this.text(ui, LAYOUT.LABEL_X, rowY - 10, def.label, LAYOUT.COLORS.TEXT, '15px'));
    if (def.hint) panel.add(this.text(ui, LAYOUT.LABEL_X, rowY + 8, def.hint, LAYOUT.COLORS.HINT, '11px'));
    const value = this.text(ui, LAYOUT.VALUE_X, rowY, '', LAYOUT.COLORS.VALUE, '16px').setOrigin(0.5);
    this.valueTexts.set(key, value);
    panel.add(value);
    const isShape = key.endsWith('.shape');
    panel.add(this.stepButton(ui, LAYOUT.MINUS_X, rowY, isShape ? '◀' : '−', () => this.step(key, -1)));
    panel.add(this.stepButton(ui, LAYOUT.PLUS_X, rowY, isShape ? '▶' : '+', () => this.step(key, 1)));
  }

  /**
   * 選中一招：面板改顯示它的參數，角色身上改畫它的範圍
   *
   * @param move 招式
   */
  private select(move: AttackMove): void {
    this.selected = move;
    this.render();
  }

  /**
   * 調整一項參數一格並立即套用、存檔；形狀循環切換（換形狀後重建面板，顯示該形狀的尺寸欄位）
   *
   * @param key 參數
   * @param dir −1 / +1
   */
  private step(key: AttackTuningKey, dir: -1 | 1): void {
    const def = ATTACK_TUNING_PARAM_DEFS.find((d) => d.key === key)!;
    const values = { ...attackTuning() };
    const isShape = key.endsWith('.shape');
    if (isShape) {
      const count = HIT_SHAPE_KINDS.length;
      values[key] = (values[key] + dir + count) % count;
    } else {
      values[key] = attackTuningStore.clamp(def, values[key] + dir * def.step);
    }
    applyAttackTuning(values);
    if (isShape) this.render();
    else this.refreshValues();
  }

  /** 選中的招式恢復預設（其他招式不動） */
  private resetMove(): void {
    const defaults = attackTuningStore.defaults();
    const values = { ...attackTuning() };
    const prefix = `${this.selected}.`;
    for (const def of ATTACK_TUNING_PARAM_DEFS) {
      if (def.key.startsWith(prefix)) values[def.key] = defaults[def.key];
    }
    applyAttackTuning(values);
    this.render();
  }

  /** 全部招式恢復預設 */
  private resetAll(): void {
    applyAttackTuning(attackTuningStore.defaults());
    this.render();
  }

  /** 更新面板上的數值（形狀顯示名稱） */
  private refreshValues(): void {
    const values = attackTuning();
    for (const [key, text] of this.valueTexts) {
      if (key.endsWith('.shape')) {
        text.setText(HIT_SHAPE_LABELS[HIT_SHAPE_KINDS[values[key]]]);
      } else {
        const def = ATTACK_TUNING_PARAM_DEFS.find((d) => d.key === key)!;
        text.setText(`${values[key]}${def.unit}`);
      }
    }
  }

  /**
   * 讓物件可點、並攔下點擊（不往下傳給 UIScene 的「點畫面 = 攻擊」）
   *
   * @param obj 物件
   * @param onClick 點擊時呼叫（可省略：只攔點擊）
   */
  private blockClicks<T extends Phaser.GameObjects.GameObject>(obj: T, onClick?: () => void): T {
    obj.setInteractive().on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick?.();
    });
    return obj;
  }

  /**
   * 面板文字
   *
   * @param ui 面板所在場景
   * @param x 左緣 x（相對面板）
   * @param y 上緣 y（相對面板）
   * @param content 文字
   * @param color 顏色
   * @param size 字級
   */
  private text(ui: Phaser.Scene, x: number, y: number, content: string, color: string, size: string): Phaser.GameObjects.Text {
    return ui.add.text(x, y, content, { fontFamily: LAYOUT.FONT, fontSize: size, color });
  }

  /**
   * − / + 按鈕
   *
   * @param ui 面板所在場景
   * @param x 中心 x（相對面板）
   * @param y 中心 y（相對面板）
   * @param label 文字
   * @param onClick 點擊時呼叫
   */
  private stepButton(ui: Phaser.Scene, x: number, y: number, label: string, onClick: () => void): Phaser.GameObjects.Text {
    const button = this.text(ui, x, y, label, LAYOUT.COLORS.STEP, '24px').setOrigin(0.5);
    this.blockClicks(button, onClick);
    button.input!.cursor = 'pointer';
    return button;
  }

  /**
   * 底部按鈕（底色方塊 + 文字）
   *
   * @param ui 面板所在場景
   * @param x 中心 x（相對面板）
   * @param y 中心 y（相對面板）
   * @param label 文字
   * @param color 底色
   * @param onClick 點擊時呼叫
   */
  private button(ui: Phaser.Scene, x: number, y: number, label: string, color: number, onClick: () => void): Phaser.GameObjects.Container {
    const width = LAYOUT.WIDTH / 3 - LAYOUT.PADDING;
    const bg = this.blockClicks(ui.add.rectangle(0, 0, width, LAYOUT.BUTTON_HEIGHT, color), onClick);
    const caption = this.text(ui, 0, 0, label, LAYOUT.COLORS.TEXT, '14px').setOrigin(0.5);
    return ui.add.container(x, y, [bg, caption]);
  }
}
