# DealForge AI — DESIGN.md

Design reference for the DealForge front-end surfaces: Landing Page, Call Screen, Deal Intelligence Dashboard, and Login Screen. This document locks in the official "Bento-Box" design language and psychology.

## 0. The Design Philosophy

Most beautiful websites convert badly because they lead with features before the visitor understands the problem. Structure guides psychology. Our UI is engineered to feel like a high-end, developer-first command center. It uses an asymmetric Bento-Box grid system, a strict dual-font typographic scale, and smooth micro-animations.

**Key principles**:
- **Bento-Box Grids**: Content is separated into distinct, floating cards with 1px hairline borders on a cream background. No heavy drop shadows.
- **Flat & Crisp**: Flat colors. The visual depth comes from the contrast between the dark terminal elements and the clean cream canvas, not from artificial 3D shadows.
- **Motion-first**: Animations are intentional (CSS scroll reveals, breathing SVG orbs, staggered keyframes). The UI should feel like a living, real-time AI runtime.

## 1. Color Palette

| Token | Hex | Use in DealForge |
|---|---|---|
| Canvas | `#EEEFE9` | Page background |
| Surface Card | `#FFFFFF` | Floating Bento cards, standard containers |
| Surface Dark | `#121310` | Elevated/terminal surfaces, primary buttons, footers |
| Ink (text) | `#121310` | Headlines, primary text |
| Body | `#4D4F46` | Paragraph and standard context text |
| Mute | `#6C6E63` | Metadata, timestamps, less important labels |
| Hairline | `#BFC1B7` | 1px card borders — flat design |
| **Accent — Amber** | `#F7A501` | Primary highlight, "listening" state, active MEDDIC items, alerts |
| **Verdict — Green** | `#2F7A4F` | Approved / qualified / confirmed states |
| **Verdict — Red** | `#A3341E` | Rejected / escalation / unconfirmed-critical states |

## 2. Typography

We use a strict dual-font system.
- **IBM Plex Mono**: Used strictly for headers, titles, labels, terminal text, buttons, and numeric stats. MUST ALWAYS BE UPPERCASE in headings. This gives the site its engineered, authoritative feel.
- **Inter**: Used strictly for body text, paragraphs, and descriptions. Retains maximum legibility for dense information.

| Role | Spec |
|---|---|
| Headline (XL/LG) | IBM Plex Mono / 700 / Uppercase / clamp() scaling |
| Card Heading | IBM Plex Mono / 700 / Uppercase / 18px-24px |
| Body (Context) | Inter / 400 or 500 / 16px-18px / 1.6+ line-height |
| Buttons / Labels | IBM Plex Mono / 600 or 700 / Uppercase / 12px-14px |
| Terminal Text | IBM Plex Mono / 400 / 14px-15px |

## 3. Spacing, Radius, and Structure

- **Container Width**: Max-width of `1536px` (or `width: 92%; max-width: 100%` where appropriate) to use the full viewport on widescreen displays.
- **Radius**:
  - `8px` for small interior elements.
  - `16px` for standard Bento cards.
  - `32px` for large hero Bento cards.
  - `9999px` (Pill shape) exclusively for primary CTA buttons and status badges.
- **Elevation**: Cards sit flat on the cream canvas with a 1px hairline border. The dark terminal surface (`#121310`) acts as the primary "depth" cue.

## 4. Core Components

- **Pill Badges**: `border-radius: 9999px; font-family: 'IBM Plex Mono'; text-transform: uppercase;`. Used with a colored dot to indicate status (e.g., "LIVE", "THE PROBLEM").
- **Terminal Simulator**: Dark `#121310` background, window controls (red/yellow/green dots), animated lines of IBM Plex Mono text fading in sequentially.
- **Verdict Banners**: Red or green text/icons for quick visual feedback on AI decisions (e.g., "35% → REJECTED" in red).
- **Step Tracker**: Used in the How It Works and Call Screen to show progression (`QUALIFY → NEGOTIATE → BOOK`).
- **Vector Assets**: CSS-generated vector animations (like the glowing orb / waveform for the voice agent) or high-quality 2D flat illustrations.

## 5. Screen Layouts

### Login Page (`/login`)
- A minimal Bento-box card in the center of the cream canvas.
- IBM Plex Mono title ("AUTHENTICATE").
- A pill-shaped CTA for Google Sign-In.

### Call Screen (`/call`)
- Mobile-first, single column. Minimal UI for the prospect.
- Features the live breathing Voice AI orb (reusing CSS from Landing Page).
- Live transcription caption in IBM Plex Mono.
- Step tracker indicating conversation progress.

### Dashboard (`/dashboard`)
- Desktop-first layout for the sales manager.
- Dense, highly structured Bento-Box grid.
- **Deal State**: Real-time stats updating on the left.
- **MEDDIC Checklist**: Status glyphs for the 6 pillars.
- **Live Terminal**: The bottom strip showing raw reasoning/tool calls, mimicking the Demo Terminal from the landing page.
- **Approval Card**: Popping up over the grid for human-in-the-loop decisions.
