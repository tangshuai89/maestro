/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 全部走 `--sh-*` 命名空间（见 tokens-bridge.scss 头部注释：
        // 直接用 shadcn 原生名会与 AETHER 同名令牌撞车）
        border: 'hsl(var(--sh-border))',
        input: 'hsl(var(--sh-input))',
        ring: 'hsl(var(--sh-ring))',
        background: 'hsl(var(--sh-background))',
        foreground: 'hsl(var(--sh-foreground))',
        primary: { DEFAULT: 'hsl(var(--sh-primary))', foreground: 'hsl(var(--sh-primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--sh-secondary))', foreground: 'hsl(var(--sh-secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--sh-destructive))', foreground: 'hsl(var(--sh-destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--sh-muted))', foreground: 'hsl(var(--sh-muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--sh-accent))', foreground: 'hsl(var(--sh-accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--sh-popover))', foreground: 'hsl(var(--sh-popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--sh-card))', foreground: 'hsl(var(--sh-card-foreground))' },
        // AETHER 派生 (spec §数据模型)
        success: 'hsl(var(--sh-success))',
        warning: 'hsl(var(--sh-warning))',
        info:    'hsl(var(--sh-info))',
        'accent-warm':   'hsl(var(--sh-accent-warm))',
        'accent-blue':   'hsl(var(--sh-accent-blue))',
        'accent-purple': 'hsl(var(--sh-accent-purple))',
      },
      borderRadius: {
        lg: 'var(--sh-radius)',
        md: 'calc(var(--sh-radius) - 2px)',
        sm: 'calc(var(--sh-radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
