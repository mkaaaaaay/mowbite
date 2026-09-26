// Map symbols to pick from in the settings. Mower icons face +x and span about -1..1, the caller
// scales and rotates them. Dock icons are drawn upright in the same unit box.

const mouth = (deg: number) => {
  const a = (deg * Math.PI) / 180;
  const x = Math.cos(a).toFixed(3);
  const y = Math.sin(a).toFixed(3);
  return `M0,0 L${x},${y} A1,1 0 1,1 ${x},${-y} Z`;
};

export const MOWER_ICONS: {key: string; label: string; draw: () => React.ReactNode}[] = [
  {
    key: 'triangle',
    label: 'Arrowhead',
    draw: () => <polygon points="1,0 -0.6,0.6 -0.6,-0.6" fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />,
  },
  {
    key: 'arrow',
    label: 'Arrow',
    draw: () => (
      <path d="M1,0 L-0.2,-0.8 L-0.2,-0.3 L-1,-0.3 L-1,0.3 L-0.2,0.3 L-0.2,0.8 Z" fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
    ),
  },
  {
    key: 'robot',
    label: 'Mower',
    draw: () => (
      <>
        <rect x={-1} y={-0.95} width={0.55} height={0.3} rx={0.1} fill="#222" />
        <rect x={-1} y={0.65} width={0.55} height={0.3} rx={0.1} fill="#222" />
        <rect x={-0.95} y={-0.7} width={1.9} height={1.4} rx={0.45} fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
        <circle cx={0.15} cy={0} r={0.32} fill="rgba(0,0,0,0.35)" />
        <circle cx={0.62} cy={0} r={0.12} fill="#fff" />
      </>
    ),
  },
  {
    key: 'dot',
    label: 'Dot',
    draw: () => (
      <>
        <line x1={0} y1={0} x2={1.1} y2={0} stroke="var(--c-mower)" strokeWidth={2} strokeLinecap="round" />
        <circle r={0.6} fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
      </>
    ),
  },
  {
    key: 'chomper',
    label: 'Chomper',
    draw: () => (
      <>
        <path d={mouth(35)} fill="var(--c-mower)" stroke="#000" strokeWidth={0.5}>
          <animate attributeName="d" values={`${mouth(35)};${mouth(3)};${mouth(35)}`} dur="0.4s" repeatCount="indefinite" />
        </path>
        <circle cx={0.05} cy={-0.5} r={0.12} fill="#000" />
      </>
    ),
  },
  {
    key: 'rocket',
    label: 'Rocket',
    draw: () => (
      <>
        <path d="M-0.75,-0.18 L-1.25,0 L-0.75,0.18 Z" fill="#ffb300">
          <animate attributeName="d" values="M-0.75,-0.18 L-1.25,0 L-0.75,0.18 Z;M-0.75,-0.2 L-1.45,0 L-0.75,0.2 Z;M-0.75,-0.18 L-1.25,0 L-0.75,0.18 Z" dur="0.25s" repeatCount="indefinite" />
        </path>
        <path d="M-0.55,-0.3 L-0.95,-0.65 L-0.95,-0.2 Z M-0.55,0.3 L-0.95,0.65 L-0.95,0.2 Z" fill="#555" />
        <path d="M1,0 C0.6,-0.45 -0.2,-0.4 -0.8,-0.3 L-0.8,0.3 C-0.2,0.4 0.6,0.45 1,0 Z" fill="var(--c-mower)" stroke="#fff" strokeWidth={0.5} />
        <circle cx={0.25} cy={0} r={0.15} fill="#9be7ff" stroke="#fff" strokeWidth={0.3} />
      </>
    ),
  },
];

export const DOCK_ICONS: {key: string; label: string; draw: () => React.ReactNode}[] = [
  {key: 'dot', label: 'Dot', draw: () => <circle r={0.65} fill="var(--c-dock)" />},
  {
    key: 'bolt',
    label: 'Charger',
    draw: () => (
      <>
        <rect x={-0.9} y={-0.9} width={1.8} height={1.8} rx={0.4} fill="var(--c-dock)" stroke="#fff" strokeWidth={0.5} />
        <path d="M0.15,-0.7 L-0.4,0.1 L-0.02,0.1 L-0.15,0.7 L0.4,-0.1 L0.02,-0.1 Z" fill="#fff" />
      </>
    ),
  },
  {
    key: 'house',
    label: 'House',
    draw: () => (
      <>
        <path d="M0,-1 L1,-0.1 L0.75,-0.1 L0.75,0.9 L-0.75,0.9 L-0.75,-0.1 L-1,-0.1 Z" fill="var(--c-dock)" stroke="#fff" strokeWidth={0.5} />
        <rect x={-0.22} y={0.3} width={0.44} height={0.6} fill="#fff" />
      </>
    ),
  },
  {
    key: 'plug',
    label: 'Plug',
    draw: () => (
      <>
        <circle r={0.9} fill="var(--c-dock)" stroke="#fff" strokeWidth={0.5} />
        <rect x={-0.4} y={-0.35} width={0.2} height={0.7} rx={0.08} fill="#fff" />
        <rect x={0.2} y={-0.35} width={0.2} height={0.7} rx={0.08} fill="#fff" />
      </>
    ),
  },
  {
    key: 'ghost',
    label: 'Ghost',
    draw: () => (
      <>
        <path
          d="M-0.85,0.9 L-0.85,-0.1 C-0.85,-1.05 0.85,-1.05 0.85,-0.1 L0.85,0.9 L0.57,0.65 L0.28,0.9 L0,0.65 L-0.28,0.9 L-0.57,0.65 Z"
          fill="var(--c-dock)"
          stroke="#fff"
          strokeWidth={0.5}
        />
        <circle cx={-0.3} cy={-0.2} r={0.22} fill="#fff" />
        <circle cx={0.3} cy={-0.2} r={0.22} fill="#fff" />
        <circle cx={-0.24} cy={-0.18} r={0.1} fill="#1a237e" />
        <circle cx={0.36} cy={-0.18} r={0.1} fill="#1a237e" />
      </>
    ),
  },
  {
    key: 'flag',
    label: 'Flag',
    draw: () => (
      <>
        <line x1={-0.6} y1={1} x2={-0.6} y2={-1} stroke="#fff" strokeWidth={1.5} strokeLinecap="round" />
        <path d="M-0.55,-0.95 L0.9,-0.6 L-0.55,-0.2 Z" fill="var(--c-dock)" stroke="#fff" strokeWidth={0.4} />
      </>
    ),
  },
];

export function mowerIcon(key: string | undefined) {
  return MOWER_ICONS.find((i) => i.key === key) ?? MOWER_ICONS[0];
}

export function dockIcon(key: string | undefined) {
  return DOCK_ICONS.find((i) => i.key === key) ?? DOCK_ICONS[0];
}
