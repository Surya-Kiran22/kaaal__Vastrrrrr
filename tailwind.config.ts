import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: '1.25rem',
        sm: '1.5rem',
        lg: '2rem',
      },
      screens: {
        '2xl': '1360px',
      },
    },
    extend: {
      colors: {
        // Kaal Vastr brand palette — charcoal base, silver/white accents.
        kv: {
          bg: '#0B0B0D',
          surface: '#131316',
          raised: '#1A1A1E',
          card: '#16161A',
          hover: '#202024',
          line: '#26262B',
          lineStrong: '#3A3A41',
          muted: '#8A8A93',
          dim: '#5E5E66',
          silver: '#C9C9D1',
          light: '#E8E8EC',
          white: '#FFFFFF',
          success: '#3FB27F',
          warning: '#D9A441',
          danger: '#E5484D',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Instrument Serif ships a single weight (400), which is all the
        // display layer uses - .heading-display pins font-normal and no
        // font-display element asks for bold, so nothing gets synthetically
        // emboldened. Georgia is the fallback while the webfont loads.
        display: ['"Instrument Serif"', 'Inter', 'Georgia', 'serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        widest2: '0.22em',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 18px 50px -24px rgba(0,0,0,0.9)',
        lift: '0 24px 60px -30px rgba(0,0,0,0.95)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        marquee: 'marquee 38s linear infinite',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
