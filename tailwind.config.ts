import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        "omix-navy": "#0a0f1a",
        "omix-accent": "#f97316",
        "omix-accent-dark": "#ea580c",
        "omix-cyan": "#00bcd4",
      },
    },
  },
  plugins: [],
};
export default config;
