type BrandMarkProps = {
  className?: string;
  title?: string;
};

export function BrandMark({ className = '', title = 'PitWall XR' }: BrandMarkProps) {
  return (
    <svg className={`brand-mark ${className}`.trim()} viewBox="0 0 64 64" role="img" aria-label={title}>
      <rect className="brand-mark-bg" width="64" height="64" rx="14" />
      <path
        className="brand-mark-line"
        d="M 16.5 41.5 V 21 H 47.5"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line
        className="brand-mark-accent"
        x1="16.5"
        y1="41.5"
        x2="28.5"
        y2="41.5"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}
