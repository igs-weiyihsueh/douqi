/**
 * 全遊戲可調數值集中於此，方便後續調校。
 * 所有數值皆為「暫定值」，之後可視手感調整。
 */
export const GameConfig = {
  /** 邏輯解析度（16:9 橫向；Phaser Scale FIT + CENTER_BOTH 等比縮放滿版） */
  width: 1280,
  height: 720,

  /** 除錯開關 */
  debug: {
    /** 顯示慢速模式即時調參面板(藍圈/衝刺距離/速度)——用戶要求預設關 */
    showSlowTuningPanel: false
  },

  /** ★波次進度 HUD(關卡制:節點序列 ●─●─◆);只純波次顯示,事件/BOSS 隱藏 */
  waveHud: {
    enabled: true,
    /** 節點序列置中的畫面座標(setScrollFactor0 固定);上方 */
    x: 640,
    y: 30,
    /** 節點半徑 */
    nodeRadius: 15,
    /** 節點間距(圓心到圓心) */
    nodeGap: 132,
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
    /** 獎勵/完成節點(菱形)色 */
    rewardColor: 0xffd23f
  },

  /**
   * 競技場（固定視角）：整個場地一眼看完，鏡頭不跟隨。
   * 場地略小於畫面，四周留邊給圍欄與 HUD，讓敵人容易聚集、產生包圍壓迫感。
   */
  arena: {
    /** 場地距畫面邊緣的內縮（像素）；場地大小 = 畫面 - 2*padding */
    padding: 48,
    /** 圍欄線框粗細 */
    borderThickness: 6,
    borderColor: 0x3a4668,
    /** v13：敵人被擊飛撞邊界的反彈係數（0=不反彈直接停、1=完全反彈） */
    bounceRestitution: 0.6
  },

  /**
   * ★敵人↔敵人碰撞分離（讓怪不再完全重疊擠成團）——照異靈藍圖：軟分離 steering(主力) + 硬 de-overlap(補刀)。
   * 純幾何、不走 Phaser collider，config 可調手感。純俯視無縱深壓縮→忽略貼地壓扁。
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
     * ★toTarget 先正規化再加分離，否則遠距追擊力淹沒分離力→還是疊團。weight 越大越散(但太大會抖/偏離追擊)。
     */
    weight: 1.1,
    /** 硬 de-overlap 迭代次數（兩兩距離<r_i+r_j 沿連線推開，迭代收斂）。 */
    iterations: 2,
    /**
     * 單幀硬解最大推移量(像素)：玩家衝進怪群瞬間大量重疊→限制每幀每隻最多推這麼多，分多幀鬆弛，避免瞬移/爆衝。
     */
    maxStepPx: 9
  },

  /**
   * ★黏著目標(階段1,仿DouPo):怪生成即綁定一個目標角色,之後黏著不亂換——
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
    /** 攻擊範圍：衝刺到距離目標多近就停下並揮擊 */
    attackReach: 44,
    /** 單次普攻傷害（v32：25→36，+44%；連段技/普攻皆受益） */
    attackDamage: 36,
    /** 衝刺速度（像素/秒） */
    dashSpeed: 1400,
    /** 普攻擊退力道（v11：220→380，約 +73%，明顯加強壓制） */
    knockback: 380,
    /** 攻擊後短暫無法再輸入的冷卻（毫秒）★用戶指定:160→300(攻速 0.3秒1下=每秒~3.3下) */
    attackCooldownMs: 300,
    /** 受擊後的無敵時間（毫秒） */
    invulnMs: 600,
    /** v40(3)：舊「推角色」分離力道。v56(B方案)改成推怪、此值已不使用(保留避免其他引用/相容)。 */
    separatePush: 0.35,
    /** 攻擊命中判定的額外半徑（普攻掃擊範圍）（v5：60→42，縮約 30%，更易被包圍） */
    attackHitRadius: 42,
    /** v11：遠距衝撞衝刺期間的護盾（無敵）；近戰扇形不給 */
    dashShieldInvuln: true
  },

  /**
   * v46 慢速模式（controlMode='slow'）專用數值。fast 模式不使用這些。
   * slow：純鍵盤，方向鍵/WASD 八方向持續移動(moveSpeed)、角色面向=移動方向、
   * 範圍圈(lockRadius)內敵人自動鎖定(規則同 fast 但限此圈、方向源用面向)、空白鍵攻擊衝刺(共用 fast)。
   */
  slow: {
    /** 八方向持續移動速度（像素/秒；「一點點走」手感，做出後可再調） */
    moveSpeed: 220,
    /** 自動鎖定範圍圈半徑；v47:260→200、v51:200→140(用戶調好定案) */
    lockRadius: 140,
    /** v51：慢速專屬「無鎖衝刺距離」；v52:100→140(與藍圈 lockRadius140 一致)。fast 用 aim.dashDistance 不受影響 */
    dashDistance: 140,
    /** v51：慢速專屬「衝刺速度」預設(用戶定案400)；fast 用 GameConfig.player.dashSpeed 不受影響 */
    dashSpeed: 400
  },

  /**
   * 鬥氣系統（v19 改「命中次數」制）：
   * 每次攻擊(扇形/衝撞)只要至少命中 1 隻敵人 → +1 次（一次攻擊不論打中幾隻都只算 1）；
   * 揮空不累積。累積達 hitsToBurst 次即集滿觸發爆發。4 角色各自獨立。
   */
  spirit: {
    /** 集滿所需的「命中次數」（v31：BOT 仍用此觸發舊爆發；P1 改用 combo 連段系統） */
    hitsToBurst: 10
  },

  /**
   * v31 連段技系統（僅 P1）：普攻命中累積 combo，達門檻觸發「已解鎖」的連段技。
   * v32 最終架構：一條 combo 累積，四技各自門檻+隨等級解鎖：
   *   命中3→圓形(Lv2)、6→直線(Lv4)、9→爆發原地亂打(Lv6)、10→限時強化(Lv1)，到 10 歸零。
   * 未達解鎖等級的階不觸發。與道具 6 招是不同系統。
   */
  /**
   * v31 連段技系統（僅 P1）。
   * v55：COMBO 與能量拆成兩套【只在慢速模式(controlMode==='slow')】生效；快速模式維持原樣(一條 combo 3/6/9/10)。
   *   · 快速(fast)：一條 combo，命中+1，3圓/6直/9爆發/10強化(durationMs)，到10歸零。thresholds/max/durationMs 為 fast 用。
   *   · 慢速(slow)：COMBO(combo 區塊，只到9爆發後歸零) + 能量(energy 區塊，滿10自動強化、倒退解除)兩套獨立。
   */
  combo: {
    /** 各階觸發門檻（累積命中次數）。fast 用到 empower(10)；slow 只用 circle/line/burst(爆發後歸零)。 */
    thresholds: { circle: 3, line: 6, burst: 9, empower: 10 },
    /** 各階解鎖所需團隊等級（限時強化 Lv1、圓 Lv2、直 Lv4、爆發 Lv6） */
    unlockLevel: { circle: 2, line: 4, burst: 6, empower: 1 },
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
      /** v57：5000→3000(強化持續約3秒，fast 用) */
      durationMs: 3000,
      damageMult: 1.8,
      rangeMult: 1.5,
      /** v35：強化期間移動/衝刺「距離」倍率（走位、衝刺終點距離更遠） */
      moveMult: 1.4,
      /** v35：強化期間衝向敵人的「衝刺速度」倍率 */
      dashSpeedMult: 1.5,
      /** ★v60 階段3:強化型態造型(程式繪製變身視覺,只 slow P1)。★不放大。 */
      form: {
        tint: 0xffdc4d,          // 本體疊亮金色調
        ringColor: 0xffe066,     // 內光環
        ring2Color: 0xff7a3c,    // 外光環(反向轉,能量橙紅)
        outlineColor: 0xfff2a8,  // 描邊/glow外框
        particleTint: [0xffe86a, 0xffd23f, 0xffb020], // 上升粒子色
        orbitDots: 4,            // 繞轉光點數
        particleFreq: 60         // 粒子發射頻率(ms);越小越密
      },
      /** ★v62/v63 階段4:強化期【唯一招】——鎖定角色周圍圓範圍內的怪→打過去→以【目標】為中心炸圓AOE。只 slow P1。 */
      aoe: {
        radius: 160,             // ★③④炸裂 AOE 半徑(以【目標】為中心)——縮小(260→160)
        damage: 60,              // AOE 圓內每隻敵人傷害(隨等級/curSkillDamageScale)
        knockback: 180,          // 輕擊退
        cooldownMs: 650,         // 每次放的冷卻(避免狂放)
        projSpeed: 900,          // 攻擊飛向目標的投射速度(px/s)
        projColor: 0xffe066,     // 投射/衝擊色
        color: 0xffe066,         // 炸裂圈顏色
        ringMs: 300              // 炸裂圈擴張視覺時長
      }
    }
  },

  /**
   * ★【實驗性】招式「表演時間」——施放圓/直/爆發時角色進入定身無敵(不能移動:走/衝刺/位移全鎖,但免傷免擊退)。
   * 時間到才恢復可動可被打。用 Character.skillLockUntil 實作(該狀態本就鎖 fast衝刺/slow走位輸入 + 賦予無敵)。
   * ★easy拔:enabled=false 即整組還原(不設 skillLockUntil→維持原本瞬發不鎖)。手感值可調。
   */
  performanceTime: {
    enabled: true,
    circle: 600,
    line: 600,
    burst: 1000
  },

  /**
   * v55/v58 能量系統（★只慢速模式 controlMode==='slow' 用，僅 P1，獨立於 combo）：
   * v58 重做:能量改【擊殺敵人獲得】(依怪種 perKill 給量)、被打中 -1(保留)、滿 trigger 不自動觸發→改【按 Z 鍵手動觸發】強化,
   * 強化期間能量每秒 drainPerSec 倒退退到 0 解除。BOSS 特例:命中(非擊殺)有 bossHitChance 機率給 bossHitAmount。
   */
  energy: {
    max: 150,
    /** 滿此值可觸發(手動按 Z);v58:自動→手動;v61:100→50;★用戶回報太易→50→80→150(normal10×15=150,約殺15隻才滿,大幅提高門檻)。 */
    trigger: 150,
    /** 強化解鎖團隊等級 */
    unlockLevel: 1,
    /** 強化期間能量每秒倒退量;★門檻 150 對應 150/7≈21.43/秒→維持強化持續約7秒不變(門檻提高持續不變)。 */
    drainPerSec: 150 / 7,
    /** ★v58/v61:擊殺各怪種獲得能量(值調高→打死怪明顯有感;normal10→滿50約5隻)。未列用 default。 */
    perKill: {
      normal: 10,
      shooter: 12,
      charger: 12,
      shielder: 18,
      bomber: 15,
      tank: 25,
      default: 10
    } as Record<string, number>,
    /** ★v58/v61:BOSS 命中(非擊殺)給能量的機率與量(max50下 amount 提到12)。 */
    bossHitChance: 0.15,
    bossHitAmount: 12,
    /** ★v59 階段2:擊殺掉落【能量球飛向P1】純視覺演出(不改加值時機)。 */
    orb: {
      /** ★開關:false=不生飛能量球(能量值仍擊殺當下正常加,只是無飛球視覺)。用戶暫關,保留 code 易復原。 */
      enabled: false,
      /** 場上能量球數量上限(輕量,避免多殺洗版) */
      maxAlive: 24,
      radius: 7,
      color: 0x66ff9c,      // 亮綠(與金幣金色/道具區別=能量感)
      glowColor: 0xd6ffe6,
      /** 飛向P1的基礎時長(ms);距離遠略久。 */
      flyMs: 420,
      /** 生成時先小噴一下再飛(散射初速 px) */
      scatter: 26
    }
  },

  /** 爆發連招（v6：削弱為「清空間/擊退解圍」用途，擊退力不變） */
  burst: {
    /** 連打段數（v6：30→16，持續時間約 -47%） */
    hits: 16,
    /** 每段間隔（毫秒） */
    intervalMs: 55,
    /** 每段傷害（v6：40→22，約 -45%） */
    damagePerHit: 22,
    /** 每段命中的作用半徑（v6：260→140，約 -46%） */
    radius: 140,
    /** 擊退力道（v19：110→0，爆發完全不震退；角色原地無敵持續多段亂打） */
    knockback: 0,
    /** 爆發時角色朝敵群衝刺的速度（v4 起原地施放已不使用） */
    dashSpeed: 900,
    /** 爆發期間無敵 */
    invuln: true,
    /** v26：每段命中敵人時的 hitstop（毫秒），畫面極短凝滯強化打擊「破頓」感 */
    hitstopMs: 55
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
    /** 鬥氣滿時自動觸發爆發的機率檢查（每次出手判定，1=一定放） */
    burstUseChance: 1,

    /**
     * v15：BOT 搶道具行為（積極度中等，不為遠道具送死）。
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
   * 敵人（v5）：可設定類型，各自 HP/速度/體型/顏色不同。
   * AI 改「蓄力攻擊」：追擊 → 進入攻擊距離蓄力(前搖) → 發動近身範圍攻擊 → 冷卻。
   * 已移除「接觸即扣血」。
   */
  enemy: {
    /** 追到多近就進入攻擊流程（進入蓄力的觸發距離，像素） */
    engageRange: 40,    /** 被擊退後的硬直時間（毫秒）：期間不主動追不進攻（v11：250→500，普攻更能壓制/定身） */
    knockbackStunMs: 500,
    /** 蓄力/前搖時間（毫秒）：v18 改「由內而外填滿」讀條式預警，填滿瞬間發動（v26：650→950，詠唱更久好反應/打斷） */
    chargeMs: 950,
    /** 發動攻擊時的近身傷害範圍（玩家在此半徑內才扣血，像素） */
    attackRadius: 46,
    /** 每次攻擊命中對玩家的傷害 */
    attackDamage: 12,
    /** 攻擊後冷卻（毫秒），冷卻結束才能再次蓄力；v37：1200→2000 降近戰攻擊頻率(normal/tank/shielder 共用) */
    attackCooldownMs: 2000,

    /**
     * v18：警戒 + 巡邏 AI（normal/tank/shielder 套用）。
     * 出生預設 patrol：出生點附近小範圍慢速漫步，不再一出生直衝玩家。
     * 角色進入 alertRadius → chase 追擊 + 蓄力攻擊；目標離開 loseRadius 或脫離
     * loseGraceMs 後 → 回 patrol。
     */
    ai: {
      /** 警戒範圍：角色進入此半徑才開始追擊（v24：260→460，涵蓋大半場地，一生成就追） */
      alertRadius: 300,
      /** 脫離範圍：追擊目標超出此半徑（比 alertRadius 大）就準備回巡邏（v24：360→560，黏著度更高） */
      loseRadius: 560,
      /** 脫離持續多久（毫秒，目標一直在 loseRadius 外）才真的回巡邏（v24：1200→2000，追更久） */
      loseGraceMs: 2000,
      /** 巡邏移動速度（比追擊 moveSpeed 慢） */
      patrolSpeed: 34,
      /** 巡邏漫步半徑：離出生點多遠內隨機遊走 */
      patrolRadius: 70,
      /** 巡邏每次改變目標點的間隔範圍（毫秒） */
      patrolRepathMinMs: 900,
      patrolRepathMaxMs: 2000,
      /**
       * ★仇恨警戒上限:單一角色(seat)最多同時被幾隻【被動】怪盯上(進 chase)。
       * 被動=自己因 alertRadius 進範圍而追;主動=被玩家攻擊命中/鎖定過(aggroActive)→不計入、永遠可追。
       * 達上限時【新的被動怪不進 chase,維持 patrol】(不是把已追的退回)。每個 seat 各自算。
       * 守護波強制追 NPC 的怪(forceChase/事件怪)不計入、不受限。
       */
      aggroCapPassive: 15
    },

    /** 盾怪（shielder）行為參數 */
    shielder: {
      /** 正面被攻擊時的傷害倍率（大幅減傷；從側/背打才正常） */
      frontDamageMult: 0.15,
      /** 判定為「正面」的夾角（度）：攻擊來源與盾怪面向夾角在此半錐角內算正面 */
      frontConeDeg: 70
    },
    /** 遠攻怪（shooter）行為參數（v25：改蓄力直線雷射） */
    shooter: {
      /** 想與角色保持的距離（太近會後退拉開） */
      preferRange: 260,
      /** 小於此距離就後退 */
      retreatRange: 180,
      /** 進入此距離開始蓄力雷射 */
      fireRange: 420,
      /** v25 雷射：蓄力填滿時間（毫秒），期間鎖定方向、畫填充預警線（v28：1700→2500，更好躲） */
      laserChargeMs: 2500,
      /** 雷射長度（像素，以怪為起點朝玩家方向） */
      laserLength: 520,
      /** 雷射命中判定寬度（像素，直線 AOE 半寬 = laserWidth/2） */
      laserWidth: 22,
      /** 雷射命中傷害 */
      laserDamage: 16,
      /** 雷射存在時間（毫秒） */
      laserOnDurationMs: 180,
      /** 兩次雷射之間的冷卻（毫秒） */
      shootCooldownMs: 1600,
      /** （舊子彈式射擊參數，v25 停用，保留備查） */
      bulletSpeed: 260,
      bulletDamage: 10,
      bulletLifespanMs: 3200,
      bulletRadius: 7,
      maxBullets: 200
    },
    /** 衝鋒怪（charger）行為參數 */
    charger: {
      /** 進入此距離開始蓄力 */
      engageRange: 260,
      /** 蓄力/預警時間（毫秒） */
      chargeMs: 700,
      /** 衝刺速度（像素/秒） */
      dashSpeed: 620,
      /** 衝刺最長持續（毫秒），到時或撞牆就停 */
      dashDurationMs: 650,
      /** 衝刺撞到角色的傷害 */
      dashDamage: 18,
      /** 衝刺撞擊判定半徑 */
      dashHitRadius: 30,
      /** 衝完硬直/冷卻（毫秒） */
      recoverMs: 900
    },

    /**
     * 各類型定義（含出現權重 spawnWeight，用於隊形內混編）。
     * v25：spawnWeight 為「該怪種解鎖後」的加權；是否納入抽選由 enemy.unlockByLevel + teamLevel gating（見 pickEnemyType）。
     */
    types: {
      /** 一般近戰蓄力小怪（v32：spawnWeight 52→75，雜兵佔比提高、更多好清） */
      normal: {
        maxHp: 90,
        speed: 70,
        radius: 14,
        color: 0xff5a6e,
        stroke: 0x2a0a12,
        spawnWeight: 75
      },
      /** 肉盾：高 HP、慢速、體型較大（v32：maxHp 320→200） */
      tank: {
        maxHp: 200,
        speed: 40,
        radius: 22,
        color: 0x8b5cf6,
        stroke: 0x1a0a2e,
        spawnWeight: 12
      },
      /** 盾怪：正面減傷，需繞側/背（v32：maxHp 150→100） */
      shielder: {
        maxHp: 100,
        speed: 58,
        radius: 16,
        color: 0x38bdf8,
        stroke: 0x0a2a3a,
        spawnWeight: 6
      },
      /** 遠攻怪：保持距離、蓄力直線雷射，本體脆（v25：解鎖後權重 10） */
      shooter: {
        maxHp: 45,
        speed: 60,
        radius: 13,
        color: 0x22c55e,
        stroke: 0x0a2a12,
        spawnWeight: 10
      },
      /** 衝鋒怪：蓄力後高速直線衝撞（暫不解鎖，spawnWeight 0、不列 unlockByLevel） */
      charger: {
        maxHp: 110,
        speed: 66,
        radius: 15,
        color: 0xf59e0b,
        stroke: 0x3a2400,
        spawnWeight: 0
      },
      /** v26 投射兵：保持距離、瞄準玩家位置蓄力投擲炸彈（落點有預警圈），本體脆 */
      bomber: {
        maxHp: 60,
        speed: 55,
        radius: 15,
        color: 0xe0b0ff,
        stroke: 0x2a1a3a,
        spawnWeight: 8
      },
      /** v28 BOSS：實際 stats 來自 GameConfig.boss；此處僅為型別索引安全的佔位（不列 unlockByWave、spawnWeight 0 不會被抽到） */
      boss: {
        maxHp: 3000,
        speed: 46,
        radius: 42,
        color: 0xff3355,
        stroke: 0x3a0010,
        spawnWeight: 0
      },
      /** v33 塔/NPC：型別索引安全佔位（實際 stats 來自 GameConfig.event；spawnWeight 0、不列解鎖表，永不自然生成） */
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
      /** v36 BOSS 戰錨點：型別索引安全佔位（實際靜止、可鎖、不可傷；spawnWeight 0 永不自然生成） */
      anchor: {
        maxHp: 999999,
        speed: 0,
        radius: 22,
        color: 0x00e5ff,
        stroke: 0x083a44,
        spawnWeight: 0
      },
      /** ★寶箱怪：稀有趣味怪。spawnWeight 0（不走一般權重生成,由 treasure.spawnChance roll）。maxHp 大（改用命中次數死,非扣血）。 */
      treasure: {
        maxHp: 999999,
        speed: 0, // 移動由跑點 AI 控(treasure.moveSpeed),非一般追擊速度
        radius: 22,
        color: 0xffd23f,
        stroke: 0x8a6a00,
        spawnWeight: 0
      }
    },
    /** ★寶箱怪行為參數 */
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
      /** ★寶箱怪出現提示橫幅:文字 + 停留時間(毫秒)。 */
      bannerText: '💰 寶箱怪出現!擊破有獎勵!',
      bannerHoldMs: 1500
    },

    /**
     * v25：怪種隨團隊等級解鎖。pickEnemyType() 只在「teamLevel >= 對應門檻」的怪種間做加權隨機。
     * 未列於此表者（如 charger）永不解鎖。normal 門檻 1（一開始就有）。
     */
    unlockByLevel: {
      normal: 1,
      tank: 3,
      shielder: 5,
      bomber: 6,
      shooter: 7
    },

    /**
     * v27：怪種改「依波次」解鎖（pickEnemyType 依 currentWave gating）。越後面波次怪種越多。
     * 未列者（charger）永不解鎖。
     */
    unlockByWave: {
      normal: 1,
      tank: 2,
      shielder: 4,
      bomber: 5,
      shooter: 6
    },

    /** v26 投射兵（bomber）行為參數（仿 shooter 蓄力 pattern，改投擲炸彈到玩家落點） */
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
      /** 爆炸傷害（套 curEnemyDamageScale） */
      bombDamage: 30
    }
  },

  /**
   * 生成 / 難度曲線（持續制 B2）：
   * 不分明確波次，持續地成群丟隊形進來；只要場上未達上限就繼續補。
   * v3：隊形直接在競技場「內部」生成，並先播登場提示（telegraph）。
   * v5：隊形內混入少量肉盾（tankRatio）。
   */
  spawn: {
    /** 初始「每組隊形」的生成間隔（毫秒）（v7：2000→1700，出怪更頻繁） */
    initialIntervalMs: 1700,
    /** 生成間隔最小值（越小越密）（v7：800→650） */
    minIntervalMs: 650,
    /** 每秒縮短生成間隔的量（毫秒/秒），保留難度曲線 */
    intervalDecayPerSec: 16,
    /** 場上敵人數量上限（v18：640→416，約 -35%，怪量減少） */
    maxAlive: 416,
    /** v23：單人存活（僅剩 1 名角色）時的場上敵人硬上限（v26：50→35，單人更少） */
    soloMaxAliveCap: 35,
    /** 生成方陣隊形的機率（其餘為環形包圍圈） */
    matrixChance: 0.5,
    /** 開場立即先丟一組隊形（不必等第一個間隔） */
    spawnOnStart: true,
    /** 登場提示時間（毫秒）：這段期間敵人半透明閃爍，不能傷害玩家、也不能被打 */
    spawnTelegraphMs: 420,
    /** 場內生成時與角色的安全距離（避免生在玩家貼臉） */
    safeDistanceFromPlayer: 130,
    /** 生成點距場地邊界的內縮（確保在場內）；v37fix(C)：24→90 讓怪出生離牆更遠、偏場內 */
    edgeInset: 90,
    /**
     * v20：怪量隨場上「存活角色數」縮放。effectiveScale = base + (aliveCount-1)*perAlive，夾在 [base,1]。
     * 1 人 = 0.4（現況 40%）、每多 1 人 +0.2、湊滿 4 人 = 1.0（現況量）。
     * 此縮放乘在 maxAlive 與每波生成量上；等級成長曲線再疊加其上。
     */
    aliveScale: {
      base: 0.4,
      perAlive: 0.2
    }
    /** v9：敵人類型改用各 type 的 spawnWeight 權重混編（見 enemy.types），移除舊 tankRatio */
  },

  /**
   * ★階段2b 生怪分配制(decision 71437147):每次補生分【近身組+場上組】。
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
    nearTypes: ['normal', 'tank', 'shielder', 'charger'] as string[],
    /** 場上組敵種池(含遠程);空陣列=用全池(pickEnemyType 預設)。 */
    fieldTypes: [] as string[],
    /** ★階段3:場上組出生點離【所有玩家】的最小距離(像素)。加大→場上組生更遠、不一出生就在旁。起手 420。 */
    fieldMinDistFromPlayer: 420,
    /**
     * ★leash 拴繩(難度微調):場上組怪離【出生點】超過此距離就放棄追、回走。起手 650。
     * 效果:玩家能拉一小群但拉不動整片場(想清遠處怪要自己走過去)。近身組不套用(貼玩家)。
     */
    fieldLeashRadius: 200,
    /** 近身組 leash 半徑(設大值≈不套用,近身組本意貼玩家)。 */
    nearLeashRadius: 100000,
    /**
     * ★leash 第二條(累積移動路程):場上組怪【本次追擊累積跑的路程】超過此值就放棄回家(繞圈拉也拉不動)。
     * 與直線 fieldLeashRadius 並存,任一觸發就脫繩。(用戶覺太鬆再收緊 500→360)
     */
    fieldLeashTravelDist: 260,
    /** 近身組路程 leash(大值≈不套用)。 */
    nearLeashTravelDist: 1000000
  },

  /**
   * v27 波次制：每波要清掉固定數量的怪才過關，越後面波次量越多、怪種越多。
   * 等級(擊殺經驗)=強度與角色成長；波次=量與怪種解鎖。兩者並存。
   */
  wave: {
    /** 第 1 關怪數 */
    baseQuota: 10,
    /** 每往後一波 quota 增量（10關內遞增） */
    quotaGrowth: 8,
    /** quota 上限；v42:70→90 容納第8/9關高量 */
    quotaCap: 90,
    /** 過關後停歇時間（毫秒，顯示 Wave Clear / 下一波提示） */
    intermissionMs: 2500,
    /** v42：10 關循環，第 10 關為 BOSS 關（wave%10===0） */
    wavesPerCycle: 10,
    /** 事件關（第 3/5/7 關；第 10 關固定 BOSS，不與事件衝突） */
    eventWaves: [3, 5, 7],
    /** v42：BOSS 前高潮關（第 8/9 關）——普通波但怪量加成 */
    preBossWaves: [8, 9],
    /** v42：preBoss 關的 quota 加成係數 */
    preBossQuotaMult: 1.5,
    /** v28：每幾波為 BOSS 波（v42：改為每 10 關；保留欄位相容） */
    bossEveryWaves: 10,
    /** v33：保留欄位（v39 改用 eventWaves 明確指定） */
    eventEveryWaves: 3,

    /**
     * ★階段2a 波次進度制 + drip 持續補生。waveQuota→targetProgress(每波目標,殺一隻+1);
     * drip:活怪跌破 spawnThresholdRatio×maxAlive → 開始補生(latch refilling),補到 maxAlive 才關(防抖)。
     * ★聰明停生:生產總量(progress+alive+pending)封頂 targetProgress,絕不超生。maxAlive 用 curMaxAlive()。
     */
    drip: {
      /** 活怪佔 maxAlive 的比例跌破此值→開始補生(latch 開)。起手 0.6(六成)。config 可調。 */
      spawnThresholdRatio: 0.6,
      /** ★階段2b 初期量:前幾波視為「早期」,target 墊高讓 drip 補滿。起手 3 波。 */
      earlyWaves: 3,
      /** 早期波 targetProgress 下限 = initialFillMult×maxAlive(讓 drip 補到接近/超過滿場→初期飽滿)。起手 1.2。 */
      initialFillMult: 1.2
    }
  },

  /**
   * ★關卡系統（第一階段骨架）：關卡 1~4，每關分 A/B 兩子區(橫向並排大場地)。
   * N-A 打 wavesA 波→左右箭頭選邊→鏡頭平移到 N-B→N-B 打 wavesB 波→上/下出口→閃黑→(N+1)-A。
   * 第一階段:A/B 都純波次(不接事件/BOSS);選邊(L/R)影響 B 的靜態物件配置。
   */
  stage: {
    /** 是否啟用關卡制(關掉=回退舊無限波次) */
    enabled: true,
    /** 總關卡數 ★第二輪:1-4 荒城→火山(第一輪),5-8 森林→洞窟(第二輪);關4=中場BOSS、關8=壓軸BOSS(真通關) */
    totalLevels: 8,
    /** ★方案e:移動區(arena)尺寸【小於畫面】,四周留遠景空間;鏡頭跟隨玩家、走邊緣露出更多遠景。 */
    arenaW: 1040,
    arenaH: 600,
    /** 移動區四周的遠景邊距(世界像素);縮小(減少空蕩)。slot = arena + 2×margin,仍略大於畫面才有跟隨露景空間。 */
    sceneMargin: 190,
    /** 鏡頭跟隨的 deadzone(緩衝區)寬高——玩家在此框內鏡頭不動,超出才跟。 */
    followDeadzoneW: 360,
    followDeadzoneH: 240,
    /** 鏡頭跟隨的 lerp 平滑係數(0~1,越小越平滑) */
    followLerp: 0.08,
    /** 每關 A 子區波數 */
    wavesA: 2,
    /** 每關 B 子區波數(純波次時;隨機 1~2 波) */
    wavesB: 2,
    /** ★B 子區進場隨機:抽到【限時事件】的機率(其餘=純波次);其餘 1-bEventChance=純波次 */
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
    /** 箭頭距場地左右邊緣的內縮 */
    arrowInset: 70,
    /** 出口距場地上/下邊緣的內縮 */
    exitInset: 60,
    /** 玩家走到箭頭/出口的觸發距離 */
    triggerDist: 46,
    /** ★階段2:crossing 開放後短暫緩衝(毫秒)內不觸發邊界過場——讓玩家看引導箭頭、不貼邊秒觸發。 */
    crossGraceMs: 700,
    /** 選邊(L/R)影響 B 靜態物件:各配置木箱/桶座標(相對子區左上角比例 0~1) */
    layoutLeft: {
      crates: [[0.28, 0.34], [0.34, 0.42], [0.3, 0.5], [0.7, 0.66], [0.76, 0.58]],
      barrels: [[0.5, 0.3], [0.62, 0.72]]
    },
    layoutRight: {
      crates: [[0.7, 0.34], [0.64, 0.44], [0.72, 0.52], [0.3, 0.68], [0.24, 0.6]],
      barrels: [[0.5, 0.72], [0.38, 0.3]]
    },
    /**
     * ★每區【隨機布置】可破壞物件(取代固定 layoutLeft/Right 座標):每次進子區隨機數量+位置。
     * 保留選邊 L/R 基調:R 側多桶(barrelBias),L 側多木箱。避開中心(出入/事件目標)與邊緣。
     */
    breakablesRandom: {
      crateMin: 6, crateMax: 11,     // ★②木箱數量提高(用戶嫌太少),範圍拉大→每區數量明顯不同
      barrelMin: 1, barrelMax: 3,    // 炸彈桶數量範圍
      barrelBiasExtra: 1,            // R 側額外桶上限(基調:某側多桶)
      /** 隨機分布區域(相對子區比例):避開最外圈與正中心。★範圍拉大→位置更分散、不顯固定。 */
      marginX: 0.1, marginY: 0.12,   // 距邊緣內縮比例(縮小→可用範圍變大)
      centerAvoidR: 0.14,            // 避開中心的半徑(相對 min(寬,高))
      minSpacingR: 0.06              // 物件之間最小間距(相對 min(寬,高)),避免重疊(縮小→可放更密更多)
    }
  },

  /**
   * ★第二階段:場景視覺(程式繪製)。統一基調=黃土荒城+熔岩火山。
   * 4 關【移動區地貌】各異;A/B【遠景】不同(A 荒城天際線 / B 火山噴發)。
   * 先實作關卡1;關2/3/4 palette 先放好、方向確認後再啟用繪製細節。
   */
  scene: {
    /** 遠景帶(移動區外圍到畫面邊緣)高度佔畫面比例 */
    farBandRatio: 0.28,
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
      },
      // ★第二輪(森林→洞窟);階段1 先用佔位配色(複用現有地貌繪製),全新地貌(樹/草/岩壁/鐘乳石)留階段2-3。
      5: {
        name: '翠綠森林',
        groundBase: 0x3a6b32,    // 草綠
        groundDark: 0x274d22,    // 暗綠(樹影)
        groundLight: 0x4f8a3e,   // 亮綠(受光草)
        crackColor: 0x1f3d1a,    // 泥徑/縫
        pebble: 0x5a7a3a,        // 苔石
        glow: 0,                 // 森林無發光
        skyTop: 0x2a3a24,        // 天空(林間暗綠)
        skyBottom: 0x486a38
      },
      6: {
        name: '幽深林地',
        groundBase: 0x2f5a2a, groundDark: 0x1e3d1c, groundLight: 0x437a34,
        crackColor: 0x18301a, pebble: 0x486a30, glow: 0,
        skyTop: 0x1f2e1c, skyBottom: 0x385230
      },
      7: {
        name: '陰森洞窟',
        groundBase: 0x2b2f36, groundDark: 0x171a1f, groundLight: 0x3c424b,
        crackColor: 0x0e1013, pebble: 0x454b54, glow: 0x2a7aa0, // 冷光(磷光/水光)microglow
        skyTop: 0x141820, skyBottom: 0x20272f
      },
      8: {
        name: '洞窟深淵',
        groundBase: 0x22262c, groundDark: 0x101216, groundLight: 0x32373f,
        crackColor: 0x090b0e, pebble: 0x3a3f47, glow: 0x1e6a92,
        skyTop: 0x0d1016, skyBottom: 0x181e25
      }
    },
    /** 遠景(A/B 共通調色,實際剪影/噴發由繪製函式畫) */
    farA: { label: '荒城天際線', wall: 0x4a3826, tower: 0x3a2c1e, hazeTop: 0x5a4230 },
    farB: { label: '火山噴發', skyRed: 0x8a2a14, smoke: 0x3a2822, lava: 0xff5a1a, glowSky: 0xc23a10 },
    /** ★第二輪森林遠景(關5-6):遠樹林/林冠剪影。A/B 各一調(A較亮林緣、B較深林冠)。 */
    farForestA: { label: '晨光林緣', canopy: 0x2f5a2e, canopyDark: 0x214021, haze: 0x6a8a52, trunk: 0x3a2c1e },
    farForestB: { label: '幽深林冠', canopy: 0x244a24, canopyDark: 0x162e17, haze: 0x3e5a34, trunk: 0x2a2016 },
    /** 森林飄葉/光點粒子色(取代火山餘燼) */
    forestLeaf: 0x8fce5a, forestMote: 0xdfffa0,
    /** ★第二輪洞窟遠景(關7-8):岩壁/鐘乳石/石筍/深處冷光。A=洞口微光(較亮)、B=洞窟深淵(更暗)。 */
    farCaveA: { label: '洞口微光', rock: 0x2e333a, rockDark: 0x1a1e23, haze: 0x2a4a58, glow: 0x2a6a8a, drip: 0x3a4048 },
    farCaveB: { label: '洞窟深淵', rock: 0x22262b, rockDark: 0x121417, haze: 0x1e3844, glow: 0x1e5a7a, drip: 0x2c3138 },
    /** 洞窟粒子色:水滴/微塵(暗灰)+冷光螢點(藍白冷光,ADD) */
    caveDrip: 0x6a8aa0, caveMote: 0x8fd8ff, caveGlow: 0x2a7aa0 },

  /** v28 波次 BOSS 設定 */
  boss: {
    /** 基礎 HP（會隨「第幾隻 BOSS」與等級成長）；v35：3000→8000 更耐打 */
    baseHp: 8000,
    /** 每多一隻 BOSS（每個 BOSS 波）HP 成長倍率累加 */
    hpGrowthPerBoss: 0.6,
    /** 體型半徑（大） */
    radius: 42,
    /** 移動速度（慢）；v35：BOSS 暫改固定中央不動（stationary），此值保留給日後招式重做 */
    speed: 46,
    /** v35：BOSS 站中央不動（第8-9點招式/錨點重做前的暫定行為） */
    stationary: true,
    /** v35：BOSS 戰期間不召喚小怪（暫停 summon 招） */
    disableSummon: true,
    /** 接觸/攻擊對玩家的傷害基準（套 curEnemyDamageScale） */
    color: 0xff3355,
    stroke: 0x3a0010,
    /** 攻擊模式輪替冷卻（毫秒）：每隔此時間換一招 */
    attackCycleMs: 2600,
    /** (a) 近身大範圍橫掃 */
    sweepRadius: 180,
    sweepDamage: 34,
    sweepWindupMs: 700,
    /** (b) 週期召喚小怪數量 */
    summonCount: 4,
    /** (c) 蓄力朝玩家投彈：落點爆炸 */
    bombChargeMs: 1000,
    bombRadius: 110,
    bombDamage: 30,
    bombFlightMs: 700,
    /** 擊殺掉落道具數 */
    dropCount: 4,
    /** v44：BOSS 掉落道具距 BOSS 中心的距離（拉遠，避免掉腳邊被身體擋住撿不到）；原40→170 */
    dropDist: 170,
    /** v45(5)：BOSS 招命中角色的定身時長（毫秒；禁移動+禁攻擊） */
    skillRootMs: 2000,
    /** v35：打 BOSS 過程噴道具——每累積受到此傷害量，在 BOSS 附近掉 1 個道具 */
    dropEveryDamage: 600,
    /** v35：噴道具離 BOSS 中心的散布半徑 */
    dropScatter: 90,
    /**
     * v36：BOSS 四招輪替（a→b→c→d→a）。都用「填滿式預警」，傷害走 damageCharacterFrom（無敵擋傷）。
     * 每招之間間隔 skillGapMs；招 b 緊接 a（safeRadius = a 的 radiusA，逼玩家躲進中心）。
     */
    skills: {
      /** 招間間隔（毫秒）；v37→v38：1800→3000（出完一招隔 3 秒才蓄下一招，放慢節奏） */
      gapMs: 3000,
      /** a：以 BOSS 為中心的實心大圓轟炸；v38 fillMs→4000（蓄力 4 秒） */
      a: { radius: 260, fillMs: 4000, damage: 30 },
      /** b：全場轟炸、只有 BOSS 周圍 safeRadius(=a.radius) 圓形安全區；v38 fillMs→4000 */
      b: { fillMs: 4000, damage: 34 },
      /** c：瞄玩家方向的 250° 大扇形（留 110° 缺口）；v38 fillMs→4000 */
      c: { range: 500, arcDeg: 250, fillMs: 4000, damage: 30 },
      /** d：左右半場接力轟炸（左半 fill 到 halfOverlap 時右半開始 fill）；v38 fillMs→4000 */
      d: { fillMs: 4000, damage: 30, halfOverlap: 0.5 }
    },
    /** v38(F)：出招間隔(gap 空檔)週期性朝玩家丟球狀飛行投射物，填補空檔小威脅 */
    gapBall: { intervalMs: 900, speed: 320, radius: 12, damage: 15, color: 0xff66aa },
    /** v36：BOSS 戰錨點（走位落點）——BOSS 外側上下左右 4 點 */
    anchorDist: 320,
    anchorCount: 4,
    /** v41(3)：暫時關閉 BOSS 戰錨點（保留錨點程式碼，之後可開回；false=不生成） */
    bossAnchorsEnabled: false
  },

  /** v33 三種事件（塔/守護/佔領）：非 BOSS 的事件波觸發，完成給獎勵 */
  event: {
    /**
     * ★人數動態難度調整系統
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
    /** 完成獎勵：掉道具數 + 給經驗（多次 grantKillExp normal 等效） */
    rewards: { dropCount: 4, expKills: 20 },
    /** ★事件波開場宣告序列(階段1:雙段大字+右滑出+時序gate+鎖操作;階段2再加真pan/壓黑聚焦)。 */
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
      /** ★逾時保底:整段開場最長秒數,超過強制結束解鎖(防鎖操作卡死) */
      maxIntroSec: 12,
      /** ★階段2:第二段聚焦時 camera pan 到目標置中的時間(毫秒)/緩動 */
      panMs: 420,
      /** 壓黑遮罩 alpha(0~1,越大越黑)/淡入淡出秒數 */
      dimAlpha: 0.82, dimFadeSec: 0.35,
      /** 目標亮圈(暖光暈,ADD)半徑(px)/顏色/alpha——凸顯被聚焦目標 */
      spotlightRadiusPx: 150, spotlightColor: 0xfff2b0, spotlightAlpha: 0.55,
      /** ★佔領事件:聚光圈半徑改依據點圈(capture.captureRadius)×此倍率(略大包住據點);塔/守護維持 spotlightRadiusPx */
      captureSpotlightMult: 1.1,
      /** ★佔領聚光圈很大(≈374)→用較低 alpha,避免大範圍 ADD 暖光把壓黑洗掉(塔/守護小圈維持 spotlightAlpha) */
      captureSpotlightAlpha: 0.2,
      /** 聚焦時把目標物提升到的 depth(高於壓黑遮罩 depth,露出目標);遮罩用此-2、亮暈用此-1 */
      focusTargetDepth: 972,
      /** ★階段3:角色自動走位到目標周圍——走位速度(px/s,同 updateLevelEnter)/環繞半徑(px)/逾時保底秒數 */
      walkSpeed: 520, walkRingPx: 90, maxWalkSec: 3.5
    },
    /** 塔事件：v44 改「一次發四大扇形、正十字↔斜十字交替」；打掉塔完成 */
    tower: {
      /** ★調整血量：單人時約50下打完（玩家攻擊力36×50=1800，設定為1800基礎） */
      baseHp: 1800,
      hpGrowthPerWave: 0.12,
      radius: 34,
      color: 0xc0c0c0,
      stroke: 0x222222,
      /** ★用戶指定:塔事件【限制時間】(毫秒,可調)。限時內打掉塔=完成給獎勵;時間到沒打掉=失敗(比照其他事件結束→進下一波、不給獎勵)。 */
      timeLimitMs: 40000,
      /** v44：四大扇形攻擊（取代 v39 三方向直線光束） */
      fanBlast: {
        /** 同時發幾個扇形（4：正十字或斜十字） */
        count: 4,
        /** 每個扇形張角（度）；v45:66→48（四塊共192°、留 4 個 42° 縫，比原24°縫寬很多、好躲很多） */
        arcDeg: 48,
        /** 扇形半徑（從塔中心往外，涵蓋大部分場地） */
        radius: 520,
        /** 每組發射前填滿式預警時長（毫秒） */
        fillMs: 2000,
        /** 每次命中傷害 */
        damage: 24,
        /** v45(5)：命中定身時長（毫秒） */
        rootMs: 2000,
        /** 一組（4扇形）發射→下一組的間隔（毫秒） */
        cycleMs: 3200
      },
      /** v34：塔事件期間持續出怪間隔（毫秒，無視波次配額，直到塔被打掉）；v35：1300→800 場面更多怪 */
      spawnIntervalMs: 800,
      /** v35：塔事件每次生怪數量（加壓） */
      spawnBatch: 2
    },
    /** 守護事件：撐時間保護中央 NPC */
    guard: {
      /** 守護目標 NPC 血量；v43:2500→1600;用戶再下調 1600→1000(可調) */
      npcHp: 1000,
      radius: 26,
      color: 0x7bed9f,
      stroke: 0x0a3a1a,
      /** ★守護改【純時間間隔+循環】:durationMs 成為【唯一成功時限】——撐滿即守護成功(NPC 未死)。用戶:90s→60s。 */
      durationMs: 60000,
      /** v34：事件期間持續出怪的間隔（毫秒，加強壓力：900→550），無視波次配額直到時間結束 */
      spawnIntervalMs: 550,
      /** v34：每次生怪數量（多出點一般怪） */
      spawnBatch: 2,
      /** 敵人接觸 NPC 的扣血（每次攻擊判定） */
      npcContactDamage: 10,
      /** NPC 接觸判定半徑額外量 */
      contactRange: 30,
      /** v37fix(A)：每隻怪對 NPC 的接觸攻擊冷卻（毫秒）——不再每幀扣血，避免一群怪貼上瞬秒 */
      npcAttackCooldownMs: 1000,
      /**
       * ★守護 4 波腳本(取代持續隨機生怪):依序 4 波,每波【左右兩側】各生指定怪種數量;
       * 該波怪清完(或 waveTimeoutMs 超時防卡波)→進下一波;第4波清完 or 撐過 durationMs(保底)=守護成功。
       * 守護波怪【免疫 leash】(一直衝 NPC)。全 config 可調。
       */
      waves: [
        // 波1:左右各大量一般怪
        [{ type: 'normal', perSide: 8 }],
        // 波2:兩側遠程怪(用戶:4→2)
        [{ type: 'shooter', perSide: 2 }],
        // 波3:兩側肉怪
        [{ type: 'tank', perSide: 4 }],
        // 波4:前三者混合(用戶:shooter 2→1)
        [{ type: 'normal', perSide: 3 }, { type: 'shooter', perSide: 1 }, { type: 'tank', perSide: 2 }]
      ] as Array<Array<{ type: string; perSide: number }>>,
      /** 左右兩側生成的 x 內縮(離場邊界);左批 x=left+sideMargin、右批 x=right-sideMargin。 */
      sideMargin: 90,
      /** 每波防卡波超時(毫秒):純時間間隔制下已停用(改用 waveSpawnIntervalMs)。 */
      waveTimeoutMs: 12000,
      /** ★純時間間隔制:每過此毫秒數就生下一波(不管上波清掉沒),4 波循環重複。 */
      waveSpawnIntervalMs: 8000,
      /** 清波推進門檻(混合制:清空 OR 8秒較早):countGuardWaveAlive()==0 即出下一波。保留備用。 */
      guardWaveClearThreshold: 2,
      /** ★守護怪物遞增改善：改成「每循環一輪(4波跑完)+1/側」（減少原本每波增加太多的問題） */
      waveCountStep: 1,
      /** ★改進：每4波一輪後才遞增，而不是每波遞增 */
      wavesPerCycle: 4,
      waveCountCap: 12
    },
    /** 佔領事件：v39 改「圈內一波波出怪、殺完出下波、圈內有怪進度停、無怪且玩家在圈內才增」 */
    capture: {
      /** 佔領圈半徑；v41：260→340 加大 */
      captureRadius: 340,
      /** 圈內【無怪且玩家在圈內】時每秒進度（100 為滿） */
      progressPerSec: 12,
      /** v39：每波在圈內生幾隻怪（這波全清才出下一波） */
      waveSize: 5,
      /** v39：清完一波到下一波的間隔（毫秒）；v42:800→1800 讓玩家清空後更多喘息+推進度時間 */
      waveGapMs: 1800,
      /** v39：怪生成點在佔領圈內的半徑比例（0~1，×captureRadius；離圈心多遠內隨機生） */
      spawnInsideRatio: 0.85,
      /** v40(1)：時間限制（毫秒）——時間內進度達100=成功；時限到未滿=失敗(過關無獎勵) */
      timeLimitMs: 45000
    }
  },

  /** 隊形設定（v3：整組直接在場內定位） */
  formation: {
    /**
     * v25：隊形加權隨機挑選（spawnFormation 用）。新增 line/wedge/doubleRing/scatter。
     * 各隊形沿用 farFromAllCharacters 避免貼臉、curAliveScale 縮放數量。
     */
    typeWeights: {
      matrix: 20,
      ring: 24,
      line: 16,
      wedge: 14,
      doubleRing: 12,
      scatter: 14
    },
    /** 方陣：行列數範圍（會隨機取 NxN，N 介於 min~max）（v18：4~6→3~5，每波量降約 35%） */
    matrix: {
      minSize: 3,
      maxSize: 5,
      /** 方陣內單位間距（像素） */
      spacing: 46
    },
    /** 環形包圍圈：在角色周圍等距排一圈 */
    ring: {
      /** 一圈的敵人數量範圍（v18：10~18→6~12，每波量降約 35%） */
      minCount: 6,
      maxCount: 12,
      /** 生成時圓圈半徑範圍（場內，圍住角色） */
      minRadius: 180,
      maxRadius: 300
    },
    /** v25 橫/縱列：一整排壓進來 */
    line: {
      minCount: 6,
      maxCount: 11,
      /** 單位間距 */
      spacing: 52
    },
    /** v25 V字/楔形：以尖端朝角色的楔形 */
    wedge: {
      /** 每側排數（總數約 2*rows+1） */
      minRows: 3,
      maxRows: 5,
      spacing: 50
    },
    /** v25 雙環：內外兩圈同心 */
    doubleRing: {
      innerMinCount: 5,
      innerMaxCount: 8,
      outerExtra: 4,
      innerRadius: 170,
      ringGap: 120
    },
    /** v25 隨機散點：一個區域內隨機灑一叢 */
    scatter: {
      minCount: 6,
      maxCount: 12,
      /** 散佈區域半徑 */
      areaRadius: 200
    }
  },

  /**
   * 滑鼠瞄準衝刺（唯一操作方式，v4 移除自動鎖敵）：
   * 方向圓環箭頭恆指向游標；按攻擊朝箭頭方向衝一段距離，遇到第一個敵人就停下攻擊。
   */
  aim: {
    /**
     * v30 瞄準模式開關。false = 融合模式（★本次預設）：滑鼠方向錐形(±aimConeDeg,searchRadius)內有怪→自動鎖定朝那隻打(黏敵、滑鼠可切目標)；錐形內無怪(滑鼠指空地)→朝該空方向自由衝刺位移(走位不被拉回)。
     * true = 舊純自動鎖定黏著（一定鎖 searchRadius 內最近怪、方向被綁、無法朝空地走位）。
     */
    autoLock: false,
    /** v30：融合模式下「滑鼠方向錐形」半角（度）——此錐形內才鎖怪，錐外/無怪則朝空地走位 */
    aimConeDeg: 35,
    /** v44：道具鎖定優惠係數——道具在錐形內時，其「有效角度差」= 實際角度差 × 此值(0.7)，
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
    /** 箭頭大小（三角形邊長） */
    arrowSize: 16,
    /** 箭頭顏色 */
    arrowColor: 0xffe66d,
    /** 方向衝刺的最大距離（像素，路徑無敵人時衝完此距離停下） */
    dashDistance: 320,
    /** 衝刺途中判定「撞到敵人」的半徑（碰到就停在其旁攻擊）（v5：46→32，縮約30%） */
    dashHitRadius: 32,
    /** 衝刺距離指示線（v8，只在 P1 顯示） */
    indicator: {
      color: 0x8be9fd,
      alpha: 0.35,
      thickness: 4,
      /** 終點標記圓半徑 */
      endMarkerRadius: 8
    }
  },

  /**
   * 自動鎖定（v12）：方向永遠由「鎖定目標」決定，滑鼠只負責「選鎖哪隻」。
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
     * v14 黏著切換門檻（度）：鎖定會「黏」在同一敵人直到牠死亡/消失/離開搜尋半徑；
     * 只有當滑鼠移動且「箭頭方向」與「當前鎖定目標方向」夾角超過此門檻時，才重選目標。
     * 小幅滑鼠抖動不換目標。
     */
    switchAngleDeg: 35,
    /** 黏著時，目標離開此半徑（>searchRadius 的緩衝）就視為太遠、放棄鎖定 */
    loseTargetRadius: 620,
    /** 近敵貼身攻擊時，朝目標位移的一小段距離（貼近用） */
    meleeStep: 46,
    /** 鎖定標記樣式（v15：一個共用框 + 框邊多個角色代表色小色點） */
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
   * 普攻近/遠差異化（v10）：
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

  /** 遠距衝撞的衝擊特效（v10，命中時播） */
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
  juice: {
    /** 普攻螢幕震動 */
    hitShakeDuration: 90,
    hitShakeIntensity: 0.006,
    /** 爆發螢幕震動（v9：強度 0.02→0.009 明顯調小，時間 400→300 略縮） */
    burstShakeDuration: 300,
    burstShakeIntensity: 0.009,
    /** 命中閃白時間（毫秒） */
    flashMs: 60,
    /** 傷害數字上飄時間（毫秒） */
    damageTextMs: 600,
    /**
     * v17.1 效能節流：限制「同時存在的視覺特效物件數」上限，避免時停/爆發同幀大量
     * 傷害跳字 + 死亡粒子拖垮 render。超過上限時略過視覺（傷害/計殺照算，不影響玩法）。
     */
    maxActiveFx: 40,
    /** 時停結算「分幀攤開」每幀處理的敵人數（避免單幀爆量特效） */
    timestopSettlePerFrame: 10,
    /** 死亡粒子每次數量（原 8→調小以降負載） */
    deathBurstParticles: 6
  },

  /**
   * 道具系統（v8；v9：變稀有 + 護盾包裹，破盾才能拿）。
   * 4 種：A 旋風斬 / B 天降雷擊 / C 居合貫穿 / E 全屏震爆。
   */
  items: {
    /** ★道具總開關:false=場上完全不生成/不掉落任何道具(殺怪掉落/寶箱獎勵/定時生成 全走此開關)。預設 true 維持現狀。 */
    spawnEnabled: true,
    /** 打死敵人掉落道具的機率（v24：0.015→0.06，明顯變多但不氾濫） */
    dropChance: 0.06,
    /** 定時保底掉落間隔（毫秒，場內隨機點掉一個），0=關閉（v9：關閉保底，讓道具珍貴） */
    periodicDropMs: 0,
    /** 道具在場上的存活時間（毫秒），逾時消失（v9：拉長，因為要花時間破盾） */
    lifespanMs: 14000,
    /** 道具體型半徑（碰撞/顯示） */
    radius: 15,
    /** 場上道具數量上限（v25：24→5，同時最多 5 個） */
    maxAlive: 5,
    /** 逾時前開始閃爍提示的剩餘時間（毫秒） */
    blinkBeforeMs: 2500,
    /** v9：道具護盾 HP（需被角色攻擊打幾下才破，破後才可拾取） */
    shieldHp: 3,
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
     * v14 掉落加權：A/B/C/E/F/H 各權重 1，時停 T 明顯較低（0.25），用加權隨機挑。
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

  /** v21 補血道具（H）：撿到立即回血，只補撿到的角色 */
  heal: {
    /** 固定回血量（不超過 maxHp） */
    amount: 40
  },

  /**
   * v57 可打破物件（瓶罐/箱子）：每波隨機灑幾個，玩家攻擊/衝刺揮到打破，有機率掉道具(同怪物 dropChance)。
   * 不擋移動、不被敵人破壞、不納入自動鎖定。HP/perWave 為手感值，用戶玩了可能調。
   */
  breakable: {
    /** HP：v59 40→80(普攻~36約2-3下破，帶點份量) */
    hp: 80,
    /** v59：改成成堆生成——每波幾堆、每堆幾個、堆內散佈半徑(取代原 perWave 分散) */
    clustersPerWave: 3,
    perCluster: 4,
    clusterSpread: 44,
    /** 場上同時存活上限 */
    maxAlive: 24,
    /** 體型半徑(命中/顯示/碰撞) */
    radius: 16,
    /** 生成離牆內縮 */
    edgeInset: 60,
    /** v59：堆中心距場地中心的最短距離；v60:260→150(靠中央一些、中間區域也有,但不生正中心) */
    minDistFromCenter: 150,
    /** v60：單次招式(AOE)打破多個木箱時的掉落上限(其餘只碎不掉,避免洗版) */
    maxDropPerBreak: 1,
    /** 生成避開玩家的最短距離 */
    safeDistanceFromPlayer: 140,
    /** 堆與堆中心彼此的最短距離 */
    minClusterSpacing: 140,
    /** 本體顏色(木箱棕) + 描邊 */
    color: 0xb07a3c,
    stroke: 0x5c3d1c,
    /**
     * v61 爆炸桶(barrel)：打破時範圍爆炸——低傷+擊退範圍內怪(朝外炸飛)、炸到玩家(快扣血/慢掉能量、不擊退)、
     * 連鎖引爆其他桶(有深度上限)。外觀紅橘桶區別木箱。每波少量。
     */
    barrel: {
      /** 爆炸桶 HP(比木箱低一點,易引爆) */
      hp: 40,
      /** 每波生成數量(少量) */
      perWave: 2,
      /** 爆炸 AOE 半徑 */
      explodeRadius: 120,
      /** v62：爆炸桶彼此最短間距(≥explodeRadius×1.5=180,讓一個桶爆炸碰不到另一個→自然幾乎不連鎖) */
      minBarrelSpacing: 200,
      /** v62：打破後【倒數蓄力(fuse)】毫秒——期間出現地面警示圈,倒數完才爆(怪/玩家可閃避) */
      fuseMs: 800,
      /** 爆炸對範圍內怪/玩家的傷害(低,別秒殺) */
      explodeDamage: 26,
      /** 爆炸對怪的擊退位移距離(朝遠離爆炸中心;明顯炸飛) */
      knockback: 130,
      /** 連鎖引爆深度上限(防無限連環爆;v62 靠間距幾乎不觸發,此為保險) */
      maxChainDepth: 3,
      /** 爆炸桶掉道具機率(低於木箱:主打爆炸不主打掉落) */
      dropChance: 0.03,
      /** 桶身色(橘紅) + 描邊(深紅) + 危險條紋色 */
      color: 0xe8562a,
      stroke: 0x7a1e0a,
      stripe: 0xffd400
    },
    /** v62：木箱/桶【可推動】——角色/怪走路碰觸推動物件的物理參數 */
    push: {
      /** 被推時每次接觸施加的速度上限(像素/秒;推著走手感、非撞飛) */
      maxPushSpeed: 180,
      /** 每秒速度衰減比例(摩擦阻力;越大停越快) */
      friction: 6
    }
  },

  /**
   * 一次性招式數值（吃道具觸發）。
   * v13：每招做成「演出」，期間角色無敵且玩家不可操控（performMs 為演出總時長）。
   */
  skills: {
    /** A 旋風斬：原地旋轉大範圍捲擊，多段傷害 + 強力外拋 */
    whirlwind: {
      radius: 200,
      /** v27：放置式旋風場——持續時間（毫秒） */
      durationMs: 3000,
      /** v27：每跳傷害間隔（毫秒）；3000/200=15 跳 */
      tickMs: 200,
      /** 每段傷害（v27：放置式 DOT，維持 22） */
      damagePerHit: 22,
      /** 外拋擊退力道（v26：0，不擊退，敵人留在範圍內被持續絞） */
      knockback: 0,
      /** （v27 起改放置式，以下 spinMs/hits/spinTurns/afterimages 保留不用） */
      hits: 18,
      intervalMs: 60,
      spinMs: 1080,
      spinTurns: 4,
      afterimages: 5
    },
    /** B 天降雷擊（v20 改）：在「角色自身周圍」順時針依序打出 strikes 道環繞落雷 */
    thunder: {
      /** 雷擊道數 */
      strikes: 6,
      /** v20：環繞角色的落雷半徑（等距一圈） */
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
    /** C 居合貫穿（v20：加寬判定範圍）：來回兩趟高速斬，貫穿路徑上所有敵人 */
    iaido: {
      /** 突進距離（v25：1000→1300，切得更長） */
      distance: 1300,
      /** 突進速度（像素/秒） */
      speed: 2600,
      /** 貫穿命中判定半徑（沿途）（v25：110→55，判定變窄、視覺帶寬跟著變窄） */
      hitRadius: 55,
      /** 命中傷害 */
      damage: 120,
      knockback: 420,
      /** 演出：拔刀前的短暫預備時間（毫秒） */
      windupMs: 160
    },
    /** E 震爆（v20：不再全屏）：角色跳起 → 往下砸 → 落地大範圍衝擊波 */
    shockwave: {
      /** 作用半徑（v20：900→450，大範圍但非全屏） */
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
    /** F 噴火（v21：改長方形火道 + 長方形燒灼區）：朝隨機有敵方向噴火 + 地面燒灼持續傷害 */
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
    /** T 時間暫停（v13 新增第 5 招）：全場凍結，角色連續穿梭衝撞，結束統一結算 */
    timestop: {
      /** 穿梭衝撞次數（v14.1：6→9，配合 2 秒時長讓演出更充實、涵蓋更多敵人） */
      dashes: 9,
      /** 總演出時長（v14.1：1500→2000，時停 2 秒） */
      durationMs: 2000,
      /** 每次穿梭沿途/終點的命中判定半徑（v14.1：120→180，穿梭吃得更廣） */
      hitRadius: 180,
      /**
       * v14.1：穿梭選敵的候選半徑（在此半徑內挑目標，並「均勻散佈」抽樣，
       * 讓角色穿梭到更遠、更分散的敵人，整體涵蓋範圍明顯更大）。
       */
      spreadRadius: 900,
      /** 結束時對記錄到的敵人套用的高單體傷害 */
      damage: 220,
      /** v51(3)：單目標連斬時角色落點在目標周圍環的半徑(繞著目標來回、不疊在目標身上) */
      orbitOffset: 70,
      /** 結束時的擊退（打飛） */
      knockback: 700
    }
  },

  /**
   * 等級制（v14 核心新系統）：團隊共用一條經驗/等級。
   * 任一角色（含 BOT）擊殺 → 團隊經驗增加；達門檻升級，有上限 cap。
   *
   * 成長設計：把「目前(v13)的敵人/角色/招式數值」當作「滿級 Lv{cap}」基準，
   * Lv1 起始值約為滿級的 50~60%（各項 lv1Scale），中間等級線性內插：
   *   scale(level) = lv1Scale + (1 - lv1Scale) * (level - 1) / (cap - 1)
   * 升級效果：敵人越多越強（難度成長）、角色攻擊範圍越大、招式威力越強。
   */
  level: {
    /** 等級上限（到頂不再升、經驗條停在滿） */
    cap: 10,
    /** 每擊殺一般怪的團隊經驗 */
    expPerKill: 10,
    /** 不同敵種額外經驗倍率（tank/shielder 更肥給更多） */
    expMultiplierByType: {
      normal: 1,
      tank: 3,
      shielder: 2,
      shooter: 1.5,
      charger: 2,
      bomber: 1.8,
      boss: 20,
      tower: 0,
      npc: 0,
      anchor: 0,
      treasure: 0
    },
    /**
     * 升到「第 n 級」所需的「該級累積經驗門檻」；index i=從 Lv(i+1) 升到 Lv(i+2) 需要的量。
     * v42：拉長到 10 關結構——約【第 7-8 關】達 Lv10（BOSS 第10關前練滿）。
     * 估算(10關)：普通/preBoss 關 1,2,4,6,8 quota 10+18+34+50+90≈202 隻 × expPerKill10 × 平均倍率(~1.2) ≈ 2424
     *           + 事件關 3,5,7 完成獎勵各 expKills20×10=200（累積 ~600）→ 第7-8關累積 ~2200+。
     * 總量設 ~2200，讓第 7-8 關達 Lv10。
     */
    expToNext: [50, 100, 150, 200, 250, 290, 340, 380, 440],

    /**
     * 難度成長（等級越高越難）：各項 Lv{cap} 值 = 下方對應的「現用值」，
     * Lv1 = 現用值 * lv1Scale。scale>1 表示 Lv1 較少/較弱、隨等級升到 Lv10=1x。
     */
    difficulty: {
      /** 敵人生成量上限：Lv1 較少（現值 640 的 0.5=320）→ Lv10 = 640 */
      maxAliveLv1Scale: 0.5,
      /** 敵人 HP：Lv1 為現值的 0.35 → Lv10 = 現值（v24：0.55→0.35，前期更脆好打） */
      enemyHpLv1Scale: 0.35,
      /** 敵人攻擊/接觸傷害：Lv1 為現值的 0.55 → Lv10 = 現值 */
      enemyDamageLv1Scale: 0.55,
      /** 生成間隔倍率：Lv1 出怪較慢（間隔 ×1.6）→ Lv10 = ×1.0（現速） */
      spawnIntervalLv1Mult: 1.6
    },

    /**
     * 角色成長（等級越高攻擊範圍越大、招式越強）：
     * 各項 Lv1 = 現用值 * lv1Scale → Lv10 = 現用值。
     */
    character: {
      /** 扇形劍氣半徑 / 角度：Lv1 為現值的 0.6 */
      meleeRadiusLv1Scale: 0.6,
      meleeArcDegLv1Scale: 0.6,
      /** 普攻命中半徑 / 衝撞命中半徑：Lv1 為現值的 0.6 */
      attackHitRadiusLv1Scale: 0.6,
      dashHitRadiusLv1Scale: 0.6,
      /** v21：普攻傷害隨等級成長：Lv1 為現值(player.attackDamage)的 0.6 → Lv10 = 現值 */
      attackDamageLv1Scale: 0.6,
      /** 5 招傷害：Lv1 為現值的 0.55 */
      skillDamageLv1Scale: 0.55,
      /** 5 招範圍（半徑/距離）：Lv1 為現值的 0.6 */
      skillRadiusLv1Scale: 0.6
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
    shapeIcons: { diamond: '◆', star: '★', heart: '♥', gem: '⬢' } as const,
    /** 每種形狀在中心區維持的目標數量（撿掉會補到此數）★v5:9→11 場上更充足、較不會找不到 */
    perShapeTarget: 11,
    /** 物件散佈的中心區半徑（離場地中心） */
    scatterRadius: 240,
    /** 物件體型半徑（撿取判定/顯示） */
    itemRadius: 16,
    /** 玩家/BOT 走路速度（像素/秒） */
    moveSpeed: 300,
    /** BOT 走路速度（★v3:250→190,比玩家300慢更多,玩家較有機會贏） */
    botMoveSpeed: 190,
    /** 撿取判定半徑（角色距物件多近可撿） */
    pickRadius: 40,
    /** 箱子半徑（放入判定 + 顯示） */
    binRadius: 40,
    /** 換告示的最短間隔（毫秒，避免搶太快狂閃）——v2 改固定定時換,此值保留但不再用於「丟對就換」 */
    signMinIntervalMs: 900,
    /** ★v2：告示定時換——v5 改【每次 9~12 秒隨機】(非固定,不規律)。保留 signIntervalMs 供參考不再用。 */
    signIntervalMs: 10000,
    /** ★v5：告示換間隔隨機範圍(毫秒),每次換完重算 nextSignAt = now + Between(min,max) */
    signIntervalMinMs: 9000,
    signIntervalMaxMs: 12000,
    /** ★v4：物件推力再降(110→70)+摩擦再增(11→15)→碰到只輕微挪一咪咪馬上停、幾乎不被推跑、立刻好撿 */
    itemPush: { maxPushSpeed: 70, friction: 15 },
    /** ★v4：位置校正拖行上限(px/幀)——限制「玩家走過去把物件推在前面」的拖行,即使一直走物件也只被撥開一點點(碰到幾乎不動),不會被拖著跑一整段 */
    itemPushDragMax: 1.2,
    /** BOT 反應延遲(毫秒,決策間隔)★v3:350→620 反應更慢、變弱 */
    botReactMs: 620,
    /** BOT 撿錯機率★v3:0.15→0.28 更常撿錯、變弱 */
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
    /** ★推人:範圍內最近的人被推;推飛距離;被推者失控(不能自主移動)時間;推的CD */
    pushRange: 90,
    pushDistance: 220,
    pushStunMs: 400,
    pushCooldownMs: 2000,
    /** ★v7:推人改「位移撞人」——按空白角色朝面向【短衝】一段(dash)去撞人,撞到才推飛。衝距離/衝時長(→衝速=dist/time)。 */
    dashDist: 110,
    dashDurationMs: 160,
    /** 被推飛的位移速度(px/s,pushStunMs 內帶著跑;約 pushDistance/stun) */
    pushKnockSpeed: 550,
    /** 被推慣性摩擦 */
    pushFriction: 5,
    /** ★預警圈難度遞增:間隔(出現頻率)ms 由 start→end 線性(越後越密);半徑;填滿時間(越後越短越難閃) */
    ringIntervalStartMs: 1500,
    ringIntervalEndMs: 500,
    ringRadiusStart: 70,
    ringRadiusEnd: 130,
    ringFillStartMs: 1600,
    ringFillEndMs: 750,
    /** ★同時並存的預警圈數(難度遞增:前期少、後期多)——維持這麼多圈,各自獨立填滿→爆(時間差錯開) */
    ringConcurrentStart: 2,
    ringConcurrentEnd: 5,
    /** 每次生新圈的最小間隔(錯開節奏,避免同幀一次生一堆同時爆) */
    ringStaggerMs: 350,
    /** ★角色間【被動身體推擠】的分離(輕、只防重疊,獨立於空白主動推飛) */
    bodySeparate: true,
    /** ★v3:預警圈生成——追人圈比例(0=全隨機,1=全追人)。每次生圈擲骰:命中→開在隨機存活角色附近(逼玩家一直動),否則純隨機 */
    ringChaseChance: 0.5,
    /** 追人圈落點相對目標角色的隨機偏移(px,預判/些許提前量) */
    ringChaseOffset: 60,
    /** 爆炸後火光環淡出/震動 */
    ringColor: 0xff3322,
    ringFillColor: 0xff5522,
    /** ★v2:爆炸畫面震動(單次)——強度/時長(從 0.006/160 減半降暈) */
    shakeIntensity: 0.003,
    shakeDurationMs: 120,
    /** ★v2:震動節流——此毫秒內多圈連爆只震一次(避免後期滿場連爆狂抖) */
    shakeThrottleMs: 260,
    /** BOT 決策間隔 ★v6:220→420 反應更慢(變弱) */
    botReactMs: 420,
    /** ★v6:BOT 閃圈的偵測邊際(px)——原碼寫死40,改用此值並縮小到18→BOT 較晚才反應閃、沒那麼準(變弱) */
    botDangerMargin: 18,
    /** ★v6:BOT 主動推人的機率(每次決策擲骰)——1=每次能推就推,降到0.45→較少主動推(變弱) */
    botPushChance: 0.45,
    /** ★v6:預備開始倒數(毫秒)——intro 按空白後進 ready 階段倒數,角色不動/預警圈不出/計時未起,倒數完才 playing */
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
    /** ★預備開始倒數(沿用推人生存):intro 空白→ready 倒數→playing */
    readyCountdownMs: 3000,
    /** ★場上維持的可撿炸彈數(撿掉/爆掉後補);生成間隔(補充節流) */
    groundBombTarget: 5,
    bombSpawnIntervalMs: 900,
    /** 炸彈半徑(顯示/撿取/飛行撞人判定用) */
    bombRadius: 13,
    /** 撿取判定半徑(靠近多近可撿) */
    pickRange: 40,
    /** ★丟:飛行速度(px/s)、最大飛行距離(到了就落地) */
    throwSpeed: 460,
    throwMaxDist: 340,
    /** ★落地後倒數多久才爆(給對手閃);地面預警圈 */
    fuseMs: 1500,
    /** ★爆炸:圓範圍半徑、擊退速度(px/s)、擊退失控時間 */
    explodeRadius: 78,
    knockSpeed: 460,
    knockStunMs: 350,
    /** ★連鎖引爆:爆炸範圍內其他炸彈跟著爆的深度上限(防無限);連鎖觸發延遲(視覺錯開) */
    chainMaxDepth: 6,
    chainDelayMs: 90,
    /** 震動(沿用降暈值) + 節流 */
    shakeIntensity: 0.004,
    shakeDurationMs: 130,
    shakeThrottleMs: 220,
    /** ★角色間被動身體推擠(防重疊) */
    bodySeparate: true,
    /** BOT AI:決策間隔(偏慢別太神)、丟人的距離(靠多近才丟)、閃避偵測邊際 */
    botReactMs: 380,
    botThrowRange: 260,
    botDangerMargin: 26,
    /** ★BOT 不自炸:只在「與目標距離 > explodeRadius+radius+此安全值」時才丟(否則太近丟了自己也在爆炸範圍);丟完退開 */
    botSelfSafeMargin: 40,
    /** 爆炸火光色 */
    explodeColor: 0xff6a1a,
    ringColor: 0xff3322,
    /** 角色顏色 + 名字 */
    colors: [0x4aa3ff, 0xff5a6e, 0x4ade80, 0xffd23f] as const,
    names: ['你 P1', 'BOT 1', 'BOT 2', 'BOT 3'] as const
  }
} as const;

/**
 * v14：依團隊等級把「Lv1 值 → Lv{cap} 值（=現用值 base）」線性內插。
 * lv1Scale 為 Lv1 佔 base 的比例（0.5~0.6）；level 會被夾在 [1, cap]。
 */
export function levelLerp(base: number, lv1Scale: number, level: number): number {
  const cap = GameConfig.level.cap;
  const lv = Math.max(1, Math.min(cap, level));
  const t = cap > 1 ? (lv - 1) / (cap - 1) : 1;
  const lv1 = base * lv1Scale;
  return lv1 + (base - lv1) * t;
}

export type GameConfigType = typeof GameConfig;
