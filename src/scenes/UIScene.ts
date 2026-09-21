import Phaser from 'phaser';
import { GameConfig } from '../config';

interface CharStat {
  label: string;
  color: number;
  hp: number;
  maxHp: number;
  spirit: number;
  maxSpirit: number;
  kills: number;
  alive: boolean;
  isPlayer: boolean;
}

interface StatsPayload {
  chars: CharStat[];
  teamKills: number;
  survivalMs: number;
  playerBurstReady: boolean;
  count: number;
  maxCount: number;
  /** v14 等級制 */
  level: number;
  levelCap: number;
  levelExpInto: number;
  levelExpNeed: number;
  /** v25 第8項：P1 普攻累計命中次數 */
  p1AttackHits: number;
  /** v27 波次制 */
  wave: number;
  waveKilled: number;
  waveQuota: number;
  waveState: string;
  /** ★波次進度 HUD(關卡制) */
  levelMode?: boolean;
  currentLevel?: number;
  currentSub?: string;
  subWavesDone?: number;
  subWavesTarget?: number;
  progressPhase?: string;
  crossingOpen?: boolean;
  /** v31/v55 連段(招式)系統 */
  controlMode: string;
  combo: number;
  comboMax: number;
  comboThresholds: { circle: number; line: number; burst: number; empower: number };
  comboUnlocked: { circle: boolean; line: boolean; burst: boolean; empower: boolean };
  empowerRemainMs: number;
  /** v55 能量(強化)系統(slow 用) */
  energy: number;
  energyMax: number;
  energyTrigger: number;
  empowered: boolean;
}

/**
 * UIScene（v19）：疊在遊戲上方的 HUD。
 * - 上方中央：團隊總擊殺 + 存活時間 + 加夥伴提示 + 等級/經驗條
 * - 血量/鬥氣改顯示在「各角色腳下」（見 Character），HUD 不再有底部狀態列與攻擊鈕
 * - 攻擊：空白鍵 或 點擊畫面任意處（不顯示大按鈕）
 * - 角色周圍：P1 的方向瞄準圓環 + 箭頭
 */
export class UIScene extends Phaser.Scene {
  private teamText!: Phaser.GameObjects.Text;
  private timeText!: Phaser.GameObjects.Text;

  /** v20 恢復：畫面下方 4 欄角色狀態列（與角色腳下小條並存） */
  private rows: {
    labelText: Phaser.GameObjects.Text;
    hpBarBg: Phaser.GameObjects.Rectangle;
    hpBar: Phaser.GameObjects.Rectangle;
    spiritBar: Phaser.GameObjects.Rectangle;
    killText: Phaser.GameObjects.Text;
  }[] = [];
  private readonly panelBarW = 150;

  private aimGraphics!: Phaser.GameObjects.Graphics;
  private joinHintText!: Phaser.GameObjects.Text;
  /** ★波次進度 HUD:節點序列圖(●─●─◆);Graphics 每幀重繪 */
  private waveHudGfx!: Phaser.GameObjects.Graphics;
  /** 波次 HUD 最新進度(供 update() 每幀重繪脈動用);visible 決定是否顯示 */
  private waveHudDone = 0;
  private waveHudTarget = 0;
  private waveHudShow = false;
  /** ★線漸進填滿:目前已填滿的「線段進度」(0..target),每幀 lerp 逼近 waveHudFillTarget */
  private waveHudFill = 0;
  /** ★③逐怪反饋:目標填線進度 = 已完成波數 + 當前波(waveKilled/waveQuota);每殺一隻怪即前進一點 */
  private waveHudFillTarget = 0;
  /** ★D:節點圖案 icons — nodeIcons[]=波次節點(enemy-normal),rewardIcon=獎勵節點(collect-gem) */
  private nodeIcons: Phaser.GameObjects.Image[] = [];
  private rewardIcon!: Phaser.GameObjects.Image;
  /** v25 第8項：P1 普攻命中計數（左上角） */
  private hitText!: Phaser.GameObjects.Text;
  /** v31/v55 連段(招式)條 + 節點(fast:3/6/9/10、slow:3/6/9) */
  private comboBar!: Phaser.GameObjects.Rectangle;
  private comboNodes: Phaser.GameObjects.Text[] = [];
  private comboLabel!: Phaser.GameObjects.Text;
  /** v55 能量(強化)條 + 標籤 + 「強化中」標示(slow 專用,fast 隱藏) */
  private energyBar!: Phaser.GameObjects.Rectangle;
  private energyBarBg!: Phaser.GameObjects.Rectangle;
  private energyLabel!: Phaser.GameObjects.Text;
  private empowerText!: Phaser.GameObjects.Text;
  private energyUiInit = false;
  /** ★v58:能量集滿(可按Z)狀態→update() 每幀讓能量條+提示文字閃爍。 */
  private energyFull = false;
  private energyEmpowered = false;
  /** ★v61:上次能量值→偵測增加時給能量條一個放大脈動(打死怪明顯反饋)。 */
  private lastEnergy = 0;
  private readonly comboBarWidth = 240;
  /** v27 波次顯示（上方中央） */
  private waveText!: Phaser.GameObjects.Text;
  /** v28 BOSS 血條 */
  private bossBarBg!: Phaser.GameObjects.Rectangle;
  private bossBar!: Phaser.GameObjects.Rectangle;
  private bossLabel!: Phaser.GameObjects.Text;
  private readonly bossBarWidth = 460;
  /** v33 事件 HUD（進度/倒數條） */
  private eventBarBg!: Phaser.GameObjects.Rectangle;
  private eventBar!: Phaser.GameObjects.Rectangle;
  private eventLabel!: Phaser.GameObjects.Text;
  private readonly eventBarWidth = 400;
  /** ★道具開關觸控按鈕(右上角);面色/字隨 itemsEnabled 狀態更新;與鍵盤 I 鍵並存 */
  private itemToggleBtnBg!: Phaser.GameObjects.Rectangle;
  private itemToggleBtnText!: Phaser.GameObjects.Text;

