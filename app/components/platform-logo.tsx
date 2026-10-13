'use client'

import { useState } from 'react'

// Platform logos (Miguel's platforms) served from /public/logos.
// Case-insensitive mapping from platform name → logo file.
const LOGO_MAP: Record<string, string> = {
  'uber': '/logos/uber.jpg',
  'lyft': '/logos/lyft.jpg',
  'eco ride': '/logos/eco-ride.jpg',
  'throo': '/logos/throo.jpg',
  'aki technology': '/logos/aki-technology.jpg',
  'classic ryde': '/logos/classic-ryde.jpg',
  'aventus ride': '/logos/aventus-ride.jpg',
  'island city': '/logos/island-city.jpg',
  'transittax': '/logos/transittax.jpg',
}

export function platformLogo(platform: string): string | undefined {
  return LOGO_MAP[String(platform || '').trim().toLowerCase()]
}

// Initials fallback when there is no logo: "Eco Ride" → "ER", "AKI Technology" → "AT", "Uber" → "UB".
export function platformInitials(platform: string): string {
  const words = String(platform || '').trim().split(/[\s-]+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.slice(0, 2).map((w) => w[0]).join('').toUpperCase()
}

// Small round platform logo. Falls back to initials — never renders an empty hole.
export function PlatformAvatar({ platform, size = 24, className = '' }: { platform: string; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const logo = platformLogo(platform)
  const initials = platformInitials(platform)
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white ring-1 ring-black/15 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {logo && !failed ? (
        <img
          src={logo}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-contain"
        />
      ) : (
        <span className="font-bold leading-none text-slate-700" style={{ fontSize: Math.max(8, Math.round(size * 0.42)) }}>
          {initials}
        </span>
      )}
    </span>
  )
}
