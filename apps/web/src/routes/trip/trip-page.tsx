import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft, CalendarDays, Loader2, Search, Settings, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack } from '@/components/avatar-stack';
import { TripCover } from '@/components/trip-cover';
import { CoverCredit } from '@/components/unsplash-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { askAssistant } from '@/lib/assistant-ask';
import { focusItem } from '@/lib/search-focus';
import { SearchPanel, type SearchResult } from './search';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dateRange, money } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import { BalancePill } from '@/routes/trips';
import { useAiStatus } from '@/lib/ai';
import { AddRequestContext, useFabAction } from '@/lib/fab';
import { AssistantTab } from './assistant-tab';
import { BalancesTab } from './balances-tab';
import { CaptureSheet } from './capture';
import { ExpenseDialog } from './expense-dialog';
import { ExpensesTab } from './expenses-tab';
import { MembersTab } from './members-tab';
import { rememberTrip } from '@/lib/memories';
import { NotesTab } from './notes-tab';
import { SettingsTab } from './settings-tab';
import { BookingsTab } from './plan/bookings-tab';
import { BudgetTab } from './plan/budget-tab';
import { PackingTab } from './plan/packing-tab';
import { PlacesTab } from './plan/places-tab';
import { PlanTab } from './plan/plan-tab';
import { cn } from '@/lib/utils';

/** Tab visibili nella barra; membri e impostazioni sono icone sulla copertina. */
const MAIN_TABS = ['plan', 'expenses', 'bookings', 'places', 'packing', 'notes'] as const;
/** L'assistente è un'icona a destra della riga dei tab; membri e impostazioni sulla copertina. */
const TABS = [...MAIN_TABS, 'assistant', 'members', 'settings'] as const;
type Tab = (typeof TABS)[number];
/** Sotto-viste del tab Spese. */
const MONEY_VIEWS = ['list', 'balances', 'budget'] as const;
type MoneyView = (typeof MONEY_VIEWS)[number];
/** Tab in cui il "+" propone di fotografare un documento. */
const CAPTURE_TABS = ['plan', 'expenses', 'bookings', 'places'] as const;

