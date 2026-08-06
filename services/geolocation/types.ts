export interface GeoLocationResult {
  city?: string;
  country?: string;
}

export interface GeoLocationCacheEntry extends GeoLocationResult {
  expiresAt: number;
}
