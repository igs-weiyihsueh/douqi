import Phaser from 'phaser';
import { Skin, type SpineGameObject, type TrackEntry } from '@esotericsoftware/spine-phaser';
import { GameConfig } from '../config';
import { enemyWalkAnimSpeed, walkAnimScale } from '../systems/moveFeelParams';
import type { Enemy, EnemyType } from '../objects/Enemy';
import { visibleBottomOffset } from '../systems/spriteFeet';

/** 有 Spine 動畫的怪種 */
type SpineEnemyType = keyof typeof GameConfig.enemySpine.types & EnemyType;
/** 一個怪種的 Spine 設定 */
type SpineTypeConfig = (typeof GameConfig.enemySpine.types)[SpineEnemyType];
/** 設定裡的動畫鍵（anims / speeds 的鍵） */
type SpineAnimKey = keyof SpineTypeConfig['anims'];
/** 出手動畫判定：上一幀蓄力進度達到這個值、這一幀離開蓄力，視為出手（被打斷時進度不到） */
const ATTACK_FIRED_PROGRESS = 0.95;

/** 動畫狀態（決定播哪一段動畫） */
type SpineAnimState = 'idle' | 'move' | 'hit' | 'charge' | 'attack';

/** 一隻怪的 Spine 外觀：疊加 skins、套用播放速度、依面向翻轉、畫面外暫停 */
class EnemySpineDisplay {
  readonly object: SpineGameObject;

  /**
   * @param scene 場景
   * @param cfg 怪種設定（疊加 skins、縮放、動畫名稱與播放速度）
   */
  constructor(scene: Phaser.Scene, private readonly cfg: SpineTypeConfig) {
    const spine = scene.add.spine(0, 0, cfg.dataKey, cfg.atlasKey);
    const skin = new Skin(`${cfg.dataKey}-combined`);
    for (const name of cfg.skins) {
      const part = spine.skeleton.data.findSkin(name);
      if (part) skin.addSkin(part);
      else console.warn(`⚠️ Spine 素材 ${cfg.dataKey} 沒有 skin「${name}」`);
    }
    spine.skeleton.setSkin(skin);
    spine.skeleton.setSlotsToSetupPose();
    spine.animationStateData.defaultMix = GameConfig.enemySpine.mixMs / 1000;
    spine.setScale(cfg.scale);
    this.object = spine;
  }

  /**
   * 播放一段動畫（套用 speeds）
   *
   * @param key 動畫鍵
   * @param loop 是否重複播放
   * @param queued true = 排在目前動畫播完後接著播，false = 立即切換
   * @returns 實際播放時間（毫秒）
   */
  play(key: SpineAnimKey, loop: boolean, queued = false): number {
    const state = this.object.animationState;
    const entry: TrackEntry = queued
      ? state.addAnimation(0, this.cfg.anims[key], loop, 0)
      : state.setAnimation(0, this.cfg.anims[key], loop);
    entry.timeScale = this.cfg.speeds[key];
    return (entry.animation!.duration * 1000) / entry.timeScale;
  }

  /**
   * 跟隨：腳底位置、深度、透明度與面向；不在畫面內（含 cullMargin）時不更新動畫也不繪製
   *
   * @param x 腳底 x
   * @param footY 腳底 y
   * @param depth 深度
   * @param alpha 透明度
   * @param faceRight 是否面向右
   * @param onScreen 是否在畫面內
   */
  place(x: number, footY: number, depth: number, alpha: number, faceRight: boolean, onScreen: boolean): void {
    this.object.setActive(onScreen).setVisible(onScreen);
    if (!onScreen) return;
    this.object.setPosition(x, footY).setDepth(depth);
    this.setAlpha(alpha);
    this.object.skeleton.scaleX = faceRight === this.cfg.facesRight ? 1 : -1;
  }

  /**
   * 透明度：Spine 物件本身的 alpha 不會套用到繪製，要寫進骨架顏色
   *
   * @param alpha 透明度（0 ~ 1）
   */
  setAlpha(alpha: number): void {
    this.object.setAlpha(alpha);
    this.object.skeleton.color.a = alpha;
  }

  /**
   * 調整目前重複播放動畫的播放速度（走路依實際速度調整用）：設定的播放速度 × scale
   *
   * @param key 目前播放的動畫鍵
   * @param scale 倍率
   */
  setLoopScale(key: SpineAnimKey, scale: number): void {
    const entry = this.object.animationState.getCurrent(0);
    if (entry) entry.timeScale = this.cfg.speeds[key] * scale;
  }

  /**
   * 動畫暫停 / 繼續（時停）
   *
   * @param paused 是否暫停
   */
  setPaused(paused: boolean): void {
    this.object.animationState.timeScale = paused ? 0 : 1;
  }

