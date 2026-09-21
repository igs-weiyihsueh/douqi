import Phaser from 'phaser';
import { GameConfig } from '../config';

/**
 * 角色（P1 玩家 + BOT 共用）：
 * 差別只在「輸入來源」——P1 由玩家滑鼠/按鍵、BOT 由 AI 決定 aimAngle 與何時出手。
 * 角色本身持有 血量 / 鬥氣 / 擊殺數 / 衝刺與爆發狀態，實際傷害判定由 GameScene 驅動。
 */
export class Character extends Phaser.Physics.Arcade.Sprite {
  readonly index: number;
  readonly isBot: boolean;

  hp: number = GameConfig.player.maxHp;
  spirit = 0;
  /** v55：能量值(僅 P1 用)——獨立於 combo/spirit。命中+1、被打-1、滿10自動強化、強化期間倒退到0解除。 */
  energy = 0;
  kills = 0;
  alive = true;

  invulnUntil = 0;
  /** v11：遠距衝撞衝刺期間的護盾（無敵）；衝刺結束由場景清除 */
  dashShielded = false;
  /** v13：招式演出鎖——期間無敵且玩家輸入不驅動角色（到此時間戳前鎖定） */
  skillLockUntil = 0;

  // 衝刺（純方向，遇第一個敵人停下）
  isDashing = false;
  dashDestX = 0;
  dashDestY = 0;
  /** v14.2：本次衝刺是否為「衝去撿道具」（途中不因撞到敵人而中止，確保撿得到） */
  dashToItem = false;
  /** 目前瞄準角度（弧度） */
  aimAngle = 0;
  nextAttackAllowedAt = 0;

  // 爆發
  isBursting = false;
  /** v31：限時強化結束時間戳(★快速模式用：combo10 觸發、固定 durationMs)。 */
  empowerUntil = 0;
  /** v55：慢速模式限時強化旗標(能量驅動：滿10→true，能量倒退到0→GameScene 設回 false)。 */
  empowered = false;
  /** v34：被塔環命中→定身(不能移動/衝刺)到此時間戳 */
  rootedUntil = 0;
  /** v59：時停穿梭瞬移期間旗標——期間 physics overlap 不觸發拾取道具(穿梭經過道具不吃)。 */
  timestopping = false;

  // BOT 專用：下次自動出手時間
  nextBotActAt = 0;

  /**
   * v15：此角色當前鎖定的目標（敵人或道具）。P1 由玩家自動鎖定寫入，BOT 由 AI 寫入。
   * 用最小介面型別避免與 Enemy/Item 的循環 import；實際物件由 GameScene 指派。
   */
  lockedTarget: (Phaser.GameObjects.GameObject & { x: number; y: number }) | null = null;

  private label: Phaser.GameObjects.Text;
  /** 衝刺護盾光環 */
  private shieldAura: Phaser.GameObjects.Arc;
  /** v40(2)：強化狀態環繞特效（繞角色轉的光點 + 脈動光環，取代放大） */
  private empowerOrbit!: Phaser.GameObjects.Graphics;
  /** ★v60 階段3:啟用【強化型態造型】(升級版變身視覺;只 slow P1 開)。程式繪製疊加,不放大。 */
  empoweredForm = false;
  /** ★v60:強化型態上升粒子(能量感);empoweredForm 開時強化期間發射。 */
  private empowerParticles?: Phaser.GameObjects.Particles.ParticleEmitter;
  private empowerFormOn = false; // 目前是否正在顯示強化造型(用於進入/退出切換)
  /** v19：角色腳下 血條/鬥氣條（跟隨移動） */
  private hpBarBg!: Phaser.GameObjects.Rectangle;
  private hpBar!: Phaser.GameObjects.Rectangle;
  private spiritBar!: Phaser.GameObjects.Rectangle;
  /** v19：鬥氣滿/爆發時角色身上的「爆」標記 */
  private burstMark!: Phaser.GameObjects.Text;
  /** v26：爆標記脈動 tween */
  private burstMarkTween?: Phaser.Tweens.Tween;
  /** v45(5)：被定身時的「定身!」提示 + 鎖鏈環（讓玩家知道為何不能動） */
  private rootMark!: Phaser.GameObjects.Text;
  private rootRing!: Phaser.GameObjects.Graphics;
  private readonly footBarW = 34;

