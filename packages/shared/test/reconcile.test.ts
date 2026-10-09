import { describe, expect, it } from 'vitest';
import {
  matchBooking,
  matchExpense,
  matchPlace,
  mergeBooking,
  type Booking,
  type Place,
} from '../src/trip-format/index.js';

const flight: Booking = {
  id: 'volo-andata',
  type: 'flight',
  title: 'Volo Roma → Edimburgo',
  status: 'to_book',
  start: { date: '2026-10-12', time: '12:40' },
  flight: { number: 'FR 5590', from: 'CIA', to: 'EDI' },
  links: [],
};
const hotel: Booking = {
  id: 'the-spires',
  type: 'lodging',
  title: 'The Spires Serviced Apartments',
  status: 'booked',
  confirmationCode: '4471.902.113',
  start: { date: '2026-10-12' },
  end: { date: '2026-10-13' },
  links: [],
};

describe('reconcile', () => {
  it('matches bookings by code, flight number and date, or type, date and name', () => {
    const existing = [flight, hotel];
    expect(
      matchBooking(
        { ...hotel, id: 'x', title: 'Ricevuta', confirmationCode: '4471902113' },
        existing,
      ),
    ).toBe(hotel);
    expect(
      matchBooking(
        {
          ...flight,
          id: 'y',
          title: 'Carta imbarco',
          flight: { number: 'FR5590', from: 'Ciampino', to: 'Edinburgh' },
        },
        existing,
      ),
    ).toBe(flight);
    expect(
      matchBooking(
        { ...hotel, id: 'z', confirmationCode: undefined, title: 'Spires Apartments Edinburgh' },
        existing,
      ),
    ).toBe(hotel);
    expect(
      matchBooking(
        { ...hotel, id: 'w', confirmationCode: undefined, start: { date: '2026-10-14' } },
        existing,
      ),
    ).toBeUndefined();
  });

  it('merges the document data into the existing booking without losing anything', () => {
    const { merged, changes } = mergeBooking(flight, {
      ...flight,
      id: 'other',
      status: 'booked',
      confirmationCode: 'K7Q2ZP',
      start: { date: '2026-10-12', time: '12:50' },
      cost: { amount: 189.98, currency: 'EUR', basis: 'total', approximate: false },
      paid: true,
      links: [{ title: 'Check-in', url: 'https://ryanair.com/checkin' }],
    });
    expect(merged).toMatchObject({
      id: 'volo-andata',
      status: 'booked',
      confirmationCode: 'K7Q2ZP',
      paid: true,
      start: { time: '12:50' },
      flight: { number: 'FR 5590' },
    });
    expect(changes.map((c) => c.field)).toEqual([
      'confirmationCode',
      'startTime',
      'cost',
      'paid',
      'booked',
      'links',
    ]);
    expect(mergeBooking(hotel, { ...hotel, id: 'x' }).changes).toEqual([]);
  });

  it('recognises existing places and expenses', () => {
    const places: Place[] = [
      { id: 'kingsmills', name: 'Kingsmills Hotel', kind: 'lodging', tips: [], links: [] },
    ];
    expect(
      matchPlace(
        { id: 'k2', name: 'Kingsmills Hotel Inverness', kind: 'lodging', tips: [], links: [] },
        places,
      ),
    ).toBe(places[0]);
    expect(
      matchPlace({ id: 'k3', name: 'Castello', kind: 'sight', tips: [], links: [] }, places),
    ).toBeUndefined();

    const expenses = [
      {
        id: 'e1',
        title: 'Hotel',
        amount: 20300,
        currency: 'EUR',
        date: '2026-10-12',
        bookingId: 'the-spires',
        status: 'planned',
      },
      {
        id: 'e2',
        title: 'Cena',
        amount: 9240,
        currency: 'GBP',
        date: '2026-10-13',
        bookingId: null,
        status: 'paid',
      },
    ];
    expect(
      matchExpense({ title: 'Ricevuta', amount: 1, currency: 'EUR' }, expenses, 'the-spires')?.id,
    ).toBe('e1');
    expect(
      matchExpense(
        { title: 'The Grain Store', amount: 9240, currency: 'GBP', date: '2026-10-14' },
        expenses,
      )?.id,
    ).toBe('e2');
    expect(
      matchExpense({ title: 'Cena', amount: 9240, currency: 'EUR', date: '2026-10-20' }, expenses),
    ).toBeUndefined();
  });
});
