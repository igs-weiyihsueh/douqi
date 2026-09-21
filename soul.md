# soul.md — 《鬥氣割草》(Douqi Cutgrass) 專案記憶

> 實驗性 H5 割草遊戲。俯視 2D 像素、**雙操作模式(快速滑鼠/慢速鍵盤)**、無盡刷分。
> 技術棧：**Phaser 3.80.1 + TypeScript 5.4 + Vite 5.2**。工作目錄 `/mnt/d/實驗H5`。
> 負責人：夜鶯（本 instance，程式手）。規格由海牛派任務。
> 最後更新：**2026-09-16（小遊戲×3 + Spine編輯器白邊 + 主戰鬥多項 + 寶箱怪 完成後）**。

---

## ★★★ 2026-09-16 累積（v62 之後的新工作，最新在最上）

> 工作流不變：改碼→`npm run build`(tsc+vite 過)→report_result 給海牛→海牛重啟 dev5174(WSL /mnt/d 無 HMR;但 **public/ 靜態檔即時 serve**)→本 instance headless(puppeteer) 真實輸入複驗→清 .cjs+npm uninstall puppeteer→回報。**未 commit**。★真實輸入(fleet decision 7a3acdf0):操作/物理/時序/命中/受擊必須 page.mouse(world→screen 映射)+page.keyboard,不可 evaluate 直接 set 狀態繞過(否則假 PASS)。

### 小遊戲框架 + 三個小遊戲(選單 G 鍵進入)
- **框架**：`src/minigames/registry.ts`(MINIGAMES 陣列 {key,name,sceneKey,desc,icon})+`MinigameMenuScene`(自動列卡片+方向鍵選/空白確認)。新增小遊戲=寫 Scene+main.ts scene 陣列註冊+registry 加項。獨立於 GameScene。
- **① 收集競賽 `CollectRaceScene`**：60秒收集告示指定形狀丟自己箱子比分,1P+3BOT。物件【可推開但微推】(itemPush maxPushSpeed70/friction15 + **itemPushDragMax1.2**限位置校正拖行→碰到幾乎不動好撿)、告示【9~12秒隨機換】(signIntervalMin/Max 9000/12000)、物件補充【每幀即時】(replenishItems 移到 update,perShapeTarget11)、**撿取提示 pickHint**(靠近可撿物件脈動高亮+連線)、結算方向鍵選、★時間到【聚光燈聚焦勝者(暗overlay+亮圈脈動+🏆+放大)停留1.8s→才結算】。BootScene collect-diamond/star/heart/gem 形狀貼圖。
- **② 推人生存 `PushSurvivalScene`**：4角色(1P+3BOT)閃地面預警圈,圈填滿爆炸圈內出局,最後活著勝。八方向【只移動不衝刺】。★空白【短衝撞人 startDash】(dashDist110/dashDurationMs160,衝的路徑撞到人→朝衝向推飛 pushDistance220/pushStunMs400;updateDashes 每幀位移+撞判,dashHit Set 每次衝每人只推一次;BOT 也短衝撞)。面向指示(faceX/faceY 圓圈+箭頭,移到 update 末端用最終位置畫→被推飛也跟隨)。預警圈【隨機+追人各半 ringChaseChance0.5】、多圈並存(ringConcurrentStart/End 2→5,ringStaggerMs 補圈,fill-up<180ms 快補到目標數)、震動降+節流(shakeThrottleMs)。難度遞增。3BOT【變弱】(botMoveSpeed220/botReactMs420/botDangerMargin18/botPushChance0.45)。intro→**ready 3-2-1 倒數(readyCountdownMs3000,不動/圈不出/計時未起)**→playing。★**第3人出局(剩1)→慢動作(slowFactor0.35約1.2s)決勝→恢復→結算**;60秒多人活→正常緩衝1s→結算。beginFinish+finishing 防重複、結算由 real-time delayedCall。
- **③ 炸彈人對戰 `BombArenaScene`**：4角色撿地上炸彈→朝面向丟→**撞人即爆/沒撞落地倒數爆(C方案,fuseMs1500)**→爆炸圓範圍(explodeRadius78)出局+擊退+**連鎖引爆(chainMaxDepth6)**+**手上炸彈被炸也連爆**→最後活著勝(60秒多人活平手)。地上炸彈維持 groundBombTarget5、撿(拿頭上可走,pickHint)、丟(throwSpeed460/throwMaxDist340,面向瞄準)。BootScene 'bomb'貼圖。3BOT AI:閃(飛來炸彈+倒數圈,含自己丟的)、撿、【不自炸:只在與目標距離>explodeRadius+radius+botSelfSafeMargin40 才丟,太近先退開】。ready 倒數同推人生存。★**第3人出局慢動作→結算**;**結束時序改 timestamp 驅動**(finishSlowEndAt/finishEndGameAt,update 每幀用 this.time.now 比對推進恢復 slowFactor+endGame,**不依賴巢狀 delayedCall**→根治「慢動作沒恢復=時間凍結永久卡」)+endGame 開頭防呆強制 slowFactor/tweens.timeScale=1。玩家最後被炸死剩1BOT/同時死0/BOT活到最後 都正常結束(8+種真實輸入情境驗過不卡)。

### Spine 場景編輯器(`public/editor/scene_editor.html`,遊戲中 iframe 開)
- 白邊/黑邊修正經歷:先試 straight-alpha(用戶看到黑邊,方向錯)→**回退按用戶正解=全預乘 PMA**:SPINE_PMA=true(renderer.premultipliedAlpha)、DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL=false(上傳貼圖預乘)+上傳路徑 new GLTexture 前 `gl.pixelStorei(UNPACK_PREMULTIPLY_ALPHA_WEBGL,true)`、blendFunc(ONE,ONE_MINUS_SRC_ALPHA)。三因子一致=預乘。★headless swiftshader 編不出 Spine shader→白邊肉眼需用戶真瀏覽器確認(caveat:全域 straight/pma,pma:true atlas 需另議 per-atlas)。★上傳 Spine「隱形角色」根因(前面修過):spine-webgl 4.x TextureAtlas 建構子只吃 1 參數(atlasText),忽略第2個 textureLoader→改 new TextureAtlas(atlasText) 後逐 page.setTexture(對應 GLTexture)。