  constructor(scene: Phaser.Scene, x: number, y: number, index: number, isBot: boolean) {
    super(scene, x, y, `char-${index}`);
    this.index = index;
    this.isBot = isBot;
    scene.add.existing(this);
    scene.physics.add.existing(this);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(GameConfig.player.radius, 2, 2);
    // v37fix(B)：不用 collideWorldBounds（改由 GameScene.clampToArena 以固定 player.radius 夾邊界）。
    // Arcade 世界邊界碰撞遇到強化放大(scale1.4)的 body AABB 會把角色卡死在邊角、無法離開；
    // 拿掉它後邊界完全由 clampToArena 管、不受 scale 影響。
    this.setDepth(10);

    this.shieldAura = scene.add
      .circle(x, y, GameConfig.player.radius + 8, 0x8be9fd, 0.18)
      .setDepth(9)
      .setVisible(false);
    this.shieldAura.setStrokeStyle(3, 0x8be9fd, 0.9);

    // v40(2)：強化環繞特效（繞角色轉的金色光點 + 脈動光環），預設隱藏
    this.empowerOrbit = scene.add.graphics().setDepth(9).setVisible(false);

    this.label = scene.add
      .text(x, y - GameConfig.player.radius - 12, GameConfig.characters.labels[index], {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5)
      .setDepth(11);

    // v19：角色腳下小型血條 + 鬥氣條（跟隨移動）
    const bw = this.footBarW;
    const footY = y + GameConfig.player.radius + 6;
    this.hpBarBg = scene.add
      .rectangle(x, footY, bw, 5, 0x000000, 0.6)
      .setStrokeStyle(1, 0xffffff, 0.25)
      .setDepth(11);
    this.hpBar = scene.add.rectangle(x - bw / 2 + 1, footY, bw - 2, 3, 0x4ade80).setOrigin(0, 0.5).setDepth(11);
    this.spiritBar = scene.add.rectangle(x - bw / 2 + 1, footY + 5, 0, 3, 0x60a5fa).setOrigin(0, 0.5).setDepth(11);

    // v19：鬥氣滿/爆發標記「爆」（平時隱藏）（v26：字放大更突出）
    this.burstMark = scene.add
      .text(x, y - GameConfig.player.radius - 44, '爆', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffd700',
        stroke: '#000000',
        strokeThickness: 7,
        fontStyle: 'bold'
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);

    // v45(5)：定身視覺——頭上「定身!」字 + 腳下青色鎖鏈環，預設隱藏
    this.rootMark = scene.add
      .text(x, y - GameConfig.player.radius - 26, '定身!', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#9adcff',
        stroke: '#001a33',
        strokeThickness: 5,
        fontStyle: 'bold'
      })
      .setOrigin(0.5)
      .setDepth(12)
      .setVisible(false);
    this.rootRing = scene.add.graphics().setDepth(9).setVisible(false);
  }

  isInvulnerable(time: number): boolean {
    return this.dashShielded || time < this.skillLockUntil || time < this.invulnUntil || time < this.empowerUntil || this.empowered;
  }

  /** v31/v55：限時強化中——fast 用 empowerUntil 時間戳、slow 用 empowered 旗標(能量驅動)。 */
  isEmpowered(time: number): boolean {
    return this.empowered || time < this.empowerUntil;
  }

  /** v34：被定身中（不能移動/衝刺/攻擊位移） */
  isRooted(time: number): boolean {
    return time < this.rootedUntil;
  }

  /** v13：招式演出鎖定中（無敵 + 玩家不可操控） */
  isSkillLocked(time: number): boolean {
    return time < this.skillLockUntil;
  }

  /** v55(slow-A)：慢速模式 P1 無血量、不會死——被打只扣能量、不扣血。GameScene init 時設 true(只 P1+slow)。 */
  noHpLoss = false;

  /**
   * 受傷，回傳是否實際「被命中」(無敵/衝刺護盾/已死不算)。
   * fast：扣血(可死)。v55 slow(noHpLoss)：不扣血、不會死，只作為命中判定(能量 -1 由此處理)。
   */
  takeDamage(amount: number, time: number): boolean {
    if (!this.alive || this.isInvulnerable(time)) return false;
    if (this.noHpLoss) {
      // v55 slow：不扣血、不死；被命中→能量 -1(夾≥0)。
      this.energy = Math.max(0, this.energy - 1);
      this.invulnUntil = time + GameConfig.player.invulnMs;
      return true;
    }
    this.hp = Math.max(0, this.hp - amount);
    this.invulnUntil = time + GameConfig.player.invulnMs;
    return true;
  }

