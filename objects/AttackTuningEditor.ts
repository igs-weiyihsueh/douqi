import Phaser from 'phaser';
import {
  ATTACK_HIT_EVENT, ATTACK_TUNING_GROUPS, ATTACK_TUNING_PARAM_DEFS, applyAttackTuning, attackTuning, attackTuningStore,
  meleeSegment, type AttackMove, type AttackTuningKey
} from '../systems/attackTuningParams';
import type { Character } from './Character';

/** 面板版面與配色（畫面座標，固定在畫面左側，不擋住中央的角色與木樁） */
const LAYOUT = {
  X: 20,
  Y: 110,
  WIDTH: 470,
  PADDING: 16,
  TITLE_HEIGHT: 56,
  GROUP_HEIGHT: 34,
  ROW_HEIGHT: 40,
  BUTTON_HEIGHT: 40,
  DEPTH: 3000,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.92,
  BORDER_COLOR: 0x60a5fa,
  /** 選中招式的分組底色 */
  SELECTED_COLOR: 0x1e3a8a,
  SELECTED_ALPHA: 0.6,
  /** 每列：名稱、數值、−、+ 的 x（相對面板左緣）；分組標題的色票 x */
  SWATCH_X: 24,
  GROUP_TITLE_X: 40,
  LABEL_X: 48,
  VALUE_X: 300,
  MINUS_X: 370,
  PLUS_X: 425,
  SWATCH_SIZE: 14,
  FONT: 'monospace',
  COLORS: { TEXT: '#e5e7eb', HINT: '#94a3b8', TITLE: '#93c5fd', GROUP: '#f8fafc', VALUE: '#fde68a', STEP: '#93c5fd', RESET: 0x92400e, CLOSE: 0x374151 }
} as const;

/** 角色身上的範圍顯示（顏色、填色透明度、線框透明度）；面板分組的色票同色 */
const OVERLAY = {
  DEPTH: 5,
  MOVES: {
    attack1: { color: 0x38bdf8, fill: 0.18, line: 0.9 },
    attack2: { color: 0x34d399, fill: 0.18, line: 0.9 },
    circle: { color: 0xfb923c, fill: 0.12, line: 0.9 },
    line: { color: 0xc084fc, fill: 0.14, line: 0.9 }
  } as Readonly<Record<AttackMove, { color: number; fill: number; line: number }>>,
  TRIGGER: { color: 0xfacc15, line: 0.8 },
  LINE_WIDTH: 2,
  /** 判定那一刻該招範圍閃亮：填色透明度改成 FLASH_FILL，持續 FLASH_MS（不是正在調的招式也會暫時畫出來） */
  FLASH_FILL: 0.5,
  FLASH_MS: 200
} as const;

/** 招式判定事件的處理函式 */
type HitHandler = (c: Character, move: AttackMove) => void;

/** 編輯器需要的場景資訊 */
export interface AttackTuningEditorHost {
  /** P1（範圍畫在 P1 身上，方向依 P1 面向） */
  player(): Character;
  /** 木樁的身體半徑（近戰觸發圈 = 觸發距離 + 木樁半徑，木樁中心進圈就是近戰）；沒有木樁時為 0 */
  dummyRadius(): number;
}

/**
 * 木樁模式的範圍 / 判定編輯器（GameConfig.training.tuningEditorKey 開關）：畫面左側面板依招式分組，用滑鼠按 − / + 調整
 * 每一招的範圍與判定時間點（systems/attackTuningParams，每次調整即時套用並存在瀏覽器）。
 *
 * - 面板建在 UIScene：UIScene 疊在遊戲場景上面且有「點畫面任何地方 = 攻擊」，面板放在遊戲場景會收不到點擊；
 *   面板上的點擊都會攔下來（stopPropagation），不會觸發攻擊
 * - 點分組（標題、數值或 − / +）就選中那一招，角色身上只畫選中招式的範圍（加上黃色的近戰觸發圈）；
 *   P1 任何一招判定的那一刻，該招範圍閃亮一下，方便對照動作調整判定時間點
 */
export class AttackTuningEditor {
  private panel: Phaser.GameObjects.Container | null = null;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private readonly valueTexts = new Map<AttackTuningKey, Phaser.GameObjects.Text>();
  private readonly groupHighlights = new Map<AttackMove, Phaser.GameObjects.Rectangle>();
  /** 選中的招式（角色身上畫它的範圍） */
  private selected: AttackMove = 'attack1';
  /** 各招範圍閃亮到何時（場景時間） */
  private readonly flashUntil: Record<AttackMove, number> = { attack1: 0, attack2: 0, circle: 0, line: 0 };

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

