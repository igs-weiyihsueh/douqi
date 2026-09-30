/**
 * 實體選擇面板
 * 顯示可放置的實體類型
 */
export class EntityPalette {

  constructor() {
    this.bindEvents();
  }

  /**
   * 綁定調色板事件
   */
  private bindEvents(): void {
    // 綁定實體調色板點擊事件
    document.addEventListener('DOMContentLoaded', () => {
      this.bindPaletteEvents();
    });
    
    // 如果DOM已加載，立即綁定
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      this.bindPaletteEvents();
    }
  }

  /**
   * 綁定調色板點擊事件
   */
  private bindPaletteEvents(): void {
    const paletteItems = document.querySelectorAll('.entity-item');
    paletteItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const element = e.currentTarget as HTMLElement;
        const type = element.getAttribute('data-type');
        const subtype = element.getAttribute('data-subtype');
        
        if (type && subtype) {
          this.selectEntity({ type, subType: subtype }, element);
        }
      });
    });
  }

  /**
   * 選擇實體類型
   */
  private selectEntity(
    entity: { type: string; subType: string }, 
    element: HTMLElement
  ): void {
    // 清除之前的選擇
    document.querySelectorAll('.entity-item.selected').forEach(item => {
      item.classList.remove('selected');
    });

    // 選中當前項目
    element.classList.add('selected');

    // 觸發自訂事件，通知主應用程式
    const customEvent = new CustomEvent('entitySelected', {
      detail: {
        type: entity.type,
        subType: entity.subType,
      }
    });
    
    document.dispatchEvent(customEvent);
    
    // 更新狀態
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = `已選擇: ${entity.type} - ${entity.subType}`;
    }
  }
}
