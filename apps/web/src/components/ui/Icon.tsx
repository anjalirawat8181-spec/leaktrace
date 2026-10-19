import type { SVGProps } from 'react';

const PATHS = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  exams: 'M9 12h6M9 16h6M9 8h2M7 3h7l5 5v13H7z',
  centres: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  trace: 'M11 4a7 7 0 100 14 7 7 0 000-14zM21 21l-5-5',
  audit: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z M9 12l2 2 4-4',
  outbox: 'M4 6h16v12H4zM4 7l8 6 8-6',
  pencil: 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3',
  cog: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1',
  check: 'M5 13l4 4L19 7',
  clock: 'M12 7v5l3 2M12 3a9 9 0 100 18 9 9 0 000-18z',
  unlock: 'M7 11V8a5 5 0 019.6-2M5 11h14v10H5z',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v10H5z',
  target: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8a4 4 0 100 8 4 4 0 000-8zM12 12h.01',
  question: 'M9.5 9a2.5 2.5 0 114 2c-1 .8-1.5 1.2-1.5 2.5M12 17h.01M12 3a9 9 0 100 18 9 9 0 000-18z',
  minus: 'M6 12h12',
  alert: 'M12 4l9 16H3zM12 10v4M12 17h.01',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  signout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  arrowleft: 'M10 6l-6 6 6 6M4 12h16',
  plus: 'M12 5v14M5 12h14',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6z',
  refresh: 'M20 11a8 8 0 00-14-4M4 5v4h4M4 13a8 8 0 0014 4M20 19v-4h-4',
  users: 'M16 11a3 3 0 100-6M9 11a3 3 0 100-6 3 3 0 000 6zM3 20c0-3 3-5 6-5s6 2 6 5M17 15c2.5.3 4 2 4 5',
  queue: 'M4 6h16M4 12h16M4 18h10',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  label?: string;
}

export function Icon({ name, size = 18, label, className, ...rest }: IconProps) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      className={className} role={label ? 'img' : undefined} aria-label={label}
      aria-hidden={label ? undefined : true} focusable="false" {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
