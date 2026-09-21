import Phaser from 'phaser';
import { GameConfig } from '../config';

export type EnemyType = 'normal' | 'tank' | 'shielder' | 'shooter' | 'charger' | 'bomber' | 'boss' | 'tower' | 'npc' | 'anchor' | 'treasure';

/**
 * 敵人（v9）：類型系統擴充。
 * - normal：近戰蓄力攻擊（原本）
 * - tank：高 HP 慢速肉盾（原本，行為同 normal）
 * - shielder：近戰蓄力攻擊 + 正面護盾（正面被打大幅減傷，需繞側/背）
 * - shooter：與角色保持距離、朝最近角色發射子彈，本體脆
 * - charger：接近後蓄力→高速直線衝刺撞擊→硬直
 * 全部走 場內出生 + 登場提示(telegraph) 流程。
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  enemyType: EnemyType = 'normal';
  hp = 0;
  /** v15：擊殺原子性旗標——第一個致命命中設 true，防止同幀多角色重複計殺/掉落/kill() 重入 */
  dead = false;
  private maxHp = 0;
  private moveSpeed = 0;
  private bodyRadius = 0;

  /** 面向（弧度）：朝目標角色方向；shielder 用來判定正面 */
  facing = 0;

  // ★寶箱怪:被命中次數(累積到 hitsToKill 死)、跑點狀態、出現時間戳(限時跑走用)。public 供 GameScene.updateTreasure 讀寫。
  treasureHits = 0;
  treasureSpawnAt = 0;
  treasurePauseUntil = 0;
  treasureMoveTX = 0;
  treasureMoveTY = 0;
  treasureFleeing = false;

  private knockbackUntil = 0;

  telegraphing = false;
  private telegraphUntil = 0;
  private telegraphTween?: Phaser.Tweens.Tween;

  /**
   * 近戰狀態機（normal/tank/shielder 用）。
   * v18 新增 patrol(巡邏) / alert(=chase 追擊)；出生預設 patrol。
   */
  private aiState: 'patrol' | 'chase' | 'charge' | 'cooldown' = 'patrol';
  private chargeUntil = 0;
  private chargeStartAt = 0;
  private cooldownUntil = 0;
  private chargeTween?: Phaser.Tweens.Tween;

  /** v18 巡邏：出生點、當前漫步目標點、下次改點時間、脫離計時 */
  private homeX = 0;
  private homeY = 0;
  private patrolTargetX = 0;
  private patrolTargetY = 0;
  private nextRepathAt = 0;
  private outOfRangeSince = 0;

  /**
   * ★黏著目標(階段1):綁定角色在 GameScene.characters 的 index(-1=未綁)。
   * 生成時綁最近角色,之後【黏著不亂換】(仿DouPo)——除非目標死/移除,或超出 stickyBreakRadius 持續 stickyBreakSec。
   * stickyOutOfRangeSince:目標超距的起始時間戳(0=未超距);達門檻才解鎖重綁,防抖。
   */
  targetSeat = -1;
  stickyOutOfRangeSince = 0;

  /**
   * ★強制追擊(守護波事件怪用):true→updateMelee 跳過 patrol/alertRadius 判定,生成即直衝綁定目標,
   * 且不因 leash/loseRadius 回巡邏(一直咬住目標=NPC)。由 GameScene 生成守護波怪時設定。
   */
  forceChase = false;
  /**
   * ★主動仇恨:被玩家攻擊命中/鎖定過→true。主動怪不計入「單角色被動警戒上限」、永遠可追。
   * 被動怪(aggroActive=false 因 alertRadius 自己進 chase)才計入上限。
   */
  aggroActive = false;
  /**
   * ★被動追擊封鎖(仇恨上限用):GameScene 每幀對「被動且該 seat 已達上限」的怪設 true→
   * updateMelee 的 patrol 不轉 chase(維持巡邏)。主動/forceChase 怪不會被設此旗標。
   */
  chaseBlocked = false;

  /**
   * ★leash 拴繩(難度微調):spawnX/spawnY=穩定的出生點(不像 homeX/Y 會被重設);
   * chase 時離出生點 > leashRadius → 放棄追、回走。leashRadius 由 GameScene 生成時指派(場上組=config、近身組=很大≈不套用)。
   */
  spawnX = 0;
  spawnY = 0;
  leashRadius = Infinity;
  /**
   * ★leash 第二條(累積移動路程):本次 chase 期間累積的移動路程;>leashTravelDist 也放棄(繞圈拉也拉不動)。
   * 進 chase 起算(reset 0),每幀加位移;脫繩/回 patrol/重進 chase 時歸零。leashTravelDist 由 GameScene 指派(近身組=大值)。
   */
  travelAccum = 0;
  leashTravelDist = Infinity;
  private lastChaseX = 0;
  private lastChaseY = 0;

  /** shooter：下次可射擊時間 */
  private nextShootAt = 0;

  /** v25 shooter 雷射狀態機：idle(移動就位) → charging(蓄力鎖向) → 發射後回 idle+冷卻 */
  private laserState: 'idle' | 'charging' = 'idle';
  private laserChargeStartAt = 0;
  private laserAngle = 0;

  /** v26 bomber 投擲狀態機：idle → charging(鎖定玩家落點) → 投出後回 idle+冷卻 */
  private bombState: 'idle' | 'charging' = 'idle';
  private bombChargeStartAt = 0;
  private bombTargetX = 0;
  private bombTargetY = 0;
  private nextBombAt = 0;

  /** charger：衝鋒狀態機 */
  private chargerState: 'chase' | 'charge' | 'dash' | 'recover' = 'chase';
  private chargerTimer = 0;
  private dashDirX = 0;
  private dashDirY = 0;

  /** 盾怪的護盾指示圖 */
  private shieldGfx?: Phaser.GameObjects.Graphics;

  /** 回呼：近戰蓄力發動（normal/tank/shielder），由場景做範圍傷害判定 */
  onAttackFire?: (enemy: Enemy) => void;
  /** 回呼：shooter 發射子彈（場景生成子彈）（v25 停用，改雷射） */
  onShoot?: (enemy: Enemy, angle: number) => void;
  /** v25 回呼：shooter 雷射填滿發射，場景做直線 AOE 判定 + 演出 */
  onLaserFire?: (enemy: Enemy, angle: number) => void;
  /** v26 回呼：bomber 投出炸彈到落點(tx,ty)，場景做飛行/預警/落地爆炸 */
  onBombThrow?: (enemy: Enemy, tx: number, ty: number) => void;
  /** v28 BOSS 攻擊回呼（場景實作演出/判定）；v36 保留舊三招型別但改用 onBossSkill 輪替 */
  onBossSweep?: (enemy: Enemy) => void;
  onBossSummon?: (enemy: Enemy) => void;
  onBossBomb?: (enemy: Enemy, tx: number, ty: number) => void;
  /** v36：四招輪替（a/b/c/d），tx/ty=施放當下鎖定的玩家位置（招 c 用） */
  onBossSkill?: (enemy: Enemy, kind: 'a' | 'b' | 'c' | 'd', tx: number, ty: number) => void;

  /** v28：是否 BOSS */
  isBoss = false;
  /** v36：暫停 BOSS 自動輪替招式（除錯用，隔離單招測試） */
  bossSkillsPaused = false;
  /** v37fix(A)：對守護 NPC 的接觸攻擊冷卻（每隻怪每 npcAttackCooldownMs 才扣一次 NPC 血，避免每幀扣） */
  nextNpcHitAt = 0;
  /** ★守護 NPC 被子彈命中的全域冷卻(NPC 側,避免連發子彈每幀瞬秒);放在 NPC enemy 物件上。 */
  bulletNpcHitAt = 0;
  /** v28 BOSS 攻擊輪替狀態 */
  private bossNextAttackAt = 0;
  private bossAttackIndex = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'enemy-normal');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    (this.body as Phaser.Physics.Arcade.Body).setCollideWorldBounds(false);
    this.setDepth(5);
  }

  spawn(x: number, y: number, time: number, type: EnemyType, hpScale = 1): void {
    this.enemyType = type;
    this.isBoss = type === 'boss';
    if (this.isBoss) {
      // v28 BOSS：stats 來自 GameConfig.boss；hpScale 這裡直接當「最終 HP 倍率」用（GameScene 傳入含 boss 序號成長）
      const b = GameConfig.boss;
      this.maxHp = Math.max(1, Math.round(b.baseHp * hpScale));
      this.moveSpeed = b.speed;
      this.bodyRadius = b.radius;
      this.bossNextAttackAt = time + b.skills.gapMs;
      this.bossAttackIndex = 0;
    } else if (type === 'tower') {
      // v33 塔：stats 來自 GameConfig.event.tower；hpScale=最終 HP 倍率
      const tw = GameConfig.event.tower;
      this.maxHp = Math.max(1, Math.round(tw.baseHp * hpScale));
      this.moveSpeed = 0;
      this.bodyRadius = tw.radius;
    } else if (type === 'npc') {
      // v33 守護 NPC：stats 來自 GameConfig.event.guard
      const g = GameConfig.event.guard;
      this.maxHp = Math.max(1, Math.round(g.npcHp * hpScale));
      this.moveSpeed = 0;
      this.bodyRadius = g.radius;
    } else if (type === 'anchor') {
      // v36 BOSS 戰錨點：純位移落點，靜止、不可被玩家傷（isAnchorLike）；HP 給大值防呆
      this.maxHp = 999999;
      this.moveSpeed = 0;
      this.bodyRadius = GameConfig.enemy.types.anchor.radius;
    } else if (type === 'treasure') {
      // ★寶箱怪:大 HP(改用命中次數死)、移動由跑點 AI(treasure.moveSpeed)、體型中等
      this.maxHp = 999999;
      this.moveSpeed = 0;
      this.bodyRadius = GameConfig.enemy.types.treasure.radius;
    } else {
      const t = GameConfig.enemy.types[type];
      this.maxHp = Math.max(1, Math.round(t.maxHp * hpScale));
      this.moveSpeed = t.speed;
      this.bodyRadius = t.radius;
    }

    this.setTexture(`enemy-${type}`);
    this.enableBody(true, x, y, true, true);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(this.bodyRadius, 2, 2);

    this.hp = this.maxHp;
    this.dead = false;
    this.knockbackUntil = 0;
    this.nextNpcHitAt = 0; // v37fix(A)
    this.bulletNpcHitAt = 0; // ★守護 NPC 子彈冷卻重置
    // v18：出生預設巡邏，記住出生點；不再一出生就直衝玩家
    this.aiState = 'patrol';
    this.homeX = x;
    this.homeY = y;
    this.patrolTargetX = x;
    this.patrolTargetY = y;
    this.nextRepathAt = 0;
    this.outOfRangeSince = 0;
    this.targetSeat = -1;           // ★黏著:生成時未綁,由 GameScene 生成後指派
    this.stickyOutOfRangeSince = 0;
    this.spawnX = x; this.spawnY = y; // ★leash:記穩定出生點(leashRadius 由 GameScene 生成後指派)
    this.leashRadius = Infinity;      // 預設不套用;GameScene 指派場上組=config、近身組=大值
    this.travelAccum = 0; this.leashTravelDist = Infinity; this.lastChaseX = x; this.lastChaseY = y; // ★leash 第二條:路程重置
    this.forceChase = false;   // ★守護波怪由 GameScene 生成後指派;預設一般怪不強制追
    this.aggroActive = false;  // ★主動仇恨:生成時未被玩家打過
    this.chaseBlocked = false; // ★被動追擊封鎖:每幀由 GameScene 依上限重算
    this.chargeUntil = 0;
    this.chargeStartAt = 0;
    this.cooldownUntil = 0;
    this.nextShootAt = time + Phaser.Math.Between(300, 1200);
    this.laserState = 'idle';
    this.laserChargeStartAt = 0;
    this.laserAngle = 0;
    this.bombState = 'idle';
    this.bombChargeStartAt = 0;
    this.nextBombAt = time + Phaser.Math.Between(400, 1400);
    this.chargerState = 'chase';
    this.chargerTimer = 0;
    this.facing = 0;
    // ★寶箱怪狀態重置
    this.treasureHits = 0;
    this.treasureSpawnAt = time;
    this.treasurePauseUntil = 0;
    this.treasureFleeing = false;
    this.treasureMoveTX = x;
    this.treasureMoveTY = y;
    this.setActive(true);
    this.setVisible(true);
    this.setScale(1);
    this.clearTint();

    // 盾怪護盾指示圖
    if (type === 'shielder') {
      if (!this.shieldGfx) this.shieldGfx = this.scene.add.graphics().setDepth(6);
      this.shieldGfx.setVisible(true);
    } else if (this.shieldGfx) {
      this.shieldGfx.clear();
      this.shieldGfx.setVisible(false);
    }

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
   * v35：可否被「玩家」傷害。anchor-like（位移點：NPC / 之後第9點的錨點）不受玩家傷害
   * （NPC 只會被「敵人」用 takeDamage 直接扣血——守護事件本意）。
   */
  isVulnerable(): boolean {
    return this.active && !this.telegraphing && !this.isAnchorLike();
  }

  /**
   * v35：anchor-like「位移點」——可複用機制：
   * ①不可被玩家傷害(isVulnerable=false) ②玩家可朝它衝過去當走位落點，衝到附近不觸發攻擊、不重疊卡住。
   * NPC(守護)：不可鎖定；anchor(BOSS戰錨點)：可鎖定（可鎖差異在 GameScene isLockValid/pickAimConeTarget）。
   */
  isAnchorLike(): boolean {
    return this.enemyType === 'npc' || this.enemyType === 'anchor';
  }

  updateAI(targetX: number, targetY: number, time: number): void {
    if (!this.active) return;
    // v33/36 塔/NPC/錨點：靜止物件，不跑 AI（行為由 GameScene 邏輯管）。★寶箱怪:跑點/限時/計命中由 GameScene.updateTreasure 管,不跑一般 AI。
    if (this.enemyType === 'tower' || this.enemyType === 'npc' || this.enemyType === 'anchor' || this.enemyType === 'treasure') {
      if (this.enemyType !== 'treasure') (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
      if (this.enemyType === 'treasure' && this.telegraphing && time >= this.telegraphUntil) this.materialize(); // 寶箱怪 telegraph 結束→實體化(可動可被打)
      return;
    }

    if (this.telegraphing) {
      if (time >= this.telegraphUntil) this.materialize();
      else return;
    }

    const body = this.body as Phaser.Physics.Arcade.Body;
    if (time < this.knockbackUntil) {
      body.velocity.scale(0.92);
      if (this.enemyType === 'shielder') this.drawShield();
      return;
    }

    switch (this.enemyType) {
      case 'shooter':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        this.updateShooter(targetX, targetY, time);
        break;
      case 'charger':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        this.updateCharger(targetX, targetY, time);
        break;
      case 'bomber':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        this.updateBomber(targetX, targetY, time);
        break;
      case 'boss':
        this.facing = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
        this.updateBoss(targetX, targetY, time);
        break;
      default:
        // normal / tank / shielder：巡邏 / 警戒追擊 + 蓄力（v18）
        this.updateMelee(targetX, targetY, time);
        break;
    }

    if (this.enemyType === 'shielder') this.drawShield();
  }

  // --- normal / tank / shielder：巡邏 / 警戒 / 蓄力（v18）---
  private updateMelee(targetX: number, targetY: number, time: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body;
    const cfg = GameConfig.enemy.ai;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);

    switch (this.aiState) {
      case 'patrol': {
        // 出生點附近小範圍慢速漫步；角色進入警戒範圍才轉 chase
        // ★forceChase(守護波怪):無視 alertRadius,直接 chase 直衝目標。
        // ★chaseBlocked(被動仇恨已達該角色上限):維持 patrol、不轉 chase(主動/forceChase 怪不會被 block)。
        if (this.forceChase || (dist <= cfg.alertRadius && !this.chaseBlocked)) {
          this.aiState = 'chase';
          this.outOfRangeSince = 0;
          this.travelAccum = 0; this.lastChaseX = this.x; this.lastChaseY = this.y; // ★leash 第二條:進 chase 重置路程
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
        // ★leash 第二條:累積本次追擊移動路程(每幀加位移)。繞圈拉也會累積→拉不動。
        this.travelAccum += Phaser.Math.Distance.Between(this.x, this.y, this.lastChaseX, this.lastChaseY);
        this.lastChaseX = this.x; this.lastChaseY = this.y;
        // ★leash 拴繩(兩條並存,任一觸發就放棄回家):
        //   ① 直線:離【出生點】> leashRadius(防拉遠) ② 路程:travelAccum > leashTravelDist(防繞圈拉串)。
        //   (loseRadius 算離目標、leash 算離出生點/路程。近身組 leashRadius/leashTravelDist=大值≈不套用。)
        const distFromSpawn = Phaser.Math.Distance.Between(this.x, this.y, this.spawnX, this.spawnY);
        if (!this.forceChase && (distFromSpawn > this.leashRadius || this.travelAccum > this.leashTravelDist)) {
          this.aiState = 'patrol';
          this.homeX = this.spawnX; // 回出生點附近巡邏(緩慢走回)
          this.homeY = this.spawnY;
          this.patrolTargetX = this.spawnX;
          this.patrolTargetY = this.spawnY;
          this.nextRepathAt = 0;
          this.outOfRangeSince = 0;
          this.travelAccum = 0; // ★重置:下次重進 chase 重新算路程
          break;
        }
        // 脫離判定：目標超出 loseRadius 持續 loseGraceMs → 回巡邏(★forceChase 怪不脫離,一直咬住)
        if (!this.forceChase && dist > cfg.loseRadius) {
          if (this.outOfRangeSince === 0) this.outOfRangeSince = time;
          else if (time - this.outOfRangeSince >= cfg.loseGraceMs) {
            this.aiState = 'patrol';
            this.homeX = this.x; // 以當前位置為新巡邏中心
            this.homeY = this.y;
            this.nextRepathAt = 0;
            this.outOfRangeSince = 0;
            this.travelAccum = 0; // ★leash 第二條:回 patrol 重置路程
            break;
          }
        } else {
          this.outOfRangeSince = 0;
        }
        if (dist <= GameConfig.enemy.engageRange) {
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

  private beginCharge(time: number): void {
    this.aiState = 'charge';
    this.chargeStartAt = time;
    this.chargeUntil = time + GameConfig.enemy.chargeMs;
    (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
    // v18：預警改由 GameScene 畫「由內而外填滿」的範圍圈；此處僅輕微紅 tint，不再放大脈動
    this.setTint(0xff5555);
  }

  private fireAttack(time: number): void {
    this.chargeTween?.remove();
    this.chargeTween = undefined;
    this.setScale(1);
    if (this.enemyType !== 'shielder') this.clearTint();
    this.onAttackFire?.(this);
    this.aiState = 'cooldown';
    this.cooldownUntil = time + GameConfig.enemy.attackCooldownMs;
  }

  isCharging(): boolean {
    return this.aiState === 'charge' && !this.telegraphing;
  }

  /** v18：蓄力進度 0→1（供 GameScene 畫由內而外填滿的預警圈） */
  chargeProgress(time: number): number {
    if (this.aiState !== 'charge') return 0;
    const span = GameConfig.enemy.chargeMs;
    return Phaser.Math.Clamp((time - this.chargeStartAt) / span, 0, 1);
  }

  /** v18 除錯：目前近戰 AI 狀態（patrol/chase/charge/cooldown） */
  getAiState(): string {
    return this.aiState;
  }

  // --- shooter：保持距離 + 蓄力直線雷射（v25）---
  private updateShooter(targetX: number, targetY: number, time: number): void {
    const cfg = GameConfig.enemy.shooter;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);

    if (this.laserState === 'charging') {
      // 蓄力中：站定不動、鎖定方向（laserAngle 固定），填滿即發射
      body.setVelocity(0, 0);
      const prog = Phaser.Math.Clamp((time - this.laserChargeStartAt) / cfg.laserChargeMs, 0, 1);
      if (prog >= 1) {
        this.onLaserFire?.(this, this.laserAngle);
        this.laserState = 'idle';
        this.nextShootAt = time + cfg.shootCooldownMs;
        this.clearTint();
      }
      return;
    }

    // idle：保持偏好距離站位
    // ★階段3:目標超出 alertRadius→遠處待命(不逼近),玩家進警戒才走位開火(場上組不開場全湧)。
    // ★forceChase(守護波 shooter):無視 alertRadius→主動走位靠近到 preferRange/fireRange 再開火(保持距離邏輯不變,不貼身)。
    if (!this.forceChase && dist > GameConfig.enemy.ai.alertRadius) {
      body.setVelocity(0, 0);
      return;
    }
    if (dist < cfg.retreatRange) {
      body.setVelocity(-Math.cos(this.facing) * this.moveSpeed, -Math.sin(this.facing) * this.moveSpeed);
    } else if (dist > cfg.preferRange) {
      body.setVelocity(Math.cos(this.facing) * this.moveSpeed, Math.sin(this.facing) * this.moveSpeed);
    } else {
      body.setVelocity(0, 0);
    }

    // 射程內且冷卻好 → 開始蓄力雷射（鎖定當下朝玩家方向）
    if (dist <= cfg.fireRange && time >= this.nextShootAt) {
      this.laserState = 'charging';
      this.laserChargeStartAt = time;
      this.laserAngle = Phaser.Math.Angle.Between(this.x, this.y, targetX, targetY);
      this.setTint(0x88ff88);
    }
  }

  /** v25：shooter 是否正在蓄力雷射（供 GameScene 畫填充預警線） */
  isChargingLaser(): boolean {
    return this.enemyType === 'shooter' && this.laserState === 'charging' && !this.telegraphing;
  }

  /** v25：雷射蓄力進度 0→1（供 GameScene 畫由怪端往盡頭填滿） */
  laserChargeProgress(time: number): number {
    if (this.laserState !== 'charging') return 0;
    return Phaser.Math.Clamp((time - this.laserChargeStartAt) / GameConfig.enemy.shooter.laserChargeMs, 0, 1);
  }

  /** v25：目前雷射鎖定方向（弧度） */
  getLaserAngle(): number {
    return this.laserAngle;
  }

  /** v25：中斷雷射蓄力（被玩家命中時呼叫），需重新蓄力 */
  private interruptLaser(time: number): void {
    if (this.laserState === 'charging') {
      this.laserState = 'idle';
      this.nextShootAt = time + GameConfig.enemy.shooter.shootCooldownMs;
      if (this.active) this.clearTint();
    }
  }

  // --- bomber：保持距離 + 蓄力投擲炸彈到玩家落點（v26）---
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

    // v32：bomber 定點不動——生成後就站原地，不追不退
    body.setVelocity(0, 0);

    // 射程內且冷卻好 → 開始蓄力投擲（鎖定玩家「當下位置」當落點）
    if (dist <= cfg.throwRange && time >= this.nextBombAt) {
      this.bombState = 'charging';
      this.bombChargeStartAt = time;
      this.bombTargetX = targetX;
      this.bombTargetY = targetY;
      this.setTint(0xd08bff);
    }
  }

  /** v26：bomber 是否正在蓄力投擲（供 GameScene 畫落點預警） */
  isChargingBomb(): boolean {
    return this.enemyType === 'bomber' && this.bombState === 'charging' && !this.telegraphing;
  }

  /** v26：bomber 投擲蓄力進度 0→1 */
  bombChargeProgress(time: number): number {
    if (this.bombState !== 'charging') return 0;
    return Phaser.Math.Clamp((time - this.bombChargeStartAt) / GameConfig.enemy.bomber.bombChargeMs, 0, 1);
  }

  /** v26：bomber 目前鎖定的落點 */
  getBombTarget(): { x: number; y: number } {
    return { x: this.bombTargetX, y: this.bombTargetY };
  }

  /** v26：中斷投擲蓄力（被玩家命中時），需重新蓄力 */
  private interruptBomb(time: number): void {
    if (this.bombState === 'charging') {
      this.bombState = 'idle';
      this.nextBombAt = time + GameConfig.enemy.bomber.bombCooldownMs;
      if (this.active) this.clearTint();
    }
  }

  // --- BOSS：慢速逼近 + 三招輪替（近身橫掃 / 召喚小怪 / 投彈）---
  private updateBoss(targetX: number, targetY: number, time: number): void {
    const b = GameConfig.boss;
    const body = this.body as Phaser.Physics.Arcade.Body;
    // v35：BOSS 暫改固定中央不動（招式/錨點第8-9點重做前的暫定行為）
    if (b.stationary) {
      body.setVelocity(0, 0);
    } else {
      const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);
      if (dist > b.sweepRadius * 0.6) {
        body.setVelocity(Math.cos(this.facing) * this.moveSpeed, Math.sin(this.facing) * this.moveSpeed);
      } else {
        body.setVelocity(0, 0);
      }
    }
    if (!this.bossSkillsPaused && time >= this.bossNextAttackAt) {
      // v39(7)：三招輪替 a→c→d→a（移除招 b 全場炸）。
      // v39(1)：觸發後把 bossNextAttackAt 設 Infinity「暫停」——由 GameScene 在該招【完全釋放完】後
      //         呼叫 scheduleBossNextAttack(釋放完時間 + gapMs) 重新排程，確保 gap 從炸完才起算。
      const kinds: Array<'a' | 'c' | 'd'> = ['a', 'c', 'd'];
      const kind = kinds[this.bossAttackIndex % 3];
      this.bossAttackIndex++;
      this.bossNextAttackAt = Number.MAX_SAFE_INTEGER;
      this.onBossSkill?.(this, kind, targetX, targetY);
    }
  }

  /** v39(1)：由 GameScene 在招式釋放完後呼叫，重新排程下一招（gap 從釋放完起算） */
  scheduleBossNextAttack(atTime: number): void {
    this.bossNextAttackAt = atTime;
  }

  /** v28：BOSS 血量比例（供 HUD 血條） */
  hpRatio(): number {
    return this.maxHp > 0 ? Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1) : 0;
  }

  // --- charger：蓄力 → 直線衝刺 → 硬直 ---
  private updateCharger(targetX: number, targetY: number, time: number): void {
    const cfg = GameConfig.enemy.charger;
    const body = this.body as Phaser.Physics.Arcade.Body;
    const dist = Phaser.Math.Distance.Between(this.x, this.y, targetX, targetY);

    switch (this.chargerState) {
      case 'chase':
        if (dist <= cfg.engageRange) {
          // 進入蓄力（鎖定當前方向）
          this.chargerState = 'charge';
          this.chargerTimer = time + cfg.chargeMs;
          this.dashDirX = Math.cos(this.facing);
          this.dashDirY = Math.sin(this.facing);
          body.setVelocity(0, 0);
          this.setTint(0xffaa00);
          this.chargeTween?.remove();
          this.chargeTween = this.scene.tweens.add({
            targets: this,
            scale: { from: 1, to: 1.35 },
            duration: 120,
            yoyo: true,
            repeat: -1
          });
        } else {
          body.setVelocity(Math.cos(this.facing) * this.moveSpeed, Math.sin(this.facing) * this.moveSpeed);
        }
        break;
      case 'charge':
        body.setVelocity(0, 0);
        if (time >= this.chargerTimer) {
          // 發動衝刺（鎖定蓄力時的方向，不再轉向）
          this.chargerState = 'dash';
          this.chargerTimer = time + cfg.dashDurationMs;
          this.chargeTween?.remove();
          this.chargeTween = undefined;
          this.setScale(1);
          this.clearTint();
          body.setVelocity(this.dashDirX * cfg.dashSpeed, this.dashDirY * cfg.dashSpeed);
        }
        break;
      case 'dash':
        if (time >= this.chargerTimer) {
          this.chargerState = 'recover';
          this.chargerTimer = time + cfg.recoverMs;
          body.setVelocity(0, 0);
        }
        break;
      case 'recover':
        body.setVelocity(0, 0);
        if (time >= this.chargerTimer) this.chargerState = 'chase';
        break;
    }
  }

  /** charger 是否正在衝刺（供場景做撞擊判定） */
  isChargerDashing(): boolean {
    return this.enemyType === 'charger' && this.chargerState === 'dash' && !this.telegraphing;
  }

  /** charger 是否在蓄力（供場景畫預警） */
  isChargerCharging(): boolean {
    return this.enemyType === 'charger' && this.chargerState === 'charge' && !this.telegraphing;
  }

  /** 盾怪：判定攻擊來源方向是否命中「正面」（回傳傷害倍率） */
  damageMultiplierFrom(fromX: number, fromY: number): number {
    if (this.enemyType !== 'shielder') return 1;
    // 攻擊來源相對盾怪的方向
    const srcAngle = Phaser.Math.Angle.Between(this.x, this.y, fromX, fromY);
    // 盾面向 = facing（朝目標）。來源與面向夾角小 → 從正面打
    const diff = Math.abs(Phaser.Math.Angle.Wrap(srcAngle - this.facing));
    const halfCone = Phaser.Math.DegToRad(GameConfig.enemy.shielder.frontConeDeg);
    if (diff <= halfCone) return GameConfig.enemy.shielder.frontDamageMult; // 正面大幅減傷
    return 1;
  }

  private drawShield(): void {
    if (!this.shieldGfx) return;
    const g = this.shieldGfx;
    g.clear();
    // 在盾怪面向前方畫一段弧線代表護盾
    const r = this.bodyRadius + 8;
    const halfCone = Phaser.Math.DegToRad(GameConfig.enemy.shielder.frontConeDeg);
    g.lineStyle(4, 0x9be7ff, 0.9);
    g.beginPath();
    g.arc(this.x, this.y, r, this.facing - halfCone, this.facing + halfCone);
    g.strokePath();
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
    // v34：BOSS / 塔不被擊退推動（維持固定位置/自身 AI）。★寶箱怪:跑點移動,不被擊退推(免干擾)。
    if (this.isBoss || this.enemyType === 'tower' || this.enemyType === 'npc' || this.enemyType === 'treasure') return;
    const scale = this.enemyType === 'tank' ? 0.5 : 1;
    const angle = Phaser.Math.Angle.Between(fromX, fromY, this.x, this.y);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setVelocity(Math.cos(angle) * force * scale, Math.sin(angle) * force * scale);
    this.knockbackUntil = time + GameConfig.enemy.knockbackStunMs;
    // 打斷近戰蓄力
    if (this.aiState === 'charge') {
      this.chargeTween?.remove();
      this.chargeTween = undefined;
      this.setScale(1);
      this.aiState = 'cooldown';
      this.cooldownUntil = time + GameConfig.enemy.attackCooldownMs;
    }
    // v25：打斷 shooter 雷射蓄力（被擊中中斷，需重新蓄力）
    this.interruptLaser(time);
    // v26：打斷 bomber 投擲蓄力
    this.interruptBomb(time);
  }

  takeDamage(amount: number): boolean {
    this.hp -= amount;
    return this.hp <= 0;
  }

  kill(): void {
    if (this.dead) return; // v15：防重入（同幀第二次致命命中不重複銷毀）
    this.dead = true;
    this.telegraphing = false;
    this.telegraphTween?.remove();
    this.telegraphTween = undefined;
    this.chargeTween?.remove();
    this.chargeTween = undefined;
    if (this.shieldGfx) {
      this.shieldGfx.clear();
      this.shieldGfx.setVisible(false);
    }
    this.setScale(1);
    this.setAlpha(1);
    this.disableBody(true, true);
    this.setActive(false);
    this.setVisible(false);
  }

  getBodyRadius(): number {
    return this.bodyRadius;
  }

  /**
   * v45(2)：時停專用——把所有【未來的絕對時間戳】整批後移 delta 毫秒，讓時停期間的
   * 蓄力/發招/冷卻/巡邏計時「進度不流失、從暫停點續」。只後移 >0 的(進行中/未來)時間戳。
   */
  shiftTimers(delta: number): void {
    const shift = (v: number): number => (v > 0 ? v + delta : v);
    this.knockbackUntil = shift(this.knockbackUntil);
    this.telegraphUntil = shift(this.telegraphUntil);
    this.chargeUntil = shift(this.chargeUntil);
    this.chargeStartAt = shift(this.chargeStartAt);
    this.cooldownUntil = shift(this.cooldownUntil);
    this.nextRepathAt = shift(this.nextRepathAt);
    this.outOfRangeSince = shift(this.outOfRangeSince);
    this.nextShootAt = shift(this.nextShootAt);
    this.laserChargeStartAt = shift(this.laserChargeStartAt);
    this.bombChargeStartAt = shift(this.bombChargeStartAt);
    this.nextBombAt = shift(this.nextBombAt);
    this.nextNpcHitAt = shift(this.nextNpcHitAt);
    this.bossNextAttackAt = shift(this.bossNextAttackAt);
  }

  /** v45(2)：時停開始/結束——暫停/續 蓄力/預警 tween（進度不流失）。 */
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
