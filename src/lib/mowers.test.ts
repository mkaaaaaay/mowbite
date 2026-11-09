import {describe, expect, it} from 'vitest';
import {parseAddress} from './mowers';

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