### 主戰鬥(GameScene)新功能/修正
- **【實驗】三招表演時間 config.performanceTime{enabled,circle600,line600,burst1000}(原1200/1200/2000,用戶調短)**：施放圓/直/爆發→enterPerformance(c,ms)=設 c.skillLockUntil(Math.max 不縮短既有)→**沿用既有 skillLockUntil**(isSkillLocked 已 gate fast衝刺/tryAct + slow handleSlowMovement 移動 + isInvulnerable 含它=無敵)→角色【定身+無敵】,時間到恢復。enabled=false 一鍵拔(early-return 不設鎖)。爆發連打~880ms 後仍鎖到 burst 時長(收招硬直)。fast+slow 都涵蓋。
- **攻速 attackCooldownMs 160→300(0.3秒1下)**。
- **除錯熱鍵 L=秒滿等**：maxLevelCheat()→teamLevel=cap(10)+exp滿+LEVEL MAX提示+emitStats,三招 unlockLevel(圓2/直4/爆發6/強化1)全解鎖。綁 GameScene.create() 內→只主戰鬥有效,小遊戲/選單/編輯器不誤觸。L 全專案無衝突。
- **塔事件加限時**：config.event.tower.timeLimitMs40000;towerEndsAt=now+limit;updateTowerEvent 時間到未打掉塔→completeEvent(false)(沿用事件收尾:撤塔/清扇形/停出怪/不給獎勵/進下一波,乾淨不卡);倒數 UI 沿用 event-hud remainMs(UIScene 顯示 X.Xs)。打掉塔完成路徑不變。
- **★BOT 與 P1 完全無差異**：onComboHit 移除「c!==player→只 gainSpiritHit」分岔→**所有角色跑連段技 combo 系統**(命中累積 spirit→3圓/6直/9爆發/10強化,依 teamLevel 解鎖;p1AttackHits/emitStats 仍只P1)。comboEmpower slow 判定改「模式=slow」(不再限P1)→BOT slow 走 empowered 旗標。能量倒退解除迴圈改對【所有角色】。createCharacter 在 slow 對每角色 noHpLoss=true(slow BOT 打不死;fast 會死)。移除 tryAct+updateBot 舊「BOT spiritFull→原地爆發」(改由連段系統觸發防雙觸發)。BOT 放招也套 skillLockUntil 定身無敵(update 迴圈 isSkillLocked 跳過 updateBot/handleDash)。數值全走共用 config 無弱化(GameConfig.bot 只剩 AI 決策節奏)。slow 全員 noHpLoss→GameOver 本就不在 slow 觸發(靠波次推進,同修前 P1),不卡;fast 全員(含BOT)死→GameOver 相容。
- **★衝刺撞 BOSS 沒傷害 bug 修**：根因 `findFirstEnemyInRangeOf` 命中判定用【中心距離≤dashHitRadius】沒算敵人 body 半徑→BOSS(r42)/塔(r34)站著時玩家衝到外緣中心距離>門檻→判定不到→撞外緣停下但沒 performAttackOn→不扣血。修:命中門檻改【radius+enemy.getBodyRadius()】(edge-to-center),以 dist-reach 最小挑最貼身。小怪 body 小不受影響。兩 caller(handleDash 命中 + BOT findNearestEnemyTo)受惠。

### ★寶箱怪(treasure,主戰鬥新稀有怪) — 完成
- **Enemy type 'treasure'**(EnemyType 加)+config.enemy.types.treasure(金色/spawnWeight0)+**config.enemy.treasure{spawnChance0.2,hitsToKill20,pauseMin/Max1500/2500,moveSpeed620,lifetimeMs10000,coinsPerHit4,coinsOnDeath40}**。Enemy 加 treasureHits/SpawnAt/PauseUntil/MoveTX/TY/Fleeing 欄位;spawn 給大 HP(改用命中次數死);updateAI 對 treasure 不跑一般 AI(交 GameScene)、telegraph 結束自動 materialize;不被 applyKnockback 推。
- **GameScene**：`trySpawnTreasure`(spawnFormation 末呼叫,roll spawnChance,場上已有則不生=**只1隻**,生場內隨機點避玩家)、`updateTreasure`(每幀:金色 tint 脈動閃爍 / **跑點移動**:停頓靜止→挑隨機點以 moveSpeed620 快速衝→到點排停頓1.5~2.5s→再衝 / **限時10秒未死→朝最近牆外衝+淡出移除**)、`hitTreasure`(命中+1+噴少量金幣+顯示剩餘數,達20→kill+噴大量金幣40+金環+震動;跑走中被打→直接消)、`spawnCoins`(金幣拋物線噴散,純視覺不進道具/經驗/計殺/波次)。damageEnemy+damageEnemyFrom 對 treasure 都導向 hitTreasure→**普攻/衝刺/圓/直/爆發命中都算1下**。不計 waveQuota/不 onWaveKill/不攻擊玩家/resetState 清參照。BootScene 'enemy-treasure'金色寶箱+'coin'金幣貼圖。expMultiplierByType.treasure=0。
- 真實輸入驗 6 項全 PASS(金光/跑點620/命中噴金幣/20下死噴40/10s跑走/只1隻)。

### 目前待命
- **4關×A/B=8場景變體系統(全程式繪製,黃土荒城+熔岩火山)= 任務 mkx17a,用戶說【暫緩先別動工】,待命中**。設計:移動區(現有 arena 邊界)4關地貌各異(龜裂黃土/熔岩裂縫/焦黑廢墟/火山岩盤)、A/B 只差移動區外遠景(A荒城天際線/B火山噴發)、Phaser 繪圖(漸層/幾何/程序點綴/粒子)、先畫8個+手動切換預覽(不做隨波次自動切)。開工前確認:arena 邊界取現有 arena field。
- 上一批(寶箱怪+炸彈修)已 PASS + 海牛 build+push 固定網址(線上 index-D7JjIWQq.js)。

---


## 目前狀態（截至 v62，最新）

- **build**：`npm run build`（tsc --noEmit + vite build）通過，僅 Phaser chunk>500kB 警告（非錯誤）。**未 commit**（依慣例，git 由用戶自理）。
- **可玩性**：完整循環可跑，每版 headless(puppeteer) 或用戶自驗後回報。

### ★★ v51~v62 累積重點（在 v46+ 雙模式基礎上）

**v51 攻擊不動目標不重疊 + 時停周圍來回**：`isImmovableLargeTarget`(boss||tower)、`standoffMeleeAttack`(鎖BOSS/塔停外緣原地揮不衝進中心，tryAct+actByAim兩路徑)。時停單目標穿梭落點改目標周圍環(orbitOffset70)、命中判定仍以目標為圓心。

**v52~v54 慢速鎖定演進**：v52 曾收窄成「只鎖面向35°錐」(做反了)→v54 **重做定案**：`updateLockTarget` slow 分支＝黏著式——已鎖且目標存活在圈內就維持(不因面向轉離脫鎖、不每幀重搶)；取得鎖定=`pickAimConeTarget(35°錐,面向對著優先) ?? pickNearestInCircle(圈內最近,不限角度)`；圈內完全無敵→null(按空白 startDirectionDash 朝面向衝)。主動面向對準更準的敵才切目標。→「圈內有敵就鎖、面向對著優先、不翻轉」。(config.slow.unlockAngleDeg 已移除)。v53：慢速被逼牆邊面向朝外時 startDirectionDash 的 dest 被 clamp 成原地=0px 死鍵 → 修：reach<玩家半徑16 時改原地 performMeleeArc(只slow)。

