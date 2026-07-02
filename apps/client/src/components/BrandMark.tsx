type BrandMarkProps = {
  className?: string;
  title?: string;
};

export function BrandMark({ className = '', title = 'PitWall XR' }: BrandMarkProps) {
  return (
    <svg className={`brand-mark ${className}`.trim()} viewBox="0 0 64 64" role="img" aria-label={title}>
      <rect className="brand-mark-bg" x="4" y="4" width="56" height="56" rx="14" />
      <path className="brand-mark-wall" d="M15 18h34v20H15z" />
      <path className="brand-mark-wall" d="M18 41h10v6H18zM32 41h14v6H32z" />
      <path className="brand-mark-track" d="M20 34c7-13 23-13 30 0" />
      <circle className="brand-mark-dot" cx="22" cy="24" r="2" />
      <circle className="brand-mark-dot" cx="32" cy="24" r="2" />
      <circle className="brand-mark-dot" cx="42" cy="24" r="2" />
    </svg>
  );
}
