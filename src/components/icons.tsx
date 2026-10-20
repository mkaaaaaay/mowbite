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

export function RedoIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
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

// a shape with a bite taken out where another one lies over it
export function SubtractIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M14 10V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h5" />
      <rect x="10" y="10" width="11" height="11" rx="2" strokeDasharray="2.5 2.5" />
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

// recording: a pin where a point goes
export function PinIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.4 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </svg>
  );
}

// points set along the way by themselves
export function AutoPointsIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M3 18c4-1 5-8 9-8s5 6 9 4" strokeDasharray="0.1 4.2" />
      <circle cx="3" cy="18" r="1.4" fill="currentColor" />
      <circle cx="21" cy="14" r="1.4" fill="currentColor" />
      <path d="M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" strokeWidth={1.6} />
    </svg>
  );
}

// an outline closed and done
export function OutlineDoneIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M4 17V7l7-3 9 4-2 11-9 1z" strokeDasharray="3 2.4" />
      <path d="m8.5 12.5 2.5 2.5 5-5.5" />
    </svg>
  );
}

// recording a new line: a dot in a ring
export function RecordIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" />
    </svg>
  );
}

// the blade from above
export function BladeIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c0-4 1.5-6 4-7-1 3-1 5-3 7M14 12c4 0 6 1.5 7 4-3-1-5-1-7-3M12 14c0 4-1.5 6-4 7 1-3 1-5 3-7M10 12c-4 0-6-1.5-7-4 3 1 5 1 7 3" />
    </svg>
  );
}

export function CloseIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

// how fast: a gauge
export function SpeedIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <path d="M6.3 18.7a8 8 0 1 1 11.4 0" />
      <path d="m12 13 3.5-3.5" />
      <circle cx="12" cy="13" r="1.2" />
    </svg>
  );
}

// the phone turned on its side
export function RotateIcon({size = 20}: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...line}>
      <rect x="3" y="9" width="14" height="9" rx="2" />
      <path d="M8 4h5a5 5 0 0 1 5 5v1" />
      <path d="m16 8 2 2 2-2" />
    </svg>
  );
}
