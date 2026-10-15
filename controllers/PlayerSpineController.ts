import Phaser from 'phaser';
import type { SpineGameObject, TrackEntry } from '@esotericsoftware/spine-phaser';
import { GameConfig } from '../config';
import type { Character, CharacterActionKind } from '../objects/Character';
import { visibleBottomOffset } from '../systems/spriteFeet';

/** 動畫鍵（GameConfig.playerSpine.anims / speeds 的鍵） */
type PlayerAnimKey = 'idle' | 'move' | 'attack' | 'comboCircle' | 'comboLine' | 'unique' | 'sprint' | 'hit';

/** 控制器需要的場景資訊 */
export interface PlayerSpineHost {
  /** P1 */
  player(): Character;
  /** P1 新美術皮膚圖（顯示中才有；沒有時不顯示 Spine） */
  shownPlayerSkin(): Phaser.GameObjects.Image | null;
  /** 時停中且 P1 被凍結（動畫暫停） */
  isPlayerFrozen(): boolean;
}

/**
 * P1 Spine 外觀（GameConfig.playerSpine）：皮膚圖顯示時把皮膚圖與 P1 本體都改成透明（皮膚圖仍留著給頭頂 UI、腳底量測用），
 * 改由 Spine 動畫物件跟著皮膚圖的位置、腳底、深度、面向與受擊閃爍顯示，並依 P1 狀態切換動畫：
 * 受擊硬直播 hit → 新出招（普攻兩段輪流 / 連段技 / 二段變身與爆發）播對應動作 → 衝刺中 sprint →
 * 單次動作播完前保持 → 移動中 move、其餘 idle。判定與手感不變，這裡只管畫面
 */
export class PlayerSpineController {
  private spine: SpineGameObject | null = null;
  /** 目前在播的動畫鍵 */
  private current: PlayerAnimKey | null = null;
  /** 單次動作播到何時（場景時間） */
  private oneShotUntil = 0;
  /** 已處理到的出招流水號 */
  private actionSeq = 0;
  /** P1 本體是否被 Spine 外觀藏起來（不顯示 Spine 時恢復） */
  private baseHidden = false;
  /** 上一幀是否在受擊硬直 */
  private wasHurt = false;
  /** 上一幀的位置與場景時間（用實際位移判斷有沒有在走） */
  private lastX = 0;
  private lastY = 0;
  private lastTime = 0;

  /**
   * @param scene 場景
   * @param host 場景資訊
   */
  constructor(private readonly scene: Phaser.Scene, private readonly host: PlayerSpineHost) {}

  /**
   * 預載 Spine 素材（BootScene.preload 呼叫）
   *
   * @param load 載入器
   */
  static preload(load: Phaser.Loader.LoaderPlugin): void {
    const cfg = GameConfig.playerSpine;
    load.spineJson(cfg.dataKey, cfg.jsonUrl);
    load.spineAtlas(cfg.atlasKey, cfg.atlasUrl);
  }

  /**
   * 每幀同步（P1 皮膚圖的深度與面向更新後呼叫）：皮膚圖顯示中才顯示 Spine，跟隨位置並切換動畫
   *
   * @param time 目前場景時間
   */
  sync(time: number): void {
    const skin = this.host.shownPlayerSkin();
    const p = this.host.player();
    if (!skin || !p.alive) {
      this.spine?.setVisible(false);
      this.current = null;
      if (this.baseHidden) {
        p.setAlpha(1);
        this.baseHidden = false;
      }
      return;
    }
    const spine = this.spine ?? this.create(p, time);
    const cfg = GameConfig.playerSpine;
    const footY = skin.y + visibleBottomOffset(this.scene.textures, skin.texture.key) * skin.scaleY + cfg.offsetY;
    spine.setVisible(true).setPosition(skin.x, footY).setDepth(skin.depth).setAlpha(skin.alpha);
    // Spine 物件本身的 alpha 不會套用到繪製，受擊閃爍要寫進骨架顏色
    spine.skeleton.color.a = skin.alpha;
    spine.animationState.timeScale = this.host.isPlayerFrozen() ? 0 : 1;
    skin.setAlpha(0);
    // P1 本體（程式繪製的圓形）藏起來：揮擊時本體會閃白（flashWhite），Spine 的姿勢露出空隙時會隱約看到
    p.setAlpha(0);
    this.baseHidden = true;
    this.updateAnimation(p, time);
    // 原檔朝背後出招的動作（mirroredAnims）播放時再翻一次，招式才會朝面向打出去
    const mirrored = this.current !== null && cfg.mirroredAnims.includes(this.current);
    spine.skeleton.scaleX = (p.facingRight === cfg.facesRight) !== mirrored ? 1 : -1;
  }

