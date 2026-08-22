export type { Locale, Messages } from './i18n/messages';
export type LocalizedString = string | Record<string, string>;

export interface StickerItemSpec {
  id: string;
  name: LocalizedString;
}

export interface StickerGroupSpec {
  id: string;
  color?: string;
  name: LocalizedString;
  items: StickerItemSpec[];
}

export interface StickerSectionSpec {
  color?: string;
  name: LocalizedString;
  items: StickerGroupSpec[];
}

export interface StickerSpec {
  branding: {
    title: string;
    logoUrl?: string;
    colors: {
      background: string;
      primary: string;
      secondary: string;
      error: string;
      badge: string;
      owned: string;
      missing: string;
    };
    decorationFont: { name: string; url: string };
    uxFont: { name: string; url: string };
    printZoom: string;
  };
  sections: StickerSectionSpec[];
}

export interface SerialEntry {
  serial: number;
  groupId: string;
  itemId: string;
  itemName: LocalizedString;
}

export interface CollectionState {
  spec: string;
  name: string;
  owned: number[];
  duplicates: number[];
}
