// what reloading, closing or switching mowers would lose: unsaved map changes, a recording. the browser asks itself on
// reload and close. a switch of mowers asks here before it writes anything, a reload the browser asks about and that
// gets cancelled would leave the app half on the other mower
interface Guard {
  // what a switch of mowers loses, the question asked (translated: i18n can't be imported here, settings and the
  // layout's server side import this)
  text: () => string;
  // sent before the app reloads by itself, the reload waits a moment for it to get out
  before?: () => void;
}
const guards = new Map<string, Guard>();
let going = false;

const ask = (e: BeforeUnloadEvent) => {
  if (going) return;
  e.preventDefault();
  // older browsers only ask with this set
  e.returnValue = '';
};

export function guardLeaving(key: string, guard: Guard | null) {
  const had = guards.size > 0;
  if (guard) guards.set(key, guard);
  else guards.delete(key);
  if (!had && guards.size) window.addEventListener('beforeunload', ask);
  if (had && !guards.size) window.removeEventListener('beforeunload', ask);
}

// before the app reloads by itself: false when something would be lost and the user stays, else the ms to wait for
// what had to go out first
export function leaveFirst(): number | false {
  if (!guards.size) return 0;
  if (!window.confirm([...guards.values()].map((g) => g.text()).join('\n\n'))) return false;
  going = true;
  let wait = 0;
  for (const g of guards.values()) {
    if (!g.before) continue;
    g.before();
    wait = 400;
  }
  return wait;
}
