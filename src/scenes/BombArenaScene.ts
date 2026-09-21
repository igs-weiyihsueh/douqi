import Phaser from 'phaser';
import { GameConfig } from '../config';

/** 炸彈人對戰的角色(玩家或BOT) */
interface Fighter {
  index: number;
  isBot: boolean;
  sprite: Phaser.GameObjects.Image;
  x: number; y: number;
  alive: boolean;
  stunUntil: number;       // 被擊退失控(不能自主移動)
  vx: number; vy: number;  // 擊退速度
  faceX: number; faceY: number; // 面向(丟炸彈方向)
  holding: Bomb | null;    // 手上拿的炸彈(一次一顆)
  nextDecideAt: number;    // BOT 決策節流
}

type BombState = 'ground' | 'held' | 'flying' | 'fusing';

/** 一顆炸彈 */
interface Bomb {
  id: number;
  state: BombState;
  x: number; y: number;
  vx: number; vy: number;      // flying 時的速度
  travelled: number;           // flying 已飛距離
  owner: Fighter | null;       // 誰丟的(飛行中不撞自己)
  fuseAt: number;              // fusing:何時爆
  sprite: Phaser.GameObjects.Image;
  ring?: Phaser.GameObjects.Graphics; // fusing 的地面預警圈
  dead: boolean;               // 已爆/已移除
}

/**
 * 小遊戲「炸彈人對戰(丟炸彈版)」。
 * 撿地上炸彈→朝面向丟→撞人即爆 / 沒撞到落地倒數爆→爆炸圓範圍炸到出局 + 連鎖引爆 + 手上炸彈被炸也連爆。
 * 最後存活者勝(60秒到活著者一起贏)。1真人+3BOT。獨立於 GameScene。
 */
export class BombArenaScene extends Phaser.Scene {
  private cfg = GameConfig.bombArena;
  private arena!: { left: number; right: number; top: number; bottom: number; cx: number; cy: number };
  private fighters!: Fighter[];
  private bombs!: Bomb[];
  private bombIdSeq = 0;
  private endsAt = 0;
  private nextBombSpawnAt = 0;
  private nextShakeAt = 0;
  private running = false;
  private slowFactor = 1;       // ★慢動作:遊戲位移/tween 時間縮放(1=正常,0.35=慢動作)
  private finishing = false;    // ★結束演出(慢動作/緩衝)進行中,避免重複觸發 endGame
  // ★結束演出時序(timestamp 驅動,由 update 每幀推進;不依賴巢狀 delayedCall→避免任何路徑漏恢復造成永久卡)
  private finishSlowEndAt = 0;  // 慢動作恢復時間(0=不在慢動作)
  private finishEndGameAt = 0;  // 觸發 endGame 時間(0=未排定)
  private phase: 'intro' | 'ready' | 'playing' | 'ended' = 'intro';
  private introLayer?: Phaser.GameObjects.Container;
  private readyText?: Phaser.GameObjects.Text;
  private faceIndicator?: Phaser.GameObjects.Graphics;
  private pickHint?: Phaser.GameObjects.Graphics;
  private pickHintPulse = 0;

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private timerText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;

  private endButtons: Array<{ x: number; y: number; cb: () => void }> = [];
  private endSelected = 0;
  private endHighlight?: Phaser.GameObjects.Rectangle;

  constructor() { super('BombArenaScene'); }

  create(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const pad = GameConfig.arena.padding;
    this.arena = {
      left: pad, right: w - pad, top: pad + 40, bottom: h - pad,
      cx: w / 2, cy: (pad + 40 + h - pad) / 2
    };
    this.bombs = [];
    this.bombIdSeq = 0;
    this.endButtons = [];
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 0, w, h, 0x0a0c14, 0.25).setOrigin(0, 0).setDepth(0);
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(GameConfig.arena.borderThickness, GameConfig.arena.borderColor, 1);
    border.strokeRect(this.arena.left, this.arena.top, this.arena.right - this.arena.left, this.arena.bottom - this.arena.top);

