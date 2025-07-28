/**
 * @fileoverview JIRA OAuth 2.0 authentication service
 * @lastmodified 2025-07-27T23:35:00Z
 * 
 * Features: OAuth 2.0 flow, token management, refresh handling, instance discovery
 * Main APIs: Authorization URL generation, token exchange, refresh tokens, instance access
 * Constraints: Supports JIRA Cloud and Server/Data Center, handles multiple instances
 * Patterns: OAuth 2.0 with PKCE, secure token storage, automatic refresh
 */

import crypto from 'crypto';
import axios, { AxiosResponse } from 'axios';
import { config } from '@/config/environment';
import { cache } from '@/config/redis';
import { logger, logExternalRequest } from '@/utils/logger';
import { ExternalServiceError, AuthenticationError } from '@/middleware/error-handler';
import { JiraOAuthConfig, JiraOAuthTokens, JiraInstance } from '@/types/jira';

interface OAuthState {
  organizationId: string;
  userId: string;
  redirectUrl?: string;
  codeVerifier: string;
  createdAt: number;
}

interface JiraAccessibleResources {
  id: string;
  name: string;
  url: string;
  scopes: string[];
  avatarUrl: string;
}

export class JiraOAuthService {
  private readonly config: JiraOAuthConfig;
  private readonly baseUrl = 'https://auth.atlassian.com';
  private readonly apiUrl = 'https://api.atlassian.com';

  constructor() {
    this.config = {
      clientId: config.integrations.jira.clientId,
      clientSecret: config.integrations.jira.clientSecret,
      redirectUri: config.integrations.jira.redirectUri,
      scopes: config.integrations.jira.scopes,
      authUrl: `${this.baseUrl}/authorize`,
      tokenUrl: `${this.baseUrl}/oauth/token`,
    };
  }