  /** 啟用（從物件池取出時，從 idle 開始） */
  activate(): void {
    this.object.setActive(true).setVisible(true);
    this.setAlpha(1);
    this.object.animationState.clearTracks();
    this.object.skeleton.setToSetupPose();
    this.object.animationState.timeScale = 1;
    this.play('idle', true);
  }

  /** 停用（回收時） */
  deactivate(): void {
    this.object.setActive(false).setVisible(false);
  }
}

/** 一隻怪的 Spine 外觀與動畫狀態 */
interface EnemySpineView {
  display: EnemySpineDisplay;
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
  /** 平滑後的實際位移速度（像素/秒；被擊退中算 0） */
  speed: number;
  /** 目前是否在走（平滑速度超過門檻；時間沒前進的凍結幀維持上次結果） */
  moving: boolean;
}

/** 控制器需要的場景資訊 */
export interface EnemySpineHost {
  /** 目前是否用新美術（美術切換）：只有新美術才顯示 Spine 動畫 */
  artEnemies(): boolean;
  /** 時停中（動畫暫停） */
  isTimeStopped(): boolean;
}

/**
 * 怪物 Spine 外觀（GameConfig.enemySpine）：新美術時，有 Spine 素材的怪種（大怪、一般兵）隱藏原本的美術圖，
 * 改由一個 Spine 動畫物件跟著怪的位置、深度、面向與透明度（登場閃爍）顯示，並依怪的狀態切換動畫：
 * 被打（血量下降）播 hit、蓄力播 chargeIn → chargeLoop、蓄力完出手播 attack、移動中 move、其餘 idle；
 * 怪死亡時原地播 die 後淡出。畫面外（cullMargin 以外）的怪不更新動畫也不繪製，省效能。
 * 碰撞、腳底佔位與 AI 仍由原本的 Enemy 處理，這裡只管畫面
 */
export class EnemySpineController {
  /** 場上各怪的 Spine 外觀 */
  private readonly views = new Map<Enemy, EnemySpineView>();
  /** 回收待用的 Spine 外觀（依怪種） */
  private readonly pool = new Map<SpineEnemyType, EnemySpineDisplay[]>();

  /**
   * @param scene 場景
   * @param host 場景資訊
   */
  constructor(private readonly scene: Phaser.Scene, private readonly host: EnemySpineHost) {}

  /**
   * 預載 Spine 素材（BootScene.preload 呼叫；多個怪種共用同一份素材時只載一次）
   *
   * @param load 載入器
   */
  static preload(load: Phaser.Loader.LoaderPlugin): void {
    const loaded = new Set<string>();
    for (const type of EnemySpineController.spineTypes()) {
      const cfg = GameConfig.enemySpine.types[type];
      if (loaded.has(cfg.dataKey)) continue;
      loaded.add(cfg.dataKey);
      load.spineJson(cfg.dataKey, cfg.jsonUrl);
      load.spineAtlas(cfg.atlasKey, cfg.atlasUrl);
    }
  }

  /** 設定裡有 Spine 素材的怪種 */
  private static spineTypes(): SpineEnemyType[] {
    return Object.keys(GameConfig.enemySpine.types) as SpineEnemyType[];
  }

  /**
   * 每幀同步（站立物件的深度與面向更新後呼叫）：建立 / 回收 Spine 外觀、跟隨位置並切換動畫；死亡的怪播 die
   *
   * @param enemies 敵人群組
   * @param time 目前場景時間
   */
  sync(enemies: Phaser.GameObjects.Group, time: number): void {
    const art = this.host.artEnemies();
    const paused = this.host.isTimeStopped();
    const worldView = this.scene.cameras.main.worldView;
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
      this.follow(e, view, worldView);
      view.display.setPaused(paused);
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
    return e.enemyType in GameConfig.enemySpine.types ? (e.enemyType as SpineEnemyType) : null;
  }

  /**
   * 替怪掛上 Spine 外觀（優先用回收的），從 idle 開始
   *
   * @param e 敵人
   * @param type 怪種
   * @param time 目前場景時間
   */
  private attach(e: Enemy, type: SpineEnemyType, time: number): EnemySpineView {
    const display = this.pool.get(type)?.pop() ?? new EnemySpineDisplay(this.scene, GameConfig.enemySpine.types[type]);
    display.activate();
    const view: EnemySpineView = {
      display, type, state: 'idle', lastHp: e.hp, wasCharging: false, lastChargeProgress: 0, oneShotUntil: time,
      lastX: e.x, lastY: e.y, lastTime: time, speed: 0, moving: false
    };
    this.views.set(e, view);
    return view;
  }

