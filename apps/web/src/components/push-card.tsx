import { BellRing, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { usePush } from '@/lib/push';

/** Impostazioni delle notifiche push di questo dispositivo, nel profilo. */
export function PushCard() {
  const { t } = useTranslation();
  const push = usePush();
  const blocked = push.status === 'unsupported' || push.status === 'ios-install';
  return (
    <Card>
      <CardHeader>
        <CardTitle>🔔 {t('push.title')}</CardTitle>
        <CardDescription>{t('push.text')}</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3">
        <label className="flex items-center justify-between gap-4">
          <span className="font-medium">{t('push.thisDevice')}</span>
          <span className="flex items-center gap-2">
            {push.busy && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
            <Switch
              checked={push.status === 'on'}
              disabled={blocked || push.status === 'denied' || push.busy}
              onCheckedChange={(on) => void (on ? push.enable() : push.disable())}
              aria-label={t('push.thisDevice')}
            />
          </span>
        </label>
        {push.status === 'ios-install' && (
          <p className="text-sm text-muted-foreground">{t('push.iosInstall')}</p>
        )}
        {push.status === 'unsupported' && (
          <p className="text-sm text-muted-foreground">{t('push.unsupported')}</p>
        )}
        {push.status === 'denied' && <p className="text-sm text-destructive">{t('push.denied')}</p>}
        {push.error && <p className="text-sm text-destructive">{t('push.error')}</p>}
        {push.status === 'on' && (
          <Button
            type="button"
            variant="outline"
            className="justify-self-start"
            disabled={push.testing}
            onClick={async () => {
              const r = await push.test().catch(() => null);
              if (r && r.sent > 0) toast.success(t('push.testSent'));
              else toast.error(t('push.testFailed'));
            }}
          >
            {push.testing ? <Loader2 className="animate-spin" /> : <BellRing />}
            {t('push.test')}
          </Button>
        )}
        {push.devices > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('push.devices', { count: push.devices })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
