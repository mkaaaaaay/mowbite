import {fromBase64, toBase64} from './base64';
import {callRpc} from './rpc';
import {sha256Hex} from './sha256';

export interface ImageRef {
  name: string;
  sha256: string;
  bytes: number;
}

// an image MowBite OS gives in pieces (setup.image, vision.obstacles.image) as a data url, kept in memory only by its
// checksum, refused when the checksum, the type or the size doesn't fit
const images = new Map<string, Promise<string>>();
export function rpcImage(method: string, ref: ImageRef, type: string, piece: number, max: number): Promise<string> {
  let p = images.get(ref.sha256);
  if (!p) {
    p = fetchImage(method, ref, type, piece, max);
    images.set(ref.sha256, p);
    p.catch(() => images.delete(ref.sha256));
  }
  return p;
}

async function fetchImage(method: string, ref: ImageRef, type: string, piece: number, max: number): Promise<string> {
  if (ref.bytes > max) throw new Error(`image ${ref.name} too large`);
  const pieces: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const r = await callRpc<{size: number; offset: number; data: string; sha256: string; type: string}>(method, {name: ref.name, offset: got, size: piece});
    if (r.type !== type || r.size > max || r.offset !== got) throw new Error(`image ${ref.name} unusable`);
    const part = fromBase64(r.data);
    if (!part.length) break;
    pieces.push(part);
    got += part.length;
    if (got >= r.size) break;
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const part of pieces) {
    bytes.set(part, at);
    at += part.length;
  }
  if ((await sha256Hex(bytes)) !== ref.sha256) throw new Error(`image ${ref.name} damaged`);
  return `data:${type};base64,${toBase64(bytes)}`;
}
