/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '"Segoe UI Variable"', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"Cascadia Code"', 'Consolas', 'monospace'],
      },
      colors: {
        ink: {
          950: '#090a10',
          900: '#0d0f18',
          800: '#141724',
          700: '#1d2132',
          600: '#2a2f45',
        },
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 18 32 / 0.04), 0 1px 3px rgb(16 18 32 / 0.04)',
        lift: '0 4px 14px -2px rgb(16 18 32 / 0.10), 0 2px 6px -2px rgb(16 18 32 / 0.06)',
        glow: '0 0 0 4px rgb(99 102 241 / 0.15)',
      },
      keyframes: {
        'fade-up': { '0%': { opacity: 0, transform: 'translateY(8px)' }, '100%': { opacity: 1, transform: 'translateY(0)' } },
        'fade-in': { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
        'pop-in': { '0%': { opacity: 0, transform: 'scale(.96)' }, '100%': { opacity: 1, transform: 'scale(1)' } },
        'slide-in': { '0%': { opacity: 0, transform: 'translateX(16px)' }, '100%': { opacity: 1, transform: 'translateX(0)' } },
        'ring-pulse': {
          '0%': { transform: 'scale(1)', opacity: 0.55 },
          '100%': { transform: 'scale(1.9)', opacity: 0 },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        dots: { '0%, 80%, 100%': { opacity: 0.25, transform: 'translateY(0)' }, '40%': { opacity: 1, transform: 'translateY(-2px)' } },
        blink: { '50%': { opacity: 0 } },
      },
      animation: {
        'fade-up': 'fade-up .35s cubic-bezier(.2,.7,.2,1) both',
        'fade-in': 'fade-in .25s ease-out both',
        'pop-in': 'pop-in .18s ease-out both',
        'slide-in': 'slide-in .28s cubic-bezier(.2,.7,.2,1) both',
        'ring-pulse': 'ring-pulse 1.8s cubic-bezier(.2,.6,.3,1) infinite',
        shimmer: 'shimmer 1.4s infinite',
        dots: 'dots 1.1s infinite ease-in-out',
        blink: 'blink 1s steps(2) infinite',
      },
    },
  },
  plugins: [],
};
