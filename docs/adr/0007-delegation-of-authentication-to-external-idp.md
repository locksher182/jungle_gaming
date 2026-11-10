# 7. Delegation of Authentication to External Identity Provider (IdP)

Date: 2026-11-10  
Status: Accepted

## Context

The core domain of this microservice is high-throughput wagering transaction processing, ledger accounting, and distributed concurrency control. In modern microservice architectures, user and provider identity management is decoupled from internal domain processors and handled by edge gateways or specialized Identity Providers (IdP). Implementing custom user authentication, password hashing, and token issuance inside this service would introduce unnecessary coupling and maintenance overhead outside the bounded context.

## Decision

Delegate caller authentication to the perimeter layer and external Identity Providers:

1. Health and operational endpoints (`/health/live`, `/health/ready`, `/metrics`) remain accessible for orchestration and monitoring systems without credentials.
2. In production, upstream API gateways or an enterprise IdP (e.g., Keycloak, Zitadel) authenticate callers, validate tokens, and pass trusted identity context to downstream services.
3. The codebase establishes formal extension points via `IProviderIdentityPort` (`src/application/ports/provider-identity.port.ts`) and `NoOpAuthGuard` (`src/infrastructure/http/guards/noop-auth.guard.ts`) applied across all wagering and wallet controllers, ready for drop-in OIDC/JWT verification.
4. The internal service focuses strictly on business transaction validation, player balance integrity, and idempotency.

## Alternatives Considered

- **Local User Table with `bcrypt` and Custom `/auth/login` Endpoints:** Rejected as an anti-pattern for core financial engines. In-service credential management increases attack surface and departs from the microservice bounded context.

## Consequences

- **Positive:** Clear separation of concerns; no duplicate identity management or credentials stored in the transactional database.
- **Operational:** Production deployments require deployment behind an API Gateway or private network perimeter with mutual TLS / token validation.
