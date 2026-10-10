import Phaser from 'phaser';
import { GameConfig } from '../config';
import { hitFeel } from '../systems/hitFeelParams';

/** BOSS 招式：a 範圍普攻 / b 直線衝刺 / c 扇形攻擊 */
export type BossSkillKind = 'a' | 'b' | 'c';

export type EnemyType = 'normal' | 'tank' | 'bomber' | 'boss' | 'tower' | 'npc' | 'treasure';

/**
 * 敵人：類型系統擴充。
 * - normal：近戰蓄力攻擊（原本）
 * - tank：高 HP 慢速肉盾（原本，行為同 normal）
 * - bomber：定點站立、瞄準玩家位置蓄力投擲炸彈，本體脆
 * 全部走 場內出生 + 登場提示(telegraph) 流程。
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  enemyType: EnemyType = 'normal';
  hp = 0;
  /** 擊殺原子性旗標——第一個致命命中設 true，防止同幀多角色重複計殺/掉落/kill() 重入 */
  dead = false;
  private maxHp = 0;
  private moveSpeed = 0;
  private bodyRadius = 0;
  /** 外觀基準縮放（依美術外觀設定；蓄力 / 出手 / 擊退打斷 / 死亡後都復原到這個值） */
  private baseScale = 1;

  /** 面向（弧度）：朝目標角色方向 */
  facing = 0;
  /** 畫面上的左右面向（依 facing 由 GameScene 每幀更新；只影響鏡像翻轉） */
  facingRight = true;

  // 寶箱怪:被命中次數(累積到 hitsToKill 死)、跑點狀態、出現時間戳(限時跑走用)。public 供 GameScene.updateTreasure 讀寫。
  treasureHits = 0;
  treasureSpawnAt = 0;
  treasurePauseUntil = 0;
  treasureMoveTX = 0;
  treasureMoveTY = 0;
  treasureFleeing = false;

  private knockbackUntil = 0;
  /**
   * 命中凍結（hitstop，只凍結被打的怪）：凍結開始時間與結束時間（0 = 未凍結）。
   * 凍結期間原地僵住、不跑 AI，擊退延到凍結結束才生效（見 applyKnockback / updateAI）
   */
  private hitFreezeStartAt = 0;
  private hitFreezeUntil = 0;
  /** 凍結結束後才施加的擊退（以最後一次命中為準） */
  private pendingKnockback: { angle: number; force: number } | null = null;
  /** 上一次凍結結束的時間（冷卻用） */
  private hitFreezeEndedAt = 0;

  telegraphing = false;
  private telegraphUntil = 0;
  private telegraphTween?: Phaser.Tweens.Tween;

  /**
   * 近戰狀態機（normal/tank 用）。
   * 新增 patrol(巡邏) / alert(=chase 追擊)；出生預設 patrol。
   */
  private aiState: 'patrol' | 'chase' | 'charge' | 'cooldown' = 'patrol';
  private chargeUntil = 0;
  private chargeStartAt = 0;
  private cooldownUntil = 0;
  private chargeTween?: Phaser.Tweens.Tween;

  /** 巡邏：出生點、當前漫步目標點、下次改點時間、脫離計時 */
  private homeX = 0;
  private homeY = 0;
  private patrolTargetX = 0;
  private patrolTargetY = 0;
  private nextRepathAt = 0;
  private outOfRangeSince = 0;

  /**
   * 黏著目標(階段1):綁定角色在 GameScene.characters 的 index(-1=未綁)。
   * 生成時綁最近角色,之後【黏著不亂換】(仿DouPo)——除非目標死/移除,或超出 stickyBreakRadius 持續 stickyBreakSec。
   * stickyOutOfRangeSince:目標超距的起始時間戳(0=未超距);達門檻才解鎖重綁,防抖。
   */
  targetSeat = -1;
  stickyOutOfRangeSince = 0;

  /**
   * 強制追擊(守護波事件怪用):true→updateMelee 跳過 patrol/alertRadius 判定,生成即直衝綁定目標,
   * 且不因 leash/loseRadius 回巡邏(一直咬住目標=NPC)。由 GameScene 生成守護波怪時設定。
   */
  forceChase = false;
  /** 不計本關擊殺數（二段變身即時補怪）：擊殺不推進關卡進度，也不佔本關配額；仍算在場上數量內（在場時一般補怪會等它們被清掉才補） */
  quotaExempt = false;
  /**
   * 主動仇恨:被玩家攻擊命中/鎖定過→true。主動怪不計入「單角色被動警戒上限」、永遠可追。
   * 被動怪(aggroActive=false 因 alertRadius 自己進 chase)才計入上限。
   */
  aggroActive = false;
  /**
   * 被動追擊封鎖(仇恨上限用):GameScene 每幀對「被動且該 seat 已達上限」的怪設 true→
   * updateMelee 的 patrol 不轉 chase(維持巡邏)。主動/forceChase 怪不會被設此旗標。
   */
  chaseBlocked = false;

  /**
   * leash 拴繩(難度微調):spawnX/spawnY=穩定的出生點(不像 homeX/Y 會被重設);
   * chase 時離出生點 > leashRadius → 放棄追、回走。leashRadius 由 GameScene 生成時指派(場上組=config、近身組=很大≈不套用)。
   */
  spawnX = 0;
  spawnY = 0;
  leashRadius = Infinity;
  /**
   * leash 第二條(累積移動路程):本次 chase 期間累積的移動路程;>leashTravelDist 也放棄(繞圈拉也拉不動)。
   * 進 chase 起算(reset 0),每幀加位移;脫繩/回 patrol/重進 chase 時歸零。leashTravelDist 由 GameScene 指派(近身組=大值)。
   */
  travelAccum = 0;
  leashTravelDist = Infinity;
  private lastChaseX = 0;
  private lastChaseY = 0;
  /**
   * 召集（config.enemyRally）截止時間：> 0 = 被召集去找身邊沒怪的玩家。召集期間不受活動範圍限制、不脫離追擊、
   * 不重綁目標；走進 arriveRadius（投擲怪：投擲射程）或時間到就結束，並以當下位置為新的出生點
   */
  rallyUntil = 0;

  /** bomber 投擲狀態機：idle → charging(鎖定玩家落點) → 投出後回 idle+冷卻 */
  private bombState: 'idle' | 'charging' = 'idle';
  private bombChargeStartAt = 0;
  private bombTargetX = 0;
  private bombTargetY = 0;
  private nextBombAt = 0;

  /** 回呼：近戰蓄力發動（normal/tank），由場景做範圍傷害判定 */
  onAttackFire?: (enemy: Enemy) => void;
  /** 回呼：bomber 投出炸彈到落點(tx,ty)，場景做飛行/預警/落地爆炸 */
  onBombThrow?: (enemy: Enemy, tx: number, ty: number) => void;
  /** BOSS 三招輪替回呼（場景實作預警/判定），tx/ty = 施放當下的目標位置（b / c 瞄準用） */
  onBossSkill?: (enemy: Enemy, kind: BossSkillKind, tx: number, ty: number) => void;

  /** 是否 BOSS */
  isBoss = false;
  /** 暫停 BOSS 自動輪替招式（除錯用，隔離單招測試） */
  bossSkillsPaused = false;
  /** BOSS 是否正在蓄力 / 施放招式（由場景設定）；期間不移動、不排下一招 */
  bossCasting = false;
  /** v37fix(A)：對守護 NPC 的接觸攻擊冷卻（每隻怪每 npcAttackCooldownMs 才扣一次 NPC 血，避免每幀扣） */
  nextNpcHitAt = 0;
  /** BOSS 攻擊輪替狀態 */
  private bossNextAttackAt = 0;
  private bossAttackIndex = 0;
  /** BOSS 直線衝刺結束時間；衝刺中維持衝刺速度 */
  private bossDashUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy-normal');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    (this.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(false);
    this.setDepth(5);
    this.initRuntimeFields();
  }

  /**
   * 建構時就把「之後才會被設定」的欄位都建立好（值與預設相同，畫面不變）：
   * 攻擊回呼、預告 tween，以及 Phaser 第一次設定才建立的縮放 / 透明度 / 染色 / 翻轉 / 旋轉欄位。
   * 讓每隻敵人從出生起物件結構一致，不論是物件池預先建好、還是出怪時才建立；
   * 否則一次預建大量物件時，JS 引擎會依「尚未有這些欄位」的結構定型，之後每隻怪的欄位存取都變慢
   */
  private initRuntimeFields(): void {
    this.onAttackFire = undefined;
    this.onBombThrow = undefined;
    this.onBossSkill = undefined;
    this.telegraphTween = undefined;
    this.chargeTween = undefined;
    this.setScale(1).setAlpha(1).clearTint().setFlipX(false).setRotation(0);
  }

  spawn(x: number, y: number, time: number, type: EnemyType, hpScale = 1): void {
    this.enemyType = type;
    this.isBoss = type === 'boss';
    if (this.isBoss) {
      // BOSS：stats 來自 GameConfig.boss；hpScale 這裡直接當「最終 HP 倍率」用（GameScene 傳入含 boss 序號成長）
      const b = GameConfig.boss;
      this.maxHp = Math.max(1, Math.round(b.baseHp * hpScale));
      this.moveSpeed = b.speed;
      this.bodyRadius = b.radius;
      this.bossNextAttackAt = time + b.skills.gapMs;
      this.bossAttackIndex = 0;
      this.bossCasting = false;
      this.bossDashUntil = 0;
    } else if (type === 'tower') {
      // 塔：stats 來自 GameConfig.event.tower；hpScale=最終 HP 倍率
      const tw = GameConfig.event.tower;
      this.maxHp = Math.max(1, Math.round(tw.baseHp * hpScale));
      this.moveSpeed = 0;
      this.bodyRadius = tw.radius;
    } else if (type === 'npc') {
      // 守護 NPC：stats 來自 GameConfig.event.guard
      const g = GameConfig.event.guard;
      this.maxHp = Math.max(1, Math.round(g.npcHp * hpScale));
      this.moveSpeed = 0;
      this.bodyRadius = g.radius;
    } else if (type === 'treasure') {
      // 寶箱怪:大 HP(改用命中次數死)、移動由跑點 AI(treasure.moveSpeed)、體型中等
      this.maxHp = 999999;
      this.moveSpeed = 0;
      this.bodyRadius = GameConfig.enemy.types.treasure.radius;
    } else {
      const t = GameConfig.enemy.types[type];
      this.maxHp = Math.max(1, Math.round(t.maxHp * hpScale));
      this.moveSpeed = t.speed;
      this.bodyRadius = t.radius;
    }

    // 設定紋理：根據GameScene的當前設定
    if (type === 'normal') {
      // 獲取GameScene的紋理配置
      const gameScene = this.scene as any; // GameScene
      if (gameScene.getNormalEnemyTextureConfig) {
        const config = gameScene.getNormalEnemyTextureConfig();
        this.setLook(config.texture, config.scale);
      } else {
        // 降級方案：使用骷髏戰士（預設）
        this.setLook('skeleton-warrior', 1);
      }
    } else {
      this.setLook(`enemy-${type}`, 1);
    }
    
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(this.bodyRadius, 2, 2);

    this.hp = this.maxHp;
    this.dead = false;
    this.knockbackUntil = 0;
    this.hitFreezeStartAt = 0;
    this.hitFreezeUntil = 0;
    this.pendingKnockback = null;
    this.hitFreezeEndedAt = 0;
    this.nextNpcHitAt = 0; // v37fix(A)
    // 出生預設巡邏，記住出生點；不再一出生就直衝玩家
    this.aiState = 'patrol';
    this.homeX = x;
    this.homeY = y;
    this.patrolTargetX = x;
    this.patrolTargetY = y;
    this.nextRepathAt = 0;
    this.outOfRangeSince = 0;
    this.targetSeat = -1;           // 黏著:生成時未綁,由 GameScene 生成後指派
    this.stickyOutOfRangeSince = 0;
    this.spawnX = x; this.spawnY = y; // leash:記穩定出生點(leashRadius 由 GameScene 生成後指派)
    this.leashRadius = Infinity;      // 預設不套用;GameScene 指派場上組=config、近身組=大值
    this.travelAccum = 0; this.leashTravelDist = Infinity; this.lastChaseX = x; this.lastChaseY = y; // leash 第二條:路程重置
    this.rallyUntil = 0;
    this.forceChase = false;   // 守護波怪由 GameScene 生成後指派;預設一般怪不強制追
    this.quotaExempt = false;  // 即時補怪由 SpawnController 生成後指派
    this.aggroActive = false;  // 主動仇恨:生成時未被玩家打過
    this.chaseBlocked = false; // 被動追擊封鎖:每幀由 GameScene 依上限重算
    this.chargeUntil = 0;
    this.chargeStartAt = 0;
    this.cooldownUntil = 0;
    this.bombState = 'idle';
    this.bombChargeStartAt = 0;
    this.nextBombAt = time + Phaser.Math.Between(400, 1400);
    this.facing = 0;
    this.facingRight = true;
    // 寶箱怪狀態重置
    this.treasureHits = 0;
    this.treasureSpawnAt = time;
    this.treasurePauseUntil = 0;
    this.treasureFleeing = false;
    this.treasureMoveTX = x;
    this.treasureMoveTY = y;
    this.setActive(true);
    this.setVisible(true);
    this.setScale(this.baseScale);
    this.clearTint();

    // 登場提示
    this.telegraphing = true;
    this.telegraphUntil = time + GameConfig.spawn.spawnTelegraphMs;
    body.setVelocity(0, 0);
    body.enable = false;
    this.setAlpha(0.25);
    this.telegraphTween?.remove();
    this.telegraphTween = this.scene.tweens.add({
      targets: this,
      alpha: { from: 0.2, to: 0.7 },
      duration: 130,
      yoyo: true,
      repeat: -1
    });
  }

  /**
   * 可否被「玩家」傷害：已現身且不是守護 NPC（NPC 只會被敵人直接扣血——守護事件本意）
   */
  isVulnerable(): boolean {
    return this.active && !this.telegraphing && this.enemyType !== 'npc';
  }

  /**
   * 每幀 AI
   *
   * @param targetX 目標 x
   * @param targetY 目標 y
   * @param time 目前場景時間
   * @param inEngageRange 近戰怪是否已到可蓄力的距離（慢速模式由場景依真空圈判斷）；省略時用與目標的距離 ≤ config.enemy.engageRange
   */
  updateAI(targetX: number, targetY: number, time: number, inEngageRange?: boolean): void {
    if (!this.active) return;
    // 塔/NPC：靜止物件，不跑 AI（行為由事件邏輯管）。寶箱怪：跑點 / 限時 / 計命中由寶箱怪控制器管，不跑一般 AI。
    if (this.enemyType === 'tower' || this.enemyType === 'npc' || this.enemyType === 'treasure') {
      if (this.enemyType !== 'treasure') (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      if (this.enemyType === 'treasure' && this.telegraphing && time >= this.telegraphUntil) this.materialize(); // 寶箱怪 telegraph 結束→實體化(可動可被打)
      return;
    }

    if (this.telegraphing) {
      if (time >= this.telegraphUntil) this.materialize();
      else return;
    }

    const body = this.body as Phaser.Physics.Arcade.Body;
    if (this.hitFreezeUntil > 0) {
      if (time < this.hitFreezeUntil) {
        body.setVelocity(0, 0);
        return;
      }
      this.endHitFreeze(time);
    }
    if (time < this.knockbackUntil) {
      body.velocity.scale(0.92);
      return;
    }

    switch (this.enemyType) {
      case 'bomber':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        this.updateBomber(targetX, targetY, time);
        break;
      case 'boss':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        this.updateBoss(targetX, targetY, time);
        break;
      default:
        // normal / tank：巡邏 / 警戒追擊 + 蓄力
        this.updateMelee(targetX, targetY, time, inEngageRange);
        break;
    }
  }

  // --- normal / tank：巡邏 / 警戒 / 蓄力---
  private updateMelee(targetX: number, targetY: number, time: number, inEngageRange: boolean | undefined): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const cfg = GameConfig.enemy.ai;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);

    switch (this.aiState) {
      case 'patrol': {
        // 出生點附近小範圍慢速漫步；角色進入警戒範圍才轉 chase
        // forceChase(守護波怪):無視 alertRadius,直接 chase 直衝目標。
        // chaseBlocked(被動仇恨已達該角色上限):維持 patrol、不轉 chase(主動/forceChase 怪不會被 block)。
        if (this.forceChase || (dist <= cfg.alertRadius && !this.chaseBlocked)) {
          this.aiState = 'chase';
          this.outOfRangeSince = 0;
          this.travelAccum = 0; this.lastChaseX = this.x; this.lastChaseY = this.y; // leash 第二條:進 chase 重置路程
          break;
        }
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, this.patrolTargetX, this.patrolTargetY);
        // 到點或到改點時間 → 在 home 附近選新漫步點
        const dToPatrol = Phaser.Math.Distance.Between(this.x, this.y, this.patrolTargetX, this.patrolTargetY);
        if (time >= this.nextRepathAt || dToPatrol <= 8) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.random() * cfg.patrolRadius;
          this.patrolTargetX = this.homeX + Math.cos(ang) * rad;
          this.patrolTargetY = this.homeY + Math.sin(ang) * rad;
          this.nextRepathAt = time + Phaser.Math.Between(cfg.patrolRepathMinMs, cfg.patrolRepathMaxMs);
        } else {
          body.setVelocity(Math.cos(this.facing) * cfg.patrolSpeed, Math.sin(this.facing) * cfg.patrolSpeed);
        }
        break;
      }
      case 'chase': {
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        if (this.rallyUntil > 0 && (time >= this.rallyUntil || dist <= GameConfig.enemyRally.arriveRadius)) this.endRally();
        const rallying = this.rallyUntil > 0;
        // leash 第二條:累積本次追擊移動路程(每幀加位移)。繞圈拉也會累積→拉不動。
        this.travelAccum += Phaser.Math.Distance.Between(this.x, this.y, this.lastChaseX, this.lastChaseY);
        this.lastChaseX = this.x; this.lastChaseY = this.y;
        // leash 拴繩(兩條並存,任一觸發就放棄回家):
        //   ① 直線:離【出生點】> leashRadius(防拉遠) ② 路程:travelAccum > leashTravelDist(防繞圈拉串)。
        //   (loseRadius 算離目標、leash 算離出生點/路程。近身組 leashRadius/leashTravelDist=大值≈不套用。)
        const distFromSpawn = Phaser.Math.Distance.Between(this.x, this.y, this.spawnX, this.spawnY);
        if (!this.forceChase && !rallying && (distFromSpawn > this.leashRadius || this.travelAccum > this.leashTravelDist)) {
          this.aiState = 'patrol';
          this.homeX = this.spawnX; // 回出生點附近巡邏(緩慢走回)
          this.homeY = this.spawnY;
          this.patrolTargetX = this.spawnX;
          this.patrolTargetY = this.spawnY;
          this.nextRepathAt = 0;
          this.outOfRangeSince = 0;
          this.travelAccum = 0; // 重置:下次重進 chase 重新算路程
          break;
        }
        // 脫離判定：目標超出 loseRadius 持續 loseGraceMs → 回巡邏(forceChase 怪不脫離,一直咬住)
        if (!this.forceChase && !rallying && dist > cfg.loseRadius) {
          if (this.outOfRangeSince === 0) this.outOfRangeSince = time;
          else if (time - this.outOfRangeSince >= cfg.loseGraceMs) {
            this.aiState = 'patrol';
            this.homeX = this.x; // 以當前位置為新巡邏中心
            this.homeY = this.y;
            this.nextRepathAt = 0;
            this.outOfRangeSince = 0;
            this.travelAccum = 0; // leash 第二條:回 patrol 重置路程
            break;
          }
        } else {
          this.outOfRangeSince = 0;
        }
        if (inEngageRange ?? dist <= GameConfig.enemy.engageRange) {
          this.beginCharge(time);
        } else {
          body.setVelocity(Math.cos(this.facing) * this.moveSpeed, Math.sin(this.facing) * this.moveSpeed);
        }
        break;
      }
      case 'charge':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        body.setVelocity(0, 0);
        if (time >= this.chargeUntil) this.fireAttack(time);
        break;
      case 'cooldown':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        if (time >= this.cooldownUntil) this.aiState = 'chase';
        else body.setVelocity(Math.cos(this.facing) * this.moveSpeed * 0.5, Math.sin(this.facing) * this.moveSpeed * 0.5);
        break;
    }
  }

  /**
   * 被召集去找指定座位的玩家：綁定該玩家、標為主動仇恨（不受被動追擊上限）、近戰怪巡邏中就直接轉追擊
   *
   * @param seat 目標座位
   * @param until 召集截止時間
   */
  startRally(seat: number, until: number): void {
    this.targetSeat = seat;
    this.stickyOutOfRangeSince = 0;
    this.aggroActive = true;
    this.chaseBlocked = false;
    this.rallyUntil = until;
    if (this.aiState === 'patrol') {
      this.aiState = 'chase';
      this.outOfRangeSince = 0;
    }
    this.travelAccum = 0; this.lastChaseX = this.x; this.lastChaseY = this.y;
  }

  /** 是否在召集中 */
  isRallying(): boolean {
    return this.rallyUntil > 0;
  }

  /** 結束召集：以當下位置為新的出生點（否則活動範圍會立刻把怪拉回原本的出生點） */
  endRally(): void {
    if (this.rallyUntil === 0) return;
    this.rallyUntil = 0;
    this.spawnX = this.x; this.spawnY = this.y;
    this.travelAccum = 0; this.lastChaseX = this.x; this.lastChaseY = this.y;
    this.outOfRangeSince = 0;
  }

  private beginCharge(time: number): void {
    this.aiState = 'charge';
    this.chargeStartAt = time;
    this.chargeUntil = time + GameConfig.enemy.chargeMs;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    // 蓄力預警只靠 GameScene 畫的「由內而外填滿」範圍圈；身體不染色
  }

  private fireAttack(time: number): void {
    this.chargeTween?.remove();
    this.chargeTween = undefined;
    this.setScale(this.baseScale);
    this.clearTint();
    this.onAttackFire?.(this);
    this.aiState = 'cooldown';
    this.cooldownUntil = time + GameConfig.enemy.attackCooldownMs;
  }

  isCharging(): boolean {
    return this.aiState === 'charge' && !this.telegraphing;
  }

  /** 蓄力進度 0→1（供 GameScene 畫由內而外填滿的預警圈） */
  chargeProgress(time: number): number {
    if (this.aiState !== 'charge') return 0;
    const span = GameConfig.enemy.chargeMs;
    return Phaser.Math.Clamp((time - this.chargeStartAt) / span, 0, 1);
  }

  /** 除錯：目前近戰 AI 狀態（patrol/chase/charge/cooldown） */
  getAiState(): string {
    return this.aiState;
  }

  // --- bomber：走位（或定點站立）+ 停下蓄力投擲炸彈到玩家落點---
  private updateBomber(targetX: number, targetY: number, time: number): void {
    const cfg = GameConfig.enemy.bomber;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);

    if (this.bombState === 'charging') {
      body.setVelocity(0, 0);
      const prog = Phaser.Math.Clamp((time - this.bombChargeStartAt) / cfg.bombChargeMs, 0, 1);
      if (prog >= 1) {
        this.onBombThrow?.(this, this.bombTargetX, this.bombTargetY);
        this.bombState = 'idle';
        this.nextBombAt = time + cfg.bombCooldownMs;
        this.clearTint();
      }
      return;
    }

    if (this.rallyUntil > 0 && (time >= this.rallyUntil || dist <= cfg.throwRange)) this.endRally();
    // 射程內且冷卻好 → 停下開始蓄力投擲（鎖定玩家「當下位置」當落點）；走位時太近（retreatRange 內）先退開不投
    const canThrow = dist <= cfg.throwRange && time >= this.nextBombAt && (!cfg.moveEnabled || dist >= cfg.retreatRange);
    if (cfg.moveEnabled && !canThrow) this.moveBomber(targetX, targetY, dist);
    else body.setVelocity(0, 0);
    if (canThrow) {
      this.bombState = 'charging';
      this.bombChargeStartAt = time;
      this.bombTargetX = targetX;
      this.bombTargetY = targetY;
      this.setTint(0xd08bff);
    }
  }

  /**
   * bomber 走位：離目標超過 throwRange 走近、小於 retreatRange 後退，其餘往 preferRange 靠（差距在 preferTolerance 內站定）；
   * 離出生點超過 leashRadius 時，不再往遠離出生點的方向走（站著等，射程內照樣投擲）
   *
   * @param targetX 目標 x
   * @param targetY 目標 y
   * @param dist 與目標的距離
   */
  private moveBomber(targetX: number, targetY: number, dist: number): void {
    const cfg = GameConfig.enemy.bomber;
    const body = this.body as Phaser.Physics.Arcade.Body;
    let dir = 0; // 1 = 走近、-1 = 後退、0 = 站定
    if (dist > cfg.throwRange) dir = 1;
    else if (dist < cfg.retreatRange) dir = -1;
    else if (Math.abs(dist - cfg.preferRange) > cfg.preferTolerance) dir = dist > cfg.preferRange ? 1 : -1;
    const ang = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
    const vx = Math.cos(ang) * this.moveSpeed * dir;
    const vy = Math.sin(ang) * this.moveSpeed * dir;
    // 活動範圍：已在範圍外且這一步會離出生點更遠 → 不走（召集中不受限）
    const ox = this.x - this.spawnX, oy = this.y - this.spawnY;
    const outsideLeash = this.rallyUntil === 0 && ox * ox + oy * oy > this.leashRadius * this.leashRadius;
    if (dir === 0 || (outsideLeash && ox * vx + oy * vy > 0)) body.setVelocity(0, 0);
    else body.setVelocity(vx, vy);
  }

  /** bomber 是否正在蓄力投擲（供 GameScene 畫落點預警） */
  isChargingBomb(): boolean {
    return this.enemyType === 'bomber' && this.bombState === 'charging' && !this.telegraphing;
  }

  /** bomber 投擲蓄力進度 0→1 */
  bombChargeProgress(time: number): number {
    if (this.bombState !== 'charging') return 0;
    return Phaser.Math.Clamp((time - this.bombChargeStartAt) / GameConfig.enemy.bomber.bombChargeMs, 0, 1);
  }

  /** bomber 目前鎖定的落點 */
  getBombTarget(): { x: number; y: number } {
    return { x: this.bombTargetX, y: this.bombTargetY };
  }

  /** 中斷投擲蓄力（被玩家命中時），需重新蓄力 */
  private interruptBomb(time: number): void {
    if (this.bombState === 'charging') {
      this.bombState = 'idle';
      this.nextBombAt = time + GameConfig.enemy.bomber.bombCooldownMs;
      if (this.active) this.clearTint();
    }
  }

  /**
   * BOSS：慢慢追目標（到 chaseStopDist 內停下），蓄力 / 施放期間站定，衝刺中維持衝刺速度；
   * 招式 a → b → c 輪替，觸發後暫停排程，由場景在該招放完後呼叫 scheduleBossNextAttack
   */
  private updateBoss(targetX: number, targetY: number, time: number): void {
    const b = GameConfig.boss;
    const body = this.body as Phaser.Physics.Arcade.Body;
    if (time < this.bossDashUntil) return; // 衝刺中：速度由 startBossDash 設定
    const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);
    if (this.bossCasting || dist <= b.chaseStopDist) {
      body.setVelocity(0, 0);
    } else {
      body.setVelocity(Math.cos(this.facing) * this.moveSpeed, Math.sin(this.facing) * this.moveSpeed);
    }
    if (!this.bossSkillsPaused && !this.bossCasting && time >= this.bossNextAttackAt) {
      const kinds: BossSkillKind[] = ['a', 'b', 'c'];
      const kind = kinds[this.bossAttackIndex % kinds.length];
      this.bossAttackIndex++;
      this.bossNextAttackAt = Number.MAX_SAFE_INTEGER;
      body.setVelocity(0, 0);
      this.onBossSkill?.(this, kind, targetX, targetY);
    }
  }

  /**
   * BOSS 直線衝刺：以固定速度朝 angle 方向移動 durationMs
   *
   * @param angle 衝刺方向（弧度）
   * @param speed 衝刺速度（像素 / 秒）
   * @param durationMs 衝刺時間
   * @param time 目前場景時間
   */
  startBossDash(angle: number, speed: number, durationMs: number, time: number): void {
    this.bossDashUntil = time + durationMs;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * speed, Math.sin(angle) * speed);
  }

  /** 由 GameScene 在招式釋放完後呼叫，重新排程下一招（gap 從釋放完起算） */
  scheduleBossNextAttack(atTime: number): void {
    this.bossNextAttackAt = atTime;
  }

  /** BOSS 血量比例（供 HUD 血條） */
  hpRatio(): number {
    return this.maxHp > 0 ? Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1) : 0;
  }

  private materialize(): void {
    this.telegraphing = false;
    this.telegraphTween?.remove();
    this.telegraphTween = undefined;
    this.setAlpha(1);
    this.clearTint();
    (this.body as Phaser.Physics.Arcade.Body).enable = true;
  }

  applyKnockback(fromX: number, fromY: number, force: number, time: number): void {
    // BOSS / 塔不被擊退推動（維持固定位置/自身 AI）。寶箱怪:跑點移動,不被擊退推(免干擾)。
    if (this.isBoss || this.enemyType === 'tower' || this.enemyType === 'npc' || this.enemyType === 'treasure') return;
    const scale = this.enemyType === 'tank' ? 0.5 : 1;
    const angle = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y);
    if (this.beginHitFreeze(time)) {
      // 命中凍結：先原地僵住，擊退記下來等凍結結束（「打中 → 頓一下 → 飛出去」）
      this.pendingKnockback = { angle, force: force * scale };
      (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    } else {
      this.startKnockback(angle, force * scale, time);
    }
    // 打斷近戰蓄力
    if (this.aiState === 'charge') {
      this.chargeTween?.remove();
      this.chargeTween = undefined;
      this.setScale(this.baseScale);
      this.aiState = 'cooldown';
      this.cooldownUntil = time + GameConfig.enemy.attackCooldownMs;
    }
    // 打斷 bomber 投擲蓄力
    this.interruptBomb(time);
  }

  /** 開始擊退：設定擊退速度與擊退硬直 */
  private startKnockback(angle: number, force: number, time: number): void {
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(Math.cos(angle) * force, Math.sin(angle) * force);
    this.knockbackUntil = time + GameConfig.enemy.knockbackStunMs;
  }

  /**
   * 命中凍結：未凍結時開始一段凍結；凍結中再被打只延長（不疊加），總長不超過上限。
   * 關閉或剛結束凍結（冷卻中）時不凍結
   *
   * @param time 目前場景時間
   * @returns 這次命中是否處於凍結（擊退要延後）
   */
  private beginHitFreeze(time: number): boolean {
    const p = hitFeel();
    if (p.hitstopEnabled !== 1 || p.freezeMs <= 0) return false;
    if (this.hitFreezeUntil > 0) {
      this.hitFreezeUntil = Math.min(this.hitFreezeStartAt + p.maxFreezeMs, Math.max(this.hitFreezeUntil, time + p.freezeMs));
      return true;
    }
    if (this.hitFreezeEndedAt > 0 && time < this.hitFreezeEndedAt + p.freezeCooldownMs) return false;
    this.hitFreezeStartAt = time;
    this.hitFreezeUntil = time + Math.min(p.freezeMs, p.maxFreezeMs);
    return true;
  }

  /** 命中凍結結束：施加延後的擊退 */
  private endHitFreeze(time: number): void {
    this.hitFreezeUntil = 0;
    this.hitFreezeEndedAt = time;
    const kb = this.pendingKnockback;
    this.pendingKnockback = null;
    if (kb) this.startKnockback(kb.angle, kb.force, time);
  }

  takeDamage(amount: number): boolean {
    this.hp -= amount;
    return this.hp <= 0;
  }

  kill(): void {
    if (this.dead) return; // 防重入（同幀第二次致命命中不重複銷毀）
    this.dead = true;
    this.telegraphing = false;
    this.telegraphTween?.remove();
    this.telegraphTween = undefined;
    this.chargeTween?.remove();
    this.chargeTween = undefined;
    this.setScale(this.baseScale);
    this.setAlpha(1);
    this.disableBody(true, true);
    this.setActive(false);
    this.setVisible(false);
  }

  /**
   * 換外觀：設定紋理與基準縮放（之後的縮放復原都回到這個值；F4 切換一般怪外觀也走這裡）
   *
   * @param texture 紋理 key
   * @param scale 基準縮放
   */
  setLook(texture: string, scale: number): this {
    this.baseScale = scale;
    return this.setTexture(texture).setScale(scale);
  }

  getBodyRadius(): number {
    return this.bodyRadius;
  }

  /**
   * 時停專用——把所有【未來的絕對時間戳】整批後移 delta 毫秒，讓時停期間的
   * 蓄力/發招/冷卻/巡邏計時「進度不流失、從暫停點續」。只後移 >0 的(進行中/未來)時間戳。
   */
  shiftTimers(delta: number): void {
    const shift = (v: number): number => (v > 0 ? v + delta : v);
    this.knockbackUntil = shift(this.knockbackUntil);
    this.hitFreezeStartAt = shift(this.hitFreezeStartAt);
    this.hitFreezeUntil = shift(this.hitFreezeUntil);
    this.hitFreezeEndedAt = shift(this.hitFreezeEndedAt);
    this.telegraphUntil = shift(this.telegraphUntil);
    this.chargeUntil = shift(this.chargeUntil);
    this.chargeStartAt = shift(this.chargeStartAt);
    this.cooldownUntil = shift(this.cooldownUntil);
    this.nextRepathAt = shift(this.nextRepathAt);
    this.outOfRangeSince = shift(this.outOfRangeSince);
    this.bombChargeStartAt = shift(this.bombChargeStartAt);
    this.nextBombAt = shift(this.nextBombAt);
    this.nextNpcHitAt = shift(this.nextNpcHitAt);
    this.bossNextAttackAt = shift(this.bossNextAttackAt);
    this.bossDashUntil = shift(this.bossDashUntil);
  }

  /** 時停開始/結束——暫停/續 蓄力/預警 tween（進度不流失）。 */
  pauseChargeTweens(paused: boolean): void {
    if (paused) {
      this.telegraphTween?.pause();
      this.chargeTween?.pause();
    } else {
      this.telegraphTween?.resume();
      this.chargeTween?.resume();
    }
  }
}
