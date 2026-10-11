import { Check, Loader2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Place } from '@tripshare/shared/trip-format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useAiStatus, useAiTask } from '@/lib/ai';
import { usePlanOps } from '@/lib/plan';

/**
 * "Dimmi di più": Nina scrive una breve descrizione del luogo, che si legge subito e si salva
 * solo dopo conferma (niente proposta da rivedere né chat).
 */
export function PlaceInfoButton({
  tripId,
  place,
  onSaved,
}: {
  tripId: string;
  place: Place;
  onSaved: (description: string) => void;
}) {
  const { t } = useTranslation();
  const ai = useAiStatus();
  const [open, setOpen] = useState(false);
  if (!ai.data?.available) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md py-1 text-left text-sm font-medium text-white outline-none hover:underline focus-visible:ring-4 focus-visible:ring-white/30"
      >
        <Sparkles className="size-4 shrink-0 text-amber-400" />
        {t('placePhoto.gallery.tellMore')}
      </button>
      {open && (
        <PlaceInfoDialog
          tripId={tripId}
          place={place}
          onClose={() => setOpen(false)}
          onSaved={(text) => {
            onSaved(text);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function PlaceInfoDialog({
  tripId,
  place,
  onClose,
  onSaved,
}: {
  tripId: string;
  place: Place;
  onClose: () => void;
  onSaved: (description: string) => void;
}) {
  const { t } = useTranslation();
  const { run } = useAiTask();
  const { apply, pending } = usePlanOps(tripId);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const closed = useRef(false);

  useEffect(() => {
    closed.current = false;
    if (started.current) return;
    started.current = true;
    void run<{ description: string }>(tripId, { kind: 'placeInfo', placeId: place.id }).then(
      (r) => {
        if (closed.current) return;
        if (r?.description) setText(r.description);
        else setFailed(true);
      },
    );
    return () => {
      closed.current = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!text) return;
    await apply([{ type: 'upsertPlace', place: { ...place, description: text } }]);
    toast.success(t('placePhoto.gallery.descriptionSaved'));
    onSaved(text);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={place.name} description={t('placePhoto.gallery.aiDescription')}>
        <div className="min-h-24 pt-2">
          {text === null && !failed && (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t('placePhoto.gallery.writing')}
            </p>
          )}
          {failed && (
            <p className="py-6 text-sm text-destructive">{t('placePhoto.gallery.writeFailed')}</p>
          )}
          {text !== null && (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{text}</p>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {text !== null ? t('placePhoto.gallery.discard') : t('common.cancel')}
          </Button>
          {text !== null && (
            <Button type="button" size="lg" disabled={pending} onClick={() => void save()}>
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              {t('common.save')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
