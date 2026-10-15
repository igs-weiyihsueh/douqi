import Phaser from 'phaser';
import { Skin, type SpineGameObject } from '@esotericsoftware/spine-phaser';
import { GameConfig } from '../config';
import type { Enemy, EnemyType } from '../objects/Enemy';
import { visibleBottomOffset } from '../systems/spriteFeet';

/** 有 Spine 動畫的怪種 */
type SpineEnemyType = keyof typeof GameConfig.enemySpine & EnemyType;
/** 設定裡怪種以外的鍵 */
const NON_TYPE_KEYS: ReadonlySet<string> = new Set(['anims', 'moveSpeedThreshold', 'moveSmoothMs', 'mixMs', 'dieFadeMs']);
/** 出手動畫判定：上一幀蓄力進度達到這個值、這一幀離開蓄力，視為出手（被打斷時進度不到） */
const ATTACK_FIRED_PROGRESS = 0.95;

/** 動畫狀態（決定播哪一段動畫） */
type SpineAnimState = 'idle' | 'move' | 'hit' | 'charge' | 'attack';

/** 一隻怪的 Spine 外觀 */
interface EnemySpineView {
  spine: SpineGameObject;
  /** 怪種（回收到對應的物件池） */
  type: SpineEnemyType;
  /** 目前的動畫狀態 */
  state: SpineAnimState;
  /** 上一幀的血量（血量下降 = 被打） */
  lastHp: number;
  /** 上一幀是否蓄力中、蓄力進度（判斷出手） */
  wasCharging: boolean;
  lastChargeProgress: number;
  /** hit / attack 這種播一次的動畫播到何時（場景時間） */
  oneShotUntil: number;
  /** 上一幀的位置與場景時間（用實際位移判斷有沒有在走） */
  lastX: number;
  lastY: number;
  lastTime: number;
  /** 平滑後的實際位移速度（像素/秒） */
  speed: number;
  /** 目前是否在走（平滑速度超過門檻；時間沒前進的凍結幀維持上次結果） */
  moving: boolean;
}

/** 控制器需要的場景資訊 */
export interface EnemySpineHost {
  /** 目前是否用新美術（F4）：只有新美術才顯示 Spine 動畫 */
  artEnemies(): boolean;
  /** 時停中（動畫暫停） */
  isTimeStopped(): boolean;
}

/**
 * 怪物 Spine 外觀（GameConfig.enemySpine）：F4 新美術時，有 Spine 素材的怪種（目前為大怪）隱藏原本的美術圖，
 * 改由一個 Spine 動畫物件跟著怪的位置、深度、面向與透明度（登場閃爍）顯示，並依怪的狀態切換動畫：
 * 被打（血量下降）播 hit、蓄力播 chargeIn → chargeLoop、蓄力完出手播 attack、移動中 move、其餘 idle；
 * 怪死亡時原地播 die 後淡出。碰撞、腳底佔位與 AI 仍由原本的 Enemy 處理，這裡只管畫面
 */
export class EnemySpineController {
  /** 場上各怪的 Spine 外觀 */
  private readonly views = new Map<Enemy, EnemySpineView>();
  /** 回收待用的 Spine 物件（依怪種） */
  private readonly pool = new Map<SpineEnemyType, SpineGameObject[]>();

  /**
   * @param scene 場景
   * @param host 場景資訊
   */
  constructor(private readonly scene: Phaser.Scene, private readonly host: EnemySpineHost) {}

  /**
   * 預載 Spine 素材（BootScene.preload 呼叫）
   *
   * @param load 載入器
   */
  static preload(load: Phaser.Loader.LoaderPlugin): void {
    for (const type of EnemySpineController.spineTypes()) {
      const cfg = GameConfig.enemySpine[type];
      load.spineJson(cfg.dataKey, cfg.jsonUrl);
      load.spineAtlas(cfg.atlasKey, cfg.atlasUrl);
    }
  }

  /** 設定裡有 Spine 素材的怪種 */
  private static spineTypes(): SpineEnemyType[] {
    return Object.keys(GameConfig.enemySpine).filter((k) => !NON_TYPE_KEYS.has(k)) as SpineEnemyType[];
  }

