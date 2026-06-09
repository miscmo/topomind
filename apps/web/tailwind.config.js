/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "var(--color-border)",
        input: "var(--color-border)",
        ring: "var(--color-accent-soft)",
        background: "var(--color-bg-app)",
        foreground: "var(--color-text-primary)",
        primary: {
          DEFAULT: "var(--color-primary)",
          foreground: "var(--color-text-inverse)",
        },
        secondary: {
          DEFAULT: "var(--color-bg-muted)",
          foreground: "var(--color-text-secondary)",
        },
        destructive: {
          DEFAULT: "var(--color-danger)",
          foreground: "var(--color-text-inverse)",
        },
        muted: {
          DEFAULT: "var(--color-bg-muted)",
          foreground: "var(--color-text-muted)",
        },
        accent: {
          DEFAULT: "var(--color-accent)",
          foreground: "var(--color-text-inverse)",
        },
        popover: {
          DEFAULT: "var(--color-surface)",
          foreground: "var(--color-text-primary)",
        },
        surface: "var(--color-surface)",
        card: {
          DEFAULT: "var(--color-surface)",
          foreground: "var(--color-text-primary)",
        },
      },
      borderRadius: {
        lg: "var(--radius-lg)",
        md: "var(--radius-md)",
        sm: "var(--radius-sm)",
      },
      transitionDuration: {
        '80': '80ms',
        '120': '120ms',
        '160': '160ms',
        '180': '180ms',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography")
  ],
}

