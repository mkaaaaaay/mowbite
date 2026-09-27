import type {MowerEvent} from './events';
import {fresh} from './fresh';
import {callRpc} from './rpc';
import {RPC} from './openmower';

// the mower's event history, shared by the dashboard and the activity page
export const historyDays = () => fresh('events:list', () => callRpc<string[]>(RPC.eventDays));

export const historyOf = (date: string) =>
  fresh(`events:${date}`, () => callRpc<MowerEvent[]>(RPC.events, {date}, 20000));