    this.setupFighters();
    this.setupHud();
    this.pickHint = this.add.graphics().setDepth(4);
    this.faceIndicator = this.add.graphics().setDepth(9);

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
    const pts = [
      { x: a.cx - 200, y: a.cy + 130 },
      { x: a.cx + 200, y: a.cy + 130 },
      { x: a.cx - 200, y: a.cy - 130 },
      { x: a.cx + 200, y: a.cy - 130 }
    ];
    this.fighters = [];
    for (let i = 0; i < 4; i++) {
      const p = pts[i];
      const sprite = this.add.image(p.x, p.y, `char-${i}`).setDepth(10);
      const label = this.add.text(p.x, p.y - 26, this.cfg.names[i], {
        fontFamily: 'monospace', fontSize: '12px', color: '#' + this.cfg.colors[i].toString(16).padStart(6, '0'),
        fontStyle: 'bold', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(11);
      (sprite as unknown as { __label: Phaser.GameObjects.Text }).__label = label;
      this.fighters.push({
        index: i, isBot: i !== 0, sprite, x: p.x, y: p.y, alive: true,
        stunUntil: 0, vx: 0, vy: 0,
        faceX: Math.sign(a.cx - p.x) || 1, faceY: Math.sign(a.cy - p.y) || 0,
        holding: null, nextDecideAt: 0
      });
    }
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

  // ── 進場說明 → ready 倒數 → playing ──
  private showIntro(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const cont = this.add.container(0, 0).setDepth(50);
    cont.add(this.add.rectangle(0, 0, w, h, 0x05070c, 0.82).setOrigin(0, 0));
    cont.add(this.add.rectangle(w / 2, h / 2, 680, 420, 0x121a2e, 0.98).setStrokeStyle(3, 0xffa23f, 0.9));
    cont.add(this.add.text(w / 2, h / 2 - 168, '💣 炸彈人對戰', {
      fontFamily: 'monospace', fontSize: '38px', color: '#ffc07a', fontStyle: 'bold'
    }).setOrigin(0.5));
    const rules = [
      '● 地上會不斷出現【炸彈】→ 靠近按【空白鍵】撿起(拿在頭上、可拿著走)',
      '● 手上有炸彈時按【空白鍵】→ 朝【面向方向】丟出炸彈',
      '  (用【方向鍵 / WASD】走位調整面向,腳下圓圈+箭頭就是丟的方向)',
      '● 炸彈飛行中【撞到人 → 立刻爆炸】！沒撞到人【落地 → 倒數約 1.5 秒才爆】',
      '● 爆炸有【圓形範圍】→ 範圍內的人【出局】、並把附近的人擊退',
      '● 爆炸會【連鎖引爆】附近其他炸彈(地上的、倒數中的)',
      '● 你【手上拿著炸彈時被炸到 → 手上炸彈也爆】(小心別拿著炸彈站在爆點)',
      '● 只能走位不能衝刺;撐到最後【活著者勝】(60秒到還活著的一起贏)。對手是 3 個 BOT'
    ];
    cont.add(this.add.text(w / 2, h / 2 - 14, rules.join('\n'), {
      fontFamily: 'monospace', fontSize: '14px', color: '#e2e8f0', align: 'left', lineSpacing: 9
    }).setOrigin(0.5));
    const hint = this.add.text(w / 2, h / 2 + 168, '按【空白鍵】開始！', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffe66d', fontStyle: 'bold'
    }).setOrigin(0.5);
    cont.add(hint);
    this.tweens.add({ targets: hint, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
    cont.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    cont.on('pointerdown', () => this.startReady());
    this.introLayer = cont;
    this.timerText.setText(String(Math.ceil(this.cfg.durationMs / 1000)));
  }

  private startReady(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'ready';
    if (this.introLayer) { this.introLayer.destroy(); this.introLayer = undefined; }
    this.running = false; // ready 期間不動/不生炸彈/不計時
    const w = GameConfig.width, h = GameConfig.height;
    this.readyText = this.add.text(w / 2, h / 2, '', {
      fontFamily: 'monospace', fontSize: '96px', color: '#ffe066', fontStyle: 'bold', stroke: '#000', strokeThickness: 8
    }).setOrigin(0.5).setDepth(45);
    const secs = Math.max(1, Math.round(this.cfg.readyCountdownMs / 1000));
    const showBig = (txt: string) => {
      if (!this.readyText) return;
      this.readyText.setText(txt).setScale(1.6).setAlpha(1);
      this.tweens.add({ targets: this.readyText, scale: 1, duration: 300, ease: 'Back.out' });
    };
    let cur = secs;
    showBig(String(cur));
    this.time.addEvent({
      delay: 1000, repeat: secs - 1,
      callback: () => {
        cur -= 1;
        if (cur >= 1) { showBig(String(cur)); }
        else {
          showBig('開始!');
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
    this.endsAt = this.time.now + this.cfg.durationMs;
    this.nextBombSpawnAt = this.time.now + 300;
    this.running = true;
  }

  private onSpace(): void {
    if (this.phase === 'intro') { this.startReady(); return; }
    if (this.phase === 'ready') return;
    if (this.phase === 'playing') this.playerAction();
    else if (this.phase === 'ended') { const b = this.endButtons[this.endSelected]; if (b) b.cb(); }
  }

  // ── 空白鍵:手上無炸彈→撿最近地上炸彈;手上有→朝面向丟 ──
  private playerAction(): void {
    const p = this.fighters[0];
    if (!p.alive || this.time.now < p.stunUntil) return;
    if (p.holding) this.throwBomb(p);
    else this.tryPickBomb(p);
  }

  private tryPickBomb(f: Fighter): void {
    if (f.holding) return;
    let best: Bomb | null = null; let bd: number = this.cfg.pickRange;
    for (const b of this.bombs) {
      if (b.dead || b.state !== 'ground') continue;
      const d = Math.hypot(b.x - f.x, b.y - f.y);
      if (d <= bd) { bd = d; best = b; }
    }
    if (!best) return;
    best.state = 'held';
    best.owner = f;
    f.holding = best;
    best.sprite.setDepth(12);
  }

  private throwBomb(f: Fighter): void {
    const b = f.holding;
    if (!b) return;
    let nx = f.faceX, ny = f.faceY;
    const flen = Math.hypot(nx, ny);
    if (flen < 0.001) { nx = 1; ny = 0; } else { nx /= flen; ny /= flen; }
    b.state = 'flying';
    b.owner = f;
    b.travelled = 0;
    b.vx = nx * this.cfg.throwSpeed;
    b.vy = ny * this.cfg.throwSpeed;
    // 從角色前方一點出發(避免立刻撞自己)
    b.x = f.x + nx * (this.cfg.radius + this.cfg.bombRadius + 2);
    b.y = f.y + ny * (this.cfg.radius + this.cfg.bombRadius + 2);
    b.sprite.setPosition(b.x, b.y).setDepth(12);
    f.holding = null;
  }

  // ── 地上炸彈補充(維持 groundBombTarget,避開角色出生點/角色) ──
  private replenishBombs(): void {
    if (this.time.now < this.nextBombSpawnAt) return;
    const groundCount = this.bombs.filter(b => !b.dead && b.state === 'ground').length;
    if (groundCount >= this.cfg.groundBombTarget) return;
    this.spawnGroundBomb();
    this.nextBombSpawnAt = this.time.now + this.cfg.bombSpawnIntervalMs;
  }

  private spawnGroundBomb(): void {
    const a = this.arena;
    let x = 0, y = 0, ok = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      x = Phaser.Math.Between(a.left + 40, a.right - 40);
      y = Phaser.Math.Between(a.top + 40, a.bottom - 40);
      let clash = false;
      // 避開角色(別生在人身上)
      for (const f of this.fighters) {
        if (!f.alive) continue;
        if (Phaser.Math.Distance.Between(x, y, f.x, f.y) < 70) { clash = true; break; }
      }
      // 避開其他地上炸彈(別疊)
      if (!clash) {
        for (const b of this.bombs) {
          if (b.dead || b.state !== 'ground') continue;
          if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < this.cfg.bombRadius * 2 + 10) { clash = true; break; }
        }
      }
      if (!clash) { ok = true; break; }
    }
    if (!ok) return;
    const sprite = this.add.image(x, y, 'bomb').setDepth(5);
    this.bombs.push({
      id: this.bombIdSeq++, state: 'ground', x, y, vx: 0, vy: 0, travelled: 0,
      owner: null, fuseAt: 0, sprite, dead: false
    });
  }

  // ── 主循環 ──
  update(_time: number, delta: number): void {
    if (!this.running) return;
    const dt = (delta / 1000) * this.slowFactor; // ★套用慢動作縮放(結束決勝時刻)
    const remainMs = Math.max(0, this.endsAt - this.time.now);
    this.timerText.setText(String(Math.ceil(remainMs / 1000)));

    this.replenishBombs();
    this.updatePlayer(dt);
    for (let i = 1; i < 4; i++) this.updateBot(this.fighters[i], dt);
    this.applyKnockback(dt);
    this.separateFighters();
    this.updateBombs(dt);
    this.drawFaceIndicator(this.fighters[0]);
    this.updatePickHint(dt);

    // ★結束判定:第3人出局(≤1)→dramatic 慢動作;60秒到多人活→非dramatic 緩衝。finishing 中改推進結束時序(不重複觸發)。
    if (!this.finishing) {
      const aliveCount = this.fighters.filter(f => f.alive).length;
      if (aliveCount <= 1) { this.beginFinish(true); }
      else if (remainMs <= 0) { this.beginFinish(false); }
    } else {
      this.updateFinishSequence(); // 每幀推進:到點恢復慢動作、到點 endGame(timestamp 驅動,不會永久卡)
    }
  }

  /**
   * ★結束演出緩衝:
   * - dramatic=true(第3人出局=剩最後1人決勝):慢動作 slowFactor→0.35 約1.2秒→恢復→短停→結算。
   * - dramatic=false(60秒到仍多人存活):不慢動作,正常短緩衝(停留1秒)→結算。
   * 慢動作結束後才 endGame(計時已停,不受影響)。
   */
  private beginFinish(dramatic: boolean): void {
    if (this.finishing) return;
    this.finishing = true;
    // ★不再用巢狀 delayedCall(某些路徑可能漏恢復→永久卡);改 timestamp 驅動、由 update 每幀推進恢復+結算。
    // running 保持 true 讓 update 續跑(演出+時序);finishing=true 防重複觸發結束判定。
    this.running = true;
    const now = this.time.now;
    if (dramatic) {
      this.slowFactor = 0.35;
      this.tweens.timeScale = 0.5;
      const winner = this.fighters.find(f => f.alive);
      if (winner) this.tweens.add({ targets: winner.sprite, scale: { from: 1, to: 1.5 }, duration: 500, yoyo: true, repeat: 1 });
      this.finishSlowEndAt = now + 1200; // 1.2s(real-time,不受 slowFactor 影響:update 用 this.time.now 比對)
      this.finishEndGameAt = now + 1700; // 慢動作 1.2s + 停 0.5s → 結算
    } else {
      this.slowFactor = 1;
      this.tweens.timeScale = 1;
      this.finishSlowEndAt = 0;
      this.finishEndGameAt = now + 1000; // 正常緩衝 1s → 結算
    }
  }

  /** ★結束演出時序:每幀由 update 推進——到點恢復慢動作、到點 endGame。timestamp 用 this.time.now(scene clock,穩定前進)→不會永久卡。 */
  private updateFinishSequence(): void {
    if (!this.finishing || this.phase === 'ended') return;
    const now = this.time.now;
    if (this.finishSlowEndAt > 0 && now >= this.finishSlowEndAt) {
      this.slowFactor = 1;
      this.tweens.timeScale = 1;
      this.finishSlowEndAt = 0;
    }
    if (this.finishEndGameAt > 0 && now >= this.finishEndGameAt) {
      this.finishEndGameAt = 0;
      this.endGame();
    }
  }

  // ── 炸彈更新:held 跟隨主人 / flying 飛行+撞人即爆+落地倒數 / fusing 到點爆 ──
  private updateBombs(dt: number): void {
    for (const b of this.bombs) {
      if (b.dead) continue;
      if (b.state === 'held') {
        const o = b.owner;
        if (o && o.alive) { b.x = o.x; b.y = o.y - 30; b.sprite.setPosition(b.x, b.y); }
        continue;
      }
      if (b.state === 'flying') {
        const step = Math.hypot(b.vx, b.vy) * dt;
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.travelled += step;
        b.sprite.setPosition(b.x, b.y);
        b.sprite.rotation += dt * 8;
        // 撞牆→就地落地倒數
        const a = this.arena, br = this.cfg.bombRadius;
        if (b.x < a.left + br || b.x > a.right - br || b.y < a.top + br || b.y > a.bottom - br) {
          b.x = Phaser.Math.Clamp(b.x, a.left + br, a.right - br);
          b.y = Phaser.Math.Clamp(b.y, a.top + br, a.bottom - br);
          this.startFuse(b);
          continue;
        }
        // 撞到人(非丟出者)→即爆
        let hit: Fighter | null = null;
        for (const f of this.fighters) {
          if (!f.alive || f === b.owner) continue;
          if (Phaser.Math.Distance.Between(b.x, b.y, f.x, f.y) < this.cfg.radius + this.cfg.bombRadius) { hit = f; break; }
        }
        if (hit) { this.explodeBomb(b, 0); continue; }
        // 飛行距離到→落地倒數
        if (b.travelled >= this.cfg.throwMaxDist) { this.startFuse(b); continue; }
        continue;
      }
      if (b.state === 'fusing') {
        // 地面預警圈填滿
        const total = this.cfg.fuseMs;
        const p = Phaser.Math.Clamp(1 - (b.fuseAt - this.time.now) / total, 0, 1);
        if (b.ring) {
          b.ring.clear();
          b.ring.lineStyle(3, this.cfg.ringColor, 0.9);
          b.ring.strokeCircle(b.x, b.y, this.cfg.explodeRadius);
          b.ring.fillStyle(this.cfg.ringColor, 0.22 + p * 0.3);
          b.ring.fillCircle(b.x, b.y, this.cfg.explodeRadius * p);
        }
        b.sprite.setScale(1 + Math.sin(this.time.now / 60) * 0.12);
        if (this.time.now >= b.fuseAt) { this.explodeBomb(b, 0); }
        continue;
      }
    }
    // 清掉已爆的
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      if (this.bombs[i].dead) this.bombs.splice(i, 1);
    }
  }

  private startFuse(b: Bomb): void {
    if (b.state === 'fusing' || b.dead) return;
    b.state = 'fusing';
    b.vx = 0; b.vy = 0;
    b.fuseAt = this.time.now + this.cfg.fuseMs;
    b.sprite.setPosition(b.x, b.y).setDepth(5).setRotation(0);
    b.ring = this.add.graphics().setDepth(3);
  }

  // ── 爆炸:圓範圍出局 + 擊退 + 連鎖引爆 + 手上炸彈連爆 ──
  private explodeBomb(b: Bomb, depth: number): void {
    if (b.dead) return;
    b.dead = true;
    if (b.ring) { b.ring.destroy(); b.ring = undefined; }
    // 若這顆是某人手上的→那人手放空(下面若在範圍內會連同其手上其他炸彈…此顆已爆)
    if (b.owner && b.owner.holding === b) b.owner.holding = null;
    const ex = b.x, ey = b.y, R = this.cfg.explodeRadius;
    // 視覺
    this.spawnExplosionFx(ex, ey, R);
    b.sprite.destroy();
    // 震動(節流)
    if (this.time.now >= this.nextShakeAt) {
      this.cameras.main.shake(this.cfg.shakeDurationMs, this.cfg.shakeIntensity);
      this.nextShakeAt = this.time.now + this.cfg.shakeThrottleMs;
    }
    // 範圍內角色:出局 + 擊退;若該角色手上有炸彈→那顆也連爆
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.x - ex, f.y - ey);
      if (d <= R + this.cfg.radius) {
        // 擊退(即使即將出局也給視覺位移)
        const nx = d > 0.001 ? (f.x - ex) / d : 1, ny = d > 0.001 ? (f.y - ey) / d : 0;
        f.vx = nx * this.cfg.knockSpeed; f.vy = ny * this.cfg.knockSpeed;
        f.stunUntil = this.time.now + this.cfg.knockStunMs;
        // ★手上拿著炸彈被炸→手上炸彈也連爆
        const held = f.holding;
        this.eliminate(f);
        if (held && !held.dead && depth < this.cfg.chainMaxDepth) {
          held.x = f.x; held.y = f.y;
          this.time.delayedCall(this.cfg.chainDelayMs, () => this.explodeBomb(held, depth + 1));
        }
      }
    }
    // ★連鎖引爆:範圍內其他炸彈(地上/飛行/倒數中)→延遲連爆(深度上限防無限)
    if (depth < this.cfg.chainMaxDepth) {
      for (const other of this.bombs) {
        if (other.dead || other === b) continue;
        if (other.state === 'held') continue; // 手上的由「持有者被炸」那條處理
        const d = Math.hypot(other.x - ex, other.y - ey);
        if (d <= R + this.cfg.bombRadius) {
          this.time.delayedCall(this.cfg.chainDelayMs, () => this.explodeBomb(other, depth + 1));
        }
      }
    }
  }

  private spawnExplosionFx(x: number, y: number, R: number): void {
    const ring = this.add.circle(x, y, R * 0.4, this.cfg.explodeColor, 0.85).setDepth(16);
    this.tweens.add({ targets: ring, radius: R, alpha: 0, duration: 340, onComplete: () => ring.destroy() });
    const core = this.add.circle(x, y, R * 0.3, 0xffd400, 0.75).setDepth(16);
    this.tweens.add({ targets: core, alpha: 0, scale: 1.4, duration: 220, onComplete: () => core.destroy() });
  }

  private eliminate(f: Fighter): void {
    if (!f.alive) return;
    f.alive = false;
    f.holding = null;
    if (f.index === 0 && this.faceIndicator) this.faceIndicator.clear();
    if (f.index === 0 && this.pickHint) this.pickHint.clear();
    f.sprite.setTint(0x555555).setAlpha(0.35);
    const label = (f.sprite as unknown as { __label: Phaser.GameObjects.Text }).__label;
    if (label) label.setAlpha(0.35);
    const x = this.add.text(f.x, f.y - 30, '出局', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ff5555', fontStyle: 'bold', stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(20);
    this.tweens.add({ targets: x, y: f.y - 60, alpha: 0, duration: 800, onComplete: () => x.destroy() });
    this.updateAliveHud();
  }

  private updateAliveHud(): void {
    this.aliveText.setText('存活: ' + this.fighters.filter(f => f.alive).length);
  }

  // ── 擊退位移 ──
  private applyKnockback(dt: number): void {
    const a = this.arena, r = this.cfg.radius;
    for (const f of this.fighters) {
      // 出局也讓灰影被擊退飛一下?僅存活者需精確;出局者不動即可
      if (!f.alive) { f.vx = 0; f.vy = 0; continue; }
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
          A.x = Phaser.Math.Clamp(A.x - r, a.left + r, a.right - r);
          B.x = Phaser.Math.Clamp(B.x + r, a.left + r, a.right - r);
        }
        this.syncSprite(A); this.syncSprite(B);
      }
    }
  }

  private syncSprite(f: Fighter): void {
    f.sprite.setPosition(f.x, f.y);
    const l = (f.sprite as unknown as { __label: Phaser.GameObjects.Text }).__label;
    if (l) l.setPosition(f.x, f.y - 26);
  }

  private clampFighter(f: Fighter): void {
    const a = this.arena, r = this.cfg.radius;
    f.x = Phaser.Math.Clamp(f.x, a.left + r, a.right - r);
    f.y = Phaser.Math.Clamp(f.y, a.top + r, a.bottom - r);
    this.syncSprite(f);
  }

  // ── 玩家走位 + 面向 ──
  private updatePlayer(dt: number): void {
    const p = this.fighters[0];
    if (!p.alive) return;
    if (this.time.now < p.stunUntil) return; // 擊退失控中
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
      p.faceX = vx / len; p.faceY = vy / len;
    }
    this.clampFighter(p);
  }

