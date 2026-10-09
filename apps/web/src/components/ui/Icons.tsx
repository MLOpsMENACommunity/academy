import type { SVGProps } from 'react';

/** Small line icons (24px grid, currentColor). Decorative: always aria-hidden. */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, strokeWidth = 1.8, children, ...props }: P) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export const IconCourses = (p: P) => (
  <Svg {...p}>
    <path d="M4 5h16v14H4z" />
    <path d="M4 9h16" />
  </Svg>
);
export const IconPath = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="18" r="2" />
    <circle cx="19" cy="6" r="2" />
    <path d="M7 18h6a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h6" />
  </Svg>
);
export const IconPlay = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M10 8l6 4-6 4z" />
  </Svg>
);
export const IconCalendar = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 10h16M9 3v4M15 3v4" />
  </Svg>
);
export const IconUsers = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6" />
  </Svg>
);
export const IconChat = (p: P) => (
  <Svg {...p}>
    <path d="M5 5h14v10H9l-4 4z" />
  </Svg>
);
export const IconArticle = (p: P) => (
  <Svg {...p}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M9 10h6M9 14h6M9 18h4" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg strokeWidth={2.6} {...p}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);
export const IconChevron = ({ up, ...p }: P & { up?: boolean }) => (
  <Svg strokeWidth={2.4} size={12} {...p}>
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const IconExternal = (p: P) => (
  <Svg size={14} strokeWidth={2} {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" />
  </Svg>
);

/** "→" that points the reading direction (flips in Arabic). */
export function Arrow({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden className={`inline-block rtl:rotate-180 ${className}`}>
      →
    </span>
  );
}
