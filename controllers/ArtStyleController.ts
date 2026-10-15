import Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { createCoverImage } from '../systems/zoneScenery';
import type { GroundFootprint } from '../systems/bodySeparation';
import { visibleBottomOffset, visibleBounds, visibleFootHalfWidth, warmFeetMetrics, type EdgeMargins } from '../systems/spriteFeet';
import { OVERLAY_DEPTH_STEP } from '../systems/standingDepth';

/**
 * ArtStyleController 需要場景提供的能力。由 GameScene 建立並傳入。
 */
export interface ArtStyleHost {
  /** 擁有者場景 */
  readonly scene: Phaser.Scene;
  /** 敵人物件池（切換怪物外觀用） */
  enemies(): Phaser.Physics.Arcade.Group;
  /** P1（皮膚與頭上覆蓋圖跟隨的對象） */
  player(): Character;
  /** 背景圖要蓋滿的世界矩形：關卡制為 [左, 中, 右] 三個 slot，經典模式為整個畫面 */
  backgroundRects(): Phaser.Geom.Rectangle[];
}

/** 新美術場景背景圖（Scene.png）的紋理 key */
export const SCENE_BG_TEXTURE_KEY = 'scene-background';
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
/** 新美術怪物紋理：一般兵骷髏 / 肉怪骷髏戰士 / 遠程票券幽靈 */
const ENEMY_SKELETON_B_TEXTURE = 'enemy-skeleton-b';
const ENEMY_SKELETON_WARRIOR_TEXTURE = 'skeleton-warrior';
const ENEMY_TICKET_TEXTURE = 'enemy-ticket';
/** 原圖面向左的紋理（悟空皮膚）；其餘紋理（含三張怪物圖）視為面向右。另一側由 flipX 鏡像，不另存鏡像圖 */
const TEXTURES_FACING_LEFT: ReadonlySet<string> = new Set([SKIN_TEXTURE, SKIN_EMPOWERED_TEXTURE]);
/** P1 頭上覆蓋圖（1P 與積分），與頭上 UI 系統使用相同的位置基準（headAnchorY） */
const UI_OVERLAY_TEXTURE = 'character-ui-overlay';
/** 一般怪種的兩種外觀：新美術圖/ 舊版程式繪製圓形 */
const ENEMY_LOOKS = {
  normal: { art: { texture: ENEMY_SKELETON_B_TEXTURE, scale: 1.0 }, classic: { texture: 'enemy-normal', scale: 1.0 } },
  tank: { art: { texture: ENEMY_SKELETON_WARRIOR_TEXTURE, scale: 1.0 }, classic: { texture: 'enemy-tank', scale: 1.0 } },
  bomber: { art: { texture: ENEMY_TICKET_TEXTURE, scale: 1.0 }, classic: { texture: 'enemy-bomber', scale: 1.0 } }
} as const;
/** 有新美術外觀的怪種 */
type LookEnemyType = keyof typeof ENEMY_LOOKS;
/** 新美術怪物紋理（有地面佔位橢圓、開局先量腳底） */
const ENEMY_ART_TEXTURES: ReadonlySet<string> = new Set(Object.values(ENEMY_LOOKS).map((l) => l.art.texture));
/** 等待 UIScene 元件建立的重試次數與間隔 */
const UI_RETRY_MAX = 5;
const UI_RETRY_MS = 100;

/**
 * 新舊美術切換（開局預設依 GameConfig.artStyle.newArtByDefault）：
 * - 新美術：顯示 Scene.png 背景、P1 皮膚與頭上覆蓋圖、怪物改用美術圖（一般兵骷髏 / 肉怪骷髏戰士 / 遠程票券幽靈），並隱藏原 P1 頭頂 UI、改用 1P.png 底部面板
 * - 舊美術：還原程式繪製場景與原 UI
 *
 * 熱鍵：GameConfig.artStyle.toggleKey（V）= 全部切換、F6 = 只切背景、F2 = 強制重載 Scene.png
 */
export class ArtStyleController {
  /** 場景背景圖，關卡制為 [左, 中, 右] 三張 */
  private backgrounds: Phaser.GameObjects.Image[] = [];
  /** 目前是否為新美術 */
  private active = false;
  /** 場景背景暫時隱藏中（寶藏密室）：新美術開著也不顯示背景圖 */
  private backgroundSuppressed = false;
  private skin: Phaser.GameObjects.Image | null = null;
  private uiOverlay: Phaser.GameObjects.Image | null = null;
  /** 一般怪種是否用新美術外觀（與背景同時切換） */
  private artEnemies = false;
  /** P1 是否在場上顯示（尚未投幣進場時隱藏皮膚與頭上覆蓋圖） */
  private playerShown = true;

  constructor(private readonly host: ArtStyleHost) {}

  private get scene(): Phaser.Scene {
    return this.host.scene;
  }