  /**
   * 每幀同步（站立物件的深度與面向更新後呼叫）：建立 / 回收 Spine 外觀、跟隨位置並切換動畫；死亡的怪播 die
   *
   * @param enemies 敵人群組
   * @param time 目前場景時間
   */
  sync(enemies: Phaser.GameObjects.Group, time: number): void {
    const art = this.host.artEnemies();
    const timeScale = this.host.isTimeStopped() ? 0 : 1;
    for (const child of enemies.getChildren()) {
      const e = child as Enemy;
      const type = this.spineTypeOf(e);
      let view = this.views.get(e);
      if (!e.active || e.dead || !art || !type) {
        if (view) this.release(e, view, e.dead && art);
        continue;
      }
      if (view && view.type !== type) {
        this.release(e, view, false);
        view = undefined;
      }
      if (!view) view = this.attach(e, type, time);
      this.follow(e, view);
      view.spine.animationState.timeScale = timeScale;
      this.updateAnimation(e, view, time);
    }
    // 已不在群組裡的怪（被移除）
    for (const [e, view] of this.views) {
      if (!e.scene) this.release(e, view, false);
    }
  }

  /**
   * 怪的 Spine 怪種（沒有 Spine 素材時為 null）
   *
   * @param e 敵人
   */
  private spineTypeOf(e: Enemy): SpineEnemyType | null {
    return e.enemyType in GameConfig.enemySpine && !NON_TYPE_KEYS.has(e.enemyType) ? (e.enemyType as SpineEnemyType) : null;
  }

  /**
   * 替怪掛上 Spine 外觀（優先用回收的物件），從 idle 開始
   *
   * @param e 敵人
   * @param type 怪種
   * @param time 目前場景時間
   */
  private attach(e: Enemy, type: SpineEnemyType, time: number): EnemySpineView {
    const spine = this.pool.get(type)?.pop() ?? this.create(type);
    spine.setActive(true).setVisible(true).setAlpha(1);
    spine.animationState.clearTracks();
    spine.skeleton.setToSetupPose();
    spine.animationState.setAnimation(0, GameConfig.enemySpine.anims.idle, true);
    const view: EnemySpineView = {
      spine, type, state: 'idle', lastHp: e.hp, wasCharging: false, lastChargeProgress: 0, oneShotUntil: time,
      lastX: e.x, lastY: e.y, lastTime: time, speed: 0, moving: false
    };
    this.views.set(e, view);
    return view;
  }

  /**
   * 建立一個 Spine 物件：疊加設定的 skins 成一套外觀、設定動畫混合時間
   *
   * @param type 怪種
   */
  private create(type: SpineEnemyType): SpineGameObject {
    const cfg = GameConfig.enemySpine[type];
    const spine = this.scene.add.spine(0, 0, cfg.dataKey, cfg.atlasKey);
    const data = spine.skeleton.data;
    const skin = new Skin(`${type}-combined`);
    for (const name of cfg.skins) {
      const part = data.findSkin(name);
      if (part) skin.addSkin(part);
      else console.warn(`⚠️ Spine 素材 ${cfg.dataKey} 沒有 skin「${name}」`);
    }
    spine.skeleton.setSkin(skin);
    spine.skeleton.setSlotsToSetupPose();
    spine.animationStateData.defaultMix = GameConfig.enemySpine.mixMs / 1000;
    spine.setScale(cfg.scale);
    return spine;
  }

  /**
   * Spine 外觀跟著怪：腳底對齊原美術圖腳底、深度相同、依面向左右翻轉、透明度相同（登場閃爍）；原美術圖隱藏
   *
   * @param e 敵人
   * @param view Spine 外觀
   */
  private follow(e: Enemy, view: EnemySpineView): void {
    const cfg = GameConfig.enemySpine[view.type];
    const footY = e.y + visibleBottomOffset(this.scene.textures, e.texture.key) * e.scaleY + cfg.offsetY;
    view.spine.setPosition(e.x, footY).setDepth(e.depth).setAlpha(e.alpha);
    view.spine.skeleton.scaleX = e.facingRight === cfg.facesRight ? 1 : -1;
    e.setVisible(false);
  }

