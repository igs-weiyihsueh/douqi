import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { createCoverImage } from '../systems/zoneScenery';
import type { GroundFootprint } from '../systems/bodySeparation';
import { visibleBottomOffset, visibleFootHalfWidth, warmFeetMetrics } from '../systems/spriteFeet';
import { OVERLAY_DEPTH_STEP } from '../systems/standingDepth';

/**
 * ArtStyleController 需要場景提供的能力。由 GameScene 建立並傳入。
 */
export interface ArtStyleHost {
  /** 擁有者場景 */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（切換一般怪外觀用） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** P1（皮膚與頭上覆蓋圖跟隨的對象） */
  player(): Character;
  /** 背景圖要蓋滿的世界矩形：關卡制為 [左, 中, 右] 三個 slot，經典模式為整個畫面 */
  backgroundRects(): Phaser.Geom.Rectangle[];
}

/** F4 場景背景圖（Scene.png）的紋理 key */
const SCENE_BG_TEXTURE_KEY = 'scene-background';
/** F2 強制重載 Scene.png 的路徑（會加 timestamp 防快取） */
const SCENE_BG_RELOAD_URL = 'assets/Scene.png';
/**
 * 深度層級：程式繪製的天空 / 遠景 / 外圍 / 地面為 -3 ~ 0，背景圖 0.5 蓋住程式繪製地面，
 * 圍欄（1）與場景粒子（2）疊在背景圖上；皮膚 15 高於角色本體（10），頭上覆蓋圖 20 再更高
 */
const SCENE_BG_DEPTH = 0.5;
const UI_OVERLAY_DEPTH = 20;
/** P1 皮膚紋理：一般 / 強化 */
export const SKIN_TEXTURE = 'character-goku-skin';
const SKIN_EMPOWERED_TEXTURE = 'character-goku-skin-2';
/** 原圖面向左的紋理（悟空皮膚）；其餘紋理視為面向右 */
const TEXTURES_FACING_LEFT: ReadonlySet<string> = new Set([SKIN_TEXTURE, SKIN_EMPOWERED_TEXTURE]);
/** P1 頭上覆蓋圖（1P 與積分），與頭上 UI 系統使用相同的垂直偏移 */
const UI_OVERLAY_TEXTURE = 'character-ui-overlay';
const UI_OVERLAY_OFFSET_Y = -130;
/** 一般怪的兩種外觀：新美術骷髏戰士 / 舊版紅色圓形 */
const NORMAL_ENEMY_LOOK = {
  skeleton: { texture: 'skeleton-warrior', scale: 1.0 },
  classic: { texture: 'enemy-normal', scale: 1.0 }
} as const;
/** 等待 UIScene 元件建立的重試次數與間隔 */
const UI_RETRY_MAX = 5;
const UI_RETRY_MS = 100;

/**
 * F4 新舊美術切換：
 * - 新美術：顯示 Scene.png 背景、P1 皮膚與頭上覆蓋圖、一般怪改骷髏戰士，並隱藏原 P1 頭頂 UI、改用 1P.png 底部面板
 * - 舊美術：還原程式繪製場景與原 UI
 *
 * 熱鍵：F4 = 全部切換、F6 = 只切背景、F2 = 強制重載 Scene.png
 */
export class ArtStyleController {
  /** 場景背景圖，關卡制為 [左, 中, 右] 三張 */
  private backgrounds: Phaser.GameObjects.Image[] = [];
  /** 目前是否為新美術 */
  private active = false;
  private skin: Phaser.GameObjects.Image | null = null;
  private uiOverlay: Phaser.GameObjects.Image | null = null;
  /** 一般怪是否用骷髏戰士外觀（與背景同時切換） */
  private skeletonEnemies = false;

