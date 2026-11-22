/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        'wow-bg': '#1A1A2E',
        'wow-panel': '#16213E',
        'wow-border': '#0F3460',
        'wow-gold': '#FFD700',
        'wow-red': '#C41F3B',
        'class-dk': '#C41F3B',
        'class-druid': '#FF7D0A',
        'class-shaman': '#0070DE',
        'class-mage': '#69CCF0',
        'class-rogue': '#FFF569',
      },
      animation: {
        'pulse-red': 'pulse-red 1s ease-in-out infinite',
        'bounce-sct': 'bounce-sct 0.3s ease-out',
      },
      keyframes: {
        'pulse-red': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(196, 31, 59, 0)' },
          '50%': { boxShadow: '0 0 0 3px rgba(196, 31, 59, 0.9)' },
        },
        'bounce-sct': {
          '0%': { transform: 'scale(1.5)' },
          '60%': { transform: 'scale(0.9)' },
          '100%': { transform: 'scale(1)' },
        },
      },
    },
  },
  plugins: [],
};
