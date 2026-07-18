/** @type {import('tailwindcss').Config} */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: { xs: '400px' },
      colors: {
        // BBG Peptides brand palette (from imported design)
        brand: {
          green: '#57a814',      // primary action green
          greendark: '#3c7a0a',  // deep green text/gradient
          blue: '#0b46b8',       // link / primary blue
          navy: '#0a1f44',       // dark surface / solo-buy card
        },
        surface: {
          DEFAULT: '#ffffff',
          sand: '#e6eae2',       // app body bg
          mist: '#f4f7f1',       // inner scroll bg
          field: '#f4f7f1',      // input bg
        },
        ink: {
          DEFAULT: '#1c2b26',    // headings
          body: '#4c5a52',       // body text
          muted: '#7a877f',      // secondary text
          faint: '#98a29b',      // disabled/inactive
        },
        line: { DEFAULT: '#d9e2d2', soft: '#edf2ea', mist: '#e2e8dd' },
        warn: { bg: '#fff3cd', fg: '#9a6b00', softbg: '#fff8e6', softln: '#f0dfae' },
      },
      fontFamily: {
        display: ['"Chakra Petch"', 'sans-serif'],
        sans: ['Barlow', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 4px rgba(20,40,20,.07)',
        sheet: '0 -4px 20px rgba(0,0,0,.12)',
        toast: '0 4px 14px rgba(0,0,0,.25)',
      },
      maxWidth: { app: '430px' },
      keyframes: {
        toastup: { from: { opacity: '0', transform: 'translate(-50%,10px)' }, to: { opacity: '1', transform: 'translate(-50%,0)' } },
        sheetup: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        fadein: { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: {
        toastup: 'toastup .2s ease-out',
        sheetup: 'sheetup .22s ease-out',
        fadein: 'fadein .18s ease-out',
      },
    },
  },
  plugins: [],
};
