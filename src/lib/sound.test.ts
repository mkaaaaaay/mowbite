import {describe, expect, it} from 'vitest';
import {describe as eventText} from './events';
import {soundRefusal, splitParts, toBase64} from './sound';
import {MAX_SOUND_BYTES, MAX_SOUND_SECONDS, MIN_SOUND_SECONDS, PART_BYTES} from './soundLimits';

describe('an own sound', () => {
  it('goes in parts of at most 512 KB, at most 4 for the largest file', () => {
    const bytes = Uint8Array.from({length: MAX_SOUND_BYTES}, (_, i) => i & 0xff);
    const parts = splitParts(bytes);
    expect(parts.map((p) => p.length)).toEqual([PART_BYTES, PART_BYTES, PART_BYTES, PART_BYTES]);
    expect(splitParts(bytes.subarray(0, PART_BYTES + 1)).map((p) => p.length)).toEqual([PART_BYTES, 1]);
    expect(splitParts(bytes.subarray(0, 10)).map((p) => p.length)).toEqual([10]);
    expect(Buffer.concat(splitParts(bytes.subarray(0, 1000), 300)).equals(Buffer.from(bytes.subarray(0, 1000)))).toBe(true);
  });

  it('goes in base64 with padding, also for a large part', () => {
    expect(toBase64(new TextEncoder().encode('ab'))).toBe('YWI=');
    const bytes = Uint8Array.from({length: PART_BYTES}, (_, i) => (i * 7) & 0xff);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('is turned down on the phone when too large, too long or no audio', () => {
    expect(soundRefusal(MAX_SOUND_BYTES)).toBeNull();
    expect(soundRefusal(MAX_SOUND_BYTES + 1, 2)).toEqual({reason: 'TOO_LARGE', limit: MAX_SOUND_BYTES});
    expect(soundRefusal(1000, MAX_SOUND_SECONDS)).toBeNull();
    expect(soundRefusal(1000, 31.4)).toEqual({reason: 'TOO_LONG', limit: MAX_SOUND_SECONDS, seconds: 31.4});
    expect(soundRefusal(1000, 0.1)).toEqual({reason: 'TOO_SHORT', limit: MIN_SOUND_SECONDS, seconds: 0.1});
    expect(soundRefusal(1000, 0.2)).toBeNull();
    expect(soundRefusal(1000, null)).toEqual({reason: 'NOT_MP3'});
    expect(soundRefusal(0)).toEqual({reason: 'NOT_MP3'});
    // without web audio the mower checks the length
    expect(soundRefusal(1000, undefined)).toBeNull();
  });

  it("is turned down in the mower's words", () => {
    const say = (size: number, seconds?: number | null) => eventText({id: '', t: 0, type: 'SOUND_REFUSED', ...soundRefusal(size, seconds)}).text;
    expect(say(MAX_SOUND_BYTES + 1)).toBe('Sound not uploaded: the file is larger than 2 MB');
    expect(say(1000, 31.44)).toBe('Sound not uploaded: the sound is 31.4 s long, at most 30 s');
    expect(say(1000, null)).toBe('Sound not uploaded: the file is not an MP3 the mower can play');
  });
});
