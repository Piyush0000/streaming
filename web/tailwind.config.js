/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#0b0e14',
        panel: '#12161f',
        hover: '#1a1f2b',
        border: '#232838',
        accent: {
          DEFAULT: '#7c5cff',
          hover: '#6a46f5',
          muted: '#382a70',
          soft: '#25204a',
        },
        text: {
          primary: '#e6e8ec',
          secondary: '#8b92a5',
          muted: '#5b6273',
        },
        success: '#22c55e',
        danger: '#ef4444',
        warning: '#f59e0b',
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset',
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
    },
  },
  plugins: [],
};
