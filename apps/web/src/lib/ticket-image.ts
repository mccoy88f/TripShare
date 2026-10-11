/**
 * Immagine di un biglietto da salvare o inviare: intestazione colorata con titolo e data, dati,
 * codice (QR, Aztec, barre…) su fondo bianco, numero di prenotazione. Si disegna in un canvas,
 * quindi funziona offline e senza server.
 */
export interface TicketCard {
  emoji: string;
  title: string;
  subtitle?: string;
  /** Coppie etichetta/valore (fino a quattro) sotto l'intestazione. */
  rows: [string, string][];
  /** Il codice, come SVG già generato, con il testo che contiene. */
  code?: { svg: string; text: string; wide: boolean };
  /** Foto del biglietto da mostrare quando non c'è un codice. */
  photo?: Blob;
  reference?: string;
  referenceLabel: string;
  footerLeft: string;
  footerRight: string;
}

const FRAME = 48;
const CARD_W = 1080;
const W = CARD_W + FRAME * 2;
const PAD = 64;
const TEAL = '#17b3a3';
const INDIGO = '#6a74e6';
const FONT = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace';

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const spacing = (ctx: Ctx, px: string) => {
  if ('letterSpacing' in ctx) (ctx as Ctx & { letterSpacing: string }).letterSpacing = px;
};

