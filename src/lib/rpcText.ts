import {describe, reasonText, type MowerEvent} from './events';
import {fmt, tr} from './i18n';
import {MAX_RPC_BYTES, RpcError} from './rpc';

// MowBite OS turned the call down while the MowBite Updater updates it (reason HOLD in the error's data, until when),
// in the reason's words as a sentence. null for any other error
export function holdText(e: unknown): string | null {
  if (!(e instanceof RpcError) || e.data?.reason !== 'HOLD') return null;
  const until = typeof e.data.until === 'number' ? e.data.until : undefined;
  const text = reasonText({id: '', t: 0, type: 'HOLD', reason: 'HOLD', until});
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

// a call MowBite OS turned down as an event of its own (-32600 with data.event, COMMAND_REFUSED for those that only come
// in the answer), null for any other error
export function refusalEvent(e: unknown): MowerEvent | null {
  if (!(e instanceof RpcError) || e.code !== -32600 || typeof e.data?.event !== 'string') return null;
  const d = e.data;
  return {...d, id: typeof d.event_id === 'string' ? d.event_id : '', t: Date.now() / 1000, type: d.event as string};
}

// what went wrong with a call to the mower, in words
export function rpcErrorText(e: unknown): string {
  const hold = holdText(e);
  if (hold) return hold;
  if (e instanceof RpcError) {
    if (e.code === -32601) return tr("Your mower's software doesn't offer this ({method}).", {method: e.method});
    if (e.code === 'timeout') return tr("The mower didn't answer.");
    if (e.code === 'too_large')
      return tr('Too big to send to the mower ({size} MB, at most {max} MB). For a map: reduce the points of big areas.', {
        size: fmt(Number(e.message) / 1e6, 1),
        max: fmt(MAX_RPC_BYTES / 1e6, 1),
      });
  }
  return e instanceof Error ? e.message : tr('failed');
}

// a change from a settings card that failed: the mower's own words, no answer as such
export function answerError(e: unknown): string {
  const refused = refusalEvent(e);
  if (refused) return describe(refused, undefined, true).text;
  return holdText(e) ?? (e instanceof RpcError && e.code !== 'timeout' ? e.message : tr('The mower did not answer.'));
}
