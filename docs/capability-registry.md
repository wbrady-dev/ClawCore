# Capability Registry

## Overview

The capability registry tracks known tools, services, and systems with their current operational status. This enables agents to make informed planning decisions.

## Capability Properties

| Field | Description |
|-------|-------------|
| capability_type | Category: tool, service, api, database, etc. |
| capability_key | Unique identifier within type |
| display_name | Human-readable name |
| status | available, unavailable, degraded, unknown |
| summary | Description of the capability |
| metadata_json | Structured metadata |
| last_checked_at | When status was last verified |

## Status Values

- **available**: Fully operational
- **degraded**: Working but with reduced performance or reliability
- **unavailable**: Not accessible (down, removed, or errored)
- **unknown**: Status not yet determined

## Usage

```typescript
// Record a capability
upsertCapability(db, {
  scopeId: 1,
  capabilityType: "service",
  capabilityKey: "redis",
  displayName: "Redis Cache",
  status: "available",
  summary: "In-memory cache on port 6379",
});

// Query capabilities
const tools = getCapabilities(db, 1, { type: "tool", status: "available" });
```

## Context Compilation

Capabilities are not currently surfaced by the context compiler (they're informational, not action-driving). They can be queried programmatically via `getCapabilities()` or viewed through the `cc_diagnostics` tool.

## Staleness

No automatic staleness detection. Capabilities retain their last-known status until explicitly updated. The `last_checked_at` field helps identify stale entries.