/** Spezza un testo in righe che stanno nella larghezza data (anche senza spazi, per i codici). */
function wrap(ctx: Ctx, text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '';
  const flush = () => {
    if (line) lines.push(line);
    line = '';
  };
  for (const word of text.split(/(\s+)/)) {
    if (ctx.measureText(line + word).width <= width) {
      line += word;
      continue;
    }
    flush();
    // Una parola più lunga della riga si spezza per caratteri.
    for (const ch of word.trimStart()) {
      if (ctx.measureText(line + ch).width > width) flush();
      line += ch;
    }
  }
  flush();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1]!.replace(/.{1}$/, '')}…`;
    return kept;
  }
  return lines.map((l) => l.trim());
}

/** Dà all'SVG di ZXing un viewBox, così si ridimensiona senza perdere i moduli. */
function scalableSvg(svg: string): string {
  const clean = svg.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>/g, '');
  const w = /<svg[^>]*\swidth="(\d+(?:\.\d+)?)/.exec(clean)?.[1];
  const h = /<svg[^>]*\sheight="(\d+(?:\.\d+)?)/.exec(clean)?.[1];
  if (!w || !h || /viewBox=/.test(clean.slice(0, 400))) return clean;
  return clean.replace(/<svg\b/, `<svg viewBox="0 0 ${w} ${h}"`);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('IMAGE_FAILED'));
    img.src = src;
  });
}

interface Assets {
  code?: HTMLImageElement;
  photo?: HTMLImageElement;
}

/** Disegna la scheda (o, con `draw` falso, ne misura soltanto l'altezza). */
function paint(ctx: Ctx, card: TicketCard, assets: Assets, draw: boolean, total: number): number {
  const x0 = FRAME;
  const inner = CARD_W - PAD * 2;
  let y = FRAME;

  // ── Intestazione ──
  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 58px ${FONT}`;
  spacing(ctx, '-1px');
  const titleLines = wrap(ctx, card.title, inner, 3);
  const headTop = y;
  const headH = 56 + 84 + 22 + titleLines.length * 64 + (card.subtitle ? 14 + 40 : 0) + 64;
  if (draw) {
    ctx.save();
    roundRect(ctx, x0, y, CARD_W, total - FRAME * 2, 44);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x0, y, CARD_W, total - FRAME * 2);
    const gradient = ctx.createLinearGradient(x0, headTop, x0 + CARD_W, headTop + headH);
    gradient.addColorStop(0, TEAL);
    gradient.addColorStop(1, INDIGO);
    ctx.fillStyle = gradient;
    ctx.fillRect(x0, headTop, CARD_W, headH);
    ctx.fillStyle = '#fff';
    ctx.font = `84px ${FONT}`;
    spacing(ctx, '0px');
    ctx.fillText(card.emoji, x0 + PAD, y + 56 + 72);
    ctx.font = `800 58px ${FONT}`;
    spacing(ctx, '-1px');
    titleLines.forEach((line, i) => ctx.fillText(line, x0 + PAD, y + 56 + 84 + 22 + 50 + i * 64));
    if (card.subtitle) {
      ctx.globalAlpha = 0.9;
      ctx.font = `500 34px ${FONT}`;
      spacing(ctx, '0px');
      ctx.fillText(card.subtitle, x0 + PAD, y + headH - 64 - 8);
      ctx.globalAlpha = 1;
    }
    // Linea tratteggiata e "tagli" ai lati, come su un biglietto.
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 4;
    ctx.setLineDash([12, 10]);
    ctx.beginPath();
    ctx.moveTo(x0 + PAD, y + headH - 2);
    ctx.lineTo(x0 + CARD_W - PAD, y + headH - 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.fillStyle = '#e9edf3';
    for (const cx of [x0, x0 + CARD_W]) {
      ctx.beginPath();
      ctx.arc(cx, y + headH, 34, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  y += headH + PAD;

  // ── Dati ──
  const colW = (inner - 40) / 2;
  const rows = card.rows.filter(([, v]) => v).slice(0, 4);
  for (let i = 0; i < rows.length; i += 2) {
    let rowH = 0;
    for (const [col, [label, value]] of rows.slice(i, i + 2).entries()) {
      ctx.font = `700 36px ${FONT}`;
      spacing(ctx, '0px');
      const lines = wrap(ctx, value, colW, 2);
      rowH = Math.max(rowH, 31 + lines.length * 44);
      if (draw) {
        const x = x0 + PAD + col * (colW + 40);
        ctx.fillStyle = '#667085';
        ctx.font = `600 25px ${FONT}`;
        spacing(ctx, '1px');
        ctx.fillText(label.toUpperCase(), x, y + 22);
        ctx.fillStyle = '#101828';
        ctx.font = `700 36px ${FONT}`;
        spacing(ctx, '0px');
        lines.forEach((line, k) => ctx.fillText(line, x, y + 31 + 34 + k * 44));
      }
    }
    y += rowH + 34;
  }
  if (rows.length) y += 18;

  // ── Codice (o foto del biglietto) ──
  if (card.code && assets.code) {
    const wide = card.code.wide;
    const boxW = wide ? inner : 560;
    const boxH = wide ? 240 : 560;
    const bx = x0 + (CARD_W - boxW) / 2;
    if (draw) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#e4e7ec';
      ctx.fillStyle = '#fff';
      roundRect(ctx, bx, y, boxW, boxH, 32);
      ctx.fill();
      ctx.stroke();
      const pad = 26;
      const ratio = assets.code.width / assets.code.height;
      const aw = boxW - pad * 2;
      const ah = boxH - pad * 2;
      const dw = Math.min(aw, ah * ratio);
      const dh = dw / ratio;
      ctx.drawImage(assets.code, bx + (boxW - dw) / 2, y + (boxH - dh) / 2, dw, dh);
    }
    y += boxH + 22;
    ctx.font = `500 24px ${MONO}`;
    spacing(ctx, '0px');
    const lines = wrap(ctx, card.code.text, inner - 40, 3);
    if (draw) {
      ctx.fillStyle = '#667085';
      ctx.textAlign = 'center';
      lines.forEach((line, i) => ctx.fillText(line, x0 + CARD_W / 2, y + 22 + i * 32));
      ctx.textAlign = 'left';
    }
    y += lines.length * 32 + 22;
  } else if (assets.photo) {
    const aw = inner;
    const ratio = assets.photo.width / assets.photo.height;
    const ah = Math.min(900, aw / ratio);
    const dw = Math.min(aw, ah * ratio);
    if (draw) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#e4e7ec';
      ctx.lineWidth = 3;
      roundRect(ctx, x0 + PAD, y, aw, ah, 24);
      ctx.fill();
      ctx.stroke();
      ctx.save();
      roundRect(ctx, x0 + PAD, y, aw, ah, 24);
      ctx.clip();
      ctx.drawImage(assets.photo, x0 + PAD + (aw - dw) / 2, y, dw, ah);
      ctx.restore();
    }
    y += ah + 40;
  }

  // ── Numero di prenotazione ──
  if (card.reference) {
    const big = !card.code && !assets.photo;
    const boxH = big ? 262 : 172;
    if (draw) {
      ctx.fillStyle = '#f2f4f7';
      roundRect(ctx, x0 + PAD, y, inner, boxH, 28);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#667085';
      ctx.font = `600 25px ${FONT}`;
      spacing(ctx, '0px');
      ctx.fillText(card.referenceLabel, x0 + CARD_W / 2, y + (big ? 96 : 62));
      ctx.fillStyle = '#101828';
      let size = big ? 112 : 64;
      ctx.font = `700 ${size}px ${MONO}`;
      spacing(ctx, `${Math.round(size * 0.12)}px`);
      // Un numero lungo si rimpicciolisce per restare nella scheda.
      while (ctx.measureText(card.reference).width > inner - 60 && size > 28) {
        size -= 4;
        ctx.font = `700 ${size}px ${MONO}`;
        spacing(ctx, `${Math.round(size * 0.12)}px`);
      }
      ctx.fillText(card.reference, x0 + CARD_W / 2, y + (big ? 200 : 130));
      ctx.textAlign = 'left';
    }
    y += boxH + 44;
  }

  // ── Piè di pagina ──
  y += 4;
  if (draw) {
    ctx.strokeStyle = '#eaecf0';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0 + PAD, y);
    ctx.lineTo(x0 + CARD_W - PAD, y);
    ctx.stroke();
    const gradient = ctx.createLinearGradient(x0 + PAD, 0, x0 + PAD + 200, 0);
    gradient.addColorStop(0, TEAL);
    gradient.addColorStop(1, INDIGO);
    ctx.fillStyle = gradient;
    ctx.font = `800 34px ${FONT}`;
    spacing(ctx, '0px');
    ctx.fillText(card.footerLeft, x0 + PAD, y + 62);
    ctx.fillStyle = '#667085';
    ctx.font = `400 25px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(card.footerRight, x0 + CARD_W - PAD, y + 60);
    ctx.textAlign = 'left';
  }
  y += 30 + 56 + 44;
  return y + FRAME;
}

/** Crea l'immagine PNG del biglietto. */
export async function renderTicketImage(card: TicketCard): Promise<Blob> {
  // I caratteri dell'app devono essere pronti prima di disegnare.
  await Promise.all(
    ['400 25px', '500 34px', '600 25px', '700 36px', '800 58px'].map((f) =>
      document.fonts?.load(`${f} "Inter Variable"`).catch(() => undefined),
    ),
  );
  const assets: Assets = {};
  const urls: string[] = [];
  try {
    if (card.code) {
      const url = URL.createObjectURL(
        new Blob([scalableSvg(card.code.svg)], { type: 'image/svg+xml' }),
      );
      urls.push(url);
      assets.code = await loadImage(url);
    } else if (card.photo) {
      const url = URL.createObjectURL(card.photo);
      urls.push(url);
      assets.photo = await loadImage(url).catch(() => undefined);
    }
    const scratch = document.createElement('canvas');
    scratch.width = W;
    scratch.height = 10;
    const height = Math.ceil(paint(scratch.getContext('2d')!, card, assets, false, 0));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e9edf3';
    ctx.fillRect(0, 0, W, height);
    paint(ctx, card, assets, true, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('IMAGE_FAILED'))), 'image/png'),
    );
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}

const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Salva l'immagine: sul telefono si apre il foglio di condivisione ("Salva immagine", "Foto",
 * WhatsApp…), sul computer parte il download.
 */
export async function saveTicketImage(blob: Blob, name: string): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], name, { type: 'image/png' });
  if (isPhone() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      // Foglio chiuso dall'utente: nessun errore; altro problema: si scarica comunque.
      if ((err as Error).name === 'AbortError') return 'shared';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