  constructor() {
    super('UIScene');
  }

  create(): void {
    // 根因修復：重啟時 rows 殘留上一局已銷毀物件會崩潰，每次 create 先清空
    this.rows = [];
    this.comboNodes = [];
    const w = GameConfig.width;
    const h = GameConfig.height;

    // 團隊總分 + 時間（上方中央）——★用戶要求隱藏這兩個上方文字(保留物件供 stats 更新,不顯示)
    this.teamText = this.add
      .text(w / 2, 14, '團隊總擊殺 0', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffe66d',
        stroke: '#000000',
        strokeThickness: 4
      })
      .setOrigin(0.5, 0)
      .setVisible(false);
    this.timeText = this.add
      .text(w / 2, 40, '時間 0.0s', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#cbd5e1',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setVisible(false);

    // ★波次進度 HUD(關卡制:節點序列 ●─●─◆);固定螢幕、每幀依 stats 重繪,預設隱藏。
    this.waveHudGfx = this.add.graphics()
      .setScrollFactor(0)
      .setDepth(25)
      .setVisible(false);
    // ★D:節點 icon(修正版):原本 Graphics 圓形/菱形形狀、發光、pulse 全部保留(Graphics depth25 不動)。
    // Icon 只是疊在節點中心的【小裝飾】——尺寸明顯小於節點,不蓋住邊框/發光效果。depth=26。不加 mask。
    const iconMaxWaves = 4;
    const nr = GameConfig.waveHud.nodeRadius;
    const waveIconSize = Math.round(nr * 1.6); // 約 nodeRadius×0.8 半徑 → 不蓋外圈
    for (let i = 0; i < iconMaxWaves; i++) {
      const icon = this.add.image(0, 0, 'enemy-normal')
        .setScrollFactor(0).setDepth(26).setVisible(false)
        .setDisplaySize(waveIconSize, waveIconSize);
      this.nodeIcons.push(icon);
    }
    // 獎勵節點 icon(collect-gem 綠寶石):菱形比圓形略大,icon 縮一點
    const rewardIconSize = Math.round(nr * 1.6);
    this.rewardIcon = this.add.image(0, 0, 'collect-gem')
      .setScrollFactor(0).setDepth(26).setVisible(false)
      .setDisplaySize(rewardIconSize, rewardIconSize);

    // ★UI調整②:加入夥伴提示移到【畫面下方】(角色狀態列上方,置中)
    this.joinHintText = this.add
      .text(w / 2, h - 100, '按 B 加入夥伴 (1/4)', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#7bed9f',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setDepth(21);

    // ★拔等級(階段2):等級數字 + 經驗條 HUD 已移除(等級系統已拔,數值固定滿等)。畫面下方留白,不再顯示 Lv/經驗。

    // v25 第8項：P1 普攻命中計數（左上角，不擋主要畫面）
    this.hitText = this.add
      .text(12, 12, '命中 0', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#8be9fd',
        stroke: '#000000',
        strokeThickness: 4
      })
      .setOrigin(0, 0);

    // v27 波次顯示（右上角）
    this.waveText = this.add
      .text(w - 12, 12, 'WAVE 1  0/12', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffb86c',
        stroke: '#000000',
        strokeThickness: 4,
        align: 'right'
      })
      .setOrigin(1, 0);

