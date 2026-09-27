import type { GameEntity, PhaserEntity, EntitySpawnCallback } from '@/types/LevelTypes';

/**
 * 鬥氣割草 - 實體生成器
 * 負責根據關卡配置生成遊戲實體（敵人、道具、障礙物等）
 */
export class EntitySpawner {
  private scene: Phaser.Scene;
  private spawnedEntities: Map<string, PhaserEntity> = new Map();
  private onSpawnCallback?: EntitySpawnCallback;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * 設定實體生成回調函數
   */
  setSpawnCallback(callback: EntitySpawnCallback): void {
    this.onSpawnCallback = callback;
  }

  /**
   * 批量生成實體
   * @param entities 實體配置陣列
   */
  spawnEntities(entities: GameEntity[]): PhaserEntity[] {
    console.log(`[EntitySpawner] 開始生成 ${entities.length} 個實體`);
    
    const spawnedList: PhaserEntity[] = [];

    entities.forEach(entityConfig => {
      try {
        const entity = this.spawnSingleEntity(entityConfig);
        if (entity) {
          spawnedList.push(entity);
          this.spawnedEntities.set(entity.id, entity);
        }
      } catch (error) {
        console.error(`[EntitySpawner] 生成實體失敗: ${entityConfig.id}`, error);
      }
    });

    console.log(`[EntitySpawner] 實體生成完成: ${spawnedList.length}/${entities.length}`);
    return spawnedList;
  }

  /**
   * 生成單一實體
   * @param config 實體配置
   */
  private spawnSingleEntity(config: GameEntity): PhaserEntity | null {
    // 將 3D 座標轉換為 2D（忽略 Y 軸，使用 X 和 Z）
    const x = config.position[0] * 50 + 400; // 縮放並偏移到螢幕中心
    const y = config.position[2] * 50 + 300;

    let sprite: Phaser.GameObjects.Sprite | null = null;

    switch (config.type) {
      case 'enemy':
        sprite = this.spawnEnemy(x, y, config);
        break;
      
      case 'collectible':
        sprite = this.spawnCollectible(x, y, config);
        break;
      
      case 'powerup':
        sprite = this.spawnPowerup(x, y, config);
        break;
      
      case 'obstacle':
        sprite = this.spawnObstacle(x, y, config);
        break;
      
      case 'npc':
        sprite = this.spawnNPC(x, y, config);
        break;
      
      default:
        console.warn(`[EntitySpawner] 未知實體類型: ${config.type}`);
        return null;
    }

    if (!sprite) {
      console.warn(`[EntitySpawner] 實體生成失敗: ${config.id}`);
      return null;
    }

    // 建立 Phaser 實體物件
    const entity: PhaserEntity = {
      id: config.id,
      type: config.type,
      x: sprite.x,
      y: sprite.y,
      properties: { ...config.properties },
      sprite: sprite
    };

    // 設定物理系統（如果場景有啟用）
    if (this.scene.physics && this.scene.physics.world) {
      this.scene.physics.add.existing(sprite);
      entity.body = sprite.body as Phaser.Physics.Arcade.Body;
    }

    // 觸發回調
    if (this.onSpawnCallback) {
      this.onSpawnCallback(entity);
    }

    console.log(`[EntitySpawner] 生成實體: ${config.name} (${config.type}) at (${x}, ${y})`);
    return entity;
  }

  /**
   * 生成敵人
   */
  private spawnEnemy(x: number, y: number, config: GameEntity): Phaser.GameObjects.Sprite | null {
    // 建立敵人精靈（使用臨時顏色矩形，實際專案中應使用真實素材）
    const sprite = this.scene.add.sprite(x, y, 'enemy_placeholder');
    
    // 如果沒有預設圖片，建立一個紅色矩形作為佔位符
    if (!this.scene.textures.exists('enemy_placeholder')) {
      this.createPlaceholderTexture('enemy_placeholder', 32, 32, 0xff0000);
      sprite.setTexture('enemy_placeholder');
    }

    // 設定敵人屬性
    sprite.setData('entityId', config.id);
    sprite.setData('entityType', 'enemy');
    sprite.setData('health', config.properties.health || 100);
    sprite.setData('attackPower', config.properties.attackPower || 20);
    sprite.setData('moveSpeed', config.properties.moveSpeed || 2.0);
    sprite.setData('aiType', config.properties.aiType || 'idle');

    // 設定巡邏路徑
    if (config.patrolPoints && config.patrolPoints.length > 0) {
      const patrolPoints2D = config.patrolPoints.map(point => ({
        x: point[0] * 50 + 400,
        y: point[2] * 50 + 300
      }));
      sprite.setData('patrolPoints', patrolPoints2D);
    }

    // 設定互動性
    sprite.setInteractive();
    
    return sprite;
  }