  private drawFaceIndicator(p: Fighter): void {
    const g = this.faceIndicator;
    if (!g) return;
    g.clear();
    if (!p.alive || this.phase !== 'playing') return;
    const r = this.cfg.radius;
    // 手上有炸彈→箭頭金色(可丟);沒有→灰(先撿)
    const armed = !!p.holding;
    g.lineStyle(2, 0xffffff, 0.6);
    g.strokeCircle(p.x, p.y, r + 8);
    const ang = Math.atan2(p.faceY, p.faceX);
    const base = r + 10, tip = r + 32;
    const bx = p.x + Math.cos(ang) * base, by = p.y + Math.sin(ang) * base;
    const tx = p.x + Math.cos(ang) * tip, ty = p.y + Math.sin(ang) * tip;
    g.lineStyle(4, armed ? 0xffa23f : 0x9aa4b2, armed ? 0.95 : 0.5);
    g.beginPath(); g.moveTo(bx, by); g.lineTo(tx, ty); g.strokePath();
    const ah = 9;
    g.beginPath();
    g.moveTo(tx, ty); g.lineTo(tx - Math.cos(ang - 0.5) * ah, ty - Math.sin(ang - 0.5) * ah);
    g.moveTo(tx, ty); g.lineTo(tx - Math.cos(ang + 0.5) * ah, ty - Math.sin(ang + 0.5) * ah);
    g.strokePath();
  }

