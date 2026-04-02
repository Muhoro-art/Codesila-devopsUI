// tailwind.config.js
module.exports = {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cyber: {
          base: '#0a0a12',
          cyan: '#00f3ff',
          magenta: '#ff00ff',
          green: '#00ff9d',
          red: '#ff3a3a',
          text: '#e0e0e0',
          yellow: '#f5c542',
          blue: '#3b82f6',
          purple: '#a855f7',
        }
      },
      fontFamily: {
        orbitron: ['Orbitron', 'sans-serif'],
        fira: ['"Fira Code"', 'monospace']
      },
      keyframes: {
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' }
        },
        pulseNeon: {
          '0%, 100%': { boxShadow: '0 0 5px theme("colors.cyber.cyan"), 0 0 10px theme("colors.cyber.cyan")' },
          '50%': { boxShadow: '0 0 15px theme("colors.cyber.cyan"), 0 0 25px theme("colors.cyber.cyan")' }
        }
      },
      animation: {
        glitch: 'glitch 0.3s infinite',
        pulseNeon: 'pulseNeon 1.5s infinite'
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
}