  /** 顯示/隱藏衝刺護盾光環 */
  showDashShield(on: boolean): void {
    this.shieldAura.setVisible(on && this.alive);
    if (on) this.shieldAura.setPosition(this.x, this.y);
  }

  /** v19：一次攻擊命中(至少1隻)累積 1 次鬥氣（不論打中幾隻只算 1） */
  gainSpiritHit(): void {
    if (this.isBursting) return;
    this.spirit = Math.min(GameConfig.spirit.hitsToBurst, this.spirit + 1);
  }

  get spiritFull(): boolean {
    return this.spirit >= GameConfig.spirit.hitsToBurst;
  }

  stopMoving(): void {
    if (this.body) (this.body as Phaser.Physics.Arcade.Body).setVelocity(0, 0);
  }

  /** 每幀讓標籤/護盾光環/腳下血鬥氣條/爆發標記跟隨角色 */
  syncLabel(): void {
    if (!this.alive) return;
    this.label.setPosition(this.x, this.y - GameConfig.player.radius - 12);
    if (this.shieldAura.visible) this.shieldAura.setPosition(this.x, this.y);

    // v19：腳下血條 + 鬥氣條跟隨 + 更新比例。v55：slow P1(noHpLoss) 無血量→隱藏腳下血條。
    const bw = this.footBarW;
    const footY = this.y + GameConfig.player.radius + 6;
    if (this.noHpLoss) {
      this.hpBarBg.setVisible(false);
      this.hpBar.setVisible(false);
    } else {
      this.hpBarBg.setPosition(this.x, footY);
      const hpRatio = Phaser.Math.Clamp(this.hp / GameConfig.player.maxHp, 0, 1);
      this.hpBar.setPosition(this.x - bw / 2 + 1, footY);
      this.hpBar.width = (bw - 2) * hpRatio;
      this.hpBar.fillColor = hpRatio > 0.5 ? 0x4ade80 : hpRatio > 0.25 ? 0xfacc15 : 0xef4444;
    }
    const spRatio = Phaser.Math.Clamp(this.spirit / GameConfig.spirit.hitsToBurst, 0, 1);
    this.spiritBar.setPosition(this.x - bw / 2 + 1, footY + 5);
    this.spiritBar.width = (bw - 2) * spRatio;
    this.spiritBar.fillColor = spRatio >= 1 ? 0xffd700 : 0x60a5fa;

    // v19：鬥氣滿或爆發中 → 顯示「爆」標記（跟隨頭上）（v26：放大 + 脈動）
    const showMark = this.spiritFull || this.isBursting;
    if (showMark && !this.burstMark.visible) {
      // 剛變成顯示 → 起脈動放大 tween（發勁跳出感）
      this.burstMark.setVisible(true);
      this.burstMark.setScale(1);
      this.burstMarkTween?.remove();
      this.burstMarkTween = this.scene.tweens.add({
        targets: this.burstMark,
        scale: { from: 1, to: 1.3 },
        duration: 320,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    } else if (!showMark && this.burstMark.visible) {
      this.burstMarkTween?.remove();
      this.burstMarkTween = undefined;
      this.burstMark.setScale(1);
      this.burstMark.setVisible(false);
    }
    if (showMark) this.burstMark.setPosition(this.x, this.y - GameConfig.player.radius - 44);

    // v31：限時強化狀態視覺——金色染色 + 護盾光環；v40(2)：取消放大、改身上環繞特效（光點繞轉 + 脈動光環）
    // ★v60 階段3:empoweredForm(slow P1)開時,升級成明顯的【強化變身造型】(疊亮色+雙光環+glow外框+上升粒子)。
    const now = this.scene.time.now;
    if (this.isEmpowered(now)) {
      if (this.empoweredForm) {
        const form = GameConfig.combo.empower.form;
        this.setTint(form.tint);
        this.shieldAura.setVisible(false); // 用升級造型取代原護盾圈
        this.drawEmpowerForm(now);
        this.ensureEmpowerParticles(true);
      } else {
        this.setTint(0xffe066);
        this.shieldAura.setVisible(true);
        this.shieldAura.setPosition(this.x, this.y);
        this.drawEmpowerOrbit(now);
      }
      this.empowerFormOn = this.empoweredForm;
    } else if (this.empowerFormOn || this.tintTopLeft === 0xffe066 || this.tintTopLeft === GameConfig.combo.empower.form.tint) {
      // 強化剛結束 → 清除染色 + 收環繞特效 + 收造型粒子 → 恢復正常
      this.clearTint();
      this.empowerOrbit.setVisible(false).clear();
      this.shieldAura.setVisible(false);
      this.ensureEmpowerParticles(false);
      this.empowerFormOn = false;
    }

    // v45(5)：定身視覺——「定身!」字閃動 + 腳下青色鎖鏈環脈動 + 角色偏青灰染色（強化中不覆蓋金色）
    if (this.isRooted(now)) {
      if (!this.rootMark.visible) this.rootMark.setVisible(true);
      this.rootMark.setPosition(this.x, this.y - GameConfig.player.radius - 26);
      this.rootMark.setAlpha(0.55 + 0.45 * Math.abs(Math.sin(now / 140)));
      const g = this.rootRing;
      g.setVisible(true).clear();
      const R = GameConfig.player.radius;
      const rr = R + 6 + Math.sin(now / 130) * 2;
      g.lineStyle(3, 0x4bc6ff, 0.85);
      g.strokeCircle(this.x, this.y, rr);
      // 鎖鏈感：環上 8 個小點
      g.fillStyle(0x9adcff, 0.9);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + now / 500;
        g.fillCircle(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 2.5);
      }
      if (!this.isEmpowered(now)) this.setTint(0x88b8d8); // 非強化時才染青灰
    } else if (this.rootMark.visible) {
      this.rootMark.setVisible(false);
      this.rootRing.setVisible(false).clear();
      if (!this.isEmpowered(now) && this.tintTopLeft === 0x88b8d8) this.clearTint();
    }
  }

  /** v40(2)：畫強化環繞特效——3 個金色光點繞角色公轉 + 脈動光圈（不放大角色本體） */
  private drawEmpowerOrbit(now: number): void {
    const g = this.empowerOrbit;
    g.setVisible(true).clear();
    const R = GameConfig.player.radius;
    const orbitR = R + 12 + Math.sin(now / 160) * 3; // 脈動半徑
    // 脈動光圈
    g.lineStyle(2, 0xffe066, 0.5 + 0.3 * (0.5 + 0.5 * Math.sin(now / 200)));
    g.strokeCircle(this.x, this.y, orbitR);
    // 3 個繞轉光點
    const spin = now / 300; // 公轉角速度
    g.fillStyle(0xfff2a8, 0.95);
    for (let i = 0; i < 3; i++) {
      const a = spin + (i / 3) * Math.PI * 2;
      g.fillCircle(this.x + Math.cos(a) * orbitR, this.y + Math.sin(a) * orbitR, 4);
    }
  }

  /**
   * ★v60 階段3:強化【變身造型】——在角色本體上疊繪(不放大):
   * ①glow外框(粗描邊圈脈動) ②內光環(順轉光點) ③外光環(反轉、能量橙紅) ④弧形能量帶。
   */
  private drawEmpowerForm(now: number): void {
    const form = GameConfig.combo.empower.form;
    const g = this.empowerOrbit;
    g.setVisible(true).clear();
    const R = GameConfig.player.radius;
    // ①glow 外框:粗描邊圈,亮度脈動(像被能量包覆)
    const glowA = 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(now / 150));
    g.lineStyle(4, form.outlineColor, glowA);
    g.strokeCircle(this.x, this.y, R + 5 + Math.sin(now / 180) * 1.5);
    // ②內光環 + 順轉光點
    const r1 = R + 13 + Math.sin(now / 160) * 3;
    g.lineStyle(2, form.ringColor, 0.6);
    g.strokeCircle(this.x, this.y, r1);
    const spin1 = now / 260;
    g.fillStyle(0xfff2a8, 0.95);
    const n = form.orbitDots;
    for (let i = 0; i < n; i++) {
      const a = spin1 + (i / n) * Math.PI * 2;
      g.fillCircle(this.x + Math.cos(a) * r1, this.y + Math.sin(a) * r1, 4);
    }
    // ③外光環(反向轉) + 能量橙紅弧
    const r2 = R + 24 + Math.cos(now / 200) * 3;
    const spin2 = -now / 340;
    g.lineStyle(3, form.ring2Color, 0.55);
    for (let i = 0; i < 3; i++) {
      const a0 = spin2 + (i / 3) * Math.PI * 2;
      g.beginPath();
      g.arc(this.x, this.y, r2, a0, a0 + 0.9, false);
      g.strokePath();
    }
  }

