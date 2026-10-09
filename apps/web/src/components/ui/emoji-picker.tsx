import { EmojiPicker as Frimousse } from 'frimousse';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Selettore di emoji con ricerca, basato su Frimousse. */
export function EmojiPicker({
  onSelect,
  className,
}: {
  onSelect: (emoji: string) => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Frimousse.Root
      locale={i18n.resolvedLanguage === 'en' ? 'en' : 'it'}
      className={cn('isolate flex h-[340px] w-[300px] flex-col', className)}
      onEmojiSelect={({ emoji }) => onSelect(emoji)}
    >
      <Frimousse.Search
        placeholder={t('profile.searchEmoji')}
        className="z-10 mx-1 mt-1 mb-2 h-9 appearance-none rounded-md bg-muted px-3 text-sm outline-none"
      />
      <Frimousse.Viewport className="relative flex-1 outline-none">
        <Frimousse.Loading className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          {t('common.loading')}
        </Frimousse.Loading>
        <Frimousse.Empty className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          ∅
        </Frimousse.Empty>
        <Frimousse.List
          className="select-none pb-1.5"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                className="bg-card px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                {...props}
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div className="scroll-my-1 px-1" {...props}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                className="flex size-8 items-center justify-center rounded-md text-xl data-[active]:bg-muted"
                {...props}
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </Frimousse.Viewport>
    </Frimousse.Root>
  );
}
