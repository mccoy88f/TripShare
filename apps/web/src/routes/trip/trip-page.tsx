import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft, CalendarDays, Loader2, Plus, Settings, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AvatarStack } from '@/components/avatar-stack';
import { TripCover } from '@/components/trip-cover';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { dateRange, money } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import { BalancePill } from '@/routes/trips';
import { BalancesTab } from './balances-tab';
import { ExpenseDialog } from './expense-dialog';
import { ExpensesTab } from './expenses-tab';
import { MembersTab } from './members-tab';
import { NotesTab } from './notes-tab';
import { SettingsTab } from './settings-tab';
import { BookingsTab } from './plan/bookings-tab';
import { BudgetTab } from './plan/budget-tab';
import { PackingTab } from './plan/packing-tab';
import { PlacesTab } from './plan/places-tab';
import { PlanTab } from './plan/plan-tab';
import { TicketsTab } from './plan/tickets-tab';
import { cn } from '@/lib/utils';

/** Tab visibili nella barra; membri e impostazioni sono icone a destra. */
const MAIN_TABS = [
  'plan',
  'expenses',
  'bookings',
  'tickets',
  'places',
  'packing',
  'notes',
] as const;
const TABS = [...MAIN_TABS, 'members', 'settings'] as const;
type Tab = (typeof TABS)[number];
/** Sotto-viste del tab Spese. */
const MONEY_VIEWS = ['list', 'balances', 'budget'] as const;
type MoneyView = (typeof MONEY_VIEWS)[number];

export function TripPage() {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const { tripId } = useParams({ strict: false }) as { tripId: string };
  const search = useSearch({ strict: false }) as { tab?: string; view?: string };
  // I vecchi link a "saldi" e "budget" aprono la sotto-vista del tab Spese.
  const legacyView = search.tab === 'balances' || search.tab === 'budget' ? search.tab : undefined;
  const tab: Tab = legacyView
    ? 'expenses'
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
  const [adding, setAdding] = useState(false);

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
            <BalancePill amount={myBalance} currency={trip.currency} className="text-sm" />
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
          </div>
        </div>
      </TripCover>

      <div className="mx-auto max-w-4xl px-4 pt-5 lg:px-8">
        <Tabs value={tab} onValueChange={(value) => go(value as Tab)}>
          <div className="flex items-center gap-2">
            <TabsList className="min-w-0 flex-1 sm:flex-none">
              {MAIN_TABS.map((x) => (
                <TabsTrigger key={x} value={x}>
                  {t(`trip.tabs.${x}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <IconTab
                active={tab === 'members'}
                label={t('trip.tabs.members')}
                onClick={() => go('members')}
              >
                <Users />
              </IconTab>
              {trip.role === 'owner' && (
                <IconTab
                  active={tab === 'settings'}
                  label={t('trip.tabs.settings')}
                  onClick={() => go('settings')}
                >
                  <Settings />
                </IconTab>
              )}
            </div>
          </div>
          <TabsContent value="plan">
            <PlanTab trip={trip} />
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
              {canEdit && (
                <Button onClick={() => setAdding(true)} className="ml-auto hidden sm:inline-flex">
                  <Plus />
                  {t('expense.add')}
                </Button>
              )}
            </div>
            {view === 'list' && <ExpensesTab trip={trip} />}
            {view === 'balances' && <BalancesTab trip={trip} />}
            {view === 'budget' && <BudgetTab trip={trip} />}
          </TabsContent>
          <TabsContent value="bookings">
            <BookingsTab trip={trip} />
          </TabsContent>
          <TabsContent value="tickets">
            <TicketsTab trip={trip} />
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
        </Tabs>
      </div>

      {canEdit && (
        <>
          <button
            onClick={() => setAdding(true)}
            aria-label={t('expense.add')}
            className="fixed right-5 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 flex size-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-accent/30 transition active:scale-95 sm:hidden"
          >
            <Plus className="size-6" />
          </button>
          <ExpenseDialog trip={trip} open={adding} onOpenChange={setAdding} />
        </>
      )}
    </div>
  );
}

function IconTab({
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
        'flex size-10 items-center justify-center rounded-full transition [&_svg]:size-5',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'bg-muted text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
