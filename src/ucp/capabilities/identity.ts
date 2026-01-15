/**
 * UCP Identity Linking Capability Implementation
 *
 * Provides OAuth 2.0 based identity linking for agent authorization.
 */

import * as crypto from 'crypto';
import {
  OAuthConfig,
  TokenResponse,
  IdentityLink
} from '../types.js';

// ============================================================================
// Token Storage Interface
// ============================================================================

export interface TokenStorage {
  storeAuthCode(code: string, data: AuthCodeData): Promise<void>;
  getAuthCode(code: string): Promise<AuthCodeData | null>;
  deleteAuthCode(code: string): Promise<void>;

  storeToken(token: string, data: TokenData): Promise<void>;
  getToken(token: string): Promise<TokenData | null>;
  deleteToken(token: string): Promise<void>;

  storeRefreshToken(token: string, data: RefreshTokenData): Promise<void>;
  getRefreshToken(token: string): Promise<RefreshTokenData | null>;
  deleteRefreshToken(token: string): Promise<void>;

  storeIdentityLink(link: IdentityLink): Promise<void>;
  getIdentityLink(agentId: string): Promise<IdentityLink | null>;
  deleteIdentityLink(agentId: string): Promise<void>;
}

interface AuthCodeData {
  agentId: string;
  scopes: string[];
  redirectUri: string;
  expiresAt: string;
  state?: string;
}

interface TokenData {
  agentId: string;
  scopes: string[];
  expiresAt: string;
}

interface RefreshTokenData {
  agentId: string;
  scopes: string[];
  accessToken: string;
}

/**
 * In-memory token storage (for development/testing)
 */
export class MemoryTokenStorage implements TokenStorage {
  private authCodes = new Map<string, AuthCodeData>();
  private tokens = new Map<string, TokenData>();
  private refreshTokens = new Map<string, RefreshTokenData>();
  private identityLinks = new Map<string, IdentityLink>();

  async storeAuthCode(code: string, data: AuthCodeData): Promise<void> {
    this.authCodes.set(code, data);
  }

  async getAuthCode(code: string): Promise<AuthCodeData | null> {
    const data = this.authCodes.get(code);
    if (!data) return null;

    if (new Date(data.expiresAt) < new Date()) {
      this.authCodes.delete(code);
      return null;
    }

    return data;
  }

  async deleteAuthCode(code: string): Promise<void> {
    this.authCodes.delete(code);
  }

  async storeToken(token: string, data: TokenData): Promise<void> {
    this.tokens.set(token, data);
  }

  async getToken(token: string): Promise<TokenData | null> {
    const data = this.tokens.get(token);
    if (!data) return null;

    if (new Date(data.expiresAt) < new Date()) {
      this.tokens.delete(token);
      return null;
    }

    return data;
  }

  async deleteToken(token: string): Promise<void> {
    this.tokens.delete(token);
  }

  async storeRefreshToken(token: string, data: RefreshTokenData): Promise<void> {
    this.refreshTokens.set(token, data);
  }

  async getRefreshToken(token: string): Promise<RefreshTokenData | null> {
    return this.refreshTokens.get(token) || null;
  }

  async deleteRefreshToken(token: string): Promise<void> {
    this.refreshTokens.delete(token);
  }

  async storeIdentityLink(link: IdentityLink): Promise<void> {
    this.identityLinks.set(link.agentId, link);
  }

  async getIdentityLink(agentId: string): Promise<IdentityLink | null> {
    return this.identityLinks.get(agentId) || null;
  }

  async deleteIdentityLink(agentId: string): Promise<void> {
    this.identityLinks.delete(agentId);
  }
}

// ============================================================================
// Identity Service
// ============================================================================

export interface IdentityServiceConfig {
  baseUrl: string;
  allowedScopes: string[];
  authCodeTTLSeconds: number;
  accessTokenTTLSeconds: number;
  refreshTokenTTLDays: number;
}

const DEFAULT_CONFIG: IdentityServiceConfig = {
  baseUrl: '',
  allowedScopes: ['checkout.read', 'checkout.write', 'order.read', 'order.write'],
  authCodeTTLSeconds: 600,      // 10 minutes
  accessTokenTTLSeconds: 3600,  // 1 hour
  refreshTokenTTLDays: 30
};

export class IdentityService {
  private storage: TokenStorage;
  private config: IdentityServiceConfig;

