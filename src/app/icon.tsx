import { ImageResponse } from 'next/og'

// Route segment config
export const runtime = 'edge'

// Image metadata
export const size = {
  width: 32,
  height: 32,
}
export const contentType = 'image/png'

// Image generation
export default function Icon() {
  return new ImageResponse(
    (
        <svg
            viewBox="0 0 28 28"
            width="32"
            height="32"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
        >
            <rect
                width="28"
                height="28"
                rx="8"
                fill="hsl(217.2 91.2% 59.8%)"
            />
            <path
                d="M9.5 20V8"
                stroke="hsl(210 40% 98%)"
                strokeWidth="2"
                strokeLinecap="round"
            />
            <path
                d="M18.5 8L13 14L18.5 20"
                stroke="hsl(210 40% 98%)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    ),
    {
      ...size,
    }
  )
}
