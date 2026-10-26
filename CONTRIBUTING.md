# Contributing to Querio+

Thanks for your interest in contributing! This document outlines how to get started.

## Development Setup

1. **Prerequisites**
   - Node.js 24+ (see `.nvmrc`)
   - pnpm (`npm install -g pnpm`)

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Development build** (with hot reload)
   ```bash
   pnpm dev
   ```

4. **Load in Chrome**
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked" → select the `dist/` folder
   - Open DevTools on any page → find the "Querio+" panel

## Code Quality

Before submitting a PR, ensure:

```bash
pnpm typecheck   # TypeScript strict mode
pnpm test        # All tests pass
pnpm build       # Production build succeeds
```

## Project Structure

```
src/
  capture/       # Network capture, GraphQL detection, batch splitting
  components/    # React UI components
  features/      # Filter, search, copy, session, diff
  format/        # JSON/GraphQL formatting
  panel/         # Main app entry point
  settings.ts    # Persistent settings (chrome.storage)
  types.ts       # TypeScript interfaces
test/            # Vitest unit tests
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full technical design.

## Submitting Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`pnpm test`)
5. Commit with a descriptive message
6. Push to your fork
7. Open a Pull Request

## Code Style

- TypeScript with `strict: true`
- React functional components with hooks
- CSS variables for theming (see `src/styles/index.css`)
- Keep the two pure cores (`graphql-detect.ts`, `batch-split.ts`) free of side effects

## Reporting Issues

When reporting bugs, please include:
- Browser version
- Steps to reproduce
- Expected vs actual behavior
- Console errors (if any)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