  /** 每幀：面板開啟時重畫 P1 身上的範圍（選中的招式 + 正在閃亮的招式 + 近戰觸發圈） */
  update(): void {
    if (!this.overlay) return;
    const p = this.host.player();
    const g = this.overlay.clear();
    const now = this.scene.time.now;
    for (const move of Object.keys(OVERLAY.MOVES) as AttackMove[]) {
      const flashing = now < this.flashUntil[move];
      if (move === this.selected || flashing) this.drawMove(g, p, move, flashing);
    }
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.TRIGGER.color, OVERLAY.TRIGGER.line)
      .strokeCircle(p.x, p.y, attackTuning().meleeEnemyRange + this.host.dummyRadius());
  }

  /**
   * 畫一招的範圍
   *
   * @param g 畫布
   * @param p P1
   * @param move 招式
   * @param flashing 是否在判定閃亮中
   */
  private drawMove(g: Phaser.GameObjects.Graphics, p: Character, move: AttackMove, flashing: boolean): void {
    const style = OVERLAY.MOVES[move];
    const t = attackTuning();
    const angle = p.aimAngle;
    g.fillStyle(style.color, flashing ? OVERLAY.FLASH_FILL : style.fill);
    g.lineStyle(OVERLAY.LINE_WIDTH, style.color, style.line);
    if (move === 'attack1' || move === 'attack2') {
      const arc = meleeSegment(move === 'attack1' ? 0 : 1);
      const half = Phaser.Math.DegToRad(arc.arcDeg) / 2;
      g.slice(p.x, p.y, arc.radius, angle - half, angle + half, false).fillPath();
      g.beginPath().slice(p.x, p.y, arc.radius, angle - half, angle + half, false).closePath().strokePath();
    } else if (move === 'circle') {
      g.fillCircle(p.x, p.y, t.circleRadius).strokeCircle(p.x, p.y, t.circleRadius);
    } else {
      // 直線氣波：從角色往面向延伸的長方形
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const hw = t.lineWidth / 2, len = t.lineLength;
      const corners = [
        new Phaser.Math.Vector2(p.x - sin * hw, p.y + cos * hw),
        new Phaser.Math.Vector2(p.x + sin * hw, p.y - cos * hw),
        new Phaser.Math.Vector2(p.x + cos * len + sin * hw, p.y + sin * len - cos * hw),
        new Phaser.Math.Vector2(p.x + cos * len - sin * hw, p.y + sin * len + cos * hw)
      ];
      g.fillPoints(corners, true).strokePoints(corners, true);
    }
  }

  /** 開啟面板（建在 UIScene）與範圍顯示 */
  private open(): void {
    const ui = this.scene.scene.get('UIScene');
    const rows = ATTACK_TUNING_GROUPS.reduce((n, grp) => n + grp.keys.length, 0);
    const height = LAYOUT.TITLE_HEIGHT + ATTACK_TUNING_GROUPS.length * LAYOUT.GROUP_HEIGHT + rows * LAYOUT.ROW_HEIGHT
      + LAYOUT.BUTTON_HEIGHT + LAYOUT.PADDING * 3;
    const panel = ui.add.container(LAYOUT.X, LAYOUT.Y).setDepth(LAYOUT.DEPTH);
    panel.add(this.blockClicks(ui.add.rectangle(0, 0, LAYOUT.WIDTH, height, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA)
      .setOrigin(0, 0).setStrokeStyle(2, LAYOUT.BORDER_COLOR)));
    panel.add(this.text(ui, LAYOUT.PADDING, LAYOUT.PADDING, '範圍 / 判定編輯器（P 開關）', LAYOUT.COLORS.TITLE, '20px'));
    panel.add(this.text(ui, LAYOUT.PADDING, LAYOUT.PADDING + 26, '點一招選中它（角色身上畫它的範圍），按 − / + 調整', LAYOUT.COLORS.HINT, '13px'));
    let y = LAYOUT.TITLE_HEIGHT + LAYOUT.PADDING;
    for (const group of ATTACK_TUNING_GROUPS) {
      const groupHeight = LAYOUT.GROUP_HEIGHT + group.keys.length * LAYOUT.ROW_HEIGHT;
      const move = group.move;
      const select = (): void => { if (move) this.select(move); };
      const highlight = this.blockClicks(ui.add.rectangle(LAYOUT.PADDING / 2, y, LAYOUT.WIDTH - LAYOUT.PADDING, groupHeight,
        LAYOUT.SELECTED_COLOR, 0).setOrigin(0, 0), select);
      panel.add(highlight);
      if (move) this.groupHighlights.set(move, highlight);
      const swatch = move ? OVERLAY.MOVES[move].color : OVERLAY.TRIGGER.color;
      panel.add(ui.add.rectangle(LAYOUT.SWATCH_X, y + LAYOUT.GROUP_HEIGHT / 2, LAYOUT.SWATCH_SIZE, LAYOUT.SWATCH_SIZE, swatch));
      panel.add(this.text(ui, LAYOUT.GROUP_TITLE_X, y + 7, group.title, LAYOUT.COLORS.GROUP, '17px'));
      y += LAYOUT.GROUP_HEIGHT;
      for (const key of group.keys) {
        const def = ATTACK_TUNING_PARAM_DEFS.find((d) => d.key === key)!;
        const rowY = y + LAYOUT.ROW_HEIGHT / 2;
        panel.add(this.text(ui, LAYOUT.LABEL_X, rowY - 10, def.label, LAYOUT.COLORS.TEXT, '15px'));
        if (def.hint) panel.add(this.text(ui, LAYOUT.LABEL_X, rowY + 8, def.hint, LAYOUT.COLORS.HINT, '11px'));
        const value = this.text(ui, LAYOUT.VALUE_X, rowY, '', LAYOUT.COLORS.VALUE, '16px').setOrigin(0.5);
        this.valueTexts.set(key, value);
        panel.add(value);
        panel.add(this.stepButton(ui, LAYOUT.MINUS_X, rowY, '−', () => { select(); this.step(key, -1); }));
        panel.add(this.stepButton(ui, LAYOUT.PLUS_X, rowY, '+', () => { select(); this.step(key, 1); }));
        y += LAYOUT.ROW_HEIGHT;
      }
    }
    const buttonY = height - LAYOUT.PADDING - LAYOUT.BUTTON_HEIGHT / 2;
    panel.add(this.button(ui, LAYOUT.WIDTH / 4, buttonY, '恢復預設', LAYOUT.COLORS.RESET, () => this.reset()));
    panel.add(this.button(ui, (LAYOUT.WIDTH * 3) / 4, buttonY, '關閉', LAYOUT.COLORS.CLOSE, () => this.close()));
    this.panel = panel;
    this.overlay = this.scene.add.graphics().setDepth(OVERLAY.DEPTH);
    this.refreshValues();
    this.select(this.selected);
    this.update();
  }

  /** 關閉面板與範圍顯示 */
  private close(): void {
    this.panel?.destroy();
    this.panel = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.valueTexts.clear();
    this.groupHighlights.clear();
  }

  /**
   * 選中一招：面板該組加底色，角色身上改畫它的範圍
   *
   * @param move 招式
   */
  private select(move: AttackMove): void {
    this.selected = move;
    for (const [m, rect] of this.groupHighlights) rect.setFillStyle(LAYOUT.SELECTED_COLOR, m === move ? LAYOUT.SELECTED_ALPHA : 0);
  }

  /**
   * 調整一項參數一格（夾在範圍內），立即套用並存檔
   *
   * @param key 參數
   * @param dir −1 減少 / +1 增加
   */
  private step(key: AttackTuningKey, dir: -1 | 1): void {
    const def = ATTACK_TUNING_PARAM_DEFS.find((d) => d.key === key)!;
    const values = { ...attackTuning() };
    values[key] = attackTuningStore.clamp(def, values[key] + dir * def.step);
    applyAttackTuning(values);
    this.refreshValues();
  }

  /** 全部恢復預設 */
  private reset(): void {
    applyAttackTuning(attackTuningStore.defaults());
    this.refreshValues();
  }

  /** 更新面板上的數值 */
  private refreshValues(): void {
    const values = attackTuning();
    for (const def of ATTACK_TUNING_PARAM_DEFS) this.valueTexts.get(def.key)?.setText(`${values[def.key]}${def.unit}`);
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
    const button = this.text(ui, x, y, label, LAYOUT.COLORS.STEP, '26px').setOrigin(0.5);
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
    const width = LAYOUT.WIDTH / 2 - LAYOUT.PADDING * 2;
    const bg = this.blockClicks(ui.add.rectangle(0, 0, width, LAYOUT.BUTTON_HEIGHT, color), onClick);
    const caption = this.text(ui, 0, 0, label, LAYOUT.COLORS.TEXT, '16px').setOrigin(0.5);
    return ui.add.container(x, y, [bg, caption]);
  }
}
