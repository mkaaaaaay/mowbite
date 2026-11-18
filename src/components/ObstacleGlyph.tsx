// what an obstacle is as a small white sign, drawn in -12..12 round its middle: on the map and on its card
export function obstacleGlyph(kind: string) {
  switch (kind) {
    case 'PERSON':
      return (
        <>
          <circle cx={0} cy={-5} r={3.5} />
          <path d="M-6.5 8 a6.5 6.5 0 0 1 13 0 Z" />
        </>
      );
    case 'ANIMAL':
      return (
        <>
          <ellipse cx={0} cy={3.5} rx={4.5} ry={3.5} />
          {[-6, -2, 2, 6].map((x) => (
            <circle key={x} cx={x} cy={Math.abs(x) > 4 ? -2 : -6} r={2} />
          ))}
        </>
      );
    case 'OBJECT':
      return <rect x={-5.5} y={-5.5} width={11} height={11} rx={1.5} />;
    default:
      return (
        <text x={0} y={0} dy="0.35em" textAnchor="middle" fontSize={15} fontWeight={700}>
          ?
        </text>
      );
  }
}

// the sign on its own, e.g. on the card of an obstacle
export function ObstacleBadge({kind, size = 28}: {kind: string; size?: number}) {
  return (
    <svg width={size} height={size} viewBox="-14 -14 28 28" aria-hidden>
      <circle r={13} fill="var(--c-seen)" />
      <g fill="#fff">{obstacleGlyph(kind)}</g>
    </svg>
  );
}
