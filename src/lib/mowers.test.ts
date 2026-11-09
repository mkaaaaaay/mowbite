import {describe, expect, it, vi} from 'vitest';
import {mowerKey, parseAddress} from './mowers';

const stored = new Map<string, string>();
vi.stubGlobal('localStorage', {getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => stored.set(k, v)});
vi.stubGlobal('window', {});

describe('parseAddress', () => {
  it('takes a port typed after the host', () => {
    expect(parseAddress('192.168.2.170:8090')).toEqual({host: '192.168.2.170', port: 8090});
    expect(parseAddress(' http://Mower.local:8082/settings ')).toEqual({host: 'mower.local', port: 8082});
  });

  it('has no port without one or with one out of range', () => {
    expect(parseAddress('192.168.2.170')).toEqual({host: '192.168.2.170', port: null});
    expect(parseAddress('https://openmower/')).toEqual({host: 'openmower', port: null});
    expect(parseAddress('openmower:99999')).toEqual({host: 'openmower', port: null});
  });
});

describe('mowerKey', () => {
  it('keys what is kept by the mower looked at, the one the page comes from by the key alone', () => {
    stored.set('appSettings', JSON.stringify({mowers: [{id: 't', name: 'Tron', host: 't'}]}));
    expect(mowerKey('trackCleared')).toBe('trackCleared');
    stored.set('mower', 't');
    expect(mowerKey('trackCleared')).toBe('trackCleared t');
  });
});
