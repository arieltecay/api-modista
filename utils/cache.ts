type CacheEntry<T> = {
  data: T;
  expiry: number;
};

class SimpleCache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  /**
   * Obtiene datos del caché si no han expirado.
   * @param key Clave única del caché
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Guarda datos en el caché con un tiempo de vida (TTL).
   * @param key Clave única
   * @param data Datos a guardar
   * @param ttlSeconds Tiempo de vida en segundos
   */
  set<T>(key: string, data: T, ttlSeconds: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Elimina una clave específica o limpia todo el caché si no se provee clave.
   * @param key Opcional: Clave a eliminar
   */
  clear(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }
}

export const cache = new SimpleCache();
