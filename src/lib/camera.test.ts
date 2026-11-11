import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
  afterClosed,
  ANSWER_MS,
  blockedHere,
  cameraLabel,
  cameraParts,
  cameraReason,
  closed,
  pickProtocol,
  pictureRatio,
  playMjpeg,
  playWhep,
  readPictures,
  sortCameras,
  STALL_MS,
  StreamError,
  streamFailure,
  streamUrl,
  withChange,
  type Camera,
} from './camera';
import {setLangChoice} from './i18n';

const cam = (id: string, position: string | null, name = id): Camera => ({
  id,
  name,
  kind: 'obstacle',
  position,
  width: 640,
  height: 480,
  protocols: ['mjpeg'],
  available: true,
});

describe('cameras', () => {
  beforeEach(() => vi.stubGlobal('document', {documentElement: {lang: 'en'}}));
  afterEach(() => {
    setLangChoice('en');
    vi.unstubAllGlobals();
  });

  it('go front, sides, back, then the others by name', () => {
    const list = [cam('r', 'rear'), cam('x', null, 'Zoo'), cam('l', 'left'), cam('f', 'front'), cam('y', 'roof', 'Arm'), cam('s', 'right')];
    expect(sortCameras(list).map((c) => c.id)).toEqual(['f', 'l', 's', 'r', 'y', 'x']);
  });

  it("are named by where they sit, by the mower's name when that isn't known or two sit there", () => {
    setLangChoice('en');
    const list = [cam('f', 'front'), cam('a', 'left', 'Obstacle left'), cam('b', 'left', 'Second left'), cam('x', 'roof', 'Arm')];
    expect(list.map((c) => cameraLabel(c, list))).toEqual(['Front camera', 'Obstacle left', 'Second left', 'Arm']);
    expect(cameraLabel(list[0], list, true)).toBe('Front');
    setLangChoice('de');
    expect(cameraLabel(list[0], list)).toBe('Frontkamera');
    expect(cameraLabel(cam('r', 'rear'), [cam('r', 'rear')], true)).toBe('Hinten');
  });

  it('are switched between by short names with the whole one beside, one alone is just the camera', () => {
    setLangChoice('en');
    const list = [cam('f', 'front'), cam('x', 'roof', 'Arm')];
    expect(cameraParts(list)).toEqual([
      {key: 'f', text: 'Front', name: 'Front camera'},
      {key: 'x', text: 'Arm', name: 'Arm'},
    ]);
    expect(cameraParts([list[0]])).toEqual([{key: 'f', text: 'Camera', name: 'Front camera'}]);
  });

  it('share a place as high as the highest picture needs, never higher than wide', () => {
    expect(pictureRatio([cam('f', 'front'), {...cam('l', 'left'), height: 400}])).toBeCloseTo(4 / 3);
    expect(pictureRatio([{...cam('l', 'left'), height: 400}])).toBeCloseTo(1.6);
    expect(pictureRatio([{...cam('t', null), width: 480, height: 640}])).toBe(1);
    expect(pictureRatio([{...cam('n', null), width: 0, height: 0}])).toBeCloseTo(4 / 3);
    expect(pictureRatio([])).toBeCloseTo(4 / 3);
  });

  it('say why there is no picture, one the app does not know by the words of the mower', () => {
    setLangChoice('de');
    expect(cameraReason('BLADE_RUNNING')).toBe('Nicht, solange das Messer läuft');
    expect(cameraReason('DRIVER_MISSING')).toBe('Der Hardware-Treiber meldet sich nicht, die Kamera wartet auf ihn');
    expect(cameraReason('TOO_HOT')).toBe('Der Rechner des Mähers ist zu heiß, die Kamera macht Pause');
    expect(cameraReason('LENS_DIRTY', 'lens dirty')).toBe('Lens dirty');
    expect(cameraReason(undefined)).toBe('Die Kamera liefert gerade kein Bild');
    setLangChoice('en');
  });

  it('take what a CAMERA_CHANGED says about one of them, one the list does not have is not changed there', () => {
    const list = [cam('f', 'front'), {...cam('l', 'left'), available: false, reason: 'SELF_TEST', detail: 'pending'}];
    expect(withChange(list, {camera_id: 'f', available: false, reason: 'TOO_HOT', message: 'cpu at 91 C'})).toEqual([
      {...list[0], available: false, reason: 'TOO_HOT', detail: 'cpu at 91 C'},
      list[1],
    ]);
    // back again: the reason and its words go
    expect(withChange(list, {camera_id: 'l', available: true})).toEqual([list[0], cam('l', 'left')]);
    expect(withChange(list, {camera_id: 'rear', available: true})).toBeNull();
    expect(withChange(list, {camera_id: 'f'} as never)).toBeNull();
  });

  it('play webrtc where the browser can, else mjpeg, nothing else', () => {
    expect(pickProtocol(['webrtc', 'mjpeg'], true)).toBe('webrtc');
    expect(pickProtocol(['webrtc', 'mjpeg'], false)).toBe('mjpeg');
    expect(pickProtocol(['hls', 'mjpeg'], true)).toBe('mjpeg');
    expect(pickProtocol(['webrtc'], false)).toBeNull();
    expect(pickProtocol(['hls'], true)).toBeNull();
  });

  it("stream from the broker's host, one on this computer and a picture of the demo stay", () => {
    const url = 'http://192.168.1.40:8889/stereo/whep?t=abc';
    expect(streamUrl(url, 'mower.fritz.box')).toBe('http://mower.fritz.box:8889/stereo/whep?t=abc');
    expect(streamUrl(url, '10.8.0.5')).toBe('http://10.8.0.5:8889/stereo/whep?t=abc');
    expect(streamUrl(url, '192.168.1.40')).toBe(url);
    expect(streamUrl(url, 'localhost')).toBe(url);
    expect(streamUrl(url, '127.0.0.1')).toBe(url);
    expect(streamUrl('data:image/svg+xml,x', 'mower')).toBe('data:image/svg+xml,x');
    expect(streamUrl('not a url', 'mower')).toBe('not a url');
  });

  it('are blocked over plain http on an https page', () => {
    expect(blockedHere('http://a:8889/x', 'https:')).toBe(true);
    expect(blockedHere('http://a:8889/x', 'http:')).toBe(false);
    expect(blockedHere('data:image/svg+xml,x', 'https:')).toBe(false);
  });

  it('close one after the other, a failed close holds up nothing', async () => {
    const order: string[] = [];
    closed(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push('first');
    });
    closed(async () => {
      throw new Error('gone');
    });
    await afterClosed();
    order.push('next opens');
    expect(order).toEqual(['first', 'next opens']);
  });
});