  /**
   * 生成收集品
   */
  private spawnCollectible(x: number, y: number, config: GameEntity): Phaser.GameObjects.Sprite | null {
    const sprite = this.scene.add.sprite(x, y, 'collectible_placeholder');
    
    if (!this.scene.textures.exists('collectible_placeholder')) {
      this.createPlaceholderTexture('collectible_placeholder', 24, 24, 0xffff00);
      sprite.setTexture('collectible_placeholder');
    }

    sprite.setData('entityId', config.id);
    sprite.setData('entityType', 'collectible');
    sprite.setData('value', config.properties.value || 10);
    sprite.setData('effectType', config.properties.effectType || 'score');

    // 自動旋轉效果
    if (config.properties.autoRotate) {
      const rotateSpeed = config.properties.rotateSpeed || 90;
      this.scene.tweens.add({
        targets: sprite,
        angle: 360,
        duration: 360000 / rotateSpeed, // 根據速度計算持續時間
        repeat: -1,
        ease: 'Linear'
      });
    }

    sprite.setInteractive();
    return sprite;
  }

  /**
   * 生成強化道具
   */
  private spawnPowerup(x: number, y: number, config: GameEntity): Phaser.GameObjects.Sprite | null {
    const sprite = this.scene.add.sprite(x, y, 'powerup_placeholder');
    
    if (!this.scene.textures.exists('powerup_placeholder')) {
      this.createPlaceholderTexture('powerup_placeholder', 28, 28, 0x00ff00);
      sprite.setTexture('powerup_placeholder');
    }

    sprite.setData('entityId', config.id);
    sprite.setData('entityType', 'powerup');
    sprite.setData('effectType', config.properties.effectType || 'speed_boost');
    sprite.setData('duration', config.properties.duration || 10);
    sprite.setData('multiplier', config.properties.multiplier || 1.5);

    // 脈動效果
    this.scene.tweens.add({
      targets: sprite,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    sprite.setInteractive();
    return sprite;
  }

  /**
   * 生成障礙物
   */
  private spawnObstacle(x: number, y: number, config: GameEntity): Phaser.GameObjects.Sprite | null {
    const sprite = this.scene.add.sprite(x, y, 'obstacle_placeholder');
    
    if (!this.scene.textures.exists('obstacle_placeholder')) {
      this.createPlaceholderTexture('obstacle_placeholder', 40, 40, 0x8b4513);
      sprite.setTexture('obstacle_placeholder');
    }

    sprite.setData('entityId', config.id);
    sprite.setData('entityType', 'obstacle');
    sprite.setData('destructible', config.properties.destructible || false);
    sprite.setData('health', config.properties.health || 1);

    return sprite;
  }

  /**
   * 生成 NPC
   */
  private spawnNPC(x: number, y: number, config: GameEntity): Phaser.GameObjects.Sprite | null {
    const sprite = this.scene.add.sprite(x, y, 'npc_placeholder');
    
    if (!this.scene.textures.exists('npc_placeholder')) {
      this.createPlaceholderTexture('npc_placeholder', 32, 32, 0x0080ff);
      sprite.setTexture('npc_placeholder');
    }

    sprite.setData('entityId', config.id);
    sprite.setData('entityType', 'npc');
    sprite.setData('dialogueId', config.properties.dialogueId || '');
    sprite.setData('questId', config.properties.questId || '');

    sprite.setInteractive();
    return sprite;
  }

  /**
   * 建立佔位符材質
   */
  private createPlaceholderTexture(key: string, width: number, height: number, color: number): void {
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(color);
    graphics.fillRect(0, 0, width, height);
    graphics.generateTexture(key, width, height);
    graphics.destroy();
  }

  /**
   * 移除實體
   */
  destroyEntity(entityId: string): void {
    const entity = this.spawnedEntities.get(entityId);
    if (entity && entity.sprite) {
      entity.sprite.destroy();
      this.spawnedEntities.delete(entityId);
      console.log(`[EntitySpawner] 移除實體: ${entityId}`);
    }
  }

  /**
   * 取得生成的實體
   */
  getEntity(entityId: string): PhaserEntity | null {
    return this.spawnedEntities.get(entityId) || null;
  }

  /**
   * 取得所有實體
   */
  getAllEntities(): PhaserEntity[] {
    return Array.from(this.spawnedEntities.values());
  }

  /**
   * 根據類型取得實體
   */
  getEntitiesByType(type: string): PhaserEntity[] {
    return Array.from(this.spawnedEntities.values()).filter(entity => entity.type === type);
  }

  /**
   * 清除所有實體
   */
  clearAllEntities(): void {
    this.spawnedEntities.forEach(entity => {
      if (entity.sprite) {
        entity.sprite.destroy();
      }
    });
    this.spawnedEntities.clear();
    console.log('[EntitySpawner] 所有實體已清除');
  }
}
