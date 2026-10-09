import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Copy, Link2, Loader2, LogOut, Mail, Share2, UserPlus, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/input';
import { shortDate } from '@/lib/format';
import { useTRPC } from '@/lib/trpc';
import type { TripDetail } from '@/lib/types';

export function MembersTab({ trip }: { trip: TripDetail }) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canEdit = trip.role !== 'viewer';
  const isOwner = trip.role === 'owner';
  const invites = useQuery({
    ...trpc.invitations.list.queryOptions({ tripId: trip.id }),
    enabled: canEdit,
  });
  const [placeholder, setPlaceholder] = useState('');
  const [email, setEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [emailRole, setEmailRole] = useState<'editor' | 'viewer'>('editor');

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.trips.get.queryKey({ id: trip.id }) }),
      queryClient.invalidateQueries({
        queryKey: trpc.invitations.list.queryKey({ tripId: trip.id }),
      }),
      queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() }),
    ]);
  const onError = (err: { message: string }) =>
    toast.error(t(`members.errors.${err.message}`, { defaultValue: t('common.error') }));
  const addPlaceholder = useMutation(
    trpc.trips.members.addPlaceholder.mutationOptions({ onSuccess: refresh, onError }),
  );
  const updateMember = useMutation(
    trpc.trips.members.update.mutationOptions({ onSuccess: refresh, onError }),
  );
  const removeMember = useMutation(trpc.trips.members.remove.mutationOptions({ onError }));
  const createInvite = useMutation(trpc.invitations.create.mutationOptions({ onError }));
  const revoke = useMutation(
    trpc.invitations.revoke.mutationOptions({ onSuccess: refresh, onError }),
  );

  const share = async (url: string) => {
    const text = t('members.shareText', { title: trip.title });
    if (navigator.share) {
      try {
        await navigator.share({ title: trip.title, text, url });
        return;
      } catch {
        // condivisione annullata: si copia il link
      }
    }
    await navigator.clipboard.writeText(url);
    toast.success(t('members.copied'));
  };

  const newLink = async (memberId?: string) => {
    const res = await createInvite.mutateAsync({ tripId: trip.id, role: 'editor', memberId });
    await refresh();
    await share(res.url);
  };

  const inviteByEmail = async (e: FormEvent) => {
    e.preventDefault();
    await createInvite.mutateAsync({
      tripId: trip.id,
      email: email.trim(),
      role: emailRole,
      ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
    });
    toast.success(t('members.emailSent', { email: email.trim() }));
    setEmail('');
    setInviteName('');
    await refresh();
  };

  const active = trip.members.filter((m) => !m.removed);
  const origin = window.location.origin;

  return (
    <div className="grid gap-6 pb-8">
      <Card className="divide-y">
        {active.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-3 p-4">
            <UserAvatar user={m} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">
                {m.name}
                {m.id === trip.myMemberId && (
                  <span className="font-normal text-muted-foreground"> · {t('expense.you')}</span>
                )}
              </p>
              <div className="mt-0.5 flex flex-wrap gap-1.5">
                {m.invitedEmail ? (
                  <Badge variant="warning" title={m.invitedEmail}>
                    ✉️ {t('members.pending', { email: m.invitedEmail })}
                  </Badge>
                ) : m.placeholder ? (
                  <Badge variant="warning">{t('members.placeholder')}</Badge>
                ) : (
                  <Badge variant="outline">{t(`members.roles.${m.role}`)}</Badge>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && !m.placeholder && m.id !== trip.myMemberId && (
                <Select
                  className="h-9 w-44 text-sm"
                  value={m.role}
                  onChange={(e) =>
                    updateMember.mutate({
                      tripId: trip.id,
                      memberId: m.id,
                      role: e.target.value as 'owner' | 'editor' | 'viewer',
                    })
                  }
                  aria-label={t('members.role')}
                >
                  {(['owner', 'editor', 'viewer'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`members.roles.${r}`)}
                    </option>
                  ))}
                </Select>
              )}
              {canEdit && m.invitedEmail && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={createInvite.isPending}
                  onClick={async () => {
                    await createInvite.mutateAsync({
                      tripId: trip.id,
                      memberId: m.id,
                      email: m.invitedEmail!,
                    });
                    toast.success(t('members.emailSent', { email: m.invitedEmail }));
                    await refresh();
                  }}
                >
                  <Mail />
                  {t('members.resend')}
                </Button>
              )}
              {canEdit && m.placeholder && !m.invitedEmail && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => newLink(m.id)}
                  disabled={createInvite.isPending}
                >
                  <Link2 />
                  {t('members.inviteThem')}
                </Button>
              )}
              {isOwner && m.id !== trip.myMemberId && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 text-muted-foreground"
                  aria-label={t('members.remove')}
                  onClick={async () => {
                    if (!confirm(t('members.confirmRemove', { name: m.name }))) return;
                    await removeMember.mutateAsync({ tripId: trip.id, memberId: m.id });
                    await refresh();
                  }}
                >
                  <X />
                </Button>
              )}
            </div>
          </div>
        ))}
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>{t('members.inviteTitle')}</CardTitle>
            <CardDescription>{t('members.inviteText')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <Button
              variant="accent"
              onClick={() => newLink()}
              disabled={createInvite.isPending}
              className="justify-self-start"
            >
              {createInvite.isPending ? <Loader2 className="animate-spin" /> : <Share2 />}
              {t('members.createLink')}
            </Button>
            <form onSubmit={inviteByEmail} className="flex flex-wrap items-end gap-3">
              <Field label={t('members.byEmail')} htmlFor="inv-email" className="min-w-56 flex-1">
                <Input
                  id="inv-email"
                  type="email"
                  required
                  placeholder="nome@email.it"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
              <Field label={t('members.inviteName')} htmlFor="inv-name" className="min-w-40 flex-1">
                <Input
                  id="inv-name"
                  maxLength={80}
                  placeholder={t('members.inviteNamePlaceholder')}
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </Field>
              <Select
                className="w-44"
                value={emailRole}
                onChange={(e) => setEmailRole(e.target.value as 'editor' | 'viewer')}
                aria-label={t('members.role')}
              >
                <option value="editor">{t('members.roles.editor')}</option>
                <option value="viewer">{t('members.roles.viewer')}</option>
              </Select>
              <Button type="submit" variant="outline" disabled={createInvite.isPending}>
                <Mail />
                {t('members.send')}
              </Button>
            </form>
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={async (e) => {
                e.preventDefault();
                await addPlaceholder.mutateAsync({ tripId: trip.id, name: placeholder.trim() });
                setPlaceholder('');
              }}
            >
              <Field
                label={t('members.addPlaceholder')}
                htmlFor="ph-name"
                hint={t('members.placeholderHint')}
                className="min-w-56 flex-1"
              >
                <Input
                  id="ph-name"
                  required
                  maxLength={80}
                  placeholder="Luca"
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                />
              </Field>
              <Button type="submit" variant="outline" disabled={addPlaceholder.isPending}>
                <UserPlus />
                {t('members.add')}
              </Button>
            </form>

            {invites.data && invites.data.length > 0 && (
              <div className="grid gap-2">
                <p className="text-sm font-medium">{t('members.activeInvites')}</p>
                {invites.data.map((inv) => {
                  const url = `${origin}/invite/${inv.token}`;
                  const target =
                    inv.email ??
                    (inv.memberId ? trip.members.find((m) => m.id === inv.memberId)?.name : null);
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {target ?? t('members.openLink')}
                        <span className="text-muted-foreground">
                          {' '}
                          · {t(`members.roles.${inv.role}`)} ·{' '}
                          {t('members.expires', {
                            date: shortDate(String(inv.expiresAt).slice(0, 10)),
                          })}
                          {inv.maxUses ? '' : ` · ${t('members.uses', { count: inv.uses })}`}
                        </span>
                      </span>
                      {!inv.email && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-8"
                          aria-label={t('members.copy')}
                          onClick={() => share(url)}
                        >
                          <Copy />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        aria-label={t('members.revoke')}
                        onClick={() => revoke.mutate({ tripId: trip.id, id: inv.id })}
                      >
                        <X />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Button
        variant="ghost"
        className="justify-self-start text-destructive"
        onClick={async () => {
          if (!confirm(t('members.confirmLeave'))) return;
          try {
            await removeMember.mutateAsync({ tripId: trip.id, memberId: trip.myMemberId });
            await queryClient.invalidateQueries({ queryKey: trpc.trips.list.queryKey() });
            await navigate({ to: '/app' });
          } catch {
            // errore già mostrato
          }
        }}
      >
        <LogOut />
        {t('members.leave')}
      </Button>
    </div>
  );
}
