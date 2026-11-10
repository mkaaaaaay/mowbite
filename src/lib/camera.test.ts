import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {afterClosed, blockedHere, cameraLabel, cameraParts, cameraReason, closed, pickProtocol, pictureRatio, sortCameras, streamUrl, type Camera} from './camera';
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
    expect(cameraReason('LENS_DIRTY', 'lens dirty')).toBe('Lens dirty');
    expect(cameraReason(undefined)).toBe('Kein Signal von der Kamera');
    setLangChoice('en');
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
