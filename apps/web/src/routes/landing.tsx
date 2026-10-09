import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { Trans, useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const FEATURES = [
  { key: 'plan', emoji: '🗺️' },
  { key: 'split', emoji: '💸' },
  { key: 'ai', emoji: '✨' },
  { key: 'settle', emoji: '🤝' },
  { key: 'offline', emoji: '📱' },
  { key: 'together', emoji: '👯' },
] as const;

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.5, ease: 'easeOut' },
} as const;

/** Anteprima decorativa dell'app nella home: una scheda viaggio con saldi. */
function PhonePreview() {
  const { t } = useTranslation();
  const rows = [
    { emoji: '🏨', title: 'Waterfront Lodge', who: 'Marco', amount: '510,00 €' },
    { emoji: '⛽', title: 'Carburante A82', who: 'Giulia', amount: '£ 48,20' },
    { emoji: '🎟️', title: 'Urquhart Castle', who: 'Luca', amount: '£ 56,00' },
    { emoji: '🍽️', title: 'Cena a Fort William', who: 'Sara', amount: '£ 92,40' },
  ];
  return (
    <div className="relative mx-auto w-[290px] rounded-[2.5rem] border-8 border-foreground/90 bg-background shadow-2xl shadow-accent/20">
      <div className="overflow-hidden rounded-[2rem]">
        <div className="relative h-36 bg-[linear-gradient(135deg,oklch(0.55_0.1_190),oklch(0.45_0.15_270))] p-4 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgb(255_255_255/0.25),transparent_50%)]" />
          <p className="relative text-xs font-medium opacity-80">12 – 16 ott · 4 👤</p>
          <p className="relative mt-1 text-2xl font-bold">🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scozia</p>
          <div className="relative mt-3 flex -space-x-2">
            {['🦊', '🐼', '🐙', '🦉'].map((e, i) => (
              <span
                key={e}
                className="flex size-7 items-center justify-center rounded-full text-sm ring-2 ring-white/70"
                style={{ background: `oklch(0.8 0.1 ${i * 80 + 20})` }}
              >
                {e}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-1 p-3">
          <div className="mb-1 flex items-center justify-between rounded-xl bg-success/10 px-3 py-2 text-sm">
            <span className="font-medium">{t('landing.previewReceive')}</span>
            <span className="tabular font-bold text-success">+ 142,30 €</span>
          </div>
          {rows.map((r) => (
            <div key={r.title} className="flex items-center gap-3 rounded-xl px-2 py-2">
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-lg">
                {r.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.title}</p>
                <p className="text-xs text-muted-foreground">{r.who}</p>
              </div>
              <span className="tabular text-sm font-semibold">{r.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { t } = useTranslation();
  const steps = t('landing.how.steps', { returnObjects: true }) as {
    title: string;
    text: string;
  }[];
  return (
    <div className="overflow-hidden">
      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-[-200px] left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.75_0.12_185/0.35),transparent)]" />
          <div className="absolute top-40 right-[-200px] size-[500px] rounded-full bg-[radial-gradient(closest-side,oklch(0.65_0.18_278/0.25),transparent)]" />
        </div>
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-20 lg:grid-cols-[1.1fr_1fr] lg:pt-20">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-sm font-medium backdrop-blur">
              🧳 {t('landing.badge')}
            </span>
            <h1 className="mt-5 text-4xl font-extrabold tracking-tight text-balance sm:text-6xl">
              <Trans
                i18nKey="landing.title"
                components={{
                  1: (
                    <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent" />
                  ),
                }}
              />
            </h1>
            <p className="mt-5 max-w-xl text-lg text-pretty text-muted-foreground">
              {t('landing.subtitle')}
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" variant="accent">
                <Link to="/signup">
                  {t('landing.ctaPrimary')}
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/login">{t('landing.ctaSecondary')}</Link>
              </Button>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, y: 30, rotate: 2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
          >
            <PhonePreview />
          </motion.div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.key}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.05 }}
              className="rounded-xl border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-secondary text-2xl">
                {f.emoji}
              </span>
              <h3 className="mt-4 text-lg font-semibold">{t(`landing.features.${f.key}.title`)}</h3>
              <p className="mt-1.5 text-muted-foreground">{t(`landing.features.${f.key}.text`)}</p>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <motion.h2
          {...fadeUp}
          className="text-center text-3xl font-bold tracking-tight sm:text-4xl"
        >
          {t('landing.how.title')}
        </motion.h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-4">
          {steps.map((s, i) => (
            <motion.li
              key={s.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: i * 0.08 }}
              className="relative"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent font-bold text-white">
                {i + 1}
              </span>
              <h3 className="mt-4 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.text}</p>
            </motion.li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-8 pb-24">
        <motion.div
          {...fadeUp}
          className="relative overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,oklch(0.55_0.1_190),oklch(0.45_0.15_270))] px-6 py-14 text-center text-white sm:px-12"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgb(255_255_255/0.2),transparent_45%)]" />
          <h2 className="relative text-3xl font-bold tracking-tight sm:text-4xl">
            {t('landing.finalTitle')}
          </h2>
          <p className="relative mt-3 text-white/80">{t('landing.finalText')}</p>
          <Button
            asChild
            size="lg"
            className="relative mt-8 bg-white text-slate-900 hover:bg-white/90"
          >
            <Link to="/signup">
              {t('landing.ctaPrimary')}
              <ArrowRight />
            </Link>
          </Button>
        </motion.div>
      </section>
    </div>
  );
}