  /**
   * 建立 Spine 物件（第一次顯示時），從 idle 開始
   *
   * @param p P1
   * @param time 目前場景時間
   */
  private create(p: Character, time: number): SpineGameObject {
    const cfg = GameConfig.playerSpine;
    const spine = this.scene.add.spine(p.x, p.y, cfg.dataKey, cfg.atlasKey);
    spine.animationStateData.defaultMix = cfg.mixMs / 1000;
    spine.setScale(cfg.scale);
    this.spine = spine;
    this.actionSeq = p.lastAction.seq;
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastTime = time;
    return spine;
  }

  /**
   * 依 P1 狀態切換動畫：受擊 > 新出招 > 衝刺 > 播完前的單次動作 > 移動 / 待機（衝刺一結束就切回）
   *
   * @param p P1
   * @param time 目前場景時間
   */
  private updateAnimation(p: Character, time: number): void {
    const hurt = p.isHurtStunned(time);
    const dashing = p.isDashing;
    const moving = this.isMoving(p, time);
    const action = p.lastAction;
    if (hurt) {
      if (!this.wasHurt) this.playOnce('hit', time);
    } else if (action.seq !== this.actionSeq && action.kind !== 'none') {
      this.playOnce(action.kind, time);
    } else if (dashing) {
      this.playLoop('sprint');
    } else if (time >= this.oneShotUntil || this.current === 'sprint') {
      this.playLoop(moving ? 'move' : 'idle');
    }
    this.actionSeq = action.seq;
    this.wasHurt = hurt;
  }

  /**
   * 依實際位移判斷有沒有在走（被推動也算，P1 不會被擊退）
   *
   * @param p P1
   * @param time 目前場景時間
   */
  private isMoving(p: Character, time: number): boolean {
    const dt = time - this.lastTime;
    if (dt <= 0) return this.current === 'move';
    const speed = (Phaser.Math.Distance.Between(this.lastX, this.lastY, p.x, p.y) * 1000) / dt;
    this.lastX = p.x;
    this.lastY = p.y;
    this.lastTime = time;
    return speed > GameConfig.playerSpine.moveSpeedThreshold;
  }

  /**
   * 播一次的動作（受擊 / 出招）：從頭播，播完前不切回移動 / 待機；普攻依 P1 這一下的段數（Character.attackSegment）播第 1 / 2 段
   *
   * @param key 動畫鍵
   * @param time 目前場景時間
   */
  private playOnce(key: PlayerAnimKey | CharacterActionKind, time: number): void {
    const entry = this.play(key, false);
    this.oneShotUntil = time + (entry.animation!.duration * 1000) / entry.timeScale;
  }

  /**
   * 重複播放的動畫（待機 / 走路 / 衝刺中）：已經在播就不重設
   *
   * @param key 動畫鍵
   */
  private playLoop(key: 'idle' | 'move' | 'sprint'): void {
    if (this.current === key) return;
    this.play(key, true);
  }

  /**
   * 播放一段動畫並套用播放速度（GameConfig.playerSpine.speeds）
   *
   * @param key 動畫鍵
   * @param loop 是否重複播放
   */
  private play(key: PlayerAnimKey, loop: boolean): TrackEntry {
    const cfg = GameConfig.playerSpine;
    const names = cfg.anims[key];
    let name = names[0];
    if (key === 'attack') name = names[this.host.player().attackSegment % names.length];
    const entry = this.spine!.animationState.setAnimation(0, name, loop);
    entry.timeScale = cfg.speeds[key] ?? 1;
    this.current = key;
    return entry;
  }
}
