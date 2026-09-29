/**
 * 輕量版遊戲配置 - 專注於基本載入功能
 */
export const LightGameConfig = {
  /** 邏輯解析度 */
  width: 1280,
  height: 720,

  /** 競技場設定 */
  arena: {
    padding: 48,
    borderThickness: 6,
    borderColor: 0x3a4668,
  },

  /** 玩家基本設定 */
  player: {
    maxHp: 100,
    radius: 16,
    speed: 0,
    attackReach: 44,
    attackDamage: 36,
    dashSpeed: 1400,
    knockback: 380,
    attackCooldownMs: 300,
    invulnMs: 600,
    attackHitRadius: 42,
    dashShieldInvuln: true
  },

  /** 角色設定 */
  characters: {
    count: 4,
    colors: [0x5ad1ff, 0x7bed9f, 0xffa502, 0xff6b81],
    labels: ['P1', 'BOT', 'BOT', 'BOT'],
    spawnSpreadRadius: 90
  },

  /** 基本敵人類型 */
  enemy: {
    engageRange: 40,
    knockbackStunMs: 500,
    chargeMs: 950,
    attackRadius: 46,
    attackDamage: 12,
    attackCooldownMs: 2000,
    
    types: {
      normal: {
        maxHp: 90,
        speed: 70,
        radius: 14,
        color: 0xff5a6e,
        stroke: 0x2a0a12,
        spawnWeight: 75
      }
    }
  }
};

export type LightGameConfigType = typeof LightGameConfig;
