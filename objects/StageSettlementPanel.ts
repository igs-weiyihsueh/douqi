import Phaser from 'phaser';

/** 結算面板的排版與配色（座標相對面板中心） */
const PANEL_CONFIG = {
  /** 面板中心（畫面座標）與尺寸、底色、外框 */
  CENTER_X: 960,
  CENTER_Y: 500,
  WIDTH: 1300,
  HEIGHT: 620,
  RADIUS: 24,
  FILL: 0x120c24,
  FILL_ALPHA: 0.92,
  BORDER: 0xffc107,
  BORDER_WIDTH: 5,
  /** 標題 */
  TITLE_Y: -260,
  TITLE_STYLE: { fontFamily: 'monospace', fontSize: '44px', fontStyle: 'bold', color: '#ffd54f', stroke: '#000000', strokeThickness: 6 },
  /** 左側項目名稱欄的中心 x；玩家欄從 FIRST_COLUMN_X 開始，每欄間距 COLUMN_STEP、底框寬 COLUMN_WIDTH */
  LABEL_X: -530,
  FIRST_COLUMN_X: -300,
  COLUMN_STEP: 260,
  COLUMN_WIDTH: 240,
  /** 玩家欄底框：上下緣（相對面板中心）、圓角、底色；第 1 名的欄改用高亮外框 */
  COLUMN_TOP: -205,
  COLUMN_BOTTOM: 270,
  COLUMN_RADIUS: 14,
  COLUMN_FILL: 0xffffff,
  COLUMN_FILL_ALPHA: 0.06,
  TOP_RANK_BORDER: 0xffd54f,
  TOP_RANK_BORDER_WIDTH: 4,
  /** 各列的 y：P 位名牌 / 擊敗敵人 / 最高連擊 / 破壞物件 / 分數 / 名次 */
  HEADER_Y: -165,
  KILLS_Y: -85,
  MAX_COMBO_Y: -15,
  BREAKS_Y: 55,
  SCORE_Y: 135,
  RANK_Y: 220,
  /** P 位名牌（底色用該 P 位顏色） */
  HEADER_WIDTH: 120,
  HEADER_HEIGHT: 50,
  HEADER_RADIUS: 10,
  HEADER_STYLE: { fontFamily: 'monospace', fontSize: '32px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 5 },
  /** 項目名稱、數值、分數的字型 */
  LABEL_STYLE: { fontFamily: 'monospace', fontSize: '30px', fontStyle: 'bold', color: '#c9c3e6' },
  VALUE_STYLE: { fontFamily: 'monospace', fontSize: '34px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 4 },
  SCORE_STYLE: { fontFamily: 'monospace', fontSize: '44px', fontStyle: 'bold', color: '#ffe082', stroke: '#000000', strokeThickness: 6 },
  /** 沒在玩的欄位中央文字（等待投幣 / 未加入）與整欄透明度 */
  IDLE_Y: 40,
  IDLE_STYLE: { fontFamily: 'monospace', fontSize: '30px', fontStyle: 'bold', color: '#8a84a8' },
  IDLE_ALPHA: 0.6,
  /** 名次文字：第 1～3 名金 / 銀 / 銅，其餘灰；出現時從 RANK_POP_SCALE 彈回 */
  RANK_STYLE: { fontFamily: 'monospace', fontSize: '46px', fontStyle: 'bold', stroke: '#000000', strokeThickness: 7 },
  RANK_COLORS: ['#ffd54f', '#e0e6ee', '#e0965a', '#9e9e9e'],
  RANK_POP_SCALE: 1.8,
  /** 面板開 / 關的縮放起點 */
  OPEN_FROM_SCALE: 0.85
} as const;

/** 結算面板一欄（一個 P 位）的資料 */
export interface SettlementColumn {
  /** P 位名牌文字 */
  label: string;
  /** P 位顏色 */
  color: number;
  /** playing = 參與結算；waiting = 已加入但等待投幣；empty = 這個 P 位沒有人 */
  state: 'playing' | 'waiting' | 'empty';
  kills: number;
  maxCombo: number;
  breaks: number;
  score: number;
  /** 名次（1 起算；只有 playing 有意義） */
  rank: number;
}

/** 一欄的數值文字（只有參與結算的欄位有） */
interface ColumnTexts {
  kills: Phaser.GameObjects.Text;
  maxCombo: Phaser.GameObjects.Text;
  breaks: Phaser.GameObjects.Text;
  score: Phaser.GameObjects.Text;
  rank: Phaser.GameObjects.Text;
}

/**
 * 關卡結算面板（畫面固定）：左側項目名稱，右邊 4 欄 P 位，各列擊敗敵人 / 最高連擊 / 破壞物件 / 分數與名次。
 *
 * - open → countStats（三項數字一起跳動）→ countScores → revealRanks（名次彈出、第 1 名欄位亮框）→ close
 * - 沒在玩的 P 位整欄淡化，只顯示「等待投幣」或「未加入」
 */
export class StageSettlementPanel extends Phaser.GameObjects.Container {
  private readonly columns: ReadonlyArray<SettlementColumn>;
  /** 與 columns 同順序；不參與結算的欄位為 null */
  private readonly texts: Array<ColumnTexts | null> = [];
  private readonly topRankFrame: Phaser.GameObjects.Graphics;

  /**
   * @param scene 場景
   * @param title 標題文字
   * @param columns 各 P 位的資料（依 P 位順序）
   * @param depth 顯示深度
   */
  constructor(scene: Phaser.Scene, title: string, columns: ReadonlyArray<SettlementColumn>, depth: number) {
    const cfg = PANEL_CONFIG;
    super(scene, cfg.CENTER_X, cfg.CENTER_Y);
    this.columns = columns;
    this.setScrollFactor(0).setDepth(depth).setAlpha(0);
    const bg = scene.add.graphics()
      .fillStyle(cfg.FILL, cfg.FILL_ALPHA)
      .fillRoundedRect(-cfg.WIDTH / 2, -cfg.HEIGHT / 2, cfg.WIDTH, cfg.HEIGHT, cfg.RADIUS)
      .lineStyle(cfg.BORDER_WIDTH, cfg.BORDER, 1)
      .strokeRoundedRect(-cfg.WIDTH / 2, -cfg.HEIGHT / 2, cfg.WIDTH, cfg.HEIGHT, cfg.RADIUS);
    this.add([bg, scene.add.text(0, cfg.TITLE_Y, title, cfg.TITLE_STYLE).setOrigin(0.5)]);
    const rowLabels: Array<[string, number]> = [['擊敗敵人', cfg.KILLS_Y], ['最高連擊', cfg.MAX_COMBO_Y], ['破壞物件', cfg.BREAKS_Y], ['分數', cfg.SCORE_Y]];
    for (const [text, y] of rowLabels) this.add(scene.add.text(cfg.LABEL_X, y, text, cfg.LABEL_STYLE).setOrigin(0.5));
    columns.forEach((col, i) => this.texts.push(this.createColumn(col, cfg.FIRST_COLUMN_X + i * cfg.COLUMN_STEP)));
    this.topRankFrame = scene.add.graphics().setVisible(false);
    this.add(this.topRankFrame);
    scene.add.existing(this);
  }

  /**
   * 面板淡入並從略小彈到原尺寸
   *
   * @param ms 時長
   */
  open(ms: number): void {
    this.setScale(PANEL_CONFIG.OPEN_FROM_SCALE);
    this.scene.tweens.add({ targets: this, alpha: 1, scale: 1, duration: ms, ease: 'Back.easeOut' });
  }

  /**
   * 擊敗敵人 / 最高連擊 / 破壞物件三項數字從 0 一起跳到實際值
   *
   * @param ms 時長
   */
  countStats(ms: number): void {
    this.countUp(ms, (t) => {
      this.columns.forEach((col, i) => {
        const texts = this.texts[i];
        if (!texts) return;
        texts.kills.setText(`${Math.round(col.kills * t)}`);
        texts.maxCombo.setText(`${Math.round(col.maxCombo * t)}`);
        texts.breaks.setText(`${Math.round(col.breaks * t)}`);
      });
    });
  }

  /**
   * 分數從 0 跳到實際值
   *
   * @param ms 時長
   */
  countScores(ms: number): void {
    this.countUp(ms, (t) => {
      this.columns.forEach((col, i) => this.texts[i]?.score.setText(`${Math.round(col.score * t)}`));
    });
  }

  /**
   * 名次彈出，第 1 名的欄位加上高亮外框
   *
   * @param ms 彈出時長
   */
  revealRanks(ms: number): void {
    const cfg = PANEL_CONFIG;
    this.columns.forEach((col, i) => {
      const rank = this.texts[i]?.rank;
      if (!rank) return;
      rank.setVisible(true).setScale(cfg.RANK_POP_SCALE);
      this.scene.tweens.add({ targets: rank, scale: 1, duration: ms, ease: 'Back.easeOut' });
      if (col.rank === 1) {
        const x = cfg.FIRST_COLUMN_X + i * cfg.COLUMN_STEP;
        this.topRankFrame.lineStyle(cfg.TOP_RANK_BORDER_WIDTH, cfg.TOP_RANK_BORDER, 1)
          .strokeRoundedRect(x - cfg.COLUMN_WIDTH / 2, cfg.COLUMN_TOP, cfg.COLUMN_WIDTH, cfg.COLUMN_BOTTOM - cfg.COLUMN_TOP, cfg.COLUMN_RADIUS);
      }
    });
    this.topRankFrame.setVisible(true);
  }

  /**
   * 面板縮小淡出後銷毀
   *
   * @param ms 時長
   */
  close(ms: number): void {
    this.scene.tweens.add({
      targets: this, alpha: 0, scale: PANEL_CONFIG.OPEN_FROM_SCALE, duration: ms, ease: 'Quad.easeIn',
      onComplete: () => this.destroy()
    });
  }

  /**
   * 建立一欄：底框、P 位名牌；參與結算的欄位建立數值文字（先顯示 0，名次先隱藏），否則整欄淡化並顯示狀態文字
   *
   * @param col 這一欄的資料
   * @param x 欄中心 x
   * @returns 數值文字；不參與結算時為 null
   */
  private createColumn(col: SettlementColumn, x: number): ColumnTexts | null {
    const cfg = PANEL_CONFIG;
    const scene = this.scene;
    const box = scene.add.graphics()
      .fillStyle(cfg.COLUMN_FILL, cfg.COLUMN_FILL_ALPHA)
      .fillRoundedRect(x - cfg.COLUMN_WIDTH / 2, cfg.COLUMN_TOP, cfg.COLUMN_WIDTH, cfg.COLUMN_BOTTOM - cfg.COLUMN_TOP, cfg.COLUMN_RADIUS)
      .fillStyle(col.color, 1)
      .fillRoundedRect(x - cfg.HEADER_WIDTH / 2, cfg.HEADER_Y - cfg.HEADER_HEIGHT / 2, cfg.HEADER_WIDTH, cfg.HEADER_HEIGHT, cfg.HEADER_RADIUS);
    const header = scene.add.text(x, cfg.HEADER_Y, col.label, cfg.HEADER_STYLE).setOrigin(0.5);
    this.add([box, header]);
    if (col.state !== 'playing') {
      const idle = scene.add.text(x, cfg.IDLE_Y, col.state === 'waiting' ? '等待投幣' : '未加入', cfg.IDLE_STYLE).setOrigin(0.5);
      this.add(idle);
      for (const obj of [box, header, idle]) obj.setAlpha(cfg.IDLE_ALPHA);
      return null;
    }
    const value = (y: number, style: Phaser.Types.GameObjects.Text.TextStyle): Phaser.GameObjects.Text =>
      scene.add.text(x, y, '0', style).setOrigin(0.5);
    const rankColor = cfg.RANK_COLORS[Math.min(col.rank, cfg.RANK_COLORS.length) - 1];
    const texts: ColumnTexts = {
      kills: value(cfg.KILLS_Y, cfg.VALUE_STYLE),
      maxCombo: value(cfg.MAX_COMBO_Y, cfg.VALUE_STYLE),
      breaks: value(cfg.BREAKS_Y, cfg.VALUE_STYLE),
      score: value(cfg.SCORE_Y, cfg.SCORE_STYLE),
      rank: scene.add.text(x, cfg.RANK_Y, `第 ${col.rank} 名`, { ...cfg.RANK_STYLE, color: rankColor }).setOrigin(0.5).setVisible(false)
    };
    this.add([texts.kills, texts.maxCombo, texts.breaks, texts.score, texts.rank]);
    return texts;
  }

  /**
   * 數字跳動：ms 內 t 由 0 緩到 1，每次更新呼叫 apply
   *
   * @param ms 時長
   * @param apply 依進度 t（0 ~ 1）更新文字
   */
  private countUp(ms: number, apply: (t: number) => void): void {
    const counter = { t: 0 };
    this.scene.tweens.add({
      targets: counter, t: 1, duration: ms, ease: 'Quad.easeOut',
      onUpdate: () => apply(counter.t),
      onComplete: () => apply(1)
    });
  }
}
