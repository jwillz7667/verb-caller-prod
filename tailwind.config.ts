import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui']
      },
      colors: {
        brand: {
          50: '#f5f7ff',
          100: '#e6ebff',
          200: '#c2cdff',
          300: '#9eafff',
          400: '#6c84ff',
          500: '#3a58ff',
          600: '#293fcc',
          700: '#1f2f99',
          800: '#151f66',
          900: '#0b1033'
        }
      }
    }
  },
  plugins: []
}

export default config