  /**
   * Spine 外觀跟著怪：腳底對齊原美術圖腳底、深度相同、依面向左右翻轉、透明度相同（登場閃爍）；原美術圖隱藏。
   * 怪不在鏡頭畫面（外擴 cullMargin）內時 Spine 不更新也不繪製
   *
   * @param e 敵人
   * @param view Spine 外觀
   * @param worldView 鏡頭目前看到的世界範圍
   */
  private follow(e: Enemy, view: EnemySpineView, worldView: Phaser.Geom.Rectangle): void {
    const cfg = GameConfig.enemySpine.types[view.type];
    const margin = GameConfig.enemySpine.cullMargin;
    const onScreen = e.x >= worldView.left - margin && e.x <= worldView.right + margin
      && e.y >= worldView.top - margin && e.y <= worldView.bottom + margin;
    const footY = e.y + visibleBottomOffset(this.scene.textures, e.texture.key) * e.scaleY + cfg.offsetY;
    view.display.place(e.x, footY, e.depth, e.alpha, e.facingRight, onScreen);
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
    const charging = e.isCharging();
    const progress = e.chargeProgress(time);
    const fired = view.wasCharging && !charging && view.lastChargeProgress >= ATTACK_FIRED_PROGRESS;
    this.updateMoving(e, view, time);
    if (e.hp < view.lastHp) {
      this.playOnce(view, 'hit', time);
    } else if (fired) {
      this.playOnce(view, 'attack', time);
    } else if (charging) {
      if (view.state !== 'charge') {
        view.state = 'charge';
        view.display.play('chargeIn', false);
        view.display.play('chargeLoop', true, true);
      }
    } else if (time >= view.oneShotUntil || view.state === 'charge') {
      this.playLoop(view, view.moving ? 'move' : 'idle');
    }
    // 走路動畫依實際速度調整播放速度（基準速度見 moveFeel；沒有設定的怪種照原速）
    const baseSpeed = enemyWalkAnimSpeed(view.type);
    if (view.state === 'move' && baseSpeed !== null) view.display.setLoopScale('move', walkAnimScale(view.speed, baseSpeed));
    view.lastHp = e.hp;
    view.wasCharging = charging;
    view.lastChargeProgress = progress;
  }

  /**
   * 依實際位移判斷有沒有在走：AI 給了速度但被擋住走不動時算待機；被擊退往後滑（Enemy.isKnockedBack）不算走路
   * （否則會變成面向前方卻倒退走）；其餘只要有移動（含慢速巡邏、被擠開）就播走路，避免用待機姿勢平移。
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
    const speed = e.isKnockedBack(time) ? 0 : (Phaser.Math.Distance.Between(view.lastX, view.lastY, e.x, e.y) * 1000) / dt;
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
   * @param state 動畫狀態（也是動畫鍵）
   * @param time 目前場景時間
   */
  private playOnce(view: EnemySpineView, state: 'hit' | 'attack', time: number): void {
    view.state = state;
    view.oneShotUntil = time + view.display.play(state, false);
  }

  /**
   * 重複播放的動畫（idle / move）：狀態沒變就不重設
   *
   * @param view Spine 外觀
   * @param state 動畫狀態（也是動畫鍵）
   */
  private playLoop(view: EnemySpineView, state: 'idle' | 'move'): void {
    if (view.state === state) return;
    view.state = state;
    view.display.play(state, true);
  }

  /**
   * 收掉一隻怪的 Spine 外觀：死亡時原地播 die 再淡出，其餘（換區清場、切回舊美術）立即收起；收起的外觀回收待用。
   * 怪還在場上（切回舊美術）時恢復顯示原美術圖
   *
   * @param e 敵人
   * @param view Spine 外觀
   * @param playDeath 是否播死亡動畫
   */
  private release(e: Enemy, view: EnemySpineView, playDeath: boolean): void {
    this.views.delete(e);
    if (e.active && !e.dead) e.setVisible(true);
    const display = view.display;
    const recycle = (): void => {
      display.deactivate();
      const pool = this.pool.get(view.type) ?? [];
      pool.push(display);
      this.pool.set(view.type, pool);
    };
    if (!playDeath) {
      recycle();
      return;
    }
    display.setPaused(false);
    display.object.setActive(true).setVisible(true);
    const dieMs = display.play('die', false);
    this.scene.tweens.addCounter({
      from: 1, to: 0, delay: dieMs, duration: GameConfig.enemySpine.dieFadeMs,
      onUpdate: (tween) => display.setAlpha(tween.getValue() ?? 0),
      onComplete: recycle
    });
  }
}
