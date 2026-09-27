/**
 * 編輯器通用工具函數
 * 提供跨編輯器使用的實用功能
 */

import { Vec2, Vec3, Transform } from '../types';

// ========================================
// ID 生成工具
// ========================================

/**
 * 生成唯一 ID
 */
export function generateId(prefix: string = 'obj'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// ========================================
// 向量運算
// ========================================

export const Vec2Utils = {
  create: (x: number = 0, y: number = 0): Vec2 => ({ x, y }),
  
  add: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y }),
  
  subtract: (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y }),
  
  multiply: (v: Vec2, scalar: number): Vec2 => ({ x: v.x * scalar, y: v.y * scalar }),
  
  length: (v: Vec2): number => Math.sqrt(v.x * v.x + v.y * v.y),
  
  normalize: (v: Vec2): Vec2 => {
    const len = Vec2Utils.length(v);
    return len > 0 ? { x: v.x / len, y: v.y / len } : { x: 0, y: 0 };
  },
  
  distance: (a: Vec2, b: Vec2): number => Vec2Utils.length(Vec2Utils.subtract(a, b))
};

export const Vec3Utils = {
  create: (x: number = 0, y: number = 0, z: number = 0): Vec3 => ({ x, y, z }),
  
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  
  subtract: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  
  multiply: (v: Vec3, scalar: number): Vec3 => ({ x: v.x * scalar, y: v.y * scalar, z: v.z * scalar }),
  
  length: (v: Vec3): number => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z),
  
  normalize: (v: Vec3): Vec3 => {
    const len = Vec3Utils.length(v);
    return len > 0 ? { x: v.x / len, y: v.y / len, z: v.z / len } : { x: 0, y: 0, z: 0 };
  },
  
  distance: (a: Vec3, b: Vec3): number => Vec3Utils.length(Vec3Utils.subtract(a, b))
};

// ========================================
// Transform 工具
// ========================================

export const TransformUtils = {
  create: (
    position: Vec3 = { x: 0, y: 0, z: 0 },
    rotation: Vec3 = { x: 0, y: 0, z: 0 },
    scale: Vec3 = { x: 1, y: 1, z: 1 }
  ): Transform => ({
    position,
    rotation,
    scale
  }),
  
  clone: (transform: Transform): Transform => ({
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    scale: { ...transform.scale }
  })
};

// ========================================
// 檔案工具
// ========================================

/**
 * 下載文字檔案
 */
export function downloadTextFile(content: string, filename: string, mimeType: string = 'application/json'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 讀取檔案為文字
 */
export function readTextFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as string);
      } else {
        reject(new Error('Failed to read file'));
      }
    };
    reader.onerror = () => reject(new Error('File read error'));
    reader.readAsText(file);
  });
}

// ========================================
// 格式化工具
// ========================================

/**
 * 格式化數字為指定小數位數
 */
export function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

/**
 * 格式化向量為字串
 */
export function formatVec3(vec: Vec3, decimals: number = 2): string {
  return `(${formatNumber(vec.x, decimals)}, ${formatNumber(vec.y, decimals)}, ${formatNumber(vec.z, decimals)})`;
}

// ========================================
// 顏色工具
// ========================================

/**
 * 16進制顏色轉 RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * RGB 轉 16進制顏色
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ========================================
// 驗證工具
// ========================================

/**
 * 驗證是否為有效的數字
 */
export function isValidNumber(value: any): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

/**
 * 驗證向量是否有效
 */
export function isValidVec3(vec: any): vec is Vec3 {
  return vec && 
         typeof vec === 'object' &&
         isValidNumber(vec.x) && 
         isValidNumber(vec.y) && 
         isValidNumber(vec.z);
}

// ========================================
// 日期工具
// ========================================

/**
 * 取得當前時間戳記
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * 格式化日期
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('zh-TW') + ' ' + d.toLocaleTimeString('zh-TW');
}
