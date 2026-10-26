import {fmt, tr} from './i18n';
import {MAX_RPC_BYTES, RpcError} from './rpc';

// what went wrong with a call to the mower, in words
export function rpcErrorText(e: unknown): string {
  if (e instanceof RpcError) {
    if (e.code === -32601) return tr("Your OpenMower version doesn't offer this ({method}).", {method: e.method});
    if (e.code === 'timeout') return tr("The mower didn't answer.");
    if (e.code === 'too_large')
      return tr('Too big to send to the mower ({size} MB, at most {max} MB). For a map: reduce the points of big areas.', {
        size: fmt(Number(e.message) / 1e6, 1),
        max: fmt(MAX_RPC_BYTES / 1e6, 1),
      });
  }
  return e instanceof Error ? e.message : tr('failed');
}
