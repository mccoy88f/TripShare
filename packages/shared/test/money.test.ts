import { describe, expect, it } from 'vitest';
import { convertMinor, formatMoney, fromMinor, toMinor } from '../src/money.js';
import { normalizePaypalMe, paypalMeLink } from '../src/paypal.js';
import { pickLocale } from '../src/locales.js';

describe('money', () => {
  it('converts between major and minor units', () => {
    expect(toMinor(23.5, 'GBP')).toBe(2350);
    expect(toMinor(0.1 + 0.2, 'EUR')).toBe(30);
    expect(toMinor(1500, 'JPY')).toBe(1500);
    expect(fromMinor(2350, 'GBP')).toBe(23.5);
    expect(convertMinor(1000, 'GBP', 'EUR', 1.16)).toBe(1160);
  });

  it('formats per locale', () => {
    expect(formatMoney(4250, 'EUR', 'it')).toMatch(/42,50\s?€/);
    expect(formatMoney(4250, 'GBP', 'en')).toBe('£42.50');
  });
});

describe('paypal', () => {
  it('normalizes usernames', () => {
    expect(normalizePaypalMe('https://www.paypal.me/Marco88/10')).toBe('Marco88');
    expect(normalizePaypalMe('paypal.me/marco')).toBe('marco');
    expect(normalizePaypalMe('not valid!')).toBeNull();
  });

  it('builds prefilled links', () => {
    expect(paypalMeLink('marco', 4250, 'EUR')).toBe('https://paypal.me/marco/42.50EUR');
    expect(paypalMeLink('marco', 1500, 'JPY')).toBe('https://paypal.me/marco/1500JPY');
    expect(paypalMeLink('marco', 1000, 'RON')).toBeNull();
    expect(paypalMeLink('marco', 0, 'EUR')).toBeNull();
  });
});

describe('locales', () => {
  it('picks a supported locale', () => {
    expect(pickLocale('en-US,en;q=0.9')).toBe('en');
    expect(pickLocale(['fr-FR', 'it-IT'])).toBe('it');
    expect(pickLocale('de')).toBe('it');
  });
});
