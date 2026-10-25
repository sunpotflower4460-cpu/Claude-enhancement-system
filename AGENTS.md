# Repository instructions for Codex and coding agents

This repository is a dedicated, immediately usable **Claude Code** development harness. It is independent of Development-Garden, KUROUD, Starter, dots, and any separate long-horizon unified development infrastructure.

## Read first

Before changing code, read in order:
1. `docs/00-requirements.md`
2. `docs/01-architecture.md`
3. `docs/02-execution-protocol.md`
4. `docs/03-quality-contract.md`
5. `docs/04-research-sources.md`
6. `docs/05-implementation-plan.md`
7. `docs/06-usage.md`

Preserve the intent, requirements and planned verification conditions; do not silently narrow the mission to make a demo pass. When updating a design decision, record the reason and affected checks. Keep user-authored project requirements distinct from agent-generated plans and assumptions.

## Engineering priorities

1. Verify Claude Code capabilities against the live runtime before depending on them. Official documentation supports `/goal`, model-pinned subagents and dynamic workflows, but cloud plugin loading is restricted.
2. Focus first on **cloud two-repository selection** and a single initial command. Local CLI/plugin use is secondary and shares the same source components.
3. Keep the harness repository reusable and mostly read-only during application development. Store project-specific state in the target repository.
4. Implement a runnable vertical slice first; add Opus milestone gates, recovery, domain profiles and packaging incrementally.
5. Use programmatic gates plus independent read-only reviewers. A text claim of success is not proof. Inability to execute a check is `UNVERIFIED`, not `PASS`.
6. Prevent concurrent writers on the same worktree. Keep work resumable and protect unrelated files/configuration.
7. Use clear, small dependencies. Do not require an extra paid hosted service for the harness.
8. For each completed phase, run its described tests and record actual output. Report untested behavior explicitly.

## Scope and workflow

- Do not create Codex/MiniMax/Gemini/KUROUD adapters in v1.
- Do not add a complex control dashboard, external orchestration server, credential broker or database unless a validated P0 blocker requires it.
- Do not mutate unrelated repositories; prototype using isolated test fixtures.
- Preserve repository history. Prefer scoped commits / PRs for implementation work; do not silently merge or delete.
- Do not claim that a code-only test proves visual quality or gameplay.

## Finish line

V1 is accepted only when `docs/05-implementation-plan.md` acceptance matrix is exercised with evidence, including cloud bootstrap, true model routing, faulty-code rejection, resume behavior, and verification without a false PASS.
