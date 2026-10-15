import Phaser from 'phaser';
import type { PlayerAnimKey, PlayerPosePreview } from '../controllers/PlayerSpineController';
import {
  ATTACK_HIT_EVENT, ATTACK_MOVES, HIT_POINT_FIELDS, MAX_HIT_POINTS, MELEE_ENEMY_RANGE_DEF, attackTuning, clampHitPointField,
  hasHitShape, isTimedMove, moveHitPoints, resetAllAttackTuning, resetMoveHitPoints, setMeleeEnemyRange, setMoveHitPoints,
  type AttackMove, type HitPoint, type HitPointField, type TimedAttackMove
} from '../systems/attackTuningParams';
import { HIT_SHAPE_KINDS, HIT_SHAPE_LABELS, drawHitShape, placeHitShape, type HitShapeKind } from '../systems/hitShapes';
import type { Character } from './Character';

/** 面板版面與配色（畫面座標，固定在畫面左側，不擋住中央的角色與木樁） */
const LAYOUT = {
  X: 20,
  Y: 100,
  WIDTH: 470,
  PADDING: 16,
  TITLE_HEIGHT: 50,
  /** 招式分頁：每列 TABS_PER_ROW 個 */
  TAB_HEIGHT: 34,
  TABS_PER_ROW: 3,
  TAB_GAP: 6,
  /** 時間軸：說明列、軸、按鈕列 */
  TIMELINE_LABEL_HEIGHT: 24,
  BAR_HEIGHT: 22,
  BAR_MARKER_WIDTH: 6,
  PLAYHEAD_WIDTH: 2,
  PLAYHEAD_OVERHANG: 4,
  /** 按在選中判定段的開始 / 結束這個距離內（像素）就是拖動那一端，否則是拖動時間軸 */
  EDGE_GRAB_PX: 10,
  /** 判定段色塊的透明度（選中的打擊點兩端另畫實心把手） */
  SEGMENT_ALPHA: 0.55,
  TIMELINE_BUTTON_HEIGHT: 30,
  TIMELINE_BUTTON_GAP: 6,
  ROW_HEIGHT: 38,
  SECTION_GAP: 10,
  BUTTON_HEIGHT: 38,
  DEPTH: 3000,
  BG_COLOR: 0x111827,
  BG_ALPHA: 0.92,
  BORDER_COLOR: 0x60a5fa,
  TAB_COLOR: 0x1f2937,
  TAB_SELECTED_COLOR: 0x1e3a8a,
  BAR_COLOR: 0x374151,
  MARKER_COLOR: 0xf59e0b,
  MARKER_SELECTED_COLOR: 0xfef08a,
  PLAYHEAD_COLOR: 0xffffff,
  TIMELINE_BUTTON_COLOR: 0x334155,
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

/** 角色身上的範圍顯示；招式分頁的色票同色 */
const OVERLAY = {
  DEPTH: 5,
  MOVES: {
    attack1: 0x38bdf8,
    attack2: 0x34d399,
    circle: 0xfb923c,
    line: 0xc084fc,
    burst: 0xf472b6,
    dash: 0xfde047,
    pierce: 0xf87171
  } as Readonly<Record<AttackMove, number>>,
  /** 時間軸目前這一格判定的打擊點 / 其他打擊點（淡）的填色與線框透明度 */
  ACTIVE_FILL: 0.25,
  ACTIVE_LINE: 0.95,
  IDLE_FILL: 0.05,
  IDLE_LINE: 0.35,
  LINE_WIDTH: 2,
  SELECTED_LINE_WIDTH: 4,
  TRIGGER: { color: 0xfacc15, line: 0.6 },
  /** 沒有木樁時，強化衝刺的範圍畫在角色前方這個距離（強化衝刺以撞擊點為基準） */
  DASH_PREVIEW_DISTANCE: 150,
  /** 判定那一刻該打擊點閃亮：填色透明度改成 FLASH_FILL，持續 FLASH_MS */
  FLASH_FILL: 0.5,
  FLASH_MS: 200
} as const;

/** 時間軸一格的長度（毫秒；每秒 30 格） */
const FRAME_MS = 1000 / 30;

/** 打擊點本身（不在判定範圍 shape 裡）的數值欄位 */
type PointLevelField = 'timeMs' | 'durationMs' | 'damagePct' | 'pauseMs';

/**
 * 欄位是否為打擊點本身的數值（否則是判定範圍 shape 的欄位）
 *
 * @param field 欄位
 */
function isPointLevelField(field: HitPointField): field is PointLevelField {
  return field === 'timeMs' || field === 'durationMs' || field === 'damagePct' || field === 'pauseMs';
}

/** 各形狀要顯示的尺寸欄位 */
const SHAPE_SIZE_FIELDS: Readonly<Record<HitShapeKind, ReadonlyArray<'radius' | 'arcDeg' | 'length' | 'width'>>> = {
  arc: ['radius', 'arcDeg'],
  circle: ['radius'],
  rect: ['length', 'width']
};

/** 有時間軸的招式對應的 P1 Spine 動作（動作鍵與同一鍵的第幾個） */
const MOVE_ANIMATIONS: Readonly<Record<TimedAttackMove, { key: PlayerAnimKey; index: number }>> = {
  attack1: { key: 'attack', index: 0 },
  attack2: { key: 'attack', index: 1 },
  circle: { key: 'comboCircle', index: 0 },
  line: { key: 'comboLine', index: 0 }
};

/** 招式判定事件的處理函式 */
type HitHandler = (c: Character, move: AttackMove, index: number) => void;

/** 編輯器需要的場景資訊 */
export interface AttackTuningEditorHost {
  /** P1（範圍畫在 P1 身上，方向依 P1 面向） */
  player(): Character;
  /** 木樁（近戰觸發圈加上它的半徑；強化衝刺的範圍畫在它身上）；沒有時為 null */
  dummy(): { x: number; y: number; radius: number } | null;
  /** P1 定格預覽（null = 結束預覽） */
  previewPose(preview: PlayerPosePreview | null): void;
  /** P1 某個動作的長度（毫秒） */
  animationMs(key: PlayerAnimKey, index: number): number;
}

/**
 * 木樁模式的範圍 / 判定編輯器（GameConfig.training.tuningEditorKey 開關）。畫面左側面板：
 *
 * - 上方招式分頁（普攻 1、普攻 2、招式1、招式2、爆發、強化衝刺、一般衝刺）
 * - 有時間軸的招式（普攻、招式1 / 2）：時間軸長度 = 該動作長度，點或拖動時間軸、按 ◀ ▶ 一格一格（1/30 秒）前後看，
 *   P1 定格在那一格的 Spine 姿勢；軸上的色塊是各打擊點的判定段（開始 ~ 結束，這段期間每幀判定、同一個目標每段只打一次），
 *   可在目前這一格「加打擊點」、刪除，把選中打擊點的判定段「設為開始 / 設為結束」，或直接拖動色塊的兩端。
 *   加 / 刪打擊點時，各打擊點的傷害自動平均分配（之後可個別調）
 * - 選中打擊點的參數：形狀（扇形 / 圓形 / 長方形）、判定中心往前 / 往上下偏移、該形狀的尺寸、傷害 %、頓點（打中怪時出招者停住多久）
 *   （systems/attackTuningParams，每次調整即時套用並存在瀏覽器）；爆發、強化衝刺、一般衝刺只有一個打擊點、沒有時間軸，
 *   一般衝刺只有傷害 % 與頓點（以衝刺判定半徑碰撞，沒有判定範圍）
 * - 最下面是普攻共用的近戰觸發距離與恢復預設、關閉
 *
 * 角色身上畫選中招式的打擊點：時間軸目前這一格判定的打擊點畫深色、其他畫淡色、選中的打擊點線框加粗；
 * P1 出招判定的那一刻，該打擊點閃亮一下。面板建在 UIScene（UIScene 疊在上面且有「點畫面 = 攻擊」），面板上的點擊都會攔下來
 */
export class AttackTuningEditor {
  private panel: Phaser.GameObjects.Container | null = null;
  private overlay: Phaser.GameObjects.Graphics | null = null;
  private readonly valueTexts = new Map<string, Phaser.GameObjects.Text>();
  /** 時間軸的動態元件（拖動時只更新它們，不重建面板） */
  private timeline: { label: Phaser.GameObjects.Text; markers: Phaser.GameObjects.Graphics; barX: number; barTop: number; barWidth: number } | null = null;
  /** 選中的招式、打擊點與時間軸目前時間（毫秒） */
  private selected: AttackMove = 'attack1';
  private selectedPoint = 0;
  private playheadMs = 0;
  /** 拖動中的東西：時間軸 / 選中判定段的開始 / 結束（none = 沒在拖動） */
  private dragMode: 'none' | 'scrub' | 'start' | 'end' = 'none';
  /** 各招打擊點閃亮到何時（場景時間；鍵 = 招式:索引） */
  private readonly flashUntil = new Map<string, number>();
  /** UIScene 上的拖動監聽（開啟時註冊、關閉時移除） */
  private uiInput: { scene: Phaser.Scene; move: (p: Phaser.Input.Pointer) => void; up: () => void } | null = null;

  /**
   * 建立編輯器並監聽招式判定事件（P1 判定時閃亮該打擊點；場景關閉時取消監聽並收掉面板）
   *
   * @param scene 遊戲場景（範圍畫在這裡）
   * @param host 場景資訊
   */
  constructor(private readonly scene: Phaser.Scene, private readonly host: AttackTuningEditorHost) {
    const onHit: HitHandler = (c, move, index) => {
      if (c === host.player()) this.flashUntil.set(`${move}:${index}`, scene.time.now + OVERLAY.FLASH_MS);
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

  /** 開 / 關面板（範圍顯示、定格預覽跟著面板） */
  toggle(): void {
    if (this.panel) this.close();
    else this.open();
  }

  /** 每幀：面板開啟時重畫選中招式的打擊點與近戰觸發圈 */
  update(): void {
    if (!this.overlay) return;
    const p = this.host.player();
    const g = this.overlay.clear();
    const now = this.scene.time.now;
    const color = OVERLAY.MOVES[this.selected];
    const anchor = this.anchorOf(this.selected, p);
    const timed = isTimedMove(this.selected);
    // 一般衝刺沒有判定範圍可畫（以衝刺判定半徑碰撞）
    if (hasHitShape(this.selected)) moveHitPoints(this.selected).forEach((point, index) => {
      const flashing = now < (this.flashUntil.get(`${this.selected}:${index}`) ?? 0);
      const active = !timed || (this.playheadMs >= point.timeMs - FRAME_MS / 2 && this.playheadMs <= point.timeMs + point.durationMs + FRAME_MS / 2);
      const fill = flashing ? OVERLAY.FLASH_FILL : active ? OVERLAY.ACTIVE_FILL : OVERLAY.IDLE_FILL;
      const lineWidth = index === this.selectedPoint ? OVERLAY.SELECTED_LINE_WIDTH : OVERLAY.LINE_WIDTH;
      g.fillStyle(color, fill).lineStyle(lineWidth, color, active || flashing ? OVERLAY.ACTIVE_LINE : OVERLAY.IDLE_LINE);
      drawHitShape(g, placeHitShape(point.shape, anchor.x, anchor.y, p.aimAngle));
    });
    g.lineStyle(OVERLAY.LINE_WIDTH, OVERLAY.TRIGGER.color, OVERLAY.TRIGGER.line)
      .strokeCircle(p.x, p.y, attackTuning().meleeEnemyRange + (this.host.dummy()?.radius ?? 0));
  }

  /**
   * 一招範圍的基準點：強化衝刺是撞擊點（畫在木樁身上；沒有木樁時畫在角色前方），其餘是角色
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

  /** 開啟面板、範圍顯示與定格預覽，並在 UIScene 註冊時間軸拖動 */
  private open(): void {
    const ui = this.scene.scene.get('UIScene');
    const move = (pointer: Phaser.Input.Pointer): void => { if (this.dragMode !== 'none') this.dragTo(pointer.x); };
    const up = (): void => { this.dragMode = 'none'; };
    ui.input.on(Phaser.Input.Events.POINTER_MOVE, move);
    ui.input.on(Phaser.Input.Events.POINTER_UP, up);
    this.uiInput = { scene: ui, move, up };
    this.overlay = this.scene.add.graphics().setDepth(OVERLAY.DEPTH);
    this.selectMove(this.selected);
  }

  /** 關閉面板、範圍顯示與定格預覽 */
  private close(): void {
    if (this.uiInput) {
      this.uiInput.scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.uiInput.move);
      this.uiInput.scene.input.off(Phaser.Input.Events.POINTER_UP, this.uiInput.up);
      this.uiInput = null;
    }
    this.dragMode = 'none';
    this.panel?.destroy();
    this.panel = null;
    this.timeline = null;
    this.overlay?.destroy();
    this.overlay = null;
    this.valueTexts.clear();
    this.host.previewPose(null);
  }

  /**
   * 選中一招：選第一個打擊點、時間軸跳到它的時間，重建面板
   *
   * @param move 招式
   */
  private selectMove(move: AttackMove): void {
    this.selected = move;
    this.selectPoint(0);
  }

  /**
   * 選中一個打擊點：時間軸跳到它判定段的開始，重建面板
   *
   * @param index 打擊點索引
   */
  private selectPoint(index: number): void {
    const points = moveHitPoints(this.selected);
    this.selectedPoint = Phaser.Math.Clamp(index, 0, points.length - 1);
    this.playheadMs = points[this.selectedPoint].timeMs;
    this.render();
    this.applyPreview();
  }

  /** 依時間軸更新 P1 定格預覽（沒有時間軸的招式結束預覽） */
  private applyPreview(): void {
    if (!isTimedMove(this.selected)) {
      this.host.previewPose(null);
      return;
    }
    const anim = MOVE_ANIMATIONS[this.selected];
    this.host.previewPose({ key: anim.key, index: anim.index, timeMs: this.playheadMs });
  }

  /** 選中招式的動作長度（毫秒；沒有時間軸的招式為 0） */
  private durationMs(): number {
    if (!isTimedMove(this.selected)) return 0;
    const anim = MOVE_ANIMATIONS[this.selected];
    return this.host.animationMs(anim.key, anim.index);
  }

  /**
   * 時間軸移到指定時間（夾在動作長度內、對齊到格），更新預覽與軸上的顯示
   *
   * @param ms 時間（毫秒）
   */
  private setPlayhead(ms: number): void {
    const frame = Math.round(Phaser.Math.Clamp(ms, 0, this.durationMs()) / FRAME_MS);
    this.playheadMs = Math.round(frame * FRAME_MS);
    this.applyPreview();
    this.refreshTimeline();
  }

  /**
   * 按下時間軸：按在選中判定段的開始 / 結束附近就拖動那一端（兩端重疊時，按在右邊拖結束、左邊拖開始），否則拖動時間軸
   *
   * @param screenX 指標的畫面 x
   */
  private beginDrag(screenX: number): void {
    if (!this.timeline) return;
    const point = moveHitPoints(this.selected)[this.selectedPoint];
    const x = screenX - LAYOUT.X;
    const startX = this.timeToBarX(point.timeMs), endX = this.timeToBarX(point.timeMs + point.durationMs);
    const nearStart = Math.abs(x - startX) <= LAYOUT.EDGE_GRAB_PX, nearEnd = Math.abs(x - endX) <= LAYOUT.EDGE_GRAB_PX;
    if (nearStart && nearEnd) this.dragMode = x >= endX ? 'end' : 'start';
    else this.dragMode = nearEnd ? 'end' : nearStart ? 'start' : 'scrub';
    this.dragTo(screenX);
  }

  /**
   * 拖動中：時間軸移到指標的位置；拖動判定段一端時，那一端跟著移到這一格
   *
   * @param screenX 指標的畫面 x
   */
  private dragTo(screenX: number): void {
    if (!this.timeline) return;
    const ratio = Phaser.Math.Clamp((screenX - LAYOUT.X - this.timeline.barX) / this.timeline.barWidth, 0, 1);
    this.setPlayhead(ratio * this.durationMs());
    if (this.dragMode === 'start') this.setSelectedEdge('start', this.playheadMs);
    else if (this.dragMode === 'end') this.setSelectedEdge('end', this.playheadMs);
  }

  /**
   * 時間在時間軸上的 x（相對面板）
   *
   * @param ms 時間（毫秒）
   */
  private timeToBarX(ms: number): number {
    if (!this.timeline) return 0;
    const duration = this.durationMs();
    return this.timeline.barX + (duration > 0 ? Phaser.Math.Clamp(ms / duration, 0, 1) : 0) * this.timeline.barWidth;
  }

  /**
   * 設定選中打擊點判定段的開始或結束（另一端不動；開始拉過結束時判定段縮成一格，結束拉到開始之前時開始跟著移過去），
   * 立即套用、存檔；重新排序後仍保持選中，只更新數值與時間軸（拖動中不重建面板）
   *
   * @param edge 開始 / 結束
   * @param ms 時間（毫秒）
   */
  private setSelectedEdge(edge: 'start' | 'end', ms: number): void {
    const points = moveHitPoints(this.selected).map((p) => ({ ...p, shape: { ...p.shape } }));
    const point = points[this.selectedPoint];
    const end = point.timeMs + point.durationMs;
    if (edge === 'start') {
      point.timeMs = clampHitPointField('timeMs', ms, point.timeMs);
      point.durationMs = clampHitPointField('durationMs', end - point.timeMs, 0);
    } else if (ms < point.timeMs) {
      point.timeMs = clampHitPointField('timeMs', ms, point.timeMs);
      point.durationMs = 0;
    } else {
      point.durationMs = clampHitPointField('durationMs', ms - point.timeMs, point.durationMs);
    }
    const sorted = setMoveHitPoints(this.selected, points);
    // 排序後找回同一個打擊點（JSON 比對整筆資料）
    const key = JSON.stringify(point);
    this.selectedPoint = Math.max(0, sorted.findIndex((p) => JSON.stringify(p) === key));
    this.refreshValues();
  }

  /** （重新）建立面板：招式分頁、時間軸、選中打擊點的參數、近戰觸發距離與底部按鈕；建在 UIScene */
  private render(): void {
    this.panel?.destroy();
    this.valueTexts.clear();
    this.timeline = null;
    const ui = this.scene.scene.get('UIScene');
    const panel = ui.add.container(LAYOUT.X, LAYOUT.Y).setDepth(LAYOUT.DEPTH);
    const background = ui.add.rectangle(0, 0, LAYOUT.WIDTH, 1, LAYOUT.BG_COLOR, LAYOUT.BG_ALPHA).setOrigin(0, 0).setStrokeStyle(2, LAYOUT.BORDER_COLOR);
    panel.add(background);
    panel.add(this.text(ui, LAYOUT.PADDING, LAYOUT.PADDING, '範圍 / 判定編輯器（P 開關）', LAYOUT.COLORS.TITLE, '20px'));
    let y = LAYOUT.TITLE_HEIGHT;
    y = this.renderTabs(ui, panel, y) + LAYOUT.SECTION_GAP;
    if (isTimedMove(this.selected)) y = this.renderTimeline(ui, panel, y) + LAYOUT.SECTION_GAP;
    const point = moveHitPoints(this.selected)[this.selectedPoint];
    for (const field of this.pointFields(point)) {
      this.addRow(ui, panel, y, field, () => this.pointValueText(field), (dir) => this.stepPoint(field, dir));
      y += LAYOUT.ROW_HEIGHT;
    }
    y += LAYOUT.SECTION_GAP;
    const def = MELEE_ENEMY_RANGE_DEF;
    this.addRow(ui, panel, y, 'meleeEnemyRange', () => `${attackTuning().meleeEnemyRange}${def.unit}`,
      (dir) => setMeleeEnemyRange(attackTuning().meleeEnemyRange + dir * def.step), def.label, def.hint);
    y += LAYOUT.ROW_HEIGHT + LAYOUT.SECTION_GAP;
    const buttonY = y + LAYOUT.BUTTON_HEIGHT / 2;
    const third = LAYOUT.WIDTH / 3;
    const bw = third - LAYOUT.PADDING;
    panel.add(this.button(ui, third / 2, buttonY, bw, LAYOUT.BUTTON_HEIGHT, '這招恢復預設', LAYOUT.COLORS.MOVE_RESET, () => {
      resetMoveHitPoints(this.selected);
      this.selectPoint(0);
    }));
    panel.add(this.button(ui, third * 1.5, buttonY, bw, LAYOUT.BUTTON_HEIGHT, '全部恢復預設', LAYOUT.COLORS.RESET, () => {
      resetAllAttackTuning();
      this.selectPoint(0);
    }));
    panel.add(this.button(ui, third * 2.5, buttonY, bw, LAYOUT.BUTTON_HEIGHT, '關閉', LAYOUT.COLORS.CLOSE, () => this.close()));
    // 背景高度依內容決定，再設成可點（攔下面板上的點擊）
    background.setSize(LAYOUT.WIDTH, y + LAYOUT.BUTTON_HEIGHT + LAYOUT.PADDING);
    this.blockClicks(background);
    this.panel = panel;
    this.refreshValues();
  }

  /**
   * 招式分頁
   *
   * @param ui 面板所在場景
   * @param panel 面板
   * @param y 上緣（相對面板）
   * @returns 下緣
   */
  private renderTabs(ui: Phaser.Scene, panel: Phaser.GameObjects.Container, y: number): number {
    const tabWidth = (LAYOUT.WIDTH - LAYOUT.PADDING * 2 - LAYOUT.TAB_GAP * (LAYOUT.TABS_PER_ROW - 1)) / LAYOUT.TABS_PER_ROW;
    ATTACK_MOVES.forEach(({ move, label }, i) => {
      const col = i % LAYOUT.TABS_PER_ROW, row = Math.floor(i / LAYOUT.TABS_PER_ROW);
      const tx = LAYOUT.PADDING + col * (tabWidth + LAYOUT.TAB_GAP), ty = y + row * (LAYOUT.TAB_HEIGHT + LAYOUT.TAB_GAP);
      const color = move === this.selected ? LAYOUT.TAB_SELECTED_COLOR : LAYOUT.TAB_COLOR;
      panel.add(this.blockClicks(ui.add.rectangle(tx, ty, tabWidth, LAYOUT.TAB_HEIGHT, color).setOrigin(0, 0)
        .setStrokeStyle(1, OVERLAY.MOVES[move]), () => this.selectMove(move)));
      panel.add(ui.add.rectangle(tx + 14, ty + LAYOUT.TAB_HEIGHT / 2, LAYOUT.SWATCH_SIZE, LAYOUT.SWATCH_SIZE, OVERLAY.MOVES[move]));
      panel.add(this.text(ui, tx + 28, ty + LAYOUT.TAB_HEIGHT / 2, label, LAYOUT.COLORS.TEXT, '15px').setOrigin(0, 0.5));
    });
    const rows = Math.ceil(ATTACK_MOVES.length / LAYOUT.TABS_PER_ROW);
    return y + rows * (LAYOUT.TAB_HEIGHT + LAYOUT.TAB_GAP);
  }

  /**
   * 時間軸：時間說明、可點 / 拖動的軸（標出打擊點與目前時間）、逐格與打擊點按鈕、打擊點選擇
   *
   * @param ui 面板所在場景
   * @param panel 面板
   * @param y 上緣（相對面板）
   * @returns 下緣
   */
  private renderTimeline(ui: Phaser.Scene, panel: Phaser.GameObjects.Container, y: number): number {
    const barX = LAYOUT.PADDING, barWidth = LAYOUT.WIDTH - LAYOUT.PADDING * 2;
    const label = this.text(ui, barX, y, '', LAYOUT.COLORS.TEXT, '14px');
    panel.add(label);
    y += LAYOUT.TIMELINE_LABEL_HEIGHT;
    const barTop = y;
    panel.add(this.blockClicks(ui.add.rectangle(barX, barTop, barWidth, LAYOUT.BAR_HEIGHT, LAYOUT.BAR_COLOR).setOrigin(0, 0),
      (pointer) => this.beginDrag(pointer.x)));
    const markers = ui.add.graphics();
    panel.add(markers);
    this.timeline = { label, markers, barX, barTop, barWidth };
    y += LAYOUT.BAR_HEIGHT + LAYOUT.TIMELINE_BUTTON_GAP;
    const buttons: Array<{ label: string; onClick: () => void }> = [
      { label: '◀ 格', onClick: () => this.setPlayhead(this.playheadMs - FRAME_MS) },
      { label: '格 ▶', onClick: () => this.setPlayhead(this.playheadMs + FRAME_MS) },
      { label: '加打擊點', onClick: () => this.addPoint() },
      { label: '刪除', onClick: () => this.removePoint() },
      { label: '設為開始', onClick: () => this.setSelectedEdge('start', this.playheadMs) },
      { label: '設為結束', onClick: () => this.setSelectedEdge('end', this.playheadMs) }
    ];
    const bw = (barWidth - LAYOUT.TIMELINE_BUTTON_GAP * (buttons.length - 1)) / buttons.length;
    buttons.forEach((b, i) => {
      const cx = barX + i * (bw + LAYOUT.TIMELINE_BUTTON_GAP) + bw / 2;
      panel.add(this.button(ui, cx, y + LAYOUT.TIMELINE_BUTTON_HEIGHT / 2, bw, LAYOUT.TIMELINE_BUTTON_HEIGHT, b.label, LAYOUT.TIMELINE_BUTTON_COLOR, b.onClick));
    });
    y += LAYOUT.TIMELINE_BUTTON_HEIGHT + LAYOUT.TIMELINE_BUTTON_GAP;
    this.addRow(ui, panel, y, 'point', () => this.pointSelectorText(),
      (dir) => this.selectPoint(this.selectedPoint + dir), '打擊點', '◀ ▶ 切換要調的打擊點');
    return y + LAYOUT.ROW_HEIGHT;
  }

  /** 更新時間軸：時間說明、各打擊點的判定段色塊（選中的較亮、兩端畫把手）與目前時間的直線 */
  private refreshTimeline(): void {
    if (!this.timeline) return;
    const { label, markers, barTop } = this.timeline;
    const duration = this.durationMs();
    const frames = Math.max(1, Math.round(duration / FRAME_MS));
    const frame = Math.round(this.playheadMs / FRAME_MS);
    label.setText(`時間軸 ${(this.playheadMs / 1000).toFixed(2)}s / ${(duration / 1000).toFixed(2)}s　第 ${frame} / ${frames} 格（點或拖動）`);
    const toX = (ms: number): number => this.timeToBarX(ms);
    const handle = LAYOUT.BAR_MARKER_WIDTH;
    markers.clear();
    moveHitPoints(this.selected).forEach((point, index) => {
      const selected = index === this.selectedPoint;
      const color = selected ? LAYOUT.MARKER_SELECTED_COLOR : LAYOUT.MARKER_COLOR;
      const startX = toX(point.timeMs), endX = toX(point.timeMs + point.durationMs);
      // 判定段色塊（一格時至少一個把手寬）
      markers.fillStyle(color, LAYOUT.SEGMENT_ALPHA).fillRect(startX - handle / 2, barTop, Math.max(endX - startX, 0) + handle, LAYOUT.BAR_HEIGHT);
      if (!selected) return;
      markers.fillStyle(color, 1).fillRect(startX - handle / 2, barTop, handle, LAYOUT.BAR_HEIGHT)
        .fillRect(endX - handle / 2, barTop, handle, LAYOUT.BAR_HEIGHT);
    });
    markers.fillStyle(LAYOUT.PLAYHEAD_COLOR, 1).fillRect(toX(this.playheadMs) - LAYOUT.PLAYHEAD_WIDTH / 2, barTop - LAYOUT.PLAYHEAD_OVERHANG,
      LAYOUT.PLAYHEAD_WIDTH, LAYOUT.BAR_HEIGHT + LAYOUT.PLAYHEAD_OVERHANG * 2);
  }

  /**
   * 選中打擊點要顯示的欄位：形狀、往前 / 往上下偏移、該形狀的尺寸（一般衝刺沒有）、傷害 %（有時間軸的招式與一般衝刺；
   * 判定時間由時間軸上的位置決定）、頓點
   *
   * @param point 打擊點
   */
  private pointFields(point: HitPoint): HitPointField[] {
    const fields: HitPointField[] = hasHitShape(this.selected)
      ? ['shape', 'offsetForward', 'offsetSide', ...SHAPE_SIZE_FIELDS[point.shape.kind]]
      : [];
    if (isTimedMove(this.selected) || this.selected === 'pierce') fields.push('damagePct');
    fields.push('pauseMs');
    return fields;
  }

  /** 打擊點選擇列的文字：第幾個 / 共幾個，以及它判定段的時間（一格時只顯示開始） */
  private pointSelectorText(): string {
    const points = moveHitPoints(this.selected);
    const point = points[this.selectedPoint];
    const sec = (ms: number): string => (ms / 1000).toFixed(2);
    const range = point.durationMs > 0 ? `${sec(point.timeMs)}~${sec(point.timeMs + point.durationMs)}s` : `${sec(point.timeMs)}s`;
    return `${this.selectedPoint + 1} / ${points.length}（${range}）`;
  }

  /**
   * 選中打擊點某欄位的顯示文字
   *
   * @param field 欄位
   */
  private pointValueText(field: HitPointField): string {
    const point = moveHitPoints(this.selected)[this.selectedPoint];
    if (field === 'shape') return HIT_SHAPE_LABELS[point.shape.kind];
    const value = isPointLevelField(field) ? point[field] : point.shape[field];
    return `${value}${HIT_POINT_FIELDS[field].unit}`;
  }

  /**
   * 調整選中打擊點的一個欄位一格並立即套用、存檔：形狀循環切換、其他欄位加減一格；換形狀後重建面板
   * （判定段的時間由時間軸設定，見 setSelectedEdge）
   *
   * @param field 欄位
   * @param dir −1 / +1
   */
  private stepPoint(field: HitPointField, dir: -1 | 1): void {
    const points = moveHitPoints(this.selected).map((p) => ({ ...p, shape: { ...p.shape } }));
    const point = points[this.selectedPoint];
    if (field === 'shape') {
      const count = HIT_SHAPE_KINDS.length;
      point.shape.kind = HIT_SHAPE_KINDS[(HIT_SHAPE_KINDS.indexOf(point.shape.kind) + dir + count) % count];
    } else if (isPointLevelField(field)) {
      point[field] = clampHitPointField(field, point[field] + dir * HIT_POINT_FIELDS[field].step, point[field]);
    } else {
      point.shape[field] = clampHitPointField(field, point.shape[field] + dir * HIT_POINT_FIELDS[field].step, point.shape[field]);
    }
    // 只依時間排序，改這些欄位不會換位置
    setMoveHitPoints(this.selected, points);
    if (field === 'shape') this.render();
  }

  /** 在時間軸目前這一格加一個打擊點（複製選中打擊點的範圍與判定段長度），傷害平均分配，選中新打擊點 */
  private addPoint(): void {
    const points = moveHitPoints(this.selected);
    if (points.length >= MAX_HIT_POINTS) return;
    const source = points[this.selectedPoint];
    const list = this.splitDamage([...points, { timeMs: this.playheadMs, durationMs: source.durationMs, damagePct: source.damagePct, pauseMs: source.pauseMs, shape: { ...source.shape } }]);
    const added = list[list.length - 1];
    const sorted = setMoveHitPoints(this.selected, list);
    const key = JSON.stringify(added);
    this.selectedPoint = Math.max(0, sorted.findIndex((p) => JSON.stringify(p) === key));
    this.render();
    this.applyPreview();
  }

  /** 刪除選中的打擊點（至少留一個），剩下的傷害平均分配 */
  private removePoint(): void {
    const points = moveHitPoints(this.selected);
    if (points.length <= 1) return;
    setMoveHitPoints(this.selected, this.splitDamage(points.filter((_, i) => i !== this.selectedPoint)));
    this.selectPoint(Math.min(this.selectedPoint, points.length - 2));
  }

  /**
   * 傷害平均分配（合計約 100%，例：3 個打擊點各 33%）
   *
   * @param points 打擊點
   */
  private splitDamage(points: ReadonlyArray<HitPoint>): HitPoint[] {
    const pct = Math.round(100 / points.length);
    return points.map((p) => ({ ...p, damagePct: pct, shape: { ...p.shape } }));
  }

  /**
   * 加一列參數：名稱、說明、數值與 − / +（形狀與打擊點選擇用 ◀ / ▶）；按下後重新整理所有數值
   *
   * @param ui 面板所在場景
   * @param panel 面板
   * @param y 列的上緣（相對面板）
   * @param id 列的識別（打擊點欄位用欄位名）
   * @param valueText 取得數值文字
   * @param onStep 按 − / + 時呼叫（−1 / +1）
   * @param label 名稱（打擊點欄位省略時取 HIT_POINT_FIELDS）
   * @param hint 說明（同上）
   */
  private addRow(
    ui: Phaser.Scene, panel: Phaser.GameObjects.Container, y: number, id: string,
    valueText: () => string, onStep: (dir: -1 | 1) => void, label?: string, hint?: string
  ): void {
    const fieldDef = id in HIT_POINT_FIELDS ? HIT_POINT_FIELDS[id as HitPointField] : null;
    const rowY = y + LAYOUT.ROW_HEIGHT / 2;
    panel.add(this.text(ui, LAYOUT.LABEL_X, rowY - 9, label ?? fieldDef?.label ?? id, LAYOUT.COLORS.TEXT, '15px'));
    const rowHint = hint ?? fieldDef?.hint ?? '';
    if (rowHint) panel.add(this.text(ui, LAYOUT.LABEL_X, rowY + 8, rowHint, LAYOUT.COLORS.HINT, '11px'));
    const value = this.text(ui, LAYOUT.VALUE_X, rowY, valueText(), LAYOUT.COLORS.VALUE, '16px').setOrigin(0.5);
    value.setData('valueText', valueText);
    this.valueTexts.set(id, value);
    panel.add(value);
    const arrows = id === 'shape' || id === 'point';
    panel.add(this.stepButton(ui, LAYOUT.MINUS_X, rowY, arrows ? '◀' : '−', () => { onStep(-1); this.refreshValues(); }));
    panel.add(this.stepButton(ui, LAYOUT.PLUS_X, rowY, arrows ? '▶' : '+', () => { onStep(1); this.refreshValues(); }));
  }

  /** 更新面板上的數值與時間軸 */
  private refreshValues(): void {
    for (const text of this.valueTexts.values()) {
      const valueText = text.getData('valueText') as (() => string) | undefined;
      if (valueText && text.active) text.setText(valueText());
    }
    this.refreshTimeline();
  }

  /**
   * 讓物件可點、並攔下點擊（不往下傳給 UIScene 的「點畫面 = 攻擊」）
   *
   * @param obj 物件
   * @param onClick 點擊時呼叫（可省略：只攔點擊）
   */
  private blockClicks<T extends Phaser.GameObjects.GameObject>(obj: T, onClick?: (pointer: Phaser.Input.Pointer) => void): T {
    obj.setInteractive().on('pointerdown', (pointer: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick?.(pointer);
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
   * 按鈕（底色方塊 + 文字）
   *
   * @param ui 面板所在場景
   * @param x 中心 x（相對面板）
   * @param y 中心 y（相對面板）
   * @param width 寬
   * @param height 高
   * @param label 文字
   * @param color 底色
   * @param onClick 點擊時呼叫
   */
  private button(
    ui: Phaser.Scene, x: number, y: number, width: number, height: number, label: string, color: number, onClick: () => void
  ): Phaser.GameObjects.Container {
    const bg = this.blockClicks(ui.add.rectangle(0, 0, width, height, color), onClick);
    const caption = this.text(ui, 0, 0, label, LAYOUT.COLORS.TEXT, '13px').setOrigin(0.5);
    return ui.add.container(x, y, [bg, caption]);
  }
}