  /**
   * 依怪的狀態切換動畫：被打 > 出手 > 蓄力 > 播完前的單次動畫 > 移動 / 待機
   *
   * @param e 敵人
   * @param view Spine 外觀
   * @param time 目前場景時間
   */
  private updateAnimation(e: Enemy, view: EnemySpineView, time: number): void {
    const anims = GameConfig.enemySpine.anims;
    const charging = e.isCharging();
    const progress = e.chargeProgress(time);
    const fired = view.wasCharging && !charging && view.lastChargeProgress >= ATTACK_FIRED_PROGRESS;
    this.updateMoving(e, view, time);
    if (e.hp < view.lastHp) {
      this.playOnce(view, 'hit', anims.hit, time);
    } else if (fired) {
      this.playOnce(view, 'attack', anims.attack, time);
    } else if (charging) {
      if (view.state !== 'charge') {
        view.state = 'charge';
        view.spine.animationState.setAnimation(0, anims.chargeIn, false);
        view.spine.animationState.addAnimation(0, anims.chargeLoop, true, 0);
      }
    } else if (time >= view.oneShotUntil || view.state === 'charge') {
      this.playLoop(view, view.moving ? 'move' : 'idle', view.moving ? anims.move : anims.idle);
    }
    view.lastHp = e.hp;
    view.wasCharging = charging;
    view.lastChargeProgress = progress;
  }

  /**
   * 依實際位移判斷有沒有在走：AI 給了速度但被角色 / 其他怪擋住走不動時算待機（不用速度判斷）；
   * 速度以 moveSmoothMs 做指數平滑，單幀停頓或被推一下不會讓走路 / 待機來回切換
   *
   * @param e 敵人
   * @param view Spine 外觀
   * @param time 目前場景時間
   */
  private updateMoving(e: Enemy, view: EnemySpineView, time: number): void {
    const dt = time - view.lastTime;
    if (dt <= 0) return;
    const cfg = GameConfig.enemySpine;
    const speed = (Phaser.Math.Distance.Between(view.lastX, view.lastY, e.x, e.y) * 1000) / dt;
    view.speed += (speed - view.speed) * Math.min(1, dt / cfg.moveSmoothMs);
    view.moving = view.speed > cfg.moveSpeedThreshold;
    view.lastX = e.x;
    view.lastY = e.y;
    view.lastTime = time;
  }

  /**
   * 播一次的動畫（hit / attack）：從頭播，播完前不切回移動 / 待機
   *
   * @param view Spine 外觀
   * @param state 動畫狀態
   * @param anim 動畫名稱
   * @param time 目前場景時間
   */
  private playOnce(view: EnemySpineView, state: SpineAnimState, anim: string, time: number): void {
    view.state = state;
    const entry = view.spine.animationState.setAnimation(0, anim, false);
    view.oneShotUntil = time + entry.animation!.duration * 1000;
  }

  /**
   * 重複播放的動畫（idle / move）：狀態沒變就不重設
   *
   * @param view Spine 外觀
   * @param state 動畫狀態
   * @param anim 動畫名稱
   */
  private playLoop(view: EnemySpineView, state: SpineAnimState, anim: string): void {
    if (view.state === state) return;
    view.state = state;
    view.spine.animationState.setAnimation(0, anim, true);
  }

  /**
   * 收掉一隻怪的 Spine 外觀：死亡時原地播 die 再淡出，其餘（換區清場、切回舊美術）立即收起；收起的物件回收待用。
   * 怪還在場上（切回舊美術）時恢復顯示原美術圖
   *
   * @param e 敵人
   * @param view Spine 外觀
   * @param playDeath 是否播死亡動畫
   */
  private release(e: Enemy, view: EnemySpineView, playDeath: boolean): void {
    this.views.delete(e);
    if (e.active && !e.dead) e.setVisible(true);
    const spine = view.spine;
    const recycle = (): void => {
      spine.setActive(false).setVisible(false);
      const pool = this.pool.get(view.type) ?? [];
      pool.push(spine);
      this.pool.set(view.type, pool);
    };
    if (!playDeath) {
      recycle();
      return;
    }
    spine.animationState.timeScale = 1;
    const entry = spine.animationState.setAnimation(0, GameConfig.enemySpine.anims.die, false);
    this.scene.tweens.add({
      targets: spine, alpha: 0, delay: entry.animation!.duration * 1000, duration: GameConfig.enemySpine.dieFadeMs,
      onComplete: recycle
    });
  }
}
