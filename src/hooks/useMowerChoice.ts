import {tr} from '@/lib/i18n';
import {DEMO_ID, mowerList, selectedMower} from '@/lib/mowers';
import {isApp} from '@/lib/native';
import {settingsStore} from '@/lib/settings';
import {useSyncExternalStore} from 'react';

const never = () => () => {};

// the mowers to pick from and the one looked at now, none to pick while there's only this one
export function useMowerChoice() {
  const settings = useSyncExternalStore(settingsStore.subscribe, settingsStore.snapshot, settingsStore.serverSnapshot);
  const app = useSyncExternalStore(never, isApp, () => false);
  const current = useSyncExternalStore(never, () => selectedMower()?.id ?? '', () => '');
  // in the app the list is on the phone and there's no mower of its own
  const others = app ? mowerList() : (settings.mowers ?? []);
  const picked = others.find((m) => m.id === current);
  const thisLabel = settings.thisName || tr('This mower');
  const name = current === DEMO_ID ? tr('Demo') : picked ? picked.name || picked.host : thisLabel;
  return {app, current, others, name, thisLabel, many: app ? others.length >= 2 : others.length > 0};
}
