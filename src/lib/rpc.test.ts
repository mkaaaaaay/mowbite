import {describe, expect, it} from 'vitest';
import {isMissingMethod, RpcError} from './rpc';

describe('isMissingMethod', () => {
  it('spots the json-rpc "method not found" error only', () => {
    expect(isMissingMethod(new RpcError('map.replace', -32601, 'Method not found'))).toBe(true);
    expect(isMissingMethod(new RpcError('map.replace', 'timeout', 'timed out'))).toBe(false);
    expect(isMissingMethod(new Error('Method not found'))).toBe(false);
  });
});
