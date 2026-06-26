import { Controller, Get, Query, Res, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { normalizeProvider } from '../common/provider';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  login(@Query('provider') provider: string, @Res() res: Response) {
    const authUrl = this.authService.getAuthUrl(normalizeProvider(provider));
    return res.redirect(authUrl);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('provider') provider: string,
    @Res() res: Response,
  ) {
    if (!code) {
      return res.status(HttpStatus.BAD_REQUEST).json({ error: 'Missing code' });
    }

    const resolved = normalizeProvider(provider);
    const profile = await this.authService.handleCallback(resolved, code);

    // Redirect back to the renderer with auth info as query params.
    const redirectUrl =
      `http://localhost:5173/auth-success` +
      `?provider=${resolved}` +
      `&nickname=${encodeURIComponent(profile.nickname)}` +
      `&openId=${profile.openId}` +
      `&token=${profile.accessToken}`;
    return res.redirect(redirectUrl);
  }

  @Get('status')
  getStatus(@Query('provider') provider: string) {
    const resolved = normalizeProvider(provider);
    const user = this.authService.getCurrentUser(resolved);
    return {
      provider: resolved,
      loggedIn: this.authService.isLoggedIn(resolved),
      user: user
        ? { nickname: user.nickname, avatarUrl: user.avatarUrl, openId: user.openId }
        : null,
    };
  }

  @Get('logout')
  logout(@Query('provider') provider: string) {
    this.authService.logout(normalizeProvider(provider));
    return { success: true };
  }
}
