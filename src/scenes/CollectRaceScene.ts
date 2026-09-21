import Phaser from 'phaser';
import { GameConfig } from '../config';

type ShapeKey = 'diamond' | 'star' | 'heart' | 'gem';

interface CollectItem extends Phaser.GameObjects.Image {
  shape: ShapeKey;
  carried: boolean;
  vx: number;
  vy: number;
}

/** 角色（玩家或 BOT）在收集競賽的狀態 */
interface Racer {
  index: number;               // 0=P1, 1..3=BOT
  isBot: boolean;
  sprite: Phaser.GameObjects.Image;
  x: number; y: number;
  score: number;
  carrying: CollectItem | null; // 手上帶的物件(一次一個)
  bin: Bin;
  // BOT AI
  nextDecideAt: number;
  target: CollectItem | null;   // BOT 當前要去撿的物件
  wrongPickThisTrip: boolean;   // 這趟是否故意撿錯
}

interface Bin {
  owner: number;
  x: number; y: number;
  color: number;
  gfx: Phaser.GameObjects.Container;
}

/**
 * 小遊戲：收集競賽（非戰鬥）。60 秒內把「告示指定形狀」的物件撿起帶回自己的箱子得分，比分數。
 * 1 真人(P1，鍵盤八方向走位+攻擊鍵撿/放) + 3 BOT(自動玩)。完全獨立於 GameScene 戰鬥邏輯。
 */
export class CollectRaceScene extends Phaser.Scene {
  private cfg = GameConfig.collectRace;
  private arena!: { left: number; right: number; top: number; bottom: number; cx: number; cy: number };
  private items!: CollectItem[];
  private racers!: Racer[];
  private bins!: Bin[];
  private targetShape!: ShapeKey;
  private nextSignAt = 0;
  private endsAt = 0;
  private running = false;
  private finishing = false; // ★結束演出(聚光燈)進行中
  private phase: 'intro' | 'playing' | 'ended' = 'intro';
  private introLayer?: Phaser.GameObjects.Container;
  // ★v4:撿取提示(玩家 pickRadius 內最近可撿物件的高亮圈,脈動)
  private pickHint?: Phaser.GameObjects.Graphics;
  private pickHintPulse = 0;

  // 輸入
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private attackKey!: Phaser.Input.Keyboard.Key;

  // HUD
  private signText!: Phaser.GameObjects.Text;
  private signIcon!: Phaser.GameObjects.Image;
  private timerText!: Phaser.GameObjects.Text;
  private scoreTexts!: Phaser.GameObjects.Text[];
  // 結算按鈕鍵盤選
  private endButtons: Array<{ x: number; y: number; cb: () => void }> = [];
  private endSelected = 0;
  private endHighlight?: Phaser.GameObjects.Rectangle;

  constructor() {
    super('CollectRaceScene');
  }

  create(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const pad = GameConfig.arena.padding;
    // 場地(同 arena 尺寸)
    this.arena = {
      left: pad, right: w - pad, top: pad + 40, bottom: h - pad,
      cx: w / 2, cy: (pad + 40 + h - pad) / 2
    };
    this.add.tileSprite(0, 0, w, h, 'ground').setOrigin(0, 0).setDepth(0);
    this.add.rectangle(0, 0, w, h, 0x0a0c14, 0.25).setOrigin(0, 0).setDepth(0);
    // 場地框
    const border = this.add.graphics().setDepth(1);
    border.lineStyle(GameConfig.arena.borderThickness, GameConfig.arena.borderColor, 1);
    border.strokeRect(this.arena.left, this.arena.top, this.arena.right - this.arena.left, this.arena.bottom - this.arena.top);

    this.items = [];
    this.setupBinsAndRacers();
    this.setupHud();
    this.spawnInitialItems();

    // 開場告示
    this.pickNewTargetShape(true);

    // 輸入(鍵盤八方向 + 攻擊)
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.keys = {
      up: kb.addKey(KC.UP), down: kb.addKey(KC.DOWN), left: kb.addKey(KC.LEFT), right: kb.addKey(KC.RIGHT),
      w: kb.addKey(KC.W), a: kb.addKey(KC.A), s: kb.addKey(KC.S), d: kb.addKey(KC.D)
    };
    this.attackKey = kb.addKey(KC.SPACE);
    this.attackKey.on('down', () => this.onSpace());
    kb.addKey(KC.ESC).on('down', () => this.quitToMenu());

    // 進場先【說明畫面】(不立刻開始)：玩家/BOT 站在各自箱子旁預備，物件已散好
    this.phase = 'intro';
    this.running = false;
    this.showIntro();
  }

