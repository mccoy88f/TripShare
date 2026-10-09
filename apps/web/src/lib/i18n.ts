import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '@tripshare/shared';
import en from '../locales/en.json';
import it from '../locales/it.json';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { it: { translation: it }, en: { translation: en } },
    supportedLngs: [...LOCALES],
    fallbackLng: DEFAULT_LOCALE,
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'tripshare-locale',
      caches: ['localStorage'],
    },
  });

i18n.on('languageChanged', (lng) => {
  document.documentElement.lang = lng;
});
document.documentElement.lang = i18n.resolvedLanguage ?? DEFAULT_LOCALE;

export function currentLocale(): Locale {
  return (i18n.resolvedLanguage as Locale | undefined) ?? DEFAULT_LOCALE;
}

export default i18n;
