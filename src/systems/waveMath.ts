/**
 * ★階段2a 波次進度制核心純函式(波騎藍圖 decision 001387fb)。
 * 無副作用、可單元測試。GameScene 持有狀態,每幀呼叫這些判定。
 *
 * 名詞:
 * - progress:本波已累積進度(殺一隻+1,加權留後續)。
 * - targetProgress:本波目標(達標即可過波)。
 * - alive:場上實體化的活怪數。
 * - pending:已生成但還在 telegraph(登場預警)中、尚未實體化的怪數(★算進總量防超生)。
 * - maxAlive:場上同時上限。
 * - spawnThreshold:活怪跌破此值→開始補生。
 * - refilling(latch):補生栓——跌破 threshold 開,補到 maxAlive 才關(防抖,避免在 threshold 邊界抖動)。
 */

export interface WaveSpawnState {
  progress: number;
  targetProgress: number;
  alive: number;
  pending: number;
  maxAlive: number;
  spawnThreshold: number;
  /** latch:目前是否在補生中(跨幀持有,由 updateRefillLatch 維護)。 */
  refilling: boolean;
}

/**
 * 更新 latch(補生栓):活怪+pending 跌破 threshold→開;補到 >=maxAlive→關。
 * 回傳更新後的 refilling(呼叫端要把它存回狀態)。防抖核心:開關有遲滯,不在邊界抖。
 */
export function updateRefillLatch(occupancy: number, maxAlive: number, spawnThreshold: number, refilling: boolean): boolean {
  if (!refilling && occupancy < spawnThreshold) return true;   // 跌破→開始補
  if (refilling && occupancy >= maxAlive) return false;        // 補滿→關閉
  return refilling;                                            // 其餘維持(遲滯)
}

/**
 * ★聰明停生:這一幀是否【還能再生一隻】(生產總量封頂,絕不超生)。
 * ① 生產總量已達目標(progress + alive + pending >= targetProgress)→停(不多生,殺完剛好達標)。
 * ② 場上(含 pending)已達上限(alive + pending >= maxAlive)→停(這幀不生,等空位)。
 * ③ 其餘:只有在【補生中(refilling latch 開)】才補——即 occupancy 曾跌破 threshold 且尚未補滿。
 * ★pending 一定要算進①②(波騎頭號雷:只算 alive 會在 telegraph 空窗連續超生)。
 */
export function shouldSpawnMore(s: WaveSpawnState): boolean {
  const occupancy = s.alive + s.pending;
  if (s.progress + occupancy >= s.targetProgress) return false; // ① 總量封頂
  if (occupancy >= s.maxAlive) return false;                    // ② 場上上限
  return s.refilling;                                           // ③ 補生中才生
}

/**
 * 過波推進判定。
 * - nextSegmentSpawns=true(下一段還是刷怪段):progress>=target 即可推進(殘怪帶過、不斷檔)。
 * - nextSegmentSpawns=false(下一段非波:走廊 crossing 過場 / 進事件 / 進 BOSS / 出口):
 *   progress>=target 且【場面清空(alive<=0 且 pending<=0)】才推進(清空才過,波騎踩雷)。
 */
export function shouldAdvanceSpawn(progress: number, targetProgress: number, alive: number, pending: number, nextSegmentSpawns: boolean): boolean {
  if (progress < targetProgress) return false;
  if (nextSegmentSpawns) return true;
  return alive <= 0 && pending <= 0;
}
