import type {MowerMap} from '@/hooks/useMowerMap';
import {isPin} from './mowerBody';
import {mapKey} from './sameMap';

// A job the mower interrupted keeps the lanes of the map it had, recording mode doesn't end it: OpenMower adds the areas
// recorded and goes back to idle with the job still there. After the mode it's dropped when the areas changed
// (components/RecordingWatch)

// a save in recording mode not in the map after this long is told as not arrived, after the mode a job is dropped
// within as long
export const SAVE_WAIT_MS = 10000;
// seen in recording mode at most this long before: watched up to its end, no other job can lie in between
export const MODE_GAP_MS = 30000;

// what a job's lanes are planned on: the areas but pins, the docking station left out
export const lanesKey = (map: MowerMap) => mapKey({areas: map.areas.filter((a) => !isPin(a)), docking_stations: []});

export const watched = (sinceMode: number) => sinceMode <= MODE_GAP_MS;

// dropped after the mode once the mower is idle, was seen in the mode a moment ago (sinceMode ms), the map is there with
// other areas (now) than the mode began with and the mower offers the drop
export const dropsJob = (state: string | undefined, sinceMode: number, now: string | null, began: string, offered: boolean) =>
  state === 'IDLE' && watched(sinceMode) && now !== null && now !== began && offered;
