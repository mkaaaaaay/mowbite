interface IconProps {
  size?: number;
}

export function PlayIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// a round arrow, the normal way round (clockwise) or the other (reverse)
export function TurnIcon({size = 20, reverse = false}: IconProps & {reverse?: boolean}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={reverse ? {transform: 'scaleX(-1)'} : undefined} aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v5h-5" />
    </svg>
  );
}

export function PauseIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1.5" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" />
    </svg>
  );
}

export function HomeIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
      <path d="M10 20v-6h4v6" />
    </svg>
  );
}

export function SkipIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 5v14l9-7z" />
      <rect x="16" y="5" width="3" height="14" />
    </svg>
  );
}

export function WarningIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3 2 20h20L12 3z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17.3" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function BatteryIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="18" height="10" rx="2" />
      <line x1="22" y1="10.5" x2="22" y2="13.5" />
      <rect x="4" y="9" width="10" height="6" fill="currentColor" stroke="none" />
    </svg>
  );
}

const line = {fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round'} as const;

export function PencilIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}

// a winding path with a start point, for recording by driving
export function RouteIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <circle cx="6" cy="18" r="2" />
      <path d="M8 18h8a3 3 0 0 0 0-6H8a3 3 0 0 1 0-6h10" />
    </svg>
  );
}

export function UndoIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

export function CheckIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ScissorsIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.1 8.1 20 20M8.1 15.9 20 4" />
    </svg>
  );
}

// two overlapping shapes becoming one
export function MergeIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <rect x="3" y="3" width="11" height="11" rx="2" />
      <rect x="10" y="10" width="11" height="11" rx="2" />
    </svg>
  );
}

// a wiggly line smoothed out
export function SimplifyIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M3 17 7 13l3 3 4-6 3 3 4-5" />
      <circle cx="3" cy="17" r="0.6" />
      <circle cx="21" cy="8" r="0.6" />
    </svg>
  );
}

export function TrashIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
    </svg>
  );
}
