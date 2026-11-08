interface BrandMarkProps {
  className?: string;
}

/**
 * Geometric OpenTarmac emblem: a continuous road ribbon sweeping past
 * an apex kerb and start waypoint inside a dark carbon badge.
 */
export function BrandMark({ className = 'w-6 h-6' }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <rect width="32" height="32" rx="7" fill="#171B24" />
      <rect
        x="0.75"
        y="0.75"
        width="30.5"
        height="30.5"
        rx="6.25"
        stroke="white"
        strokeOpacity="0.14"
        strokeWidth="1.5"
      />
      <path
        d="M5 22.5C9.5 22.5 11 19 13 14.5C15 10 17.5 8 24.5 8"
        stroke="white"
        strokeOpacity="0.14"
        strokeWidth="8.5"
        strokeLinecap="round"
      />
      <path
        d="M5.5 23C10.5 23 12 18.8 14 14.5C16 10.2 18.5 8.5 25 8.5"
        stroke="#F4F4F5"
        strokeWidth="4.25"
        strokeLinecap="round"
      />
      <path
        d="M10.4 20.6C11.9 18.6 12.8 15.8 14.1 13.5"
        stroke="#E53935"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="25" cy="8.5" r="2.2" fill="#E53935" />
    </svg>
  );
}