**v55 COMBO/能量拆兩套(★只慢速 controlMode==='slow'、fast 完全原樣)**：
- COMBO(c.spirit)：命中+1，3圓/6氣波/9爆發(各需解鎖 unlockLevel)，**v56 歸零門檻=已解鎖最高招門檻**(`slowComboCap()`：Lv≥6→9、≥4→6、否則3；爆發後歸零)。
- 能量(c.energy 0~10)：命中+1、被打-1、滿10自動 comboEmpower、強化期間每幀 -drainPerSec(**v57:10/3≈3.33→約3秒**)倒退到0解除(empowered 布林旗標)。強化中純倒退不+。
- ★拔血量A(慢速)：`c.noHpLoss=true`(slow P1 init)→takeDamage 不扣血不死、只 energy-1；慢速無血條(HUD panel+腳下)、無死亡/GameOver(通關 triggerClear 維持)。
- fast 維持：一條 combo 3/6/9/10、empower 用 `c.empowerUntil` 時間戳(**v57 durationMs 5000→3000=3秒**)、正常扣血死亡復活。`isEmpowered`=`empowered||time<empowerUntil`。
- HUD(UIScene) 依 `s.controlMode` toggle：slow=「COMBO」條(3節點)+金色「能量」條(強化中倒退顯示「強化中」)+無血條；fast=「連段」條(4節點3/6/9/10)+強化倒數+血條。
- **v57 慢速掉落排除補血H**：`pickDropSkill` slow 時 skills 去掉 'H'(慢速無血量)；fast 維持有 H。

**v56 怪不推角色(B方案)**：`separateCharacterFromEnemies` 反轉成推怪(角色位置不動、怪被擋外圍)。快慢速共用。config.player.separatePush 停用。

### ★ v57~v62 可打破物件系統（Breakable，木箱+爆炸桶）
**檔案 `src/objects/Breakable.ts`**：純顯示 sprite(**無 physics body**)，`kind:'crate'|'barrel'`、`hp`、`dead`、`vx/vy`(推動)、`fusing`(桶倒數)。`hit(amount)` 扣hp回傳是否破(fusing/dead 不再被打)。`spawnBreakable(x,y,kind)`。群=`this.add.group`(普通群，非 physics)。
- **命中/分離全用距離數學**(不依賴 Arcade body——circle collider 高速會 creep 穿透，踩過雷)。
- **生成 `spawnBreakablesForWave()`**(開場 create + 每波 intermission→spawning)：木箱成堆 clustersPerWave3×perCluster4(堆內不互疊 minGap≥直徑)、遠離中心 **minDistFromCenter150**(v60)、避玩家；爆炸桶 barrel.perWave2、**彼此 minBarrelSpacing200**(v62，≥explodeR×1.5→幾乎不連鎖)、不與現有物件疊。
- **打破途徑**：普攻扇形 `hitBreakablesInRange`(扣atk，木箱2-3下)、衝刺 handleDash(**一撞即破/引爆99999**)、道具招/連段招 AOE `breakBreakablesInCircle/InRect`(**v60 秒碎**不管hp、**掉落上限 maxDropPerBreak1**/次)。接到的招：普攻/衝刺/圓形斬/氣波/爆發/旋風A/落雷B/居合C/震爆E/噴火F/時停連斬。木箱掉道具 dropChance0.06。
- **v59/v60 木箱碰撞(可推動見v62)**、**hp80**、道具招破箱、怪也擋(v60，防卡死：只位置分離不動AI)。
- **v61 爆炸桶(barrel)**：橘紅桶+黃危險條紋貼圖(breakable-barrel)。打破→`explodeBarrel`：火光圈+核心+粒子+閃白+強震；範圍(explodeRadius120)內【怪】低傷(explodeDamage26)+朝外一次性強位移擊退(knockback130，炸飛)、boss/tower/anchor/npc不擊退；【玩家】damageCharacterFrom(fast扣血/slow只energy、**不擊退**)；連鎖引爆其他桶(depth上限 maxChainDepth3)；掉道具 barrel.dropChance0.03。
- **v62 三改**：①桶彼此拉遠 minBarrelSpacing200(幾乎不連鎖)②打破桶→**startBarrelFuse**(fusing旗標+地面紅警示圈填滿閃爍跟隨桶+桶閃紅)→倒數 fuseMs800→才 explodeBarrel(怪/玩家可閃避)③**木箱+桶可推動(反轉 immovable)**：`blockCharacter/EnemyFromBreakables` 改成推【物件】(給 vx/vy)、`updateBreakables(delta)` 每幀速度整合+摩擦(friction6)停+邊界clamp(推到牆停、該軸速度歸零不穿牆)+物件兩兩分離(不疊)。衝刺仍打破(不推)、攻擊命中破，「推」只在非攻擊走路/怪碰。可把爆炸桶推到怪群再打破。
- **config.breakable**：hp80/radius16/clustersPerWave3/perCluster4/minDistFromCenter150/maxDropPerBreak1/color棕；`.barrel`{hp40,perWave2,explodeRadius120,minBarrelSpacing200,fuseMs800,explodeDamage26,knockback130,maxChainDepth3,dropChance0.03,橘紅色}；`.push`{maxPushSpeed180,friction6}。
- **debug**：`debugBreakables()`(count/barrels/list含kind)、`debugSpawnBreakableAt(dx,dy,kind)`。

### v34 及更早玩法快照（基礎，仍現行）
- **關鍵檔案**：`src/config.ts`(所有數值)、`src/scenes/GameScene.ts`(主場景/招式/事件/波次/BOSS/雙模式)、`src/objects/Enemy.ts`(敵人狀態機/shiftTimers)、`src/objects/Character.ts`(角色/定身視覺rootMark)、`BootScene.ts`(貼圖)、`UIScene.ts`(HUD/aimGraphics)、`TitleScene.ts`(開始介面鍵盤選模式)、`GameOverScene.ts`(結算/通關,帶controlMode重開)。

### ★★ v46+ 雙操作模式（controlMode: 'fast' | 'slow'）
- **TitleScene 選模式**：兩鈕「快速/慢速」，**←→/WASD 移動黃色選中框、空白鍵確認**進入(也可滑鼠點)。scene.start('GameScene',{controlMode})。GameScene.init(data) 收。
- **快速模式(fast=現況原封不動)**：滑鼠融合瞄準(autoLock=false)、指敵/道具鎖定或指空地走位、衝刺移動攻擊合一、player.speed=0。
- **慢速模式(slow)**：純鍵盤。方向鍵/WASD 八方向【持續移動】(config.slow.moveSpeed220、正規化對角線、非瞬移)、角色面向=移動方向(複用 c.aimAngle)。角色周圍【藍色範圍圈】(slowTuning.lockRadius)內敵人自動鎖定(複用 pickAimConeTarget(c, searchR, limitAnchors=true)、方向源=facing)。空白鍵攻擊=衝刺(共用 fast 的 tryAct→startDirectionDash→handleDash→performAttackOn/onComboHit)。
  - **鎖定黏著(v50 修)**：已鎖且目標存活在圈內→只有面向轉離「當前鎖定目標方向」>unlockAngleDeg(100°)才脫鎖；無鎖→面向錐(35°)選、錐內無則遞補圈內最接近facing(限前方100°內) pickNearestInCircleToFacing→殺敵自動接下一隻不用重轉面向；面向對準另一隻更準的怪可換目標。(修好了「殺敵後黃箭頭變兩個+閃動」的lock每幀翻轉bug)
  - **★慢速即時調參面板(v47/v48)**：controlMode==='slow' 時右側垂直面板(避開HUD)，三列 −/+ 滑鼠按鈕即時調 this.slowTuning{lockRadius/dashDistance/dashSpeed}(runtime可變，遊戲讀這組)。慢速預設(v51定案)：**lockRadius140 / dashDistance100 / dashSpeed400**。範圍(lockRadius60~500 step20、dashDistance80~600 step20、dashSpeed400~2200 step100)。fast 用 GameConfig.aim.dashDistance/player.dashSpeed 常數【不受影響】。
  - **v49**：慢速拿掉「延長瞄準線」(UIScene.updateAim 的 dashLine，emitAim showDashLine=(controlMode!=='slow'))；fast 仍畫。

