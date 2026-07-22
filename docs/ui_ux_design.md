# TalknTaste UI/UX Design Specification: "Ember Kitchen"

This document outlines the visual identity, token system, interactive states, and layout architecture implemented in the TalknTaste application.

---

## 🎨 Visual Identity & Color System

TalknTaste utilizes the **"Ember Kitchen"** design system. It is a system-aware, dark-first color scheme that shifts between a cozy kitchen-at-dusk (dark mode) and a clean, warm-cream culinary setting (light mode).

### Theme Variables

```css
/* Light Mode (default) */
:root {
  --bg-deep:           #FAF7F4; /* Warm Cream */
  --bg-surface:        #FFFFFF; /* Pure White Card */
  --bg-surface-raised: #F4F0EC; /* Elevated Warm Grey */
  --bg-glass:          rgba(255, 255, 255, 0.82);
  --border-subtle:     rgba(180, 120, 40, 0.14);
  --border-glass:      rgba(120, 80, 20, 0.10);

  --text-bright:       #1C1917; /* Near Black */
  --text-dim:          #57534E; /* Dark Grey */
  --text-faint:        #A8A29E; /* Muted Warm Grey */

  --ember:             #D97706; /* Core Amber Accent */
  --ember-deep:        #B45309;
  --flame:             #EF4444; /* Alert/Recording state */
  --sage:              #16A34A; /* Success/Check state */
}

/* Dark Mode (override or default prefers-color-scheme) */
html[data-theme="dark"] {
  --bg-deep:           #0C0A09; /* Near Black */
  --bg-surface:        #1C1917; /* Slate Card */
  --bg-surface-raised: #292524; /* Elevated Slate */
  --bg-glass:          rgba(28, 25, 23, 0.82);
  --border-subtle:     rgba(245, 158, 11, 0.12);
  --border-glass:      rgba(245, 158, 11, 0.08);

  --text-bright:       #FAFAF9; /* Off White */
  --text-dim:          #A8A29E; /* Light Grey */
  --text-faint:        #78716C; /* Dark Slate Muted */

  --ember:             #F59E0B; /* Vivid Amber */
  --ember-deep:        #FBBF24;
  --flame:             #F87171;
  --sage:              #4ADE80;
}
```

---

## 🛠️ Key UI Components & Interactions

### 1. Dynamic Recording Hub
*   **Concentric Pulsing Rings**: Three ambient borders pulse behind the microphone button (`.mic-rings`), expanding and fading dynamically.
*   **Flame Gradient Switch**: The mic button shifts from amber (`--ember` to `--ember-deep`) when idle to active red (`--flame`) when recording.
*   **Timer & Pulse Indicator**: Active recording shows a tabular numeric countdown timer next to a pulsing red dot.

### 2. Floating Bottom Navigation Bar
*   **Glassmorphic Overlay**: The bottom navigation is shaped as a floating pill with a deep blur effect (`backdrop-filter: blur(24px)`) and subtle accent borders.
*   **Active Accent Pill**: Active navigation items receive an amber tint with a filled icon.

### 3. Recent Recipes Grid (Library)
*   **Shimmer Skeleton Loader**: While fetching recent recipes, skeleton loading boxes fade in and out (`@keyframes shimmer`) to give instant feedback.
*   **Tag Chips**: Categories are colored in soft amber tints for enhanced contrast.
*   **Top Banner Emoji Grid**: Emoji badges are given a gradient background card container to separate different cuisines visually.

### 4. Bento Box Recipe Card Layout
*   **Structured Box Borders**: Bento containers use color-coded left borders to separate ingredients, preparation steps, and audio.
*   **Interactive Checked State**: Tapping an ingredient item toggles the checkbox to green with a strike-through transition.
*   **Step Badges**: Cook steps are numbered using circular amber-filled gradient circles.

---

## 🌓 Theme Toggle Mechanism

The system checks for a saved theme in browser storage (`localStorage`), falling back to the operating system preference (`prefers-color-scheme`).

*   **Sun/Moon Toggle Icon**: Switches seamlessly between themes with a clean transition.
*   **Audio Player Styling**: When dark theme is active, custom CSS filters invert and match the native HTML5 `<audio>` element with the dark background.
