import Phaser from 'phaser';
import { GameConfig } from '../config';

/** 一個角色(玩家或BOT)在推人生存的狀態 */
interface Fighter {
  index: number;
  isBot: boolean;
  sprite: Phaser.GameObjects.Image;
  x: number; y: number;
  alive: boolean;
  // 被推飛:短暫失控(不能自主移動),被 vx/vy 帶著跑,摩擦衰減
  stunUntil: number;
  vx: number; vy: number;
  // 推人 CD
  nextPushAt: number;
  // BOT AI
  nextDecideAt: number;
  // ★v2:面向(單位向量,決定空白推人的方向);由移動方向更新,停下保留最後面向
  faceX: number; faceY: number;
  // ★v7:短衝撞人——衝到何時、衝速度向量、這次衝已撞過誰(避免同一次衝重複推)
  dashUntil: number;
  dashVx: number; dashVy: number;
  dashHit: Set<number>;
}

/** 地面預警圈:填滿→爆,圈內出局 */
interface WarnRing {
  x: number; y: number;
  radius: number;
  startAt: number;
  fillMs: number;
  exploded: boolean;
  gfx: Phaser.GameObjects.Graphics;
}

/**
 * 小遊戲：推人生存(閃躲類,非戰鬥)。1真人+3BOT。地面預警圈填滿→爆,圈內出局;空白推附近的人(可推進圈害死)。
 * 60秒撐到最後活著者勝。難度隨時間遞增(圈更多/更大/填滿更快)。完全獨立於 GameScene 戰鬥邏輯。
 */
export class PushSurvivalScene extends Phaser.Scene {
  private cfg = GameConfig.pushSurvival;
  private arena!: { left: number; right: number; top: number; bottom: number; cx: number; cy: number };
  private fighters!: Fighter[];
  private rings!: WarnRing[];
  private endsAt = 0;
  private startedAt = 0;
  private nextRingAt = 0;
  private lastRingSpawnAt = 0;
  private nextShakeAt = 0;
  private faceIndicator?: Phaser.GameObjects.Graphics;
  private running = false;
  private slowFactor = 1;     // ★慢動作(第3人出局決勝)
  private finishing = false;  // ★結束演出進行中
  private phase: 'intro' | 'ready' | 'playing' | 'ended' = 'intro';
  private introLayer?: Phaser.GameObjects.Container;
  private readyText?: Phaser.GameObjects.Text;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private timerText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;

  // 結算按鈕鍵盤選
  private endButtons: Array<{ x: number; y: number; cb: () => void }> = [];
  private endSelected = 0;
  private endHighlight?: Phaser.GameObjects.Rectangle;

  constructor() {
    super('PushSurvivalScene');
  }

  create(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const pad = GameConfig.arena.padding;
    this.arena = {
      left: pad, right: w - pad, top: pad + 40, bottom: h - pad,
      cx: w / 2, cy: (pad + 40 + h - pad) / 2
    };
    this.rings = [];
    this.endButtons = [];
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 0, w, h, 0x0a0c14, 0.25).setOrigin(0, 0).setDepth(0);
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(GameConfig.arena.borderThickness, GameConfig.arena.borderColor, 1);
    border.strokeRect(this.arena.left, this.arena.top, this.arena.right - this.arena.left, this.arena.bottom - this.arena.top);

    this.setupFighters();
    this.setupHud();

