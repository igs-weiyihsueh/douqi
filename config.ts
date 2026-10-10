/**
 * 全遊戲可調數值集中於此，方便後續調校。
 * 所有數值皆為「暫定值」，之後可視手感調整。
 */
export const GameConfig = {
  /** 邏輯解析度（16:9 橫向；Phaser Scale FIT + CENTER_BOTH 等比縮放滿版） */
  width: 1920,
  height: 1080,

  /** 除錯工具 */
  debug: {
    /** 實機效能監控（F9 開關）：位置、字級、深度；文字每 refreshMs 更新，統計最近 sampleFrames 幀 */
    perfOverlay: { x: 12, y: 12, fontSize: '16px', depth: 200, refreshMs: 250, sampleFrames: 120 }
  },

  /** 波次進度 HUD(關卡制:節點序列 ●─●─◆);只純波次顯示,事件/BOSS 隱藏 */
  waveHud: {
    enabled: true,
    /** 節點序列置中的畫面座標(setScrollFactor0 固定);上方 */
    x: 960,  // 調整為1920/2 = 960 (置中)
    y: 45,   // 調整為適合1080高度的位置
    /** 節點半徑 */
    nodeRadius: 22,
    /** 節點間距(圓心到圓心) */
    nodeGap: 150,
    /** 連線粗細 */
    lineThickness: 5,
    /** 已完成波次節點(亮/填滿)色 */
    doneColor: 0xffe08a,
    /** 當前進行波節點(高亮)色 */
    currentColor: 0xfff4c2,
    /** 未到節點(暗/空心)色 */
    pendingColor: 0x6a5a34,
    /** 連線色(未填滿=暗底) */
    lineColor: 0x6a5a34,
    /** 已填滿連線色(進度推進) */
    lineFillColor: 0xffe08a,
    /** 線漸進填滿動畫時長(毫秒) */
    lineFillMs: 500,
    /** 卷軸 HUD 顯示的寶箱數（位置標記右邊依序排列；= 一輪關卡數，確保永遠看得到一個高階） */
    visibleStages: 4,
    /** 目前位置標記的顏色與中心亮點大小（相對節點半徑） */
    markerColor: 0x7affc0,
    markerDotScale: 0.45,
    /** 問號節點：底色、外框色、「?」字型與顏色 */
    mysteryColor: 0x6d28d9,
    mysteryRingColor: 0xc4b5fd,
    mysteryFontSize: '26px',
    mysteryTextColor: '#f5f3ff',
    /** 問號揭曉動畫：時長(毫秒)、擴散光環放大倍率（相對節點半徑） */
    revealMs: 900,
    revealRingScale: 1.5,
    /** 揭曉動畫前段「亮起來」所佔比例（其餘為翻轉），與白光最大透明度 */
    revealGlowPortion: 0.4,
    revealGlowAlpha: 0.85,
    /** 圓點不透明底盤色（蓋住量條端點） */
    nodeBgColor: 0x1a1408,
    /** 進入下一關時圓點左移遞補的動畫時長(毫秒) */
    shiftMs: 450,
    /** 低階 / 高階寶箱圖示色、外框色與尺寸（相對節點半徑） */
    lowChestColor: 0xb07a3c,
    highChestColor: 0xffd23f,
    chestOutlineColor: 0x2a1a08,
    lowChestScale: 0.7,
    highChestScale: 0.95,

    /** 節點外框線寬度 */
    nodeStrokeWidth: {
      /** 寶箱外框線寬 */
      chest: 2,
      /** 一般節點外框線寬 */
      normal: 3,
      /** 當前節點外框線寬 */
      current: 4
    },

    /** 節點外框距離 */
    nodePadding: {
      /** 底盤外擴距離（相對於節點半徑） */
      base: 3,
      /** 當前節點脈動外框距離（相對於節點半徑） */
      currentPulse: 6,
      /** 高階光暈外框距離（相對於節點半徑） */
      highHalo: 10
    },

    /** 寶箱比例設定 */
    chestRatios: {
      /** 寶箱寬高比 */
      aspectRatio: 1.4,
      /** 箱體起點（相對於寶箱高度） */
      bodyStart: 0.35,
      /** 箱體高度（相對於寶箱高度） */
      bodyHeight: 0.65,
      /** 箱蓋高度（相對於寶箱高度） */
      lidHeight: 0.4,
      /** 箱蓋提亮混色比例 */
      lidBrighten: 0.25,
      /** 鎖扣尺寸（相對於寶箱寬度/高度） */
      lockWidth: 0.16,
      lockHeight: 0.25,
      lockOffsetX: 0.08,
      lockOffsetY: 0.05
    },

    /** 脈動效果設定 */
    pulse: {
      /** 脈動週期（毫秒） */
      period: 260,
      /** 脈動基準值 */
      base: 0.6,
      /** 脈動振幅 */
      amplitude: 0.4,
      /** 當前節點底色混色強度 */
      currentMix: 0.5,
      /** 高階光暈透明度基準值 */
      haloAlphaBase: 0.35,
      /** 高階光暈透明度振幅 */
      haloAlphaAmplitude: 0.35,
      /** 量條底線透明度 */
      lineAlpha: 0.9
    }
  },

  /**
   * 競技場（固定視角）：整個場地一眼看完，鏡頭不跟隨。
   * 場地略小於畫面，四周留邊給圍欄與 HUD，讓敵人容易聚集、產生包圍壓迫感。
   */
  arena: {
    /** 場地距畫面邊緣的內縮（像素）；場地大小 = 畫面 - 2*padding */
    padding: 72,  // 按比例調整: 48 * (1920/1280) = 72
    /** 圍欄線框粗細 */
    borderThickness: 6,
    borderColor: 0x3a4668,
    /** 敵人被擊飛撞邊界的反彈係數（0=不反彈直接停、1=完全反彈） */
    bounceRestitution: 0.6
  },

  /**
   * 敵人↔敵人碰撞分離（讓怪不再完全重疊擠成團）——照異靈藍圖：軟分離 steering(主力) + 硬 de-overlap(補刀)。
   * 純幾何、不走 Phaser collider，config 可調手感。舊美術純俯視無縱深壓縮→圓形判定；F4 新美術改用腳底佔位橢圓（footprintFlatten / footprintSteerScale）。
   */
  enemySeparation: {
    /** 總開關 */
    enabled: true,
    /**
     * 軟分離「鄰居影響半徑」(像素)：半徑內鄰居才算遠離向量，平方加權(越近推力越大)。
     * 參考敵半徑(normal 14 / tank 22)×2~3。調到「不疊+不抖」的最小值。
     */
    radiusPx: 44,
    /**
     * combineWithSeparation 權重：finalDir = normalize(normalize(toTarget) + separation×weight)。
     * toTarget 先正規化再加分離，否則遠距追擊力淹沒分離力→還是疊團。weight 越大越散(但太大會抖/偏離追擊)。
     */
    weight: 1.1,
    /** 硬 de-overlap 迭代次數（兩兩距離<r_i+r_j 沿連線推開，迭代收斂）。 */
    iterations: 2,
    /**
     * 單幀硬解最大推移量(像素)：玩家衝進怪群瞬間大量重疊→限制每幀每隻最多推這麼多，分多幀鬆弛，避免瞬移/爆衝。
     */
    maxStepPx: 9,
    /**
     * F4 新美術（側視站立圖）的地面佔位：腳寬由圖片自動量出（左右半徑），上下半徑 = 左右半徑 × footprintFlatten，
     * 與慢速真空圈相同的透視壓扁（slow.vacuumFlatten）。中心在腳底，判定與真空圈同一基準。
     */
    footprintFlatten: 0.45,
    /** F4 新美術的軟分離影響範圍 = 兩個佔位橢圓相加的邊界 × 此倍數（舊美術 radiusPx 44 ÷ 半徑和 28 ≈ 1.6） */
    footprintSteerScale: 1.6
  },

  /**
   * 黏著目標(階段1,仿DouPo):怪生成即綁定一個目標角色,之後黏著不亂換——
   * 除非目標死/移除,或超出 stickyBreakRadius 持續 stickyBreakSec 才重綁最近。解決「別人走一圈把怪吸走」。
   */
  enemySticky: {
    /** 綁定目標超過此距離(像素)才【可能】解鎖重綁(需持續 stickyBreakSec)。設大(遠)→很黏。 */
    stickyBreakRadius: 800,
    /** 超距需【持續】幾秒才真的重綁(防抖:短暫拉開不換目標)。 */
    stickyBreakSec: 1
  },

  player: {
    maxHp: 100,
    /** 半徑（碰撞用） */
    radius: 16,
    /** 一般移動速度（目前操作只有攻擊，移動主要靠衝刺，這裡保留備用） */
    speed: 0,
    /** 單次普攻傷害 */
    attackDamage: 36,
    /** 衝刺速度（像素/秒） */
    dashSpeed: 1400,
    /** 普攻擊退力道 */
    knockback: 380,
    /** 攻擊後短暫無法再輸入的冷卻（毫秒）用戶指定:160→300(攻速 0.3秒1下=每秒~3.3下) */
    attackCooldownMs: 300,
    /** 受擊後的無敵時間（毫秒） */
    invulnMs: 600,
    /** 攻擊命中判定的額外半徑（普攻掃擊範圍） */
    attackHitRadius: 42,
    /** 遠距衝撞衝刺期間的護盾（無敵）；近戰扇形不給 */
    dashShieldInvuln: true
  },

  /**
   * 慢速模式（controlMode='slow'）專用數值。fast 模式不使用這些。
   * slow：純鍵盤，方向鍵/WASD 八方向持續移動(moveSpeed)、角色面向=移動方向、
   * 範圍圈（半徑 = 衝刺距離）內敵人自動鎖定(規則同 fast 但限此圈、方向源用面向)、空白鍵攻擊衝刺(共用 fast)。
   */
  slow: {
    /** 八方向持續移動速度（像素/秒；「一點點走」手感，做出後可再調） */
    moveSpeed: 400,
    /** 慢速專屬「無鎖衝刺距離」*/
    dashDistance: 250,
    /** 慢速專屬「衝刺速度」預設(用戶定案700)；fast 用 GameConfig.player.dashSpeed 不受影響 */
    dashSpeed: 700,
    /** 慢速模式普攻間隔（毫秒；角色編輯器的預設值，快速模式仍用 player.attackCooldownMs） */
    attackCooldownMs: 200,
    /**
     * 真空圈（腳下地盤 = 敵人進不來的範圍，P1 與 BOT 都有）：左右半徑 vacuumRadius，上下 = vacuumRadius × vacuumFlatten。
     * 大小 / 扁度 / 偏移為預設值，實際值取自角色編輯器（systems/characterParams）。
     * 一般怪會被推到「圈 + 自身半徑」之外（身體邊緣停在圈上）；近戰怪改在圈邊緣蓄力、出手
     */
    vacuumRadius: 70,
    /** 真空圈的上下壓扁比例（地盤畫法與判定共用） */
    vacuumFlatten: 0.45,
    /** 真空圈中心相對角色腳底的偏移（px）；X 正值往右、Y 正值往下 */
    vacuumOffsetX: 4,
    vacuumOffsetY: -12,
    /** 近戰怪在真空邊緣再往外多少像素內開始蓄力 */
    vacuumEngageMargin: 10,
    /** 近戰怪出手時，離真空邊緣多少像素內的角色會被打中（比蓄力餘量大，角色稍微退開仍打得到） */
    vacuumHitMargin: 16
  },

  /**
   * 鬥氣系統：
   * 每次攻擊(扇形/衝撞)只要至少命中 1 隻敵人 → +1 次（一次攻擊不論打中幾隻都只算 1）；
   * 揮空不累積。累積達 hitsToBurst 次即集滿觸發爆發。4 角色各自獨立。
   */
  spirit: {
    /** 集滿所需的「命中次數」 */
    hitsToBurst: 10
  },

  /**
   * 連段技系統：普攻命中累積 combo，達門檻觸發連段技。
   * 最終架構：一條 combo 累積，四技各自門檻：
   *   命中3→圓形、6→直線、9→爆發原地亂打、10→限時強化，到 10 歸零（快速模式；慢速見下）。
   * 與道具 6 招是不同系統。
   */
  /**
   * 連段技系統（僅 P1）。
   * COMBO 與能量拆成兩套【只在慢速模式(controlMode==='slow')】生效；快速模式維持原樣(一條 combo 3/6/9/10)。
   *   · 快速(fast)：一條 combo，命中+1，3圓/6直/9爆發/10強化(durationMs)，到10歸零。thresholds/max/durationMs 為 fast 用。
   *   · 慢速(slow)：COMBO(combo 區塊，slowThresholds 4圓/8直，到已解鎖最高招後歸零) + 能量(energy 區塊，滿門檻按 Z 變身、倒退解除)兩套獨立。
   *     爆發亂打在慢速改為【變身專屬】：變身期間 AOE 每命中 empower.burstEveryAoeHits 次觸發一次(見 empower)。
   */
  combo: {
    /** 快速模式各階觸發門檻（累積命中次數）：3圓/6直/9爆發/10強化 */
    thresholds: { circle: 3, line: 6, burst: 9, empower: 10 },
    /** 慢速模式各階觸發門檻：4圓/8直（爆發不在 combo 循環內，改為變身專屬） */
    slowThresholds: { circle: 4, line: 8 },
    /** combo 上限（fast：達10歸零＝強化門檻） */
    max: 10,
    /** 圓形範圍技（瞬發，不鎖角色） */
    circle: {
      radius: 160,
      damage: 40,
      knockback: 200
    },
    /** 直線範圍技（朝 aimAngle，瞬發貫穿） */
    line: {
      length: 420,
      width: 90,
      damage: 70,
      knockback: 260
    },
    /** 限時強化狀態。fast：命中10觸發、固定 durationMs；slow：改由能量滿10觸發、能量倒退到0解除(durationMs不用)。 */
    empower: {
      /** 5000→3000(強化持續約3秒，fast 用) */
      durationMs: 3000,
      damageMult: 1.8,
      rangeMult: 1.5,
      /** 強化期間移動/衝刺「距離」倍率（走位、衝刺終點距離更遠） */
      moveMult: 1.4,
      /** 強化期間衝向敵人的「衝刺速度」倍率 */
      dashSpeedMult: 1.5,
      /** 階段3:強化型態造型(程式繪製變身視覺,只 slow P1)。不放大。 */
      form: {
        tint: 0xffdc4d,          // 本體疊亮金色調
        ringColor: 0xffe066,     // 內光環
        ring2Color: 0xff7a3c,    // 外光環(反向轉,能量橙紅)
        outlineColor: 0xfff2a8,  // 描邊/glow外框
        particleTint: [0xffe86a, 0xffd23f, 0xffb020], // 上升粒子色
        orbitDots: 4,            // 繞轉光點數
        particleFreq: 60         // 粒子發射頻率(ms);越小越密
      },
      /** 慢速變身專屬爆發：變身期間 AOE 每命中(≥1隻)此次數就觸發一次爆發亂打，可重複 */
      burstEveryAoeHits: 4,
      /** 階段4:強化期【唯一招】——鎖定角色周圍圓範圍內的怪→打過去→以【目標】為中心炸圓AOE。只 slow P1。 */
      aoe: {
        radius: 160,             // 炸裂 AOE 半徑（以強化衝刺撞到的敵人為中心）
        damage: 60,              // AOE 圓內每隻敵人傷害
        knockback: 180,          // 輕擊退
        cooldownMs: 650,         // 每次放的冷卻(避免狂放)
        color: 0xffe066,         // 炸裂圈顏色
        ringMs: 300              // 炸裂圈擴張視覺時長
      }
    }
  },

  /**
   * 【實驗性】招式「表演時間」——施放圓/直/爆發時角色進入定身無敵(不能移動:走/衝刺/位移全鎖,但免傷免擊退)。
   * 時間到才恢復可動可被打。用 Character.skillLockUntil 實作(該狀態本就鎖 fast衝刺/slow走位輸入 + 賦予無敵)。
   * easy拔:enabled=false 即整組還原(不設 skillLockUntil→維持原本瞬發不鎖)。手感值可調。
   */
  performanceTime: {
    enabled: true,
    circle: 600,
    line: 600,
    burst: 1000
  },

  /**
   * 能量系統（只慢速模式 controlMode==='slow' 用，僅 P1，獨立於 combo）：
   * 重做:能量改【擊殺敵人獲得】(依怪種 perKill 給量)、被打中 -1(保留)、滿 trigger 不自動觸發→改【按 Z 鍵手動觸發】強化,
   * 強化期間能量每秒 drainPerSec 倒退退到 0 解除。BOSS 特例:命中(非擊殺)有 bossHitChance 機率給 bossHitAmount。
   */
  energy: {
    max: 150,
    /** 滿此值可觸發(手動按 Z);用戶回報太易→50→80→150(normal10×15=150,約殺15隻才滿,大幅提高門檻)。 */
    trigger: 150,
    /** 強化期間能量每秒倒退量;門檻 150 對應 150/7≈21.43/秒→維持強化持續約7秒不變(門檻提高持續不變)。 */
    drainPerSec: 150 / 7,
    /** 擊殺各怪種獲得能量(值調高→打死怪明顯有感;normal10→滿50約5隻)。未列用 default。 */
    perKill: {
      normal: 10,
      bomber: 15,
      tank: 25,
      default: 10
    } as Record<string, number>,
    /** BOSS 命中(非擊殺)給能量的機率與量(max50下 amount 提到12)。 */
    bossHitChance: 0.15,
    bossHitAmount: 12
  },

  /**
   * 階段三：COMBO獎勵系統配置
   * Hit streak (連擊數) → 票券獎勵轉換機制
   *
   * 核心機制：
   * - 每次出手命中敵人累積連擊數（擊殺不另外加）
   * - 達到里程碑獲得票券獎勵
   * - 時機視窗：超時重置連擊
   * - 警告機制：倒數期間視覺提醒
   */
  comboReward: {
    /** 連擊超時重置時間（毫秒）：2秒內無命中將重置連擊數 */
    STREAK_TIMEOUT_MS: 2000,
    /** 警告開始時間（毫秒）：1.5秒後進入警告狀態，UI開始閃爍 */
    WARNING_START_MS: 1500,
    /**
     * 獎勵里程碑：達到這些連擊數時記下獎勵，連擊中斷時只發「最高達成階」；
     * 最後一階為上限：達成時立即發獎並歸零重新累積
     */
    MILESTONES: [5, 10, 20, 50, 100] as const,
    /** 對應票券獎勵：各里程碑對應的票券數量 */
    REWARDS: [1, 3, 10, 50, 100] as const,
    /** UI閃爍週期（毫秒）：警告狀態下的閃爍頻率 */
    WARNING_BLINK_MS: 300,
  },

  /**
   * 階段三：彩票噴發特效系統配置
   *
   * 統一管理所有彩票特效相關的常數，避免硬編碼
   * 按功能分類：角度、物理、視覺、時間、邊界參數
   *
   * **用戶視覺問題修復**：調整參數讓彩票更明顯可見
   */
  ticketEffect: {
    /** 噴發角度參數（度數制） - 調整為更保守的可視範圍 */
    BURST_ANGLE: {
      /** 上方扇形左邊界角度 - 調整為更垂直 */
      MIN: -100,
      /** 上方扇形右邊界角度 - 調整為更垂直 */
      MAX: -80
    },
    
    /** 物理引擎參數 - 降低速度，延長觀看時間 */
    PHYSICS: {
      /** 最小初始速度 (px/s) - 大幅降低讓彩票飛得更慢 */
      MIN_VELOCITY: 80,
      /** 最大初始速度 (px/s) - 大幅降低讓彩票飛得更慢 */
      MAX_VELOCITY: 150,
      /** 每個里程碑的最小速度加成 - 降低加成 */
      VELOCITY_MILESTONE_BONUS: 2,
      /** 每個里程碑的最大速度加成 - 降低加成 */
      VELOCITY_MAX_BONUS: 3,
      /** 重力加速度 (px/s²) - 降低重力讓彩票飛更高更久 */
      GRAVITY: 150,
      /** 自轉速度 (圈/秒) */
      ROTATION_SPEED: 2,
      /** 物理更新間隔毫秒 (~60FPS) */
      FRAME_RATE_MS: 16
    },
    
    /** 視覺外觀參數 - 增大尺寸提高可見性 */
    VISUAL: {
      /** 彩票寬度 (px) - 增大為更明顯 */
      WIDTH: 30,
      /** 彩票高度 (px) - 增大為更明顯 */
      HEIGHT: 18,
      /** 金色填充色值 */
      COLOR: 0xFFD700,
      /** 白色邊框色值 */
      BORDER_COLOR: 0xFFFFFF,
      /** 邊框寬度 (px) - 增加邊框寬度提高對比度 */
      BORDER_WIDTH: 2,
      /** 顯示深度層級 - 大幅提高確保在最上層 */
      DEPTH: 200
    },
    
    /** 時間和數量參數 - 延長生命週期 */
    TIMING: {
      /** 基礎生命週期毫秒 - 延長讓用戶有更多時間看到 */
      LIFETIME_BASE_MS: 6000,
      /** 隨機延長時間毫秒 */
      LIFETIME_RANDOM_MS: 2000,
      /** 基礎彩票數量 */
      TICKET_COUNT_BASE: 8,
      /** 最大彩票數量 */
      TICKET_COUNT_MAX: 20,
      /** 里程碑數量係數 */
      TICKET_COUNT_MULTIPLIER: 0.4
    },
    
    /** 邊界檢查參數 */
    BOUNDARIES: {
      /** X軸邊界餘量 (px) */
      MARGIN_X: 50,
      /** Y軸邊界餘量 (px) */
      MARGIN_Y: 50
    }
  } as const,

  /** 爆發連招 */
  burst: {
    /** 連打段數 */
    hits: 16,
    /** 每段間隔（毫秒） */
    intervalMs: 55,
    /** 每段傷害 */
    damagePerHit: 22,
    /** 每段命中的作用半徑 */
    radius: 140,
    /** 擊退力道 */
    knockback: 0,
    /** 爆發時角色朝敵群衝刺的速度 */
    dashSpeed: 900,
    /** 爆發期間無敵 */
    invuln: true,
  },

  /** 角色（P1 玩家 + 3 BOT），共用同一套角色類別，差別只在輸入來源 */
  characters: {
    /** 角色總數（1 玩家 + 其餘 BOT） */
    count: 4,
    /** 各角色顏色（index 0 = P1） */
    colors: [0x5ad1ff, 0x7bed9f, 0xffa502, 0xff6b81],
    /** 頭上標籤（index 0 = P1） */
    labels: ['P1', 'BOT', 'BOT', 'BOT'],
    /** 初始環繞出生半徑（4 隻圍著場地中心散開） */
    spawnSpreadRadius: 90
  },

  /** BOT AI 行為（把玩家操作用 AI 代打） */
  bot: {
    /** 每次自動出手的間隔（毫秒） */
    attackIntervalMs: 420,
    /** 出手間隔隨機抖動（毫秒，± 此值），避免 3 隻同步 */
    attackJitterMs: 180,
    /** 選目標時的偵測範圍（超出此距離的敵人不優先，避免亂衝到天邊） */
    targetSearchRadius: 520,
    /** 找不到近敵時，朝敵群中心移動的游走速度（像素/秒） */
    wanderSpeed: 160,

    /**
     * BOT 搶道具行為（積極度中等，不為遠道具送死）。
     * BOT 會把「itemGreedRadius 內的道具」納入目標評分；越稀有(掉落權重越低)吸引力越高。
     */
    item: {
      /** 只搶此半徑內的道具（超出就專心打怪，不跑去送死） */
      greedRadius: 340,
      /**
       * 道具吸引力偏置（越大越傾向去撿道具而非打怪）：
       * 評分時把「到道具的等效距離」乘以 distanceBias(<1 表示更想去)。
       */
      distanceBias: 0.6,
      /**
       * 稀有加權：道具吸引力再乘以 (1 / dropWeight)^rarityExponent。
       * 時停 T 掉落權重 0.25 最低 → 吸引力最高，競爭最激烈。
       */
      rarityExponent: 0.5
    }
  },

  /**
   * 敵人：可設定類型，各自 HP/速度/體型/顏色不同。
   * AI 改「蓄力攻擊」：追擊 → 進入攻擊距離蓄力(前搖) → 發動近身範圍攻擊 → 冷卻。
   * 已移除「接觸即扣血」。
   */
  enemy: {
    /** 追到多近就進入攻擊流程（進入蓄力的觸發距離，像素） */
    engageRange: 40,
    /** 被擊退後的硬直時間（毫秒）：期間不主動追不進攻 */
    knockbackStunMs: 500,
    /** 蓄力/前搖時間（毫秒）：改「由內而外填滿」讀條式預警，填滿瞬間發動 */
    chargeMs: 950,
    /** 發動攻擊時的近身傷害範圍（玩家在此半徑內才扣血，像素） */
    attackRadius: 46,
    /** 每次攻擊命中對玩家的傷害 */
    attackDamage: 12,
    /** 攻擊後冷卻（毫秒），冷卻結束才能再次蓄力*/
    attackCooldownMs: 2000,

    /**
     * 警戒 + 巡邏 AI（normal/tank 套用）。
     * 出生預設 patrol：出生點附近小範圍慢速漫步，不再一出生直衝玩家。
     * 角色進入 alertRadius → chase 追擊 + 蓄力攻擊；目標離開 loseRadius 或脫離
     * loseGraceMs 後 → 回 patrol。
     */
    ai: {
      /** 警戒範圍：角色進入此半徑才開始追擊 */
      alertRadius: 300,
      /** 脫離範圍：追擊目標超出此半徑（比 alertRadius 大）就準備回巡邏 */
      loseRadius: 560,
      /** 脫離持續多久（毫秒，目標一直在 loseRadius 外）才真的回巡邏 */
      loseGraceMs: 2000,
      /** 巡邏移動速度（比追擊 moveSpeed 慢） */
      patrolSpeed: 34,
      /** 巡邏漫步半徑：離出生點多遠內隨機遊走 */
      patrolRadius: 70,
      /** 巡邏每次改變目標點的間隔範圍（毫秒） */
      patrolRepathMinMs: 900,
      patrolRepathMaxMs: 2000,
      /**
       * 仇恨警戒上限:單一角色(seat)最多同時被幾隻【被動】怪盯上(進 chase)。
       * 被動=自己因 alertRadius 進範圍而追;主動=被玩家攻擊命中/鎖定過(aggroActive)→不計入、永遠可追。
       * 達上限時【新的被動怪不進 chase,維持 patrol】(不是把已追的退回)。每個 seat 各自算。
       * 守護波強制追 NPC 的怪(forceChase/事件怪)不計入、不受限。
       */
      aggroCapPassive: 15
    },


    /**
     * 各類型定義（含出現權重 spawnWeight，用於隊形內混編）。
     * spawnWeight 為「該怪種解鎖後」的加權；是否納入抽選依波次解鎖（見 unlockByWave / pickEnemyType）。
     */
    types: {
      /** 一般近戰蓄力小怪 */
      normal: {
        maxHp: 90,
        speed: 70,
        radius: 14,
        color: 0xff5a6e,
        stroke: 0x2a0a12,
        spawnWeight: 75
      },
      /** 肉盾：高 HP、慢速、體型較大 */
      tank: {
        maxHp: 200,
        speed: 40,
        radius: 22,
        color: 0x8b5cf6,
        stroke: 0x1a0a2e,
        spawnWeight: 12
      },
      /** 投射兵：保持距離、瞄準玩家位置蓄力投擲炸彈（落點有預警圈），本體脆 */
      bomber: {
        maxHp: 60,
        speed: 55,
        radius: 15,
        color: 0xe0b0ff,
        stroke: 0x2a1a3a,
        spawnWeight: 8
      },
      /** BOSS：實際 stats 來自 GameConfig.boss；此處僅為型別索引安全的佔位（不列 unlockByWave、spawnWeight 0 不會被抽到） */
      boss: {
        maxHp: 3000,
        speed: 46,
        radius: 42,
        color: 0xff3355,
        stroke: 0x3a0010,
        spawnWeight: 0
      },
      /** 塔/NPC：型別索引安全佔位（實際 stats 來自 GameConfig.event；spawnWeight 0、不列解鎖表，永不自然生成） */
      tower: {
        maxHp: 2000,
        speed: 0,
        radius: 34,
        color: 0xc0c0c0,
        stroke: 0x222222,
        spawnWeight: 0
      },
      npc: {
        maxHp: 500,
        speed: 0,
        radius: 26,
        color: 0x7bed9f,
        stroke: 0x0a3a1a,
        spawnWeight: 0
      },
      /** 寶箱怪：稀有趣味怪。spawnWeight 0（不走一般權重生成,由 treasure.spawnChance roll）。maxHp 大（改用命中次數死,非扣血）。 */
      treasure: {
        maxHp: 999999,
        speed: 0, // 移動由跑點 AI 控(treasure.moveSpeed),非一般追擊速度
        radius: 22,
        color: 0xffd23f,
        stroke: 0x8a6a00,
        spawnWeight: 0
      }
    },
    /** 寶箱怪行為參數 */
    treasure: {
      /** 每次波次生怪時 roll 出現的機率(0~1)——用戶降低(0.2→0.1,太頻繁) */
      spawnChance: 0.1,
      /** 需命中幾次才死(用戶「20下」) */
      hitsToKill: 20,
      /** 跑點:每次停頓時間(毫秒,隨機範圍)——用戶調長 3-5s 玩家更好追打 */
      pauseMinMs: 3000,
      pauseMaxMs: 5000,
      /** 跑點:快速衝到目標點的速度(px/s,明顯比一般怪快) */
      moveSpeed: 620,
      /** 出現後多久沒打死→跑走消失(毫秒)——用戶調長 18s 更多時間打 */
      lifetimeMs: 18000,
      /** 每被命中一下噴的金幣特效數(少量) */
      coinsPerHit: 4,
      /** 打死噴的大量金幣特效數(華麗) */
      coinsOnDeath: 40,
      /** 寶箱怪出現提示橫幅:文字 + 停留時間(毫秒)。 */
      bannerText: '💰 寶箱怪出現!擊破有獎勵!',
      bannerHoldMs: 1500
    },

    /**
     * 怪種改「依波次」解鎖（pickEnemyType 依 currentWave gating）。越後面波次怪種越多。
     */
    unlockByWave: {
      normal: 1,
      tank: 2,
      bomber: 5
    },

    /** 投射兵（bomber）行為參數（蓄力後投擲炸彈到玩家落點） */
    bomber: {
      /** 想與角色保持的距離（太近後退） */
      preferRange: 300,
      /** 小於此距離就後退 */
      retreatRange: 200,
      /** 進入此距離開始蓄力投擲 */
      throwRange: 480,
      /** 蓄力填滿時間（毫秒），期間鎖定落點=玩家當下位置 */
      bombChargeMs: 1200,
      /** 兩次投擲之間冷卻（毫秒） */
      bombCooldownMs: 2200,
      /** 炸彈飛行時間（毫秒，從投出到落地爆炸；期間落點顯示預警圈） */
      bombFlightMs: 650,
      /** 爆炸半徑（落點此半徑內存活角色受傷） */
      bombRadius: 90,
      /** 爆炸傷害 */
      bombDamage: 30
    }
  },

  /**
   * 關卡怪物配置（關卡制）：每個小關卡開始時依寶箱階級從 chests[tier].profiles 隨機抽一份配置，
   * 出怪改依配置進行（擊殺數、同時在場上限、各階段的怪種比例與補怪節奏）。
   * 資料格式即日後關卡編輯器編輯的內容；enabled = false 時回到舊的全域出怪參數
   */
  stageMonsters: {
    enabled: true,
    /** 每多一位存活玩家，場上組每批隻數增加的比例（近身組本來就是逐一輪派給每位玩家，不另外放大） */
    fieldBatchGrowthPerPlayer: 0.5,
    /**
     * 各寶箱階級：可抽的配置（等機率）與擊殺數倍率（高階沿用同三套、提高擊殺數）；
     * bossIntrude 限時亂入 BOSS：小關卡開始時以 chance 機率決定，擊殺進度到 atProgress 時登場（BOSS 本身沿用 stage.bossIntrude）
     */
    chests: {
      low: { profiles: ['swarm', 'armor', 'artillery'], quotaMult: 1, bossIntrude: { chance: 0, atProgress: 0.5 } },
      high: { profiles: ['swarm', 'armor', 'artillery'], quotaMult: 1.4, bossIntrude: { chance: 0.3, atProgress: 0.5 } }
    },
    /**
     * 配置：quota 擊殺數；maxAlive 同時在場上限（單人值，每多一人再加 perExtraPlayer）；
     * phases 依擊殺進度分段（untilProgress 前套用）：weights 怪種比例、intervalMs 補怪間隔、
     * nearBatch / fieldBatch 近身組 / 場上組每批隻數 [最少, 最多]、nearShare 近身組占比；
     * surge 二段變身即時補怪：在變身的玩家身旁環狀補 count 隻（依 weights 抽怪種），不計擊殺數、受同時在場上限保護，
     * 每位玩家各自冷卻 cooldownMs
     */
    profiles: {
      /** 蜂群：小怪一直湧上來，快節奏割草 */
      swarm: {
        name: '蜂群', quota: 25, maxAlive: { solo: 22, perExtraPlayer: 18 },
        surge: { count: [6, 10], weights: { normal: 90, tank: 10, bomber: 0 }, cooldownMs: 10000 },
        phases: [
          { untilProgress: 0.5, weights: { normal: 100, tank: 0, bomber: 0 }, intervalMs: 800, nearBatch: [2, 4], fieldBatch: [4, 7], nearShare: 0.6 },
          { untilProgress: 1, weights: { normal: 90, tank: 10, bomber: 0 }, intervalMs: 700, nearBatch: [3, 5], fieldBatch: [5, 8], nearShare: 0.6 }
        ]
      },
      /** 重甲：坦克當肉牆，怪少但硬，慢節奏 */
      armor: {
        name: '重甲', quota: 25, maxAlive: { solo: 22, perExtraPlayer: 18 },
        surge: { count: [6, 10], weights: { normal: 90, tank: 10, bomber: 0 }, cooldownMs: 10000 },
        phases: [
          { untilProgress: 0.4, weights: { normal: 80, tank: 20, bomber: 0 }, intervalMs: 1600, nearBatch: [3, 5], fieldBatch: [6, 9], nearShare: 0.4 },
          { untilProgress: 1, weights: { normal: 55, tank: 45, bomber: 0 }, intervalMs: 1500, nearBatch: [3, 5], fieldBatch: [6, 10], nearShare: 0.4 }
        ]
      },
      /** 砲火：投擲怪在遠處轟炸（只出在場上組），要衝過去清 */
      artillery: {
        name: '砲火', quota: 25, maxAlive: { solo: 22, perExtraPlayer: 18 },
        surge: { count: [6, 10], weights: { normal: 90, tank: 10, bomber: 0 }, cooldownMs: 10000 },
        phases: [
          { untilProgress: 0.3, weights: { normal: 85, tank: 0, bomber: 15 }, intervalMs: 1100, nearBatch: [2, 4], fieldBatch: [5, 8], nearShare: 0.4 },
          { untilProgress: 1, weights: { normal: 70, tank: 5, bomber: 25 }, intervalMs: 1000, nearBatch: [2, 4], fieldBatch: [5, 9], nearShare: 0.35 }
        ]
      }
    }
  },

  /**
   * 生成 / 難度曲線（持續制 B2）：
   * 不分明確波次，持續地成群丟隊形進來；只要場上未達上限就繼續補。
   * 隊形直接在競技場「內部」生成，並先播登場提示（telegraph）。
   * 隊形內混入少量肉盾（tankRatio）。
   */
  spawn: {
    /** 初始「每組隊形」的生成間隔（毫秒） */
    initialIntervalMs: 1700,
    /** 生成間隔最小值（越小越密） */
    minIntervalMs: 650,
    /** 每秒縮短生成間隔的量（毫秒/秒），保留難度曲線 */
    intervalDecayPerSec: 16,
    /** 場上敵人數量上限 */
    maxAlive: 416,
    /** 單人存活（僅剩 1 名角色）時的場上敵人硬上限 */
    soloMaxAliveCap: 35,
    /**
     * 物件池預熱：開局與每次 BOT 加入時，先把敵人物件池補到「目前人數的場上上限 + poolPrewarmBuffer」，
     * 第一次大量出怪不必當場建立物件（機台效能較弱時避免出怪瞬間卡頓）；BOSS 召喚、事件怪用緩衝
     */
    poolPrewarmBuffer: 20,
    /** 開場立即先丟一組隊形（不必等第一個間隔） */
    spawnOnStart: true,
    /** 登場提示時間（毫秒）：這段期間敵人半透明閃爍，不能傷害玩家、也不能被打 */
    spawnTelegraphMs: 420,
    /** 場內生成時與角色的安全距離（避免生在玩家貼臉） */
    safeDistanceFromPlayer: 130,
    /** 生成點距場地邊界的內縮（確保在場內）；v37fix(C)：24→90 讓怪出生離牆更遠、偏場內 */
    edgeInset: 90,
    /**
     * 怪量隨場上「存活角色數」縮放。effectiveScale = base + (aliveCount-1)*perAlive，夾在 [base,1]。
     * 1 人 = 0.4（現況 40%）、每多 1 人 +0.2、湊滿 4 人 = 1.0（現況量）。
     * 此縮放乘在 maxAlive 與每波生成量上。
     */
    aliveScale: {
      base: 0.4,
      perAlive: 0.2
    }
    /** 敵人類型依各 type 的 spawnWeight 權重混編（見 enemy.types） */
  },

  /**
   * 階段2b 生怪分配制(decision 71437147):每次補生分【近身組+場上組】。
   * 近身組綁旁邊玩家、生玩家旁環形、近戰為主;場上組散佈、含遠程。比例收斂 nearShare。
   */
  spawnAlloc: {
    /** 近身組佔比(其餘為場上組)。0.4=四成近身、六成場上。 */
    nearShare: 0.4,
    /** 近身組每個玩家一批的隻數(隨機 min~max)。 */
    nearPerPlayerMin: 3,
    nearPerPlayerMax: 5,
    /** 近身組生在玩家旁的環形半徑(像素,留空間不貼臉)。 */
    nearRingRadius: 180,
    /** 近身組敵種池(近戰為主) */
    nearTypes: ['normal', 'tank'] as string[],
    /** 場上組敵種池(含遠程);空陣列=用全池(pickEnemyType 預設)。 */
    fieldTypes: [] as string[],
    /** 階段3:場上組出生點離【所有玩家】的最小距離(像素)。加大→場上組生更遠、不一出生就在旁。現值 300（原 420）。 */
    fieldMinDistFromPlayer: 300,
    /**
     * 場上組只在目前鏡頭畫面內出生（畫面邊緣再內縮 fieldViewInset px），場地比畫面寬時兩側不會出現看不到的怪。
     * 仍維持離所有玩家至少 fieldMinDistFromPlayer；畫面內可用範圍太小時退回整個移動區
     */
    fieldSpawnInView: true,
    fieldViewInset: 80,
    /**
     * leash 拴繩(難度微調):場上組怪離【出生點】超過此距離就放棄追、回走。起手 650。
     * 效果:玩家能拉一小群但拉不動整片場(想清遠處怪要自己走過去)。近身組不套用(貼玩家)。
     */
    fieldLeashRadius: 200,
    /** 近身組 leash 半徑(設大值≈不套用,近身組本意貼玩家)。 */
    nearLeashRadius: 100000,
    /**
     * leash 第二條(累積移動路程):場上組怪【本次追擊累積跑的路程】超過此值就放棄回家(繞圈拉也拉不動)。
     * 與直線 fieldLeashRadius 並存,任一觸發就脫繩。(用戶覺太鬆再收緊 500→360)
     */
    fieldLeashTravelDist: 260,
    /** 近身組路程 leash(大值≈不套用)。 */
    nearLeashTravelDist: 1000000
  },

  /**
   * 波次制：每波要清掉固定數量的怪才過關，越後面波次量越多、怪種越多。
   */
  wave: {
    /** 第 1 關怪數 */
    baseQuota: 10,
    /** 每往後一波 quota 增量（10關內遞增） */
    quotaGrowth: 8,
    /** quota 上限*/
    quotaCap: 90,
    /** 過關後停歇時間（毫秒，顯示 Wave Clear / 下一波提示） */
    intermissionMs: 2500,
    /** 10 關循環，第 10 關為 BOSS 關（wave%10===0） */
    wavesPerCycle: 10,
    /** 事件關（第 3/5/7 關；第 10 關固定 BOSS，不與事件衝突） */
    eventWaves: [3, 5, 7],
    /** BOSS 前高潮關（第 8/9 關）——普通波但怪量加成 */
    preBossWaves: [8, 9],
    /** preBoss 關的 quota 加成係數 */
    preBossQuotaMult: 1.5,
    /** 每幾波為 BOSS 波 */
    bossEveryWaves: 10,
    /** 保留欄位 */
    eventEveryWaves: 3,

    /**
     * 階段2a 波次進度制 + drip 持續補生。waveQuota→targetProgress(每波目標,殺一隻+1);
     * drip:活怪跌破 spawnThresholdRatio×maxAlive → 開始補生(latch refilling),補到 maxAlive 才關(防抖)。
     * 聰明停生:生產總量(progress+alive+pending)封頂 targetProgress,絕不超生。maxAlive 用 curMaxAlive()。
     */
    drip: {
      /** 活怪佔 maxAlive 的比例跌破此值→開始補生(latch 開)。起手 0.6(六成)。config 可調。 */
      spawnThresholdRatio: 0.6,
      /** 階段2b 初期量:前幾波視為「早期」,target 墊高讓 drip 補滿。起手 3 波。 */
      earlyWaves: 3,
      /** 早期波 targetProgress 下限 = initialFillMult×maxAlive(讓 drip 補到接近/超過滿場→初期飽滿)。起手 1.2。 */
      initialFillMult: 1.2
    }
  },

  /**
   * 關卡系統（第一階段骨架）：關卡 1~4，每關分 A/B 兩子區(橫向並排大場地)。
   * N-A 打 wavesA 波→左右箭頭選邊→鏡頭平移到 N-B→N-B 打 wavesB 波→上/下出口→閃黑→(N+1)-A。
   * 第一階段:A/B 都純波次(不接事件/BOSS);選邊(L/R)影響 B 的靜態物件配置。
   */
  stage: {
    /** 是否啟用關卡制(關掉=回退舊無限波次) */
    enabled: true,
    /** 場景配色的關卡數（scene.levels 1~4，除錯熱鍵 [ ] 預覽範圍）；與小關卡寶箱佇列無關 */
    totalLevels: 4,
    /**
     * 小關卡寶箱佇列（無限延續，見 systems/stageQueue.ts）：新節點依此機率抽高階 / 問號，其餘為低階；
     * 任意連續 waveHud.visibleStages 個節點保證至少 1 個確定高階與 1 個問號（不足時強制補，高階優先），問號不連續
     */
    chestOdds: { high: 0.2, mystery: 0.3 },
    /** 問號寶箱在玩家進入該關時揭曉為高階的機率（其餘為低階） */
    mysteryHighChance: 0.4,
    /** 各寶箱階級的關卡擊殺數（問號依揭曉結果） */
    quotaByChest: { low: 25, high: 35 },
    /**
     * 出口開啟時的 GO 指示：發光的「GO」字（fontSize / color、光暈 glowColor / glowBlur）加上同色調的方向箭頭
     * （純三角形，半邊長 arrowSize、與字間隔 arrowGap；光暈 arrowGlowSpread 分 arrowGlowLayers 層，總透明度 arrowGlowAlpha），
     * 整組閃動（週期 blinkMs、最暗透明度 blinkMinAlpha、脈動放大 pulseScale）：
     * - 出口完整在畫面內 → GO 在出口標記上方，與標記間隔 gapFromTarget
     * - 出口在畫面外 → GO 貼畫面邊緣：距左右邊 edgeInset，垂直範圍在畫面頂 edgeMinY（上方 HUD 之下）
     *   與畫面底 edgeBottomMargin（下方面板之上）之間；上方出口的 GO 在 edgeMinY
     * - 出口超出畫面 hysteresisPx 以上才切回邊緣（避免在畫面邊緣來回跳）；位置以約 followMs 平滑跟上
     */
    goIndicator: {
      fontSize: '64px', color: '#fff59d', strokeColor: '#b26a00', strokeThickness: 4,
      glowColor: '#ffd54f', glowBlur: 22, depth: 55,
      arrowSize: 22, arrowGap: 10, arrowColor: 0xfff59d, arrowGlowColor: 0xffd54f,
      arrowGlowSpread: 14, arrowGlowLayers: 5, arrowGlowAlpha: 0.55,
      gapFromTarget: 12, blinkMs: 420, blinkMinAlpha: 0.4, pulseScale: 1.12,
      edgeInset: 30, edgeMinY: 150, edgeBottomMargin: 180, hysteresisPx: 40, followMs: 120
    },
    /**
     * 清場輔助：清場階段（本波已生滿、等清完）時，畫面外還活著的一般怪以畫面邊緣的箭頭指示方向。
     * 依畫面中心往外分成 sectors 個方向，每個方向一支箭頭（大小、光暈同 GO 指示）指向該方向最近的怪，
     * 箭頭內側放那隻怪的圖示（邊長 iconSize，與箭頭間隔 iconGap）。箭頭貼邊範圍與 GO 指示相同（避開上方 HUD / 下方面板）
     */
    offscreenIndicator: {
      sectors: 8, depth: 54,
      arrowSize: 22, arrowColor: 0xff8a65, arrowGlowColor: 0xff3d3d, arrowGlowSpread: 14, arrowGlowLayers: 5, arrowGlowAlpha: 0.55,
      iconSize: 56, iconGap: 6,
      edgeInset: 30, edgeMinY: 150, edgeBottomMargin: 180,
      /** 怪的身體超出畫面多少才算「在畫面外」（px） */
      viewMargin: 8,
      blinkMs: 480, blinkMinAlpha: 0.45, followMs: 120
    },
    /**
     * 隱藏入口（熔岩拱門）：每區開打時 spawnChance 機率出現在上方邊界（距左右邊 edgeMargin、避開中央上方出口
     * centerExclusion），拱門底部在場地上緣往內 topInset，顯示高度 displayHeight；未開啟時灰暗（closedTint / closedAlpha），
     * 開啟後洞口中央（自底部算起 glowCenterRatio 高度、半徑約寬度 × doorwayRadiusRatio）出現熔岩光暈，脈動週期 glowPulseMs。
     * openChance：問號關前出口組合含「上」且這一區有拱門時，改開拱門取代上方出口的機率。目前為測試期數值
     */
    hiddenGate: {
      spawnChance: 0.7, openChance: 0.5,
      displayHeight: 230, topInset: 40, edgeMargin: 220, centerExclusion: 280, depth: 3,
      closedTint: 0x6b6b6b, closedAlpha: 0.9, openFlickerAlpha: 0.8,
      glowColor: 0xff7a1a, glowRadius: 120, glowCenterRatio: 0.4, doorwayRadiusRatio: 0.3, glowPulseMs: 600,
      glowMinAlpha: 0.35, glowMaxAlpha: 0.85, glowPulseScale: 1.15
    },
    /**
     * 獎勵關（寶藏密室）：限時 durationMs，剩 finalCountdownSec 秒時畫面中央大倒數；倒數 HUD 在畫面上方 hudY。
     * 場地覆蓋金色色調（tintColor / tintAlpha），散布 decorCount 組金幣堆 / 寶石 / 寶箱（距邊 decorMargin、
     * 彼此間隔 decorSpacing、避開下緣入口半徑 entryClearRadius）。
     * 寶箱怪：進場 firstSpawnDelayMs 後開始，每 spawnIntervalMs 從裝飾處跳出一隻（噴 spawnCoinBurst 枚金幣），
     * 場上最多 maxAlive 隻；打 hitsToKill 下死，每次命中給命中者 ticketsPerHit 張彩票、擊殺再給 ticketsOnKill 張；
     * 時間到全部離場
     */
    treasureRoom: {
      durationMs: 60000, finalCountdownSec: 5, hudY: 104, hudLabel: '💰 寶藏密室',
      firstSpawnDelayMs: 1500, spawnIntervalMs: 4000, maxAlive: 3, spawnCoinBurst: 16,
      hitsToKill: 10, ticketsPerHit: 1, ticketsOnKill: 30,
      enterBanner: '寶藏密室！限時 60 秒', endBanner: '時間到！',
      tintColor: 0xffc84a, tintAlpha: 0.18, tintDepth: 0.6, decorDepth: 0.8,
      decorCount: 10, decorMargin: 80, decorSpacing: 160, entryClearRadius: 260
    },
    /**
     * 出口標記：實心發光圓（核心半徑 radius、外圍光暈 glowRadius 分 glowLayers 層，總透明度 glowAlpha），
     * 在場地邊緣往內 arrowInset 處（左右出口在左右緣中段、上方出口在上緣中央），走到這裡觸發轉場；開放期間呼吸閃爍
     */
    exitOrb: { radius: 26, color: 0x7affc0, coreColor: 0xeafff5, glowRadius: 34, glowLayers: 6, glowAlpha: 0.6 },
    /** 問號關前的出口組合（隨機挑一組；L 左、R 右、U 上方）；含回頭方向（與 dirLock 相反）的組合會被排除 */
    mysteryExitCombos: [['L', 'R'], ['L', 'U'], ['R', 'U']] as ReadonlyArray<ReadonlyArray<'L' | 'R' | 'U'>>,
    /** 寶箱獎勵：完成小關卡直接發給每位存活玩家的彩票張數 */
    chestTickets: { low: 5, high: 30 },
    /**
     * BOSS 限時亂入：問號揭曉為高階時以 chance 機率登場（揭曉橫幅後 entryDelayMs；啟用 stageMonsters 時改由其 chests.bossIntrude 決定）；
     * 不擋通關（不計擊殺數），
     * durationMs 內沒打倒就淡出離場（leaveFadeMs），換區時也一併離場；
     * 每次命中有 hitTicketChance 機率掉 hitTickets 張彩票給命中的角色
     */
    bossIntrude: { chance: 0.3, entryDelayMs: 1700, durationMs: 60000, hp: 1000, hitTicketChance: 0.3, hitTickets: 1, leaveFadeMs: 500 },
    /** 無限關卡固定使用的場景配色（scene.levels 的 key；火山荒城主題） */
    sceneLevel: 1,
    /**
     * 移動區(arena)尺寸:左右貼齊 slot(=F4 背景圖寬),上下扣掉背景圖的熔岩斷崖/岩石禁區。
     * slot = (arenaW + 2×sceneMarginX) × (arenaH + sceneMarginTop + sceneMarginBottom) = 2520×1680,
     * 比畫面(1920×1080)大,鏡頭跟隨玩家在 slot 內捲動。
     */
    arenaW: 2520,
    arenaH: 840,
    /** 移動區左右兩側的不可踏入邊距(世界像素);0 = 左右貼齊 slot 邊緣 */
    sceneMarginX: 0,
    /** 移動區上方的不可踏入邊距(世界像素):背景圖上方熔岩斷崖帶 */
    sceneMarginTop: 504,
    /** 移動區下方的不可踏入邊距(世界像素):背景圖下方岩石帶 */
    sceneMarginBottom: 336,
    /** 鏡頭跟隨的 deadzone(緩衝區)寬高——玩家在此框內鏡頭不動,超出才跟(約畫面 1/6,讓鏡頭隨移動即時捲動)。 */
    followDeadzoneW: 320,
    followDeadzoneH: 180,
    /**
     * 多人時（存活 2 人以上）角色不可走出畫面：限制在目前鏡頭畫面內縮此距離（px）的範圍。
     * 畫面那一側已貼到鏡頭邊界（場地邊緣）時不內縮，由場地邊界擋。出口開放 / 轉場中不限制（要能走到出口）
     */
    viewClampInset: 60,
    /** 鏡頭跟隨的 lerp 平滑係數(0~1,越小越平滑) */
    followLerp: 0.08,
    /** 📹 Y軸跟隨係數：比X軸更慢，讓上下跟隨更溫和 - 用戶要求 */
    followLerpY: 0.04, // 比followLerp(0.08)慢一半
    /** 每關 A 子區波數 */
    wavesA: 2,
    /** 每關 B 子區波數(純波次時;隨機 1~2 波) */
    wavesB: 2,
    /** B 子區進場隨機:抽到【限時事件】的機率(其餘=純波次);其餘 1-bEventChance=純波次 */
    bEventChance: 0.5,
    /** B 純波次時的波數範圍(隨機 min~max,比 A 少) */
    wavesBMin: 1,
    wavesBMax: 2,
    /** B 事件池(隨機抽一個);接現有 event.tower/guard/capture */
    bEventPool: ['tower', 'guard', 'capture'],
    /**
     * 子區(單一畫面大小)= arena 矩形(沿用 arena.padding)。
     * A/B 並排:世界寬 = 畫面寬 × 2 + gap;A 在左半、B 在右半。
     */
    /** A、B 兩子區之間的水平間隔(世界座標,畫面外看不到的緩衝) */
    subGap: 200,
    /** 鏡頭平移到 B 的時間(毫秒) */
    panMs: 900,
    /** 閃黑轉場淡出/淡入時間(毫秒) */
    fadeMs: 500,
    /** 出口標記距場地邊緣的內縮（左右出口距左右緣、上方出口距上緣） */
    arrowInset: 70,
    /** 玩家走到箭頭/出口的觸發距離 */
    triggerDist: 46,
    /** 階段2:crossing 開放後短暫緩衝(毫秒)內不觸發邊界過場——讓玩家看引導箭頭、不貼邊秒觸發。 */
    crossGraceMs: 700,
    /**
     * 每區【隨機布置】可破壞物件:每次進子區隨機數量+位置。
     * 保留選邊 L/R 基調:R 側多桶(barrelBias),L 側多木箱。避開中心(出入/事件目標)與邊緣。
     */
    breakablesRandom: {
      crateMin: 6, crateMax: 11,     // 木箱數量範圍（每區數量明顯不同）
      barrelMin: 1, barrelMax: 3,    // 炸彈桶數量範圍
      barrelBiasExtra: 1,            // R 側額外桶上限(基調:某側多桶)
      /** 隨機分布區域(相對子區比例):避開最外圈與正中心。範圍拉大→位置更分散、不顯固定。 */
      marginX: 0.1, marginY: 0.12,   // 距邊緣內縮比例(縮小→可用範圍變大)
      centerAvoidR: 0.14,            // 避開中心的半徑(相對 min(寬,高))
      minSpacingR: 0.06              // 物件之間最小間距(相對 min(寬,高)),避免重疊(縮小→可放更密更多)
    }
  },

  /**
   * 第二階段:場景視覺(程式繪製)。統一基調=黃土荒城+熔岩火山。
   * 4 關【移動區地貌】各異;A/B【遠景】不同(A 荒城天際線 / B 火山噴發)。
   * 先實作關卡1;關2/3/4 palette 先放好、方向確認後再啟用繪製細節。
   */
  scene: {
    /** 餘燼粒子數量(適量,別拖累效能);0=關 */
    emberCount: 14,
    /** 各關移動區地貌 + 基礎配色 */
    levels: {
      1: {
        name: '龜裂黃土地',
        groundBase: 0x8a6d3f,    // 土黃
        groundDark: 0x6f5630,    // 裂縫暗色
        groundLight: 0xa88951,   // 亮土(碎石反光)
        crackColor: 0x4a3820,    // 龜裂縫線
        pebble: 0x9c8659,        // 碎石
        glow: 0,                 // 關1 無熔岩發光
        skyTop: 0x3a2c22,        // 天空(荒城基調:焦土黃褐)
        skyBottom: 0x6b4a2e
      },
      2: {
        name: '熔岩裂縫',
        groundBase: 0x7a5a34, groundDark: 0x5a3f22, groundLight: 0x8a6a3a,
        crackColor: 0xff6a1a, pebble: 0x8a6a3a, glow: 0xff7a1a,
        skyTop: 0x3a221a, skyBottom: 0x6b3520
      },
      3: {
        name: '焦黑廢墟',
        groundBase: 0x2e2823, groundDark: 0x1a1612, groundLight: 0x3e352c,
        crackColor: 0x111015, pebble: 0x4a4038, glow: 0,
        skyTop: 0x241a16, skyBottom: 0x3a2620
      },
      4: {
        name: '火山岩盤',
        groundBase: 0x27201f, groundDark: 0x161011, groundLight: 0x352826,
        crackColor: 0xff4a12, pebble: 0x40302c, glow: 0xff5a1a,
        skyTop: 0x2a1512, skyBottom: 0x5a1e12
      }
    },
    /** 遠景(A/B 共通調色,實際剪影/噴發由繪製函式畫) */
    farA: { label: '荒城天際線', wall: 0x4a3826, tower: 0x3a2c1e, hazeTop: 0x5a4230 },
    farB: { label: '火山噴發', skyRed: 0x8a2a14, smoke: 0x3a2822, lava: 0xff5a1a, glowSky: 0xc23a10 } },

  /** 波次 BOSS 設定 */
  boss: {
    /** 基礎 HP（會隨「第幾隻 BOSS」成長）*/
    baseHp: 8000,
    /** 每多一隻 BOSS（每個 BOSS 波）HP 成長倍率累加 */
    hpGrowthPerBoss: 0.6,
    /** 體型半徑（大） */
    radius: 42,
    /** 移動速度（慢）：追目標角色，蓄力 / 施放期間不動 */
    speed: 46,
    /** 離目標多近就停下不再靠近（像素） */
    chaseStopDist: 140,
    color: 0xff3355,
    stroke: 0x3a0010,
    /** 擊殺掉落道具數 */
    dropCount: 4,
    /** BOSS 掉落道具距 BOSS 中心的距離（拉遠，避免掉腳邊被身體擋住撿不到）；原40→170 */
    dropDist: 170,
    /** BOSS 招命中角色的定身時長（毫秒；禁移動+禁攻擊） */
    skillRootMs: 2000,
    /** 打 BOSS 過程噴道具——每累積受到此傷害量，在 BOSS 附近掉 1 個道具 */
    dropEveryDamage: 600,
    /** 噴道具離 BOSS 中心的散布半徑 */
    dropScatter: 90,
    /**
     * BOSS 三招輪替（a → b → c → a…）：每招蓄力 chargeMs（填滿式預警），放完隔 gapMs 才蓄下一招；
     * 傷害走 damageCharacterFrom（無敵擋傷），命中定身 skillRootMs
     */
    skills: {
      gapMs: 1500,
      chargeMs: 2000,
      /** a 範圍普攻：以 BOSS 為中心的圓形 */
      a: { radius: 220, damage: 30 },
      /** b 直線衝刺：朝目標方向衝 length（終點夾在場內），寬 width 的直線帶內受傷；衝刺耗時 dashMs */
      b: { length: 520, width: 120, dashMs: 280, damage: 30 },
      /** c 扇形攻擊：朝目標方向 arcDeg 度、半徑 range 的扇形 */
      c: { range: 380, arcDeg: 90, damage: 30 }
    },
    /**
     * 變身 BOSS（只限慢速模式 P1）：亂入 BOSS 被打倒後留屍體 corpseMs，P1 走到 reachDist 內按 Z 變身 durationMs（期間無敵）。
     * 攻擊鍵立即出招（冷卻 attackCooldownMs）：平常是以自己為中心的範圍普攻 normal，
     * 普攻命中 fanEvery 次後下一擊自動變成朝面向的扇形攻擊 fan
     */
    transform: {
      corpseMs: 10000,
      reachDist: 160,
      corpseTint: 0x777777,
      corpseAlpha: 0.75,
      durationMs: 10000,
      attackCooldownMs: 450,
      fanEvery: 4,
      knockback: 260,
      normal: { radius: 220, damage: 60 },
      fan: { range: 380, arcDeg: 90, damage: 150 }
    },
    /** BOSS 提示（取代血條）：畫面上方中央的大字；亂入 BOSS 顯示離場倒數，剩 urgentSec 秒內改色並脈動 */
    hud: { y: 104, fontSize: '40px', color: '#ffd166', urgentColor: '#ff4d6d', urgentSec: 10, pulseScale: 1.15, pulseMs: 250 }
  },

  /** 三種事件（塔/守護/佔領）：非 BOSS 的事件波觸發，完成給獎勵 */
  event: {
    /**
     * 人數動態難度調整系統
     * 進入事件場景後，根據進入人數確定難度，中途有人離開或加入不動態調整
     */
    dynamicDifficulty: {
      /** 人數係數規則：線性調整 */
      playerCountMultipliers: {
        1: 1.0,    // 單人基準
        2: 1.5,    // 2人=1.5倍
        3: 2.0,    // 3人=2倍
        4: 2.5     // 4人=2.5倍
      } as Record<number, number>
    },
    /** 完成獎勵：掉道具數 */
    rewards: { dropCount: 4 },
    /** 事件波開場宣告序列(階段1:雙段大字+右滑出+時序gate+鎖操作;階段2再加真pan/壓黑聚焦)。 */
    intro: {
      /** 第一段統一大字文字 */
      unifiedText: '限時事件來了!',
      /** 第一段大字顯示秒數(顯示滿此秒→向右滑出) */
      unifiedHoldSec: 3.5,
      /** 第二段各事件訊息(per-eventKind);聚焦定格時顯示,結束向右滑出 */
      perEventText: { tower: '摧毀敵方尖塔', guard: '守護我方目標', capture: '守住據點' } as Record<string, string>,
      /** 第二段訊息/聚焦定格顯示秒數(階段1用計時 stub 佔位;階段2=真聚焦定格秒數) */
      focusHoldSec: 3.5,
      /** 大字淡入秒數 / 向右滑出秒數 / 右滑位移(px) */
      fadeInSec: 0.35, slideOutSec: 0.4, slideOutDistPx: 700,
      /** 逾時保底:整段開場最長秒數,超過強制結束解鎖(防鎖操作卡死) */
      maxIntroSec: 12,
      /** 階段2:第二段聚焦時 camera pan 到目標置中的時間(毫秒)/緩動 */
      panMs: 420,
      /** 壓黑遮罩 alpha(0~1,越大越黑)/淡入淡出秒數 */
      dimAlpha: 0.82, dimFadeSec: 0.35,
      /** 目標亮圈(暖光暈,ADD)半徑(px)/顏色/alpha——凸顯被聚焦目標 */
      spotlightRadiusPx: 150, spotlightColor: 0xfff2b0, spotlightAlpha: 0.55,
      /** 佔領事件:聚光圈半徑改依據點圈(capture.captureRadius)×此倍率(略大包住據點);塔/守護維持 spotlightRadiusPx */
      captureSpotlightMult: 1.1,
      /** 佔領聚光圈很大(≈374)→用較低 alpha,避免大範圍 ADD 暖光把壓黑洗掉(塔/守護小圈維持 spotlightAlpha) */
      captureSpotlightAlpha: 0.2,
      /** 聚焦時把目標物提升到的 depth(高於壓黑遮罩 depth,露出目標);遮罩用此-2、亮暈用此-1 */
      focusTargetDepth: 972,
      /** 階段3:角色自動走位到目標周圍——走位速度(px/s,同 updateLevelEnter)/環繞半徑(px)/逾時保底秒數 */
      walkSpeed: 520, walkRingPx: 90, maxWalkSec: 3.5
    },
    /** 塔事件：改「一次發四大扇形、正十字↔斜十字交替」；打掉塔完成 */
    tower: {
      /** 調整血量：單人時約50下打完（玩家攻擊力36×50=1800，設定為1800基礎） */
      baseHp: 1800,
      hpGrowthPerWave: 0.12,
      radius: 34,
      color: 0xc0c0c0,
      stroke: 0x222222,
      /** 用戶指定:塔事件【限制時間】(毫秒,可調)。限時內打掉塔=完成給獎勵;時間到沒打掉=失敗(比照其他事件結束→進下一波、不給獎勵)。 */
      timeLimitMs: 40000,
      /** 四大扇形攻擊 */
      fanBlast: {
        /** 同時發幾個扇形（4：正十字或斜十字） */
        count: 4,
        /** 每個扇形張角（度）*/
        arcDeg: 48,
        /** 扇形半徑（從塔中心往外，涵蓋大部分場地） */
        radius: 520,
        /** 每組發射前填滿式預警時長（毫秒） */
        fillMs: 2000,
        /** 每次命中傷害 */
        damage: 24,
        /** 命中定身時長（毫秒） */
        rootMs: 2000,
        /** 一組（4扇形）發射→下一組的間隔（毫秒） */
        cycleMs: 3200
      },
      /** 塔事件期間持續出怪間隔（毫秒，無視波次配額，直到塔被打掉）*/
      spawnIntervalMs: 800,
      /** 塔事件每次生怪數量（加壓） */
      spawnBatch: 2
    },
    /** 守護事件：撐時間保護中央 NPC */
    guard: {
      /** 守護目標 NPC 血量;用戶再下調 1600→1000(可調) */
      npcHp: 1000,
      radius: 26,
      color: 0x7bed9f,
      stroke: 0x0a3a1a,
      /** 守護改【純時間間隔+循環】:durationMs 成為【唯一成功時限】——撐滿即守護成功(NPC 未死)。用戶:90s→60s。 */
      durationMs: 60000,
      /** 事件期間持續出怪的間隔（毫秒，加強壓力：900→550），無視波次配額直到時間結束 */
      spawnIntervalMs: 550,
      /** 每次生怪數量（多出點一般怪） */
      spawnBatch: 2,
      /** 敵人接觸 NPC 的扣血（每次攻擊判定） */
      npcContactDamage: 10,
      /** NPC 接觸判定半徑額外量 */
      contactRange: 30,
      /** v37fix(A)：每隻怪對 NPC 的接觸攻擊冷卻（毫秒）——不再每幀扣血，避免一群怪貼上瞬秒 */
      npcAttackCooldownMs: 1000,
      /**
       * 守護 3 波腳本(取代持續隨機生怪):依序 3 波循環,每波【左右兩側】各生指定怪種數量;
       * 上一波清空或過了 waveSpawnIntervalMs 就出下一波,撐過 durationMs = 守護成功。
       * 守護波怪【免疫 leash】(一直衝 NPC)。全 config 可調。
       */
      waves: [
        // 波1:左右各大量一般怪
        [{ type: 'normal', perSide: 8 }],
        // 波2:兩側肉怪
        [{ type: 'tank', perSide: 4 }],
        // 波3:前兩者混合
        [{ type: 'normal', perSide: 3 }, { type: 'tank', perSide: 2 }]
      ] as Array<Array<{ type: string; perSide: number }>>,
      /** 左右兩側生成的 x 內縮(離場邊界);左批 x=left+sideMargin、右批 x=right-sideMargin。 */
      sideMargin: 90,
      /** 每波防卡波超時(毫秒):純時間間隔制下已停用(改用 waveSpawnIntervalMs)。 */
      waveTimeoutMs: 12000,
      /** 純時間間隔制:每過此毫秒數就生下一波(不管上波清掉沒),3 波循環重複。 */
      waveSpawnIntervalMs: 8000,
      /** 清波推進門檻(混合制:清空 OR 8秒較早):countGuardWaveAlive()==0 即出下一波。保留備用。 */
      guardWaveClearThreshold: 2,
      /** 守護怪物遞增：每循環一輪(3 波跑完)每種怪每側 +1 */
      waveCountStep: 1,
      /** 每輪的波數（= waves 長度），跑完一輪才遞增 */
      wavesPerCycle: 3,
      waveCountCap: 12
    },
    /** 佔領事件：改「圈內一波波出怪、殺完出下波、圈內有怪進度停、無怪且玩家在圈內才增」 */
    capture: {
      /** 佔領圈半徑*/
      captureRadius: 340,
      /** 圈內【無怪且玩家在圈內】時每秒進度（100 為滿） */
      progressPerSec: 12,
      /** 每波在圈內生幾隻怪（這波全清才出下一波） */
      waveSize: 5,
      /** 清完一波到下一波的間隔（毫秒）*/
      waveGapMs: 1800,
      /** 怪生成點在佔領圈內的半徑比例（0~1，×captureRadius；離圈心多遠內隨機生） */
      spawnInsideRatio: 0.85,
      /** 時間限制（毫秒）——時間內進度達100=成功；時限到未滿=失敗(過關無獎勵) */
      timeLimitMs: 45000
    }
  },

  /** 隊形設定 */
  formation: {
    /** 隨機散點：一個區域內隨機灑一叢 */
    scatter: {
      minCount: 6,
      maxCount: 12,
      /** 散佈區域半徑 */
      areaRadius: 200
    }
  },

  /**
   * 滑鼠瞄準衝刺：
   * 方向圓環箭頭恆指向游標；按攻擊朝箭頭方向衝一段距離，遇到第一個敵人就停下攻擊。
   */
  aim: {
    /**
     * 瞄準模式開關。false = 融合模式（本次預設）：滑鼠方向錐形(±aimConeDeg,searchRadius)內有怪→自動鎖定朝那隻打(黏敵、滑鼠可切目標)；錐形內無怪(滑鼠指空地)→朝該空方向自由衝刺位移(走位不被拉回)。
     * true = 舊純自動鎖定黏著（一定鎖 searchRadius 內最近怪、方向被綁、無法朝空地走位）。
     */
    autoLock: false,
    /** 融合模式下「滑鼠方向錐形」半角（度）——此錐形內才鎖怪，錐外/無怪則朝空地走位 */
    aimConeDeg: 35,
    /** 道具鎖定優惠係數——道具在錐形內時，其「有效角度差」= 實際角度差 × 此值(0.7)，
     *      比敵人略優先(玩家特地撇準心去撿)；敵人明顯更接近準心時仍鎖敵人。 */
    itemAimPriorityMult: 0.7,
    /** 方向圓環半徑（繞角色一圈的環，離角色多遠） */
    ringRadius: 52,
    /** 圓環線寬 */
    ringThickness: 3,
    /** 圓環顏色 */
    ringColor: 0x8be9fd,
    /** 圓環透明度 */
    ringAlpha: 0.7,
    /** 方向衝刺的最大距離（像素，路徑無敵人時衝完此距離停下） */
    dashDistance: 320,
    /** 衝刺途中判定「撞到敵人」的半徑（碰到就停在其旁攻擊） */
    dashHitRadius: 32,
    /** 衝刺距離指示線 */
    indicator: {
      color: 0x8be9fd,
      alpha: 0.35,
      thickness: 4,
      /** 終點標記圓半徑 */
      endMarkerRadius: 8
    }
  },

  /**
   * 自動鎖定：方向永遠由「鎖定目標」決定，滑鼠只負責「選鎖哪隻」。
   * 滑鼠近期有移動 → 鎖箭頭方向附近最合適的敵人；滑鼠靜止 → 鎖最近敵人。
   */
  lock: {
    /** 滑鼠停止多久內視為「活躍」（毫秒），活躍時依箭頭方向選目標 */
    aimActiveWindowMs: 700,
    /** 選目標的搜尋半徑（超出不考慮） */
    searchRadius: 560,
    /** 箭頭方向選目標時的評分：角度權重（越大越偏向「正對箭頭」而非「最近」） */
    angleWeight: 220,
    /**
     * 黏著切換門檻（度）：鎖定會「黏」在同一敵人直到牠死亡/消失/離開搜尋半徑；
     * 只有當滑鼠移動且「箭頭方向」與「當前鎖定目標方向」夾角超過此門檻時，才重選目標。
     * 小幅滑鼠抖動不換目標。
     */
    switchAngleDeg: 35,
    /** 黏著時，目標離開此半徑（>searchRadius 的緩衝）就視為太遠、放棄鎖定 */
    loseTargetRadius: 620,
    /** 近敵貼身攻擊時，朝目標位移的一小段距離（貼近用） */
    meleeStep: 46,
    /** 鎖定標記樣式 */
    marker: {
      color: 0xffe66d,
      radius: 24,
      thickness: 2,
      /** 角色代表色小色點半徑 */
      dotRadius: 5,
      /** 色點距框中心的半徑（畫在框外圈上方一圈） */
      dotOrbit: 30,
      /** 多個色點沿框上緣排開的間距（像素） */
      dotSpacing: 14
    }
  },

  /**
   * 普攻近/遠差異化：
   * 按攻擊(鬥氣未滿)時判定最近可攻擊敵人距離：
   *  - ≤ melee.range → 原地扇形劍氣（不位移）
   *  - > melee.range 但衝刺可達 → 朝該方向衝撞（衝刺遇敵停下打 + 衝擊特效）
   *  - 前方無敵 → 單純衝一段
   */
  melee: {
    /** 近戰門檻：最近敵人 ≤ 此距離就用原地扇形（像素） */
    range: 90,
    /** 扇形總角度（度，朝 aimAngle 左右各半） */
    arcDeg: 90,
    /** 扇形半徑（像素） */
    radius: 110,
    /** 劍氣扇形特效顏色 / 透明度 / 淡出時間 */
    arcColor: 0xbfefff,
    arcAlpha: 0.5,
    arcFadeMs: 220
  },

  /** 遠距衝撞的衝擊特效 */
  impact: {
    /** 衝擊圈顏色 */
    ringColor: 0xffffff,
    /** 衝擊圈擴張到的半徑 */
    ringRadius: 70,
    /** 衝擊圈擴張/淡出時間（毫秒） */
    ringMs: 220,
    /** 命中點內圈亮閃顏色 */
    coreColor: 0xffe66d
  },



  /** 打擊感表現 */
  /**
   * 命中凍結（hitstop）：只凍結被打的怪——原地僵住 freezeMs、凍結結束才被擊退飛出。
   * 玩家角色與其他怪完全不受影響（4 人共玩不互相卡頓）。BOSS / 塔 / NPC / 寶箱怪不被擊退，也不凍結。
   * 這裡是預設值，實際值取自主選單打擊感編輯器（systems/hitFeelParams）
   */
  hitstop: {
    /** 總開關 */
    enabled: true,
    /** 每次命中的凍結時間（毫秒） */
    freezeMs: 60,
    /** 凍結中再被打只延長；一次凍結的總長上限（毫秒），避免圍毆時被一直定住 */
    maxFreezeMs: 120,
    /** 凍結結束後多久內不再凍結（毫秒；0 = 無冷卻）：讓持續被圍毆的怪在凍結到上限後確實被擊退一段，不會一直被定住 */
    cooldownMs: 100
  },

  /**
   * 衝刺動態（純視覺，攻擊者自己）：衝刺中的殘影與沿移動方向拉長、撞到敵人時壓扁回彈。
   * 繪製前套用、繪製後還原（同 HitReactionFx），不影響物理與判定。開關 / 拉長 / 壓扁為打擊感編輯器的預設值
   */
  dashFx: {
    /** 殘影開關（1 = 開） */
    afterimageEnabled: true,
    /** 殘影：產生間隔（毫秒）、淡出時間（毫秒）、起始透明度、同時存在上限、顏色 */
    afterimageIntervalMs: 30,
    afterimageLifeMs: 160,
    afterimageAlpha: 0.45,
    afterimageMax: 8,
    afterimageTint: 0x9fd8ff,
    /** 衝刺中沿移動方向拉長的比例（面積維持不變） */
    stretch: 0.12,
    /** 撞到敵人瞬間的壓扁比例（橫向放大、縱向縮小）與回彈時間（毫秒） */
    impactSquash: 0.2,
    impactSquashMs: 120,
    /** 殘影深度相對角色的差（畫在角色後方） */
    afterimageDepthOffset: -0.000001
  },

  /**
   * 衝刺切入（刀切進肉的阻力感）：衝刺撞到敵人後不立即停下，以減速沿衝刺方向繼續「陷入」durationMs 再停。
   * 只影響攻擊者自己，且在普攻冷卻內，不延遲輸入；BOSS / 塔仍停在外緣。
   * 開關 / 陷入時間 / 速度 / 刀光開關為預設值，實際值取自主選單打擊感編輯器（systems/hitFeelParams）
   */
  cutIn: {
    /** 切入開關（關閉 = 撞到立即停下） */
    enabled: true,
    /** 陷入時間（毫秒） */
    durationMs: 70,
    /** 陷入速度 = 撞擊當下衝刺速度 × 此比例 */
    speedRatio: 0.25,
    /** 刀光開關 */
    streakEnabled: true,
    /** 撞擊停頓：撞到敵人後先停住多久（毫秒）再開始陷入，讓「滑順衝刺 → 被卡住」的頓更明確 */
    impactPauseMs: 35,
    /** 刀光：長度（px）、粗細、強化時粗細、淡出時間（毫秒）、外層光暈顏色（一般 / 強化） */
    streak: {
      length: 140,
      width: 3,
      empoweredWidth: 5,
      ms: 100,
      color: 0xbfe9ff,
      empoweredColor: 0xffd54f
    }
  },

  juice: {
    /** 爆發螢幕震動 */
    burstShakeDuration: 300,
    burstShakeIntensity: 0.009,
    /** 命中閃白時間（毫秒） */
    flashMs: 60,
    /** 敵人受擊閃白時間（毫秒，打擊感編輯器的預設值）；角色出手閃白仍用 flashMs */
    enemyFlashMs: 100,
    /** 命中火花（每隻被打到的敵人都噴；純視覺）。數量 / 角度 / 速度上限 / 時間 / 大小為打擊感編輯器的預設值 */
    hitSpark: {
      /** 一般攻擊顆數 / 強化攻擊顆數的倍數 */
      count: 8,
      empoweredCountMult: 2,
      /** 噴發錐形的總角度（度），以「攻擊來源 → 敵人」方向為中心 */
      coneDeg: 70,
      /** 粒子速度範圍（px/秒）；speedMin 為下限（打擊感編輯器調 speedMax） */
      speedMin: 160,
      speedMax: 380,
      /** 粒子存在時間（毫秒） */
      lifespanMs: 220,
      /** 粒子起始縮放（spark 貼圖 8px，結束時縮到 0） */
      scale: 1.2,
      /** 一般 / 強化攻擊的顏色（輪流使用） */
      colors: [0xffffff, 0xfff3b0],
      empoweredColors: [0xffd54f, 0xffa000],
      /** 深度：在站立物件與斬擊圈之上、傷害數字之下 */
      depth: 44
    },
    /**
     * F4 新美術的命中特效放大：火花與刀光尺寸 × √(怪的顯示高度 / fxReferenceHeight)，上限 fxMaxScale。
     * 特效原本依舊美術小怪（約 32px）設計；舊美術外觀維持 1 倍
     */
    fxReferenceHeight: 32,
    fxMaxScale: 2.5,
    /** 敵人受擊反應（純視覺：繪製前套用、繪製後還原，不影響判定）；全部為打擊感編輯器的預設值 */
    hitReaction: {
      /** 反應時間（毫秒） */
      durationMs: 120,
      /** 壓扁幅度：橫向放大 / 縱向縮小的比例（隨時間線性回彈到 0） */
      squash: 0.18,
      /** 左右抖動幅度（px）與反應期間的來回次數 */
      jitterPx: 3,
      jitterCycles: 2
    },
    /** 傷害數字上飄時間（毫秒） */
    damageTextMs: 600,
    /**
     * 效能節流：限制「同時存在的視覺特效物件數」上限，避免時停/爆發同幀大量
     * 傷害跳字 + 死亡粒子拖垮 render。超過上限時略過視覺（傷害/計殺照算，不影響玩法）。
     */
    maxActiveFx: 40,
    /** 時停結算「分幀攤開」每幀處理的敵人數（避免單幀爆量特效） */
    timestopSettlePerFrame: 10,
    /** 死亡粒子每次數量（原 8→調小以降負載） */
    deathBurstParticles: 6
  },

  /**
   * 道具系統。
   * 4 種：A 旋風斬 / B 天降雷擊 / C 居合貫穿 / E 全屏震爆。
   */
  items: {
    /** 道具總開關:false=場上完全不生成/不掉落任何道具(殺怪掉落/寶箱獎勵/定時生成 全走此開關)。預設 true 維持現狀。 */
    spawnEnabled: false, // 🚫 暫時關閉道具系統 - 用戶要求
    /** 打死敵人掉落道具的機率 */
    dropChance: 0.06,
    /** 定時保底掉落間隔（毫秒，場內隨機點掉一個），0=關閉 */
    periodicDropMs: 0,
    /** 道具在場上的存活時間（毫秒），逾時消失 */
    lifespanMs: 14000,
    /** 道具體型半徑（碰撞/顯示） */
    radius: 15,
    /** 場上道具數量上限 */
    maxAlive: 5,
    /** 逾時前開始閃爍提示的剩餘時間（毫秒） */
    blinkBeforeMs: 2500,
    /** 6 種道具的顏色（對應 skill A/B/C/E/F/H/T） */
    colors: {
      A: 0x00e5ff, // 旋風斬 - 青
      B: 0xffd700, // 天降雷擊 - 金
      C: 0xff4d6d, // 居合貫穿 - 紅
      E: 0xa855f7, // 震爆 - 紫
      F: 0xff7a1a, // 噴火 - 橙紅
      H: 0x2ecc71, // 補血 - 綠
      T: 0xffffff // 時間暫停 - 白
    },
    /**
     * 掉落加權：A/B/C/E/F/H 各權重 1，時停 T 明顯較低（0.25），用加權隨機挑。
     */
    weights: {
      A: 1,
      B: 1,
      C: 1,
      E: 1,
      F: 1,
      H: 1,
      T: 0.25
    }
  },

  /** 補血道具（H）：撿到立即回血，只補撿到的角色 */
  heal: {
    /** 固定回血量（不超過 maxHp） */
    amount: 40
  },

  /**
   * 可打破物件（瓶罐/箱子）：每波隨機灑幾個，玩家攻擊/衝刺揮到打破，有機率掉道具(同怪物 dropChance)。
   * 不擋移動、不被敵人破壞、不納入自動鎖定。HP/perWave 為手感值，用戶玩了可能調。
   */
  breakable: {
    /** HP：40→80(普攻~36約2-3下破，帶點份量) */
    hp: 80,
    /** 改成成堆生成——每波幾堆、每堆幾個、堆內散佈半徑(取代原 perWave 分散) */
    clustersPerWave: 3,
    perCluster: 4,
    clusterSpread: 44,
    /** 場上同時存活上限 */
    maxAlive: 24,
    /** 體型半徑(命中/顯示/碰撞) */
    radius: 16,
    /** 生成離牆內縮 */
    edgeInset: 60,
    /** 堆中心距場地中心的最短距離*/
    minDistFromCenter: 150,
    /** 單次招式(AOE)打破多個木箱時的掉落上限(其餘只碎不掉,避免洗版) */
    maxDropPerBreak: 1,
    /** 生成避開玩家的最短距離 */
    safeDistanceFromPlayer: 140,
    /** 堆與堆中心彼此的最短距離 */
    minClusterSpacing: 140,
    /** 本體顏色(木箱棕) + 描邊 */
    color: 0xb07a3c,
    stroke: 0x5c3d1c,
    /**
     * 爆炸桶(barrel)：打破時範圍爆炸——低傷+擊退範圍內怪(朝外炸飛)、炸到玩家(快扣血/慢掉能量、不擊退)、
     * 連鎖引爆其他桶(有深度上限)。外觀紅橘桶區別木箱。每波少量。
     */
    barrel: {
      /** 爆炸桶 HP(比木箱低一點,易引爆) */
      hp: 40,
      /** 每波生成數量(少量) */
      perWave: 2,
      /** 爆炸 AOE 半徑 */
      explodeRadius: 120,
      /** 爆炸桶彼此最短間距(≥explodeRadius×1.5=180,讓一個桶爆炸碰不到另一個→自然幾乎不連鎖) */
      minBarrelSpacing: 200,
      /** 打破後【倒數蓄力(fuse)】毫秒——期間出現地面警示圈,倒數完才爆(怪/玩家可閃避) */
      fuseMs: 800,
      /** 爆炸對範圍內怪/玩家的傷害(低,別秒殺) */
      explodeDamage: 26,
      /** 爆炸對怪的擊退位移距離(朝遠離爆炸中心;明顯炸飛) */
      knockback: 130,
      /** 連鎖引爆深度上限 */
      maxChainDepth: 3,
      /** 爆炸桶掉道具機率(低於木箱:主打爆炸不主打掉落) */
      dropChance: 0.03,
      /** 桶身色(橘紅) + 描邊(深紅) + 危險條紋色 */
      color: 0xe8562a,
      stroke: 0x7a1e0a,
      stripe: 0xffd400
    },
    /** 木箱/桶【可推動】——角色/怪走路碰觸推動物件的物理參數 */
    push: {
      /** 被推時每次接觸施加的速度上限(像素/秒;推著走手感、非撞飛) */
      maxPushSpeed: 180,
      /** 每秒速度衰減比例(摩擦阻力;越大停越快) */
      friction: 6
    }
  },

  /**
   * 一次性招式數值（吃道具觸發）。
   * 每招做成「演出」，期間角色無敵且玩家不可操控（performMs 為演出總時長）。
   */
  skills: {
    /** A 旋風斬：原地旋轉大範圍捲擊，多段傷害 + 強力外拋 */
    whirlwind: {
      radius: 200,
      /** 放置式旋風場——持續時間（毫秒） */
      durationMs: 3000,
      /** 每跳傷害間隔（毫秒）；3000/200=15 跳 */
      tickMs: 200,
      /** 每段傷害 */
      damagePerHit: 22,
      /** 外拋擊退力道 */
      knockback: 0,
      hits: 18,
      intervalMs: 60,
      spinMs: 1080,
      spinTurns: 4,
      afterimages: 5
    },
    /** B 天降雷擊：在「角色自身周圍」順時針依序打出 strikes 道環繞落雷 */
    thunder: {
      /** 雷擊道數 */
      strikes: 6,
      /** 環繞角色的落雷半徑（等距一圈） */
      orbitRadius: 120,
      /** 每道爆炸半徑 */
      radius: 90,
      /** 每道傷害 */
      damage: 80,
      /** 每道之間的落下延遲（毫秒，順時針依序） */
      strikeDelayMs: 110,
      knockback: 260,
      /** 演出：打出前的蓄力/前搖時間（毫秒） */
      chargeMs: 350
    },
    /** C 居合貫穿：來回兩趟高速斬，貫穿路徑上所有敵人 */
    iaido: {
      /** 突進距離 */
      distance: 1300,
      /** 突進速度（像素/秒） */
      speed: 2600,
      /** 貫穿命中判定半徑（沿途） */
      hitRadius: 55,
      /** 命中傷害 */
      damage: 120,
      knockback: 420,
      /** 演出：拔刀前的短暫預備時間（毫秒） */
      windupMs: 160
    },
    /** E 震爆：角色跳起 → 往下砸 → 落地大範圍衝擊波 */
    shockwave: {
      /** 作用半徑 */
      radius: 450,
      /** 傷害 */
      damage: 70,
      /** 強力擊退 */
      knockback: 800,
      /** 衝擊波視覺擴張時間（毫秒） */
      visualMs: 320,
      /** 演出：跳起時間 / 落下時間（毫秒） */
      jumpMs: 260,
      slamMs: 160
    },
    /** F 噴火：朝隨機有敵方向噴火 + 地面燒灼持續傷害 */
    flame: {
      /** 火道長度（沿噴射方向） */
      flameLength: 340,
      /** 火道寬度（垂直噴射方向的總寬） */
      flameWidth: 150,
      /** 噴出當下的直接命中傷害 */
      burstDamage: 60,
      knockback: 200,
      /** 地面燒灼區長方形（貼合火道）：長 / 寬 */
      burnLength: 300,
      burnWidth: 150,
      /** 燒灼矩形近端距角色的距離（噴口前方起點） */
      burnStart: 40,
      /** 燒灼區持續時間（毫秒） */
      burnDurationMs: 2000,
      /** 燒灼每跳間隔（毫秒） */
      tickMs: 400,
      /** 燒灼每跳傷害 */
      tickDamage: 22,
      /** 演出：噴火前搖 + 噴射時間（毫秒） */
      windupMs: 220,
      sprayMs: 480
    },
    /** T 時間暫停：全場凍結，角色連續穿梭衝撞，結束統一結算 */
    timestop: {
      /** 穿梭衝撞次數 */
      dashes: 9,
      /** 總演出時長 */
      durationMs: 2000,
      /** 每次穿梭沿途/終點的命中判定半徑 */
      hitRadius: 180,
      /**
       * 穿梭選敵的候選半徑（在此半徑內挑目標，並「均勻散佈」抽樣，
       * 讓角色穿梭到更遠、更分散的敵人，整體涵蓋範圍明顯更大）。
       */
      spreadRadius: 900,
      /** 結束時對記錄到的敵人套用的高單體傷害 */
      damage: 220,
      /** 單目標連斬時角色落點在目標周圍環的半徑(繞著目標來回、不疊在目標身上) */
      orbitOffset: 70,
      /** 結束時的擊退（打飛） */
      knockback: 700
    }
  },

  /**
   * 小遊戲「收集競賽」數值（非戰鬥）。1 真人 + 3 BOT，60 秒收集告示指定形狀丟進自己箱子比分。
   */
  collectRace: {
    /** 遊戲時長（毫秒） */
    durationMs: 60000,
    /** 4 種形狀 key（貼圖 collect-<shape>） */
    shapes: ['diamond', 'star', 'heart', 'gem'] as const,
    shapeNames: { diamond: '鑽石', star: '星星', heart: '心形', gem: '寶石' } as const,
    /** 每種形狀在中心區維持的目標數量（撿掉會補到此數）9→11 場上更充足、較不會找不到 */
    perShapeTarget: 11,
    /** 物件散佈的中心區半徑（離場地中心） */
    scatterRadius: 240,
    /** 物件體型半徑（撿取判定/顯示） */
    itemRadius: 16,
    /** 玩家/BOT 走路速度（像素/秒） */
    moveSpeed: 300,
    /** BOT 走路速度 */
    botMoveSpeed: 190,
    /** 撿取判定半徑（角色距物件多近可撿） */
    pickRadius: 40,
    /** 箱子半徑（放入判定 + 顯示） */
    binRadius: 40,
    /** 告示定時換——改【每次 9~12 秒隨機】(非固定,不規律)。保留 signIntervalMs 供參考不再用。 */
    signIntervalMs: 10000,
    /** 告示換間隔隨機範圍(毫秒),每次換完重算 nextSignAt = now + Between(min,max) */
    signIntervalMinMs: 9000,
    signIntervalMaxMs: 12000,
    /** 物件推力再降(110→70)+摩擦再增(11→15)→碰到只輕微挪一咪咪馬上停、幾乎不被推跑、立刻好撿 */
    itemPush: { maxPushSpeed: 70, friction: 15 },
    /** 位置校正拖行上限(px/幀)——限制「玩家走過去把物件推在前面」的拖行,即使一直走物件也只被撥開一點點(碰到幾乎不動),不會被拖著跑一整段 */
    itemPushDragMax: 1.2,
    /** BOT 反應延遲(毫秒,決策間隔)350→620 反應更慢、變弱 */
    botReactMs: 620,
    /** BOT 撿錯機率0.15→0.28 更常撿錯、變弱 */
    botWrongPickChance: 0.28,
    /** 角色顏色(沿用 char-0..3)；箱子/歸屬色 */
    binColors: [0x4aa3ff, 0xff5a6e, 0x4ade80, 0xffd23f] as const,
    ownerNames: ['你 P1', 'BOT 1', 'BOT 2', 'BOT 3'] as const
  },

  /**
   * 小遊戲「推人生存」(閃躲類,非戰鬥)。1真人+3BOT。地面預警圈填滿→爆,圈內出局;空白推附近的人(可推進圈害死)。60秒活著者勝。
   */
  pushSurvival: {
    durationMs: 60000,
    /** 走位速度(只移動不衝刺) */
    moveSpeed: 300,
    botMoveSpeed: 220,
    /** 角色半徑 */
    radius: 16,
    /** 推人:範圍內最近的人被推;推飛距離;被推者失控(不能自主移動)時間;推的CD */
    pushRange: 90,
    pushDistance: 220,
    pushStunMs: 400,
    pushCooldownMs: 2000,
    /** 推人改「位移撞人」——按空白角色朝面向【短衝】一段(dash)去撞人,撞到才推飛。衝距離/衝時長(→衝速=dist/time)。 */
    dashDist: 110,
    dashDurationMs: 160,
    /** 預警圈難度遞增:間隔(出現頻率)ms 由 start→end 線性(越後越密);半徑;填滿時間(越後越短越難閃) */
    ringIntervalStartMs: 1500,
    ringIntervalEndMs: 500,
    ringRadiusStart: 70,
    ringRadiusEnd: 130,
    ringFillStartMs: 1600,
    ringFillEndMs: 750,
    /** 同時並存的預警圈數(難度遞增:前期少、後期多)——維持這麼多圈,各自獨立填滿→爆(時間差錯開) */
    ringConcurrentStart: 2,
    ringConcurrentEnd: 5,
    /** 每次生新圈的最小間隔(錯開節奏,避免同幀一次生一堆同時爆) */
    ringStaggerMs: 350,
    /** 角色間【被動身體推擠】的分離(輕、只防重疊,獨立於空白主動推飛) */
    bodySeparate: true,
    /** 預警圈生成——追人圈比例(0=全隨機,1=全追人)。每次生圈擲骰:命中→開在隨機存活角色附近(逼玩家一直動),否則純隨機 */
    ringChaseChance: 0.5,
    /** 追人圈落點相對目標角色的隨機偏移(px,預判/些許提前量) */
    ringChaseOffset: 60,
    /** 爆炸後火光環淡出/震動 */
    ringColor: 0xff3322,
    ringFillColor: 0xff5522,
    /** 爆炸畫面震動(單次)——強度/時長(從 0.006/160 減半降暈) */
    shakeIntensity: 0.003,
    shakeDurationMs: 120,
    /** 震動節流——此毫秒內多圈連爆只震一次(避免後期滿場連爆狂抖) */
    shakeThrottleMs: 260,
    /** BOT 決策間隔 220→420 反應更慢(變弱) */
    botReactMs: 420,
    /** BOT 閃圈的偵測邊際(px)——原碼寫死40,改用此值並縮小到18→BOT 較晚才反應閃、沒那麼準(變弱) */
    botDangerMargin: 18,
    /** BOT 主動推人的機率(每次決策擲骰)——1=每次能推就推,降到0.45→較少主動推(變弱) */
    botPushChance: 0.45,
    /** 預備開始倒數(毫秒)——intro 按空白後進 ready 階段倒數,角色不動/預警圈不出/計時未起,倒數完才 playing */
    readyCountdownMs: 3000,
    /** 角色顏色(沿用 char-0..3) + 名字 */
    colors: [0x4aa3ff, 0xff5a6e, 0x4ade80, 0xffd23f] as const,
    names: ['你 P1', 'BOT 1', 'BOT 2', 'BOT 3'] as const
  },

  /**
   * 小遊戲「炸彈人對戰(丟炸彈版)」。1真人+3BOT。撿地上炸彈→朝面向丟→撞人即爆/落地倒數爆→炸到出局→最後活著者勝。
   */
  bombArena: {
    /** 遊戲時長(毫秒);60秒到仍活著者一起贏(平手) */
    durationMs: 60000,
    /** 玩家/BOT 走路速度(只移動不衝刺) */
    moveSpeed: 300,
    botMoveSpeed: 230,
    /** 角色半徑(碰撞/互推) */
    radius: 16,
    /** 預備開始倒數(沿用推人生存):intro 空白→ready 倒數→playing */
    readyCountdownMs: 3000,
    /** 場上維持的可撿炸彈數(撿掉/爆掉後補);生成間隔(補充節流) */
    groundBombTarget: 5,
    bombSpawnIntervalMs: 900,
    /** 炸彈半徑(顯示/撿取/飛行撞人判定用) */
    bombRadius: 13,
    /** 撿取判定半徑(靠近多近可撿) */
    pickRange: 40,
    /** 丟:飛行速度(px/s)、最大飛行距離(到了就落地) */
    throwSpeed: 460,
    throwMaxDist: 340,
    /** 落地後倒數多久才爆(給對手閃);地面預警圈 */
    fuseMs: 1500,
    /** 爆炸:圓範圍半徑、擊退速度(px/s)、擊退失控時間 */
    explodeRadius: 78,
    knockSpeed: 460,
    knockStunMs: 350,
    /** 連鎖引爆:爆炸範圍內其他炸彈跟著爆的深度上限(防無限);連鎖觸發延遲(視覺錯開) */
    chainMaxDepth: 6,
    chainDelayMs: 90,
    /** 震動(沿用降暈值) + 節流 */
    shakeIntensity: 0.004,
    shakeDurationMs: 130,
    shakeThrottleMs: 220,
    /** 角色間被動身體推擠(防重疊) */
    bodySeparate: true,
    /** BOT AI:決策間隔(偏慢別太神)、丟人的距離(靠多近才丟)、閃避偵測邊際 */
    botReactMs: 380,
    botThrowRange: 260,
    botDangerMargin: 26,
    /** BOT 不自炸:只在「與目標距離 > explodeRadius+radius+此安全值」時才丟(否則太近丟了自己也在爆炸範圍);丟完退開 */
    botSelfSafeMargin: 40,
    /** 爆炸火光色 */
    explodeColor: 0xff6a1a,
    ringColor: 0xff3322,
    /** 角色顏色 + 名字 */
    colors: [0x4aa3ff, 0xff5a6e, 0x4ade80, 0xffd23f] as const,
    names: ['你 P1', 'BOT 1', 'BOT 2', 'BOT 3'] as const
  }
} as const;

export type GameConfigType = typeof GameConfig;
