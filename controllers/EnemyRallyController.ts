import type Phaser from 'phaser';
import { GameConfig } from '../config';
import type { Character } from '../objects/Character';
import type { Enemy } from '../objects/Enemy';
import { isRegularEnemy } from '../systems/enemyKinds';

/** EnemyRallyController 需要場景提供的能力 */
export interface EnemyRallyHost {
  /** 敵人物件池 */
  enemies(): Phaser.GameObjects.Group;
  /** 全部角色（索引即座位） */
  characters(): ReadonlyArray<Character>;
  /** 目前是否要召集（小關卡進行中） */
  isActive(): boolean;
}

/**
 * 怪是否正在打它綁定的玩家：召集中、近戰怪在追擊 / 蓄力 / 冷卻中、投擲怪在綁定玩家的投擲射程內
 *
 * @param e 怪
 * @param characters 全部角色（索引即座位）
 */
function isEngaged(e: Enemy, characters: ReadonlyArray<Character>): boolean {
  if (e.isRallying()) return true;
  if (e.enemyType !== 'bomber') return e.getAiState() !== 'patrol';
  const target = characters[e.targetSeat];
  return !!target?.alive && (e.x - target.x) ** 2 + (e.y - target.y) ** 2 <= GameConfig.enemy.bomber.throwRange ** 2;
}

/**
 * 召集：玩家身邊完全沒有怪（engagedRadius 內沒有、也沒有怪正在追他或被召集去找他）持續 lonelyMs，
 * 就從 recruitRange 內挑最近的 recruitCount 隻閒置的怪去找他（原速走過去，不加速）。
 *
 * - 每 checkIntervalMs 評估一次（不是每幀）
 * - 候選：已實體化的一般怪（不含 BOSS / 寶箱怪 / 塔 / NPC）、沒在打任何玩家、不在其他玩家 excludeNearOtherPlayer 內
 * - 多人：同一輪多位玩家缺怪時依座位順序挑，被挑走的怪不會再被別的玩家挑；同一位玩家召集後冷卻 cooldownMs
 * - 被召集的怪綁定該玩家直到走到附近 / 逾時 / 該玩家倒下（見 Enemy.startRally），途中不換目標
 */
export class EnemyRallyController {
  private nextCheckAt = 0;
  /** 各座位開始「身邊沒怪」的時間（0 = 身邊有怪） */
  private lonelySince: number[] = [];
  /** 各座位下次可召集的時間 */
  private readyAt: number[] = [];

  constructor(private readonly host: EnemyRallyHost) {}

  /**
   * 每幀呼叫：到了評估時間就更新每位玩家的「身邊沒怪」計時，達標就召集
   *
   * @param time 目前場景時間
   */
  update(time: number): void {
    const cfg = GameConfig.enemyRally;
    if (!cfg.enabled) return;
    if (!this.host.isActive()) {
      this.lonelySince = [];
      return;
    }
    if (time < this.nextCheckAt) return;
    this.nextCheckAt = time + cfg.checkIntervalMs;

    const characters = this.host.characters();
    const enemies = this.regularEnemies();
    const lonely: number[] = [];
    for (let seat = 0; seat < characters.length; seat++) {
      const c = characters[seat];
      if (!c?.alive) {
        this.lonelySince[seat] = 0;
        continue;
      }
      if (this.countEngaged(seat, c, characters, enemies) > 0) {
        this.lonelySince[seat] = 0;
        continue;
      }
      if (!this.lonelySince[seat]) this.lonelySince[seat] = time;
      if (time - this.lonelySince[seat] >= cfg.lonelyMs && time >= (this.readyAt[seat] ?? 0)) lonely.push(seat);
    }
    if (lonely.length === 0) return;
    const taken = new Set<Enemy>();
    for (const seat of lonely) {
      const recruits = this.pickRecruits(seat, characters, enemies, taken);
      if (recruits.length === 0) continue;
      for (const e of recruits) {
        e.startRally(seat, time + cfg.maxRallyMs);
        taken.add(e);
      }
      this.lonelySince[seat] = 0;
      this.readyAt[seat] = time + cfg.cooldownMs;
    }
  }

  /** 場上已實體化、還活著的一般怪 */
  private regularEnemies(): Enemy[] {
    const out: Enemy[] = [];
    for (const child of this.host.enemies().getChildren()) {
      const e = child as Enemy;
      if (e.active && !e.dead && !e.telegraphing && isRegularEnemy(e)) out.push(e);
    }
    return out;
  }

  /**
   * 正在打這位玩家的怪數：engagedRadius 內的怪，加上綁定他且正在追擊 / 被召集去找他的怪
   *
   * @param seat 座位
   * @param c 該座位的角色
   * @param characters 全部角色
   * @param enemies 一般怪
   */
  private countEngaged(seat: number, c: Character, characters: ReadonlyArray<Character>, enemies: ReadonlyArray<Enemy>): number {
    const r2 = GameConfig.enemyRally.engagedRadius ** 2;
    let n = 0;
    for (const e of enemies) {
      const near = (e.x - c.x) ** 2 + (e.y - c.y) ** 2 <= r2;
      if (near || (e.targetSeat === seat && isEngaged(e, characters))) n++;
    }
    return n;
  }

  /**
   * 替指定玩家挑召集對象：recruitRange 內、沒在打任何玩家、不在其他玩家附近、這一輪還沒被挑走的怪，取最近的 recruitCount 隻
   *
   * @param seat 缺怪的座位
   * @param characters 全部角色
   * @param enemies 一般怪
   * @param taken 這一輪已被其他玩家挑走的怪
   */
  private pickRecruits(seat: number, characters: ReadonlyArray<Character>, enemies: ReadonlyArray<Enemy>, taken: ReadonlySet<Enemy>): Enemy[] {
    const cfg = GameConfig.enemyRally;
    const focus = characters[seat];
    const range2 = cfg.recruitRange ** 2;
    const exclude2 = cfg.excludeNearOtherPlayer ** 2;
    const candidates: Array<{ e: Enemy; d2: number }> = [];
    for (const e of enemies) {
      if (taken.has(e) || isEngaged(e, characters)) continue;
      if (e.enemyType === 'bomber' && !GameConfig.enemy.bomber.moveEnabled) continue; // 不會走的投擲怪叫不過來
      const d2 = (e.x - focus.x) ** 2 + (e.y - focus.y) ** 2;
      if (d2 > range2) continue;
      const nearOther = characters.some((c, i) => i !== seat && c?.alive && (e.x - c.x) ** 2 + (e.y - c.y) ** 2 <= exclude2);
      if (!nearOther) candidates.push({ e, d2 });
    }
    candidates.sort((a, b) => a.d2 - b.d2);
    return candidates.slice(0, cfg.recruitCount).map((c) => c.e);
  }
}
