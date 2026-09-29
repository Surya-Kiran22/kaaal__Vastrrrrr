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
      // Kaal Vastr brand palette — monochrome near-black base, silver/white
      // foregrounds, crimson accent. Values are the sRGB equivalents of the
      // oklch() ramp used by the design reference.
      //
      // Declared as raw RGB channels so that (a) opacity modifiers such as
      // `bg-kv-surface/50` resolve correctly and (b) the whole palette can be
      // re-scoped for the enterprise console by redefining the variables
      // inside [data-console] in index.css, without touching components.
      colors: {
        kv: {
          bg: 'rgb(var(--kv-rgb-bg) / <alpha-value>)',
          surface: 'rgb(var(--kv-rgb-surface) / <alpha-value>)',
          card: 'rgb(var(--kv-rgb-card) / <alpha-value>)',
          raised: 'rgb(var(--kv-rgb-raised) / <alpha-value>)',
          hover: 'rgb(var(--kv-rgb-hover) / <alpha-value>)',
          line: 'rgb(var(--kv-rgb-line) / <alpha-value>)',
          lineStrong: 'rgb(var(--kv-rgb-line-strong) / <alpha-value>)',
          muted: 'rgb(var(--kv-rgb-muted) / <alpha-value>)',
          dim: 'rgb(var(--kv-rgb-dim) / <alpha-value>)',
          silver: 'rgb(var(--kv-rgb-silver) / <alpha-value>)',
          light: 'rgb(var(--kv-rgb-light) / <alpha-value>)',
          white: 'rgb(var(--kv-rgb-white) / <alpha-value>)',
          crimson: 'rgb(var(--kv-rgb-crimson) / <alpha-value>)',
          gunmetal: 'rgb(var(--kv-rgb-gunmetal) / <alpha-value>)',
          success: 'rgb(var(--kv-rgb-success) / <alpha-value>)',
          warning: 'rgb(var(--kv-rgb-warning) / <alpha-value>)',
          danger: 'rgb(var(--kv-rgb-danger) / <alpha-value>)',
        },
        // Enterprise POS ramp, scoped to the admin/staff consoles.
        // Flat charcoal + soft silver, no glass and no glow.
        pos: {
          bg: '#121212',
          card: '#1C1C1C',
          secondary: '#262626',
          muted: '#1A1A1A',
          line: '#2A2A2A',
          lineSoft: '#333333',
          fg: '#F5F5F5',
          dim: '#A0A0A0',
          silver: '#C0C0C0',
          silverSoft: '#E5E5E5',
          sidebar: '#0F0F0F',
          sidebarFg: '#E5E5E5',
          danger: '#DC2626',
          positive: '#34D399',
          negative: '#FB7185',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // Bebas Neue ships a single weight (400) and is heavily condensed, so
        // the display layer must never ask for bold - synthetic emboldening
        // destroys the letterforms. .heading-display pins font-normal for
        // that reason. Impact is the fallback while the webfont loads.
        display: ['"Bebas Neue"', 'Impact', '"Arial Narrow"', 'sans-serif'],
        editorial: ['"Archivo Black"', '"Helvetica Neue"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      letterSpacing: {
        widest2: '0.22em',
      },
      // Sharp editorial scale. The scale itself is remapped so existing
      // rounded-lg/xl/2xl markup resolves to the 2/4/6/8px corners used by the
      // reference without touching a single component file.
      borderRadius: {
        sm: '2px',
        DEFAULT: '4px',
        md: '4px',
        lg: '6px',
        xl: '6px',
        '2xl': '8px',
        '3xl': '8px',
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
        'slow-zoom': {
          from: { transform: 'scale(1.05)' },
          to: { transform: 'scale(1.18)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s infinite',
        marquee: 'marquee 40s linear infinite',
        'slow-zoom': 'slow-zoom 18s ease-out infinite alternate',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
