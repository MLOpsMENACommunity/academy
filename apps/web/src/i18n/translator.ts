import type { Locale } from '@academy/shared';
import ar from './messages/ar.json';
import en from './messages/en.json';

export type Messages = typeof en;
export const dictionaries: Record<Locale, Messages> = { en, ar };

export type TranslateVars = Record<string, string | number>;
export type Translate = (key: string, vars?: TranslateVars) => string;

function lookup(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((node, part) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[part];
    return undefined;
  }, messages);
}

/** `t('home.title')`, with `{name}` interpolation. Falls back to English, then to the key. */
export function createTranslator(locale: Locale): Translate {
  return (key, vars) => {
    let value = lookup(dictionaries[locale], key);
    if (typeof value !== 'string') value = lookup(dictionaries.en, key);
    if (typeof value !== 'string') {
      if (process.env.NODE_ENV !== 'production') console.warn(`Missing translation: ${key}`);
      return key;
    }
    return vars
      ? value.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
      : value;
  };
}