### v35~v45 重要變更（累積現行）
- **v40(2) 限時強化**：不放大改 empowerOrbit 金光環+脈動圈(取代 scale)。damageMult1.8/rangeMult1.5/dashSpeedMult1.5。**v41 修強化衝刺牆邊震盪**(clampToArena 撞界即 endDashState + 停止門檻隨速度放大)。
- **v42 10關循環**：wavesPerCycle10、isBossWave wave%10(第10關BOSS壓軸)、eventWaves[3,5,7]、preBossWaves[8,9]×preBossQuotaMult1.5、quotaCap90、expToNext總2200(約7-8關Lv10)。通關 triggerClear→GameOverScene won金字。
- **v42 塔改四大扇形→v45 arcDeg48**：fanBlast count4/arcDeg48(縫42°)/radius520/fillMs2000/cycleMs3200，正十字(0/90/180/270)↔斜十字(45/135/225/315)交替，填滿預警→發射，命中距塔≤520且角度±24°。塔起點貼緣(radius34+startGap8)。
- **v43 守護 NPC**：npcHp1600、可被衝刺【穿越】(findAnchorInDashPath skip guardNpc)、不可鎖/攻。
- **v41 佔領**：captureRadius340、圈內存活怪==0(殺或推出都算)才隔waveGapMs1800出下波、progressPerSec12、timeLimitMs45000、spawnInsideRatio0.85。
- **v44 道具鎖定(不磁吸)**：pickAimConeTarget 納入道具候選(itemAimPriorityMult0.7略優先)、鎖到道具衝去撿(overlap)、BOSS道具掉遠(dropDist170)、互搶resolvePickups原子結算保留。
- **v45 時停**：單目標循環穿梭連斬多段(hitCount×dmg)、0敵不觸發不消耗、★時停凍結敵人蓄力(全域時移:解除當幀 Enemy.shiftTimers(frozenDur)後移所有絕對時間戳+塔/BOSS時間戳、暫停/resume蓄力tween telegraphFx)。
- **v45 蓄力中被打死清特效**：telegraphFx 登記表(塔fanBlast/BOSS招fill)、clearTelegraphsOf('tower'|'boss')(塔死兩條擊殺路徑damageEnemy+damageEnemyFrom都清)。
- **v45 定身**：塔扇形/BOSS招命中→damageCharacterFrom rootMs=2000→rootedUntil=max(現有,now+2000)完整定身(禁移動+衝刺+攻擊)。視覺:Character rootMark「定身!」字+rootRing青鎖鏈環+青灰染色。BOSS招走bossReleaseDamage(skillRootMs2000)、gap粉紅球rootMs=0不定身。
- **v42/v45 BOSS**：四招輪替 Enemy.ts kinds=['a','c','d'] bossAttackIndex%3(b已移除)。招間隔從釋放完起算。四錨點走位【現關閉】bossAnchorsEnabled=false(程式保留)。

### ★ v51 攻擊不動目標不重疊 + 時停周圍來回（快慢速都改）
- **isImmovableLargeTarget(e)=isBoss||enemyType==='tower'**(不含anchor/一般怪)。**standoffMeleeAttack**：鎖定BOSS/塔時停外緣(目標半徑+玩家半徑+6)原地揮、不衝進中心；已在範圍內只在重疊時退外緣否則原地不動、範圍外衝刺終點設外緣。tryAct(慢+共用) 與 actByAim(快) 兩路徑都接。一般怪維持衝上去打。
- **時停單目標**：skillTimestop 每次穿梭落點改【目標周圍環上來回點】(orbitOffset70、偶奇兩側交替+旋轉、面朝目標)，命中判定仍以目標為圓心(連斬多段不變)→不疊在目標身上。快慢速共用。

### v34 及更早玩法快照（基礎，仍現行）
- **場景流**：BootScene → TitleScene(按下才開打) → GameScene + UIScene；GameOverScene(全滅結算，顯示總擊殺/存活時間/P1普攻命中次數，空白鍵重開)。
- **操作**：滑鼠瞄準；空白鍵/點擊=攻擊；B 加 BOT(最多4)；R 復活P1；T 重開一局；**N=作弊清場並完成當前波次/事件**。
- **★瞄準(v30 融合模式, config aim.autoLock=false 為預設)**：滑鼠方向錐形(±aimConeDeg 35°, searchRadius 內)有怪→自動鎖定朝那隻打(黏敵、滑鼠可切目標)；錐形內無怪(指空地)→朝該空方向自由衝刺走位(不被拉回怪)。autoLock=true 可切回舊純黏著。保留衝刺遇敵停下+貼身扇形。
- **人型角色**(char-0..3)、4人共玩、僅剩P1時P1死不進結算可R救。
- **普攻**：近扇形/遠衝撞、帶位移追砍。傷害隨等級(player.attackDamage 36, Lv1×0.6→Lv10)。
- **★連段技系統(v31/v32, 僅P1)**：普攻命中累積 combo(取代舊鬥氣)，達門檻觸發「已解鎖」技，到 10 歸零：
  - 命中 **3→圓形範圍技**(Lv2解鎖, 瞬發圓AOE)
  - 命中 **6→直線範圍技**(Lv4, 朝aimAngle瞬發矩形貫穿)
  - 命中 **9→爆發**(Lv6, 原本的原地無敵多段亂打 triggerBurst)
  - 命中 **10→限時強化狀態**(Lv1就有, ★不是原地亂打)：5秒 無敵+攻擊力×1.8+範圍×1.5+**角色可正常操控移動**+金色染色+scale×1.4(碰撞body不變)+持續金光環+HUD倒數。到10歸零。
  - BOT 維持舊鬥氣爆發(spirit滿10觸發)、不套連段。HUD 連段條4節點(3/6/9/10 ◯/—/爆/★, 已解鎖亮未解鎖灰)。
