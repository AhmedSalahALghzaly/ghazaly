# Al-Ghazaly Auto Parts Company

## Overview

Arabic-language auto parts e-commerce platform with Expo React Native mobile frontend, Express.js backend with WebSocket, AI chat (OpenAI via Replit AI Integrations), and PostgreSQL database.

## Architecture

- **Monorepo**: pnpm workspaces
- **Mobile app**: Expo React Native (`artifacts/mobile/`)
- **API server**: Express.js with WebSocket (`artifacts/api-server/`)
- **Database**: PostgreSQL with 24 tables (raw `pg` Pool, NOT Drizzle ORM)
- **AI**: OpenAI via Replit AI Integrations proxy (`AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY`)
- **Auth**: Custom bearer token auth with session_token in `sessions` table

## How It Runs

The API server runs INSIDE the Expo workflow via `start-dev.sh` — the API Server workflow is NOT used.
- `start-dev.sh` starts API on port 8080, then Expo on port 18115
- The `EXPO_PUBLIC_DOMAIN` env var is set to `$REPLIT_DEV_DOMAIN`

## Key Commands

- `cd artifacts/api-server && pnpm run build` — rebuild API server
- Restart the `artifacts/mobile: expo` workflow to restart both API and Expo
- `pnpm install` — install all workspace dependencies

## Key Files

- `artifacts/mobile/start-dev.sh` — startup script (API + Expo)
- `artifacts/api-server/src/server-routes.ts` — main Express routes (~5780 lines)
- `artifacts/api-server/src/routes/chat.ts` — chat + AI agent routes
- `artifacts/mobile/src/components/chat/AiAgentTab.tsx` — AI Agent tab component
- `artifacts/mobile/src/components/chat/DirectChatTab.tsx` — DirectChat with per-customer auto-reply toggle
- `artifacts/mobile/src/components/chat/TrashTab.tsx` — Trash with double-confirmation delete
- `artifacts/mobile/src/components/ui/FloatingChatIcon.tsx` — Draggable floating chat icon
- `artifacts/mobile/src/components/ui/FloatingAiAgentIcon.tsx` — Draggable floating AI Agent icon (purple, opens AI chat modal)
- `scripts/schema.sql` — 24-table PostgreSQL schema

## Enhancements Implemented

1. **Floating AI Agent Icon** — Purple sparkle icon with glow effect, draggable, opens AI Agent chat in a full-screen modal. Positioned on left edge to complement the existing blue chat icon on right edge.
2. **Per-Customer DirectChat Auto-Reply Toggle** — Small AI indicator on each customer avatar in the conversation rail. Privileged users can tap to toggle AI auto-reply per conversation. Uses `ai_auto_reply` column on `conversations` table.
3. **Double-Confirmation for Permanent Delete** — TrashTab permanent delete now shows two sequential confirmation dialogs before actually deleting.
4. **AI Chat Refactor** — Removed ElevenLabs (TTS/STT) and Gemini completely. OpenAI (gpt-4o) is the sole AI provider via Replit AI Integrations. AiAgentTab rewritten with: file/image attachment upload via `chatApi.uploadFile`, live conversation toggle, conversation persistence to DB via `setAiConversationId`, customer list for owner/admin (PrivilegedAiTab), and strict data segregation (customers see only own AI conversation, admins see all AI conversations read-only, owner can read+reply).

## Database

24 PostgreSQL tables including: users, products, orders, categories, car_brands, car_models, conversations, messages, knowledge_base, sessions, owners, partners, admins, subscribers, suppliers, distributors, etc.

Tables are created via `scripts/schema.sql` and inline `CREATE TABLE IF NOT EXISTS` in server code.
