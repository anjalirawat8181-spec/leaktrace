const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        raised: token('raised'),
        line: token('line'),
        'line-strong': token('line-strong'),
        fg: token('fg'),
        'fg-muted': token('fg-muted'),
        ok: token('ok'),
        'ok-tint': token('ok-tint'),
        warn: token('warn'),
        'warn-tint': token('warn-tint'),
        danger: token('danger'),
        'danger-tint': token('danger-tint'),
        'danger-solid': token('danger-solid'),
        info: token('info'),
        'info-tint': token('info-tint'),
        'on-accent': token('on-accent'),
      },
      fontFamily: {
        sans: ['"Fira Sans"', 'system-ui', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: { sm: '4px', md: '8px', lg: '12px' },
      boxShadow: {
        card: '0 1px 0 rgb(255 255 255 / 0.03) inset, 0 1px 2px rgb(0 0 0 / 0.5)',
        pop: '0 8px 24px rgb(0 0 0 / 0.6)',
        'glow-ok': '0 0 24px rgb(var(--c-ok) / 0.18)',
        'glow-danger': '0 0 28px rgb(var(--c-danger) / 0.22)',
      },
      transitionDuration: { fast: '150ms', base: '200ms', slow: '300ms' },
      maxWidth: { page: '80rem' },
      keyframes: {
        'toast-in': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        'pulse-dot': { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
      },
      animation: {
        'toast-in': 'toast-in 200ms ease-out',
        'pulse-dot': 'pulse-dot 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
