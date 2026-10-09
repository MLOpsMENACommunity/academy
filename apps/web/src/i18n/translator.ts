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

const pluralRules: Record<Locale, Intl.PluralRules> = {
  en: new Intl.PluralRules('en'),
  ar: new Intl.PluralRules('ar'),
};

/** Index of the `}` closing the `{` at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** "one {# course} other {# courses}" -> { one: '# course', other: '# courses' }. */
function pluralOptions(body: string): Map<string, string> {
  const options = new Map<string, string>();
  let i = 0;
  while (i < body.length) {
    const m = /^\s*([=\w]+)\s*\{/.exec(body.slice(i));
    if (!m) break;
    const open = i + m[0].length - 1;
    const end = closing(body, open);
    if (end < 0) break;
    options.set(m[1]!, body.slice(open + 1, end));
    i = end + 1;
  }
  return options;
}

/**
 * `{name}` interpolation plus ICU plurals chosen with the locale's plural rules:
 * `{count, plural, one {# course} other {# courses}}`. Arabic has six forms
 * (zero, one, two, few, many, other); `=N` matches an exact number first; `#` is the number.
 */
export function format(template: string, vars: TranslateVars, locale: Locale): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const end = template[i] === '{' ? closing(template, i) : -1;
    if (end < 0) {
      out += template[i];
      i++;
      continue;
    }
    const raw = template.slice(i, end + 1);
    const inner = raw.slice(1, -1);
    const plural = /^\s*(\w+)\s*,\s*plural\s*,([\s\S]*)$/.exec(inner);
    if (plural) {
      const name = plural[1]!;
      const n = Number(vars[name]);
      if (name in vars && Number.isFinite(n)) {
        const options = pluralOptions(plural[2]!);
        const chosen =
          options.get(`=${n}`) ??
          options.get(pluralRules[locale].select(n)) ??
          options.get('other') ??
          '';
        out += format(chosen.replace(/#/g, String(vars[name])), vars, locale);
      } else {
        out += raw;
      }
    } else {
      const name = inner.trim();
      out += /^\w+$/.test(name) && name in vars ? String(vars[name]) : raw;
    }
    i = end + 1;
  }
  return out;
}

/** `t('home.title')`, with `{name}` interpolation and ICU plurals. Falls back to English, then to the key. */
export function createTranslator(locale: Locale): Translate {
  return (key, vars) => {
    let value = lookup(dictionaries[locale], key);
    let valueLocale = locale;
    if (typeof value !== 'string') {
      value = lookup(dictionaries.en, key);
      valueLocale = 'en';
    }
    if (typeof value !== 'string') {
      if (process.env.NODE_ENV !== 'production') console.warn(`Missing translation: ${key}`);
      return key;
    }
    return vars ? format(value, vars, valueLocale) : value;
  };
}