    // v31/v55 連段條(左上)。fast=一條「連段」4節點(3/6/9/10)+強化倒數；slow=「COMBO」3節點(3/6/9)+下方能量條。
    // 兩套元件都建好，首次 stats(controlMode) 再依模式 toggle。
    const comboX = 12;
    const comboY = 40;
    this.comboLabel = this.add
      .text(comboX, comboY - 2, '連段', {
        fontFamily: 'monospace', fontSize: '12px', color: '#c8b6ff', stroke: '#000000', strokeThickness: 3
      })
      .setOrigin(0, 0);
    this.add
      .rectangle(comboX, comboY + 16, this.comboBarWidth, 10, 0x000000, 0.5)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xc8b6ff, 0.5);
    this.comboBar = this.add
      .rectangle(comboX + 1, comboY + 17, 0, 8, 0xc8b6ff)
      .setOrigin(0, 0);
    // 建 4 個節點(3/6/9/10)；slow 時第4個(★)會隱藏、前3個位置改用 /9 比例(update 時重算)。
    const nThresholds = [3, 6, 9, 10];
    const nLabels = ['◯', '—', '爆', '★'];
    for (let i = 0; i < nThresholds.length; i++) {
      const px = comboX + (nThresholds[i] / 10) * this.comboBarWidth;
      const t = this.add
        .text(px, comboY + 30, nLabels[i], {
          fontFamily: 'monospace', fontSize: '13px', color: '#555555', stroke: '#000000', strokeThickness: 2
        })
        .setOrigin(0.5, 0);
      this.comboNodes.push(t);
    }
    // 能量條(slow 專用，下方一排金色；fast 隱藏)
    const energyY = comboY + 48;
    this.energyLabel = this.add
      .text(comboX, energyY - 2, '能量', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffd700', stroke: '#000000', strokeThickness: 3
      })
      .setOrigin(0, 0)
      .setVisible(false);
    this.energyBarBg = this.add
      .rectangle(comboX, energyY + 16, this.comboBarWidth, 10, 0x000000, 0.5)
      .setOrigin(0, 0)
      .setStrokeStyle(1, 0xffd700, 0.5)
      .setVisible(false);
    this.energyBar = this.add
      .rectangle(comboX + 1, energyY + 17, 0, 8, 0xffd700)
      .setOrigin(0, 0)
      .setVisible(false);
    this.empowerText = this.add
      .text(comboX + this.comboBarWidth + 10, comboY + 6, '', {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffd700', stroke: '#000000', strokeThickness: 3, fontStyle: 'bold'
      })
      .setOrigin(0, 0)
      .setVisible(false);

    // v20 恢復：畫面下方 4 欄角色狀態列（顏色/標籤/血條/鬥氣/擊殺）
    const count = GameConfig.characters.count;
    const colW = 236;
    const colGap = 8;
    const baseX = 16;
    const rowTopY = h - 52;
    for (let i = 0; i < count; i++) {
      const x = baseX + i * (colW + colGap);
      const color = GameConfig.characters.colors[i];
      const label = GameConfig.characters.labels[i];
      this.add.rectangle(x, rowTopY, 12, 12, color).setOrigin(0, 0).setDepth(20);
      const labelText = this.add
        .text(x + 18, rowTopY - 3, label, { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 })
        .setDepth(20);
      const killText = this.add
        .text(x + 60, rowTopY - 3, 'x0', { fontFamily: 'monospace', fontSize: '13px', color: '#ffffff', stroke: '#000000', strokeThickness: 2 })
        .setDepth(20);
      const bY = rowTopY + 16;
      const hpBarBg = this.add
        .rectangle(x, bY, this.panelBarW, 12, 0x000000, 0.5)
        .setOrigin(0, 0)
        .setStrokeStyle(1, 0xffffff, 0.3)
        .setDepth(20);
      const hpBar = this.add.rectangle(x + 1, bY + 1, this.panelBarW - 2, 10, 0x4ade80).setOrigin(0, 0).setDepth(20);
      const spiritBar = this.add.rectangle(x + 1, bY + 13, 0, 5, 0x60a5fa).setOrigin(0, 0).setDepth(20);
      this.rows.push({ labelText, hpBarBg, hpBar, spiritBar, killText });
    }

    this.aimGraphics = this.add.graphics().setDepth(30);

    // v28 BOSS 血條（上方中央，預設隱藏）
    const bossBarY = 116;
    this.bossLabel = this.add
      .text(w / 2, bossBarY - 16, 'BOSS', {
        fontFamily: 'monospace',
        fontSize: '15px',
        color: '#ff5a6e',
        stroke: '#000000',
        strokeThickness: 3
      })
      .setOrigin(0.5, 0)
      .setDepth(40)
      .setVisible(false);
    this.bossBarBg = this.add
      .rectangle(w / 2 - this.bossBarWidth / 2, bossBarY, this.bossBarWidth, 14, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setStrokeStyle(2, 0xff3355, 0.8)
      .setDepth(40)
      .setVisible(false);
    this.bossBar = this.add
      .rectangle(w / 2 - this.bossBarWidth / 2 + 2, bossBarY + 2, this.bossBarWidth - 4, 10, 0xff3355)
      .setOrigin(0, 0)
      .setDepth(40)
      .setVisible(false);

    // v33 事件 HUD 條（上方中央，BOSS 條下方；預設隱藏）
    const eventBarY = 142;
    this.eventLabel = this.add
      .text(w / 2, eventBarY - 16, '', {
        fontFamily: 'monospace', fontSize: '15px', color: '#ffd166', stroke: '#000000', strokeThickness: 3
      })
      .setOrigin(0.5, 0).setDepth(40).setVisible(false);
    this.eventBarBg = this.add
      .rectangle(w / 2 - this.eventBarWidth / 2, eventBarY, this.eventBarWidth, 12, 0x000000, 0.6)
      .setOrigin(0, 0).setStrokeStyle(2, 0xffd166, 0.8).setDepth(40).setVisible(false);
    this.eventBar = this.add
      .rectangle(w / 2 - this.eventBarWidth / 2 + 2, eventBarY + 2, this.eventBarWidth - 4, 8, 0xffd166)
      .setOrigin(0, 0).setDepth(40).setVisible(false);

    // v19：移除右下攻擊鈕；改為「點擊畫面任意處」觸發攻擊（空白鍵仍可用，於 GameScene）
    // ★道具開關觸控按鈕(右上角):必須在全畫面攻擊熱區【之前】建立,並攔截 pointerdown(stopPropagation)避免點按鈕也觸發攻擊。
    const btnW = 56, btnH = 36, btnPad = 12;
    const btnCx = w - btnPad - btnW / 2;
    const btnCy = btnPad + btnH / 2;
    const initOn = GameConfig.items.spawnEnabled;
    this.itemToggleBtnBg = this.add
      .rectangle(btnCx, btnCy, btnW, btnH, initOn ? 0x1a7f37 : 0x9b2226, 0.85)
      .setStrokeStyle(2, 0xffffff, 0.7)
      .setDepth(50)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.itemToggleBtnText = this.add
      .text(btnCx, btnCy, initOn ? '道具\nON' : '道具\nOFF', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', stroke: '#000000', strokeThickness: 2, align: 'center'
      })
      .setOrigin(0.5, 0.5)
      .setDepth(51)
      .setScrollFactor(0);
    this.itemToggleBtnBg.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation(); // ★攔截:不讓此點擊冒泡到全畫面攻擊熱區
      this.game.events.emit('ui-toggle-items');
    });

    this.input.on('pointerdown', () => this.game.events.emit('ui-attack'));

    this.game.events.on('stats', this.updateStats, this);
    this.game.events.on('aim', this.updateAim, this);
    this.game.events.on('boss-hp', this.updateBossHp, this);
    this.game.events.on('event-hud', this.updateEventHud, this);
    this.game.events.on('items-state', this.updateItemToggleBtn, this);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off('stats', this.updateStats, this);
      this.game.events.off('aim', this.updateAim, this);
      this.game.events.off('boss-hp', this.updateBossHp, this);
      this.game.events.off('event-hud', this.updateEventHud, this);
      this.game.events.off('items-state', this.updateItemToggleBtn, this);
      // ★D:清除節點 icon
      for (const ic of this.nodeIcons) ic.destroy();
      if (this.rewardIcon) this.rewardIcon.destroy();
    });
  }

  /** ★道具開關按鈕面:隨 itemsEnabled 狀態即時更新色/字(開=綠ON、關=紅OFF)。由 GameScene 'items-state' 事件驅動。 */
  private updateItemToggleBtn = (on: boolean): void => {
    if (!this.itemToggleBtnBg) return;
    this.itemToggleBtnBg.setFillStyle(on ? 0x1a7f37 : 0x9b2226, 0.85);
    this.itemToggleBtnText.setText(on ? '道具\nON' : '道具\nOFF');
  };

  /** v33 事件 HUD 更新：label + 進度/倒數 */
  private updateEventHud = (d: { active: boolean; label: string; ratio: number; remainMs: number }): void => {
    const show = d.active;
    this.eventLabel.setVisible(show);
    this.eventBarBg.setVisible(show);
    this.eventBar.setVisible(show);
    if (show) {
      const suffix = d.remainMs > 0 ? `  ${(d.remainMs / 1000).toFixed(1)}s` : '';
      this.eventLabel.setText(`${d.label}${suffix}`);
      this.eventBar.width = (this.eventBarWidth - 4) * Phaser.Math.Clamp(d.ratio, 0, 1);
    }
  };

  /** v28：BOSS 血條更新 */
  private updateBossHp = (d: { active: boolean; ratio: number }): void => {
    const show = d.active;
    this.bossLabel.setVisible(show);
    this.bossBarBg.setVisible(show);
    this.bossBar.setVisible(show);
    if (show) {
      this.bossBar.width = (this.bossBarWidth - 4) * Phaser.Math.Clamp(d.ratio, 0, 1);
    }
  };

  private updateStats = (s: StatsPayload): void => {
    this.teamText.setText(`團隊總擊殺 ${s.teamKills}`);
    this.timeText.setText(`時間 ${(s.survivalMs / 1000).toFixed(1)}s`);
    // v25 第8項：P1 普攻命中次數
    this.hitText.setText(`命中 ${s.p1AttackHits ?? 0}`);
    // v27 波次：Wave N + 進度；intermission 顯示過關中
    if (s.waveState === 'intermission') {
      this.waveText.setText(`WAVE ${s.wave} CLEAR!`);
    } else {
      this.waveText.setText(`WAVE ${s.wave}  ${s.waveKilled}/${s.waveQuota}`);
    }

    // ★波次進度 HUD(關卡制:節點序列 ●─●─◆);只在【純波次子區】顯示;事件/BOSS/非 levelMode 隱藏。
    // 這裡只記錄狀態,實際節點繪製在 update() 每幀跑(脈動+線漸填平滑)。
    const nowShow = !!(GameConfig.waveHud.enabled && s.levelMode &&
        s.waveState !== 'event' && s.waveState !== 'boss' &&
        s.progressPhase === 'playing' && !s.crossingOpen &&
        (s.subWavesTarget ?? 0) > 0);
    const newDone = s.subWavesDone ?? 0;
    const newTarget = s.subWavesTarget ?? 0;
    // ★③逐怪反饋:填線目標 = 已完成波數 + 當前波內殺敵比例(waveKilled/waveQuota),clamp 在 [0,target]。
    // 每殺一隻怪 onWaveKill→emitStats→這裡更新目標→update() 每幀平滑 lerp 逼近→線一點一點推進(非打完整波才動)。
    //
    // ★BUG 修:波與波【過渡期(intermission)】,上一波剛完成 subWavesDone 已 +1,但 waveKilled 仍殘留 = 上一波 quota
    //   (要到下一波 spawning 才歸零)→ 若照算 curWaveFrac = quota/quota = 1 → fillTarget = done+1 → 第二段線直接跳滿。
    //   根因:當前波分項在過渡期讀到上一波的殘留殺敵值。修法:非 spawning/clearing(即 intermission 等下一波未開始)
    //   時,當前波分項一律當 0(下一波還沒開始,不該有進度);waveQuota<=0 也當 0(除零防呆)。
    const waveActive = (s.waveState === 'spawning' || s.waveState === 'clearing');
    const wq = s.waveQuota ?? 0;
    const curWaveFrac = (waveActive && wq > 0)
      ? Phaser.Math.Clamp((s.waveKilled ?? 0) / wq, 0, 1)
      : 0;
    const newFillTarget = Phaser.Math.Clamp(newDone + curWaveFrac, 0, newTarget);
    // 新子區(target 變 或 從隱藏轉顯示 或 done 倒退)→重置線填滿進度為 0(重新一節一節填)
    if (newTarget !== this.waveHudTarget || (nowShow && !this.waveHudShow) || newDone < this.waveHudDone) {
      this.waveHudFill = 0;
    }
    this.waveHudShow = nowShow;
    this.waveHudDone = newDone;
    this.waveHudTarget = newTarget;
    this.waveHudFillTarget = newFillTarget;
    if (!this.waveHudShow) {
      this.waveHudGfx.setVisible(false);
      for (const ic of this.nodeIcons) ic.setVisible(false);
      if (this.rewardIcon) this.rewardIcon.setVisible(false);
    }

    // v55：連段/能量 HUD——依 controlMode 切換佈局(首次設定 toggle)。
    const slow = s.controlMode === 'slow';
    if (!this.energyUiInit) {
      this.energyUiInit = true;
      // 佈局切換(只需一次)：slow 顯示能量條/標籤、combo 標籤改 COMBO、隱藏第4節點★；fast 反之。
      this.comboLabel.setText(slow ? 'COMBO' : '連段');
      this.energyLabel.setVisible(slow);
      this.energyBarBg.setVisible(slow);
      this.energyBar.setVisible(slow);
      const comboX = 12;
      if (slow && this.comboNodes.length >= 4) {
        this.comboNodes[3].setVisible(false); // 隱藏 ★(強化不在 combo 條)
        // 前3節點位置改用 /9 比例(slow comboMax=9)
        const t3 = [s.comboThresholds.circle, s.comboThresholds.line, s.comboThresholds.burst];
        for (let i = 0; i < 3; i++) this.comboNodes[i].x = comboX + (t3[i] / 9) * this.comboBarWidth;
      }
    }

    // COMBO 條 + 節點高亮
    if (s.comboMax) {
      const ratio = Phaser.Math.Clamp(s.combo / s.comboMax, 0, 1);
      this.comboBar.width = (this.comboBarWidth - 2) * ratio;
      const unlocked = [s.comboUnlocked.circle, s.comboUnlocked.line, s.comboUnlocked.burst, s.comboUnlocked.empower];
      const thr = [s.comboThresholds.circle, s.comboThresholds.line, s.comboThresholds.burst, s.comboThresholds.empower];
      const activeColors = ['#00e5ff', '#ff4d6d', '#ff9a3c', '#ffd700'];
      const n = slow ? 3 : this.comboNodes.length;
      for (let i = 0; i < n; i++) {
        if (!unlocked[i]) this.comboNodes[i].setColor('#555555');
        else this.comboNodes[i].setColor(s.combo >= thr[i] ? activeColors[i] : '#aaaaaa');
      }
    }

    if (slow) {
      // 能量條(強化):能量改【擊殺獲得】,滿 trigger 改【按 Z 手動觸發】、強化期間倒退(條往下退)。
      const eRatio = Phaser.Math.Clamp(s.energy / (s.energyMax || 100), 0, 1);
      this.energyBar.width = (this.comboBarWidth - 2) * eRatio;
      // ★v61:能量【增加】時給能量條一個放大脈動(打死怪明顯反饋)。
      if (s.energy > this.lastEnergy && !s.empowered) {
        this.tweens.killTweensOf(this.energyBar);
        this.energyBar.setScale(1);
        this.tweens.add({ targets: this.energyBar, scaleY: { from: 2.2, to: 1 }, duration: 220, ease: 'Quad.easeOut' });
      }
      this.lastEnergy = s.energy;
      this.energyEmpowered = !!s.empowered;
      this.energyFull = !s.empowered && s.energy >= (s.energyTrigger || 100);
      if (s.empowered) {
        this.energyBar.setFillStyle(0xffef99).setAlpha(1);
        this.empowerText.setVisible(true).setColor('#ffef99').setText('強化中');
      } else if (this.energyFull) {
        // ★集滿提示(閃爍在 update() 每幀跑):金色能量條 + 「按 Z 強化!」。
        this.empowerText.setVisible(true).setColor('#ffe23a').setText('按 Z 強化!');
      } else {
        this.energyBar.setFillStyle(0xffd700).setAlpha(1);
        this.empowerText.setVisible(false);
      }
    } else {
      this.energyFull = false;
      this.energyEmpowered = false;
      // fast：原強化倒數
      if (s.empowerRemainMs > 0) {
        this.empowerText.setVisible(true).setText(`強化 ${(s.empowerRemainMs / 1000).toFixed(1)}s`);
      } else {
        this.empowerText.setVisible(false);
      }
    }

    // ★拔等級(階段2):等級+經驗條更新已移除(HUD 已拿掉)。

    // 加入夥伴提示：滿了改字
    if (s.count >= s.maxCount) {
      this.joinHintText.setText(`夥伴已滿 (${s.count}/${s.maxCount})`);
      this.joinHintText.setColor('#94a3b8');
    } else {
      this.joinHintText.setText(`按 B 加入夥伴 (${s.count}/${s.maxCount})`);
      this.joinHintText.setColor('#7bed9f');
    }

    // v20 下方 4 欄面板更新（血/鬥氣/擊殺；與角色腳下小條並存）
    const bw = this.panelBarW - 2;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (i >= s.chars.length) {
        row.hpBar.width = 0;
        row.spiritBar.width = 0;
        row.labelText.setColor('#555555');
        row.killText.setText('未加入');
        row.killText.setColor('#555555');
        continue;
      }
      const c = s.chars[i];
      if (!c.alive) {
        row.hpBar.width = 0;
        row.spiritBar.width = 0;
        row.labelText.setColor('#777777');
        row.killText.setText(`x${c.kills} ✖`);
        row.killText.setColor('#777777');
        continue;
      }
      row.labelText.setColor('#ffffff');
      // v55(slow-A)：慢速模式 P1 無血量、不會死 → 不顯示血條(隱藏 hp 條+底)，標籤標「無敵」。
      if (slow && c.isPlayer) {
        row.hpBarBg.setVisible(false);
        row.hpBar.setVisible(false);
      } else {
        row.hpBarBg.setVisible(true);
        row.hpBar.setVisible(true);
      }
      const hpRatio = Phaser.Math.Clamp(c.hp / c.maxHp, 0, 1);
      row.hpBar.width = bw * hpRatio;
      row.hpBar.fillColor = hpRatio > 0.5 ? 0x4ade80 : hpRatio > 0.25 ? 0xfacc15 : 0xef4444;
      const spRatio = Phaser.Math.Clamp(c.spirit / c.maxSpirit, 0, 1);
      row.spiritBar.width = bw * spRatio;
      row.spiritBar.fillColor = spRatio >= 1 ? 0xffd700 : 0x60a5fa;
      row.killText.setText(`x${c.kills}`);
      row.killText.setColor('#ffffff');
    }
  };

  /** 每幀:波次節點序列脈動 + 線漸進填滿重繪(只在顯示時)。 */
  update(_time: number, delta: number): void {
    // ★v58:能量集滿(可按Z)→能量條+提示文字金色閃爍(每幀跑,不受 stats 事件節奏影響)。
    if (this.energyFull && !this.energyEmpowered) {
      const blink = 0.5 + 0.5 * Math.abs(Math.sin(this.time.now / 180));
      this.energyBar.setFillStyle(0xffe23a).setAlpha(blink);
      this.empowerText.setAlpha(blink);
    } else {
      this.empowerText.setAlpha(1);
    }
    if (!this.waveHudShow) return;
    // ★③逐怪反饋:waveHudFill 每幀 lerp 逼近 waveHudFillTarget(=已完成波+當前波殺敵比例)。
    // 每殺一隻怪目標往前一點→線一點一點平滑推進(非打完整波才填);一整「段線」約 lineFillMs 填滿速率。
    const rate = delta / Math.max(1, GameConfig.waveHud.lineFillMs); // 每 ms 前進的段數比例
    if (this.waveHudFill < this.waveHudFillTarget) {
      this.waveHudFill = Math.min(this.waveHudFillTarget, this.waveHudFill + rate);
    } else if (this.waveHudFill > this.waveHudFillTarget) {
      this.waveHudFill = this.waveHudFillTarget;
    }
    this.drawWaveNodes(this.waveHudDone, this.waveHudTarget, this.waveHudFill);
    this.waveHudGfx.setVisible(true);
    // ★D:更新節點 icons 位置+狀態(跟 waveHudGfx 相同座標系)
    this.updateNodeIcons(this.waveHudDone, this.waveHudTarget);
  }

  /**
   * ★D:節點 icon 位置/狀態更新(每幀在 drawWaveNodes 後呼叫)。
   * 波次節點 icon(enemy-normal): done=亮(tint 白)、pending=暗(tint 0x666666)。
   * 獎勵節點 icon(collect-gem): allDone=亮,else=暗。mask 跟隨節點中心。
   */
  private updateNodeIcons(done: number, target: number): void {
    const cfg = GameConfig.waveHud;
    const total = target + 1; // 波次節點 + 獎勵節點
    const gap = cfg.nodeGap;
    const width = (total - 1) * gap;
    const startX = cfg.x - width / 2;
    const y = cfg.y;
    // 波次節點(target 個):icon 疊在圓形中心,尺寸小於節點,不蓋外圈/發光
    for (let i = 0; i < this.nodeIcons.length; i++) {
      const icon = this.nodeIcons[i];
      if (i >= target) { icon.setVisible(false); continue; }
      const cx = startX + i * gap;
      icon.setPosition(cx, y).setVisible(true);
      icon.setTint(i < done ? 0xffffff : 0x888888); // done=亮白、pending=暗灰
    }
    // 獎勵節點:icon 疊在菱形中心
    const rx = startX + target * gap;
    const allDone = done >= target;
    this.rewardIcon.setPosition(rx, y).setVisible(true);
    this.rewardIcon.setTint(allDone ? 0xffffff : 0x666666);
  }

  /**
   * ★波次進度節點序列 ●─●─◆:target 個波次節點 + 1 個獎勵節點(菱形)。
   * 先畫線(含漸進填滿 fill)→再畫節點(節點蓋住線交會處,層次壓過線)。
   * done 個波次已亮、第 done+1 個(當前波)高亮脈動、其餘暗;fill=已填滿的線段進度(0..target)。
   */
  private drawWaveNodes(done: number, target: number, fill: number): void {
    const cfg = GameConfig.waveHud;
    const g = this.waveHudGfx;
    g.clear();
    const total = target + 1; // 波次節點 + 獎勵節點
    const r = cfg.nodeRadius, gap = cfg.nodeGap;
    const width = (total - 1) * gap;
    const startX = cfg.x - width / 2;
    const y = cfg.y;
    const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.time.now / 260));

    // ---- 1) 連線(先畫,節點會蓋在上層) ----
    for (let i = 0; i < total - 1; i++) {
      const x1 = startX + i * gap, x2 = startX + (i + 1) * gap;
      // 底線(暗)
      g.lineStyle(cfg.lineThickness, cfg.lineColor, 0.9);
      g.lineBetween(x1, y, x2, y);
      // 已填滿部分(此段的 fill 比例:fill 落在 [i, i+1] 之間→部分填;>=i+1→全填)
      const segFill = Phaser.Math.Clamp(fill - i, 0, 1);
      if (segFill > 0) {
        g.lineStyle(cfg.lineThickness, cfg.lineFillColor, 1);
        g.lineBetween(x1, y, x1 + (x2 - x1) * segFill, y);
      }
    }

    // ---- 2) 波次節點(畫在線上層,★不透明蓋住線交會) ----
    // 每個節點先畫一層【不透明底盤(alpha1)】把線端點完全蓋掉→線絕不從節點下透出;再畫顏色層。
    const bg = 0x1a1408; // 深底(HUD 背景色調)——節點不透明底盤
    for (let i = 0; i < target; i++) {
      const cx = startX + i * gap;
      const isDone = i < done;
      const isCurrent = i === done;
      // 不透明底盤(半徑略大於線,確保完全蓋住線端點/交會)
      g.fillStyle(bg, 1); g.fillCircle(cx, y, r + 3);
      if (isDone) {
        g.fillStyle(cfg.doneColor, 1); g.fillCircle(cx, y, r);          // 亮金填滿(不透明)
        g.lineStyle(3, 0x000000, 0.45); g.strokeCircle(cx, y, r);
      } else if (isCurrent) {
        // 當前波:不透明實心(用 pulse 調亮度,非 alpha→仍完全不透明蓋線)+ 脈動外框
        const litColor = this.mixColor(bg, cfg.currentColor, pulse);
        g.fillStyle(litColor, 1); g.fillCircle(cx, y, r);
        g.lineStyle(4, cfg.currentColor, 0.5 + 0.5 * pulse); g.strokeCircle(cx, y, r + 6);
      } else {
        g.fillStyle(0x000000, 1); g.fillCircle(cx, y, r);               // 暗底(不透明,空心感靠描邊)
        g.lineStyle(3, cfg.pendingColor, 1); g.strokeCircle(cx, y, r);
      }
    }

    // ---- 3) 獎勵/完成節點(菱形 ◆,畫最上層,不透明底盤蓋線) ----
    const rx = startX + target * gap;
    const allDone = done >= target;
    const dr = r + 4;
    // 不透明圓底盤蓋住線端點(菱形本身有尖角會露線,先用圓底盤墊底)
    g.fillStyle(bg, 1); g.fillCircle(rx, y, r + 3);
    const pts = [ new Phaser.Geom.Point(rx, y - dr), new Phaser.Geom.Point(rx + dr, y), new Phaser.Geom.Point(rx, y + dr), new Phaser.Geom.Point(rx - dr, y) ];
    if (allDone) { g.fillStyle(cfg.rewardColor, 1); g.fillPoints(pts, true); g.lineStyle(3, 0xfff4c2, 1); g.strokePoints(pts, true); }
    else { g.fillStyle(0x000000, 1); g.fillPoints(pts, true); g.lineStyle(3, cfg.rewardColor, 0.9); g.strokePoints(pts, true); }
  }

  /** 依比例 t(0..1) 在兩色間線性混色(用於當前波節點脈動亮度,保持不透明填滿)。 */
  private mixColor(c0: number, c1: number, t: number): number {
    const a = Phaser.Display.Color.IntegerToColor(c0);
    const b = Phaser.Display.Color.IntegerToColor(c1);
    const r = Math.round(Phaser.Math.Linear(a.red, b.red, t));
    const g = Math.round(Phaser.Math.Linear(a.green, b.green, t));
    const bl = Math.round(Phaser.Math.Linear(a.blue, b.blue, t));
    return Phaser.Display.Color.GetColor(r, g, bl);
  }

  /** P1 方向圓環 + 箭頭 + 衝刺距離指示線（P1 陣亡則隱藏） */
  private updateAim = (a: {
    alive: boolean;
    x: number;
    y: number;
    angle: number;
    dashDistance: number;
    showDashLine?: boolean;
  }): void => {
    const g = this.aimGraphics;
    g.clear();
    if (!a.alive) return;

    const cfg = GameConfig.aim;
    // ★方案e:aimGraphics 在 UIScene(固定相機 scroll0),但玩家座標是 GameScene 世界座標;
    //   GameScene 鏡頭跟隨捲動後,需扣掉 GameScene 相機 scroll 才對齊玩家螢幕位置(否則平移/捲動後圓圈箭頭會位移)。
    const gs = this.scene.get('GameScene');
    const gcam = gs && (gs as Phaser.Scene).cameras ? (gs as Phaser.Scene).cameras.main : null;
    const ox = gcam ? gcam.scrollX : 0;
    const oy = gcam ? gcam.scrollY : 0;
    const ax = a.x - ox, ay = a.y - oy;

    // 衝刺距離指示線（半透明）+ 終點小標記
    if (a.showDashLine !== false) {
      const ind = cfg.indicator;
      const ex = ax + Math.cos(a.angle) * a.dashDistance;
      const ey = ay + Math.sin(a.angle) * a.dashDistance;
      g.lineStyle(ind.thickness, ind.color, ind.alpha);
      g.lineBetween(ax, ay, ex, ey);
      g.fillStyle(ind.color, ind.alpha + 0.25);
      g.fillCircle(ex, ey, ind.endMarkerRadius);
    }

    // 方向圓環
    g.lineStyle(cfg.ringThickness, cfg.ringColor, cfg.ringAlpha);
    g.strokeCircle(ax, ay, cfg.ringRadius);

    // 箭頭
    const tipX = ax + Math.cos(a.angle) * (cfg.ringRadius + cfg.arrowSize * 0.6);
    const tipY = ay + Math.sin(a.angle) * (cfg.ringRadius + cfg.arrowSize * 0.6);
    const baseX = ax + Math.cos(a.angle) * (cfg.ringRadius - cfg.arrowSize * 0.4);
    const baseY = ay + Math.sin(a.angle) * (cfg.ringRadius - cfg.arrowSize * 0.4);
    const perp = a.angle + Math.PI / 2;
    const half = cfg.arrowSize * 0.5;
    g.fillStyle(cfg.arrowColor, 1);
    g.fillTriangle(
      tipX,
      tipY,
      baseX + Math.cos(perp) * half,
      baseY + Math.sin(perp) * half,
      baseX - Math.cos(perp) * half,
      baseY - Math.sin(perp) * half
    );
  };
}
