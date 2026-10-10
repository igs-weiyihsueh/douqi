import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Enemy } from '../objects/Enemy';
import { isRegularEnemy } from '../systems/enemyKinds';

/** 畫面外怪物箭頭的紋理（朝右繪製，依方向旋轉） */
const ARROW_TEXTURE_KEY = 'offscreen-enemy-arrow';

/** OffscreenEnemyIndicator 需要場景提供的能力 */
export interface OffscreenEnemyIndicatorHost {
  /** 敵人物件池 */
  enemies(): Phaser.GameObjects.Group;
  /** 目前是否要顯示（清場階段） */
  isActive(): boolean;
}

/** 一個方向的指示：箭頭 + 怪物圖示的容器 */
interface SectorMarker {
  group: Phaser.GameObjects.Container;
  arrow: Phaser.GameObjects.Image;
  /** 該方向最近那隻怪的圖示（放在箭頭的畫面內側） */
  icon: Phaser.GameObjects.Image;
  /** 本幀是否有怪（沒有就隱藏） */
  used: boolean;
  /** 剛從隱藏變成顯示（第一次直接放到位，不從舊位置滑過來） */
  fresh: boolean;
}

/**
 * 清場輔助：清場階段時，畫面外還活著的一般怪以畫面邊緣的箭頭指示方向。
 *
 * - 以畫面中心為原點把畫面外的怪依角度分成 sectors 個方向，每個方向一支箭頭（大小、光暈同 GO 指示），
 *   指向該方向離畫面中心最近的怪，箭頭內側放那隻怪的圖示（跟著怪的外觀，例如 F4 骷髏 / 舊美術圖）
 * - 箭頭放在「畫面中心 → 該怪」連線與畫面內縮邊框的交點上（避開上方 HUD 與下方面板），平滑移動、閃動發光
 * - 只是畫面提示，不影響任何判定
 */
export class OffscreenEnemyIndicator {
  private readonly markers: SectorMarker[] = [];

  constructor(private readonly scene: Phaser.Scene, private readonly host: OffscreenEnemyIndicatorHost) {}

  /**
   * 每幀更新：找出畫面外的怪、分方向、擺放箭頭；不在清場階段時全部隱藏
   *
   * @param delta 本幀毫秒
   */
  update(delta: number): void {
    for (const m of this.markers) m.used = false;
    if (this.host.isActive()) this.placeMarkers(delta);
    for (const m of this.markers) {
      if (!m.used && m.group.visible) {
        m.group.setVisible(false);
        m.fresh = true;
      }
    }
  }

