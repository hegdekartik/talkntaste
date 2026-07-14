# TalknTaste — MVP Document

> **Version:** 1.0 (MVP)
> **Status:** Live

---

## 1. Problem Statement

Millions of Indian home cooks carry generations of family recipes entirely in their heads — passed down verbally, never written. When these recipes *are* written, it happens on paper scraps, voice notes, or WhatsApp messages that are hard to search, structured inconsistently, or simply lost.

The core friction is **input**. Typing a full recipe on a mobile phone is slow, error-prone, and unintuitive. Cooks think and speak in their native language, not in neatly bulleted English lists.

**The gap:** There is no simple, mobile-friendly tool that lets someone *speak* a recipe in their language and get back a clean, structured, shareable card — without any typing.

---

## 2. MVP Goal

> Allow a user to speak a recipe in any major Indian language and receive a structured, shareable recipe card in under 2 minutes.

The MVP validates three core hypotheses:

| # | Hypothesis | Validation Signal |
|---|------------|-------------------|
| 1 | Users can and will speak recipes naturally (not just short keyword prompts) | Recordings of 30 seconds or more with full recipe narration |
| 2 | The structured output (ingredients, steps, time, servings) is accurate enough to be useful without heavy manual correction | < 2 fields edited per recipe before publishing |
| 3 | The sharing feature drives organic reach | Recipes shared externally via WhatsApp / social media |

---

## 3. MVP Scope (What's Built)

### ✅ In Scope

#### Input
- **Live recording** via in-browser microphone (up to 3 minutes)
- **File upload** for pre-recorded audio (MP3, WAV, M4A, WEBM, OGG, FLAC)
- **Language selection** with an optional hint (22 Indian languages + English India), or full auto-detection
- **Client-side duration validation** to prevent excessively long uploads

#### Processing
- **Short audio (≤ ~30s):** Synchronous transcription with near-instant results
- **Longer audio (30s–3min):** Asynchronous batch transcription with polling, with live progress shown in UI
- **AI structuring:** Raw transcript is parsed into a structured recipe object with title, prep time, servings, ingredients list, step-by-step instructions, and categorical tags
- **Language preserved:** The recipe card retains the language the cook spoke in

#### Review & Edit
- **Editable recipe card:** Users can inline-edit any field (title, ingredient, step) before publishing
- **Audio playback:** The original recording is attached to every recipe card
- **Raw transcript view:** Users can view the verbatim transcription alongside the structured card

#### Sharing & Publishing
- **One-tap WhatsApp sharing** with emoji-formatted text optimized for mobile reading
- **Twitter/X sharing** with a pre-composed tweet
- **Clipboard copy** for pasting anywhere
- **Publish to library:** Recipe is persisted to a shared database and visible in the community feed

#### Community Library
- **Public recipe feed** browsable by all users
- **Language and tag filtering** (e.g., filter by "Vegetarian", "Dessert", or "Tamil")
- **Smart emoji thumbnails** — auto-assigned per recipe based on detected tags/title (no photo upload required)
- **Audio playback per recipe** — hear the original cook's voice
- **Back navigation** from recipe detail view to library feed
- **Author attribution** via optional name entry on the homepage

---

## 4. Out of Scope (Explicitly Deferred)

The following are **not** part of MVP and have been intentionally excluded to maintain focus:

| Feature | Reason Deferred |
|---------|----------------|
| User accounts / authentication | Adds significant complexity; anonymous publishing is sufficient to validate community hypothesis |
| Recipe image upload by user | Users unlikely to upload consistently; emoji thumbnails solve the visual need adequately for MVP |
| Recipe search (full-text) | Filtering by language/tag is sufficient at this user volume; search adds infra complexity |
| Recipe edit after publishing | Adds a mutability concern; MVP assumes publish = done |
| Notifications / follows / likes | Social graph features are post-PMF |
| Native mobile app (iOS/Android) | Progressive Web App (PWA) on mobile browser is sufficient for initial distribution |
| Offline mode | Requires service worker complexity; deferred |
| Multiple audio segments / chapter support | Recipes > 3 minutes are out of scope; encourage conciseness |

---

## 5. User Flow (End-to-End)

```
 Homepage
 ├── (Optional) Enter name
 ├── (Optional) Select language hint from dropdown
 ├── Tap mic → Speak recipe → Tap stop
 │     OR
 └── Upload an audio file
          │
          ▼
  Processing Screen
  ├── Step 1: Audio uploaded to cloud storage
  ├── Step 2: Transcription (sync or async batch)
  └── Step 3: AI structures transcript into recipe JSON
          │
          ▼
  Recipe Card (Draft)
  ├── Review title, prep time, servings, ingredients, steps, tags
  ├── Play back your original audio
  ├── Edit any field inline
  ├── Discard / Retry
  └── Publish
          │
          ▼
  Library Tab
  ├── See your recipe in the feed
  ├── Filter by language or tag
  └── Tap any recipe → Full view → Back to Library
```

---

## 6. Known MVP Limitations & Risks

| Limitation | Impact | Mitigation / Future Plan |
|------------|--------|--------------------------|
| No user auth — recipes are anonymous or name-only | Users cannot manage their own recipes; no way to delete or edit after publish | Add auth in v1.1 |
| Transcription accuracy degrades with heavy background noise | Noisy kitchen recordings may produce garbled text | Show raw transcript so user can reference + edit |
| AI structuring can miss unstated quantities or steps | Recipe card may have incomplete ingredients | Allow easy inline editing before publish |
| 3-minute cap on audio | Longer, more complex recipes cannot be captured in one go | Considered acceptable for MVP; multi-segment is a future feature |
| No recipe image | Cards look uniform; visual differentiation relies purely on emoji | Emoji-based system is surprisingly effective; user image upload deferred |
| No search | Library becomes hard to navigate at scale | Tag + language filtering adequate for current user volume |
| Single shared public library | No privacy controls — all published recipes are public | Authentication + private/public toggle planned post-MVP |

---

## 7. Success Metrics for MVP

| Metric | Target | Measurement |
|--------|--------|-------------|
| Successful recipe submissions | ≥ 50 recipes in first 2 weeks | Database count |
| Languages represented | ≥ 5 distinct languages in library | `language` field distribution |
| Share rate | ≥ 30% of viewed recipes result in a share action | Share button click events |
| Edit rate before publish | ≤ 2 field edits per recipe on average | Client-side instrumentation |
| Repeat usage | ≥ 20% of users submit more than 1 recipe | `author_name` recurrence |

---

## 8. What Comes Next (Post-MVP Roadmap)

### Phase 2 — Trust & Identity
- User authentication (email or phone OTP)
- Personal recipe dashboard (view, edit, delete your own recipes)
- Recipe privacy toggle (public / private)

### Phase 3 — Discovery & Scale
- Full-text recipe search
- Related recipe recommendations
- Recipe ratings / saves / bookmarks
- Featured recipes and curated collections

### Phase 4 — Richer Input
- Optional photo upload per recipe (with client-side compression)
- Multi-segment recording support for longer recipes
- Video narration support

### Phase 5 — Ecosystem
- Embeddable recipe widget for food blogs
- WhatsApp bot integration (send audio, receive structured recipe)
- Export to PDF / print-friendly format
