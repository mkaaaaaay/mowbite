// what MowBite OS takes for an own sound (sound.upload): an MP3 of at most 2 MB and 0.2 to 30 s, sent in parts of 512 KB
export const MAX_SOUND_BYTES = 2 << 20;
export const MAX_SOUND_SECONDS = 30;
export const MIN_SOUND_SECONDS = 0.2;
export const PART_BYTES = 512 << 10;