  // ── 進場遊戲說明浮層(按空白/點擊開始) ──
  private showIntro(): void {
    const w = GameConfig.width, h = GameConfig.height;
    const cont = this.add.container(0, 0).setDepth(50);
    cont.add(this.add.rectangle(0, 0, w, h, 0x05070c, 0.82).setOrigin(0, 0));
    const panel = this.add.rectangle(w / 2, h / 2, 640, 380, 0x121a2e, 0.98).setStrokeStyle(3, 0x4ade80, 0.9);
    cont.add(panel);
    cont.add(this.add.text(w / 2, h / 2 - 150, '💎 收集競賽', {
      fontFamily: 'monospace', fontSize: '38px', color: '#7ee7ff', fontStyle: 'bold'
    }).setOrigin(0.5));
    const rules = [
      '● 看【上方告示板】現在要收集的形狀',
      '● 用【方向鍵 / WASD】走位（只能走、不能衝刺）',
      '● 走到對的形狀旁按【空白鍵】撿起（一次一個）',
      '● 帶回【自己的箱子】按空白放入 → 撿對 +1 分',
      '● 撿錯不算分；不在箱子按空白可【原地放下】重撿',
      '● 有人丟對→告示換新形狀。60 秒內【最高分者勝】',
      '● 對手是 3 個 BOT，加油！'
    ];
    cont.add(this.add.text(w / 2, h / 2 - 10, rules.join('\n'), {
      fontFamily: 'monospace', fontSize: '16px', color: '#e2e8f0', align: 'left', lineSpacing: 8
    }).setOrigin(0.5));
    const startHint = this.add.text(w / 2, h / 2 + 150, '按【空白鍵】開始！', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffe66d', fontStyle: 'bold'
    }).setOrigin(0.5);
    cont.add(startHint);
    this.tweens.add({ targets: startHint, alpha: 0.35, duration: 600, yoyo: true, repeat: -1 });
    // 點浮層任意處也可開始
    panel.setInteractive(new Phaser.Geom.Rectangle(-320, -190, 640, 380), Phaser.Geom.Rectangle.Contains);
    cont.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
    cont.on('pointerdown', () => this.startPlaying());
    this.introLayer = cont;
    // 倒數顯示先擺 60(未動)
    this.timerText.setText(String(Math.ceil(this.cfg.durationMs / 1000)));
  }

  private startPlaying(): void {
    if (this.phase !== 'intro') return;
    this.phase = 'playing';
    if (this.introLayer) { this.introLayer.destroy(); this.introLayer = undefined; }
    this.endsAt = this.time.now + this.cfg.durationMs;
    this.nextSignAt = this.time.now + Phaser.Math.Between(this.cfg.signIntervalMinMs, this.cfg.signIntervalMaxMs); // v5:開始起算,首次也 9~12 秒隨機
    this.running = true;
  }

  /** 空白鍵：intro→開始；playing→撿/放/放下(依情境) */
  private onSpace(): void {
    if (this.phase === 'intro') { this.startPlaying(); return; }
    if (this.phase === 'playing') this.playerTryPickOrDeliver();
  }

  // ── 建立箱子(四角) + 角色(P1 + 3 BOT) ──
  private setupBinsAndRacers(): void {
    const a = this.arena;
    const inset = 70;
    // 四角箱子位置：P1 左下、BOT 右下/左上/右上
    const cornerPos = [
      { x: a.left + inset, y: a.bottom - inset },   // P1 左下
      { x: a.right - inset, y: a.bottom - inset },  // BOT1 右下
      { x: a.left + inset, y: a.top + inset },      // BOT2 左上
      { x: a.right - inset, y: a.top + inset }      // BOT3 右上
    ];
    this.bins = [];
    this.racers = [];
    for (let i = 0; i < 4; i++) {
      const color = this.cfg.binColors[i];
      const p = cornerPos[i];
      // 箱子視覺：圓角方塊 + 歸屬標籤
      const cont = this.add.container(p.x, p.y).setDepth(3);
      const box = this.add.rectangle(0, 0, this.cfg.binRadius * 2, this.cfg.binRadius * 2, color, 0.35)
        .setStrokeStyle(4, color, 1);
      const inner = this.add.rectangle(0, 0, this.cfg.binRadius * 1.3, this.cfg.binRadius * 1.3, color, 0.2)
        .setStrokeStyle(2, 0xffffff, 0.6);
      const label = this.add.text(0, -this.cfg.binRadius - 14, this.cfg.ownerNames[i], {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffffff', fontStyle: 'bold', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5);
      cont.add([box, inner, label]);
      const bin: Bin = { owner: i, x: p.x, y: p.y, color, gfx: cont };
      this.bins.push(bin);

      // 角色 sprite(用 char-i 貼圖)——預備位置：站在自己箱子旁(往場中偏移一點)
      const sx = p.x + (p.x < a.cx ? 1 : -1) * (this.cfg.binRadius + 20);
      const sy = p.y + (p.y < a.cy ? 1 : -1) * (this.cfg.binRadius + 20);
      const sprite = this.add.image(sx, sy, `char-${i}`).setDepth(10);
      const racer: Racer = {
        index: i, isBot: i !== 0, sprite, x: sx, y: sy, score: 0,
        carrying: null, bin, nextDecideAt: 0, target: null, wrongPickThisTrip: false
      };
      this.racers.push(racer);
    }
    // ★v4:撿取提示圖層(在物件下方一點,高亮可撿物件)
    this.pickHint = this.add.graphics().setDepth(4);
  }

  // ── HUD：上方告示板 + 計時 + 4 人得分 ──
  private setupHud(): void {
    const w = GameConfig.width;
    // 告示板底
    this.add.rectangle(w / 2, 24, 380, 46, 0x101828, 0.9).setStrokeStyle(2, 0xffd23f, 0.9).setDepth(20);
    this.add.text(w / 2 - 176, 24, '收集：', { fontFamily: 'monospace', fontSize: '18px', color: '#cbd5e1' })
      .setOrigin(0, 0.5).setDepth(21);
    // ★告示圖示用【與場上物件同一套貼圖 collect-<shape>】→圖示形狀+顏色與場上物件完全一致
    this.signIcon = this.add.image(w / 2 - 30, 24, 'collect-diamond').setDepth(21);
    this.signText = this.add.text(w / 2 + 4, 24, '', { fontFamily: 'monospace', fontSize: '22px', color: '#ffffff', fontStyle: 'bold' })
      .setOrigin(0, 0.5).setDepth(21);
    // ★清楚的 60 秒倒數(上方置中偏上、大字)
    this.timerText = this.add.text(w / 2, 62, '60', {
      fontFamily: 'monospace', fontSize: '40px', color: '#7ee7ff', fontStyle: 'bold', stroke: '#000', strokeThickness: 5
    }).setOrigin(0.5).setDepth(21);
    // 4 人得分(右上，直排)
    this.scoreTexts = [];
    for (let i = 0; i < 4; i++) {
      const t = this.add.text(GameConfig.width - 20, 14 + i * 22,
        this.cfg.ownerNames[i] + ': 0', {
          fontFamily: 'monospace', fontSize: '15px',
          color: '#' + this.cfg.binColors[i].toString(16).padStart(6, '0'), fontStyle: 'bold', stroke: '#000', strokeThickness: 3
        }).setOrigin(1, 0).setDepth(21);
      this.scoreTexts.push(t);
    }
  }

  private randShape(): ShapeKey {
    const s = this.cfg.shapes;
    return s[Phaser.Math.Between(0, s.length - 1)] as ShapeKey;
  }

  // ── 生成/補充物件 ──
  private spawnInitialItems(): void {
    for (const shape of this.cfg.shapes) {
      for (let n = 0; n < this.cfg.perShapeTarget; n++) this.spawnItem(shape as ShapeKey);
    }
  }

  private spawnItem(shape: ShapeKey): void {
    const a = this.arena;
    const minGap = this.cfg.itemRadius * 2 + 8; // 物件彼此不互疊(直徑+縫)
    let x = 0, y = 0, ok = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * this.cfg.scatterRadius;
      x = Phaser.Math.Clamp(a.cx + Math.cos(ang) * rad, a.left + 30, a.right - 30);
      y = Phaser.Math.Clamp(a.cy + Math.sin(ang) * rad, a.top + 30, a.bottom - 30);
      // 避免生在箱子上
      let clash = false;
      for (const b of this.bins) { if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < this.cfg.binRadius + 30) { clash = true; break; } }
      // ★與其他物件不互疊
      if (!clash) {
        for (const it of this.items) {
          if (!it.active || it.carried) continue;
          if (Phaser.Math.Distance.Between(x, y, it.x, it.y) < minGap) { clash = true; break; }
        }
      }
      if (!clash) { ok = true; break; }
    }
    if (!ok) return; // 30 次找不到不重疊位置就這波先不生(下次補充再試)
    const img = this.add.image(x, y, `collect-${shape}`).setDepth(5) as CollectItem;
    img.shape = shape;
    img.carried = false;
    img.vx = 0; img.vy = 0;
    this.items.push(img);
  }

  /** 維持每種形狀在場(未被撿)的數量到 perShapeTarget */
  private replenishItems(): void {
    const counts: Record<string, number> = { diamond: 0, star: 0, heart: 0, gem: 0 };
    for (const it of this.items) { if (it.active && !it.carried) counts[it.shape]++; }
    for (const shape of this.cfg.shapes) {
      while (counts[shape] < this.cfg.perShapeTarget) { this.spawnItem(shape as ShapeKey); counts[shape]++; }
    }
  }

  // ── 告示：換要收集的形狀 ──
  private pickNewTargetShape(_force = false): void {
    // v2:固定定時換(不再看「丟對就換」或最短間隔)。換完排下一次。
    let next = this.randShape();
    let guard = 0; while (next === this.targetShape && guard++ < 5) next = this.randShape();
    this.targetShape = next;
    // ★v5:下次換告示間隔【9~12 秒隨機】(不規律)
    this.nextSignAt = this.time.now + Phaser.Math.Between(this.cfg.signIntervalMinMs, this.cfg.signIntervalMaxMs);
    this.signIcon.setTexture('collect-' + next); // ★與場上物件同貼圖(形狀+顏色一致)
    this.signText.setText(this.cfg.shapeNames[next]);
    // 告示閃一下
    this.tweens.add({ targets: [this.signIcon, this.signText], scale: { from: 1.4, to: 1 }, duration: 250 });
  }

  // ── 玩家：空白鍵依情境 → 手上無物件:撿最近;手上有物件:在箱子放入、不在箱子原地放下 ──
  private playerTryPickOrDeliver(): void {
    if (!this.running) return;
    const p = this.racers[0];
    if (p.carrying) {
      if (Phaser.Math.Distance.Between(p.x, p.y, p.bin.x, p.bin.y) <= this.cfg.binRadius + 10) {
        this.deliver(p);              // 在自己箱子→放入計分
      } else {
        this.dropInPlace(p);          // 不在箱子→原地放下(可重撿)
      }
      return;
    }
    // 手上無物件→撿最近的可撿物件
    const near = this.nearestItem(p.x, p.y, this.cfg.pickRadius);
    if (near) this.pickUp(p, near);
  }

  /** 原地放下手上物件：放回場上該位置、恢復可撿/碰撞、手上清空 */
  private dropInPlace(r: Racer): void {
    const item = r.carrying;
    if (!item) return;
    item.carried = false;
    item.setPosition(r.x, r.y - 4);
    item.vx = 0; item.vy = 0;
    item.setDepth(5);
    r.carrying = null;
  }

  private nearestItem(x: number, y: number, maxDist: number, shapeFilter?: ShapeKey): CollectItem | null {
    let best: CollectItem | null = null; let bestD = maxDist;
    for (const it of this.items) {
      if (!it.active || it.carried) continue;
      if (shapeFilter && it.shape !== shapeFilter) continue;
      const d = Phaser.Math.Distance.Between(x, y, it.x, it.y);
      if (d <= bestD) { bestD = d; best = it; }
    }
    return best;
  }

  private pickUp(r: Racer, item: CollectItem): void {
    item.carried = true;
    item.vx = 0; item.vy = 0;
    r.carrying = item;
  }

  private deliver(r: Racer): void {
    const item = r.carrying;
    if (!item) return;
    const correct = item.shape === this.targetShape;
    if (correct) {
      r.score++;
      this.updateScoreHud();
      // 得分特效：箱子上跳分
      this.showFloatText(r.bin.x, r.bin.y - this.cfg.binRadius - 20, '+1', r.bin.color);
      this.tweens.add({ targets: r.bin.gfx, scale: { from: 1.25, to: 1 }, duration: 200 });
      // v2:丟對【照常計分,但不觸發換告示】——換告示只由 10 秒定時器
    } else {
      // 撿錯不算分：物件彈出消失
      this.showFloatText(r.bin.x, r.bin.y - this.cfg.binRadius - 20, '✗', 0xff5555);
    }
    // 移除該物件、清空手上
    this.removeItem(item);
    r.carrying = null;
    this.replenishItems();
  }

  private removeItem(item: CollectItem): void {
    const idx = this.items.indexOf(item);
    if (idx >= 0) this.items.splice(idx, 1);
    item.destroy();
  }

  private showFloatText(x: number, y: number, txt: string, color: number): void {
    const t = this.add.text(x, y, txt, {
      fontFamily: 'monospace', fontSize: '24px', fontStyle: 'bold',
      color: '#' + color.toString(16).padStart(6, '0'), stroke: '#000', strokeThickness: 4
    }).setOrigin(0.5).setDepth(30);
    this.tweens.add({ targets: t, y: y - 36, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  private updateScoreHud(): void {
    for (let i = 0; i < 4; i++) this.scoreTexts[i].setText(this.cfg.ownerNames[i] + ': ' + this.racers[i].score);
  }

  // ── 每幀 ──
  update(_time: number, delta: number): void {
    if (!this.running) return;
    const dt = delta / 1000;
    // 計時
    const remainMs = Math.max(0, this.endsAt - this.time.now);
    this.timerText.setText(String(Math.ceil(remainMs / 1000)));
    if (remainMs <= 0 && !this.finishing) { this.beginFinish(); return; }

    this.updatePlayer(dt);
    for (let i = 1; i < 4; i++) this.updateBot(this.racers[i], dt);
    // ★v5 物件補充【每幀即時】:任一形狀場上(未撿)數量<perShapeTarget→立刻補齊,場上隨時充足、不會缺、找得到告示指定形狀
    this.replenishItems();
    // v2 物件【可被推開】(反轉):角色走路碰到物件→推動【物件】讓開(不擋角色);物件速度整合+摩擦+邊界+互不疊。
    for (const r of this.racers) this.pushItemsFromRacer(r, dt);
    this.updateItemsPhysics(dt);
    // 帶著的物件跟隨角色(在頭上)
    for (const r of this.racers) {
      if (r.carrying) { r.carrying.x = r.x; r.carrying.y = r.y - 30; r.carrying.setDepth(11); }
    }
    // v2 告示【固定每 N 秒換】(定時,不看丟對)
    if (this.time.now >= this.nextSignAt) this.pickNewTargetShape(true);
    // ★v4:撿取提示——高亮玩家可撿範圍內最近可撿物件
    this.updatePickHint(dt);
  }

  /** ★v4 撿取提示:玩家手上無物件時,高亮 pickRadius 內【最近可撿物件】(脈動描邊發光)→一眼知道按空白會撿到誰。手上有物件→不顯示。 */
  private updatePickHint(dt: number): void {
    const g = this.pickHint;
    if (!g) return;
    g.clear();
    const p = this.racers[0];
    if (this.phase !== 'playing' || !p || p.carrying) return; // 手上有物件→不提示
    const near = this.nearestItem(p.x, p.y, this.cfg.pickRadius);
    if (!near) return;
    // 脈動:半徑與透明度隨時間呼吸
    this.pickHintPulse += dt * 6;
    const pulse = (Math.sin(this.pickHintPulse) + 1) * 0.5; // 0..1
    const baseR = this.cfg.itemRadius + 6;
    const r = baseR + pulse * 6;
    // 外發光描邊(兩層)+ 連線到玩家
    g.lineStyle(4, 0xffe066, 0.35 + pulse * 0.35);
    g.strokeCircle(near.x, near.y, r + 4);
    g.lineStyle(3, 0xffffff, 0.6 + pulse * 0.3);
    g.strokeCircle(near.x, near.y, r);
    // 玩家→物件連線(提示「按空白撿這個」)
    g.lineStyle(2, 0xffe066, 0.4);
    g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(near.x, near.y); g.strokePath();
  }

  /**
   * v2 物件可被推開(反轉自「擋角色」)：角色與未撿物件重疊→把【物件】朝被撞方向推出重疊 + 給推速度。
   * 角色照常移動不被擋(走過去把物件撥開)。carried 物件不參與。同 v62 主戰鬥木箱可推動做法。
   */
  private pushItemsFromRacer(r: Racer, dt: number): void {
    const rr = 16;
    for (const it of this.items) {
      if (!it.active || it.carried) continue;
      if (r.carrying === it) continue;
      const minDist = rr + this.cfg.itemRadius;
      const dx = it.x - r.x, dy = it.y - r.y; // 角色→物件方向 = 把物件往外推
      const d = Math.hypot(dx, dy);
      if (d < minDist) {
        const overlap = minDist - d;
        const nx = d > 0.001 ? dx / d : 1, ny = d > 0.001 ? dy / d : 0;
        // ★v4:位置校正拖行【上限 itemPushDragMax】——即使玩家一直走進來,物件每幀最多只被撥開一點點
        //   (允許輕微重疊,靠 pickRadius 仍可撿);→碰到幾乎不動,不會被拖著跑一整段。
        const move = Math.min(overlap, this.cfg.itemPushDragMax);
        it.x += nx * move; it.y += ny * move;
        // 推速度也降權(避免累加飛走);friction 大→放開立刻停
        const spd = this.cfg.itemPush.maxPushSpeed;
        it.vx += nx * spd * dt; it.vy += ny * spd * dt;
      }
    }
  }

  /** v2 每幀更新物件物理：速度整合+摩擦停下 + 夾場內(推到牆停) + 物件間不疊(互推)。 */
  private updateItemsPhysics(dt: number): void {
    const a = this.arena;
    const items = this.items;
    const R = this.cfg.itemRadius;
    // 1. 速度整合 + 摩擦 + 邊界
    for (const it of items) {
      if (!it.active || it.carried) continue;
      if (it.vx === 0 && it.vy === 0) continue;
      let nx = it.x + it.vx * dt, ny = it.y + it.vy * dt;
      if (nx < a.left + R) { nx = a.left + R; it.vx = 0; }
      else if (nx > a.right - R) { nx = a.right - R; it.vx = 0; }
      if (ny < a.top + R) { ny = a.top + R; it.vy = 0; }
      else if (ny > a.bottom - R) { ny = a.bottom - R; it.vy = 0; }
      it.x = nx; it.y = ny;
      const f = Math.max(0, 1 - this.cfg.itemPush.friction * dt);
      it.vx *= f; it.vy *= f;
      if (Math.abs(it.vx) < 3 && Math.abs(it.vy) < 3) { it.vx = 0; it.vy = 0; }
    }
    // 2. 物件間不疊(兩兩分離,各推一半)
    const active = items.filter(it => it.active && !it.carried);
    for (let i = 0; i < active.length; i++) {
      const A = active[i];
      for (let j = i + 1; j < active.length; j++) {
        const B = active[j];
        const minDist = R * 2;
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy);
        if (d < minDist && d > 0.001) {
          const push = (minDist - d) / 2;
          const nx = dx / d, ny = dy / d;
          A.x = Phaser.Math.Clamp(A.x - nx * push, a.left + R, a.right - R);
          A.y = Phaser.Math.Clamp(A.y - ny * push, a.top + R, a.bottom - R);
          B.x = Phaser.Math.Clamp(B.x + nx * push, a.left + R, a.right - R);
          B.y = Phaser.Math.Clamp(B.y + ny * push, a.top + R, a.bottom - R);
        }
      }
    }
    // 同步 sprite(image 用自身 x/y 即座標,無需額外)
  }

  private clampRacer(r: Racer): void {
    const a = this.arena;
    r.x = Phaser.Math.Clamp(r.x, a.left + 16, a.right - 16);
    r.y = Phaser.Math.Clamp(r.y, a.top + 16, a.bottom - 16);
    r.sprite.setPosition(r.x, r.y);
  }

  private updatePlayer(dt: number): void {
    const p = this.racers[0];
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
    }
    this.clampRacer(p);
  }

  // ── BOT AI：狀態機(找正確形狀→撿→送回自己箱子) ──
  private updateBot(r: Racer, dt: number): void {
    // 週期性決策(反應延遲)
    if (this.time.now >= r.nextDecideAt) {
      r.nextDecideAt = this.time.now + this.cfg.botReactMs;
      if (!r.carrying) {
        // 決定要撿的形狀：多半找正確形狀，偶爾故意撿錯(難度適中)
        r.wrongPickThisTrip = Math.random() < this.cfg.botWrongPickChance;
        const wantShape = r.wrongPickThisTrip ? this.randShape() : this.targetShape;
        // 找該形狀最近的物件(全場找,不限撿取半徑)
        r.target = this.nearestItem(r.x, r.y, Infinity, wantShape) || this.nearestItem(r.x, r.y, Infinity);
      } else {
        // 帶著→若手上形狀已非當前指定(告示換了)且是錯的,還是送回(送回不對就不得分)——簡化:一律送回自己箱子
        r.target = null;
      }
    }

    // 移動目標：手上有物件→回自己箱子；否則→去撿的物件
    let tx: number, ty: number, arriveR: number, arrived: () => void;
    if (r.carrying) {
      tx = r.bin.x; ty = r.bin.y; arriveR = this.cfg.binRadius + 4;
      arrived = () => this.deliver(r);
    } else if (r.target && r.target.active && !r.target.carried) {
      tx = r.target.x; ty = r.target.y; arriveR = this.cfg.pickRadius - 4;
      arrived = () => { if (r.target) this.pickUp(r, r.target); r.target = null; };
    } else {
      // 沒目標→原地(下次決策再找)
      this.clampRacer(r); return;
    }
    const dx = tx - r.x, dy = ty - r.y;
    const d = Math.hypot(dx, dy);
    if (d <= arriveR) { arrived(); this.clampRacer(r); return; }
    r.x += (dx / d) * this.cfg.botMoveSpeed * dt;
    r.y += (dy / d) * this.cfg.botMoveSpeed * dt;
    r.sprite.setFlipX(dx < 0);
    this.clampRacer(r);
  }

  /**
   * ★結束演出:時間到分出勝者→不立刻結算,先做【聚光燈聚焦勝利者】:
   * 畫面變暗 + 亮圈聚焦在最高分者(放大脈動慶祝),平手多人則同時聚焦→停留約1.8秒→才 endGame(排名)。
   */
  private beginFinish(): void {
    if (this.finishing) return;
    this.finishing = true;
    this.running = false;
    if (this.pickHint) this.pickHint.clear();
    const w = GameConfig.width, h = GameConfig.height;
    // 變暗
    this.add.rectangle(0, 0, w, h, 0x05070c, 0.7).setOrigin(0, 0).setDepth(30);
    // 找最高分(平手可多人)
    const top = Math.max(...this.racers.map(r => r.score));
    const winners = this.racers.filter(r => r.score === top);
    const spot = this.add.graphics().setDepth(31);
    let pulse = 0;
    // 勝者提到最上層 + 放大慶祝
    winners.forEach(wnr => {
      wnr.sprite.setDepth(33);
      this.tweens.add({ targets: wnr.sprite, scale: { from: 1, to: 1.4 }, duration: 350, yoyo: true, repeat: 3 });
      // 勝者名牌
      this.add.text(wnr.x, wnr.y - 46, '🏆 ' + this.cfg.ownerNames[wnr.index], {
        fontFamily: 'monospace', fontSize: '18px', color: '#ffe066', fontStyle: 'bold', stroke: '#000', strokeThickness: 4
      }).setOrigin(0.5).setDepth(34);
    });
    // 聚光燈亮圈脈動(每幀重畫)
    const ev = this.time.addEvent({
      delay: 16, loop: true, callback: () => {
        pulse += 0.12;
        spot.clear();
        for (const wnr of winners) {
          const rr = 46 + Math.sin(pulse) * 8;
          spot.fillStyle(0xfff4c2, 0.16);
          spot.fillCircle(wnr.x, wnr.y, rr + 14);
          spot.lineStyle(4, 0xffe066, 0.85);
          spot.strokeCircle(wnr.x, wnr.y, rr);
        }
      }
    });
    // 停留後→結算
    this.time.delayedCall(1800, () => { ev.remove(); spot.destroy(); this.endGame(); });
  }

  // ── 結算：排名 + 得分 + 再玩/回選單 ──
  private endGame(): void {
    this.running = false;
    if (this.pickHint) this.pickHint.clear(); // 清撿取提示
    const w = GameConfig.width, h = GameConfig.height;
    this.add.rectangle(0, 0, w, h, 0x000000, 0.7).setOrigin(0, 0).setDepth(40);
    // 排名(分數高→低；同分保持原序)
    const ranked = this.racers.map(r => ({ name: this.cfg.ownerNames[r.index], score: r.score, color: this.cfg.binColors[r.index], isBot: r.isBot }))
      .sort((a, b) => b.score - a.score);
    const winner = ranked[0];
    this.add.text(w / 2, h * 0.2, '⏱ 時間到！', { fontFamily: 'monospace', fontSize: '48px', color: '#ffe66d', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5).setDepth(41);
    const champLine = winner.score > 0
      ? '🏆 冠軍：' + winner.name + '（' + winner.score + ' 分）'
      : '本局無人得分';
    this.add.text(w / 2, h * 0.3, champLine, { fontFamily: 'monospace', fontSize: '26px', color: '#ffffff', stroke: '#000', strokeThickness: 4 })
      .setOrigin(0.5).setDepth(41);
    // 排名列表
    ranked.forEach((r, i) => {
      const y = h * 0.4 + i * 40;
      this.add.text(w / 2, y, (i + 1) + '. ' + r.name + '　' + r.score + ' 分', {
        fontFamily: 'monospace', fontSize: '22px',
        color: '#' + r.color.toString(16).padStart(6, '0'), fontStyle: i === 0 ? 'bold' : 'normal', stroke: '#000', strokeThickness: 3
      }).setOrigin(0.5).setDepth(41);
    });
    // 按鈕：再玩一次 / 回小遊戲選單(方向鍵選+空白/Enter確定,點擊仍可)
    this.endButtons = [];
    this.endSelected = 0;
    this.makeEndButton(w / 2 - 130, h * 0.78, '🔄 再玩一次', 0x4a90d9, () => this.scene.restart());
    this.makeEndButton(w / 2 + 130, h * 0.78, '← 小遊戲選單', 0x2d3748, () => this.quitToMenu());
    // 選中高亮框
    this.endHighlight = this.add.rectangle(0, 0, 232, 62).setStrokeStyle(4, 0xffe066, 1).setDepth(43);
    this.tweens.add({ targets: this.endHighlight, alpha: { from: 1, to: 0.4 }, duration: 600, yoyo: true, repeat: -1 });
    this.selectEndButton(0);
    // 鍵盤:左右/上下選、空白/Enter確定
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    const toggle = () => this.selectEndButton(this.endSelected === 0 ? 1 : 0);
    kb.addKey(KC.LEFT).on('down', () => this.selectEndButton(0));
    kb.addKey(KC.RIGHT).on('down', () => this.selectEndButton(1));
    kb.addKey(KC.A).on('down', () => this.selectEndButton(0));
    kb.addKey(KC.D).on('down', () => this.selectEndButton(1));
    kb.addKey(KC.UP).on('down', toggle);
    kb.addKey(KC.DOWN).on('down', toggle);
    const confirm = () => { const btn = this.endButtons[this.endSelected]; if (btn) btn.cb(); };
    // 用新的 SPACE key 監聽(避開遊戲中的 attackKey——結算時 running=false, onSpace 不動作)
    kb.addKey(KC.SPACE).on('down', confirm);
    kb.addKey(KC.ENTER).on('down', confirm);
  }

  private selectEndButton(i: number): void {
    this.endSelected = i;
    const btn = this.endButtons[i];
    if (btn && this.endHighlight) { this.endHighlight.setPosition(btn.x, btn.y); }
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