  /**
   * Generate authorization URL with PKCE
   */
  async generateAuthUrl(
    organizationId: string,
    userId: string,
    redirectUrl?: string
  ): Promise<{ authUrl: string; state: string }> {
    try {
      // Generate PKCE parameters
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      const state = this.generateState();

      // Store OAuth state with expiration (10 minutes)
      const oauthState: OAuthState = {
        organizationId,
        userId,
        redirectUrl,
        codeVerifier,
        createdAt: Date.now(),
      };

      await cache.set(`oauth_state:${state}`, JSON.stringify(oauthState), 600); // 10 minutes

      // Build authorization URL
      const params = new URLSearchParams({
        audience: 'api.atlassian.com',
        client_id: this.config.clientId,
        scope: this.config.scopes.join(' '),
        redirect_uri: this.config.redirectUri,
        state,
        response_type: 'code',
        prompt: 'consent',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      });

      const authUrl = `${this.config.authUrl}?${params.toString()}`;

      logger.info('Generated JIRA OAuth authorization URL', {
        organizationId,
        userId,
        state,
        scopes: this.config.scopes,
      });

      return { authUrl, state };
    } catch (error) {
      logger.error('Failed to generate JIRA OAuth URL:', error);
      throw new ExternalServiceError('JIRA OAuth', error as Error);
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string, state: string): Promise<{
    tokens: JiraOAuthTokens;
    organizationId: string;
    userId: string;
    redirectUrl?: string;
  }> {
    try {
      // Retrieve and validate OAuth state
      const stateData = await cache.get(`oauth_state:${state}`);
      if (!stateData) {
        throw new AuthenticationError('Invalid or expired OAuth state');
      }

      const oauthState: OAuthState = JSON.parse(stateData);
      
      // Check if state is expired (10 minutes)
      if (Date.now() - oauthState.createdAt > 600000) {
        await cache.del(`oauth_state:${state}`);
        throw new AuthenticationError('OAuth state expired');
      }

      // Exchange code for tokens
      const tokenData = {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: oauthState.codeVerifier,
      };

      const startTime = Date.now();
      const response: AxiosResponse = await axios.post(
        this.config.tokenUrl!,
        new URLSearchParams(tokenData),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          timeout: 10000,
        }
      );

      logExternalRequest(
        'POST',
        this.config.tokenUrl!,
        response.status,
        Date.now() - startTime
      );

      const tokens: JiraOAuthTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type,
        scope: response.data.scope,
      };

      // Store tokens securely
      await this.storeTokens(oauthState.organizationId, oauthState.userId, tokens);

      // Clean up OAuth state
      await cache.del(`oauth_state:${state}`);

      logger.info('Successfully exchanged JIRA OAuth code for tokens', {
        organizationId: oauthState.organizationId,
        userId: oauthState.userId,
        scope: tokens.scope,
        expiresIn: tokens.expiresIn,
      });

      return {
        tokens,
        organizationId: oauthState.organizationId,
        userId: oauthState.userId,
        redirectUrl: oauthState.redirectUrl,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logExternalRequest(
          'POST',
          this.config.tokenUrl!,
          error.response?.status,
          undefined,
          error
        );
        
        if (error.response?.status === 400) {
          throw new AuthenticationError('Invalid authorization code or expired');
        }
      }

      logger.error('Failed to exchange JIRA OAuth code:', error);
      throw new ExternalServiceError('JIRA OAuth', error as Error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshTokens(organizationId: string, userId: string): Promise<JiraOAuthTokens> {
    try {
      const existingTokens = await this.getTokens(organizationId, userId);
      if (!existingTokens?.refreshToken) {
        throw new AuthenticationError('No refresh token available');
      }

      const tokenData = {
        grant_type: 'refresh_token',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: existingTokens.refreshToken,
      };

      const startTime = Date.now();
      const response: AxiosResponse = await axios.post(
        this.config.tokenUrl!,
        new URLSearchParams(tokenData),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
          },
          timeout: 10000,
        }
      );

      logExternalRequest(
        'POST',
        this.config.tokenUrl!,
        response.status,
        Date.now() - startTime
      );

      const newTokens: JiraOAuthTokens = {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || existingTokens.refreshToken,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type,
        scope: response.data.scope,
      };

      // Store updated tokens
      await this.storeTokens(organizationId, userId, newTokens);

      logger.info('Successfully refreshed JIRA OAuth tokens', {
        organizationId,
        userId,
        expiresIn: newTokens.expiresIn,
      });

      return newTokens;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logExternalRequest(
          'POST',
          this.config.tokenUrl!,
          error.response?.status,
          undefined,
          error
        );
      }

      logger.error('Failed to refresh JIRA OAuth tokens:', error);
      throw new ExternalServiceError('JIRA OAuth Refresh', error as Error);
    }
  }

  /**
   * Get accessible JIRA instances for user
   */
  async getAccessibleResources(organizationId: string, userId: string): Promise<JiraInstance[]> {
    try {
      const tokens = await this.getValidTokens(organizationId, userId);
      
      const startTime = Date.now();
      const response: AxiosResponse = await axios.get(
        `${this.apiUrl}/oauth/token/accessible-resources`,
        {
          headers: {
            'Authorization': `Bearer ${tokens.accessToken}`,
            'Accept': 'application/json',
          },
          timeout: 10000,
        }
      );

      logExternalRequest(
        'GET',
        `${this.apiUrl}/oauth/token/accessible-resources`,
        response.status,
        Date.now() - startTime
      );

      const resources: JiraAccessibleResources[] = response.data;
      
      const instances: JiraInstance[] = resources.map(resource => ({
        id: resource.id,
        name: resource.name,
        url: resource.url,
        cloudId: resource.id,
        deploymentType: 'Cloud',
        baseUrl: `https://api.atlassian.com/ex/jira/${resource.id}`,
      }));

      logger.info('Retrieved accessible JIRA instances', {
        organizationId,
        userId,
        instanceCount: instances.length,
        instances: instances.map(i => ({ id: i.id, name: i.name })),
      });

      return instances;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logExternalRequest(
          'GET',
          `${this.apiUrl}/oauth/token/accessible-resources`,
          error.response?.status,
          undefined,
          error
        );
      }

      logger.error('Failed to get accessible JIRA resources:', error);
      throw new ExternalServiceError('JIRA Resources', error as Error);
    }
  }

  /**
   * Revoke OAuth tokens
   */
  async revokeTokens(organizationId: string, userId: string): Promise<void> {
    try {
      const tokens = await this.getTokens(organizationId, userId);
      if (!tokens) {
        return; // No tokens to revoke
      }

      // Revoke the tokens with Atlassian
      try {
        const revokeData = {
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          token: tokens.accessToken,
        };

        await axios.post(
          `${this.baseUrl}/oauth/token/revoke`,
          new URLSearchParams(revokeData),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            timeout: 10000,
          }
        );
      } catch (revokeError) {
        // Log but don't fail - still clean up local tokens
        logger.warn('Failed to revoke tokens with Atlassian (continuing with local cleanup):', revokeError);
      }

      // Remove tokens from local storage
      await cache.del(`jira_tokens:${organizationId}:${userId}`);

      logger.info('Successfully revoked JIRA OAuth tokens', {
        organizationId,
        userId,
      });
    } catch (error) {
      logger.error('Failed to revoke JIRA OAuth tokens:', error);
      throw new ExternalServiceError('JIRA Token Revocation', error as Error);
    }
  }

  /**
   * Get valid tokens (refresh if needed)
   */
  async getValidTokens(organizationId: string, userId: string): Promise<JiraOAuthTokens> {
    const tokens = await this.getTokens(organizationId, userId);
    if (!tokens) {
      throw new AuthenticationError('No JIRA tokens found');
    }

    // Check if token is expired (with 5 minute buffer)
    const expiresAt = tokens.expiresIn * 1000; // Convert to milliseconds
    const bufferTime = 5 * 60 * 1000; // 5 minutes
    
    if (Date.now() >= (expiresAt - bufferTime)) {
      logger.debug('JIRA token expired, refreshing...', {
        organizationId,
        userId,
        expiresAt: new Date(expiresAt),
      });
      
      return await this.refreshTokens(organizationId, userId);
    }

    return tokens;
  }

  /**
   * Store tokens securely
   */
  private async storeTokens(
    organizationId: string, 
    userId: string, 
    tokens: JiraOAuthTokens
  ): Promise<void> {
    const key = `jira_tokens:${organizationId}:${userId}`;
    const tokenData = {
      ...tokens,
      storedAt: Date.now(),
    };
    
    // Store with TTL based on token expiration (plus buffer)
    const ttlSeconds = tokens.expiresIn + (24 * 60 * 60); // Add 24 hours buffer
    await cache.set(key, JSON.stringify(tokenData), ttlSeconds);
  }

  /**
   * Retrieve stored tokens
   */
  private async getTokens(organizationId: string, userId: string): Promise<JiraOAuthTokens | null> {
    const key = `jira_tokens:${organizationId}:${userId}`;
    const tokenData = await cache.get(key);
    
    if (!tokenData) {
      return null;
    }

    try {
      return JSON.parse(tokenData) as JiraOAuthTokens;
    } catch (error) {
      logger.error('Failed to parse stored JIRA tokens:', error);
      await cache.del(key); // Clean up corrupted data
      return null;
    }
  }

  /**
   * Generate cryptographically secure code verifier for PKCE
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate code challenge from code verifier
   */
  private generateCodeChallenge(codeVerifier: string): string {
    return crypto
      .createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
  }

  /**
   * Generate random state parameter
   */
  private generateState(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Check if user has valid JIRA authentication
   */
  async isAuthenticated(organizationId: string, userId: string): Promise<boolean> {
    try {
      const tokens = await this.getTokens(organizationId, userId);
      return tokens !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get token info for debugging/monitoring
   */
  async getTokenInfo(organizationId: string, userId: string): Promise<{
    hasTokens: boolean;
    scope?: string;
    expiresAt?: Date;
    isExpired?: boolean;
  }> {
    const tokens = await this.getTokens(organizationId, userId);
    
    if (!tokens) {
      return { hasTokens: false };
    }

    const expiresAt = new Date(tokens.expiresIn * 1000);
    const isExpired = Date.now() >= tokens.expiresIn * 1000;

    return {
      hasTokens: true,
      scope: tokens.scope,
      expiresAt,
      isExpired,
    };
  }
}