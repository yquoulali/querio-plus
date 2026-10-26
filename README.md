# Querio+

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)

A Chrome DevTools extension for inspecting **GraphQL** and HTTP requests. Features filtering,
search, JSON tree view, request comparison, and session export.

![Querio+ Screenshot](docs/screenshot.png)

## Features

- 🔍 **GraphQL Detection** — Automatically detects GraphQL operations (queries, mutations, subscriptions)
- 📦 **Batch Splitting** — Splits batched GraphQL arrays into individual operations
- 🎯 **Smart Filtering** — Filter by name, URL, status, type, or errors only
- 🔎 **Full-text Search** — Search across request and response bodies
- 🌳 **JSON Tree View** — Collapsible, syntax-highlighted response viewer
- 📋 **Copy Actions** — Copy as cURL, operation, or response
- ⚖️ **Request Diff** — Compare responses, queries, variables, and headers between requests
- 💾 **Session Export** — Export/import sessions as JSON
- 🎨 **Themes** — Light, dark, and system theme support
- ⌨️ **Keyboard Navigation** — Browse requests with arrow keys

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/yquoulali/querio-plus.git
cd querio-plus

# Install dependencies
pnpm install

# Build
pnpm build
```

Then load in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `dist/` folder
4. Open DevTools (F12) → find the **Querio+** tab

## Development

```bash
pnpm dev         # Watch mode for development
pnpm build       # Production build
pnpm test        # Run tests
pnpm typecheck   # TypeScript check
```

## How It Works

Querio+ captures network traffic through the Chrome DevTools API (`chrome.devtools.network`).
It detects GraphQL operations by parsing request bodies and validating with the `graphql` library.

Key features:
- **No background scripts or content scripts** — minimal permissions
- **Lazy body loading** — responses are fetched on demand
- **Request de-duplication** — handles Chrome's double-delivery quirk
- **Bounded memory** — limits prevent freezing on large sessions

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical design.

## Comparison with Querio

Querio+ is an improved reimplementation inspired by [Querio](https://github.com/enkot/querio).
Key improvements:

| Feature | Querio | Querio+ |
|---------|--------|---------|
| Batch correlation | Positional only | Identity-first (fixes reorder bugs) |
| Filtering | ❌ | ✅ Name, URL, status, type, errors |
| Body search | ❌ | ✅ Full-text search |
| Request diff | ❌ | ✅ Compare response/query/variables/headers |
| Session export | ❌ | ✅ HAR-like JSON |
| Resizable columns | ❌ | ✅ Persistent widths |
| De-duplication | ❌ | ✅ Handles Chrome double-delivery |
| Memory bounds | — | ✅ No freeze on large payloads |
| Multipart uploads | ❌ | ✅ GraphQL file upload detection |
| Incognito mode | ❌ | ✅ Works in private browsing |

## Roadmap / Known Limitations

### WebSocket Subscriptions

Currently, Querio+ captures HTTP requests only via `chrome.devtools.network`. GraphQL subscriptions
that run over WebSocket (e.g., `graphql-ws` or `subscriptions-transport-ws`) are not captured.

This is a significant feature that would require:
- Listening to `chrome.debugger` or `chrome.webRequest` for WebSocket frames
- Parsing the GraphQL-over-WebSocket protocol messages
- Correlating subscription start/data/complete frames

Contributions welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — Based on [Querio](https://github.com/enkot/querio) by enkot (MIT).

## Acknowledgments

Thanks to [enkot](https://github.com/enkot) for the original [Querio](https://github.com/enkot/querio)
extension that inspired this project.
