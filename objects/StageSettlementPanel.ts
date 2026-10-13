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
  /** 各列的 y：P 位名牌 / 三項戰績（擊敗敵人、最高連擊、破壞物件，與 STAT_LABELS 同順序）/ 分數 / 名次 */
  HEADER_Y: -165,
  STAT_YS: [-85, -15, 55],
  SCORE_Y: 135,
  RANK_Y: 220,
  /** 戰績列名稱（與 SettlementColumn.values / points 同順序） */
  STAT_LABELS: ['擊敗敵人', '最高連擊', '破壞物件'],
  /** 數值出現時從 VALUE_POP_SCALE 彈回 */
  VALUE_POP_SCALE: 1.5,
  /** 計分演出：「+N」從該列數值往下飛進分數（飛行占這一步時長的 POINTS_FLY_RATIO），分數同時加上去 */
  POINTS_STYLE: { fontFamily: 'monospace', fontSize: '30px', fontStyle: 'bold', color: '#ffd54f', stroke: '#000000', strokeThickness: 5 },
  POINTS_FLY_RATIO: 0.6,
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
  /** 三項戰績：擊敗敵人、最高連擊、破壞物件（與 STAT_LABELS 同順序） */
  values: ReadonlyArray<number>;
  /** 三項戰績各自換算的分數（同順序；合計 = score） */
  points: ReadonlyArray<number>;
  score: number;
  /** 名次（1 起算；只有 playing 有意義） */
  rank: number;
}

/** 一欄的數值文字（只有參與結算的欄位有） */
interface ColumnTexts {
  /** 三項戰績的數值（同 STAT_LABELS 順序；揭曉前隱藏） */
  values: Phaser.GameObjects.Text[];
  score: Phaser.GameObjects.Text;
  rank: Phaser.GameObjects.Text;
  /** 計分演出目前已加到的分數 */
  scoreShown: number;
}

/**
 * 關卡結算面板（畫面固定）：左側項目名稱，右邊 4 欄 P 位，各列擊敗敵人 / 最高連擊 / 破壞物件 / 分數與名次。
 *
 * - open → revealStat（三項戰績由上而下逐列跳出）→ addPoints（逐列把換算分數飛進分數並加上去）
 *   → revealRanks（名次彈出、第 1 名欄位亮框）→ close
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
    cfg.STAT_LABELS.forEach((text, row) => this.add(scene.add.text(cfg.LABEL_X, cfg.STAT_YS[row], text, cfg.LABEL_STYLE).setOrigin(0.5)));
    this.add(scene.add.text(cfg.LABEL_X, cfg.SCORE_Y, '分數', cfg.LABEL_STYLE).setOrigin(0.5));
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
   * 揭曉第 row 列戰績：各欄數值出現並彈跳，從 0 跳到實際值
   *
   * @param row 戰績列索引（STAT_LABELS 順序）
   * @param ms 時長
   */
  revealStat(row: number, ms: number): void {
    const cfg = PANEL_CONFIG;
    this.texts.forEach((texts) => {
      const text = texts?.values[row];
      if (!text) return;
      text.setVisible(true).setScale(cfg.VALUE_POP_SCALE);
      this.scene.tweens.add({ targets: text, scale: 1, duration: ms, ease: 'Back.easeOut' });
    });
    this.countUp(ms, (t) => {
      this.columns.forEach((col, i) => this.texts[i]?.values[row].setText(`${Math.round(col.values[row] * t)}`));
    });
  }

  /**
   * 計分第 row 列：各欄「+N」從該列數值飛進分數，分數從目前值加到加上這一列後的值（0 分的列不飛）
   *
   * @param row 戰績列索引（STAT_LABELS 順序）
   * @param ms 時長
   */
  addPoints(row: number, ms: number): void {
    const cfg = PANEL_CONFIG;
    const from: number[] = [];
    this.columns.forEach((col, i) => {
      const texts = this.texts[i];
      if (!texts) return;
      from[i] = texts.scoreShown;
      texts.scoreShown += col.points[row];
      if (col.points[row] <= 0) return;
      const source = texts.values[row];
      const fly = this.scene.add.text(source.x, source.y, `+${col.points[row]}`, cfg.POINTS_STYLE).setOrigin(0.5);
      this.add(fly);
      this.scene.tweens.add({
        targets: fly, y: cfg.SCORE_Y, alpha: { from: 1, to: 0.2 }, duration: ms * cfg.POINTS_FLY_RATIO, ease: 'Quad.easeIn',
        onComplete: () => fly.destroy()
      });
    });
    this.countUp(ms, (t) => {
      this.columns.forEach((col, i) => {
        const texts = this.texts[i];
        if (texts) texts.score.setText(`${Math.round(from[i] + col.points[row] * t)}`);
      });
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
   * 建立一欄：底框、P 位名牌；參與結算的欄位建立數值文字（戰績與名次先隱藏、分數先顯示 0），否則整欄淡化並顯示狀態文字
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
    const rankColor = cfg.RANK_COLORS[Math.min(col.rank, cfg.RANK_COLORS.length) - 1];
    const texts: ColumnTexts = {
      values: cfg.STAT_YS.map((y) => scene.add.text(x, y, '0', cfg.VALUE_STYLE).setOrigin(0.5).setVisible(false)),
      score: scene.add.text(x, cfg.SCORE_Y, '0', cfg.SCORE_STYLE).setOrigin(0.5),
      rank: scene.add.text(x, cfg.RANK_Y, `第 ${col.rank} 名`, { ...cfg.RANK_STYLE, color: rankColor }).setOrigin(0.5).setVisible(false),
      scoreShown: 0
    };
    this.add([...texts.values, texts.score, texts.rank]);
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
