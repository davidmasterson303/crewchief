import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    /*
      hooks/ and lib/ hold shared class tables — the health-band ramp, the
      usage-profile chips. Leaving them unscanned meant a class written there
      only survived if some component happened to spell it out too, which is
      luck, not a build step. text-health-ok, -warn and -bad were all being
      dropped; text-health-good only made it because app/signup uses it
      literally.
    */
    './hooks/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      /*
        Tailwind 3.3's opacity modifier only accepts values present in this
        scale — `border-white/8` is not "8% white", it is nothing at all, and
        the utility is dropped silently. The element then falls back to
        whatever it would have had otherwise, which for borders is the warm
        --border brown rather than a white hairline.

        354 utilities across the app were landing in that hole: /8 alone
        appears 105 times, /12 42 times, /15 48 times. Nothing errored,
        nothing failed to compile, and the result was only visible by reading
        a computed border colour off a real element.

        The default scale stops at multiples of 5 plus 25/75. Everything the
        codebase actually reaches for is spelled out here.
      */
      opacity: {
        2: '0.02', 3: '0.03', 4: '0.04', 6: '0.06', 8: '0.08',
        12: '0.12', 14: '0.14', 15: '0.15', 16: '0.16', 18: '0.18',
        35: '0.35', 45: '0.45', 55: '0.55', 65: '0.65', 85: '0.85',
        98: '0.98',
      },
      letterSpacing: {
        tighter: '-0.03em',
        tight: '-0.015em',
      },
      fontSize: {
        'display-xl': ['4.5rem', { lineHeight: '1', letterSpacing: '-0.03em' }],
        'display-lg': ['3.75rem', { lineHeight: '1.1', letterSpacing: '-0.03em' }],
        'display-md': ['3rem', { lineHeight: '1.1', letterSpacing: '-0.02em' }],
        'display-sm': ['2.25rem', { lineHeight: '1.2', letterSpacing: '-0.02em' }],
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      fontFamily: {
        // Editorial serif for hero moments only — see .display-serif.
        display: ['var(--font-display)', 'Georgia', 'serif'],
      },
      borderRadius: {
        xl: 'var(--radius-xl)',
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // Warmed elevation ladder, addressable as bg-surface-nav / bg-surface-1.
        // 2 and 3 join it for v7's form controls, so `bg-surface-3` is a real
        // utility rather than something a call site inlines — the roadmap's
        // condition for not writing `hsl(var(--surface-3))` by hand.
        'surface-nav': 'hsl(var(--surface-nav))',
        'surface-1': 'hsl(var(--surface-1))',
        'surface-2': 'hsl(var(--surface-2))',
        'surface-3': 'hsl(var(--surface-3))',
        // Informational — links, column headers, non-CTA labels. Never a CTA.
        info: {
          DEFAULT: 'var(--info)',
          strong: 'var(--info-strong)',
          wash: 'var(--info-wash)',
          border: 'var(--info-border)',
        },
        // Health-ring bands, deliberately distinct from chip semantics.
        // Named `health`, not `ring` — Tailwind already owns `ring` for focus
        // rings, and reusing it would silently clobber ring-* utilities.
        health: {
          good: 'var(--ring-good)',
          ok: 'var(--ring-ok)',
          warn: 'var(--ring-warn)',
          bad: 'var(--ring-bad)',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        'accordion-down': {
          from: {
            height: '0',
          },
          to: {
            height: 'var(--radix-accordion-content-height)',
          },
        },
        'accordion-up': {
          from: {
            height: 'var(--radix-accordion-content-height)',
          },
          to: {
            height: '0',
          },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
export default config;
