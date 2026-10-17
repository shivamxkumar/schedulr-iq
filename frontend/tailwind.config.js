/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#17243B', 700: '#22324F', 600: '#2E4064', 50: '#EEF0F4' },
        lime: { DEFAULT: '#D8FF66', 600: '#B8E03A', 50: '#F4FFD6' },
        ivory: { DEFAULT: '#F7F6F1', 200: '#EEECE4', 300: '#E2DFD4' },
        slate: { DEFAULT: '#778196', 300: '#C5CAD4', 200: '#DCE0E7', 600: '#5A6378' },
        conflict: { DEFAULT: '#D94B4B', 50: '#FBECEC' },
        cat: { cs: '#3D5A80', math: '#9A6B3F', ece: '#3F7A65', ds: '#7A5C8F', core: '#5A6378' },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: { '2xs': ['10px', '14px'] },
    },
  },
  plugins: [],
}
