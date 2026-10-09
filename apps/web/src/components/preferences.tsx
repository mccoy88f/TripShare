import { Languages, Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LOCALES, type Locale } from '@tripshare/shared';
import { Button } from '@/components/ui/button';
import { useTheme, type Theme } from '@/lib/theme';

const NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const ICON = { system: Monitor, light: Sun, dark: Moon } as const;

export function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const Icon = ICON[theme];
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(NEXT[theme])}
      title={`${t('common.theme')}: ${t(`common.themes.${theme}`)}`}
    >
      <Icon />
      <span className="sr-only">{t('common.theme')}</span>
    </Button>
  );
}

export function LanguageSwitcher() {
  const { i18n, t } = useTranslation();
  const current = (i18n.resolvedLanguage ?? 'it') as Locale;
  const next = LOCALES[(LOCALES.indexOf(current) + 1) % LOCALES.length]!;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => i18n.changeLanguage(next)}
      title={t('common.language')}
      className="uppercase"
    >
      <Languages />
      {current}
    </Button>
  );
}