  constructor(config?: Partial<IdentityServiceConfig>, storage?: TokenStorage) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.storage = storage || new MemoryTokenStorage();
  }

  // --------------------------------------------------------------------------
  // OAuth Configuration
  // --------------------------------------------------------------------------

  /**
   * Get OAuth configuration for discovery
   */
  async getOAuthConfig(): Promise<OAuthConfig> {
    return {
      authorizationEndpoint: `${this.config.baseUrl}/oauth/authorize`,
      tokenEndpoint: `${this.config.baseUrl}/oauth/token`,
      revocationEndpoint: `${this.config.baseUrl}/oauth/revoke`,
      scopes: this.config.allowedScopes
    };
  }

  // --------------------------------------------------------------------------
  // Authorization Flow
  // --------------------------------------------------------------------------

  /**
   * Generate authorization URL for agent
   */
  async requestAuthorization(params: {
    agentId: string;
    scopes: string[];
    redirectUri: string;
    state?: string;
  }): Promise<{ authorizationUrl: string }> {
    // Validate scopes
    const invalidScopes = params.scopes.filter(s => !this.config.allowedScopes.includes(s));
    if (invalidScopes.length > 0) {
      throw new Error(`Invalid scopes: ${invalidScopes.join(', ')}`);
    }

    // Generate auth code
    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + this.config.authCodeTTLSeconds * 1000);

    await this.storage.storeAuthCode(code, {
      agentId: params.agentId,
      scopes: params.scopes,
      redirectUri: params.redirectUri,
      expiresAt: expiresAt.toISOString(),
      state: params.state
    });

    // Build authorization URL
    const url = new URL(`${this.config.baseUrl}/oauth/authorize`);
    url.searchParams.set('code', code);
    url.searchParams.set('agent_id', params.agentId);
    url.searchParams.set('scope', params.scopes.join(' '));
    url.searchParams.set('redirect_uri', params.redirectUri);
    if (params.state) {
      url.searchParams.set('state', params.state);
    }

    return { authorizationUrl: url.toString() };
  }

  /**
   * Handle user approval (called after user consents)
   */
  async approveAuthorization(code: string, userId: string): Promise<{
    redirectUrl: string;
  }> {
    const authData = await this.storage.getAuthCode(code);
    if (!authData) {
      throw new Error('Invalid or expired authorization code');
    }

    // Create identity link
    const link: IdentityLink = {
      id: `link_${crypto.randomUUID()}`,
      agentId: authData.agentId,
      userId,
      scopes: authData.scopes,
      createdAt: new Date().toISOString()
    };

    await this.storage.storeIdentityLink(link);

    // Build redirect URL with code
    const redirectUrl = new URL(authData.redirectUri);
    redirectUrl.searchParams.set('code', code);
    if (authData.state) {
      redirectUrl.searchParams.set('state', authData.state);
    }

    return { redirectUrl: redirectUrl.toString() };
  }

  // --------------------------------------------------------------------------
  // Token Exchange
  // --------------------------------------------------------------------------

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCode(params: {
    code: string;
    redirectUri: string;
  }): Promise<TokenResponse> {
    const authData = await this.storage.getAuthCode(params.code);

    if (!authData) {
      throw new Error('Invalid or expired authorization code');
    }

    if (authData.redirectUri !== params.redirectUri) {
      throw new Error('Redirect URI mismatch');
    }

    // Delete used auth code
    await this.storage.deleteAuthCode(params.code);

    // Generate tokens
    const accessToken = this.generateToken();
    const refreshToken = this.generateToken();

    const accessTokenExpires = new Date(Date.now() + this.config.accessTokenTTLSeconds * 1000);

    // Store tokens
    await this.storage.storeToken(accessToken, {
      agentId: authData.agentId,
      scopes: authData.scopes,
      expiresAt: accessTokenExpires.toISOString()
    });

    await this.storage.storeRefreshToken(refreshToken, {
      agentId: authData.agentId,
      scopes: authData.scopes,
      accessToken
    });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTokenTTLSeconds,
      refreshToken,
      scope: authData.scopes.join(' ')
    };
  }

  /**
   * Refresh access token
   */
  async refreshToken(refreshToken: string): Promise<TokenResponse> {
    const refreshData = await this.storage.getRefreshToken(refreshToken);

    if (!refreshData) {
      throw new Error('Invalid refresh token');
    }

    // Delete old access token
    await this.storage.deleteToken(refreshData.accessToken);

    // Generate new access token
    const newAccessToken = this.generateToken();
    const accessTokenExpires = new Date(Date.now() + this.config.accessTokenTTLSeconds * 1000);

    await this.storage.storeToken(newAccessToken, {
      agentId: refreshData.agentId,
      scopes: refreshData.scopes,
      expiresAt: accessTokenExpires.toISOString()
    });

    // Update refresh token reference
    await this.storage.storeRefreshToken(refreshToken, {
      ...refreshData,
      accessToken: newAccessToken
    });

    return {
      accessToken: newAccessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.accessTokenTTLSeconds,
      scope: refreshData.scopes.join(' ')
    };
  }

  // --------------------------------------------------------------------------
  // Token Validation
  // --------------------------------------------------------------------------

  /**
   * Validate access token
   */
  async validateToken(token: string): Promise<{
    valid: boolean;
    agentId?: string;
    scopes?: string[];
  }> {
    const tokenData = await this.storage.getToken(token);

    if (!tokenData) {
      return { valid: false };
    }

    return {
      valid: true,
      agentId: tokenData.agentId,
      scopes: tokenData.scopes
    };
  }

  /**
   * Check if token has required scope
   */
  async hasScope(token: string, requiredScope: string): Promise<boolean> {
    const validation = await this.validateToken(token);
    return validation.valid && (validation.scopes?.includes(requiredScope) || false);
  }

  // --------------------------------------------------------------------------
  // Revocation
  // --------------------------------------------------------------------------

  /**
   * Revoke token
   */
  async revokeToken(token: string): Promise<void> {
    // Try to find and delete as access token
    const tokenData = await this.storage.getToken(token);
    if (tokenData) {
      await this.storage.deleteToken(token);
      return;
    }

    // Try to find and delete as refresh token
    const refreshData = await this.storage.getRefreshToken(token);
    if (refreshData) {
      await this.storage.deleteToken(refreshData.accessToken);
      await this.storage.deleteRefreshToken(token);
    }
  }

  /**
   * Revoke all tokens for an agent
   */
  async revokeAgent(agentId: string): Promise<void> {
    await this.storage.deleteIdentityLink(agentId);
  }

  // --------------------------------------------------------------------------
  // Identity Links
  // --------------------------------------------------------------------------

  /**
   * Get identity link for agent
   */
  async getIdentityLink(agentId: string): Promise<IdentityLink | null> {
    return this.storage.getIdentityLink(agentId);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  private generateCode(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private generateToken(): string {
    return crypto.randomBytes(48).toString('base64url');
  }
}