  constructor(private readonly host: ArtStyleHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /** 建立背景圖並註冊 F4 / F6 / F2 熱鍵（slot 佈局建立後呼叫） */
  createBackgrounds(): void {
    this.buildBackgrounds();
    const keyboard = this.scene.input.keyboard;
    keyboard?.on('keydown-F4', () => {
      this.toggleBackground();
      this.toggleEnemyLook();
    });
    keyboard?.on('keydown-F6', () => this.toggleBackground());
    keyboard?.on('keydown-F2', () => this.reloadBackground());
  }

  /** 建立 P1 皮膚與頭上覆蓋圖（預設隱藏；P1 建立後呼叫） */
  createPlayerOverlays(): void {
    const p = this.host.player();
    const textures = this.scene.textures;
    // 新美術圖的腳底 / 腳寬開局就先量好，F4 切換與二段變身時不必當場量
    warmFeetMetrics(textures, [SKIN_TEXTURE, SKIN_EMPOWERED_TEXTURE, NORMAL_ENEMY_LOOK.skeleton.texture]);
    if (textures.exists(SKIN_TEXTURE)) {
      this.skin = this.scene.add.image(p.x, p.y, SKIN_TEXTURE).setDepth(p.depth + OVERLAY_DEPTH_STEP).setVisible(false);
    } else {
      console.warn(`⚠️ 皮膚資源不存在：${SKIN_TEXTURE}`);
    }
    if (!textures.exists(SKIN_EMPOWERED_TEXTURE)) console.warn(`⚠️ 強化皮膚資源不存在：${SKIN_EMPOWERED_TEXTURE}`);
    if (textures.exists(UI_OVERLAY_TEXTURE)) {
      this.uiOverlay = this.scene.add.image(p.x, p.y + UI_OVERLAY_OFFSET_Y, UI_OVERLAY_TEXTURE).setDepth(UI_OVERLAY_DEPTH).setVisible(false);
    } else {
      console.warn(`⚠️ 角色 UI 覆蓋資源不存在：${UI_OVERLAY_TEXTURE}`);
    }
  }

  /**
   * 每幀：皮膚與頭上覆蓋圖跟隨 P1，皮膚依 P1 是否強化切換紋理
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    const p = this.host.player();
    if (!p.alive) return;
    if (this.skin) {
      this.skin.setPosition(p.x, p.y);
      const target = p.isEmpowered(time) ? SKIN_EMPOWERED_TEXTURE : SKIN_TEXTURE;
      if (this.skin.texture.key !== target && this.scene.textures.exists(target)) this.skin.setTexture(target);
    }
    this.uiOverlay?.setPosition(p.x, p.y + UI_OVERLAY_OFFSET_Y);
  }

  /**
   * 依面向鏡像圖像：原圖面向與要的面向相反時 flipX
   *
   * @param img 角色 / 敵人 / 皮膚圖像
   * @param facingRight 要面向右
   */
  applyFacing(img: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite, facingRight: boolean): void {
    img.setFlipX(TEXTURES_FACING_LEFT.has(img.texture.key) === facingRight);
  }

  /** P1 皮膚疊在 P1 本體正上方、面向與 P1 相同（P1 的深度與面向每幀更新後呼叫） */
  syncSkinToPlayer(): void {
    if (!this.skin) return;
    const p = this.host.player();
    this.skin.setDepth(p.depth + OVERLAY_DEPTH_STEP);
    this.applyFacing(this.skin, p.facingRight);
  }

  /**
   * 世界往一側延伸時，把身後那張背景圖搬到前方新 slot（陣列順序維持 [左, 中, 右]）
   *
   * @param side 延伸方向
   * @param aheadSlot 前方新 slot
   */
  recycleBackground(side: 'L' | 'R', aheadSlot: Phaser.Geom.Rectangle): void {
    if (this.backgrounds.length !== 3) return;
    const [bgL, bgA, bgR] = this.backgrounds;
    const recycled = side === 'R' ? bgL : bgR;
    recycled.setPosition(aheadSlot.centerX, aheadSlot.centerY);
    this.backgrounds = side === 'R' ? [bgA, bgR, recycled] : [recycled, bgL, bgA];
  }

  /**
   * 角色腳底（目前顯示的圖像最下緣）離角色中心的垂直距離：P1 在新美術時以皮膚圖為準（強化皮膚較大，腳底也較低）
   *
   * @param c 角色
   */
  characterFootOffset(c: Character): number {
    const img = this.displayImageOf(c);
    return visibleBottomOffset(this.scene.textures, img.texture.key) * img.scaleY;
  }

  /**
   * 角色畫面上實際看到的圖像：P1 在新美術時是皮膚圖，其餘是角色本體
   *
   * @param c 角色
   */
  displayImageOf(c: Character): Phaser.GameObjects.Image | Phaser.GameObjects.Sprite {
    return c === this.host.player() && this.skin && this.skin.visible ? this.skin : c;
  }

  /**
   * 敵人在地面上的佔位橢圓（敵人間碰撞用）：只有 F4 新美術外觀的怪才有，依圖片腳寬自動計算；
   * 舊美術外觀回傳 null，沿用中心 + 身體半徑的圓
   *
   * @param e 敵人
   */
  enemyFootprint(e: Enemy): GroundFootprint | null {
    const key = e.texture.key;
    if (!this.skeletonEnemies || key !== NORMAL_ENEMY_LOOK.skeleton.texture) return null;
    const rx = visibleFootHalfWidth(this.scene.textures, key) * e.scaleX;
    return {
      footY: visibleBottomOffset(this.scene.textures, key) * e.scaleY,
      rx,
      ry: rx * GameConfig.enemySeparation.footprintFlatten
    };
  }

  /** 一般怪生成時應使用的外觀（Enemy.spawn 透過 GameScene 查詢） */
  normalEnemyLook(): { texture: string; scale: number } {
    return this.skeletonEnemies ? NORMAL_ENEMY_LOOK.skeleton : NORMAL_ENEMY_LOOK.classic;
  }

  /** 依目前顯示狀態建立背景圖；紋理不存在時不建立 */
  private buildBackgrounds(): void {
    if (!this.scene.textures.exists(SCENE_BG_TEXTURE_KEY)) {
      console.warn(`⚠️ 場景背景圖片不存在：${SCENE_BG_TEXTURE_KEY}`);
      return;
    }
    this.backgrounds = this.host.backgroundRects()
      .map((rect) => createCoverImage(this.scene, SCENE_BG_TEXTURE_KEY, rect, SCENE_BG_DEPTH, this.active));
  }

  /** 切換新舊背景與 P1 覆蓋 UI（F4 / F6） */
  private toggleBackground(): void {
    if (this.backgrounds.length === 0) this.buildBackgrounds(); // 紋理晚到時補建
    if (this.backgrounds.length === 0) {
      console.warn('⚠️ 場景背景圖片不可用，無法切換');
      return;
    }
    this.active = !this.active;
    for (const bg of this.backgrounds) bg.setVisible(this.active);
    this.skin?.setVisible(this.active);
    this.uiOverlay?.setVisible(this.active);
    // P1 改顯示新美術皮膚時，隱藏舊美術的名稱標籤 / 腳下條 / 「爆」標記（原本被舊的固定深度皮膚蓋住）
    this.host.player().setLegacyUiHidden(this.active && this.skin !== null);
    // 新美術改用覆蓋圖 UI → 隱藏原 P1 頭頂 UI、啟用底部面板替換；舊美術反之
    this.callUiWhenReady('setP1HeadUIVisible', (ui) => !!ui.overheadUIs?.has(0), !this.active);
    this.callUiWhenReady('setBottomPanelOverlay', (ui) => (ui.rows?.length ?? 0) > 0, this.active);
  }

  /** 切換一般怪外觀，並套用到場上現有的一般怪（F4） */
  private toggleEnemyLook(): void {
    this.skeletonEnemies = !this.skeletonEnemies;
    const look = this.normalEnemyLook();
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (e.enemyType === 'normal') e.setLook(look.texture, look.scale);
    }
  }