- **6招道具(吃到觸發)**：A旋風斬(v27改**放置式**: 施放不鎖角色、可自由移動, 在施放座標放3秒地面旋風場DOT每200ms, 可同時多個) / B天降雷擊 / C居合(往最密集敵方向切 v28, distance1300/hitRadius55/寬斬擊帶) / E震爆 / F火焰(**十字**四方向火道+燒灼 v25) / T時停。**H補血**(+40只補自己)。道具互搶+多色點。**場上道具上限 5**(v25)。
- **等級制**：團隊共用經驗/等級(cap10)。v32 expToNext 總 **2550**(約第6波達Lv10)。等級=強度(敵HP/傷害縮放)+角色成長；波次=量與怪種解鎖(雙軌)。
- **★波次制(v27)**：每波清固定 quota(baseQuota12 + (N-1)×6, cap80)才過關 → intermission(2500ms)→下一波。狀態機 spawning→clearing→(boss/event/intermission)。**intermission 期間凍結**強化倒數與道具消失倒數(v34)。怪量同時上限 curMaxAlive(含單人 soloMaxAliveCap **35**)。
- **怪種依波次解鎖(unlockByWave)**：normal1/tank2/shielder4/bomber5/shooter6(charger不列)。normal spawnWeight **75**(雜兵多), tank12/shielder6/shooter10/bomber8。tank maxHp **200**、shielder **100**、normal90、shooter45、bomber60。
- **敵種行為**：normal/tank/shielder 巡邏警戒+蓄力(chargeMs **950**, alertRadius460/loseRadius560/loseGrace2000, 由內而外填滿紅圈預警)；**shooter**=蓄力直線雷射(laserChargeMs **2500**, 被打中斷)；**bomber**=**定點不動**朝玩家落點蓄力投彈(落點紅圈預警+爆炸)；charger 休眠。
- **★BOSS波(v28, 每5波)**：清完小怪→BOSS登場(打倒才過關)。高HP(baseHp3000×(1+(隻數-1)×0.6)×等級縮放)、上方血條、三招輪替(近身橫掃/召喚小怪/投彈)、擊殺大爆炸+掉4道具。**BOSS不被擊退**(v34)。
- **★三事件(v33/v34, 每3波非BOSS波輪替 tower→guard→capture)**：清完小怪→啟動事件→完成才過關+獎勵(掉4道具+經驗)。事件期間持續生怪無視配額。HUD event-hud 進度/倒數條。
  - **塔事件**：中央塔(可鎖可打、**不被推**)。每3.5s放一輪**三個中空環**(甜甜圈)衝擊波、**由內而外填滿預警**(fillMs900)、**三環依序擴大**(rings[40-130,150-260,280-400], ringGap700)；環帶命中→扣血+**定身3秒**(rootedUntil, 不能移動/攻擊)。打掉塔完成。
  - **守護事件**：中央NPC(**不可鎖定**, npcHp500)。持續出怪(每550ms×2隻)湧向中央、接觸NPC扣血。撐過30秒NPC存活→成功；NPC死→失敗(過關無獎勵)。
  - **佔領事件**：中央圈(captureRadius160)。玩家站圈內進度增(8/s)；圈內敵人越多越慢(×max(0,1-數×0.15), ~7隻停滯)；滿100完成。持續出怪。
- **HUD**：上方(團隊擊殺+時間+加夥伴+等級條)+左上(命中X計數+連段條)+右上(WAVE N X/quota)+中央(BOSS血條/事件條)+下方4欄面板+角色腳下小條。

### 效能(v17.1)
- 時停/爆量結算分幀(timestopSettlePerFrame=10)、全域特效節流 maxActiveFx=40、死亡粒子6。
- 爆發 hitstop(v26)：每段命中短暫 physics.world.pause + 真實時鐘 setTimeout resume(不動 timeScale, 有 try/catch + GameOver 強制 resume, 不卡死)。

---

## 服務運維（重要，WSL 環境）★v29+ 已改由海牛 host

- **dev server 現由海牛 host 在常駐 tmux session `agend`**（本 instance 自己起的背景進程會被 reap，**不要自己起 server**）。
  - 正解（掛進持久 session，不是 new-session）：`tmux new-window -t agend -n dev5174 'cd /mnt/d/實驗H5 && npm run dev -- --port 5174 --strictPort 2>&1 | tee /tmp/dev5174.log'`（見 project decision）。
  - **WSL(/mnt/d) 無 HMR** → 每次改碼後海牛需 kill 舊 dev5174 window 重開才 serve 新碼。
- **本 instance 工作流**：改碼 → `npm run build`（tsc+vite 過）→ **report_result 給海牛**（含改動檔案/新舊值）→ 海牛重啟 dev5174 → 本 instance **headless 複驗**（puppeteer, 打 http://localhost:5174, ★分短支腳本避免 CLI 卡 Thinking）→ 清理(刪 .cjs + npm uninstall puppeteer) → 回報結果。**未 commit**（依慣例）。
- **cloudflared**：`/tmp/cloudflared` + `--protocol http2`（QUIC 會 timeout）。斷了海牛重開換新網址。本地 5174 一直正常，複驗照打 localhost。

## 除錯掛鉤（保留，無害，供自動化測試）

- `window.__game` = Phaser.Game 實例（main.ts 掛上）。
- 常用：`debugState()`(gameOver/timeStopped/wave/waveState/level/combo/…)、`debugSetWave(n)`、`debugSpawnBoss()`、`debugBossSkill('a'|'c'|'d')`、`debugTriggerEvent('tower'|'guard'|'capture')`、`debugEventState()`、`debugSpawnProbeAt(distFromP1)`(生1隻正確 telegraphing=false 的可傷怪)、`debugTriggerSkill('A'|'B'|'C'|'E'|'T')`、`debugDropItem(x,y)`、`debugLockInfo()`、`debugP1Pos()`、`debugForceGameOver()`。
- **慢速模式測試**：`controlMode`、`slowTuning{lockRadius,dashDistance,dashSpeed}`、`lockedTarget`、`pickAimConeTarget`/`isLockableEnemy`/`isVulnerable` 可從 GameScene 讀。TitleScene 有 `selected`/`highlightRect`/`hlPos`/`selectMode`。
- **測試法**：`npm install --no-save puppeteer@23`(內建 Chromium)、寫短 .cjs、`page.evaluate` 讀 __game。★真實輸入(fleet decision 7a3acdf0)：操作/物理/時序【必須 page.mouse.move(world→screen 映射: setViewport 1280×720 canvas 1:1、rect=canvas.getBoundingClientRect()、sx=rx+wx*(rw/gw)) + page.keyboard】，不可 evaluate 直接 set 狀態繞過(否則 headless PASS 但實機 bug 依舊)。★分短支(一支驗一項)避免 CLI 卡 Thinking。逐幀取樣用頁面內 requestAnimationFrame(避免 puppeteer sleep 錯過幀)。測完 `npm uninstall puppeteer`(package.json 勿留 puppeteer:0)、刪 .cjs/.png。headless `--no-sandbox`、goto `waitUntil:'domcontentloaded'`。
- **選慢速進遊戲(測試)**：TitleScene 按 ArrowRight(選慢速)→Space；選快速直接 Space。

---

## 專案結構與各檔職責

