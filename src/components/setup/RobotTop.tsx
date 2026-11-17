import {derivedParts, shapePath, type ShapePart} from '@/lib/setup';
import styles from './RobotTop.module.css';

type Sizes = Parameters<typeof derivedParts>[0];

// The mower from above with the front up: robot_shape where the mower gives one, else its outline; the parts a step
// names in mark drawn over it
export function RobotTop({shape, sizes, mark = []}: {shape: ShapePart[] | null; sizes: Sizes; mark?: string[]}) {
  const derived = derivedParts(sizes);
  const parts = shape ?? (derived.outline ? [{id: 'outline', kind: 'body' as const, points: derived.outline, closed: true}] : []);
  const marked = mark.flatMap((id) => {
    const own = parts.find((p) => p.id === id);
    if (own) return [own];
    const d = derived[id];
    return d ? [{id, kind: 'body' as const, points: d, closed: id !== 'contacts'}] : [];
  });
  const all = [...parts, ...marked].flatMap((p) => p.points);
  if (!all.length) return null;
  const xs = all.map(([, y]) => -y);
  const ys = all.map(([x]) => -x);
  const pad = 0.02;
  const [x0, y0] = [Math.min(...xs) - pad, Math.min(...ys) - pad];
  const [w, h] = [Math.max(...xs) - x0 + pad, Math.max(...ys) - y0 + pad];
  return (
    <svg className={styles.top} viewBox={`${x0} ${y0} ${w} ${h}`} role="img" aria-hidden="true">
      {parts.map((p) => (
        <path key={p.id} d={shapePath(p.points, p.closed)} data-kind={p.kind} data-part={p.id} className={styles.part} />
      ))}
      {marked.map((p) => (
        <path key={`mark-${p.id}`} d={shapePath(p.points, p.closed)} data-mark={p.id} className={styles.mark} />
      ))}
    </svg>
  );
}
