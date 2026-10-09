import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Colore stabile ricavato da una stringa, per gli avatar senza foto. */
export function colorFromString(value: string): string {
  let hash = 0;
  for (const ch of value) hash = (hash * 31 + ch.codePointAt(0)!) | 0;
  return `oklch(0.7 0.13 ${Math.abs(hash) % 360})`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}
