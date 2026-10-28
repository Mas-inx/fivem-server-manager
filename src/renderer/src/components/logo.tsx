export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect width="64" height="64" rx="15" className="fill-inverse" />
      <rect x="14" y="16" width="36" height="13" rx="4.5" className="fill-inverse-fg" />
      <rect x="14" y="35" width="36" height="13" rx="4.5" className="fill-inverse-fg" fillOpacity="0.38" />
      <circle cx="42.5" cy="22.5" r="2.4" className="fill-inverse" />
    </svg>
  )
}