  /** 建立背景圖並註冊美術切換（artStyle.toggleKey）/ F6 / F2 熱鍵（slot 佈局建立後呼叫） */
  createBackgrounds(): void {
    this.buildBackgrounds();
    const keyboard = this.scene.input.keyboard;
    keyboard?.on(`keydown-${GameConfig.artStyle.toggleKey}`, () => {
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
    // 新美術圖的腳底 / 腳寬開局就先量好，美術切換與二段變身時不必當場量
    warmFeetMetrics(textures, [SKIN_TEXTURE, SKIN_EMPOWERED_TEXTURE, ...ENEMY_ART_TEXTURES]);
    if (textures.exists(SKIN_TEXTURE)) {
      this.skin = this.scene.add.image(p.x, p.y, SKIN_TEXTURE).setDepth(p.depth + OVERLAY_DEPTH_STEP).setVisible(false);
    } else {
      console.warn(`⚠️ 皮膚資源不存在：${SKIN_TEXTURE}`);
    }
    if (!textures.exists(SKIN_EMPOWERED_TEXTURE)) console.warn(`⚠️ 強化皮膚資源不存在：${SKIN_EMPOWERED_TEXTURE}`);
    if (textures.exists(UI_OVERLAY_TEXTURE)) {
      this.uiOverlay = this.scene.add.image(p.x, p.y, UI_OVERLAY_TEXTURE).setOrigin(0.5, 1).setDepth(UI_OVERLAY_DEPTH).setVisible(false);
    } else {
      console.warn(`⚠️ 角色 UI 覆蓋資源不存在：${UI_OVERLAY_TEXTURE}`);
    }
  }

  /** 開局套用預設外觀：GameConfig.artStyle.newArtByDefault 時直接切到新美術（背景、P1 皮膚與 UI、怪物外觀；P1 皮膚與 UI 建立後呼叫） */
  applyDefaultLook(): void {
    if (!GameConfig.artStyle.newArtByDefault || this.active) return;
    this.toggleBackground();
    this.toggleEnemyLook();
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
    this.uiOverlay?.setPosition(p.x, this.headAnchorY(p, time));
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

  /** P1 皮膚疊在 P1 本體正上方、面向與 P1 相同、受擊閃爍跟著 P1（P1 的深度與面向每幀更新後呼叫） */
  syncSkinToPlayer(): void {
    if (!this.skin) return;
    const p = this.host.player();
    this.skin.setDepth(p.depth + OVERLAY_DEPTH_STEP).setAlpha(p.hurtBlinkAlpha(this.scene.time.now));
    this.applyFacing(this.skin, p.facingRight);
  }

  /** P1 新美術皮膚圖（顯示中才回傳；P1 Spine 外觀以它為位置、腳底與深度基準） */
  shownPlayerSkin(): Phaser.GameObjects.Image | null {
    return this.skin && this.skin.visible ? this.skin : null;
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
   * 頭頂 UI 的下緣位置（世界座標）：角色畫面上看到的圖像可見部分的最上緣，再往上 headUi.gap（強化中用二段的間距）。
   * P1 新美術時依目前顯示的皮膚（一段 / 二段圖高度不同），其餘角色依本體圖
   *
   * @param c 角色
   * @param time 目前場景時間（判斷是否強化中）
   */
  headAnchorY(c: Character, time: number): number {
    const img = this.displayImageOf(c);
    const top = visibleBounds(this.scene.textures, img.texture.key).top * img.scaleY;
    const gap = GameConfig.headUi.gap[c.isEmpowered(time) ? 'empowered' : 'normal'];
    return c.y + top - gap;
  }

  /**
   * 角色頭上覆蓋圖目前佔用的高度（P1 新美術覆蓋圖顯示中才有，其餘為 0）：頭上提示疊在它上方用
   *
   * @param c 角色
   */
  headOverlayHeight(c: Character): number {
    return c === this.host.player() && this.uiOverlay?.visible ? this.uiOverlay.displayHeight : 0;
  }

  /**
   * 角色位置離可活動範圍邊緣要留的距離：P1 顯示新美術皮膚時依皮膚圖的可見範圍
   * （左右 = 可見寬度的一半、下 = 腳底，上方維持 player.radius，頭超過上緣屬於透視），其餘角色回傳 null（用 player.radius）
   *
   * @param c 角色
   */
  edgeMargins(c: Character): EdgeMargins | null {
    const img = this.displayImageOf(c);
    if (img === c) return null;
    const b = visibleBounds(this.scene.textures, img.texture.key);
    const r = GameConfig.player.radius;
    // 皮膚會依面向鏡像，左右取較寬的一側
    const half = Math.max(-b.left, b.right) * Math.abs(img.scaleX);
    return { left: Math.max(r, half), right: Math.max(r, half), top: r, bottom: Math.max(r, b.bottom * img.scaleY) };
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
   * 敵人在地面上的佔位橢圓（敵人間碰撞用）：只有新美術外觀的怪才有，依圖片腳寬自動計算；
   * 舊美術外觀回傳 null，沿用中心 + 身體半徑的圓
   *
   * @param e 敵人
   */
  enemyFootprint(e: Enemy): GroundFootprint | null {
    const key = e.texture.key;
    if (!this.artEnemies || !ENEMY_ART_TEXTURES.has(key)) return null;
    const rx = visibleFootHalfWidth(this.scene.textures, key) * e.scaleX;
    return {
      footY: visibleBottomOffset(this.scene.textures, key) * e.scaleY,
      rx,
      ry: rx * GameConfig.enemySeparation.footprintFlatten
    };
  }

  /** 怪物目前是否用新美術外觀（Spine 動畫只在新美術時顯示） */
  enemyLookIsArt(): boolean {
    return this.artEnemies;
  }

  /**
   * 怪生成時應使用的外觀（Enemy.spawn 透過 GameScene 查詢）：一般兵 / 肉怪 / 遠程怪依美術切換用新美術圖或舊版圓形；
   * 其他怪種（BOSS、塔等）回傳 null，沿用 enemy-{type}
   *
   * @param type 怪種
   */
  enemyLook(type: string): { texture: string; scale: number } | null {
    const looks = ENEMY_LOOKS[type as LookEnemyType];
    if (!looks) return null;
    return this.artEnemies ? looks.art : looks.classic;
  }

  /** 依目前顯示狀態建立背景圖；紋理不存在時不建立 */
  private buildBackgrounds(): void {
    if (!this.scene.textures.exists(SCENE_BG_TEXTURE_KEY)) {
      console.warn(`⚠️ 場景背景圖片不存在：${SCENE_BG_TEXTURE_KEY}`);
      return;
    }
    this.backgrounds = this.host.backgroundRects()
      .map((rect) => createCoverImage(this.scene, SCENE_BG_TEXTURE_KEY, rect, SCENE_BG_DEPTH, this.active && !this.backgroundSuppressed));
  }

  /** 切換新舊背景與 P1 覆蓋 UI（美術切換 / F6） */
  private toggleBackground(): void {
    if (this.backgrounds.length === 0) this.buildBackgrounds(); // 紋理晚到時補建
    if (this.backgrounds.length === 0) {
      console.warn('⚠️ 場景背景圖片不可用，無法切換');
      return;
    }
    this.active = !this.active;
    this.applyBackgroundVisibility();
    this.skin?.setVisible(this.active && this.playerShown);
    this.uiOverlay?.setVisible(this.active && this.playerShown);
    // P1 改顯示新美術皮膚時，隱藏舊美術的名稱標籤 / 腳下條 / 「爆」標記（原本被舊的固定深度皮膚蓋住）
    this.host.player().setLegacyUiHidden(this.active && this.skin !== null);
    // 新美術改用覆蓋圖 UI → 隱藏原 P1 頭頂 UI、啟用底部面板替換；舊美術反之
    this.callUiWhenReady('setP1HeadUIVisible', (ui) => !!ui.overheadUIs?.has(0), !this.active);
    this.callUiWhenReady('setBottomPanelOverlay', (ui) => (ui.rows?.length ?? 0) > 0, this.active);
  }

  /**
   * 暫時隱藏 / 恢復場景背景圖（寶藏密室時隱藏；新舊美術的切換狀態不受影響）
   *
   * @param suppressed true = 隱藏
   */
  setBackgroundSuppressed(suppressed: boolean): void {
    this.backgroundSuppressed = suppressed;
    this.applyBackgroundVisibility();
  }

  /** 背景圖只在新美術開啟、且沒有被暫時隱藏時顯示 */
  private applyBackgroundVisibility(): void {
    for (const bg of this.backgrounds) bg.setVisible(this.active && !this.backgroundSuppressed);
  }

  /**
   * P1 是否在場上顯示：新美術時一併切換皮膚與頭上覆蓋圖（尚未投幣進場時隱藏）
   *
   * @param shown 是否顯示
   */
  setPlayerShown(shown: boolean): void {
    this.playerShown = shown;
    this.skin?.setVisible(this.active && shown);
    this.uiOverlay?.setVisible(this.active && shown);
  }

  /** 切換怪物外觀（新美術圖 / 舊版圓形），並套用到場上現有的一般兵、肉怪、遠程怪（美術切換） */
  private toggleEnemyLook(): void {
    this.artEnemies = !this.artEnemies;
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      const look = this.enemyLook(e.enemyType);
      if (look) e.setLook(look.texture, look.scale);
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
      console.error(`❌ [美術切換] UIScene.${method} 不存在`);
      return;
    }
    if (isReady(ui)) {
      fn.call(ui, value);
    } else if (attempt < UI_RETRY_MAX) {
      this.scene.time.delayedCall(UI_RETRY_MS, () => this.callUiWhenReady(method, isReady, value, attempt + 1));
    } else {
      console.error(`❌ [美術切換] UIScene.${method} 重試次數已達上限`);
    }
  }
}

/** 美術切換用到的 UIScene 成員（UIScene 的這些成員為私有，這裡只描述執行期的形狀） */
interface UiSceneHandle {
  overheadUIs?: Map<number, unknown>;
  rows?: unknown[];
  [method: string]: unknown;
}
