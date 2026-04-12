/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        primary: '#0047AB',
        'primary-dark': '#003380',
        background: '#F8F9FA',
        card: '#FFFFFF',
        border: '#E9ECEF',
        danger: '#E53E3E',
        warning: '#DD6B20',
        'text-primary': '#1A202C',
        'text-secondary': '#718096',
      }
    }
  },
  plugins: []
}
