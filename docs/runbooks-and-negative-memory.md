# Runbooks & Negative Memory

## Runbooks (Success Patterns)

Runbooks capture learned success patterns from tool execution history. When a tool succeeds N consecutive times with similar input, ClawCore auto-infers a runbook.

### Lifecycle
1. **Observe**: Tool attempts are recorded with outcomes
2. **Infer**: `inferRunbookFromAttempts()` detects success streaks (default: 3 consecutive)
3. **Store**: Pattern stored with success/failure counts and confidence
4. **Link**: Attempts are linked as evidence via `runbook_evidence` table
5. **Surface**: Context compiler includes runbooks based on ROI scoring
6. **Decay**: Runbooks with high failure rates get demoted; unused ones go stale

### Runbook Evidence Chain
Each runbook links back to the specific attempts that support it:
```
Runbook → runbook_evidence → attempt
```

## Anti-Runbooks (Failure Patterns)

Anti-runbooks capture known failure patterns to prevent repeating mistakes.

### Properties
- **failure_pattern**: Description of what went wrong
- **failure_count**: Increments with each new observation
- **confidence**: Increases by +0.1 per observation (capped at 1.0)
- **status**: active, stale, or under_review

### Context Priority
Anti-runbooks receive the **highest context priority** (score 0.95) — preventing known failures is more valuable than surfacing known successes.

## Decay Rules

### Anti-Runbook Decay
- If no new failure evidence in 90 days: confidence *= 0.8
- If confidence drops below 0.2: status = 'under_review'
- Decay is **lazy** — applied before queries, not on schedule

### Runbook Decay
- If failure_rate > 0.5: confidence *= 0.5 (demoted)
- If no usage in 180 days: status = 'stale'
- Stale runbooks are excluded from context compilation

### Decay Application Points
Decay runs lazily in these query paths:
- `compileContextCapsules()` — before gathering evidence
- `cc_antirunbooks` tool — before listing anti-runbooks
- `cc_attempts` tool — before showing outcomes
- `cc_runbooks` tool — before listing runbooks
