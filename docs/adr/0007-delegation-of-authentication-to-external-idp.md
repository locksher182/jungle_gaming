# 7. Delegation of Authentication to External Identity Provider (IdP)

Date: 2026-11-10  
Status: Accepted

## Context

The core domain of this microservice is high-throughput wagering transaction processing, ledger accounting, and distributed concurrency control. In modern microservice architectures, user and provider identity management is decoupled from internal domain processors and handled by edge gateways or specialized Identity Providers (IdP). Implementing custom user authentication, password hashing, and token issuance inside this service would introduce unnecessary coupling and maintenance overhead outside the bounded context.

## Decision

Delegate caller authentication to the perimeter layer and external Identity Providers:

1. Health and operational endpoints (`/health/live`, `/health/ready`, `/metrics`) remain accessible for orchestration and monitoring systems.
2. In production, upstream API gateways (e.g., Kong, Envoy, AWS API Gateway) or an enterprise IdP (e.g., Keycloak, Cognito) authenticate callers, validate tokens, and pass trusted identity context to downstream services.
3. The internal service focuses strictly on business transaction validation, player balance integrity, and idempotency.

## Alternatives Considered

- **Local User Table with `bcrypt` and Custom `/auth/login` Endpoints:** Rejected as an anti-pattern for core financial engines. In-service credential management increases attack surface and departs from the microservice bounded context.

## Consequences

- **Positive:** Clear separation of concerns; no duplicate identity management or credentials stored in the transactional database.
- **Operational:** Production deployments require deployment behind an API Gateway or private network perimeter with mutual TLS / token validation.