```
/mnt/d/實驗H5
├── index.html            # 進入點（16:9、touch-action none）
├── package.json          # deps: phaser 3.80.1 / devDeps: typescript 5.4.5, vite 5.2.11
├── tsconfig.json         # strict, noUnusedLocals/Parameters（注意：as const 的數字欄位是 literal type，
│                         #   類別欄位若賦值 config 數字要標 `: number` 否則 TS2322）
├── vite.config.ts        # base './', server port 5174, host true
└── src/
    ├── main.ts           # Phaser.Game 初始化（Scale FIT + CENTER_BOTH），掛 window.__game
    ├── config.ts         # ★ 所有可調數值集中於此（見下）
    ├── objects/
    │   ├── Character.ts   # P1 與 BOT 共用角色類別（hp/spirit/kills/衝刺/爆發/skillLock/dashShield）
    │   ├── Enemy.ts       # 5 種敵人類型 + AI 狀態機
    │   ├── Item.ts        # 道具（掉落/存活/拾取；SkillType 'A'|'B'|'C'|'E'|'T'）
    │   └── Bullet.ts      # shooter 子彈（目前 shooter 權重 0 未生成）
    └── scenes/
        ├── BootScene.ts   # 程序化產生所有貼圖（char-0..3 / enemy-<type> / item-<A..T> / bullet / ground / spark）
        ├── GameScene.ts   # ★ 核心：角色/敵人/道具/子彈/招式/生成/鎖定/時停/邊界反彈/結算（~55KB 最大檔）
        ├── UIScene.ts     # HUD（4 角色血/鬥氣/擊殺條、團隊總分、攻擊鈕、瞄準圓環+指示線、加BOT提示）
        └── GameOverScene.ts # 結算 + 重新開始（乾淨重啟，已修 bug）
```

---

## 核心玩法（現行 = v13）

- **視角**：固定視角鬥技場，16:9（1280×720），鏡頭不跟隨；場地 = 畫面內縮 padding48，四周圍欄線框。
- **角色**：本地 4 人共玩。開場只有 **P1**（玩家操作）；按 **B** 逐一加入 BOT（最多湊 4，只加不移除，滿了無效）。各角色獨立 hp/spirit/kills，個別陣亡（灰掉），**全滅才 game over**。
- **操作（P1）**：純滑鼠瞄準 + 攻擊鈕/空白鍵。**自動鎖定**：滑鼠有動→鎖箭頭方向最合適敵人(距離+角度評分)；滑鼠靜止→鎖最近敵人。**方向永遠由鎖定目標決定，滑鼠只選鎖誰**（v3 打架問題的解法）。鎖定目標身上有金色鎖定標記(圈+角標)。
- **普攻（帶位移追砍，按一下打一下）**：朝鎖定目標——近(≤melee.range90)→小位移貼身+扇形劍氣(arc90°/radius110)；遠→衝撞位移(dashDistance)遇第一個敵人停下打+衝擊特效；無鎖定→朝 aimAngle 空揮小衝。連按=追著敵人前進。
- **鬥氣**：每擊 +5、上限 100，集滿按攻擊→**原地爆發**(hits16/dmg22/radius140/擊退480，期間無敵、結束歸零)。
- **衝刺護盾**：遠距衝撞衝刺期間角色無敵(dashShielded)+青色光環，衝刺結束消失。近戰扇形不給。
- **敵人（AI）**：normal(近戰蓄力,權重52) / tank(肉盾高HP慢速,12) / shielder(正面減傷需繞側背,14)。**shooter(遠攻)/charger(衝鋒)目前 spawnWeight=0 暫停生成**(程式保留)。都走「場內出生+登場提示(telegraph 半透明閃爍420ms,期間不可傷/不可被打)」。敵人鎖定「最近的存活角色」。
- **生成**：持續制，每隔 interval(初始1700→最小650) 丟一組隊形（方陣 NxN / 環形包圍圈，各半機率），依 spawnWeight 權重混編；maxAlive 640。
- **道具（稀有）**：打死敵人 1.5% 機率掉、無保底、存活14s；碰到直接拾取觸發 5 種招式之一（A/B/C/E/T 隨機）。**無護盾（v9 護盾機制已於 v11 移除）**。
- **招式（v13：演出化，施展期間無敵+玩家不可操控 skillLock）**：
  1. 旋風斬 whirlwind：原地自轉+多段捲擊。
  2. 天降雷擊 thunder：轉向瞄準+蓄力→沿方向依序落雷。
  3. 居合貫穿 iaido：預備→高速突進貫穿+殘影斬線。
  4. 全屏震爆 shockwave：跳起→往下砸→落地全屏衝擊波。
  5. **時間暫停 timestop（v13新）**：全場敵人+BOT+子彈凍結1.5s，角色瞬移穿梭最多6隻敵人(殘影)，結束統一結算高傷220+打飛700。
- **邊界反彈（v13）**：敵人被擊飛撞邊界→clamp 回內側 + 反向速度×0.6，不飛出場外。適用所有擊退來源。
- **打擊感**：命中閃白 + 傷害數字跳字 + 擊退。**震動只在爆發/招式**時（shakeOnce 保證同時最多一個，不疊加）。擊退力380、敵人被擊退硬直 knockbackStunMs 500。
- **計分**：各自擊殺 + 團隊總擊殺(HUD)；結算顯示團隊總分+存活時間+各自擊殺。可重新開始（乾淨重啟）。

---

## 關鍵實作重點 / 踩過的坑

- **重開 bug 根因（v11~v12 修）**：
  1. Phaser **重用同一 scene 實例**，屬性不會自動歸零 → `GameOverScene.restarting` 旗標第一次後永遠 true。修法：`create()` 開頭重設 `restarting=false`。
  2. **UIScene.rows 陣列殘留上一局已銷毀的 Text** → 重啟後 updateStats 對已銷毀 Text setColor → Phaser 讀 null glTexture 崩潰、遊戲凍結（這才是「重開沒反應」真兇，靠瀏覽器實測才抓到）。修法：`UIScene.create()` 開頭 `this.rows=[]`（與 burstReady=false）。
  3. triggerGameOver 改用 `this.scene.stop()`（非 pause），避免暫停中的 GameScene SPACE 攻擊鍵搶結算畫面事件；停場景前 `tweens.killAll()+time.removeAllEvents()` 清殘留回呼。
  4. GameOverScene 用具名 handler 綁 SPACE/pointer，SHUTDOWN 時 off+removeKey。
  - restart 流程：stop UIScene → start GameScene(重跑 create) → launch UIScene → stop 自己。
- **as const 的 config**：類別欄位若初值來自 config 數字，要標型別 `private currentSpawnInterval: number = ...` / `hp: number = ...`，否則被推成 literal type 導致 TS2322。
- **不打架的鎖定設計（v12）**：攻擊時才把 `c.aimAngle` 設為「角色→鎖定目標」，滑鼠 pointermove 只更新候選瞄準角 + lastPointerMoveAt(選目標用)，不直接驅動位移。
- **skillLock（v13）**：`Character.skillLockUntil`；`isSkillLocked(time)` 讓 update() 略過該角色 tryAct/handleDash（不可控）、`isInvulnerable` 納入（無敵）；演出由 tween/timer 播完自動到期解鎖。
- **時停凍結（v13）**：`timeStopped` 旗標 → updateEnemies 對敵人 setVelocity(0) 且不跑 AI、updateBot 因 skillLock 略過、updateBullets 凍結；施展者本身在 skillLock。

