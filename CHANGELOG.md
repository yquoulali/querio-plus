# Changelog

All notable changes to Querio+ will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-10-26

### Added

- **Core Features**
  - GraphQL request detection (GET, POST, form-urlencoded, batched arrays)
  - Batch splitting with identity-first correlation (fixes reorder bug from original Querio)
  - HTTP request capture via `chrome.devtools.network.onRequestFinished`
  - Request de-duplication (handles Chrome's double-delivery)

- **UI**
  - Filterable request list (name, URL, status, type, errors-only)
  - Full-text body search across cached responses
  - Tabbed detail view (General, Headers, Query/Variables, Response)
  - Collapsible JSON tree with syntax highlighting
  - GraphQL query pretty-printing
  - Resizable columns with persistent widths
  - Resizable list/detail split pane
  - Dark/Light/System theme support
  - Keyboard navigation (↑↓ to browse, Enter to select)

- **Actions**
  - Copy as cURL
  - Copy GraphQL operation
  - Copy response body
  - Compare two requests (diff response, query, variables, headers)
  - Export/Import session (HAR-like JSON format)
  - Clear requests / Preserve log toggle

- **Robustness**
  - Bounded store (5000 max entries)
  - JSON tree depth/width limits (prevents freeze on huge payloads)
  - Import validation and coercion
  - Error boundary for crash recovery

### Attribution

Querio+ is an improved reimplementation informed by [Querio](https://github.com/enkot/querio) 
by enkot (MIT License). Thanks to the original author for the idea and reference.
