/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#050a17',
        panel: '#0c1526',
        hover: '#152036',
        border: '#1f2a3d',
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          muted: '#1e3a66',
          soft: '#15223d',
        },
        text: {
          primary: '#e6e8ec',
          secondary: '#93a4c3',
          muted: '#64748b',
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
      // One motion scale for the whole app: 150 / 250 / 400ms + two easings.
      transitionDuration: { fast: '150ms', base: '250ms', slow: '400ms' },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      // Entrances use fill-mode "backwards" so no transform lingers afterwards
      // (a lingering transform would trap position:fixed descendants).
      animation: {
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fade-in 250ms cubic-bezier(0.22,1,0.36,1) backwards',
        'fade-out': 'fade-out 150ms ease-in forwards',
        'page-in': 'page-in 300ms cubic-bezier(0.22,1,0.36,1) backwards',
        'rise-in': 'rise-in 400ms cubic-bezier(0.22,1,0.36,1) backwards',
        'slide-down': 'slide-down 250ms cubic-bezier(0.22,1,0.36,1) backwards',
        'slide-in-right': 'slide-in-right 250ms cubic-bezier(0.22,1,0.36,1) backwards',
        'slide-out-right': 'slide-out-right 150ms ease-in forwards',
        'msg-in': 'msg-in 250ms cubic-bezier(0.22,1,0.36,1) backwards',
        'pop-in': 'pop-in 250ms cubic-bezier(0.34,1.56,0.64,1) backwards',
        'pop-out': 'pop-out 150ms ease-in forwards',
        'badge-pop': 'badge-pop 400ms cubic-bezier(0.34,1.56,0.64,1) backwards',
        'dot-bounce': 'dot-bounce 1.1s ease-in-out infinite',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'speaking-ring': 'speaking-ring 1.2s cubic-bezier(0.22,1,0.36,1) infinite',
        'glow-breathe': 'glow-breathe 2.4s ease-in-out infinite',
        wiggle: 'wiggle 1.4s ease-in-out infinite',
        float: 'float 5s ease-in-out infinite',
        'orb-drift': 'orb-drift 18s ease-in-out infinite',
        shine: 'shine 700ms cubic-bezier(0.22,1,0.36,1) forwards',
        tick: 'tick 250ms cubic-bezier(0.22,1,0.36,1) backwards',
        'live-ping': 'live-ping 1.6s cubic-bezier(0,0,0.2,1) infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'page-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(16px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'slide-out-right': {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'translateX(24px)' },
        },
        'msg-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pop-out': {
          from: { opacity: '1', transform: 'none' },
          to: { opacity: '0', transform: 'scale(0.96)' },
        },
        'badge-pop': {
          '0%': { transform: 'scale(0)', opacity: '0' },
          '60%': { transform: 'scale(1.25)', opacity: '1' },
          '100%': { transform: 'scale(1)' },
        },
        'dot-bounce': {
          '0%, 80%, 100%': { transform: 'translateY(0)', opacity: '0.4' },
          '40%': { transform: 'translateY(-3px)', opacity: '1' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'speaking-ring': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '100%': { transform: 'scale(1.35)', opacity: '0' },
        },
        'glow-breathe': {
          '0%, 100%': { opacity: '0.35' },
          '50%': { opacity: '0.9' },
        },
        wiggle: {
          '0%, 55%, 100%': { transform: 'rotate(0deg)' },
          '10%': { transform: 'rotate(-14deg)' },
          '20%': { transform: 'rotate(12deg)' },
          '30%': { transform: 'rotate(-10deg)' },
          '40%': { transform: 'rotate(8deg)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        'orb-drift': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(30px,-20px,0) scale(1.06)' },
          '66%': { transform: 'translate3d(-24px,18px,0) scale(0.96)' },
        },
        shine: {
          from: { transform: 'translateX(-130%) skewX(-20deg)' },
          to: { transform: 'translateX(230%) skewX(-20deg)' },
        },
        tick: {
          from: { opacity: '0', transform: 'translateY(45%)' },
          to: { opacity: '1', transform: 'none' },
        },
        'live-ping': {
          '0%': { transform: 'scale(1)', opacity: '0.7' },
          '75%, 100%': { transform: 'scale(2.6)', opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