---

## config.ts 主要區塊（數值以程式為準，此為索引）

- `width/height` 1280/720；`arena` { padding48, borderThickness6, borderColor, **bounceRestitution 0.6** }
- `player` { maxHp100, radius16, attackDamage25, dashSpeed1400, **knockback380**, attackCooldownMs160, invulnMs600, attackHitRadius42, **dashShieldInvuln true** }
- `spirit` { gainPerHit5, max100 }
- `burst` { hits16, intervalMs55, damagePerHit22, radius140, knockback480, invuln true }
- `characters` { count4, colors[青/綠/橙/粉], labels[P1/BOT×3], spawnSpreadRadius90 }
- `bot` { attackIntervalMs420, attackJitterMs180, targetSearchRadius520, wanderSpeed160, burstUseChance1 }
- `enemy` { engageRange40, **knockbackStunMs500**, chargeMs650, attackRadius46, attackDamage12, attackCooldownMs1200,
    shielder{frontDamageMult0.15,frontConeDeg70}, shooter{...bullet...}, charger{...dash...},
    types{ normal(hp130,spd70,r14,w52) / tank(hp460,spd40,r22,w12) / shielder(hp220,spd58,r16,w14) / shooter(w0) / charger(w0) } }
- `spawn` { initialIntervalMs1700, minIntervalMs650, intervalDecayPerSec16, maxAlive640, matrixChance0.5, spawnOnStart, spawnTelegraphMs420, safeDistanceFromPlayer130, edgeInset24 }
- `formation` { matrix{minSize4,maxSize6,spacing46}, ring{minCount10,maxCount18,minRadius180,maxRadius300} }
- `lock`（v12）{ aimActiveWindowMs700, searchRadius560, angleWeight220, meleeStep46, marker{color金,radius24,thickness2} }
- `melee` { range90, arcDeg90, radius110, arcColor/arcAlpha/arcFadeMs }
- `impact` { ringColor白, ringRadius70, ringMs220, coreColor金 }
- `aim` { ringRadius52, ..., dashDistance320, dashHitRadius32, indicator{color/alpha0.35/thickness4/endMarkerRadius8} }
- `juice` { burstShakeDuration300, burstShakeIntensity0.009, flashMs60, damageTextMs600 }（hitShake* 保留未用）
- `items` { dropChance0.015, periodicDropMs0, lifespanMs14000, radius15, maxAlive24, blinkBeforeMs2500, shieldHp3(未用), colors{A青/B金/C紅/E紫/T白} }
- `skills`:
  - whirlwind{radius200,hits12,intervalMs60,damagePerHit30,knockback620,**spinMs780**}
  - thunder{strikes6,spacing90,startOffset70,radius90,damage80,strikeDelayMs90,knockback260,**chargeMs350**}
  - iaido{distance900,speed2600,hitRadius60,damage120,knockback420,**windupMs160**}
  - shockwave{radius900,damage70,knockback800,visualMs320,**jumpMs260,slamMs160**}
  - **timestop{dashes6,durationMs1500,hitRadius70,damage220,knockback700}**

---

## 版本沿革（v1 → v13）

- **v1** MVP：Phaser+TS+Vite 專案、一鍵自動衝刺鎖敵、鬥氣、爆發連招、血量結算、敵人四周生成難度曲線。
- **v2** 固定視角鬥技場 + 16:9 + 敵量加大 + 方陣/環形隊形 + 持續制出怪。
- **v3** 敵人改場內出生+登場提示；新增滑鼠瞄準衝刺（與自動鎖定並存 → **後來發現打架**）。
- **v4** 移除自動鎖定改純滑鼠瞄準衝刺（遇第一個敵人停下）；爆發改原地施放。
- **v5** 鬥氣更難集(+5)；取消接觸扣血→敵人蓄力攻擊AI；縮小玩家攻擊範圍；新增肉盾 tank。
- **v6** 爆發削弱(保留擊退)；**本地 4 人共玩**(P1+3BOT，Character 類別，各自血量/全滅才結束)。
- **v7** 敵人更多更耐打；震動收斂（只爆發、shakeOnce 同時一個）。
- **v8** 衝刺距離指示線；4 種道具招式(A旋風斬/B天降雷擊/C居合貫穿/E全屏震爆)；BOT 改按 B 熱鍵加入。
- **v9** 震動更小；道具變稀有+護盾(破盾才拿)；新增 shooter(遠攻)/charger(衝鋒)/shielder(盾怪) 三種敵人。
- **v10** 普攻近/遠差異化：近→原地扇形、遠→衝撞(衝擊特效)、無敵→空衝。
- **v11** 關掉 shooter/charger(權重0)；修結算空白鍵重開 bug(第一次)；取消道具護盾；衝刺賦予護盾(無敵+光環)；強化擊退380/硬直500。
- **v12** 重加自動鎖定(不打架：方向由鎖定目標決定、滑鼠只選鎖誰)；普攻帶位移追砍；鎖定標記。
- **v13** 5 招演出化(施展無敵+不可操控 skillLock)；新增第5招時間暫停(全場凍結+穿梭+結算)；敵人被擊飛邊界反彈。
- **修 bug（v11 後續、以瀏覽器實測定根因）**：結算重開 → 找到 UIScene.rows 殘留 glTexture 崩潰為真兇，改乾淨重啟，3 連開全綠。（海牛曾提議改 window.location.reload()，後取消——根因修復更佳。）

## 版本沿革（v14 → v21）

