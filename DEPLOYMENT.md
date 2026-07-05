# Deployment Architecture: Talk2Taste

This document outlines the deployment architecture for the **Talk2Taste** application, detailing how the frontend and backend are split across Vercel and Render, why this decision was made, and recommendations for future scalability.

---

## 1. The Split Architecture

Talk2Taste utilizes a modern decoupled architecture:
*   **Frontend (Client):** Hosted on **Vercel**
*   **Backend (API):** Hosted on **Render**

### What Vercel Does
Vercel is responsible for hosting the `client/` directory of the application, which is a static frontend built with **Vite**.

**Why Vercel for the Frontend?**
1.  **Global Edge CDN:** Vercel automatically caches your static assets (HTML, CSS, JS) across its global edge network, meaning users in India, the US, or Europe will load the initial UI almost instantly.
2.  **Instant Deployments:** Pushing to the `main` branch automatically builds and deploys the Vite app in seconds.
3.  **Preview Environments:** Vercel automatically creates preview URLs (e.g., `talkntaste-xview.vercel.app`) for every pull request, allowing you to test UI changes before merging to production.

### What Render Does
Render is responsible for hosting the `api/` directory as a continuously running **Node.js Express Web Service**.

**Why Render for the Backend?**
1.  **Long-Running Tasks:** The core feature of Talk2Taste involves AI audio transcription (via Sarvam AI) and structuring (via OpenAI). These tasks can easily exceed 30–60 seconds. Vercel's Serverless Functions have strict timeouts (10 seconds on the free tier, 60 seconds on paid) that force connections to drop. Render provides a "Serverful" environment where a single HTTP request can remain open for up to 100 minutes without timing out.
2.  **State and Memory:** An Express server on Render runs continuously in the background, making it much easier to handle file buffers, streams, and batch processing compared to ephemeral serverless functions.
3.  **Real-time Capabilities:** Should the app transition to streaming audio over WebSockets in the future, Render natively supports persistent WebSocket connections, whereas Vercel serverless functions do not.

---

## 2. How They Communicate

1.  The frontend deployed on Vercel is injected with an environment variable: `VITE_API_URL` (set to `https://talkntaste-api.onrender.com/api`).
2.  When a user records audio, the Vite app makes an HTTP POST request to that Render URL.
3.  The Render Express server receives the request, processes the audio using Sarvam and OpenAI, saves the data to Supabase, and returns the structured JSON back to the Vercel frontend.
4.  **CORS (Cross-Origin Resource Sharing):** The Render API is explicitly configured (in `server.js`) to trust requests originating from `https://talkntaste.vercel.app` to ensure security.

---

## 3. Current Limitations

*   **Render Cold Starts:** If you are using Render's Free Tier, the backend service will "spin down" after 15 minutes of inactivity. When a new user visits the site and records audio, the first API request will take an extra 30–60 seconds as Render wakes the server up.
*   **Polling Overhead:** The codebase still utilizes a polling mechanism (`/api/poll`) for long audio files because it was originally built around Vercel's timeout limits. While it works flawlessly on Render, it is no longer strictly necessary since Render can keep the initial request open indefinitely.

---

## 4. Future Recommendations

As Talk2Taste scales, consider the following architectural improvements:

### Upgrade Render for "Always-On"
If users experience frustratingly slow first-recordings due to cold starts, the easiest fix is to upgrade the Render Web Service to the lowest paid tier (~$7/month). This prevents the server from spinning down and guarantees immediate responses.

### Refactor Polling to Direct Async/Await
Because the API now runs on Render without strict timeouts, you can simplify the `client/js/api.js` logic. Instead of having the frontend upload to Supabase, ping `/process` (which returns a `202 Accepted` job ID), and then poll `/poll` every 3 seconds, you can rewrite the `/process` endpoint to synchronously handle the entire batch transcription flow and wait for completion before returning a single `200 OK` response.

### Implement Real-time Audio Streaming (WebSockets)
Currently, users must finish speaking, hit stop, wait for an upload, and wait for processing. With Render's persistent connections, you can implement WebSockets (e.g., using `Socket.io`). This would allow the frontend to stream chunks of audio directly to the Render server in real-time as the user speaks, dramatically reducing the perceived processing delay.

### Supabase Edge Functions (Alternative Backend)
If you ever want to move away from managing a Node.js server entirely, Supabase offers Edge Functions. However, these also have execution time limits similar to Vercel. They are best used if you refactor the AI pipeline into background webhook queues.

### Consolidate to a Single Monorepo Deployment
If managing two separate dashboards (Vercel + Render) becomes cumbersome, you can actually deploy the *entire* application on Render. Since you have an Express server, you can configure Express to serve the static built Vite files from `client/dist`. 
*   *Pros:* One deployment, one domain, no CORS configuration required.
*   *Cons:* You lose Vercel's hyper-optimized Edge CDN for the frontend UI.
