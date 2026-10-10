import { describe, expect, it } from 'vitest';
import { emptyWizard, isMainStop, patchWizard } from './wizard-state';

const place = (label: string, lat: number, lon: number) => ({ label, lat, lon });
const edimburgo = place('Edimburgo, Regno Unito', 55.95, -3.19);
const fortWilliam = place('Fort William, Regno Unito', 56.82, -5.11);
const glasgow = place('Glasgow, Regno Unito', 55.86, -4.25);

describe('wizard: destinazione principale come tappa', () => {
  const base = patchWizard(emptyWizard(edimburgo), {
    main: edimburgo,
    start: '2026-10-12',
    end: '2026-10-16',
  });

  it('non crea tappe finché non ce ne sono altre', () => {
    expect(base.stops).toEqual([]);
  });

  it('aggiungendo una tappa la principale entra nell’elenco', () => {
    const s = patchWizard(base, { stops: [{ ...fortWilliam, nights: 1 }] });
    expect(s.stops.map((x) => x.label)).toEqual([edimburgo.label, fortWilliam.label]);
    expect(isMainStop(s, s.stops[0]!)).toBe(true);
    expect(s.stops.reduce((n, x) => n + x.nights, 0)).toBe(4);
  });

  it('cambiando la principale cambia anche la sua tappa', () => {
    const s = patchWizard(patchWizard(base, { stops: [{ ...fortWilliam, nights: 1 }] }), {
      main: glasgow,
    });
    expect(s.stops.some((x) => x.label === glasgow.label)).toBe(true);
    expect(s.stops.some((x) => x.label === edimburgo.label)).toBe(false);
  });

  it('togliendo le altre tappe resta solo la principale', () => {
    const s = patchWizard(base, { stops: [{ ...fortWilliam, nights: 1 }] });
    const only = patchWizard(s, { stops: s.stops.filter((x) => isMainStop(s, x)) });
    expect(only.stops).toEqual([]);
  });
});