  // ── 撿取提示:手上無炸彈時,高亮 pickRange 內最近地上炸彈 ──
  private updatePickHint(dt: number): void {
    const g = this.pickHint;
    if (!g) return;
    g.clear();
    const p = this.fighters[0];
    if (this.phase !== 'playing' || !p.alive || p.holding) return;
    let best: Bomb | null = null; let bd: number = this.cfg.pickRange;
    for (const b of this.bombs) {
      if (b.dead || b.state !== 'ground') continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d <= bd) { bd = d; best = b; }
    }
    if (!best) return;
    this.pickHintPulse += dt * 6;
    const pulse = (Math.sin(this.pickHintPulse) + 1) * 0.5;
    const rr = this.cfg.bombRadius + 6 + pulse * 6;
    g.lineStyle(4, 0xffe066, 0.35 + pulse * 0.35);
    g.strokeCircle(best.x, best.y, rr + 4);
    g.lineStyle(3, 0xffffff, 0.6 + pulse * 0.3);
    g.strokeCircle(best.x, best.y, rr);
    g.lineStyle(2, 0xffe066, 0.4);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(best.x, best.y); g.strokePath();
  }

  // ── BOT AI:①閃(飛來的炸彈 + 倒數中的爆炸圈)②手上沒炸彈→去撿最近地上炸彈③手上有→靠近對手朝其方向丟 ──
  private updateBot(f: Fighter, dt: number): void {
    if (!f.alive) return;
    if (this.time.now < f.stunUntil) return;

    // ①閃避:所有倒數中的爆炸圈(含自己丟的落地倒數) + 逼近的飛行炸彈(含自己的,若朝自己接近)
    let moveX = 0, moveY = 0, danger = false;
    const margin = this.cfg.botDangerMargin;
    for (const b of this.bombs) {
      if (b.dead) continue;
      if (b.state === 'fusing') {
        // 任何倒數中的炸彈(不分擁有者)→都要閃(自己丟的落地倒數也算)
        const d = Math.hypot(f.x - b.x, f.y - b.y);
        if (d < this.cfg.explodeRadius + margin) {
          danger = true;
          const nx = d > 0.001 ? (f.x - b.x) / d : 1, ny = d > 0.001 ? (f.y - b.y) / d : 0;
          const w = (this.cfg.explodeRadius + margin - d);
          moveX += nx * w; moveY += ny * w;
        }
      } else if (b.state === 'flying') {
        // 飛行炸彈接近→側閃(含自己丟的:若它正朝自己靠近,例如貼牆反彈情境)
        const d = Math.hypot(f.x - b.x, f.y - b.y);
        // 判斷是否朝 f 接近:下一步距離更小
        const nd = Math.hypot((f.x - (b.x + b.vx * 0.05)), (f.y - (b.y + b.vy * 0.05)));
        const approaching = nd < d;
        if (d < 80 && (b.owner !== f || approaching)) {
          danger = true;
          const nx = d > 0.001 ? (f.x - b.x) / d : 1, ny = d > 0.001 ? (f.y - b.y) / d : 0;
          moveX += nx * (80 - d); moveY += ny * (80 - d);
        }
      }
    }
    if (danger) {
      const len = Math.hypot(moveX, moveY) || 1;
      f.x += (moveX / len) * this.cfg.botMoveSpeed * dt;
      f.y += (moveY / len) * this.cfg.botMoveSpeed * dt;
      f.sprite.setFlipX(moveX < 0);
      f.faceX = moveX / len; f.faceY = moveY / len;
      this.clampFighter(f);
      return;
    }

    // ②手上有炸彈:靠近最近對手→到 botThrowRange 內朝其方向丟
    if (f.holding) {
      let target: Fighter | null = null; let td = 1e9;
      for (const o of this.fighters) {
        if (o === f || !o.alive) continue;
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d < td) { td = d; target = o; }
      }
      if (target) {
        const dx = target.x - f.x, dy = target.y - f.y, d = Math.hypot(dx, dy) || 1;
        f.faceX = dx / d; f.faceY = dy / d;
        // ★不自炸:撞人即爆發生在目標位置,爆炸半徑 explodeRadius;只有當自己離目標夠遠(> explodeRadius+radius+safe)才丟,否則會把自己也炸到
        const safeThrowDist = this.cfg.explodeRadius + this.cfg.radius + this.cfg.botSelfSafeMargin;
        if (this.time.now >= f.nextDecideAt) {
          f.nextDecideAt = this.time.now + this.cfg.botReactMs;
          if (td <= this.cfg.botThrowRange && td >= safeThrowDist) { this.throwBomb(f); return; }
        }
        if (td < safeThrowDist) {
          // 太近→先【退開】拉出安全距離(別貼臉丟自炸)
          f.x -= (dx / d) * this.cfg.botMoveSpeed * dt;
          f.y -= (dy / d) * this.cfg.botMoveSpeed * dt;
          f.sprite.setFlipX(-dx < 0);
        } else if (d > this.cfg.botThrowRange * 0.9) {
          // 太遠→靠近到射程
          f.x += (dx / d) * this.cfg.botMoveSpeed * dt;
          f.y += (dy / d) * this.cfg.botMoveSpeed * dt;
          f.sprite.setFlipX(dx < 0);
        }
      }
      this.clampFighter(f);
      return;
    }

    // ③手上沒炸彈:去撿最近的地上炸彈
    let bomb: Bomb | null = null; let bdst = 1e9;
    for (const b of this.bombs) {
      if (b.dead || b.state !== 'ground') continue;
      const d = Math.hypot(b.x - f.x, b.y - f.y);
      if (d < bdst) { bdst = d; bomb = b; }
    }
    if (bomb) {
      const dx = bomb.x - f.x, dy = bomb.y - f.y, d = Math.hypot(dx, dy) || 1;
      f.faceX = dx / d; f.faceY = dy / d;
      if (d <= this.cfg.pickRange) { this.tryPickBomb(f); }
      else {
        f.x += (dx / d) * this.cfg.botMoveSpeed * dt;
        f.y += (dy / d) * this.cfg.botMoveSpeed * dt;
        f.sprite.setFlipX(dx < 0);
      }
    } else {
      // 沒炸彈可撿→朝場中緩走
      const dx = this.arena.cx - f.x, dy = this.arena.cy - f.y, d = Math.hypot(dx, dy);
      if (d > 10) { f.x += (dx / d) * this.cfg.botMoveSpeed * 0.5 * dt; f.y += (dy / d) * this.cfg.botMoveSpeed * 0.5 * dt; }
    }
    this.clampFighter(f);
  }

  // ── 結算 ──
  private endGame(): void {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.running = false;
    // ★防呆:結算時強制恢復慢動作/時間縮放(即使任何路徑漏恢復,結算畫面也絕不停在慢動作/凍結)。
    this.slowFactor = 1;
    this.tweens.timeScale = 1;
    if (this.faceIndicator) this.faceIndicator.clear();
    if (this.pickHint) this.pickHint.clear();
    const w = GameConfig.width, h = GameConfig.height;
    this.add.rectangle(0, 0, w, h, 0x000000, 0.72).setOrigin(0, 0).setDepth(40);
    const survivors = this.fighters.filter(f => f.alive);
    this.add.text(w / 2, h * 0.2, '💣 結束!', {
      fontFamily: 'monospace', fontSize: '46px', color: '#ffe66d', stroke: '#000', strokeThickness: 6
    }).setOrigin(0.5).setDepth(41);
    let title: string;
    if (survivors.length === 1) title = '🏆 勝者:' + this.cfg.names[survivors[0].index];
    else if (survivors.length > 1) title = '🏆 平手存活:' + survivors.map(s => this.cfg.names[s.index]).join('、');
    else title = '同歸於盡,無人存活';
    this.add.text(w / 2, h * 0.3, title, {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffffff', stroke: '#000', strokeThickness: 4, align: 'center', wordWrap: { width: w * 0.8 }
    }).setOrigin(0.5).setDepth(41);
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
