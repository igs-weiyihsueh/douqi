export const MINIGAMES = [
    {
        key: 'collect-race',
        name: '收集競賽',
        sceneKey: 'CollectRaceScene',
        desc: '60 秒內收集告示指定的形狀丟進自己的箱子，比誰分數高！(1 人 vs 3 BOT)',
        icon: '💎'
    },
    {
        key: 'push-survival',
        name: '推人生存',
        sceneKey: 'PushSurvivalScene',
        desc: '閃躲地面預警圈！空白把附近的人推進爆炸圈害死，撐到最後活著者勝。(1 人 vs 3 BOT)',
        icon: '💥'
    },
    {
        key: 'bomb-arena',
        name: '炸彈人對戰',
        sceneKey: 'BombArenaScene',
        desc: '撿炸彈、朝面向丟向對手!撞到即爆、落地倒數爆、連鎖引爆,炸到出局,最後活著者勝。(1 人 vs 3 BOT)',
        icon: '💣'
    }
    // 之後新增小遊戲：在此加一項 + 寫對應 Scene + main.ts 註冊
];
