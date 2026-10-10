import Phaser from 'phaser';
import { GameConfig } from '../config';

/** Chrome 才有的 performance.memory（其他瀏覽器沒有時不顯示 heap） */
interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

/** 一幀的取樣：遊戲迴圈間隔與場景更新耗時（毫秒） */
interface FrameSample {
  frameMs: number;
  updateMs: number;
}

/**
 * 實機效能監控（除錯 F9 開關）：畫面左上角顯示 FPS、幀時間、場景每幀更新耗時（平均 / 最慢，
 * 含場景 update 與 tween、計時器、物理等外掛的更新），以及場上物件數、敵人數、tween 數、紋理數與 JS heap，
 * 用來在目標機台與手機上找出實際瓶頸。
 *
 * 開啟時才計時（PRE_UPDATE 到 POST_UPDATE），文字每 refreshMs 更新一次，對效能的影響可忽略。
 */
export class PerfOverlay {
  private text: Phaser.GameObjects.Text | null = null;
  private samples: FrameSample[] = [];
  private lastRefreshAt = 0;
  /** 本幀場景更新開始的時間（performance.now） */
  private updateStartedAt = 0;
  /** 上一幀場景更新結束的時間（算實際幀間隔；Phaser 的 loop.delta 經過平滑與上限處理，不代表真實間隔） */
  private lastPostUpdateAt = 0;

  /**
   * @param scene 所在場景
   * @param extraLines 額外顯示的除錯行（例如本關怪物配置）；省略則不顯示
   */
  constructor(private readonly scene: Phaser.Scene, private readonly extraLines?: () => string[]) {
    scene.input.keyboard?.on('keydown-F9', () => this.toggle());
    // 場景重開 / 離開時移除事件監聽與文字
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { if (this.text) this.disable(); });
  }

  /** 開關監控 */
  toggle(): void {
    if (this.text) this.disable();
    else this.enable();
  }

  /** 開啟：監聽場景更新前後計時，建立顯示文字 */
  private enable(): void {
    const cfg = GameConfig.debug.perfOverlay;
    this.samples.length = 0;
    this.updateStartedAt = 0;
    this.lastPostUpdateAt = 0;
    this.scene.events.on(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    this.text = this.scene.add.text(cfg.x, cfg.y, '', {
      fontFamily: 'monospace', fontSize: cfg.fontSize, color: '#7CFC00', backgroundColor: '#000000aa',
      padding: { x: 8, y: 6 }
    }).setScrollFactor(0).setDepth(cfg.depth);
    this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.refresh, this);
    this.refresh();
  }

  /** 關閉：移除監聽與文字 */
  private disable(): void {
    this.scene.events.off(Phaser.Scenes.Events.PRE_UPDATE, this.onPreUpdate, this);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.refresh, this);
    this.text?.destroy();
    this.text = null;
  }

  /** 場景更新開始：記下時間 */
  private onPreUpdate(): void {
    this.updateStartedAt = performance.now();
  }

  /** 場景更新結束：記錄這一幀的取樣，每 refreshMs 重算統計並更新文字 */
  private refresh(): void {
    const text = this.text;
    if (!text) return;
    const now = performance.now();
    if (this.updateStartedAt > 0 && this.lastPostUpdateAt > 0) {
      this.samples.push({ frameMs: now - this.lastPostUpdateAt, updateMs: now - this.updateStartedAt });
      if (this.samples.length > GameConfig.debug.perfOverlay.sampleFrames) this.samples.shift();
    }
    this.lastPostUpdateAt = now;
    if (now - this.lastRefreshAt < GameConfig.debug.perfOverlay.refreshMs) return;
    this.lastRefreshAt = now;
    const n = this.samples.length || 1;
    const avgFrame = this.samples.reduce((a, s) => a + s.frameMs, 0) / n;
    const avgUpdate = this.samples.reduce((a, s) => a + s.updateMs, 0) / n;
    const maxUpdate = this.samples.reduce((a, s) => Math.max(a, s.updateMs), 0);
    const game = this.scene.game;
    const enemies = this.scene.children.list.filter((o) => o.active && (o as { enemyType?: string }).enemyType !== undefined).length;
    const heap = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
    text.setText([
      `FPS ${(avgFrame > 0 ? 1000 / avgFrame : 0).toFixed(0)}   幀 ${avgFrame.toFixed(1)}ms`,
      `場景更新 平均 ${avgUpdate.toFixed(2)}ms / 最慢 ${maxUpdate.toFixed(2)}ms`,
      `物件 ${this.scene.children.list.length}   敵人 ${enemies}`,
      `tween ${this.scene.tweens.getTweens().length}   紋理 ${Object.keys(game.textures.list).length}`,
      heap !== undefined ? `heap ${(heap / 1e6).toFixed(0)}MB` : 'heap -',
      ...(this.extraLines?.() ?? [])
    ]);
  }
}
