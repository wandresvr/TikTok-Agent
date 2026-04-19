# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Agent

```bash
node index.js                        # Start the TikTok Live Agent
node kill.js                         # Terminate a running index.js process
node scripts/login.js                # Save TikTok session to session.json (first-time setup)
npm run test:browser-sender          # Test Playwright message sending
```

Ollama must be running locally at `http://localhost:11434` before starting the agent. The app auto-detects the available model on startup.

## Architecture

The agent listens to a TikTok Live chat, detects song requests, ranks them, and responds using a local LLM.

**Data flow:**

```
TikTok Live Chat
  → listener/tiktokListener.js   (WebSocket via tiktok-live-connector, auto-reconnects)
  → processor/router.js          (orchestrates classification and response dispatch)
      ├── processor/rules.js     (fast keyword pre-filter: 'pon', 'play', 'song', '-')
      ├── processor/normalizer.js (cleans song names before storing)
      ├── llm/responseGenerator.js (Ollama classify+generate; rate-limited, queued)
      └── state/liveState.js     (in-memory Map: song → { count, users: Set })
  → responder/browserSender.js   (Playwright screen scraping) OR Euler Stream API
  → responder/notifier.js        (logs top 5 songs to console every 30s)
```

**Two message-sending backends** are supported, toggled by `USE_BROWSER_SENDER` in `.env`:
- `true` (default): Playwright scrapes the TikTok web app (free, requires saved browser session)
- `false`: Euler Stream REST API (requires `EULER_API_KEY`)

**LLM integration** (`llm/responseGenerator.js`) has two functions:
- `analyze(text)` — classifies a message as `request | normal | vote` and extracts song name (JSON mode)
- `generateResponse(...)` — generates a chat reply with the configured system prompt

Requests go through a 5-message queue with a 5-second cooldown between sends and a 2-second minimum between Ollama calls.

## Key Environment Variables (`.env`)

| Variable | Purpose |
|---|---|
| `TIKTOK_USERNAME` | Live stream username to connect to (no @) |
| `MODERATOR_NAME` | Bot's own display name (used to skip self-messages) |
| `USE_BROWSER_SENDER` | `true` = Playwright, `false` = Euler Stream API |
| `BROWSER_USER_DATA_DIR` | Persistent Playwright browser profile path |
| `BROWSER_HEADLESS` | `false` to show browser window during debug |
| `EULER_API_KEY` | Required only when `USE_BROWSER_SENDER=false` |
| `OLLAMA_MODEL` | Override auto-detected model (e.g. `qwen3:1.7b`) |
| `OLLAMA_RESPONSE_TIMEOUT_MS` | Timeout per Ollama request (default 120000) |
| `OLLAMA_PERIODIC_INTERVAL_MS` | Interval for periodic bot messages; `0` = disabled |
| `ENABLE_AUTO_SEND` | `false` = listen-only mode (no messages sent) |
| `SAVE_RESPONSES_CSV` | `true` = append all responses to `RESPONSES_CSV_PATH` |

Copy `.env.example` to `.env` to configure.

## Language

The bot operates in **Spanish**. The LLM system prompt and all generated chat responses are in Spanish. Song-request keywords in `processor/rules.js` include Spanish terms (`pon`).
