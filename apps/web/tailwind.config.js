export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { lab: { bg: '#07090b', panel: '#0f1316', line: '#1f272d', text: '#c9d4dc', dim: '#6b7a86' } },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
};
