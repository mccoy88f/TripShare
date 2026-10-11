import { zipSync } from 'fflate';

const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
export const pkpass = (pass: unknown) =>
  Buffer.from(zipSync({ 'pass.json': enc(pass), 'icon.png': new Uint8Array([1, 2, 3]) }));
export const googleUrl = (payload: unknown) =>
  `https://pay.google.com/gp/v/save/${[
    Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url'),
    Buffer.from(JSON.stringify({ iss: 'x', payload })).toString('base64url'),
    'firma',
  ].join('.')}`;