- **v14** 等級制(團隊共用經驗/等級 cap10)：難度成長(怪量/HP/傷害/生成速度)+角色成長(攻擊範圍/招式)隨等級 levelLerp(Lv1≈0.5~0.6→Lv10=現值)；HUD 等級+經驗條。
- **v14.1** 等級歷程拉長(expToNext 放大 ~×2.5, 總量 4380→11000)；時停加強(durationMs 2000, dashes 9, hitRadius 180, spreadRadius 900 均勻散佈選敵)。
- **v14.2** 道具可被鎖定系統選中(lockedTarget: Enemy|Item)；鎖定道具按攻擊→衝去撿(startDirectionDashTo, dashToItem)；道具黏著+同標記。
- **v15** 道具互搶(人人可搶先到先得, pendingPickups + resolvePickups 原子拾取、同幀近者得)；BOT 積極搶道具(pickBotTarget, greedRadius/distanceBias/rarityExponent)；多色點鎖定標記(同目標一框+各角色代表色小點, drawLockMarkers)；**敵人擊殺原子性(Enemy.dead 旗標防雙重計殺/掉落)**。
- **v16** TitleScene 開始介面(按下才開打生怪)；R 復活P1(無限,原地滿血,Character.revive)；T 遊戲中重開一局。killCharacter 改「僅剩P1時P1死不進結算」。
- **v17** 角色改程式繪製人型剪影(makeHumanoidTexture, 4色, 敵人維持圓塊)+面朝 aimAngle(每幀 setRotation, 標籤不轉)；升級特效(全體金光環+「LEVEL UP」字+微震, playLevelUpEffect)。
- **v17.1 (效能修)** 時停殺太多卡死 → 結算分幀(timestopSettlePerFrame 10)+全域特效節流(maxActiveFx 40, spawnDamageText/spawnDeathBurst 超量略過視覺, activeFxCount 計數)+死亡粒子 8→6。
- **v18** 居合來回(衝出+衝回起點, 各趟獨立 hitSet)；怪量 -35%(maxAlive 640→416, 隊形量降)；敵人 patrol/alert AI(alertRadius260/loseRadius360/loseGraceMs1200/patrolSpeed34/patrolRadius70)；HUD 4欄面板移到最下方；爆發 knockback 480→110；蓄力預警改「由內而外填滿」讀條(chargeProgress)。
- **v18.1 (修bug)** 換鎖定時P1大幅位移 → 根因 handleDash 用 live aimAngle 當衝刺方向(移動滑鼠牽著跑到不了終點)；改用「固定終點方向」atan2(dashDest-pos)；衝刺中面朝也用終點方向。
- **v19** 鬥氣改命中次數制(每次攻擊中≥1隻+1, 揮空不加, 集滿 hitsToBurst=10; performMeleeArc/performAttackOn 一次+1, damageEnemy 不再逐隻)；爆發 knockback→0(原地無敵亂打不震退)；血/鬥氣條移到角色腳下(Character syncLabel)；移除右下攻擊鈕→點擊畫面攻擊+角色頭上「爆」標記。
- **v20** 招式：旋風斬明顯自轉(spinTurns4+殘影)、天降雷擊改角色周圍順時針6雷(orbitRadius120)、居合 hitRadius 60→110、震爆 radius 900→450；新招 **F噴火**(隨機朝有敵方向+地面燒灼2秒每tick, 入掉落池)；怪量隨人數縮放(aliveScale 0.4→1.0)；恢復下方4欄面板(v19誤刪, 與腳下小條並存)。
- **v21** 普攻傷害隨等級(attackDamageLv1Scale 0.6, curAttackDamage Lv1 15→Lv10 25)+範圍成長確認生效；新增 **H補血道具**(非招式, 撿到只補自己+40不超maxHp, applyHeal, 綠光+跳字, 入掉落池)；F火焰改長方形火道+長方形燒灼區(flameLength340×flameWidth150, burnLength300×burnWidth150, pointInOrientedRect 判定)；居合視覺改寬斬擊帶(spawnSlashBand, 寬=hitRadius×2≈220, 與判定一致)。

## 除錯掛鉤補充（v14→v21 新增，皆無害保留）
- GameScene: debugGrantExp, debugStressSpawn, debugSpawnProbeAt, debugProbeState, debugIaidoStart, debugP1Pos, debugAddBot, debugBotWouldGrabItem, debugSimulSameFrameKill, debugDropItem, debugAimToward, debugCharsLock, debugTriggerSkill, debugState(含 level/scale/attackDamage/activeFxCount), debugHealP1。

## 版本沿革（v22 → v34）

- **v22** 平衡：敵人HP -30%(normal130→90/tank460→320/shielder220→150)；居合 distance 1000→1300。
- **v23** 單人怪量硬上限 soloMaxAliveCap 50。
- **v24** 停生 tank/shielder；enemyHpLv1Scale 0.55→0.35(前期更脆)；AI alertRadius260→460/loseRadius360→560/loseGrace1200→2000；dropChance 0.015→0.06。
- **v25** 怪種**依等級解鎖**(unlockByLevel)；shooter 改**蓄力直線雷射**(被打中斷)；隊形加 line/wedge/doubleRing/scatter(6種加權)；居合往怪最多方向切+hitRadius110→55；F火焰改**十字**四方向；道具上限24→5；(第8項)P1普攻命中計數 p1AttackHits + HUD「命中X」+ 結算顯示。
- **v26** shooter laserChargeMs→1700；爆發 hitstop(physics.pause 55ms 破頓)；爆字放大脈動；shielder權重14→6；新怪 **bomber**(投彈)；近戰 chargeMs650→950；旋風斬 knockback→0 多段持續；soloMaxAliveCap 50→35。
- **v27** ★**波次制**(每波清quota過關+intermission)；怪種改**依波次解鎖**(unlockByWave)；旋風斬改**放置式3秒地面旋風場**(不鎖角色可自由移動、可多個)。
- **v28** ★**波次BOSS**(每5波, 清完小怪→BOSS登場→打倒才過關, 高HP+血條+三招輪替+掉4道具)；居合純瞄最密集方向；N鍵清場完成波次；shooter laserChargeMs→2500。
- **v29** P1瞄準改「滑鼠方向優先」(config aim.autoLock 開關, 預設 false)。
- **v30** ★瞄準改**融合模式**(滑鼠方向錐形內有怪→自動鎖打; 無怪→朝空地自由走位, 不被BOSS綁死)。
- **v31** ★**連段技系統**(spirit改combo, 命中4圓形/8直線/12強化, 隨等級解鎖; 爆發改**限時強化狀態**5秒無敵+攻擊×1.8+範圍×1.5可操控)。
- **v32** 第一批: 升級加快(expToNext總~11000→2550,約第6波Lv10)、tank200/shielder100、attackDamage25→36、normal權重52→75、bomber**定點不動**、強化視覺確認(每幀emitStats驅動HUD倒數+持續金光+無敵)。第二批: **連段架構改定案**(命中3圓形Lv2/6直線Lv4/9爆發原地亂打Lv6/10限時強化Lv1, 到10歸零; endBurst不清P1 combo)。
- **v33** ★**三事件系統**(每3波非BOSS波輪替 tower/guard/capture, 清完小怪→事件→完成才過關+獎勵; waveState 加 'event'; 塔/npc 用新 EnemyType)。
- **v34** 事件/強化/BOSS調整6點: NPC不可鎖(塔可鎖)、守護/塔事件持續生怪(無視配額)、intermission凍結強化&道具倒數、強化角色scale1.4(碰撞不變)、BOSS/塔不被擊退、塔圓環重做(**中空環+由內而外填滿預警+三環依序擴大+環帶命中定身3秒** rootedUntil/isRooted)。

## 除錯掛鉤補充（v22→v34）
- debugSetWave(n)、debugSpawnBoss()、debugTriggerEvent('tower'|'guard'|'capture')、debugEventState()、debugSpawnType(type,dist)、debugState 加 wave/combo/empowerRemainMs/p1Empowered 等。

## 待辦 / 可能的下一步（海牛派）

- 守護事件敵人 AI 仍朝最近角色(玩家中央防守)；可改敵人專門鎖 NPC 更明確(已跟海牛備註)。
- shooter/charger 之後可能重新開啟(charger 目前不列 unlockByWave 永不生成)。
- 各版數值皆「暫定」，常被要求微調。音效、最高分紀錄、更多敵種/招式可能陸續加。
