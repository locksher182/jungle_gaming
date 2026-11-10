export interface AuthenticatedProvider {
  providerId: string;
  roles: string[];
  issuedAt: Date;
  expiresAt?: Date;
}

export interface IProviderIdentityPort {
  authenticate(tokenOrHeader: string): Promise<AuthenticatedProvider | null>;
  validateProviderScope(providerId: string, requestedGameId?: string): Promise<boolean>;
}
