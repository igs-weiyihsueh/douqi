import Phaser from 'phaser';

/**
 * 攻擊判定形狀（純幾何）：每一招的判定範圍是扇形 / 圓形 / 長方形其中一種，判定中心可從基準點（角色或撞擊點）
 * 沿面向往前、往側邊偏移。側邊偏移以「面向右」為準設定，面向左時左右鏡像（例：設定往下 50，左右轉身都在腳邊下方），
 * 角色只有左右兩種畫面面向，鏡像後轉身時範圍不會上下跳。遊戲判定與範圍編輯器的顯示共用這裡的計算，畫出來的就是實際打得到的範圍。
 *
 * - 扇形：以判定中心為圓心、朝面向張開 arcDeg 度、半徑 radius
 * - 圓形：以判定中心為圓心、半徑 radius
 * - 長方形：從判定中心朝面向延伸 length、寬 width（左右各一半）
 */

/** 判定形狀種類 */
export type HitShapeKind = 'arc' | 'circle' | 'rect';

/** 形狀種類的順序（編輯器切換用；參數存的是索引） */
export const HIT_SHAPE_KINDS: ReadonlyArray<HitShapeKind> = ['arc', 'circle', 'rect'];

/** 形狀種類的顯示名稱 */
export const HIT_SHAPE_LABELS: Readonly<Record<HitShapeKind, string>> = { arc: '扇形', circle: '圓形', rect: '長方形' };

/** 一招的判定形狀設定（相對基準點與面向） */
export interface HitShape {
  kind: HitShapeKind;
  /** 判定中心沿面向往前（正）/ 往後（負）偏移 */
  offsetForward: number;
  /** 判定中心的側邊偏移：以面向右為準，正 = 畫面下方、負 = 畫面上方（面向左時鏡像，仍是同一邊） */
  offsetSide: number;
  /** 扇形 / 圓形的半徑 */
  radius: number;
  /** 扇形的張角（度） */
  arcDeg: number;
  /** 長方形的長度（沿面向）與寬度 */
  length: number;
  width: number;
}

/** 放到世界座標上的判定形狀 */
export interface PlacedHitShape {
  kind: HitShapeKind;
  /** 判定中心 */
  x: number;
  y: number;
  /** 面向（弧度） */
  dir: number;
  radius: number;
  /** 扇形半張角（弧度） */
  half: number;
  length: number;
  width: number;
}

/**
 * 把判定形狀放到世界座標：判定中心 = 基準點 + 沿面向的偏移；側邊偏移在面向偏左（cos < 0）時鏡像，
 * 讓左右轉身時側邊偏移維持在畫面同一側；sizeMult 只放大尺寸（不放大偏移）
 *
 * @param shape 形狀設定
 * @param ax 基準點 x（角色 / 撞擊點）
 * @param ay 基準點 y
 * @param dir 面向（弧度）
 * @param sizeMult 尺寸倍率（例：二段變身時普攻範圍加大）
 */
export function placeHitShape(shape: HitShape, ax: number, ay: number, dir: number, sizeMult = 1): PlacedHitShape {
  const cos = Math.cos(dir), sin = Math.sin(dir);
  const side = cos < 0 ? -shape.offsetSide : shape.offsetSide;
  return {
    kind: shape.kind,
    x: ax + cos * shape.offsetForward - sin * side,
    y: ay + sin * shape.offsetForward + cos * side,
    dir,
    radius: shape.radius * sizeMult,
    half: Phaser.Math.DegToRad(shape.arcDeg) / 2,
    length: shape.length * sizeMult,
    width: shape.width * sizeMult
  };
}

/**
 * 點是否在判定形狀內（敵人以中心點判定）
 *
 * @param p 放好的判定形狀
 * @param px 點 x
 * @param py 點 y
 */
export function hitShapeContains(p: PlacedHitShape, px: number, py: number): boolean {
  const dx = px - p.x, dy = py - p.y;
  if (p.kind === 'circle') return dx * dx + dy * dy <= p.radius * p.radius;
  if (p.kind === 'arc') {
    if (dx * dx + dy * dy > p.radius * p.radius) return false;
    return Math.abs(Phaser.Math.Angle.Wrap(Math.atan2(dy, dx) - p.dir)) <= p.half;
  }
  // 長方形：轉到面向座標系，沿面向 0 ~ length、側向 ±width / 2
  const along = dx * Math.cos(p.dir) + dy * Math.sin(p.dir);
  const across = -dx * Math.sin(p.dir) + dy * Math.cos(p.dir);
  return along >= 0 && along <= p.length && Math.abs(across) <= p.width / 2;
}

/**
 * 畫出判定形狀（呼叫端先設定 fillStyle / lineStyle）
 *
 * @param g 畫布
 * @param p 放好的判定形狀
 */
export function drawHitShape(g: Phaser.GameObjects.Graphics, p: PlacedHitShape): void {
  if (p.kind === 'circle') {
    g.fillCircle(p.x, p.y, p.radius).strokeCircle(p.x, p.y, p.radius);
    return;
  }
  if (p.kind === 'arc') {
    g.slice(p.x, p.y, p.radius, p.dir - p.half, p.dir + p.half, false).fillPath();
    g.beginPath().slice(p.x, p.y, p.radius, p.dir - p.half, p.dir + p.half, false).closePath().strokePath();
    return;
  }
  const cos = Math.cos(p.dir), sin = Math.sin(p.dir);
  const hw = p.width / 2;
  const corners = [
    new Phaser.Math.Vector2(p.x - sin * hw, p.y + cos * hw),
    new Phaser.Math.Vector2(p.x + sin * hw, p.y - cos * hw),
    new Phaser.Math.Vector2(p.x + cos * p.length + sin * hw, p.y + sin * p.length - cos * hw),
    new Phaser.Math.Vector2(p.x + cos * p.length - sin * hw, p.y + sin * p.length + cos * hw)
  ];
  g.fillPoints(corners, true).strokePoints(corners, true);
}
