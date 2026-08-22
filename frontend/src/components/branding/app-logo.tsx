import { useId, type ComponentPropsWithoutRef } from 'react'

/**
 * The in-app brand mark. It is inline (rather than an <img>) so its colours
 * inherit the active palette, including a palette published at runtime.
 */
export function AppLogo({ className, ...props }: ComponentPropsWithoutRef<'svg'>) {
  const maskId = `journey-cutout-${useId().replace(/:/g, '')}`

  return (
    <svg
      aria-hidden="true"
      className={className}
      focusable="false"
      viewBox="0 0 256 256"
      {...props}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="256" height="256">
          <rect width="256" height="256" fill="white" />
          <path
            d="M96 38V198M160 58V218"
            fill="none"
            stroke="black"
            strokeLinecap="round"
            strokeWidth="8"
          />
          <path
            d="M48 176C67 139 90 141 104 166C120 194 145 180 141 148C137 114 151 91 184 88"
            fill="none"
            stroke="black"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="15"
          />
          <circle cx="190" cy="87" r="20" fill="black" />
        </mask>
      </defs>

      <circle cx="128" cy="128" r="128" fill="var(--primary)" />
      <g transform="translate(26 26) scale(.796875)">
        <path
          d="M35 53L89 33C94 31 99 31 104 33L158 52L216 31C223 29 228 34 228 41V188C228 195 224 200 218 202L166 222C161 224 157 224 152 222L98 203L40 224C33 227 28 222 28 215V67C28 60 30 56 35 53Z"
          fill="var(--primary-foreground)"
          mask={`url(#${maskId})`}
        />
        <circle cx="190" cy="87" r="7" fill="var(--primary-foreground)" />
      </g>
    </svg>
  )
}