  /** ★v60:強化造型上升粒子(能量感)——on=true 建立/發射,false 停止清除。輕量、僅造型期間。 */
  private ensureEmpowerParticles(on: boolean): void {
    if (on) {
      if (!this.empowerParticles) {
        const form = GameConfig.combo.empower.form;
        const R = GameConfig.player.radius;
        this.empowerParticles = this.scene.add.particles(this.x, this.y, 'spark', {
          speed: { min: 20, max: 50 }, angle: { min: 250, max: 290 }, // 向上飄
          lifespan: 650, scale: { start: 0.5, end: 0 }, alpha: { start: 0.9, end: 0 },
          tint: [...form.particleTint], frequency: form.particleFreq, quantity: 1, blendMode: 'ADD',
          emitZone: { type: 'edge', source: new Phaser.Geom.Circle(0, 0, R), quantity: 8 } as any
        }).setDepth(9);
        this.empowerParticles.startFollow(this);
      }
    } else if (this.empowerParticles) {
      this.empowerParticles.destroy();
      this.empowerParticles = undefined;
    }
  }

  /** 角色陣亡：灰掉、停止、標籤標示 */
  die(): void {
    this.alive = false;
    this.isDashing = false;
    this.dashToItem = false;
    this.isBursting = false;
    this.dashShielded = false;
    this.skillLockUntil = 0;
    this.rootedUntil = 0; // v45(5)：死亡清定身
    this.rootMark.setVisible(false);
    this.rootRing.setVisible(false).clear();
    this.lockedTarget = null;
    this.setAngle(0);
    this.shieldAura.setVisible(false);
    this.stopMoving();
    this.setTint(0x555555);
    this.setAlpha(0.4);
    this.ensureEmpowerParticles(false); // ★v60:死亡清強化造型粒子
    this.empowerOrbit.setVisible(false).clear();
    (this.body as Phaser.Physics.Arcade.Body).enable = false;
    this.label.setText(`${GameConfig.characters.labels[this.index]} ✖`);
    this.label.setColor('#888888');
    // v19：死亡隱藏腳下血鬥氣條與爆發標記
    this.hpBarBg.setVisible(false);
    this.hpBar.setVisible(false);
    this.spiritBar.setVisible(false);
    this.burstMarkTween?.remove();
    this.burstMarkTween = undefined;
    this.burstMark.setScale(1);
    this.burstMark.setVisible(false);
  }