export function TripPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { tripId } = useParams({ strict: false }) as { tripId: string };
  const search = useSearch({ strict: false }) as {
    tab?: string;
    view?: string;
    focus?: string;
    date?: string;
  };
  // I vecchi link a "saldi" e "budget" aprono la sotto-vista del tab Spese.
  const legacyView = search.tab === 'balances' || search.tab === 'budget' ? search.tab : undefined;
  // I biglietti ora stanno nelle prenotazioni.
  const tab: Tab = legacyView
    ? 'expenses'
    : search.tab === 'tickets'
      ? 'bookings'
      : TABS.includes(search.tab as Tab)
        ? (search.tab as Tab)
        : 'plan';
  const view: MoneyView =
    legacyView ??
    (MONEY_VIEWS.includes(search.view as MoneyView) ? (search.view as MoneyView) : 'list');
  const go = (next: Tab, nextView?: MoneyView) =>
    void navigate({
      to: '.',
      search: {
        tab: next === 'plan' ? undefined : next,
        view: next === 'expenses' && nextView && nextView !== 'list' ? nextView : undefined,
      },
      replace: true,
    });
  const { data: trip, error } = useQuery(trpc.trips.get.queryOptions({ id: tripId }));
  // Aperto da una notifica: si evidenzia l'elemento e si toglie l'indicazione dall'indirizzo.
  useEffect(() => {
    if (!trip || (!search.focus && !search.date)) return;
    focusItem(search.focus ?? '', search.date);
    void navigate({
      to: '.',
      search: { tab: search.tab, view: search.view },
      replace: true,
    });
  }, [trip?.id, search.focus, search.date]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tripId) rememberTrip(tripId);
  }, [tripId]);
  // I ricordi stanno nella pagina Ricordi: i vecchi link (e le notifiche) portano lì.
  useEffect(() => {
    if (search.tab === 'memories') void navigate({ to: '/app/memories', replace: true });
  }, [search.tab]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adding, setAdding] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const ai = useAiStatus();
  const [addRequest, setAddRequest] = useState({ target: '', n: 0 });
  // Il "+" in basso aggiunge qualcosa nel tab attivo.
  const target = tab === 'expenses' ? (view === 'budget' ? 'budget' : 'expenses') : tab;
  const viewerCan = target === 'notes' || target === 'assistant';
  const fabTarget = target === 'settings' ? 'expenses' : target;
  const [capturing, setCapturing] = useState(false);
  const manualAdd = () =>
    fabTarget === 'expenses'
      ? setAdding(true)
      : setAddRequest((r) => ({ target: fabTarget, n: r.n + 1 }));
  // Dove un documento fotografato è utile, il "+" apre il foglio fotocamera / galleria /
  // manuale; senza AI si passa subito all'inserimento manuale.
  const captureTab = CAPTURE_TABS.includes(fabTarget as (typeof CAPTURE_TABS)[number]);
  useFabAction(
    trip && (trip.role !== 'viewer' || viewerCan)
      ? {
          label: t(`trip.fab.${fabTarget}`),
          run: () =>
            captureTab && trip.role !== 'viewer' && ai.data?.available
              ? setCapturing(true)
              : manualAdd(),
        }
      : null,
  );

  if (error) {
    return (
      <div className="mt-16 text-center">
        <p className="text-5xl">🧭</p>
        <p className="mt-4 font-semibold">{t('trip.notFound')}</p>
        <Button asChild variant="outline" className="mt-6">
          <Link to="/app">{t('common.back')}</Link>
        </Button>
      </div>
    );
  }
  if (!trip) return <Loader2 className="mx-auto mt-20 animate-spin text-muted-foreground" />;

  const canEdit = trip.role !== 'viewer';
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };
  // Il risultato apre il tab giusto e vi evidenzia l'elemento, senza aprirne la scheda.
  const pick = (r: SearchResult) => {
    closeSearch();
    go(r.tab, r.view);
    focusItem(r.key, r.date);
  };
  const myBalance = trip.ledger.balances[trip.myMemberId] ?? 0;
  const activeMembers = trip.members.filter((m) => !m.removed);

  return (
    <div className="-mx-4 -mt-6 lg:-mx-8 lg:-mt-10">
      <TripCover
        coverImage={trip.coverImage}
        coverColor={trip.coverColor}
        className="h-56 sm:h-64 lg:rounded-b-[2rem]"
      >
        <div className="mx-auto flex h-full max-w-4xl flex-col justify-between px-4 pt-4 pb-5 lg:px-8">
          <div className="flex items-center justify-between">
            <Button
              asChild
              size="icon"
              className="bg-black/25 text-white backdrop-blur hover:bg-black/40"
            >
              <Link to="/app" aria-label={t('common.back')}>
                <ArrowLeft />
              </Link>
            </Button>
            <div className="flex items-center gap-2">
              <CoverButton
                active={tab === 'members'}
                label={t('trip.tabs.members')}
                onClick={() => go(tab === 'members' ? 'plan' : 'members')}
              >
                <Users />
              </CoverButton>
              {trip.role === 'owner' && (
                <CoverButton
                  active={tab === 'settings'}
                  label={t('trip.tabs.settings')}
                  onClick={() => go(tab === 'settings' ? 'plan' : 'settings')}
                >
                  <Settings />
                </CoverButton>
              )}
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight drop-shadow-sm sm:text-4xl">
              {trip.emoji ? `${trip.emoji} ` : ''}
              {trip.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-white/85">
              {trip.startDate && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="size-4" />
                  {dateRange(trip.startDate, trip.endDate)}
                </span>
              )}
              {trip.destination && <span>📍 {trip.destination}</span>}
              <span className="tabular">
                {t('trip.totalSpent', { amount: money(trip.ledger.total, trip.currency) })}
              </span>
              <AvatarStack users={activeMembers} max={6} />
            </div>
            <div className="mt-1.5">
              <CoverCredit credit={trip.coverCredit} />
            </div>
          </div>
        </div>
      </TripCover>

      <div className="mx-auto max-w-4xl px-4 pt-5 lg:px-8">
        <AddRequestContext.Provider value={addRequest}>
          <Tabs value={tab} onValueChange={(value) => go(value as Tab)}>
            {/* La riga resta ferma sotto l'intestazione mentre si scorre. */}
            <div className="sticky top-14 z-20 -mx-4 flex items-center gap-2 bg-background/90 px-4 py-2 backdrop-blur lg:top-0 lg:-mx-8 lg:px-8">
              <button
                type="button"
                onClick={() => (searching ? closeSearch() : setSearching(true))}
                aria-label={searching ? t('search.close') : t('search.button')}
                title={searching ? t('search.close') : t('search.button')}
                aria-pressed={searching}
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full transition [&_svg]:size-5',
                  searching
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'bg-primary/15 text-primary hover:bg-primary/25',
                )}
              >
                <Search />
              </button>
              {searching ? (
                <Input
                  autoFocus
                  type="search"
                  enterKeyHint="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && closeSearch()}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.placeholder')}
                  className="min-w-0 flex-1 rounded-full"
                />
              ) : (
                <TabsList className="min-w-0">
                  {MAIN_TABS.map((x) => (
                    <TabsTrigger key={x} value={x}>
                      {t(`trip.tabs.${x}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
              )}
              {ai.data?.available && (
                <button
                  type="button"
                  onClick={() => {
                    // L'assistente chiude la ricerca e si apre (o si richiude) come al solito.
                    closeSearch();
                    go(tab === 'assistant' && !searching ? 'plan' : 'assistant');
                  }}
                  aria-label={t('trip.tabs.assistant')}
                  title={t('trip.tabs.assistant')}
                  aria-pressed={tab === 'assistant' && !searching}
                  className={cn(
                    'ml-auto flex size-10 shrink-0 items-center justify-center rounded-full transition [&_svg]:size-5',
                    tab === 'assistant' && !searching
                      ? 'bg-amber-400 text-amber-950 shadow-sm'
                      : 'bg-amber-400/15 text-amber-500 hover:bg-amber-400/25',
                  )}
                >
                  <Sparkles />
                </button>
              )}
            </div>
            {searching && (
              <div className="mt-6">
                <SearchPanel
                  trip={trip}
                  query={query}
                  onPick={pick}
                  onAsk={
                    ai.data?.available
                      ? (question) => {
                          askAssistant(question);
                          closeSearch();
                          go('assistant');
                        }
                      : undefined
                  }
                />
              </div>
            )}
            {!searching && (
              <>
                <TabsContent value="plan">
                  <PlanTab trip={trip} />
                </TabsContent>
                <TabsContent value="assistant">
                  <AssistantTab trip={trip} />
                </TabsContent>
                <TabsContent value="expenses">
                  <div className="mb-5 flex items-center gap-3">
                    <div className="inline-flex rounded-full bg-muted p-1">
                      {MONEY_VIEWS.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => go('expenses', v)}
                          className={cn(
                            'rounded-full px-3.5 py-1 text-sm font-medium transition',
                            view === v ? 'bg-card shadow-sm' : 'text-muted-foreground',
                          )}
                        >
                          {t(`trip.money.${v}`)}
                        </button>
                      ))}
                    </div>
                    <BalancePill
                      amount={myBalance}
                      currency={trip.currency}
                      className="ml-auto text-sm"
                    />
                  </div>
                  {view === 'list' && <ExpensesTab trip={trip} />}
                  {view === 'balances' && <BalancesTab trip={trip} />}
                  {view === 'budget' && <BudgetTab trip={trip} />}
                </TabsContent>
                <TabsContent value="bookings">
                  <BookingsTab trip={trip} />
                </TabsContent>
                <TabsContent value="places">
                  <PlacesTab trip={trip} />
                </TabsContent>
                <TabsContent value="packing">
                  <PackingTab trip={trip} />
                </TabsContent>
                <TabsContent value="notes">
                  <NotesTab trip={trip} />
                </TabsContent>
                <TabsContent value="members">
                  <MembersTab trip={trip} />
                </TabsContent>
                {trip.role === 'owner' && (
                  <TabsContent value="settings">
                    <SettingsTab trip={trip} />
                  </TabsContent>
                )}
              </>
            )}
          </Tabs>
        </AddRequestContext.Provider>
      </div>

      {canEdit && <ExpenseDialog trip={trip} open={adding} onOpenChange={setAdding} />}
      {canEdit && (
        <CaptureSheet
          trip={trip}
          open={capturing}
          onOpenChange={setCapturing}
          manualLabel={t('capture.manual')}
          onManual={manualAdd}
        />
      )}
    </div>
  );
}

function CoverButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        'flex size-10 items-center justify-center rounded-full backdrop-blur transition [&_svg]:size-5',
        active ? 'bg-white text-slate-900' : 'bg-black/25 text-white hover:bg-black/40',
      )}
    >
      {children}
    </button>
  );
}