  /** 強制重載 Scene.png（F2）：移除舊紋理、加 timestamp 重新載入後重建背景圖（保留目前顯示狀態） */
  private reloadBackground(): void {
    for (const bg of this.backgrounds) bg.destroy();
    this.backgrounds = [];
    if (this.scene.textures.exists(SCENE_BG_TEXTURE_KEY)) this.scene.textures.remove(SCENE_BG_TEXTURE_KEY);
    this.scene.load.image(SCENE_BG_TEXTURE_KEY, `${SCENE_BG_RELOAD_URL}?t=${Date.now()}`);
    this.scene.load.once(Phaser.Loader.Events.COMPLETE, () => this.buildBackgrounds());
    this.scene.load.start();
  }

  /**
   * 呼叫 UIScene 的方法；對應的 UI 元件還沒建立時每 UI_RETRY_MS 重試，最多 UI_RETRY_MAX 次
   *
   * @param method UIScene 的方法名稱
   * @param isReady UI 元件是否已建立
   * @param value 傳給方法的參數
   * @param attempt 目前重試次數
   */
  private callUiWhenReady(method: string, isReady: (ui: UiSceneHandle) => boolean, value: boolean, attempt = 0): void {
    const ui = this.scene.scene.get('UIScene') as unknown as UiSceneHandle | null;
    const fn = ui?.[method];
    if (!ui || typeof fn !== 'function') {
      console.error(`❌ [F4 切換] UIScene.${method} 不存在`);
      return;
    }
    if (isReady(ui)) {
      fn.call(ui, value);
    } else if (attempt < UI_RETRY_MAX) {
      this.scene.time.delayedCall(UI_RETRY_MS, () => this.callUiWhenReady(method, isReady, value, attempt + 1));
    } else {
      console.error(`❌ [F4 切換] UIScene.${method} 重試次數已達上限`);
    }
  }
}

/** F4 切換用到的 UIScene 成員（UIScene 的這些成員為私有，這裡只描述執行期的形狀） */
interface UiSceneHandle {
  overheadUIs?: Map<number, unknown>;
  rows?: unknown[];
  [method: string]: unknown;
}