    // 輸入(八方向 + 空白推人)
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey(KC.UP), down: kb.addKey(KC.DOWN), left: kb.addKey(KC.LEFT), right: kb.addKey(KC.RIGHT),
      w: kb.addKey(KC.W), a: kb.addKey(KC.A), s: kb.addKey(KC.S), d: kb.addKey(KC.D)
    };
    kb.addKey(KC.SPACE).on('down', () => this.onSpace());
    kb.addKey(KC.ENTER).on('down', () => this.onSpace());
    kb.addKey(KC.ESC).on('down', () => this.quitToMenu());

    this.phase = 'intro';
    this.running = false;
    this.showIntro();
  }

  private setupFighters(): void {
    const a = this.arena;
    // 4 角色分散在四個象限預備點
    const pts = [
      { x: a.cx - 180, y: a.cy + 120 },
      { x: a.cx + 180, y: a.cy + 120 },
      { x: a.cx - 180, y: a.cy - 120 },
      { x: a.cx + 180, y: a.cy - 120 }
    ];
    this.fighters = [];
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      const sprite = this.add.image(p.x, p.y, `char-${i}`).setDepth(10);
      // 名字標籤
      const label = this.add.text(p.x, p.y - 26, this.cfg.names[i], {
        fontFamily: 'monospace', fontSize: '12px', color: '#' + this.cfg.colors[i].toString(16).padStart(6, '0'),
        fontStyle: 'bold', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(11);
      (sprite as unknown as { __label: Phaser.GameObjects.Text }).__label = label;
      this.fighters.push({
        index: i, isBot: i !== 0, sprite, x: p.x, y: p.y, alive: true,
        stunUntil: 0, vx: 0, vy: 0, nextPushAt: 0, nextDecideAt: 0,
        // 預設面向場中心(讓一開始就有合理朝向)
        faceX: Math.sign(this.arena.cx - p.x) || 1, faceY: Math.sign(this.arena.cy - p.y) || 0,
        dashUntil: 0, dashVx: 0, dashVy: 0, dashHit: new Set<number>()
      });
    }
    // ★玩家面向指示(圓圈+箭頭)——顯示「空白會往這個方向推人」,只 P1
    this.faceIndicator = this.add.graphics().setDepth(9);
  }

  private setupHud(): void {
    const w = GameConfig.width;
    this.timerText = this.add.text(w / 2, 30, '60', {
      fontFamily: 'monospace', fontSize: '40px', color: '#7ee7ff', fontStyle: 'bold', stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5).setDepth(21);
    this.aliveText = this.add.text(w - 20, 16, '存活: 4', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffe66d', fontStyle: 'bold', stroke: '#000', strokeThickness: 3
    }).setOrigin(1, 0).setDepth(21);
  }

  private showIntro(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const cont = this.add.container(0, 0).setDepth(50);
    cont.add(this.add.rectangle(0, 0, w, h, 0x05070c, 0.82).setOrigin(0, 0));
    cont.add(this.add.rectangle(w / 2, h / 2, 660, 400, 0x121a2e, 0.98).setStrokeStyle(3, 0xff5a6e, 0.9));
    cont.add(this.add.text(w / 2, h / 2 - 158, '💥 推人生存', {
      fontFamily: 'monospace', fontSize: '38px', color: '#ff8a9b', fontStyle: 'bold'
    }).setOrigin(0.5));
    const rules = [
      '● 地面會出現【紅色預警圈】→ 由內填滿 → 填滿就【爆炸】',
      '● 爆炸瞬間【圈內的人出局】！看到紅圈快跑開閃避',
      '● 用【方向鍵 / WASD】走位（只能走、不能衝刺）',
      '● 按【空白鍵】推附近最近的人 → 把他推飛一段',
      '  （被推的人短暫失控，可趁機【把人推進爆炸圈害死】！）',
      '● 推人有冷卻時間；越後期圈越多、越大、填滿越快',
      '● 撐到 60 秒還活著者勝！對手是 3 個 BOT'
    ];
    cont.add(this.add.text(w / 2, h / 2 - 12, rules.join('\n'), {
      fontFamily: 'monospace', fontSize: '15px', color: '#e2e8f0', align: 'left', lineSpacing: 9
    }).setOrigin(0.5));
    const hint = this.add.text(w / 2, h / 2 + 158, '按【空白鍵】開始！', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffe66d', fontStyle: 'bold'
    }).setOrigin(0.5);
    cont.add(hint);
    this.tweens.add({ targets: hint, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
    cont.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    cont.on('pointerdown', () => this.startReady());
    this.introLayer = cont;
    this.timerText.setText(String(Math.ceil(this.cfg.durationMs / 1000)));
  }

  /** ★v6:intro 按空白後→進 ready 預備階段:大字倒數(3→2→1→開始!),角色不動/預警圈不出/計時未起,倒數完才 playing。 */
  private startReady(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'ready';
    if (this.introLayer) { this.introLayer.destroy(); this.introLayer = undefined; }
    this.running = false; // ready 期間 update 早退→不動/不出圈/不計時
    const w = GameConfig.width, h = GameConfig.height;
    this.readyText = this.add.text(w / 2, h / 2, '', {
      fontFamily: 'monospace', fontSize: '96px', color: '#ffe066', fontStyle: 'bold', stroke: '#000', strokeThickness: 8
    }).setOrigin(0.5).setDepth(45);
    const total = this.cfg.readyCountdownMs;
    const secs = Math.max(1, Math.round(total / 1000)); // 幾秒 → 幾個數字(3→ "3","2","1")
    const showBig = (txt: string) => {
      if (!this.readyText) return;
      this.readyText.setText(txt).setScale(1.6).setAlpha(1);
      this.tweens.add({ targets: this.readyText, scale: 1, duration: 300, ease: 'Back.out' });
    };
    // 立刻顯示第一個數(secs),之後每秒遞減;數到 1 的下一秒顯示「開始!」並隨即真正開始。
    let cur = secs;
    showBig(String(cur));
    this.time.addEvent({
      delay: 1000, repeat: secs - 1, // 觸發 secs 次:遞減到「開始!」
      callback: () => {
        cur -= 1;
        if (cur >= 1) { showBig(String(cur)); }
        else {
          showBig('開始!');
          // 「開始!」閃一下(~250ms)後真正開始
          this.time.delayedCall(280, () => {
            if (this.readyText) { this.readyText.destroy(); this.readyText = undefined; }
            this.startPlaying();
          });
        }
      }
    });
  }

  private startPlaying(): void {
    if (this.phase !== 'ready' && this.phase !== 'intro') return;
    this.phase = 'playing';
    if (this.introLayer) { this.introLayer.destroy(); this.introLayer = undefined; }
    if (this.readyText) { this.readyText.destroy(); this.readyText = undefined; }
    this.startedAt = this.time.now;
    this.endsAt = this.time.now + this.cfg.durationMs;
    this.nextRingAt = this.time.now + 800; // 開場稍等再出第一個圈
    this.running = true;
  }

  private onSpace(): void {
    if (this.phase === 'intro') { this.startReady(); return; }
    if (this.phase === 'ready') return; // 預備倒數中不接受操作(不能動/不能推)
    if (this.phase === 'playing') this.playerPush();
    else if (this.phase === 'ended') { const b = this.endButtons[this.endSelected]; if (b) b.cb(); }
  }

  // 遊戲進度 0→1
  private progress(): number {
    return Phaser.Math.Clamp((this.time.now - this.startedAt) / this.cfg.durationMs, 0, 1);
  }

  // ── 玩家推人(改:朝面向短衝撞人) ──
  private playerPush(): void {
    const p = this.fighters[0];
    if (!p.alive || this.time.now < p.nextPushAt) return;
    this.startDash(p);
  }

  /** ★v7 短衝撞人:角色朝面向【短衝一段(dash)】,衝的過程中撞到其他角色→撞到者被推飛。取代原地推。 */
  private startDash(pusher: Fighter): void {
    if (this.time.now < pusher.stunUntil) return; // 被推失控中不能衝
    pusher.nextPushAt = this.time.now + this.cfg.pushCooldownMs;
    let nx = pusher.faceX, ny = pusher.faceY;
    const flen = Math.hypot(nx, ny);
    if (flen < 0.001) { nx = 1; ny = 0; } else { nx /= flen; ny /= flen; }
    const dashV = this.cfg.dashDist / (this.cfg.dashDurationMs / 1000);
    pusher.dashVx = nx * dashV;
    pusher.dashVy = ny * dashV;
    pusher.dashUntil = this.time.now + this.cfg.dashDurationMs;
    pusher.dashHit = new Set<number>();
    // 衝的視覺回饋
    this.spawnPushFx(pusher.x + nx * 18, pusher.y + ny * 18);
  }

  /** 短衝期間的位移 + 撞人判定(每幀 update 呼叫)。撞到→該角色朝【衝的方向】被推飛。 */
  private updateDashes(dt: number): void {
    const a = this.arena, r = this.cfg.radius;
    for (const pusher of this.fighters) {
      if (!pusher.alive || this.time.now >= pusher.dashUntil) continue;
      if (this.time.now < pusher.stunUntil) { pusher.dashUntil = 0; continue; } // 衝到一半被推飛→中斷衝
      // 位移
      pusher.x = Phaser.Math.Clamp(pusher.x + pusher.dashVx * dt, a.left + r, a.right - r);
      pusher.y = Phaser.Math.Clamp(pusher.y + pusher.dashVy * dt, a.top + r, a.bottom - r);
      this.clampFighter(pusher);
      // 撞人判定:衝者身體碰到別人(dist < 兩半徑和)→推飛(這次衝每人只推一次)
      const dlen = Math.hypot(pusher.dashVx, pusher.dashVy) || 1;
      const dnx = pusher.dashVx / dlen, dny = pusher.dashVy / dlen;
      for (const t of this.fighters) {
        if (t === pusher || !t.alive || pusher.dashHit.has(t.index)) continue;
        if (Math.hypot(t.x - pusher.x, t.y - pusher.y) < r * 2 + 2) {
          pusher.dashHit.add(t.index);
          this.knockAway(t, dnx, dny);
        }
      }
    }
  }

  /** 把目標朝 (nx,ny) 方向推飛(等速位移使 stun 期間走 pushDistance),失控 stun。 */
  private knockAway(target: Fighter, nx: number, ny: number): void {
    const knockV = this.cfg.pushDistance / (this.cfg.pushStunMs / 1000);
    target.vx = nx * knockV;
    target.vy = ny * knockV;
    target.stunUntil = this.time.now + this.cfg.pushStunMs;
    this.tweens.add({ targets: target.sprite, scale: { from: 1.3, to: 1 }, duration: 200 });
  }

  private spawnPushFx(x: number, y: number): void {
    const ring = this.add.circle(x, y, 8, 0xffffff, 0.7).setDepth(15);
    this.tweens.add({ targets: ring, radius: 40, alpha: 0, duration: 250, onComplete: () => ring.destroy() });
  }

  // ── 預警圈:難度遞增(頻率↑範圍↑填滿↓) ──
  private spawnWarnRing(): void {
    const a = this.arena;
    const t = this.progress();
    const radius = Phaser.Math.Linear(this.cfg.ringRadiusStart, this.cfg.ringRadiusEnd, t);
    const fillMs = Phaser.Math.Linear(this.cfg.ringFillStartMs, this.cfg.ringFillEndMs, t);
    let x: number, y: number;
    // ★v3:隨機+追人各半——擲骰命中→開在隨機存活角色附近(±偏移,逼玩家一直動);否則純隨機
    const alive = this.fighters.filter(f => f.alive);
    if (alive.length > 0 && Math.random() < this.cfg.ringChaseChance) {
      const tgt = alive[Phaser.Math.Between(0, alive.length - 1)];
      const off = this.cfg.ringChaseOffset;
      x = tgt.x + Phaser.Math.Between(-off, off);
      y = tgt.y + Phaser.Math.Between(-off, off);
      // 夾在場內(圈完整落在競技場)
      x = Phaser.Math.Clamp(x, a.left + radius, a.right - radius);
      y = Phaser.Math.Clamp(y, a.top + radius, a.bottom - radius);
    } else {
      x = Phaser.Math.Between(a.left + radius, a.right - radius);
      y = Phaser.Math.Between(a.top + radius, a.bottom - radius);
    }
    const gfx = this.add.graphics().setDepth(3);
    this.rings.push({ x, y, radius, startAt: this.time.now, fillMs, exploded: false, gfx });
  }

  private updateRings(): void {
    const t = this.progress();
    // ★維持「多個並存」的目標圈數(難度遞增),各圈獨立填滿→爆自然錯開時間差。
    const targetConcurrent = Math.round(Phaser.Math.Linear(this.cfg.ringConcurrentStart, this.cfg.ringConcurrentEnd, t));
    const interval = Phaser.Math.Linear(this.cfg.ringIntervalStartMs, this.cfg.ringIntervalEndMs, t);
    // 補圈到目標數用【較短的 fill-up stagger】(否則慢於 fillMs、圈爆得比補得快、湊不到目標數);
    // 額外的 interval 節奏再多生(製造連續波)。兩者都用 lastRingSpawnAt 錯開(不同幀生→爆炸時間差)。
    const fillupStagger = Math.min(this.cfg.ringStaggerMs, 180);
    const belowTarget = this.rings.length < targetConcurrent;
    const staggerOk = this.time.now - this.lastRingSpawnAt >= (belowTarget ? fillupStagger : this.cfg.ringStaggerMs);
    if (staggerOk && (belowTarget || this.time.now >= this.nextRingAt)) {
      this.spawnWarnRing();
      this.lastRingSpawnAt = this.time.now;
      if (this.time.now >= this.nextRingAt) this.nextRingAt = this.time.now + interval;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      const p = Phaser.Math.Clamp((this.time.now - r.startAt) / r.fillMs, 0, 1);
      // 繪製:外框 + 由內往外填滿實心 + 邊閃
      r.gfx.clear();
      const blink = Math.floor(this.time.now / 90) % 2 === 0;
      r.gfx.lineStyle(3, this.cfg.ringColor, blink ? 0.95 : 0.55);
      r.gfx.strokeCircle(r.x, r.y, r.radius);
      r.gfx.fillStyle(this.cfg.ringFillColor, 0.26 + 0.06 * p);
      r.gfx.fillCircle(r.x, r.y, r.radius * p);
      if (p >= 1 && !r.exploded) {
        r.exploded = true;
        this.explodeRing(r);
        r.gfx.destroy();
        this.rings.splice(i, 1);
      }
    }
  }

  private explodeRing(r: WarnRing): void {
    // 爆炸特效:擴張環 + 核心閃 + 震動
    const ring = this.add.circle(r.x, r.y, r.radius * 0.4, 0xff6a1a, 0.8).setDepth(16);
    this.tweens.add({ targets: ring, radius: r.radius, alpha: 0, duration: 320, onComplete: () => ring.destroy() });
    const core = this.add.circle(r.x, r.y, r.radius * 0.3, 0xffd400, 0.7).setDepth(16);
    this.tweens.add({ targets: core, alpha: 0, duration: 200, onComplete: () => core.destroy() });
    // ★v2:震動降低 + 節流(短時間內多圈連爆只震一次,避免後期狂抖暈)
    if (this.time.now >= this.nextShakeAt) {
      this.cameras.main.shake(this.cfg.shakeDurationMs, this.cfg.shakeIntensity);
      this.nextShakeAt = this.time.now + this.cfg.shakeThrottleMs;
    }
    // 圈內存活角色→出局
    for (const f of this.fighters) {
      if (!f.alive) continue;
      if (Math.hypot(f.x - r.x, f.y - r.y) <= r.radius) this.eliminate(f);
    }
  }

  private eliminate(f: Fighter): void {
    if (!f.alive) return;
    f.alive = false;
    f.vx = 0; f.vy = 0;
    if (f.index === 0 && this.faceIndicator) this.faceIndicator.clear(); // P1出局→清面向指示
    // 變灰觀戰影
    f.sprite.setTint(0x555555).setAlpha(0.35);
    const label = (f.sprite as unknown as { __label: Phaser.GameObjects.Text }).__label;
    if (label) label.setAlpha(0.35);
    // 出局特效
    const x = this.add.text(f.x, f.y - 30, '出局', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ff5555', fontStyle: 'bold', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: x, y: f.y - 60, alpha: 0, duration: 800, onComplete: () => x.destroy() });
    this.updateAliveHud();
  }

  private updateAliveHud(): void {
    const n = this.fighters.filter(f => f.alive).length;
    this.aliveText.setText('存活: ' + n);
  }

  update(_time: number, delta: number): void {
    if (!this.running) return;
    const dt = (delta / 1000) * this.slowFactor; // ★慢動作縮放
    const remainMs = Math.max(0, this.endsAt - this.time.now);
    this.timerText.setText(String(Math.ceil(remainMs / 1000)));

    this.updateRings();
    this.updatePlayer(dt);
    for (let i = 1; i < 4; i++) this.updateBot(this.fighters[i], dt);
    this.updateDashes(dt); // ★短衝撞人位移+撞人判定
    this.applyKnockback(dt);
    this.separateFighters(); // ★角色間被動身體推擠(輕、只防重疊,獨立於空白主動推飛)
    // ★面向指示在所有位移(走位/推飛/身體推擠)之後畫→用角色【最終即時位置】,被推飛時絕不留原地
    this.drawFaceIndicator(this.fighters[0]);

    // ★結束:第3人出局(剩最後1人)→慢動作決勝;60秒到多人活→正常緩衝。finishing 中不重複觸發。
    if (!this.finishing) {
      const aliveCount = this.fighters.filter(f => f.alive).length;
      if (aliveCount <= 1) { this.beginFinish(true); }
      else if (remainMs <= 0) { this.beginFinish(false); }
    }
  }

  /** ★結束演出緩衝:dramatic(剩最後1人)→慢動作1.2秒→恢復→短停→結算;否則(60秒多人活)正常緩衝1秒→結算。 */
  private beginFinish(dramatic: boolean): void {
    if (this.finishing) return;
    this.finishing = true;
    this.running = false;
    if (dramatic) {
      this.slowFactor = 0.35;
      this.tweens.timeScale = 0.5;
      const winner = this.fighters.find(f => f.alive);
      if (winner) this.tweens.add({ targets: winner.sprite, scale: { from: 1, to: 1.5 }, duration: 500, yoyo: true, repeat: 1 });
      this.running = true; // 慢動作期間仍演出(finishing 防重觸發)
      this.time.delayedCall(1200, () => {
        this.slowFactor = 1;
        this.tweens.timeScale = 1;
        this.running = false;
        this.time.delayedCall(500, () => this.endGame());
      });
    } else {
      this.time.delayedCall(1000, () => this.endGame());
    }
  }

  /**
   * ★角色間被動身體推擠:每幀存活角色兩兩若重疊(dist<兩半徑和)→各推一半分開(手動位置校正分離,同 separateCharacterFromEnemies)。
   * 輕(只推出重疊量、不給速度、不失控)→走位碰到自然擠開、不穿透。出局灰影不參與。clamp 留場內。
   */
  private separateFighters(): void {
    if (!this.cfg.bodySeparate) return;
    const a = this.arena, r = this.cfg.radius;
    const minDist = r * 2;
    const live = this.fighters.filter(f => f.alive);
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const A = live[i], B = live[j];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist && d > 0.001) {
          const push = (minDist - d) / 2;
          const nx = dx / d, ny = dy / d;
          A.x = Phaser.Math.Clamp(A.x - nx * push, a.left + r, a.right - r);
          A.y = Phaser.Math.Clamp(A.y - ny * push, a.top + r, a.bottom - r);
          B.x = Phaser.Math.Clamp(B.x + nx * push, a.left + r, a.right - r);
          B.y = Phaser.Math.Clamp(B.y + ny * push, a.top + r, a.bottom - r);
        } else if (d <= 0.001) {
          // 完全重疊→給個預設方向推開
          A.x = Phaser.Math.Clamp(A.x - r, a.left + r, a.right - r);
          B.x = Phaser.Math.Clamp(B.x + r, a.left + r, a.right - r);
        }
        A.sprite.setPosition(A.x, A.y); B.sprite.setPosition(B.x, B.y);
        const la = (A.sprite as unknown as { __label: Phaser.GameObjects.Text }).__label; if (la) la.setPosition(A.x, A.y - 26);
        const lb = (B.sprite as unknown as { __label: Phaser.GameObjects.Text }).__label; if (lb) lb.setPosition(B.x, B.y - 26);
      }
    }
  }

  private clampFighter(f: Fighter): void {
    const a = this.arena, r = this.cfg.radius;
    f.x = Phaser.Math.Clamp(f.x, a.left + r, a.right - r);
    f.y = Phaser.Math.Clamp(f.y, a.top + r, a.bottom - r);
    f.sprite.setPosition(f.x, f.y);
    const label = (f.sprite as unknown as { __label: Phaser.GameObjects.Text }).__label;
    if (label) label.setPosition(f.x, f.y - 26);
  }

  // 被推飛的位移(stun 期間【等速】帶著跑=走完 pushDistance);撞牆停;stun 結束歸零。
  private applyKnockback(_dt: number): void {
    const a = this.arena, r = this.cfg.radius;
    const dt = _dt;
    for (const f of this.fighters) {
      if (!f.alive) continue;
      // stun 結束→停止被推位移
      if (this.time.now >= f.stunUntil) { f.vx = 0; f.vy = 0; continue; }
      if (f.vx === 0 && f.vy === 0) continue;
      let nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
      if (nx < a.left + r) { nx = a.left + r; f.vx = 0; }
      else if (nx > a.right - r) { nx = a.right - r; f.vx = 0; }
      if (ny < a.top + r) { ny = a.top + r; f.vy = 0; }
      else if (ny > a.bottom - r) { ny = a.bottom - r; f.vy = 0; }
      f.x = nx; f.y = ny;
      this.clampFighter(f);
    }
  }

  private updatePlayer(dt: number): void {
    const p = this.fighters[0];
    if (!p.alive) return;
    // 面向指示改在 update() 末端(所有位移後)統一繪製,確保被推飛時也跟著角色即時位置
    if (this.time.now < p.stunUntil) return; // 被推失控中→不能自主移動(applyKnockback 帶著跑)
    let vx = 0, vy = 0;
    if (this.keys.left.isDown || this.keys.a.isDown) vx -= 1;
    if (this.keys.right.isDown || this.keys.d.isDown) vx += 1;
    if (this.keys.up.isDown || this.keys.w.isDown) vy -= 1;
    if (this.keys.down.isDown || this.keys.s.isDown) vy += 1;
    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      p.x += (vx / len) * this.cfg.moveSpeed * dt;
      p.y += (vy / len) * this.cfg.moveSpeed * dt;
      p.sprite.setFlipX(vx < 0);
      // ★由移動方向更新面向(停下時保留最後面向)
      p.faceX = vx / len; p.faceY = vy / len;
    }
    this.clampFighter(p);
  }

  /** ★玩家面向指示:腳下圓圈 + 朝面向的箭頭(顯示「空白會往這方向推人」) */
  private drawFaceIndicator(p: Fighter): void {
    const g = this.faceIndicator;
    if (!g) return;
    g.clear();
    if (!p.alive || this.phase !== 'playing') return;
    const r = this.cfg.radius;
    // 腳下圓圈
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeCircle(p.x, p.y, r + 8);
    // 朝面向的箭頭
    const ang = Math.atan2(p.faceY, p.faceX);
    const base = r + 10, tip = r + 30;
    const bx = p.x + Math.cos(ang) * base, by = p.y + Math.sin(ang) * base;
    const tx = p.x + Math.cos(ang) * tip, ty = p.y + Math.sin(ang) * tip;
    g.lineStyle(4, 0xffe066, 0.95);
    g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.strokePath();
    // 箭頭頭(兩短線)
    const ah = 9;
    g.beginPath();
    g.moveTo(tx, ty); g.lineTo(tx - Math.cos(ang - 0.5) * ah, ty - Math.sin(ang - 0.5) * ah);
    g.moveTo(tx, ty); g.lineTo(tx - Math.cos(ang + 0.5) * ah, ty - Math.sin(ang + 0.5) * ah);
    g.strokePath();
  }

  // ── BOT AI:①閃預警圈(身處/接近正在填的圈→往圈外最近安全方向跑)②推人(附近有人且CD好→推,朝圈方向更好) ──
  private updateBot(f: Fighter, dt: number): void {
    if (!f.alive) return;
    if (this.time.now < f.stunUntil) return; // 失控中

    // 決策節流
    let moveX = 0, moveY = 0;
    // ①閃圈:計算所有「將爆或填充中」的圈對 f 的排斥向量(在圈內或邊緣→往外跑)。★v6:偵測邊際 botDangerMargin(縮小→較晚反應、沒那麼準=變弱)
    let danger = false;
    const margin = this.cfg.botDangerMargin;
    for (const r of this.rings) {
      const d = Math.hypot(f.x - r.x, f.y - r.y);
      if (d < r.radius + margin) { // 在危險範圍內
        danger = true;
        const away = d > 0.001 ? 1 : 0;
        const nx = away ? (f.x - r.x) / d : 1, ny = away ? (f.y - r.y) / d : 0;
        const weight = (r.radius + margin - d); // 越靠圈心越急
        moveX += nx * weight; moveY += ny * weight;
      }
    }
    if (danger) {
      const len = Math.hypot(moveX, moveY) || 1;
      f.x += (moveX / len) * this.cfg.botMoveSpeed * dt;
      f.y += (moveY / len) * this.cfg.botMoveSpeed * dt;
      f.sprite.setFlipX(moveX < 0);
      f.faceX = moveX / len; f.faceY = moveY / len;
      this.clampFighter(f);
      return; // 逃命優先
    }

    // ②不危險時:週期決策——附近有人且CD好→推(先把面向對準要推的人,再推=往面向推)
    if (this.time.now >= f.nextDecideAt) {
      f.nextDecideAt = this.time.now + this.cfg.botReactMs;
      // 找 pushRange 內最近的人
      let near: Fighter | null = null; let nd: number = this.cfg.pushRange;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d <= nd) { nd = d; near = o; }
      }
      if (near && this.time.now >= f.nextPushAt && Math.random() < this.cfg.botPushChance) {
        // 面向對準要推的人→朝其短衝撞(BOT 也用位移撞人)
        const ddx = near.x - f.x, ddy = near.y - f.y, dl = Math.hypot(ddx, ddy) || 1;
        f.faceX = ddx / dl; f.faceY = ddy / dl;
        this.startDash(f);
      }
    }
    // 平時朝場中央附近緩慢遊走(避免全部貼邊),朝最近其他人靠近一點以便推
    let tx = this.arena.cx, ty = this.arena.cy;
    let closest: Fighter | null = null; let cd = 1e9;
    for (const o of this.fighters) {
      if (o === f || !o.alive) continue;
      const d = Math.hypot(o.x - f.x, o.y - f.y);
      if (d < cd) { cd = d; closest = o; }
    }
    if (closest && cd > this.cfg.pushRange * 0.7) { tx = closest.x; ty = closest.y; }
    const dx = tx - f.x, dy = ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d > 6) {
      f.x += (dx / d) * this.cfg.botMoveSpeed * 0.6 * dt;
      f.y += (dy / d) * this.cfg.botMoveSpeed * 0.6 * dt;
      f.sprite.setFlipX(dx < 0);
      f.faceX = dx / d; f.faceY = dy / d;
    }
    this.clampFighter(f);
  }

  // ── 結算:存活者/名次 + 再玩/選單(方向鍵選+空白確定) ──
  private endGame(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.running = false;
    if (this.faceIndicator) this.faceIndicator.clear(); // 清面向指示
    const w = GameConfig.width, h = GameConfig.height;
    this.add.rectangle(0, 0, w, h, 0x000000, 0.72).setOrigin(0, 0).setDepth(40);
    const survivors = this.fighters.filter(f => f.alive);
    this.add.text(w / 2, h * 0.2, '⏱ 結束！', {
      fontFamily: 'monospace', fontSize: '46px', color: '#ffe66d', stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setDepth(41);
    let title: string;
    if (survivors.length === 1) title = '🏆 勝者：' + this.cfg.names[survivors[0].index];
    else if (survivors.length > 1) title = '🏆 平手存活：' + survivors.map(s => this.cfg.names[s.index]).join('、');
    else title = '同歸於盡，無人存活';
    this.add.text(w / 2, h * 0.3, title, {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', stroke: '#000', strokeThickness: 4, align: 'center', wordWrap: { width: w * 0.8 }
    }).setOrigin(0.5).setDepth(41);
    // 名次:存活者優先,其餘依存活與否(本版簡化:存活=勝、出局=淘汰)
    this.fighters.forEach((f, i) => {
      const y = h * 0.42 + i * 34;
      const status = f.alive ? '存活 ✓' : '出局';
      this.add.text(w / 2, y, this.cfg.names[f.index] + '　' + status, {
        fontFamily: 'monospace', fontSize: '20px',
        color: '#' + this.cfg.colors[f.index].toString(16).padStart(6, '0'),
        fontStyle: f.alive ? 'bold' : 'normal', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(41);
    });
    this.endButtons = [];
    this.endSelected = 0;
    this.makeEndButton(w / 2 - 130, h * 0.82, '🔄 再玩一次', 0x4a90d9, () => this.scene.restart());
    this.makeEndButton(w / 2 + 130, h * 0.82, '← 小遊戲選單', 0x2d3748, () => this.quitToMenu());
    this.endHighlight = this.add.rectangle(0, 0, 232, 62).setStrokeStyle(4, 0xffe066, 1).setDepth(43);
    this.tweens.add({ targets: this.endHighlight, alpha: { from: 1, to: 0.4 }, duration: 600, yoyo: true, repeat: -1 });
    this.selectEndButton(0);
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    const toggle = () => this.selectEndButton(this.endSelected === 0 ? 1 : 0);
    kb.addKey(KC.LEFT).on('down', () => this.selectEndButton(0));
    kb.addKey(KC.RIGHT).on('down', () => this.selectEndButton(1));
    kb.addKey(KC.UP).on('down', toggle);
    kb.addKey(KC.DOWN).on('down', toggle);
    // 空白/Enter 確定由 onSpace(phase==='ended') 觸發;Enter 另綁
  }

  private selectEndButton(i: number): void {
    this.endSelected = i;
    const btn = this.endButtons[i];
    if (btn && this.endHighlight) this.endHighlight.setPosition(btn.x, btn.y);
  }

  private makeEndButton(x: number, y: number, label: string, color: number, cb: () => void): void {
    const bw = 220, bh = 50;
    const bg = this.add.rectangle(x, y, bw, bh, color, 0.95).setStrokeStyle(2, 0xffffff, 0.8).setDepth(41);
    this.add.text(x, y, label, { fontFamily: 'monospace', fontSize: '17px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5).setDepth(42);
    const c = this.add.container(0, 0, [bg]).setSize(bw, bh).setDepth(41);
    c.setInteractive(new Phaser.Geom.Rectangle(x - bw / 2, y - bh / 2, bw, bh), Phaser.Geom.Rectangle.Contains);
    const idx = this.endButtons.length;
    c.on('pointerover', () => { bg.setFillStyle(color, 1); this.selectEndButton(idx); });
    c.on('pointerdown', cb);
    this.endButtons.push({ x, y, cb });
  }

  private quitToMenu(): void {
    this.scene.start('MinigameMenuScene');
  }
}
