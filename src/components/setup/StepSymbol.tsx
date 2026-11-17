// the signs of the setup steps as MowBite OS names them in symbol, drawn in lines on a 24 grid
const PATHS: Record<string, React.ReactNode> = {
  stop: (
    <>
      <path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" />
      <path d="M8 12h8" />
    </>
  ),
  lift: (
    <>
      <path d="M12 13V3M8 7l4-4 4 4" />
      <rect x="4" y="15" width="16" height="4" rx="2" />
      <path d="M7 21h.01M17 21h.01" />
    </>
  ),
  bumper: (
    <>
      <path d="M4 9c2.5-3 5-4 8-4s5.5 1 8 4" />
      <path d="M12 21v-9M8.5 15.5 12 12l3.5 3.5" />
    </>
  ),
  wheels: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 4v6M12 14v6M4 12h6M14 12h6" />
    </>
  ),
  ground: (
    <>
      <path d="M3 20h18" />
      <rect x="4" y="8" width="16" height="7" rx="2" />
      <circle cx="8" cy="16.5" r="2" />
      <circle cx="16" cy="16.5" r="2" />
    </>
  ),
  blade: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M12 10c0-4 1.5-6 4-7-1 3-1 5-3 7M14 12c4 0 6 1.5 7 4-3-1-5-1-7-3M12 14c0 4-1.5 6-4 7 1-3 1-5 3-7M10 12c-4 0-6-1.5-7-4 3 1 5 1 7 3" />
    </>
  ),
  antenna: (
    <>
      <path d="M12 12v9M9 21h6" />
      <circle cx="12" cy="10" r="2" />
      <path d="M8.5 6.5a5 5 0 0 0 0 7M15.5 6.5a5 5 0 0 1 0 7M5.6 3.6a9 9 0 0 0 0 12.8M18.4 3.6a9 9 0 0 1 0 12.8" />
    </>
  ),
  dock: (
    <>
      <path d="M4 21h16M6 21V9l6-5 6 5v12" />
      <path d="m12.5 9-2.5 4h4l-2.5 4" />
    </>
  ),
  board: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  map: (
    <>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
};

export const hasSymbol = (name: string | null): name is string => !!name && name in PATHS;

export function StepSymbol({name, size = 24}: {name: string; size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
