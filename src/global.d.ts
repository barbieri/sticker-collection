import type { Locale, Messages } from './types';

declare global {
  interface Window {
    __APP_CONFIG__?: {
      specId: string;
      locale: Locale;
      specData: unknown;
      messages: Messages;
    };
  }

  const BRANDING_URLS: string; // only set in service worker by esbuild
}

declare module '*.css';
