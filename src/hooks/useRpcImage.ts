'use client';

import type {ImageRef} from '@/lib/rpcImage';
import {answerError} from '@/lib/rpcText';
import {useEffect, useState} from 'react';

// an image of the mower (lib/rpcImage) as a data url, null while it loads; failed: why it can't be had
export function useRpcImage<T extends ImageRef>(ref: T | null | undefined, load: (ref: T) => Promise<string>): {url: string | null; failed: string | null} {
  const [got, setGot] = useState<{sha: string; url?: string; failed?: string} | null>(null);
  const sha = ref?.sha256;
  useEffect(() => {
    if (!ref) return;
    let gone = false;
    load(ref).then(
      (url) => !gone && setGot({sha: ref.sha256, url}),
      (e) => !gone && setGot({sha: ref.sha256, failed: answerError(e)}),
    );
    return () => {
      gone = true;
    };
    // (one image per checksum)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sha]);
  const now = got && got.sha === sha ? got : null;
  return {url: now?.url ?? null, failed: now?.failed ?? null};
}
