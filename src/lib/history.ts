import type {MowerEvent} from './events';
import {fresh} from './fresh';
import {callRpc} from './rpc';

// the mower's event history, shared by the dashboard and the activity page
export const historyDays = () => fresh('events:list', () => callRpc<string[]>('events.history.list'));

export const historyOf = (date: string) =>
  fresh(`events:${date}`, () => callRpc<MowerEvent[]>('events.history', {date}, 20000));