describe('a stream of a camera', () => {
  const url = 'http://192.168.1.40:8890/camera/front.mjpg?t=abc';
  const bytes = (text: string) => new TextEncoder().encode(text);
  const part = (picture: string, type = 'image/jpeg') => `--frame\r\nContent-Type: ${type}\r\nContent-Length: ${picture.length}\r\n\r\n${picture}\r\n`;
  // what the network hands over, piece by piece
  const pieces = (...list: string[]) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        list.forEach((p) => c.enqueue(bytes(p)));
        c.close();
      },
    });
  // an answer after ms, given up like fetch does when it's stopped before
  const after = (ms: number, answer: () => Response) => (_url: string, init: RequestInit) =>
    new Promise<Response>((done, fail) => {
      const t = setTimeout(() => done(answer()), ms);
      init.signal!.addEventListener('abort', () => {
        clearTimeout(t);
        fail(new DOMException('aborted', 'AbortError'));
      });
    });
  // a stream that stays open and breaks off when the request is stopped, like the body of a fetch
  const open = (feed?: (c: ReadableStreamDefaultController<Uint8Array>) => void) => async (_url: string, init: RequestInit) =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          feed?.(c);
          init.signal!.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      }),
    );
  // stands in for an <img>: what's put in is drawn a moment later (held back: when the test says), one that's no
  // picture fails instead
  class Img {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    bad = false;
    held = false;
    put: string[] = [];
    get src() {
      return this.put[this.put.length - 1] ?? '';
    }
    set src(v: string) {
      this.put.push(v);
      if (!this.held) queueMicrotask(() => this.drawn());
    }
    drawn() {
      (this.bad ? this.onerror : this.onload)?.();
    }
  }
  const image = () => new Img() as unknown as HTMLImageElement & Img;
  const nothing = () => {};

  beforeEach(() => vi.stubGlobal('document', {documentElement: {lang: 'en'}}));
  afterEach(() => {
    vi.useRealTimers();
    setLangChoice('en');
    vi.unstubAllGlobals();
  });

  it('gives each picture of an mjpeg stream however the network cuts it, one cut off at the end is none', async () => {
    const all = part('first') + part('a line\r\n\r\nin it', 'image/svg+xml') + part('3');
    for (const size of [1, 7, 64, all.length]) {
      const got: Blob[] = [];
      await readPictures(pieces(...all.match(new RegExp(`[^]{1,${size}}`, 'g'))!, part('cut off').slice(0, -6)), (b) => got.push(b));
      expect(await Promise.all(got.map((b) => b.text()))).toEqual(['first', 'a line\r\n\r\nin it', '3']);
      expect(got.map((b) => b.type)).toEqual(['image/jpeg', 'image/svg+xml', 'image/jpeg']);
    }
  });

  it('is none without the length of each part', async () => {
    await expect(readPictures(pieces('--frame\r\nContent-Type: image/jpeg\r\n\r\npicture\r\n'), () => {})).rejects.toThrow();
    await expect(readPictures(pieces('x'.repeat(3000), 'x'.repeat(3000)), () => {})).rejects.toThrow();
  });

  it('tells what its address answered instead of pictures, with the words it said', async () => {
    const said = (body: string, status: number) => vi.stubGlobal('fetch', async () => new Response(body, {status}));
    said('no place for this token\n', 401);
    await expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({status: 401, at: '192.168.1.40:8890', message: 'HTTP 401: no place for this token'});
    said(JSON.stringify({status: 'error', error: "source of path 'stereo' has timed out"}), 400);
    await expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({status: 400, message: "HTTP 400: source of path 'stereo' has timed out"});
    said('', 404);
    await expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({status: 404, message: 'HTTP 404'});
    said(`${'x'.repeat(500)}\nsecond line`, 500);
    await expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({message: `HTTP 500: ${'x'.repeat(120)}`});
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({status: 0, at: '192.168.1.40:8890'});
  });

  it('waits for a no the mower holds back for 4 s and for one after 10 s without a picture, not for ever', async () => {
    vi.useFakeTimers();
    for (const [ms, status] of [
      [4000, 401],
      [10000, 400],
    ]) {
      vi.stubGlobal('fetch', after(ms, () => new Response('', {status})));
      const refused = expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({status});
      await vi.advanceTimersByTimeAsync(ms);
      await refused;
    }
    vi.stubGlobal('fetch', after(ANSWER_MS + 1000, () => new Response('')));
    const late = expect(playMjpeg(url, image(), nothing, nothing)).rejects.toMatchObject({status: 'timeout'});
    await vi.advanceTimersByTimeAsync(ANSWER_MS);
    await late;
  });

  it('shows each picture as it comes, never asks with more than the address, and tells when the stream is over', async () => {
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    const asked: RequestInit[] = [];
    const read = fetch;
    vi.stubGlobal('fetch', (u: string, init: RequestInit) => {
      asked.push(init);
      return open((c) => (feed = c))(u, init);
    });
    const img = image();
    const shown = vi.fn();
    const ended = vi.fn();
    const close = await playMjpeg(url, img, shown, ended);
    // (a header of its own would make the browser ask the mower first, which only takes GET)
    expect(asked.map((i) => [i.method, i.headers, i.credentials])).toEqual([[undefined, undefined, 'omit']]);
    feed.enqueue(bytes(part('one')));
    await vi.waitFor(() => expect(shown).toHaveBeenCalledTimes(1));
    expect(await (await read(img.put[0])).text()).toBe('one');
    feed.enqueue(bytes(part('two')));
    await vi.waitFor(() => expect(shown).toHaveBeenCalledTimes(2));
    expect(await (await read(img.put[1])).text()).toBe('two');
    // the one before is let go
    await expect(read(img.put[0])).rejects.toThrow();
    expect(ended).not.toHaveBeenCalled();
    feed.close();
    await vi.waitFor(() => expect(ended).toHaveBeenCalledTimes(1));
    await close();
    await expect(read(img.put[1])).rejects.toThrow();
  });

  it('draws one picture at a time, then the newest of those that came meanwhile', async () => {
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    const read = fetch;
    vi.stubGlobal(
      'fetch',
      open((c) => (feed = c)),
    );
    const img = image();
    img.held = true;
    const shown = vi.fn();
    const close = await playMjpeg(url, img, shown, nothing);
    feed.enqueue(bytes(part('one') + part('two') + part('three')));
    await vi.waitFor(() => expect(img.put).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(img.put).toHaveLength(1);
    expect(shown).not.toHaveBeenCalled();
    img.drawn();
    expect(shown).toHaveBeenCalledTimes(1);
    expect(img.put).toHaveLength(2);
    expect(await (await read(img.put[1])).text()).toBe('three');
    // nothing new: nothing put in again
    img.drawn();
    expect(img.put).toHaveLength(2);
    await close();
  });

  it('counts one without a picture it could draw for too long as broken off, one closed from here tells nothing', async () => {
    vi.useFakeTimers();
    let feed!: ReadableStreamDefaultController<Uint8Array>;
    vi.stubGlobal(
      'fetch',
      open((c) => (feed = c)),
    );
    const img = image();
    const ended = vi.fn();
    await playMjpeg(url, img, nothing, ended);
    await vi.advanceTimersByTimeAsync(STALL_MS - 1000);
    // a picture gives it its time again
    feed.enqueue(bytes(part('one')));
    await vi.advanceTimersByTimeAsync(STALL_MS - 1000);
    expect(ended).not.toHaveBeenCalled();
    // parts that are no pictures don't
    img.bad = true;
    feed.enqueue(bytes(part('not a picture')));
    await vi.advanceTimersByTimeAsync(500);
    feed.enqueue(bytes(part('nor this')));
    await vi.advanceTimersByTimeAsync(500);
    expect(img.put).toHaveLength(3);
    expect(ended).toHaveBeenCalledTimes(1);

    const quiet = vi.fn();
    const close = await playMjpeg(url, image(), nothing, quiet);
    await close();
    await vi.advanceTimersByTimeAsync(STALL_MS * 2);
    expect(quiet).not.toHaveBeenCalled();
  });

  it('says in words why an address gave no picture', () => {
    setLangChoice('de');
    expect(streamFailure(new StreamError(401, 'mower:8889', 'authentication error'))).toEqual({
      text: 'Der Mäher hat die Verbindung nicht angenommen.',
      detail: 'HTTP 401: authentication error',
    });
    expect(streamFailure(new StreamError(400, 'mower:8889'))).toEqual({text: 'Die Kamera hat kein Bild geliefert.', detail: 'HTTP 400'});
    expect(streamFailure(new StreamError(404, 'mower:8890'))).toEqual({text: 'Keine Verbindung zur Kamera', detail: 'HTTP 404'});
    expect(streamFailure(new StreamError(0, '192.168.1.40:8890'))).toEqual({text: 'Die Kamera ist unter 192.168.1.40:8890 nicht erreichbar.'});
    expect(streamFailure(new StreamError('timeout', 'mower:8889'))).toEqual({text: 'Die Kamera hat nicht rechtzeitig geantwortet.', detail: 'mower:8889'});
  });

  // stands in for the browser's RTCPeerConnection: the offer is ready at once
  class Peer {
    static made: Peer[] = [];
    iceGatheringState = 'complete';
    connectionState = 'new';
    localDescription = {type: 'offer', sdp: 'the offer'};
    remote: unknown = null;
    open = true;
    onconnectionstatechange: (() => void) | null = null;
    secured = {state: 'connected', onstatechange: null as (() => void) | null};
    constructor() {
      Peer.made.push(this);
    }
    addTransceiver() {}
    getReceivers = () => [{transport: this.secured}];
    createOffer = async () => this.localDescription;
    setLocalDescription = async () => {};
    setRemoteDescription = async (d: unknown) => void (this.remote = d);
    close = () => void (this.open = false);
  }
  const whep = 'http://192.168.1.40:8889/stereo/whep?t=abc';

  it('over webrtc sends its offer once, takes the answer and ends the session at its address when closed', async () => {
    Peer.made = [];
    vi.stubGlobal('RTCPeerConnection', Peer);
    const asked: [string, RequestInit][] = [];
    vi.stubGlobal('fetch', async (u: string | URL, init: RequestInit) => {
      asked.push([String(u), init]);
      return init.method === 'POST' ? new Response('the answer', {status: 201, headers: {Location: '/stereo/whep/secret'}}) : new Response(null, {status: 200});
    });
    const ended = vi.fn();
    const close = await playWhep(whep, {} as HTMLVideoElement, ended);
    const peer = Peer.made[0];
    expect(asked.map(([u, i]) => [i.method, u, i.body])).toEqual([['POST', whep, 'the offer']]);
    expect(peer.remote).toEqual({type: 'answer', sdp: 'the answer'});
    // the session is ended at its address while the connection is still there
    const openThen: boolean[] = [];
    vi.stubGlobal('fetch', async (u: string | URL, init: RequestInit) => {
      asked.push([String(u), init]);
      openThen.push(peer.open);
      return new Response(null, {status: 200});
    });
    await close();
    expect(openThen).toEqual([true]);
    expect(peer.open).toBe(false);
    expect(asked.slice(1).map(([u, i]) => [i.method, u])).toEqual([['DELETE', 'http://192.168.1.40:8889/stereo/whep/secret?t=abc']]);
    // closed from here: nothing told, whatever the connection says after
    peer.secured.state = 'closed';
    peer.secured.onstatechange!();
    expect(ended).not.toHaveBeenCalled();
  });

  it('over webrtc tells once when the connection is over: closed by the mower at once, lost only once it counts as failed', async () => {
    vi.stubGlobal('RTCPeerConnection', Peer);
    vi.stubGlobal('fetch', async () => new Response('the answer', {status: 201}));
    const state = (peer: Peer, s: string) => {
      peer.connectionState = s;
      peer.onconnectionstatechange!();
    };
    Peer.made = [];
    const cut = vi.fn();
    await playWhep(whep, {} as HTMLVideoElement, cut);
    Peer.made[0].secured.state = 'closed';
    Peer.made[0].secured.onstatechange!();
    expect(cut).toHaveBeenCalledTimes(1);
    state(Peer.made[0], 'disconnected');
    state(Peer.made[0], 'failed');
    expect(cut).toHaveBeenCalledTimes(1);

    const lost = vi.fn();
    await playWhep(whep, {} as HTMLVideoElement, lost);
    // one that stutters may come back
    state(Peer.made[1], 'disconnected');
    state(Peer.made[1], 'connected');
    expect(lost).not.toHaveBeenCalled();
    state(Peer.made[1], 'disconnected');
    state(Peer.made[1], 'failed');
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('over webrtc reads a no that comes 4 s late or after 10 s without a picture, and lets go of the connection', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('RTCPeerConnection', Peer);
    for (const [ms, status] of [
      [4000, 401],
      [10000, 400],
    ]) {
      Peer.made = [];
      vi.stubGlobal('fetch', after(ms, () => new Response('', {status})));
      const refused = expect(playWhep(whep, {} as HTMLVideoElement, () => {})).rejects.toMatchObject({status, at: '192.168.1.40:8889'});
      await vi.advanceTimersByTimeAsync(ms);
      await refused;
      expect(Peer.made[0].open).toBe(false);
    }
  });
});
