import {useRef, useState} from 'react';

// a delete or a step back takes two taps: the first asks, for a few seconds. a double tap by mistake doesn't answer
// the question it brings up at the same spot
export function useSure() {
  const [sure, setSure] = useState<string | null>(null);
  const asked = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const confirm = (key: string, go: () => void) => {
    if (sure !== key) {
      setSure(key);
      asked.current = Date.now();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSure((k) => (k === key ? null : k)), 4000);
      return;
    }
    if (Date.now() - asked.current < 600) return;
    clearTimeout(timer.current);
    setSure(null);
    go();
  };
  return {sure, confirm};
}
