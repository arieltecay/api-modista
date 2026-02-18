export interface DynamicItem {
  item: string;
  precio?: number;
  descripcion?: string;
}

export interface TariffSection {
  title: string;
  items: DynamicItem[];
}

export interface SearchResultItem extends DynamicItem {
  sectionTitle: string;
}
