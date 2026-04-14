# Al-GhazalyParts Workspace

## Overview

pnpm workspace monorepo using TypeScript. This is an Arabic-language auto parts e-commerce app ("قطع غيار السيارات") with an Expo React Native mobile frontend and an Express.js backend API.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **Mobile**: Expo (React Native) with Expo Router v6, Zustand, React Query, Axios
- **API framework**: Express 5 (raw pg pool, no ORM)
- **Database**: PostgreSQL (23 tables — users, products, orders, categories, car_brands, car_models, etc.)
- **Real-time**: WebSocket (ws) embedded in the API server
- **Auth**: Bearer token (session_token) stored in Zustand + localStorage

## Structure

```text
workspace/
├── artifacts/
│   ├── api-server/         # Express API server (port 8080, proxied at /)
│   │   └── src/
│   │       ├── index.ts          # HTTP + WebSocket server entry
│   │       ├── app.ts            # Express app, CORS, middleware
│   │       ├── server-routes.ts  # All 3854-line route handler
│   │       ├── auth.ts           # Auth helpers (bcryptjs, session tokens)
│   │       ├── server-db.ts      # Raw pg pool + query() helper
│   │       ├── twilio.ts         # SMS stub (logs only, no real SMS)
│   │       ├── gmail.ts          # Email stub (logs only, no real email)
│   │       └── excelService.ts   # Excel export using xlsx
│   └── mobile/             # Expo React Native app
│       ├── app/                  # Expo Router file-based routes
│       │   ├── _layout.tsx       # Root layout with AuthGuard, Zustand hydration
│       │   ├── (tabs)/           # Tab navigator (home, categories, account, search)
│       │   ├── login.tsx         # Login screen
│       │   ├── product/[id].tsx  # Product detail
│       │   ├── category/[id].tsx # Category view
│       │   ├── brand/[id].tsx    # Brand view
│       │   ├── orders.tsx        # Orders list
│       │   ├── checkout.tsx      # Checkout flow
│       │   └── favorites.tsx     # Favorites
│       ├── src/
│       │   ├── services/
│       │   │   ├── api.ts              # Axios instance (uses EXPO_PUBLIC_DOMAIN)
│       │   │   ├── websocketService.ts # WebSocket client (real-time updates)
│       │   │   ├── syncService.ts      # Background data sync
│       │   │   ├── offlineDatabaseService.ts  # Local SQLite cache
│       │   │   └── ...other services
│       │   ├── store/
│       │   │   ├── appStore.ts    # Main Zustand store (persisted to localStorage)
│       │   │   └── cartStore.ts   # Cart Zustand store
│       │   ├── providers/
│       │   │   └── QueryProvider.tsx   # React Query provider
│       │   ├── hooks/
│       │   │   ├── useChat.ts         # Chat/WS hook (conversations, messages, AI agent)
│       │   │   └── ...other hooks
│       │   └── components/
│       │       ├── chat/
│       │       │   ├── ChatFloatingButton.tsx  # Floating chat button with badge + pulse
│       │       │   ├── ChatModal.tsx           # Full-screen modal with 3-tab layout
│       │       │   ├── DirectChatTab.tsx       # Conversations list + admin panel
│       │       │   ├── ConversationView.tsx    # Message bubbles, input bar, date sep.
│       │       │   ├── AiAgentTab.tsx          # AI agent chat with quick questions
│       │       │   └── TrashTab.tsx            # Deleted conversations + restore
│       │       └── ui/              # Shared UI components
│       ├── lib/
│       │   └── query-client.ts   # React Query client (uses expo/fetch)
│       ├── metro.config.js       # Metro bundler config (pnpm monorepo aware)
│       └── app.json              # Expo config (slug: "mobile")
├── pnpm-workspace.yaml
└── package.json
```

## Environment Variables

- `EXPO_PUBLIC_DOMAIN` = `$REPLIT_DEV_DOMAIN` — used by mobile app to call API
- `EXPO_PACKAGER_PROXY_URL` = `https://$REPLIT_EXPO_DEV_DOMAIN` — Expo proxy URL
- `DATABASE_URL` — PostgreSQL connection string (provided by Replit)
- `PORT` — assigned by Replit per workflow

## CORS Setup

API server (`app.ts`) allows all origins containing `.replit.dev` or `.kirk.replit.dev`, which covers both the main Replit preview domain and the Expo development domain (`*.expo.kirk.replit.dev`).

## AI Chat Assistant (Rule-Based — No External AI)

The AI agent (`/api/chat/ai-agent/message`) uses a **100% local rule-based system** — no Anthropic, no OpenAI, no external API:
- Detects language (Arabic/English) via regex
- Detects intent: greetings, orders inquiry, store info, product search, thanks
- Searches products, orders, knowledge_base directly from PostgreSQL
- Returns formatted Arabic/English response with emojis and bullet points

The `buildSmartResponse()` function is in `artifacts/api-server/src/routes/chat.ts` (lines ~100–220).

**Removed packages**: `@ai-sdk/anthropic`, `@ai-sdk/openai`, `ai`, `openai`, `@picahq/ai` — none remain.

## Key Workflows

- **`artifacts/api-server: API Server`** — `pnpm --filter @workspace/api-server run dev`
- **`artifacts/mobile: expo`** — `pnpm --filter @workspace/mobile run dev`

### API Server Stability — SOLVED via Expo workflow embedding

