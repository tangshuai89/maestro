import { Injectable } from '@nestjs/common';
import {
  MusicProvider,
  PROVIDER_LABELS,
} from '../common/provider';

export interface UserProfile {
  provider: MusicProvider;
  openId: string;
  nickname: string;
  avatarUrl: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

@Injectable()
export class AuthService {
  // One logged-in user per provider.
  private users: Partial<Record<MusicProvider, UserProfile>> = {};

  /**
   * Build the OAuth authorization URL for the given provider.
   *
   * QQ Music uses the QQ Connect platform:
   *   authorize: https://graph.qq.com/oauth2.0/authorize
   *   token:     https://graph.qq.com/oauth2.0/token
   *
   * NetEase Cloud Music has no public OAuth endpoint, so for the demo we
   * redirect to its web login page. In production this would be replaced
   * by the real authorization flow.
   */
  getAuthUrl(provider: MusicProvider): string {
    const redirectUri = encodeURIComponent(
      `http://localhost:3200/auth/callback?provider=${provider}`,
    );
    const state = Math.random().toString(36).substring(2);

    if (provider === 'netease') {
      const clientId = process.env.NETEASE_APP_ID || 'YOUR_NETEASE_APP_ID';
      return (
        `https://music.163.com/oauth/authorize` +
        `?response_type=code` +
        `&client_id=${clientId}` +
        `&redirect_uri=${redirectUri}` +
        `&state=${state}` +
        `&scope=basic`
      );
    }

    const clientId = process.env.QQ_APP_ID || 'YOUR_QQ_APP_ID';
    return (
      `https://graph.qq.com/oauth2.0/authorize` +
      `?response_type=code` +
      `&client_id=${clientId}` +
      `&redirect_uri=${redirectUri}` +
      `&state=${state}` +
      `&scope=get_user_info,get_listen_song`
    );
  }

  async handleCallback(
    provider: MusicProvider,
    code: string,
  ): Promise<UserProfile> {
    // In production, exchange the code for an access token via the provider's
    // token endpoint, then fetch the user profile. For the demo we simulate it.
    const profile: UserProfile = {
      provider,
      openId: `demo_${code.substring(0, 8)}`,
      nickname: `${PROVIDER_LABELS[provider]}用户`,
      avatarUrl: '',
      accessToken: `token_${Date.now()}`,
      expiresAt: Date.now() + 7200 * 1000,
    };
    this.users[provider] = profile;
    return profile;
  }

  getCurrentUser(provider: MusicProvider): UserProfile | null {
    return this.users[provider] ?? null;
  }

  logout(provider: MusicProvider): void {
    delete this.users[provider];
  }

  isLoggedIn(provider: MusicProvider): boolean {
    return this.users[provider] != null;
  }
}
