/** Generic asset loader with caching */
export class AssetLoader {
  private cache = new Map<string, unknown>();

  async loadImage(url: string): Promise<HTMLImageElement> {
    if (this.cache.has(url)) return this.cache.get(url) as HTMLImageElement;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        this.cache.set(url, img);
        resolve(img);
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  async loadJSON<T = unknown>(url: string): Promise<T> {
    if (this.cache.has(url)) return this.cache.get(url) as T;
    const res = await fetch(url);
    const data = await res.json();
    this.cache.set(url, data);
    return data as T;
  }
}
