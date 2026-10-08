/**
 * 可在主選單編輯器調整、存在瀏覽器 localStorage 的數值參數組（角色參數、打擊感參數共用）。
 *
 * - 每項參數有顯示名稱、範圍、每格幅度與預設值（預設值取自 config）
 * - 只存「跟預設不同」的項目：沒動過的項目永遠跟著 config 預設，之後改預設值不必升版
 * - 讀取時夾在合法範圍內；沒有存檔、無法存取 localStorage 或資料損壞時回到預設
 * - 結構或語意大改時改用新的存檔鍵（舊鍵列在 legacyKeys，讀取時順手清除）
 */

/** 單一參數的編輯定義：顯示名稱、單位、調整範圍與每格幅度 */
export interface ParamDef<K extends string> {
  key: K;
  /** 編輯器顯示名稱 */
  label: string;
  /** 數值單位（顯示用） */
  unit: string;
  /** 補充說明（顯示在名稱旁） */
  hint: string;
  min: number;
  max: number;
  /** 每次 −/+ 或方向鍵調整的幅度 */
  step: number;
  /** 預設值（取自 config） */
  defaultValue: number;
}

/** 參數數值表 */
export type ParamValues<K extends string> = Record<K, number>;

/** 一組參數的讀寫介面 */
export interface ParamStore<K extends string> {
  /** 編輯器顯示順序與各參數的範圍定義 */
  readonly defs: ReadonlyArray<ParamDef<K>>;
  /** 全部為預設值的一份參數 */
  defaults(): ParamValues<K>;
  /** 夾在該參數的合法範圍內；非數字時回傳預設值 */
  clamp(def: ParamDef<K>, value: unknown): number;
  /** 讀取已儲存的參數（每項皆已夾在合法範圍） */
  load(): ParamValues<K>;
  /** 儲存（只存與預設不同的項目；全部等於預設時移除存檔） */
  save(values: ParamValues<K>): void;
  /** 清除存檔（恢復預設） */
  clear(): void;
}

/**
 * 建立一組參數的讀寫介面
 *
 * @param defs 參數定義（編輯器顯示順序）
 * @param storageKey localStorage 存檔鍵
 * @param legacyKeys 舊版存檔鍵（讀取時清除）
 */
export function createParamStore<K extends string>(
  defs: ReadonlyArray<ParamDef<K>>, storageKey: string, legacyKeys: ReadonlyArray<string> = []
): ParamStore<K> {
  const defaults = (): ParamValues<K> => {
    const values = {} as ParamValues<K>;
    for (const def of defs) values[def.key] = def.defaultValue;
    return values;
  };
  const clamp = (def: ParamDef<K>, value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return def.defaultValue;
    return Math.min(def.max, Math.max(def.min, value));
  };
  const clear = (): void => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // 無法存取時忽略
    }
  };
  return {
    defs,
    defaults,
    clamp,
    clear,
    load(): ParamValues<K> {
      const values = defaults();
      let saved: Record<string, unknown> = {};
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) saved = JSON.parse(raw) as Record<string, unknown>;
        for (const legacyKey of legacyKeys) window.localStorage.removeItem(legacyKey);
      } catch {
        return values; // 無痕模式 / 封鎖儲存 / 資料損壞 → 全部用預設
      }
      for (const def of defs) {
        if (def.key in saved) values[def.key] = clamp(def, saved[def.key]);
      }
      return values;
    },
    save(values: ParamValues<K>): void {
      const changed: Record<string, number> = {};
      let hasChanges = false;
      for (const def of defs) {
        if (values[def.key] !== def.defaultValue) {
          changed[def.key] = values[def.key];
          hasChanges = true;
        }
      }
      if (!hasChanges) {
        clear();
        return;
      }
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(changed));
      } catch {
        // 無法寫入（無痕模式 / 封鎖儲存）：不影響遊戲，參數仍在本次遊戲有效
      }
    }
  };
}
