# Site Replay

Session replay tool for the privacy-first web. Record user interactions, replay them like video. Self-hosted on Cloudflare.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Build Recorder

```bash
npm run build:recorder
```

### 3. Start Development

```bash
npm run dev
```

This starts the worker on `http://127.0.0.1:8787`.

### 4. Start Dashboard

In a separate terminal:

```bash
cd dashboard
npm run dev
```

Dashboard runs on `http://localhost:5173`.

### 5. Add Recorder to Your Site

```html
<script
  src="http://127.0.0.1:8787/r.js"
  data-host="127.0.0.1:8787"
  async
></script>
```

---

## Project Structure

```
site-replay/
├── worker/           # CF Worker backend (Hono)
├── recorder/         # r.js recorder script
├── dashboard/        # React SPA
├── test/             # Tests
└── PLAN.md           # Detailed implementation plan
```

---

## Deployment to Cloudflare

### Prerequisites

1. Cloudflare account
2. Wrangler CLI installed (`npm install -g wrangler`)
3. Logged in (`wrangler login`)

### Step 1: Create R2 Bucket

```bash
cd worker
npx wrangler r2 bucket create session-archive
```

### Step 2: Update Configuration

Edit `worker/wrangler.jsonc`:

1. Replace `replay.yourdomain.com/*` with your actual domain
2. Replace `yourdomain.com` with your zone name

### Step 3: Deploy Worker

```bash
cd worker
npm install
npx wrangler deploy
```

### Step 4: Deploy Dashboard

```bash
cd dashboard
npm install
npm run build
npx wrangler pages deploy dist
```

### Step 5: Configure DNS

Add a CNAME record pointing your domain to the Worker:

```
Type  Name    Content             Proxy
CNAME replay  your-worker.dev     Proxied
```

### Step 6: Update Dashboard

Update the API base URL in `dashboard/src/lib/api.ts`:

```typescript
const API_BASE = "https://replay.yourdomain.com";
```

---

## Integration

### Basic HTML

```html
<script
  src="https://replay.yourdomain.com/r.js"
  async
></script>
```

### With Site ID

```html
<script
  src="https://replay.yourdomain.com/r.js"
  data-site-id="yoursite1"
  async
></script>
```

### React

```tsx
useEffect(() => {
  const script = document.createElement("script");
  script.src = "https://replay.yourdomain.com/r.js";
  script.async = true;
  document.body.appendChild(script);
  return () => script.remove();
}, []);
```

### Opt-Out

Users can opt out by setting:

```javascript
window.__SITE_REPLAY_OPT_OUT = true;
```

Set this before the recorder script loads.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/r.js` | Recorder script |
| GET | `/api/health` | Health check |
| POST | `/api/ingest` | Submit events |
| GET | `/api/sessions?siteId=x` | List sessions |
| GET | `/api/session/:id` | Get session with events |
| WS | `/ws/record?sid=x` | Real-time event stream |
| WS | `/ws/watch?sid=x` | Live session viewer |

---

## Tech Stack

- **Backend**: Cloudflare Workers + Hono
- **Database**: Durable Objects (SQLite)
- **Storage**: R2 (session archives)
- **Frontend**: React + Vite + Tailwind CSS
- **Recorder**: Vanilla JavaScript (<2KB gzipped)

---

## License

MIT