  /**
   * v16：原地滿血復活（給 P1 的 R 熱鍵用）。還原 die() 的所有狀態：
   * 血回滿、清灰化/半透明/✖標籤、恢復物理與可操控；鬥氣歸零。
   */
  revive(): void {
    this.alive = true;
    this.hp = GameConfig.player.maxHp;
    this.spirit = 0; // 復活鬥氣歸零（乾淨重來）
    this.isDashing = false;
    this.dashToItem = false;
    this.isBursting = false;
    this.dashShielded = false;
    this.skillLockUntil = 0;
    this.lockedTarget = null;
    this.invulnUntil = 0;
    this.setAngle(0);
    this.setScale(1);
    this.clearTint();
    this.setAlpha(1);
    this.shieldAura.setVisible(false);
    (this.body as Phaser.Physics.Arcade.Body).enable = true;
    this.stopMoving();
    this.label.setText(GameConfig.characters.labels[this.index]);
    this.label.setColor('#ffffff');
    this.label.setVisible(true);
    // v19：復活恢復腳下血鬥氣條顯示（爆發標記由 syncLabel 依狀態決定）
    this.hpBarBg.setVisible(true);
    this.hpBar.setVisible(true);
    this.spiritBar.setVisible(true);
    this.burstMark.setVisible(false);
  }
}
