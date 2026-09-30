---
name: Seoul Heritage Elite
colors:
  surface: '#16130f'
  surface-dim: '#16130f'
  surface-bright: '#3c3934'
  surface-container-lowest: '#100e0a'
  surface-container-low: '#1e1b17'
  surface-container: '#221f1b'
  surface-container-high: '#2d2925'
  surface-container-highest: '#38342f'
  on-surface: '#e9e1da'
  on-surface-variant: '#d1c5b5'
  inverse-surface: '#e9e1da'
  inverse-on-surface: '#33302b'
  outline: '#9a8f81'
  outline-variant: '#4d463a'
  surface-tint: '#e6c183'
  primary: '#e6c183'
  on-primary: '#422d00'
  primary-container: '#c5a368'
  on-primary-container: '#503907'
  inverse-primary: '#755a26'
  secondary: '#c6c6c9'
  on-secondary: '#2f3133'
  secondary-container: '#454749'
  on-secondary-container: '#b4b5b7'
  tertiary: '#b4c7f0'
  on-tertiary: '#1e3051'
  tertiary-container: '#96a8d0'
  on-tertiary-container: '#2b3d5f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdea8'
  primary-fixed-dim: '#e6c183'
  on-primary-fixed: '#271900'
  on-primary-fixed-variant: '#5b4311'
  secondary-fixed: '#e2e2e5'
  secondary-fixed-dim: '#c6c6c9'
  on-secondary-fixed: '#1a1c1e'
  on-secondary-fixed-variant: '#454749'
  tertiary-fixed: '#d7e2ff'
  tertiary-fixed-dim: '#b4c7f0'
  on-tertiary-fixed: '#051b3b'
  on-tertiary-fixed-variant: '#354769'
  background: '#16130f'
  on-background: '#e9e1da'
  surface-variant: '#38342f'
  ivory-white: '#F9F8F3'
  charcoal-deep: '#0F1012'
  gold-muted: '#A68955'
  glass-stroke: rgba(197, 163, 104, 0.2)
typography:
  display-lg:
    fontFamily: EB Garamond
    fontSize: 48px
    fontWeight: '500'
    lineHeight: '1.1'
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: EB Garamond
    fontSize: 32px
    fontWeight: '500'
    lineHeight: '1.2'
  headline-lg-mobile:
    fontFamily: EB Garamond
    fontSize: 28px
    fontWeight: '500'
    lineHeight: '1.2'
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.5'
    letterSpacing: 0.05em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  data-mono:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.02em
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: '1'
    letterSpacing: 0.1em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1440px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
  section-gap: 80px
  element-gap: 16px
---

## Brand & Style

This design system is tailored for the upper echelon of the Seoul real estate market, specifically targeting high-net-worth individuals and VIP consultants. The brand personality is **authoritative, discreet, and exceptionally refined**. It avoids the clutter of traditional real estate portals, instead favoring the "quiet luxury" aesthetic found in private banking and high-end gallery spaces.

The design style is a sophisticated blend of **Modern Minimalism** and **Glassmorphism**. It utilizes expansive whitespace (negative space) to signal exclusivity and reduce cognitive load for decision-makers. Elements are layered using subtle translucent effects to create a sense of architectural depth, mirroring the premium properties the system represents. The emotional response should be one of absolute confidence, serenity, and prestige.

## Colors

The palette is anchored in a **Dark Mode** default to evoke a premium, evening-gala atmosphere. 

- **Primary (Sophisticated Gold):** Used sparingly for interactive elements, call-to-actions, and key data trend lines. It represents wealth and success.
- **Secondary (Deep Charcoal):** The foundation of the UI, providing a solid, grounded feeling that replaces standard blacks for a softer, more "ink-like" premium finish.
- **Neutral (Ivory White):** Used for primary typography and high-contrast labels. It is slightly warmed to avoid the sterile coldness of pure white.
- **Surface Strategy:** Backgrounds utilize a gradient from `charcoal-deep` to `secondary`. Cards and containers use semi-transparent overlays to create the glassmorphic depth required for a modern dashboard.

## Typography

The typography strategy relies on a high-contrast pairing between a classical serif and a technical sans-serif.

- **Headlines:** Use **EB Garamond** for all major section titles and property names. It conveys historical prestige and literary authority.
- **Body & Data:** Use **Hanken Grotesk** for all functional text, market data, and descriptions. It is exceptionally legible and provides a "Swiss-style" precision that balances the romanticism of the serif.
- **Styling Note:** Use `label-caps` (All-caps with increased letter spacing) for category tags and metadata to create a rhythmic, structured feel. Large numerals in data visualizations should remain in Hanken Grotesk but with medium weights to maintain clarity.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy on desktop to ensure that the dashboard maintains a curated, "editorial" look regardless of screen size. 

- **Desktop (1440px):** 12-column grid with generous 64px outer margins. This creates a "frame" effect around the data.
- **Rhythm:** Spacing follows an 8px scale, but favors larger increments (24px, 40px, 80px) to maintain the "Generous Whitespace" requirement.
- **Visual Flow:** The "One-Page" dashboard is divided into distinct full-width horizontal bands. Each section (Villa Status, Apartment Trends, News) is separated by at least 80px of vertical space to allow the eyes to rest between data-heavy segments.

## Elevation & Depth

Hierarchy is established through **Tonal Layers** and **Glassmorphism** rather than traditional heavy shadows.

1.  **Base Layer:** The deepest charcoal background, matte finish.
2.  **Surface Layer (Cards):** Semi-transparent (15-20% opacity) charcoal with a 40px backdrop blur. This creates the "Glass" effect.
3.  **Accent Elevation:** Cards are bordered with a 1px "Ghost Border" using `glass-stroke`. This thin, shimmering line defines the shape without adding visual weight.
4.  **Shadows:** When necessary for focus (e.g., hover states), use extremely large, low-opacity gold-tinted shadows (`rgba(197, 163, 104, 0.05)`) with a 60px blur to simulate a soft ambient glow rather than a physical drop shadow.

## Shapes

The shape language is **Soft but Structured**. We use a subtle 0.25rem (4px) base radius to prevent the UI from feeling "sharp" or aggressive, while maintaining the architectural precision expected in high-end real estate. 

- **Primary Cards:** Use `rounded-lg` (8px) for a sophisticated, slightly softened corner.
- **Interactive Elements:** Buttons and input fields use the base 4px radius. 
- **Avoidance:** Absolutely no pill-shaped (fully rounded) elements or perfectly circular buttons, as these are viewed as too "playful" or "app-like" for a VIP institutional tool.

## Components

- **Refined Data Cards:** Glassmorphic containers with a subtle top-light gradient. Titles are in `label-caps` gold, while primary figures are large Ivory White.
- **Sophisticated Line Charts:** Use the `primary_color` (Gold) for the main data line. The area under the line should have a very subtle gold-to-transparent gradient fill. Remove all grid lines except for the baseline and the highest peak to maintain a clean aesthetic.
- **Buttons:** Primary buttons are ghost-style with a `primary_color` border and Ivory White text. On hover, they fill with a subtle gold tint.
- **Input Fields:** Minimalist underlines or very subtle ghost-borders. No heavy background fills.
- **API Status Labels:** For dummy data, use a small, elegant tag with a `data-mono` font and a gold border, positioned in the top-right corner of the component.
- **Property Lists:** Use high-resolution, desaturated imagery with generous padding between items. Titles in EB Garamond.