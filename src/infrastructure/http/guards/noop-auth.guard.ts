import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type {
  IProviderIdentityPort,
  AuthenticatedProvider,
} from "../../../application/ports/provider-identity.port";

/**
 * Extension point for external Identity Provider (IdP) authentication (e.g., Keycloak / Zitadel / API Gateway).
 * Per section 2 of specification:
 * - Authentication is decoupled from core financial processing to prevent artisanal credential tables.
 * - This NoOp guard serves as the formal extension point: production environments replace this
 *   with an OIDC / JWT validator injecting the verified provider context.
 */
@Injectable()
export class NoOpAuthGuard implements CanActivate, IProviderIdentityPort {
  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    // In production, extracts and verifies Bearer token / mTLS header from IdP/Gateway:
    const authHeader = request.headers["authorization"] || request.headers["x-provider-token"];
    const authenticated = await this.authenticate(authHeader);

    if (authenticated) {
      request.provider = authenticated;
    }
    return true; // No-op allows passage while keeping extension point explicit
  }

  public async authenticate(tokenOrHeader: string): Promise<AuthenticatedProvider | null> {
    if (!tokenOrHeader) {
      return {
        providerId: "anonymous-or-perimeter-authenticated",
        roles: ["provider"],
        issuedAt: new Date(),
      };
    }
    return {
      providerId: "external-idp-provider",
      roles: ["provider"],
      issuedAt: new Date(),
    };
  }

  public async validateProviderScope(
    _providerId: string,
    _requestedGameId?: string
  ): Promise<boolean> {
    return true;
  }
}
