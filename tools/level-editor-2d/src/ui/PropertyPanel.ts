/**
 * 屬性編輯面板
 * 顯示和編輯選中實體的屬性
 */
export class PropertyPanel {
  private currentEntity: any = null;
  private panelElement: HTMLElement | null = null;

  constructor() {
    this.createPanel();
    this.bindEvents();
  }

  /**
   * 建立屬性面板
   */
  private createPanel(): void {
    // 在側邊欄底部建立屬性面板
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
      this.panelElement = document.createElement('div');
      this.panelElement.id = 'property-panel';
      this.panelElement.style.cssText = `
        border-top: 1px solid #404040;
        background: #2a2a2a;
        padding: 15px;
        min-height: 200px;
        display: none;
      `;
      
      sidebar.appendChild(this.panelElement);
    }
  }

  /**
   * 綁定事件監聽器
   */
  private bindEvents(): void {
    // 監聽實體選擇事件
    document.addEventListener('entitySelected', () => {
      // 實體選擇時清空屬性面板
      this.clearPanel();
    });
  }

  /**
   * 顯示實體屬性
   */
  showEntityProperties(entity: any): void {
    this.currentEntity = entity;
    
    if (!this.panelElement) return;

    this.panelElement.style.display = 'block';
    this.panelElement.innerHTML = `
      <h4 style="margin-bottom: 15px; color: #ffffff;">屬性編輯</h4>
      
      <div class="input-group">
        <label>ID</label>
        <input type="text" value="${entity.id}" disabled style="opacity: 0.5;">
      </div>
      
      <div class="input-group">
        <label>類型</label>
        <input type="text" value="${entity.type}" disabled style="opacity: 0.5;">
      </div>
      
      <div class="input-group">
        <label>子類型</label>
        <input type="text" value="${entity.subType}" disabled style="opacity: 0.5;">
      </div>
      
      <div class="input-group">
        <label>X 座標</label>
        <input type="number" id="prop-x" value="${entity.x}" step="1">
      </div>
      
      <div class="input-group">
        <label>Y 座標</label>
        <input type="number" id="prop-y" value="${entity.y}" step="1">
      </div>
      
      ${this.renderTypeSpecificProperties(entity)}
      
      <div style="margin-top: 15px; display: flex; gap: 10px;">
        <button class="btn" id="apply-properties">套用</button>
        <button class="btn secondary" id="delete-entity">刪除</button>
      </div>
    `;

    this.bindPropertyEvents();
  }

  /**
   * 渲染特定類型的屬性
   */
  private renderTypeSpecificProperties(entity: any): string {
    const properties = entity.properties || {};
    
    switch (entity.type) {
      case 'enemy':
        return `
          <div class="input-group">
            <label>血量</label>
            <input type="number" id="prop-health" value="${properties.health || 100}" min="1">
          </div>
          
          <div class="input-group">
            <label>速度</label>
            <input type="number" id="prop-speed" value="${properties.speed || 50}" min="1">
          </div>
          
          <div class="input-group">
            <label>攻擊力</label>
            <input type="number" id="prop-damage" value="${properties.damage || 20}" min="1">
          </div>
          
          <div class="input-group">
            <label>AI類型</label>
            <select id="prop-aiType">
              <option value="patrol" ${properties.aiType === 'patrol' ? 'selected' : ''}>巡邏</option>
              <option value="chase" ${properties.aiType === 'chase' ? 'selected' : ''}>追擊</option>
              <option value="guard" ${properties.aiType === 'guard' ? 'selected' : ''}>守衛</option>
            </select>
          </div>
        `;
        
      case 'item':
        return `
          <div class="input-group">
            <label>價值</label>
            <input type="number" id="prop-value" value="${properties.value || 10}" min="1">
          </div>
          
          <div class="input-group">
            <label>道具類型</label>
            <select id="prop-itemType">
              <option value="coin" ${properties.type === 'coin' ? 'selected' : ''}>金幣</option>
              <option value="gem" ${properties.type === 'gem' ? 'selected' : ''}>寶石</option>
              <option value="health" ${properties.type === 'health' ? 'selected' : ''}>補血</option>
            </select>
          </div>
          
          <div class="input-group">
            <label style="display: flex; align-items: center; gap: 5px;">
              <input type="checkbox" id="prop-respawn" ${properties.respawn ? 'checked' : ''}>
              可重生
            </label>
          </div>
        `;
        
      case 'breakable':
        return `
          <div class="input-group">
            <label>血量</label>
            <input type="number" id="prop-health" value="${properties.health || 50}" min="1">
          </div>
          
          <div class="input-group">
            <label>掉落物品</label>
            <input type="text" id="prop-drops" value="${(properties.drops || []).join(', ')}" placeholder="以逗號分隔">
          </div>
        `;
        
      default:
        return '';
    }
  }

  /**
   * 綁定屬性編輯事件
   */
  private bindPropertyEvents(): void {
    // 套用屬性按鈕
    document.getElementById('apply-properties')?.addEventListener('click', () => {
      this.applyProperties();
    });

    // 刪除實體按鈕
    document.getElementById('delete-entity')?.addEventListener('click', () => {
      this.deleteEntity();
    });
  }

  /**
   * 套用屬性變更
   */
  private applyProperties(): void {
    if (!this.currentEntity) return;

    // 更新基礎屬性
    const xInput = document.getElementById('prop-x') as HTMLInputElement;
    const yInput = document.getElementById('prop-y') as HTMLInputElement;
    
    if (xInput) this.currentEntity.x = parseFloat(xInput.value);
    if (yInput) this.currentEntity.y = parseFloat(yInput.value);

    // 更新特定類型屬性
    this.updateTypeSpecificProperties();

    // 觸發更新事件
    const customEvent = new CustomEvent('entityPropertiesUpdated', {
      detail: { entity: this.currentEntity }
    });
    
    document.dispatchEvent(customEvent);
  }

  /**
   * 更新特定類型的屬性
   */
  private updateTypeSpecificProperties(): void {
    if (!this.currentEntity || !this.currentEntity.properties) return;

    const properties = this.currentEntity.properties;

    switch (this.currentEntity.type) {
      case 'enemy':
        const healthInput = document.getElementById('prop-health') as HTMLInputElement;
        const speedInput = document.getElementById('prop-speed') as HTMLInputElement;
        const damageInput = document.getElementById('prop-damage') as HTMLInputElement;
        const aiTypeSelect = document.getElementById('prop-aiType') as HTMLSelectElement;
        
        if (healthInput) properties.health = parseInt(healthInput.value);
        if (speedInput) properties.speed = parseInt(speedInput.value);
        if (damageInput) properties.damage = parseInt(damageInput.value);
        if (aiTypeSelect) properties.aiType = aiTypeSelect.value;
        break;
        
      case 'item':
        const valueInput = document.getElementById('prop-value') as HTMLInputElement;
        const itemTypeSelect = document.getElementById('prop-itemType') as HTMLSelectElement;
        const respawnInput = document.getElementById('prop-respawn') as HTMLInputElement;
        
        if (valueInput) properties.value = parseInt(valueInput.value);
        if (itemTypeSelect) properties.type = itemTypeSelect.value;
        if (respawnInput) properties.respawn = respawnInput.checked;
        break;
        
      case 'breakable':
        const breakableHealthInput = document.getElementById('prop-health') as HTMLInputElement;
        const dropsInput = document.getElementById('prop-drops') as HTMLInputElement;
        
        if (breakableHealthInput) properties.health = parseInt(breakableHealthInput.value);
        if (dropsInput) {
          properties.drops = dropsInput.value
            .split(',')
            .map(item => item.trim())
            .filter(item => item.length > 0);
        }
        break;
    }
  }

  /**
   * 刪除實體
   */
  private deleteEntity(): void {
    if (!this.currentEntity) return;

    const customEvent = new CustomEvent('entityDeleted', {
      detail: { entityId: this.currentEntity.id }
    });
    
    document.dispatchEvent(customEvent);
    this.clearPanel();
  }

  /**
   * 清空屬性面板
   */
  private clearPanel(): void {
    this.currentEntity = null;
    
    if (this.panelElement) {
      this.panelElement.style.display = 'none';
      this.panelElement.innerHTML = '';
    }
  }

  /**
   * 隱藏屬性面板
   */
  hide(): void {
    this.clearPanel();
  }
}
