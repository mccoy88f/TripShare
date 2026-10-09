import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const run = DATABASE_URL ? describe : describe.skip;

function multipart(
  fields: Record<string, string>,
  file: { name: string; type: string; data: Buffer },
) {
  const boundary = '----tripshare-ticket';
  const parts = Object.entries(fields).map(([k, v]) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
  );
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    payload: Buffer.concat([
      ...parts,
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`,
      ),
      file.data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

run('booking tickets (integration)', () => {
  let t: Awaited<ReturnType<typeof createTestApp>>;
  beforeAll(async () => {
    t = await createTestApp(DATABASE_URL!, await mkdtemp(join(tmpdir(), 'tripshare-tickets-')));
  });
  beforeEach(async () => t.reset());
  afterAll(async () => t?.close());

  async function upload(
    cookie: string,
    tripId: string,
    fields: Record<string, string>,
    file: { name: string; type: string; data: Buffer },
  ) {
    const body = multipart(fields, file);
    return t.app.inject({
      method: 'POST',
      url: `/api/trips/${tripId}/tickets`,
      headers: { cookie, origin: 'http://localhost:5173', 'content-type': body.contentType },
      payload: body.payload,
    });
  }

  it('uploads tickets, assigns them and serves them only to members', async () => {
    const owner = (await t.signUp('owner@example.com', 'Owner')).cookie;
    const { data: trip } = await t.trpc<{ id: string }>('trips.create', owner, {
      title: 'Scozia',
      currency: 'EUR',
    });
    const { data: luca } = await t.trpc<{ id: string }>('trips.members.addPlaceholder', owner, {
      tripId: trip.id,
      name: 'Luca',
    });

    const pdf = await upload(
      owner,
      trip.id,
      {
        bookingId: 'flight-out',
        memberId: luca.id,
        label: 'Andata',
        codeFormat: 'AztecCode',
        codeValue: 'M1BIANCHI/LUCA',
      },
      {
        name: 'carta-imbarco.pdf',
        type: 'application/pdf',
        data: Buffer.from('%PDF-1.4 test'),
      },
    );
    expect(pdf.statusCode).toBe(200);
    const pass = await upload(
      owner,
      trip.id,
      { bookingId: 'flight-out' },
      {
        name: 'Boarding.pkpass',
        type: 'application/octet-stream',
        data: Buffer.from('PK\u0003\u0004fake'),
      },
    );
    expect(pass.statusCode).toBe(200);
    const exe = await upload(
      owner,
      trip.id,
      { bookingId: 'flight-out' },
      { name: 'x.exe', type: 'application/x-msdownload', data: Buffer.from('MZ') },
    );
    expect(exe.statusCode).toBe(415);

    const code = await t.trpc('tickets.createCode', owner, {
      tripId: trip.id,
      bookingId: 'train',
      codeFormat: 'QRCode',
      codeValue: 'TRENITALIA-123',
      walletUrl: 'https://pay.google.com/gp/v/save/abc',
    });
    expect(code.status).toBe(200);
    const empty = await t.trpc('tickets.createCode', owner, {
      tripId: trip.id,
      bookingId: 'train',
    });
    expect(empty.status).toBe(400);

    const list = await t.trpc<
      {
        id: string;
        memberId: string | null;
        fileUrl: string | null;
        mimeType: string | null;
        codeValue: string | null;
      }[]
    >('tickets.list', owner, { tripId: trip.id }, 'query');
    expect(list.data).toHaveLength(3);
    const boarding = list.data.find((x) => x.codeValue === 'M1BIANCHI/LUCA')!;
    expect(boarding.memberId).toBe(luca.id);
    expect(list.data.find((x) => x.mimeType === 'application/vnd.apple.pkpass')).toBeTruthy();

    const file = await t.app.inject({
      method: 'GET',
      url: boarding.fileUrl!,
      headers: { cookie: owner },
    });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.body).toBe('%PDF-1.4 test');

    const stranger = (await t.signUp('stranger@example.com', 'Stranger')).cookie;
    expect(
      (await t.app.inject({ method: 'GET', url: boarding.fileUrl!, headers: { cookie: stranger } }))
        .statusCode,
    ).toBe(404);
    expect((await t.app.inject({ method: 'GET', url: boarding.fileUrl! })).statusCode).toBe(401);

    // Riassegnazione a tutti ed eliminazione.
    await t.trpc('tickets.update', owner, { tripId: trip.id, id: boarding.id, memberId: null });
    await t.trpc('tickets.delete', owner, { tripId: trip.id, id: boarding.id });
    const after = await t.trpc<unknown[]>('tickets.list', owner, { tripId: trip.id }, 'query');
    expect(after.data).toHaveLength(2);
    expect(
      (await t.app.inject({ method: 'GET', url: boarding.fileUrl!, headers: { cookie: owner } }))
        .statusCode,
    ).toBe(404);
  });
});
