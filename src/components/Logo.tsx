// a lawn eater chomping its way through the grass
export default function LogoMark({size = 28}: {size?: number}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="logo-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fe07c" />
          <stop offset="1" stopColor="#35a64f" />
        </linearGradient>
      </defs>
      <g fill="none" stroke="#5cc36a" strokeWidth="2.6" strokeLinecap="round">
        <path d="M44.5 56 Q46 46 43 38 M48.5 56 Q48.5 44 51 35 M52.5 56 Q52.5 47 56 41" />
        <path d="M56.5 56 Q57.5 50 55.5 46 M59.5 56 Q60 50 62 46" opacity="0.7" />
      </g>
      <path d="M24 32 L39.6 23 A18 18 0 1 0 39.6 41 Z" fill="url(#logo-body)" />
      <circle cx="26" cy="21.5" r="2.4" fill="#10261a" />
      <circle cx="20" cy="49.5" r="5.5" fill="var(--background)" stroke="currentColor" strokeWidth="2.6" />
      <circle cx="20" cy="49.5" r="1.6" fill="currentColor" />
      <path d="M4 57.5 H60" stroke="#35a64f" strokeWidth="2.6" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