**Root cause found**: `ss` and `netstat` are broken in Replit's container — they show no ports even when servers are listening. `restart_workflow` for api-server uses these tools for port detection → always fails (DIDNT_OPEN_A_PORT).

**Solution**: API server runs as a **background process inside the Expo workflow** (which IS stable). The Expo workflow detects its own port (18115) correctly and stays "running" permanently.

- `artifacts/mobile/start-dev.sh` — starts API server on :8080, monitors it via curl health checks, then starts Expo with exec
- `artifacts/mobile/package.json` → dev script = `sh start-dev.sh`

**The `artifacts/api-server: API Server` workflow will always show "failed"** — this is expected and normal. Ignore it. The server runs in the Expo workflow.

**After API server code changes, rebuild:**
```bash
cd /home/runner/workspace/artifacts/api-server && pnpm run build
```
Then restart the **Expo workflow** (not the api-server workflow) to pick up the new build.

**Port detection tools that work in Replit containers**: `curl`, `/proc/net/tcp` (hex). `fuser`, `ss`, `netstat` do NOT work.

## Delta Sync Architecture (syncService.ts v4)

The mobile app's background sync uses **delta sync** (changes only, not full data):

- **Endpoint**: `GET /api/delta-sync/full?tables=...&last_sync=<ISO>`
- **Interval**: 5 minutes (was 60 seconds)
- **Backoff**: Exponential on failure: 10s → 20s → 40s → max 5 min
- **First sync**: Immediate on app start (no `last_sync` param → full data)
- **Subsequent syncs**: Only records changed since `last_sync` timestamp
- **Timestamp stored**: `alghazaly_last_sync` in AsyncStorage
- **Sync started once**: In `_layout.tsx` only (duplicate from `index.tsx` removed)

## Database

23 tables created with raw SQL. Key tables:
- `users` — user accounts with roles (guest, user, subscriber, admin, partner, owner)
- `products` — auto parts catalog
- `orders` / `order_items` — order management
- `categories` / `car_brands` / `car_models` — product taxonomy
- `notifications`, `promotions`, `marketing_slides` — CMS features
- `sessions` — auth session tokens
- `conversations`, `chat_messages` — customer support and AI chat (Task #1)
- `knowledge_base` — AI training documents, Q&A, links, YouTube videos (Task #1)

## Authentication

Custom Bearer token auth:
1. User logs in → server generates `session_token` (UUID)
2. Token stored in `sessions` table + returned to client
3. Client stores in Zustand (persisted to localStorage on web, AsyncStorage on native)
4. All API requests include `Authorization: Bearer <token>`

## External Services

- **Twilio** (SMS): `twilio.ts` — logs messages, does NOT send real SMS
- **Gmail** (Email): `gmail.ts` — logs emails, does NOT send real emails
- **Push Notifications**: `pushNotificationService.ts` — browser notifications where supported
- **ElevenLabs TTS/STT** (LIVE): `artifacts/api-server/src/lib/elevenlabs.ts`
  - TTS: `POST /api/elevenlabs/tts` — returns `{ audio: base64, mimeType }` JSON
  - STT: `POST /api/elevenlabs/stt` — body `{ audio: base64, mimeType }`, returns `{ text }`
  - Uses `@replit/connectors-sdk` proxy pattern; connection: `conn_elevenlabs_01KN22F51J19QB2S87NNC0ZGTM`
- **Google Calendar** (LIVE): `artifacts/api-server/src/lib/googleCalendar.ts`
  - Appointment creation via `createCalendarEvent()` — always create fresh client, never cache
  - Uses googleapis package; connection: `conn_google-calendar_01KN2247ETJPHW3J419VWBY2P3`

## Appointments System

- **Table**: `appointments` — created dynamically via `artifacts/api-server/src/routes/appointments.ts`
- **Routes**: `GET /api/appointments`, `POST /api/appointments`, `PATCH /api/appointments/:id/status`
- **Google Calendar integration**: Each new appointment also creates a Google Calendar event (optional — continues if Calendar fails)
- **Mobile API**: `appointmentsApi` in `artifacts/mobile/src/services/api.ts`
- **UI**: `MaintenanceBookingModal.tsx` — date/time picker with 7-day lookahead + time slots + service type

## Customer AI Agent Tab (AiAgentTab.tsx)

The customer view (`isPrivileged = false`) is a complete redesign:
- **Subscription gate**: Non-subscribers see golden locked icon + "اشترك الآن" button
- **Subscribers/owner/admin**: See the legendary golden animated icon (pulse animation)
- **Tap golden icon → Active state**: Input bar slides up (text + image)
- **Tap icon in active state → Recording**: 7-second audio chunks via expo-av, up to 35 seconds total
- **STT**: Each chunk sent to `/api/elevenlabs/stt` → transcript sent to AI
- **TTS**: AI responses played back via `/api/elevenlabs/tts` → expo-av Sound
- **Progress bar**: Shows chunk (0–7s) and total (0–35s) recording progress

## ConversationView Booking Icon

The composer bar now has a golden calendar icon (between Add and Mic):
- Opens `MaintenanceBookingModal` for صيانة/تركيب appointment booking

## Zustand Hydration

The main `appStore` persists to `alghazaly-app-storage-v3` in localStorage. The `onRehydrateStorage` callback sets `_hasHydrated = true` when storage loads (or when storage is empty on first visit). `_layout.tsx` waits for hydration + 500ms minimum splash before showing the app.
