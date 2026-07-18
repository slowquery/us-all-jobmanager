/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        status: {
          pending: '#f59e0b',
          processing: '#3b82f6',
          completed: '#22c55e',
          failed: '#ef4444',
        },
        surface: {
          DEFAULT: 'rgb(15 23 42 / 0.6)',
          border: 'rgb(148 163 184 / 0.12)',
        },
      },
      borderRadius: {
        bento: '16px',
        card: '12px',
      },
      backdropBlur: {
        surface: '12px',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.55' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
