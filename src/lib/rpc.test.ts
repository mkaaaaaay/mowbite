import {describe, expect, it} from 'vitest';
import {isMissingMethod, RpcError, unavailable} from './rpc';

describe('isMissingMethod', () => {
  it('spots the json-rpc "method not found" error only', () => {
    expect(isMissingMethod(new RpcError('map.replace', -32601, 'Method not found'))).toBe(true);
    expect(isMissingMethod(new RpcError('map.replace', 'timeout', 'timed out'))).toBe(false);
    expect(isMissingMethod(new Error('Method not found'))).toBe(false);
  });
});

describe('unavailable', () => {
  const known = new Set(['map.replace', 'events.history']);

  it('stops calls the mower said it does not have', () => {
    expect(unavailable(known, 'position.history')).toBe(true);
    expect(unavailable(known, 'map.replace')).toBe(false);
  });

  it('never blocks when the mower could not tell, nor rpc.methods and meta.* calls', () => {
    expect(unavailable(null, 'position.history')).toBe(false);
    expect(unavailable(known, 'rpc.methods')).toBe(false);
    expect(unavailable(known, 'meta.config.schema')).toBe(false);
  });
});