  /** 依方向把畫面外的怪分組，每組更新一支箭頭 */
  private placeMarkers(delta: number): void {
    const cfg = GameConfig.stage.offscreenIndicator;
    const view = this.scene.cameras.main.worldView;
    const cx = view.centerX, cy = view.centerY;
    const sectorAngle = (Math.PI * 2) / cfg.sectors;
    // 每個方向：最近的怪
    const nearest: Array<{ enemy: Enemy; d2: number } | null> = new Array(cfg.sectors).fill(null);
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (!e.active || e.dead || e.telegraphing || !isRegularEnemy(e)) continue;
      const r = e.getBodyRadius() + cfg.viewMargin;
      if (e.x + r >= view.left && e.x - r <= view.right && e.y + r >= view.top && e.y - r <= view.bottom) continue; // 看得到
      const ang = Math.atan2(e.y - cy, e.x - cx);
      const s = ((Math.floor((ang + Math.PI + sectorAngle / 2) / sectorAngle) % cfg.sectors) + cfg.sectors) % cfg.sectors;
      const d2 = (e.x - cx) ** 2 + (e.y - cy) ** 2;
      const best = nearest[s];
      if (!best || d2 < best.d2) nearest[s] = { enemy: e, d2 };
    }
    const t = Math.min(1, delta / cfg.followMs);
    let used = 0;
    for (let s = 0; s < cfg.sectors; s++) {
      const best = nearest[s];
      if (!best) continue;
      const marker = this.markerAt(used++);
      marker.used = true;
      const ang = Math.atan2(best.enemy.y - cy, best.enemy.x - cx);
      const pos = this.edgePoint(view, ang);
      marker.arrow.setRotation(ang);
      this.updateIcon(marker.icon, best.enemy);
      // 怪物圖示放在箭頭的「畫面內側」，不會被推出畫面
      const iconOffset = cfg.arrowSize + cfg.arrowGlowSpread + cfg.iconGap + cfg.iconSize / 2;
      marker.icon.setPosition(-Math.cos(ang) * iconOffset, -Math.sin(ang) * iconOffset);
      if (marker.fresh || !marker.group.visible) {
        marker.group.setPosition(pos.x, pos.y).setVisible(true);
        marker.fresh = false;
      } else {
        marker.group.setPosition(marker.group.x + (pos.x - marker.group.x) * t, marker.group.y + (pos.y - marker.group.y) * t);
      }
    }
  }

  /**
   * 圖示換成這隻怪目前的外觀（紋理 / 面向），等比縮放到邊長 iconSize 以內
   *
   * @param icon 圖示
   * @param enemy 指向的怪
   */
  private updateIcon(icon: Phaser.GameObjects.Image, enemy: Enemy): void {
    const size = GameConfig.stage.offscreenIndicator.iconSize;
    if (icon.texture.key !== enemy.texture.key) icon.setTexture(enemy.texture.key);
    icon.setFlipX(enemy.flipX).setScale(size / Math.max(icon.frame.width, icon.frame.height));
  }

  /**
   * 「畫面中心 → 方向 ang」的射線與畫面內縮邊框（左右 edgeInset、上 edgeMinY、下 edgeBottomMargin）的交點
   *
   * @param view 鏡頭畫面（世界座標）
   * @param ang 方向（弧度）
   */
  private edgePoint(view: Phaser.Geom.Rectangle, ang: number): { x: number; y: number } {
    const cfg = GameConfig.stage.offscreenIndicator;
    const left = view.left + cfg.edgeInset, right = view.right - cfg.edgeInset;
    const top = view.top + cfg.edgeMinY, bottom = view.bottom - cfg.edgeBottomMargin;
    const cx = (left + right) / 2, cy = (top + bottom) / 2;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    // 沿射線到左右 / 上下邊的距離，取較近者
    const tx = dx > 0 ? (right - cx) / dx : dx < 0 ? (left - cx) / dx : Infinity;
    const ty = dy > 0 ? (bottom - cy) / dy : dy < 0 ? (top - cy) / dy : Infinity;
    const k = Math.min(tx, ty);
    return { x: cx + dx * k, y: cy + dy * k };
  }

  /**
   * 第 i 支箭頭（不存在就建立；建立後重複使用）
   *
   * @param i 箭頭序號
   */
  private markerAt(i: number): SectorMarker {
    const existing = this.markers[i];
    if (existing) return existing;
    const cfg = GameConfig.stage.offscreenIndicator;
    this.ensureArrowTexture();
    const arrow = this.scene.add.image(0, 0, ARROW_TEXTURE_KEY);
    const icon = this.scene.add.image(0, 0, '__DEFAULT');
    const group = this.scene.add.container(0, 0, [arrow, icon]).setDepth(cfg.depth).setVisible(false);
    this.scene.tweens.add({
      targets: group, alpha: { from: 1, to: cfg.blinkMinAlpha },
      duration: cfg.blinkMs, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
    const marker: SectorMarker = { group, arrow, icon, used: false, fresh: true };
    this.markers.push(marker);
    return marker;
  }

  /** 產生朝右的箭頭紋理（只產生一次）：實心三角形，外圍由大到小疊幾層半透明三角形做光暈（同 GO 指示的畫法） */
  private ensureArrowTexture(): void {
    if (this.scene.textures.exists(ARROW_TEXTURE_KEY)) return;
    const cfg = GameConfig.stage.offscreenIndicator;
    const s = cfg.arrowSize;
    const half = s + cfg.arrowGlowSpread;
    const g = this.scene.make.graphics({ x: 0, y: 0 }, false);
    const triangle = (k: number): void => {
      g.fillTriangle(half + k, half, half - k, half - k, half - k, half + k);
    };
    for (let i = cfg.arrowGlowLayers; i >= 1; i--) {
      g.fillStyle(cfg.arrowGlowColor, cfg.arrowGlowAlpha / cfg.arrowGlowLayers);
      triangle(s + (cfg.arrowGlowSpread * i) / cfg.arrowGlowLayers);
    }
    g.fillStyle(cfg.arrowColor, 1);
    triangle(s);
    g.generateTexture(ARROW_TEXTURE_KEY, half * 2, half * 2);
    g.destroy();
  }
}
