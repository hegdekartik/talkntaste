# TalknTaste - Agent Guidelines

Welcome, Agent. You are working on **TalknTaste**, a voice-first recipe application that uses Sarvam AI for transcription and structuring. This file contains rules to guide your "vibe coding" sessions and ensure architectural consistency.

## 1. Architecture & Boundaries
- **Frontend (`client/`)**: Pure HTML, CSS, and Vanilla JavaScript. **Do not introduce heavy frontend frameworks (React/Vue)** or UI libraries (Tailwind). We use standard Vite for bundling.
- **Backend (`api/`)**: Vercel Serverless Functions. **Do not create an Express server**. Everything must work as independent HTTP endpoints exporting a default handler.
- **State Management**: The UI is controlled via a state machine in `client/js/app.js` using `data-state` attributes on the root `#app` element. Always transition states via the `setState()` function rather than manually toggling CSS classes for top-level views.

## 2. UI & Design System (Vibrant & Block-based)
- **CSS**: Write vanilla CSS in `client/style.css`.
- **Aesthetics**: The design uses a modern, vibrant aesthetic (warm terracotta, soft green, off-whites) with rounded corners (`var(--radius-lg)`), soft shadows (`var(--shadow-sm)`), and micro-animations (`slideUpFade`). **Do not use generic "bootstrap-style" flat designs**. Always reuse existing CSS variables for colors, spacing, and radii.

## 3. AI Integrations
- **Primary AI**: [Sarvam AI](https://sarvam.ai) is used for both STT (transcription) and LLM structuring (`sarvam-105b`).
- **OpenAI Fallback**: `gpt-4o-mini` is retained *strictly* as a fallback in `api/_lib/sarvam-llm.js` in case Sarvam's LLM fails to return valid JSON. Do not write new features that depend solely on OpenAI.

## 4. Documentation Maintenance
- All conceptual documentation lives in the `docs/` folder (System Design, Deployment, MVP specs). 
- If you make significant architectural changes (e.g., adding a new API endpoint, changing the database schema, introducing a new AI provider), **you must proactively update the relevant markdown files in `docs/`**.
- Keep `README.md` clean and high-level; link to `docs/` for deeper technical details.
