---
name: hexagonal-ddd-coach
description: Practical Hexagonal Architecture and DDD coaching workflow for classifying feature changes, choosing between Value Objects, Policies, Aggregate splits, and Use Case changes, and planning incremental implementation without duplicating existing logic. Trigger when a user asks to apply clean architecture, hexagonal architecture, DDD, domain boundaries, aggregate design, policy extraction, ports/adapters, or feature evolution strategy.
---

# Hexagonal DDD Coach

Use this skill to guide new feature development and existing feature evolution while minimizing duplication and preserving compatibility.

## Core Rules

- Keep business rules in Domain and Use Case code.
- Isolate technical details in Adapters, including DB, MQ, gRPC, HTTP, third-party APIs, and framework code.
- Preserve inward dependency direction: Adapter -> Port -> UseCase/Domain.
- Prefer incremental evolution over premature aggregate splitting.
- Inventory existing logic before adding new paths.
- Call out trade-offs and assumptions explicitly.

## Workflow

Always produce output in this order.

### 1. Change Classification

Classify the requested change as Small, Medium, or Large.

Use these criteria:

- Are invariant differences minor?
- Are state transitions still shared?
- Is the lifecycle still the same?
- Can API/event contracts remain compatible?

### 2. Recommended Strategy

Choose strategy based on classification:

- Small: extend with Value Objects and conditional validation.
- Medium: introduce Policy/Strategy separation, such as `ValidationPolicy`, `PricingPolicy`, or `EligibilityPolicy`.
- Large: split Aggregate and Use Cases, such as `OnlineOrder` vs `InPersonOrder`.

Explain why in 1-3 concise lines.

### 3. Hexagonal Implementation Template

Use this sequence:

1. Define use case: input, output, success, failure.
2. Define domain rules: Entity, Value Object, Domain Service.
3. Define Input Ports.
4. Define Output Ports for DB, MQ, and external APIs.
5. Wire Application Service orchestration.
6. Implement Adapters: Controller, Listener, Repository, Publisher.
7. Test in this order: Domain -> Use Case -> Adapter integration.

### 4. Anti-Duplication Rules For Feature Updates

- Inventory existing logic before adding new paths.
- If branching grows, extract policies instead of adding nested conditionals.
- If state transitions diverge, move to aggregate split.
- If compatibility breaks, propose API/event versioning.
- Include a phased deprecation plan for old flows.

## Output Format

Use this exact structure:

```markdown
## A. Classification Result
Small/Medium/Large + reason.

## B. Recommended Architecture Changes
- ...

## C. Minimal Implementation Sequence
1. ...

## D. Test Plan
Shared behavior:
- ...

Channel-specific or variant-specific behavior:
- ...

## E. Risks And Migration Plan
- Compatibility:
- Data migration:
- Rollback:
- Deprecation:
```

## Decision Guidance

- Prefer a Value Object when the change mainly tightens representation, validation, or formatting.
- Prefer a Policy when behavior varies but the aggregate lifecycle and state transitions remain shared.
- Prefer a Domain Service when rules span multiple entities or external domain facts but do not belong naturally to one entity.
- Prefer an Aggregate split when identity, lifecycle, invariants, or state transitions diverge materially.
- Prefer Use Case split when orchestration, permissions, side effects, or success/failure contracts diverge.
- Avoid new abstractions for a single simple branch unless the branch is expected to grow or already obscures the core flow.
